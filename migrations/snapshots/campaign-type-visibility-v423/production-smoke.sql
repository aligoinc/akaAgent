BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='5s'; SET LOCAL request.jwt.claim.role='service_role';
CREATE TEMP TABLE visibility_smoke_scope ON COMMIT DROP AS
SELECT s.id,s.organization_id FROM public.org_staff s WHERE s.is_admin IS TRUE AND s.is_active AND s.deleted_at IS NULL AND public.aka_agent_staff_time_allowed(s.id)
AND EXISTS(SELECT 1 FROM public.org_staff v WHERE v.organization_id=s.organization_id AND v.is_admin IS DISTINCT FROM true AND v.is_active AND v.deleted_at IS NULL AND public.aka_agent_staff_time_allowed(v.id))
AND EXISTS(SELECT 1 FROM public.auto_campaigns c WHERE c.staff_id=s.id AND c.organization_id=s.organization_id AND NOT c.is_delete)
ORDER BY s.id LIMIT 1;
CREATE TEMP TABLE visibility_smoke_baseline ON COMMIT DROP AS
SELECT public.aka_agent_desktop_campaign_page(id,organization_id,NULL,NULL,'{"facebookCore":true,"facebookFanpage":true,"zalo":true,"sms":true,"email":true,"qr":true,"web":true,"server":true}') AS desktop,
public.aka_agent_control_campaign_page(id,organization_id,ARRAY['zalo','sms']) AS web FROM visibility_smoke_scope;
CREATE TEMP TABLE visibility_smoke_results(checks integer,elapsed_ms bigint) ON COMMIT DROP;
DO $metadata$ BEGIN
IF (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile) FROM pg_proc p WHERE p.oid=to_regprocedure('private.aka_agent_campaign_visibility_snapshot(bigint,bigint)')) IS DISTINCT FROM '{"owner":"postgres","proacl":"{postgres=X/postgres,service_role=X/postgres}","checksum":"fd44617ea1d6c9fd9186e6090d796bb7","proconfig":["search_path=pg_catalog, public"],"prosecdef":true,"provolatile":"s"}'::jsonb THEN RAISE EXCEPTION 'target metadata mismatch: private.aka_agent_campaign_visibility_snapshot(bigint,bigint)'; END IF;
IF (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile) FROM pg_proc p WHERE p.oid=to_regprocedure('private.aka_agent_campaign_visibility_actions(jsonb,text)')) IS DISTINCT FROM '{"owner":"postgres","proacl":"{postgres=X/postgres}","checksum":"6960198a9816d8e3cce62dae28568b5a","proconfig":["search_path=pg_catalog, public"],"prosecdef":true,"provolatile":"s"}'::jsonb THEN RAISE EXCEPTION 'target metadata mismatch: private.aka_agent_campaign_visibility_actions(jsonb,text)'; END IF;
IF (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile) FROM pg_proc p WHERE p.oid=to_regprocedure('private.aka_agent_campaign_type_visibility(bigint,bigint,jsonb,text,text,jsonb,boolean)')) IS DISTINCT FROM '{"owner":"postgres","proacl":"{postgres=X/postgres}","checksum":"9d00adbc6d496c67155cf4f92aaca063","proconfig":["search_path=pg_catalog, public","statement_timeout=10s","lock_timeout=5s"],"prosecdef":true,"provolatile":"v"}'::jsonb THEN RAISE EXCEPTION 'target metadata mismatch: private.aka_agent_campaign_type_visibility(bigint,bigint,jsonb,text,text,jsonb,boolean)'; END IF;
IF (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile) FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_campaign_type_visibility(bigint,bigint,text,text,jsonb,text,jsonb,boolean)')) IS DISTINCT FROM '{"owner":"postgres","proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}","checksum":"a00e37f313f156db71971e29aaf25e3e","proconfig":["search_path=pg_catalog, public","statement_timeout=10s","lock_timeout=5s"],"prosecdef":true,"provolatile":"v"}'::jsonb THEN RAISE EXCEPTION 'target metadata mismatch: aka_agent_campaign_type_visibility(bigint,bigint,text,text,jsonb,text,jsonb,boolean)'; END IF;
IF (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile) FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)')) IS DISTINCT FROM '{"owner":"postgres","proacl":"{postgres=X/postgres,service_role=X/postgres}","checksum":"38cef8f7febb9b4e2147a0b9b99c2898","proconfig":["search_path=pg_catalog, public","statement_timeout=10s","lock_timeout=5s"],"prosecdef":true,"provolatile":"v"}'::jsonb THEN RAISE EXCEPTION 'target metadata mismatch: aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)'; END IF;
IF (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile) FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])')) IS DISTINCT FROM '{"owner":"postgres","proacl":"{postgres=X/postgres,service_role=X/postgres}","checksum":"12d454fbc38217dea3497addd39ed832","proconfig":["search_path=public, pg_temp","statement_timeout=20s"],"prosecdef":false,"provolatile":"s"}'::jsonb THEN RAISE EXCEPTION 'target metadata mismatch: aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'; END IF;
IF (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile) FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])')) IS DISTINCT FROM '{"owner":"postgres","proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}","checksum":"3a16a880e5906c7d4a55b19f8b4c13c7","proconfig":["search_path=pg_catalog, public","statement_timeout=60s"],"prosecdef":true,"provolatile":"s"}'::jsonb THEN RAISE EXCEPTION 'target metadata mismatch: aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'; END IF;
END; $metadata$;
-- Run only inside a transaction ending in ROLLBACK; all preference writes are temporary.
-- The caller captures legacy reader results before this script (before the candidate on dry-run).
DO $smoke$
DECLARE
  a record; other_org bigint; viewer bigint; v jsonb; d jsonb; w jsonb;
  old_d jsonb; old_w jsonb; access jsonb := '{"facebookCore":true,"facebookFanpage":true,"zalo":true,"sms":true,"email":true,"qr":true,"web":true,"server":true}';
  role_name text; action record; expected bigint; n integer := 0; started timestamptz := clock_timestamp();
  anchors jsonb := '[{"id":"visibility-hidden-draft","actionId":"zalo_message_phone","schedule":"2026-01-01"},{"id":"visibility-visible-draft","actionId":"sms_send","schedule":"2026-01-01"}]';
