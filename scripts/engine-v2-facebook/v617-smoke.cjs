#!/usr/bin/env node
// Kiểm V617 (đăng ẩn danh: có công tắc mà không bật được → FB52 thay cho SYS99; anh chốt 21/11/2026), không chạm DB thật:
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LC_ALL=C node scripts/engine-v2-facebook/v617-smoke.cjs
// 1. PostgreSQL 17 cục bộ: DB như v616-smoke, apply nguyên văn V616 rồi V617; chỉ FB52 đổi quyết định (= FB49 ở đăng nhóm trừ lớp lỗi), block 2923
//    đổi đúng code, không apply lại được, bản gỡ trả block về V616 và tắt mã / chính sách.
// 2. Chromium: code block bản V617 trên hộp Tạo bài viết giả (dựng như v616-smoke): mọi ca bật được / không có công tắc như V616; không bật được
//    thì trả FB52 kèm ok: false (engine chụp ảnh + DOM), không ném lỗi.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, applyV575, applyV591, applyV597, readMigration } = require('./fixture.cjs')
const V616 = require('../build-v616-sql.cjs')
const V = require('../build-v617-sql.cjs')
const S = require('./v616-smoke.cjs')

const PORT = Number(process.env.ENGINE_FB_V617_PORT || 55617)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const MIGRATION = readMigration(`${V.NAME}.sql`)
const ROLLBACK = readMigration(`${V.ROLLBACK_NAME}.sql`)
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

async function sqlChecks() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v617-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    for (const name of FACEBOOK_POLICY_MIGRATIONS) await db.query(readMigration(name))
    await applyV563(db)
    await applyV575(db)
    await applyV591(db)
    await applyV597(db)
    await S.seedWorkflows(db)
    await db.query(readMigration(`${V616.NAME}.sql`))

    await check('DB thử khớp điểm V617 kiểm trước (block 2923 bản V616, FB lớn nhất FB51, FB49 như production đọc 21/11)', async () => {
      const b = (await db.query(`SELECT id, md5(code) AS m FROM public.auto_blocks WHERE name = $1`, [V616.BLOCK_NAME])).rows[0]
      // DB thử cấp id block theo sequence riêng: migration kiểm theo id production 2923, nên đổi id cho khớp.
      if (Number(b.id) !== V.BLOCK.id) {
        await db.query(`UPDATE public.auto_workflows SET nodes = (SELECT jsonb_agg(CASE WHEN n->>'id' = 'enable_anonymous' THEN jsonb_set(n, '{blockId}', to_jsonb($1::bigint)) ELSE n END ORDER BY o)
          FROM jsonb_array_elements(nodes) WITH ORDINALITY x(n, o)) WHERE id = 321`, [V.BLOCK.id])
        await db.query(`UPDATE public.auto_blocks SET id = $2 WHERE id = $1`, [b.id, V.BLOCK.id])
      }
      assert.equal(b.m, V.BLOCK.md5)
      assert.equal((await db.query(`SELECT max(substring(public_code from 3)::int) AS n FROM public.auto_error WHERE public_code ~ '^FB[0-9]+$'`)).rows[0].n, 51)
      for (const ph of V.PHASES) {
        const p = (await db.query(`SELECT public.aka_agent_engine_resolve_policy($1, NULL, 'fb_post_group', 'facebook_group_post', 'desktop', $2)
          - 'policy_ids' - 'revisions' AS p`, [V.FB49_CODE, ph])).rows[0].p
        assert.deepEqual(p, V.LIVE.fb49Resolved[ph], ph)
      }
    })

    const before = await S.dump(db)
    const gridBefore = await S.policyGrid(db)
    await check('bản gỡ từ chối khi V617 chưa apply', async () => { await rejects(db, ROLLBACK, /Gỡ V617: block 2923 không phải bản V617/) })

    await db.query(MIGRATION)
    const after = await S.dump(db)
    const gridAfter = await S.policyGrid(db)

    await check('apply: chỉ FB52 có chính sách mới; FB52 = FB49 ở đăng nhóm (trừ lớp lỗi); mọi quyết định khác giữ nguyên', async () => {
      const changed = []
      for (const [key, p] of gridAfter) if (!gridBefore.has(key) || JSON.stringify(p) !== JSON.stringify(gridBefore.get(key))) changed.push(key)
      assert.deepEqual(changed.sort(), S.FB_ACTIONS.flatMap(([a]) => V.PHASES.map(ph => `${V.FB52.code}|${a}|${ph}`)).sort())
      for (const ph of V.PHASES) {
        const { error_class: c52, requeue_after_minutes: r52, ...p52 } = gridAfter.get(`${V.FB52.code}|fb_post_group|${ph}`)
        const { error_class: c49, requeue_after_minutes: r49, ...p49 } = gridAfter.get(`${V.FB49_CODE}|fb_post_group|${ph}`)
        assert.deepEqual(p52, p49, ph)
        assert.deepEqual([c52, c49], ['ui_changed', 'transient'])
        // Lớp ui_changed có requeue_after_minutes 60 (dòng chung), chỉ có tác dụng với target_effect 'requeue_after'.
        assert.deepEqual([r52, r49 ?? null], [60, null])
        assert.deepEqual([p52.target_effect, p52.target_streak_effect, p52.quota_effect, p52.campaign_effect, String(p52.detail_status_id), p52.log_template],
          ['requeue', 'increment', 'no_count', 'none', '21', '{message}'])
      }
    })

    await check('apply: dữ liệu đổi đúng chỗ (block 2923 đổi code, 1 mã, 1 chính sách; workflow / element / block khác không đổi)', async () => {
      assert.deepEqual(after.workflows, before.workflows)
      assert.deepEqual(after.auto_elements, before.auto_elements)
      assert.deepEqual(after.blocks.filter(b => b.id !== V.BLOCK.id), before.blocks.filter(b => b.id !== V.BLOCK.id))
      assert.equal(after.blocks.find(b => b.id === V.BLOCK.id).md5, V.NEW_MD5)
      const added = after.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id))
      assert.deepEqual(added.map(e => [e.error_code, e.public_code, e.customer_title, e.customer_help, e.error_class, e.is_active]),
        [[V.FB52.code, 'FB52', 'Không bật được chế độ đăng bài ẩn danh', null, 'ui_changed', true]])
      assert.equal(after.auto_outcome_policies.length, before.auto_outcome_policies.length + 1)
      assert.deepEqual(after.auto_outcome_policies.slice(0, before.auto_outcome_policies.length), before.auto_outcome_policies)
    })

    await check('apply lần hai bị từ chối (block đã đổi), sổ có V617 cũng bị từ chối', async () => {
      await rejects(db, MIGRATION, /V617: block 2923 khác bản V616/)
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121999617', '${V.NAME}')`)
      await rejects(db, MIGRATION, /V617: sổ migration đã có V617/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261121999617'`)
    })

    await db.query(ROLLBACK)
    const restored = await S.dump(db)
    await check('bản gỡ: block 2923 về code V616; mã và chính sách FB52 chỉ bị tắt; mọi quyết định khác như trước', async () => {
      assert.deepEqual(restored.blocks, before.blocks)
      assert.deepEqual(restored.auto_error.filter(e => before.auto_error.some(b => b.id === e.id)), before.auto_error)
      assert.deepEqual(restored.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id)).map(e => [e.error_code, e.is_active]), [[V.FB52.code, false]])
      assert.deepEqual(restored.auto_outcome_policies.slice(before.auto_outcome_policies.length).map(p => [p.error_code, p.is_active]), [[V.FB52.code, false]])
      const gridRestored = await S.policyGrid(db)
      for (const [key, p] of gridBefore) assert.deepEqual(gridRestored.get(key), p, key)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
}

