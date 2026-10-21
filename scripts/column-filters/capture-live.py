"""Capture metadata only through the existing linked API. Never writes to production."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--linked-workdir', required=True)
parser.add_argument('--names', nargs='+', required=True)
args = parser.parse_args()
linked = Path(args.linked_workdir)
assert (linked / 'supabase/.temp/project-ref').read_text().strip() == 'cgjbsmqtfhqvttudyjzq'
assert all(name.replace('_', '').isalnum() for name in args.names)
names = ','.join("'" + name + "'" for name in args.names)
sql = f"""BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT current_setting('server_version') version, p.oid::regprocedure::text signature,
 pg_get_function_identity_arguments(p.oid) identity_args,n.nspname schema,p.proname name,
 md5(pg_get_functiondef(p.oid)) checksum,pg_get_functiondef(p.oid) definition,
 pg_get_userbyid(proowner) owner,prosecdef,provolatile,proconfig,proacl::text proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.proname IN ({names}); COMMIT;"""
with tempfile.TemporaryDirectory(prefix='column-filter-capture-') as d:
    query = Path(d) / 'read.sql'
    query.write_text(sql)
    result = subprocess.run(['supabase','db','query','--linked','--file',str(query),'--output','json'],
                            cwd=linked,check=True,capture_output=True,text=True,timeout=60)
rows = json.loads(result.stdout)['rows']
dest = ROOT / 'migrations/snapshots/column-filters-v421'
dest.mkdir(parents=True,exist_ok=True)
for row in rows:
    name = row['schema'] + '.' + row['name']
    overloaded = sum(r['schema'] == row['schema'] and r['name'] == row['name'] for r in rows) > 1
    if overloaded:
        (dest / (name + '.json')).unlink(missing_ok=True)
    filename = name + ('.' + row['checksum'][:8] if overloaded else '')
    (dest / (filename + '.json')).write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n')
    print(name, row['checksum'], len(row['definition']))
