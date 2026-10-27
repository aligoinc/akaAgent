/* Generates a reviewable, fail-closed manual cutover from this task's live captures.
 * It never connects to a database. Do not run the generated SQL on production yet. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'migrations/snapshots/desktop-session-rls')
if(fs.existsSync(path.join(dir,'least-privilege-plan.json'))) throw new Error('Legacy generator retired: it would overwrite applied A and restore excess Desktop privileges. Recapture live ACLs and prepare a new least-privilege cutover after explicit user approval.')
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))
const source=read('entry-functions.json'),invokers=[...new Map([...read('invoker-functions.json'),...read('trigger-invoker-functions.json')].map(f=>[f.signature,f])).values()]
const inbound=read('inbound-functions.json'),schema=read('protected-schema.json'),relations=read('relation-acls.json')
const privateHelpers=read('private-runtime-dependencies.json').filter(f=>f.acl?.includes('anon=X'))
// A SECURITY DEFINER helper can expose worker credentials without mentioning a
// protected table. Include this captured dependency in ACL transfer and guards.
const vaultHelper=read('vault-helper-preflight.json').function
assert.deepEqual(vaultHelper,read('trigger-function-dependencies.json').find(f=>f.signature===vaultHelper.signature),'Vault helper capture drift')
const baseline=[...new Map([...inbound,...source,...invokers,vaultHelper].map(f=>[f.signature,f])).values()]
const q=s=>"'"+String(s).replaceAll("'","''")+"'",name=f=>f.signature.split('(')[0]
const bootstrap=new Set(['aka_agent_staff_client','aka_agent_staff_access','aka_agent_recover_staff_credentials',
 'aka_agent_staff_security_status','aka_agent_prepare_device_change','aka_agent_prepare_device_change_v2',
 'aka_agent_reset_device_binding','aka_agent_reset_device_binding_v2','akamap_staff_client'])
const policyBaseline=schema.policies.map(p=>({...p})).sort((a,b)=>a.tablename===b.tablename?(a.policyname>b.policyname?1:-1):(a.tablename>b.tablename?1:-1))
const columnBaseline=relations.flatMap(t=>t.columns.filter(c=>c.acl).map(c=>({table:t.name,column:c.name,acl:c.acl})))
let sql=`-- MANUAL ACTIVATION CANDIDATE. Requires compatible clients and explicit operator approval.\nBEGIN;\nSET LOCAL lock_timeout='3s';\nDO $approval$ BEGIN\n IF current_setting('aka_agent.desktop_rls_cutover',true) IS DISTINCT FROM 'approved-after-client-update' THEN\n  RAISE EXCEPTION 'STOP: Desktop RLS activation requires explicit approval AFTER client updates';\n END IF;\nEND $approval$;\n`

// Reject metadata drift before changing access. Existing RPC bodies are never replaced.
sql+=`DO $rpc_baseline$ DECLARE r record; p record; BEGIN\n FOR r IN SELECT * FROM jsonb_to_recordset(${q(JSON.stringify([...baseline,...privateHelpers].map(f=>({signature:f.signature.startsWith('private.')?f.signature:'public.'+f.signature,checksum:f.checksum,owner:f.owner,security_definer:f.security_definer,volatility:f.volatility,config:f.config,acl:f.acl}))))}::jsonb) AS x(signature text,checksum text,owner text,security_definer boolean,volatility text,config text[],acl text) LOOP\n SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);\n IF NOT FOUND OR md5(pg_get_functiondef(p.oid))<>r.checksum OR pg_get_userbyid(p.proowner)<>r.owner\n OR p.prosecdef<>r.security_definer OR p.provolatile::text<>r.volatility OR p.proconfig IS DISTINCT FROM r.config\n OR p.proacl::text IS DISTINCT FROM r.acl THEN RAISE EXCEPTION 'Desktop RLS RPC drift: %',r.signature; END IF;\n END LOOP;\nEND $rpc_baseline$;\n`
sql+=`DO $table_baseline$ DECLARE r record; c record; BEGIN\n FOR r IN SELECT * FROM jsonb_to_recordset(${q(JSON.stringify(relations.map(t=>({name:t.name,kind:t.kind,owner:t.owner,rls:t.rls,force:t.force,acl:t.acl,options:t.options,view:t.view}))))}::jsonb) AS x(name text,kind text,owner text,rls boolean,force boolean,acl text,options text[],view text) LOOP\n SELECT * INTO c FROM pg_class WHERE oid=to_regclass(format('public.%I',r.name));\n IF NOT FOUND OR c.relkind::text<>r.kind OR pg_get_userbyid(c.relowner)<>r.owner OR c.relrowsecurity<>r.rls\n OR c.relforcerowsecurity<>r.force OR c.relacl::text IS DISTINCT FROM r.acl OR c.reloptions IS DISTINCT FROM r.options\n OR (r.view IS NOT NULL AND pg_get_viewdef(c.oid,true) IS DISTINCT FROM r.view) THEN RAISE EXCEPTION 'Desktop RLS relation drift: %',r.name; END IF;\n END LOOP;\nEND $table_baseline$;\n`
// Verify existing policies and role metadata; do not activate the older staff phase C.
sql+=`DO $policy_baseline$ DECLARE actual jsonb; BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.tablename COLLATE "C",p.policyname COLLATE "C"),'[]') INTO actual
 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=ANY(ARRAY[${relations.map(t=>q(t.name)).join(',')}]);
 IF actual IS DISTINCT FROM ${q(JSON.stringify(policyBaseline))}::jsonb THEN RAISE EXCEPTION 'Desktop RLS policy drift'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl::text) ORDER BY c.relname COLLATE "C",a.attname COLLATE "C"),'[]') INTO actual
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${relations.map(t=>q(t.name)).join(',')}]) AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL;
 IF actual IS DISTINCT FROM ${q(JSON.stringify(columnBaseline.sort((a,b)=>a.table===b.table?(a.column>b.column?1:-1):(a.table>b.table?1:-1))))}::jsonb THEN RAISE EXCEPTION 'Desktop RLS column ACL drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aka_agent_desktop' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit AND rolconfig=ARRAY['statement_timeout=3s','lock_timeout=8s'])
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='aka_agent_desktop')) THEN RAISE EXCEPTION 'Desktop role drift'; END IF;
END $policy_baseline$;\n`

const originalGuards=sql.slice(sql.indexOf('DO $rpc_baseline$'))
let compatibility=''
const ident=s=>'"'+s.replaceAll('"','""')+'"'
const permissionNames={X:'EXECUTE',a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',U:'USAGE'}
function permissions(raw,who,kind){
 if(raw===null)return who==='PUBLIC'&&kind==='FUNCTION'?['EXECUTE']:[]
 const result=new Set()
 for(const entry of raw.slice(1,-1).split(',').filter(Boolean)){
  const [role,tail]=entry.split('=');if((role||'PUBLIC')!==who)continue
  for(const letter of tail.split('/')[0])if(letter!=='*'){assert(permissionNames[letter],entry);result.add(permissionNames[letter])}
 }
 return [...result]
}
const oldAnon=(raw,kind)=>[...new Set([...permissions(raw,'PUBLIC',kind),...permissions(raw,'anon',kind)])]
function grant(privileges,object,roles,column=null){
 if(privileges.length){
  const statement=`GRANT ${privileges.map(p=>p+(column?' ('+ident(column)+')':'')).join(',')} ON ${object} TO ${roles};\n`
  sql+=statement
  if(roles==='aka_agent_desktop')compatibility+=statement
 }
}
// Copy effective anon ACLs exactly, then withdraw the anonymous entry point.
// No new row ownership, staff/org consistency, parent-ID or RPC actor checks.
const trusted='service_role,aka_agent_chat_api,crm_interest_worker'
const policies=[]
for(const t of relations){
 const object='TABLE public.'+ident(t.name)
 grant(permissions(t.acl,'PUBLIC','TABLE'),object,trusted)
 grant(oldAnon(t.acl,'TABLE'),object,'aka_agent_desktop')
 sql+=`REVOKE ALL ON ${object} FROM PUBLIC,anon,authenticated;\n`
 for(const col of t.columns.filter(c=>c.acl)){
  grant(permissions(col.acl,'PUBLIC','TABLE'),object,trusted,col.name)
  grant(oldAnon(col.acl,'TABLE'),object,'aka_agent_desktop',col.name)
  sql+=`REVOKE ALL (${ident(col.name)}) ON ${object} FROM PUBLIC,anon,authenticated;\n`
 }
 if(t.kind!=='r'&&t.kind!=='p')continue
 if(!t.rls){
  // This table had no row restrictions. Preserve that for the new login role.
  sql+=`ALTER TABLE public.${ident(t.name)} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY desktop_legacy_access ON public.${ident(t.name)} TO aka_agent_desktop USING (true) WITH CHECK (true);\n`
  policies.push({table:t.name,name:'desktop_legacy_access',cmd:'ALL',qual:'true',with_check:'true',origin:'previously RLS disabled'})
 }else{
  // Existing enabled-RLS tables keep their exact predicates and operations.
  // PUBLIC policies already apply to the new role; don't duplicate those.
  for(const [i,p] of schema.policies.filter(p=>p.tablename===t.name&&p.roles.includes('anon')&&!p.roles.includes('public')).entries()){
   const name='desktop_legacy_'+i
   compatibility+=`CREATE POLICY ${name} ON public.${ident(t.name)} AS ${p.permissive} FOR ${p.cmd} TO aka_agent_desktop${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};\n`
   policies.push({table:t.name,name,cmd:p.cmd,qual:p.qual,with_check:p.with_check,origin:p.policyname,permissive:p.permissive})
  }
 }
}
// SECURITY DEFINER and SECURITY INVOKER functions retain exact bodies, signatures,
// owner/security settings, local timeouts and existing business validation.
let grantedRpcs=0
for(const f of baseline){
 const object='FUNCTION public.'+f.signature
 grant(oldAnon(f.acl,'FUNCTION'),object,'aka_agent_desktop')
 if(oldAnon(f.acl,'FUNCTION').length)grantedRpcs++
 if(bootstrap.has(name(f)))continue // Existing credential/proof-checked bootstrap.
 grant(permissions(f.acl,'PUBLIC','FUNCTION'),object,trusted)
 sql+=`REVOKE ALL ON ${object} FROM PUBLIC,anon,authenticated;\n`
}
sql+='GRANT USAGE ON SCHEMA private TO aka_agent_desktop;\n'
compatibility+='GRANT USAGE ON SCHEMA private TO aka_agent_desktop;\n'
for(const f of privateHelpers)grant(oldAnon(f.acl,'FUNCTION'),'FUNCTION '+f.signature,'aka_agent_desktop')
const sequenceNames=new Set(relations.flatMap(t=>t.columns.flatMap(c=>c.sequence?[c.sequence.split('.')[1]]:[])))
const sequences=read('sequences.json').filter(s=>sequenceNames.has(s.name))
// Preflight sequence ACLs too: same effective access must transfer without
// removing an operator's newer grant or accidentally opening another sequence.
let sequenceGuard=`DO $sequence_baseline$ DECLARE r record; c record; BEGIN\n FOR r IN SELECT * FROM jsonb_to_recordset(${q(JSON.stringify(sequences))}::jsonb) AS x(name text,owner text,acl text) LOOP\n SELECT * INTO c FROM pg_class WHERE oid=to_regclass(format('public.%I',r.name));\n IF NOT FOUND OR c.relkind<>'S' OR pg_get_userbyid(c.relowner)<>r.owner OR c.relacl::text IS DISTINCT FROM r.acl THEN RAISE EXCEPTION 'Desktop sequence drift: %',r.name; END IF;\n END LOOP; END $sequence_baseline$;\n`
sql=sql.replace('DO $table_baseline$',sequenceGuard+'DO $table_baseline$')
for(const seq of sequences){
 const object='SEQUENCE public.'+ident(seq.name)
 grant(permissions(seq.acl,'PUBLIC','SEQUENCE'),object,trusted)
 grant(oldAnon(seq.acl,'SEQUENCE'),object,'aka_agent_desktop')
 sql+=`REVOKE ALL ON ${object} FROM PUBLIC,anon,authenticated;\n`
}

// Stage A adds only the new login role's access; old clients keep every right.
// Stage B below is separately guarded and cannot revoke anon automatically.
const prepGuards=originalGuards.replace('DO $table_baseline$',sequenceGuard+'DO $table_baseline$')
const identityPath=path.join(root,'supabase/migrations/20261027095004_desktop_session_identity.sql')
const marker='-- BEGIN GENERATED TOKEN COMPATIBILITY'
let identity=fs.readFileSync(identityPath,'utf8').split(marker)[0]
identity=identity.replace(/NOTIFY pgrst,'reload schema';\s*COMMIT;\s*$/,'')
fs.writeFileSync(identityPath,identity+marker+'\n-- No existing permissions are revoked; no business table RLS is enabled here.\n'+prepGuards+compatibility+`NOTIFY pgrst,'reload schema';\nNOTIFY pgrst,'reload config';\nCOMMIT;\n`)
fs.writeFileSync(path.join(dir,'compatibility-grants.sql'),compatibility)
// The cutover accepts only the captured baseline plus the prepared Desktop grants.
// Strip that one new grantee when comparing original ACLs. Privilege rows retain
// original order/grant options; null defaults expand exactly as PostgreSQL does.
const strip=(expr,kind,owner)=>`ARRAY(SELECT a FROM unnest(coalesce(${expr},acldefault('${kind}',${owner}))) a WHERE split_part(a::text,'=',1)<>'aka_agent_desktop')::text`
sql=sql.replace('p.proacl::text IS DISTINCT FROM r.acl',`${strip('p.proacl','f','p.proowner')} IS DISTINCT FROM coalesce(r.acl,acldefault('f',p.proowner)::text)`)
sql=sql.replace('c.relacl::text IS DISTINCT FROM r.acl',`${strip('c.relacl','S','c.relowner')} IS DISTINCT FROM coalesce(r.acl,acldefault('S',c.relowner)::text)`)
sql=sql.replace('c.relacl::text IS DISTINCT FROM r.acl',`${strip('c.relacl','r','c.relowner')} IS DISTINCT FROM coalesce(r.acl,acldefault('r',c.relowner)::text)`)
sql=sql.replace("'acl',a.attacl::text","'acl',ARRAY(SELECT v FROM unnest(a.attacl) v WHERE split_part(v::text,'=',1)<>'aka_agent_desktop')::text")
const preparedPolicies=policies.filter(p=>p.origin!=='previously RLS disabled').map(p=>({schemaname:'public',tablename:p.table,policyname:p.name,permissive:p.permissive,roles:['aka_agent_desktop'],cmd:p.cmd,qual:p.qual,with_check:p.with_check}))
const activationPolicies=[...policyBaseline,...preparedPolicies].sort((a,b)=>a.tablename===b.tablename?(a.policyname>b.policyname?1:-1):(a.tablename>b.tablename?1:-1))
sql=sql.replace(q(JSON.stringify(policyBaseline)),q(JSON.stringify(activationPolicies)))
sql+=`NOTIFY pgrst,'reload schema';\nNOTIFY pgrst,'reload config';\nCOMMIT;\n`
assert(!/CREATE(?: OR REPLACE)? FUNCTION|ALTER FUNCTION/.test(sql),'Activation must not change any RPC definition')
fs.writeFileSync(path.join(root,'supabase/migrations/20261027100931_desktop_data_rls_activation.sql'),sql)
fs.writeFileSync(path.join(dir,'policy-matrix.json'),JSON.stringify(policies,null,2)+'\n')
console.log(JSON.stringify({changedRpcBodies:0,grantedRpcs,protectedRelations:relations.length,policies:policies.length,bytes:sql.length}))