// Ca không bật được: bản V616 ném lỗi (→ SYS99), bản V617 trả FB52 kèm ok: false.
const FB52_OUT = state => ({
  ok: false, anonymousReady: false,
  actionResult: { actionCode: 'fb_post_group', statusCode: 'campaign_detail_error', errorCode: V.FB52.code, inputDataId: 77,
    operationState: 'not_committed', message: 'Không bật được chế độ đăng bài ẩn danh',
    data: { source: 'fb_enable_group_anonymous_post', selector: V616.ELEMENTS[0].xpath, okSelector: V616.ELEMENTS[1].xpath, switchState: state } }
})
const FAIL_IDS = new Set(['bấm công tắc mà Facebook không phản hồi: ném lỗi, không đi tiếp tới nút Đăng', 'bấm OK mà công tắc vẫn tắt: ném lỗi'])

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const pw = await browser.newPage()
  try {
    for (const kase of S.CASES) {
      if (FAIL_IDS.has(kase.id)) {
        await check(`block V617: ${kase.id.replace(/: ném lỗi.*$/, '')} → FB52, ok: false, không bấm Đăng`, async () => {
          const r = await S.runBlock(pw, kase, V.NEW_CODE)
          assert.deepEqual(r.out, FB52_OUT('off'))
          assert.equal(r.dom.checked, 'false')
          const old = await S.runBlock(pw, kase, V.OLD_CODE)
          assert.deepEqual(old.out, { thrown: 'Không bật được chế độ đăng bài ẩn danh' }, 'bản V616 ném lỗi')
        })
      } else {
        await check(`block V617 giữ như V616: ${kase.id}`, async () => kase.expect(await S.runBlock(pw, kase, V.NEW_CODE)))
      }
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  await check('file migration / bản gỡ khớp bộ sinh', async () => {
    assert.equal(md5(MIGRATION), md5(V.migration))
    assert.equal(md5(ROLLBACK), md5(V.rollback))
  })
  await sqlChecks()
  await chromiumChecks()
  console.log(`\n${passed} đạt, ${failed} lỗi (md5 migration ${md5(MIGRATION)})`)
  if (failed) process.exit(1)
}
main().catch(error => { console.error(error); process.exit(1) })
