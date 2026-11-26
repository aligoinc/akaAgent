CREATE OR REPLACE FUNCTION private.aka_agent_proxy_shared_runtime_ready(p_staff_id bigint, p_server boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text;
  v_config jsonb;
  v_min text;
  v_min_parts integer[];
BEGIN
  SELECT setting.value INTO v_raw FROM public.auto_system_settings AS setting
  WHERE setting.key = 'proxies.shared_runtime' AND setting.is_active
  LIMIT 1;
  BEGIN
    v_config := NULLIF(btrim(COALESCE(v_raw, '')), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_config IS NULL OR jsonb_typeof(v_config) <> 'object' THEN
    RETURN false;
  END IF;
  IF p_server THEN
    RETURN jsonb_typeof(v_config -> 'server') = 'boolean' AND (v_config ->> 'server')::boolean;
  END IF;
  v_min := v_config ->> 'desktopMinVersion';
  IF jsonb_typeof(v_config -> 'desktopMinVersion') IS DISTINCT FROM 'string'
     OR v_min !~ '^\d{1,6}(\.\d{1,6}){0,3}$' THEN
    RETURN false;
  END IF;
  v_min_parts := string_to_array(v_min, '.')::integer[];
  RETURN EXISTS (
      SELECT 1 FROM public.auto_staff_device_presence AS device
      WHERE device.staff_id = p_staff_id AND device.last_seen_at > now() - interval '30 days')
    AND NOT EXISTS (
      SELECT 1 FROM public.auto_staff_device_presence AS device
      WHERE device.staff_id = p_staff_id AND device.last_seen_at > now() - interval '30 days'
        AND (device.app_version IS NULL OR device.app_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$'
             OR string_to_array(device.app_version, '.')::integer[] < v_min_parts));
END;
$function$
