-- V564: engine v2 Facebook xáo trộn danh sách group như bộ cũ. SINH TỪ scripts/build-v564-sql.cjs, không sửa tay.
-- Thay thân aka_agent_engine_claim_target_v1 (giữ chữ ký, chủ sở hữu, quyền). Chỉ chiến dịch "Đăng bài vào group" bật "Xáo trộn danh sách
-- group" đổi cách chọn data: mỗi lượt (lease) một thứ tự ngẫu nhiên riêng (md5 theo lease), lần nhận đầu của lượt trả thêm shuffle.count cho
-- dòng 🔀. Mọi chiến dịch khác (Zalo, Facebook không bật xáo trộn) giữ câu chọn và câu trả lời như V558.
-- Nguồn = pg_get_functiondef production 18/11/2026 (bản V558): claim 7ddfa216286849296e6b537c120e291d. Bản mới: 03d72830d664682c1f51dc3dd9944eda.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v564_engine_facebook_shuffle_groups.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v564_%') THEN
      RAISE EXCEPTION 'V564 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  v_oid := to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V564: không có public.aka_agent_engine_claim_target_v1(jsonb)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '03d72830d664682c1f51dc3dd9944eda' THEN RAISE EXCEPTION 'V564 đã chạy (claim)'; END IF;
  IF v_md5 IS DISTINCT FROM '7ddfa216286849296e6b537c120e291d' THEN RAISE EXCEPTION 'V564: định nghĩa claim khác bản production 18/11 (V558), dừng để đối chiếu bản live (claim: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v564_acl_claim', v_acl, true);
END $pre$;

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
  -- V558: lượt theo lịch (loại chiến dịch không có dòng data: trang cá nhân, newsfeed Facebook).
  v_slot_mode boolean := coalesce(p_ctx->>'mode', '') = 'campaign_slot';
  v_slot timestamptz;
  v_is_facebook boolean;
  -- V558: chỉ nhận đúng các data này (ctx.inputDataIds), trong lượt đang giữ lease.
  v_only_ids bigint[];
  -- V564: chiến dịch đăng nhóm bật "Xáo trộn danh sách group" (như bộ cũ xáo các data chờ ở đầu mỗi lượt).
  v_shuffle boolean := false;
  v_shuffle_count integer;
