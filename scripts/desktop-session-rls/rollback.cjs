// Generate guarded rollback from a successfully applied disposable fixture.
// No production execution. Reopens legacy privileges only on explicit approval.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'migrations/snapshots/desktop-session-rls')
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n))),q=s=>"'"+String(s).replaceAll("'","''")+"'",id=s=>'"'+s.replaceAll('"','""')+'"'
const relations=read('relation-acls.json'),inbound=[...new Map([...read('inbound-functions.json'),...read('entry-functions.json'),...read('invoker-functions.json'),...read('trigger-invoker-functions.json'),read('vault-helper-preflight.json').function,...read('private-runtime-dependencies.json').filter(f=>f.acl?.includes('anon=X'))].map(f=>[f.signature,f])).values()],sequenceNames=[...new Set(relations.flatMap(t=>t.columns.flatMap(c=>c.sequence?[c.sequence.split('.')[1]]:[])))]
const sequences=read('sequences.json').filter(s=>sequenceNames.includes(s.name))
const acl=(expr,def)=>`(SELECT coalesce(jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type,a.is_grantable) ORDER BY a.grantee=0 DESC,pg_get_userbyid(a.grantee) COLLATE "C",a.privilege_type COLLATE "C"),'[]') FROM aclexplode(nullif(coalesce(${expr},${def}),'{}'::aclitem[])) a)`
const stateSql=`SELECT jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',${acl('c.relacl',"acldefault('r',c.relowner)")},'options',c.reloptions,'columns',(SELECT coalesce(jsonb_agg(jsonb_build_array(a.attname,${acl('a.attacl',"'{}'::aclitem[]")}) ORDER BY a.attname COLLATE "C"),'[]') FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname COLLATE "C") FROM pg_class c WHERE c.oid IN(${relations.map(t=>q('public.'+t.name)+'::regclass').join(',')})),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',${acl('p.proacl',"acldefault('f',p.proowner)")}) ORDER BY p.oid::regprocedure::text COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ((p.oid=ANY(ARRAY[${inbound.map(f=>q(f.signature.startsWith('private.')?f.signature:'public.'+f.signature)+'::regprocedure').join(',')}]) OR (n.nspname='public' AND p.proname LIKE 'aka_agent_desktop_%'))) OR n.nspname='aka_agent_desktop_internal'),
 'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.tablename COLLATE "C",p.policyname COLLATE "C"),'[]') FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=ANY(ARRAY[${relations.map(t=>q(t.name)).join(',')}])),
 'sequences',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'acl',${acl('c.relacl',"acldefault('S',c.relowner)")}) ORDER BY c.relname COLLATE "C") FROM pg_class c WHERE c.oid=ANY(ARRAY[${sequences.map(s=>q('public.'+s.name)+'::regclass').join(',')}])))`
