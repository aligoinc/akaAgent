-- V546: phần mềm akaAgent (Web / iOS / Desktop) đọc mã giới thiệu và mức hoa hồng của chính khách đang đăng nhập
-- (chương trình đối tác giới thiệu, bảng aff_* của CRM; 15/11/2026).
--
-- PHẢI chạy SAU migration CRM `20261115100000_aff_partner_program.sql` (SqlServerDashboard): preflight dừng nếu thiếu
-- public.aff_partner_overview / aff_program_settings / bảng aff_partners, aff_product_rates.
--
-- Chỉ thêm ba hàm mới, không sửa bảng, hàm hay dữ liệu cũ:
--   private.aka_agent_aff_partner_view(p_staff_id, p_create)                 lõi dùng chung, không cấp cho role ứng dụng nào;
--   public.aka_agent_control_aff_partner(p_staff_id, p_organization_id, p_create)  API Web gọi bằng service_role, tự kiểm
--                                                                           nhân viên thuộc đúng tổ chức của phiên;
--   public.aka_agent_aff_partner(p_create)                                   Desktop gọi bằng token aka_agent_desktop, nhân viên
--                                                                           lấy từ phiên (private.aka_agent_staff_scope_for_request()).
--
-- Kết quả (jsonb, khoá camelCase như aff_partner_overview):
--   {"enabled": false, "reason": "off" | "staff_inactive" | "not_in_audience" | "internal_staff" | "no_session"}
--   {"enabled": true, "audience": ..., "partner": null}                      chỉ khi p_create = false và khách chưa có mã
--   {"enabled": true, "audience": ..., "partner": {id, code, status, displayName, pageUrl, termsAcceptedAt, hasPayoutInfo,
--      firstReferralAt}, "stats": {visits, trials, purchased, commissionPending, commissionApproved, commissionPaid},
--    "program": {visitWindowDays, purchaseWindowDays, holdDays, minPayout, trialRewardMonthlyCap},
--    "defaultRate": {purchaseRate, trialReward},
--    "rates": [{productId, productName, purchaseRate, trialReward}],        sản phẩm đang bán; mức riêng của đối tác → sản phẩm → mặc định
--    "portalUrl": "https://crm.akabiz.net/gia-han/doi-tac"}
-- p_create = true cấp mã cho khách đủ điều kiện mà chưa có (một INSERT vào aff_partners); p_create = false chỉ đọc.
-- Chương trình tắt (`affiliate.program` audience = off) thì mọi lượt gọi trả {"enabled": false, "reason": "off"} sau một lượt
-- đọc cài đặt.
--
-- CREATE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v546_aff_partner_app.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v546_%') THEN
      RAISE EXCEPTION 'V546 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_aff_partner(boolean)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_control_aff_partner(bigint, bigint, boolean)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_aff_partner_view(bigint, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'V546: hàm aka_agent_*aff_partner* đã có';
  END IF;
  IF to_regprocedure('public.aff_partner_overview(bigint, boolean)') IS NULL
     OR to_regprocedure('public.aff_program_settings()') IS NULL
     OR to_regclass('public.aff_partners') IS NULL
     OR to_regclass('public.aff_product_rates') IS NULL THEN
    RAISE EXCEPTION 'V546: chưa có chương trình đối tác giới thiệu (chạy 20261115100000_aff_partner_program.sql của CRM trước)';
  END IF;
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN
    RAISE EXCEPTION 'V546: thiếu private.aka_agent_staff_scope_for_request()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'V546: thiếu role aka_agent_desktop hoặc service_role';
  END IF;
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.org_product'::regclass AND NOT attisdropped
         AND attname IN ('id', 'name', 'is_active', 'is_ngung_kinh_doanh', 'sort_order')) <> 5 THEN
    RAISE EXCEPTION 'V546: public.org_product thiếu cột id / name / is_active / is_ngung_kinh_doanh / sort_order';
  END IF;
END $pre$;

