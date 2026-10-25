-- Phase 05: renewal chain. A replacement points at the instrument it replaces (parent_instrument_id, since 001).
ALTER TABLE instruments ADD CONSTRAINT no_self_parent CHECK (parent_instrument_id <> id);
-- At most one successor per instrument; drafts can be deleted (Phase 2), so an abandoned one never blocks.
CREATE UNIQUE INDEX one_successor_per_instrument ON instruments (parent_instrument_id)
  WHERE parent_instrument_id IS NOT NULL;

-- Default rule (same values as shared/constants.json -> ruleDefaults).
INSERT INTO rules (key, name, type, config) VALUES
  ('renewal_checks', 'Renewal and replacement checks', 'renewal_checks',
   '{"requireLaterMaturity":true,"flagCoverageGapDays":0,"flagLowerAmount":true}')
ON CONFLICT (key) DO NOTHING;
