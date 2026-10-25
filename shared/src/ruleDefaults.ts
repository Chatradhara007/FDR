// Default rule rows. 001_init.sql inserts the same values; the admin screen (Phase 8) restores from here.
// Phases 4, 6 and 7 append their rules.

export interface RuleDefault {
  key: string;
  name: string;
  type: string;
  config: unknown;
}

export const RULE_DEFAULTS: readonly RuleDefault[] = [
  {
    key: 'required_docs',
    name: 'Required documents',
    type: 'required_docs',
    config: { FDR: ['FDR_COPY', 'BANK_LETTER'], SECURITY_DEPOSIT: ['DEPOSIT_CONFIRMATION'] },
  },
  {
    key: 'lien_required',
    name: 'Lien in favour of AICTE required',
    type: 'lien_required',
    config: { FDR: true, SECURITY_DEPOSIT: false },
  },
];
