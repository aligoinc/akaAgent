-- Live definitions captured and verified in snapshots/detail-status-query-v372.
-- Body-only optimization: no new index, grants, connection, or schema reload.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
IF to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)')))<>'fb398b4e0fb53a5ebef8269805d51a8e'
      OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)')
        AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true
        AND p.provolatile='s' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
        AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    THEN RAISE EXCEPTION 'v372 RPC drift: aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)')))<>'0cab9241430282691f320221acf2ed5d'
      OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)')
        AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true
        AND p.provolatile='s' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
        AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    THEN RAISE EXCEPTION 'v372 RPC drift: aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)'; END IF;
END $guard$;
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
  v_status_ids bigint[];
  v_search_ids bigint[];
  v_count_sql text;
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
  -- Resolve the small catalog once, not once per matching detail. STABLE
  -- keeps these reads in the caller's snapshot, including the payload below.
  -- Keep historical/inactive catalog entries and the exact legacy comparisons.
  IF v_status IS NOT NULL THEN
    v_status_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.status_value=v_status OR lower(s.name)=lower(v_status));
  END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_search_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.name ILIKE '%' || v_search || '%' OR s.status_value ILIKE '%' || v_search || '%');
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5';
    IF cardinality(v_search_ids)>0 THEN
      v_where := v_where || ' OR d.status_id=ANY($9) OR d.sub_status_id=ANY($9)';
    END IF;
    v_where := v_where || ')';
  END IF;
  -- Count text matches with the existing covering status index. The second
  -- branch only counts additional main/sub-status matches: no double counting,
  -- even when both IDs match, or when the legacy text is NULL.
  v_count_sql := 'SELECT count(*) FROM public.auto_campaign_details AS d WHERE ' || v_where;
  IF v_status IS NOT NULL THEN
    v_count_sql := 'SELECT (' || v_count_sql || ' AND d.status = $2)';
    IF cardinality(v_status_ids)>0 THEN
      v_count_sql := v_count_sql || ' + (SELECT count(*) FROM public.auto_campaign_details AS d WHERE '
        || v_where || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8)))';
      v_where := v_where || ' AND (d.status = $2 OR d.status_id=ANY($8) OR d.sub_status_id=ANY($8))';
    ELSE
      v_where := v_where || ' AND d.status = $2';
    END IF;
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
      'total', (%3$s)
    )
  $query$, v_where, v_direction, v_count_sql)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0), v_status_ids, v_search_ids;
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page_v2(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer, p_sort text, p_auth_username text, p_auth_password text, p_engagement_filter text DEFAULT NULL::text)
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
  v_status_ids bigint[];
  v_search_ids bigint[];
  v_count_sql text;
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
  -- Resolve the small catalog once, not once per matching detail. STABLE
  -- keeps these reads in the caller's snapshot, including the payload below.
  -- Keep historical/inactive catalog entries and the exact legacy comparisons.
  IF v_status IS NOT NULL THEN
    v_status_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.status_value=v_status OR lower(s.name)=lower(v_status));
  END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_search_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.name ILIKE '%' || v_search || '%' OR s.status_value ILIKE '%' || v_search || '%');
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5';
    IF cardinality(v_search_ids)>0 THEN
      v_where := v_where || ' OR d.status_id=ANY($9) OR d.sub_status_id=ANY($9)';
    END IF;
    v_where := v_where || ')';
  END IF;
  IF COALESCE(p_engagement_filter, 'all') NOT IN ('all','seen','responded','reacted','friended','none') THEN
    RAISE EXCEPTION 'invalid_engagement_filter';
  END IF;
  IF p_engagement_filter IN ('seen','responded','reacted','friended','none') THEN
    v_where := v_where || ' AND EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND ' ||
      CASE p_engagement_filter WHEN 'seen' THEN 'e.seen_at IS NOT NULL' WHEN 'responded' THEN 'e.responded_at IS NOT NULL'
        WHEN 'reacted' THEN 'e.reacted_at IS NOT NULL' WHEN 'friended' THEN 'e.friended_at IS NOT NULL'
        ELSE 'e.seen_at IS NULL AND e.responded_at IS NULL AND e.reacted_at IS NULL AND e.friended_at IS NULL' END || ')';
  END IF;
  -- Count text matches with the existing covering status index. The second
  -- branch only counts additional main/sub-status matches: no double counting,
  -- even when both IDs match, or when the legacy text is NULL.
  v_count_sql := 'SELECT count(*) FROM public.auto_campaign_details AS d WHERE ' || v_where;
  IF v_status IS NOT NULL THEN
    v_count_sql := 'SELECT (' || v_count_sql || ' AND d.status = $2)';
    IF cardinality(v_status_ids)>0 THEN
      v_count_sql := v_count_sql || ' + (SELECT count(*) FROM public.auto_campaign_details AS d WHERE '
        || v_where || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8)))';
      v_where := v_where || ' AND (d.status = $2 OR d.status_id=ANY($8) OR d.sub_status_id=ANY($8))';
    ELSE
      v_where := v_where || ' AND d.status = $2';
    END IF;
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
        SELECT jsonb_agg(((to_jsonb(detail) || jsonb_build_object(
          'status_presentation', CASE WHEN main_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',main_status.code,'name',main_status.name,'color',main_status.color,'statusValue',main_status.status_value) END,
          'sub_status_presentation', CASE WHEN sub_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',sub_status.code,'name',sub_status.name,'color',sub_status.color,'statusValue',sub_status.status_value) END)) || jsonb_build_object('zalo_engagement', to_jsonb(engagement), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR (account.flatform_type='zalo' AND NOT COALESCE(account.is_zalo_show_web,false)
            AND detail.status='thành công' AND detail.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
            AND detail.data->'partialSend' IS NULL))) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_status main_status ON main_status.id=detail.status_id
        LEFT JOIN public.auto_status sub_status ON sub_status.id=detail.sub_status_id
        LEFT JOIN public.auto_campaign_detail_zalo_engagement engagement ON engagement.campaign_detail_id=page.id
        LEFT JOIN public.auto_accounts account ON account.id=detail.account_id
      ), '[]'::jsonb),
      'total', (%3$s)
    )
  $query$, v_where, v_direction, v_count_sql)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0), v_status_ids, v_search_ids;
  RETURN v_result;
END;
$function$
;
DO $guard$ BEGIN
IF to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)')))<>'90d54cad612d1deba5bcfed744a98184'
      OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)')
        AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true
        AND p.provolatile='s' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
        AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    THEN RAISE EXCEPTION 'v372 RPC drift: aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)')))<>'97646cd22e77071aeb9fc8bddbc8bf1c'
      OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)')
        AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true
        AND p.provolatile='s' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
        AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    THEN RAISE EXCEPTION 'v372 RPC drift: aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)'; END IF;
END $guard$;
COMMIT;
