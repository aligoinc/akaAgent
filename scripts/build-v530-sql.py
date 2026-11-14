#!/usr/bin/env python3
"""Sinh ba file SQL của v530 từ migration + baseline, để chúng không lệch nhau:

1. migrations/snapshots/web-facebook-email-authoring-v530/rollback.sql
   Rollback có guard md5 (nguồn hoặc đích), khôi phục 11 định nghĩa trong baseline.sql,
   bỏ 12 hàm mới và khoá cấu hình 'web.email_campaigns'.
2. migrations/tests/migration_v530_web_facebook_email_authoring_compare.sql
   So sánh CHỈ ĐỌC trên production trước khi apply: chạy đúng phần preflight + dựng bản vá của
   migration, nhưng không EXECUTE lên public/private mà tạo bản sao pg_temp cho 3 hàm đọc và helper
   chính sách Facebook, rồi so caller cũ (không token 'email') cũ/mới trên nhân viên thật và đo đường
   Email mới. Không gọi hàm có ghi (tạo/sửa/thêm data/xoá/dừng/tiếp tục/xác thực).
3. migrations/tests/migration_v530_web_facebook_email_authoring_guarded_apply.sql
   Áp bằng MỘT LẦN DÁN vào Supabase SQL Editor (khi không bấm được thẻ xác nhận MCP): một giao dịch
   so sánh → chốt chặn → migration → ghi lịch sử migration giống apply_migration.
4. migrations/tests/migration_v530_web_facebook_email_authoring_smoke.sql
   Kiểm chỉ đọc trên production sau apply (md5/ACL, phạm vi đọc Email/Facebook, quyền), chạy trong
   BEGIN ... ROLLBACK.
5. migrations/tests/migration_v530_web_facebook_email_authoring_rollback_trial.sql
   Thử trên production trong giao dịch tự huỷ: migration + smoke rồi RAISE 'v530_trial_ok' (không COMMIT,
   không ghi sổ migration).

Chạy lại mỗi khi sửa migration hoặc baseline:
    python3 scripts/build-v530-sql.py
"""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
migration_path = root / 'migrations/migration_v530_web_facebook_email_authoring.sql'
snapshot_dir = root / 'migrations/snapshots/web-facebook-email-authoring-v530'
tests_dir = root / 'migrations/tests'
migration = migration_path.read_text()
baseline = (snapshot_dir / 'baseline.sql').read_text()

NAME = 'migration_v530_web_facebook_email_authoring'
TAG = '$v530_statements$'
assert TAG not in migration

specs_match = re.search(r"\$specs\$(\[.*?\])\$specs\$", migration, re.S)
assert specs_match
specs = json.loads(specs_match.group(1))
assert len(specs) == 11 and all(len(s['target']) == 32 and s['target'] != '0' * 32 for s in specs)
spec_values = ',\n'.join(
    f"    ('{s['signature']}', '{s['source']}', '{s['target']}')" for s in specs)
signatures = ',\n'.join(f"    '{s['signature']}'::regprocedure" for s in specs)

new_lists = re.findall(r"\$new_functions\$(\[.*?\])\$new_functions\$", migration, re.S)
assert len(new_lists) == 2
new_functions = json.loads(new_lists[1])
assert len(new_functions) == 12 and all(f['target'] != '0' * 32 for f in new_functions)
assert [f['signature'] for f in json.loads(new_lists[0])] == [f['signature'] for f in new_functions]
assert [f['target'] for f in json.loads(new_lists[0])] == [f['target'] for f in new_functions]
drops = '\n'.join(f"DROP FUNCTION IF EXISTS {f['signature']};" for f in reversed(new_functions))

# Thân baseline: bỏ phần chú thích đầu file, giữ 11 CREATE OR REPLACE.
baseline_body = baseline[baseline.index('CREATE OR REPLACE FUNCTION'):].rstrip() + '\n'
assert baseline_body.count('CREATE OR REPLACE FUNCTION') == 11

