-- ============================================================
-- Migration v17: Clean cached Facebook group contact names
-- - Old group scraper saved activity text inside auto_account_contacts.name.
-- - Keep that activity text in extra_data.lastActivityText and leave name clean.
-- ============================================================

BEGIN;

UPDATE public.auto_account_contacts
SET
  extra_data = coalesce(extra_data, '{}'::jsonb) || jsonb_build_object(
    'lastActivityText',
    btrim(substring(name from '((Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*)$'))
  ),
  name = btrim(regexp_replace(
    name,
    '\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$',
    '',
    'i'
  )),
  updated_at = now()
WHERE contact_type = 'group'
  AND name ~* '(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)'
  AND btrim(regexp_replace(
    name,
    '\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$',
    '',
    'i'
  )) <> '';

NOTIFY pgrst, 'reload schema';

COMMIT;
