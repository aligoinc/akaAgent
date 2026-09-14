-- Menu device changes are unlimited and preserve the stored login quota, including NULL.
-- Captured from linked production cgjbsmqtfhqvttudyjzq on 2026-09-14.
-- Preserve login quota/Online guard, password/device authorization, CAS, replay,
-- version-specific binding cleanup, presence, metadata whitelist and function attributes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE r record; f oid; checksum text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb)', '84bf195ed63d67eb35b718b19a6fed4c', '20528bcb292a243fd4f0166dec3cb05e'),
    ('public.aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)', 'e678f336deea7a51285afc1686a5fd7d', 'dfc6d177499fbf9fc51526d7b9fba6f4')
  ) AS expected(signature, source_checksum, target_checksum)
  LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL THEN RAISE EXCEPTION 'Missing function: %', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source_checksum, r.target_checksum) THEN
      RAISE EXCEPTION 'Unexpected live definition for %: %', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=f
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=pg_catalog, public','lock_timeout=3s']
      AND p.proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
      RAISE EXCEPTION 'Unexpected function attributes for %', r.signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_reset_device_binding(p_username text, p_password text, p_source text, p_request_id uuid, p_expected_binding jsonb, p_device jsonb)
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
  remaining_after integer;
  outcome text;
  stamp timestamptz;
  device jsonb;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('login', 'account_menu') OR p_request_id IS NULL
     OR jsonb_typeof(p_expected_binding) IS DISTINCT FROM 'object'
     OR NOT (p_expected_binding ?& ARRAY['staffId','hash','boundAt'])
     OR jsonb_typeof(p_device) IS DISTINCT FROM 'object'
     OR coalesce(p_device->>'fingerprintHash','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid device change request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.org_staff WHERE username = btrim(p_username) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'changed',false,'code','not_found','remainingChanges',null); END IF;
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
    'appVersion',left(p_device->>'appVersion',50));
  SELECT * INTO h FROM public.auto_staff_device_change_history WHERE request_id = p_request_id;
  IF FOUND THEN
    IF h.staff_id <> s.id OR h.source <> p_source
       OR h.requesting_device->>'fingerprintHash' IS DISTINCT FROM device->>'fingerprintHash'
       OR h.old_binding->>'hash' IS DISTINCT FROM p_expected_binding->>'hash'
       OR (h.old_binding->>'boundAt')::timestamptz IS DISTINCT FROM (p_expected_binding->>'boundAt')::timestamptz THEN
      RETURN jsonb_build_object('success',false,'changed',false,'code','binding_conflict','remainingChanges',remaining);
    END IF;
    RETURN jsonb_build_object('success',true,'changed',true,'code','changed','remainingChanges',h.remaining_after);
  END IF;

  IF s.device_fingerprint_hash IS NULL THEN outcome := 'already_unbound';
  ELSIF p_source = 'account_menu' AND s.device_fingerprint_hash IS DISTINCT FROM device->>'fingerprintHash' THEN outcome := 'not_authorized';
  ELSIF s.device_fingerprint_hash IS DISTINCT FROM p_expected_binding->>'hash'
     OR s.device_bound_at IS DISTINCT FROM (p_expected_binding->>'boundAt')::timestamptz THEN outcome := 'binding_conflict';
  ELSIF p_source = 'login' AND remaining <= 0 THEN outcome := 'quota_exhausted';
  END IF;
  stamp := clock_timestamp();
  IF outcome IS NULL AND p_source = 'login' AND EXISTS (
    SELECT 1 FROM public.auto_staff_device_presence
    WHERE staff_id = s.id AND ended_at IS NULL AND last_seen_at > stamp - interval '120 seconds'
  ) THEN outcome := 'device_online'; END IF;
  IF outcome IS NOT NULL THEN
    RETURN jsonb_build_object('success',outcome = 'already_unbound','changed',false,'code',outcome,'remainingChanges',remaining);
  END IF;

  -- Only the unauthenticated login flow consumes the device-change quota.
  remaining_after := remaining - CASE WHEN p_source = 'login' THEN 1 ELSE 0 END;
  UPDATE public.org_staff SET device_fingerprint_hash = NULL, device_label = NULL,
    device_platform = NULL, device_bound_at = NULL, device_last_seen_at = NULL,
    device_changes_remaining = CASE WHEN p_source = 'login' THEN remaining_after ELSE s.device_changes_remaining END,
    updated_at = stamp
  WHERE id = s.id;
  UPDATE public.auto_staff_device_login_settings SET remember_login = false, auto_login = false, updated_at = stamp
  WHERE staff_id = s.id AND device_fingerprint_hash = s.device_fingerprint_hash;
  INSERT INTO public.auto_staff_device_change_history
    (request_id,staff_id,organization_id,source,old_binding,requesting_device,remaining_before,remaining_after,created_at)
  VALUES (p_request_id,s.id,s.organization_id,p_source,
    jsonb_build_object('hash',s.device_fingerprint_hash,'label',s.device_label,'platform',s.device_platform,'boundAt',s.device_bound_at),
    device,remaining,remaining_after,stamp);
  RETURN jsonb_build_object('success',true,'changed',true,'code','changed','remainingChanges',remaining_after);
END;
$function$;

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
  remaining_after integer;
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
  ELSIF p_source = 'login' AND remaining <= 0 THEN outcome := 'quota_exhausted';
  END IF;
  stamp := clock_timestamp();
  IF outcome IS NULL AND p_source = 'login' AND EXISTS (
    SELECT 1 FROM public.auto_staff_device_presence
    WHERE staff_id = s.id AND ended_at IS NULL AND last_seen_at > stamp - interval '120 seconds'
  ) THEN outcome := 'device_online'; END IF;
  IF outcome IS NOT NULL THEN
    RETURN jsonb_build_object('success',outcome = 'already_unbound','changed',false,'code',outcome,'remainingChanges',remaining);
  END IF;

  -- Only the unauthenticated login flow consumes the device-change quota.
  remaining_after := remaining - CASE WHEN p_source = 'login' THEN 1 ELSE 0 END;
  UPDATE public.org_staff SET aka_agent_device_fingerprint_hash = NULL,
    device_changes_remaining = CASE WHEN p_source = 'login' THEN remaining_after ELSE s.device_changes_remaining END,
    updated_at = stamp
  WHERE id = s.id;
  INSERT INTO public.auto_staff_device_change_history
    (request_id,staff_id,organization_id,source,old_binding,requesting_device,remaining_before,remaining_after,created_at)
  VALUES (p_request_id,s.id,s.organization_id,p_source,
    jsonb_build_object('hash',s.aka_agent_device_fingerprint_hash,'revision',revision,'version',2),
    device,remaining,remaining_after,stamp);
  RETURN jsonb_build_object('success',true,'changed',true,'code','changed','remainingChanges',remaining_after);
END;
$function$;

DO $postflight$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb)'::regprocedure)) <> '20528bcb292a243fd4f0166dec3cb05e' THEN
    RAISE EXCEPTION 'Target checksum mismatch: aka_agent_reset_device_binding';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)'::regprocedure)) <> 'dfc6d177499fbf9fc51526d7b9fba6f4' THEN
    RAISE EXCEPTION 'Target checksum mismatch: aka_agent_reset_device_binding_v2';
  END IF;
END;
$postflight$;

-- API metadata is unchanged. No explicit schema reload; the existing DDL trigger remains enabled.
COMMIT;
