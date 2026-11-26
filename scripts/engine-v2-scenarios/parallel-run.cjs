// Giả lập "Chạy cùng lúc" (V670) cho engine v2 trên PostgreSQL 17 cục bộ. Mỗi tài khoản có chiến dịch thường (làn chính) và chiến dịch
// có tích (làn riêng theo loại: huỷ lời mời, tham gia group, thêm thành viên), chạy đồng thời bằng lõi engine thật như bộ lập lịch
// Desktop / Fly (mỗi làn một hàng đợi; làn chính giữ thứ tự giờ chạy, gặp chờ thì dừng hàng đợi). Có lỗi tiêm vào: DB mất câu trả lời,
// lỗi Zalo theo phân bố thật, app / worker chết giữa lượt rồi mở lại (Desktop giữ nhật ký theo làn, Fly mất nhật ký), bộ chạy khác chiếm
// lease của một làn, akaBiz tắt một loại giữa vòng. Kiểm bất biến trong lúc chạy (theo dõi bảng lease mỗi ~25 ms) và sau khi dọn.
// Không chạm DB thật, không gọi Zalo.
//
//   CHAT_REPO=../akaAgentChatApi node scripts/engine-v2-scenarios/parallel-run.cjs [--seed 1] [--accounts 20] [--targets 8] [--rounds 3]
//     [--chaos 2] [--inject 0.01] [--dbchaos 0.01] [--kills 2] [--steals 2] [--pool 5] [--parity | --parity-only] [--out report.json]
//
// Bất biến riêng của chạy cùng lúc (ngoài I1–I15 của run.cjs):
//   P1  không bao giờ hai lease còn hạn của cùng tài khoản cùng loại chiến dịch (mỗi loại một cái).
//   P2  không bao giờ hai lease còn hạn ở hai làn khác nhau của cùng tài khoản dùng chung thao tác.
//   P3  tài khoản không bị trả về "chờ xử lý" khi một làn còn lease và còn data đang chạy.
//   P4  không có hai lần gọi Zalo chồng nhau thời gian của hai chiến dịch cùng loại / chung thao tác trên cùng tài khoản.
//   P5  (đo, không phải lỗi) số cặp lần gọi chồng nhau của hai làn không xung đột: chứng minh các làn chạy cùng lúc thật.
//   P6  (--parity) chiến dịch không tích cho đúng kết quả như khi tài khoản không có chiến dịch có tích nào.
//   P8  chiến dịch còn phải chờ khi vòng kết thúc (chờ mãi).
//   P9  claim trả parallel_wait mà hàm "Lý do đang chờ" (aka_agent_engine_parallel_wait_v1, hỏi cả khi gửi mã thao tác lõi như Desktop và khi
//       không gửi) không ra đúng chiến dịch chặn, lý do, thao tác trong khi chiến dịch chặn vẫn còn lease.
'use strict'
for (const [k, v] of Object.entries({ SCENARIO_FACEBOOK_MIGRATIONS: '1', SCENARIO_TARGET_CHECK: '1', SCENARIO_ORPHAN_RUNS: '1', SCENARIO_PARALLEL_RUN: '1' })) {
  if (!process.env[k]) process.env[k] = v
}
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { performance } = require('node:perf_hooks')
const { ROOT, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const W = require('./world.cjs')
const { bootstrap } = require('./bootstrap.cjs')
const { makePort } = require('./port.cjs')

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const flag = name => args.includes(name)
const SEED = Number(opt('--seed', 1))
const ACCOUNTS = Number(opt('--accounts', 20))
const TARGETS = Number(opt('--targets', 8))
const ROUNDS = Number(opt('--rounds', 3))
const CHAOS = Number(opt('--chaos', 2))
const INJECT = Number(opt('--inject', 0.01))
const DBCHAOS = Number(opt('--dbchaos', 0.01))
const KILLS = Number(opt('--kills', 2))
const STEALS = Number(opt('--steals', 2))
const POOL = Math.max(1, Math.min(6, Number(opt('--pool', 5))))
const PARITY = flag('--parity') || flag('--parity-only')
const PARITY_ONLY = flag('--parity-only')
const OUT = opt('--out')
const PORT = Number(process.env.ENGINE_PARALLEL_PORT || 55531)
const PROFILE_PATH = opt('--profile', path.join(__dirname, 'fixtures/profile-20261113.json'))
const HEARTBEAT_MS = 61_237
const HEARTBEAT_REAL_MS = 15000

const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'))
const model = W.buildModel(profile)

const ORG = { desktop: 990101, fly: 990102 }
const MAIN_TYPES = {
  desktop: ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member'],
  fly: ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member', 'zalo_message_group']
}
const LANE_TYPES = ['zalo_cancel_sent_friend_request', 'zalo_join_group_link', 'zalo_add_group_member']
const MATERIALIZED_MARKERS = /^zalo(Birthday|CancelFriendRequest|Friend|FriendRecommendation)(Data)?Materialized/
const WAIT_LIKE = new Set(['busy', 'parallel_wait', 'legacy_busy', 'concurrency_limit'])
const CONTINUE = new Set(['end_unit', 'max_targets', 'stopped', 'cooldown_scan'])
const KNOWN_REASONS = new Set(['no_target', 'not_due', 'wait', 'end_unit', 'stop_account', 'stop_campaign', 'ownership_lost', 'cancelled', 'config_invalid',
  'max_targets', 'campaign_paused', 'campaign_not_runnable', 'busy', 'legacy_busy', 'not_enabled', 'not_found', 'account_mismatch', 'account_not_found',
  'invalid_request', 'app_access_denied', 'report_rejected', 'error', 'daily_boundary', 'runtime_not_owner', 'staff_time_blocked', 'account_logged_out',
  'stopped', 'maintenance_required', 'campaign_not_ready', 'data_group_hard_end', 'data_group_waiting', 'account_paused', 'entitlement_denied',
  'concurrency_limit', 'gate_unavailable', 'cooldown_scan', 'parallel_wait'])
const KNOWN_INVARIANTS = {
  I1b: 'E1: data trùng trong cùng lô chia sẻ, bộ cũ cũng vậy, chưa sửa',
  I11c: 'có từ 12/11 ở lõi, không do làn: share.ts ghép nguyên câu lỗi vào dòng ⚠️ khi không lấy được global ID để kiểm từ chối nhận tin, chưa sửa'
}
/** Dòng ⚠️ của share.ts (lõi, có từ 12/11) khi không lấy được global ID: kèm nguyên câu lỗi, tách khỏi I11b để không che lỗi mới. */
const KNOWN_GLOBAL_ID_WARNING = /Không lấy được Zalo global ID để kiểm tra từ chối nhận tin; vẫn tiếp tục xử lý target: /
/** Lý do của hàm kết thúc lượt khi nó đặt lại data cho lượt kế tiếp (data đã gửi quay lại "chờ xử lý" là đúng). */
const PASS_RESET_REASONS = new Set(['slot_advanced', 'repeat_scheduled', 'rerun_scheduled'])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-par-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

async function insertRows(db, table, rows) {
  if (!rows.length) return
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows
    .map(r => r.column_name)
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
  const list = keys.map(k => `"${k}"`).join(', ')
  await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`,
    [JSON.stringify(rows)])
}

/** Đồng hồ giả như run.cjs: nghỉ giữa data / backoff trả ngay; chờ heartbeat là chờ thật. */
function makeClock(heartbeatRealMs = HEARTBEAT_REAL_MS) {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms === HEARTBEAT_MS) {
        const onAbort = () => { clearTimeout(timer); resolve(false) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(true) }, heartbeatRealMs)
        signal?.addEventListener('abort', onAbort, { once: true })
        return
      }
      setImmediate(() => resolve(!signal?.aborted))
    })
  }
}

const transientDbError = (label = 'fetch failed') => Object.assign(new Error(label), { code: 'ECONNRESET' })

/** Cổng dữ liệu nối RPC thật, kèm tiêm lỗi (như run.cjs) và ghi lại lease token mà claim cấp cho lượt. */
function makeDataPort(rpc, faults, log) {
  const r = W.mulberry32(W.hash32(SEED, 'dbfaults', faults.tag || '', faults.stream || ''))
  const wrap = (name, fn) => async (...a) => {
    if (faults.dead?.()) throw transientDbError('process killed')
    const f = faults[name] ?? faults.all
    if (f?.before && r() < f.before) { log.db.push({ name, when: 'before' }); throw transientDbError() }
    const res = await fn(...a)
    if ((name === 'claimTarget' || name === 'claimBatch') && res?.leaseToken) faults.onLease?.(res.leaseToken)
    if (f?.after && r() < f.after) { log.db.push({ name, when: 'after' }); throw transientDbError() }
    return res
  }
  return {
    claimTarget: wrap('claimTarget', ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)])),
    claimBatch: wrap('claimBatch', ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)])),
    reportBatch: wrap('reportBatch', (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r',
      [tok, JSON.stringify(items), size, stopped])),
    markSending: wrap('markSending', (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step])),
    report: wrap('report', (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r',
      [id, tok, JSON.stringify(outcomes), final])),
    heartbeat: wrap('heartbeat', (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok])),
    release: wrap('release', (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok]))
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Thế giới: tài khoản có nhiều chiến dịch
// ---------------------------------------------------------------------------------------------------------------------------

function samplesOf(actionId, rt) {
  const same = profile.campaigns.filter(c => c.actionId === actionId && c.runtime === rt)
  return same.length ? same : profile.campaigns.filter(c => c.actionId === actionId)
}

/**
 * Kế hoạch tài khoản (không phụ thuộc chế độ chạy, để bản "solo" dựng đúng chiến dịch không tích như bản "mixed").
 * kind 'faults': đủ loại, kể cả thêm thành viên cạnh nhắn tin theo SĐT (chung Tìm SĐT), hai chiến dịch có tích cùng loại, chiến dịch
 * không tích cùng loại với chiến dịch có tích. kind 'parity': chỉ làn không dùng chung thao tác với chiến dịch thường của tài khoản.
 */
function planWorld(kind) {
  const rnd = W.mulberry32(W.hash32(SEED, 'parallel-plan', kind))
  const pick = list => list[Math.floor(rnd() * list.length)]
  const out = []
  for (let g = 1; g <= ACCOUNTS; g++) {
    const rt = g % 2 ? 'desktop' : 'fly'
    const plan = [{ actionId: pick(MAIN_TYPES[rt]), ticked: false }]
    if (rnd() < 0.5) plan.push({ actionId: pick(MAIN_TYPES[rt]), ticked: false })
    const mainUsesFind = plan.some(p => p.actionId === 'zalo_message_phone')
    for (const t of LANE_TYPES) {
      if (kind === 'parity' && t === 'zalo_add_group_member' && mainUsesFind) continue
      if (rnd() < 0.7) plan.push({ actionId: t, ticked: true })
    }
    if (!plan.some(p => p.ticked)) plan.push({ actionId: kind === 'parity' ? 'zalo_cancel_sent_friend_request' : pick(LANE_TYPES), ticked: true })
    if (kind === 'faults') {
      const lanes = [...new Set(plan.filter(p => p.ticked).map(p => p.actionId))]
      if (rnd() < 0.35) plan.push({ actionId: pick(lanes), ticked: true, extra: 'same_lane' })
      if (rnd() < 0.3) plan.push({ actionId: pick(lanes), ticked: false, extra: 'main_same_type' })
    }
    out.push({ g, rt, plan })
  }
  return out
}

async function createWorld(db, E, plans, mode) {
  await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org Desktop', false), ($2, 'Org Fly', true)
    ON CONFLICT (id) DO NOTHING`, [ORG.desktop, ORG.fly])
  const accounts = []
  for (const ap of plans) {
    const acct = { g: ap.g, rt: ap.rt, accountId: 995000 + ap.g, staffId: 991500 + ap.g, orgId: ORG[ap.rt], campaigns: [] }
    await insertRows(db, 'auto_accounts', [{ id: acct.accountId, name: `Zalo cùng lúc ${ap.g}`, flatform_type: 'zalo', login_status: 'đã đăng nhập',
      status: 'chờ xử lý', is_active: true, is_delete: false, staff_id: acct.staffId, organization_id: acct.orgId, is_zalo_server: ap.rt === 'fly',
      is_zalo_show_web: false }])
    for (const [k, p] of ap.plan.entries()) {
      if (mode === 'solo' && p.ticked) continue
      const r = W.mulberry32(W.hash32(SEED, 'campaign', ap.g, k))
      const list = samplesOf(p.actionId, ap.rt)
      const sample = list[Math.floor(r() * list.length)]
      const campaignId = 996000 + ap.g * 10 + k
      const entry = { sample, sampleId: sample.sampleId, rt: ap.rt, actionId: p.actionId, zaloWeb: false, staffId: acct.staffId, accountId: acct.accountId,
        campaignId, orgId: acct.orgId, name: `Cùng lúc ${ap.g}.${k} ${p.actionId}${p.ticked ? ' (có tích)' : ''}`, universeSize: 18, ticked: p.ticked,
        extraRole: p.extra ?? null, order: k }
      let extra = W.rekeyExtra(sample.extraSettings, entry.accountId)
      entry.materializing = E.zaloCampaignMaterializes({ actionId: p.actionId, extraSettings: extra })
      if (entry.materializing) extra = Object.fromEntries(Object.entries(extra).filter(([key]) => !MATERIALIZED_MARKERS.test(key)))
      entry.extra = extra
      entry.cfg = { id: campaignId, actionId: p.actionId, accountId: entry.accountId, content: sample.content ?? '', extraSettings: extra,
        images: Array.isArray(sample.images) ? sample.images : [], dataTargetSourceMode: sample.dataTargetSourceMode ?? null }
      entry.codes = new Set((E.zaloCampaignType(p.actionId).claimPlan(entry.cfg).actions || []).map(a => a.code))
      await insertRows(db, 'auto_campaigns', [{ id: campaignId, name: entry.name, action_id: p.actionId, account_id: entry.accountId, status: 'chờ xử lý',
        schedule: new Date(Date.now() - (120 - k) * 1000).toISOString(), is_delete: false, staff_id: entry.staffId, organization_id: entry.orgId,
        content: entry.cfg.content, images: entry.cfg.images, extra_settings: extra, data_target_source_mode: entry.cfg.dataTargetSourceMode,
        schedule_type: sample.scheduleType || 'daily', parallel_run_enabled: p.ticked }])
      if (entry.cfg.dataTargetSourceMode === 'data_group') {
        await db.query(`INSERT INTO public.auto_campaign_data_group_sources (campaign_id, staff_id, organization_id, status) VALUES ($1, $2, $3, 'active')`,
          [campaignId, entry.staffId, entry.orgId])
      }
      const rows = entry.materializing ? [] : W.buildTargets(sample, TARGETS, r)
      const inserted = rows.map((row, i) => ({ ...row, id: 997_000_000 + (ap.g * 10 + k) * 1000 + i + 1, campaign_id: campaignId, status: 'chờ xử lý', is_delete: false }))
      entry.targetIds = inserted.map(x => x.id)
      await insertRows(db, 'auto_campaign_input_data', inserted)
      acct.campaigns.push(entry)
    }
    accounts.push(acct)
  }
  return accounts
}

