#!/usr/bin/env node
// Kiểm V591 (tách FB46 hộp thư Page thành FB26 / FB47 theo chữ Facebook ghi ở chỗ ô nhập tin; anh chốt 20/11/2026), không chạm DB thật:
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LC_ALL=C node scripts/engine-v2-facebook/v591-smoke.cjs
// 1. PostgreSQL 17 cục bộ: DB engine như production (bootstrap + V556–V559, V563, V564, V575) cộng block 2885 / danh mục bước / element đọc
//    20/11; chạy nguyên văn migration rồi so mọi quyết định chính sách trước / sau (chỉ FB26 và FB47 ở hộp thư Page được đổi), bản gỡ trả về
//    như cũ, không apply lại được.
// 2. Chromium: chạy nguyên code block 2885 (bản cũ và bản V591) trên hộp thư Page giả; chỗ ô nhập tin dựng theo HTML thật trên trang Page của
//    anh 20/11 và ảnh lỗi tổ chức 441. Câu block ném đi qua đúng bộ nhận dấu hiệu của Desktop (errorSigns.ts) với dòng dấu hiệu sau V591.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, applyV575, readMigration, ROOT } = require('./fixture.cjs')
const V = require('../build-v591-sql.cjs')

const PORT = Number(process.env.ENGINE_FB_V591_PORT || 55591)
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

const FB_ACTIONS = [['fb_message_page_inbox_customer', 'facebook_page_to_message'], ['fb_post_group', 'facebook_group_post'],
  ['fb_comment', 'facebook_comment_seeding'], ['fb_message', 'facebook_message_uid'], ['fb_add_friend', 'facebook_add_friend'],
  ['fb_post_page', 'facebook_page_post'], ['fb_join_group', 'facebook_join_group']]
const PHASES = ['before_send', 'in_flight', 'after_send']

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