CREATE FUNCTION private.aka_agent_aff_partner_view(p_staff_id bigint, p_create boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_overview jsonb;
  v_settings jsonb;
  v_partner public.aff_partners%ROWTYPE;
  v_rate numeric;
  v_reward integer;
  v_rates jsonb;
  v_base text;
  -- Số trong cài đặt: thiếu, không phải số hoặc ngoài khoảng thì lấy mặc định (cùng quy tắc với parseAffProgramSettings của CRM).
  v_text text;
  v_visit integer := 90;
  v_purchase integer := 90;
  v_hold integer := 7;
  v_min_payout integer := 200000;
  v_cap integer := 30;
BEGIN
  IF p_staff_id IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'no_session');
  END IF;

  v_overview := public.aff_partner_overview(p_staff_id, COALESCE(p_create, false));
  IF v_overview IS NULL OR (v_overview ->> 'enabled') IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object('enabled', false, 'reason', COALESCE(v_overview ->> 'reason', 'off'));
  END IF;
  IF jsonb_typeof(v_overview -> 'partner') IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('enabled', true, 'audience', v_overview ->> 'audience', 'partner', NULL);
  END IF;

  v_settings := public.aff_program_settings();
  SELECT * INTO v_partner FROM public.aff_partners p WHERE p.id = (v_overview -> 'partner' ->> 'id')::bigint;

  v_rate := 0.1;
  v_text := v_settings ->> 'purchaseRate';
  IF v_text ~ '^[0-9]+(\.[0-9]+)?$' AND v_text::numeric BETWEEN 0 AND 1 THEN v_rate := v_text::numeric; END IF;
  v_reward := 20000;
  v_text := v_settings ->> 'trialReward';
  IF v_text ~ '^[0-9]{1,8}$' AND v_text::integer <= 10000000 THEN v_reward := v_text::integer; END IF;
  v_text := v_settings ->> 'visitWindowDays';
  IF v_text ~ '^[0-9]{1,3}$' AND v_text::integer BETWEEN 1 AND 365 THEN v_visit := v_text::integer; END IF;
  v_text := v_settings ->> 'purchaseWindowDays';
  IF v_text ~ '^[0-9]{1,3}$' AND v_text::integer BETWEEN 1 AND 365 THEN v_purchase := v_text::integer; END IF;
  v_text := v_settings ->> 'holdDays';
  IF v_text ~ '^[0-9]{1,2}$' AND v_text::integer <= 90 THEN v_hold := v_text::integer; END IF;
  v_text := v_settings ->> 'minPayout';
  IF v_text ~ '^[0-9]{1,9}$' AND v_text::integer <= 100000000 THEN v_min_payout := v_text::integer; END IF;
  v_text := v_settings ->> 'trialRewardMonthlyCap';
  IF v_text ~ '^[0-9]{1,4}$' AND v_text::integer <= 1000 THEN v_cap := v_text::integer; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'productId', p.id,
           'productName', p.name,
           'purchaseRate', LEAST(1, GREATEST(0, COALESCE(v_partner.purchase_rate, r.purchase_rate, v_rate))),
           'trialReward', GREATEST(0, COALESCE(v_partner.trial_reward, r.trial_reward, v_reward))
         ) ORDER BY p.sort_order NULLS LAST, p.id), '[]'::jsonb)
    INTO v_rates
    FROM public.org_product p
    LEFT JOIN public.aff_product_rates r ON r.org_product_id = p.id AND r.is_active
   WHERE COALESCE(p.is_active, true) AND NOT COALESCE(p.is_ngung_kinh_doanh, false);

  v_base := substring(COALESCE(v_overview -> 'partner' ->> 'pageUrl', '') FROM '^https://[^/]+');

  RETURN v_overview || jsonb_build_object(
    'program', jsonb_build_object(
      'visitWindowDays', v_visit,
      'purchaseWindowDays', v_purchase,
      'holdDays', v_hold,
      'minPayout', v_min_payout,
      'trialRewardMonthlyCap', v_cap
    ),
    'defaultRate', jsonb_build_object(
      'purchaseRate', LEAST(1, GREATEST(0, COALESCE(v_partner.purchase_rate, v_rate))),
      'trialReward', GREATEST(0, COALESCE(v_partner.trial_reward, v_reward))
    ),
    'rates', v_rates,
    'portalUrl', COALESCE(v_base, 'https://crm.akabiz.net') || '/gia-han/doi-tac'
  );
