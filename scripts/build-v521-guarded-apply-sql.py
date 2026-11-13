#!/usr/bin/env python3
"""Sinh script dán một lần vào Supabase SQL Editor cho V521 (vé gia hạn), dùng khi hộp xác nhận của Supabase MCP không
hiện trên app của người dùng (13/11/2026: hết hạn 2 lần).

Script = nguyên văn migrations/migration_v521_renewal_link_tickets.sql (giữ preflight/postflight, một giao dịch) + chốt
sổ migration ngay sau BEGIN (đã có tên này thì dừng) + ghi supabase_migrations.schema_migrations với statements[1] = đúng
nội dung file (md5 khớp như apply_migration) + kiểm lại md5 trước COMMIT. Lỗi ở bất kỳ bước nào: không đổi gì.
Cùng cách với scripts/build-data-group-routing-guarded-apply-sql.py (V484–V486).
Ra: migrations/tests/migration_v521_renewal_link_tickets_guarded_apply.sql. Kiểm thử: bash scripts/test-v521-guarded-apply.sh
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = 'migration_v521_renewal_link_tickets'
SRC = ROOT / 'migrations' / f'{NAME}.sql'
OUT = ROOT / 'migrations' / 'tests' / f'{NAME}_guarded_apply.sql'


def md5(text: str) -> str:
    return hashlib.md5(text.encode('utf-8')).hexdigest()


def build() -> str:
    src = SRC.read_text(encoding='utf-8')
    file_md5 = md5(src)
    if src.count('\nBEGIN;\n') != 1 or not src.endswith('\nCOMMIT;\n'):
        raise SystemExit(f'{NAME}: cần đúng một BEGIN; và COMMIT; ở cuối file')
    tag = '$aka_ledger_src_v521_renewal_link_tickets$'
    if tag in src:
        raise SystemExit(f'{NAME}: trùng dollar tag')
    head, rest = src.split('\nBEGIN;\n', 1)
    body = rest[: -len('COMMIT;\n')]
    banner = f"""-- V521 (vé gia hạn dùng một lần): ÁP BẰNG SUPABASE SQL EDITOR, MỘT LẦN DÁN.
-- Sinh bằng scripts/build-v521-guarded-apply-sql.py; đừng sửa tay. Production akachat (cgjbsmqtfhqvttudyjzq).
-- Một giao dịch: chốt sổ migration -> nguyên văn migrations/{NAME}.sql (md5 {file_md5}, gồm kiểm tra trước/sau)
-- -> ghi sổ migration đúng nội dung file -> COMMIT. Kiểm nào không đạt thì báo lỗi và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có status = 'applied' và md5_khop_file = true. Bấm Run lần hai báo
-- "đã có trong sổ migration, không chạy lại" là vô hại.
"""
    guard = f"""DO $aka_guarded_ledger_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{NAME}') THEN
    RAISE EXCEPTION '{NAME}: đã có trong sổ migration, không chạy lại';
  END IF;
END
$aka_guarded_ledger_guard$;
"""
    ledger = f"""
-- ===== Ghi sổ migration (cùng giao dịch): statements[1] = nguyên văn migrations/{NAME}.sql =====
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), '{NAME}', ARRAY[{tag}{src}{tag}]);

DO $aka_guarded_ledger_check$
BEGIN
  IF (SELECT md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE name = '{NAME}')
     IS DISTINCT FROM '{file_md5}' THEN
    RAISE EXCEPTION '{NAME}: md5 sổ migration không khớp file';
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
WHERE name = '{NAME}';
"""
    return banner + head + '\nBEGIN;\n' + guard + body + ledger


def main() -> None:
    sql = build()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(sql, encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {len(sql.encode())} bytes, md5 {md5(sql)}')


if __name__ == '__main__':
    main()
