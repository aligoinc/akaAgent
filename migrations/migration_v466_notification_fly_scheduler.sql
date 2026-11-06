-- V466 (05/11/2026): trung tâm thông báo chạy theo đồng hồ của máy Fly thay vì pg_cron + pg_net.
-- Thêm công tắc auto_system_settings.notifications.dispatch_mode:
--   'pg_net' (mặc định, như hiện tại): tick 30 giây trong DB lập lịch báo cáo, dọn dữ liệu và gọi worker trên Fly qua pg_net.
--   'fly': aka_agent_notification_dispatch() thoát ngay, DB không lập lịch và không gọi ra ngoài; API WebApp trên Fly tự gọi
--          RPC mới public.aka_agent_notification_tick() mỗi 30 giây (lập lịch báo cáo, dọn hằng giờ, nhận khóa thuê) rồi chạy worker.
-- Apply KHÔNG đổi hành vi cho tới khi đổi công tắc. Rollback tức thời: đặt lại 'pg_net' (một dòng, không DDL).
-- Không thêm bảng/index/cron/pool/kết nối; không đổi worker/snapshot/capture/schedule_reports (độc lập với V465).
-- Kiểm lại số migration trước khi apply (V461, V464 từng bị dùng ở production). DDL: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $v466_preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_notification_dispatch()') IS NULL
     OR to_regprocedure('private.aka_agent_notification_schedule_reports(timestamp with time zone)') IS NULL
     OR to_regprocedure('private.aka_agent_notification_cleanup(timestamp with time zone)') IS NULL
     OR to_regprocedure('private.aka_agent_notification_setting(text,text)') IS NULL
     OR to_regclass('private.aka_agent_notification_dispatch_state') IS NULL THEN
    RAISE EXCEPTION 'v466: V457 notification center missing';
  END IF;
  IF to_regprocedure('public.aka_agent_notification_tick()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'notifications.dispatch_mode') THEN
    RAISE EXCEPTION 'v466: already applied';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_dispatch()'::regprocedure)) IS DISTINCT FROM '6b4f5464803f8b528072e44703ef94de' THEN
    RAISE EXCEPTION 'v466: dispatch checksum mismatch (expected V457 body)';
  END IF;
END
$v466_preflight$;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.dispatch_mode', 'pg_net',
   'Ai hẹn giờ trung tâm thông báo: pg_net = tick 30 giây trong DB lập lịch và gọi worker trên Fly; fly = API trên Fly tự gọi aka_agent_notification_tick() mỗi 30 giây, DB không lập lịch/gọi ra ngoài.',
   false, true);

CREATE OR REPLACE FUNCTION public.aka_agent_notification_dispatch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_state private.aka_agent_notification_dispatch_state%ROWTYPE;
  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean; v_url text; v_token text; v_request bigint;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN jsonb_build_object('enabled', false); END IF;
  -- V466: chế độ 'fly' = máy Fly tự hẹn giờ gọi aka_agent_notification_tick(); DB không lập lịch, không gọi ra ngoài.
  IF lower(btrim(private.aka_agent_notification_setting('notifications.dispatch_mode', 'pg_net'))) = 'fly' THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly');
  END IF;
  v_reports := private.aka_agent_notification_schedule_reports(v_now);
  SELECT * INTO v_state FROM private.aka_agent_notification_dispatch_state WHERE id = 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'skipped', 'state_locked'); END IF;
  IF v_state.last_cleanup_at IS NULL OR v_state.last_cleanup_at < v_now - interval '1 hour' THEN
    v_cleanup := private.aka_agent_notification_cleanup(v_now);
    UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = v_now, updated_at = v_now WHERE id = 1;
  END IF;
  v_has_work := EXISTS (SELECT 1 FROM public.auto_notifications n
                         WHERE (n.content_status = 'pending' AND n.deliver_after <= v_now)
                            OR (n.content_status = 'rendering' AND n.leased_until < v_now))
             OR EXISTS (SELECT 1 FROM public.auto_notification_deliveries d
                         WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= v_now)
                            OR (d.status = 'sending' AND d.leased_until < v_now));
  IF NOT v_has_work THEN
    RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', false, 'cleanup', v_cleanup);
  END IF;
  IF v_state.leased_until IS NOT NULL AND v_state.leased_until > v_now THEN
    RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', true, 'busy', true);
  END IF;
  v_url := public.aka_agent_get_vault_secret('AKA_AGENT_NOTIFICATION_DISPATCH_URL');
  v_token := public.aka_agent_get_vault_secret('AKA_AGENT_NOTIFICATION_DISPATCH_TOKEN');
  IF v_url IS NULL OR btrim(v_url) = '' OR v_token IS NULL OR btrim(v_token) = '' THEN
    RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', true, 'configured', false);
  END IF;
  -- Máy Fly có thể đang dừng (auto stop): chờ tối đa 30 giây để proxy bật lại.
  SELECT net.http_post(url := v_url,
                       body := jsonb_build_object('reason', 'tick', 'at', v_now),
                       params := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-token', v_token),
                       timeout_milliseconds := 30000)
    INTO v_request;
  UPDATE private.aka_agent_notification_dispatch_state
     SET leased_until = v_now + interval '60 seconds', last_called_at = v_now, last_request_id = v_request, updated_at = v_now
   WHERE id = 1;
  RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', true, 'requestId', v_request, 'cleanup', v_cleanup);
