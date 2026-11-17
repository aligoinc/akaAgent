// V563 (sửa riêng phần engine sau khi rà lỗi Facebook 30 ngày, 17/11/2026): kiểm trên PostgreSQL 17 cục bộ và mô-đun errorSigns.ts.
//   1. Bản "[engine] fb_collect_search_groups": code chạy được; đọc số bài/ngày thẻ tiếng Anh ("90+ posts a day", "1 post a day",
//      "5 posts per day") như thẻ tiếng Việt; tên bỏ tiền tố "Profile photo of"; bộ cũ (block nguồn) không đổi.
//   1b. Bản "[engine] fb_comment_at_position" (chạy đúng code mới trong Chromium với trang mô phỏng tường nhóm) và bản "[engine]
//      fb_adjust_group_post_comments_after_pending (chưa lấy được link bài vừa đăng thì bỏ lượt "bài của mình", báo câu ⚠️; mọi ca khác
//      ra đúng như code bộ cũ).
//   2. Dấu hiệu FB11: đăng nhóm ra FB40 mà trang có nút "Tham gia nhóm" → FB11; trang nhóm đã tham gia (chữ thật 17/11) → không;
//      "Bạn hiện không xem được nội dung này" vẫn ra FB14; thao tác khác / mã khác → không.
//   3. SQL: preflight chặn khi dòng dấu hiệu / chính sách FB40 / code block lệch; apply; chính sách hiệu lực FB11 khi đăng nhóm = FB40 ở mọi
//      pha và trạng thái (trừ câu cho khách, câu là câu anh duyệt); comment trong chiến dịch đăng nhóm không cộng / đặt lại chuỗi, FB03 khi
//      comment không dừng (so chính sách hiệu lực trước / sau ở mọi mã, pha, loại chiến dịch có comment: chỉ chỗ đó đổi); FB11 ở thao tác khác
//      không đổi; apply lại bị từ chối; gỡ rồi apply lại.
// Chạy: node scripts/engine-v2-facebook/v563-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, seedV563Blocks, readMigration, V563_MIGRATION, V563_ROLLBACK } =
  require('./fixture.cjs')
const B = require('../build-v563-sql.cjs')

const ROOT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.FB_V563_TEST_PORT || 55562)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

// Chữ đọc trên trang Facebook thật 17/11 bằng tài khoản thử của anh (cùng cách đọc với PAGE_SIGN_TEXTS_SCRIPT; tên nhóm đổi thành chữ chung).
const NOT_MEMBER_PAGE = ['Nhóm A', 'Tham gia nhóm', 'Xem các nhóm đề xuất', 'Tìm kiếm trong nhóm này', 'Xem thêm', 'Giới thiệu']
const MEMBER_PAGE = ['Chỉnh sửa ảnh bìa của nhóm', 'Chỉnh sửa', 'Nhóm B', 'Mời', 'Chia sẻ nhóm', 'Chia sẻ', 'Tìm kiếm trong nhóm này', 'Xem thêm',
  'Bạn viết gì đi...', 'Bài viết ẩn danh', 'Cảm xúc/hoạt động', 'Thăm dò ý kiến', 'Đáng chú ý', 'sắp xếp bảng feed nhóm theo Phù hợp nhất']

async function loadSigns() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-v563-'))
  const outfile = path.join(dir, 'signs.cjs')
  await build({ entryPoints: [path.join(ROOT, 'src/main/engineAdapters/facebook/errorSigns.ts')], outfile, bundle: true, platform: 'node',
    format: 'cjs', logLevel: 'warning' })
  const mod = require(outfile)
  fs.rmSync(dir, { recursive: true, force: true })
  return mod
}

