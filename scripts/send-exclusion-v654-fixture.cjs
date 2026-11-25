#!/usr/bin/env node
// Dựng PostgreSQL cục bộ ở trạng thái production trước V654 (dùng chung cho send-exclusion-v654-smoke.cjs và -fuzz.cjs).
// Bảng V330 (fixture schema + migration v330), thân 6 hàm production lấy từ bản gỡ V654 (so md5 prosrc), V573.
// Kiểm V654 (loại trừ gửi theo nhiều Zalo, Nhóm data, chiến dịch đã gửi) trên PostgreSQL cục bộ dùng một lần.
// Dựng đúng trạng thái production đọc 25/11/2026: bảng V330 (fixture schema + migration v330), thân hàm production lấy từ
// bản gỡ V654 (bài kiểm so md5 prosrc với giá trị đọc trên production), V573. Không chạm DB thật.
// Chạy: node scripts/send-exclusion-v654-smoke.cjs
//   PG_BIN=<thư mục initdb/pg_ctl> (mặc định /usr/lib/postgresql/16/bin, rồi /opt/homebrew/opt/postgresql@17/bin)
//   PG_MODULE_DIR=<thư mục có node_modules/pg> nếu repo chưa cài pg.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')
function requirePg() {
  const dirs = [process.env.PG_MODULE_DIR, process.env.CHAT_REPO, ROOT, path.resolve(ROOT, '../akaAgentChatApi')].filter(Boolean)
  for (const dir of dirs) { try { return require(require.resolve('pg', { paths: [dir] })) } catch { /* tiếp */ } }
  throw new Error('Không tìm thấy module pg: đặt PG_MODULE_DIR')
}
const { Client } = requirePg()
const BIN = process.env.PG_BIN || ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'].find(d => fs.existsSync(path.join(d, 'initdb')))
const EXPECTED = {
  'public.aka_agent_internal_send_exclusion_group(bigint)': 'c73d260df8ba115c2ec059b7c3c138d8',
  'public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)': 'af9913da69c3a16e921369744524f8cd',
  'public.auto_validate_campaign_send_exclusion()': '31518a224d65996ee64ccafa2bd4b008',
  'public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)': '0aaf3c6bc86bcdec10c94ed9ce21426a',
  'public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)': '521414d40664c567b8f89f4dee5add9c',
  'public.aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)': '43c3bb89ce08fcb59ab2e0b9fda68ee5',
}

function startCluster(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v654-'))
  const run = (cmd, args) => {
    const r = spawnSync(path.join(BIN, cmd), args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
    if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.stdout}`)
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1
  const asRoot = uid === 0
  if (asRoot) {
    fs.chmodSync(dir, 0o777)
    const su = (cmd, args) => {
      const r = spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', [path.join(BIN, cmd), ...args].map(a => `'${a}'`).join(' ')], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
      if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.stdout}`)
    }
    su('initdb', ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'])
    su('pg_ctl', ['-D', path.join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c fsync=off`, '-l', path.join(dir, 'log'), '-w', 'start'])
    return { dir, stop: () => su('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']) }
  }
  run('initdb', ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'])
  run('pg_ctl', ['-D', path.join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c fsync=off`, '-l', path.join(dir, 'log'), '-w', 'start'])
  return { dir, stop: () => run('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']) }
}

/** Các khối CREATE [OR REPLACE] FUNCTION ... $function$; trong một tệp. */
function functionBlocks(sql) {
  return [...sql.matchAll(/^CREATE OR REPLACE FUNCTION (?:public|private)\.[\s\S]*?AS \$function\$[\s\S]*?\$function\$;?/gm)].map(m => m[0].endsWith(';') ? m[0] : m[0] + ';')
}

