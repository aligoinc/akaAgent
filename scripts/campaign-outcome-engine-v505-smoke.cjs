// V505: lấy data đầu lượt (materializeZalo*InputData của Desktop) bằng lõi thật (packages/campaign-engine) + cổng Zalo giả, trên
// PostgreSQL 17 cục bộ có đủ chuỗi V495 → V499 → V500 → V501 → V503 → V504 → V505. Kỳ vọng là hành vi Desktop (câu tiến trình, data
// thêm vào, dấu "đã lấy", câu hoàn thành) cộng các khác biệt đã ghi trong materialize.ts.
// Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v505-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const v504 = require('./build-v504-sql.cjs')
const v505 = require('./build-v505-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V505_TEST_PORT || 55504)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v505-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

/** Nhịp heartbeat của test: khác 60 giây để không trùng lần chờ 60 giây của lượt thử lại thứ ba khi Zalo báo 429. */
const HEARTBEAT_MS = 61000
/** Nghỉ trả về ngay (ghi lại số ms), riêng nhịp heartbeat chờ tới khi lượt dừng. */
function testClock(slept) {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms === HEARTBEAT_MS) return signal?.addEventListener('abort', () => resolve(false), { once: true })
      slept?.push(ms)
      setImmediate(() => resolve(!signal?.aborted))
    })
  }
}

const FRIEND = 'zalo_message_friend'
const BIRTHDAY = 'zalo_message_birthday'
const RECOMMENDATION = 'zalo_message_friend_recommendation'
const CANCEL = 'zalo_cancel_sent_friend_request'

