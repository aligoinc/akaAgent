-- Staff-scoped content-template workspace for akaAgent.
-- The CRM continues using the same tables with staff_id/organization_id left NULL.

BEGIN;

ALTER TABLE public.auto_content_groups
  ADD COLUMN IF NOT EXISTS staff_id bigint,
  ADD COLUMN IF NOT EXISTS organization_id bigint,
  ADD COLUMN IF NOT EXISTS is_delete boolean NOT NULL DEFAULT false;

ALTER TABLE public.auto_content_templates
  ADD COLUMN IF NOT EXISTS base_content_html text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.auto_content_groups'::regclass
      AND conname = 'auto_content_groups_staff_id_fkey'
  ) THEN
    ALTER TABLE public.auto_content_groups
      ADD CONSTRAINT auto_content_groups_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES public.org_staff(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.auto_content_groups'::regclass
      AND conname = 'auto_content_groups_organization_id_fkey'
  ) THEN
    ALTER TABLE public.auto_content_groups
      ADD CONSTRAINT auto_content_groups_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.org_organization(id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS auto_content_groups_staff_active_idx
  ON public.auto_content_groups (staff_id, is_delete, is_active, stt, name)
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_content_groups_staff_name_active
  ON public.auto_content_groups (staff_id, lower(btrim(name)))
  WHERE staff_id IS NOT NULL AND is_delete = false;

INSERT INTO public.aka_crm_status AS existing_status (
  type,
  stt_by_type,
  name,
  description,
  is_active
)
SELECT
  'content_type',
  COALESCE(MAX(stt_by_type), 0) + 1,
  'email',
  'Gửi Email',
  true
FROM public.aka_crm_status
WHERE type = 'content_type'
ON CONFLICT (type, name) DO UPDATE
SET description = CASE
      WHEN btrim(COALESCE(existing_status.description, '')) = '' THEN EXCLUDED.description
      ELSE existing_status.description
    END,
    is_active = true,
    updated_at = now();

COMMENT ON COLUMN public.auto_content_groups.staff_id IS
  'akaAgent owner. NULL rows remain CRM-managed shared groups.';

COMMENT ON COLUMN public.auto_content_groups.organization_id IS
  'akaAgent organization owner. NULL rows remain CRM-managed shared groups.';

COMMENT ON COLUMN public.auto_content_groups.is_delete IS
  'Soft-delete flag used by akaAgent; CRM rows remain false.';

COMMENT ON COLUMN public.auto_content_templates.base_content_html IS
  'Sanitized rich base content for new apps; content remains the plain-text fallback for older apps.';

COMMIT;
