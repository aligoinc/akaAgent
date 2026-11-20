#!/usr/bin/env node
// Kiểm V603 (nhắn tin bạn bè / theo UID: Facebook ghi lý do ở chỗ ô nhập tin Messenger → FB19; câu 570 của hộp thư lỗi, anh chốt 20/11/2026),
// không chạm DB thật:
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LC_ALL=C node scripts/engine-v2-facebook/v603-smoke.cjs
// 1. PostgreSQL 17 cục bộ: DB engine như production (bootstrap + V556–V559, V563, V564, V575, V591, V597) cộng block 38 / 2855, sổ chép, danh
//    mục bước 15 / 16, element đọc 20/11; chạy nguyên văn migration rồi so mọi quyết định chính sách trước / sau (chỉ FB19 ở hai thao tác nhắn
//    tin và mã nội bộ mới đổi), bản gỡ trả về như cũ, không apply lại được.
// 2. Chromium: chạy nguyên code block 2855 (bản cũ và bản V603) trên trang Messenger giả dựng theo 18 ảnh lỗi chiến dịch 45597 (yêu cầu ảnh 9),
//    với bộ tìm phần tử y như PageController của Desktop. Câu block trả đi qua đúng bộ nhận dấu hiệu của Desktop (errorSigns.ts) với dòng dấu
//    hiệu sau V603.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, applyV575, applyV591, applyV597, readMigration, ROOT } = require('./fixture.cjs')
const V = require('../build-v603-sql.cjs')

const PORT = Number(process.env.ENGINE_FB_V603_PORT || 55603)
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

const FB_ACTIONS = [['fb_message_friend', 'facebook_message_friend'], ['fb_message_stranger', 'facebook_message_uid'],
  ['fb_message_page_inbox_customer', 'facebook_page_to_message'], ['fb_post_group', 'facebook_group_post'], ['fb_comment', 'facebook_comment_seeding'],
  ['fb_add_friend', 'facebook_add_friend'], ['fb_post_page', 'facebook_page_post'], ['fb_join_group', 'facebook_join_group']]
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

