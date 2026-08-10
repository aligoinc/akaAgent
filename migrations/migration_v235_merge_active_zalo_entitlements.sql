BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Accept only the repository v219 baseline or the exact DB-only pool split
-- currently running on akachat. Any newer production patch must be reviewed
-- and merged before this migration is allowed to replace these read paths.
DO $preflight$
DECLARE
  v_public_oid regprocedure := to_regprocedure(
    'public.resolve_organization_zalo_account_capabilities(bigint)'
  );
  v_helper_oid regprocedure := to_regprocedure(
    'private.resolve_organization_zalo_entitlement_pools(bigint)'
  );
  v_private_schema_oid oid := to_regnamespace('private');
  v_public_checksum text;
  v_helper_checksum text;
  v_public_owner text;
  v_public_security_definer boolean;
  v_public_volatility "char";
  v_public_parallel "char";
  v_public_config text;
  v_public_acl text;
  v_helper_owner text;
  v_helper_security_definer boolean;
  v_helper_volatility "char";
  v_helper_parallel "char";
  v_helper_config text;
  v_helper_acl text;
BEGIN
  IF v_public_oid IS NULL THEN
    RAISE EXCEPTION
      'Preflight failed: public.resolve_organization_zalo_account_capabilities(bigint) is missing';
  END IF;

  SELECT
    md5(pg_get_functiondef(proc.oid)),
    pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig::text,
    proc.proacl::text
  INTO
    v_public_checksum,
    v_public_owner,
    v_public_security_definer,
    v_public_volatility,
    v_public_parallel,
    v_public_config,
    v_public_acl
  FROM pg_proc AS proc
  WHERE proc.oid = v_public_oid;

  IF v_helper_oid IS NULL THEN
    IF v_private_schema_oid IS NOT NULL
      OR v_public_checksum IS DISTINCT FROM 'ca2f76a753ba05153e30f220c7532695'
    THEN
      RAISE EXCEPTION
        'Preflight failed: unexpected baseline state (public %, private schema %, helper missing)',
        v_public_checksum,
        v_private_schema_oid;
    END IF;

    IF v_public_owner IS DISTINCT FROM 'postgres'
      OR v_public_security_definer IS DISTINCT FROM false
      OR v_public_volatility IS DISTINCT FROM 's'
      OR v_public_parallel IS DISTINCT FROM 'u'
      OR v_public_config IS DISTINCT FROM '{"search_path=public"}'
      OR v_public_acl IS DISTINCT FROM
        '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
    THEN
      RAISE EXCEPTION
        'Preflight failed: repository baseline resolver metadata changed';
    END IF;

    RETURN;
  END IF;

  SELECT
    md5(pg_get_functiondef(proc.oid)),
    pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig::text,
    proc.proacl::text
  INTO
    v_helper_checksum,
    v_helper_owner,
    v_helper_security_definer,
    v_helper_volatility,
    v_helper_parallel,
    v_helper_config,
    v_helper_acl
  FROM pg_proc AS proc
  WHERE proc.oid = v_helper_oid;

  IF v_public_checksum IS DISTINCT FROM '46412e94cf00a788230835f6d56d8d3b'
    OR (
      v_helper_checksum IS DISTINCT FROM '87cbb20bdfe8c934e43ccf9c7c01261d'
      AND v_helper_checksum IS DISTINCT FROM 'f4524e751fbca68adc364272885e07ae'
    )
  THEN
    RAISE EXCEPTION
      'Preflight failed: unexpected live resolver checksums (public %, helper %)',
      v_public_checksum,
      v_helper_checksum;
  END IF;

  IF v_private_schema_oid IS NULL
    OR (SELECT pg_get_userbyid(nsp.nspowner) FROM pg_namespace AS nsp WHERE nsp.oid = v_private_schema_oid)
      IS DISTINCT FROM 'postgres'
    OR (SELECT nsp.nspacl::text FROM pg_namespace AS nsp WHERE nsp.oid = v_private_schema_oid)
      IS DISTINCT FROM
      '{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres,service_role=U/postgres}'
    OR v_public_owner IS DISTINCT FROM 'postgres'
    OR v_public_security_definer IS DISTINCT FROM false
    OR v_public_volatility IS DISTINCT FROM 's'
    OR v_public_parallel IS DISTINCT FROM 'u'
    OR v_public_config IS DISTINCT FROM '{"search_path=pg_catalog, public, private"}'
    OR v_public_acl IS DISTINCT FROM
      '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
    OR v_helper_owner IS DISTINCT FROM 'postgres'
    OR v_helper_security_definer IS DISTINCT FROM false
    OR v_helper_volatility IS DISTINCT FROM 's'
    OR v_helper_parallel IS DISTINCT FROM 'u'
    OR v_helper_config IS DISTINCT FROM '{"search_path=pg_catalog, public, private"}'
    OR v_helper_acl IS DISTINCT FROM
      '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  THEN
    RAISE EXCEPTION 'Preflight failed: live resolver metadata or ACL changed';
  END IF;