# 1. Rollback.
rollback = f"""-- Rollback v530: khôi phục 11 định nghĩa live trước v530, bỏ 12 hàm mới và khoá cấu hình 'web.email_campaigns'.
-- File sinh tự động bởi scripts/build-v530-sql.py từ baseline.sql; đừng sửa tay.
-- Chỉ chạy khi 11 hàm đang ở đúng bản v530 (hoặc đã về baseline); lệch thì dừng, không đổi gì.
-- Trước khi chạy: tắt authoring ('web.facebook_campaigns' authoring.enabled=false, 'web.email_campaigns'
-- enabled=false) và deploy Control API không gọi các RPC mới của v530 (lỗi PGRST202 được coi là tắt).
-- Dòng chiến dịch/tài khoản Facebook/Email đã tạo từ Web giữ nguyên (không xoá dữ liệu khách).
-- CREATE OR REPLACE/DROP nên PostgREST nạp lại schema: chỉ chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE v530_rollback_attrs ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS signature, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text AS acl,
  pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
WHERE p.oid IN (
{signatures}
);

DO $guard$
DECLARE r record; checksum text; at_baseline integer := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
{spec_values}
  ) AS x(signature, source_md5, target_md5) LOOP
    checksum := md5(pg_get_functiondef(r.signature::regprocedure));
    IF checksum NOT IN (r.source_md5, r.target_md5) THEN
      RAISE EXCEPTION 'v530_rollback_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF checksum = r.source_md5 THEN at_baseline := at_baseline + 1; END IF;
  END LOOP;
  IF at_baseline = 11 AND to_regprocedure('public.aka_agent_control_web_email_campaigns_policy(bigint)') IS NULL THEN
    RAISE NOTICE 'v530 đã ở baseline; rollback không đổi định nghĩa nào.';
  END IF;
END
$guard$;

{baseline_body}
{drops}
DELETE FROM public.auto_system_settings WHERE key = 'web.email_campaigns';

DO $postflight$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
{spec_values}
  ) AS x(signature, source_md5, target_md5) LOOP
    IF md5(pg_get_functiondef(r.signature::regprocedure)) IS DISTINCT FROM r.source_md5 THEN
      RAISE EXCEPTION 'v530_rollback_postflight:%', r.signature;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM v530_rollback_attrs a JOIN pg_proc p ON p.oid = a.signature::regprocedure
    WHERE (p.prosecdef, p.provolatile, p.proconfig, p.proacl::text, pg_get_userbyid(p.proowner))
      IS DISTINCT FROM (a.prosecdef, a.provolatile, a.proconfig, a.acl, a.owner)
  ) THEN
    RAISE EXCEPTION 'v530_rollback_attributes_changed';
  END IF;
END
$postflight$;
COMMIT;
"""
(snapshot_dir / 'rollback.sql').write_text(rollback)

# 2. So sánh chỉ đọc.
preflight_start = migration.index('DO $preflight$')
preflight_end = migration.index('$preflight$;', preflight_start + len('DO $preflight$')) + len('$preflight$;')
preflight = migration[preflight_start:preflight_end] + '\n'
helper_start = migration.index('CREATE OR REPLACE FUNCTION pg_temp.v530_replace(')
helper_end = migration.index('$helper$;', helper_start) + len('$helper$;')
helper = migration[helper_start:helper_end] + '\n'
do_start = migration.index('DO $migration$')
do_end = migration.index('$migration$;', do_start + len('DO $migration$')) + len('$migration$;')
do_block = migration[do_start:do_end] + '\n'
apply_begin = do_block.index('  -- v530:apply-begin')
apply_end_marker = '  -- v530:apply-end\n'
apply_end = do_block.index(apply_end_marker) + len(apply_end_marker)
compare_exec = """  -- So sánh: không EXECUTE lên public/private. Ghi nhận bản vá khớp md5 đích, tạo bản sao pg_temp cho
  -- 3 hàm đọc và helper chính sách Facebook (hàm thuần đọc).
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF NOT patched ? r.signature THEN
      INSERT INTO v530_cmp(check_name, ok, detail) VALUES ('already_applied', false, r.signature);
      CONTINUE;
    END IF;
    INSERT INTO v530_cmp(check_name, ok, detail) VALUES ('patch_dry_run', true, r.signature);
    IF r.signature ~ '^public\\.aka_agent_control_(campaign_page|account_snapshot|desktop_activity)\\(' THEN
      EXECUTE regexp_replace(patched->>r.signature, 'FUNCTION public\\.([a-z_]+)\\(', 'FUNCTION pg_temp.\\1_v530(');
    ELSIF r.signature LIKE 'private.aka_agent_web_facebook_campaigns_policy(%' THEN
      EXECUTE regexp_replace(patched->>r.signature, 'FUNCTION private\\.([a-z_]+)\\(', 'FUNCTION pg_temp.\\1_v530(');
    END IF;
  END LOOP;
"""
compare_do = do_block[:apply_begin] + compare_exec + do_block[apply_end:]

