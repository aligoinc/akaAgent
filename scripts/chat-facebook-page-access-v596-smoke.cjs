#!/usr/bin/env node
// Kiểm V596 (fanpage Facebook dùng akaChat) trên PostgreSQL 17 cục bộ.
// Hai hàm được sửa lấy nguyên văn bản production 20/11/2026 (scripts/fixtures/chat-facebook-page/v596-live-20261120.json).
// Các hàm chúng gọi tới là bản tối thiểu viết theo thân production đọc chỉ đọc cùng ngày:
// - private.app_access_quota: chép nguyên logic đếm suất (akaChat đếm mọi tài khoản is_akachat_enabled của chủ tài khoản);
// - private.app_access_packages: gói akaChat = product_id 5 còn hạn;
// - aka_agent_app_access_separate: tổ chức có product 5;
// - các hàm còn lại (giờ làm việc, gói Zalo, quyền akaAgent của nhân viên) trả theo cột của bảng thử.
// Chạy: LC_ALL=C node scripts/chat-facebook-page-access-v596-smoke.cjs  (cần module pg: CHAT_REPO=<akaAgentChatApi>)
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const build = require('./build-v596-sql.cjs')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const MIGRATION = fs.readFileSync(path.join(ROOT, `migrations/${build.NAME}.sql`), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, `migrations/${build.ROLLBACK_NAME}.sql`), 'utf8')
assert.equal(MIGRATION, build.migration, 'file migration khác bộ sinh: chạy lại node scripts/build-v596-sql.cjs')
assert.equal(ROLLBACK, build.rollback, 'file gỡ khác bộ sinh: chạy lại node scripts/build-v596-sql.cjs')

