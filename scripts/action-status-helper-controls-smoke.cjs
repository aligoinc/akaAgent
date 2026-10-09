// Real Zalo helpers, scheduler and managed SQL writer; mock transport only.
const assert = require('node:assert/strict')
const path = require('node:path')
const { harness, step, result } = require('./action-status-mixed-output-smoke.cjs')
const root = path.resolve(__dirname, '..')
const claim = '11111111-1111-1111-1111-111111111111'
const unit = '22222222-2222-2222-2222-222222222222'
let checks = 0

async function setup(zca, suppress = false) {
  const f = await harness(zca, 'zalo_message_friend', 'zalo')
  await f.db.query(`UPDATE auto_error SET is_active=true,is_delete=false,detail_mode=$1,
    input_effect='requeue',counts_toward_limit=false,counts_toward_bad_target=false WHERE error_code='err_undefined'`,
  [suppress ? 'suppress' : null])
  await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'zalo', claimToken: claim }, ['zalo_message_friend'])
  f.runtime.beginActionResultUnit(1, unit, [1, 2])
  const policy = { errorCode: 'err_undefined', errorName: 'Fixture', detailStatus: suppress ? null : 'lỗi',
    countsTowardLimit: false, countsTowardBadTarget: false, disableActionCodes: [],
    timeDisableActions: 60, notiCampaign: 'Existing policy text' }
  const counts = { sends: 0, disables: 0, generic: 0, campaignUpdates: 0 }
  f.scheduler.supabase.getZaloErrorPolicyByCode = async () => policy
  f.scheduler.supabase.getErrorPolicy = async () => policy
  f.scheduler.supabase.getAccount = async () => f.account
  f.scheduler.supabase.disableAccountActions = async () => { counts.disables++ }
  const apply = f.scheduler.applyRuntimeErrorPolicy.bind(f.scheduler)
  f.scheduler.applyRuntimeErrorPolicy = async (...args) => { counts.generic++; return apply(...args) }
  const update = f.scheduler.updateErrorPolicyCampaign.bind(f.scheduler)
  f.scheduler.updateErrorPolicyCampaign = async (...args) => { counts.campaignUpdates++; return update(...args) }
  const recipient = { uid: 'recipient', displayName: 'Fixture' }
  Object.assign(f.scheduler, { isZaloBrowserlessCampaign: () => true,
    prepareZaloOutgoingContent: async () => ({ content: 'Content', media: [] }),
    getCachedZaloMessageOptOutTarget: () => recipient, normalizeZaloTargetFromInputData: () => recipient,
    upsertZaloResolvedProfileTarget: async () => {}, applyAkaBizTagsToZaloTarget: async () => {},
    pushZaloDetailToExternalSmsIfNeeded: async () => {} })
  const send = async code => {
    f.scheduler.zaloRuntime.sendMessageToUser = async () => { counts.sends++; throw { code, message: 'existing failure' } }
    return f.scheduler.zaloSendFriendMessage(f.account, f.campaign,
      { enabled: true, target: recipient, targetUid: recipient.uid, inputData: { id: 1 } })
  }
  return { ...f, policy, counts, send }
}

const dual = (sent, operationState = 'not_committed') => ({ ...sent, actionResult: result('zalo_message_friend',
  'campaign_detail_error', { inputDataId: 1, errorCode: sent.detail.errorCode, operationState }) })
const controls = summary => Object.fromEntries(['stopAfterTarget', 'preventInputRetry', 'resetInputToPending',
  'deliveryCommitted', 'optOutBlocked', 'pendingNote', 'inputCompletionNote'].map(key => [key, summary[key] ?? null]))

