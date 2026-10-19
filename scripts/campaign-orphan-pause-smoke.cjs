// Exercise the real IPC callback, repository read, scheduler and captured SQL.
// PostgreSQL runs in memory; this script never connects to production.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { fixture, root } = require('./facebook-random-run-fixture.cjs')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const dir = path.join(root, 'migrations/snapshots/campaign-orphan-pause')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261019130317_campaign_orphan_pause.sql'), 'utf8')

function callback(db, scheduler) {
  const source = ts.createSourceFile('handlers.ts', fs.readFileSync(path.join(root, 'src/main/ipc/handlers.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  let found
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'requestCampaignStatus') found = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(found)
  const code = ts.transpileModule(`const callback = ${found}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('supabase', 'campaignScheduler', code + '; return callback')(db, scheduler)
}

async function main() {
  const pg = await fixture({ boundaries: true })
  const scalar = async (sql, args = []) => (await pg.query(sql, args)).rows[0].result
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'before.json')))
  try {
    for (const row of rows) await pg.exec(row.definition + ';')
    await pg.exec("UPDATE auto_accounts SET flatform_type='zalo',is_delete=true,is_active=false WHERE id=1;")
    const control = async status => scalar('SELECT to_jsonb(r) result FROM aka_agent_set_desktop_campaign_status_v2(1,1,1,$1) r', [status])
    assert.equal((await control('tạm dừng')).reason, 'account_deleted', 'reproduce original database rejection')
    await pg.exec(migration)
    await pg.exec('BEGIN; ' + fs.readFileSync(path.join(root, 'migrations/tests/campaign_orphan_pause_smoke.sql'), 'utf8') + ' ROLLBACK;')
    await pg.exec("UPDATE auto_campaigns SET status='đang chạy' WHERE id=1;")
    assert.equal((await control('tạm dừng')).reason, 'runtime_busy', 'reproduce unowned running orphan after the first fix')
    const runningMigration = fs.readdirSync(path.join(root, 'supabase/migrations')).find(name => name.endsWith('_campaign_orphan_running_pause.sql'))
    assert(runningMigration)
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations', runningMigration), 'utf8'))
    await pg.exec('BEGIN; ' + fs.readFileSync(path.join(root, 'migrations/tests/campaign_orphan_running_pause_smoke.sql'), 'utf8') + ' ROLLBACK;')

    const getCampaign = async () => {
      const row = (await pg.query('SELECT * FROM auto_campaigns WHERE id=1')).rows[0]
      return { id: 1, accountId: 1, actionId: 'zalo_message_phone', status: row.status }
    }
    let starts = 0, gatedReads = 0, pauseReads = 0, broadcasts = 0
    const db = {
      getCampaign,
      getAccount: async () => { gatedReads++; return null },
      getAccountForCampaignPause: async () => { pauseReads++; return { id: 1, flatformType: 'zalo', isZaloServer: false } },
      setDesktopCampaignStatusV2: async (cid, aid, status) => {
        assert.deepEqual([cid, aid], [1, 1]); return control(status)
      }
    }
    const Scheduler = schedulerClass({})
    const scheduler = new Scheduler(db, {}, { webContents: { send() {} } })
    scheduler.broadcastCampaignUpdate = () => { broadcasts++ }
    scheduler.requestResumeCampaign = async () => { starts++; throw Error('Resume must remain guarded') }
    const request = callback(db, scheduler)
    assert.equal((await request(1, 'tạm dừng')).status, 'tạm dừng')
    assert.equal(pauseReads, 1); assert.equal(gatedReads, 0); assert.equal(broadcasts, 1)
    assert.equal(scheduler.pauseRequests.has(1), false)
    assert.equal(await scalar('SELECT status result FROM auto_campaigns WHERE id=1'), 'tạm dừng', 'running orphan must persist paused')

    // A new runtime can claim between the initial read and the pause RPC.
    // The DB lease, not this process's empty boundary map, decides ownership.
    const token = '41000000-0000-4000-8000-000000000001'
    await pg.exec("UPDATE auto_campaigns SET status='đang chạy' WHERE id=1;")
    db.setDesktopCampaignStatusV2 = async () => {
      await pg.query("UPDATE auto_campaigns SET runtime_claim_token=$1,runtime_claim_target='desktop',runtime_claim_vietnam_date=current_date,runtime_claimed_at=now() WHERE id=1", [token])
      return control('tạm dừng')
    }
    assert.equal((await request(1, 'tạm dừng')).status, 'đang chạy')
    assert.equal(await scalar('SELECT runtime_claim_token result FROM auto_campaigns WHERE id=1'), token)
    assert.equal(scheduler.pauseRequests.has(1), true)
    db.setDesktopCampaignStatusV2 = async (_cid, _aid, status) => control(status)
    await pg.exec('UPDATE auto_campaigns SET runtime_claim_token=NULL,runtime_claim_target=NULL,runtime_claim_vietnam_date=NULL,runtime_claimed_at=NULL WHERE id=1;')
    assert.equal((await request(1, 'tạm dừng')).status, 'tạm dừng')
    assert.equal(scheduler.pauseRequests.has(1), false)
    await assert.rejects(request(1, 'chờ xử lý'), /không còn phù hợp/)
    assert.equal(starts, 0); assert.equal(gatedReads, 1)
    assert.equal((await control('chờ xử lý')).reason, 'account_deleted')
    await pg.exec("UPDATE auto_campaigns SET status='đang chạy' WHERE id=1;")
    db.setDesktopCampaignStatusV2 = async () => { throw Error('pause RPC unavailable') }
    await assert.rejects(request(1, 'tạm dừng'), /pause RPC unavailable/)
    assert.equal(scheduler.pauseRequests.has(1), false, 'failed orphan pause must not leave an unconsumed latch')
    assert.equal(await scalar('SELECT status result FROM auto_campaigns WHERE id=1'), 'đang chạy')
    db.setDesktopCampaignStatusV2 = async (_cid, _aid, status) => control(status)

    // Inactive accounts may stop but cannot resume; healthy queueing still works.
    await pg.exec("UPDATE auto_accounts SET is_delete=false WHERE id=1; UPDATE auto_campaigns SET status='chờ xử lý' WHERE id=1;")
    assert.equal((await control('tạm dừng')).reason, 'updated')
    assert.equal((await control('chờ xử lý')).reason, 'account_inactive')
    await pg.exec("UPDATE auto_accounts SET is_active=true,status='đang chạy' WHERE id=1;")
    assert.equal((await control('chờ xử lý')).reason, 'updated')
    await pg.exec("UPDATE auto_campaigns SET data_target_source_mode='data_group',note='Chờ data phù hợp' WHERE id=1;")
    assert.equal((await control('tạm dừng')).reason, 'updated')
    assert.equal(await scalar('SELECT note result FROM auto_campaigns WHERE id=1'), 'Chờ data phù hợp')

    // The deleted Server route uses its existing RPC, never Desktop fallback.
    await pg.exec("UPDATE auto_accounts SET is_delete=true,is_zalo_server=true WHERE id=1; UPDATE auto_campaigns SET action_id='zalo_message_phone',status='đang chạy' WHERE id=1;")
    db.getAccountForCampaignPause = async () => ({ id: 1, flatformType: 'zalo', isZaloServer: true })
    db.setZaloServerCampaignStatus = async (id, status) => {
      assert.equal(id, 1)
      return scalar('SELECT to_jsonb(r) result FROM aka_agent_set_zalo_server_campaign_status(1,1,$1) r', [status])
    }
    assert.equal((await request(1, 'tạm dừng')).status, 'tạm dừng')
    assert.equal(broadcasts, 3)
    db.setZaloServerCampaignStatus = async () => ({ ok: false, reason: 'runtime_not_owner' })
    await assert.rejects(request(1, 'tạm dừng'), /Organization không còn chạy Zalo Server/)
    db.getAccountForCampaignPause = async () => { throw Error('database unavailable') }
    await assert.rejects(request(1, 'tạm dừng'), /database unavailable/)

    // Verify the actual narrow account read stays staff-scoped and exposes no credentials.
    const source = ts.createSourceFile('accountRepository.ts', fs.readFileSync(path.join(root, 'src/main/data/repositories/accountRepository.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
    const method = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getAccountForCampaignPause')
    const code = ts.transpileModule(method.getText(source).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const filters = [], selected = []
    const query = { select(columns) { selected.push(columns); return this }, eq(...args) { filters.push(args); return this },
      async maybeSingle() { return { data: { id: 1, flatform_type: 'zalo', is_zalo_server: true }, error: null } } }
    const lookup = new Function('client', 'requireCurrentUser', code + ';return getAccountForCampaignPause')(
      () => ({ from: table => { assert.equal(table, 'auto_accounts'); return query } }), () => ({ staffId: 1 }))
    assert.deepEqual(await lookup(1), { id: 1, flatformType: 'zalo', isZaloServer: true })
    assert.deepEqual(filters, [['id', 1], ['staff_id', 1]])
    assert.deepEqual(selected, ['id,flatform_type,is_zalo_server'])
    console.log('PASS: original and unowned-running failures reproduced; 21 original + 26 current SQL guards; real IPC → scheduler → SQL pause; racing owner, Server routing, resume guards, inactive/healthy queueing and narrow account read')
  } finally { await pg.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
