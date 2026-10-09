// One catalog INSERT only, through the existing linked Management API.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const m=require('./action-status-policy-migration.cjs')
const {query}=require('./campaign-status-catalog-migration.cjs')
const dir=path.join(m.root,'migrations/snapshots/fb-post-approved-status-v373')
const name='migration_v373_fb_post_approved_status',code='campaign_detail_post_approved',value='đã duyệt bài'
const tables=['auto_status','auto_error','auto_account_action_status_policies']
const save=(file,data)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(data,null,2)+'\n',{flag:'wx'})
const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'))
const schemaSQL=`(${m.schemaSQL('auto_status')} #- '{sequence,last_value}')`
const tableDigest=table=>`(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY t.id),'')) FROM public.${table} t)`
function snapshot(){
 const tableSQL=tables.map(t=>`${m.quote(t)},(SELECT jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')),
  'rows',coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'canonical',to_jsonb(t)::text,'md5',md5(to_jsonb(t)::text)) ORDER BY id),'[]'::jsonb)) FROM public.${t} t)`).join(',')
 return query(`BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; WITH meta AS(SELECT ${schemaSQL} s)
 SELECT ${m.quote(m.ref)} project_ref,clock_timestamp() captured_at,jsonb_build_object(${tableSQL}) tables,
 s schema,s::text schema_canonical,md5(s::text) schema_md5,
 ${m.schemaSQL('auto_error')} error_schema,
 ${m.schemaSQL('auto_account_action_status_policies')} policy_schema,
 (SELECT jsonb_build_object('row',to_jsonb(b),'canonical',to_jsonb(b)::text,'md5',md5(to_jsonb(b)::text)) FROM auto_blocks b WHERE id=31) detector,
 (SELECT jsonb_agg(jsonb_build_object('id',d.id,'md5',md5(to_jsonb(d)::text)) ORDER BY id) FROM auto_campaign_details d WHERE campaign_id=27394) example_details,
 (SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8)t) history
 FROM meta; ROLLBACK;`)[0]
}
function validate(s){
 assert.equal(s.project_ref,m.ref)
 for(const [table,data] of Object.entries(s.tables)){
  assert.equal(data.count,data.rows.length)
  for(const r of data.rows){assert.equal(m.hash(r.canonical,'md5'),r.md5);assert.deepEqual(JSON.parse(r.canonical),r.row)}
  assert.equal(m.hash(data.rows.map(r=>r.canonical).join('|'),'md5'),data.md5,table)
 }
 assert.equal(m.hash(s.schema_canonical,'md5'),s.schema_md5);assert.deepEqual(JSON.parse(s.schema_canonical),s.schema)
 assert.equal(m.hash(s.detector.canonical,'md5'),s.detector.md5)
}
function backup(){
 const s=read('before.json');validate(s)
 assert.equal(m.hash(fs.readFileSync(path.join(dir,'before.json'))),read('backup-manifest.json').before_sha256)
 return s
}
function capture(){
 fs.mkdirSync(dir,{recursive:true});const s=snapshot();validate(s)
 assert(!s.history.some(x=>/^migration_v373_/.test(x.name)))
 assert(!s.tables.auto_status.rows.some(x=>x.row.code===code||x.row.status_value===value))
 save('before.json',s);save('backup-manifest.json',{project_ref:m.ref,captured_at:s.captured_at,before_sha256:m.hash(fs.readFileSync(path.join(dir,'before.json'))),tables:Object.fromEntries(Object.entries(s.tables).map(([t,d])=>[t,{count:d.count,md5:d.md5}])),schema_md5:s.schema_md5})
 backup();console.log({backup_verified:true,counts:read('backup-manifest.json').tables})
}
const description='Trạng thái phụ sau đăng bài group Facebook thành công. Theo quy ước hiện có: isPending=false và pendingCheckConclusive=true được hiển thị là Đã duyệt bài (nhánh log Group không cần duyệt bài). Tái sử dụng kết luận detector, không thêm kiểm tra DOM hoặc xác nhận riêng về thao tác duyệt của quản trị viên. Không gán khi kiểm tra chưa kết luận; không suy từ URL công khai. Khi dùng làm subStatusCode không đổi policy Thành công, bộ đếm hoặc xử lý input. Chỉ áp dụng kết quả mới, không sửa detail/note/log lịch sử.'
const insertSQL=`INSERT INTO public.auto_status(code,name,description,status_key,flatform_type,component_type,is_default,is_terminal,can_set_manually,is_active,is_delete,sort_order,status_value,color)
VALUES(${m.quote(code)},'Đã duyệt bài',${m.quote(description)},'post_approved','facebook','campaign_detail',false,false,false,true,false,220,${m.quote(value)},NULL);`
const start="BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='8s';\n"
function sql(){
 const b=backup()
 return `${start}-- Serialize this small catalog while verifying the complete before snapshot.
LOCK TABLE public.auto_status IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF md5((${schemaSQL})::text) IS DISTINCT FROM '${b.schema_md5}' THEN RAISE EXCEPTION 'v373 status schema drift'; END IF;
 IF ${tableDigest('auto_status')} IS DISTINCT FROM '${b.tables.auto_status.md5}' THEN RAISE EXCEPTION 'v373 status catalog drift'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v373_%') THEN RAISE EXCEPTION 'v373 already recorded'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_status WHERE code=${m.quote(code)} OR (component_type='campaign_detail' AND (status_value=${m.quote(value)} OR lower(name)=lower('Đã duyệt bài')))) THEN RAISE EXCEPTION 'v373 duplicate status'; END IF;
 IF (SELECT md5(to_jsonb(b)::text) FROM auto_blocks b WHERE id=31) IS DISTINCT FROM '${b.detector.md5}' THEN RAISE EXCEPTION 'v373 detector changed; reconcile first'; END IF;
END $guard$;
${insertSQL}
DO $guard$ BEGIN
 IF (SELECT count(*) FROM public.auto_status)<>${b.tables.auto_status.count+1} THEN RAISE EXCEPTION 'v373 unexpected row count'; END IF;
 IF (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.auto_status t WHERE code<>${m.quote(code)}) IS DISTINCT FROM '${b.tables.auto_status.md5}' THEN RAISE EXCEPTION 'v373 changed existing row'; END IF;
END $guard$;
COMMIT;\n`
}
function rollback(row){
 const b=backup(),id=row?Number(row.row.id):'__V373_INSERTED_ID__',digest=row?.md5??'__V373_INSERTED_MD5__'
 if(row){assert(Number.isSafeInteger(id)&&id>0);assert.match(digest,/^[0-9a-f]{32}$/)}
 return `${start}-- Exact owned row only; never reset sequences or remove apply history.
LOCK TABLE public.auto_automation_trigger_statuses IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF md5((${schemaSQL})::text) IS DISTINCT FROM '${b.schema_md5}' THEN RAISE EXCEPTION 'v373 status schema drift'; END IF;
 PERFORM id FROM public.auto_status WHERE id=${id} FOR UPDATE;
 IF (SELECT md5(to_jsonb(s)::text) FROM public.auto_status s WHERE id=${id} AND code=${m.quote(code)}) IS DISTINCT FROM '${digest}' THEN RAISE EXCEPTION 'v373 owned row changed or absent'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE status_id=${id})
 OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE sub_status_id=${id})
 OR EXISTS(SELECT 1 FROM public.auto_account_action_status_policies WHERE status_id=${id})
 OR EXISTS(SELECT 1 FROM public.auto_error WHERE detail_status_id=${id} OR detail_status=${m.quote(value)})
 OR EXISTS(SELECT 1 FROM public.auto_campaign_action_detail_statuses WHERE status_id=${id} OR status_value=${m.quote(value)})
 OR EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE ${id}=ANY(sub_status_ids) OR status_value=${m.quote(value)})
 OR EXISTS(SELECT 1 FROM public.auto_blocks WHERE strpos(code,${m.quote(code)})>0)
 OR EXISTS(SELECT 1 FROM public.auto_workflows w WHERE strpos(to_jsonb(w)::text,${m.quote(code)})>0)
 THEN RAISE EXCEPTION 'v373 status has references; preserve history/configuration'; END IF;
END $guard$;
DELETE FROM public.auto_status WHERE id=${id} AND code=${m.quote(code)} AND md5(to_jsonb(auto_status)::text)='${digest}';
COMMIT;\n`
}
function build(){
 const content=sql(),undo=rollback();fs.writeFileSync(path.join(m.root,'migrations',name+'.sql'),content,{flag:'wx'})
 // Prepared before any INSERT. Concrete ID/checksum come only from its receipt.
 fs.writeFileSync(path.join(dir,'rollback.sql.template'),undo,{flag:'wx'})
 save('prepared-manifest.json',{project_ref:m.ref,migration_sha256:m.hash(content),rollback_template_sha256:m.hash(undo),code,name,description})
 console.log({prepared:name,code})
}
function checkedSQL(){
 const content=fs.readFileSync(path.join(m.root,'migrations',name+'.sql'),'utf8'),prepared=read('prepared-manifest.json')
 const undo=fs.readFileSync(path.join(dir,'rollback.sql.template'),'utf8');assert.equal(undo,rollback());assert.equal(m.hash(undo),prepared.rollback_template_sha256)
 assert.equal(content,sql());assert.equal(m.hash(content),prepared.migration_sha256);return content
}
const ownedSQL=`(SELECT jsonb_build_object('row',to_jsonb(s),'canonical',to_jsonb(s)::text,'md5',md5(to_jsonb(s)::text)) FROM public.auto_status s WHERE code=${m.quote(code)})`
function smoke(){
 const content=checkedSQL(),b=backup()
 // nextval may leave a gap on rollback; no sequence reset is allowed.
 const result=query(content.replace(/COMMIT;\s*$/,()=>`SELECT ${ownedSQL} owned; ROLLBACK;`))[0]
 assert.equal(m.hash(result.owned.canonical,'md5'),result.owned.md5)
 assert.equal(query(`SELECT ${tableDigest('auto_status')} md5`)[0].md5,b.tables.auto_status.md5)
 save('insert-smoke.json',{at:new Date().toISOString(),migration_sha256:m.hash(content),rolled_back:true,...result})
 console.log({insert_rolled_back:true,id:result.owned.row.id})
}
function apply(){
 const content=checkedSQL();assert.equal(read('insert-smoke.json').migration_sha256,m.hash(content))
 assert(!fs.existsSync(path.join(dir,'apply.json')))
 const version=new Date().toISOString().replace(/\D/g,'').slice(0,14)
 save('apply-intent.json',{at:new Date().toISOString(),project_ref:m.ref,version,name,migration_sha256:m.hash(content)})
 const result=query(content.replace(/COMMIT;\s*$/,()=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${m.quote(version)},${m.quote(name)},ARRAY[${m.quote(content)}]); SELECT ${ownedSQL} owned; COMMIT;`))[0]
 save('apply.json',{at:new Date().toISOString(),project_ref:m.ref,version,name,migration_sha256:m.hash(content),...result})
 const undo=rollback(result.owned);fs.writeFileSync(path.join(dir,'rollback.sql'),undo,{flag:'wx'})
 save('rollback-manifest.json',{at:new Date().toISOString(),project_ref:m.ref,rollback_sha256:m.hash(undo),owned_id:result.owned.row.id,owned_md5:result.owned.md5})
 verify();console.log({applied:true,version,id:result.owned.row.id})
}
function verify(){
 const b=backup(),a=snapshot();validate(a)
 const owned=read('apply.json').owned
 for(const t of tables){
  const rows=a.tables[t].rows.filter(x=>t!=='auto_status'||x.row.id!==owned.row.id)
  assert.equal(m.hash(rows.map(r=>r.canonical).join('|'),'md5'),b.tables[t].md5,t)
 }
 assert.equal(a.tables.auto_status.rows.find(x=>x.row.id===owned.row.id)?.md5,owned.md5)
 assert.equal(a.schema_md5,b.schema_md5);assert.equal(a.detector.md5,b.detector.md5);assert.deepEqual(a.example_details,b.example_details)
 save('after.json',a);save('verified.json',{at:new Date().toISOString(),after_sha256:m.hash(fs.readFileSync(path.join(dir,'after.json'))),owned_id:owned.row.id,existing_rows_unchanged:true,detector_unchanged:true,example_history_unchanged:true})
}
function rollbackSmoke(){
 const undo=fs.readFileSync(path.join(dir,'rollback.sql'),'utf8');assert.equal(m.hash(undo),read('rollback-manifest.json').rollback_sha256)
 const b=backup(),owned=read('apply.json').owned
 const result=query(undo.replace(/COMMIT;\s*$/,()=>`SELECT ${tableDigest('auto_status')} restored_md5; ROLLBACK;`))[0]
 assert.equal(result.restored_md5,b.tables.auto_status.md5)
 assert.equal(query(`SELECT ${ownedSQL} owned`)[0].owned.md5,owned.md5)
 save('rollback-smoke.json',{at:new Date().toISOString(),...result,rolled_back:true,owned_row_preserved:true})
 console.log({rollback_verified:true,owned_row_preserved:true})
}
async function api(){
 const source=fs.readFileSync(path.join(m.root,'src/main/data/supabaseClient.ts'),'utf8')
 const key=source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
 const response=await fetch(`https://${m.ref}.supabase.co/rest/v1/auto_status?code=eq.${code}&select=*`,{
  headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)})
 assert.equal(response.status,200)
 const rows=await response.json(),owned=read('apply.json').owned.row
 assert.equal(rows.length,1);assert.equal(rows[0].id,owned.id);assert.equal(rows[0].code,code)
 assert.equal(rows[0].name,'Đã duyệt bài');assert.equal(rows[0].status_value,value)
 assert.equal(rows[0].is_active,true);assert.equal(rows[0].is_delete,false)
 const receipt={at:new Date().toISOString(),project_ref:m.ref,status:response.status,id:owned.id,
  name:rows[0].name,status_value:rows[0].status_value,is_active:true,is_delete:false,schema_reload:false}
 save('api-after.json',receipt);console.log(receipt)
}
if(require.main===module){const commands={capture,build,smoke,apply,verify,api,'rollback-smoke':rollbackSmoke};assert(commands[process.argv[2]]);Promise.resolve().then(()=>commands[process.argv[2]]()).catch(error=>{console.error(error.message);process.exitCode=1})}
module.exports={name,code,value,description,dir,insertSQL,query,read,save,backup,checkedSQL}
