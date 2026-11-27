#!/usr/bin/env node
// V667: bộ lập lịch App Server THẬT (src/main/services/campaignScheduler.ts, runtimeTarget 'server') + engine v2 trên PostgreSQL cục bộ ở
// trạng thái production + V667 (scripts/fixtures/engine-v2-server/db.cjs). Cổng Zalo giả truyền vào bộ lập lịch như App Server truyền
// ZaloRuntimeService của từng nhân viên; người dùng hiện tại là module thật (AsyncLocalStorage, runWithCurrentUser như App Server); công
// tắc là ServerEngineGate thật đọc RPC thật. Chỉ bộ chạy cũ (executeCampaign) được thay bằng bản ghi lại để biết bộ lập lịch chọn đường nào.
// Kiểm các tình huống riêng của VPS:
//   - bộ lập lịch App Server có bộ chạy engine nơi chạy 'server', không có Facebook / Website; công tắc chưa đọc được thì chờ lượt sau (không
//     chạy bộ cũ); bật thì engine chạy qua đúng hàng đợi của tài khoản (dòng tiến trình qua appendCampaignLog và logSink); tắt thì bộ cũ
//   - bộ cũ còn giữ tài khoản lúc bật công tắc: engine chờ (legacy_busy), không gửi; bộ cũ xong thì engine chạy phần còn lại, không gửi lại
//   - nhiều nhân viên trong một tiến trình: mỗi lượt đúng nhân viên, tổ chức không bật vẫn đi bộ cũ
//   - App Server dừng runtime giữa lượt (như stopRuntime) rồi khởi động lại: chạy tiếp, không gửi trùng
//   - tài khoản "đang chạy" bị sót (sự cố 27/11/2026, staleRunningAccount.ts): lượt quét vẫn đưa chiến dịch engine cho DB nhận lượt, tối
//     đa 2 phút một lần; bộ cũ / tổ chức chưa bật không chạy; DB còn giữ tài khoản thì không gửi
// Chạy: CHAT_REPO=<thư mục có node_modules/pg> LC_ALL=C node scripts/engine-v2-server-runtime-scheduler-smoke.cjs (tự chạy lại dưới Electron)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { AsyncLocalStorage } = require('node:async_hooks')

const ROOT = path.resolve(__dirname, '..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

const { build } = require('esbuild')
const { buildV667Db } = require('./fixtures/engine-v2-server/db.cjs')
const { fakeClient } = require('./engine-v2-facebook/desktop-harness.cjs')
const V667 = require('./build-v667-sql.cjs')

let passed = 0
let failed = 0
let currentDb = null
const crashLease = { leftSeconds: null }
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (e) {
    failed++; console.log(`FAIL ${name}: ${e.stack || e.message}`)
    await currentDb?.query('ROLLBACK').catch(() => {})
  }
}

// ------------------------------------------------------------------ dựng bộ lập lịch thật bằng esbuild
const SRC = rel => path.join(ROOT, rel)
const NOEXT = p => p.replace(/\.(ts|tsx|js)$/, '')
const WRAP_TARGETS = {
  aiwrap: SRC('src/main/services/aiRuntimeService.ts'),
  campaignwrap: SRC('src/main/data/repositories/campaignRepository.ts'),
  errorwrap: SRC('src/main/data/repositories/errorPolicyRepository.ts'),
  engagementwrap: SRC('src/main/services/zaloCampaignEngagement.ts')
}
const STUB_TARGETS = {
  supabaseClient: SRC('src/main/data/supabaseClient.ts'),
  workflowV2Repository: SRC('src/main/data/repositories/workflowV2Repository.ts'),
  blockRepository: SRC('src/main/data/repositories/blockRepository.ts'),
  runV2Repository: SRC('src/main/data/repositories/runV2Repository.ts'),
  elementV2Repository: SRC('src/main/data/repositories/elementV2Repository.ts'),
  facebookPageIdentityRepository: SRC('src/main/data/repositories/facebookPageIdentityRepository.ts')
}
const STUBS = {
  electron: `
const handler = { get(target, key) { if (key === '__esModule') return false; return target[key] ?? (target[key] = new Proxy(function Stub() {}, handler)) },
  apply() { return new Proxy(function Stub() {}, handler) }, construct() { return new Proxy(function Stub() {}, handler) } }
const stub = () => new Proxy(function Stub() {}, handler)
const names = ['BrowserWindow', 'webContents', 'ipcMain', 'powerMonitor', 'session', 'net', 'dialog', 'shell', 'Notification', 'screen',
  'nativeImage', 'clipboard', 'Menu', 'Tray', 'systemPreferences', 'protocol', 'crashReporter', 'nativeTheme', 'safeStorage', 'contentTracing',
  'desktopCapturer', 'globalShortcut', 'inAppPurchase', 'MessageChannelMain', 'powerSaveBlocker', 'utilityProcess', 'WebContentsView', 'BaseWindow']
const electron = { app: { getPath: () => globalThis.__srvTest.userData, getVersion: () => '0.0.0-server-smoke', isPackaged: false, getName: () => 'aka-server-smoke',
  on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => globalThis.__srvTest.userData } }
for (const name of names) electron[name] = stub()
module.exports = electron`,
  // App Server: client service_role (tin cậy), không có phiên Desktop. clientFor: client của "tiến trình" đang chạy (bài kiểm App Server chết
  // dùng client riêng cho tiến trình cũ rồi cắt nó).
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__srvTest.clientFor(), desktopFetch: fetch,
    desktopSession: { clear() {}, matches: () => true }, isTrustedServerSupabaseConfigured: () => true }`,
  workflowV2Repository: `module.exports = { getWorkflow: async () => null, getWorkflowByName: async () => null }`,
  blockRepository: `module.exports = { getBlock: async () => null }`,
  runV2Repository: `module.exports = { createRun: async () => 1, updateRun: async () => {}, createRunStep: async () => 1, updateRunStep: async () => {} }`,
  elementV2Repository: `module.exports = { resolveXpathByName: async name => '//smoke-' + name }`,
  facebookPageIdentityRepository: `module.exports = { validateCampaignPageIdentity: async () => undefined }`,
  aiwrap: `export * from ${JSON.stringify(WRAP_TARGETS.aiwrap)}