/** Thêm vào DB thử đúng phần production mà V591 đọc: block 2679 / 2885, sổ chép, dòng danh mục bước 20, bảng auto_elements (12 element FbPageInbox*). */
async function seedPageInbox(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS public.auto_elements (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, xpath text NOT NULL, description text,
    category text, is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now())`)
  for (const e of LIVE.elements) {
    await db.query(`INSERT INTO public.auto_elements (id, name, xpath, description, category, is_builtin) VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.id, e.name, e.xpath, e.description, e.category, e.is_builtin])
  }
  await db.query(`SELECT setval(pg_get_serial_sequence('public.auto_elements', 'id'), 2000)`)
  await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, 'fb_send_page_inbox_message', $3, 'facebook'), ($2, $4, $3, 'facebook')`,
    [V.BLOCK.sourceId, V.BLOCK.id, LIVE.block.code, V.BLOCK.name])
  await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy) VALUES ($1, $2, $3, $3)`,
    [V.BLOCK.id, V.BLOCK.sourceId, V.BLOCK.oldMd5])
  await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops, result_mode, reviewed_code_md5, note)
    VALUES ($1, $2, 'delivery', $3, 1, '[]'::jsonb, 'action_result', $4, $5)`, [V.STEP.id, V.BLOCK.id, V.ACTION, V.BLOCK.oldMd5, LIVE.step.note])
}

async function sqlChecks() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v591-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    for (const name of FACEBOOK_POLICY_MIGRATIONS) await db.query(readMigration(name))
    await applyV563(db)
    await applyV575(db)
    await seedPageInbox(db)
    // DB thử dựng từ migration: câu FB26 như production (V346 ghi customer_title qua V559).
    const fb26 = (await db.query(`SELECT customer_title, customer_help, is_active FROM public.auto_error WHERE error_code = $1`, [V.FB26.code])).rows[0]

    await check('DB thử khớp các điểm migration kiểm trước (dấu hiệu sau V575, mã FB26, block 2885)', async () => {
      assert.equal((await db.query(`SELECT md5(value) AS m FROM public.auto_system_settings WHERE key = 'facebook.error_signs'`)).rows[0].m, V.SIGNS_BEFORE_MD5)
      assert.deepEqual(fb26, { customer_title: V.FB26.oldTitle, customer_help: null, is_active: true })
      assert.equal((await db.query(`SELECT md5(code) AS m FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].m, V.BLOCK.oldMd5)
    })

    const before = await dump(db)
    const gridBefore = await policyGrid(db)
    await check('bản gỡ từ chối khi V591 chưa apply', async () => { await rejects(db, ROLLBACK, /Gỡ V591: block 2885 khác bản V591/) })

    await db.query(MIGRATION)
    const after = await dump(db)
    const gridAfter = await policyGrid(db)

    await check('apply: chỉ chính sách FB26 / FB47 ở hộp thư Page đổi, mọi quyết định khác giữ nguyên', async () => {
      const changed = []
      for (const [key, p] of gridAfter) {
        if (!gridBefore.has(key)) { changed.push(key); continue }
        if (JSON.stringify(p) !== JSON.stringify(gridBefore.get(key))) changed.push(key)
      }
      const expected = [V.FB26.code, V.FB47.code].flatMap(code => FB_ACTIONS.flatMap(([a]) => PHASES.map(ph => `${code}|${a}|${ph}`)))
        .filter(key => key.startsWith(V.FB26.code + '|fb_message_page_inbox_customer|') || key.startsWith(V.FB47.code + '|'))
      // FB47 là mã mới: mọi thao tác đều "mới"; ở thao tác khác chính sách gộp của nó là chính sách lớp account_restricted (không phát ở đó).
      assert.deepEqual(changed.sort(), expected.sort())
      for (const ph of PHASES) {
        const p26 = gridAfter.get(`${V.FB26.code}|fb_message_page_inbox_customer|${ph}`)
        assert.equal(p26.target_effect, 'complete'); assert.equal(p26.target_streak_effect, 'ignore'); assert.equal(p26.campaign_effect, 'none')
        assert.equal(p26.quota_effect, 'no_count'); assert.equal(String(p26.detail_status_id), '21'); assert.equal(p26.log_template, V.FB26.title)
        const p47 = gridAfter.get(`${V.FB47.code}|fb_message_page_inbox_customer|${ph}`)
        assert.equal(p47.target_effect, 'complete'); assert.equal(p47.campaign_effect, 'pause'); assert.equal(p47.streak_threshold ?? null, null)
        assert.equal(p47.target_streak_effect, 'ignore'); assert.equal(p47.quota_effect, 'no_count'); assert.equal(p47.run_effect, 'end_unit')
        assert.equal(p47.campaign_note_template, `${V.FB47.title} (FB47). ${V.FB47.help}`)
      }
    })

    await check('apply: dữ liệu đổi đúng chỗ (2 element, block 2885, bước 20, dấu hiệu, câu FB26, mã FB47, 2 chính sách)', async () => {
      assert.deepEqual(after.auto_elements.filter(e => !before.auto_elements.some(b => b.name === e.name)),
        V.ELEMENTS.map(e => ({ name: e.name, xpath: e.xpath })).sort((a, b) => a.name.localeCompare(b.name)))
      assert.equal(after.auto_elements.length, before.auto_elements.length + 2)
      assert.deepEqual(after.blocks.filter(b => b.id !== V.BLOCK.id), before.blocks.filter(b => b.id !== V.BLOCK.id))
      assert.equal(after.blocks.find(b => b.id === V.BLOCK.id).md5, V.NEW_MD5)
      assert.equal(after.steps.find(s => s.id === V.STEP.id).reviewed_code_md5, V.NEW_MD5)
      assert.equal(after.signs[0].value, V.SIGNS_AFTER_JSON)
      const newErrors = after.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id))
      assert.deepEqual(newErrors.map(e => [e.error_code, e.public_code, e.customer_title, e.customer_help, e.error_class]),
        [[V.FB47.code, 'FB47', V.FB47.title, V.FB47.help, 'account_restricted']])
      const changedErrors = after.auto_error.filter(e => { const b = before.auto_error.find(x => x.id === e.id); return b && JSON.stringify(b) !== JSON.stringify(e) })
      assert.deepEqual(changedErrors.map(e => [e.error_code, e.customer_title]), [[V.FB26.code, V.FB26.title]])
      assert.equal(after.auto_outcome_policies.length, before.auto_outcome_policies.length + 2)
      assert.deepEqual(after.auto_outcome_policies.slice(0, before.auto_outcome_policies.length), before.auto_outcome_policies)
    })

    await check('apply lần hai bị từ chối (block đã khác bản đã đọc), sổ migration có V591 cũng bị từ chối', async () => {
      await rejects(db, MIGRATION, /V591: block 2885 khác bản đã đọc/)
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261120999999', '${V.NAME}')`)
      await rejects(db, MIGRATION, /V591: sổ migration đã có/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261120999999'`)
    })

    await db.query(ROLLBACK)
    const restored = await dump(db)
    await check('bản gỡ: block, bước, dấu hiệu, câu FB26, element về đúng bản trước; FB47 và 2 chính sách chỉ bị tắt', async () => {
      assert.deepEqual(restored.blocks, before.blocks)
      assert.deepEqual(restored.steps, before.steps)
      assert.deepEqual(restored.signs, before.signs)
      assert.deepEqual(restored.auto_elements, before.auto_elements)
      assert.deepEqual(restored.auto_error.filter(e => before.auto_error.some(b => b.id === e.id)), before.auto_error)
      assert.deepEqual(restored.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id)).map(e => [e.error_code, e.is_active]), [[V.FB47.code, false]])
      const extra = restored.auto_outcome_policies.slice(before.auto_outcome_policies.length)
      assert.deepEqual(extra.map(p => [p.error_code, p.is_active]), [[V.FB26.code, false], [V.FB47.code, false]])
      assert.equal((await db.query(`SELECT code FROM public.auto_blocks WHERE id = $1`, [V.BLOCK.id])).rows[0].code, LIVE.block.code)
      const gridRestored = await policyGrid(db)
      for (const [key, p] of gridBefore) assert.deepEqual(gridRestored.get(key), p, key)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
}

