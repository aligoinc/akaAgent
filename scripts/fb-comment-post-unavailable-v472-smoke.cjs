// V472 runtime smoke: captured live workflow 207, real engine/executor, real
// scheduler result/policy methods and the PostgreSQL WASM writer. Offline only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), ts = require('typescript')
const { harness } = require('./action-status-mixed-output-smoke.cjs')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/fb-comment-post-unavailable-v472')
const before = JSON.parse(fs.readFileSync(path.join(dir, 'before.json'), 'utf8'))
const afterCode = fs.readFileSync(path.join(dir, 'block-2616.after.js'), 'utf8')
const beforeCode = fs.readFileSync(path.join(dir, 'block-2616.before.js'), 'utf8')
const clean = x => JSON.parse(JSON.stringify(x))
const compile = (file, stubs = {}) => {
  const m = { exports: {} }
  const out = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', out)(k => stubs[k] ?? require(k), m, m.exports)
  return m.exports
}
const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts',
  { './blockHelpers': { createBlockHelpers: (log, h, meta) => ({ log, ...h, visit: () => h.visit(meta.nodeId) }) } })
let blocks = new Map()
const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
  './blockExecutor': { BlockExecutor }, '../../data/repositories/blockRepository': { getBlock: async id => blocks.get(id) },
  '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
})
const claim = '11111111-1111-1111-1111-111111111111', unit = '22222222-2222-2222-2222-222222222222'
const TEXTBOX = before.element_textbox.xpath
const POST = 'https://www.facebook.com/groups/1410912332436011/posts/3232331733627386/'
const GENERIC = 'err_fb_comment_box_not_found'
const CODES = ['err_fb_comment_unavailable_post_not_found', 'err_fb_comment_unavailable_comment_disabled',
  'err_fb_comment_unavailable_post_pending', 'err_fb_comment_unavailable_not_member']
const page = (overrides = {}) => ({ url: POST, title: 'Facebook', hasDialog: true, articleCount: 1, headings: [], texts: [], ...overrides })
const CASES = {
  not_found: { signals: page({ hasDialog: false, articleCount: 0, headings: ['Bạn hiện không xem được nội dung này'],
    texts: ['Bạn hiện không xem được nội dung này', 'Lỗi này thường do chủ sở hữu chỉ chia sẻ nội dung với một nhóm nhỏ'] }),
    reason: 'post_not_found', status: 'không tồn tại', statusCode: 'campaign_detail_not_found', code: CODES[0], increment: false },
  not_found_en: { signals: page({ hasDialog: false, articleCount: 0, texts: ['This content isn’t available right now'] }),
    reason: 'post_not_found', status: 'không tồn tại', statusCode: 'campaign_detail_not_found', code: CODES[0], increment: false },
  not_found_nfd: { signals: page({ hasDialog: false, articleCount: 0, texts: ['Bạn hiện không xem được nội dung này'.normalize('NFD')] }),
    reason: 'post_not_found', status: 'không tồn tại', statusCode: 'campaign_detail_not_found', code: CODES[0], increment: false },
  comment_disabled: { signals: page({ texts: ['Quản trị viên đã tắt tính năng bình luận cho bài viết này.'] }),
    reason: 'comment_disabled', status: 'thất bại', statusCode: 'campaign_detail_failed', code: CODES[1], increment: false },
  post_pending: { signals: page({ texts: ['Bài viết của bạn đang chờ quản trị viên phê duyệt.'] }),
    reason: 'post_pending', status: 'thất bại', statusCode: 'campaign_detail_failed', code: CODES[2], increment: false },
  not_member: { signals: page({ texts: ['Tham gia nhóm để bình luận'] }),
    reason: 'not_member', status: 'thất bại', statusCode: 'campaign_detail_failed', code: CODES[3], increment: false },
  not_member_gate: { signals: page({ hasDialog: false, articleCount: 0, texts: ['Tham gia nhóm để xem hoặc tham gia thảo luận.'] }),
    reason: 'not_member', status: 'thất bại', statusCode: 'campaign_detail_failed', code: CODES[3], increment: false },
  ad_text_guard: { signals: page({ texts: ['Tham gia nhóm để xem thêm ưu đãi'] }),
    reason: 'unknown', status: 'lỗi', statusCode: 'campaign_detail_error', code: GENERIC, increment: true },
  checkpoint: { signals: page({ url: 'https://www.facebook.com/checkpoint/1501092823525282/?next=' + encodeURIComponent(POST), hasDialog: false, articleCount: 0 }),
    reason: 'checkpoint', status: 'lỗi', statusCode: 'campaign_detail_error', code: GENERIC, increment: true },
  logged_out: { signals: page({ url: 'https://www.facebook.com/login/?next=' + encodeURIComponent(POST), hasDialog: false, articleCount: 0 }),
    reason: 'logged_out', status: 'lỗi', statusCode: 'campaign_detail_error', code: GENERIC, increment: true },
  unknown: { signals: page({ texts: ['Thích', 'Chia sẻ', 'Phù hợp nhất'] }),
    reason: 'unknown', status: 'lỗi', statusCode: 'campaign_detail_error', code: GENERIC, increment: true }
}
let scenarios = 0

