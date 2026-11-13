// V515: ba lỗi engine v2 của bộ kịch bản 13/11/2026 (docs/CAMPAIGN_OUTCOME_ENGINE_SCENARIO_TEST.md, mục B, C, D). Chạy lõi thật
// (packages/campaign-engine) + cổng Zalo giả trên PostgreSQL 17 cục bộ có đủ chuỗi V495 → … → V507; mỗi lỗi chạy trước V515 (phải thấy
// lỗi) và sau V515 (hết lỗi). Mất câu trả lời giả lập bằng cách gọi RPC thật rồi ném "fetch failed" cho lõi (lõi gửi lại như thật).
//   B: mất câu trả lời của lần báo chốt data (gửi thường và gửi dạng chia sẻ theo lô) → trước: lượt dừng 'ownership_lost', không nhả lease.
//   D: data từng về hàng đợi kèm ghi chú (NET01) rồi gửi thành công → trước: giữ ghi chú cũ.
//   C: mất câu trả lời của claim giữa lượt → trước: pg_cron đóng data "hoàn thành" SYS01 dù chưa gửi.
// Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v515-smoke.cjs
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
const v506 = require('./build-v506-sql.cjs')
const v507 = require('./build-v507-sql.cjs')
const v515 = require('./build-v515-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V515_TEST_PORT || 55515)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v515-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

const HEARTBEAT_MS = 61000
function testClock() {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms === HEARTBEAT_MS) return signal?.addEventListener('abort', () => resolve(false), { once: true })
      setImmediate(() => resolve(!signal?.aborted))
    })
  }
}

const PHONE = 'zalo_message_phone'
const GROUP = 'zalo_message_group'
const STRANGER = 'zalo_message_stranger'
const ROLES = ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']
const OLD_NOTE = 'Mất kết nối tới Zalo, tạm ngưng tài khoản tới 02:28 13/11 (NET01)'
const once = predicate => { let fired = false; return (...args) => { if (fired || !predicate(...args)) return false; fired = true; return true } }
const lost = () => new Error('fetch failed')

