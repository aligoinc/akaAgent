SELECT jsonb_build_object(
  'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
  'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),
  'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl
) AS capture_function,
obj_description(p.oid,'pg_proc') AS function_comment,
obj_description(c.oid,'pg_class') AS table_comment,
jsonb_build_object(
  'oid',c.oid,'schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),
  'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'relfilenode',c.relfilenode,'toast_oid',c.reltoastrelid,
  'sequence',pg_get_serial_sequence('public.auto_table_logs','id'),
  'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'identity',a.attidentity,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid,true)) ORDER BY conname)
    FROM pg_constraint WHERE conrelid=c.oid),
  'indexes',(SELECT jsonb_agg(jsonb_build_object('oid',i.indexrelid,'file',ic.relfilenode,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname)
    FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(pol)),'[]') FROM pg_policy pol WHERE polrelid=c.oid)
) AS table_catalog,
(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,
  'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.tgrelid::regclass::text,t.tgname)
 FROM pg_trigger t WHERE t.tgfoid=p.oid) AS registrations,
(SELECT jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,
  'signature',e.evtfoid::regprocedure::text,'md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname)
 FROM pg_event_trigger e) AS ddl_triggers
FROM pg_proc p CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE p.oid=to_regprocedure('private.aka_agent_capture_table_change()')
  AND c.oid=to_regclass('public.auto_table_logs');
