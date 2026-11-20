// V598 (engine v2 Facebook, 20/11/2026, câu 584 của bộ kiểm lỗi): comment vào link bài mà khách nhập link bài chờ duyệt (/pending_posts/).
//   1. Bộ sinh: code block mới dựng được thành hàm async, gỡ đúng chỗ sửa thì ra đúng code production (md5 83bcdb40…, đọc 20/11), chữ NFC.
//   2. Chạy đúng code block 2869 (bản production và bản V598) trong Chromium trên các trang giả dựng theo chữ đọc được ở 78 lượt thật
//      (vết bước comment_current_post 18–20/11): danh sách "Bài viết đang chờ · N", hàng chờ trống "Chưa có bài viết nào để xem xét", link chờ
//      duyệt mở ra hộp thoại bài không có ô bình luận, cùng các trang hôm nay đã phân loại đúng (checkpoint của câu 533, "Bạn hiện không xem được
//      nội dung này" của câu 564, bài của mình đang chờ duyệt, có ô bình luận). Bản production ra FB41 ở hai trang đầu (tái hiện lỗi); bản V598
//      ra FB15 / FB17 (anh chốt 20/11 "Theo trang Facebook hiện"), mọi trang khác ra y hệt bản production.
//   3. SQL trên PG17: preflight từ chối khi block / danh mục bước / bộ cũ / sổ lệch; apply đổi đúng block 2869 + md5 đã duyệt của danh mục bước;
//      bộ cũ 2616 không đổi; apply lại bị từ chối; gỡ về đúng bản production rồi apply lại được.
// Chạy: CHAT_REPO=<akaAgentChatApi> LC_ALL=C CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/v598-smoke.cjs
//   V598_ONLY=chromium | sql: chỉ chạy một phần. V598_EXPECT_NEW_ON_OLD=1: chạy kỳ vọng của bản V598 trên code production (phải hỏng).
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPageAdapter, BASE, GROUP } = require('./fb-group-fake.cjs')

const ROOT = path.resolve(__dirname, '../..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v598-live-20261120.json'), 'utf8'))
const OLD_CODE = fs.readFileSync(path.join(ROOT, 'migrations/snapshots/fb-comment-post-unavailable-v472/block-2616.after.js'), 'utf8')
const V = fs.existsSync(path.join(ROOT, 'scripts/build-v598-sql.cjs')) ? require('../build-v598-sql.cjs') : null
const PORT = Number(process.env.FB_V598_TEST_PORT || 55598)
const ONLY = process.env.V598_ONLY || ''
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

// ------------------------------------------------------------------------------------------------ trang giả (chữ như trang thật, tên giả)
const POST_ID = '4444000111'
const PENDING_URL = `${BASE}/groups/${GROUP}/pending_posts/${POST_ID}/`
const POST_URL = `${BASE}/groups/${GROUP}/posts/${POST_ID}/`
const NAV = '<div role="navigation"><span>Số thông báo chưa đọc</span><span>Menu trên Facebook</span><span>Trang chủ</span></div>'
const FILTERS = '<div><span>Xóa bộ lọc</span><span>Lọc theo</span><span>Chọn ngày</span><span>Tác giả</span><span>Loại nội dung</span><span>Liên kết</span></div>'
const pendingArticle = i => `<div role="article"><h3 role="heading">Người đăng thử</h3><span>Thứ Sáu, ${i} Tháng 11, 2026 lúc 12:2${i}</span>`
  + `<div data-ad-preview="message">Nội dung bài chờ ${i}</div><div role="button">Phê duyệt</div></div>`
