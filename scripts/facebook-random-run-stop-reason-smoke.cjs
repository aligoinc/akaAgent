// Real scheduler boundary + existing V393 SQL fixture. No network/Facebook I/O.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { fixture } = require('./facebook-random-run-fixture.cjs')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')

async function main() {
  const db = await fixture({ boundaries: true })
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result
  const rpc = (operation, input = {}) => scalar(
    "SELECT aka_agent_facebook_random_run(1,1,'fixture','fixture',1,$1,$2::jsonb) result",
    [operation, JSON.stringify(input)]
  )
  const Scheduler = schedulerClass({})
  const cases = []
  try {
    for (const scenario of ['stop-mid-turn', 'stop-and-pause', 'budget-complete', 'data-exhausted']) {
      await db.exec('BEGIN')
      try {
        const stopping = scenario.startsWith('stop-')
        const paused = scenario === 'stop-and-pause'
        const inputs = scenario === 'budget-complete' ? [1, 2, 3] : [1]
        await rpc('save', { config: { version: 1, revision: 0, rules: [
          { campaignActionId: 'facebook_group_post', quantity: 3, unit: 'data' }
        ] } })
        await rpc('toggle', { enabled: true, revision: 1 })
        const plan = await rpc('plan', { revision: 1, choices: [{ ruleIndex: 0, campaignId: 1 }] })
        const turn = plan.turns[0], claim = randomUUID(), unit = randomUUID()
        assert((await rpc('claim', { turnId: turn.id, campaignId: 1, claimToken: claim })).ok)
        const claimUnit = (token, ids) => scalar(
          "SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,$4::bigint[]) r",
          [claim, plan.date, token, ids]
        )
        assert((await claimUnit(unit, inputs)).ok)
        // The mode changes while a unit is in flight; let its result settle first.
        if (stopping) await rpc('toggle', { enabled: false, revision: 1 })
        await db.query("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=ANY($1::bigint[])", [inputs])
        assert((await scalar(
          "SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r", [unit]
        )).ok)
        if (scenario === 'data-exhausted') await db.exec('UPDATE auto_campaign_input_data SET is_delete=true WHERE id<>1')
        const account = { id: 1, staffId: 1, flatformType: 'facebook', status: 'đang chạy' }
        const campaign = { id: 1, accountId: 1, staffId: 1, actionId: 'facebook_group_post', name: 'fixture', status: 'đang chạy' }
        let cleanupCount = 0, claimCount = 0
        const scheduler = new Scheduler({
          getCampaign: async () => campaign,
          getCampaignAction: async () => ({ isActive: true, isDelete: false }),
          claimCampaignRunUnitV2: async (_campaign, _account, _target, parent, day, token, ids) => {
            assert.equal(parent, claim); assert.equal(day, plan.date)
            claimCount++
            const result = await claimUnit(token, ids)
            assert.equal(result.reason, stopping ? 'random_mode_changed' : 'random_budget_exhausted')
            return result
          },
          cleanupFailedCampaignRuntime: async payload => {
            cleanupCount++
            assert.equal(payload.runtimeClaimToken, claim)
            return scalar(
              "SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime($1,$2,$3,$4,$5::uuid,$6::uuid,$7::bigint[],$8,$9,$10,$11) r",
              [payload.campaignId, payload.accountId, payload.staffId, payload.runtimeTarget,
                payload.runtimeClaimToken, payload.runtimeUnitToken, payload.unstartedInputDataIds,
                payload.note, payload.pauseUnknownOutcome, payload.campaignStatus, payload.accountStatus]
            )
          }
        }, {}, { webContents: { send() {} } })
        scheduler.running = true
        scheduler.getCampaignPreclaimLimitStatus = async () => null
        scheduler.campaignRunBoundaries.set(1, { runtimeClaimToken: claim, claimedVietnamDateKey: plan.date })
        scheduler.facebookRandomTurns.set(1, await rpc('progress', { turnId: turn.id, claimToken: claim }))
        if (paused) scheduler.pauseRequests.add(1)
        await db.exec('SET LOCAL ROLE anon')
        if (scenario === 'data-exhausted') {
          // A normal partial release must remain completed, not inferred as stopped from 1/3.
          await scheduler.finishRandomBudget(account, campaign)
        } else {
          assert.equal(await scheduler.beginCampaignRunUnit(account, campaign, [4]), false)
        }
        const result = await rpc('progress', { turnId: turn.id, claimToken: claim })
        assert.equal(result.status, stopping ? 'stopped' : 'completed', scenario)
        assert.equal(result.reason, paused ? 'Đang chờ tạm dừng' : stopping ? 'Đã dừng chạy ngẫu nhiên' : null, scenario)
        assert.equal(result.processed, inputs.length)
        assert.equal(result.quantity, 3)
        assert.ok(result.endedAt)
        assert.equal(cleanupCount, 1)
        assert.equal(claimCount, scenario === 'data-exhausted' ? 0 : 1)
        assert.equal(await scalar('SELECT runtime_claim_token IS NULL AND runtime_unit_token IS NULL result FROM auto_campaigns WHERE id=1'), true)
        assert.equal(await scalar('SELECT runtime_operation_claim_token IS NULL result FROM auto_accounts WHERE id=1'), true)
        assert.equal(await scalar('SELECT status result FROM auto_campaigns WHERE id=1'), paused ? 'tạm dừng' : 'chờ xử lý')
        if (stopping) {
          assert.equal(await scalar("SELECT count(*)::int result FROM auto_campaign_input_data WHERE campaign_id=1 AND status='chờ xử lý'"), 3)
        }
        // The final RPC is idempotent; the correct output was already committed at release.
        assert.deepEqual(await rpc('finish', { turnId: turn.id, claimToken: claim, reason: 'late reason' }), result)
        cases.push(scenario)
      } finally {
        await db.exec('ROLLBACK; RESET ROLE;')
      }
    }
    console.log(JSON.stringify({ cases, externalFacebookOperations: 0 }))
  } finally {
    await db.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
