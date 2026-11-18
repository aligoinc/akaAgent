// V568 (engine v2 Facebook, 18/11/2026): đăng nhóm kèm comment, comment bài khác chọn theo bài, không comment 2 lần vào cùng một bài.
//   1. Code block mới chạy được; gỡ đúng các chỗ sửa thì ra đúng code V563 (md5 production 18/11).
//   2. Chạy đúng code block trong Chromium với trang mô phỏng tường nhóm, NHIỀU LƯỢT comment trên CÙNG một trang (như vòng comment thật: bấm ô
//      thì trang mở hộp thoại bài đó; tuỳ ca hộp thoại cũ còn nằm lại, bài vừa comment hiện thêm ô "Viết bình luận..."). So code V563 (đang chạy)
//      với code V568: V563 comment 2 lần một bài ở các ca dưới, V568 thì không; ca không liên quan ra y như V563.
//   3. SQL trên PG17: preflight từ chối khi block / danh mục bước / block bộ cũ lệch; apply đổi đúng block engine + md5 đã duyệt; block khác và
//      block bộ cũ không đổi; apply lại bị từ chối; gỡ về đúng V563 rồi apply lại được.
// Chạy: node scripts/engine-v2-facebook/v568-smoke.cjs (CHROMIUM_PATH=<Chrome> nếu Playwright chưa có Chromium).
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, readMigration } = require('./fixture.cjs')
const B = require('../build-v563-sql.cjs')
const C = require('../build-v568-sql.cjs')

const PORT = Number(process.env.FB_V568_TEST_PORT || 55567)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

// ------------------------------------------------------------------------------------------------ trang mô phỏng
const ID = { own: '777000111', F: '999000333', A: '111000444', B: '222000555', C: '333000666' }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))
const OWN_URL = `https://www.facebook.com/groups/123/posts/${ID.own}/`
/** Một bài: link tác giả, link bài (/posts/<id>/), nút "Bình luận"; extraBox thêm ô "Viết bình luận..." của chính bài đó (bài có 2 ô). */
const post = (id, extraBox = false) => `<div class="post" data-post="${id}"><a href="/groups/123/user/9/">${NAME[id]}</a>
  <a href="/groups/123/posts/${id}/?__cft__[0]=x">5 phút</a>
  <div role="button" aria-label="Bình luận về bài viết của ${NAME[id]}" data-test="${NAME[id]}">Bình luận</div>
  ${extraBox ? `<div aria-label="Viết bình luận..." data-test="${NAME[id]}"></div>` : ''}</div>`