const html = (main, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>Nhóm thử | Facebook</title></head><body>${NAV}`
  + `<div role="main">${main}</div>${extra}</body></html>`
const postDialog = inner => `<div role="dialog" aria-label="Bài viết của Người đăng thử"><h2 role="heading">Bài viết của Người đăng thử</h2>`
  + `<div role="article"><div data-ad-preview="message">Nội dung bài</div></div>${inner}</div>`
const TEXTBOX = '<div role="textbox" contenteditable="true" aria-label="Viết bình luận công khai..." style="min-height:20px"></div>'

/** Mỗi trang: url mở, html, kỳ vọng của bản production (old) và bản V598 (new). Kết quả: [statusCode, errorCode, reason] hoặc 'commented'. */
const FB41 = ['campaign_detail_error', 'err_fb_comment_box_not_found', 'unknown']
const FB15 = ['campaign_detail_failed', 'err_fb_comment_unavailable_post_pending', 'post_pending']
const FB17 = ['campaign_detail_not_found', 'err_fb_comment_unavailable_post_not_found', 'post_not_found']
const CHECKPOINT = ['campaign_detail_error', 'err_fb_comment_box_not_found', 'checkpoint']
const PAGES = [
  { key: 'pending_list', why: 'link chờ duyệt, danh sách "Bài viết đang chờ · 12" (59/78 lượt thật)', url: PENDING_URL,
    body: html(`<h2 role="heading">Bài viết đang chờ · 12</h2>${FILTERS}${[1, 2, 3, 4, 5].map(pendingArticle).join('')}`),
    old: FB41, new: [...FB15, 'bài viết đang chờ · 12'] },
  { key: 'pending_list_split', why: 'link chờ duyệt, số bài chờ nằm trong thẻ con ("Bài viết đang chờ" + "· 7")', url: PENDING_URL,
    body: html(`<h2 role="heading">Bài viết đang chờ <span>· 7</span></h2>${FILTERS}${pendingArticle(1)}`),
    old: FB41, new: [...FB15, 'bài viết đang chờ · 7'] },
  { key: 'pending_empty', why: 'link chờ duyệt, hàng chờ trống "Chưa có bài viết nào để xem xét" (17/78 lượt thật)', url: PENDING_URL,
    body: html(`<h2 role="heading">Chưa có bài viết nào để xem xét</h2><span>Không có bài viết nào đang chờ xem xét.</span>`),
    old: FB41, new: [...FB17, 'chưa có bài viết nào để xem xét'] },
  { key: 'pending_empty_text_only', why: 'link chờ duyệt, chỉ có câu "Không có bài viết nào đang chờ xem xét."', url: PENDING_URL,
    body: html(`<span>Không có bài viết nào đang chờ xem xét.</span>`),
    old: FB41, new: [...FB17, 'không có bài viết nào đang chờ xem xét'] },
  { key: 'pending_post_dialog', why: 'link chờ duyệt mở hộp thoại bài, không có ô bình luận, không có chữ chờ duyệt (2/78): giữ FB41', url: PENDING_URL,
    body: html('', postDialog('<span>Phù hợp nhất</span>')), old: FB41, new: FB41 },
  { key: 'pending_unavailable', why: 'link chờ duyệt, "Bạn hiện không xem được nội dung này": FB17 theo luật câu chữ có sẵn (câu 564)', url: PENDING_URL,
    body: html('<h2 role="heading">Bạn hiện không xem được nội dung này</h2><span>Lỗi này thường do chủ sở hữu chỉ chia sẻ nội dung với một nhóm nhỏ</span>'),
    old: [...FB17, 'bạn hiện không xem được nội dung này'], new: [...FB17, 'bạn hiện không xem được nội dung này'] },
  { key: 'checkpoint', why: 'link chờ duyệt bị chuyển sang trang checkpoint (câu 533): giữ như hôm nay',
    url: `${BASE}/checkpoint/1501092823525282/?next=${encodeURIComponent(PENDING_URL)}`,
    body: html('<h2 role="heading">Bài viết đang chờ · 3</h2><span>Chúng tôi cần xác nhận đây là bạn</span>'), old: CHECKPOINT, new: CHECKPOINT },
  { key: 'post_own_pending', why: 'link /posts/ của bài mình đang chờ duyệt: FB15 theo luật câu chữ có sẵn', url: POST_URL,
    body: html('', postDialog('<span>Bài viết của bạn đang chờ quản trị viên phê duyệt.</span>')),
    old: [...FB15, 'bài viết của bạn đang chờ'], new: [...FB15, 'bài viết của bạn đang chờ'] },
  { key: 'post_list_heading', why: 'link /posts/ (không phải link chờ duyệt) mà trang có chữ "Bài viết đang chờ · 3": không đổi', url: POST_URL,
    body: html('<h2 role="heading">Bài viết đang chờ · 3</h2><span>Chưa có bài viết nào để xem xét</span>'), old: FB41, new: FB41 },
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
    async element(name) { if (!LIVE.elements[name]) throw new Error(`thiếu element ${name}`); return LIVE.elements[name] },
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
    const runs = [['production', OLD_CODE, process.env.V598_EXPECT_NEW_ON_OLD === '1' ? 'new' : 'old']]
    if (V && process.env.V598_EXPECT_NEW_ON_OLD !== '1') runs.push(['V598', V.NEW_CODE, 'new'])
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
            assert.equal(out.actionResult.operationState, 'not_committed')
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
      await check('V598 · trang không thuộc hai kiểu trang chờ duyệt: kết quả y hệt bản production', async () => {
        for (const pageCase of PAGES.filter(p => JSON.stringify(p.old) === JSON.stringify(p.new))) {
          const a = JSON.parse(JSON.stringify(results[`production:${pageCase.key}`]))
          const b = JSON.parse(JSON.stringify(results[`V598:${pageCase.key}`]))
          assert.deepEqual(b, a, pageCase.key)
        }
      })
      await check('V598 · trang chờ duyệt đã nhận ra: câu cho khách đúng câu luật có sẵn (FB15 / FB17), lưu url / tiêu đề trang', async () => {
        const list = results['V598:pending_list'].actionResult
        assert.equal(list.message, 'Bài Facebook đang chờ duyệt nên chưa bình luận được')
        assert.equal(list.data.url, PENDING_URL)
        assert.deepEqual(list.data.headings.filter(h => h.startsWith('Bài viết')), ['Bài viết đang chờ · 12'])
        const empty = results['V598:pending_empty'].actionResult
        assert.equal(empty.message, 'Không tìm thấy bài Facebook để bình luận')
        assert.equal(results['V598:pending_empty'].error, 'Không tìm thấy bài Facebook để bình luận')
      })
    }
  } finally {
    await browser.close()
  }
}

// ------------------------------------------------------------------------------------------------ SQL trên PG17
async function sqlChecks() {
  const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
  const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v598-', timeoutMs: 600_000 })
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
    await db.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text)`)
    // Cặp block như production (V560 chép 2616 → 2869), thêm một block khác để kiểm không bị đụng.
    await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, $2, $3, 'facebook'), ($4, $5, $3, 'facebook'),
      (2851, '[engine] fb_comment_at_position', 'return 1', 'facebook')`, [SOURCE, LIVE.source.name, OLD_CODE, ID, LIVE.block.name])
    await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy)
      VALUES ($1, $2, $3, $3)`, [ID, SOURCE, LIVE.block.md5])
    await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops, reviewed_code_md5)
      VALUES ($1, $2, 'delivery', 'fb_comment', $3, $4::jsonb, $5)`, [STEP.id, ID, STEP.commitLevel, JSON.stringify(STEP.sendOps), STEP.reviewedMd5])
    const other = await blockMd5(2851)

    await check('DB thử có đúng cặp block production (md5 83bcdb40…) và dòng danh mục bước 8', async () => {
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5)
      assert.deepEqual(await stepRows(ID), [{ id: STEP.id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: V.OLD_MD5 }])
    })

    await check('preflight: block / danh mục bước / bộ cũ / sổ lệch thì từ chối, không đổi gì', async () => {
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [ID])
      await expectRefused(migration, /không còn đúng bản production/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [OLD_CODE, ID])
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 1 WHERE block_id = $1`, [ID])
      await expectRefused(migration, /danh mục bước .* khác bản đã đọc/)
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 2 WHERE block_id = $1`, [ID])
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [SOURCE])
      await expectRefused(migration, /block bộ cũ 2616 khác bản đã đọc/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [OLD_CODE, SOURCE])
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('29990101000000', 'migration_v598_thu')`)
      await expectRefused(migration, /V598 đã có trong sổ migration/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '29990101000000'`)
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5)
      assert.equal((await stepRows(ID))[0].reviewed_code_md5, V.OLD_MD5)
    })

    await check('apply: block 2869 = bản V598, danh mục bước ghi md5 mới (giữ mức 2, Enter); bộ cũ và block khác không đổi; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await blockMd5(ID), V.NEW_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [ID])).code, V.NEW_CODE)
      assert.deepEqual(await stepRows(ID), [{ id: STEP.id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: V.NEW_MD5 }])
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5, 'bộ cũ không đổi')
      assert.equal(await blockMd5(2851), other, 'block khác không đổi')
      await expectRefused(migration, /không còn đúng bản production/)
    })

    await check('gỡ: về đúng code + md5 đã duyệt của bản production; gỡ lại bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [ID])).code, OLD_CODE)
      assert.equal((await stepRows(ID))[0].reviewed_code_md5, V.OLD_MD5)
      await expectRefused(rollback, /không phải bản V598/)
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
    await check('bộ sinh: code mới dựng được; gỡ chỗ sửa ra đúng code production; chữ NFC; code cũ = bản V472 = production', async () => {
      assert.equal(md5(OLD_CODE), LIVE.block.md5)
      assert.equal(LIVE.block.md5, LIVE.source.md5)
      assert.equal(V.OLD_CODE, OLD_CODE)
      let back = V.NEW_CODE
      for (const edit of [...V.EDITS].reverse()) back = back.replace(edit.to, () => edit.from)
      assert.equal(md5(back), LIVE.block.md5)
      assert.equal(md5(V.NEW_CODE), V.NEW_MD5)
      assert.equal(V.NEW_CODE.normalize('NFC'), V.NEW_CODE)
      new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${V.NEW_CODE}\n})`)
    })
  }
  if (ONLY !== 'sql') await chromiumChecks()
  if (ONLY !== 'chromium' && V && process.env.V598_EXPECT_NEW_ON_OLD !== '1') await sqlChecks()
  console.log(`\n${checks} kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
