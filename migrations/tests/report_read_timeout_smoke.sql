-- Execute inside a BEGIN/ROLLBACK transaction. No customer rows are changed.
DO $fixture$
DECLARE v record; v_main bigint; v_sub bigint;
BEGIN
  SELECT a.id,a.staff_id,a.organization_id,s.username,s.password INTO STRICT v
  FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id AND s.organization_id=a.organization_id
  WHERE a.is_delete=false AND s.is_active=true AND s.username IS NOT NULL AND s.password IS NOT NULL
  ORDER BY a.id LIMIT 1;
  PERFORM set_config('report.smoke.account',v.id::text,true),set_config('report.smoke.staff',v.staff_id::text,true),
    set_config('report.smoke.org',v.organization_id::text,true),set_config('report.smoke.username',v.username,true),
    set_config('report.smoke.password',v.password,true);
  SELECT id INTO STRICT v_main FROM public.auto_status WHERE component_type='campaign_detail' ORDER BY id LIMIT 1;
  SELECT id INTO STRICT v_sub FROM public.auto_status WHERE component_type='campaign_detail' AND id<>v_main ORDER BY id LIMIT 1;
  PERFORM set_config('report.smoke.main',v_main::text,true),set_config('report.smoke.sub',v_sub::text,true);
  INSERT INTO public.auto_campaigns(id,name,status,staff_id,organization_id,account_id,schedule,is_delete) OVERRIDING SYSTEM VALUE
  VALUES (-2147000000,'Report SQL smoke','tạm dừng',v.staff_id,v.organization_id,v.id,'2029-01-01',false),
    (-2146999999,'Report SQL smoke old','tạm dừng',v.staff_id,v.organization_id,v.id,'2020-01-01',false);
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,is_delete,name,schedule)
    SELECT -2147000000+i,-2147000000,'chờ xử lý',false,'Input '||i,NULL FROM generate_series(0,1001) i;
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,is_delete,name,schedule) VALUES
    (-2146998000,-2146999999,'chờ xử lý',false,'Own schedule','2029-01-01'),
    (-2146997999,-2146999999,'chờ xử lý',false,'Old fallback',NULL),
    (-2146997998,-2147000000,'chờ xử lý',false,'End boundary','2029-01-02');
  INSERT INTO public.auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,status_id,report_group,is_delete,created_at)
    SELECT -2147000000+i,-2147000000,v.id,'zalo_message_stranger','Fixture',E'legacy\n\r\t"\\n',NULL,NULL,false,'2029-01-01 00:00:00.123456+00' FROM generate_series(0,1001) i;
  INSERT INTO public.auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,status_id,sub_status_id,report_group,input_data_id,is_delete,created_at) VALUES
    (-2146998000,-2147000000,v.id,'zalo_message_stranger','Fixture','pending',v_main,NULL,'pending',-2147000000,false,'2029-01-01'),
    (-2146997999,-2147000000,v.id,'zalo_message_stranger','Fixture','custom',v_main,v_sub,'success',NULL,false,'2029-01-01'),
    (-2146997998,-2147000000,v.id,'zalo_message_stranger','Fixture','custom secondary',v_sub,v_main,'failure',NULL,false,'2029-01-01'),
    (-2146997997,-2147000000,v.id,'zalo_message_stranger','Fixture','boundary',v_main,NULL,'success',NULL,false,'2029-01-02');
END;
$fixture$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
DO $smoke$
DECLARE
  a bigint:=current_setting('report.smoke.account')::bigint;
  s bigint:=current_setting('report.smoke.staff')::bigint;
  o bigint:=current_setting('report.smoke.org')::bigint;
  u text:=current_setting('report.smoke.username');
  p text:=current_setting('report.smoke.password');
  m bigint:=current_setting('report.smoke.main')::bigint;
  q jsonb; r jsonb; first_page jsonb; last_row jsonb;
BEGIN
  q:=jsonb_build_object('source','results','view','summary','accountIds',jsonb_build_array(a),
    'campaignIds',jsonb_build_array(-2147000000,-2146999999),'actionCodes',jsonb_build_array('zalo_message_stranger'),
    'startIso','2029-01-01T00:00:00Z','endIso','2029-01-02T00:00:00Z','limit',1000,'count',true);
  r:=public.aka_agent_read_report_page(s,o,u,p,q);
  IF (r->>'count')::int<>1005 OR jsonb_array_length(r->'rows')<>1000 THEN RAISE EXCEPTION 'summary_count: %',r->>'count'; END IF;
  first_page:=r; last_row:=r->'rows'->999;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('afterCreatedAt',last_row->>'created_at','afterId',last_row->>'id'));
  IF jsonb_array_length(r->'rows')<>5 OR EXISTS (SELECT 1 FROM jsonb_array_elements(first_page->'rows') x
    JOIN jsonb_array_elements(r->'rows') y ON x->>'id'=y->>'id') THEN RAISE EXCEPTION 'microsecond_summary_cursor'; END IF;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('view','details','filter',jsonb_build_object('kind','status','statusId',m)));
  IF (r->>'count')::int<>1 OR r#>>'{rows,0,main_status,name}' IS NULL OR r#>>'{rows,0,sub_status,name}' IS NULL THEN RAISE EXCEPTION 'main_only_or_pending_exclusion'; END IF;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('view','details','filter',jsonb_build_object('kind','legacy','status',E'legacy\n\r\t"\\n'),'offset',1000));
  IF (r->>'count')::int<>1002 OR jsonb_array_length(r->'rows')<>2 THEN RAISE EXCEPTION 'legacy_exact_or_page'; END IF;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('source','pending','ownSchedule',false));
  IF (r->>'count')::int<>1002 THEN RAISE EXCEPTION 'pending_fallback'; END IF;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('source','pending','ownSchedule',true));
  IF (r->>'count')::int<>1 THEN RAISE EXCEPTION 'pending_own_or_boundary'; END IF;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('source','pending','view','details','head',true));
  IF (r->>'count')::int<>1002 OR jsonb_array_length(r->'rows')<>0 THEN RAISE EXCEPTION 'pending_dedup_count'; END IF;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('source','pending','view','details'));
  first_page:=r; last_row:=r->'rows'->999;
  r:=public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('source','pending','view','details','afterCampaignId',last_row->>'campaign_id','afterId',last_row->>'id'));
  IF jsonb_array_length(r->'rows')<>2 OR EXISTS (SELECT 1 FROM jsonb_array_elements(first_page->'rows') x
    JOIN jsonb_array_elements(r->'rows') y ON x->>'id'=y->>'id') THEN RAISE EXCEPTION 'pending_cursor'; END IF;
  BEGIN
    PERFORM public.aka_agent_read_report_page(s,o,u,'wrong',q); RAISE EXCEPTION 'bad_password_accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='bad_password_accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('accountIds',jsonb_build_array(-1))); RAISE EXCEPTION 'foreign_account_accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('campaignIds',jsonb_build_array(-1))); RAISE EXCEPTION 'foreign_campaign_accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.aka_agent_read_report_page(s,o,u,p,q||jsonb_build_object('limit',1001)); RAISE EXCEPTION 'unbounded_page';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$smoke$;
RESET ROLE;
SELECT jsonb_build_object('ok',true,'checks',14,'identity',md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))),
 'reader',md5(pg_get_functiondef(to_regprocedure('public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb)')))) AS report_smoke;
