#!/usr/bin/env python3
"""Tính md5 thân bốn hàm đọc sau V653 từ thân production (scripts/fixtures/zalo-received-marks/prod-readers-20261125.sql)
và các cặp thay thế trong migration V653, rồi ghi md5 đó vào bước kiểm sau của V653 và bước kiểm trước của bản gỡ.

python3 scripts/zalo-received-marks/v653-md5.py [--write]
"""
import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
fixture = (root / 'scripts/fixtures/zalo-received-marks/prod-readers-20261125.sql').read_text()
mig_path = root / 'migrations/migration_v653_zalo_received_marks_readers.sql'
rb_path = root / 'migrations/rollback_v653_zalo_received_marks_readers.sql'
mig = mig_path.read_text()
rb = rb_path.read_text()

prosrc = {}
for m in re.finditer(r'CREATE OR REPLACE FUNCTION public\.(\w+)\(.*?\nAS \$function\$(.*?)\$function\$', fixture, re.S):
    prosrc[m.group(1)] = m.group(2)
OLD = {'v2': '28c26d1e0bd580eb77fef7f4b8352a67', 'v3': '4e5c300305409908295c49d5d1941224',
       'recipients': '3fe7e5982398b42cc73fcc0433109b05', 'run_report': '4bd734ca25612bfdade631c779373d42'}
NAMES = {'v2': 'aka_agent_list_campaign_details_page_v2', 'v3': 'aka_agent_list_campaign_details_page_v3',
         'recipients': 'aka_agent_read_campaign_result_recipients', 'run_report': 'aka_agent_read_campaign_run_report'}
md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
for key, name in NAMES.items():
    assert md5(prosrc[name]) == OLD[key], (key, md5(prosrc[name]))

patch_block = mig[mig.index('DO $patch$'):mig.index('$patch$;')]
consts = dict(re.findall(r'(\w+) constant text := \$f\$(.*?)\$f\$;', patch_block, re.S))
PAIRS = {'v2': ['f1', 'f2', 'f3', 'f4'], 'v3': ['f1', 'f2', 'f3', 'f4'], 'recipients': ['r1', 'r2', 'r3', 'r4'], 'run_report': ['e1']}
new = {}
for key, prefixes in PAIRS.items():
    src = prosrc[NAMES[key]]
    for p in prefixes:
        old, repl = consts[p + '_old'], consts[p + '_new']
        assert src.count(old) == 1, (key, p, src.count(old))
        src = src.replace(old, repl)
    new[key] = md5(src)
    # Bản gỡ: thay ngược theo thứ tự ngược phải ra đúng thân production.
    back = src
    for p in reversed(prefixes):
        assert back.count(consts[p + '_new']) == 1, (key, p, 'reverse')
        back = back.replace(consts[p + '_new'], consts[p + '_old'])
    assert md5(back) == OLD[key], (key, 'rollback')
    # Bản gỡ phải dùng đúng các hằng của V653.
    rb_block = rb[rb.index('DO $unpatch$'):rb.index('$unpatch$;')]
    rb_consts = dict(re.findall(r'(\w+) constant text := \$f\$(.*?)\$f\$;', rb_block, re.S))
    for p in prefixes:
        assert rb_consts[p + '_old'] == consts[p + '_old'] and rb_consts[p + '_new'] == consts[p + '_new'], (key, p, 'rollback constants differ')
print(json.dumps(new))

if '--write' in sys.argv:
    post = json.dumps(new).replace('{"', '{"').replace('", "', '", "')
    mig2 = re.sub(r"IF v_md5 IS DISTINCT FROM '\{[^']*\}'::jsonb THEN\n    RAISE EXCEPTION 'v653_postflight_md5",
                  f"IF v_md5 IS DISTINCT FROM '{post}'::jsonb THEN\n    RAISE EXCEPTION 'v653_postflight_md5", mig)
    assert mig2 != mig or post in mig
    mig_path.write_text(mig2)
    rb2 = rb
    for key, name in NAMES.items():
        rb2 = re.sub(r"(pg_temp\.v653_unpatch\(\n    'public\." + name + r"\([^']*\)',\n    ')[0-9a-f]{32}'", r"\g<1>" + new[key] + "'", rb2)
    rb_path.write_text(rb2)
    print('written')
