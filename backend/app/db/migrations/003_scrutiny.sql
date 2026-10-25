-- Phase 03: scrutiny, bank verification, discrepancies, observations, returns.
-- No wall-clock defaults: every timestamp is written from the app clock (D10).
CREATE TABLE verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  source text NOT NULL,                -- 'mock-bank:<bank>'
  request_payload jsonb NOT NULL,
  response_payload jsonb,
  result text NOT NULL CHECK (result IN ('CONFIRMED','MISMATCH','NOT_FOUND','PENDING','UNAVAILABLE','STALE')), -- D9, D12
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL,
  responded_at timestamptz
);
CREATE INDEX ON verifications (instrument_id, requested_at DESC);

CREATE TABLE discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  verification_id uuid REFERENCES verifications(id),
  field_name text NOT NULL,
  claimed_value text NOT NULL,
  confirmed_value text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE UNIQUE INDEX one_open_discrepancy_per_field
  ON discrepancies (instrument_id, field_name) WHERE status = 'OPEN';
CREATE INDEX ON discrepancies (instrument_id);

CREATE TABLE observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  author_id uuid REFERENCES users(id),           -- null when raised by the system (Phase 5)
  text text NOT NULL,
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','CONCERN','BLOCKING')),
  visible_to_institution boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),  -- D3
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX ON observations (instrument_id);

CREATE TABLE returns (               -- why an instrument was sent back (shown to the institution)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  officer_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX ON returns (instrument_id);
