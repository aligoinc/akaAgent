// V509: Zalo 112 khi nhắn người lạ / bạn bè xử lý như 118 "Nội dung quá dài" (tạm dừng chiến dịch ngay, data chưa gửi được gì về hàng đợi,
// không tính lượt, không đếm chuỗi). Chạy lõi thật (packages/campaign-engine) + cổng Zalo giả trên PostgreSQL 17 cục bộ có đủ chuỗi
// V495 → … → V509; cùng kịch bản trước V509, sau V509, sau khi gỡ. Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-v509-smoke.cjs
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
const v508 = require('./build-v508-sql.cjs')
const v509 = require('./build-v509-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V509_TEST_PORT || 55509)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v509-'))
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

async function main() {
  const E = await loadEngine()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v509-' })
  const db = await connect()
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/migration_v509_zalo_personal_112_too_long.sql'), 'utf8'), v509.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/rollback_v509_zalo_personal_112_too_long.sql'), 'utf8'), v509.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506, v507, v508]) await db.query(m.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const classify = (action, code = '112') => val(`SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', $1, 'after_send',
      jsonb_build_object('kind', 'zalo_code', 'code', $2::text)) cs`, [action, code])
    const policy = async (code, action, rt = 'fly') => (await val(`SELECT public.aka_agent_engine_resolve_policy($1, NULL, $2, NULL, $3, 'after_send')`,
      [code, action, rt]))

    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 989000
    const STAFF = 9609, ORG = 699
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const make = async ({ images = [], phones = ['0912000001', '0912000002'] } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      const extra = { enableMessage: true }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
        extra_settings, images) OVERRIDING SYSTEM VALUE VALUES ($1, 'Nhắn SĐT', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false,
        $3, $4, 'Chào #{FULL_NAME}', $5::jsonb, $6::jsonb)`, [campaign, account, STAFF, ORG, JSON.stringify(extra), JSON.stringify(images)])
      const ids = []
      for (const phone of phones) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [id, campaign, phone])
        ids.push(id)
      }
      return { account, campaign, ids, images, extra }
    }
    const zaloErr = (message, code) => E.zaloPortErrorFrom(Object.assign(new Error(message), { code }), { operation: 'send', answered: true })
    // fail: 'text' (gửi chữ lỗi), 'media' (gửi tệp lỗi); Zalo trả 112 "Lỗi không xác định".
    const run = async (c, fail) => {
      const calls = [], lines = []
      const port = {
        findUser: async (_ctx, phone) => E.normalizeZaloFoundUser({ userId: `uid-${phone}`, display_name: 'Lan', zalo_name: 'Lan', globalId: `g-${phone}` }),
        phoneSearchLimitScope: async () => null,
        saveFoundUser: async () => {},
        isOptedOut: async () => false,
        takeContentIndex: async () => 0,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid) => {
          calls.push(`text:${uid}`)
          if (fail === 'text') throw zaloErr('Lỗi không xác định', 112)
          return { response: { msgId: 'mt' }, msgId: 'mt' }
        },
        prepareMedia: async (_ctx, items) => items.map(item => ({ name: E.campaignMediaName(item), ref: `/tmp/${E.campaignMediaName(item)}` })),
        sendMedia: async (_ctx, input) => {
          calls.push(`media:${input.stepKey}:${input.files.map(f => f.name).join(',')}`)
          if (fail === 'media') throw zaloErr('Lỗi không xác định', 112)
          return { response: { msgId: 'mm' }, msgId: 'mm' }
        },
        sendFriendRequest: async () => ({}),
        rewriteMessage: async (_ctx, content) => content,
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1
      }
      const core = { id: c.campaign, actionId: 'zalo_message_phone', accountId: c.account, content: 'Chào #{FULL_NAME}', extraSettings: c.extra,
        images: c.images, dataTargetSourceMode: null }
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v509', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign,
        campaignName: 'Nhắn SĐT', accountName: 'Zalo', campaignNote: null, targetLabel: E.zaloMessagePhoneTargetLabel,
        actionName: code => E.ZALO_MESSAGE_PHONE_ACTION_NAMES[code] ?? code, ...E.zaloMessagePhoneClaimPlan(core),
        buildSteps: () => E.buildZaloMessagePhoneSteps(core, port, { account: { id: c.account, name: 'Zalo' }, mediaStepTimeoutMs: 600000 }),
        validateCampaign: () => E.validateZaloMessagePhone(core, { zaloWeb: false }),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) AS r', [c.account, info.leaseToken]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      const camp = (await rows(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [c.campaign]))[0]
      return {
        result, calls, lines, campaign: camp.status, note: camp.note,
        inputs: (await rows(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])).map(r => r.status),
        details: (await rows(`SELECT status, error_code, counts_toward_limit, log FROM public.auto_campaign_details
          WHERE campaign_id = $1 AND action_code = 'zalo_message_stranger' ORDER BY id`, [c.campaign]))
          .map(d => `${d.status}|${d.error_code ?? '-'}|${d.counts_toward_limit}|${d.log}`),
        used: Number(await val(`SELECT coalesce((SELECT count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1
          AND action_code = 'zalo_message_stranger'), 0)`, [c.account]))
      }
    }

    // ---- 1. Trước V509: 112 nhắn người lạ rơi vào lỗi chung -----------------------------------------------------------
    assert.equal(await classify('zalo_message_stranger'), 'err_zalo_api_business_failed')
    assert.equal(await classify('zalo_message_friend'), 'err_zalo_api_business_failed')
    assert.equal(await classify('zalo_message_group'), 'err_zalo_112_message_group')
    const pre = await run(await make(), 'text')
    assert.deepEqual(pre.calls, ['text:uid-0912000001', 'text:uid-0912000002'], 'trước V509: chạy tiếp người sau')
    assert.deepEqual(pre.inputs, ['hoàn thành', 'hoàn thành'])
    assert.ok(pre.details.every(d => d.startsWith('thất bại|err_zalo_api_business_failed|true|')), pre.details.join('\n'))
    assert.equal(pre.used, 2, 'trước V509: tính lượt')
    pass('trước V509: 112 nhắn người lạ là lỗi chung (thất bại, tính lượt, data hoàn thành, chạy tiếp người sau)')

    // ---- 2. Apply / chặn chạy lại / gỡ ----------------------------------------------------------------------------------
    await db.query(v509.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await classify('zalo_message_stranger'), 'err_zalo_api_business_failed', 'apply rồi ROLLBACK không đổi gì')
    const t0 = Date.now()
    await db.query(v509.migration)
    const applyMs = Date.now() - t0
    assert.equal(await classify('zalo_message_stranger'), v509.CODE)
    assert.equal(await classify('zalo_message_friend'), v509.CODE)
    assert.equal(await classify('zalo_message_group'), 'err_zalo_112_message_group', 'nhắn group giữ nguyên')
    assert.equal(await classify('zalo_message_stranger', '118'), 'err_zalo_message_too_long', '118 giữ nguyên')
    for (const a of v509.ACTIONS) {
      for (const rt of ['desktop', 'fly']) {
        const strip = p => { const q = { ...p }; for (const k of ['revisions', 'policy_ids', 'log_template', 'campaign_note_template']) delete q[k]; return q }
        const neu = await policy(v509.CODE, a, rt), base = await policy(v509.BASE, a, rt)
        assert.deepEqual(strip(neu), strip(base), `${a} ${rt}: như 118`)
        assert.deepEqual([neu.campaign_effect, neu.target_effect, neu.quota_effect, neu.target_streak_effect, neu.run_effect],
          ['pause', 'requeue', 'no_count', 'ignore', 'stop_campaign'])
      }
    }
    const err = (await rows(`SELECT error_type, public_code, error_class, zalo_error_codes, zalo_action_codes, counts_toward_limit
      FROM public.auto_error WHERE error_code = $1`, [v509.CODE]))[0]
    assert.deepEqual([err.error_type, err.public_code, err.error_class, err.zalo_error_codes, err.zalo_action_codes, err.counts_toward_limit],
      ['engine v2', 'Z112', 'content_config', [], [], false], 'mã mới không có mã Zalo nên bộ chạy cũ không khớp')
    await assert.rejects(db.query(v509.migration), /đã có chính sách hoặc luật 112/)
    await db.query('ROLLBACK')
    await db.query(v509.rollback)
    assert.equal(await classify('zalo_message_stranger'), 'err_zalo_api_business_failed', 'gỡ trả phân loại cũ')
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_policies WHERE source = 'v509'`)), 0)
    assert.deepEqual((await rows(`SELECT is_active, is_delete FROM public.auto_error WHERE error_code = $1`, [v509.CODE]))[0], { is_active: false, is_delete: true })
    await assert.rejects(db.query(v509.rollback), /chưa có V509/)
    await db.query('ROLLBACK')
    await db.query(v509.migration)
    assert.equal(await classify('zalo_message_stranger'), v509.CODE, 'apply lại được (bật lại mã cũ)')
    pass(`apply trong transaction rồi ROLLBACK không đổi gì; apply thật (${applyMs} ms) chỉ đổi 112 × nhắn người lạ / bạn bè, chính sách y như 118 trừ câu cho khách; nhắn group và 118 giữ nguyên; chạy lại bị chặn; gỡ trả đúng; apply lại được`)

    // ---- 3. Sau V509: chỉ chữ ----------------------------------------------------------------------------------------
    const t1 = await run(await make(), 'text')
    assert.deepEqual(t1.calls, ['text:uid-0912000001'], 'tạm dừng ngay, không gửi người sau')
    assert.equal(t1.campaign, 'tạm dừng')
    assert.match(t1.note, /^Nội dung quá dài, vui lòng rút ngắn nội dung chiến dịch \(gửi kèm 1 ảnh thì chữ dưới 2\.000 ký tự\) \(Z112\)$/)
    assert.deepEqual(t1.inputs, ['chờ xử lý', 'chờ xử lý'], 'data chưa gửi được gì về hàng đợi')
    assert.deepEqual(t1.details, [], 'không ghi lịch sử (như 118)')
    assert.equal(t1.used, 0, 'không tính lượt')
    assert.ok(t1.lines.some(l => l.includes('Nội dung quá dài (Z112)')), t1.lines.join('\n'))
    pass('sau V509, chỉ chữ: 112 tạm dừng chiến dịch ngay kèm câu và mã Z112, data về hàng đợi, không ghi lịch sử, không tính lượt')

    // ---- 4. Sau V509: 1 ảnh, chữ thành chú thích ---------------------------------------------------------------------
    const t2 = await run(await make({ images: [{ name: 'a.jpg', localPath: '/x/a.jpg' }] }), 'media')
    assert.deepEqual(t2.calls, ['media:send_combined:a.jpg'])
    assert.deepEqual([t2.campaign, t2.inputs, t2.details, t2.used], ['tạm dừng', ['chờ xử lý', 'chờ xử lý'], [], 0])
    pass('sau V509, 1 ảnh kèm chữ: 112 tạm dừng chiến dịch ngay, data về hàng đợi')

    // ---- 5. Sau V509: album rồi chữ, chữ bị 112 (giao một phần) -----------------------------------------------------
    const t3 = await run(await make({ images: ['/x/a.jpg', '/x/b.jpg'] }), 'text')
    assert.deepEqual(t3.calls, ['media:send_media:a.jpg,b.jpg', 'text:uid-0912000001'])
    assert.equal(t3.campaign, 'tạm dừng')
    assert.deepEqual(t3.inputs, ['hoàn thành', 'chờ xử lý'], 'tệp đã tới thì data hoàn thành, không gửi lại; người sau chưa chạy')
    assert.equal(t3.details.length, 1)
    assert.match(t3.details[0], /^thất bại\|err_engine_zalo_112_message_too_long\|true\|Đã gửi file nhưng gửi nội dung thất bại\. Nội dung quá dài \(Z112\)$/)
    pass('sau V509, album rồi chữ bị 112: ghi "Đã gửi file nhưng gửi nội dung thất bại. Nội dung quá dài (Z112)", tính lượt, data hoàn thành, chiến dịch tạm dừng')

    console.log(`OK V509: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
