// Build current definitions/ACL/policies over the metadata-only PG17 fixture.
const fs=require('node:fs'),path=require('node:path')
const {createFixture}=require('./desktop-session-rls/full-fixture.cjs')
const {privateSecurityAsset}=require('./desktop-session-rls/private-security-assets.cjs')
module.exports=function createOwnershipFixture(){
 const m=JSON.parse(fs.readFileSync(privateSecurityAsset('migrations/snapshots/desktop-account-ownership/before.json')))
 const f=createFixture(),{sql,quote:q,root}=f
 const dir=path.join(root,'migrations/snapshots/desktop-account-ownership')
 const id=s=>'"'+s.replaceAll('"','""')+'"',obj=r=>id(r.schema)+'.'+id(r.name),sig=f=>f.schema+'.'+f.signature.replace(/^(public|private|aka_agent_desktop_internal)\./,'')
 try{
  const existing=new Set(JSON.parse(sql('SELECT jsonb_agg(rolname) FROM pg_roles')))
  for(const r of m.roles)if(!existing.has(r.name))sql(`CREATE ROLE ${id(r.name)} ${r.bypassrls?'BYPASSRLS':''} ${r.inherit?'INHERIT':'NOINHERIT'};`)
  sql('CREATE SCHEMA aka_agent_desktop_internal; CREATE DOMAIN public.vector AS text; CREATE DOMAIN extensions.vector AS text;')
  for(const r of m.relations.filter(r=>['r','p'].includes(r.kind)))if(sql(`SELECT to_regclass(${q(r.schema+'.'+r.name)}) IS NOT NULL`)!=='t')sql(`CREATE TABLE ${obj(r)} (${r.columns.map(c=>id(c.name)+' '+c.type).join(',')});`)
  for(const r of m.relations.filter(r=>r.kind==='S'))if(sql(`SELECT to_regclass(${q(r.schema+'.'+r.name)}) IS NOT NULL`)!=='t')sql(`CREATE SEQUENCE ${obj(r)};`)
  sql('SET check_function_bodies=off;\n'+m.functions.filter(x=>!x.extension).map(x=>x.definition+';').join('\n'))
  for(const r of m.relations.filter(r=>r.kind==='v'))sql(`CREATE OR REPLACE VIEW ${obj(r)}${r.options?.length?' WITH ('+r.options.join(',')+')':''} AS ${r.view}`)
  const allRoles=['PUBLIC',...m.roles.map(r=>id(r.name))].join(','),acl=[],perms={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',U:'USAGE',X:'EXECUTE'}
  function restore(kind,object,value,owner,column){
   acl.push(`REVOKE ALL PRIVILEGES${column?' ('+id(column)+')':''} ON ${kind} ${object} FROM ${allRoles};`)
   const entries=value===null?(kind==='FUNCTION'?['=X/'+owner,owner+'=X/'+owner]:[]):value.slice(1,-1).split(',').filter(Boolean)
   for(const e of entries){const [who,rest]=e.split('='),pv=rest.split('/')[0],plain=[...pv].filter(c=>c!=='*').map(c=>perms[c]+(column?' ('+id(column)+')':''));if(plain.length)acl.push(`GRANT ${plain.join(',')} ON ${kind} ${object} TO ${who?id(who):'PUBLIC'}${pv.includes('*')?' WITH GRANT OPTION':''};`)}
  }
  for(const r of m.relations){if(!['r','p','v','S'].includes(r.kind))continue;restore(r.kind==='S'?'SEQUENCE':'TABLE',obj(r),r.acl,r.owner);if(['r','p'].includes(r.kind))acl.push(`ALTER TABLE ${obj(r)} ${r.rls?'ENABLE':'DISABLE'} ROW LEVEL SECURITY;`);for(const c of r.columns)if(c.acl)restore('TABLE',obj(r),c.acl,r.owner,c.name)}
  for(const fn of m.functions.filter(x=>!x.extension))restore('FUNCTION',sig(fn),fn.acl,fn.owner)
  sql(acl.join('\n'));sql(`GRANT USAGE ON SCHEMA public,private,aka_agent_desktop_internal TO ${m.roles.map(r=>id(r.name)).join(',')};`)
  const oldPolicies=JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM pg_policies p"));sql(oldPolicies.map(p=>`DROP POLICY ${id(p.policyname)} ON ${id(p.schemaname)}.${id(p.tablename)};`).join('\n'))
  sql(m.policies.map(p=>`CREATE POLICY ${id(p.policyname)} ON ${id(p.schemaname)}.${id(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(x=>x==='public'?'PUBLIC':id(x)).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};`).join('\n'))
  sql("CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;")
  const plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json')))
  const setup=[]
  for(const r of m.relations.filter(r=>plan.tables.includes(r.name)||r.name==='auto_campaign_logs'))for(const c of r.columns){if(c.default)setup.push(`ALTER TABLE ${obj(r)} ALTER COLUMN ${id(c.name)} SET DEFAULT ${c.default};`);if(c.notnull)setup.push(`ALTER TABLE ${obj(r)} ALTER COLUMN ${id(c.name)} SET NOT NULL;`)}
  sql(setup.join('\n'))
  const indexes=JSON.parse(fs.readFileSync(path.join(dir,'indexes.json'))).indexes
  sql(indexes.map(i=>i.indexdef.replace(/CREATE (UNIQUE )?INDEX /,(_,u)=>'CREATE '+(u||'')+'INDEX IF NOT EXISTS ')+';').join('\n'))
  const triggers=m.triggers.filter(t=>plan.tables.includes(t.relation));sql(triggers.map(t=>`DROP TRIGGER IF EXISTS ${id(t.name)} ON ${id(t.schema)}.${id(t.relation)}; ${t.definition};`).join('\n'))
  const runAs=(role,query)=>sql(`BEGIN; SET LOCAL ROLE ${id(role)}; ${query}; ROLLBACK;`)
  const claims={role:'aka_agent_desktop',sub:'11111111-1111-4111-8111-111111111111'}
  const desktop=(query,c=claims)=>runAs('aka_agent_desktop',`SET LOCAL request.jwt.claims=${q(typeof c==='string'?c:JSON.stringify(c))}; ${query}`)
  return {...f,m,dir,plan,id,sig,runAs,desktop,claims}
 }catch(e){f.close();throw e}
}