const SCHEMA = `
CREATE ROLE service_role NOLOGIN; CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN;
CREATE SCHEMA private; CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE TABLE public.org_organization_product (id bigserial PRIMARY KEY, organization_id bigint NOT NULL, product_id bigint,
  max_accounts integer, max_staff integer, expiration_date timestamptz, is_deleted boolean NOT NULL DEFAULT false);
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint, is_active boolean DEFAULT true, deleted_at timestamptz,
  is_aka_agent_enabled boolean DEFAULT false, is_akachat_enabled boolean DEFAULT true, is_admin boolean DEFAULT false);
CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, name text, flatform_type text, staff_id bigint, organization_id bigint,
  is_delete boolean DEFAULT false, login_status text, status text, zalo_account_id bigint, zalo_session jsonb,
  is_zalo_show_web boolean DEFAULT false, is_zalo_server boolean DEFAULT false, runtime_operation_claim_token uuid,
  is_aka_agent_enabled boolean DEFAULT false, is_akachat_enabled boolean DEFAULT false);
CREATE TABLE public.zalo_accounts (id bigint PRIMARY KEY, zalo_uid text);
CREATE TABLE public.chat_zalo_account (id bigserial PRIMARY KEY, zalo_id text UNIQUE);
CREATE TABLE public.chat_zalo_account_organization (id bigserial PRIMARY KEY, chat_zalo_account_id bigint, organization_id bigint, auto_account_id bigint);

CREATE FUNCTION private.app_access_policy_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.aka_agent_app_access_separate(p_org bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT private.app_access_policy_enabled() AND EXISTS (SELECT 1 FROM public.org_organization_product WHERE organization_id=p_org AND product_id=5) $$;
CREATE FUNCTION private.app_access_staff_time_allowed(p_staff bigint) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.aka_agent_app_access_staff_allowed(p_staff bigint, p_app text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT CASE p_app WHEN 'akaAgent' THEN is_aka_agent_enabled ELSE is_akachat_enabled END FROM public.org_staff WHERE id=p_staff),false) $$;
CREATE FUNCTION private.app_access_packages(p_org bigint, p_app text, p_platform text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, product_id bigint, max_accounts integer, max_staff integer) LANGUAGE sql STABLE AS $$
  SELECT p.id,p.product_id,p.max_accounts,p.max_staff FROM public.org_organization_product p
  WHERE p.organization_id=p_org AND p.is_deleted=false AND p.expiration_date >= now()
    AND CASE p_app WHEN 'akaChat' THEN p.product_id=5 WHEN 'akaAgent' THEN
      CASE p_platform WHEN 'zalo' THEN p.product_id IN (16,18) WHEN 'facebook' THEN p.product_id IN (3,10) ELSE false END ELSE false END $$;
CREATE FUNCTION private.resolve_organization_zalo_entitlement_pools(p_organization_id bigint)
 RETURNS TABLE(account_subtype text, entitlement_id bigint) LANGUAGE sql STABLE AS $$
  SELECT s, (SELECT min(id) FROM public.org_organization_product WHERE organization_id=p_organization_id AND product_id IN (16,18))
  FROM unnest(ARRAY['qr','web','server']) s $$;
CREATE FUNCTION private.app_access_quota(p_org bigint, p_staff bigint, p_app text, p_type text, p_platform text DEFAULT 'zalo'::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE cap integer; used integer; entitled boolean; products jsonb;
BEGIN
  SELECT count(*)>0,CASE WHEN p_type='staff' THEN COALESCE(max(greatest(max_staff,0)),0)
    WHEN bool_or(max_accounts IS NULL OR max_accounts<=0) THEN NULL ELSE max(max_accounts) END,
    COALESCE(jsonb_agg(DISTINCT product_id),'[]'::jsonb)
  INTO entitled,cap,products FROM private.app_access_packages(p_org,p_app,CASE WHEN p_type='staff' THEN NULL ELSE p_platform END);
  IF p_type='staff' THEN
    SELECT count(*) INTO used FROM public.org_staff s WHERE s.organization_id=p_org AND s.deleted_at IS NULL
      AND CASE p_app WHEN 'akaAgent' THEN s.is_aka_agent_enabled ELSE s.is_akachat_enabled END;
  ELSE
    SELECT count(*) INTO used FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE s.organization_id=p_org AND a.staff_id=p_staff AND NOT COALESCE(a.is_delete,false)
      AND (a.organization_id IS NULL OR a.organization_id=p_org)
      AND CASE p_app WHEN 'akaAgent' THEN a.is_aka_agent_enabled AND lower(a.flatform_type)=p_platform ELSE a.is_akachat_enabled END;
  END IF;
  IF NOT entitled THEN cap:=0; END IF;
  RETURN jsonb_build_object('hasPackage',entitled,'limit',cap,'used',used,
    'remaining',CASE WHEN cap IS NULL THEN NULL ELSE greatest(cap-used,0) END,
    'overLimit',cap IS NOT NULL AND used>cap,'productIds',products);
END $function$;
`

const DATA = `
-- Tổ chức 10 có gói akaChat 3 suất và gói Zalo; tổ chức 20 không có gói akaChat (chế độ cũ, mọi thứ được phép).
INSERT INTO public.org_organization_product(organization_id, product_id, max_accounts, max_staff, expiration_date) VALUES
  (10, 5, 3, 5, now() + interval '30 days'), (10, 16, 5, 5, now() + interval '30 days');
INSERT INTO public.org_staff(id, organization_id, is_aka_agent_enabled, is_akachat_enabled) VALUES (100, 10, false, true), (200, 20, false, true);
INSERT INTO public.auto_accounts(id, name, flatform_type, staff_id, organization_id, is_zalo_server, is_zalo_show_web, is_akachat_enabled) VALUES
  (1, 'zalo server', 'zalo', 100, 10, true, false, true),
  (2, 'zalo web', 'zalo', 100, 10, false, true, false),
  (3, 'page', 'facebook_page', 100, 10, false, false, true),
  (4, 'fb ca nhan', 'facebook', 100, 10, false, false, false),
  (5, 'page to chuc cu', 'facebook_page', 200, 20, false, false, true);
`

