// V572 (engine v2 Facebook, 18/11/2026): đăng nhóm kèm comment, chọn bài để comment theo mã bài của hộp thoại vừa mở.
//   1. Code block mới chạy được; gỡ đúng các chỗ sửa thì ra đúng code V563 (md5 production 18/11).
//   2. Chạy đúng code block (V563 đang chạy và V572) trong Chromium trên trang nhóm giả làm theo hành vi đo trên Facebook thật 18/11
//      (fb-group-fake.cjs): link bài trong feed chưa nạp, bấm ô thì link đổi ngay sang /permalink/<mã bài>/, hộp thoại đổi bài sau một lúc (ô nhập
//      giữ nguyên khi cùng người đăng), trang nền khoá cuộn khi hộp thoại mở, feed nạp dần, bấm khi trang vừa tải thì chuyển hẳn sang trang riêng
//      của bài (phía sau có bài ngoài nhóm). Trang giả ghi lại comment thật rơi vào bài nào. Nhiều lượt comment trên cùng một trang như vòng
//      comment thật. V572: không comment 2 lần một bài, không comment bài vừa đăng khi chọn "Không comment vào post của mình", không comment bài
//      ngoài nhóm, mã bài block ghi lại đúng bài trang ghi nhận; comment seeding giữ y V563.
//   3. SQL trên PG17: preflight từ chối khi block / danh mục bước / block bộ cũ lệch; apply đổi đúng block engine + md5 đã duyệt; block khác và
//      block bộ cũ không đổi; apply lại bị từ chối; gỡ về đúng V563 rồi apply lại được.
// Chạy: CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/v572-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, readMigration } = require('./fixture.cjs')
const { openFakeGroup, createPageAdapter, BASE, GROUP } = require('./fb-group-fake.cjs')
const B = require('../build-v563-sql.cjs')
const V = require('../build-v572-sql.cjs')

const PORT = Number(process.env.FB_V572_TEST_PORT || 55570)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

// ------------------------------------------------------------------------------------------------ bài trên trang giả
const OWN = { id: '777000111', author: 'Tài khoản thử' }
const P = {
  P1: { id: '111000444', author: 'Lee Danh', comments: 2 },
  P2: { id: '222000555', author: 'Lee Danh' },
  P3: { id: '333000666', author: 'Flyby', comments: 1 },
  P4: { id: '444000777', author: 'Lee Danh' },
  P5: { id: '555000888', author: 'Lee Danh' },
  P6: { id: '666000999', author: 'Flyby' }
}
const FEATURED = { id: '999000333', author: 'Quản trị viên' }
const FOREIGN_ID = '888000999'
const NAME = Object.fromEntries([...Object.entries(P).map(([k, p]) => [p.id, k]), [OWN.id, 'own'], [FEATURED.id, 'F'], [FOREIGN_ID, 'ngoài nhóm']])
const OWN_URL = `${BASE}/groups/${GROUP}/posts/${OWN.id}/`
const feed = keys => keys.map(k => P[k])

