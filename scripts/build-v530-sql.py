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

# 5. Thử trên production trong giao dịch tự huỷ: migration + smoke chỉ đọc + mỗi đường GHI một lần, rồi RAISE để huỷ
#    toàn bộ (không COMMIT, không sổ). Ngân sách thời gian: migration ≤ 30 s, smoke ≤ 35 s, đường ghi ≤ 30 s.
smoke_body = smoke[smoke.index('SET LOCAL statement_timeout'):]
assert smoke_body.count("SET LOCAL statement_timeout = '60s';") == 1
trial_smoke = smoke_body.replace("SET LOCAL statement_timeout = '60s';", "SET LOCAL statement_timeout = '35s';")
assert migration_body.count("SET LOCAL statement_timeout = '60s';") == 1
trial_migration = migration_body.replace("SET LOCAL statement_timeout = '60s';", "SET LOCAL statement_timeout = '20s';")

def trial_budget(seconds, label):
    return f"""DO $budget$
BEGIN
  IF clock_timestamp() - transaction_timestamp() > interval '{seconds} seconds' THEN
    RAISE EXCEPTION 'v530_trial_budget_exceeded: {label} (% s)', round(extract(epoch FROM clock_timestamp() - transaction_timestamp()));
  END IF;
END
$budget$;
"""

