import { describe, expect, it } from 'vitest';
import {
  instrumentCreateSchema, instrumentListQuerySchema, instrumentPatchSchema, submissionIssues, type SubmittableValues,
} from '../src/schemas';
import { sameTrackedValue, trackedValue } from '../src/fields';

const complete: SubmittableValues = {
  referenceNo: 'SBIN/FDR/2026/00731',
  issuingBank: 'State Bank of India',
  branch: null,
  amount: '2500000.00',
  issueDate: '2026-04-01',
  maturityDate: '2027-04-01',
  beneficiaryName: 'Member Secretary, AICTE',
  lienMarked: true,
  purpose: null,
};

describe('instrument schemas', () => {
  it('normalises create input', () => {
    const r = instrumentCreateSchema.parse({
      type: 'FDR', referenceNo: ' sbin/fdr 2026/00731 ', amount: '25,00,000', beneficiaryName: '  Member   Secretary ', branch: '',
    });
    expect(r).toMatchObject({ type: 'FDR', referenceNo: 'SBIN/FDR2026/00731', amount: '2500000.00', beneficiaryName: 'Member Secretary', branch: null });
  });

  it('drafts may be empty except type', () => {
    expect(instrumentCreateSchema.safeParse({ type: 'SECURITY_DEPOSIT' }).success).toBe(true);
    expect(instrumentCreateSchema.safeParse({}).success).toBe(false);
  });

  it('lists every failing field', () => {
    const r = instrumentCreateSchema.safeParse({
      type: 'FDR', referenceNo: 'AB', issuingBank: 'Bank of Nowhere', amount: '0', issueDate: '2026-02-30', branch: 'x'.repeat(81),
    });
    expect(r.success).toBe(false);
    const fields = r.error!.issues.map((i) => i.path.join('.')).sort();
    expect(fields).toEqual(['amount', 'branch', 'issueDate', 'issuingBank', 'referenceNo']);
  });

  it('amount bounds use exact decimal comparison', () => {
    expect(instrumentCreateSchema.safeParse({ type: 'FDR', amount: '1000000000.00' }).success).toBe(true);
    expect(instrumentCreateSchema.safeParse({ type: 'FDR', amount: '1000000000.01' }).success).toBe(false);
    expect(instrumentCreateSchema.safeParse({ type: 'FDR', amount: '12.345' }).success).toBe(false);
    expect(instrumentCreateSchema.safeParse({ type: 'FDR', amount: 'abc' }).success).toBe(false);
  });

  it('patch requires version', () => {
    expect(instrumentPatchSchema.safeParse({ amount: '1' }).success).toBe(false);
    expect(instrumentPatchSchema.safeParse({ amount: '1', version: 2 }).success).toBe(true);
  });
});

describe('submissionIssues', () => {
  it('passes a complete, valid record', () => {
    expect(submissionIssues(complete, '2026-10-25')).toEqual([]);
  });

  it('reports required fields and D25 date rules together', () => {
    const issues = submissionIssues(
      { ...complete, referenceNo: null, beneficiaryName: null, issueDate: '2026-11-01', maturityDate: '2026-10-01' },
      '2026-10-25',
    );
    expect(issues.map((i) => i.field).sort()).toEqual(['beneficiaryName', 'issueDate', 'maturityDate', 'referenceNo']);
  });

  it('maturity in the past fails on maturityDate', () => {
    const issues = submissionIssues({ ...complete, issueDate: '2025-01-01', maturityDate: '2026-01-01' }, '2026-10-25');
    expect(issues).toEqual([{ field: 'maturityDate', message: 'Maturity date has already passed' }]);
  });
});

describe('list query', () => {
  it('accepts repeated, bracketed and comma-separated status', () => {
    expect(instrumentListQuerySchema.parse({ status: ['DRAFT', 'ACTIVE'] }).status).toEqual(['DRAFT', 'ACTIVE']);
    expect(instrumentListQuerySchema.parse({ status: 'DRAFT,RETURNED' }).status).toEqual(['DRAFT', 'RETURNED']);
    expect(instrumentListQuerySchema.parse({}).status).toBeUndefined();
    expect(instrumentListQuerySchema.parse({ page: '2', pageSize: '10' })).toMatchObject({ page: 2, pageSize: 10, sort: 'maturityDate' });
    expect(instrumentListQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(instrumentListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});

describe('tracked values', () => {
  it('canonical forms', () => {
    expect(trackedValue('amount', { ...complete, amount: '2500000' })).toBe('2500000.00');
    expect(trackedValue('lien_marked', complete)).toBe('true');
    expect(sameTrackedValue('beneficiary_name', 'Member Secretary, AICTE', 'MEMBER SECRETARY AICTE')).toBe(true);
    expect(sameTrackedValue('amount', '2500000.00', '2000000.00')).toBe(false);
  });
});
