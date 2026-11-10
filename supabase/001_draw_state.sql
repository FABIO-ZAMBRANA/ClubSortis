-- Club Sortis: execute in the Supabase SQL Editor as postgres.
-- Private storage for the Node backend (DATABASE_URL); not exposed to browsers.
-- Re-running this script does not erase existing data.
BEGIN;

CREATE SCHEMA IF NOT EXISTS sortis_private;
REVOKE ALL ON SCHEMA sortis_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS sortis_private.draw_state (
  id text PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  pending_spin jsonb CHECK (jsonb_typeof(pending_spin) = 'object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sortis_private.draw_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sortis_private.draw_state FROM PUBLIC, anon, authenticated;

-- The backend will initialize this row when the database connection is ready.
-- It must persist state + pending_spin atomically and compare revision on writes.
COMMIT;
