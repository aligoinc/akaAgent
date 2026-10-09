// All fixtures and DDL are rolled back. Uses the existing linked Management API.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const m=require('./action-status-policy-migration.cjs');
const dir=path.join(m.root,'migrations/snapshots/action-status-policies-v366');
const source=fs.readFileSync(path.join(m.root,'migrations/migration_v366_action_status_runtime_fixes.sql'),'utf8');
const fixture=require('../migrations/snapshots/action-status-policies-v362/event-fixture-schema.json').inputs[0];
const tests=`DO $test$ DECLARE
 original public.auto_campaigns%ROWTYPE;c bigint; i bigint; j bigint; k bigint; p public.auto_account_action_status_policies%ROWTYPE;
 token uuid:=gen_random_uuid();unit uuid:=gen_random_uuid();payload jsonb;r jsonb;r2 jsonb;settled jsonb;count_now integer;
 d bigint;mt bigint;ot uuid;ct uuid;before_detail jsonb;after_detail jsonb;rejected boolean;
BEGIN
 SELECT * INTO STRICT original FROM public.auto_campaigns WHERE id=${fixture.source_campaign_id};
 INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,runtime_claim_token,runtime_unit_token,runtime_unit_claimed_at)
 VALUES('v366-rollback-smoke',original.action_id,original.account_id,original.staff_id,original.organization_id,'tạm dừng',token,unit,now()) RETURNING id INTO c;
 INSERT INTO public.auto_campaign_input_data(campaign_id,name,status) VALUES(c,'v366-rollback-smoke','đang chạy') RETURNING id INTO i;
 INSERT INTO public.auto_campaign_input_data(campaign_id,name,status) VALUES(c,'v366-rollback-smoke','đang chạy') RETURNING id INTO j;
 INSERT INTO public.auto_campaign_input_data(campaign_id,name,status) VALUES(c,'v366-rollback-smoke','đang chạy') RETURNING id INTO k;
 UPDATE public.auto_campaigns SET runtime_unit_input_data_ids=ARRAY[i,j,k] WHERE id=c;
 INSERT INTO public.auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(c,3);
 SELECT p2.* INTO STRICT p FROM public.auto_account_action_status_policies p2 JOIN public.auto_status s ON s.id=p2.status_id WHERE p2.action_code IS NULL AND s.code='campaign_detail_failed';
 payload:=jsonb_build_object('input_data_id',i,'action_code','fb_add_friend','action_name','v366-rollback-smoke','status','thất bại','status_id',p.status_id,'action_status_policy_id',p.id,'log','preserved log',
 'policy_snapshot',jsonb_build_object('reportGroup','failure','countsTowardLimit',false,'badTargetEffect','increment','badTargetResetBefore',true,'resetErrorStreak',false,'inputEffect','complete','operationState','unknown'));
 r:=public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,token,unit,'v366:'||unit::text||':1',payload);
 settled:=public.aka_agent_settle_action_results_v1(original.staff_id,c,original.account_id,token,unit,i,ARRAY[(r->'detail'->>'id')::bigint],'{"status":"hoàn thành","note":"preserved note"}',NULL);
 IF settled->'settlement'->>'badTargetCount'<>'1' THEN RAISE EXCEPTION 'reset before increment failed';END IF;
 payload:=jsonb_set(jsonb_set(payload,'{input_data_id}',to_jsonb(j)),'{policy_snapshot,badTargetResetBefore}','false');
 r2:=public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,token,unit,'v366:'||unit::text||':2',payload);
 PERFORM public.aka_agent_settle_action_results_v1(original.staff_id,c,original.account_id,token,unit,j,ARRAY[(r2->'detail'->>'id')::bigint],'{"status":"hoàn thành"}',NULL);
 settled:=public.aka_agent_settle_action_results_v1(original.staff_id,c,original.account_id,token,unit,i,ARRAY[(r->'detail'->>'id')::bigint],'{"status":"chờ xử lý","note":"must not change"}',NULL);
 SELECT count_consecutive_bad_targets INTO count_now FROM public.auto_campaign_error_state WHERE campaign_id=c;
 IF count_now<>2 OR settled->'input'->>'note'<>'preserved note' THEN RAISE EXCEPTION 'receipt replay changed state'; END IF;
 payload:=jsonb_set(payload #- '{policy_snapshot,badTargetResetBefore}','{input_data_id}',to_jsonb(k));
 r2:=public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,token,unit,'v366:'||unit::text||':3',payload);
 settled:=public.aka_agent_settle_action_results_v1(original.staff_id,c,original.account_id,token,unit,k,ARRAY[(r2->'detail'->>'id')::bigint],'{"status":"hoàn thành"}',NULL);
 IF settled->'settlement'->>'badTargetCount'<>'3' THEN RAISE EXCEPTION 'old payload changed'; END IF;
 rejected:=false;BEGIN
  PERFORM public.aka_agent_settle_action_results_v1(original.staff_id,c,original.account_id,token,gen_random_uuid(),i,ARRAY[(r->'detail'->>'id')::bigint],NULL,NULL);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='action_result_claim_invalid' THEN rejected:=true;ELSE RAISE;END IF;END;
 IF NOT rejected THEN RAISE EXCEPTION 'invalid claim accepted'; END IF;
 INSERT INTO public.auto_campaign_details(campaign_id,account_id,input_data_id,action_code,action_name,status,status_id,report_group,counts_toward_limit,policy_snapshot,log)
 SELECT c,original.account_id,i,'email_send','v366-rollback-smoke','thành công',s.id,'success',false,'{"countsTowardLimit":false,"reportGroup":"success"}','preserved Email log' FROM public.auto_status s WHERE code='campaign_detail_success'
 RETURNING id,to_jsonb(auto_campaign_details) INTO d,before_detail;
 INSERT INTO public.auto_email_message_trackings(campaign_id,account_id,input_data_id,recipient_email) VALUES(c,original.account_id,i,'rollback@example.invalid') RETURNING id,open_token INTO mt,ot;
 INSERT INTO public.auto_email_link_trackings(message_tracking_id,original_url,link_index) VALUES(mt,'https://example.invalid/',0) RETURNING click_token INTO ct;
 PERFORM public.aka_agent_mark_email_open(ot::text,'v366-rollback');
 UPDATE public.auto_email_message_trackings SET campaign_detail_id=d WHERE id=mt;
 IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_details x JOIN public.auto_status s ON s.id=x.sub_status_id WHERE x.id=d AND s.code='campaign_detail_viewed') THEN RAISE EXCEPTION 'early open lost'; END IF;
 PERFORM public.aka_agent_mark_email_click(ct::text,'v366-rollback');
 PERFORM public.aka_agent_mark_email_open(ot::text,'v366-rollback');
 UPDATE public.auto_email_message_trackings SET campaign_detail_id=d WHERE id=mt;
 SELECT to_jsonb(x) INTO after_detail FROM public.auto_campaign_details x WHERE x.id=d;
 IF (after_detail-'sub_status_id') IS DISTINCT FROM (before_detail-'sub_status_id') OR NOT EXISTS(SELECT 1 FROM public.auto_status WHERE id=(after_detail->>'sub_status_id')::bigint AND code='campaign_detail_clicked') THEN RAISE EXCEPTION 'tracking changed main result or downgraded'; END IF;
 PERFORM set_config('action_result.v366_smoke_detail',d::text,true);
END $test$;`;
const sigs=['aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)','aka_agent_project_linked_email_status_v366()'];
const receipt=`SELECT true verified,clock_timestamp()-transaction_timestamp() duration,(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl)) FROM pg_proc p WHERE p.oid IN (${sigs.map(s=>`to_regprocedure(${m.quote('public.'+s)})`).join(',')})) functions,(SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.auto_email_message_trackings'::regclass AND tgname='trg_aka_agent_project_linked_email_status_v366') trigger;`;
const applied=process.argv.includes('--applied');
const sql=(applied?"BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';COMMIT;":source).replace(/COMMIT;\s*$/,()=>`SAVEPOINT fixtures; SET LOCAL ROLE anon; ${tests} RESET ROLE; DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.auto_automation_detail WHERE source_campaign_detail_id=current_setting('action_result.v366_smoke_detail')::bigint) THEN RAISE EXCEPTION 'fixture unexpectedly linked to automation'; END IF; END $$; ROLLBACK TO fixtures; ${receipt} ROLLBACK;`);
const r=m.query(sql)[0];assert.equal(r.verified,true);assert.equal(r.functions.length,2);
fs.writeFileSync(path.join(dir,applied?'live-post-apply-smoke.json':'live-rollback-smoke.json'),JSON.stringify({at:new Date().toISOString(),project_ref:m.ref,migration_sha256:m.hash(source),rolled_back:true,role:'anon',...r},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:r.verified,duration:r.duration,rolled_back:true,functions:r.functions.map(f=>({signature:f.signature,md5:f.md5}))}));
