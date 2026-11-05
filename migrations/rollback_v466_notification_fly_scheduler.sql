-- Rollback V466: trả aka_agent_notification_dispatch() về đúng bản V457, xóa RPC tick và công tắc dispatch_mode.
-- Sau rollback tick 30 giây trong DB lại lập lịch và gọi worker trên Fly qua pg_net (Vault URL/token giữ nguyên).
-- Nếu đang ở chế độ 'fly', đặt NOTIFICATION_SCHEDULER_ENABLED=false trên Fly hoặc chạy lại image cũ để máy Fly thôi gọi RPC đã xóa.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $v466_rollback_preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_notification_tick()') IS NULL THEN
    RAISE EXCEPTION 'v466 rollback: V466 not applied';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_dispatch()'::regprocedure)) IS DISTINCT FROM '7c255da3419f913f3cc8c64d5ed89fb8' THEN
    RAISE EXCEPTION 'v466 rollback: dispatch changed after V466';
  END IF;
END
$v466_rollback_preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_notification_dispatch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_state private.aka_agent_notification_dispatch_state%ROWTYPE;
  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean; v_url text; v_token text; v_request bigint;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN jsonb_build_object('enabled', false); END IF;
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

DROP FUNCTION public.aka_agent_notification_tick();
DELETE FROM public.auto_system_settings WHERE key = 'notifications.dispatch_mode';

DO $v466_rollback_postcheck$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_notification_dispatch()'::regprocedure)) IS DISTINCT FROM '6b4f5464803f8b528072e44703ef94de'
     OR to_regprocedure('public.aka_agent_notification_tick()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'notifications.dispatch_mode') THEN
    RAISE EXCEPTION 'v466 rollback: postcheck failed';
  END IF;
END
$v466_rollback_postcheck$;

COMMIT;
