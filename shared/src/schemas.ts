import { z } from 'zod';
import { BANKS } from './banks';
import { DOC_TYPES, INSTRUMENT_STATUSES, INSTRUMENT_TYPES } from './enums';
import { normAmount, normDate, normRef } from './normalize';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Strict calendar date 'YYYY-MM-DD'. */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => {
    try {
      return normDate(s) === s;
    } catch {
      return false;
    }
  }, 'Not a valid calendar date');

export const clockAdvanceSchema = z.object({
  days: z.number().int('Whole days only').min(1, 'At least 1 day').max(730, 'At most 730 days'),
});

export const clockSetSchema = z.object({ date: dateString });

// ---------------------------------------------------------------------------------------------
// Phase 02: instrument submission. Field names are the API's camelCase names.

/** One failing field; validation errors always list every one (CLAUDE.md rule 7). */
export interface FieldIssue {
  field: string;
  message: string;
}

/** Largest accepted amount: ₹100 crore, compared in paise as BigInt (never floats). */
export const MAX_AMOUNT = '1000000000.00';
const paise = (amount: string): bigint => BigInt(amount.replace('.', ''));

const blankToNull = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? null : v);
const collapse = (s: string): string => s.trim().replace(/\s+/g, ' ');

const referenceNo = z.preprocess(
  blankToNull,
  z
    .string()
    .transform((s) => normRef(s))
    .pipe(
      z
        .string()
        .min(6, 'Reference number must be 6–30 characters')
        .max(30, 'Reference number must be 6–30 characters')
        .regex(/^[A-Z0-9/-]+$/, 'Use only letters, digits, hyphens and slashes'),
    )
    .nullable()
    .optional(),
);

const amount = z.preprocess(
  blankToNull,
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      try {
        return normAmount(v);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Enter an amount in rupees with at most two decimals, e.g. 25,00,000' });
        return z.NEVER;
      }
    })
    .refine((a) => paise(a) > 0n, 'Amount must be more than zero')
    .refine((a) => paise(a) <= paise(MAX_AMOUNT), 'Amount cannot exceed ₹100 crore')
    .nullable()
    .optional(),
);

const optionalText = (max: number, label: string) =>
  z.preprocess(blankToNull, z.string().transform(collapse).pipe(z.string().max(max, `${label} must be at most ${max} characters`)).nullable().optional());

const optionalDate = z.preprocess(blankToNull, dateString.nullable().optional());

/** Every editable field; drafts may leave any of them empty. */
export const instrumentFieldsSchema = z.object({
  referenceNo,
  issuingBank: z.preprocess(blankToNull, z.enum(BANKS, { error: 'Choose a bank from the list' }).nullable().optional()),
  branch: optionalText(80, 'Branch'),
  amount,
  issueDate: optionalDate,
  maturityDate: optionalDate,
  beneficiaryName: optionalText(120, 'Beneficiary name'),
  lienMarked: z.boolean({ error: 'Lien marked must be true or false' }).optional(),
  purpose: optionalText(200, 'Purpose'),
});
export type InstrumentFieldsInput = z.input<typeof instrumentFieldsSchema>;
export type InstrumentFields = z.output<typeof instrumentFieldsSchema>;

export const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES, { error: 'Choose FDR or security deposit' });

export const instrumentCreateSchema = instrumentFieldsSchema.extend({ type: instrumentTypeSchema });
export type InstrumentCreateInput = z.input<typeof instrumentCreateSchema>;

export const instrumentPatchSchema = instrumentFieldsSchema.extend({
  type: instrumentTypeSchema.optional(),
  version: z.number({ error: 'version is required' }).int().positive(),
});
export type InstrumentPatchInput = z.input<typeof instrumentPatchSchema>;

/** The stored values the submit check looks at. */
export interface SubmittableValues {
  referenceNo: string | null;
  issuingBank: string | null;
  branch: string | null;
  amount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  beneficiaryName: string | null;
  lienMarked: boolean;
  purpose: string | null;
}

const REQUIRED_AT_SUBMIT: { field: keyof SubmittableValues; message: string }[] = [
  { field: 'referenceNo', message: 'Enter the reference number' },
  { field: 'issuingBank', message: 'Choose the issuing bank' },
  { field: 'amount', message: 'Enter the amount' },
  { field: 'issueDate', message: 'Enter the issue date' },
  { field: 'maturityDate', message: 'Enter the maturity date' },
  { field: 'beneficiaryName', message: 'Enter the beneficiary name' },
];

/** maturity after issue: checked on every save (also a DB constraint). */
export function dateOrderIssue(v: { issueDate?: string | null; maturityDate?: string | null }): FieldIssue | null {
  if (v.issueDate && v.maturityDate && v.maturityDate <= v.issueDate) {
    return { field: 'maturityDate', message: 'Maturity date must be after the issue date' };
  }
  return null;
}

/**
 * Full check at submit (2.3 + D25): field formats, required fields, date rules against the app's `today`.
 * Returns every failing field (one message per field).
 */
export function submissionIssues(v: SubmittableValues, today: string): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const seen = new Set<string>();
  const add = (i: FieldIssue): void => {
    if (seen.has(i.field)) return;
    seen.add(i.field);
    issues.push(i);
  };
  const parsed = instrumentFieldsSchema.safeParse(v);
  if (!parsed.success) for (const i of parsed.error.issues) add({ field: i.path.join('.') || 'body', message: i.message });
  for (const r of REQUIRED_AT_SUBMIT) if (v[r.field] === null || v[r.field] === '') add({ field: r.field, message: r.message });
  if (v.issueDate && v.issueDate > today) add({ field: 'issueDate', message: 'Issue date cannot be in the future' });
  const order = dateOrderIssue(v);
  if (order) add(order);
  if (v.maturityDate && v.maturityDate < today) add({ field: 'maturityDate', message: 'Maturity date has already passed' });
  return issues;
}

/** Accepts `status=A&status=B`, `status[]=A` and `status=A,B`. */
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
  }, z.array(item).optional());

export const INSTRUMENT_SORTS = [
  'maturityDate', '-maturityDate', 'amount', '-amount', 'createdAt', '-createdAt', 'updatedAt', '-updatedAt',
  'referenceNo', '-referenceNo',
] as const;
export type InstrumentSort = (typeof INSTRUMENT_SORTS)[number];

const optionalQueryText = z.preprocess(blankToNull, z.string().trim().max(100).nullable().optional());

export const instrumentListQuerySchema = z.object({
  status: listOf(z.enum(INSTRUMENT_STATUSES)),
  type: z.preprocess(blankToNull, z.enum(INSTRUMENT_TYPES).nullable().optional()),
  bank: optionalQueryText,
  region: optionalQueryText,
  institutionId: z.preprocess(blankToNull, z.uuid('Not a valid id').nullable().optional()),
  q: optionalQueryText,
  maturityFrom: optionalDate,
  maturityTo: optionalDate,
  sort: z.enum(INSTRUMENT_SORTS).default('maturityDate'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type InstrumentListQuery = z.output<typeof instrumentListQuerySchema>;

export const docTypeSchema = z.enum(DOC_TYPES, { error: 'Choose a document type' });
