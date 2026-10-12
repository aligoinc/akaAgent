// Real captured block code and offline PostgreSQL; no Facebook actions or live DB writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const { runBlock } = require('./facebook-first-comment-link-smoke.cjs')
const v = require('./facebook-comment-link-tracking-v381.cjs')
const b = v.backup()
let checks = 0
const sample = 'https://www.facebook.com/groups/164469482423151/permalink/1378592311010856/?comment_id=1387816013421819&__cft__[0]=AZiIwvviAdKikn80xozsYyn8gfaQFhK-hnB68bA9FVbm-9V5ZT1r34fspMn9eOU2QkMIg8QOKHhDXH0lBYwibyxriAaTpWvfANcyh5dfzbDOxYyptuU-ybgrsFjoyWnR651gWyoIxm5SPpm2jhDahP_xy7ue3bOdN4rwKnI8_9sqynlJ8lx_dolycbeZqRs&__cft__[1]=AZi1aKeHrpDf1c3Dy6sEcdT1q8LWzARgRDNPcICv4a8BkjG57zk08wHSLoxUmVF_Ub-4x1ANFbCZ4HZK7-TISkzppzfNzbB4lu5PKONmW179v2DBFq-kvWHmeZMDdQ0R3nw6mDwa1lgLk&__tn__=R]-R'
const cleanSample = 'https://www.facebook.com/groups/164469482423151/permalink/1378592311010856/?comment_id=1387816013421819'

async function blockTests() {
  const cases = [
    [sample, cleanSample],
    [cleanSample, cleanSample],
    ['https://www.facebook.com/p/posts/1?__cft__%5B0%5D=x&comment_id=111&reply_comment_id=222&__tn__=R&__cft__[1]=y#comment_222',
      'https://www.facebook.com/p/posts/1?comment_id=111&reply_comment_id=222#comment_222'],
    ['https://www.facebook.com/permalink.php?story_fbid=pfbidABC&id=42&comment_id=111&reply_comment_id=222&ref=share&refid=18&refsrc=deprecated&locale=vi_VN',
      'https://www.facebook.com/permalink.php?story_fbid=pfbidABC&id=42&comment_id=111&reply_comment_id=222'],
    ['https://www.facebook.com/photo.php?fbid=42&set=album&type=3&comment_id=111&fbclid=x&mibextid=y&utm_source=facebook&utm_campaign=test',
      'https://www.facebook.com/photo.php?fbid=42&set=album&type=3&comment_id=111'],
    ['https://www.facebook.com/p/posts/1?comment_id=111&context=keep&context=also',
      'https://www.facebook.com/p/posts/1?comment_id=111&context=keep&context=also'],
    ['/p/posts/1?reply_comment_id=222&__tn__=R', 'https://www.facebook.com/p/posts/1?reply_comment_id=222'],
    ['https://[invalid', 'https://[invalid'],
    ['', '']
  ]
  for (const block of v.desired()) {
    const old = b.tables.auto_blocks.find(entry => entry.row.id === block.id).row
    for (const [raw, expected] of cases) {
      const opts = { hrefs: [raw, 'https://www.facebook.com/p/posts/2?comment_id=999'] }
      const previous = await runBlock(old, opts), current = await runBlock(block, opts)
      assert.equal(current.result.commentUrl, expected)
      const withoutUrl = output => { const result = JSON.parse(JSON.stringify(output)); delete result.commentUrl; return result }
      assert.deepEqual(withoutUrl(current.result), withoutUrl(previous.result))
      assert.deepEqual(current.events, previous.events, 'no new Facebook actions, lookup, sleep or resubmit')
      checks++
    }
    for (const options of [{ missing: true }, { readError: true }, { elementError: true }]) {
      const { result, events } = await runBlock(block, options)
      assert.equal(result.commented, true)
      assert.equal(result.commentUrl, '')
      assert.equal(events.filter(event => event === 'press:Enter').length, 1)
      checks++
    }
  }
}