// ---------------------------------------------------------------------------------------------------------------------------
// Một lượt runUnit của một chiến dịch trên một làn
// ---------------------------------------------------------------------------------------------------------------------------

const CALL_METHODS = ['findUser', 'getUserProfile', 'sendText', 'sendMedia', 'sendFriendRequest', 'applyLabel', 'changeAlias', 'addGroupMember',
  'joinGroupByLink', 'undoFriendRequest', 'forwardMessage', 'getSentFriendRequests', 'getAllFriendsPage', 'friendTagConversations', 'getFriendRecommendations']

/** Mỗi lời gọi cổng Zalo mất vài chục ms (để hai làn thật sự chồng nhau) và được ghi lại thời điểm bắt đầu / kết thúc. */
function instrumentPort(sim, port, entry, unit) {
  for (const name of CALL_METHODS) {
    const orig = port[name]
    if (typeof orig !== 'function') continue
    port[name] = async (...a) => {
      const signal = a[0]?.signal
      const ms = 3 + Math.floor(W.unitRandom(SEED, 'latency', entry.campaignId, name, ++unit.calls) * 30)
      const rec = { accountId: entry.accountId, campaignId: entry.campaignId, lane: unit.lane, method: name, t0: performance.now(), t1: null, unitId: unit.id }
      sim.calls.push(rec)
      try {
        await new Promise(resolve => {
          if (signal?.aborted) return resolve()
          const timer = setTimeout(resolve, ms)
          signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve() }, { once: true })
        })
        return await orig(...a)
      } finally { rec.t1 = performance.now() }
    }
  }
}

function roundFaults(round) {
  if (DBCHAOS <= 0) return { tag: `r${round}` }
  return { report: { before: DBCHAOS, after: DBCHAOS }, markSending: { before: DBCHAOS, after: DBCHAOS }, heartbeat: { before: DBCHAOS },
    release: { before: DBCHAOS / 2, after: DBCHAOS / 2 }, reportBatch: { before: DBCHAOS, after: DBCHAOS }, claimTarget: { before: DBCHAOS },
    claimBatch: { before: DBCHAOS }, tag: `r${round}` }
}

