"""Generate a fresh ACL-only cutover; never replay the retired activation."""
import json,pathlib,re,os
root=pathlib.Path(__file__).resolve().parents[3]
out=root/'migrations/snapshots/desktop-cutover-v435'
evidence=pathlib.Path(os.environ.get('V435_EVIDENCE_DIR',out))
m=json.loads((evidence/'before.json').read_text())
q=lambda s:"'"+str(s).replace("'","''")+"'"
id=lambda s:'"'+s.replace('"','""')+'"'
js=lambda x:json.dumps(x,ensure_ascii=False,separators=(',',':'))
name=lambda r:r['schema']+'.'+r['name']
scope=set(json.loads((out/'scope.json').read_text()))
relations=[r for r in m['relations'] if name(r) in scope]
sequences={c['sequence'] for r in relations for c in r['columns'] if c['sequence']}
relations += [r for r in m['relations'] if name(r) in sequences]
bootstrap=set('aka_agent_block_denied_ip_request aka_agent_desktop_login_content aka_agent_desktop_startup_policy aka_agent_prepare_device_change_v2 aka_agent_prepare_device_change aka_agent_recover_staff_credentials aka_agent_reset_device_binding_v2 aka_agent_reset_device_binding aka_agent_staff_access aka_agent_staff_client aka_agent_staff_security_status akamap_staff_client'.split())
fnscope=set(json.loads((out/'function-scope.json').read_text()))
funcs=[f for f in m['functions'] if f['signature'] in fnscope and f['name'] not in bootstrap]
assert all(not f['extension'] for f in funcs)
roles=[r['name'] for r in m['roles'] if r['name'] not in ['anon','authenticated']]
newrls=[r for r in relations if r['kind'] in ['r','p'] and not r['rls']]
metadata_query=(root/'scripts/desktop-session-rls/cutover-v435/capture.sql').read_text().strip().rstrip(';')
guard_query="SELECT (metadata - 'functions') || jsonb_build_object('functions', (SELECT jsonb_agg(f - 'definition') FROM jsonb_array_elements(metadata->'functions') f)) FROM ("+metadata_query+") snapshot"
guard_expected={**m,'functions':[{k:v for k,v in f.items() if k!='definition'} for f in m['functions']]}
(evidence/'guard.json').write_text(js(guard_expected))
(root/'scripts/desktop-session-rls/cutover-v435/guard.sql').write_text(guard_query+';\n')
rel_sql=','.join(q(name(r))+'::regclass' for r in relations)
fn_sql=','.join(q(f['signature'])+'::regprocedure' for f in funcs)
# Skip only intentional Desktop AI SELECT reduction, including column SELECT.
rights_query=f"""SELECT jsonb_object_agg(r.rolname,jsonb_build_object(
 'tables',(SELECT md5(string_agg(c.oid||':'||p||':'||has_table_privilege(r.oid,c.oid,p),',' ORDER BY c.oid,p)) FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE c.oid IN ({rel_sql}) AND c.relkind<>'S' AND NOT(r.rolname='aka_agent_desktop' AND c.oid='public.ai_model'::regclass AND p='SELECT')),
 'columns',(SELECT md5(string_agg(a.attrelid||':'||a.attnum||':'||p||':'||has_column_privilege(r.oid,a.attrelid,a.attnum,p),',' ORDER BY a.attrelid,a.attnum,p)) FROM pg_attribute a CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE a.attrelid IN ({rel_sql}) AND a.attnum>0 AND NOT a.attisdropped AND NOT(r.rolname='aka_agent_desktop' AND a.attrelid='public.ai_model'::regclass AND p='SELECT')),
 'functions',(SELECT md5(string_agg(p.oid||':'||has_function_privilege(r.oid,p.oid,'EXECUTE'),',' ORDER BY p.oid)) FROM pg_proc p WHERE p.oid IN ({fn_sql})),
 'sequences',(SELECT md5(string_agg(c.oid||':'||p||':'||has_sequence_privilege(r.oid,c.oid,p),',' ORDER BY c.oid,p)) FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','UPDATE','USAGE']) p WHERE c.oid IN ({rel_sql}) AND c.relkind='S')
 )) FROM pg_roles r WHERE r.rolname NOT IN ('anon','authenticated')"""
