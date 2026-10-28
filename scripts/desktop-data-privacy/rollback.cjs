const fs=require('node:fs'),c=require('./config.cjs'),q=c.quote,id=c.ident
module.exports=function generateRollback(target){
 const plan=JSON.parse(fs.readFileSync(c.dir+'/plan.json'))
 const relevant={functions:target.functions.filter(f=>plan.newFunctions.some(s=>f.signature.endsWith(s))),relations:target.relations.filter(r=>r.schema==='public'&&c.tables.includes(r.name)),policies:target.policies.filter(p=>p.schemaname==='public'&&c.tables.includes(p.tablename)),triggers:target.triggers.filter(t=>t.schema==='public'&&c.tables.includes(t.table))}
 const query=require('./metadata.cjs')
 const expected=JSON.stringify(relevant)
 const org=plan.sourceRelations.find(r=>r.name==='org_organization')
 const sql=`-- Opening these permissions requires a separate explicit rollback instruction.
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';
DO $rollback$
DECLARE actual jsonb;
BEGIN
 IF current_setting('aka_agent.data_privacy_rollback',true) IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'V436 rollback requires approval'; END IF;
 ${query} INTO actual;
 actual:=jsonb_build_object(
 'functions',(SELECT jsonb_agg(v ORDER BY v->>'signature') FROM jsonb_array_elements(actual->'functions') v WHERE ${plan.newFunctions.map(s=>`v->>'signature' LIKE ${q('%'+s)}`).join(' OR ')}),
 'relations',(SELECT jsonb_agg(v ORDER BY v->>'schema',v->>'name') FROM jsonb_array_elements(actual->'relations') v WHERE v->>'schema'='public' AND v->>'name'=ANY(ARRAY[${c.tables.map(q)}])),
 'policies',(SELECT jsonb_agg(v ORDER BY v->>'schemaname',v->>'tablename',v->>'policyname') FROM jsonb_array_elements(actual->'policies') v WHERE v->>'schemaname'='public' AND v->>'tablename'=ANY(ARRAY[${c.tables.map(q)}])),
 'triggers',(SELECT jsonb_agg(v ORDER BY v->>'schema',v->>'table',v->>'name') FROM jsonb_array_elements(actual->'triggers') v WHERE v->>'schema'='public' AND v->>'table'=ANY(ARRAY[${c.tables.map(q)}])));
 IF actual IS DISTINCT FROM ${q(expected)}::jsonb THEN RAISE EXCEPTION 'V436 rollback drift'; END IF;
END $rollback$;
${plan.triggerTables.map(t=>`DROP TRIGGER aaa_v436_desktop_data_owner ON public.${id(t)};`).join('\n')}
${plan.policies.map(p=>`DROP POLICY ${id(p.name)} ON public.${id(p.table)};`).join('\n')}
${[...plan.newFunctions].reverse().map(s=>`DROP FUNCTION ${s};`).join('\n')}
REVOKE SELECT (${plan.organizationColumns.map(id)}) ON public.org_organization FROM aka_agent_desktop;
GRANT SELECT ON public.org_organization TO aka_agent_desktop;
`
 // Table SELECT grant is appended in its original ACL position (Desktop was last).
 fs.writeFileSync(c.rollback,sql)
 return sql
}
