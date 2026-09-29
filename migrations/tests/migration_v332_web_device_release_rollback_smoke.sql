BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE actor record; v jsonb; ids uuid[]:='{}'; device uuid:=gen_random_uuid();
  nonce text:=gen_random_uuid()::text; token text; sibling uuid; native_id uuid; replacement uuid; n integer;
BEGIN
  -- Match claim's lock order and use a staff scope with no live sessions.
  PERFORM 1 FROM public.auto_control_web_device_policy WHERE singleton AND max_devices=3 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Smoke expects the current default limit of three'; END IF;
  SELECT s.id,s.organization_id INTO actor FROM public.org_staff s
  WHERE s.is_active IS TRUE AND s.is_policy_accepted IS TRUE AND public.aka_agent_staff_time_allowed(s.id)
    AND NOT EXISTS(SELECT 1 FROM public.auto_control_sessions cs WHERE cs.staff_id=s.id AND cs.revoked_at IS NULL AND cs.expires_at>now())
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id
      AND p.product_id=17 AND p.is_deleted=false AND p.expiration_date >=
        (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'))
  ORDER BY s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED;
  IF NOT FOUND THEN RAISE EXCEPTION 'No isolated entitled staff scope available'; END IF;
  FOR n IN 1..3 LOOP
    token:=md5(nonce||n::text)||md5(nonce||'token'||n::text);
    v:=public.aka_agent_control_web_device_claim(actor.id,actor.organization_id,NULL,
      CASE WHEN n=1 THEN device ELSE gen_random_uuid() END,token,'web','v332 rollback smoke',now()+interval '1 hour');
    ASSERT v->>'status'='admitted',v::text;
    ids:=array_append(ids,(v->'session'->>'id')::uuid);
  END LOOP;
  token:=md5(nonce||'1')||md5(nonce||'token1');
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='authenticated';
  INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,client_type,user_agent,expires_at,web_device_id,web_device_revision,web_device_registered_at)
  SELECT actor.id,actor.organization_id,md5(nonce||'sibling')||md5(nonce||'sibling2'),'pwa','v332 rollback smoke',expires_at,device,web_device_revision,web_device_registered_at
  FROM public.auto_control_sessions WHERE id=ids[1] RETURNING id INTO sibling;
  INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,client_type,user_agent,expires_at,web_device_id,web_device_revision)
  SELECT actor.id,actor.organization_id,md5(nonce||'native')||md5(nonce||'native2'),'native','v332 rollback smoke',expires_at,device,web_device_revision
  FROM public.auto_control_sessions WHERE id=ids[1] RETURNING id INTO native_id;
  ASSERT NOT public.aka_agent_control_web_device_release(0,actor.organization_id,ids[1]);
  ASSERT NOT public.aka_agent_control_web_device_release(actor.id,0,ids[1]);
  ASSERT NOT public.aka_agent_control_web_device_release(actor.id,actor.organization_id,native_id);
  ASSERT public.aka_agent_control_web_device_release(actor.id,actor.organization_id,ids[1]);
  ASSERT public.aka_agent_control_web_device_release(actor.id,actor.organization_id,ids[1]);
  ASSERT (public.aka_agent_control_web_device_overview(actor.id,actor.organization_id,ids[1])->'quota'->>'used')::int=2;
  ASSERT (SELECT count(*)=2 FROM public.auto_control_sessions WHERE id IN (ids[1],sibling)
    AND web_device_id=device AND web_device_revision IS NULL AND web_device_registered_at IS NULL AND revoked_at IS NULL);
  ASSERT EXISTS(SELECT 1 FROM public.auto_control_sessions WHERE id=native_id AND web_device_revision IS NOT NULL AND revoked_at IS NULL);
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='authenticated';
  ASSERT (public.aka_agent_control_web_device_overview(actor.id,actor.organization_id,ids[1])->'quota'->>'used')::int=2;
  v:=public.aka_agent_control_web_device_claim(actor.id,actor.organization_id,ids[1],NULL,NULL,NULL,NULL,NULL);
  ASSERT v->>'status'='admitted' AND (v->>'deviceId')::uuid=device;
  ASSERT (v->'quota'->>'used')::int=3;
  ASSERT public.aka_agent_control_web_device_release(actor.id,actor.organization_id,sibling);
  v:=public.aka_agent_control_web_device_claim(actor.id,actor.organization_id,NULL,NULL,
    md5(nonce||'replacement')||md5(nonce||'replacement2'),'pwa','v332 rollback smoke',now()+interval '1 hour');
  replacement:=(v->'session'->>'id')::uuid;
  ASSERT v->>'status'='admitted' AND (v->'quota'->>'used')::int=3;
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='authenticated';
  v:=public.aka_agent_control_web_device_claim(actor.id,actor.organization_id,ids[1],NULL,NULL,NULL,NULL,NULL);
  ASSERT v->>'status'='limit_reached';
  ASSERT public.aka_agent_authenticate_control_session(token)->>'status'='invalid_session';
  ASSERT (SELECT count(*)=2 FROM public.auto_control_sessions WHERE id IN (ids[1],sibling) AND revoked_at IS NOT NULL);
  ASSERT public.aka_agent_control_web_device_revoke(actor.id,actor.organization_id,replacement);
  ASSERT NOT public.aka_agent_control_web_device_release(actor.id,actor.organization_id,replacement);
END;
$smoke$;
SELECT 'v332 release/auth/re-entry/native/tenant/revoke smoke passed; rollback follows' AS result;
ROLLBACK;
