// Actual DAG/scheduler/managed writer with local PostgreSQL WASM; no external operations.
const assert = require('node:assert/strict')
const path = require('node:path')
const { harness, step, result } = require('./action-status-mixed-output-smoke.cjs')
const { WorkflowEngineV2, js, edge } = require('./action-status-origin-tracking-smoke.cjs')
const claim = '11111111-1111-1111-1111-111111111111'
const unit = '22222222-2222-2222-2222-222222222222'
let checks = 0

async function inputScopes(zca) {
  const f = await harness(zca, 'email_send', 'email')
  try {
    for (const ids of [[], [1], [1, 2]]) {
      f.runtime.beginActionResultUnit(1, unit, ids)
      for (const id of [undefined, null, 1, '1', 2, 3, 0, -1, 1.5, NaN, 'bad', true, [1], {}]) {
        const valid = id == null ? ids.length < 2 : [1, '1', 2].includes(id) && ids.includes(Number(id))
        const row = result('email_send', 'campaign_detail_success', { inputDataId: id })
        for (const shape of [row, { actionResult: row }, { actionResults: [row] }]) {
          if (valid) f.runtime.validateActionResultStep(1, shape)
          else assert.throws(() => f.runtime.validateActionResultStep(1, shape), /batch_input_missing/)
          checks++
        }
      }
    }
    // Real one-target DAG: keep a prior valid operation, reject the wrong ID,
    // never start the next operation, and persist only the accepted result.
    f.runtime.beginActionResultUnit(1, unit, [1])
    await f.db.exec('UPDATE auto_campaigns SET runtime_unit_input_data_ids=ARRAY[1] WHERE id=1')
    const abort = new AbortController()
    const boundary = new f.runtime.ActionResultBoundary(1, () => abort.abort())
    let operations = 0
    const nodes = [1, 2, 1].map((id, index) => js(`scope-${index}`,
      `await helpers.perform();return {actionResult:${JSON.stringify(result('email_send', 'campaign_detail_success', { inputDataId: id }))}}`))
    const executed = await new WorkflowEngineV2().run({ id: 8, nodes,
      edges: [edge('scope-0', 'scope-1'), edge('scope-1', 'scope-2')] }, {}, null, {
      persist: false, signal: abort.signal, runtimeHelpers: { perform: async () => operations++ },
      onStepProgress: s => boundary.observe(s)
    })
    assert.match(boundary.error?.message, /batch_input_missing/)
    assert.equal(operations, 2)
    assert(!executed.steps.some(s => s.nodeId === 'scope-2' && s.status === 'success'))
    await f.final(boundary.accepted(executed.steps))
    assert.equal((await f.details()).length, 1)
    assert.equal(await f.quota(), 1)
    checks++
  } finally { await f.close() }
}

async function setup(zca, { initial = 0, threshold = 4, error = 'err_undefined', noCount = false } = {}) {
  const f = await harness(zca, 'facebook_message_uid')
  await f.db.exec(`INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,${initial})`)
  if (noCount) await f.db.exec("UPDATE auto_account_action_status_policies SET bad_target_effect='ignore' WHERE status_id=(SELECT id FROM auto_status WHERE code='campaign_detail_failed')")
  await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'facebook', claimToken: claim }, ['fb_message_stranger', 'fb_add_friend'])
  f.runtime.beginActionResultUnit(1, unit, [1, 2])
  const policy = { errorCode: error, errorName: 'Existing error', countConsecutiveErrors: threshold,
    countsTowardBadTarget: !noCount, countsTowardLimit: true, updateStatusCampaign: 'tạm dừng',
    disableActionCodes: [], notiCampaign: 'Existing policy text' }
  const policies = new Map([[error, policy], ...(error === 'err_undefined' ? [] : [['err_undefined', { ...policy, errorCode: 'err_undefined', countConsecutiveErrors: 4 }]])])
  f.scheduler.supabase.getAccount = async () => f.account
  f.scheduler.supabase.getErrorPolicy = async code => policies.get(code) ?? null
  f.scheduler.getMessageActionCode = () => 'fb_message_stranger'
  f.scheduler.supabase.incrementCampaignBadTargetCount = async (_campaign, id, reason) => ({
    countConsecutiveBadTargets: await f.runtime.settleManagedBadTarget(1, id, reason)
  })
  f.scheduler.supabase.updateCampaignInputData = (id, patch) => f.runtime.settleManagedActionInput(id, patch)
  const apply = (summary, id = 1, options = { targetCounter: {}, campaignDecision: { paused: false } }) =>
    f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, id, summary, options)
  const count = async () => (await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n
  return { ...f, policy, apply, count }
}

