-- Facebook may shorten the group invite dialog aria-label while retaining the
-- "Mời" prefix. Match the stable portion of the label.

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
  'fb_group_invite_dialog',
  '//*[@role=''dialog'' and contains(@aria-label,''Mời'')]',
  'Dialog mời vào group Facebook, nhận diện theo phần ổn định của aria-label.',
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
