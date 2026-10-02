-- Additive Web/PWA fingerprint recovery. Live dependencies captured in
-- snapshots/v335_web_device_fingerprint_audit.json; v331/v332 stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE dependency record;
BEGIN
  IF to_regprocedure('public.aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamptz,text)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='auto_control_sessions' AND column_name='web_device_fingerprint') THEN
    RAISE EXCEPTION 'v335 preflight: fingerprint recovery already exists; inspect before applying';
  END IF;
  FOR dependency IN SELECT * FROM (VALUES
    ('public.aka_agent_control_web_device_claim(bigint,bigint,uuid,uuid,text,text,text,timestamptz)','fbd5933e5fc7c4a600e523ad4572772c'),
    ('public.aka_agent_control_web_device_overview(bigint,bigint,uuid)','93faf6dab8bd9da786eb737a1a847cab'),
    ('public.aka_agent_control_web_device_release(bigint,bigint,uuid)','c45333bae7d4fb4ea29bafa8c69eaa5d'),
    ('public.aka_agent_control_web_device_revoke(bigint,bigint,uuid)','2eed26df527dd2ca0106da507ba73a8f')
  ) AS expected(signature,checksum) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(dependency.signature))) IS DISTINCT FROM dependency.checksum THEN
      RAISE EXCEPTION 'v335 preflight: live dependency changed: %',dependency.signature;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE public.auto_control_sessions ADD COLUMN web_device_fingerprint text
  CHECK (web_device_fingerprint IS NULL OR web_device_fingerprint ~ '^v1:[0-9a-f]{64}$');
CREATE INDEX auto_control_sessions_web_fingerprint_idx
  ON public.auto_control_sessions(staff_id,organization_id,web_device_fingerprint)
  WHERE client_type IN ('web','pwa') AND revoked_at IS NULL AND web_device_fingerprint IS NOT NULL;
-- Cookie precedence includes logged-out/expired identities; existing indexes cover only unrevoked rows.
CREATE INDEX auto_control_sessions_web_identity_idx
  ON public.auto_control_sessions(staff_id,organization_id,web_device_id)
  WHERE client_type IN ('web','pwa') AND web_device_id IS NOT NULL;

CREATE FUNCTION public.aka_agent_control_web_device_claim_v2(
  p_staff_id bigint,p_organization_id bigint,p_session_id uuid,p_device_id uuid,
  p_token_hash text,p_client_type text,p_user_agent text,p_expires_at timestamptz,p_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public SET lock_timeout='3s' SET statement_timeout='8s'
AS $$
DECLARE
  v_device uuid := p_device_id;
  v_fingerprint text := p_fingerprint;
  v_session_device uuid;
  v_candidates uuid[];
  v_result jsonb;
BEGIN
  IF p_fingerprint IS NOT NULL AND p_fingerprint !~ '^v1:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid web device fingerprint';
  END IF;
  -- Match v331 lock ordering. The match and the existing atomic claim are one transaction.
  PERFORM 1 FROM public.auto_control_web_device_policy WHERE singleton FOR SHARE;
  PERFORM 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id
    AND is_active IS TRUE AND is_policy_accepted IS TRUE FOR UPDATE;
  IF NOT FOUND OR NOT public.aka_agent_staff_time_allowed(p_staff_id) THEN
    RETURN jsonb_build_object('status','invalid_staff');
  END IF;
  IF p_session_id IS NOT NULL THEN
    SELECT web_device_id INTO v_session_device FROM public.auto_control_sessions
    WHERE id=p_session_id AND staff_id=p_staff_id AND organization_id=p_organization_id
      AND client_type IN ('web','pwa') AND revoked_at IS NULL AND expires_at>clock_timestamp();
    IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid_session'); END IF;
  END IF;
  -- An authenticated session's identity always wins, followed by a cookie known in this staff scope.
  -- Anonymous web-entry can seed a fresh cookie: an unknown cookie is still eligible for recovery.
  IF v_session_device IS NULL AND p_fingerprint IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_control_sessions WHERE staff_id=p_staff_id AND organization_id=p_organization_id
      AND client_type IN ('web','pwa') AND web_device_id IS NOT NULL AND web_device_id=p_device_id
  ) THEN
    SELECT array_agg(candidate.web_device_id) INTO v_candidates FROM (
      SELECT DISTINCT web_device_id FROM public.auto_control_sessions
      WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND client_type IN ('web','pwa')
        AND revoked_at IS NULL AND expires_at>clock_timestamp() AND web_device_id IS NOT NULL
        AND web_device_fingerprint=p_fingerprint
      LIMIT 2
    ) candidate;
    -- Do not arbitrarily pick between multiple known browser identities with the same fingerprint.
    IF cardinality(v_candidates)=1 THEN v_device := v_candidates[1]; END IF;
  END IF;
  -- Login rotates the session. When collection is unavailable, carry forward the last
  -- enrolled fingerprint of this exact cookie identity, never another staff/device.
  -- Known cookies remain authoritative after logout/expiry; quota is still checked below.
  IF p_session_id IS NULL AND v_fingerprint IS NULL AND v_device IS NOT NULL THEN
    SELECT web_device_fingerprint INTO v_fingerprint FROM public.auto_control_sessions
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND web_device_id=v_device
      AND client_type IN ('web','pwa') AND web_device_fingerprint IS NOT NULL
    ORDER BY created_at DESC,id DESC LIMIT 1;
  END IF;
  v_result := public.aka_agent_control_web_device_claim(p_staff_id,p_organization_id,p_session_id,
    v_device,p_token_hash,p_client_type,p_user_agent,p_expires_at);
  IF v_result->>'status'='admitted' THEN
    IF v_fingerprint IS NOT NULL THEN
      UPDATE public.auto_control_sessions SET web_device_fingerprint=v_fingerprint
      WHERE id=(v_result->'session'->>'id')::uuid AND staff_id=p_staff_id AND organization_id=p_organization_id;
    END IF;
    v_result := jsonb_set(v_result,'{session}',(v_result->'session')-'web_device_fingerprint');
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamptz,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamptz,text)
  TO service_role;
COMMENT ON FUNCTION public.aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamptz,text)
  IS 'Web admission with optional staff-scoped fingerprint recovery; authentication and quota remain mandatory.';
-- New RPC signature and column require refreshing the Data API metadata.
NOTIFY pgrst,'reload schema';
COMMIT;
