-- V511 phần 3/3: RPC cho bộ kiểm tra proxy trong API Web (aka_agent_proxy_check_worker), quyền và kiểm tra cuối.
-- Cần phần 1 và 2. Hợp đồng, rollout, gỡ: docs/WEB_PROXY_MANAGEMENT_V511.md.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'V511 phải chạy bằng postgres';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p3') THEN
    RAISE EXCEPTION 'V511 phần 3 đã có trong sổ migration, không chạy lại';
  END IF;
  IF to_regprocedure('public.aka_agent_control_proxies(bigint,bigint,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'V511 phần 3: chưa apply phần 2';
  END IF;
  IF to_regprocedure('public.aka_agent_proxy_check_worker(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'V511 phần 3: đối tượng đích đã tồn tại, kiểm tra trước, không ghi đè';
  END IF;
END;
$preflight$;

-- 11. RPC cho bộ kiểm tra trong API (service_role).
-- claim: nhận tối đa `limit` proxy tới hạn của tổ chức đã bật cờ, kèm mật khẩu để kết nối, giữ bằng lease.
-- report: ghi kết quả. Lần hỏng đầu của lượt hằng ngày chỉ hẹn thử lại sau 2 phút; hỏng lần hai (hoặc khách bấm
-- Kiểm tra) mới ghi 'failed'. Proxy bị sửa trong lúc kiểm tra (hash khác) thì bỏ kết quả và kiểm tra lại ngay.
CREATE FUNCTION public.aka_agent_proxy_check_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_mode text := private.aka_agent_proxy_check_mode();
  v_limit integer;
  v_lease integer;
  v_items jsonb;
  v_result jsonb;
  v_id bigint;
  v_proxy public.auto_proxies%ROWTYPE;
  v_check public.auto_proxy_checks%ROWTYPE;
  v_hash text;
  v_outcome text;
  v_manual boolean;
  v_error text;
  v_latency integer;
  v_exit_ip text;
  v_retry integer;
  v_failures integer;
  v_applied integer := 0;
  v_stale integer := 0;
BEGIN
  IF jsonb_typeof(v_payload) <> 'object' THEN RAISE EXCEPTION 'proxy_invalid_payload'; END IF;

  IF p_action = 'claim' THEN
    IF v_mode = 'off' THEN
      RETURN jsonb_build_object('mode', v_mode, 'items', '[]'::jsonb);
    END IF;
    v_limit := least(greatest(COALESCE(CASE WHEN (v_payload ->> 'limit') ~ '^\d{1,4}$' THEN (v_payload ->> 'limit')::integer END, 20), 1), 50);
    v_lease := least(greatest(COALESCE(CASE WHEN (v_payload ->> 'leaseSeconds') ~ '^\d{1,5}$' THEN (v_payload ->> 'leaseSeconds')::integer END, 180), 30), 600);
    -- Một lượt nhận tại một thời điểm, nên nhiều máy API không nhận trùng proxy.
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-proxy-check-claim', 0));
    WITH due AS (
      SELECT proxy.id, proxy.protocol, proxy.host, proxy.port, proxy.username, proxy.password,
        private.aka_agent_proxy_endpoint_hash(proxy.protocol, proxy.host, proxy.port, proxy.username, proxy.password) AS hash,
        checks.next_check_at
      FROM public.auto_proxies AS proxy
      JOIN public.org_organization AS organization
        ON organization.id = proxy.organization_id AND organization.web_proxy_management_enabled
      LEFT JOIN public.auto_proxy_checks AS checks ON checks.proxy_id = proxy.id
      WHERE NOT proxy.is_delete AND proxy.is_active
        -- Sửa proxy trên Web đặt next_check_at = now(); sửa trên Desktop thì danh sách hiện "Chưa kiểm tra" tới lượt kế tiếp.
        AND (checks.proxy_id IS NULL OR (
          checks.next_check_at <= now() AND (checks.lease_until IS NULL OR checks.lease_until < now())))
      ORDER BY checks.next_check_at NULLS FIRST, proxy.id
      LIMIT v_limit
    ), leased AS (
      INSERT INTO public.auto_proxy_checks AS checks (proxy_id, status, next_check_at, lease_token, lease_until, updated_at)
      SELECT due.id, 'pending', now(), gen_random_uuid(), now() + make_interval(secs => v_lease), now() FROM due
      ON CONFLICT (proxy_id) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until, updated_at = now()
      RETURNING checks.proxy_id, checks.lease_token
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('proxyId', due.id, 'leaseToken', leased.lease_token, 'endpointHash', due.hash,
        'protocol', due.protocol, 'host', due.host, 'port', due.port,
        'username', NULLIF(due.username, ''), 'password', NULLIF(due.password, ''))
      ORDER BY due.next_check_at NULLS FIRST, due.id), '[]'::jsonb)
      INTO v_items
    FROM due JOIN leased ON leased.proxy_id = due.id;
    RETURN jsonb_build_object('mode', v_mode, 'items', v_items);

  ELSIF p_action = 'report' THEN
    IF jsonb_typeof(v_payload -> 'results') IS DISTINCT FROM 'array' OR jsonb_array_length(v_payload -> 'results') > 200 THEN
      RAISE EXCEPTION 'proxy_invalid_payload';
    END IF;
    FOR v_result IN SELECT element FROM jsonb_array_elements(v_payload -> 'results') AS element LOOP
      IF jsonb_typeof(v_result) <> 'object' OR jsonb_typeof(v_result -> 'proxyId') <> 'number'
         OR (v_result ->> 'proxyId') !~ '^[1-9]\d{0,17}$'
         OR (v_result ->> 'outcome') NOT IN ('ok', 'failed', 'local', 'retry') THEN
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;
      v_id := (v_result ->> 'proxyId')::bigint;
      v_outcome := v_result ->> 'outcome';
      v_manual := jsonb_typeof(v_result -> 'manual') = 'boolean' AND (v_result ->> 'manual')::boolean;
      v_error := v_result ->> 'errorCode';
      IF v_error IS NOT NULL AND v_error NOT IN ('auth_failed', 'timeout', 'refused', 'dns_not_found', 'proxy_error',
          'tls_error', 'unreachable', 'local_address', 'ip_allowlist') THEN
        v_error := CASE WHEN v_outcome = 'local' THEN 'local_address' ELSE 'proxy_error' END;
      END IF;
      v_latency := CASE WHEN (v_result ->> 'latencyMs') ~ '^\d{1,6}$' THEN least((v_result ->> 'latencyMs')::integer, 600000) END;
      v_exit_ip := CASE WHEN char_length(COALESCE(v_result ->> 'exitIp', '')) BETWEEN 1 AND 64 THEN v_result ->> 'exitIp' END;
      v_retry := least(greatest(COALESCE(CASE WHEN (v_result ->> 'retryAfterSeconds') ~ '^\d{1,6}$'
        THEN (v_result ->> 'retryAfterSeconds')::integer END, 900), 60), 86400);

      SELECT * INTO v_proxy FROM public.auto_proxies AS proxy WHERE proxy.id = v_id AND NOT proxy.is_delete;
      IF NOT FOUND THEN
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.auto_proxy_checks (proxy_id, status, next_check_at, updated_at)
      VALUES (v_id, 'pending', now(), now()) ON CONFLICT (proxy_id) DO NOTHING;
      SELECT * INTO v_check FROM public.auto_proxy_checks AS checks WHERE checks.proxy_id = v_id FOR UPDATE;
      IF NOT v_manual AND v_check.lease_token IS DISTINCT FROM
         (CASE WHEN (v_result ->> 'leaseToken') ~ '^[0-9a-fA-F-]{36}$' THEN (v_result ->> 'leaseToken')::uuid END) THEN
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;
      v_hash := private.aka_agent_proxy_endpoint_hash(v_proxy.protocol, v_proxy.host, v_proxy.port, v_proxy.username, v_proxy.password);
      IF v_hash IS DISTINCT FROM v_result ->> 'endpointHash' THEN
        UPDATE public.auto_proxy_checks SET lease_token = NULL, lease_until = NULL, next_check_at = now(), updated_at = now()
        WHERE proxy_id = v_id;
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;

      IF v_outcome = 'ok' THEN
        UPDATE public.auto_proxy_checks SET status = 'ok', checked_at = now(), last_ok_at = now(), failing_since = NULL,
          latency_ms = v_latency, exit_ip = v_exit_ip, error_code = NULL, consecutive_failures = 0,
          next_check_at = private.aka_agent_proxy_next_daily(v_id, now()), endpoint_hash = v_hash,
          lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      ELSIF v_outcome = 'local' THEN
        UPDATE public.auto_proxy_checks SET status = 'local', checked_at = now(), failing_since = NULL,
          latency_ms = NULL, exit_ip = NULL, error_code = COALESCE(v_error, 'local_address'), consecutive_failures = 0,
          next_check_at = private.aka_agent_proxy_next_daily(v_id, now()), endpoint_hash = v_hash,
          lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      ELSIF v_outcome = 'failed' THEN
        v_failures := CASE WHEN v_check.endpoint_hash IS NOT DISTINCT FROM v_hash THEN v_check.consecutive_failures ELSE 0 END + 1;
        UPDATE public.auto_proxy_checks SET
          status = CASE WHEN v_manual OR v_failures >= 2 THEN 'failed'
                        WHEN v_check.endpoint_hash IS NOT DISTINCT FROM v_hash THEN status ELSE 'pending' END,
          checked_at = now(),
          failing_since = CASE WHEN v_check.endpoint_hash IS NOT DISTINCT FROM v_hash THEN COALESCE(failing_since, now()) ELSE now() END,
          latency_ms = NULL, exit_ip = NULL, error_code = COALESCE(v_error, 'proxy_error'), consecutive_failures = v_failures,
          next_check_at = CASE WHEN v_manual OR v_failures >= 2 THEN private.aka_agent_proxy_next_daily(v_id, now())
                               ELSE now() + interval '2 minutes' END,
          endpoint_hash = v_hash, lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      ELSE
        UPDATE public.auto_proxy_checks SET next_check_at = now() + make_interval(secs => v_retry),
          lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      END IF;
      v_applied := v_applied + 1;
    END LOOP;
    RETURN jsonb_build_object('applied', v_applied, 'stale', v_stale);
  END IF;

  RAISE EXCEPTION 'proxy_invalid_action';
END;
$function$;

-- 12. Quyền: RPC bộ kiểm tra chỉ service_role.
REVOKE ALL ON FUNCTION public.aka_agent_proxy_check_worker(text, jsonb) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_proxy_check_worker(text, jsonb) TO service_role;

-- 13. Postflight.
DO $postflight$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_organization'
                 AND column_name = 'web_proxy_management_enabled' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION 'V511 postflight: thiếu cột cờ tổ chức';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_organization WHERE web_proxy_management_enabled) THEN
    RAISE EXCEPTION 'V511 postflight: migration không được tự bật cờ cho tổ chức nào';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auto_proxies') <> 5 THEN
    RAISE EXCEPTION 'V511 postflight: số policy của auto_proxies sai';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    FOREACH v_fn IN ARRAY ARRAY['public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'public.aka_agent_proxy_check_worker(text,jsonb)'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'V511 postflight: % còn EXECUTE %', v_role, v_fn;
      END IF;
    END LOOP;
    IF has_table_privilege(v_role, 'public.auto_proxy_checks', 'SELECT') THEN
      RAISE EXCEPTION 'V511 postflight: % đọc được auto_proxy_checks', v_role;
    END IF;
    IF has_function_privilege(v_role, 'private.aka_agent_proxy_list_json(bigint,bigint,boolean,bigint[])', 'EXECUTE') THEN
      RAISE EXCEPTION 'V511 postflight: % còn EXECUTE hàm private', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_proxy_check_worker(text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V511 postflight: service_role thiếu EXECUTE';
  END IF;
  IF private.aka_agent_proxy_check_mode() <> 'off'
     OR private.aka_agent_proxy_shared_runtime_ready(0, true) OR private.aka_agent_proxy_shared_runtime_ready(0, false) THEN
    RAISE EXCEPTION 'V511 postflight: cài đặt mặc định sai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_accounts'::regclass
                 AND tgname = 'trg_account_proxy_scope_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'V511 postflight: thiếu trigger trên auto_accounts';
  END IF;
END;
$postflight$;

COMMIT;
