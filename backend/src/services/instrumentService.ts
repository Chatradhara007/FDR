import type { PoolClient } from 'pg';
import {
  BANKS, DOC_TYPE_LABELS, DOC_TYPES, INSTRUMENT_TYPE_LABELS, INSTRUMENT_TYPES, STATUS_LABELS, dateOrderIssue, normAmount,
  type DocType, type InstrumentDetail, type InstrumentListQuery, type InstrumentListResponse, type InstrumentType,
  type Meta, type instrumentCreateSchema, type instrumentPatchSchema,
} from '@fdr/shared';
import type { z } from 'zod';
import { getPool, withTransaction, type Db } from '../db/pool';
import { actorOf, assertCanSee, scopeInstrumentsQuery, type AuthUser } from '../domain/access';
import { recordEvent } from '../domain/audit';
import * as clock from '../domain/clock';
import { Conflict, InvalidState, NotFound, ValidationFailed } from '../domain/errors';
import { listLiveDocuments } from '../repositories/documentRepo';
import { findInstitutionById, listRegions } from '../repositories/institutionRepo';
import {
  deleteInstrument, findInstrumentById, findLiveDuplicateRef, insertInstrument, listInstruments as listInstrumentRows,
  lockInstrument, updateInstrumentFields, type EditableField, type InstrumentChanges, type InstrumentRow,
} from '../repositories/instrumentRepo';
import { listProvenance } from '../repositories/provenanceRepo';
import { getRuleConfig } from '../repositories/ruleRepo';

export type InstrumentCreate = z.output<typeof instrumentCreateSchema>;
export type InstrumentPatch = z.output<typeof instrumentPatchSchema>;

/** Statuses in which the institution may edit fields and documents (2.6). */
export const EDITABLE_STATUSES = ['DRAFT', 'RETURNED'] as const;

export function isEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** JSON round trip: Dates → ISO strings, as the API sends them. */
function toJson<T>(v: unknown): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export interface DocRules {
  requiredDocs: Record<InstrumentType, DocType[]>;
  lienRequired: Record<InstrumentType, boolean>;
}

/** Current required_docs and lien_required rules (read per operation, rule 11). */
export async function docRules(db: Db): Promise<DocRules> {
  const required = (await getRuleConfig<Partial<Record<InstrumentType, DocType[]>>>(db, 'required_docs')) ?? {};
  const lien = (await getRuleConfig<Partial<Record<InstrumentType, boolean>>>(db, 'lien_required')) ?? {};
  return {
    requiredDocs: Object.fromEntries(INSTRUMENT_TYPES.map((t) => [t, required[t] ?? []])) as Record<InstrumentType, DocType[]>,
    lienRequired: Object.fromEntries(INSTRUMENT_TYPES.map((t) => [t, lien[t] ?? false])) as Record<InstrumentType, boolean>,
  };
}

export function missingDocs(required: readonly DocType[], present: readonly string[]): DocType[] {
  return required.filter((d) => !present.includes(d));
}

/** D7: 409 DUPLICATE_REFERENCE when another live instrument has the same bank and reference. */
export async function assertNoDuplicateRef(db: Db, inst: Pick<InstrumentRow, 'id' | 'issuingBank' | 'referenceNo' | 'parentInstrumentId'> | {
  id: null; issuingBank: string | null; referenceNo: string | null; parentInstrumentId: string | null;
}): Promise<void> {
  if (!inst.issuingBank || !inst.referenceNo) return;
  const other = await findLiveDuplicateRef(db, inst.issuingBank, inst.referenceNo, inst.id, inst.parentInstrumentId);
  if (other) {
    throw new Conflict(
      `${inst.issuingBank} reference ${inst.referenceNo} is already on record (status: ${STATUS_LABELS[other.status]}). ` +
        'A reference can be lodged again only after the earlier instrument is released or renewed.',
      { field: 'referenceNo', status: other.status },
      'DUPLICATE_REFERENCE',
    );
  }
}

/** Loads and locks an instrument the institution user owns and may still edit. */
export async function lockOwnEditable(tx: PoolClient, user: AuthUser, id: string, what = 'edited'): Promise<InstrumentRow> {
  const inst = await lockInstrument(tx, id);
  assertCanSee(user, inst);
  if (!isEditable(inst.status)) {
    throw new InvalidState(`This instrument is ${STATUS_LABELS[inst.status]} and can no longer be ${what}`, { status: inst.status });
  }
  return inst;
}

export async function getInstrument(user: AuthUser, id: string, db: Db = getPool()): Promise<InstrumentDetail> {
  const row = await findInstrumentById(db, id);
  if (!row) throw new NotFound('Instrument not found');
  assertCanSee(user, row);
  const [institution, documents, provenance, rules, today] = await Promise.all([
    findInstitutionById(db, row.institutionId),
    listLiveDocuments(db, id),
    listProvenance(db, id),
    docRules(db),
    clock.today(db),
  ]);
  const required = rules.requiredDocs[row.type];
  return toJson<InstrumentDetail>({
    ...row,
    institutionName: institution?.name ?? '',
    region: institution?.region ?? '',
    documents: documents.map(({ storagePath: _p, ...d }) => d),
    provenance,
    daysToMaturity: row.maturityDate ? clock.daysBetween(today, row.maturityDate) : null,
    requiredDocs: required,
    missingDocs: missingDocs(required, documents.map((d) => d.docType)),
    lienRequired: rules.lienRequired[row.type],
  });
}

