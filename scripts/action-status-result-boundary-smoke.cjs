// Real helpers/DAG/scheduler/SQL writer with local mocks. Never sends externally.
const assert = require('node:assert/strict')
const { harness, step, result } = require('./action-status-mixed-output-smoke.cjs')
const { WorkflowEngineV2, js, edge, output } = require('./action-status-origin-tracking-smoke.cjs')
const claim = '11111111-1111-1111-1111-111111111111'
const unit = '22222222-2222-2222-2222-222222222222'
let scenarios = 0

async function partialSends(zca) {
  for (const detailMode of [null, 'suppress']) for (const format of ['legacy', 'dual']) {
    const f = await harness(zca, 'zalo_message_friend', 'zalo')
    try {
      await f.db.query("UPDATE auto_error SET is_active=true,is_delete=false,counts_toward_limit=false,counts_toward_bad_target=false,detail_mode=$1 WHERE error_code='err_undefined'", [detailMode])
      await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'zalo', claimToken: claim }, ['zalo_message_friend'])
      f.runtime.beginActionResultUnit(1, unit, [1, 2])
      const recipient = { uid: 'recipient', displayName: 'Fixture' }
      Object.assign(f.scheduler, {
        isZaloBrowserlessCampaign: () => true,
        prepareZaloOutgoingContent: async () => ({ content: { msg: 'Content', styles: [] }, media: ['one.jpg'] }),
        getCachedZaloMessageOptOutTarget: () => recipient, normalizeZaloTargetFromInputData: () => recipient,
        upsertZaloResolvedProfileTarget: async () => {}, applyAkaBizTagsToZaloTarget: async () => {},
        pushZaloDetailToExternalSmsIfNeeded: async () => {}, applyRuntimeErrorPolicy: async () => {}
      })
      f.scheduler.supabase.getAccount = async () => f.account
      f.scheduler.supabase.getZaloErrorPolicyByCode = async () => ({ errorCode: 'err_undefined', detailStatus: 'lỗi',
        countsTowardLimit: false, countsTowardBadTarget: false, disableActionCodes: [] })
      let attempts = 0
      f.scheduler.zaloRuntime.sendMessageToUser = async () => {
        if (++attempts === 2) throw { code: 500, message: 'fixture attachment failure' }
        return { message: { msgId: 'committed-text' } }
      }
      const sent = await f.scheduler.zaloSendFriendMessage(f.account, f.campaign, {
        enabled: true, target: recipient, targetUid: recipient.uid, inputData: { id: 1 }
      })
      assert.equal(attempts, 2)
      assert.equal(sent.detail.deliveryCommitted, true)
      assert.equal(sent.detail.preventInputRetry, true)
      assert.ok(sent.detail.data.partialSend.contentResponse)
      const envelope = format === 'legacy' ? sent : { ...sent, actionResult: result('zalo_message_friend', 'campaign_detail_failed', {
        operationState: 'unknown', errorCode: 'err_undefined', inputDataId: 1
      }) }
      await f.final([step(1, 'zalo_send_message', envelope)])
      await f.finish()
      const rows = await f.details()
      assert.equal(rows.length, 1, `${format}/${detailMode}: partial delivery cannot be suppressed`)
      assert.equal(await f.quota(), 1)
      assert.equal(rows[0].policy_snapshot.partialDelivery, true)
      assert.equal(rows[0].policy_snapshot.operationState, 'committed')
      assert.equal(rows[0].log, sent.detail.log)
      scenarios++
    } finally { await f.close() }
  }
}