function snapshot(sql){return JSON.parse(sql(stateSql+';'))}
function restoreAcl(kind,object,raw,owner='postgres',column=null){
 // Reset every currently granted role, then restore original effective ACLs.
 const aclQuery=kind==='FUNCTION'?`SELECT proacl acl FROM pg_proc WHERE oid=${q(object)}::regprocedure`:column?`SELECT attacl acl FROM pg_attribute WHERE attrelid=${q(object)}::regclass AND attname=${q(column)}`:`SELECT relacl acl FROM pg_class WHERE oid=${q(object)}::regclass`
 const target=kind+' '+object,priv=column?'ALL ('+id(column)+')':'ALL'
 let sql=`DO $acl$ DECLARE r record; BEGIN FOR r IN SELECT DISTINCT grantee FROM (${aclQuery}) x CROSS JOIN LATERAL aclexplode(nullif(x.acl,'{}'::aclitem[])) LOOP EXECUTE ${q('REVOKE '+priv+' ON '+target+' FROM ')}||CASE WHEN r.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END; END LOOP; END $acl$;\n`
 const entries=raw===null?(kind==='FUNCTION'?[`=X/${owner}`,`${owner}=X/${owner}`]:column?[]:[`${owner}=${kind==='SEQUENCE'?'rwU':'arwdDxtm'}/${owner}`]):raw.slice(1,-1).split(',').filter(Boolean)
 const names={X:'EXECUTE',a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',U:'USAGE'}
 for(const e of entries){const [who,rest]=e.split('='),privs=rest.split('/')[0];for(let i=0;i<privs.length;i++){const p=privs[i];if(p==='*')continue;assert(names[p],e);sql+=`GRANT ${names[p]}${column?' ('+id(column)+')':''} ON ${target} TO ${who?id(who):'PUBLIC'}${privs[i+1]==='*'?' WITH GRANT OPTION':''};\n`}}
 return sql
}
function generateRollback(after){
 if(fs.existsSync(path.join(dir,'least-privilege-plan.json'))) throw new Error('Legacy rollback retired: it would restore excess Desktop privileges. Rebuild from a newly approved cutover baseline.')
 let result=`-- Reopens legacy access. Manual rollback after switching clients back.\nBEGIN;\nSET LOCAL lock_timeout='3s';\nDO $approved$ BEGIN IF current_setting('aka_agent.desktop_rls_rollback',true) IS DISTINCT FROM 'approved-legacy-access-reopens' THEN RAISE EXCEPTION 'STOP: rollback reopens anonymous legacy data access'; END IF; END $approved$;\n`
 result+=`DO $guard$ DECLARE actual jsonb; BEGIN ${stateSql.replace(/^SELECT /,'SELECT ').replace(/\)$/,') INTO actual')}; IF actual IS DISTINCT FROM ${q(JSON.stringify(after))}::jsonb THEN RAISE EXCEPTION 'Desktop rollback drift; capture live changes before restoring'; END IF; END $guard$;\n`
 for(const t of relations){
  for(const policy of read('policy-matrix.json').filter(p=>p.table===t.name))result+=`DROP POLICY ${id(policy.name)} ON public.${id(t.name)};\n`
  if(t.kind==='r'||t.kind==='p')result+=`ALTER TABLE public.${id(t.name)} ${t.rls?'ENABLE':'DISABLE'} ROW LEVEL SECURITY;\n`
  result+=restoreAcl('TABLE','public.'+id(t.name),t.acl,t.owner)
  for(const c of t.columns)result+=restoreAcl('TABLE','public.'+id(t.name),c.acl,t.owner,c.name)
 }
 for(const f of inbound)result+=restoreAcl('FUNCTION',f.signature.startsWith('private.')?f.signature:'public.'+f.signature,f.acl,f.owner)
 for(const s of sequences)result+=restoreAcl('SEQUENCE','public.'+id(s.name),s.acl,s.owner)
 result+=fs.readFileSync(path.join(dir,'compatibility-grants.sql'),'utf8')
 result+=`NOTIFY pgrst,'reload schema';\nCOMMIT;\n`
 return result
}
module.exports={stateSql,snapshot,generateRollback}
if(require.main===module){
 const {createFixture}=require('./full-fixture.cjs'),f=createFixture()
 try{
  f.sql(f.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027095004_desktop_session_identity.sql'),'utf8')))
  const before=snapshot(f.sql)
  f.sql("SET aka_agent.desktop_rls_cutover='approved-after-client-update';\n"+f.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027100931_desktop_data_rls_activation.sql'),'utf8')))
  const after=snapshot(f.sql),rollback=generateRollback(after)
  // A manual state change must prevent rollback, even when the function body did not change.
  assert.throws(()=>f.sql("BEGIN; GRANT SELECT ON public.auto_accounts TO anon; SET LOCAL aka_agent.desktop_rls_rollback='approved-legacy-access-reopens';\n"+rollback.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,'')+'\nROLLBACK;'),/rollback drift/)
  assert.throws(()=>f.sql("BEGIN; GRANT EXECUTE ON FUNCTION public.aka_agent_get_vault_secret(text) TO anon; SET LOCAL aka_agent.desktop_rls_rollback='approved-legacy-access-reopens';\n"+rollback.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,'')+'\nROLLBACK;'),/rollback drift/)
  f.sql("SET aka_agent.desktop_rls_rollback='approved-legacy-access-reopens';\n"+rollback)
  assert.deepEqual(snapshot(f.sql),before)
  fs.writeFileSync(path.join(root,'migrations/rollback_desktop_data_rls_activation.sql'),rollback)
  fs.writeFileSync(path.join(dir,'post-cutover-state.json'),JSON.stringify(after,null,2)+'\n')
  console.log('PASS guarded activation rollback restores exact effective table/column/RPC/sequence permissions, policies and function definitions')
 }finally{f.close()}
}