/** Thêm vào DB thử đúng phần production mà V603 đọc: block 38 / 2855, sổ chép, dòng danh mục bước 15 / 16, element Messenger đọc 20/11. */
async function seedMessenger(db) {
  for (const e of LIVE.elements) {
    await db.query(`INSERT INTO public.auto_elements (id, name, xpath, description, category, is_builtin) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (name) DO NOTHING`, [e.id, e.name, e.xpath, e.description, e.category, e.is_builtin])
  }
  await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, $2, $5, 'facebook'), ($3, $4, $5, 'facebook')`,
    [V.BLOCK.sourceId, LIVE.sourceBlock.name, V.BLOCK.id, V.BLOCK.name, LIVE.block.code])
  await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy) VALUES ($1, $2, $3, $3)`,
    [V.BLOCK.id, V.BLOCK.sourceId, V.BLOCK.oldMd5])
  for (const s of LIVE.steps) {
    // Danh mục bước gắn workflow (khoá block + workflow + node); bài kiểm chỉ cần dòng workflow có mặt.
    await db.query(`INSERT INTO public.auto_workflows (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [s.workflow_id, `v603 thử workflow ${s.workflow_id}`])
    await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, workflow_id, step_kind, action_code, commit_level, send_ops, result_mode,
      reviewed_code_md5, note) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [s.id, s.block_id, s.workflow_id, s.step_kind, s.action_code, s.commit_level, JSON.stringify(s.send_ops), s.result_mode, s.reviewed_code_md5, s.note])
  }
}

async function sqlChecks() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v603-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    for (const name of FACEBOOK_POLICY_MIGRATIONS) await db.query(readMigration(name))
    await applyV563(db)
    await applyV575(db)
    await applyV591(db)
    await applyV597(db)
    await seedMessenger(db)

    await check('DB thử khớp các điểm migration kiểm trước (dấu hiệu sau V597 = production, FB19, block 2855, chính sách gộp FB19 / FB42 như production)', async () => {
      assert.equal((await db.query(`SELECT md5(value) AS m FROM public.auto_system_settings WHERE key = 'facebook.error_signs'`)).rows[0].m, V.SIGNS_BEFORE_MD5)
      assert.equal((await db.query(`SELECT md5(code) AS m FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].m, V.BLOCK.oldMd5)
      const fb19 = (await db.query(`SELECT customer_title, customer_help, error_class, is_active FROM public.auto_error WHERE error_code = $1`, [V.FB19.code])).rows[0]
      assert.deepEqual(fb19, { customer_title: V.FB19.oldTitle, customer_help: null, error_class: 'target_permanent', is_active: true })
      for (const code of [V.FB19.code, V.FB42.code]) {
        for (const a of V.ACTIONS) {
          for (const ph of PHASES) {
            const p = (await db.query(`SELECT public.aka_agent_engine_resolve_policy($1, NULL, $2, $3, 'desktop', $4) - 'policy_ids' - 'revisions' AS p`,
              [code, a.code, a.campaignAction, ph])).rows[0].p
            assert.deepEqual(p, LIVE.resolved[`${code}|${a.code}|${ph}`], `${code}|${a.code}|${ph}`)
          }
        }
      }
    })

    const before = await dump(db)
    const gridBefore = await policyGrid(db)
    await check('bản gỡ từ chối khi V603 chưa apply', async () => { await rejects(db, ROLLBACK, /Gỡ V603: block 2855 khác bản V603/) })

    await db.query(MIGRATION)
    const after = await dump(db)
    const gridAfter = await policyGrid(db)

    await check('apply: chỉ FB19 ở hai thao tác nhắn tin và mã nội bộ mới đổi, mọi quyết định khác giữ nguyên (gồm FB42)', async () => {
      const changed = []
      for (const [key, p] of gridAfter) {
        if (!gridBefore.has(key)) { changed.push(key); continue }
        if (JSON.stringify(p) !== JSON.stringify(gridBefore.get(key))) changed.push(key)
      }
      // Mã mới: mọi thao tác đều "mới"; ở thao tác khác chính sách gộp của nó là chính sách lớp target_permanent (không phát ở đó).
      const expected = [
        ...FB_ACTIONS.flatMap(([a]) => PHASES.map(ph => `${V.NOT_ON_MESSENGER.code}|${a}|${ph}`)),
        ...V.ACTION_CODES.flatMap(a => PHASES.map(ph => `${V.FB19.code}|${a}|${ph}`))
      ]
      assert.deepEqual(changed.sort(), expected.sort())
      for (const c of V.CODES) {
        for (const a of V.ACTION_CODES) {
          for (const ph of PHASES) {
            const p = gridAfter.get(`${c.code}|${a}|${ph}`)
            assert.equal(p.target_effect, 'complete'); assert.equal(p.target_streak_effect, 'ignore'); assert.equal(p.campaign_effect, 'none')
            assert.equal(p.quota_effect, 'no_count'); assert.equal(String(p.detail_status_id), '21'); assert.equal(p.detail_mode, 'write')
            assert.equal(p.run_effect, 'continue'); assert.equal(p.remaining_steps, 'continue'); assert.equal(p.log_template, c.title)
            assert.equal(p.campaign_note_template, `${c.title} (FB19).`); assert.equal(p.streak_threshold ?? null, null)
            assert.equal(p.account_effect, 'none'); assert.equal(p.login_effect, 'none')
          }
        }
      }
    })

    await check('apply: dữ liệu đổi đúng chỗ (2 element, block 2855, bước 15 / 16, dấu hiệu, câu FB19, mã nội bộ mới, 4 chính sách); bộ cũ block 38 giữ nguyên', async () => {
      assert.deepEqual(after.auto_elements.filter(e => !before.auto_elements.some(b => b.name === e.name)),
        V.ELEMENTS.map(e => ({ name: e.name, xpath: e.xpath })).sort((a, b) => a.name.localeCompare(b.name)))
      assert.equal(after.auto_elements.length, before.auto_elements.length + 2)
      assert.deepEqual(after.blocks.filter(b => b.id !== V.BLOCK.id), before.blocks.filter(b => b.id !== V.BLOCK.id))
      assert.equal(after.blocks.find(b => b.id === V.BLOCK.id).md5, V.NEW_MD5)
      assert.equal(after.blocks.find(b => b.id === V.BLOCK.sourceId).md5, V.BLOCK.oldMd5)
      for (const a of V.ACTIONS) assert.equal(after.steps.find(s => s.id === a.stepId).reviewed_code_md5, V.NEW_MD5)
      assert.deepEqual(after.steps.filter(s => !V.ACTIONS.some(a => a.stepId === s.id)), before.steps.filter(s => !V.ACTIONS.some(a => a.stepId === s.id)))
      assert.equal(after.signs[0].value, V.SIGNS_AFTER_JSON)
      const newErrors = after.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id))
      assert.deepEqual(newErrors.map(e => [e.error_code, e.public_code, e.customer_title, e.customer_help, e.error_class, e.counts_toward_limit]),
        [[V.NOT_ON_MESSENGER.code, 'FB19', V.NOT_ON_MESSENGER.title, null, 'target_permanent', false]])
      const changedErrors = after.auto_error.filter(e => { const b = before.auto_error.find(x => x.id === e.id); return b && JSON.stringify(b) !== JSON.stringify(e) })
      assert.deepEqual(changedErrors.map(e => [e.error_code, e.customer_title]), [[V.FB19.code, V.FB19.title]])
      assert.equal(after.auto_outcome_policies.length, before.auto_outcome_policies.length + 4)
      assert.deepEqual(after.auto_outcome_policies.slice(0, before.auto_outcome_policies.length), before.auto_outcome_policies)
    })

    await check('dòng lịch sử khách thấy: "<câu> (FB19)" cho cả hai câu, ở cả hai thao tác', async () => {
      for (const c of V.CODES) {
        for (const a of V.ACTIONS) {
          const signal = { kind: 'block', code: c.code, errorCode: c.code, message: `Lỗi nhắn tin đến Khách Thử: ${c.title}` }
          const cls = (await db.query(`SELECT c.error_code FROM public.aka_agent_engine_classify_signal('facebook', $1, 'before_send', $2::jsonb) c`,
            [a.code, JSON.stringify(signal)])).rows[0].error_code
          assert.equal(cls, c.code)
          const p = gridAfter.get(`${c.code}|${a.code}|before_send`)
          const log = (await db.query(`SELECT public.aka_agent_engine_render($1, $2::jsonb) AS t`,
            [p.log_template, JSON.stringify({ name: 'Khách Thử', action: 'Nhắn tin', message: signal.message })])).rows[0].t
          assert.equal(log, c.title)
        }
      }
    })

    await check('apply lần hai bị từ chối (block đã khác bản đã đọc), sổ migration có V603 cũng bị từ chối', async () => {
      await rejects(db, MIGRATION, /V603: block 2855 khác bản đã đọc/)
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261120999999', '${V.NAME}')`)
      await rejects(db, MIGRATION, /V603: sổ migration đã có/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261120999999'`)
    })

    await db.query(ROLLBACK)
    const restored = await dump(db)
    await check('bản gỡ: block, bước, dấu hiệu, câu FB19, element về đúng bản trước; mã mới và 4 chính sách chỉ bị tắt', async () => {
      assert.deepEqual(restored.blocks, before.blocks)
      assert.deepEqual(restored.steps, before.steps)
      assert.deepEqual(restored.signs, before.signs)
      assert.deepEqual(restored.auto_elements, before.auto_elements)
      assert.deepEqual(restored.auto_error.filter(e => before.auto_error.some(b => b.id === e.id)), before.auto_error)
      assert.deepEqual(restored.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id)).map(e => [e.error_code, e.is_active]),
        [[V.NOT_ON_MESSENGER.code, false]])
      const extra = restored.auto_outcome_policies.slice(before.auto_outcome_policies.length)
      assert.deepEqual(extra.map(p => p.is_active), [false, false, false, false])
      assert.equal((await db.query(`SELECT code FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].code, LIVE.block.code)
      const gridRestored = await policyGrid(db)
      for (const [key, p] of gridBefore) assert.deepEqual(gridRestored.get(key), p, key)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
}

// ---------------------------------------------------------------- Chromium: chạy code block thật trên trang Messenger giả
// Bộ tìm phần tử y như PageController của Desktop (CSS hoặc XPath, chỉ lấy phần tử đang hiện).
function selectorResolverJs() {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/v2/runtime/pageController.ts'), 'utf8')
  const start = src.indexOf('const SELECTOR_RESOLVER_JS = `')
  const end = src.indexOf('\n`\n', start)
  if (start < 0 || end < 0) throw new Error('Không thấy SELECTOR_RESOLVER_JS trong pageController.ts')
  const raw = src.slice(start + 'const SELECTOR_RESOLVER_JS = `'.length, end + 1)
  if (raw.includes('${')) throw new Error('SELECTOR_RESOLVER_JS có chỗ chèn biến, cần sửa bài kiểm')
  return new Function(`return \`${raw}\``)()
}
const RESOLVER = selectorResolverJs()
// Thời gian chờ thật của block (3 + 2 + 15 giây) chia nhỏ để bài kiểm nhanh; thứ tự các lần chờ giữ nguyên.
const TIME_SCALE = 1 / 40

// Chỗ ô nhập tin theo ảnh lỗi chiến dịch 45597 (yêu cầu ảnh 9, 20/11/2026). Chưa có DOM thật (máy khách bản 10.1.0), nên dựng vài cách chia thẻ
// khác nhau cho cùng một câu. Khung "Thiếu lịch sử chat · Nhập mã PIN" có ở cả 18 ảnh, đặt ở cột trái mọi trường hợp.
const PIN_BANNER = '<div id="pin"><span>Thiếu lịch sử chat</span><span>Hãy nhập mã PIN để xem tin nhắn chưa tải được trên thiết bị này.</span><div role="button">Nhập mã PIN</div></div>'
const E2EE_OLD = 'Những tin nhắn này được gửi trước khi đoạn chat được bảo mật bằng tính năng mã hóa đầu cuối. Do đó, bạn không thể trả lời, bày tỏ cảm xúc hoặc chuyển tiếp.'
const COMPOSERS = {
  ok: '<div role="textbox" contenteditable="true" id="box" style="min-height:20px"></div>',
  notOnMessenger: '<div><div><span>Bạn A chưa thể truy cập vào đoạn chat này</span></div><div><span>Bạn sẽ có thể gửi tin nhắn trong lần tiếp theo Bạn A đăng nhập vào Messenger.</span></div></div>',
  notOnMessengerSplitName: '<div><span><strong>Bạn A</strong> chưa thể truy cập vào đoạn chat này</span><span>Bạn sẽ có thể gửi tin nhắn trong lần tiếp theo <strong>Bạn A</strong> đăng nhập vào Messenger.</span></div>',
  friendsOnly: '<div><span>Bạn không thể nhắn tin cho tài khoản này. Bạn nên thêm họ làm bạn bè trên Facebook.</span><div role="button">Thêm bạn bè</div></div>',
  friendsOnlySplit: '<div><span>Bạn không thể nhắn tin cho tài khoản này.</span> <span>Bạn nên thêm họ làm bạn bè trên Facebook.</span><div role="button">Thêm bạn bè</div></div>',
  oldE2ee: `<div><span>${E2EE_OLD}</span><div role="button" id="continue">Tiếp tục</div></div>`,
  pendingLimit: '<div><span><span>Bạn đã đạt giới hạn về số tin nhắn đang chờ</span></span></div>',
  none: ''
}
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="left"></div><div id="thread"></div><div id="composer"></div>
<script>(() => {
  const conv = window.__conv;
  document.getElementById('left').innerHTML = conv.left;
  document.getElementById('thread').innerHTML = conv.thread;
  document.getElementById('composer').innerHTML = conv.composer;
  window.__clicks = [];
  document.addEventListener('click', e => { window.__clicks.push(e.target.id || e.target.textContent); }, true);
})();</script></body></html>`

const T = { FB19: V.FB19.code, NOT_ON: V.NOT_ON_MESSENGER.code }
const TIMEOUT_MESSAGE = 'waitForSelector timeout: [role="textbox"][contenteditable="true"]'
const CASES = [
  { id: 'gửi được (có ô nhập tin)', composer: 'ok', expectOld: 'ok', expectNew: 'ok', code: null },
  { id: 'nhóm B: "<tên> chưa thể truy cập vào đoạn chat này" → FB19 (chưa đăng nhập Messenger)', composer: 'notOnMessenger',
    expectOld: TIMEOUT_MESSAGE, expectNew: V.NOT_ON_MESSENGER_MESSAGE, code: T.NOT_ON },
  { id: 'nhóm B, tên người nhận nằm ở thẻ riêng', composer: 'notOnMessengerSplitName',
    expectOld: TIMEOUT_MESSAGE, expectNew: V.NOT_ON_MESSENGER_MESSAGE, code: T.NOT_ON },
  { id: 'nhóm C: "Bạn không thể nhắn tin cho tài khoản này…" → FB19 (chỉ nhắn được cho bạn bè)', composer: 'friendsOnly',
    expectOld: TIMEOUT_MESSAGE, expectNew: V.FRIENDS_ONLY_MESSAGE, code: T.FB19 },
  { id: 'nhóm C, hai câu ở hai thẻ', composer: 'friendsOnlySplit', expectOld: TIMEOUT_MESSAGE, expectNew: V.FRIENDS_ONLY_MESSAGE, code: T.FB19 },
  { id: 'nhóm A: đoạn chat cũ trước mã hoá đầu cuối, nút "Tiếp tục" bấm không ra ô nhập → vẫn FB42 (anh chờ DOM)', composer: 'oldE2ee',
    thread: '<div role="row"><span>tin nhắn cũ</span></div>', expectOld: TIMEOUT_MESSAGE, expectNew: TIMEOUT_MESSAGE, code: null, clicksContinue: true },
  { id: 'không có ô nhập tin, không có câu nào → vẫn FB42', composer: 'none', expectOld: TIMEOUT_MESSAGE, expectNew: TIMEOUT_MESSAGE, code: null },
  { id: 'giới hạn tin nhắn đang chờ: vẫn ném err_limit_waiting_message như cũ (FB01)', composer: 'pendingLimit',
    expectOld: 'throw:err_limit_waiting_message', expectNew: 'throw:err_limit_waiting_message', code: null }
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
  await pw.setContent(PAGE_HTML.replace('const conv = window.__conv;', `const conv = ${JSON.stringify({
    left: PIN_BANNER, thread: kase.thread || '', composer: COMPOSERS[kase.composer]
  })};`))
  const elements = new Map([...LIVE.elements.map(e => [e.name, e.xpath]), ...V.ELEMENTS.map(e => [e.name, e.xpath])])
  const resolves = sel => pw.evaluate(`(function () { ${RESOLVER}; return !!resolveSelector(${JSON.stringify(sel)}); })()`)
  const page = {
    evaluate: (body, ...args) => pw.evaluate(`(async function() { var __args = ${JSON.stringify(args)}; ${body} })()`),
    waitForSelector: async (sel, opts = {}) => {
      const until = Date.now() + (opts.timeout ?? 30000) * TIME_SCALE
      while (Date.now() < until) {
        if (await resolves(sel)) return true
        await new Promise(r => setTimeout(r, 10))
      }
      throw new Error(`waitForSelector timeout: ${sel}`)
    },
    click: async sel => {
      const ok = await pw.evaluate(`(function () { ${RESOLVER}; var el = resolveSelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`)
      if (!ok) throw new Error(`click: không thấy ${sel}`)
    },
    fill: (sel, text) => pw.evaluate(`(function () { ${RESOLVER}; var el = resolveSelector(${JSON.stringify(sel)}); el.textContent = ${JSON.stringify(text)}; })()`),
    press: key => pw.evaluate(`window.__pressed = ${JSON.stringify(key)}`),
    dropFile: async () => undefined,
    getText: async () => '',
    navigate: async () => { throw new Error('không được tải lại trang trong bài kiểm') }
  }
  const helpers = {
    element: async n => { if (!elements.has(n)) throw new Error(`Element không tìm thấy: ${n}`); return elements.get(n) },
    sleep: ms => new Promise(r => setTimeout(r, Math.min(Number(ms) || 0, 20))),
    log: () => undefined,
    prepareCampaignContent: async () => ({ content: 'Xin chào', media: [], variantIndex: 0 })
  }
  const vars = { inputDataName: 'Khách Thử' }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const signal = new AbortController().signal
  try {
    const out = await new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', code)(page, helpers, vars, {}, signal)
    const clicks = await pw.evaluate(() => window.__clicks)
    if (out && out.ok === true) return { ok: true, typed: await pw.evaluate(() => document.getElementById('box').textContent), pressed: await pw.evaluate(() => window.__pressed), clicks }
    return { ok: false, error: out && out.error, clicks }
  } catch (error) {
    return { ok: false, thrown: error.code || error.message }
  }
}

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const pw = await browser.newPage()
  const signs = loadErrorSigns()
  const parsed = signs.parseFacebookErrorSigns(V.SIGNS_AFTER_JSON)
  const parsedBefore = signs.parseFacebookErrorSigns(LIVE.signs.value)
  try {
    await check('dòng dấu hiệu sau V603: Desktop đọc được đủ, thêm đúng 2 dấu hiệu cho hai thao tác nhắn tin', async () => {
      assert.equal(parsedBefore.length, JSON.parse(LIVE.signs.value).length)
      assert.equal(parsed.length, parsedBefore.length + 2)
      const added = parsed.filter(s => !parsedBefore.some(b => b.code === s.code))
      assert.deepEqual(added.map(s => [s.code, s.actions, s.replaces]), [[T.NOT_ON, V.ACTION_CODES, []], [T.FB19, V.ACTION_CODES, []]])
    })
    for (const kase of CASES) {
      await check(`block trên Messenger giả: ${kase.id}`, async () => {
        const oldRun = await runBlock(pw, LIVE.block.code, kase)
        const newRun = await runBlock(pw, V.NEW_CODE, kase)
        if (kase.expectOld === 'ok') {
          assert.equal(oldRun.ok, true); assert.equal(newRun.ok, true)
          assert.equal(newRun.typed, 'Xin chào'); assert.equal(newRun.pressed, 'Enter')
          return
        }
        if (kase.expectOld.startsWith('throw:')) {
          assert.equal(oldRun.thrown, kase.expectOld.slice(6)); assert.equal(newRun.thrown, kase.expectNew.slice(6))
          return
        }
        assert.equal(oldRun.error, kase.expectOld)
        assert.equal(newRun.error, kase.expectNew)
        if (kase.clicksContinue) {
          assert.ok(oldRun.clicks.includes('continue'), 'bản cũ có bấm "Tiếp tục"')
          assert.ok(newRun.clicks.includes('continue'), 'bản mới vẫn bấm "Tiếp tục" như cũ')
        }
        // Desktop dựng câu dòng lịch sử "Lỗi nhắn tin đến <tên>: <câu block>" (không mã), rồi dò dấu hiệu; nhắn theo UID dùng chung block.
        for (const actionCode of V.ACTION_CODES) {
          const ctx = { actionCode, phase: 'before_send', currentErrorCode: null }
          const messages = [`Lỗi nhắn tin đến Khách Thử: ${newRun.error}`, newRun.error]
          assert.equal(signs.pickFacebookErrorSign(parsed, ctx, { pageTexts: null, messages })?.code ?? null, kase.code, actionCode)
          // Trước V603 cùng trang không có dấu hiệu nào → FB42 (luật 103 theo dòng "thất bại").
          const oldMessages = [`Lỗi nhắn tin đến Khách Thử: ${oldRun.error}`, oldRun.error]
          assert.equal(signs.pickFacebookErrorSign(parsedBefore, ctx, { pageTexts: null, messages: oldMessages })?.code ?? null, null)
        }
        // Thao tác khác không nhận câu này (dấu hiệu chỉ cho hai thao tác nhắn tin).
        const other = { actionCode: 'fb_message_page_inbox_customer', phase: 'before_send', currentErrorCode: null }
        if (kase.code) assert.equal(signs.pickFacebookErrorSign(parsed, other, { pageTexts: null, messages: [newRun.error] })?.code ?? null, null)
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