async function boundaryStops(zca) {
  for (const mutation of ['status', 'data', 'duplicate-in-batch']) for (const sibling of [false, true]) {
    const f = await harness(zca, 'email_send', 'email')
    try {
      let sends = 0, releaseSibling
      const siblingWait = new Promise(resolve => { releaseSibling = resolve })
      const abort = new AbortController()
      const boundary = new f.runtime.ActionResultBoundary(1, () => { abort.abort(); releaseSibling() })
      const code = `await helpers.send(); return {actionResult:${JSON.stringify(output('email_send'))}}`
      const mutate = mutation === 'status' ? 'return {actionResult:{...input.actionResult,statusCode:"campaign_detail_failed"}}'
        : mutation === 'data' ? 'input.actionResult.data={changed:true};return input'
        : 'return {actionResults:[input.actionResult,{...input.actionResult,statusCode:"campaign_detail_failed"}]}'
      const nodes = [js('send-one', code), js('mutate', mutate), js('send-two', code)]
      if (sibling) nodes.push(js('sibling', `await helpers.drain(); ${code}`))
      const executed = await new WorkflowEngineV2().run({ id: 8, nodes,
        edges: [edge('send-one', 'mutate'), edge('mutate', 'send-two'),
          ...(sibling ? [edge('send-one', 'sibling')] : [])] }, {}, null, {
        persist: false, signal: abort.signal,
        runtimeHelpers: { send: async () => { sends++ }, drain: () => siblingWait },
        onStepProgress: s => boundary.observe(s)
      })
      assert.match(boundary.error?.message, /result_key_conflict/)
      assert.notEqual(executed.status, 'completed')
      assert.equal(sends, sibling ? 2 : 1, 'the next send must not start; an in-flight sibling may complete')
      assert(!executed.steps.some(s => s.nodeId === 'send-two' && s.status === 'success'))
      // Same failure branch as scheduler: preserve accepted operations, then
      // throw into existing cleanup instead of completing the input normally.
      const completed = boundary.accepted(JSON.parse(JSON.stringify(executed.steps)))
      await f.final(completed)
      await assert.rejects(async () => { throw boundary.error }, /result_key_conflict/)
      assert.equal((await f.details()).length, sends)
      assert.equal(await f.quota(), sends)
      assert.equal(f.runtime.managedTargetEffects(1, 1).results.length, sends)
      await f.final(completed)
      assert.equal(await f.quota(), sends, 'failure cleanup replay does not count twice')
      scenarios++
    } finally { await f.close() }
  }
}

async function boundarySnapshots(zca) {
  const f = await harness(zca, 'email_send', 'email')
  try {
    const first = step(1, 'loop-send', { actionResult: { ...output('email_send'), __akaActionResultSource: 'fixture:1' } })
    const changed = structuredClone(first)
    changed.output.actionResult.statusCode = 'campaign_detail_failed'
    const boundary = new f.runtime.ActionResultBoundary(1, () => {})
    assert.equal(boundary.observe(first), true)
    assert.equal(boundary.observe(changed), false)
    const accepted = boundary.accepted(structuredClone([first, changed]))
    assert.equal(accepted.length, 1, 'identical timestamps cannot remove a previous valid loop output')
    assert.equal(accepted[0].output.actionResult.statusCode, 'campaign_detail_success')
    scenarios++
  } finally { await f.close() }
}

async function schedulerFailureBoundary(zca) {
  const f = await harness(zca, 'facebook_group_invite')
  try {
    await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'facebook', claimToken: claim }, ['fb_group_invite'])
    f.runtime.beginActionResultUnit(1, unit, [1, 2])
    let sends = 0, cleanupError, normalSettlement = 0
    const code = `await helpers.send(); return {actionResult:${JSON.stringify(output('fb_group_invite'))}}`
    const workflow = { id: 8,
      nodes: [js('invite-one', code), js('mutate', 'return {actionResult:{...input.actionResult,statusCode:"campaign_detail_failed"}}'), js('invite-two', code)],
      edges: [edge('invite-one', 'mutate'), edge('mutate', 'invite-two')] }
    Object.assign(f.scheduler, {
      getAutomationPage: async () => ({ page: {}, source: 'foreground' }), beginCampaignRunUnit: async () => true,
      createBlockRuntimeHelpers: () => ({ send: async () => { sends++ } }),
      engineV2: { run: (_id, variables, page, ctx) => new WorkflowEngineV2().run(workflow, variables, page, { ...ctx, persist: false }) },
      rememberFailedCampaignRun: (_a, campaign, error) => { cleanupError = error; f.scheduler.failedCampaignRuns.set(campaign.id, {}) },
      settleActiveCampaignRunUnit: async () => { normalSettlement++; return true }
    })
    await assert.rejects(f.scheduler.runFacebookGroupInviteBatch(f.account, f.campaign, 8,
      [{ inputDataId: 1 }, { inputDataId: 2 }], { code: 'fb_group_invite' },
      { groupName: 'Fixture', groupUid: 'fixture', groupUrl: '', quotaCapacity: 2, batchIndex: 0 }), /result_key_conflict/)
    assert.equal(sends, 1)
    assert.match(cleanupError?.message, /result_key_conflict/)
    assert.equal(normalSettlement, 0, 'failure ownership must stay with cleanup')
    assert.equal((await f.details()).length, 1, 'the actual scheduler preserves the accepted result before throwing')
    assert.equal(await f.quota(), 1)
    assert.equal(f.scheduler.activeV2Aborts.has(1), false)
    scenarios++
  } finally { await f.close() }
}

