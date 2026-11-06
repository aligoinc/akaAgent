// V472 SQL rehearsal on PostgreSQL WASM with the exact live columns and rows
// captured in before.json. Offline only: no production connection.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/fb-comment-post-unavailable-v472')
const before = JSON.parse(fs.readFileSync(path.join(dir, 'before.json'), 'utf8'))
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v472_fb_comment_post_unavailable.sql'), 'utf8')
const rollback = fs.readFileSync(path.join(root, 'migrations/rollback_v472_fb_comment_post_unavailable.sql'), 'utf8')
const afterCode = fs.readFileSync(path.join(dir, 'block-2616.after.js'), 'utf8')
const beforeCode = fs.readFileSync(path.join(dir, 'block-2616.before.js'), 'utf8')
let checks = 0

async function fixture() {
  const db = new PGlite()
  await db.exec("SET TimeZone = 'UTC';")
  for (const cols of Object.values(before.schema)) {
    for (const c of cols) {
      const seq = /nextval\('([a-z_]+)'::regclass\)/.exec(c.default || '')
      if (seq) await db.exec(`CREATE SEQUENCE IF NOT EXISTS public.${seq[1]}`)
    }
  }
  for (const [table, cols] of Object.entries(before.schema)) {
    const defs = cols.map(c => `${c.name} ${c.type}${c.default ? ' DEFAULT ' + c.default : ''}${c.not_null ? ' NOT NULL' : ''}`)
    defs.push('PRIMARY KEY (id)')
    if (table === 'auto_error') {
      defs.push('UNIQUE (error_code)')
      defs.push("CHECK (detail_mode = ANY (ARRAY['inherit','override','suppress']))")
      defs.push("CHECK ((detail_mode IS DISTINCT FROM 'override') OR (detail_status_id IS NOT NULL))")
    }
    await db.exec(`CREATE TABLE public.${table} (${defs.join(', ')})`)
  }
  const insert = (table, row) => db.query(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_record(NULL::public.${table}, $1::jsonb)`, [JSON.stringify(row)])
  for (const row of before.workflow_207_blocks) await insert('auto_blocks', row)
  await insert('auto_workflows', before.workflow_207)
  for (const row of before.auto_error_all) await insert('auto_error', row)
  await db.query('SELECT setval(\'public.auto_error_id_seq\', $1, true)', [before.error_max_id])
  return db
}
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]
async function runScript(db, sql) {
  try { await db.exec(sql); return null } catch (error) { await db.exec('ROLLBACK').catch(() => {}); return error }
}
async function snapshot(db) {
  return {
    code: (await one(db, 'SELECT md5(code) m FROM auto_blocks WHERE id = 2616')).m,
    errors: (await db.query('SELECT id, md5((to_jsonb(e) - \'updated_at\')::text) m, detail_mode FROM auto_error e ORDER BY id')).rows,
    count: Number((await one(db, 'SELECT count(*) n FROM auto_error')).n)
  }
}

async function main() {
  const db = await fixture()
  try {
    // Fidelity: the rebuilt rows hash exactly like production did at capture time.
    assert.equal((await one(db, 'SELECT md5(code) m FROM auto_blocks WHERE id = 2616')).m, before.block_code_md5)
    assert.equal((await one(db, 'SELECT md5(nodes::text || edges::text) m FROM auto_workflows WHERE id = 207')).m, before.wf207_md5)
    checks += 2
    const original = await snapshot(db)

    // Apply.
    assert.equal(await runScript(db, migration), null); checks++
    const row = await one(db, "SELECT * FROM auto_error WHERE error_code = 'err_fb_comment_box_not_found'")
    assert.equal(Number(row.id), before.error_max_id + 1)
    assert.equal(row.detail_mode, 'inherit'); assert.equal(row.counts_toward_limit, false); assert.equal(row.counts_toward_bad_target, true)
    assert.equal(row.update_status_campaign, null); assert.equal(row.is_active, true); checks += 6
    assert.equal((await one(db, 'SELECT code FROM auto_blocks WHERE id = 2616')).code, afterCode); checks++
    const modes = (await db.query('SELECT id, detail_mode FROM auto_error WHERE id IN (74,75,76,77) ORDER BY id')).rows
    assert.deepEqual(modes.map(r => r.detail_mode), ['inherit', 'inherit', 'inherit', 'inherit']); checks++
    const applied = await snapshot(db)
    const changed = applied.errors.filter(r => r.m !== original.errors.find(o => o.id === r.id)?.m).map(r => Number(r.id))
    assert.deepEqual(changed, [74, 75, 76, 77, before.error_max_id + 1], 'only the four policies and the new row change'); checks++

    // Re-running is refused by the preflight and leaves the data untouched.
    const again = await runScript(db, migration)
    assert.match(String(again && again.message), /v472 preflight: auto_blocks\/2616 changed/); checks++
    assert.deepEqual(await snapshot(db), applied); checks++

    // Rollback restores the block and policies; the new code stays inactive for history.
    assert.equal(await runScript(db, rollback), null); checks++
    assert.equal((await one(db, 'SELECT code FROM auto_blocks WHERE id = 2616')).code, beforeCode); checks++
    const restored = await snapshot(db)
    for (const o of original.errors) assert.equal(restored.errors.find(r => r.id === o.id).m, o.m, `row ${o.id} restored`)
    checks++
    assert.equal((await one(db, "SELECT is_active FROM auto_error WHERE error_code = 'err_fb_comment_box_not_found'")).is_active, false); checks++
    // A second rollback is refused because the block is no longer the V472 version.
    const rollbackAgain = await runScript(db, rollback)
    assert.match(String(rollbackAgain && rollbackAgain.message), /not the V472 version/); checks++
  } finally { await db.close() }

  // Drift guards: a changed policy row or workflow aborts before any write.
  for (const [label, sql, pattern] of [
    ['policy drift', "UPDATE auto_error SET noti_campaign = 'x' WHERE id = 75", /auto_error 74-77 changed/],
    ['workflow drift', "UPDATE auto_workflows SET edges = edges || '[]'::jsonb, nodes = nodes || '[{}]'::jsonb WHERE id = 207", /auto_workflows\/207 changed/],
    ['code exists', "INSERT INTO auto_error(error_type,error_name,error_code) VALUES('system','x','err_fb_comment_box_not_found')", /already exists/],
    ['sequence behind', "SELECT setval('public.auto_error_id_seq', 5, true)", /auto_error_id_seq is behind/]
  ]) {
    const db2 = await fixture()
    try {
      await db2.exec(sql)
      const stateBefore = await snapshot(db2)
      const error = await runScript(db2, migration)
      assert.match(String(error && error.message), pattern, label)
      assert.deepEqual(await snapshot(db2), stateBefore, `${label}: no partial write`)
      checks += 2
    } finally { await db2.close() }
  }
  console.log(JSON.stringify({ passed: true, checks, production_calls: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
