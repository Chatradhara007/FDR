-- Post-Phase-09 additions: advisory flags, document text cross-check findings, expected-beneficiary rule.
-- Advisory only: nothing here changes a status, a verification state or a trust tier.
-- No wall-clock defaults: every timestamp is written from the app clock (D10).
CREATE TABLE advisory_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('DUPLICATE_REFERENCE','HIGH_AMOUNT','BENEFICIARY_NEAR_MISS')),
  reason text NOT NULL,            -- plain language, shown to officers
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  cleared_at timestamptz           -- set when a later check no longer finds the pattern
);
CREATE INDEX advisory_flags_open ON advisory_flags (instrument_id) WHERE cleared_at IS NULL;

CREATE TABLE document_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('READ','UNREADABLE')),
  reason text,                     -- why UNREADABLE: BROKEN, ENCRYPTED, TOO_LARGE, TOO_MANY_PAGES, NO_TEXT, IMAGE
  extracted jsonb NOT NULL,        -- values found in the text (never the whole text)
  metadata_signal jsonb,           -- soft signal: modified after created / image editor producer
  created_at timestamptz NOT NULL
);
CREATE INDEX ON document_findings (instrument_id);

INSERT INTO rules (key, name, type, config) VALUES
  ('expected_beneficiary', 'Expected beneficiary and advisory thresholds', 'expected_beneficiary',
   '{"names":["MEMBER SECRETARY AICTE","All India Council for Technical Education"],"minSimilarity":0.8,"amountMultiple":3,"minComparisons":3}')
ON CONFLICT (key) DO NOTHING;