trial_writes = r"""-- Đường GHI: mỗi RPC ghi của v530 chạy một lần với trigger và RLS thật của production, trên một nhân viên chọn
-- động (ưu tiên tổ chức 1, app Desktop đang tắt, tài khoản Facebook không chạy). Mọi dòng tạo ra đều bị huỷ cùng
-- giao dịch. Bước bị luật tách quyền từ chối (app_access_*) ghi "blocked", không tính là hỏng.
SET LOCAL statement_timeout = '30s';
DO $writes$
DECLARE
  c_tag constant text := 'v530-trial:' || txid_current()::text;
  c_session constant jsonb := '{"brandName":"v530 trial","host":"smtp.invalid","port":587,"secure":false,
    "user":"v530-trial@example.invalid","pass":"v530-trial-secret","fromEmail":"v530-trial@example.invalid","replyTo":"","cc":""}';
  c_link_keys constant jsonb := '{"facebook_message_uid":"findUidTargetCampaignIds",
    "facebook_group_post":"findFacebookGroupPostTargetCampaignIds","facebook_comment_seeding_post":"findPostLinkTargetCampaignIds",
    "facebook_comment_seeding":"findFacebookGroupCommentTargetCampaignIds","facebook_join_group":"findFacebookGroupJoinTargetCampaignIds"}';
  v_try bigint;
  v_staff bigint;
  v_org bigint;
  v_app_online boolean;
  v_fb_account bigint;
  v_email_account bigint;
  v_trial_account bigint;
  v_action text;
  v_source bigint;
  v_foreign bigint;
  v_auth uuid;
  v_fb_campaign bigint;
  v_email_campaign bigint;
  v_ts timestamptz;
  v jsonb;
  v_row record;
  v_notes text[] := ARRAY[]::text[];
  v_failed integer := 0;
  v_state text;
  v_message text;
BEGIN
  -- Chọn nhân viên thử (đọc bằng quyền chủ sở hữu, trước khi đổi vai trò).
  FOREACH v_try IN ARRAY ARRAY[1, NULL]::bigint[] LOOP
    SELECT c.staff_id, c.organization_id, c.app_online INTO v_staff, v_org, v_app_online
    FROM (
      SELECT s.id AS staff_id, s.organization_id,
        EXISTS (SELECT 1 FROM public.auto_staff_device_presence p WHERE p.staff_id = s.id AND p.ended_at IS NULL
          AND p.last_seen_at >= now() - interval '5 minutes') AS app_online,
        EXISTS (SELECT 1 FROM public.auto_accounts e WHERE e.staff_id = s.id AND e.organization_id = s.organization_id
          AND e.flatform_type = 'email' AND COALESCE(e.is_delete, false) = false AND COALESCE(e.is_active, true)) AS has_email,
        EXISTS (SELECT 1 FROM private.aka_agent_desktop_users u WHERE u.staff_id = s.id) AS has_desktop_user
      FROM public.org_staff s
      WHERE s.is_active IS TRUE AND s.deleted_at IS NULL AND COALESCE(s.is_aka_agent_enabled, true)
        AND (v_try IS NULL OR s.organization_id = v_try)
        AND EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.staff_id = s.id AND a.organization_id = s.organization_id
          AND a.flatform_type = 'facebook' AND COALESCE(a.is_delete, false) = false AND COALESCE(a.is_active, true)
          AND COALESCE(a.is_aka_agent_enabled, true) AND a.status IS DISTINCT FROM 'đang chạy'
          AND a.runtime_operation_claim_token IS NULL)
    ) c
    ORDER BY c.app_online, c.has_email DESC, c.has_desktop_user DESC, c.staff_id
    LIMIT 1;
    EXIT WHEN v_staff IS NOT NULL;
  END LOOP;
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'v530_trial_failed: không có nhân viên đang hoạt động nào có tài khoản Facebook rảnh để thử đường ghi';
  END IF;
  SELECT a.id INTO v_fb_account FROM public.auto_accounts a
  WHERE a.staff_id = v_staff AND a.organization_id = v_org AND a.flatform_type = 'facebook'
    AND COALESCE(a.is_delete, false) = false AND COALESCE(a.is_active, true) AND COALESCE(a.is_aka_agent_enabled, true)
    AND a.status IS DISTINCT FROM 'đang chạy' AND a.runtime_operation_claim_token IS NULL
  ORDER BY a.id LIMIT 1;
  SELECT a.id INTO v_email_account FROM public.auto_accounts a
  WHERE a.staff_id = v_staff AND a.organization_id = v_org AND a.flatform_type = 'email'
    AND COALESCE(a.is_delete, false) = false AND COALESCE(a.is_active, true) AND COALESCE(a.is_aka_agent_enabled, true)
    AND a.status IS DISTINCT FROM 'đang chạy'
  ORDER BY a.id LIMIT 1;
  SELECT action.id INTO v_action FROM public.auto_campaign_actions action
  WHERE action.flatform_type = 'facebook' AND COALESCE(action.is_delete, false) = false AND COALESCE(action.is_active, true)
    AND c_link_keys ? action.id
  ORDER BY (action.id = 'facebook_message_uid') DESC, action.id LIMIT 1;
  -- Chiến dịch tìm data đang rảnh của chính nhân viên (không chạy, không lease) để thử liên kết.
  SELECT c.id INTO v_source FROM public.auto_campaigns c
  WHERE c.staff_id = v_staff AND c.organization_id = v_org AND COALESCE(c.is_delete, false) = false
    AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search')
    AND c.status IS DISTINCT FROM 'đang chạy' AND c.runtime_claim_token IS NULL AND c.runtime_unit_token IS NULL
  ORDER BY c.id DESC LIMIT 1;
  -- Chiến dịch đã xoá của nhân viên khác: RLS phiên Desktop phải không cho ghi.
  SELECT c.id INTO v_foreign FROM public.auto_campaigns c
  WHERE c.staff_id IS DISTINCT FROM v_staff AND c.is_delete = true ORDER BY c.id DESC LIMIT 1;
  SELECT u.auth_user_id INTO v_auth FROM private.aka_agent_desktop_users u WHERE u.staff_id = v_staff;
  v_notes := v_notes || format('staff=%s org=%s app_online=%s fb_account=%s action=%s', v_staff, v_org, v_app_online, v_fb_account,
    COALESCE(v_action, 'none'));

  -- Như Control API: vai trò service_role.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;

  -- 1. Tạo chiến dịch Facebook tạm dừng với một dòng data.
  BEGIN
    IF v_action IS NULL THEN RAISE EXCEPTION 'không có loại chiến dịch Facebook phù hợp'; END IF;
    v := public.create_control_campaign_v2(v_staff, v_org, c_tag || ':fb',
      jsonb_build_object('name', '[v530 trial] Facebook', 'actionId', v_action, 'accountId', v_fb_account,
        'schedule', now() + interval '30 days', 'content', 'v530 trial', 'scheduleType', 'daily',
        'extraSettings', jsonb_build_object('v530Trial', 1), 'images', '[]'::jsonb, 'webCampaignForm', 'form_1'),
      jsonb_build_array(jsonb_build_object('uid', '100000000000001', 'name', 'v530 trial')), 'tạm dừng');
    v_fb_campaign := (v->>'campaign_id')::bigint;
    SELECT c.status, c.secondary_account_id, c.web_campaign_form,
      (SELECT count(*) FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id) AS inputs
    INTO v_row FROM public.auto_campaigns c WHERE c.id = v_fb_campaign;
    IF (v->>'created')::boolean IS NOT TRUE OR v_row.status IS DISTINCT FROM 'tạm dừng' OR v_row.inputs <> 1
      OR v_row.secondary_account_id IS NOT NULL OR v_row.web_campaign_form IS DISTINCT FROM 'form_1' THEN
      RAISE EXCEPTION 'kết quả lạ: % / %', v, to_jsonb(v_row);
    END IF;
    v_notes := v_notes || format('fb_create=ok(%s)', v_fb_campaign);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    v_fb_campaign := NULL;
    v_failed := v_failed + CASE WHEN v_message LIKE 'app_access_%' THEN 0 ELSE 1 END;
    v_notes := v_notes || format('fb_create=%s(%s %s)', CASE WHEN v_message LIKE 'app_access_%' THEN 'blocked' ELSE 'FAILED' END, v_state, left(v_message, 140));
  END;

  -- 2. Sửa (tên, bỏ tài khoản phụ, extra_settings có khoá bộ chạy sở hữu) và 3. thêm data.
  IF v_fb_campaign IS NULL THEN
    v_notes := v_notes || 'fb_update=skipped fb_add_rows=skipped'::text;
  ELSE
    BEGIN
      SELECT c.updated_at INTO v_ts FROM public.auto_campaigns c WHERE c.id = v_fb_campaign;
      v := public.update_control_campaign_atomic(v_staff, v_org, v_fb_campaign, v_ts,
        jsonb_build_object('name', '[v530 trial] Facebook (đã sửa)', 'secondary_account_id', NULL,
          'extra_settings', jsonb_build_object('v530Trial', 2, 'contentRotationIndex', 99, 'zaloFriendDataMaterializedAt', 'x')));
      SELECT c.name, c.status, c.secondary_account_id, c.extra_settings INTO v_row FROM public.auto_campaigns c WHERE c.id = v_fb_campaign;
      IF (v->>'updated')::boolean IS NOT TRUE OR v_row.name <> '[v530 trial] Facebook (đã sửa)' OR v_row.status <> 'tạm dừng'
        OR v_row.secondary_account_id IS NOT NULL OR v_row.extra_settings IS DISTINCT FROM '{"v530Trial":2}'::jsonb THEN
        RAISE EXCEPTION 'kết quả lạ: % / %', v, to_jsonb(v_row);
      END IF;
      v_notes := v_notes || 'fb_update=ok'::text;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_failed := v_failed + CASE WHEN v_message LIKE 'app_access_%' THEN 0 ELSE 1 END;
      v_notes := v_notes || format('fb_update=%s(%s %s)', CASE WHEN v_message LIKE 'app_access_%' THEN 'blocked' ELSE 'FAILED' END, v_state, left(v_message, 140));
    END;
    BEGIN
      v := public.add_control_campaign_input_rows(v_staff, v_org, v_fb_campaign, c_tag || ':fb:rows', 1,
        '[{"uid":"100000000000002","name":"v530 trial 2"},{"uid":100000000000003}]'::jsonb, now() + interval '30 days', 'tạm dừng');
      SELECT c.status, (SELECT count(*) FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id) AS inputs
      INTO v_row FROM public.auto_campaigns c WHERE c.id = v_fb_campaign;
      IF (v->>'inserted')::integer IS DISTINCT FROM 2 OR v_row.inputs <> 3 OR v_row.status <> 'tạm dừng' THEN
        RAISE EXCEPTION 'kết quả lạ: % / %', v, to_jsonb(v_row);
      END IF;
      v_notes := v_notes || 'fb_add_rows=ok'::text;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_failed := v_failed + CASE WHEN v_message LIKE 'app_access_%' THEN 0 ELSE 1 END;
      v_notes := v_notes || format('fb_add_rows=%s(%s %s)', CASE WHEN v_message LIKE 'app_access_%' THEN 'blocked' ELSE 'FAILED' END, v_state, left(v_message, 140));
    END;
  END IF;

  -- 4. Tài khoản Email: tạo (kết nối chưa đạt), 5. sửa cấu hình không gửi mật khẩu với p_verified NULL (giữ trạng thái).
  BEGIN
    v := public.create_control_email_account_atomic(v_staff, v_org, '[v530 trial] Email', c_session, false, 'v530 trial: không kiểm tra kết nối', NULL, NULL);
    IF (v->>'created')::boolean IS NOT TRUE THEN
      v_notes := v_notes || format('email_account_create=not_created(%s)', v->>'reason');
    ELSE
      v_trial_account := (v->>'account_id')::bigint;
      IF v::text LIKE '%v530-trial-secret%' OR v->'account'->'email_session' ? 'pass'
        OR NOT EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.id = v_trial_account AND a.flatform_type = 'email'
          AND a.login_status = 'chưa đăng nhập' AND a.email_session->>'pass' = 'v530-trial-secret' AND a.staff_id = v_staff) THEN
        RAISE EXCEPTION 'kết quả lạ (mật khẩu trong kết quả hoặc dòng sai)';
      END IF;
      v_notes := v_notes || format('email_account_create=ok(%s)', v_trial_account);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    v_trial_account := NULL;
    v_failed := v_failed + CASE WHEN v_message LIKE 'app_access_%' THEN 0 ELSE 1 END;
    v_notes := v_notes || format('email_account_create=%s(%s %s)', CASE WHEN v_message LIKE 'app_access_%' THEN 'blocked' ELSE 'FAILED' END, v_state, left(v_message, 140));
  END;
  IF v_trial_account IS NULL THEN
    v_notes := v_notes || 'email_account_update=skipped'::text;
  ELSE
    BEGIN
      SELECT a.updated_at INTO v_ts FROM public.auto_accounts a WHERE a.id = v_trial_account;
      v := public.update_control_email_account_atomic(v_staff, v_org, v_trial_account, v_ts, '[v530 trial] Email (đã sửa)',
        (c_session - 'pass') || '{"brandName":"v530 trial 2","port":"465","secure":true}'::jsonb, NULL, NULL, NULL);
      IF (v->>'updated')::boolean IS NOT TRUE
        OR NOT EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.id = v_trial_account AND a.name = '[v530 trial] Email (đã sửa)'
          AND a.login_status = 'chưa đăng nhập' AND a.email_session_last_error = 'v530 trial: không kiểm tra kết nối'
          AND a.email_session->>'pass' = 'v530-trial-secret' AND a.email_session->'port' = '465'::jsonb
          AND a.email_session->'secure' = 'true'::jsonb AND a.email_session->>'brandName' = 'v530 trial 2') THEN
        RAISE EXCEPTION 'kết quả lạ: %', v - 'account';
      END IF;
      v_notes := v_notes || 'email_account_update=ok'::text;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_failed := v_failed + CASE WHEN v_message LIKE 'app_access_%' THEN 0 ELSE 1 END;
      v_notes := v_notes || format('email_account_update=%s(%s %s)', CASE WHEN v_message LIKE 'app_access_%' THEN 'blocked' ELSE 'FAILED' END, v_state, left(v_message, 140));
    END;
  END IF;

  -- 6. Tạo chiến dịch Email tạm dừng (tài khoản Email có sẵn của nhân viên, không có thì tài khoản vừa tạo).
  IF COALESCE(v_email_account, v_trial_account) IS NULL THEN
    v_notes := v_notes || 'email_campaign_create=skipped(không có tài khoản Email)'::text;
  ELSE
    BEGIN
      v := public.create_control_campaign_v2(v_staff, v_org, c_tag || ':email',
        jsonb_build_object('name', '[v530 trial] Email', 'actionId', 'email_send', 'accountId', COALESCE(v_email_account, v_trial_account),
          'schedule', now() + interval '30 days', 'content', '<p>v530 trial</p>', 'scheduleType', 'daily',
          'extraSettings', jsonb_build_object('emailSubject', 'v530 trial', 'emailBodyIsHtml', true), 'images', '[]'::jsonb,
          'webCampaignForm', 'form_1'),
        '[{"email":"v530-trial@example.invalid","name":"v530 trial"}]'::jsonb, 'tạm dừng');
      v_email_campaign := (v->>'campaign_id')::bigint;
      IF (v->>'created')::boolean IS NOT TRUE OR (v->>'input_count')::integer <> 1
        OR NOT EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.id = v_email_campaign AND c.status = 'tạm dừng' AND c.action_id = 'email_send') THEN
        RAISE EXCEPTION 'kết quả lạ: %', v;
      END IF;
      v_notes := v_notes || format('email_campaign_create=ok(%s, account %s)', v_email_campaign,
        CASE WHEN v_email_account IS NULL THEN 'trial' ELSE 'existing' END);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_failed := v_failed + CASE WHEN v_message LIKE 'app_access_%' THEN 0 ELSE 1 END;
      v_notes := v_notes || format('email_campaign_create=%s(%s %s)', CASE WHEN v_message LIKE 'app_access_%' THEN 'blocked' ELSE 'FAILED' END, v_state, left(v_message, 140));
    END;
  END IF;

  -- 7. Xoá mềm tài khoản Email vừa tạo.
  IF v_trial_account IS NULL THEN
    v_notes := v_notes || 'email_account_delete=skipped'::text;
  ELSE
    BEGIN
      v := public.delete_control_email_account_atomic(v_staff, v_org, v_trial_account);
      IF (v->>'deleted')::boolean IS NOT TRUE
        OR NOT EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.id = v_trial_account AND a.is_delete AND NOT a.is_active) THEN
        RAISE EXCEPTION 'kết quả lạ: %', v;
      END IF;
      v_notes := v_notes || 'email_account_delete=ok'::text;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_failed := v_failed + CASE WHEN v_message LIKE 'app_access_%' THEN 0 ELSE 1 END;
      v_notes := v_notes || format('email_account_delete=%s(%s %s)', CASE WHEN v_message LIKE 'app_access_%' THEN 'blocked' ELSE 'FAILED' END, v_state, left(v_message, 140));
    END;
  END IF;

  -- 8. Liên kết chiến dịch tìm data → chiến dịch Facebook vừa tạo: thêm, thêm lại (không đổi), bớt.
  IF v_fb_campaign IS NULL OR v_source IS NULL THEN
    v_notes := v_notes || format('find_data_link=skipped(%s)',
      CASE WHEN v_fb_campaign IS NULL THEN 'không có chiến dịch Facebook thử' ELSE 'nhân viên không có chiến dịch tìm data đang rảnh' END);
  ELSE
    BEGIN
      v := public.aka_agent_control_link_find_data_target(v_staff, v_org, ARRAY[v_source], v_fb_campaign, c_link_keys->>v_action, true);
      IF (v->>'ok')::boolean IS NOT TRUE OR v->'changedSourceIds' IS DISTINCT FROM jsonb_build_array(v_source)
        OR NOT (SELECT c.extra_settings->(c_link_keys->>v_action) @> to_jsonb(v_fb_campaign) FROM public.auto_campaigns c WHERE c.id = v_source) THEN
        RAISE EXCEPTION 'thêm: %', v;
      END IF;
      v := public.aka_agent_control_link_find_data_target(v_staff, v_org, ARRAY[v_source], v_fb_campaign, c_link_keys->>v_action, true);
      IF (v->>'ok')::boolean IS NOT TRUE OR v->'unchangedSourceIds' IS DISTINCT FROM jsonb_build_array(v_source) THEN
        RAISE EXCEPTION 'thêm lại: %', v;
      END IF;
      v := public.aka_agent_control_link_find_data_target(v_staff, v_org, ARRAY[v_source], v_fb_campaign, c_link_keys->>v_action, false);
      IF (v->>'ok')::boolean IS NOT TRUE OR v->'changedSourceIds' IS DISTINCT FROM jsonb_build_array(v_source)
        OR (SELECT c.extra_settings->(c_link_keys->>v_action) @> to_jsonb(v_fb_campaign) FROM public.auto_campaigns c WHERE c.id = v_source) THEN
        RAISE EXCEPTION 'bớt: %', v;
      END IF;
      v_notes := v_notes || format('find_data_link=ok(source %s, %s)', v_source, c_link_keys->>v_action);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_failed := v_failed + 1;
      v_notes := v_notes || format('find_data_link=FAILED(%s %s)', v_state, left(v_message, 140));
    END;
  END IF;

  -- 9. Bộ chạy Desktop ghi từng khoá: vai trò aka_agent_desktop + JWT của chính nhân viên (quyền cột, RLS, trigger sở
  --    hữu thật); chiến dịch của nhân viên khác phải không ghi được. 10. Sau đó Web sửa không đè được khoá bộ chạy.
  IF v_fb_campaign IS NULL OR v_auth IS NULL THEN
    v_notes := v_notes || format('desktop_merge=skipped(%s)',
      CASE WHEN v_fb_campaign IS NULL THEN 'không có chiến dịch Facebook thử' ELSE 'nhân viên chưa có phiên Desktop 9.x' END);
  ELSE
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'aka_agent_desktop', 'sub', v_auth)::text, true);
      SET LOCAL ROLE aka_agent_desktop;
      v := public.aka_agent_desktop_merge_campaign_runtime_settings(v_fb_campaign,
        '{"contentRotationIndex":3,"sourceLinkIndex":1}'::jsonb, ARRAY['postBumpRotationIndex', 'v530Trial']);
      IF (v->>'updated')::boolean IS NOT TRUE OR v->>'updatedAt' IS NULL THEN
        RAISE EXCEPTION 'ghi chiến dịch của chính mình: %', v;
      END IF;
      IF v_foreign IS NOT NULL THEN
        v := public.aka_agent_desktop_merge_campaign_runtime_settings(v_foreign, '{"v530Trial":true}'::jsonb);
        IF (v->>'updated')::boolean IS NOT FALSE THEN
          RAISE EXCEPTION 'RLS cho phiên Desktop ghi chiến dịch % của nhân viên khác', v_foreign;
        END IF;
      END IF;
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
      SET LOCAL ROLE service_role;
      IF (SELECT c.extra_settings FROM public.auto_campaigns c WHERE c.id = v_fb_campaign)
        IS DISTINCT FROM '{"contentRotationIndex":3,"sourceLinkIndex":1}'::jsonb THEN
        RAISE EXCEPTION 'extra_settings sau khi ghi từng khoá: %', (SELECT c.extra_settings FROM public.auto_campaigns c WHERE c.id = v_fb_campaign);
      END IF;
      v_notes := v_notes || format('desktop_merge=ok desktop_merge_foreign=%s', CASE WHEN v_foreign IS NULL THEN 'skipped' ELSE 'denied' END);
      SELECT c.updated_at INTO v_ts FROM public.auto_campaigns c WHERE c.id = v_fb_campaign;
      v := public.update_control_campaign_atomic(v_staff, v_org, v_fb_campaign, v_ts,
        '{"extra_settings":{"contentRotationIndex":99,"postBumpRotationIndex":5,"v530Trial":3}}'::jsonb);
      IF (v->>'updated')::boolean IS NOT TRUE OR (SELECT c.extra_settings FROM public.auto_campaigns c WHERE c.id = v_fb_campaign)
        IS DISTINCT FROM '{"contentRotationIndex":3,"sourceLinkIndex":1,"v530Trial":3}'::jsonb THEN
        RAISE EXCEPTION 'Web sửa sau khi bộ chạy ghi: % / %', v, (SELECT c.extra_settings FROM public.auto_campaigns c WHERE c.id = v_fb_campaign);
      END IF;
      v_notes := v_notes || 'web_update_keeps_runtime_keys=ok'::text;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_failed := v_failed + 1;
      v_notes := v_notes || format('desktop_merge=FAILED(%s %s)', v_state, left(v_message, 140));
    END;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'v530_trial_failed: migration + smoke đạt; % bước ghi hỏng: % (giao dịch đã huỷ)', v_failed, array_to_string(v_notes, '; ');
  END IF;
  RAISE EXCEPTION 'v530_trial_ok: migration + smoke đạt; đường ghi: %; giao dịch đã huỷ (không COMMIT, không ghi sổ)', array_to_string(v_notes, '; ');
END
$writes$;
"""

