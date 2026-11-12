// Lõi packages/campaign-engine: kiểm thử đơn vị với cổng giả + tích hợp runUnit với RPC V495 thật trên PG17 cục bộ
// và adapter Zalo giả. Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-core-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')

const PORT = Number(process.env.V495_CORE_TEST_PORT || 55498)
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const out = fs.mkdtempSync(path.join((fs.mkdirSync(path.join(ROOT, 'node_modules', '.cache'), { recursive: true }), path.join(ROOT, 'node_modules', '.cache')), 'aka-engine-core-')) // trong repo: lõi import htmlparser2 từ node_modules
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return { engine: await import(pathToFileURL(path.join(out, 'index.js')).href), out }
}

/** Đồng hồ thử: mọi lần nghỉ trả về ngay và được ghi lại, trừ nhịp heartbeat (chờ tới khi bị huỷ). */
function testClock(heartbeatMs = 60000) {
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
function collector() {
  const lines = [], traces = []
  return { lines, traces, events: { progress: l => lines.push(l), trace: e => traces.push(e) } }
}
const transient = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })

async function unitTests(E) {
  await assert.rejects(E.withDeadline('chậm', 20, undefined, () => new Promise(() => {})), err => err instanceof E.DeadlineError)
  const parent = new AbortController()
  const pending = E.withDeadline('huỷ', 5000, parent.signal, () => new Promise(() => {}))
  parent.abort()
  await assert.rejects(pending, err => err instanceof E.CancelledError)
  assert.equal(await E.withDeadline('nhanh', 1000, undefined, async () => 7), 7)
  let innerAborted = false
  await assert.rejects(E.withDeadline('abort-con', 20, undefined, s => new Promise(() => { s.addEventListener('abort', () => { innerAborted = true }) })))
  assert.equal(innerAborted, true)
  pass('withDeadline: hết giờ, huỷ từ cha, thành công; signal của lời gọi bị abort khi hết giờ')

  for (const e of [{ code: 'ECONNRESET' }, { code: 'PGRST002' }, { code: '57014' }, { status: 503 }, new Error('TypeError: fetch failed'), new E.DeadlineError('x', 1)]) {
    assert.equal(E.isTransientDbError(e), true, JSON.stringify(e))
  }
  for (const e of [{ code: '23505' }, { code: '42501' }, new Error('violates check constraint'), new E.CancelledError('x')]) assert.equal(E.isTransientDbError(e), false)
  pass('phân loại lỗi DB tạm thời (mạng, PGRST002, 57014, 5xx, timeout) với lỗi cứng (23505, 42501, CHECK)')

  const s = { fullSeconds: 120 }
  assert.equal(E.paceDelayMs({ mode: 'full', seconds: null }, s), 120000)
  assert.equal(E.paceDelayMs({ mode: 'none', seconds: null }, s), 0)
  assert.equal(E.paceDelayMs({ mode: 'short', seconds: null }, s), 5000)
  assert.equal(E.paceDelayMs({ mode: 'full', seconds: 30 }, s), 30000)
  assert.equal(E.paceDelayMs(null, s), 0)
  // Nghỉ ngắn không dài hơn "Nghỉ giữa 2 lần" của khách.
  assert.equal(E.paceDelayMs({ mode: 'short', seconds: 90 }, s), 90000)
  assert.equal(E.paceDelayMs({ mode: 'short', seconds: 90 }, { fullSeconds: 30 }), 30000)
  assert.equal(E.paceDelayMs({ mode: 'short', seconds: null }, { fullSeconds: 0 }), 0)
  pass('nghỉ giữa 2 lần theo pace_mode (full/short/none, số giây của chính sách; nghỉ ngắn không vượt cấu hình của khách)')

  const web = E.validateZaloContent({ zaloWeb: true, attachments: ['https://cdn/a.JPG?x=1', 'C:\\files\\report.pdf'] })
  assert.equal(web.length, 1); assert.equal(web[0].publicCode, 'CFG10'); assert.match(web[0].message, /report\.pdf/)
  assert.deepEqual(E.validateZaloContent({ zaloWeb: true, attachments: ['data:image/png;base64,AAA'] }), [])
  assert.equal(E.validateZaloContent({ zaloWeb: false, attachments: ['a', 'b', 'c'], limits: { maxFile: 2 } })[0].publicCode, 'CFG11')
  assert.equal(E.validateZaloContent({ zaloWeb: false, attachments: ['setup.EXE'], limits: { restrictedExtensions: ['.exe'] } })[0].publicCode, 'CFG12')
  assert.equal(E.validateFacebookMedia({ campaignActionId: 'facebook_page_post', pagePostMode: 'api', media: ['v.mp4'] })[0].publicCode, 'CFG14')
  assert.equal(E.validateFacebookMedia({ campaignActionId: 'facebook_group_post', media: ['https://cdn/no-extension'] })[0].publicCode, 'CFG15')
  assert.deepEqual(E.validateFacebookMedia({ campaignActionId: 'facebook_group_post', media: ['a.webp', 'b.mov'] }), [])
  assert.deepEqual(E.missingTemplateFields('Chào #{INPUT_FULLNAME}, mã #{INFO2} #{FULL_NAME}', { name: 'An', info2: ' ' }), ['#{INFO2}'])
  const cfg13 = E.validateRenderedTargetContent('  ', [], '#{INFO1}', { info1: '' })
  assert.equal(cfg13[0].publicCode, 'CFG13'); assert.equal(cfg13[0].scope, 'target')
  pass('luật kiểm cấu hình dùng chung: CFG10–CFG15 khớp luật đang chạy ở zaloRuntimeService/campaignScheduler')

  const { lines, traces, events } = collector()
  const journal = new E.MemoryJournal()
  let calls = 0
  const flaky = { report: async () => { calls++; if (calls <= 2) throw transient(); return { ok: true, outcomes: [] } } }
  const clock = testClock()
  const reporter = new E.OutcomeReporter({ data: flaky, journal, clock, events }, { callTimeoutMs: 1000, backoffMs: [10, 20] },
    { onOutage: () => lines.push('outage'), onRecovered: () => lines.push('recovered') })
  const res = await reporter.report(1, 'tok', [{ resultKey: 'v2:1:step', actionCode: 'zalo_message_stranger', stepKey: 'step', ok: true, phase: 'after_send' }], false, new AbortController().signal)
  assert.equal(res.ok, true); assert.equal(calls, 3); assert.equal(journal.size, 0)
  assert.deepEqual(lines, ['outage', 'outage', 'recovered']); assert.deepEqual(clock.sleeps, [10, 20])
  const stuck = { report: async () => { throw transient() } }
  const stop = new AbortController()
  const r2 = new E.OutcomeReporter({ data: stuck, journal, clock: { now: () => 1, sleep: async () => { stop.abort(); return false } }, events },
    { callTimeoutMs: 1000, backoffMs: [10] })
  await assert.rejects(r2.report(2, 'tok', [{ resultKey: 'v2:2:step', actionCode: 'x', stepKey: 'step', ok: true, phase: 'after_send' }], true, stop.signal),
    err => err instanceof E.CancelledError)
  assert.equal(journal.size, 1)
  const sent = []
  const healthy = new E.OutcomeReporter({ data: { report: async (...a) => { sent.push(a); return { ok: true, outcomes: [] } } }, journal, clock, events },
    { callTimeoutMs: 1000, backoffMs: [10] })
  assert.deepEqual(await healthy.flush(new AbortController().signal), { sent: 1, rejected: 0 })
  assert.equal(journal.size, 0); assert.equal(sent[0][0], 2); assert.equal(sent[0][3], true)
  void traces
  pass('báo kết quả: ghi nhật ký trước, DB lỗi tạm thời thì chờ có backoff rồi gửi tiếp; bị dừng thì giữ trong nhật ký và gửi bù khi chạy lại')

  // deliver(): dấu "sắp gửi" luôn trước lời gọi gửi; mất quyền thì không gọi gửi và không nhả lease của người khác.
  const order = []
  const port = {
    claimTarget: async () => ({ status: 'claimed', targetRunId: 9, leaseToken: 't9', leaseExpiresAt: '', target: { id: 1, campaign_id: 1 }, targetKey: null,
      actions: {}, campaign: { id: 1, actionId: 'x', status: 'đang chạy' } }),
    markSending: async () => { order.push('mark'); return { ok: false, reason: 'ownership_lost' } },
    report: async () => { order.push('report'); return { ok: true } },
    heartbeat: async () => ({ ok: true }),
    release: async () => { order.push('release'); return { ok: true } }
  }
  const c2 = collector()
  const result = await E.runUnit({ data: port, journal: new E.MemoryJournal(), clock: testClock(), events: c2.events }, {
    runnerId: 'test', runtimeTarget: 'fly', staffId: 1, accountId: 1, campaignId: 1, actions: [{ code: 'zalo_message_stranger' }],
    buildSteps: () => [{ key: 'message', actionCode: 'zalo_message_stranger', delivery: true, run: async () => { order.push('send'); return { ok: true } } }],
    pacing: { fullSeconds: 0 }, stepTimeoutMs: 1000, heartbeatMs: 60000
  }, new AbortController().signal)
  assert.equal(result.reason, 'ownership_lost'); assert.deepEqual(order, ['mark']); assert.equal(result.released, false)
  pass('deliver(): ghi dấu "sắp gửi" trước; DB báo mất quyền thì không gọi Zalo gửi, không nhả lease')

  // Cổng kiểm: qua thì không báo gì (không lịch sử); chặn thì báo đúng một kết quả và DB chốt data.
  const gateRun = async blocked => {
    const reports = []
    const calls = []
    let claims = 0
    const gatePort = {
      claimTarget: async () => (++claims === 1
        ? { status: 'claimed', targetRunId: 5, leaseToken: 't5', leaseExpiresAt: '', target: { id: 7, campaign_id: 1 }, targetKey: null,
            actions: { zalo_message_stranger: { decision: 'skip', gate: 'target_memory', required: true } }, campaign: { id: 1, actionId: 'x', status: 'đang chạy' } }
        : { status: 'no_target', leaseToken: 't5', nextSchedule: null, runningTargets: 0 }),
      markSending: async (_id, _tok, _action, step) => { calls.push('mark:' + step); return { ok: true } },
      report: async (_id, _tok, outcomes, final) => {
        reports.push({ keys: outcomes.map(o => o.stepKey), final })
        const done = final || outcomes.some(o => !o.ok)
        return { ok: true, next: done ? 'next_target' : 'next_step', pace: null, outcomes: [], target: { done, status: done ? 'tạm dừng' : null, note: null, schedule: null },
          campaign: { effect: 'none', note: null }, account: { effect: 'none', loginEffect: 'none' }, safety: [] }
      },
      heartbeat: async () => ({ ok: true }),
      release: async () => { calls.push('release'); return { ok: true } }
    }
    const res = await E.runUnit({ data: gatePort, journal: new E.MemoryJournal(), clock: testClock(), events: collector().events }, {
      runnerId: 'test', runtimeTarget: 'fly', staffId: 1, accountId: 1, campaignId: 1, actions: [{ code: 'zalo_message_stranger' }],
      buildSteps: () => [
        { key: 'lookup', actionCode: 'zalo_find_phone_user', delivery: false, run: async () => { calls.push('lookup'); return { ok: true, state: { uid: 'u1' } } } },
        // Cổng không chịu "bỏ qua" của thao tác nó canh (target_memory) và không ghi dấu "sắp gửi".
        { key: 'opt_out', actionCode: 'zalo_message_stranger', delivery: true, gate: true, requires: ['lookup'],
          run: async ctx => { calls.push('gate:' + ctx.state.uid + ':' + String(ctx.gate)); return blocked
            ? { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'recipient_opted_out' } } : { ok: true } } },
        { key: 'message', actionCode: 'zalo_add_friend', delivery: true, requires: ['opt_out'], run: async () => { calls.push('send'); return { ok: true } } }
      ],
      onNoTarget: async info => { calls.push('no_target:' + info.leaseToken); return { reason: 'completed' } },
      pacing: { fullSeconds: 0 }, stepTimeoutMs: 1000, heartbeatMs: 60000
    }, new AbortController().signal)
    return { res, reports, calls }
  }
  const pass1 = await gateRun(false)
  assert.deepEqual(pass1.calls, ['lookup', 'gate:u1:undefined', 'mark:message', 'send', 'no_target:t5', 'release'])
  assert.deepEqual(pass1.reports.map(r => r.keys.join(',')), ['lookup', 'message', ''])
  assert.equal(pass1.res.reason, 'no_target'); assert.deepEqual(pass1.res.detail.finished, { reason: 'completed' })
  const blocked = await gateRun(true)
  assert.deepEqual(blocked.calls, ['lookup', 'gate:u1:undefined', 'no_target:t5', 'release'])
  assert.deepEqual(blocked.reports.map(r => r.keys.join(',')), ['lookup', 'opt_out'])
  pass('cổng kiểm: qua thì không báo kết quả, không ghi dấu; chặn thì báo một kết quả, bước gửi sau không chạy; hết data gọi onNoTarget trước khi nhả lease')

  // onNoTarget lỗi: ghi vết, vẫn nhả lease; bị dừng thì không gọi.
  const nt = collector()
  const ntCalls = []
  const ntPort = {
    claimTarget: async () => ({ status: 'no_target', leaseToken: 't6', nextSchedule: null, runningTargets: 0 }),
    markSending: async () => ({ ok: true }), report: async () => ({ ok: true }), heartbeat: async () => ({ ok: true }),
    release: async () => { ntCalls.push('release'); return { ok: true } }
  }
  const ntRes = await E.runUnit({ data: ntPort, journal: new E.MemoryJournal(), clock: testClock(), events: nt.events }, {
    runnerId: 'test', runtimeTarget: 'fly', staffId: 1, accountId: 1, campaignId: 1, actions: [{ code: 'zalo_message_stranger' }], buildSteps: () => [],
    onNoTarget: async () => { ntCalls.push('hook'); throw new Error('db down') },
    pacing: { fullSeconds: 0 }, stepTimeoutMs: 1000, heartbeatMs: 60000
  }, new AbortController().signal)
  assert.equal(ntRes.reason, 'no_target'); assert.equal(ntRes.released, true); assert.deepEqual(ntCalls, ['hook', 'release'])
  assert.ok(nt.traces.some(t => t.type === 'on_no_target_failed'))
  pass('onNoTarget lỗi chỉ ghi vết; lease vẫn được nhả')
}