/** Chạy code block lần lượt các vị trí trên cùng một trang nhóm giả (vars dùng chung như một lượt data). */
async function runLoop(browser, code, cfg, vars, positions) {
  const { pw, comments, close } = await openFakeGroup(browser, cfg)
  const ops = []
  const page = createPageAdapter(pw, ops)
  const logs = []
  let seq = 0
  const helpers = {
    async elementWith(name, values) { return V.LIVE.elements[name].replace(/\$\{(\w+)\}/g, (_, k) => String(values[k] ?? '')) },
    async element(name) { return V.LIVE.elements[name] },
    async prepareCampaignContent() { seq++; return { content: `Nội dung thử ${seq}`, media: [], variantIndex: 0 } },
    // Đồng hồ ảo: nghỉ của block cộng vào performance.now() của trang (trang tính "đã mở bao lâu" theo đồng hồ này).
    async sleep(ms) {
      try { await pw.evaluate(add => { window.__akaClock = (window.__akaClock || 0) + add }, ms) } catch {}
      await new Promise(r => setTimeout(r, Math.min(ms, 20)))
    },
    log(message) { logs.push(String(message)) }
  }
  const shared = { ...vars }
  const outs = []
  for (const position of positions) {
    shared.loopItem = { position }
    const sandbox = vm.createContext({ input: {}, page, vars: shared, helpers, signal: { aborted: false }, console, setTimeout, clearTimeout })
    try {
      outs.push(await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox))
    } catch (error) {
      outs.push({ thrown: String(error && error.message || error) })
    }
  }
  await close()
  return { outs, comments: comments.map(c => ({ ...c, name: NAME[c.postId] || c.postId })), logs, ops, vars: shared }
}
const groupVars = (extra = {}) => ({ groupPostSubmitted: true, groupPostIsPending: false, commentType: 'others', groupPostPostUrl: OWN_URL, ...extra })
const names = r => r.comments.map(c => c.name)
const dupes = r => names(r).filter((n, i, a) => a.indexOf(n) !== i)
/** Mã bài block ghi trong kết quả bước = bài trang ghi nhận comment (theo thứ tự). */
function assertIdsMatch(r) {
  const claimed = r.outs.filter(o => o && o.commented === true).map(o => o.commentPostId)
  assert.deepEqual(claimed, r.comments.map(c => c.postId), 'mã bài block ghi lại khác bài thật sự nhận comment')
}

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const both = async (cfg, vars, positions) => ({
    old: await runLoop(browser, B.COMMENT.newCode, cfg, vars, positions),
    now: await runLoop(browser, V.NEW_CODE, cfg, vars, positions)
  })
  const show = r => `V563 [${names(r.old).join(', ')}] / V572 [${names(r.now).join(', ')}]`
  try {
    await check('"Không comment vào post của mình" tối đa 3, bài vừa đăng trên cùng: V572 comment P1, P2, P3, không comment bài mình, không trùng', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2', 'P3', 'P4', 'P5']) }, groupVars(), [2, 3, 4])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1', 'P2', 'P3'])
      assertIdsMatch(r.now)
    })
    await check('"Comment tất cả" tối đa 3, không chờ duyệt: V572 comment bài mình rồi P1, P2', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2', 'P3', 'P4']) }, groupVars({ commentType: 'all' }), [1, 2, 3])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['own', 'P1', 'P2'])
      assertIdsMatch(r.now)
    })
    await check('app coi là chờ duyệt (vị trí 1,2,3) mà bài vừa đăng vẫn hiện, có link: V572 comment P1, P2, P3, không comment bài mình', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2', 'P3', 'P4']) }, groupVars({ groupPostIsPending: true }), [1, 2, 3])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1', 'P2', 'P3'])
      assertIdsMatch(r.now)
    })
    await check('chưa lấy được link bài vừa đăng, bài không chờ duyệt: V572 coi bài đầu tiên là bài mình (không comment), comment P1, P2, P3', async () => {
      const r = await both({ own: OWN, ownLinkLoaded: false, posts: feed(['P1', 'P2', 'P3', 'P4']) }, groupVars({ groupPostPostUrl: '' }), [2, 3, 4])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1', 'P2', 'P3'])
      assert.equal(r.now.vars.__akaCommentOwnPostId, OWN.id)
      assertIdsMatch(r.now)
    })
    await check('bỏ qua đăng vì nhóm đã biết cần duyệt (không có bài mình): V572 comment P1, P2', async () => {
      const r = await both({ own: null, posts: feed(['P1', 'P2', 'P3']) },
        { groupPostSubmitted: false, groupPostSkippedByKnownApproval: true, groupPostIsPending: true, commentType: 'others' }, [1, 2])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1', 'P2'])
      assertIdsMatch(r.now)
    })
    await check('nhiều comment hơn số bài, phải đóng hộp thoại cuộn cho feed nạp thêm: V572 comment đủ 5 bài khác nhau', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']), initialMounted: 2, maxMounted: 3 }, groupVars(), [2, 3, 4, 5, 6])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1', 'P2', 'P3', 'P4', 'P5'])
      assert.ok(r.now.ops.some(o => o.op === 'press' && o.label === 'Escape'), 'đã đóng hộp thoại để cuộn')
      assertIdsMatch(r.now)
    })
    await check('hết bài để comment: V572 comment 2 bài có trên trang rồi bỏ qua lượt (không comment lại, không dòng lịch sử)', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2']) }, groupVars(), [2, 3, 4, 5])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1', 'P2'])
      assert.deepEqual(r.now.outs.slice(2).map(o => [o.commented, o.otherPostSkipped]), [[false, true], [false, true]])
      assertIdsMatch(r.now)
    })
    await check('trang nhóm vừa tải (bấm sớm thì Facebook chuyển hẳn sang trang riêng của bài, phía sau có bài ngoài nhóm), "Comment tất cả" 3: V572 comment bài mình, P1, P2, không comment bài ngoài nhóm, không trùng', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2', 'P3']), readyMs: 5000 }, groupVars({ commentType: 'all' }), [1, 2, 3])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['own', 'P1', 'P2'])
      assert.ok(r.now.ops.some(o => o.op === 'navigate'), 'đã quay về trang nhóm')
      assert.ok(!names(r.old).length || dupes(r.old).length || names(r.old).includes('ngoài nhóm') || r.old.outs.some(o => o.commentFailed),
        'V563 ở ca này comment trùng / ngoài nhóm / lỗi')
      assertIdsMatch(r.now)
    })
    await check('mã bài đọc từ link trong khung gán nhầm (chỉ một mã đọc được trên trang, bài nổi bật nằm trên): V572 không comment nhầm bài khác thay cho bài mình', async () => {
      const r = await both({ own: OWN, featured: [FEATURED], posts: feed(['P2', 'P4']) }, groupVars({ commentType: 'own' }), [1])
      console.log('   ', show(r))
      assert.deepEqual(names(r.old), ['F'], 'V563 comment nhầm bài nổi bật')
      assert.deepEqual(names(r.now), [])
      assert.equal(r.now.outs[0].ownPostSkipped, true)
    })
    await check('hộp thoại không đổi sang bài vừa chọn (bài lỗi tải): V572 bỏ qua lượt, không comment lại bài trước; V563 comment trùng', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2', 'P3']), neverLoads: [P.P2.id] }, groupVars(), [2, 3])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1'])
      assert.equal(r.now.outs[1].otherPostSkipped, true)
      assert.deepEqual(dupes(r.old), ['P1'], 'V563 comment 2 lần P1')
      assertIdsMatch(r.now)
    })
    await check('hai bài liền nhau cùng người đăng (ô nhập giữ nguyên khi đổi bài): V572 chờ hộp thoại đổi bài rồi mới gõ, comment đúng P1, P2', async () => {
      const r = await both({ own: OWN, posts: feed(['P1', 'P2', 'P4']), swapDelayMs: 400 }, groupVars(), [2, 3, 4])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), ['P1', 'P2', 'P4'])
      assertIdsMatch(r.now)
    })
    await check('comment seeding / workflow khác (không phải vòng comment đăng nhóm): V572 chạy y V563', async () => {
      const r = await both({ own: null, posts: feed(['P1', 'P2', 'P3']) }, { commentType: 'others' }, [1, 2])
      console.log('   ', show(r))
      assert.deepEqual(names(r.now), names(r.old))
      assert.deepEqual(r.now.ops.filter(o => o.op === 'click').map(o => o.label), r.old.ops.filter(o => o.op === 'click').map(o => o.label))
    })
  } finally {
    await browser.close()
  }
}

