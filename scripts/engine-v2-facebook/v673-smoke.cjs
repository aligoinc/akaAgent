#!/usr/bin/env node
// Kiểm V673 (đăng nhóm: block 2871 dò chữ giới hạn tần suất trong hộp Tạo bài viết ngay trong vòng chờ → FB02, không chờ hết 60 / 180 giây;
// anh chốt 27/11/2026, câu 9004 của hộp thư lỗi), không chạm DB thật:
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LC_ALL=C node scripts/engine-v2-facebook/v673-smoke.cjs
// 1. PostgreSQL 17 cục bộ: DB engine như production (bootstrap + V556–V559, V563, V575, V591, V597) → block 2871 đúng bản production đọc 27/11;
//    chạy nguyên văn migration, chỉ element mới / block 2871 / bước 4 đổi, câu FB02 vẫn ra FB02, không apply lại được, bản gỡ trả về như cũ.
// 2. Chromium: chạy nguyên code block 2871 (bản V597 đang chạy và bản V673) trên hộp Tạo bài viết giả dựng theo ảnh + DOM yêu cầu 41 / 44 / 45
//    (27/11), đồng hồ ảo (helpers.sleep đẩy giờ, không chờ thật): giờ ra kết quả, app thoát giữa lúc chờ như lượt 294055.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, applyV575, applyV591, applyV597, readMigration } = require('./fixture.cjs')
const V = require('../build-v673-sql.cjs')

const PORT = Number(process.env.ENGINE_FB_V673_PORT || 55673)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const MIGRATION = readMigration(`${V.NAME}.sql`)
const ROLLBACK = readMigration(`${V.ROLLBACK_NAME}.sql`)
const LIVE = V.LIVE
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}
async function rejects(db, sql, pattern) {
  try { await db.query(sql) } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    assert.match(String(error.message), pattern)
    return
  }
  assert.fail('câu lệnh phải bị từ chối')
}

async function dump(db) {
  const q = async sql => (await db.query(sql)).rows.map(r => r.row)
  return {
    auto_elements: await q(`SELECT jsonb_build_object('name', name, 'xpath', xpath, 'description', description) AS row FROM public.auto_elements ORDER BY name`),
    blocks: await q(`SELECT jsonb_build_object('id', id, 'md5', md5(code)) AS row FROM public.auto_blocks ORDER BY id`),
    steps: await q(`SELECT to_jsonb(t) - 'updated_at' AS row FROM public.auto_engine_block_steps t ORDER BY id`),
    signs: await q(`SELECT jsonb_build_object('value', value) AS row FROM public.auto_system_settings WHERE key = 'facebook.error_signs'`),
    auto_error: await q(`SELECT to_jsonb(t) - 'updated_at' AS row FROM public.auto_error t ORDER BY id`),
    auto_outcome_policies: await q(`SELECT to_jsonb(t) - 'updated_at' - 'updated_by' - 'revision' AS row FROM public.auto_outcome_policies t ORDER BY id`)
  }
}

// Tín hiệu Desktop gửi khi block ném ở bước chờ xác nhận (dòng "Lỗi đăng bài vào <nhóm>: <câu>", sau dấu gửi).
const fb02Signal = { kind: 'block', code: 'throw', message: `Lỗi đăng bài vào https://www.facebook.com/groups/1: ${V.FB02.message}` }
async function classify(db, signal) {
  return (await db.query(`SELECT c.error_code FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'after_send', $1::jsonb) c`,
    [JSON.stringify(signal)])).rows[0]?.error_code ?? null
}

