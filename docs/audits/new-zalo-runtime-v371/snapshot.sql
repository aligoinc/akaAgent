SELECT current_setting('server_version') AS server_version, current_user AS executing_role,
  (SELECT jsonb_build_object(
    'name', c.oid::regclass::text, 'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
    'acl', c.relacl, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'estimated_rows', c.reltuples, 'bytes', pg_total_relation_size(c.oid),
    'columns', (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod), 'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid,true)) ORDER BY x.conname),'[]'::jsonb) FROM pg_constraint x WHERE x.conrelid=c.oid)
  ) FROM pg_class c WHERE c.oid='public.org_organization'::regclass) AS table_schema,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
    'function',jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl)) ORDER BY t.tgname),'[]'::jsonb)
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.org_organization'::regclass AND NOT t.tgisinternal) AS triggers,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,'signature',e.evtfoid::regprocedure::text,'definition',pg_get_functiondef(e.evtfoid),'md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname),'[]'::jsonb) FROM pg_event_trigger e) AS ddl_triggers,
  to_regprocedure('private.aka_agent_org_default_new_zalo_runtime()')::text AS target_signature,
  (SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='aka_agent_org_default_new_zalo_runtime') AS target_overloads,
  (SELECT jsonb_agg(x ORDER BY x.version DESC) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10)x) AS recent_migrations;
