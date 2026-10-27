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
