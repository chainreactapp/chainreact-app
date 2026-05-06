-- ChainReactV2 — initial migration: shared SQL helpers used by every later
-- migration. Per docs/rules/database-security.md, these are the building
-- blocks that subsequent table migrations rely on.

-- pgcrypto provides gen_random_uuid(). Supabase enables this by default but
-- this CREATE EXTENSION IF NOT EXISTS makes the dependency explicit.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Audit trigger function: stamps updated_at on every UPDATE.
-- Every table that follows the standard template attaches a BEFORE UPDATE
-- trigger that calls this function.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
