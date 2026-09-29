-- Web/PWA entry admission only. Existing session authentication and native clients
-- remain unchanged. Live dependencies audited in snapshots/v331_web_device_auth_audit.json.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'aka_agent_control_web_device%')
    OR to_regclass('public.auto_control_web_device_policy') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='auto_control_sessions' AND column_name LIKE 'web_device_%') THEN
    RAISE EXCEPTION 'v331 preflight: web device objects already exist; inspect before applying';
  END IF;
  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NULL
    OR to_regprocedure('public.aka_agent_authenticate_control_session(text)') IS NULL THEN
    RAISE EXCEPTION 'v331 requires the existing control authentication and staff expiry RPCs';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.aka_agent_control_web_device_limit(p_value text, p_active boolean, p_secret boolean)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_active IS TRUE AND p_secret IS FALSE AND btrim(p_value) ~ '^[0-9]{1,10}$'
    AND btrim(p_value)::numeric BETWEEN 1 AND 2147483647 THEN
    RETURN btrim(p_value)::integer;
  END IF;
  RETURN 3;
END;
$$;

CREATE TABLE public.auto_control_web_device_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  max_devices integer NOT NULL CHECK (max_devices > 0),
  revision uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE public.auto_control_web_device_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_control_web_device_policy FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.auto_control_web_device_policy TO service_role;

INSERT INTO public.auto_system_settings(key,value,description,is_secret,is_active)
VALUES ('web.auth.max_devices_per_staff','3',
  'Số thiết bị Web/PWA tối đa mỗi nhân viên. Số nguyên dương; thiếu/sai/tắt dùng 3. Đổi hạn mức mở lượt nhận chỗ mới khi mở/tải lại WebApp. Native và Desktop không tính.',false,true)
ON CONFLICT(key) DO NOTHING;

INSERT INTO public.auto_control_web_device_policy(singleton,max_devices)
SELECT true,public.aka_agent_control_web_device_limit(value,is_active,is_secret)
FROM public.auto_system_settings WHERE key='web.auth.max_devices_per_staff';

CREATE FUNCTION public.aka_agent_control_web_device_policy_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_limit integer;
BEGIN
  IF (TG_OP<>'INSERT' AND OLD.key='web.auth.max_devices_per_staff')
    OR (TG_OP<>'DELETE' AND NEW.key='web.auth.max_devices_per_staff') THEN
    SELECT public.aka_agent_control_web_device_limit(value,is_active,is_secret) INTO v_limit
    FROM public.auto_system_settings WHERE key='web.auth.max_devices_per_staff';
    UPDATE public.auto_control_web_device_policy SET max_devices=coalesce(v_limit,3),revision=gen_random_uuid()
    WHERE singleton AND max_devices IS DISTINCT FROM coalesce(v_limit,3);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER auto_control_web_device_policy_changed
AFTER INSERT OR UPDATE OR DELETE ON public.auto_system_settings
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_control_web_device_policy_changed();

ALTER TABLE public.auto_control_sessions
  ADD COLUMN web_device_id uuid,
  ADD COLUMN web_device_revision uuid,
  ADD COLUMN web_device_registered_at timestamptz;
CREATE INDEX idx_auto_control_sessions_web_device
ON public.auto_control_sessions(staff_id,organization_id,web_device_revision,web_device_id)
WHERE revoked_at IS NULL AND client_type IN ('web','pwa');
COMMENT ON COLUMN public.auto_control_sessions.web_device_id IS
  'Backend-only opaque browser cookie identity, never an authentication credential or public session field.';

CREATE FUNCTION public.aka_agent_control_web_device_claim(
  p_staff_id bigint,p_organization_id bigint,p_session_id uuid,p_device_id uuid,
  p_token_hash text,p_client_type text,p_user_agent text,p_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
SET lock_timeout='3s' SET statement_timeout='8s' AS $$
DECLARE
  v_policy public.auto_control_web_device_policy%ROWTYPE;
  v_session public.auto_control_sessions%ROWTYPE;
  v_device uuid;
  v_used integer;
  v_existing boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- Shared policy lock permits unrelated staff to enter concurrently and serializes
  -- an effective setting change with admission. Staff lock covers count + write.
  SELECT * INTO STRICT v_policy FROM public.auto_control_web_device_policy WHERE singleton FOR SHARE;
  PERFORM 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id
    AND is_active IS TRUE AND is_policy_accepted IS TRUE FOR UPDATE;
  IF NOT FOUND OR NOT public.aka_agent_staff_time_allowed(p_staff_id) THEN
    RETURN jsonb_build_object('status','invalid_staff');
  END IF;
  v_now := clock_timestamp();
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.auto_control_sessions
    WHERE id=p_session_id AND staff_id=p_staff_id AND organization_id=p_organization_id
      AND revoked_at IS NULL AND expires_at>v_now AND client_type IN ('web','pwa') FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid_session'); END IF;
  ELSIF p_client_type IS NULL OR p_client_type NOT IN ('web','pwa')
    OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at IS NULL OR p_expires_at<=v_now THEN
    RAISE EXCEPTION 'invalid web session input';
  END IF;
  -- A second tab with no device cookie recovers the same committed identity.
  v_device := coalesce(v_session.web_device_id,p_device_id,gen_random_uuid());
  SELECT count(DISTINCT web_device_id),coalesce(bool_or(web_device_id=v_device),false)
    INTO v_used,v_existing FROM public.auto_control_sessions
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id
    AND client_type IN ('web','pwa') AND revoked_at IS NULL AND expires_at>v_now
    AND web_device_revision=v_policy.revision;
  IF NOT v_existing AND v_used>=v_policy.max_devices THEN
    -- Commit the rejected restoration's revocation before the API returns 409.
    -- Existing pages on other devices remain valid until their own next entry.
    IF p_session_id IS NOT NULL THEN
      UPDATE public.auto_control_sessions SET revoked_at=v_now
      WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND client_type IN ('web','pwa')
        AND revoked_at IS NULL AND (id=p_session_id OR web_device_id=v_device);
    END IF;
    RETURN jsonb_build_object('status','limit_reached','limit',v_policy.max_devices,'used',v_used);
  END IF;
  IF p_session_id IS NULL THEN
    UPDATE public.auto_control_sessions SET revoked_at=v_now
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND web_device_id=v_device
      AND client_type IN ('web','pwa') AND revoked_at IS NULL;
    INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,client_type,user_agent,
      expires_at,web_device_id,web_device_revision,web_device_registered_at)
    VALUES(p_staff_id,p_organization_id,p_token_hash,p_client_type,left(p_user_agent,1000),
      p_expires_at,v_device,v_policy.revision,v_now) RETURNING * INTO v_session;
  ELSE
    UPDATE public.auto_control_sessions SET web_device_id=v_device,web_device_revision=v_policy.revision,
      web_device_registered_at=CASE WHEN web_device_revision=v_policy.revision THEN web_device_registered_at ELSE v_now END
    WHERE id=p_session_id RETURNING * INTO v_session;
  END IF;
  RETURN jsonb_build_object('status','admitted','deviceId',v_device,
    'quota',jsonb_build_object('limit',v_policy.max_devices,'used',v_used+CASE WHEN v_existing THEN 0 ELSE 1 END),
    'session',to_jsonb(v_session)-'token_hash'-'web_device_id'-'web_device_revision'-'web_device_registered_at');
