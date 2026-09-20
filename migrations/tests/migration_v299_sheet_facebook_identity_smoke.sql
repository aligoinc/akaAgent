-- Run inside BEGIN/ROLLBACK, after v299. No Google fetch or campaign execution.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT set_config('request.jwt.claim.role','service_role',true);

DO $identity$
DECLARE test record; actual text;
BEGIN
  FOR test IN SELECT * FROM (VALUES
    ('facebook_post_url','{"url":"https://www.facebook.com/story.php?story_fbid=pfbidExampleA&id=1001"}'::jsonb,'post:pfbidExampleA'),
    ('facebook_post_url','{"url":"https://www.facebook.com/story.php?story_fbid=pfbidExampleB&id=1001"}'::jsonb,'post:pfbidExampleB'),
    ('facebook_post_url','{"url":"https://m.facebook.com/permalink.php?id=1001&story_fbid=pfbidExampleA"}'::jsonb,'post:pfbidExampleA'),
    ('facebook_post_url','{"url":"https://www.facebook.com/example/posts/pfbidExampleA"}'::jsonb,'post:pfbidExampleA'),
    ('facebook_post_url','{"url":"https://www.facebook.com/story.php?story_fbid=pfbidExamplea&id=1001"}'::jsonb,'post:pfbidExamplea'),
    ('facebook_post_url','{"url":"https://www.facebook.com/photo.php?fbid=123ABC&id=1001"}'::jsonb,'post:123ABC'),
    ('facebook_post_url','{"uid":"123456789","url":"https://www.facebook.com/example/posts/123456789"}'::jsonb,'post:123456789'),
    ('facebook_post_url','{"uid":"https://www.facebook.com/example/posts/123456789","url":" "}'::jsonb,'post:123456789'),
    ('facebook_post_url','{"uid":"123456789"}'::jsonb,NULL),
    ('facebook_person','{"uid":"1000123456789"}'::jsonb,'1000123456789'),
    ('facebook_person','{"uid":"https://www.facebook.com/people/Example/1000123456789"}'::jsonb,'1000123456789'),
    ('facebook_person','{"uid":"https://fb.com/people/Example/1000123456789/"}'::jsonb,'1000123456789'),
    ('facebook_person','{"uid":"https://mbasic.facebook.com/profile.php?id=1000123456789&ref=test"}'::jsonb,'1000123456789'),
    ('facebook_person','{"uid":"https://www.facebook.com/Example.User"}'::jsonb,'example.user'),
    ('facebook_page','{"uid":"https://www.facebook.com/pages/Example/1000123456789"}'::jsonb,'1000123456789'),
    ('facebook_page','{"uid":"https://fb.com/pages/Example/1000123456789"}'::jsonb,'1000123456789'),
    ('facebook_group','{"uid":"https://www.facebook.com/groups/123456789"}'::jsonb,'123456789'),
    ('phone','{"phone":"+84 912 345 678"}'::jsonb,'0912345678'),
    ('email','{"email":"AN@Example.com"}'::jsonb,'an@example.com'),
    ('facebook_search_keyword','{"uid":"  Hello   WORLD  "}'::jsonb,'hello world'),
    ('zalo_person','{"uid":"12345678901234567890"}'::jsonb,'12345678901234567890'),
    ('zalo_group','{"url":"https://zalo.me/g/Abc123"}'::jsonb,'zalo.me/g/Abc123')
  ) cases(data_type,payload,expected) LOOP
    actual:=public.aka_agent_sheet_identity(test.data_type,test.payload);
    IF actual IS DISTINCT FROM test.expected THEN
      RAISE EXCEPTION 'sheet_identity: type %, payload %, expected %, actual %',test.data_type,test.payload,test.expected,actual;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.aka_agent_sheet_identity(text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.aka_agent_sheet_identity(text,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'sheet_identity_acl'; END IF;
END;
$identity$;

DO $ingest$
DECLARE a public.org_staff%ROWTYPE; data_type text; typ bigint; g bigint; src jsonb; cfg jsonb; input jsonb;
  rows jsonb; result jsonb; first_result jsonb; job jsonb; v_token uuid; expected_added integer;
  contact_id bigint; contact_before jsonb; prefix text:='sheet-v299-'||txid_current();
BEGIN
  SELECT * INTO a FROM public.org_staff WHERE is_active AND organization_id IS NOT NULL ORDER BY id LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'sheet_smoke_requires_staff'; END IF;
  FOREACH data_type IN ARRAY ARRAY['facebook_post_url','facebook_person','facebook_page'] LOOP
    typ:=public.aka_agent_data_type_category_item_id(data_type);
    result:=public.aka_agent_create_data_group_v2(a.id,a.organization_id,prefix||data_type,'#123456',prefix||data_type,typ,NULL,NULL,NULL);
    g:=(result->>'id')::bigint;
    IF data_type='facebook_post_url' THEN
      rows:='[{"url":"https://www.facebook.com/story.php?story_fbid=pfbidExampleA&id=1001","contact_type":"campaign_input","flatform_type":"facebook"},
        {"url":"https://www.facebook.com/story.php?story_fbid=pfbidExampleB&id=1001","contact_type":"campaign_input","flatform_type":"facebook"},
        {"url":"https://www.facebook.com/example/posts/pfbidExampleA","contact_type":"campaign_input","flatform_type":"facebook"}]';
      expected_added:=2;
      -- A preexisting contact can have a numeric UID and a valid post URL.
      result:=public.aka_agent_ingest_data_group(a.id,a.organization_id,prefix||'-manual',g,'manual',
        '[{"uid":"123456789","url":"https://www.facebook.com/example/posts/123456789","name":"Keep original","contact_type":"campaign_input","flatform_type":"facebook"}]',
        NULL,NULL,NULL,NULL,'Sheet regression fixture',NULL,typ);
      IF (result->>'inserted_membership_count')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'sheet_existing_post_fixture %',result; END IF;
      SELECT c.id,to_jsonb(c) INTO contact_id,contact_before FROM public.auto_account_contacts c
        JOIN public.auto_account_contact_group_members m ON m.contact_id=c.id WHERE m.group_id=g;
      rows:=rows||'[{"url":"https://www.facebook.com/example/posts/123456789","name":"Must not overwrite","contact_type":"campaign_input","flatform_type":"facebook"}]'::jsonb;
    ELSE
      rows:=jsonb_build_array(
        jsonb_build_object('uid','1000123456789','contact_type',CASE data_type WHEN 'facebook_person' THEN 'person' ELSE 'page' END,'flatform_type','facebook'),
        jsonb_build_object('uid','https://www.facebook.com/'||CASE data_type WHEN 'facebook_person' THEN 'people' ELSE 'pages' END||'/Example/1000123456789',
          'contact_type',CASE data_type WHEN 'facebook_person' THEN 'person' ELSE 'page' END,'flatform_type','facebook'));
      expected_added:=1;
    END IF;
    cfg:=jsonb_build_object('url','https://docs.google.com/spreadsheets/d/smoke/edit#gid=0','dataTypeCode',data_type,'hasHeader',true,
      'expectedHeaders',jsonb_build_array('Identity'),'mapping',jsonb_build_array(jsonb_build_object('column',0,'field',CASE data_type WHEN 'facebook_post_url' THEN 'url' ELSE 'uid' END)));
    input:=jsonb_build_object('groupId',g,'requestId',prefix||data_type,'name','Regression fixture','config',cfg,'everyHours',6,'isEnabled',true,'endDate',NULL);
    result:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'preview',input||jsonb_build_object('rows',rows));
    IF (result->>'new_count')::integer IS DISTINCT FROM expected_added OR (result->>'duplicate_count')::integer IS DISTINCT FROM jsonb_array_length(rows)-expected_added
      OR (result->>'invalid_count')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'sheet_preview_% %',data_type,result; END IF;
    src:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',input);
    v_token:=gen_random_uuid();
    UPDATE public.auto_data_group_sheet_worker_state SET enabled=true,token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
    job:=public.aka_agent_sheet_claim(v_token);
    IF (job->>'sourceId')::bigint IS DISTINCT FROM (src->>'id')::bigint THEN RAISE EXCEPTION 'sheet_claim_% %',data_type,job; END IF;
    result:=public.aka_agent_sheet_finish(v_token,rows,jsonb_array_length(rows),0);
    IF (result->>'addedCount')::integer IS DISTINCT FROM expected_added OR (result->>'duplicateCount')::integer IS DISTINCT FROM jsonb_array_length(rows)-expected_added
      OR (result->>'invalidCount')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'sheet_finish_% %',data_type,result; END IF;
    first_result:=result;
    IF public.aka_agent_sheet_finish(v_token,rows,jsonb_array_length(rows),0) IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'sheet_finish_replay_%',data_type; END IF;
    IF data_type='facebook_post_url' AND (SELECT to_jsonb(c) FROM public.auto_account_contacts c WHERE c.id=contact_id) IS DISTINCT FROM contact_before
      THEN RAISE EXCEPTION 'sheet_existing_post_overwritten'; END IF;
    -- Another source with the same rows must not import them again.
    src:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',input||jsonb_build_object('requestId',prefix||data_type||'-2'));
    v_token:=gen_random_uuid();
    UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
    job:=public.aka_agent_sheet_claim(v_token);
    IF (job->>'sourceId')::bigint IS DISTINCT FROM (src->>'id')::bigint THEN RAISE EXCEPTION 'sheet_claim_second_% %',data_type,job; END IF;
    result:=public.aka_agent_sheet_finish(v_token,rows,jsonb_array_length(rows),0);
    IF (result->>'addedCount')::integer IS DISTINCT FROM 0 OR (result->>'duplicateCount')::integer IS DISTINCT FROM jsonb_array_length(rows)
      THEN RAISE EXCEPTION 'sheet_cross_source_% %',data_type,result; END IF;
    UPDATE public.auto_account_contact_group_members SET is_delete=true WHERE group_id=g;
    result:=public.aka_agent_sheet_classify(g,data_type,rows);
    IF (result->>'new_count')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'sheet_removed_readded_% %',data_type,result; END IF;
    UPDATE public.auto_account_contacts SET is_delete=true WHERE id IN (SELECT m.contact_id FROM public.auto_account_contact_group_members m WHERE m.group_id=g);
    result:=public.aka_agent_sheet_classify(g,data_type,rows);
    IF (result->>'new_count')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'sheet_deleted_restored_% %',data_type,result; END IF;
  END LOOP;
END;
$ingest$;
