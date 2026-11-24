#!/usr/bin/env python3
"""Sinh bản dán SQL Editor chịu được xuống dòng kiểu Windows (CRLF).
Dán từ máy Windows / máy tính bảng thì SQL Editor gửi \\r\\n; migration nào so md5 code hoặc replace() đoạn nhiều dòng sẽ lệch
(V641 ngày 24/11/2026: postflight "block 2554 không ra md5"). Bản sinh ở đây chạy thân migration qua EXECUTE sau khi bỏ chr(13),
và ghi sổ migration bằng nguyên văn file (cũng bỏ chr(13)) nên md5 sổ = md5 file dù dán từ máy nào.
File migration phải có đúng một dòng BEGIN; và kết thúc bằng COMMIT; (không lệnh điều khiển giao dịch nào khác).
Dùng: python3 scripts/make-migration-paste-crlf-safe.py <file migration> <tên trong sổ> <file ra>"""
import hashlib, re, secrets, sys

src, name, out = sys.argv[1:4]
text = open(src, encoding='utf-8').read()
assert '\r' not in text, 'file nguồn phải dùng LF'
assert re.fullmatch(r'[a-z0-9_]+', name), 'tên trong sổ chỉ gồm a-z 0-9 _'
parts = re.split(r'^BEGIN;\n', text, flags=re.M)
assert len(parts) == 2, 'cần đúng một dòng BEGIN;'
head, rest = parts
idx = rest.rfind('COMMIT;')
assert idx >= 0 and rest[idx:].strip() == 'COMMIT;', 'file phải kết thúc bằng COMMIT;'
body = rest[:idx]
assert not re.search(r'^\s*(COMMIT|ROLLBACK|BEGIN|SAVEPOINT)\s*;', body, flags=re.M | re.I), 'thân có lệnh điều khiển giao dịch'
tags = ['$aka_' + k + '_' + secrets.token_hex(6) + '$' for k in ('wrap', 'body', 'ledger')]
assert not any(t in text for t in tags)
w, b, l = tags
open(out, 'w', encoding='utf-8', newline='\n').write(
    head +
    '-- Bản dán SQL Editor (chịu được CRLF): dán cả file, bấm Run một lần. Sinh bằng scripts/make-migration-paste-crlf-safe.py, không sửa tay.\n'
    'BEGIN;\n'
    f'DO {w}\nBEGIN\n'
    f"  EXECUTE replace({b}{body}{b}, chr(13), '');\n"
    '  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)\n'
    f"  VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), '{name}', ARRAY[replace({l}{text}{l}, chr(13), '')]);\n"
    f'END {w};\n'
    'COMMIT;\n')
print(f'file_md5 {hashlib.md5(text.encode()).hexdigest()} -> {out}')
