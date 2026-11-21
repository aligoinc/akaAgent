#!/usr/bin/env node
// Đẩy SĐT của chiến dịch Tìm data website (V618) sang chiến dịch "Nhắn tin theo SĐT" và Nhóm data, trên PostgreSQL 17 cục bộ (không chạm DB thật):
//   LC_ALL=C CHAT_REPO=<akaAgentChatApi> node scripts/web-scan/push-smoke.cjs
// DB: fixture của bài kiểm V608 (scripts/find-data-push/fixture_v608.sql) + nguyên văn V608 → V610 → V614, nên hàm đẩy
// aka_agent_find_data_push_v1 và các hàm khoá trùng giống production (so md5 thân hàm đọc chỉ đọc tối 21/11/2026); thêm ba loại chiến dịch web
// rồi chạy nguyên văn khối quy tắc đẩy của migration V618 p3 (đọc từ file migration). Mã app: lớp CampaignScheduler thật (dựng bằng esbuild)
// gọi pushWebScanRecords → findDataPushRepository / dataGroupRepository thật; client Supabase giả chạy hàm đẩy trên PG cục bộ bằng phiên
// Desktop của nhân viên, còn hàm nạp Nhóm data (không có trong DB thử) thì ghi lại tham số gửi lên.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')

const ROOT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.WEB_PUSH_PORT || 55618)
// Production 21/11/2026 (chỉ đọc, sổ migration tới v617): md5(prosrc).
const PROD_MD5 = {
  'public.aka_agent_find_data_push_v1(jsonb)': 'a9298a62cd6860f32bb2001b5f52388e',
  'private.aka_agent_find_data_match_key(text,text)': 'eced466b2910026db6c75178da5b09d1',
  'private.aka_agent_find_data_match_tokens(text,text)': '4358d2a568d9ad08addcdffc15262af2',
  'private.aka_agent_find_data_link_block_reason(bigint,bigint,bigint,bigint,text[])': 'be9f7a8d6a57edd888f70f3b8d46dc49',
  'private.aka_agent_find_data_link_target_ids(jsonb,text,bigint)': 'f906869df7ed2949a060803e1051d3f4'
}
const PROD_RULES = 11

let passed = 0
let failed = 0
const results = []
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
  results.push(name)
}

const STUBS = {
  electron: `
const handler = { get(target, key) { if (key === '__esModule') return false; return target[key] ?? (target[key] = new Proxy(function Stub() {}, handler)) },
  apply() { return new Proxy(function Stub() {}, handler) }, construct() { return new Proxy(function Stub() {}, handler) } }
const stub = () => new Proxy(function Stub() {}, handler)
const names = ['BrowserWindow', 'webContents', 'ipcMain', 'powerMonitor', 'session', 'net', 'dialog', 'shell', 'Notification', 'screen',
  'nativeImage', 'clipboard', 'Menu', 'Tray', 'systemPreferences', 'protocol', 'crashReporter', 'nativeTheme', 'safeStorage', 'contentTracing',
  'desktopCapturer', 'globalShortcut', 'inAppPurchase', 'MessageChannelMain', 'powerSaveBlocker', 'utilityProcess', 'WebContentsView', 'BaseWindow']
const electron = { app: { getPath: () => globalThis.__webPush.userData, getVersion: () => '0.0.0-webpush', isPackaged: false, getName: () => 'aka-webpush',
  on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => globalThis.__webPush.userData } }
for (const name of names) electron[name] = stub()
module.exports = electron`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__webPush.client, desktopFetch: fetch }`,
  currentUser: `module.exports = { getCurrentUser: () => globalThis.__webPush.user, requireCurrentUser: () => globalThis.__webPush.user,
    requireCurrentUserCredentials: () => ({ username: 'web', password: 'pw' }), getCurrentUserCredentials: () => ({ username: 'web', password: 'pw' }),
    setCurrentUser() {}, setCurrentUserCredentials() {}, onCurrentUserSessionChanged: () => () => {}, runWithCurrentUser: (_u, op) => op(),
    isZaloServerUser: () => false, isZaloShowWebUser: () => false, isCurrentUserZaloShowWeb: () => false, isCurrentUserZaloServerEnabled: () => false }`,
  elementV2Repository: `module.exports = { resolveXpathByName: async () => { throw new Error('không dùng') }, invalidateElementCache() {} }`,
  workflowV2Repository: `module.exports = { getWorkflow: async () => null, getWorkflowByName: async () => null }`,
  blockRepository: `module.exports = { getBlock: async () => null }`,
  runV2Repository: `module.exports = { createRun: async () => 1, updateRun: async () => undefined, createRunStep: async () => 1, updateRunStep: async () => undefined }`,
  facebookPageIdentityRepository: `module.exports = { validateCampaignPageIdentity: async () => undefined }`,
  entry: `export * from ${JSON.stringify(path.join(ROOT, 'src/main/services/campaignScheduler.ts'))}
