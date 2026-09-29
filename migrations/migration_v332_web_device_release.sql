-- Device changes release admission without ending authentication.
-- Live v331 definitions captured in snapshots/v332_web_device_release_audit.json.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE dependency record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='aka_agent_control_web_device_release') THEN
    RAISE EXCEPTION 'v332 preflight: release RPC already exists; inspect before applying';
  END IF;
  FOR dependency IN SELECT * FROM (VALUES
    ('public.aka_agent_control_web_device_claim(bigint,bigint,uuid,uuid,text,text,text,timestamptz)','fbd5933e5fc7c4a600e523ad4572772c'),
    ('public.aka_agent_control_web_device_overview(bigint,bigint,uuid)','93faf6dab8bd9da786eb737a1a847cab'),
    ('public.aka_agent_control_web_device_revoke(bigint,bigint,uuid)','2eed26df527dd2ca0106da507ba73a8f')
  ) AS expected(signature,checksum) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(dependency.signature))) IS DISTINCT FROM dependency.checksum THEN
      RAISE EXCEPTION 'v332 preflight: live dependency changed: %',dependency.signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE FUNCTION public.aka_agent_control_web_device_release(
  p_staff_id bigint,p_organization_id bigint,p_session_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public SET lock_timeout='3s' SET statement_timeout='8s'
AS $$
DECLARE v_device uuid;
BEGIN
  -- Same staff lock as claim/revoke: release and admission serialize per staff.
  PERFORM 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id
    AND is_active IS TRUE AND is_policy_accepted IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT web_device_id INTO v_device FROM public.auto_control_sessions
  WHERE id=p_session_id AND staff_id=p_staff_id AND organization_id=p_organization_id
    AND client_type IN ('web','pwa') AND web_device_id IS NOT NULL
    AND revoked_at IS NULL AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  -- Retain device identity, tokens, expiry and every authentication field.
  -- Clear the whole browser group so an older parallel session cannot hold its slot.
  UPDATE public.auto_control_sessions SET web_device_revision=NULL,web_device_registered_at=NULL
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND web_device_id=v_device
    AND client_type IN ('web','pwa') AND revoked_at IS NULL
    AND (web_device_revision IS NOT NULL OR web_device_registered_at IS NOT NULL);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_control_web_device_release(bigint,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_web_device_release(bigint,bigint,uuid) TO service_role;
COMMENT ON FUNCTION public.aka_agent_control_web_device_release(bigint,bigint,uuid)
  IS 'Release Web/PWA device admission without revoking sessions; next web entry claims again.';
NOTIFY pgrst,'reload schema';
COMMIT;
