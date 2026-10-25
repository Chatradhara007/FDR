-- Phase 04: alerts, simulated email outbox, rules for reminders and escalation.
-- No wall-clock defaults: every timestamp is written from the app clock (D10).
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  kind text NOT NULL CHECK (kind IN ('MATURITY_REMINDER','PENDING_VERIFICATION','DISCREPANCY_OPEN','OVERDUE_RENEWAL','RELEASE_PENDING')),
  rule_key text NOT NULL,                  -- e.g. 'maturity:30', 'pending_verification', 'overdue_renewal'
  subject_id text NOT NULL DEFAULT '-',    -- D1: discrepancy id / release request id / '-'
  level int NOT NULL DEFAULT 1,            -- escalation level (1 = original)
  root_alert_id uuid REFERENCES alerts(id),-- D11: first alert of the escalation chain (self for the first)
  recipient_role user_role NOT NULL,
  recipient_user_id uuid REFERENCES users(id),
  institution_id uuid NOT NULL REFERENCES institutions(id),   -- denormalised for scoping
  due_date date NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','ESCALATED','RESOLVED')),
  resolution text CHECK (resolution IN ('SYSTEM_CONDITION_CLEARED','MANUAL','SUPERSEDED')),
  resolution_note text,
  dedupe_key text NOT NULL UNIQUE,         -- D1: instrument_id|kind|rule_key|subject_id|due_date|level|recipient_role
  created_at timestamptz NOT NULL,
  acknowledged_at timestamptz, acknowledged_by uuid REFERENCES users(id),
  resolved_at timestamptz,     resolved_by uuid REFERENCES users(id)
);
CREATE INDEX alerts_open ON alerts (status, recipient_role);
CREATE INDEX ON alerts (instrument_id);
CREATE INDEX ON alerts (root_alert_id);

CREATE TABLE outbox (            -- stand-in for email; visible to admins
  id bigserial PRIMARY KEY,
  alert_id uuid REFERENCES alerts(id),
  to_role user_role, to_user_id uuid, to_institution_id uuid,
  subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX ON outbox (created_at DESC, id DESC);

-- Default rules (same values as shared/constants.json -> ruleDefaults).
INSERT INTO rules (key, name, type, config) VALUES
  ('reminder', 'Maturity reminders', 'reminder',
   '{"offsets":[{"days":90,"recipients":["institution","officer"]},{"days":60,"recipients":["institution","officer"]},{"days":30,"recipients":["institution","officer"]},{"days":7,"recipients":["institution","officer","approver"]}]}'),
  ('pending_verification', 'Verification pending', 'pending_verification', '{"afterDays":5,"recipients":["officer"]}'),
  ('discrepancy_open', 'Discrepancy open', 'discrepancy_open', '{"afterDays":7,"recipients":["officer"]}'),
  ('overdue_renewal', 'Overdue renewal', 'overdue_renewal',
   '{"graceDays":15,"recipients":["institution","officer","approver"]}'),
  ('release_pending', 'Release pending', 'release_pending', '{"afterDays":5,"recipients":["approver"]}'),
  ('escalation', 'Escalation ladder', 'escalation',
   '{"levels":[{"level":1,"role":"officer","afterDays":0},{"level":2,"role":"approver","afterDays":7},{"level":3,"role":"admin","afterDays":14}],"kinds":["PENDING_VERIFICATION","DISCREPANCY_OPEN","OVERDUE_RENEWAL","RELEASE_PENDING"]}')
ON CONFLICT (key) DO NOTHING;
