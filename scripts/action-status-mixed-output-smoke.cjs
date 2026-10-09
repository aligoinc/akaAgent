// Actual scheduler, managed writer and PostgreSQL WASM. No live DB or sends.
const assert = require('node:assert/strict')
const path = require('node:path')
const { createFixture } = require('./action-status-fixes-fixture.cjs')
const { desktop } = require('./action-status-fixes-smoke.cjs')
const { schedulerClass, fixture } = require('./campaign-media-timeout-smoke-test.cjs')
const root = path.resolve(__dirname, '..')
const claim = '11111111-1111-1111-1111-111111111111'
const unit = '22222222-2222-2222-2222-222222222222'
let scenarios = 0
const result = (actionCode, statusCode = 'campaign_detail_success', extra = {}) => ({
  actionCode, statusCode, operationState: statusCode === 'campaign_detail_success' ? 'committed' : 'not_committed', ...extra
})
const step = (id, blockName, output) => ({ id, runId: 7, nodeId: blockName, blockName,
  startedAt: `2026-10-09T00:00:${String(id).padStart(2, '0')}Z`, status: 'success', output })

async function harness(zca, actionId = 'facebook_newsfeed_interaction', platform = 'facebook', schedulerImports = {}) {
  const db = await createFixture()
  const { runtime, load, write } = await desktop(db)
  const Scheduler = schedulerClass(zca, {
    './actionResultRuntime': runtime,
    '../../shared/actionResultSession': load(path.join(root, 'src/shared/actionResultSession.ts')),
    '../../shared/actionStatusPolicy': load(path.join(root, 'src/shared/actionStatusPolicy.ts')),
    ...schedulerImports
  })
  const f = fixture(Scheduler)
  Object.assign(f.campaign, { id: 1, actionId })
  Object.assign(f.account, { id: 1, flatformType: platform })
  const logs = [], writes = []
  Object.assign(f.scheduler, { getPostActionCode: () => 'fb_post_group', getAccountActionName: code => code,
    logCampaignProgress: async (_c, message) => { logs.push(message) } })
  f.db.createCampaignDetail = async action => { writes.push(action); return write(action) }
  await runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform, claimToken: claim },
    ['fb_like_post', 'fb_comment', 'fb_post_group', 'fb_add_friend', 'zalo_message_friend', 'email_send'])
  runtime.beginActionResultUnit(1, unit, [1, 2])
  const input = { id: 1, name: 'Fixture group' }
  return { ...f, db, runtime, load, input, logs, writes,
    realtime: s => f.scheduler.logNewsfeedMilestoneStep(f.campaign, input, 1, s),
    final: steps => f.scheduler.logMilestonesV2(f.campaign, input, 1, steps, true),
    details: async () => (await db.query('SELECT * FROM auto_campaign_details ORDER BY id')).rows,
    quota: async () => (await db.query('SELECT coalesce(sum(count_action_in_day),0)::int n FROM auto_account_action_status')).rows[0].n,
    finish: () => runtime.settleManagedActionInput(1, { status: 'hoàn thành' }),
    close: async () => { runtime.endActionResultRun(1); await db.close() }
  }
}

