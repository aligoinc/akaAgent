-- Disposable local PostgreSQL only. Synthetic rows, all business writes roll back.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
SET LOCAL timezone='UTC';
DO $acl$
DECLARE signature text; denied_role text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.aka_agent_chat_aux_settings(text)','private.akamap_assert_data_group_identity(jsonb)',
    'public.akamap_data_group_types(jsonb)','public.akamap_create_data_group(jsonb)','public.akamap_list_data_groups(jsonb)',
    'public.akamap_list_data_group_datasets(jsonb)','public.akamap_ingest_data_group(jsonb)'] LOOP
    IF NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'missing backend %',signature; END IF;
    FOREACH denied_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api'] LOOP
      IF has_function_privilege(denied_role,signature,'EXECUTE') THEN RAISE EXCEPTION 'unexpected grant % %',denied_role,signature; END IF;
    END LOOP;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['public.aka_agent_chat_aux_settings(text)',
    'public.akamap_data_group_types(jsonb)','public.akamap_create_data_group(jsonb)'] LOOP
    IF NOT (SELECT proconfig @> ARRAY['statement_timeout=3s'] FROM pg_proc WHERE oid=signature::regprocedure)
    THEN RAISE EXCEPTION 'timeout drift %',signature; END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['public.akamap_list_data_groups(jsonb)',
    'public.akamap_list_data_group_datasets(jsonb)','public.akamap_ingest_data_group(jsonb)'] LOOP
    IF NOT (SELECT proconfig @> ARRAY['statement_timeout=60s'] FROM pg_proc WHERE oid=signature::regprocedure)
    THEN RAISE EXCEPTION 'timeout drift %',signature; END IF;
  END LOOP;
  IF NOT (SELECT proconfig @> ARRAY['statement_timeout=4s','lock_timeout=1s'] FROM pg_proc WHERE oid='public.aka_agent_record_account_log(jsonb,jsonb)'::regprocedure)
  THEN RAISE EXCEPTION 'timeout drift'; END IF;
END $acl$;
SELECT 'PASS new functions backend-only, original DB timeout budgets retained';

INSERT INTO org_organization(id,name,use_staff_expiration) VALUES(10,'HTTP fixture',false),(20,'Other fixture',false);
INSERT INTO org_staff(id,organization_id,username,password,is_active,is_policy_accepted,is_admin)
VALUES(1,10,'fixture','not-real',true,true,false),(2,10,'disabled','not-real',false,true,false);
INSERT INTO category_type(id,namespace,code,name) VALUES(100,'common','data_type','Data type');
INSERT INTO category_item(id,category_type_id,code,name,sort_order) VALUES(101,100,'phone','Số điện thoại',1),(102,100,'email','Email',2);
INSERT INTO auto_system_settings(id,key,value,is_active,is_secret,updated_at) VALUES
 (9001,'zalo.campaign_engagement.enabled','true',true,false,'2026-10-28T00:01:02.123456+07:00'),
 (9002,'zalo.campaign_engagement.flush_interval_seconds','5',true,false,'2026-10-28T00:01:02.123456+07:00'),
 (9003,'zalo.campaign_engagement.batch_size','100',false,false,now()),
 (9004,'zalo.campaign_engagement.tracking_window_hours','48',true,true,now()),
 (9005,'app.notification','{"message":"Fixture"}',true,true,'2026-10-28T00:01:02.123456+07:00'),
 (9006,'not.allowed','must-not-leak',true,false,now());

