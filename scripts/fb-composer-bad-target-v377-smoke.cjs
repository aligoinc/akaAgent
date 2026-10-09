// Real workflow/writer/settlement and scheduler policy methods; local WASM DB only.
const assert = require('node:assert/strict')
const { harness } = require('./action-status-mixed-output-smoke.cjs')
const { environment } = require('./fb-composer-policy-v375-smoke.cjs')
const v = require('./fb-composer-bad-target-v377.cjs')
const snapshot = v.backup()
const composer = snapshot.rows.find(r => r.row.error_code === v.code).row
const generic = snapshot.rows.find(r => r.row.error_code === 'err_undefined').row
const mapped = row => Object.fromEntries(Object.entries(row).map(([k, val]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), val]))
const claim = '11111111-1111-1111-1111-111111111111', unit = '22222222-2222-2222-2222-222222222222'
async function scenario(zca, { enabled, initial = 0, id = 1 }) {
  const action = id === 1 ? 'fb_post_group' : 'fb_post_my_profile'
  const f = await harness(zca, id === 1 ? 'facebook_group_post' : 'facebook_timeline_post')
  try {
    const row = { ...composer, counts_toward_bad_target: enabled }
    const fields = ['counts_toward_bad_target', 'counts_toward_limit', 'detail_mode', 'update_status_campaign', 'noti_running_process', 'noti_campaign', 'input_effect']
    await f.db.query(`UPDATE auto_error SET ${fields.map((k, i) => k + '=$' + (i + 1)).join(',')} WHERE error_code=$${fields.length + 1}`, [...fields.map(k => row[k]), v.code])
    await f.db.query('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,$1)', [initial])
    const policies = new Map([[v.code, mapped(row)], ['err_undefined', mapped(generic)]])
    const updates = []
    f.scheduler.supabase.getErrorPolicy = async code => { assert(policies.has(code)); return policies.get(code) }
    f.scheduler.supabase.getAccount = async () => f.account
    f.scheduler.updateErrorPolicyAccount = async () => { throw Error('Unexpected account update') }
    f.scheduler.updateErrorPolicyCampaign = async (_, patch) => { updates.push(patch); Object.assign(f.campaign, patch) }
    // The production repository delegates to this managed settlement before legacy increments.
    f.scheduler.supabase.incrementCampaignBadTargetCount = async (campaignId, inputId, reason) => {
      const count = await f.runtime.settleManagedBadTarget(campaignId, inputId, reason)
      assert.notEqual(count, null); return { countConsecutiveBadTargets: count }
    }
    await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'facebook', claimToken: claim }, [action])
    f.runtime.beginActionResultUnit(1, unit, [1, 2])
    const env = environment(id, { stage: 'button' })
    const boundary = new f.runtime.ActionResultBoundary(1, () => env.abort.abort())
    const run = await env.run(boundary); assert.equal(run.status, 'completed'); assert.equal(boundary.error, undefined)
    const summary = await f.final(run.steps); await f.finish()
    const expected = initial + (enabled ? 1 : 0)
    const count = async () => (await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n
    assert.equal(await count(), expected)
    const options = { targetCounter: {}, campaignDecision: { paused: false } }
    const explicit = await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary, options)
    assert.equal(explicit.triggered, false); assert.equal(explicit.coversBadTarget, false)
    assert.equal(updates.length, 0, 'Composer itself never requests an immediate stop')
    const effects = f.runtime.managedTargetEffects(1, 1)
    assert.equal(effects.badTargetEffect, enabled ? 'increment' : 'ignore')
    // Same fallback boundary as the current scheduler: a counting result without
    // its own threshold uses the existing err_undefined consecutive-target policy.
    if (effects.badTargetEffect === 'increment' && !explicit.coversBadTarget) {
      const outcome = await f.scheduler.handleCampaignBadTarget(f.account, f.campaign, 1, 'err_undefined', action,
        { message: composer.noti_campaign, thresholdReason: composer.noti_campaign }, options)
      assert.equal(outcome.count, expected)
      assert.equal(outcome.triggered, expected >= generic.count_consecutive_errors)
    }
    assert.equal(updates.length, enabled && expected >= generic.count_consecutive_errors ? 1 : 0)
    assert.equal(f.campaign.status, updates.length ? generic.update_status_campaign : 'đang chạy')
    await f.final(structuredClone(run.steps)); await f.finish()
    await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary, options)
    const details = await f.details(); assert.equal(details.length, 1)
    assert.equal(details[0].status, 'lỗi'); assert.equal(details[0].error_code, v.code)
    assert.equal(details[0].log, composer.noti_campaign)
    assert.equal(details[0].policy_snapshot.badTargetEffect, enabled ? 'increment' : 'ignore')
    assert.equal(details[0].counts_toward_limit, false); assert.equal(await f.quota(), 0)
    assert.equal(await count(), expected, 'Replayed results must not double-count')
    const inputs = (await f.db.query('SELECT id,status FROM auto_campaign_input_data ORDER BY id')).rows
    assert.equal(inputs[0].status, 'hoàn thành'); assert.equal(inputs[1].status, 'đang chạy')
  } finally { await f.close() }
}
async function main() {
  assert.equal(generic.count_consecutive_errors, 4)
  const zca = await import('zca-js')
  await scenario(zca, { enabled: false })
  await scenario(zca, { enabled: true })
  await scenario(zca, { enabled: true, initial: 3 })
  await scenario(zca, { enabled: true, id: 2 })
  const receipt = { at: new Date().toISOString(), passed: true, scenarios: 4, increments_once_per_target: true,
    no_action_quota: true, no_immediate_composer_stop: true, existing_generic_threshold: 4, external_operations: 0 }
  if (process.argv.includes('--receipt')) v.save('runtime-smoke.json', receipt)
  console.log(JSON.stringify(receipt))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