export async function listInstruments(user: AuthUser, q: InstrumentListQuery): Promise<InstrumentListResponse> {
  const db = getPool();
  const today = await clock.today(db);
  const { rows, total } = await listInstrumentRows(db, q, today, (params) => scopeInstrumentsQuery(user, params));
  return { items: toJson(rows), total, page: q.page, pageSize: q.pageSize };
}

export async function getMeta(): Promise<Meta> {
  const db = getPool();
  const [rules, regions] = await Promise.all([docRules(db), listRegions(db)]);
  return {
    banks: BANKS,
    docTypes: DOC_TYPES.map((value) => ({ value, label: DOC_TYPE_LABELS[value] })),
    instrumentTypes: INSTRUMENT_TYPES.map((value) => ({ value, label: INSTRUMENT_TYPE_LABELS[value] })),
    regions,
    ...rules,
  };
}

const FIELD_KEYS: EditableField[] = [
  'type', 'referenceNo', 'issuingBank', 'branch', 'amount', 'issueDate', 'maturityDate', 'beneficiaryName', 'lienMarked', 'purpose',
];

function sameValue(key: EditableField, a: unknown, b: unknown): boolean {
  if (key === 'amount' && typeof a === 'string' && typeof b === 'string') return normAmount(a) === normAmount(b);
  return (a ?? null) === (b ?? null);
}

function assertDateOrder(v: { issueDate?: string | null; maturityDate?: string | null }): void {
  const issue = dateOrderIssue(v);
  if (issue) throw new ValidationFailed([issue]);
}

export async function createDraft(user: AuthUser, input: InstrumentCreate): Promise<InstrumentDetail> {
  assertDateOrder(input);
  const id = await withTransaction(async (tx) => {
    await assertNoDuplicateRef(tx, {
      id: null, issuingBank: input.issuingBank ?? null, referenceNo: input.referenceNo ?? null, parentInstrumentId: null,
    });
    const row = await insertInstrument(tx, { ...input, institutionId: user.institutionId! }, await clock.now(tx));
    const after = Object.fromEntries(FIELD_KEYS.map((k) => [k, row[k]]));
    await recordEvent(tx, {
      actor: actorOf(user), action: 'INSTRUMENT_CREATED', entityType: 'instrument', entityId: row.id, instrumentId: row.id, after,
    });
    return row.id;
  });
  return getInstrument(user, id);
}

/** PATCH while DRAFT/RETURNED with the current version (D10); records only the changed fields (2.6). */
export async function editInstrument(user: AuthUser, id: string, input: InstrumentPatch): Promise<InstrumentDetail> {
  await withTransaction(async (tx) => {
    const inst = await lockOwnEditable(tx, user, id);
    if (inst.version !== input.version) {
      throw new Conflict('This record changed in another tab or by another user — reload and try again',
        { currentVersion: inst.version }, 'STALE_VERSION');
    }
    if (input.type !== undefined && input.type !== inst.type && inst.status !== 'DRAFT') {
      throw new ValidationFailed([{ field: 'type', message: 'The type can only be changed while the instrument is a draft' }]);
    }
    const changes: InstrumentChanges = {};
    const before: Record<string, unknown> = {};
    for (const key of FIELD_KEYS) {
      const value = input[key];
      if (value === undefined || sameValue(key, value, inst[key])) continue;
      changes[key] = value;
      before[key] = inst[key];
    }
    if (!Object.keys(changes).length) return;
    const merged = { ...inst, ...changes } as InstrumentRow;
    assertDateOrder(merged);
    if ('referenceNo' in changes || 'issuingBank' in changes) await assertNoDuplicateRef(tx, merged);
    const updated = await updateInstrumentFields(tx, id, changes, input.version, await clock.now(tx));
    if (!updated) throw new Conflict('This record changed in another tab — reload and try again', null, 'STALE_VERSION');
    await recordEvent(tx, {
      actor: actorOf(user), action: 'INSTRUMENT_EDITED', entityType: 'instrument', entityId: id, instrumentId: id,
      before, after: Object.fromEntries(Object.keys(changes).map((k) => [k, updated[k as EditableField]])),
    });
  });
  return getInstrument(user, id);
}

/** DELETE while DRAFT (D7): hard delete incl. provenance and document rows; files stay on disk. */
export async function deleteDraft(user: AuthUser, id: string): Promise<void> {
  await withTransaction(async (tx) => {
    const inst = await lockInstrument(tx, id);
    assertCanSee(user, inst);
    if (inst.status !== 'DRAFT') {
      throw new InvalidState(`Only drafts can be deleted; this instrument is ${STATUS_LABELS[inst.status]}`, { status: inst.status });
    }
    const documents = await listLiveDocuments(tx, id);
    await recordEvent(tx, {
      actor: actorOf(user), action: 'INSTRUMENT_DRAFT_DELETED', entityType: 'instrument', entityId: id, instrumentId: id,
      before: { ...Object.fromEntries(FIELD_KEYS.map((k) => [k, inst[k]])), documents: documents.map((d) => ({ id: d.id, docType: d.docType, sha256: d.sha256 })) },
    });
    await deleteInstrument(tx, id);
  });
}
