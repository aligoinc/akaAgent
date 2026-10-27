// Metadata-only reconstruction in a disposable local PostgreSQL 17 cluster.
// No production credentials, customer rows, cron jobs or external HTTP extensions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'migrations/snapshots/desktop-session-rls')
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'))
const quote=s=>"'"+String(s).replaceAll("'","''")+"'",ident=s=>'"'+s.replaceAll('"','""')+'"'
function createFixture(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-rls-full-')),bin=process.env.DESKTOP_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin'
 const run=(name,args,input)=>{const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',input,maxBuffer:32*1024*1024});if(r.status!==0)throw Error((r.stderr||r.stdout).slice(-12000));return r.stdout}
 const sql=s=>run('psql',['-X','-h',tmp,'-p','55494','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],s).trim()
 run('initdb',['-D',path.join(tmp,'db'),'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
 run('pg_ctl',['-D',path.join(tmp,'db'),'-l',path.join(tmp,'log'),'-o',`-h '' -k ${tmp} -p 55494`,'-w','start'])
 const close=()=>{run('pg_ctl',['-D',path.join(tmp,'db'),'-m','immediate','-w','stop']);fs.rmSync(tmp,{recursive:true,force:true})}
 try{
  const data=read('fixture-schema.json'),constraints=read('fixture-constraints.json'),protectedSchema=read('protected-schema.json')
  sql(`CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE authenticator NOINHERIT;
    CREATE ROLE service_role BYPASSRLS; CREATE ROLE aka_agent_chat_api BYPASSRLS; CREATE ROLE crm_interest_worker BYPASSRLS;
    CREATE ROLE aka_message_ingest_owner; CREATE ROLE supabase_auth_admin; CREATE ROLE supabase_admin;
    GRANT USAGE ON SCHEMA public,private,auth TO anon,authenticated,service_role,aka_agent_chat_api,crm_interest_worker;
    ALTER ROLE anon SET statement_timeout='3s'; ALTER ROLE authenticated SET statement_timeout='8s';
    ALTER ROLE authenticator SET statement_timeout='8s'; ALTER ROLE authenticator SET lock_timeout='8s';
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,role text,raw_app_meta_data jsonb);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  `)
  const tableSql=[]
  for(const t of data.public_tables)tableSql.push(`CREATE TABLE public.${ident(t.name)} (${t.columns.map(c=>{
   // Unrelated vector-search tables are only row-type placeholders for legacy
   // views. No vector object is in the security scope or exercised by this test.
   const type=/^(?:extensions\.)?vector\(/.test(c.type)&&!protectedSchema.tables.some(p=>p.name===t.name)?'text':c.type
   return ident(c.name)+' '+type
  }).join(',')});`)
  for(const t of data.private_tables)tableSql.push(`CREATE TABLE private.${ident(t.name)} (${t.columns.map(c=>ident(c.name)+' '+c.type).join(',')}); ALTER TABLE private.${ident(t.name)} ENABLE ROW LEVEL SECURITY;`)
  sql(tableSql.join('\n'))
  for(const c of constraints.filter(c=>!c.definition.startsWith('FOREIGN KEY')))sql(`ALTER TABLE public.${ident(c.relation)} ADD CONSTRAINT ${ident(c.conname)} ${c.definition};`)
  const sequences=new Set(data.relations.flatMap(t=>t.columns.flatMap(c=>c.sequence?[c.sequence]:[])))
  sql([...sequences].map(s=>`CREATE SEQUENCE ${s};`).join('\n'))
  const sequencePermissions={r:'SELECT',w:'UPDATE',U:'USAGE'}
  for(const s of read('sequences.json').filter(s=>sequences.has('public.'+s.name)&&s.acl)){
   sql(`REVOKE ALL ON SEQUENCE public.${ident(s.name)} FROM PUBLIC;`)
   for(const e of s.acl.slice(1,-1).split(',').filter(Boolean)){
    const [who,rest]=e.split('='),privs=rest.split('/')[0]
    sql(`GRANT ${[...privs].filter(c=>c!=='*').map(c=>sequencePermissions[c]).join(',')} ON SEQUENCE public.${ident(s.name)} TO ${who?ident(who):'PUBLIC'}${privs.includes('*')?' WITH GRANT OPTION':''};`)
   }
  }
  sql(data.relations.flatMap(t=>t.columns.filter(c=>c.sequence).map(c=>`ALTER TABLE public.${ident(t.name)} ALTER COLUMN ${ident(c.name)} SET DEFAULT nextval(${quote(c.sequence)});`)).join('\n'))
  sql('CREATE UNIQUE INDEX fixture_zalo_uid ON public.zalo_accounts(zalo_uid);')
  const views=data.relations.filter(t=>t.kind==='v')
  sql('SET check_function_bodies=off;\n'+read('fixture-view-functions.json').map(f=>f.definition+';').join('\n'))
  for(const v of views)sql(`CREATE VIEW public.${ident(v.name)}${v.options?.length?' WITH ('+v.options.join(',')+')':''} AS ${v.view}`)
  // Parsing bodies is deferred; functions outside the tested path may reference
  // cron/HTTP extensions intentionally absent from this local fixture.
  const functions=[...read('fixture-public-functions.json'),...read('trigger-function-dependencies.json'),...data.private_functions]
  sql('SET check_function_bodies=off;\n'+functions.map(f=>f.definition+';').join('\n'))
  const aclSql=[]
  const tablePerms={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'}
  function restoreAcl(kind,object,acl,owner){
   if(acl===null)return
   aclSql.push(`REVOKE ALL ON ${kind} ${object} FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api,crm_interest_worker,${ident(owner)};`)
   for(const e of acl.slice(1,-1).split(',').filter(Boolean)){
    const [who,rest]=e.split('='),privs=rest.split('/')[0]
    if(kind==='FUNCTION')aclSql.push(`GRANT EXECUTE ON FUNCTION ${object} TO ${who?ident(who):'PUBLIC'};`)
    else {
     const permissions=[...privs].filter(c=>c!=='*').map(c=>tablePerms[c]);if(permissions.some(x=>!x))throw Error('Unknown table ACL '+e)
     aclSql.push(`GRANT ${permissions.join(',')} ON TABLE ${object} TO ${who?ident(who):'PUBLIC'}${privs.includes('*')?' WITH GRANT OPTION':''};`)
    }
   }
  }
  for(const f of functions)restoreAcl('FUNCTION',(f.signature.startsWith('private.')?'':'public.')+f.signature,f.acl,f.owner)
  for(const t of data.relations){
   restoreAcl('TABLE','public.'+ident(t.name),t.acl,t.owner)
   if(t.rls)aclSql.push(`ALTER TABLE public.${ident(t.name)} ENABLE ROW LEVEL SECURITY;`)
   for(const c of t.columns.filter(c=>c.acl))for(const e of c.acl.slice(1,-1).split(',').filter(Boolean)){
    const [who,rest]=e.split('='),privs=rest.split('/')[0];aclSql.push(`GRANT ${[...privs].filter(x=>x!=='*').map(x=>tablePerms[x]+'('+ident(c.name)+')').join(',')} ON public.${ident(t.name)} TO ${who?ident(who):'PUBLIC'};`)
   }
  }
  sql(aclSql.join('\n'))
  sql(protectedSchema.policies.map(p=>`CREATE POLICY ${ident(p.policyname)} ON public.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(ident).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};`).join('\n'))
  for(const t of data.staff_triggers.filter(t=>['aka_agent_invalidate_staff_recovery','aka_agent_track_device_binding'].includes(t.name)))sql(t.definition+';')
  const index=data.staff_indexes.find(i=>i.name==='org_staff_aka_agent_device_identity_idx');sql(index.definition+';')
  sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;')
  // pg_get_viewdef output is not always text-roundtrippable: reparsing a UNION
  // adds implicit aliases/ELSE NULL. Normalize only fixture view baselines;
  // the production migration keeps the exact live capture and is checked live.
  const baseline=read('relation-acls.json').map(t=>({name:t.name,kind:t.kind,owner:t.owner,rls:t.rls,force:t.force,acl:t.acl,options:t.options,view:t.view}))
  const normalized=baseline.map(t=>({...t,view:t.view===null?null:sql(`SELECT pg_get_viewdef('public.${t.name}'::regclass,true);`)}))
  // psql trim removes the final newline; pg_get_viewdef itself includes it.
  for(const t of normalized)if(t.view!==null){t.view=JSON.parse(sql(`SELECT to_json(pg_get_viewdef('public.${t.name}'::regclass,true));`))}
  const localActivation=s=>s.replace(quote(JSON.stringify(baseline)),quote(JSON.stringify(normalized)))
  const installTriggers=()=>{for(const t of read('triggers.json')){sql(`DROP TRIGGER IF EXISTS ${ident(t.name)} ON public.${ident(t.relation)}; ${t.definition};`)}}
  return {sql,close,tmp,quote,root,localActivation,installTriggers}
 }catch(error){close();throw error}
}
module.exports={createFixture}
if(require.main===module){const fixture=createFixture();try{console.log('PASS full metadata fixture created');fixture.sql(fixture.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027095004_desktop_session_identity.sql'),'utf8')));console.log('PASS additive identity migration');fixture.sql("SET aka_agent.desktop_rls_cutover='approved-after-client-update';\n"+fixture.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027100931_desktop_data_rls_activation.sql'),'utf8')));console.log('PASS full activation candidate')}finally{fixture.close()}}
