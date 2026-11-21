#!/usr/bin/env node
// Giả lập trọn đường chiến dịch quét data website trên Desktop (phương án docs/WEB_DATA_SCAN_PLAN.md mục 7.9), chạy trong Electron:
//   bộ lập lịch Desktop thật (campaignScheduler.ts dựng bằng esbuild) → DesktopEngineRunner.runWeb → lõi runUnit → hàm engine thật + V618 trên
//   PostgreSQL 17 cục bộ (không chạm DB thật) → block "[engine] web_*" đọc từ DB → PageController thật trên cửa sổ ẩn → trang thật.
// Chỉ thay: Supabase bằng client nối PG cục bộ, Nhóm data / đẩy chiến dịch đích bằng bản ghi lại, Electron của bộ lập lịch bằng bản giả (trang
// là BrowserWindow thật tạo ở đây). Ra mạng thật: Trang Vàng, nhatot (bấm "Hiện SĐT" vài lần), batdongsan (một lần bấm "Hiện số" khi chưa đăng
// nhập). SĐT in ra đã che.
//   LC_ALL=C CHAT_REPO=<akaAgentChatApi> node scripts/web-scan/desktop-web-sim.cjs
'use strict'
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '../..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename], { stdio: 'inherit', env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }, timeout: 25 * 60_000 })
  process.exit(r.status ?? 1)
}

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const { build } = require('esbuild')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations } = require('../engine-v2-facebook/fixture.cjs')
const V = require('../build-v618-sql.cjs')

app.on('window-all-closed', () => {})
const PORT = Number(process.env.WEB_SIM_PORT || 55615)
const LIVE_DIR = path.join(__dirname, '../fixtures/web-scan/live-20261121')
const ONLY = String(process.env.WEB_SIM_ONLY || '').trim()
const mask = text => String(text).replace(/0\d{5}(\d{3,5})\b/g, (_m, tail) => '0xxxxx' + tail)
const t0 = Date.now()
const log = (...args) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's', ...args.map(a => mask(typeof a === 'string' ? a : JSON.stringify(a))))
let passed = 0
let failed = 0
async function check(name, fn) {
  if (ONLY && !ONLY.split('|').some(part => name.includes(part))) return
  log('▶', name)
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${mask(error.stack || error.message)}`) }
}

const STUBS = {
  electron: `
const handler = { get(target, key) { if (key === '__esModule') return false; return target[key] ?? (target[key] = new Proxy(function Stub() {}, handler)) },
  apply() { return new Proxy(function Stub() {}, handler) }, construct() { return new Proxy(function Stub() {}, handler) } }
const stub = () => new Proxy(function Stub() {}, handler)
const names = ['BrowserWindow', 'webContents', 'ipcMain', 'powerMonitor', 'session', 'net', 'dialog', 'shell', 'Notification', 'screen',
  'nativeImage', 'clipboard', 'Menu', 'Tray', 'systemPreferences', 'protocol', 'crashReporter', 'nativeTheme', 'safeStorage', 'contentTracing',
  'desktopCapturer', 'globalShortcut', 'inAppPurchase', 'MessageChannelMain', 'powerSaveBlocker', 'utilityProcess', 'WebContentsView', 'BaseWindow']
const electron = { app: { getPath: () => globalThis.__webSim.userData, getVersion: () => '0.0.0-websim', isPackaged: false, getName: () => 'aka-websim',
  on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => globalThis.__webSim.userData } }
for (const name of names) electron[name] = stub()
module.exports = electron`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__webSim.client, desktopFetch: fetch }`,
  currentUser: `module.exports = { getCurrentUser: () => globalThis.__webSim.user, requireCurrentUser: () => globalThis.__webSim.user,
    requireCurrentUserCredentials: () => ({ username: 'web', password: 'pw' }), getCurrentUserCredentials: () => ({ username: 'web', password: 'pw' }),
    setCurrentUser() {}, setCurrentUserCredentials() {}, onCurrentUserSessionChanged: () => () => {}, runWithCurrentUser: (_u, op) => op(),
    isZaloServerUser: () => false, isZaloShowWebUser: () => false, isCurrentUserZaloShowWeb: () => false, isCurrentUserZaloServerEnabled: () => false }`,
  elementV2Repository: `module.exports = { resolveXpathByName: async name => { const x = globalThis.__webSim.elements[name]; if (!x) throw new Error('Element không có: ' + name); return x },
    invalidateElementCache() {} }`,
  workflowV2Repository: `module.exports = { getWorkflow: async () => null, getWorkflowByName: async () => null }`,
  blockRepository: `module.exports = { getBlock: async () => null }`,
  runV2Repository: `module.exports = { createRun: async () => 1, updateRun: async () => undefined, createRunStep: async () => 1, updateRunStep: async () => undefined }`,
  facebookPageIdentityRepository: `module.exports = { validateCampaignPageIdentity: async () => undefined }`,
  entry: `export * from ${JSON.stringify(path.join(ROOT, 'src/main/services/campaignScheduler.ts'))}
export { PageController } from ${JSON.stringify(path.join(ROOT, 'src/main/v2/runtime/pageController.ts'))}
export { collectWebScanRecords } from ${JSON.stringify(path.join(ROOT, 'src/renderer/src/components/CampaignPanels/webScanFoundData.ts'))}`
}

