-- Facebook renders the "Tìm kiếm nhóm" field in the group-share dialog as
-- role="combobox" (not role="textbox"). Keep the selector specific enough to
-- avoid matching the global Facebook search input.

BEGIN;

INSERT INTO public.auto_elements (
  name,
  xpath,
  description,
  category,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES (
  'SearchAddGroupToPostInp',
  '//input[@role=''combobox'' and @type=''search'' and @aria-label=''Tìm kiếm nhóm'']',
  'Ô tìm group trong popup Thêm nhóm',
  'facebook',
  true,
  NULL,
  NULL,
  now()
)
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

COMMIT;
