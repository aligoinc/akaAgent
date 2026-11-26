#!/usr/bin/env node
// Dựng PostgreSQL cục bộ có cả engine v2 (hàm nhận data đúng bản production, qua V618) lẫn loại trừ gửi (V330 → V573 → V654 → V655),
// để chạy V657 thật. Dùng cho send-exclusion-v657-smoke.cjs và bộ kiểm ngẫu nhiên. Không chạm DB thật.
//   PG_MODULE_DIR / CHAT_REPO = thư mục có node_modules/pg; PG17_BIN nếu không ở chỗ mặc định.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
if (!process.env.CHAT_REPO && process.env.PG_MODULE_DIR) process.env.CHAT_REPO = process.env.PG_MODULE_DIR
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations } = require('./engine-v2-facebook/fixture.cjs')
const V618 = require('./build-v618-sql.cjs')
const V657 = require('./build-v657-sql.cjs')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const LIVE_DIR = path.join(ROOT, 'scripts/fixtures/web-scan/live-20261121')

function functionBlocks(sql) {
  return [...sql.matchAll(/^CREATE OR REPLACE FUNCTION (?:public|private)\.[\s\S]*?AS \$function\$[\s\S]*?\$function\$;?/gm)].map(m => m[0].endsWith(';') ? m[0] : m[0] + ';')
}

