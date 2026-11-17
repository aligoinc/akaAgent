// Đường Facebook của engine v2 chạy trong bộ lập lịch Desktop thật (campaignScheduler.ts dựng bằng esbuild): DesktopEngineRunner →
// runUnit (chế độ workflow) → runFacebookEngineTarget → WorkflowEngineV2 + hook → bộ dựng dòng lịch sử của bộ cũ (chế độ thu lại) → hàm
// engine thật trên PostgreSQL 17 cục bộ (V495…V558). Trang Facebook và block là bản giả có cùng hình dạng đầu ra với block production.
// Chạy: node scripts/engine-v2-facebook/desktop-fb-smoke.cjs   (tự chạy lại dưới Electron để nạp better-sqlite3 cho nhật ký)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

const { build } = require('esbuild')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563SignsOnly } = require('./fixture.cjs')
const V563 = require('../build-v563-sql.cjs')
const PORT = Number(process.env.FB_DESKTOP_TEST_PORT || 55555)
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

const REPO_FILE = path.join(ROOT, 'src/main/data/repositories/facebookEngineRepository.ts')
const AI_FILE = path.join(ROOT, 'src/main/services/aiRuntimeService.ts')
const STUBS = {
  electron: `
const handler = { get(target, key) { if (key === '__esModule') return false; return target[key] ?? (target[key] = new Proxy(function Stub() {}, handler)) },
  apply() { return new Proxy(function Stub() {}, handler) }, construct() { return new Proxy(function Stub() {}, handler) } }
const stub = () => new Proxy(function Stub() {}, handler)
const names = ['BrowserWindow', 'webContents', 'ipcMain', 'powerMonitor', 'session', 'net', 'dialog', 'shell', 'Notification', 'screen',
  'nativeImage', 'clipboard', 'Menu', 'Tray', 'systemPreferences', 'protocol', 'crashReporter', 'nativeTheme', 'safeStorage', 'contentTracing',
  'desktopCapturer', 'globalShortcut', 'inAppPurchase', 'MessageChannelMain', 'powerSaveBlocker', 'utilityProcess', 'WebContentsView', 'BaseWindow']
const electron = { app: { getPath: () => globalThis.__fbTest.userData, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'aka-test',
  on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => globalThis.__fbTest.userData } }
for (const name of names) electron[name] = stub()
module.exports = electron`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__fbTest.client, desktopFetch: fetch }`,
  currentUser: `module.exports = { getCurrentUser: () => globalThis.__fbTest.user, requireCurrentUser: () => globalThis.__fbTest.user,
    requireCurrentUserCredentials: () => ({ username: 'fb', password: 'pw' }), getCurrentUserCredentials: () => ({ username: 'fb', password: 'pw' }),
    setCurrentUser() {}, setCurrentUserCredentials() {}, onCurrentUserSessionChanged: () => () => {}, runWithCurrentUser: (_u, op) => op(),
    isZaloServerUser: () => false, isZaloShowWebUser: () => false, isCurrentUserZaloShowWeb: () => false, isCurrentUserZaloServerEnabled: () => false }`,
  workflowV2Repository: `module.exports = { getWorkflow: async id => globalThis.__fbTest.workflows.get(Number(id)) || null,
    getWorkflowByName: async name => [...globalThis.__fbTest.workflows.values()].find(w => w.name === name) || null }`,
  blockRepository: `module.exports = { getBlock: async id => globalThis.__fbTest.blocks.get(Number(id)) || null }`,
  runV2Repository: `module.exports = {
    createRun: async run => { const t = globalThis.__fbTest; t.runs.push({ ...run }); return t.runs.length },
    updateRun: async (id, patch) => { Object.assign(globalThis.__fbTest.runs[id - 1], patch) },
    createRunStep: async (runId, step) => { const t = globalThis.__fbTest; t.runSteps.push({ runId, ...step }); return t.runSteps.length },
    updateRunStep: async (id, patch) => { Object.assign(globalThis.__fbTest.runSteps[id - 1], patch) } }`,
  elementV2Repository: `module.exports = { resolveXpathByName: async name => globalThis.__fbTest.elements[name] || ('//missing-' + name) }`,
  facebookPageIdentityRepository: `module.exports = { validateCampaignPageIdentity: async () => undefined }`,
  // Thiết lập chạy của FB: bài kiểm đặt ngưỡng block treo nhỏ; còn lại dùng bản thật (đọc auto_system_settings qua client giả).
  fbwrap: `export * from ${JSON.stringify(REPO_FILE)}
import * as real from ${JSON.stringify(REPO_FILE)}
export async function loadFacebookRuntimeSettings() { const s = await real.loadFacebookRuntimeSettings(); return { ...s, ...(globalThis.__fbTest.runtimeSettings || {}) } }`,
  // AI của bộ lập lịch (Q11: đọc ảnh lỗi khi dừng theo chuỗi SYS99): bài kiểm trả câu giả, mặc định báo AI không trả câu.
  aiwrap: `export * from ${JSON.stringify(AI_FILE)}
export async function callAiUsing(code, variables, context) {
  const t = globalThis.__fbTest
  return t.ai ? t.ai(code, variables, context) : { ok: false, error: 'AI không bật trong bài kiểm' }
}`
}

async function loadScheduler() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-desktop-'))
  const outfile = path.join(out, 'scheduler.cjs')
  await build({
    entryPoints: [path.join(ROOT, 'src/main/services/campaignScheduler.ts')], outfile, bundle: true, platform: 'node', format: 'cjs',
    logLevel: 'error', packages: 'external',
    // Gói ngoài (better-sqlite3 dựng cho Electron…) nạp theo node_modules của repo dù bản dựng nằm ở thư mục tạm.
    banner: { js: `require = require('node:module').createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});` },
    plugins: [{ name: 'fb-desktop-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
      plugin.onResolve({ filter: /(\/supabaseClient|\/currentUser|repositories\/(workflowV2Repository|blockRepository|runV2Repository|elementV2Repository|facebookPageIdentityRepository))$/ },
        args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
      plugin.onResolve({ filter: /repositories\/facebookEngineRepository$/ }, args =>
        args.namespace === 'stub' ? undefined : ({ path: 'fbwrap', namespace: 'stub' }))
      plugin.onResolve({ filter: /\/aiRuntimeService$/ }, args =>
        args.namespace === 'stub' ? undefined : ({ path: 'aiwrap', namespace: 'stub' }))
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: STUBS[args.path], loader: args.path === 'fbwrap' || args.path === 'aiwrap' ? 'ts' : 'js',
        resolveDir: path.dirname(REPO_FILE) }))
    } }]
  })
  return { mod: require(outfile), out }
}

/** Client Supabase giả: rpc → gọi hàm SQL thật; from().select() → SELECT trên PG (đủ cho danh mục / thiết lập). */
function fakeClient(db) {
  const ident = s => '"' + String(s).replaceAll('"', '""') + '"'
  return {
    rpc(name, args) {
      const run = (async () => {
        const params = [], parts = []
        for (const [key, value] of Object.entries(args || {})) {
          const json = value !== null && typeof value === 'object'
          params.push(json ? JSON.stringify(value) : value)
          parts.push(`${key} => $${params.length}${json ? '::jsonb' : ''}`)
        }
        try {
          const r = await db.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
          return { data: r.rows[0].r, error: null, status: 200 }
        } catch (e) { return { data: null, error: { message: e.message, code: e.code }, status: 400 } }
      })()
      return { abortSignal: () => run, then: (a, b) => run.then(a, b) }
    },
    from(table) {
      const filters = [], params = []
      let cols = '*'
      const builder = {
        select(c) { cols = c.split(',').map(x => x.trim()).filter(Boolean).map(ident).join(', '); return builder },
        eq(col, value) { params.push(value); filters.push(`${ident(col)} = $${params.length}`); return builder },
        in(col, values) { params.push(values); filters.push(`${ident(col)} = ANY($${params.length})`); return builder },
        order() { return builder }, limit() { return builder }, range() { return builder }, abortSignal() { return builder },
        then(resolve, reject) {
          return db.query(`SELECT ${cols} FROM public.${ident(table)}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''}`, params)
            .then(r => ({ data: r.rows, error: null }), e => ({ data: null, error: { message: e.message, code: e.code } })).then(resolve, reject)
        }
      }
      return builder
    }
  }
}

class FakePage {
  constructor(scenario) {
    this.scenario = scenario
    this.url = 'https://www.facebook.com/groups/g1/'
    this.clicks = []
    this.destroyed = false
    this.hangs = []
  }
  getURL() { return this.url }
  isConnected() { return !this.destroyed }
  destroy() { this.destroyed = true; for (const reject of this.hangs.splice(0)) reject(new Error('Script failed to execute')) }
  hang() { return new Promise((_resolve, reject) => this.hangs.push(reject)) }
  async waitForSelector(sel) {
    if (this.destroyed) throw new Error('Browser page is not connected')
    if (this.scenario.missing?.includes(sel)) throw new Error('waitForSelector timeout: ' + sel)
    return true
  }
  async $(sel) { return this.scenario.missing?.includes(sel) ? null : { xpath: sel } }
  async click(sel) {
    if (this.destroyed) throw new Error('Browser page is not connected')
    if (this.scenario.hangOn === sel) return this.hang()
    if (this.scenario.notFound?.includes(sel)) throw new Error('Element not found: ' + sel)
    this.scenario.onClick?.(sel)
    this.clicks.push(sel)
    if (this.scenario.failAfterClick === sel) throw new Error('Script failed to execute')
    if (this.scenario.checkpointAfterClick === sel) { this.url = 'https://www.facebook.com/checkpoint/1501092823525282/'; throw new Error('Element not found: ' + sel) }
  }
  async type() { if (this.destroyed) throw new Error('Browser page is not connected') }
  async captureJpeg() { return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]) }
  async press(key) { this.clicks.push('press:' + key) }
  async evaluate(code) {
    if (this.destroyed) throw new Error('Browser page is not connected')
    if (code === 'formClosed') return this.scenario.formClosed !== false
    if (code === 'typeError') return this.scenario.typeError ?? null
    if (code === 'postLink') return this.scenario.postLink ?? ''
    // Bản đọc chữ trên trang để so dấu hiệu lỗi (errorSigns.ts PAGE_SIGN_TEXTS_SCRIPT).
    if (String(code).includes('aka:page-sign-texts')) { this.pageSignReads = (this.pageSignReads ?? 0) + 1; return this.scenario.pageTexts ?? [] }
    return null
  }
}

const ELEMENTS = {
  fb_composer_button: '//div[@role="button"][.//span[text()="Bạn viết gì đi..."]]',
  fb_composer_editor: '//div[@contenteditable="true"][@role="textbox"]',
  fb_post_button: '//div[@aria-label="Đăng"][@role="button"]',
  fb_comment_box: '(//div[@role="textbox"][@aria-label="Viết bình luận"])[1]',
  fb_group_feed: '//div[@role="feed"]'
}

// Block giả có cùng hình dạng đầu ra với block production (đọc 16/11/2026: 27, 30, 2624, 34).
const BLOCKS = [
  { id: 27, name: 'fb_open_composer', code: `