compare_runs = r"""
CREATE OR REPLACE FUNCTION pg_temp.v530_strip(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $strip$
  -- checkedAt = now() của giao dịch nên vốn trùng; bỏ cho chắc khi so.
  SELECT CASE WHEN jsonb_typeof(p->'desktopPresence') = 'object'
    THEN jsonb_set(p, '{desktopPresence}', (p->'desktopPresence') - 'checkedAt') ELSE p END
$strip$;

DO $compare$
DECLARE
  s record;
  t0 timestamptz;
  v_old jsonb;
  v_new jsonb;
  old_ms numeric;
  new_ms numeric;
  v_ids bigint[];
  i integer;
  k text;
  v_scope text[];
  -- Caller cũ: mọi bộ token không có 'email' (Web cũ, Web có Desktop, Web có Facebook).
  v_scopes constant jsonb := '{"legacy":["zalo","sms"],"desktop":["zalo","sms","zalo_qr","zalo_web"],
    "facebook":["zalo","sms","zalo_qr","zalo_web","facebook"]}';
  v_email text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook','email'];
  v_filters jsonb := jsonb_build_object('applyDisplaySettings', true,
    'dateFrom', to_char(timezone('Asia/Ho_Chi_Minh', now()) - interval '7 days', 'YYYY-MM-DD'),
    'dateTo', to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYY-MM-DD'));
  v_orgs bigint[];
  v_diff integer;
BEGIN
  -- 1. Caller cũ (không token 'email'): nhân viên có nhiều chiến dịch Email, Facebook, Zalo/SMS nhất
  --    (dòng Email phải vẫn bị loại). Kết quả cũ/mới phải giống hệt.
  FOR s IN
    (SELECT 'email' AS grp, c.staff_id, c.organization_id, count(*) AS n
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type = 'email'
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 2)
    UNION ALL
    (SELECT 'facebook', c.staff_id, c.organization_id, count(*)
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type = 'facebook'
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 2)
    UNION ALL
    (SELECT 'zalo_sms', c.staff_id, c.organization_id, count(*)
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type IN ('zalo', 'sms')
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 2)
  LOOP
    SELECT array_agg(a.id ORDER BY a.id) INTO v_ids FROM (
      SELECT a.id FROM auto_accounts a WHERE a.staff_id = s.staff_id AND a.organization_id = s.organization_id
        AND a.is_delete = false ORDER BY a.id LIMIT 100) a;
    FOR k IN SELECT jsonb_object_keys(v_scopes) LOOP
      SELECT array_agg(x ORDER BY o) INTO v_scope FROM jsonb_array_elements_text(v_scopes->k) WITH ORDINALITY AS y(x, o);
      old_ms := NULL; new_ms := NULL;
      FOR i IN 1..2 LOOP
        t0 := clock_timestamp();
        v_old := public.aka_agent_control_campaign_page(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
          p_platforms => v_scope, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
        old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
        t0 := clock_timestamp();
        v_new := pg_temp.aka_agent_control_campaign_page_v530(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
          p_platforms => v_scope, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('page_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      old_ms := NULL; new_ms := NULL;
      FOR i IN 1..2 LOOP
        t0 := clock_timestamp();
        v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope);
        old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
        t0 := clock_timestamp();
        v_new := pg_temp.aka_agent_control_account_snapshot_v530(s.staff_id, s.organization_id, v_scope);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('snapshot_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v530_strip(v_new) = pg_temp.v530_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' accounts=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_account_snapshot_v530(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('catalog_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v530_strip(v_new) = pg_temp.v530_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' catalog=' || COALESCE(jsonb_array_length(v_old->'catalog'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_desktop_activity(s.staff_id, s.organization_id, v_scope, NULL, 100);
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_desktop_activity_v530(s.staff_id, s.organization_id, v_scope, NULL, 100);
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('activity_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));
    END LOOP;
  END LOOP;

  -- 2. Đường Email mới (chưa ai gọi, chỉ đo và kiểm chỉ có dòng Email khi lọc nền tảng email).
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false AND a.flatform_type = 'email'
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_campaign_page_v530(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_email, p_filters => '{"platforms":["email"]}'::jsonb, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
    INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('page_email', s.staff_id, s.organization_id,
      (v_new->>'campaignTotal')::bigint > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'items') x
        WHERE x->>'platform' <> 'email' OR (x->>'isZaloServer')::boolean OR (x->>'isZaloShowWeb')::boolean),
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'campaigns=' || s.n || ' total=' || COALESCE(v_new->>'campaignTotal', '?'));

    SELECT array_agg(a.id ORDER BY a.id) INTO v_ids FROM (
      SELECT a.id FROM auto_accounts a WHERE a.staff_id = s.staff_id AND a.organization_id = s.organization_id
        AND a.is_delete = false ORDER BY a.id LIMIT 100) a;
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_account_snapshot_v530(s.staff_id, s.organization_id, v_email, 'campaigns', COALESCE(v_ids, '{}'));
    INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('snapshot_email', s.staff_id, s.organization_id,
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'catalog') x WHERE x->>'platform' = 'email')
        AND jsonb_typeof(v_new->'desktopPresence') = 'object',
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'catalog=' || COALESCE(jsonb_array_length(v_new->'catalog'), 0) || ' online=' || COALESCE(v_new->'desktopPresence'->>'online', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_desktop_activity_v530(s.staff_id, s.organization_id, ARRAY['email'], NULL, 100);
    INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('activity_email', s.staff_id, s.organization_id,
      v_new ? 'items' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'items') x WHERE x->>'accountType' <> 'email'),
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'items=' || COALESCE(jsonb_array_length(v_new->'items'), 0));
  END LOOP;

  -- 3. Chính sách Facebook: enabled/facebookOnlyLogin giống hệt cho mọi tổ chức có gói Facebook (và 0/NULL);
  --    authoring tắt vì dòng chính sách hiện tại chưa có nhánh authoring.
  SELECT array_agg(DISTINCT p.organization_id ORDER BY p.organization_id) INTO v_orgs
  FROM org_organization_product p WHERE p.product_id IN (3, 10, 13) AND p.is_deleted = false;
  v_orgs := COALESCE(v_orgs, '{}') || ARRAY[0::bigint, 1::bigint, NULL::bigint];
  SELECT count(*) INTO v_diff
  FROM unnest(v_orgs) AS o(id)
  WHERE (pg_temp.aka_agent_web_facebook_campaigns_policy_v530(o.id) - 'authoring')
      IS DISTINCT FROM private.aka_agent_web_facebook_campaigns_policy(o.id)
    OR jsonb_typeof(pg_temp.aka_agent_web_facebook_campaigns_policy_v530(o.id)->'authoring') IS DISTINCT FROM 'object';
  INSERT INTO v530_cmp(check_name, ok, detail)
  VALUES ('facebook_policy_same', v_diff = 0, 'orgs=' || cardinality(v_orgs) || ' diff=' || v_diff);
  -- Chỉ đo: số tổ chức được soạn Facebook theo giá trị chính sách hiện tại (chưa có nhánh authoring = 0).
  SELECT count(*) INTO v_diff FROM unnest(v_orgs) AS o(id)
  WHERE (pg_temp.aka_agent_web_facebook_campaigns_policy_v530(o.id)->'authoring'->>'enabled')::boolean;
  INSERT INTO v530_cmp(check_name, ok, detail) VALUES ('facebook_authoring_orgs', true, 'enabled=' || v_diff);
END
$compare$;
"""

