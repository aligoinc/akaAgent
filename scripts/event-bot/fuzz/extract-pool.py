#!/usr/bin/env python3
"""Tách mẫu dữ liệu thật (đã che) từ tệp kết quả MCP execute_sql (cột `pool`) ra JSON cho bộ thử. Giữ tệp ra NGOÀI repo.
Cách chạy: python3 -I scripts/event-bot/fuzz/extract-pool.py <tệp kết quả MCP> <tệp ra>"""
import json, sys, re, collections
src, out = sys.argv[1], sys.argv[2]
t = json.loads(open(src, encoding='utf-8').read())['result']
a = t.index('<untrusted-data'); a = t.index('<untrusted-data', a + 5); a = t.index('>', a) + 1; b = t.rindex('</untrusted-data')
pool = json.loads(t[a:b])[0]['pool']
pool = {k: [x for x in (v or [])] for k, v in pool.items()}
json.dump(pool, open(out, 'w'), ensure_ascii=False)
print({k: len(v) for k, v in pool.items()})
print('phones', collections.Counter(re.sub(r'\d', '9', x or '') for x in pool.get('phones', [])).most_common(8))
print('sdob', collections.Counter(re.sub(r'\d', '9', x or 'NULL') for x in pool.get('sdob', [])).most_common(6))