async function runUnitOnce(sim, entry, lane, client, round) {
  const { E, log } = sim
  // App / worker đang "khởi động lại": chưa nhận lượt mới.
  while (sim.paused[entry.rt]) await sleep(5)
  const rpc = async (sql, params) => (await client.query(sql, params)).rows[0].r
  const n = (sim.unitCount.get(entry.campaignId) || 0) + 1
  sim.unitCount.set(entry.campaignId, n)
  const unit = { id: ++sim.unitSeq, rt: entry.rt, accountId: entry.accountId, campaignId: entry.campaignId, lane, dead: false, killed: false, stolen: null,
    ac: new AbortController(), leaseToken: null, tokens: [], calls: 0, round, t0: performance.now(), t1: null }
  let resolveDone
  unit.done = new Promise(resolve => { resolveDone = resolve })
  sim.inflight.add(unit)
  const faults = { ...roundFaults(round), stream: `${entry.campaignId}:${n}`, dead: () => unit.dead, onLease: tok => { unit.leaseToken = tok; if (!unit.tokens.includes(tok)) unit.tokens.push(tok) } }
  const data = makeDataPort(rpc, faults, log)
  const type = E.zaloCampaignType(entry.actionId)
  const query = async (sql, params) => (await client.query(sql, params)).rows
  const laneForce = sim.quietLanes && entry.ticked
  const port = makePort({ E, model, rt: entry.rt, seed: SEED, chaos: laneForce ? 0 : CHAOS, inject: laneForce ? 0 : INJECT, query, forceOk: laneForce,
    engineChaos: laneForce ? { exception: 0, hang: 0, nullMsgId: 0, ownDbError: 0 } : { exception: 0.003, hang: 0.002, nullMsgId: 0.03, ownDbError: 0.01 },
    entry, rpc, log })
  instrumentPort(sim, port, entry, unit)
  const random = W.mulberry32(W.hash32(SEED, 'random', entry.campaignId, n))
  const note = (await client.query(`SELECT note FROM public.auto_campaigns WHERE id = $1`, [entry.campaignId])).rows[0]?.note ?? null
  const cfg = entry.cfg
  const prepareTargets = type.prepareTargets?.(cfg, port, { campaignName: entry.name, campaignNote: note, readTimeoutMs: 3000, callTimeoutMs: 5000, random }) ?? null
  const batch = type.buildBatch?.(cfg, port, { sleepBetweenBatchesSeconds: 1, readTimeoutMs: 3000, mediaTimeoutMs: 4000, sendTimeoutMs: 4000,
    aiRewriteTimeoutMs: 1000, random }) ?? null
  const afterReport = type.afterReport?.(cfg, port, { targetLabel: type.targetLabel }) ?? null
  const events = {
    progress: l => { log.lines.push({ ...l, campaignId: entry.campaignId, rt: entry.rt }) },
    trace: t => { if (/failed|error|rejected|lost|refused/i.test(t.type)) log.traces.push({ campaignId: entry.campaignId, ...t }) }
  }
  const journal = entry.rt === 'desktop' ? journalOf(sim, entry, lane) : new E.MemoryJournal()
  const unitCfg = {
    runnerId: `${entry.rt}:parallel:e${sim.epoch[entry.rt]}`, runtimeTarget: entry.rt, staffId: entry.staffId, accountId: entry.accountId,
    campaignId: entry.campaignId, actionId: entry.actionId, campaignName: entry.name, accountName: `Zalo cùng lúc ${entry.accountId}`, campaignNote: note,
    targetLabel: type.targetLabel, actionName: code => type.actionNames[code] ?? code,
    ...type.claimPlan(cfg),
    buildSteps: target => type.buildSteps(cfg, port, { account: { id: entry.accountId, name: `Zalo cùng lúc ${entry.accountId}` }, mediaStepTimeoutMs: 4000,
      textStepTimeoutMs: 2500, aiRewriteTimeoutMs: 1000, random }),
    ...(type.validate ? { validateCampaign: () => type.validate(cfg, { zaloWeb: entry.zaloWeb }) } : {}),
    ...(prepareTargets ? { prepareTargets } : {}),
    ...(batch ? { batch } : {}),
    ...(afterReport ? { afterReport } : {}),
    onNoTarget: async info => {
      const finished = await rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [entry.accountId, info.leaseToken, info.note ?? null])
      if (PASS_RESET_REASONS.has(finished?.reason)) (log.passResets ??= {})[entry.campaignId] = new Date().toISOString()
      return finished
    },
    formatTime: iso => new Date(iso).toISOString(),
    pacing: { fullSeconds: 1 }, stepTimeoutMs: 2500, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 8000, backoffMs: [5, 10, 20] }, drainTimeoutMs: 2000
  }
  let result = null
  let thrown = null
  try {
    result = await E.runUnit({ data, journal, clock: makeClock(), events }, unitCfg, unit.ac.signal)
  } catch (error) { thrown = error } finally {
    sim.inflight.delete(unit)
    for (const c of sim.calls) if (c.unitId === unit.id && c.t1 === null) c.t1 = performance.now()
  }
  unit.t1 = performance.now()
  const rec = { seq: unit.id, campaignId: entry.campaignId, accountId: entry.accountId, lane, rt: entry.rt, actionId: entry.actionId, ticked: entry.ticked,
    reason: result?.reason ?? null, targets: result?.targets ?? 0, thrown: thrown ? String(thrown.stack || thrown).slice(0, 600) : null, round,
    killed: unit.killed, stolen: !!unit.stolen, detail: result?.detail ? JSON.stringify(result.detail).slice(0, 300) : null,
    t0: Math.round(unit.t0), t1: Math.round(unit.t1), tokens: unit.tokens.map(t => t.slice(0, 8)), released: result?.released ?? null }
  if (unit.stolen) {
    // Như S8 của run.cjs: lượt bị chiếm được làm xong data đã nhận trước lúc bị chiếm; không được nhận (và gửi cho) data mới sau đó.
    const runs = (await sim.checkClient.query(`SELECT id, (extract(epoch FROM started_at) * 1000)::float8 AS ms FROM public.auto_engine_target_runs
      WHERE account_id = $1 AND lease_token = ANY($2::uuid[])`, [entry.accountId, unit.tokens])).rows
    const stealMs = sim.perfOffset + unit.stolen.at
    const late = new Set(runs.filter(x => Number(x.ms) > stealMs + 2).map(x => Number(x.id)))
    rec.afterSteal = { lateRuns: late.size, lateSends: log.sends.filter(x => x.campaignId === entry.campaignId && late.has(Number(x.targetRunId))).length,
      sendsAfter: log.sends.filter(x => x.campaignId === entry.campaignId && x.at - sim.perfOffset > unit.stolen.at).length }
  }
  log.units.push(rec)
  if (result?.reason === 'parallel_wait') await recordParallelWait(sim, entry, lane, result)
  if (unit.stolen) {
    await fastForward(sim, entry.accountId, [unit.stolen.oldToken, unit.stolen.newToken], 'steal')
    sim.otherRunnerTokens.delete(unit.stolen.newToken)
  }
  resolveDone()
  return { result, thrown, unit, rec }
}

function journalOf(sim, entry, lane) {
  const key = `${entry.staffId}:${entry.accountId}${lane === 'main' ? '' : ':' + lane}`
  if (!sim.journals.has(key)) sim.journals.set(key, new sim.E.MemoryJournal())
  return sim.journals.get(key)
}

/** P9: claim nói phải chờ; hàm "Lý do đang chờ" có giải thích được không (cùng lúc đọc xem chiến dịch chặn còn lease không). */
async function recordParallelWait(sim, entry, lane, result) {
  const claim = result.detail?.claim ?? {}
  // Hỏi như Desktop (gửi mã thao tác lõi khai khi nhận lượt, zaloClaimActionCodes) và như nơi gọi không có lõi (không gửi mã), cùng một lần đọc.
  const codes = sim.E.zaloClaimActionCodes(entry.cfg)
  const row = (await sim.checkClient.query(`SELECT public.aka_agent_engine_parallel_wait_v1($1) AS plain, public.aka_agent_engine_parallel_wait_v1($1, $4::text[]) AS coded,
      EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = $2 AND l.campaign_id = $3 AND l.expires_at > now()) AS blocker_live`,
    [entry.campaignId, entry.accountId, claim.campaignId ?? null, codes])).rows[0]
  const same = r => r && Number(r.campaignId) === Number(claim.campaignId) && r.reason === claim.reason
    && JSON.stringify([...(r.actionCodes || [])].sort()) === JSON.stringify([...(claim.actionCodes || [])].sort())
  sim.waits.push({ campaignId: entry.campaignId, actionId: entry.actionId, accountId: entry.accountId, lane, blocker: claim.campaignId ?? null,
    reason: claim.reason ?? null, codes: claim.actionCodes ?? [], explained: same(row.coded) && same(row.plain), coded: row.coded, plain: row.plain,
    blockerLive: row.blocker_live })
}

