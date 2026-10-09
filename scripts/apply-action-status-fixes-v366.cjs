const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const m=require('./action-status-policy-migration.cjs');
const dir=path.join(m.root,'migrations/snapshots/action-status-policies-v366');
const name='migration_v366_action_status_runtime_fixes';
const sql=fs.readFileSync(path.join(m.root,'migrations',name+'.sql'),'utf8');
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const write=(f,v)=>fs.writeFileSync(path.join(dir,f),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const before=read('before.json'),smoke=read('live-rollback-smoke.json');
m.validateSnapshot(before);assert.equal(m.hash(fs.readFileSync(path.join(dir,'before.json'))),read('before-manifest.json').sha256);assert.equal(smoke.migration_sha256,m.hash(sql));
const verifying=process.argv.includes('--verify');
if(!verifying){
assert(!fs.existsSync(path.join(dir,'apply.json')),'Already applied: verify history instead of retrying');
const beforeApply=m.snapshot();m.validateSnapshot(beforeApply);
write('before-apply.json',beforeApply);write('before-apply-manifest.json',{sha256:m.hash(fs.readFileSync(path.join(dir,'before-apply.json'))),project_ref:m.ref,migration_sha256:m.hash(sql)});
m.validateSnapshot(read('before-apply.json'));assert.equal(m.hash(fs.readFileSync(path.join(dir,'before-apply.json'))),read('before-apply-manifest.json').sha256);
const history=new Date().toISOString().replace(/\D/g,'').slice(0,14);
const result=m.query(sql.replace(/COMMIT;\s*$/,()=>`DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v366_%') THEN RAISE EXCEPTION 'v366 already recorded'; END IF; END $$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${m.quote(history)},${m.quote(name)},ARRAY[${m.quote(sql)}]); SELECT true applied; COMMIT;`));
assert.equal(result[0].applied,true);write('apply.json',{at:new Date().toISOString(),project_ref:m.ref,name,history_version:history,migration_sha256:m.hash(sql)});
const after=m.snapshot();m.validateSnapshot(after);write('after.json',after);
}
const beforeApply=read('before-apply.json'),after=read('after.json');
m.validateSnapshot(beforeApply);m.validateSnapshot(after);
const independentChanges=[];
for(const table of Object.keys(beforeApply.tables)){
 if(table!=='auto_campaign_action_detail_statuses'){assert.equal(after.tables[table].md5,beforeApply.tables[table].md5,`${table} changed`);continue;}
 assert.equal(after.tables[table].count,beforeApply.tables[table].count);
 for(const r of after.tables[table].rows){const old=beforeApply.tables[table].rows.find(x=>x.row.id===r.row.id);assert(old);if(old.md5===r.md5)continue;
  const columns=Object.keys(r.row).filter(k=>JSON.stringify(r.row[k])!==JSON.stringify(old.row[k]));assert.deepEqual(columns,['updated_at']);
  independentChanges.push({table,id:r.row.id,columns,before:old.row.updated_at,after:r.row.updated_at,reason:'Existing live catalog sync refresh; migration contains no catalog DML'});
 }
}
for(const f of smoke.functions){const live=after.functions.find(x=>x.signature===f.signature);assert(live);for(const key of ['md5','owner','security_definer','volatility','settings','acl'])assert.deepEqual(live[key],f[key],`${f.signature}: ${key}`);}
for(const f of beforeApply.functions.filter(f=>!smoke.functions.some(x=>x.signature===f.signature))){const live=after.functions.find(x=>x.signature===f.signature);assert.equal(live?.md5,f.md5,'Unrelated RPC changed: '+f.signature);}
const tracking=m.query(`SELECT ${m.schemaSQL('auto_email_message_trackings')} schema`)[0];write('tracking-after.json',tracking);assert.equal(tracking.schema.triggers.find(t=>t.name==='trg_aka_agent_project_linked_email_status_v366').definition,smoke.trigger);
write('after-manifest.json',{at:new Date().toISOString(),project_ref:m.ref,sha256:m.hash(fs.readFileSync(path.join(dir,'after.json'))),rollback_sha256:m.hash(fs.readFileSync(path.join(dir,'rollback.sql'))),independentChanges,verified:true});
console.log(JSON.stringify({applied:true,history:read('apply.json').history_version,project_ref:m.ref,independentChanges,functions_verified:smoke.functions.length}));
