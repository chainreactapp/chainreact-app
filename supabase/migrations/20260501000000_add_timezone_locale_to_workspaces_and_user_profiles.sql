-- PR-G0 — workspace + user-level timezone / locale settings.
--
-- Backs the `resolveTimezone` / `resolveLocale` helpers in
-- lib/workflows/actions/core/resolveContextDefaults.ts. The helper resolves
-- in priority order: workspace setting → user setting → technical fallback
-- (UTC for timezone, en_US for locale). PR-G1 onward consumes these values
-- to remove the regional-bias hardcoded fallbacks in calendar / sheets / wait
-- handlers (e.g., America/New_York → workspace tz → user tz → UTC).
--
-- Both columns are nullable with no default. NULL means "unset" — the helper
-- falls through to the next layer. UI to set them is a follow-up; until that
-- ships every workspace / user is unset and the helper returns the technical
-- fallback. That is the expected pre-launch state.
--
-- Contract: learning/docs/handler-contracts.md Q12.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS locale text;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS locale text;

COMMENT ON COLUMN public.workspaces.timezone IS
  'IANA timezone identifier (e.g., "America/Chicago"). NULL = unset; helpers fall through to user-level timezone.';
COMMENT ON COLUMN public.workspaces.locale IS
  'BCP-47 locale tag (e.g., "en_US"). NULL = unset; helpers fall through to user-level locale.';
COMMENT ON COLUMN public.user_profiles.timezone IS
  'IANA timezone identifier (e.g., "America/Chicago"). NULL = unset; helpers fall through to UTC.';
COMMENT ON COLUMN public.user_profiles.locale IS
  'BCP-47 locale tag (e.g., "en_US"). NULL = unset; helpers fall through to en_US.';
