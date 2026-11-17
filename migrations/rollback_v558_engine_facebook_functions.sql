-- Gỡ V558: trả 6 hàm engine về bản production 16/11/2026 (trước V558). SINH TỪ scripts/build-v558-sql.cjs.
-- Lượt theo lịch / chính sách inherit đã ghi vẫn còn trong bảng; gỡ V559 (chính sách FB) trước nếu muốn bỏ hẳn.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V558: không có public.aka_agent_engine_claim_target_v1(jsonb)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'f8ae40ad89e10800c79e02b4c1a53a30' THEN RAISE EXCEPTION 'Gỡ V558: hàm đã là bản trước V558 (claim)'; END IF;
  IF v_md5 IS DISTINCT FROM '7ddfa216286849296e6b537c120e291d' THEN RAISE EXCEPTION 'Gỡ V558: định nghĩa không phải bản V558 (claim: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v558_acl_claim', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_action_limit(bigint,bigint,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V558: không có public.aka_agent_engine_action_limit(bigint,bigint,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'c5f111aa29b900b203002561af91d7da' THEN RAISE EXCEPTION 'Gỡ V558: hàm đã là bản trước V558 (limit)'; END IF;
  IF v_md5 IS DISTINCT FROM '5c7e8c79040723a3c6f21f7565d58d81' THEN RAISE EXCEPTION 'Gỡ V558: định nghĩa không phải bản V558 (limit: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v558_acl_limit', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_resolve_policy(text,bigint,text,text,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V558: không có public.aka_agent_engine_resolve_policy(text,bigint,text,text,text,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '64738ead899b8ba0a950ff0611345c14' THEN RAISE EXCEPTION 'Gỡ V558: hàm đã là bản trước V558 (resolve)'; END IF;
  IF v_md5 IS DISTINCT FROM 'a7c79e276426154098c5beff8cfd580e' THEN RAISE EXCEPTION 'Gỡ V558: định nghĩa không phải bản V558 (resolve: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v558_acl_resolve', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V558: không có public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'bc39ed663474fefd61de0d8c20454168' THEN RAISE EXCEPTION 'Gỡ V558: hàm đã là bản trước V558 (report)'; END IF;
  IF v_md5 IS DISTINCT FROM 'bb8bc00f9d2a8c51a00dcb525fa2e4ab' THEN RAISE EXCEPTION 'Gỡ V558: định nghĩa không phải bản V558 (report: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v558_acl_report', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_simulate_v1(text,text,jsonb)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V558: không có public.aka_agent_engine_simulate_v1(text,text,jsonb)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '52d97c4c33ad864896a377f4c9d656b5' THEN RAISE EXCEPTION 'Gỡ V558: hàm đã là bản trước V558 (simulate)'; END IF;
  IF v_md5 IS DISTINCT FROM 'de54bae78c002b33d04fdd3c9079aad2' THEN RAISE EXCEPTION 'Gỡ V558: định nghĩa không phải bản V558 (simulate: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v558_acl_simulate', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V558: không có public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '465814c236ca1de74228a6d402b9f9f4' THEN RAISE EXCEPTION 'Gỡ V558: hàm đã là bản trước V558 (finish)'; END IF;
  IF v_md5 IS DISTINCT FROM 'ffccdf1f6d95d6ed877c22abe945ae0b' THEN RAISE EXCEPTION 'Gỡ V558: định nghĩa không phải bản V558 (finish: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v558_acl_finish', v_acl, true);
END $pre$;

-- Hàm trước V558 không hiểu detail_mode = inherit / streak_after_delivery: còn chính sách dùng hai thứ này (V559) thì gỡ V559 trước.
DO $inherit$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE is_active AND NOT is_delete
               AND (detail_mode = 'inherit' OR streak_after_delivery IS NOT NULL)) THEN
    RAISE EXCEPTION 'Gỡ V558: còn chính sách dùng detail_mode inherit / streak_after_delivery, gỡ V559 (rollback_v559_engine_facebook_policies.sql) trước';
  END IF;
END $inherit$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_staff bigint := nullif(p_ctx->>'staffId', '')::bigint;
  v_account_id bigint := nullif(p_ctx->>'accountId', '')::bigint;
  v_campaign_id bigint := nullif(p_ctx->>'campaignId', '')::bigint;
  v_runner text := nullif(btrim(p_ctx->>'runnerId'), '');
  v_runtime text := p_ctx->>'runtimeTarget';
  v_req_token uuid := nullif(p_ctx->>'leaseToken', '')::uuid;
  v_lease_seconds integer := greatest(30, public.aka_agent_engine_setting('engine.lease_seconds', '180')::integer);
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  l public.auto_engine_leases%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_has_lease boolean;
  v_token uuid;
  v_run_id bigint;
  v_act jsonb;
  v_code text;
  v_required boolean;
  v_decision jsonb;
  v_decisions jsonb := '{}'::jsonb;
  v_target_wait jsonb;
  v_target_key text;
  v_lock record;
  v_limit jsonb;
  v_daily numeric;
  v_window_count numeric;
  v_window_minutes numeric;
  v_used integer;
  v_oldest timestamptz;
  v_allowed boolean;
  v_boundary text;
  v_org bigint;
  v_cap_qr boolean;
  v_cap_web boolean;
  v_cap_server boolean;
  v_max integer;
  v_running bigint;
  v_day_start timestamptz := ((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_wait_note text;
  v_found boolean := false;
  v_cooldown boolean;
  v_cd_decision text;
  v_cd_note text;
  v_cd_error text;
  v_cd_paused jsonb := '[]'::jsonb;
  v_cd_skip bigint[] := '{}';
  v_cd_scanned integer := 0;
  v_dg_result jsonb;
  v_cd_deadline timestamptz;
  v_legacy_setting text;
  v_legacy_before timestamptz;
BEGIN
  IF v_staff IS NULL OR v_account_id IS NULL OR v_campaign_id IS NULL OR v_runner IS NULL OR v_runtime IS NULL OR v_runtime NOT IN ('desktop','fly') THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  -- Desktop chỉ nhận việc của chính nhân viên đăng nhập, và chỉ với vai trò Desktop.
  IF public.aka_agent_engine_desktop_staff() IS NOT NULL AND v_runtime <> 'desktop' THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  IF NOT public.aka_agent_engine_scope_ok(v_staff) THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  -- V501 (review 12/11): khoá tư vấn trước khoá dòng, đúng thứ tự của bản cũ. Chiến dịch Nhóm data: khoá nạp data của chiến dịch
  -- (cùng khoá với aka_agent_lock_campaign_input_serialization; luồng nạp Nhóm data, hàm kết thúc v219 và finish_campaign_v2 lấy
  -- khoá này trước khoá dòng chiến dịch), vì nhánh hết hạn bên dưới gọi hàm kết thúc v219.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = v_campaign_id AND x.data_target_source_mode = 'data_group') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  END IF;
  -- Tài khoản Zalo (trình duyệt) bắt đầu lượt trên Desktop: khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397), để
  -- hai lượt nhận cùng lúc (của bộ mới hay bộ cũ) không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo'
                   AND coalesce(xa.is_zalo_show_web, false) AND NOT coalesce(xa.is_zalo_server, false)) THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.is_delete, false) OR c.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF c.account_id IS DISTINCT FROM v_account_id THEN RETURN jsonb_build_object('status', 'account_mismatch'); END IF;

  -- Không có công tắc theo loại chiến dịch: bộ chạy chỉ gọi claim cho loại mà lõi đã phủ.
  -- Desktop bản mới tự chạy bộ mới; Fly chỉ chạy bộ mới cho tổ chức bật cờ use_new_zalo_runtime (V371).
  IF v_runtime = 'fly'
     AND NOT coalesce((SELECT o.use_new_zalo_runtime FROM public.org_organization o WHERE o.id = c.organization_id), false) THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;

  SELECT * INTO a FROM public.auto_accounts WHERE id = v_account_id FOR UPDATE;
  IF NOT FOUND OR coalesce(a.is_delete, false) OR a.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'account_not_found');
  END IF;
  -- Bộ cũ còn giữ tài khoản (token thao tác) hoặc một chiến dịch của tài khoản (claim token, unit lease):
  -- chờ, không chạy chồng. Bộ mới không bao giờ dùng hay xoá các token này.
  IF a.runtime_operation_claim_token IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'account');
  END IF;
  -- V527: claim token bộ cũ còn sót trên chiến dịch đã xoá / tạm dừng không chặn tài khoản nữa. Trigger
  -- aka_agent_clear_campaign_runtime_claim_metadata cố ý giữ claim khi chiến dịch Server chuyển "đang chạy" → "tạm dừng" (chờ nơi chạy tự
  -- nhả) và App Server nhả tài khoản mà không xoá claim đó, nên claim treo hàng tháng. Chỉ bỏ qua khi đủ cả: tài khoản không còn token
  -- thao tác (kiểm ở trên), chiến dịch không giữ unit lease, không còn data "đang chạy", và cả lúc claim lẫn lần ghi cuối của chiến dịch
  -- (lúc tạm dừng / xoá) đã cũ hơn engine.legacy_stale_claim_minutes phút (mặc định 30, tối thiểu 10). Unit lease,
  -- claim trên chiến dịch chờ / đang chạy và chiến dịch vừa tạm dừng giữa lượt vẫn chặn. Không xoá token nào ở đây.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    v_legacy_setting := btrim(public.aka_agent_engine_setting('engine.legacy_stale_claim_minutes', '30'));
    v_legacy_before := v_now - make_interval(mins => CASE WHEN v_legacy_setting ~ '^[0-9]{1,6}$'
                                                         THEN greatest(10, v_legacy_setting::integer) ELSE 30 END);
    IF EXISTS (SELECT 1 FROM public.auto_campaigns x
                WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                  AND NOT (x.runtime_unit_token IS NULL
                           AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                           AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < v_legacy_before
                           AND coalesce(x.updated_at, '-infinity'::timestamptz) < v_legacy_before
                           AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                            WHERE d.campaign_id = x.id AND d.status = 'đang chạy'
                                              AND coalesce(d.is_delete, false) = false))) THEN
      RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'campaign');
    END IF;
  END IF;
  -- Cùng điều kiện nhận lượt của bản cũ (aka_agent_claim_campaign_run_unit_v2): đúng runtime sở hữu
  -- tài khoản, tài khoản còn bật và đã đăng nhập, quyền dùng app, khung giờ cho phép của nhân viên.
  IF (v_runtime = 'fly' AND (lower(btrim(coalesce(a.flatform_type, ''))) <> 'zalo' OR coalesce(a.is_zalo_show_web, false)
                              OR NOT coalesce(a.is_zalo_server, false)))
     OR (v_runtime = 'desktop' AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND coalesce(a.is_zalo_server, false)) THEN
    RETURN jsonb_build_object('status', 'runtime_not_owner');
  END IF;
  IF a.is_active IS NOT TRUE OR a.login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN jsonb_build_object('status', 'account_logged_out', 'loginStatus', a.login_status);
  END IF;
  -- V501 (G7): tài khoản tạm dừng (hay trạng thái khác "chờ xử lý"/"đang chạy") không nhận lượt, như bản cũ. "đang chạy" mà
  -- không còn ai giữ (bộ cũ đã kiểm ở trên bằng token, bộ mới bằng lease bên dưới) là sót lại sau khi app/worker tắt đột ngột.
  IF coalesce(a.status, 'chờ xử lý') NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'account_paused', 'accountStatus', a.status);
  END IF;
  -- Hai hàm có sẵn trên production gọi qua EXECUTE: PL/pgSQL phân giải tên hàm khi lập kế hoạch biểu thức.
  IF to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_app_access_account_allowed($1, $2)' INTO v_allowed USING v_account_id, 'akaAgent';
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'app_access_denied', 'reason', 'app_access_account'); END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_staff_time_allowed($1)' INTO v_allowed USING v_staff;
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'staff_time_blocked'); END IF;
  END IF;
  -- V501: quyền gói Zalo của tổ chức như claim của bản cũ (aka_agent_claim_campaign_runtime_checked): Server cần QR + Server,
  -- tài khoản trình duyệt cần Web, tài khoản QR cần QR.
  v_org := coalesce(c.organization_id, a.organization_id);
  IF lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND v_org IS NOT NULL
     AND to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT x.qr_enabled, x.web_enabled, x.server_enabled FROM public.resolve_organization_zalo_account_capabilities($1) x'
      INTO v_cap_qr, v_cap_web, v_cap_server USING v_org;
    IF (coalesce(a.is_zalo_server, false) AND NOT (coalesce(v_cap_qr, false) AND coalesce(v_cap_server, false)))
       OR (NOT coalesce(a.is_zalo_server, false) AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_web, false))
       OR (NOT coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_qr, false)) THEN
      RETURN jsonb_build_object('status', 'entitlement_denied');
    END IF;
  END IF;
  -- V501 (G10): giới hạn số tài khoản Zalo (trình duyệt) chạy đồng thời của nhân viên, đếm như bản cũ (v397). Chỉ khi bắt đầu
  -- lượt (chưa giữ lease): lượt đang chạy không bị cắt giữa chừng.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
     AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(a.is_zalo_server, false)
     AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo' AND xa.is_zalo_show_web = true AND xa.is_zalo_server = false;
      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;

  -- V501 (G5): chiến dịch Nhóm data đang chờ data mới (không có data đến hạn, không có data đang chạy) khi bắt đầu lượt: như claim của
  -- bản cũ (v397) không nhận lượt và không ghi gì; hàm kết thúc Nhóm data chỉ chạy ở cuối một lượt đã chạy data (finish_campaign_v2).
  IF v_req_token IS NULL AND c.data_target_source_mode = 'data_group' AND c.status = 'chờ xử lý'
     AND NOT (c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now)
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false
                        AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND (d.schedule IS NULL OR d.schedule <= v_now)))) THEN
    RETURN jsonb_build_object('status', 'data_group_waiting', 'note', c.note);
  END IF;

  -- Giữ chỗ tài khoản có hạn. Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ
  -- vẫn "đang chạy" và chỉ được aka_agent_engine_close_stale_v1 đóng (không bao giờ gửi lại).
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = v_account_id FOR UPDATE;
  v_has_lease := FOUND;
  IF v_has_lease AND l.expires_at > v_now AND l.lease_token IS DISTINCT FROM v_req_token THEN
    RETURN jsonb_build_object('status', 'busy', 'runnerId', l.runner_id, 'expiresAt', l.expires_at);
  END IF;
  v_token := CASE WHEN v_has_lease AND l.lease_token = v_req_token AND l.expires_at > v_now THEN l.lease_token ELSE gen_random_uuid() END;
  -- V501: campaign_schedule = lịch của chiến dịch lúc bắt đầu lượt (khung giờ hiện tại của chiến dịch nhiều khung giờ).
  INSERT INTO public.auto_engine_leases AS el (account_id, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at, campaign_schedule)
  VALUES (v_account_id, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds), c.schedule)
  ON CONFLICT (account_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,
    campaign_schedule = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.campaign_schedule ELSE EXCLUDED.campaign_schedule END,
    heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at;

  IF c.status = 'tạm dừng' THEN RETURN jsonb_build_object('status', 'campaign_paused', 'leaseToken', v_token); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'campaign_not_runnable', 'campaignStatus', c.status, 'leaseToken', v_token);
  END IF;
  -- V501 (G10): chiến dịch đang nạp data ban đầu chưa được chạy, như bản cũ.
  IF coalesce(c.provisioning_state, 'ready') <> 'ready' THEN
    RETURN jsonb_build_object('status', 'campaign_not_ready', 'leaseToken', v_token, 'provisioningState', c.provisioning_state);
  END IF;
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule > v_now THEN
    RETURN jsonb_build_object('status', 'not_due', 'schedule', c.schedule, 'leaseToken', v_token);
  END IF;
  -- V501 (G1): lịch còn là ngày cũ mà chiến dịch chưa qua bảo trì lịch ngày mới: không chạy, nơi chạy cập nhật lịch rồi hỏi
  -- lại (như daily_maintenance_required của bản cũ, v340). Riêng hằng ngày không bật "chạy tiếp hôm sau" thì chạy tiếp ngay.
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule < v_day_start
     AND NOT (coalesce(nullif(c.schedule_type, ''), 'daily') = 'daily' AND c.continue_next_day IS NOT TRUE) THEN
    RETURN jsonb_build_object('status', 'maintenance_required', 'leaseToken', v_token, 'schedule', c.schedule);
  END IF;
  -- V501 (G5): chiến dịch theo Nhóm data đã hết hạn nhận và chạy data mới: không nhận lượt; kết thúc bằng đúng hàm kết thúc Nhóm data
  -- của bản cũ (finalizeDataGroupCampaignAtHardEnd: dừng nguồn, đóng data chờ "Chiến dịch đã hết hạn", hoàn thành khi không còn data
  -- đang chạy). Hàm chưa có (DB thử) thì chỉ không nhận lượt.
  IF c.data_target_source_mode = 'data_group' AND c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now THEN
    IF to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
      EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_dg_result
        USING c.staff_id, c.organization_id, c.id, 'Chiến dịch đã hết thời hạn nhận và chạy data mới';
    END IF;
    RETURN jsonb_build_object('status', 'data_group_hard_end', 'leaseToken', v_token, 'finalize', v_dg_result);
  END IF;
  -- Mốc ngày như bản cũ (daily_stop_due / daily_drain_due / vietnam_day_changed): sau giờ dừng trong ngày
  -- (mặc định 23:59) hoặc khi lease mở từ ngày trước thì không nhận data mới, để bảo trì ngày mới chạy.
  v_boundary := CASE
    WHEN c.daily_stop_time IS NOT NULL
     AND v_now >= ((v_vn + least(c.daily_stop_time, time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_stop_due'
    WHEN v_now >= ((v_vn + time '23:59:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_drain_due'
    WHEN v_has_lease AND l.lease_token = v_token AND (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < v_vn THEN 'vietnam_day_changed'
  END;
  IF v_boundary IS NOT NULL THEN
    -- Qua giờ dừng / giờ chốt trong ngày: không nhận data tới 0:00 hôm sau. Qua ngày khi lượt còn mở từ hôm trước:
    -- chỉ kết thúc lượt (nextAt = bây giờ) để bảo trì ngày mới chạy, xong là chạy tiếp ngay trong ngày.
    -- V501: kèm giờ dừng đã cấu hình để lõi in đúng câu ⏹ của Desktop (giờ dừng riêng hay mốc 23:59).
    RETURN jsonb_build_object('status', 'daily_boundary', 'leaseToken', v_token, 'reason', v_boundary, 'stopTime', c.daily_stop_time,
      'nextAt', CASE WHEN v_boundary = 'vietnam_day_changed' THEN v_now
                     ELSE ((v_vn + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END);
  END IF;

  -- V501 (G3): mỗi data chỉ thử một lần trong một lượt (như Desktop đi qua danh sách một lần): data vừa về hàng đợi
  -- được thử lại ở lượt sau, các data phía sau vẫn chạy trong lượt này.
  -- V501: chống gửi lặp N ngày (applyRecentDeliveryCooldown của Desktop, trước khi nhận data và trước bước tra số): gọi đúng
  -- RPC của bộ cũ cho data sắp nhận (còn "chờ xử lý", đã khoá). RPC tự tạm dừng data đã gửi gần đây; lõi in "⏸️ Bỏ qua …".
  -- Không ghi lịch sử, không tính lượt, không đổi chuỗi lỗi, không nghỉ. Mỗi lần gọi xét tối đa 50 data, và dừng khi hết ngân sách
  -- thời gian (engine.cooldown_scan_ms, mặc định 1.500 ms tính từ đầu lần gọi; review 12/11): lần gọi từ Desktop có trần 3 giây của
  -- vai trò aka_agent_desktop, quá trần thì cả lần gọi bị huỷ (kể cả các data đã tạm dừng) và lần gọi lại làm lại từ đầu. Trả
  -- cooldown_scan thì các data đã tạm dừng được giữ, lõi gọi lại ngay và đi tiếp từ data kế tiếp.
  v_cooldown := coalesce(c.extra_settings->'recentDeliveryCooldownEnabled' = 'true'::jsonb, false)
    AND to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') IS NOT NULL;
  v_cd_deadline := v_now + make_interval(secs => (CASE WHEN public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500') ~ '^[0-9]{1,6}$'
                                                       THEN greatest(1, public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500')::integer)
                                                       ELSE 1500 END) / 1000.0);
  -- V503: nhận cả lô (claim_batch_v1) đặt một mốc chung cho mọi lần nhận trong lô, để cả lời gọi không chạm trần 3 giây của Desktop.
  IF nullif(current_setting('aka.engine.claim_deadline', true), '') IS NOT NULL THEN
    v_cd_deadline := least(v_cd_deadline, current_setting('aka.engine.claim_deadline', true)::timestamptz);
  END IF;
  LOOP
    -- V532: sắp theo d.id + 0 (cùng thứ tự) để planner không đi khoá chính auto_campaign_input_data_pkey. Kế hoạch theo tham số có lúc
    -- quét khoá chính từ id nhỏ nhất rồi lọc theo chiến dịch (chiến dịch 34061 ngày 14/11/2026: lọc 12,26 triệu dòng, 6,8 giây, quá
    -- trần 3 giây của Desktop). Sắp theo biểu thức buộc lấy data của chiến dịch qua chỉ mục theo chiến dịch rồi mới sắp (vài chục ms).
    SELECT d.* INTO t FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
       AND (d.schedule IS NULL OR d.schedule <= v_now)
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
       AND d.id <> ALL (v_cd_skip)
     ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;
    v_found := FOUND;
    EXIT WHEN NOT v_found OR NOT v_cooldown;
    v_cd_decision := NULL; v_cd_note := NULL; v_cd_error := NULL;
    BEGIN
      EXECUTE 'SELECT x.decision, x.note FROM public.aka_agent_apply_campaign_delivery_cooldown($1, $2, $3, ARRAY[$4]::bigint[]) x'
        INTO v_cd_decision, v_cd_note USING v_campaign_id, v_account_id, v_staff, t.id;
    EXCEPTION WHEN OTHERS THEN
      v_cd_error := SQLERRM;
    END;
    IF v_cd_error IS NOT NULL THEN
      IF coalesce((SELECT g.on_error FROM public.auto_engine_gates g WHERE g.code = 'delivery_cooldown'), 'closed') = 'open' THEN EXIT; END IF;
      -- Như Desktop: chiến dịch chờ, ghi chú lý do, tự thử lại ở nhịp sau; data giữ nguyên.
      v_wait_note := 'Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: Không thể kiểm tra lịch sử gửi/đăng gần nhất: ' || v_cd_error;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
       WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
      RETURN jsonb_build_object('status', 'gate_unavailable', 'leaseToken', v_token, 'gate', 'delivery_cooldown', 'note', v_wait_note,
        'cooldownPaused', v_cd_paused);
    END IF;
    EXIT WHEN v_cd_decision = 'allowed';
    IF v_cd_decision IN ('paused_recent_delivery', 'paused_unidentifiable') THEN
      v_cd_paused := v_cd_paused || jsonb_build_object('inputDataId', t.id, 'name', t.name, 'phone', t.phone, 'uid', t.uid, 'email', t.email,
        'note', coalesce(nullif(btrim(v_cd_note), ''), 'Tạm dừng vì giới hạn gửi/đăng lặp.'));
    END IF;
    v_cd_skip := v_cd_skip || t.id;
    v_cd_scanned := v_cd_scanned + 1;
    IF v_cd_scanned >= 50 OR clock_timestamp() >= v_cd_deadline THEN
      RETURN jsonb_build_object('status', 'cooldown_scan', 'leaseToken', v_token, 'cooldownPaused', v_cd_paused);
    END IF;
  END LOOP;
  IF NOT v_found THEN
    RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token,
      'nextSchedule', (SELECT min(d.schedule) FROM public.auto_campaign_input_data d
                        WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false AND d.schedule > v_now),
      'runningTargets', (SELECT count(*) FROM public.auto_campaign_input_data d
                          WHERE d.campaign_id = v_campaign_id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false),
      -- Chiến dịch chưa có data nào (khác "đã chạy hết"): host có thể chờ nguồn bơm data thay vì hoàn thành.
      'hasTargets', EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                             WHERE d.campaign_id = v_campaign_id AND coalesce(d.is_delete, false) = false),
      -- V501: data đến hạn đã thử trong lượt này (về hàng đợi): lượt kết thúc, lượt sau thử lại.
      'dueTried', (SELECT count(*) FROM public.auto_campaign_input_data d
                    WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
                      AND (d.schedule IS NULL OR d.schedule <= v_now)
                      AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)),
      'dataGroup', c.data_target_source_mode = 'data_group',
      'cooldownPaused', v_cd_paused);
  END IF;

  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
  FOR v_act IN SELECT x.value FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) x LOOP
    v_code := v_act->>'code';
    v_required := coalesce((v_act->>'required')::boolean, true);
    v_decision := jsonb_build_object('decision', 'allow');

    SELECT s.is_disable, s.date_enable, s.disabled_error_code INTO v_lock
      FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
    IF FOUND AND v_lock.is_disable AND (v_lock.date_enable IS NULL OR v_lock.date_enable > v_now) THEN
      v_decision := jsonb_build_object('decision', 'wait', 'gate', 'action_lock', 'errorCode', v_lock.disabled_error_code, 'until', v_lock.date_enable);
    END IF;

    -- Hạn mức tính trong DB theo đúng công thức của bộ chạy Desktop/VPS (aka_agent_engine_action_limit).
    -- V505: thao tác khai "quota": false chỉ kiểm khoá, không kiểm hạn mức (huỷ lời mời kết bạn: limit_check_action_codes rỗng ở bản cũ).
    v_limit := CASE WHEN v_act->'quota' = 'false'::jsonb THEN NULL
                    ELSE public.aka_agent_engine_action_limit(v_campaign_id, v_account_id, v_code) END;
    IF v_decision->>'decision' = 'allow' AND v_limit IS NOT NULL THEN
      v_daily := (v_limit->>'daily')::numeric;
      v_window_count := (v_limit->>'windowCount')::numeric;
      v_window_minutes := (v_limit->>'windowMinutes')::numeric;
      IF coalesce(v_daily, 0) > 0 THEN
        SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_used
          FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
        IF coalesce(v_used, 0) >= v_daily THEN
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_day',
            'until', date_trunc('day', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' + interval '1 day');
        END IF;
      END IF;
      IF v_decision->>'decision' = 'allow' AND coalesce(v_window_count, 0) > 0 AND coalesce(v_window_minutes, 0) > 0 THEN
        SELECT count(*), min(x.at) INTO v_used, v_oldest FROM (
          -- Như countLimitDetailsInWindow của bộ chạy: không lọc is_delete.
          SELECT d.created_at AS at FROM public.auto_campaign_details d
           WHERE d.account_id = v_account_id AND d.action_code = v_code
             AND d.created_at >= v_now - make_interval(secs => (v_window_minutes * 60)::double precision)
             AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')))
          UNION ALL
          SELECT (m.value->>'markedAt')::timestamptz FROM public.auto_engine_target_runs rr, jsonb_array_elements(rr.marks) m
           WHERE rr.account_id = v_account_id AND rr.completed_at IS NULL
             AND m.value->>'actionCode' = v_code AND m.value->>'state' = 'pending'
        ) x;
        IF v_used >= v_window_count THEN
          -- Như bộ chạy: chờ tới khi lượt cũ nhất ra khỏi khung, ít nhất 60 giây.
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_hour',
            'until', greatest(v_now + interval '60 seconds', v_oldest + make_interval(secs => (v_window_minutes * 60)::double precision)));
        END IF;
      END IF;
    END IF;

    -- Thao tác không bắt buộc chỉ được bỏ qua với các cổng khai trong skippableGates (không khai = mọi cổng),
    -- như preflightActions: hết lượt thì bỏ qua được, đang bị khoá thì không.
    IF NOT v_required AND v_decision->>'decision' = 'wait' AND jsonb_typeof(v_act->'skippableGates') = 'array'
       AND NOT (v_act->'skippableGates' ? coalesce(v_decision->>'gate', '')) THEN
      v_required := true;
    END IF;
    IF v_decision->>'decision' = 'wait' THEN
      v_decision := v_decision || jsonb_build_object('note', regexp_replace(
        public.aka_agent_engine_wait_note(v_decision->>'errorCode', nullif(v_decision->>'until', '')::timestamptz), '^⏳ ', ''));
    END IF;
    v_decisions := v_decisions || jsonb_build_object(v_code, v_decision || jsonb_build_object('required', v_required));
    IF v_required AND v_decision->>'decision' = 'wait' AND v_target_wait IS NULL THEN v_target_wait := v_decision; END IF;
  END LOOP;
  -- requireAny: cả nhóm thao tác đều phải chờ thì không nhận data (không tra số khi không gửi được gì),
  -- hẹn lại theo thao tác mở sớm nhất.
  IF v_target_wait IS NULL AND jsonb_typeof(p_ctx->'requireAny') = 'array' AND jsonb_array_length(p_ctx->'requireAny') > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
                      WHERE coalesce(v_decisions->q.code->>'decision', 'allow') <> 'wait') THEN
    SELECT v_decisions->q.code INTO v_target_wait FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
     ORDER BY nullif(v_decisions->q.code->>'until', '')::timestamptz NULLS LAST LIMIT 1;
  END IF;

  -- Bước bắt buộc phải chờ (khoá / hạn mức): không nhận data. V501 (G2): như Desktop, KHÔNG dời lịch chiến dịch (dời lịch
  -- sang ngày sau làm chiến dịch thoát bảo trì lịch ngày mới, chạy lúc 00:00 hay vào ngày không hẹn, và đổi giờ gốc của lịch
  -- lặp khi original_schedule rỗng); chỉ ghi câu chờ khi đổi. Nơi chạy nhớ wait.until để không hỏi lại liên tục.
  IF v_target_wait IS NOT NULL THEN
    v_wait_note := public.aka_agent_engine_wait_note(v_target_wait->>'errorCode', nullif(v_target_wait->>'until', '')::timestamptz);
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
     WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
    RETURN jsonb_build_object('status', 'wait', 'leaseToken', v_token, 'wait', v_target_wait, 'actions', v_decisions, 'cooldownPaused', v_cd_paused);
  END IF;

  -- Trigger phân quyền ứng dụng (V445) có thể từ chối chuyển "đang chạy": hoàn tác cả bước nhận data
  -- và giữ chỗ, trả trạng thái rõ ràng thay vì lỗi.
  BEGIN
    UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = t.id;
    -- Ghi lịch = lúc nhận khi lịch còn là ngày cũ: cổng bảo trì của bộ cũ đếm chiến dịch "đang chạy" có lịch
    -- trước đầu ngày, nên chiến dịch của bộ mới không được giữ cổng đó đóng.
    -- V501 (G6): bắt đầu chạy thì xoá ghi chú (câu chờ cũ), như claim của bản cũ (v397). Lịch ngày cũ chỉ còn tới đây với
    -- hằng ngày không chạy tiếp hôm sau (G1 ở trên).
    UPDATE public.auto_campaigns SET status = 'đang chạy',
           schedule = CASE WHEN schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN v_now ELSE schedule END,
           note = CASE WHEN status = 'chờ xử lý' THEN NULL ELSE note END,
           updated_at = v_now
     WHERE id = v_campaign_id
       AND (status = 'chờ xử lý' OR schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'));
    IF a.status = 'chờ xử lý' THEN UPDATE public.auto_accounts SET status = 'đang chạy', updated_at = v_now WHERE id = v_account_id; END IF;
    INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id, runtime_target, started_at)
    VALUES (t.id, v_campaign_id, v_account_id, v_staff, c.organization_id, v_token, v_runner, v_runtime, v_now)
    RETURNING id INTO v_run_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'app_access%' THEN RAISE; END IF;
    DELETE FROM public.auto_engine_leases WHERE account_id = v_account_id AND lease_token = v_token;
    RETURN jsonb_build_object('status', 'app_access_denied', 'reason', SQLERRM);
  END;

  RETURN jsonb_build_object('status', 'claimed', 'targetRunId', v_run_id, 'leaseToken', v_token,
    'leaseExpiresAt', v_now + make_interval(secs => v_lease_seconds),
    'target', (to_jsonb(t) - 'status') || jsonb_build_object('status', 'đang chạy'),
    'targetKey', v_target_key, 'actions', v_decisions,
    -- Cấu hình cổng kiểm cho adapter (on_error: open = lỗi kiểm vẫn gửi; closed = chờ rồi thử lại).
    'gates', (SELECT coalesce(jsonb_object_agg(g.code, jsonb_build_object('onError', g.on_error)), '{}'::jsonb) FROM public.auto_engine_gates g),
    'campaign', jsonb_build_object('id', c.id, 'actionId', c.action_id, 'status', 'đang chạy'),
    'cooldownPaused', v_cd_paused);
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_action_limit(p_campaign_id bigint, p_account_id bigint, p_action_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_limits jsonb;
  v_org bigint;
  v_base jsonb;
  v_group jsonb;
  v_daily numeric;
  v_count numeric;
  v_minutes numeric;
  v_cap numeric;
  v_unlimited boolean;
  v_rows integer;
BEGIN
  SELECT nullif(c.extra_settings->'actionLimits', 'null'::jsonb), c.organization_id INTO v_limits, v_org
    FROM public.auto_campaigns c WHERE c.id = p_campaign_id;
  IF p_action_code = 'zalo_find_phone_user' THEN
    v_base := jsonb_build_object('dailyLimit', 1000, 'rateLimitCount', 1000,
      'rateLimitMinutes', coalesce(nullif(v_limits->'byActionCode'->p_action_code->'rateLimitMinutes', 'null'::jsonb), v_limits->'rateLimitMinutes'));
  ELSE
    v_base := nullif(v_limits->'byActionCode'->p_action_code, 'null'::jsonb);
    IF v_base IS NULL AND v_limits IS NOT NULL THEN
      v_base := jsonb_build_object('dailyLimit', v_limits->'dailyLimit', 'rateLimitCount', v_limits->'rateLimitCount', 'rateLimitMinutes', v_limits->'rateLimitMinutes');
    END IF;
  END IF;
  SELECT nullif(g.settings->'byActionCode'->p_action_code, 'null'::jsonb) INTO v_group
    FROM public.auto_accounts a JOIN public.auto_account_groups g ON g.id = a.account_group_id WHERE a.id = p_account_id;

  -- normalizePositiveActionLimit: số dương thì lấy phần nguyên, còn lại là không đặt.
  IF v_group IS NOT NULL THEN
    v_daily := coalesce(public.aka_agent_engine_positive(v_group->'dailyLimit'), public.aka_agent_engine_number(v_base->'dailyLimit'));
    v_count := coalesce(public.aka_agent_engine_positive(v_group->'rateLimitCount'), public.aka_agent_engine_number(v_base->'rateLimitCount'));
    v_minutes := coalesce(public.aka_agent_engine_positive(v_group->'rateLimitMinutes'), public.aka_agent_engine_number(v_base->'rateLimitMinutes'));
  ELSE
    v_daily := public.aka_agent_engine_number(v_base->'dailyLimit');
    v_count := public.aka_agent_engine_number(v_base->'rateLimitCount');
    v_minutes := public.aka_agent_engine_number(v_base->'rateLimitMinutes');
  END IF;

  IF p_action_code <> 'zalo_find_phone_user' AND p_action_code LIKE 'zalo\_%' THEN
    SELECT count(*), bool_or(coalesce(p.max_sends_per_day, 0) <= 0 AND lower(btrim(coalesce(p.package_type, ''))) <> 'demo'),
           max(CASE WHEN coalesce(p.max_sends_per_day, 0) > 0 THEN p.max_sends_per_day ELSE 30 END)
      INTO v_rows, v_unlimited, v_cap
      FROM public.org_organization_product p
     WHERE p.organization_id = v_org AND p.is_deleted = false AND p.product_id IN (16, 18)
       AND p.expiration_date IS NOT NULL AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_vn;
    IF v_rows > 0 AND NOT v_unlimited THEN
      v_daily := least(coalesce(public.aka_agent_engine_positive(to_jsonb(v_daily)), 30), v_cap);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'daily', CASE WHEN v_daily > 0 THEN v_daily ELSE 30 END,
    'windowCount', CASE WHEN v_count > 0 THEN v_count ELSE 9 END,
    'windowMinutes', CASE WHEN v_minutes > 0 THEN v_minutes ELSE 65 END);
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_resolve_policy(p_error_code text, p_status_id bigint, p_action_code text, p_campaign_action_id text, p_runtime_target text, p_phase text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  c_fields constant text[] := ARRAY['detail_mode','detail_status_id','sub_status_id','log_template','campaign_note_template',
    'quota_effect','target_streak_effect','streak_threshold','target_effect','requeue_after_minutes','remaining_steps',
    'lock_action_codes','lock_mode','lock_minutes','lock_days','lock_time','run_effect','pace_mode','pace_seconds',
    'campaign_effect','campaign_hold_minutes','account_effect','login_effect'];
  v_class text;
  v_failed bigint;
  v_success bigint;
  v_defaults jsonb;
  v_error jsonb := '{}'::jsonb;
  v_status jsonb := '{}'::jsonb;
  v_guard jsonb := '{}'::jsonb;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_revs jsonb := '{}'::jsonb;
  v_status_id bigint;
  r record;
  v_row jsonb;
BEGIN
  SELECT s.id INTO v_failed FROM public.auto_status s WHERE s.code = 'campaign_detail_failed';
  SELECT s.id INTO v_success FROM public.auto_status s WHERE s.code = 'campaign_detail_success';
  -- Mặc định an toàn có sẵn trong hàm (dùng khi dữ liệu chính sách thiếu); không ném lỗi.
  v_defaults := jsonb_build_object('lock_action_codes', '[]'::jsonb,
    'campaign_effect', 'none', 'account_effect', 'none', 'login_effect', 'none');
  IF p_error_code IS NULL THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',coalesce(p_status_id, v_success),
      'quota_effect','count','target_streak_effect','reset','target_effect','complete','remaining_steps','continue',
      'run_effect','continue','pace_mode','full');
  ELSIF p_phase = 'before_send' THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','suppress','detail_status_id',v_failed,
      'quota_effect','no_count','target_streak_effect','ignore','target_effect','requeue','remaining_steps','skip',
      'run_effect','end_unit','pace_mode','none');
  ELSIF p_phase = 'in_flight' THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',v_failed,
      'quota_effect','count_if_committed','target_streak_effect','ignore','target_effect','complete','remaining_steps','skip',
      'run_effect','continue','pace_mode','full');
  ELSE
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',v_failed,
      'quota_effect','count','target_streak_effect','increment','target_effect','complete','remaining_steps','continue',
      'run_effect','continue','pace_mode','full');
  END IF;

  IF p_error_code IS NOT NULL THEN
    SELECT e.error_class INTO v_class FROM public.auto_error e WHERE e.error_code = p_error_code;
    FOR r IN
      SELECT p.*,
        CASE WHEN p.error_code IS NOT NULL THEN 2 ELSE 1 END AS k,
        (CASE WHEN p.campaign_action_id IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.action_code IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
      FROM public.auto_outcome_policies p
      WHERE p.is_active AND NOT p.is_delete
        AND (p.error_code = p_error_code OR (v_class IS NOT NULL AND p.error_class = v_class))
        AND (p.action_code IS NULL OR p.action_code = p_action_code)
        AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
        AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
      ORDER BY k, spec, p.id
    LOOP
      v_row := to_jsonb(r);
      v_error := v_error || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
        WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
      v_ids := v_ids || r.id;
      v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
    END LOOP;
  END IF;

  -- Chặn theo thao tác (dòng chỉ có action_code): áp sau cùng, ví dụ thao tác phụ gắn tag/đổi tên
  -- không bao giờ tính lượt hay chuỗi lỗi, dù mã lỗi nói gì (giống guard auxiliaryAction hiện nay).
  FOR r IN
    SELECT p.*,
      (CASE WHEN p.campaign_action_id IS NOT NULL THEN 2 ELSE 0 END + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
    FROM public.auto_outcome_policies p
    WHERE p.is_active AND NOT p.is_delete
      AND p.status_id IS NULL AND p.error_code IS NULL AND p.error_class IS NULL
      AND p.action_code = p_action_code
      AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
      AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
    ORDER BY spec, p.id
  LOOP
    v_row := to_jsonb(r);
    v_guard := v_guard || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
      WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
    v_ids := v_ids || r.id;
    v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
  END LOOP;

  v_status_id := coalesce((v_guard->>'detail_status_id')::bigint, (v_error->>'detail_status_id')::bigint, p_status_id,
    (v_defaults->>'detail_status_id')::bigint);

  FOR r IN
    WITH RECURSIVE chain AS (
      SELECT s.id, s.parent_status_id, 0 AS depth FROM public.auto_status s WHERE s.id = v_status_id
      UNION ALL
      SELECT a.id, a.parent_status_id, c.depth + 1 FROM chain c JOIN public.auto_status a ON a.id = c.parent_status_id WHERE c.depth < 10
    )
    SELECT p.*, c.depth AS depth,
      (CASE WHEN p.campaign_action_id IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.action_code IS NOT NULL THEN 2 ELSE 0 END
        + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
    FROM chain c JOIN public.auto_outcome_policies p ON p.status_id = c.id
    WHERE p.is_active AND NOT p.is_delete
      AND (p.action_code IS NULL OR p.action_code = p_action_code)
      AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
      AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
    ORDER BY c.depth DESC, spec, p.id
  LOOP
    v_row := to_jsonb(r);
    v_status := v_status || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
      WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
    v_ids := v_ids || r.id;
    v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
  END LOOP;

  RETURN v_defaults || v_status || v_error || v_guard || jsonb_build_object(
    'detail_status_id', v_status_id, 'error_class', v_class, 'policy_ids', to_jsonb(v_ids), 'revisions', v_revs);
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_report_v1(p_target_run_id bigint, p_lease_token uuid, p_outcomes jsonb, p_final boolean DEFAULT false, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  r public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_lease_ok boolean;
  v_run_open boolean;
  o jsonb;
  v_results jsonb := '[]'::jsonb;
  v_rk text;
  v_prev public.auto_engine_outcomes%ROWTYPE;
  v_is_replay boolean;
  v_action text;
  v_phase text;
  v_ok boolean;
  v_status_id bigint;
  v_signal jsonb;
  v_evidence jsonb;
  v_platform text;
  v_op_class text;
  v_action_name text;
  v_rule_id bigint;
  v_matched_by text;
  v_catch_all boolean;
  v_error_code text;
  v_policy jsonb;
  v_err public.auto_error%ROWTYPE;
  v_delivery text;
  v_count boolean;
  v_mark_idx integer;
  v_mark jsonb;
  v_reserved boolean;
  v_sem record;
  v_log text;
  v_detail_id bigint;
  v_until timestamptz;
  v_lock_until_max timestamptz;
  v_lc text;
  v_side boolean;
  v_decision jsonb;
  v_contrib jsonb;
  v_call jsonb := '[]'::jsonb;
  v_call_new jsonb := '[]'::jsonb;
  v_all jsonb;
  -- Chỉ thị của lượt gọi này.
  v_target_done boolean := false;
  v_run_rank integer := 0;
  v_rank integer;
  v_pace jsonb;
  v_pace_rank integer := 0;
  v_camp_effect text := 'none';
  v_camp_note text;
  v_camp_hold integer;
  v_acc_effect text := 'none';
  v_login_effect text := 'none';
  -- Tổng hợp theo data: mọi kết quả của lượt chạy data này, kể cả các lần gọi trước.
  v_target_effect text;
  v_target_rank integer := 0;
  v_requeue_minutes integer;
  v_note text;
  v_last_error_code text;
  v_last_action text;
  v_streak text := 'ignore';
  v_covered boolean := false;
  v_thr_effect text := 'none';
  v_thr_threshold integer;
  v_thr_hold integer;
  v_thr_source text;
  v_guard_code text;
  v_gp jsonb;
  v_streak_count integer;
  v_any_committed boolean := false;
  v_final_status text;
  v_schedule timestamptz;
  v_safety jsonb := '[]'::jsonb;
  v_camp_applied text := 'none';
  v_camp_rows integer;
  v_next text;
  v_outcome_count integer := 0;
  v_more boolean;
  v_response jsonb;
  -- V503: chế độ báo theo lô, chỉ report_batch_v1 đặt (trong cùng giao dịch, đặt lại rỗng sau mỗi data).
  v_scope text := nullif(current_setting('aka.engine.batch_scope', true), '');
BEGIN
  -- Lô rỗng chỉ hợp lệ khi chốt data (các bước còn lại bị bỏ vì bước trước không đạt).
  IF p_outcomes IS NULL OR jsonb_typeof(p_outcomes) <> 'array' OR (jsonb_array_length(p_outcomes) = 0 AND NOT p_final) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outcomes_required');
  END IF;
  IF (SELECT count(DISTINCT btrim(x.value->>'resultKey')) FROM jsonb_array_elements(p_outcomes) x) <> jsonb_array_length(p_outcomes) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_key_duplicate');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_not_found'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token THEN RETURN jsonb_build_object('ok', false, 'reason', 'lease_token_mismatch'); END IF;

  -- Kiểm cả lô trước khi ghi: lô sai thì không ghi phần nào.
  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := nullif(btrim(o->>'resultKey'), '');
    IF v_rk IS NULL OR length(v_rk) NOT BETWEEN 8 AND 200 THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_required'); END IF;
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    IF FOUND THEN
      IF v_prev.target_run_id <> r.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_conflict', 'resultKey', v_rk); END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = o->>'actionCode') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
    END IF;
    IF coalesce(nullif(o->>'phase', ''), 'after_send') NOT IN ('before_send', 'in_flight', 'after_send') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'phase_invalid', 'phase', o->>'phase');
    END IF;
    IF jsonb_typeof(coalesce(o->'ok', 'false'::jsonb)) <> 'boolean' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ok_invalid'); END IF;
    IF coalesce((o->>'ok')::boolean, false) AND NOT EXISTS (SELECT 1 FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail'
           AND s.is_active AND NOT s.is_delete) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
  END LOOP;

  -- V515 (B): gọi lại đúng lần báo đã chốt data (câu trả lời lần đầu bị mất: mạng, hết giờ) khi lease của lượt chạy còn hạn: trả lại câu
  -- trả lời của lần đầu, không áp lại hiệu ứng. Trước V515 lượt data đã đóng nên DB trả 'ownership_lost', lượt chạy dừng mà không nhả
  -- lease (tài khoản đứng tới khi lease hết hạn). Lease hết hạn, hay lời gọi có kết quả mới, thì đi đường cũ.
  IF NOT p_dry_run AND r.completed_at IS NOT NULL AND r.final_response IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_outcomes) x
                      WHERE NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo
                                         WHERE eo.result_key = btrim(x.value->>'resultKey') AND eo.target_run_id = r.id))
     AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
                  WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    SELECT coalesce(jsonb_agg((eo.decision->'result') || jsonb_build_object('replay', true) ORDER BY x.ordinality), '[]'::jsonb)
      INTO v_results
      FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
      JOIN public.auto_engine_outcomes eo ON eo.result_key = btrim(x.value->>'resultKey');
    RETURN r.final_response || jsonb_build_object('outcomes', v_results, 'replay', true);
  END IF;

  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id;
  SELECT * INTO t FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
  v_run_open := r.completed_at IS NULL;
  v_lease_ok := v_run_open AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
    WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now);

  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := btrim(o->>'resultKey');
    -- Gọi lại cùng result_key: trả lại đúng quyết định cũ, không gộp chính sách lần nữa.
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    v_is_replay := FOUND;
    IF v_is_replay THEN
      v_decision := v_prev.decision;
      v_results := v_results || jsonb_build_array((v_decision->'result') || jsonb_build_object('replay', true));
      v_contrib := v_decision->'contrib';
    ELSE
      v_action := o->>'actionCode';
      SELECT aa.flatform_type, coalesce(aa.operation_class, 'delivery'), aa.name INTO v_platform, v_op_class, v_action_name
        FROM public.auto_account_actions aa WHERE aa.code = v_action;
      -- Tên thao tác ghi vào lịch sử: như helper Desktop ("Tìm SĐT"…) khi bộ chạy gửi kèm, không thì tên trong danh mục.
      v_action_name := coalesce(nullif(left(btrim(coalesce(o->>'actionName', '')), 120), ''), v_action_name);
      v_phase := coalesce(nullif(o->>'phase', ''), 'after_send');
      v_ok := coalesce((o->>'ok')::boolean, false);
      v_signal := coalesce(o->'signal', '{}'::jsonb);
      v_evidence := coalesce(o->'evidence', '{}'::jsonb);
      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;

      IF v_ok THEN
        SELECT s.id INTO v_status_id FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail';
      ELSE
        SELECT cs.error_code, cs.rule_id, cs.matched_by, cs.is_catch_all INTO v_error_code, v_rule_id, v_matched_by, v_catch_all
          FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, v_signal) cs;
        v_error_code := coalesce(v_error_code, 'err_undefined');
        IF coalesce(v_catch_all, true) AND NOT p_dry_run THEN
          INSERT INTO public.auto_outcome_unmatched AS u (platform, action_code, phase, signal_kind, pattern_key, fallback_error_code, sample, hit_count, first_seen_at, last_seen_at)
          VALUES (v_platform, v_action, v_phase, coalesce(nullif(v_signal->>'kind', ''), 'unknown'), coalesce(public.aka_agent_engine_pattern_key(v_signal), ''),
                  v_error_code, v_signal, 1, v_now, v_now)
          ON CONFLICT (platform, action_code, phase, signal_kind, pattern_key) DO UPDATE SET
            hit_count = u.hit_count + 1, last_seen_at = EXCLUDED.last_seen_at, sample = EXCLUDED.sample, fallback_error_code = EXCLUDED.fallback_error_code;
        END IF;
        SELECT * INTO v_err FROM public.auto_error e WHERE e.error_code = v_error_code;
      END IF;

      v_policy := public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, c.action_id, r.runtime_target, v_phase);
      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);

      -- Trạng thái giao: chỉ thao tác loại delivery mới có thể "đã giao".
      v_delivery := CASE
        WHEN v_op_class <> 'delivery' THEN 'none'
        WHEN v_ok THEN CASE WHEN coalesce(v_sem.counts_as_delivered, false) THEN 'delivered' ELSE 'none' END
        WHEN coalesce((v_evidence->>'partialDelivery')::boolean, false) THEN 'partial'
        WHEN v_phase = 'in_flight' OR v_policy->>'error_class' = 'unknown_delivery' OR v_evidence->>'deliveryState' = 'unknown' THEN 'unknown'
        ELSE 'not_delivered' END;
      -- V501: giao một phần như finalizeZaloPartialSendDetail của Desktop: luôn ghi dòng "thất bại", không đổi chuỗi data lỗi
      -- (trừ khi do media quá giờ), data hoàn thành; chính sách không ghi lịch sử (như khoá 802 với người lạ) vẫn ghi.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_policy := v_policy || jsonb_build_object('detail_mode', 'write',
          'detail_status_id', coalesce((SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_failed' AND s.component_type = 'campaign_detail'
                                         ORDER BY s.id LIMIT 1), (v_policy->>'detail_status_id')::bigint),
          'target_streak_effect', CASE WHEN v_signal->>'code' = 'campaign_media_timeout' THEN v_policy->>'target_streak_effect' ELSE 'ignore' END,
          -- Hiệu ứng chiến dịch phụ thuộc ngưỡng (N lần liền, ví dụ 127 [Q4]) chỉ có nghĩa khi kết quả cộng chuỗi; không cộng chuỗi
          -- thì không được áp ngay (khoá thao tác của mã vẫn giữ).
          'campaign_effect', CASE WHEN v_signal->>'code' IS DISTINCT FROM 'campaign_media_timeout' AND (v_policy->>'streak_threshold') IS NOT NULL
                                  THEN 'none' ELSE v_policy->>'campaign_effect' END,
          'target_effect', 'complete');
        SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);
      END IF;

      -- V503: báo cả lô gửi dạng chia sẻ (policyHandling của Desktop). Lô có người đã nhận được (chia sẻ xong hoặc đã nhận media) thì lỗi
      -- của người khác chỉ ghi cho người đó (target_only): không khoá thao tác, không đổi chiến dịch / tài khoản / đăng nhập, không dừng
      -- lượt, không cộng chuỗi data lỗi. Lô không ai nhận được thì chỉ người có hiệu ứng mạnh nhất áp đủ chính sách; người khác
      -- (batch_followup) bỏ hiệu ứng phụ nhưng vẫn theo chuỗi data lỗi. Data đi đâu, ghi lịch sử, hạn mức, nhớ mục tiêu: theo chính sách.
      IF NOT v_ok AND v_scope IN ('target_only', 'batch_followup') THEN
        v_policy := v_policy || jsonb_build_object('lock_action_codes', '[]'::jsonb, 'campaign_effect', 'none', 'account_effect', 'none',
          'login_effect', 'none', 'run_effect', 'continue')
          || CASE WHEN v_scope = 'target_only' THEN jsonb_build_object('target_streak_effect', 'ignore') ELSE '{}'::jsonb END;
      END IF;

      -- Giải quyết dấu "sắp gửi" của bước này.
      v_reserved := false; v_mark_idx := NULL; v_mark := NULL;
      SELECT (x.ordinality - 1)::integer, x.value INTO v_mark_idx, v_mark
        FROM jsonb_array_elements(r.marks) WITH ORDINALITY x
       WHERE x.value->>'stepKey' = coalesce(nullif(o->>'stepKey', ''), v_action) AND x.value->>'state' = 'pending'
       LIMIT 1;
      IF v_mark_idx IS NOT NULL THEN
        v_reserved := (v_mark->>'reservedQuotaDate')::date = v_vn;
        r.marks := jsonb_set(r.marks, ARRAY[v_mark_idx::text, 'state'],
          to_jsonb(CASE WHEN v_delivery = 'none' THEN 'not_delivered' ELSE v_delivery END));
      ELSIF v_op_class = 'delivery' AND v_delivery IN ('delivered', 'partial', 'unknown') THEN
        v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'unmarked_delivery', 'actionCode', v_action, 'resultKey', v_rk));
      END IF;

      -- Giao một phần luôn tính lượt (giống partialDelivery hiện nay).
      v_count := CASE v_policy->>'quota_effect' WHEN 'count' THEN true WHEN 'no_count' THEN false
                 ELSE v_delivery IN ('delivered', 'partial', 'unknown') END
                 OR v_delivery = 'partial';
      IF NOT p_dry_run THEN
        IF v_reserved AND NOT v_count THEN
          UPDATE public.auto_account_action_status SET count_action_in_day = greatest(count_action_in_day - 1, 0), updated_at = v_now
           WHERE account_id = r.account_id AND action_code = v_action AND count_date = v_vn;
        ELSIF NOT v_reserved AND v_count THEN
          INSERT INTO public.auto_account_action_status AS s (account_id, action_code, count_action_in_day, count_date)
          VALUES (r.account_id, v_action, 1, v_vn)
          ON CONFLICT (account_id, action_code) DO UPDATE SET
            count_action_in_day = CASE WHEN s.count_date = v_vn THEN s.count_action_in_day + 1 ELSE 1 END, count_date = v_vn, updated_at = v_now;
        END IF;
      END IF;

      -- Khoá thao tác (sự thật về tài khoản: áp cả khi lease đã mất).
      v_until := NULL;
      IF jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0 THEN
        v_until := public.aka_agent_engine_lock_until(v_policy->>'lock_mode', (v_policy->>'lock_minutes')::integer,
          (v_policy->>'lock_days')::integer, (v_policy->>'lock_time')::time, v_now);
      END IF;

      v_log := CASE
        WHEN v_ok THEN coalesce(public.aka_agent_engine_render(v_policy->>'log_template',
                  jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name)), nullif(o->>'customerLog', ''),
                  coalesce(v_action_name, v_action) || ': ' || coalesce(v_sem.status_value, 'thành công'))
        ELSE coalesce(
                  public.aka_agent_engine_render(v_policy->>'log_template',
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  public.aka_agent_engine_render(coalesce(v_err.customer_title, v_err.noti_running_process, v_err.error_name),
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  coalesce(v_action_name, v_action) || ' không thành công')
             || CASE WHEN v_err.public_code IS NOT NULL THEN ' (' || v_err.public_code || ')' ELSE '' END
        END;
      -- V501: tiền tố của Desktop cho giao một phần.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_log := CASE WHEN v_evidence->>'partialStage' = 'media_after_content' THEN 'Đã gửi nội dung nhưng gửi file thất bại. '
                      ELSE 'Đã gửi file nhưng gửi nội dung thất bại. ' END || v_log;
      END IF;

      IF NOT p_dry_run THEN
        FOR v_lc IN SELECT jsonb_array_elements_text(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) LOOP
          IF EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = v_lc) THEN
            INSERT INTO public.auto_account_action_status AS s (account_id, action_code, is_disable, date_enable, disabled_error_code, disabled_reason, disabled_at)
            VALUES (r.account_id, v_lc, true, v_until, v_error_code, v_log, v_now)
            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now;
          END IF;
        END LOOP;

        IF v_policy->>'detail_mode' = 'write' THEN
          INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, status_id, sub_status_id,
            error_code, counts_toward_limit, report_group, log, data, policy_snapshot, result_key, created_at)
          VALUES (r.input_data_id, r.campaign_id, r.account_id, v_action_name, v_action, coalesce(v_sem.status_value, 'thất bại'),
            (v_policy->>'detail_status_id')::bigint, (v_policy->>'sub_status_id')::bigint, v_error_code, v_count, v_sem.report_group, v_log,
            jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal, 'evidence', v_evidence)
              || coalesce(o->'data', '{}'::jsonb),
            jsonb_build_object('engine', 'v2',
              'operationState', CASE WHEN v_delivery IN ('delivered', 'partial') THEN 'committed'
                                     WHEN v_delivery = 'unknown' THEN 'unknown' ELSE 'not_committed' END,
              'actionCode', v_action, 'statusCode', v_sem.status_code, 'errorCode', v_error_code, 'countsTowardLimit', v_count,
              'badTargetEffect', v_policy->>'target_streak_effect',
              'v2', jsonb_build_object('errorClass', v_policy->>'error_class', 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)),
            v_rk, v_now)
          RETURNING id INTO v_detail_id;
        END IF;
      END IF;

      v_side := jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0
        OR coalesce(v_policy->>'campaign_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'account_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'login_effect', 'none') <> 'none';
      v_contrib := jsonb_build_object(
        'seq', r.outcome_count + v_outcome_count + 1,
        'ok', v_ok, 'actionCode', v_action, 'errorCode', v_error_code, 'delivery', v_delivery,
        'targetEffect', CASE WHEN v_ok AND v_policy->>'remaining_steps' <> 'skip' THEN NULL ELSE v_policy->>'target_effect' END,
        'requeueAfterMinutes', v_policy->'requeue_after_minutes',
        'remaining', v_policy->>'remaining_steps',
        'streak', v_policy->>'target_streak_effect', 'streakThreshold', v_policy->'streak_threshold', 'sideEffect', v_side,
        'runEffect', v_policy->>'run_effect',
        'pace', jsonb_build_object('mode', v_policy->>'pace_mode', 'seconds', v_policy->'pace_seconds'),
        'campaignEffect', v_policy->>'campaign_effect', 'campaignHoldMinutes', v_policy->'campaign_hold_minutes',
        'campaignNote', CASE WHEN v_policy->>'campaign_effect' IN ('pause', 'hold') THEN
             -- Như renderZaloPolicyCampaignNote: [x]/[t] là số phút khoá (khoá theo phút), không thì câu lỗi.
             coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign),
               jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                 'until', public.aka_agent_engine_format_vn(v_until),
                 'x', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE coalesce(v_signal->>'message', '') END,
                 't', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE '' END)), v_log)
             || CASE WHEN v_err.public_code IS NOT NULL
                     AND position('(' || v_err.public_code || ')' IN coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign), '{}'::jsonb), v_log)) = 0
                  THEN ' (' || v_err.public_code || ')' ELSE '' END
           ELSE NULL END,
        'accountEffect', v_policy->>'account_effect', 'loginEffect', v_policy->>'login_effect',
        'lockUntil', v_until, 'log', v_log);
      -- V517: decision chỉ giữ result (gọi lại lần báo) và contrib (gộp lượt); chính sách đã gộp không lưu nữa (không hàm nào đọc
      -- lại; lịch sử có policyIds/revisions). Mỗi dòng auto_engine_outcomes nhẹ đi ~500 byte.
      v_decision := jsonb_build_object(
        'result', jsonb_build_object('resultKey', v_rk, 'actionCode', v_action, 'actionName', v_action_name, 'ok', v_ok, 'errorCode', v_error_code,
          'publicCode', v_err.public_code, 'errorClass', v_policy->>'error_class', 'statusId', (v_policy->>'detail_status_id')::bigint,
          'statusCode', v_sem.status_code, 'reportGroup', v_sem.report_group, 'deliveryState', v_delivery, 'countsTowardLimit', v_count,
          'detailId', v_detail_id, 'log', v_log, 'lockUntil', v_until),
        'contrib', v_contrib);
      IF NOT p_dry_run THEN
        INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok,
          error_code, status_id, delivery_state, detail_id, decision, signal, created_at)
        VALUES (v_rk, r.id, r.input_data_id, r.campaign_id, r.account_id, v_action, v_phase, v_ok, v_error_code,
          (v_policy->>'detail_status_id')::bigint, v_delivery, v_detail_id, v_decision, v_signal, v_now);
      END IF;
      v_results := v_results || jsonb_build_array(v_decision->'result');
      v_outcome_count := v_outcome_count + 1;
      v_call_new := v_call_new || jsonb_build_array(v_contrib);
    END IF;
    v_call := v_call || jsonb_build_array(v_contrib);
  END LOOP;

  -- Lượt gọi này: data xong chưa (bước còn lại có chạy tiếp không), hiệu ứng áp ngay.
  -- run_effect (dừng lượt/tài khoản/chiến dịch) chỉ có hiệu lực SAU khi data hiện tại xong,
  -- giống stopAfterTarget hiện nay; các bước còn lại của data vẫn chạy trừ khi remaining_steps=skip.
  FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_call) x LOOP
    IF v_contrib->>'remaining' = 'skip' THEN v_target_done := true; END IF;
    -- Hiệu ứng chiến dịch áp ngay khi mã không có ngưỡng (applyRuntimeErrorPolicy hiện nay). Có ngưỡng (N data lỗi liền) thì chỉ
    -- xét ở cuối data, khi kết quả tăng chuỗi. V532: kết quả có ngưỡng mà không tăng chuỗi (bước phụ gắn tag / đổi tên Zalo không
    -- bao giờ đổi chuỗi lỗi) không còn tạm dừng chiến dịch ngay, như nguyên tắc V501 cho giao một phần; khoá thao tác, dừng lượt và
    -- data đi đâu của mã vẫn giữ.
    IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
       AND (v_contrib->>'streakThreshold') IS NULL
       AND (v_camp_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_contrib->>'campaignEffect';
      v_camp_note := v_contrib->>'campaignNote';
      v_camp_hold := (v_contrib->>'campaignHoldMinutes')::integer;
    END IF;
    IF coalesce(v_contrib->>'accountEffect', 'none') = 'pause' THEN v_acc_effect := 'pause'; END IF;
    IF coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN v_login_effect := v_contrib->>'loginEffect'; END IF;
    IF (v_contrib->>'lockUntil') IS NOT NULL THEN
      v_lock_until_max := greatest(coalesce(v_lock_until_max, (v_contrib->>'lockUntil')::timestamptz), (v_contrib->>'lockUntil')::timestamptz);
    END IF;
  END LOOP;
  v_target_done := v_target_done OR p_final;

  IF v_target_done THEN
    SELECT coalesce(jsonb_agg(eo.decision->'contrib' ORDER BY (eo.decision->'contrib'->>'seq')::integer, eo.result_key), '[]'::jsonb) INTO v_all
      FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = r.id;
    IF p_dry_run THEN v_all := v_all || v_call_new; END IF;
    -- Không bao giờ đóng data mà không có kết quả nào (chống "thành công giả"): runtime phải báo no_outcome.
    IF jsonb_array_length(v_all) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_outcomes'); END IF;
    FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_all) x LOOP
      IF v_contrib->>'delivery' IN ('delivered', 'partial', 'unknown') THEN v_any_committed := true; END IF;
      -- Sau khi data xong: dừng lượt/tài khoản/chiến dịch theo kết quả nặng nhất của data này.
      v_rank := greatest(
        CASE v_contrib->>'runEffect' WHEN 'stop_campaign' THEN 4 WHEN 'stop_account' THEN 3 WHEN 'end_unit' THEN 2 ELSE 0 END,
        -- V532: cùng điều kiện với hiệu ứng áp ngay ở trên (hiệu ứng có ngưỡng chỉ dừng lượt qua nhánh ngưỡng).
        CASE WHEN coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
              AND (v_contrib->>'streakThreshold') IS NULL THEN 4 ELSE 0 END,
        CASE WHEN coalesce(v_contrib->>'accountEffect', 'none') <> 'none' OR coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN 3 ELSE 0 END);
      IF v_rank > v_run_rank THEN v_run_rank := v_rank; END IF;
      -- Nghỉ sau data theo kết quả "nặng" nhất: full > short > none (bản cũ nghỉ sau mọi data).
      v_rank := CASE v_contrib->'pace'->>'mode' WHEN 'full' THEN 3 WHEN 'short' THEN 2 WHEN 'none' THEN 1 ELSE 0 END;
      IF v_rank > v_pace_rank OR (v_rank = v_pace_rank AND v_rank > 0
           AND coalesce((v_contrib->'pace'->>'seconds')::integer, -1) > coalesce((v_pace->>'seconds')::integer, -1)) THEN
        v_pace_rank := v_rank; v_pace := v_contrib->'pace';
      END IF;
      IF v_contrib->>'targetEffect' IS NOT NULL THEN
        v_rank := CASE v_contrib->>'targetEffect' WHEN 'hold' THEN 3 WHEN 'requeue' THEN 2 WHEN 'requeue_after' THEN 2 ELSE 1 END;
        IF v_rank > v_target_rank THEN
          v_target_rank := v_rank; v_target_effect := v_contrib->>'targetEffect';
          v_requeue_minutes := (v_contrib->>'requeueAfterMinutes')::integer;
        END IF;
      END IF;
      IF NOT coalesce((v_contrib->>'ok')::boolean, false) THEN
        v_note := v_contrib->>'log'; v_last_error_code := v_contrib->>'errorCode'; v_last_action := v_contrib->>'actionCode';
      END IF;
      -- Chuỗi mục tiêu lỗi: increment > reset > ignore (giống aggregateResultEffects).
      IF v_contrib->>'streak' = 'increment' THEN
        v_streak := 'increment';
        IF (v_contrib->>'streakThreshold') IS NOT NULL OR coalesce((v_contrib->>'sideEffect')::boolean, false) THEN v_covered := true; END IF;
      ELSIF v_contrib->>'streak' = 'reset' AND v_streak <> 'increment' THEN
        v_streak := 'reset';
      END IF;
      IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none' AND (v_contrib->>'streakThreshold') IS NOT NULL
         AND v_contrib->>'streak' = 'increment'
         AND (v_thr_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_thr_effect = 'hold')) THEN
        v_thr_effect := v_contrib->>'campaignEffect';
        v_thr_threshold := (v_contrib->>'streakThreshold')::integer;
        v_thr_hold := (v_contrib->>'campaignHoldMinutes')::integer;
        v_thr_source := v_contrib->>'errorCode';
      END IF;
    END LOOP;
    -- Bước đã giao trước đó trong lượt này cũng chặn việc trả về hàng đợi.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown')) THEN
      v_any_committed := true;
    END IF;

    v_target_effect := coalesce(v_target_effect, 'complete');
    IF v_target_effect IN ('requeue', 'requeue_after') AND v_any_committed THEN
      v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'no_requeue_after_delivery', 'from', v_target_effect));
      v_target_effect := 'complete';
    END IF;
    v_final_status := CASE v_target_effect WHEN 'hold' THEN 'tạm dừng' WHEN 'complete' THEN 'hoàn thành' ELSE 'chờ xử lý' END;
    v_schedule := CASE WHEN v_target_effect = 'requeue_after'
      THEN coalesce(v_lock_until_max, v_now + make_interval(mins => coalesce(v_requeue_minutes, 0))) ELSE NULL END;
    -- V501 (G3): data vừa về hàng đợi không được nhận lại trong cùng lượt (claim bỏ qua data đã thử với lease này), nên
    -- lượt chạy tiếp các data phía sau thay vì kết thúc.

    -- Chuỗi lỗi chỉ đổi khi lượt chạy còn mở (báo muộn sau khi data đã bị đóng không đếm lại).
    IF v_run_open AND NOT p_dry_run AND v_streak = 'increment' THEN
      INSERT INTO public.auto_campaign_error_state AS es (campaign_id, count_consecutive_bad_targets, last_input_data_id, last_reason, last_bad_target_at)
      VALUES (r.campaign_id, 1, r.input_data_id, coalesce(v_last_error_code, v_note), v_now)
      ON CONFLICT (campaign_id) DO UPDATE SET count_consecutive_bad_targets = es.count_consecutive_bad_targets + 1,
        last_input_data_id = EXCLUDED.last_input_data_id, last_reason = EXCLUDED.last_reason, last_bad_target_at = EXCLUDED.last_bad_target_at, updated_at = v_now
      RETURNING count_consecutive_bad_targets INTO v_streak_count;
    ELSIF v_run_open AND NOT p_dry_run AND v_streak = 'reset' THEN
      UPDATE public.auto_campaign_error_state SET count_consecutive_bad_targets = 0, updated_at = v_now WHERE campaign_id = r.campaign_id;
      v_streak_count := 0;
    ELSE
      SELECT es.count_consecutive_bad_targets INTO v_streak_count FROM public.auto_campaign_error_state es WHERE es.campaign_id = r.campaign_id;
      v_streak_count := CASE WHEN NOT v_run_open THEN coalesce(v_streak_count, 0)
                             WHEN v_streak = 'increment' THEN coalesce(v_streak_count, 0) + 1
                             WHEN v_streak = 'reset' THEN 0 ELSE coalesce(v_streak_count, 0) END;
    END IF;

    -- Ngưỡng chung: mã tăng chuỗi mà không có ngưỡng/hiệu ứng riêng thì theo mã canh chuỗi
    -- (mặc định err_undefined), giống guard đang chạy ở campaignScheduler.
    IF v_streak = 'increment' AND NOT v_covered AND v_thr_effect = 'none' THEN
      v_guard_code := nullif(btrim(public.aka_agent_engine_setting('engine.bad_target_guard_error_code', 'err_undefined')), '');
      IF v_guard_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = v_guard_code AND e.is_active AND NOT e.is_delete) THEN
        v_gp := public.aka_agent_engine_resolve_policy(v_guard_code, NULL, coalesce(v_last_action, ''), c.action_id, r.runtime_target, 'after_send');
        IF (v_gp->>'streak_threshold') IS NOT NULL AND coalesce(v_gp->>'campaign_effect', 'none') <> 'none' THEN
          v_thr_effect := v_gp->>'campaign_effect';
          v_thr_threshold := (v_gp->>'streak_threshold')::integer;
          v_thr_hold := (v_gp->>'campaign_hold_minutes')::integer;
          v_thr_source := v_guard_code;
        END IF;
      END IF;
    END IF;
    IF v_run_open AND v_thr_effect <> 'none' AND v_streak = 'increment' AND v_streak_count >= v_thr_threshold
       AND (v_camp_effect = 'none' OR (v_thr_effect = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_thr_effect;
      v_camp_hold := v_thr_hold;
      v_camp_note := 'Dừng sau ' || v_streak_count || ' data lỗi/thất bại liên tiếp (ngưỡng ' || v_thr_threshold || '): '
        || coalesce(v_note, 'Lỗi không xác định');
    END IF;

    IF NOT p_dry_run THEN
      IF v_run_open THEN
        -- V515 (D): ghi chú của data là kết quả của lượt chốt này, như bộ chạy Desktop (thành công thì note = null). Trước V515 data từng
        -- về hàng đợi kèm ghi chú (NET01…) rồi gửi thành công vẫn giữ ghi chú cũ.
        UPDATE public.auto_campaign_input_data SET status = v_final_status,
          note = v_note,
          schedule = CASE WHEN v_schedule IS NOT NULL THEN v_schedule ELSE schedule END,
          date_action = v_now
        WHERE id = r.input_data_id AND status = 'đang chạy';
      END IF;
      UPDATE public.auto_engine_target_runs SET marks = r.marks, completed_at = coalesce(completed_at, v_now),
        final_target_status = coalesce(final_target_status, v_final_status), final_error_code = coalesce(final_error_code, v_last_error_code),
        close_reason = coalesce(close_reason, 'reported'), outcome_count = outcome_count + v_outcome_count
      WHERE id = r.id;
    END IF;
  ELSIF NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET marks = r.marks, outcome_count = outcome_count + v_outcome_count WHERE id = r.id;
  END IF;
  -- Còn data đến hạn phía sau không: runtime chỉ nghỉ giữa 2 lần gửi khi còn việc.
  IF v_target_done THEN
    -- V501: không tính data đã thử trong lượt này (lượt sau mới thử lại).
    v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
      WHERE d.campaign_id = r.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
        AND (d.schedule IS NULL OR d.schedule <= v_now)
        AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = r.lease_token));
  END IF;

  -- Hiệu ứng chiến dịch/tài khoản chỉ áp khi còn giữ chỗ; mô phỏng thì chỉ báo sẽ áp gì.
  IF v_lease_ok AND NOT p_dry_run THEN
    IF v_camp_effect <> 'none' THEN
      -- V501: không ghi đè trạng thái người dùng vừa đổi trong lúc data chạy (tạm dừng từ Web/Desktop), như VPS. Hoãn theo
      -- phút chỉ dời lịch khi còn trong ngày, trước giờ dừng (G2).
      UPDATE public.auto_campaigns SET
        status = CASE v_camp_effect WHEN 'pause' THEN 'tạm dừng' ELSE 'chờ xử lý' END,
        schedule = CASE WHEN v_camp_effect = 'hold' AND coalesce(v_camp_hold, 0) > 0
                         AND v_now + make_interval(mins => v_camp_hold)
                             < ((v_vn + least(coalesce(daily_stop_time, time '23:59:00'), time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                        THEN v_now + make_interval(mins => v_camp_hold) ELSE schedule END,
        note = coalesce(v_camp_note, note), updated_at = v_now
      WHERE id = r.campaign_id AND status IN ('đang chạy', 'chờ xử lý');
      GET DIAGNOSTICS v_camp_rows = ROW_COUNT;
      v_camp_applied := CASE WHEN v_camp_rows > 0 THEN v_camp_effect ELSE 'none' END;
    END IF;
    IF v_acc_effect = 'pause' THEN UPDATE public.auto_accounts SET status = 'tạm dừng', updated_at = v_now WHERE id = r.account_id; END IF;
    IF v_login_effect <> 'none' THEN
      UPDATE public.auto_accounts SET login_status = CASE v_login_effect WHEN 'checkpoint' THEN 'checkpoint' ELSE 'chưa đăng nhập' END, updated_at = v_now
       WHERE id = r.account_id;
    END IF;
  ELSIF p_dry_run AND v_lease_ok THEN
    v_camp_applied := v_camp_effect;
  END IF;

  v_next := CASE
    WHEN NOT v_lease_ok THEN 'ownership_lost'
    WHEN NOT v_target_done THEN 'next_step'
    WHEN v_camp_applied <> 'none' OR v_run_rank = 4 THEN 'stop_campaign'
    WHEN v_run_rank = 3 THEN 'stop_account'
    WHEN v_run_rank = 2 THEN 'end_unit'
    ELSE 'next_target' END;

  v_response := jsonb_build_object('ok', true, 'dryRun', p_dry_run, 'next', v_next,
    'pace', CASE WHEN v_target_done THEN v_pace ELSE NULL END,
    'outcomes', v_results,
    'target', jsonb_build_object('done', v_target_done, 'status', v_final_status, 'note', v_note, 'schedule', v_schedule, 'morePending', v_more),
    'streak', CASE WHEN v_target_done THEN jsonb_build_object('effect', v_streak, 'count', v_streak_count, 'threshold', v_thr_threshold, 'source', v_thr_source) END,
    'campaign', jsonb_build_object('effect', v_camp_applied, 'note', CASE WHEN v_camp_applied <> 'none' THEN v_camp_note END),
    'account', jsonb_build_object('effect', v_acc_effect, 'loginEffect', v_login_effect),
    'safety', v_safety);
  -- V515 (B): lưu câu trả lời của lần chốt (không kèm danh sách kết quả, dựng lại từ auto_engine_outcomes khi gọi lại).
  IF v_target_done AND v_run_open AND NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET final_response = v_response - 'outcomes' WHERE id = r.id;
  END IF;
  RETURN v_response;
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_simulate_v1(p_campaign_action_id text, p_runtime_target text, p_outcome jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_action text := p_outcome->>'actionCode';
  v_phase text := coalesce(nullif(p_outcome->>'phase', ''), 'after_send');
  v_platform text;
  v_rule_id bigint;
  v_matched_by text;
  v_catch_all boolean;
  v_status_id bigint;
  v_error_code text;
BEGIN
  SELECT aa.flatform_type INTO v_platform FROM public.auto_account_actions aa WHERE aa.code = v_action;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown'); END IF;
  IF coalesce((p_outcome->>'ok')::boolean, false) THEN
    SELECT s.id INTO v_status_id FROM public.auto_status s WHERE s.code = coalesce(nullif(p_outcome->>'statusCode', ''), 'campaign_detail_success');
  ELSE
    SELECT cs.error_code, cs.rule_id, cs.matched_by, cs.is_catch_all INTO v_error_code, v_rule_id, v_matched_by, v_catch_all
      FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, coalesce(p_outcome->'signal', '{}'::jsonb)) cs;
    v_error_code := coalesce(v_error_code, 'err_undefined');
  END IF;
  RETURN jsonb_build_object('ok', true, 'errorCode', v_error_code, 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
    'isCatchAll', v_catch_all,
    'publicCode', (SELECT e.public_code FROM public.auto_error e WHERE e.error_code = v_error_code),
    'policy', public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, p_campaign_action_id, p_runtime_target, v_phase));
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_finish_campaign_v2(p_account_id bigint, p_lease_token uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Hết data khi còn giữ lease: kết thúc lượt như Desktop (campaignScheduler.ts, cuối executeCampaignV2 + handleCampaignCompletion +
-- rescheduleCompletedCampaignPass), theo đúng thứ tự. Trả lý do; lõi in câu tiến trình theo lý do.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_campaign_id bigint;
  l public.auto_engine_leases%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  v_extra jsonb;
  v_next timestamptz;
  v_cutoff time;
  v_slots text[];
  v_slot text;
  v_slot_minute integer;
  v_current_minute integer;
  v_candidate timestamptz;
  v_next_slot text;
  v_minutes integer;
  v_raw jsonb;
  v_mode text;
  v_suffix text;
  v_total bigint;
  v_resettable bigint;
  v_m text[];
  -- V506: group thời gian thực.
  v_rt_raw text;
  v_rt_key text;
  v_anchor timestamptz;
  v_rt_slot time;
BEGIN
  SELECT el.campaign_id INTO v_campaign_id FROM public.auto_engine_leases el
   WHERE el.account_id = p_account_id AND el.lease_token = p_lease_token AND el.expires_at > v_now;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  -- Thứ tự khoá như bản cũ: khoá nạp data của chiến dịch (cùng khoá với aka_agent_lock_campaign_input_serialization và luồng nạp
  -- Nhóm data), rồi chiến dịch, tài khoản, rồi lease (claim cũng khoá chiến dịch → tài khoản → lease).
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  SELECT * INTO a FROM public.auto_accounts WHERE id = p_account_id FOR UPDATE;
  SELECT * INTO l FROM public.auto_engine_leases
   WHERE account_id = p_account_id AND lease_token = p_lease_token AND expires_at > v_now FOR UPDATE;
  IF NOT FOUND OR l.campaign_id IS DISTINCT FROM v_campaign_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  IF c.id IS NULL OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'campaign_deleted'); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_control_won', 'campaignStatus', c.status);
  END IF;
  -- Review 12/11: máy chưa cập nhật (bộ cũ) đã nhận chiến dịch giữa lúc lõi hết data và lúc kết thúc lượt: không kết thúc / đặt lại
  -- data, như release_v1 và close_stale_v1 (chỉ đụng chiến dịch không còn token của bộ cũ).
  IF c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'legacy_busy');
  END IF;
  -- Như finalizer của VPS: tài khoản Server bị tạm dừng trong lượt thì chiến dịch về "chờ xử lý", không hoàn thành.
  IF l.runtime_target = 'fly' AND a.status IS DISTINCT FROM 'đang chạy' AND a.status IS DISTINCT FROM 'chờ xử lý' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'account_control_won', 'accountStatus', a.status, 'campaignStatus', 'chờ xử lý');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.campaign_id = c.id AND tr.completed_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                 WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Data đến hạn chưa thử trong lượt này (vừa được thêm vào): chạy tiếp, chưa kết thúc.
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)
                AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = p_lease_token)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Review 12/11: bản cũ xoá ghi chú khi bắt đầu mỗi lượt (claim v397); bộ mới chỉ xoá khi nhận được data (chiến dịch sang "đang
  -- chạy"). Lượt không nhận data nào (chiến dịch còn "chờ xử lý", ví dụ mọi data còn lại bị chống gửi lặp tạm dừng) thì ghi chú đang
  -- có là của lượt trước (câu chờ khoá / hạn mức, không kiểm được giới hạn gửi lặp): xoá trước khi hoàn thành / hẹn lại.
  IF c.status = 'chờ xử lý' AND c.note IS NOT NULL THEN
    UPDATE public.auto_campaigns SET note = NULL, updated_at = v_now WHERE id = c.id;
    c.note := NULL;
  END IF;

  -- 0. Như executeCampaignV2 (isZaloFriendAutoDataCampaign && không có data): chiến dịch nhắn bạn bè "toàn bộ / theo tag" đã lấy
  -- data một lần mà không còn dòng nào thì giữ "chờ xử lý" kèm ghi chú, không hoàn thành (chế độ lạ coi như "selected").
  IF c.action_id = 'zalo_message_friend'
     AND coalesce(c.extra_settings->>'zaloFriendTargetMode', 'selected') IN ('all_friends', 'tagged_friends')
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy',
      updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'friend_auto_no_data', 'campaignStatus', 'chờ xử lý');
  END IF;

  -- V506: group thời gian thực, như handleZaloRealtimeGroupCompletion (sau lượt) và prepareZaloRealtimeGroupCampaignRun (lượt không có data
  -- đến hạn) của Desktop, theo đúng thứ tự: data đến hạn còn chờ → chạy lại ngay; data tương lai → hẹn tới data sớm nhất; còn trong ngày
  -- nhận data (zaloRealtimeEndDate, ngày VN của DB) → chờ tới giờ gốc của chiến dịch (hôm nay nếu chưa qua, không thì ngày mai); hết ngày
  -- nhận → hoàn thành. Data do bộ nhận sự kiện của bản cũ đổ vào (enqueue_campaign_zalo_realtime_group_event), không đổi.
  IF c.action_id = 'zalo_message_group_realtime' THEN
    IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                  AND (d.schedule IS NULL OR d.schedule <= v_now)) THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_now, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'realtime_due_pending', 'campaignStatus', 'chờ xử lý');
    END IF;
    SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
    IF v_next IS NOT NULL THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled_future_input', 'schedule', v_next, 'campaignStatus', 'chờ xử lý');
    END IF;
    -- getZaloRealtimeEndDateKey: "YYYY-MM-DD" giữ nguyên (so như chuỗi), dạng khác đọc như ngày giờ rồi lấy ngày VN; sai thì hết hạn.
    v_rt_raw := btrim(coalesce(c.extra_settings->>'zaloRealtimeEndDate', ''));
    v_rt_key := NULL;
    IF v_rt_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_rt_key := v_rt_raw;
    ELSIF v_rt_raw <> '' THEN
      BEGIN
        v_rt_key := to_char((v_rt_raw::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
      EXCEPTION WHEN OTHERS THEN
        v_rt_key := NULL;
      END;
    END IF;
    IF v_rt_key IS NOT NULL AND to_char(v_vn, 'YYYY-MM-DD') <= v_rt_key THEN
      -- getZaloRealtimeWaitSchedule: giờ:phút (VN) của lịch gốc, không có thì lịch hiện tại, không có nữa thì bây giờ.
      v_anchor := coalesce(c.original_schedule, c.schedule, v_now);
      v_rt_slot := date_trunc('minute', (v_anchor AT TIME ZONE 'Asia/Ho_Chi_Minh'))::time;
      v_next := ((v_vn + v_rt_slot)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF v_next <= v_now THEN v_next := (((v_vn + 1) + v_rt_slot)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'); END IF;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      -- Lượt đã chạy data thì "tiếp tục chờ" (sau lượt), chưa chạy data nào thì "đang chờ" (trước lượt), như hai câu của Desktop.
      RETURN jsonb_build_object('ok', true, 'reason', 'realtime_waiting', 'schedule', v_next, 'campaignStatus', 'chờ xử lý',
        'ranTargets', EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.lease_token = p_lease_token AND tr.campaign_id = c.id));
    END IF;
    RETURN public.aka_agent_engine_finalize_v501(c.id, 'Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy',
      'completed_realtime_end', NULL);
  END IF;

  -- 1. Data chưa đến lịch: hẹn chiến dịch tới data sớm nhất (deferCampaignUntilFutureInput), trước mọi nhánh khác.
  SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
   WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
  IF v_next IS NOT NULL THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled_future_input', 'schedule', v_next, 'campaignStatus', 'chờ xử lý');
  END IF;

  -- 2. Nhóm data (handleCampaignCompletion bước 1): đúng hàm kết thúc của bản cũ (aka_agent_internal_finalize_data_group_campaign_v219,
  -- cùng lõi với bản Desktop và bản Zalo Server): data chờ / về hàng đợi → chờ xử lý; nguồn đang nhận → chờ xử lý + "Chờ data mới";
  -- nguồn dừng / hết hạn / bị xoá → hoàn thành. Lease của lượt là bằng chứng sở hữu (thay kiểm runtime của hai bản bọc).
  IF c.data_target_source_mode = 'data_group'
     AND to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_raw
      USING c.staff_id, c.organization_id, c.id, p_note;
    RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN (v_raw->>'completed')::boolean THEN 'data_group_completed' ELSE 'data_group_waiting' END,
      'finalize', v_raw, 'campaignStatus', v_raw->>'status');
  END IF;
  -- Nhóm theo thời gian thực có bộ kết thúc riêng của bản cũ; Nhóm data khi DB chưa có hàm kết thúc (DB thử): không tự hoàn thành
  -- (hoàn thành làm trigger dừng hẳn nguồn Nhóm data).
  IF c.data_target_source_mode = 'data_group' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = c.id AND status = 'đang chạy';
    RETURN jsonb_build_object('ok', false, 'reason', 'completion_not_supported', 'campaignStatus', 'chờ xử lý');
  END IF;

  v_cutoff := least(coalesce(c.daily_stop_time, time '23:59:00'), time '23:59:00');
  v_extra := coalesce(c.extra_settings, '{}'::jsonb);

  -- 3. Hết ngày kết thúc.
  IF c.schedule_end_date IS NOT NULL AND v_now >= c.schedule_end_date THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_end_date', NULL);
  END IF;

  -- 4. Nhiều khung giờ (handleMultiDailyTimeSlotAfterCompletion): khung hiện tại = lịch lúc bắt đầu lượt, phải cùng ngày hôm nay.
  IF c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb THEN
    -- Tách theo dấu phẩy/xuống dòng, chuẩn hoá H, H:M, HhM, Hh (giờ 0–23, phút 0–59), bỏ trùng theo phút, xếp tăng dần.
    SELECT coalesce(array_agg(s.slot ORDER BY s.minute), '{}'::text[]) INTO v_slots FROM (
      SELECT DISTINCT ON (x.minute) x.minute, x.slot FROM (
        SELECT (m[1])::integer * 60 + coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer AS minute,
               lpad(m[1]::integer::text, 2, '0') || ':' || lpad(coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer::text, 2, '0') AS slot
          FROM regexp_split_to_table(CASE jsonb_typeof(v_extra->'multiDailyTimeSlots') WHEN 'string' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'number' THEN v_extra->>'multiDailyTimeSlots' ELSE '' END, '[,\r\n]+') item,
               LATERAL regexp_match(regexp_replace(lower(btrim(item)), '\s+', '', 'g'), '^(\d{1,2})(?::(\d{1,2})|h(\d{1,2})?|h)?$') m
         WHERE m IS NOT NULL AND (m[1])::integer BETWEEN 0 AND 23 AND coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer BETWEEN 0 AND 59
      ) x ORDER BY x.minute
    ) s;
    IF cardinality(v_slots) >= 2 AND l.campaign_schedule IS NOT NULL
       AND (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_vn THEN
      v_current_minute := extract(hour FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer * 60
                        + extract(minute FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer;
      FOREACH v_slot IN ARRAY v_slots LOOP
        v_slot_minute := split_part(v_slot, ':', 1)::integer * 60 + split_part(v_slot, ':', 2)::integer;
        CONTINUE WHEN v_slot_minute <= v_current_minute;
        v_candidate := ((v_vn + make_interval(mins => v_slot_minute))::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
        CONTINUE WHEN v_candidate <= v_now;
        v_next_slot := v_slot;
        EXIT;
      END LOOP;
      IF v_next_slot IS NULL THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_slot', NULL);
      END IF;
      IF (v_candidate AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_slot_after_cutoff', jsonb_build_object('slot', v_next_slot));
      END IF;
      v_next := v_candidate;
      v_mode := 'slot_advanced';
      v_suffix := 'ở khung giờ tiếp theo';
    END IF;
  END IF;

  -- 5. Gửi lặp lại sau x phút (handleZaloShareRepeatAfterCompletion): nhắn bạn bè/nhóm dạng chia sẻ, không nhiều khung giờ,
  -- không bật chống gửi lặp N ngày, số phút 5–1439 (số, hoặc chuỗi 1–4 chữ số).
  IF v_mode IS NULL AND c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'zaloShareRepeatEnabled' = 'true'::jsonb
     AND v_extra->>'zaloMessageSendMode' = 'share' AND v_extra->'multiDailyTimeSlotsEnabled' IS DISTINCT FROM 'true'::jsonb
     AND v_extra->'recentDeliveryCooldownEnabled' IS DISTINCT FROM 'true'::jsonb THEN
    v_raw := v_extra->'zaloShareRepeatAfterMinutes';
    v_minutes := CASE
      WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\d+$' THEN (v_raw #>> '{}')::integer
      WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\d{1,4}$' THEN btrim(v_raw #>> '{}')::integer END;
    IF v_minutes BETWEEN 5 AND 1439 THEN
      v_next := v_now + make_interval(mins => v_minutes);
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         OR (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> v_vn THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_next_day', NULL);
      END IF;
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_after_cutoff', NULL);
      END IF;
      v_mode := 'repeat_scheduled';
      v_suffix := 'ở lượt gửi lặp kế tiếp';
    END IF;
  END IF;

  IF v_mode IS NULL THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed', NULL);
  END IF;

  -- 6. Hẹn lượt kế tiếp (rescheduleCompletedCampaignPass).
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.', updated_at = v_now
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'due_pending', 'campaignStatus', 'chờ xử lý');
  END IF;
  SELECT count(*), count(*) FILTER (WHERE d.status <> 'tạm dừng') INTO v_total, v_resettable
    FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false;
  IF v_resettable = 0 THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_data', jsonb_build_object('suffix', v_suffix));
  END IF;
  UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
   WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END;
END $function$
;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'f8ae40ad89e10800c79e02b4c1a53a30' THEN
    RAISE EXCEPTION 'Gỡ V558 postflight: định nghĩa claim %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v558_acl_claim', true) THEN RAISE EXCEPTION 'Gỡ V558 postflight: quyền / chủ sở hữu claim bị đổi'; END IF;
  v_oid := 'public.aka_agent_engine_action_limit(bigint,bigint,text)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'c5f111aa29b900b203002561af91d7da' THEN
    RAISE EXCEPTION 'Gỡ V558 postflight: định nghĩa limit %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v558_acl_limit', true) THEN RAISE EXCEPTION 'Gỡ V558 postflight: quyền / chủ sở hữu limit bị đổi'; END IF;
  v_oid := 'public.aka_agent_engine_resolve_policy(text,bigint,text,text,text,text)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '64738ead899b8ba0a950ff0611345c14' THEN
    RAISE EXCEPTION 'Gỡ V558 postflight: định nghĩa resolve %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v558_acl_resolve', true) THEN RAISE EXCEPTION 'Gỡ V558 postflight: quyền / chủ sở hữu resolve bị đổi'; END IF;
  v_oid := 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'bc39ed663474fefd61de0d8c20454168' THEN
    RAISE EXCEPTION 'Gỡ V558 postflight: định nghĩa report %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v558_acl_report', true) THEN RAISE EXCEPTION 'Gỡ V558 postflight: quyền / chủ sở hữu report bị đổi'; END IF;
  v_oid := 'public.aka_agent_engine_simulate_v1(text,text,jsonb)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '52d97c4c33ad864896a377f4c9d656b5' THEN
    RAISE EXCEPTION 'Gỡ V558 postflight: định nghĩa simulate %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v558_acl_simulate', true) THEN RAISE EXCEPTION 'Gỡ V558 postflight: quyền / chủ sở hữu simulate bị đổi'; END IF;
  v_oid := 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '465814c236ca1de74228a6d402b9f9f4' THEN
    RAISE EXCEPTION 'Gỡ V558 postflight: định nghĩa finish %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v558_acl_finish', true) THEN RAISE EXCEPTION 'Gỡ V558 postflight: quyền / chủ sở hữu finish bị đổi'; END IF;
END $post$;

COMMIT;
