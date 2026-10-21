"""Verify all dependencies survived candidate installation, and record new function attributes."""
import json,re,subprocess,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2];snap=root/'migrations/snapshots/column-filters-v421';out=root/'scripts/column-filters'
cmd=['/opt/homebrew/bin/psql','-X','-qAt','-h','127.0.0.1','-p','55421','-d','column_filters','-v','ON_ERROR_STOP=1']
def read(sql):
 r=subprocess.run(cmd,input=sql,text=True,capture_output=True,check=True);return json.loads(r.stdout)
rows=read("""SELECT jsonb_agg(jsonb_build_object('signature',n.nspname||'.'||p.oid::regprocedure::text,'name',p.proname,'schema',n.nspname,'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proconfig',p.proconfig,'proacl',p.proacl::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('private','public') AND (p.proname LIKE 'column_filter_%' OR p.proname LIKE 'aka_agent_read_filtered_%');""")
for row in rows:
 row['signature']=row['signature'].replace('private.private.','private.').replace('public.public.','public.')
 assert row['owner']=='postgres',row
 if row['schema']=='public':
  assert row['prosecdef'] and row['provolatile']=='s' and 'statement_timeout=60s' in row['proconfig'],row
  assert '=X/postgres' not in row['proacl'].replace('postgres=X/postgres','').replace('anon=X/postgres','').replace('authenticated=X/postgres','').replace('service_role=X/postgres',''),row
 else:assert row['proacl']=='{postgres=X/postgres}',row
old=[]
files=[(p,p.read_text()) for directory in ['migrations','supabase/migrations'] for p in (root/directory).glob('*.sql') if 'v421_' not in p.name]
for p in snap.glob('*.json'):
 if not p.name.startswith(('public.','private.')):continue
 c=json.loads(p.read_text());sig=c['signature'] if c['signature'].startswith(c['schema']+'.') else c['schema']+'.'+c['signature']
 actual=read("SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(to_regprocedure('"+sig+"'))),'owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,'proconfig',proconfig,'proacl',proacl::text) FROM pg_proc WHERE oid=to_regprocedure('"+sig+"');")
 for key in ['checksum','owner','prosecdef','provolatile','proconfig','proacl']:assert actual[key]==c[key],(sig,key,actual[key],c[key])
 body=re.search(r'AS (\$\w*\$)([\s\S]*)\1',c['definition']).group(2)
 norm=lambda s:re.sub(r'\s+',' ',s).strip()
 matches=[];mentions=[]
 for path,sql in files:
  if c['name'] not in sql:continue
  mentions.append(str(path.relative_to(root)))
  for m in re.finditer(r'\$(\w*)\$([\s\S]*?)\$\1\$',sql):
   if norm(body)==norm(m.group(2)):matches.append(str(path.relative_to(root)))
 old.append({'signature':sig,'checksum':c['checksum'],'attributes_preserved':True,'exact_body_matches':sorted(set(matches)),'all_mentions':sorted(mentions)})
result={'production_applied':False,'local_target_functions':rows,'preserved_dependencies':old,'migration_sha256':hashlib.sha256((root/'migrations/migration_v421_data_column_filters.sql').read_bytes()).hexdigest()}
(out/'local-migration-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for c in old:print(c['signature'].split('(')[0],c['exact_body_matches'])
print(f'{len(rows)} new functions and {len(old)} unchanged dependencies verified.')
