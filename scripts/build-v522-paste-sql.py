#!/usr/bin/env python3
"""Sinh bản dán SQL Editor gọn cho V522 (Desktop gọi hàm đối chiếu thành viên nhóm data): nội dung migration chỉ xuất
hiện MỘT lần, để chép từ khung chat.

Cùng cách với scripts/build-v521-paste-sql.py / build-v511-paste-sql.py: chốt sổ migration (đã có thì dừng) -> nạp
nguyên văn file vào biến, so md5 với file gốc (sai một ký tự khi chép/dán thì dừng, chưa chạy gì; xuống dòng kiểu
Windows được đổi về kiểu Unix trước khi so) -> chạy phần giữa BEGIN;/COMMIT; của file (giữ nguyên preflight/postflight)
-> ghi sổ migration statements[1] = nguyên văn file -> COMMIT. Lỗi ở bất kỳ bước nào: không đổi gì.
Ra: migrations/tests/migration_v522_data_group_member_matches_desktop_paste.sql.
Kiểm thử: PGBIN=/usr/lib/postgresql/16/bin python3 scripts/data-group-routing/test_v522.py
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = 'migration_v522_data_group_member_matches_desktop'
SRC = ROOT / 'migrations' / f'{NAME}.sql'
OUT = ROOT / 'migrations' / 'tests' / f'{NAME}_paste.sql'
TAG = '$v522_src$'


def md5(text: str) -> str:
    return hashlib.md5(text.encode('utf-8')).hexdigest()


def build() -> str:
    src = SRC.read_text(encoding='utf-8')
    if src.count('\nBEGIN;\n') != 1 or not src.endswith('\nCOMMIT;\n') or TAG in src or '$v522_run$' in src or '\r' in src:
        raise SystemExit(f'{NAME}: cấu trúc file không như mong đợi')
    return f"""-- V522 (Desktop gọi hàm đối chiếu thành viên nhóm data của V519) — dán nguyên khối này vào Supabase SQL Editor
-- (project akachat) rồi bấm Run. Thành công: bảng kết quả có status = applied. Lỗi bất kỳ: không đổi gì trong DB.
BEGIN;
DO $v522_run$
DECLARE
  v_src text := {TAG}{src}{TAG};
  v_body text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v522_%') THEN
    RAISE EXCEPTION 'V522 đã có trong sổ migration, không chạy lại';
  END IF;
  v_src := replace(v_src, E'\\r\\n', E'\\n');
  IF md5(v_src) <> '{md5(src)}' THEN
    RAISE EXCEPTION 'Nội dung dán bị thiếu hoặc sai (md5 %), chưa chạy gì; chép lại nguyên khối', md5(v_src);
  END IF;
  v_body := substr(v_src, strpos(v_src, E'\\nBEGIN;\\n') + 8);
  v_body := left(v_body, length(v_body) - length(E'COMMIT;\\n'));
  EXECUTE v_body;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  SELECT to_char(greatest(clock_timestamp() AT TIME ZONE 'UTC',
                          max(to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp) + interval '1 second'),
                 'YYYYMMDDHH24MISS'), '{NAME}', ARRAY[v_src]
  FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{{14}}$';
END
$v522_run$;
COMMIT;
SELECT 'applied' AS status, version, name, md5(statements[1]) = '{md5(src)}' AS md5_khop_file
FROM supabase_migrations.schema_migrations WHERE name = '{NAME}';
"""


def main() -> None:
    sql = build()
    OUT.write_text(sql, encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {len(sql.encode())} bytes, md5 {md5(sql)}')


if __name__ == '__main__':
    main()