BEGIN
  SELECT * INTO STRICT a FROM visibility_smoke_scope;
  SELECT desktop,web INTO old_d,old_w FROM visibility_smoke_baseline;
  SELECT id INTO STRICT viewer FROM public.org_staff WHERE organization_id=a.organization_id AND is_admin IS DISTINCT FROM true AND is_active AND deleted_at IS NULL AND public.aka_agent_staff_time_allowed(id) ORDER BY id LIMIT 1;
  SELECT organization_id INTO STRICT other_org FROM public.org_staff WHERE organization_id<>a.organization_id AND is_active AND deleted_at IS NULL AND public.aka_agent_staff_time_allowed(id) ORDER BY id LIMIT 1;
  IF (SELECT count(*) FROM public.auto_campaign_type_visibility)<>0 THEN RAISE EXCEPTION 'smoke expects fresh visibility table'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.auto_campaign_type_visibility'::regclass) THEN RAISE EXCEPTION 'RLS missing'; END IF;
  n:=n+1;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(role_name,'public.auto_campaign_type_visibility','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'unexpected direct table grant for %',role_name; END IF;
  END LOOP;
  n:=n+1;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(role_name,'public.aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)','EXECUTE') THEN RAISE EXCEPTION 'public Web RPC privilege'; END IF;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I',role_name);
      PERFORM public.aka_agent_control_campaign_type_visibility(a.id,a.organization_id,ARRAY['sms'],'patch','[{"actionId":"sms_send","visible":false}]');
      RAISE EXCEPTION 'anonymous Web write accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  n:=n+1;
  IF NOT has_function_privilege('service_role','public.aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)','EXECUTE') THEN RAISE EXCEPTION 'service Web grant missing'; END IF;
  SET LOCAL ROLE service_role;
  v:=public.aka_agent_control_campaign_type_visibility(a.id,a.organization_id,ARRAY['zalo','sms'],'get','[]',true);
  RESET ROLE;
  IF v->'hiddenActionIds'<>'[]'::jsonb OR (v->>'revision')::bigint<>0 OR v->>'canEdit'<>'true' THEN RAISE EXCEPTION 'default/admin snapshot incorrect'; END IF;
  n:=n+1;
  FOR action IN SELECT * FROM jsonb_to_recordset(v->'catalog') AS x(id text,platform text,"campaignCount" bigint) LOOP
    IF action.platform NOT IN ('zalo','sms') THEN RAISE EXCEPTION 'Web catalog scope'; END IF;
    SELECT count(*) INTO expected FROM public.auto_campaigns c JOIN public.auto_accounts account ON account.id=c.account_id AND account.staff_id=a.id AND account.organization_id=a.organization_id
      WHERE c.staff_id=a.id AND c.organization_id=a.organization_id AND c.is_delete=false AND c.action_id=action.id
      AND (account.flatform_type='sms' OR (account.flatform_type='zalo' AND account.is_zalo_show_web=false AND account.is_zalo_server=true));
    IF action."campaignCount"<>expected THEN RAISE EXCEPTION 'Web count mismatch'; END IF;
  END LOOP;
  n:=n+1;
  v:=public.aka_agent_campaign_type_visibility(a.id,a.organization_id,NULL,NULL,access,'get','[]',true);
  FOR action IN SELECT * FROM jsonb_to_recordset(v->'catalog') AS x(id text,"campaignCount" bigint) LOOP
    SELECT count(*) INTO expected FROM public.auto_campaigns c JOIN public.auto_accounts account ON account.id=c.account_id AND account.staff_id=a.id AND account.organization_id=a.organization_id
      WHERE c.staff_id=a.id AND c.organization_id=a.organization_id AND c.is_delete=false AND c.action_id=action.id;
    IF action."campaignCount"<>expected THEN RAISE EXCEPTION 'Desktop count mismatch'; END IF;
  END LOOP;
  n:=n+1;
  v:=public.aka_agent_control_campaign_type_visibility(viewer,a.organization_id,ARRAY['zalo','sms']);
  IF v->>'canEdit'<>'false' THEN RAISE EXCEPTION 'viewer can edit'; END IF;
  BEGIN
    PERFORM public.aka_agent_control_campaign_type_visibility(viewer,a.organization_id,ARRAY['sms'],'patch','[{"actionId":"sms_send","visible":false}]');
    RAISE EXCEPTION 'viewer write accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'visibility_access_denied' THEN RAISE; END IF;
  END;
  n:=n+1;
  BEGIN
    PERFORM public.aka_agent_control_campaign_type_visibility(a.id,other_org,ARRAY['sms']);
    RAISE EXCEPTION 'cross tenant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'visibility_access_denied' THEN RAISE; END IF;
  END;
  n:=n+1;
  BEGIN
    PERFORM set_config('request.jwt.claim.role','anon',true);
    SET LOCAL ROLE anon;
    PERFORM public.aka_agent_campaign_type_visibility(a.id,a.organization_id,NULL,NULL,access);
    RAISE EXCEPTION 'missing Desktop credentials accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  n:=n+1;
  BEGIN
    PERFORM public.aka_agent_control_campaign_type_visibility(a.id,a.organization_id,ARRAY['zalo','sms'],'patch','[{"actionId":"not_a_campaign_action","visible":false}]');
    RAISE EXCEPTION 'invalid action accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'visibility_invalid_action' THEN RAISE; END IF;
  END;
  n:=n+1;
  BEGIN
    PERFORM public.aka_agent_control_campaign_type_visibility(a.id,a.organization_id,ARRAY['zalo','sms'],'patch','[{"actionId":"facebook_group_post","visible":false}]');
    RAISE EXCEPTION 'Web changed Facebook';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'visibility_invalid_action' THEN RAISE; END IF;
  END;
  n:=n+1;
  v:=public.aka_agent_campaign_type_visibility(a.id,a.organization_id,NULL,NULL,access,'patch','[{"actionId":"facebook_group_post","visible":false},{"actionId":"zalo_message_phone","visible":false}]');
  IF v->'hiddenActionIds'<>'["facebook_group_post","zalo_message_phone"]'::jsonb OR (v->>'revision')::bigint<>1 THEN RAISE EXCEPTION 'Desktop patch incorrect'; END IF;
  n:=n+1;
  IF public.aka_agent_desktop_campaign_page(a.id,a.organization_id,NULL,NULL,access)<>old_d OR public.aka_agent_control_campaign_page(a.id,a.organization_id,ARRAY['zalo','sms'])<>old_w THEN RAISE EXCEPTION 'legacy reader regression'; END IF;
  n:=n+1;
  d:=public.aka_agent_desktop_campaign_page(a.id,a.organization_id,NULL,NULL,access,'{"applyDisplaySettings":true}',1,anchors);
  w:=public.aka_agent_control_campaign_page(a.id,a.organization_id,ARRAY['zalo','sms'],'{"applyDisplaySettings":true}',1,anchors);
  IF d->'displaySettings'<>v OR w->'displaySettings'<>v OR (d->>'total')::bigint<>(d->>'campaignTotal')::bigint+1 OR (w->>'total')::bigint<>(w->>'campaignTotal')::bigint+1 THEN RAISE EXCEPTION 'snapshot/draft totals'; END IF;
  n:=n+1;
  SELECT count(*) INTO expected FROM public.auto_campaigns c JOIN public.auto_accounts account ON account.id=c.account_id AND account.staff_id=a.id AND account.organization_id=a.organization_id
    WHERE c.staff_id=a.id AND c.organization_id=a.organization_id AND NOT c.is_delete AND c.action_id NOT IN ('facebook_group_post','zalo_message_phone') AND account.flatform_type IN ('zalo','sms')
    AND (account.flatform_type='sms' OR (account.flatform_type='zalo' AND account.is_zalo_show_web=false AND account.is_zalo_server=true));
  IF (w->>'campaignTotal')::bigint<>expected THEN RAISE EXCEPTION 'filtered total incorrect'; END IF;
  n:=n+1;
  w:=public.aka_agent_control_campaign_page(a.id,a.organization_id,ARRAY['zalo','sms'],'{"applyDisplaySettings":true}',1,'[]',NULL,true);
  d:=public.aka_agent_desktop_campaign_page(a.id,a.organization_id,NULL,NULL,access,'{"applyDisplaySettings":true}',1,'[]',NULL,true);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(w->'items') item JOIN public.auto_campaigns c ON c.id=(item->>'id')::bigint WHERE c.action_id IN ('facebook_group_post','zalo_message_phone')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'items') item JOIN public.auto_campaigns c ON c.id=(item->>'id')::bigint WHERE c.action_id IN ('facebook_group_post','zalo_message_phone')) THEN RAISE EXCEPTION 'selection includes hidden action'; END IF;
  n:=n+1;
  SET LOCAL ROLE service_role;
  v:=public.aka_agent_control_campaign_type_visibility(a.id,a.organization_id,ARRAY['zalo','sms'],'patch','[{"actionId":"zalo_message_phone","visible":true},{"actionId":"sms_send","visible":true}]');
  RESET ROLE;
  IF v->'hiddenActionIds'<>'["facebook_group_post"]'::jsonb OR (v->>'revision')::bigint<>2 THEN RAISE EXCEPTION 'Web reset lost Facebook'; END IF;
  n:=n+1;
  IF EXISTS(SELECT 1 FROM public.auto_campaign_type_visibility WHERE organization_id<>a.organization_id) THEN RAISE EXCEPTION 'other tenant modified'; END IF;
  IF public.aka_agent_desktop_campaign_page(a.id,a.organization_id,NULL,NULL,access)<>old_d OR public.aka_agent_control_campaign_page(a.id,a.organization_id,ARRAY['zalo','sms'])<>old_w THEN RAISE EXCEPTION 'campaign/runtime baseline changed'; END IF;
  n:=n+1;
  INSERT INTO visibility_smoke_results VALUES (n,round(extract(epoch FROM clock_timestamp()-started)*1000));
END;
$smoke$;

ROLLBACK;
SELECT jsonb_build_object('checks',18,'targetMetadataChecks',7,'preferenceRowsAfterRollback',(SELECT count(*) FROM public.auto_campaign_type_visibility)) AS post_apply_smoke;
