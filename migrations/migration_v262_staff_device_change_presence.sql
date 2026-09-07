-- New RPCs audited absent on linked production cgjbsmqtfhqvttudyjzq.
-- Only the app RPC debits quota; no org_staff quota constraints or triggers.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE item record; actual text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('public.aka_agent_prepare_device_change(text)', '4752e10a9ab45fee879d9f55d4c2817b'),
    ('public.aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb)', '84bf195ed63d67eb35b718b19a6fed4c'),
    ('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)', 'b504f4928a9dd271dec783796a7a0374')
  ) AS targets(signature, checksum)
  LOOP
    SELECT md5(pg_get_functiondef(to_regprocedure(item.signature))) INTO actual;
    IF actual IS NOT NULL AND actual <> item.checksum THEN
      RAISE EXCEPTION 'Device change preflight mismatch: % (%)', item.signature, actual;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS device_changes_remaining integer DEFAULT 5;

CREATE TABLE IF NOT EXISTS public.auto_staff_device_presence (
  instance_id uuid PRIMARY KEY,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL,
  device_fingerprint_hash text NOT NULL,
  device_label text,
  device_platform text,
  app_version text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS auto_staff_device_presence_online_idx
  ON public.auto_staff_device_presence (staff_id, last_seen_at DESC) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS auto_staff_device_presence_history_idx
  ON public.auto_staff_device_presence (staff_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.auto_staff_device_change_history (
  request_id uuid PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  source text NOT NULL CHECK (source IN ('login', 'account_menu')),
  old_binding jsonb NOT NULL,
  requesting_device jsonb NOT NULL,
  remaining_before integer NOT NULL,
  remaining_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS auto_staff_device_change_history_staff_idx
  ON public.auto_staff_device_change_history (staff_id, created_at DESC);

ALTER TABLE public.auto_staff_device_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_staff_device_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_staff_device_presence, public.auto_staff_device_change_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auto_staff_device_presence, public.auto_staff_device_change_history TO service_role;

-- Username-only access is intentional for the login reset flow. Return only
-- its CAS snapshot, never credentials. The final RPC revalidates under lock.
CREATE OR REPLACE FUNCTION public.aka_agent_prepare_device_change(p_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE s public.org_staff%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.org_staff WHERE username = btrim(p_username);
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  IF NOT s.is_active THEN RETURN jsonb_build_object('code', 'inactive'); END IF;
  RETURN jsonb_build_object('code', 'prepared', 'binding', jsonb_build_object(
    'staffId', s.id::text, 'hash', s.device_fingerprint_hash, 'boundAt', s.device_bound_at));
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_reset_device_binding(
  p_username text, p_password text, p_source text, p_request_id uuid,
  p_expected_binding jsonb, p_device jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '3s'
AS $function$
DECLARE
  s public.org_staff%ROWTYPE;
  h public.auto_staff_device_change_history%ROWTYPE;
  remaining integer;
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

  UPDATE public.org_staff SET device_fingerprint_hash = NULL, device_label = NULL,
    device_platform = NULL, device_bound_at = NULL, device_last_seen_at = NULL,
    device_changes_remaining = remaining - 1, updated_at = stamp
  WHERE id = s.id;
  UPDATE public.auto_staff_device_login_settings SET remember_login = false, auto_login = false, updated_at = stamp
  WHERE staff_id = s.id AND device_fingerprint_hash = s.device_fingerprint_hash;
  INSERT INTO public.auto_staff_device_change_history
    (request_id,staff_id,organization_id,source,old_binding,requesting_device,remaining_before,remaining_after,created_at)
  VALUES (p_request_id,s.id,s.organization_id,p_source,
    jsonb_build_object('hash',s.device_fingerprint_hash,'label',s.device_label,'platform',s.device_platform,'boundAt',s.device_bound_at),
    device,remaining,remaining - 1,stamp);
  RETURN jsonb_build_object('success',true,'changed',true,'code','changed','remainingChanges',remaining - 1);
END;
$function$;

-- Observational only: intentionally does not check the staff's current binding.
CREATE OR REPLACE FUNCTION public.aka_agent_device_presence(
  p_username text, p_password text, p_instance_id uuid, p_device jsonb, p_ended boolean
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '3s'
AS $function$
DECLARE s public.org_staff%ROWTYPE; stamp timestamptz;
BEGIN
  IF p_instance_id IS NULL OR p_ended IS NULL OR jsonb_typeof(p_device) IS DISTINCT FROM 'object'
     OR coalesce(p_device->>'fingerprintHash','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid presence request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.org_staff WHERE username = btrim(p_username) FOR UPDATE;
  IF NOT FOUND OR NOT s.is_active OR s.password IS DISTINCT FROM p_password THEN RETURN false; END IF;
  stamp := clock_timestamp();
  -- An end arriving before the first heartbeat inserts a tombstone. A late
  -- heartbeat cannot resurrect it; a new login always uses another instance_id.
  INSERT INTO public.auto_staff_device_presence AS presence
    (instance_id,staff_id,organization_id,device_fingerprint_hash,device_label,device_platform,app_version,started_at,last_seen_at,ended_at)
  VALUES (p_instance_id,s.id,s.organization_id,p_device->>'fingerprintHash',left(p_device->>'label',255),
    left(p_device->>'platform',20),left(p_device->>'appVersion',50),stamp,stamp,CASE WHEN p_ended THEN stamp END)
  ON CONFLICT (instance_id) DO UPDATE SET
    last_seen_at = CASE WHEN p_ended THEN presence.last_seen_at ELSE stamp END,
    ended_at = CASE WHEN p_ended THEN stamp ELSE NULL END
  WHERE presence.staff_id = s.id AND presence.organization_id = s.organization_id
    AND presence.device_fingerprint_hash = p_device->>'fingerprintHash' AND presence.ended_at IS NULL;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_prepare_device_change(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_device_presence(text,text,uuid,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_prepare_device_change(text),
  public.aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb),
  public.aka_agent_device_presence(text,text,uuid,jsonb,boolean) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
