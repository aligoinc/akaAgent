-- Thân 4 hàm đọc trên production (pg_get_functiondef, đọc chỉ đọc 25/11/2026), trước V653. Chỉ dùng cho bộ thử cục bộ.
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
  v_page_sql text;
  v_branch_order text;
  v_result jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

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
  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;
  -- Count text matches with the existing covering status index. The second
  -- branch only counts additional main/sub-status matches: no double counting,
  -- even when both IDs match, or when the legacy text is NULL.
  v_count_sql := 'SELECT count(*) FROM public.auto_campaign_details AS d WHERE ' || v_where;
  v_page_sql := 'SELECT d.id, d.created_at FROM public.auto_campaign_details AS d WHERE ' || v_where;
  IF v_status IS NOT NULL THEN
    v_count_sql := 'SELECT (' || v_count_sql || ' AND d.status = $2)';
    v_page_sql := v_page_sql || ' AND d.status = $2';
    IF cardinality(v_status_ids)>0 THEN
      v_count_sql := v_count_sql || ' + (SELECT count(*) FROM public.auto_campaign_details AS d WHERE '
        || v_where || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8)))';
      -- The same disjoint branches avoid a full campaign scan when a status
      -- has no matches. Each ordered prefix is sufficient for the final page;
      -- only the outer query applies OFFSET. bigint prevents integer overflow.
      v_branch_order := ' ORDER BY d.created_at ' || v_direction || ', d.id ' || v_direction
        || ' LIMIT ($6::bigint + $7::bigint)';
      v_page_sql := '(' || v_page_sql || v_branch_order || ') UNION ALL (SELECT d.id, d.created_at'
        || ' FROM public.auto_campaign_details AS d WHERE ' || v_where
        || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8))'
        || v_branch_order || ')';
    END IF;
  END IF;

  -- Both keys are NOT NULL in the live schema (checked by preflight). Default
  -- NULL placement is therefore equivalent to NULLS LAST for both directions,
  -- and allows one index to support forward and backward index-only scans.
  -- MATERIALIZED limits the narrow ID set before any full-row payload lookup.
  -- Count, page IDs and payload are read by one statement / MVCC snapshot;
  -- count remains available even when the requested page has no items.
  EXECUTE format($query$
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM (%1$s) AS d
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
  $query$, v_page_sql, v_direction, v_count_sql)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0), v_status_ids, v_search_ids;
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page_v3(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer, p_sort text, p_auth_username text, p_auth_password text, p_engagement_filter text DEFAULT NULL::text, p_action_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
 SET jit TO 'off'
AS $function$
DECLARE
  v_action text := btrim(left(p_action_code, 80));
  v_action_where text;
  v_sort text := COALESCE(p_sort, 'created_desc');
  v_search text := NULLIF(btrim(left(p_search, 200)), '');
  v_status text := NULLIF(btrim(left(p_status, 120)), '');
  v_where text;
  v_direction text;
  v_status_ids bigint[];
  v_search_ids bigint[];
  v_count_sql text;
  v_page_sql text;
  v_branch_order text;
  v_result jsonb;
BEGIN
  -- "All actions" is exactly v2 (same predicates, plan and JSON).
  IF p_action_code IS NULL THEN
    RETURN public.aka_agent_list_campaign_details_page_v2(p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_offset, p_limit, p_sort, p_auth_username, p_auth_password, p_engagement_filter);
  END IF;
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
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
  -- '' = results recorded without action_code (old rows); otherwise an action code.
  IF v_action <> '' AND v_action !~ '^[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'invalid_campaign_details_action';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Only fixed SQL fragments are concatenated. All user values are bound ($10 = action code).
  v_action_where := CASE WHEN v_action = '' THEN 'd.action_code IS NULL' ELSE 'd.action_code = $10' END;
  v_where := 'd.campaign_id = $1 AND d.is_delete = false AND ' || v_action_where;
  -- From here on: the predicates of v2.
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
  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;
  v_branch_order := ' ORDER BY d.created_at ' || v_direction || ', d.id ' || v_direction
    || ' LIMIT ($6::bigint + $7::bigint)';
  v_count_sql := 'SELECT count(*) FROM public.auto_campaign_details AS d WHERE ' || v_where;
  IF v_status IS NOT NULL THEN
    -- v2's disjoint status branches; the first one is ordered by the (campaign, status, action, time) index.
    v_count_sql := 'SELECT (' || v_count_sql || ' AND d.status = $2)';
    v_page_sql := 'SELECT d.id, d.created_at FROM public.auto_campaign_details AS d WHERE ' || v_where || ' AND d.status = $2';
    IF cardinality(v_status_ids)>0 THEN
      v_count_sql := v_count_sql || ' + (SELECT count(*) FROM public.auto_campaign_details AS d WHERE '
        || v_where || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8)))';
      v_page_sql := '(' || v_page_sql || v_branch_order || ') UNION ALL (SELECT d.id, d.created_at'
        || ' FROM public.auto_campaign_details AS d WHERE ' || v_where
        || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8))'
        || v_branch_order || ')';
    END IF;
  ELSE
    -- One ordered prefix per recorded status (status is NOT NULL: checked by the preflight). The distinct statuses come
    -- from an index-only range of (campaign_id, …, action_code); each prefix reads at most offset + limit rows.
    v_page_sql := 'SELECT x.id, x.created_at FROM (SELECT DISTINCT d.status FROM public.auto_campaign_details AS d'
      || ' WHERE d.campaign_id = $1 AND d.is_delete = false AND ' || v_action_where || ') AS s'
      || ' CROSS JOIN LATERAL (SELECT d.id, d.created_at FROM public.auto_campaign_details AS d WHERE ' || v_where
      || ' AND d.status = s.status' || v_branch_order || ' OFFSET 0) AS x';
  END IF;

  -- Payload exactly as v2.
  EXECUTE format($query$
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM (%1$s) AS d
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
  $query$, v_page_sql, v_direction, v_count_sql)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0), v_status_ids, v_search_ids, v_action;
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_read_campaign_result_recipients(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_campaign_id bigint, p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
 SET jit TO 'off'
AS $function$
DECLARE
  -- Newest results returned per recipient (resultCount is always the full count).
  c_history constant integer := 50;
  c_page_max constant integer := 100;
  c_keys_max constant integer := 100000;
  c_by_keys_max constant integer := 200;
  v_mode text;
  v_sort text;
  v_search text;
  v_status text;
  v_engagement text;
  v_date_from timestamptz;
  v_date_to timestamptz;
  v_offset bigint;
  v_limit integer;
  v_status_ids bigint[];
  v_search_ids bigint[];
  v_detail_where text := 'd.campaign_id = $1 AND d.is_delete = false AND d.input_data_id IS NOT NULL';
  v_has_result_filter boolean := false;
  v_result_search text;
  v_recipient_search constant text := '(i.name ILIKE $5 OR i.phone ILIKE $5 OR i.uid ILIKE $5 OR i.email ILIKE $5)';
  v_recipients_sql text;
  v_order text;
  v_ids bigint[];
  v_total bigint;
  v_items jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_query IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
  END IF;
  v_mode := p_query->>'mode';
  IF v_mode IS NULL OR v_mode NOT IN ('actions', 'page', 'keys', 'byKeys') THEN
    RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF v_mode = 'actions' THEN
    -- Index-only range of (campaign_id, status, action_code, created_at); one recorded name per code.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('code', a.action_code, 'count', a.n, 'name', CASE
        WHEN a.action_code IS NULL THEN (SELECT named.action_name FROM public.auto_campaign_details named
          WHERE named.campaign_id = p_campaign_id AND named.is_delete = false AND named.action_code IS NULL LIMIT 1)
        ELSE (SELECT named.action_name FROM public.auto_campaign_details named
          WHERE named.campaign_id = p_campaign_id AND named.is_delete = false AND named.action_code = a.action_code LIMIT 1) END)
        ORDER BY a.n DESC, a.action_code NULLS LAST), '[]'::jsonb), COALESCE(sum(a.n), 0)
      INTO v_items, v_total
    FROM (
      SELECT d.action_code, count(*) AS n FROM public.auto_campaign_details d
      WHERE d.campaign_id = p_campaign_id AND d.is_delete = false
      GROUP BY d.action_code
    ) a;
    RETURN jsonb_build_object('actions', v_items, 'total', v_total);
  END IF;

  IF v_mode = 'byKeys' THEN
    IF jsonb_typeof(p_query->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->'ids') NOT BETWEEN 1 AND c_by_keys_max THEN
      RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
    END IF;
    BEGIN
      SELECT array_agg(value::bigint ORDER BY ord) INTO v_ids
      FROM jsonb_array_elements_text(p_query->'ids') WITH ORDINALITY AS e(value, ord);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
    END;
    IF EXISTS (SELECT 1 FROM unnest(v_ids) AS k(id) WHERE k.id IS NULL OR k.id <= 0) THEN
      RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_sort := COALESCE(p_query->>'sort', 'processed_desc');
    v_search := NULLIF(btrim(left(p_query->>'search', 200)), '');
    v_status := NULLIF(btrim(left(p_query->>'status', 120)), '');
    v_engagement := COALESCE(NULLIF(p_query->>'engagementFilter', ''), 'all');
    IF v_sort NOT IN ('processed_desc', 'processed_asc', 'created_desc', 'created_asc')
      OR v_engagement NOT IN ('all', 'seen', 'responded', 'reacted', 'friended', 'none') THEN
      RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_date_from := NULLIF(p_query->>'dateFrom', '')::timestamptz;
      v_date_to := NULLIF(p_query->>'dateTo', '')::timestamptz;
      v_offset := COALESCE(NULLIF(p_query->>'offset', '')::bigint, 0);
      v_limit := COALESCE(NULLIF(p_query->>'limit', '')::integer, c_page_max);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
    END;
    IF (v_date_from IS NOT NULL AND v_date_to IS NOT NULL AND v_date_from > v_date_to)
      OR v_offset < 0 OR v_limit NOT BETWEEN 1 AND c_page_max THEN
      RAISE EXCEPTION 'invalid_campaign_result_recipients' USING ERRCODE = '22023';
    END IF;

    -- Result predicates: exactly those of v2 (bound parameters, fixed fragments only).
    IF v_date_from IS NOT NULL THEN v_detail_where := v_detail_where || ' AND d.created_at >= $3'; v_has_result_filter := true; END IF;
    IF v_date_to IS NOT NULL THEN v_detail_where := v_detail_where || ' AND d.created_at <= $4'; v_has_result_filter := true; END IF;
    IF v_status IS NOT NULL THEN
      v_status_ids := ARRAY(SELECT s.id FROM public.auto_status s WHERE s.status_value = v_status OR lower(s.name) = lower(v_status));
      v_detail_where := v_detail_where || CASE WHEN cardinality(v_status_ids) > 0
        THEN ' AND (d.status = $2 OR d.status_id = ANY($8) OR d.sub_status_id = ANY($8))' ELSE ' AND d.status = $2' END;
      v_has_result_filter := true;
    END IF;
    IF v_engagement <> 'all' THEN
      v_detail_where := v_detail_where || ' AND EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND ' ||
        CASE v_engagement WHEN 'seen' THEN 'e.seen_at IS NOT NULL' WHEN 'responded' THEN 'e.responded_at IS NOT NULL'
          WHEN 'reacted' THEN 'e.reacted_at IS NOT NULL' WHEN 'friended' THEN 'e.friended_at IS NOT NULL'
          ELSE 'e.seen_at IS NULL AND e.responded_at IS NULL AND e.reacted_at IS NULL AND e.friended_at IS NULL' END || ')';
      v_has_result_filter := true;
    END IF;
    IF v_search IS NOT NULL THEN
      v_search_ids := ARRAY(SELECT s.id FROM public.auto_status s WHERE s.name ILIKE '%' || v_search || '%' OR s.status_value ILIKE '%' || v_search || '%');
      v_result_search := '(d.action_name ILIKE $5 OR d.action_code ILIKE $5 OR d.status ILIKE $5 OR d.error_code ILIKE $5'
        || ' OR d.log ILIKE $5 OR d.post_url ILIKE $5'
        || CASE WHEN cardinality(v_search_ids) > 0 THEN ' OR d.status_id = ANY($9) OR d.sub_status_id = ANY($9)' ELSE '' END || ')';
    END IF;

    -- Recipients of the campaign (as the recipients tab: COALESCE(is_delete, false) = false). A recipient matches when it
    -- has at least one result matching every result predicate; the search also matches the recipient's own name, phone,
    -- uid or email (then the other result predicates still need one matching result).
    v_recipients_sql := 'SELECT i.id, i.created_at, i.date_action FROM public.auto_campaign_input_data AS i'
      || ' WHERE i.campaign_id = $1 AND COALESCE(i.is_delete, false) = false';
    IF v_search IS NOT NULL THEN
      v_recipients_sql := v_recipients_sql || ' AND (i.id IN (SELECT d.input_data_id FROM public.auto_campaign_details AS d WHERE '
        || v_detail_where || ' AND ' || v_result_search || ') OR (' || v_recipient_search
        || CASE WHEN v_has_result_filter THEN ' AND EXISTS (SELECT 1 FROM public.auto_campaign_details AS d WHERE d.input_data_id = i.id AND '
          || v_detail_where || ')' ELSE '' END || '))';
    ELSIF v_has_result_filter THEN
      v_recipients_sql := v_recipients_sql || ' AND i.id IN (SELECT d.input_data_id FROM public.auto_campaign_details AS d WHERE '
        || v_detail_where || ')';
    END IF;
    -- Processed sorts keep never-processed recipients last (date_action NULL); ties by id in the same direction.
    v_order := CASE v_sort
      WHEN 'processed_desc' THEN 'r.date_action IS NULL, COALESCE(r.date_action, r.created_at) DESC NULLS LAST, r.id DESC'
      WHEN 'processed_asc' THEN 'r.date_action IS NULL, COALESCE(r.date_action, r.created_at) ASC NULLS LAST, r.id ASC'
      WHEN 'created_desc' THEN 'r.created_at DESC NULLS LAST, r.id DESC'
      ELSE 'r.created_at ASC NULLS LAST, r.id ASC' END;

    EXECUTE format('WITH r AS MATERIALIZED (%1$s) SELECT (SELECT count(*) FROM r), ARRAY(SELECT r.id FROM r ORDER BY %2$s LIMIT $6 OFFSET $7)',
      v_recipients_sql, v_order)
      INTO v_total, v_ids
      USING p_campaign_id, v_status, v_date_from, v_date_to, '%' || v_search || '%',
        CASE WHEN v_mode = 'keys' THEN c_keys_max ELSE v_limit END, CASE WHEN v_mode = 'keys' THEN 0 ELSE v_offset END,
        v_status_ids, v_search_ids;
    IF v_mode = 'keys' THEN
      RETURN jsonb_build_object('total', v_total, 'ids', to_jsonb(COALESCE(v_ids, '{}'::bigint[])), 'truncated', v_total > c_keys_max);
    END IF;
  END IF;

  -- Recipients of this page/batch with their newest results. Each recipient's results are probed by input_data_id
  -- (index); OFFSET 0 keeps the probe per recipient instead of a plan over the campaign's results.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'phone', i.phone, 'uid', i.uid, 'email', i.email,
      'info1', i.info1, 'info2', i.info2, 'info3', i.info3, 'info4', i.info4, 'info5', i.info5,
      'status', i.status, 'note', i.note, 'createdAt', i.created_at, 'dateAction', i.date_action,
      'resultCount', COALESCE(r.total, 0), 'results', COALESCE(r.items, '[]'::jsonb)) ORDER BY k.ord), '[]'::jsonb)
    INTO v_items
  FROM unnest(COALESCE(v_ids, '{}'::bigint[])) WITH ORDINALITY AS k(id, ord)
  JOIN public.auto_campaign_input_data AS i
    ON i.id = k.id AND i.campaign_id = p_campaign_id AND COALESCE(i.is_delete, false) = false
  LEFT JOIN LATERAL (
    SELECT max(x.total) AS total, jsonb_agg(jsonb_build_object(
        'id', x.id, 'actionCode', x.action_code, 'actionName', x.action_name, 'status', x.status,
        'statusId', x.status_id, 'subStatusId', x.sub_status_id, 'reportGroup', x.report_group, 'errorCode', x.error_code,
        'log', x.log, 'postUrl', x.post_url, 'errorMessage', x.error_message, 'createdAt', x.created_at,
        'statusPresentation', CASE WHEN ms.id IS NULL THEN NULL ELSE jsonb_build_object('code', ms.code, 'name', ms.name, 'color', ms.color, 'statusValue', ms.status_value) END,
        'subStatusPresentation', CASE WHEN ss.id IS NULL THEN NULL ELSE jsonb_build_object('code', ss.code, 'name', ss.name, 'color', ss.color, 'statusValue', ss.status_value) END,
        'zaloEngagement', to_jsonb(e)) ORDER BY x.created_at DESC, x.id DESC) AS items
    FROM (
      SELECT d.id, d.action_code, d.action_name, d.status, d.status_id, d.sub_status_id, d.report_group, d.error_code,
        left(d.log, 1000) AS log, left(d.post_url, 1000) AS post_url, left(d.data->>'errorMessage', 500) AS error_message,
        d.created_at, count(*) OVER () AS total
      FROM public.auto_campaign_details AS d
      WHERE d.input_data_id = i.id AND d.campaign_id = p_campaign_id AND d.is_delete = false
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT c_history OFFSET 0
    ) AS x
    LEFT JOIN public.auto_status AS ms ON ms.id = x.status_id
    LEFT JOIN public.auto_status AS ss ON ss.id = x.sub_status_id
    LEFT JOIN public.auto_campaign_detail_zalo_engagement AS e ON e.campaign_detail_id = x.id
  ) AS r ON true;

  IF v_mode = 'byKeys' THEN
    RETURN jsonb_build_object('items', v_items);
  END IF;
  RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_read_campaign_run_report(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_campaign_id bigint, p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_tz constant text := 'Asia/Ho_Chi_Minh';
  -- Same engagement actions as V462 (exclusive message stages; friend acceptance).
  v_message constant text[] := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
  v_friend constant text := 'zalo_add_friend';
  v_campaign record;
  v_success text[];
  v_skipped text[];
  v_failure text[];
  v_aux text[];
  v_not_found text[];
  v_not_found_codes text[];
  v_total bigint;
  v_first timestamptz;
  v_last timestamptz;
  v_unit text;
  v_inputs jsonb;
  v_main jsonb;
BEGIN
  -- Desktop token must belong to p_staff_id and carry the automation credentials; service_role passes.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN RAISE EXCEPTION 'report_access_denied' USING ERRCODE = '42501'; END IF;

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_query IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object'
    OR (p_query ? 'legacy' AND jsonb_typeof(p_query->'legacy') IS DISTINCT FROM 'object')
    OR (p_query ? 'auxiliaryActionCodes' AND (jsonb_typeof(p_query->'auxiliaryActionCodes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'auxiliaryActionCodes') > 50))
    OR (p_query ? 'notFoundStatuses' AND (jsonb_typeof(p_query->'notFoundStatuses') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'notFoundStatuses') > 20))
    OR (p_query ? 'notFoundStatusCodes' AND (jsonb_typeof(p_query->'notFoundStatusCodes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'notFoundStatusCodes') > 20)) THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT coalesce(array_agg(value), '{}') INTO v_success FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,success}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_skipped FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,skipped}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_failure FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,failure}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_aux FROM jsonb_array_elements_text(coalesce(p_query->'auxiliaryActionCodes', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_not_found FROM jsonb_array_elements_text(coalesce(p_query->'notFoundStatuses', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_not_found_codes FROM jsonb_array_elements_text(coalesce(p_query->'notFoundStatusCodes', '[]'));
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END;

  SELECT c.id, c.status, c.created_at INTO v_campaign
  FROM public.auto_campaigns c
  WHERE c.id = p_campaign_id AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_report_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Data ban đầu by status (index-only on idx_campaign_input_data_progress_live).
  SELECT coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n) ORDER BY s.status), '[]'::jsonb)
    INTO v_inputs
  FROM (
    SELECT coalesce(i.status, '') AS status, count(*) AS n
    FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = p_campaign_id AND i.is_delete = false
    GROUP BY 1
  ) s;

  -- Span of the results (idx_campaign_details_page) picks the timeline unit: hour ≤ 48 h, day ≤ 180 days, else week.
  SELECT count(*), min(d.created_at), max(d.created_at) INTO v_total, v_first, v_last
  FROM public.auto_campaign_details d
  WHERE d.campaign_id = p_campaign_id AND d.is_delete = false;
  v_unit := CASE
    WHEN v_first IS NULL OR v_last - v_first > interval '180 days' THEN CASE WHEN v_first IS NULL THEN 'day' ELSE 'week' END
    WHEN v_last - v_first <= interval '48 hours' THEN 'hour'
    ELSE 'day' END;

  -- One statement: the campaign's results are read once (materialized) and aggregated four ways.
  WITH d AS MATERIALIZED (
    SELECT d.id, d.input_data_id, d.action_code, d.action_name, d.status, d.status_id, d.sub_status_id, d.created_at,
      -- Stored report_group wins; legacy NULL rows keep the existing text mapping; anything else is "other".
      CASE
        WHEN d.report_group IN ('success', 'failure', 'skipped', 'pending') THEN d.report_group
        WHEN d.report_group IS NULL AND d.status = ANY(v_success) THEN 'success'
        WHEN d.report_group IS NULL AND d.status = ANY(v_skipped) THEN 'skipped'
        WHEN d.report_group IS NULL AND d.status = ANY(v_failure) THEN 'failure'
        ELSE 'other'
      END AS grp,
      coalesce(d.action_code = ANY(v_aux), false) AS aux,
      (d.status = ANY(v_not_found) OR coalesce(st.code = ANY(v_not_found_codes), false)) AS not_found
    FROM public.auto_campaign_details d
    LEFT JOIN public.auto_status st ON st.id = d.status_id
    WHERE d.campaign_id = p_campaign_id AND d.is_delete = false
  ),
  per_input AS (
    SELECT i.id, coalesce(i.status, '') AS status, count(d.id) AS n,
      bool_or(NOT d.aux) AS has_main,
      bool_or(d.grp = 'success' AND NOT d.aux) AS main_success, bool_or(d.grp = 'success' AND d.aux) AS aux_success,
      bool_or(d.grp = 'failure' AND NOT d.aux) AS main_failure, bool_or(d.grp = 'failure' AND d.aux) AS aux_failure,
      bool_or(d.grp = 'skipped' AND NOT d.aux) AS main_skipped, bool_or(d.grp = 'skipped' AND d.aux) AS aux_skipped,
      bool_or(d.grp = 'pending' AND NOT d.aux) AS main_pending, bool_or(d.grp = 'pending' AND d.aux) AS aux_pending,
      bool_or(d.grp = 'failure' AND d.not_found AND NOT d.aux) AS main_not_found,
      bool_or(d.grp = 'failure' AND d.not_found AND d.aux) AS aux_not_found
    FROM public.auto_campaign_input_data i
    LEFT JOIN d ON d.input_data_id = i.id
    WHERE i.campaign_id = p_campaign_id AND i.is_delete = false
    GROUP BY i.id, coalesce(i.status, '')
  ),
  outcome AS (
    -- Main actions decide; auxiliary ones (phone lookup, tag, alias) only when no main action ran.
    -- Order: success → failure → skipped → pending → none → other.
    SELECT p.status,
      CASE
        WHEN p.n = 0 THEN 'none'
        WHEN CASE WHEN p.has_main THEN p.main_success ELSE p.aux_success END THEN 'success'
        WHEN CASE WHEN p.has_main THEN p.main_failure ELSE p.aux_failure END THEN 'failure'
        WHEN CASE WHEN p.has_main THEN p.main_skipped ELSE p.aux_skipped END THEN 'skipped'
        WHEN CASE WHEN p.has_main THEN p.main_pending ELSE p.aux_pending END THEN 'pending'
        ELSE 'other'
      END AS outcome,
      coalesce(CASE WHEN p.has_main THEN p.main_not_found ELSE p.aux_not_found END, false) AS not_found
    FROM per_input p
  )
  SELECT jsonb_build_object(
    'results', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
          'actionCode', g.action_code, 'actionName', g.action_name, 'statusId', g.status_id, 'legacyStatus', g.legacy_status,
          'subStatusId', g.sub_status_id, 'group', g.grp, 'count', g.n, 'sampleStatus', g.sample_status)
          ORDER BY g.action_code NULLS LAST, g.grp, g.status_id NULLS LAST, g.legacy_status NULLS LAST, g.sub_status_id NULLS FIRST), '[]'::jsonb)
      FROM (
        SELECT d.action_code, max(d.action_name) AS action_name, d.status_id,
          CASE WHEN d.status_id IS NULL THEN d.status END AS legacy_status, d.sub_status_id, d.grp,
          count(*) AS n, min(d.status) AS sample_status
        FROM d
        GROUP BY d.action_code, d.status_id, CASE WHEN d.status_id IS NULL THEN d.status END, d.sub_status_id, d.grp
      ) g),
    'timeline', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
          'at', to_char(t.bucket, CASE WHEN v_unit = 'hour' THEN 'YYYY-MM-DD"T"HH24:00' ELSE 'YYYY-MM-DD' END),
          'group', t.grp, 'count', t.n) ORDER BY t.bucket, t.grp), '[]'::jsonb)
      FROM (SELECT date_trunc(v_unit, d.created_at AT TIME ZONE v_tz) AS bucket, d.grp, count(*) AS n FROM d GROUP BY 1, 2) t),
    'inputOutcomes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('status', o.status, 'outcome', o.outcome, 'notFound', o.not_found, 'count', o.n)
          ORDER BY o.status, o.outcome, o.not_found), '[]'::jsonb)
      FROM (SELECT status, outcome, not_found, count(*) AS n FROM outcome GROUP BY 1, 2, 3) o),
    'engagement', (
      SELECT jsonb_build_object(
        'messageSent', count(*) FILTER (WHERE d.action_code = ANY(v_message)),
        'messageTracked', count(e.campaign_detail_id) FILTER (WHERE d.action_code = ANY(v_message)),
        'responded', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NOT NULL),
        'reacted', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NULL AND e.reacted_at IS NOT NULL),
        'seen', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NULL AND e.reacted_at IS NULL
          AND e.seen_at IS NOT NULL),
        'friendRequested', count(*) FILTER (WHERE d.action_code = v_friend),
        'friendTracked', count(e.campaign_detail_id) FILTER (WHERE d.action_code = v_friend),
        'friended', count(*) FILTER (WHERE d.action_code = v_friend AND e.friended_at IS NOT NULL))
      FROM d
      LEFT JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id = d.id
      WHERE d.grp = 'success' AND (d.action_code = ANY(v_message) OR d.action_code = v_friend)),
    'statuses', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'statusValue', s.status_value)
          ORDER BY s.id), '[]'::jsonb)
      FROM public.auto_status s
      WHERE s.id IN (SELECT d.status_id FROM d WHERE d.status_id IS NOT NULL
        UNION SELECT d.sub_status_id FROM d WHERE d.sub_status_id IS NOT NULL))
  ) INTO v_main;

  RETURN jsonb_build_object(
    'dbNow', now(),
    'campaign', jsonb_build_object('id', v_campaign.id, 'status', v_campaign.status, 'createdAt', v_campaign.created_at),
    'inputs', v_inputs,
    'results', jsonb_build_object('total', v_total, 'firstAt', v_first, 'lastAt', v_last, 'groups', v_main->'results'),
    'timeline', jsonb_build_object('unit', v_unit, 'points', v_main->'timeline'),
    'inputOutcomes', v_main->'inputOutcomes',
    'engagement', v_main->'engagement',
    'statuses', v_main->'statuses'
  );
END;
$function$
;