(root/'scripts/desktop-session-rls/cutover-v435/rights.sql').write_text(rights_query+';\n')
lines=['-- V435: user-authorized cutover after Desktop 9.1.0 is available.', '-- Fresh live baseline; no RPC body, data, timeout or tenant-rule changes.', 'BEGIN;', "SET LOCAL lock_timeout='3s';", "SET LOCAL statement_timeout='30s';", "DO $locks$ DECLARE acquired boolean:=false; attempt integer; BEGIN FOR attempt IN 1..40 LOOP BEGIN LOCK TABLE "+','.join(id(r['schema'])+'.'+id(r['name']) for r in newrls)+" IN ACCESS EXCLUSIVE MODE NOWAIT; acquired:=true; EXCEPTION WHEN lock_not_available THEN acquired:=false; END; EXIT WHEN acquired; PERFORM pg_sleep(0.05); END LOOP; IF NOT acquired THEN RAISE EXCEPTION 'V435 tables busy; no changes made' USING ERRCODE='55P03'; END IF; END $locks$;", 'DO $guard$ BEGIN', f' IF md5(({guard_query})::text) IS DISTINCT FROM {q(json.loads((out/"guard-digest.json").read_text())["digest"])} THEN', "  RAISE EXCEPTION 'V435 metadata drift: recapture and review; nothing applied';", ' END IF; END $guard$;',f'CREATE TEMP TABLE v435_rights_before ON COMMIT DROP AS SELECT ({rights_query}) AS value;']
perms={'a':'INSERT','r':'SELECT','w':'UPDATE','d':'DELETE','D':'TRUNCATE','x':'REFERENCES','t':'TRIGGER','m':'MAINTAIN','U':'USAGE','X':'EXECUTE'}
def public_privs(acl,kind):
 if acl is None:return 'X' if kind=='FUNCTION' else ''
 for e in acl[1:-1].split(','):
  if e.startswith('='):return e.split('=')[1].split('/')[0]
 return ''
def preserve_public(kind,obj,acl,column=None):
 ps=public_privs(acl,kind)
 if not ps:return
 assert '*' not in ps, 'review PUBLIC grant option separately'
 grant=','.join(perms[p]+('('+id(column)+')' if column else '') for p in ps)
 lines.append(f'GRANT {grant} ON {kind} {obj} TO '+','.join(map(id,roles))+';')
for r in relations:
 obj=id(r['schema'])+'.'+id(r['name']);kind='SEQUENCE' if r['kind']=='S' else 'TABLE'
 preserve_public(kind,obj,r['acl'])
 lines.append(f'REVOKE ALL PRIVILEGES ON {kind} {obj} FROM PUBLIC, anon, authenticated;')
 if kind=='TABLE':
  for c in r['columns']:
   if c['acl']:
    preserve_public('TABLE',obj,c['acl'],c['name'])
    lines.append(f'REVOKE ALL PRIVILEGES ({id(c["name"])}) ON TABLE {obj} FROM PUBLIC, anon, authenticated;')
for f in funcs:
 sig=f['signature'] if f['schema']!='public' else 'public.'+f['signature']
 preserve_public('FUNCTION',sig,f['acl'])
 lines.append(f'REVOKE ALL PRIVILEGES ON FUNCTION {sig} FROM PUBLIC, anon, authenticated;')
# Existing row policies are not changed. These tables previously had no RLS,
# so current trusted roles retain their old row access, subject to existing ACL.
policyroles=[r['name'] for r in m['roles'] if r['name'] not in ['anon','authenticated'] and not r['super'] and not r['bypassrls']]
for r in newrls:
 obj=id(r['schema'])+'.'+id(r['name'])
 lines += [f'CREATE POLICY v435_existing_role_access ON {obj} FOR ALL TO '+','.join(map(id,policyroles))+' USING (true) WITH CHECK (true);',f'ALTER TABLE {obj} ENABLE ROW LEVEL SECURITY;']