END;
$preflight$;

-- Serialize the resolver cutover with the existing entitlement/account quota
-- validation paths without changing their trigger or writer definitions.
SELECT pg_advisory_xact_lock(
  hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
);

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

-- Read-only aggregate for every active Product 16/18 row. All enabled
-- subtypes receive the same entitlement_id so existing quota consumers treat
-- QR, Web and Server as one merged Zalo pool without changing their triggers.
CREATE OR REPLACE FUNCTION private.resolve_organization_zalo_entitlement_pools(
  p_organization_id bigint
)
RETURNS TABLE(
  account_subtype text,
  entitlement_id bigint,
  product_id bigint,
  product_name text,
  package_name text,
  package_type text,
  expiration_date timestamptz,
  max_sends_per_day integer,
  max_accounts integer,
  created_at timestamptz,
  pool_revision text
)
LANGUAGE sql
STABLE
SET search_path TO pg_catalog, public, private
AS $function$
  WITH active_entitlements AS MATERIALIZED (
    SELECT
      entitlement.id,
      entitlement.product_id,
      entitlement.product_name,
      entitlement.package_name,
      entitlement.package_type,
      entitlement.expiration_date,
      entitlement.max_accounts,
      entitlement.created_at,
      entitlement.xmin::text AS entitlement_xmin,
      COALESCE(entitlement.is_zalo_show_web, false) AS grants_web,
      COALESCE(entitlement.is_zalo_server, false) AS grants_server,
      CASE
        WHEN entitlement.max_sends_per_day > 0 THEN entitlement.max_sends_per_day
        WHEN lower(btrim(COALESCE(entitlement.package_type, ''))) = 'demo' THEN 30
        ELSE NULL
      END AS resolved_daily_limit
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.organization_id = p_organization_id
      AND entitlement.product_id IN (16, 18)
      AND entitlement.is_deleted = false
      AND entitlement.expiration_date IS NOT NULL
      AND entitlement.expiration_date >= (
        date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
          AT TIME ZONE 'Asia/Ho_Chi_Minh'
      )
  ),
  representative AS (
    SELECT entitlement.*
    FROM active_entitlements AS entitlement
    ORDER BY
      entitlement.expiration_date DESC,
      entitlement.created_at DESC NULLS LAST,
      entitlement.id DESC
    LIMIT 1
  ),
  merged AS (
    SELECT
      count(*) AS entitlement_count,
      count(*) > 0 AS qr_enabled,
      COALESCE(bool_or(entitlement.grants_web), false) AS web_enabled,
      COALESCE(bool_or(entitlement.grants_server), false) AS server_enabled,
      CASE
        WHEN count(*) = 0
          OR bool_or(entitlement.resolved_daily_limit IS NULL)
          THEN NULL
        ELSE max(entitlement.resolved_daily_limit)
      END AS max_sends_per_day,
      CASE
        WHEN count(*) = 0
          OR bool_or(
            entitlement.max_accounts IS NULL
              OR entitlement.max_accounts <= 0
          )
          THEN NULL
        ELSE max(entitlement.max_accounts)
      END AS max_accounts,
      md5(COALESCE(
        string_agg(
          entitlement.id::text || ':' || entitlement.entitlement_xmin,
          ',' ORDER BY entitlement.id
        ),
        ''
      )) AS aggregate_revision
    FROM active_entitlements AS entitlement
  ),
  slots(account_subtype, sort_order) AS (
    VALUES
      ('qr'::text, 1),
      ('web'::text, 2),
      ('server'::text, 3)
  )
  SELECT
    slot.account_subtype,
    CASE WHEN grant_state.enabled THEN representative.id END,
    CASE WHEN grant_state.enabled THEN representative.product_id END,
    CASE WHEN grant_state.enabled THEN representative.product_name END,
    CASE WHEN grant_state.enabled THEN representative.package_name END,
    CASE WHEN grant_state.enabled THEN representative.package_type END,
    CASE WHEN grant_state.enabled THEN representative.expiration_date END,
    CASE WHEN grant_state.enabled THEN merged.max_sends_per_day END,
    CASE WHEN grant_state.enabled THEN merged.max_accounts END,
    CASE WHEN grant_state.enabled THEN representative.created_at END,
    CASE
      WHEN grant_state.enabled AND merged.entitlement_count = 1 THEN
        representative.id::text || ':' || representative.entitlement_xmin
      WHEN grant_state.enabled THEN
        representative.id::text || ':' || merged.aggregate_revision
      ELSE
        'none:'
          || COALESCE(p_organization_id::text, 'null')
          || ':'
          || slot.account_subtype
    END AS pool_revision
  FROM slots AS slot
  CROSS JOIN merged
  LEFT JOIN representative ON true
  CROSS JOIN LATERAL (
    SELECT CASE slot.account_subtype
      WHEN 'qr' THEN merged.qr_enabled
      WHEN 'web' THEN merged.web_enabled
      WHEN 'server' THEN merged.server_enabled
      ELSE false
    END AS enabled
  ) AS grant_state
  ORDER BY slot.sort_order;
