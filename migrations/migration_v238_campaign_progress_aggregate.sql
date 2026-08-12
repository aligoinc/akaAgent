-- Replace Campaign-list input-data paging with one tenant-authenticated
-- aggregate call per bounded campaign-ID batch. The existing three-argument
-- Control API core remains service-role-only and is not redefined here.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_core oid := pg_catalog.to_regprocedure(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[])'
  );
  v_guard oid := pg_catalog.to_regprocedure(
    'public.auto_assert_automation_identity(bigint,bigint,text,text)'
  );
  v_wrapper oid := pg_catalog.to_regprocedure(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[],text,text)'
  );
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_parallel "char";
  v_config text[];
  v_acl_valid boolean;
BEGIN
  IF v_core IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core))
      IS DISTINCT FROM 'fdff962116bb5f2c98830dbfaec6a7f4'
  THEN
    RAISE EXCEPTION 'v238: campaign progress core is missing or changed';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO v_owner, v_security_definer, v_volatility, v_parallel, v_config, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_core;
  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_volatility IS DISTINCT FROM 's'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v238: campaign progress core metadata or privileges changed';
  END IF;

  IF v_guard IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard))
      IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d'
  THEN
    RAISE EXCEPTION 'v238: automation identity guard is missing or changed';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO v_owner, v_security_definer, v_volatility, v_parallel, v_config, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_guard;
  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_volatility IS DISTINCT FROM 's'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v238: automation identity guard metadata or privileges changed';
  END IF;

  IF v_wrapper IS NOT NULL THEN
    SELECT
      pg_catalog.pg_get_userbyid(proc.proowner),
      proc.prosecdef,
      proc.provolatile,
      proc.proparallel,
      proc.proconfig,
      proc.proacl IS NOT NULL
        AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 4
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(proc.proacl) AS acl
          WHERE acl.grantee <> ALL(ARRAY[
            pg_catalog.to_regrole('postgres')::oid,
            pg_catalog.to_regrole('anon')::oid,
            pg_catalog.to_regrole('authenticated')::oid,
            pg_catalog.to_regrole('service_role')::oid
          ])
            OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
            OR acl.privilege_type <> 'EXECUTE'
            OR acl.is_grantable
        )
    INTO v_owner, v_security_definer, v_volatility, v_parallel, v_config, v_acl_valid
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = v_wrapper;
    IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_wrapper))
        IS DISTINCT FROM '954ab48ce0eec97b433d2cdc6da3b57e'
      OR v_owner IS DISTINCT FROM 'postgres'
      OR v_security_definer IS DISTINCT FROM true
      OR v_volatility IS DISTINCT FROM 's'::"char"
      OR v_parallel IS DISTINCT FROM 'u'::"char"
      OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
      OR v_acl_valid IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION 'v238: unexpected authenticated campaign progress wrapper already exists';
    END IF;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_campaign_progress(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_ids bigint[],
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  campaign_id bigint,
  input_total bigint,
  input_completed bigint,
  input_failed bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF COALESCE(pg_catalog.cardinality(p_campaign_ids), 0) > 100 THEN
    RAISE EXCEPTION 'campaign_progress_batch_too_large';
  END IF;

  RETURN QUERY
  SELECT
    progress.campaign_id,
    progress.input_total,
    progress.input_completed,
    progress.input_failed
  FROM public.aka_agent_control_campaign_progress(
    p_staff_id,
    p_organization_id,
    p_campaign_ids
  ) AS progress;
END;
$function$;

ALTER FUNCTION public.aka_agent_control_campaign_progress(
  bigint, bigint, bigint[], text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.aka_agent_control_campaign_progress(
  bigint, bigint, bigint[], text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_control_campaign_progress(
  bigint, bigint, bigint[], text, text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_control_campaign_progress(
  bigint, bigint, bigint[], text, text
) IS 'Tenant-authenticated Campaign-list wrapper over the service-only progress aggregate; accepts at most 100 campaign IDs.';

DO $postflight$
DECLARE
  v_core oid := pg_catalog.to_regprocedure(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[])'
  );
  v_guard oid := pg_catalog.to_regprocedure(
    'public.auto_assert_automation_identity(bigint,bigint,text,text)'
  );
  v_wrapper oid := pg_catalog.to_regprocedure(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[],text,text)'
  );
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_parallel "char";
  v_config text[];
  v_acl_valid boolean;
  v_result text;
BEGIN
  IF v_core IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core))
      IS DISTINCT FROM 'fdff962116bb5f2c98830dbfaec6a7f4'
  THEN
    RAISE EXCEPTION 'v238: campaign progress core changed during apply';
  END IF;

  IF v_guard IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard))
      IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d'
  THEN
    RAISE EXCEPTION 'v238: automation identity guard changed during apply';
  END IF;

  IF v_wrapper IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_wrapper))
      IS DISTINCT FROM '954ab48ce0eec97b433d2cdc6da3b57e'
  THEN
    RAISE EXCEPTION 'v238: authenticated campaign progress wrapper checksum mismatch';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    pg_catalog.pg_get_function_result(proc.oid),
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO
    v_owner, v_security_definer, v_volatility, v_parallel, v_config,
    v_result, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_core;
  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_volatility IS DISTINCT FROM 's'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR v_result IS DISTINCT FROM
      'TABLE(campaign_id bigint, input_total bigint, input_completed bigint, input_failed bigint)'
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v238: campaign progress core metadata or privileges changed during apply';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    pg_catalog.pg_get_function_result(proc.oid),
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO
    v_owner, v_security_definer, v_volatility, v_parallel, v_config,
    v_result, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_guard;
  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_volatility IS DISTINCT FROM 's'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_result IS DISTINCT FROM 'void'
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v238: automation identity guard metadata or privileges changed during apply';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    pg_catalog.pg_get_function_result(proc.oid),
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 4
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO
    v_owner, v_security_definer, v_volatility, v_parallel, v_config,
    v_result, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_wrapper;

  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_volatility IS DISTINCT FROM 's'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_result IS DISTINCT FROM
      'TABLE(campaign_id bigint, input_total bigint, input_completed bigint, input_failed bigint)'
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v238: authenticated campaign progress wrapper metadata or privileges mismatch';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
