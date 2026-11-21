#!/usr/bin/env python3
"""Cụm Postgres cục bộ có đường nạp Nhóm data như production, cho kiểm thử đầu-cuối đẩy quản trị viên group vào Nhóm data.

Nền: bản chụp schema + hàm 27/10 (scripts/data-group-routing/fixture.py) + V483–V486. Rồi nạp đè từ file xuất CHỈ ĐỌC của production
(<prod_schema.json>: định nghĩa hàm / trigger / cột của các bảng nhóm data, liên hệ, chiến dịch; xuất bằng MCP execute_sql, không commit):
cột thiếu thì thêm, hàm khác md5 hoặc chưa có thì tạo lại, trigger tạo lại đúng định nghĩa production.
  PGBIN=/usr/lib/postgresql/16/bin python3 scripts/find-data-push/e2e-admin-cluster.py <prod_schema.json> <file ra (json: dir, port)>
Cụm giữ chạy (keep); dừng bằng pg_ctl -D <dir>/data stop.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'data-group-routing'))
import realstack  # noqa: E402


def main() -> None:
    schema = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    out = Path(sys.argv[2])
    c = realstack.build('new', keep=True)
    report = {'dir': str(c.dir), 'port': c.port, 'columns_added': 0, 'functions_replaced': 0, 'function_errors': [], 'triggers': 0, 'trigger_errors': []}

    local = {(r['table_schema'], r['table_name'], r['column_name']) for r in c.rows(
        "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema IN ('public','private')")}
    tables = {(s, t) for s, t, _ in local}
    stmts = []
    for sch, rel, col, typ, nullable, dflt in schema['cols']:
        if (sch, rel) in tables and (sch, rel, col) not in local:
            t = 'jsonb' if typ == 'jsonb' else ('text[]' if typ == 'ARRAY' else typ)
            d = f' DEFAULT {dflt}' if dflt and 'nextval(' not in dflt else ''
            stmts.append(f'ALTER TABLE {sch}."{rel}" ADD COLUMN IF NOT EXISTS "{col}" {t}{d};')
    if stmts:
        _, err = c.psql('\n'.join(stmts), stop_on_error=False)
        report['column_errors'] = [l for l in err.splitlines() if 'ERROR' in l]
    report['columns_added'] = len(stmts)

    local_md5 = {sig: md5 for sig, md5 in json.loads(c.q(
        "SELECT COALESCE(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))), '[]') "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind = 'f'"))}
    todo = [(sig, body) for sig, body, _acl in schema['defs']
            if local_md5.get(sig) != hashlib.md5(body.encode('utf-8')).hexdigest()]
    # Hai lượt: hàm phụ thuộc kiểu / hàm khác có thể cần thứ tự.
    for _round in range(2):
        errors = []
        for sig, body in todo:
            _, err = c.psql('SET check_function_bodies = off;\n' + body + ';', stop_on_error=False)
            if 'ERROR' in err:
                errors.append((sig, err.strip().splitlines()[-1][:300]))
        if not errors:
            break
    report['functions_replaced'] = len(todo)
    report['function_errors'] = errors

    for rel, name, ddl in schema['triggers']:
        _, err = c.psql(f'DROP TRIGGER IF EXISTS "{name}" ON public."{rel}";\n{ddl};', stop_on_error=False)
        if 'ERROR' in err:
            report['trigger_errors'].append((rel, name, err.strip().splitlines()[-1][:300]))
        else:
            report['triggers'] += 1
    c.q("UPDATE cron.job SET active = false")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({k: (v if not isinstance(v, list) else len(v)) for k, v in report.items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
