-- New, isolated phone-check usage. No campaign counter, policy, or reset changes.
-- Live dependencies captured from akachat on 2026-10-16; never replace them.
DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auto_accounts' AND column_name='zalo_phone_check_usage')
    OR EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key='zalo.phone_check.daily_limit')
    OR EXISTS (SELECT 1 FROM cron.job WHERE jobname='zalo_phone_check_usage_reset_daily') THEN
    RAISE EXCEPTION 'phone_check_daily_limit_already_exists';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))) IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d'
    OR md5(pg_get_functiondef(to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)'))) IS DISTINCT FROM '46412e94cf00a788230835f6d56d8d3b' THEN
    RAISE EXCEPTION 'phone_check_identity_dependencies_changed';
  END IF;
  IF COALESCE(current_setting('cron.timezone', true),'') NOT IN ('GMT','UTC') THEN
    RAISE EXCEPTION 'phone_check_cron_timezone_changed';
  END IF;
END;
$preflight$;

ALTER TABLE public.auto_accounts ADD COLUMN zalo_phone_check_usage jsonb;
ALTER TABLE public.auto_accounts ADD CONSTRAINT auto_accounts_zalo_phone_check_usage_valid CHECK (
  zalo_phone_check_usage IS NULL OR (
    jsonb_typeof(zalo_phone_check_usage) = 'object'
    AND zalo_phone_check_usage ?& ARRAY['date','count']
    AND zalo_phone_check_usage - 'date' - 'count' = '{}'::jsonb
    AND jsonb_typeof(zalo_phone_check_usage->'date') = 'string'
    AND (zalo_phone_check_usage->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND (zalo_phone_check_usage->>'date')::date::text = zalo_phone_check_usage->>'date'
    AND jsonb_typeof(zalo_phone_check_usage->'count') = 'number'
    AND (zalo_phone_check_usage->>'count') ~ '^(0|[1-9][0-9]{0,9})$'
    AND (zalo_phone_check_usage->>'count')::numeric <= 2147483647
  )
);
COMMENT ON COLUMN public.auto_accounts.zalo_phone_check_usage IS
  'Only Kiểm tra SĐT có Zalo: {date: Vietnam YYYY-MM-DD, count: reserved lookup attempts}. NULL means unused. Independent of campaign quotas; no result history.';
INSERT INTO public.auto_system_settings(key,value,description,is_secret,is_active) VALUES (
  'zalo.phone_check.daily_limit','600',
  'Giới hạn lượt Kiểm tra SĐT có Zalo mỗi tài khoản/ngày Việt Nam. Số nguyên 1–2147483647, mặc định 600 nếu thiếu/sai/tắt. Mỗi lần tra cứu tính 1; fallback 32→40 không cộng thêm, thử lại tính lượt mới. Không tính chung quota chiến dịch.',false,true
);

-- SECURITY DEFINER is required to call the existing private-access identity
-- validator. Desktop must supply credentials; legacy Server must hold its live
-- account scan token, matching the existing Server data-scan auth contract.
CREATE FUNCTION public.aka_agent_zalo_phone_check_usage(
  p_staff_id bigint, p_organization_id bigint, p_account_id bigint,
  p_runtime_target text, p_claim_token uuid, p_consume boolean,
  p_auth_username text, p_auth_password text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_capabilities record;
  v_today date;
  v_count integer := 0;
  v_limit integer := 600;
  v_setting text;
  v_allowed boolean;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 OR p_consume IS NULL
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop','server') THEN
    RAISE EXCEPTION 'phone_check_identity_invalid';
  END IF;
  IF p_auth_username IS NOT NULL OR p_auth_password IS NOT NULL THEN
    PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  ELSIF p_runtime_target <> 'server' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'phone_check_auth_required';
  END IF;
  -- Preserve the existing scan lock order: staff, entitlement barrier, account.
  PERFORM 1 FROM public.org_staff s WHERE s.id=p_staff_id AND s.organization_id=p_organization_id
    AND s.is_active=true AND public.aka_agent_staff_time_allowed(s.id) FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'phone_check_staff_invalid'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  SELECT * INTO v_capabilities FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);
  IF p_consume OR p_auth_username IS NULL THEN
    SELECT * INTO v_account FROM public.auto_accounts a
      WHERE a.id=p_account_id AND a.staff_id=p_staff_id
        AND (a.organization_id IS NULL OR a.organization_id=p_organization_id) FOR UPDATE OF a;
  ELSE
    SELECT * INTO v_account FROM public.auto_accounts a
      WHERE a.id=p_account_id AND a.staff_id=p_staff_id
        AND (a.organization_id IS NULL OR a.organization_id=p_organization_id);
  END IF;
  IF NOT FOUND OR COALESCE(v_account.is_delete,false)
    OR lower(btrim(COALESCE(v_account.flatform_type,''))) <> 'zalo' THEN
    RAISE EXCEPTION 'phone_check_account_invalid';
  END IF;
  IF (p_runtime_target='server' AND (v_account.is_zalo_server IS NOT TRUE OR v_account.is_zalo_show_web IS TRUE
      OR NOT COALESCE(v_capabilities.qr_enabled,false) OR NOT COALESCE(v_capabilities.server_enabled,false)))
    OR (p_runtime_target='desktop' AND (v_account.is_zalo_server IS TRUE
      OR (v_account.is_zalo_show_web IS TRUE AND NOT COALESCE(v_capabilities.web_enabled,false))
      OR (v_account.is_zalo_show_web IS NOT TRUE AND NOT COALESCE(v_capabilities.qr_enabled,false)))) THEN
    RAISE EXCEPTION 'phone_check_runtime_not_owner';
  END IF;
  IF (p_consume OR p_auth_username IS NULL) AND (p_claim_token IS NULL
    OR v_account.runtime_operation_claim_token IS DISTINCT FROM p_claim_token
    OR v_account.status IS DISTINCT FROM 'đang chạy'
    OR v_account.is_active IS NOT TRUE OR v_account.login_status IS DISTINCT FROM 'đã đăng nhập') THEN
    RAISE EXCEPTION 'phone_check_claim_invalid';
  END IF;
  -- Compute after acquiring the row lock, including a wait across midnight.
  v_today := timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
  IF (v_account.zalo_phone_check_usage->>'date')::date > v_today THEN
    RAISE EXCEPTION 'phone_check_usage_date_in_future';
  END IF;
  IF v_account.zalo_phone_check_usage->>'date' = v_today::text THEN
    v_count := (v_account.zalo_phone_check_usage->>'count')::integer;
  END IF;
  SELECT value INTO v_setting FROM public.auto_system_settings
    WHERE key='zalo.phone_check.daily_limit' AND is_active=true AND is_secret=false;
  IF v_setting ~ '^[1-9][0-9]{0,9}$' AND v_setting::numeric <= 2147483647 THEN
    v_limit := v_setting::integer;
  END IF;
  v_allowed := v_count < v_limit;
  IF p_consume AND v_allowed THEN
    v_count := v_count+1;
    UPDATE public.auto_accounts SET zalo_phone_check_usage=jsonb_build_object('date',v_today,'count',v_count)
      WHERE id=p_account_id;
  END IF;
  RETURN jsonb_build_object('allowed',v_allowed,'date',v_today,'count',v_count,'limit',v_limit,
    'remaining',greatest(0,v_limit-v_count),
    'resetAt',((v_today+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'));
END;
$function$;
ALTER FUNCTION public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text) TO anon,authenticated,service_role;

-- Only nonzero stale usage is written. The predicate is rechecked under the
-- row lock, so a late cron cannot erase a reservation already made today.
SELECT cron.schedule('zalo_phone_check_usage_reset_daily','0 17 * * *',$cron$
UPDATE public.auto_accounts
SET zalo_phone_check_usage=jsonb_build_object('date',timezone('Asia/Ho_Chi_Minh',statement_timestamp())::date,'count',0)
WHERE zalo_phone_check_usage->>'date' < timezone('Asia/Ho_Chi_Minh',statement_timestamp())::date::text
  AND (zalo_phone_check_usage->>'count')::integer > 0;
$cron$);
NOTIFY pgrst, 'reload schema';