async function allowed(db, id) {
  return (await db.query(`SELECT public.aka_agent_app_access_account_allowed($1, 'akaChat') AS v`, [id])).rows[0].v
}
/** Gọi trigger function như lúc bật cờ: n = dòng sau khi đổi, o = NULL (thêm mới). Trả mã lỗi hoặc 'ok'. */
async function validate(db, row) {
  await db.query('BEGIN')
  try {
    await db.query(`SELECT private.app_access_validate_account(
      jsonb_populate_record(NULL::public.auto_accounts, $1::jsonb), NULL::public.auto_accounts)`, [JSON.stringify(row)])
    return 'ok'
  } catch (error) {
    return error.message
  } finally {
    await db.query('ROLLBACK')
  }
}
async function defMd5(db, sig) {
  return (await db.query(`SELECT md5(pg_get_functiondef($1::regprocedure)) AS m`, [sig])).rows[0].m
}
async function expectError(db, sql, pattern, label) {
  await db.query('SAVEPOINT e')
  try { await db.query(sql) } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT e')
    assert.match(error.message, pattern, label)
    return
  }
  await db.query('ROLLBACK TO SAVEPOINT e')
  assert.fail(`${label}: không báo lỗi`)
}

const page = { id: 6, name: 'page moi', flatform_type: 'facebook_page', staff_id: 100, organization_id: 10, is_akachat_enabled: true,
  is_aka_agent_enabled: false,
  is_zalo_server: false, is_zalo_show_web: false, is_delete: false }

