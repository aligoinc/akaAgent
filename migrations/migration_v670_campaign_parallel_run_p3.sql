-- V670 p3: "Chạy cùng lúc", làn giữ chỗ của engine v2. SINH TỪ scripts/build-v670-sql.cjs, không sửa tay.
-- auto_engine_leases: thêm lane ('main' cho dòng đang có), action_id, action_codes; khoá chính (account_id) → (account_id, lane).
-- Thay thân claim_target_v1, release_v1, close_stale_v1, health_v1, create_control_campaign_v2 (giữ chữ ký, chủ sở hữu, quyền); thêm
-- aka_agent_engine_parallel_wait_v1 (chỉ đọc). Đổi khoá chính và thay claim cùng một giao dịch (claim cũ dùng ON CONFLICT (account_id)).
-- Nguồn: claim = thân sau V667 (V666 loại trừ gửi + V667 nơi chạy 'server'), 5 hàm còn lại = pg_get_functiondef production 26/11/2026:
-- claim df4b8e4284c911dad4b275383f7ddb2b, release 98f1c7c681578426195214e1fe8b4f64, close_stale 8ed4775297c061bc35cbc6f0944dc905, health eca4b5f1773ccc4b51b83c690b01565a, create_v2 661579fa2e8b6571f429079dd0b89c0a, update_atomic a86278195e18d1ef8d0091b41d1d0c5b.
-- Bản mới: claim 8d45e070990c03a5a98884f5660a19e6, release 85ee6d8541b0d5cd0462063dc11bccf0, close_stale b4e2c1664e90212edec6fa2bfd036009, health 57e92899db9a4a784a04e66fba205d56, create_v2 532953944687fe2ee6a50612f97418ec, update_atomic 5e2c0fdaee6a786a05e3724fa2ea35e4.
-- Cần p1, p2 và migration_v667_engine_server_runtime_p2 (V667 cũng thay claim; V670 dựng trên thân V667). DDL làm PostgREST nạp lại schema: apply ngoài giờ cao
-- điểm. Gỡ: rollback_v670_campaign_parallel_run.sql (trước khi gỡ V667).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v670_campaign_parallel_run_p3') THEN
      RAISE EXCEPTION 'migration_v670_campaign_parallel_run_p3 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaign_actions'::regclass AND attname = 'allow_parallel_run' AND NOT attisdropped) OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname = 'parallel_run_enabled' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V670 p3: chạy p1, p2 trước';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_engine_leases'::regclass AND attname = 'lane' AND NOT attisdropped) THEN RAISE EXCEPTION 'V670 p3 đã chạy (auto_engine_leases.lane đã có)'; END IF;
  IF to_regprocedure('public.aka_agent_engine_parallel_wait_v1(bigint, text[])') IS NOT NULL THEN RAISE EXCEPTION 'V670 p3: public.aka_agent_engine_parallel_wait_v1(bigint, text[]) đã có'; END IF;
  -- Hai IF lồng nhau: một biểu thức "to_regclass(...) IS NOT NULL AND NOT EXISTS (...)" vẫn lỗi khi không có bảng sổ (phân tích cả biểu thức).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v667_engine_server_runtime_p2') THEN
      RAISE EXCEPTION 'V670 p3: cần migration_v667_engine_server_runtime_p2 trước (cùng thay aka_agent_engine_claim_target_v1, V670 dựng trên bản của V667)';
    END IF;
  END IF;
  IF to_regprocedure('private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'V670 p3: thiếu private.aka_agent_send_exclusion_claim_check (V666 loại trừ gửi)';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V670 p3: không có public.aka_agent_engine_claim_target_v1(jsonb)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '8d45e070990c03a5a98884f5660a19e6' THEN RAISE EXCEPTION 'V670 p3 đã chạy (claim)'; END IF;
  IF v_md5 IS DISTINCT FROM 'df4b8e4284c911dad4b275383f7ddb2b' THEN
    RAISE EXCEPTION 'V670 p3: định nghĩa claim khác bản sau V667, dừng để đối chiếu bản live (claim: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v670_acl_claim', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V670 p3: không có public.aka_agent_engine_release_v1(bigint,uuid)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '85ee6d8541b0d5cd0462063dc11bccf0' THEN RAISE EXCEPTION 'V670 p3 đã chạy (release)'; END IF;
  IF v_md5 IS DISTINCT FROM '98f1c7c681578426195214e1fe8b4f64' THEN
    RAISE EXCEPTION 'V670 p3: định nghĩa release khác bản production 26/11, dừng để đối chiếu bản live (release: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v670_acl_release', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V670 p3: không có public.aka_agent_engine_close_stale_v1(integer)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'b4e2c1664e90212edec6fa2bfd036009' THEN RAISE EXCEPTION 'V670 p3 đã chạy (close_stale)'; END IF;
  IF v_md5 IS DISTINCT FROM '8ed4775297c061bc35cbc6f0944dc905' THEN
    RAISE EXCEPTION 'V670 p3: định nghĩa close_stale khác bản production 26/11, dừng để đối chiếu bản live (close_stale: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v670_acl_close_stale', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_health_v1(integer)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V670 p3: không có public.aka_agent_engine_health_v1(integer)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '57e92899db9a4a784a04e66fba205d56' THEN RAISE EXCEPTION 'V670 p3 đã chạy (health)'; END IF;
  IF v_md5 IS DISTINCT FROM 'eca4b5f1773ccc4b51b83c690b01565a' THEN
    RAISE EXCEPTION 'V670 p3: định nghĩa health khác bản production 26/11, dừng để đối chiếu bản live (health: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v670_acl_health', v_acl, true);
  v_oid := to_regprocedure('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V670 p3: không có public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '532953944687fe2ee6a50612f97418ec' THEN RAISE EXCEPTION 'V670 p3 đã chạy (create_v2)'; END IF;
  IF v_md5 IS DISTINCT FROM '661579fa2e8b6571f429079dd0b89c0a' THEN
    RAISE EXCEPTION 'V670 p3: định nghĩa create_v2 khác bản production 26/11, dừng để đối chiếu bản live (create_v2: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v670_acl_create_v2', v_acl, true);
  v_oid := to_regprocedure('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V670 p3: không có public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '5e2c0fdaee6a786a05e3724fa2ea35e4' THEN RAISE EXCEPTION 'V670 p3 đã chạy (update_atomic)'; END IF;
  IF v_md5 IS DISTINCT FROM 'a86278195e18d1ef8d0091b41d1d0c5b' THEN
    RAISE EXCEPTION 'V670 p3: định nghĩa update_atomic khác bản production 26/11, dừng để đối chiếu bản live (update_atomic: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v670_acl_update_atomic', v_acl, true);
END $pre$;

ALTER TABLE public.auto_engine_leases ADD COLUMN lane text NOT NULL DEFAULT 'main';
ALTER TABLE public.auto_engine_leases ADD COLUMN action_id text;
ALTER TABLE public.auto_engine_leases ADD COLUMN action_codes text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.auto_engine_leases DROP CONSTRAINT auto_engine_leases_pkey;
ALTER TABLE public.auto_engine_leases ADD CONSTRAINT auto_engine_leases_pkey PRIMARY KEY (account_id, lane);
COMMENT ON COLUMN public.auto_engine_leases.lane IS
  'Chạy cùng lúc (V670): ''main'' cho chiến dịch thường (như trước), mã loại chiến dịch cho chiến dịch có tích "Chạy cùng lúc". Mỗi tài khoản mỗi làn một lease.';

CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- V666: bộ chạy chưa báo chạy được loại trừ mới mà chiến dịch có cấu hình mới cho tài khoản: tạm dừng (aka_agent_send_exclusion_claim_check).
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
  v_excl boolean := false;
  v_ex_note text;
  v_legacy_setting text;
  v_legacy_before timestamptz;
  -- V558: lượt theo lịch (loại chiến dịch không có dòng data: trang cá nhân, newsfeed Facebook).
  v_slot_mode boolean := coalesce(p_ctx->>'mode', '') = 'campaign_slot';
  v_slot timestamptz;
  v_is_facebook boolean;
  -- Quét data website: số lượt đã dùng trong ngày / trong khung giờ của mã thao tác web (để trả số lượt còn lại).
  v_web_day numeric;
  v_web_window numeric;
  -- V558: chỉ nhận đúng các data này (ctx.inputDataIds), trong lượt đang giữ lease.
  v_only_ids bigint[];
  -- V564: chiến dịch đăng nhóm bật "Xáo trộn danh sách group" (như bộ cũ xáo các data chờ ở đầu mỗi lượt).
  v_shuffle boolean := false;
  v_shuffle_count integer;
  -- V571: kiểm người nhận trên toàn hệ thống (engine.target_check).
  v_tc jsonb;                       -- {thao tác: mã} người nhận đã biết hỏng (mã đang bật, còn hiệu lực)
  v_tc_global text;                 -- global id của người nhận (zalo_users theo tài khoản + UID)
  v_tc_friend boolean := false;     -- tài khoản gửi đã là bạn bè (zalo_users.is_fr)
  v_tc_sends jsonb;                 -- mọi bước gửi đã biết hỏng: {thao tác gửi: mã}, bỏ luôn bước tìm SĐT
  -- "Chạy cùng lúc": làn giữ chỗ của lượt ('main' hoặc mã loại chiến dịch), thao tác của lượt, chiến dịch làn khác đang chặn.
  v_lane text;
  v_codes text[];
  v_par record;