function environment(options = {}) {
  const original = before.workflow_207
  const workflow = { ...clean(original), defaultVariables: original.default_variables }
  const stats = { visited: [], waits: [], clicks: [], fills: [], keys: [], signalsRead: 0 }, abort = new AbortController()
  blocks = new Map(before.workflow_207_blocks.map(b => {
    let code = 'helpers.visit(); return {}'
    if (b.id === 2616) code = options.baseline ? beforeCode : afterCode
    if (b.id === 2614 || b.id === 20 || b.id === 2829) code = b.code
    if (b.id === 612) code = 'helpers.visit(); return { url: vars.inputDataUid }'
    if (b.id === 5) code = 'helpers.visit(); return { currentUrl: input.url }'
    if (b.id === 21) code = 'helpers.visit(); return { found: true }'
    if (b.id === 2615) code = 'helpers.visit(); return { liked: true }'
    if (b.id === 2670) code = "vars.originalIdentityName='Profile'; return {ok:true,identityName:'Profile'}"
    if (b.id === 2671) code = 'return await helpers.identity(input.useOriginalIdentity === true)'
    return [b.id, { ...b, code }]
  }))
  const fakePage = {
    isConnected: () => true,
    waitForSelector: async selector => {
      stats.waits.push(selector)
      if (options.stage === 'abort') { abort.abort(); throw new Error('waitForSelector timeout: ' + selector) }
      if (options.stage === 'other') throw new Error('Unrelated failure')
      if (selector === TEXTBOX && options.box !== 'found') throw new Error('waitForSelector timeout: ' + selector)
    },
    click: async s => { stats.clicks.push(s) },
    fill: async (s, t) => { stats.fills.push([s, t]) },
    press: async k => { stats.keys.push(k) },
    dropFile: async () => ({ fileCount: 0 }),
    evaluate: async script => {
      if (script.includes('createTreeWalker')) { stats.signalsRead++; return clean(options.signals || page()) }
      if (script.includes('ORDERED_NODE_SNAPSHOT_TYPE')) return false
      if (script.includes('FIRST_ORDERED_NODE_TYPE')) return ''
      throw new Error('unexpected evaluate')
    }
  }
  const elements = { fb_comment_dialog_textbox: TEXTBOX, GroupPostFrequencyLimitError: '//frequency-limit', fb_comment_permalink: '//permalink' }
  const helpers = {
    visit: id => stats.visited.push(id), sleep: async () => {},
    element: async key => { if (!(key in elements)) throw new Error('element missing ' + key); return elements[key] },
    prepareCampaignContent: async () => ({ content: 'Up tin nhé', media: [], variantIndex: 0 }),
    identity: async restore => ({ ok: true, identityName: restore ? 'Profile' : 'Page A' })
  }
  const vars = { inputDataId: 1, inputDataUid: POST, targetUrl: POST, commentVariants: ['Up tin nhé'], enablePostLike: false, ...options.vars }
  const engine = new WorkflowEngineV2()
  return { stats, abort, run: boundary => engine.run(workflow, vars, fakePage, {
    persist: false, signal: abort.signal, runtimeHelpers: helpers, onStepProgress: s => { boundary?.observe(s) } }) }
}
const commentStep = run => run.steps.find(s => s.nodeId === 'comment_current_post')

