-- Candidate only: deploy before the v3 client, do not apply RLS phase C here.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)') AND md5(pg_get_functiondef(oid))='b504f4928a9dd271dec783796a7a0374' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'device v3 source drift: %','public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_prepare_device_change_v2(text)') AND md5(pg_get_functiondef(oid))='28589c77ed8e440a0d8b6b4304e0311f' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'device v3 source drift: %','public.aka_agent_prepare_device_change_v2(text)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_recover_staff_credentials(text,text)') AND md5(pg_get_functiondef(oid))='6f831ff1691807ebb32e5052f6df3f05' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s','statement_timeout=8s']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'device v3 source drift: %','public.aka_agent_recover_staff_credentials(text,text)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)') AND md5(pg_get_functiondef(oid))='dfc6d177499fbf9fc51526d7b9fba6f4' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'device v3 source drift: %','public.aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_client(text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='16a1f5c7f327d3de9b7bd809ba94d31c' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s','statement_timeout=12s']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'device v3 source drift: %','public.aka_agent_staff_client(text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') AND md5(pg_get_functiondef(oid))='a294e60011edd8d42e90ac2f74ce744c' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='s' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,=X/postgres}') THEN RAISE EXCEPTION 'device v3 source drift: %','public.aka_agent_staff_time_allowed(bigint)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_invalidate_staff_recovery()') AND md5(pg_get_functiondef(oid))='b075b0d5d4091f51d7bba2c4fb699939' AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}') THEN RAISE EXCEPTION 'device v3 source drift: %','private.aka_agent_invalidate_staff_recovery()'; END IF;
 IF to_regclass('private.aka_agent_device_collisions') IS NOT NULL OR to_regclass('private.aka_agent_device_migrations') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.org_staff'::regclass AND attname IN ('aka_agent_device_identity_version','aka_agent_device_binding_revision') AND NOT attisdropped) THEN RAISE EXCEPTION 'device v3 already installed; audit before reapply'; END IF;
END; $preflight$;
ALTER TABLE public.org_staff ADD COLUMN aka_agent_device_identity_version smallint NOT NULL DEFAULT 2 CHECK (aka_agent_device_identity_version IN (2,3));
ALTER TABLE public.org_staff ADD COLUMN aka_agent_device_binding_revision bigint NOT NULL DEFAULT 0;
CREATE INDEX org_staff_aka_agent_device_identity_idx ON public.org_staff(aka_agent_device_identity_version,aka_agent_device_fingerprint_hash) WHERE aka_agent_device_fingerprint_hash IS NOT NULL;
CREATE TABLE private.aka_agent_device_collisions (
 version smallint NOT NULL CHECK(version IN (2,3)), fingerprint_hash text NOT NULL CHECK(fingerprint_hash ~ '^[a-f0-9]{64}$'),
 detected_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(version,fingerprint_hash)
);
CREATE TABLE private.aka_agent_device_migrations (
 request_id uuid PRIMARY KEY, staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
 organization_id bigint NOT NULL, source text NOT NULL CHECK(source IN ('manual','automatic','remembered','recovery')),
 old_hash text, old_version smallint NOT NULL, old_revision bigint NOT NULL,
 new_hash text NOT NULL CHECK(new_hash ~ '^[a-f0-9]{64}$'), new_revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.aka_agent_device_collisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.aka_agent_device_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.aka_agent_device_collisions,private.aka_agent_device_migrations FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.aka_agent_device_collisions,private.aka_agent_device_migrations TO service_role;
CREATE INDEX aka_agent_device_migrations_staff_idx ON private.aka_agent_device_migrations(staff_id);
-- Snapshot every binding before any customer migrates, including inactive/deleted staff.
INSERT INTO private.aka_agent_device_collisions(version,fingerprint_hash)
 SELECT 2,aka_agent_device_fingerprint_hash FROM public.org_staff WHERE aka_agent_device_fingerprint_hash IS NOT NULL
 GROUP BY aka_agent_device_fingerprint_hash HAVING count(*)>1;

CREATE FUNCTION private.aka_agent_track_device_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
 IF OLD.aka_agent_device_identity_version=3 AND NEW.aka_agent_device_identity_version<>3 THEN RAISE EXCEPTION 'staff_client_device_locked'; END IF;
 IF (NEW.aka_agent_device_fingerprint_hash,NEW.aka_agent_device_identity_version) IS DISTINCT FROM (OLD.aka_agent_device_fingerprint_hash,OLD.aka_agent_device_identity_version) THEN
  NEW.aka_agent_device_binding_revision:=OLD.aka_agent_device_binding_revision+1;
 ELSE NEW.aka_agent_device_binding_revision:=OLD.aka_agent_device_binding_revision;
 END IF;
 RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION private.aka_agent_track_device_binding() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aka_agent_track_device_binding BEFORE UPDATE ON public.org_staff FOR EACH ROW EXECUTE FUNCTION private.aka_agent_track_device_binding();

-- Caller must hold hash advisory locks before the staff row lock.
CREATE FUNCTION private.aka_agent_device_ambiguous(p_version smallint,p_hash text,p_staff_id bigint,p_prospective boolean)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
 IF p_hash IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM private.aka_agent_device_collisions WHERE version=p_version AND fingerprint_hash=p_hash) THEN RETURN true; END IF;
 IF (p_prospective AND EXISTS(SELECT 1 FROM public.org_staff WHERE aka_agent_device_identity_version=p_version AND aka_agent_device_fingerprint_hash=p_hash AND id<>p_staff_id))
 OR (NOT p_prospective AND (SELECT count(*) FROM (SELECT 1 FROM public.org_staff WHERE aka_agent_device_identity_version=p_version AND aka_agent_device_fingerprint_hash=p_hash LIMIT 2) x)>1) THEN
  INSERT INTO private.aka_agent_device_collisions(version,fingerprint_hash) VALUES(p_version,p_hash) ON CONFLICT DO NOTHING;
  RETURN true;
 END IF;
 RETURN false;
