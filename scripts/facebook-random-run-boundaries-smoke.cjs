// Real scheduler methods and Postgres functions; no Facebook I/O.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fixture, root } = require('./facebook-random-run-fixture.cjs')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

async function pauseCase(timing) {
  const started = deferred(), commit = deferred(), noteStarted = deferred(), noteReleased = deferred(), response = deferred()
  const parent = randomUUID()
  const account = { id: 1, staffId: 1, flatformType: 'facebook', status: 'đang chạy' }
  const campaign = { id: 2, accountId: 1, staffId: 1, actionId: 'facebook_group_post', name: 'boundary', status: 'đang chạy' }
  let owner = parent, guarded = 0, payload, pauseCommitted = false
  const db = {
    getCampaign: async () => {
      if (pauseCommitted && timing === 'resume-after-pause') campaign.status = 'chờ xử lý'
      return { ...campaign }
    },
    cleanupFailedCampaignRuntime: async input => {
      payload = input
      assert.equal(input.runtimeClaimToken, parent)
      started.resolve(); await commit.promise
      campaign.status = input.campaignStatus; owner = null
      noteReleased.resolve(); await response.promise
      return { ok: true, reason: 'cleaned' }
    },
    updateRunningDesktopCampaignPauseNote: async (_id, expectedOwner) => {
      noteStarted.resolve()
      if (timing !== 'before') await noteReleased.promise
      if (owner !== expectedOwner) return null
      return { ...campaign, note: 'Đang chờ tạm dừng' }
    },
    setDesktopCampaignStatusV2: async (id, accountId, status) => {
      guarded++
      assert.deepEqual([id, accountId, status], [2, 1, 'tạm dừng'])
      if (owner) return { ok: false, reason: 'runtime_busy' }
      if (campaign.status === 'tạm dừng') return { ok: true, reason: 'already_target' }
      assert.equal(campaign.status, 'chờ xử lý')
      campaign.status = status; pauseCommitted = true
      return { ok: true, reason: 'updated' }
    }
  }
  const Scheduler = schedulerClass({})
  const scheduler = new Scheduler(db, {}, { webContents: { send() {} } })
  scheduler.running = true
  scheduler.logCampaignProgress = async () => {}
  scheduler.campaignRunBoundaries.set(2, { runtimeClaimToken: parent })
  if (timing === 'before') await scheduler.requestPauseCampaign(2)
  const ending = scheduler.finishRandomBudget(account, campaign)
  await started.promise
  if (['during', 'new-owner', 'resume-after-pause'].includes(timing)) {
    const pausing = scheduler.requestPauseCampaign(2)
    await noteStarted.promise
    commit.resolve()
    await pausing
    if (timing === 'new-owner') { owner = randomUUID(); campaign.status = 'đang chạy' }
  } else {
    commit.resolve(); await noteReleased.promise
    if (timing === 'after-commit') await scheduler.requestPauseCampaign(2)
  }
  response.resolve(); await ending
  if (timing === 'after-finish') await scheduler.requestPauseCampaign(2)
  if (timing === 'new-owner') {
    assert.equal(campaign.status, 'đang chạy')
    assert.notEqual(owner, parent)
    assert.equal(scheduler.pauseRequests.has(2), true)
  } else if (timing === 'resume-after-pause') {
    assert.equal(campaign.status, 'chờ xử lý')
    assert.equal(scheduler.pauseRequests.has(2), false)
  } else if (timing === 'none') {
    assert.equal(campaign.status, 'chờ xử lý')
    assert.equal(guarded, 0)
  } else {
    assert.equal(campaign.status, 'tạm dừng')
    if (timing !== 'before') assert.equal(scheduler.pauseRequests.has(2), false)
  }
  assert.equal(payload.campaignStatus, timing === 'before' ? 'tạm dừng' : 'chờ xử lý')
  assert.equal(guarded, ['none', 'before'].includes(timing) ? 0 : 1)
  return timing
}

