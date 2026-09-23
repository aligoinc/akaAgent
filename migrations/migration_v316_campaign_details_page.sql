-- New additive endpoint; existing RPCs and their ACLs stay unchanged.
-- Guard derived from the captured live detail-automation endpoint v195.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE v_oid regprocedure;
BEGIN
  v_oid := to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) <> '5a9a503db72b965eb644739f5f60905d' THEN
    RAISE EXCEPTION 'v316_identity_definition_changed';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_list_campaign_detail_automation_triggers(bigint,bigint,bigint,bigint[],text,text)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) <> '56822434723347452c8944484764daea' THEN
    RAISE EXCEPTION 'v316_detail_access_definition_changed';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auto_campaign_details'::regclass
    AND attname IN ('created_at','id') AND attnotnull AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'v316_order_keys_must_be_nonnull';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('public.idx_campaign_details_page') AND indisvalid AND indisready
      AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_campaign_details_page ON public.auto_campaign_details USING btree (campaign_id, created_at, id) WHERE (is_delete = false)') THEN
    RAISE EXCEPTION 'v316_page_index_not_ready';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text)');
  IF v_oid IS NOT NULL AND md5(pg_get_functiondef(v_oid)) <> '9652783556c25109e6250375da031fa3' THEN
    RAISE EXCEPTION 'v316_target_definition_changed';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page(
  p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint,
  p_search text, p_status text, p_date_from timestamptz, p_date_to timestamptz,
  p_offset integer, p_limit integer, p_sort text,
  p_auth_username text, p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_sort text := COALESCE(p_sort, 'created_desc');
  v_search text := NULLIF(btrim(left(p_search, 200)), '');
  v_status text := NULLIF(btrim(left(p_status, 120)), '');
  v_where text := 'd.campaign_id = $1 AND d.is_delete = false';
  v_direction text;
  v_result jsonb;
BEGIN
  -- Same credential + campaign ownership guard as the live detail provenance RPC.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0 OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_campaign_details_page';
  END IF;
  IF v_sort NOT IN ('created_asc', 'created_desc') THEN
    RAISE EXCEPTION 'invalid_campaign_details_sort';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'invalid_campaign_details_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Only fixed SQL fragments are concatenated. All user values are bound.
  -- Omitting inactive predicates avoids generic OR plans scanning wide rows.
  IF v_status IS NOT NULL THEN v_where := v_where || ' AND d.status = $2'; END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5)';
  END IF;
  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;

  -- Both keys are NOT NULL in the live schema (checked by preflight). Default
  -- NULL placement is therefore equivalent to NULLS LAST for both directions,
  -- and allows one index to support forward and backward index-only scans.
  -- MATERIALIZED limits the narrow ID set before any full-row payload lookup.
  -- Count, page IDs and payload are read by one statement / MVCC snapshot;
  -- count remains available even when the requested page has no items.
  EXECUTE format($query$
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM public.auto_campaign_details AS d
      WHERE %1$s
      ORDER BY d.created_at %2$s, d.id %2$s
      LIMIT $6 OFFSET $7
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(to_jsonb(detail) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.auto_campaign_details AS d WHERE %1$s)
    )
  $query$, v_where, v_direction)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0);
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text) TO anon, authenticated, service_role;
-- New RPC metadata needs a single transactional PostgREST schema refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;
