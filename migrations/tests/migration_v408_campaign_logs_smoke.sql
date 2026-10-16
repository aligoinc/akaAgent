-- Always ROLLBACK. Credentials stay inside this transaction and never leave SQL.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
DO $smoke$
DECLARE v record; before_row jsonb; after_row jsonb; first_page jsonb; next_page jsonb;
  fresh jsonb; result jsonb; first_id text; upper_id text; old_count bigint; role_name text;
  access jsonb:='{"facebookCore":true,"facebookFanpage":true,"zalo":true,"email":true,"sms":true,"qr":true,"web":true,"server":true}';
BEGIN
 SELECT c.id,c.staff_id,c.organization_id,s.username,s.password,a.flatform_type
 INTO STRICT v FROM public.auto_campaigns c JOIN public.org_staff s ON s.id=c.staff_id
 JOIN public.auto_accounts a ON a.id=c.account_id
 WHERE c.status='tạm dừng' AND NOT c.is_delete AND NOT a.is_delete AND s.is_active
  AND c.organization_id=s.organization_id AND a.organization_id=s.organization_id AND a.staff_id=s.id
  AND a.flatform_type IN ('facebook','zalo','email') AND s.username IS NOT NULL AND s.password IS NOT NULL
 ORDER BY c.id DESC LIMIT 1;
 PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:'||v.id::text,0));
 SELECT to_jsonb(c) INTO before_row FROM public.auto_campaigns c WHERE id=v.id;
 SELECT count(*) INTO old_count FROM public.auto_campaign_logs WHERE campaign_id=v.id;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','aka_agent_chat_api'] LOOP
  IF has_table_privilege(role_name,'public.auto_campaign_logs','SELECT') OR has_table_privilege(role_name,'public.auto_campaign_logs','INSERT')
    OR has_table_privilege(role_name,'public.auto_campaign_logs','UPDATE') OR has_table_privilege(role_name,'public.auto_campaign_logs','DELETE')
    OR NOT has_function_privilege(role_name,'public.append_auto_campaign_log(bigint,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION 'incorrect log ACL for %',role_name;
  END IF;
  -- Managed Supabase postgres cannot SET ROLE aka_agent_chat_api. Its grants
  -- are checked here; actual role execution is covered by the isolated PG test.
  IF role_name<>'aka_agent_chat_api' THEN PERFORM set_config('role',role_name,true); END IF;
  PERFORM public.append_auto_campaign_log(v.id,v.staff_id,'V408 rollback fixture 😀'||E'\n'||'continued <!-- screenshotEventId:91 -->');
  PERFORM set_config('role','postgres',true);
 END LOOP;
 PERFORM public.append_auto_campaign_log(v.id,v.staff_id,repeat('😀',20000));
 IF (SELECT char_length(log) FROM public.auto_campaign_logs WHERE campaign_id=v.id ORDER BY id DESC LIMIT 1)<>16000 THEN RAISE EXCEPTION 'UTF8 cap'; END IF;
 FOR i IN 1..105 LOOP PERFORM public.append_auto_campaign_log(v.id,v.staff_id,'V408 rollback entry '||i); END LOOP;
 IF (SELECT count(*) FROM public.auto_campaign_logs WHERE campaign_id=v.id)<>old_count+110 THEN RAISE EXCEPTION 'lost append'; END IF;
 SELECT to_jsonb(c) INTO after_row FROM public.auto_campaigns c WHERE id=v.id;
 IF before_row IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'campaign changed by append'; END IF;
 first_page:=public.aka_agent_desktop_campaign_logs(v.staff_id,v.organization_id,v.username,v.password,access,v.id,'{"limit":100}');
 IF jsonb_array_length(first_page->'items')<>100 OR NOT (first_page->>'hasMore')::boolean OR jsonb_typeof(first_page->'items'->0->'id')<>'string' THEN RAISE EXCEPTION 'initial page'; END IF;
 first_id:=first_page->'items'->0->>'id';
 next_page:=public.aka_agent_desktop_campaign_logs(v.staff_id,v.organization_id,v.username,v.password,access,v.id,jsonb_build_object('beforeId',first_page->>'nextCursor','limit',100));
 IF (next_page->'items'->0->>'id')::bigint >= (first_page->>'nextCursor')::bigint THEN RAISE EXCEPTION 'older cursor'; END IF;
 PERFORM public.append_auto_campaign_log(v.id,v.staff_id,'V408 new A');
 PERFORM public.append_auto_campaign_log(v.id,v.staff_id,'V408 new B');
 fresh:=public.aka_agent_desktop_campaign_logs(v.staff_id,v.organization_id,v.username,v.password,access,v.id,jsonb_build_object('afterId',first_id,'limit',1));
 upper_id:=fresh->>'throughId';
 PERFORM public.append_auto_campaign_log(v.id,v.staff_id,'V408 new C beyond snapshot');
 fresh:=public.aka_agent_desktop_campaign_logs(v.staff_id,v.organization_id,v.username,v.password,access,v.id,jsonb_build_object('afterId',fresh->>'nextCursor','throughId',upper_id,'limit',1));
 IF fresh->>'hasMore'<>'false' OR fresh->'items'->0->>'log'<>'V408 new B' THEN RAISE EXCEPTION 'bounded refresh cursor'; END IF;
 result:=public.aka_agent_desktop_campaign_detail(v.staff_id,v.organization_id,v.username,v.password,access,v.id,'log',NULL);
 IF position('V408 new C beyond snapshot' in result->>'log')=0 OR octet_length(result->>'log')>262144 THEN RAISE EXCEPTION 'legacy tail'; END IF;
 result:=public.aka_agent_campaign_diagnostics_evidence(v.staff_id,v.organization_id,v.id,v.username,v.password);
 IF jsonb_array_length(result->'campaignHistory')<>30 OR result->'campaignHistory'->>0<>'V408 new C beyond snapshot' THEN RAISE EXCEPTION 'diagnostics new source'; END IF;
 IF public.aka_agent_desktop_campaign_logs(v.staff_id,v.organization_id,v.username,v.password,'{}',v.id) IS NOT NULL THEN RAISE EXCEPTION 'platform access'; END IF;
 IF public.aka_agent_control_campaign_logs(v.staff_id+1,v.organization_id,v.id,ARRAY[v.flatform_type]) IS NOT NULL
  OR public.aka_agent_control_campaign_logs(v.staff_id,v.organization_id+1,v.id,ARRAY[v.flatform_type]) IS NOT NULL THEN RAISE EXCEPTION 'tenant access'; END IF;
 BEGIN
  PERFORM public.append_auto_campaign_log(v.id,v.staff_id+1,'must fail'); RAISE EXCEPTION 'wrong staff accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='wrong staff accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.aka_agent_desktop_campaign_logs(v.staff_id,v.organization_id,v.username,'wrong-password',access,v.id); RAISE EXCEPTION 'wrong password accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='wrong password accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.append_auto_campaign_log(v.id,v.staff_id,'subtransaction rollback'); RAISE EXCEPTION 'rollback fixture';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'rollback fixture' THEN RAISE; END IF; END;
 IF EXISTS (SELECT 1 FROM public.auto_campaign_logs WHERE campaign_id=v.id AND log='subtransaction rollback') THEN RAISE EXCEPTION 'rollback leaked'; END IF;
END $smoke$;
SELECT 'V408 live transaction smoke passed; all fixture entries rolled back' AS result;
ROLLBACK;
