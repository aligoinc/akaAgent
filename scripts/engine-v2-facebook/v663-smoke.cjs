// V663 (engine v2 Facebook, 26/11/2026, câu 605 / 2843 / 637 / 632 / 609 / 610 / 3186 của bộ kiểm lỗi): block đọc / chuyển danh tính Page.
//   1. Bộ sinh: code mới dựng được, chữ NFC, câu lỗi giữ nguyên, code cũ = block 2879 / 2880 production (= bộ cũ 2670 / 2671, đọc 26/11).
//   2. Chạy đúng code block (bản production và bản V663) trong Chromium trên trang chủ Facebook giả có menu tài khoản tải chậm như ảnh + DOM lỗi
//      26/11 (menu mở ra còn khung xám, nội dung tới sau), nút menu có sau khi trang tải, danh sách trang cá nhân tải sau khi bấm xem tất cả, ô tìm
//      kiếm trang. Bản production hỏng đúng các câu FB06 của ca (tái hiện); bản V663 chạy được, vẫn ra đúng câu cũ khi phần tử không bao giờ có;
//      đang ở sẵn Page mà danh sách không có mục để chọn lại thì coi là đang dùng sẵn (câu 3186), còn trang cá nhân trùng tên Page vẫn bấm Page.
//   3. SQL trên PG17: preflight từ chối khi block / bộ cũ / danh mục bước / element / chính sách / mã / sổ lệch; apply đổi đúng 2 block, dòng danh
//      mục bước 24, câu chính sách 284 và tên mã FB06, cách xử lý FB06 không đổi; apply lại bị từ chối; gỡ về đúng bản production.
// Chạy: CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-facebook/v663-smoke.cjs
//   V663_ONLY=chromium | sql: chỉ chạy một phần. V663_EXPECT_NEW_ON_OLD=1: chạy kỳ vọng của bản V663 trên code production (phải hỏng).
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPageAdapter } = require('./fb-group-fake.cjs')
const { homePage, CASES } = require('./v663-fake-home.cjs')

const ROOT = path.resolve(__dirname, '../..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v663-live-20261126.json'), 'utf8'))
const V = require('../build-v663-sql.cjs')
const PORT = Number(process.env.FB_V663_TEST_PORT || 55663)
const ONLY = process.env.V663_ONLY || ''
const EXPECT_NEW_ON_OLD = process.env.V663_EXPECT_NEW_ON_OLD === '1'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function runBlock(browser, code, cfg, { vars = {}, input = {}, abortAfterMs = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route('https://**/*', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: homePage(cfg) }))
  const pw = await context.newPage()
  const ops = []
  const adapter = createPageAdapter(pw, ops)
  // Như PageController: type(selector, text, { clearFirst }) chờ ô nhập tối đa 15 giây (hết giờ: "waitForSelector timeout: <selector>"), thay
  // chữ trong ô; ghi lại để biết block có gõ ô tìm kiếm không.
  const page = { ...adapter, async type(selector, text) {
    ops.push({ op: 'type' })
    try { await pw.locator('xpath=' + selector).first().fill(text, { timeout: 15000 }) } catch { throw new Error(`waitForSelector timeout: ${selector}`) }
  } }
  const controller = new AbortController()
  if (abortAfterMs !== null) setTimeout(() => controller.abort(), abortAfterMs)
  const logs = []
  const helpers = {
    async element(name) { if (!LIVE.elements[name]) throw new Error(`thiếu element ${name}`); return LIVE.elements[name] },
    // Chờ thật (để bản production ngủ đúng 1,5 giây như trên máy khách); lần nghỉ dài sau khi đã bấm chọn Page (stepMs + 7000) rút ngắn.
    async sleep(ms, signal) {
      if (signal?.aborted) throw new Error('Block bị huỷ trước khi sleep')
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms > 3000 ? 50 : ms)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Block bị huỷ trong khi sleep')) }, { once: true })
      })
    },
    log(message) { logs.push(String(message)) }
  }
  const varsObj = { facebookStepMs: 1000, ...vars }
  const sandbox = vm.createContext({ input: { ...input }, page, vars: varsObj, helpers, signal: controller.signal, console, setTimeout, clearTimeout })
  const started = Date.now()
  let out
  try {
    out = JSON.parse(JSON.stringify(await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox)))
  } catch (error) {
    out = { thrown: String(error && error.message || error) }
  }
  const state = await pw.evaluate(() => ({ switched: window.__switched, typed: window.__typed, opens: window.__opens,
    expanded: document.querySelector('[aria-label="Tài khoản, trang cá nhân của bạn"]')?.getAttribute('aria-expanded') ?? null }))
    .catch(() => ({}))
  await context.close()
  return { out, ops, logs, vars: JSON.parse(JSON.stringify(varsObj)), state, ms: Date.now() - started }
}