compare_header = """-- v530 SO SÁNH TRƯỚC KHI APPLY — CHỈ ĐỌC. File sinh tự động bởi scripts/build-v530-sql.py
-- từ migrations/migration_v530_web_facebook_email_authoring.sql; đừng sửa tay.
-- Không tạo/sửa đối tượng public/private (bản sao nằm trong pg_temp; event trigger PostgREST bỏ qua pg_temp)
-- và không ghi dữ liệu nghiệp vụ. Không gọi hàm có ghi (tạo/sửa/thêm data/xoá/dừng/tiếp tục/xác thực).
-- Chạy trong MỘT phiên. Kết quả: patch_dry_run (11 hàm vá khớp md5 đích), *_same (caller cũ nhận đúng kết
-- quả cũ, kèm thời gian cũ/mới), *_email (đường Email mới, chỉ đo), facebook_policy_same.
"""
session_timeout = "SET statement_timeout = '110s';\n"
cmp_table = """CREATE TEMP TABLE IF NOT EXISTS v530_cmp (
  seq bigserial, check_name text, staff_id bigint, organization_id bigint,
  ok boolean, old_ms numeric, new_ms numeric, detail text
);
TRUNCATE v530_cmp;

"""
final_select = "\nSELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v530_cmp ORDER BY seq;\n"
compare_body = cmp_table + preflight + '\n' + helper + '\n' + compare_do + compare_runs
(tests_dir / 'migration_v530_web_facebook_email_authoring_compare.sql').write_text(
    compare_header + session_timeout + compare_body + final_select)

