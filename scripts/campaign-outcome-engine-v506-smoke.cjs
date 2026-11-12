// V506: group thời gian thực (chờ data / hết ngày nhận) và kiêm gửi SMS (nội bộ qua RPC, akaBiz Sms qua cổng) bằng lõi thật
// (packages/campaign-engine) + cổng Zalo giả, trên PostgreSQL 17 cục bộ có đủ chuỗi V495 → V499 → … → V506. Kỳ vọng là hành vi Desktop
// (handleZaloRealtimeGroupCompletion, prepareZaloRealtimeGroupCampaignRun, pushZaloDetailToInternalSmsIfNeeded,
// pushZaloDetailToExternalSmsIfNeeded). Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v506-smoke.cjs
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
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V506_TEST_PORT || 55505)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v506-'))
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
const MEMBER = 'zalo_message_group_member'
const REALTIME = 'zalo_message_group_realtime'

async function main() {
  const E = await loadEngine()

  // ---- 1. Hỗ trợ (không cần DB) ------------------------------------------------------------------------------------
  {
    const core = (actionId, extra = {}) => ({ id: 1, actionId, accountId: 7, content: 'Chào', extraSettings: extra, images: [], dataTargetSourceMode: null })
    const env = { engagementTrackingEnabled: false }
    assert.deepEqual(E.zaloCampaignV2Support(core(REALTIME, { enableMessage: true }), env), { ok: true }, 'group thời gian thực chạy bộ mới')
    assert.deepEqual(E.zaloCampaignV2Support(core(PHONE, { enableMessage: true, internalSmsEnabled: true }), env), { ok: true }, 'kiêm SMS nội bộ: cả hai nơi')
    assert.deepEqual(E.zaloCampaignV2Support(core(PHONE, { enableMessage: true, externalSmsEnabled: true }), env), { ok: false, reason: 'sms_push_external' },
      'akaBiz Sms: nơi không có tích hợp (Fly) chạy bộ cũ')
    assert.deepEqual(E.zaloCampaignV2Support(core(PHONE, { enableMessage: true, externalSmsEnabled: true }), { ...env, externalSmsPush: true }), { ok: true },
      'akaBiz Sms: Desktop có tích hợp')
    assert.deepEqual(E.zaloCampaignV2Support(core(PHONE, { enableMessage: true, internalSmsEnabled: true, externalSmsEnabled: true }), env), { ok: true },
      'bật cả hai: nội bộ được ưu tiên như Desktop')
    // Bước sau khi ghi của group thời gian thực chỉ còn đăng ký tương tác (cổng không có thì không có bước), kể cả khi bật kiêm SMS.
    assert.equal(E.zaloCampaignType(REALTIME).afterReport(core(REALTIME, { enableMessage: true, internalSmsEnabled: true }), {}, { targetLabel: () => '' }),
      null, 'group thời gian thực không kiêm SMS')
    assert.equal(E.zaloCampaignType(PHONE).afterReport(core(PHONE, {}), {}, { targetLabel: () => '' }), null, 'không bật thì không có bước kiêm SMS')
    assert.equal(E.renderSmsLegacyTokens('[fullname]-[phone]-[info1]', { name: 'An', phone: '0901234567', info1: 'x' }, { displayName: 'Zalo An' }), 'An-0901234567-x')
  }
  pass('hỗ trợ: group thời gian thực; kiêm SMS nội bộ cả hai nơi, akaBiz Sms chỉ nơi có tích hợp; thẻ SMS cũ như Desktop')

  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v506-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505]) await db.query(m.migration)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r

    // ---- 2. Apply / gỡ -------------------------------------------------------------------------------------------
    const SIG = v506.SMS_SIG
    const finishMd5 = () => val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'::regprocedure`)
    assert.equal(await finishMd5(), v506.LIVE.finish)
    await db.query(v506.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await val(`SELECT to_regprocedure($1)`, [SIG]), null)
    assert.equal(await finishMd5(), v506.LIVE.finish)
    await db.query(v506.migration)
    assert.equal(await finishMd5(), v506.NEW.finish)
    await assert.rejects(db.query(v506.migration), /đã có/)
    await db.query('ROLLBACK')
    for (const role of ['anon', 'authenticated']) assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, SIG]), false)
    for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, SIG]), true)
    await db.query(v506.rollback)
    assert.equal(await val(`SELECT to_regprocedure($1)`, [SIG]), null)
    assert.equal(await finishMd5(), v506.LIVE.finish, 'gỡ: finish_campaign_v2 về thân V501')
    await db.query(v506.migration)
    pass('apply trong transaction rồi ROLLBACK không để lại gì; apply thật; apply lần hai bị chặn; quyền như các RPC engine; gỡ trả finish về V501 rồi apply lại')

    // ---- Dữ liệu thử ------------------------------------------------------------------------------------------
    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 980000
    const STAFF = 9601, ORG = 691
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const smsAccount = async name => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'sms', 'đã đăng nhập', 'chờ xử lý', true, false, $3, $4, false)`, [id, name, STAFF, ORG])
      return id
    }
    const make = async ({ actionId, extra = {}, targets = [], content = 'Chào #{INPUT_FULLNAME}', originalSchedule = null }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, original_schedule, is_delete, staff_id, organization_id,
        content, extra_settings, images, schedule_type, continue_next_day)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Kiêm SMS', $2, $3, 'chờ xử lý', now() - interval '1 minute', $4, false, $5, $6, $7, $8::jsonb, '[]'::jsonb, 'daily', false)`,
        [campaign, actionId, account, originalSchedule, STAFF, ORG, content, JSON.stringify(extra)])
      const ids = []
      for (const t of targets) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, phone, status, schedule, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', $6, false)`, [id, campaign, t.name ?? null, t.uid ?? null, t.phone ?? null, t.schedule ?? null])
        ids.push(id)
      }
      return { account, campaign, ids, actionId, extra, content }
    }
    const portError = (code, message) => E.zaloPortErrorFrom(Object.assign(new Error(message), { code }))
    const run = async (c, b = {}) => {
      const calls = [], lines = []
      const port = {
        findUser: async (_ctx, phone) => {
          calls.push(`find:${phone}`)
          if ((b.notFound ?? []).includes(phone)) throw portError('216', 'User not found')
          return E.normalizeZaloFoundUser({ userId: `u${phone.slice(-3)}`, display_name: `Zalo ${phone.slice(-3)}`, phoneNumber: phone, globalId: `g-${phone}` })
        },
        phoneSearchLimitScope: async () => null,
        saveFoundUser: async () => {},
        getUserProfile: async (_ctx, uid) => { calls.push(`profile:${uid}`); return E.normalizeZaloFoundUser({ userId: uid, display_name: `Thành viên ${uid}` }) },
        saveResolvedProfile: async () => {},
        isOptedOut: async () => false,
        prepareOptOutLink: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
        takeContentIndex: async () => 0,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid) => {
          calls.push(`text:${uid}`)
          if ((b.blocked ?? []).includes(uid)) throw portError('122', 'blocked stranger')
          return { response: { msgId: `m-${uid}` }, msgId: `m-${uid}` }
        },
        sendFriendRequest: async () => ({}),
        prepareMedia: async () => [], sendMedia: async () => { throw new Error('không có tệp') },
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1,
        pushInternalSms: async (ctx, input) => {
          calls.push(`sms:${input.row.phone}`)
          const r = await rpc('SELECT public.aka_agent_engine_sms_push_v1($1, $2, $3::jsonb) AS r',
            [ctx.targetRunId, ctx.leaseToken, JSON.stringify({ accountIds: b.smsAccountIds ?? input.accountIds, row: input.row, content: input.content })])
          if (r.ok !== true) throw new Error(`Không kiêm gửi SMS được: ${r.reason}`)
          return r.results.map(item => ({ accountId: Number(item.accountId), ok: item.ok === true, ...(item.error ? { error: item.error } : {}) }))
        },
        ...(b.external ? { pushExternalSms: async (_ctx, input) => { calls.push(`ext:${input.phone}:${input.name}:${input.content}`); return b.external(input) } } : {}),
        smsBusinessNow: async () => new Date()
      }
      const camp = await one(`SELECT name, note, extra_settings FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
      const core = { id: c.campaign, actionId: c.actionId, accountId: c.account, content: c.content, extraSettings: camp.extra_settings, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(c.actionId)
      const afterReport = type.afterReport?.(core, port, { targetLabel: type.targetLabel }) ?? null
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v506', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actionId: c.actionId,
        campaignName: camp.name, accountName: 'Zalo', campaignNote: camp.note, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } }),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        ...(afterReport ? { afterReport } : {}),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [c.account, info.leaseToken, info.note ?? null]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      return { result, calls, lines }
    }
    const camp = c => one(`SELECT status, note, schedule, original_schedule, extra_settings FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
    const children = c => rows(`SELECT id::integer AS id, name, action_id, account_id::integer AS account_id, status, content, extra_settings, schedule_type,
      continue_next_day, refresh_data, staff_id::integer AS staff_id FROM public.auto_campaigns
      WHERE action_id = 'sms_send' AND (extra_settings->>'internalSmsSourceCampaignId')::bigint = $1 ORDER BY id`, [c.campaign])
    const childInputs = id => rows(`SELECT name, phone, phone_carrier, uid, content, status FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [id])
    const reopen = c => db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute' WHERE id = $1`, [c.campaign])

    // ---- 3. Kiêm SMS nội bộ: không tồn tại (tra số) và nhắn tin thất bại thì đẩy; thành công thì không (theo trạng thái đã chọn) ----
    {
      const sms = await smsAccount('Sim 1')
      const c = await make({ actionId: PHONE, extra: { enableMessage: true, internalSmsEnabled: true, internalSmsAccountIds: [sms, String(sms)],
        internalSmsStatuses: ['Thất bại', 'không tồn tại', 'lạ'], internalSmsContent: 'SMS cho #{INPUT_FULLNAME}' },
        targets: [{ name: 'Khách 1', phone: '0901000001' }, { name: 'Khách 2', phone: '0901000002' }, { name: 'Khách 3', phone: '0901000003' }] })
      const r = await run(c, { notFound: ['0901000001'], blocked: ['u002'] })
      assert.equal(r.result.reason, 'no_target', JSON.stringify(r.result))
      assert.deepEqual(r.calls.filter(x => x.startsWith('sms:')), ['sms:0901000001', 'sms:0901000002'], 'thành công không nằm trong trạng thái đã chọn')
      const kids = await children(c)
      assert.equal(kids.length, 1, 'một chiến dịch SMS con cho mỗi tài khoản SMS')
      assert.deepEqual({ ...kids[0], id: undefined, extra_settings: undefined }, { id: undefined, name: 'Kiêm SMS - Kiêm SMS - Sim 1', action_id: 'sms_send',
        account_id: sms, status: 'chờ xử lý', content: 'SMS cho #{INPUT_FULLNAME}', extra_settings: undefined, schedule_type: 'daily',
        continue_next_day: true, refresh_data: true, staff_id: STAFF })
      assert.deepEqual(kids[0].extra_settings, { internalSmsSourceCampaignId: c.campaign, internalSmsSourceCampaignName: 'Kiêm SMS', internalSmsSourceActionId: PHONE })
      assert.deepEqual((await camp(c)).extra_settings.internalSmsCreatedCampaignIdsByAccount, { [String(sms)]: kids[0].id })
      const inputs = await childInputs(kids[0].id)
      assert.deepEqual(inputs.map(x => [x.name, x.phone, x.content, x.status]), [
        ['Khách 1', '0901000001', 'SMS cho Khách 1', 'chờ xử lý'], ['Zalo 002', '0901000002', 'SMS cho Khách 2', 'chờ xử lý']])
      assert.equal(inputs[0].phone_carrier, E.getVietnamMobileCarrier('0901000001') || null)
      assert.ok(r.lines.includes('✅ Đã kiêm gửi SMS cho 0901000001 sang 1 tài khoản Sms'), r.lines.join('\n'))
      assert.ok(r.lines.includes('✅ Đã kiêm gửi SMS cho 0901000002 sang 1 tài khoản Sms'), r.lines.join('\n'))
      // Dòng kiêm SMS ngay sau dòng lịch sử của bước, trước "✅ Hoàn thành" của data (như Desktop).
      const i = r.lines.indexOf('✅ Đã kiêm gửi SMS cho 0901000002 sang 1 tài khoản Sms')
      assert.match(r.lines[i - 1], /^Nhắn tin người lạ: /)
      // Lượt sau: chiến dịch con đã hoàn thành thì mở lại, không tạo chiến dịch con mới.
      await db.query(`UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = $1`, [kids[0].id])
      const more = ++nextId
      await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, 'Khách 4', '0901000004', 'chờ xử lý', false)`, [more, c.campaign])
      await reopen(c)
      await run(c, { notFound: ['0901000004'] })
      assert.equal((await children(c)).length, 1)
      assert.equal((await one(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [kids[0].id])).status, 'chờ xử lý', 'chiến dịch con hoàn thành được mở lại')
      assert.equal((await childInputs(kids[0].id)).length, 3)
    }
    pass('kiêm SMS nội bộ: tra số "không tồn tại" và nhắn tin "thất bại" thì đẩy (thành công không nằm trong trạng thái đã chọn); tạo chiến dịch SMS con như Desktop, ghi bản đồ; nội dung dựng theo data; lượt sau dùng lại và mở lại chiến dịch con')

    // ---- 4. RPC: chỉ tài khoản SMS đã chọn, tài khoản sai thì lỗi riêng; xác thực bằng lease ------------------------------
    {
      const good = await smsAccount('Sim A')
      const zalo = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Không phải SMS', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [zalo, STAFF, ORG])
      const c = await make({ actionId: PHONE, extra: { enableMessage: true, internalSmsEnabled: true, internalSmsAccountIds: [good, zalo],
        internalSmsStatuses: ['không tồn tại'], internalSmsContent: 'X' }, targets: [{ name: 'Một', phone: '0901000011' }] })
      const r = await run(c, { notFound: ['0901000011'], smsAccountIds: [good, zalo, 999999] })
      assert.ok(r.lines.includes('✅ Đã kiêm gửi SMS cho 0901000011 sang 1 tài khoản Sms'), r.lines.join('\n'))
      assert.ok(r.lines.includes(`⚠️ Không thể kiêm gửi SMS sang tài khoản Sms #${zalo}: Tài khoản Sms #${zalo} không tồn tại hoặc không hợp lệ.`), r.lines.join('\n'))
      assert.ok(r.lines.includes('⚠️ Không thể kiêm gửi SMS sang tài khoản Sms #999999: Tài khoản Sms #999999 không có trong cấu hình kiêm SMS của chiến dịch.'))
      assert.equal((await children(c)).length, 1, 'tài khoản lỗi không để lại chiến dịch con')
      const claim = await data.claimTarget({ runnerId: 'smoke', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actions: [{ code: 'zalo_find_phone_user' }] })
      const bad = await rpc('SELECT public.aka_agent_engine_sms_push_v1($1, $2, $3::jsonb) AS r',
        [999999999, '00000000-0000-4000-8000-000000000000', JSON.stringify({ accountIds: [good], row: { phone: '0901000099' }, content: 'x' })])
      assert.deepEqual(bad, { ok: false, reason: 'ownership_lost' })
      if (claim.leaseToken) await data.release(c.account, claim.leaseToken)
    }
    pass('RPC kiêm SMS: chỉ tài khoản SMS chiến dịch đã chọn và cùng nhân viên; tài khoản sai báo lỗi riêng, tài khoản khác vẫn đẩy; sai lease bị từ chối')

    // ---- 5. Thiếu SĐT (thành viên nhóm) và akaBiz Sms (Desktop) ----------------------------------------------------------
    {
      const c = await make({ actionId: MEMBER, extra: { enableMessage: true, internalSmsEnabled: true, internalSmsAccountIds: [await smsAccount('Sim B')],
        internalSmsStatuses: ['thất bại'] }, targets: [{ name: 'TV', uid: 'gm-1' }] })
      const r = await run(c, { blocked: ['gm-1'] })
      assert.ok(r.lines.includes('⚠️ Không thể kiêm gửi SMS vì thiếu SĐT cho TV'), r.lines.join('\n'))
      assert.deepEqual(r.calls.filter(x => x.startsWith('sms:')), [])

      const e = await make({ actionId: PHONE, extra: { enableMessage: true, externalSmsEnabled: true, externalSmsShopIds: [11, '12'], externalSmsStatuses: ['không tồn tại'],
        externalSmsContent: 'Chào [fullname] ([phone])' }, targets: [{ name: 'Ngoài', phone: '0901000021' }] })
      const r2 = await run(e, { notFound: ['0901000021'], external: input => ({ results: input.shopIds.map(shopId => shopId === 12 ? { shopId, ok: false, error: 'hết hạn' } : { shopId, ok: true }) }) })
      assert.deepEqual(r2.calls.filter(x => x.startsWith('ext:')), ['ext:0901000021:Ngoài:Chào Ngoài (0901000021)'])
      assert.ok(r2.lines.includes('⚠️ Không thể kiêm gửi SMS sang tài khoản #12: hết hạn'), r2.lines.join('\n'))
      assert.ok(r2.lines.includes('✅ Đã kiêm gửi SMS cho 0901000021 sang 1 tài khoản akaBiz Sms'))

      const n = await make({ actionId: PHONE, extra: { enableMessage: true, externalSmsEnabled: true, externalSmsShopIds: [11], externalSmsStatuses: ['không tồn tại'] },
        targets: [{ name: 'Chưa tích hợp', phone: '0901000031' }] })
      const r3 = await run(n, { notFound: ['0901000031'], external: () => ({ integrationMissing: true, integrationError: 'mạng lỗi', results: [] }) })
      const k = r3.lines.indexOf('⚠️ Không thể tải tích hợp akaBiz: mạng lỗi')
      assert.ok(k >= 0 && r3.lines[k + 1] === '⚠️ Chưa tích hợp akaBiz Sms nên không thể kiêm gửi SMS.', r3.lines.join('\n'))
    }
    pass('kiêm SMS: thiếu SĐT thì cảnh báo như Desktop; akaBiz Sms dựng nội dung (thẻ [fullname]/[phone]), lỗi từng shop, chưa tích hợp có câu')

    // ---- 6. Group thời gian thực: chờ data / tiếp tục chờ / hẹn data tương lai / hết ngày nhận -------------------------------
    {
      const vnToday = await val(`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD')`)
      const vnSlot = iso => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
      const anchor = new Date(Date.now() + 3 * 3600_000).toISOString()
      const w = await make({ actionId: REALTIME, extra: { enableMessage: true, zaloRealtimeEndDate: vnToday }, originalSchedule: anchor })
      const r = await run(w, {})
      assert.equal(r.result.reason, 'no_target')
      assert.deepEqual(r.lines, ['⏳ Chiến dịch "Kiêm SMS" đang chờ data theo thời gian thực từ group Zalo'], 'chưa chạy data: "đang chờ", không có 🚀')
      const st = await camp(w)
      assert.equal(st.status, 'chờ xử lý')
      assert.equal(vnSlot(st.schedule), vnSlot(anchor), 'chờ tới giờ gốc của chiến dịch')
      assert.ok(new Date(st.schedule).getTime() > Date.now() && new Date(st.schedule).getTime() - Date.now() <= 24 * 3600_000)

      const t = await make({ actionId: REALTIME, extra: { enableMessage: true, zaloRealtimeEndDate: vnToday }, originalSchedule: anchor,
        targets: [{ name: 'Người mới', uid: 'rt-1' }] })
      const r2 = await run(t, {})
      assert.deepEqual(r2.calls.filter(x => x.startsWith('text:')), ['text:rt-1'])
      assert.equal(r2.lines.at(-1), '⏳ Chiến dịch "Kiêm SMS" tiếp tục chờ data theo thời gian thực từ group Zalo', 'đã chạy data: "tiếp tục chờ"')

      const f = await make({ actionId: REALTIME, extra: { enableMessage: true, zaloRealtimeEndDate: vnToday },
        targets: [{ name: 'Mai', uid: 'rt-2', schedule: new Date(Date.now() + 3600_000).toISOString() }] })
      const r3 = await run(f, {})
      assert.match(r3.lines.at(-1), /^⏳ Hẹn chạy tiếp chiến dịch lúc /, r3.lines.join('\n'))

      const done = await make({ actionId: REALTIME, extra: { enableMessage: true, zaloRealtimeEndDate: '2026-10-24' } })
      const r4 = await run(done, {})
      assert.deepEqual(r4.lines, ['✅ Hoàn thành chiến dịch "Kiêm SMS" (hết ngày nhận data theo thời gian thực)'])
      assert.deepEqual(await camp(done).then(x => [x.status, x.note]), ['hoàn thành', 'Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy'])
      const iso = await make({ actionId: REALTIME, extra: { enableMessage: true, zaloRealtimeEndDate: new Date(Date.now() + 86400_000).toISOString() } })
      await run(iso, {})
      assert.equal((await camp(iso)).status, 'chờ xử lý', 'ngày kết thúc dạng ISO: đọc ngày VN')
      const none = await make({ actionId: REALTIME, extra: { enableMessage: true } })
      await run(none, {})
      assert.equal((await camp(none)).status, 'hoàn thành', 'không đặt ngày kết thúc: coi như hết ngày nhận (như Desktop)')
    }
    pass('group thời gian thực: chưa có data "đang chờ" tới giờ gốc; sau khi chạy data "tiếp tục chờ"; data tương lai thì hẹn; hết ngày nhận (hoặc không đặt) thì hoàn thành kèm câu')

    console.log(`OK V506: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
