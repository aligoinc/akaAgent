-- V681: engine v2 không để tài khoản kẹt "đang chạy". SINH TỪ scripts/build-v681-sql.cjs, không sửa tay.
-- release_v1 / close_stale_v1 trả tài khoản về "chờ xử lý" theo cùng luật dấu bộ cũ quá hạn với bước nhận lượt (V527). Thêm
-- private.aka_agent_engine_legacy_hold_v1 / private.aka_agent_engine_account_holder_v1 (worker Fly đọc được). Dọn một lần lúc apply: dấu
-- giữ lượt quá hạn trên chiến dịch đích 'server', tài khoản Zalo Server "đang chạy" không gì giữ. Không có bước tự gỡ định kỳ. Nguồn: thân production
-- sau V670 (kiểm md5). Gỡ: rollback_v681_engine_account_hold_rule.sql.
-- DDL (CREATE FUNCTION): PostgREST nạp lại schema; apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v681_engine_account_hold_rule') THEN
      RAISE EXCEPTION 'migration_v681_engine_account_hold_rule đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regnamespace('private') IS NULL THEN RAISE EXCEPTION 'V681: thiếu schema private'; END IF;
  IF to_regprocedure('public.aka_agent_engine_setting(text,text)') IS NULL THEN RAISE EXCEPTION 'V681: thiếu aka_agent_engine_setting'; END IF;
  IF to_regprocedure('private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone)') IS NOT NULL OR to_regprocedure('private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'V681 đã chạy (hàm giữ tài khoản đã có)';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V681: không có public.aka_agent_engine_release_v1(bigint,uuid)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '806a6564e85d100e7cec6e053a00a61a' THEN RAISE EXCEPTION 'V681 đã chạy (release)'; END IF;
  IF v_md5 IS DISTINCT FROM '85ee6d8541b0d5cd0462063dc11bccf0' THEN
    RAISE EXCEPTION 'V681: định nghĩa release khác bản sau V670 đã đối chiếu, dừng để đối chiếu bản live (%)', v_md5;
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid)) IS DISTINCT FROM 'd47d1828addaaf816451d2f3a53c3990' THEN
    RAISE EXCEPTION 'V681: thân release khác bản sau V670 đã đối chiếu';
  END IF;
  PERFORM set_config('aka.v681_attrs_release', (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)')), true);
  v_oid := to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V681: không có public.aka_agent_engine_close_stale_v1(integer)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '205a9972f3813796fcc35661675d83b7' THEN RAISE EXCEPTION 'V681 đã chạy (close_stale)'; END IF;
  IF v_md5 IS DISTINCT FROM 'b4e2c1664e90212edec6fa2bfd036009' THEN
    RAISE EXCEPTION 'V681: định nghĩa close_stale khác bản sau V670 đã đối chiếu, dừng để đối chiếu bản live (%)', v_md5;
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid)) IS DISTINCT FROM '09dfc2d77a89efc497131d78444c9f35' THEN
    RAISE EXCEPTION 'V681: thân close_stale khác bản sau V670 đã đối chiếu';
  END IF;
  PERFORM set_config('aka.v681_attrs_close_stale', (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')), true);
END $pre$;

CREATE OR REPLACE FUNCTION private.aka_agent_engine_legacy_hold_v1(p_account_id bigint, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_setting text;
  v_before timestamptz;
BEGIN
  -- Tài khoản còn dấu giữ lượt của bộ cũ CHƯA quá hạn. Cùng luật với bước nhận lượt (aka_agent_engine_claim_target_v1): dấu trên chiến
  -- dịch đã xoá / "tạm dừng", không giữ unit lease, không còn data "đang chạy", và cả lúc claim lẫn lần ghi cuối của chiến dịch đã cũ hơn
  -- engine.legacy_stale_claim_minutes phút (mặc định 30, tối thiểu 10) là dấu sót lại, không giữ tài khoản. Không có chiến dịch nào giữ token: chỉ
  -- một câu EXISTS, không đọc thiết lập.
  IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns x
                  WHERE x.account_id = p_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    RETURN false;
  END IF;
  v_setting := btrim(public.aka_agent_engine_setting('engine.legacy_stale_claim_minutes', '30'));
  v_before := coalesce(p_now, clock_timestamp()) - make_interval(mins => CASE WHEN v_setting ~ '^[0-9]{1,6}$'
                                                                            THEN greatest(10, v_setting::integer) ELSE 30 END);
  RETURN EXISTS (SELECT 1 FROM public.auto_campaigns x
                  WHERE x.account_id = p_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                    AND NOT (x.runtime_unit_token IS NULL
                             AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                             AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < v_before
                             AND coalesce(x.updated_at, '-infinity'::timestamptz) < v_before
                             AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                              WHERE d.campaign_id = x.id AND d.status = 'đang chạy'
                                                AND coalesce(d.is_delete, false) = false)));
END
$function$
;
CREATE OR REPLACE FUNCTION private.aka_agent_engine_account_holder_v1(p_account_id bigint, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_hours text;
  v_alive_after timestamptz;
BEGIN
  -- Lý do tài khoản còn bị giữ, NULL khi không gì giữ (không xét trạng thái tài khoản). Thứ tự: token thao tác tài khoản (thao tác tài
  -- khoản, claim bộ cũ Server), lease engine (mọi làn, kể cả lease đã hết hạn chưa dọn), lượt engine còn mở, dấu giữ lượt của bộ cũ chưa
  -- quá hạn (luật V527), chiến dịch chưa xoá "đang chạy" còn sống: có data "đang chạy", hoặc ghi / chạy trong engine.account_hold_campaign_idle_hours
  -- giờ (mặc định 6). Claim bộ cũ Desktop đặt tài khoản + chiến dịch "đang chạy" mà không ghi token nào.
  IF EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.id = p_account_id AND a.runtime_operation_claim_token IS NOT NULL) THEN
    RETURN 'operation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = p_account_id) THEN RETURN 'lease'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = p_account_id AND tr.completed_at IS NULL) THEN
    RETURN 'open_run';
  END IF;
  IF private.aka_agent_engine_legacy_hold_v1(p_account_id, v_now) THEN RETURN 'legacy_claim'; END IF;
  v_hours := btrim(public.aka_agent_engine_setting('engine.account_hold_campaign_idle_hours', '6'));
  v_alive_after := v_now - make_interval(hours => CASE WHEN v_hours ~ '^[0-9]{1,3}$' THEN greatest(1, v_hours::integer) ELSE 6 END);
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = p_account_id AND x.status = 'đang chạy' AND coalesce(x.is_delete, false) = false
                AND (greatest(coalesce(x.updated_at, '-infinity'::timestamptz), coalesce(x.last_run_at, '-infinity'::timestamptz)) >= v_alive_after
                     OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                 WHERE d.campaign_id = x.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false))) THEN
    RETURN 'campaign_running';
  END IF;
  RETURN NULL;
