// Ordinary Facebook admission must not acquire an AI history row lock.
// Exact captured helper, real local claim/unit/settle/release; no external I/O.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { createFixture } = require('./facebook-random-ai-sql-smoke.cjs')
const root = path.resolve(__dirname, '..')

async function main() {
  const db = await createFixture()
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result
  try {
    const date = await scalar("SELECT timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date::text result")
    const configs = [null,
      { version: 1, revision: 1, rules: [{ campaignActionId: 'facebook_group_post', quantity: 1, unit: 'data' }] },
      { version: 2, mode: 'ai', revision: 1, rules: [] }]
    async function ordinary(config, history) {
      await db.exec('BEGIN')
      try {
        await db.query('UPDATE auto_accounts SET facebook_random_run_enabled=false,facebook_random_run_config=$1::jsonb WHERE id=1',
          [config == null ? null : JSON.stringify(config)])
        if (history) await db.query(`INSERT INTO auto_account_random_run_days(account_id,staff_id,organization_id,run_date,state)
          VALUES(1,1,1,$1,$2::jsonb)`, [date, JSON.stringify({ turns: [{ id: 'old-turn', order: 1,
          status: 'completed', campaignId: 1, claimToken: '11111111-1111-4111-8111-111111111111', processed: 2 }], round: 1 })])
        const claim = crypto.randomUUID(), unit = crypto.randomUUID()
        const parent = await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_runtime_v2(1,1,1,'desktop',$1::uuid) r", [claim])
        assert.equal(parent.ok, true)
        const before = (await db.query('SELECT state,updated_at,xmin::text,xmax::text FROM auto_account_random_run_days WHERE account_id=1')).rows
        const admit = () => scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r", [claim, date, unit])
        const admitted = await admit()
        assert.equal(admitted.ok, true)
        assert.equal((await admit()).ok, true)
        const after = (await db.query('SELECT state,updated_at,xmin::text,xmax::text FROM auto_account_random_run_days WHERE account_id=1')).rows
        // FOR UPDATE changes xmax even without changing state: asserting only
        // JSON history would miss the additional row lock from the regression.
        assert.deepEqual(after, before, 'ordinary admission must not update or lock unrelated random history')
        await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
        const settled = await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r", [unit])
        assert.equal(settled.ok, true)
        const released = await scalar("SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime(1,1,1,'desktop',$1::uuid,NULL,ARRAY[]::bigint[],'',false,'chờ xử lý','chờ xử lý') r", [claim])
        assert.equal(released.ok, true)
        const campaign = (await db.query('SELECT status,runtime_claim_token,runtime_unit_token FROM auto_campaigns WHERE id=1')).rows[0]
        assert.deepEqual(campaign, { status: 'chờ xử lý', runtime_claim_token: null, runtime_unit_token: null })
        return { parent: parent.reason, admitted: admitted.reason, count: admitted.claimed_count,
          settled: settled.reason, released: released.reason, campaign,
          history: (await db.query('SELECT state FROM auto_account_random_run_days WHERE account_id=1')).rows,
          inputs: (await db.query('SELECT id,status FROM auto_campaign_input_data ORDER BY id')).rows }
      } finally { await db.exec('ROLLBACK') }
    }
    const before = []
    for (const config of configs) for (const history of [false, true]) before.push(await ordinary(config, history))
    await db.exec(fs.readFileSync(path.join(root, 'migrations/migration_v444_facebook_random_ai.sql'), 'utf8'))
    const after = []
    for (const config of configs) for (const history of [false, true]) after.push(await ordinary(config, history))
    assert.deepEqual(after, before)

    // Gate on the matching admitted turn, not the current settings checkbox:
    // a mode change must not discard an already accepted unit's bookkeeping.
    let matchingTurns = 0
    for (const ai of [false, true]) {
      await db.exec('BEGIN')
      try {
        const claim = crypto.randomUUID(), unit = crypto.randomUUID(), plan = crypto.randomUUID()
        const turn = { id: 'matching-turn', order: 1, status: 'running', campaignId: 1, claimToken: claim,
          ...(ai ? { aiPlanId: plan, coverageRound: 1 } : {}) }
        const state = { turns: [turn], ...(ai ? { ai: { requestId: plan }, allocation: { coverageRound: 1, served: [] } } : {}) }
        await db.query('INSERT INTO auto_account_random_run_days(account_id,staff_id,organization_id,run_date,state) VALUES(1,1,1,$1,$2::jsonb)', [date, JSON.stringify(state)])
        await db.exec('UPDATE auto_accounts SET facebook_random_run_enabled=false WHERE id=1')
        await db.query('UPDATE auto_campaigns SET runtime_claim_token=$1,runtime_unit_token=$2,runtime_unit_claimed_at=now(),runtime_unit_vietnam_date=$3 WHERE id=1', [claim, unit, date])
        for (let retry = 0; retry < 2; retry++) await db.query('SELECT private.facebook_random_unit_started(1,1,$1)', [unit])
        const saved = await scalar('SELECT state result FROM auto_account_random_run_days WHERE account_id=1')
        assert.equal(saved.turns[0].unitToken, unit)
        assert.ok(saved.turns[0].unitStartedAt)
        assert.deepEqual(saved.allocation?.served, ai ? [1] : undefined)
        matchingTurns++
      } finally { await db.exec('ROLLBACK') }
    }
    console.log(JSON.stringify({ ordinaryLifecycleParityCases: after.length, historyRowLockRegression: 'pass',
      matchingManualAndAiTurns: matchingTurns, idempotence: true, transactionsRolledBack: true, productionWrites: 0 }))
  } finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