# 3. Áp một lần dán (SQL Editor).
assert migration.count('\nBEGIN;\n') == 1
stripped = migration.rstrip()
assert stripped.endswith('\nCOMMIT;')
migration_body = stripped[:-len('COMMIT;')].replace('\nBEGIN;\n', '\n', 1).rstrip() + '\n'

guarded_header = f"""-- v530 ÁP BẰNG SUPABASE SQL EDITOR — MỘT LẦN DÁN. File sinh tự động bởi
-- scripts/build-v530-sql.py; đừng sửa tay.
-- Một giao dịch: so sánh chỉ đọc → chốt chặn → migration v530 → ghi lịch sử migration.
-- Kiểm nào không đạt thì báo lỗi 'v530_...' và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có dòng cuối 'applied'. Chỉ chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL statement_timeout = '110s';

-- Đã apply rồi thì dừng ngay, không chạy lại.
DO $preguard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{NAME}')
     OR to_regprocedure('public.aka_agent_control_web_email_campaigns_policy(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'v530_guard_failed: v530 đã được apply trước đó, không chạy lại';
  END IF;
END
$preguard$;

"""
guard = f"""
-- Chốt chặn: bất kỳ kiểm nào không đạt thì RAISE, cả giao dịch rollback.
DO $guard$
DECLARE
  v_bad text;
  v_patch integer;
BEGIN
  SELECT count(*) INTO v_patch FROM v530_cmp WHERE check_name = 'patch_dry_run' AND ok IS TRUE;
  IF v_patch <> 11 THEN
    RAISE EXCEPTION 'v530_guard_failed: patch_dry_run %/11', v_patch;
  END IF;
  SELECT string_agg(check_name || COALESCE(' staff=' || staff_id, '') || COALESCE(' ' || detail, ''), '; ' ORDER BY seq)
  INTO v_bad
  FROM v530_cmp
  WHERE ok IS NOT TRUE
     OR (old_ms IS NOT NULL AND new_ms IS NOT NULL AND new_ms > old_ms * 2 AND new_ms > old_ms + 5);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'v530_guard_failed: %', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v530_cmp WHERE check_name = 'page_legacy_same')
     OR NOT EXISTS (SELECT 1 FROM v530_cmp WHERE check_name = 'snapshot_facebook_same')
     OR NOT EXISTS (SELECT 1 FROM v530_cmp WHERE check_name = 'facebook_policy_same') THEN
    RAISE EXCEPTION 'v530_guard_failed: thiếu dòng so sánh caller cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{NAME}') THEN
    RAISE EXCEPTION 'v530_guard_failed: lịch sử đã có {NAME}';
  END IF;
END
$guard$;

"""
record = f"""
-- Ghi lịch sử migration giống apply_migration (version = giờ UTC).
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'),
  '{NAME}',
  ARRAY[{TAG}{migration}{TAG}]
);
INSERT INTO v530_cmp (check_name, ok, detail)
SELECT 'applied', true, version || ' / ' || name
FROM supabase_migrations.schema_migrations WHERE name = '{NAME}';
COMMIT;
SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v530_cmp ORDER BY seq;
"""
(tests_dir / 'migration_v530_web_facebook_email_authoring_guarded_apply.sql').write_text(
    guarded_header + compare_body + guard + migration_body + record)