/** Bảng của fixture loại trừ (send-exclusion-schema.sql): tạo nếu chưa có, thêm cột còn thiếu nếu bảng đã có. */
async function mergeSchema(db, sql) {
  for (const m of sql.matchAll(/CREATE TABLE public\.([a-z_]+) \(([\s\S]*?)\n\);/g)) {
    const [, table, body] = m
    const exists = (await db.query('SELECT to_regclass($1) r', ['public.' + table])).rows[0].r
    if (!exists) { await db.query(`CREATE TABLE public.${table} (${body}\n)`); continue }
    for (const line of body.split('\n').map(l => l.trim().replace(/,$/, '')).filter(Boolean)) {
      const col = /^"([a-z_0-9]+)" (.+)$/.exec(line)
      if (!col) continue
      const type = col[2].replace(/ PRIMARY KEY/, '')
      await db.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS "${col[1]}" ${type}`)
    }
  }
}

async function buildDb({ port = 55700 + Math.floor(Math.random() * 200), label = 'aka-v657-' } = {}) {
  const cluster = startCluster({ port, label, timeoutMs: 1_800_000 })
  const db = await cluster.connect()
  const q = async (sql, params) => (await db.query(sql, params)).rows
  const one = async (sql, params) => (await q(sql, params))[0]
  const stop = async () => { await db.end().catch(() => {}); cluster.stop() }
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query('SET check_function_bodies = off')
    for (const file of fs.readdirSync(LIVE_DIR).filter(f => f.endsWith('.sql')).sort()) await db.query(fs.readFileSync(path.join(LIVE_DIR, file), 'utf8'))
    await db.query(`CREATE TABLE IF NOT EXISTS public.auto_elements (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, xpath text NOT NULL, description text,
      category text, is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
    await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_app_access_separate(p_org bigint) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$`)
    await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_app_access_account_allowed(p_account bigint, p_app text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$`)
    await db.query(V618.sql.p1)
    await db.query(V618.sql.p2)
    await db.query(V618.sql.p3)

    // ---------------------------------------------------------------- lớp loại trừ gửi (như send-exclusion-v654-fixture.cjs)
    for (const role of ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) {
      await db.query(`DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $r$`)
    }
    await db.query(`CREATE SCHEMA IF NOT EXISTS private; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text);`)
    await mergeSchema(db, read('scripts/fixtures/send-exclusion-schema.sql'))
    for (const fn of require('./fixtures/send-exclusion-normalizers.json')) await db.query(fn.definition)
    for (const fn of require('./fixtures/send-exclusion-live-baseline.json')) {
      await db.query(fn.definition)
      await db.query(`REVOKE ALL ON FUNCTION public.${fn.signature} FROM PUBLIC`)
      for (const role of ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) {
        await db.query(`REVOKE ALL ON FUNCTION public.${fn.signature} FROM ${role}`)
      }
      for (const grant of (fn.proacl || '{}').slice(1, -1).split(',')) {
        const role = grant.split('=')[0]
        if (role && role !== 'postgres') await db.query(`GRANT EXECUTE ON FUNCTION public.${fn.signature} TO ${role}`)
      }
    }
    await db.query(read('migrations/migration_v330_campaign_send_exclusions.sql'))
    await db.query(`ALTER TABLE auto_account_contact_groups ADD COLUMN IF NOT EXISTS sharing_scope text NOT NULL DEFAULT 'private', ADD COLUMN IF NOT EXISTS sharing_revision bigint NOT NULL DEFAULT 1;
      ALTER TABLE auto_campaign_details ADD COLUMN IF NOT EXISTS policy_snapshot jsonb;
      CREATE TABLE IF NOT EXISTS auto_data_group_recipients(group_id bigint, staff_id bigint, PRIMARY KEY(group_id, staff_id));
      CREATE TABLE IF NOT EXISTS zalo_accounts(id bigint PRIMARY KEY, zalo_uid text);
      ALTER TABLE zalo_accounts ADD COLUMN IF NOT EXISTS metadata jsonb;
      CREATE TABLE IF NOT EXISTS chat_zalo_account(id bigint PRIMARY KEY, zalo_id text UNIQUE, global_id text);
      CREATE UNIQUE INDEX IF NOT EXISTS zalo_accounts_zalo_uid_key_t ON public.zalo_accounts (zalo_uid);
      CREATE INDEX IF NOT EXISTS idx_auto_accounts_zalo_account_id_t ON public.auto_accounts (zalo_account_id);
      CREATE TABLE IF NOT EXISTS auto_campaign_detail_zalo_engagement(campaign_detail_id bigint PRIMARY KEY, organization_id bigint, staff_id bigint, account_id bigint,
        account_zalo_uid text, target_zalo_uid text, action_type text, sent_at timestamptz, tracking_until timestamptz, friended_at timestamptz, rejected_at timestamptz);
      CREATE INDEX IF NOT EXISTS idx_campaign_input_cooldown_phone ON public.auto_campaign_input_data (md5(normalize_phone(phone))) WHERE phone IS NOT NULL AND btrim(phone) <> '';
      CREATE INDEX IF NOT EXISTS idx_campaign_input_cooldown_uid ON public.auto_campaign_input_data (md5(lower(btrim(uid)))) WHERE uid IS NOT NULL AND btrim(uid) <> '';
      CREATE INDEX IF NOT EXISTS idx_campaign_details_input_data_id ON public.auto_campaign_details (input_data_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_users_account_uid_t ON public.zalo_users (account_id, zalo_uid);`)
    if (!(await one(`SELECT to_regprocedure('private.group_access(text,bigint,bigint,bigint)') r`)).r) {
      await db.query(`CREATE FUNCTION private.group_access(p_kind text, p_group_id bigint, p_staff_id bigint, p_organization_id bigint) RETURNS jsonb LANGUAGE sql STABLE AS $f$
        SELECT jsonb_build_object('role',CASE WHEN g.staff_id=p_staff_id THEN 'owner' ELSE 'shared' END) FROM public.auto_account_contact_groups g
        WHERE p_kind='data' AND g.id=p_group_id AND g.purpose='data_group' AND NOT g.is_delete AND g.organization_id=p_organization_id
          AND (g.staff_id=p_staff_id OR g.sharing_scope='organization' OR (g.sharing_scope='selected' AND EXISTS(SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id=g.id AND r.staff_id=p_staff_id))) $f$`)
    }
    // Hàm kiểm quyền theo phiên Desktop (rút gọn như send-exclusion-v654-fixture.cjs): ngoài phiên Desktop thì cho qua.
    if (!(await one(`SELECT to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') r`)).r) {
      await db.query(`CREATE OR REPLACE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint DEFAULT NULL, p_account_id bigint DEFAULT NULL, p_campaign_id bigint DEFAULT NULL)
       RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $f$
       BEGIN
        IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN true; END IF;
        IF p_staff_id IS NOT NULL AND p_staff_id::text IS DISTINCT FROM NULLIF(current_setting('test.desktop_staff',true),'') THEN
          RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied';
        END IF;
        RETURN true;
       END $f$`)
    }
    for (const block of functionBlocks(read('migrations/rollback_v654_send_exclusion_multi_zalo.sql'))) await db.query(block)
    for (const block of functionBlocks(read('migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql'))) await db.query(block)
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p1.sql'))
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_index.sql'))
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p2.sql'))
    await db.query(read('migrations/migration_v655_send_exclusion_input_guards.sql'))
    if (!(await one(`SELECT to_regprocedure('auth.jwt()') r`)).r) {
      await db.query(`CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$`)
    }
    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
    await db.query('SET check_function_bodies = on')
    const live = {}
    for (const [key, [sig]] of Object.entries(V657.LIVE_MD5)) live[key] = (await one('SELECT md5(pg_get_functiondef(to_regprocedure($1))) m', [sig])).m
    const expected = Object.fromEntries(Object.entries(V657.LIVE_MD5).map(([k, [, m]]) => [k, m]))
    assert.deepEqual(live, expected, 'DB thử phải có đúng 7 thân hàm production mà V657 thay')
  } catch (e) { await stop(); throw e }
  const applyV657 = async () => {
    await db.query(read('migrations/migration_v657_send_exclusion_global_match_p1.sql'))
    await db.query(read('migrations/migration_v657_send_exclusion_global_match_p2.sql'))
    // SX_WITH_V666=1: chạy bộ kiểm V657 trên V666 (cổng lưu cấu hình mới mở sẵn: công tắc all, phần mềm chạy coi như đủ bản).
    if (process.env.SX_WITH_V666 === '1') {
      await db.query(`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261125211830','migration_v657_send_exclusion_global_match_p2','{}') ON CONFLICT DO NOTHING`)
      await db.query(`CREATE TABLE IF NOT EXISTS public.auto_staff_device_presence (id bigserial PRIMARY KEY, staff_id bigint, app_version text, last_seen_at timestamptz)`)
      await db.query(`ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean`)
      // V666 thay cả hai hàm nhận lượt: nạp đúng thân production 26/11 trước (preflight kiểm md5).
      const V666 = require('./build-v666-sql.cjs')
      await db.query('SET check_function_bodies = off')
      await db.query(V666.OLD.claim); await db.query(V666.OLD.engineClaim)
      await db.query('SET check_function_bodies = on')
      await db.query(read('migrations/migration_v666_send_exclusion_review_fixes.sql'))
      await db.query(`CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_runtime_ready(p_staff bigint, p_server boolean) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$`)
      await db.query(`CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_multi_on(p_staff bigint) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$`)
      await db.query(`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261126999999','migration_v666_send_exclusion_review_fixes','{}') ON CONFLICT DO NOTHING`)
    }
  }
  const rollbackV657 = async () => {
    if (process.env.SX_WITH_V666 === '1') await db.query(read('migrations/rollback_v666_send_exclusion_review_fixes.sql'))
    await db.query(read('migrations/rollback_v657_send_exclusion_global_match_p2.sql'))
    await db.query(read('migrations/rollback_v657_send_exclusion_global_match_p1.sql'))
  }
  return { db, q, one, stop, applyV657, rollbackV657, read }
}
module.exports = { buildDb, functionBlocks, ROOT }

if (require.main === module) {
  buildDb().then(async x => {
    console.log('DB thử đã dựng, 7 hàm khớp md5 production')
    await x.applyV657(); console.log('apply V657 p1 + p2 đạt')
    await x.rollbackV657(); console.log('gỡ V657 đạt')
    await x.stop()
  }).catch(e => { console.error(e); process.exit(1) })
}