async function graphTests() {
  // Comment box present: identical operations and result to the live block.
  const base = environment({ baseline: true, box: 'found' }), baseRun = await base.run()
  const patched = environment({ box: 'found' }), patchedRun = await patched.run()
  assert.equal(baseRun.status, 'completed'); assert.equal(patchedRun.status, 'completed')
  assert.deepEqual(patched.stats, base.stats, 'success path keeps existing operations and order')
  assert.deepEqual(clean(commentStep(patchedRun).output), clean(commentStep(baseRun).output))
  assert.equal(commentStep(patchedRun).output.commented, true); assert.equal(patched.stats.signalsRead, 0); scenarios++

  // Live block today: the timeout fails the whole run with the raw XPath.
  const old = await environment({ baseline: true, signals: CASES.not_found.signals }).run()
  assert.notEqual(old.status, 'completed'); assert.match(String(commentStep(old).error), /waitForSelector timeout: \/\/\*\[@role='dialog'\]/); scenarios++

  for (const [name, c] of Object.entries(CASES)) {
    const env = environment({ signals: c.signals }), r = await env.run()
    assert.equal(r.status, 'completed', `${name}: ${r.error}`)
    const out = commentStep(r).output
    assert.equal(out.commented, false); assert.equal(out.commentFailed, true)
    assert.equal(out.actionResult.actionCode, 'fb_comment'); assert.equal(out.actionResult.statusCode, c.statusCode, name)
    assert.equal(out.actionResult.errorCode, c.code, name); assert.equal(out.actionResult.inputDataId, 1)
    assert.equal(out.actionResult.operationState, 'not_committed'); assert.equal(out.actionResult.data.reason, c.reason, name)
    assert(!out.actionResult.message.includes('waitForSelector') && !out.actionResult.message.includes('@role'), name)
    assert.equal(out.actionResult.data.error, undefined, 'no "error" key: it would become the pause reason')
    assert.equal(out.actionResult.data.sample !== undefined, c.reason === 'unknown', name)
    assert.equal(r.steps.find(s => s.nodeId === 'like_current_post').status, 'skipped', `${name}: no like after a failed comment`)
    assert.deepEqual(env.stats.fills, [], `${name}: nothing typed`); assert.deepEqual(env.stats.keys, [], `${name}: nothing sent`)
    scenarios++
  }
  // Like stays gated even when enabled.
  const liked = await environment({ signals: CASES.unknown.signals, vars: { enablePostLike: true } }).run()
  assert.equal(liked.steps.find(s => s.nodeId === 'like_current_post').status, 'skipped'); scenarios++
  // Other errors and cancellation keep throwing exactly as before.
  for (const stage of ['other', 'abort']) {
    const r = await environment({ stage, signals: CASES.unknown.signals }).run()
    assert.notEqual(r.status, 'completed'); assert(!r.steps.some(s => s.output?.actionResult)); scenarios++
  }
}