/** Thời gian trôi (lease hết hạn quá 10 phút) cho các lease token này rồi chạy job đóng lượt bị bỏ dở như pg_cron. */
async function fastForward(sim, accountId, tokens, why) {
  const list = tokens.filter(Boolean)
  if (!list.length) return null
  const c = sim.opsClient
  await c.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '11 minutes', heartbeat_at = now() - interval '14 minutes'
    WHERE account_id = $1 AND lease_token = ANY($2::uuid[])`, [accountId, list])
  await c.query(`UPDATE public.auto_engine_target_runs SET started_at = started_at - interval '11 minutes'
    WHERE completed_at IS NULL AND account_id = $1 AND lease_token = ANY($2::uuid[])`, [accountId, list])
  // Job đóng lượt bị bỏ dở (pg_cron mỗi phút): PostgreSQL huỷ một bên khi khoá chéo với claim lấy lại lease cùng làn (thứ tự khoá có từ trước
  // V670: job lease → chiến dịch, claim chiến dịch → tài khoản → lease); pg_cron chạy lại phút sau, ở đây thử lại ngay, có đếm.
  let r = null
  for (let attempt = 0; ; attempt++) {
    try {
      r = (await c.query(`SELECT public.aka_agent_engine_close_stale_v1(1000) AS r`)).rows[0].r
      break
    } catch (error) {
      if (error?.code !== '40P01' || attempt >= 4) throw error
      sim.stats.jobDeadlocks = (sim.stats.jobDeadlocks || 0) + 1
      sim.log.events.push({ type: 'job_deadlock', why, accountId, t: Math.round(performance.now()) })
      await sleep(20)
    }
  }
  sim.log.events.push({ type: 'fast_forward', why, accountId, tokens: list.map(t => t.slice(0, 8)), closed: r, t: Math.round(performance.now()) })
  return r
}

/** Lease không còn lượt nào đang giữ (lượt kết thúc mà nhả lease lỗi): cho hết hạn như sau 3 phút, để làn chờ chạy tiếp. */
async function expireOrphanLeases(sim, accountId) {
  // Lease bị "bộ chạy khác" chiếm là của một máy đang chạy: không hết hạn sớm; chỉ hết hạn (fastForward) sau khi lượt bị chiếm dừng.
  const held = new Set([...[...sim.inflight].map(u => u.leaseToken), ...sim.otherRunnerTokens].filter(Boolean))
  const leases = (await sim.opsClient.query(`SELECT lane, lease_token::text AS t FROM public.auto_engine_leases WHERE account_id = $1 AND expires_at > now()`,
    [accountId])).rows.filter(l => !held.has(l.t))
  if (!leases.length) return 0
  await sim.opsClient.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 second' WHERE account_id = $1 AND lease_token = ANY($2::uuid[])`,
    [accountId, leases.map(l => l.t)])
  sim.log.events.push({ type: 'orphan_lease_expired', accountId, lanes: leases.map(l => l.lane), tokens: leases.map(l => l.t.slice(0, 8)),
    held: [...held].map(t => t.slice(0, 8)), t: Math.round(performance.now()) })
  return leases.length
}

// ---------------------------------------------------------------------------------------------------------------------------
// Bộ lập lịch giả: mỗi tài khoản một hàng đợi theo làn
// ---------------------------------------------------------------------------------------------------------------------------

const laneOf = (sim, e) => (e.ticked && sim.allowed.has(e.actionId) ? e.actionId : 'main')

async function runToRest(sim, e, lane, client, round) {
  let last = null
  for (let i = 0; i < 25; i++) {
    last = await runUnitOnce(sim, e, lane, client, round)
    if (last.unit.killed || !last.result || !CONTINUE.has(last.result.reason)) break
  }
  return last
}

async function laneWorker(sim, acct, lane, list, client, round) {
  const pending = [...list].sort((a, b) => a.order - b.order)
  const waits = new Map()
  let quiet = 0
  for (let pass = 0; pending.length && pass < 600; pass++) {
    while (sim.paused[acct.rt]) await sleep(5)
    let progressed = false
    for (let i = 0; i < pending.length; i++) {
      const e = pending[i]
      const last = await runToRest(sim, e, lane, client, round)
      if (last.unit.killed) break
      const reason = last.result?.reason ?? (last.thrown ? 'thrown' : null)
      if (WAIT_LIKE.has(reason)) {
        waits.set(e.campaignId, (waits.get(e.campaignId) || 0) + 1)
        sim.stats.waitUnits[reason] = (sim.stats.waitUnits[reason] || 0) + 1
        break
      }
      pending.splice(i, 1); i--; progressed = true
    }
    if (!pending.length) break
    if (progressed) { quiet = 0; continue }
    quiet++
    if (quiet % 20 === 0) await expireOrphanLeases(sim, acct.accountId)
    await sleep(10 + Math.floor(W.unitRandom(SEED, 'idle', acct.accountId, lane, pass) * 20))
  }
  if (!pending.length) return
  // P8: ảnh chụp lúc bỏ cuộc (lease của tài khoản, ai giữ, lượt còn mở) để biết chờ vì lease nào.
  const held = new Map([...sim.inflight].filter(u => u.leaseToken).map(u => [u.leaseToken, `lượt ${u.id} ${u.lane} ${u.campaignId}`]))
  for (const t of sim.otherRunnerTokens) held.set(t, 'bộ chạy khác')
  const leases = (await sim.checkClient.query(`SELECT lane, campaign_id, runner_id, lease_token::text AS t, round(extract(epoch FROM expires_at - now()))::int AS ttl
    FROM public.auto_engine_leases WHERE account_id = $1 ORDER BY lane`, [acct.accountId])).rows
    .map(l => ({ lane: l.lane, campaignId: Number(l.campaign_id), runner: l.runner_id, ttl: l.ttl, token: l.t.slice(0, 8), heldBy: held.get(l.t) ?? null }))
  const openRuns = (await sim.checkClient.query(`SELECT id, campaign_id, lease_token::text AS t FROM public.auto_engine_target_runs WHERE account_id = $1 AND completed_at IS NULL`,
    [acct.accountId])).rows.map(r => ({ id: Number(r.id), campaignId: Number(r.campaign_id), token: r.t.slice(0, 8) }))
  const lastUnits = sim.log.units.filter(u => u.accountId === acct.accountId).slice(-6)
    .map(u => ({ seq: u.seq, campaignId: u.campaignId, lane: u.lane, reason: u.reason, killed: u.killed, stolen: u.stolen, tokens: u.tokens, released: u.released }))
  const events = sim.log.events.filter(e => e.accountId === acct.accountId && ['kill', 'steal', 'fast_forward', 'orphan_lease_expired'].includes(e.type)).slice(-6)
  for (const e of pending) sim.starved.push({ round, campaignId: e.campaignId, accountId: acct.accountId, lane, waits: waits.get(e.campaignId) || 0,
    snapshot: { leases, openRuns, lastUnits, events } })
}

async function runAccount(sim, acct, clients, round) {
  const lanes = new Map()
  for (const e of acct.campaigns) {
    const lane = laneOf(sim, e)
    if (!lanes.has(lane)) lanes.set(lane, [])
    lanes.get(lane).push(e)
  }
  await Promise.all([...lanes].map(async ([lane, list]) => {
    const client = await clients.take()
    try { await laneWorker(sim, acct, lane, list, client, round) } finally { clients.give(client) }
  }))
}

function clientPool(list) {
  const free = [...list]
  const waiting = []
  return {
    take: () => free.length ? Promise.resolve(free.pop()) : new Promise(resolve => waiting.push(resolve)),
    give: c => { const w = waiting.shift(); if (w) w(c); else free.push(c) }
  }
}

async function pool(items, size, fn) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.max(1, size) }, async () => { for (let item; (item = queue.shift());) await fn(item) }))
}

/** App Desktop / worker Fly chết: mọi lượt đang chạy của nơi chạy đó dừng, rồi mở lại; sau đó "10 phút" trôi cho các lease của lượt chết. */
async function kill(sim, rt, round) {
  if (sim.paused[rt]) return
  sim.paused[rt] = true
  const victims = [...sim.inflight].filter(u => u.rt === rt)
  for (const u of victims) { u.dead = true; u.killed = true; u.ac.abort(new Error(rt === 'desktop' ? 'app quit' : 'worker restart')) }
  await Promise.allSettled(victims.map(u => u.done))
  sim.epoch[rt]++
  sim.log.events.push({ type: 'kill', rt, round, victims: victims.length, units: victims.map(u => u.id), t: Math.round(performance.now()) })
  sim.stats.kills++
  // Mở lại: Desktop gửi bù nhật ký theo làn khi lease cũ còn hạn; sau đó lease cũ hết hạn và job đóng lượt bị bỏ dở.
  sim.paused[rt] = false
  await sleep(200)
  const byAccount = new Map()
  for (const u of victims) if (u.leaseToken) byAccount.set(u.accountId, [...(byAccount.get(u.accountId) || []), u.leaseToken])
  for (const [accountId, tokens] of byAccount) await fastForward(sim, accountId, tokens, 'kill')
}

