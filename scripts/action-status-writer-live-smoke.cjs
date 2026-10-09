const fs=require('fs'),path=require('path'),assert=require('assert/strict');const m=require('./action-status-policy-migration.cjs');
const dir=path.join(m.root,'migrations/snapshots/action-status-policies-v363');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const fixture=JSON.parse(fs.readFileSync(path.join(m.root,'migrations/snapshots/action-status-policies-v362/event-fixture-schema.json'),'utf8')).inputs[0];
const source=fs.readFileSync(path.join(m.root,'migrations/migration_v363_action_status_writer.sql'),'utf8');
const tests=`DO $test$ DECLARE
 original public.auto_campaigns%ROWTYPE;c bigint;i bigint; p public.auto_account_action_status_policies%ROWTYPE;
 token uuid:=gen_random_uuid();unit uuid:=gen_random_uuid();payload jsonb;r jsonb;again jsonb;settled jsonb;
 before_count integer;after_count integer;receipt bigint;rejected boolean;
BEGIN
 SELECT * INTO original FROM public.auto_campaigns WHERE id=${fixture.source_campaign_id};
 INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,runtime_claim_token,runtime_unit_token,runtime_unit_claimed_at)
 VALUES ('writer-rollback-smoke',original.action_id,original.account_id,original.staff_id,original.organization_id,'tạm dừng',token,unit,now()) RETURNING id INTO c;
 INSERT INTO public.auto_campaign_input_data(campaign_id,name,status) VALUES(c,'writer-rollback-smoke','đang chạy') RETURNING id INTO i;
 UPDATE public.auto_campaigns SET runtime_unit_input_data_ids=ARRAY[i] WHERE id=c;
 SELECT p2.* INTO p FROM public.auto_account_action_status_policies p2 JOIN public.auto_status s ON s.id=p2.status_id WHERE p2.action_code IS NULL AND s.code='campaign_detail_success';
 SELECT COALESCE(sum(count_action_in_day),0)::integer INTO before_count FROM public.auto_account_action_status WHERE account_id=original.account_id AND action_code='fb_add_friend' AND count_date=timezone('Asia/Ho_Chi_Minh',now())::date;
 payload:=jsonb_build_object('input_data_id',i,'action_code','fb_add_friend','action_name','writer-rollback-smoke','status','thành công','status_id',p.status_id,'action_status_policy_id',p.id,'log','existing message',
 'policy_snapshot',jsonb_build_object('reportGroup',p.report_group,'countsTowardLimit',true,'badTargetEffect','reset','resetErrorStreak',true,'inputEffect','complete','operationState','committed'));
 r:=public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,token,unit,'writer-rollback-smoke:'||unit::text,payload);
 receipt:=(r->'detail'->>'id')::bigint;
 again:=public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,token,unit,'writer-rollback-smoke:'||unit::text,payload);
 IF NOT (r->>'inserted')::boolean OR (again->>'inserted')::boolean OR (again->'detail'->>'id')::bigint<>receipt THEN RAISE EXCEPTION 'writer duplicate receipt'; END IF;
 SELECT count_action_in_day INTO after_count FROM public.auto_account_action_status WHERE account_id=original.account_id AND action_code='fb_add_friend';
 IF after_count<>before_count+1 THEN RAISE EXCEPTION 'writer counted duplicate'; END IF;
 settled:=public.aka_agent_settle_action_results_v1(original.staff_id,c,original.account_id,token,unit,i,ARRAY[receipt],'{"status":"hoàn thành","note":"existing note"}'::jsonb,'existing reason');
 again:=public.aka_agent_settle_action_results_v1(original.staff_id,c,original.account_id,token,unit,i,ARRAY[receipt],'{"status":"chờ xử lý","note":"must not overwrite"}'::jsonb,'must not overwrite');
 IF settled->'settlement' IS DISTINCT FROM again->'settlement' OR again->'input'->>'note'<>'existing note' THEN RAISE EXCEPTION 'writer settlement replay'; END IF;
 rejected:=false;BEGIN
  PERFORM public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,token,gen_random_uuid(),'invalid',payload);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='action_result_claim_invalid' THEN rejected:=true;ELSE RAISE;END IF;END;
 IF NOT rejected THEN RAISE EXCEPTION 'writer accepted invalid token'; END IF;
 PERFORM set_config('action_result.smoke_detail_id',receipt::text,true);
END $test$;`;
const receipt=`SELECT true verified,clock_timestamp()-transaction_timestamp() duration,(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl)) FROM pg_proc p WHERE p.oid IN (${manifest.new_functions.map(f=>`to_regprocedure('public.${f}')`).join(',')})) functions;`;
const executedSource=process.argv.includes('--applied') ? "BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';COMMIT;" : source;
const sql=executedSource.replace(/COMMIT;\s*$/,()=>`SAVEPOINT fixtures;SET LOCAL ROLE anon;${tests}RESET ROLE;DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.auto_automation_detail WHERE source_campaign_detail_id=current_setting('action_result.smoke_detail_id')::bigint) THEN RAISE EXCEPTION 'writer fixture unexpectedly linked to automation'; END IF;END $$;ROLLBACK TO fixtures;${receipt}ROLLBACK;`);
const r=m.query(sql)[0];assert.equal(r.verified,true);assert.equal(r.functions.length,3);
fs.writeFileSync(path.join(dir,process.argv.includes('--applied')?'live-writer-post-apply-smoke.json':'live-writer-smoke.json'),JSON.stringify({at:new Date().toISOString(),project_ref:m.ref,migration_sha256:m.hash(source),rolled_back:true,role:'anon',...r},null,2)+'\n');
console.log(JSON.stringify({functions:r.functions.length,duration:r.duration,rolled_back:true,external_operations:0}));