;(async () => {
  const cluster = startCluster({ port: 55000 + Math.floor(Math.random() * 3000), label: 'aka-v596-' })
  let db
  const results = []
  const step = async (name, fn) => { await fn(); results.push(name); console.log('PASS', name) }
  try {
    db = await cluster.connect()
    await db.query(SCHEMA)
    for (const fn of build.FUNCS) await db.query(fn.live)
    await db.query(`GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_account_allowed(bigint,text) TO service_role, aka_agent_desktop, aka_agent_chat_api;
      REVOKE EXECUTE ON FUNCTION public.aka_agent_app_access_account_allowed(bigint,text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION private.app_access_validate_account(public.auto_accounts,public.auto_accounts) FROM PUBLIC;`)
    await db.query(DATA)

    await step('bản production dựng lại có đúng md5 production', async () => {
      for (const fn of build.FUNCS) assert.equal(await defMd5(db, fn.sig), fn.liveMd5, fn.key)
    })

    await step('trước V596: Page không được akaChat, bật cờ bị từ chối', async () => {
      assert.equal(await allowed(db, 3), false)
      assert.equal(await allowed(db, 1), true)
      assert.match(await validate(db, page), /app_access_zalo_only/)
    })

    await db.query('BEGIN')
    await step('apply V596', async () => {
      await db.query(MIGRATION.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''))
      for (const fn of build.FUNCS) assert.equal(await defMd5(db, fn.sig), fn.nextMd5, fn.key)
    })
    await db.query('COMMIT')

    await step('sau V596: Page được akaChat; Zalo Server, Zalo trình duyệt, Facebook cá nhân giữ nguyên', async () => {
      assert.equal(await allowed(db, 3), true, 'Page')
      assert.equal(await allowed(db, 1), true, 'Zalo Server')
      await db.query(`UPDATE public.auto_accounts SET is_akachat_enabled=true WHERE id IN (2,4)`)
      assert.equal(await allowed(db, 2), false, 'Zalo trình duyệt')
      assert.equal(await allowed(db, 4), false, 'Facebook cá nhân')
      await db.query(`UPDATE public.auto_accounts SET is_akachat_enabled=false WHERE id IN (2,4)`)
      assert.equal(await allowed(db, 5), true, 'tổ chức chưa có gói akaChat: chế độ cũ, như trước')
      await db.query(`UPDATE public.auto_accounts SET is_akachat_enabled=false WHERE id=3`)
      assert.equal(await allowed(db, 3), false, 'Page tắt cờ akaChat')
      await db.query(`UPDATE public.auto_accounts SET is_akachat_enabled=true WHERE id=3`)
    })

    await step('sau V596: bật akaChat cho Page mới qua được, không đòi quyền akaAgent của chủ tài khoản', async () => {
      assert.equal(await validate(db, page), 'ok')
    })

    await step('Page chiếm một suất akaChat: đủ suất thì Page mới bị từ chối', async () => {
      // Đang có 1 (Zalo Server) + 3 (Page) = 2 suất / 3. Thêm một Zalo Server nữa là đủ 3.
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, staff_id, organization_id, is_zalo_server, is_akachat_enabled)
        VALUES (7, 'zalo server 2', 'zalo', 100, 10, true, true)`)
      assert.match(await validate(db, page), /app_access_account_limit/)
      const quota = (await db.query(`SELECT private.app_access_quota(10, 100, 'akaChat', 'account') AS q`)).rows[0].q
      assert.equal(quota.used, 3)
      assert.equal(quota.limit, 3)
      await db.query(`DELETE FROM public.auto_accounts WHERE id = 7`)
      assert.equal(await validate(db, page), 'ok')
    })

    await step('sau V596: tổ chức hết gói akaChat thì Page bị từ chối như Zalo', async () => {
      await db.query(`UPDATE public.org_organization_product SET expiration_date = now() - interval '1 day' WHERE product_id = 5`)
      assert.equal(await allowed(db, 3), false)
      assert.match(await validate(db, page), /app_access_package_required/)
      await db.query(`UPDATE public.org_organization_product SET expiration_date = now() + interval '30 days' WHERE product_id = 5`)
    })

    await step('sau V596: loại khác vẫn bị chặn, Zalo QR vẫn đòi chủ tài khoản đọc được akaAgent', async () => {
      assert.match(await validate(db, { ...page, flatform_type: 'facebook' }), /app_access_zalo_only/)
      assert.match(await validate(db, { ...page, flatform_type: 'zalo', is_zalo_show_web: true }), /app_access_zalo_only/)
      assert.match(await validate(db, { ...page, flatform_type: 'zalo' }), /app_access_local_reader_required/)
      assert.equal(await validate(db, { ...page, flatform_type: 'zalo', is_zalo_server: true }), 'ok')
    })

    await step('apply lại V596 bị từ chối', async () => {
      await db.query('BEGIN')
      await expectError(db, MIGRATION.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''), /allowed đã là bản đích/, 'apply lại')
      await db.query('ROLLBACK')
      await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261120000000', '${build.NAME}', '{}')`)
      await db.query('BEGIN')
      await expectError(db, MIGRATION.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''), /đã có trong sổ migration/, 'sổ migration')
      await db.query('ROLLBACK')
    })

    await step('quyền và thuộc tính hai hàm không đổi sau V596', async () => {
      const acl = (await db.query(`SELECT proacl::text a, prosecdef s, provolatile v, proconfig::text c FROM pg_proc
        WHERE oid = 'public.aka_agent_app_access_account_allowed(bigint,text)'::regprocedure`)).rows[0]
      assert.match(acl.a, /aka_agent_chat_api=X/)
      assert.doesNotMatch(acl.a, /=X\/postgres,=X|^\{=X/)
      assert.equal(acl.s, true)
      assert.equal(acl.v, 's')
    })

    await step('gỡ V596 trả đúng bản production; gỡ lần hai bị từ chối', async () => {
      await db.query('BEGIN')
      await db.query(ROLLBACK.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''))
      await db.query('COMMIT')
      for (const fn of build.FUNCS) assert.equal(await defMd5(db, fn.sig), fn.liveMd5, fn.key)
      assert.equal(await allowed(db, 3), false)
      assert.match(await validate(db, page), /app_access_zalo_only/)
      await db.query('BEGIN')
      await expectError(db, ROLLBACK.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''), /đã là bản đích/, 'gỡ lần hai')
      await db.query('ROLLBACK')
    })

    console.log(`\nV596: ${results.length} nhóm đạt. migration ${md5(MIGRATION)}`)
  } catch (error) {
    console.error('FAIL', error)
    process.exitCode = 1
  } finally {
    if (db) await db.end().catch(() => {})
    cluster.stop()
  }
})()