$function$;

ALTER FUNCTION private.resolve_organization_zalo_entitlement_pools(bigint)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.resolve_organization_zalo_entitlement_pools(bigint)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.resolve_organization_zalo_entitlement_pools(bigint)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION private.resolve_organization_zalo_entitlement_pools(bigint) IS
  'Read-only merged Product 16/18 QR, Web and Server entitlement pool; enabled subtypes share one quota and revision.';

-- Keep the DB-only compatibility wrapper exactly, now backed by the merged
-- helper. This also upgrades a clean v219 replay without changing callers.
CREATE OR REPLACE FUNCTION public.resolve_organization_zalo_account_capabilities(p_organization_id bigint)
 RETURNS TABLE(entitlement_id bigint, product_id bigint, product_name text, package_name text, package_type text, expiration_date timestamp with time zone, max_sends_per_day integer, max_accounts integer, created_at timestamp with time zone, qr_enabled boolean, web_enabled boolean, server_enabled boolean, capability_revision text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  WITH pools AS MATERIALIZED (
    SELECT *
    FROM private.resolve_organization_zalo_entitlement_pools(p_organization_id)
  ),
  flags AS (
    SELECT
      COALESCE(
        bool_or(entitlement_id IS NOT NULL)
          FILTER (WHERE account_subtype = 'qr'),
        false
      ) AS qr_enabled,
      COALESCE(
        bool_or(entitlement_id IS NOT NULL)
          FILTER (WHERE account_subtype = 'web'),
        false
      ) AS web_enabled,
      COALESCE(
        bool_or(entitlement_id IS NOT NULL)
          FILTER (WHERE account_subtype = 'server'),
        false
      ) AS server_enabled
    FROM pools
  ),
  primary_pool AS (
    SELECT *
    FROM pools
    WHERE entitlement_id IS NOT NULL
    ORDER BY CASE account_subtype
      WHEN 'server' THEN 1
      WHEN 'web' THEN 2
      ELSE 3
    END
    LIMIT 1
  )
  SELECT
    primary_pool.entitlement_id,
    primary_pool.product_id,
    primary_pool.product_name,
    primary_pool.package_name,
    primary_pool.package_type,
    primary_pool.expiration_date,
    primary_pool.max_sends_per_day,
    primary_pool.max_accounts,
    primary_pool.created_at,
    flags.qr_enabled,
    flags.web_enabled,
    flags.server_enabled,
    COALESCE(
      primary_pool.pool_revision,
      'none:' || COALESCE(p_organization_id::text, 'null')
    ) AS capability_revision
  FROM flags
  LEFT JOIN primary_pool ON true;
$function$;

ALTER FUNCTION public.resolve_organization_zalo_account_capabilities(bigint)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_organization_zalo_account_capabilities(bigint)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_organization_zalo_account_capabilities(bigint)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.resolve_organization_zalo_account_capabilities(bigint) IS
  'Compatibility resolver for all active Product 16/18 rows merged into additive QR, Web and Server capabilities with one shared quota.';

DO $postflight$
DECLARE
  v_helper_oid regprocedure := to_regprocedure(
    'private.resolve_organization_zalo_entitlement_pools(bigint)'
  );
  v_public_oid regprocedure := to_regprocedure(
    'public.resolve_organization_zalo_account_capabilities(bigint)'
  );
BEGIN
  IF v_helper_oid IS NULL
    OR md5(pg_get_functiondef(v_helper_oid)) IS DISTINCT FROM
      'f4524e751fbca68adc364272885e07ae'
    OR v_public_oid IS NULL
    OR md5(pg_get_functiondef(v_public_oid)) IS DISTINCT FROM
      '46412e94cf00a788230835f6d56d8d3b'
  THEN
    RAISE EXCEPTION 'Postflight failed: resolver target checksum mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_namespace AS nsp
    WHERE nsp.oid = to_regnamespace('private')
      AND pg_get_userbyid(nsp.nspowner) = 'postgres'
      AND nsp.nspacl::text =
        '{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres,service_role=U/postgres}'
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    WHERE proc.oid IN (v_helper_oid, v_public_oid)
      AND (
        pg_get_userbyid(proc.proowner) IS DISTINCT FROM 'postgres'
        OR proc.prosecdef IS DISTINCT FROM false
        OR proc.provolatile IS DISTINCT FROM 's'
        OR proc.proparallel IS DISTINCT FROM 'u'
        OR proc.proconfig::text IS DISTINCT FROM
          '{"search_path=pg_catalog, public, private"}'
        OR proc.proacl::text IS DISTINCT FROM
          '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      )
  ) THEN
    RAISE EXCEPTION 'Postflight failed: resolver metadata or ACL mismatch';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
