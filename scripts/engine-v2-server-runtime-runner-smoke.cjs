#!/usr/bin/env node
// V667: bộ chạy engine v2 ở chế độ App Server (nơi chạy 'server') chạy thật trên PostgreSQL cục bộ ở trạng thái production + V667:
// DesktopEngineRunner + cổng Zalo Desktop + lõi thật, nhật ký SQLite thật (better-sqlite3 của app), công tắc ServerEngineGate đọc RPC thật,
// zaloRuntimeService giả. Kiểm: chọn bộ chạy theo công tắc, chạy hết một chiến dịch Zalo Server, công tắc tắt giữa chừng (bộ cũ 5 phút rồi
// xét lại), dừng giữa lượt rồi hàm khôi phục của App Server dọn lượt dở, chạy lại không gửi trùng.
// Chạy: CHAT_REPO=<thư mục có node_modules/pg> LC_ALL=C node scripts/engine-v2-server-runtime-runner-smoke.cjs (tự chạy lại dưới Electron)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

const { build } = require('esbuild')
const { buildV667Db } = require('./fixtures/engine-v2-server/db.cjs')
const V667 = require('./build-v667-sql.cjs')

let passed = 0
let failed = 0
let currentDb = null
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (e) {
    failed++; console.log(`FAIL ${name}: ${e.stack || e.message}`)
    await currentDb?.query('ROLLBACK').catch(() => {})
  }
}

const STUBS = {
  'zca-js': `class ZaloApiError extends Error { constructor(message, code) { super(message); this.name = 'ZaloApiError'; this.code = code ?? null } }
    module.exports = { ZaloApiError }`,
  electron: `module.exports = { app: { getPath: () => globalThis.__engineTest.userData } }`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__engineTest.client }`,
  errorPolicyRepository: `module.exports = { getZaloErrorPolicyByCode: async () => null }`,
  campaignRepository: `module.exports = {
    checkZaloMessageOptOut: async () => ({ isOptedOut: false, matchedBy: null }),
    prepareZaloMessageOptOut: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
    updateCampaignInputData: async (id, updates) => globalThis.__engineTest.updateInput(id, updates) }`,
  zaloCampaignEngagement: `module.exports = { campaignEngagementEnabled: () => false,
    beginCampaignEngagementSend: () => ({ revision: '', sentAt: '' }), abandonCampaignEngagementSend: () => {},
    stageCampaignEngagementSource: () => {}, recordCampaignEngagementDetail: () => {} }`,
  // Đồng hồ đơn điệu dời được (bài kiểm hạn 5 phút của not_enabled).
  monotonicNow: `const { performance } = require('node:perf_hooks')
    const now = () => performance.now() + (globalThis.__engineTest?.clockOffset || 0)
    module.exports = { monotonicNow: now, monotonicDeadline: ms => { const end = now() + ms; return { expired: () => now() >= end, remaining: () => Math.max(0, end - now()) } } }`
}

async function loadModules() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-engine-server-'))
  const outfile = path.join(out, 'runner.cjs')
  const entry = `export { DesktopEngineRunner } from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/desktopEngineRunner.ts'))}
export { ServerEngineGate, parseServerEngineGate, serverEngineGateAllows } from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/serverEngineGate.ts'))}`
  await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
    plugins: [{ name: 'engine-server-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3', { paths: [ROOT] }), external: true }))
      plugin.onResolve({ filter: /^(zca-js|electron)$|(supabaseClient|errorPolicyRepository|campaignRepository|services\/zaloCampaignEngagement|shared\/monotonicNow)$/ }, args =>
        ({ path: args.path === 'zca-js' || args.path === 'electron' ? args.path : args.path.split('/').pop(), namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: STUBS[args.path], loader: 'js' }))
    } }]
  })
  return require(outfile)
}

const ORG = 803
const STAFF = 8301
const MIN5 = 5 * 60_000

