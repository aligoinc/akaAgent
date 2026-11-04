BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';
DO $check$
DECLARE n public.auto_accounts%ROWTYPE; o public.auto_accounts%ROWTYPE; allowed boolean; tested integer:=0; caller_name text;
BEGIN
 FOR n IN SELECT * FROM auto_accounts WHERE id IN (2666,3359,4949,4992,4993,4994,7025) ORDER BY id LOOP
  o:=n; o.is_akachat_enabled:=false; allowed:=true;
  BEGIN PERFORM private.app_access_validate_account(n,o);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'app_access_denied' THEN RAISE; END IF; allowed:=false;
  END;
  IF allowed IS DISTINCT FROM n.is_zalo_server THEN RAISE EXCEPTION 'Unexpected grant result for %',n.id; END IF;
  IF NOT public.aka_agent_app_access_account_allowed(n.id,'akaChat') OR public.aka_agent_app_access_account_allowed(n.id,'akaAgent')
    OR public.aka_agent_app_access_staff_allowed(n.staff_id,'akaChat') OR public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent')
    THEN RAISE EXCEPTION 'Existing account/staff rights changed for %',n.id; END IF;
  tested:=tested+1;
 END LOOP;
 IF tested<>7 THEN RAISE EXCEPTION 'Expected seven probes'; END IF;
 FOREACH caller_name IN ARRAY ARRAY['service_role','aka_agent_chat_api','aka_agent_desktop','anon','authenticated'] LOOP
  IF has_function_privilege(caller_name,'private.app_access_validate_account(auto_accounts,auto_accounts)','EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected private execute grant to %',caller_name; END IF;
 END LOOP;
 FOREACH caller_name IN ARRAY ARRAY['service_role','aka_agent_chat_api','aka_agent_desktop'] LOOP
  IF NOT has_function_privilege(caller_name,'public.aka_agent_app_access(bigint,text,text,text,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'Missing public entrypoint for %',caller_name; END IF;
 END LOOP;
END $check$;
SELECT jsonb_build_object('composite_probes_passed',7,'server_grant_allowed',6,'local_qr_denied',1,
 'v447_enabled',private.app_access_policy_enabled(),
 'accounts',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'owner_active',s.is_active,'chat_allowed',public.aka_agent_app_access_account_allowed(a.id,'akaChat'),
   'agent_allowed',public.aka_agent_app_access_account_allowed(a.id,'akaAgent')) ORDER BY a.id)
   FROM auto_accounts a JOIN org_staff s ON s.id=a.staff_id WHERE a.id IN (2666,3359,4949,4992,4993,4994,7025))) verification;
ROLLBACK;