async function sqlCases() {
  const db = await fixture({ boundaries: true })
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result
  const rpc = (op, input = {}) => scalar("SELECT aka_agent_facebook_random_run(1,1,'fixture','fixture',1,$1,$2::jsonb) result", [op, JSON.stringify(input)])
  const marker = () => scalar("SELECT coalesce(current_setting('aka_agent.facebook_random_reset_staff',true),'') result")
  const recover = () => scalar("SELECT to_jsonb(r) result FROM aka_agent_recover_campaign_runtime_unit_leases(1,'desktop','all') r")
  const cases = []
  async function start(quantity = 3, inputs = [1]) {
    await rpc('save', { config: { version: 1, revision: 0, rules: [{ campaignActionId: 'facebook_group_post', quantity, unit: 'data' }] } })
    await rpc('toggle', { enabled: true, revision: 1 })
    const plan = await rpc('plan', { revision: 1, choices: [{ ruleIndex: 0, campaignId: 1 }] })
    const turn = plan.turns[0], claim = randomUUID(), unit = randomUUID()
    assert((await rpc('claim', { turnId: turn.id, campaignId: 1, claimToken: claim })).ok)
    assert((await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,$4::bigint[]) r", [claim, plan.date, unit, inputs])).ok)
    return {
      claim, unit,
      progress: () => rpc('progress', { turnId: turn.id, claimToken: claim }),
      settle: async () => {
        await db.query("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=ANY($1::bigint[])", [inputs])
        assert((await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r", [unit])).ok)
      }
    }
  }
  async function test(name, run) {
    await db.exec('BEGIN')
    try { await run(); cases.push(name) } finally { await db.exec('ROLLBACK; RESET ROLE;') }
    assert.equal(await marker(), '')
  }
  try {
    for (const reset of ['reset_desktop_running_statuses_no_retry', 'reset_desktop_running_statuses']) {
      for (const enabled of [true, false]) for (const activeUnit of [false, true]) {
        await test(reset + '/' + enabled + '/' + activeUnit, async () => {
          const t = await start()
          if (!activeUnit) await t.settle()
          if (!enabled) await rpc('toggle', { enabled: false, revision: 1 })
          await db.exec('SET LOCAL ROLE anon')
          await scalar('SELECT ' + reset + '(1,false,true) result')
          assert.equal(await marker(), '')
          assert.equal((await t.progress()).status, 'running')
          assert((await recover()).ok)
          const result = await t.progress()
          assert.equal(result.status, 'stopped')
          assert.match(result.reason, /gián đoạn|khôi phục|không xác định/i)
          // No-retry reset closes an uncertain started input; base reset
          // requeues it. Preserve those existing recovery counting policies.
          assert.equal(result.processed, activeUnit && reset === 'reset_desktop_running_statuses' ? 0 : 1)
          assert.ok(result.endedAt)
          assert.equal(await scalar('SELECT runtime_unit_token IS NULL AND runtime_claim_token IS NULL result FROM auto_campaigns WHERE id=1'), true)
          assert((await recover()).ok)
          assert.deepEqual(await t.progress(), result)
        })
      }
    }
    for (const count of [1, 3]) {
      await test('normal-release-' + count + '-of-3', async () => {
        const t = await start(3, count === 3 ? [1, 2, 3] : [1])
        await t.settle()
        if (count === 1) await db.exec("UPDATE auto_campaign_input_data SET is_delete=true WHERE id<>1")
        // An unrelated reset and a different staff context must not suppress normal release.
        await scalar('SELECT reset_desktop_running_statuses_no_retry(2,false,true) result')
        await scalar("SELECT set_config('aka_agent.facebook_random_reset_staff','2',true) result")
        await db.exec('SET LOCAL ROLE anon')
        const cleanup = await scalar("SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime(1,1,1,'desktop',$1::uuid,NULL,ARRAY[]::bigint[],'',false,'chờ xử lý','chờ xử lý') r", [t.claim])
        assert(cleanup.ok)
        assert.equal((await t.progress()).status, 'completed')
        assert.equal((await t.progress()).processed, count)
      })
    }
    await test('prior-context-restored-and-new-owner-guard', async () => {
      const t = await start()
      await t.settle()
      await scalar("SELECT set_config('aka_agent.facebook_random_reset_staff','99',true) result")
      await scalar('SELECT reset_desktop_running_statuses_no_retry(1,false,true) result')
      assert.equal(await marker(), '99')
      assert((await recover()).ok)
      // Actual control RPC must refuse to pause a newer parent.
      const newer = randomUUID()
      await db.exec("UPDATE auto_campaigns SET status='đang chạy' WHERE id=1")
      await db.query("UPDATE auto_campaigns SET runtime_claim_token=$1::uuid,runtime_claim_target='desktop' WHERE id=1", [newer])
      const paused = await scalar("SELECT to_jsonb(r) result FROM aka_agent_set_desktop_campaign_status_v2(1,1,1,'tạm dừng') r")
      assert.equal(paused.reason, 'runtime_busy')
      assert.equal(await scalar('SELECT runtime_claim_token::text result FROM auto_campaigns WHERE id=1'), newer)
    })
    await test('reset-failure-rolls-back-context', async () => {
      const t = await start(); await t.settle()
      await db.exec("CREATE FUNCTION private.v393_fail_reset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('aka_agent.facebook_random_reset_staff',true)='1' THEN RAISE EXCEPTION 'injected reset failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER v393_fail_reset AFTER UPDATE ON auto_campaigns FOR EACH ROW EXECUTE FUNCTION private.v393_fail_reset();")
      await db.exec('SAVEPOINT failed_reset')
      await assert.rejects(() => scalar('SELECT reset_desktop_running_statuses_no_retry(1,false,true) result'), /injected reset failure/)
      await db.exec('ROLLBACK TO SAVEPOINT failed_reset')
      assert.equal(await marker(), '')
      assert.equal((await t.progress()).status, 'running')
      assert.equal(await scalar('SELECT runtime_claim_token::text result FROM auto_campaigns WHERE id=1'), t.claim)
    })
    return cases
  } finally { await db.close() }
}

async function main() {
  const pauses = []
  for (const timing of ['none', 'before', 'during', 'after-commit', 'after-finish', 'new-owner', 'resume-after-pause']) pauses.push(await pauseCase(timing))
  const sql = await sqlCases()
  const report = { at: new Date().toISOString(), pauses, sql, externalFacebookOperations: 0 }
  fs.writeFileSync(path.join(root, 'migrations/snapshots/facebook-random-run-boundaries-v393/local-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(report)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
