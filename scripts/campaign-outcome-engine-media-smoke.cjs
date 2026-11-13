// Gửi tệp/album của "Nhắn tin theo SĐT" bằng lõi thật (packages/campaign-engine) + cổng Zalo giả, trên PostgreSQL 17 cục bộ có
// đủ chuỗi production V495 → V499 → V500 → V501. Kỳ vọng là hành vi của bộ chạy Desktop (dispatchZaloMessage,
// finalizeZaloPartialSendDetail) cộng các thay đổi đã duyệt (CFG01/CFG10 kiểm một lần). Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-media-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.MEDIA_TEST_PORT || 55502)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const out = fs.mkdtempSync(path.join((fs.mkdirSync(path.join(ROOT, 'node_modules', '.cache'), { recursive: true }), path.join(ROOT, 'node_modules', '.cache')), 'aka-engine-media-')) // trong repo: lõi import htmlparser2 từ node_modules
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

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

async function main() {
  const E = await loadEngine()

  // ---- 1. Hàm thuần: chọn tệp, thứ tự gửi -------------------------------------------------------------
  const camp = (images, extra = {}) => ({ images, extraSettings: extra })
  assert.deepEqual(E.selectZaloCampaignMedia(camp(['a.jpg', ' ', { name: 'b.pdf', cloudUrl: 'https://x/b.pdf' }, { name: 'c' }])),
    ['a.jpg', { name: 'b.pdf', cloudUrl: 'https://x/b.pdf' }], 'mặc định "all": mọi tệp khai báo, đúng thứ tự')
  assert.deepEqual(E.selectZaloCampaignMedia(camp(['a.jpg'], { imageOption: 'none' })), [])
  const rnd = E.selectZaloCampaignMedia(camp(['a', 'b', 'c', 'd'], { imageOption: 'random', randomImageCount: 2 }), () => 0.9)
  assert.equal(rnd.length, 2)
  assert.equal(E.selectZaloCampaignMedia(camp(['a', 'b', 'c', 'd'], { imageOption: 'random', randomImageCount: 0 })).length, 3,
    'số lượng 0 hay thiếu → mặc định 3 như Desktop (randomImageCount || 3)')
  assert.deepEqual(E.planZaloSend({ fileCount: 0, hasText: true, formatted: false }).calls.map(c => c.stepKey), ['send_content'])
  assert.deepEqual(E.planZaloSend({ fileCount: 1, hasText: true, formatted: false }), { sequence: 'combined', calls: [{ kind: 'combined', stepKey: 'send_combined' }] })
  assert.deepEqual(E.planZaloSend({ fileCount: 1, hasText: false, formatted: false }).sequence, 'media_only')
  assert.deepEqual(E.planZaloSend({ fileCount: 3, hasText: true, formatted: false }).calls.map(c => c.kind), ['media', 'text'])
  assert.deepEqual(E.planZaloSend({ fileCount: 1, hasText: true, formatted: true }).calls.map(c => c.kind), ['text', 'media'])
  assert.equal(E.campaignMediaName({ name: '', cloudUrl: 'https://cdn/x/y.png?sig=1' }), 'y.png')
  assert.equal(E.campaignMediaSourceHint({ name: 'Ảnh', cloudUrl: 'https://cdn/x/abc', mimeType: 'image/png' }), 'Ảnh.png')
  assert.equal(E.campaignMediaSourceHint({ name: 'hợp đồng.pdf', cloudUrl: 'https://cdn/x/abc' }), 'hợp đồng.pdf')
  const fence = E.mediaFenceError(Object.assign(new Error('Gửi media quá thời gian chờ (180 giây).'), { code: 'campaign_media_timeout' }))
  assert.deepEqual([fence.phase, fence.signal.kind, fence.evidence.deliveryState], ['in_flight', 'fly_command', 'unknown'])
  assert.equal(E.mediaFenceError(Object.assign(new Error('đóng'), { code: 'campaign_runtime_unavailable' })).phase, 'before_send')
  assert.equal(E.mediaFenceError(Object.assign(new Error('x'), { code: 122 })), null)
  pass('chọn tệp (all/none/random), thứ tự gửi như dispatchZaloMessage, tên tệp, mã hàng rào media')

  // ---- 2. Chạy thật với RPC ---------------------------------------------------------------------------
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-media-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    for (const sql of [MIGRATION, v499.migration, V500, v501.migration]) await db.query(sql)
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 920000
    const make = async ({ images, extra = {}, content = 'Chào #{FULL_NAME}', phones = ['0912000001'] }) => {
      const account = ++nextId, campaign = ++nextId, staff = 9101, org = 650
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, staff, org])
      const extraSettings = { enableMessage: true, ...extra }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings, images)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Gửi tệp', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [campaign, account, staff, org, content, JSON.stringify(extraSettings), JSON.stringify(images)])
      const ids = []
      for (const phone of phones) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [id, campaign, phone])
        ids.push(id)
      }
      return { account, campaign, staff, ids, images, extra: extraSettings, content }
    }
    const err = (message, code) => Object.assign(new Error(message), code === undefined ? {} : { code })
    const zaloErr = (message, code) => E.zaloPortErrorFrom(err(message, code), { operation: 'send', answered: typeof code === 'number' })
    const run = async (c, b = {}, cfg = {}) => {
      const calls = [], lines = []
      const port = {
        findUser: async (_ctx, phone) => E.normalizeZaloFoundUser({ userId: `uid-${phone}`, display_name: 'Lan', zalo_name: 'Lan', globalId: `g-${phone}` }),
        phoneSearchLimitScope: async () => null,
        saveFoundUser: async () => {},
        isOptedOut: async () => false,
        takeContentIndex: async (_ctx, _action, count) => (b.rotation = ((b.rotation ?? -1) + 1)) % count,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid, message) => {
          calls.push(typeof message === 'string' ? `text:${uid}:${message}` : `styled:${uid}:${JSON.stringify(message)}`)
          if (b.text) throw b.text
          return { response: { msgId: 'mt' }, msgId: 'mt' }
        },
        prepareMedia: async (_ctx, items) => {
          calls.push(`prepare:${items.map(E.campaignMediaName).join(',')}`)
          if (b.prepare) throw b.prepare
          return items.map(item => ({ name: E.campaignMediaName(item), ref: `/tmp/${E.campaignMediaName(item)}` }))
        },
        sendMedia: async (_ctx, input) => {
          calls.push(`media:${input.stepKey}:${input.files.map(f => f.name).join(',')}:${input.message ?? ''}`)
          if (b.media) throw b.media
          return { response: { msgId: 'mm' }, msgId: 'mm' }
        },
        sendFriendRequest: async () => ({}),
        rewriteMessage: async (_ctx, content) => {
          calls.push(`ai:${content}`)
          if (b.ai instanceof Error) throw b.ai
          return b.ai ?? '```text\nAI viết lại: ' + content + '\n```'
        },
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1
      }
      const core = { id: c.campaign, actionId: 'zalo_message_phone', accountId: c.account, content: c.content, extraSettings: c.extra, images: c.images,
        dataTargetSourceMode: null }
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:media', runtimeTarget: 'desktop', staffId: c.staff, accountId: c.account, campaignId: c.campaign,
        campaignName: 'Gửi tệp', accountName: 'Zalo', campaignNote: null, targetLabel: E.zaloMessagePhoneTargetLabel,
        actionName: code => E.ZALO_MESSAGE_PHONE_ACTION_NAMES[code] ?? code, ...E.zaloMessagePhoneClaimPlan(core),
        buildSteps: () => E.buildZaloMessagePhoneSteps(core, port, { account: { id: c.account, name: 'Zalo' }, mediaStepTimeoutMs: 600000 }),
        validateCampaign: () => E.validateZaloMessagePhone(core, { zaloWeb: false }),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) AS r', [c.account, info.leaseToken]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: 60000, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }, ...cfg
      }, new AbortController().signal)
      return { result, calls, lines }
    }
    const detail = id => rows(`SELECT action_code, status, error_code, counts_toward_limit, log, data FROM public.auto_campaign_details
      WHERE input_data_id = $1 AND action_code = 'zalo_message_stranger' ORDER BY id`, [id])
    const input = id => rows(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [id]).then(r => r[0])
    const used = acc => val(`SELECT count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = 'zalo_message_stranger'`, [acc])
    const streak = cid => val(`SELECT count_consecutive_bad_targets FROM public.auto_campaign_error_state WHERE campaign_id = $1`, [cid])

    // M1: 1 ảnh + chữ → một lần gửi (ảnh kèm chú thích).
    const m1 = await make({ images: [{ name: 'a.jpg', localPath: '/x/a.jpg' }] })
    const r1 = await run(m1)
    assert.deepEqual(r1.calls.filter(x => !x.startsWith('prepare')), ['media:send_combined:a.jpg:Chào Lan'])
    const d1 = await detail(m1.ids[0])
    assert.deepEqual([d1[0].status, d1[0].log, d1[0].data.attachments, d1[0].data.sequence], ['thành công', 'Đã gửi tin nhắn đến Lan', ['a.jpg'], 'combined'])
    assert.ok(r1.lines.includes('✅ Hoàn thành "0912000001"'))
    pass('1 ảnh + chữ: một lần gửi (chú thích), dòng "thành công" ghi tên tệp và thứ tự gửi')

    // M2: album 2 tệp + chữ → album rồi chữ; chữ lỗi → giao một phần.
    const m2 = await make({ images: ['/x/a.jpg', '/x/b.mp4'], phones: ['0912000002', '0912000003'] })
    const r2 = await run(m2, { text: zaloErr('Lỗi gửi', 114) })
    assert.deepEqual(r2.calls.filter(x => !x.startsWith('prepare')).slice(0, 2), ['media:send_media:a.jpg,b.mp4:', 'text:uid-0912000002:Chào Lan'])
    const d2 = await detail(m2.ids[0])
    assert.equal(d2[0].status, 'thất bại')
    assert.match(d2[0].log, /^Đã gửi file nhưng gửi nội dung thất bại\. /)
    assert.equal(d2[0].counts_toward_limit, true)
    assert.equal(d2[0].data.partialSend.stage, 'content_after_media')
    assert.equal((await input(m2.ids[0])).status, 'hoàn thành', 'không bao giờ gửi lại')
    assert.ok(!r2.lines.includes('✅ Hoàn thành "0912000002"'), 'như Desktop: đóng data vì không gửi lại được thì không in "✅ Hoàn thành"')
    assert.equal(Number(await streak(m2.campaign) ?? 0), 0, 'giao một phần không tăng chuỗi data lỗi')
    assert.equal(Number(await used(m2.account)), 2, 'giao một phần vẫn tính lượt')
    pass('album + chữ: gửi album rồi chữ; chữ lỗi → "Đã gửi file nhưng gửi nội dung thất bại. …", tính lượt, không đổi chuỗi lỗi, không gửi lại')

    // M2b: album đã tới, lần gửi chữ hỏng ngay ở bước chuẩn bị của Desktop (zaloRuntimeService gắn dấu "trước khi gọi Zalo", cổng
    // Desktop đổi thành pha before_send như dưới). Phần chữ chưa gửi nhưng album đã tới: vẫn là giao một phần, data hoàn thành,
    // không về hàng đợi (nếu về hàng đợi thì lần sau gửi lại album).
    const m2b = await make({ images: ['/x/a.jpg', '/x/b.mp4'], phones: ['0912000019'] })
    const r2b = await run(m2b, { text: E.zaloPortErrorFrom(err('Failed to get account Zalo session: TypeError: fetch failed'), { phase: 'before_send' }) })
    assert.deepEqual(r2b.calls.filter(x => !x.startsWith('prepare')), ['media:send_media:a.jpg,b.mp4:', 'text:uid-0912000019:Chào Lan'])
    const d2b = await detail(m2b.ids[0])
    assert.deepEqual([d2b.length, d2b[0].status, d2b[0].counts_toward_limit, d2b[0].data.partialSend.stage], [1, 'thất bại', true, 'content_after_media'])
    assert.equal((await input(m2b.ids[0])).status, 'hoàn thành', 'album đã tới: không gửi lại')
    pass('album đã tới rồi lần gửi chữ hỏng trước khi gọi Zalo (before_send): vẫn là giao một phần, data hoàn thành, không gửi lại album')

    // M3: quá giờ gửi media (lần gửi đầu) → không rõ đã tới (UNK01), không gửi lại, không ✅.
    const m3 = await make({ images: ['/x/a.png'], phones: ['0912000004'] })
    const r3 = await run(m3, { media: E.mediaFenceError(err('Gửi media quá thời gian chờ (180 giây). Đã đóng tác vụ; kết quả gửi chưa xác định, không tự gửi lại người nhận này.', 'campaign_media_timeout')) })
    const d3 = await detail(m3.ids[0])
    assert.equal(d3[0].error_code, 'err_engine_unknown_delivery')
    assert.equal((await input(m3.ids[0])).status, 'hoàn thành')
    assert.ok(!r3.lines.some(l => l.startsWith('✅ Hoàn thành "')))
    pass('quá giờ gửi media: không rõ đã tới (UNK01), data hoàn thành, không gửi lại, không "✅ Hoàn thành"')

    // M4: không dùng được tệp (tải lỗi) → CFG01: chưa gửi gì, tạm dừng chiến dịch, data về hàng đợi.
    const m4 = await make({ images: [{ name: 'x.jpg', cloudUrl: 'https://cdn/x.jpg' }], phones: ['0912000005'] })
    const r4 = await run(m4, { prepare: E.mediaUnavailableError('Không dùng được media "x.jpg": không có local path và cloud URL không tải được (HTTP 404)') })
    assert.ok(!r4.calls.some(x => x.startsWith('media:') || x.startsWith('text:')), 'không gửi gì')
    assert.equal((await input(m4.ids[0])).status, 'chờ xử lý')
    const c4 = await rows(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [m4.campaign])
    assert.equal(c4[0].status, 'tạm dừng')
    assert.match(c4[0].note || '', /CFG01|media/i)
    pass('không dùng được tệp: CFG01 — không gửi gì, data về hàng đợi, tạm dừng chiến dịch một lần')

    // M5: chỉ có tệp, không có chữ → gửi tệp, không báo "nội dung rỗng".
    const m5 = await make({ images: ['/x/a.jpg', '/x/b.jpg'], content: '', phones: ['0912000006'] })
    const r5 = await run(m5)
    assert.deepEqual(r5.calls.filter(x => !x.startsWith('prepare')), ['media:send_media:a.jpg,b.jpg:'])
    assert.equal((await detail(m5.ids[0]))[0].status, 'thành công')
    pass('chỉ có tệp (không chữ): gửi album, thành công')

    // M6: hàng rào media đã đóng (chưa gửi gì) → NET03, data về hàng đợi.
    const m6 = await make({ images: ['/x/a.jpg'], phones: ['0912000007'] })
    await run(m6, { media: E.mediaFenceError(err('Tác vụ media đã đóng; không thực hiện thêm yêu cầu Zalo.', 'campaign_runtime_unavailable')) })
    assert.equal((await input(m6.ids[0])).status, 'chờ xử lý', 'chưa gửi gì: data về hàng đợi')
    pass('hàng rào media đã đóng: chưa gửi gì, data về hàng đợi')

    // M7: lỗi Zalo có mã ở lần gửi duy nhất → theo chính sách mã (ở đây 122: thất bại, data hoàn thành, có ✅).
    const m7 = await make({ images: ['/x/a.jpg'], phones: ['0912000008'] })
    const r7 = await run(m7, { media: zaloErr('Người nhận chặn tin nhắn từ người lạ', 122) })
    const d7 = await detail(m7.ids[0])
    assert.deepEqual([d7[0].status, d7[0].error_code], ['thất bại', 'err_zalo_receiver_blocks_stranger_message'])
    assert.ok(r7.lines.includes('✅ Hoàn thành "0912000008"'))
    pass('lỗi Zalo có mã khi gửi tệp: theo chính sách của mã như gửi chữ')

    // M9: nội dung định dạng: dựng mẫu theo từng đoạn chữ, gửi { msg, styles }; xoay biến thể theo "|" cấp ngoài.
    const html = '<p><strong>Chào #{FULL_NAME}</strong> bạn</p><ul><li>Ưu đãi</li></ul>|<p>Biến thể 2</p>'
    const m9 = await make({ images: [], content: html, extra: { formattedContentEnabled: true }, phones: ['0912000009'] })
    const r9 = await run(m9)
    const sent9 = r9.calls.find(x => x.startsWith('styled:'))
    assert.ok(sent9, 'gửi chữ có định dạng')
    const msg9 = JSON.parse(sent9.slice('styled:uid-0912000009:'.length))
    assert.equal(msg9.msg, 'Chào Lan bạn\nƯu đãi')
    assert.deepEqual(msg9.styles.map(x => x.st).sort(), ['b', 'lst_1'])
    assert.equal((await detail(m9.ids[0]))[0].status, 'thành công')
    // M10: định dạng + 1 tệp + chữ → chữ trước, tệp sau; tệp lỗi → giao một phần "Đã gửi nội dung nhưng gửi file thất bại."
    const m10 = await make({ images: ['/x/a.jpg'], content: '<p><em>Xin chào</em></p>', extra: { formattedContentEnabled: true }, phones: ['0912000010'] })
    const r10 = await run(m10, { media: zaloErr('Lỗi tải tệp lên', 114) })
    assert.deepEqual(r10.calls.filter(x => x.startsWith('styled:') || x.startsWith('media:')).map(x => x.split(':')[0]), ['styled', 'media'])
    const d10 = await detail(m10.ids[0])
    assert.match(d10[0].log, /^Đã gửi nội dung nhưng gửi file thất bại\. /)
    assert.equal(d10[0].data.partialSend.stage, 'media_after_content')
    pass('nội dung định dạng: gửi { msg, styles } như Desktop; 1 tệp + chữ định dạng thì chữ trước, tệp lỗi là giao một phần')

    // M11: nội dung nâng cao: mỗi mục là một biến thể kèm tệp riêng, xoay vòng theo vị trí; mục chỉ có tệp vẫn gửi.
    const adv = { advancedContentEnabled: true, advancedContentItems: [
      { id: 'a', content: 'Mục A cho #{FULL_NAME}', mediaOption: 'all', mediaItems: ['/x/a1.jpg'] },
      { id: 'b', content: '', mediaOption: 'all', mediaItems: ['/x/b1.jpg', '/x/b2.jpg'] }] }
    const m11 = await make({ images: ['/x/khong-dung.jpg'], content: 'không dùng', extra: adv, phones: ['0912000011', '0912000012'] })
    const r11 = await run(m11)
    assert.deepEqual(r11.calls.filter(x => x.startsWith('media:')), ['media:send_combined:a1.jpg:Mục A cho Lan', 'media:send_media:b1.jpg,b2.jpg:'])
    // M12: nội dung nâng cao rỗng → CFG16 một lần đầu lượt: tạm dừng chiến dịch kèm câu, data về hàng đợi, không gửi gì.
    const m12 = await make({ images: [], extra: { advancedContentEnabled: true, advancedContentItems: [{ id: 'x', content: '  ', mediaOption: 'none' }] },
      phones: ['0912000013'] })
    const r12 = await run(m12)
    assert.equal(r12.result.reason, 'config_invalid')
    assert.ok(!r12.calls.some(x => x.startsWith('media:') || x.startsWith('text:')))
    const c12 = await rows(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [m12.campaign])
    assert.deepEqual([c12[0].status, c12[0].note], ['tạm dừng', 'Nội dung nâng cao số 1 đang rỗng. Vui lòng nhập nội dung hoặc chọn media. (CFG16)'])
    assert.equal((await input(m12.ids[0])).status, 'chờ xử lý')
    pass('nội dung nâng cao: chữ và tệp xoay vòng theo mục; mục rỗng → CFG16 tạm dừng chiến dịch một lần, không gửi gì')

    // M13: AI viết lại: gửi nội dung AI (đã bỏ khung ```); AI lỗi → "⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: …", gửi gốc.
    const m13 = await make({ images: [], content: 'Chào #{FULL_NAME}', extra: { rewriteContentEachRun: true }, phones: ['0912000014'] })
    const r13 = await run(m13)
    assert.deepEqual(r13.calls.filter(x => x.startsWith('ai:') || x.startsWith('text:')), ['ai:Chào Lan', 'text:uid-0912000014:AI viết lại: Chào Lan'])
    const m14 = await make({ images: [], content: 'Chào #{FULL_NAME}', extra: { rewriteContentEachRun: true }, phones: ['0912000015'] })
    const r14 = await run(m14, { ai: new Error('AI trả về lỗi 500') })
    assert.ok(r14.lines.includes('⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: AI trả về lỗi 500'))
    assert.ok(r14.calls.includes('text:uid-0912000015:Chào Lan'))
    const m15 = await make({ images: [], content: '<p>Chào</p>', extra: { rewriteContentEachRun: true, formattedContentEnabled: true }, phones: ['0912000016'] })
    const r15 = await run(m15)
    assert.ok(!r15.calls.some(x => x.startsWith('ai:')), 'nội dung định dạng không qua AI (như Desktop)')
    pass('AI viết lại: gửi nội dung AI; lỗi thì in câu của Desktop và gửi nội dung gốc; nội dung định dạng không qua AI')

    // M16 (hồi quy từ phát lại dữ liệu thật, chiến dịch 48186): album đã tới, chữ bị 127 → giao một phần; khoá nhắn người lạ như
    // chính sách 127, nhưng KHÔNG tạm dừng chiến dịch ngay (tạm dừng của 127 chỉ khi 3 lần liền cộng chuỗi).
    const m16 = await make({ images: ['/x/a.jpg', '/x/b.jpg'], phones: ['0912000017', '0912000018'] })
    const r16 = await run(m16, { text: zaloErr('Nội dung bị trùng lặp hoặc gửi quá nhanh', 127) })
    const d16 = await detail(m16.ids[0])
    assert.match(d16[0].log, /^Đã gửi file nhưng gửi nội dung thất bại\. /)
    assert.equal((await rows(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [m16.campaign]))[0].status, 'chờ xử lý')
    assert.equal(r16.result.reason, 'end_unit', 'kết thúc lượt sau data đó (lượt sau chờ hết khoá 127)')
    assert.equal(await val(`SELECT is_disable FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = 'zalo_message_stranger'`, [m16.account]), true)
    pass('giao một phần do 127: khoá thao tác theo chính sách, không tạm dừng chiến dịch ngay (hồi quy 48186)')

    // M8: kiểm cấu hình Zalo Web (CFG10) trước khi gửi.
    const issues = E.validateZaloContent({ zaloWeb: true, attachments: [{ name: 'hd.pdf', cloudUrl: 'https://cdn/x' }, '/x/a.jpg'].map(E.campaignMediaSourceHint).filter(Boolean) })
    assert.deepEqual(issues.map(i => i.publicCode), ['CFG10'])
    pass('Zalo Web gửi tệp không phải ảnh: CFG10 kiểm một lần đầu lượt')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
