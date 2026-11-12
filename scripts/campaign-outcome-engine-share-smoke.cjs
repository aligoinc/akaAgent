// Gửi dạng chia sẻ (nhắn bạn bè / group, zaloMessageSendMode 'share') bằng lõi thật (packages/campaign-engine) + cổng Zalo giả, trên
// PostgreSQL 17 cục bộ có đủ chuỗi V495 → V499 → V500 → V501 → V503. Kỳ vọng là hành vi của bộ chạy Desktop
// (executeZaloShareMessageBatchCampaign + processZaloShareMessageBatch) cộng các thay đổi đã duyệt. Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-share-smoke.cjs
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
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.SHARE_TEST_PORT || 55504)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-share-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

function testClock(heartbeatMs = 60000) {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms !== heartbeatMs) return setImmediate(() => resolve(!signal?.aborted))
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
  }
}

const FRIEND = 'zalo_message_friend'
const GROUP = 'zalo_message_group'

async function main() {
  const E = await loadEngine()

  // ---- 1. Hỗ trợ, luật kiểm đầu lượt ------------------------------------------------------------------------
  const core = (actionId, extra = {}, content = 'Chào cả nhà', images = []) =>
    ({ id: 1, actionId, accountId: 7, content, extraSettings: { zaloMessageSendMode: 'share', ...extra }, images, dataTargetSourceMode: null })
  const env = { engagementTrackingEnabled: false }
  assert.deepEqual(E.zaloCampaignV2Support(core(GROUP), env), { ok: true })
  assert.deepEqual(E.zaloCampaignV2Support(core(FRIEND), env), { ok: true })
  assert.deepEqual(E.zaloCampaignV2Support(core(GROUP, { zaloShareRepeatEnabled: true, zaloShareRepeatAfterMinutes: 30 }), env), { ok: true },
    'gửi lặp lại sau x phút: finish_campaign_v2 (V501) xử lý')
  assert.deepEqual(E.zaloCampaignV2Support(core(FRIEND), { engagementTrackingEnabled: true }), { ok: false, reason: 'engagement_tracking' })
  assert.deepEqual(E.zaloCampaignV2Support(core(GROUP), { engagementTrackingEnabled: true }), { ok: true }, 'group không có theo dõi tương tác')
  assert.deepEqual(E.zaloCampaignV2Support(core(FRIEND, { zaloFriendBlocklistEnabled: true }), env), { ok: true }, 'danh sách không gửi tin kiểu cũ chạy bộ mới (V504)')
  assert.deepEqual(E.zaloCampaignV2Support(core(FRIEND, { zaloSendExclusionsByAccountId: { 7: { groupId: 5, blocklistIds: [] } } }), env),
    { ok: true }, 'loại trừ gửi khi chia sẻ chạy bộ mới (V504)')
  assert.deepEqual(E.zaloCampaignV2Support(core('zalo_message_phone', { enableMessage: true }), env), { ok: false, reason: 'share_mode' },
    'loại khác không có dạng chia sẻ')
  const type = E.zaloCampaignType(GROUP)
  assert.ok(type.buildBatch(core(GROUP), {}, {}), 'chia sẻ chạy theo lô')
  assert.equal(type.buildBatch({ ...core(GROUP), extraSettings: {} }, {}, {}), null, 'gửi thường chạy từng data')
  assert.deepEqual(type.validate(core(GROUP, {}, ''), { zaloWeb: false }).map(i => i.publicCode), ['CFG17'], 'không chữ không tệp → CFG17')
  assert.deepEqual(type.validate(core(GROUP, {}, '', [{ name: 'a.jpg', cloudUrl: 'https://x/a.jpg' }]), { zaloWeb: false }), [], 'có tệp thì không cần chữ')
  assert.deepEqual(type.validate(core(GROUP, { imageOption: 'none' }, '', [{ name: 'a.jpg', cloudUrl: 'https://x/a.jpg' }]), { zaloWeb: false })
    .map(i => i.publicCode), ['CFG17'], 'tắt media thì như không có tệp')
  assert.deepEqual(type.validate(core(GROUP, { formattedContentEnabled: true }, '<p> </p>'), { zaloWeb: false }).map(i => i.publicCode), ['CFG17'],
    'nội dung định dạng rỗng')
  pass('hỗ trợ: chia sẻ bạn bè / group chạy bộ mới (kể cả gửi lặp lại); luật đầu lượt CFG17 như Desktop')

  // ---- 2. Chạy thật với RPC ---------------------------------------------------------------------------------
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-share-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    for (const sql of [MIGRATION, v499.migration, V500, v501.migration, v503.migration]) await db.query(sql)
    // Mã thử gắn mã Zalo 9001 (lỗi thường, không hiệu ứng phụ) và 9002 (khoá thao tác 30 phút) cho thao tác chia sẻ.
    for (const [code, pub] of [['err_test_share_plain', 'TST21'], ['err_test_share_lock', 'TST22']]) {
      await db.query(`INSERT INTO public.auto_error SELECT (jsonb_populate_record(NULL::public.auto_error,
          to_jsonb(e) || jsonb_build_object('id', (SELECT max(id) + 1 FROM public.auto_error), 'error_code', $1::text, 'public_code', $2::text, 'error_class', 'transient'))).*
        FROM public.auto_error e WHERE e.error_code = 'err_engine_unknown_delivery'`, [code, pub])
    }
    const failedId = (await db.query(`SELECT id FROM public.auto_status WHERE code = 'campaign_detail_failed' AND component_type = 'campaign_detail' ORDER BY id LIMIT 1`)).rows[0].id
    await db.query(`INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, quota_effect, target_streak_effect, target_effect,
        remaining_steps, lock_action_codes, lock_mode, lock_minutes, run_effect, pace_mode, campaign_effect, account_effect, login_effect, source, description)
      VALUES ('err_test_share_plain', 'write', $1, 'Lỗi thử chia sẻ', 'count', 'increment', 'complete', 'skip', '{}', NULL, NULL, 'continue', 'none', 'none', 'none', 'none', 'test', 'test'),
             ('err_test_share_lock', 'write', $1, 'Khoá thử chia sẻ', 'no_count', 'increment', 'complete', 'skip', '{zalo_message_friend,zalo_message_group}', 'fixed_minutes', 30, 'end_unit', 'none', 'none', 'none', 'none', 'test', 'test')`,
      [failedId])
    await db.query(`INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
      ('zalo', NULL, NULL, 'zalo_code', '9001', 300, 'err_test_share_plain', 'test', 'test'),
      ('zalo', NULL, NULL, 'zalo_code', '9002', 300, 'err_test_share_lock', 'test', 'test')`)

    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      reportBatch: (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r', [tok, JSON.stringify(items), size, stopped]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 950000
    const make = async ({ actionId = GROUP, extra = {}, content = 'Chào cả nhà', images = [], targets }) => {
      const account = ++nextId, campaign = ++nextId, staff = 9301, org = 661
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, staff, org])
      const extraSettings = { zaloMessageSendMode: 'share', actionLimits: { byActionCode: { [actionId]: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } }, ...extra }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings, images)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chia sẻ', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [campaign, actionId, account, staff, org, content, JSON.stringify(extraSettings), JSON.stringify(images)])
      const ids = []
      for (const t of targets) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', false)`, [id, campaign, t.name ?? null, t.uid ?? null, t.phone ?? null])
        ids.push(id)
      }
      return { account, campaign, staff, ids, actionId, extra: extraSettings, content, images }
    }
    const err = (message, code) => Object.assign(new Error(message), code === undefined ? {} : { code })
    const zaloErr = (message, code) => E.zaloPortErrorFrom(err(message, code), { operation: 'send', answered: true })
    const run = async (c, b = {}) => {
      const calls = [], lines = []
      const controller = new AbortController()
      const port = {
        getUserProfile: async (_ctx, uid) => {
          calls.push(`profile:${uid}`)
          return E.normalizeZaloFoundUser({ userId: uid, display_name: `Bạn ${uid}`, zalo_name: `Bạn ${uid}`, phoneNumber: `8491200${uid}`, globalId: `g-${uid}` })
        },
        saveResolvedProfile: async (_ctx, target) => { calls.push(`save:${target.uid}`) },
        isOptedOut: async (_ctx, identity) => { calls.push(`optout:${identity.phone ?? identity.globalId}`); return b.optOut === (identity.phone ?? identity.globalId) },
        takeContentIndex: async (_ctx, _action, count) => { calls.push(`index:${count}`); return 0 },
        prepareMedia: async (_ctx, items) => { calls.push(`prepare:${items.length}`); return items.map(item => ({ name: E.campaignMediaName(item), ref: item.cloudUrl })) },
        rewriteMessage: async (_ctx, content) => { calls.push('ai'); if (b.ai instanceof Error) throw b.ai; return `AI: ${content}` },
        sendMedia: async (_ctx, input) => {
          calls.push(`media:${input.threadType}:${input.threadId}:${input.files.length}:${input.message ? 'text' : ''}`)
          if (b.abortAtMedia === input.threadId) { controller.abort(); await new Promise(r => setTimeout(r, 50)) }
          const failure = b.media?.[input.threadId]
          if (failure) throw failure
          return { response: { attachment: [{ msgId: `m-${input.threadId}` }] }, msgId: null }
        },
        forwardMessage: async (_ctx, input) => {
          calls.push(`forward:${input.threadType}:${input.threadIds.join(',')}:${typeof input.message === 'string' ? input.message : input.message.msg}`)
          if (b.forward instanceof Error) throw b.forward
          return { response: { ok: true }, results: input.threadIds.filter(id => !(b.missing ?? []).includes(id)).map(id => {
            const code = b.forwardCodes?.[id]
            return code ? { threadId: id, ok: false, errorCode: String(code), errorMessage: `Lỗi ${code}` } : { threadId: id, ok: true }
          }) }
        }
      }
      const cc = { id: c.campaign, actionId: c.actionId, accountId: c.account, content: c.content, extraSettings: c.extra, images: c.images, dataTargetSourceMode: null }
      const t = E.zaloCampaignType(c.actionId)
      const batch = t.buildBatch(cc, port, { sleepBetweenBatchesSeconds: b.sleep ?? 0, readTimeoutMs: 5000, mediaTimeoutMs: 5000, sendTimeoutMs: 5000 })
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:share', runtimeTarget: 'desktop', staffId: c.staff, accountId: c.account, campaignId: c.campaign, actionId: c.actionId,
        campaignName: 'Chia sẻ', accountName: 'Zalo', campaignNote: null, targetLabel: t.targetLabel,
        actionName: code => t.actionNames[code] ?? code, ...t.claimPlan(cc), buildSteps: () => [], batch,
        validateCampaign: () => t.validate?.(cc, { zaloWeb: false }) ?? [],
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) AS r', [c.account, info.leaseToken]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: 60000, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, controller.signal)
      return { result, calls, lines }
    }
    const details = c => rows(`SELECT input_data_id, action_code, status, error_code, counts_toward_limit, log, data FROM public.auto_campaign_details
      WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
    const inputs = c => rows(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
    const camp = c => rows(`SELECT status, note, schedule FROM public.auto_campaigns WHERE id = $1`, [c.campaign]).then(r => r[0])
    const locks = c => rows(`SELECT action_code FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable`, [c.account])

    // S1: group chỉ chữ: một lệnh chia sẻ cho cả lô, bỏ tiền tố "g"; không "▶️"/"✅" từng data; "📨" tổng kết; hoàn thành chiến dịch.
    const s1 = await make({ targets: [{ name: 'Nhóm A', uid: 'g111' }, { name: 'Nhóm B', uid: '222' }, { name: 'Nhóm C', uid: 'g333' }] })
    const r1 = await run(s1)
    assert.deepEqual(r1.calls, ['forward:group:111,222,333:Chào cả nhà'], 'group: không đọc hồ sơ, không kiểm từ chối; một lệnh mforward')
    const d1 = await details(s1)
    assert.deepEqual(d1.map(d => [d.action_code, d.status, d.log]), [
      ['zalo_message_group', 'thành công', 'Đã chia sẻ tin nhắn vào group Nhóm A'],
      ['zalo_message_group', 'thành công', 'Đã chia sẻ tin nhắn vào group Nhóm B'],
      ['zalo_message_group', 'thành công', 'Đã chia sẻ tin nhắn vào group Nhóm C']])
    assert.equal(d1[0].data.sendMode, 'share')
    assert.ok(d1.every(d => d.counts_toward_limit === true), 'tính lượt')
    assert.deepEqual((await inputs(s1)).map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành'])
    assert.deepEqual(r1.lines, [
      '🚀 Bắt đầu chiến dịch "Chia sẻ" trên tài khoản "Zalo"',
      '📨 Kết quả chia sẻ tin nhắn Zalo: tổng 3, thành công 3, thất bại 0',
      '✅ Hoàn thành chiến dịch "Chia sẻ"'
    ], 'không có dòng "▶️" / "✅" từng data, không dòng thành công từng người (như Desktop)')
    assert.equal((await camp(s1)).status, 'hoàn thành')
    pass('group chỉ chữ: một lệnh chia sẻ cho cả lô (bỏ "g"), lịch sử "Đã chia sẻ tin nhắn vào group …", dòng 📨 như Desktop, hoàn thành')

    // S2: bạn bè có tệp + chữ: từ chối nhận tin + hồ sơ từng người, tệp gửi riêng từng người (không chữ), rồi một lệnh chia sẻ chữ.
    const imgs = [{ name: 'a.jpg', cloudUrl: 'https://x/a.jpg' }, { name: 'b.jpg', cloudUrl: 'https://x/b.jpg' }]
    const s2 = await make({ actionId: FRIEND, images: imgs, targets: [{ name: 'Lan', uid: '1', phone: '0912000001' }, { name: 'Huệ', uid: '2' }] })
    const r2 = await run(s2)
    assert.deepEqual(r2.calls, [
      'optout:0912000001', 'profile:1', 'optout:84912001', 'optout:g-1', 'save:1',
      'profile:2', 'optout:84912002', 'optout:g-2', 'save:2',
      'prepare:2', 'media:user:1:2:', 'media:user:2:2:', 'forward:user:1,2:Chào cả nhà'
    ], 'thứ tự như Desktop: từ chối nhận tin theo SĐT → hồ sơ → SĐT hồ sơ → global ID → lưu danh bạ; tệp từng người rồi chia sẻ chữ')
    const d2 = await details(s2)
    assert.deepEqual(d2.map(d => [d.status, d.log]), [['thành công', 'Đã chia sẻ tin nhắn đến Bạn 1'], ['thành công', 'Đã chia sẻ tin nhắn đến Bạn 2']])
    assert.deepEqual(d2[0].data.attachments, ['a.jpg', 'b.jpg'])
    assert.ok(d2[0].data.mediaResponse && d2[0].data.forwardResponse)
    pass('bạn bè có tệp: kiểm từ chối nhận tin + hồ sơ từng người, tệp riêng từng người không chữ, một lệnh chia sẻ chữ; dòng lịch sử như Desktop')

    // S3: lô có người nhận được: chữ của một người lỗi sau khi đã nhận tệp (giao một phần), người khác thành công; lỗi khoá không áp.
    const s3 = await make({ actionId: FRIEND, images: imgs, targets: [{ name: 'An', uid: '31' }, { name: 'Bình', uid: '32' }] })
    const r3 = await run(s3, { forwardCodes: { 32: 9002 } })
    const d3 = await details(s3)
    assert.equal(d3[0].status, 'thành công')
    assert.equal(d3[1].status, 'thất bại')
    assert.equal(d3[1].log, 'Đã gửi file nhưng gửi nội dung thất bại. Khoá thử chia sẻ (TST22)')
    assert.equal(d3[1].counts_toward_limit, true, 'giao một phần luôn tính lượt')
    assert.equal((await locks(s3)).length, 0, 'lô có người nhận được: lỗi của người khác không khoá thao tác')
    assert.ok(r3.lines.includes('⚠️ Nhắn tin bạn bè: Đã gửi file nhưng gửi nội dung thất bại. Khoá thử chia sẻ (TST22)'))
    assert.ok(r3.lines.includes('📨 Kết quả chia sẻ tin nhắn Zalo: tổng 2, thành công 1, thất bại 1'))
    assert.deepEqual((await inputs(s3)).map(i => i.status), ['hoàn thành', 'hoàn thành'], 'đã nhận tệp: không gửi lại')
    pass('giao một phần (đã nhận tệp, chữ lỗi): "Đã gửi file nhưng gửi nội dung thất bại. …", tính lượt, không gửi lại; lô có người nhận được nên không khoá')

    // S4: cả lô không ai nhận được (chỉ chữ, mọi người lỗi thường): tạm dừng chiến dịch đúng câu Desktop, "⏸ Kết thúc batch".
    const s4 = await make({ targets: [{ name: 'X', uid: '41' }, { name: 'Y', uid: '42' }] })
    const r4 = await run(s4, { forwardCodes: { 41: 9001, 42: 9001 } })
    const c4 = await camp(s4)
    assert.equal(c4.status, 'tạm dừng')
    assert.equal(c4.note, 'Toàn bộ 2 target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra')
    assert.ok(r4.lines.includes('⚠️ Nhắn tin group: Lỗi thử chia sẻ (TST21)'), 'lỗi giống nhau chỉ in một lần')
    assert.equal(r4.lines.filter(l => l.startsWith('⚠️ Nhắn tin group')).length, 1)
    assert.ok(r4.lines.includes('📨 Kết quả chia sẻ tin nhắn Zalo: tổng 2, thành công 0, thất bại 2'))
    assert.ok(r4.lines.includes('⏸ Kết thúc batch: Toàn bộ 2 target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra'))
    assert.equal(r4.result.reason, 'stop_campaign')
    pass('cả lô không ai nhận được: tạm dừng chiến dịch "Toàn bộ N target…", mỗi lỗi khác nhau in một lần, "⏸ Kết thúc batch: …"')

    // S5: không ai nhận được, người thứ hai có lỗi khoá: chỉ người đó áp đủ chính sách (khoá), rồi vẫn tạm dừng "toàn bộ thất bại".
    const s5 = await make({ targets: [{ name: 'X', uid: '51' }, { name: 'Y', uid: '52' }] })
    await run(s5, { forwardCodes: { 51: 9001, 52: 9002 } })
    assert.deepEqual((await locks(s5)).map(l => l.action_code).sort(), ['zalo_message_friend', 'zalo_message_group'], 'người có hiệu ứng mạnh nhất áp khoá')
    assert.equal((await camp(s5)).status, 'tạm dừng')
    pass('không ai nhận được: người có hiệu ứng mạnh nhất (khoá) áp đủ chính sách, chiến dịch tạm dừng "toàn bộ thất bại"')

    // S6: bạn bè đã từ chối nhận tin: báo riêng (OPT01, tạm dừng data), không vào lô; người khác vẫn chia sẻ.
    const s6 = await make({ actionId: FRIEND, targets: [{ name: 'Mai', uid: '61', phone: '0912000061' }, { name: 'Đào', uid: '62' }] })
    const r6 = await run(s6, { optOut: 'g-61' })
    assert.ok(r6.calls.includes('forward:user:62:Chào cả nhà'), 'chỉ người chưa từ chối vào lệnh chia sẻ')
    const i6 = await inputs(s6)
    assert.deepEqual([i6[0].status, i6[0].note], ['tạm dừng', 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo (OPT01)'])
    assert.ok(r6.lines.some(l => l.startsWith('🚫 Bỏ qua "Mai"')))
    assert.ok(r6.lines.includes('📨 Kết quả chia sẻ tin nhắn Zalo: tổng 1, thành công 1, thất bại 0'), 'người từ chối không tính vào lô (như Desktop)')
    pass('người nhận đã từ chối nhận tin: báo riêng "🚫 Bỏ qua …" (OPT01, data tạm dừng), không vào lệnh chia sẻ')

    // S7: data thiếu ID: vào lô như lỗi DAT01 (Desktop: 114 "ID group Zalo không hợp lệ"), người khác thành công nên chỉ ghi cho data đó.
    const s7 = await make({ targets: [{ name: 'Thiếu ID' }, { name: 'Nhóm D', uid: 'g71' }] })
    const r7 = await run(s7)
    const d7 = await details(s7)
    const missing = d7.find(d => Number(d.input_data_id) === s7.ids[0])
    assert.equal(missing.error_code, 'err_input_invalid')
    assert.match(missing.log, /ID group Zalo không hợp lệ|DAT01/)
    assert.ok(r7.lines.includes('📨 Kết quả chia sẻ tin nhắn Zalo: tổng 2, thành công 1, thất bại 1'))
    pass('data thiếu ID group: lỗi DAT01 trong lô (không gọi Zalo cho data đó), người khác vẫn chia sẻ')

    // S8: tệp quá giờ / không rõ đã tới với một người: báo ngay (UNK01, không gửi lại), người khác vẫn được chia sẻ chữ.
    const s8 = await make({ images: imgs, targets: [{ name: 'Nhóm E', uid: '81' }, { name: 'Nhóm F', uid: '82' }] })
    const timeout = new E.ZaloPortError('Gửi media quá thời gian chờ', { code: 'campaign_media_timeout', phase: 'in_flight',
      signal: { kind: 'engine', code: 'campaign_media_timeout', message: 'Gửi media quá thời gian chờ' }, evidence: { deliveryState: 'unknown' } })
    const r8 = await run(s8, { media: { 81: timeout } })
    assert.ok(r8.calls.includes('forward:group:82:Chào cả nhà'), 'không chia sẻ chữ cho người tệp không rõ đã tới')
    const d8 = await details(s8)
    const unk = d8.find(d => Number(d.input_data_id) === s8.ids[0])
    assert.equal(unk.status !== 'thành công', true)
    assert.equal((await inputs(s8))[0].status, 'hoàn thành', 'không rõ đã tới: không gửi lại')
    assert.ok(r8.lines.includes('📨 Kết quả chia sẻ tin nhắn Zalo: tổng 2, thành công 1, thất bại 1'))
    pass('tệp quá giờ / không rõ đã tới: ghi ngay theo thứ tự gửi, không gửi lại, không chia sẻ chữ cho người đó; người khác vẫn chia sẻ')

    // S9: lỗi cả lệnh chia sẻ (đứt mạng giữa chừng): mọi người không rõ đã tới (UNK01), người đã nhận tệp là giao một phần.
    const s9 = await make({ targets: [{ name: 'Nhóm G', uid: '91' }, { name: 'Nhóm H', uid: '92' }] })
    await run(s9, { forward: E.zaloPortErrorFrom(err('socket hang up'), { operation: 'send', answered: false }) })
    const d9 = await details(s9)
    assert.ok(d9.every(d => d.error_code === 'err_engine_unknown_delivery'), 'đứt giữa lệnh gửi: không rõ đã tới')
    assert.deepEqual((await inputs(s9)).map(i => i.status), ['hoàn thành', 'hoàn thành'], 'không gửi lại')
    pass('lỗi cả lệnh chia sẻ sau khi đã gửi: không rõ đã tới (UNK01) cho mọi người, không gửi lại')

    // S10: lô nhiều: 60 bạn bè chỉ chữ → 2 lô (50 + 10), hai lệnh chia sẻ.
    const s10 = await make({ targets: Array.from({ length: 60 }, (_, i) => ({ name: `G${i}`, uid: String(1000 + i) })) })
    const r10 = await run(s10)
    const forwards = r10.calls.filter(x => x.startsWith('forward:'))
    assert.equal(forwards.length, 2)
    assert.equal(forwards[0].split(':')[2].split(',').length, 50)
    assert.equal(forwards[1].split(':')[2].split(',').length, 10)
    assert.equal(r10.lines.filter(l => l.startsWith('📨')).length, 2)
    assert.ok(!r10.lines.some(l => l.startsWith('⏳ Nghỉ')), 'nghỉ giữa hai lô không in dòng (như Desktop)')
    assert.equal((await camp(s10)).status, 'hoàn thành')
    pass('lô tối đa 50 data: 60 data → hai lô 50 + 10, hai lệnh chia sẻ, không in dòng nghỉ')

    // S11: hết lượt khung giờ giữa chừng: lô tự giới hạn theo lượt còn lại, lô sau phải chờ.
    const s11 = await make({ targets: Array.from({ length: 6 }, (_, i) => ({ name: `L${i}`, uid: String(1100 + i) })),
      extra: { actionLimits: { byActionCode: { zalo_message_group: { dailyLimit: 100, rateLimitCount: 4, rateLimitMinutes: 60 } } } } })
    const r11 = await run(s11)
    assert.equal(r11.calls.filter(x => x.startsWith('forward:'))[0].split(':')[2].split(',').length, 4, 'lô theo 4 lượt còn lại')
    assert.equal(r11.result.reason, 'wait', 'lô sau phải chờ hạn mức khung giờ')
    assert.deepEqual((await inputs(s11)).map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành', 'chờ xử lý', 'chờ xử lý'])
    pass('lô tự giới hạn theo lượt còn lại trong khung giờ (getZaloShareMessageBatchCapacity); lô sau chờ hạn mức')

    // S12: AI viết lại một lần cho cả lô; lỗi AI thì dùng nội dung gốc, không báo khách.
    const s12 = await make({ extra: { rewriteContentEachRun: true }, targets: [{ name: 'A', uid: '121' }, { name: 'B', uid: '122' }] })
    const r12 = await run(s12)
    assert.deepEqual(r12.calls.filter(x => x === 'ai' || x.startsWith('forward:')), ['ai', 'forward:group:121,122:AI: Chào cả nhà'])
    const s12b = await make({ extra: { rewriteContentEachRun: true }, targets: [{ name: 'A', uid: '123' }] })
    const r12b = await run(s12b, { ai: new Error('AI lỗi') })
    assert.ok(r12b.calls.includes('forward:group:123:Chào cả nhà'))
    assert.ok(!r12b.lines.some(l => l.includes('AI')), 'không báo khách khi AI lỗi (như Desktop)')
    pass('AI viết lại một lần cho cả lô; lỗi AI dùng nội dung gốc, không báo khách')

    // S13: không chữ không tệp → CFG17: tạm dừng chiến dịch một lần, data về hàng đợi.
    const s13 = await make({ content: '', targets: [{ name: 'A', uid: '131' }, { name: 'B', uid: '132' }] })
    const r13 = await run(s13)
    assert.equal(r13.calls.length, 0)
    const c13 = await camp(s13)
    assert.equal(c13.status, 'tạm dừng')
    assert.equal(c13.note, 'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo (CFG17)')
    assert.deepEqual((await inputs(s13)).map(i => i.status), ['chờ xử lý', 'chờ xử lý'])
    assert.equal((await details(s13)).length, 0)
    pass('không chữ không tệp: CFG17 tạm dừng chiến dịch một lần, data về hàng đợi, không ghi lịch sử')

    // S14: gửi lặp lại sau x phút: xong lượt thì hẹn lại, data về chờ xử lý cho lượt sau (V501).
    const s14 = await make({ extra: { zaloShareRepeatEnabled: true, zaloShareRepeatAfterMinutes: 30 }, targets: [{ name: 'A', uid: '141' }] })
    const r14 = await run(s14)
    const c14 = await camp(s14)
    if (r14.lines.some(l => l.startsWith('⏳ Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch'))) {
      assert.equal(c14.status, 'chờ xử lý')
      assert.ok(new Date(c14.schedule).getTime() > Date.now() + 25 * 60e3, 'hẹn sau 30 phút')
      assert.equal((await inputs(s14))[0].status, 'chờ xử lý', 'data đặt lại cho lượt sau')
    } else {
      // Gần cuối ngày: lượt kế tiếp sang ngày mới / quá giờ dừng thì hoàn thành (như Desktop).
      assert.ok(r14.lines.some(l => /lượt gửi lặp kế tiếp/.test(l)), r14.lines.join('\n'))
    }
    pass('gửi lặp lại sau x phút: xong lượt thì hẹn lại và đặt lại data (finish_campaign_v2 của V501)')

    // S15: thoát app giữa lô: data chưa ghi dấu "sắp gửi" về hàng đợi; data đã ghi dấu để bộ dọn data dở đóng (không gửi lại).
    const s15 = await make({ images: imgs, targets: [{ name: 'A', uid: '151' }, { name: 'B', uid: '152' }, { name: 'C', uid: '153' }] })
    const r15 = await run(s15, { abortAtMedia: '152' })
    assert.equal(r15.result.reason, 'cancelled')
    const i15 = await inputs(s15)
    assert.deepEqual(i15.map(i => i.status), ['đang chạy', 'đang chạy', 'chờ xử lý'], 'đã ghi dấu: để close_stale đóng; chưa ghi dấu: về hàng đợi')
    assert.ok(!r15.calls.some(x => x.startsWith('forward:')), 'không chia sẻ chữ khi đang dừng')
    pass('thoát app giữa lô: data chưa ghi dấu "sắp gửi" về hàng đợi, data đã ghi dấu không bị trả về hàng đợi (không gửi trùng)')

    console.log(`OK chia sẻ: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => undefined)
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