END;
$$;

CREATE FUNCTION public.aka_agent_control_web_device_overview(p_staff_id bigint,p_organization_id bigint,p_session_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET statement_timeout='8s' AS $$
  WITH policy AS (SELECT * FROM public.auto_control_web_device_policy WHERE singleton),
  active AS (
    SELECT s.*,CASE WHEN s.client_type IN ('web','pwa') AND s.web_device_id IS NOT NULL
      THEN 'device:'||s.web_device_id::text ELSE 'session:'||s.id::text END AS device_group
    FROM public.auto_control_sessions s
    WHERE s.staff_id=p_staff_id AND s.organization_id=p_organization_id
      AND s.revoked_at IS NULL AND s.expires_at>now()
  ), grouped AS (
    SELECT DISTINCT ON (device_group) *,bool_or(id=p_session_id) OVER (PARTITION BY device_group) AS current_device,
      bool_or(web_device_revision=(SELECT revision FROM policy)) OVER (PARTITION BY device_group) AS counted,
      count(*) OVER (PARTITION BY device_group) AS session_count
    FROM active ORDER BY device_group,(id=p_session_id) DESC,last_seen_at DESC,id
  )
  SELECT jsonb_build_object('quota',jsonb_build_object('limit',(SELECT max_devices FROM policy),
    'used',(SELECT count(DISTINCT web_device_id) FROM active
      WHERE client_type IN ('web','pwa') AND web_device_revision=(SELECT revision FROM policy))),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'clientType',client_type,'userAgent',coalesce(user_agent,'Thiết bị không xác định'),
      'createdAt',created_at,'lastSeenAt',last_seen_at,'expiresAt',expires_at,'current',current_device,
      'sessionCount',session_count,'registrationState',CASE WHEN client_type='native' THEN 'not_applicable'
        WHEN counted THEN 'registered' ELSE 'pending' END) ORDER BY current_device DESC,last_seen_at DESC,id)
      FROM grouped),'[]'::jsonb));
$$;

CREATE FUNCTION public.aka_agent_control_web_device_revoke(p_staff_id bigint,p_organization_id bigint,p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
SET lock_timeout='3s' SET statement_timeout='8s' AS $$
DECLARE v_session public.auto_control_sessions%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_session FROM public.auto_control_sessions WHERE id=p_session_id
    AND staff_id=p_staff_id AND organization_id=p_organization_id AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.auto_control_sessions SET revoked_at=clock_timestamp()
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND revoked_at IS NULL
    AND (id=p_session_id OR (v_session.client_type IN ('web','pwa') AND client_type IN ('web','pwa')
      AND web_device_id=v_session.web_device_id));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_control_web_device_limit(text,boolean,boolean),
  public.aka_agent_control_web_device_policy_changed(),
  public.aka_agent_control_web_device_claim(bigint,bigint,uuid,uuid,text,text,text,timestamptz),
  public.aka_agent_control_web_device_overview(bigint,bigint,uuid),
  public.aka_agent_control_web_device_revoke(bigint,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_web_device_limit(text,boolean,boolean),
  public.aka_agent_control_web_device_policy_changed(),
  public.aka_agent_control_web_device_claim(bigint,bigint,uuid,uuid,text,text,text,timestamptz),
  public.aka_agent_control_web_device_overview(bigint,bigint,uuid),
  public.aka_agent_control_web_device_revoke(bigint,bigint,uuid) TO service_role;
-- New RPC signatures and columns require a PostgREST metadata refresh.
NOTIFY pgrst,'reload schema';
COMMIT;
