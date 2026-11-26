// V658 (engine v2 Facebook, 26/11/2026, câu 639 / 3300 / 6279 của bộ kiểm lỗi): comment seeding mở nhóm mà Facebook chuyển sang trang xác minh
// (/checkpoint/…) hoặc trang đăng nhập (/login).
//   1. Bộ sinh: code block mới dựng được thành hàm async, gỡ đúng chỗ sửa thì ra đúng code production (bản V641, md5 81f1dd79…, đọc 26/11), chữ NFC,
//      phần thêm chỉ là đoạn chèn trước khi đọc element.
//   2. Chạy đúng code block 2859 (bản production V641 và bản V658) trong Chromium trên các trang giả: trang xác minh mở từ link nhóm (vết thật
//      21–25/11: currentUrl /checkpoint/…?next=<nhóm>, vùng chính vẫn có), các đường dẫn xác minh khác, trang đăng nhập, cùng các trang nhóm hôm nay
//      đã chạy đúng (có bài, không bài, chữ checkpoint chỉ nằm ở query). Bản production quét 0 bài, không trả mã (tái hiện: bộ lập lịch đóng bằng
//      FB45); bản V658 trả err_fb_checkpoint (FB04) / err_engine_fb_logged_out (FB43) chưa gửi, 0 bài, không đọc element; mọi trang khác ra y hệt.
//   3. SQL trên PG17: DB nhận thẳng hai mã block trả (direct), chính sách chung là về hàng đợi + đổi trạng thái đăng nhập; preflight từ chối khi
//      block / danh mục bước / bộ cũ / mã / sổ lệch; apply đổi đúng block 2859; bộ cũ 2554 không đổi; apply lại bị từ chối; gỡ về đúng bản production.
// Chạy: CHAT_REPO=<akaAgentChatApi> LC_ALL=C CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/v658-smoke.cjs
//   V658_ONLY=chromium | sql: chỉ chạy một phần. V658_EXPECT_NEW_ON_OLD=1: chạy kỳ vọng của bản V658 trên code production (phải hỏng).
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPageAdapter, BASE, GROUP } = require('./fb-group-fake.cjs')

const ROOT = path.resolve(__dirname, '../..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v658-live-20261126.json'), 'utf8'))
const V641 = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-v641.json'), 'utf8'))
const OLD_CODE = V641.blocks.find(block => block.id === 2859).code
const SOURCE_CODE = V641.blocks.find(block => block.id === 2554).code
const V = fs.existsSync(path.join(ROOT, 'scripts/build-v658-sql.cjs')) ? require('../build-v658-sql.cjs') : null
const PORT = Number(process.env.FB_V658_TEST_PORT || 55658)
const ONLY = process.env.V658_ONLY || ''
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

