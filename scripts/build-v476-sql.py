#!/usr/bin/env python3
"""Sinh ba file SQL của v476 từ migration + baseline, để chúng không lệch nhau:

1. migrations/snapshots/web-facebook-campaigns-v476/rollback.sql
   Rollback có guard md5 (nguồn hoặc đích), khôi phục 6 định nghĩa trong baseline.sql,
   bỏ 2 hàm chính sách mới và khoá cấu hình 'web.facebook_campaigns'.
2. migrations/tests/migration_v476_web_facebook_campaigns_compare.sql
   So sánh CHỈ ĐỌC trên production trước khi apply: chạy đúng phần preflight + dựng bản vá của
   migration, nhưng không EXECUTE lên public mà tạo bản sao pg_temp cho 3 hàm đọc, rồi so caller cũ
   (không token 'facebook') cũ/mới trên nhân viên thật và đo đường Facebook mới.
3. migrations/tests/migration_v476_web_facebook_campaigns_guarded_apply.sql
   Áp bằng MỘT LẦN DÁN vào Supabase SQL Editor (khi không bấm được thẻ xác nhận MCP): một giao dịch
   so sánh → chốt chặn → migration → ghi lịch sử migration giống apply_migration.

Chạy lại mỗi khi sửa migration hoặc baseline:
    python3 scripts/build-v476-sql.py
"""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
migration_path = root / 'migrations/migration_v476_web_facebook_campaigns.sql'
snapshot_dir = root / 'migrations/snapshots/web-facebook-campaigns-v476'
tests_dir = root / 'migrations/tests'
migration = migration_path.read_text()
baseline = (snapshot_dir / 'baseline.sql').read_text()

NAME = 'migration_v476_web_facebook_campaigns'
TAG = '$v476_statements$'
assert TAG not in migration

specs_match = re.search(r"\$specs\$(\[.*?\])\$specs\$", migration, re.S)
assert specs_match
specs = json.loads(specs_match.group(1))
assert len(specs) == 6 and all(len(s['target']) == 32 for s in specs)
spec_values = ',\n'.join(
    f"    ('{s['signature']}', '{s['source']}', '{s['target']}')" for s in specs)
signatures = ',\n'.join(f"    '{s['signature']}'::regprocedure" for s in specs)

# Thân baseline: bỏ phần chú thích đầu file, giữ 6 CREATE OR REPLACE.
baseline_body = baseline[baseline.index('CREATE OR REPLACE FUNCTION'):].rstrip() + '\n'
assert baseline_body.count('CREATE OR REPLACE FUNCTION') == 6

# 1. Rollback.
rollback = f"""-- Rollback v476: khôi phục 6 định nghĩa live trước v476, bỏ 2 hàm chính sách mới và khoá cấu hình.
-- File sinh tự động bởi scripts/build-v476-sql.py từ baseline.sql; đừng sửa tay.
-- Chỉ chạy khi 6 hàm đang ở đúng bản v476 (hoặc đã về baseline); lệch thì dừng, không đổi gì.
-- Trước khi chạy: đặt 'web.facebook_campaigns' enabled=false (Web/iOS mới ngừng nhận dòng Facebook)
-- và deploy lại Control API không gọi aka_agent_control_web_facebook_campaigns_policy.
-- CREATE OR REPLACE nên PostgREST nạp lại schema: chỉ chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE v476_rollback_attrs ON COMMIT DROP AS
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
      RAISE EXCEPTION 'v476_rollback_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF checksum = r.source_md5 THEN at_baseline := at_baseline + 1; END IF;
  END LOOP;
  IF at_baseline = 6 AND to_regprocedure('public.aka_agent_control_web_facebook_campaigns_policy(bigint)') IS NULL THEN
    RAISE NOTICE 'v476 đã ở baseline; rollback không đổi định nghĩa nào.';
  END IF;
END
$guard$;

{baseline_body}
DROP FUNCTION IF EXISTS public.aka_agent_control_web_facebook_campaigns_policy(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_web_facebook_campaigns_policy(bigint);
DELETE FROM public.auto_system_settings WHERE key = 'web.facebook_campaigns';

DO $postflight$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
{spec_values}
  ) AS x(signature, source_md5, target_md5) LOOP
    IF md5(pg_get_functiondef(r.signature::regprocedure)) IS DISTINCT FROM r.source_md5 THEN
      RAISE EXCEPTION 'v476_rollback_postflight:%', r.signature;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM v476_rollback_attrs a JOIN pg_proc p ON p.oid = a.signature::regprocedure
    WHERE (p.prosecdef, p.provolatile, p.proconfig, p.proacl::text, pg_get_userbyid(p.proowner))
      IS DISTINCT FROM (a.prosecdef, a.provolatile, a.proconfig, a.acl, a.owner)
  ) THEN
    RAISE EXCEPTION 'v476_rollback_attributes_changed';
  END IF;
END
$postflight$;
COMMIT;
"""
(snapshot_dir / 'rollback.sql').write_text(rollback)