function wall({ own = 'visible', ownBoxes = 1, featured = false, twoBoxPosts = [], posts = ['A', 'B', 'C'] } = {}) {
  return `<!doctype html><html><body><div role="main">
    ${featured ? `<div aria-label="Đáng chú ý">${post(ID.F)}</div>` : ''}
    <div class="new-post">${own === 'visible' ? post(ID.own, ownBoxes > 1) : ''}</div>
    <div role="feed">${posts.map(k => post(ID[k], twoBoxPosts.includes(k))).join('')}</div>
  </div></body></html>`
}

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const ELEMENT = C.LIVE.element.xpath
  assert.equal(ELEMENT, B.LIVE.commentBlock.element.xpath, 'element fb_comment_box_at_n như lúc V563')
  /**
   * Chạy code block lần lượt với các vị trí trên cùng một trang. Bấm một ô thì trang mở hộp thoại của bài đó (ô nhập trong hộp thoại cũng
   * khớp element của Facebook). stackDialogs: hộp thoại cũ còn nằm lại; gainBox: bài vừa comment hiện thêm ô "Viết bình luận...".
   */
  const runSequence = async (code, html, vars, positions, { stackDialogs = true, gainBox = false } = {}) => {
    const pw = await browser.newPage()
    await pw.setContent(html)
    const clicks = [], outs = [], logs = []
    const evaluate = (script, args) => pw.evaluate(({ script, args }) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      return new AsyncFunction('__args', script)(args)
    }, { script, args })
    const page = {
      evaluate: (script, ...args) => evaluate(script, args),
      async waitForSelector(xpath) {
        const found = await pw.evaluate(x => !!document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue, xpath)
        if (!found) throw new Error('waitForSelector timeout: ' + xpath)
      },
      async click(xpath) {
        clicks.push(await pw.evaluate(({ x, stackDialogs, gainBox }) => {
          const el = document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
          if (!el) return '?'
          const inDialog = !!el.closest('[role="dialog"]')
          const postEl = el.closest('[data-post]')
          const id = inDialog ? el.getAttribute('data-post-id') : postEl && postEl.getAttribute('data-post')
          if (!inDialog && postEl) {
            if (!stackDialogs) for (const d of Array.from(document.querySelectorAll('[role="dialog"]'))) d.remove()
            const dialog = document.createElement('div')
            dialog.setAttribute('role', 'dialog')
            dialog.innerHTML = `<a href="/groups/123/posts/${id}/">bài</a><div role="textbox" aria-label="Viết bình luận..." data-post-id="${id}"></div>`
            document.body.appendChild(dialog)
            if (gainBox && !postEl.querySelector('div[aria-label="Viết bình luận..."]')) {
              const box = document.createElement('div')
              box.setAttribute('aria-label', 'Viết bình luận...')
              box.setAttribute('data-test', el.getAttribute('data-test') || '')
              postEl.appendChild(box)
            }
          }
          return (inDialog ? 'hộp thoại ' : '') + (el.getAttribute('data-test') || id || '?')
        }, { x: xpath, stackDialogs, gainBox }).then(v => v.replace(/^(hộp thoại )?(\d+)$/, (_, d, n) => (d || '') + (NAME[n] || n))))
      },
      async fill() {}, async type() {}, async press() {}, async dropFile() { return { fileCount: 0 } }
    }
    const helpers = {
      async elementWith(name, values) { assert.equal(name, 'fb_comment_box_at_n'); return ELEMENT.replace('${n}', String(values.n)) },
      async element(name) {
        return name === 'fb_comment_dialog_textbox' ? "(//*[@role='dialog'])[last()]//*[@role='textbox']" : "//*[@id='none']"
      },
      async prepareCampaignContent() { return { content: 'Nội dung thử', media: [], variantIndex: 0 } },
      async sleep() {}, log(message) { logs.push(String(message)) }
    }
    const sharedVars = { ...vars }
    for (const position of positions) {
      const sandbox = vm.createContext({ input: { position }, page, vars: sharedVars, helpers, signal: { aborted: false },
        console, setTimeout, clearTimeout, Promise, JSON, Math, Date, RegExp, Array, Object, String, Number, Boolean, Map, Set, Symbol, Error, URL })
      outs.push(await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox))
    }
    await pw.close()
    return { clicks, outs, logs }
  }
  const groupVars = (extra = {}) => ({ groupPostSubmitted: true, groupPostIsPending: false, commentType: 'others', groupPostPostUrl: OWN_URL, ...extra })
  const both = async (html, vars, positions, opts) => ({
    old: await runSequence(B.COMMENT.newCode, html, vars, positions, opts),
    now: await runSequence(C.NEW_CODE, html, vars, positions, opts)
  })
  try {
    await check('"Không comment vào post của mình", app coi là chờ duyệt (vị trí 1,2,3) mà bài vừa đăng vẫn hiện trên cùng: V563 A,A,B; V568 A,B,C', async () => {
      const r = await both(wall(), groupVars({ groupPostIsPending: true }), [1, 2, 3])
      assert.deepEqual(r.old.clicks, ['A', 'A', 'B'], 'V563 (đang chạy) comment 2 lần bài A')
      assert.deepEqual(r.now.clicks, ['A', 'B', 'C'])
      assert.ok(r.now.outs.every(o => o.commented === true))
    })
    await check('"Comment tất cả", app coi là chờ duyệt (1,2,3), bài vừa đăng vẫn hiện: V563 A,A,B; V568 A,B,C (không comment bài mình như khi chờ duyệt)', async () => {
      const r = await both(wall(), groupVars({ commentType: 'all', groupPostIsPending: true }), [1, 2, 3])
      assert.deepEqual(r.old.clicks, ['A', 'A', 'B'])
      assert.deepEqual(r.now.clicks, ['A', 'B', 'C'])
    })
    await check('"Comment tất cả", bài đăng ngay mà bài mình có 2 ô (1,2,3): V563 mình,A,A; V568 mình,A,B', async () => {
      const r = await both(wall({ ownBoxes: 2 }), groupVars({ commentType: 'all' }), [1, 2, 3])
      assert.deepEqual(r.old.clicks, ['own', 'A', 'A'])
      assert.deepEqual(r.now.clicks, ['own', 'A', 'B'])
    })
    await check('bài A có 2 ô cùng mã bài / bài vừa comment hiện thêm ô (2,3,4): V563 A,A,B; V568 A,B,C', async () => {
      const two = await both(wall({ twoBoxPosts: ['A'] }), groupVars(), [2, 3, 4])
      assert.deepEqual(two.old.clicks, ['A', 'A', 'B'])
      assert.deepEqual(two.now.clicks, ['A', 'B', 'C'])
      const gain = await both(wall(), groupVars(), [2, 3, 4], { gainBox: true })
      assert.deepEqual(gain.old.clicks, ['A', 'A', 'B'])
      assert.deepEqual(gain.now.clicks, ['A', 'B', 'C'])
    })
    await check('bài ghim đứng trên bài vừa đăng (2,3,4): V563 A,A,B; V568 lấy các bài dưới bài vừa đăng A,B,C', async () => {
      const r = await both(wall({ featured: true }), groupVars(), [2, 3, 4])
      assert.deepEqual(r.old.clicks, ['A', 'A', 'B'])
      assert.deepEqual(r.now.clicks, ['A', 'B', 'C'])
    })
    await check('hết bài khác: ô thứ N còn (là hộp thoại / bài đã comment) thì V568 bỏ qua lượt, không bấm; V563 comment lại bài đã comment', async () => {
      const stacked = await both(wall(), groupVars(), [2, 3, 4, 5])
      assert.deepEqual(stacked.old.clicks, ['A', 'B', 'C', 'hộp thoại A'], 'V563 bấm ô trong hộp thoại bài A (comment lại A)')
      assert.deepEqual(stacked.now.clicks, ['A', 'B', 'C'])
      const last = stacked.now.outs[3]
      assert.equal(last.commented, false)
      assert.equal(last.otherPostSkipped, true)
      assert.equal(last.commentFailed, undefined, 'không ghi dòng lỗi')
      assert.ok(!('ownPostSkipped' in last))
      assert.ok(stacked.now.logs.includes(C.NO_OTHER_POST_MESSAGE))
      const replaced = await both(wall(), groupVars(), [2, 3, 4, 5], { stackDialogs: false })
      assert.deepEqual(replaced.old.clicks, ['A', 'B', 'C', 'hộp thoại C'])
      assert.deepEqual(replaced.now.clicks, ['A', 'B', 'C'])
      assert.equal(replaced.now.outs[3].otherPostSkipped, true)
    })
    await check('hết bài khác mà ô thứ N không có trên trang: lỗi "Không comment được" như V563 / bộ cũ', async () => {
      const r = await both(wall(), groupVars(), [2, 3, 4, 5, 6], { stackDialogs: false })
      assert.deepEqual(r.now.clicks, ['A', 'B', 'C'])
      for (const side of [r.old.outs[4], r.now.outs[4]]) {
        assert.equal(side.commentFailed, true)
        assert.match(side.error, /^waitForSelector timeout: \(\/\/div\[@aria-label='Viết bình luận\.\.\.'.*\)\[6\]$/)
      }
      assert.equal(r.now.outs[4].error, r.old.outs[4].error, 'cùng câu lỗi')
    })
    await check('chưa có link bài vừa đăng: chọn bài thứ N trên trang theo bài, không bấm ô trong hộp thoại / ô thứ hai của cùng bài', async () => {
      // Bài chưa hiện (bài video): V563 bấm ô thứ 4 = ô trong hộp thoại bài C vừa mở (comment lại C); V568 hết bài thì bỏ qua lượt.
      const processing = await both(wall({ own: 'none' }), groupVars({ groupPostPostUrl: '' }), [2, 3, 4], { stackDialogs: false })
      assert.deepEqual(processing.old.clicks, ['B', 'C', 'hộp thoại C'])
      assert.deepEqual(processing.now.clicks, ['B', 'C'])
      assert.equal(processing.now.outs[2].otherPostSkipped, true)
      // "Comment tất cả" chưa có link (vị trí 1 đã bỏ) mà bài mình có 2 ô: V563 vị trí 2 = ô thứ hai của bài mình.
      const twoBox = await both(wall({ ownBoxes: 2 }), groupVars({ commentType: 'all', groupPostPostUrl: '' }), [2, 3])
      assert.deepEqual(twoBox.old.clicks, ['own', 'A'])
      assert.deepEqual(twoBox.now.clicks, ['A', 'B'])
    })
    await check('ca không đổi: không thấy bài vừa đăng / chưa có link / bài mình / bài khác bình thường / comment seeding ra y V563', async () => {
      const cases = [
        [wall({ own: 'none' }), groupVars({ groupPostIsPending: true }), [1, 2, 3], ['A', 'B', 'C'], 'link có mà bài không hiện: ô thứ N'],
        [wall(), groupVars({ groupPostPostUrl: '' }), [2, 3, 4], ['A', 'B', 'C'], 'chưa lấy được link: ô thứ N'],
        [wall(), groupVars(), [2, 3, 4], ['A', 'B', 'C'], 'bài khác, đăng ngay, bài mình trên cùng'],
        [wall({ featured: true }), groupVars({ commentType: 'own' }), [1], ['own'], 'bài của mình (có bài ghim trước)'],
        [wall(), { commentType: 'own' }, [1, 3], ['own', 'B'], 'comment seeding: ô thứ N']
      ]
      for (const [html, vars, positions, want, why] of cases) {
        const r = await both(html, vars, positions)
        assert.deepEqual(r.old.clicks, want, `V563: ${why}`)
        assert.deepEqual(r.now.clicks, want, `V568: ${why}`)
      }
      const skipOwn = await both(wall(), groupVars({ commentType: 'own', groupPostPostUrl: '' }), [1])
      assert.deepEqual(skipOwn.now.clicks, [])
      // Mỗi lượt chạy trong một vm riêng (khác Object.prototype) nên so qua JSON.
      assert.deepEqual(JSON.parse(JSON.stringify(skipOwn.now.outs)), JSON.parse(JSON.stringify(skipOwn.old.outs)), 'bỏ qua bài của mình khi chưa có link: y V563')
    })
  } finally {
    await browser.close()
  }
}

