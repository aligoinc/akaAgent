// Phát lại lịch sử thật bằng engine v2 trên PostgreSQL 17 cục bộ.
// Dữ liệu: file chép bằng export-snapshot.cjs (chỉ đọc từ production). Không chạm DB thật, không gọi Zalo.
//
//   node scripts/engine-v2-realdata/replay.cjs <snapshot.json> [--types a,b] [--out report.json] [--limit N]
//
// Mỗi data chạy lại bằng lõi mới; cổng Zalo giả trả đúng kết quả Zalo đã trả trong lịch sử (data.zalo, data.target,
// data.response). Kết quả là bảng chuyển đổi: kết quả bộ cũ → kết quả bộ mới (thao tác, trạng thái, mã lỗi, tính hạn mức)
// kèm số lượng, cùng trạng thái cuối của data. Cặp khác nhau phải nằm trong các quyết định đã duyệt (Q1–Q8).
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('../build-v499-sql.cjs')
const v501 = require('../build-v501-sql.cjs')
const v503 = require('../build-v503-sql.cjs')
const v504 = require('../build-v504-sql.cjs')
const v505 = require('../build-v505-sql.cjs')
const v506 = require('../build-v506-sql.cjs')
const v507 = require('../build-v507-sql.cjs')
const v508 = require('../build-v508-sql.cjs')
const v509 = require('../build-v509-sql.cjs')
const v512 = require('../build-v512-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const types = require('./replay-types.cjs')

const args = process.argv.slice(2)
const snapshotPath = args[0]
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
if (!snapshotPath) { console.error('Dùng: node replay.cjs <snapshot.json> [--types a,b] [--out report.json] [--limit N]'); process.exit(2) }
const onlyTypes = opt('--types') ? new Set(opt('--types').split(',')) : null
const limit = Number(opt('--limit') || 0)
const only = opt('--only') ? new Set(opt('--only').split(',').map(Number)) : null
const outPath = opt('--out')
const PORT = Number(process.env.ENGINE_REPLAY_PORT || 55512)

async function loadEngine() {
  const out = fs.mkdtempSync(path.join((fs.mkdirSync(path.join(ROOT, 'node_modules', '.cache'), { recursive: true }), path.join(ROOT, 'node_modules', '.cache')), 'aka-engine-replay-')) // trong repo: lõi import htmlparser2 từ node_modules
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

/** Đồng hồ không nghỉ thật: phát lại nhanh, vẫn ghi lại các lần nghỉ để so nhịp. */
function fastClock(heartbeatMs) {
  const sleeps = []
  return {
    sleeps,
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms !== heartbeatMs) { sleeps.push(ms); return setImmediate(() => resolve(!signal?.aborted)) }
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
  }
}

const object = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const uidKey = uid => String(uid ?? '').trim().replace(/\/+$/g, '').toLowerCase()
/** UID group của lệnh chia sẻ có thể mang tiền tố g (bỏ khi so). */
const threadKey = id => uidKey(id).replace(/^g(?=\d+$)/, '')

/**
 * Chiến dịch lấy data đầu lượt (huỷ lời mời, sinh nhật, đề xuất, bạn bè "toàn bộ / theo tag"): nạp KHÔNG kèm data và bỏ dấu "đã lấy",
 * để bộ mới tự đọc danh sách từ Zalo giả (dựng bằng data bộ cũ đã lấy) rồi thêm data, như lần đầu chạy. So kết quả theo UID.
 */
const MATERIALIZED_MARKER_BY_ACTION = { zalo_cancel_sent_friend_request: 'zaloCancelFriendRequestDataMaterializedAt',
  zalo_message_birthday: 'zaloBirthdayDataMaterializedDate', zalo_message_friend_recommendation: 'zaloFriendRecommendationDataMaterializedAt',
  zalo_message_friend: 'zaloFriendDataMaterializedAt' }
function freshCampaignIds(E, snap) {
  // Chỉ chiến dịch mà data bộ cũ thật sự do bước lấy data tạo ra: có dấu "đã lấy", hoặc mọi data đã bị xoá mềm (bảo trì đầu ngày của bộ
  // cũ xoá data sinh nhật và dấu ngày cũ). Data nhập tay thì chạy như data sẵn có.
  return new Set(snap.campaigns.filter(c => {
    const extra = object(c.extra_settings)
    if (!E.zaloCampaignMaterializes({ actionId: c.action_id, extraSettings: extra })) return false
    const rows = snap.inputData.filter(i => Number(i.campaign_id) === Number(c.id))
    return Boolean(extra[MATERIALIZED_MARKER_BY_ACTION[c.action_id]]) || (rows.length > 0 && rows.every(i => i.is_delete === true))
  }).map(c => Number(c.id)))
}
const MATERIALIZED_MARKERS = /^zalo(Birthday|CancelFriendRequest|Friend|FriendRecommendation)(Data)?Materialized/

async function loadData(db, snap, fresh = new Set()) {
  const insert = async (table, rows, override = {}) => {
    if (!rows.length) return
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows
      .map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)).concat(Object.keys(override)))].filter(k => cols.includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    const payload = rows.map(r => ({ ...r, ...override }))
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`,
      [JSON.stringify(payload)])
  }
  const serverOrgs = new Set(snap.accounts.filter(a => a.is_zalo_server).map(a => Number(a.organization_id)))
  await insert('org_organization', snap.orgs.map(o => ({ id: o.id, name: `Org ${o.id}`, use_new_zalo_runtime: serverOrgs.has(Number(o.id)) })))
  await insert('org_organization_product', snap.orgProducts)
  await insert('auto_account_groups', snap.accountGroups)
  await insert('auto_accounts', snap.accounts, { login_status: 'đã đăng nhập', status: 'chờ xử lý', runtime_operation_claim_token: null })
  await insert('auto_campaigns', snap.campaigns.map(c => ({ ...c, schedule: new Date(Date.now() - 60000).toISOString(),
    extra_settings: fresh.has(Number(c.id))
      ? Object.fromEntries(Object.entries(object(c.extra_settings)).filter(([k]) => !MATERIALIZED_MARKERS.test(k))) : c.extra_settings })),
    { status: 'chờ xử lý', daily_stop_time: null, completed_at: null })
  await insert('auto_campaign_input_data', snap.inputData.filter(i => !fresh.has(Number(i.campaign_id))),
    { status: 'chờ xử lý', note: null, schedule: null, date_action: null })
  // Lịch sử bộ cũ để so, không nạp vào auto_campaign_details (engine phải tự ghi lại từ đầu).
  await db.query(`CREATE TABLE public.replay_history (id bigint, input_data_id bigint, campaign_id bigint, action_code text, action_name text,
    status text, error_code text, counts_toward_limit boolean, log text, data jsonb, created_at timestamptz)`)
  await db.query(`INSERT INTO public.replay_history SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, input_data_id bigint, campaign_id bigint,
    action_code text, action_name text, status text, error_code text, counts_toward_limit boolean, log text, data jsonb, created_at timestamptz)`,
    [JSON.stringify(snap.details)])
  for (const t of ['auto_accounts', 'auto_campaigns', 'auto_campaign_input_data', 'auto_campaign_details']) {
    const seq = (await db.query(`SELECT pg_get_serial_sequence('public.${t}', 'id') s`)).rows[0].s
    if (seq) await db.query(`SELECT setval($1, greatest((SELECT coalesce(max(id), 0) FROM public."${t}"), 1) + 100000000)`, [seq])
  }
}

/**
 * Cổng cấp chiến dịch: lô gửi dạng chia sẻ (forwardMessage, tệp từng người) và lấy data đầu lượt (đọc danh sách từ Zalo giả dựng bằng
 * data bộ cũ). Thao tác của từng data chuyển cho cổng của data đó (portFor). Loại trừ gửi / danh sách không gửi không phát lại được
 * (cần nhóm liên hệ, tag của khách) nên chiến dịch bật hai tính năng này bị bỏ qua trước khi chạy.
 */
function campaignPort(E, rctx, c, oldRows, portFor, messageCode) {
  const accountId = Number(c.account_id)
  const mat = async (ctx, op, payload = {}) => {
    const r = await rctx.rpc('SELECT public.aka_agent_engine_materialize_v1($1, $2, $3, $4::jsonb) AS r', [accountId, ctx.leaseToken, op, JSON.stringify(payload)])
    if (r.ok !== true) throw new E.MaterializeRpcError(r.reason, r.message)
    return r
  }
  const ddmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date())
  const byThread = new Map(oldRows.map(r => [threadKey(r.uid), r]))
  const messageRow = oldRow => oldRow && rctx.types.rowsOf(rctx, { id: oldRow.id }).find(r => r.action_code === messageCode)
  const delegate = name => (ctx, ...args) => portFor(ctx.target)[name](ctx, ...args)
  const refused = name => async () => { throw new Error(`Phát lại không có dữ liệu ${name}`) }
  return {
    getUserProfile: delegate('getUserProfile'), saveResolvedProfile: delegate('saveResolvedProfile'), isOptedOut: delegate('isOptedOut'),
    prepareOptOutLink: delegate('prepareOptOutLink'), takeContentIndex: delegate('takeContentIndex'), prepareMedia: delegate('prepareMedia'),
    rewriteMessage: delegate('rewriteMessage'), businessNow: async () => new Date(), trace: () => {},
    // Chia sẻ: tệp gửi riêng từng người (lỗi khi dòng lịch sử là "share_media" lỗi), chữ chia sẻ cả lô; kết quả từng người theo dòng lịch sử.
    sendMedia: async ctx => {
      const row = messageRow(rctx.oldRowOf(ctx.target))
      if (row && row.status !== 'thành công' && row.data?.sendMode === 'share_media') throw rctx.types.historyError(E, row.data, 'send')
      return { response: row?.data?.mediaResponse ?? {}, msgId: 'replay-media' }
    },
    forwardMessage: async (_ctx, input) => ({
      response: { replay: true },
      results: input.threadIds.map(threadId => {
        const row = messageRow(byThread.get(threadKey(threadId)))
        if (!row || row.status === 'thành công' || row.data?.sendMode === 'share_media') return { threadId, ok: true }
        const f = object(row.data?.forwardTargetResult)
        const code = f.errorCode ?? object(row.data?.zalo).code ?? row.data?.rawCode ?? null
        return { threadId, ok: false, errorCode: code === null ? null : String(code), errorMessage: row.data?.error ?? null, raw: f.raw ?? null }
      })
    }),
    // Lấy data đầu lượt: danh sách giả = data bộ cũ đã lấy (đúng thứ tự id).
    materializeState: async ctx => E.materializeStateFrom(await mat(ctx, 'state')),
    materializeClear: async ctx => ({ cleared: Number((await mat(ctx, 'clear')).cleared) || 0 }),
    materializeInsert: async (ctx, rows, opts) => ({ inserted: Number((await mat(ctx, 'insert', { rows, ...(opts.vnDate ? { vnDate: opts.vnDate } : {}) })).inserted) || 0 }),
    materializeHold: async (ctx, hold) => { await mat(ctx, 'hold', hold) },
    getAllFriendsPage: async (_ctx, _count, page) => page === 1
      ? oldRows.map(r => ({ userId: r.uid, displayName: r.name || '', phoneNumber: r.phone || '', sdob: ddmm })) : [],
    friendTagConversations: async () => oldRows.map(r => r.uid),
    getFriendRecommendations: async () => ({ profiles: oldRows.map(r => ({ uid: r.uid, displayName: r.name || '', phone: r.phone || '' })),
      totalItems: oldRows.length, recommendedItems: oldRows.length, missingUidItems: 0, hasRecommendationList: true }),
    getSentFriendRequests: async () => ({ profiles: oldRows.map(r => ({ uid: r.uid, name: r.name, sentAt: r.info1 ? Number(r.info1) : null,
      requestMessage: r.info2 || undefined, globalId: r.info3 || undefined })), totalItems: oldRows.length, missingUidItems: 0 }),
    saveFriendContacts: async () => {},
    undoFriendRequest: delegate('undoFriendRequest'),
    sendExclusionSnapshot: refused('loại trừ gửi'), sendExclusionFacts: refused('loại trừ gửi'), labelMembership: refused('tag Zalo'),
    friendRequestStatus: refused('trạng thái kết bạn'), friendBlocklist: refused('danh sách không gửi')
  }
}

async function main() {
  const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  const E = await loadEngine()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-engine-replay-', timeoutMs: 3 * 3600 * 1000 })
  const db = await connect()
  const report = { snapshot: path.basename(snapshotPath), startedAt: new Date().toISOString(), campaigns: [], unsupported: {}, matrix: {}, logDiffs: {},
    targetStates: {}, notSelected: {} }
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(v501.migration)
    // ENGINE_REPLAY_UNTIL=508: dừng chuỗi ở bản đó, để so trước / sau một migration trên cùng dữ liệu.
    const until = Number(process.env.ENGINE_REPLAY_UNTIL || 9999)
    for (const [n, m] of [[503, v503], [504, v504], [505, v505], [506, v506], [507, v507], [508, v508], [509, v509], [512, v512]]) if (n <= until) await db.query(m.migration)
    // Chỉ ở DB thử: giữ hạn mức theo ngày (như bộ cũ, kể cả "tiếp tục khi chạm giới hạn"), bỏ hạn mức theo khung giờ vì phát lại
    // dồn trong vài giây sẽ bị chặn giả (hạn mức khung giờ có bộ kiểm SQL riêng).
    await db.query(`ALTER FUNCTION public.aka_agent_engine_action_limit(bigint, bigint, text) RENAME TO aka_agent_engine_action_limit_replay_orig`)
    await db.query(`CREATE FUNCTION public.aka_agent_engine_action_limit(p_campaign_id bigint, p_account_id bigint, p_action_code text)
      RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.aka_agent_engine_action_limit_replay_orig(p_campaign_id, p_account_id, p_action_code)
        - 'windowCount' - 'windowMinutes' $$`)
    const freshIds = freshCampaignIds(E, snap)
    await loadData(db, snap, freshIds)
    // Nhóm data: hàm kết thúc thật của production + nguồn "đang nhận" cho mỗi chiến dịch Nhóm data của mẫu (mẫu không chép bảng nguồn).
    await db.query(`CREATE TABLE public.auto_campaign_data_group_sources (id bigserial PRIMARY KEY, campaign_id bigint NOT NULL, staff_id bigint,
      organization_id bigint, status text NOT NULL, stopped_at timestamptz, stop_reason text, updated_at timestamptz DEFAULT now())`)
    await db.query(`CREATE FUNCTION public.aka_agent_internal_require_staff_tenant(p_staff_id bigint, p_organization_id bigint) RETURNS void
      LANGUAGE plpgsql AS $$ BEGIN END $$`)
    await db.query(`CREATE FUNCTION public.aka_agent_lock_campaign_input_serialization(p_campaign_id bigint) RETURNS void LANGUAGE sql
      AS $$ SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || p_campaign_id::text, 0)) $$`)
    await db.query(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/campaign-outcome-engine/data-group-finalizer-v219.sql'), 'utf8'))
    await db.query(`INSERT INTO public.auto_campaign_data_group_sources (campaign_id, staff_id, organization_id, status)
      SELECT id, staff_id, organization_id, 'active' FROM public.auto_campaigns WHERE data_target_source_mode = 'data_group'`)

    const rpc = async (sql, params) => (await db.query(sql, params)).rows[0].r
    const dataPort = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      reportBatch: (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r',
        [tok, JSON.stringify(items), size, stopped]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    const history = (await db.query(`SELECT * FROM public.replay_history ORDER BY input_data_id, created_at, id`)).rows
    const historyByTarget = new Map()
    for (const h of history) { if (!historyByTarget.has(h.input_data_id)) historyByTarget.set(h.input_data_id, []); historyByTarget.get(h.input_data_id).push(h) }
    const accounts = new Map(snap.accounts.map(a => [Number(a.id), a]))

    let campaigns = snap.campaigns.filter(c => (!onlyTypes || onlyTypes.has(c.action_id)) && (!only || only.has(Number(c.id))))
    if (limit) campaigns = campaigns.slice(0, limit)
    for (const c of campaigns) {
      const type = types[c.action_id]
      const account = accounts.get(Number(c.account_id))
      const entry = { id: c.id, action: c.action_id, runtime: account?.is_zalo_server ? 'fly' : 'desktop' }
      if (!type) { entry.skipped = 'type_not_registered'; report.unsupported[`${c.action_id}:type_not_registered`] = (report.unsupported[`${c.action_id}:type_not_registered`] || 0) + 1; report.campaigns.push(entry); continue }
      const cfg = type.campaignConfig(c)
      const exclusion = E.sendExclusionActive(cfg) ? 'send_exclusion_replay' : E.friendBlocklistActive(cfg) ? 'friend_blocklist_replay' : null
      const support = exclusion ? { ok: false, reason: exclusion } : type.support(E, cfg)
      if (!support.ok) {
        entry.skipped = support.reason
        report.unsupported[`${c.action_id}:${support.reason}`] = (report.unsupported[`${c.action_id}:${support.reason}`] || 0) + 1
        report.campaigns.push(entry); continue
      }
      const clock = fastClock(60000)
      const lines = []
      const isFresh = freshIds.has(Number(c.id))
      const oldRows = snap.inputData.filter(t => Number(t.campaign_id) === Number(c.id)).sort((a, b) => Number(a.id) - Number(b.id))
      const oldIdByUid = new Map(oldRows.map(r => [uidKey(r.uid), Number(r.id)]))
      const oldRowById = new Map(oldRows.map(r => [Number(r.id), r]))
      const ctx = { E, db, rpc, historyByTarget, types,
        // Data của chiến dịch lấy data đầu lượt có id mới: tra lịch sử bộ cũ theo UID.
        oldRowOf: target => oldRowById.get(isFresh ? oldIdByUid.get(uidKey(target.uid)) : Number(target.id)) ?? null }
      const portCache = new Map()
      const portFor = target => {
        const oldId = isFresh ? oldIdByUid.get(uidKey(target.uid)) : null
        const key = Number(target.id)
        if (!portCache.has(key)) portCache.set(key, type.replayPort(E, ctx, oldId ? { ...target, id: oldId } : target, cfg))
        return portCache.get(key)
      }
      const regType = E.zaloCampaignType(c.action_id)
      const messageCode = { zalo_message_friend: 'zalo_message_friend', zalo_message_group: 'zalo_message_group', zalo_message_birthday: 'zalo_message_friend' }[c.action_id] ?? 'zalo_message_stranger'
      const cport = campaignPort(E, ctx, c, oldRows, portFor, messageCode)
      const prepareTargets = regType?.prepareTargets?.(cfg, cport, { campaignName: c.name, campaignNote: null, random: () => 0 }) ?? null
      const batch = regType?.buildBatch?.(cfg, cport, { sleepBetweenBatchesSeconds: 0, readTimeoutMs: 15000, mediaTimeoutMs: 15000, sendTimeoutMs: 15000,
        random: () => 0 }) ?? null
      // Như bộ lập lịch: lượt kết thúc theo chỉ thị của DB (end_unit, ví dụ sau lỗi không rõ kết quả) thì nhịp sau chạy lượt mới
      // với các data còn lại. Tối đa 25 lượt mỗi chiến dịch.
      const runOnce = () => E.runUnit({ data: dataPort, journal: new E.MemoryJournal(), clock, events: { progress: l => lines.push(l), trace: () => {} } }, {
        runnerId: `${entry.runtime}:replay`, runtimeTarget: entry.runtime, staffId: Number(c.staff_id), accountId: Number(c.account_id),
        campaignId: Number(c.id), campaignName: c.name, accountName: account?.name ?? 'Zalo', campaignNote: null,
        ...type.unitConfig(E, cfg),
        buildSteps: target => type.buildSteps(E, cfg, portFor(target)),
        ...(prepareTargets ? { prepareTargets } : {}),
        ...(batch ? { batch } : {}),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [Number(c.account_id), info.leaseToken, info.note ?? null]),
        formatTime: iso => new Date(iso).toISOString(),
        pacing: { fullSeconds: 1 }, stepTimeoutMs: 15000, heartbeatMs: 60000, retry: { callTimeoutMs: 15000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      let result = await runOnce()
      let units = 1, targetsRun = result.targets
      while (result.reason === 'end_unit' && units < 25) {
        result = await runOnce()
        units++
        targetsRun += result.targets
      }
      entry.result = { reason: result.reason, targets: targetsRun, units }
      entry.final = (await db.query(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [Number(c.id)])).rows[0] ?? null
      if (only) {
        // Gỡ lỗi một chiến dịch: in các kết quả có hiệu ứng chiến dịch / chuỗi lỗi theo thứ tự.
        const outs = (await db.query(`SELECT o.input_data_id, o.action_code, o.error_code, o.decision->'contrib' AS c FROM public.auto_engine_outcomes o
          WHERE o.campaign_id = $1 ORDER BY o.created_at, o.result_key`, [Number(c.id)])).rows
        for (const o of outs) console.log('  ', o.input_data_id, o.action_code, o.error_code ?? '-', JSON.stringify({ streak: o.c.streak, thr: o.c.streakThreshold, camp: o.c.campaignEffect, run: o.c.runEffect, target: o.c.targetEffect }))
        const es = (await db.query(`SELECT * FROM public.auto_campaign_error_state WHERE campaign_id = $1`, [Number(c.id)])).rows[0]
        console.log('   error_state', JSON.stringify(es ?? null))
        if (process.env.REPLAY_LINES) for (const l of lines) console.log('   |', l.inputDataId ?? '-', l.text)
      }
      entry.lines = lines.length
      // So từng data có lịch sử trong mẫu.
      const targetIds = oldRows.map(t => Number(t.id))
      for (const tid of targetIds) {
        const old = (historyByTarget.get(String(tid)) || historyByTarget.get(tid) || [])
        // Chiến dịch lấy data đầu lượt: data mới cùng UID trong chiến dịch; bộ mới không lấy data đó (ví dụ huỷ N lời mời cũ nhất) thì ghi riêng.
        const newId = isFresh ? (await db.query(`SELECT id FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND lower(trim(uid)) = $2
          AND coalesce(is_delete, false) = false ORDER BY id LIMIT 1`, [Number(c.id), uidKey(oldRowById.get(tid)?.uid)])).rows[0]?.id ?? null : tid
        if (newId === null) {
          for (const r of old) report.notSelected[`${c.action_id} | ${r.action_code}`] = (report.notSelected[`${c.action_id} | ${r.action_code}`] || 0) + 1
          continue
        }
        const fresh = (await db.query(`SELECT action_code, status, error_code, counts_toward_limit, log FROM public.auto_campaign_details
          WHERE input_data_id = $1 ORDER BY id`, [newId])).rows
        const tstate = (await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE id = $1`, [newId])).rows[0]?.status ?? '?'
        report.targetStates[`${c.action_id}:${tstate}`] = (report.targetStates[`${c.action_id}:${tstate}`] || 0) + 1
        // Ghép theo mã thao tác (lần đầu của mỗi mã), không theo thứ tự dòng: data bị bỏ một bước vì hạn mức/thứ tự ở một bên
        // thì hiện là "(none)" ở bên đó, tách khỏi các cặp cùng chạy.
        const firstBy = list => { const m = new Map(); for (const r of list) if (!m.has(r.action_code)) m.set(r.action_code, r); return m }
        const ob = firstBy(old), fb = firstBy(fresh)
        for (const code of new Set([...ob.keys(), ...fb.keys()])) {
          const o = ob.get(code), f = fb.get(code)
          const key = [c.action_id, o ? `${o.action_code}|${o.status}|${o.error_code ?? '-'}|${o.counts_toward_limit}` : `${code}|(none)`,
            f ? `${f.action_code}|${f.status}|${f.error_code ?? '-'}|${f.counts_toward_limit}` : `${code}|(none)`].join(' => ')
          const m = report.matrix[key] ||= { count: 0, pending: 0, sample: null, targets: [] }
          m.count++
          // Data còn "chờ xử lý" ở bộ mới: chưa chạy tới (chiến dịch đang chờ khoá/giới hạn khi phát lại dồn thời gian).
          if (tstate === 'chờ xử lý') m.pending++
          if (!m.sample) m.sample = { target: tid, oldLog: o?.log ?? null, newLog: f?.log ?? null }
          if (m.targets.length < 30) m.targets.push(tid)
          if (o && f && (o.log || '') !== (f.log || '')) {
            const lk = `${c.action_id} | ${code} | ${o.status}`
            const lm = report.logDiffs[lk] ||= { count: 0, sample: null }
            lm.count++
            if (!lm.sample) lm.sample = { target: tid, oldLog: o.log, newLog: f.log }
          }
        }
      }
      report.campaigns.push(entry)
      console.log(`campaign ${c.id} ${c.action_id} ${entry.runtime}: ${result.reason}, ${targetsRun} data, ${units} lượt` +
        (result.reason === 'no_target' ? '' : ` — ${entry.final?.status}: ${String(entry.final?.note ?? '').slice(0, 160)}`))
    }
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  report.finishedAt = new Date().toISOString()
  const same = Object.entries(report.matrix).filter(([k]) => { const [, a, b] = k.split(' => '); return a === b })
  const diff = Object.entries(report.matrix).filter(([k]) => { const [, a, b] = k.split(' => '); return a !== b })
  console.log(`\nKhớp: ${same.reduce((s, [, v]) => s + v.count, 0)} dòng; khác: ${diff.reduce((s, [, v]) => s + v.count, 0)} dòng`)
  const pendingDiff = diff.reduce((s, [, v]) => s + v.pending, 0)
  console.log(`  trong đó data chưa chạy tới ở bộ mới (chờ khoá/giới hạn khi phát lại dồn thời gian): ${pendingDiff} dòng`)
  for (const [k, v] of diff.sort((a, b) => (b[1].count - b[1].pending) - (a[1].count - a[1].pending)).slice(0, 40)) {
    console.log(`  ${String(v.count - v.pending).padStart(5)} (+${v.pending} chưa chạy)  ${k}`)
  }
  const logDiffs = Object.entries(report.logDiffs).sort((a, b) => b[1].count - a[1].count)
  console.log(`Câu lịch sử khác: ${logDiffs.reduce((s, [, v]) => s + v.count, 0)} dòng`)
  for (const [k, v] of logDiffs.slice(0, 15)) console.log(`  ${String(v.count).padStart(5)}  ${k}\n         cũ: ${String(v.sample.oldLog).slice(0, 150)}\n         mới: ${String(v.sample.newLog).slice(0, 150)}`)
  console.log('Chưa hỗ trợ:', JSON.stringify(report.unsupported))
  console.log('Data bộ cũ mà bộ mới không lấy trong lượt này (lấy data đầu lượt):', JSON.stringify(report.notSelected))
  console.log('Trạng thái data cuối:', JSON.stringify(report.targetStates))
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 1))
}

main().catch(error => { console.error(error); process.exit(1) })