async function main() {
  const E = await loadEngine()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v515-' })
  const db = await connect()
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v515.NAME}.sql`), 'utf8'), v515.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v515.ROLLBACK_NAME}.sql`), 'utf8'), v515.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506, v507]) await db.query(m.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r

    // ---- Cổng dữ liệu thật, có tiêm lỗi "mất câu trả lời" ---------------------------------------------------------------------
    const faults = {}
    const seen = { report: [], lost: [], batch: [], lostBatch: [] }
    const data = {
      claimTarget: async ctx => {
        const res = await rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)])
        if (faults.claim?.(res)) throw lost()
        return res
      },
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: async (id, tok, action, step) => {
        if (faults.mark?.(action, step)) throw Object.assign(new Error('permission denied for function aka_agent_engine_mark_sending_v1'), { code: '42501' })
        return rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step])
      },
      report: async (id, tok, outcomes, final) => {
        const res = await rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final])
        if (faults.report?.(res, final)) {
          seen.lost.push(res)
          await faults.beforeRetry?.(id)
          throw lost()
        }
        seen.report.push(res)
        return res
      },
      reportBatch: async (tok, items, size, stopped) => {
        const res = await rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r', [tok, JSON.stringify(items), size, stopped])
        if (faults.reportBatch?.(res)) { seen.lostBatch.push(res); throw lost() }
        seen.batch.push(res)
        return res
      },
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    const withFaults = async (f, fn) => {
      Object.assign(faults, f)
      for (const list of Object.values(seen)) list.length = 0
      try { return await fn() } finally { for (const k of Object.keys(faults)) delete faults[k] }
    }

    // ---- Chiến dịch và bộ chạy (lõi thật, cổng Zalo giả) -------------------------------------------------------------------------
    let nextId = 990000
    const STAFF = 9615, ORG = 715
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const make = async ({ actionId = PHONE, share = false, targets, extra = {} }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      const extraSettings = { enableMessage: true, ...(share ? { zaloMessageSendMode: 'share' } : {}),
        actionLimits: { byActionCode: { [actionId === GROUP ? GROUP : STRANGER]: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } }, ...extra }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
        extra_settings, images) OVERRIDING SYSTEM VALUE VALUES ($1, 'V515', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5,
        'Chào #{FULL_NAME}', $6::jsonb, '[]'::jsonb)`, [campaign, actionId, account, STAFF, ORG, JSON.stringify(extraSettings)])
      const ids = []
      for (const t of targets) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, uid, status, is_delete, note) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', false, $6)`, [id, campaign, t.name ?? 'Khách', t.phone ?? null, t.uid ?? null, t.note ?? null])
        ids.push(id)
      }
      return { account, campaign, ids, actionId, extra: extraSettings }
    }
    const zaloErr = (message, code, extra = {}) =>
      E.zaloPortErrorFrom(Object.assign(new Error(message), { code }, extra), { operation: 'send', answered: typeof code === 'number' })
    const run = async (c, b = {}) => {
      const calls = [], lines = []
      const port = {
        findUser: async (_ctx, phone) => {
          calls.push(`find:${phone}`)
          return E.normalizeZaloFoundUser({ userId: `uid-${phone}`, display_name: 'Lan', zalo_name: 'Lan', globalId: `g-${phone}` })
        },
        phoneSearchLimitScope: async () => null,
        saveFoundUser: async () => {},
        getUserProfile: async (_ctx, uid) => E.normalizeZaloFoundUser({ userId: uid, display_name: `Nhóm ${uid}` }),
        saveResolvedProfile: async () => {},
        isOptedOut: async () => false,
        prepareOptOutLink: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
        takeContentIndex: async () => 0,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid) => {
          calls.push(`text:${uid}`)
          const error = b.textError?.[uid]
          if (error) throw error
          return { response: { msgId: `m-${uid}` }, msgId: `m-${uid}` }
        },
        prepareMedia: async () => [], sendMedia: async () => { throw new Error('không có tệp') },
        forwardMessage: async (_ctx, input) => {
          calls.push(`forward:${input.threadIds.join(',')}`)
          return { response: { ok: true }, results: input.threadIds.map(id => ({ threadId: id, ok: true })) }
        },
        sendFriendRequest: async (_ctx, uid) => { calls.push(`friend:${uid}`); return {} },
        rewriteMessage: async (_ctx, content) => content,
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1
      }
      const core = { id: c.campaign, actionId: c.actionId, accountId: c.account, content: 'Chào #{FULL_NAME}', extraSettings: c.extra, images: [],
        dataTargetSourceMode: null }
      const type = E.zaloCampaignType(c.actionId)
      const shared = c.extra.zaloMessageSendMode === 'share'
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v515', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actionId: c.actionId,
        campaignName: 'V515', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => (shared ? [] : type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } })),
        ...(shared ? { batch: type.buildBatch(core, port, { sleepBetweenBatchesSeconds: 0, readTimeoutMs: 5000, mediaTimeoutMs: 5000, sendTimeoutMs: 5000 }) } : {}),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [c.account, info.leaseToken, info.note ?? null]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      return { result, calls, lines }
    }
    const input = id => rows(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [id]).then(r => r[0])
    const details = id => rows(`SELECT action_code, status FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [id])
      .then(r => r.map(d => [d.action_code, d.status]))
    const leases = account => val(`SELECT count(*)::int FROM public.auto_engine_leases WHERE account_id = $1 AND expires_at > now()`, [account])
    const used = account => val(`SELECT count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = $2`, [account, STRANGER])
    // Thời gian trôi cho pg_cron: lease hết hạn quá 10 phút, lượt data mở từ hơn 10 phút trước.
    const age = async account => {
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '11 minutes' WHERE account_id = $1`, [account])
      await db.query(`UPDATE public.auto_engine_target_runs SET started_at = started_at - interval '11 minutes' WHERE account_id = $1 AND completed_at IS NULL`, [account])
    }
    const closeStale = () => val('SELECT public.aka_agent_engine_close_stale_v1(200)')
    const setting = value => db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = $2`, [value, v515.SETTING])
    const unlock = account => db.query(`DELETE FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable`, [account])
    const md5s = async () => {
      const out = {}
      for (const [k, sig] of Object.entries(v515.SIG)) out[k] = await val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = $1::regprocedure`, [sig])
      return out
    }
    const privileges = async () => {
      const out = {}
      for (const [k, sig] of Object.entries(v515.SIG)) for (const role of ROLES) {
        out[`${k}:${role}`] = await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, sig])
      }
      return out
    }
    const state = async () => ({
      md5: await md5s(),
      column: await val(`SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_engine_target_runs'
        AND column_name = 'final_response'`),
      setting: await val(`SELECT value FROM public.auto_system_settings WHERE key = $1`, [v515.SETTING])
    })

    // Kịch bản dùng chung trước / sau V515.
    const scenarioB = async () => {
      const c = await make({ targets: [{ phone: '0915000001' }, { phone: '0915000002' }] })
      const r = await withFaults({ report: once((_res, final) => final) }, () => run(c))
      return { c, r, lostRes: seen.lost[0], retried: seen.report.find(x => x.replay === true) ?? null }
    }
    const scenarioShare = async () => {
      const c = await make({ actionId: GROUP, share: true, targets: [{ name: 'Nhóm A', uid: 'g7101' }, { name: 'Nhóm B', uid: 'g7102' }] })
      const r = await withFaults({ reportBatch: once(() => true) }, () => run(c))
      return { c, r, lostRes: seen.lostBatch[0], retried: seen.batch[0] ?? null }
    }
    const scenarioD = async () => {
      const c = await make({ targets: [{ phone: '0915000003', note: OLD_NOTE }] })
      await run(c)
      return { c, row: await input(c.ids[0]) }
    }
    // Claim lần 2 của lượt (data thứ hai) mất câu trả lời: lõi claim lại và nhận data thứ ba; data thứ hai bị bỏ "đang chạy".
    const scenarioC = async () => {
      const c = await make({ targets: [{ phone: '0915000004' }, { phone: '0915000005' }, { phone: '0915000006' }] })
      let claims = 0
      const r = await withFaults({ claim: res => res?.status === 'claimed' && ++claims === 2 }, () => run(c))
      const abandoned = c.ids[1]
      const before = await input(abandoned)
      await age(c.account)
      await closeStale()
      return { c, r, before, after: await input(abandoned) }
    }
    // Lượt data đã có kết quả (tra số xong) rồi bộ chạy chết trước khi ghi dấu "sắp gửi" của bước nhắn tin.
    const scenarioC2 = async () => {
      const c = await make({ targets: [{ phone: '0915000007' }] })
      const r = await withFaults({ mark: action => action === STRANGER }, () => run(c))
      const before = await input(c.ids[0])
      await age(c.account)
      await closeStale()
      return { c, r, before, after: await input(c.ids[0]) }
    }

    // ---- 1. Trước V515: tái hiện đủ ba lỗi -------------------------------------------------------------------------------------
    const s0 = await state()
    assert.deepEqual(s0, { md5: v515.LIVE, column: 0, setting: 'complete' })
    const privBefore = await privileges()

    const b0 = await scenarioB()
    assert.equal(b0.r.result.reason, 'ownership_lost', 'trước V515: gọi lại lần chốt data bị trả "mất quyền"')
    assert.equal(b0.lostRes.next, 'next_target')
    assert.deepEqual(await input(b0.c.ids[1]), { status: 'chờ xử lý', note: null }, 'data sau không được chạy')
    assert.equal(await leases(b0.c.account), 1, 'lượt dừng không nhả lease: tài khoản đứng tới khi lease hết hạn')
    const share0 = await scenarioShare()
    assert.equal(share0.r.result.reason, 'ownership_lost', 'trước V515: gửi chia sẻ theo lô cũng dừng "mất quyền"')
    assert.equal(share0.retried.next, 'ownership_lost')
    assert.equal(await leases(share0.c.account), 1)
    const d0 = await scenarioD()
    assert.deepEqual(d0.row, { status: 'hoàn thành', note: OLD_NOTE }, 'trước V515: gửi thành công vẫn giữ ghi chú cũ')
    const c0 = await scenarioC()
    assert.equal(c0.before.status, 'đang chạy')
    assert.equal(c0.after.status, 'hoàn thành', 'trước V515: data chưa gửi bị đóng "hoàn thành"')
    assert.match(c0.after.note, /\(SYS01\)$/)
    assert.ok(!c0.r.calls.includes('text:uid-0915000005'), 'data bị bỏ chưa từng được gửi')
    pass('trước V515 tái hiện đủ: B (gọi lại lần chốt → "mất quyền", không nhả lease, cả gửi chia sẻ), D (giữ ghi chú cũ), C (data chưa gửi bị đóng SYS01)')

    // ---- 2. Apply / chặn chạy lại -------------------------------------------------------------------------------------------------
    await db.query(v515.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await state(), s0, 'apply trong transaction rồi ROLLBACK không để lại gì')
    await db.query(v515.migration)
    assert.deepEqual(await state(), { md5: v515.NEW, column: 1, setting: 'requeue_unstarted' })
    assert.deepEqual(await privileges(), privBefore, 'quyền của 2 hàm giữ nguyên')
    await assert.rejects(db.query(v515.migration), /V515 đã chạy/)
    await db.query('ROLLBACK')
    pass('apply trong transaction rồi ROLLBACK không đổi gì; apply thật đổi đúng 2 hàm, thêm cột, đổi thiết lập; quyền giữ nguyên; chạy lại bị chặn')

    // ---- 3. Sau V515: B ---------------------------------------------------------------------------------------------------------
    const b1 = await scenarioB()
    assert.equal(b1.r.result.reason, 'no_target', JSON.stringify(b1.r.result))
    assert.ok(b1.retried, 'lần gọi lại nhận câu trả lời gọi lại')
    const strip = res => { const { outcomes: _o, replay: _r, ...rest } = res; return rest }
    assert.deepEqual(strip(b1.retried), strip(b1.lostRes), 'gọi lại nhận đúng câu trả lời lần đầu (chỉ thị, nghỉ, data, chiến dịch, chuỗi lỗi)')
    assert.deepEqual(b1.retried.outcomes, b1.lostRes.outcomes.map(o => ({ ...o, replay: true })))
    assert.deepEqual(b1.r.calls, ['find:0915000001', 'text:uid-0915000001', 'find:0915000002', 'text:uid-0915000002'], 'mỗi data gửi đúng một lần')
    for (const id of b1.c.ids) {
      assert.deepEqual(await input(id), { status: 'hoàn thành', note: null })
      assert.deepEqual(await details(id), [['zalo_find_phone_user', 'thành công'], [STRANGER, 'thành công']], 'không ghi lặp lịch sử')
    }
    assert.equal(Number(await used(b1.c.account)), 2, 'không tính lượt hai lần')
    assert.equal(await leases(b1.c.account), 0, 'lượt nhả lease bình thường')
    const stored = await val(`SELECT final_response FROM public.auto_engine_target_runs WHERE input_data_id = $1`, [b1.c.ids[0]])
    assert.equal(stored.next, 'next_target')
    assert.ok(!('outcomes' in stored), 'không lưu danh sách kết quả (dựng lại từ auto_engine_outcomes)')
    // Lease đã hết hạn lúc gọi lại: vẫn là mất quyền thật (đi đường cũ).
    const expired = await make({ targets: [{ phone: '0915000008' }, { phone: '0915000009' }] })
    const r2 = await withFaults({
      report: once((_res, final) => final),
      beforeRetry: () => db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 second' WHERE account_id = $1`, [expired.account])
    }, () => run(expired))
    assert.equal(r2.result.reason, 'ownership_lost', 'lease hết hạn thì gọi lại vẫn là mất quyền')
    assert.equal(seen.report.at(-1)?.next, 'ownership_lost')
    const share1 = await scenarioShare()
    assert.notEqual(share1.r.result.reason, 'ownership_lost', JSON.stringify(share1.r.result))
    assert.ok(share1.retried.items.every(item => item.response.replay === true), 'mọi data của lô nhận câu trả lời gọi lại')
    assert.deepEqual(share1.r.calls, ['forward:7101,7102'], 'lô chỉ chia sẻ một lần')
    assert.equal(await leases(share1.c.account), 0)
    for (const id of share1.c.ids) assert.equal((await input(id)).status, 'hoàn thành')
    pass('sau V515, B: gọi lại lần chốt data khi lease còn hạn nhận đúng câu trả lời lần đầu, lượt chạy tiếp, nhả lease, không gửi / ghi / tính lượt lặp; lease hết hạn vẫn là mất quyền; gửi chia sẻ theo lô cũng vậy')

    // ---- 4. Sau V515: D ---------------------------------------------------------------------------------------------------------
    const d1 = await scenarioD()
    assert.deepEqual(d1.row, { status: 'hoàn thành', note: null }, 'gửi thành công xoá ghi chú cũ')
    // Dòng đời thật: lần đầu lỗi mạng trước khi gửi (NET01, về hàng đợi kèm ghi chú), hết khoá thì gửi thành công.
    const flow = await make({ targets: [{ phone: '0915000010' }] })
    await run(flow, { textError: { 'uid-0915000010': zaloErr('connect ECONNREFUSED 10.0.0.1:443', 'ECONNREFUSED', { syscall: 'connect' }) } })
    const requeued = await input(flow.ids[0])
    assert.equal(requeued.status, 'chờ xử lý')
    assert.match(requeued.note, /\(NET01\)$/)
    await unlock(flow.account)
    await run(flow)
    assert.deepEqual(await input(flow.ids[0]), { status: 'hoàn thành', note: null }, 'lần sau thành công: không còn ghi chú NET01')
    // Thất bại thì ghi chú là câu lỗi của lượt này (như trước).
    const failed = await make({ targets: [{ phone: '0915000011', note: OLD_NOTE }] })
    await run(failed, { textError: { 'uid-0915000011': zaloErr('Người nhận chặn', 122) } })
    const failedRow = await input(failed.ids[0])
    assert.equal(failedRow.status, 'hoàn thành')
    assert.match(failedRow.note, /\(Z122\)$/)
    pass('sau V515, D: gửi thành công xoá ghi chú cũ (kể cả ghi chú NET01 của lần về hàng đợi trước); thất bại ghi câu lỗi của lượt này')

    // ---- 5. Sau V515: C ---------------------------------------------------------------------------------------------------------
    const c1 = await scenarioC()
    assert.equal(c1.before.status, 'đang chạy')
    assert.equal(c1.after.status, 'chờ xử lý', 'data chưa có kết quả nào về hàng đợi')
    assert.match(c1.after.note, /\(SYS01\)$/)
    assert.equal(await leases(c1.c.account), 0, 'pg_cron nhả lease của lượt cũ')
    await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute' WHERE id = $1`, [c1.c.campaign])
    const again = await run(c1.c)
    assert.deepEqual(again.calls, ['find:0915000005', 'text:uid-0915000005'], 'lần sau gửi data đó đúng một lần')
    assert.deepEqual(await input(c1.c.ids[1]), { status: 'hoàn thành', note: null })
    // Lượt data đã có kết quả (tra số xong) mà chưa có dấu "sắp gửi": vẫn đóng như 'complete'.
    const c2 = await scenarioC2()
    assert.equal(c2.before.status, 'đang chạy')
    assert.deepEqual(await details(c2.c.ids[0]), [['zalo_find_phone_user', 'thành công']])
    assert.equal(c2.after.status, 'hoàn thành', 'lượt đã có kết quả không về hàng đợi')
    assert.match(c2.after.note, /\(SYS01\)$/)
    // 'requeue' giữ nghĩa cũ (mọi lượt chưa có dấu), 'complete' giữ nghĩa cũ (đóng hết).
    await setting('requeue')
    const c3 = await scenarioC2()
    assert.equal(c3.after.status, 'chờ xử lý', "'requeue': lượt đã có kết quả cũng về hàng đợi (như trước V515)")
    await setting('complete')
    const c4 = await scenarioC()
    assert.equal(c4.after.status, 'hoàn thành', "'complete': data dở luôn đóng (như trước V515)")
    await setting('requeue_unstarted')
    pass("sau V515, C: data bị bỏ do mất câu trả lời của claim về hàng đợi (SYS01) rồi gửi đúng một lần; lượt đã có kết quả vẫn đóng; 'requeue' và 'complete' giữ nghĩa cũ")

    // ---- 6. Gỡ: trả đúng như trước, lỗi B quay lại; apply lại được -------------------------------------------------------------------
    await db.query(v515.rollback)
    assert.deepEqual(await state(), s0)
    assert.deepEqual(await privileges(), privBefore)
    const b2 = await scenarioB()
    assert.equal(b2.r.result.reason, 'ownership_lost', 'sau khi gỡ: hành vi trước V515')
    await assert.rejects(db.query(v515.rollback), /chưa có V515/)
    await db.query('ROLLBACK')
    await db.query(v515.migration)
    assert.deepEqual(await state(), { md5: v515.NEW, column: 1, setting: 'requeue_unstarted' })
    pass('gỡ trả thân 2 hàm, thiết lập, xoá cột; quyền giữ nguyên; hành vi trước V515 quay lại; gỡ lần hai bị chặn; apply lại được')

    console.log(`OK V515: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
