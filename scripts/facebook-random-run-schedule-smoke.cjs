// Actual scheduler -> actual planner/claim/settle SQL; only Facebook execution is fake.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { fixture, root } = require('./facebook-random-run-fixture.cjs')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const { loadShared } = require('./facebook-page-content-rotation-smoke-test.cjs')
const dir = path.join(root, 'migrations/snapshots/facebook-random-run-schedule-v396')
async function main() {
  const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json')))[0]
  const target = JSON.parse(fs.readFileSync(path.join(dir, 'target.json')))[0]
  const migration = fs.readFileSync(path.join(root, 'migrations/migration_v396_facebook_random_run_schedule.sql'), 'utf8')
  const smoke = fs.readFileSync(path.join(root, 'migrations/tests/migration_v396_facebook_random_run_schedule_smoke.sql'), 'utf8')
  const db = await fixture({ boundaries: true })
  try {
    await db.exec(source.definition)
    await assert.rejects(db.exec(smoke), /v395 direct_expired: expected 1 turns/)
    await db.exec('ROLLBACK; RESET ROLE;')
    await db.exec(target.definition)
    await db.exec(smoke)
    // The full V393 guard suite needs additional live catalog tables; the audit
    // command runs it in an isolated rollback transaction on the linked DB.
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result
    const rpc = (op, input = {}) => scalar("SELECT aka_agent_facebook_random_run(1,1,'fixture','fixture',1,$1,$2::jsonb) result", [op, JSON.stringify(input)])
    await db.exec("UPDATE auto_campaigns SET data_target_source_mode='direct',schedule_type='weekly',schedule_end_date=now()-interval '2 days' WHERE id=1")
    const config = { version: 1, revision: 0, rules: [{ campaignActionId: 'facebook_group_post', quantity: 1, unit: 'data' }] }
    await rpc('save', { config }); await rpc('toggle', { enabled: true, revision: 1 })
    const account = { id: 1, staffId: 1, flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', isActive: true }
    const raw = await scalar('SELECT to_jsonb(c) result FROM auto_campaigns c WHERE id=1')
    const campaign = { id: 1, staffId: 1, accountId: 1, name: 'Direct old end', actionId: 'facebook_group_post', status: 'chờ xử lý',
      dataTargetSourceMode: raw.data_target_source_mode, schedule: raw.schedule, scheduleEndDate: raw.schedule_end_date, isDelete: false }
    let executed = 0, logs = [], choices = []
    const Scheduler = schedulerClass({}, {
      '../../shared/facebookRandomRun': loadShared('src/shared/facebookRandomRun.ts'),
      '../data/repositories/facebookRandomRunRepository': {
        getRandomSettings: () => rpc('get'),
        planRandomRound: (_id, cfg, selected) => { choices.push(selected); return rpc('plan', { revision: cfg.revision, choices: selected }) },
        randomRunRpc: (_id, op, input) => rpc(op, input),
        finishRandomTurn: (_id, turn, reason) => rpc('finish', { turnId: turn.id, claimToken: turn.claimToken, reason })
      },
      './accountOperationRegistry': { accountOperationRegistry: { has: () => false } }
    })
    const scheduler = new Scheduler({ getAccount: async () => account, getCampaign: async () => campaign,
      getPendingCampaigns: async () => executed ? [] : [campaign], getCampaignAction: async () => ({ isActive: true, isDelete: false }),
      listCampaignInputData: async () => [{ id: 1, status: 'chờ xử lý', isDelete: false }] }, {}, { webContents: { send() {} } })
    Object.assign(scheduler, { running: true, getReadyRuntimeClock: async () => ({ dbNow: await scalar('SELECT now()::text result') }),
      resolveCampaignWorkflow: () => ({ workflowId: 1 }), getCampaignPreclaimLimitStatus: async () => null,
      logCampaignProgress: async (_c, message) => logs.push(message),
      executeCampaign: async () => {
        const turn = scheduler.facebookRandomTurns.get(1), claim = crypto.randomUUID(), unit = crypto.randomUUID()
        const result = await rpc('claim', { turnId: turn.id, campaignId: 1, claimToken: claim })
        assert.equal(result.ok, true); turn.claimToken = claim
        const claimed = await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r", [claim, result.runtime_claim_vietnam_date, unit])
        assert.equal(claimed.ok, true)
        await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
        assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r", [unit])).ok, true)
        assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime(1,1,1,'desktop',$1::uuid,NULL,ARRAY[]::bigint[],'',false,'chờ xử lý','chờ xử lý') r", [claim])).ok, true)
        executed++
      }
    })
    await scheduler.runFacebookRandomQueue(account)
    assert.equal(executed, 1)
    assert.deepEqual(choices[0], [{ ruleIndex: 0, campaignId: 1 }])
    assert.deepEqual(logs, ['✅ Hoàn tất đợt chạy ngẫu nhiên: đã xử lý 1/1 data.'])
    const day = await rpc('day', { date: await scalar("SELECT timezone('Asia/Ho_Chi_Minh',now())::date::text result") })
    assert.equal(day.turns[0].status, 'completed'); assert.equal(day.turns[0].processed, 1)
    const receipt = { at: new Date().toISOString(), migration_sha256: crypto.createHash('sha256').update(migration).digest('hex'),
      old_body_reproduces_failure: true, schedule_cases: 10,
      scheduler_to_sql_pass: true, external_facebook_operations: 0 }
    fs.writeFileSync(path.join(dir, 'local-smoke.json'), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify(receipt))
  } finally { await db.close() }
}
main().catch(error => { console.error(error.message, error.where || ''); process.exitCode = 1 })
