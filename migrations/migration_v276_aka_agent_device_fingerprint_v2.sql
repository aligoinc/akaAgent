-- Source definitions captured from linked production; legacy RPCs remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $preflight$
DECLARE item record; actual text;
BEGIN
  FOR item IN SELECT * FROM (VALUES ('public.aka_agent_prepare_device_change(text)','4752e10a9ab45fee879d9f55d4c2817b'),('public.aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb)','84bf195ed63d67eb35b718b19a6fed4c'),('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)','b504f4928a9dd271dec783796a7a0374')) AS sources(signature,checksum) LOOP
    SELECT md5(pg_get_functiondef(to_regprocedure(item.signature))) INTO actual;
    IF actual IS DISTINCT FROM item.checksum THEN RAISE EXCEPTION 'Legacy RPC changed: %', item.signature; END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES ('public.aka_agent_prepare_device_change_v2(text)','28589c77ed8e440a0d8b6b4304e0311f'),('public.aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)','e678f336deea7a51285afc1686a5fd7d')) AS targets(signature,checksum) LOOP
    SELECT md5(pg_get_functiondef(to_regprocedure(item.signature))) INTO actual;
    IF actual IS NOT NULL AND actual <> item.checksum THEN RAISE EXCEPTION 'Unexpected existing v2 RPC: %', item.signature; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='org_staff' AND column_name='aka_agent_device_fingerprint_hash'
    AND (data_type <> 'text' OR is_nullable <> 'YES' OR column_default IS NOT NULL)) THEN RAISE EXCEPTION 'Unexpected v2 fingerprint column'; END IF;
END;
$preflight$;
ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS aka_agent_device_fingerprint_hash text;

CREATE OR REPLACE FUNCTION public.aka_agent_prepare_device_change_v2(p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE s public.org_staff%ROWTYPE; revision text;
BEGIN
  SELECT * INTO s FROM public.org_staff WHERE username = btrim(p_username) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  IF NOT s.is_active THEN RETURN jsonb_build_object('code', 'inactive'); END IF;
  SELECT xmin::text INTO revision FROM public.org_staff WHERE id=s.id;
  RETURN jsonb_build_object('code', 'prepared', 'binding', jsonb_build_object(
    'staffId', s.id::text, 'hash', s.aka_agent_device_fingerprint_hash, 'revision', revision, 'version', 2));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_reset_device_binding_v2(p_username text, p_password text, p_source text, p_request_id uuid, p_expected_binding jsonb, p_device jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
AS $function$
DECLARE
  s public.org_staff%ROWTYPE;
  h public.auto_staff_device_change_history%ROWTYPE;
  remaining integer;
  outcome text;
  stamp timestamptz;
  device jsonb;
  revision text;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('login', 'account_menu') OR p_request_id IS NULL
     OR jsonb_typeof(p_expected_binding) IS DISTINCT FROM 'object'
     OR NOT (p_expected_binding ?& ARRAY['staffId','hash','revision','version'])
     OR p_expected_binding->>'version' IS DISTINCT FROM '2'
     OR coalesce(p_expected_binding->>'revision','') !~ '^[0-9]+$'
     OR jsonb_typeof(p_device) IS DISTINCT FROM 'object'
     OR coalesce(p_device->>'fingerprintHash','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid device change request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.org_staff WHERE username = btrim(p_username) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'changed',false,'code','not_found','remainingChanges',null); END IF;
  SELECT xmin::text INTO revision FROM public.org_staff WHERE id=s.id;
  remaining := coalesce(s.device_changes_remaining, 5);
  IF NOT s.is_active THEN outcome := 'inactive';
  ELSIF p_source = 'account_menu' AND s.password IS DISTINCT FROM p_password THEN outcome := 'not_authorized';
  ELSIF s.id::text IS DISTINCT FROM p_expected_binding->>'staffId' THEN outcome := 'binding_conflict';
  END IF;
  IF outcome IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'changed',false,'code',outcome,'remainingChanges',remaining);
  END IF;

  -- Whitelist metadata: the history must never persist arbitrary credentials.
  device := jsonb_build_object('fingerprintHash',p_device->>'fingerprintHash',
    'label',left(p_device->>'label',255),'platform',left(p_device->>'platform',20),
    'appVersion',left(p_device->>'appVersion',50),'bindingVersion',2);
  SELECT * INTO h FROM public.auto_staff_device_change_history WHERE request_id = p_request_id;
  IF FOUND THEN
    IF h.staff_id <> s.id OR h.source <> p_source
       OR h.requesting_device->>'fingerprintHash' IS DISTINCT FROM device->>'fingerprintHash'
       OR h.old_binding->>'hash' IS DISTINCT FROM p_expected_binding->>'hash'
       OR h.old_binding->>'version' IS DISTINCT FROM '2'
       OR h.old_binding->>'revision' IS DISTINCT FROM p_expected_binding->>'revision' THEN
      RETURN jsonb_build_object('success',false,'changed',false,'code','binding_conflict','remainingChanges',remaining);
    END IF;
    RETURN jsonb_build_object('success',true,'changed',true,'code','changed','remainingChanges',h.remaining_after);
  END IF;

  IF s.aka_agent_device_fingerprint_hash IS NULL THEN outcome := 'already_unbound';
  ELSIF p_source = 'account_menu' AND s.aka_agent_device_fingerprint_hash IS DISTINCT FROM device->>'fingerprintHash' THEN outcome := 'not_authorized';
  ELSIF s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_expected_binding->>'hash'
     OR revision IS DISTINCT FROM p_expected_binding->>'revision' THEN outcome := 'binding_conflict';
  ELSIF remaining <= 0 THEN outcome := 'quota_exhausted';
  END IF;
  stamp := clock_timestamp();
  IF outcome IS NULL AND p_source = 'login' AND EXISTS (
    SELECT 1 FROM public.auto_staff_device_presence
    WHERE staff_id = s.id AND ended_at IS NULL AND last_seen_at > stamp - interval '120 seconds'
  ) THEN outcome := 'device_online'; END IF;
  IF outcome IS NOT NULL THEN
    RETURN jsonb_build_object('success',outcome = 'already_unbound','changed',false,'code',outcome,'remainingChanges',remaining);
  END IF;

  UPDATE public.org_staff SET aka_agent_device_fingerprint_hash = NULL,
    device_changes_remaining = remaining - 1, updated_at = stamp
  WHERE id = s.id;
  INSERT INTO public.auto_staff_device_change_history
    (request_id,staff_id,organization_id,source,old_binding,requesting_device,remaining_before,remaining_after,created_at)
  VALUES (p_request_id,s.id,s.organization_id,p_source,
    jsonb_build_object('hash',s.aka_agent_device_fingerprint_hash,'revision',revision,'version',2),
    device,remaining,remaining - 1,stamp);
  RETURN jsonb_build_object('success',true,'changed',true,'code','changed','remainingChanges',remaining - 1);
END;
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_prepare_device_change_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_prepare_device_change_v2(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
