-- PHASE A: additive API only. Does NOT enable RLS or change existing table grants.
-- Candidate, not applied. Install before releasing the new Desktop.
BEGIN;
DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_staff_client(text,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'staff RLS client RPC already exists; capture its live definition before changing it';
  END IF;
  IF to_regclass('private.aka_agent_staff_recovery') IS NOT NULL
    OR to_regprocedure('public.aka_agent_staff_security_status()') IS NOT NULL
    OR to_regprocedure('public.aka_agent_recover_staff_credentials(text,text)') IS NOT NULL
    OR to_regprocedure('private.aka_agent_invalidate_staff_recovery()') IS NOT NULL THEN
    RAISE EXCEPTION 'staff recovery objects already exist; re-audit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_time_allowed(bigint)')
    AND md5(pg_get_functiondef(oid))='a294e60011edd8d42e90ac2f74ce744c'
    AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN
    RAISE EXCEPTION 'staff time guard changed; re-audit before applying';
  END IF;
END;
$preflight$;

CREATE TABLE private.aka_agent_staff_recovery (
  staff_id bigint PRIMARY KEY REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL,
  fingerprint_hash text NOT NULL CHECK (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  credential_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.aka_agent_staff_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.aka_agent_staff_recovery FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.aka_agent_staff_recovery TO service_role;
CREATE INDEX aka_agent_staff_recovery_secret_idx ON private.aka_agent_staff_recovery(secret_hash);

CREATE FUNCTION private.aka_agent_invalidate_staff_recovery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  IF (NEW.organization_id,NEW.username,NEW.password,NEW.aka_agent_device_fingerprint_hash)
    IS DISTINCT FROM (OLD.organization_id,OLD.username,OLD.password,OLD.aka_agent_device_fingerprint_hash) THEN
    DELETE FROM private.aka_agent_staff_recovery WHERE staff_id=OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_invalidate_staff_recovery() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aka_agent_invalidate_staff_recovery AFTER UPDATE OF organization_id,username,password,aka_agent_device_fingerprint_hash ON public.org_staff
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_invalidate_staff_recovery();

CREATE FUNCTION public.aka_agent_staff_client(p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET lock_timeout='3s' SET statement_timeout='12s'
AS $function$
DECLARE
  s public.org_staff%ROWTYPE;
  allowed text[];
  stamp timestamptz := clock_timestamp();
  integration jsonb;
  kind text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read','bind_device','accept_policy','change_password','set_test_workflow','save_integration','register_recovery')
    OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
  allowed := CASE p_action
    WHEN 'bind_device' THEN ARRAY['staffId','fingerprintHash']
    WHEN 'change_password' THEN ARRAY['staffId','newPassword']
    WHEN 'set_test_workflow' THEN ARRAY['staffId','enabled']
    WHEN 'save_integration' THEN ARRAY['staffId','kind','integration']
    WHEN 'register_recovery' THEN ARRAY['staffId','fingerprintHash','secretHash']
    ELSE ARRAY['staffId'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(allowed))
    OR (p_data ? 'staffId' AND (jsonb_typeof(p_data->'staffId') IS DISTINCT FROM 'number' OR p_data->>'staffId' !~ '^[1-9][0-9]*$'))
    OR (p_action<>'read' AND NOT p_data ? 'staffId') THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
  IF coalesce(btrim(p_username),'')='' OR coalesce(p_password,'')='' THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;

  -- Authenticate before taking a lock, then repeat under that lock. Neither an
  -- ID nor a fingerprint is a credential; no caller selects another staff.
  SELECT * INTO s FROM public.org_staff WHERE username=btrim(p_username) AND password=p_password;
  IF NOT FOUND OR (p_data ? 'staffId' AND s.id IS DISTINCT FROM (p_data->>'staffId')::bigint) THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;
  IF p_action='read' THEN
    SELECT * INTO s FROM public.org_staff WHERE id=s.id AND username=btrim(p_username) AND password=p_password FOR SHARE;
  ELSE
    SELECT * INTO s FROM public.org_staff WHERE id=s.id AND username=btrim(p_username) AND password=p_password FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;
  IF NOT s.is_active OR s.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'staff_client_inactive'; END IF;

  IF p_action IN ('bind_device','accept_policy','register_recovery') AND NOT public.aka_agent_staff_time_allowed(s.id) THEN
    RAISE EXCEPTION 'staff_client_expired';
  END IF;
  IF p_action='register_recovery' THEN
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_data->'secretHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' OR p_data->>'secretHash' !~ '^[a-f0-9]{64}$'
      OR s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_data->>'fingerprintHash' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    INSERT INTO private.aka_agent_staff_recovery AS r (staff_id,organization_id,fingerprint_hash,secret_hash,credential_hash)
      VALUES(s.id,s.organization_id,p_data->>'fingerprintHash',p_data->>'secretHash',encode(extensions.digest(s.password,'sha256'),'hex'))
      ON CONFLICT (staff_id) DO UPDATE SET organization_id=excluded.organization_id,fingerprint_hash=excluded.fingerprint_hash,
        secret_hash=excluded.secret_hash,credential_hash=excluded.credential_hash,created_at=clock_timestamp();
  ELSIF p_action='bind_device' THEN
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    IF s.aka_agent_device_fingerprint_hash IS NOT NULL
      AND s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_data->>'fingerprintHash' THEN
      RAISE EXCEPTION 'staff_client_device_locked';
    END IF;
    IF s.aka_agent_device_fingerprint_hash IS NULL THEN
      UPDATE public.org_staff SET aka_agent_device_fingerprint_hash=p_data->>'fingerprintHash' WHERE id=s.id RETURNING * INTO s;
    END IF;
  ELSIF p_action='accept_policy' THEN
    IF NOT s.is_policy_accepted THEN
      UPDATE public.org_staff SET is_policy_accepted=true,policy_accepted_at=stamp,updated_at=stamp WHERE id=s.id RETURNING * INTO s;
    END IF;
  ELSIF p_action='change_password' THEN
    IF jsonb_typeof(p_data->'newPassword') IS DISTINCT FROM 'string'
      OR length(p_data->>'newPassword') NOT BETWEEN 1 AND 1024 THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    UPDATE public.org_staff SET password=p_data->>'newPassword',updated_at=stamp WHERE id=s.id RETURNING * INTO s;
    DELETE FROM private.aka_agent_staff_recovery WHERE staff_id=s.id;
  ELSIF p_action='set_test_workflow' THEN
    IF NOT s.is_admin_akabiz THEN RAISE EXCEPTION 'staff_client_forbidden'; END IF;
    IF jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    UPDATE public.org_staff SET use_test_workflow=(p_data->>'enabled')::boolean,updated_at=stamp WHERE id=s.id RETURNING * INTO s;
  ELSIF p_action='save_integration' THEN
    kind:=p_data->>'kind'; integration:=p_data->'integration';
    IF kind IS NULL OR kind NOT IN ('sms','zaloWeb','akaBizDesktop') OR jsonb_typeof(integration) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'staff_client_invalid_input';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(integration) k WHERE NOT k=ANY(ARRAY['id','staffId','username','name','installPath','dbPath']))
      OR jsonb_typeof(integration->'staffId') IS DISTINCT FROM 'number' OR integration->>'staffId' !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(integration->'username') IS DISTINCT FROM 'string' OR length(btrim(integration->>'username')) NOT BETWEEN 1 AND 255
      OR EXISTS (SELECT 1 FROM jsonb_each(integration) e WHERE e.key IN ('name','installPath','dbPath') AND
        (jsonb_typeof(e.value) NOT IN ('null','string') OR length(e.value#>>'{}')>4096)) THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    integration:=jsonb_build_object('id',(integration->>'staffId')::bigint,'staffId',(integration->>'staffId')::bigint,
      'username',btrim(integration->>'username'),'name',integration->'name','installPath',integration->'installPath','dbPath',integration->'dbPath','integratedAt',stamp);
    UPDATE public.org_staff SET akabiz_integrations=jsonb_set(coalesce(akabiz_integrations,'{}'),ARRAY[kind],integration,true),updated_at=stamp
      WHERE id=s.id RETURNING * INTO s;
  END IF;

  -- Explicit projection: never return password, CRM permissions, tokens, or
  -- future columns added to org_staff. Mutations never accept tenant/admin data.
  RETURN jsonb_build_object('id',s.id,'organization_id',s.organization_id,'name',s.name,'phone',s.phone,'username',s.username,
    'is_active',s.is_active,'is_admin',s.is_admin,'is_admin_akabiz',s.is_admin_akabiz,'use_test_workflow',s.use_test_workflow,
    'is_policy_accepted',s.is_policy_accepted,'policy_accepted_at',s.policy_accepted_at,
    'aka_agent_device_fingerprint_hash',s.aka_agent_device_fingerprint_hash,
    'device_label',s.device_label,'device_platform',s.device_platform,'device_bound_at',s.device_bound_at,'device_last_seen_at',s.device_last_seen_at,
    'app_notification',s.app_notification,'akabiz_integrations',s.akabiz_integrations,'updated_at',s.updated_at);
END;
$function$;
ALTER FUNCTION public.aka_agent_staff_client(text,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_staff_client(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_client(text,text,text,jsonb) TO anon,authenticated,service_role;

CREATE FUNCTION public.aka_agent_staff_security_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT jsonb_build_object('legacyRecoveryAllowed',NOT relrowsecurity)
  FROM pg_class WHERE oid='public.org_staff'::regclass;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_staff_security_status() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_security_status() TO anon,authenticated,service_role;

CREATE FUNCTION public.aka_agent_recover_staff_credentials(p_secret text,p_fingerprint_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' SET statement_timeout='8s' AS $function$
DECLARE s public.org_staff%ROWTYPE; r private.aka_agent_staff_recovery%ROWTYPE;
BEGIN
  IF coalesce(p_secret,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_fingerprint_hash,'') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'staff_recovery_invalid';
  END IF;
  SELECT * INTO r FROM private.aka_agent_staff_recovery
    WHERE secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex') AND fingerprint_hash=p_fingerprint_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_recovery_invalid'; END IF;
  IF (SELECT count(*) FROM private.aka_agent_staff_recovery WHERE secret_hash=r.secret_hash AND fingerprint_hash=p_fingerprint_hash)<>1 THEN
    RAISE EXCEPTION 'staff_recovery_invalid';
  END IF;
  SELECT * INTO s FROM public.org_staff WHERE id=r.staff_id FOR SHARE;
  -- Recheck the token after locking staff, following the same staff -> recovery
  -- order as registration/password changes. A removed/rebound token cannot win.
  IF NOT FOUND OR NOT s.is_active OR s.deleted_at IS NOT NULL OR s.organization_id<>r.organization_id
    OR s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_fingerprint_hash
    OR NOT public.aka_agent_staff_time_allowed(s.id)
    OR encode(extensions.digest(s.password,'sha256'),'hex') IS DISTINCT FROM r.credential_hash
    OR NOT EXISTS (SELECT 1 FROM private.aka_agent_staff_recovery x WHERE x.staff_id=r.staff_id AND x.secret_hash=r.secret_hash)
    OR (SELECT count(*) FROM public.org_staff WHERE aka_agent_device_fingerprint_hash=p_fingerprint_hash)<>1 THEN
    RAISE EXCEPTION 'staff_recovery_invalid';
  END IF;
  RETURN jsonb_build_object('username',s.username,'password',s.password);
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_recover_staff_credentials(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_recover_staff_credentials(text,text) TO anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