END;
$function$;

COMMENT ON FUNCTION private.aka_agent_aff_partner_view(bigint, boolean) IS
  'V546: mã giới thiệu, số liệu và mức hoa hồng theo sản phẩm của một org_staff (chương trình đối tác aff_*). Lõi của aka_agent_control_aff_partner và aka_agent_aff_partner; không cấp cho role ứng dụng.';

CREATE FUNCTION public.aka_agent_control_aff_partner(p_staff_id bigint, p_organization_id bigint, p_create boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '8s'
AS $function$
BEGIN
  -- API Web truyền nhân viên + tổ chức của phiên đã xác thực; lệch nhau thì coi như tài khoản không hợp lệ.
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.org_staff s WHERE s.id = p_staff_id AND s.organization_id = p_organization_id
     ) THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'staff_inactive');
  END IF;
  RETURN private.aka_agent_aff_partner_view(p_staff_id, p_create);
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_control_aff_partner(bigint, bigint, boolean) IS
  'V546: API Web/iOS đọc mã giới thiệu + mức hoa hồng của nhân viên đang đăng nhập (service_role). p_create = true cấp mã nếu chưa có.';

CREATE FUNCTION public.aka_agent_aff_partner(p_create boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '8s'
AS $function$
BEGIN
  -- Nhân viên lấy từ phiên Desktop; không có phiên (role khác, JWT không ánh xạ nhân viên) thì tắt.
  RETURN private.aka_agent_aff_partner_view(NULLIF(private.aka_agent_staff_scope_for_request(), 0), p_create);
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_aff_partner(boolean) IS
  'V546: Desktop đọc mã giới thiệu + mức hoa hồng của chính nhân viên trong phiên (aka_agent_desktop). p_create = true cấp mã nếu chưa có.';

REVOKE ALL ON FUNCTION private.aka_agent_aff_partner_view(bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_control_aff_partner(bigint, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_aff_partner(boolean) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_aff_partner_view(bigint, boolean) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_control_aff_partner(bigint, bigint, boolean) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_aff_partner(boolean) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_aff_partner(bigint, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_aff_partner(boolean) TO aka_agent_desktop;

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(rolname || ':' || fn, ', ' ORDER BY rolname, fn) INTO v_bad
    FROM pg_roles
    CROSS JOIN (VALUES
      ('private.aka_agent_aff_partner_view(bigint, boolean)', ARRAY[]::text[]),
      ('public.aka_agent_control_aff_partner(bigint, bigint, boolean)', ARRAY['service_role']),
      ('public.aka_agent_aff_partner(boolean)', ARRAY['aka_agent_desktop'])
    ) AS f(fn, allowed)
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, fn, 'EXECUTE') IS DISTINCT FROM (rolname = ANY (allowed));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V546 postflight: quyền gọi hàm sai: %', v_bad; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid IN ('private.aka_agent_aff_partner_view(bigint, boolean)'::regprocedure,
                   'public.aka_agent_control_aff_partner(bigint, bigint, boolean)'::regprocedure,
                   'public.aka_agent_aff_partner(boolean)'::regprocedure)
       AND NOT prosecdef
  ) THEN
    RAISE EXCEPTION 'V546 postflight: ba hàm phải SECURITY DEFINER';
  END IF;
  -- Ngoài phiên Desktop (role chạy migration) thì hàm Desktop phải trả "tắt", không cấp mã cho ai.
  IF (public.aka_agent_aff_partner(false) ->> 'enabled') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'V546 postflight: ngoài phiên Desktop phải trả enabled = false';
  END IF;
  IF (public.aka_agent_control_aff_partner(NULL, NULL, false) ->> 'reason') IS DISTINCT FROM 'staff_inactive' THEN
    RAISE EXCEPTION 'V546 postflight: thiếu nhân viên / tổ chức phải trả staff_inactive';
  END IF;
END $post$;

COMMIT;
