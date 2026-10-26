-- Phase 06: release, discharge and refund workflow.
-- No wall-clock defaults: every timestamp is written from the app clock (D10).
CREATE TABLE release_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_CONDITIONS' CHECK (status IN
    ('PENDING_CONDITIONS','PENDING_APPROVAL','APPROVED','REJECTED','RETURNED','CANCELLED')),
  required_levels jsonb NOT NULL,      -- snapshot of the approval chain for this request (6.4)
  current_level int NOT NULL DEFAULT 1,
  return_message text,                 -- latest message to the institution when RETURNED
  refund_reference text,
  requested_at timestamptz NOT NULL,
  stage_started_at timestamptz NOT NULL, -- when the request reached its current level (RELEASE_PENDING age)
  closed_at timestamptz,
  seq bigserial NOT NULL               -- insertion order (the simulated clock can give several rows one time)
);
CREATE UNIQUE INDEX one_open_release_per_instrument ON release_requests (instrument_id)
  WHERE status IN ('PENDING_CONDITIONS','PENDING_APPROVAL','RETURNED');
CREATE INDEX ON release_requests (status);

CREATE TABLE release_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_request_id uuid NOT NULL REFERENCES release_requests(id) ON DELETE CASCADE,
  position int NOT NULL,
  code text NOT NULL,
  description text NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  auto boolean NOT NULL DEFAULT false,
  met boolean NOT NULL DEFAULT false,   -- manual conditions only; auto ones are evaluated live
  checked_by uuid REFERENCES users(id),
  checked_at timestamptz,
  remarks text,
  UNIQUE (release_request_id, code)
);

CREATE TABLE release_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_request_id uuid NOT NULL REFERENCES release_requests(id) ON DELETE CASCADE,
  level int NOT NULL,
  role user_role NOT NULL,
  approver_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('RECOMMEND','APPROVE','REJECT','RETURN')),
  remarks text NOT NULL,
  conditions_snapshot jsonb NOT NULL,  -- every condition and its state at decision time
  decided_at timestamptz NOT NULL,
  seq bigserial NOT NULL               -- the chain's order, even when two decisions share an app-clock time
);
CREATE INDEX ON release_approvals (release_request_id);

ALTER TABLE documents ADD COLUMN release_request_id uuid REFERENCES release_requests(id);
CREATE INDEX ON documents (release_request_id);

-- Default rules (same values as shared/constants.json -> ruleDefaults).
INSERT INTO rules (key, name, type, config) VALUES
  ('release_conditions', 'Release conditions', 'release_conditions',
   '{"conditions":[{"code":"NO_OPEN_DISCREPANCY","auto":true,"mandatory":true,"description":"No open discrepancy on the instrument"},{"code":"NO_BLOCKING_OBSERVATION","auto":true,"mandatory":true,"description":"No unresolved blocking observation"},{"code":"INSTRUMENT_VERIFIED","auto":true,"mandatory":true,"description":"Bank-confirmed, or accepted with a recorded override"},{"code":"REQUEST_DOCUMENTS_ATTACHED","auto":true,"mandatory":true,"description":"At least one release document attached"},{"code":"COMPLIANCE_CONFIRMED","auto":false,"mandatory":true,"description":"The obligation the deposit secured is confirmed as fulfilled"},{"code":"LIEN_REMOVAL_DOCUMENT","auto":false,"mandatory":true,"description":"Bank letter or request for lien removal is on file"}]}'),
  ('approval_levels', 'Release approval levels', 'approval_levels',
   '{"levels":[{"level":1,"role":"officer","action":"RECOMMEND","label":"Scrutiny officer recommendation"},{"level":2,"role":"approver","action":"DECIDE","label":"Competent authority decision"}],"extraApprovalAbove":"5000000.00","extraLevel":{"role":"approver","action":"DECIDE","label":"Second competent authority (amount above ₹50 L)"}}')
ON CONFLICT (key) DO NOTHING;