const sel = await helpers.element('fb_composer_button')
try { await page.waitForSelector(sel, { timeout: 100 }) } catch (cause) {
  return { opened: false, actionResult: { actionCode: input.composerActionCode || 'fb_post_group', statusCode: 'campaign_detail_error',
    errorCode: 'err_fb_group_composer_editor_not_found', inputDataId: vars.inputDataId ?? null, operationState: 'not_committed',
    message: 'Không tìm thấy ô đăng bài', data: { error: String(cause.message), source: 'fb_open_composer' } } }
}
await page.click(sel)
return { opened: true }` },
  { id: 28, name: 'fb_type_post_content', code: `const failure = await page.evaluate('typeError')
if (failure) throw new Error(failure)
await page.type(await helpers.element('fb_composer_editor'), 'Nội dung'); return { typed: true }` },
  { id: 30, name: 'fb_click_post_button', code: `
const btn = await helpers.element('fb_post_button')
await page.waitForSelector(btn, { timeout: 100 })
await page.click(btn)
await helpers.sleep(5, signal)
return { posted: true }` },
  { id: 2624, name: 'fb_verify_group_post_form_closed', code: `
const ok = await page.evaluate('formClosed')
if (!ok) throw new Error('Form đăng bài chưa đóng sau 60 giây')
return { ok: true, posted: true, submitClosed: true, message: 'Form đăng bài đã đóng' }` },
  { id: 2833, name: 'fb_get_first_group_post_link', code: `return { postUrl: 'https://www.facebook.com/groups/g1/posts/' + (vars.loopIndex ?? 7) + '123/' }` },
  // Chọn nhóm chia sẻ kèm trong hộp đăng bài (block 2794 production): chọn tối đa groupPostShareMaxCount (≤ 3) trong danh sách ứng viên.
  { id: 2794, name: 'fb_select_group_post_share_targets', code: `
const enabled = vars.enableGroupPostShareToJoinedGroups === true
const targets = Array.isArray(vars.groupPostShareTargets) ? vars.groupPostShareTargets : []
const max = Math.min(3, Math.max(0, Math.floor(Number(vars.groupPostShareMaxCount ?? 0))))
if (!enabled || max <= 0 || targets.length === 0) return { enabled, skipped: true, selectedTargets: [] }
const selectedTargets = targets.slice(0, Math.min(max, 2))
return { enabled: true, skipped: false, selectedCount: selectedTargets.length, selectedTargets }` },
  { id: 34, name: 'fb_comment_at_position', code: `
const box = await helpers.element('fb_comment_box')
await page.click(box)
await page.press('Enter')
return { commented: true, position: vars.loopIndex + 1, text: 'Bình luận ' + (vars.loopIndex + 1) }` }
]

const WORKFLOW_ID = 5001
const workflow = () => ({
  id: WORKFLOW_ID, name: '[engine] Đăng nhóm', defaultVariables: {}, edges: [
    { id: 'e1', source: 'open', target: 'gate' }, { id: 'e2', source: 'gate', target: 'type', sourceHandle: 'true' },
    { id: 'e3', source: 'type', target: 'share' }, { id: 'e3b', source: 'share', target: 'post' }, { id: 'e4', source: 'post', target: 'verify' },
    { id: 'e5', source: 'verify', target: 'link' },
    { id: 'e6', source: 'link', target: 'comments' }, { id: 'e7', source: 'comments', target: 'comment', sourceHandle: 'body' }
  ],
  nodes: [
    { id: 'open', blockId: 27, blockName: 'fb_open_composer', config: { composerActionCode: 'fb_post_group' } },
    { id: 'gate', blockId: 0, blockName: 'if_else', systemType: 'ifElse', config: { condition: 'input.opened === true' } },
    { id: 'type', blockId: 28, blockName: 'fb_type_post_content', config: {} },
    { id: 'share', blockId: 2794, blockName: 'fb_select_group_post_share_targets', config: {} },
    { id: 'post', blockId: 30, blockName: 'fb_click_post_button', config: { composerActionCode: 'fb_post_group' } },
    { id: 'verify', blockId: 2624, blockName: 'fb_verify_group_post_form_closed', config: {} },
    { id: 'link', blockId: 2833, blockName: 'fb_get_first_group_post_link', config: {} },
    { id: 'comments', blockId: 0, blockName: 'loop', systemType: 'loop', config: { loopType: 'count', count: 2 } },
    { id: 'comment', blockId: 34, blockName: 'fb_comment_at_position', config: {} }
  ]
})

// Đăng nhóm kèm comment theo đúng chuỗi bước production sau cú Đăng (V563): xác nhận đã đăng (ghi vars.groupPostSubmitted như block 2871),
// lấy link (ghi vars.groupPostPostUrl như block 2873, link lấy từ kịch bản trang), block chỉnh comment = code bản engine V563 thật, rồi cổng
// và vòng comment như workflow "[engine] facebook_group_post" (điều kiện / itemsExpr chép từ production 17/11). Tên trong DB thử khác tên bước
// (DB thử có block giả cùng tên); bộ dựng lịch sử nhận bước theo tên trong node như production.
const ADJUST_BLOCKS = [
  { id: 2625, name: 'v563_verify_group_post_form_closed', code: `vars.groupPostSubmitted = true
return { ok: true, posted: true, submitClosed: true, message: 'Form đăng bài đã đóng' }` },
  { id: 2835, name: 'v563_get_first_group_post_link', code: `const postUrl = String(await page.evaluate('postLink') || '')
vars.groupPostPostUrl = postUrl
return { ok: postUrl.length > 0, postUrl, link: postUrl }` },
  { id: 2874, name: 'v563_adjust_group_post_comments_after_pending', code: V563.ADJUST.newCode }
]
const adjustWorkflow = () => ({
  id: WORKFLOW_ID, name: '[engine] Đăng nhóm', defaultVariables: {}, edges: [
    { id: 'a1', source: 'open', target: 'gate' }, { id: 'a2', source: 'gate', target: 'type', sourceHandle: 'true' },
    { id: 'a3', source: 'type', target: 'post' }, { id: 'a4', source: 'post', target: 'verify' }, { id: 'a5', source: 'verify', target: 'link' },
    { id: 'a6', source: 'link', target: 'adjust' }, { id: 'a7', source: 'adjust', target: 'if_comment' },
    { id: 'a8', source: 'if_comment', target: 'loop_comment', sourceHandle: 'true' },
    { id: 'a9', source: 'loop_comment', target: 'comment', sourceHandle: 'body' }
  ],
  nodes: [
    { id: 'open', blockId: 27, blockName: 'fb_open_composer', config: { composerActionCode: 'fb_post_group' } },
    { id: 'gate', blockId: 0, blockName: 'if_else', systemType: 'ifElse', config: { condition: 'input.opened === true' } },
    { id: 'type', blockId: 28, blockName: 'fb_type_post_content', config: {} },
    { id: 'post', blockId: 30, blockName: 'fb_click_post_button', config: { composerActionCode: 'fb_post_group' } },
    { id: 'verify', blockId: 2625, blockName: 'fb_verify_group_post_form_closed', config: {} },
    { id: 'link', blockId: 2835, blockName: 'fb_get_first_group_post_link', config: {} },
    { id: 'adjust', blockId: 2874, blockName: 'fb_adjust_group_post_comments_after_pending', config: {} },
    { id: 'if_comment', blockId: 0, blockName: 'if_else', systemType: 'ifElse',
      config: { condition: 'vars.enableComment === true && Array.isArray(vars.commentIterations) && vars.commentIterations.length > 0' } },
    { id: 'loop_comment', blockId: 0, blockName: 'loop', systemType: 'loop', config: { loopType: 'forEach', itemsExpr: 'vars.commentIterations' } },
    { id: 'comment', blockId: 34, blockName: 'fb_comment_at_position', config: {} }
  ]
})

// Mời bạn vào nhóm: một block trả nhiều kết quả (actionResults) cho cùng một data (block 2819 production làm theo lô). Như block production,
// block đọc group nhận lời mời và danh sách người mời từ biến (thử thật 17/11: engine từng không truyền các biến này).
const INVITE_WORKFLOW_ID = 5003
const INVITE_GROUP = { facebookGroupInviteTargetGroupUrl: 'https://www.facebook.com/groups/164469482423151', facebookGroupInviteTargetGroupUid: '164469482423151',
  facebookGroupInviteTargetGroupName: 'Nhóm thử' }
const INVITE_BLOCK = { id: 2819, name: 'fb_group_invite', code: `
const groupUrl = String(vars.facebookGroupInviteTargetGroupUrl || '').trim()
const groupName = String(vars.facebookGroupInviteTargetGroupName || '')
const targets = Array.isArray(vars.facebookGroupInviteTargets) ? vars.facebookGroupInviteTargets : []
if (!groupUrl) throw new Error('Link group nhận lời mời không hợp lệ')
if (targets.length !== 1 || Number(targets[0].inputDataId) !== Number(vars.inputDataId) || Number(vars.facebookGroupInviteQuotaCapacity) !== 1
  || !groupName.startsWith('Nhóm thử')) throw new Error('Biến mời vào nhóm sai: ' + JSON.stringify({ targets, cap: vars.facebookGroupInviteQuotaCapacity }))