export { pushFindDataToLinkedCampaigns, resetFindDataPushAvailabilityForTest } from ${JSON.stringify(path.join(ROOT, 'src/main/data/repositories/findDataPushRepository.ts'))}
export { ingestDataGroup } from ${JSON.stringify(path.join(ROOT, 'src/main/data/repositories/dataGroupRepository.ts'))}
export { normalizeWebScanCampaignSettings } from ${JSON.stringify(path.join(ROOT, 'src/shared/webScan.ts'))}`
}

async function loadScheduler() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-web-push-'))
  const outfile = path.join(out, 'scheduler.cjs')
  await build({
    entryPoints: ['entry'], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', packages: 'external',
    banner: { js: `require = require('node:module').createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});` },
    plugins: [{ name: 'web-push', setup(plugin) {
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

/** Khối DO $rules$ … END $rules$; nguyên văn trong file migration / bản gỡ (đúng một khối). */
function rulesBlock(file) {
  const text = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8')
  const blocks = text.match(/DO \$rules\$[\s\S]*?END \$rules\$;/g) || []
  assert.equal(blocks.length, 1, `${file}: cần đúng một khối quy tắc đẩy`)
  return blocks[0]
}

const STAFF = 1
const ORG = 100
const ACCOUNT = { id: 96301, name: 'Website 1', flatformType: 'web', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: STAFF, organizationId: ORG }
const GROUP = { groupId: 77, groupName: 'Nhóm SĐT web' }
const INFO_MAP = { info1: 'address', info2: 'price', info5: 'link' }

async function main() {
  const mod = await loadScheduler()
  const cluster = startCluster({ port: PORT, label: 'aka-web-push-', timeoutMs: 10 * 60_000 })
  const db = await cluster.connect()
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows
  const runFile = async file => db.query(fs.readFileSync(path.join(ROOT, file), 'utf8'))
  try {
    // DB như production: fixture V608 + V608 → V610 → V614 (sổ migration như test_v608.sh).
    await runFile('scripts/find-data-push/fixture_v608.sql')
    await runFile('scripts/find-data-push/seed_v608.sql')
    await runFile('migrations/migration_v608_find_data_push_links.sql')
    await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121072153', 'migration_v608_find_data_push_links')`)
    await runFile('migrations/migration_v610_find_data_push_match_key.sql')
    await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121083934', 'migration_v610_find_data_push_match_key')`)
    await runFile('migrations/migration_v614_find_data_push_match_key_v2.sql')
    // Ba loại chiến dịch web như V618 p3 (bảng auto_campaign_actions của fixture chỉ có các cột hàm đẩy đọc).
    await db.query(`INSERT INTO public.auto_campaign_actions (id, name, flatform_type, is_active) VALUES
      ('web_find_data_nhatot', 'Tìm data Nhà Tốt', 'web', false), ('web_find_data_batdongsan', 'Tìm data Batdongsan', 'web', false),
      ('web_find_data_yellowpages', 'Tìm data Trang Vàng', 'web', false)`)
    await db.query(rulesBlock('migration_v618_web_data_scan_p3.sql'))

    // Chiến dịch: đích "Nhắn tin theo SĐT" và ba nguồn web của nhân viên 1.
    const campaign = (id, name, actionId, extra = {}, more = {}) => db.query(`INSERT INTO public.auto_campaigns
      (id, name, action_id, staff_id, organization_id, status, is_delete, data_target_source_mode, extra_settings)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`, [id, name, actionId, more.staff ?? STAFF, more.org ?? ORG, more.status ?? 'chờ xử lý',
      more.deleted ?? false, more.mode ?? 'direct', JSON.stringify(extra)])
    await campaign(201, 'Zalo đích A', 'zalo_message_phone', {}, { status: 'hoàn thành' })
    await campaign(202, 'Zalo đích chạy bằng Nhóm data', 'zalo_message_phone', {}, { mode: 'data_group' })
    await campaign(203, 'Zalo đích đã xoá', 'zalo_message_phone', {}, { deleted: true, status: 'tạm dừng' })
    await campaign(204, 'Zalo đích của người khác', 'zalo_message_phone', {}, { staff: 2, org: 200 })
    await campaign(205, 'Zalo đích B', 'zalo_message_phone')
    await db.query(`INSERT INTO public.auto_campaign_input_data (campaign_id, phone, name) VALUES (201, '0912 345 678', 'Khách cũ')`)
    const webExtra = (site, targets, group = true) => ({ webScan: { site, infoMap: INFO_MAP }, isFindPhone: true,
      findPhoneZaloMessagePhoneTargetCampaignIds: targets, ...(group ? { findDataTargetDataGroups: { phone: GROUP } } : {}) })
    await campaign(211, 'Tìm data Nhà Tốt Q7', 'web_find_data_nhatot', webExtra('nhatot', [201, 202, 203, 204]))
    await campaign(212, 'Tìm data Batdongsan Q7', 'web_find_data_batdongsan', webExtra('batdongsan', [201], false))
    await campaign(213, 'Tìm data Trang Vàng nhựa', 'web_find_data_yellowpages', webExtra('yellowpages', [201, 205], false))
    await campaign(214, 'Tìm data Nhà Tốt chưa chọn đích', 'web_find_data_nhatot', webExtra('nhatot', [], false))

    // Client Supabase giả: hàm đẩy chạy thật trên PG với phiên Desktop của nhân viên 1; hàm nạp Nhóm data thì ghi lại.
    const rpcCalls = []
    const ingestCalls = []
    const state = { pushFailures: [], ingestError: null }
    const client = {
      rpc(name, args) {
        const run = (async () => {
          rpcCalls.push({ name, args })
          if (name === 'aka_agent_ingest_data_group') {
            ingestCalls.push(args)
            if (state.ingestError) return { data: null, error: state.ingestError }
            const n = args.p_rows.length
            return { data: [{ request_id: args.p_request_id, batch_id: ingestCalls.length, group_id: args.p_group_id, group_revision: ingestCalls.length,
              inserted_membership_count: n, reactivated_membership_count: 0, already_member_count: 0, invalid_count: 0, incompatible_count: 0,
              conflict_count: 0, conflicts: [] }], error: null }
          }
          if (name !== 'aka_agent_find_data_push_v1') return { data: null, error: { message: `rpc chưa giả lập: ${name}`, code: 'XX000' } }
          if (state.pushFailures.length > 0) return { data: null, error: state.pushFailures.shift() }
          try {
            await db.query('BEGIN')
            await db.query(`SELECT set_config('test.staff_id', $1, true)`, [String(STAFF)])
            await db.query('SET LOCAL ROLE aka_agent_desktop')
            const r = await db.query('SELECT public.aka_agent_find_data_push_v1($1::jsonb) AS r', [JSON.stringify(args.p_payload)])
            await db.query('COMMIT')
            return { data: r.rows[0].r, error: null }
          } catch (e) {
            await db.query('ROLLBACK').catch(() => undefined)
            return { data: null, error: { message: e.message, code: e.code } }
          }
        })()
        return { abortSignal: () => run, then: (a, b) => run.then(a, b) }
      },
      from(table) { throw new Error(`from(${table}) không dùng trong bài kiểm này`) }
    }
    globalThis.__webPush = {
      userData: fs.mkdtempSync(path.join(os.tmpdir(), 'aka-web-push-userdata-')), client,
      user: { staffId: STAFF, organizationId: ORG, webScanEnabled: true, campaignEngineV2: false, facebookEngineV2: false,
        entitlements: { facebookCore: true, facebookFanpage: false, email: false, zalo: true, sms: false } }
    }

    const progress = []
    const facadeCalls = []
    const mapCampaign = row => row && ({ id: Number(row.id), name: row.name, actionId: row.action_id, accountId: ACCOUNT.id, accountName: ACCOUNT.name,
      staffId: Number(row.staff_id), organizationId: Number(row.organization_id), status: row.status, extraSettings: row.extra_settings || {},
      isDelete: row.is_delete, dataTargetSourceMode: row.data_target_source_mode, updatedAt: row.updated_at })
    const getCampaign = async id => mapCampaign(await one('SELECT * FROM public.auto_campaigns WHERE id = $1 AND staff_id = $2', [id, STAFF]))
    const facade = new Proxy({
      getCampaign,
      appendCampaignLog: async (id, message) => {
        progress.push({ campaignId: Number(id), message })
        const row = await one('SELECT id, name FROM public.auto_campaigns WHERE id = $1', [id])
        return { id: Number(row.id), name: row.name, accountId: ACCOUNT.id, accountName: ACCOUNT.name }
      },
      listDataTypeCategoryItems: async () => (await rows(`SELECT ci.id, ci.code, ci.name FROM public.category_item ci
        JOIN public.category_type ct ON ct.id = ci.category_type_id WHERE ct.code = 'data_type'`)).map(r => ({ ...r, id: Number(r.id) })),
      ingestDataGroup: request => mod.ingestDataGroup(request),
      pushFindDataToLinkedCampaigns: request => mod.pushFindDataToLinkedCampaigns(request)
    }, { get(target, key) { if (key in target) return target[key]; return async (...args) => { facadeCalls.push(String(key)); return null } } })

    const mainWindow = { webContents: { send() {} }, isDestroyed: () => false }
    const webviewRegistry = { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null }
    const newScheduler = () => {
      const scheduler = new mod.CampaignScheduler(facade, webviewRegistry, mainWindow, undefined, undefined, undefined, { runtimeTarget: 'desktop' })
      scheduler.running = true
      scheduler.broadcasts = []
      scheduler.broadcastCampaignUpdate = campaignRow => scheduler.broadcasts.push(campaignRow.id)
      scheduler.sendLog = () => undefined
      return scheduler
    }
    let scheduler = newScheduler()
    let runSeq = 0
    const push = async (campaignId, records, inputDataId = 9000 + campaignId) => {
      progress.length = 0
      rpcCalls.length = 0
      ingestCalls.length = 0
      const c = await getCampaign(campaignId)
      const settings = mod.normalizeWebScanCampaignSettings(c.extraSettings.webScan, c.extraSettings.webScan.site)
      await scheduler.pushWebScanRecords(ACCOUNT, c, settings, inputDataId, ++runSeq, records)
      return progress.map(p => p.campaignId === campaignId ? p.message : `[${p.campaignId}] ${p.message}`)
    }
    const rec = (site, phone, extra = {}) => ({ site, phone, name: 'Anh ' + phone.slice(-3), listingKey: `${site}:${phone}`,
      link: `https://example.test/${site}/${phone}`, section: site === 'yellowpages' ? null : 'sale',
      fields: { address: 'Quận 7, TP.HCM', price: '5 tỷ', title: 'Nhà ' + phone.slice(-3) }, ...extra })
    const targetPhones = async id => (await rows(`SELECT phone FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND NOT is_delete ORDER BY id`, [id]))
      .map(r => r.phone)
    const pushRpcs = () => rpcCalls.filter(c => c.name === 'aka_agent_find_data_push_v1')

    await check('DB như production: thân hàm đẩy khớp md5 production 21/11, V618 p3 thêm đúng 3 quy tắc web', async () => {
      for (const [sig, md5] of Object.entries(PROD_MD5)) {
        assert.equal((await one(`SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = $1::regprocedure`, [sig])).m, md5, sig)
      }
      const rules = await rows(`SELECT source_action_id, output_kind, source_flag, link_field, target_action_id, data_type_category_item_id, value_column, label
        FROM public.auto_campaign_data_link_rules ORDER BY id`)
      assert.equal(rules.length, PROD_RULES + 3)
      const web = rules.filter(r => r.source_action_id.startsWith('web_find_data_'))
      assert.deepEqual(web.map(r => r.source_action_id).sort(), ['web_find_data_batdongsan', 'web_find_data_nhatot', 'web_find_data_yellowpages'])
      for (const r of web) {
        assert.deepEqual({ ...r, source_action_id: undefined, data_type_category_item_id: Number(r.data_type_category_item_id) },
          { source_action_id: undefined, output_kind: 'phone', source_flag: 'isFindPhone', link_field: 'findPhoneZaloMessagePhoneTargetCampaignIds',
            target_action_id: 'zalo_message_phone', data_type_category_item_id: 34, value_column: 'phone', label: 'SĐT' })
      }
    })

    const firstBatch = [rec('nhatot', '0901234561'), rec('nhatot', '0901234562', { email: 'khach@example.test' }),
      rec('nhatot', '0912345678', { reused: true })]
    await check('Nhà Tốt đẩy 3 SĐT: thêm 2 vào đích (bỏ số đã có dù viết khác), mở lại đích "hoàn thành", báo 3 đích không nhận', async () => {
      const lines = await push(211, firstBatch)
      assert.equal(pushRpcs().length, 1)
      const payload = pushRpcs()[0].args.p_payload
      assert.equal(payload.sourceCampaignId, 211)
      assert.equal(payload.outputKind, 'phone')
      assert.equal(payload.sourceInputDataId, 9211)
      assert.equal(payload.sourceDetailId, null)
      assert.ok(payload.allowedTargetActionIds.includes('zalo_message_phone'))
      assert.deepEqual(payload.items.map(i => i.name), ['Anh 561', 'Anh 562', 'Anh 678'])
      assert.deepEqual(await targetPhones(201), ['0912 345 678', '0901234561', '0901234562'])
      const added = await rows(`SELECT name, status, note FROM public.auto_campaign_input_data WHERE campaign_id = 201 AND phone = '0901234561'`)
      assert.deepEqual(added, [{ name: 'Anh 561', status: 'chờ xử lý', note: 'Đã thêm từ chiến dịch "Tìm data Nhà Tốt Q7"' }])
      assert.equal((await one(`SELECT status FROM public.auto_campaigns WHERE id = 201`)).status, 'chờ xử lý')
      assert.deepEqual(scheduler.broadcasts, [201])
      for (const id of [202, 203, 204]) assert.deepEqual(await targetPhones(id), [], `đích ${id} không nhận`)
      const expected = [
        '✅ Đã đẩy 3 SĐT sang Nhóm data "Nhóm SĐT web" (3 mới).',
        '✅ Đã đẩy 2 SĐT sang chiến dịch "Zalo đích A" (bỏ qua 1 SĐT đã có ở chiến dịch đó)',
        '[201] ✅ Đã nhận 2 SĐT từ chiến dịch "Tìm data Nhà Tốt Q7"',
        '⚠️ Không đẩy được SĐT sang chiến dịch "Zalo đích chạy bằng Nhóm data": chiến dịch này đang chạy bằng Nhóm data. Hãy chọn "Đẩy SĐT sang Nhóm data" với nhóm của chiến dịch đó.',
        '⚠️ Không đẩy được SĐT sang chiến dịch "Zalo đích đã xoá": chiến dịch này đã bị xoá. Hãy bỏ chiến dịch này khỏi mục xử lý data tìm được.',
        '⚠️ Không đẩy được SĐT sang chiến dịch #204: không tìm thấy chiến dịch này.'
      ]
      for (const line of expected) assert.ok(lines.includes(line), `thiếu dòng: ${line}\n--- có:\n${lines.join('\n')}`)
      const links = await rows(`SELECT target_campaign_id AS t, status, block_reason AS r, inserted_count AS i, existing_count AS e
        FROM public.auto_campaign_data_links WHERE source_campaign_id = 211 ORDER BY target_campaign_id`)
      assert.deepEqual(links.map(l => [Number(l.t), l.status, l.r, Number(l.i), Number(l.e)]), [
        [201, 'active', null, 2, 1], [202, 'blocked', 'target_data_group_mode', 0, 0], [203, 'blocked', 'target_deleted', 0, 0],
        [204, 'blocked', 'target_other_owner', 0, 0]])
    })

    await check('Nhóm data: dòng gửi lên đúng (loại SĐT, Info theo lựa chọn, email, extra_data của tin), cùng lô thì cùng mã yêu cầu', async () => {
      await push(211, firstBatch)
      const first = structuredClone(ingestCalls[0])
      assert.equal(ingestCalls.length, 1)
      assert.equal(first.p_kind, 'scan')
      assert.equal(first.p_group_id, 77)
      assert.equal(first.p_data_type_category_item_id, 34)
      assert.equal(first.p_source_account_id, ACCOUNT.id)
      assert.equal(first.p_source_name, 'Chiến dịch tìm data: Tìm data Nhà Tốt Q7')
      assert.match(first.p_request_id, /^web-scan:211:9211:\d+:77:[0-9a-f]{24}:v1$/)
      const row = first.p_rows[1]
      assert.deepEqual({ ...row, extra_data: undefined }, { contact_id: null, source_account_id: ACCOUNT.id, relationship_kind: null, contact_type: 'phone',
        flatform_type: null, name: 'Anh 562', uid: null, url: null, phone: '0901234562', email: 'khach@example.test', info1: 'Quận 7, TP.HCM',
        info2: '5 tỷ', info3: null, info4: null, info5: 'https://example.test/nhatot/0901234562', extra_data: undefined })
      assert.deepEqual(row.extra_data, { sourceCampaignId: 211, sourceCampaignActionId: 'web_find_data_nhatot', sourceInputDataId: 9211, site: 'nhatot',
        listingKey: 'nhatot:0901234562', link: 'https://example.test/nhatot/0901234562', section: 'sale', reused: false,
        fields: { address: 'Quận 7, TP.HCM', price: '5 tỷ', title: 'Nhà 562' } })
      assert.equal(first.p_rows[2].extra_data.reused, true)
      // Cùng data và cùng lượt (bộ chạy gửi lại sau lỗi mạng): cùng mã yêu cầu nên DB trả lại kết quả cũ, không thêm trùng.
      runSeq -= 1
      await push(211, firstBatch)
      assert.equal(ingestCalls[0].p_request_id, first.p_request_id)
    })

    await check('Lượt sau cùng SĐT: không thêm vào đích, một dòng ℹ️; cảnh báo đích không nhận không lặp trong 1 giờ', async () => {
      const lines = await push(211, firstBatch)
      assert.deepEqual(await targetPhones(201), ['0912 345 678', '0901234561', '0901234562'])
      assert.deepEqual(lines.filter(l => !l.includes('Nhóm data "Nhóm SĐT web"')),
        ['ℹ️ SĐT: 3 SĐT đã có ở chiến dịch "Zalo đích A" nên không thêm lại.'])
    })

    await check('Ba trang cùng đẩy vào một đích: mỗi SĐT một dòng, sổ đẩy đúng từng nguồn', async () => {
      const bds = await push(212, [rec('batdongsan', '0901234561'), rec('batdongsan', '0901234563')])
      assert.ok(bds.includes('✅ Đã đẩy 1 SĐT sang chiến dịch "Zalo đích A" (bỏ qua 1 SĐT đã có ở chiến dịch đó)'), bds.join('\n'))
      assert.equal(ingestCalls.length, 0, 'chiến dịch không chọn Nhóm data thì không nạp nhóm')
      const tv = await push(213, [rec('yellowpages', '0901234563'), rec('yellowpages', '0901234564')])
      assert.ok(tv.includes('✅ Đã đẩy 1 SĐT sang chiến dịch "Zalo đích A" (bỏ qua 1 SĐT đã có ở chiến dịch đó)'), tv.join('\n'))
      assert.ok(tv.includes('✅ Đã đẩy 2 SĐT sang chiến dịch "Zalo đích B"'), tv.join('\n'))
      const phones = await targetPhones(201)
      assert.equal(new Set(phones).size, phones.length)
      assert.deepEqual(phones, ['0912 345 678', '0901234561', '0901234562', '0901234563', '0901234564'])
      assert.deepEqual(await targetPhones(205), ['0901234563', '0901234564'])
      const ledger = await rows(`SELECT source_campaign_id AS s, target_campaign_id AS t, result, count(*)::int AS n FROM public.auto_campaign_data_link_deliveries
        WHERE source_campaign_id BETWEEN 211 AND 213 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)
      assert.deepEqual(ledger.map(r => [Number(r.s), Number(r.t), r.result, r.n]), [
        [211, 201, 'existing', 1], [211, 201, 'inserted', 2], [212, 201, 'existing', 1], [212, 201, 'inserted', 1],
        [213, 201, 'existing', 1], [213, 201, 'inserted', 1], [213, 205, 'inserted', 2]])
    })

    await check('Chiến dịch web chưa chọn chiến dịch đích: không gọi hàm đẩy', async () => {
      const lines = await push(214, [rec('nhatot', '0901234565')])
      assert.equal(pushRpcs().length, 0)
      assert.deepEqual(lines, [])
    })

    await check('Gói không có Zalo: DB báo đích không nhận được, không thêm', async () => {
      globalThis.__webPush.user.entitlements = { ...globalThis.__webPush.user.entitlements, zalo: false }
      try {
        const lines = await push(213, [rec('yellowpages', '0901234566')])
        assert.ok(!pushRpcs()[0].args.p_payload.allowedTargetActionIds.includes('zalo_message_phone'))
        assert.ok(lines.includes('⚠️ Không đẩy được SĐT sang chiến dịch "Zalo đích B": gói dịch vụ hiện tại không có loại chiến dịch này.'), lines.join('\n'))
        assert.ok(!(await targetPhones(205)).includes('0901234566'))
      } finally {
        globalThis.__webPush.user.entitlements = { ...globalThis.__webPush.user.entitlements, zalo: true }
      }
    })

    await check('Lỗi mạng khi đẩy: thử lại rồi thành công, không thêm trùng', async () => {
      state.pushFailures.push({ message: 'TypeError: fetch failed', code: '' })
      const lines = await push(212, [rec('batdongsan', '0901234567')])
      assert.equal(pushRpcs().length, 2)
      assert.ok(lines.includes('✅ Đã đẩy 1 SĐT sang chiến dịch "Zalo đích A"'), lines.join('\n'))
      assert.equal((await targetPhones(201)).filter(p => p === '0901234567').length, 1)
    })

    await check('Nhóm data lỗi: vẫn đẩy sang chiến dịch Zalo, báo khách lỗi nhóm', async () => {
      state.ingestError = { message: 'permission denied for function aka_agent_ingest_data_group', code: '42501' }
      try {
        const lines = await push(211, [rec('nhatot', '0901234568')])
        assert.equal(ingestCalls.length, 1, 'lỗi cố định thì không gửi lại')
        assert.ok(lines.some(l => l.startsWith('⚠️ Không thể đẩy SĐT sang Nhóm data "Nhóm SĐT web": ')), lines.join('\n'))
        assert.ok(lines.includes('✅ Đã đẩy 1 SĐT sang chiến dịch "Zalo đích A"'), lines.join('\n'))
      } finally {
        state.ingestError = null
      }
    })

    await check('Chiến dịch nguồn bị xoá giữa lượt: DB từ chối, không thử lại, không thêm', async () => {
      await db.query(`UPDATE public.auto_campaigns SET is_delete = true WHERE id = 212`)
      try {
        const lines = await push(212, [rec('batdongsan', '0901234569')])
        assert.equal(pushRpcs().length, 1)
        assert.deepEqual(lines, ['⚠️ Không đẩy được SĐT sang chiến dịch khác: find_data_push_source_not_found'])
        assert.ok(!(await targetPhones(201)).includes('0901234569'))
      } finally {
        await db.query(`UPDATE public.auto_campaigns SET is_delete = false WHERE id = 212`)
      }
    })

    await check('Gỡ V618 p3: xoá quy tắc, liên kết và sổ đẩy của nguồn web, giữ nguyên quy tắc / liên kết Facebook', async () => {
      const fbLinks = (await one(`SELECT count(*)::int AS n FROM public.auto_campaign_data_links l JOIN public.auto_campaign_data_link_rules r ON r.id = l.rule_id
        WHERE r.source_action_id NOT LIKE 'web\\_%'`)).n
      await db.query(rulesBlock('rollback_v618_web_data_scan_p3.sql'))
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_campaign_data_link_rules`)).n, PROD_RULES)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_campaign_data_link_rules WHERE source_action_id LIKE 'web\\_%'`)).n, 0)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_campaign_data_links WHERE source_campaign_id BETWEEN 211 AND 214`)).n, 0)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_campaign_data_link_deliveries WHERE source_campaign_id BETWEEN 211 AND 214`)).n, 0)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_campaign_data_links`)).n, fbLinks)
      // Không còn quy tắc thì nguồn web bị từ chối như nguồn không hợp lệ (data đã đẩy ở đích vẫn giữ).
      const lines = await push(213, [rec('yellowpages', '0901234570')])
      assert.deepEqual(lines, ['⚠️ Không đẩy được SĐT sang chiến dịch khác: find_data_push_source_not_found'])
      assert.ok((await targetPhones(205)).length === 2)
    })

    if (facadeCalls.length) console.log('Hàm facade chưa giả lập được gọi:', [...new Set(facadeCalls)].join(', '))
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
  console.log(`\n${passed}/${results.length} nhóm đạt`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => { console.error(error.stack || error); process.exit(1) })