async function groups(zca) {
  for (const format of ['legacy', 'dual', 'new-only', 'batch']) for (const pending of [true, false, null]) {
    const f = await harness(zca, 'facebook_group_post')
    try {
      const approvals = [], bumps = [], consumed = new Set(), updates = []
      Object.assign(f.scheduler, {
        syncGroupPostContactStatus: async (_a, _i, value) => approvals.push(value),
        enqueuePostBumpAfterGroupPost: async (_c, url, value) => bumps.push({ url, pending: value }),
        cleanPostLinkForStorage: x => x
      })
      f.scheduler.supabase.updateCampaignInputData = async (id, patch) => {
        updates.push({ id, patch: JSON.parse(JSON.stringify(patch)) }); return f.runtime.settleManagedActionInput(id, patch)
      }
      const primary = output('fb_post_group')
      const verify = format === 'legacy' ? { posted: true } : format === 'dual' ? { posted: true, actionResult: primary }
        : format === 'batch' ? { actionResults: [primary, { ...primary, inputDataId: 2 }] } : { actionResult: primary }
      const url = 'https://www.facebook.com/groups/1/posts/2/'
      const steps = [step(1, 'fb_select_group_post_share_targets', { selectedTargets: [{ id: 2, name: 'Share group', uid: '2' }] }),
        step(2, 'fb_click_post_button', { posted: true }), step(3, 'fb_verify_group_post_form_closed', verify),
        step(4, 'fb_get_first_group_post_link', { postUrl: url }),
        ...(pending == null ? [] : [step(5, 'fb_detect_pending_post', { isPending: pending, pendingCheckConclusive: true })])]
      const summary = await f.scheduler.logMilestonesV2(f.campaign, f.input, 1, steps, true, [], consumed)
      assert.equal(summary.hasSuccess, true)
      await f.finish()
      const rows = await f.details(), originalLogs = [...f.logs]
      assert.equal(rows.length, 2)
      assert.equal(await f.quota(), 2)
      const sub = pending == null ? null : (await f.db.query('SELECT id FROM auto_status WHERE code=$1',
        [pending ? 'campaign_detail_post_pending' : 'campaign_detail_post_approved'])).rows[0].id
      assert.equal(rows[0].sub_status_id, sub)
      assert.equal(rows[1].sub_status_id, null, 'the source group conclusion cannot be copied to a shared target')
      assert.equal(rows[0].status, 'thành công')
      assert.equal(rows[0].counts_toward_limit, true)
      assert.equal(f.writes[0].postUrl, url)
      assert.equal(rows[0].log, `Đăng bài thành công vào Fixture group${pending === true ? ' (chờ duyệt)' : ''}`)
      assert.equal(rows[1].log, 'Đăng bài dạng chia sẻ vào Share group')
      assert.equal(rows[1].data.shareMode, 'group_composer_add_group')
      assert.deepEqual(approvals, [pending == null ? undefined : pending])
      assert.deepEqual(bumps, [{ url, pending: pending === true }])
      assert.deepEqual([...consumed], [2])
      assert.deepEqual(updates, [{ id: 2, patch: { status: 'hoàn thành', note: 'Đăng bài dạng chia sẻ' } }])
      if (format !== 'legacy') {
        await f.scheduler.logMilestonesV2(f.campaign, f.input, 1, structuredClone(steps), true, [], consumed)
        assert.equal((await f.details()).length, 2)
        assert.equal(await f.quota(), 2)
        assert.deepEqual(f.logs, originalLogs, 'replay cannot repeat post-processing/logs')
        assert.equal(bumps.length, 1); assert.equal(approvals.length, 1); assert.equal(updates.length, 1)
      }
      scenarios++
    } finally { await f.close() }
  }
}
async function main() {
  const zca = await import('zca-js')
  await partialSends(zca)
  await boundaryStops(zca)
  await boundarySnapshots(zca)
  await schedulerFailureBoundary(zca)
  await groups(zca)
  console.log(JSON.stringify({ scenarios, external_operations: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
