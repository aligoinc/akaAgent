#!/usr/bin/env python3
"""Sinh script áp v461 bằng MỘT LẦN DÁN vào Supabase SQL Editor.

Dùng khi không bấm được thẻ xác nhận của Supabase MCP. Toàn bộ chạy trong một giao dịch:
1. phần so sánh chỉ đọc (migrations/tests/migration_v461_web_desktop_accounts_compare.sql),
2. chốt chặn: kiểm nào không đạt thì RAISE, cả giao dịch rollback, production không đổi gì,
3. nguyên phần thân migrations/migration_v461_web_desktop_accounts.sql (bỏ BEGIN/COMMIT riêng),
4. ghi một dòng supabase_migrations.schema_migrations giống apply_migration,
5. COMMIT rồi in bảng kết quả (dòng cuối 'applied').
Chạy lại script này mỗi khi sửa migration hoặc script so sánh:
    python3 scripts/build-v461-guarded-apply-sql.py
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
migration = (root / 'migrations/migration_v461_web_desktop_accounts.sql').read_text()
compare = (root / 'migrations/tests/migration_v461_web_desktop_accounts_compare.sql').read_text()
out = root / 'migrations/tests/migration_v461_web_desktop_accounts_guarded_apply.sql'

NAME = 'migration_v461_web_desktop_accounts'
TAG = '$v461_statements$'

session_timeout = "SET statement_timeout = '110s';\n"
final_select = "\nSELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v461_cmp ORDER BY seq;\n"
assert compare.count(session_timeout) == 1
assert compare.endswith(final_select)
compare_body = compare[:-len(final_select)].replace(session_timeout, '', 1)

assert migration.count('\nBEGIN;\n') == 1
stripped = migration.rstrip()
assert stripped.endswith('\nCOMMIT;')
migration_body = stripped[:-len('COMMIT;')].replace('\nBEGIN;\n', '\n', 1).rstrip() + '\n'
assert TAG not in migration

header = f"""-- v461 ÁP BẰNG SUPABASE SQL EDITOR — MỘT LẦN DÁN. File sinh tự động bởi
-- scripts/build-v461-guarded-apply-sql.py; đừng sửa tay.
-- Một giao dịch: so sánh chỉ đọc → chốt chặn → migration v461 → ghi lịch sử migration.
-- Kiểm nào không đạt thì báo lỗi 'v461_...' và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có dòng cuối 'applied'. Chỉ chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL statement_timeout = '110s';

-- Đã apply rồi thì dừng ngay, không chạy lại.
DO $preguard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{NAME}')
     OR to_regprocedure('public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'v461_guard_failed: v461 đã được apply trước đó, không chạy lại';
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
  SELECT count(*) INTO v_patch FROM v461_cmp WHERE check_name = 'patch_dry_run' AND ok IS TRUE;
  IF v_patch <> 10 THEN
    RAISE EXCEPTION 'v461_guard_failed: patch_dry_run %/10', v_patch;
  END IF;
  SELECT string_agg(check_name || COALESCE(' staff=' || staff_id, '') || COALESCE(' ' || detail, ''), '; ' ORDER BY seq)
  INTO v_bad
  FROM v461_cmp
  WHERE ok IS NOT TRUE
     OR (old_ms IS NOT NULL AND new_ms IS NOT NULL AND new_ms > old_ms * 2 AND new_ms > old_ms + 5);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'v461_guard_failed: %', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v461_cmp WHERE check_name = 'page_legacy_same')
     OR NOT EXISTS (SELECT 1 FROM v461_cmp WHERE check_name = 'snapshot_legacy_same') THEN
    RAISE EXCEPTION 'v461_guard_failed: thiếu dòng so sánh caller cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{NAME}') THEN
    RAISE EXCEPTION 'v461_guard_failed: lịch sử đã có {NAME}';
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
INSERT INTO v461_cmp (check_name, ok, detail)
SELECT 'applied', true, version || ' / ' || name
FROM supabase_migrations.schema_migrations WHERE name = '{NAME}';
COMMIT;
SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v461_cmp ORDER BY seq;
"""

out.write_text(header + compare_body + guard + migration_body + record)
print(f'wrote {out.relative_to(root)} ({len(out.read_text())} bytes)')
