// Kiểm V496 (thôi ép bật cờ use_new_zalo_runtime cho tổ chức mới) trên PG17 cục bộ: dựng đúng phần V371
// (cột mặc định true + trigger ép true), apply V496, gỡ, apply lại. Không chạm DB thật.
// Chạy: node scripts/test-v496-new-zalo-runtime-default.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')

const ROOT = path.resolve(__dirname, '..')
const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v496_new_zalo_runtime_default_off.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v496_new_zalo_runtime_default_off.sql'), 'utf8')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V496_TEST_PORT || 55496), label: 'aka-v496-' })
  const db = await connect()
  try {
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    // Phần V371 + một trigger đồng bộ đơn hàng giả (production chạy trg_sync_organization_orders cho mọi UPDATE).
    await db.query(`
      CREATE SCHEMA private;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text);
      CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text);
      INSERT INTO public.org_organization (id, name) SELECT g, 'Cũ ' || g FROM generate_series(1, 5) g;
      ALTER TABLE public.org_organization ADD COLUMN use_new_zalo_runtime boolean NOT NULL DEFAULT false;
      ALTER TABLE public.org_organization ALTER COLUMN use_new_zalo_runtime SET DEFAULT true;
      CREATE FUNCTION private.aka_agent_org_default_new_zalo_runtime() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $f$ BEGIN NEW.use_new_zalo_runtime := true; RETURN NEW; END; $f$;
      CREATE TRIGGER trg_use_new_zalo_runtime_on_insert BEFORE INSERT ON public.org_organization
        FOR EACH ROW EXECUTE FUNCTION private.aka_agent_org_default_new_zalo_runtime();
      CREATE TABLE public.sync_calls (org_id bigint);
      CREATE FUNCTION private.fake_sync() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN INSERT INTO public.sync_calls VALUES (NEW.id); RETURN NULL; END; $f$;
      CREATE TRIGGER trg_sync_organization_orders AFTER UPDATE ON public.org_organization
        FOR EACH ROW WHEN (old.* IS DISTINCT FROM new.*) EXECUTE FUNCTION private.fake_sync();
      UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id IN (4, 5);
      TRUNCATE public.sync_calls;
    `)
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES (10, 'Mới trước V496', false)`)
    assert.equal(await val(`SELECT use_new_zalo_runtime FROM public.org_organization WHERE id = 10`), true, 'V371 ép true kể cả khi ghi false')
    pass('dựng đúng V371: tổ chức mới bị ép bật cờ dù ghi false')

    await db.query(APPLY)
    assert.equal(await val(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_use_new_zalo_runtime_on_insert'`), 'D')
    assert.equal(await val(`SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime'`), 'false')
    assert.deepEqual((await db.query(`SELECT id, use_new_zalo_runtime FROM public.org_organization ORDER BY id`)).rows.map(r => [Number(r.id), r.use_new_zalo_runtime]),
      [[1, false], [2, false], [3, false], [4, true], [5, true], [10, true]], 'không đổi dòng tổ chức nào')
    assert.equal(await val(`SELECT count(*) FROM public.sync_calls`), '0', 'không chạy trigger đồng bộ đơn hàng')
    assert.equal(await val(`SELECT to_regprocedure('private.aka_agent_org_default_new_zalo_runtime()') IS NOT NULL`), true, 'giữ hàm để bật lại')
    pass('apply V496: tắt trigger, mặc định false, giữ hàm; không đổi dòng nào, không chạy trigger đồng bộ')

    await db.query(`INSERT INTO public.org_organization (id, name) VALUES (11, 'Mới sau V496')`)
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES (12, 'Bật tay khi tạo', true)`)
    await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = 3`)
    assert.deepEqual((await db.query(`SELECT id, use_new_zalo_runtime FROM public.org_organization WHERE id IN (3, 11, 12) ORDER BY id`)).rows
      .map(r => [Number(r.id), r.use_new_zalo_runtime]), [[3, true], [11, false], [12, true]])
    pass('sau V496: tổ chức mới mặc định false; bật tay từng tổ chức vẫn được')

    await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261111000000', 'migration_v496_new_zalo_runtime_default_off')`)
    await assert.rejects(db.query(APPLY), /đã có trong sổ migration/)
    // Lệnh bị chặn giữa BEGIN…COMMIT để phiên ở trạng thái giao dịch hỏng: huỷ trước lệnh kế.
    await db.query('ROLLBACK').catch(() => {})
    await db.query(`DELETE FROM supabase_migrations.schema_migrations`)
    await assert.rejects(db.query(APPLY), /không ở trạng thái bật/)
    await db.query('ROLLBACK').catch(() => {})
    assert.equal(await val(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_use_new_zalo_runtime_on_insert'`), 'D')
    pass('apply lần hai bị chặn (sổ migration, hoặc trigger đã tắt), không đổi gì')

    await db.query(ROLLBACK)
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES (13, 'Sau khi gỡ', false)`)
    assert.equal(await val(`SELECT use_new_zalo_runtime FROM public.org_organization WHERE id = 13`), true)
    assert.equal(await val(`SELECT use_new_zalo_runtime FROM public.org_organization WHERE id = 11`), false, 'gỡ không sửa dòng đã tạo')
    assert.match(await val(`SELECT col_description('public.org_organization'::regclass, a.attnum) FROM pg_attribute a
      WHERE a.attrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime'`), /^Temporary Zalo runtime rollout flag/)
    await assert.rejects(db.query(ROLLBACK), /không ở trạng thái tắt/)
    await db.query('ROLLBACK').catch(() => {})
    pass('gỡ: trigger bật lại, mặc định true, ghi chú V371; không sửa dòng nào; gỡ lần hai bị chặn')

    await db.query(APPLY)
    assert.equal(await val(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_use_new_zalo_runtime_on_insert'`), 'D')
    pass('apply lại sau khi gỡ')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