// Trang mô phỏng tường nhóm Facebook (cấu trúc đọc trên trang thật 17/11: nút "Bình luận về bài viết của …", link bài /groups/<g>/posts/<id>/
// trong khung bài; bài vừa đăng nằm ngoài role=feed, phía trên). Mỗi nút có data-test để biết block bấm vào bài nào.
function groupPage({ own = 'visible', featured = false, ownShares = false } = {}) {
  const post = (id, label, extra = '') => `<div class="post"><a href="/groups/123/user/9/">${label}</a> <a href="/groups/123/posts/${id}/?__cft__[0]=x">5 phút</a>
    ${extra}<div role="button" aria-label="Bình luận về bài viết của ${label}" data-test="${id}">Bình luận</div></div>`
  const ownHtml = own === 'visible'
    ? post('777000111', 'LD', ownShares ? '<div class="shared"><a href="/groups/123/posts/555000222/">bài được chia sẻ</a></div>' : '')
    : own === 'processing' ? '<div>Bài viết của bạn đang được xử lý.</div>' : ''
  return `<!doctype html><html><body><div role="main">
    ${featured ? `<div aria-label="Đáng chú ý">${post('999000333', 'Quản trị viên')}</div>` : ''}
    <div class="new-post">${ownHtml}</div>
    <div role="feed">${post('111000444', 'A')}${post('222000555', 'B')}${post('333000666', 'C')}</div>
  </div></body></html>`
}

/** Chạy đúng code block mới (bọc như blockExecutor: async IIFE trong vm) với page / helpers giả, DOM thật trong Chromium. */
async function checkCommentBlockInChromium() {
  const vm = require('node:vm')
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const ELEMENT = B.LIVE.commentBlock.element.xpath
  const run = async (html, vars, position) => {
    const pw = await browser.newPage()
    await pw.setContent(html)
    const clicks = [], logs = [], keys = []
    const page = {
      async evaluate(script, ...args) {
        return pw.evaluate(({ script, args }) => {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
          return new AsyncFunction('__args', script)(args)
        }, { script, args })
      },
      async waitForSelector(xpath) {
        const found = await pw.evaluate(x => !!document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue, xpath)
        if (!found) throw new Error('waitForSelector timeout: ' + xpath)
      },
      async click(xpath) {
        clicks.push(await pw.evaluate(x => document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue?.getAttribute('data-test') ?? '?', xpath))
      },
      async fill() {}, async type() {}, async press(key) { keys.push(key) }, async dropFile() { return { fileCount: 0 } }
    }
    const helpers = {
      async elementWith(name, values) { assert.equal(name, 'fb_comment_box_at_n'); return ELEMENT.replace('${n}', String(values.n)) },
      // Ô nhập trong hộp thoại: trang thử không mở hộp thoại, block dừng ở đây (đủ để biết đã bấm ô nào).
      async element(name) { return name === 'fb_comment_dialog_textbox' ? "//*[@id='dialog-textbox']" : "//*[@id='none']" },
      async prepareCampaignContent() { return { content: 'Nội dung thử', media: [], variantIndex: 0 } },
      async sleep() {}, log(message) { logs.push(String(message)) }
    }
    const sandbox = vm.createContext({ input: { position }, page, vars: { ...vars }, helpers, signal: { aborted: false },
      console, setTimeout, clearTimeout, Promise, JSON, Math, Date, RegExp, Array, Object, String, Number, Boolean, Map, Set, Symbol, Error, URL })
    const out = await vm.runInContext(`(async () => {\n${B.COMMENT.newCode}\n})()`, sandbox)
    await pw.close()
    return { out, clicks, logs, keys }
  }
  const OWN_URL = 'https://www.facebook.com/groups/123/posts/777000111/'
  const groupVars = (extra = {}) => ({ groupPostSubmitted: true, groupPostIsPending: false, commentType: 'own', groupPostPostUrl: OWN_URL, ...extra })
  try {
    await check('comment bài của mình: bấm đúng nút của bài vừa đăng (kể cả khi có bài ghim đứng trước)', async () => {
      const a = await run(groupPage(), groupVars(), 1)
      assert.deepEqual(a.clicks, ['777000111'])
      const b = await run(groupPage({ featured: true }), groupVars(), 1)
      assert.deepEqual(b.clicks, ['777000111'], 'bộ cũ bấm bài ghim (ô đầu tiên)')
      const c = await run(groupPage({ featured: true }), groupVars({ commentType: 'all' }), 1)
      assert.deepEqual(c.clicks, ['777000111'], '"comment tất cả", vị trí 1 = bài của mình')
    })
    await check('comment bài của mình: chưa lấy được link / bài video chưa hiện / bài có chia sẻ bài khác → bỏ qua, không bấm bài nào', async () => {
      for (const [html, vars, why] of [
        [groupPage(), groupVars({ groupPostPostUrl: '' }), 'chưa lấy được link'],
        [groupPage({ own: 'processing' }), groupVars(), 'bài video chưa hiện'],
        [groupPage({ own: 'none' }), groupVars(), 'bài không có trên trang'],
        [groupPage({ ownShares: true }), groupVars(), 'khung bài có 2 mã bài'],
        [groupPage(), groupVars({ groupPostPostUrl: 'https://www.facebook.com/groups/123/pending_posts/777000111/' }), 'link bài chờ duyệt']
      ]) {
        const r = await run(html, vars, 1)
        assert.deepEqual(r.clicks, [], why)
        assert.equal(r.out.commented, false, why)
        assert.equal(r.out.ownPostSkipped, true, why)
        assert.deepEqual(r.logs, [B.OWN_POST_SKIP_MESSAGE], why)
      }
    })
    await check('comment bài khác: ô ở vị trí đó là bài vừa đăng thì lấy bài kế tiếp; còn lại như bộ cũ', async () => {
      const shifted = await run(groupPage(), groupVars({ commentType: 'others', groupPostIsPending: true }), 1)
      assert.deepEqual(shifted.clicks, ['111000444'], 'vị trí 1 (đã lùi vì chờ duyệt) mà là bài mình: lấy bài kế')
      const same = await run(groupPage(), groupVars({ commentType: 'others' }), 2)
      assert.deepEqual(same.clicks, ['111000444'], 'vị trí 2 như bộ cũ')
      const featured = await run(groupPage({ featured: true }), groupVars({ commentType: 'others' }), 2)
      assert.deepEqual(featured.clicks, ['111000444'], 'bài ghim đứng đầu: vị trí 2 là bài mình, lấy bài kế')
      const allPending = await run(groupPage({ own: 'none' }), groupVars({ commentType: 'all', groupPostIsPending: true }), 1)
      assert.deepEqual(allPending.clicks, ['111000444'], '"comment tất cả" khi chờ duyệt: vị trí 1 là bài đầu tường như bộ cũ')
    })
    await check('comment seeding (không phải đăng nhóm): giữ y bộ cũ, bấm ô thứ N', async () => {
      const r = await run(groupPage(), { commentType: 'own' }, 1)
      assert.deepEqual(r.clicks, ['777000111'])
      const r3 = await run(groupPage(), {}, 3)
      assert.deepEqual(r3.clicks, ['222000555'])
    })
  } finally {
    await browser.close()
  }
}