async function helperResults(zca) {
  for (const suppress of [false, true]) for (const scenario of ['unknown', 'conflicting-state', 'side-effects']) {
    let legacy
    for (const format of ['legacy', 'dual']) {
      const f = await setup(zca, suppress)
      try {
        const unknown = scenario !== 'side-effects'
        if (!unknown) {
          f.policy.disableActionCodes = ['zalo_message_friend']
          f.policy.updateStatusCampaign = 'tạm dừng'
        }
        const sent = await f.send(unknown ? 'command_result_unknown' : '500')
        assert.equal(sent.detail.handledErrorCode, 'err_undefined')
        const s = step(1, 'zalo_send_message', format === 'legacy' ? sent : dual(sent, scenario === 'unknown' ? 'unknown' : 'not_committed'))
        const summary = await f.final([s])
        assert.equal(summary.stopAfterTarget, true)
        assert.equal(summary.preventInputRetry === true, unknown)
        assert.equal(summary.pendingNote, sent.detail.pendingNote)
        assert.equal(f.counts.sends, 1)
        assert.equal(f.counts.disables, unknown ? 0 : 1)
        assert.equal(f.counts.campaignUpdates, unknown ? 0 : 1)
        if (!unknown) assert.equal(f.campaign.note, sent.detail.pendingNote)
        assert.equal(f.counts.generic, 0, 'helper policy ownership survives explicit output')
        if (format === 'legacy') legacy = controls(summary)
        else assert.deepEqual(controls(summary), legacy, 'dual output preserves all legacy lifecycle decisions/text')
        await f.finish()
        const rows = await f.details()
        assert.equal(rows.length, suppress ? 0 : 1)
        if (!suppress) {
          assert.equal(rows[0].policy_snapshot.operationState, unknown ? 'unknown' : 'not_committed')
          assert.equal(rows[0].policy_snapshot.inputEffect, unknown ? 'pause' : 'requeue')
          assert.equal(rows[0].log, sent.detail.log)
        }
        assert.equal((await f.db.query('SELECT status FROM auto_campaign_input_data WHERE id=1')).rows[0].status,
          unknown ? 'tạm dừng' : 'chờ xử lý')
        if (format === 'dual') {
          const before = { ...f.counts }, logs = [...f.logs], writes = f.writes.length
          // A relay may retain only the explicit result; the origin receipt owns helper controls.
          const relay = structuredClone(s)
          delete relay.output.detail
          assert.deepEqual(controls(await f.final([relay])), controls(summary))
          assert.equal(f.writes.length, writes)
          assert.deepEqual(f.logs, logs)
          assert.deepEqual(f.counts, before)
        }
        checks++
      } finally { await f.close() }
    }
  }
}

async function policyOwnership(zca) {
  for (const constructor of ['error', 'code']) for (const handling of ['full', 'target-only', 'batch-followup']) {
    const f = await setup(zca)
    try {
      f.policy.disableActionCodes = ['zalo_message_friend']
      const detail = constructor === 'error'
        ? await f.scheduler.createZaloErrorDetail(f.account, f.campaign, { code: '500', message: 'existing failure' },
          'zalo_message_friend', 'Existing action', {}, { policyHandling: handling })
        : await f.scheduler.createZaloPolicyDetailFromCode(f.account, f.campaign, f.policy, 'existing failure',
          'zalo_message_friend', 'Existing action', '500', {}, { policyHandling: handling })
      await f.final([step(1, 'zalo_send_message', dual({ detail }))])
      assert.equal(f.counts.disables, handling === 'full' ? 1 : 0)
      assert.equal(f.counts.generic, 0, 'target/batch-only helper decisions must not replay full policy')
      checks++
    } finally { await f.close() }
  }
  for (const shape of ['pure', 'different-action', 'different-input', 'different-error']) {
    const f = await setup(zca)
    try {
      f.policy.disableActionCodes = ['zalo_message_friend']
      const detail = { actionCode: shape === 'different-action' ? 'zalo_message_group' : 'zalo_message_friend',
        handledErrorCode: shape === 'different-error' ? 'other_error' : 'err_undefined', status: 'lỗi' }
      const s = step(1, 'zalo_send_message', { ...(shape === 'pure' ? {} : { detail }),
        actionResult: result('zalo_message_friend', 'campaign_detail_error',
          { inputDataId: shape === 'different-input' ? 2 : 1, errorCode: 'err_undefined' }) })
      await f.final([s]); await f.final([structuredClone(s)])
      assert.equal(f.counts.generic, 1, 'only a matching helper owns this error')
      assert.equal(f.counts.disables, 1)
      checks++
    } finally { await f.close() }
  }
}

async function orderedControls(zca) {
  const f = await setup(zca)
  try {
    const a = step(1, 'zalo_send_message', dual(await f.send('command_result_unknown')))
    a.actionResultSourceKeys = ['original']
    const b = step(2, 'zalo_send_message', dual(await f.send('command_result_unknown')))
    b.output.detail.pendingNote = 'Later existing policy text'
    b.output.detail.log = 'Later existing diagnostic'
    b.actionResultSourceKeys = ['later']
    const relay = step(3, 'relay', { actionResult: structuredClone(a.output.actionResult) })
    relay.actionResultSourceKeys = ['original']
    const summary = await f.final([a, b, relay])
    assert.equal(summary.pendingNote, b.output.detail.pendingNote)
    assert.equal(summary.inputCompletionNote, b.output.detail.log)
    assert.equal((await f.details()).length, 2)
    assert.equal(f.counts.generic, 0)
    checks++
  } finally { await f.close() }
}

async function main() {
  const zca = await import(path.join(root, 'node_modules/zca-js/dist/index.js'))
  await helperResults(zca); await policyOwnership(zca); await orderedControls(zca)
  console.log(JSON.stringify({ checks, external_operations: 0 }))
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
