-- UI-only seed for Facebook - Tìm kiếm data bằng search.
-- Workflow/runtime blocks are intentionally not seeded in this migration.

BEGIN;

INSERT INTO public.auto_campaign_actions (
  id,
  name,
  flatform_type,
  is_active,
  workflow_id,
  limit_check_action_codes,
  is_delete,
  created_at
)
VALUES (
  'facebook_find_data_search',
  'Facebook - Tìm kiếm data bằng search',
  'facebook',
  true,
  NULL,
  '{}'::text[],
  false,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = true,
  workflow_id = COALESCE(auto_campaign_actions.workflow_id, EXCLUDED.workflow_id),
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

NOTIFY pgrst, 'reload schema';

COMMIT;