async function loadScheduler() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-web-sim-'))
  const outfile = path.join(out, 'scheduler.cjs')
  await build({
    entryPoints: ['entry'], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', packages: 'external',
    banner: { js: `require = require('node:module').createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});` },
    plugins: [{ name: 'web-sim', setup(plugin) {
      plugin.onResolve({ filter: /^entry$/ }, () => ({ path: 'entry', namespace: 'stub' }))
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
      plugin.onResolve({ filter: /(\/supabaseClient|\/currentUser|repositories\/(workflowV2Repository|blockRepository|runV2Repository|elementV2Repository|facebookPageIdentityRepository))$/ },
        args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: STUBS[args.path], loader: args.path === 'entry' ? 'ts' : 'js',
        resolveDir: path.join(ROOT, 'src/main/services') }))
    } }]
  })
  return require(outfile)
}

/** Client Supabase giả trên PG cục bộ: rpc → hàm SQL thật (đã đặt phiên nhân viên Desktop); from().select() → SELECT. */
function fakeClient(db, calls) {
  const ident = s => '"' + String(s).replaceAll('"', '""') + '"'
  return {
    rpc(name, args) {
      const run = (async () => {
        const params = [], parts = []
        for (const [key, value] of Object.entries(args || {})) {
          const json = value !== null && typeof value === 'object' && !Array.isArray(value)
          const arr = Array.isArray(value) && name.startsWith('aka_agent_web_scan_seen')
          params.push(json || (Array.isArray(value) && !arr) ? JSON.stringify(value) : value)
          parts.push(`${key} => $${params.length}${json || (Array.isArray(value) && !arr) ? '::jsonb' : ''}`)
        }
        calls.push(['rpc', name])
        try {
          const r = await db.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
          return { data: r.rows[0].r, error: null, status: 200 }
        } catch (e) {
          calls.push(['rpc_error', name, e.message.slice(0, 200)])
          return { data: null, error: { message: e.message, code: e.code }, status: 400 }
        }
      })()
      return { abortSignal: () => run, then: (a, b) => run.then(a, b) }
    },
    from(table) {
      const filters = [], params = []
      let cols = '*'
      let single = false
      const builder = {
        select(c) { cols = c && c !== '*' ? c.split(',').map(x => x.trim()).filter(Boolean).map(ident).join(', ') : '*'; return builder },
        eq(col, value) { params.push(value); filters.push(`${ident(col)} = $${params.length}`); return builder },
        in(col, values) { params.push(values); filters.push(`${ident(col)} = ANY($${params.length})`); return builder },
        is(col, value) { filters.push(`${ident(col)} IS ${value === null ? 'NULL' : value ? 'TRUE' : 'FALSE'}`); return builder },
        order() { return builder }, limit() { return builder }, range() { return builder }, abortSignal() { return builder },
        maybeSingle() { single = true; return builder }, single() { single = true; return builder },
        then(resolve, reject) {
          return db.query(`SELECT ${cols} FROM public.${ident(table)}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''}`, params)
            .then(r => ({ data: single ? (r.rows[0] ?? null) : r.rows, error: null }), e => ({ data: null, error: { message: e.message, code: e.code } }))
            .then(resolve, reject)
        }
      }
      return builder
    }
  }
}

