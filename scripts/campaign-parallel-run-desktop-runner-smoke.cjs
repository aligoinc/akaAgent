#!/usr/bin/env node
// "Chạy cùng lúc" (V670), phần B: bộ chạy engine v2 THẬT của Desktop (src/main/engineAdapters/desktopEngineRunner.ts) chạy nhiều làn cùng lúc trên
// một tài khoản Zalo. Lõi engine thật, nhật ký SQLite thật (better-sqlite3 của app, nên tự chạy lại dưới Electron), DB PostgreSQL 17 cục bộ dựng
// như bộ kịch bản engine v2 (bootstrap.cjs) rồi apply V670, zaloRuntimeService giả. Không chạm DB thật, không gọi Zalo.
//   1. Làn chính (Nhắn tin theo SĐT, không tích) và làn riêng (Tham gia group bằng link, có tích) chạy chồng nhau thật; isRunning theo làn; nhật ký
//      mỗi làn một phạm vi (làn chính giữ phạm vi cũ); tài khoản chỉ về "chờ xử lý" khi cả hai làn xong. 1b: thêm làn Huỷ lời mời (lấy data đầu lượt).
//   2. Thoát app (abortAll, đúng đường scheduler.stop gọi) khi cả hai làn đang gửi, DB không nhận báo cáo: nhật ký mỗi làn giữ mục của chính làn đó.
//   3. Mở lại app (runner mới, đóng / mở lại file nhật ký): mỗi làn gửi bù đúng mục của nó cho đúng lease, không làn nào phát lại nhật ký của làn
//      kia, không gửi trùng; chạy tiếp hết data.
//   4. Không chạy chồng: run lần hai cùng tài khoản + cùng làn trong tiến trình (null), máy khác cùng làn (busy), cùng loại ở làn chính (parallel_wait).
//   5. Không có làn riêng: runner bản trước (PARALLEL_RUN_BASELINE_REF, mặc định dev_3 cab27ed3 ngay trước tính năng) trên DB trước V670,
//      runner mới trên DB trước V670 và sau V670 cho cùng kết quả.
//   6. App cũ gặp chiến dịch có tích (khách tích trên Web / iOS, máy Desktop chưa cập nhật): nguyên cây mã (bộ chạy, lõi engine, cổng Zalo,
//      nhật ký) của từng bản đã phát hành (PARALLEL_RUN_OLD_REFS, mặc định bản trước tính năng, 10.7.0, 10.6.0, 10.1.0, 9.6.0) trên DB sau V670.
//      6a chạy lần lượt như không tích (so với cùng việc không tích); 6c dừng đột ngột rồi mở lại app cũ (gửi bù, parallel_wait, busy, chạy
//      tiếp); 6d nâng cấp lên bản mới sau khi app cũ dừng giữa chiến dịch có tích (nhật ký phạm vi cũ được làn chính gửi bù); 6e như 6d nhưng
//      tài khoản chỉ có chiến dịch có tích: nhật ký phạm vi cũ nằm lại tới khi làn chính chạy (DB từ chối vô hại), data đang chạy dở lúc
//      app cũ bị ngắt được job đóng SYS02 thay vì làm lại (như khi mất nhật ký), không gửi trùng.
// Chạy: LC_ALL=C CHAT_REPO=/Users/lequangnhut/Repos/akaAgentChatApi node scripts/campaign-parallel-run-desktop-runner-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

process.env.SCENARIO_FACEBOOK_MIGRATIONS = '1'
process.env.SCENARIO_TARGET_CHECK = '1'
process.env.SCENARIO_ORPHAN_RUNS = '1'
const { build } = require('esbuild')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap } = require('./engine-v2-scenarios/bootstrap.cjs')
const Database = require('better-sqlite3')

const PORT = Number(process.env.PARALLEL_RUN_DESKTOP_RUNNER_PORT || 55541)
const STAFF = 8101
const ORG = 8100
const MAIN = 'main'
const LANE_JOIN = 'zalo_join_group_link'
const LANE_CANCEL = 'zalo_cancel_sent_friend_request'
const MAIN_KINDS = new Set(['find', 'text', 'friend'])
const MAIN_EXTRA = { enableMessage: true, enableAddFriend: true, friendRequestMessage: 'Kết bạn nhé #{FULL_NAME}', actionLimits: { sleepBetweenActions: 90 } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const results = []
/** Một ca: chạy fn, gom các kiểm; ca đạt khi mọi kiểm đạt và fn không ném. */
async function runCase(label, fn) {
  const checks = []
  const expect = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); return Boolean(ok) }
  let error = null
  try { await fn(expect) } catch (e) { error = e }
  const failed = checks.filter(c => !c.ok)
  const ok = !error && failed.length === 0
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (${checks.length - failed.length}/${checks.length} kiểm)`)
  for (const c of failed) console.log(`    ✗ ${c.name}${c.detail === undefined ? '' : ': ' + JSON.stringify(c.detail).slice(0, 900)}`)
  if (error) console.log(`    ✗ lỗi: ${String(error.stack || error).slice(0, 1500)}`)
  return ok
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Bản dựng runner (mới: file đang sửa; cũ: BASELINE_REF) với các module ngoài thay bằng bản giả như scripts/campaign-engine-desktop-smoke.cjs
// ---------------------------------------------------------------------------------------------------------------------------------------

const STUBS = {
  'zca-js': `class ZaloApiError extends Error { constructor(message, code) { super(message); this.name = 'ZaloApiError'; this.code = code ?? null } }
    module.exports = { ZaloApiError }`,
  electron: `module.exports = { app: { getPath: () => globalThis.__engineTest.userData } }`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__engineTest.client }`,
  errorPolicyRepository: `module.exports = { getZaloErrorPolicyByCode: (code, action) => globalThis.__engineTest.policy(code, action) }`,
  campaignRepository: `module.exports = {
    checkZaloMessageOptOut: (...a) => globalThis.__engineTest.checkOptOut(...a),
    prepareZaloMessageOptOut: (...a) => globalThis.__engineTest.prepareOptOut(...a),
    updateCampaignInputData: (...a) => globalThis.__engineTest.updateInput(...a) }`,
  zaloCampaignEngagement: `module.exports = {
    campaignEngagementEnabled: () => false,
    beginCampaignEngagementSend: () => ({ revision: '', sentAt: '' }),
    abandonCampaignEngagementSend: () => {}, stageCampaignEngagementSource: () => {}, recordCampaignEngagementDetail: () => {} }`
}

async function loadBundle(label, runnerSource, rootDir = ROOT) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `aka-pr-desktop-${label}-`))
  const outfile = path.join(out, 'bundle.cjs')
  const contents = (runnerSource ?? `export { DesktopEngineRunner } from './desktopEngineRunner'\n`)
    + `\nexport { closeEngineJournal } from './desktopEngineJournal'\n`
  await build({
    stdin: { contents, resolveDir: path.join(rootDir, 'src/main/engineAdapters'), sourcefile: `${label}-entry.ts`, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', nodePaths: [path.join(ROOT, 'node_modules')],
    plugins: [{ name: 'engine-desktop-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3', { paths: [ROOT] }), external: true }))
      plugin.onResolve({ filter: /^(zca-js|electron)$|(supabaseClient|errorPolicyRepository|campaignRepository|services\/zaloCampaignEngagement)$/ }, args =>
        ({ path: args.path === 'zca-js' || args.path === 'electron' ? args.path : args.path.split('/').pop(), namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: STUBS[args.path], loader: 'js' }))
    } }]
  })
  return { mod: require(outfile), out }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Môi trường: cụm PG, Supabase client giả (gọi thẳng hàm SQL qua vài kết nối để hai làn chạy DB song song thật), nhật ký
// ---------------------------------------------------------------------------------------------------------------------------------------

function makePool(clients) {
  const free = [...clients]
  const waiters = []
  return {
    acquire: () => free.length ? Promise.resolve(free.pop()) : new Promise(resolve => waiters.push(resolve)),
    release: client => { const w = waiters.shift(); if (w) w(client); else free.push(client) }
  }
}

async function openEnv(mode) {
  process.env.SCENARIO_PARALLEL_RUN = mode
  const cluster = startCluster({ port: PORT, label: `aka-pr-desktop-${mode}-`, timeoutMs: 30 * 60 * 1000 })
  const db = await cluster.connect()
  const notes = []
  await bootstrap(db, notes)
  await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org chạy cùng lúc', false) ON CONFLICT (id) DO NOTHING`, [ORG])
  const poolClients = []
  for (let i = 0; i < 4; i++) poolClients.push(await cluster.connect())
  const obs = await cluster.connect()
  const pool = makePool(poolClients)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `aka-pr-desktop-userdata-${mode}-`))
  const journalFile = path.join(userData, 'local-data', 'campaign_engine_journal.db')
  const hasLane = (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_engine_leases'
    AND column_name = 'lane'`)).rowCount === 1
  const state = { reportDown: false, phase: null, rpcLog: [], reportObs: [] }
  let reader = null
  const readJournal = () => {
    if (!fs.existsSync(journalFile)) return []
    reader = reader || new Database(journalFile, { readonly: true, fileMustExist: true })
    return reader.prepare('SELECT scope, id, entry FROM engine_journal ORDER BY created_at, id').all()
      .map(row => ({ scope: row.scope, id: row.id, entry: JSON.parse(row.entry) }))
  }
  const brief = args => ({
    campaignId: args.p_ctx?.campaignId ?? null, accountId: args.p_account_id ?? args.p_ctx?.accountId ?? null,
    leaseToken: args.p_lease_token ?? args.p_ctx?.leaseToken ?? null, targetRunId: args.p_target_run_id ?? null
  })
  const client = {
    rpc(name, args) {
      const run = (async () => {
        const t0 = Date.now()
        if (name === 'aka_agent_engine_report_v1') {
          const entries = readJournal().filter(e => Number(e.entry.targetRunId) === Number(args.p_target_run_id) && e.entry.leaseToken === args.p_lease_token)
          const tr = (await obs.query(`SELECT campaign_id, lease_token FROM public.auto_engine_target_runs WHERE id = $1`, [args.p_target_run_id])).rows[0]
          const lane = hasLane
            ? (await obs.query(`SELECT lane FROM public.auto_engine_leases WHERE lease_token = $1`, [args.p_lease_token])).rows[0]?.lane ?? null
            : null
          state.reportObs.push({ t: t0, phase: state.phase, targetRunId: Number(args.p_target_run_id), leaseToken: args.p_lease_token, final: args.p_final,
            scopes: [...new Set(entries.map(e => e.scope))], campaignId: tr ? Number(tr.campaign_id) : null, runLeaseToken: tr?.lease_token ?? null, lane,
            down: state.reportDown })
          if (state.reportDown) {
            state.rpcLog.push({ name, ...brief(args), t0, t1: Date.now(), forced: 'down' })
            return { data: null, error: { message: 'fetch failed', code: '' }, status: 503 }
          }
        }
        const params = [], parts = []
        for (const [key, value] of Object.entries(args)) {
          const json = value !== null && typeof value === 'object'
          params.push(json ? JSON.stringify(value) : value)
          parts.push(`${key} => $${params.length}${json ? '::jsonb' : ''}`)
        }
        const c = await pool.acquire()
        try {
          const r = await c.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
          const data = r.rows[0].r
          state.rpcLog.push({ name, ...brief(args), t0, t1: Date.now(), status: data?.status ?? null, reason: data?.reason ?? null, ok: data?.ok ?? null })
          return { data, error: null, status: 200 }
        } catch (e) {
          state.rpcLog.push({ name, ...brief(args), t0, t1: Date.now(), error: e.message })
          return { data: null, error: { message: e.message, code: e.code }, status: 400 }
        } finally {
          pool.release(c)
        }
      })()
      return { abortSignal: () => run }
    }
  }
  const close = async () => {
    try { reader?.close() } catch {}
    for (const c of [...poolClients, obs, db]) await c.end().catch(() => {})
    cluster.stop()
    fs.rmSync(userData, { recursive: true, force: true })
  }
  return { mode, db, obs, client, state, userData, journalFile, readJournal, hasLane, notes, close, resetReader: () => { try { reader?.close() } catch {} reader = null } }
}

function useEnv(env) {
  globalThis.__engineTest = {
    userData: env.userData, client: env.client,
    policy: async (code, action) => (['221', '312'].includes(String(code)) && action === 'zalo_find_phone_user'
      ? { disableActionCodes: ['zalo_find_phone_user'], disableActionMode: 'fixed_minutes', timeDisableActions: 60 } : null),
    checkOptOut: async () => ({ isOptedOut: false, matchedBy: null }),
    prepareOptOut: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
    updateInput: async (id, updates) => {
      await env.db.query(`UPDATE public.auto_campaign_input_data SET name = coalesce($2, name), uid = $3 WHERE id = $1`, [id, updates.name ?? null, updates.uid])
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Dữ liệu và Zalo giả
// ---------------------------------------------------------------------------------------------------------------------------------------

let nextId = 8_100_000
async function makeAccount(env) {
  const id = ++nextId
  await env.db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
      is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo QR', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`,
    [id, STAFF, ORG])
  return { id, name: 'Zalo QR', flatformType: 'zalo', isZaloServer: false, isZaloShowWeb: false, zaloUid: 'own-desktop', organizationId: ORG,
    accountGroupSettings: { sleepBetweenActions: 1 } }
}