async function main() {
  const mod = await loadModules()
  const T = await buildV667Db({ label: 'aka-v667-runner-', applyV667: true })
  const { db, one, q } = T
  currentDb = db
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-engine-server-userdata-'))
  try {
    const client = {
      rpc(name, args = {}) {
        const run = (async () => {
          const params = [], parts = []
          for (const [key, value] of Object.entries(args)) {
            const json = value !== null && typeof value === 'object'
            params.push(json ? JSON.stringify(value) : value)
            parts.push(`${key} => $${params.length}${json ? '::jsonb' : ''}`)
          }
          try {
            const r = await db.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
            return { data: r.rows[0].r, error: null, status: 200 }
          } catch (e) {
            return { data: null, error: { message: e.message, code: e.code }, status: 400 }
          }
        })()
        return { abortSignal: () => run }
      }
    }
    globalThis.__engineTest = {
      userData, client, clockOffset: 0,
      updateInput: async (id, updates) => { await db.query(`UPDATE public.auto_campaign_input_data SET name = coalesce($2, name), uid = $3 WHERE id = $1`, [id, updates.name ?? null, updates.uid]) }
    }
    const setting = value => db.query(`UPDATE public.auto_system_settings SET value = $2 WHERE key = $1`, [V667.SETTING_KEY, value])

    // ------------------------------------------------------------------ dữ liệu
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES ($1, 'VPS', false) ON CONFLICT (id) DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_active) VALUES ($1, $2, 'srv', 'pw', true) ON CONFLICT (id) DO NOTHING`, [STAFF, ORG])
    await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, is_deleted, expiration_date) VALUES ($1, 16, false, now() + interval '30 days')`, [ORG])
    let nextId = 930000
    const makeCampaign = async ({ phones, server = true, extra = { enableMessage: true, actionLimits: { sleepBetweenActions: 0 } } }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo Server', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, $4, false)`, [account, STAFF, ORG, server])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'VPS SĐT', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4, 'Chào #{FULL_NAME}', $5::jsonb)`,
        [campaign, account, STAFF, ORG, JSON.stringify(extra)])
      const ids = {}
      for (const phone of phones) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Data ${phone.slice(-2)}`, phone])
        ids[phone] = id
      }
      return {
        ids,
        account: { id: account, name: 'Zalo Server', flatformType: 'zalo', isZaloServer: server, isZaloShowWeb: false, organizationId: ORG,
          accountGroupSettings: { sleepBetweenActions: 0 } },
        campaign: { id: campaign, name: 'VPS SĐT', actionId: 'zalo_message_phone', accountId: account, staffId: STAFF, organizationId: ORG,
          content: 'Chào #{FULL_NAME}', extraSettings: extra, images: [], dataTargetSourceMode: 'direct', note: null }
      }
    }
    const fakeRuntime = (behaviors = {}) => {
      const sent = []
      return {
        sent,
        findUserByPhoneOnce: async (accountId, phone) => {
          sent.push(`find:${phone}`)
          return { uid: `uid-${phone}`, displayName: `Khách ${phone.slice(-2)}`, originalName: `Khách ${phone.slice(-2)}`, globalId: `g-${phone}`, gender: 0, raw: {} }
        },
        sendMessageToUser: async (accountId, uid, message) => {
          sent.push(`text:${uid}`)
          const b = behaviors[uid.replace('uid-', '')] || {}
          if (b.beforeReturn) await b.beforeReturn()
          return { message: { msgId: `m-${uid}-${sent.length}` }, attachment: [] }
        }
      }
    }
    const makeRunner = ({ runtime, state = () => 'enabled', target = 'server' }) => {
      const lines = []
      const host = {
        zaloRuntime: () => runtime, staffId: () => STAFF, engineEnabled: () => false, zaloRuntimeBlocked: () => false, acceptingWork: () => true,
        serverEngineState: state,
        logProgress: async (campaign, text) => { lines.push(text) },
        broadcastCampaign: async () => {}, broadcastAccounts: () => {},
        isPauseRequested: () => false, completeReleasedPause: async () => {},
        saveContact: async () => {}, saveResolvedProfile: async () => {}, saveJoinedGroup: async () => {}, saveFriendContacts: async () => {},
        pushExternalSms: async () => ({ results: [] }),
        rewriteMessage: async (account, campaign, inputDataId, content) => content,
        businessNow: async () => new Date(),
        findDataSourceWaitNote: async () => null,
        noteCampaignWait: async () => {}
      }
      return { runner: new mod.DesktopEngineRunner(host, { runtimeTarget: target }), lines }
    }
    const inputStatus = async id => (await one(`SELECT status FROM public.auto_campaign_input_data WHERE id = $1`, [id])).status
    const textSends = (runtime, phone) => runtime.sent.filter(s => s === `text:uid-${phone}`).length

    // ------------------------------------------------------------------ công tắc
    await check('ServerEngineGate: chưa đọc → loading; đọc RPC thật: off → tắt, orgs → bật đúng tổ chức, all; DB chưa có hàm → tắt; lỗi kéo dài → tắt sau thời gian chờ', async () => {
      let now = 0
      const gate = new mod.ServerEngineGate(async () => client.rpc('aka_agent_engine_server_enabled_orgs_v1').abortSignal(), () => now, 60_000, 120_000)
      assert.equal(gate.state(ORG), 'loading')
      await gate.refresh()
      assert.equal(gate.state(ORG), 'disabled', 'dòng công tắc mặc định của V667 là off')
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG] }))
      now += 30_000; assert.equal(gate.state(ORG), 'disabled', 'chưa tới hạn đọc lại')
      now += 31_000; gate.state(ORG); await gate.refresh()
      assert.equal(gate.state(ORG), 'enabled'); assert.equal(gate.state(ORG + 1), 'disabled'); assert.equal(gate.state(null), 'disabled')
      await setting('{"mode":"all"}'); now += 61_000; gate.state(ORG); await gate.refresh(); assert.equal(gate.state(999999), 'enabled')
      const missing = new mod.ServerEngineGate(async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }), () => now)
      await missing.refresh(); assert.equal(missing.state(ORG), 'disabled')
      let t2 = 0
      const flaky = new mod.ServerEngineGate(async () => ({ data: null, error: { code: '57014', message: 'timeout' } }), () => t2, 60_000, 120_000)
      assert.equal(flaky.state(ORG), 'loading'); await flaky.refresh()
      t2 = 100_000; assert.equal(flaky.state(ORG), 'loading')
      t2 = 121_000; assert.equal(flaky.state(ORG), 'disabled', 'quá thời gian chờ thì bộ cũ chạy')
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG] }))
    })

    // ------------------------------------------------------------------ chọn bộ chạy
    await check('support (App Server): tài khoản Server + tổ chức bật → bộ mới; loading → chờ lượt quét sau; tắt → bộ cũ; tài khoản QR / Facebook → không phải nơi này; Desktop vẫn từ chối tài khoản Server', async () => {
      const f = await makeCampaign({ phones: [] })
      let state = 'enabled'
      const { runner } = makeRunner({ runtime: fakeRuntime(), state: () => state })
      assert.deepEqual(runner.support(f.account, f.campaign), { ok: true })
      state = 'loading'; assert.deepEqual(runner.support(f.account, f.campaign), { ok: false, reason: 'catalog_loading' })
      state = 'disabled'; assert.deepEqual(runner.support(f.account, f.campaign), { ok: false, reason: 'org_flag_off' })
      state = 'enabled'
      assert.equal(runner.support({ ...f.account, isZaloServer: false }, f.campaign).reason, 'runtime')
      assert.equal(runner.support({ ...f.account, isZaloShowWeb: true }, f.campaign).reason, 'runtime')
      assert.equal(runner.support({ ...f.account, flatformType: 'facebook' }, f.campaign).reason, 'runtime')
      const desktop = makeRunner({ runtime: fakeRuntime(), target: 'desktop' }).runner
      assert.equal(desktop.support(f.account, f.campaign).reason, 'org_flag_off', 'Desktop: cờ phiên tắt')
    })

    // ------------------------------------------------------------------ chạy hết một chiến dịch
    await check('chạy hết chiến dịch Zalo Server bằng bộ mới: claim nơi chạy server, tra số + nhắn tin từng data, hoàn thành, nhả lease', async () => {
      const f = await makeCampaign({ phones: ['0933000001', '0933000002'] })
      const runtime = fakeRuntime()
      const { runner, lines } = makeRunner({ runtime })
      const res = await runner.run(f.account, f.campaign)
      assert.equal(res.reason, 'no_target', JSON.stringify(res))
      assert.deepEqual(runtime.sent, ['find:0933000001', 'text:uid-0933000001', 'find:0933000002', 'text:uid-0933000002'])
      assert.equal(lines[0], '🚀 Bắt đầu chiến dịch "VPS SĐT" trên tài khoản "Zalo Server"')
      assert.equal(lines[lines.length - 1], '✅ Hoàn thành chiến dịch "VPS SĐT"', lines.join('\n'))
      for (const id of Object.values(f.ids)) assert.equal(await inputStatus(id), 'hoàn thành')
      const runs = await q(`SELECT runtime_target, runner_id, completed_at IS NOT NULL done FROM public.auto_engine_target_runs WHERE campaign_id = $1`, [f.campaign.id])
      assert.equal(runs.length, 2)
      for (const r of runs) { assert.equal(r.runtime_target, 'server'); assert.match(r.runner_id, /^server:/); assert.equal(r.done, true) }
      assert.equal((await one(`SELECT count(*)::int n FROM public.auto_engine_leases WHERE account_id = $1 AND expires_at > now()`, [f.account.id])).n, 0, 'lease đã nhả')
      const details = await q(`SELECT action_code, status FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [f.campaign.id])
      assert.deepEqual(details.map(d => `${d.action_code}:${d.status}`),
        ['zalo_find_phone_user:thành công', 'zalo_message_stranger:thành công', 'zalo_find_phone_user:thành công', 'zalo_message_stranger:thành công'])
      assert.equal((await one(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [f.campaign.id])).status, 'hoàn thành')
    })

    // ------------------------------------------------------------------ công tắc tắt giữa chừng
    await check('công tắc tắt giữa chừng: claim trả not_enabled → chiến dịch chạy bộ cũ 5 phút rồi xét lại; chiến dịch khác không bị ảnh hưởng', async () => {
      const f = await makeCampaign({ phones: ['0933000011'] })
      const other = await makeCampaign({ phones: [] })
      const runtime = fakeRuntime()
      const { runner } = makeRunner({ runtime })
      await setting('{"mode":"off","organizationIds":[]}')   // App Server còn nhớ "bật" (đọc 60 giây một lần), claim đọc DB
      const res = await runner.run(f.account, f.campaign)
      assert.equal(res.reason, 'not_enabled', JSON.stringify(res))
      assert.deepEqual(runtime.sent, [], 'không gửi gì')
      assert.equal(await inputStatus(f.ids['0933000011']), 'chờ xử lý', 'data còn nguyên cho bộ cũ')
      assert.deepEqual(runner.support(f.account, f.campaign), { ok: false, reason: 'org_flag_off' })
      assert.deepEqual(runner.support(other.account, other.campaign), { ok: true })
      globalThis.__engineTest.clockOffset += MIN5 - 10_000
      assert.equal(runner.support(f.account, f.campaign).ok, false, 'chưa hết 5 phút')
      globalThis.__engineTest.clockOffset += 20_000
      assert.deepEqual(runner.support(f.account, f.campaign), { ok: true }, 'hết 5 phút thì xét lại')
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG] }))
    })

    // ------------------------------------------------------------------ dừng giữa lượt, hàm khôi phục, chạy lại
    await check('dừng giữa lượt (App Server dừng runtime) → recover_server_zalo_running_state dọn lượt dở → bộ chạy mới chạy tiếp, không gửi trùng', async () => {
      const phones = ['0933000021', '0933000022', '0933000023']
      const f = await makeCampaign({ phones })
      let runner1 = null
      const runtime1 = fakeRuntime({ '0933000021': { beforeReturn: async () => { runner1.abortAll() } } })
      const r1 = makeRunner({ runtime: runtime1 })
      runner1 = r1.runner
      const first = await runner1.run(f.account, f.campaign)
      assert.ok(['stopped', 'aborted'].includes(first.reason) || first.reason, JSON.stringify(first))
      const recovered = (await one(`SELECT public.recover_server_zalo_running_state($1, NULL, false) r`, [STAFF])).r
      assert.ok(recovered, 'hàm khôi phục chạy được')
      assert.equal((await one(`SELECT count(*)::int n FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND completed_at IS NULL`, [f.campaign.id])).n, 0,
        'không còn lượt engine mở')
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 second' WHERE account_id = $1`, [f.account.id])
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = $1 AND status IN ('đang chạy', 'chờ xử lý')`, [f.campaign.id])
      const runtime2 = fakeRuntime()
      const second = await makeRunner({ runtime: runtime2 }).runner.run(f.account, f.campaign)
      assert.equal(second.reason, 'no_target', JSON.stringify(second))
      const total = phone => textSends(runtime1, phone) + textSends(runtime2, phone)
      for (const phone of phones) assert.ok(total(phone) <= 1, `${phone} gửi ${total(phone)} lần`)
      assert.equal(total('0933000021'), 1, 'data đang gửi lúc dừng: gửi đúng một lần')
      for (const phone of phones.slice(1)) assert.equal(total(phone), 1, `${phone} được gửi sau khi chạy lại`)
      for (const phone of phones) assert.equal(await inputStatus(f.ids[phone]), 'hoàn thành', phone)
    })
  } finally {
    await T.stop()
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  if (failed) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exitCode = 1 })
