-- Run after v330. All fixture rows are rolled back; no external requests or sends.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $smoke$
DECLARE
 s bigint; o bigint; a bigint; f bigint; op bigint; payload jsonb; saved jsonb; revised jsonb; result jsonb;
 c constant bigint:=9000000000000330; i constant bigint:=9000000000000340;
 token uuid:=gen_random_uuid(); target text:='v330-smoke-'||gen_random_uuid()::text; row_result record;
BEGIN
 SELECT ac.staff_id,ac.organization_id,ac.id INTO s,o,a FROM public.auto_accounts ac
 JOIN public.org_staff st ON st.id=ac.staff_id AND st.organization_id=ac.organization_id AND st.is_active
 WHERE ac.flatform_type='zalo' AND NOT ac.is_delete ORDER BY ac.id LIMIT 1;
 IF a IS NULL THEN RAISE EXCEPTION 'smoke requires an existing active staff Zalo scope'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=c)
 OR EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE id BETWEEN i AND i+3)
 OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE id=i) THEN RAISE EXCEPTION 'smoke fixture ID collision'; END IF;
 SELECT id INTO f FROM public.auto_filter_fields WHERE code='recent_delivery';
 SELECT id INTO op FROM public.auto_filter_operators WHERE code='within_days';
 IF (SELECT count(*) FROM public.auto_filter_fields)<>4 THEN RAISE EXCEPTION 'unexpected initial catalog'; END IF;
 payload:=jsonb_build_object('requestId',gen_random_uuid(),'name','v330 rollback smoke','matchMode','and','rules',jsonb_build_array(jsonb_build_object('fieldId',f,'operatorId',op,'value',7,'isEnabled',true,'sortOrder',0)));
 SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 saved:=public.aka_agent_send_exclusion_groups(s,o,a,'save',payload,NULL,NULL);
 result:=public.aka_agent_send_exclusion_groups(s,o,a,'save',payload,NULL,NULL);
 IF result IS DISTINCT FROM saved OR (saved->>'revision')::bigint<>1 THEN RAISE EXCEPTION 'create replay mismatch'; END IF;
 revised:=public.aka_agent_send_exclusion_groups(s,o,a,'save',saved||'{"name":"v330 rollback revised"}'::jsonb,NULL,NULL);
 IF (revised->>'revision')::bigint<>2 THEN RAISE EXCEPTION 'group revision mismatch'; END IF;
 BEGIN
  PERFORM public.aka_agent_send_exclusion_groups(s,o,a,'save',saved,NULL,NULL);
  RAISE EXCEPTION 'stale group revision accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'send_exclusion_revision_conflict' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.aka_agent_send_exclusion_groups(s,o+900000000000000,a,'list','{}',NULL,NULL);
  RAISE EXCEPTION 'cross tenant accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'send_exclusion_account_not_found' THEN RAISE; END IF; END;
 BEGIN
  PERFORM id FROM public.auto_filter_fields LIMIT 1;
  RAISE EXCEPTION 'direct service table read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 INSERT INTO public.auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,runtime_claim_token,extra_settings) OVERRIDING SYSTEM VALUE
 VALUES(c,'v330 rollback smoke','zalo_message_friend',a,s,o,'tạm dừng',token,jsonb_build_object('recentDeliveryCooldownEnabled',true,'recentDeliveryCooldownDays',7,'zaloSendExclusionsByAccountId',jsonb_build_object(a::text,jsonb_build_object('groupId',saved->'id','blocklistIds','[]'::jsonb))));
 INSERT INTO public.auto_campaign_input_data(id,campaign_id,uid,status) VALUES(i,c,target,'chờ xử lý'),(i+1,c,target,'chờ xử lý'),(i+2,c,target,'hoàn thành'),(i+3,c,'v330-pause-'||token::text,'chờ xử lý');
 INSERT INTO public.auto_campaign_details(id,campaign_id,input_data_id,account_id,action_name,action_code,status,created_at,counts_toward_limit)
 VALUES(i,c,i+2,a,'v330 rollback smoke','zalo_message_friend','đã nhận',((timezone('Asia/Ho_Chi_Minh',now())::date-6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),false);
 -- Management API cannot assume aka_agent_chat_api; its exact ACL is verified separately.
 SET LOCAL ROLE service_role;
 result:=public.aka_agent_campaign_send_exclusion_runtime(c,a,s,token,'snapshot');
 IF result->'group' IS DISTINCT FROM revised OR result->'blocklistUids'<>'[]'::jsonb OR jsonb_array_length(result#>'{catalog,fields}')<>4 THEN RAISE EXCEPTION 'snapshot mismatch'; END IF;
 BEGIN
  PERFORM public.aka_agent_campaign_send_exclusion_runtime(c,a,s,gen_random_uuid(),'snapshot');
  RAISE EXCEPTION 'wrong claim accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'send_exclusion_runtime_claim_lost' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.aka_agent_campaign_send_exclusion_runtime(c,a,s+900000000000000,token,'snapshot');
  RAISE EXCEPTION 'wrong staff accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'send_exclusion_runtime_claim_lost' THEN RAISE; END IF; END;
 result:=public.aka_agent_campaign_send_exclusion_runtime(c,a,s,token,'facts',jsonb_build_object('inputId',i,'days',7));
 IF result#>>'{campaign_delivery,daysSince}' IS DISTINCT FROM '6' THEN RAISE EXCEPTION 'Vietnam day history mismatch'; END IF;
 FOR row_result IN SELECT * FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i,i+1]) LOOP
  IF (row_result.input_data_id=i AND row_result.decision<>'paused_recent_delivery')
   OR (row_result.input_data_id=i+1 AND row_result.decision<>'deferred_batch_duplicate') THEN RAISE EXCEPTION 'cooldown history/duplicate guard mismatch'; END IF;
 END LOOP;
 SELECT * INTO row_result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
 IF row_result.decision<>'not_pending' THEN RAISE EXCEPTION 'cooldown pending guard mismatch'; END IF;
 BEGIN
  PERFORM * FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i+90]);
  RAISE EXCEPTION 'wrong input scope accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'campaign_delivery_cooldown_input_scope_mismatch' THEN RAISE; END IF; END;
 result:=public.aka_agent_campaign_send_exclusion_runtime(c,a,s,token,'pause',jsonb_build_object('inputId',i+3,'expectedStatus','chờ xử lý','note','v330 smoke'));
 IF result->>'changed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pause CAS failed'; END IF;
 result:=public.aka_agent_campaign_send_exclusion_runtime(c,a,s,token,'pause',jsonb_build_object('inputId',i+3,'expectedStatus','chờ xử lý','note','must not overwrite'));
 IF result->>'changed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'stale pause CAS accepted'; END IF;
 RESET ROLE;
 IF (SELECT note FROM public.auto_campaign_input_data WHERE id=i+3) IS DISTINCT FROM 'v330 smoke' THEN RAISE EXCEPTION 'pause reason overwritten'; END IF;
 IF (SELECT status FROM public.auto_campaign_input_data WHERE id=i+1) IS DISTINCT FROM 'chờ xử lý' THEN RAISE EXCEPTION 'duplicate input changed'; END IF;
 IF (SELECT count(*) FROM public.auto_campaign_details WHERE campaign_id=c)<>1 THEN RAISE EXCEPTION 'filter created delivery result'; END IF;
 SET LOCAL ROLE anon;
 PERFORM set_config('request.jwt.claim.role','anon',true);
 BEGIN
  PERFORM public.aka_agent_send_exclusion_groups(s,o,a,'list','{}',NULL,NULL);
  RAISE EXCEPTION 'missing auth accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.aka_agent_send_exclusion_groups(s,o,a,'list','{}','v330-invalid-user','v330-invalid-password');
  RAISE EXCEPTION 'invalid auth accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.aka_agent_internal_send_exclusion_catalog();
  RAISE EXCEPTION 'private helper callable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
END;
$smoke$;
SELECT 'PASS: real-role auth/tenant, group replay/revision CAS, snapshot/claim ownership, pause CAS, Vietnam history, cooldown duplicate/pending/input-scope guards; all fixture rows roll back' AS smoke;
ROLLBACK;
