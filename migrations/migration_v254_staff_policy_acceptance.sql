-- Require every akaAgent staff user to explicitly accept the current policy
-- before a new desktop session is finalized.
ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS is_policy_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS policy_accepted_at timestamptz;

COMMENT ON COLUMN public.org_staff.is_policy_accepted IS
  'Source-of-truth flag set true after the staff user explicitly accepts the akaBiz usage policy during akaAgent login.';

COMMENT ON COLUMN public.org_staff.policy_accepted_at IS
  'Most recent timestamp at which the staff user explicitly accepted the akaBiz usage policy.';

-- Keep the boolean independently resettable from Supabase Table Editor.
ALTER TABLE public.org_staff
  DROP CONSTRAINT IF EXISTS org_staff_policy_acceptance_consistent;
