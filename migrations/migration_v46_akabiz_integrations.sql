-- Store external akaBiz SMS/Zalo Web integrations per desktop staff account.

ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS akabiz_integrations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.org_staff.akabiz_integrations IS
  'External akaBiz integrations for desktop automation, e.g. sms/zaloWeb staff ids resolved by akaBizApi.';
