-- Run inside BEGIN/ROLLBACK after v271. Only rollback fixtures; no external actions.
DO $test$
DECLARE
  v_staff bigint;
  v_org bigint;
  v_account bigint;
  v_action text;
  v_id uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_payload jsonb;
  v_result jsonb;
  v_campaign bigint;
  v_campaign2 bigint;
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
    'details', jsonb_build_array(jsonb_build_object('phone', 'incomplete')),
    'internalCampaignDrafts', jsonb_build_array(jsonb_build_object('tempId', -1))));
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_id,jsonb_build_object('revision',0,'payload',v_payload));
  IF (v_result->>'revision')::integer <> 1 OR v_result->'payload' <> v_payload THEN RAISE EXCEPTION 'save snapshot failed'; END IF;
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_id,jsonb_build_object('revision',0,'payload',v_payload));
  IF (v_result->>'revision')::integer <> 1 THEN RAISE EXCEPTION 'identical save failed'; END IF;
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'get',v_id,'{}');
  IF v_result->'payload' <> v_payload OR v_result->'campaignIds' <> '[]'::jsonb THEN RAISE EXCEPTION 'restore failed'; END IF;
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'list',NULL,'{}');
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'items') x WHERE x->>'id'=v_id::text AND NOT (x ? 'payload') AND NOT (x ? 'conversionStarted')) THEN RAISE EXCEPTION 'summary missing or exposes payload'; END IF;
  IF has_table_privilege('anon','public.auto_campaign_drafts','SELECT') OR has_table_privilege('authenticated','public.auto_campaign_drafts','UPDATE') THEN RAISE EXCEPTION 'draft table exposed'; END IF;
  IF to_regclass('public.auto_campaign_draft_outputs') IS NOT NULL
    OR to_regprocedure('public.aka_agent_guard_unpublished_draft_campaign()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.auto_campaign_drafts'::regclass
      AND attname IN ('conversion_plan','conversion_token','lease_until') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'conversion infrastructure remains';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,'invalid-draft-smoke','invalid','get',v_id,'{}');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'invalid credentials accepted'; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  -- Change only the rollback fixture owner to verify the row ownership guard itself.
  UPDATE public.auto_campaign_drafts SET staff_id = (SELECT id FROM public.org_staff WHERE id<>v_staff LIMIT 1) WHERE id=v_id;
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'get',v_id,'{}');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'cross staff draft read accepted'; END IF;
  UPDATE public.auto_campaign_drafts SET staff_id=v_staff WHERE id=v_id;
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
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_deleted,
      jsonb_build_object('revision',0,'payload',jsonb_set(v_payload,'{values,formData,schedule}','"invalid"')));
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'invalid schedule accepted'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'heartbeat',v_id,'{}');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'old conversion operation remains'; END IF;

  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,schedule)
    VALUES('Draft rollback child 0',v_action,v_account,v_staff,v_org,'tạm dừng','2035-01-01') RETURNING id INTO v_campaign;
  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,schedule)
    VALUES('Draft rollback child 1',v_action,v_account,v_staff,v_org,'tạm dừng','2035-01-01') RETURNING id INTO v_campaign2;
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'complete',v_id,jsonb_build_object('revision',1,'campaignIds',jsonb_build_array(-1)));
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'invalid campaign accepted'; END IF;
  -- Completion cannot delete a newer saved snapshot.
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_id,
    jsonb_build_object('revision',1,'payload',jsonb_set(v_payload,'{values,formData,name}','"newer"')));
  v_failed := false;
  BEGIN
    PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'complete',v_id,
      jsonb_build_object('revision',1,'campaignIds',jsonb_build_array(v_campaign,v_campaign2)));
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed OR (SELECT is_delete FROM public.auto_campaign_drafts WHERE id=v_id) THEN RAISE EXCEPTION 'newer snapshot removed'; END IF;
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'complete',v_id,
    jsonb_build_object('revision',2,'campaignIds',jsonb_build_array(v_campaign2,v_campaign,v_campaign)));
  IF jsonb_array_length(v_result->'campaignIds') <> 2 OR v_result->>'deletionReason' <> 'converted'
    OR v_result->>'isDelete' <> 'true' THEN RAISE EXCEPTION 'completion metadata failed'; END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id=v_campaign) <> 'tạm dừng' THEN RAISE EXCEPTION 'completion changed campaign status'; END IF;
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'complete',v_id,
    jsonb_build_object('revision',2,'campaignIds',jsonb_build_array(v_campaign,v_campaign2)));
  UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=v_campaign;
  UPDATE public.auto_campaigns SET status='tạm dừng' WHERE id=v_campaign;
  PERFORM public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'save',v_deleted,jsonb_build_object('revision',0,'payload',v_payload));
  v_result := public.aka_agent_campaign_drafts(v_staff,v_org,NULL,NULL,'delete',v_deleted,'{}');
  IF v_result->>'deletionReason' <> 'user_deleted' OR v_result->>'isDelete' <> 'true' THEN RAISE EXCEPTION 'manual soft delete failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_drafts WHERE id=v_deleted AND deleted_at IS NOT NULL AND payload=v_payload) THEN RAISE EXCEPTION 'soft delete lost snapshot'; END IF;
  RAISE NOTICE 'PASS: draft CRUD/snapshot, credential/ownership, summary, revision guard, completion metadata, normal campaign control and soft delete';
END;
$test$;
