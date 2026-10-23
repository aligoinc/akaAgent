const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const initial = require('./build-facebook-native-group-share.cjs')
const patch = require('./build-facebook-native-group-share-search-wait.cjs')
const md5 = value => crypto.createHash('md5').update(value).digest('hex')
async function main() {
  const db = new PGlite()
  let checks = 0
  try {
    for (const table of ['auto_workflows', 'auto_blocks', 'auto_elements']) {
      const cols = initial.before.schema.filter(c => c.table === table)
      await db.exec(`CREATE SEQUENCE ${table}_id_seq START 20000; CREATE TABLE ${table} (${cols.map(c => `${c.column} ${c.type}${c.default ? ' DEFAULT '+c.default : ''}${c.nullable === 'NO' ? ' NOT NULL' : ''}`).join(',')}, PRIMARY KEY(id));`)
      for (const row of initial.before[table.replace('auto_', '')]) {
        await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`, [JSON.stringify(row)])
      }
    }
    await db.exec(initial.sql)
    const rows = async table => (await db.query(`SELECT to_jsonb(t)-'created_at'-'updated_at' AS row FROM ${table} t ORDER BY id`)).rows.map(r => r.row)
    const oldBlocks = await rows('auto_blocks'), oldElements = await rows('auto_elements'), oldWorkflows = await rows('auto_workflows')
    const old = oldBlocks.find(b => b.name === patch.before.name)
    assert.notEqual(old.id, patch.before.id, 'follow-up must resolve the block by name, not a production ID')
    assert.equal(md5(old.code), 'ef549f46016fe693ce3a5b67bfcba98a'); checks++
    await db.exec(patch.sql)
    const after = await rows('auto_blocks')
    assert.deepEqual(after, oldBlocks.map(b => b.name === patch.before.name ? { ...b, code: patch.after.code } : b))
    assert.deepEqual(await rows('auto_elements'), oldElements)
    assert.deepEqual(await rows('auto_workflows'), oldWorkflows); checks += 3
    await db.exec(patch.sql)
    assert.deepEqual(await rows('auto_blocks'), after); checks++
    await db.exec(patch.rollbackSql)
    assert.deepEqual(await rows('auto_blocks'), oldBlocks); checks++
    await db.exec(patch.rollbackSql)
    assert.deepEqual(await rows('auto_blocks'), oldBlocks); checks++
    for (const field of ['code', 'description']) {
      await db.exec(`BEGIN; UPDATE auto_blocks SET ${field}='new live patch' WHERE name='fb_select_native_share_group'`)
      await assert.rejects(db.exec(patch.sql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')), /search_wait_drift/)
      await db.exec('ROLLBACK'); checks++
    }
    await db.exec(patch.sql)
    await db.exec("BEGIN; UPDATE auto_blocks SET code='new live patch' WHERE name='fb_select_native_share_group'")
    await assert.rejects(db.exec(patch.rollbackSql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')), /rollback_drift/)
    await db.exec('ROLLBACK'); checks++
    assert.equal(initial.sql, fs.readFileSync('supabase/migrations/20261023142009_facebook_native_group_share.sql','utf8'))
    assert.equal(initial.rollbackSql, fs.readFileSync('migrations/snapshots/facebook-native-group-share/rollback.sql','utf8'))
    assert.equal(patch.sql, fs.readFileSync(patch.migrationPath,'utf8')); checks += 3
    const oldHelpers = patch.before.code.slice(patch.before.code.indexOf('async function rawClear('), patch.before.code.indexOf('await page.navigate'))
    assert(patch.after.code.includes(oldHelpers), 'reuse the exact input helpers')
    assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|ALTER\s+|DROP\s+|CREATE\s+TABLE/i.test(patch.sql)); checks += 2
    console.log(`${checks} search-wait migration checks passed; original migration unchanged; no live DB`)
  } finally { await db.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