// ---------------------------------------------------------------------------------------------
async function integration(E) {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-engine-core-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows

    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    let failNext = 0
    let dead = false
    const guard = async fn => {
      if (dead) throw Object.assign(new Error('process killed'), { code: 'XX000' })
      if (failNext > 0) { failNext--; throw transient() }
      return fn()
    }
    const port = {
      claimTarget: (ctx) => guard(() => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)])),
      markSending: (id, tok, action, step) => guard(() => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step])),
      report: (id, tok, outcomes, final) => guard(() => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final])),
      heartbeat: (acc, tok) => guard(() => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok])),
      release: (acc, tok) => guard(() => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok]))
    }

    let nextId = 800000
    const makeCampaign = async (phones, org = 601) => {
      const account = ++nextId, campaign = ++nextId, staff = 8001
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org test', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo test', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true)`, [account, staff, org])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Test', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4)`, [campaign, account, staff, org])
      const ids = {}
      for (const phone of phones) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Khách ${phone}`, phone])
        ids[phone] = id
      }
      return { account, campaign, staff, ids }
    }

    // Adapter Zalo giả: kịch bản theo SĐT; đếm số lần thực sự "gửi".
    const sends = new Map()
    const script = {}
    const zaloSteps = (hooks = {}) => target => {
      const plan = script[target.phone] || {}
      const send = key => sends.set(`${target.phone}:${key}`, (sends.get(`${target.phone}:${key}`) || 0) + 1)
      return [
        { key: 'lookup', actionCode: 'zalo_find_phone_user', delivery: false, run: async () => {
          hooks.lookup?.(target)
          if (plan.lookup === '216') return { ok: false, phase: 'after_send', signal: { kind: 'zalo_code', code: '216', message: 'User not found' } }
          return { ok: true, state: { uid: `uid-${target.phone}` }, customerLog: `Tìm thấy Zalo: ${target.name}` }
        } },
        { key: 'message', actionCode: 'zalo_message_stranger', delivery: true, requires: ['lookup'], run: async ctx => {
          assert.equal(ctx.state.uid, `uid-${target.phone}`)
          if (plan.message === 'throw') throw new TypeError('cannot read properties of undefined')
          send('message')
          hooks.afterMessage?.(target)
          if (plan.message === '122') return { ok: false, phase: 'after_send', signal: { kind: 'zalo_code', code: '122', message: 'blocked stranger' } }
          return { ok: true, customerLog: `Đã nhắn tin cho ${target.name}` }
        } },
        { key: 'friend', actionCode: 'zalo_add_friend', delivery: true, requires: ['lookup'], run: async () => {
          send('friend')
          return { ok: true, customerLog: `Đã gửi lời mời kết bạn tới ${target.name}` }
        } }
      ]
    }
    const unitConfig = (c, extra = {}) => ({
      runnerId: 'fly:test', runtimeTarget: 'fly', staffId: c.staff, accountId: c.account, campaignId: c.campaign,
      campaignName: 'Test', accountName: 'Zalo test',
      actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }],
      buildSteps: zaloSteps(), pacing: { fullSeconds: 120 }, stepTimeoutMs: 2000, heartbeatMs: 60000,
      retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }, ...extra
    })
    const run = async (c, extra = {}, journal = new E.MemoryJournal(), signal = new AbortController().signal) => {
      const clock = testClock(), col = collector()
      const result = await E.runUnit({ data: port, journal, clock, events: col.events }, unitConfig(c, extra), signal)
      return { result, clock, ...col, journal }
    }
    const target = id => db.query(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [id]).then(r => r.rows[0])
    const details = id => rows(`SELECT action_code, status, error_code FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [id])

    // I1: chạy bình thường 3 data.
    Object.assign(script, { '0901000001': {}, '0901000002': { lookup: '216' }, '0901000003': { message: '122' } })
    const c1 = await makeCampaign(['0901000001', '0901000002', '0901000003'])
    const r1 = await run(c1)
    assert.equal(r1.result.reason, 'no_target'); assert.equal(r1.result.targets, 3); assert.equal(r1.result.released, true)
    assert.deepEqual((await details(c1.ids['0901000001'])).map(d => d.status), ['thành công', 'thành công', 'thành công'])
    assert.deepEqual((await details(c1.ids['0901000002'])).map(d => [d.status, d.error_code]), [['không tồn tại', 'err_zalo_user_not_found']])
    assert.equal(sends.get('0901000002:message'), undefined, 'không tra được số thì không nhắn')
    assert.deepEqual((await details(c1.ids['0901000003'])).map(d => d.status), ['thành công', 'thất bại', 'thành công'])
    for (const id of Object.values(c1.ids)) assert.equal((await target(id)).status, 'hoàn thành')
    assert.deepEqual(r1.clock.sleeps, [120000, 120000], 'nghỉ sau data 1 và 2, không nghỉ sau data cuối')
    assert.ok(r1.lines.some(l => /\(Z216\)/.test(l.text)))
    // Như logHelperMilestoneProgress của Desktop: "<thao tác>: <câu>" (có dòng lịch sử thì không emoji), mã ngắn ở cuối.
    assert.ok(r1.lines.some(l => l.level === 'error' && /^[^❌⚠️].*: .*\(Z122\)$/u.test(l.text)), JSON.stringify(r1.lines.map(l => l.text)))
    assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c1.campaign]), 'chờ xử lý')
    pass('runUnit: 3 data (bình thường, 216, 122) đúng lịch sử/trạng thái; tra số hỏng thì bỏ các bước sau; chỉ nghỉ khi còn data; nhả lease cuối lượt')

    // I2: DB chập chờn giữa lượt: chờ và chạy tiếp, không ghi trùng.
    Object.assign(script, { '0902000001': {}, '0902000002': {} })
    const c2 = await makeCampaign(['0902000001', '0902000002'])
    let armed = false
    const r2 = await run(c2, { buildSteps: zaloSteps({ afterMessage: () => { if (!armed) { armed = true; failNext = 3 } } }) })
    assert.equal(r2.result.reason, 'no_target')
    assert.deepEqual((await details(c2.ids['0902000001'])).map(d => d.action_code), ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'])
    assert.equal(sends.get('0902000001:message'), 1)
    assert.ok(r2.lines.some(l => l.code === 'DB01')); assert.ok(r2.lines.some(l => /kết nối lại/.test(l.text)))
    assert.equal(r2.journal.size, 0)
    pass('DB chập chờn ngay sau khi gửi: hiện DB01, chờ rồi gửi bù đúng một lần, chạy tiếp data kế, nhật ký trống')

    // I3: app chết sau dấu "sắp gửi", mất nhật ký (Fly): pg_cron đóng SYS02, không gửi lại.
    Object.assign(script, { '0903000001': {}, '0903000002': {} })
    const c3 = await makeCampaign(['0903000001', '0903000002'])
    const r3 = await run(c3, { buildSteps: zaloSteps({ afterMessage: t => { if (t.phone === '0903000001') dead = true } }) })
    dead = false
    assert.equal(r3.result.reason, 'error')
    await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '20 minutes' WHERE account_id = $1`, [c3.account])
    await db.query(`UPDATE public.auto_engine_target_runs SET started_at = now() - interval '30 minutes' WHERE account_id = $1 AND completed_at IS NULL`, [c3.account])
    await db.query(`SELECT public.aka_agent_engine_close_stale_v1(50)`)
    const t31 = await target(c3.ids['0903000001'])
    assert.equal(t31.status, 'hoàn thành'); assert.match(t31.note, /\(SYS02\)$/)
    const r3b = await run(c3)
    assert.equal(r3b.result.reason, 'no_target'); assert.equal(r3b.result.targets, 1)
    assert.equal(sends.get('0903000001:message'), 1, 'data bị ngắt khi đang gửi không bao giờ gửi lại')
    assert.equal((await target(c3.ids['0903000002'])).status, 'hoàn thành')
    pass('app chết sau khi gửi, mất nhật ký: data đóng bằng SYS02, lượt sau chạy tiếp data khác, không gửi lại')

    // I4: app chết sau khi gửi, nhật ký còn (Desktop SQLite): gửi bù ghi đúng "đã nhắn tin".
    Object.assign(script, { '0904000001': {}, '0904000002': {} })
    const c4 = await makeCampaign(['0904000001', '0904000002'])
    const journal4 = new E.MemoryJournal()
    const r4 = await run(c4, { buildSteps: zaloSteps({ afterMessage: t => { if (t.phone === '0904000001') dead = true } }) }, journal4)
    dead = false
    assert.equal(r4.result.reason, 'error'); assert.equal(journal4.size, 1)
    await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '20 minutes' WHERE account_id = $1`, [c4.account])
    const r4b = await run(c4, {}, journal4)
    assert.equal(journal4.size, 0)
    assert.ok(r4b.traces.some(t => t.type === 'journal_flushed' && t.sent === 1))
    assert.deepEqual((await details(c4.ids['0904000001'])).map(d => d.action_code), ['zalo_find_phone_user', 'zalo_message_stranger'])
    assert.equal(sends.get('0904000001:message'), 1)
    assert.equal((await target(c4.ids['0904000002'])).status, 'hoàn thành')
    pass('app chết sau khi gửi, nhật ký còn: lần chạy sau gửi bù "đã nhắn tin" trước khi nhận việc mới, không gửi lại')

    // I5: lỗi cấu hình: dừng chiến dịch một lần, không đốt data, không gọi Zalo.
    Object.assign(script, { '0905000001': {} })
    const c5 = await makeCampaign(['0905000001'])
    const r5 = await run(c5, { validateCampaign: () => E.validateZaloContent({ zaloWeb: true, attachments: ['bao-gia.pdf'] }) })
    assert.equal(r5.result.reason, 'config_invalid')
    const camp5 = (await rows(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [c5.campaign]))[0]
    assert.equal(camp5.status, 'tạm dừng'); assert.match(camp5.note, /bao-gia\.pdf.*\(CFG10\)$/)
    assert.equal((await target(c5.ids['0905000001'])).status, 'chờ xử lý')
    assert.equal(sends.get('0905000001:message'), undefined)
    assert.equal((await details(c5.ids['0905000001'])).length, 0)
    pass('lỗi cấu hình (Zalo Web + PDF): chiến dịch tạm dừng một lần với câu chỉ đúng tệp (CFG10); data về hàng đợi; không gửi gì')

    // I6: người dùng dừng giữa data trước bước gửi: data về hàng đợi, nhả lease.
    Object.assign(script, { '0906000001': {}, '0906000002': {} })
    const c6 = await makeCampaign(['0906000001', '0906000002'])
    const stop6 = new AbortController()
    const r6 = await run(c6, { buildSteps: zaloSteps({ lookup: () => stop6.abort() }) }, new E.MemoryJournal(), stop6.signal)
    assert.equal(r6.result.reason, 'cancelled'); assert.equal(r6.result.released, true)
    assert.equal((await target(c6.ids['0906000001'])).status, 'chờ xử lý')
    assert.equal(sends.get('0906000001:message'), undefined)
    assert.equal(await val(`SELECT count(*) FROM public.auto_engine_leases WHERE account_id = $1`, [c6.account]), '0')
    pass('dừng giữa data trước khi gửi: báo "đã dừng", data về hàng đợi (không đốt), nhả lease')

    // I7: lỗi code trong bước gửi (sau dấu "sắp gửi"): không rõ đã gửi chưa → hoàn thành, không gửi lại; ghi "lỗi".
    Object.assign(script, { '0907000001': { message: 'throw' } })
    const c7 = await makeCampaign(['0907000001'])
    const r7 = await run(c7)
    assert.equal(r7.result.reason, 'no_target')
    const d7 = await details(c7.ids['0907000001'])
    assert.deepEqual(d7.map(d => [d.action_code, d.status, d.error_code]),
      [['zalo_find_phone_user', 'thành công', null], ['zalo_message_stranger', 'lỗi', 'err_undefined']])
    assert.equal((await target(c7.ids['0907000001'])).status, 'hoàn thành')
    assert.ok(r7.lines.some(l => l.level === 'warning' && /SYS99/.test(l.text)))
    pass('ngoại lệ trong bước gửi: ghi "lỗi" (SYS99), không rõ kết quả nên hoàn thành, các bước sau bị bỏ')

    // RPC trực tiếp: lô rỗng chỉ hợp lệ khi chốt, và không chốt data chưa có kết quả nào.
    Object.assign(script, { '0908000001': {} })
    const c8 = await makeCampaign(['0908000001'])
    const cl8 = await rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify({ staffId: c8.staff, accountId: c8.account,
      campaignId: c8.campaign, runnerId: 'x', runtimeTarget: 'fly', actions: [{ code: 'zalo_find_phone_user' }] })])
    const rep = (outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [cl8.targetRunId, cl8.leaseToken, JSON.stringify(outcomes), final])
    assert.equal((await rep([], false)).reason, 'outcomes_required')
    assert.equal((await rep([], true)).reason, 'no_outcomes')
    assert.equal((await target(c8.ids['0908000001'])).status, 'đang chạy')
    pass('report_v1: lô rỗng chỉ dùng để chốt; không bao giờ chốt data chưa có kết quả nào')

    // I9: nhớ mục tiêu hỏng (đề xuất #2 của bảng duyệt, áp trong DB thử): lần sau bỏ qua tra số và các bước phụ thuộc.
    await db.query(`UPDATE public.auto_outcome_policies SET remember_target_days = 30 WHERE source = 'seed_v495_error' AND error_code = 'err_zalo_user_not_found'`)
    Object.assign(script, { '0909000001': { lookup: '216' } })
    const c9a = await makeCampaign(['0909000001'], 777)
    await run(c9a)
    const c9b = await makeCampaign(['0909000001'], 777)
    const r9 = await run(c9b)
    assert.equal(r9.result.reason, 'no_target')
    assert.deepEqual((await details(c9b.ids['0909000001'])).map(d => [d.action_code, d.status]), [['zalo_find_phone_user', 'bỏ qua']])
    assert.equal((await target(c9b.ids['0909000001'])).status, 'hoàn thành')
    assert.equal(sends.get('0909000001:message'), undefined)
    const c9c = await makeCampaign(['0909000001'], 778)
    await run(c9c)
    assert.deepEqual((await details(c9c.ids['0909000001'])).map(d => d.status), ['không tồn tại'], 'tổ chức khác không dùng chung trí nhớ')
    pass('nhớ mục tiêu hỏng trong tổ chức: lần sau ghi "bỏ qua", không tra lại, không chạy bước phụ thuộc; tổ chức khác vẫn tra')
    await db.query(`UPDATE public.auto_outcome_policies SET remember_target_days = 0 WHERE source = 'seed_v495_error' AND error_code = 'err_zalo_user_not_found'`)

    await messagePhoneCases(E, { db, rpc, rows, val, port, nextId: () => ++nextId })
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

