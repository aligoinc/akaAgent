-- Verified live dependencies are retained in the v363 snapshot; no existing business RPC is replaced.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])')))<>'65cd07b8ae16017794e56977c2f76aff' THEN RAISE EXCEPTION 'v363 live source drift: aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])'; END IF;
IF to_regprocedure('public.aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])')))<>'35d402155b69cc393621092d752605e5' THEN RAISE EXCEPTION 'v363 live source drift: aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])'; END IF;
IF to_regprocedure('public.aka_agent_guard_detail_result_v361()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_guard_detail_result_v361()')))<>'af85b71bd420293a12b2b55b7f1f2954' THEN RAISE EXCEPTION 'v363 live source drift: aka_agent_guard_detail_result_v361()'; END IF;
IF to_regprocedure('public.aka_agent_guard_result_catalog_v361()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_guard_result_catalog_v361()')))<>'c84a0510e6f1cfd5b62df9da39270cba' THEN RAISE EXCEPTION 'v363 live source drift: aka_agent_guard_result_catalog_v361()'; END IF;
IF to_regprocedure('public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)')))<>'1c3e5d27fa9d99b6bc6e7fb3ede55115' THEN RAISE EXCEPTION 'v363 live source drift: aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)'; END IF;
IF to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)')))<>'5a9a503db72b965eb644739f5f60905d' THEN RAISE EXCEPTION 'v363 live source drift: auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.increment_auto_account_action_count(bigint,text,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.increment_auto_account_action_count(bigint,text,integer)')))<>'a73e7ec7edc66cf6389b4233ffbcc3de' THEN RAISE EXCEPTION 'v363 live source drift: increment_auto_account_action_count(bigint,text,integer)'; END IF;
IF to_regprocedure('public.aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'v363 function already exists: aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)'; END IF;
IF to_regprocedure('public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)') IS NOT NULL THEN RAISE EXCEPTION 'v363 function already exists: aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)'; END IF;
IF to_regprocedure('public.aka_agent_guard_result_policy_identity_v363()') IS NOT NULL THEN RAISE EXCEPTION 'v363 function already exists: aka_agent_guard_result_policy_identity_v363()'; END IF;
IF (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)->>'id',to_jsonb(t)->>'code'),'')) FROM public.auto_account_action_status_policies t)<>'4897518490878a8b23519482ce97eaec' THEN RAISE EXCEPTION 'v363 policy seed drift'; END IF;
IF EXISTS (SELECT 1 FROM public.auto_account_action_status_policies p JOIN public.auto_status s ON s.id=p.status_id WHERE s.code IN ('campaign_detail_tag_not_found','campaign_detail_invalid_parameter')) THEN RAISE EXCEPTION 'v363 auxiliary seed already configured'; END IF;
END $preflight$;
-- New RPCs only. Source/absence/attribute guards are prepended by the builder.
CREATE FUNCTION public.aka_agent_write_action_result_v1(
  p_staff_id bigint,p_campaign_id bigint,p_account_id bigint,
  p_claim_token uuid,p_unit_token uuid,p_result_key text,p_detail jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog,public SET statement_timeout TO '30s'
AS $function$
DECLARE
 c public.auto_campaigns%ROWTYPE;
 d public.auto_campaign_details%ROWTYPE;
 p public.auto_account_action_status_policies%ROWTYPE;
 v_input_id bigint := (p_detail->>'input_data_id')::bigint;
 decision jsonb := p_detail->'policy_snapshot';
BEGIN
 IF p_staff_id IS NULL OR p_campaign_id IS NULL OR p_account_id IS NULL
   OR p_claim_token IS NULL OR p_unit_token IS NULL OR NULLIF(p_result_key,'') IS NULL
   OR jsonb_typeof(p_detail) IS DISTINCT FROM 'object'
   OR jsonb_typeof(decision) IS DISTINCT FROM 'object'
   OR jsonb_typeof(decision->'countsTowardLimit') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(decision->'resetErrorStreak') IS DISTINCT FROM 'boolean'
   OR decision->>'reportGroup' IS NULL OR decision->>'reportGroup' NOT IN ('success','failure','skipped','pending')
   OR decision->>'badTargetEffect' IS NULL OR decision->>'badTargetEffect' NOT IN ('increment','reset','ignore')
   OR decision->>'inputEffect' IS NULL OR decision->>'inputEffect' NOT IN ('complete','pause','requeue','none')
   OR decision->>'operationState' IS NULL OR decision->>'operationState' NOT IN ('committed','not_committed','unknown')
   OR decision ? 'settlement'
 THEN RAISE EXCEPTION 'action_result_payload_invalid'; END IF;
 -- Result commit drains an already claimed operation. Do not reject its error
 -- detail because an error policy just disabled the account or staff access.
 PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_scope_invalid'; END IF;
 PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
 IF v_input_id IS NOT NULL THEN
   PERFORM 1 FROM public.auto_campaign_input_data WHERE id=v_input_id AND campaign_id=p_campaign_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'action_result_input_invalid'; END IF;
 END IF;
 SELECT x.* INTO c FROM public.auto_campaigns x JOIN public.auto_accounts a ON a.id=p_account_id
   AND a.staff_id=x.staff_id AND a.organization_id IS NOT DISTINCT FROM x.organization_id
 WHERE x.id=p_campaign_id AND x.staff_id=p_staff_id
   AND p_account_id IN (x.account_id,x.secondary_account_id)
   AND x.runtime_claim_token=p_claim_token AND x.runtime_unit_token=p_unit_token
   AND x.runtime_unit_claimed_at IS NOT NULL FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_claim_invalid'; END IF;
 IF v_input_id IS NOT NULL AND NOT COALESCE(v_input_id=ANY(c.runtime_unit_input_data_ids),false)
 THEN RAISE EXCEPTION 'action_result_input_not_in_unit'; END IF;
 SELECT * INTO d FROM public.auto_campaign_details WHERE result_key=p_result_key;
 IF FOUND THEN
   IF d.campaign_id<>p_campaign_id OR d.account_id<>p_account_id
     OR d.input_data_id IS DISTINCT FROM v_input_id
     OR d.action_code IS DISTINCT FROM p_detail->>'action_code'
     OR d.status_id IS DISTINCT FROM (p_detail->>'status_id')::bigint
     OR d.policy_snapshot->>'unitKey' IS DISTINCT FROM md5(p_unit_token::text)
   THEN RAISE EXCEPTION 'action_result_key_conflict'; END IF;
   RETURN jsonb_build_object('detail',to_jsonb(d),'inserted',false);
 END IF;
 SELECT * INTO p FROM public.auto_account_action_status_policies
   WHERE id=(p_detail->>'action_status_policy_id')::bigint FOR SHARE;
 IF NOT FOUND OR p.status_id IS DISTINCT FROM (p_detail->>'status_id')::bigint
   OR (p.action_code IS NOT NULL AND p.action_code IS DISTINCT FROM p_detail->>'action_code')
 THEN RAISE EXCEPTION 'result_policy_identity_mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_campaign_details old
   WHERE old.campaign_id=p_campaign_id AND ((v_input_id IS NULL AND old.input_data_id IS NULL) OR old.input_data_id=v_input_id) AND old.policy_snapshot->>'unitKey'=md5(p_unit_token::text)
     AND old.policy_snapshot ? 'settlement')
 THEN RAISE EXCEPTION 'action_result_target_settled'; END IF;
 decision:=decision || jsonb_build_object('unitKey',md5(p_unit_token::text));
 -- Guard execution evidence even if a caller supplied an unsafe retry decision.
 IF decision->>'inputEffect'='requeue' AND decision->>'operationState'<>'not_committed'
 THEN decision:=jsonb_set(decision,'{inputEffect}','"pause"'); END IF;
 INSERT INTO public.auto_campaign_details(input_data_id,campaign_id,account_id,action_code,action_name,status,
   error_code,log,data,post_url,status_id,sub_status_id,action_status_policy_id,report_group,
   counts_toward_limit,policy_snapshot,result_key)
 VALUES(v_input_id,p_campaign_id,p_account_id,p_detail->>'action_code',p_detail->>'action_name',p_detail->>'status',
   NULLIF(p_detail->>'error_code',''),p_detail->>'log',p_detail->'data',p_detail->>'post_url',
   (p_detail->>'status_id')::bigint,(p_detail->>'sub_status_id')::bigint,p.id,decision->>'reportGroup',
   (decision->>'countsTowardLimit')::boolean,decision,p_result_key) RETURNING * INTO d;
 IF (decision->>'countsTowardLimit')::boolean THEN
   PERFORM public.increment_auto_account_action_count(p_account_id,d.action_code,1);
 END IF;
 IF (decision->>'resetErrorStreak')::boolean THEN
   UPDATE public.auto_account_error_state SET count_consecutive_errors=0,updated_at=now()
     WHERE account_id=p_account_id AND action_code=d.action_code;
 END IF;
 RETURN jsonb_build_object('detail',to_jsonb(d),'inserted',true);
