-- Wrap in BEGIN/ROLLBACK. No Google request, campaign run or persistent fixture.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $identity$
DECLARE test record; actual text;
BEGIN
  FOR test IN SELECT * FROM (VALUES
    ('facebook_post_url','{"url":"https://www.facebook.com/watch/?v=111111111"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/watch/?v=222222222"}'::jsonb,'post:222222222'),
    ('facebook_post_url','{"url":"https://www.facebook.com/watch/live/?v=111111111&ref=feed"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/video.php?v=111111111"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/example/videos/111111111"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/reel/111111111"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/groups/123?multi_permalinks=111111111&ref=feed"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/groups/123?multi_permalinks=222222222"}'::jsonb,'post:222222222'),
    ('facebook_post_url','{"url":"https://www.facebook.com/groups/123/posts/111111111"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/groups/123/permalink/111111111/"}'::jsonb,'post:111111111'),
    ('facebook_post_url','{"url":"https://www.facebook.com/groups/123?multi_permalinks=pfbidAbC"}'::jsonb,'post:pfbidAbC'),
    ('facebook_post_url','{"url":"https://www.facebook.com/watch"}'::jsonb,NULL),
    ('facebook_post_url','{"url":"https://www.facebook.com/groups/123"}'::jsonb,NULL),
    ('facebook_post_url','{"url":"https://www.facebook.com/groups/123?multi_permalinks=123,456"}'::jsonb,NULL),
    ('phone','{"phone":null,"uid":"9999991000123456","contact_type":"person","extra_data":{"phone":"+84 976 523 418"}}'::jsonb,'0976523418'),
    ('phone','{"phone":"0912345678","uid":"9999991000123456","extra_data":{"phone":"0976523418"}}'::jsonb,'0912345678'),
    ('phone','{"phone":"","contact_type":"person","extra_data":{"phone":"0976523418"}}'::jsonb,'0976523418'),
    ('phone','{"phone":"invalid","extra_data":{"phone":"0976523418"}}'::jsonb,NULL),
    ('phone','{"uid":"0912345678","contact_type":"phone"}'::jsonb,'0912345678'),
    ('phone','{"uid":"0912345678","contact_type":"person"}'::jsonb,NULL),
    ('email','{"email":null,"uid":"9999991000123456","contact_type":"person","extra_data":{"email":"LEGACY@Example.com"}}'::jsonb,'legacy@example.com'),
    ('email','{"email":"PRIMARY@Example.com","extra_data":{"email":"legacy@example.com"}}'::jsonb,'primary@example.com'),
    ('email','{"email":"","extra_data":{"email":"legacy@example.com"}}'::jsonb,'legacy@example.com'),
    ('email','{"email":"invalid","extra_data":{"email":"legacy@example.com"}}'::jsonb,NULL),
    ('email','{"uid":"legacy@example.com","contact_type":"email"}'::jsonb,'legacy@example.com'),
    ('email','{"uid":"legacy@example.com","contact_type":"person"}'::jsonb,NULL)
  ) cases(data_type,payload,expected) LOOP
    actual:=public.aka_agent_sheet_identity(test.data_type,test.payload);
    IF actual IS DISTINCT FROM test.expected THEN RAISE EXCEPTION 'v300 key: type %, expected %, actual %, payload %',test.data_type,test.expected,actual,test.payload; END IF;
  END LOOP;
END;
$identity$;

DO $ingest$
DECLARE a public.org_staff%ROWTYPE; g bigint; typ bigint; data_type text; result jsonb; rows jsonb; cfg jsonb;
  src jsonb; job jsonb; v_token uuid; first_result jsonb; expected_added integer; old_contact jsonb; old_contact_id bigint;
  prefix text:='sheet-v300-'||txid_current();
