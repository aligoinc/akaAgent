-- Finalizing a scan dataset materializes its Data Group membership through
-- row-level synchronization triggers. Large scans can exceed the anon role's
-- three-second statement timeout even though the bounded work is healthy.

BEGIN;

DO $preflight$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,text,text)'
  );
  v_checksum text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_acl text;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_finalize_contact_dataset_rpc';
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
  WHERE fn.oid = v_signature;

  IF v_checksum NOT IN (
    '708ef87f00a31e6659b40486ca5da0ef',
    '8cda2541c0b811a8184c9b1adc29934c'
  ) THEN
    RAISE EXCEPTION
      'unexpected_finalize_contact_dataset_checksum:%', v_checksum;
  END IF;

  IF v_owner <> 'postgres'
    OR NOT v_security_definer
    OR v_volatility <> 'v'
    OR v_acl <> '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  THEN
    RAISE EXCEPTION
      'unexpected_finalize_contact_dataset_metadata owner=% secdef=% volatility=% acl=%',
      v_owner, v_security_definer, v_volatility, v_acl;
  END IF;

  IF v_checksum = '708ef87f00a31e6659b40486ca5da0ef'
    AND v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  THEN
    RAISE EXCEPTION
      'unexpected_finalize_contact_dataset_source_config:%', v_config;
  END IF;

  IF v_checksum = '8cda2541c0b811a8184c9b1adc29934c'
    AND (
      pg_catalog.cardinality(v_config) <> 2
      OR NOT v_config @> ARRAY[
        'search_path=pg_catalog, public',
        'statement_timeout=60s'
      ]::text[]
    )
  THEN
    RAISE EXCEPTION
      'unexpected_finalize_contact_dataset_target_config:%', v_config;
  END IF;
END;
$preflight$;

ALTER FUNCTION public.aka_agent_finalize_contact_dataset(
  bigint, bigint, bigint, text, text, text, text, text, text, text,
  text[], jsonb, bigint, text, text
)
SET statement_timeout TO '60s';

DO $postflight$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,text,text)'
  );
  v_checksum text;
  v_config text[];
BEGIN
  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)),
    fn.proconfig
  INTO v_checksum, v_config
  FROM pg_catalog.pg_proc AS fn
  WHERE fn.oid = v_signature;

  IF v_checksum <> '8cda2541c0b811a8184c9b1adc29934c'
    OR pg_catalog.cardinality(v_config) <> 2
    OR NOT v_config @> ARRAY[
      'search_path=pg_catalog, public',
      'statement_timeout=60s'
    ]::text[]
  THEN
    RAISE EXCEPTION
      'finalize_contact_dataset_timeout_postflight_failed checksum=% config=%',
      v_checksum, v_config;
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