/** Bộ chạy khác chiếm lease của một làn đang chạy (lease hết hạn rồi máy khác nhận): lượt đang chạy phải dừng, không gửi thêm. */
async function steal(sim, round) {
  const candidates = [...sim.inflight].filter(u => u.leaseToken && !u.dead && !u.stolen && u.lane !== 'main')
  if (!candidates.length) return false
  const u = candidates[Math.floor(W.unitRandom(SEED, 'steal', round, sim.stats.steals, candidates.length) * candidates.length)]
  const row = (await sim.opsClient.query(`UPDATE public.auto_engine_leases SET lease_token = gen_random_uuid(), runner_id = 'other-runner', acquired_at = now(),
      heartbeat_at = now(), expires_at = now() + interval '3 minutes' WHERE account_id = $1 AND lease_token = $2 RETURNING lease_token::text AS t, lane`,
    [u.accountId, u.leaseToken])).rows[0]
  if (!row) return false
  u.stolen = { oldToken: u.leaseToken, newToken: row.t, at: performance.now() }
  sim.otherRunnerTokens.add(row.t)
  sim.stats.steals++
  sim.log.events.push({ type: 'steal', round, accountId: u.accountId, lane: row.lane, campaignId: u.campaignId, unit: u.id,
    oldToken: u.stolen.oldToken.slice(0, 8), newToken: row.t.slice(0, 8), t: Math.round(performance.now()) })
  // Lượt bị chiếm kết thúc trong lúc câu chiếm đang chạy (đã qua bước dọn ở cuối runUnitOnce): "bộ chạy khác" là giả, không tự chạy xong nên
  // dọn luôn ở đây như khi lượt bị chiếm dừng; không thì làn bị chặn tới hết hạn lease giả (P8 giả, seed 2).
  if (!sim.inflight.has(u)) {
    await fastForward(sim, u.accountId, [u.stolen.oldToken, row.t], 'steal_late')
    sim.otherRunnerTokens.delete(row.t)
  }
  return true
}

// ---------------------------------------------------------------------------------------------------------------------------
// Theo dõi bảng lease trong lúc chạy (P1–P3)
// ---------------------------------------------------------------------------------------------------------------------------

const MONITOR_SQL = `SELECT
  (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT account_id, action_id, array_agg(lane ORDER BY lane) AS lanes, array_agg(campaign_id ORDER BY lane) AS campaigns
     FROM public.auto_engine_leases WHERE expires_at > now() AND account_id = ANY($1::bigint[]) GROUP BY 1, 2 HAVING count(*) > 1) x) AS same_type,
  (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT a.account_id, a.lane AS lane_a, b.lane AS lane_b, a.campaign_id AS campaign_a, b.campaign_id AS campaign_b,
       ARRAY(SELECT unnest(a.action_codes) INTERSECT SELECT unnest(b.action_codes)) AS codes
     FROM public.auto_engine_leases a JOIN public.auto_engine_leases b ON b.account_id = a.account_id AND a.lane < b.lane
     WHERE a.expires_at > now() AND b.expires_at > now() AND a.account_id = ANY($1::bigint[])
       AND (a.action_id = b.action_id OR a.action_codes && b.action_codes)) x) AS shared,
  (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT tr.account_id, tr.id AS run_id, l.lane, l.campaign_id
     FROM public.auto_engine_target_runs tr
     JOIN public.auto_engine_leases l ON l.account_id = tr.account_id AND l.lease_token = tr.lease_token AND l.expires_at > now()
     JOIN public.auto_accounts a ON a.id = tr.account_id
     WHERE tr.completed_at IS NULL AND a.status = 'chờ xử lý' AND tr.account_id = ANY($1::bigint[])) x) AS idle_account,
  (SELECT coalesce(max(n), 0) FROM (SELECT count(*) AS n FROM public.auto_engine_leases WHERE expires_at > now() AND account_id = ANY($1::bigint[]) GROUP BY account_id) y) AS max_live`