BEGIN
  SELECT * INTO a FROM public.org_staff WHERE is_active AND organization_id IS NOT NULL ORDER BY id LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'sheet_smoke_requires_staff'; END IF;
  FOREACH data_type IN ARRAY ARRAY['phone','email','facebook_post_url'] LOOP
    typ:=public.aka_agent_data_type_category_item_id(data_type);
    result:=public.aka_agent_create_data_group_v2(a.id,a.organization_id,prefix||data_type,'#123456',prefix||data_type,typ,NULL,NULL,NULL);
    g:=(result->>'id')::bigint;
    IF data_type='facebook_post_url' THEN
      result:=public.aka_agent_ingest_data_group(a.id,a.organization_id,prefix||data_type||'-manual',g,'manual',
        '[{"url":"https://www.facebook.com/groups/123?multi_permalinks=333333333","contact_type":"campaign_input","flatform_type":"facebook"}]',NULL,NULL,NULL,NULL,'review fixture',NULL,typ);
      rows:='[{"url":"https://www.facebook.com/watch/?v=111111111","contact_type":"campaign_input","flatform_type":"facebook"},
        {"url":"https://www.facebook.com/watch/?v=222222222","contact_type":"campaign_input","flatform_type":"facebook"},
        {"url":"https://www.facebook.com/groups/123/posts/333333333","contact_type":"campaign_input","flatform_type":"facebook"},
        {"url":"https://www.facebook.com/groups/123/posts/444444444","contact_type":"campaign_input","flatform_type":"facebook"},
        {"url":"https://www.facebook.com/example/videos/111111111","contact_type":"campaign_input","flatform_type":"facebook"}]';
      expected_added:=3;
    ELSE
      -- Existing semantic phone/email members may be profiles with legacy
      -- extra_data fields. The primary column is intentionally empty here.
      result:=public.aka_agent_ingest_data_group(a.id,a.organization_id,prefix||data_type||'-manual',g,'manual',
        jsonb_build_array(jsonb_build_object('uid','9999991000123456','contact_type','person','flatform_type','zalo',
          data_type,CASE data_type WHEN 'phone' THEN '0976523418' ELSE 'legacy@example.com' END)),NULL,NULL,NULL,NULL,'review fixture',NULL,typ);
      UPDATE public.auto_account_contacts SET phone=NULL,email=NULL WHERE id IN (SELECT contact_id FROM public.auto_account_contact_group_members WHERE group_id=g);
      rows:=jsonb_build_array(
        jsonb_build_object('contact_type',data_type,'flatform_type',CASE WHEN data_type='email' THEN 'email' END,
          data_type,CASE data_type WHEN 'phone' THEN '0976523418' ELSE 'legacy@example.com' END),
        jsonb_build_object('contact_type',data_type,'flatform_type',CASE WHEN data_type='email' THEN 'email' END,
          data_type,CASE data_type WHEN 'phone' THEN '0987654321' ELSE 'new@example.com' END));
      expected_added:=1;
    END IF;
    IF (result->>'inserted_membership_count')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'v300 fixture_ingest_% %',data_type,result; END IF;
    SELECT c.id,to_jsonb(c) INTO old_contact_id,old_contact FROM public.auto_account_contacts c
      JOIN public.auto_account_contact_group_members m ON m.contact_id=c.id WHERE m.group_id=g;
    cfg:=jsonb_build_object('url','https://docs.google.com/spreadsheets/d/smoke/edit#gid=0','dataTypeCode',data_type,'hasHeader',true,
      'expectedHeaders',jsonb_build_array('Identity'),'mapping',jsonb_build_array(jsonb_build_object('column',0,'field',CASE data_type WHEN 'facebook_post_url' THEN 'url' ELSE data_type END)));
    result:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'preview',jsonb_build_object('groupId',g,'config',cfg,'rows',rows));
    IF (result->>'new_count')::integer IS DISTINCT FROM expected_added OR (result->>'duplicate_count')::integer IS DISTINCT FROM jsonb_array_length(rows)-expected_added
      THEN RAISE EXCEPTION 'v300 preview_% %',data_type,result; END IF;
    src:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',
      jsonb_build_object('groupId',g,'requestId',prefix||data_type,'name','Identity regression fixture','config',cfg,'everyHours',6,'isEnabled',true));
    v_token:=gen_random_uuid();
    UPDATE public.auto_data_group_sheet_worker_state SET enabled=true,token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
    job:=public.aka_agent_sheet_claim(v_token);
    IF (job->>'sourceId')::bigint IS DISTINCT FROM (src->>'id')::bigint THEN RAISE EXCEPTION 'v300 claim_% %',data_type,job; END IF;
    result:=public.aka_agent_sheet_finish(v_token,rows,jsonb_array_length(rows),0);
    IF (result->>'addedCount')::integer IS DISTINCT FROM expected_added OR (result->>'duplicateCount')::integer IS DISTINCT FROM jsonb_array_length(rows)-expected_added
      OR (result->>'invalidCount')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'v300 finish_% %',data_type,result; END IF;
    first_result:=result;
    IF public.aka_agent_sheet_finish(v_token,rows,jsonb_array_length(rows),0) IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'v300 finish_replay_%',data_type; END IF;
    IF (SELECT to_jsonb(c) FROM public.auto_account_contacts c WHERE c.id=old_contact_id) IS DISTINCT FROM old_contact THEN RAISE EXCEPTION 'v300 overwrote_existing_%',data_type; END IF;
    UPDATE public.auto_account_contact_group_members SET is_delete=true WHERE group_id=g;
    result:=public.aka_agent_sheet_classify(g,data_type,rows);
    IF (result->>'new_count')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'v300 readded_removed_% %',data_type,result; END IF;
  END LOOP;
END;
$ingest$;