// ---------------------------------------------------------------------------------------------
// "Nhắn tin theo SĐT" với các bước thật của lõi (tách từ Desktop) + cổng Zalo giả, RPC V495 thật.
// Kỳ vọng (câu tiến trình, dòng lịch sử, trạng thái data) là hành vi chuẩn của bộ chạy Desktop/VPS.
async function messagePhoneCases(E, env) {
  const { db, rpc, rows, port } = env
  const support = (extra, more = {}) => E.zaloMessagePhoneV2Support({ id: 1, actionId: 'zalo_message_phone', accountId: 5, content: 'x',
    extraSettings: { enableMessage: true, ...extra }, images: [], dataTargetSourceMode: null, ...more }, { engagementTrackingEnabled: false })
  assert.deepEqual(support({}), { ok: true })
  assert.deepEqual(support({ enableMessage: false }), { ok: false, reason: 'no_send_step' })
  assert.deepEqual(support({}, { dataTargetSourceMode: 'data_group' }), { ok: true }, 'Nhóm data: claim / finish_campaign_v2 gọi hàm kết thúc của bản cũ (V501)')
  assert.deepEqual(support({ zaloOptOutLinkEnabled: true }), { ok: true }, 'link từ chối nhận tin chạy bộ mới')
  assert.deepEqual(support({ zaloSendExclusionsByAccountId: { 5: { groupId: 3, blocklistIds: [] } } }), { ok: true }, 'loại trừ gửi chạy bộ mới (V504)')
  assert.deepEqual(support({ internalSmsEnabled: true }), { ok: true }, 'kiêm SMS nội bộ chạy bộ mới (V506)')
  for (const [extra, more, reason] of [
    [{ externalSmsEnabled: true }, {}, 'sms_push_external'], [{ zaloMessageSendMode: 'share' }, {}, 'share_mode']]) {
    assert.deepEqual(support(extra, more), { ok: false, reason }, reason)
  }
  assert.deepEqual(support({}, { images: ['a.jpg'] , extraSettings: { enableMessage: true, imageOption: 'none' } }), { ok: true }, 'imageOption none thì không có media')
  assert.deepEqual(support({}, { images: ['a.jpg', { name: 'b.pdf', cloudUrl: 'https://cdn/b.pdf' }] }), { ok: true }, 'tệp/album (nội dung cơ bản) đã chạy bằng bộ mới')
  assert.deepEqual(support({ recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 7 }), { ok: true }, 'chống gửi lặp N ngày chạy trong claim (V501)')
  assert.deepEqual(support({ formattedContentEnabled: true }), { ok: true }, 'nội dung định dạng đã chạy bằng bộ mới')
  assert.deepEqual(support({ advancedContentEnabled: true, advancedContentItems: [{ id: 'a', content: 'x' }] }), { ok: true }, 'nội dung nâng cao đã chạy bằng bộ mới')
  assert.deepEqual(support({ rewriteContentEachRun: true }), { ok: true }, 'AI viết lại đã chạy bằng bộ mới')
  assert.deepEqual(support({ zaloSendExclusionsByAccountId: { 5: { groupId: null, blocklistIds: [] } } }), { ok: true })
  assert.deepEqual(support({ enableZaloTag: true, enableZaloAlias: true, enableAkaBizTag: true, akaBizTagIds: [3] }), { ok: true },
    'gắn tag / đổi tên / tag akaBiz đã chạy bằng bộ mới')
  assert.equal(E.zaloMessagePhoneV2Support({ id: 1, actionId: 'zalo_message_phone', accountId: 5, content: 'x', extraSettings: { enableMessage: true } },
    { engagementTrackingEnabled: true }).ok, false)
  assert.deepEqual(E.zaloMessagePhoneClaimPlan({ id: 1, actionId: 'zalo_message_phone', accountId: 5, content: '',
    extraSettings: { enableMessage: true, enableAddFriend: true, actionLimits: { continueWhenActionLimitReached: true } } }), {
    actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger', required: false, skippableGates: ['quota'] },
      { code: 'zalo_add_friend', required: false, skippableGates: ['quota'] }], requireAny: ['zalo_message_stranger', 'zalo_add_friend'] })
  assert.equal(E.sleepBetweenActionsSeconds(undefined, { sleepBetweenActions: '90.7' }), 90)
  assert.equal(E.sleepBetweenActionsSeconds(30, { sleepBetweenActions: 90 }), 30)
  assert.equal(E.sleepBetweenActionsSeconds('', {}), 0)
  pass('chọn bộ mới cho "Nhắn tin theo SĐT": tính năng chưa tách sang lõi thì chạy bộ cũ; thao tác claim và nghỉ như Desktop')

  // Pha của lỗi theo loại thao tác (classifyZaloError): lỗi mạng của tra số là chưa gửi, của gửi tin thì lỗi mở kết nối
  // là chưa gửi còn lại không rõ; câu trả lời của Zalo giữ after_send.
  {
    const err = (message, extra = {}) => Object.assign(new Error(message), extra)
    const fetchFailed = cause => Object.assign(new TypeError('fetch failed'), { cause })
    const c = (e, op, answered = false) => { const r = E.classifyZaloError(e, op, answered); return [r.signal.kind, r.signal.code ?? null, r.phase, r.deliveryUnknown] }
    assert.deepEqual(c(err('Người nhận chặn', { code: 122 }), 'send', true), ['zalo_code', '122', 'after_send', false])
    assert.deepEqual(c(err('Stop retry', { code: -69 }), 'send', true), ['zalo_code', '-69', 'after_send', false])
    assert.deepEqual(c(fetchFailed(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' })), 'read'), ['errno', 'ECONNRESET', 'before_send', false])
    assert.deepEqual(c(fetchFailed(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' })), 'send'), ['errno', 'ECONNRESET', 'in_flight', true])
    assert.deepEqual(c(err('connect ETIMEDOUT 1.2.3.4:8080', { code: 'ETIMEDOUT', syscall: 'connect' }), 'send'), ['errno', 'ETIMEDOUT', 'before_send', false])
    assert.deepEqual(c(fetchFailed(Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' })), 'send'), ['errno', 'ENOTFOUND', 'before_send', false])
    assert.deepEqual(c(err('socket hang up', { code: 'ECONNRESET' }), 'send'), ['errno', 'ECONNRESET', 'in_flight', true])
    assert.deepEqual(c(new TypeError('fetch failed'), 'send'), ['message_like', null, 'in_flight', true])
    assert.deepEqual(c(new TypeError('fetch failed'), 'read'), ['message_like', null, 'before_send', false])
    assert.deepEqual(c(err('Request failed with status code 502'), 'send', true), ['http_status', '502', 'in_flight', true])
    assert.deepEqual(c(err('Request failed with status code 429'), 'send', true), ['http_status', '429', 'before_send', false])
    assert.deepEqual(c(err('Request failed with status code 403'), 'send', true), ['http_status', '403', 'after_send', false])
    assert.deepEqual(c(err('Request failed with status code 502'), 'read', true), ['http_status', '502', 'before_send', false])
    assert.deepEqual(c(err('Failed to parse response data'), 'send', true), ['message_like', null, 'in_flight', true])
    assert.deepEqual(c(err('Failed to parse response data'), 'read', true), ['message_like', null, 'before_send', false])
    // Hết giờ chờ của Desktop (withTimeout, Error thường): tra số chưa gửi; gửi tin không rõ.
    assert.deepEqual(c(err('Gửi tin nhắn Zalo đến người dùng quá thời gian chờ (90 giây)'), 'send'), ['message_like', null, 'in_flight', true])
    assert.deepEqual(c(err('Chưa có session Zalo'), 'read'), ['message_like', null, 'before_send', false])
    // Zalo trả lời không kèm mã (ZaloApiError): giữ after_send như cũ.
    assert.deepEqual(c(err('Missing message content'), 'send', true), ['message_like', null, 'after_send', false])
    // Cổng: `code` giữ mã của lỗi gốc (tra số thử reqSrc 40 như Desktop khi lỗi không có mã).
    const pe = E.zaloPortErrorFrom(fetchFailed(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), { operation: 'read' })
    assert.equal(pe.code, ''); assert.equal(pe.phase, 'before_send'); assert.deepEqual(pe.signal.code, 'ECONNRESET')
    const ps = E.zaloPortErrorFrom(new TypeError('fetch failed'), { operation: 'send' })
    assert.equal(ps.phase, 'in_flight'); assert.deepEqual(ps.evidence, { deliveryState: 'unknown' })
    // Không truyền operation: giữ đúng cách cũ.
    assert.equal(E.zaloPortErrorFrom(err('x', { code: 'ECONNRESET' }), { phase: 'after_send' }).phase, 'after_send')
    pass('phân loại lỗi Zalo theo loại thao tác: lỗi mạng của tra số là chưa gửi, của gửi tin là không rõ trừ lỗi mở kết nối/429')
  }

  const portError = spec => E.zaloPortErrorFrom(Object.assign(new Error(spec.message || 'Zalo error'), spec.code === undefined ? {} : { code: spec.code }),
    spec.uncertain ? { deliveryUncertain: true } : {})
  const fakePort = (b, calls) => ({
    findUser: async (_ctx, phone, reqSrc) => {
      calls.push(`find:${phone}:${reqSrc}`)
      const f = (b.find || {})[reqSrc] ?? (b.find || {}).any
      if (f?.error) throw portError(f.error)
      if (f && f.user === null) return null
      return E.normalizeZaloFoundUser(f?.user ?? { userId: `uid-${phone}`, display_name: b.name ?? `Zalo ${phone}`, zalo_name: b.name ?? `Zalo ${phone}`,
        ...(b.noGlobalId ? {} : { globalId: `g-${phone}` }), gender: 0 })
    },
    phoneSearchLimitScope: async code => ({ 221: 'hour', 312: 'hour', 313: 'day', 304: 'day' })[code] ?? null,
    saveFoundUser: async (ctx, target) => { calls.push(`save:${ctx.target.id}:${target.uid}`); if (b.saveFails) throw new Error('insert failed') },
    isOptedOut: async (_ctx, identity) => {
      const by = identity.phone ? 'phone' : 'globalId'
      calls.push(`optout:${by}`)
      const v = (b.optOut || {})[by]
      if (v === 'error') throw new Error('DB lỗi')
      return v === true
    },
    takeContentIndex: async (ctx, actionCode, count) => {
      const r = await rpc('SELECT public.aka_agent_engine_take_content_index_v1($1, $2, $3, $4) AS r', [ctx.targetRunId, ctx.leaseToken, actionCode, count])
      if (!r.ok) throw new Error(r.reason)
      calls.push(`take:${actionCode}:${r.index}`)
      return r.index
    },
    businessNow: async () => new Date('2026-11-11T03:00:00Z'),
    sendText: async (_ctx, uid, message) => {
      calls.push(`text:${uid}:${message}`)
      if (b.text?.error) throw portError(b.text.error)
      return { response: { msgId: `m-${uid}` }, msgId: `m-${uid}` }
    },
    sendFriendRequest: async (_ctx, uid, message) => {
      calls.push(`friend:${uid}:${message}`)
      if (b.friend?.error) throw portError(b.friend.error)
      return { ok: true }
    },
    // Thao tác phụ: Zalo giả từ chối tên gợi nhớ dài hơn 50 ký tự (112) như Zalo thật.
    friendStatus: async (_ctx, uid) => { calls.push(`friendStatus:${uid}`); return b.friendStatus === undefined ? null : b.friendStatus },
    applyLabel: async (_ctx, uid, labelId, skip) => {
      calls.push(`label:${uid}:${labelId}:${skip.join(',')}`)
      const l = b.label || {}
      if (l.error) throw portError(l.error)
      if (l.excluded) return { kind: 'excluded', matchedLabelNames: l.excluded }
      if (l.notFound) return { kind: 'label_not_found', message: 'Tag Zalo không tồn tại' }
      return { kind: 'applied', labelText: l.text === undefined ? 'Khách hàng' : l.text }
    },
    mirrorLabel: async (_ctx, uid, label) => { calls.push(`mirror:${uid}:${label.id}:${label.name}`) },
    changeAlias: async (_ctx, uid, alias) => {
      calls.push(`alias:${uid}:${alias}`)
      if (b.alias?.error) throw portError(b.alias.error)
      if (alias.length > 50) throw portError({ code: 112, message: 'Lỗi không xác định' })
      return ''
    },
    applyAkaBizTags: async (_ctx, type, uid, ids) => {
      calls.push(`akabiz:${type}:${uid}:${ids.join(',')}`)
      if (b.akaBiz?.error) throw new Error(b.akaBiz.error)
      return b.akaBiz?.count ?? 1
    },
    trace: e => calls.push(`trace:${e.type}`)
  })

  const makePhoneCampaign = async ({ targets, extra, content = '', server = true, org = 640 }) => {
    const account = env.nextId(), campaign = env.nextId(), staff = 8001
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org SĐT', true) ON CONFLICT (id) DO NOTHING`, [org])
    await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
      OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo test', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, $4)`, [account, staff, org, server])
    await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings)
      OVERRIDING SYSTEM VALUE VALUES ($1, 'Nhắn theo SĐT', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4, $5, $6::jsonb)`,
      [campaign, account, staff, org, content, JSON.stringify(extra)])
    const ids = {}
    for (const [phone, name] of targets) {
      const id = env.nextId()
      await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, name, phone])
      ids[phone || name] = id
    }
    return { account, campaign, staff, ids, extra, content, runtime: server ? 'fly' : 'desktop' }
  }
  const runPhone = async (c, behaviors, extraCfg = {}) => {
    const clock = testClock(), col = collector(), calls = []
    const cfgCampaign = { id: c.campaign, actionId: 'zalo_message_phone', accountId: c.account, content: c.content, extraSettings: c.extra, images: [],
      dataTargetSourceMode: null }
    const result = await E.runUnit({ data: port, journal: new E.MemoryJournal(), clock, events: col.events }, {
      runnerId: `${c.runtime}:phone`, runtimeTarget: c.runtime, staffId: c.staff, accountId: c.account, campaignId: c.campaign,
      campaignName: 'Nhắn theo SĐT', accountName: 'Zalo test', campaignNote: null,
      targetLabel: E.zaloMessagePhoneTargetLabel, actionName: code => E.ZALO_MESSAGE_PHONE_ACTION_NAMES[code] ?? code,
      ...E.zaloMessagePhoneClaimPlan(cfgCampaign),
      buildSteps: target => E.buildZaloMessagePhoneSteps(cfgCampaign, fakePort(behaviors[target.phone || target.name] || {}, calls),
        { account: { id: c.account, name: 'Zalo test' } }),
      onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v1($1, $2, NULL) AS r', [c.account, info.leaseToken]),
      formatTime: iso => new Date(iso).toISOString(),
      pacing: { fullSeconds: 120 }, stepTimeoutMs: 5000, heartbeatMs: 60000, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }, ...extraCfg
    }, new AbortController().signal)
    return { result, clock, calls, lines: col.lines.map(l => l.text), levels: col.lines.map(l => l.level), traces: col.traces }
  }
  const detailRows = id => rows(`SELECT action_code, action_name, status, error_code, log, data FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [id])
  const inputRow = id => rows(`SELECT status, note, name FROM public.auto_campaign_input_data WHERE id = $1`, [id]).then(r => r[0])
  const extraAll = { enableMessage: true, enableAddFriend: true, friendRequestMessage: 'Kết bạn với #{FULL_NAME} nhé' }

  // P1: bình thường, không tồn tại, xoay nội dung + biến mẫu, cuối cùng hoàn thành chiến dịch.
  const p1 = await makePhoneCampaign({ extra: extraAll, content: 'Chào #{FULL_NAME}|Xin chào #{INPUT_FULLNAME}, số #{PHONE}',
    targets: [['0911000001', 'Data A'], ['0911000002', 'Data X'], ['0911000003', 'Data B']] })
  const r1 = await runPhone(p1, { '0911000001': { name: 'An' }, '0911000002': { find: { any: { user: null } } }, '0911000003': { name: 'Bình' } })
  assert.equal(r1.result.reason, 'no_target')
  assert.deepEqual(r1.lines, [
    '🚀 Bắt đầu chiến dịch "Nhắn theo SĐT" trên tài khoản "Zalo test"',
    '▶️ Xử lý "0911000001" trong chiến dịch "Nhắn theo SĐT"',
    'Tìm SĐT: Đã tìm thấy SĐT 0911000001: An',
    'Nhắn tin người lạ: Đã gửi tin nhắn đến An',
    'Kết bạn: Đã gửi lời mời kết bạn đến An',
    '✅ Hoàn thành "0911000001"',
    '⏳ Nghỉ 120s trước khi xử lý mục tiếp theo...',
    '▶️ Xử lý "0911000002" trong chiến dịch "Nhắn theo SĐT"',
    'Tìm SĐT: Không tồn tại (Z216)',
    '✅ Hoàn thành "0911000002"',
    '⏳ Nghỉ 120s trước khi xử lý mục tiếp theo...',
    '▶️ Xử lý "0911000003" trong chiến dịch "Nhắn theo SĐT"',
    'Tìm SĐT: Đã tìm thấy SĐT 0911000003: Bình',
    'Nhắn tin người lạ: Đã gửi tin nhắn đến Bình',
    'Kết bạn: Đã gửi lời mời kết bạn đến Bình',
    '✅ Hoàn thành "0911000003"',
    '✅ Hoàn thành chiến dịch "Nhắn theo SĐT"'
  ])
  assert.deepEqual(r1.calls.filter(x => /^(text|friend|take)/.test(x)), [
    'take:zalo_message_stranger:0', 'text:uid-0911000001:Chào An', 'friend:uid-0911000001:Kết bạn với An nhé',
    'take:zalo_message_stranger:1', 'text:uid-0911000003:Xin chào Data B, số 0911000003', 'friend:uid-0911000003:Kết bạn với Bình nhé'])
  assert.deepEqual((await detailRows(p1.ids['0911000001'])).map(d => [d.action_code, d.action_name, d.status, d.log]), [
    ['zalo_find_phone_user', 'Tìm SĐT', 'thành công', 'Đã tìm thấy SĐT 0911000001: An'],
    ['zalo_message_stranger', 'Nhắn tin người lạ', 'thành công', 'Đã gửi tin nhắn đến An'],
    ['zalo_add_friend', 'Kết bạn', 'thành công', 'Đã gửi lời mời kết bạn đến An']])
  const d1 = await detailRows(p1.ids['0911000001'])
  assert.equal(d1[1].data.message, 'Chào An'); assert.equal(d1[1].data.target.uid, 'uid-0911000001'); assert.equal(d1[1].data.evidence.msgId, 'm-uid-0911000001')
  assert.deepEqual((await detailRows(p1.ids['0911000002'])).map(d => [d.action_name, d.status, d.error_code]), [['Tìm SĐT', 'không tồn tại', 'err_zalo_user_not_found']])
  for (const id of Object.values(p1.ids)) assert.equal((await inputRow(id)).status, 'hoàn thành')
  assert.equal(await env.val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [p1.campaign]), 'hoàn thành')
  assert.deepEqual(r1.clock.sleeps, [120000, 120000])
  pass('SĐT: tìm thấy → nhắn tin → kết bạn; không tồn tại thì bỏ nhắn/kết bạn; câu tiến trình, tên thao tác, lịch sử, xoay nội dung và biến mẫu đúng như Desktop')

  // P2: từ chối nhận tin (chặn theo SĐT) và không kiểm được (vẫn gửi, cảnh báo như Desktop).
  const p2 = await makePhoneCampaign({ extra: extraAll, content: 'Chào #{FULL_NAME}',
    targets: [['0911000005', 'Data C'], ['0911000006', 'Data D'], ['0911000007', 'Data E']] })
  const r2 = await runPhone(p2, { '0911000005': { name: 'Cúc', optOut: { phone: true } }, '0911000006': { name: 'Dung' },
    '0911000007': { name: 'Em', optOut: { phone: 'error' }, noGlobalId: true } })
  assert.deepEqual(r2.lines.slice(1, 5), [
    '▶️ Xử lý "0911000005" trong chiến dịch "Nhắn theo SĐT"',
    'Tìm SĐT: Đã tìm thấy SĐT 0911000005: Cúc',
    '🚫 Bỏ qua "0911000005": Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo (OPT01)',
    '▶️ Xử lý "0911000006" trong chiến dịch "Nhắn theo SĐT"'], 'chặn thì không nghỉ, không "Hoàn thành"')
  const i5 = await inputRow(p2.ids['0911000005'])
  assert.equal(i5.status, 'tạm dừng'); assert.equal(i5.note, 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo (OPT01)')
  assert.ok(!r2.calls.some(x => x.startsWith('text:uid-0911000005') || x.startsWith('friend:uid-0911000005')))
  const at7 = r2.lines.indexOf('Tìm SĐT: Đã tìm thấy SĐT 0911000007: Em')
  assert.deepEqual(r2.lines.slice(at7 + 1, at7 + 4), [
    '⚠️ "0911000007": Không thể kiểm tra từ chối nhận tin Zalo theo SĐT; vẫn tiếp tục gửi: DB lỗi',
    '⚠️ "0911000007": Không lấy được Zalo global ID; vẫn tiếp tục gửi, cá nhân hoá từ chối nhận tin (nếu có) dùng trang thông báo lỗi.',
    'Nhắn tin người lạ: Đã gửi tin nhắn đến Em'])
  assert.equal((await inputRow(p2.ids['0911000007'])).status, 'hoàn thành')
  pass('SĐT: người nhận từ chối thì "🚫 Bỏ qua" (OPT01), data tạm dừng, không gửi, không nghỉ; không kiểm được thì cảnh báo như Desktop rồi vẫn gửi')

  // P3: nhắn tin bị chặn (122) vẫn kết bạn; tra số thử reqSrc 40; mã không có giới hạn tra số thì không thử lại; mạng lỗi khi gửi.
  const p3 = await makePhoneCampaign({ extra: extraAll, content: 'Chào #{FULL_NAME}',
    targets: [['0911000008', 'Data F'], ['0911000009', 'Data G'], ['0911000010', 'Data H'], ['0911000011', 'Data I'], ['', 'Không số']] })
  const r3 = await runPhone(p3, {
    '0911000008': { name: 'Giang', text: { error: { code: 122, message: 'Người nhận chặn' } } },
    '0911000009': { name: 'Hà', find: { 32: { error: { code: 221, message: 'Quá giới hạn' } } } },
    '0911000010': { find: { 32: { error: { code: 216, message: 'Không tìm thấy' } } } },
    '0911000011': { name: 'Khánh', text: { error: { code: 'ECONNRESET', message: 'read ECONNRESET', uncertain: true } } }
  })
  const lines3 = r3.lines.join('\n')
  assert.match(lines3, /Nhắn tin người lạ: Người nhận chặn tin nhắn từ người lạ \(Z122\)\nKết bạn: Đã gửi lời mời kết bạn đến Giang\n✅ Hoàn thành "0911000008"/)
  assert.deepEqual((await detailRows(p3.ids['0911000008'])).map(d => [d.action_code, d.status, d.error_code]), [
    ['zalo_find_phone_user', 'thành công', null], ['zalo_message_stranger', 'thất bại', 'err_zalo_receiver_blocks_stranger_message'],
    ['zalo_add_friend', 'thành công', null]])
  assert.deepEqual(r3.calls.filter(x => x.startsWith('find:0911000009')), ['find:0911000009:32', 'find:0911000009:40'])
  assert.deepEqual((await detailRows(p3.ids['0911000009']))[0].data.searchPhoneAttempts,
    [{ reqSrc: 32, outcome: 'error', errorCode: '221', errorMessage: 'Quá giới hạn' }, { reqSrc: 40, outcome: 'success' }])
  assert.deepEqual(r3.calls.filter(x => x.startsWith('find:0911000010')), ['find:0911000010:32'])
  assert.match(lines3, /Tìm SĐT: Không tồn tại \(Z216\)/)
  assert.match(lines3, /Nhắn tin người lạ thất bại: read ECONNRESET \(Z999\)\nKết bạn: Đã gửi lời mời kết bạn đến Khánh/)
  const d11 = await detailRows(p3.ids['0911000011'])
  assert.deepEqual([d11[1].status, d11[1].error_code, d11[1].data.deliveryState], ['thất bại', 'err_zalo_api_business_failed', 'unknown'])
  assert.match(lines3, /Tìm SĐT: Tham số không hợp lệ \(Z114\)\n✅ Hoàn thành "Không số"/)
  assert.equal(r3.calls.filter(x => x.startsWith('text:')).length, 3, 'mỗi data gửi đúng một lần')
  pass('SĐT: nhắn lỗi 122 vẫn kết bạn; reqSrc 40 khi mã có giới hạn tra số; không thì dừng ở 32; mạng lỗi lúc gửi ghi như Desktop (Z999), không gửi lại; thiếu SĐT → Z114')

  // P4: hết lượt nhắn tin + "tiếp tục khi chạm giới hạn": bỏ nhắn tin (báo một lần), vẫn kết bạn; lưu hồ sơ lỗi không đổi kết quả tra số.
  const p4 = await makePhoneCampaign({ extra: { ...extraAll, actionLimits: { continueWhenActionLimitReached: true,
    byActionCode: { zalo_message_stranger: { dailyLimit: 1 } } } }, content: 'Chào #{FULL_NAME}',
    targets: [['0911000012', 'Data K'], ['0911000013', 'Data L']] })
  await db.query(`INSERT INTO public.auto_account_action_status(account_id, action_code, is_disable, count_action_in_day, count_date)
    VALUES ($1, 'zalo_message_stranger', false, 1, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`, [p4.account])
  const r4 = await runPhone(p4, { '0911000012': { name: 'Lan', saveFails: true }, '0911000013': { name: 'Mai' } })
  const skips = r4.lines.filter(l => l.startsWith('⚠️ Bỏ qua Nhắn tin người lạ vì đã đạt giới hạn: '))
  assert.equal(skips.length, 1, r4.lines.join('\n')); assert.match(skips[0], /\(LIM01\)$/)
  assert.equal(r4.calls.filter(x => x.startsWith('text:')).length, 0); assert.equal(r4.calls.filter(x => x.startsWith('friend:')).length, 2)
  assert.ok(r4.calls.includes('trace:save_found_user_failed'))
  assert.equal((await detailRows(p4.ids['0911000012']))[0].status, 'thành công', 'lưu hồ sơ lỗi không đổi kết quả tra số')
  pass('SĐT: hết lượt nhắn tin thì bỏ nhắn (báo một lần "Bỏ qua ... vì đã đạt giới hạn"), vẫn kết bạn; lưu hồ sơ lỗi không đổi kết quả tra số')

  // P5: tài khoản QR chạy bộ mới trên Desktop (không cần cờ tổ chức).
  const p5 = await makePhoneCampaign({ extra: { enableMessage: true }, content: 'Chào #{FULL_NAME}', server: false, org: 641,
    targets: [['0911000014', 'Data M']] })
  await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id = 641`)
  const r5 = await runPhone(p5, { '0911000014': { name: 'Nga' } })
  assert.equal(r5.result.reason, 'no_target'); assert.ok(r5.lines.includes('Nhắn tin người lạ: Đã gửi tin nhắn đến Nga'))
  pass('SĐT trên Desktop (tài khoản QR): chạy bộ mới theo bản cài, không phụ thuộc cờ tổ chức')

  await auxiliaryCases(E, { ...env, makePhoneCampaign, runPhone, detailRows, inputRow })
}

/** Thao tác phụ (docs/engine-v2-specs/zalo-aux-actions.md §10.7): gắn tag Zalo, đổi tên gợi nhớ, tag akaBiz. */
async function auxiliaryCases(E, env) {
  const { makePhoneCampaign, runPhone, detailRows, inputRow, db } = env
  const base = { enableMessage: true, enableZaloTag: true, enableZaloAlias: true, zaloTagId: 7, zaloTagName: 'Khách hàng',
    zaloAliasTemplate: '#{FULL_NAME} - #{PHONE}' }

  // X1: chạy đủ: tra số → nhắn → gắn tag → đổi tên; dòng phụ không tính lượt; tag phụ chạy cả khi nhắn tin lỗi 122.
  const x1 = await makePhoneCampaign({ extra: base, content: 'Chào #{FULL_NAME}', targets: [['0912000001', 'Data A'], ['0912000002', 'Data B']] })
  const r1 = await runPhone(x1, { '0912000001': { name: 'An' }, '0912000002': { name: 'Bình', text: { error: { code: 122, message: 'chặn người lạ' } } } })
  assert.equal(r1.result.reason, 'no_target')
  const a1 = await detailRows(x1.ids['0912000001'])
  assert.deepEqual(a1.map(d => [d.action_code, d.status]), [['zalo_find_phone_user', 'thành công'], ['zalo_message_stranger', 'thành công'],
    ['zalo_tag_contact', 'thành công'], ['zalo_change_alias', 'thành công']])
  assert.equal(a1[2].log, 'Đã gắn tag "Khách hàng" cho An'); assert.equal(a1[3].log, 'Đã đổi tên An thành "An - 0912000001"')
  assert.equal(a1[2].action_name, 'Gắn tag Zalo'); assert.equal(a1[3].action_name, 'Đổi tên Zalo')
  const counted = await env.rows(`SELECT action_code, counts_toward_limit FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [x1.ids['0912000001']])
  assert.deepEqual(counted.filter(d => /tag|alias/.test(d.action_code)).map(d => d.counts_toward_limit), [false, false], 'dòng phụ không tính lượt')
  assert.deepEqual((await detailRows(x1.ids['0912000002'])).map(d => [d.action_code, d.status]), [['zalo_find_phone_user', 'thành công'],
    ['zalo_message_stranger', 'thất bại'], ['zalo_tag_contact', 'thành công'], ['zalo_change_alias', 'thành công']], 'nhắn lỗi vẫn gắn tag/đổi tên')
  assert.ok(r1.lines.includes('Gắn tag Zalo: Đã gắn tag "Khách hàng" cho An'), r1.lines.join('\n'))
  assert.ok(r1.lines.includes('Đổi tên Zalo: Đã đổi tên An thành "An - 0912000001"'))
  assert.ok(r1.calls.includes('mirror:uid-0912000001:7:Khách hàng'))
  assert.equal((await inputRow(x1.ids['0912000002'])).status, 'hoàn thành')
  pass('Phụ: gắn tag + đổi tên sau nhắn tin, cả khi nhắn lỗi 122; câu và tên thao tác như Desktop; không tính lượt; chép tag vào danh bạ')

  // X2: bỏ qua nếu đã là bạn bè (biết từ hồ sơ, không gọi thêm); không xác định được thì cảnh báo một lần rồi vẫn làm.
  const x2 = await makePhoneCampaign({ extra: { ...base, zaloTagSkipIfFriend: true, zaloAliasSkipIfFriend: true }, content: 'Chào',
    targets: [['0912000003', 'Data C'], ['0912000004', 'Data D']] })
  const r2 = await runPhone(x2, {
    '0912000003': { find: { any: { user: { userId: 'uid-0912000003', display_name: 'Cúc', zalo_name: 'Cúc', globalId: 'g3', isFr: 1 } } } },
    '0912000004': { name: 'Dung', friendStatus: null } })
  assert.ok(r2.lines.includes('Bỏ qua gắn tag Zalo cho Cúc: đã là bạn bè')); assert.ok(r2.lines.includes('Bỏ qua đổi tên Zalo cho Cúc: đã là bạn bè'))
  assert.ok(!r2.calls.includes('friendStatus:uid-0912000003'), 'hồ sơ đã có isFr thì không đọc lại')
  assert.deepEqual((await detailRows(x2.ids['0912000003'])).map(d => d.action_code), ['zalo_find_phone_user', 'zalo_message_stranger'])
  const warn = r2.lines.filter(l => l.startsWith('⚠️ Không xác định được trạng thái bạn bè của Dung'))
  assert.equal(warn.length, 1, 'cảnh báo một lần cho cả tag và đổi tên'); assert.equal(r2.calls.filter(c => c === 'friendStatus:uid-0912000004').length, 1)
  assert.deepEqual((await detailRows(x2.ids['0912000004'])).map(d => d.action_code).slice(-2), ['zalo_tag_contact', 'zalo_change_alias'])
  pass('Phụ: đã là bạn bè thì bỏ qua (không ghi dòng); không xác định thì cảnh báo một lần, vẫn gắn tag / đổi tên')

  // X3: tên gợi nhớ dài hơn 50 ký tự được cắt (thay đổi đã duyệt); tag loại trừ; tag không tồn tại; tag lỗi 114 vẫn đổi tên.
  const longName = 'Nguyễn Thị Phương Thảo Kinh Doanh Online Toàn Quốc'
  const x3 = await makePhoneCampaign({ extra: { ...base, zaloTagSkipIfHasSelectedTags: true, zaloTagSkipTagIds: ['9'] }, content: 'Chào',
    targets: [['0912000005', 'Data E'], ['0912000006', 'Data F'], ['0912000007', 'Data G'], ['0912000008', 'Data H']] })
  const r3 = await runPhone(x3, {
    '0912000005': { name: longName },
    '0912000006': { name: 'Phong', label: { excluded: ['VIP'] } },
    '0912000007': { name: 'Giang', label: { notFound: true } },
    '0912000008': { name: 'Hà', label: { error: { code: 114, message: 'Tham số không hợp lệ' } } } })
  const a3 = await detailRows(x3.ids['0912000005'])
  const aliasRow = a3.find(d => d.action_code === 'zalo_change_alias')
  assert.equal(aliasRow.status, 'thành công'); assert.ok(aliasRow.data.alias.length <= 50, aliasRow.data.alias)
  assert.equal(aliasRow.data.aliasTruncatedFrom, `${longName} - 0912000005`)
  assert.ok(r3.lines.includes('Bỏ qua gắn tag Zalo cho Phong: đã có tag VIP'))
  assert.deepEqual((await detailRows(x3.ids['0912000006'])).map(d => d.action_code).slice(-1), ['zalo_change_alias'], 'tag loại trừ: không ghi dòng tag')
  const g = (await detailRows(x3.ids['0912000007'])).find(d => d.action_code === 'zalo_tag_contact')
  assert.equal(g.log, 'Tag Zalo không tồn tại'); assert.notEqual(g.status, 'thành công')
  const h = await detailRows(x3.ids['0912000008'])
  assert.deepEqual(h.filter(d => /tag|alias/.test(d.action_code)).map(d => [d.action_code, d.status, d.error_code]),
    [['zalo_tag_contact', 'thất bại', 'err_zalo_invalid_param'], ['zalo_change_alias', 'thành công', null]], 'tag lỗi vẫn đổi tên')
  assert.ok(r3.calls.includes('label:uid-0912000006:7:9'), 'gửi đúng danh sách tag loại trừ')
  pass('Phụ: tên gợi nhớ quá 50 ký tự được cắt (đã duyệt); tag loại trừ thì bỏ qua; tag không tồn tại ghi đúng; tag lỗi 114 vẫn đổi tên')

  // X4: cấu hình tag theo tài khoản: thiếu tài khoản đang chạy thì báo "chưa chọn tag", không ghi dòng; tag akaBiz trước khi nhắn.
  const x4 = await makePhoneCampaign({ extra: { ...base, zaloTagSettingsByAccountId: { 1: { zaloTagId: '5', zaloTagName: 'Khác' } },
    enableAkaBizTag: true, akaBizTagIds: [3, 3, 0, 'x', 4] }, content: 'Chào', targets: [['0912000009', 'Data I'], ['0912000010', 'Data J']] })
  const r4 = await runPhone(x4, { '0912000009': { name: 'Ích' }, '0912000010': { name: 'Kha', akaBiz: { error: 'scope invalid' } } })
  assert.ok(r4.lines.includes('Không thể gắn tag Zalo cho Ích: chưa chọn tag cần gắn cho tài khoản Zalo test'), r4.lines.join('\n'))
  assert.ok(r4.calls.includes('akabiz:person:uid-0912000009:3,4'), 'tag akaBiz: id hợp lệ, không trùng')
  const iLines = r4.lines.slice(r4.lines.findIndex(l => l.includes('"0912000009"')))
  assert.ok(iLines.indexOf('🏷️ Đã gắn tag akaBiz cho Ích') < iLines.indexOf('Nhắn tin người lạ: Đã gửi tin nhắn đến Ích'), 'tag akaBiz trước khi nhắn')
  assert.ok(r4.lines.includes('⚠️ Không thể gắn tag akaBiz cho Kha: scope invalid'))
  assert.ok((await detailRows(x4.ids['0912000010'])).some(d => d.action_code === 'zalo_message_stranger' && d.status === 'thành công'), 'lỗi tag akaBiz không chặn nhắn tin')
  assert.ok(!(await detailRows(x4.ids['0912000009'])).some(d => d.action_code === 'zalo_tag_contact'))
  await db.query('SELECT 1')
  pass('Phụ: tag theo tài khoản (thiếu thì báo, không ghi dòng); tag akaBiz trước khi nhắn, không có dòng lịch sử, lỗi chỉ cảnh báo')
}

async function main() {
  const { engine, out } = await loadEngine()
  try {
    await unitTests(engine)
    await integration(engine)
    console.log(`\n${checks} nhóm kiểm tra đạt`)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
}

main().catch(err => { console.error(err); process.exit(1) })
