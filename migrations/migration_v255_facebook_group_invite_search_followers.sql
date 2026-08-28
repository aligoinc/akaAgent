-- Facebook can label the group invite search field as either "Tìm bạn bè"
-- or "Chọn người theo dõi", depending on the group invite experience.

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
  'fb_group_invite_search_input',
  '//*[@role=''dialog'']//input[@type=''text'' and (contains(@placeholder,''Tìm bạn bè'') or contains(@placeholder,''Chọn người theo dõi''))]',
  'Input tìm bạn bè hoặc chọn người theo dõi trong dialog mời vào group Facebook.',
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
