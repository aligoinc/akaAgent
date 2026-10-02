-- Group Web/PWA admission by staff-scoped fingerprint without merging browser tokens.
-- Built from the exact live definitions in snapshots/v336_web_device_fingerprint_groups_audit.json.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
DECLARE dependency record;
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='auto_control_sessions' AND column_name='web_device_group_id') THEN
    RAISE EXCEPTION 'v336 preflight: device groups already exist; inspect before applying';
  END IF;
  FOR dependency IN SELECT * FROM (VALUES
    ('public.aka_agent_control_web_device_claim(bigint,bigint,uuid,uuid,text,text,text,timestamp with time zone)','fbd5933e5fc7c4a600e523ad4572772c'),
    ('public.aka_agent_control_web_device_overview(bigint,bigint,uuid)','93faf6dab8bd9da786eb737a1a847cab'),
    ('public.aka_agent_control_web_device_revoke(bigint,bigint,uuid)','2eed26df527dd2ca0106da507ba73a8f'),
    ('public.aka_agent_control_web_device_release(bigint,bigint,uuid)','c45333bae7d4fb4ea29bafa8c69eaa5d'),
    ('public.aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamp with time zone,text)','fe57c1ebd641803729211aea01844065')
  ) AS expected(signature,checksum) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(dependency.signature))) IS DISTINCT FROM dependency.checksum THEN
      RAISE EXCEPTION 'v336 preflight: live dependency changed: %',dependency.signature;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE public.auto_control_sessions ADD COLUMN web_device_group_id uuid;
CREATE INDEX auto_control_sessions_web_group_idx
  ON public.auto_control_sessions(staff_id,organization_id,(coalesce(web_device_group_id,web_device_id)))
  WHERE client_type IN ('web','pwa');
COMMENT ON COLUMN public.auto_control_sessions.web_device_group_id
  IS 'Shared admission group; web_device_id remains the separate browser cookie identity.';