END
$function$
;
REVOKE ALL ON FUNCTION private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone) FROM anon; REVOKE ALL ON FUNCTION private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone) FROM authenticated; REVOKE ALL ON FUNCTION private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    REVOKE ALL ON FUNCTION private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone) FROM aka_agent_desktop; REVOKE ALL ON FUNCTION private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone) FROM aka_agent_desktop;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone) TO service_role; GRANT EXECUTE ON FUNCTION private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_chat_api') THEN
    GRANT EXECUTE ON FUNCTION private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone) TO aka_agent_chat_api; GRANT EXECUTE ON FUNCTION private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone) TO aka_agent_chat_api;
  END IF;
END $grant$;

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
  -- Dấu giữ lượt của bộ cũ đã quá hạn (luật V527 của bước nhận lượt) không giữ tài khoản: private.aka_agent_engine_legacy_hold_v1.
  UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = p_account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT private.aka_agent_engine_legacy_hold_v1(auto_accounts.id, v_now)
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
    -- Dấu giữ lượt của bộ cũ đã quá hạn (luật V527 của bước nhận lượt) không giữ tài khoản: private.aka_agent_engine_legacy_hold_v1.
    UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT private.aka_agent_engine_legacy_hold_v1(auto_accounts.id, v_now)
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases ol WHERE ol.account_id = auto_accounts.id AND ol.expires_at > v_now - v_stale);
    v_released := v_released + 1;
  END LOOP;
  RETURN jsonb_build_object('closedTargets', v_closed, 'releasedLeases', v_released, 'orphanTargets', v_orphans, 'finalizedTargets', v_final);
END $function$
;