BEGIN
  IF v_staff IS NULL OR v_account_id IS NULL OR v_campaign_id IS NULL OR v_runner IS NULL OR v_runtime IS NULL OR v_runtime NOT IN ('desktop','fly','server') THEN
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
  -- Tài khoản Zalo Server chạy trên VPS (App Server, nơi chạy 'server'): tổ chức đang chạy Server trên Fly thì VPS không còn giữ tài khoản
  -- (App Server tự thả tổ chức trong vòng 60 giây); tổ chức chưa bật engine.zalo_server_vps thì App Server chạy bộ cũ. Kiểm mỗi lần nhận
  -- lượt nên tắt công tắc có hiệu lực ở lần nhận kế tiếp.
  IF v_runtime = 'server' THEN
    IF public.aka_agent_zalo_server_flag_route(c.organization_id) THEN
      RETURN jsonb_build_object('status', 'runtime_not_owner');
    END IF;
    IF NOT public.aka_agent_engine_server_org_enabled(c.organization_id) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
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
  -- Quét data website (tài khoản "Website"): chỉ Desktop, chỉ tổ chức bật web_scan.campaigns. Kiểm mỗi lần nhận lượt; tắt có hiệu lực ở lần
  -- nhận kế tiếp. Tài khoản web không cần gói (anh chốt: mở theo tổ chức, lúc đầu chỉ tổ chức 1).
  IF lower(btrim(coalesce(a.flatform_type, ''))) = 'web' THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_web_scan_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
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
  IF (v_runtime IN ('fly', 'server') AND (lower(btrim(coalesce(a.flatform_type, ''))) <> 'zalo' OR coalesce(a.is_zalo_show_web, false)
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

  -- "Chạy cùng lúc" (anh chốt 26/11/2026): làn giữ chỗ. Lease đang giữ (leaseToken) ở làn nào thì giữ làn đó. Lượt mới: chiến dịch có tích
  -- (parallel_run_enabled) của tài khoản Zalo mà loại được akaBiz bật (allow_parallel_run) giữ làn riêng của loại (lane = action_id); mọi
  -- chiến dịch khác giữ làn 'main' như trước.
  IF v_req_token IS NOT NULL THEN
    SELECT el.lane INTO v_lane FROM public.auto_engine_leases el WHERE el.account_id = v_account_id AND el.lease_token = v_req_token;
  END IF;
  IF v_lane IS NULL THEN
    v_lane := CASE WHEN c.parallel_run_enabled
                    AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
                    AND nullif(btrim(coalesce(c.action_id, '')), '') IS NOT NULL
                    AND coalesce((SELECT ca.allow_parallel_run FROM public.auto_campaign_actions ca WHERE ca.id = c.action_id), false)
                   THEN c.action_id ELSE 'main' END;
  END IF;
  -- Giữ chỗ tài khoản có hạn (theo làn). Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ
  -- vẫn "đang chạy" và chỉ được aka_agent_engine_close_stale_v1 đóng (không bao giờ gửi lại).
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = v_account_id AND lane = v_lane FOR UPDATE;
  v_has_lease := FOUND;
  IF v_has_lease AND l.expires_at > v_now AND l.lease_token IS DISTINCT FROM v_req_token THEN
    RETURN jsonb_build_object('status', 'busy', 'runnerId', l.runner_id, 'expiresAt', l.expires_at);
  END IF;
  v_token := CASE WHEN v_has_lease AND l.lease_token = v_req_token AND l.expires_at > v_now THEN l.lease_token ELSE gen_random_uuid() END;
  v_codes := ARRAY(SELECT DISTINCT x.value->>'code'
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_ctx->'actions') = 'array' THEN p_ctx->'actions' ELSE '[]'::jsonb END) x
                    WHERE nullif(btrim(coalesce(x.value->>'code', '')), '') IS NOT NULL);
  -- Bắt đầu lượt mới (chưa giữ lease còn hạn ở làn này) mà làn khác của tài khoản đang chạy chiến dịch cùng loại, hay dùng chung thao tác:
  -- chờ, không giữ chỗ, không ghi gì (mỗi loại một chiến dịch; chung thao tác thì chờ như trước). Chỉ thấy gì khi tài khoản đang có làn
  -- khác 'main', tức có chiến dịch có tích đang chạy. Dòng tài khoản đã khoá FOR UPDATE ở trên nên hai lượt nhận cùng tài khoản đi lần lượt.
  IF v_token IS DISTINCT FROM v_req_token THEN
    -- Chính chiến dịch này còn lease ở làn khác (làn đổi giữa hai lượt vì khách đổi ô tích hay akaBiz đổi loại, lượt trước dừng đột ngột chưa
    -- nhả): như lease còn hạn của lượt trước khi chưa có làn, busy tới khi lease đó hết hạn hoặc được nhả; một chiến dịch không chạy ở hai làn.
    SELECT o.runner_id, o.expires_at INTO v_par FROM public.auto_engine_leases o
     WHERE o.account_id = v_account_id AND o.lane <> v_lane AND o.expires_at > v_now AND o.campaign_id = c.id
     ORDER BY o.acquired_at LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'busy', 'runnerId', v_par.runner_id, 'expiresAt', v_par.expires_at);
    END IF;
    SELECT o.campaign_id, (o.action_id IS NOT DISTINCT FROM c.action_id) AS same_type,
           ARRAY(SELECT x FROM unnest(o.action_codes) x WHERE x = ANY (v_codes) ORDER BY 1) AS codes
      INTO v_par
      FROM public.auto_engine_leases o
     WHERE o.account_id = v_account_id AND o.lane <> v_lane AND o.expires_at > v_now
       AND (o.action_id = c.action_id OR o.action_codes && v_codes)
     ORDER BY o.acquired_at, o.lane LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'parallel_wait', 'campaignId', v_par.campaign_id,
        'campaignName', (SELECT x.name FROM public.auto_campaigns x WHERE x.id = v_par.campaign_id),
        'reason', CASE WHEN v_par.same_type THEN 'same_type' ELSE 'same_action' END,
        'actionCodes', to_jsonb(v_par.codes));
    END IF;
  END IF;
  -- V501: campaign_schedule = lịch của chiến dịch lúc bắt đầu lượt (khung giờ hiện tại của chiến dịch nhiều khung giờ).
  INSERT INTO public.auto_engine_leases AS el (account_id, lane, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at,
    campaign_schedule, action_id, action_codes)
  VALUES (v_account_id, v_lane, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds),
    c.schedule, c.action_id, coalesce(v_codes, ARRAY[]::text[]))
  ON CONFLICT (account_id, lane) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,
    campaign_schedule = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.campaign_schedule ELSE EXCLUDED.campaign_schedule END,
    action_id = EXCLUDED.action_id, action_codes = EXCLUDED.action_codes,
    heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at;

  -- V666: lõi bản cũ (không gửi ctx.sendExclusionRunner) mà chiến dịch có cấu hình loại trừ mới cho tài khoản: tạm dừng, trả campaign_paused.
  IF c.status IN ('chờ xử lý', 'đang chạy')
     AND private.aka_agent_send_exclusion_claim_check(v_campaign_id, v_account_id, p_ctx->>'sendExclusionRunner') IS NOT NULL THEN
    c.status := 'tạm dừng';
  END IF;
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
  -- V657: loại trừ gửi theo danh sách / Nhóm data / chiến dịch là bước lọc đầu tiên (trước mọi lần gọi Zalo), cùng vòng với chống gửi lặp.
  BEGIN
    v_excl := NOT v_slot_mode AND private.aka_agent_send_exclusion_precheck_on(c, v_account_id);
  EXCEPTION WHEN OTHERS THEN
    v_excl := false;
  END;
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
    EXIT WHEN NOT v_found OR NOT (v_cooldown OR v_excl);
    IF v_excl THEN
      -- V657: data khớp danh sách / Nhóm data / chiến dịch thì tạm dừng kèm lý do và lấy data kế tiếp (không gọi Zalo, không tính lượt, không
      -- nghỉ); lõi in "⏸️ Bỏ qua …" từ cooldownPaused. Kiểm lỗi thì để bước sau khi tra số / đọc hồ sơ kiểm lại.
      v_ex_note := NULL;
      BEGIN
        v_ex_note := private.aka_agent_send_exclusion_precheck(c, v_account_id, t.phone, t.uid);
      EXCEPTION WHEN OTHERS THEN
        v_ex_note := NULL;
      END;
      IF v_ex_note IS NOT NULL THEN
        UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = left(v_ex_note, 2000) WHERE id = t.id AND status = 'chờ xử lý';
        v_cd_paused := v_cd_paused || jsonb_build_object('inputDataId', t.id, 'name', t.name, 'phone', t.phone, 'uid', t.uid, 'email', t.email, 'note', v_ex_note);
        v_cd_skip := v_cd_skip || t.id;
        v_cd_scanned := v_cd_scanned + 1;
        IF v_cd_scanned >= 50 OR clock_timestamp() >= v_cd_deadline THEN
          RETURN jsonb_build_object('status', 'cooldown_scan', 'leaseToken', v_token, 'cooldownPaused', v_cd_paused);
        END IF;
        CONTINUE;
      END IF;
      EXIT WHEN NOT v_cooldown;
    END IF;
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
  -- V571: chiến dịch nhắn người lạ (theo SĐT / theo UID), không kiêm SMS, tổ chức bật engine.target_check: tra sổ theo SĐT và global id
  -- (UID gắn theo tài khoản nên lấy global id ở zalo_users). Bước tương ứng nhận quyết định skip ở vòng dưới. Kiểm lỗi thì coi như chưa
  -- biết (chạy như thường).
  IF NOT v_slot_mode AND c.action_id IN ('zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_friend_recommendation', 'zalo_message_remarketing_customer')
     AND NOT coalesce(c.extra_settings->'internalSmsEnabled' = 'true'::jsonb, false)
     AND NOT coalesce(c.extra_settings->'externalSmsEnabled' = 'true'::jsonb, false)
     AND private.aka_agent_engine_target_check_on(c.organization_id) THEN
    BEGIN
      IF nullif(btrim(coalesce(t.uid, '')), '') IS NOT NULL THEN
        SELECT nullif(btrim(coalesce(zu.global_id, '')), ''), coalesce(zu.is_fr = 1, false) INTO v_tc_global, v_tc_friend
          FROM public.zalo_users zu WHERE zu.account_id = v_account_id AND zu.zalo_uid = btrim(t.uid) LIMIT 1;
        v_tc_friend := coalesce(v_tc_friend, false);
      END IF;
      SELECT jsonb_object_agg(x.action_code, x.error_code) INTO v_tc FROM private.aka_agent_engine_target_check_probe(t.phone, v_tc_global) x;
    EXCEPTION WHEN OTHERS THEN
      v_tc := NULL;
    END;
    -- Chặn tin người lạ không áp với tài khoản đã là bạn bè.
    IF v_tc IS NOT NULL AND v_tc_friend THEN v_tc := v_tc - 'zalo_message_stranger'; END IF;
    IF v_tc = '{}'::jsonb THEN v_tc := NULL; END IF;
    -- "Nhắn tin theo SĐT": mọi bước gửi của chiến dịch đã biết hỏng và không tag Zalo / đổi tên / tag akaBiz (các bước cần kết quả tìm SĐT)
    -- thì bỏ luôn bước tìm SĐT; report tách thành một dòng cho mỗi bước gửi.
    IF v_tc IS NOT NULL AND c.action_id = 'zalo_message_phone' AND NOT (v_tc ? 'zalo_find_phone_user')
       AND NOT coalesce(c.extra_settings->'enableZaloTag' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableZaloAlias' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableAkaBizTag' = 'true'::jsonb, false) THEN
      -- (Bí danh "ja": "a" là biến bản ghi tài khoản của hàm.)
      SELECT CASE WHEN count(*) > 0 AND bool_and(v_tc ? (ja.value->>'code')) THEN jsonb_object_agg(ja.value->>'code', v_tc->(ja.value->>'code')) END
        INTO v_tc_sends
        FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) ja WHERE ja.value->>'code' <> 'zalo_find_phone_user';
    END IF;
  END IF;
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

    -- Quét data website: một data (từ khoá) tốn nhiều lượt (mỗi lần hiện SĐT / mở trang một lượt), nên trả số lượt còn lại trong ngày và
    -- trong khung giờ để block dừng đúng lúc; hết lượt giữa từ khoá thì từ khoá về hàng đợi, lần nhận sau chờ theo hạn mức như mọi thao tác.
    IF v_code LIKE 'web\_%' AND v_decision->>'decision' = 'allow' AND v_limit IS NOT NULL THEN
      v_web_day := NULL; v_web_window := NULL;
      SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_web_day
        FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
      SELECT count(*) INTO v_web_window FROM public.auto_campaign_details d
       WHERE d.account_id = v_account_id AND d.action_code = v_code
         AND d.created_at >= v_now - make_interval(secs => ((v_limit->>'windowMinutes')::numeric * 60)::double precision)
         AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')));
      v_decision := v_decision || jsonb_build_object(
        'remainingDaily', greatest((v_limit->>'daily')::numeric - coalesce(v_web_day, 0), 0),
        'remainingWindow', greatest((v_limit->>'windowCount')::numeric - coalesce(v_web_window, 0), 0));
    END IF;

    -- V571: người nhận đã biết hỏng: bước tìm SĐT bỏ qua kể cả khi đang khoá / hết lượt (không gọi Zalo, không tính lượt); bước gửi chỉ bỏ
    -- qua khi đang được phép (đang chờ thì vẫn chờ như thường) và khi bước tìm SĐT không bị bỏ.
    IF v_tc IS NOT NULL THEN
      IF v_code = 'zalo_find_phone_user' THEN
        IF v_tc ? v_code THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
        ELSIF v_tc_sends IS NOT NULL THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc_sends::text);
        END IF;
      ELSIF v_tc ? v_code AND v_tc_sends IS NULL AND NOT (c.action_id = 'zalo_message_phone' AND v_tc ? 'zalo_find_phone_user')
            AND v_decision->>'decision' = 'allow' THEN
        v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
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

