// Historical pre-V393 reproduction: current source uses boundaries-smoke instead.
// Reproduces the two remaining V389 findings after restoration. These are known
// failing behaviors, not acceptance tests declaring them fixed. No Facebook I/O.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fixture, root } = require('./facebook-random-run-fixture.cjs')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const dir = path.join(root, 'migrations/snapshots/facebook-random-run-restore-v392')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

async function latePause() {
  const started = deferred(), commit = deferred(), noteStarted = deferred(), noteReleased = deferred(), response = deferred()
  const parent = randomUUID()
  const account = { id: 1, staffId: 1, flatformType: 'facebook', status: 'đang chạy' }
  const campaign = { id: 2, accountId: 1, staffId: 1, actionId: 'facebook_group_post', name: 'review', status: 'đang chạy' }
  let owner = parent
  const db = {
    getCampaign: async () => ({ ...campaign }),
    cleanupFailedCampaignRuntime: async payload => {
      assert.equal(payload.runtimeClaimToken, parent)
      started.resolve(); await commit.promise
      campaign.status = payload.campaignStatus; owner = null
      noteReleased.resolve(); await response.promise
      return { ok: true, reason: 'cleaned' }
    },
    updateRunningDesktopCampaignPauseNote: async (_id, expectedOwner) => {
      noteStarted.resolve(); await noteReleased.promise
      if (owner !== expectedOwner) return null
      throw Error('Fixture must resolve cleanup before pause note acquires row')
    }
  }
  const Scheduler = schedulerClass({})
  const scheduler = new Scheduler(db, {}, { webContents: { send() {} } })
  scheduler.running = true
  scheduler.campaignRunBoundaries.set(2, { runtimeClaimToken: parent })
  const ending = scheduler.finishRandomBudget(account, campaign)
  await started.promise
  const pausing = scheduler.requestPauseCampaign(2)
  await noteStarted.promise
  commit.resolve()
  const pausedResponse = await pausing
  response.resolve(); await ending
  assert.equal(campaign.status, 'chờ xử lý')
  assert.equal(pausedResponse.status, 'chờ xử lý')
  assert.equal(scheduler.pauseRequests.has(2), true)
  return { finding: 'late_pause_after_budget_cleanup_started', expected: 'tạm dừng', actual: campaign.status, pauseLatchRetained: true }
}

async function restartAfterPartialTurn() {
  const db = await fixture({ restoredLifecycle: true })
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result
  const rpc = (op, input = {}) => scalar("SELECT aka_agent_facebook_random_run(1,1,'fixture','fixture',1,$1,$2::jsonb) result", [op, JSON.stringify(input)])
  try {
    const support = JSON.parse(fs.readFileSync(path.join(dir, 'review-support.json')))
    await db.exec('CREATE TABLE IF NOT EXISTS auto_campaign_inputs(id bigint PRIMARY KEY,campaign_id bigint,status text,is_delete boolean,note text); GRANT ALL ON auto_campaign_inputs TO anon;')
    for (const f of support.filter(f => f.signature.startsWith('reset_desktop_running_statuses'))) await db.exec(f.definition + ';')
    await rpc('save', { config: { version: 1, revision: 0, rules: [{ campaignActionId: 'facebook_group_post', quantity: 3, unit: 'data' }] } })
    await rpc('toggle', { enabled: true, revision: 1 })
    const plan = await rpc('plan', { revision: 1, choices: [{ ruleIndex: 0, campaignId: 1 }] })
    const turn = plan.turns[0], claim = randomUUID(), unit = randomUUID()
    assert((await rpc('claim', { turnId: turn.id, campaignId: 1, claimToken: claim })).ok)
    assert((await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r", [claim, plan.date, unit])).ok)
    await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
    assert((await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r", [unit])).ok)
    await rpc('toggle', { enabled: false, revision: 1 })
    // Same ordering as handlers.ts: reset first, then recover durable units.
    await scalar('SELECT reset_desktop_running_statuses_no_retry(1,false,true) result')
    await scalar("SELECT to_jsonb(r) result FROM aka_agent_recover_campaign_runtime_unit_leases(1,'desktop','all') r")
    const out = await rpc('progress', { turnId: turn.id, claimToken: claim })
    assert.equal(out.status, 'completed'); assert.equal(out.processed, 1); assert.equal(out.quantity, 3); assert.equal(out.reason, null)
    const remaining = await scalar("SELECT count(*)::int result FROM auto_campaign_input_data WHERE campaign_id=1 AND status='chờ xử lý'")
    assert.equal(remaining, 3)
    return { finding: 'restart_reset_finalizes_before_recovery', expected: 'stopped', actual: out.status, processed: out.processed, quantity: out.quantity, pendingInputs: remaining, reason: out.reason }
  } finally { await db.close() }
}

async function main() {
  const findings = [await latePause(), await restartAfterPartialTurn()]
  const report = { at: new Date().toISOString(), findings, externalFacebookOperations: 0 }
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(report)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