CREATE FUNCTION pg_temp.map_call(operation text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE result jsonb;
BEGIN
  CASE operation
    WHEN 'types' THEN SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM public.akamap_data_group_types(payload) r;
    WHEN 'list' THEN SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM public.akamap_list_data_groups(payload) r;
    WHEN 'datasets' THEN SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM public.akamap_list_data_group_datasets(payload) r;
    WHEN 'create' THEN result:=public.akamap_create_data_group(payload);
    WHEN 'ingest' THEN result:=public.akamap_ingest_data_group(payload);
    ELSE RAISE EXCEPTION 'fixture operation invalid';
  END CASE;
  RETURN result;
END $test$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $settings$
DECLARE actual jsonb; expected jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.key) INTO actual FROM public.aka_agent_chat_aux_settings('engagement') r;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.key) INTO expected FROM (
    SELECT id,key,value,updated_at,is_active,is_secret FROM public.auto_system_settings
    WHERE is_active AND NOT is_secret AND key IN ('zalo.campaign_engagement.enabled',
      'zalo.campaign_engagement.flush_interval_seconds','zalo.campaign_engagement.batch_size','zalo.campaign_engagement.tracking_window_hours') LIMIT 4
  ) r;
  IF actual IS DISTINCT FROM expected OR jsonb_array_length(actual)<>2
    OR actual->0->>'updated_at'<>'2026-10-27T17:01:02.123456+00:00' THEN RAISE EXCEPTION 'engagement response/time precision changed'; END IF;
  SELECT to_jsonb(r) INTO actual FROM public.aka_agent_chat_aux_settings('notification') r;
  IF actual->>'value'<>'{"message":"Fixture"}' OR actual->>'is_secret'<>'true' THEN
    RAISE EXCEPTION 'notice filter changed from the prior active-key query'; END IF;
  IF EXISTS(SELECT 1 FROM public.aka_agent_chat_aux_settings('not.allowed')) THEN RAISE EXCEPTION 'scope leak'; END IF;
END $settings$;
SELECT 'PASS settings filters, nulls and microsecond timestamp parity';

DO $map$
DECLARE
  identity jsonb := '{"p_staff_id":1,"p_organization_id":10,"p_auth_username":"fixture","p_auth_password":"not-real","_edge_ip_headers":{}}';
  payload jsonb; actual jsonb; expected jsonb; created jsonb; ingested jsonb; group_id bigint;
  operation text; bad jsonb; candidate_ip text; header_name text; ip_headers jsonb;
  original_headers text := '{"cf-connecting-ip":"203.0.113.200","x-forwarded-for":"203.0.113.200","cookie":"fixture-header"}';
