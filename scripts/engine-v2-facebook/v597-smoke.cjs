#!/usr/bin/env node
// Kiểm V597 (đăng nhóm: ba chữ đỏ Facebook ghi trong hộp Tạo bài viết khi hết giờ chờ form đóng → FB48 / FB49 / FB50; anh chốt 20/11/2026,
// câu 585 của hộp thư lỗi), không chạm DB thật:
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LC_ALL=C node scripts/engine-v2-facebook/v597-smoke.cjs
// 1. PostgreSQL 17 cục bộ: DB engine như production (bootstrap + V556–V559, V563, V564, V575, V591) cộng block 2624 / 2871, danh mục bước,
//    element GroupPost* đọc 20/11; chạy nguyên văn migration rồi so mọi quyết định chính sách trước / sau (chỉ ba mã mới; FB48 = FB42 ở đăng
//    nhóm), bản gỡ trả về như cũ, không apply lại được.
// 2. Chromium: chạy nguyên code block 2871 (bản cũ và bản V597) trên hộp Tạo bài viết giả dựng theo ảnh lỗi 20/11 (yêu cầu ảnh 3, 6, 8). Câu
//    block trả đi qua đúng bộ nhận dấu hiệu của Desktop (errorSigns.ts) với dòng dấu hiệu sau V597.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, applyV575, applyV591, readMigration, ROOT } = require('./fixture.cjs')
const V = require('../build-v597-sql.cjs')

const PORT = Number(process.env.ENGINE_FB_V597_PORT || 55597)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const MIGRATION = readMigration(`${V.NAME}.sql`)
const ROLLBACK = readMigration(`${V.ROLLBACK_NAME}.sql`)
const LIVE = V.LIVE
const NEW_CODE_LIST = V.NEW_CODES.map(c => c.code)
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

const FB_ACTIONS = [['fb_post_group', 'facebook_group_post'], ['fb_message_page_inbox_customer', 'facebook_page_to_message'],
  ['fb_comment', 'facebook_comment_seeding'], ['fb_message', 'facebook_message_uid'], ['fb_add_friend', 'facebook_add_friend'],
  ['fb_post_page', 'facebook_page_post'], ['fb_join_group', 'facebook_join_group']]
const PHASES = V.PHASES

async function policyGrid(db) {
  const codes = (await db.query(`SELECT error_code FROM public.auto_error WHERE is_active AND NOT is_delete ORDER BY error_code`)).rows.map(r => r.error_code)
  const combos = codes.flatMap(code => FB_ACTIONS.flatMap(([a, ca]) => PHASES.map(ph => [code, a, ca, 'desktop', ph])))
  const { rows } = await db.query(`SELECT c->>0 AS code, c->>1 AS action, c->>4 AS phase,
      public.aka_agent_engine_resolve_policy(c->>0, NULL, c->>1, c->>2, c->>3, c->>4) - 'policy_ids' - 'revisions' AS p
    FROM jsonb_array_elements($1::jsonb) c`, [JSON.stringify(combos)])
  return new Map(rows.map(r => [`${r.code}|${r.action}|${r.phase}`, r.p]))
}

async function dump(db) {
  const q = async sql => (await db.query(sql)).rows.map(r => r.row)
  return {
    auto_error: await q(`SELECT to_jsonb(t) - 'updated_at' AS row FROM public.auto_error t ORDER BY id`),
    auto_outcome_policies: await q(`SELECT to_jsonb(t) - 'updated_at' - 'updated_by' - 'revision' AS row FROM public.auto_outcome_policies t ORDER BY id`),
    signs: await q(`SELECT jsonb_build_object('value', value) AS row FROM public.auto_system_settings WHERE key = 'facebook.error_signs'`),
    auto_elements: await q(`SELECT jsonb_build_object('name', name, 'xpath', xpath) AS row FROM public.auto_elements ORDER BY name`),
    blocks: await q(`SELECT jsonb_build_object('id', id, 'md5', md5(code)) AS row FROM public.auto_blocks ORDER BY id`),
    steps: await q(`SELECT to_jsonb(t) - 'updated_at' AS row FROM public.auto_engine_block_steps t ORDER BY id`)
  }
}