async function sqlChecks() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v673-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    for (const name of FACEBOOK_POLICY_MIGRATIONS) await db.query(readMigration(name))
    await applyV563(db)
    await applyV575(db)
    await applyV591(db)
    await applyV597(db)

    await check('DB thử (sau V597) khớp production đọc 27/11: block 2871, bước 4, element GroupPost* block dùng', async () => {
      assert.equal((await db.query(`SELECT code FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].code, LIVE.block.code)
      assert.equal((await db.query(`SELECT md5(code) AS m FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.sourceId])).rows[0].m, V.BLOCK.sourceMd5)
      const step = (await db.query(`SELECT reviewed_code_md5, commit_level FROM public.auto_engine_block_steps WHERE id = $1`, [V.STEP.id])).rows[0]
      assert.deepEqual(step, { reviewed_code_md5: V.BLOCK.oldMd5, commit_level: V.STEP.commitLevel })
      const names = ['GroupPostSubmitButtonAfterClick', 'GroupPostFrequencyLimitError', 'GroupPostRequestFailedNotice', 'GroupPostUploadFailedNotice',
        'GroupPostAccountAccessLimitedNotice']
      const { rows } = await db.query(`SELECT name, xpath FROM public.auto_elements WHERE name = ANY($1::text[]) ORDER BY name`, [names])
      assert.deepEqual(rows, LIVE.elements.filter(e => names.includes(e.name)).map(e => ({ name: e.name, xpath: e.xpath })).sort((a, b) => a.name.localeCompare(b.name)))
    })

    const before = await dump(db)
    const fb02Before = await classify(db, fb02Signal)
    await check('bản gỡ từ chối khi V673 chưa apply', async () => { await rejects(db, ROLLBACK, /Gỡ V673: block 2871 khác bản V673/) })

    await db.query(MIGRATION)
    const after = await dump(db)

    await check('apply: chỉ đổi element mới, block 2871, bước 4; bộ cũ 2624, dấu hiệu, mã lỗi, chính sách giữ nguyên', async () => {
      assert.deepEqual(after.auto_elements.filter(e => !before.auto_elements.some(b => b.name === e.name)),
        [{ name: V.ELEMENT.name, xpath: V.ELEMENT.xpath, description: V.ELEMENT.description }])
      assert.equal(after.auto_elements.length, before.auto_elements.length + 1)
      assert.deepEqual(after.blocks.filter(b => b.id !== V.BLOCK.id), before.blocks.filter(b => b.id !== V.BLOCK.id))
      assert.equal(after.blocks.find(b => b.id === V.BLOCK.id).md5, V.NEW_MD5)
      assert.equal((await db.query(`SELECT code FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].code, V.NEW_CODE)
      assert.equal(after.steps.find(s => s.id === V.STEP.id).reviewed_code_md5, V.NEW_MD5)
      assert.deepEqual(after.steps.filter(s => s.id !== V.STEP.id), before.steps.filter(s => s.id !== V.STEP.id))
      for (const key of ['signs', 'auto_error', 'auto_outcome_policies']) assert.deepEqual(after[key], before[key], key)
    })

    await check('câu block ném ở bước chờ vẫn ra FB02 (luật 116) trước và sau V673', async () => {
      assert.equal(fb02Before, V.FB02.code)
      assert.equal(await classify(db, fb02Signal), V.FB02.code)
    })

    await check('apply lần hai bị từ chối (block đã khác bản đã đọc), sổ migration có V673 cũng bị từ chối', async () => {
      await rejects(db, MIGRATION, /V673: block 2871 khác bản đã đọc/)
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261127999997', '${V.NAME}')`)
      await rejects(db, MIGRATION, /V673: sổ migration đã có/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261127999997'`)
    })

    await db.query(ROLLBACK)
    const restored = await dump(db)
    await check('bản gỡ: block, bước, element về đúng bản trước (bản V597)', async () => {
      assert.deepEqual(restored, before)
      assert.equal((await db.query(`SELECT code FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].code, LIVE.block.code)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
}

// ---------------------------------------------------------------- Chromium: chạy code block 2871 thật trên hộp Tạo bài viết giả
// Dựng theo ảnh + DOM yêu cầu 44 / 45 (27/11): chữ đỏ ngay dưới nút Đăng, trong form của role=dialog, một text node trong
// <div style="display: inline;">, kèm link "Tìm hiểu thêm"; nút Đăng không aria-disabled; không có lớp "Đang đăng".
const RED = 'style="color:#e41e3f"'
const RATE_TEXT = 'Để bảo vệ cộng đồng khỏi spam, chúng tôi giới hạn tần suất bạn đăng bài, bình luận hoặc làm các việc khác trong khoảng thời gian nhất định. Bạn có thể thử lại sau.'
const NOTICES = {
  rate: `<div ${RED}><div><span><div style="display: inline;">${RATE_TEXT}</div> <a href="#">Tìm hiểu thêm</a></span></div>
    <div><span>Nếu bạn cho rằng nội dung này không vi phạm Tiêu chuẩn cộng đồng của chúng tôi, <a href="#">hãy cho chúng tôi biết</a>.</span></div></div>`,
  // DOM yêu cầu 27 / 31: "Không thể tải file" cùng lúc với lớp "Đang đăng", nút Đăng aria-disabled.
  upload: `<div ${RED}><span>Không thể tải file của bạn lên:</span><div>anh-1.jpg</div></div>`,
  request: `<div><span ${RED}>Chúng tôi gặp sự cố khi hoàn tất yêu cầu của bạn. Vui lòng thử lại.</span></div>`
}
const POSTING = `<div role="alert" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"><span>Đang đăng</span></div>`
function pageHtml({ closed = false, notice = '', where = 'form', body = 'Nội dung bài', overlay = '', feed = '', disabled = false }) {
  const inForm = where === 'form' ? notice : ''
  const inDialog = where === 'dialog' ? notice : ''
  const hidden = where === 'hidden' ? `<div style="display:none">${notice}</div>` : ''
  const dialog = closed ? '' : `<div role="dialog"><form>
  <h2>Tạo bài viết</h2><div role="button" aria-label="Đóng">x</div>
  <div contenteditable="true" role="textbox">${body}</div>
  <div role="button" aria-label="Đăng"${disabled ? ' aria-disabled="true"' : ''} tabindex="0"><span>Đăng</span></div>
  ${inForm}${hidden}
</form>${inDialog}${overlay}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div role="main"><div role="feed">${feed}</div></div>${dialog}</body></html>`
}

const RATE_MSG = `throw:${V.FB02.message}`
const CANCELLED = 'throw:Block bị huỷ trong khi sleep'
const STUCK = 'Form đăng bài chưa đóng sau 60 giây'
const CLICK_MS = 3_000 // bước bấm Đăng xong khoảng 3 giây sau mốc bấm (12 lượt FB02 mẫu: click_post 3,0–3,5 s)
// timeline: [giây ảo kể từ mốc bấm Đăng, trang]; abortAt: giây ảo app thoát (tín hiệu huỷ của lượt bật). expect*: [kết quả, giây ảo ra kết quả].
const CASES = [
  { id: 'lượt 294055: chữ giới hạn tần suất dưới nút Đăng, app thoát ở giây 30 → bản cũ mất dấu hiệu (SYS99 / SYS02), bản mới FB02 trước khi bị ngắt',
    timeline: [[0, { notice: NOTICES.rate }]], abortAt: 30_000, expectOld: [CANCELLED, 30_000], expectNew: [RATE_MSG, 3_500] },
  { id: 'giới hạn tần suất, không bị ngắt: bản cũ chờ hết 60 giây, bản mới báo ở vòng thứ hai',
    timeline: [[0, { notice: NOTICES.rate }]], expectOld: [RATE_MSG, 60_000], expectNew: [RATE_MSG, 3_500] },
  { id: 'chữ hiện ở giây 8 (Facebook trả lời chậm): bản mới báo ngay sau 2 vòng thấy chữ',
    timeline: [[0, {}], [8_000, { notice: NOTICES.rate }]], expectOld: [RATE_MSG, 60_000], expectNew: [RATE_MSG, 8_500] },
  { id: 'bài có video (hạn 180 giây): bản mới cũng báo sớm',
    timeline: [[0, { notice: NOTICES.rate }]], video: true, expectOld: [RATE_MSG, 180_000], expectNew: [RATE_MSG, 3_500] },
  { id: 'chữ ở ngoài hộp thoại / form vẫn trong role=dialog: bản mới báo sớm',
    timeline: [[0, { notice: NOTICES.rate, where: 'dialog' }]], expectOld: [RATE_MSG, 60_000], expectNew: [RATE_MSG, 3_500] },
  { id: 'form đóng ở giây 5, không có chữ: thành công như cũ',
    timeline: [[0, {}], [5_000, { closed: true }]], expectOld: ['ok', 5_000], expectNew: ['ok', 5_000] },
  { id: 'chữ chỉ hiện một vòng rồi mất, form đóng sau: không báo nhầm FB02',
    timeline: [[0, {}], [4_000, { notice: NOTICES.rate }], [4_500, {}], [6_000, { closed: true }]], expectOld: ['ok', 6_000], expectNew: ['ok', 6_000] },
  { id: 'cùng chữ trong bài trên trang nhóm (ngoài hộp đăng), form đóng ở giây 10: không báo sớm',
    timeline: [[0, { feed: `<div>${RATE_TEXT}</div>` }], [10_000, { closed: true, feed: `<div>${RATE_TEXT}</div>` }]],
    expectOld: ['ok', 10_000], expectNew: ['ok', 10_000] },
  { id: 'cùng chữ trong nội dung bài khách gõ (ô soạn), form đóng ở giây 10: không báo sớm',
    timeline: [[0, { body: `Shop nhắc: ${RATE_TEXT}` }], [10_000, { closed: true }]], expectOld: ['ok', 10_000], expectNew: ['ok', 10_000] },
  { id: 'chữ bị ẩn trong hộp: không báo sớm, hết giờ thì nhánh cũ (element cả trang) vẫn ra FB02 như hôm nay',
    timeline: [[0, { notice: NOTICES.rate, where: 'hidden' }]], expectOld: [RATE_MSG, 60_000], expectNew: [RATE_MSG, 60_000] },
  { id: 'FB49 "Không thể tải file" + "Đang đăng" (DOM 27 / 31): vẫn chờ hết giờ như V597',
    timeline: [[0, { notice: NOTICES.upload, overlay: POSTING, disabled: true }]],
    expectOld: ['Facebook không tải được ảnh hoặc video lên', 60_000], expectNew: ['Facebook không tải được ảnh hoặc video lên', 60_000] },
  { id: 'FB48 "gặp sự cố": vẫn chờ hết giờ như V597',
    timeline: [[0, { notice: NOTICES.request }]], expectOld: ['Facebook báo gặp sự cố khi đăng bài', 60_000], expectNew: ['Facebook báo gặp sự cố khi đăng bài', 60_000] },
  { id: 'vòng quay "Đang đăng" không chữ đỏ: hết giờ vẫn FB42 như cũ',
    timeline: [[0, { overlay: POSTING }]], expectOld: [STUCK, 60_000], expectNew: [STUCK, 60_000] },
  { id: 'app thoát ở giây 30 khi chưa có chữ nào: bản mới vẫn ném "Block bị huỷ" (#734 đổi ra SYS02) như cũ',
    timeline: [[0, {}]], abortAt: 30_000, expectOld: [CANCELLED, 30_000], expectNew: [CANCELLED, 30_000] }
]

async function runBlock(pw, code, kase) {
  const t0 = 1_800_000_000_000
  const clock = { now: t0 + CLICK_MS }
  const timeline = kase.timeline.map(([at, page]) => [t0 + at, page])
  let shown = null
  const render = async () => {
    let next = null
    for (const [at, page] of timeline) if (at <= clock.now) next = page
    if (next && next !== shown) { await pw.setContent(pageHtml(next)); shown = next }
  }
  await render()
  const signal = { aborted: false }
  const abortAt = kase.abortAt == null ? null : t0 + kase.abortAt
  const elements = new Map([...LIVE.elements.map(e => [e.name, e.xpath]), [V.ELEMENT.name, V.ELEMENT.xpath]])
  const page = { evaluate: (body, ...args) => pw.evaluate(`(async function() { var __args = ${JSON.stringify(args)}; ${body} })()`) }
  const helpers = {
    element: async n => { if (!elements.has(n)) throw new Error(`Element không tìm thấy: ${n}`); return elements.get(n) },
    // Như blockHelpers.ts: tín hiệu bật trong lúc ngủ thì ném "Block bị huỷ trong khi sleep". Đồng hồ ảo: ngủ là đẩy giờ.
    sleep: async (ms, sig) => {
      if (sig?.aborted) throw new Error('Block bị huỷ trước khi sleep')
      const until = clock.now + Number(ms)
      if (abortAt != null && abortAt <= until) { clock.now = abortAt; signal.aborted = true; throw new Error('Block bị huỷ trong khi sleep') }
      clock.now = until
      await render()
    },
    log: () => undefined
  }
  const FakeDate = { now: () => clock.now }
  const vars = { images: kase.video ? ['C:/video/clip.mp4'] : [], facebookPostPublishStartedAt: t0 }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const at = () => clock.now - t0
  try {
    const out = await new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', 'Date', code)(page, helpers, vars, {}, signal, FakeDate)
    return { result: out.ok === true ? 'ok' : out.message, at: at(), out, vars }
  } catch (error) {
    return { result: `throw:${error.message}`, at: at(), vars }
  }
}

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const pw = await browser.newPage()
  try {
    await check('XPath mới khớp chữ thật trong hộp (dựng theo DOM 44 / 45), không khớp ô soạn / trang nhóm / chữ bị ẩn', async () => {
      const count = async opts => {
        await pw.setContent(pageHtml(opts))
        return pw.evaluate(x => document.evaluate(x, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength, V.ELEMENT.xpath)
      }
      assert.equal(await count({ notice: NOTICES.rate }), 1)
      assert.equal(await count({ body: RATE_TEXT }), 0)
      assert.equal(await count({ feed: `<div>${RATE_TEXT}</div>` }), 0)
      assert.equal(await count({ closed: true, feed: `<div>${RATE_TEXT}</div>` }), 0)
    })
    for (const kase of CASES) {
      await check(`block 2871: ${kase.id}`, async () => {
        const oldRun = await runBlock(pw, LIVE.block.code, kase)
        const newRun = await runBlock(pw, V.NEW_CODE, kase)
        assert.deepEqual([oldRun.result, oldRun.at], kase.expectOld, 'bản V597 (đang chạy)')
        assert.deepEqual([newRun.result, newRun.at], kase.expectNew, 'bản V673')
        if (newRun.result === RATE_MSG) {
          assert.equal(newRun.vars.groupPostSubmitted, false)
          assert.equal(newRun.vars.groupPostFrequencyLimitError, true)
        }
        if (newRun.result === 'ok') assert.equal(newRun.vars.groupPostSubmitted, true)
      })
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  const only = process.env.V673_ONLY
  if (only !== 'chromium') await sqlChecks()
  if (only !== 'sql') await chromiumChecks()
  console.log(`\n${passed} đạt, ${failed} lỗi (md5 migration ${md5(MIGRATION)})`)
  if (failed) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
