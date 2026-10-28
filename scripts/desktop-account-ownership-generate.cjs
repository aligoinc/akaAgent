// Generate only from the live capture made for this authorization.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const {privateSecurityAsset}=require('./desktop-session-rls/private-security-assets.cjs')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations/snapshots/desktop-account-ownership')
const m=JSON.parse(fs.readFileSync(privateSecurityAsset('migrations/snapshots/desktop-account-ownership/before.json'))),inputs=JSON.parse(fs.readFileSync(path.join(dir,'patch-inputs.json')))
const q=s=>"'"+String(s).replaceAll("'","''")+"'", ident=s=>'"'+s.replaceAll('"','""')+'"'
const canonical=f=>f.schema+'.'+f.signature.replace(/^(public|private|aka_agent_desktop_internal)\./,'')
const helper=`CREATE OR REPLACE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint DEFAULT NULL, p_account_id bigint DEFAULT NULL, p_campaign_id bigint DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
BEGIN
 IF v_staff IS NULL THEN RETURN true; END IF;
 IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied';
 END IF;
 -- Preserve each caller's existing not-found/cleanup semantics.
 IF p_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_account_scope_denied'; END IF;
 IF p_campaign_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=p_campaign_id AND staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_campaign_scope_denied'; END IF;
 RETURN true;
END;
$function$;`
const trigger=`CREATE OR REPLACE FUNCTION private.aka_agent_guard_parent_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request(); v_org bigint;
BEGIN
 IF v_staff IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF v_staff<=0 OR (TG_OP<>'INSERT' AND OLD.staff_id IS DISTINCT FROM v_staff)
   OR (TG_OP<>'DELETE' AND NEW.staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_parent_owner_denied'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.staff_id IS DISTINCT FROM OLD.staff_id THEN
   SELECT organization_id INTO v_org FROM public.org_staff WHERE id=v_staff;
   IF NEW.organization_id IS DISTINCT FROM v_org THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_parent_organization_denied'; END IF;
 END IF;
 IF TG_TABLE_NAME='auto_campaigns' THEN
   PERFORM private.aka_agent_assert_request_ownership(v_staff,NEW.account_id,NEW.id);
   PERFORM private.aka_agent_assert_request_ownership(v_staff,NEW.secondary_account_id,NULL);
 END IF;
 RETURN NEW;
END;
$function$;`
const functions=inputs.signatures.map(signature=>{
 const f=m.functions.find(x=>x.signature===signature);assert(f)
 const arg=(...names)=>names.find(n=>new RegExp('(?:^|, )'+n+' bigint(?:,| |$)').test(f.arguments))||'NULL'
 const args=[arg('p_staff_id','p_staff'),arg('p_account_id','p_account'),arg('p_campaign_id','p_campaign')]
 const call='private.aka_agent_assert_request_ownership('+args.join(', ')+')'
 let def=f.definition
 if(/LANGUAGE plpgsql/.test(def)){
  const body=def.indexOf('AS $function$');assert(body>=0)
  const match=/\bBEGIN\b/i.exec(def.slice(body));assert(match)
  const at=body+match.index+match[0].length
  def=def.slice(0,at)+'\n  PERFORM '+call+'; -- Bind Desktop token before privileged work.\n'+def.slice(at)
 }else{
  const match=/AS (\$\w*\$)([\s\S]*)\1/.exec(def);assert(match)
  const body=match[2].trim().replace(/;\s*$/,'')
  const wrapped='\n WITH desktop_request_guard AS MATERIALIZED (SELECT '+call+' AS allowed)\n SELECT result.* FROM desktop_request_guard\n CROSS JOIN LATERAL (\n'+body+'\n ) AS result WHERE desktop_request_guard.allowed;\n'
  def=def.slice(0,match.index)+'AS '+match[1]+wrapped+match[1]+def.slice(match.index+match[0].length)
 }
 return {...f,target_definition:def,target_checksum:crypto.createHash('md5').update(def).digest('hex'),guard_arguments:args}
})
const roots=['auto_accounts','auto_campaigns','auto_account_groups','auto_proxies']
const links={
 auto_account_action_status:{account_id:'auto_accounts'},auto_account_error_state:{account_id:'auto_accounts'},auto_account_logs:{account_id:'auto_accounts',campaign_id:'auto_campaigns'},
 auto_campaign_inputs:{campaign_id:'auto_campaigns'},auto_campaign_input_data:{campaign_id:'auto_campaigns',input_id:'auto_campaign_inputs'},
 auto_campaign_details:{campaign_id:'auto_campaigns',account_id:'auto_accounts',input_data_id:'auto_campaign_input_data'},auto_campaign_error_state:{campaign_id:'auto_campaigns'},
 auto_email_message_trackings:{campaign_id:'auto_campaigns',account_id:'auto_accounts',campaign_detail_id:'auto_campaign_details',input_data_id:'auto_campaign_input_data'},
 auto_email_link_trackings:{message_tracking_id:'auto_email_message_trackings'},
 auto_runs:{campaign_id:'auto_campaigns',account_id:'auto_accounts',campaign_detail_id:'auto_campaign_details',campaign_input_data_id:'auto_campaign_input_data'},
 auto_run_steps:{run_id:'auto_runs'},
 auto_campaign_zalo_realtime_group_events:{campaign_id:'auto_campaigns',account_id:'auto_accounts',input_data_id:'auto_campaign_input_data'},
 auto_campaign_run_events:{campaign_id:'auto_campaigns',account_id:'auto_accounts',campaign_input_id:'auto_campaign_inputs',campaign_input_data_id:'auto_campaign_input_data',run_id:'auto_runs',run_step_id:'auto_run_steps'},
 auto_zalo_api_error_logs:{account_id:'auto_accounts',campaign_id:'auto_campaigns',campaign_input_data_id:'auto_campaign_input_data',campaign_detail_id:'auto_campaign_details'},
 ai_log:{campaign_id:'auto_campaigns',account_id:'auto_accounts',campaign_input_id:'auto_campaign_inputs',campaign_input_data_id:'auto_campaign_input_data',run_id:'auto_runs',run_step_id:'auto_run_steps'}
}
const own='staff_id = (SELECT private.aka_agent_staff_scope_for_request())'
const ref=(table,col,parent)=>`(${ident(table)}.${ident(col)} IS NULL OR EXISTS (SELECT 1 FROM public.${ident(parent)} owned WHERE owned.id=${ident(table)}.${ident(col)}))`
const policies=roots.map(t=>({table:t,using:own,check:[own,...(t==='auto_campaigns'?[ref(t,'account_id','auto_accounts'),ref(t,'secondary_account_id','auto_accounts')]:t==='auto_accounts'?[ref(t,'account_group_id','auto_account_groups'),ref(t,'proxy_id','auto_proxies')]:[])].join(' AND ')}))
for(const [table,refs]of Object.entries(links)){
 const r=m.relations.find(x=>x.schema==='public'&&x.name===table);assert(r)
 const terms=Object.entries(refs).map(([col,parent])=>{assert(r.columns.some(c=>c.name===col));return ref(table,col,parent)})
 if(table==='auto_zalo_api_error_logs')terms.unshift('(staff_id IS NULL OR ('+own+'))')
 policies.push({table,using:terms.join(' AND '),check:terms.join(' AND ')})
}
const tables=policies.map(p=>p.table),sourcePolicies=m.policies.filter(p=>p.schemaname==='public'&&tables.includes(p.tablename))
const guardedFns=[...functions,m.functions.find(f=>f.signature==='private.aka_agent_staff_scope_for_request()')]
const functionGuard=guardedFns.map(f=>`IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(${q(canonical(f))}) AND md5(pg_get_functiondef(oid))=${q(f.checksum)} AND proacl::text IS NOT DISTINCT FROM ${f.acl===null?'NULL':q(f.acl)} AND pg_get_userbyid(proowner)=${q(f.owner)}) THEN RAISE EXCEPTION 'ownership function source drift: %',${q(f.signature)}; END IF;`).join('\n')
const relationGuards=tables.map(t=>{const r=m.relations.find(x=>x.schema==='public'&&x.name===t);assert(r.rls);return `IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.${t}'::regclass AND relrowsecurity=${r.rls} AND relforcerowsecurity=${r.force} AND relacl::text IS NOT DISTINCT FROM ${q(r.acl)} AND pg_get_userbyid(relowner)=${q(r.owner)}) THEN RAISE EXCEPTION 'ownership relation source drift: ${t}'; END IF;`}).join('\n')
const guard=`DO $guard$ BEGIN
${functionGuard}
${relationGuards}
IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN (to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)'),to_regprocedure('private.aka_agent_guard_parent_ownership()'))) THEN RAISE EXCEPTION 'ownership helper already exists'; END IF;
IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename=ANY(ARRAY[${tables.map(q).join(',')}])) IS DISTINCT FROM ${q(JSON.stringify(sourcePolicies))}::jsonb THEN RAISE EXCEPTION 'ownership policy source drift'; END IF;
END $guard$;`
const newHelpers=[['private.aka_agent_assert_request_ownership(bigint,bigint,bigint)',helper],['private.aka_agent_guard_parent_ownership()',trigger]]
const newSql=newHelpers.map(([sig,def])=>def+`\nREVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION ${sig} TO aka_agent_desktop,service_role,aka_agent_chat_api;`).join('\n')
const policySql=policies.map(p=>`CREATE POLICY desktop_owned_resource ON public.${ident(p.table)} AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (${p.using}) WITH CHECK (${p.check});`).join('\n')
const triggerSql=['auto_accounts','auto_campaigns'].map(t=>`CREATE TRIGGER aaa_desktop_parent_ownership BEFORE INSERT OR UPDATE OR DELETE ON public.${t} FOR EACH ROW EXECUTE FUNCTION private.aka_agent_guard_parent_ownership();`).join('\n')
const migration=`-- Live capture: ${path.relative(root,path.join(dir,'before.json'))}. No customer data changes.\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n${guard}\n${newSql}\n${functions.map(f=>f.target_definition+';').join('\n')}\n${policySql}\n${triggerSql}\nNOTIFY pgrst,'reload schema';\n`
const plan={functions,policies,newHelpers:newHelpers.map(([signature,definition])=>({signature,definition})),sourcePolicies,tables,sourceFunctionCount:m.functions.length}
fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan,null,2)+'\n')
fs.writeFileSync(path.join(root,'supabase/migrations/20261027183537_desktop_account_campaign_ownership.sql'),migration)
console.log(JSON.stringify({functions:functions.length,policies:policies.length,helpers:newHelpers.length,bytes:migration.length}))
