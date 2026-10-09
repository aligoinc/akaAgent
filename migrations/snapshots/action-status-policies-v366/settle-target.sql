CREATE OR REPLACE FUNCTION public.aka_agent_settle_action_results_v1(p_staff_id bigint, p_campaign_id bigint, p_account_id bigint, p_claim_token uuid, p_unit_token uuid, p_input_data_id bigint, p_detail_ids bigint[], p_input_patch jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
 c public.auto_campaigns%ROWTYPE;
 i public.auto_campaign_input_data%ROWTYPE;
 d public.auto_campaign_details%ROWTYPE;
 v_ids bigint[];
 v_bad text:='ignore'; v_effect text:='none'; v_committed boolean:=false; v_reset_before boolean:=false;
 v_existing jsonb; v_settlement jsonb; v_count integer; v_status text;
BEGIN
 IF p_claim_token IS NULL OR p_unit_token IS NULL OR (COALESCE(cardinality(p_detail_ids),0)=0 AND (p_input_patch->'suppressedResult' IS NULL))
   OR array_position(p_detail_ids,NULL) IS NOT NULL
   OR (p_input_patch IS NOT NULL AND jsonb_typeof(p_input_patch)<>'object')
 THEN RAISE EXCEPTION 'action_result_settlement_invalid'; END IF;
 PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_scope_invalid'; END IF;
 PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
 IF p_input_data_id IS NOT NULL THEN
   SELECT * INTO i FROM public.auto_campaign_input_data WHERE id=p_input_data_id AND campaign_id=p_campaign_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'action_result_input_invalid'; END IF;
 END IF;
 SELECT x.* INTO c FROM public.auto_campaigns x JOIN public.auto_accounts a ON a.id=p_account_id
   AND a.staff_id=x.staff_id AND a.organization_id IS NOT DISTINCT FROM x.organization_id
 WHERE x.id=p_campaign_id AND x.staff_id=p_staff_id AND p_account_id IN (x.account_id,x.secondary_account_id)
   AND x.runtime_claim_token=p_claim_token AND x.runtime_unit_token=p_unit_token
   AND x.runtime_unit_claimed_at IS NOT NULL FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_claim_invalid'; END IF;
 IF p_input_data_id IS NOT NULL AND NOT COALESCE(p_input_data_id=ANY(c.runtime_unit_input_data_ids),false)
 THEN RAISE EXCEPTION 'action_result_input_not_in_unit'; END IF;
 IF p_input_patch ? 'suppressedResult' THEN
   v_effect:=p_input_patch->'suppressedResult'->>'inputEffect';
   IF v_effect IS NULL OR v_effect NOT IN ('complete','pause','requeue','none') THEN RAISE EXCEPTION 'action_result_suppression_invalid'; END IF;
   v_committed:=COALESCE(p_input_patch->'suppressedResult'->>'operationState','unknown')<>'not_committed';
 END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}'::bigint[]) INTO v_ids FROM unnest(p_detail_ids) id;
 IF cardinality(v_ids)<>cardinality(p_detail_ids) THEN RAISE EXCEPTION 'action_result_settlement_duplicate_id'; END IF;
 IF (SELECT count(*) FROM public.auto_campaign_details WHERE id=ANY(v_ids) AND campaign_id=p_campaign_id
    AND account_id=p_account_id AND input_data_id IS NOT DISTINCT FROM p_input_data_id
    AND policy_snapshot->>'unitKey'=md5(p_unit_token::text))<>cardinality(v_ids)
 THEN RAISE EXCEPTION 'action_result_settlement_scope_invalid'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_campaign_details sibling
   WHERE sibling.campaign_id=p_campaign_id
     AND ((p_input_data_id IS NULL AND sibling.input_data_id IS NULL) OR sibling.input_data_id=p_input_data_id)
     AND sibling.policy_snapshot->>'unitKey'=md5(p_unit_token::text) AND NOT sibling.id=ANY(v_ids))
 THEN RAISE EXCEPTION 'action_result_settlement_incomplete'; END IF;
 FOR d IN SELECT * FROM public.auto_campaign_details WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE LOOP
   v_reset_before:=v_reset_before OR COALESCE(d.policy_snapshot->'badTargetResetBefore'='true'::jsonb,false);
   IF d.policy_snapshot->>'badTargetEffect'='increment' THEN v_bad:='increment';
   ELSIF d.policy_snapshot->>'badTargetEffect'='reset' AND v_bad='ignore' THEN v_bad:='reset'; END IF;
   IF d.policy_snapshot->>'inputEffect'='pause' THEN v_effect:='pause';
   ELSIF d.policy_snapshot->>'inputEffect'='requeue' AND v_effect<>'pause' THEN v_effect:='requeue';
   ELSIF d.policy_snapshot->>'inputEffect'='complete' AND v_effect='none' THEN v_effect:='complete'; END IF;
   v_committed:=v_committed OR d.policy_snapshot->>'operationState'<>'not_committed';
   IF d.policy_snapshot ? 'settlement' THEN
     IF v_existing IS NOT NULL AND v_existing IS DISTINCT FROM d.policy_snapshot->'settlement'
     THEN RAISE EXCEPTION 'action_result_settlement_conflict'; END IF;
     v_existing:=d.policy_snapshot->'settlement';
   END IF;
 END LOOP;
 IF v_committed AND v_effect='requeue' THEN v_effect:='pause'; END IF;
 IF v_existing IS NOT NULL THEN
   IF v_existing->'detailIds' IS DISTINCT FROM to_jsonb(v_ids)
   THEN RAISE EXCEPTION 'action_result_settlement_conflict'; END IF;
   v_settlement:=v_existing; v_count:=(v_existing->>'badTargetCount')::integer;
 ELSE
   IF v_bad='increment' THEN
     INSERT INTO public.auto_campaign_error_state(campaign_id,count_consecutive_bad_targets,last_input_data_id,last_reason,last_bad_target_at,updated_at)
     VALUES(p_campaign_id,1,p_input_data_id,left(p_reason,2000),now(),now())
     ON CONFLICT(campaign_id) DO UPDATE SET count_consecutive_bad_targets=CASE WHEN v_reset_before THEN 1 ELSE auto_campaign_error_state.count_consecutive_bad_targets+1 END,
       last_input_data_id=EXCLUDED.last_input_data_id,last_reason=EXCLUDED.last_reason,last_bad_target_at=now(),updated_at=now()
     RETURNING count_consecutive_bad_targets INTO v_count;
   ELSIF v_bad='reset' OR v_reset_before THEN
     INSERT INTO public.auto_campaign_error_state(campaign_id,count_consecutive_bad_targets,last_reason,updated_at)
     VALUES(p_campaign_id,0,NULL,now()) ON CONFLICT(campaign_id) DO UPDATE
       SET count_consecutive_bad_targets=0,last_reason=NULL,updated_at=now() RETURNING count_consecutive_bad_targets INTO v_count;
   ELSE
     SELECT count_consecutive_bad_targets INTO v_count FROM public.auto_campaign_error_state WHERE campaign_id=p_campaign_id;
     v_count:=COALESCE(v_count,0);
   END IF;
   v_settlement:=jsonb_build_object('detailIds',v_ids,'badTargetEffect',v_bad,'badTargetResetBefore',v_reset_before,'badTargetCount',v_count,'inputEffect',v_effect,'inputApplied',false);
 END IF;
 IF p_input_patch IS NOT NULL AND p_input_data_id IS NOT NULL AND NOT COALESCE((p_input_patch->>'deferInput')::boolean,false) AND NOT (v_settlement->>'inputApplied')::boolean THEN
   v_status:=CASE v_effect WHEN 'complete' THEN 'hoàn thành' WHEN 'pause' THEN 'tạm dừng' WHEN 'requeue' THEN 'chờ xử lý' ELSE i.status END;
   -- Existing cancellation/account/opt-out guards may strengthen, never weaken,
   -- the configured decision. A completed/unknown operation cannot be requeued.
   IF p_input_patch->>'status'='tạm dừng' THEN v_status:='tạm dừng'; END IF;
   IF p_input_patch->>'status'='chờ xử lý' AND v_effect<>'pause' THEN v_status:=CASE WHEN v_committed THEN 'tạm dừng' ELSE 'chờ xử lý' END; END IF;
   IF i.status='tạm dừng' THEN v_status:='tạm dừng'; END IF;
   UPDATE public.auto_campaign_input_data SET status=v_status,
     note=CASE WHEN p_input_patch ? 'note' THEN p_input_patch->>'note' ELSE note END,
     date_action=CASE WHEN v_status='hoàn thành' THEN now() ELSE date_action END
   WHERE id=p_input_data_id RETURNING * INTO i;
   v_settlement:=v_settlement || jsonb_build_object('inputApplied',true,'inputStatus',v_status);
 END IF;
 UPDATE public.auto_campaign_details SET policy_snapshot=jsonb_set(policy_snapshot,'{settlement}',v_settlement) WHERE id=ANY(v_ids);
 RETURN jsonb_build_object('settlement',v_settlement,'input',CASE WHEN p_input_data_id IS NULL THEN NULL ELSE to_jsonb(i) END);
END $function$