ai=next(r for r in relations if name(r)=='public.ai_model')
lines += ['REVOKE SELECT ON TABLE public.ai_model FROM aka_agent_desktop;', 'REVOKE SELECT (api_key) ON TABLE public.ai_model FROM aka_agent_desktop;', 'GRANT SELECT ('+','.join(id(c['name']) for c in ai['columns'] if c['name']!='api_key')+') ON TABLE public.ai_model TO aka_agent_desktop;', 'GRANT SELECT (value,key,is_active,is_secret) ON TABLE public.auto_system_settings TO anon;', "CREATE POLICY v435_legacy_update_prompt ON public.auto_system_settings FOR SELECT TO anon USING (key='desktop.updates.startup_prompt_max_version' AND is_active AND NOT is_secret);"]
lines += ['DO $check$ BEGIN',f'IF ({rights_query}) IS DISTINCT FROM (SELECT value FROM v435_rights_before) THEN RAISE EXCEPTION \'V435 changed an unrelated effective privilege\'; END IF;', "IF has_column_privilege('aka_agent_desktop','public.ai_model','api_key','SELECT') THEN RAISE EXCEPTION 'V435 AI key remains readable'; END IF;"]
# Loop catalog privileges, including column-only grants, instead of thousands of repeated statements.
for i,l in enumerate(lines):
 if l=='DO $check$ BEGIN':lines[i]='DO $check$ DECLARE rel record; col record; target_role text; fn record; BEGIN'
lines.append(f"""
FOR rel IN SELECT c.oid,c.relkind,c.oid::regclass::text AS name FROM pg_class c WHERE c.oid IN ({rel_sql}) LOOP
 FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF rel.relkind='S' THEN
   IF has_sequence_privilege(target_role,rel.oid,'SELECT,UPDATE,USAGE') THEN RAISE EXCEPTION 'V435 sequence access remains: % %',target_role,rel.name; END IF;
  ELSE
   IF has_table_privilege(target_role,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION 'V435 table access remains: % %',target_role,rel.name; END IF;
   FOR col IN SELECT attnum,attname FROM pg_attribute WHERE attrelid=rel.oid AND attnum>0 AND NOT attisdropped LOOP
    IF has_column_privilege(target_role,rel.oid,col.attnum,CASE WHEN target_role='anon' AND rel.oid='public.auto_system_settings'::regclass AND col.attname IN ('value','key','is_active','is_secret') THEN 'INSERT,UPDATE,REFERENCES' ELSE 'SELECT,INSERT,UPDATE,REFERENCES' END) THEN RAISE EXCEPTION 'V435 column access remains: % %.%',target_role,rel.name,col.attname; END IF;
   END LOOP;
  END IF;
 END LOOP;
END LOOP;
FOR fn IN SELECT p.oid,p.oid::regprocedure::text AS name FROM pg_proc p WHERE p.oid IN ({fn_sql}) LOOP
 IF has_function_privilege('anon',fn.oid,'EXECUTE') OR has_function_privilege('authenticated',fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'V435 RPC remains callable: %',fn.name; END IF;
END LOOP;
""")
lines += ['END $check$;',"NOTIFY pgrst, 'reload schema';",'COMMIT;']
(root/'migrations/migration_v435_desktop_permission_cutover.sql').write_text('\n'.join(lines)+'\n')
plan={'tables':sum(r['kind']!='S' for r in relations),'sequences':sum(r['kind']=='S' for r in relations),'new_rls':[name(r) for r in newrls],'functions':[f['signature'] for f in funcs],'bootstrap':[f['signature'] for f in m['functions'] if f['name'] in bootstrap],'roles_retained':roles,'updater_columns':['value','key','is_active','is_secret'],'ai_read_columns':[c['name'] for c in ai['columns'] if c['name']!='api_key']}
(out/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
print({k:(len(v) if isinstance(v,list) else v) for k,v in plan.items()})