END
$$;

CREATE FUNCTION public.aka_agent_notification_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_state private.aka_agent_notification_dispatch_state%ROWTYPE;
  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN jsonb_build_object('enabled', false, 'run', false); END IF;
  -- Chưa chuyển sang Fly: tick 30 giây trong DB vẫn lo lập lịch và gọi worker như cũ.
  IF lower(btrim(private.aka_agent_notification_setting('notifications.dispatch_mode', 'pg_net'))) <> 'fly' THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'pg_net', 'run', false);
  END IF;
  v_reports := private.aka_agent_notification_schedule_reports(v_now);
  SELECT * INTO v_state FROM private.aka_agent_notification_dispatch_state WHERE id = 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'skipped', 'state_locked');
  END IF;
  IF v_state.last_cleanup_at IS NULL OR v_state.last_cleanup_at < v_now - interval '1 hour' THEN
    v_cleanup := private.aka_agent_notification_cleanup(v_now);
    UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = v_now, updated_at = v_now WHERE id = 1;
  END IF;
  v_has_work := EXISTS (SELECT 1 FROM public.auto_notifications n
                         WHERE (n.content_status = 'pending' AND n.deliver_after <= v_now)
                            OR (n.content_status = 'rendering' AND n.leased_until < v_now))
             OR EXISTS (SELECT 1 FROM public.auto_notification_deliveries d
                         WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= v_now)
                            OR (d.status = 'sending' AND d.leased_until < v_now));
  IF NOT v_has_work THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'work', false, 'cleanup', v_cleanup);
  END IF;
  -- Cùng khóa thuê với đường pg_net: một lượt worker tại một thời điểm, kể cả khi có nhiều máy Fly hoặc lúc đổi chế độ.
  -- Worker gọi action 'release' khi xong; máy chết giữa lượt thì khóa tự hết sau 60 giây.
  IF v_state.leased_until IS NOT NULL AND v_state.leased_until > v_now THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'work', true, 'busy', true);
  END IF;
  UPDATE private.aka_agent_notification_dispatch_state
     SET leased_until = v_now + interval '60 seconds', last_called_at = v_now, last_request_id = NULL, updated_at = v_now
   WHERE id = 1;
  RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', true, 'work', true, 'cleanup', v_cleanup);
END
$$;

REVOKE ALL ON FUNCTION public.aka_agent_notification_tick() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_notification_tick() TO service_role;

DO $v466_postcheck$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_notification_dispatch()'::regprocedure)) IS DISTINCT FROM '7c255da3419f913f3cc8c64d5ed89fb8'
     OR md5(pg_get_functiondef('public.aka_agent_notification_tick()'::regprocedure)) IS DISTINCT FROM '18973d977bbdc8519a0e36148d5ada91'
     OR md5(pg_get_functiondef('public.aka_agent_data_group_background_tick()'::regprocedure)) IS DISTINCT FROM '10a2465bf8273b269ed5123344cff4db' THEN
    RAISE EXCEPTION 'v466: function checksum mismatch';
  END IF;
  IF (SELECT value FROM public.auto_system_settings WHERE key = 'notifications.dispatch_mode') IS DISTINCT FROM 'pg_net' THEN
    RAISE EXCEPTION 'v466: dispatch_mode must start as pg_net';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_notification_tick()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aka_agent_notification_tick()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_notification_tick()', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_notification_tick()', 'EXECUTE')
     OR has_function_privilege('aka_agent_chat_api', 'public.aka_agent_notification_tick()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.aka_agent_notification_tick()'::regprocedure AND a.grantee = 0)
     OR has_function_privilege('service_role', 'public.aka_agent_notification_dispatch()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aka_agent_notification_dispatch()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_notification_dispatch()', 'EXECUTE') THEN
    RAISE EXCEPTION 'v466: privilege postcheck failed';
  END IF;
END
$v466_postcheck$;

COMMIT;
