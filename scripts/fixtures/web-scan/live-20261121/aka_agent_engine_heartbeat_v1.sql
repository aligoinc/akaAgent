CREATE OR REPLACE FUNCTION public.aka_agent_engine_heartbeat_v1(p_account_id bigint, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, public.aka_agent_engine_setting('engine.lease_seconds', '180')::integer);
  l public.auto_engine_leases%ROWTYPE;
  c record;
  a record;
BEGIN
  UPDATE public.auto_engine_leases SET heartbeat_at = v_now, expires_at = v_now + make_interval(secs => v_lease_seconds)
   WHERE account_id = p_account_id AND lease_token = p_lease_token
  RETURNING * INTO l;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  SELECT cc.status, coalesce(cc.is_delete, false) AS is_delete INTO c FROM public.auto_campaigns cc WHERE cc.id = l.campaign_id;
  SELECT aa.status, aa.login_status, coalesce(aa.is_delete, false) AS is_delete INTO a FROM public.auto_accounts aa WHERE aa.id = p_account_id;
  RETURN jsonb_build_object('ok', true, 'expiresAt', l.expires_at,
    'control', jsonb_build_object('campaignStatus', c.status, 'campaignDeleted', c.is_delete,
      'accountStatus', a.status, 'loginStatus', a.login_status, 'accountDeleted', a.is_delete));
END $function$
