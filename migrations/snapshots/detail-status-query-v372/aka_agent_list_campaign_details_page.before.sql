CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer, p_sort text, p_auth_username text, p_auth_password text)
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
  IF v_status IS NOT NULL THEN
    v_where := v_where || ' AND (d.status = $2 OR EXISTS (
      SELECT 1 FROM public.auto_status filter_status
      WHERE filter_status.id IN (d.status_id,d.sub_status_id)
        AND (filter_status.status_value=$2 OR lower(filter_status.name)=lower($2))))';
  END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5
      OR EXISTS (SELECT 1 FROM public.auto_status search_status
        WHERE search_status.id IN (d.status_id,d.sub_status_id)
          AND (search_status.name ILIKE $5 OR search_status.status_value ILIKE $5)))';
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
        SELECT jsonb_agg((to_jsonb(detail) || jsonb_build_object(
          'status_presentation', CASE WHEN main_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',main_status.code,'name',main_status.name,'color',main_status.color,'statusValue',main_status.status_value) END,
          'sub_status_presentation', CASE WHEN sub_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',sub_status.code,'name',sub_status.name,'color',sub_status.color,'statusValue',sub_status.status_value) END)) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_status main_status ON main_status.id=detail.status_id
        LEFT JOIN public.auto_status sub_status ON sub_status.id=detail.sub_status_id
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.auto_campaign_details AS d WHERE %1$s)
    )
  $query$, v_where, v_direction)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0);
  RETURN v_result;
END;
$function$
