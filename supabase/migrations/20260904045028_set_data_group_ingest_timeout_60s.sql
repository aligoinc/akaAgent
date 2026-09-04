-- Data Group ingest accepts up to 10,000 rows and deliberately performs the
-- upload refresh atomically. Desktop calls arrive through PostgREST as anon,
-- whose project-level statement timeout is 3 seconds. Give only the ingest
-- entrypoints the documented maximum 60-second Data API window; do not widen
-- the timeout for unrelated anon/authenticated queries.
--
-- Live definitions captured from linked production project
-- cgjbsmqtfhqvttudyjzq (akachat) on 2026-09-04. Both current/legacy client
-- wrappers and current/legacy service wrappers are covered so the fix does
-- not depend on which desktop binary initiated the ingest.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v record;
  v_oid regprocedure;
  v_checksum text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_acl text;
BEGIN
  FOR v IN
    SELECT *
    FROM (VALUES
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'::text,
        'ea83bdb7dc656ae698dc8147650f06ac'::text,
        'd6a75d68f38968f4dda76947963aa02e'::text,
        '{postgres=X/postgres,service_role=X/postgres}'::text
      ),
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint)'::text,
        '7909737041b96c502e12686dda858a5c'::text,
        '357a849364fe21ee3d34876706f18bc2'::text,
        '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}'::text
      ),
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)'::text,
        '8a05142ecd22c89f491a4d879b869e4d'::text,
        '7896671fe8348d680436aef99d239826'::text,
        '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::text
      ),
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)'::text,
        '06e25f2a50cc2a5078624f97dbc683e1'::text,
        '450e18ee137eaa3f5f1032f945bb2dc7'::text,
        '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::text
      )
    ) AS expected(signature, source_checksum, target_checksum, expected_acl)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'missing_data_group_ingest_rpc:%', v.signature;
    END IF;

    SELECT
      pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)),
      pg_catalog.pg_get_userbyid(fn.proowner),
      fn.prosecdef,
      fn.provolatile,
      fn.proconfig,
      fn.proacl::text
    INTO
      v_checksum,
      v_owner,
      v_security_definer,
      v_volatility,
      v_config,
      v_acl
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = v_oid;

    IF v_checksum NOT IN (v.source_checksum, v.target_checksum) THEN
      RAISE EXCEPTION
        'unexpected_data_group_ingest_checksum signature=% checksum=%',
        v.signature, v_checksum;
    END IF;

    IF v_owner <> 'postgres'
      OR NOT v_security_definer
      OR v_volatility <> 'v'
      OR v_acl <> v.expected_acl
    THEN
      RAISE EXCEPTION
        'unexpected_data_group_ingest_metadata signature=% owner=% secdef=% volatility=% acl=%',
        v.signature, v_owner, v_security_definer, v_volatility, v_acl;
    END IF;

    IF v_checksum = v.source_checksum
      AND v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    THEN
      RAISE EXCEPTION
        'unexpected_data_group_ingest_source_config signature=% config=%',
        v.signature, v_config;
    END IF;

    IF v_checksum = v.target_checksum
      AND v_config IS DISTINCT FROM ARRAY[
        'search_path=pg_catalog, public',
        'statement_timeout=60s'
      ]::text[]
    THEN
      RAISE EXCEPTION
        'unexpected_data_group_ingest_target_config signature=% config=%',
        v.signature, v_config;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb,
  bigint, text, text, bigint, text, text
)
SET statement_timeout TO '60s';

ALTER FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb,
  bigint, text, text, bigint, text, text, bigint
)
SET statement_timeout TO '60s';

ALTER FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb,
  bigint, text, text, bigint, text, text, text, text
)
SET statement_timeout TO '60s';

ALTER FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb,
  bigint, text, text, bigint, text, text, bigint, text, text
)
SET statement_timeout TO '60s';

DO $postflight$
DECLARE
  v record;
  v_oid regprocedure;
  v_checksum text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_acl text;
BEGIN
  FOR v IN
    SELECT *
    FROM (VALUES
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'::text,
        'd6a75d68f38968f4dda76947963aa02e'::text,
        '{postgres=X/postgres,service_role=X/postgres}'::text
      ),
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint)'::text,
        '357a849364fe21ee3d34876706f18bc2'::text,
        '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}'::text
      ),
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)'::text,
        '7896671fe8348d680436aef99d239826'::text,
        '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::text
      ),
      (
        'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)'::text,
        '450e18ee137eaa3f5f1032f945bb2dc7'::text,
        '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::text
      )
    ) AS expected(signature, target_checksum, expected_acl)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'missing_data_group_ingest_rpc_postflight:%', v.signature;
    END IF;

    SELECT
      pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)),
      pg_catalog.pg_get_userbyid(fn.proowner),
      fn.prosecdef,
      fn.provolatile,
      fn.proconfig,
      fn.proacl::text
    INTO
      v_checksum,
      v_owner,
      v_security_definer,
      v_volatility,
      v_config,
      v_acl
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = v_oid;

    IF v_checksum <> v.target_checksum
      OR v_owner <> 'postgres'
      OR NOT v_security_definer
      OR v_volatility <> 'v'
      OR v_config IS DISTINCT FROM ARRAY[
        'search_path=pg_catalog, public',
        'statement_timeout=60s'
      ]::text[]
      OR v_acl <> v.expected_acl
    THEN
      RAISE EXCEPTION
        'data_group_ingest_timeout_postflight_failed signature=% checksum=% owner=% secdef=% volatility=% config=% acl=%',
        v.signature, v_checksum, v_owner, v_security_definer,
        v_volatility, v_config, v_acl;
    END IF;
  END LOOP;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
