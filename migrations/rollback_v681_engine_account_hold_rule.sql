-- Gỡ V681. SINH TỪ scripts/build-v681-sql.cjs, không sửa tay.
-- Trả release_v1 / close_stale_v1 về thân sau V670 và xoá hai hàm giữ tài khoản. Worker Fly bản đọc
-- private.aka_agent_engine_account_holder_v1 tự bỏ điều kiện đó khi hàm mất (ChatApi engineAccountSelfHeal.ts). Bước dọn một lần lúc apply
-- (dấu giữ lượt quá hạn đã xoá, tài khoản đã trả về "chờ xử lý") không được khôi phục.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)'))) IS DISTINCT FROM '806a6564e85d100e7cec6e053a00a61a' THEN
    RAISE EXCEPTION 'Gỡ V681: release không phải bản V681 (%), dừng', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)')));
  END IF;
  PERFORM set_config('aka.v681_rb_attrs_release', (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)')), true);
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)'))) IS DISTINCT FROM '205a9972f3813796fcc35661675d83b7' THEN
    RAISE EXCEPTION 'Gỡ V681: close_stale không phải bản V681 (%), dừng', md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')));
  END IF;
  PERFORM set_config('aka.v681_rb_attrs_close_stale', (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')), true);
END $pre$;

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
DROP FUNCTION private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone);
DROP FUNCTION private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone);

DO $post$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)'))) IS DISTINCT FROM '85ee6d8541b0d5cd0462063dc11bccf0' THEN
    RAISE EXCEPTION 'Gỡ V681 postflight: release chưa về bản sau V670';
  END IF;
  IF (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_release_v1(bigint,uuid)')) IS DISTINCT FROM current_setting('aka.v681_rb_attrs_release', true) THEN
    RAISE EXCEPTION 'Gỡ V681 postflight: quyền / chủ sở hữu / thuộc tính release bị đổi';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)'))) IS DISTINCT FROM 'b4e2c1664e90212edec6fa2bfd036009' THEN
    RAISE EXCEPTION 'Gỡ V681 postflight: close_stale chưa về bản sau V670';
  END IF;
  IF (SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')) IS DISTINCT FROM current_setting('aka.v681_rb_attrs_close_stale', true) THEN
    RAISE EXCEPTION 'Gỡ V681 postflight: quyền / chủ sở hữu / thuộc tính close_stale bị đổi';
  END IF;
  IF to_regprocedure('private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)') IS NOT NULL OR to_regprocedure('private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'Gỡ V681 postflight: còn hàm của V681';
  END IF;
END $post$;
COMMIT;