/** Trả { db, q, one, stop, applyV654 }. db đã đặt request.jwt.claims service_role. */
async function buildDb() {
  assert.ok(BIN, 'không tìm thấy PostgreSQL (đặt PG_BIN)')
  const port = 55000 + Math.floor(Math.random() * 900)
  const cluster = startCluster(port)
  const db = new Client({ host: cluster.dir, port, user: 'postgres', database: 'postgres' })
  await db.connect()
  const q = async (sql, params) => (await db.query(sql, params)).rows
  const one = async (sql, params) => (await q(sql, params))[0]
  const stop = async () => { await db.end().catch(() => {}); cluster.stop() }
  try {
    await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE aka_agent_chat_api NOLOGIN; CREATE ROLE aka_agent_desktop NOLOGIN; CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
      CREATE TABLE org_organization(id bigint PRIMARY KEY);
      CREATE TABLE private.aka_agent_desktop_users(auth_user_id uuid PRIMARY KEY, staff_id bigint);`)
    await db.query(read('scripts/fixtures/send-exclusion-schema.sql'))
    for (const fn of require('./fixtures/send-exclusion-normalizers.json')) await db.query(fn.definition)
    for (const fn of require('./fixtures/send-exclusion-live-baseline.json')) {
      await db.query(fn.definition)
      await db.query(`REVOKE ALL ON FUNCTION public.${fn.signature} FROM PUBLIC`)
      for (const grant of (fn.proacl || '{}').slice(1, -1).split(',')) {
        const role = grant.split('=')[0]
        if (role && role !== 'postgres') await db.query(`GRANT EXECUTE ON FUNCTION public.${fn.signature} TO ${role}`)
      }
    }
    await db.query(read('migrations/migration_v330_campaign_send_exclusions.sql'))
    // Cột / bảng production mà V330 fixture không có (đọc information_schema 25/11/2026).
    await db.query(`ALTER TABLE auto_account_contact_groups ADD COLUMN sharing_scope text NOT NULL DEFAULT 'private', ADD COLUMN sharing_revision bigint NOT NULL DEFAULT 1;
      ALTER TABLE auto_campaign_details ADD COLUMN policy_snapshot jsonb;
      CREATE TABLE auto_data_group_recipients(group_id bigint, staff_id bigint, PRIMARY KEY(group_id, staff_id));
      CREATE TABLE zalo_accounts(id bigint PRIMARY KEY, zalo_uid text);
      CREATE TABLE auto_campaign_detail_zalo_engagement(campaign_detail_id bigint PRIMARY KEY, organization_id bigint, staff_id bigint, account_id bigint,
        account_zalo_uid text, target_zalo_uid text, action_type text, sent_at timestamptz, tracking_until timestamptz, friended_at timestamptz, rejected_at timestamptz);
      CREATE TABLE auto_system_settings(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, key text UNIQUE, value text, description text, is_secret boolean DEFAULT false,
        is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE auto_engine_target_runs(id bigint PRIMARY KEY, input_data_id bigint, campaign_id bigint, account_id bigint, staff_id bigint, organization_id bigint,
        lease_token uuid, runner_id text, runtime_target text, marks jsonb, started_at timestamptz, first_marked_at timestamptz, completed_at timestamptz,
        final_target_status text, final_error_code text, close_reason text, outcome_count integer, final_response jsonb, slot_at timestamptz);
      CREATE TABLE auto_engine_leases(account_id bigint PRIMARY KEY, lease_token uuid, runner_id text, runtime_target text, campaign_id bigint,
        acquired_at timestamptz, heartbeat_at timestamptz, expires_at timestamptz, campaign_schedule timestamptz);
      CREATE FUNCTION public.aka_agent_engine_desktop_staff() RETURNS bigint LANGUAGE sql AS $$ SELECT NULL::bigint $$;
      CREATE FUNCTION public.aka_agent_engine_scope_ok(p_staff bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
        AS $$ SELECT CASE WHEN s.v IS NULL THEN true ELSE s.v = p_staff END FROM (SELECT public.aka_agent_engine_desktop_staff() AS v) s $$;
      CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $f$
       DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
       BEGIN
        IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
        BEGIN v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
          IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
          v_user := NULLIF(v_claims->>'sub','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN 0; END;
        SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user; RETURN COALESCE(v_staff,0);
       END $f$;
      CREATE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint DEFAULT NULL, p_account_id bigint DEFAULT NULL, p_campaign_id bigint DEFAULT NULL)
       RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $f$
       DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
       BEGIN
        IF v_staff IS NULL THEN RETURN true; END IF;
        IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied'; END IF;
        IF p_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id IS DISTINCT FROM v_staff) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_account_scope_denied'; END IF;
        IF p_campaign_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=p_campaign_id AND staff_id IS DISTINCT FROM v_staff) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_campaign_scope_denied'; END IF;
        RETURN true;
       END $f$;
      -- Rút gọn của private.group_access (production: chủ nhóm / chia sẻ cả tổ chức / chia sẻ cho từng người).
      CREATE FUNCTION private.group_access(p_kind text, p_group_id bigint, p_staff_id bigint, p_organization_id bigint) RETURNS jsonb LANGUAGE sql STABLE AS $f$
        SELECT jsonb_build_object('role',CASE WHEN g.staff_id=p_staff_id THEN 'owner' ELSE 'shared' END) FROM public.auto_account_contact_groups g
        WHERE p_kind='data' AND g.id=p_group_id AND g.purpose='data_group' AND NOT g.is_delete AND g.organization_id=p_organization_id
          AND (g.staff_id=p_staff_id OR g.sharing_scope='organization' OR (g.sharing_scope='selected' AND EXISTS(SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id=g.id AND r.staff_id=p_staff_id))) $f$;`)
    // Thân hàm production: 6 hàm V654 thay lấy từ bản gỡ (khớp md5 production), validate_rules từ V573.
    const rollback = read('migrations/rollback_v654_send_exclusion_multi_zalo.sql')
    for (const block of functionBlocks(rollback)) await db.query(block)
    for (const block of functionBlocks(read('migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql'))) await db.query(block)
    for (const [sig, md5] of Object.entries(EXPECTED)) {
      const row = await one('SELECT md5(prosrc) m FROM pg_proc WHERE oid=to_regprocedure($1)', [sig])
      assert.equal(row?.m, md5, `${sig} trong bản gỡ phải khớp production`)
    }
  } catch (e) { await stop(); throw e }
  await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
  const applyV654 = async () => {
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p1.sql'))
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_index.sql'))
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p2.sql'))
    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
  }
  return { db, q, one, stop, applyV654, read }
}
module.exports = { buildDb, functionBlocks, read, ROOT }
