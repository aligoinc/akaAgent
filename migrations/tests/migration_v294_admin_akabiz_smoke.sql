-- Run inside a transaction ending in ROLLBACK. No job/function under inspection is executed.
DO $smoke$
DECLARE
  a public.org_staff%ROWTYPE;
  b public.org_staff%ROWTYPE;
  s public.auto_system_settings%ROWTYPE;
  d jsonb; changed jsonb; result jsonb; old_version text; n integer;
BEGIN
  SELECT * INTO a FROM public.org_staff WHERE organization_id=1 AND is_admin IS TRUE AND is_active IS TRUE ORDER BY id LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'smoke_requires_existing_org1_admin'; END IF;
  BEGIN
    PERFORM public.aka_agent_admin_docs(a.id,a.username,'invalid-smoke-password','list');
    RAISE EXCEPTION 'smoke_invalid_password_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  UPDATE public.org_staff SET is_admin=false,is_admin_akabiz=true WHERE id=a.id;
  BEGIN
    PERFORM public.aka_agent_admin_docs(a.id,a.username,a.password,'list');
    RAISE EXCEPTION 'smoke_akabiz_flag_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.org_staff SET is_admin=NULL WHERE id=a.id;
  BEGIN
    PERFORM public.aka_agent_admin_cron(a.id,a.username,a.password,'jobs');
    RAISE EXCEPTION 'smoke_null_flag_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.org_staff SET is_admin=true,is_active=false WHERE id=a.id;
  BEGIN
    PERFORM public.aka_agent_admin_settings(a.id,a.username,a.password,'list');
    RAISE EXCEPTION 'smoke_inactive_staff_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.org_staff SET is_active=true WHERE id=a.id;
  SELECT * INTO b FROM public.org_staff WHERE organization_id<>1 AND is_active IS TRUE ORDER BY id LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'smoke_requires_other_org_staff'; END IF;
  UPDATE public.org_staff SET is_admin=true WHERE id=b.id;
  BEGIN
    PERFORM public.aka_agent_admin_notifications(b.id,b.username,b.password,'global');
    RAISE EXCEPTION 'smoke_other_org_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.org_staff SET organization_id=a.organization_id,is_admin=a.is_admin,is_admin_akabiz=a.is_admin_akabiz,is_active=a.is_active WHERE id=a.id;

  d := public.aka_agent_admin_docs(a.id,a.username,a.password,'save',jsonb_build_object('name','Admin smoke','url','https://example.com/docs','description','fixture','sort_order',17,'is_active',true));
  old_version := d->>'version';
  changed := public.aka_agent_admin_docs(a.id,a.username,a.password,'save',jsonb_build_object('id',d->'id','expected_version',old_version,'name','Admin smoke changed','url','https://example.com/v2','description','changed','sort_order',18,'is_active',false));
  IF changed->>'name'<>'Admin smoke changed' OR (changed->>'is_active')::boolean THEN RAISE EXCEPTION 'smoke_doc_save_failed'; END IF;
  BEGIN
    PERFORM public.aka_agent_admin_docs(a.id,a.username,a.password,'delete',jsonb_build_object('id',d->'id','expected_version',old_version));
    RAISE EXCEPTION 'smoke_stale_delete_was_allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'admin_conflict' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_admin_docs(a.id,a.username,a.password,'delete',jsonb_build_object('id',d->'id','expected_version',changed->>'version'));
  IF EXISTS (SELECT 1 FROM public.auto_admin_api_docs WHERE id=(d->>'id')::bigint) THEN RAISE EXCEPTION 'smoke_doc_delete_failed'; END IF;
  BEGIN
    PERFORM public.aka_agent_admin_docs(a.id,a.username,a.password,'save',jsonb_build_object('name','Invalid','url','javascript:alert(1)'));
    RAISE EXCEPTION 'smoke_invalid_url_was_allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;

  d := public.aka_agent_admin_notifications(a.id,a.username,a.password,'global');
  PERFORM public.aka_agent_admin_notifications(a.id,a.username,a.password,'save',jsonb_build_object('staff_id',NULL,'expected_version',d->>'version','raw_value','{"message":"__admin_smoke__","startsAt":"2999-01-01"}'));
  result := public.aka_agent_admin_notifications(a.id,a.username,a.password,'global');
  IF result->>'raw_value' NOT LIKE '%2999-01-01%' THEN RAISE EXCEPTION 'smoke_future_notice_not_editable'; END IF;
  PERFORM public.aka_agent_admin_notifications(a.id,a.username,a.password,'save',jsonb_build_object('staff_id',NULL,'expected_version',result->>'version','raw_value',''));
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key='app.notification' AND value='') THEN RAISE EXCEPTION 'smoke_global_clear_failed'; END IF;
  PERFORM public.aka_agent_admin_notifications(a.id,a.username,a.password,'save',jsonb_build_object('staff_id',a.id,'expected_version',md5(coalesce(a.app_notification,'')),'raw_value','__admin_smoke__'));
  result := public.aka_agent_admin_notifications(a.id,a.username,a.password,'search',jsonb_build_object('search',a.username));
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result) x WHERE (x->>'staff_id')::bigint=a.id AND x->>'raw_value'='__admin_smoke__') THEN RAISE EXCEPTION 'smoke_staff_search_failed'; END IF;
  BEGIN
    PERFORM public.aka_agent_admin_notifications(a.id,a.username,a.password,'save',jsonb_build_object('staff_id',a.id,'expected_version','stale','raw_value','wrong'));
    RAISE EXCEPTION 'smoke_stale_notification_was_allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'admin_conflict' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_admin_notifications(a.id,a.username,a.password,'save',jsonb_build_object('staff_id',a.id,'expected_version',md5('__admin_smoke__'),'raw_value',''));
  IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id=a.id AND app_notification='') THEN RAISE EXCEPTION 'smoke_staff_clear_failed'; END IF;

  SELECT * INTO s FROM public.auto_system_settings WHERE is_secret IS TRUE ORDER BY id LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'smoke_requires_secret_setting'; END IF;
  result := public.aka_agent_admin_settings(a.id,a.username,a.password,'list');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(result) x WHERE (x->>'is_secret')::boolean AND x->>'value' IS NOT NULL) THEN RAISE EXCEPTION 'smoke_secret_leaked'; END IF;
  d := public.aka_agent_admin_settings(a.id,a.username,a.password,'reveal',jsonb_build_object('id',s.id));
  IF d->>'value' IS DISTINCT FROM s.value THEN RAISE EXCEPTION 'smoke_reveal_failed'; END IF;
  PERFORM public.aka_agent_admin_settings(a.id,a.username,a.password,'save',jsonb_build_object('id',s.id,'expected_version',d->>'version','description','__admin_smoke__'));
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE id=s.id AND value IS NOT DISTINCT FROM s.value AND is_secret=s.is_secret AND is_active=s.is_active AND key=s.key) THEN RAISE EXCEPTION 'smoke_setting_preservation_failed'; END IF;
  BEGIN
    PERFORM public.aka_agent_admin_settings(a.id,a.username,a.password,'save',jsonb_build_object('id',s.id,'expected_version',d->>'version','value','stale'));
    RAISE EXCEPTION 'smoke_stale_setting_was_allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'admin_conflict' THEN RAISE; END IF; END;

  result := public.aka_agent_admin_cron(a.id,a.username,a.password,'jobs');
  SELECT count(*) INTO n FROM cron.job;
  IF jsonb_array_length(result->'items')<>n THEN RAISE EXCEPTION 'smoke_cron_jobs_failed'; END IF;
  result := public.aka_agent_admin_cron(a.id,a.username,a.password,'runs');
  IF jsonb_array_length(result->'items')>100 THEN RAISE EXCEPTION 'smoke_cron_page_unbounded'; END IF;
  IF result->>'next_cursor' IS NOT NULL THEN
    d := public.aka_agent_admin_cron(a.id,a.username,a.password,'runs',jsonb_build_object('cursor',result->>'next_cursor'));
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'items') x WHERE (x->>'id')::bigint >= (result->>'next_cursor')::bigint) THEN RAISE EXCEPTION 'smoke_cron_cursor_overlap'; END IF;
  END IF;
  IF jsonb_array_length(result->'items')>0 THEN
    d := public.aka_agent_admin_cron(a.id,a.username,a.password,'detail',jsonb_build_object('id',result->'items'->0->>'id'));
    IF NOT (d ? 'command' AND d ? 'return_message') THEN RAISE EXCEPTION 'smoke_cron_detail_failed'; END IF;
  END IF;
  BEGIN
    PERFORM public.aka_agent_admin_cron(a.id,a.username,a.password,'run');
    RAISE EXCEPTION 'smoke_cron_execute_was_allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'admin_invalid_action' THEN RAISE; END IF; END;
  result := public.aka_agent_admin_triggers(a.id,a.username,a.password,'list');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(result) x WHERE x ? 'function_body' OR x ? 'definition') THEN RAISE EXCEPTION 'smoke_trigger_body_loaded_eagerly'; END IF;
  IF jsonb_array_length(result)>0 THEN
    d := public.aka_agent_admin_triggers(a.id,a.username,a.password,'detail',jsonb_build_object('id',result->0->>'id'));
    IF coalesce(length(d->>'function_body'),0)=0 THEN RAISE EXCEPTION 'smoke_trigger_detail_failed'; END IF;
  END IF;
  IF has_table_privilege('anon','public.auto_admin_api_docs','SELECT') OR has_table_privilege('authenticated','public.auto_admin_api_docs','UPDATE')
    OR has_function_privilege('anon','public.aka_agent_admin_assert_access(bigint,text,text)','EXECUTE') THEN RAISE EXCEPTION 'smoke_acl_leak'; END IF;
END;
$smoke$;
