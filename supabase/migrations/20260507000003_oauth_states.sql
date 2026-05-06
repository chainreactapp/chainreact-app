-- ChainReactV2 — oauth_states table.
-- system-table: oauth_states — ephemeral OAuth state nonces; service-role only.
--
-- Per docs/rules/oauth-dispatcher.md (Resolved Decisions): "Signed short-lived
-- state token + DB row keyed by nonce for PKCE/temp metadata. 15-min expiry.
-- Row deleted after callback."
--
-- Why this exists alongside the signed JWT:
-- the HMAC token alone proves a state value originated server-side, but it
-- doesn't prevent replay. Without a server-side row, an attacker who
-- intercepts a state token (browser history leak, log slurp, malicious
-- extension) within the 15-min window can craft a callback URL with that
-- state + their own provider OAuth code — and have the resulting integration
-- row inserted under the victim's user_id. The DB row enables atomic
-- one-time-use semantics: callback consumes the row via DELETE…RETURNING; a
-- second consume sees no row and rejects.
--
-- Provider-agnostic. The pkce_* columns stay NULL for providers that don't
-- need them (Slack default v2 = no PKCE). Adding new ephemeral OAuth
-- metadata is a column add, not a per-provider schema fork.

CREATE TABLE public.oauth_states (
  -- The unguessable random nonce. Also embedded in the signed state token
  -- payload; the dispatcher matches them to bind the JWT to this row.
  nonce text PRIMARY KEY,

  -- Denormalized from the signed token's payload so the consume path can
  -- audit / reap by user without re-parsing the JWT.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,

  -- 15-min after creation. The atomic consume's WHERE clause checks this so
  -- expired rows can't be consumed even before the reaper runs.
  expires_at timestamptz NOT NULL,

  -- PKCE / future provider-specific server-side metadata.
  -- Code verifier is the secret half — must NEVER be in the JWT (defeats the
  -- whole point of PKCE). Lives only in this row.
  pkce_code_verifier text,
  pkce_code_challenge_method text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for the reaper cron (DELETE WHERE expires_at <= now()). The PK on
-- nonce already covers the consume lookup.
CREATE INDEX oauth_states_expires_idx
  ON public.oauth_states (expires_at);

-- System-only table; no user-facing access. RLS enabled defense-in-depth so
-- a stolen anon key still gets nothing. Service-role bypasses RLS by design
-- for the dispatcher / repository.
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY oauth_states_no_client_access ON public.oauth_states
  FOR ALL USING (false) WITH CHECK (false);
