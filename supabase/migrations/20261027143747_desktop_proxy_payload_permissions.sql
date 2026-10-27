-- Preserve create/edit Proxy: these fields come from buildProxyPayload's object spread.
-- Only add the columns the existing Desktop feature sends. No anon or RLS changes.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $preflight$ DECLARE actual jsonb; BEGIN
 SELECT (SELECT jsonb_build_object('acl',c.relacl::text,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) FROM pg_class c WHERE c.oid='public.auto_proxies'::regclass) INTO actual;
 IF actual IS DISTINCT FROM '{"acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=r/postgres}","columns":[{"name":"id","acl":null},{"name":"name","acl":null},{"name":"protocol","acl":null},{"name":"host","acl":null},{"name":"port","acl":null},{"name":"username","acl":null},{"name":"password","acl":null},{"name":"staff_id","acl":"{aka_agent_desktop=a/postgres}"},{"name":"organization_id","acl":"{aka_agent_desktop=a/postgres}"},{"name":"is_active","acl":null},{"name":"is_delete","acl":"{aka_agent_desktop=w/postgres}"},{"name":"created_at","acl":null},{"name":"updated_at","acl":"{aka_agent_desktop=w/postgres}"}]}'::jsonb THEN RAISE EXCEPTION 'Proxy ACL drift; inspect before adding payload columns'; END IF;
END $preflight$;
GRANT INSERT (host,is_active,name,password,port,protocol,username), UPDATE (host,is_active,name,password,port,protocol,username) ON public.auto_proxies TO aka_agent_desktop;
NOTIFY pgrst,'reload schema';
COMMIT;
