-- ChainReactV2 — integrations table.
-- Per docs/rules/database-security.md: RLS enabled with policies in this same
-- migration. Tokens are application-layer AES-256-GCM encrypted BEFORE being
-- written to the *_encrypted columns. RLS is defense-in-depth; encryption is
-- the primary control.
--
-- Per docs/rules/oauth-dispatcher.md: a row is keyed by
--   (user_id, provider, provider_account_id)
-- to support multi-account-per-provider (e.g., a user with two Slack workspaces
-- has two rows). Disconnected rows retain their FK shape but null tokens.

CREATE TABLE public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  provider text NOT NULL,                       -- e.g., 'slack', 'gmail'
  provider_account_id text NOT NULL,            -- e.g., Slack team_id; multi-account discriminator
  display_name text,                            -- e.g., 'Acme Slack workspace'

  -- Encrypted at the application layer; never store plaintext here.
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text,                 -- nullable for non-refreshable providers (Slack default v2, Discord, GitHub Apps)
  access_token_expires_at timestamptz,

  scopes text[] NOT NULL DEFAULT '{}',          -- granted scopes from the provider
  account_metadata jsonb NOT NULL DEFAULT '{}', -- provider-specific (workspace name, region, etc.)

  disconnected_at timestamptz,                  -- soft-disconnect; row preserved for connect history

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active integration per (user, provider, account). Soft-disconnected rows
-- don't block re-connecting because the predicate excludes them.
CREATE UNIQUE INDEX integrations_active_unique
  ON public.integrations (user_id, provider, provider_account_id)
  WHERE disconnected_at IS NULL;

-- Index for the common health-engine / disconnect scan.
CREATE INDEX integrations_provider_idx ON public.integrations (provider) WHERE disconnected_at IS NULL;

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY integrations_select_own ON public.integrations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY integrations_insert_own ON public.integrations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY integrations_update_own ON public.integrations
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY integrations_delete_own ON public.integrations
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER integrations_set_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
