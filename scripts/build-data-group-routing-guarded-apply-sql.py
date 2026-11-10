#!/usr/bin/env python3
"""Sinh script dán một lần vào Supabase SQL Editor cho V484 p1-p3, V485 p1-p2, V486 (đường dự phòng khi hộp xác nhận
của Supabase MCP không hiện trên app của người dùng).

Mỗi script = nguyên văn migration (giữ preflight/postflight, một giao dịch) + chốt sổ migration ngay sau BEGIN (đã có
tên này thì dừng; phần trước chưa có thì dừng) + ghi supabase_migrations.schema_migrations với statements[1] = đúng nội
dung file (md5 khớp như apply_migration) + kiểm lại md5 trước COMMIT. Lỗi ở bất kỳ bước nào: không đổi gì.
Ra: migrations/tests/<tên migration>_guarded_apply.sql. Kiểm thử: python3 scripts/data-group-routing/test_guarded_apply.py
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / 'migrations'
OUT = MIG / 'tests'
# (tên migration, tên phần phải có trong sổ trước đó hoặc None)
PARTS = [
    ('migration_v484_data_group_async_routing_p1', 'migration_v483_data_group_ingest_budget_guard'),
    ('migration_v484_data_group_async_routing_p2', 'migration_v484_data_group_async_routing_p1'),
    ('migration_v484_data_group_async_routing_p3', 'migration_v484_data_group_async_routing_p2'),
    ('migration_v485_data_group_upload_sessions_p1', 'migration_v484_data_group_async_routing_p3'),
    ('migration_v485_data_group_upload_sessions_p2', 'migration_v485_data_group_upload_sessions_p1'),
    ('migration_v486_group_access_plan_cache', None),
]

LABELS = {
    'migration_v484_data_group_async_routing_p1': 'V484 p1', 'migration_v484_data_group_async_routing_p2': 'V484 p2',
    'migration_v484_data_group_async_routing_p3': 'V484 p3', 'migration_v485_data_group_upload_sessions_p1': 'V485 p1',
    'migration_v485_data_group_upload_sessions_p2': 'V485 p2', 'migration_v486_group_access_plan_cache': 'V486',
}


def md5(s: str) -> str:
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def build(name: str, prev: str | None, step: int) -> tuple[Path, str]:
    src = (MIG / f'{name}.sql').read_text(encoding='utf-8')
    file_md5 = md5(src)
    if src.count('\nBEGIN;\n') != 1 or not src.endswith('\nCOMMIT;\n'):
        raise SystemExit(f'{name}: expected exactly one BEGIN; and a final COMMIT;')
    tag = '$aka_ledger_src_' + name.removeprefix('migration_') + '$'
    if tag in src:
        raise SystemExit(f'{name}: dollar tag collision')
    head, rest = src.split('\nBEGIN;\n', 1)
    body = rest[: -len('COMMIT;\n')]
    prev_check = '' if prev is None else f"""
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{prev}') THEN
    RAISE EXCEPTION '{name}: chưa thấy {prev} trong sổ migration; dán đúng thứ tự';
  END IF;"""
    guard = f"""DO $aka_guarded_ledger_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{name}') THEN
    RAISE EXCEPTION '{name}: đã có trong sổ migration, không chạy lại';
  END IF;{prev_check}
END
$aka_guarded_ledger_guard$;
"""
    ledger = f"""
-- ===== Ghi sổ migration (cùng giao dịch): statements[1] = nguyên văn migrations/{name}.sql =====
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), '{name}', ARRAY[{tag}{src}{tag}]);

DO $aka_guarded_ledger_check$
BEGIN
  IF (SELECT md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE name = '{name}')
     IS DISTINCT FROM '{file_md5}' THEN
    RAISE EXCEPTION '{name}: md5 sổ migration không khớp file';
  END IF;
END
$aka_guarded_ledger_check$;

COMMIT;

SELECT 'applied' AS status, version, name, md5(statements[1]) AS ledger_md5,
       md5(statements[1]) = '{file_md5}' AS md5_khop_file,
       to_char((make_timestamp(substr(version, 1, 4)::int, substr(version, 5, 2)::int, substr(version, 7, 2)::int,
                               substr(version, 9, 2)::int, substr(version, 11, 2)::int, substr(version, 13, 2)::numeric)
                AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI:SS') AS gio_vn
FROM supabase_migrations.schema_migrations
WHERE name = '{name}';
"""
    order = ' -> '.join(LABELS[p] for p, _ in PARTS)
    banner = f"""-- {LABELS[name]}: ÁP BẰNG SUPABASE SQL EDITOR, MỘT LẦN DÁN (bước {step}/{len(PARTS)}).
-- Sinh bằng scripts/build-data-group-routing-guarded-apply-sql.py; đừng sửa tay. Production akachat (cgjbsmqtfhqvttudyjzq).
-- Thứ tự: {order} (V483 đã apply 09/11/2026 19:04:08 VN). Ngoài giờ cao điểm.
-- Một giao dịch: chốt sổ migration -> nguyên văn migrations/{name}.sql (md5 {file_md5}, gồm kiểm tra trước/sau)
-- -> ghi sổ migration đúng nội dung file -> COMMIT. Kiểm nào không đạt thì báo lỗi và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có status = 'applied' và md5_khop_file = true.
"""
    sql = banner + head + '\nBEGIN;\n' + guard + body + ledger
    path = OUT / f'{name}_guarded_apply.sql'
    return path, sql


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for step, (name, prev) in enumerate(PARTS, 1):
        path, sql = build(name, prev, step)
        path.write_text(sql, encoding='utf-8')
        print(f'{path.relative_to(ROOT)}: {len(sql.encode())} bytes, md5 {md5(sql)}')


if __name__ == '__main__':
    main()
