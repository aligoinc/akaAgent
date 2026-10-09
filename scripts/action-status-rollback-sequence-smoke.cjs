// Executes the real rollback artifact against a local PostgreSQL/WASM fixture.
// Does not call Management API, create SQL connections or touch production.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const m = require('./action-status-policy-migration.cjs')
const cleanup = require('./action-status-cleanup-v365.cjs')

async function main() {
 const db = new PGlite(), checks = []
 try {
  const before=JSON.parse(fs.readFileSync(path.join(cleanup.dir,'before.json')))
  const exact=JSON.parse(fs.readFileSync(path.join(cleanup.dir,'schema-exact.json')))
  const schema=before.schema.find(s=>s.table==='auto_status')
  const owned=before.tables.auto_status.rows.find(s=>s.row.id===53)
  cleanup.checkedSQL()
  const rollbackFile=path.join(m.root,'migrations/tests/migration_v365_remove_unsupported_post_visible_status_rollback.sql')
  const artifact=fs.readFileSync(rollbackFile,'utf8')
  assert.equal(artifact,cleanup.rollbackSQL(), 'Generated rollback must match the checked artifact')
  await db.exec(`SET timezone='UTC'; CREATE SEQUENCE auto_status_id_seq START 54;
   SELECT setval('auto_status_id_seq',53,true);
   CREATE TABLE auto_status (${schema.columns.map(c=>`${c.name} ${c.type}${c.default?' DEFAULT '+c.default:''}${c.not_null?' NOT NULL':''}`).join(',')},PRIMARY KEY(id),UNIQUE(code));`)
  const localSchema=(await db.query(`SELECT s::text canonical,md5(s::text) md5 FROM (SELECT ${m.schemaSQL('auto_status')} s)q`)).rows[0]
  const localRowHash=(await db.query('SELECT md5(to_jsonb(jsonb_populate_record(NULL::auto_status,$1::jsonb))::text) md5',[JSON.stringify(owned.row)])).rows[0].md5
  // The local owner, grants and schema names differ from production. Substitute
  // fixture expectations only; exercise the unchanged guard/restore statements.
  const expectedLiteral=m.quote(exact.canonical)+'::jsonb'
  assert(artifact.includes(expectedLiteral))
  const sql=artifact.replace(expectedLiteral,m.quote(localSchema.canonical)+'::jsonb').replace(owned.md5,localRowHash)
  const old=fs.readFileSync(path.join(cleanup.dir,'rollback-before-sequence-position-fix.sql'),'utf8')
   .replace(exact.md5,localSchema.md5).replace(owned.md5,localRowHash)
  const sequence=async()=>String((await db.query('SELECT last_value FROM auto_status_id_seq')).rows[0].last_value)
  const rows=async()=> (await db.query('SELECT id,md5(to_jsonb(s)::text) md5 FROM auto_status s ORDER BY id')).rows
  async function rejected(statement,pattern,label) {
   let failure
   try { await db.exec(statement) } catch (error) { failure=error; await db.exec('ROLLBACK;') }
   assert(failure,label+' must reject')
   assert.match(failure.message,pattern)
   checks.push(label)
  }
  await db.exec(sql)
  assert.deepEqual(await rows(),[{id:53,md5:localRowHash}])
  assert.equal(await sequence(),'53')
  checks.push('restore exact row without advancing sequence')
  await db.exec("DELETE FROM auto_status WHERE id=53; INSERT INTO auto_status(code,name,status_key,component_type) VALUES('independent_status','Independent','independent','campaign_detail');")
  const independent=await rows()
  await rejected(old,/auto_status schema drift/,'original rollback reproduces P2 after independent insert')
  await db.exec(sql)
  assert.deepEqual((await rows()).filter(r=>r.id!==53),independent)
  assert.equal(await sequence(),'54')
  checks.push('fixed rollback preserves independent row and sequence')
  await db.exec('DELETE FROM auto_status WHERE id=53')
  await db.exec("BEGIN; INSERT INTO auto_status(code,name,status_key,component_type) VALUES('aborted_status','Aborted','aborted','campaign_detail'); ROLLBACK;")
  assert.equal(await sequence(),'55')
  await db.exec(sql)
  assert.deepEqual((await rows()).filter(r=>r.id!==53),independent)
  assert.equal(await sequence(),'55')
  checks.push('sequence advance from rolled-back insert also permitted')
  await db.exec("DELETE FROM auto_status WHERE id=53; INSERT INTO auto_status(id,code,name,status_key,component_type) VALUES(53,'other_identity','Other','other','campaign_detail')")
  const collision=await rows()
  await rejected(sql,/Status identity already exists/,'occupied ID cannot be overwritten')
  assert.deepEqual(await rows(),collision)
  await db.exec("DELETE FROM auto_status WHERE id=53; INSERT INTO auto_status(id,code,name,status_key,component_type) VALUES(99,'campaign_detail_post_visible','Other','other','campaign_detail')")
  await rejected(sql,/Status identity already exists/,'occupied code cannot be overwritten')
  await db.exec("DELETE FROM auto_status WHERE id=99; INSERT INTO auto_status(id,code,name,status_key,component_type,status_value) VALUES(99,'other_identity','Other','other','campaign_detail','đã hiển thị bài')")
  await rejected(sql,/Status identity already exists/,'occupied status value cannot be overwritten')
  await db.exec('DELETE FROM auto_status WHERE id=99; ALTER SEQUENCE auto_status_id_seq INCREMENT BY 2')
  await rejected(sql,/auto_status schema drift/,'sequence definition change still rejected')
  await db.exec('ALTER SEQUENCE auto_status_id_seq INCREMENT BY 1; ALTER TABLE auto_status ADD COLUMN unexpected_column text')
  await rejected(sql,/auto_status schema drift/,'table column change still rejected')
  await db.exec('ALTER TABLE auto_status DROP COLUMN unexpected_column; CREATE INDEX unexpected_index ON auto_status(name)')
  await rejected(sql,/auto_status schema drift/,'index change still rejected')
  await db.exec('DROP INDEX unexpected_index')
  const tampered=sql.replace('"name":"Đã hiển thị bài"','"name":"tampered"')
  assert.notEqual(tampered,sql)
  await rejected(tampered,/Restore checksum mismatch/,'restored data checksum still enforced')
  assert.deepEqual(await rows(),independent)
  await db.exec('GRANT SELECT ON auto_status TO PUBLIC')
  await rejected(sql,/auto_status schema drift/,'permission change still rejected')
  const result={at:new Date().toISOString(),checks,rollback_sha256:m.hash(artifact),
   original_migration_sha256:m.hash(cleanup.checkedSQL()),production_touched:false}
  if(process.argv.includes('--receipt'))fs.writeFileSync(path.join(cleanup.dir,'rollback-sequence-smoke.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify(result,null,2))
 } catch (error) {
  error.message += ` (after ${checks.at(-1) || 'fixture setup'})`
  throw error
 } finally { await db.close() }
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
