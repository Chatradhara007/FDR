-- Phase 08: admin (rules, users), audit trail and integrity, security.

-- CLAUDE.md rule 10: records admins edit carry an integer version for optimistic locking.
ALTER TABLE rules ADD COLUMN version int NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN version int NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN updated_at timestamptz;

-- release_pending alerts always go to the role whose turn it is at the current level; the rule has no recipients.
UPDATE rules SET config = config - 'recipients' WHERE key = 'release_pending';

-- Audit log filters.
CREATE INDEX events_action ON events (action);
CREATE INDEX events_actor ON events (actor_id);
CREATE INDEX events_created_at ON events (created_at);

-- Demo tamper tool (D17): the original after_json of a tampered event, so the tamper can be undone.
CREATE TABLE demo_tampers (
  event_id bigint PRIMARY KEY REFERENCES events(id),
  original_after_json jsonb,
  tampered_at timestamptz NOT NULL
);