async function main() {
  // ---------------------------------------------------------------------------------------------- 1. block (không cần DB)
  await check('block mới: code chạy được, chỉ đổi đúng 2 chỗ so với bản đang chạy', async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', B.newCode)
    const script = B.newCode.match(/page\.evaluate\(String\.raw`([\s\S]*?)`, limit, minMembers, minPostsPerDay, keyword\)/)
    assert.ok(script, 'còn đoạn page.evaluate(String.raw`…`)')
    new AsyncFunction('__args', script[1])
    let back = B.newCode
    for (const edit of B.EDITS) back = back.replace(edit.to, () => edit.from)
    assert.equal(md5(back), B.OLD_MD5, 'trả 2 chỗ sửa lại thì đúng bản đang chạy')
  })

  await check('block mới: số bài/ngày thẻ tiếng Anh như tiếng Việt; thẻ không ghi số bài vẫn 0; tên bỏ "Profile photo of"', async () => {
    const expr = B.newCode.match(/const postMatch = ([^;]+);/)
    assert.ok(expr, 'còn câu postMatch')
    const postMatch = new Function('text', `return ${expr[1]}`)
    const oldExpr = B.LIVE.block.code.match(/const postMatch = ([^;]+);/)[1]
    const oldPostMatch = new Function('text', `return ${oldExpr}`)
    // Dạng thẻ lấy từ debug_data.rawText production 30 ngày (số đã che bớt, tên nhóm bỏ).
    const cases = [
      ['Nhóm A Public · 12K members · 90+ posts a day Join', '90', null],
      ['Nhóm A Public · 9.9K members · 5 posts a day Join', '5', null],
      ['Nhóm A Public · 899 members · 1 post a day Join', '1', null],
      ['Nhóm A Public · 74K members · 20 posts per day 3 friends are members Join', '20', null],
      ['Nhóm A Public · 3K members · 20 posts/day Join', '20', '20'],
      ['Nhóm A Công khai · 50K thành viên · 90+ bài viết/ngày Tham gia', '90', '90'],
      ['Nhóm A Công khai · 5,4K thành viên · 70+ bài viết/ngày Tham gia', '70', '70'],
      ['Chung Cư Cũ Công khai · 4K thành viên Tham gia', null, null]
    ]
    for (const [text, want, before] of cases) {
      assert.equal(postMatch(text)?.[1] ?? null, want, text)
      assert.equal(oldPostMatch(text)?.[1] ?? null, before, `bản cũ: ${text}`)
    }
    const nameLine = B.newCode.match(/\.replace\(\/\^\(\?:Profile photo of\|Ảnh đại diện của\)\\s\+\/i, ''\)/)
    assert.ok(nameLine, 'còn câu bỏ tiền tố tên')
    const strip = name => name.replace(/^(?:Profile photo of|Ảnh đại diện của)\s+/i, '')
    assert.equal(strip('Profile photo of CHO THUÊ CĂN HỘ'), 'CHO THUÊ CĂN HỘ')
    assert.equal(strip('Ảnh đại diện của Nhóm A'), 'Nhóm A')
    assert.equal(strip('Nhóm Profile photo of B'), 'Nhóm Profile photo of B')
  })

  // ---------------------------------------------------------------------------------------------- 1b. block comment (Chromium)
  await check('block comment: code chạy được, bỏ phần V563 thì ra đúng bản đang chạy', async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', B.COMMENT.newCode)
    let back = B.COMMENT.newCode.slice(B.BLOCKS[1].prepend.length)
    for (const edit of B.COMMENT.edits) back = back.replace(edit.to, () => edit.from)
    assert.equal(md5(back), B.COMMENT.oldMd5)
  })
  await checkCommentBlockInChromium()

  await check('block chỉnh comment: code chạy được, bỏ phần V563 thì ra đúng bản đang chạy', async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', B.ADJUST.newCode)
    let back = B.ADJUST.newCode
    for (const edit of B.ADJUST.edits) back = back.replace(edit.to, () => edit.from)
    assert.equal(md5(back), B.ADJUST.oldMd5)
  })
  await check('block chỉnh comment: chưa lấy được link → bỏ lượt "bài của mình", báo câu ⚠️; mọi ca khác ra đúng như bộ cũ', async () => {
    const vm = require('node:vm')
    const runAdjust = async (code, vars) => {
      const logs = []
      const v = { enableComment: true, commentGroupMode: 'all', groupPostSubmitted: true, groupPostIsPending: false, ...vars }
      const sandbox = vm.createContext({ input: {}, page: {}, vars: v, helpers: { log: m => logs.push(String(m)) }, signal: { aborted: false },
        Array, Object, String, Number, Boolean, JSON, Math })
      const out = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox)
      return { out: JSON.parse(JSON.stringify(out)), iterations: JSON.parse(JSON.stringify(v.commentIterations)), logs }
    }
    const iters = positions => positions.map(position => ({ position, text: 'C' + position, images: [] }))
    const OWN_URL = 'https://www.facebook.com/groups/123/posts/777000111/'
    const PENDING_URL = 'https://www.facebook.com/groups/123/pending_posts/777000111/'
    const positionsOf = r => r.iterations.map(i => i.position)
    const own = await runAdjust(B.ADJUST.newCode, { commentType: 'own', commentIterations: iters([1]), groupPostPostUrl: '' })
    assert.deepEqual(positionsOf(own), [])
    assert.equal(own.out.skippedByGroupMode, true)
    assert.equal(own.out.skipReason, B.OWN_POST_SKIP_MESSAGE)
    assert.equal(own.out.adjusted, true)
    assert.deepEqual(own.logs, [B.OWN_POST_SKIP_MESSAGE])
    const all = await runAdjust(B.ADJUST.newCode, { commentType: 'all', commentIterations: iters([1, 2, 3]), groupPostPostUrl: '' })
    assert.deepEqual(positionsOf(all), [2, 3], '"comment tất cả": chỉ bỏ lượt bài của mình')
    assert.deepEqual(all.iterations.map(i => i.text), ['C2', 'C3'], 'nội dung của lượt bài khác giữ nguyên')
    assert.equal(all.out.skipReason, B.OWN_POST_SKIP_MESSAGE)
    const same = [
      [{ commentType: 'own', commentIterations: iters([1]), groupPostPostUrl: OWN_URL }, 'có link'],
      [{ commentType: 'all', commentIterations: iters([1, 2]), groupPostPostUrl: 'https://www.facebook.com/permalink.php?story_fbid=777000111&id=1' }, 'link story_fbid'],
      [{ commentType: 'own', commentIterations: iters([1]), groupPostPostUrl: PENDING_URL, groupPostIsPending: true }, 'chờ duyệt (bộ cũ đã bỏ qua, không câu)'],
      [{ commentType: 'all', commentIterations: iters([1, 2]), groupPostPostUrl: '', groupPostIsPending: true }, '"comment tất cả" khi chờ duyệt'],
      [{ commentType: 'others', commentIterations: iters([2, 3]), groupPostPostUrl: '' }, 'comment bài khác'],
      [{ commentType: 'others', commentIterations: iters([2, 3]), groupPostPostUrl: '', groupPostIsPending: true }, 'comment bài khác khi chờ duyệt (lùi vị trí)'],
      [{ commentType: 'own', commentIterations: iters([1]), groupPostPostUrl: '', groupPostSubmitted: false }, 'chưa đăng xong'],
      [{ commentType: 'own', commentIterations: iters([1]), groupPostPostUrl: '', enableComment: false }, 'không bật comment'],
      [{ commentType: 'own', commentIterations: iters([1]), groupPostPostUrl: '', commentGroupMode: 'pending_only' }, 'chỉ comment nhóm chờ duyệt (câu bộ cũ)'],
      [{ commentType: 'own', commentIterations: iters([1]), groupPostPostUrl: '', commentGroupMode: 'published_only', groupPostIsPending: true }, 'chỉ comment nhóm đăng ngay'],
      [{ commentType: 'own', commentIterations: [], groupPostPostUrl: '' }, 'không có lượt comment']
    ]
    for (const [vars, why] of same) {
      assert.deepEqual(await runAdjust(B.ADJUST.newCode, vars), await runAdjust(B.LIVE.adjustBlock.code, vars), why)
    }
  })

  // ---------------------------------------------------------------------------------------------- 2. dấu hiệu (errorSigns.ts)
  const S = await loadSigns()
  await check('dấu hiệu: dòng mới đọc đủ 5 mục; "Tham gia nhóm" → FB11 chỉ khi đăng nhóm ra FB40; FB14 vẫn đứng trước', async () => {
    const signs = S.parseFacebookErrorSigns(B.NEW_SIGNS)
    assert.equal(signs.length, B.SIGN_COUNT)
    assert.deepEqual(JSON.parse(B.NEW_SIGNS).slice(0, -1), JSON.parse(B.OLD_SIGNS), 'giữ nguyên 4 dấu hiệu V559, thêm FB11 ở cuối')
    const ctx = (actionCode, phase, currentErrorCode) => ({ actionCode, phase, currentErrorCode })
    const pick = (c, pageTexts) => S.pickFacebookErrorSign(signs, c, { pageTexts, messages: [] })?.code ?? null
    for (const phase of ['before_send', 'in_flight', 'after_send']) {
      assert.equal(pick(ctx('fb_post_group', phase, B.FB40), NOT_MEMBER_PAGE), B.FB11, phase)
    }
    assert.equal(pick(ctx('fb_post_group', 'before_send', B.FB40), MEMBER_PAGE), null, 'nhóm đã tham gia: như hôm nay')
    assert.equal(pick(ctx('fb_post_group', 'before_send', B.FB40), ['Join group']), B.FB11, 'giao diện tiếng Anh')
    assert.equal(pick(ctx('fb_post_group', 'before_send', B.FB40), ['Tham gia nhóm', 'Bạn hiện không xem được nội dung này']),
      'err_fb_group_cannot_post_unavailable', 'nhóm không xem được: FB14 như V559')
    assert.equal(pick(ctx('fb_post_group', 'before_send', null), NOT_MEMBER_PAGE), null, 'kết quả chưa có mã: không gắn FB11')
    assert.equal(pick(ctx('fb_post_group', 'before_send', 'err_undefined'), NOT_MEMBER_PAGE), null, 'mã khác FB40: không thay')
    assert.equal(pick(ctx('fb_comment', 'before_send', B.FB40), NOT_MEMBER_PAGE), null, 'thao tác khác: không')
    assert.equal(pick(ctx('fb_post_group', 'before_send', B.FB40), ['Tham gia nhóm để bình luận']), null, 'chữ phải bằng, không chứa')
    assert.ok(S.hasPageSigns(signs, 'fb_post_group', B.FB40), 'đăng nhóm ra FB40 thì có đọc chữ trên trang')
  })

  // ---------------------------------------------------------------------------------------------- 3. SQL trên PG17
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v563-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const q = async (sql, args = []) => (await db.query(sql, args)).rows
  const one = async (sql, args = []) => (await q(sql, args))[0]
  const v563 = readMigration(V563_MIGRATION)
  const rollback = readMigration(V563_ROLLBACK)
  const expectRefused = async (sql, pattern) => {
    let error = null
    try { await db.query(sql) } catch (e) { error = e }
    await db.query('ROLLBACK').catch(() => {})
    assert.ok(error, 'phải bị từ chối')
    assert.match(error.message, pattern)
  }
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    await seedV563Blocks(db)
    const statuses = await q(`SELECT id, code FROM public.auto_status WHERE component_type = 'campaign_detail'`)
    const fbActions = (await q(`SELECT code FROM public.auto_account_actions WHERE flatform_type = 'facebook' AND is_active AND NOT is_delete ORDER BY code`))
      .map(r => r.code)
    const PHASES = ['before_send', 'in_flight', 'after_send']
    const resolve = async (code, status, action, phase) => (await one(
      `SELECT public.aka_agent_engine_resolve_policy($1, $2, $3, NULL, 'desktop', $4) AS p`, [code, status, action, phase])).p
    const strip = p => { const c = { ...p }; delete c.policy_ids; delete c.revisions; delete c.log_template; delete c.campaign_note_template; return c }
    const snapshot = async (code, actions) => {
      const out = {}
      for (const action of actions) for (const phase of PHASES) out[`${action}|${phase}`] = strip(await resolve(code, null, action, phase))
      return out
    }
    const fb11Before = await snapshot(B.FB11, fbActions)
    // Chính sách hiệu lực của comment / đăng bài ở các loại chiến dịch có comment (và không gắn loại), mọi mã Facebook / hệ thống, mọi pha.
    const errorCodes = (await q(`SELECT error_code FROM public.auto_error WHERE public_code ~ '^(FB|SYS|NET|UNK)' AND is_active ORDER BY error_code`))
      .map(r => r.error_code)
    const commentSnapshot = async () => {
      const out = {}
      for (const camp of ['facebook_group_post', 'facebook_comment_seeding', 'facebook_comment_seeding_post', null]) {
        for (const action of ['fb_comment', 'fb_post_group']) {
          for (const code of [null, ...errorCodes]) {
            for (const phase of PHASES) {
              out[`${camp}|${action}|${code}|${phase}`] = strip((await one(
                `SELECT public.aka_agent_engine_resolve_policy($1, NULL, $2, $3, 'desktop', $4) AS p`, [code, action, camp, phase])).p)
            }
          }
        }
      }
      return out
    }
    const commentBefore = await commentSnapshot()
    const blockRow = async id => one(`SELECT md5(code) AS m, name FROM public.auto_blocks WHERE id = $1`, [id])
    const signsValue = async () => (await one(`SELECT value FROM public.auto_system_settings WHERE key = 'facebook.error_signs'`)).value

    await check('preflight: dòng dấu hiệu / chính sách FB40 / code block lệch bản đã đọc thì từ chối, không đổi gì', async () => {
      const original = await signsValue()
      await db.query(`UPDATE public.auto_system_settings SET value = value || ' ' WHERE key = 'facebook.error_signs'`)
      await expectRefused(v563, /facebook\.error_signs đã đổi/)
      await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'facebook.error_signs'`, [original])
      await db.query(`UPDATE public.auto_outcome_policies SET pace_mode = 'none' WHERE error_code = $1 AND action_code IS NULL AND source = 'v559_fb_draft'`, [B.FB40])
      await expectRefused(v563, /chính sách FB40 chung không còn đúng/)
      await db.query(`UPDATE public.auto_outcome_policies SET pace_mode = 'full' WHERE error_code = $1 AND action_code IS NULL AND source = 'v559_fb_draft'`, [B.FB40])
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [B.LIVE.block.id])
      await expectRefused(v563, /không còn đúng bản đã đọc/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [B.LIVE.block.code, B.LIVE.block.id])
      assert.equal((await blockRow(B.LIVE.block.id)).m, B.OLD_MD5)
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [B.LIVE.adjustBlock.id])
      await expectRefused(v563, /không còn đúng bản đã đọc/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [B.LIVE.adjustBlock.code, B.LIVE.adjustBlock.id])
      assert.equal((await blockRow(B.LIVE.adjustBlock.id)).m, B.ADJUST.oldMd5)
      assert.equal(await signsValue(), B.OLD_SIGNS)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_outcome_policies WHERE source = $1`, [B.SOURCE])).n, 0)
    })

    await check('apply: bản engine đổi, block bộ cũ không đổi, dòng dấu hiệu = bản mới, đúng 1 chính sách FB11 khi đăng nhóm', async () => {
      await db.query(v563)
      assert.deepEqual(await blockRow(B.LIVE.block.id), { m: B.NEW_MD5, name: B.LIVE.block.name })
      assert.deepEqual(await blockRow(B.LIVE.block.sourceId), { m: B.LIVE.block.sourceMd5, name: B.LIVE.block.sourceName })
      const comment = B.LIVE.commentBlock
      assert.deepEqual(await blockRow(comment.id), { m: B.COMMENT.newMd5, name: comment.name })
      assert.deepEqual(await blockRow(comment.sourceId), { m: comment.sourceMd5, name: comment.sourceName }, 'block comment bộ cũ không đổi')
      const adjust = B.LIVE.adjustBlock
      assert.deepEqual(await blockRow(adjust.id), { m: B.ADJUST.newMd5, name: adjust.name })
      assert.deepEqual(await blockRow(adjust.sourceId), { m: adjust.sourceMd5, name: adjust.sourceName }, 'block chỉnh comment bộ cũ không đổi')
      assert.deepEqual(await q(`SELECT id::int, commit_level, send_ops, reviewed_code_md5 FROM public.auto_engine_block_steps WHERE block_id = $1`, [comment.id]),
        [{ id: comment.steps[0].id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: B.COMMENT.newMd5 }], 'danh mục bước ghi md5 đã duyệt mới')
      assert.equal(await signsValue(), B.NEW_SIGNS)
      const rows = await q(`SELECT action_code, log_template, campaign_note_template FROM public.auto_outcome_policies WHERE source = $1 AND error_code = $2`,
        [B.SOURCE, B.FB11])
      assert.deepEqual(rows, [{ action_code: 'fb_post_group', log_template: B.FB11_TITLE, campaign_note_template: B.FB11_TITLE }])
      const commentRows = await q(`SELECT error_code, target_streak_effect, campaign_effect, run_effect FROM public.auto_outcome_policies
        WHERE source = $1 AND action_code = 'fb_comment' AND campaign_action_id = $2 ORDER BY error_code NULLS FIRST`, [B.SOURCE, B.GROUP_POST])
      assert.deepEqual(commentRows, [{ error_code: null, target_streak_effect: 'ignore', campaign_effect: null, run_effect: null },
        { error_code: B.FB03, target_streak_effect: null, campaign_effect: 'none', run_effect: 'continue' }])
    })

    await check('chính sách hiệu lực: FB11 khi đăng nhóm = FB40 ở mọi pha và trạng thái báo lên; câu cho khách là câu anh duyệt', async () => {
      for (const phase of PHASES) {
        for (const status of [null, ...statuses.map(s => Number(s.id))]) {
          const mine = await resolve(B.FB11, status, 'fb_post_group', phase)
          const today = await resolve(B.FB40, status, 'fb_post_group', phase)
          assert.deepEqual(strip(mine), strip(today), `${phase} / ${status}`)
          assert.equal(mine.log_template, B.FB11_TITLE)
        }
      }
    })

    await check('đăng nhóm kiêm comment: chỉ comment trong chiến dịch đăng nhóm đổi (không cộng / đặt lại chuỗi; FB03 không dừng, chạy tiếp); comment seeding, đăng bài, chiến dịch khác giữ nguyên', async () => {
      const after = await commentSnapshot()
      let changed = 0
      for (const key of Object.keys(commentBefore)) {
        const [camp, action, code, phase] = key.split('|')
        if (action === 'fb_post_group' && code === B.FB11) {
          // Phần FB11 của V563 (kiểm riêng ở trên): FB11 khi đăng bài = FB40 ở mọi loại chiến dịch.
          assert.deepEqual(after[key], after[`${camp}|fb_post_group|${B.FB40}|${phase}`], key)
          continue
        }
        const want = { ...commentBefore[key] }
        if (camp === B.GROUP_POST && action === 'fb_comment') {
          want.target_streak_effect = 'ignore'
          if (code === B.FB03) { want.campaign_effect = 'none'; want.run_effect = 'continue' }
        }
        if (JSON.stringify(want) !== JSON.stringify(commentBefore[key])) changed++
        assert.deepEqual(after[key], want, key)
      }
      assert.ok(changed > 100, `số chỗ đổi: ${changed}`)
      // Trước V563 comment hỏng khi bài bị bỏ qua (không có kết quả gửi) cộng chuỗi; mã chung (SYS99) có ngưỡng 4 tạm dừng chiến dịch.
      assert.equal(commentBefore[`${B.GROUP_POST}|fb_comment|err_undefined|after_send`].target_streak_effect, 'increment')
      assert.equal(commentBefore[`${B.GROUP_POST}|fb_comment|${B.FB03}|after_send`].campaign_effect, 'pause')
    })

    await check('FB11 ở thao tác khác không đổi; apply lại bị từ chối', async () => {
      const after = await snapshot(B.FB11, fbActions)
      const changed = Object.keys(fb11Before).filter(k => JSON.stringify(fb11Before[k]) !== JSON.stringify(after[k]))
      assert.deepEqual(changed, PHASES.map(phase => `fb_post_group|${phase}`))
      await expectRefused(v563, /không còn đúng bản đã đọc/)
    })

    await check('gỡ rồi apply lại: về đúng bản trước V563 (block, dấu hiệu, chính sách), apply lại được', async () => {
      await db.query(rollback)
      assert.equal((await blockRow(B.LIVE.block.id)).m, B.OLD_MD5)
      assert.equal((await blockRow(B.LIVE.commentBlock.id)).m, B.COMMENT.oldMd5)
      assert.equal((await blockRow(B.LIVE.adjustBlock.id)).m, B.ADJUST.oldMd5)
      assert.equal((await one(`SELECT reviewed_code_md5 AS m FROM public.auto_engine_block_steps WHERE block_id = $1`, [B.LIVE.commentBlock.id])).m, B.COMMENT.oldMd5)
      assert.equal(await signsValue(), B.OLD_SIGNS)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_outcome_policies WHERE source = $1`, [B.SOURCE])).n, 0)
      assert.deepEqual(await snapshot(B.FB11, fbActions), fb11Before)
      assert.deepEqual(await commentSnapshot(), commentBefore, 'chính sách comment về như trước V563')
      await expectRefused(rollback, /không phải bản V563/)
      await db.query(v563)
      assert.equal((await blockRow(B.LIVE.block.id)).m, B.NEW_MD5)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
