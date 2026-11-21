// V607 (engine v2 Facebook, 21/11/2026, câu 533 / 602 của bộ kiểm lỗi): comment vào link bài mà Facebook mở ra trang xác minh (/checkpoint/)
// hoặc trang đăng nhập (/login).
//   1. Bộ sinh: code block mới dựng được thành hàm async, gỡ đúng chỗ sửa thì ra đúng code production (bản V598, md5 1c885e94…, đọc 21/11), chữ NFC.
//   2. Chạy đúng code block 2869 (bản production V598 và bản V607) trong Chromium trên các trang giả: trang xác minh mở từ link bài / link chờ
//      duyệt (câu 533 / 602: currentUrl /checkpoint/…), trang đăng nhập (/login/, /login.php), cùng mọi trang hôm nay đã phân loại đúng (link
//      chờ duyệt của câu 584 / V598, "Bạn hiện không xem được nội dung này" của câu 564, bài của mình đang chờ duyệt, link có chữ login ở query,
//      trang không nhận ra, có ô bình luận). Bản production ra FB41 ở trang xác minh / đăng nhập (tái hiện lỗi); bản V607 ra err_fb_checkpoint
//      (FB04) / err_engine_fb_logged_out (FB43), mọi trang khác ra y hệt bản production.
//   3. SQL trên PG17: DB nhận thẳng hai mã block trả (aka_agent_engine_classify_signal 'direct'), chính sách chung của hai mã là về hàng đợi +
//      đổi trạng thái đăng nhập; preflight từ chối khi block / danh mục bước / bộ cũ / mã / sổ lệch; apply đổi đúng block 2869 + md5 đã duyệt
//      của danh mục bước; bộ cũ 2616 không đổi; apply lại bị từ chối; gỡ về đúng bản production rồi apply lại được.
// Chạy: CHAT_REPO=<akaAgentChatApi> LC_ALL=C CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/v607-smoke.cjs
//   V607_ONLY=chromium | sql: chỉ chạy một phần. V607_EXPECT_NEW_ON_OLD=1: chạy kỳ vọng của bản V607 trên code production (phải hỏng).
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPageAdapter, BASE, GROUP } = require('./fb-group-fake.cjs')

const ROOT = path.resolve(__dirname, '../..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v607-live-20261121.json'), 'utf8'))
// Element của block không đổi từ bản đọc 20/11 (V598): block chỉ dùng ô bình luận / link bài / câu giới hạn tần suất.
const ELEMENTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v598-live-20261120.json'), 'utf8')).elements
const OLD_CODE = require('../build-v598-sql.cjs').NEW_CODE
const V = fs.existsSync(path.join(ROOT, 'scripts/build-v607-sql.cjs')) ? require('../build-v607-sql.cjs') : null
const PORT = Number(process.env.FB_V607_TEST_PORT || 55607)
const ONLY = process.env.V607_ONLY || ''
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

// ------------------------------------------------------------------------------------------------ trang giả (chữ như trang thật, tên giả)
const POST_ID = '4444000111'
const PENDING_URL = `${BASE}/groups/${GROUP}/pending_posts/${POST_ID}/`
const POST_URL = `${BASE}/groups/${GROUP}/posts/${POST_ID}/`
const CHECKPOINT_URL = next => `${BASE}/checkpoint/1501092823525282/?next=${encodeURIComponent(next)}`
const NAV = '<div role="navigation"><span>Số thông báo chưa đọc</span><span>Menu trên Facebook</span><span>Trang chủ</span></div>'
const FILTERS = '<div><span>Xóa bộ lọc</span><span>Lọc theo</span><span>Chọn ngày</span><span>Tác giả</span><span>Loại nội dung</span><span>Liên kết</span></div>'
const pendingArticle = i => `<div role="article"><h3 role="heading">Người đăng thử</h3><span>Thứ Sáu, ${i} Tháng 11, 2026 lúc 12:2${i}</span>`
  + `<div data-ad-preview="message">Nội dung bài chờ ${i}</div><div role="button">Phê duyệt</div></div>`
