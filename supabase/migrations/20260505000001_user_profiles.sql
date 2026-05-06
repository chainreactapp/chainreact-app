-- ChainReactV2 — user_profiles table.
-- Per docs/rules/database-security.md: RLS enabled + policies declared in the
-- same migration that creates the table. Profiles auto-create on auth signup
-- via the on_auth_user_created trigger (SECURITY DEFINER); they cascade-delete
-- with their auth.users row.

CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- A user may read their own profile.
CREATE POLICY user_profiles_select_own ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

-- A user may update their own profile.
CREATE POLICY user_profiles_update_own ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- INSERT and DELETE policies are deliberately omitted:
--   - INSERT happens only via the SECURITY DEFINER trigger below.
--   - DELETE happens only via ON DELETE CASCADE from auth.users.

CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create a user_profiles row when a new auth.users row is inserted.
-- SECURITY DEFINER is justified: regular users cannot insert into auth.users;
-- only Supabase Auth can. The trigger runs with the function-owner's
-- privileges so the INSERT into public.user_profiles succeeds despite RLS.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
