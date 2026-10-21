"""Install captured schema (no production rows) and exact reader dependencies locally."""
import json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]; cap=root/'migrations/snapshots/column-filters-v421'
args=['/opt/homebrew/bin/psql','-X','-h','127.0.0.1','-p','55421','-d','column_filters','-v','ON_ERROR_STOP=1']
# Refuse every nonlocal connection, regardless of ambient PG* variables.
sql="""DO $$ BEGIN IF inet_server_addr() <> '127.0.0.1'::inet OR inet_server_port()<>55421 OR current_database()<>'column_filters' THEN RAISE EXCEPTION 'local fixture only'; END IF; END $$;
SET check_function_bodies=off;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS auth;
DO $$ BEGIN CREATE ROLE postgres SUPERUSER; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SET ROLE postgres;
"""
rows=json.loads((cap/'schema.json').read_text())
for t in rows:
 sql+='CREATE TABLE IF NOT EXISTS public."'+t['name']+'" ('+', '.join('"'+c['name']+'" '+c['type'] for c in t['columns'])+');\n'
for t in rows:
 for idx in t['indexes'] or []:
  sql+=idx.replace('CREATE UNIQUE INDEX ','CREATE UNIQUE INDEX IF NOT EXISTS ').replace('CREATE INDEX ','CREATE INDEX IF NOT EXISTS ')+';\n'
for p in sorted(cap.glob('*.json')):
 if not p.name.startswith(('public.','private.')):continue
 c=json.loads(p.read_text());sql+=c['definition']+';\n'
 sig=c['schema']+'.'+c['signature'] if not c['signature'].startswith(c['schema']+'.') else c['signature']
 sql+=f'ALTER FUNCTION {sig} OWNER TO {c["owner"]};\n'
 sql+=f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated,service_role;\n'
 # Explicitly preserve each captured grant for test calls.
 acl=c.get('proacl') or ''
 for role in ['anon','authenticated','service_role']:
  if role+'=X/' in acl:sql+=f'GRANT EXECUTE ON FUNCTION {sig} TO {role};\n'
(root/'scripts/column-filters/.local-schema.sql').write_text(sql)
subprocess.run(args,input=sql,text=True,check=True,stdout=subprocess.DEVNULL)
print('Loaded metadata-only schema, indexes and captured function definitions.')