async function thresholdCases(zca) {
  for (const initial of [0, 3]) for (const format of ['legacy', 'explicit']) {
    const f = await setup(zca, { initial })
    try {
      const payload = { ok: false, error: 'Existing failure' }
      if (format === 'explicit') payload.actionResult = result('fb_message_stranger', 'campaign_detail_failed', {
        inputDataId: 1, errorCode: 'err_undefined', message: 'Existing failure', data: { error: 'Existing root cause' }
      })
      const s = step(1, 'fb_send_message', payload)
      const summary = await f.final([s])
      assert.equal(f.campaign.status, 'đang chạy', 'writing a result must not apply a threshold policy')
      await f.finish()
      const handled = await f.apply(summary)
      if (!handled.coversBadTarget) await f.scheduler.handleCampaignBadTarget(f.account, f.campaign, 1,
        'err_undefined', 'fb_message_stranger', { message: 'Existing failure' }, { targetCounter: {}, campaignDecision: { paused: false } })
      assert.equal(await f.count(), initial + 1)
      assert.equal(f.campaign.status, initial === 3 ? 'tạm dừng' : 'đang chạy')
      if (format === 'explicit' && initial === 3) assert.match(f.campaign.note, /Existing root cause/)
      if (format === 'explicit') {
        const logs = [...f.logs]
        await f.apply(await f.final([structuredClone(s)]))
        assert.deepEqual(f.logs, logs)
        assert.equal(await f.count(), initial + 1)
      }
      checks++
    } finally { await f.close() }
  }
  // An action-specific cause retains its own threshold and cannot fall back to
  // generic err_undefined. A second result on this target still counts once.
  const f = await setup(zca, { initial: 1, threshold: 2, error: 'fixture_specific' })
  try {
    const failures = ['fb_message_stranger', 'fb_add_friend'].map((action, index) => step(index + 1, 'custom', {
      actionResult: result(action, 'campaign_detail_failed', { inputDataId: 1, errorCode: 'fixture_specific' })
    }))
    const summary = await f.final(failures)
    assert.equal(f.campaign.status, 'đang chạy')
    await f.finish()
    const handled = await f.apply(summary)
    assert.equal(handled.triggered, true)
    assert.equal(handled.coversBadTarget, true)
    assert.equal(await f.count(), 2)
    assert.equal(f.campaign.status, 'tạm dừng')
    assert.match(f.campaign.note, /ngưỡng 2/)
    const logs = [...f.logs]
    await f.apply(await f.final(failures))
    assert.deepEqual(f.logs, logs)
    checks++
  } finally { await f.close() }
  for (const noCount of [false, true]) {
    const f = await setup(zca, { threshold: noCount ? 4 : null, noCount })
    try {
      const s = step(1, 'custom', { actionResult: result('fb_message_stranger', 'campaign_detail_failed', { inputDataId: 1, errorCode: 'err_undefined' }) })
      const summary = await f.final([s])
      assert.equal(f.campaign.status, 'tạm dừng', 'immediate/non-counting explicit side effects retain their timing')
      const logs = [...f.logs]
      await f.finish()
      const handled = await f.apply(summary)
      assert.equal(handled.triggered, true, 'the outer scheduler must stop after an immediate policy')
      assert.equal(await f.count(), noCount ? 0 : 1)
      await f.apply(await f.final([s]))
      assert.deepEqual(f.logs, logs)
      checks++
    } finally { await f.close() }
  }
  for (const scenario of ['unknown-code', 'cause-without-stop']) {
    const f = await setup(zca, { initial: 3 })
    try {
      const getPolicy = f.scheduler.supabase.getErrorPolicy
      f.scheduler.supabase.getErrorPolicy = async code => code === 'fixture_cause' && scenario === 'cause-without-stop'
        ? { ...f.policy, errorCode: code, countConsecutiveErrors: null, updateStatusCampaign: null }
        : getPolicy(code)
      const summary = await f.final([step(1, 'custom', { actionResult: result('fb_message_stranger', 'campaign_detail_failed',
        { inputDataId: 1, errorCode: 'fixture_cause' }) })])
      assert.equal(f.campaign.status, 'đang chạy')
      await f.finish()
      const handled = await f.apply(summary)
      assert.equal(handled.coversBadTarget, scenario === 'unknown-code')
      if (!handled.coversBadTarget) await f.scheduler.handleCampaignBadTarget(f.account, f.campaign, 1,
        'err_undefined', 'fb_message_stranger', {}, { targetCounter: {}, campaignDecision: { paused: false } })
      assert.equal(f.campaign.status, 'tạm dừng')
      assert.equal(await f.count(), 4)
      checks++
    } finally { await f.close() }
  }
}

async function schedulerBatch(zca) {
  for (const outcomes of ['SF', 'FF']) {
    const f = await setup(zca, { initial: 3 })
    try {
      f.campaign.actionId = 'facebook_group_invite'
      const rows = [...outcomes].map((outcome, index) => result('fb_group_invite',
        outcome === 'S' ? 'campaign_detail_success' : 'campaign_detail_failed', {
          inputDataId: index + 1, ...(outcome === 'F' ? { errorCode: 'err_undefined' } : {})
        }))
      const workflow = { id: 8, nodes: [js('batch', `return {actionResults:${JSON.stringify(rows)}}`)], edges: [] }
      Object.assign(f.scheduler, {
        getAutomationPage: async () => ({ page: {}, source: 'foreground' }), beginCampaignRunUnit: async () => true,
        createBlockRuntimeHelpers: () => ({}),
        engineV2: { run: (_id, variables, page, ctx) => new WorkflowEngineV2().run(workflow, variables, page, { ...ctx, persist: false }) },
        settleActiveCampaignRunUnit: async () => { await f.runtime.finishActionResultUnit(1); return true }
      })
      const outcome = await f.scheduler.runFacebookGroupInviteBatch(f.account, f.campaign, 8,
        [{ inputDataId: 1 }, { inputDataId: 2 }], { code: 'fb_group_invite' },
        { groupName: 'Fixture', groupUid: 'fixture', groupUrl: '', quotaCapacity: 2, batchIndex: 0 })
      assert.equal(outcome.stop, outcomes === 'FF')
      assert.equal(await f.count(), outcomes === 'FF' ? 5 : 1)
      assert.equal(f.campaign.status, outcomes === 'FF' ? 'tạm dừng' : 'đang chạy')
      assert.equal((await f.details()).length, 2)
      checks++
    } finally { await f.close() }
  }
}

async function main() {
  const zca = await import(path.resolve(__dirname, '../node_modules/zca-js/dist/index.js'))
  await inputScopes(zca)
  await thresholdCases(zca)
  await schedulerBatch(zca)
  console.log(JSON.stringify({ checks, external_operations: 0 }))
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