DO $post$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)'))) IS DISTINCT FROM '806a6564e85d100e7cec6e053a00a61a' THEN
    RAISE EXCEPTION 'V681 postflight: định nghĩa release %', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)')));
  END IF;
  IF (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)')) IS DISTINCT FROM current_setting('aka.v681_attrs_release', true) THEN
    RAISE EXCEPTION 'V681 postflight: quyền / chủ sở hữu / thuộc tính release bị đổi';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)'))) IS DISTINCT FROM '205a9972f3813796fcc35661675d83b7' THEN
    RAISE EXCEPTION 'V681 postflight: định nghĩa close_stale %', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')));
  END IF;
  IF (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')) IS DISTINCT FROM current_setting('aka.v681_attrs_close_stale', true) THEN
    RAISE EXCEPTION 'V681 postflight: quyền / chủ sở hữu / thuộc tính close_stale bị đổi';
  END IF;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone)');
  IF NOT FOUND THEN RAISE EXCEPTION 'V681 postflight: thiếu private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone)'; END IF;
  IF md5(p.prosrc) IS DISTINCT FROM '69f3f078b5261b34fd2b293f5056ab3a' OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
     OR p.provolatile IS DISTINCT FROM 's' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'V681 postflight: legacy_hold sai thân / thuộc tính';
  END IF;
  IF has_function_privilege('public', 'private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone)', 'EXECUTE') THEN RAISE EXCEPTION 'V681 postflight: PUBLIC còn quyền legacy_hold'; END IF;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)');
  IF NOT FOUND THEN RAISE EXCEPTION 'V681 postflight: thiếu private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)'; END IF;
  IF md5(p.prosrc) IS DISTINCT FROM 'ca68fb7555920b1ed0928ee711358740' OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
     OR p.provolatile IS DISTINCT FROM 's' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'V681 postflight: holder sai thân / thuộc tính';
  END IF;
  IF has_function_privilege('public', 'private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)', 'EXECUTE') THEN RAISE EXCEPTION 'V681 postflight: PUBLIC còn quyền holder'; END IF;
  IF private.aka_agent_engine_account_holder_v1(-1, clock_timestamp()) IS NOT NULL
     OR private.aka_agent_engine_legacy_hold_v1(-1, clock_timestamp()) THEN
    RAISE EXCEPTION 'V681 postflight: tài khoản không tồn tại mà vẫn bị giữ';
  END IF;
END $post$;

-- Dọn một lần lúc apply (anh chốt 27/11/2026 "Bỏ, dọn một lần": không tự gỡ định kỳ; như lần gỡ tay 15:21 VN 27/11). Luật mới ở trên có
-- hiệu lực từ lần nhả lượt sau, nên tài khoản đang kẹt và dấu quá hạn hiện có được gỡ ở đây. Bỏ qua dòng đang bị khoá (SKIP LOCKED), không
-- gỡ lại sau đó: tài khoản còn kẹt hiện ở câu dò scripts/engine-v2-stuck-accounts.cjs.
DO $once$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_setting text := btrim(public.aka_agent_engine_setting('engine.legacy_stale_claim_minutes', '30'));
  v_before timestamptz;
  r record;
  v_cleared integer := 0;
  v_reset integer := 0;
BEGIN
  v_before := v_now - make_interval(mins => CASE WHEN v_setting ~ '^[0-9]{1,6}$' THEN greatest(10, v_setting::integer) ELSE 30 END);
  -- (1) Dấu giữ lượt quá hạn của bộ cũ (luật V527) trên chiến dịch đích 'server' của tài khoản Zalo Server chưa xoá.
  FOR r IN
    SELECT c.id, c.runtime_claim_token
      FROM public.auto_campaigns c
      JOIN public.auto_accounts a ON a.id = c.account_id
     WHERE c.runtime_claim_token IS NOT NULL AND c.runtime_unit_token IS NULL AND c.runtime_claim_target = 'server'
       AND (coalesce(c.is_delete, false) OR c.status = 'tạm dừng')
       AND coalesce(c.runtime_claimed_at, '-infinity'::timestamptz) < v_before
       AND coalesce(c.updated_at, '-infinity'::timestamptz) < v_before
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                        WHERE d.campaign_id = c.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false)
       AND coalesce(a.is_delete, false) = false AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
       AND coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false)
     ORDER BY c.id
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    UPDATE public.auto_campaigns
       SET runtime_claim_token = NULL, runtime_claim_target = NULL, runtime_claim_vietnam_date = NULL, runtime_claimed_at = NULL
     WHERE id = r.id AND runtime_claim_token = r.runtime_claim_token AND runtime_unit_token IS NULL;
    IF FOUND THEN v_cleared := v_cleared + 1; END IF;
  END LOOP;
  -- (2) Tài khoản Zalo Server "đang chạy" mà không gì giữ (private.aka_agent_engine_account_holder_v1, kiểm bằng câu riêng sau khi khoá
  -- dòng), lần ghi cuối quá 3 phút: về "chờ xử lý".
  FOR r IN
    SELECT a.id FROM public.auto_accounts a
     WHERE a.status = 'đang chạy' AND a.runtime_operation_claim_token IS NULL AND coalesce(a.is_delete, false) = false
       AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false)
       AND a.updated_at < v_now - make_interval(mins => 3)
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = a.id AND tr.completed_at IS NULL)
     ORDER BY a.id
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    IF private.aka_agent_engine_account_holder_v1(r.id, v_now) IS NULL THEN
      UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now
       WHERE id = r.id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL;
      IF FOUND THEN v_reset := v_reset + 1; END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'V681 dọn một lần: % dấu giữ lượt quá hạn đã xoá, % tài khoản về "chờ xử lý"', v_cleared, v_reset;
END $once$;
COMMIT;