async function monitor(sim, client, accountIds, stop) {
  while (!stop.done) {
    const r = (await client.query(MONITOR_SQL, [accountIds])).rows[0]
    sim.stats.samples++
    sim.stats.maxLiveLeases = Math.max(sim.stats.maxLiveLeases, Number(r.max_live))
    if (Number(r.max_live) > 1) sim.stats.samplesWithParallel++
    for (const [code, rows] of [['P1', r.same_type], ['P2', r.shared], ['P3', r.idle_account]]) {
      for (const row of rows) sim.monitorViolations.push({ code, at: Date.now(), ...row })
    }
    await sleep(25)
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Bất biến sau khi dọn (như run.cjs, thêm parallel_wait vào lý do đã biết)
// ---------------------------------------------------------------------------------------------------------------------------

async function invariants(db, log, campaigns) {
  const v = []
  const fail = (code, title, rows) => { if (rows.length) v.push({ code, title, count: rows.length, sample: rows.slice(0, 8) }) }
  const q = async (sql, params = []) => (await db.query(sql, params)).rows
  const campaignSet = new Set(campaigns)
  {
    const byKey = new Map()
    const uidMap = new Map((await q(`SELECT id, campaign_id, uid FROM public.auto_campaign_input_data WHERE campaign_id = ANY($1::bigint[])`, [campaigns]))
      .map(r => [`${r.campaign_id}|${String(r.uid ?? '').replace(/^g/, '')}`, Number(r.id)]))
    const IDEMPOTENT = new Set(['undo', 'join', 'label', 'alias'])
    for (const s of log.sends) {
      if (IDEMPOTENT.has(s.part)) continue
      const inputDataId = s.inputDataId || uidMap.get(`${s.campaignId}|${String(s.threadId ?? '').replace(/^g/, '')}`) || null
      const part = s.part === 'forward' ? 'text' : s.part
      const key = `${s.campaignId}|${inputDataId}|${part}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push({ ...s, inputDataId })
    }
    const dups = []
    const sameBatch = []
    for (const [key, list] of byKey) {
      const i = list.findIndex(s => s.possiblyDelivered)
      if (i < 0) continue
      const later = list.slice(i + 1)
      const fmt = s => `${s.targetRunId}#${s.callId}:${s.ok === true ? 'ok' : s.ok === false ? 'err:' + s.error : '?'}:${s.phase ?? ''}`
      if (later.some(s => s.callId !== list[i].callId)) dups.push({ key, calls: list.map(fmt) })
      else if (later.length) sameBatch.push({ key, calls: list.map(fmt) })
    }
    for (const d of dups.slice(0, 6)) {
      const id = Number(d.key.split('|')[1])
      d.runs = (await q(`SELECT id, lease_token, close_reason, final_target_status, final_error_code, marks FROM public.auto_engine_target_runs
        WHERE input_data_id = $1 ORDER BY id`, [id])).map(r => `${r.id}:${String(r.lease_token).slice(0, 8)}:${r.close_reason}:${r.final_target_status}:${r.final_error_code ?? '-'}`)
    }
    fail('I1', 'Gửi lại cho data đã có thể nhận (gửi trùng)', dups)
    fail('I1b', 'Cùng một người nhận / nhóm hai lần trong một lệnh chia sẻ (data trùng trong chiến dịch)', sameBatch)
  }
  fail('I2', 'Data còn "đang chạy" sau khi dọn', await q(`SELECT id, campaign_id, note FROM public.auto_campaign_input_data
    WHERE campaign_id = ANY($1::bigint[]) AND status = 'đang chạy'`, [campaigns]))
  fail('I2b', 'Lượt data chưa đóng sau khi dọn', await q(`SELECT id, input_data_id, close_reason FROM public.auto_engine_target_runs
    WHERE campaign_id = ANY($1::bigint[]) AND completed_at IS NULL`, [campaigns]))
  fail('I3', 'Lease còn sau khi dọn', await q(`SELECT account_id, lane, runner_id, expires_at FROM public.auto_engine_leases`))
  fail('I4', 'Dòng lịch sử có trạng thái sai', await q(`SELECT d.id, d.action_code, d.status, d.status_id FROM public.auto_campaign_details d
    LEFT JOIN public.auto_status s ON s.id = d.status_id WHERE d.campaign_id = ANY($1::bigint[]) AND (s.id IS NULL OR s.component_type <> 'campaign_detail'
    OR s.status_value IS DISTINCT FROM d.status)`, [campaigns]))
  fail('I4b', 'Câu lịch sử lộ mã nội bộ / chỗ trống mẫu', await q(`SELECT d.id, d.action_code, d.status, left(d.log, 160) AS log FROM public.auto_campaign_details d
    WHERE d.campaign_id = ANY($1::bigint[]) AND (coalesce(btrim(d.log), '') = '' OR d.log ~ '(\\[[ax]\\]|\\{(name|code|until|action|message)\\}|undefined|\\[object Object\\]|\\berr_[a-z_]+|\\bnull\\b)')`,
    [campaigns]))
  fail('I5', 'Kết quả lỗi không có mã công khai', await q(`SELECT o.result_key, o.action_code, o.error_code FROM public.auto_engine_outcomes o
    LEFT JOIN public.auto_error e ON e.error_code = o.error_code WHERE o.campaign_id = ANY($1::bigint[]) AND NOT o.ok AND (o.error_code IS NULL OR e.public_code IS NULL)`, [campaigns]))
  const passResets = Object.entries(log.passResets ?? {})
  fail('I7', 'Data đã gửi được / không rõ mà còn chờ chạy lại', await q(`SELECT i.id, i.status, i.note, array_agg(DISTINCT o.action_code || ':' || o.delivery_state) AS d
    FROM public.auto_campaign_input_data i JOIN public.auto_engine_outcomes o ON o.input_data_id = i.id
    WHERE i.campaign_id = ANY($1::bigint[]) AND i.status = 'chờ xử lý' AND o.delivery_state IN ('delivered', 'partial', 'unknown')
      AND o.created_at > coalesce((SELECT r.at FROM unnest($2::bigint[], $3::timestamptz[]) AS r(id, at) WHERE r.id = i.campaign_id), '-infinity')
    GROUP BY i.id, i.status, i.note`, [campaigns, passResets.map(([id]) => id), passResets.map(([, at]) => at)]))
  fail('I8', 'Chiến dịch / tài khoản kẹt "đang chạy" hoặc trạng thái lạ', await q(`SELECT 'campaign' k, id, status, note FROM public.auto_campaigns
    WHERE id = ANY($1::bigint[]) AND (status = 'đang chạy' OR status NOT IN ('chờ xử lý', 'tạm dừng', 'hoàn thành'))
    UNION ALL SELECT DISTINCT 'account', a.id, a.status, a.login_status FROM public.auto_accounts a JOIN public.auto_campaigns c ON c.account_id = a.id
    WHERE c.id = ANY($1::bigint[]) AND a.status = 'đang chạy'`, [campaigns]))
  fail('I9', 'runUnit ném ngoại lệ / lý do lạ', log.units.filter(u => u.thrown || !KNOWN_REASONS.has(u.reason)))
  fail('I9b', 'Lượt kết thúc vì lỗi (error / report_rejected)', log.units.filter(u => (u.reason === 'error' || u.reason === 'report_rejected') && !u.killed && !u.stolen))
  fail('I10', 'Vượt hạn mức trong ngày', await q(`SELECT DISTINCT s.account_id, s.action_code, s.count_action_in_day, (l.v->>'daily')::numeric AS daily
    FROM public.auto_account_action_status s JOIN public.auto_campaigns c ON c.account_id = s.account_id AND c.id = ANY($1::bigint[])
    CROSS JOIN LATERAL (SELECT public.aka_agent_engine_action_limit(c.id, s.account_id, s.action_code) AS v) l
    WHERE s.count_date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND s.count_action_in_day > (l.v->>'daily')::numeric
      -- Huỷ lời mời không giới hạn lượt (lõi: quota false; production: limit_check_action_codes rỗng), như I10b.
      AND s.action_code <> 'zalo_cancel_sent_friend_request'`, [campaigns]))
  fail('I10b', 'Vượt hạn mức khung giờ', await q(`WITH c AS (SELECT DISTINCT ON (account_id) id, account_id FROM public.auto_campaigns WHERE id = ANY($1::bigint[]))
    SELECT d.account_id, d.action_code, count(*) n, (l.v->>'windowCount')::numeric AS window_count
    FROM public.auto_campaign_details d JOIN c ON c.account_id = d.account_id
    CROSS JOIN LATERAL (SELECT public.aka_agent_engine_action_limit(c.id, d.account_id, d.action_code) AS v) l
    WHERE d.counts_toward_limit AND d.created_at > now() - make_interval(mins => (l.v->>'windowMinutes')::int)
      AND d.action_code NOT IN ('zalo_find_phone_user', 'zalo_cancel_sent_friend_request')
    GROUP BY d.account_id, d.action_code, l.v HAVING count(*) > (l.v->>'windowCount')::numeric`, [campaigns]))
  const publicCodes = new Set((await q(`SELECT DISTINCT public_code FROM public.auto_error WHERE public_code IS NOT NULL`)).map(r => r.public_code))
  fail('I11', 'Tiến trình có mã không có trong danh mục', log.lines.filter(l => campaignSet.has(l.campaignId) && l.code && !publicCodes.has(l.code))
    .map(l => ({ campaignId: l.campaignId, code: l.code, text: l.text.slice(0, 140) })))
  const technical = log.lines.filter(l => campaignSet.has(l.campaignId)
    && /undefined|\[object Object\]|\berr_[a-z_]+|\bnull\b|TypeError|stack|\{(?:name|code|until|action|message)\}|\[[ax]\]/.test(l.text))
  fail('I11b', 'Tiến trình lộ chữ kỹ thuật', technical.filter(l => !KNOWN_GLOBAL_ID_WARNING.test(l.text))
    .map(l => ({ campaignId: l.campaignId, text: l.text.slice(0, 160) })))
  fail('I11c', 'Tiến trình lộ câu lỗi gốc khi không lấy được global ID (share.ts)', technical.filter(l => KNOWN_GLOBAL_ID_WARNING.test(l.text))
    .map(l => ({ campaignId: l.campaignId, text: l.text.slice(0, 160) })))
  const reg = log.events.filter(e => e.type === 'engagement_register' && campaignSet.has(e.campaignId))
  const regRows = reg.length ? await q(`SELECT id, action_code, status FROM public.auto_campaign_details WHERE id = ANY($1::bigint[])`, [reg.map(e => e.detailId)]) : []
  fail('I12', 'Đăng ký tương tác cho dòng không phải gửi thành công', reg.filter(e => {
    const row = regRows.find(r => Number(r.id) === Number(e.detailId))
    return !row || row.status !== 'thành công' || !['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend'].includes(row.action_code)
  }))
  fail('I14', 'Gửi nội dung lỗi (tên gợi nhớ > 50, chữ rỗng, mẫu chưa thay)', log.events.filter(e => campaignSet.has(e.campaignId)
    && ['alias_too_long', 'empty_text_sent', 'unrendered_template_sent', 'friend_message_too_long', 'media_without_files'].includes(e.type)))
  fail('I15', 'Data hoàn thành thành công nhưng còn ghi chú lỗi cũ', await q(`SELECT i.id, i.status, left(i.note, 100) AS note FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = ANY($1::bigint[]) AND i.status = 'hoàn thành' AND i.note IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = i.id AND tr.close_reason = 'reported' AND tr.final_error_code IS NULL
                   AND tr.id = (SELECT max(x.id) FROM public.auto_engine_target_runs x WHERE x.input_data_id = i.id))`, [campaigns]))
  return v
}

/** P4 / P5: lần gọi Zalo chồng nhau thời gian giữa hai chiến dịch của cùng tài khoản. */
function callOverlaps(sim, entries) {
  const byId = new Map(entries.map(e => [e.campaignId, e]))
  const conflict = (a, b) => a.actionId === b.actionId || [...a.codes].some(c => b.codes.has(c))
  const byAccount = new Map()
  for (const c of sim.calls) {
    if (c.t1 === null) continue
    if (!byAccount.has(c.accountId)) byAccount.set(c.accountId, [])
    byAccount.get(c.accountId).push(c)
  }
  const bad = []
  let parallelPairs = 0
  const parallelAccounts = new Set()
  const pairKinds = {}
  for (const [accountId, list] of byAccount) {
    list.sort((x, y) => x.t0 - y.t0)
    const active = []
    for (const c of list) {
      for (let i = active.length - 1; i >= 0; i--) if (active[i].t1 <= c.t0) active.splice(i, 1)
      for (const o of active) {
        if (o.campaignId === c.campaignId) continue
        const a = byId.get(o.campaignId)
        const b = byId.get(c.campaignId)
        if (!a || !b) continue
        if (conflict(a, b)) {
          if (bad.length < 40) bad.push({ accountId, a: `${a.campaignId}:${a.actionId}:${o.lane}:${o.method}`, b: `${b.campaignId}:${b.actionId}:${c.lane}:${c.method}`,
            overlapMs: Math.round(Math.min(o.t1, c.t1) - c.t0), units: [o.unitId, c.unitId], at: Math.round(c.t0) })
          else bad.push(null)
        } else {
          parallelPairs++
          parallelAccounts.add(accountId)
          const k = [a.actionId, b.actionId].sort().join(' + ')
          pairKinds[k] = (pairKinds[k] || 0) + 1
        }
      }
      active.push(c)
    }
  }
  return { bad: bad.filter(Boolean), badCount: bad.length, parallelPairs, parallelAccounts: parallelAccounts.size, pairKinds }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Một lần chạy trọn (một cụm PG mới)
// ---------------------------------------------------------------------------------------------------------------------------

async function simulate(E, { kind, mode, port, kills, steals, toggle, quietLanes }) {
  const { connect, stop } = startCluster({ port, label: 'aka-engine-par-', timeoutMs: 3 * 3600 * 1000 })
  const db = await connect()
  const clients = []
  const notes = []
  const sim = { E, log: { sends: [], events: [], lines: [], traces: [], units: [], db: [] }, calls: [], inflight: new Set(), paused: { desktop: false, fly: false },
    epoch: { desktop: 0, fly: 0 }, journals: new Map(), otherRunnerTokens: new Set(), perfOffset: Date.now() - performance.now(), unitCount: new Map(), unitSeq: 0, allowed: new Set(), waits: [], starved: [], monitorViolations: [],
    quietLanes, stats: { kills: 0, steals: 0, samples: 0, samplesWithParallel: 0, maxLiveLeases: 0, waitUnits: {} } }
  const t0 = Date.now()
  try {
    await bootstrap(db, notes)
    for (let i = 0; i < POOL * 4 + 3; i++) clients.push(await connect())
    sim.checkClient = clients.pop()
    sim.opsClient = clients.pop()
    sim.monitorClient = clients.pop()
    const monitorClient = sim.monitorClient
    const accounts = await createWorld(db, E, planWorld(kind), mode)
    const entries = accounts.flatMap(a => a.campaigns)
    const shape = { accounts: accounts.length, lanes: 0, addMemberWithPhoneMain: 0, sameLane: 0, mainSameType: 0 }
    for (const a of accounts) {
      const ticked = a.campaigns.filter(e => e.ticked)
      shape.lanes += new Set(ticked.map(e => e.actionId)).size
      if (ticked.some(e => e.actionId === 'zalo_add_group_member') && a.campaigns.some(e => !e.ticked && e.actionId === 'zalo_message_phone')) shape.addMemberWithPhoneMain++
      if (a.campaigns.some(e => e.extraRole === 'same_lane')) shape.sameLane++
      if (a.campaigns.some(e => e.extraRole === 'main_same_type')) shape.mainSameType++
    }
    console.log(`  [${kind}/${mode}] ${entries.length} chiến dịch / ${JSON.stringify(shape)}`)
    const accountIds = accounts.map(a => a.accountId)
    const lanePool = clientPool(clients)
    const rounds = []
    for (let round = 1; round <= ROUNDS; round++) {
      sim.allowed = new Set((await db.query(`SELECT id FROM public.auto_campaign_actions WHERE allow_parallel_run`)).rows.map(r => r.id))
      const stopMonitor = { done: false }
      const mon = monitor(sim, monitorClient, accountIds, stopMonitor)
      const r0 = Date.now()
      const chaosTasks = []
      for (let i = 0; i < kills; i++) {
        chaosTasks.push(sleep(250 + Math.floor(W.unitRandom(SEED, 'kill', round, i) * 2500)).then(() => kill(sim, (round + i) % 2 ? 'desktop' : 'fly', round)))
      }
      for (let i = 0; i < steals; i++) {
        chaosTasks.push(sleep(150 + Math.floor(W.unitRandom(SEED, 'stealat', round, i) * 2500)).then(() => steal(sim, round)))
      }
      let toggled = false
      if (toggle && round === 2) {
        chaosTasks.push(sleep(400).then(async () => {
          await sim.opsClient.query(`UPDATE public.auto_campaign_actions SET allow_parallel_run = false WHERE id = 'zalo_join_group_link'`)
          toggled = true
          sim.log.events.push({ type: 'toggle_off', round, actionId: 'zalo_join_group_link' })
        }))
      }
      await pool(accounts, POOL, acct => runAccount(sim, acct, lanePool, round))
      await Promise.allSettled(chaosTasks)
      stopMonitor.done = true
      await mon
      if (toggled) await sim.opsClient.query(`UPDATE public.auto_campaign_actions SET allow_parallel_run = true WHERE id = 'zalo_join_group_link'`)
      // Người dùng giữa hai vòng (như run.cjs), rồi thời gian trôi 70 phút.
      const acted = { resumed: 0, relogged: 0 }
      for (const e of entries) {
        const c = (await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [e.campaignId])).rows[0]
        if (c?.status === 'tạm dừng' && W.unitRandom(SEED, 'resume', e.campaignId, round) < 0.5) {
          await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL WHERE id = $1 AND status = 'tạm dừng'`, [e.campaignId]); acted.resumed++
        }
      }
      for (const a of accounts) {
        const row = (await db.query(`SELECT status, login_status FROM public.auto_accounts WHERE id = $1`, [a.accountId])).rows[0]
        if ((row?.login_status !== 'đã đăng nhập' || row?.status === 'tạm dừng') && W.unitRandom(SEED, 'relogin', a.accountId, round) < 0.5) {
          await db.query(`UPDATE public.auto_accounts SET login_status = 'đã đăng nhập', status = 'chờ xử lý' WHERE id = $1`, [a.accountId]); acted.relogged++
        }
      }
      await db.query(`UPDATE public.auto_campaign_details SET created_at = created_at - interval '70 minutes' WHERE campaign_id = ANY($1::bigint[])`,
        [entries.map(e => e.campaignId)])
      await db.query(`UPDATE public.auto_engine_target_runs SET marks = (SELECT coalesce(jsonb_agg(m.value || jsonb_build_object('markedAt',
        ((m.value->>'markedAt')::timestamptz - interval '70 minutes')::text)), '[]'::jsonb) FROM jsonb_array_elements(marks) m)
        WHERE campaign_id = ANY($1::bigint[]) AND completed_at IS NULL`, [entries.map(e => e.campaignId)])
      await db.query(`SELECT public.aka_agent_scenario_time_passes($1::bigint[])`, [accountIds])
      const reasons = {}
      for (const u of sim.log.units.filter(u => u.round === round)) reasons[u.reason] = (reasons[u.reason] || 0) + 1
      rounds.push({ round, ms: Date.now() - r0, reasons, acted })
      console.log(`  [${kind}/${mode}] vòng ${round}: ${Math.round((Date.now() - r0) / 1000)} giây; ${JSON.stringify(reasons)}`)
    }
    // Dọn như pg_cron sau 10 phút cho mọi lease còn lại.
    await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '11 minutes', heartbeat_at = now() - interval '14 minutes'`)
    await db.query(`UPDATE public.auto_engine_target_runs SET started_at = started_at - interval '11 minutes' WHERE completed_at IS NULL`)
    const finalClose = (await db.query(`SELECT public.aka_agent_engine_close_stale_v1(1000) AS r`)).rows[0].r
    const campaigns = entries.map(e => e.campaignId)
    const inv = await invariants(db, sim.log, campaigns)
    const overlaps = callOverlaps(sim, entries)
    const signatures = await campaignSignatures(db, sim, entries)
    const laneEffects = (await db.query(`SELECT DISTINCT o.account_id FROM public.auto_engine_outcomes o JOIN public.auto_campaigns c ON c.id = o.campaign_id
      WHERE c.parallel_run_enabled AND (coalesce(o.decision->'contrib'->>'accountEffect', 'none') <> 'none'
        OR coalesce(o.decision->'contrib'->>'loginEffect', 'none') <> 'none' OR o.decision->'contrib'->>'lockUntil' IS NOT NULL)`)).rows.map(r => Number(r.account_id))
    const coverage = (await db.query(`SELECT c.action_id, c.parallel_run_enabled AS ticked, i.status, count(*)::int AS n FROM public.auto_campaign_input_data i
      JOIN public.auto_campaigns c ON c.id = i.campaign_id WHERE c.id = ANY($1::bigint[]) GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [campaigns])).rows
    return { kind, mode, ms: Date.now() - t0, notes, rounds, accounts, entries, invariants: inv, overlaps, signatures, laneEffects, finalClose, coverage,
      monitorViolations: sim.monitorViolations, waits: sim.waits, starved: sim.starved, stats: sim.stats, units: sim.log.units.length,
      sends: sim.log.sends.length, events: sim.log.events.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {}),
      unitRecords: sim.log.units, eventList: sim.log.events.filter(e => ['kill', 'steal', 'fast_forward', 'orphan_lease_expired', 'toggle_off'].includes(e.type)) }
  } finally {
    for (const c of clients) await c.end().catch(() => {})
    for (const c of [sim.checkClient, sim.opsClient, sim.monitorClient]) if (c) await c.end().catch(() => {})
    await db.end().catch(() => {})
    stop()
  }
}

/** Kết quả của từng chiến dịch không tích (P6): data, lịch sử, trạng thái chiến dịch, chuỗi lần gửi. */
async function campaignSignatures(db, sim, entries) {
  // Data lấy đầu lượt (bạn bè, lời mời đã gửi…) có mã do DB cấp theo thứ tự chung, nên hai bản chạy khác mã: so theo người nhận (SĐT / UID).
  const out = {}
  for (const e of entries) {
    if (e.ticked) continue
    const rows = (await db.query(`SELECT id, coalesce(nullif(phone, ''), nullif(uid, ''), name, id::text) AS who, status, left(coalesce(note, ''), 90) AS note
      FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY 2, id`, [e.campaignId])).rows
    const who = new Map(rows.map(r => [Number(r.id), r.who]))
    // Giờ trong ghi chú (khoá tới HH:MM DD/MM) theo đồng hồ lúc chạy: hai bản chạy cách nhau vài phút nên bỏ khỏi phép so.
    const clock = text => String(text ?? '').replace(/\d{1,2}:\d{2}( \d{1,2}\/\d{1,2})?/g, '<giờ>')
    const data = rows.map(r => `${r.who}|${r.status}|${clock(r.note)}`)
    const details = (await db.query(`SELECT input_data_id, action_code, status, coalesce(error_code, '') AS error_code FROM public.auto_campaign_details
      WHERE campaign_id = $1`, [e.campaignId])).rows.map(r => `${who.get(Number(r.input_data_id)) ?? '?'}|${r.action_code}|${r.status}|${r.error_code}`).sort()
    const camp = (await db.query(`SELECT status, left(coalesce(note, ''), 90) AS note FROM public.auto_campaigns WHERE id = $1`, [e.campaignId])).rows[0]
    const sends = sim.log.sends.filter(s => s.campaignId === e.campaignId)
      .map(s => `${s.ident ?? s.threadId ?? who.get(Number(s.inputDataId)) ?? '?'}|${s.part}|${s.ok}|${s.error ?? ''}`)
    out[e.campaignId] = { accountId: e.accountId, actionId: e.actionId, data, details, campaign: `${camp.status}|${clock(camp.note)}`, sends }
  }
  return out
}

function compareParity(mixed, solo) {
  const excluded = new Set(mixed.laneEffects)
  const diffs = []
  let compared = 0
  for (const [id, m] of Object.entries(mixed.signatures)) {
    if (excluded.has(m.accountId)) continue
    const s = solo.signatures[id]
    if (!s) { diffs.push({ campaignId: id, problem: 'không có trong bản solo' }); continue }
    compared++
    for (const key of ['campaign', 'data', 'details', 'sends']) {
      const a = JSON.stringify(m[key])
      const b = JSON.stringify(s[key])
      if (a !== b) {
        const am = Array.isArray(m[key]) ? m[key] : [m[key]]
        const bm = Array.isArray(s[key]) ? s[key] : [s[key]]
        diffs.push({ campaignId: id, actionId: m.actionId, key, onlyMixed: am.filter(x => !bm.includes(x)).slice(0, 4), onlySolo: bm.filter(x => !am.includes(x)).slice(0, 4) })
      }
    }
  }
  return { compared, excludedAccounts: [...excluded], diffs }
}

function printRun(r) {
  console.log(`\n== Kết quả [${r.kind}/${r.mode}] ${Math.round(r.ms / 1000)} giây: ${r.units} lượt, ${r.sends} lần gửi; sự kiện ${JSON.stringify(r.events)}`)
  console.log(`  theo dõi lease: ${r.stats.samples} lần đọc; có ≥2 lease cùng lúc trên một tài khoản ở ${r.stats.samplesWithParallel} lần; nhiều nhất ${r.stats.maxLiveLeases} lease / tài khoản`)
  console.log(`  lượt phải chờ: ${JSON.stringify(r.stats.waitUnits)}${r.stats.jobDeadlocks ? `; job đóng lượt bị huỷ vì khoá chéo rồi chạy lại: ${r.stats.jobDeadlocks} lần` : ''}`)
  const waitKinds = {}
  for (const w of r.waits) { const k = `${w.actionId} ← ${w.reason}${w.codes?.length ? ':' + w.codes.join('+') : ''}`; waitKinds[k] = (waitKinds[k] || 0) + 1 }
  console.log(`  parallel_wait theo loại: ${JSON.stringify(waitKinds)}`)
  console.log(`  P5 lần gọi chồng nhau của hai làn không xung đột: ${r.overlaps.parallelPairs} cặp ở ${r.overlaps.parallelAccounts} tài khoản ${JSON.stringify(r.overlaps.pairKinds)}`)
}

function violationsOf(r) {
  const out = []
  const byCode = {}
  for (const v of r.monitorViolations) (byCode[v.code] ||= []).push(v)
  const titles = { P1: 'Hai lease còn hạn cùng loại trên một tài khoản', P2: 'Hai làn còn hạn dùng chung thao tác trên một tài khoản',
    P3: 'Tài khoản "chờ xử lý" khi một làn còn lease và data đang chạy' }
  for (const [code, rows] of Object.entries(byCode)) out.push({ code, title: titles[code], count: rows.length, sample: rows.slice(0, 4) })
  if (r.overlaps.badCount) out.push({ code: 'P4', title: 'Lần gọi Zalo chồng nhau của hai chiến dịch cùng loại / chung thao tác', count: r.overlaps.badCount, sample: r.overlaps.bad.slice(0, 4) })
  const stolenNew = r.unitRecords.filter(u => u.afterSteal?.lateRuns > 0 || u.afterSteal?.lateSends > 0)
  if (stolenNew.length) out.push({ code: 'P10', title: 'Lượt bị chiếm lease vẫn nhận / gửi data mới sau khi mất quyền', count: stolenNew.length, sample: stolenNew.slice(0, 4) })
  if (r.starved.length) {
    out.push({ code: 'P8', title: 'Chiến dịch còn phải chờ khi vòng kết thúc', count: r.starved.length, sample: r.starved.slice(0, 6).map(({ snapshot, ...x }) => x) })
    console.log(`      P8 ảnh chụp lúc bỏ cuộc: ${JSON.stringify(r.starved[0].snapshot).slice(0, 2500)}`)
  }
  const unexplained = r.waits.filter(w => !w.explained && w.blockerLive)
  if (unexplained.length) {
    const kinds = {}
    for (const w of unexplained) { const k = `${w.actionId} ← ${w.reason}:${(w.codes || []).join('+')}`; kinds[k] = (kinds[k] || 0) + 1 }
    out.push({ code: 'P9', title: 'Claim trả parallel_wait mà "Lý do đang chờ" (có / không gửi mã thao tác) không ra đúng chiến dịch chặn, lý do, thao tác (chiến dịch chặn còn lease)', count: unexplained.length, kinds,
      sample: unexplained.slice(0, 3) })
  }
  for (const v of r.invariants) out.push(v)
  return out
}

async function main() {
  const E = await loadEngine()
  const report = { seed: SEED, options: { ACCOUNTS, TARGETS, ROUNDS, CHAOS, INJECT, DBCHAOS, KILLS, STEALS, POOL }, runs: [] }
  let newViolations = 0
  if (!PARITY_ONLY) {
    console.log('== Chạy cùng lúc có sự cố (app chết, bộ chạy khác chiếm làn, akaBiz tắt loại giữa vòng)')
    const r = await simulate(E, { kind: 'faults', mode: 'mixed', port: PORT, kills: KILLS, steals: STEALS, toggle: true, quietLanes: false })
    printRun(r)
    const v = violationsOf(r)
    for (const x of v) {
      const known = KNOWN_INVARIANTS[x.code]
      console.log(`  ${known ? '- đã biết' : '✗'} ${x.code} ${x.title}: ${x.count}${known ? ` (${known})` : ''}${x.kinds ? ' ' + JSON.stringify(x.kinds) : ''}\n      ${JSON.stringify(x.sample.slice(0, 3)).slice(0, 900)}`)
      if (!known) newViolations++
    }
    if (!v.length) console.log('  ✓ không vi phạm bất biến nào')
    const p4 = r.overlaps.bad
    const p4Accounts = new Set(p4.map(x => x.accountId))
    r.debug = { p4Units: r.unitRecords.filter(u => p4Accounts.has(u.accountId)), p4Events: r.eventList.filter(e => p4Accounts.has(e.accountId) || e.type === 'kill') }
    report.runs.push({ ...r, unitRecords: undefined, eventList: undefined, entries: undefined, accounts: r.accounts.map(a => ({ accountId: a.accountId, rt: a.rt, campaigns: a.campaigns.map(e => `${e.campaignId}:${e.actionId}${e.ticked ? ':tích' : ''}${e.extraRole ? ':' + e.extraRole : ''}`) })),
      violations: v, signatures: undefined })
  }
  if (PARITY) {
    console.log('\n== Đối chiếu chiến dịch không tích: tài khoản có chiến dịch có tích (mixed) với tài khoản không có (solo)')
    const mixed = await simulate(E, { kind: 'parity', mode: 'mixed', port: PORT + 1, kills: 0, steals: 0, toggle: false, quietLanes: true })
    printRun(mixed)
    const solo = await simulate(E, { kind: 'parity', mode: 'solo', port: PORT + 2, kills: 0, steals: 0, toggle: false, quietLanes: true })
    printRun(solo)
    const cmp = compareParity(mixed, solo)
    console.log(`  P6: so ${cmp.compared} chiến dịch không tích; bỏ ${cmp.excludedAccounts.length} tài khoản có làn tác động cả tài khoản; khác ${cmp.diffs.length}`)
    for (const d of cmp.diffs.slice(0, 8)) console.log(`    ✗ ${JSON.stringify(d).slice(0, 500)}`)
    for (const [name, r] of [['mixed', mixed], ['solo', solo]]) {
      const v = violationsOf(r)
      for (const x of v) {
        const known = KNOWN_INVARIANTS[x.code]
        console.log(`  [${name}] ${known ? '- đã biết' : '✗'} ${x.code} ${x.title}: ${x.count}${x.kinds ? ' ' + JSON.stringify(x.kinds) : ''}\n      ${JSON.stringify(x.sample.slice(0, 2)).slice(0, 600)}`)
        if (!known) newViolations++
      }
    }
    if (cmp.diffs.length) newViolations++
    report.parity = { compared: cmp.compared, excludedAccounts: cmp.excludedAccounts, diffs: cmp.diffs }
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  console.log(`\nXong: vi phạm mới ${newViolations}`)
  process.exitCode = newViolations ? 1 : 0
}

main().catch(error => { console.error(error); process.exit(1) })
