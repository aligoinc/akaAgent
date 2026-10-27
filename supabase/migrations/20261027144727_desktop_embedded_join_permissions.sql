-- Restore the read-only catalog dependency used by category_item's embedded join.
-- Keep all existing RPC bodies, policies, RLS, anon and backend privileges.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $preflight$ DECLARE actual jsonb; BEGIN
 SELECT (SELECT jsonb_build_object('schema','public','name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)) AS state FROM pg_class c WHERE c.oid='public.category_type'::regclass) INTO actual;
 IF actual IS DISTINCT FROM '{"acl":"{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,aka_agent_chat_api=r/postgres}","rls":true,"kind":"r","name":"category_type","force":false,"owner":"postgres","schema":"public","columns":[{"acl":null,"name":"id"},{"acl":null,"name":"namespace"},{"acl":null,"name":"code"},{"acl":null,"name":"name"},{"acl":null,"name":"managed_by"},{"acl":null,"name":"description"},{"acl":null,"name":"is_active"},{"acl":null,"name":"created_at"},{"acl":null,"name":"updated_at"}],"policies":[{"cmd":"SELECT","qual":"true","roles":["anon","authenticated"],"tablename":"category_type","permissive":"PERMISSIVE","policyname":"category_type_read_catalog","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"true","roles":["aka_agent_desktop"],"tablename":"category_type","permissive":"PERMISSIVE","policyname":"desktop_legacy_0","schemaname":"public","with_check":null}]}'::jsonb THEN RAISE EXCEPTION 'Category type ACL/policy drift; recapture before applying'; END IF;
END $preflight$;
GRANT SELECT ON TABLE public.category_type TO aka_agent_desktop;
NOTIFY pgrst,'reload schema';
COMMIT;