async function newsfeed(zca) {
  for (const kind of ['like', 'comment']) for (const envelope of ['legacy', 'single', 'batch', 'direct', 'new-only']) {
    const f = await harness(zca)
    try {
      const action = kind === 'like' ? 'fb_like_post' : 'fb_comment'
      const block = kind === 'like' ? 'fb_newsfeed_like_post' : 'fb_newsfeed_comment_submit'
      const payload = { [kind === 'like' ? 'liked' : 'commented']: true, targetName: 'Fixture', postContent: 'Post', text: 'Comment' }
      const output = result(action)
      const s = step(1, block, envelope === 'new-only' ? { actionResult: output } : {
        ...payload, ...(envelope === 'single' ? { actionResult: output } : envelope === 'batch' ? { actionResults: [output] }
          : envelope === 'direct' ? output : {})
      })
      // Duplicate progress events may overlap; finalization may receive a clone.
      await Promise.all([f.realtime(s), f.realtime(structuredClone(s))])
      assert.equal(await f.quota(), 1, 'quota must be committed at the realtime boundary')
      const summary = await f.final([structuredClone(s)])
      assert.equal(summary.hasSuccess, true)
      await f.finish()
      await f.final([structuredClone(s)])
      const rows = await f.details()
      assert.equal(rows.length, 1, `${kind}/${envelope}: one detail`)
      assert.equal(await f.quota(), 1)
      assert.equal(f.writes.length, 1, 'finalization does not repeat writer or policy side effects')
      if (envelope !== 'new-only') {
        assert.equal(rows[0].log, kind === 'like' ? 'Đã like bài newsfeed của Fixture: "Post"' : 'Đã comment bài newsfeed của Fixture: "Comment"')
        assert.deepEqual(f.logs, [kind === 'like' ? '👍 Đã like bài newsfeed của "Fixture"' : '💬 Đã comment bài newsfeed của "Fixture"'])
      } else assert.deepEqual(f.logs, [], 'no new log template is invented')
      scenarios++
    } finally { await f.close() }
  }
  const f = await harness(zca)
  try {
    const steps = [step(1, 'fb_newsfeed_like_post', { liked: true }),
      step(2, 'fb_newsfeed_like_post', { liked: true, actionResult: result('fb_like_post') }),
      step(3, 'fb_newsfeed_like_post', { liked: true, actionResult: result('fb_like_post') })]
    for (const s of steps) await f.realtime(s)
    await f.final(steps)
    assert.equal((await f.details()).length, 3, 'separate iterations must not deduplicate each other')
    assert.equal(await f.quota(), 3)
    scenarios++
  } finally { await f.close() }
  const failure = await harness(zca)
  try {
    let calls = 0
    failure.scheduler.supabase.createCampaignDetail = async () => { calls++; throw new Error('uncertain response') }
    const s = step(1, 'fb_newsfeed_like_post', { liked: true, actionResult: result('fb_like_post') })
    await assert.rejects(failure.realtime(s), /uncertain response/)
    await assert.rejects(failure.final([structuredClone(s)]), /uncertain response/)
    assert.equal(calls, 1, 'uncertain write remains failed for cleanup, not silently repeated')
    scenarios++
  } finally { await failure.close() }
  const policies = await harness(zca)
  try {
    let policyCalls = 0
    policies.scheduler.supabase.getAccount = async () => policies.account
    policies.scheduler.applyRuntimeErrorPolicy = async () => { policyCalls++; return { triggered: false } }
    // This case tests immediate policy receipt replay; threshold decisions
    // are separately exercised at the full target boundary.
    const getPolicy = policies.scheduler.supabase.getErrorPolicy
    policies.scheduler.supabase.getErrorPolicy = async code => ({ ...await getPolicy(code), countConsecutiveErrors: null })
    const s = step(1, 'fb_newsfeed_comment_submit', { actionResult: result('fb_comment', 'campaign_detail_failed', {
      errorCode: 'err_undefined', message: 'existing diagnostic'
    }) })
    await Promise.all([policies.realtime(s), policies.realtime(structuredClone(s))])
    await policies.final([structuredClone(s)])
    assert.equal(policyCalls, 1, 'error/account/campaign policy is not replayed at finalization')
    assert.equal((await policies.details()).length, 1)
    const changed = structuredClone(s)
    changed.output.actionResult.statusCode = 'campaign_detail_success'
    await assert.rejects(policies.final([changed]), /result_key_conflict/)
    assert.equal((await policies.details()).length, 1)
    scenarios++
  } finally { await policies.close() }
  const batch = await harness(zca)
  try {
    const s = step(1, 'custom_newsfeed_results', { actionResults: [
      result('fb_like_post'), result('fb_comment'), result('fb_like_post', 'campaign_detail_success', { inputDataId: 2 })
    ] })
    await batch.realtime(s)
    assert.equal(await batch.quota(), 3)
    await batch.final([structuredClone(s)])
    assert.equal((await batch.details()).length, 3)
    assert.deepEqual((await batch.details()).map(row => row.input_data_id), [1, 1, 2])
    assert.equal(await batch.quota(), 3)
    scenarios++
  } finally { await batch.close() }
}

