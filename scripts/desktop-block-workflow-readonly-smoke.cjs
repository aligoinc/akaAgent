// Small disposable PostgreSQL 17: exact target columns/ACL/policies, synthetic definitions only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),vm=require('node:vm'),{spawnSync}=require('node:child_process')
const c=require('./desktop-block-workflow-readonly.cjs'),{q,id,before}=c
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'block-workflow-acl-')),bin='/opt/homebrew/opt/postgresql@17/bin'
const run=(name,args,input)=>{const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',input,maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout.trim()}
const sql=s=>run('psql',['-X','-h',tmp,'-p','55495','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],s)
run('initdb',['-D',path.join(tmp,'db'),'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
run('pg_ctl',['-D',path.join(tmp,'db'),'-l',path.join(tmp,'log'),'-o',`-h '' -k ${tmp} -p 55495`,'-w','start'])
const checks=[],pass=s=>{checks.push(s);console.log('PASS',s)},as=(role,s)=>sql(`BEGIN;SET LOCAL ROLE ${id(role)};${s};ROLLBACK;`),capture=()=>JSON.parse(sql(c.captureSql))
try{
 const existing=new Set(JSON.parse(sql('SELECT jsonb_agg(rolname) FROM pg_roles')))
 for(const r of before.roles)if(!existing.has(r.name))sql(`CREATE ROLE ${id(r.name)} ${r.bypass?'BYPASSRLS':''} ${r.inherit?'INHERIT':'NOINHERIT'};`)
 sql('GRANT USAGE ON SCHEMA public TO aka_agent_desktop,service_role,anon,authenticated;')
 for(const r of before.relations){
  sql(`CREATE SEQUENCE public.${id(r.name+'_id_seq')};CREATE TABLE public.${id(r.name)} (${r.columns.map(col=>id(col.name)+' '+col.type+(col.default?' DEFAULT '+col.default:'')+(col.notnull?' NOT NULL':'')).join(',')});ALTER TABLE public.${id(r.name)} ADD PRIMARY KEY(id);ALTER TABLE public.${id(r.name)} ADD UNIQUE(name);ALTER TABLE public.${id(r.name)} ENABLE ROW LEVEL SECURITY;GRANT ALL ON public.${id(r.name)} TO service_role;GRANT SELECT,DELETE ON public.${id(r.name)} TO aka_agent_desktop;GRANT USAGE ON SEQUENCE public.${id(r.name+'_id_seq')} TO aka_agent_desktop,service_role;`)
  for(const col of r.columns.filter(x=>x.acl))sql(`GRANT INSERT (${id(col.name)}),UPDATE (${id(col.name)}) ON public.${id(r.name)} TO aka_agent_desktop;`)
 }
 for(const p of before.policies)sql(`CREATE POLICY ${id(p.policyname)} ON public.${id(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(id).join(',')} USING (${p.qual}) WITH CHECK (${p.with_check});`)
 sql(`INSERT INTO auto_blocks(name,category,code,is_builtin,staff_id,organization_id) VALUES('fixture','action','({answer:input.value+1})',true,1,1);INSERT INTO auto_workflows(name,nodes,is_builtin,staff_id,organization_id) VALUES('fixture','[{"blockId":1}]',true,1,1);`)
 assert.deepEqual(JSON.parse(sql(c.relationsSql)),c.contract(before.relations))
 const start=capture(),reads=c.names.flatMap(t=>[`SELECT row_to_json(x) FROM ${t} x WHERE id=1`,`SELECT row_to_json(x) FROM ${t} x WHERE name='fixture'`,`SELECT count(*) FROM ${t} WHERE staff_id=1 OR staff_id IS NULL`]),readBefore=reads.map(s=>as('aka_agent_desktop',s))
 assert.throws(()=>sql('BEGIN; GRANT UPDATE ON auto_blocks TO aka_agent_desktop;'+c.migration+'ROLLBACK;'),/ACL source drift/)
 pass('source preflight refuses unexpected table or column grant state')
 sql('BEGIN;'+c.migration+'COMMIT;')
 assert.deepEqual(reads.map(s=>as('aka_agent_desktop',s)),readBefore)
 const code=as('aka_agent_desktop',"SELECT code FROM auto_blocks WHERE id=1")
 assert.equal(vm.runInNewContext(code,{input:{value:41}}).answer,42)
 pass('runtime reads by ID/name and catalog reads stay identical; loaded block code still executes')
 for(const t of c.names){
  const insert=t==='auto_blocks'?"INSERT INTO auto_blocks(name,category) VALUES('new','action')":"INSERT INTO auto_workflows(name) VALUES('new')"
  for(const statement of [insert,`UPDATE ${t} SET name='changed' WHERE id=1`,`DELETE FROM ${t} WHERE id=1`,`TRUNCATE ${t}`,insert+" ON CONFLICT(name) DO UPDATE SET name=excluded.name"]){assert.throws(()=>as('aka_agent_desktop',statement),/permission denied/)}
  assert.equal(as('service_role',`UPDATE ${t} SET name='backend' WHERE id=1 RETURNING name`),'backend')
  for(const role of ['anon','authenticated'])assert.throws(()=>as(role,`SELECT name FROM ${t}`),/permission denied/)
 }
 pass('Desktop insert/update/upsert/delete/truncate denied on both tables; backend update and anonymous denials retained')
 const target=capture();assert.deepEqual({...target,relations:start.relations},start)
 pass('all other-role grants, rows, policy and runtime metadata unchanged')
 const undo=c.rollback(target.relations);fs.writeFileSync(path.join(c.root,'migrations/rollback_desktop_block_workflow_readonly.sql'),undo)
 assert.throws(()=>sql('BEGIN;'+undo+'ROLLBACK;'),/requires explicit approval/)
 assert.throws(()=>sql("BEGIN; SET LOCAL aka_agent.block_workflow_rollback='approved';GRANT UPDATE(code) ON auto_blocks TO aka_agent_desktop;"+undo+'ROLLBACK;'),/ACL source drift/)
 sql("BEGIN;SET LOCAL aka_agent.block_workflow_rollback='approved';"+undo+'COMMIT;')
 assert.deepEqual(capture(),start)
 pass('guarded rollback rejects drift and restores exact source permissions without data changes')
 sql('BEGIN;'+c.migration+"SET LOCAL aka_agent.block_workflow_rollback='approved';"+undo+'ROLLBACK;')
 assert.deepEqual(capture(),start)
 pass('apply and rollback in one transaction restore the original state')
 const productionTrial=c.trial(undo);assert.equal(sql(productionTrial).split('\n').at(-1),'t');assert.deepEqual(capture(),start)
 fs.writeFileSync(path.join(c.dir,'production-trial.sql'),productionTrial)
 pass('exact production apply/read/denial/rollback trial passes locally')
 fs.writeFileSync(path.join(c.dir,'target.json'),JSON.stringify(target.relations,null,2)+'\n')
 fs.writeFileSync(path.join(c.dir,'local-test.json'),JSON.stringify({at:new Date().toISOString(),checks,status:'passed'},null,2)+'\n')
}finally{run('pg_ctl',['-D',path.join(tmp,'db'),'-m','immediate','-w','stop']);fs.rmSync(tmp,{recursive:true,force:true})}