export async function callAiUsing() { return { ok: false, error: 'AI không bật khi kiểm' } }`,
  // Như bài kiểm bộ chạy: từ chối nhận tin luôn "chưa từ chối", ghi lại tên / UID tra được vào data.
  campaignwrap: `export * from ${JSON.stringify(WRAP_TARGETS.campaignwrap)}
export async function checkZaloMessageOptOut() { return { isOptedOut: false, matchedBy: null } }
export async function prepareZaloMessageOptOut() { return { id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false } }
export async function updateCampaignInputData(id, updates) { return globalThis.__srvTest.updateInput(id, updates) }`,
  errorwrap: `export * from ${JSON.stringify(WRAP_TARGETS.errorwrap)}
export async function getZaloErrorPolicyByCode() { return null }`,
  engagementwrap: `export * from ${JSON.stringify(WRAP_TARGETS.engagementwrap)}
export function campaignEngagementEnabled() { return false }
export function beginCampaignEngagementSend() { return { revision: '', sentAt: '' } }
export function abandonCampaignEngagementSend() {}
export function stageCampaignEngagementSource() {}
export function recordCampaignEngagementDetail() {}`,
  entry: `export * from ${JSON.stringify(SRC('src/main/services/campaignScheduler.ts'))}
export { mapAccountFromDB, mapCampaignFromDB } from ${JSON.stringify(SRC('src/main/data/mappers.ts'))}
export { serverEngineGate } from ${JSON.stringify(SRC('src/main/engineAdapters/serverEngineGate.ts'))}
export { runWithCurrentUser, getCurrentUser } from ${JSON.stringify(SRC('src/main/data/currentUser.ts'))}`
}

async function loadScheduler() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-server-scheduler-'))
  const outfile = path.join(out, 'scheduler.cjs')
  const byAbs = new Map([...Object.entries(WRAP_TARGETS), ...Object.entries(STUB_TARGETS)].map(([name, file]) => [NOEXT(file), name]))
  await build({
    entryPoints: ['entry'], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', packages: 'external',
    banner: { js: `require = require('node:module').createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});` },
    plugins: [{ name: 'server-scheduler-smoke', setup(plugin) {
      plugin.onResolve({ filter: /^entry$/ }, () => ({ path: 'entry', namespace: 'stub' }))
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
      plugin.onResolve({ filter: /^\.\.?\// }, args => {
        // Bản bọc (namespace stub) nạp module thật bằng đường dẫn tuyệt đối: không chặn lại chính nó.
        if (args.namespace === 'stub') return undefined
        const name = byAbs.get(NOEXT(path.resolve(args.resolveDir, args.path)))
        return name ? { path: name, namespace: 'stub' } : undefined
      })
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
        contents: STUBS[args.path], loader: args.path in WRAP_TARGETS || args.path === 'entry' ? 'ts' : 'js', resolveDir: ROOT }))
    } }]
  })
  return require(outfile)
}

const MIN = 60_000
const ORG = 811        // tổ chức VPS bật công tắc
const ORG_B = 812      // tổ chức VPS bật công tắc (nhân viên thứ hai cùng tiến trình)
const ORG_OFF = 813    // tổ chức VPS chưa bật công tắc
const STAFF = 8111
const STAFF_B = 8121
const STAFF_OFF = 8131
const STAFF_STOP = 8112
const STAFF_CRASH = 8113

/** Nhiều kết nối cho client giả (PostgREST của App Server chạy song song nhiều yêu cầu); mỗi câu lấy một kết nối rảnh. */
function makePool(clients) {
  const idle = [...clients], waiters = []
  const acquire = () => idle.length ? Promise.resolve(idle.pop()) : new Promise(resolve => waiters.push(resolve))
  const release = c => { const w = waiters.shift(); if (w) w(c); else idle.push(c) }
  return { async query(sql, params) { const c = await acquire(); try { return await c.query(sql, params) } finally { release(c) } } }
}

/** Client của một "tiến trình" App Server: dead = true thì mọi lời gọi treo mãi (tiến trình đã chết, không còn tác động lên DB). */
function deadableClient(base) {
  const hang = () => { const p = new Promise(() => {}); return { abortSignal: () => p, then: (a, b) => p.then(a, b) } }
  const self = {
    dead: false,
    rpc: (name, args) => self.dead ? hang() : base.rpc(name, args),
    from: table => {
      if (!self.dead) return base.from(table)
      const builder = new Proxy({}, { get: (_t, key) => key === 'then' ? (a, b) => new Promise(() => {}).then(a, b) : () => builder })
      return builder
    }
  }
  return self
}

async function waitFor(cond, ms = 20_000, label = 'điều kiện') {
  const start = Date.now()
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error(`hết giờ chờ ${label}`)
    await new Promise(r => setTimeout(r, 25))
  }
}

async function main() {
  const mod = await loadScheduler()
  const T = await buildV667Db({ label: 'aka-v667-scheduler-', applyV667: true })
  const { db, one, q } = T
  currentDb = db
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-server-scheduler-userdata-'))
  const unknownCalls = []
  const extraClients = []
  try {
    for (let i = 0; i < 4; i++) {
      const c = await T.connect()
      await c.query(`SET request.jwt.claims='{"role":"service_role"}'`)
      extraClients.push(c)
    }
    const baseClient = fakeClient(makePool(extraClients), unknownCalls)
    const processClient = new AsyncLocalStorage()
    globalThis.__srvTest = {
      userData, clientFor: () => processClient.getStore() ?? baseClient,
      updateInput: async (id, updates) => { await db.query(`UPDATE public.auto_campaign_input_data SET name = coalesce($2, name), uid = coalesce($3, uid) WHERE id = $1`,
        [id, updates.name ?? null, updates.uid ?? null]) }
    }
    const setting = value => db.query(`UPDATE public.auto_system_settings SET value = $2 WHERE key = $1`, [V667.SETTING_KEY, value])
    const gate = mod.serverEngineGate()

    // ------------------------------------------------------------------ facade SupabaseService (phần đường engine của App Server dùng)
    const progress = []
    const facadeCalls = []
    let tickAccountIds = []
    const facade = new Proxy({
      getRuntimeClock: async () => {
        const now = new Date()
        const vn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now)
        return { dbNow: now.toISOString(), vietnamDateKey: vn, nextVietnamMidnight: new Date(Date.parse(`${vn}T00:00:00+07:00`) + 24 * 60 * MIN).toISOString() }
      },
      getCampaign: async id => { const r = await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id]); return r ? mod.mapCampaignFromDB(r) : null },
      // Lượt quét (tick): tài khoản của tiến trình (tickAccountIds) và chiến dịch tới lịch của từng tài khoản (rút gọn getPendingCampaigns).
      getEligibleAccounts: async () => (await q('SELECT * FROM public.auto_accounts WHERE id = ANY($1::bigint[]) ORDER BY id', [tickAccountIds]))
        .map(mod.mapAccountFromDB),
      getPendingCampaigns: async accountId => (await q(`SELECT * FROM public.auto_campaigns WHERE account_id = $1 AND status = 'chờ xử lý'
        AND is_delete = false AND schedule <= now() ORDER BY schedule, id`, [accountId])).map(mod.mapCampaignFromDB),
      getAccount: async id => { const r = await one('SELECT * FROM public.auto_accounts WHERE id = $1', [id]); return r ? mod.mapAccountFromDB(r) : null },
      appendCampaignLog: async (id, message) => {
        progress.push({ campaignId: Number(id), message })
        const r = await one('SELECT id, name, account_id FROM public.auto_campaigns WHERE id = $1', [id])
        return { id: Number(r.id), name: r.name, accountId: Number(r.account_id), accountName: 'Zalo Server' }
      },
      updatePendingUnclaimedCampaignNote: async (id, _updatedAt, note) => {
        const r = await one(`UPDATE public.auto_campaigns SET note = $2 WHERE id = $1 AND status = 'chờ xử lý' RETURNING *`, [id, note])
        return r ? mod.mapCampaignFromDB(r) : null
      }
    }, { get(target, key) {
      if (key in target) return target[key]
      if (key === 'then') return undefined
      return async (...args) => { facadeCalls.push([String(key), args]); return null }
    } })

    const makeScheduler = runtime => {
      const realtime = []
      const mainWindow = { webContents: { send() {} }, isDestroyed: () => false }
      const webviewRegistry = { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null }
      const scheduler = new mod.CampaignScheduler(facade, webviewRegistry, mainWindow, undefined, runtime, undefined,
        { runtimeTarget: 'server', logSink: entry => { realtime.push(entry) } })
      scheduler.running = true
      const legacy = []
      // Bộ chạy cũ: chỉ ghi lại (bài kiểm này hỏi bộ lập lịch chọn đường nào, không kiểm bộ cũ).
      scheduler.executeCampaign = async (_account, campaign) => { legacy.push(Number(campaign.id)); return 'done' }
      return { scheduler, legacy, realtime }
    }
    const userOf = (staffId, organizationId) => ({ staffId, organizationId, name: `NV ${staffId}`, username: `nv${staffId}`, isAdminAkabiz: false,
      campaignEngineV2: false, isZaloServer: true, isZaloShowWeb: false, zaloAccountCapabilities: { qr: true, web: false, server: true },
      entitlements: { zalo: true, facebookCore: false, facebookFanpage: false, email: false, sms: false } })
    const runQueue = (scheduler, user, account, campaigns) => mod.runWithCurrentUser(user, () => scheduler.runAccountCampaignQueue(account, campaigns))

    const fakeRuntime = (behaviors = {}) => {
      const sent = []
      return {
        sent,
        findUserByPhoneOnce: async (_accountId, phone) => {
          sent.push(`find:${phone}`)
          return { uid: `uid-${phone}`, displayName: `Khách ${phone.slice(-2)}`, originalName: `Khách ${phone.slice(-2)}`, globalId: `g-${phone}`, gender: 0, raw: {} }
        },
        sendMessageToUser: async (_accountId, uid, _message) => {
          sent.push(`text:${uid}`)
          const b = behaviors[uid.replace('uid-', '')] || {}
          if (b.beforeReturn) await b.beforeReturn()
          return { message: { msgId: `m-${uid}-${sent.length}` }, attachment: [] }
        }
      }
    }
    const textSends = (runtimes, phone) => runtimes.reduce((n, r) => n + r.sent.filter(s => s === `text:uid-${phone}`).length, 0)

    // ------------------------------------------------------------------ dữ liệu
    for (const [org, staff] of [[ORG, STAFF], [ORG, STAFF_STOP], [ORG, STAFF_CRASH], [ORG_B, STAFF_B], [ORG_OFF, STAFF_OFF]]) {
      await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES ($1, $2, false) ON CONFLICT (id) DO UPDATE SET use_new_zalo_runtime = false`,
        [org, `VPS ${org}`])
      await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_active) VALUES ($1, $2, $3, 'pw', true) ON CONFLICT (id) DO NOTHING`,
        [staff, org, `nv${staff}`])
    }
    for (const org of [ORG, ORG_B, ORG_OFF]) {
      await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, is_deleted, expiration_date) VALUES ($1, 16, false, now() + interval '30 days')`, [org])
    }
    let nextId = 960000
    const makeAccount = async (staff, org, extra = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo Server', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true, false)`, [id, staff, org])
      if (Object.keys(extra).length) {
        const sets = Object.keys(extra).map((k, i) => `"${k}" = $${i + 2}`).join(', ')
        await db.query(`UPDATE public.auto_accounts SET ${sets} WHERE id = $1`, [id, ...Object.values(extra)])
      }
      return mod.mapAccountFromDB(await one('SELECT * FROM public.auto_accounts WHERE id = $1', [id]))
    }
    const makeCampaign = async (account, phones, { status = 'chờ xử lý', name = 'VPS SĐT' } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'zalo_message_phone', $3, $4, now() - interval '1 minute', false, $5, $6, 'Chào #{FULL_NAME}', $7::jsonb)`,
        [id, name, account.id, status, account.staffId, account.organizationId, JSON.stringify({ enableMessage: true, actionLimits: { sleepBetweenActions: 0 } })])
      const ids = {}
      for (const phone of phones) {
        const rid = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [rid, id, `Data ${phone.slice(-2)}`, phone])
        ids[phone] = rid
      }
      return { campaign: mod.mapCampaignFromDB(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id])), ids }
    }
    const inputStatus = async id => (await one(`SELECT status FROM public.auto_campaign_input_data WHERE id = $1`, [id])).status
    const runsOf = campaignId => q(`SELECT runtime_target, runner_id, staff_id, completed_at IS NOT NULL done FROM public.auto_engine_target_runs WHERE campaign_id = $1 ORDER BY id`, [campaignId])
    const liveLeases = accountId => one(`SELECT count(*)::int n FROM public.auto_engine_leases WHERE account_id = $1 AND expires_at > now()`, [accountId]).then(r => r.n)

    // ------------------------------------------------------------------ dựng và chọn bộ chạy
    await check('bộ lập lịch App Server: bộ chạy engine nơi chạy server; tài khoản Facebook / Zalo QR không thuộc nơi này', async () => {
      const { scheduler } = makeScheduler(fakeRuntime())
      assert.ok(scheduler.engineRunner, 'có bộ chạy engine')
      assert.match(scheduler.engineRunner.runnerId, /^server:/)
      const acc = await makeAccount(STAFF, ORG)
      const { campaign } = await makeCampaign(acc, [])
      assert.equal(scheduler.engineRunner.support({ ...acc, flatformType: 'facebook' }, campaign).reason, 'runtime')
      assert.equal(scheduler.engineRunner.support({ ...acc, isZaloServer: false }, campaign).reason, 'runtime')
    })

    await check('công tắc chưa đọc được (lần đọc đầu của tiến trình còn treo): hàng đợi bỏ qua chiến dịch tới lượt sau, không chạy bộ cũ, không gửi', async () => {
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG] }))
      const runtime = fakeRuntime()
      const { scheduler, legacy } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF, ORG)
      const { campaign, ids } = await makeCampaign(acc, ['0944000001'])
      // DB chậm lúc App Server vừa lên: giữ khoá bảng thiết lập ở kết nối khác nên lần đọc công tắc đầu tiên treo (8 giây thì tự nhả để bài kiểm không treo).
      const locker = await T.connect()
      let unlocked = false
      const unlock = async () => { if (unlocked) return; unlocked = true; await locker.query('ROLLBACK').catch(() => {}) }
      const timer = setTimeout(() => { void unlock() }, 8000)
      try {
        await locker.query('BEGIN')
        await locker.query('LOCK TABLE public.auto_system_settings IN ACCESS EXCLUSIVE MODE')
        assert.equal(gate.state(ORG), 'loading', 'tiến trình mới: công tắc chưa đọc được')
        const started = Date.now()
        await runQueue(scheduler, userOf(STAFF, ORG), acc, [campaign])
        assert.ok(Date.now() - started < 5000, `hàng đợi không chờ lần đọc công tắc (${Date.now() - started} ms)`)
        assert.deepEqual(legacy, [], 'không để bộ cũ chạy chiến dịch của tổ chức có thể đã bật')
        assert.deepEqual(runtime.sent, [])
        assert.equal(await inputStatus(ids['0944000001']), 'chờ xử lý')
      } finally {
        clearTimeout(timer)
        await unlock()
        await locker.end().catch(() => {})
      }
      await gate.refresh()
      assert.equal(gate.state(ORG), 'enabled', 'đọc xong thì bật')
      await runQueue(scheduler, userOf(STAFF, ORG), acc, [campaign])
      assert.deepEqual(runtime.sent, ['find:0944000001', 'text:uid-0944000001'], 'lượt quét sau chạy engine')
      assert.deepEqual(legacy, [])
    })

    await check('công tắc bật: hàng đợi tài khoản chạy engine (claim server, đúng nhân viên), dòng tiến trình qua appendCampaignLog và logSink', async () => {
      const runtime = fakeRuntime()
      const { scheduler, legacy, realtime } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF, ORG)
      const { campaign, ids } = await makeCampaign(acc, ['0944000011', '0944000012'])
      progress.length = 0
      await runQueue(scheduler, userOf(STAFF, ORG), acc, [campaign])
      assert.deepEqual(legacy, [])
      assert.deepEqual(runtime.sent, ['find:0944000011', 'text:uid-0944000011', 'find:0944000012', 'text:uid-0944000012'])
      for (const id of Object.values(ids)) assert.equal(await inputStatus(id), 'hoàn thành')
      const runs = await runsOf(campaign.id)
      assert.equal(runs.length, 2)
      for (const r of runs) { assert.equal(r.runtime_target, 'server'); assert.match(r.runner_id, /^server:/); assert.equal(Number(r.staff_id), STAFF); assert.equal(r.done, true) }
      assert.equal(await liveLeases(acc.id), 0, 'lease đã nhả')
      assert.equal((await one(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [campaign.id])).status, 'hoàn thành')
      const lines = progress.filter(p => p.campaignId === Number(campaign.id)).map(p => p.message)
      assert.equal(lines[0], '🚀 Bắt đầu chiến dịch "VPS SĐT" trên tài khoản "Zalo Server"', lines.join('\n'))
      assert.equal(lines.at(-1), '✅ Hoàn thành chiến dịch "VPS SĐT"', lines.join('\n'))
      assert.ok(realtime.some(e => Number(e.campaignId) === Number(campaign.id) && /Bắt đầu chiến dịch/.test(e.message)), 'dòng tiến trình tới logSink (gateway App Server)')
    })

    await check('công tắc tắt (tổ chức không trong danh sách): hàng đợi đi bộ cũ, engine không nhận lượt nào', async () => {
      const runtime = fakeRuntime()
      const { scheduler, legacy } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF_OFF, ORG_OFF)
      const { campaign } = await makeCampaign(acc, ['0944000021'])
      await runQueue(scheduler, userOf(STAFF_OFF, ORG_OFF), acc, [campaign])
      assert.deepEqual(legacy, [Number(campaign.id)], 'bộ cũ chạy chiến dịch')
      assert.deepEqual(runtime.sent, [])
      assert.equal((await runsOf(campaign.id)).length, 0)
    })

    // ------------------------------------------------------------------ chuyển giữa chừng từ bộ cũ
    await check('bộ cũ còn giữ tài khoản lúc bật công tắc: engine chờ (legacy_busy), không gửi; bộ cũ xong thì engine chạy phần còn lại, không gửi lại', async () => {
      const runtime = fakeRuntime()
      const { scheduler, legacy } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF, ORG)
      // X: bộ cũ đang chạy (đã gửi 01, đang gửi 02, chưa tới 03); Y: chiến dịch khác cùng tài khoản, chờ xử lý.
      const X = await makeCampaign(acc, ['0944000031', '0944000032', '0944000033'], { name: 'X bộ cũ' })
      const Y = await makeCampaign(acc, ['0944000041', '0944000042'], { name: 'Y chờ' })
      await db.query(`UPDATE public.auto_campaigns SET status = 'đang chạy', runtime_claim_token = gen_random_uuid(), runtime_claim_target = 'server',
        runtime_claimed_at = now() WHERE id = $1`, [X.campaign.id])
      await db.query(`UPDATE public.auto_accounts SET runtime_operation_claim_token = gen_random_uuid() WHERE id = $1`, [acc.id])
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'hoàn thành' WHERE id = $1`, [X.ids['0944000031']])
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = $1`, [X.ids['0944000032']])
      const xNow = mod.mapCampaignFromDB(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [X.campaign.id]))
      await runQueue(scheduler, userOf(STAFF, ORG), acc, [xNow, Y.campaign])
      assert.deepEqual(runtime.sent, [], 'không gửi khi bộ cũ còn giữ tài khoản')
      assert.deepEqual(legacy, [], 'không gọi bộ cũ cho chiến dịch của tổ chức đã bật')
      for (const id of Object.values(Y.ids)) assert.equal(await inputStatus(id), 'chờ xử lý')
      const direct = await mod.runWithCurrentUser(userOf(STAFF, ORG), () => scheduler.engineRunner.run(acc, Y.campaign))
      assert.equal(direct?.reason, 'legacy_busy', JSON.stringify(direct))
      // Bộ cũ xong lượt của X: data đang gửi hoàn thành, nhả claim và token tài khoản, X còn data nên về chờ xử lý.
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'hoàn thành' WHERE id = $1`, [X.ids['0944000032']])
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', runtime_claim_token = NULL, runtime_claim_target = NULL, runtime_claimed_at = NULL
        WHERE id = $1`, [X.campaign.id])
      await db.query(`UPDATE public.auto_accounts SET runtime_operation_claim_token = NULL WHERE id = $1`, [acc.id])
      const xAfter = mod.mapCampaignFromDB(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [X.campaign.id]))
      await runQueue(scheduler, userOf(STAFF, ORG), acc, [xAfter, Y.campaign])
      assert.equal(textSends([runtime], '0944000031'), 0, 'data bộ cũ đã gửi: engine không gửi lại')
      assert.equal(textSends([runtime], '0944000032'), 0, 'data bộ cũ đang gửi lúc chuyển: engine không gửi lại')
      for (const phone of ['0944000033', '0944000041', '0944000042']) assert.equal(textSends([runtime], phone), 1, phone)
      for (const id of [...Object.values(X.ids), ...Object.values(Y.ids)]) assert.equal(await inputStatus(id), 'hoàn thành')
      assert.deepEqual(legacy, [])
    })

    // ------------------------------------------------------------------ nhiều nhân viên một tiến trình
    await check('nhiều nhân viên cùng tiến trình (mỗi người một bộ lập lịch, chạy đồng thời): đúng nhân viên ở từng lượt, tổ chức chưa bật đi bộ cũ', async () => {
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG, ORG_B] }))
      await gate.refresh()
      const rA = fakeRuntime(), rB = fakeRuntime(), rOff = fakeRuntime()
      const sA = makeScheduler(rA), sB = makeScheduler(rB), sOff = makeScheduler(rOff)
      const aA = await makeAccount(STAFF, ORG), aB = await makeAccount(STAFF_B, ORG_B), aOff = await makeAccount(STAFF_OFF, ORG_OFF)
      const cA = await makeCampaign(aA, ['0944000051', '0944000052', '0944000053'])
      const cB = await makeCampaign(aB, ['0944000061', '0944000062', '0944000063'])
      const cOff = await makeCampaign(aOff, ['0944000071'])
      await Promise.all([
        runQueue(sA.scheduler, userOf(STAFF, ORG), aA, [cA.campaign]),
        runQueue(sB.scheduler, userOf(STAFF_B, ORG_B), aB, [cB.campaign]),
        runQueue(sOff.scheduler, userOf(STAFF_OFF, ORG_OFF), aOff, [cOff.campaign])
      ])
      for (const [c, staff] of [[cA, STAFF], [cB, STAFF_B]]) {
        const runs = await runsOf(c.campaign.id)
        assert.equal(runs.length, 3, `${c.campaign.id}: ${JSON.stringify(runs)}`)
        for (const r of runs) { assert.equal(Number(r.staff_id), staff); assert.equal(r.runtime_target, 'server'); assert.equal(r.done, true) }
        for (const id of Object.values(c.ids)) assert.equal(await inputStatus(id), 'hoàn thành')
      }
      assert.deepEqual(rA.sent.filter(s => s.startsWith('text:')).sort(), ['text:uid-0944000051', 'text:uid-0944000052', 'text:uid-0944000053'])
      assert.deepEqual(rB.sent.filter(s => s.startsWith('text:')).sort(), ['text:uid-0944000061', 'text:uid-0944000062', 'text:uid-0944000063'])
      assert.deepEqual(sOff.legacy, [Number(cOff.campaign.id)])
      assert.deepEqual(rOff.sent, [])
      assert.deepEqual(sA.legacy.concat(sB.legacy), [])
    })

    // ------------------------------------------------------------------ dừng runtime giữa lượt, khởi động lại
    await check('App Server dừng runtime giữa lượt (như stopRuntime) rồi khởi động lại: dọn lượt dở, chạy tiếp, không gửi trùng', async () => {
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG, ORG_B] }))
      await gate.refresh()
      const phones = ['0944000081', '0944000082', '0944000083']
      const acc = await makeAccount(STAFF_STOP, ORG)
      const c = await makeCampaign(acc, phones)
      let first = null
      const r1 = fakeRuntime({ '0944000081': { beforeReturn: async () => {
        // Như ZaloServerRuntimeManager.stopRuntime: chặn Zalo để khởi động lại rồi dừng bộ lập lịch, trong lúc data đầu đang gửi.
        first.scheduler.blockZaloRuntimeForRestart(null)
        first.scheduler.stop()
      } } })
      first = makeScheduler(r1)
      await runQueue(first.scheduler, userOf(STAFF_STOP, ORG), acc, [c.campaign])
      assert.equal(await first.scheduler.waitForIdle(30_000), true)
      assert.equal(textSends([r1], '0944000081'), 1)
      assert.equal(textSends([r1], '0944000082') + textSends([r1], '0944000083'), 0, 'dừng sau data đang gửi')
      // Bước dọn của stopRuntime (sau khi mọi việc đã dừng).
      await db.query(`SELECT public.recover_server_zalo_running_state($1, NULL, false)`, [STAFF_STOP])
      if ((await one(`SELECT to_regprocedure('public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)') r`)).r) {
        await db.query(`SELECT public.aka_agent_recover_campaign_runtime_unit_leases($1, 'server', 'all')`, [STAFF_STOP])
      }
      assert.equal((await one(`SELECT count(*)::int n FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND completed_at IS NULL`, [c.campaign.id])).n, 0,
        'không còn lượt engine mở')
      assert.equal(await liveLeases(acc.id), 0, 'lease của tiến trình cũ đã nhả khi dừng')
      assert.equal((await one(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c.campaign.id])).status, 'chờ xử lý', 'chiến dịch về chờ xử lý')
      assert.equal((await one(`SELECT status FROM public.auto_accounts WHERE id = $1`, [acc.id])).status, 'chờ xử lý', 'tài khoản về chờ xử lý')
      // Khởi động lại: tiến trình mới (bộ lập lịch mới, cổng Zalo mới).
      const r2 = fakeRuntime()
      const second = makeScheduler(r2)
      const cNow = mod.mapCampaignFromDB(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [c.campaign.id]))
      await runQueue(second.scheduler, userOf(STAFF_STOP, ORG), acc, [cNow])
      for (const phone of phones) assert.equal(textSends([r1, r2], phone), 1, `${phone} gửi ${textSends([r1, r2], phone)} lần`)
      for (const phone of phones) assert.equal(await inputStatus(c.ids[phone]), 'hoàn thành', phone)
      assert.deepEqual(first.legacy.concat(second.legacy), [])
    })


    await check('App Server chết giữa lúc gửi (không kịp báo kết quả) rồi khởi động lại: lượt dở đóng server_reset, data đã gửi không gửi lại, hết lease thì chạy tiếp', async () => {
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG, ORG_B] }))
      await gate.refresh()
      const phones = ['0944000091', '0944000092', '0944000093']
      const acc = await makeAccount(STAFF_CRASH, ORG)
      const c = await makeCampaign(acc, phones)
      // Tiến trình cũ: Zalo đã nhận tin 91 thì tiến trình chết (client DB riêng bị cắt, lệnh gửi không bao giờ trả về).
      const zombie = deadableClient(baseClient)
      const r1 = fakeRuntime({ '0944000091': { beforeReturn: async () => { zombie.dead = true; await new Promise(() => {}) } } })
      const first = makeScheduler(r1)
      void processClient.run(zombie, () => runQueue(first.scheduler, userOf(STAFF_CRASH, ORG), acc, [c.campaign]))
      await waitFor(() => r1.sent.includes('text:uid-0944000091'), 20_000, 'tiến trình cũ gửi tin đầu')
      const open = await q(`SELECT id, completed_at FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND completed_at IS NULL`, [c.campaign.id])
      assert.equal(open.length, 1, `lượt dở của tiến trình chết: ${JSON.stringify(open)}`)
      const lease = await one(`SELECT runner_id, extract(epoch FROM expires_at - now())::int AS left_s FROM public.auto_engine_leases WHERE account_id = $1`, [acc.id])
      assert.match(lease.runner_id, /^server:/)
      crashLease.leftSeconds = lease.left_s
      // Khởi động lại App Server: startRuntime dọn như lúc khởi động (cần đúng phiên bản quyền gói, bắt buộc chế độ Server).
      await db.query(`SELECT public.recover_server_zalo_running_state($1, $2, true)`, [STAFF_CRASH, `test:${ORG}`])
      if ((await one(`SELECT to_regprocedure('public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)') r`)).r) {
        await db.query(`SELECT public.aka_agent_recover_campaign_runtime_unit_leases($1, 'server', 'all')`, [STAFF_CRASH])
      }
      // Như V576: close_reason luôn 'stale', đường đóng ghi ở sự kiện interrupted (data.via).
      const closed = await one(`SELECT completed_at IS NOT NULL done, final_target_status, final_error_code FROM public.auto_engine_target_runs WHERE id = $1`, [open[0].id])
      assert.deepEqual([closed.done, closed.final_target_status, closed.final_error_code], [true, 'hoàn thành', 'err_engine_interrupted_while_sending'],
        'đã ghi dấu gửi: đóng SYS02, không gửi lại')
      const via = (await one(`SELECT data->>'via' v FROM public.auto_engine_target_events WHERE target_run_id = $1 AND kind = 'interrupted' ORDER BY id DESC LIMIT 1`,
        [open[0].id]))?.v
      assert.equal(via, V667.RESET_VIA)
      assert.equal(await inputStatus(c.ids['0944000091']), 'hoàn thành', 'data đã ghi dấu gửi: đóng, không gửi lại')
      // Tiến trình mới (cổng Zalo mới, cùng thư mục dữ liệu nên cùng nhật ký engine): lease của tiến trình chết còn hạn thì chờ.
      const r2 = fakeRuntime()
      const second = makeScheduler(r2)
      const campaignNow = async () => mod.mapCampaignFromDB(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [c.campaign.id]))
      await runQueue(second.scheduler, userOf(STAFF_CRASH, ORG), acc, [await campaignNow()])
      assert.deepEqual(r2.sent, [], 'lease còn hạn: chưa chạy')
      assert.deepEqual(second.legacy, [], 'không chuyển sang bộ cũ trong lúc chờ')
      // Hết lease (thực tế: tối đa engine.lease_seconds sau lần gia hạn cuối).
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 second' WHERE account_id = $1`, [acc.id])
      await runQueue(second.scheduler, userOf(STAFF_CRASH, ORG), acc, [await campaignNow()])
      for (const phone of phones) assert.equal(textSends([r1, r2], phone), 1, `${phone} gửi ${textSends([r1, r2], phone)} lần`)
      for (const phone of phones) assert.equal(await inputStatus(c.ids[phone]), 'hoàn thành', phone)
      assert.equal(await liveLeases(acc.id), 0, 'tiến trình mới nhả lease')
    })

    // ------------------------------------------------------------------ tài khoản "đang chạy" bị sót (27/11/2026)
    // Lượt quét thật (tick) với một tài khoản: trạng thái tài khoản lấy từ DB như getEligibleAccounts của App Server.
    const tickOnce = async (scheduler, user, accountIds) => {
      tickAccountIds = accountIds
      await mod.runWithCurrentUser(user, () => scheduler.tick())
      assert.equal(await scheduler.waitForIdle(30_000), true, 'hàng đợi xong')
    }
    const accountStatus = async id => (await one(`SELECT status FROM public.auto_accounts WHERE id = $1`, [id])).status
    const setRunning = id => db.query(`UPDATE public.auto_accounts SET status = 'đang chạy' WHERE id = $1`, [id])

    await check('tài khoản "đang chạy" bị sót (không lease, không dấu bộ cũ): lượt quét chạy chiến dịch engine, gửi đủ, tài khoản về chờ xử lý', async () => {
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG, ORG_B] }))
      await gate.refresh()
      const runtime = fakeRuntime()
      const { scheduler, legacy } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF, ORG)
      const c = await makeCampaign(acc, ['0944000101', '0944000102'], { name: 'Sót đang chạy' })
      await setRunning(acc.id)
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.deepEqual(legacy, [], 'không gọi bộ cũ')
      assert.deepEqual(runtime.sent, ['find:0944000101', 'text:uid-0944000101', 'find:0944000102', 'text:uid-0944000102'])
      for (const id of Object.values(c.ids)) assert.equal(await inputStatus(id), 'hoàn thành')
      assert.equal(await accountStatus(acc.id), 'chờ xử lý', 'nhả lượt trả tài khoản về chờ xử lý')
      assert.equal(await liveLeases(acc.id), 0)
    })

    await check('tài khoản "đang chạy" bị sót: hỏi lại tối đa 2 phút một lần (lượt quét ngay sau không nhận lượt), quá hạn thì chạy', async () => {
      const runtime = fakeRuntime()
      const { scheduler, legacy } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF, ORG)
      await makeCampaign(acc, ['0944000111'], { name: 'Lần 1' })
      await setRunning(acc.id)
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.equal(textSends([runtime], '0944000111'), 1)
      // Lượt sau lại sót "đang chạy" (như release cũ để lại) và có chiến dịch mới tới lịch.
      const c2 = await makeCampaign(acc, ['0944000112'], { name: 'Lần 2' })
      await setRunning(acc.id)
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.equal(textSends([runtime], '0944000112'), 0, 'chưa tới lượt hỏi lại: không nhận lượt')
      assert.equal(await inputStatus(c2.ids['0944000112']), 'chờ xử lý')
      assert.ok(scheduler.engineStaleStatusProbes.has(acc.id), 'có mốc hỏi lại')
      scheduler.engineStaleStatusProbes.set(acc.id, 0)   // như đã qua 2 phút (đồng hồ đơn điệu)
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.equal(textSends([runtime], '0944000112'), 1, 'quá hạn: hỏi DB, chạy')
      assert.equal(await inputStatus(c2.ids['0944000112']), 'hoàn thành')
      assert.deepEqual(legacy, [])
      // Tài khoản về chờ xử lý thì bỏ mốc (lần sót sau hỏi ngay).
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.equal(scheduler.engineStaleStatusProbes.has(acc.id), false)
    })

    await check('DB còn giữ tài khoản (token thao tác bộ cũ còn sống): lượt quét hỏi DB, không gửi, không gọi bộ cũ, tài khoản vẫn "đang chạy"', async () => {
      const runtime = fakeRuntime()
      const { scheduler, legacy } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF, ORG)
      const c = await makeCampaign(acc, ['0944000121'], { name: 'Bị giữ' })
      await db.query(`UPDATE public.auto_accounts SET status = 'đang chạy', runtime_operation_claim_token = gen_random_uuid() WHERE id = $1`, [acc.id])
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.deepEqual(runtime.sent, [])
      assert.deepEqual(legacy, [])
      assert.equal(await inputStatus(c.ids['0944000121']), 'chờ xử lý')
      assert.equal(await accountStatus(acc.id), 'đang chạy', 'không ai đổi trạng thái của tài khoản đang bị giữ')
      // Khoá theo id chiến dịch như bộ lập lịch đọc lại (pg trả bigint dạng chuỗi).
      const seen = scheduler.engineObservations.get(c.campaign.id)
      assert.equal(seen?.reason, 'legacy_busy', JSON.stringify(seen))
      // App Server không ghi câu chờ (chỉ Desktop): ghi chú chiến dịch giữ nguyên.
      assert.equal((await one(`SELECT note FROM public.auto_campaigns WHERE id = $1`, [c.campaign.id])).note, null)
      // Lượt quét ngay sau không hỏi lại (một lần nhận lượt / 2 phút / tài khoản).
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.equal(scheduler.engineObservations.get(c.campaign.id)?.at, seen.at, 'không nhận lượt lại trong 2 phút')
      // Thao tác xong (bộ cũ nhả token, trả tài khoản): chạy ngay ở lượt quét sau.
      await db.query(`UPDATE public.auto_accounts SET status = 'chờ xử lý', runtime_operation_claim_token = NULL WHERE id = $1`, [acc.id])
      await tickOnce(scheduler, userOf(STAFF, ORG), [acc.id])
      assert.equal(textSends([runtime], '0944000121'), 1)
      assert.equal(await inputStatus(c.ids['0944000121']), 'hoàn thành')
    })

    await check('tổ chức chưa bật engine: tài khoản "đang chạy" bị sót vẫn đứng như trước (bộ cũ đòi chờ xử lý), không gửi, không gọi bộ cũ', async () => {
      const runtime = fakeRuntime()
      const { scheduler, legacy } = makeScheduler(runtime)
      const acc = await makeAccount(STAFF_OFF, ORG_OFF)
      const c = await makeCampaign(acc, ['0944000131'], { name: 'Bộ cũ sót' })
      await setRunning(acc.id)
      await tickOnce(scheduler, userOf(STAFF_OFF, ORG_OFF), [acc.id])
      assert.deepEqual(legacy, [])
      assert.deepEqual(runtime.sent, [])
      assert.equal(scheduler.engineStaleStatusProbes.has(acc.id), false, 'không có chiến dịch engine: không đánh dấu hỏi lại')
      assert.equal(await inputStatus(c.ids['0944000131']), 'chờ xử lý')
      // Hàng đợi mở với tài khoản "đang chạy" (đường phòng hờ trong runAccountCampaignQueue): chiến dịch không chạy được bằng engine thì bỏ qua.
      const now = mod.mapAccountFromDB(await one('SELECT * FROM public.auto_accounts WHERE id = $1', [acc.id]))
      assert.equal(now.status, 'đang chạy')
      await runQueue(scheduler, userOf(STAFF_OFF, ORG_OFF), now, [c.campaign])
      assert.deepEqual(legacy, [], 'hàng đợi của tài khoản "đang chạy" không chạy bộ cũ')
      // Tài khoản chờ xử lý: bộ cũ chạy như trước.
      await db.query(`UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = $1`, [acc.id])
      await tickOnce(scheduler, userOf(STAFF_OFF, ORG_OFF), [acc.id])
      assert.deepEqual(legacy, [Number(c.campaign.id)])
    })

    const rpcErrors = unknownCalls.filter(c => c[0] === 'rpc_error')
    if (rpcErrors.length) console.log('Lỗi RPC trong lúc chạy (để soi):', JSON.stringify(rpcErrors.slice(0, 10)))
  } finally {
    for (const c of extraClients) await c.end().catch(() => {})
    await T.stop()
  }
  if (crashLease.leftSeconds !== null) console.log(`Lease của tiến trình chết còn ${crashLease.leftSeconds} giây lúc khởi động lại (engine.lease_seconds)`)
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  // Tiến trình "chết" của bài kiểm còn lời gọi treo: thoát hẳn.
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); process.exitCode = 1 })
