// Local PostgreSQL + real scheduler methods. No external Facebook execution.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { fixture, root } = require('./facebook-random-run-fixture.cjs')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const { loadShared } = require('./facebook-page-content-rotation-smoke-test.cjs')
const dir = path.join(root, 'migrations/snapshots/campaign-shared-schedule-v397')
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v397_campaign_shared_schedule.sql'), 'utf8')
const withoutPreflight = migration.replace(/DO \$preflight\$[\s\S]*?END \$preflight\$;/, '')
async function main() {
  const db = await fixture({ boundaries: true })
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result
  const rpc = (op, input = {}) => scalar("SELECT aka_agent_facebook_random_run(1,1,'fixture','fixture',1,$1,$2::jsonb) result", [op, JSON.stringify(input)])
  const config = { version: 1, revision: 0, rules: [{ campaignActionId: 'facebook_group_post', quantity: 1, unit: 'data' }] }
  const cases = [
    ['direct', '', true],
    ['direct_old_end', "schedule_end_date=now()-interval '2 days'", true],
    ['group_future', "data_target_source_mode='data_group',schedule_end_date=now()+interval '1 day'", true],
    ['group_expired', "data_target_source_mode='data_group',schedule_end_date=now()-interval '1 day'", false],
    ['future_schedule', "schedule=now()+interval '1 day'", false],
    ['null_schedule', 'schedule=NULL', false],
    ['past_stop', "daily_stop_time='00:00'", false],
    ['paused', "status='tạm dừng'", false],
    ['deleted', 'is_delete=true', false],
    ['not_provisioned', "provisioning_state='pending'", false]
  ]
  async function clientCases() {
    const results = []
    for (const mode of ['legacy_checked', 'normal_v2', 'random']) {
      for (const [name, updates, expected] of cases) {
        await db.exec('BEGIN;')
        try {
          await db.exec("UPDATE auto_campaigns SET schedule=now()-interval '1 second',schedule_type='daily',continue_next_day=false,data_target_source_mode='direct',schedule_end_date=NULL,daily_stop_time=NULL WHERE id=1")
          if (updates) await db.exec('UPDATE auto_campaigns SET ' + updates + ' WHERE id=1')
          await db.exec('SET LOCAL ROLE anon;')
          const claim = crypto.randomUUID()
          let result, planned
          if (mode === 'random') {
            await rpc('save', { config }); await rpc('toggle', { enabled: true, revision: 1 })
            const plan = await rpc('plan', { revision: 1, choices: [{ ruleIndex: 0, campaignId: 1 }] })
            planned = plan.turns.length
            result = planned ? await rpc('claim', { turnId: plan.turns[0].id, campaignId: 1, claimToken: claim }) : { ok: false, reason: 'not_planned' }
          } else if (mode === 'normal_v2') {
            result = await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_runtime_v2(1,1,1,'desktop',$1::uuid) r", [claim])
          } else {
            result = await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_runtime_checked(1,1,1,'desktop') r")
          }
          assert.equal(result.ok, expected, mode + ':' + name)
          if (expected && mode !== 'legacy_checked') {
            assert.equal(result.runtime_claim_token, claim)
            assert.ok(result.runtime_claim_vietnam_date && result.db_now)
          }
          results.push({ mode, name, planned, ok: result.ok, reason: result.reason, responseKeys: Object.keys(result).sort() })
        } finally { await db.exec('ROLLBACK; RESET ROLE;') }
      }
    }
    return results
  }
  try {
    for (const f of JSON.parse(fs.readFileSync(path.join(dir, 'source.json')))) await db.exec(f.definition)
    const before = await clientCases()
    await db.exec(withoutPreflight)
    assert.deepEqual(await clientCases(), before)
    for (const file of ['migration_v397_campaign_shared_schedule_smoke.sql', 'migration_v396_facebook_random_run_schedule_smoke.sql']) {
      await db.exec(fs.readFileSync(path.join(root, 'migrations/tests', file), 'utf8'))
    }
    // A plan is not execution permission. A later edit is rechecked by the same claim path.
    for (const change of ["schedule=now()+interval '1 day'", "data_target_source_mode='data_group',schedule_end_date=now()-interval '1 second'"]) {
      await db.exec('BEGIN;')
      try {
        await rpc('save', { config }); await rpc('toggle', { enabled: true, revision: 1 })
        const plan = await rpc('plan', { revision: 1, choices: [{ ruleIndex: 0, campaignId: 1 }] })
        assert.equal(plan.turns.length, 1)
        await db.exec('UPDATE auto_campaigns SET ' + change + ' WHERE id=1; SET LOCAL ROLE anon;')
        const result = await rpc('claim', { turnId: plan.turns[0].id, campaignId: 1, claimToken: crypto.randomUUID() })
        assert.equal(result.ok, false)
        assert.equal(await scalar('SELECT runtime_claim_token IS NULL result FROM auto_campaigns WHERE id=1'), true)
      } finally { await db.exec('ROLLBACK; RESET ROLE;') }
    }
    // Both scheduler queues use the shared start/cutoff helper; the existing
    // Data Group hard-end helper remains shared with lifecycle finalization.
    const account = { id: 1, staffId: 1, flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', isActive: true, facebookRandomRunEnabled: false }
    let campaign, executions = 0, planCalls = 0
    const logs = []
    const Scheduler = schedulerClass({}, {
      '../../shared/facebookRandomRun': loadShared('src/shared/facebookRandomRun.ts'),
      '../data/repositories/facebookRandomRunRepository': {
        getRandomSettings: () => rpc('get'),
        planRandomRound: (_id, cfg, choices) => { planCalls++; return rpc('plan', { revision: cfg.revision, choices }) },
        randomRunRpc: (_id, op, input) => rpc(op, input),
        finishRandomTurn: (_id, turn, reason) => rpc('finish', { turnId: turn.id, claimToken: turn.claimToken, reason })
      },
      './accountOperationRegistry': { accountOperationRegistry: { has: () => false } }
    })
    const scheduler = new Scheduler({ getAccount: async () => account, getCampaign: async () => campaign,
      getPendingCampaigns: async () => executions ? [] : [campaign], getCampaignAction: async () => ({ isActive: true, isDelete: false }),
      listCampaignInputData: async () => [{ id: 1, status: 'chờ xử lý', isDelete: false }] }, {}, { webContents: { send() {} } })
    Object.assign(scheduler, { running: true, getReadyRuntimeClock: async () => ({ dbNow: '2026-10-14T10:00:00Z' }),
      resolveCampaignWorkflow: () => ({ workflowId: 1 }), getCampaignPreclaimLimitStatus: async () => null,
      logCampaignProgress: async (_c, message) => logs.push(message), executeCampaign: async () => { executions++ } })
    const base = { id: 1, staffId: 1, accountId: 1, name: 'Shared schedule', actionId: 'facebook_group_post', status: 'chờ xử lý',
      dataTargetSourceMode: 'direct', schedule: '2026-10-14T09:00:00Z', scheduleEndDate: '2026-10-12T16:59:59Z', isDelete: false }
    for (const [patch, expected] of [[{}, true], [{ schedule: '2026-10-15T09:00:00Z' }, false], [{ schedule: null }, false],
      [{ dailyStopTime: '16:00' }, false], [{ dailyStopTime: '17:00' }, false], [{ dailyStopTime: '17:01' }, true]]) {
      campaign = { ...base, ...patch }; executions = 0
      await scheduler.runAccountCampaignQueue(account, [campaign])
      assert.equal(executions > 0, expected)
      assert.equal((await scheduler.randomCampaignBlockedReason(account, campaign)) === null, expected)
    }
    // Cross-layer fixed-time parity, including exact cutoff and hard end.
    let parity = 0
    for (const now of ['2026-10-14T10:00:00Z', '2026-10-14T16:59:00Z', '2026-10-14T17:00:00Z']) {
      for (const mode of ['direct', 'data_group']) for (const stop of [null, '17:00', '23:59:59']) {
        campaign = { ...base, dataTargetSourceMode: mode, dailyStopTime: stop }
        const sql = await scalar('SELECT private.campaign_dispatch_schedule_allowed($1::timestamptz,$2,$3::timestamptz,$4::time,$5::timestamptz,false) result', [campaign.schedule, mode, campaign.scheduleEndDate, stop, now])
        const js = scheduler.isWithinCampaignDispatchSchedule(campaign, new Date(now)) && !scheduler.isDataGroupCampaignHardEnded(campaign, new Date(now))
        assert.equal(js, sql); parity++
      }
    }
    // Actual queue -> planner -> claim -> unit -> settle -> finish, with a fake executor only.
    await db.exec("UPDATE auto_campaigns SET schedule_end_date=now()-interval '2 days' WHERE id=1")
    const row = await scalar('SELECT to_jsonb(c) result FROM auto_campaigns c WHERE id=1')
    campaign = { ...base, schedule: row.schedule, scheduleEndDate: row.schedule_end_date }
    executions = 0
    await rpc('save', { config }); await rpc('toggle', { enabled: true, revision: 1 })
    scheduler.getReadyRuntimeClock = async () => ({ dbNow: await scalar('SELECT now()::text result') })
    scheduler.executeCampaign = async () => {
      const turn = scheduler.facebookRandomTurns.get(1), claim = crypto.randomUUID(), unit = crypto.randomUUID()
      const claimed = await rpc('claim', { turnId: turn.id, campaignId: 1, claimToken: claim })
      assert.equal(claimed.ok, true); turn.claimToken = claim
      assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r", [claim, claimed.runtime_claim_vietnam_date, unit])).ok, true)
      await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
      assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r", [unit])).ok, true)
      assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime(1,1,1,'desktop',$1::uuid,NULL,ARRAY[]::bigint[],'',false,'chờ xử lý','chờ xử lý') r", [claim])).ok, true)
      executions++
    }
    await scheduler.runFacebookRandomQueue(account)
    assert.equal(executions, 1); assert.equal(planCalls, 2)
    assert.deepEqual(logs, ['✅ Hoàn tất đợt chạy ngẫu nhiên: đã xử lý 1/1 data.'])
    const day = await rpc('day', { date: await scalar("SELECT timezone('Asia/Ho_Chi_Minh',now())::date::text result") })
    assert.equal(day.turns[0].status, 'completed'); assert.equal(day.turns[0].processed, 1)
    const receipt = { at: new Date().toISOString(), migration_sha256: crypto.createHash('sha256').update(migration).digest('hex'),
      before_after_rpc_cases: before.length, policy_cases: 1440, scheduler_queue_cases: 6, ts_sql_parity: parity,
      changed_after_plan: 2, scheduler_to_sql_pass: true, external_facebook_operations: 0 }
    fs.writeFileSync(path.join(dir, 'local-smoke.json'), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify(receipt))
  } finally { await db.close() }
}
main().catch(error => { console.error(error.message, error.where || '', error.stack); process.exitCode = 1 })
