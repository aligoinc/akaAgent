WITH base AS (SELECT current_setting('server_version') AS server_version, current_user AS executing_role,
  (SELECT jsonb_agg(jsonb_build_object(
    'name',c.oid::regclass::text,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
    'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl)
      ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid,true)) ORDER BY x.conname),'[]'::jsonb)
      FROM pg_constraint x WHERE x.conrelid=c.oid),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
      'function',jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
      'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
      'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl)) ORDER BY t.tgname),'[]'::jsonb)
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
  ) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('auto_campaigns','auto_error')) AS sources,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,
    'signature',e.evtfoid::regprocedure::text,'definition',pg_get_functiondef(e.evtfoid),'md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname),'[]'::jsonb)
    FROM pg_event_trigger e) AS ddl_triggers,
  to_regclass('private.auto_table_logs')::text AS target_table,
  to_regclass('private.auto_table_logs_id_seq')::text AS target_sequence,
  to_regprocedure('private.aka_agent_capture_table_change()')::text AS target_signature,
  (SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='aka_agent_capture_table_change') AS target_overloads,
  (SELECT jsonb_agg(x ORDER BY x.version DESC) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8)x) AS recent_migrations), catalog AS (SELECT jsonb_build_object('oid',c.oid,'name',c.relname,'schema',n.nspname,'owner',pg_get_userbyid(c.relowner),
'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'relfilenode',c.relfilenode,'toast_oid',c.reltoastrelid,
'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid,true)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
'indexes',(SELECT jsonb_agg(jsonb_build_object('oid',i.indexrelid,'name',ic.relname,'schema',ins.nspname,'relfilenode',ic.relfilenode,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace ins ON ins.oid=ic.relnamespace WHERE i.indrelid=c.oid),
'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM pg_policy p WHERE polrelid=c.oid),
'sequence',(SELECT jsonb_build_object('oid',s.oid,'name',s.relname,'schema',sn.nspname,'owner',pg_get_userbyid(s.relowner),'acl',s.relacl) FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace WHERE s.oid=pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),'id')::regclass)) AS log_catalog
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=coalesce(to_regclass('private.auto_table_logs'),to_regclass('public.auto_table_logs'))) SELECT to_jsonb(base) base,log_catalog,md5(base.sources::text) sources_md5,md5(base.ddl_triggers::text) ddl_md5,md5(log_catalog::text) catalog_md5,clock_timestamp() captured_at FROM base,catalog;
