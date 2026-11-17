-- Bộ lọc Hành động và "Gộp hành động vào một dòng" ở tab Kết quả chạy (WebApp, 14/11/2026).
-- Phương án: docs/CAMPAIGN_RESULT_ACTION_FILTER_PLAN.md; hợp đồng: docs/CAMPAIGN_RESULT_ACTION_FILTER.md.
--
-- Adds TWO read-only functions, nothing else: no table, column, index, policy, role or existing-function change.
--   1. aka_agent_list_campaign_details_page_v3 = v2 + p_action_code. NULL delegates to v2 unchanged (same JSON, same
--      plan); a code (or '' for results without action_code) filters by action. Without a status filter the page is
--      read status by status through idx_auto_campaign_details_automation_status (campaign_id, status, action_code,
--      created_at DESC), so a rare or absent action never walks the whole campaign (measured 14/11/2026 read-only on
--      production: 11.9 s cold through idx_campaign_details_page vs 1.4 s cold through this path).
--   2. aka_agent_read_campaign_result_recipients(…, p_query jsonb), modes:
--      actions: action_code + count (+ one recorded name) of the campaign's results;
--      page:    one page (≤ 100) of recipients with their newest results (≤ 50 each) and the total;
--      keys:    every matching recipient id in page order (≤ 100 000) for the Excel export;
--      byKeys:  ≤ 200 recipient ids → recipients with results, in the given order.
--      Without a result filter the recipients come from auto_campaign_input_data (as the recipients tab) and each
--      recipient's results are probed by idx_campaign_details_input_data_id (LATERAL … OFFSET 0); the campaign's results
--      are never read as a whole. With a result filter (time, status, engagement, search) the matching results are read
--      with the predicates of v2, like the count of the filtered results page.
-- Same identity chain as v2: Desktop ownership guard, then service_role (WebApp backend singleton, credentials NULL)
-- passes auto_assert_automation_identity. Only service_role may EXECUTE. 60 s per call like v2/V487.
-- v3 copies the predicates and the payload of v2 (live definition read 14/11/2026): when v2 changes, change v3 too;
-- scripts/test-campaign-result-actions-sql.sh compares v3 with v2 on the same data.
-- Rollback: rollback_campaign_result_actions.sql (DROP FUNCTION only, nothing to clean up).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'campaign_result_actions_already_exists_do_not_overwrite';
  END IF;
  IF to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)') IS NULL
    OR to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL
    OR to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') IS NULL
    OR to_regclass('public.auto_campaigns') IS NULL
    OR to_regclass('public.auto_campaign_details') IS NULL
    OR to_regclass('public.auto_campaign_input_data') IS NULL
    OR to_regclass('public.auto_campaign_detail_zalo_engagement') IS NULL
    OR to_regclass('public.auto_status') IS NULL THEN
    RAISE EXCEPTION 'campaign_result_actions_dependency_missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_input_data'
      AND column_name IN ('name', 'phone', 'uid', 'email', 'info1', 'info2', 'info3', 'info4', 'info5', 'status', 'note',
        'created_at', 'date_action', 'is_delete', 'campaign_id')) <> 15
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_details'
      AND column_name IN ('input_data_id', 'action_code', 'action_name', 'status', 'status_id', 'sub_status_id', 'report_group',
        'error_code', 'log', 'post_url', 'data', 'created_at', 'is_delete')) <> 13 THEN
    RAISE EXCEPTION 'campaign_result_actions_expected_columns_missing';
  END IF;
  -- The per-status page of v3 is complete only because status is NOT NULL.
  IF NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.auto_campaign_details'::regclass AND attname = 'status') THEN
    RAISE EXCEPTION 'campaign_result_actions_status_nullable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_auto_campaign_details_automation_status')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_details_input_data_id')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_details_page')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_input_data_campaign_id') THEN
    RAISE EXCEPTION 'campaign_result_actions_expected_index_missing';
  END IF;
END
$preflight$;

CREATE FUNCTION public.aka_agent_list_campaign_details_page_v3(
  p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text,
  p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer,
  p_sort text, p_auth_username text, p_auth_password text, p_engagement_filter text DEFAULT NULL::text,
  p_action_code text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '60s'
SET jit = off
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
$function$;

CREATE FUNCTION public.aka_agent_read_campaign_result_recipients(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_campaign_id bigint, p_query jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '60s'
SET jit = off
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
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb) TO service_role;

COMMIT;