async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  try {
    const codes = { get: { production: LIVE.blocks.get.code, V663: V.GET.newCode }, switch: { production: LIVE.blocks.switch.code, V663: V.SWITCH.newCode } }
    const runs = EXPECT_NEW_ON_OLD ? [['production', 'new']] : [['production', 'old'], ['V663', 'new']]
    // Chạy song song (mỗi ca một context): ca hỏng của bản V663 chờ tới hết giờ thật (10–20 giây).
    const jobs = []
    for (const [label, expectKey] of runs) {
      for (const c of CASES) {
        const expect = c[expectKey]
        if (!expect) continue
        jobs.push(runBlock(browser, codes[c.block][label], c.cfg, c.opts).then(res => ({ label, c, expect, res })))
      }
    }
    for (const { label, c, expect, res } of await Promise.all(jobs)) {
      await check(`${label} · ${c.block} · ${c.key}: ${c.why}`, async () => expect(res))
    }
  } finally {
    await browser.close()
  }
}

// ------------------------------------------------------------------------------------------------ SQL trên PG17
async function sqlChecks() {
  const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
  const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, readMigration } = require('./fixture.cjs')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v663-', timeoutMs: 600_000 })
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
  const fb06 = async () => one(`SELECT p.id, p.log_template, p.campaign_note_template, p.campaign_effect, p.target_effect, p.target_streak_effect, p.quota_effect,
      p.run_effect, p.remaining_steps, p.is_active, e.customer_title, e.customer_help, e.public_code
    FROM public.auto_outcome_policies p JOIN public.auto_error e ON e.error_code = p.error_code
    WHERE p.id = ${V.POLICY.id} AND e.id = ${V.ERROR.id}`)
  const S = LIVE.sources, B = LIVE.blocks
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    await db.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text)`)
    // Mã số như production: chính sách FB06 (V559) = 284, mã FB06 = auto_error 65.
    const moveId = async (table, where, id) => {
      const row = await one(`SELECT id FROM public.${table} WHERE ${where}`)
      if (Number(row.id) === id) return
      await db.query(`UPDATE public.${table} SET id = (SELECT max(id) + 1000 FROM public.${table}) WHERE id = $1`, [id])
      await db.query(`UPDATE public.${table} SET id = $1 WHERE ${where}`, [id])
    }
    await moveId('auto_outcome_policies', `error_code = 'err_fb_identity_switch_failed' AND source = 'v559_fb_draft'`, V.POLICY.id)
    await moveId('auto_error', `error_code = 'err_fb_identity_switch_failed' AND NOT is_delete`, V.ERROR.id)
    await db.query(`CREATE TABLE IF NOT EXISTS public.auto_elements (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, xpath text NOT NULL, description text,
      category text, is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now())`)
    for (const [i, [name, xpath]] of Object.entries(LIVE.elements).entries()) {
      await db.query(`INSERT INTO public.auto_elements (id, name, xpath, category) VALUES ($1, $2, $3, 'facebook')`, [1536 + i, name, xpath])
    }
    // Cặp block như production (V560 chép 2670 → 2879, 2671 → 2880), dòng danh mục bước 24 (2880, session), thêm một block khác để kiểm không bị đụng.
    await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, $2, $3, 'facebook'), ($4, $5, $6, 'facebook'), ($7, $8, $3, 'facebook'),
      ($9, $10, $6, 'facebook'), (2851, '[engine] fb_comment_at_position', 'return 1', 'facebook')`,
    [S.get.id, S.get.name, B.get.code, S.switch.id, S.switch.name, B.switch.code, B.get.id, B.get.name, B.switch.id, B.switch.name])
    for (const c of LIVE.copies) {
      await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy)
        VALUES ($1, $2, $3, $4)`, [c.engineBlockId, c.sourceBlockId, c.sourceMd5AtCopy, c.engineMd5AtCopy])
    }
    await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops, reviewed_code_md5)
      VALUES ($1, $2, 'session', NULL, 1, '[]'::jsonb, $3)`, [V.STEP.id, B.switch.id, V.STEP.reviewedMd5])
    const other = await blockMd5(2851)
    const before = await fb06()

    await check('DB thử có đúng production đọc 26/11: block 2879 / 2880 = bộ cũ, dòng danh mục bước 24, chính sách 284 và mã FB06 câu cũ', async () => {
      assert.equal(await blockMd5(B.get.id), V.GET.oldMd5); assert.equal(await blockMd5(B.switch.id), V.SWITCH.oldMd5)
      assert.equal(await blockMd5(S.get.id), S.get.md5); assert.equal(await blockMd5(S.switch.id), S.switch.md5)
      assert.equal(before.log_template, V.OLD_LOG); assert.equal(before.campaign_note_template, V.OLD_NOTE); assert.equal(before.customer_title, V.OLD_TITLE)
      assert.equal(before.campaign_effect, 'pause'); assert.equal(before.public_code, 'FB06')
    })

    await check('preflight: block / bộ cũ / danh mục bước / element / chính sách / mã / sổ lệch thì từ chối, không đổi gì', async () => {
      const restoreBlock = async (id, code) => db.query(`UPDATE public.auto_blocks SET code = $1 WHERE id = $2`, [code, id])
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [B.switch.id])
      await expectRefused(migration, /không còn đúng bản production/)
      await restoreBlock(B.switch.id, B.switch.code)
      await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [S.get.id])
      await expectRefused(migration, /block bộ cũ 2670 \/ 2671 khác bản đã đọc/)
      await restoreBlock(S.get.id, B.get.code)
      await db.query(`UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '00000000000000000000000000000000' WHERE id = $1`, [V.STEP.id])
      await expectRefused(migration, /danh mục bước của block 2879 \/ 2880 khác bản đã đọc/)
      await db.query(`UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = $1 WHERE id = $2`, [V.STEP.reviewedMd5, V.STEP.id])
      await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops) VALUES (9663, $1, 'result', NULL, 1, '[]'::jsonb)`, [B.get.id])
      await expectRefused(migration, /danh mục bước của block 2879 \/ 2880 khác bản đã đọc/)
      await db.query(`DELETE FROM public.auto_engine_block_steps WHERE id = 9663`)
      await db.query(`UPDATE public.auto_elements SET xpath = xpath || ' ' WHERE name = 'FbIdentitySeeAllButton'`)
      await expectRefused(migration, /element danh tính Facebook/)
      await db.query(`UPDATE public.auto_elements SET xpath = $1 WHERE name = 'FbIdentitySeeAllButton'`, [LIVE.elements.FbIdentitySeeAllButton])
      await db.query(`UPDATE public.auto_outcome_policies SET campaign_note_template = campaign_note_template || ' ' WHERE id = $1`, [V.POLICY.id])
      await expectRefused(migration, /chính sách 284 \(FB06\) khác bản đã đọc/)
      await db.query(`UPDATE public.auto_outcome_policies SET campaign_note_template = $1 WHERE id = $2`, [V.OLD_NOTE, V.POLICY.id])
      // Dòng FB06 thứ hai đang bật (cùng khoá khớp) bị chặn sẵn bởi chỉ mục duy nhất auto_outcome_policies_match_v495: không dựng được để kiểm.
      await db.query(`UPDATE public.auto_error SET customer_title = 'khác' WHERE id = $1`, [V.ERROR.id])
      await expectRefused(migration, /mã FB06 \(auto_error 65\) khác bản đã đọc/)
      await db.query(`UPDATE public.auto_error SET customer_title = $1 WHERE id = $2`, [V.OLD_TITLE, V.ERROR.id])
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('29990101000000', 'migration_v663_thu')`)
      await expectRefused(migration, /V663 đã có trong sổ migration/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '29990101000000'`)
      assert.equal(await blockMd5(B.get.id), V.GET.oldMd5); assert.equal(await blockMd5(B.switch.id), V.SWITCH.oldMd5)
      assert.deepEqual(await fb06(), before)
    })

    await check('apply: 2 block = bản V663, dòng danh mục bước 24 theo code mới, câu FB06 mới; cách xử lý FB06, bộ cũ, sổ chép, block khác không đổi; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [B.get.id])).code, V.GET.newCode)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [B.switch.id])).code, V.SWITCH.newCode)
      assert.equal(await blockMd5(S.get.id), S.get.md5, 'bộ cũ không đổi'); assert.equal(await blockMd5(S.switch.id), S.switch.md5)
      assert.equal(await blockMd5(2851), other, 'block khác không đổi')
      assert.equal((await one(`SELECT reviewed_code_md5 FROM public.auto_engine_block_steps WHERE id = $1`, [V.STEP.id])).reviewed_code_md5, V.SWITCH.newMd5)
      const after = await fb06()
      assert.deepEqual({ ...after, log_template: before.log_template, campaign_note_template: before.campaign_note_template, customer_title: before.customer_title }, before,
        'chỉ đổi câu, cách xử lý giữ nguyên')
      assert.equal(after.log_template, 'Không chuyển được sang Page đã chọn')
      assert.equal(after.campaign_note_template, 'Không chuyển được sang Page đã chọn (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.')
      assert.equal(after.customer_title, 'Không chuyển được sang Page đã chọn')
      assert.deepEqual((await q(`SELECT engine_block_id, engine_md5_at_copy FROM public.auto_engine_block_copies WHERE engine_block_id IN (2879, 2880) ORDER BY 1`))
        .map(r => [Number(r.engine_block_id), r.engine_md5_at_copy]), LIVE.copies.map(c => [c.engineBlockId, c.engineMd5AtCopy]))
      await expectRefused(migration, /không còn đúng bản production/)
    })

    await check('gỡ: về đúng bản production (block, danh mục bước, câu FB06); gỡ lại bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [B.get.id])).code, B.get.code)
      assert.equal((await one(`SELECT code FROM public.auto_blocks WHERE id = $1`, [B.switch.id])).code, B.switch.code)
      assert.equal((await one(`SELECT reviewed_code_md5 FROM public.auto_engine_block_steps WHERE id = $1`, [V.STEP.id])).reviewed_code_md5, V.SWITCH.oldMd5)
      assert.deepEqual(await fb06(), before)
      await expectRefused(rollback, /không phải bản V663/)
      await db.query(migration)
      assert.equal(await blockMd5(B.switch.id), V.SWITCH.newMd5)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}

async function main() {
  await check('bộ sinh: code cũ = block 2879 / 2880 production (= bộ cũ, đọc 26/11); code mới dựng được, chữ NFC, câu lỗi giữ nguyên', async () => {
    assert.equal(md5(LIVE.blocks.get.code), LIVE.blocks.get.md5); assert.equal(md5(LIVE.blocks.switch.code), LIVE.blocks.switch.md5)
    assert.equal(LIVE.blocks.get.md5, LIVE.sources.get.md5); assert.equal(LIVE.blocks.switch.md5, LIVE.sources.switch.md5)
    for (const block of [V.GET, V.SWITCH]) {
      assert.equal(md5(block.newCode), block.newMd5); assert.equal(block.newCode.normalize('NFC'), block.newCode)
      new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${block.newCode}\n})`)
      assert.ok(!/helpers\.sleep\(stepMs \+ 500, signal\)\n\n?\s*const (seeAll|identityName) =/.test(block.newCode), 'không còn ngủ cố định rồi đọc / bấm một lần')
    }
    const migration = fs.readFileSync(path.join(ROOT, `migrations/${V.NAME}.sql`), 'utf8')
    const rollback = fs.readFileSync(path.join(ROOT, `migrations/${V.ROLLBACK_NAME}.sql`), 'utf8')
    assert.equal(migration, V.migration, 'tệp migration khớp bộ sinh (chạy lại node scripts/build-v663-sql.cjs)')
    assert.equal(rollback, V.rollback, 'tệp gỡ khớp bộ sinh')
  })
  if (ONLY !== 'sql') await chromiumChecks()
  if (ONLY !== 'chromium' && !EXPECT_NEW_ON_OLD) await sqlChecks()
  console.log(`\n${checks} kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
