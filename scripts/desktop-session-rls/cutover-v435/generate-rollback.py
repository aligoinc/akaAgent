"""Recovery only: restores captured legacy access after separate authorization."""
import json,pathlib,os
root=pathlib.Path(__file__).resolve().parents[3];d=pathlib.Path(os.environ.get('V435_EVIDENCE_DIR',root/'migrations/snapshots/desktop-cutover-v435'));plan_dir=root/'migrations/snapshots/desktop-cutover-v435'
m=json.loads((d/'before.json').read_text());plan=json.loads((plan_dir/'plan.json').read_text())
q=lambda x:"'"+x.replace("'","''")+"'";js=lambda x:json.dumps(x,ensure_ascii=False,separators=(',',':'))
query=(root/'scripts/desktop-session-rls/cutover-v435/guard.sql').read_text().strip().rstrip(';')
roles='PUBLIC,'+','.join('"'+r['name'].replace('"','""')+'"' for r in m['roles'])
sc=set(json.loads((plan_dir/'scope.json').read_text()));sc|={c['sequence'] for r in m['relations'] if r['schema']+'.'+r['name'] in sc for c in r['columns'] if c['sequence']}
relations=[{'name':r['schema']+'.'+r['name'],'kind':r['kind'],'acl':r['acl'],'owner':r['owner'],'columns':[{'name':c['name'],'acl':c['acl']} for c in r['columns'] if c['acl']]} for r in m['relations'] if r['schema']+'.'+r['name'] in sc]
functions=[{k:f[k] for k in ['signature','acl','owner']} for f in m['functions'] if f['signature'] in plan['functions']]
lines=['-- EXPLICIT RECOVERY ONLY: this reopens legacy anon/authenticated data access.','BEGIN;',"SET LOCAL lock_timeout='3s';", "SET LOCAL statement_timeout='30s';", "DO $$ BEGIN IF current_setting('aka_agent.v435_rollback',true) IS DISTINCT FROM 'approved-reopen-legacy-access' THEN RAISE EXCEPTION 'V435 rollback requires separate explicit authorization'; END IF; END $$;", 'LOCK TABLE '+','.join(plan['new_rls'])+' IN ACCESS EXCLUSIVE MODE NOWAIT;',f"DO $$ BEGIN IF md5(({query})::text) IS DISTINCT FROM '_V435_APPLIED_METADATA_DIGEST_' THEN RAISE EXCEPTION 'V435 rollback metadata drift'; END IF; END $$;",'DROP POLICY v435_legacy_update_prompt ON public.auto_system_settings;']
for n in plan['new_rls']:lines += [f'DROP POLICY v435_existing_role_access ON {n};',f'ALTER TABLE {n} DISABLE ROW LEVEL SECURITY;']
lines.append(f"""
DO $restore$
DECLARE item record; col record; grant_item record; object_kind text; role_name text;
BEGIN
 FOR item IN SELECT * FROM jsonb_to_recordset({q(js(relations))}::jsonb) AS x(name text,kind text,acl text,owner text,columns jsonb) LOOP
  object_kind:=CASE WHEN item.kind='S' THEN 'SEQUENCE' ELSE 'TABLE' END;
  EXECUTE format('REVOKE ALL PRIVILEGES ON %s %s FROM %s',object_kind,item.name,{q(roles)});
  FOR grant_item IN SELECT * FROM aclexplode(coalesce(item.acl::aclitem[],acldefault(CASE WHEN item.kind='S' THEN 'S' ELSE 'r' END::\"char\",item.owner::regrole))) LOOP
   role_name:=CASE WHEN grant_item.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_item.grantee)) END;
   EXECUTE format('GRANT %s ON %s %s TO %s%s',grant_item.privilege_type,object_kind,item.name,role_name,CASE WHEN grant_item.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  FOR col IN SELECT * FROM jsonb_to_recordset(item.columns) AS c(name text,acl text) LOOP
   FOR grant_item IN SELECT * FROM aclexplode(col.acl::aclitem[]) LOOP
    role_name:=CASE WHEN grant_item.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_item.grantee)) END;
    EXECUTE format('GRANT %s (%I) ON TABLE %s TO %s%s',grant_item.privilege_type,col.name,item.name,role_name,CASE WHEN grant_item.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
   END LOOP;
  END LOOP;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_to_recordset({q(js(functions))}::jsonb) AS x(signature text,acl text,owner text) LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %s',item.signature,{q(roles)});
  FOR grant_item IN SELECT * FROM aclexplode(coalesce(item.acl::aclitem[],acldefault('f',item.owner::regrole))) LOOP
   role_name:=CASE WHEN grant_item.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_item.grantee)) END;
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s%s',item.signature,role_name,CASE WHEN grant_item.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
 END LOOP;
END $restore$;
NOTIFY pgrst, 'reload schema';
COMMIT;
""")
result='\n'.join(lines).rstrip()+'\n'
verification=plan_dir/'verification.json'
if verification.exists():result=result.replace('_V435_APPLIED_METADATA_DIGEST_',json.loads(verification.read_text())['post_apply_catalog_digest'])
(root/'migrations/rollback_v435_desktop_permission_cutover.sql').write_text(result)
