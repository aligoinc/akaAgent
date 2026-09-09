-- Run inside BEGIN/ROLLBACK, after migration v270; never sends external actions.
DO $test$
DECLARE
  v_staff bigint;
  v_org bigint;
  v_account bigint;
  v_action text;
  v_id uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_payload jsonb;
  v_result jsonb;
  v_campaign bigint;
  v_campaign2 bigint;
  v_rows jsonb;
  v_failed boolean;
BEGIN
  SELECT a.staff_id, a.organization_id, a.id, act.id INTO v_staff, v_org, v_account, v_action
  FROM public.auto_accounts a JOIN public.org_staff s ON s.id = a.staff_id AND s.organization_id = a.organization_id
  JOIN public.auto_campaign_actions act ON act.flatform_type = a.flatform_type
  WHERE NOT coalesce(a.is_delete, false) AND s.is_active = true AND act.is_active = true
    AND NOT coalesce(act.is_delete, false) AND a.flatform_type = 'facebook'
  ORDER BY a.id, act.id LIMIT 1;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'smoke fixture requires an active Facebook account'; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_payload := jsonb_build_object('version', 1, 'values', jsonb_build_object('formData', jsonb_build_object(
    'name', 'Draft rollback smoke', 'actionId', v_action, 'accountIds', jsonb_build_array(v_account),
    'schedule', '2035-01-01T09:00:00+07:00', 'content', '', 'enabled', false, 'count', 0),
    'details', jsonb_build_array(jsonb_build_object('phone', '0900000000'))));
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_id,jsonb_build_object('revision',0,'payload',v_payload));
  IF (v_result->>'revision')::integer <> 1 OR v_result->'payload' <> v_payload THEN RAISE EXCEPTION 'save snapshot failed'; END IF;
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_id,jsonb_build_object('revision',0,'payload',v_payload));
  IF (v_result->>'revision')::integer <> 1 THEN RAISE EXCEPTION 'save retry not idempotent'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_campaigns WHERE control_idempotency_key LIKE 'draft:'||v_id||':%') THEN RAISE EXCEPTION 'saving draft created runtime data'; END IF;
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'list',NULL,'{}');
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'items') x WHERE x->>'id'=v_id::text AND NOT (x ? 'payload')) THEN RAISE EXCEPTION 'summary missing or exposes payload'; END IF;
  IF has_table_privilege('anon','public.auto_campaign_drafts','SELECT') OR has_table_privilege('authenticated','public.auto_campaign_draft_outputs','UPDATE') THEN RAISE EXCEPTION 'draft tables exposed'; END IF;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,'invalid-draft-smoke','invalid','get',v_id,'{}');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'invalid credentials accepted'; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org+999999,NULL,NULL,'get',v_id,'{}');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'cross tenant accepted'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_id,
      jsonb_build_object('revision',0,'payload',jsonb_set(v_payload,'{values,formData,name}','"changed"')));
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale revision accepted'; END IF;

  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'begin',v_id,
    jsonb_build_object('revision',1,'token',v_token,'plan',jsonb_build_object('items',jsonb_build_array(
      jsonb_build_object('key','main:0'),jsonb_build_object('key','main:1')),'links','[]'::jsonb)));
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'begin',v_id,jsonb_build_object('revision',1,'token',gen_random_uuid()));
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'concurrent conversion accepted'; END IF;
  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,schedule,control_idempotency_key)
    VALUES('Draft rollback child 0',v_action,v_account,v_staff,v_org,'tạm dừng','2035-01-01','draft:'||v_id||':main:0') RETURNING id INTO v_campaign;
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'output',v_id,jsonb_build_object('token',v_token,'key','main:0'));
  v_rows := jsonb_build_array(jsonb_build_object('name','same','uid','100000000000001','content','First spintax result'), jsonb_build_object('name','same','uid','100000000000001'));
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'input_batch',v_id,jsonb_build_object('token',v_token,'key','main:0','batch','0','rows',v_rows));
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'input_batch',v_id,jsonb_build_object('token',v_token,'key','main:0','batch','0','rows',jsonb_set(v_rows,'{0,content}','"Retried spintax result"')));
  IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE campaign_id=v_campaign AND content='First spintax result') THEN RAISE EXCEPTION 'retry replaced committed content'; END IF;
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'input_batch',v_id,jsonb_build_object('token',v_token,'key','main:0','batch','0','rows',v_rows));
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=v_campaign) <> 2 THEN RAISE EXCEPTION 'input batch retry duplicated/lost rows'; END IF;
  v_failed := false;
  BEGIN UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=v_campaign;
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'incomplete conversion can run'; END IF;
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'prepared',v_id,jsonb_build_object('token',v_token,'key','main:0'));
  v_failed := false;
  BEGIN PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'finish',v_id,jsonb_build_object('token',v_token));
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'partial conversion finalized'; END IF;
  IF (SELECT is_delete FROM public.auto_campaign_drafts WHERE id=v_id) THEN RAISE EXCEPTION 'partial draft removed'; END IF;
  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,schedule,control_idempotency_key)
    VALUES('Draft rollback child 1',v_action,v_account,v_staff,v_org,'tạm dừng','2035-01-01','draft:'||v_id||':main:1') RETURNING id INTO v_campaign2;
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'prepared',v_id,jsonb_build_object('token',v_token,'key','main:1','finalStatus','tạm dừng'));
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'finish',v_id,jsonb_build_object('token',v_token));
  IF jsonb_array_length(v_result->'campaignIds') <> 2 OR jsonb_array_length(v_result->'pausedCampaignIds') <> 1 THEN RAISE EXCEPTION 'wrong conversion result'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_drafts WHERE id=v_id AND is_delete AND deletion_reason='converted' AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'conversion did not soft-delete draft'; END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id=v_campaign) <> 'chờ xử lý' THEN RAISE EXCEPTION 'campaign not activated'; END IF;
  UPDATE public.auto_campaigns SET status='tạm dừng' WHERE id=v_campaign;
  UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=v_campaign;
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'begin',v_id,jsonb_build_object('token',gen_random_uuid()));
  IF v_result->>'completed' <> 'true' OR jsonb_array_length(v_result->'campaignIds') <> 2 THEN RAISE EXCEPTION 'lost finish retry not idempotent'; END IF;
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_deleted,jsonb_build_object('revision',0,'payload',v_payload));
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'delete',v_deleted,'{}');
  IF v_result->>'deletionReason' <> 'user_deleted' OR v_result->>'isDelete' <> 'true' THEN RAISE EXCEPTION 'manual soft delete failed'; END IF;
  RAISE NOTICE 'PASS: draft snapshot, ownership, summary, CAS, conversion lease, input retry, runtime guard, atomic finish and soft delete';
END;
$test$;