// ---------------------------------------------------------------- Chromium: chạy code block thật trên hộp thư Page giả
// Chỗ ô nhập tin theo HTML thật (trang Page của anh 20/11/2026, chỉ bỏ bớt class) và ảnh lỗi tổ chức 441 (câu xác nhận danh tính).
const COMPOSERS = {
  ok: `<div role="textbox" contenteditable="true" id="box"></div><div role="button" id="send">Gửi</div>`,
  cannot: `<div class="x2b8uid x9orja2 x5zjp28 xbaz6xv"><span class="x1vvvo52 x1fvot60 xo1l8bm xxio538">Bạn không thể gửi tin nhắn cho người này nữa. </span><a data-interactable="|click|" class="x1i10hfl x1qjc9v5">Tìm hiểu thêm</a></div>`,
  identity: `<div class="x2b8uid x9orja2"><span class="x1vvvo52 x1fvot60">Hãy xác nhận danh tính để gửi tin nhắn. Một số hành động đã bị hạn chế do có hoạt động bất thường. </span><a data-interactable="|click|" class="x1i10hfl">Cách xác nhận</a></div>`,
  none: ``
}
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="leftBanner"></div>
<i class="img sp_eC3AlU9C1ar_1_5x sx_122ae6" id="searchBtn"></i>
<input placeholder="Tìm kiếm" id="search">
<div aria-label="Xóa" id="clear" style="display:none">x</div>
<div class="_7znk" id="results"></div>
<div class="uiScrollableAreaContent"><div role="presentation">Hội thoại</div></div>
<div data-pagelet="BizInboxDetailViewHeaderSectionWrapper"><span class="_4ik4 _4ik5" id="header"></span></div>
<div id="thread"></div><div id="composer"></div><div id="overlay"></div>
<script>(() => {
  // setContent dùng lại cửa sổ cũ (document.open) nên khai báo trong IIFE để lần dựng sau không trùng tên biến.
  window.__sent = null; window.__typed = '';
  const conv = window.__conv;
  const search = document.getElementById('search'), clear = document.getElementById('clear'), results = document.getElementById('results');
  const render = () => {
    clear.style.display = search.value ? 'block' : 'none';
    results.innerHTML = search.value && conv.name.toLowerCase().includes(search.value.toLowerCase()) ? '<span>' + conv.name + '</span>' : '';
  };
  search.addEventListener('input', render);
  clear.addEventListener('click', () => { search.value = ''; render(); });
  results.addEventListener('mouseup', () => {
    document.getElementById('header').textContent = conv.name;
    document.getElementById('thread').innerHTML = conv.thread;
    document.getElementById('composer').innerHTML = conv.composer;
    document.getElementById('overlay').innerHTML = conv.overlay;
    document.getElementById('leftBanner').innerHTML = conv.banner;
    const box = document.getElementById('box');
    if (box) box.addEventListener('paste', e => { window.__typed = e.clipboardData.getData('text/plain'); });
    const send = document.getElementById('send');
    if (send) send.addEventListener('click', () => { window.__sent = window.__typed; });
  });
})();</script></body></html>`
const CASES = [
  { id: 'gửi được', composer: 'ok', expectOld: 'ok', expectNew: 'ok', code: null },
  { id: 'FB26: câu thật trên trang Page của anh', composer: 'cannot', expectOld: 'Không tìm thấy ô để nhập tin nhắn', expectNew: V.CANNOT_SEND_MESSAGE, code: V.FB26.code },
  { id: 'FB47: câu xác nhận danh tính, có hộp Business Agent đè lên và dải đỏ cột trái', composer: 'identity', overlay: true, banner: true,
    expectOld: 'Không tìm thấy ô để nhập tin nhắn', expectNew: V.IDENTITY_MESSAGE, code: V.FB47.code },
  { id: 'không có ô nhập tin, không có câu nào: vẫn FB46', composer: 'none', expectOld: 'Không tìm thấy ô để nhập tin nhắn', expectNew: 'Không tìm thấy ô để nhập tin nhắn', code: V.FB46.code },
  { id: 'tin nhắn trong hội thoại bắt đầu bằng câu đó: không nhận nhầm FB26', composer: 'none', bubble: 'Bạn không thể gửi tin nhắn cho người này nữa à? Sao vậy',
    expectOld: 'Không tìm thấy ô để nhập tin nhắn', expectNew: 'Không tìm thấy ô để nhập tin nhắn', code: V.FB46.code }
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
  const name = 'Khách Thử'
  await pw.setContent(PAGE_HTML.replace('const conv = window.__conv;', `const conv = ${JSON.stringify({
    name, composer: COMPOSERS[kase.composer],
    thread: kase.bubble ? `<div><span class="x193iq5w">${kase.bubble}</span></div>` : '<div><span class="x193iq5w">hi</span></div>',
    overlay: kase.overlay ? '<div role="dialog"><span>Thẻ mới cho Business Agent trong Hộp thư</span><div role="button">Đóng</div><div role="button">OK</div></div>' : '',
    banner: kase.banner ? '<div role="alert"><span>Xác nhận danh tính để gửi tin nhắn</span></div>' : ''
  })};`))
  const elements = new Map([...LIVE.elements.map(e => [e.name, e.xpath]), ...V.ELEMENTS.map(e => [e.name, e.xpath])])
  const page = {
    evaluate: (body, ...args) => pw.evaluate(`(async function() { var __args = ${JSON.stringify(args)}; ${body} })()`),
    navigate: async () => { throw new Error('không được tải lại trang trong bài kiểm') }
  }
  const helpers = {
    element: async n => { if (!elements.has(n)) throw new Error(`Element không tìm thấy: ${n}`); return elements.get(n) },
    sleep: ms => new Promise(r => setTimeout(r, Math.min(Number(ms) || 0, 30))),
    log: () => undefined,
    prepareCampaignContent: async () => ({ content: 'Xin chào', media: [], variantIndex: 0 })
  }
  const vars = { inputDataName: name, facebookStepMs: 0, pageInboxPageUid: '1' }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  try {
    const out = await new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', code)(page, helpers, vars, {}, undefined)
    return { ok: out && out.ok === true, out, sent: await pw.evaluate(() => window.__sent) }
  } catch (error) {
    return { ok: false, error: error.message }
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
    await check('dòng dấu hiệu sau V591: Desktop đọc được đủ, thêm đúng 2 dấu hiệu', async () => {
      assert.equal(parsed.length, parsedBefore.length + 2)
      assert.deepEqual(parsed.filter(s => !parsedBefore.some(b => b.code === s.code)).map(s => s.code), [V.FB47.code, V.FB26.code])
    })
    for (const kase of CASES) {
      await check(`block trên hộp thư Page giả: ${kase.id}`, async () => {
        const oldRun = await runBlock(pw, LIVE.block.code, kase)
        const newRun = await runBlock(pw, V.NEW_CODE, kase)
        if (kase.expectOld === 'ok') {
          assert.equal(oldRun.ok, true); assert.equal(newRun.ok, true)
          assert.equal(newRun.sent, 'Xin chào')
          return
        }
        assert.equal(oldRun.error, kase.expectOld)
        assert.equal(newRun.error, kase.expectNew)
        // Desktop dựng câu dòng lịch sử "Lỗi nhắn tin khách inbox page đến <tên>: <câu block>", mã err_undefined, rồi dò dấu hiệu.
        const ctx = { actionCode: V.ACTION, phase: 'in_flight', currentErrorCode: 'err_undefined' }
        const messages = [`Lỗi nhắn tin khách inbox page đến Khách Thử: ${newRun.error}`, newRun.error]
        assert.equal(signs.pickFacebookErrorSign(parsed, ctx, { pageTexts: null, messages })?.code ?? null, kase.code)
        // Trước V591 cùng trang chỉ ra FB46.
        const oldMessages = [`Lỗi nhắn tin khách inbox page đến Khách Thử: ${oldRun.error}`]
        assert.equal(signs.pickFacebookErrorSign(parsedBefore, ctx, { pageTexts: null, messages: oldMessages })?.code ?? null, V.FB46.code)
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
