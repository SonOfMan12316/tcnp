-- Restore least-privilege profile reads for authenticated sessions.
-- RLS still limits the added SELECT grant to rows allowed by policy.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;

DROP POLICY IF EXISTS users_select_own_profile ON public.users;
CREATE POLICY users_select_own_profile
  ON public.users
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);