-- Fold existing live fingerprint matches, including transitive links through a cookie
-- enrolled with multiple fingerprints. Historical rows retain aliases for known cookies,
-- but revoked/expired fingerprints never create links. Tokens and admission revisions stay intact.
WITH RECURSIVE live AS (
  SELECT DISTINCT staff_id,organization_id,web_device_id AS device,web_device_fingerprint AS fingerprint
  FROM public.auto_control_sessions WHERE client_type IN ('web','pwa')
    AND revoked_at IS NULL AND expires_at>now() AND web_device_id IS NOT NULL
    AND web_device_fingerprint IS NOT NULL
), edges AS (
  SELECT DISTINCT a.staff_id,a.organization_id,a.device,b.device AS neighbor FROM live a JOIN live b
    ON b.staff_id=a.staff_id AND b.organization_id=a.organization_id AND b.fingerprint=a.fingerprint
), connected(staff_id,organization_id,device,root) AS (
  SELECT staff_id,organization_id,device,device FROM live
  UNION
  SELECT c.staff_id,c.organization_id,e.neighbor,c.root FROM connected c JOIN edges e
    ON e.staff_id=c.staff_id AND e.organization_id=c.organization_id AND e.device=c.device
), groups AS (
  SELECT staff_id,organization_id,device,min(root::text)::uuid AS group_id FROM connected
  GROUP BY staff_id,organization_id,device
)
UPDATE public.auto_control_sessions s SET web_device_group_id=g.group_id FROM groups g
WHERE s.staff_id=g.staff_id AND s.organization_id=g.organization_id AND s.web_device_id=g.device
  AND s.client_type IN ('web','pwa');

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_device_claim_v2(p_staff_id bigint, p_organization_id bigint, p_session_id uuid, p_device_id uuid, p_token_hash text, p_client_type text, p_user_agent text, p_expires_at timestamp with time zone, p_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_policy public.auto_control_web_device_policy%ROWTYPE;
  v_session public.auto_control_sessions%ROWTYPE;
  v_device uuid;
  v_group uuid;
  v_known_group uuid;
  v_candidates uuid[];
  v_fingerprint text := p_fingerprint;
  v_used integer;
  v_admitted_groups integer;
  v_now timestamptz;
BEGIN
  IF p_fingerprint IS NOT NULL AND p_fingerprint !~ '^v1:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid web device fingerprint';
  END IF;
  -- Preserve policy/staff lock ordering: resolve, merge, count and claim atomically.
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
  -- Session identity wins over cookies. A new cookie stays distinct even if its
  -- fingerprint matches another browser: grouping must not rotate that browser's token.
  v_device := coalesce(v_session.web_device_id,p_device_id,gen_random_uuid());
  SELECT web_device_group_id INTO v_known_group FROM public.auto_control_sessions
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND web_device_id=v_device
    AND client_type IN ('web','pwa') AND web_device_group_id IS NOT NULL
  ORDER BY created_at DESC,id DESC LIMIT 1;
  v_group := coalesce(v_session.web_device_group_id,v_known_group,v_device);
  v_fingerprint := coalesce(v_fingerprint,v_session.web_device_fingerprint);
  -- Preserve v335's fingerprint retention on known-cookie login, including history.
  IF v_fingerprint IS NULL THEN
    SELECT web_device_fingerprint INTO v_fingerprint FROM public.auto_control_sessions
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND web_device_id=v_device
      AND client_type IN ('web','pwa') AND web_device_fingerprint IS NOT NULL
    ORDER BY created_at DESC,id DESC LIMIT 1;
  END IF;
  SELECT array_agg(DISTINCT coalesce(web_device_group_id,web_device_id)
    ORDER BY coalesce(web_device_group_id,web_device_id)) INTO v_candidates
  FROM public.auto_control_sessions
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND client_type IN ('web','pwa')
    AND revoked_at IS NULL AND expires_at>v_now AND web_device_id IS NOT NULL
    AND web_device_fingerprint=v_fingerprint;
  -- Prefer an existing matching group for a fresh identity. Known aliases remain stable.
  IF v_session.web_device_group_id IS NULL AND v_known_group IS NULL AND cardinality(v_candidates)>0 THEN
    v_group := v_candidates[1];
  END IF;
  v_candidates := array_append(coalesce(v_candidates,ARRAY[]::uuid[]),coalesce(v_known_group,v_device));
  v_candidates := array_append(v_candidates,v_group);
  SELECT count(DISTINCT coalesce(web_device_group_id,web_device_id)),
    count(DISTINCT coalesce(web_device_group_id,web_device_id)) FILTER (
      WHERE coalesce(web_device_group_id,web_device_id)=ANY(v_candidates))
    INTO v_used,v_admitted_groups FROM public.auto_control_sessions
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND client_type IN ('web','pwa')
    AND revoked_at IS NULL AND expires_at>v_now AND web_device_revision=v_policy.revision;
  v_used := v_used-greatest(v_admitted_groups-1,0);
  IF v_admitted_groups=0 AND v_used>=v_policy.max_devices THEN
    -- Denied restoration still revokes only its cookie identity, preserving other open pages.
    IF p_session_id IS NOT NULL THEN
      UPDATE public.auto_control_sessions SET revoked_at=v_now
      WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND client_type IN ('web','pwa')
        AND revoked_at IS NULL AND (id=p_session_id OR web_device_id=v_device);
    END IF;
    RETURN jsonb_build_object('status','limit_reached','limit',v_policy.max_devices,'used',v_used);
  END IF;
  -- Keep aliases on history, without reviving sessions or changing their admission state.
  UPDATE public.auto_control_sessions SET web_device_group_id=v_group
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND client_type IN ('web','pwa')
    AND coalesce(web_device_group_id,web_device_id)=ANY(v_candidates)
    AND web_device_group_id IS DISTINCT FROM v_group;
  IF p_session_id IS NULL THEN
    -- A known-cookie login rotates only that browser; other group members keep their tokens.
    UPDATE public.auto_control_sessions SET revoked_at=v_now
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND web_device_id=v_device
      AND client_type IN ('web','pwa') AND revoked_at IS NULL;
    INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,client_type,user_agent,
      expires_at,web_device_id,web_device_group_id,web_device_revision,web_device_registered_at,web_device_fingerprint)
    VALUES(p_staff_id,p_organization_id,p_token_hash,p_client_type,left(p_user_agent,1000),
      p_expires_at,v_device,v_group,v_policy.revision,v_now,v_fingerprint) RETURNING * INTO v_session;
  ELSE
    UPDATE public.auto_control_sessions SET web_device_id=v_device,web_device_group_id=v_group,
      web_device_revision=v_policy.revision,web_device_fingerprint=v_fingerprint,
      web_device_registered_at=CASE WHEN web_device_revision=v_policy.revision THEN web_device_registered_at ELSE v_now END
    WHERE id=p_session_id RETURNING * INTO v_session;
  END IF;
  RETURN jsonb_build_object('status','admitted','deviceId',v_device,
    'quota',jsonb_build_object('limit',v_policy.max_devices,'used',v_used+CASE WHEN v_admitted_groups>0 THEN 0 ELSE 1 END),
    'session',to_jsonb(v_session)-'token_hash'-'web_device_id'-'web_device_revision'-'web_device_registered_at'
      -'web_device_fingerprint'-'web_device_group_id');
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_device_claim(p_staff_id bigint, p_organization_id bigint, p_session_id uuid, p_device_id uuid, p_token_hash text, p_client_type text, p_user_agent text, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  -- Keep the original signature for older callers, using the same group-aware admission.
  RETURN public.aka_agent_control_web_device_claim_v2(p_staff_id,p_organization_id,p_session_id,
    p_device_id,p_token_hash,p_client_type,p_user_agent,p_expires_at,NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_device_overview(p_staff_id bigint, p_organization_id bigint, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '8s'
AS $function$
  WITH policy AS (SELECT * FROM public.auto_control_web_device_policy WHERE singleton),
  active AS (
    SELECT s.*,CASE WHEN s.client_type IN ('web','pwa') AND s.web_device_id IS NOT NULL
      THEN 'device:'||coalesce(s.web_device_group_id,s.web_device_id)::text ELSE 'session:'||s.id::text END AS device_group
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
    'used',(SELECT count(DISTINCT coalesce(web_device_group_id,web_device_id)) FROM active
      WHERE client_type IN ('web','pwa') AND web_device_revision=(SELECT revision FROM policy))),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'clientType',client_type,'userAgent',coalesce(user_agent,'Thiết bị không xác định'),
      'createdAt',created_at,'lastSeenAt',last_seen_at,'expiresAt',expires_at,'current',current_device,
      'sessionCount',session_count,'registrationState',CASE WHEN client_type='native' THEN 'not_applicable'
        WHEN counted THEN 'registered' ELSE 'pending' END) ORDER BY current_device DESC,last_seen_at DESC,id)
      FROM grouped),'[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_device_release(p_staff_id bigint, p_organization_id bigint, p_session_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '8s'
