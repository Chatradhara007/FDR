-- Phase 02: submission and documents. Tables exist since 001; only a partial index for live documents.
CREATE INDEX documents_live_idx ON documents (instrument_id) WHERE deleted_at IS NULL;
