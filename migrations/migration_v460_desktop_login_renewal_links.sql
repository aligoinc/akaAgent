-- V460: màn đăng nhập Desktop đọc thêm 2 link công khai của cổng gia hạn CRM
-- (`akabiz.links.recover_account` = Lấy lại tài khoản, `akabiz.links.trial_signup` = Đăng ký dùng thử).
-- Dựng từ live capture 04/11/2026 của public.aka_agent_desktop_login_content()
-- (md5 997f54ddf67f808a1b3ac47596981036, owner postgres, SECURITY DEFINER, STABLE,
-- search_path=pg_catalog, ACL postgres/anon/service_role). Chỉ thêm 2 key vào danh sách đọc;
-- giữ nguyên bộ lọc is_active/is_secret, quyền, owner và cấu hình hàm.
-- Không đổi bảng, policy, quyền hay connection. CREATE OR REPLACE làm PostgREST nạp lại
-- schema khi COMMIT: chỉ apply ngoài giờ cao điểm (14–16h VN).
-- Desktop có link mặc định nên chưa apply vẫn hoạt động; migration này cho phép đổi link không cần phát hành app.
-- Rollback: migrations/rollback_v460_desktop_login_renewal_links.sql.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_desktop_login_content()');
  IF NOT FOUND
    OR md5(pg_get_functiondef(f.oid)) NOT IN ('997f54ddf67f808a1b3ac47596981036', '8ac766131b581f03fcf21faf31809356')
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,service_role=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
    RAISE EXCEPTION 'login_content_v460_preflight_drift';
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
    'akabiz.links.upgrade_payment','akabiz.links.contact_us',
    'akabiz.links.recover_account','akabiz.links.trial_signup')
    AND is_active=true AND is_secret=false;
$function$;

-- Seed 2 link; giữ nguyên row đã có (có thể đã được quản trị chỉnh tay).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT v.key, v.value, v.description, false, true
FROM (VALUES
  ('akabiz.links.recover_account', 'https://crm.akabiz.net/gia-han/lay-lai-tai-khoan',
   'Màn đăng nhập akaAgent: link Lấy lại tài khoản (cổng gia hạn CRM). Để trống hoặc tắt để dùng link mặc định của app.'),
  ('akabiz.links.trial_signup', 'https://crm.akabiz.net/gia-han/dang-ky-dung-thu',
   'Màn đăng nhập akaAgent: link Đăng ký dùng thử (cổng gia hạn CRM). Để trống hoặc tắt để dùng link mặc định của app.')
) AS v(key, value, description)
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings s WHERE s.key = v.key);

DO $postflight$
DECLARE f pg_proc%ROWTYPE; keys text[];
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_desktop_login_content()');
  IF NOT FOUND
    OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8ac766131b581f03fcf21faf31809356'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,service_role=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
    RAISE EXCEPTION 'login_content_v460_postflight_drift';
  END IF;
  SELECT coalesce(array_agg(e->>'key' ORDER BY e->>'key'), '{}') INTO keys
  FROM jsonb_array_elements(public.aka_agent_desktop_login_content()) e;
  -- Chỉ trả key trong danh sách; row mới còn bật thì phải được trả về.
  IF NOT (keys <@ ARRAY['app.notification','akabiz.links.website','akabiz.links.user_guide','akabiz.links.upgrade_payment',
      'akabiz.links.contact_us','akabiz.links.recover_account','akabiz.links.trial_signup'])
    OR EXISTS (SELECT 1 FROM public.auto_system_settings s
      WHERE s.key IN ('akabiz.links.recover_account','akabiz.links.trial_signup')
        AND s.is_active AND NOT s.is_secret AND NOT s.key = ANY(keys)) THEN
    RAISE EXCEPTION 'login_content_v460_postflight_keys: %', keys;
  END IF;
END
$postflight$;

COMMIT;