async function insertRows(db, table, rows) {
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows
    .map(r => r.column_name)
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
  const list = keys.map(k => `"${k}"`).join(', ')
  await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`,
    [JSON.stringify(rows)])
}

const STAFF = 9301
const ORG = 1
const ACCOUNT = 96301
const LIMITS = { defaultDaily: 100, maxDaily: 500, defaultSleepSeconds: 15, minSleepSeconds: 10 }

async function main() {
  const mod = await loadScheduler()
  const cluster = startCluster({ port: PORT, label: 'aka-web-sim-', timeoutMs: 25 * 60_000 })
  const db = await cluster.connect()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-web-sim-userdata-'))
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:web-sim-' + Date.now(), offscreen: true,
    backgroundThrottling: false } })
  try {
    // DB như production: bootstrap + engine Facebook (V556…), thân hàm production đọc 21/11/2026, rồi V618.
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(`SET check_function_bodies = off`)
    for (const file of fs.readdirSync(LIVE_DIR).filter(f => f.endsWith('.sql')).sort()) await db.query(fs.readFileSync(path.join(LIVE_DIR, file), 'utf8'))
    await db.query(`CREATE TABLE IF NOT EXISTS public.auto_elements (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, xpath text NOT NULL, description text,
      category text, is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
    await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_app_access_separate(p_org bigint) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$`)
    await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_app_access_account_allowed(p_account bigint, p_app text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$`)
    await db.query(V.sql.p1)
    await db.query(V.sql.p2)
    await db.query(V.sql.p3)
    // Phiên Desktop của nhân viên cho cả kết nối (production lấy từ JWT).
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'akaBiz') ON CONFLICT DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, 'websim', 'pw')`, [STAFF, ORG])
    await db.query(`SELECT set_config('test.desktop_staff', $1, false)`, [String(STAFF)])
    await insertRows(db, 'auto_accounts', [{ id: ACCOUNT, name: 'Website giả lập', flatform_type: 'web', login_status: 'đã đăng nhập', status: 'chờ xử lý',
      is_active: true, is_delete: false, staff_id: STAFF, organization_id: ORG, is_zalo_server: false, is_zalo_show_web: false }])
    const elements = Object.fromEntries((await db.query(`SELECT name, xpath FROM public.auto_elements WHERE name LIKE 'web\\_%'`)).rows.map(r => [r.name, r.xpath]))

    const calls = []
    const progress = []
    const ingested = []
    const facadeCalls = []
    globalThis.__webSim = {
      userData, client: fakeClient(db, calls), elements,
      user: { staffId: STAFF, organizationId: ORG, webScanEnabled: true, webScanLimits: LIMITS, campaignEngineV2: false, facebookEngineV2: false,
        entitlements: { facebookCore: true, facebookFanpage: false, email: false, zalo: true, sms: false } }
    }
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const mapCampaign = row => row && ({
      id: Number(row.id), name: row.name, actionId: row.action_id, accountId: Number(row.account_id), staffId: Number(row.staff_id),
      organizationId: Number(row.organization_id), status: row.status, note: row.note, content: row.content ?? '', extraSettings: row.extra_settings || {},
      images: [], isDelete: row.is_delete, updatedAt: row.updated_at, schedule: row.schedule, dataTargetSourceMode: 'direct'
    })
    const facade = new Proxy({
      getCampaign: async id => mapCampaign(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id])),
      appendCampaignLog: async (id, message) => {
        progress.push(message)
        log('   ·', message)
        const row = await one('SELECT id, name, account_id FROM public.auto_campaigns WHERE id = $1', [id])
        return { id: Number(row.id), name: row.name, accountId: Number(row.account_id), accountName: 'Website giả lập' }
      },
      listDataTypeCategoryItems: async () => [{ id: 501, code: 'phone', name: 'SĐT' }],
      ingestDataGroup: async request => {
        ingested.push(request)
        return { insertedMembershipCount: request.rows.length, reactivatedMembershipCount: 0, alreadyMemberCount: 0, invalidCount: 0, incompatibleCount: 0,
          conflictCount: 0 }
      },
      updatePendingUnclaimedCampaignNote: async (id, _updatedAt, note) => mapCampaign(await one(`UPDATE public.auto_campaigns SET note = $2
        WHERE id = $1 AND status = 'chờ xử lý' RETURNING *`, [id, note])),
      setDesktopCampaignStatusV2: async (id, _accountId, status) => (await one(`UPDATE public.auto_campaigns SET status = $2
        WHERE id = $1 AND status IS DISTINCT FROM $2 RETURNING id`, [id, status])) ? { ok: true } : { ok: false, reason: 'already_target' },
      listCampaignInputData: async campaignId => (await db.query('SELECT * FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id',
        [campaignId])).rows.map(r => ({ id: Number(r.id), campaignId: Number(r.campaign_id), name: r.name, uid: r.uid, status: r.status })),
      listCampaigns: async () => []
    }, { get(target, key) { if (key in target) return target[key]; return async (...args) => { facadeCalls.push([String(key), args]); return null } } })

    const mainWindow = { webContents: { send() {} }, isDestroyed: () => false }
    const webviewRegistry = { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null }
    const scheduler = new mod.CampaignScheduler(facade, webviewRegistry, mainWindow, undefined, undefined, undefined, { runtimeTarget: 'desktop' })
    scheduler.running = true
    const page = new mod.PageController(win.webContents, { immediateScripts: true })
    scheduler.backgroundPages = { getOrCreate: () => page, destroy() {}, destroyAll() {}, createTemporary() { return { page } } }
    Object.assign(scheduler, { startBackgroundPreview() {}, stopBackgroundPreview() {}, selectAutomationBrowser() {}, broadcastCampaignUpdate() {} })
    const account = { id: ACCOUNT, name: 'Website giả lập', flatformType: 'web', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: STAFF,
      organizationId: ORG, accountGroupSettings: {} }

    let nextId = 980000
    const makeCampaign = async ({ site, keywords, settings = {}, limits = {}, extra = {} }) => {
      const id = ++nextId
      const code = V.ACTION_CODES[site]
      await insertRows(db, 'auto_campaigns', [{ id, name: `Giả lập ${site} ${id}`, action_id: V.ACTION_IDS[site], account_id: ACCOUNT, status: 'chờ xử lý',
        is_delete: false, staff_id: STAFF, organization_id: ORG, schedule: new Date(Date.now() - 60_000).toISOString(), schedule_type: 'daily',
        extra_settings: { webScan: { site, ...settings }, isFindPhone: true,
          findDataTargetDataGroups: { phone: { groupId: 77, groupName: 'Nhóm SĐT giả lập' } },
          actionLimits: { sleepBetweenActions: 10, byActionCode: { [code]: { dailyLimit: 100, rateLimitCount: 100, rateLimitMinutes: 60, ...limits } } }, ...extra } }])
      const ids = []
      for (const keyword of keywords) {
        const inputId = ++nextId
        await insertRows(db, 'auto_campaign_input_data', [{ id: inputId, campaign_id: id, status: 'chờ xử lý', name: keyword, uid: keyword, is_delete: false }])
        ids.push(inputId)
      }
      return { campaign: await facade.getCampaign(id), ids }
    }
    // Hàng đợi của bộ lập lịch (runAccountCampaignQueue) chạy thật; chỉ thay đồng hồ DB và lịch chạy (đã tới giờ).
    scheduler.getReadyRuntimeClock = async () => ({ dbNow: new Date().toISOString() })
    scheduler.isWithinCampaignDispatchSchedule = () => true
    scheduler.shouldProcessAccountForRuntime = () => true
    const legacyRuns = []
    scheduler.executeCampaign = async (...args) => { legacyRuns.push(args); return 'done' }
    const engineResults = []
    const realRun = scheduler.engineRunner.run.bind(scheduler.engineRunner)
    scheduler.engineRunner.run = async (...args) => { const r = await realRun(...args); engineResults.push(r); return r }
    const run = async (campaign, { viaQueue = false } = {}) => {
      progress.length = 0
      ingested.length = 0
      const fresh = await facade.getCampaign(campaign.id)
      const support = scheduler.engineRunner.support(account, fresh)
      assert.deepEqual(support, { ok: true }, JSON.stringify(support))
      let result
      if (viaQueue) {
        const before = engineResults.length
        await scheduler.runAccountCampaignQueue(account, [fresh])
        assert.equal(engineResults.length, before + 1, 'hàng đợi gọi engine đúng một lần')
        result = engineResults[engineResults.length - 1]
      } else {
        result = await scheduler.engineRunner.run(account, fresh)
      }
      assert.equal(legacyRuns.length, 0, 'không chạy bộ cũ')
      log('   kết thúc lượt', { reason: result?.reason, targets: result?.targets, released: result?.released })
      return result
    }
    const details = async campaignId => (await db.query(`SELECT d.action_code, d.action_name, d.status, d.log, d.counts_toward_limit, d.data
      FROM public.auto_campaign_details d WHERE d.campaign_id = $1 ORDER BY d.id`, [campaignId])).rows
    const inputs = async campaignId => (await db.query(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`,
      [campaignId])).rows
    const outcomes = async campaignId => (await db.query(`SELECT action_code, ok, error_code, phase FROM public.auto_engine_outcomes WHERE campaign_id = $1
      ORDER BY created_at, result_key`, [campaignId])).rows
    const dayCount = async code => (await one(`SELECT coalesce(max(count_action_in_day), 0)::int AS n FROM public.auto_account_action_status
      WHERE account_id = $1 AND action_code = $2`, [ACCOUNT, code])).n
    // Hạn mức ngày (count_action_in_day) phải bằng số dòng Lịch sử hành động tính lượt của thao tác đó (mọi chiến dịch của tài khoản).
    const usedRows = async code => (await one(`SELECT count(*)::int AS n FROM public.auto_campaign_details WHERE account_id = $1 AND action_code = $2
      AND counts_toward_limit`, [ACCOUNT, code])).n
    const lockOf = async code => one(`SELECT is_disable, date_enable FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = $2`, [ACCOUNT, code])

    let tv = null
    await check('Trang Vàng: từ khoá × tỉnh, mở trang chi tiết; mỗi lần mở trang một dòng có mã thao tác, data vào Nhóm data đủ Info1–5', async () => {
      tv = await makeCampaign({ site: 'yellowpages', keywords: ['bao bì nhựa'],
        settings: { provinces: ['TP. Hồ Chí Minh (TPHCM)'], pagesPerSearch: 1, maxDataPerRun: 4, openDetail: true,
          fields: ['address', 'email', 'website', 'industry', 'taxCode', 'businessType'] } })
      const result = await run(tv.campaign, { viaQueue: true })
      assert.equal(result.reason, 'no_target', JSON.stringify(result))
      const rows = await details(tv.campaign.id)
      const uses = rows.filter(r => r.action_code === V.ACTION_CODES.yellowpages)
      assert.ok(uses.length >= 2, `có lần mở trang danh sách + trang chi tiết: ${uses.length}`)
      assert.ok(uses.every(r => r.status === 'thành công' && r.counts_toward_limit === true), JSON.stringify(uses.map(r => [r.status, r.counts_toward_limit])))
      const find = rows.filter(r => r.action_code === null && r.action_name === 'Tìm data')
      assert.equal(find.length, 1, JSON.stringify(rows.map(r => [r.action_code, r.action_name, r.status])))
      assert.equal(find[0].data.webScan.found, 4)
      assert.equal(await dayCount(V.ACTION_CODES.yellowpages), uses.length, 'hạn mức ngày đếm đúng số lần mở trang')
      assert.equal((await inputs(tv.campaign.id))[0].status, 'hoàn thành')
      const records = mod.collectWebScanRecords(rows.map((r, i) => ({ id: i + 1, actionName: r.action_name, status: r.status, data: r.data, createdAt: '', isDelete: false, campaignId: tv.campaign.id })))
      assert.equal(records.length, 4)
      assert.ok(records.every(r => /^0[35789]\d{8}$/.test(r.phone)), 'chỉ số di động')
      log('   trường lấy được', records.map(r => Object.keys(r.fields).sort().join(',')))
      assert.ok(records.some(r => r.fields.taxCode || r.fields.businessType), 'có trường của trang chi tiết')
      const rowsIn = ingested.flatMap(r => r.rows)
      assert.equal(rowsIn.length, 4)
      assert.equal(ingested[0].groupId, 77)
      log('   Info1–5 vào Nhóm data', rowsIn.map(r => [r.info1, r.info2, r.info3, r.info4, r.info5].map(v => String(v ?? '').slice(0, 40))))
      assert.ok(rowsIn.every(r => r.contactType === 'phone' && r.info1 && r.info5 && /^https:\/\/(www\.)?yellowpages\.vn\//.test(r.info5)),
        'Info1 = địa chỉ, Info5 = link hồ sơ')
      assert.ok(rowsIn.every(r => r.extraData?.fields && r.extraData.site === 'yellowpages'))
      const seen = (await one(`SELECT count(*)::int AS n FROM private.auto_web_scan_seen WHERE campaign_id = $1`, [tv.campaign.id])).n
      assert.ok(seen >= 4, 'ghi tin đã quét: ' + seen)
      assert.ok(progress.some(p => p.startsWith('📄 Mở trang Trang Vàng: "bao bì nhựa" ở TP. Hồ Chí Minh (TPHCM), trang 1')), progress.join('\n'))
    })

    await check('Trang Vàng chạy lại cùng từ khoá: bỏ doanh nghiệp đã quét, chỉ lấy doanh nghiệp mới', async () => {
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', date_action = NULL WHERE campaign_id = $1`, [tv.campaign.id])
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = $1`, [tv.campaign.id])
      const before = await details(tv.campaign.id)
      const firstPhones = new Set(mod.collectWebScanRecords(before.map((r, i) => ({ id: i + 1, actionName: r.action_name, status: r.status, data: r.data, createdAt: '', isDelete: false, campaignId: tv.campaign.id }))).map(r => r.phone))
      await run(tv.campaign)
      const rows = (await details(tv.campaign.id)).slice(before.length)
      const find = rows.find(r => r.action_name === 'Tìm data' && r.action_code === null)
      assert.ok(find.data.webScan.seenSkipped >= 3, JSON.stringify(find.data.webScan))
      const again = rows.flatMap(r => Array.isArray(r.data?.webRecords) ? r.data.webRecords : []).filter(r => firstPhones.has(r.phone))
      assert.equal(again.length, 0, 'không lấy lại SĐT của doanh nghiệp đã quét')
    })

    let nt = null
    await check('nhatot: hạn mức 2 lần / ngày → hiện số 2 lần rồi từ khoá về hàng đợi (WB03); lượt sau chờ hạn mức, không bấm thêm', async () => {
      nt = await makeCampaign({ site: 'nhatot', keywords: ['nhà quận 7'], settings: { pagesPerSearch: 1 }, limits: { dailyLimit: 2, rateLimitCount: 2 } })
      const result = await run(nt.campaign)
      const rows = await details(nt.campaign.id)
      const uses = rows.filter(r => r.action_code === V.ACTION_CODES.nhatot)
      assert.equal(uses.length, 2, JSON.stringify(rows.map(r => [r.action_code, r.status, r.log])))
      assert.equal(await dayCount(V.ACTION_CODES.nhatot), 2)
      assert.ok((await outcomes(nt.campaign.id)).some(o => o.error_code === 'err_web_scan_quota_reached'))
      assert.equal((await inputs(nt.campaign.id))[0].status, 'chờ xử lý', 'từ khoá về hàng đợi')
      assert.ok(['wait', 'end_unit', 'no_target'].includes(result.reason), JSON.stringify(result))
      const again = await run(nt.campaign)
      assert.equal(again.reason, 'wait', JSON.stringify(again))
      assert.equal((await details(nt.campaign.id)).filter(r => r.action_code === V.ACTION_CODES.nhatot).length, 2, 'không bấm thêm khi hết hạn mức')
    })

    await check('nhatot chiến dịch khác cùng tổ chức: tin đã hiện số trong 30 ngày thì dùng lại số, không bấm lại', async () => {
      const shown = new Set((await db.query(`SELECT listing_key FROM private.auto_web_scan_listings WHERE organization_id = $1 AND site = 'nhatot'`, [ORG])).rows.map(r => r.listing_key))
      assert.ok(shown.size >= 1, 'đã có số hiện ở chiến dịch trước')
      const second = await makeCampaign({ site: 'nhatot', keywords: ['nhà quận 7'], settings: { pagesPerSearch: 1 }, limits: { dailyLimit: 3, rateLimitCount: 3 } })
      await db.query(`UPDATE public.auto_account_action_status SET count_action_in_day = 0 WHERE account_id = $1 AND action_code = $2`, [ACCOUNT, V.ACTION_CODES.nhatot])
      await db.query(`DELETE FROM public.auto_campaign_details WHERE campaign_id = $1`, [nt.campaign.id])
      await run(second.campaign)
      const rows = await details(second.campaign.id)
      const uses = rows.filter(r => r.action_code === V.ACTION_CODES.nhatot)
      const find = rows.find(r => r.action_name === 'Tìm data' && r.action_code === null)
      assert.ok(find, JSON.stringify(rows.map(r => [r.action_code, r.action_name])))
      assert.ok(find.data.webScan.reused >= 1, JSON.stringify(find.data.webScan))
      assert.ok(find.data.webRecords.every(r => r.reused === true && shown.has(r.listingKey)))
      assert.ok(uses.every(r => !shown.has(r.data?.webScan?.listingKey)), 'không bấm lại tin đã hiện số')
      assert.ok(progress.some(p => /^♻️ Tin ".+" đã có số từ trước: /.test(p)), progress.join('\n'))
    })

    await check('batdongsan chưa đăng nhập: tìm bằng ô tìm của trang (🔎), bấm hiện số gặp hộp đăng nhập → WB02 khoá "Hiện số batdongsan" 30 phút', async () => {
      const bds = await makeCampaign({ site: 'batdongsan', keywords: ['quận 7'], settings: { pagesPerSearch: 1 } })
      await run(bds.campaign)
      assert.ok(progress.some(p => /^🔎 "quận 7" \(bán\): Batdongsan mở trang "/.test(p)), progress.join('\n'))
      assert.ok((await outcomes(bds.campaign.id)).some(o => o.error_code === 'err_web_scan_batdongsan_login'))
      const lock = await lockOf(V.ACTION_CODES.batdongsan)
      assert.equal(lock?.is_disable, true)
      const minutes = (new Date(lock.date_enable).getTime() - Date.now()) / 60_000
      assert.ok(minutes > 25 && minutes <= 31, 'khoá ' + minutes)
      assert.equal((await inputs(bds.campaign.id))[0].status, 'chờ xử lý')
      assert.equal(await dayCount(V.ACTION_CODES.batdongsan), 0, 'lần bấm gặp hộp đăng nhập không tính lượt')
      const again = await run(bds.campaign)
      assert.equal(again.reason, 'wait', JSON.stringify(again))
    })

    await check('tạm dừng giữa từ khoá: dừng sau lần mở trang đang chạy, từ khoá về hàng đợi (RUN01), chiến dịch tạm dừng', async () => {
      const c = await makeCampaign({ site: 'yellowpages', keywords: ['in ấn'], settings: { pagesPerSearch: 3, maxDataPerRun: 500 } })
      const countBefore = await dayCount(V.ACTION_CODES.yellowpages)
      const host = scheduler.engineRunner.host
      const original = host.isPauseRequested
      let paused = false
      host.isPauseRequested = id => paused && id === c.campaign.id
      const timer = setInterval(async () => {
        const n = (await one(`SELECT count(*)::int AS n FROM public.auto_campaign_details WHERE campaign_id = $1`, [c.campaign.id])).n
        if (n >= 1) { paused = true; clearInterval(timer) }
      }, 300)
      try { await run(c.campaign) } finally { clearInterval(timer); host.isPauseRequested = original }
      const out = await outcomes(c.campaign.id)
      log('   kết quả', out)
      const uses = (await details(c.campaign.id)).filter(r => r.action_code === V.ACTION_CODES.yellowpages)
      assert.ok(uses.length >= 1 && uses.length < 3, 'dừng trước khi mở hết 3 trang: ' + uses.length)
      assert.equal((await inputs(c.campaign.id))[0].status, 'chờ xử lý', 'từ khoá về hàng đợi')
      assert.equal((await facade.getCampaign(c.campaign.id)).status, 'tạm dừng')
      assert.equal(await dayCount(V.ACTION_CODES.yellowpages) - countBefore, uses.length, 'lần dừng vì tạm dừng không tính lượt')
    })

    await check('thoát app giữa lúc đang chạy block: lượt dừng ngay, từ khoá về hàng đợi; mở lại chạy tiếp, không lấy lại SĐT đã lấy', async () => {
      const c = await makeCampaign({ site: 'yellowpages', keywords: ['cơ khí'], settings: { pagesPerSearch: 2, maxDataPerRun: 500 } })
      const countBefore = await dayCount(V.ACTION_CODES.yellowpages)
      const timer = setInterval(async () => {
        const n = (await one(`SELECT count(*)::int AS n FROM public.auto_campaign_details WHERE campaign_id = $1`, [c.campaign.id])).n
        if (n >= 1) { clearInterval(timer); setTimeout(() => scheduler.engineRunner.abortAll(), 1500) }
      }, 300)
      try { await run(c.campaign) } finally { clearInterval(timer) }
      const first = await details(c.campaign.id)
      log('   kết quả lượt bị ngắt', await outcomes(c.campaign.id))
      assert.equal((await inputs(c.campaign.id))[0].status, 'chờ xử lý', 'từ khoá về hàng đợi')
      const open = (await one(`SELECT count(*)::int AS n FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND completed_at IS NULL`, [c.campaign.id])).n
      assert.equal(open, 0, 'không để lượt mở')
      const lease = (await one(`SELECT count(*)::int AS n FROM public.auto_engine_leases WHERE account_id = $1`, [ACCOUNT])).n
      assert.equal(lease, 0, 'đã nhả tài khoản')
      const firstKeys = new Set(first.flatMap(r => Array.isArray(r.data?.webRecords) ? r.data.webRecords.map(x => x.listingKey) : []))
      await run(c.campaign)
      assert.equal((await inputs(c.campaign.id))[0].status, 'hoàn thành')
      const rows = (await details(c.campaign.id)).slice(first.length)
      // Bỏ trùng theo tin (mã hồ sơ), không theo số: doanh nghiệp khác cùng số vẫn được lấy.
      const again = rows.flatMap(r => Array.isArray(r.data?.webRecords) ? r.data.webRecords : []).filter(r => firstKeys.has(r.listingKey) && !r.reused)
      assert.equal(again.length, 0, 'không lấy lại doanh nghiệp đã lấy ở lượt bị ngắt')
      const usesAll = (await details(c.campaign.id)).filter(r => r.action_code === V.ACTION_CODES.yellowpages).length
      assert.equal(await dayCount(V.ACTION_CODES.yellowpages) - countBefore, usesAll, 'lần dừng vì thoát app không tính lượt')
    })

    await check('tổ chức bị tắt web_scan.campaigns giữa phiên: claim not_enabled, không chạy gì, không rơi về bộ cũ', async () => {
      const c = await makeCampaign({ site: 'yellowpages', keywords: ['nhựa'], settings: { pagesPerSearch: 1 } })
      await db.query(`UPDATE public.auto_system_settings SET value = $2 WHERE key = $1`, [V.SETTING_KEY, JSON.stringify({ organizationIds: [] })])
      try {
        const result = await scheduler.engineRunner.run(account, c.campaign)
        assert.equal(result.reason, 'not_enabled', JSON.stringify(result))
        assert.equal((await details(c.campaign.id)).length, 0)
        assert.deepEqual(scheduler.engineRunner.support(account, c.campaign), { ok: false, reason: 'not_enabled' })
        await scheduler.runAccountCampaignQueue(account, [c.campaign])
        assert.equal(legacyRuns.length, 0, 'không chạy bộ cũ')
        assert.equal((await inputs(c.campaign.id))[0].status, 'chờ xử lý')
      } finally {
        await db.query(`UPDATE public.auto_system_settings SET value = $2 WHERE key = $1`, [V.SETTING_KEY, V.SETTING_VALUE])
      }
    })



    await check('app chết ngang khi đang quét (mất kết nối DB rồi tắt, không kịp báo): đăng nhập lại trả từ khoá về hàng đợi, lease cũ hết hạn thì chạy tiếp phần còn lại, không lấy lại tin đã lấy', async () => {
      const c = await makeCampaign({ site: 'yellowpages', keywords: ['thép'], settings: { pagesPerSearch: 2, maxDataPerRun: 500 } })
      const realClient = globalThis.__webSim.client
      const deadClient = { rpc: () => { const p = Promise.resolve({ data: null, error: { message: 'TypeError: fetch failed' }, status: 0 }); return { abortSignal: () => p, then: (a, b) => p.then(a, b) } },
        from: () => { const b = { select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, abortSignal: () => b,
          maybeSingle: () => b, single: () => b, then: (a, r) => Promise.resolve({ data: null, error: { message: 'TypeError: fetch failed' } }).then(a, r) }; return b } }
      const timer = setInterval(async () => {
        const n = (await one(`SELECT count(*)::int AS n FROM public.auto_campaign_details WHERE campaign_id = $1`, [c.campaign.id])).n
        if (n >= 1) {
          clearInterval(timer)
          globalThis.__webSim.client = deadClient
          setTimeout(() => scheduler.engineRunner.abortAll(), 800)
        }
      }, 300)
      try { await scheduler.engineRunner.run(account, await facade.getCampaign(c.campaign.id)) } catch (error) { log('   lượt ném lỗi', String(error.message || error)) } finally {
        clearInterval(timer)
        globalThis.__webSim.client = realClient
      }
      const openRuns = (await one(`SELECT count(*)::int AS n FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND completed_at IS NULL`, [c.campaign.id])).n
      const lease = await one(`SELECT runner_id, expires_at > now() AS live FROM public.auto_engine_leases WHERE account_id = $1`, [ACCOUNT])
      log('   sau khi chết ngang: lượt mở', openRuns, 'lease', lease, 'data', await inputs(c.campaign.id))
      // Đăng nhập lại: hàm dọn lượt engine của Desktop (V576 A, gọi trong reset_desktop_running_statuses_no_retry) như một tiến trình mới.
      const closed = (await one(`SELECT public.aka_agent_engine_close_desktop_runs_v1($1) AS n`, [STAFF])).n
      log('   đóng lượt bỏ dở', closed, 'data', await inputs(c.campaign.id))
      assert.equal(closed, 1)
      // V618 vá close_run_v1: lượt quét web bỏ dở thì từ khoá về hàng đợi dù đã có kết quả (lần mở trang 1 đã ghi).
      const after = (await inputs(c.campaign.id))[0]
      assert.equal(after.status, 'chờ xử lý')
      assert.match(String(after.note), /SYS01/)
      const firstKeys = new Set((await details(c.campaign.id)).flatMap(r => Array.isArray(r.data?.webRecords) ? r.data.webRecords.map(x => x.listingKey) : []))
      const rowsBefore = (await details(c.campaign.id)).length
      // Mở lại app: lease của tiến trình cũ hết hạn (không còn heartbeat) thì lần nhận sau lấy được tài khoản, quét tiếp từ khoá dở.
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 minute' WHERE account_id = $1`, [ACCOUNT])
      const again = await run(c.campaign)
      assert.equal(again.reason, 'no_target', JSON.stringify(again))
      const done = (await inputs(c.campaign.id))[0]
      assert.equal(done.status, 'hoàn thành')
      assert.equal(done.note, null, 'chốt thành công thì xoá ghi chú bị ngắt')
      const rows = (await details(c.campaign.id)).slice(rowsBefore)
      // Dòng tổng kết của lượt bị ngắt (nhật ký engine gửi bù khi mở lại) có stopReason interrupted; lấy dòng của lượt chạy lại.
      const find = rows.filter(r => r.action_code === null && r.action_name === 'Tìm data' && r.data?.webScan && r.data.webScan.stopReason !== 'interrupted').at(-1)
      assert.ok(find.data.webScan.seenSkipped >= 1, 'bỏ tin đã quét ở lượt bị ngắt: ' + JSON.stringify(find.data.webScan))
      const repeated = rows.flatMap(r => Array.isArray(r.data?.webRecords) ? r.data.webRecords : []).filter(r => firstKeys.has(r.listingKey) && !r.reused)
      assert.equal(repeated.length, 0, 'không lấy lại tin đã lấy')
    })

    // Lỗi trên trang: chuyển hướng yêu cầu của cửa sổ chạy ngầm sang máy chủ cục bộ (trang không còn thẻ tin, máy chủ từ chối, trang treo).
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/hang')) return // không trả lời
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><title>Trang Vàng giao diện mới</title></head><body><h1>Danh bạ doanh nghiệp</h1><p>Giao diện mới</p></body></html>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const local = `http://127.0.0.1:${server.address().port}`
    const redirectYellowPages = target => win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://www.yellowpages.vn/srch/*'] },
      (_details, callback) => callback(target ? { redirectURL: target } : {}))
    const clearRedirect = () => win.webContents.session.webRequest.onBeforeRequest(null)

    await check('Trang Vàng đổi giao diện (WB04): mỗi từ khoá một dòng lỗi, không tính lượt; 3 từ khoá liền thì tạm dừng chiến dịch', async () => {
      const c = await makeCampaign({ site: 'yellowpages', keywords: ['nhựa A', 'nhựa B', 'nhựa C', 'nhựa D'], settings: { pagesPerSearch: 1 } })
      const countBefore = await dayCount(V.ACTION_CODES.yellowpages)
      redirectYellowPages(`${local}/new-layout`)
      try { await run(c.campaign) } finally { clearRedirect() }
      const rows = await details(c.campaign.id)
      log('   dòng lịch sử', rows.map(r => [r.action_code, r.action_name, r.status, r.log]))
      const failedRows = rows.filter(r => r.status === 'thất bại')
      assert.equal(failedRows.length, 3, 'ba từ khoá lỗi')
      assert.ok(failedRows.every(r => r.action_code === null && r.action_name === 'Tìm data'))
      assert.equal(await dayCount(V.ACTION_CODES.yellowpages) - countBefore, 0, 'trang không đọc được không tính lượt')
      const ins = await inputs(c.campaign.id)
      assert.deepEqual(ins.map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'chờ xử lý'])
      const camp = await facade.getCampaign(c.campaign.id)
      assert.equal(camp.status, 'tạm dừng')
      log('   ghi chú chiến dịch', camp.note)
      assert.match(String(camp.note), /WB04/)
    })

    await check('máy chủ từ chối kết nối (NET01): từ khoá về hàng đợi, không tính lượt, lượt kết thúc', async () => {
      const c = await makeCampaign({ site: 'yellowpages', keywords: ['nhựa E'], settings: { pagesPerSearch: 1 } })
      const countBefore = await dayCount(V.ACTION_CODES.yellowpages)
      redirectYellowPages('http://127.0.0.1:1/refused')
      let result
      try { result = await run(c.campaign) } finally { clearRedirect() }
      const out = await outcomes(c.campaign.id)
      log('   kết quả', out)
      assert.ok(out.some(o => o.error_code === 'err_network_offline'), JSON.stringify(out))
      assert.equal((await inputs(c.campaign.id))[0].status, 'chờ xử lý')
      assert.equal(await dayCount(V.ACTION_CODES.yellowpages) - countBefore, 0)
      const camp = await one(`SELECT status, note, schedule FROM public.auto_campaigns WHERE id = $1`, [c.campaign.id])
      const contrib = (await one(`SELECT decision->'contrib' AS c FROM public.auto_engine_outcomes WHERE campaign_id = $1 AND NOT ok`, [c.campaign.id])).c
      log('   chiến dịch sau NET01', camp, 'quyết định', contrib, 'lượt', result)
      assert.notEqual(camp.status, 'đang chạy')
    })

    await check('trang treo không trả lời: hết 30 giây chờ mở trang thì NET01, từ khoá về hàng đợi', async () => {
      const c = await makeCampaign({ site: 'yellowpages', keywords: ['nhựa F'], settings: { pagesPerSearch: 1 } })
      redirectYellowPages(`${local}/hang`)
      const started = Date.now()
      try { await run(c.campaign) } finally { clearRedirect() }
      const seconds = (Date.now() - started) / 1000
      const out = await outcomes(c.campaign.id)
      log('   kết quả sau', seconds.toFixed(0), 'giây', out)
      assert.ok(seconds < 90, 'không treo quá lâu')
      assert.ok(out.some(o => o.error_code === 'err_network_offline'), JSON.stringify(out))
      assert.equal((await inputs(c.campaign.id))[0].status, 'chờ xử lý')
    })
    server.close()

    await check('hạn mức ngày khớp số dòng tính lượt (Trang Vàng, batdongsan)', async () => {
      for (const code of [V.ACTION_CODES.yellowpages, V.ACTION_CODES.batdongsan]) assert.equal(await dayCount(code), await usedRows(code), code)
    })

    const rpcErrors = calls.filter(c => c[0] === 'rpc_error')
    console.log('\nRPC lỗi trong lúc chạy:', rpcErrors.length ? '' : 'không có')
    for (const e of rpcErrors) console.log('  ', e.join(' | '))
    console.log('Hàm facade chưa giả lập được gọi:', [...new Set(facadeCalls.map(c => c[0]))].join(', ') || 'không có')
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop?.()
    try { win.destroy() } catch { /* đã đóng */ }
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  app.exit(failed > 0 ? 1 : 0)
}

app.whenReady().then(() => main().catch(error => { console.error(mask(error.stack || error)); app.exit(1) }))