// ------------------------------------------------------------------------------------------------ trang giả (chữ giả, cấu trúc như trang thật)
const GROUP_URL = `${BASE}/groups/${GROUP}/`
const next = encodeURIComponent(GROUP_URL)
const NAV = '<div role="navigation"><span>Số thông báo chưa đọc</span><span>Menu trên Facebook</span></div>'
const html = (main, title = 'Nhóm thử | Facebook') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${NAV}`
  + `<div role="main">${main}</div></body></html>`
const post = i => `<div class="x1n2onr6 x1ja2u2z" style="min-height:120px"><div dir="auto"><div data-ad-preview="message">Nội dung bài thử ${i}</div></div>`
  + `<a href="${BASE}/groups/${GROUP}/posts/${1000 + i}/">Bài ${i}</a></div>`
const CHECKPOINT_BODY = html('<h2 role="heading">Chúng tôi cần xác nhận đây là bạn</h2><div role="button">Bắt đầu</div>', 'Facebook')
const LOGIN_BODY = html('<h2 role="heading">Đăng nhập Facebook</h2><input name="email"><input name="pass" type="password">', 'Facebook')

const NO_POSTS = { scanned: 0, matched: 0, actionResult: null }
const FB04 = { scanned: 0, matched: 0, stopReason: 'checkpoint', actionResult: ['campaign_detail_error', 'err_fb_checkpoint', 'checkpoint', 'not_committed'] }
const FB43 = { scanned: 0, matched: 0, stopReason: 'logged_out', actionResult: ['campaign_detail_error', 'err_engine_fb_logged_out', 'logged_out', 'not_committed'] }
const PAGES = [
  { key: 'checkpoint_from_group', why: 'mở nhóm bị chuyển sang trang xác minh (câu 639 / 3300 / 6279: vết thật 21–25/11)',
    url: `${BASE}/checkpoint/1501092823525282/?next=${next}`, body: CHECKPOINT_BODY, old: NO_POSTS, new: FB04 },
  { key: 'checkpoint_bare', why: 'trang /checkpoint/ không có next', url: `${BASE}/checkpoint/`, body: CHECKPOINT_BODY, old: NO_POSTS, new: FB04 },
  { key: 'two_step', why: 'trang xác minh hai bước (/two_step_verification/…)', url: `${BASE}/two_step_verification/two_factor/?next=${next}`,
    body: CHECKPOINT_BODY, old: NO_POSTS, new: FB04 },
  { key: 'mobile_checkpoint', why: 'trang xác minh ở tên miền con (m.facebook.com/checkpoint/…)', url: 'https://m.facebook.com/checkpoint/828281030927956/',
    body: CHECKPOINT_BODY, old: NO_POSTS, new: FB04 },
  { key: 'login', why: 'mở nhóm bị chuyển sang trang đăng nhập (/login/)', url: `${BASE}/login/?next=${next}`, body: LOGIN_BODY, old: NO_POSTS, new: FB43 },
  { key: 'login_php', why: 'trang đăng nhập kiểu /login.php', url: `${BASE}/login.php?next=${next}`, body: LOGIN_BODY, old: NO_POSTS, new: FB43 },
  { key: 'group_with_posts', why: 'trang nhóm có 3 bài: chọn bài như hôm nay', url: GROUP_URL,
    body: html(`<div role="feed">${[1, 2, 3].map(post).join('')}</div>`), old: 'same', new: 'same' },
  { key: 'group_empty', why: 'trang nhóm không có bài: 0 bài như hôm nay (FB45 đúng thiết kế)', url: GROUP_URL,
    body: html('<div role="feed"></div><span>Chưa có bài viết nào</span>'), old: 'same', new: 'same' },
  { key: 'group_query_checkpoint', why: 'trang nhóm có chữ checkpoint / login chỉ ở query: như hôm nay', url: `${GROUP_URL}?ref=checkpoint&from=/login/`,
    body: html(`<div role="feed">${post(1)}</div>`), old: 'same', new: 'same' },
  { key: 'groups_path_login_word', why: 'đường dẫn nhóm có chữ login trong tên (/groups/loginhelp/): như hôm nay', url: `${BASE}/groups/loginhelp/`,
    body: html(`<div role="feed">${post(1)}</div>`), old: 'same', new: 'same' }
]

async function runBlock(browser, code, pageCase) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route('https://**/*', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageCase.body }))
  const pw = await context.newPage()
  await pw.goto(pageCase.url)
  const ops = []
  const page = createPageAdapter(pw, ops)
  const logs = []
  const elementCalls = []
  const events = []
  const helpers = {
    async element(name) { elementCalls.push(name); if (!LIVE.elements[name]) throw new Error(`thiếu element ${name}`); return LIVE.elements[name] },
    async sleep(ms) { await new Promise(r => setTimeout(r, Math.min(ms, 20))) },
    async logRunEvent(event) { events.push(event.eventType) },
    log(message) { logs.push(String(message)) }
  }
  const vars = { inputDataId: 77, postsPerTarget: 2, commentVariants: ['Bình luận A', 'Bình luận B'], commentImageBatches: [] }
  const sandbox = vm.createContext({ input: {}, page, vars, helpers, signal: { aborted: false }, console, setTimeout, clearTimeout })
  let out
  try {
    out = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox)
  } catch (error) {
    out = { thrown: String(error && error.message || error) }
  }
  await context.close()
  return { out, ops, logs, elementCalls, events }
}
const summary = out => ({
  scanned: out.scannedCount, matched: out.matchedCount, ...(out.actionResult ? { stopReason: out.stopReason } : {}),
  actionResult: out.actionResult ? [out.actionResult.statusCode, out.actionResult.errorCode, out.actionResult.data && out.actionResult.data.reason,
    out.actionResult.operationState] : null
})

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  try {
    const runs = [['production', OLD_CODE, process.env.V658_EXPECT_NEW_ON_OLD === '1' ? 'new' : 'old']]
    if (V && process.env.V658_EXPECT_NEW_ON_OLD !== '1') runs.push(['V658', V.NEW_CODE, 'new'])
    const results = {}
    for (const [label, code, expectKey] of runs) {
      for (const pageCase of PAGES) {
        await check(`${label} · ${pageCase.key}: ${pageCase.why}`, async () => {
          const res = await runBlock(browser, code, pageCase)
          results[`${label}:${pageCase.key}`] = res
          assert.ok(!res.out.thrown, `block ném lỗi: ${res.out.thrown}`)
          assert.ok(Array.isArray(res.out.commentIterations), 'luôn có danh sách bài (vòng comment đọc input.commentIterations)')
          const want = pageCase[expectKey]
          if (want === 'same') {
            assert.equal(res.out.actionResult, undefined, 'trang nhóm: không trả mã')
            return
          }
          assert.deepEqual(summary(res.out), want)
          // Mảng tạo trong sandbox vm khác realm: so qua JSON.
          assert.deepEqual(JSON.parse(JSON.stringify(res.out.commentIterations)), [], 'không có bài để comment')
          if (want.actionResult) {
            assert.deepEqual(res.elementCalls, [], 'đã biết trang xác minh / đăng nhập thì không đọc element, không quét')
            assert.deepEqual(res.events, [], 'không ghi sự kiện tìm bài')
            assert.equal(res.out.actionResult.inputDataId, 77)
            assert.equal(res.out.actionResult.actionCode, 'fb_comment')
            assert.equal(res.out.actionResult.data.url, pageCase.url)
            assert.ok(!('error' in res.out.actionResult.data), 'data không có khoá error (runtime lấy làm lý do dừng)')
            assert.deepEqual(res.logs, [`⚠️ ${res.out.actionResult.message}`])
          }
        })
      }
    }
    if (runs.length === 2) {
      await check('V658 · trang nhóm (không phải trang xác minh / đăng nhập): đầu ra, câu tiến trình, element đọc, sự kiện y hệt bản production', async () => {
        for (const pageCase of PAGES.filter(p => p.new === 'same')) {
          const a = results[`production:${pageCase.key}`], b = results[`V658:${pageCase.key}`]
          assert.deepEqual(JSON.parse(JSON.stringify(b.out)), JSON.parse(JSON.stringify(a.out)), pageCase.key)
          assert.deepEqual(b.logs, a.logs, pageCase.key)
          assert.deepEqual(b.elementCalls, a.elementCalls, pageCase.key)
          assert.deepEqual(b.events, a.events, pageCase.key)
        }
        assert.equal(results['V658:group_with_posts'].out.matchedCount, 2, 'trang có bài: chọn đủ 2 bài như hôm nay')
      })
      await check('production · trang xác minh: tái hiện quét 0 bài, không trả mã (bộ lập lịch đóng data bằng FB45)', async () => {
        for (const key of ['checkpoint_from_group', 'login']) {
          const a = results[`production:${key}`].out
          assert.equal(a.scannedCount, 0); assert.equal(a.actionResult, undefined); assert.equal(a.stopReason, 'no_new_posts')
        }
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
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v658-', timeoutMs: 600_000 })
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
  const ID = LIVE.block.id
  const SOURCE = LIVE.source.id
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    // V559: mã / luật / chính sách Facebook như production (FB43, chính sách FB04 / FB43 / FB45 của Q6 có từ V559).
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    await db.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text)`)
    // Cặp block như production (V560 chép 2554 → 2859, V641 sửa cả hai), thêm một block khác để kiểm không bị đụng.
    await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, $2, $3, 'facebook'), ($4, $5, $6, 'facebook'),
      (2851, '[engine] fb_comment_at_position', 'return 1', 'facebook')`, [SOURCE, LIVE.source.name, SOURCE_CODE, ID, LIVE.block.name, OLD_CODE])
    await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy)
      VALUES ($1, $2, $3, $4)`, [ID, SOURCE, LIVE.copy.sourceMd5AtCopy, LIVE.copy.engineMd5AtCopy])
    const other = await blockMd5(2851)

    await check('DB thử có đúng cặp block production (2859 = V641 81f1dd79…, 2554 = V641 091f5748…), không có dòng danh mục bước', async () => {
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_engine_block_steps WHERE block_id = $1`, [ID])).n, 0)
    })

    await check('DB nhận thẳng mã block trả (direct): err_fb_checkpoint → FB04, err_engine_fb_logged_out → FB43; chính sách về hàng đợi', async () => {
      for (const code of [V.CHECKPOINT_CODE, V.LOGGED_OUT_CODE]) {
        const row = await one(`SELECT c.error_code, c.matched_by, e.public_code FROM public.aka_agent_engine_classify_signal('facebook', 'fb_comment',
          'before_send', $1::jsonb) c JOIN public.auto_error e ON e.error_code = c.error_code`, [JSON.stringify({ kind: 'block', code, errorCode: code })])
        assert.equal(row.error_code, code); assert.equal(row.matched_by, 'direct')
        assert.equal(row.public_code, { [V.CHECKPOINT_CODE]: 'FB04', [V.LOGGED_OUT_CODE]: 'FB43' }[code])
      }
      const policies = await q(`SELECT error_code, target_effect, login_effect, target_streak_effect FROM public.auto_outcome_policies
        WHERE error_code = ANY($1) AND is_active AND action_code IS NULL AND campaign_action_id IS NULL ORDER BY error_code`,
      [[V.CHECKPOINT_CODE, V.LOGGED_OUT_CODE, 'err_engine_fb_no_history']])
      assert.deepEqual(policies.map(p => [p.error_code, p.target_effect, p.login_effect, p.target_streak_effect]), [
        [V.LOGGED_OUT_CODE, 'requeue', 'logged_out', 'ignore'], ['err_engine_fb_no_history', 'complete', 'none', 'ignore'],
        [V.CHECKPOINT_CODE, 'requeue', 'checkpoint', 'ignore']])
    })

    await check('preflight: block / danh mục bước / bộ cũ / mã / sổ lệch thì từ chối, không đổi gì', async () => {
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [ID])
      await expectRefused(migration, /không còn đúng bản production/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [OLD_CODE, ID])
      await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops)
        VALUES (9658, $1, 'result', NULL, 1, '[]'::jsonb)`, [ID])
      await expectRefused(migration, /đã có 1 dòng danh mục bước/)
      await db.query(`DELETE FROM public.auto_engine_block_steps WHERE id = 9658`)
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [SOURCE])
      await expectRefused(migration, /block bộ cũ 2554 khác bản đã đọc/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [SOURCE_CODE, SOURCE])
      await db.query(`UPDATE public.auto_error SET is_active = false WHERE error_code = $1`, [V.CHECKPOINT_CODE])
      await expectRefused(migration, /chưa có hoặc đang tắt trong auto_error/)
      await db.query(`UPDATE public.auto_error SET is_active = true WHERE error_code = $1`, [V.CHECKPOINT_CODE])
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('29990101000000', 'migration_v658_thu')`)
      await expectRefused(migration, /V658 đã có trong sổ migration/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '29990101000000'`)
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5)
    })

    await check('apply: block 2859 = bản V658; bộ cũ, sổ chép block và block khác không đổi; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await blockMd5(ID), V.NEW_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [ID])).code, V.NEW_CODE)
      assert.equal(await blockMd5(SOURCE), LIVE.source.md5, 'bộ cũ không đổi')
      assert.equal(await blockMd5(2851), other, 'block khác không đổi')
      assert.deepEqual(await one(`SELECT source_md5_at_copy, engine_md5_at_copy FROM public.auto_engine_block_copies WHERE engine_block_id = $1`, [ID]),
        { source_md5_at_copy: LIVE.copy.sourceMd5AtCopy, engine_md5_at_copy: LIVE.copy.engineMd5AtCopy })
      await expectRefused(migration, /không còn đúng bản production/)
    })

    await check('gỡ: về đúng code bản production (V641); gỡ lại bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal(await blockMd5(ID), V.OLD_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [ID])).code, OLD_CODE)
      await expectRefused(rollback, /không phải bản V658/)
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
    await check('bộ sinh: code mới dựng được; gỡ chỗ sửa ra đúng code production (V641); chữ NFC; chỉ thêm đoạn chèn, không đổi dòng nào cũ', async () => {
      assert.equal(md5(OLD_CODE), LIVE.block.md5)
      assert.equal(V.OLD_CODE, OLD_CODE)
      let back = V.NEW_CODE
      for (const edit of [...V.EDITS].reverse()) back = back.replace(edit.to, () => edit.from)
      assert.equal(md5(back), LIVE.block.md5)
      assert.equal(md5(V.NEW_CODE), V.NEW_MD5)
      assert.equal(V.NEW_CODE.normalize('NFC'), V.NEW_CODE)
      new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${V.NEW_CODE}\n})`)
      const oldLines = OLD_CODE.split('\n'), newLines = V.NEW_CODE.split('\n')
      assert.deepEqual(oldLines.filter(line => !newLines.includes(line)), [], 'không dòng cũ nào bị đổi / bỏ')
      const at = V.NEW_CODE.indexOf('const __seedingPageUrl')
      assert.ok(at > 0 && at < V.NEW_CODE.indexOf("await helpers.element('fb_post_in_uid')"), 'đoạn chèn đứng trước lần đọc element đầu tiên')
      assert.ok(at < V.NEW_CODE.indexOf('window.scrollTo'), 'đoạn chèn đứng trước lần cuộn trang đầu tiên')
    })
  }
  if (ONLY !== 'sql') await chromiumChecks()
  if (ONLY !== 'chromium' && V && process.env.V658_EXPECT_NEW_ON_OLD !== '1') await sqlChecks()
  console.log(`\n${checks} kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
