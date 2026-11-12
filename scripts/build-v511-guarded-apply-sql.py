#!/usr/bin/env python3
"""Sinh script dán một lần vào Supabase SQL Editor cho V511 p1-p3 (đường dự phòng khi hộp xác nhận của Supabase MCP
không được bấm kịp: 12/11/2026 hết hạn 2 lần).

Mỗi script = nguyên văn migration (giữ preflight/postflight, một giao dịch) + chốt sổ migration ngay sau BEGIN (đã có
tên này thì dừng; phần trước chưa có thì dừng) + ghi supabase_migrations.schema_migrations với statements[1] = đúng nội
dung file (md5 khớp như apply_migration) + kiểm lại md5 trước COMMIT. Lỗi ở bất kỳ bước nào: không đổi gì.
Cùng cách với scripts/build-data-group-routing-guarded-apply-sql.py (V484-V486).
Ra: migrations/tests/<tên migration>_guarded_apply.sql. Kiểm thử: bash scripts/test-v511-web-proxy-management.sh
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / 'migrations'
OUT = MIG / 'tests'
PARTS = [
    ('migration_v511_web_proxy_management_p1', None),
    ('migration_v511_web_proxy_management_p2', 'migration_v511_web_proxy_management_p1'),
    ('migration_v511_web_proxy_management_p3', 'migration_v511_web_proxy_management_p2'),
]


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
SELECT to_char(greatest(clock_timestamp() AT TIME ZONE 'UTC',
                        max(to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp) + interval '1 second'),
               'YYYYMMDDHH24MISS'), '{name}', ARRAY[{tag}{src}{tag}]
FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{{14}}$';

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
    banner = f"""-- V511 phần {step}/3: ÁP BẰNG SUPABASE SQL EDITOR, MỘT LẦN DÁN (bước {step}/{len(PARTS)}).
-- Sinh bằng scripts/build-v511-guarded-apply-sql.py; đừng sửa tay. Production akachat (cgjbsmqtfhqvttudyjzq).
-- Thứ tự: p1 -> p2 -> p3, ngoài giờ cao điểm. KHÔNG bật cờ tổ chức nào (postflight p1 từ chối nếu có tổ chức bật).
-- Một giao dịch: chốt sổ migration -> nguyên văn migrations/{name}.sql (md5 {file_md5}, gồm kiểm tra trước/sau)
-- -> ghi sổ migration đúng nội dung file -> COMMIT. Kiểm nào không đạt thì báo lỗi và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có status = 'applied' và md5_khop_file = true.
"""
    sql = banner + head + '\nBEGIN;\n' + guard + body + ledger
    return OUT / f'{name}_guarded_apply.sql', sql


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for step, (name, prev) in enumerate(PARTS, 1):
        path, sql = build(name, prev, step)
        path.write_text(sql, encoding='utf-8')
        print(f'{path.relative_to(ROOT)}: {len(sql.encode())} bytes, md5 {md5(sql)}')


if __name__ == '__main__':
    main()
