BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  actor record; a jsonb; v jsonb; d jsonb; n integer; native_id uuid;
  device uuid := gen_random_uuid(); nonce text := gen_random_uuid()::text;
  fp text; token text; original_token text;
BEGIN
  PERFORM 1 FROM public.auto_control_web_device_policy WHERE singleton AND max_devices=3 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Smoke expects the current limit of three'; END IF;
  SELECT s.id,s.organization_id INTO actor FROM public.org_staff s
  WHERE s.is_active IS TRUE AND s.is_policy_accepted IS TRUE AND public.aka_agent_staff_time_allowed(s.id)
    AND NOT EXISTS(SELECT 1 FROM public.auto_control_sessions cs WHERE cs.staff_id=s.id AND cs.revoked_at IS NULL AND cs.expires_at>now())
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id
      AND p.product_id=17 AND p.is_deleted=false AND p.expiration_date >=
        (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'))
  ORDER BY s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED;
  IF NOT FOUND THEN RAISE EXCEPTION 'No isolated entitled staff scope available'; END IF;
  fp := 'v1:'||md5(nonce||'fingerprint')||md5(nonce||'fingerprint2');
  original_token := md5(nonce||'a')||md5(nonce||'a2');
  a := public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,device,
    original_token,'web','v335 rollback smoke',now()+interval '1 hour',fp);
  ASSERT a->>'status'='admitted';
  FOR n IN 1..2 LOOP
    v := public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,NULL,
      md5(nonce||n)||md5(nonce||'token'||n),'pwa','v335 rollback smoke',now()+interval '1 hour',
      'v1:'||md5(nonce||'fp'||n)||md5(nonce||'fp2'||n));
    ASSERT v->>'status'='admitted';
  END LOOP;
  ASSERT (v->'quota'->>'used')::int=3;
  ASSERT public.aka_agent_authenticate_control_session(original_token)->>'status'='authenticated';
  -- Known-cookie login must retain enrollment when collection is temporarily unavailable.
  v := public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,device,
    md5(nonce||'rotate')||md5(nonce||'rotate2'),'web','v335 rollback smoke',now()+interval '1 hour',NULL);
  ASSERT v->>'status'='admitted' AND (v->>'deviceId')::uuid=device;
  ASSERT (SELECT web_device_fingerprint=fp FROM public.auto_control_sessions WHERE id=(v->'session'->>'id')::uuid);
  ASSERT public.aka_agent_authenticate_control_session(original_token)->>'status'='invalid_session';
  -- Clearing cookies still recovers the same full-quota slot through the saved fingerprint.
  token := md5(nonce||'recover')||md5(nonce||'recover2');
  v := public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,gen_random_uuid(),
    token,'web','v335 rollback smoke',now()+interval '1 hour',fp);
  ASSERT v->>'status'='admitted' AND (v->>'deviceId')::uuid=device AND (v->'quota'->>'used')::int=3;
  ASSERT NOT (v->'session' ? 'web_device_fingerprint');
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='authenticated';
  a := v;
  ASSERT public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,gen_random_uuid(),
    md5(nonce||'new')||md5(nonce||'new2'),'web','v335 rollback smoke',now()+interval '1 hour',
    'v1:'||md5(nonce||'newfp')||md5(nonce||'newfp2'))->>'status'='limit_reached';
  ASSERT public.aka_agent_control_web_device_claim_v2(0,actor.organization_id,(a->'session'->>'id')::uuid,NULL,NULL,NULL,NULL,NULL,fp)->>'status'='invalid_staff';
  ASSERT public.aka_agent_control_web_device_claim_v2(actor.id,0,(a->'session'->>'id')::uuid,NULL,NULL,NULL,NULL,NULL,fp)->>'status'='invalid_staff';
  INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,client_type,user_agent,expires_at)
  VALUES(actor.id,actor.organization_id,md5(nonce||'native')||md5(nonce||'native2'),'native','v335 rollback smoke',now()+interval '1 hour')
  RETURNING id INTO native_id;
  ASSERT public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,native_id,NULL,NULL,NULL,NULL,NULL,fp)->>'status'='invalid_session';
  ASSERT public.aka_agent_control_web_device_release(actor.id,actor.organization_id,(a->'session'->>'id')::uuid);
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='authenticated';
  d := public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,NULL,
    md5(nonce||'d')||md5(nonce||'d2'),'web','v335 rollback smoke',now()+interval '1 hour',NULL);
  ASSERT d->>'status'='admitted';
  ASSERT public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,device,
    md5(nonce||'denied')||md5(nonce||'denied2'),'web','v335 rollback smoke',now()+interval '1 hour',NULL)->>'status'='limit_reached';
  ASSERT public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,(a->'session'->>'id')::uuid,NULL,NULL,NULL,NULL,NULL,fp)->>'status'='limit_reached';
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='invalid_session';
  ASSERT public.aka_agent_control_web_device_revoke(actor.id,actor.organization_id,(d->'session'->>'id')::uuid);
  v := public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,device,
    md5(nonce||'after-revoke')||md5(nonce||'after-revoke2'),'web','v335 rollback smoke',now()+interval '1 hour',NULL);
  ASSERT v->>'status'='admitted' AND (v->'quota'->>'used')::int=3;
  ASSERT (SELECT web_device_fingerprint=fp FROM public.auto_control_sessions WHERE id=(v->'session'->>'id')::uuid);
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='invalid_session';
END;
$smoke$;
SELECT 'v335 fingerprint/rotation/quota/auth/release/native/tenant smoke passed; rollback follows' AS result;
ROLLBACK;
