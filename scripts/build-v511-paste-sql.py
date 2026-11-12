#!/usr/bin/env python3
"""Sinh bản dán SQL Editor gọn cho V511 p1-p3 (nội dung migration chỉ xuất hiện MỘT lần).

Mỗi bản: chốt sổ migration (đã có thì dừng; phần trước chưa có thì dừng) -> nạp nguyên văn file vào biến, so md5 với
file gốc (sai một ký tự khi chép/dán thì dừng, chưa chạy gì) -> chạy phần giữa BEGIN;/COMMIT; của file (giữ nguyên
preflight/postflight) -> ghi sổ migration statements[1] = nguyên văn file -> COMMIT. Lỗi ở bất kỳ bước nào: không đổi gì.
Ra: migrations/tests/<tên migration>_paste.sql. Kiểm thử: bash scripts/test-v511-web-proxy-management.sh
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
TAG = '$v511_src$'


def md5(s: str) -> str:
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def build(name: str, prev: str | None, step: int) -> str:
    src = (MIG / f'{name}.sql').read_text(encoding='utf-8')
    if src.count('\nBEGIN;\n') != 1 or not src.endswith('\nCOMMIT;\n') or TAG in src or '$v511_run$' in src:
        raise SystemExit(f'{name}: cấu trúc file không như mong đợi')
    prev_check = '' if prev is None else f"""
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{prev}') THEN
    RAISE EXCEPTION 'Chưa chạy phần {step - 1}: dán đúng thứ tự p1 -> p2 -> p3';
  END IF;"""
    return f"""-- V511 phần {step}/3 — dán nguyên khối này vào Supabase SQL Editor (project akachat) rồi bấm Run.
-- Thành công: bảng kết quả có status = applied. Lỗi bất kỳ: không đổi gì trong DB.
BEGIN;
DO $v511_run$
DECLARE
  v_src text := {TAG}{src}{TAG};
  v_body text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '{name}') THEN
    RAISE EXCEPTION 'Phần {step} đã chạy rồi, không chạy lại';
  END IF;{prev_check}
  IF md5(v_src) <> '{md5(src)}' THEN
    RAISE EXCEPTION 'Nội dung dán bị thiếu hoặc sai (md5 %), chưa chạy gì; chép lại nguyên khối', md5(v_src);
  END IF;
  v_body := substr(v_src, strpos(v_src, E'\\nBEGIN;\\n') + 8);
  v_body := left(v_body, length(v_body) - length(E'COMMIT;\\n'));
  EXECUTE v_body;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  SELECT to_char(greatest(clock_timestamp() AT TIME ZONE 'UTC',
                          max(to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp) + interval '1 second'),
                 'YYYYMMDDHH24MISS'), '{name}', ARRAY[v_src]
  FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{{14}}$';
END
$v511_run$;
COMMIT;
SELECT 'applied' AS status, version, name, md5(statements[1]) = '{md5(src)}' AS md5_khop_file
FROM supabase_migrations.schema_migrations WHERE name = '{name}';
"""


def main() -> None:
    for step, (name, prev) in enumerate(PARTS, 1):
        sql = build(name, prev, step)
        path = OUT / f'{name}_paste.sql'
        path.write_text(sql, encoding='utf-8')
        print(f'{path.relative_to(ROOT)}: {len(sql.encode())} bytes')


if __name__ == '__main__':
    main()