async function main() {
  await check('code block V572 chạy được; gỡ các chỗ sửa ra đúng code V563 (md5 production 18/11); script trong trang không có ${', async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', V.NEW_CODE)
    let back = V.NEW_CODE
    for (const edit of [...V.EDITS].reverse()) back = back.replace(edit.to, () => edit.from)
    assert.equal(md5(back), V.LIVE.block.md5)
    assert.equal(md5(B.COMMENT.newCode), V.OLD_MD5)
    assert.equal(md5(V.NEW_CODE), V.NEW_MD5)
    for (const match of V.NEW_CODE.matchAll(/String\.raw`([\s\S]*?)`/g)) assert.ok(!match[1].includes('${'))
  })

  await chromiumChecks()

  // ---------------------------------------------------------------------------------------------- SQL trên PG17
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v572-', timeoutMs: 600_000 })
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
  const COMMENT_ID = V.LIVE.block.id
  const SOURCE_ID = V.LIVE.source.id
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    await applyV563(db)
    const others = { [B.LIVE.block.id]: await blockMd5(B.LIVE.block.id), [B.LIVE.adjustBlock.id]: await blockMd5(B.LIVE.adjustBlock.id),
      [B.LIVE.adjustBlock.sourceId]: await blockMd5(B.LIVE.adjustBlock.sourceId), [B.LIVE.block.sourceId]: await blockMd5(B.LIVE.block.sourceId) }

    await check('DB thử sau V563 có đúng block comment production (md5 06889369…) và danh mục bước', async () => {
      assert.equal(await blockMd5(COMMENT_ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE_ID), V.LIVE.source.md5)
      assert.deepEqual(await stepRows(COMMENT_ID), [{ id: V.LIVE.steps[0].id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: V.OLD_MD5 }])
    })

    await check('preflight: block / danh mục bước / block bộ cũ lệch thì từ chối, không đổi gì', async () => {
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [COMMENT_ID])
      await expectRefused(migration, /không còn đúng bản V563/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [V.OLD_CODE, COMMENT_ID])
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 1 WHERE block_id = $1`, [COMMENT_ID])
      await expectRefused(migration, /danh mục bước .* khác bản đã đọc/)
      await db.query(`UPDATE public.auto_engine_block_steps SET commit_level = 2 WHERE block_id = $1`, [COMMENT_ID])
      const source = (await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [SOURCE_ID])).code
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [SOURCE_ID])
      await expectRefused(migration, /block bộ cũ 34 khác bản đã đọc/)
      await db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [source, SOURCE_ID])
      assert.equal(await blockMd5(COMMENT_ID), V.OLD_MD5)
      assert.equal(await blockMd5(SOURCE_ID), V.LIVE.source.md5)
      assert.equal((await stepRows(COMMENT_ID))[0].reviewed_code_md5, V.OLD_MD5)
    })

    await check('apply: block comment engine = bản V572, danh mục bước ghi md5 mới; block bộ cũ và block khác không đổi; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await blockMd5(COMMENT_ID), V.NEW_MD5)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [COMMENT_ID])).code, V.NEW_CODE)
      assert.deepEqual(await stepRows(COMMENT_ID), [{ id: V.LIVE.steps[0].id, commit_level: 2, send_ops: ['press:Enter'], reviewed_code_md5: V.NEW_MD5 }])
      assert.equal(await blockMd5(SOURCE_ID), V.LIVE.source.md5, 'bộ cũ không đổi')
      for (const [id, m] of Object.entries(others)) assert.equal(await blockMd5(Number(id)), m, `block ${id} không đổi`)
      await expectRefused(migration, /không còn đúng bản V563/)
    })

    await check('gỡ: về đúng code + md5 đã duyệt của V563; gỡ lại bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal(await blockMd5(COMMENT_ID), V.OLD_MD5)
      assert.equal((await stepRows(COMMENT_ID))[0].reviewed_code_md5, V.OLD_MD5)
      await expectRefused(rollback, /không phải bản V572/)
      await db.query(migration)
      assert.equal(await blockMd5(COMMENT_ID), V.NEW_MD5)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
