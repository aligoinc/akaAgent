// Local PostgreSQL WASM fixture; no production calls or external actions.
const fs=require('node:fs'),path=require('node:path');
const {createFixture:baseFixture,config}=require('./action-status-writer-smoke.cjs');
const dir=path.resolve(__dirname,'../migrations/snapshots/action-status-policies-v366');
async function createFixture(){
 const db=await baseFixture();
 for(const file of ['tracking-before.json','link-tracking-before.json']){
  const s=JSON.parse(fs.readFileSync(path.join(dir,file))).schema;
  await db.exec(`CREATE SEQUENCE ${s.table}_id_seq; CREATE TABLE ${s.table} (${s.columns.map(c=>`${c.name} ${c.type}${c.default?' DEFAULT '+c.default:''}${c.not_null?' NOT NULL':''}`).join(',')}, PRIMARY KEY(id));`);
 }
 const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json')));
 for(const name of ['aka_agent_mark_email_open','aka_agent_mark_email_click'])await db.exec(before.functions.find(f=>f.signature.startsWith(name+'(')).definition);
 await db.exec(fs.readFileSync(path.resolve(dir,'../../migration_v366_action_status_runtime_fixes.sql'),'utf8'));
 return db;
}
module.exports={createFixture,config};
if(require.main===module)createFixture().then(db=>db.close()).then(()=>console.log('V366 fixture OK')).catch(e=>{console.error(e);process.exitCode=1});