# 4. Smoke production sau apply (chỉ đọc, chạy trong BEGIN ... ROLLBACK).
new_values = ',\n'.join(f"    ('{f['signature']}', '{f['target']}', '{f['acl']}')" for f in new_functions)
service_only = [f['signature'] for f in new_functions if f['acl'] == '{postgres=X/postgres,service_role=X/postgres}']
assert len(service_only) == 6
service_values = ',\n'.join(f"    ('{s}')" for s in service_only)
smoke = f"""-- v530 KIỂM CHỈ ĐỌC TRÊN PRODUCTION SAU KHI APPLY. Chạy trong BEGIN ... ROLLBACK.
-- File sinh tự động bởi scripts/build-v530-sql.py; đừng sửa tay.
-- Không gọi hàm có ghi (xác thực, tạo/sửa/xoá, dừng/tiếp tục, liên kết, ghi khoá bộ chạy) và không in dữ liệu
-- khách: chỉ so phạm vi đọc cũ/mới trên vài nhân viên có tài khoản Email/Facebook, kết quả là một NOTICE.
SET LOCAL statement_timeout = '60s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  r record;
  legacy jsonb;
  mixed jsonb;
  em jsonb;
  fb jsonb;
  v_account bigint;
  n_email integer := 0;
  n_fb integer := 0;
  c_legacy constant text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook'];
  c_all constant text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook','email'];
BEGIN
  -- 11 hàm vá ở đúng md5 đích; 12 hàm mới đúng md5 và ACL.
  FOR r IN SELECT * FROM (VALUES
{spec_values}
  ) AS x(signature, source_md5, target_md5) LOOP
    ASSERT md5(pg_get_functiondef(r.signature::regprocedure)) = r.target_md5, 'target ' || r.signature;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
{new_values}
  ) AS x(signature, target_md5, acl) LOOP
    ASSERT md5(pg_get_functiondef(r.signature::regprocedure)) = r.target_md5, 'new function ' || r.signature;
    ASSERT (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.signature::regprocedure) = r.acl, 'acl ' || r.signature;
  END LOOP;

  -- Email: token 'email' chỉ thêm dòng Email; caller không gửi token không thấy Email.
  FOR r IN
    SELECT a.staff_id, a.organization_id, max(a.id) AS account_id FROM public.auto_accounts a
    WHERE a.is_delete = false AND a.flatform_type = 'email'
      AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.id = a.staff_id AND s.organization_id = a.organization_id AND s.is_active IS TRUE)
    GROUP BY 1, 2 ORDER BY max(a.id) DESC LIMIT 5
  LOOP
    n_email := n_email + 1;
    legacy := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, c_legacy);
    mixed := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, c_all);
    em := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['email']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(legacy->'items') x WHERE x->>'platform' = 'email'), 'legacy page has no email';
    ASSERT (mixed->>'campaignTotal')::integer = (legacy->>'campaignTotal')::integer + (em->>'campaignTotal')::integer, 'page union';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(em->'items') x WHERE x->>'platform' <> 'email'
      OR (x->>'isZaloServer')::boolean OR (x->>'isZaloShowWeb')::boolean), 'email page only email, desktop runtime';
    legacy := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, c_legacy);
    em := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, ARRAY['email']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(legacy->'items') x WHERE x->'metadata'->>'flatform_type' = 'email'),
      'legacy snapshot has no email';
    ASSERT jsonb_array_length(em->'items') > 0, 'email accounts listed';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(em->'items') x WHERE x->'metadata'->>'flatform_type' <> 'email'),
      'email snapshot only email';
    ASSERT jsonb_typeof(em->'desktopPresence') = 'object', 'email snapshot has presence';
    ASSERT position('email_session' in em::text) = 0, 'snapshot never returns smtp session';
    em := public.aka_agent_control_desktop_activity(r.staff_id, r.organization_id, ARRAY['email']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(em->'items') x WHERE x->>'accountType' <> 'email'), 'email activity only';
    -- Phiên SMTP chỉ đọc qua hàm riêng (không in ra): tài khoản của chính nhân viên thấy được, id lạ thì không.
    ASSERT (public.aka_agent_control_email_account_session(r.staff_id, r.organization_id, r.account_id)->>'found')::boolean,
      'email session readable';
    ASSERT public.aka_agent_control_email_account_session(r.staff_id, r.organization_id, 9000000000000) = '{{"found": false}}'::jsonb,
      'missing email account';
  END LOOP;
  ASSERT n_email > 0, 'requires staff with email accounts';

  -- Facebook: token 'facebook' của v476 giữ nguyên phạm vi.
  FOR r IN
    SELECT a.staff_id, a.organization_id FROM public.auto_accounts a
    WHERE a.is_delete = false AND a.flatform_type = 'facebook'
      AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.id = a.staff_id AND s.organization_id = a.organization_id AND s.is_active IS TRUE)
    GROUP BY 1, 2 ORDER BY max(a.id) DESC LIMIT 3
  LOOP
    n_fb := n_fb + 1;
    legacy := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['zalo','sms','zalo_qr','zalo_web']);
    mixed := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, c_legacy);
    fb := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['facebook']);
    ASSERT (mixed->>'campaignTotal')::integer = (legacy->>'campaignTotal')::integer + (fb->>'campaignTotal')::integer,
      'facebook page union';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(fb->'items') x WHERE x->>'platform' <> 'facebook'), 'facebook page only';
  END LOOP;
  ASSERT n_fb > 0, 'requires staff with facebook accounts';

  -- Chính sách: đọc được; Email có dòng cấu hình; Facebook có nhánh authoring.
  ASSERT public.aka_agent_control_web_email_campaigns_policy(1) ?& ARRAY['enabled','emailOnlyLogin','authoring'], 'email policy';
  ASSERT jsonb_typeof(public.aka_agent_control_web_facebook_campaigns_policy(1)->'authoring') = 'object', 'facebook authoring';
  ASSERT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.email_campaigns'), 'email policy row';

  -- Quyền: RPC Control chỉ service_role; RPC bộ chạy chỉ aka_agent_desktop (cần quyền cột + RLS của phiên).
  FOR r IN SELECT * FROM (VALUES
{service_values}
  ) AS x(signature) LOOP
    ASSERT has_function_privilege('service_role', r.signature, 'EXECUTE'), 'service_role ' || r.signature;
    ASSERT NOT has_function_privilege('anon', r.signature, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', r.signature, 'EXECUTE')
      AND NOT has_function_privilege('aka_agent_desktop', r.signature, 'EXECUTE')
      AND NOT has_function_privilege('aka_agent_chat_api', r.signature, 'EXECUTE'), 'only service_role ' || r.signature;
  END LOOP;
  ASSERT has_function_privilege('aka_agent_desktop', 'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])', 'EXECUTE');
  ASSERT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'UPDATE')
    AND has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'UPDATE'), 'desktop column privileges';
  ASSERT NOT has_function_privilege('service_role', 'private.aka_agent_web_email_campaigns_policy(bigint)', 'EXECUTE');
  RAISE NOTICE 'v530 production smoke passed (email staff %, facebook staff %)', n_email, n_fb;
END
$smoke$;
"""
(tests_dir / 'migration_v530_web_facebook_email_authoring_smoke.sql').write_text(smoke)