END; $function$;
REVOKE ALL ON FUNCTION private.aka_agent_device_ambiguous(smallint,text,bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.aka_agent_device_v3(p_staff_id bigint,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
DECLARE
 s public.org_staff%ROWTYPE; receipt private.aka_agent_device_migrations%ROWTYPE;
 new_hash text:=p_data->>'fingerprintHash'; old_hash text:=p_data->>'legacyHash'; login_source text:=p_data->>'source';
 decision text:='allowed'; old_ambiguous boolean:=false; new_ambiguous boolean:=false;
 expected jsonb:=p_data->'expected'; request uuid; before_hash text; before_version smallint; before_revision bigint;
BEGIN
 IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string' OR new_hash !~ '^[a-f0-9]{64}$'
 OR (p_data ? 'legacyHash' AND jsonb_typeof(p_data->'legacyHash') NOT IN ('null','string'))
 OR (old_hash IS NOT NULL AND old_hash !~ '^[a-f0-9]{64}$')
 OR login_source IS NULL OR login_source NOT IN ('manual','automatic','remembered','recovery') THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
 SELECT * INTO STRICT s FROM public.org_staff WHERE id=p_staff_id;
 before_hash:=s.aka_agent_device_fingerprint_hash; before_version:=s.aka_agent_device_identity_version; before_revision:=s.aka_agent_device_binding_revision;
 IF before_hash IS NOT NULL AND ((before_version=3 AND before_hash<>new_hash) OR (before_version=2 AND before_hash IS DISTINCT FROM old_hash)) THEN
  decision:='device_locked';
 ELSE
  old_ambiguous:=private.aka_agent_device_ambiguous(before_version,before_hash,s.id,false);
  new_ambiguous:=private.aka_agent_device_ambiguous(3::smallint,new_hash,s.id,true);
  IF login_source<>'manual' AND (before_hash IS NULL OR old_ambiguous OR new_ambiguous) THEN decision:='manual_login_required'; END IF;
 END IF;
 IF p_action='bind_device_v3' THEN
  IF jsonb_typeof(expected) IS DISTINCT FROM 'object' OR NOT (expected ?& ARRAY['hash','version','revision'])
   OR coalesce(expected->>'version','') NOT IN ('2','3') OR coalesce(expected->>'revision','') !~ '^[0-9]+$'
   OR (jsonb_typeof(expected->'hash') NOT IN ('null','string')) OR (expected->>'hash' IS NOT NULL AND expected->>'hash' !~ '^[a-f0-9]{64}$')
   OR coalesce(p_data->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
  request:=(p_data->>'requestId')::uuid;
  SELECT * INTO receipt FROM private.aka_agent_device_migrations WHERE request_id=request;
  IF FOUND THEN
   IF receipt.staff_id<>s.id OR receipt.organization_id<>s.organization_id OR receipt.source<>login_source OR receipt.new_hash<>new_hash
    OR receipt.old_hash IS DISTINCT FROM expected->>'hash' OR receipt.old_version::text IS DISTINCT FROM expected->>'version'
    OR receipt.old_revision::text IS DISTINCT FROM expected->>'revision' OR before_hash IS DISTINCT FROM receipt.new_hash
    OR before_version<>3 OR before_revision<>receipt.new_revision THEN decision:='device_locked'; END IF;
  ELSIF decision='allowed' THEN
   IF before_hash IS DISTINCT FROM expected->>'hash' OR before_version::text IS DISTINCT FROM expected->>'version'
    OR before_revision::text IS DISTINCT FROM expected->>'revision' THEN decision:='device_locked';
   ELSIF NOT s.is_policy_accepted THEN RAISE EXCEPTION 'staff_client_policy_required';
   ELSIF before_hash IS DISTINCT FROM new_hash OR before_version<>3 THEN
    UPDATE public.org_staff SET aka_agent_device_fingerprint_hash=new_hash,aka_agent_device_identity_version=3 WHERE id=s.id RETURNING * INTO s;
    INSERT INTO private.aka_agent_device_migrations(request_id,staff_id,organization_id,source,old_hash,old_version,old_revision,new_hash,new_revision)
     VALUES(request,s.id,s.organization_id,login_source,before_hash,before_version,before_revision,new_hash,s.aka_agent_device_binding_revision);
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('decision',decision,'automaticAllowed',NOT new_ambiguous,
  'needsBinding',s.aka_agent_device_identity_version<>3 OR s.aka_agent_device_fingerprint_hash IS DISTINCT FROM new_hash,
  'binding',jsonb_build_object('hash',s.aka_agent_device_fingerprint_hash,'version',s.aka_agent_device_identity_version,'revision',s.aka_agent_device_binding_revision::text));
END; $function$;
REVOKE ALL ON FUNCTION private.aka_agent_device_v3(bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_client(p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '12s'
AS $function$
DECLARE
  s public.org_staff%ROWTYPE;
  allowed text[];
  stamp timestamptz := clock_timestamp();
  integration jsonb;
  kind text;
  device_result jsonb;
  lock_key bigint;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read','bind_device','accept_policy','change_password','set_test_workflow','save_integration','register_recovery','prepare_device_v3','bind_device_v3')
    OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
  allowed := CASE p_action
    WHEN 'prepare_device_v3' THEN ARRAY['staffId','fingerprintHash','legacyHash','source']
    WHEN 'bind_device_v3' THEN ARRAY['staffId','fingerprintHash','legacyHash','source','requestId','expected']
    WHEN 'bind_device' THEN ARRAY['staffId','fingerprintHash']
    WHEN 'change_password' THEN ARRAY['staffId','newPassword']
    WHEN 'set_test_workflow' THEN ARRAY['staffId','enabled']
    WHEN 'save_integration' THEN ARRAY['staffId','kind','integration']
    WHEN 'register_recovery' THEN ARRAY['staffId','fingerprintHash','secretHash']
    ELSE ARRAY['staffId'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(allowed))
    OR (p_data ? 'staffId' AND (jsonb_typeof(p_data->'staffId') IS DISTINCT FROM 'number' OR p_data->>'staffId' !~ '^[1-9][0-9]*$'))
    OR (p_action NOT IN ('read','prepare_device_v3') AND NOT p_data ? 'staffId') THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
  IF coalesce(btrim(p_username),'')='' OR coalesce(p_password,'')='' THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;

  -- Authenticate before taking a lock, then repeat under that lock. Neither an
  -- ID nor a fingerprint is a credential; no caller selects another staff.
  SELECT * INTO s FROM public.org_staff WHERE username=btrim(p_username) AND password=p_password;
  IF NOT FOUND OR (p_data ? 'staffId' AND s.id IS DISTINCT FROM (p_data->>'staffId')::bigint) THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;
  -- All fingerprint locks precede staff locks, including proof recovery and old API enrollment.
  IF p_action IN ('prepare_device_v3','bind_device_v3','bind_device','register_recovery') THEN
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    FOR lock_key IN SELECT DISTINCT hashtextextended(k,73103) FROM unnest(ARRAY[
      s.aka_agent_device_identity_version::text||':'||s.aka_agent_device_fingerprint_hash,
      (CASE WHEN p_action IN ('prepare_device_v3','bind_device_v3') THEN '3' ELSE s.aka_agent_device_identity_version::text END)||':'||(p_data->>'fingerprintHash')
    ]) k WHERE k IS NOT NULL ORDER BY 1 LOOP
      PERFORM pg_advisory_xact_lock(lock_key);
    END LOOP;
  END IF;
  IF p_action='read' THEN
    SELECT * INTO s FROM public.org_staff WHERE id=s.id AND username=btrim(p_username) AND password=p_password FOR SHARE;
  ELSE
    SELECT * INTO s FROM public.org_staff WHERE id=s.id AND username=btrim(p_username) AND password=p_password FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;
  IF NOT s.is_active OR s.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'staff_client_inactive'; END IF;

  IF p_action IN ('bind_device','accept_policy','register_recovery','prepare_device_v3','bind_device_v3') AND NOT public.aka_agent_staff_time_allowed(s.id) THEN
    RAISE EXCEPTION 'staff_client_expired';
  END IF;
  IF p_action IN ('prepare_device_v3','bind_device_v3') THEN
    device_result := private.aka_agent_device_v3(s.id,p_action,p_data);
    SELECT * INTO s FROM public.org_staff WHERE id=s.id;
  ELSIF p_action='register_recovery' THEN
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_data->'secretHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' OR p_data->>'secretHash' !~ '^[a-f0-9]{64}$'
      OR s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_data->>'fingerprintHash' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    IF private.aka_agent_device_ambiguous(s.aka_agent_device_identity_version,s.aka_agent_device_fingerprint_hash,s.id,false) THEN
      DELETE FROM private.aka_agent_staff_recovery WHERE staff_id=s.id;
    ELSE
    INSERT INTO private.aka_agent_staff_recovery AS r (staff_id,organization_id,fingerprint_hash,secret_hash,credential_hash)
      VALUES(s.id,s.organization_id,p_data->>'fingerprintHash',p_data->>'secretHash',encode(extensions.digest(s.password,'sha256'),'hex'))
      ON CONFLICT (staff_id) DO UPDATE SET organization_id=excluded.organization_id,fingerprint_hash=excluded.fingerprint_hash,
        secret_hash=excluded.secret_hash,credential_hash=excluded.credential_hash,created_at=clock_timestamp();
  END IF;
  ELSIF p_action='bind_device' THEN
    IF s.aka_agent_device_identity_version=3 THEN RAISE EXCEPTION 'staff_client_device_locked'; END IF;
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    IF s.aka_agent_device_fingerprint_hash IS NOT NULL
      AND s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_data->>'fingerprintHash' THEN
      RAISE EXCEPTION 'staff_client_device_locked';
    END IF;
    IF s.aka_agent_device_fingerprint_hash IS NULL THEN
      UPDATE public.org_staff SET aka_agent_device_fingerprint_hash=p_data->>'fingerprintHash' WHERE id=s.id RETURNING * INTO s;
    END IF;
    PERFORM private.aka_agent_device_ambiguous(2::smallint,s.aka_agent_device_fingerprint_hash,s.id,false);
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
    'aka_agent_device_identity_version',s.aka_agent_device_identity_version,'deviceV3',device_result,
    'device_label',s.device_label,'device_platform',s.device_platform,'device_bound_at',s.device_bound_at,'device_last_seen_at',s.device_last_seen_at,
    'app_notification',s.app_notification,'akabiz_integrations',s.akabiz_integrations,'updated_at',s.updated_at);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_recover_staff_credentials(p_secret text, p_fingerprint_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '8s'
AS $function$
DECLARE s public.org_staff%ROWTYPE; r private.aka_agent_staff_recovery%ROWTYPE; lock_key bigint;
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
  -- Same hash -> staff -> proof order as enrollment; no recovery concurrent with a new collision.
  FOR lock_key IN SELECT DISTINCT hashtextextended(k,73103) FROM unnest(ARRAY['2:'||p_fingerprint_hash,'3:'||p_fingerprint_hash]) k ORDER BY 1 LOOP PERFORM pg_advisory_xact_lock(lock_key); END LOOP;
  SELECT * INTO s FROM public.org_staff WHERE id=r.staff_id FOR SHARE;
  -- Recheck the token after locking staff, following the same staff -> recovery
  -- order as registration/password changes. A removed/rebound token cannot win.
  IF NOT FOUND OR NOT s.is_active OR s.deleted_at IS NOT NULL OR s.organization_id<>r.organization_id
    OR s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_fingerprint_hash
    OR NOT public.aka_agent_staff_time_allowed(s.id)
    OR encode(extensions.digest(s.password,'sha256'),'hex') IS DISTINCT FROM r.credential_hash
    OR NOT EXISTS (SELECT 1 FROM private.aka_agent_staff_recovery x WHERE x.staff_id=r.staff_id AND x.secret_hash=r.secret_hash)
    THEN
    RAISE EXCEPTION 'staff_recovery_invalid';
  END IF;
  IF private.aka_agent_device_ambiguous(s.aka_agent_device_identity_version,p_fingerprint_hash,s.id,false) THEN
    RETURN jsonb_build_object('status','manual_login_required');
  END IF;
  RETURN jsonb_build_object('username',s.username,'password',s.password);
END;
$function$
;
NOTIFY pgrst, 'reload schema';
COMMIT;
