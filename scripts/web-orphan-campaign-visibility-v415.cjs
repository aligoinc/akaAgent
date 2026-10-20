// Runs captured live SQL and the real migration in memory, with no network.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const root = path.resolve(__dirname, '..')
const web = process.env.AKA_AGENT_WEB_REPO || path.resolve(root, '../akaAgentWebApp')
const snapshot = path.join(root, 'migrations/snapshots/web-orphan-campaign-v415')
const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'))
const before = JSON.parse(fs.readFileSync(path.join(snapshot, 'before.json'), 'utf8'))
const source = before.find(row => `public.${row.signature}` === manifest.signature).definition
const logSource = before.find(row => row.signature.startsWith('aka_agent_control_campaign_logs('))
const logHelper = JSON.parse(fs.readFileSync(path.join(snapshot, 'log-reader-dependency.json'), 'utf8'))
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v415_web_orphan_campaign_visibility.sql'), 'utf8')
const rollback = fs.readFileSync(path.join(snapshot, 'rollback.sql'), 'utf8')
const assertions = fs.readFileSync(path.join(web, 'scripts/test-fixtures/campaign-orphan-visibility-assertions.sql'), 'utf8')
  + fs.readFileSync(path.join(web, 'scripts/test-fixtures/campaign-orphan-history-assertions.sql'), 'utf8')

async function main() {
  const db = new PGlite()
  const checksum = async () => (await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) AS checksum', [manifest.signature])).rows[0].checksum
  try {
    await db.exec(fs.readFileSync(path.join(web, 'scripts/test-fixtures/campaign-list-schema.sql'), 'utf8'))
    await db.exec(`CREATE SCHEMA private;
      CREATE TABLE auto_campaign_logs(id bigint PRIMARY KEY,campaign_id bigint,log text,created_at timestamptz DEFAULT now());
      INSERT INTO auto_campaign_logs(id,campaign_id,log) VALUES
      (9007199254740993,1,'First'),(9007199254740994,1,'Second'),(9007199254740995,1,'Third'),
      (9007199254740996,2001,'SMS history'),(9007199254740997,2006,'Orphan history');`)
    await db.exec(logHelper.definition)
    await db.exec(logSource.definition)
    await db.exec(`REVOKE ALL ON FUNCTION public.${logSource.signature} FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.${logSource.signature} TO service_role;`)
    await db.exec(source)
    await db.exec(`REVOKE ALL ON FUNCTION ${manifest.signature} FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION ${manifest.signature} TO service_role;`)
    assert.equal(await checksum(), manifest.sourceChecksum)
    await db.exec(fs.readFileSync(path.join(web, 'scripts/test-fixtures/campaign-list-assertions.sql'), 'utf8'))
    await assert.rejects(db.exec(assertions), /include deleted-account campaigns in total/)
    await db.exec('ROLLBACK')
    assert.equal((await db.query("SELECT aka_agent_control_campaign_logs(7,9,2006,ARRAY['zalo']) AS data")).rows[0].data,
      null, 'original history guard hides orphan')
    await db.exec(migration)
    assert.equal(await checksum(), manifest.targetChecksum)
    await db.exec(assertions)
    await db.exec(migration)
    assert.equal(await checksum(), manifest.targetChecksum)
    await db.exec(rollback)
    assert.equal(await checksum(), manifest.sourceChecksum)
    assert.equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) AS checksum',
      [`public.${logSource.signature}`])).rows[0].checksum, logSource.checksum)
    await db.exec(source.replace('  RETURN v_result;', '  -- fixture drift\n  RETURN v_result;'))
    const drift = await checksum()
    await assert.rejects(db.exec(migration), /RPC drift/)
    await db.exec('ROLLBACK')
    assert.equal(await checksum(), drift, 'unknown live patch must not be overwritten')
    await db.exec(source)
    await db.exec(migration)
    await db.exec(assertions)
    assert.equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) AS checksum',
      [logHelper.signature])).rows[0].checksum, logHelper.checksum, 'preserve live custom-plan log reader patch')
    console.log(JSON.stringify({ result: 'PASS', source: manifest.sourceChecksum, target: manifest.targetChecksum,
      checks: ['original regression reproduced', 'orphan visibility/filter/selection/paging', 'tenant/platform/ACL',
        'delete/re-add preserves links', 'idempotent migration', 'rollback', 'drift fails closed'] }))
  } finally {
    await db.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