async function main() {
  const E = await loadEngine()

  // ---- 1. Hỗ trợ, kế hoạch claim, các bước (không cần DB) -----------------------------------------------------
  {
    const core = (actionId, extra = {}) => ({ id: 1, actionId, accountId: 7, content: 'Chào', extraSettings: extra, images: [], dataTargetSourceMode: null })
    const env = { engagementTrackingEnabled: false }
    for (const [actionId, extra] of [[BIRTHDAY, {}], [BIRTHDAY, { zaloMessageSendMode: 'share' }], [RECOMMENDATION, { enableMessage: true, internalSmsEnabled: true }],
      [CANCEL, {}], [FRIEND, { zaloFriendTargetMode: 'tagged_friends' }]]) {
      assert.deepEqual(E.zaloCampaignV2Support(core(actionId, extra), env), { ok: true }, `${actionId} ${JSON.stringify(extra)}`)
    }
    assert.deepEqual(E.zaloCampaignV2Support(core(RECOMMENDATION, {}), env), { ok: false, reason: 'no_send_step' }, 'đề xuất: phải bật nhắn tin hoặc kết bạn')
    assert.deepEqual(E.zaloCampaignType(CANCEL).claimPlan(core(CANCEL)), { actions: [{ code: CANCEL, quota: false }] }, 'huỷ lời mời: chỉ khoá, không hạn mức')
    assert.deepEqual(E.zaloCampaignType(BIRTHDAY).claimPlan(core(BIRTHDAY)), { actions: [{ code: FRIEND }] })
    assert.equal(E.zaloCampaignType(CANCEL).actionNames[CANCEL], 'Huỷ lời mời kết bạn')
    const port = {}
    // Bước đang bật với một data có sẵn mục tiêu (bước akaBiz luôn có trong danh sách nhưng tắt khi không có tag cần gắn).
    const ctx = { target: { id: 1, uid: 'u' }, state: { zaloTarget: { uid: 'u', phone: '' } }, signal: new AbortController().signal }
    const keys = (actionId, extra) => E.zaloCampaignType(actionId).buildSteps(core(actionId, extra), port, {})
      .filter(s => !s.enabled || s.enabled(ctx)).map(s => s.key)
    const auxFlags = { enableAkaBizTag: true, akaBizTagIds: [1], enableZaloTag: true, zaloTagIdsByAccount: { 7: [{ id: 1 }] }, enableChangeAlias: true, aliasTemplate: 'x' }
    assert.ok(keys(FRIEND, auxFlags).some(k => /akabiz/i.test(k)), `bạn bè có tag akaBiz: ${keys(FRIEND, auxFlags)}`)
    assert.ok(!keys(BIRTHDAY, auxFlags).some(k => /akabiz|tag|alias/i.test(k)), `sinh nhật không tag / đổi tên: ${keys(BIRTHDAY, auxFlags)}`)
    assert.deepEqual(E.zaloCampaignType(CANCEL).buildSteps(core(CANCEL), port).map(s => [s.key, s.delivery]), [['target', false], ['cancel_friend_request', true]])
    assert.equal(E.zaloCampaignType(FRIEND).prepareTargets(core(FRIEND, {}), port, { campaignName: 'x' }), null)
    assert.equal(typeof E.zaloCampaignType(CANCEL).prepareTargets(core(CANCEL), port, { campaignName: 'x' }), 'function')
  }
  pass('hỗ trợ: sinh nhật (kể cả đã lưu chế độ chia sẻ), đề xuất (bỏ cấu hình SMS), huỷ lời mời, bạn bè theo tag; huỷ lời mời không kiểm hạn mức; sinh nhật không tag / đổi tên')

  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v505-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    await db.query(v501.migration)
    await db.query(v503.migration)
    await db.query(v504.migration)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r

    // ---- 2. Apply / gỡ ---------------------------------------------------------------------------------------
    const SIG = 'public.aka_agent_engine_materialize_v1(bigint,uuid,text,jsonb)'
    const claimMd5 = () => val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure`)
    assert.equal(await claimMd5(), v505.LIVE.claim)
    await db.query(v505.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await val(`SELECT to_regprocedure($1)`, [SIG]), null)
    assert.equal(await claimMd5(), v505.LIVE.claim)
    await db.query(v505.migration)
    assert.equal(await claimMd5(), v505.NEW.claim)
    assert.equal(await val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)`, [SIG]), v505.NEW.fn)
    await assert.rejects(db.query(v505.migration), /đã có/)
    await db.query('ROLLBACK')
    for (const role of ['anon', 'authenticated']) assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, SIG]), false)
    for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, SIG]), true)
    await db.query(v505.rollback)
    assert.equal(await val(`SELECT to_regprocedure($1)`, [SIG]), null)
    assert.equal(await claimMd5(), v505.LIVE.claim, 'gỡ: claim về đúng thân V503')
    await db.query(v505.migration)
    pass('apply trong transaction rồi ROLLBACK không để lại gì; apply thật; apply lần hai bị chặn; quyền như các RPC engine; gỡ trả claim về V503 rồi apply lại')

    // ---- Dữ liệu thử ------------------------------------------------------------------------------------------
    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      reportBatch: (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r', [tok, JSON.stringify(items), size, stopped]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 970000
    const STAFF = 9501, ORG = 681
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const make = async ({ actionId, extra = {}, targets = [], content = 'Chào #{FULL_NAME}', note = null }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings, images, note)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Lấy data', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5, $6, $7::jsonb, '[]'::jsonb, $8)`,
        [campaign, actionId, account, STAFF, ORG, content, JSON.stringify(extra), note])
      const ids = []
      for (const t of targets) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, false)`, [id, campaign, t.name ?? null, t.uid ?? null, t.status ?? 'chờ xử lý'])
        ids.push(id)
      }
      return { account, campaign, ids, actionId, extra, content, note }
    }
    const materialize = async (account, ctx, operation, payload = {}) => {
      const r = await rpc(`SELECT public.aka_agent_engine_materialize_v1($1, $2, $3, $4::jsonb) AS r`, [account, ctx.leaseToken, operation, JSON.stringify(payload)])
      if (r.ok !== true) throw new E.MaterializeRpcError(r.reason, r.message)
      return r
    }
    const http429 = () => Object.assign(new Error('Request failed with status code 429'), { status: 429 })
    const run = async (c, zalo = {}) => {
      const calls = [], lines = [], slept = [], contacts = []
      const queue = name => (Array.isArray(zalo[name]) ? zalo[name] : null)
      const answer = async (name, fallback) => {
        calls.push(name)
        const q = queue(name)
        const next = q ? q.shift() : zalo[name]
        if (next instanceof Error) throw next
        if (typeof next === 'function') return next()
        return next ?? fallback
      }
      const port = {
        materializeState: async ctx => E.materializeStateFrom(await materialize(c.account, ctx, 'state')),
        materializeClear: async ctx => ({ cleared: Number((await materialize(c.account, ctx, 'clear')).cleared) || 0 }),
        materializeInsert: async (ctx, rowsIn, opts) => ({ inserted: Number((await materialize(c.account, ctx, 'insert', { rows: rowsIn, ...(opts.vnDate ? { vnDate: opts.vnDate } : {}) })).inserted) || 0 }),
        materializeHold: async (ctx, hold) => { await materialize(c.account, ctx, 'hold', hold) },
        getAllFriendsPage: async (_ctx, count, page) => {
          calls.push(`friends:${count}:${page}`)
          const pages = zalo.friendPages ?? []
          const p = pages[page - 1]
          if (p instanceof Error) throw p
          return p ?? []
        },
        friendTagConversations: async (_ctx, tagIds) => answer(`tags:${tagIds.join(',')}`, []),
        getFriendRecommendations: async () => answer('recommendations', { profiles: [], totalItems: 0, recommendedItems: 0, missingUidItems: 0, hasRecommendationList: true }),
        getSentFriendRequests: async () => answer('sent', { profiles: [], totalItems: 0, missingUidItems: 0 }),
        saveFriendContacts: async (_ctx, raws, source) => { contacts.push(...raws.map(r => `${source}:${r.userId}`)) },
        undoFriendRequest: async (_ctx, uid) => { calls.push(`undo:${uid}`); return { ok: 1 } },
        getUserProfile: async (_ctx, uid) => { calls.push(`profile:${uid}`); return E.normalizeZaloFoundUser({ userId: uid, display_name: `Bạn ${uid}`, zalo_name: `Bạn ${uid}`, gender: 1 }) },
        saveResolvedProfile: async () => {},
        isOptedOut: async () => false,
        prepareOptOutLink: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
        takeContentIndex: async () => 0,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid) => { calls.push(`text:${uid}`); return { response: { msgId: `m-${uid}` }, msgId: `m-${uid}` } },
        sendFriendRequest: async (_ctx, uid) => { calls.push(`friend:${uid}`); return {} },
        prepareMedia: async () => [], sendMedia: async () => { throw new Error('không có tệp') },
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1,
        forwardMessage: async (_ctx, input) => {
          calls.push(`forward:${input.threadIds.join(',')}`)
          return { response: { ok: true }, results: input.threadIds.map(threadId => ({ threadId, ok: true })) }
        }
      }
      const camp = await one(`SELECT name, note, extra_settings FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
      const core = { id: c.campaign, actionId: c.actionId, accountId: c.account, content: c.content, extraSettings: camp.extra_settings, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(c.actionId)
      const prepareTargets = type.prepareTargets(core, port, { campaignName: camp.name, campaignNote: camp.note, random: () => 0 })
      // Gửi dạng chia sẻ chạy theo lô (V503), sau bước lấy data đầu lượt như Desktop.
      const batch = type.buildBatch?.(core, port, { sleepBetweenBatchesSeconds: 0, readTimeoutMs: 5000, mediaTimeoutMs: 5000, sendTimeoutMs: 5000 }) ?? null
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(slept), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v505', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actionId: c.actionId,
        campaignName: camp.name, accountName: 'Zalo', campaignNote: camp.note, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } }),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        ...(prepareTargets ? { prepareTargets } : {}),
        ...(batch ? { batch } : {}),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [c.account, info.leaseToken, info.note ?? null]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      return { result, calls, lines, slept, contacts }
    }
    const inputs = c => rows(`SELECT id::integer AS id, name, uid, phone, info1, info2, info3, status, note, is_delete
      FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
    const details = c => rows(`SELECT action_code, status, log FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
    const camp = c => one(`SELECT status, note, extra_settings, schedule FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
    const vnToday = await val(`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD')`)
    const ddmm = `${vnToday.slice(8, 10)}/${vnToday.slice(5, 7)}`

    // ---- 3. RPC: xác thực, state / insert / clear / hold, chặn ghi trùng ------------------------------------------
    {
      const c = await make({ actionId: CANCEL, targets: [{ name: 'Cũ', uid: 'old-1', status: 'hoàn thành' }] })
      const claim = await data.claimTarget({ runnerId: 'smoke', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign,
        actions: [{ code: CANCEL, quota: false }] })
      assert.equal(claim.status, 'no_target', JSON.stringify(claim))
      const call = (op, payload = {}, token = claim.leaseToken, account = c.account) =>
        rpc(`SELECT public.aka_agent_engine_materialize_v1($1, $2, $3, $4::jsonb) AS r`, [account, token, op, JSON.stringify(payload)])
      assert.deepEqual(await call('state', {}, '00000000-0000-4000-8000-000000000000'), { ok: false, reason: 'ownership_lost' })
      assert.deepEqual(await call('pause'), { ok: false, reason: 'invalid_request' })
      const st = await call('state')
      assert.deepEqual({ ...st, markers: undefined }, { ok: true, vnDate: vnToday, total: 1, pending: 0, running: 0, done: 1, note: null, markers: undefined })
      assert.deepEqual(await call('insert', { rows: [{ uid: 'x' }] }), { ok: false, reason: 'not_empty', total: 1 }, 'chiến dịch đã có data: không thêm')
      assert.deepEqual(await call('clear'), { ok: true, cleared: 1 })
      assert.deepEqual(await call('insert', { rows: [{ uid: ' u-1 ', name: 'A', info1: '100', info2: '', info3: 'g1' }, { uid: '' }, { name: 'không UID' }] }),
        { ok: true, inserted: 1 }, 'bỏ dòng không có UID')
      const i = await inputs(c)
      assert.deepEqual(i.filter(x => !x.is_delete).map(x => [x.uid, x.name, x.info1, x.info2, x.info3, x.status, x.note]), [['u-1', 'A', '100', null, 'g1', 'chờ xử lý', null]])
      const markers = (await camp(c)).extra_settings
      assert.equal(markers.zaloCancelFriendRequestMaterializedCount, 1)
      assert.match(markers.zaloCancelFriendRequestDataMaterializedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      assert.deepEqual(await call('insert', { rows: [{ uid: 'u-2' }] }), { ok: false, reason: 'not_empty', total: 1 }, 'gọi lại sau khi đã thêm: không thêm trùng')
      assert.deepEqual(await call('clear'), { ok: false, reason: 'not_all_done' }, 'còn data chưa xong: không xoá')
      const held = await call('hold', { note: 'Chờ thử', status: 'chờ xử lý', retryAfterMinutes: 10 })
      assert.equal(held.ok, true)
      const after = await camp(c)
      assert.equal(after.note, 'Chờ thử')
      assert.ok(new Date(after.schedule).getTime() > Date.now() + 9 * 60000, 'hẹn lại 10 phút')
      assert.deepEqual(await call('hold', { note: '' }), { ok: false, reason: 'invalid_request' })
      await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token = gen_random_uuid() WHERE id = $1`, [c.campaign])
      assert.deepEqual(await call('state'), { ok: false, reason: 'legacy_busy' }, 'bộ cũ đang giữ chiến dịch: không đụng')
      await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token = NULL WHERE id = $1`, [c.campaign])
      await data.release(c.account, claim.leaseToken)
      // Bạn bè chọn tay không lấy data đầu lượt; Nhóm data không bao giờ.
      const f = await make({ actionId: FRIEND, extra: {} })
      const fc = await data.claimTarget({ runnerId: 'smoke', runtimeTarget: 'desktop', staffId: STAFF, accountId: f.account, campaignId: f.campaign, actions: [{ code: FRIEND }] })
      assert.deepEqual(await call('state', {}, fc.leaseToken, f.account), { ok: false, reason: 'action_not_supported' })
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = '{"zaloFriendTargetMode":"all_friends"}', data_target_source_mode = 'data_group' WHERE id = $1`, [f.campaign])
      assert.deepEqual(await call('state', {}, fc.leaseToken, f.account), { ok: false, reason: 'data_group' })
      await data.release(f.account, fc.leaseToken)
    }
    pass('RPC: xác thực bằng lease; state đếm data + ngày VN theo giờ DB; insert chỉ vào chiến dịch rỗng (gọi lại không trùng), bỏ dòng không UID, ghi dấu; clear chỉ khi mọi data xong; hold; bộ cũ đang giữ / chọn tay / Nhóm data thì từ chối')

    // ---- 4. Claim: "quota": false chỉ kiểm khoá -----------------------------------------------------------------
    {
      const c = await make({ actionId: CANCEL, targets: [{ name: 'A', uid: 'q-1' }] })
      await db.query(`INSERT INTO public.auto_account_action_status (account_id, action_code, count_action_in_day, count_date, is_disable)
        VALUES ($1, $2, 999, (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, false)`, [c.account, CANCEL])
      const ctx = { runnerId: 'smoke', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign }
      const withQuota = await data.claimTarget({ ...ctx, actions: [{ code: CANCEL }] })
      assert.equal(withQuota.status, 'wait', 'không khai: hạn mức mặc định 30/ngày chặn')
      await data.release(c.account, withQuota.leaseToken)
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute', note = NULL WHERE id = $1`, [c.campaign])
      const noQuota = await data.claimTarget({ ...ctx, actions: [{ code: CANCEL, quota: false }] })
      assert.equal(noQuota.status, 'claimed', JSON.stringify(noQuota))
      // Đóng lượt data như khi bị dừng trước khi gửi (RUN01): data về hàng đợi, nhả lease.
      const closed = await data.report(noQuota.targetRunId, noQuota.leaseToken, [{ resultKey: `v2:${noQuota.targetRunId}:cancel`, actionCode: CANCEL,
        stepKey: 'cancel_friend_request', ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'cancelled', message: 'Dừng thử' } }], true)
      assert.equal(closed.ok, true, JSON.stringify(closed))
      assert.equal((await data.release(c.account, noQuota.leaseToken)).ok, true)
      await db.query(`UPDATE public.auto_account_action_status SET is_disable = true, date_enable = now() + interval '1 hour', disabled_error_code = 'error_limit_in_day'
        WHERE account_id = $1 AND action_code = $2`, [c.account, CANCEL])
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý' WHERE campaign_id = $1`, [c.campaign])
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute', note = NULL WHERE id = $1`, [c.campaign])
      const locked = await data.claimTarget({ ...ctx, actions: [{ code: CANCEL, quota: false }] })
      assert.equal(locked.status, 'wait', 'đang bị khoá thì vẫn chờ')
      await data.release(c.account, locked.leaseToken)
    }
    pass('claim: thao tác khai quota=false (huỷ lời mời) không bị hạn mức chặn nhưng vẫn chờ khi đang bị khoá; không khai thì như cũ')

    // ---- 5. Huỷ lời mời: lấy N lời mời cũ nhất, huỷ từng người; lượt sau xoá data cũ và lấy lại ------------------
    {
      const c = await make({ actionId: CANCEL, extra: { zaloCancelFriendRequestLimit: 3 } })
      const sent = { profiles: [
        { uid: 'r-3', name: 'Ba', sentAt: 300, requestMessage: 'Chào Ba', globalId: 'G3' },
        { uid: 'r-1', name: 'Một', sentAt: 100, requestMessage: '', globalId: 'G1' },
        { uid: 'r-9', name: 'Chín', sentAt: null },
        { uid: 'r-2', displayName: 'Hai', sentAt: 200 }], totalItems: 5, missingUidItems: 1 }
      const r = await run(c, { sent })
      assert.equal(r.result.reason, 'no_target', JSON.stringify(r.result))
      assert.deepEqual(r.calls.filter(x => x.startsWith('undo:') || x === 'sent'), ['sent', 'undo:r-1', 'undo:r-2', 'undo:r-3'], 'cũ nhất trước, tối đa 3')
      assert.deepEqual(r.lines.slice(0, 6), [
        '🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"',
        '🔄 Đang lấy danh sách lời mời kết bạn đã gửi từ Zalo để huỷ 3 lời mời cũ nhất',
        '⏳ Chờ 2.0 giây trước khi đọc danh sách lời mời kết bạn đã gửi...',
        '⚠️ Bỏ qua 1 lời mời Zalo thiếu UID',
        '✅ Đã thêm 3 lời mời kết bạn đã gửi vào chiến dịch "Lấy data"',
        '▶️ Xử lý "Một" trong chiến dịch "Lấy data"'], r.lines.join('\n'))
      assert.ok(r.lines.includes('✅ Hoàn thành chiến dịch "Lấy data"'), r.lines.join('\n'))
      const i = await inputs(c)
      assert.deepEqual(i.map(x => [x.uid, x.name, x.info1, x.info2, x.info3, x.status]), [
        ['r-1', 'Một', '100', null, 'G1', 'hoàn thành'], ['r-2', 'Hai', '200', null, null, 'hoàn thành'], ['r-3', 'Ba', '300', 'Chào Ba', 'G3', 'hoàn thành']])
      const d = await details(c)
      assert.deepEqual(d.map(x => [x.action_code, x.status, x.log]), [
        [CANCEL, 'thành công', 'Đã huỷ lời mời kết bạn đã gửi đến Một'], [CANCEL, 'thành công', 'Đã huỷ lời mời kết bạn đã gửi đến Hai'],
        [CANCEL, 'thành công', 'Đã huỷ lời mời kết bạn đã gửi đến Ba']])
      assert.equal((await camp(c)).status, 'hoàn thành')
      // Lượt sau (bảo trì lịch đã mở lại chiến dịch): mọi data đã xong → xoá mềm rồi lấy lại; Zalo không còn lời mời → hoàn thành kèm câu.
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute' WHERE id = $1`, [c.campaign])
      const r2 = await run(c, { sent: { profiles: [], totalItems: 0, missingUidItems: 0 } })
      assert.deepEqual(r2.lines, ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"',
        '🔄 Đang lấy danh sách lời mời kết bạn đã gửi từ Zalo để huỷ 3 lời mời cũ nhất',
        '⏳ Chờ 2.0 giây trước khi đọc danh sách lời mời kết bạn đã gửi...',
        '⚠️ Zalo không có lời mời kết bạn đã gửi để huỷ', '✅ Hoàn thành chiến dịch "Lấy data"'])
      assert.deepEqual((await inputs(c)).map(x => x.is_delete), [true, true, true], 'data cũ xoá mềm như clearCampaignInputData')
      assert.deepEqual(await camp(c).then(x => [x.status, x.note]), ['hoàn thành', 'Zalo không có lời mời kết bạn đã gửi để huỷ'])
    }
    pass('huỷ lời mời: câu như Desktop, N lời mời cũ nhất (sentAt tăng dần), info1–3; huỷ từng người ghi "Đã huỷ lời mời kết bạn đã gửi đến …"; lượt sau xoá mềm data cũ, rỗng thì hoàn thành kèm câu')

    // ---- 6. Đọc lỗi: Zalo trả lỗi → hoàn thành kèm câu (như Desktop); lỗi tạm thời / 429 hết lượt thử → về chờ, hẹn 10 phút ----------
    {
      const c = await make({ actionId: CANCEL })
      const answered = new E.ZaloPortError('Zalo từ chối', { code: '500', signal: { kind: 'zalo_code', code: '500', message: 'Zalo từ chối' }, phase: 'after_send' })
      const r = await run(c, { sent: answered })
      assert.ok(r.lines.includes('⚠️ Không lấy được danh sách lời mời kết bạn đã gửi từ Zalo: Zalo từ chối'), r.lines.join('\n'))
      assert.deepEqual(await camp(c).then(x => [x.status, x.note]), ['hoàn thành', 'Không lấy được danh sách lời mời kết bạn đã gửi từ Zalo: Zalo từ chối'])

      const t = await make({ actionId: CANCEL })
      const r2 = await run(t, { sent: [http429(), http429(), http429(), http429()] })
      assert.deepEqual(r2.lines.filter(x => x.startsWith('⚠️ Zalo đang giới hạn')), [
        '⚠️ Zalo đang giới hạn request khi đọc danh sách lời mời kết bạn đã gửi. Tự thử lại sau 15 giây (1/3)...',
        '⚠️ Zalo đang giới hạn request khi đọc danh sách lời mời kết bạn đã gửi. Tự thử lại sau 30 giây (2/3)...',
        '⚠️ Zalo đang giới hạn request khi đọc danh sách lời mời kết bạn đã gửi. Tự thử lại sau 60 giây (3/3)...'])
      assert.deepEqual(r2.slept.filter(ms => ms >= 15000), [15000, 30000, 60000])
      assert.equal(r2.result.reason, 'wait')
      const held = await camp(t)
      assert.equal(held.status, 'chờ xử lý')
      assert.equal(held.note, 'Chưa lấy được danh sách lời mời kết bạn đã gửi từ Zalo: Zalo đang giới hạn tần suất request (HTTP 429). Tự thử lại sau 10 phút')
      assert.ok(new Date(held.schedule).getTime() > Date.now() + 9 * 60000)
      assert.equal(held.extra_settings.zaloCancelFriendRequestDataMaterializedAt, undefined, 'lỗi tạm thời: chưa đánh dấu đã lấy')

      const n = await make({ actionId: CANCEL })
      const offline = new E.ZaloPortError('fetch failed', { signal: { kind: 'message_like', message: 'fetch failed' }, phase: 'before_send' })
      const r3 = await run(n, { sent: [http429(), { profiles: [{ uid: 'n-1', name: 'N', sentAt: 1 }], totalItems: 1, missingUidItems: 0 }] })
      assert.ok(r3.calls.includes('undo:n-1'), '429 rồi đọc được: chạy tiếp')
      const m = await make({ actionId: CANCEL })
      await run(m, { sent: offline })
      assert.match((await camp(m)).note, /^Chưa lấy được danh sách lời mời kết bạn đã gửi từ Zalo: fetch failed\. Tự thử lại sau 10 phút$/)
    }
    pass('đọc lỗi: Zalo trả lỗi → hoàn thành kèm câu như Desktop; 429 thử lại 15/30/60 giây kèm câu, hết lượt hoặc mất mạng → về chờ, hẹn 10 phút, chưa đánh dấu')

    // ---- 7. Sinh nhật: lọc theo ngày VN của DB, lưu danh bạ, nhắn như bạn bè; không ai thì hoàn thành kèm câu -----------
    {
      const page1 = Array.from({ length: 500 }, (_, k) => ({ userId: `b-${k}`, displayName: `Bạn ${k}`, sdob: k === 7 ? `${ddmm}/1990` : '01/01/1990' }))
      const page2 = [{ userId: 'b-500', zaloName: 'Năm trăm', sdob: ddmm, phoneNumber: '0900000500' }, { userId: 'b-7', displayName: 'Trùng', sdob: ddmm }]
      const c = await make({ actionId: BIRTHDAY, extra: { actionLimits: { byActionCode: { [FRIEND]: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } } } })
      const r = await run(c, { friendPages: [page1, page2] })
      assert.deepEqual(r.calls.filter(x => x.startsWith('friends:')), ['friends:500:1', 'friends:500:2'])
      assert.deepEqual(r.lines.slice(0, 6), ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"',
        `🔄 Đang quét danh sách bạn bè Zalo live để lọc sinh nhật ${ddmm}`,
        '⏳ Chờ 2.0 giây trước khi đọc trang 1 danh sách bạn bè Zalo...', '⏳ Chờ 2.0 giây trước khi đọc trang 2 danh sách bạn bè Zalo...',
        '✅ Đã thêm 2 bạn bè sinh nhật hôm nay vào chiến dịch "Lấy data"', '▶️ Xử lý "Bạn 7" trong chiến dịch "Lấy data"'], r.lines.join('\n'))
      assert.deepEqual(r.contacts, [`${BIRTHDAY}:b-7`, `${BIRTHDAY}:b-500`])
      assert.deepEqual((await inputs(c)).map(x => [x.uid, x.name, x.phone, x.status]), [['b-7', 'Bạn 7', null, 'hoàn thành'], ['b-500', 'Năm trăm', '0900000500', 'hoàn thành']])
      assert.deepEqual(r.calls.filter(x => x.startsWith('text:')), ['text:b-7', 'text:b-500'])
      assert.deepEqual((await details(c)).map(x => [x.action_code, x.status]), [[FRIEND, 'thành công'], [FRIEND, 'thành công']])
      assert.equal((await camp(c)).extra_settings.zaloBirthdayDataMaterializedDate, vnToday)

      const e = await make({ actionId: BIRTHDAY })
      const r2 = await run(e, { friendPages: [[{ userId: 'x', sdob: '31/12' }]] })
      assert.deepEqual(r2.lines, ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"', `🔄 Đang quét danh sách bạn bè Zalo live để lọc sinh nhật ${ddmm}`,
        '⏳ Chờ 2.0 giây trước khi đọc trang 1 danh sách bạn bè Zalo...', '🎂 Không có bạn bè sinh nhật hôm nay', '✅ Hoàn thành chiến dịch "Lấy data"'].filter(x => ddmm !== '31/12' || !x.startsWith('🎂')))
      assert.deepEqual(await camp(e).then(x => [x.status, x.note, x.extra_settings.zaloBirthdayDataMaterializedDate, x.extra_settings.zaloBirthdayMaterializedCount]),
        ['hoàn thành', 'Không có bạn bè sinh nhật hôm nay', vnToday, 0])
      // Lượt sau cùng ngày (chiến dịch được mở lại): đã đánh dấu hôm nay → không đọc Zalo nữa.
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute' WHERE id = $1`, [e.campaign])
      const r3 = await run(e, {})
      assert.deepEqual(r3.calls, [])
      assert.deepEqual(r3.lines, ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"', '🎂 Không có bạn bè sinh nhật hôm nay', '✅ Hoàn thành chiến dịch "Lấy data"'])
    }
    pass('sinh nhật: quét các trang 500, lọc sdob theo ngày VN của DB, bỏ trùng UID, lưu danh bạ, nhắn như bạn bè; không ai thì "🎂 Không có bạn bè sinh nhật hôm nay" + hoàn thành; cùng ngày không quét lại')

    // ---- 8. Đề xuất Zalo: lấy N đề xuất, bỏ trùng; danh sách rỗng / không UID → hoàn thành kèm câu --------------------------
    {
      const c = await make({ actionId: RECOMMENDATION, extra: { enableMessage: true, zaloFriendRecommendationCount: 2 } })
      const rec = { profiles: [{ uid: 'p-1', displayName: 'Phong', phone: '0911' }, { uid: 'p-1', displayName: 'Trùng' }, { uid: 'p-2', zaloName: 'Zalo Hai' },
        { uid: 'p-3', displayName: 'Ba' }], totalItems: 6, recommendedItems: 5, missingUidItems: 1, hasRecommendationList: true }
      const r = await run(c, { recommendations: rec })
      assert.deepEqual(r.lines.slice(0, 5), ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"', '🔄 Đang lấy 2 đề xuất Zalo',
        '⏳ Chờ 2.0 giây trước khi đọc danh sách đề xuất Zalo...', '⚠️ Bỏ qua 1 đề xuất Zalo thiếu UID', '✅ Đã thêm 2 đề xuất Zalo vào chiến dịch "Lấy data"'])
      assert.deepEqual((await inputs(c)).map(x => [x.uid, x.name, x.phone]), [['p-1', 'Phong', '0911'], ['p-2', 'Zalo Hai', null]])
      assert.deepEqual(r.calls.filter(x => x.startsWith('text:')), ['text:p-1', 'text:p-2'])
      assert.deepEqual(r.contacts, [], 'đề xuất: không lưu danh bạ lúc lấy data (như Desktop)')

      const few = await make({ actionId: RECOMMENDATION, extra: { enableMessage: true } })
      const r2 = await run(few, { recommendations: { profiles: [{ uid: 'q-1', displayName: 'Q' }], totalItems: 1, recommendedItems: 1, missingUidItems: 0, hasRecommendationList: true } })
      assert.ok(r2.lines.includes('⚠️ Chỉ lấy được 1/10 đề xuất Zalo'), r2.lines.join('\n'))

      const none = await make({ actionId: RECOMMENDATION, extra: { enableMessage: true } })
      const r3 = await run(none, { recommendations: { profiles: [], totalItems: 3, recommendedItems: 2, missingUidItems: 2, hasRecommendationList: true } })
      assert.ok(r3.lines.includes('⚠️ Danh sách đề xuất Zalo không có UID hợp lệ để chạy'))
      assert.deepEqual(await camp(none).then(x => [x.status, x.note]), ['hoàn thành', 'Danh sách đề xuất Zalo không có UID hợp lệ để chạy'])
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute' WHERE id = $1`, [none.campaign])
      const r4 = await run(none, {})
      assert.deepEqual(r4.calls, [], 'đã đánh dấu: không đọc lại')
      assert.deepEqual(r4.lines, ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"', '⚠️ Zalo không có danh sách đề xuất để chạy', '✅ Hoàn thành chiến dịch "Lấy data"'])
      const nolist = await make({ actionId: RECOMMENDATION, extra: { enableMessage: true } })
      await run(nolist, { recommendations: { profiles: [], totalItems: 0, recommendedItems: 0, missingUidItems: 0, hasRecommendationList: false } })
      assert.equal((await camp(nolist)).note, 'Zalo không trả danh sách đề xuất để chạy')
    }
    pass('đề xuất Zalo: N đề xuất đầu, bỏ trùng UID, tên hiển thị → tên Zalo, không lưu danh bạ; "Chỉ lấy được x/N"; rỗng / không UID / không có danh sách → hoàn thành kèm câu đúng lý do; đã đánh dấu thì không đọc lại')

    // ---- 9. Bạn bè "toàn bộ / theo tag": lấy một lần; chưa chọn tag / tag hỏng / không có ai --------------------------------
    {
      const limits = { actionLimits: { byActionCode: { [FRIEND]: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } } }
      const all = await make({ actionId: FRIEND, extra: { ...limits, zaloFriendTargetMode: 'all_friends' } })
      const r = await run(all, { friendPages: [[{ userId: 'a-1', displayName: 'An' }, { uid: 'a-2', username: 'binh' }, { name: 'không UID' }]] })
      assert.deepEqual(r.lines.slice(0, 5), ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"', '🔄 Đang quét toàn bộ danh sách bạn bè Zalo live',
        '⏳ Chờ 2.0 giây trước khi đọc trang 1 danh sách bạn bè Zalo...', '✅ Đã thêm 2 bạn bè Zalo vào chiến dịch "Lấy data"', '▶️ Xử lý "An" trong chiến dịch "Lấy data"'])
      assert.deepEqual((await inputs(all)).map(x => [x.uid, x.name]), [['a-1', 'An'], ['a-2', 'binh']])
      assert.equal((await camp(all)).extra_settings.zaloFriendMaterializedCount, 2)
      assert.deepEqual(r.calls.filter(x => x.startsWith('text:')), ['text:a-1', 'text:a-2'])

      const tagged = await make({ actionId: FRIEND, extra: { ...limits, zaloFriendTargetMode: 'tagged_friends', zaloFriendSourceTagIds: ['5', ' 5 ', '6'], zaloFriendSourceTagNames: ['VIP', 'VIP', ''] } })
      // Mỗi khoá của bảng trả lời là một hàng đợi kết quả theo lần gọi.
      const r2 = await run(tagged, { 'tags:5,6': [['t-2']], friendPages: [[{ userId: 't-1', displayName: 'Một' }, { userId: 'T-2', displayName: 'Hai' }]] })
      // Như getZaloFriendSourceTagLogLabel: tên lấy theo vị trí trong danh sách tag đã bỏ trùng trên mảng tên gốc (chưa bỏ trùng).
      assert.deepEqual(r2.lines.slice(0, 6), ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"', '🔄 Đang lấy danh sách hội thoại trong 2 tag Zalo: VIP, VIP',
        '⏳ Chờ 2.0 giây trước khi đọc danh sách tag Zalo...', '🔄 Đang quét danh sách bạn bè Zalo live để lọc theo tag',
        '⏳ Chờ 2.0 giây trước khi đọc trang 1 danh sách bạn bè Zalo...', '✅ Đã thêm 1 bạn bè Zalo vào chiến dịch "Lấy data"'])
      assert.deepEqual((await inputs(tagged)).map(x => x.uid), ['T-2'], 'lọc theo tag, so UID không phân biệt hoa thường')

      const notag = await make({ actionId: FRIEND, extra: { zaloFriendTargetMode: 'tagged_friends' } })
      const r3 = await run(notag, {})
      assert.deepEqual(r3.lines, ['🚀 Bắt đầu chiến dịch "Lấy data" trên tài khoản "Zalo"', '⚠️ Chưa chọn tag nguồn Zalo để lấy danh sách bạn bè',
        '⚠️ Không lấy được bạn bè Zalo nào để gửi tin'])
      assert.deepEqual(await camp(notag).then(x => [x.status, x.note]), ['chờ xử lý', 'Không lấy được bạn bè Zalo nào để gửi tin'])
      const r4 = await run(notag, {})
      assert.deepEqual(r4.lines, [], 'câu chờ không đổi: không in lại mỗi lần quét')

      const bad = await make({ actionId: FRIEND, extra: { zaloFriendTargetMode: 'tagged_friends', zaloFriendSourceTagIds: ['9'] } })
      const r5 = await run(bad, { 'tags:9': new E.ZaloSourceTagError('Tag Zalo không tồn tại') })
      assert.equal(r5.result.reason, 'config_invalid')
      assert.ok(r5.lines.includes('⚠️ Lượt chạy gặp lỗi: Tag Zalo không tồn tại'))
      assert.deepEqual(await camp(bad).then(x => [x.status, x.note]), ['tạm dừng', 'Lượt chạy gặp lỗi: Tag Zalo không tồn tại'])

      const empty = await make({ actionId: FRIEND, extra: { zaloFriendTargetMode: 'all_friends' } })
      const r6 = await run(empty, { friendPages: [[]] })
      assert.deepEqual(r6.lines.slice(-2), ['✅ Đã thêm 0 bạn bè Zalo vào chiến dịch "Lấy data"', '⚠️ Không lấy được bạn bè Zalo nào để gửi tin'])
      assert.ok((await camp(empty)).extra_settings.zaloFriendDataMaterializedAt, 'đã lấy một lần (dù không có ai)')
      const r7 = await run(empty, {})
      assert.deepEqual(r7.calls, [], 'đã lấy một lần: không đọc lại')
      assert.deepEqual(r7.lines, ['⚠️ Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy'])
      assert.deepEqual(await camp(empty).then(x => [x.status, x.note]), ['chờ xử lý', 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy'])

      // Gửi dạng chia sẻ + toàn bộ bạn bè: lấy data đầu lượt rồi chia sẻ cả lô (như Desktop lấy trước khi vào lô).
      const share = await make({ actionId: FRIEND, content: 'Tin chia sẻ', extra: { ...limits, zaloFriendTargetMode: 'all_friends', zaloMessageSendMode: 'share' } })
      assert.deepEqual(E.zaloCampaignV2Support({ id: share.campaign, actionId: FRIEND, accountId: share.account, content: 'x', extraSettings: share.extra,
        images: [], dataTargetSourceMode: null }, { engagementTrackingEnabled: false }), { ok: true })
      const rs = await run(share, { friendPages: [[{ userId: 's-1', displayName: 'Sơn' }, { userId: 's-2', displayName: 'Sang' }]] })
      assert.ok(rs.lines.includes('✅ Đã thêm 2 bạn bè Zalo vào chiến dịch "Lấy data"'), JSON.stringify({ lines: rs.lines, result: rs.result }))
      assert.deepEqual(rs.calls.filter(x => x.startsWith('forward:')), ['forward:s-1,s-2'], rs.calls.join('\n'))
      assert.deepEqual((await inputs(share)).map(x => x.status), ['hoàn thành', 'hoàn thành'])

      const tagsEmpty = await make({ actionId: FRIEND, extra: { zaloFriendTargetMode: 'tagged_friends', zaloFriendSourceTagIds: ['5'] } })
      const r8 = await run(tagsEmpty, { 'tags:5': [[]] })
      assert.ok(r8.lines.includes('⚠️ Các tag Zalo đã chọn chưa có bạn bè nào'), r8.lines.join('\n'))
      assert.equal((await camp(tagsEmpty)).extra_settings.zaloFriendMaterializedCount, 0)
    }
    pass('bạn bè: toàn bộ / theo tag lấy một lần (lọc tag, bỏ trùng, tên như Desktop); chưa chọn tag → chờ kèm câu (không in lại); tag hỏng → tạm dừng chiến dịch; không có ai → chờ, lượt sau "đã lấy một lần nhưng chưa có data"; gửi dạng chia sẻ: lấy data rồi chia sẻ cả lô')

    console.log(`OK V505: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