const id = Number(targets[0].inputDataId)
// Khuôn kết quả của block 2819 production: results theo lô (thử thật 17/11), không phải actionResult.
if (groupName === 'Nhóm thử trống') return { ok: true, submitOk: true, groupUrl, groupName, processedCount: 0, results: [] }
if (groupName === 'Nhóm thử gửi lỗi') return { ok: true, submitOk: false, groupUrl, groupName, processedCount: 1,
  results: [{ inputDataId: id, name: 'Bạn A', status: 'selected', selected: true, message: 'Chưa gửi được lời mời cho Bạn A' }] }
return { ok: true, submitOk: true, groupUrl, groupName, processedCount: 3, results: [
  { inputDataId: id, name: 'Bạn A', status: 'selected', selected: true },
  { inputDataId: id, name: 'Bạn B', status: 'đã là thành viên', message: 'Đã là thành viên của group', countsTowardLimit: false },
  { inputDataId: id, name: 'Bạn C', status: 'không mời được', message: 'Không mời được Bạn C' }
] }` }
const inviteWorkflow = () => ({ id: INVITE_WORKFLOW_ID, name: '[engine] Mời vào nhóm', defaultVariables: {}, edges: [],
  nodes: [{ id: 'group_invite', blockId: 2819, blockName: 'fb_group_invite', config: {} }] })

// Tìm data trong group: không gửi gì, bộ cũ ghi một dòng "Tìm data" không mã thao tác rồi đẩy data đi (anh chốt Q5: đưa vào engine).
const FIND_WORKFLOW_ID = 5004
const FIND_BLOCK = { id: 2605, name: 'fb_find_group_data_summary', code: `
await page.waitForSelector(await helpers.element('fb_group_feed'), { timeout: 100 })
return { uids: ['100001', '100002'], phones: ['0901234567'], linkGroupZalos: [], postLinks: [], groupMembers: [], facebookGroups: [],
  groupUrl: 'https://www.facebook.com/groups/g1', total: 3 }` }
const findWorkflow = () => ({ id: FIND_WORKFLOW_ID, name: '[engine] Tìm data trong group', defaultVariables: {}, edges: [],
  nodes: [{ id: 'summary', blockId: 2605, blockName: 'fb_find_group_data_summary', config: {} }] })

// Newsfeed chỉ lướt (không like / comment): không có thao tác nào, bộ cũ không ghi dòng lịch sử (thử thật 17/11).
const NEWSFEED_WORKFLOW_ID = 5005
const NEWSFEED_BLOCK = { id: 9650, name: 'fb_newsfeed_browse_test', code: `return { browsed: true, liked: 0, commented: 0 }` }
const newsfeedWorkflow = () => ({ id: NEWSFEED_WORKFLOW_ID, name: '[engine] Lướt newsfeed', defaultVariables: {}, edges: [],
  nodes: [{ id: 'browse', blockId: 9650, blockName: 'fb_newsfeed_browse_test', config: {} }] })

// Đăng trang cá nhân: loại không có dòng data, mỗi mốc lịch một lượt (V558 campaign_slot). Dòng lịch sử "Đăng bài" của bộ cũ lấy từ
// bước fb_click_post_button thành công (posted: true).
const TIMELINE_WORKFLOW_ID = 5002
const timelineWorkflow = () => ({
  id: TIMELINE_WORKFLOW_ID, name: '[engine] Đăng trang cá nhân', defaultVariables: {}, edges: [
    { id: 'e1', source: 'open', target: 'gate' }, { id: 'e2', source: 'gate', target: 'type', sourceHandle: 'true' },
    { id: 'e3', source: 'type', target: 'post' }
  ],
  nodes: [
    { id: 'open', blockId: 27, blockName: 'fb_open_composer', config: { composerActionCode: 'fb_post_my_profile' } },
    { id: 'gate', blockId: 0, blockName: 'if_else', systemType: 'ifElse', config: { condition: 'input.opened === true' } },
    { id: 'type', blockId: 28, blockName: 'fb_type_post_content', config: {} },
    { id: 'post', blockId: 30, blockName: 'fb_click_post_button', config: { composerActionCode: 'fb_post_my_profile' } }
  ]
})

async function main() {
  const { mod, out } = await loadScheduler()
  const cluster = startCluster({ port: PORT, label: 'aka-fb-desktop-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-userdata-'))
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    // V559 (luật phân loại + chính sách FB bản nháp): kết quả trong bài này đi đúng đường như khi bật thật.
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    // V563: dấu hiệu FB11 "Tham gia nhóm" + chính sách (đúng câu của migration). Phần block của V563 kiểm ở v563-smoke.cjs (DB thử này có block
    // giả cùng số với block bộ cũ).
    await applyV563SignsOnly(db)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const STAFF = 9201, ORG = 621
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'FB Desktop') ON CONFLICT DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, 'fbdesk', 'pw')`, [STAFF, ORG])
    await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
      VALUES ($1, 3, 'paid', now() + interval '30 days')`, [ORG])
    await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.facebook'`, [JSON.stringify({ mode: 'orgs', organizationIds: [ORG] })])
    for (const block of [...BLOCKS, ...ADJUST_BLOCKS, INVITE_BLOCK, FIND_BLOCK, NEWSFEED_BLOCK]) {
      await db.query(`INSERT INTO public.auto_blocks (id, name, code) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [block.id, block.name, block.code])
    }
    await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges) VALUES ($1, '[engine] Đăng nhóm', '[]', '[]')`, [WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ('facebook_group_post', $1)`, [WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_engine_block_steps (block_id, step_kind, action_code, commit_level, send_ops) VALUES
      (27, 'result', NULL, 1, '[]'), (30, 'delivery', 'fb_post_group', 2, '["click:fb_post_button"]'), (34, 'delivery', 'fb_comment', 1, '[]'),
      (2624, 'result', NULL, 1, '[]')`)
    await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges) VALUES ($1, '[engine] Đăng trang cá nhân', '[]', '[]')`, [TIMELINE_WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges) VALUES ($1, '[engine] Mời vào nhóm', '[]', '[]')`, [INVITE_WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ('facebook_group_invite', $1)`, [INVITE_WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_engine_block_steps (block_id, step_kind, action_code, commit_level, send_ops) VALUES (2819, 'delivery', 'fb_group_invite', 1, '[]')`)
    await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ('facebook_timeline_post', $1)`, [TIMELINE_WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges) VALUES ($1, '[engine] Tìm data trong group', '[]', '[]')`, [FIND_WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ('facebook_find_data_group', $1)`, [FIND_WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges) VALUES ($1, '[engine] Lướt newsfeed', '[]', '[]')`, [NEWSFEED_WORKFLOW_ID])
    await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ('facebook_newsfeed_interaction', $1)`, [NEWSFEED_WORKFLOW_ID])
    // Cùng block nút Đăng, riêng workflow trang cá nhân: thao tác của mốc là fb_post_my_profile (dòng ghi đè theo workflow).
    await db.query(`INSERT INTO public.auto_engine_block_steps (block_id, workflow_id, step_kind, action_code, commit_level, send_ops)
      VALUES (30, $1, 'delivery', 'fb_post_my_profile', 2, '["click:fb_post_button"]')`, [TIMELINE_WORKFLOW_ID])

    const facadeCalls = []
    globalThis.__fbTest = {
      userData, client: fakeClient(db), runs: [], runSteps: [], elements: ELEMENTS,
      user: { staffId: STAFF, organizationId: ORG, facebookEngineV2: true, campaignEngineV2: false,
        entitlements: { facebookCore: true, facebookFanpage: false, email: false, zalo: false, sms: false } },
      blocks: new Map([...BLOCKS, ...ADJUST_BLOCKS, INVITE_BLOCK, FIND_BLOCK, NEWSFEED_BLOCK].map(b => [b.id, { ...b, configSchema: [], defaultConfig: {}, isBuiltin: false }])),
      workflows: new Map([[WORKFLOW_ID, workflow()], [TIMELINE_WORKFLOW_ID, timelineWorkflow()], [INVITE_WORKFLOW_ID, inviteWorkflow()],
        [FIND_WORKFLOW_ID, findWorkflow()], [NEWSFEED_WORKFLOW_ID, newsfeedWorkflow()]]),
      runtimeSettings: null
    }
    const progress = []
    const mapCampaign = row => row && ({
      id: Number(row.id), name: row.name, actionId: row.action_id, accountId: Number(row.account_id), staffId: Number(row.staff_id),
      organizationId: Number(row.organization_id), status: row.status, note: row.note, content: row.content ?? 'Nội dung',
      extraSettings: row.extra_settings || {}, images: [], isDelete: row.is_delete, updatedAt: row.updated_at, schedule: row.schedule,
      dataTargetSourceMode: 'direct'
    })
    const facade = new Proxy({
      getCampaign: async id => mapCampaign(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id])),
      // Như auto_campaign_actions.limit_check_action_codes production (16/11): trang cá nhân rỗng (không kiểm hạn mức).
      getCampaignAction: async id => ({ id, limitCheckActionCodes: id === 'facebook_group_post' ? ['fb_post_group', 'fb_comment']
        : id === 'facebook_group_invite' ? ['fb_group_invite'] : [] }),
      listCampaignInputData: async campaignId => (await db.query('SELECT * FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id',
        [campaignId])).rows.map(r => ({ id: Number(r.id), campaignId: Number(r.campaign_id), name: r.name, uid: r.uid, status: r.status, isDelete: r.is_delete })),
      updateCampaign: async (id, patch) => {
        if (patch.extraSettings) await db.query('UPDATE public.auto_campaigns SET extra_settings = $2 WHERE id = $1', [id, JSON.stringify(patch.extraSettings)])
        return mapCampaign(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id]))
      },
      appendCampaignLog: async (id, message) => {
        progress.push(message)
        const row = await one('SELECT id, name, account_id FROM public.auto_campaigns WHERE id = $1', [id])
        return { id: Number(row.id), name: row.name, accountId: Number(row.account_id), accountName: 'FB' }
      },
      getAccount: async id => ({ id, name: 'FB', flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập' }),
      upsertGroupPostContactStatus: async () => undefined,
      updatePendingUnclaimedCampaignNote: async (id, _updatedAt, note) => mapCampaign(await one(`UPDATE public.auto_campaigns SET note = $2
        WHERE id = $1 AND status = 'chờ xử lý' RETURNING *`, [id, note])),
      // Q11: như reviseEnginePausedCampaignNote (chỉ ghi khi còn tạm dừng với đúng câu DB vừa ghi).
      reviseEnginePausedCampaignNote: async (id, expected, note) => mapCampaign(await one(`UPDATE public.auto_campaigns SET note = $3
        WHERE id = $1 AND status = 'tạm dừng' AND note = $2 RETURNING *`, [id, expected, note])),
      createCampaignDetail: async action => { facadeCalls.push(['createCampaignDetail', action]); throw new Error('bộ cũ ghi thẳng lịch sử') },
      getErrorPolicy: async () => null,
      // Hạn mức đăng nhóm còn lại cho số nhóm chia sẻ kèm (resolveGroupPostShareQuotaCapacity): đọc lượt engine đã giữ chỗ hôm nay.
      getAccountRateLimitStatus: async (accountId, actionCode) => {
        const used = await one(`SELECT coalesce(max(count_action_in_day), 0)::int AS n FROM public.auto_account_action_status
          WHERE account_id = $1 AND action_code = $2 AND count_date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`, [accountId, actionCode])
        return { ok: true, dailyLimit: 30, dailyActionCount: used.n, windowLimit: 9, windowActionCount: used.n }
      },
      // Bộ cũ ghi ghi chú "Đăng bài dạng chia sẻ" cho nhóm đã chia sẻ (finishGroupPostShareTarget).
      updateCampaignInputData: async (id, patch) => {
        facadeCalls.push(['updateCampaignInputData', id, patch])
        await db.query(`UPDATE public.auto_campaign_input_data SET status = coalesce($2, status), note = $3 WHERE id = $1`,
          [id, patch.status ?? null, patch.note ?? null])
        return null
      },
      listCampaignDetailsByInputData: async inputDataId => (await db.query(`SELECT * FROM public.auto_campaign_details WHERE input_data_id = $1`,
        [inputDataId])).rows.map(r => ({ campaignId: Number(r.campaign_id), actionName: r.action_name, status: r.status, data: r.data })),
      listCampaignDetailsByCampaign: async campaignId => (await db.query(`SELECT * FROM public.auto_campaign_details WHERE campaign_id = $1`,
        [campaignId])).rows.map(r => ({ campaignId: Number(r.campaign_id), actionName: r.action_name, status: r.status, data: r.data })),
      // Như RPC aka_agent_set_desktop_campaign_status_v2 (nút Tạm dừng): đổi trạng thái chiến dịch đã nhả lượt.
      setDesktopCampaignStatusV2: async (id, _accountId, status) => (await one(`UPDATE public.auto_campaigns SET status = $2
        WHERE id = $1 AND status IS DISTINCT FROM $2 RETURNING id`, [id, status])) ? { ok: true } : { ok: false, reason: 'already_target' }
    }, { get(target, key) { if (key in target) return target[key]; return async (...args) => { facadeCalls.push([String(key), args]); return null } } })

    const Scheduler = mod.CampaignScheduler
    const mainWindow = { webContents: { send() {} }, isDestroyed: () => false }
    const webviewRegistry = { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null }
    const scheduler = new Scheduler(facade, webviewRegistry, mainWindow, undefined, undefined, undefined, { runtimeTarget: 'desktop' })
    scheduler.running = true
    let page = null
    scheduler.backgroundPages = { getOrCreate: () => page, destroy: () => page?.destroy(), destroyAll() {}, createTemporary() { return { page } } }
    Object.assign(scheduler, { startBackgroundPreview() {}, stopBackgroundPreview() {}, selectAutomationBrowser() {}, broadcastCampaignUpdate() {} })

    let nextId = 990000
    const makeCampaign = async ({ targets = 1, extra = {}, actionId = 'facebook_group_post', scheduleType = 'daily' } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`,
        [account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
          content, extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, 'Đăng nhóm Desktop', $6, $2, 'chờ xử lý', now() - interval '1 minute', false,
          $3, $4, $7, 'Nội dung', $5)`, [campaign, account, STAFF, ORG, JSON.stringify({ enableComment: true, commentCount: 2, ...extra }), actionId, scheduleType])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Nhóm ${i + 1}`, `g${i + 1}`])
        ids.push(id)
      }
      const accountObj = { id: account, name: 'FB', flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: STAFF,
        organizationId: ORG, accountGroupSettings: { sleepBetweenActions: 0 } }
      return { account: accountObj, campaign: await facade.getCampaign(campaign), ids }
    }
    const run = async (entry, scenario = {}) => {
      page = new FakePage(scenario)
      progress.length = 0
      const result = await scheduler.engineRunner.run(entry.account, entry.campaign)
      assert.notEqual(result?.reason, 'error', JSON.stringify(result))
      return { result, page }
    }
    const details = async campaign => (await db.query(`SELECT input_data_id, action_code, status, log, post_url, result_key, data
      FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [campaign])).rows
    const inputs = async campaign => (await db.query(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`,
      [campaign])).rows
    const marks = async campaign => (await db.query(`SELECT marks FROM public.auto_engine_target_runs WHERE campaign_id = $1 ORDER BY id`, [campaign]))
      .rows.flatMap(r => r.marks)
    const outcomes = async campaign => (await db.query(`SELECT result_key, action_code, phase, ok, error_code, delivery_state, signal
      FROM public.auto_engine_outcomes WHERE campaign_id = $1 ORDER BY created_at, result_key`, [campaign])).rows

    await check('chọn bộ chạy: tổ chức bật + có workflow cho engine → engine (kể cả đăng nhóm kèm chia sẻ, tìm data)', async () => {
      const { mod: repo } = { mod: null }
      void repo
      const entry = await makeCampaign()
      // Lần đầu danh mục chưa nạp: catalog_loading (bộ lập lịch chờ lượt quét sau, không chạy bộ cũ; thử thật 17/11), nạp nền.
      let support = scheduler.engineRunner.support(entry.account, entry.campaign)
      if (!support.ok) {
        assert.equal(support.reason, 'catalog_loading')
        await new Promise(resolve => setTimeout(resolve, 300))
        support = scheduler.engineRunner.support(entry.account, entry.campaign)
      }
      assert.equal(support.ok, true, JSON.stringify(support))
      const share = await makeCampaign({ extra: { enableGroupPostShareToJoinedGroups: true } })
      assert.deepEqual(scheduler.engineRunner.support(share.account, share.campaign), { ok: true })
      const find = await makeCampaign({ actionId: 'facebook_find_data_group', targets: 0, extra: {} })
      assert.deepEqual(scheduler.engineRunner.support(find.account, find.campaign), { ok: true })
      globalThis.__fbTest.user.facebookEngineV2 = false
      assert.deepEqual(scheduler.engineRunner.support(entry.account, entry.campaign), { ok: false, reason: 'org_flag_off' })
      globalThis.__fbTest.user.facebookEngineV2 = true
    })

    await check('đăng nhóm + 2 comment: ghi dấu trước cú bấm, dòng lịch sử như bộ cũ (post_url, câu), data hoàn thành, không ghi thẳng DB', async () => {
      const entry = await makeCampaign()
      const { result, page: fake } = await run(entry)
      assert.equal(result.reason, 'no_target', JSON.stringify(result))
      assert.equal(result.targets, 1)
      const rows = await details(entry.campaign.id)
      assert.deepEqual(rows.map(r => [r.action_code, r.status]), [['fb_post_group', 'thành công'], ['fb_comment', 'thành công'], ['fb_comment', 'thành công']])
      assert.equal(rows[0].log, 'Đăng bài thành công vào Nhóm 1')
      assert.equal(rows[0].post_url, 'https://www.facebook.com/groups/g1/posts/7123/')
      assert.match(rows[1].log, /^Đã comment vào/)
      assert.ok(rows.every(r => r.result_key.startsWith('v2:')), 'mọi dòng có khoá engine')
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
      assert.ok((await marks(entry.campaign.id)).every(m => m.state === 'delivered'), JSON.stringify(await marks(entry.campaign.id)))
      assert.equal(facadeCalls.filter(c => c[0] === 'createCampaignDetail').length, 0)
      assert.ok(progress.some(p => p.startsWith('📝 Đăng bài thành công vào "Nhóm 1"')), progress.join('\n'))
      assert.ok(progress.some(p => p.startsWith('🔗 Link bài post: https://www.facebook.com/groups/g1/posts/7123/')))
      assert.ok(progress.filter(p => p.startsWith('💬 Đã comment vào')).length === 2)
      assert.deepEqual(fake.clicks.filter(c => c === ELEMENTS.fb_post_button).length, 1)
      const run0 = globalThis.__fbTest.runs.at(-1)
      assert.ok(run0.variables.engineTargetRunId > 0, 'mã lượt engine trong auto_runs.variables')
      const runId = String(globalThis.__fbTest.runs.length)
      assert.ok(rows.every(r => String(r.data?.runId) === runId), `mọi dòng lịch sử mang mã lượt workflow (R1): ${JSON.stringify(rows.map(r => r.data?.runId))}`)
    })

    await check('không mở được ô đăng bài (actionResult not_committed): chưa ghi dấu, chưa bấm, kết quả lỗi trước khi gửi', async () => {
      const entry = await makeCampaign()
      const { page: fake } = await run(entry, { missing: [ELEMENTS.fb_composer_button] })
      const out = await outcomes(entry.campaign.id)
      assert.equal(out.length, 1, JSON.stringify(out))
      assert.equal(out[0].action_code, 'fb_post_group'); assert.equal(out[0].phase, 'before_send')
      assert.equal(out[0].error_code, 'err_fb_group_composer_editor_not_found')
      assert.equal((await marks(entry.campaign.id)).length, 0, 'không ghi dấu khi chưa tới cú bấm')
      assert.equal(fake.clicks.length, 0)
      // V559: FB40 như bộ cũ (override "bỏ qua", data hoàn thành).
      assert.deepEqual((await details(entry.campaign.id)).map(r => [r.action_code, r.status]), [['fb_post_group', 'bỏ qua']])
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
    })

    await check('dấu hiệu (anh chốt 17/11): nhóm hiện "Bạn hiện không xem được nội dung này" thì FB14 thay FB40, xử lý y FB40 (bỏ qua, không đếm)', async () => {
      const entry = await makeCampaign()
      const { page: fake } = await run(entry, { missing: [ELEMENTS.fb_composer_button], pageTexts: ['Nhóm Riêng tư', 'Bạn hiện không xem được nội dung này'] })
      const out = await outcomes(entry.campaign.id)
      assert.deepEqual(out.map(o => [o.action_code, o.phase, o.error_code]), [['fb_post_group', 'before_send', 'err_fb_group_cannot_post_unavailable']])
      assert.deepEqual((await details(entry.campaign.id)).map(r => [r.action_code, r.status, r.log]), [['fb_post_group', 'bỏ qua', 'Nhóm không tồn tại (FB14)']])
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
      assert.equal(fake.pageSignReads, 1, 'đọc chữ trên trang đúng một lần, ngay sau block lỗi')
      assert.equal(fake.clicks.length, 0)
      // Trang không có chữ đó: như hôm nay (FB40).
      const plain = await makeCampaign()
      await run(plain, { missing: [ELEMENTS.fb_composer_button], pageTexts: ['Nhóm Riêng tư', 'Bạn viết gì đi...'] })
      assert.deepEqual((await outcomes(plain.campaign.id)).map(o => o.error_code), ['err_fb_group_composer_editor_not_found'])
    })

    await check('dấu hiệu V563: nhóm chưa tham gia (nút "Tham gia nhóm", chữ thật 17/11) thì FB11 thay FB40, xử lý y FB40 (bỏ qua, không đếm)', async () => {
      const entry = await makeCampaign()
      const { page: fake } = await run(entry, { missing: [ELEMENTS.fb_composer_button],
        pageTexts: ['Nhóm A', 'Tham gia nhóm', 'Xem các nhóm đề xuất', 'Tìm kiếm trong nhóm này'] })
      const out = await outcomes(entry.campaign.id)
      assert.deepEqual(out.map(o => [o.action_code, o.phase, o.error_code]), [['fb_post_group', 'before_send', 'err_fb_group_cannot_post_not_member']])
      assert.deepEqual((await details(entry.campaign.id)).map(r => [r.action_code, r.status, r.log]),
        [['fb_post_group', 'bỏ qua', 'Tài khoản chưa vào nhóm này nên chưa đăng bài được (FB11)']])
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
      assert.equal(fake.pageSignReads, 1, 'đọc chữ trên trang đúng một lần, ngay sau block lỗi')
      assert.equal(fake.clicks.length, 0)
    })

    await check('V563: đăng nhóm xong chưa lấy được link thì bỏ comment "bài của mình", khách thấy câu ⚠️, không dòng lịch sử; có link thì comment như cũ', async () => {
      const workflows = globalThis.__fbTest.workflows
      const original = workflows.get(WORKFLOW_ID)
      workflows.set(WORKFLOW_ID, adjustWorkflow())
      try {
        const warn = `⚠️ ${V563.OWN_POST_SKIP_MESSAGE} tại "Nhóm 1"`
        const none = await makeCampaign({ extra: { commentType: 'own' } })
        const a = await run(none, { postLink: '' })
        assert.deepEqual((await details(none.campaign.id)).map(r => [r.action_code, r.status]), [['fb_post_group', 'thành công']])
        assert.ok(progress.includes(warn), progress.join('\n'))
        assert.equal(progress.filter(p => p.startsWith('💬')).length, 0)
        assert.equal(a.page.clicks.filter(c => c === ELEMENTS.fb_comment_box).length, 0, 'không bấm ô bình luận nào')
        assert.equal((await inputs(none.campaign.id))[0].status, 'hoàn thành')
        assert.ok((await marks(none.campaign.id)).every(m => m.state === 'delivered'), JSON.stringify(await marks(none.campaign.id)))

        const all = await makeCampaign({ extra: { commentType: 'all', commentCount: 2 } })
        const b = await run(all, { postLink: '' })
        assert.deepEqual((await details(all.campaign.id)).map(r => [r.action_code, r.status]),
          [['fb_post_group', 'thành công'], ['fb_comment', 'thành công']], '"comment tất cả": còn lượt bài khác')
        assert.ok(progress.includes(warn), progress.join('\n'))
        assert.equal(b.page.clicks.filter(c => c === ELEMENTS.fb_comment_box).length, 1)

        const link = await makeCampaign({ extra: { commentType: 'own' } })
        await run(link, { postLink: 'https://www.facebook.com/groups/g1/posts/7123/' })
        assert.deepEqual((await details(link.campaign.id)).map(r => [r.action_code, r.status]), [['fb_post_group', 'thành công'], ['fb_comment', 'thành công']])
        assert.ok(!progress.includes(warn), progress.join('\n'))
        assert.ok(progress.includes('💬 Đã comment vào bài của mình tại "Nhóm 1"'), progress.join('\n'))
      } finally {
        workflows.set(WORKFLOW_ID, original)
      }
    })

    await check('dấu hiệu (anh chốt 17/11): block báo không có ô chọn ảnh trước khi đăng thì FB38, xử lý y FB44 (ghi "lỗi", cộng chuỗi)', async () => {
      const entry = await makeCampaign()
      const { page: fake } = await run(entry, { typeError: 'Cần đúng 1 input file trong form đăng bài, tìm thấy 0' })
      const out = await outcomes(entry.campaign.id)
      assert.deepEqual(out.map(o => [o.phase, o.error_code]), [['before_send', 'err_fb_upload_form_changed']])
      assert.deepEqual((await details(entry.campaign.id)).map(r => [r.status, r.log]), [['lỗi', 'Không thấy chỗ tải ảnh hoặc video lên Facebook (FB38)']])
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
      assert.ok(!fake.clicks.includes(ELEMENTS.fb_post_button), 'chưa bấm nút Đăng')
      assert.equal(fake.pageSignReads ?? 0, 0, 'block lỗi không mã: không dấu hiệu trang nào dùng được nên không đọc trang')
      // Câu lỗi khác của cùng block: như hôm nay.
      const other = await makeCampaign()
      await run(other, { typeError: 'Cần đúng 1 input file trong form đăng bài, tìm thấy 2' })
      assert.deepEqual((await outcomes(other.campaign.id)).map(o => o.error_code), ['err_undefined'])
    })

    await check('cú bấm đăng không tìm thấy nút (mức 2): dấu giải quyết "chưa gửi" theo vết thao tác, tín hiệu click:fb_post_button', async () => {
      const entry = await makeCampaign()
      await run(entry, { notFound: [ELEMENTS.fb_post_button] })
      const out = await outcomes(entry.campaign.id)
      const post = out.find(o => o.action_code === 'fb_post_group')
      assert.ok(post, JSON.stringify(out))
      assert.equal(post.phase, 'before_send', JSON.stringify(post))
      assert.equal(post.delivery_state, 'not_delivered')
      assert.equal((await outcomes(entry.campaign.id)).length, 1, 'bước lỗi chỉ có một kết quả')
      assert.equal(post.signal.code, 'click:fb_post_button')
      assert.equal(String(post.signal.runId), String(globalThis.__fbTest.runs.length), 'tín hiệu lỗi mang mã lượt workflow (R1)')
      assert.ok(Array.isArray(post.signal.trace?.ops) && post.signal.trace.ops.length > 0, 'giữ vết thao tác')
      assert.match(String(post.signal.screenshotId), /^[0-9a-f-]{36}$/, 'có mã ảnh lỗi')
      const day = new Date().toISOString().slice(0, 10)
      const meta = JSON.parse(fs.readFileSync(path.join(userData, 'local-data', 'engine-screenshots', day, `${post.signal.screenshotId}.json`), 'utf8'))
      assert.equal(meta.code, 'click:fb_post_button'); assert.equal(meta.campaignId, entry.campaign.id)
      const detail = (await details(entry.campaign.id)).find(r => r.action_code === 'fb_post_group')
      // V559: FB44 như lỗi không xác định của bộ cũ: ghi "lỗi" (câu có mã), data hoàn thành; vết thao tác không vào lịch sử khách xem.
      assert.equal((await one(`SELECT error_code FROM public.auto_engine_outcomes WHERE campaign_id = $1 AND NOT ok`, [entry.campaign.id])).error_code,
        'err_engine_fb_ui_not_ready')
      assert.ok(detail, 'có dòng lịch sử'); assert.equal(detail.status, 'lỗi'); assert.match(detail.log, /\(FB44\)$/)
      assert.equal(detail.data?.signal?.trace, undefined, 'vết không vào lịch sử khách xem')
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
      assert.ok((await marks(entry.campaign.id)).every(m => m.state === 'not_delivered'))
    })

    await check('bấm đăng rồi script lỗi (mức 2): không rõ kết quả, data đóng, không gửi lại', async () => {
      const entry = await makeCampaign()
      await run(entry, { failAfterClick: ELEMENTS.fb_post_button })
      const post = (await outcomes(entry.campaign.id)).find(o => o.action_code === 'fb_post_group')
      assert.equal(post.phase, 'in_flight', JSON.stringify(post)); assert.equal(post.delivery_state, 'unknown')
      assert.equal(post.error_code, 'err_undefined', 'sau mốc gửi không có luật riêng: như bộ cũ (SYS99)')
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
    })

    await check('form đăng bài không đóng sau khi bấm: dòng "lỗi" của bộ cũ giải quyết dấu của cú bấm (không báo hai kết quả)', async () => {
      const entry = await makeCampaign()
      await run(entry, { formClosed: false })
      const out = (await outcomes(entry.campaign.id)).filter(o => o.action_code === 'fb_post_group')
      assert.equal(out.length, 1, JSON.stringify(out))
      assert.equal(out[0].phase, 'in_flight')
      assert.ok((await marks(entry.campaign.id)).every(m => m.state !== 'pending'))
      // Bộ dựng cũ ghi dòng "lỗi" kèm mã đoán theo câu lỗi (normalizeRuntimeError → err_undefined): engine dùng thẳng mã đó, như bộ cũ.
      assert.equal(out[0].error_code, 'err_undefined')
      const row = (await details(entry.campaign.id)).find(r => r.action_code === 'fb_post_group')
      assert.equal(row.status, 'lỗi'); assert.match(row.log, /\(SYS99\)$/)
    })

    await check('checkpoint lúc bấm comment: tín hiệu fb_checkpoint (FB04)', async () => {
      const entry = await makeCampaign()
      await run(entry, { checkpointAfterClick: ELEMENTS.fb_comment_box })
      const comment = (await outcomes(entry.campaign.id)).find(o => o.action_code === 'fb_comment' && !o.ok)
      assert.ok(comment, JSON.stringify(await outcomes(entry.campaign.id)))
      assert.equal(comment.signal.code, 'fb_checkpoint')
      // V559 (Q6): FB04 chỉ đổi trạng thái đăng nhập, không khoá thao tác, không tạm dừng tài khoản.
      assert.equal(comment.error_code, 'err_fb_checkpoint')
      const acc = await one('SELECT login_status, status FROM public.auto_accounts WHERE id = $1', [entry.account.id])
      assert.equal(acc.login_status, 'checkpoint'); assert.notEqual(acc.status, 'tạm dừng')
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable`, [entry.account.id])).n, 0)
    })

    await check('block treo: quá ngưỡng không thao tác thì đóng cửa sổ ẩn, mốc không rõ kết quả (SYS04), lượt kết thúc', async () => {
      globalThis.__fbTest.runtimeSettings = { blockHangMinutes: 0.02 }
      try {
        const entry = await makeCampaign()
        const { page: fake } = await run(entry, { hangOn: ELEMENTS.fb_comment_box })
        assert.equal(fake.destroyed, true)
        const comment = (await outcomes(entry.campaign.id)).find(o => o.action_code === 'fb_comment' && !o.ok)
        assert.ok(comment, JSON.stringify(await outcomes(entry.campaign.id)))
        assert.equal(comment.signal.code, 'block_hang'); assert.equal(comment.phase, 'in_flight')
        assert.equal(comment.error_code, 'err_engine_unknown_delivery', 'Q20: treo sau dấu "sắp gửi" là không rõ kết quả')
        assert.ok(progress.some(p => p.includes('không phản hồi quá')), progress.join('\n'))
      } finally {
        globalThis.__fbTest.runtimeSettings = null
      }
    })

    await check('như bộ cũ: 4 data liền không thấy nút đăng (FB44, cộng chuỗi) thì tạm dừng chiến dịch, data đều hoàn thành', async () => {
      const entry = await makeCampaign({ targets: 5 })
      await run(entry, { notFound: [ELEMENTS.fb_post_button] })
      const campaign = await facade.getCampaign(entry.campaign.id)
      assert.equal(campaign.status, 'tạm dừng', JSON.stringify({ status: campaign.status, note: campaign.note }))
      // Câu anh duyệt 17/11: câu lỗi (mã) + bước tiếp theo của mã FB nối sau câu dừng theo chuỗi.
      assert.equal(String(campaign.note), 'Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): Không thấy nút hoặc ô cần bấm trên Facebook (FB44). Mở tab trình duyệt của tài khoản để kiểm tra.')
      const all = await inputs(entry.campaign.id)
      assert.deepEqual(all.map(r => r.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành', 'chờ xử lý'])
    })

    await check('Q11: dừng theo chuỗi lỗi SYS99 thì AI đọc ảnh lỗi viết câu dừng như bộ cũ; AI không trả câu thì giữ câu của DB', async () => {
      const calls = []
      globalThis.__fbTest.ai = async (code, variables, context) => {
        calls.push({ code, variables, context })
        return { ok: true, content: '"Facebook hiện hộp thoại yêu cầu xác nhận trước khi đăng bài."' }
      }
      try {
        const entry = await makeCampaign({ targets: 5 })
        await run(entry, { failAfterClick: ELEMENTS.fb_post_button })
        const campaign = await facade.getCampaign(entry.campaign.id)
        assert.equal(campaign.status, 'tạm dừng', JSON.stringify({ status: campaign.status, note: campaign.note }))
        assert.equal(campaign.note, 'Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): Facebook hiện hộp thoại yêu cầu xác nhận trước khi đăng bài. (SYS99)')
        assert.equal(calls.length, 1, 'gọi AI một lần, lúc chiến dịch dừng')
        assert.equal(calls[0].code, 'campaign_error_screenshot_diagnosis')
        assert.match(calls[0].variables.imageDataUrl, /^data:image\/jpeg;base64,/)
        assert.equal(calls[0].context.campaignId, entry.campaign.id)
        assert.ok(progress.some(line => line.includes('Facebook hiện hộp thoại yêu cầu xác nhận trước khi đăng bài.')), progress.join('\n'))
        // AI không trả câu: giữ câu của DB.
        globalThis.__fbTest.ai = async () => ({ ok: false, error: 'AI quá hạn' })
        const second = await makeCampaign({ targets: 5 })
        await run(second, { failAfterClick: ELEMENTS.fb_post_button })
        const kept = await facade.getCampaign(second.campaign.id)
        assert.equal(kept.status, 'tạm dừng')
        assert.match(String(kept.note), /^Dừng sau 4 data lỗi\/thất bại liên tiếp \(ngưỡng 4\): .+\(SYS99\)$/)
        assert.ok(!String(kept.note).includes('hộp thoại'))
        // Dừng theo chuỗi FB44 (không phải SYS99): không gọi AI (anh chốt 17/11 chỉ SYS99).
        calls.length = 0
        globalThis.__fbTest.ai = async (code, variables, context) => { calls.push({ code }); return { ok: true, content: 'không được dùng' } }
        const third = await makeCampaign({ targets: 5 })
        await run(third, { notFound: [ELEMENTS.fb_post_button] })
        assert.equal(calls.length, 0)
        assert.equal((await facade.getCampaign(third.campaign.id)).note,
          'Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): Không thấy nút hoặc ô cần bấm trên Facebook (FB44). Mở tab trình duyệt của tài khoản để kiểm tra.')
      } finally {
        globalThis.__fbTest.ai = null
      }
    })

    await check('Q21: đến lịch quá 10 phút mà chưa chạy được thì ghi lý do một lần (đổi lý do mới ghi lại); chưa tới 10 phút thì chưa ghi', async () => {
      const late = await makeCampaign()
      const early = await makeCampaign()
      await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '15 minutes' WHERE id = $1`, [late.campaign.id])
      await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '5 minutes' WHERE id = $1`, [early.campaign.id])
      const nowIso = (await one('SELECT now() AS n')).n.toISOString()
      const load = async () => [await facade.getCampaign(late.campaign.id), await facade.getCampaign(early.campaign.id)]
      progress.length = 0
      await scheduler.noteOverdueCampaignWaits(await load(), 'Tài khoản chưa mở tab trình duyệt', nowIso)
      assert.equal((await facade.getCampaign(late.campaign.id)).note, 'Tài khoản chưa mở tab trình duyệt')
      assert.equal((await facade.getCampaign(early.campaign.id)).note, null)
      assert.deepEqual(progress, ['⚠️ Chưa thể chạy chiến dịch: Tài khoản chưa mở tab trình duyệt'])
      await scheduler.noteOverdueCampaignWaits(await load(), 'Tài khoản chưa mở tab trình duyệt', nowIso)
      assert.equal(progress.length, 1, 'lý do không đổi thì không ghi lại')
      await scheduler.noteOverdueCampaignWaits(await load(), 'Tài khoản chưa đăng nhập', nowIso)
      assert.equal((await facade.getCampaign(late.campaign.id)).note, 'Tài khoản chưa đăng nhập')
      assert.equal(progress.length, 2)
    })

    await check('tạm dừng giữa data (Q2): dừng trước comment kế tiếp, data đã đăng thì hoàn thành, data sau không chạy', async () => {
      const entry = await makeCampaign({ targets: 2 })
      let paused = false
      const host = scheduler.engineRunner.host
      const original = host.isPauseRequested
      host.isPauseRequested = id => paused && id === entry.campaign.id
      try {
        const { page: fake } = await run(entry, { onClick: sel => { if (sel === ELEMENTS.fb_comment_box) paused = true } })
        const rows = await details(entry.campaign.id)
        assert.deepEqual(rows.map(r => r.action_code), ['fb_post_group', 'fb_comment'], JSON.stringify(rows))
        assert.equal(fake.clicks.filter(c => c === ELEMENTS.fb_comment_box).length, 1, 'comment thứ hai không chạy')
        const all = await inputs(entry.campaign.id)
        assert.equal(all[0].status, 'hoàn thành'); assert.equal(all[1].status, 'chờ xử lý')
        assert.equal((await facade.getCampaign(entry.campaign.id)).status, 'tạm dừng', 'chiến dịch về tạm dừng sau khi nhả lượt')
        assert.ok(progress.some(p => p.startsWith('⏸ Chiến dịch')), progress.join('\n'))
      } finally {
        host.isPauseRequested = original
      }
    })

    await check('đăng trang cá nhân (lượt theo lịch, không có dòng data): một lượt cho mốc lịch, dòng lịch sử như bộ cũ, mốc đã chạy không chạy lại', async () => {
      const entry = await makeCampaign({ targets: 0, actionId: 'facebook_timeline_post', extra: { enableComment: false } })
      const { result, page: fake } = await run(entry)
      assert.equal(result.targets, 1, JSON.stringify(result))
      const rows = await details(entry.campaign.id)
      assert.deepEqual(rows.map(r => [r.input_data_id, r.action_code, r.status, r.log]), [[null, 'fb_post_my_profile', 'thành công', 'Đăng bài thành công']])
      const runs = (await db.query(`SELECT input_data_id, slot_at, completed_at, marks FROM public.auto_engine_target_runs WHERE campaign_id = $1`,
        [entry.campaign.id])).rows
      assert.equal(runs.length, 1); assert.equal(runs[0].input_data_id, null); assert.ok(runs[0].slot_at); assert.ok(runs[0].completed_at)
      assert.deepEqual(runs[0].marks.map(m => [m.actionCode, m.state]), [['fb_post_my_profile', 'delivered']])
      assert.equal(fake.clicks.filter(c => c === ELEMENTS.fb_post_button).length, 1)
      assert.ok(progress.some(p => p.startsWith('📝 Đăng bài thành công')), progress.join('\n'))
      const after = await facade.getCampaign(entry.campaign.id)
      // Như handleCampaignCompletion của bộ cũ: không nhiều khung giờ / không chạy lại sau N giờ thì hoàn thành sau lượt.
      assert.equal(after.status, 'hoàn thành', JSON.stringify({ status: after.status, schedule: after.schedule, note: after.note }))
      // Chạy lại ngay: mốc lịch cũ đã chạy (hoặc lịch đã sang mốc kế tiếp chưa tới) thì không đăng lần hai.
      const again = await run({ ...entry, campaign: after })
      assert.equal(again.result.targets, 0, JSON.stringify(again.result))
      assert.equal((await details(entry.campaign.id)).length, 1)
    })

    await check('newsfeed chỉ lướt (không like / comment, không có thao tác): chạy workflow, chốt im lặng FB45, không ghi lịch sử, không bỏ lượt mở', async () => {
      const entry = await makeCampaign({ targets: 0, actionId: 'facebook_newsfeed_interaction',
        extra: { enablePostLike: false, newsfeedLikeLimit: 0, enableComment: false, newsfeedCommentLimit: 0, newsfeedTimeMinutes: 1 } })
      assert.deepEqual(scheduler.engineRunner.support(entry.account, entry.campaign), { ok: true })
      const { result } = await run(entry)
      assert.equal(result.targets, 1, JSON.stringify(result))
      assert.equal((await details(entry.campaign.id)).length, 0)
      const runs = (await db.query(`SELECT slot_at, completed_at, final_error_code FROM public.auto_engine_target_runs WHERE campaign_id = $1`,
        [entry.campaign.id])).rows
      assert.equal(runs.length, 1); assert.ok(runs[0].slot_at); assert.ok(runs[0].completed_at, 'lượt đã chốt, không để mở')
      assert.deepEqual((await outcomes(entry.campaign.id)).map(o => [o.action_code, o.error_code]), [['', 'err_engine_fb_no_history']])
      assert.equal((await facade.getCampaign(entry.campaign.id)).status, 'hoàn thành')
    })

    await check('mời vào nhóm theo lô: block nhận đủ biến của bộ cũ (lô một người), trả 3 kết quả cho cùng data → 3 dòng lịch sử đúng trạng thái, dấu gửi được giải, data hoàn thành; thiếu group nhận lời mời → lỗi cấu hình', async () => {
      const entry = await makeCampaign({ actionId: 'facebook_group_invite', extra: { ...INVITE_GROUP } })
      const { result } = await run(entry)
      assert.equal(result.targets, 1, JSON.stringify(result))
      const rows = await details(entry.campaign.id)
      // Như processFacebookGroupInviteOutput của bộ cũ: "selected" + gửi được = thành công (câu tự dựng), câu của block giữ nguyên.
      assert.deepEqual(rows.map(r => [r.action_code, r.status, r.log.replace(/ \([A-Z]+[0-9]+\)$/, '')]), [
        ['fb_group_invite', 'thành công', 'Đã gửi lời mời vào group "Nhóm thử" cho "Nhóm 1"'],
        // Dòng lỗi: câu đã duyệt của SYS99 (Q23) như mọi dòng lỗi của engine; câu của block giữ trong data.signal.message.
        ['fb_group_invite', 'đã là thành viên', 'Đã là thành viên của group'], ['fb_group_invite', 'lỗi', 'Có lỗi xảy ra']])
      assert.equal(new Set(rows.map(r => r.result_key)).size, 3, 'mỗi kết quả một khoá')
      // Dấu gửi được giải ở dòng đầu. Data hoàn thành, không gửi lại (chính sách của cả ba trạng thái đều hoàn thành data).
      assert.deepEqual((await marks(entry.campaign.id)).map(m => [m.actionCode, m.state !== 'pending']), [['fb_group_invite', true]])
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
      // Bấm gửi lỗi mà người này đã được chọn: như bộ cũ, data về hàng đợi, không ghi dòng.
      const submitFail = await makeCampaign({ actionId: 'facebook_group_invite', extra: { ...INVITE_GROUP, facebookGroupInviteTargetGroupName: 'Nhóm thử gửi lỗi' } })
      await run(submitFail)
      assert.equal((await details(submitFail.campaign.id)).length, 0)
      assert.equal((await inputs(submitFail.campaign.id))[0].status, 'chờ xử lý')
      // Block không trả kết quả cho data: như bộ cũ ghi dòng "lỗi" (bộ cũ còn tạm dừng ngay; engine dừng theo chuỗi lỗi).
      const empty = await makeCampaign({ actionId: 'facebook_group_invite', extra: { ...INVITE_GROUP, facebookGroupInviteTargetGroupName: 'Nhóm thử trống' } })
      await run(empty)
      assert.deepEqual((await details(empty.campaign.id)).map(r => [r.action_code, r.status]), [['fb_group_invite', 'lỗi']])
      // Thiếu group nhận lời mời: lỗi cấu hình như bộ cũ (câu của bộ cũ), không chạy data nào.
      const noGroup = await makeCampaign({ actionId: 'facebook_group_invite', extra: {} })
      const second = await run(noGroup)
      assert.equal(second.result.reason, 'config_invalid', JSON.stringify(second.result))
      assert.equal((await details(noGroup.campaign.id)).length, 0)
      assert.equal((await inputs(noGroup.campaign.id))[0].status, 'chờ xử lý')
      const noted = (await db.query('SELECT note FROM public.auto_campaigns WHERE id = $1', [noGroup.campaign.id])).rows[0]
      // Ghi chú theo câu đã duyệt của CFG02 như mọi lỗi cấu hình của engine (bộ cũ ghi câu riêng, không dừng chiến dịch).
      assert.match(String(noted.note), /\(CFG02\)/)
    })

    await check('nút "Lý do đang chờ" hiểu engine (R17): tài khoản còn token bộ cũ → câu chờ lượt trước; chạy được rồi thì quên', async () => {
      const entry = await makeCampaign()
      await db.query('UPDATE public.auto_accounts SET runtime_operation_claim_token = gen_random_uuid() WHERE id = $1', [entry.account.id])
      const first = await run(entry)
      assert.equal(first.result.reason, 'legacy_busy', JSON.stringify(first.result))
      scheduler.observeEngineResult(entry.account, entry.campaign, first.result)
      const runtime = scheduler.getDiagnosticRuntime(new AbortController().signal)
      assert.match(String(runtime.engineReason(entry.account, entry.campaign)), /lượt chạy hoặc tác vụ trước chưa kết thúc/)
      assert.equal(runtime.engineReason({ ...entry.account, id: entry.account.id + 100000 }, entry.campaign), null, 'chỉ đúng tài khoản đã quan sát')
      await db.query('UPDATE public.auto_accounts SET runtime_operation_claim_token = NULL WHERE id = $1', [entry.account.id])
      const second = await run(entry)
      assert.equal(second.result.targets, 1, JSON.stringify(second.result))
      scheduler.observeEngineResult(entry.account, entry.campaign, second.result)
      assert.equal(runtime.engineReason(entry.account, entry.campaign), null, 'chạy được rồi thì không còn câu chờ')
    })

    const detailsOf = async inputDataId => (await db.query(`SELECT input_data_id, action_code, action_name, status, log, data, result_key
      FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [inputDataId])).rows
    const shareRuns = async (campaign, ids) => (await db.query(`SELECT input_data_id, marks, final_target_status FROM public.auto_engine_target_runs
      WHERE campaign_id = $1 AND input_data_id = ANY($2) ORDER BY id`, [campaign, ids])).rows
    const fbPostCount = async account => (await one(`SELECT coalesce(max(count_action_in_day), 0)::int AS n FROM public.auto_account_action_status
      WHERE account_id = $1 AND action_code = 'fb_post_group'`, [account])).n

    await check('đăng nhóm kèm chia sẻ (như bộ cũ): nhóm đã chọn được nhận vào lượt, ghi dấu trước cú bấm Đăng; mỗi nhóm một dòng "Đăng bài dạng chia sẻ", data nhóm hoàn thành', async () => {
      const entry = await makeCampaign({ targets: 4, extra: { enableGroupPostShareToJoinedGroups: true } })
      const [main, shareA, shareB, last] = entry.ids
      const { result, page: fake } = await run(entry)
      assert.equal(result.targets, 2, JSON.stringify(result))
      const run0 = globalThis.__fbTest.runs.find(r => r.variables?.engineTargetRunId && r.variables.groupPostShareTargets?.length)
      assert.deepEqual(run0.variables.groupPostShareTargets.map(t => t.id), [shareA, shareB, last], 'ứng viên như bộ cũ (tên nhóm không trùng)')
      assert.equal(run0.variables.groupPostShareMaxCount, 3)
      for (const [id, nameOf] of [[shareA, 'Nhóm 2'], [shareB, 'Nhóm 3']]) {
        const rows = await detailsOf(id)
        assert.deepEqual(rows.map(r => [r.action_code, r.action_name, r.status, r.log]), [['fb_post_group', 'Đăng bài', 'thành công', `Đăng bài dạng chia sẻ vào ${nameOf}`]])
        assert.equal(rows[0].data.shareMode, 'group_composer_add_group'); assert.equal(Number(rows[0].data.sharedFromInputDataId), main)
      }
      assert.deepEqual((await detailsOf(main)).map(r => [r.action_code, r.status])[0], ['fb_post_group', 'thành công'])
      const all = await inputs(entry.campaign.id)
      assert.deepEqual(all.map(r => r.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành'])
      assert.deepEqual(all.filter(r => [shareA, shareB].includes(Number(r.id))).map(r => r.note), ['Đăng bài dạng chia sẻ', 'Đăng bài dạng chia sẻ'])
      const runs = await shareRuns(entry.campaign.id, [shareA, shareB])
      assert.equal(runs.length, 2)
      assert.ok(runs.every(r => r.marks.length === 1 && r.marks[0].stepKey === 'share_post' && r.marks[0].state === 'delivered'), JSON.stringify(runs))
      assert.equal(fake.clicks.filter(c => c === ELEMENTS.fb_post_button).length, 2, 'một cú bấm cho data chính + 2 nhóm, một cho data cuối')
      assert.equal(await fbPostCount(entry.account.id), 4, 'tính lượt như bộ cũ: 2 bài chính + 2 nhóm chia sẻ')
      assert.ok(progress.some(p => p === '🔁 Đã chia sẽ bài viết vào nhóm "Nhóm 2"'), progress.join('\n'))
    })

    await check('đăng nhóm kèm chia sẻ, không thấy nút Đăng (chưa bấm): nhóm chia sẻ về hàng đợi, không ghi lịch sử, trả lại lượt', async () => {
      const entry = await makeCampaign({ targets: 3, extra: { enableGroupPostShareToJoinedGroups: true } })
      const [, shareA, shareB] = entry.ids
      await run(entry, { notFound: [ELEMENTS.fb_post_button] })
      const all = await inputs(entry.campaign.id)
      assert.deepEqual(all.map(r => r.status), ['hoàn thành', 'chờ xử lý', 'chờ xử lý'])
      assert.ok(all.slice(1).every(r => /SYS01/.test(String(r.note))), JSON.stringify(all))
      assert.equal((await detailsOf(shareA)).length + (await detailsOf(shareB)).length, 0)
      assert.ok((await shareRuns(entry.campaign.id, [shareA, shareB])).every(r => r.marks[0].state === 'not_delivered'))
      assert.equal(await fbPostCount(entry.account.id), 0)
    })

    await check('đăng nhóm kèm chia sẻ, bấm Đăng rồi không rõ kết quả: nhóm chia sẻ đóng, ghi "không rõ", không đăng lại', async () => {
      const entry = await makeCampaign({ targets: 3, extra: { enableGroupPostShareToJoinedGroups: true } })
      const [, shareA, shareB] = entry.ids
      await run(entry, { failAfterClick: ELEMENTS.fb_post_button })
      const all = await inputs(entry.campaign.id)
      assert.deepEqual(all.map(r => r.status), ['hoàn thành', 'hoàn thành', 'hoàn thành'])
      for (const id of [shareA, shareB]) {
        const out = (await db.query(`SELECT error_code, delivery_state FROM public.auto_engine_outcomes o JOIN public.auto_engine_target_runs r
          ON r.id = o.target_run_id WHERE r.input_data_id = $1`, [id])).rows
        assert.deepEqual(out.map(o => [o.error_code, o.delivery_state]), [['err_engine_unknown_delivery', 'unknown']])
        assert.equal((await detailsOf(id)).length, 1, 'ghi một dòng "không rõ"')
      }
    })

    await check('tìm data trong group (Q5): dòng "Tìm data" không gắn thao tác như bộ cũ, không tính lượt, data hoàn thành', async () => {
      const entry = await makeCampaign({ actionId: 'facebook_find_data_group', targets: 1, extra: { isFindUid: true, isFindInPost: true } })
      const { result } = await run(entry)
      assert.equal(result.targets, 1, JSON.stringify(result))
      const rows = await detailsOf(entry.ids[0])
      assert.equal(rows.length, 1, JSON.stringify(rows))
      assert.deepEqual([rows[0].action_code, rows[0].action_name, rows[0].status], [null, 'Tìm data', 'thành công'])
      assert.deepEqual(rows[0].data.uids, ['100001', '100002'])
      const out = await outcomes(entry.campaign.id)
      assert.deepEqual(out.map(o => [o.action_code, o.ok]), [['', true]])
      assert.equal((await inputs(entry.campaign.id))[0].status, 'hoàn thành')
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_account_action_status WHERE account_id = $1`, [entry.account.id])).n, 0)
      assert.ok(progress.some(p => p.startsWith('✅ ')), progress.join('\n'))
    })

    await check('tìm data lỗi: dòng "lỗi" không gắn thao tác (FB42 theo trạng thái), cộng chuỗi như bộ cũ, data hoàn thành kèm ghi chú', async () => {
      const entry = await makeCampaign({ actionId: 'facebook_find_data_group', targets: 1, extra: {} })
      await run(entry, { missing: [ELEMENTS.fb_group_feed] })
      const rows = await detailsOf(entry.ids[0])
      assert.deepEqual(rows.map(r => [r.action_code, r.action_name, r.status]), [[null, 'Tìm data', 'lỗi']], JSON.stringify(rows))
      assert.match(rows[0].log, /^Lỗi tìm data trong group Nhóm 1/)
      const out = await outcomes(entry.campaign.id)
      assert.deepEqual(out.map(o => o.error_code), ['err_engine_fb_action_failed'])
      const input = (await inputs(entry.campaign.id))[0]
      assert.equal(input.status, 'hoàn thành'); assert.match(String(input.note), /Lỗi tìm data/)
      assert.equal((await one(`SELECT count_consecutive_bad_targets AS n FROM public.auto_campaign_error_state WHERE campaign_id = $1`,
        [entry.campaign.id])).n, 1)
    })

    await check('script tra lỗi (R1): hàm trace_v1 / health_v1 trên kết quả thật của bài này, bản in không lỗi và có vết thao tác, mã ảnh', async () => {
      const { printTrace, printHealth } = require('./trace.cjs')
      const entry = await makeCampaign()
      await run(entry, { notFound: [ELEMENTS.fb_post_button] })
      const trace = (await db.query('SELECT public.aka_agent_engine_trace_v1($1) AS r', [entry.ids[0]])).rows[0].r
      assert.equal(trace.ok, true); assert.equal(trace.runs.length, 1, JSON.stringify(trace))
      const health = (await db.query('SELECT public.aka_agent_engine_health_v1(1) AS r')).rows[0].r
      assert.equal(health.ok, true, JSON.stringify(health))
      const lines = []
      const log = console.log
      console.log = (...parts) => lines.push(parts.join(' '))
      try { printTrace(trace); printHealth(health) } finally { console.log = log }
      const text = lines.join('\n')
      assert.match(text, /=== Lượt data #\d+ · chiến dịch/)
      assert.match(text, /click:fb_post_button/)
      assert.match(text, /vết thao tác \(\d+.*\):/)
      assert.match(text, /ảnh lỗi trên máy khách: [0-9a-f-]{36}/)
      assert.match(text, /Kết quả FB theo mã:/)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
    fs.rmSync(out, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
  console.log(`\n${checks} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
