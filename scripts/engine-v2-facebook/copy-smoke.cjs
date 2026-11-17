// V560 (chép workflow / block Facebook sang bản "[engine]", Q7) trên PostgreSQL 17 cục bộ: dựng 14 workflow / 84 block giả đúng id, tên,
// node của production (scripts/fixtures/engine-v2-facebook/workflows-live-*.json; code giả), đọc lại bằng chính câu của read-workflows.cjs,
// sinh migration bằng chính bộ sinh build-v560-sql.cjs rồi apply. Kiểm: sổ chép, node giữ tên block, danh mục bước (Desktop đọc như thật),
// mức 2 lùi về 1 khi code bản engine đổi, view lệch, bộ cũ không đổi, preflight từ chối khi code nguồn đổi, gỡ.
// Chạy: node scripts/engine-v2-facebook/copy-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build: esbuild } = require('esbuild')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations } = require('./fixture.cjs')
const { workflowsSql } = require('./read-workflows.cjs')
const { build } = require('../build-v560-sql.cjs')

const ROOT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.FB_COPY_TEST_PORT || 55559)
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/workflows-live-20261116.json'), 'utf8'))
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function loadStepCatalog() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-copy-'))
  const outfile = path.join(out, 'steps.cjs')
  await esbuild({ entryPoints: [path.join(ROOT, 'src/main/engineAdapters/facebook/stepCatalog.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error' })
  const mod = require(outfile)
  fs.rmSync(out, { recursive: true, force: true })
  return mod
}

async function main() {
  const S = await loadStepCatalog()
  const cluster = startCluster({ port: PORT, label: 'aka-fb-copy-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const q = async (sql, args = []) => (await db.query(sql, args)).rows
  const one = async (sql, args = []) => (await q(sql, args))[0]
  const readSnapshot = async () => {
    const raw = (await one(`${workflowsSql()}`)).out
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(`ALTER TABLE public.auto_campaign_actions ADD COLUMN IF NOT EXISTS workflow_id bigint`)
    // Block / workflow giả đúng id, tên, node của production (code giả).
    for (const b of LIVE.blocks) {
      await db.query(`INSERT INTO public.auto_blocks (id, name, category, code, is_builtin) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5)`,
        [Number(b.id), b.name, b.category || 'facebook', `return { ok: true } // ${b.name}`, !!b.isBuiltin])
    }
    for (const w of LIVE.workflows) {
      const nodes = w.nodes.map(n => ({ id: n.id, blockId: n.blockId == null ? 0 : Number(n.blockId), blockName: n.blockName,
        ...(n.systemType ? { systemType: n.systemType } : {}), config: Object.fromEntries((n.configKeys || []).map(k => [k, ''])) }))
      await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3::jsonb, '[]'::jsonb)`,
        [Number(w.id), w.name, JSON.stringify(nodes)])
      if (w.purpose !== 'rest_browse') {
        await db.query(`UPDATE public.auto_campaign_actions SET workflow_id = $2 WHERE id = $1`, [w.purpose, Number(w.id)])
      }
    }
    // Production: sequence luôn ở trước id đang có; DB thử chèn id cố định nên đặt lại.
    await db.query(`SELECT setval(pg_get_serial_sequence('public.auto_blocks', 'id'), (SELECT max(id) FROM public.auto_blocks))`)
    await db.query(`SELECT setval(pg_get_serial_sequence('public.auto_workflows', 'id'), (SELECT max(id) FROM public.auto_workflows))`)
    const snapshot = await readSnapshot()

    await check('đọc lại DB thử bằng câu của read-workflows.cjs ra đúng 14 workflow / 84 block như production', async () => {
      assert.equal(snapshot.workflows.length, LIVE.workflows.length)
      assert.equal(snapshot.blocks.length, LIVE.blocks.length)
      assert.deepEqual(snapshot.missingBlocks, [])
      assert.deepEqual(snapshot.workflows.map(w => w.purpose).sort(), LIVE.workflows.map(w => w.purpose).sort())
    })

    await check('preflight từ chối khi code một block nguồn đã đổi so với bản đã đọc', async () => {
      const stale = JSON.parse(JSON.stringify(snapshot))
      stale.blocks[0].md5 = '0'.repeat(32)
      await assert.rejects(db.query(build(stale).migration), /code block đã đổi/)
      await db.query('ROLLBACK')
    })

    const { migration, rollback, STEPS } = build(snapshot)
    await check('apply V560: 84 block + 14 workflow "[engine]", sổ chép, danh mục bước; bộ cũ vẫn trỏ workflow cũ', async () => {
      await db.query(migration)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_engine_block_copies`)).n, LIVE.blocks.length)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_engine_workflows`)).n, LIVE.workflows.length)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_engine_block_steps`)).n, STEPS.length)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_campaign_actions c JOIN public.auto_workflows w ON w.id = c.workflow_id
        WHERE w.name LIKE '[engine] %'`)).n, 0, 'bộ cũ không đổi')
      assert.equal((await q(`SELECT 1 FROM public.aka_agent_engine_block_copy_drift`)).length, 0)
      await assert.rejects(db.query(migration), /đã có sổ chép/)
      await db.query('ROLLBACK')
    })

    await check('workflow engine giữ id node và tên block (bộ dựng lịch sử nhận mốc theo tên), blockId trỏ bản engine cùng code', async () => {
      const rows = await q(`SELECT ew.purpose, s.nodes AS src, e.nodes AS eng FROM public.auto_engine_workflows ew
        JOIN public.auto_workflows e ON e.id = ew.workflow_id JOIN public.auto_workflows s ON s.id = ew.source_workflow_id`)
      const copies = new Map((await q(`SELECT source_block_id, engine_block_id FROM public.auto_engine_block_copies`))
        .map(r => [Number(r.source_block_id), Number(r.engine_block_id)]))
      for (const row of rows) {
        assert.deepEqual(row.eng.map(n => [n.id, n.blockName]), row.src.map(n => [n.id, n.blockName]), row.purpose)
        row.eng.forEach((n, i) => {
          const src = Number(row.src[i].blockId)
          assert.equal(Number(n.blockId), src > 0 ? copies.get(src) : src, `${row.purpose}/${n.id}`)
        })
      }
      const same = await one(`SELECT bool_and(e.code = s.code) AS ok, bool_and(e.name = '[engine] ' || s.name) AS named FROM public.auto_engine_block_copies c
        JOIN public.auto_blocks e ON e.id = c.engine_block_id JOIN public.auto_blocks s ON s.id = c.source_block_id`)
      assert.equal(same.ok, true); assert.equal(same.named, true)
    })

    const catalogFor = async () => (await q(`SELECT block_id, workflow_id, node_id, action_code, action_code_from, step_kind, commit_level, send_ops,
        result_mode, legacy_milestone, reviewed_code_md5 FROM public.auto_engine_block_steps WHERE is_active`)).map(S.mapEngineBlockStepRow).filter(Boolean)
    const engineNode = async (purpose, nodeId) => one(`SELECT ew.workflow_id, (n.value->>'blockId')::bigint AS block_id, b.code
        FROM public.auto_engine_workflows ew JOIN public.auto_workflows w ON w.id = ew.workflow_id
        CROSS JOIN LATERAL jsonb_array_elements(w.nodes) n JOIN public.auto_blocks b ON b.id = (n.value->>'blockId')::bigint
       WHERE ew.purpose = $1 AND n.value->>'id' = $2`, [purpose, nodeId])

    await check('danh mục bước như Desktop đọc: đăng nhóm / trang cá nhân / nhắn tin theo đúng thao tác, mức 2 có cú gửi, đổi danh tính là phiên', async () => {
      const catalog = await catalogFor()
      const resolve = async (purpose, nodeId) => {
        const node = await engineNode(purpose, nodeId)
        return S.resolveEngineStep(catalog, { blockId: Number(node.block_id), workflowId: Number(node.workflow_id), nodeId, config: {}, blockCode: node.code })
      }
      const post = await resolve('facebook_group_post', 'click_post')
      assert.deepEqual([post.kind, post.actionCode, post.commitLevel, post.sendOps], ['delivery', 'fb_post_group', 2, ['click:fb_post_button']])
      assert.equal((await resolve('facebook_timeline_post', 'click_post')).actionCode, 'fb_post_my_profile')
      assert.equal((await resolve('facebook_message_uid', 'send_msg')).actionCode, 'fb_message_stranger')
      assert.equal((await resolve('facebook_message_friend', 'send_msg')).actionCode, 'fb_message_friend')
      assert.deepEqual((await resolve('facebook_comment_seeding_post', 'comment_current_post')).sendOps, ['press:Enter'])
      assert.equal((await resolve('facebook_group_post', 'page_identity_switch')).kind, 'session')
      assert.equal((await resolve('facebook_group_post', 'open_composer')).kind, 'result')
      const like = await resolve('facebook_comment_seeding', 'like_at_pos')
      assert.deepEqual([like.kind, like.commitLevel], ['delivery', 1])
    })

    await check('sửa code block bản engine mà chưa duyệt lại: mức 2 lùi về 1; view lệch báo cả hai phía', async () => {
      const node = await engineNode('facebook_group_post', 'click_post')
      await db.query(`UPDATE public.auto_blocks SET code = code || '\n// sửa' WHERE id = $1`, [node.block_id])
      const changed = await engineNode('facebook_group_post', 'click_post')
      const step = S.resolveEngineStep(await catalogFor(), { blockId: Number(changed.block_id), workflowId: Number(changed.workflow_id), nodeId: 'click_post',
        config: {}, blockCode: changed.code })
      assert.deepEqual([step.commitLevel, step.downgraded, step.sendOps], [1, true, []])
      const drift = await q(`SELECT kind, source_changed, engine_changed FROM public.aka_agent_engine_block_copy_drift`)
      assert.deepEqual(drift.map(r => [r.kind, r.source_changed, r.engine_changed]), [['block', false, true]])
      await db.query(`UPDATE public.auto_blocks SET code = code || '\n// sửa bản cũ' WHERE id = 27`)
      assert.ok((await q(`SELECT 1 FROM public.aka_agent_engine_block_copy_drift WHERE source_id = 27 AND source_changed`)).length === 1)
    })

    await check('gỡ V560: xoá sổ + danh mục (engine FB lùi về bộ cũ), để nguyên bản "[engine]"; apply lại bị từ chối tới khi dọn', async () => {
      await db.query(rollback)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_engine_workflows`)).n, 0)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_engine_block_copies`)).n, 0)
      assert.ok((await one(`SELECT count(*)::int AS n FROM public.auto_workflows WHERE name LIKE '[engine] %'`)).n === LIVE.workflows.length)
      const fresh = build(await readSnapshot())
      await assert.rejects(db.query(fresh.migration), /đã có block \/ workflow "\[engine\]"/)
      await db.query('ROLLBACK')
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