# 2. So sánh chỉ đọc.
helper_start = migration.index('CREATE OR REPLACE FUNCTION pg_temp.v476_replace(')
helper_end = migration.index('$helper$;', helper_start) + len('$helper$;')
helper = migration[helper_start:helper_end] + '\n'
do_start = migration.index('DO $migration$')
do_end = migration.index('$migration$;', do_start + len('DO $migration$')) + len('$migration$;')
do_block = migration[do_start:do_end] + '\n'
apply_begin = do_block.index('  -- v476:apply-begin')
apply_end_marker = '  -- v476:apply-end\n'
apply_end = do_block.index(apply_end_marker) + len(apply_end_marker)
compare_exec = """  -- So sánh: không EXECUTE lên public. Ghi nhận bản vá khớp md5 đích, tạo bản sao pg_temp cho 3 hàm đọc.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF NOT patched ? r.signature THEN
      INSERT INTO v476_cmp(check_name, ok, detail) VALUES ('already_applied', false, r.signature);
      CONTINUE;
    END IF;
    INSERT INTO v476_cmp(check_name, ok, detail) VALUES ('patch_dry_run', true, r.signature);
    IF r.signature ~ '^public\\.aka_agent_control_(campaign_page|account_snapshot|desktop_activity)\\(' THEN
      EXECUTE regexp_replace(patched->>r.signature, 'FUNCTION public\\.([a-z_]+)\\(', 'FUNCTION pg_temp.\\1_v476(');
    END IF;
  END LOOP;
"""
compare_do = do_block[:apply_begin] + compare_exec + do_block[apply_end:]

compare_runs = r"""
CREATE OR REPLACE FUNCTION pg_temp.v476_strip(p jsonb) RETURNS jsonb
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
  v_scopes constant jsonb := '{"legacy":["zalo","sms"],"desktop":["zalo","sms","zalo_qr","zalo_web"]}';
  v_facebook text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook'];
  v_filters jsonb := jsonb_build_object('applyDisplaySettings', true,
    'dateFrom', to_char(timezone('Asia/Ho_Chi_Minh', now()) - interval '7 days', 'YYYY-MM-DD'),
    'dateTo', to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYY-MM-DD'));
BEGIN
  -- 1. Caller cũ (không token 'facebook'): nhân viên có nhiều chiến dịch Facebook nhất (dòng Facebook phải
  --    vẫn bị loại) và nhân viên có nhiều chiến dịch Zalo/SMS nhất. Kết quả cũ/mới phải giống hệt.
  FOR s IN
    (SELECT 'facebook' AS grp, c.staff_id, c.organization_id, count(*) AS n
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type = 'facebook'
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 3)
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
        v_new := pg_temp.aka_agent_control_campaign_page_v476(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
          p_platforms => v_scope, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('page_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      old_ms := NULL; new_ms := NULL;
      FOR i IN 1..2 LOOP
        t0 := clock_timestamp();
        v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope);
        old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
        t0 := clock_timestamp();
        v_new := pg_temp.aka_agent_control_account_snapshot_v476(s.staff_id, s.organization_id, v_scope);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('snapshot_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v476_strip(v_new) = pg_temp.v476_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' accounts=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_account_snapshot_v476(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('catalog_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v476_strip(v_new) = pg_temp.v476_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' catalog=' || COALESCE(jsonb_array_length(v_old->'catalog'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_desktop_activity(s.staff_id, s.organization_id, v_scope, NULL, 100);
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_desktop_activity_v476(s.staff_id, s.organization_id, v_scope, NULL, 100);
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('activity_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));
    END LOOP;
  END LOOP;

  -- 2. Đường Facebook mới (chưa ai gọi, chỉ đo và kiểm có dòng Facebook).
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false AND a.flatform_type = 'facebook'
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_campaign_page_v476(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_facebook, p_filters => '{"platforms":["facebook"]}'::jsonb, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
    INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('page_facebook', s.staff_id, s.organization_id,
      (v_new->>'campaignTotal')::bigint > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'items') x WHERE x->>'platform' <> 'facebook'),
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'campaigns=' || s.n || ' total=' || COALESCE(v_new->>'campaignTotal', '?'));

    SELECT array_agg(a.id ORDER BY a.id) INTO v_ids FROM (
      SELECT a.id FROM auto_accounts a WHERE a.staff_id = s.staff_id AND a.organization_id = s.organization_id
        AND a.is_delete = false ORDER BY a.id LIMIT 100) a;
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_account_snapshot_v476(s.staff_id, s.organization_id, v_facebook, 'campaigns', COALESCE(v_ids, '{}'));
    INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('snapshot_facebook', s.staff_id, s.organization_id,
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'catalog') x WHERE x->>'platform' = 'facebook')
        AND jsonb_typeof(v_new->'desktopPresence') = 'object',
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'catalog=' || COALESCE(jsonb_array_length(v_new->'catalog'), 0) || ' online=' || COALESCE(v_new->'desktopPresence'->>'online', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_desktop_activity_v476(s.staff_id, s.organization_id, v_facebook, NULL, 100);
    INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('activity_facebook', s.staff_id, s.organization_id, v_new ? 'items',
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'items=' || COALESCE(jsonb_array_length(v_new->'items'), 0) || ' facebook=' ||
        (SELECT count(*) FROM jsonb_array_elements(v_new->'items') x WHERE x->>'accountType' = 'facebook'));
  END LOOP;
END
$compare$;
"""

