BEGIN;

DO $smoke$
DECLARE
  v_public_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,text,text)'
  );
  v_core_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)'
  );
  v_internal_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset_v205_internal(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb)'
  );
  v_public_checksum text;
  v_config text[];
BEGIN
  IF v_public_signature IS NULL
    OR v_core_signature IS NULL
    OR v_internal_signature IS NULL
  THEN
    RAISE EXCEPTION 'v239_smoke: finalize dataset signature missing';
  END IF;

  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)),
    fn.proconfig
  INTO v_public_checksum, v_config
  FROM pg_catalog.pg_proc AS fn
  WHERE fn.oid = v_public_signature;

  IF v_public_checksum <> '8cda2541c0b811a8184c9b1adc29934c'
    OR pg_catalog.cardinality(v_config) <> 2
    OR NOT v_config @> ARRAY[
      'search_path=pg_catalog, public',
      'statement_timeout=60s'
    ]::text[]
  THEN
    RAISE EXCEPTION
      'v239_smoke: public timeout mismatch checksum=% config=%',
      v_public_checksum, v_config;
  END IF;

  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core_signature))
      <> '8bceea12f160d767a6fa2c6799c18ee3'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_internal_signature))
      <> 'f5722a4b4554b0d496eb6cb3379f043f'
  THEN
    RAISE EXCEPTION 'v239_smoke: preserved finalize implementation changed';
  END IF;

  -- The public wrapper must still reject invalid desktop credentials.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
  BEGIN
    PERFORM *
    FROM public.aka_agent_finalize_contact_dataset(
      9223372036854775807::bigint,
      9223372036854775807::bigint,
      9223372036854775807::bigint,
      'zalo_group_members'::text,
      'person'::text,
      'v239-auth-smoke'::text,
      'v239 auth smoke'::text,
      NULL::text,
      NULL::text,
      'failed'::text,
      ARRAY[]::text[],
      '{}'::jsonb,
      NULL::bigint,
      'v239-invalid-user'::text,
      'v239-invalid-password'::text
    );
    RAISE EXCEPTION 'v239_smoke: invalid desktop credentials were accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'automation_auth_invalid' THEN
      RAISE;
    END IF;
  END;

  -- The core tenant/account ownership guard must remain unchanged.
  BEGIN
    PERFORM *
    FROM public.aka_agent_finalize_contact_dataset(
      9223372036854775807::bigint,
      9223372036854775807::bigint,
      9223372036854775807::bigint,
      'zalo_group_members'::text,
      'person'::text,
      'v239-ownership-smoke'::text,
      'v239 ownership smoke'::text,
      NULL::text,
      NULL::text,
      'failed'::text,
      ARRAY[]::text[],
      '{}'::jsonb,
      NULL::bigint
    );
    RAISE EXCEPTION 'v239_smoke: invalid tenant/account identity was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'contact_dataset_account_not_found' THEN
      RAISE;
    END IF;
  END;
END;
$smoke$;

ROLLBACK;
