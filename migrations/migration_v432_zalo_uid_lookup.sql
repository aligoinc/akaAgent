-- Bounded read shared by Desktop and packaged Zalo Server.
-- Live akachat audit: this function name/signature is absent (2026-10-26).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_zalo_users_account_uid')
      AND i.indrelid = 'public.zalo_users'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indnkeyatts = 2
      AND pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'account_id'
      AND pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) = 'zalo_uid'
  ) THEN
    RAISE EXCEPTION 'V432: expected unique account/UID index is missing or changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'aka_agent_lookup_zalo_users'
  ) THEN
    RAISE EXCEPTION 'V432: lookup function already exists; capture and review live definition before changing it';
  END IF;
END
$preflight$;

CREATE FUNCTION public.aka_agent_lookup_zalo_users(
  p_account_id bigint,
  p_staff_id bigint,
  p_zalo_uids text[]
)
RETURNS SETOF public.zalo_users
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
SET plan_cache_mode = force_custom_plan
SET statement_timeout = '60s'
ROWS 100
AS $function$
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
     OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Zalo user lookup scope' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_zalo_uids) > 100 THEN
    RAISE EXCEPTION 'Zalo user lookup accepts at most 100 UIDs' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_zalo_uids), 0) = 0 THEN
    RETURN;
  END IF;

  -- Keep exact UID matching, ANY duplicate/null semantics and both filters.
  -- The unique (account_id,zalo_uid) index bounds each lateral lookup to one
  -- row. LIMIT prevents flattening back into a staff/account-wide scan.
  -- Staff is checked after that unique lookup, never used as the scan key.
  RETURN QUERY
    SELECT u.*
    FROM (
      SELECT DISTINCT requested.uid
      FROM unnest(p_zalo_uids) AS requested(uid)
      WHERE requested.uid IS NOT NULL
    ) AS requested
    CROSS JOIN LATERAL (
      SELECT stored.*
      FROM public.zalo_users AS stored
      WHERE stored.account_id = p_account_id
        AND stored.zalo_uid = requested.uid
      LIMIT 1
    ) AS u
    WHERE u.staff_id = p_staff_id;
END
$function$;

ALTER FUNCTION public.aka_agent_lookup_zalo_users(bigint,bigint,text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_lookup_zalo_users(bigint,bigint,text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_lookup_zalo_users(bigint,bigint,text[]) TO anon, authenticated, service_role;

-- A new Data API function requires schema discovery; no data/index/RLS changes.
NOTIFY pgrst, 'reload schema';
COMMIT;