END $function$;

CREATE FUNCTION public.aka_agent_settle_action_results_v1(
 p_staff_id bigint,p_campaign_id bigint,p_account_id bigint,p_claim_token uuid,p_unit_token uuid,
 p_input_data_id bigint,p_detail_ids bigint[],p_input_patch jsonb DEFAULT NULL,p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog,public SET statement_timeout TO '30s'
AS $function$
DECLARE
 c public.auto_campaigns%ROWTYPE;
 i public.auto_campaign_input_data%ROWTYPE;
 d public.auto_campaign_details%ROWTYPE;
 v_ids bigint[];
 v_bad text:='ignore'; v_effect text:='none'; v_committed boolean:=false;
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
     ON CONFLICT(campaign_id) DO UPDATE SET count_consecutive_bad_targets=auto_campaign_error_state.count_consecutive_bad_targets+1,
       last_input_data_id=EXCLUDED.last_input_data_id,last_reason=EXCLUDED.last_reason,last_bad_target_at=now(),updated_at=now()
     RETURNING count_consecutive_bad_targets INTO v_count;
   ELSIF v_bad='reset' THEN
     INSERT INTO public.auto_campaign_error_state(campaign_id,count_consecutive_bad_targets,last_reason,updated_at)
     VALUES(p_campaign_id,0,NULL,now()) ON CONFLICT(campaign_id) DO UPDATE
       SET count_consecutive_bad_targets=0,last_reason=NULL,updated_at=now() RETURNING count_consecutive_bad_targets INTO v_count;
   ELSE
     SELECT count_consecutive_bad_targets INTO v_count FROM public.auto_campaign_error_state WHERE campaign_id=p_campaign_id;
     v_count:=COALESCE(v_count,0);
   END IF;
   v_settlement:=jsonb_build_object('detailIds',v_ids,'badTargetEffect',v_bad,'badTargetCount',v_count,'inputEffect',v_effect,'inputApplied',false);
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
END $function$;

CREATE FUNCTION public.aka_agent_guard_result_policy_identity_v363() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF (NEW.status_id IS DISTINCT FROM OLD.status_id OR NEW.action_code IS DISTINCT FROM OLD.action_code)
   AND EXISTS (SELECT 1 FROM public.auto_campaign_details WHERE action_status_policy_id=OLD.id)
 THEN RAISE EXCEPTION 'result_policy_identity_in_use'; END IF;
 RETURN NEW;
END $function$;
CREATE TRIGGER auto_aasp_identity_guard BEFORE UPDATE OF action_code,status_id ON public.auto_account_action_status_policies
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_result_policy_identity_v363();
CREATE TRIGGER auto_detail_action_identity_guard BEFORE UPDATE OF action_code ON public.auto_campaign_details
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_detail_result_v361();

REVOKE ALL ON FUNCTION public.aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_guard_result_policy_identity_v363() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb),
 public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)
 TO anon,authenticated,service_role,aka_agent_chat_api;

