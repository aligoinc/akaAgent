// V588: đợt 2 của bộ kiểm lỗi chiến dịch Facebook, trên PostgreSQL 17 cục bộ, không chạm DB thật:
//   LC_ALL=C node scripts/engine-v2-facebook/error-review-v588-smoke.cjs
// DB engine như production + V574 + bản giả nền Hỏi đáp AI. Kiểm: apply (md5 thân hàm, dữ liệu sẵn có), lỗi theo từng lượt, chép kết luận về sổ ca,
// câu cho khách và mã lỗi đề xuất chỉ ở trạng thái chờ duyệt, hàm review chỉ cho admin akaBiz, duyệt thì ghi vào dòng lịch sử + ghi chú data,
// bỏ duyệt thì trả lại, quyền, bản gỡ.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')
const { AI_STUBS } = require('./error-watch-fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_ERROR_REVIEW_PORT || 55586)
const V574 = 'migration_v574_engine_error_watch.sql'
const MIGRATION = 'migration_v588_engine_error_review.sql'
const ROLLBACK = 'rollback_v588_engine_error_review.sql'
const AGENT = 'kiem-loi-chien-dich-facebook'
const ORG = 1, ADMIN = 4, CUSTOMER_ORG = 701, CUSTOMER_STAFF = 7001
const V574_BODY_MD5 = 'a93263ce4f9af16c1e34e4bd78cf1562'
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function main() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-error-review-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const all = async (sql, args = []) => (await db.query(sql, args)).rows
  const tick = async () => (await one('SELECT public.aka_agent_engine_error_watch_tick_v1() AS r')).r
  const setCfg = patch => db.query(`UPDATE public.auto_system_settings SET value = (value::jsonb || $1::jsonb)::text WHERE key = 'engine.error_watch'`, [JSON.stringify(patch)])
  const bodyMd5 = async () => (await one(`SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure`)).m
  /** Gọi hàm review như phiên Desktop của một nhân viên (bản giả đọc nhân viên từ GUC test.desktop_staff). */
  const review = async (staff, action, payload = {}) => {
    await db.query(`SELECT set_config('test.desktop_staff', $1, false)`, [staff == null ? '' : String(staff)])
    try { return (await one('SELECT public.aka_agent_engine_error_review($1, $2::jsonb) AS r', [action, JSON.stringify(payload)])).r } finally {
      await db.query(`SELECT set_config('test.desktop_staff', '', false)`)
    }
  }
  let marker = null
  const mark = async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
    marker = (await one(`SELECT (clock_timestamp() - interval '30 seconds 20 milliseconds')::text AS t`)).t
  }
  const rewind = () => db.query(`UPDATE private.auto_engine_error_watch_state SET cursor_at = $1::timestamptz`, [marker])
  const cases = () => all(`SELECT * FROM private.auto_engine_error_cases ORDER BY case_key`)
  const caseLike = async part => (await cases()).find(c => c.case_key.includes(part))
  const itemsOf = key => all(`SELECT * FROM private.auto_engine_error_items WHERE case_key = $1 ORDER BY id`, [key])
  let nextId = 990000
  let fbCampaign, zaloCampaign, fbAccount

  /** Một lượt data đã đóng kèm một kết quả lỗi và dòng lịch sử của nó. Trả { run, data, detail }. */
  const outcome = async ({ campaign = fbCampaign, code, action = 'fb_post_group', step = 'nav', message, pub = null, log = null, note = undefined,
    ago = '30 seconds', close = 'reported', startedAgo = null, withDetail = true }) => {
    const data = ++nextId
    const detail = withDetail && code ? ++nextId : null
    const text = log ?? `Có lỗi xảy ra${pub ? ` (${pub})` : ''}`
    await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, note, is_delete) OVERRIDING SYSTEM VALUE
      VALUES ($1, $2, 'Nhóm thử', 'g', 'hoàn thành', $3, false)`, [data, campaign, note === undefined ? text : note])
    if (detail) {
      await db.query(`INSERT INTO public.auto_campaign_details (id, input_data_id, campaign_id, account_id, action_name, status, log, data, created_at)
        VALUES ($1, $2, $3, $4, 'Đăng bài', 'lỗi', $5, '{"k":1}', clock_timestamp() - $6::interval)`, [detail, data, campaign, fbAccount, text, ago])
    }
    const run = await one(`INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id,
        runtime_target, started_at, completed_at, close_reason, final_error_code, final_response)
      VALUES ($1, $2, $3, $4, $5, $6, 'desktop:test', 'desktop', clock_timestamp() - coalesce($10::interval, $7::interval + interval '20 seconds'),
        clock_timestamp() - $7::interval, $8, $9, '{"ok":true,"campaign":{"effect":"none"}}')
      RETURNING id`, [data, campaign, fbAccount, CUSTOMER_STAFF, CUSTOMER_ORG, crypto.randomUUID(), ago, close, code ?? null, startedAgo])
    if (code) {
      await db.query(`INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok, error_code,
          delivery_state, detail_id, decision, signal, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'before_send', false, $7, 'not_delivered', $8, $9, $10, clock_timestamp() - $11::interval)`,
        [`v2:${run.id}:${step}`, run.id, data, campaign, fbAccount, action, code, detail,
          JSON.stringify({ result: { publicCode: pub } }), JSON.stringify({ kind: 'block', message }), ago])
    }
    return { run: Number(run.id), data, detail }
  }
  const answer = (id, json) => db.query(`UPDATE public.ai_message SET status = 'hoàn thành', answer = 'bản chữ', answer_json = $2::jsonb, answered_at = clock_timestamp() WHERE id = $1`,
    [id, JSON.stringify(json)])
    .then(() => db.query(`UPDATE public.ai_message_thread t SET last_message_status = 'hoàn thành' FROM public.ai_message m WHERE m.id = $1 AND t.id = m.thread_id`, [id]))
  const detailRow = id => one(`SELECT log, data FROM public.auto_campaign_details WHERE id = $1`, [id])
  const dataNote = async id => (await one(`SELECT note FROM public.auto_campaign_input_data WHERE id = $1`, [id])).note
  const BOX = 'Lỗi nhắn tin khách inbox page đến Nguyễn A: Không tìm thấy ô để nhập tin nhắn'
  const UNDEF = 'Không đọc được trạng thái trang sau khi bấm Đăng'

  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(AI_STUBS)
    await db.query(`ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean NOT NULL DEFAULT false`)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'akaBiz'), ($2, 'Khách thử') ON CONFLICT DO NOTHING`, [ORG, CUSTOMER_ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_admin_akabiz) VALUES ($1, $2, 'nhutlq', 'pw', true), ($3, $4, 'khach', 'pw', false)`,
      [ADMIN, ORG, CUSTOMER_STAFF, CUSTOMER_ORG])
    fbAccount = ++nextId; fbCampaign = ++nextId; zaloCampaign = ++nextId
    await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server,
        is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB thử', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`,
      [fbAccount, CUSTOMER_STAFF, CUSTOMER_ORG])
    for (const [id, action] of [[fbCampaign, 'facebook_page_to_message'], [zaloCampaign, 'zalo_message_phone']]) {
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
          extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, 'Chiến dịch thử', $2, $3, 'chờ xử lý', now(), false, $4, $5, 'daily', '{}')`,
        [id, action, fbAccount, CUSTOMER_STAFF, CUSTOMER_ORG])
    }
    await db.query(readMigration(V574))
    await setCfg({ enabled: true })
    const migration = readMigration(MIGRATION)
    const rollback = readMigration(ROLLBACK)

    // Trước V588: hai lượt của một ca đã nằm trong sổ, và một ca đã có báo cáo.
    let before = []
    await mark()
    before.push(await outcome({ code: 'err_fb_page_inbox_message_box_not_found', pub: 'FB46', action: 'fb_message_page_inbox_customer', step: 'send_message', message: BOX,
      log: 'Không thấy ô nhập tin nhắn trong hộp thư Page (FB46)' }))
    before.push(await outcome({ code: 'err_fb_page_inbox_message_box_not_found', pub: 'FB46', action: 'fb_message_page_inbox_customer', step: 'send_message',
      message: BOX.replace('Nguyễn A', 'Trần B'), log: 'Không thấy ô nhập tin nhắn trong hộp thư Page (FB46)' }))
    await rewind()
    await tick()

    await check('apply: thân hàm tick đúng md5, lượt lỗi và báo cáo sẵn có được chép, chạy lại bị từ chối', async () => {
      assert.equal(await bodyMd5(), V574_BODY_MD5, 'thân V574 trên DB thử trùng production')
      const box = await caseLike('message_box_not_found')
      assert.equal(Number(box.hits), 2)
      await db.query(`UPDATE public.ai_project SET is_active = true WHERE code = $1`, [AGENT])
      await setCfg({ enqueue: true, staffId: ADMIN })
      const r = await tick()
      assert.equal(r.inserted.length, 1)
      await answer(r.inserted[0].messageId, { tom_tat: 'Ca hộp thư Page không thấy ô nhập tin.', ket_luan: 'chua_du_du_lieu', do_chac: 'trung_binh', nen_sua_app: true })
      await setCfg({ enqueue: false })
      await tick()
      assert.equal((await caseLike('message_box_not_found')).status, 'reported')

      await db.query(migration)
      assert.notEqual(await bodyMd5(), V574_BODY_MD5)
      const after = await caseLike('message_box_not_found')
      assert.equal(after.conclusion, 'chua_du_du_lieu')
      assert.equal(after.confidence, 'trung_binh')
      assert.equal(after.summary, 'Ca hộp thư Page không thấy ô nhập tin.')
      assert.equal(after.customer_note_status, 'none')
      assert.equal(after.code_proposal_status, 'none')
      const items = await itemsOf(after.case_key)
      assert.equal(items.length, 2, 'hai lượt có sẵn được chép')
      assert.deepEqual(items.map(i => Number(i.target_run_id)).sort(), before.map(b => b.run).sort())
      assert.equal(Number(items[0].organization_id), CUSTOMER_ORG)
      assert.equal(Number(items[0].staff_id), CUSTOMER_STAFF)
      assert.equal(Number(items[0].detail_id), before[0].detail)
      const schema = (await one(`SELECT output_schema FROM public.ai_project WHERE code = $1`, [AGENT])).output_schema
      assert.ok(schema.properties.cau_cho_khach && schema.properties.de_xuat_ma_loi)
      await assert.rejects(() => db.query(migration), /V588 đã chạy/)
      await db.query('ROLLBACK').catch(() => {})
    })

    let fresh = []
    await check('lỗi theo từng lượt: lượt mới của ca được ghi một lần, mã đã biết và Zalo không ghi', async () => {
      await mark()
      fresh.push(await outcome({ code: 'err_undefined', pub: 'SYS99', step: 'click_post', message: UNDEF }))
      fresh.push(await outcome({ code: 'err_undefined', pub: 'SYS99', step: 'click_post', message: UNDEF }))
      fresh.push(await outcome({ code: 'err_undefined', pub: 'SYS99', step: 'click_post', message: UNDEF, note: 'Ghi chú khác do lượt sau ghi' }))
      await outcome({ code: 'err_fb_group_composer_editor_not_found', pub: 'FB40', step: 'open_composer', message: 'Không tìm thấy ô đăng bài' })
      await outcome({ campaign: zaloCampaign, code: 'err_undefined', pub: 'SYS99', action: 'zalo_message_stranger', step: 'send', message: 'lỗi Zalo' })
      await rewind()
      let r = await tick()
      assert.equal(r.items, 3)
      const undef = await caseLike('click_post')
      assert.equal(undef.kind, 'chua_phan_loai')
      let items = await itemsOf(undef.case_key)
      assert.equal(items.length, 3)
      assert.equal(items[0].message, UNDEF)
      assert.equal(items[0].public_code, 'SYS99')
      assert.equal(items[0].step, 'click_post')
      assert.equal(Number(items[0].campaign_id), fbCampaign)
      assert.equal(Number(items[0].input_data_id), fresh[0].data)
      assert.equal(items[0].note_applied_at, null)
      // Đọc lại cùng khoảng: sổ ca cộng trùng là việc của mốc đọc, còn bảng lượt thì không bao giờ trùng.
      await rewind()
      r = await tick()
      assert.equal(r.items, 0)
      assert.equal((await itemsOf(undef.case_key)).length, 3)
      assert.equal((await all(`SELECT 1 FROM private.auto_engine_error_items WHERE error_code = 'err_fb_group_composer_editor_not_found'`)).length, 0)
      assert.equal((await all(`SELECT 1 FROM private.auto_engine_error_items WHERE action_code = 'zalo_message_stranger'`)).length, 0)
    })

    await check('lượt bị bỏ dở cũng thành một dòng', async () => {
      await db.query(`INSERT INTO public.auto_staff_device_presence (staff_id, last_seen_at) VALUES ($1, clock_timestamp())`, [CUSTOMER_STAFF])
      await db.query(`UPDATE private.auto_engine_error_watch_state SET stale_cursor_at = clock_timestamp() - interval '50 minutes'`)
      const s = await outcome({ close: 'stale', ago: '20 minutes', startedAgo: '40 minutes', withDetail: false })
      const r = await tick()
      assert.equal(r.stale, 1)
      const item = await one(`SELECT * FROM private.auto_engine_error_items WHERE result_key = $1`, [`stale:${s.run}`])
      assert.ok(item, 'có dòng stale')
      assert.equal(item.detail_id, null)
      assert.equal(Number(item.organization_id), CUSTOMER_ORG)
      assert.ok(item.case_key.startsWith('stale|'))
    })

    let undefMessage
    await check('báo cáo xong: kết luận về sổ ca; câu cho khách và mã lỗi đề xuất chỉ ở trạng thái chờ duyệt, chưa ghi gì cho khách', async () => {
      await db.query(`UPDATE private.auto_engine_error_cases SET status = 'known' WHERE case_key NOT LIKE '%click_post%'`)
      await setCfg({ enqueue: true })
      const r = await tick()
      assert.equal(r.inserted.length, 1)
      undefMessage = r.inserted[0].messageId
      await answer(undefMessage, { tom_tat: 'Sau khi bấm Đăng, app không đọc được trạng thái trang.', ket_luan: 'loi_app', do_chac: 'cao', nen_sua_app: true,
        bang_chung: ['lượt mẫu'], cau_cho_khach: '  Chưa xác nhận được bài đã đăng.\n Vui lòng kiểm tra lại trong nhóm.  ',
        de_xuat_ma_loi: { ten_loi: 'Không xác nhận được bài đã đăng', cau_cho_khach: 'Chưa xác nhận được bài đã đăng', cach_xu_ly: 'không tính lượt', dau_hieu: 'click_post' } })
      await setCfg({ enqueue: false })
      const t = await tick()
      assert.equal(t.notes, 0)
      const k = await caseLike('click_post')
      assert.equal(k.status, 'reported')
      assert.equal(k.conclusion, 'loi_app')
      assert.equal(k.confidence, 'cao')
      assert.equal(Number(k.report_message_id), Number(undefMessage))
      assert.equal(k.report.tom_tat, 'Sau khi bấm Đăng, app không đọc được trạng thái trang.')
      assert.equal(k.customer_note, 'Chưa xác nhận được bài đã đăng. Vui lòng kiểm tra lại trong nhóm.')
      assert.equal(k.customer_note_status, 'proposed')
      assert.equal(k.code_proposal_status, 'proposed')
      assert.equal(k.code_proposal.ten_loi, 'Không xác nhận được bài đã đăng')
      assert.equal((await detailRow(fresh[0].detail)).log, 'Có lỗi xảy ra (SYS99)', 'chưa duyệt thì dòng lịch sử giữ nguyên')
      assert.equal(await dataNote(fresh[0].data), 'Có lỗi xảy ra (SYS99)')
      assert.equal((await all(`SELECT 1 FROM public.auto_error WHERE error_code ILIKE '%xac_nhan%'`).catch(() => [])).length, 0, 'không tự thêm mã lỗi')
    })

    await check('hàm review: không phiên / không phải admin akaBiz thì từ chối; admin xem được danh sách và từng lượt kèm tên', async () => {
      assert.deepEqual(await review(null, 'list'), { ok: false, code: 'no_session' })
      assert.deepEqual(await review(CUSTOMER_STAFF, 'list'), { ok: false, code: 'forbidden' })
      assert.deepEqual(await review(CUSTOMER_STAFF, 'note', { caseKey: 'x', decision: 'approve', note: 'abcdef' }), { ok: false, code: 'forbidden' })
      const list = await review(ADMIN, 'list')
      assert.equal(list.ok, true)
      assert.equal(list.settings.enabled, true)
      assert.equal(list.needsReview, 1)
      assert.equal(list.cases[0].customerNoteStatus, 'proposed', 'ca chờ duyệt đứng đầu')
      assert.equal(list.cases[0].itemCount, 3)
      assert.equal(list.cases[0].organizationCount, 1)
      assert.equal(list.total, (await cases()).length)
      assert.equal((await review(ADMIN, 'list', { needsReview: true })).cases.length, 1)
      assert.equal((await review(ADMIN, 'list', { q: 'SYS99' })).cases.length, 1)
      assert.equal((await review(ADMIN, 'list', { kind: 'luot_bo_do' })).cases.length, 1)
      const key = list.cases[0].caseKey
      const detail = await review(ADMIN, 'case', { caseKey: key })
      assert.equal(detail.ok, true)
      assert.equal(detail.case.conclusion, 'loi_app')
      assert.equal(detail.case.answer, 'bản chữ')
      assert.equal(detail.case.codeProposal.dau_hieu, 'click_post')
      assert.equal(detail.itemTotal, 3)
      assert.equal(detail.items[0].organizationName, 'Khách thử')
      assert.equal(detail.items[0].campaignName, 'Chiến dịch thử')
      assert.equal(detail.items[0].accountName, 'FB thử')
      assert.equal(detail.items[0].staffName, 'khach')
      assert.equal(detail.items[0].dataName, 'Nhóm thử')
      assert.deepEqual(await review(ADMIN, 'case', { caseKey: 'khong-co' }), { ok: false, code: 'case_not_found' })
      assert.deepEqual(await review(ADMIN, 'la'), { ok: false, code: 'case_required' })
      assert.deepEqual(await review(ADMIN, 'la', { caseKey: key }), { ok: false, code: 'bad_action' })
    })

    const NOTE = 'Chưa xác nhận được bài đã đăng, vui lòng xem lại trong nhóm'
    await check('duyệt câu cho khách: hàm tick ghi vào dòng lịch sử và ghi chú data của mọi lượt, kể cả lượt mới; ghi chú đã khác thì giữ', async () => {
      const key = (await caseLike('click_post')).case_key
      assert.deepEqual(await review(ADMIN, 'note', { caseKey: key, decision: 'approve', note: 'abc' }), { ok: false, code: 'note_length' })
      assert.deepEqual(await review(ADMIN, 'note', { caseKey: key, decision: 'xx' }), { ok: false, code: 'bad_decision' })
      const res = await review(ADMIN, 'note', { caseKey: key, decision: 'approve', note: `  ${NOTE}  ` })
      assert.equal(res.ok, true)
      assert.equal(res.case.customerNoteStatus, 'approved')
      assert.equal(res.case.customerNote, NOTE)
      assert.equal(Number((await caseLike('click_post')).customer_note_by), ADMIN)
      let r = await tick()
      assert.equal(r.notes, 3)
      for (const f of fresh) {
        const d = await detailRow(f.detail)
        assert.equal(d.log, `${NOTE} (SYS99)`)
        assert.equal(d.data.errorReview.originalLog, 'Có lỗi xảy ra (SYS99)')
        assert.equal(d.data.k, 1, 'dữ liệu cũ của dòng lịch sử còn nguyên')
      }
      assert.equal(await dataNote(fresh[0].data), `${NOTE} (SYS99)`)
      assert.equal(await dataNote(fresh[2].data), 'Ghi chú khác do lượt sau ghi')
      assert.equal((await tick()).notes, 0, 'không ghi lại')
      // Lượt mới của ca đã duyệt.
      await mark()
      const later = await outcome({ code: 'err_undefined', pub: 'SYS99', step: 'click_post', message: UNDEF })
      await rewind()
      r = await tick()
      assert.equal(r.items, 1)
      assert.equal(r.notes, 1)
      assert.equal((await detailRow(later.detail)).log, `${NOTE} (SYS99)`)
      fresh.push(later)
      // Ca khác chưa duyệt thì không bị đụng.
      assert.equal((await detailRow(before[0].detail)).log, 'Không thấy ô nhập tin nhắn trong hộp thư Page (FB46)')
    })

    await check('báo cáo sau không ghi đè câu đã duyệt; sửa câu rồi duyệt lại thì ghi lại; bỏ duyệt thì trả câu cũ', async () => {
      const key = (await caseLike('click_post')).case_key
      await db.query(`UPDATE private.auto_engine_error_cases SET status = 'queued' WHERE case_key = $1`, [key])
      await answer(undefMessage, { tom_tat: 'Báo cáo lần hai.', ket_luan: 'loi_app', do_chac: 'cao', nen_sua_app: true, cau_cho_khach: 'Một câu khác hẳn do Claude đề xuất' })
      await tick()
      let k = await caseLike('click_post')
      assert.equal(k.summary, 'Báo cáo lần hai.')
      assert.equal(k.customer_note, NOTE)
      assert.equal(k.customer_note_status, 'approved')

      const NOTE2 = 'Chưa xác nhận được bài đã đăng'
      await review(ADMIN, 'note', { caseKey: key, decision: 'approve', note: NOTE2 })
      let r = await tick()
      assert.equal(r.notes, 4)
      let d = await detailRow(fresh[0].detail)
      assert.equal(d.log, `${NOTE2} (SYS99)`)
      assert.equal(d.data.errorReview.originalLog, 'Có lỗi xảy ra (SYS99)', 'vẫn nhớ câu gốc')
      assert.equal(await dataNote(fresh[0].data), `${NOTE2} (SYS99)`)

      const rej = await review(ADMIN, 'note', { caseKey: key, decision: 'reject' })
      assert.equal(rej.case.customerNoteStatus, 'rejected')
      r = await tick()
      assert.equal(r.notes, 4)
      d = await detailRow(fresh[0].detail)
      assert.equal(d.log, 'Có lỗi xảy ra (SYS99)')
      assert.equal(d.data.errorReview, undefined)
      assert.equal(d.data.k, 1)
      assert.equal(await dataNote(fresh[0].data), 'Có lỗi xảy ra (SYS99)')
      assert.equal(await dataNote(fresh[2].data), 'Ghi chú khác do lượt sau ghi')
      assert.equal((await all(`SELECT 1 FROM private.auto_engine_error_items WHERE note_applied_at IS NOT NULL`)).length, 0)
      assert.equal((await tick()).notes, 0)
    })

    await check('duyệt đề xuất mã lỗi chỉ ghi quyết định; đánh dấu ca đã biết thì không thành việc nữa', async () => {
      const key = (await caseLike('click_post')).case_key
      const errorsBefore = (await one(`SELECT count(*)::int AS n FROM public.auto_error`)).n
      const res = await review(ADMIN, 'code', { caseKey: key, decision: 'approve' })
      assert.equal(res.case.codeProposalStatus, 'approved')
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_error`)).n, errorsBefore)
      const other = await caseLike('message_box_not_found')
      assert.deepEqual(await review(ADMIN, 'code', { caseKey: other.case_key, decision: 'approve' }), { ok: false, code: 'no_proposal' })
      assert.deepEqual(await review(ADMIN, 'mark', { caseKey: key, status: 'la' }), { ok: false, code: 'bad_status' })
      assert.equal((await review(ADMIN, 'mark', { caseKey: key, status: 'known' })).case.status, 'known')
      await setCfg({ enqueue: true })
      const r = await tick()
      assert.equal(r.inserted.length, 0)
      await setCfg({ enqueue: false })
      assert.equal((await review(ADMIN, 'mark', { caseKey: key, status: 'new' })).case.status, 'new')
    })

    await check('/fire: không có câu thì không gọi; có câu thì gọi một lượt; gọi lại khi chưa ai nhận, cả ngoài khung chèn việc; đủ số lượt, đã có người nhận hoặc sát hạn thì thôi', async () => {
      await db.query(`CREATE SCHEMA IF NOT EXISTS net; CREATE SCHEMA IF NOT EXISTS vault;
        CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb);
        CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
          RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO net.calls (url, body, headers) VALUES ($1, $2, $4) RETURNING id $f$;
        CREATE VIEW vault.decrypted_secrets AS SELECT 'AKA_AGENT_ENGINE_ERROR_WATCH_FIRE_TOKEN'::text AS name, 'tok-test'::text AS decrypted_secret;`)
      const calls = () => all(`SELECT url, body, headers FROM net.calls ORDER BY id`)
      const key = (await caseLike('click_post')).case_key
      const fireState = () => one(`SELECT status, last_message_id, fired_message_id, fire_count FROM private.auto_engine_error_cases WHERE case_key = $1`, [key])
      const age = () => db.query(`UPDATE private.auto_engine_error_cases SET fired_at = fired_at - interval '11 minutes' WHERE case_key = $1`, [key])

      // Không có câu nào đang chờ: không gọi (không tốn phiên nào).
      await setCfg({ fire: true, fireRoutineId: 'trig_test01', enqueue: false })
      assert.equal((await tick()).fired, 0)
      assert.equal((await calls()).length, 0)

      // Chèn một câu: gọi đúng một lượt, mang mã câu.
      await setCfg({ enqueue: true })
      const first = await tick()
      assert.equal(first.inserted.length, 1)
      assert.equal(first.fired, 1)
      assert.equal(first.refired, 0)
      const message = first.inserted[0].messageId
      let sent = await calls()
      assert.equal(sent.length, 1)
      assert.equal(sent[0].url, 'https://api.anthropic.com/v1/claude_code/routines/trig_test01/fire')
      assert.equal(sent[0].body.text, `messageId=${message}`)
      assert.equal(sent[0].headers.Authorization, 'Bearer tok-test')
      assert.equal((await fireState()).fire_count, 1)

      // Lượt tick kế (2 phút sau): chưa tới hạn gọi lại.
      assert.equal((await tick()).fired, 0)

      // Hơn 10 phút vẫn chưa ai nhận: gọi lại, kể cả khi đang ngoài khung chèn việc.
      await setCfg({ enqueueWindow: { fromMinute: 60, toMinute: 60 } })
      await age()
      const again = await tick()
      assert.equal(again.inserted.length, 0)
      assert.equal(again.fired, 1)
      assert.equal(again.refired, 1)
      await age()
      assert.equal((await tick()).refired, 1)
      assert.equal((await fireState()).fire_count, 3)
      await age()
      assert.equal((await tick()).fired, 0, 'đủ 3 lượt thì thôi')
      assert.equal((await calls()).length, 3)

      // Đã có phiên nhận câu: không gọi nữa.
      await db.query(`UPDATE private.auto_engine_error_cases SET fire_count = 1 WHERE case_key = $1`, [key])
      await db.query(`UPDATE public.ai_message SET status = 'đang tìm câu trả lời' WHERE id = $1`, [message])
      assert.equal((await tick()).fired, 0)
      // Câu còn dưới 5 phút là hết hạn: không gọi (phiên dậy cũng không kịp làm).
      await db.query(`UPDATE public.ai_message SET status = 'chờ câu trả lời', deadline_at = clock_timestamp() + interval '3 minutes' WHERE id = $1`, [message])
      assert.equal((await tick()).fired, 0)
      // Mã tác vụ sai dạng hoặc tắt fire: không gọi.
      await db.query(`UPDATE public.ai_message SET deadline_at = clock_timestamp() + interval '50 minutes' WHERE id = $1`, [message])
      await setCfg({ fireRoutineId: 'https://evil.example/x' })
      assert.equal((await tick()).fired, 0)
      await setCfg({ fire: false, fireRoutineId: 'trig_test01' })
      assert.equal((await tick()).fired, 0)
      assert.equal((await calls()).length, 3)

      // Trả trạng thái cho các nhóm sau: câu này coi như đã có báo cáo.
      await answer(message, { tom_tat: 'Kiểm lại, không có gì mới so với báo cáo trước.', ket_luan: 'loi_app', do_chac: 'cao', nen_sua_app: true, bang_chung: ['lượt mẫu'] })
      await db.query(`UPDATE public.auto_system_settings SET value = ((value::jsonb - 'enqueueWindow') || '{"enqueue": false}'::jsonb)::text WHERE key = 'engine.error_watch'`)
      await tick()
      assert.equal((await fireState()).status, 'reported')
    })

    await check('quyền: hàm review chỉ mở cho aka_agent_desktop, bảng lượt không mở cho vai trò nào ngoài service_role', async () => {
      for (const role of ['anon', 'authenticated', 'aka_agent_chat_api', 'service_role']) {
        assert.equal((await one(`SELECT has_function_privilege($1, 'public.aka_agent_engine_error_review(text, jsonb)', 'EXECUTE') AS ok`, [role])).ok, false, role)
      }
      assert.equal((await one(`SELECT has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_review(text, jsonb)', 'EXECUTE') AS ok`)).ok, true)
      for (const role of ['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api']) {
        assert.equal((await one(`SELECT has_table_privilege($1, 'private.auto_engine_error_items', 'SELECT') AS ok`, [role])).ok, false, role)
        assert.equal((await one(`SELECT has_function_privilege($1, 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE') AS ok`, [role])).ok, false, role)
      }
      assert.equal((await one(`SELECT has_function_privilege('service_role', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE') AS ok`)).ok, true)
    })

    await check('gỡ: còn câu đã ghi thì dừng; trả câu xong thì gỡ được, hàm tick về đúng thân V574 và vẫn chạy', async () => {
      const key = (await caseLike('click_post')).case_key
      await review(ADMIN, 'note', { caseKey: key, decision: 'approve', note: NOTE })
      await tick()
      await assert.rejects(() => db.query(rollback), /còn \d+ lượt đang mang câu cho khách/)
      await db.query('ROLLBACK').catch(() => {})
      await review(ADMIN, 'note', { caseKey: key, decision: 'reject' })
      await tick()
      await db.query(rollback)
      assert.equal(await bodyMd5(), V574_BODY_MD5)
      assert.equal((await one(`SELECT to_regclass('private.auto_engine_error_items') AS t`)).t, null)
      assert.equal((await one(`SELECT to_regprocedure('public.aka_agent_engine_error_review(text,jsonb)') AS f`)).f, null)
      const cols = await all(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'private' AND table_name = 'auto_engine_error_cases'`)
      assert.ok(!cols.some(c => ['conclusion', 'customer_note', 'code_proposal'].includes(c.column_name)))
      const r = await tick()
      assert.equal(r.ok, true)
      assert.equal(r.items, undefined)
      await assert.rejects(() => db.query(rollback), /không có gì để gỡ/)
      await db.query('ROLLBACK').catch(() => {})
      await db.query(migration)
      assert.equal((await tick()).ok, true)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