const html = (main, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>Nhóm thử | Facebook</title></head><body>${NAV}`
  + `<div role="main">${main}</div>${extra}</body></html>`
const bare = main => `<!doctype html><html><head><meta charset="utf-8"><title>Facebook</title></head><body><div role="main">${main}</div></body></html>`
const postDialog = inner => `<div role="dialog" aria-label="Bài viết của Người đăng thử"><h2 role="heading">Bài viết của Người đăng thử</h2>`
  + `<div role="article"><div data-ad-preview="message">Nội dung bài</div></div>${inner}</div>`
const TEXTBOX = '<div role="textbox" contenteditable="true" aria-label="Viết bình luận công khai..." style="min-height:20px"></div>'
const CHECKPOINT_BODY = bare('<h2 role="heading">Chúng tôi cần xác nhận đây là bạn</h2><span>Tài khoản của bạn đã bị khóa tạm thời</span>'
  + '<div role="button">Bắt đầu</div>')
const LOGIN_BODY = bare('<h2 role="heading">Đăng nhập Facebook</h2><input name="email"><input name="pass" type="password"><div role="button">Đăng nhập</div>')

/** Mỗi trang: url mở, html, kỳ vọng của bản production (old) và bản V607 (new). Kết quả: [statusCode, errorCode, reason] hoặc 'commented'. */
const FB41 = ['campaign_detail_error', 'err_fb_comment_box_not_found', 'unknown']
const FB15 = ['campaign_detail_failed', 'err_fb_comment_unavailable_post_pending', 'post_pending']
const FB17 = ['campaign_detail_not_found', 'err_fb_comment_unavailable_post_not_found', 'post_not_found']
const OLD_CHECKPOINT = ['campaign_detail_error', 'err_fb_comment_box_not_found', 'checkpoint']
const OLD_LOGGED_OUT = ['campaign_detail_error', 'err_fb_comment_box_not_found', 'logged_out']
const FB04 = ['campaign_detail_error', 'err_fb_checkpoint', 'checkpoint']
const FB43 = ['campaign_detail_error', 'err_engine_fb_logged_out', 'logged_out']
const PAGES = [
  { key: 'checkpoint_post', why: 'link bài bị chuyển sang trang xác minh (câu 533 / 602: 31 lượt thật)', url: CHECKPOINT_URL(POST_URL),
    body: CHECKPOINT_BODY, old: OLD_CHECKPOINT, new: FB04 },
  { key: 'checkpoint_pending', why: 'link chờ duyệt bị chuyển sang trang xác minh, trang còn chữ "Bài viết đang chờ · 3": URL xét trước (V598)',
    url: CHECKPOINT_URL(PENDING_URL), body: html('<h2 role="heading">Bài viết đang chờ · 3</h2><span>Chúng tôi cần xác nhận đây là bạn</span>'),
    old: OLD_CHECKPOINT, new: FB04 },
  { key: 'checkpoint_unavailable_text', why: 'trang xác minh có chữ "Bạn hiện không xem được nội dung này": URL xét trước luật câu chữ (564)',
    url: CHECKPOINT_URL(POST_URL), body: html('<h2 role="heading">Bạn hiện không xem được nội dung này</h2>'), old: OLD_CHECKPOINT, new: FB04 },
  { key: 'login', why: 'link bài bị chuyển sang trang đăng nhập (/login/)', url: `${BASE}/login/?next=${encodeURIComponent(POST_URL)}`,
    body: LOGIN_BODY, old: OLD_LOGGED_OUT, new: FB43 },
  { key: 'login_php', why: 'trang đăng nhập kiểu /login.php', url: `${BASE}/login.php?next=${encodeURIComponent(POST_URL)}`,
    body: LOGIN_BODY, old: OLD_LOGGED_OUT, new: FB43 },
  { key: 'login_in_query', why: 'link bài thường có chữ login ở query (không phải trang đăng nhập): như hôm nay', url: `${POST_URL}?ref=login`,
    body: html('', postDialog('<span>Phù hợp nhất</span>')), old: FB41, new: FB41 },
  { key: 'pending_list', why: 'link chờ duyệt, danh sách "Bài viết đang chờ · 12" (V598): FB15 như hôm nay', url: PENDING_URL,
    body: html(`<h2 role="heading">Bài viết đang chờ · 12</h2>${FILTERS}${[1, 2, 3].map(pendingArticle).join('')}`),
    old: [...FB15, 'bài viết đang chờ · 12'], new: [...FB15, 'bài viết đang chờ · 12'] },
  { key: 'pending_empty', why: 'link chờ duyệt, hàng chờ trống (V598): FB17 như hôm nay', url: PENDING_URL,
    body: html(`<h2 role="heading">Chưa có bài viết nào để xem xét</h2><span>Không có bài viết nào đang chờ xem xét.</span>`),
    old: [...FB17, 'chưa có bài viết nào để xem xét'], new: [...FB17, 'chưa có bài viết nào để xem xét'] },
  { key: 'post_unavailable', why: 'link bài "Bạn hiện không xem được nội dung này" (câu 564): FB17 như hôm nay', url: POST_URL,
    body: html('<h2 role="heading">Bạn hiện không xem được nội dung này</h2><span>Lỗi này thường do chủ sở hữu chỉ chia sẻ nội dung với một nhóm nhỏ</span>'),
    old: [...FB17, 'bạn hiện không xem được nội dung này'], new: [...FB17, 'bạn hiện không xem được nội dung này'] },
  { key: 'post_own_pending', why: 'link /posts/ của bài mình đang chờ duyệt: FB15 như hôm nay', url: POST_URL,
    body: html('', postDialog('<span>Bài viết của bạn đang chờ quản trị viên phê duyệt.</span>')),
    old: [...FB15, 'bài viết của bạn đang chờ'], new: [...FB15, 'bài viết của bạn đang chờ'] },
  { key: 'post_unknown', why: 'hộp thoại bài không có ô bình luận, không chữ nào đã biết: FB41 như hôm nay', url: POST_URL,
    body: html('', postDialog('<span>Phù hợp nhất</span>')), old: FB41, new: FB41 },
  { key: 'post_commentable', why: 'có ô bình luận: comment như cũ', url: POST_URL, body: html('', postDialog(TEXTBOX)), old: 'commented', new: 'commented' }
]

async function runBlock(browser, code, pageCase) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route(`${BASE}/**`, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageCase.body }))
  const pw = await context.newPage()
  await pw.goto(pageCase.url)
  const ops = []
  const page = createPageAdapter(pw, ops)
  // Chờ ô bình luận 8 giây trong block: rút còn 0,6 giây (câu lỗi giữ đúng "waitForSelector timeout: …" như PageController).
  const waitFor = page.waitForSelector
  page.waitForSelector = (selector, opts = {}) => waitFor(selector, { ...opts, timeout: Math.min(opts.timeout ?? 30000, 600) })
  const logs = []
  const helpers = {
    async element(name) { if (!ELEMENTS[name]) throw new Error(`thiếu element ${name}`); return ELEMENTS[name] },
    async prepareCampaignContent() { return { content: 'Nội dung comment thử', media: [], variantIndex: 0 } },
    async sleep(ms) { await new Promise(r => setTimeout(r, Math.min(ms, 20))) },
    log(message) { logs.push(String(message)) }
  }
  const sandbox = vm.createContext({ input: {}, page, vars: { inputDataId: 77 }, helpers, signal: { aborted: false }, console, setTimeout, clearTimeout })
  let out
  try {
    out = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox)
  } catch (error) {
    out = { thrown: String(error && error.message || error) }
  }
  await context.close()
  return { out, ops, logs }
}
const summary = out => {
  if (out && out.commented === true) return 'commented'
  const r = out && out.actionResult
  if (!r) return out
  const base = [r.statusCode, r.errorCode, r.data && r.data.reason]
  return r.data && r.data.matched ? [...base, r.data.matched] : base
}

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  try {
    const runs = [['production', OLD_CODE, process.env.V607_EXPECT_NEW_ON_OLD === '1' ? 'new' : 'old']]
    if (V && process.env.V607_EXPECT_NEW_ON_OLD !== '1') runs.push(['V607', V.NEW_CODE, 'new'])
    const results = {}
    for (const [label, code, expectKey] of runs) {
      for (const pageCase of PAGES) {
        await check(`${label} · ${pageCase.key}: ${pageCase.why}`, async () => {
          const { out, ops } = await runBlock(browser, code, pageCase)
          results[`${label}:${pageCase.key}`] = out
          assert.ok(!out.thrown, `block ném lỗi: ${out.thrown}`)
          assert.deepEqual(summary(out), pageCase[expectKey])
          if (pageCase[expectKey] === 'commented') {
            assert.deepEqual(ops.filter(o => o.op === 'press').map(o => o.label), ['Enter'], 'gửi đúng một lần bằng Enter')
          } else {
            assert.deepEqual(ops.filter(o => ['fill', 'press'].includes(o.op)), [], 'không gõ / gửi gì khi không có ô bình luận')
            const data = out.actionResult.data
            assert.equal(out.actionResult.operationState, 'not_committed', 'chưa gửi: data được về hàng đợi')
            assert.equal(out.actionResult.inputDataId, 77)
            assert.ok(!('error' in data), 'data không có khoá error (runtime lấy làm lý do dừng)')
            assert.equal(out.error, out.actionResult.message)
            if (data.reason === 'unknown') assert.ok(Array.isArray(data.sample), 'trang không nhận ra vẫn lưu sample')
            else assert.ok(!('sample' in data))
          }
        })
      }
    }
    if (runs.length === 2) {
      await check('V607 · trang không phải trang xác minh / đăng nhập: kết quả y hệt bản production', async () => {
        for (const pageCase of PAGES.filter(p => JSON.stringify(p.old) === JSON.stringify(p.new))) {
          const a = JSON.parse(JSON.stringify(results[`production:${pageCase.key}`]))
          const b = JSON.parse(JSON.stringify(results[`V607:${pageCase.key}`]))
          assert.deepEqual(b, a, pageCase.key)
        }
      })
      await check('V607 · trang xác minh / đăng nhập: chỉ đổi mã lỗi; câu, lý do, url, tiêu đề trang giữ như bản production', async () => {
        for (const key of ['checkpoint_post', 'checkpoint_pending', 'checkpoint_unavailable_text', 'login', 'login_php']) {
          const a = JSON.parse(JSON.stringify(results[`production:${key}`]))
          const b = JSON.parse(JSON.stringify(results[`V607:${key}`]))
          assert.notEqual(b.actionResult.errorCode, a.actionResult.errorCode, key)
          b.actionResult.errorCode = a.actionResult.errorCode
          assert.deepEqual(b, a, key)
        }
        assert.equal(results['V607:checkpoint_post'].actionResult.message, 'Facebook yêu cầu xác minh tài khoản (checkpoint)')
        assert.equal(results['V607:login'].actionResult.message, 'Tài khoản Facebook đã bị đăng xuất')
        assert.equal(results['V607:checkpoint_post'].actionResult.data.url, CHECKPOINT_URL(POST_URL))
      })
    }
  } finally {
    await browser.close()
  }
}

// ------------------------------------------------------------------------------------------------ SQL trên PG17
async function sqlChecks() {
  const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
  const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, readMigration } = require('./fixture.cjs')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v607-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const q = async (sql, args = []) => (await db.query(sql, args)).rows
  const one = async (sql, args = []) => (await q(sql, args))[0]
  const migration = readMigration(`${V.NAME}.sql`)
  const rollback = readMigration(`${V.ROLLBACK_NAME}.sql`)
  const expectRefused = async (sql, pattern) => {
    let error = null
    try { await db.query(sql) } catch (e) { error = e }
    await db.query('ROLLBACK').catch(() => {})
    assert.ok(error, 'phải bị từ chối')
    assert.match(error.message, pattern)
  }
  const blockMd5 = async id => (await one(`SELECT md5(code) AS m FROM public.auto_blocks WHERE id = $1`, [id])).m
  const stepRows = async id => q(`SELECT id::int, commit_level, send_ops, reviewed_code_md5 FROM public.auto_engine_block_steps WHERE block_id = $1`, [id])
  const ID = LIVE.block.id
  const SOURCE = LIVE.source.id
  const STEP = LIVE.steps[0]
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    // V559: mã / luật / chính sách Facebook như production (FB43 và chính sách FB04 / FB43 của Q6 có từ V559).
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    await db.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text)`)
    // Cặp block như production (V560 chép 2616 → 2869, V598 sửa 2869), thêm một block khác để kiểm không bị đụng.
    const SOURCE_CODE = fs.readFileSync(path.join(ROOT, 'migrations/snapshots/fb-comment-post-unavailable-v472/block-2616.after.js'), 'utf8')
    await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, $2, $3, 'facebook'), ($4, $5, $6, 'facebook'),
      (2851, '[engine] fb_comment_at_position', 'return 1', 'facebook')`, [SOURCE, LIVE.source.name, SOURCE_CODE, ID, LIVE.block.name, OLD_CODE])
    await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy)
      VALUES ($1, $2, $3, $3)`, [ID, SOURCE, LIVE.copy.sourceMd5AtCopy])
    await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops, reviewed_code_md5)
      VALUES ($1, $2, 'delivery', 'fb_comment', $3, $4::jsonb, $5)`, [STEP.id, ID, STEP.commitLevel, JSON.stringify(STEP.sendOps), STEP.reviewedMd5])
    const other = await blockMd5(2851)

    await check('DB thử có đúng cặp block production (2869 = V598 1c885e94…, 2616 = V472) và dòng danh mục bước 8', async () => {
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5)
      assert.deepEqual(await stepRows(ID), [{ id: STEP.id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: V.OLD_MD5 }])
    })

    await check('DB nhận thẳng mã block trả (direct): err_fb_checkpoint → FB04, err_engine_fb_logged_out → FB43; FB41 vẫn là FB41', async () => {
      for (const code of [V.CHECKPOINT_CODE, V.LOGGED_OUT_CODE, 'err_fb_comment_box_not_found']) {
        const row = await one(`SELECT c.error_code, c.matched_by, e.public_code FROM public.aka_agent_engine_classify_signal('facebook', 'fb_comment',
          'before_send', $1::jsonb) c JOIN public.auto_error e ON e.error_code = c.error_code`, [JSON.stringify({ kind: 'block', code, errorCode: code,
          message: 'Facebook yêu cầu xác minh tài khoản (checkpoint)' })])
        assert.equal(row.error_code, code); assert.equal(row.matched_by, 'direct')
        assert.equal(row.public_code, { [V.CHECKPOINT_CODE]: 'FB04', [V.LOGGED_OUT_CODE]: 'FB43', err_fb_comment_box_not_found: 'FB41' }[code])
      }
      const policies = await q(`SELECT error_code, target_effect, login_effect, target_streak_effect, detail_mode FROM public.auto_outcome_policies
        WHERE error_code = ANY($1) AND is_active AND action_code IS NULL AND campaign_action_id IS NULL ORDER BY error_code`,
      [[V.CHECKPOINT_CODE, V.LOGGED_OUT_CODE]])
      assert.deepEqual(policies.map(p => [p.error_code, p.target_effect, p.login_effect, p.target_streak_effect, p.detail_mode]), [
        [V.LOGGED_OUT_CODE, 'requeue', 'logged_out', 'ignore', 'suppress'], [V.CHECKPOINT_CODE, 'requeue', 'checkpoint', 'ignore', 'suppress']])
    })

    await check('preflight: block / danh mục bước / bộ cũ / mã / sổ lệch thì từ chối, không đổi gì', async () => {
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [ID])
      await expectRefused(migration, /không còn đúng bản production/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [OLD_CODE, ID])
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 1 WHERE block_id = $1`, [ID])
      await expectRefused(migration, /danh mục bước .* khác bản đã đọc/)
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 2 WHERE block_id = $1`, [ID])
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [SOURCE])
      await expectRefused(migration, /block bộ cũ 2616 khác bản đã đọc/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [SOURCE_CODE, SOURCE])
      await db.query(`UPDATE public.auto_error SET is_active = false WHERE error_code = $1`, [V.LOGGED_OUT_CODE])
      await expectRefused(migration, /chưa có hoặc đang tắt trong auto_error/)
      await db.query(`UPDATE public.auto_error SET is_active = true WHERE error_code = $1`, [V.LOGGED_OUT_CODE])
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('29990101000000', 'migration_v607_thu')`)
      await expectRefused(migration, /V607 đã có trong sổ migration/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '29990101000000'`)
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5)
      assert.equal((await stepRows(ID))[0].reviewed_code_md5, V.OLD_MD5)
    })

    await check('apply: block 2869 = bản V607, danh mục bước ghi md5 mới (giữ mức 2, Enter); bộ cũ và block khác không đổi; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await blockMd5(ID), V.NEW_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [ID])).code, V.NEW_CODE)
      assert.deepEqual(await stepRows(ID), [{ id: STEP.id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: V.NEW_MD5 }])
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5, 'bộ cũ không đổi')
      assert.equal(await blockMd5(2851), other, 'block khác không đổi')
      await expectRefused(migration, /không còn đúng bản production/)
    })

    await check('gỡ: về đúng code + md5 đã duyệt của bản production (V598); gỡ lại bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [ID])).code, OLD_CODE)
      assert.equal((await stepRows(ID))[0].reviewed_code_md5, V.OLD_MD5)
      await expectRefused(rollback, /không phải bản V607/)
      await db.query(migration)
      assert.equal(await blockMd5(ID), V.NEW_MD5)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}

async function main() {
  if (V) {
    await check('bộ sinh: code mới dựng được; gỡ chỗ sửa ra đúng code production (V598); chữ NFC; chỉ hai dòng mã lỗi + một ghi chú đổi', async () => {
      assert.equal(md5(OLD_CODE), LIVE.block.md5)
      assert.equal(V.OLD_CODE, OLD_CODE)
      let back = V.NEW_CODE
      for (const edit of [...V.EDITS].reverse()) back = back.replace(edit.to, () => edit.from)
      assert.equal(md5(back), LIVE.block.md5)
      assert.equal(md5(V.NEW_CODE), V.NEW_MD5)
      assert.equal(V.NEW_CODE.normalize('NFC'), V.NEW_CODE)
      new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${V.NEW_CODE}\n})`)
      const oldLines = OLD_CODE.split('\n'), newLines = V.NEW_CODE.split('\n')
      const removed = oldLines.filter(line => !newLines.includes(line))
      const added = newLines.filter(line => !oldLines.includes(line))
      assert.equal(removed.length, 2, `đúng hai dòng cũ đổi (nhánh checkpoint, nhánh đăng nhập): ${JSON.stringify(removed)}`)
      assert.ok(removed.every(line => line.includes('errorCode: COMMENT_BOX_NOT_FOUND')))
      assert.equal(added.filter(line => line.trim().startsWith('//')).length, 2)
      assert.deepEqual(added.filter(line => !line.trim().startsWith('//')).map(line => line.match(/errorCode: '([a-z_]+)'/)[1]),
        [V.CHECKPOINT_CODE, V.LOGGED_OUT_CODE])
    })
  }
  if (ONLY !== 'sql') await chromiumChecks()
  if (ONLY !== 'chromium' && V && process.env.V607_EXPECT_NEW_ON_OLD !== '1') await sqlChecks()
  console.log(`\n${checks} kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
