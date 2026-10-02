// Isolated PostgreSQL (PGlite); no network, Zalo actions or production writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { PGlite } = require(path.resolve(__dirname, '../../akaAgentChatApi/node_modules/@electric-sql/pglite'))
const root = path.resolve(__dirname, '..')
async function main() {
  const db = new PGlite()
  try {
    await db.exec(fs.readFileSync(path.join(root, 'scripts/fixtures/zalo-engagement/schema.sql'), 'utf8'))
    const old = fs.readFileSync(path.join(root, 'migrations/migration_v339_zalo_campaign_engagement.sql'), 'utf8')
    for (const phase of old.matchAll(/-- @phase \w+\n([\s\S]*?)(?=-- @phase |$)/g)) await db.exec(phase[1])
    const metadata = async () => (await db.query(`SELECT md5(pg_get_functiondef(oid)) checksum,proowner::regrole::text owner,prosecdef,provolatile,proconfig,proacl::text acl
      FROM pg_proc WHERE oid='public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'::regprocedure`)).rows[0]
    const before = await metadata()
    assert.equal(before.checksum, '0bdce96014857158991a7c0ce78e81ca')
    await db.exec('BEGIN')
    const migration = fs.readFileSync(path.join(root, 'migrations/migration_v341_zalo_engagement_chat_registration.sql'), 'utf8')
    await db.exec(migration)
    await db.exec(migration) // Target checksum permits idempotent reapply.
    const after = await metadata()
    assert.deepEqual(after, { ...before, checksum: '2bacb504c895ea6efd6a1d9b68d6e213' })
    await db.exec('ROLLBACK')
    assert.deepEqual(await metadata(), before)
    console.log('PASS v341 transaction rollback, source/target checksums, idempotency and unchanged owner/ACL/security/config')
  } finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
