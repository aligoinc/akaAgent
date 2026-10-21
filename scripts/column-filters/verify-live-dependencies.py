"""Read-only exact-signature roundtrip and drift check on the verified linked project."""
import argparse,json,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--linked-workdir',required=True);a=p.parse_args();linked=Path(a.linked_workdir)
assert (linked/'supabase/.temp/project-ref').read_text().strip()=='cgjbsmqtfhqvttudyjzq'
captures=[json.loads(f.read_text()) for f in (root/'migrations/snapshots/column-filters-v421').glob('*.json') if f.name.startswith(('public.','private.'))]
signatures=[c['signature'] if c['signature'].startswith(c['schema']+'.') else c['schema']+'.'+c['signature'] for c in captures]
values=','.join("('"+s.replace("'","''")+"')" for s in signatures)
sql=f"""BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
WITH requested(signature) AS (VALUES {values})
SELECT r.signature, p.oid::regprocedure::text resolved,md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text proacl
FROM requested r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature);COMMIT;"""
with tempfile.TemporaryDirectory() as d:
 q=Path(d)/'read.sql';q.write_text(sql)
 r=subprocess.run(['supabase','db','query','--linked','--file',str(q),'--output','json'],cwd=linked,check=True,capture_output=True,text=True,timeout=60)
rows=json.loads(r.stdout)['rows'];by={r['signature']:r for r in rows}
for sig,c in zip(signatures,captures):
 for key in ['checksum','owner','prosecdef','provolatile','proconfig','proacl']:
  assert by[sig][key]==c[key],(sig,key,'live dependency changed; re-audit required')
(root/'scripts/column-filters/live-dependency-audit.json').write_text(json.dumps({'project':'cgjbsmqtfhqvttudyjzq','read_only':True,'rows':rows},ensure_ascii=False,indent=2)+'\n')
print(f'{len(rows)} exact live signatures and attributes match captured snapshots (read only).')
