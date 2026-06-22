-- Add a nullable Zalo group link field for future link-sync mechanisms.
-- Current contact scans do not call Zalo link APIs; this column is only a
-- queryable/display field when another process populates it later.

BEGIN;

ALTER TABLE public.zalo_groups
  ADD COLUMN IF NOT EXISTS link text;

CREATE INDEX IF NOT EXISTS idx_zalo_groups_link
  ON public.zalo_groups(link)
  WHERE link IS NOT NULL;

COMMENT ON COLUMN public.zalo_groups.link IS
  'Nullable Zalo group invite/link field. Contact scan does not fetch it; future sync mechanisms may populate it.';

NOTIFY pgrst, 'reload schema';

COMMIT;