async function sqlTests() {
  const db = new PGlite()
  try {
    await db.exec("SET timezone='UTC'")
    for (const [table, rows] of Object.entries(b.tables)) {
      const fields = Object.entries(rows[0].row).map(([key, value]) => `${key} ${key === 'id' ? 'bigint PRIMARY KEY' :
        ['created_at', 'updated_at'].includes(key) ? 'timestamptz' : value && typeof value === 'object' ? 'jsonb' :
          typeof value === 'boolean' ? 'boolean' : typeof value === 'number' || ['staff_id', 'organization_id'].includes(key) ? 'bigint' : 'text'}`)
      await db.exec(`CREATE TABLE ${table} (${fields.join(',')});`)
      for (const { row } of rows) await db.exec(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},${v.json(row)});`)
    }
    await db.exec(`CREATE TABLE auto_workflows(id bigint PRIMARY KEY,name text);
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text);
      INSERT INTO supabase_migrations.schema_migrations VALUES('20261012220158','migration_v380_facebook_first_comment_link');`)
    for (const w of b.workflows) await db.exec(`INSERT INTO auto_workflows VALUES(${w.id},'offline fixture');`)
    // Workflows are checksum-only dependencies. Use fixture hashes for this reduced offline table.
    let sql = v.sql()
    const workflows = (await db.query('SELECT id,md5(to_jsonb(w)::text) hash FROM auto_workflows w')).rows
    for (const w of workflows) sql = sql.replace(b.workflows.find(row => row.id === w.id).md5, w.hash)
    const original = (await db.query('SELECT to_jsonb(t) row FROM auto_blocks t ORDER BY id')).rows
    await db.exec(sql)
    const strip = row => { const copy = { ...row }; delete copy.updated_at; return copy }
    assert.deepEqual((await db.query('SELECT to_jsonb(t) row FROM auto_blocks t ORDER BY id')).rows.map(({ row }) => strip(row)), v.desired().map(strip)); checks++
    assert.deepEqual((await db.query('SELECT to_jsonb(t) row FROM auto_elements t ORDER BY id')).rows, b.tables.auto_elements.map(({ row }) => ({ row }))); checks++
    assert.deepEqual((await db.query('SELECT id,md5(to_jsonb(w)::text) hash FROM auto_workflows w')).rows, workflows); checks++
    await db.exec("UPDATE auto_blocks SET code=code||'// newer patch' WHERE id=34")
    await assert.rejects(db.exec(v.rollbackSQL()), /block\/34 drift/); await db.exec('ROLLBACK'); checks++
    await db.exec(`UPDATE auto_blocks SET code=${v.quote(v.desired().find(row => row.id === 34).code)} WHERE id=34`)
    await db.exec(v.rollbackSQL())
    assert.deepEqual((await db.query('SELECT to_jsonb(t) row FROM auto_blocks t ORDER BY id')).rows, original); checks++
    for (const [mutate, restore, expected] of [
      ["UPDATE auto_blocks SET code=code||'// drift' WHERE id=2616", `UPDATE auto_blocks SET code=${v.quote(b.tables.auto_blocks.find(entry => entry.row.id === 2616).row.code)} WHERE id=2616`, /auto_blocks\/2616 drift/],
      ["UPDATE auto_elements SET xpath='changed' WHERE id=1784", `UPDATE auto_elements SET xpath=${v.quote(b.tables.auto_elements[0].row.xpath)} WHERE id=1784`, /auto_elements\/1784 drift/],
      ["UPDATE auto_workflows SET name='changed' WHERE id=1", "UPDATE auto_workflows SET name='offline fixture' WHERE id=1", /workflow\/1 drift/],
      [`INSERT INTO supabase_migrations.schema_migrations VALUES('fixture',${v.quote(v.name)})`, "DELETE FROM supabase_migrations.schema_migrations WHERE version='fixture'", /already applied/],
      ["DELETE FROM supabase_migrations.schema_migrations", "INSERT INTO supabase_migrations.schema_migrations VALUES('20261012220158','migration_v380_facebook_first_comment_link')", /V380 history missing/]
    ]) {
      await db.exec(mutate)
      await assert.rejects(db.exec(sql), expected); await db.exec('ROLLBACK')
      await db.exec(restore)
      assert.deepEqual((await db.query('SELECT to_jsonb(t) row FROM auto_blocks t ORDER BY id')).rows, original)
      checks++
    }
  } finally { await db.close() }
}

async function main() {
  assert.equal(fs.readFileSync(v.migrationPath, 'utf8'), v.sql())
  await blockTests(); await sqlTests()
  console.log(JSON.stringify({ passed: true, checks, clean_sample: cleanSample, external_operations: 0 }))
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