BEGIN
  PERFORM set_config('request.headers',original_headers,true);
  -- Simulate a permitted Edge IP while preserving a denied original visitor.
  FOREACH candidate_ip IN ARRAY ARRAY['14.254.197.100','42.117.87.143',
    '::ffff:14.254.197.100','::ffff:42.117.87.143','::ffff:efe:c564','::ffff:2a75:578f',
    '14.254.197.100/32','42.117.87.143/32'] LOOP
    FOREACH header_name IN ARRAY ARRAY['cf-connecting-ip','x-real-ip','x-forwarded-for'] LOOP
      ip_headers := '{"cf-connecting-ip":"203.0.113.1","x-real-ip":"203.0.113.2","x-forwarded-for":"203.0.113.3"}'::jsonb
        || jsonb_build_object(header_name,'203.0.113.4, invalid, '||candidate_ip||', 203.0.113.5');
      FOREACH operation IN ARRAY ARRAY['types','create','list','datasets','ingest'] LOOP
        BEGIN
          PERFORM pg_temp.map_call(operation,identity || jsonb_build_object('_edge_ip_headers',ip_headers));
          RAISE EXCEPTION 'IP bypass % % %',operation,header_name,candidate_ip;
        EXCEPTION WHEN SQLSTATE 'PT403' THEN
          IF SQLERRM<>'Access denied' THEN RAISE; END IF;
        END;
        IF current_setting('request.headers') IS DISTINCT FROM original_headers THEN RAISE EXCEPTION 'IP context leaked after denial'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH ip_headers IN ARRAY ARRAY['{}'::jsonb,
    '{"cf-connecting-ip":"203.0.113.1","x-forwarded-for":"invalid, , 203.0.113.8"}'::jsonb,
    '{"cf-connecting-ip":"42.117.87.144","x-real-ip":"2001:db8::1"}'::jsonb] LOOP
    PERFORM pg_temp.map_call('types',identity || jsonb_build_object('_edge_ip_headers',ip_headers));
    IF current_setting('request.headers') IS DISTINCT FROM original_headers THEN RAISE EXCEPTION 'IP context leaked after allowed request'; END IF;
  END LOOP;
  FOREACH operation IN ARRAY ARRAY['types','create','list','datasets','ingest'] LOOP
    BEGIN
      PERFORM pg_temp.map_call(operation,identity-'_edge_ip_headers');
      RAISE EXCEPTION 'missing Edge context accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'akamap_request_context_required' THEN RAISE; END IF; END;
  END LOOP;
  FOREACH bad IN ARRAY ARRAY[
    identity || '{"p_auth_password":"wrong"}',identity || '{"p_staff_id":2}',
    identity || '{"p_organization_id":20}',identity || '{"p_auth_username":"disabled","p_staff_id":2}'
  ] LOOP
    FOREACH operation IN ARRAY ARRAY['types','create','list','datasets','ingest'] LOOP
      BEGIN
        PERFORM pg_temp.map_call(operation,bad);
        RAISE EXCEPTION 'identity bypass %',operation;
      EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
    END LOOP;
  END LOOP;
  BEGIN
    PERFORM pg_temp.map_call('types',identity-'p_auth_password');
    RAISE EXCEPTION 'missing password accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
  actual := pg_temp.map_call('types',identity);
  IF jsonb_array_length(actual)<>2 OR actual->0->>'id'<>'101'
    OR actual->0->'category_type'->>'namespace'<>'common' THEN RAISE EXCEPTION 'types shape/order drift'; END IF;

  payload := identity || '{"p_name":"Fixture group","p_color":"#2563EB","p_request_id":"fixture-create","p_data_type_category_item_id":101}';
  created := pg_temp.map_call('create',payload); group_id := (created->>'id')::bigint;
  expected := public.aka_agent_create_data_group(1,10,'Fixture group','#2563EB','fixture-create',101,'fixture','not-real');
  IF group_id IS NULL OR created IS DISTINCT FROM expected
    OR pg_temp.map_call('create',payload) IS DISTINCT FROM created THEN RAISE EXCEPTION 'create response or idempotency drift'; END IF;

  payload := identity || '{"p_search":null,"p_compatible_action_id":null,"p_compatible_data_type_category_item_id":null,"p_data_type_category_item_ids":null,"p_offset":0,"p_limit":200,"p_unrestricted_only":false}';
  actual := pg_temp.map_call('list',payload);
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO expected
    FROM public.aka_agent_list_data_groups(1,10,NULL::text,NULL::text,NULL::bigint,NULL::bigint[],0,200,'fixture','not-real',false) r;
  IF actual IS DISTINCT FROM expected OR jsonb_array_length(actual)<>1 THEN RAISE EXCEPTION 'list parity'; END IF;
  IF pg_temp.map_call('list',payload || '{"p_offset":200}')<>'[]'::jsonb THEN RAISE EXCEPTION 'pagination changed'; END IF;

  payload := identity || jsonb_build_object('p_request_id','fixture-ingest','p_group_id',group_id,'p_kind','upload',
    'p_rows','[{"name":"Fixture","contact_type":"phone","phone":"0901234567","email":"fixture@example.test"}]'::jsonb,
    'p_dataset_id',NULL,'p_dataset_name','akaMap - Số điện thoại','p_import_source','sheet','p_source_account_id',NULL,
    'p_source_name','akaMap','p_payload_hash',repeat('a',64),'p_data_type_category_item_id',101);
  ingested := pg_temp.map_call('ingest',payload);
  IF ingested->>'inserted_membership_count'<>'1' OR ingested->>'invalid_count'<>'0'
    THEN RAISE EXCEPTION 'fixture ingest did not exercise a valid row: %',ingested; END IF;
  expected := public.aka_agent_ingest_data_group(1,10,'fixture-ingest',group_id,'upload',payload->'p_rows',NULL,'akaMap - Số điện thoại',
    'sheet',NULL,'akaMap',repeat('a',64),101,'fixture','not-real');
  IF ingested IS DISTINCT FROM expected OR pg_temp.map_call('ingest',payload) IS DISTINCT FROM ingested THEN RAISE EXCEPTION 'ingest counters/idempotency drift'; END IF;

  actual := pg_temp.map_call('datasets',identity || jsonb_build_object('p_group_id',group_id));
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO expected
    FROM public.aka_agent_list_data_group_datasets(1,10,group_id,'fixture','not-real') r;
  IF actual IS DISTINCT FROM expected OR jsonb_array_length(actual)<>1 THEN RAISE EXCEPTION 'datasets response/timestamp drift'; END IF;
END $map$;
SELECT 'PASS 120 denied IP/route/header cases, allowed neighbors and request context restoration';
SELECT 'PASS 20 forged identities denied, missing credentials denied, Map create/list/ingest/datasets and replay parity';
RESET ROLE;
ROLLBACK;