AS $function$
DECLARE v_device uuid;
BEGIN
  -- Same staff lock as claim/revoke: release and admission serialize per staff.
  PERFORM 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id
    AND is_active IS TRUE AND is_policy_accepted IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT coalesce(web_device_group_id,web_device_id) INTO v_device FROM public.auto_control_sessions
  WHERE id=p_session_id AND staff_id=p_staff_id AND organization_id=p_organization_id
    AND client_type IN ('web','pwa') AND web_device_id IS NOT NULL
    AND revoked_at IS NULL AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  -- Retain device identity, tokens, expiry and every authentication field.
  -- Clear the whole admission group so an older parallel session cannot hold its slot.
  UPDATE public.auto_control_sessions SET web_device_revision=NULL,web_device_registered_at=NULL
  WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND coalesce(web_device_group_id,web_device_id)=v_device
    AND client_type IN ('web','pwa') AND revoked_at IS NULL
    AND (web_device_revision IS NOT NULL OR web_device_registered_at IS NOT NULL);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_device_revoke(p_staff_id bigint, p_organization_id bigint, p_session_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '8s'
AS $function$
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
      AND coalesce(web_device_group_id,web_device_id)=coalesce(v_session.web_device_group_id,v_session.web_device_id)));
  RETURN true;
END;
$function$;

-- CREATE OR REPLACE retains owner and existing service-role-only ACLs. Explicit
-- logout/revoke frees the whole group; login rotation and denied entry stay cookie-scoped.
COMMENT ON FUNCTION public.aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamptz,text)
  IS 'Atomic staff-scoped Web/PWA admission; matching live fingerprints share capacity, not browser tokens.';
NOTIFY pgrst,'reload schema';
COMMIT;