CREATE OR REPLACE FUNCTION public.aka_agent_engine_release_v1(p_account_id bigint, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  l public.auto_engine_leases%ROWTYPE;
  v_open integer;
BEGIN
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = p_account_id AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  SELECT count(*) INTO v_open FROM public.auto_engine_target_runs WHERE account_id = p_account_id AND lease_token = p_lease_token AND completed_at IS NULL;
  IF v_open > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'open_target_runs', 'openRuns', v_open); END IF;
  DELETE FROM public.auto_engine_leases WHERE account_id = p_account_id AND lease_token = p_lease_token;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = l.campaign_id AND status = 'đang chạy' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
  -- "Chạy cùng lúc": làn khác của tài khoản còn giữ chỗ thì tài khoản vẫn "đang chạy". Làn khác có thể đang nhận lượt (giữ khoá dòng tài
  -- khoản, lease mới chưa commit): khoá dòng tài khoản bằng câu riêng trước (khi còn "đang chạy", đúng dòng câu dưới vẫn khoá) để câu cập nhật
  -- chụp dữ liệu sau khi giao dịch kia xong và thấy lease đó.
  PERFORM 1 FROM public.auto_accounts WHERE id = p_account_id AND status = 'đang chạy' FOR UPDATE;
  UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = p_account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases ol WHERE ol.account_id = auto_accounts.id AND ol.expires_at > v_now);
  RETURN jsonb_build_object('ok', true,
    'pendingTargets', (SELECT count(*) FROM public.auto_campaign_input_data d WHERE d.campaign_id = l.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false));
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_stale_v1(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_stale interval := make_interval(mins => greatest(1, public.aka_agent_engine_setting('engine.stale_target_minutes', '10')::integer));
  v_orphan_setting text := btrim(public.aka_agent_engine_setting('engine.orphan_target_seconds', '120'));
  v_orphan_age interval;
  v_id bigint;
  v_kind text;
  v_closed integer := 0;
  v_orphans integer := 0;
  v_final integer := 0;
  v_released integer := 0;
  v_lease record;
BEGIN
  v_orphan_age := make_interval(secs => CASE WHEN v_orphan_setting ~ '^[0-9]{1,6}$' THEN greatest(30, v_orphan_setting::integer) ELSE 120 END);
  -- V576 (B): lượt mồ côi. Claim đã tạo lượt nhưng nơi chạy không nhận được câu trả lời, gọi lại claim cùng lease và chạy data kế: lượt cũ
  -- chưa ghi dấu, chưa có kết quả, trong khi cùng lease đã có lượt bắt đầu sau nó ≥ 3 giây (khác lần nhận cả lô: cả lô nhận trong một lần
  -- gọi ≤ 1,5 giây) và đã chốt. Nơi chạy làm data tuần tự nên không còn làm lượt cũ: trả về hàng đợi ngay, không chờ lease hết hạn.
  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.input_data_id IS NOT NULL AND tr.started_at < v_now - v_orphan_age
       AND tr.marks = '[]'::jsonb
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = tr.id)
       AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs n
                    WHERE n.account_id = tr.account_id AND n.lease_token = tr.lease_token
                      AND n.started_at >= tr.started_at + interval '3 seconds' AND n.started_at <= tr.started_at + interval '15 minutes'
                      AND n.completed_at IS NOT NULL AND n.close_reason = 'reported')
     ORDER BY tr.id LIMIT greatest(1, p_limit)
     FOR UPDATE OF tr SKIP LOCKED
  LOOP
    v_kind := public.aka_agent_engine_close_run_v1(v_id, 'orphan');
    IF v_kind <> 'skipped' THEN v_orphans := v_orphans + 1; END IF;
  END LOOP;

  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.started_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l
                        WHERE l.account_id = tr.account_id AND l.lease_token = tr.lease_token AND l.expires_at > v_now - v_stale)
     ORDER BY tr.id LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_kind := public.aka_agent_engine_close_run_v1(v_id, 'stale');
    IF v_kind = 'final' THEN v_final := v_final + 1; END IF;
    IF v_kind <> 'skipped' THEN v_closed := v_closed + 1; END IF;
  END LOOP;

  FOR v_lease IN
    SELECT l.account_id, l.campaign_id, l.lease_token, l.lane FROM public.auto_engine_leases l
     WHERE l.expires_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = l.account_id AND tr.lease_token = l.lease_token AND tr.completed_at IS NULL)
     ORDER BY l.expires_at LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    -- "Chạy cùng lúc": tài khoản đang có làn riêng thì khoá dòng chiến dịch rồi dòng tài khoản mà không chờ; đang bị giữ (làn khác đang nhận
    -- lượt / nhả chỗ) thì để lease này cho lần chạy sau. Không chờ: job đang giữ khoá các lease của lô, claim khoá chiến dịch → tài khoản → lease.
    IF v_lease.lane <> 'main'
       OR EXISTS (SELECT 1 FROM public.auto_engine_leases ol WHERE ol.account_id = v_lease.account_id AND ol.lane <> 'main') THEN
      PERFORM 1 FROM public.auto_campaigns WHERE id = v_lease.campaign_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = v_lease.campaign_id) THEN CONTINUE; END IF;
      PERFORM 1 FROM public.auto_accounts WHERE id = v_lease.account_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = v_lease.account_id) THEN CONTINUE; END IF;
    END IF;
    DELETE FROM public.auto_engine_leases WHERE account_id = v_lease.account_id AND lease_token = v_lease.lease_token;
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.campaign_id AND status = 'đang chạy' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
    -- "Chạy cùng lúc": làn khác của tài khoản chưa tới lúc dọn thì tài khoản vẫn "đang chạy". Khoá dòng tài khoản trước bằng câu riêng (như
    -- release_v1; tài khoản có làn riêng đã khoá ở đầu vòng thì câu này không chờ gì) để câu cập nhật thấy lease của làn khác.
    PERFORM 1 FROM public.auto_accounts WHERE id = v_lease.account_id AND status = 'đang chạy' FOR UPDATE;
    UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases ol WHERE ol.account_id = auto_accounts.id AND ol.expires_at > v_now - v_stale);
    v_released := v_released + 1;
  END LOOP;
  RETURN jsonb_build_object('closedTargets', v_closed, 'releasedLeases', v_released, 'orphanTargets', v_orphans, 'finalizedTargets', v_final);
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_health_v1(p_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_minutes integer := greatest(1, least(coalesce(p_minutes, 30), 10080));
  v_since timestamptz;
  v_day timestamptz;
  v_stuck jsonb;
  v_open jsonb;
  v_unmatched jsonb;
  v_errors jsonb;
BEGIN
  v_since := v_now - make_interval(mins => v_minutes);
  v_day := v_now - make_interval(mins => greatest(v_minutes, 1440));
  -- Chiến dịch FB của tổ chức bật engine: đến lịch quá N phút mà không có lượt data nào của engine bắt đầu trong N phút.
  WITH last_run AS MATERIALIZED (
    SELECT tr.campaign_id, max(tr.started_at) AS started_at, count(*) FILTER (WHERE tr.completed_at IS NULL) AS open_runs
      FROM public.auto_engine_target_runs tr WHERE tr.started_at >= v_day GROUP BY tr.campaign_id
  ), fb AS MATERIALIZED (
    SELECT c.id, c.name, c.organization_id, c.staff_id, c.account_id, c.action_id, c.status, c.schedule, c.note, c.updated_at
      FROM public.auto_campaigns c JOIN public.auto_campaign_actions ca ON ca.id = c.action_id
     WHERE lower(btrim(coalesce(ca.flatform_type, ''))) = 'facebook' AND coalesce(c.is_delete, false) = false
       AND c.status IN ('chờ xử lý', 'đang chạy') AND (c.schedule IS NULL OR c.schedule <= v_since)
       AND public.aka_agent_engine_facebook_org_enabled(c.organization_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('campaignId', fb.id, 'name', fb.name, 'organizationId', fb.organization_id, 'staffId', fb.staff_id,
           'accountId', fb.account_id, 'actionId', fb.action_id, 'status', fb.status, 'schedule', fb.schedule, 'note', fb.note,
           'updatedAt', fb.updated_at, 'lastRunAt', lr.started_at, 'openRuns', coalesce(lr.open_runs, 0),
           'accountLoginStatus', a.login_status, 'accountStatus', a.status,
           'lease', (SELECT jsonb_build_object('runnerId', l.runner_id, 'campaignId', l.campaign_id, 'expiresAt', l.expires_at,
                       'heartbeatAt', l.heartbeat_at) FROM public.auto_engine_leases l WHERE l.account_id = fb.account_id
                       ORDER BY (l.lane = 'main') DESC, l.expires_at DESC LIMIT 1),
           'dueTargets', (SELECT count(*) FROM (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = fb.id AND d.status = 'chờ xử lý'
                            AND coalesce(d.is_delete, false) = false AND (d.schedule IS NULL OR d.schedule <= v_now) LIMIT 1000) x)
         ) ORDER BY fb.schedule NULLS FIRST, fb.id), '[]'::jsonb) INTO v_stuck
    FROM fb
    LEFT JOIN last_run lr ON lr.campaign_id = fb.id
    LEFT JOIN public.auto_accounts a ON a.id = fb.account_id
   WHERE lr.started_at IS NULL OR lr.started_at < v_since;
  -- Lượt data FB còn mở quá N phút (block treo, máy ngủ, mất lease mà chưa đóng).
  SELECT coalesce(jsonb_agg(jsonb_build_object('targetRunId', tr.id, 'campaignId', tr.campaign_id, 'accountId', tr.account_id,
           'inputDataId', tr.input_data_id, 'startedAt', tr.started_at, 'firstMarkedAt', tr.first_marked_at, 'marks', tr.marks,
           'outcomeCount', tr.outcome_count) ORDER BY tr.started_at), '[]'::jsonb) INTO v_open
    FROM public.auto_engine_target_runs tr
    JOIN public.auto_accounts a ON a.id = tr.account_id
   WHERE tr.completed_at IS NULL AND tr.started_at < v_since AND lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  SELECT coalesce(jsonb_agg(jsonb_build_object('actionCode', u.action_code, 'phase', u.phase, 'signalKind', u.signal_kind, 'patternKey', u.pattern_key,
           'fallbackErrorCode', u.fallback_error_code, 'hitCount', u.hit_count, 'firstSeenAt', u.first_seen_at, 'lastSeenAt', u.last_seen_at,
           'sample', u.sample) ORDER BY u.hit_count DESC), '[]'::jsonb) INTO v_unmatched
    FROM (SELECT * FROM public.auto_outcome_unmatched x WHERE x.platform = 'facebook' AND x.last_seen_at >= v_since
           ORDER BY x.hit_count DESC LIMIT 50) u;
  SELECT coalesce(jsonb_object_agg(x.error_code, x.n), '{}'::jsonb) INTO v_errors
    FROM (SELECT coalesce(o.error_code, CASE WHEN o.ok THEN 'ok' ELSE 'unknown' END) AS error_code, count(*) AS n
            FROM public.auto_engine_outcomes o WHERE o.created_at >= v_since AND o.action_code LIKE 'fb\_%'
           GROUP BY 1) x;
  RETURN jsonb_build_object('ok', true, 'at', v_now, 'minutes', v_minutes, 'stuckCampaigns', v_stuck, 'openRuns', v_open,
    'unmatched', v_unmatched, 'outcomesByCode', v_errors);
END $function$
;

CREATE OR REPLACE FUNCTION public.create_control_campaign_v2(p_staff_id bigint, p_organization_id bigint, p_idempotency_key text, p_campaign jsonb, p_inputs jsonb DEFAULT '[]'::jsonb, p_initial_status text DEFAULT 'chờ xử lý'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_id bigint;
  v_web_form text;
BEGIN
  IF p_initial_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_campaign_initial_status';
  END IF;

  v_result := public.create_control_campaign(
    p_staff_id,
    p_organization_id,
    p_idempotency_key,
    p_campaign,
    p_inputs
  );

  -- V482: form Web đã tạo chiến dịch (form thủ công/Agent, phiên bản 1/2). Không gửi hoặc giá trị lạ = NULL
  -- (Desktop, iOS, Quy trình, nhập SQL...). Chỉ ghi lúc tạo; lần gọi lặp cùng Idempotency-Key không ghi lại.
  v_web_form := CASE WHEN p_campaign->>'webCampaignForm' IN ('form_1', 'form_2', 'agent_1', 'agent_2')
    THEN p_campaign->>'webCampaignForm' END;

  -- The inner insert and this update share a transaction, so a cloned campaign is
  -- never externally visible in the runnable state.
  IF COALESCE((v_result->>'created')::boolean, false) THEN
    v_campaign_id := NULLIF(v_result->>'campaign_id', '')::bigint;
    IF p_initial_status = 'tạm dừng' THEN
      UPDATE public.auto_campaigns
      SET status = 'tạm dừng', web_campaign_form = v_web_form, updated_at = now()
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    ELSIF v_web_form IS NOT NULL THEN
      -- Chỉ ghi cột form, không nêu status: không chạy trigger UPDATE OF status, không đổi config version.
      UPDATE public.auto_campaigns
      SET web_campaign_form = v_web_form
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
    -- "Chạy cùng lúc" từ form Web / iOS (parallelRunEnabled = true). Không gửi hay false = mặc định của cột (false). Chỉ ghi cột này.
    IF p_campaign->>'parallelRunEnabled' = 'true' THEN
      UPDATE public.auto_campaigns
      SET parallel_run_enabled = true
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
  END IF;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_control_campaign_atomic(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_expected_updated_at timestamp with time zone, p_campaign_patch jsonb, p_sms_inputs jsonb DEFAULT NULL::jsonb, p_update_sms_schedule boolean DEFAULT false, p_append_idempotency_key text DEFAULT NULL::text, p_expected_input_count integer DEFAULT NULL::integer, p_append_inputs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account_platform text;
  v_target_action_id text;
  v_payload_input_count integer := 0;
  v_payload_unique_input_count integer := 0;
  v_eligible_input_count integer := 0;
  v_current_eligible_input_count integer := 0;
  v_updated_inputs integer := 0;
  v_append_key text := NULLIF(btrim(COALESCE(p_append_idempotency_key, '')), '');
  v_append_input_count integer := 0;
  v_existing_append_count integer := 0;
  v_current_input_count integer := 0;
  v_appended_inputs integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_campaign_patch, '{}'::jsonb)) <> 'object'
    OR (p_sms_inputs IS NOT NULL AND jsonb_typeof(p_sms_inputs) <> 'array')
    OR (p_append_inputs IS NOT NULL AND jsonb_typeof(p_append_inputs) <> 'array') THEN
    RAISE EXCEPTION 'invalid_control_campaign_update_payload';
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    v_append_input_count := jsonb_array_length(p_append_inputs);
    IF v_append_input_count < 1 OR v_append_input_count > 5000
      OR v_append_key IS NULL OR length(v_append_key) > 200
      OR p_expected_input_count IS NULL OR p_expected_input_count < 0 THEN
      RAISE EXCEPTION 'invalid_control_campaign_append_payload';
    END IF;
  ELSIF v_append_key IS NOT NULL OR p_expected_input_count IS NOT NULL THEN
    RAISE EXCEPTION 'orphan_control_campaign_append_metadata';
  END IF;

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      (
        COALESCE(account.is_delete, false) = false
        AND (
          account.flatform_type = 'sms'
          OR (
            account.flatform_type = 'zalo'
            AND NOT (COALESCE(account.is_zalo_show_web, false)
            AND COALESCE(account.is_zalo_server, false))
            AND COALESCE(account.is_active, true) = true
          )
        )
      )
      OR (
        COALESCE(account.is_delete, false) = true
        AND p_campaign_patch ? 'account_id'
        AND EXISTS (
          SELECT 1
          FROM public.auto_accounts AS target_account
          WHERE target_account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
            AND target_account.staff_id = p_staff_id
            AND target_account.organization_id = p_organization_id
            AND target_account.flatform_type = account.flatform_type AND COALESCE(target_account.is_zalo_server, false) = COALESCE(account.is_zalo_server, false)
            AND (
              target_account.flatform_type = 'sms'
              OR (
                target_account.flatform_type = 'zalo'
                AND NOT (COALESCE(target_account.is_zalo_show_web, false)
                AND COALESCE(target_account.is_zalo_server, false))
                AND COALESCE(target_account.is_active, true) = true
              )
            )
            AND COALESCE(target_account.is_delete, false) = false
        )
      )
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  -- A network retry after the transaction committed still carries the stale
  -- version. The durable append key proves that this exact edit already won.
  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  IF p_sms_inputs IS NOT NULL OR p_append_inputs IS NOT NULL THEN
    -- SMS status recording locks an input row before it may complete the
    -- campaign. Lock every current row before taking the campaign lock so an
    -- update+append cannot commit below a concurrently completed campaign.
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    FOR UPDATE OF input_data;
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');

    SELECT
      count(*)::integer,
      count(DISTINCT NULLIF(item->>'id', '')::bigint)::integer
    INTO v_payload_input_count, v_payload_unique_input_count
    FROM jsonb_array_elements(p_sms_inputs) AS item;

    IF v_payload_input_count <> v_payload_unique_input_count
      OR v_payload_unique_input_count <> v_eligible_input_count
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_sms_inputs) AS item
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.id = NULLIF(item->>'id', '')::bigint
            AND input_data.campaign_id = p_campaign_id
            AND COALESCE(input_data.is_delete, false) = false
            AND input_data.status IN ('chờ xử lý', 'tạm dừng')
        )
      ) THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  -- Mobile status recording locks input rows before it may complete the campaign;
  -- take the campaign lock only after the SMS input locks to keep that order.
  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      (
        COALESCE(account.is_delete, false) = false
        AND (
          account.flatform_type = 'sms'
          OR (
            account.flatform_type = 'zalo'
            AND NOT (COALESCE(account.is_zalo_show_web, false)
            AND COALESCE(account.is_zalo_server, false))
            AND COALESCE(account.is_active, true) = true
          )
        )
      )
      OR (
        COALESCE(account.is_delete, false) = true
        AND p_campaign_patch ? 'account_id'
        AND EXISTS (
          SELECT 1
          FROM public.auto_accounts AS target_account
          WHERE target_account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
            AND target_account.staff_id = p_staff_id
            AND target_account.organization_id = p_organization_id
            AND target_account.flatform_type = account.flatform_type AND COALESCE(target_account.is_zalo_server, false) = COALESCE(account.is_zalo_server, false)
            AND (
              target_account.flatform_type = 'sms'
              OR (
                target_account.flatform_type = 'zalo'
                AND NOT (COALESCE(target_account.is_zalo_show_web, false)
                AND COALESCE(target_account.is_zalo_server, false))
                AND COALESCE(target_account.is_active, true) = true
              )
            )
            AND COALESCE(target_account.is_delete, false) = false
        )
      )
    )
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  IF p_campaign_patch ? 'account_id' THEN
    PERFORM account.id
    FROM public.auto_accounts AS account
    WHERE account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.flatform_type = v_account_platform AND COALESCE(account.is_zalo_server, false) = (SELECT COALESCE(source_account.is_zalo_server, false) FROM public.auto_accounts AS source_account WHERE source_account.id = v_campaign.account_id)
      AND (
        account.flatform_type = 'sms'
        OR (
          account.flatform_type = 'zalo'
          AND NOT (COALESCE(account.is_zalo_show_web, false)
          AND COALESCE(account.is_zalo_server, false))
          AND COALESCE(account.is_active, true) = true
        )
      )
      AND COALESCE(account.is_delete, false) = false
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_account_not_found';
    END IF;
  END IF;

  v_target_action_id := v_campaign.action_id;
  IF p_campaign_patch ? 'action_id' THEN
    v_target_action_id := NULLIF(btrim(COALESCE(p_campaign_patch->>'action_id', '')), '');
    IF v_target_action_id IS NULL THEN
      RAISE EXCEPTION 'control_action_not_allowed';
    END IF;

    PERFORM action.id
    FROM public.auto_campaign_actions AS action
    WHERE action.id = v_target_action_id
      AND action.flatform_type = v_account_platform
      AND COALESCE(action.is_active, true) = true
      AND COALESCE(action.is_delete, false) = false
    FOR SHARE OF action;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_action_not_allowed';
    END IF;
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    IF v_current_eligible_input_count <> v_payload_unique_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false;
    IF v_current_input_count <> p_expected_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'input_count_conflict');
    END IF;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    name = CASE WHEN p_campaign_patch ? 'name' THEN p_campaign_patch->>'name' ELSE campaign.name END,
    action_id = v_target_action_id,
    account_id = CASE WHEN p_campaign_patch ? 'account_id' THEN NULLIF(p_campaign_patch->>'account_id', '')::bigint ELSE campaign.account_id END,
    schedule = CASE WHEN p_campaign_patch ? 'schedule' THEN NULLIF(p_campaign_patch->>'schedule', '')::timestamptz ELSE campaign.schedule END,
    original_schedule = CASE WHEN p_campaign_patch ? 'original_schedule' THEN NULLIF(p_campaign_patch->>'original_schedule', '')::timestamptz ELSE campaign.original_schedule END,
    content = CASE WHEN p_campaign_patch ? 'content' THEN COALESCE(p_campaign_patch->>'content', '') ELSE campaign.content END,
    schedule_type = CASE WHEN p_campaign_patch ? 'schedule_type' THEN p_campaign_patch->>'schedule_type' ELSE campaign.schedule_type END,
    schedule_end_date = CASE WHEN p_campaign_patch ? 'schedule_end_date' THEN NULLIF(p_campaign_patch->>'schedule_end_date', '')::timestamptz ELSE campaign.schedule_end_date END,
    daily_stop_time = CASE WHEN p_campaign_patch ? 'daily_stop_time' THEN NULLIF(p_campaign_patch->>'daily_stop_time', '')::time ELSE campaign.daily_stop_time END,
    schedule_days = CASE WHEN p_campaign_patch ? 'schedule_days' THEN NULLIF(p_campaign_patch->>'schedule_days', '') ELSE campaign.schedule_days END,
    schedule_week_days = CASE WHEN p_campaign_patch ? 'schedule_week_days' THEN NULLIF(p_campaign_patch->>'schedule_week_days', '') ELSE campaign.schedule_week_days END,
    continue_next_day = CASE WHEN p_campaign_patch ? 'continue_next_day' THEN (p_campaign_patch->>'continue_next_day')::boolean ELSE campaign.continue_next_day END,
    refresh_data = CASE WHEN p_campaign_patch ? 'refresh_data' THEN (p_campaign_patch->>'refresh_data')::boolean ELSE campaign.refresh_data END,
    -- "Chạy cùng lúc": chỉ đổi khi form gửi khoá (ô đang hiện); không gửi thì giữ nguyên. Không thuộc config version.
    parallel_run_enabled = CASE WHEN p_campaign_patch ? 'parallel_run_enabled' THEN COALESCE((p_campaign_patch->>'parallel_run_enabled')::boolean, false) ELSE campaign.parallel_run_enabled END,
    extra_settings = CASE WHEN p_campaign_patch ? 'extra_settings' THEN p_campaign_patch->'extra_settings' ELSE campaign.extra_settings END,
    images = CASE WHEN p_campaign_patch ? 'images' THEN p_campaign_patch->'images' ELSE campaign.images END,
    status = CASE
      WHEN v_account_platform = 'zalo' THEN campaign.status
      WHEN p_campaign_patch ? 'status' THEN p_campaign_patch->>'status'
      ELSE campaign.status
    END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.updated_at IS NOT DISTINCT FROM p_expected_updated_at
  RETURNING * INTO v_campaign;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    WITH materialized AS (
      SELECT
        NULLIF(item->>'id', '')::bigint AS id,
        NULLIF(item->>'phone', '') AS phone,
        NULLIF(item->>'phoneCarrier', '') AS phone_carrier,
        NULLIF(item->>'content', '') AS content,
        NULLIF(item->>'schedule', '')::timestamptz AS schedule
      FROM jsonb_array_elements(p_sms_inputs) AS item
    )
    UPDATE public.auto_campaign_input_data AS input_data
    SET
      phone = materialized.phone,
      phone_carrier = materialized.phone_carrier,
      content = materialized.content,
      schedule = CASE WHEN p_update_sms_schedule THEN materialized.schedule ELSE input_data.schedule END
    FROM materialized
    WHERE input_data.id = materialized.id
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    GET DIAGNOSTICS v_updated_inputs = ROW_COUNT;
    IF v_updated_inputs <> v_eligible_input_count THEN
      RAISE EXCEPTION 'control_sms_inputs_changed';
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    INSERT INTO public.auto_campaign_input_data (
      campaign_id, input_id, name, phone, phone_carrier, uid, email,
      info1, info2, info3, info4, info5, content,
      status, note, schedule, is_delete, created_at,
      control_append_idempotency_key, control_append_row_index
    )
    SELECT
      p_campaign_id,
      NULL,
      NULLIF(item.value->>'name', ''),
      NULLIF(item.value->>'phone', ''),
      NULLIF(item.value->>'phoneCarrier', ''),
      NULLIF(item.value->>'uid', ''),
      NULLIF(item.value->>'email', ''),
      NULLIF(item.value->>'info1', ''),
      NULLIF(item.value->>'info2', ''),
      NULLIF(item.value->>'info3', ''),
      NULLIF(item.value->>'info4', ''),
      NULLIF(item.value->>'info5', ''),
      NULLIF(item.value->>'content', ''),
      'chờ xử lý',
      NULLIF(item.value->>'note', ''),
      NULLIF(item.value->>'schedule', '')::timestamptz,
      false,
      now(),
      v_append_key,
      (item.ordinality - 1)::integer
    FROM jsonb_array_elements(p_append_inputs) WITH ORDINALITY AS item(value, ordinality);
    GET DIAGNOSTICS v_appended_inputs = ROW_COUNT;
    IF v_appended_inputs <> v_append_input_count THEN
      RAISE EXCEPTION 'control_campaign_append_incomplete';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'campaign_id', p_campaign_id,
    'updated_input_count', v_updated_inputs,
    'appended_input_count', v_appended_inputs,
    'updated_at', v_campaign.updated_at
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_parallel_wait_v1(p_campaign_id bigint, p_action_codes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- "Chạy cùng lúc": chiến dịch này có đang phải chờ một chiến dịch ở làn khác của cùng tài khoản không (cùng loại, hoặc dùng chung thao tác),
-- theo quy tắc của aka_agent_engine_claim_target_v1. Chỉ đọc; cho nút "Lý do đang chờ". NULL khi không phải chờ vì chạy cùng lúc.
-- Thao tác của chiến dịch phải là thao tác claim dùng (mã lõi engine khai khi nhận lượt): nơi gọi có lõi (Desktop) gửi p_action_codes; không
-- gửi thì lấy limit_check_action_codes + mã loại, cộng Tìm SĐT cho "Thêm thành viên" (lõi khai Tìm SĐT, required: false, trong kế hoạch nhận
-- lượt của loại này: zaloAddGroupMemberClaimPlan; lõi đổi thì sửa cùng lúc).
DECLARE
  v_now timestamptz := clock_timestamp();
  c public.auto_campaigns%ROWTYPE;
  v_platform text;
  v_allow boolean;
  v_codes text[];
  v_given text[];
  v_lane text;
  v_par record;
BEGIN
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR coalesce(c.is_delete, false) OR c.account_id IS NULL OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN
    RETURN NULL;
  END IF;
  SELECT lower(btrim(coalesce(a.flatform_type, ''))) INTO v_platform FROM public.auto_accounts a WHERE a.id = c.account_id;
  SELECT coalesce(ca.allow_parallel_run, false), coalesce(ca.limit_check_action_codes, ARRAY[]::text[]) INTO v_allow, v_codes
    FROM public.auto_campaign_actions ca WHERE ca.id = c.action_id;
  v_lane := CASE WHEN c.parallel_run_enabled AND coalesce(v_allow, false) AND v_platform = 'zalo'
                      AND nullif(btrim(coalesce(c.action_id, '')), '') IS NOT NULL
                 THEN c.action_id ELSE 'main' END;
  v_given := ARRAY(SELECT DISTINCT btrim(x) FROM unnest(coalesce(p_action_codes, ARRAY[]::text[])) x WHERE nullif(btrim(coalesce(x, '')), '') IS NOT NULL);
  IF cardinality(v_given) > 0 THEN
    v_codes := v_given;
  ELSE
    v_codes := coalesce(v_codes, ARRAY[]::text[]) || ARRAY[c.action_id]
      || CASE WHEN c.action_id = 'zalo_add_group_member' THEN ARRAY['zalo_find_phone_user'] ELSE ARRAY[]::text[] END;
  END IF;
  SELECT o.campaign_id, (o.action_id IS NOT DISTINCT FROM c.action_id) AS same_type,
         ARRAY(SELECT x FROM unnest(o.action_codes) x WHERE x = ANY (v_codes) ORDER BY 1) AS codes
    INTO v_par
    FROM public.auto_engine_leases o
   WHERE o.account_id = c.account_id AND o.expires_at > v_now AND o.campaign_id IS DISTINCT FROM c.id
     AND (o.lane <> v_lane OR v_lane <> 'main')
     AND (o.action_id = c.action_id OR o.action_codes && v_codes)
   ORDER BY o.acquired_at, o.lane LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('campaignId', v_par.campaign_id,
    'campaignName', (SELECT x.name FROM public.auto_campaigns x WHERE x.id = v_par.campaign_id),
    'reason', CASE WHEN v_par.same_type THEN 'same_type' ELSE 'same_action' END,
    'actionCodes', to_jsonb(v_par.codes), 'lane', v_lane);
END $function$
;
-- Hàm mới nhận quyền mặc định của schema public (Supabase cấp cho anon, authenticated): thu lại, chỉ service_role và Desktop.
REVOKE ALL ON FUNCTION public.aka_agent_engine_parallel_wait_v1(bigint, text[]) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.aka_agent_engine_parallel_wait_v1(bigint, text[]) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.aka_agent_engine_parallel_wait_v1(bigint, text[]) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_chat_api') THEN REVOKE ALL ON FUNCTION public.aka_agent_engine_parallel_wait_v1(bigint, text[]) FROM aka_agent_chat_api; END IF;
  GRANT EXECUTE ON FUNCTION public.aka_agent_engine_parallel_wait_v1(bigint, text[]) TO service_role;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_engine_parallel_wait_v1(bigint, text[]) TO aka_agent_desktop;
  END IF;
END $grant$;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '8d45e070990c03a5a98884f5660a19e6' THEN
    RAISE EXCEPTION 'V670 p3 postflight: định nghĩa claim %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v670_acl_claim', true) THEN RAISE EXCEPTION 'V670 p3 postflight: quyền / chủ sở hữu claim bị đổi'; END IF;
  v_oid := to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '85ee6d8541b0d5cd0462063dc11bccf0' THEN
    RAISE EXCEPTION 'V670 p3 postflight: định nghĩa release %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v670_acl_release', true) THEN RAISE EXCEPTION 'V670 p3 postflight: quyền / chủ sở hữu release bị đổi'; END IF;
  v_oid := to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'b4e2c1664e90212edec6fa2bfd036009' THEN
    RAISE EXCEPTION 'V670 p3 postflight: định nghĩa close_stale %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v670_acl_close_stale', true) THEN RAISE EXCEPTION 'V670 p3 postflight: quyền / chủ sở hữu close_stale bị đổi'; END IF;
  v_oid := to_regprocedure('public.aka_agent_engine_health_v1(integer)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '57e92899db9a4a784a04e66fba205d56' THEN
    RAISE EXCEPTION 'V670 p3 postflight: định nghĩa health %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v670_acl_health', true) THEN RAISE EXCEPTION 'V670 p3 postflight: quyền / chủ sở hữu health bị đổi'; END IF;
  v_oid := to_regprocedure('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '532953944687fe2ee6a50612f97418ec' THEN
    RAISE EXCEPTION 'V670 p3 postflight: định nghĩa create_v2 %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v670_acl_create_v2', true) THEN RAISE EXCEPTION 'V670 p3 postflight: quyền / chủ sở hữu create_v2 bị đổi'; END IF;
  v_oid := to_regprocedure('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '5e2c0fdaee6a786a05e3724fa2ea35e4' THEN
    RAISE EXCEPTION 'V670 p3 postflight: định nghĩa update_atomic %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v670_acl_update_atomic', true) THEN RAISE EXCEPTION 'V670 p3 postflight: quyền / chủ sở hữu update_atomic bị đổi'; END IF;
  IF md5((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_parallel_wait_v1(bigint, text[])'))) IS DISTINCT FROM 'b7ff277bb25a6f7bd56e2f206c2c4ed5' THEN
    RAISE EXCEPTION 'V670 p3 postflight: thân aka_agent_engine_parallel_wait_v1 khác bản sinh';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
              AND has_function_privilege(r.rolname, 'public.aka_agent_engine_parallel_wait_v1(bigint, text[])', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V670 p3 postflight: anon / authenticated gọi được aka_agent_engine_parallel_wait_v1';
  END IF;
  IF (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM pg_catalog.pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE i.indrelid = 'public.auto_engine_leases'::regclass AND i.indisprimary) IS DISTINCT FROM ARRAY['account_id', 'lane'] THEN
    RAISE EXCEPTION 'V670 p3 postflight: khoá chính auto_engine_leases khác (account_id, lane)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_leases WHERE lane <> 'main') THEN RAISE EXCEPTION 'V670 p3 postflight: lease cũ không ở làn main'; END IF;
END $post$;
COMMIT;
