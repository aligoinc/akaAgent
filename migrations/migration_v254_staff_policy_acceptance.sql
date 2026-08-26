-- Require every akaAgent staff user to explicitly accept the current policy
-- before a new desktop session is finalized.
ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS is_policy_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS policy_accepted_at timestamptz;

COMMENT ON COLUMN public.org_staff.is_policy_accepted IS
  'True only after the staff user explicitly accepts the akaBiz usage policy during akaAgent login.';

COMMENT ON COLUMN public.org_staff.policy_accepted_at IS
  'First timestamp at which the staff user explicitly accepted the akaBiz usage policy.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.org_staff'::regclass
      AND conname = 'org_staff_policy_acceptance_consistent'
  ) THEN
    ALTER TABLE public.org_staff
      ADD CONSTRAINT org_staff_policy_acceptance_consistent
      CHECK (
        (is_policy_accepted = false AND policy_accepted_at IS NULL)
        OR
        (is_policy_accepted = true AND policy_accepted_at IS NOT NULL)
      );
  END IF;
END
$$;