-- Both statuses are already catalogued; their verified producers are auxiliary
-- tag/alias branches, which record failure without quota or bad-target effects.
INSERT INTO public.auto_account_action_status_policies(action_code,status_id,report_group,counts_toward_limit,
 bad_target_effect,reset_error_streak,input_effect,description)
SELECT NULL,s.id,'failure',false,'ignore',false,'complete',
 CASE s.code WHEN 'campaign_detail_tag_not_found' THEN
 'Tag không tồn tại: ghi kết quả thất bại; không tính lượt, không thay chuỗi lỗi. Đối chiếu applyTag của Desktop/Chat; hiện dùng bởi zalo_tag_contact.'
 ELSE 'Tham số đổi tên không hợp lệ: ghi kết quả thất bại; không tính lượt, không thay chuỗi lỗi. Đối chiếu changeAlias của Desktop/Chat; hiện dùng bởi zalo_change_alias.' END
FROM public.auto_status s WHERE s.code IN ('campaign_detail_tag_not_found','campaign_detail_invalid_parameter');

-- Existing relationships/invitations deliberately share the no-reset default,
-- as confirmed by the user on 09/10/2026. Preserve the separate not-found branch.
UPDATE public.auto_account_action_status_policies p SET bad_target_effect='reset',updated_at=now(),
 description='Mời vào group Facebook: không tồn tại được báo cáo bỏ qua, không tính lượt và đặt lại chuỗi target lỗi; đối chiếu handleFacebookGroupInviteBatchResult.'
FROM public.auto_status s WHERE s.id=p.status_id AND s.code='campaign_detail_not_found' AND p.action_code='fb_group_invite';

COMMIT;