async function makeCampaign(env, account, actionId, { tick = false, name, rows = [], extra = {}, content = '' } = {}) {
  const id = ++nextId
  await env.db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings)
    OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', now() - interval '1 minute', false, $5, $6, $7, $8::jsonb)`,
    [id, name, actionId, account.id, STAFF, ORG, content, JSON.stringify(extra)])
  if (tick) await env.db.query(`UPDATE public.auto_campaigns SET parallel_run_enabled = true WHERE id = $1`, [id])
  const ids = []
  for (const row of rows) {
    const rowId = ++nextId
    await env.db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, uid, status, is_delete) OVERRIDING SYSTEM VALUE
      VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', false)`, [rowId, id, row.name ?? null, row.phone ?? null, row.uid ?? null])
    ids.push(rowId)
  }
  return { id, ids, rows, campaign: { id, name, actionId, accountId: account.id, staffId: STAFF, content, extraSettings: extra, images: [],
    dataTargetSourceMode: 'direct', note: null, parallelRunEnabled: tick } }
}

const phones = (n, prefix) => Array.from({ length: n }, (_, i) => ({ name: `Khách ${prefix}${i}`, phone: `${prefix}${String(i + 1).padStart(6 - prefix.length + 4, '0')}` }))
const links = (n, code) => Array.from({ length: n }, (_, i) => ({ uid: `zalo.me/g/${code}${i}` }))
const groupId = link => String(link).split('/').pop()

/** zaloRuntimeService giả: mỗi lời gọi ghi lại (tài khoản, loại, khoá, lúc bắt đầu / kết thúc), có trễ theo loại và móc onCall trước khi trả. */
function makeRuntime(name, { delays = {}, onCall, sentRequests = [] } = {}) {
  const calls = []
  const inflight = new Map()
  const call = async (accountId, kind, key, result) => {
    const rec = { runtime: name, accountId, kind, key, t0: Date.now(), t1: null }
    calls.push(rec)
    inflight.set(kind, (inflight.get(kind) || 0) + 1)
    try {
      if (onCall) await onCall(rec, inflight)
      const ms = delays[kind] ?? 40
      if (ms > 0) await sleep(ms)
      return typeof result === 'function' ? result() : result
    } finally {
      inflight.set(kind, inflight.get(kind) - 1)
      rec.t1 = Date.now()
    }
  }
  return {
    calls, inflight,
    getCachedOwnUid: () => 'own-desktop',
    findUserByPhoneOnce: (accountId, phone) => call(accountId, 'find', phone, () => phone.endsWith('9') ? null
      : { uid: `uid-${phone}`, displayName: `Khách ${phone.slice(-3)}`, originalName: `Khách ${phone.slice(-3)}`, globalId: `g-${phone}`, gender: 0, raw: {} }),
    sendMessageToUser: (accountId, uid) => call(accountId, 'text', uid, { message: { msgId: `m-${uid}` }, attachment: [] }),
    sendFriendRequestToUser: (accountId, uid) => call(accountId, 'friend', uid, { ok: 1 }),
    joinGroupByLink: (accountId, link) => call(accountId, 'join', link, () => ({ link, group: { groupId: groupId(link), name: `Nhóm ${groupId(link)}` },
      groupId: groupId(link), groupName: `Nhóm ${groupId(link)}`, outcome: 'joined', zaloCode: null, zaloMessage: null })),
    getSentFriendRequests: accountId => call(accountId, 'sent_list', 'list', { profiles: sentRequests.map(p => ({ ...p })), totalItems: sentRequests.length,
      missingUidItems: 0 }),
    undoFriendRequest: (accountId, uid) => call(accountId, 'undo', uid, { ok: 1 })
  }
}

function makeRunner(mod, runtime, accepting = { value: true }) {
  const lines = []
  const host = {
    zaloRuntime: () => runtime, staffId: () => STAFF, engineEnabled: () => true, zaloRuntimeBlocked: () => false, acceptingWork: () => accepting.value,
    logProgress: async (campaign, text) => { lines.push({ campaignId: campaign.id, text }) },
    broadcastCampaign: async () => {}, broadcastAccounts: () => {},
    isPauseRequested: () => false, completeReleasedPause: async () => {},
    saveContact: async () => {}, saveResolvedProfile: async () => {}, saveJoinedGroup: async () => {}, saveFriendContacts: async () => {},
    pushExternalSms: async () => ({ integrationMissing: true, results: [] }),
    businessNow: async () => new Date(),
    findDataSourceWaitNote: async () => null,
    noteCampaignWait: async (campaign, note) => { lines.push({ campaignId: campaign.id, text: `⚠️ Chưa thể chạy chiến dịch: ${note}` }) },
    rewriteMessage: async (_a, _c, _id, content) => content
  }
  return { runner: new mod.DesktopEngineRunner(host), lines, runtime, accepting }
}

const q = async (env, sql, params = []) => (await env.obs.query(sql, params)).rows
const leaseLanes = async (env, accountId) => env.hasLane
  ? (await q(env, `SELECT lane FROM public.auto_engine_leases WHERE account_id = $1 ORDER BY lane`, [accountId])).map(r => r.lane)
  : (await q(env, `SELECT 'main' AS lane FROM public.auto_engine_leases WHERE account_id = $1`, [accountId])).map(r => r.lane)
const accountStatus = async (env, accountId) => (await q(env, `SELECT status FROM public.auto_accounts WHERE id = $1`, [accountId]))[0]?.status
const openRuns = async (env, campaignIds) => Number((await q(env, `SELECT count(*) n FROM public.auto_engine_target_runs WHERE campaign_id = ANY($1::bigint[])
  AND completed_at IS NULL`, [campaignIds]))[0].n)
const inputStatuses = async (env, campaignId) => (await q(env, `SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`,
  [campaignId]))
