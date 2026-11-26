-- V667 p2: engine v2 cho tài khoản Zalo Server chạy trên VPS (App Server). SINH TỪ scripts/build-v667-sql.cjs, không sửa tay.
-- Cần p1 và migration_v666_send_exclusion_review_fixes trước (V666 cũng thay claim, V667 dựng trên thân của V666). Thay ba hàm (giữ chữ ký, chủ sở hữu, quyền):
--   aka_agent_engine_claim_target_v1      nhận nơi chạy 'server': chỉ tài khoản Zalo Server; tổ chức đi Fly → runtime_not_owner; tổ chức
--                                         chưa bật engine.zalo_server_vps → not_enabled
--   aka_agent_engine_finish_campaign_v2   tài khoản Server bị tạm dừng giữa lượt thì chiến dịch về "chờ xử lý" cho cả 'server' (như 'fly')
--   recover_server_zalo_running_state     đóng lượt engine 'server' còn mở (aka_agent_engine_close_server_runs_v1) trước bước đánh dấu data
-- Thêm bốn hàm: aka_agent_engine_server_org_enabled, aka_agent_engine_server_enabled_orgs_v1, aka_agent_engine_close_server_runs_v1,
-- aka_agent_engine_desktop_vps_enabled_v1 (Desktop đọc lúc đăng nhập: tài khoản Zalo QR / trình duyệt của tổ chức trong engine.zalo_server_vps
-- chạy engine v2; không sửa aka_agent_engine_desktop_enabled_v1 vì Desktop dùng nó để chọn Fly / App Server cho tài khoản Zalo Server).
-- Dữ liệu: chép chính sách 255 (tra số không rõ kết quả, Desktop; giống hệt 256 của Fly) thành bản 'server'; dòng công tắc
-- engine.zalo_server_vps = {"mode":"off","organizationIds":[]} (chưa tổ chức nào bật).
-- Nguồn = pg_get_functiondef production 26/11/2026 (scripts/fixtures/engine-v2-server/live-20261126.json):
--   claim 2db540225a612d0e33111b1e8021b025 → df4b8e4284c911dad4b275383f7ddb2b
--   finish 9b29fe98391f682819e4458a6a1387aa → e998853516d029ca9edf005e389372e0
--   recover e51b12406b7c1d67c36c9885c79f3a18 → 48b966d5e98d8ac9125dc2ba918f1c64
-- DDL làm PostgREST nạp lại schema: apply buổi tối. Gỡ: rollback_v667_engine_server_runtime_p2.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_acl text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v667_engine_server_runtime_p2') THEN
      RAISE EXCEPTION 'migration_v667_engine_server_runtime_p2 đã có trong sổ migration, không chạy lại';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v667_%'
                AND name NOT IN ('migration_v667_engine_server_runtime_p2', 'migration_v667_engine_server_runtime_p1', 'migration_v667_engine_server_runtime_p3')) THEN
      RAISE EXCEPTION 'Số V667 đã có migration khác trong sổ: đổi số trong scripts/build-v667-sql.cjs rồi sinh lại';
    END IF;
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v666_send_exclusion_review_fixes') THEN
    RAISE EXCEPTION 'V667 p2: cần migration_v666_send_exclusion_review_fixes trước (cùng thay aka_agent_engine_claim_target_v1, V667 dựng trên bản của V666)';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_engine_leases'::regclass AND c.conname = 'auto_engine_leases_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text, 'server'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_engine_leases_runtime_target_check không như mong đợi';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_engine_target_runs'::regclass AND c.conname = 'auto_engine_target_runs_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text, 'server'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_engine_target_runs_runtime_target_check không như mong đợi';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_outcome_policies'::regclass AND c.conname = 'auto_outcome_policies_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text, 'server'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_outcome_policies_runtime_target_check không như mong đợi';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)'))) = 'df4b8e4284c911dad4b275383f7ddb2b' THEN RAISE EXCEPTION 'V667 p2 đã chạy (claim)'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)'))) IS DISTINCT FROM '2db540225a612d0e33111b1e8021b025' THEN
    RAISE EXCEPTION 'V667 p2: bản production khác bản đã đọc 26/11, dừng để đối chiếu: định nghĩa claim %', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)')));
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'))) IS DISTINCT FROM '9b29fe98391f682819e4458a6a1387aa' THEN
    RAISE EXCEPTION 'V667 p2: bản production khác bản đã đọc 26/11, dừng để đối chiếu: định nghĩa finish %', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)')));
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.recover_server_zalo_running_state(bigint,text,boolean)'))) IS DISTINCT FROM 'e51b12406b7c1d67c36c9885c79f3a18' THEN
    RAISE EXCEPTION 'V667 p2: bản production khác bản đã đọc 26/11, dừng để đối chiếu: định nghĩa recover %', md5(pg_get_functiondef(to_regprocedure('public.recover_server_zalo_running_state(bigint,text,boolean)')));
  END IF;
  IF to_regprocedure('public.aka_agent_engine_server_org_enabled(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'V667 p2: đã có public.aka_agent_engine_server_org_enabled(bigint)'; END IF;
  IF to_regprocedure('public.aka_agent_engine_server_enabled_orgs_v1()') IS NOT NULL THEN RAISE EXCEPTION 'V667 p2: đã có public.aka_agent_engine_server_enabled_orgs_v1()'; END IF;
  IF to_regprocedure('public.aka_agent_engine_close_server_runs_v1(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'V667 p2: đã có public.aka_agent_engine_close_server_runs_v1(bigint)'; END IF;
  IF to_regprocedure('public.aka_agent_engine_desktop_vps_enabled_v1()') IS NOT NULL THEN RAISE EXCEPTION 'V667 p2: đã có public.aka_agent_engine_desktop_vps_enabled_v1()'; END IF;
  IF to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NULL OR to_regprocedure('public.aka_agent_engine_close_run_v1(bigint,text)') IS NULL
     OR to_regprocedure('public.aka_agent_engine_scope_ok(bigint)') IS NULL OR to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'V667 p2: thiếu hàm phụ thuộc (flag_route / close_run_v1 / scope_ok / desktop_data_context)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'engine.zalo_server_vps') THEN RAISE EXCEPTION 'V667 p2: đã có dòng engine.zalo_server_vps'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.id = 255 AND p.runtime_target = 'desktop'
                  AND p.error_code = 'err_engine_unknown_delivery' AND p.action_code = 'zalo_find_phone_user' AND p.is_active AND NOT p.is_delete)
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.id = 256 AND p.runtime_target = 'fly'
                  AND p.error_code = 'err_engine_unknown_delivery' AND p.action_code = 'zalo_find_phone_user' AND p.is_active AND NOT p.is_delete) THEN
    RAISE EXCEPTION 'V667 p2: chính sách 255 / 256 không như đã đọc';
  END IF;
  IF (SELECT jsonb_build_object('error_code', a.error_code, 'error_class', a.error_class, 'status_id', a.status_id, 'action_code', a.action_code, 'campaign_action_id', a.campaign_action_id, 'detail_mode', a.detail_mode, 'detail_status_id', a.detail_status_id, 'sub_status_id', a.sub_status_id, 'log_template', a.log_template, 'campaign_note_template', a.campaign_note_template, 'quota_effect', a.quota_effect, 'target_streak_effect', a.target_streak_effect, 'streak_threshold', a.streak_threshold, 'target_effect', a.target_effect, 'requeue_after_minutes', a.requeue_after_minutes, 'remaining_steps', a.remaining_steps, 'lock_action_codes', a.lock_action_codes, 'lock_mode', a.lock_mode, 'lock_minutes', a.lock_minutes, 'lock_days', a.lock_days, 'lock_time', a.lock_time, 'run_effect', a.run_effect, 'pace_mode', a.pace_mode, 'pace_seconds', a.pace_seconds, 'campaign_effect', a.campaign_effect, 'campaign_hold_minutes', a.campaign_hold_minutes, 'account_effect', a.account_effect, 'login_effect', a.login_effect, 'description', a.description, 'is_active', a.is_active, 'is_delete', a.is_delete, 'streak_after_delivery', a.streak_after_delivery, 'target_check_enabled', a.target_check_enabled, 'target_check_days', a.target_check_days) FROM public.auto_outcome_policies a WHERE a.id = 255)
     IS DISTINCT FROM (SELECT jsonb_build_object('error_code', b.error_code, 'error_class', b.error_class, 'status_id', b.status_id, 'action_code', b.action_code, 'campaign_action_id', b.campaign_action_id, 'detail_mode', b.detail_mode, 'detail_status_id', b.detail_status_id, 'sub_status_id', b.sub_status_id, 'log_template', b.log_template, 'campaign_note_template', b.campaign_note_template, 'quota_effect', b.quota_effect, 'target_streak_effect', b.target_streak_effect, 'streak_threshold', b.streak_threshold, 'target_effect', b.target_effect, 'requeue_after_minutes', b.requeue_after_minutes, 'remaining_steps', b.remaining_steps, 'lock_action_codes', b.lock_action_codes, 'lock_mode', b.lock_mode, 'lock_minutes', b.lock_minutes, 'lock_days', b.lock_days, 'lock_time', b.lock_time, 'run_effect', b.run_effect, 'pace_mode', b.pace_mode, 'pace_seconds', b.pace_seconds, 'campaign_effect', b.campaign_effect, 'campaign_hold_minutes', b.campaign_hold_minutes, 'account_effect', b.account_effect, 'login_effect', b.login_effect, 'description', b.description, 'is_active', b.is_active, 'is_delete', b.is_delete, 'streak_after_delivery', b.streak_after_delivery, 'target_check_enabled', b.target_check_enabled, 'target_check_days', b.target_check_days) FROM public.auto_outcome_policies b WHERE b.id = 256) THEN
    RAISE EXCEPTION 'V667 p2: chính sách 255 (Desktop) và 256 (Fly) không còn giống nhau, dừng để chọn bản chép';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.runtime_target = 'server') THEN RAISE EXCEPTION 'V667 p2: đã có chính sách nơi chạy server'; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  PERFORM set_config('aka.v667_acl_claim', v_acl, true);
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)');
  PERFORM set_config('aka.v667_acl_finish', v_acl, true);
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.recover_server_zalo_running_state(bigint,text,boolean)');
  PERFORM set_config('aka.v667_acl_recover', v_acl, true);
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_server_org_enabled(p_organization_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Engine v2 cho tài khoản Zalo Server chạy trên VPS (App Server): tổ chức có trong engine.zalo_server_vps không. JSON
-- {"mode":"off|orgs|all","organizationIds":[…]}; thiếu dòng / sai định dạng = tắt. Claim gọi mỗi lần nhận lượt với nơi chạy 'server';
-- aka_agent_engine_desktop_vps_enabled_v1 gọi lúc Desktop đăng nhập.
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.zalo_server_vps' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN false; END IF;
  v := v_raw::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
END
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_engine_server_org_enabled(bigint) FROM PUBLIC;
DO $g$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_server_org_enabled(bigint) FROM %I', r); END IF;
  END LOOP;

END $g$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_desktop_vps_enabled_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Desktop đọc lúc đăng nhập khi cờ use_new_zalo_runtime của tổ chức tắt (aka_agent_engine_desktop_enabled_v1 trả false): tổ chức trong
  -- phiên có trong engine.zalo_server_vps không. Đúng thì tài khoản Zalo QR / trình duyệt chạy engine v2 trên Desktop như tổ chức bật cờ. Không đổi
  -- nơi chạy tài khoản Zalo Server (Desktop vẫn chọn Fly / App Server theo hàm V513). Không có phiên Desktop thì false.
  SELECT COALESCE((
    SELECT public.aka_agent_engine_server_org_enabled(ctx.organization_id)
      FROM private.aka_agent_desktop_data_context() AS ctx
     LIMIT 1
  ), false)
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_engine_desktop_vps_enabled_v1() FROM PUBLIC;
DO $g$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_desktop_vps_enabled_v1() FROM %I', r); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN GRANT EXECUTE ON FUNCTION public.aka_agent_engine_desktop_vps_enabled_v1() TO aka_agent_desktop; END IF;
END $g$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_server_enabled_orgs_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- App Server đọc 60 giây một lần: tổ chức nào chạy engine v2 cho tài khoản Zalo Server trên VPS (engine.zalo_server_vps). Trả
-- {"mode":"off|orgs|all","organizationIds":["…"]}; thiếu dòng / sai định dạng = off. Claim vẫn kiểm lại mỗi lần nhận lượt.
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.zalo_server_vps' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN jsonb_build_object('mode', 'off', 'organizationIds', '[]'::jsonb);
  END IF;
  v := v_raw::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('mode', 'off', 'organizationIds', '[]'::jsonb); END IF;
  IF v->>'mode' = 'all' THEN RETURN jsonb_build_object('mode', 'all', 'organizationIds', '[]'::jsonb); END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN jsonb_build_object('mode', 'orgs', 'organizationIds',
      (SELECT coalesce(jsonb_agg(DISTINCT (e.value #>> '{}')), '[]'::jsonb) FROM jsonb_array_elements(v->'organizationIds') e
        WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') ~ '^[0-9]{1,18}$'));
  END IF;
  RETURN jsonb_build_object('mode', 'off', 'organizationIds', '[]'::jsonb);
END
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_engine_server_enabled_orgs_v1() FROM PUBLIC;
DO $g$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_server_enabled_orgs_v1() FROM %I', r); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.aka_agent_engine_server_enabled_orgs_v1() TO service_role; END IF;
END $g$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_server_runs_v1(p_staff_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Engine v2 trên VPS (App Server): lượt engine 'server' còn mở của nhân viên khi không còn ai chạy nó. recover_server_zalo_running_state
-- gọi hàm này trước khi đánh dấu mọi data "đang chạy" là "hoàn thành" (App Server khởi động / dừng runtime của nhân viên, Fly nhận tổ chức,
-- Desktop nhận lại tài khoản sau khi VPS đã thả). Đóng từng lượt bằng aka_agent_engine_close_run_v1 (lý do server_reset): chưa ghi dấu
-- "sắp gửi" thì về hàng đợi, đã ghi dấu thì hoàn thành, không gửi lại. Phiên Desktop chỉ đóng được lượt của chính nhân viên. Lượt đang bị
-- khoá (job close_stale đang đóng) thì bỏ qua: job đóng nó, không chờ khoá chéo. Trả số lượt đã đóng.
DECLARE
  v_id bigint;
  v_n integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR NOT public.aka_agent_engine_scope_ok(p_staff_id) THEN RETURN 0; END IF;
  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.staff_id = p_staff_id AND tr.runtime_target = 'server'
     ORDER BY tr.id
     FOR UPDATE OF tr SKIP LOCKED
  LOOP
    IF public.aka_agent_engine_close_run_v1(v_id, 'server_reset') <> 'skipped' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_engine_close_server_runs_v1(bigint) FROM PUBLIC;
DO $g$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_close_server_runs_v1(bigint) FROM %I', r); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.aka_agent_engine_close_server_runs_v1(bigint) TO service_role; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN GRANT EXECUTE ON FUNCTION public.aka_agent_engine_close_server_runs_v1(bigint) TO aka_agent_chat_api; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN GRANT EXECUTE ON FUNCTION public.aka_agent_engine_close_server_runs_v1(bigint) TO aka_agent_desktop; END IF;
END $g$;

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
  -- V558: chạy lại sau N giờ (giờ, số nguyên ≥ 1).
  v_hours numeric;
  -- V561: lặp lại sau khi chạy xong.
  v_repeat jsonb;
  -- Lịch tuần / tháng có làm mới data: ngày chạy kế.
  v_rec_type text;
  v_rec_days integer[] := ARRAY[]::integer[];
  v_rec_token text;
  v_rec_number numeric;
  v_rec_date date;
  v_rec_offset integer;
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
  IF l.runtime_target IN ('fly', 'server') AND a.status IS DISTINCT FROM 'đang chạy' AND a.status IS DISTINCT FROM 'chờ xử lý' THEN
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
  -- V558: như MULTI_DAILY_TIME_SLOT_ACTION_IDS của bộ cũ (campaignScheduler.ts:666), gồm cả trang cá nhân và Page Facebook.
  IF c.action_id IN ('zalo_message_friend', 'zalo_message_group', 'facebook_timeline_post', 'facebook_page_post')
     AND v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb THEN
    -- Tách theo dấu phẩy/xuống dòng, chuẩn hoá H, H:M, HhM, Hh (giờ 0–23, phút 0–59), bỏ trùng theo phút, xếp tăng dần.
    SELECT coalesce(array_agg(s.slot ORDER BY s.minute), '{}'::text[]) INTO v_slots FROM (
      SELECT DISTINCT ON (x.minute) x.minute, x.slot FROM (
        SELECT (m[1])::integer * 60 + coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer AS minute,
               lpad(m[1]::integer::text, 2, '0') || ':' || lpad(coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer::text, 2, '0') AS slot
          -- Danh sách khung giờ: Desktop lưu chuỗi "08:00,09:00", Web lưu mảng ["08:00", "09:00"]. Mảng thì nối các phần tử bằng dấu phẩy
          -- (bộ cũ đọc mảng bằng String(mảng), cũng ra chuỗi đó) rồi tách và chuẩn hoá như chuỗi; phần tử null bỏ qua.
          FROM regexp_split_to_table(CASE jsonb_typeof(v_extra->'multiDailyTimeSlots') WHEN 'string' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'number' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'array' THEN (SELECT coalesce(string_agg(e.slot_text, ','), '')
                                                               FROM jsonb_array_elements_text(v_extra->'multiDailyTimeSlots') AS e(slot_text))
                                          ELSE '' END, '[,\r\n]+') item,
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

  -- 5b. (V561) Lặp lại sau khi chạy xong: lịch Hàng ngày, x phút / giờ / ngày tính từ lúc chạy xong, tới khi đủ số lượt tối đa hoặc tới
  -- ngày kết thúc. Như handleCampaignRepeatAfterCompletion của bộ cũ: chỉ tính lượt khi lượt này thật sự chạy hết (không còn data chờ)
  -- và còn data để chạy lại (đăng trang cá nhân, lướt newsfeed không có dòng data nào vẫn lặp, bước 6 hẹn lượt kế mà không đặt lại gì).
  -- Các kiểm tra đó trùng với bước 6 nên bước 6 không rẽ nhánh khác sau khi đã đếm lượt. Đang bật lặp thì "chạy lại sau N giờ" kiểu cũ
  -- (V558) không áp dụng, kể cả khi lượt này đã là lượt cuối.
  IF v_mode IS NULL AND v_extra->'repeatAfterCompletionEnabled' = 'true'::jsonb
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý')
     AND (EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                   WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng')
          OR (c.action_id IN ('facebook_timeline_post', 'facebook_newsfeed_interaction')
              AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false))) THEN
    v_repeat := private.aka_agent_campaign_repeat_core(c, v_now, true, NULL, 'engine');
    IF (v_repeat->>'repeat')::boolean THEN
      v_next := (v_repeat->>'next')::timestamptz;
      v_mode := 'repeat_scheduled';
      v_suffix := 'ở lượt lặp kế tiếp';
    ELSIF NOT (v_repeat->>'enabled')::boolean THEN
      v_repeat := NULL;
    END IF;
  END IF;

  -- V558: chạy lại sau N giờ khi xong (handleRerunAfterCompletion, campaignScheduler.ts:2711-2786): tìm data trong group / bằng search,
  -- comment seeding, newsfeed; findDataRerunEnabled đúng true, findDataRerunAfterHours lấy phần nguyên, dưới 1 hoặc sai thì tắt (hoàn thành
  -- như thường). Lịch kế = bây giờ + N giờ; khác ngày nhận lượt hoặc khác hôm nay → hoàn thành; từ giờ dừng trong ngày → hoàn thành. Trừ
  -- newsfeed (không có data): mọi data chưa xoá, khác "tạm dừng" về "chờ xử lý" (ghi chú rỗng, date_action NULL); không còn data nào như
  -- vậy → hoàn thành. Không qua bước "còn data đến hạn" và không đòi có data (khác nhánh 6).
  IF v_mode IS NULL AND v_repeat IS NULL
     AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction',
                         'web_find_data_nhatot', 'web_find_data_batdongsan', 'web_find_data_yellowpages')
     AND v_extra->'findDataRerunEnabled' = 'true'::jsonb THEN
    v_raw := v_extra->'findDataRerunAfterHours';
    v_hours := CASE
      WHEN jsonb_typeof(v_raw) = 'number' THEN floor((v_raw #>> '{}')::numeric)
      WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^[0-9]{1,6}(\.[0-9]+)?$' THEN floor(btrim(v_raw #>> '{}')::numeric) END;
    IF v_hours >= 1 AND v_hours <= 1000000 THEN
      v_next := v_now + make_interval(hours => v_hours::integer);
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         OR (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> v_vn THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_next_day', NULL);
      END IF;
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_after_cutoff', jsonb_build_object('hours', v_hours));
      END IF;
      IF c.action_id <> 'facebook_newsfeed_interaction' THEN
        SELECT count(*) INTO v_resettable FROM public.auto_campaign_input_data d
         WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng';
        IF v_resettable = 0 THEN
          RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_no_data', NULL);
        END IF;
        UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
         WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
      END IF;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'rerun_scheduled', 'schedule', v_next, 'hours', v_hours, 'campaignStatus', 'chờ xử lý');
    END IF;
  END IF;

  -- 5c. (sau "chạy lại sau N giờ") Lịch tuần / tháng có làm mới data (refresh_data): chạy xong danh sách trong ngày thì không hoàn thành mà hẹn ngày chạy kế
  -- (từ ngày mai, theo ngày trong tuần / trong tháng đã chọn, giờ theo original_schedule) rồi đi bước 6: đặt lại data (trừ "tạm dừng"),
  -- chiến dịch về "chờ xử lý". Ngày chạy kế quá ngày kết thúc, không tính được, hay không còn data chạy lại được thì hoàn thành như cũ.
  -- Như handleRecurringRefreshAfterCompletion của bộ cũ (campaignScheduler.ts). Up tin, sinh nhật, đề xuất kết bạn, huỷ lời mời: bảo trì
  -- lịch ngày mới có cách riêng, giữ như cũ. Lý do trả về 'rerun_scheduled' để mọi bản lõi đang chạy in đúng câu hẹn chạy lại.
  -- So khớp đúng từng ký tự như bộ cũ (Desktop / ChatApi): " weekly" / "Weekly" không phải lịch tuần (giả lập 24/11/2026).
  v_rec_type := coalesce(nullif(c.schedule_type, ''), 'daily');
  IF v_mode IS NULL AND v_repeat IS NULL AND v_rec_type IN ('weekly', 'monthly') AND c.refresh_data IS TRUE
     AND c.action_id NOT IN ('zalo_message_birthday', 'zalo_message_friend_recommendation', 'zalo_cancel_sent_friend_request')
     AND NOT (c.action_id = 'facebook_comment_seeding_post' AND coalesce(c.name, '') LIKE 'Up tin cho chiến dịch %')
     AND coalesce(c.original_schedule, c.schedule) IS NOT NULL THEN
    FOREACH v_rec_token IN ARRAY string_to_array(CASE WHEN v_rec_type = 'weekly' THEN coalesce(c.schedule_week_days, '')
                                                      ELSE coalesce(c.schedule_days, '') END, ',') LOOP
      CONTINUE WHEN btrim(v_rec_token) !~ '^\+?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$';
      BEGIN
        v_rec_number := btrim(v_rec_token)::numeric;
        IF v_rec_number = trunc(v_rec_number)
           AND ((v_rec_type = 'weekly' AND v_rec_number BETWEEN 2 AND 8) OR (v_rec_type = 'monthly' AND v_rec_number BETWEEN 1 AND 31))
           AND NOT v_rec_number::integer = ANY(v_rec_days) THEN
          v_rec_days := array_append(v_rec_days, v_rec_number::integer);
        END IF;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN NULL;
      END;
    END LOOP;
    v_rec_date := NULL;
    IF cardinality(v_rec_days) > 0 THEN
      FOR v_rec_offset IN 1..(CASE WHEN v_rec_type = 'weekly' THEN 14 ELSE 370 END) LOOP
        IF (v_rec_type = 'weekly' AND (extract(isodow FROM v_vn + v_rec_offset)::integer + 1) = ANY(v_rec_days))
           OR (v_rec_type = 'monthly' AND extract(day FROM v_vn + v_rec_offset)::integer = ANY(v_rec_days)) THEN
          v_rec_date := v_vn + v_rec_offset;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF v_rec_date IS NOT NULL THEN
      v_candidate := ((v_rec_date + date_trunc('second', coalesce(c.original_schedule, c.schedule) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)::timestamp
                      AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF c.schedule_end_date IS NULL OR v_candidate <= c.schedule_end_date THEN
        v_next := v_candidate;
        v_mode := 'rerun_scheduled';
        v_suffix := 'ở ngày chạy kế tiếp';
      END IF;
    END IF;
  END IF;

  IF v_mode IS NULL THEN
    v_raw := public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed',
      CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) END);
    IF v_repeat IS NOT NULL AND v_raw->>'campaignStatus' = 'hoàn thành' THEN
      PERFORM private.aka_agent_campaign_repeat_confirm_end(c.id);
    END IF;
    RETURN v_raw;
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
    -- V558: như rescheduleCompletedCampaignPass của bộ cũ: Page không có dòng data nào thì hoàn thành ("không có page…"); chiến dịch Facebook
    -- khác không có dòng data nào (trang cá nhân) thì hẹn khung kế mà không đặt lại gì. Có data mà không đặt lại được thì hoàn thành như Zalo.
    IF c.action_id = 'facebook_page_post' AND v_total = 0 THEN
      RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_page', jsonb_build_object('suffix', v_suffix));
    END IF;
    IF c.action_id LIKE 'facebook\_%' AND v_total = 0 THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
        || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END
        || CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) ELSE '{}'::jsonb END;
    END IF;
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_data', jsonb_build_object('suffix', v_suffix));
  END IF;
  UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
   WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END
    || CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) ELSE '{}'::jsonb END;
END $function$
;

CREATE OR REPLACE FUNCTION public.recover_server_zalo_running_state(p_staff_id bigint, p_expected_mode_revision text DEFAULT NULL::text, p_require_server_mode boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_recovery_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_id bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'update') AS staff
  WHERE staff.id = p_staff_id
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  IF NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NOT NULL
    AND v_capabilities.capability_revision IS DISTINCT FROM btrim(p_expected_mode_revision)
  THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  IF COALESCE(p_require_server_mode, false) AND (
    NOT COALESCE(v_capabilities.server_enabled, false)
    OR NOT COALESCE(v_capabilities.qr_enabled, false)
    OR v_capabilities.entitlement_id IS NULL
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  -- Claims/finalizers serialize campaign/input rows through this barrier.
  -- Recovery can touch more than one campaign, so acquire the complete set in
  -- ascending ID order before its first child/campaign row mutation. The staff
  -- row lock above prevents a new runtime claim from entering while this
  -- candidate set is established.
  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  -- Engine v2 trên VPS: lượt engine (runtime_target = 'server') còn mở của nhân viên không còn ai chạy (App Server khởi động / dừng runtime,
  -- Fly nhận tổ chức, Desktop nhận lại tài khoản sau khi VPS đã thả). Đóng từng lượt như hàm đóng lượt của engine trước khi bước dưới đánh
  -- dấu mọi data "đang chạy" là "hoàn thành": chưa ghi dấu "sắp gửi" thì về hàng đợi, đã ghi dấu thì hoàn thành, không gửi lại.
  PERFORM public.aka_agent_engine_close_server_runs_v1(p_staff_id);

  -- A recovery requested by Server may only mutate Server-subtype accounts.
  -- With p_require_server_mode=false this also cleans an interrupted Server
  -- account after its capability/entitlement expired, without touching local.
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE input_data.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND input_data.status = 'đang chạy'
      AND COALESCE(input_data.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

    UPDATE public.auto_campaign_inputs AS campaign_input
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign_input.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND campaign_input.status = 'đang chạy'
      AND COALESCE(campaign_input.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

    UPDATE public.auto_campaigns AS campaign
    SET status = 'chờ xử lý', updated_at = now()
    FROM public.auto_accounts AS account
    WHERE campaign.account_id = account.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND campaign.status = 'đang chạy'
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false;
    GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

    UPDATE public.auto_accounts AS account
    SET status = 'chờ xử lý', updated_at = now()
    WHERE account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  -- V497: App Server dừng runtime của nhân viên (đã ngắt mọi kết nối Zalo, rồi gọi hàm này với
  -- p_require_server_mode false) thì ghi mốc cho việc chép phiên sang Fly. Fly (aka_agent_chat_api) và lúc
  -- khởi động (p_require_server_mode true) không ghi. Lỗi ở bước ghi mốc không được làm hỏng việc dọn của VPS.
  IF current_user = 'service_role' AND NOT COALESCE(p_require_server_mode, false) THEN
    BEGIN
      PERFORM private.aka_agent_zalo_server_mark_vps_released(p_staff_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'V497 mark_vps_released staff %: %', p_staff_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_inputs_completed', v_campaign_inputs_completed,
    'campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$
;

INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, detail_mode, detail_status_id, sub_status_id, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps, lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes, account_effect, login_effect, description, is_active, is_delete, streak_after_delivery, target_check_enabled, target_check_days, runtime_target, source)
SELECT error_code, error_class, status_id, action_code, campaign_action_id, detail_mode, detail_status_id, sub_status_id, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps, lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes, account_effect, login_effect, description, is_active, is_delete, streak_after_delivery, target_check_enabled, target_check_days, 'server', 'v667'
  FROM public.auto_outcome_policies WHERE id = 255;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('engine.zalo_server_vps', '{"mode":"off","organizationIds":[]}', 'Engine v2 cho tổ chức chưa bật cờ use_new_zalo_runtime (V667): tài khoản Zalo Server chạy trên VPS (App Server) và tài khoản Zalo QR / trình duyệt chạy trên Desktop. JSON: mode off | orgs (chỉ organizationIds) | all. Thiếu dòng / sai định dạng = off. App Server đọc 60 giây một lần (aka_agent_engine_server_enabled_orgs_v1), claim kiểm lại mỗi lần nhận lượt nên tắt có hiệu lực ở lượt sau, chiến dịch quay về bộ cũ. Desktop (bản có V667) đọc lúc đăng nhập (aka_agent_engine_desktop_vps_enabled_v1): bật / tắt có hiệu lực ở lần đăng nhập sau. Tổ chức bật cờ use_new_zalo_runtime không bị ảnh hưởng. Phương án: docs/ENGINE_V2_VPS_ZALO_SERVER_PLAN.md.', false, true);

DO $post$
DECLARE v_acl text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)'))) IS DISTINCT FROM 'df4b8e4284c911dad4b275383f7ddb2b' THEN
    RAISE EXCEPTION 'V667 p2 postflight: định nghĩa claim %', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)')));
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'))) IS DISTINCT FROM 'e998853516d029ca9edf005e389372e0' THEN
    RAISE EXCEPTION 'V667 p2 postflight: định nghĩa finish %', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)')));
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.recover_server_zalo_running_state(bigint,text,boolean)'))) IS DISTINCT FROM '48b966d5e98d8ac9125dc2ba918f1c64' THEN
    RAISE EXCEPTION 'V667 p2 postflight: định nghĩa recover %', md5(pg_get_functiondef(to_regprocedure('public.recover_server_zalo_running_state(bigint,text,boolean)')));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_acl IS DISTINCT FROM current_setting('aka.v667_acl_claim', true) THEN RAISE EXCEPTION 'V667 p2 postflight: quyền / chủ sở hữu claim bị đổi'; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)');
  IF v_acl IS DISTINCT FROM current_setting('aka.v667_acl_finish', true) THEN RAISE EXCEPTION 'V667 p2 postflight: quyền / chủ sở hữu finish bị đổi'; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.recover_server_zalo_running_state(bigint,text,boolean)');
  IF v_acl IS DISTINCT FROM current_setting('aka.v667_acl_recover', true) THEN RAISE EXCEPTION 'V667 p2 postflight: quyền / chủ sở hữu recover bị đổi'; END IF;
  IF to_regprocedure('public.aka_agent_engine_server_org_enabled(bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_server_org_enabled(bigint)'))) IS DISTINCT FROM '043e87cc42a0a3d29462eac68213590c' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới orgEnabled không như bản sinh';
  END IF;
  IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_server_org_enabled(bigint)')) IS DISTINCT FROM 'postgres'
     AND current_user = 'postgres' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới orgEnabled không thuộc postgres';
  END IF;
  IF to_regprocedure('public.aka_agent_engine_server_enabled_orgs_v1()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_server_enabled_orgs_v1()'))) IS DISTINCT FROM 'dc80810392f1ff798c048f17449aabbe' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới enabledOrgs không như bản sinh';
  END IF;
  IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_server_enabled_orgs_v1()')) IS DISTINCT FROM 'postgres'
     AND current_user = 'postgres' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới enabledOrgs không thuộc postgres';
  END IF;
  IF to_regprocedure('public.aka_agent_engine_close_server_runs_v1(bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_server_runs_v1(bigint)'))) IS DISTINCT FROM '6db47b785dbe718810c7aa46fe2eb5d5' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới closeRuns không như bản sinh';
  END IF;
  IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_close_server_runs_v1(bigint)')) IS DISTINCT FROM 'postgres'
     AND current_user = 'postgres' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới closeRuns không thuộc postgres';
  END IF;
  IF to_regprocedure('public.aka_agent_engine_desktop_vps_enabled_v1()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_desktop_vps_enabled_v1()'))) IS DISTINCT FROM '916ded1183a7de8be5422c332be249a5' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới desktopVps không như bản sinh';
  END IF;
  IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_desktop_vps_enabled_v1()')) IS DISTINCT FROM 'postgres'
     AND current_user = 'postgres' THEN
    RAISE EXCEPTION 'V667 p2 postflight: hàm mới desktopVps không thuộc postgres';
  END IF;
  IF (SELECT count(*) FROM public.auto_outcome_policies p WHERE p.runtime_target = 'server') <> 1
     OR (SELECT jsonb_build_object('error_code', a.error_code, 'error_class', a.error_class, 'status_id', a.status_id, 'action_code', a.action_code, 'campaign_action_id', a.campaign_action_id, 'detail_mode', a.detail_mode, 'detail_status_id', a.detail_status_id, 'sub_status_id', a.sub_status_id, 'log_template', a.log_template, 'campaign_note_template', a.campaign_note_template, 'quota_effect', a.quota_effect, 'target_streak_effect', a.target_streak_effect, 'streak_threshold', a.streak_threshold, 'target_effect', a.target_effect, 'requeue_after_minutes', a.requeue_after_minutes, 'remaining_steps', a.remaining_steps, 'lock_action_codes', a.lock_action_codes, 'lock_mode', a.lock_mode, 'lock_minutes', a.lock_minutes, 'lock_days', a.lock_days, 'lock_time', a.lock_time, 'run_effect', a.run_effect, 'pace_mode', a.pace_mode, 'pace_seconds', a.pace_seconds, 'campaign_effect', a.campaign_effect, 'campaign_hold_minutes', a.campaign_hold_minutes, 'account_effect', a.account_effect, 'login_effect', a.login_effect, 'description', a.description, 'is_active', a.is_active, 'is_delete', a.is_delete, 'streak_after_delivery', a.streak_after_delivery, 'target_check_enabled', a.target_check_enabled, 'target_check_days', a.target_check_days) FROM public.auto_outcome_policies a WHERE a.runtime_target = 'server')
        IS DISTINCT FROM (SELECT jsonb_build_object('error_code', b.error_code, 'error_class', b.error_class, 'status_id', b.status_id, 'action_code', b.action_code, 'campaign_action_id', b.campaign_action_id, 'detail_mode', b.detail_mode, 'detail_status_id', b.detail_status_id, 'sub_status_id', b.sub_status_id, 'log_template', b.log_template, 'campaign_note_template', b.campaign_note_template, 'quota_effect', b.quota_effect, 'target_streak_effect', b.target_streak_effect, 'streak_threshold', b.streak_threshold, 'target_effect', b.target_effect, 'requeue_after_minutes', b.requeue_after_minutes, 'remaining_steps', b.remaining_steps, 'lock_action_codes', b.lock_action_codes, 'lock_mode', b.lock_mode, 'lock_minutes', b.lock_minutes, 'lock_days', b.lock_days, 'lock_time', b.lock_time, 'run_effect', b.run_effect, 'pace_mode', b.pace_mode, 'pace_seconds', b.pace_seconds, 'campaign_effect', b.campaign_effect, 'campaign_hold_minutes', b.campaign_hold_minutes, 'account_effect', b.account_effect, 'login_effect', b.login_effect, 'description', b.description, 'is_active', b.is_active, 'is_delete', b.is_delete, 'streak_after_delivery', b.streak_after_delivery, 'target_check_enabled', b.target_check_enabled, 'target_check_days', b.target_check_days) FROM public.auto_outcome_policies b WHERE b.id = 255) THEN
    RAISE EXCEPTION 'V667 p2 postflight: chính sách nơi chạy server không như bản chép';
  END IF;
  IF public.aka_agent_engine_server_enabled_orgs_v1() IS DISTINCT FROM '{"mode": "off", "organizationIds": []}'::jsonb THEN
    RAISE EXCEPTION 'V667 p2 postflight: công tắc phải đang tắt';
  END IF;
END $post$;

COMMIT;
