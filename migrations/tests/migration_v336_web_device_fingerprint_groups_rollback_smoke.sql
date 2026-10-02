-- Execute only after v336, in an isolated unused staff scope; all writes are rolled back.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE actor record; a jsonb; b jsonb; c jsonb; r jsonb; group_id uuid;
  nonce text:=gen_random_uuid()::text; fp text; token_a text; token_b text;
BEGIN
  PERFORM 1 FROM public.auto_control_web_device_policy WHERE singleton AND max_devices=3 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Smoke expects the current limit of three'; END IF;
  SELECT s.id,s.organization_id INTO actor FROM public.org_staff s
  WHERE s.is_active IS TRUE AND s.is_policy_accepted IS TRUE AND public.aka_agent_staff_time_allowed(s.id)
    AND NOT EXISTS(SELECT 1 FROM public.auto_control_sessions cs
      WHERE cs.staff_id=s.id AND cs.revoked_at IS NULL AND cs.expires_at>now())
  ORDER BY s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED;
  IF NOT FOUND THEN RAISE EXCEPTION 'No isolated staff scope available'; END IF;
  fp:='v1:'||md5(nonce||'fp-a')||md5(nonce||'fp-a');
  token_a:=md5(nonce||'a')||md5(nonce||'a'); token_b:=md5(nonce||'b')||md5(nonce||'b');
  a:=public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,NULL,
    token_a,'web','v336 rollback smoke',now()+interval '1 hour',fp);
  b:=public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,NULL,
    token_b,'pwa','v336 rollback smoke',now()+interval '1 hour','v1:'||md5(nonce||'fp-b')||md5(nonce||'fp-b'));
  c:=public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,NULL,
    md5(nonce||'c')||md5(nonce||'c'),'web','v336 rollback smoke',now()+interval '1 hour',NULL);
  ASSERT (c->'quota'->>'used')::int=3;
  -- A returning browser reports an already enrolled fingerprint: two slots become one.
  r:=public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,(b->'session'->>'id')::uuid,NULL,NULL,NULL,NULL,NULL,fp);
  ASSERT (r->'quota'->>'used')::int=2;
  ASSERT (SELECT count(*)=2 FROM public.auto_control_sessions
    WHERE token_hash IN(token_a,token_b) AND revoked_at IS NULL AND expires_at>now());
  SELECT web_device_group_id INTO group_id FROM public.auto_control_sessions WHERE id=(a->'session'->>'id')::uuid;
  ASSERT (SELECT web_device_group_id=group_id FROM public.auto_control_sessions WHERE id=(b->'session'->>'id')::uuid);
  r:=public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,NULL,
    md5(nonce||'d')||md5(nonce||'d'),'web','v336 rollback smoke',now()+interval '1 hour',NULL);
  ASSERT (r->'quota'->>'used')::int=3;
  -- Clearing cookies at a full quota still joins this group without rotating sibling tokens.
  r:=public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,gen_random_uuid(),
    md5(nonce||'recover')||md5(nonce||'recover'),'web','v336 rollback smoke',now()+interval '1 hour',fp);
  ASSERT r->>'status'='admitted' AND (r->'quota'->>'used')::int=3;
  ASSERT r->>'deviceId'<>a->>'deviceId' AND r->>'deviceId'<>b->>'deviceId';
  ASSERT NOT (r->'session' ?| ARRAY['web_device_group_id','web_device_fingerprint','web_device_id','token_hash']);
  ASSERT (SELECT count(*)=2 FROM public.auto_control_sessions WHERE token_hash IN(token_a,token_b) AND revoked_at IS NULL);
  ASSERT public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,NULL,NULL,
    md5(nonce||'new')||md5(nonce||'new'),'web','v336 rollback smoke',now()+interval '1 hour',NULL)->>'status'='limit_reached';
  ASSERT public.aka_agent_control_web_device_claim_v2(actor.id,0,NULL,NULL,
    md5(nonce||'tenant')||md5(nonce||'tenant'),'web','v336 rollback smoke',now()+interval '1 hour',fp)->>'status'='invalid_staff';
  ASSERT public.aka_agent_control_web_device_release(actor.id,actor.organization_id,(a->'session'->>'id')::uuid);
  ASSERT NOT EXISTS(SELECT 1 FROM public.auto_control_sessions WHERE staff_id=actor.id
    AND organization_id=actor.organization_id AND web_device_group_id=group_id
    AND revoked_at IS NULL AND web_device_revision IS NOT NULL);
  ASSERT (SELECT count(*)=2 FROM public.auto_control_sessions WHERE token_hash IN(token_a,token_b) AND revoked_at IS NULL);
  ASSERT (public.aka_agent_control_web_device_overview(actor.id,actor.organization_id,NULL)->'quota'->>'used')::int=2;
  r:=public.aka_agent_control_web_device_claim_v2(actor.id,actor.organization_id,(b->'session'->>'id')::uuid,NULL,NULL,NULL,NULL,NULL,NULL);
  ASSERT r->>'status'='admitted' AND (r->'quota'->>'used')::int=3;
  -- Explicit logout frees the whole device group, including old cookie identities.
  ASSERT public.aka_agent_control_web_device_revoke(actor.id,actor.organization_id,(b->'session'->>'id')::uuid);
  ASSERT (SELECT revoked_at IS NOT NULL FROM public.auto_control_sessions WHERE token_hash=token_b);
  ASSERT (SELECT revoked_at IS NOT NULL FROM public.auto_control_sessions WHERE token_hash=token_a);
  ASSERT (public.aka_agent_control_web_device_overview(actor.id,actor.organization_id,NULL)->'quota'->>'used')::int=2;
END;
$smoke$;
SELECT 'v336 groups/merge/quota/recovery/release/tenant/logout smoke passed; rollback follows' AS result;
ROLLBACK;
