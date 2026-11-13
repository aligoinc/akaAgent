// Kiểm V528 (tổ chức mới lại được bật sẵn cờ use_new_zalo_runtime) trên PG17 cục bộ: dựng đúng phần V371 (cột mặc định
// true + trigger ép true, hàm chép nguyên văn để md5 thân hàm khớp production), apply V496 thật, rồi apply V528, gỡ,
// apply lại. Không chạm DB thật.
// Chạy: node scripts/test-v528-new-zalo-runtime-default-on.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')

const ROOT = path.resolve(__dirname, '..')
const V496 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v496_new_zalo_runtime_default_off.sql'), 'utf8')
const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v528_new_zalo_runtime_default_on.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v528_new_zalo_runtime_default_on.sql'), 'utf8')
// md5(pg_get_functiondef) của hàm trigger đọc trên production 14/11/2026 02:10 VN.
const PROD_FUNC_MD5 = 'df3a75b16492ded9c413ef4db332dd9b'
// Hàm của V371, nguyên văn (migrations/migration_v371_org_new_zalo_runtime_flag.sql).
const V371_FUNCTION = `CREATE OR REPLACE FUNCTION private.aka_agent_org_default_new_zalo_runtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.use_new_zalo_runtime := true;
  RETURN NEW;
END;
$function$;`
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V528_TEST_PORT || 55528), label: 'aka-v528-' })
  const db = await connect()
  try {
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const flags = async () => (await db.query(`SELECT id, use_new_zalo_runtime FROM public.org_organization ORDER BY id`)).rows
      .map(r => [Number(r.id), r.use_new_zalo_runtime])
    const triggerState = () => val(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_use_new_zalo_runtime_on_insert'`)
    const columnDefault = () => val(`SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime'`)
    const columnComment = () => val(`SELECT col_description('public.org_organization'::regclass, a.attnum) FROM pg_attribute a
      WHERE a.attrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime'`)

    // Phần V371 + một trigger đồng bộ đơn hàng giả (production chạy trg_sync_organization_orders cho mọi UPDATE).
    await db.query(`
      CREATE SCHEMA private;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text);
      CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text);
      INSERT INTO public.org_organization (id, name) SELECT g, 'Cũ ' || g FROM generate_series(1, 5) g;
      ALTER TABLE public.org_organization ADD COLUMN use_new_zalo_runtime boolean NOT NULL DEFAULT false;
      ALTER TABLE public.org_organization ALTER COLUMN use_new_zalo_runtime SET DEFAULT true;
      ${V371_FUNCTION}
      CREATE TRIGGER trg_use_new_zalo_runtime_on_insert BEFORE INSERT ON public.org_organization
        FOR EACH ROW EXECUTE FUNCTION private.aka_agent_org_default_new_zalo_runtime();
      CREATE TABLE public.sync_calls (org_id bigint);
      CREATE FUNCTION private.fake_sync() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN INSERT INTO public.sync_calls VALUES (NEW.id); RETURN NULL; END; $f$;
      CREATE TRIGGER trg_sync_organization_orders AFTER UPDATE ON public.org_organization
        FOR EACH ROW WHEN (old.* IS DISTINCT FROM new.*) EXECUTE FUNCTION private.fake_sync();
      UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id IN (4, 5);
    `)
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES (10, 'Mới thời V371', false)`)
    assert.equal(await val(`SELECT use_new_zalo_runtime FROM public.org_organization WHERE id = 10`), true)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('private.aka_agent_org_default_new_zalo_runtime()'::regprocedure))`), PROD_FUNC_MD5,
      'hàm dựng lại phải trùng md5 thân hàm production, nếu không preflight V528 không kiểm được gì')
    pass('dựng đúng V371: ép true khi INSERT; thân hàm trùng md5 production')

    await db.query(V496)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES (11, 'Mới thời V496')`)
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES (12, 'Mới thời V496, ghi false', false)`)
    assert.equal(await triggerState(), 'D')
    assert.deepEqual(await flags(), [[1, false], [2, false], [3, false], [4, true], [5, true], [10, true], [11, false], [12, false]])
    await db.query(`TRUNCATE public.sync_calls`)
    pass('apply V496 thật: trigger tắt, tổ chức mới mặc định false')

    await db.query(APPLY)
    assert.equal(await triggerState(), 'O')
    assert.equal(await columnDefault(), 'true')
    assert.match(await columnComment(), /^Cờ chọn engine chiến dịch v2 \(V371\).*V528 \(14\/11\/2026\)/)
    assert.deepEqual(await flags(), [[1, false], [2, false], [3, false], [4, true], [5, true], [10, true], [11, false], [12, false]],
      'không đổi dòng tổ chức nào, kể cả tổ chức tạo thời V496')
    assert.equal(await val(`SELECT count(*) FROM public.sync_calls`), '0', 'không chạy trigger đồng bộ đơn hàng')
    assert.equal(await val(`SELECT md5(pg_get_functiondef('private.aka_agent_org_default_new_zalo_runtime()'::regprocedure))`), PROD_FUNC_MD5, 'giữ nguyên hàm')
    pass('apply V528: trigger bật, mặc định true, ghi chú mới; không đổi dòng nào, không chạy trigger đồng bộ, giữ hàm')

    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES (13, 'Mới sau V528, ghi false', false)`)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES (14, 'Mới sau V528')`)
    assert.deepEqual((await flags()).filter(([id]) => id >= 13), [[13, true], [14, true]])
    await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id = 14`)
    await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = 11`)
    assert.deepEqual((await flags()).filter(([id]) => [11, 14].includes(id)), [[11, true], [14, false]])
    pass('sau V528: tổ chức mới bị ép bật kể cả khi ghi false; tắt/bật từng tổ chức bằng UPDATE vẫn được')

    await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261113191500', 'migration_v528_new_zalo_runtime_default_on')`)
    await assert.rejects(db.query(APPLY), /V528 đã có trong sổ migration/)
    // Lệnh bị chặn giữa BEGIN…COMMIT để phiên ở trạng thái giao dịch hỏng: huỷ trước lệnh kế.
    await db.query('ROLLBACK').catch(() => {})
    await db.query(`DELETE FROM supabase_migrations.schema_migrations`)
    await assert.rejects(db.query(APPLY), /không ở trạng thái tắt của V496/)
    await db.query('ROLLBACK').catch(() => {})
    assert.equal(await triggerState(), 'O')
    pass('apply lần hai bị chặn (sổ migration, hoặc trigger đã bật), không đổi gì')

    await db.query(ROLLBACK)
    assert.equal(await triggerState(), 'D')
    assert.equal(await columnDefault(), 'false')
    assert.match(await columnComment(), /^Cờ chọn engine chiến dịch v2 cho tài khoản Zalo Server trên Fly \(V371\)\. Từ V496/)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES (15, 'Sau khi gỡ V528')`)
    assert.deepEqual((await flags()).filter(([id]) => id >= 13), [[13, true], [14, false], [15, false]], 'gỡ không sửa dòng đã tạo')
    await assert.rejects(db.query(ROLLBACK), /không ở trạng thái bật của V528/)
    await db.query('ROLLBACK').catch(() => {})
    pass('gỡ: về đúng trạng thái V496 (trigger tắt, mặc định false, ghi chú V496); không sửa dòng nào; gỡ lần hai bị chặn')

    await db.query(`CREATE OR REPLACE FUNCTION private.aka_agent_org_default_new_zalo_runtime() RETURNS trigger LANGUAGE plpgsql
      SET search_path = pg_catalog AS $function$
      BEGIN
        IF NEW.use_new_zalo_runtime IS NULL THEN NEW.use_new_zalo_runtime := true; END IF;
        RETURN NEW;
      END;
      $function$`)
    await assert.rejects(db.query(APPLY), /thân hàm của trigger khác bản V371/)
    await db.query('ROLLBACK').catch(() => {})
    assert.equal(await triggerState(), 'D')
    await db.query(V371_FUNCTION)
    pass('hàm trigger bị sửa khác V371 thì V528 từ chối, không bật trigger')

    await db.query(APPLY)
    assert.equal(await triggerState(), 'O')
    assert.equal(await columnDefault(), 'true')
    pass('apply lại sau khi gỡ')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