const campaignStatus = async (env, campaignId) => (await q(env, `SELECT status FROM public.auto_campaigns WHERE id = $1`, [campaignId]))[0]?.status
const scopeOf = (accountId, lane) => lane === MAIN ? `${STAFF}:${accountId}` : `${STAFF}:${accountId}:${lane}`
const countBy = (list, keyOf) => list.reduce((m, x) => { const k = keyOf(x); m[k] = (m[k] || 0) + 1; return m }, {})
const lastLeaseLanesPoller = (env, accountId) => {
  const seen = []
  let stop = false
  const loop = (async () => { while (!stop) { seen.push(await leaseLanes(env, accountId)); await sleep(40) } })()
  return { seen, stop: async () => { stop = true; await loop } }
}
async function expireAndCloseStale(env, accountId) {
  await env.db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '11 minutes', heartbeat_at = now() - interval '14 minutes'
    WHERE account_id = $1`, [accountId])
  await env.db.query(`UPDATE public.auto_engine_target_runs SET started_at = started_at - interval '11 minutes' WHERE completed_at IS NULL AND account_id = $1`,
    [accountId])
  return (await env.db.query(`SELECT public.aka_agent_engine_close_stale_v1(1000) AS r`)).rows[0].r
}

/** Kiểm nhật ký báo cáo của một chiến dịch: mọi báo cáo đi đúng phạm vi nhật ký của làn, đúng lease của làn, đúng lease của lượt data. */
function reportChecks(expect, env, label, campaignId, accountId, lane, { phase } = {}) {
  const obs = env.state.reportObs.filter(o => o.campaignId === campaignId && (phase === undefined || o.phase === phase))
  expect(`${label}: có báo cáo`, obs.length > 0, { n: obs.length })
  const scope = scopeOf(accountId, lane)
  const badScope = obs.filter(o => o.scopes.length !== 1 || o.scopes[0] !== scope)
  expect(`${label}: mọi báo cáo nằm trong nhật ký "${scope}"`, badScope.length === 0, badScope.slice(0, 4))
  const badRun = obs.filter(o => o.runLeaseToken !== o.leaseToken)
  expect(`${label}: báo cáo dùng đúng lease của lượt data`, badRun.length === 0, badRun.slice(0, 4))
  if (env.hasLane) {
    const badLane = obs.filter(o => o.lane !== null && o.lane !== lane)
    expect(`${label}: lease của báo cáo thuộc làn "${lane}"`, badLane.length === 0, badLane.slice(0, 4))
  }
  return obs
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Các ca
// ---------------------------------------------------------------------------------------------------------------------------------------

async function case1(env, mod) {
  await runCase('1. Làn chính (Nhắn tin theo SĐT) và làn riêng (Tham gia group, có tích) chạy chồng nhau trên một tài khoản', async expect => {
    env.state.phase = 'c1'
    const acc = await makeAccount(env)
    const M = await makeCampaign(env, acc, 'zalo_message_phone', { name: 'C1 nhắn SĐT', rows: phones(3, '0931'), extra: MAIN_EXTRA, content: 'Chào #{FULL_NAME}' })
    const L = await makeCampaign(env, acc, LANE_JOIN, { tick: true, name: 'C1 vào group', rows: links(2, 'cmot') })
    const samples = []
    let R
    const runtime = makeRuntime('c1', { delays: { find: 150, text: 300, friend: 200, join: 250 }, onCall: async rec => {
      samples.push({ kind: rec.kind, main: R.runner.isRunning(acc.id), lane: R.runner.isRunning(acc.id, LANE_JOIN), active: R.runner.activeCount,
        leases: await leaseLanes(env, acc.id), account: await accountStatus(env, acc.id) })
    } })
    R = makeRunner(mod, runtime)
    expect('support() đạt cho cả hai chiến dịch', R.runner.support(acc, M.campaign).ok && R.runner.support(acc, L.campaign).ok)
    expect('chưa chạy: isRunning(tài khoản) và isRunning(tài khoản, làn) đều false',
      !R.runner.isRunning(acc.id) && !R.runner.isRunning(acc.id, LANE_JOIN) && R.runner.activeCount === 0)
    const pMain = R.runner.run(acc, M.campaign)
    const pLane = R.runner.run(acc, L.campaign, LANE_JOIN)
    expect('ngay sau khi gọi run hai làn: isRunning theo làn đều true, activeCount = 2',
      R.runner.isRunning(acc.id) && R.runner.isRunning(acc.id, MAIN) && R.runner.isRunning(acc.id, LANE_JOIN) && R.runner.activeCount === 2,
      { main: R.runner.isRunning(acc.id), lane: R.runner.isRunning(acc.id, LANE_JOIN), active: R.runner.activeCount })
    const laneResult = await pLane
    const afterLane = { main: R.runner.isRunning(acc.id), lane: R.runner.isRunning(acc.id, LANE_JOIN), leases: await leaseLanes(env, acc.id),
      account: await accountStatus(env, acc.id) }
    const mainResult = await pMain
    expect('làn riêng chạy xong hết data (no_target)', laneResult?.reason === 'no_target', laneResult)
    expect('làn chính chạy xong hết data (no_target)', mainResult?.reason === 'no_target', mainResult)
    expect('làn riêng xong trước: làn chính vẫn chạy, làn riêng không còn, chỉ còn lease làn chính, tài khoản vẫn "đang chạy"',
      afterLane.main === true && afterLane.lane === false && JSON.stringify(afterLane.leases) === JSON.stringify([MAIN]) && afterLane.account === 'đang chạy', afterLane)
    const mainCalls = runtime.calls.filter(c => MAIN_KINDS.has(c.kind))
    const laneCalls = runtime.calls.filter(c => c.kind === 'join')
    const overlap = Math.min(...laneCalls.map(c => c.t0)) < Math.max(...mainCalls.map(c => c.t1)) && Math.min(...mainCalls.map(c => c.t0)) < Math.max(...laneCalls.map(c => c.t1))
    expect('lời gọi Zalo của hai làn đan xen theo thời gian (không chạy lần lượt)', overlap, {
      main: [Math.min(...mainCalls.map(c => c.t0)), Math.max(...mainCalls.map(c => c.t1))], lane: [Math.min(...laneCalls.map(c => c.t0)), Math.max(...laneCalls.map(c => c.t1))] })
    const both = samples.filter(s => s.main && s.lane)
    expect('trong lúc gọi Zalo có lúc cả hai làn cùng chạy (isRunning hai làn true, activeCount 2)', both.some(s => s.active === 2), samples.slice(0, 6))
    expect('có lúc DB giữ đồng thời lease làn chính và làn riêng của tài khoản', samples.some(s => s.leases.includes(MAIN) && s.leases.includes(LANE_JOIN)),
      samples.map(s => s.leases.join('+')).slice(0, 10))
    expect('tài khoản "đang chạy" suốt lúc hai làn gọi Zalo', samples.every(s => s.account === 'đang chạy'), countBy(samples, s => s.account))
    expect('xong cả hai: không còn lease, tài khoản về "chờ xử lý", không còn lượt data mở',
      (await leaseLanes(env, acc.id)).length === 0 && await accountStatus(env, acc.id) === 'chờ xử lý' && await openRuns(env, [M.id, L.id]) === 0)
    expect('xong cả hai: isRunning hai làn false, activeCount 0', !R.runner.isRunning(acc.id) && !R.runner.isRunning(acc.id, LANE_JOIN) && R.runner.activeCount === 0)
    expect('hai chiến dịch hoàn thành, mọi data hoàn thành', await campaignStatus(env, M.id) === 'hoàn thành' && await campaignStatus(env, L.id) === 'hoàn thành'
      && [...await inputStatuses(env, M.id), ...await inputStatuses(env, L.id)].every(r => r.status === 'hoàn thành'))
    const perKey = countBy(runtime.calls, c => `${c.kind}:${c.key}`)
    expect('mỗi data được gửi đúng một lần (tin, kết bạn, vào group)', Object.values(perKey).every(n => n === 1)
      && runtime.calls.filter(c => c.kind === 'text').length === 3 && runtime.calls.filter(c => c.kind === 'friend').length === 3 && laneCalls.length === 2, perKey)
    reportChecks(expect, env, 'làn chính', M.id, acc.id, MAIN)
    reportChecks(expect, env, 'làn riêng', L.id, acc.id, LANE_JOIN)
    expect('nhật ký hai làn trống sau khi DB xác nhận', env.readJournal().filter(e => e.scope.startsWith(`${STAFF}:${acc.id}`)).length === 0)
  })

  await runCase('1b. Ba làn cùng lúc trên một tài khoản: Nhắn tin theo SĐT, Tham gia group (có tích), Huỷ lời mời (có tích, lấy data đầu lượt)', async expect => {
    env.state.phase = 'c1b'
    const acc = await makeAccount(env)
    const M = await makeCampaign(env, acc, 'zalo_message_phone', { name: 'C1b nhắn SĐT', rows: phones(2, '0932'), extra: MAIN_EXTRA, content: 'Chào #{FULL_NAME}' })
    const J = await makeCampaign(env, acc, LANE_JOIN, { tick: true, name: 'C1b vào group', rows: links(2, 'cba') })
    const C = await makeCampaign(env, acc, LANE_CANCEL, { tick: true, name: 'C1b huỷ lời mời', extra: { zaloCancelFriendRequestLimit: 2 } })
    const runtime = makeRuntime('c1b', { delays: { find: 120, text: 250, friend: 150, join: 300, sent_list: 200, undo: 250 },
      sentRequests: [{ uid: 'u300', name: 'Ba', sentAt: 3000 }, { uid: 'u100', name: 'Một', sentAt: 1000 }, { uid: 'u200', name: 'Hai', sentAt: 2000 }] })
    const R = makeRunner(mod, runtime)
    const poll = lastLeaseLanesPoller(env, acc.id)
    const [rm, rj, rc] = await Promise.all([R.runner.run(acc, M.campaign), R.runner.run(acc, J.campaign, LANE_JOIN), R.runner.run(acc, C.campaign, LANE_CANCEL)])
    await poll.stop()
    expect('ba lượt đều chạy hết (no_target)', [rm, rj, rc].every(r => r?.reason === 'no_target'), [rm, rj, rc])
    expect('có lúc DB giữ cùng lúc lease của cả ba làn', poll.seen.some(s => s.includes(MAIN) && s.includes(LANE_JOIN) && s.includes(LANE_CANCEL)),
      [...new Set(poll.seen.map(s => s.join('+')))])
    const undo = runtime.calls.filter(c => c.kind === 'undo').map(c => c.key)
    expect('huỷ đúng 2 lời mời cũ nhất, mỗi lời mời một lần', JSON.stringify(undo) === JSON.stringify(['u100', 'u200']), undo)
    const mat = env.state.rpcLog.filter(r => r.name === 'aka_agent_engine_materialize_v1' && r.accountId === acc.id)
    expect('lấy data đầu lượt (materialize) của làn Huỷ lời mời được DB nhận theo lease của làn', mat.length > 0 && mat.every(r => r.ok === true && !r.error), mat.slice(0, 6))
    const perKey = countBy(runtime.calls, c => `${c.kind}:${c.key}`)
    expect('không lời gọi gửi nào lặp lại', Object.entries(perKey).filter(([k]) => !k.startsWith('sent_list')).every(([, n]) => n === 1), perKey)
    reportChecks(expect, env, 'làn chính', M.id, acc.id, MAIN)
    reportChecks(expect, env, 'làn vào group', J.id, acc.id, LANE_JOIN)
    reportChecks(expect, env, 'làn huỷ lời mời', C.id, acc.id, LANE_CANCEL)
    expect('xong: không lease, tài khoản "chờ xử lý", không lượt mở, mọi data hoàn thành',
      (await leaseLanes(env, acc.id)).length === 0 && await accountStatus(env, acc.id) === 'chờ xử lý' && await openRuns(env, [M.id, J.id, C.id]) === 0
      && [...await inputStatuses(env, M.id), ...await inputStatuses(env, J.id), ...await inputStatuses(env, C.id)].every(r => r.status === 'hoàn thành'))
    expect('nhật ký trống', env.readJournal().filter(e => e.scope.startsWith(`${STAFF}:${acc.id}`)).length === 0)
  })
}

/** Lượt data đang chạy lúc thoát app: trạng thái data, lượt đã chốt chưa, các kết quả DB đã nhận (thao tác:pha:mã:giao). */
async function inflightState(env, runIds) {
  return q(env, `SELECT tr.id, tr.campaign_id, tr.input_data_id, tr.completed_at IS NOT NULL AS closed, i.status,
      (SELECT string_agg(o.action_code || ':' || o.phase || ':' || coalesce(o.error_code, 'ok') || ':' || o.delivery_state, ',' ORDER BY o.created_at)
         FROM public.auto_engine_outcomes o WHERE o.target_run_id = tr.id) AS outcomes
    FROM public.auto_engine_target_runs tr JOIN public.auto_campaign_input_data i ON i.id = tr.input_data_id
    WHERE tr.id = ANY($1::bigint[]) ORDER BY tr.id`, [runIds])
}

async function case23(env, mod) {
  const ctx = {}
  const ok2 = await runCase('2. Thoát app (abortAll) khi cả hai làn đang gửi, DB không nhận báo cáo: nhật ký mỗi làn giữ mục của chính làn đó', async expect => {
    env.state.phase = 'c2'
    const acc = await makeAccount(env)
    const M = await makeCampaign(env, acc, 'zalo_message_phone', { name: 'C2 nhắn SĐT', rows: phones(3, '0933'), extra: MAIN_EXTRA, content: 'Chào #{FULL_NAME}' })
    const L = await makeCampaign(env, acc, LANE_JOIN, { tick: true, name: 'C2 vào group', rows: links(3, 'chai') })
    Object.assign(ctx, { acc, M, L })
    const accepting = { value: true }
    let R = null
    let abortInfo = null
    const runtime = makeRuntime('A', { delays: { find: 100, text: 900, friend: 100, join: 900 }, onCall: async (rec, inflight) => {
      if (abortInfo || !R) return
      if ((inflight.get('text') || 0) > 0 && (inflight.get('join') || 0) > 0) {
        abortInfo = { t: Date.now(), inflight: { text: inflight.get('text'), join: inflight.get('join') } }
        env.state.reportDown = true
        abortInfo.leases = await q(env, `SELECT lane, lease_token, campaign_id FROM public.auto_engine_leases WHERE account_id = $1 ORDER BY lane`, [acc.id])
        // Như scheduler.stop(): ngừng nhận việc rồi dừng mọi lượt của engine.
        accepting.value = false
        R.runner.abortAll()
      }
    } })
    R = makeRunner(mod, runtime, accepting)
    const [rm, rl] = await Promise.all([R.runner.run(acc, M.campaign), R.runner.run(acc, L.campaign, LANE_JOIN)])
    await sleep(1200) // lời gọi Zalo đang treo trả về sau khi đã dừng
    ctx.runtimeA = runtime
    ctx.abortInfo = abortInfo
    expect('dừng đúng lúc cả hai làn đang gửi (tin nhắn và vào group đều đang chờ Zalo)', abortInfo && abortInfo.inflight.text > 0 && abortInfo.inflight.join > 0, abortInfo)
    expect('cả hai lượt dừng ngay (cancelled)', rm?.reason === 'cancelled' && rl?.reason === 'cancelled', [rm, rl])
    expect('sau khi dừng: isRunning hai làn false, activeCount 0', !R.runner.isRunning(acc.id) && !R.runner.isRunning(acc.id, LANE_JOIN) && R.runner.activeCount === 0)
    const leaseByLane = Object.fromEntries((abortInfo?.leases || []).map(l => [l.lane, l]))
    ctx.oldLease = leaseByLane
    expect('lúc dừng DB giữ lease của cả hai làn', leaseByLane[MAIN]?.campaign_id == M.id && leaseByLane[LANE_JOIN]?.campaign_id == L.id, abortInfo?.leases)
    const journal = env.readJournal().filter(e => e.scope.startsWith(`${STAFF}:${acc.id}`))
    const byScope = countBy(journal, e => e.scope)
    ctx.journalBefore = journal
    expect('nhật ký còn mục chờ ở phạm vi làn chính và phạm vi làn riêng', (byScope[scopeOf(acc.id, MAIN)] || 0) > 0 && (byScope[scopeOf(acc.id, LANE_JOIN)] || 0) > 0, byScope)
    expect('không có phạm vi nhật ký nào khác của tài khoản', Object.keys(byScope).every(s => s === scopeOf(acc.id, MAIN) || s === scopeOf(acc.id, LANE_JOIN)), byScope)
    const runCampaign = new Map((await q(env, `SELECT id, campaign_id FROM public.auto_engine_target_runs WHERE id = ANY($1::bigint[])`,
      [journal.map(e => Number(e.entry.targetRunId))])).map(r => [Number(r.id), Number(r.campaign_id)]))
    const wrong = journal.filter(e => {
      const lane = e.scope === scopeOf(acc.id, MAIN) ? MAIN : LANE_JOIN
      const wantCampaign = lane === MAIN ? M.id : L.id
      return runCampaign.get(Number(e.entry.targetRunId)) !== wantCampaign || e.entry.leaseToken !== leaseByLane[lane]?.lease_token
    })
    expect('mỗi mục nhật ký thuộc lượt data của chiến dịch đúng làn và mang lease của đúng làn', wrong.length === 0,
      wrong.map(e => ({ scope: e.scope, run: e.entry.targetRunId, lease: e.entry.leaseToken })))
    const sentFirst = runtime.calls.filter(c => c.kind === 'text' || c.kind === 'join').map(c => `${c.kind}:${c.key}`)
    expect('mỗi làn đã gửi đúng một data trước khi dừng', sentFirst.filter(k => k.startsWith('text:')).length === 1 && sentFirst.filter(k => k.startsWith('join:')).length === 1, sentFirst)
  })
  env.state.reportDown = false
  if (!ok2 || !ctx.acc) {
    results.push({ label: '3. Mở lại app (bỏ qua vì ca 2 lỗi)', ok: false })
    console.log('FAIL 3. Mở lại app: bỏ qua vì ca 2 lỗi')
    return
  }

  await runCase('3. Mở lại app (runner mới, mở lại file nhật ký): mỗi làn gửi bù đúng mục của nó cho đúng lease, không gửi trùng, chạy tiếp hết data', async expect => {
    const { acc, M, L, oldLease, journalBefore, runtimeA } = ctx
    mod.closeEngineJournal()
    env.resetReader()
    const mainScope = scopeOf(acc.id, MAIN)
    const laneScope = scopeOf(acc.id, LANE_JOIN)
    const laneIdsBefore = journalBefore.filter(e => e.scope === laneScope).map(e => e.id).sort()
    const runtime = makeRuntime('B', { delays: { find: 60, text: 80, friend: 60, join: 80 } })
    const R = makeRunner(mod, runtime)
    // 3a: chỉ chạy làn chính. Gửi bù nhật ký làn chính trước khi nhận lượt; lease làn chính của app cũ chưa hết hạn nên nhận lượt báo busy.
    env.state.phase = 'c3a'
    const r3a = await R.runner.run(acc, M.campaign)
    expect('3a làn chính: nhận lượt báo busy vì lease của app cũ chưa hết hạn', r3a?.reason === 'busy', r3a)
    const flushMain = reportChecks(expect, env, '3a làn chính gửi bù', M.id, acc.id, MAIN, { phase: 'c3a' })
    expect('3a làn chính gửi bù bằng lease làn chính của app cũ', flushMain.every(o => o.leaseToken === oldLease[MAIN].lease_token), flushMain.map(o => o.leaseToken))
    expect('3a làn chính không gửi bù mục nào của làn riêng', env.state.reportObs.filter(o => o.phase === 'c3a' && o.campaignId !== M.id).length === 0)
    const afterA = env.readJournal()
    expect('3a nhật ký làn chính trống, nhật ký làn riêng giữ nguyên', afterA.filter(e => e.scope === mainScope).length === 0
      && JSON.stringify(afterA.filter(e => e.scope === laneScope).map(e => e.id).sort()) === JSON.stringify(laneIdsBefore),
      { main: afterA.filter(e => e.scope === mainScope).length, lane: afterA.filter(e => e.scope === laneScope).map(e => e.id), laneBefore: laneIdsBefore })
    expect('3a không gọi Zalo', runtime.calls.length === 0, runtime.calls)
    // 3b: chạy làn riêng: gửi bù đúng mục của làn riêng.
    env.state.phase = 'c3b'
    const r3b = await R.runner.run(acc, L.campaign, LANE_JOIN)
    expect('3b làn riêng: nhận lượt báo busy vì lease của app cũ chưa hết hạn', r3b?.reason === 'busy', r3b)
    const flushLane = reportChecks(expect, env, '3b làn riêng gửi bù', L.id, acc.id, LANE_JOIN, { phase: 'c3b' })
    expect('3b làn riêng gửi bù bằng lease làn riêng của app cũ', flushLane.every(o => o.leaseToken === oldLease[LANE_JOIN].lease_token), flushLane.map(o => o.leaseToken))
    expect('3b làn riêng không gửi bù mục nào của làn chính', env.state.reportObs.filter(o => o.phase === 'c3b' && o.campaignId !== L.id).length === 0)
    expect('3b nhật ký của tài khoản trống', env.readJournal().filter(e => e.scope.startsWith(`${STAFF}:${acc.id}`)).length === 0)
    // Data đang chạy lúc thoát app. Tin nhắn (thao tác "delivery"): không rõ đã tới nên chốt, không gửi lại. Vào group bằng link (V495 xếp
    // zalo_join_group_link là "idempotent": làm lại vô hại, Zalo trả "đã là thành viên"): về hàng đợi rồi làm lại; ca 3d đối chứng làn chính.
    const inflightIds = [...new Set(journalBefore.map(e => Number(e.entry.targetRunId)))]
    const inflight = await inflightState(env, inflightIds)
    const textRun = inflight.filter(t => Number(t.campaign_id) === M.id)
    const joinRun = inflight.filter(t => Number(t.campaign_id) === L.id)
    expect('tin nhắn đang gửi lúc thoát app (không rõ đã tới): đã chốt, không về "chờ xử lý"', textRun.length === 1 && textRun.every(t => t.closed && t.status !== 'chờ xử lý'), textRun)
    expect('vào group đang chạy lúc thoát app (thao tác làm lại vô hại): về "chờ xử lý" như làn chính', joinRun.length === 1 && joinRun.every(t => t.status === 'chờ xử lý'), joinRun)
    ctx.laneJoinInflight = joinRun.map(t => ({ status: t.status, closed: t.closed, outcomes: t.outcomes }))
    // 3c: thời gian trôi: lease cũ hết hạn, dọn lượt treo (như job close_stale), rồi chạy cả hai làn cùng lúc.
    const close = await expireAndCloseStale(env, acc.id)
    env.state.phase = 'c3c'
    const [rm, rl] = await Promise.all([R.runner.run(acc, M.campaign), R.runner.run(acc, L.campaign, LANE_JOIN)])
    expect('3c chạy lại cả hai làn: hết data (no_target)', rm?.reason === 'no_target' && rl?.reason === 'no_target', { rm, rl, close })
    const all = [...runtimeA.calls, ...runtime.calls].filter(c => ['text', 'friend', 'join'].includes(c.kind))
    const perKey = countBy(all, c => `${c.kind}:${c.key}`)
    const firstText = runtimeA.calls.find(c => c.kind === 'text')?.key
    const firstJoin = runtimeA.calls.find(c => c.kind === 'join')?.key
    expect('không gửi trùng tin nhắn / kết bạn qua hai lần mở app', Object.entries(perKey).every(([k, n]) => k.startsWith('join:') || n === 1), perKey)
    expect('app mới không gửi lại tin nhắn đang gửi dở lúc thoát', !runtime.calls.some(c => (c.kind === 'text' || c.kind === 'friend') && c.key === firstText),
      { firstText, calls: runtime.calls.map(c => `${c.kind}:${c.key}`) })
    ctx.laneJoinCounts = Object.entries(perKey).filter(([k]) => k.startsWith('join:')).map(([k, n]) => (k === `join:${firstJoin}` ? 'inflight' : 'other') + ':' + n).sort()
    expect('vào group: link đang chạy lúc thoát app làm lại đúng một lần, link khác đúng một lần', JSON.stringify(ctx.laneJoinCounts)
      === JSON.stringify(['inflight:2', 'other:1', 'other:1']), perKey)
    expect('app mới gửi đủ: 2 tin + 2 kết bạn + 3 lần vào group (2 link chưa chạy + 1 link làm lại)', runtime.calls.filter(c => c.kind === 'text').length === 2
      && runtime.calls.filter(c => c.kind === 'friend').length === 2 && runtime.calls.filter(c => c.kind === 'join').length === 3, countBy(runtime.calls, c => c.kind))
    reportChecks(expect, env, '3c làn chính', M.id, acc.id, MAIN, { phase: 'c3c' })
    reportChecks(expect, env, '3c làn riêng', L.id, acc.id, LANE_JOIN, { phase: 'c3c' })
    expect('xong: mọi data hoàn thành, không lease, không lượt mở, tài khoản "chờ xử lý", nhật ký trống',
      [...await inputStatuses(env, M.id), ...await inputStatuses(env, L.id)].every(r => r.status === 'hoàn thành') && (await leaseLanes(env, acc.id)).length === 0
      && await openRuns(env, [M.id, L.id]) === 0 && await accountStatus(env, acc.id) === 'chờ xử lý'
      && env.readJournal().filter(e => e.scope.startsWith(`${STAFF}:${acc.id}`)).length === 0,
      { inputs: [...await inputStatuses(env, M.id), ...await inputStatuses(env, L.id)].map(r => `${r.status}|${String(r.note ?? '').slice(0, 50)}`),
        leases: await leaseLanes(env, acc.id), open: await openRuns(env, [M.id, L.id]), account: await accountStatus(env, acc.id) })
  })

  await runCase('3d. Đối chứng: vào group bằng link KHÔNG tích (làn chính), thoát app giữa lúc vào group rồi mở lại: xử lý y như làn riêng ở ca 3', async expect => {
    env.state.phase = 'c3d'
    const acc = await makeAccount(env)
    const J = await makeCampaign(env, acc, LANE_JOIN, { name: 'C3d vào group không tích', rows: links(3, 'cdoi') })
    const accepting = { value: true }
    let R = null
    let aborted = false
    const runtimeA = makeRuntime('A3d', { delays: { join: 900 }, onCall: async (_rec, inflight) => {
      if (aborted || !R || !((inflight.get('join') || 0) > 0)) return
      aborted = true
      env.state.reportDown = true
      accepting.value = false
      R.runner.abortAll()
    } })
    R = makeRunner(mod, runtimeA, accepting)
    const r1 = await R.runner.run(acc, J.campaign)
    await sleep(1200)
    const journal = env.readJournal().filter(e => e.scope.startsWith(`${STAFF}:${acc.id}`))
    env.state.reportDown = false
    expect('dừng giữa lúc vào group (cancelled), nhật ký giữ mục ở phạm vi cũ "nhân viên:tài khoản"', r1?.reason === 'cancelled' && journal.length > 0
      && journal.every(e => e.scope === scopeOf(acc.id, MAIN)), { r1, scopes: countBy(journal, e => e.scope) })
    mod.closeEngineJournal()
    env.resetReader()
    const runtimeB = makeRuntime('B3d', { delays: { join: 60 } })
    const RB = makeRunner(mod, runtimeB)
    const rFlush = await RB.runner.run(acc, J.campaign)
    const inflight = await inflightState(env, [...new Set(journal.map(e => Number(e.entry.targetRunId)))])
    expect('mở lại app: gửi bù rồi báo busy (lease của app cũ chưa hết hạn)', rFlush?.reason === 'busy', rFlush)
    await expireAndCloseStale(env, acc.id)
    const r2 = await RB.runner.run(acc, J.campaign)
    expect('chạy lại hết data (no_target)', r2?.reason === 'no_target', r2)
    const firstJoin = runtimeA.calls.find(c => c.kind === 'join')?.key
    const perKey = countBy([...runtimeA.calls, ...runtimeB.calls].filter(c => c.kind === 'join'), c => `join:${c.key}`)
    const counts = Object.entries(perKey).map(([k, n]) => (k === `join:${firstJoin}` ? 'inflight' : 'other') + ':' + n).sort()
    const mainPattern = inflight.map(t => ({ status: t.status, closed: t.closed, outcomes: t.outcomes }))
    expect('làn chính: link đang chạy lúc thoát app về "chờ xử lý" và làm lại một lần, giống hệt làn riêng ở ca 3',
      JSON.stringify(mainPattern) === JSON.stringify(ctx.laneJoinInflight) && JSON.stringify(counts) === JSON.stringify(ctx.laneJoinCounts),
      { main: { inflight: mainPattern, counts }, lane: { inflight: ctx.laneJoinInflight, counts: ctx.laneJoinCounts } })
    expect('xong: mọi data hoàn thành, không lease, tài khoản "chờ xử lý"', (await inputStatuses(env, J.id)).every(r => r.status === 'hoàn thành')
      && (await leaseLanes(env, acc.id)).length === 0 && await accountStatus(env, acc.id) === 'chờ xử lý')
  })
}

async function case4(env, mod) {
  await runCase('4. Không chạy chồng: run lần hai cùng tài khoản + cùng làn (trong tiến trình: null; máy khác: busy; cùng loại ở làn chính: parallel_wait)', async expect => {
    env.state.phase = 'c4'
    const acc = await makeAccount(env)
    const A1 = await makeCampaign(env, acc, LANE_JOIN, { tick: true, name: 'C4 vào group 1', rows: links(3, 'cbon') })
    const A2 = await makeCampaign(env, acc, LANE_JOIN, { tick: true, name: 'C4 vào group 2', rows: links(2, 'cbonb') })
    const J = await makeCampaign(env, acc, LANE_JOIN, { tick: false, name: 'C4 vào group không tích', rows: links(1, 'cbonc') })
    let started
    const firstCall = new Promise(resolve => { started = resolve })
    const runtime = makeRuntime('A', { delays: { join: 400 }, onCall: async () => started() })
    const RA = makeRunner(mod, runtime)
    const pA1 = RA.runner.run(acc, A1.campaign, LANE_JOIN)
    await firstCall
    const claimsBefore = env.state.rpcLog.filter(r => r.name === 'aka_agent_engine_claim_target_v1' && r.campaignId === A2.id).length
    const dup = await RA.runner.run(acc, A2.campaign, LANE_JOIN)
    expect('trong tiến trình: run lần hai cùng tài khoản + cùng làn trả null ngay', dup === null, dup)
    expect('trong tiến trình: không nhận lượt nào cho chiến dịch thứ hai', env.state.rpcLog.filter(r => r.name === 'aka_agent_engine_claim_target_v1'
      && r.campaignId === A2.id).length === claimsBefore)
    const runtimeB = makeRuntime('B')
    const RB = makeRunner(mod, runtimeB)
    const other = await RB.runner.run(acc, A2.campaign, LANE_JOIN)
    expect('máy khác cùng làn: DB báo busy, không gọi Zalo', other?.reason === 'busy' && runtimeB.calls.length === 0, { other, calls: runtimeB.calls.length })
    const sameType = await RA.runner.run(acc, J.campaign)
    expect('cùng loại ở làn chính (không tích): DB báo parallel_wait, không gọi Zalo cho chiến dịch đó', sameType?.reason === 'parallel_wait'
      && !runtime.calls.some(c => c.key.includes('cbonc')), sameType)
    const leasesNow = await leaseLanes(env, acc.id)
    expect('lúc làn riêng đang chạy: chỉ một lease (làn riêng), chiến dịch chờ không giữ lease', JSON.stringify(leasesNow) === JSON.stringify([LANE_JOIN]), leasesNow)
    expect('chiến dịch chờ không bắt đầu: data vẫn "chờ xử lý", không in "🚀 Bắt đầu"', (await inputStatuses(env, J.id)).every(r => r.status === 'chờ xử lý')
      && (await inputStatuses(env, A2.id)).every(r => r.status === 'chờ xử lý') && !RA.lines.concat(RB.lines).some(l => (l.campaignId === J.id || l.campaignId === A2.id)
      && l.text.startsWith('🚀')))
    const r1 = await pA1
    expect('chiến dịch đầu chạy hết (no_target)', r1?.reason === 'no_target', r1)
    const r2 = await RA.runner.run(acc, A2.campaign, LANE_JOIN)
    const r3 = await RA.runner.run(acc, J.campaign)
    expect('xong chiến dịch đầu thì hai chiến dịch còn lại chạy được', r2?.reason === 'no_target' && r3?.reason === 'no_target', { r2, r3 })
    const a1Calls = runtime.calls.filter(c => c.key.includes('cbon') && !c.key.includes('cbonb') && !c.key.includes('cbonc'))
    const a2Calls = runtime.calls.filter(c => c.key.includes('cbonb'))
    expect('hai chiến dịch cùng loại có tích không chạy chồng: lời gọi của chiến dịch sau bắt đầu sau lời gọi cuối của chiến dịch trước',
      a1Calls.length === 3 && a2Calls.length === 2 && Math.max(...a1Calls.map(c => c.t1)) <= Math.min(...a2Calls.map(c => c.t0)))
    const perKey = countBy(runtime.calls, c => c.key)
    expect('mỗi link vào group đúng một lần', Object.values(perKey).every(n => n === 1) && Object.keys(perKey).length === 6, perKey)
    expect('xong: không lease, tài khoản "chờ xử lý", không lượt mở', (await leaseLanes(env, acc.id)).length === 0 && await accountStatus(env, acc.id) === 'chờ xử lý'
      && await openRuns(env, [A1.id, A2.id, J.id]) === 0)
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 6. App cũ (bản đã phát hành, không biết làn) gặp chiến dịch có tích trên DB sau V670
// ---------------------------------------------------------------------------------------------------------------------------------------

// Bản trước tính năng: dev_3 ngay trước commit "Chạy cùng lúc" (cố định, vì sau khi commit HEAD đã có làn).
const BASELINE_REF = process.env.PARALLEL_RUN_BASELINE_REF ?? 'cab27ed3'
const OLD_REFS = (process.env.PARALLEL_RUN_OLD_REFS ?? `${BASELINE_REF},3832c81d,dc3ca157,a195d29d,3c59c5cd`).split(',').map(s => s.trim()).filter(Boolean)
let oldSeq = 0
const oldUniq = () => ++oldSeq

/** Bộ chạy Desktop của một bản: nguyên cây src + packages của commit đó (bộ chạy, lõi engine, cổng Zalo, nhật ký), thư viện lấy ở node_modules hiện tại. */
async function loadRefBundle(ref) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-pr-desktop-tree-'))
  const r = spawnSync('sh', ['-c', 'git -C "$0" archive "$1" src packages | tar -x -C "$2"', ROOT, ref, tree], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`Không lấy được mã bản ${ref}: ${r.stderr}`)
  const pkg = spawnSync('git', ['-C', ROOT, 'show', `${ref}:package.json`], { encoding: 'utf8' })
  const version = JSON.parse(pkg.stdout).version
  const bundle = await loadBundle(`old-${ref}`, null, tree)
  return { ...bundle, tree, ref, version, label: `${version} (${ref})` }
}

/** Thay mã riêng của từng lần chạy (id tài khoản / chiến dịch, đầu số, mã link) bằng tên chung để so hai lần chạy. */
function normalizeRun(value, subst) {
  let s = JSON.stringify(value)
  for (const [from, to] of [...subst].sort((a, b) => b[0].length - a[0].length)) s = s.split(from).join(to)
  return JSON.parse(s)
}

const campaignDetails = async (env, id) => (await q(env, `SELECT d.action_code, d.action_name, d.status, d.error_code, d.log FROM public.auto_campaign_details d
  JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id WHERE i.campaign_id = $1 ORDER BY d.id`, [id]))
const accountJournal = (env, accountId) => env.readJournal().filter(e => e.scope === `${STAFF}:${accountId}` || e.scope.startsWith(`${STAFF}:${accountId}:`))
const reportRpcs = (env, leaseToken, since) => env.state.rpcLog.filter(r => r.name === 'aka_agent_engine_report_v1' && r.leaseToken === leaseToken && r.t0 >= since)

/** 6a. Một lần chạy của app cũ: chiến dịch nhắn SĐT (không tích) đang chạy, chiến dịch vào group (có tích hoặc không) chạy sau. */
async function oldSequentialRun(env, mod, tag, tick) {
  env.state.phase = `c6a-${tag}-${tick ? 'tick' : 'plain'}`
  const n = oldUniq()
  const pfx = `09${60 + n}`
  const code = `oldv${n}x`
  const acc = await makeAccount(env)
  const M = await makeCampaign(env, acc, 'zalo_message_phone', { name: 'C6a nhắn SĐT', rows: phones(2, pfx), extra: MAIN_EXTRA, content: 'Chào #{FULL_NAME}' })
  const L = await makeCampaign(env, acc, LANE_JOIN, { tick, name: 'C6a vào group', rows: links(2, code) })
  const samples = []
  let R
  const runtime = makeRuntime(`c6a-${tag}`, { delays: { find: 60, text: 120, friend: 60, join: 80 }, onCall: async rec => {
    samples.push({ kind: rec.kind, leases: await leaseLanes(env, acc.id), account: await accountStatus(env, acc.id) })
  } })
  R = makeRunner(mod, runtime)
  const support = [R.runner.support(acc, M.campaign).ok, R.runner.support(acc, L.campaign).ok]
  const pM = R.runner.run(acc, M.campaign)
  // Bản cũ: mỗi tài khoản một lượt trong tiến trình; chiến dịch có tích chờ lượt quét sau như mọi chiến dịch khác.
  const dup = await R.runner.run(acc, L.campaign)
  const rM = await pM
  const rL = await R.runner.run(acc, L.campaign)
  const reports = env.state.reportObs.filter(o => o.phase === env.state.phase)
  const subst = [[String(acc.id), 'ACC'], [String(M.id), 'CM'], [String(L.id), 'CL'], [pfx, 'PFX'], [code, 'CODE'], ...[...M.ids, ...L.ids].map((id, i) => [String(id), `ROW${i}`])]
  const summary = {
    support, dup, results: [rM?.reason, rM?.targets, rL?.reason, rL?.targets],
    lines: R.lines.map(l => `${l.campaignId === M.id ? 'M' : 'L'}|${l.text}`),
    details: { M: await campaignDetails(env, M.id), L: await campaignDetails(env, L.id) },
    inputs: { M: (await inputStatuses(env, M.id)).map(r => [r.status, r.note]), L: (await inputStatuses(env, L.id)).map(r => [r.status, r.note]) },
    campaigns: [await campaignStatus(env, M.id), await campaignStatus(env, L.id)],
    calls: runtime.calls.map(c => `${c.kind}:${c.key}`),
    reportScopes: [...new Set(reports.flatMap(o => o.scopes))].sort(),
    reportCount: reports.length,
    samples: samples.map(s => ({ kind: s.kind, leases: s.leases.length, account: s.account })),
    end: { leases: (await leaseLanes(env, acc.id)).length, account: await accountStatus(env, acc.id), open: await openRuns(env, [M.id, L.id]),
      journal: accountJournal(env, acc.id).length }
  }
  const lanes = { M: [...new Set(reports.filter(o => o.campaignId === M.id).map(o => o.lane))], L: [...new Set(reports.filter(o => o.campaignId === L.id).map(o => o.lane))] }
  return { summary: normalizeRun(summary, subst), lanes }
}

/** App cũ dừng đột ngột (thoát app, DB không nhận báo cáo) đúng lúc đang vào group của chiến dịch có tích. */
async function crashOldOnTicked(env, mod, tag, phase, rows) {
  env.state.phase = phase
  const acc = await makeAccount(env)
  const code = `oldc${oldUniq()}x`
  const L = await makeCampaign(env, acc, LANE_JOIN, { tick: true, name: `${phase} vào group có tích`, rows: links(rows, code) })
  const accepting = { value: true }
  let R = null
  let aborted = false
  const runtimeA = makeRuntime(`A-${phase}`, { delays: { join: 900 }, onCall: async (_rec, inflight) => {
    if (aborted || !R || !((inflight.get('join') || 0) > 0)) return
    aborted = true
    env.state.reportDown = true
    accepting.value = false
    R.runner.abortAll()
  } })
  R = makeRunner(mod, runtimeA, accepting)
  const result = await R.runner.run(acc, L.campaign)
  await sleep(1200) // lời gọi Zalo đang treo trả về sau khi đã dừng
  const leases = await q(env, `SELECT lane, lease_token, campaign_id, expires_at > now() AS live FROM public.auto_engine_leases WHERE account_id = $1 ORDER BY lane`, [acc.id])
  const journal = accountJournal(env, acc.id)
  env.state.reportDown = false
  mod.closeEngineJournal()
  env.resetReader()
  return { acc, L, code, result, leases, journal, runtimeA }
}

function crashChecks(expect, c) {
  expect('app cũ dừng giữa lúc vào group (cancelled)', c.result?.reason === 'cancelled', c.result)
  expect('DB cấp cho chiến dịch có tích lease ở làn riêng dù app cũ không biết làn', c.leases.length === 1 && c.leases[0].lane === LANE_JOIN
    && Number(c.leases[0].campaign_id) === c.L.id && c.leases[0].live === true, c.leases)
  expect('nhật ký app cũ giữ mục chờ ở phạm vi cũ "nhân viên:tài khoản", mang lease làn riêng', c.journal.length > 0
    && c.journal.every(e => e.scope === `${STAFF}:${c.acc.id}` && e.entry.leaseToken === c.leases[0]?.lease_token),
    c.journal.map(e => ({ scope: e.scope, lease: e.entry.leaseToken })))
}

/** Đếm số lần vào từng link: link đang chạy lúc dừng ('inflight') và link khác ('other'). */
function joinCounts(calls, firstKey) {
  const perKey = countBy(calls.filter(c => c.kind === 'join'), c => c.key)
  return Object.entries(perKey).map(([k, n]) => `${k === firstKey ? 'inflight' : 'other'}:${n}`).sort()
}

async function case6(env, oldBundle, newMod, joinPattern) {
  const tag = oldBundle.ref
  const label = oldBundle.label
  const mod = oldBundle.mod

  await runCase(`6a. App cũ ${label}: chiến dịch có tích chạy lần lượt sau chiến dịch đang chạy của tài khoản, kết quả như không tích`, async expect => {
    const ticked = await oldSequentialRun(env, mod, tag, true)
    const plain = await oldSequentialRun(env, mod, tag, false)
    const t = ticked.summary
    expect('engine của app cũ nhận cả hai chiến dịch', t.support.every(Boolean), t.support)
    expect('trong lúc chiến dịch nhắn SĐT chạy, app cũ không chạy chiến dịch có tích (run trả null)', t.dup === null, t.dup)
    expect('cả hai chiến dịch chạy hết data (no_target)', t.results[0] === 'no_target' && t.results[2] === 'no_target', t.results)
    expect('mỗi lúc tài khoản chỉ có một lease', t.samples.every(s => s.leases === 1), t.samples)
    expect('DB cấp lease làn riêng cho chiến dịch có tích, làn chính cho chiến dịch không tích', JSON.stringify(ticked.lanes)
      === JSON.stringify({ M: [MAIN], L: [LANE_JOIN] }), ticked.lanes)
    expect('đối chứng không tích: cả hai ở làn chính', JSON.stringify(plain.lanes) === JSON.stringify({ M: [MAIN], L: [MAIN] }), plain.lanes)
    expect('nhật ký chỉ dùng phạm vi cũ "nhân viên:tài khoản"', JSON.stringify(t.reportScopes) === JSON.stringify([`${STAFF}:ACC`]), t.reportScopes)
    expect('xong: mọi data hoàn thành, không lease, không lượt mở, tài khoản "chờ xử lý", nhật ký trống', t.end.leases === 0 && t.end.open === 0
      && t.end.journal === 0 && t.end.account === 'chờ xử lý' && [...t.inputs.M, ...t.inputs.L].every(r => r[0] === 'hoàn thành'), { end: t.end, inputs: t.inputs })
    const same = JSON.stringify(ticked.summary) === JSON.stringify(plain.summary)
    if (!same) for (const k of Object.keys(t)) {
      if (JSON.stringify(t[k]) !== JSON.stringify(plain.summary[k])) expect(`có tích = không tích: khác ở "${k}"`, false, { tick: t[k], plain: plain.summary[k] })
    }
    expect('có tích và không tích cho cùng tiến trình, lịch sử hành động, trạng thái data, lời gọi Zalo', same)
  })

  await runCase(`6c. App cũ ${label} dừng đột ngột giữa chiến dịch có tích rồi mở lại: gửi bù, chiến dịch cùng loại chờ (parallel_wait), chạy tiếp không trùng`, async expect => {
    const c = await crashOldOnTicked(env, mod, tag, `c6c-${tag}`, 3)
    crashChecks(expect, c)
    const J = await makeCampaign(env, c.acc, LANE_JOIN, { name: 'C6c vào group không tích', rows: links(2, `${c.code}j`) })
    const runtimeB = makeRuntime(`B6c-${tag}`, { delays: { join: 60 } })
    const RB = makeRunner(mod, runtimeB)
    env.state.phase = `c6c-${tag}-reopen`
    const t0 = Date.now()
    const laneToken = c.leases[0]?.lease_token
    // Mở lại app cũ: chiến dịch không tích cùng loại chạy trước (thứ tự hàng đợi tuỳ lịch). Lượt đầu gửi bù nhật ký phạm vi cũ, rồi DB báo chờ vì
    // lease làn riêng của lượt bị dừng còn hạn (trước V670 cũng chờ: busy tới khi lease đó hết hạn).
    const rJ = await RB.runner.run(c.acc, J.campaign)
    const flushed = reportRpcs(env, laneToken, t0)
    expect('mở lại: gửi bù nhật ký bằng lease làn riêng, DB nhận', flushed.length === c.journal.length && flushed.every(r => !r.error), flushed)
    expect('chiến dịch cùng loại không tích: DB báo parallel_wait, app cũ kết thúc lượt êm', rJ?.reason === 'parallel_wait', rJ)
    expect('chiến dịch chờ không gọi Zalo, không in "🚀", data vẫn "chờ xử lý", không ghi chú, không lease',
      runtimeB.calls.length === 0 && !RB.lines.some(l => l.campaignId === J.id && l.text.startsWith('🚀'))
      && (await inputStatuses(env, J.id)).every(r => r.status === 'chờ xử lý' && r.note === null)
      && (await q(env, `SELECT note FROM public.auto_campaigns WHERE id = $1`, [J.id]))[0].note === null
      && JSON.stringify(await leaseLanes(env, c.acc.id)) === JSON.stringify([LANE_JOIN]),
      { calls: runtimeB.calls, lines: RB.lines, inputs: await inputStatuses(env, J.id), leases: await leaseLanes(env, c.acc.id) })
    expect('nhật ký của tài khoản trống sau khi gửi bù', accountJournal(env, c.acc.id).length === 0)
    const rL = await RB.runner.run(c.acc, c.L.campaign)
    expect('chiến dịch có tích: lease của lượt bị dừng còn hạn nên busy', rL?.reason === 'busy', rL)
    await expireAndCloseStale(env, c.acc.id)
    const rL2 = await RB.runner.run(c.acc, c.L.campaign)
    const rJ2 = await RB.runner.run(c.acc, J.campaign)
    expect('lease hết hạn, job dọn lượt treo: cả hai chiến dịch chạy hết data', rL2?.reason === 'no_target' && rJ2?.reason === 'no_target', { rL2, rJ2 })
    const firstJoin = c.runtimeA.calls.find(x => x.kind === 'join')?.key
    const counts = joinCounts([...c.runtimeA.calls, ...runtimeB.calls].filter(x => x.key.includes(c.code) && !x.key.includes(`${c.code}j`)), firstJoin)
    expect('chiến dịch có tích: link đang vào lúc dừng làm lại đúng một lần, link khác đúng một lần (như làn chính, ca 3d)',
      JSON.stringify(counts) === JSON.stringify(joinPattern), { counts, joinPattern })
    expect('chiến dịch không tích: mỗi link đúng một lần', joinCounts(runtimeB.calls.filter(x => x.key.includes(`${c.code}j`)), null).join() === 'other:1,other:1')
    expect('xong: mọi data hoàn thành, không lease, không lượt mở, tài khoản "chờ xử lý"', [...await inputStatuses(env, c.L.id), ...await inputStatuses(env, J.id)]
      .every(r => r.status === 'hoàn thành') && (await leaseLanes(env, c.acc.id)).length === 0 && await openRuns(env, [c.L.id, J.id]) === 0
      && await accountStatus(env, c.acc.id) === 'chờ xử lý')
  })

  await runCase(`6d. Nâng cấp ${label} → bản mới sau khi app cũ dừng giữa chiến dịch có tích: làn chính gửi bù nhật ký phạm vi cũ, không gửi trùng`, async expect => {
    newMod.closeEngineJournal()
    const c = await crashOldOnTicked(env, mod, tag, `c6d-${tag}`, 3)
    crashChecks(expect, c)
    const laneToken = c.leases[0]?.lease_token
    const runtimeB = makeRuntime(`B6d-${tag}`, { delays: { find: 60, text: 80, friend: 60, join: 60 } })
    const RN = makeRunner(newMod, runtimeB)
    env.state.phase = `c6d-${tag}-new`
    const t0 = Date.now()
    const r1 = await RN.runner.run(c.acc, c.L.campaign, LANE_JOIN)
    expect('app mới, làn riêng: lease của app cũ còn hạn nên busy', r1?.reason === 'busy', r1)
    expect('làn riêng không gửi bù nhật ký phạm vi cũ (mục của app cũ còn nguyên)', reportRpcs(env, laneToken, t0).length === 0
      && accountJournal(env, c.acc.id).length === c.journal.length, { sent: reportRpcs(env, laneToken, t0), journal: accountJournal(env, c.acc.id).length })
    const M = await makeCampaign(env, c.acc, 'zalo_message_phone', { name: 'C6d nhắn SĐT', rows: phones(2, `09${60 + oldUniq()}`), extra: MAIN_EXTRA, content: 'Chào #{FULL_NAME}' })
    const rM = await RN.runner.run(c.acc, M.campaign)
    const flushed = reportRpcs(env, laneToken, t0)
    expect('làn chính (khác loại, không chung thao tác) chạy được cạnh lease làn riêng của app cũ, hết data', rM?.reason === 'no_target', rM)
    expect('làn chính gửi bù nhật ký phạm vi cũ bằng lease làn riêng của app cũ, DB nhận', flushed.length === c.journal.length && flushed.every(r => !r.error), flushed)
    expect('nhật ký của tài khoản trống', accountJournal(env, c.acc.id).length === 0)
    await expireAndCloseStale(env, c.acc.id)
    const r2 = await RN.runner.run(c.acc, c.L.campaign, LANE_JOIN)
    expect('lease hết hạn, job dọn lượt treo: app mới chạy tiếp chiến dịch có tích ở làn riêng, hết data', r2?.reason === 'no_target', r2)
    const firstJoin = c.runtimeA.calls.find(x => x.kind === 'join')?.key
    const counts = joinCounts([...c.runtimeA.calls, ...runtimeB.calls], firstJoin)
    expect('vào group: link đang vào lúc dừng làm lại đúng một lần, link khác đúng một lần', JSON.stringify(counts) === JSON.stringify(joinPattern), { counts, joinPattern })
    expect('nhắn SĐT: mỗi người một tin, một lời mời', Object.values(countBy(runtimeB.calls.filter(x => x.kind === 'text' || x.kind === 'friend'), x => `${x.kind}:${x.key}`))
      .every(v => v === 1) && runtimeB.calls.filter(x => x.kind === 'text').length === 2)
    expect('xong: mọi data hoàn thành, không lease, không lượt mở, tài khoản "chờ xử lý", nhật ký trống',
      [...await inputStatuses(env, c.L.id), ...await inputStatuses(env, M.id)].every(r => r.status === 'hoàn thành') && (await leaseLanes(env, c.acc.id)).length === 0
      && await openRuns(env, [c.L.id, M.id]) === 0 && await accountStatus(env, c.acc.id) === 'chờ xử lý' && accountJournal(env, c.acc.id).length === 0)
    newMod.closeEngineJournal()
    env.resetReader()
  })

  await runCase(`6e. Nâng cấp ${label} → bản mới, tài khoản chỉ có chiến dịch có tích: nhật ký phạm vi cũ nằm lại tới khi làn chính chạy, DB từ chối vô hại`, async expect => {
    const c = await crashOldOnTicked(env, mod, tag, `c6e-${tag}`, 3)
    crashChecks(expect, c)
    const laneToken = c.leases[0]?.lease_token
    const runtimeB = makeRuntime(`B6e-${tag}`, { delays: { find: 60, text: 80, friend: 60, join: 60 } })
    const RN = makeRunner(newMod, runtimeB)
    env.state.phase = `c6e-${tag}-new`
    const t0 = Date.now()
    const r1 = await RN.runner.run(c.acc, c.L.campaign, LANE_JOIN)
    expect('app mới, làn riêng: busy (lease của app cũ còn hạn)', r1?.reason === 'busy', r1)
    const close = await expireAndCloseStale(env, c.acc.id)
    const r2 = await RN.runner.run(c.acc, c.L.campaign, LANE_JOIN)
    expect('lease hết hạn, job dọn lượt treo: chạy tiếp hết data', r2?.reason === 'no_target', { r2, close })
    const firstJoin = c.runtimeA.calls.find(x => x.kind === 'join')?.key
    const counts = joinCounts([...c.runtimeA.calls, ...runtimeB.calls], firstJoin)
    const rows = await q(env, `SELECT i.uid, i.status, i.note, (SELECT count(*) FROM public.auto_campaign_details d WHERE d.input_data_id = i.id)::int AS details
      FROM public.auto_campaign_input_data i WHERE i.campaign_id = $1 ORDER BY i.id`, [c.L.id])
    const inflightRow = rows.find(r => String(firstJoin ?? '').endsWith(r.uid)) // runner gửi link dạng https://zalo.me/g/…
    // Không ai gửi bù nhật ký phạm vi cũ trước khi job đóng lượt treo: job đóng data đang vào dở bằng SYS02, không làm lại (như khi mất nhật ký,
    // ví dụ app bị tắt ngang). Các ca 6c / 6d (có người gửi bù) thì data đó về hàng đợi và làm lại một lần. Không gửi trùng trong cả hai trường hợp.
    expect('vào group: link đang vào lúc dừng không làm lại (job đóng SYS02, như khi mất nhật ký), link khác đúng một lần',
      JSON.stringify(counts) === JSON.stringify(['inflight:1', 'other:1', 'other:1']) && inflightRow?.status === 'hoàn thành'
      && /\(SYS02\)$/.test(String(inflightRow?.note ?? '')) && inflightRow?.details === 0, { counts, close, rows, firstJoin })
    const leftover = accountJournal(env, c.acc.id)
    expect('nhật ký phạm vi cũ của app cũ còn nằm lại (làn riêng không gửi bù), không mục nào ở phạm vi làn riêng', leftover.length === c.journal.length
      && leftover.every(e => e.scope === `${STAFF}:${c.acc.id}`) && reportRpcs(env, laneToken, t0).length === 0, leftover.map(e => e.scope))
    const detailsBefore = await campaignDetails(env, c.L.id)
    const inputsBefore = await inputStatuses(env, c.L.id)
    // Sau này tài khoản có chiến dịch không tích (làn chính): lượt đầu gửi bù các mục đó, DB từ chối (lượt đã đóng), nhật ký xoá mục.
    const M = await makeCampaign(env, c.acc, 'zalo_message_phone', { name: 'C6e nhắn SĐT', rows: phones(1, `09${60 + oldUniq()}`), extra: MAIN_EXTRA, content: 'Chào #{FULL_NAME}' })
    const t1 = Date.now()
    const rM = await RN.runner.run(c.acc, M.campaign)
    const late = reportRpcs(env, laneToken, t1)
    expect('làn chính chạy hết data', rM?.reason === 'no_target', rM)
    expect('làn chính gửi bù các mục còn nằm lại, DB trả lời (không lỗi gọi)', late.length === c.journal.length && late.every(r => !r.error), late)
    expect('nhật ký của tài khoản trống', accountJournal(env, c.acc.id).length === 0)
    expect('gửi bù muộn không đổi lịch sử hành động hay trạng thái data của chiến dịch có tích',
      JSON.stringify(await campaignDetails(env, c.L.id)) === JSON.stringify(detailsBefore) && JSON.stringify(await inputStatuses(env, c.L.id)) === JSON.stringify(inputsBefore))
    expect('xong: không lease, không lượt mở, tài khoản "chờ xử lý"', (await leaseLanes(env, c.acc.id)).length === 0
      && await openRuns(env, [c.L.id, M.id]) === 0 && await accountStatus(env, c.acc.id) === 'chờ xử lý')
    newMod.closeEngineJournal()
    env.resetReader()
  })
}

/** Ca 5: chỉ chiến dịch không tích, như mọi tài khoản hôm nay. Trả bản tóm tắt đã chuẩn hoá để so giữa các bản runner / DB. */
async function compatWorkload(env, mod, tag) {
  env.state.phase = `c5-${tag}`
  const acc = await makeAccount(env)
  const M = await makeCampaign(env, acc, 'zalo_message_phone', { name: 'Desktop SĐT', rows: [{ name: 'An', phone: '0922000001' }, { name: 'Bình', phone: '0922000009' }],
    extra: MAIN_EXTRA, content: 'Chào #{FULL_NAME}' })
  const J = await makeCampaign(env, acc, LANE_JOIN, { name: 'Vào group', rows: [{ uid: 'zalo.me/g/compat' }] })
  const samples = []
  let R
  const hasIsRunning = () => typeof R.runner.isRunning === 'function'
  const runtime = makeRuntime(`c5-${tag}`, { delays: { find: 60, text: 120, friend: 60, join: 60 }, onCall: async rec => {
    samples.push({ kind: rec.kind, isRunning: hasIsRunning() ? [R.runner.isRunning(acc.id), R.runner.isRunning(acc.id, MAIN), R.runner.isRunning(acc.id, LANE_JOIN)] : null,
      active: R.runner.activeCount, leases: (await leaseLanes(env, acc.id)).length, account: await accountStatus(env, acc.id) })
  } })
  R = makeRunner(mod, runtime)
  const support = [R.runner.support(acc, M.campaign), R.runner.support(acc, J.campaign)]
  const pM = R.runner.run(acc, M.campaign)
  const dup = await R.runner.run(acc, J.campaign)
  const rM = await pM
  const after = { isRunning: hasIsRunning() ? [R.runner.isRunning(acc.id), R.runner.isRunning(acc.id, MAIN)] : null, active: R.runner.activeCount }
  const rJ = await R.runner.run(acc, J.campaign)
  const details = async id => (await q(env, `SELECT d.action_code, d.action_name, d.status, d.error_code, d.log FROM public.auto_campaign_details d
    JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id WHERE i.campaign_id = $1 ORDER BY d.id`, [id]))
  const reports = env.state.reportObs.filter(o => o.phase === `c5-${tag}`)
  const norm = s => String(s).replaceAll(String(acc.id), 'ACC')
  return {
    support, dupWhileMainRunning: dup, results: [rM?.reason, rM?.targets, rJ?.reason, rJ?.targets],
    lines: R.lines.map(l => `${l.campaignId === M.id ? 'M' : 'J'}|${l.text}`),
    details: { M: await details(M.id), J: await details(J.id) },
    inputs: { M: (await inputStatuses(env, M.id)).map(r => [r.status, r.note]), J: (await inputStatuses(env, J.id)).map(r => [r.status, r.note]) },
    campaigns: [await campaignStatus(env, M.id), await campaignStatus(env, J.id)],
    calls: runtime.calls.map(c => `${c.kind}:${c.key}`),
    reportScopes: [...new Set(reports.flatMap(o => o.scopes.map(norm)))].sort(),
    reportCount: reports.length,
    samples: samples.map(s => ({ kind: s.kind, active: s.active, leases: s.leases, account: s.account })),
    isRunning: { during: samples.map(s => s.isRunning), after },
    end: { leases: (await leaseLanes(env, acc.id)).length, account: await accountStatus(env, acc.id), open: await openRuns(env, [M.id, J.id]),
      journal: env.readJournal().filter(e => e.scope.startsWith(`${STAFF}:${acc.id}`)).length }
  }
}

function compareCompat(expect, a, b, label) {
  const strip = x => { const { isRunning, ...rest } = x; return rest }
  const same = JSON.stringify(strip(a)) === JSON.stringify(strip(b))
  if (!same) {
    for (const key of Object.keys(strip(a))) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) expect(`${label}: khác ở "${key}"`, false, { a: a[key], b: b[key] })
    }
  }
  return expect(label, same)
}

// ---------------------------------------------------------------------------------------------------------------------------------------

async function main() {
  const quiet = { info: console.info, warn: console.warn }
  const engineLogs = []
  const engineLog = a => typeof a[0] === 'string' && /^\[(CampaignEngine|ZaloMessageStatus)\]/.test(a[0])
  console.info = (...a) => { if (engineLog(a)) engineLogs.push(['info', ...a]); else quiet.info(...a) }
  console.warn = (...a) => { if (engineLog(a)) engineLogs.push(['warn', ...a]); else quiet.warn(...a) }
  const outs = []
  const headSource = spawnSync('git', ['-C', ROOT, 'show', `${BASELINE_REF}:src/main/engineAdapters/desktopEngineRunner.ts`], { encoding: 'utf8' })
  if (headSource.status !== 0) throw new Error(`Không đọc được runner bản trước (${BASELINE_REF}): ` + headSource.stderr)
  if (/PARALLEL_RUN_MAIN_LANE/.test(headSource.stdout)) throw new Error(`Bản trước ${BASELINE_REF} đã có làn: đặt PARALLEL_RUN_BASELINE_REF về commit trước tính năng`)
  // Đối chứng (PARALLEL_RUN_DESKTOP_RUNNER_MUTANT=scope|key): dựng runner mới đã sửa sai như bản trước V670 để thấy bài kiểm bắt được lỗi.
  const MUTANTS = {
    scope: [/return lane === PARALLEL_RUN_MAIN_LANE \? `\$\{staffId\}:\$\{accountId\}` : `\$\{staffId\}:\$\{accountId\}:\$\{lane\}`/, 'return `${staffId}:${accountId}`'],
    key: [/return lane === PARALLEL_RUN_MAIN_LANE \? String\(accountId\) : `\$\{accountId\}:\$\{lane\}`/, 'return String(accountId)']
  }
  const mutant = process.env.PARALLEL_RUN_DESKTOP_RUNNER_MUTANT
  let currentSource
  if (mutant) {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/engineAdapters/desktopEngineRunner.ts'), 'utf8')
    const [re, rep] = MUTANTS[mutant] || []
    if (!re || !re.test(src)) throw new Error(`Không áp được bản sai "${mutant}"`)
    currentSource = src.replace(re, rep)
    console.log(`  (đối chứng) runner mới bị sửa sai kiểu "${mutant}": các ca của làn riêng phải hỏng`)
  }
  const current = await loadBundle('new', currentSource)
  const head = await loadBundle('head', headSource.stdout)
  outs.push(current.out, head.out)
  const compat = {}
  try {
    // ---- DB trước V670 (6 hàm production 26/11): runner bản trước và runner mới, chỉ chiến dịch không tích -------------------------------
    const live = await openEnv('live')
    try {
      useEnv(live)
      compat.headLive = await compatWorkload(live, head.mod, 'head-live')
      head.mod.closeEngineJournal()
      live.resetReader()
      compat.newLive = await compatWorkload(live, current.mod, 'new-live')
      current.mod.closeEngineJournal()
      live.resetReader()
    } finally {
      await live.close()
    }

    // ---- DB sau V670 --------------------------------------------------------------------------------------------------------------
    const env = await openEnv('1')
    try {
      useEnv(env)
      const parallel = (await env.db.query(`SELECT id FROM public.auto_campaign_actions WHERE allow_parallel_run ORDER BY id`)).rows.map(r => r.id)
      assert.deepEqual(parallel, [LANE_CANCEL, 'zalo_add_group_member', LANE_JOIN].sort(), 'V670 bật đúng 3 loại')
      assert.equal(env.hasLane, true, 'auto_engine_leases có cột lane (V670 p3)')
      const conflict = (await env.db.query(`SELECT n.nspname || '.' || p.proname AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'private') AND p.prosrc ~ 'auto_engine_leases' AND p.prosrc ~* 'on\\s+conflict\\s*\\(\\s*account_id\\s*\\)'`)).rows.map(r => r.f)
      console.log(`  (kiểm tĩnh) hàm còn "ON CONFLICT (account_id)" trên lease: ${conflict.length ? conflict.join(', ') : 'không có'}`)

      compat.newV670 = await compatWorkload(env, current.mod, 'new-v670')
      await runCase('5. Không có làn riêng: runner bản trước và runner mới trên DB trước V670, runner mới trên DB sau V670 cho cùng kết quả', async expect => {
        const n = compat.newV670
        expect('chạy được: hai chiến dịch hoàn thành, không lease, không lượt mở, nhật ký trống', n.campaigns.every(s => s === 'hoàn thành') && n.end.leases === 0
          && n.end.open === 0 && n.end.journal === 0 && n.end.account === 'chờ xử lý', n)
        expect('run chiến dịch thứ hai khi làn chính của tài khoản đang chạy: null (khoá theo tài khoản như trước)', n.dupWhileMainRunning === null)
        expect('nhật ký dùng phạm vi cũ "nhân viên:tài khoản"', JSON.stringify(n.reportScopes) === JSON.stringify([`${STAFF}:ACC`]), n.reportScopes)
        expect('isRunning(tài khoản) = isRunning(tài khoản, "main"); làn riêng không chạy',
          n.isRunning.during.every(x => x[0] === true && x[1] === true && x[2] === false) && n.isRunning.after.isRunning.every(x => x === false)
          && n.isRunning.after.active === 0, n.isRunning)
        expect('mỗi lúc chỉ một lease, một lượt', n.samples.every(s => s.leases === 1 && s.active === 1), n.samples)
        compareCompat(expect, compat.headLive, compat.newLive, 'runner bản trước = runner mới trên DB trước V670')
        compareCompat(expect, compat.newLive, compat.newV670, 'runner mới: DB trước V670 = DB sau V670')
        expect('isRunning của runner mới như nhau trước / sau V670', JSON.stringify(compat.newLive.isRunning) === JSON.stringify(compat.newV670.isRunning),
          { live: compat.newLive.isRunning, v670: compat.newV670.isRunning })
      })

      await case1(env, current.mod)
      await case23(env, current.mod)
      await case4(env, current.mod)
      // Ca 3d (làn chính): link vào group đang chạy lúc thoát app làm lại một lần; chiến dịch có tích của app cũ phải y như vậy.
      const joinPattern = ['inflight:2', 'other:1', 'other:1']
      for (const ref of OLD_REFS) {
        const old = await loadRefBundle(ref)
        outs.push(old.out, old.tree)
        console.log(`  (app cũ) ${old.label}`)
        try {
          await case6(env, old, current.mod, joinPattern)
        } finally {
          old.mod.closeEngineJournal()
          env.resetReader()
        }
      }
    } finally {
      current.mod.closeEngineJournal()
      await env.close()
    }
  } finally {
    for (const out of outs) fs.rmSync(out, { recursive: true, force: true })
    console.info = quiet.info
    console.warn = quiet.warn
  }
  const failed = results.filter(r => !r.ok)
  if (failed.length && process.env.PARALLEL_RUN_DESKTOP_RUNNER_DEBUG === '1') {
    for (const l of engineLogs.slice(-80)) console.log(JSON.stringify(l).slice(0, 400))
  }
  console.log(`\n${results.length - failed.length}/${results.length} ca đạt`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch(err => { console.error(err); process.exit(1) })
