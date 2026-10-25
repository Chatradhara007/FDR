-- Phase 01: data model, audit log, app clock, rules.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('institution','officer','approver','admin','auditor');
CREATE TYPE instrument_type AS ENUM ('FDR','SECURITY_DEPOSIT');
CREATE TYPE instrument_status AS ENUM (
  'DRAFT','SUBMITTED','UNDER_SCRUTINY','RETURNED','ACTIVE','EXPIRING',
  'MATURED','RENEWED','LAPSED','RELEASE_REQUESTED','RELEASED');
CREATE TYPE trust_tier AS ENUM ('CLAIMED','DOCUMENT','BANK_CONFIRMED');
CREATE TYPE verification_state AS ENUM ('UNVERIFIED','PENDING','CONFIRMED','MISMATCH','UNAVAILABLE'); -- D12

CREATE TABLE institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aicte_id text UNIQUE NOT NULL,
  name text NOT NULL,
  region text NOT NULL,
  state text NOT NULL,
  contact_email text
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  institution_id uuid REFERENCES institutions(id),
  designation text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  CHECK ((role = 'institution') = (institution_id IS NOT NULL))
);

CREATE TABLE instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id),
  type instrument_type NOT NULL,
  reference_no text,
  issuing_bank text,
  branch text,
  amount numeric(14,2) CHECK (amount IS NULL OR amount > 0),
  issue_date date,
  maturity_date date,
  beneficiary_name text,
  lien_marked boolean NOT NULL DEFAULT false,               -- D8
  purpose text,
  status instrument_status NOT NULL DEFAULT 'DRAFT',
  status_before_release instrument_status,
  verification_state verification_state NOT NULL DEFAULT 'UNVERIFIED',
  accepted_with_override boolean NOT NULL DEFAULT false,    -- D13
  override_note text,
  assigned_officer_id uuid REFERENCES users(id),
  parent_instrument_id uuid REFERENCES instruments(id),
  submitted_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  version int NOT NULL DEFAULT 1,                           -- D10
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (maturity_date IS NULL OR issue_date IS NULL OR maturity_date > issue_date)
);
-- No UNIQUE(issuing_bank, reference_no): see D7 (service rule).

CREATE TABLE field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  value text NOT NULL,
  tier trust_tier NOT NULL DEFAULT 'CLAIMED',
  source text,
  updated_at timestamptz NOT NULL,
  UNIQUE (instrument_id, field_name)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL,
  deleted_at timestamptz,        -- D15
  deleted_by uuid REFERENCES users(id)
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  actor_label text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  instrument_id uuid,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL,
  prev_hash text,
  hash text NOT NULL
);

-- D16: append-only unless the DEMO_MODE tamper tool explicitly allows it in its own transaction
CREATE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('fdr.allow_tamper', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'events table is append-only';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER events_no_update BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();
-- (TRUNCATE in tests/demo reset is allowed: row triggers do not fire on TRUNCATE.)

CREATE TABLE app_clock (
  id int PRIMARY KEY CHECK (id = 1),
  mode text NOT NULL DEFAULT 'REAL' CHECK (mode IN ('REAL','SIMULATED')),
  simulated_now timestamptz
);
INSERT INTO app_clock (id) VALUES (1);

CREATE TABLE rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  config jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz,
  updated_by uuid REFERENCES users(id)
);

CREATE INDEX ON instruments (institution_id);
CREATE INDEX ON instruments (status);
CREATE INDEX ON instruments (maturity_date);
CREATE INDEX ON instruments (parent_instrument_id);
CREATE INDEX ON instruments (issuing_bank, reference_no);
CREATE INDEX ON events (entity_type, entity_id);
CREATE INDEX ON events (instrument_id);
CREATE INDEX ON documents (instrument_id);

-- Default rules (keep in sync with shared/src/ruleDefaults.ts, which the admin "restore defaults" uses).
INSERT INTO rules (key, name, type, config) VALUES
  ('required_docs', 'Required documents', 'required_docs',
   '{"FDR":["FDR_COPY","BANK_LETTER"],"SECURITY_DEPOSIT":["DEPOSIT_CONFIRMATION"]}'),
  ('lien_required', 'Lien in favour of AICTE required', 'lien_required',
   '{"FDR":true,"SECURITY_DEPOSIT":false}');
