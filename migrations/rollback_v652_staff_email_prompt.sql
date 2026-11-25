-- Gỡ V652 (form xin email + email_list). Chạy ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema).
-- Gỡ cả cột email_list nghĩa là mất danh sách email đã ghi (email hiện tại ở cột email không bị đụng).
-- Email khách đã lưu qua form vẫn nằm ở org_staff / org_organization / aka_customer.email.
-- Muốn chỉ tắt form thì không cần gỡ: đặt auto_system_settings 'account.email_prompt' = {"audience":"off"}.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.aka_agent_email_prompt_worker(text, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_control_email_prompt(bigint, bigint, text, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_email_prompt(text, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_email_prompt_core(bigint, text, jsonb);
DROP FUNCTION IF EXISTS private.aka_staff_email_usable(text, text);
DROP FUNCTION IF EXISTS private.aka_staff_email_typo_fix(text);
DROP TABLE IF EXISTS private.aka_staff_email_prompt;
DELETE FROM public.auto_system_settings WHERE key = 'account.email_prompt';

DROP TRIGGER IF EXISTS trg_email_list_track ON public.org_staff;
DROP TRIGGER IF EXISTS trg_email_list_track ON public.org_organization;
DROP TRIGGER IF EXISTS trg_email_list_track ON public.aka_customer;
DROP FUNCTION IF EXISTS private.track_email_list();
ALTER TABLE public.org_staff        DROP COLUMN IF EXISTS email_list;
ALTER TABLE public.org_organization DROP COLUMN IF EXISTS email_list;
ALTER TABLE public.aka_customer     DROP COLUMN IF EXISTS email_list;

COMMIT;
