-- v312: remove the unused organization-expiry column after v310.
-- Source audit: linked cgjbsmqtfhqvttudyjzq, 2026-09-23.
-- No function/ACL/JSON contract changes. No data updates to the canonical flag or staff dates.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$ DECLARE r record; BEGIN
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,
      'volatility',provolatile,'config',proconfig,'acl',proacl) attrs INTO r
    FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_time_allowed(bigint)');
  IF NOT FOUND OR r.checksum IS DISTINCT FROM 'a294e60011edd8d42e90ac2f74ce744c'
    OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "securityDefiner": true, "volatility": "s", "config": ["search_path=pg_catalog, public"], "acl": ["postgres=X/postgres", "anon=X/postgres", "authenticated=X/postgres", "service_role=X/postgres", "=X/postgres"]}'::jsonb THEN
    RAISE EXCEPTION 'v312 expiry function drift: public.aka_agent_staff_time_allowed(bigint)';
  END IF;
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,
      'volatility',provolatile,'config',proconfig,'acl',proacl) attrs INTO r
    FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_access(bigint,text,text)');
  IF NOT FOUND OR r.checksum IS DISTINCT FROM 'ca59bfbfa79c7e40ec50788e77b9d022'
    OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "securityDefiner": true, "volatility": "s", "config": ["search_path=pg_catalog, public"], "acl": ["postgres=X/postgres", "anon=X/postgres", "authenticated=X/postgres", "service_role=X/postgres"]}'::jsonb THEN
    RAISE EXCEPTION 'v312 expiry function drift: public.aka_agent_staff_access(bigint,text,text)';
  END IF;
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,
      'volatility',provolatile,'config',proconfig,'acl',proacl) attrs INTO r
    FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management_row(bigint)');
  IF NOT FOUND OR r.checksum IS DISTINCT FROM '4964edb52ffc866f610036212d14fb08'
    OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "securityDefiner": true, "volatility": "s", "config": ["search_path=pg_catalog, public"], "acl": ["postgres=X/postgres", "service_role=X/postgres"]}'::jsonb THEN
    RAISE EXCEPTION 'v312 expiry function drift: public.aka_agent_staff_management_row(bigint)';
  END IF;
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,
      'volatility',provolatile,'config',proconfig,'acl',proacl) attrs INTO r
    FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)');
  IF NOT FOUND OR r.checksum IS DISTINCT FROM '689c389e3380c75497c720e7e6c5dafb'
    OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "securityDefiner": true, "volatility": "v", "config": ["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"], "acl": ["postgres=X/postgres", "anon=X/postgres", "authenticated=X/postgres", "service_role=X/postgres"]}'::jsonb THEN
    RAISE EXCEPTION 'v312 expiry function drift: public.aka_agent_staff_management(bigint,text,text,text,jsonb)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.org_organization'::regclass AND a.attname='use_staff_expiration'
      AND NOT a.attisdropped AND a.atttypid='boolean'::regtype AND a.attnotnull
      AND pg_get_expr(d.adbin,d.adrelid)='false') THEN
    RAISE EXCEPTION 'v312 canonical expiry column is missing or incompatible';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prokind='f' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND p.prosrc ILIKE '%use_organization_expiration%')
    OR EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%use_organization_expiration%') THEN
    RAISE EXCEPTION 'v312 legacy expiry column is still referenced';
  END IF;
END; $preflight$;

-- Follow the existing runtime lock order before changing organization row metadata.
LOCK TABLE public.org_staff, public.org_organization IN ACCESS EXCLUSIVE MODE;
DO $drop_column$ DECLARE old_column smallint; BEGIN
  SELECT attnum INTO old_column FROM pg_attribute
    WHERE attrelid='public.org_organization'::regclass AND attname='use_organization_expiration' AND NOT attisdropped;
  IF old_column IS NOT NULL THEN
    -- DROP COLUMN can auto-drop indexes/constraints even with RESTRICT: refuse every
    -- catalog dependency except this column's own default, verified in the live audit.
    IF EXISTS (SELECT 1 FROM pg_depend
      WHERE refclassid='pg_class'::regclass AND refobjid='public.org_organization'::regclass
        AND refobjsubid=old_column AND NOT (classid='pg_attrdef'::regclass AND deptype='a')) THEN
      RAISE EXCEPTION 'v312 unexpected legacy expiry column dependency';
    END IF;
    ALTER TABLE public.org_organization DROP COLUMN use_organization_expiration RESTRICT;
    -- Column removal changes the API schema; reapply without the column needs no reload.
    PERFORM pg_notify('pgrst','reload schema');
  END IF;
END; $drop_column$;
COMMIT;