/** Thêm vào DB thử đúng phần production mà V597 đọc: element GroupPost*, block 2624 / 2871, sổ chép, dòng danh mục bước 4. */
async function seedGroupPostVerify(db) {
  for (const e of LIVE.elements) {
    await db.query(`INSERT INTO public.auto_elements (id, name, xpath, description, category, is_builtin) VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.id, e.name, e.xpath, e.description, e.category, e.is_builtin])
  }
  await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, 'fb_verify_group_post_form_closed', $3, 'facebook'), ($2, $4, $3, 'facebook')`,
    [V.BLOCK.sourceId, V.BLOCK.id, LIVE.block.code, V.BLOCK.name])
  await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy) VALUES ($1, $2, $3, $3)`,
    [V.BLOCK.id, V.BLOCK.sourceId, V.BLOCK.oldMd5])
  const s = LIVE.step
  await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops, result_mode, reviewed_code_md5, note)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [s.id, s.block_id, s.step_kind, s.action_code, s.commit_level, JSON.stringify(s.send_ops), s.result_mode, s.reviewed_code_md5, s.note])
}

async function sqlChecks() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v597-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    for (const name of FACEBOOK_POLICY_MIGRATIONS) await db.query(readMigration(name))
    await applyV563(db)
    await applyV575(db)
    await applyV591(db)
    await seedGroupPostVerify(db)

    await check('DB thử khớp các điểm migration kiểm trước (dấu hiệu sau V591 = production, FB42, block 2871, mã FB lớn nhất FB47)', async () => {
      assert.equal((await db.query(`SELECT md5(value) AS m FROM public.auto_system_settings WHERE key = 'facebook.error_signs'`)).rows[0].m, V.SIGNS_BEFORE_MD5)
      assert.equal((await db.query(`SELECT md5(code) AS m FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].m, V.BLOCK.oldMd5)
      const fb42 = (await db.query(`SELECT error_class, is_active FROM public.auto_error WHERE error_code = $1`, [V.FB42.code])).rows[0]
      assert.deepEqual(fb42, { error_class: 'target_permanent', is_active: true })
      assert.equal((await db.query(`SELECT max(substring(public_code from 3)::int) AS n FROM public.auto_error WHERE public_code ~ '^FB[0-9]+$'`)).rows[0].n, 47)
      // Chính sách gộp của FB42 ở đăng nhóm trên DB thử = bản production đọc 20/11 (FB48 chép từ đó).
      for (const ph of PHASES) {
        const p = (await db.query(`SELECT public.aka_agent_engine_resolve_policy($1, NULL, 'fb_post_group', 'facebook_group_post', 'desktop', $2)
          - 'policy_ids' - 'revisions' AS p`, [V.FB42.code, ph])).rows[0].p
        assert.deepEqual(p, LIVE.resolved.FB42[ph], ph)
      }
    })

    const before = await dump(db)
    const gridBefore = await policyGrid(db)
    await check('bản gỡ từ chối khi V597 chưa apply', async () => { await rejects(db, ROLLBACK, /Gỡ V597: block 2871 khác bản V597/) })

    await db.query(MIGRATION)
    const after = await dump(db)
    const gridAfter = await policyGrid(db)

    await check('apply: chỉ ba mã mới có chính sách mới, mọi quyết định khác giữ nguyên; FB48 = FB42 ở đăng nhóm từng trường', async () => {
      const changed = []
      for (const [key, p] of gridAfter) {
        if (!gridBefore.has(key)) { changed.push(key); continue }
        if (JSON.stringify(p) !== JSON.stringify(gridBefore.get(key))) changed.push(key)
      }
      // Mã mới: mọi thao tác đều "mới"; ở thao tác khác chính sách gộp là của lớp lỗi (không phát ở đó).
      const expected = NEW_CODE_LIST.flatMap(code => FB_ACTIONS.flatMap(([a]) => PHASES.map(ph => `${code}|${a}|${ph}`)))
      assert.deepEqual(changed.sort(), expected.sort())
      for (const ph of PHASES) {
        assert.deepEqual(gridAfter.get(`${V.FB48.code}|fb_post_group|${ph}`), gridAfter.get(`${V.FB42.code}|fb_post_group|${ph}`), `FB48 = FB42 (${ph})`)
        const p49 = gridAfter.get(`${V.FB49.code}|fb_post_group|${ph}`)
        assert.deepEqual([p49.target_effect, p49.target_streak_effect, p49.quota_effect, p49.campaign_effect, p49.run_effect, String(p49.detail_status_id),
          p49.log_template, p49.streak_threshold ?? null], ['requeue', 'increment', 'no_count', 'none', 'continue', '21', '{message}', null])
        const p50 = gridAfter.get(`${V.FB50.code}|fb_post_group|${ph}`)
        assert.deepEqual([p50.target_effect, p50.target_streak_effect, p50.quota_effect, p50.campaign_effect, p50.run_effect, String(p50.detail_status_id),
          p50.log_template, p50.streak_threshold ?? null, p50.campaign_note_template],
          ['requeue', 'ignore', 'no_count', 'pause', 'end_unit', '21', '{message}', null, `${V.FB50.title} (FB50).`])
      }
    })

    await check('apply: dữ liệu đổi đúng chỗ (3 element, block 2871, bước 4, dấu hiệu, 3 mã, 3 chính sách; bộ cũ 2624 không đổi)', async () => {
      assert.deepEqual(after.auto_elements.filter(e => !before.auto_elements.some(b => b.name === e.name)),
        V.ELEMENTS.map(e => ({ name: e.name, xpath: e.xpath })).sort((a, b) => a.name.localeCompare(b.name)))
      assert.equal(after.auto_elements.length, before.auto_elements.length + 3)
      assert.deepEqual(after.blocks.filter(b => b.id !== V.BLOCK.id), before.blocks.filter(b => b.id !== V.BLOCK.id))
      assert.equal(after.blocks.find(b => b.id === V.BLOCK.id).md5, V.NEW_MD5)
      assert.equal(after.blocks.find(b => b.id === V.BLOCK.sourceId).md5, V.BLOCK.oldMd5)
      assert.equal(after.steps.find(s => s.id === V.STEP.id).reviewed_code_md5, V.NEW_MD5)
      assert.deepEqual(after.steps.filter(s => s.id !== V.STEP.id), before.steps.filter(s => s.id !== V.STEP.id))
      assert.equal(after.signs[0].value, V.SIGNS_AFTER_JSON)
      const newErrors = after.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id))
      assert.deepEqual(newErrors.map(e => [e.error_code, e.public_code, e.customer_title, e.customer_help, e.error_class]),
        V.NEW_CODES.map(c => [c.code, c.pub, c.title, null, c.cls]))
      assert.deepEqual(after.auto_error.filter(e => before.auto_error.some(b => b.id === e.id)), before.auto_error)
      assert.equal(after.auto_outcome_policies.length, before.auto_outcome_policies.length + 3)
      assert.deepEqual(after.auto_outcome_policies.slice(0, before.auto_outcome_policies.length), before.auto_outcome_policies)
    })

    await check('apply lần hai bị từ chối (block đã khác bản đã đọc), sổ migration có V597 cũng bị từ chối', async () => {
      await rejects(db, MIGRATION, /V597: block 2871 khác bản đã đọc/)
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261120999997', '${V.NAME}')`)
      await rejects(db, MIGRATION, /V597: sổ migration đã có/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261120999997'`)
    })

    await db.query(ROLLBACK)
    const restored = await dump(db)
    await check('bản gỡ: block, bước, dấu hiệu, element về đúng bản trước; ba mã và ba chính sách chỉ bị tắt', async () => {
      assert.deepEqual(restored.blocks, before.blocks)
      assert.deepEqual(restored.steps, before.steps)
      assert.deepEqual(restored.signs, before.signs)
      assert.deepEqual(restored.auto_elements, before.auto_elements)
      assert.deepEqual(restored.auto_error.filter(e => before.auto_error.some(b => b.id === e.id)), before.auto_error)
      assert.deepEqual(restored.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id)).map(e => [e.error_code, e.is_active]),
        NEW_CODE_LIST.map(code => [code, false]))
      const extra = restored.auto_outcome_policies.slice(before.auto_outcome_policies.length)
      assert.deepEqual(extra.map(p => [p.error_code, p.is_active]), NEW_CODE_LIST.map(code => [code, false]))
      assert.equal((await db.query(`SELECT code FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].code, LIVE.block.code)
      const gridRestored = await policyGrid(db)
      for (const [key, p] of gridBefore) assert.deepEqual(gridRestored.get(key), p, key)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
}

// ---------------------------------------------------------------- Chromium: chạy code block 2871 thật trên hộp Tạo bài viết giả
// Theo ảnh lỗi 20/11 (chưa có DOM): chữ đỏ nằm ngay dưới nút Đăng trong hộp; "giới hạn quyền truy cập" có link "Trung tâm trợ giúp" giữa câu;
// "không tải được file" ghi tên tệp ở dòng sau. Chưa biết chữ nằm trong form hay chỉ trong hộp thoại nên thử cả hai chỗ.
const RED = 'style="color:#e41e3f"'
const NOTICES = {
  request: `<div><span ${RED}>Chúng tôi gặp sự cố khi hoàn tất yêu cầu của bạn. Vui lòng thử lại.</span></div><div role="button">Đóng góp ý kiến</div>`,
  uploadTwoLines: `<div ${RED}><span>Không thể tải file của bạn lên:</span><div>1794220594392_771090434025_9657c4028946b54eb78a501b0babf397.jpg</div></div>`,
  uploadOneLine: `<div ${RED}>Không thể tải file của bạn lên: anh-1.jpg</div>`,
  access: `<div ${RED}>Vì lý do bảo mật, tài khoản của bạn đã giới hạn quyền truy cập vào trang web trong vài ngày. Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ với <a href="#">Trung tâm trợ giúp</a> của chúng tôi.</div><div ${RED}>Nếu bạn cho rằng nội dung này không vi phạm Tiêu chuẩn cộng đồng của chúng tôi, <a href="#">hãy cho chúng tôi biết</a>.</div><div role="button">Đóng góp ý kiến</div>`,
  frequency: `<div ${RED}>Facebook đã giới hạn tần suất bạn đăng bài trong nhóm này</div>`
}
const POSTING = `<div style="position:absolute;inset:0;background:rgba(0,0,0,.5)"><div role="progressbar"></div><span>Đang đăng</span></div>`
function pageHtml({ closed = false, notice = '', where = 'form', body = 'Nội dung bài', overlay = '', feed = '' }) {
  const inForm = where === 'form' ? notice : ''
  const inDialog = where === 'dialog' ? notice : ''
  const hidden = where === 'hidden' ? `<div style="display:none">${notice}</div>` : ''
  const dialog = closed ? '' : `<div role="dialog" aria-label="Tạo bài viết"><form>
  <h2>Tạo bài viết</h2><div role="button" aria-label="Đóng">x</div>
  <div contenteditable="true" role="textbox">${body}</div>
  <div role="button" aria-label="Đăng"><span>Đăng</span></div>
  ${inForm}${hidden}
</form>${inDialog}${overlay}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div role="main"><div role="feed">${feed}</div></div>${dialog}</body></html>`
}
const FORM_STUCK = 'Form đăng bài chưa đóng sau 60 giây'
const CASES = [
  { id: 'form đã đóng: thành công như cũ', page: { closed: true }, expectOld: 'ok', expectNew: 'ok', code: null },
  { id: 'FB48: "Chúng tôi gặp sự cố khi hoàn tất yêu cầu" dưới nút Đăng (ảnh yêu cầu 3)', page: { notice: NOTICES.request },
    expectOld: FORM_STUCK, expectNew: V.FB48.title, code: V.FB48.code },
  { id: 'FB49: "Không thể tải file của bạn lên:" + tên tệp dòng sau (ảnh yêu cầu 6)', page: { notice: NOTICES.uploadTwoLines },
    expectOld: FORM_STUCK, expectNew: V.FB49.title, code: V.FB49.code },
  { id: 'FB49: cùng câu một dòng, nằm trong hộp thoại ngoài form', page: { notice: NOTICES.uploadOneLine, where: 'dialog' },
    expectOld: FORM_STUCK, expectNew: V.FB49.title, code: V.FB49.code },
  { id: 'FB50: "Vì lý do bảo mật, tài khoản của bạn đã giới hạn quyền truy cập" có link giữa câu (ảnh yêu cầu 8)', page: { notice: NOTICES.access },
    expectOld: FORM_STUCK, expectNew: V.FB50.title, code: V.FB50.code },
  { id: 'FB50: cùng câu nằm trong hộp thoại ngoài form', page: { notice: NOTICES.access, where: 'dialog' },
    expectOld: FORM_STUCK, expectNew: V.FB50.title, code: V.FB50.code },
  { id: 'vòng quay "Đang đăng" (chờ DOM, chưa làm): vẫn FB42', page: { overlay: POSTING }, expectOld: FORM_STUCK, expectNew: FORM_STUCK, code: null },
  { id: 'chữ trong nội dung bài khách gõ: không nhận nhầm, vẫn FB42', page: { body: 'Shop gặp sự cố khi hoàn tất yêu cầu của khách? Không thể tải file của bạn lên thì nhắn shop' },
    expectOld: FORM_STUCK, expectNew: FORM_STUCK, code: null },
  { id: 'chữ trong bài trên trang nhóm (ngoài hộp đăng bài): không nhận nhầm, vẫn FB42',
    page: { feed: '<div>Vì lý do bảo mật, tài khoản của bạn đã giới hạn quyền truy cập vào trang web trong vài ngày.</div>' },
    expectOld: FORM_STUCK, expectNew: FORM_STUCK, code: null },
  { id: 'chữ bị ẩn trong hộp: không nhận, vẫn FB42', page: { notice: NOTICES.request, where: 'hidden' }, expectOld: FORM_STUCK, expectNew: FORM_STUCK, code: null },
  { id: 'giới hạn tần suất: ném câu như cũ (FB02), không đổi', page: { notice: NOTICES.frequency },
    expectOld: 'throw:Facebook báo giới hạn tần suất bạn đăng bài', expectNew: 'throw:Facebook báo giới hạn tần suất bạn đăng bài', code: null }
]

function loadErrorSigns() {
  const esbuild = require('esbuild')
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'src/main/engineAdapters/facebook/errorSigns.ts')], bundle: true, platform: 'node',
    format: 'cjs', write: false, logLevel: 'silent' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}

async function runBlock(pw, code, kase) {
  await pw.setContent(pageHtml(kase.page))
  const elements = new Map([...LIVE.elements.map(e => [e.name, e.xpath]), ...V.ELEMENTS.map(e => [e.name, e.xpath])])
  const page = { evaluate: (body, ...args) => pw.evaluate(`(async function() { var __args = ${JSON.stringify(args)}; ${body} })()`) }
  const helpers = {
    element: async n => { if (!elements.has(n)) throw new Error(`Element không tìm thấy: ${n}`); return elements.get(n) },
    sleep: ms => new Promise(r => setTimeout(r, Math.min(Number(ms) || 0, 30))),
    log: () => undefined
  }
  // Đã bấm Đăng 61 giây trước: block kiểm form một lần rồi hết giờ (không chờ 60 giây trong bài kiểm).
  const vars = { images: [], facebookPostPublishStartedAt: Date.now() - 61_000 }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  try {
    const out = await new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', code)(page, helpers, vars, {}, { aborted: false })
    return out.ok === true ? { result: 'ok', out, vars } : { result: out.message, out, vars }
  } catch (error) {
    return { result: `throw:${error.message}`, vars }
  }
}

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const pw = await browser.newPage()
  const signs = loadErrorSigns()
  const parsed = signs.parseFacebookErrorSigns(V.SIGNS_AFTER_JSON)
  const parsedBefore = signs.parseFacebookErrorSigns(LIVE.signs.value)
  const ctx = { actionCode: V.ACTION, phase: 'after_send', currentErrorCode: null }
  try {
    await check('dòng dấu hiệu sau V597: Desktop đọc được đủ, thêm đúng 3 dấu hiệu "message" cho đăng nhóm', async () => {
      assert.equal(parsed.length, parsedBefore.length + 3)
      assert.deepEqual(parsed.slice(parsedBefore.length).map(s => [s.code, s.source, s.actions, s.replaces]),
        NEW_CODE_LIST.map(code => [code, 'message', ['fb_post_group'], []]))
    })
    for (const kase of CASES) {
      await check(`block 2871 trên hộp Tạo bài viết giả: ${kase.id}`, async () => {
        const oldRun = await runBlock(pw, LIVE.block.code, kase)
        const newRun = await runBlock(pw, V.NEW_CODE, kase)
        assert.equal(oldRun.result, kase.expectOld, 'bản cũ')
        assert.equal(newRun.result, kase.expectNew, 'bản V597')
        if (kase.expectNew === 'ok') { assert.equal(newRun.vars.groupPostSubmitted, true); return }
        if (kase.expectNew.startsWith('throw:')) return
        assert.equal(newRun.vars.groupPostSubmitted, false)
        assert.deepEqual([newRun.out.ok, newRun.out.posted, newRun.out.submitClosed], [false, false, false])
        // Desktop dựng dòng lịch sử "Đăng bài thất bại vào <nhóm>: <câu block>" không mã (pha after_send), rồi dò dấu hiệu.
        const pick = (list, message) => signs.pickFacebookErrorSign(list, ctx, { pageTexts: null, messages: [V.rowMessage(message), null] })?.code ?? null
        assert.equal(pick(parsed, newRun.result), kase.code, 'mã sau V597')
        // Trước V597 cùng trang chỉ ra dòng không mã (FB42).
        assert.equal(pick(parsedBefore, oldRun.result), null, 'trước V597')
      })
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  await sqlChecks()
  await chromiumChecks()
  console.log(`\n${passed} đạt, ${failed} lỗi (md5 migration ${md5(MIGRATION)})`)
  if (failed) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
