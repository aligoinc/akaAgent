#!/usr/bin/env node
// Kiểm V582 trên PostgreSQL 17 cục bộ với code ba block đọc từ production 19/11/2026. Không chạm DB thật.
// Chạy: LC_ALL=C node scripts/facebook-business-token-v582-smoke.cjs
// (cần postgresql@17 Homebrew và module pg của akaAgentChatApi, xem fixtures/campaign-outcome-engine/pg-fixture.cjs)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { plan, ENGINE } = require('./build-v582-sql.cjs')

const ROOT = path.resolve(__dirname, '..')
const LIVE = require('./fixtures/facebook-business-token/v582-live-20261119.json')
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/migration_v582_facebook_business_token_message.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v582_facebook_business_token_message.sql'), 'utf8')
const MENU_LABEL = 'Kiểm tra nhập mã xác minh Fanpage'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let passed = 0
const ok = name => { passed += 1; console.log(`  ✓ ${name}`) }
const state = async db => (await db.query(`
  SELECT b.id, md5(b.code) AS md5, b.code FROM public.auto_blocks b ORDER BY b.id`)).rows
const engineState = async db => (await db.query(`
  SELECT s.reviewed_code_md5, c.source_md5_at_copy, c.engine_md5_at_copy
    FROM public.auto_engine_block_steps s JOIN public.auto_engine_block_copies c ON c.engine_block_id = s.block_id
   WHERE s.block_id = $1`, [ENGINE.blockId])).rows[0]
async function rejects(db, sql, pattern) {
  try {
    await db.query(sql)
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    assert.match(String(error.message), pattern)
    return
  }
  assert.fail('câu lệnh phải bị từ chối')
}

async function main() {
  const cluster = startCluster({ port: 55482, label: 'aka-v582-' })
  const db = await cluster.connect()
  try {
    await db.query(`
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
      CREATE TABLE public.auto_blocks (id bigint PRIMARY KEY, name text UNIQUE, code text, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.auto_engine_block_copies (engine_block_id bigint PRIMARY KEY, source_block_id bigint,
        source_md5_at_copy text, engine_md5_at_copy text, copied_at timestamptz DEFAULT now());
      CREATE TABLE public.auto_engine_block_steps (id bigint PRIMARY KEY, block_id bigint, commit_level int,
        reviewed_code_md5 text, updated_at timestamptz DEFAULT now());`)
    for (const block of LIVE.blocks) {
      await db.query('INSERT INTO public.auto_blocks (id, name, code) VALUES ($1, $2, $3)', [block.id, block.name, block.code])
    }
    const engineOld = plan.find(item => item.id === ENGINE.blockId).oldMd5
    await db.query('INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy) VALUES ($1, $2, $3, $3)',
      [ENGINE.blockId, ENGINE.sourceBlockId, engineOld])
    await db.query('INSERT INTO public.auto_engine_block_steps (id, block_id, commit_level, reviewed_code_md5) VALUES ($1, $2, 1, $3)',
      [ENGINE.stepId, ENGINE.blockId, engineOld])

    const before = await state(db)
    for (const item of plan) assert.equal(before.find(row => Number(row.id) === item.id).md5, item.oldMd5)
    ok('bản chép production khớp md5 mà migration kiểm')

    await rejects(db, ROLLBACK, /Gỡ V582: block \d+ khác bản đã đọc/)
    ok('bản gỡ từ chối khi V582 chưa apply')

    await db.query(MIGRATION)
    const after = await state(db)
    for (const item of plan) {
      const row = after.find(entry => Number(entry.id) === item.id)
      const old = before.find(entry => Number(entry.id) === item.id)
      assert.equal(row.md5, item.newMd5)
      assert.equal(row.code, old.code.replace(item.from, item.to))
      assert.equal(row.code.length - old.code.length, item.to.length - item.from.length)
      assert.ok(!row.code.includes('Không tìm thấy user access token'))
      assert.ok(row.code.includes(`"${MENU_LABEL}"`))
      assert.doesNotThrow(() => new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', row.code))
    }
    ok('apply: ba block chỉ đổi đúng câu lỗi, code vẫn biên dịch được')

    const engineAfter = await engineState(db)
    const engineNew = plan.find(item => item.id === ENGINE.blockId).newMd5
    assert.deepEqual(engineAfter, { reviewed_code_md5: engineNew, source_md5_at_copy: engineNew, engine_md5_at_copy: engineNew })
    assert.equal(after.find(row => Number(row.id) === ENGINE.blockId).code, after.find(row => Number(row.id) === ENGINE.sourceBlockId).code)
    ok('apply: danh mục bước và sổ chép block engine ghi md5 mới, hai bản đăng bài fanpage vẫn giống nhau')

    await rejects(db, MIGRATION, /V582: block 2636 khác bản đã đọc/)
    ok('apply lần hai bị từ chối')

    await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261119999999', 'migration_v582_facebook_business_token_message')`)
    await rejects(db, MIGRATION, /V582 đã có trong sổ migration/)
    await db.query(`DELETE FROM supabase_migrations.schema_migrations`)
    ok('apply bị từ chối khi sổ migration đã có V582')

    await db.query(ROLLBACK)
    const restored = await state(db)
    for (const row of restored) assert.equal(row.code, before.find(entry => entry.id === row.id).code)
    assert.deepEqual(await engineState(db), { reviewed_code_md5: engineOld, source_md5_at_copy: engineOld, engine_md5_at_copy: engineOld })
    ok('bản gỡ trả đúng từng byte code cũ và md5 cũ')

    await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = 2669`)
    await rejects(db, MIGRATION, /V582: block 2669 khác bản đã đọc/)
    assert.equal((await state(db)).find(row => Number(row.id) === 2636).md5, plan.find(item => item.id === 2636).oldMd5)
    ok('một block đã bị sửa thì cả migration dừng, không block nào đổi')

    console.log(`\nĐạt ${passed} nhóm`)
  } finally {
    await db.end().catch(() => undefined)
    await cluster.stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