const mapped = row => Object.fromEntries(Object.entries(row).map(([k, val]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), val]))
async function applyV472(db) {
  await db.query("UPDATE auto_error SET detail_mode = 'inherit' WHERE error_code = ANY($1)", [CODES])
  await db.query(`INSERT INTO auto_error(id, error_type, error_name, error_desc, error_code, noti_running_process, noti_campaign,
    counts_toward_limit, counts_toward_bad_target, detail_mode, is_active, is_delete, disable_action_codes, zalo_error_codes, zalo_action_codes, disable_action_mode)
    VALUES((SELECT max(id) + 1 FROM auto_error), 'external facebook', 'Không tìm thấy ô bình luận', 'V472', $1,
    'Không tìm thấy ô bình luận', 'Không tìm thấy ô bình luận', false, true, 'inherit', true, false, '{}', '{}', '{}', 'fixed_minutes')`, [GENERIC])
}
async function managed(zca, name, { initial = 0, v472 = true, box } = {}) {
  const c = CASES[name] || { increment: false }
  const f = await harness(zca, 'facebook_comment_seeding_post')
  try {
    if (v472) await applyV472(f.db)
    const rows = (await f.db.query('SELECT * FROM auto_error WHERE error_code = ANY($1)', [[...CODES, GENERIC, 'err_undefined']])).rows
    const policies = new Map(rows.map(r => [r.error_code, mapped(r)]))
    const generic = policies.get('err_undefined')
    const updates = []
    f.scheduler.supabase.getErrorPolicy = async code => policies.get(code) ?? null
    f.scheduler.supabase.getAccount = async () => f.account
    f.scheduler.updateErrorPolicyAccount = async () => { throw Error('Unexpected account update') }
    f.scheduler.updateErrorPolicyCampaign = async (_, patch) => { updates.push(patch); Object.assign(f.campaign, patch) }
    f.scheduler.supabase.incrementCampaignBadTargetCount = async (campaignId, inputId, reason) => {
      const count = await f.runtime.settleManagedBadTarget(campaignId, inputId, reason)
      assert.notEqual(count, null); return { countConsecutiveBadTargets: count }
    }
    await f.db.query('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,$1)', [initial])
    await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'facebook', claimToken: claim }, ['fb_comment', 'fb_like_post'])
    f.runtime.beginActionResultUnit(1, unit, [1, 2])
    const env = environment({ signals: c.signals, box })
    const boundary = new f.runtime.ActionResultBoundary(1, () => env.abort.abort())
    const run = await env.run(boundary); assert.equal(run.status, 'completed', run.error); assert.equal(boundary.error, undefined)
    const summary = await f.final(run.steps); await f.finish()
    const count = async () => (await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n
    const details = await f.details()
    if (box === 'found') {
      assert.equal(details.length, 1); assert.equal(details[0].status, 'thành công'); assert.equal(await f.quota(), 1)
      scenarios++; return
    }
    const options = { targetCounter: {}, campaignDecision: { paused: false } }
    const explicit = await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary, options)
    assert.equal(explicit.triggered, false, `${name}: no immediate stop`)
    const effects = f.runtime.managedTargetEffects(1, 1)
    // Same decisions as the per-target scheduler path (campaignScheduler.ts:4429 then the generic bad-target branch).
    const flags = { hasSuccess: effects.badTargetEffect === 'reset', hasFailure: effects.badTargetEffect === 'increment' }
    let outcome = null
    if (!explicit.coversBadTarget && flags.hasFailure && !flags.hasSuccess) {
      outcome = await f.scheduler.handleCampaignBadTarget(f.account, f.campaign, 1, 'err_undefined', 'fb_comment', {
        message: f.scheduler.getMilestoneBadReason(summary), thresholdReason: f.scheduler.getMilestoneBadRootReason(summary)
      }, options)
    }
    const expectIncrement = v472 ? c.increment : true
    assert.equal(effects.badTargetEffect, expectIncrement ? 'increment' : 'ignore', name)
    assert.equal(await count(), initial + (expectIncrement ? 1 : 0), `${name}: counter`)
    const paused = expectIncrement && initial + 1 >= generic.countConsecutiveErrors
    assert.equal(updates.length, paused ? 1 : 0, `${name}: pause decision`)
    if (paused) {
      assert.equal(f.campaign.status, 'tạm dừng'); assert.equal(outcome.triggered, true)
      assert(!String(f.campaign.note).includes('waitForSelector') && !String(f.campaign.note).includes('@role'), f.campaign.note)
      assert(String(f.campaign.note).includes(c.signals ? f.scheduler.getMilestoneBadReason(summary) : ''), f.campaign.note)
    }
    assert.equal(details.length, 1, name)
    if (v472) {
      assert.equal(details[0].status, c.status, name); assert.equal(details[0].error_code, c.code, name)
      assert.equal(details[0].counts_toward_limit, false, name); assert.equal(await f.quota(), 0, `${name}: no quota`)
      assert.equal(details[0].policy_snapshot.badTargetEffect, c.increment ? 'increment' : 'ignore')
      assert.equal(details[0].data.reason, c.reason)
    }
    assert(f.logs.every(x => !x.includes('waitForSelector') && !x.includes('@role')), JSON.stringify(f.logs))
    // Replay of the same steps must not write or count again.
    await f.final(structuredClone(run.steps)); await f.finish()
    await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary, options)
    assert.equal((await f.details()).length, 1); assert.equal(await count(), initial + (expectIncrement ? 1 : 0))
    const inputs = (await f.db.query('SELECT id,status FROM auto_campaign_input_data ORDER BY id')).rows
    assert.equal(inputs[0].status, 'hoàn thành'); assert.equal(inputs[1].status, 'đang chạy')
    scenarios++
    return { status: details[0].status, quota: await f.quota(), effect: effects.badTargetEffect, paused, note: f.campaign.note, log: f.logs }
  } finally { await f.close() }
}

async function main() {
  await graphTests()
  const zca = await import('zca-js')
  const report = {}
  for (const name of Object.keys(CASES)) report[name] = await managed(zca, name, { initial: 3 })
  report.unknown_first = await managed(zca, 'unknown', { initial: 0 })
  report.success = await managed(zca, null, { box: 'found' })
  // Control: without the V472 policy change, a classified "Thất bại" still counts quota and the streak.
  report.control_without_policy = await managed(zca, 'comment_disabled', { initial: 3, v472: false })
  assert.equal(report.control_without_policy.quota, 1); assert.equal(report.control_without_policy.paused, true)
  for (const name of ['not_found', 'comment_disabled', 'post_pending', 'not_member']) assert.equal(report[name].paused, false)
  for (const name of ['unknown', 'checkpoint', 'logged_out']) assert.equal(report[name].paused, true)
  const summary = Object.fromEntries(Object.entries(report).filter(([, v]) => v).map(([k, v]) => [k, { status: v.status, effect: v.effect, paused: v.paused, quota: v.quota, note: v.note }]))
  console.log(JSON.stringify({ passed: true, scenarios, external_operations: 0, results: summary }, null, 1))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