trial = f"""-- v530 THỬ TRÊN PRODUCTION TRONG GIAO DỊCH TỰ HUỶ. File sinh tự động bởi scripts/build-v530-sql.py; đừng sửa tay.
-- Trong MỘT giao dịch: migration v530 → smoke chỉ đọc → mỗi đường GHI của v530 chạy một lần với trigger/RLS thật
-- (tạo/sửa/thêm data chiến dịch Facebook, tạo/sửa/xoá tài khoản Email, tạo chiến dịch Email, liên kết tìm data, RPC
-- ghi từng khoá bằng vai trò aka_agent_desktop) → RAISE để huỷ toàn bộ. Không bao giờ COMMIT, không ghi sổ migration,
-- NOTIFY nạp lại schema của PostgREST không được gửi (chỉ gửi khi COMMIT); id của sequence bị tiêu vài số.
-- Chỉ chạy ngoài 10:00–11:30 và 14:00–16:00 VN: CREATE OR REPLACE giữ khoá dòng pg_proc, bước ghi giữ khoá dòng tài
-- khoản Facebook/Email của nhân viên thử và khoá hạn mức tài khoản của nhân viên đó tới khi huỷ (vài giây).
-- Giới hạn thời gian: migration ≤ 30 s, smoke ≤ 35 s/câu, đường ghi ≤ 30 s (tổng ≤ 100 s), lock_timeout 5 s.
-- Kết quả đạt: lỗi 'v530_trial_ok: ...' liệt kê từng bước (ok / skipped / blocked = luật tách quyền từ chối).
-- 'v530_trial_failed: ...' hoặc lỗi khác (v530_..., assertion) = có bước không đạt; mọi trường hợp đều đã huỷ.
BEGIN;
-- PostgreSQL 17+ (production): chặn cứng cả giao dịch ở 100 giây (quá hạn thì phiên bị ngắt, giao dịch tự huỷ).
-- PostgreSQL 16 (test cục bộ) chưa có tham số này; khi đó chỉ còn các giới hạn theo từng câu ở dưới.
DO $limit$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    PERFORM set_config('transaction_timeout', '100s', true);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$limit$;
{trial_migration}
{trial_budget(30, 'migration')}{trial_smoke}RESET ROLE;
{trial_budget(65, 'smoke')}{trial_writes}ROLLBACK;
"""
assert 'COMMIT;' not in trial.replace('không COMMIT', '').replace('khi COMMIT', '').replace('bao giờ COMMIT', '')
(tests_dir / 'migration_v530_web_facebook_email_authoring_rollback_trial.sql').write_text(trial)

for path in ('migrations/snapshots/web-facebook-email-authoring-v530/rollback.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_compare.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_guarded_apply.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_smoke.sql',
             'migrations/tests/migration_v530_web_facebook_email_authoring_rollback_trial.sql'):
    print(f'wrote {path} ({len((root / path).read_text())} bytes)')