compare_header = """-- v476 SO SÁNH TRƯỚC KHI APPLY — CHỈ ĐỌC. File sinh tự động bởi scripts/build-v476-sql.py
-- từ migrations/migration_v476_web_facebook_campaigns.sql; đừng sửa tay.
-- Không tạo/sửa đối tượng public/private (bản sao nằm trong pg_temp; event trigger PostgREST bỏ qua pg_temp)
-- và không ghi dữ liệu nghiệp vụ. Không gọi hàm có ghi (xác thực, dừng/tiếp tục, xoá). Chạy trong MỘT phiên.
-- Kết quả: patch_dry_run (6 hàm vá khớp md5 đích), *_same (caller cũ nhận đúng kết quả cũ, kèm thời gian
-- cũ/mới), *_facebook (đường Facebook mới, chỉ đo).
"""
session_timeout = "SET statement_timeout = '110s';\n"
cmp_table = """CREATE TEMP TABLE IF NOT EXISTS v476_cmp (
  seq bigserial, check_name text, staff_id bigint, organization_id bigint,
  ok boolean, old_ms numeric, new_ms numeric, detail text
);
TRUNCATE v476_cmp;

"""
final_select = "\nSELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v476_cmp ORDER BY seq;\n"
compare_body = cmp_table + helper + '\n' + compare_do + compare_runs
(tests_dir / 'migration_v476_web_facebook_campaigns_compare.sql').write_text(
    compare_header + session_timeout + compare_body + final_select)

# 3. Áp một lần dán (SQL Editor).
assert migration.count('\nBEGIN;\n') == 1
stripped = migration.rstrip()
assert stripped.endswith('\nCOMMIT;')
migration_body = stripped[:-len('COMMIT;')].replace('\nBEGIN;\n', '\n', 1).rstrip() + '\n'

guarded_header = f"""-- v476 ÁP BẰNG SUPABASE SQL EDITOR — MỘT LẦN DÁN. File sinh tự động bởi
-- scripts/build-v476-sql.py; đừng sửa tay.
-- Một giao dịch: so sánh chỉ đọc → chốt chặn → migration v476 → ghi lịch sử migration.
-- Kiểm nào không đạt thì báo lỗi 'v476_...' và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có dòng cuối 'applied'. Chỉ chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL statement_timeout = '110s';

-- Đã apply rồi thì dừng ngay, không chạy lại.
DO $preguard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{NAME}')
     OR to_regprocedure('public.aka_agent_control_web_facebook_campaigns_policy(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'v476_guard_failed: v476 đã được apply trước đó, không chạy lại';
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
  SELECT count(*) INTO v_patch FROM v476_cmp WHERE check_name = 'patch_dry_run' AND ok IS TRUE;
  IF v_patch <> 6 THEN
    RAISE EXCEPTION 'v476_guard_failed: patch_dry_run %/6', v_patch;
  END IF;
  SELECT string_agg(check_name || COALESCE(' staff=' || staff_id, '') || COALESCE(' ' || detail, ''), '; ' ORDER BY seq)
  INTO v_bad
  FROM v476_cmp
  WHERE ok IS NOT TRUE
     OR (old_ms IS NOT NULL AND new_ms IS NOT NULL AND new_ms > old_ms * 2 AND new_ms > old_ms + 5);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'v476_guard_failed: %', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v476_cmp WHERE check_name = 'page_legacy_same')
     OR NOT EXISTS (SELECT 1 FROM v476_cmp WHERE check_name = 'snapshot_desktop_same') THEN
    RAISE EXCEPTION 'v476_guard_failed: thiếu dòng so sánh caller cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{NAME}') THEN
    RAISE EXCEPTION 'v476_guard_failed: lịch sử đã có {NAME}';
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
INSERT INTO v476_cmp (check_name, ok, detail)
SELECT 'applied', true, version || ' / ' || name
FROM supabase_migrations.schema_migrations WHERE name = '{NAME}';
COMMIT;
SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v476_cmp ORDER BY seq;
"""
(tests_dir / 'migration_v476_web_facebook_campaigns_guarded_apply.sql').write_text(
    guarded_header + compare_body + guard + migration_body + record)

for path in ('migrations/snapshots/web-facebook-campaigns-v476/rollback.sql',
             'migrations/tests/migration_v476_web_facebook_campaigns_compare.sql',
             'migrations/tests/migration_v476_web_facebook_campaigns_guarded_apply.sql'):
    print(f'wrote {path} ({len((root / path).read_text())} bytes)')
