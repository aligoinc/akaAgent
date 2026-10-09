// Actual workflow, scheduler and managed writer against offline PostgreSQL WASM.
const assert = require('node:assert/strict')
const { harness } = require('./action-status-mixed-output-smoke.cjs')
const { environment } = require('./fb-composer-policy-v375-smoke.cjs')
const v = require('./fb-composer-target-error-v376.cjs')
const before = v.backup().rows.find(r => r.row.error_code === v.code).row
const claim = '11111111-1111-1111-1111-111111111111', unit = '22222222-2222-2222-2222-222222222222'
async function scenario(zca, { id = 1, stage = 'button', baseline = false, asPage = false }) {
  const group = [1, 252].includes(id), action = group ? 'fb_post_group' : 'fb_post_my_profile'
  const f = await harness(zca, group ? 'facebook_group_post' : 'facebook_timeline_post')
  try {
    const row = { ...before, update_status_campaign: baseline ? before.update_status_campaign : null }
    const fields = ['update_status_campaign', 'detail_mode', 'noti_running_process', 'noti_campaign', 'input_effect', 'counts_toward_limit', 'counts_toward_bad_target']
    await f.db.query(`UPDATE auto_error SET ${fields.map((k, i) => k + '=$' + (i + 1)).join(',')} WHERE error_code=$${fields.length + 1}`, [...fields.map(k => row[k]), v.code])
    const policy = Object.fromEntries(Object.entries(row).map(([k, value]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]))
    const updates = []
    f.scheduler.supabase.getErrorPolicy = async code => { assert.equal(code, v.code); return policy }
    f.scheduler.supabase.getAccount = async () => f.account
    f.scheduler.updateErrorPolicyAccount = async () => { throw Error('Unexpected account mutation') }
    f.scheduler.updateErrorPolicyCampaign = async (_, patch) => { updates.push(patch); Object.assign(f.campaign, patch) }
    await f.db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,3)')
    await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'facebook', claimToken: claim }, [action])
    f.runtime.beginActionResultUnit(1, unit, [1, 2])
    const env = environment(id, { stage, asPage })
    const boundary = new f.runtime.ActionResultBoundary(1, () => env.abort.abort())
    const run = await env.run(boundary)
    assert.equal(run.status, 'completed'); assert.equal(boundary.error, undefined)
    const summary = await f.final(run.steps); await f.finish(); await env.restore()
    const handled = await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary, { targetCounter: {} })
    assert.equal(handled.triggered, baseline)
    assert.equal(f.campaign.status, baseline ? 'chờ xử lý' : 'đang chạy')
    assert.equal(updates.length, baseline ? 1 : 0)
    assert.equal(f.logs.some(s => s.includes('Dừng chiến dịch')), baseline)
    await f.final(structuredClone(run.steps))
    await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary, { targetCounter: {} })
    let details = await f.details(); assert.equal(details.length, 1)
    assert.equal(details[0].status, 'lỗi'); assert.equal(details[0].error_code, v.code)
    assert.equal(details[0].log, before.noti_running_process)
    assert.equal(details[0].counts_toward_limit, false); assert.equal(await f.quota(), 0)
    assert.equal(details[0].policy_snapshot.badTargetEffect, 'ignore')
    assert.equal((await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n, 3)
    const inputs = (await f.db.query('SELECT id,status FROM auto_campaign_input_data ORDER BY id')).rows
    assert.equal(inputs[0].status, 'hoàn thành'); assert.equal(inputs[1].status, 'đang chạy')
    assert(!f.logs.some(s => s.includes('waitForSelector timeout:')))
    if (asPage) assert.equal(env.stats.activeIdentity, 'Profile')
    if (!baseline) {
      const next = { id: 999, runId: 7, nodeId: 'next_target', blockName: 'next_target', status: 'success',
        startedAt: '2026-10-10T00:00:01Z', output: { actionResult: { actionCode: action,
          statusCode: 'campaign_detail_success', inputDataId: 2, operationState: 'committed' } } }
      const nextSummary = await f.scheduler.logMilestonesV2(f.campaign, { ...f.input, id: 2 }, 1, [next], true)
      await f.runtime.settleManagedActionInput(2, { status: 'hoàn thành' })
      assert.equal((await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 2, nextSummary, { targetCounter: {} })).triggered, false)
      details = await f.details(); assert.equal(details.length, 2)
      assert.equal(details[1].input_data_id, 2); assert.equal(details[1].status, 'thành công')
      assert.equal(await f.quota(), 1); assert.equal(updates.length, 0)
    }
  } finally { await f.close() }
}
async function main() {
  const zca = await import('zca-js')
  await scenario(zca, { baseline: true })
  for (const id of [1, 2, 251, 252]) await scenario(zca, { id, asPage: id === 252 })
  await scenario(zca, { id: 1, stage: 'dialog', asPage: true })
  const receipt = { at: new Date().toISOString(), passed: true, scenarios: 6,
    reproduces_old_stop: true, next_target_succeeds: true, no_quota_or_bad_target_increment_for_error: true,
    external_operations: 0, runtime_changes: 0 }
  if (process.argv.includes('--receipt')) v.save('runtime-smoke.json', receipt)
  console.log(JSON.stringify(receipt))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