async function ordered(zca) {
  for (const order of ['post-first', 'comment-first']) for (const format of ['all-legacy', 'new-post', 'new-comment', 'all-new']) {
    // The legacy-only adapter retains its original ordering. Mixed/new must
    // honor the actual step sequence, including when comment precedes posting.
    if (format === 'all-legacy' && order === 'comment-first') continue
    const f = await harness(zca, 'facebook_group_post')
    try {
      const post = step(1, 'fb_click_post_button', { posted: true,
        ...(['new-post', 'all-new'].includes(format) ? { actionResult: result('fb_post_group') } : {}) })
      const comment = step(2, 'fb_comment_current_post', { commentFailed: true, error: 'failed',
        ...(['new-comment', 'all-new'].includes(format) ? { actionResult: result('fb_comment', 'campaign_detail_failed') } : {}) })
      const steps = order === 'post-first' ? [post, comment] : [comment, post]
      await f.final(steps)
      await f.finish()
      const rows = await f.details()
      assert.deepEqual(rows.map(row => row.action_code), steps.map(s => s === post ? 'fb_post_group' : 'fb_comment'))
      const failed = rows.find(row => row.action_code === 'fb_comment')
      assert.equal(failed.policy_snapshot.badTargetEffect, order === 'post-first' ? 'ignore' : 'increment')
      assert.equal((await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n,
        order === 'post-first' ? 0 : 1)
      scenarios++
    } finally { await f.close() }
  }
}

async function context(zca) {
  const f = await harness(zca, 'facebook_group_post')
  try {
    const approvals = [], bumps = []
    Object.assign(f.scheduler, { syncGroupPostContactStatus: async (_a, _i, pending) => approvals.push(pending),
      enqueuePostBumpAfterGroupPost: async (_c, url, pending) => bumps.push({ url, pending }), cleanPostLinkForStorage: value => value })
    const steps = [step(1, 'fb_click_post_button', { posted: true }),
      step(2, 'fb_verify_group_post_form_closed', { posted: true }),
      step(3, 'fb_get_first_group_post_link', { postUrl: 'https://www.facebook.com/groups/1/pending_posts/2/' }),
      step(4, 'fb_detect_pending_post', { isPending: true, pendingCheckConclusive: true }),
      step(5, 'fb_comment_current_post', { commentFailed: true, actionResult: result('fb_comment', 'campaign_detail_failed') })]
    const screenshotLogs = steps.map(s => ({ runStepId: s.id, storedMessage: `screenshot-${s.id}` }))
    await f.scheduler.logMilestonesV2(f.campaign, f.input, 1, steps, true, screenshotLogs)
    const rows = await f.details()
    assert.equal(rows.length, 2, 'click fallback must not duplicate the verified post')
    assert.equal(rows[0].policy_snapshot.subStatusId, Number((await f.db.query("SELECT id FROM auto_status WHERE code='campaign_detail_post_pending'")).rows[0].id))
    assert.equal(f.writes[0].postUrl, steps[2].output.postUrl)
    assert.equal(rows[0].log, 'Đăng bài thành công vào Fixture group (chờ duyệt)')
    assert.deepEqual(approvals, [true])
    assert.deepEqual(bumps, [{ url: steps[2].output.postUrl, pending: true }])
    assert.deepEqual(f.logs.filter(log => log.startsWith('screenshot-')), steps.map(s => `screenshot-${s.id}`))
    scenarios++
  } finally { await f.close() }
  const ordinal = await harness(zca, 'facebook_group_post')
  try {
    await ordinal.final([step(1, 'fb_click_post_button', { posted: true, actionResult: result('fb_post_group') }),
      step(2, 'fb_comment_current_post', { text: 'first' }), step(3, 'fb_comment_current_post', { text: 'second' })])
    const rows = await ordinal.details()
    assert.deepEqual(rows.filter(row => row.action_code === 'fb_comment').map(row => row.data.iteration), [1, 2])
    scenarios++
  } finally { await ordinal.close() }
  const verify = await harness(zca, 'facebook_group_post')
  try {
    await verify.final([step(1, 'fb_click_post_button', { posted: true }),
      step(2, 'fb_verify_group_post_form_closed', { posted: true, actionResult: result('fb_post_group') }),
      step(3, 'fb_comment_current_post', { commentFailed: true })])
    assert.deepEqual((await verify.details()).map(row => row.action_code), ['fb_post_group', 'fb_comment'])
    scenarios++
  } finally { await verify.close() }
  const flags = await harness(zca, 'zalo_message_friend', 'zalo')
  try {
    flags.scheduler.isZaloBrowserlessCampaign = () => true
    const summary = await flags.final([step(1, 'zalo_send_message', { detail: {
      actionCode: 'zalo_message_friend', status: 'thành công', deliveryCommitted: true, log: 'existing sent' } }),
      step(2, 'custom_result', { actionResult: result('zalo_message_friend') }),
      step(3, 'zalo_followup', { detail: { actionCode: 'zalo_message_friend', status: 'lỗi',
        resetInputToPending: true, pendingNote: 'existing retry', log: 'existing failure' } })])
    assert.equal(summary.deliveryCommitted, true)
    assert.equal(summary.preventInputRetry, true)
    assert.equal(summary.resetInputToPending, false)
    scenarios++
  } finally { await flags.close() }
}

async function main() {
  const zca = await import('zca-js')
  await newsfeed(zca)
  await ordered(zca)
  await context(zca)
  console.log(JSON.stringify({ scenarios, external_operations: 0 }))
}
module.exports = { harness, result, step }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
