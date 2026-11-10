"""Gộp kết quả chép dữ liệu (file MCP) vào REALDATA_DIR/tables/<bảng>.json: {"cols": [...], "rows": [[...]]}."""
import json
import sys

import mcpfile

TABLES = mcpfile.REALDATA_DIR / 'tables'


def merge(path: str) -> dict:
    TABLES.mkdir(parents=True, exist_ok=True)
    data = mcpfile.data_of(mcpfile.TOOL_RESULTS / path if '/' not in path else path)
    summary = {}
    for table, payload in data.items():
        payload = payload or {'cols': [], 'rows': []}
        out = TABLES / f'{table}.json'
        if out.exists():
            old = json.loads(out.read_text(encoding='utf-8'))
            assert old['cols'] == payload['cols'] or not payload['rows'], table
            cols = old['cols'] or payload['cols']
            rows = old['rows'] + payload['rows']
            if 'id' in cols:
                i = cols.index('id')
                seen, uniq = set(), []
                for r in rows:
                    if r[i] not in seen:
                        seen.add(r[i]); uniq.append(r)
                rows = uniq
        else:
            cols, rows = payload['cols'], payload['rows']
        out.write_text(json.dumps({'cols': cols, 'rows': rows}, ensure_ascii=False), encoding='utf-8')
        summary[table] = (len(payload['rows']), len(rows))
    return summary


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p, merge(p))
