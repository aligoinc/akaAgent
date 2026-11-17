// Dấu hiệu nhận ra lỗi Facebook (src/main/engineAdapters/facebook/errorSigns.ts, anh chốt 17/11/2026): đọc dòng thiết lập, khớp câu lỗi của
// block (chứa) và chữ trên trang (bằng), theo thao tác / pha / mã đang có; bản đọc chữ trên trang chạy được với một DOM giả.
// Dữ liệu là đúng dòng thiết lập V559 sinh ra (build-v559-sql.cjs) và câu thật của block / trang Facebook thật 17/11.
// Chạy: node scripts/engine-v2-facebook/error-signs-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-signs-'))
  const outfile = path.join(dir, 'signs.cjs')
  await build({ entryPoints: [path.join(ROOT, 'src/main/engineAdapters/facebook/errorSigns.ts')], outfile, bundle: true, platform: 'node',
    format: 'cjs', logLevel: 'warning' })
  const mod = require(outfile)
  fs.rmSync(dir, { recursive: true, force: true })
  return mod
}

async function main() {
  const S = await load()
  const { SIGNS_JSON } = require('../build-v559-sql.cjs')
  const signs = S.parseFacebookErrorSigns(SIGNS_JSON)
  const ctx = (actionCode, phase, currentErrorCode = null) => ({ actionCode, phase, currentErrorCode })
  const codeOf = sign => sign?.code ?? null

  // 1. Đọc dòng thiết lập.
  assert.equal(signs.length, JSON.parse(SIGNS_JSON).length)
  assert.ok(signs.every(s => s.texts.every(t => t === t.toLowerCase())), 'chữ đã chuẩn hoá')
  assert.deepEqual(S.parseFacebookErrorSigns('không phải JSON'), [])
  assert.deepEqual(S.parseFacebookErrorSigns({ code: 'x' }), [])
  assert.deepEqual(S.parseFacebookErrorSigns(null), [])
  const mixed = S.parseFacebookErrorSigns([
    { code: 'err_ok_sign', source: 'page', texts: ['Một chữ đủ dài'] },
    { code: 'Sai Mã', source: 'page', texts: ['Một chữ đủ dài'] },
    { code: 'err_no_texts', source: 'message', texts: [] },
    { code: 'err_short', source: 'message', texts: ['ngắn'] },
    { code: 'err_bad_source', source: 'dom', texts: ['Một chữ đủ dài'] },
    { code: 'err_bad_phase', source: 'message', phases: ['sometime', 'before_send'], texts: ['Một chữ đủ dài'] },
    'rác'
  ])
  assert.deepEqual(mixed.map(s => s.code), ['err_ok_sign', 'err_bad_phase'], 'mục sai bị bỏ, mục đúng giữ')
  assert.deepEqual(mixed[1].phases, ['before_send'], 'pha lạ bị bỏ')
  pass('đọc dòng thiết lập: đúng bản V559, mục sai bị bỏ, cả dòng sai thì rỗng (như hôm nay)')

  // 2. Câu lỗi của block (chứa), theo thao tác; chỉ kết quả chưa có mã.
  const inbox = 'fb_message_page_inbox_customer'
  const notFound = 'Không tìm thấy khách inbox page Dinh Thu: Không tìm thấy khách hàng trong inbox page'
  const wrong = 'Không tìm thấy khách inbox page Ngọc Mai: Không tìm thấy đúng khách hàng trong inbox page'
  assert.equal(codeOf(S.matchMessageSign(signs, ctx(inbox, 'after_send'), [notFound])), 'err_fb_page_inbox_customer_not_found')
  assert.equal(codeOf(S.matchMessageSign(signs, ctx(inbox, 'after_send'), [wrong])), 'err_fb_page_inbox_wrong_conversation', '"đúng khách" không nhầm sang FB23')
  assert.equal(S.matchMessageSign(signs, ctx('fb_message_stranger', 'after_send'), [notFound]), null, 'thao tác khác không áp')
  assert.equal(S.matchMessageSign(signs, ctx(inbox, 'after_send', 'err_undefined'), [notFound]), null, 'kết quả đã có mã thì không thay')
  assert.equal(S.matchMessageSign(signs, ctx(inbox, 'after_send'), [null, undefined, '']), null)
  pass('câu lỗi của block: FB23 / FB24 đúng thao tác inbox Page, không thay mã đang có')

  // 3. FB38 chỉ trước khi gửi, đúng câu "tìm thấy 0".
  const drop0 = 'Cần đúng 1 input file trong form đăng bài, tìm thấy 0'
  assert.equal(codeOf(S.matchMessageSign(signs, ctx('fb_post_group', 'before_send'), [drop0])), 'err_fb_upload_form_changed')
  assert.equal(codeOf(S.matchMessageSign(signs, ctx('fb_post_my_profile', 'before_send'), ['Input trong form không nhận ảnh/video'])), 'err_fb_upload_form_changed')
  assert.equal(S.matchMessageSign(signs, ctx('fb_post_group', 'in_flight'), [drop0]), null, 'sau dấu "sắp gửi" thì như hôm nay')
  for (const n of ['2', '10']) {
    assert.equal(S.matchMessageSign(signs, ctx('fb_post_group', 'before_send'), [`Cần đúng 1 input file trong form đăng bài, tìm thấy ${n}`]), null, n)
  }
  pass('FB38: chỉ trước khi gửi, chỉ khi không có ô chọn ảnh (tìm thấy 0) hoặc ô không nhận ảnh')

  // 4. Chữ trên trang (bằng), chỉ thay FB40 ở đăng nhóm.
  const fb40 = 'err_fb_group_composer_editor_not_found'
  const page = ['Nhóm Riêng tư', 'Bạn hiện không xem được nội dung này', 'Đi đến Bảng feed']
  assert.equal(codeOf(S.matchPageSign(signs, ctx('fb_post_group', 'before_send', fb40), page)), 'err_fb_group_cannot_post_unavailable')
  assert.equal(codeOf(S.matchPageSign(signs, ctx('fb_post_group', 'before_send', fb40), ["  This   content isn't available right now "])), 'err_fb_group_cannot_post_unavailable',
    'tiếng Anh, dấu cách thừa')
  assert.equal(codeOf(S.matchPageSign(signs, ctx('fb_post_group', 'before_send', fb40), ['BẠN HIỆN KHÔNG XEM ĐƯỢC NỘI DUNG NÀY'])), 'err_fb_group_cannot_post_unavailable', 'hoa thường')
  const nfd = 'Bạn hiện không xem được nội dung này'.normalize('NFD')
  assert.equal(codeOf(S.matchPageSign(signs, ctx('fb_post_group', 'before_send', fb40), [nfd])), 'err_fb_group_cannot_post_unavailable', 'gõ dấu kiểu tổ hợp (NFD)')
  assert.equal(S.matchPageSign(signs, ctx('fb_post_group', 'before_send', null), page), null, 'không có FB40 thì không thay (hôm nay không phải FB40)')
  assert.equal(S.matchPageSign(signs, ctx('fb_join_group', 'in_flight', fb40), page), null, 'thao tác khác không áp')
  assert.equal(S.matchPageSign(signs, ctx('fb_post_group', 'before_send', fb40), ['Bạn hiện không xem được nội dung này. Bài viết của Lan']), null,
    'chữ nằm trong một câu dài hơn (vd trong bài viết) không khớp')
  assert.equal(S.matchPageSign(signs, ctx('fb_post_group', 'before_send', fb40), []), null)
  assert.equal(S.hasPageSigns(signs, 'fb_post_group', fb40), true)
  assert.equal(S.hasPageSigns(signs, 'fb_post_group', null), false, 'block lỗi không mã: dấu hiệu trang chỉ thay FB40 nên không đọc trang')
  assert.equal(S.hasPageSigns(signs, 'fb_comment', fb40), false, 'không đọc trang khi thao tác không có dấu hiệu trang')
  pass('chữ trên trang: FB14 chỉ thay FB40 khi đăng nhóm, so bằng đúng chữ (không hoa thường, dấu cách, NFC)')

  // 5. Thứ tự: chữ trên trang trước câu lỗi; không có dấu hiệu nào thì null.
  const both = S.parseFacebookErrorSigns([
    { code: 'err_from_message', source: 'message', texts: ['khách đã chặn trang'] },
    { code: 'err_from_page', source: 'page', texts: ['Không gửi được tin nhắn'] }
  ])
  assert.equal(codeOf(S.pickFacebookErrorSign(both, ctx('fb_comment', 'after_send'), { pageTexts: ['Không gửi được tin nhắn'], messages: ['khách đã chặn trang'] })),
    'err_from_page')
  assert.equal(codeOf(S.pickFacebookErrorSign(both, ctx('fb_comment', 'after_send'), { pageTexts: null, messages: ['khách đã chặn trang'] })), 'err_from_message')
  assert.equal(S.pickFacebookErrorSign([], ctx('fb_comment', 'after_send'), { pageTexts: ['Không gửi được tin nhắn'], messages: ['x'] }), null)
  pass('chọn dấu hiệu: chữ trên trang trước câu lỗi; danh sách rỗng thì như hôm nay')

  // 6. Bản đọc chữ trên trang (chạy như thân hàm của PageController.evaluate) với DOM giả: chỉ vùng chính và hộp thoại, bỏ trùng, trần 300.
  const node = (label, text) => ({ getAttribute: name => (name === 'aria-label' ? label : null), innerText: text })
  const main = { querySelectorAll: () => [node(null, 'Bạn hiện không xem được nội dung này'), node('Đi đến Bảng feed', 'Đi đến Bảng feed'),
    node(null, '  nhiều   dấu cách  '), node(null, 'x'.repeat(200))] }
  const many = { querySelectorAll: () => Array.from({ length: 400 }, (_, i) => node(null, `Nút ${i}`)) }
  const doc = roots => ({ querySelectorAll: () => roots, body: { querySelectorAll: () => [node(null, 'Thân trang')] } })
  const run = d => new Function('document', S.PAGE_SIGN_TEXTS_SCRIPT)(d)
  assert.deepEqual(run(doc([main])), ['Bạn hiện không xem được nội dung này', 'Đi đến Bảng feed', 'nhiều dấu cách'])
  assert.equal(run(doc([many])).length, 300)
  assert.deepEqual(run(doc([])), ['Thân trang'], 'không có vùng chính thì đọc thân trang')
  assert.ok(S.PAGE_SIGN_TEXTS_SCRIPT.startsWith('/* aka:page-sign-texts */'), 'dấu để trang giả nhận ra')
  pass('bản đọc chữ trên trang: vùng chính / hộp thoại, bỏ trùng và chữ quá dài, tối đa 300')

  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(error => { console.error(error); process.exit(1) })
