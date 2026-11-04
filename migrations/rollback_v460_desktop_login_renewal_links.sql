-- Rollback V460: đưa public.aka_agent_desktop_login_content() về đúng bản live trước V460
-- (md5 997f54ddf67f808a1b3ac47596981036). Chỉ chạy khi hàm đang là bản V460 (md5 8ac766131b581f03fcf21faf31809356).
-- Hai row link đã seed chỉ bị xoá khi giá trị còn nguyên như lúc seed; row đã được chỉnh tay giữ lại
-- (hàm cũ không đọc 2 key này nên Desktop dùng link mặc định).
-- CREATE OR REPLACE làm PostgREST nạp lại schema khi COMMIT: chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_desktop_login_content()');
  IF NOT FOUND
    OR md5(pg_get_functiondef(f.oid)) NOT IN ('8ac766131b581f03fcf21faf31809356', '997f54ddf67f808a1b3ac47596981036')
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,service_role=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
    RAISE EXCEPTION 'login_content_v460_rollback_preflight_drift';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_desktop_login_content()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'key',key,'value',value,'updated_at',updated_at) ORDER BY key),'[]'::jsonb)
  FROM public.auto_system_settings
  WHERE key IN ('app.notification','akabiz.links.website','akabiz.links.user_guide',
    'akabiz.links.upgrade_payment','akabiz.links.contact_us')
    AND is_active=true AND is_secret=false;
$function$;

DELETE FROM public.auto_system_settings
WHERE (key, value) IN (
  ('akabiz.links.recover_account', 'https://crm.akabiz.net/gia-han/lay-lai-tai-khoan'),
  ('akabiz.links.trial_signup', 'https://crm.akabiz.net/gia-han/dang-ky-dung-thu')
);

DO $postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_desktop_login_content()');
  IF NOT FOUND
    OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '997f54ddf67f808a1b3ac47596981036'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,service_role=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'login_content_v460_rollback_postflight_drift';
  END IF;
END
$postflight$;

COMMIT;
