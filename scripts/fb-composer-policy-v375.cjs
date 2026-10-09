// Linked Management API DML only; no SQL pool, schema setup, or reload.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const m=require('./action-status-policy-migration.cjs')
const {query}=require('./campaign-status-catalog-migration.cjs')
const name='migration_v375_fb_composer_db_result',errorCode='err_fb_composer_editor_not_found'
const notice='Không tìm thấy ô đăng bài',dir=path.join(m.root,'migrations/snapshots/fb-composer-policy-v375')
const save=(file,data)=>fs.writeFileSync(path.join(dir,file),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx'})
const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'))
const scopes={auto_blocks:"id IN (SELECT DISTINCT (n->>'blockId')::bigint FROM auto_workflows w CROSS JOIN LATERAL jsonb_array_elements(w.nodes)n WHERE w.id IN (1,2,251,252))",auto_workflows:'id IN (1,2,251,252)',auto_error:'true',auto_status:'true'}
const json=x=>m.quote(JSON.stringify(x))+'::jsonb'
const schemaExpr=()=>`jsonb_build_array(${Object.keys(scopes).map(t=>`(${m.schemaSQL(t)} #- '{sequence,last_value}')`).join(',')})::text`
const consumerIdsExpr="(SELECT jsonb_agg(w.id ORDER BY w.id) FROM auto_workflows w WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(w.nodes)n WHERE n->>'blockId'='27'))"
function metadataGuard(b,label){return `IF md5(${schemaExpr()}) IS DISTINCT FROM '${m.hash(b.schema_canonical,'md5')}' THEN RAISE EXCEPTION '${label}: schema drift'; END IF;
 IF ${consumerIdsExpr} IS DISTINCT FROM ${json(b.consumers.map(x=>x.id))} THEN RAISE EXCEPTION '${label}: composer consumers drift'; END IF;`}

function snapshot(){
 const parts=Object.entries(scopes).map(([table,scope])=>`${m.quote(table)},(SELECT jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')),
  'rows',jsonb_agg(jsonb_build_object('row',to_jsonb(t),'canonical',to_jsonb(t)::text,'md5',md5(to_jsonb(t)::text)) ORDER BY id)) FROM public.${table} t WHERE ${scope})`).join(',')
 const schemas=Object.keys(scopes).map(t=>`(${m.schemaSQL(t)} #- '{sequence,last_value}')`).join(',')
 return query(`BEGIN READ ONLY; SET LOCAL statement_timeout='8s';
 SELECT ${m.quote(m.ref)} project_ref,clock_timestamp() captured_at,jsonb_build_object(${parts}) tables,
 jsonb_build_array(${schemas})::text schema_canonical,
 (SELECT jsonb_agg(jsonb_build_object('id',w.id,'md5',md5(to_jsonb(w)::text)) ORDER BY w.id) FROM auto_workflows w WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(w.nodes)n WHERE n->>'blockId'='27')) consumers,
 (SELECT jsonb_agg(jsonb_build_object('id',d.id,'md5',md5(to_jsonb(d)::text)) ORDER BY id) FROM auto_campaign_details d WHERE campaign_id=27394) example_details,
 (SELECT jsonb_agg(to_jsonb(h)) FROM(SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8)h) history;
 ROLLBACK;`)[0]
}
function validate(s){
 assert.equal(s.project_ref,m.ref)
 for(const [t,d] of Object.entries(s.tables)){
  assert.equal(d.count,d.rows.length,t)
  for(const r of d.rows){assert.equal(m.hash(r.canonical,'md5'),r.md5);assert.deepEqual(JSON.parse(r.canonical),r.row)}
  assert.equal(m.hash(d.rows.map(r=>r.canonical).join('|'),'md5'),d.md5,t)
 }
 JSON.parse(s.schema_canonical)
}
function backup(){const b=read('before.json');validate(b);assert.equal(m.hash(fs.readFileSync(path.join(dir,'before.json'))),read('backup-manifest.json').before_sha256);return b}
function capture(){
 fs.mkdirSync(dir,{recursive:true});const b=snapshot();validate(b)
 assert.deepEqual(b.consumers.map(x=>Number(x.id)),[1,2,251,252]);assert(!b.history.some(x=>/^migration_v375_/.test(x.name)))
 save('before.json',b);save('backup-manifest.json',{project_ref:m.ref,captured_at:b.captured_at,before_sha256:m.hash(fs.readFileSync(path.join(dir,'before.json'))),schema_sha256:m.hash(b.schema_canonical),tables:Object.fromEntries(Object.entries(b.tables).map(([t,d])=>[t,{count:d.count,md5:d.md5}]))})
 backup();console.log({backup_verified:true,tables:read('backup-manifest.json').tables})
}
function targetCode(old){
 assert(old.includes('failure.actionResult = {'));assert(old.includes('return { opened: true }'))
 // Transform the freshly captured live v374 code; do not rebuild DOM code
 // from an older migration. A timeout returns data for the existing writer.
 return old.replace('// Structured composer failure; existing clients still stop on the friendly exception.',
   '// Composer errors use the standard result contract; workflow gates publishing on opened.')
  .replace('    const failure = new Error("Không tìm thấy ô đăng bài");\n    failure.actionResult = {',
    '    const actionResult = {')
  .replace("      operationState: 'not_committed',", "      inputDataId: vars.inputDataId ?? null,\n      operationState: 'not_committed',")
  .replace('    throw failure;', '    return { opened: false, actionResult };')
  .replace("await waitForComposer(btn, 'composer_button')", "const buttonFailure = await waitForComposer(btn, 'composer_button')\nif (buttonFailure) return buttonFailure")
  .replace("await waitForComposer(dialog, 'composer_dialog')", "const dialogFailure = await waitForComposer(dialog, 'composer_dialog')\nif (dialogFailure) return dialogFailure")
}
function desired(){
 const b=backup(),block=b.tables.auto_blocks.rows.find(x=>x.row.id===27).row
 assert.equal(block.name,'fb_open_composer')
 assert.equal(b.tables.auto_blocks.rows.find(x=>x.row.id===1).row.system_type,'ifElse')
 const rows=[{table:'auto_blocks',id:27,fields:{code:targetCode(block.code)}}]
 for(const {row:w} of b.tables.auto_workflows.rows){
  const nodes=structuredClone(w.nodes),open=nodes.filter(n=>n.blockId===27)
  assert.equal(open.length,1);assert.equal(open[0].id,'open_composer');assert.equal(open[0].codeOverride,undefined)
  assert.equal(open[0].config.composerActionCode,[1,252].includes(Number(w.id))?'fb_post_group':'fb_post_my_profile')
  const gate='if_composer_opened';assert(!nodes.some(n=>n.id===gate))
  nodes.push({id:gate,blockId:1,blockName:'if_else',systemType:'ifElse',
   config:{condition:'input.opened === true'},position:{x:open[0].position.x+220,y:open[0].position.y+60}})
  let outgoing=0
  const edges=w.edges.map(e=>{
   if(e.source!==open[0].id)return structuredClone(e)
   assert.equal(e.sourceHandle,undefined);outgoing++
   return {...e,id:`e-${gate}-${e.target}-true`,source:gate,sourceHandle:'true'}
  })
  assert.equal(outgoing,[1,252].includes(Number(w.id))?2:1)
  edges.push({id:`e-open_composer-${gate}`,source:'open_composer',target:gate})
  if([1,252].includes(Number(w.id))){
   assert(nodes.some(n=>n.id==='page_identity_capture_result'))
   const resultJoin=nodes.find(n=>n.id==='merge_join');assert.equal(resultJoin.systemType,'merge');assert.equal(resultJoin.config.mode,'any')
   // Run only identity cleanup on failure; bypass posting and optional actions.
   edges.push({id:`e-${gate}-merge_join-false`,source:gate,sourceHandle:'false',target:'merge_join'})
  }
  rows.push({table:'auto_workflows',id:w.id,fields:{nodes,edges}})
 }
 return rows
}
const start="BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='8s';\n"
function guard(rows,label){return rows.map(r=>`IF (SELECT md5(to_jsonb(t)::text) FROM public.${r.table} t WHERE id=${r.id}) IS DISTINCT FROM '${r.md5}' THEN RAISE EXCEPTION '${label}: ${r.table}/${r.id} drift'; END IF;`).join('\n')}
function sql(){
 const b=backup(),rows=desired(),owned=rows.map(r=>({...r,md5:b.tables[r.table].rows.find(x=>x.row.id===r.id).md5}))
 const beforeAll=Object.entries(scopes).map(([t,s])=>`IF (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.${t} t WHERE ${s}) IS DISTINCT FROM '${b.tables[t].md5}' THEN RAISE EXCEPTION 'v375: ${t} catalog drift'; END IF;`).join('\n')
 const updates=rows.map(r=>`UPDATE public.${r.table} SET ${Object.entries(r.fields).map(([k,v])=>`${k}=${typeof v==='string'?m.quote(v):json(v)}`).join(',')},updated_at=clock_timestamp() WHERE id=${r.id};`).join('\n')
 const assertOnly=rows.map(r=>{const old=b.tables[r.table].rows.find(x=>x.row.id===r.id).row;return `IF (SELECT to_jsonb(t)-'updated_at' FROM public.${r.table} t WHERE id=${r.id}) IS DISTINCT FROM (${json({...old,...r.fields})}-'updated_at') THEN RAISE EXCEPTION 'v375 unexpected changes ${r.table}/${r.id}'; END IF;`}).join('\n')
 return `${start}SELECT id FROM auto_blocks WHERE id=27 FOR UPDATE;
 SELECT id FROM auto_error WHERE id=94 FOR UPDATE;
 SELECT id FROM auto_workflows WHERE id IN (1,2,251,252) ORDER BY id FOR UPDATE;
 DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v375_%') THEN RAISE EXCEPTION 'v375 already applied'; END IF;
 ${metadataGuard(b,'v375')}
 ${beforeAll}
 ${guard(owned,'v375')}
 END $preflight$;
 ${updates}
 DO $postflight$ BEGIN ${assertOnly} END $postflight$;
 COMMIT;\n`
}
function rollback(receipt){
 const b=backup(),rows=desired().map(r=>({...r,md5:receipt?receipt.find(x=>x.table===r.table&&x.id===r.id).md5:`__${r.table}_${r.id}_MD5__`}))
 const restore=rows.map(r=>{const old=b.tables[r.table].rows.find(x=>x.row.id===r.id).row;return `UPDATE public.${r.table} SET ${[...Object.keys(r.fields),'updated_at'].map(k=>`${k}=${typeof old[k]==='string'?m.quote(old[k]):old[k]==null?'NULL':json(old[k])}`).join(',')} WHERE id=${r.id};`}).join('\n')
 return `${start}SELECT id FROM auto_blocks WHERE id=27 FOR UPDATE;
 SELECT id FROM auto_error WHERE id=94 FOR UPDATE;
 SELECT id FROM auto_workflows WHERE id IN (1,2,251,252) ORDER BY id FOR UPDATE;
 DO $guard$ BEGIN ${metadataGuard(b,'v375 rollback')} ${guard(rows,'v375 rollback')} END $guard$;
 ${restore}
 -- Keep catalog/history and all already processed results. Never reset sequences.
 COMMIT;\n`
}
function build(){
 const content=sql(),undo=rollback();fs.writeFileSync(path.join(m.root,'migrations',name+'.sql'),content,{flag:'wx'});save('rollback.sql.template',undo)
 save('prepared.json',{project_ref:m.ref,migration_sha256:m.hash(content),rollback_template_sha256:m.hash(undo),owned:desired()})
 console.log({prepared:name})
}
function checkedSQL(){const content=fs.readFileSync(path.join(m.root,'migrations',name+'.sql'),'utf8');assert.equal(content,sql());assert.equal(m.hash(content),read('prepared.json').migration_sha256);assert.equal(m.hash(fs.readFileSync(path.join(dir,'rollback.sql.template'))),read('prepared.json').rollback_template_sha256);return content}
const ownedQuery=()=>`SELECT jsonb_agg(x) owned FROM(${desired().map(r=>`SELECT ${m.quote(r.table)} AS "table",id,md5(to_jsonb(t)::text) FROM public.${r.table} t WHERE id=${r.id}`).join(' UNION ALL ')})x;`
function unchanged(before,after){for(const t of Object.keys(scopes))assert.equal(after.tables[t].md5,before.tables[t].md5,t)}
function smoke(){const b=backup(),content=checkedSQL();const r=query(content.replace(/COMMIT;\s*$/,()=>ownedQuery()+'ROLLBACK;'));unchanged(b,snapshot());save('apply-smoke.json',{at:new Date().toISOString(),migration_sha256:m.hash(content),rolled_back:true,owned:r.find(x=>x.owned)?.owned});console.log({smoke_rolled_back:true})}
function apply(){
 const content=checkedSQL();assert.equal(read('apply-smoke.json').migration_sha256,m.hash(content))
 const version=new Date().toISOString().replace(/\D/g,'').slice(0,14);save('apply-intent.json',{version,name,at:new Date().toISOString()})
 const r=query(content.replace(/COMMIT;\s*$/,()=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${m.quote(version)},${m.quote(name)},ARRAY[${m.quote(content)}]);${ownedQuery()}COMMIT;`))
 const owned=r.find(x=>x.owned)?.owned;assert.equal(owned.length,5)
 save('apply.json',{version,name,owned,at:new Date().toISOString()});const undo=rollback(owned);save('rollback.sql',undo);save('rollback-manifest.json',{sha256:m.hash(undo)})
 verify();console.log({applied:true,version,owned:owned.map(x=>({table:x.table,id:x.id}))})
}
function verify(){
 const b=backup(),a=snapshot();validate(a)
 const changes=desired()
 for(const [table,d] of Object.entries(b.tables)) {
 assert.equal(a.tables[table].count,d.count,table+' row count');
 for(const old of d.rows){
  const row=a.tables[table].rows.find(x=>x.row.id===old.row.id);assert(row)
  const change=changes.find(x=>x.table===table&&x.id===old.row.id)
  if(change){const expected={...old.row,...change.fields};delete expected.updated_at;const actual={...row.row};delete actual.updated_at;assert.deepEqual(actual,expected)}else assert.equal(row.md5,old.md5)
 }
 }
 assert.deepEqual(a.consumers.map(x=>x.id),b.consumers.map(x=>x.id));
 assert.equal(a.schema_canonical,b.schema_canonical);assert.deepEqual(a.example_details,b.example_details)
 const owned=read('apply.json').owned;for(const o of owned)assert.equal(a.tables[o.table].rows.find(x=>x.row.id===o.id).md5,o.md5)
 save('after.json',a);save('verified.json',{at:new Date().toISOString(),after_sha256:m.hash(fs.readFileSync(path.join(dir,'after.json'))),historical_details_unchanged:true,schema_unchanged:true,only_expected_changes:true})
}
function rollbackSmoke(){const undo=fs.readFileSync(path.join(dir,'rollback.sql'),'utf8');assert.equal(m.hash(undo),read('rollback-manifest.json').sha256);const b=backup(),beforeRollback=snapshot();const assertions=Object.entries(scopes).map(([t,s])=>`IF (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.${t} t WHERE ${s}) IS DISTINCT FROM '${b.tables[t].md5}' THEN RAISE EXCEPTION 'v375 rollback mismatch ${t}'; END IF;`).join('\n');query(undo.replace(/COMMIT;\s*$/,()=>`DO $verify$ BEGIN ${assertions} END $verify$; ROLLBACK;`));unchanged(beforeRollback,snapshot());save('rollback-smoke.json',{at:new Date().toISOString(),rolled_back:true,applied_rows_preserved:true});console.log({rollback_verified:true})}
if(require.main===module){const c={capture,build,smoke,apply,verify,'rollback-smoke':rollbackSmoke};assert(c[process.argv[2]]);c[process.argv[2]]()}
module.exports={name,errorCode,notice,dir,query,save,read,backup,targetCode,desired}