async function main() {
  await check('code block V568 chạy được; gỡ các chỗ sửa ra đúng code V563 (md5 production 18/11); script trong trang không có ${', async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', C.NEW_CODE)
    let back = C.NEW_CODE
    for (const edit of [...C.EDITS].reverse()) back = back.replace(edit.to, () => edit.from)
    assert.equal(md5(back), C.LIVE.block.md5)
    assert.equal(md5(B.COMMENT.newCode), C.OLD_MD5)
    assert.equal(md5(C.NEW_CODE), C.NEW_MD5)
    assert.notEqual(C.NEW_MD5, C.OLD_MD5)
  })

  await chromiumChecks()

  // ---------------------------------------------------------------------------------------------- SQL trên PG17
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v568-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const q = async (sql, args = []) => (await db.query(sql, args)).rows
  const one = async (sql, args = []) => (await q(sql, args))[0]
  const v568 = readMigration(`${C.NAME}.sql`)
  const rollback = readMigration('rollback_v568_engine_facebook_comment_other_posts.sql')
  const expectRefused = async (sql, pattern) => {
    let error = null
    try { await db.query(sql) } catch (e) { error = e }
    await db.query('ROLLBACK').catch(() => {})
    assert.ok(error, 'phải bị từ chối')
    assert.match(error.message, pattern)
  }
  const blockMd5 = async id => (await one(`SELECT md5(code) AS m FROM public.auto_blocks WHERE id = $1`, [id])).m
  const stepRows = async id => q(`SELECT id::int, commit_level, send_ops, reviewed_code_md5 FROM public.auto_engine_block_steps WHERE block_id = $1`, [id])
  const COMMENT_ID = C.LIVE.block.id
  const SOURCE_ID = C.LIVE.source.id
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    await applyV563(db)
    const others = { [B.LIVE.block.id]: await blockMd5(B.LIVE.block.id), [B.LIVE.adjustBlock.id]: await blockMd5(B.LIVE.adjustBlock.id),
      [B.LIVE.adjustBlock.sourceId]: await blockMd5(B.LIVE.adjustBlock.sourceId), [B.LIVE.block.sourceId]: await blockMd5(B.LIVE.block.sourceId) }

    await check('DB thử sau V563 có đúng block comment production (md5 06889369…) và danh mục bước', async () => {
      assert.equal(await blockMd5(COMMENT_ID), C.OLD_MD5)
      assert.equal(await blockMd5(SOURCE_ID), C.LIVE.source.md5)
      assert.deepEqual(await stepRows(COMMENT_ID), [{ id: C.LIVE.steps[0].id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: C.OLD_MD5 }])
    })

    await check('preflight: block / danh mục bước / block bộ cũ lệch thì từ chối, không đổi gì', async () => {
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [COMMENT_ID])
      await expectRefused(v568, /không còn đúng bản V563/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [C.OLD_CODE, COMMENT_ID])
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 1 WHERE block_id = $1`, [COMMENT_ID])
      await expectRefused(v568, /danh mục bước .* khác bản đã đọc/)
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 2 WHERE block_id = $1`, [COMMENT_ID])
      const source = (await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [SOURCE_ID])).code
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [SOURCE_ID])
      await expectRefused(v568, /block bộ cũ 34 khác bản đã đọc/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [source, SOURCE_ID])
      assert.equal(await blockMd5(COMMENT_ID), C.OLD_MD5)
      assert.equal(await blockMd5(SOURCE_ID), C.LIVE.source.md5)
      assert.equal((await stepRows(COMMENT_ID))[0].reviewed_code_md5, C.OLD_MD5)
    })

    await check('apply: block comment engine = bản V568, danh mục bước ghi md5 mới; block bộ cũ và block khác không đổi; apply lại bị từ chối', async () => {
      await db.query(v568)
      assert.equal(await blockMd5(COMMENT_ID), C.NEW_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [COMMENT_ID])).code, C.NEW_CODE)
      assert.deepEqual(await stepRows(COMMENT_ID), [{ id: C.LIVE.steps[0].id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: C.NEW_MD5 }])
      assert.equal(await blockMd5(SOURCE_ID), C.LIVE.source.md5, 'bộ cũ không đổi')
      for (const [id, m] of Object.entries(others)) assert.equal(await blockMd5(Number(id)), m, `block ${id} không đổi`)
      await expectRefused(v568, /không còn đúng bản V563/)
    })

    await check('gỡ: về đúng code + md5 đã duyệt của V563; gỡ lại bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal(await blockMd5(COMMENT_ID), C.OLD_MD5)
      assert.equal((await stepRows(COMMENT_ID))[0].reviewed_code_md5, C.OLD_MD5)
      await expectRefused(rollback, /không phải bản V568/)
      await db.query(v568)
      assert.equal(await blockMd5(COMMENT_ID), C.NEW_MD5)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