# 5. Thử trên production trong giao dịch tự huỷ: migration + smoke rồi RAISE để huỷ toàn bộ (không COMMIT, không sổ).
smoke_body = smoke[smoke.index('SET LOCAL statement_timeout'):]
trial = f"""-- v530 THỬ TRÊN PRODUCTION TRONG GIAO DỊCH TỰ HUỶ. File sinh tự động bởi scripts/build-v530-sql.py; đừng sửa tay.
-- Chạy migration v530 rồi smoke chỉ đọc trong MỘT giao dịch, cuối cùng RAISE để huỷ toàn bộ: không bao giờ COMMIT,
-- không ghi sổ migration, NOTIFY nạp lại schema của PostgREST không được gửi (chỉ gửi khi COMMIT).
-- Chỉ chạy ngoài 10:00–11:30 và 14:00–16:00 VN (CREATE OR REPLACE giữ khoá dòng pg_proc tới khi huỷ).
-- Kết quả đạt: lỗi 'v530_trial_ok: ...'. Lỗi khác (v530_..., assertion) = bước đó không đạt; đều đã huỷ.
BEGIN;
{migration_body}
{smoke_body}RESET ROLE;
DO $trial$
BEGIN
  RAISE EXCEPTION 'v530_trial_ok: migration + smoke đạt, giao dịch đã huỷ (không COMMIT, không ghi sổ)';
END
$trial$;
ROLLBACK;
"""
assert 'COMMIT;' not in trial.replace('không COMMIT', '').replace('khi COMMIT', '')
(tests_dir / 'migration_v530_web_facebook_email_authoring_rollback_trial.sql').write_text(trial)

for path in ('migrations/snapshots/web-facebook-email-authoring-v530/rollback.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_compare.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_guarded_apply.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_smoke.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_rollback_trial.sql'):
    print(f'wrote {path} ({len((root / path).read_text())} bytes)')
