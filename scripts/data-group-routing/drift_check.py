"""So md5 định nghĩa hàm public/private giữa production (file chụp chỉ đọc) và cụm 'new' cục bộ."""
import json
import sys

import mcpfile
import realstack

prod = {r[0]: r for r in mcpfile.load('prod_functions')}
c = realstack.build('new')
try:
    local = {r[0]: r for r in c.json(realstack.FN_MD5_SQL)}
finally:
    c.close()
only_prod = sorted(set(prod) - set(local))
only_local = sorted(set(local) - set(prod))
diff_md5 = sorted(s for s in set(prod) & set(local) if prod[s][1] != local[s][1])
diff_acl = sorted(s for s in set(prod) & set(local) if prod[s][1] == local[s][1] and prod[s][2] != local[s][2])
same = len(set(prod) & set(local)) - len(diff_md5)
print(f'prod={len(prod)} local={len(local)} same_md5={same} diff_md5={len(diff_md5)} only_prod={len(only_prod)} '
      f'only_local={len(only_local)} diff_acl_only={len(diff_acl)}')
out = {'only_prod': only_prod, 'only_local': only_local, 'diff_md5': diff_md5, 'diff_acl': diff_acl}
(mcpfile.REALDATA_DIR / 'drift.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
for k in ('diff_md5', 'only_prod'):
    print(f'--- {k} ({len(out[k])})')
    for s in out[k]:
        print('  ', s)