BEGIN
  IF v_staff IS NULL OR v_account_id IS NULL OR v_campaign_id IS NULL OR v_runner IS NULL OR v_runtime IS NULL OR v_runtime NOT IN ('desktop','fly') THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  -- Desktop chỉ nhận việc của chính nhân viên đăng nhập, và chỉ với vai trò Desktop.
  IF public.aka_agent_engine_desktop_staff() IS NOT NULL AND v_runtime <> 'desktop' THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  IF NOT public.aka_agent_engine_scope_ok(v_staff) THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  -- V558: nhận thêm đúng các data này vào lượt đang chạy (đăng nhóm Facebook kèm chia sẻ sang các nhóm đã chọn trong hộp đăng bài, như bộ
  -- cũ giữ chỗ các nhóm chia sẻ cùng data chính). Chỉ khi đang giữ lease, không cho lượt theo lịch, tối đa 50 id.
  IF p_ctx ? 'inputDataIds' THEN
    IF v_req_token IS NULL OR v_slot_mode OR jsonb_typeof(p_ctx->'inputDataIds') <> 'array'
       OR jsonb_array_length(p_ctx->'inputDataIds') NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_ctx->'inputDataIds') x
                   WHERE jsonb_typeof(x.value) <> 'number' OR x.value::text !~ '^[0-9]{1,18}$') THEN
      RETURN jsonb_build_object('status', 'invalid_request');
    END IF;
    SELECT array_agg(DISTINCT x.value::text::bigint) INTO v_only_ids FROM jsonb_array_elements(p_ctx->'inputDataIds') x;
  END IF;

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
  -- V558: tài khoản Facebook bắt đầu lượt trên Desktop: cùng khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397 khoá chung
  -- cho Zalo trình duyệt và Facebook), để hai lượt nhận cùng lúc không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook') THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
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
  -- V558: tài khoản Facebook chỉ chạy engine trên Desktop, khi tổ chức bật engine.facebook (anh chốt Q1). Kiểm mỗi lần nhận lượt: tắt
  -- (mode off / bỏ tổ chức khỏi danh sách) có hiệu lực ở lần nhận kế tiếp, Desktop nhận not_enabled thì chạy bộ cũ.
  v_is_facebook := lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  IF v_is_facebook THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_engine_facebook_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
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
  -- V558: quyền gói Facebook như bộ cũ (entitlementRepository: Facebook dùng được khi tổ chức có gói sản phẩm 3 hoặc 10 còn hạn).
  IF v_is_facebook AND v_org IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.org_organization_product p
                      WHERE p.organization_id = v_org AND p.is_deleted = false AND p.product_id IN (3, 10)
                        AND p.expiration_date IS NOT NULL AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_vn) THEN
    RETURN jsonb_build_object('status', 'entitlement_denied');
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
  -- V558: giới hạn số tài khoản Facebook chạy đồng thời của nhân viên, đếm như claim bản cũ (v397): chiến dịch "đang chạy" hoặc còn token
  -- của bộ cũ, trên tài khoản Facebook khác của nhân viên. Chỉ khi bắt đầu lượt (chưa giữ lease): lượt đang chạy không bị cắt.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND v_is_facebook AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook';
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

  -- V558: lượt theo lịch (Q4). Mốc lịch = lịch của chiến dịch lúc nhận (chưa có lịch thì lúc tạo). Mỗi mốc chạy một lượt: mốc đã có lượt
  -- đang mở, đã thử với lease này, hoặc đã đóng mà không phải "về hàng đợi" (chờ xử lý) thì xong; claim trả no_target để nơi chạy kết thúc
  -- lượt (finish_campaign tính lịch kế tiếp như bộ cũ). Mỗi chiến dịch tối đa một lượt theo lịch đang mở (chỉ mục V557).
  IF v_slot_mode THEN
    v_slot := coalesce(c.schedule, c.created_at, v_now);
    IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr
                WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL
                  AND (tr.completed_at IS NULL
                       OR (tr.slot_at = v_slot AND (tr.lease_token = v_token OR tr.final_target_status IS DISTINCT FROM 'chờ xử lý')))) THEN
      RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token, 'nextSchedule', NULL,
        'runningTargets', (SELECT count(*) FROM public.auto_engine_target_runs tr
                            WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL AND tr.completed_at IS NULL),
        'hasTargets', true, 'dueTried', 0, 'dataGroup', false, 'slot', true, 'slotAt', v_slot, 'cooldownPaused', '[]'::jsonb);
    END IF;
  END IF;
  -- V501 (G3): mỗi data chỉ thử một lần trong một lượt (như Desktop đi qua danh sách một lần): data vừa về hàng đợi
  -- được thử lại ở lượt sau, các data phía sau vẫn chạy trong lượt này.
  -- V501: chống gửi lặp N ngày (applyRecentDeliveryCooldown của Desktop, trước khi nhận data và trước bước tra số): gọi đúng
  -- RPC của bộ cũ cho data sắp nhận (còn "chờ xử lý", đã khoá). RPC tự tạm dừng data đã gửi gần đây; lõi in "⏸️ Bỏ qua …".
  -- Không ghi lịch sử, không tính lượt, không đổi chuỗi lỗi, không nghỉ. Mỗi lần gọi xét tối đa 50 data, và dừng khi hết ngân sách
  -- thời gian (engine.cooldown_scan_ms, mặc định 1.500 ms tính từ đầu lần gọi; review 12/11): lần gọi từ Desktop có trần 3 giây của
  -- vai trò aka_agent_desktop, quá trần thì cả lần gọi bị huỷ (kể cả các data đã tạm dừng) và lần gọi lại làm lại từ đầu. Trả
  -- cooldown_scan thì các data đã tạm dừng được giữ, lõi gọi lại ngay và đi tiếp từ data kế tiếp.
  v_cooldown := NOT v_slot_mode AND coalesce(c.extra_settings->'recentDeliveryCooldownEnabled' = 'true'::jsonb, false)
    AND to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') IS NOT NULL;
  v_cd_deadline := v_now + make_interval(secs => (CASE WHEN public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500') ~ '^[0-9]{1,6}$'
                                                       THEN greatest(1, public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500')::integer)
                                                       ELSE 1500 END) / 1000.0);
  -- V503: nhận cả lô (claim_batch_v1) đặt một mốc chung cho mọi lần nhận trong lô, để cả lời gọi không chạm trần 3 giây của Desktop.
  IF nullif(current_setting('aka.engine.claim_deadline', true), '') IS NOT NULL THEN
    v_cd_deadline := least(v_cd_deadline, current_setting('aka.engine.claim_deadline', true)::timestamptz);
  END IF;
  -- V564: đăng nhóm bật "Xáo trộn danh sách group" (lưu kiểu boolean, đo 18/11): xáo khi nhận data kế tiếp của lượt; nhận theo danh sách
  -- inputDataIds (nhóm chia sẻ kèm) và lượt theo lịch không xáo. Mọi chiến dịch khác giữ câu chọn theo d.id + 0 (V532).
  v_shuffle := NOT v_slot_mode AND v_only_ids IS NULL AND c.action_id = 'facebook_group_post'
    AND coalesce(c.extra_settings->'shuffleGroupList' = 'true'::jsonb, false);
  LOOP
    EXIT WHEN v_slot_mode;
    -- V532: sắp theo d.id + 0 (cùng thứ tự) để planner không đi khoá chính auto_campaign_input_data_pkey. Kế hoạch theo tham số có lúc
    -- quét khoá chính từ id nhỏ nhất rồi lọc theo chiến dịch (chiến dịch 34061 ngày 14/11/2026: lọc 12,26 triệu dòng, 6,8 giây, quá
    -- trần 3 giây của Desktop). Sắp theo biểu thức buộc lấy data của chiến dịch qua chỉ mục theo chiến dịch rồi mới sắp (vài chục ms).
    IF v_shuffle THEN
      -- V564: thứ tự ngẫu nhiên theo lượt (md5 theo lease): trong lượt giữ nguyên, lượt sau (lease mới) khác, như bộ cũ xáo ở đầu lượt.
      SELECT d.* INTO t FROM public.auto_campaign_input_data d
       WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
         AND (d.schedule IS NULL OR d.schedule <= v_now)
         AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
         AND d.id <> ALL (v_cd_skip)
       ORDER BY md5(d.id::text || v_token::text), d.id LIMIT 1 FOR UPDATE SKIP LOCKED;
    ELSE
      SELECT d.* INTO t FROM public.auto_campaign_input_data d
       WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
         AND (d.schedule IS NULL OR d.schedule <= v_now)
         AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
         AND d.id <> ALL (v_cd_skip)
         AND (v_only_ids IS NULL OR d.id = ANY (v_only_ids))
       ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;
    END IF;
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
  IF NOT v_found AND NOT v_slot_mode THEN
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

  -- V564: lần nhận đầu của lượt ở chiến dịch xáo trộn (lease mới, hoặc lõi báo lượt chưa nhận data nào: lần gọi trước trả cooldown_scan đã
  -- cấp lease): số data chờ đến hạn lúc bắt đầu lượt (kể cả data vừa nhận, chưa chuyển "đang chạy"), để lõi in "🔀 Đã xáo trộn danh sách N
  -- group" như bộ cũ (N > 1).
  IF v_shuffle AND (v_req_token IS DISTINCT FROM v_token OR p_ctx->>'unitStarted' = 'false') THEN
    SELECT count(*)::integer INTO v_shuffle_count FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
       AND (d.schedule IS NULL OR d.schedule <= v_now);
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
    INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id, runtime_target, started_at,
      slot_at)
    VALUES (CASE WHEN v_slot_mode THEN NULL ELSE t.id END, v_campaign_id, v_account_id, v_staff, c.organization_id, v_token, v_runner, v_runtime, v_now,
      CASE WHEN v_slot_mode THEN v_slot END)
    RETURNING id INTO v_run_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'app_access%' THEN RAISE; END IF;
    DELETE FROM public.auto_engine_leases WHERE account_id = v_account_id AND lease_token = v_token;
    RETURN jsonb_build_object('status', 'app_access_denied', 'reason', SQLERRM);
  END;

  RETURN jsonb_build_object('status', 'claimed', 'targetRunId', v_run_id, 'leaseToken', v_token,
    'leaseExpiresAt', v_now + make_interval(secs => v_lease_seconds),
    'target', CASE WHEN v_slot_mode
                THEN jsonb_build_object('id', NULL, 'campaign_id', c.id, 'name', c.name, 'phone', NULL, 'uid', NULL, 'email', NULL,
                       'status', 'đang chạy', 'slotAt', v_slot)
                ELSE (to_jsonb(t) - 'status') || jsonb_build_object('status', 'đang chạy') END,
    'targetKey', v_target_key, 'actions', v_decisions,
    -- Cấu hình cổng kiểm cho adapter (on_error: open = lỗi kiểm vẫn gửi; closed = chờ rồi thử lại).
    'gates', (SELECT coalesce(jsonb_object_agg(g.code, jsonb_build_object('onError', g.on_error)), '{}'::jsonb) FROM public.auto_engine_gates g),
    'campaign', jsonb_build_object('id', c.id, 'actionId', c.action_id, 'status', 'đang chạy'),
    'cooldownPaused', v_cd_paused)
    -- V564: chỉ chiến dịch xáo trộn, lần nhận đầu của lượt; câu trả lời của mọi chiến dịch khác không đổi.
    || CASE WHEN v_shuffle_count IS NOT NULL THEN jsonb_build_object('shuffle', jsonb_build_object('count', v_shuffle_count)) ELSE '{}'::jsonb END;
END $function$
;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '03d72830d664682c1f51dc3dd9944eda' THEN
    RAISE EXCEPTION 'V564 postflight: định nghĩa claim %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v564_acl_claim', true) THEN RAISE EXCEPTION 'V564 postflight: quyền / chủ sở hữu claim bị đổi'; END IF;
END $post$;

COMMIT;
