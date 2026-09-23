-- Read fixed selected IDs before sorting/enrichment. Derived from captured live v313.
-- Existing v2 RPCs are unchanged; no table, column, index, trigger or connection changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $preflight$
DECLARE v_oid regprocedure;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) <> '26f1c96183a8d0e92ac76575e8c1df96' THEN
    RAISE EXCEPTION 'v314_definition_changed: aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text)';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,bigint[])');
  IF v_oid IS NOT NULL AND md5(pg_get_functiondef(v_oid)) <> '3a4b00065a39f4172474d8a25d9dcdfc' THEN
    RAISE EXCEPTION 'v314_definition_changed: aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,bigint[])';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) <> '440e2c6163518d4c0563c275d33e8474' THEN
    RAISE EXCEPTION 'v314_definition_changed: aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text)';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[])');
  IF v_oid IS NOT NULL AND md5(pg_get_functiondef(v_oid)) <> '6faf48dceae54faacb69b6c3aa3b5ca6' THEN
    RAISE EXCEPTION 'v314_definition_changed: aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[])';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_origin_filter text, p_offset integer, p_limit integer, p_sort text, p_input_data_ids bigint[])
 RETURNS TABLE(input_data jsonb, origins jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_sort text := COALESCE(p_sort, 'created_desc');
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_origin_filter text := lower(NULLIF(btrim(COALESCE(p_origin_filter, '')), ''));
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF v_sort NOT IN ('created_desc', 'created_asc', 'processed_desc', 'processed_asc') THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_sort';
  END IF;
  IF p_input_data_ids IS NULL OR cardinality(p_input_data_ids) NOT BETWEEN 1 AND 500
    OR EXISTS (SELECT 1 FROM unnest(p_input_data_ids) AS selected_id WHERE selected_id IS NULL OR selected_id <= 0)
    OR (SELECT count(DISTINCT selected_id) FROM unnest(p_input_data_ids) AS selected_id) <> cardinality(p_input_data_ids)
    OR COALESCE(p_offset, 0) <> 0 OR COALESCE(p_limit, 100) < cardinality(p_input_data_ids)
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_selection';
  END IF;
  v_origin_filter := COALESCE(v_origin_filter, 'all');
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0
    OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_page';
  END IF;
  IF v_origin_filter NOT IN ('all', 'data_group', 'automation', 'manual_or_api', 'direct') THEN
    RAISE EXCEPTION 'invalid_campaign_input_origin_filter';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  RETURN QUERY
  WITH filtered AS MATERIALIZED (
    SELECT input_row.*
    FROM public.auto_campaign_input_data AS input_row
    WHERE input_row.campaign_id = p_campaign_id
      AND input_row.id = ANY(p_input_data_ids)
      AND COALESCE(input_row.is_delete, false) = false
      AND (v_status IS NULL OR input_row.status = v_status)
      AND (p_date_from IS NULL OR input_row.created_at >= p_date_from)
      AND (p_date_to IS NULL OR input_row.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR concat_ws(
          ' ', input_row.id::text, input_row.name, input_row.phone,
          input_row.phone_carrier, input_row.uid, input_row.email,
          input_row.status, input_row.note, input_row.content,
          input_row.info1, input_row.info2, input_row.info3,
          input_row.info4, input_row.info5,
          input_row.canonical_target_key
        ) ILIKE '%' || v_search || '%'
      )
      AND (
        v_origin_filter = 'all'
        OR (
          v_origin_filter = 'data_group'
          AND EXISTS (
            SELECT 1
            FROM public.auto_campaign_input_origins AS origin
            WHERE origin.input_data_id = input_row.id
              AND origin.origin_kind = 'group'
          )
        )
        OR (
          v_origin_filter = 'automation'
          AND (
            input_row.auto_automation_detail_id IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind = 'automation'
            )
            OR EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              JOIN public.auto_account_contact_group_member_origins AS member_origin
                ON member_origin.membership_id = origin.membership_id
               AND member_origin.kind = 'automation'
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind = 'group'
            )
          )
        )
        OR (
          v_origin_filter = 'manual_or_api'
          AND (
            EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind IN ('manual', 'api')
            )
            OR EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              JOIN public.auto_account_contact_group_member_origins AS member_origin
                ON member_origin.membership_id = origin.membership_id
               AND member_origin.kind IN ('manual', 'api')
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind = 'group'
            )
          )
        )
        OR (
          v_origin_filter = 'direct'
          AND input_row.auto_automation_detail_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.auto_campaign_input_origins AS origin
            WHERE origin.input_data_id = input_row.id
          )
        )
      )
  ), paged AS (
    SELECT filtered.*, count(*) OVER ()::bigint AS page_total_count
    FROM filtered
    ORDER BY CASE WHEN v_sort = 'created_asc' THEN filtered.created_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'created_desc' THEN filtered.created_at END DESC NULLS LAST,
      CASE WHEN v_sort = 'processed_asc' THEN COALESCE(filtered.date_action, filtered.created_at) END ASC NULLS LAST,
      CASE WHEN v_sort = 'processed_desc' THEN COALESCE(filtered.date_action, filtered.created_at) END DESC NULLS LAST,
      CASE WHEN v_sort IN ('created_asc', 'processed_asc') THEN filtered.id END ASC,
      CASE WHEN v_sort IN ('created_desc', 'processed_desc') THEN filtered.id END DESC
    OFFSET COALESCE(p_offset, 0)
    LIMIT COALESCE(p_limit, 100)
  )
  SELECT
    public.aka_agent_campaign_input_semantic_json(to_jsonb(paged) - 'page_total_count') AS input_data,
    COALESCE(origin_page.items, '[]'::jsonb) AS origins,
    paged.page_total_count AS total_count
  FROM paged
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'origin_id', campaign_origin.id,
          'origin_kind', campaign_origin.origin_kind,
          'group_id', contact_group.id,
          'group_name', contact_group.name,
          'group_color', contact_group.color,
          'membership_id', campaign_origin.membership_id,
          'membership_is_delete', group_member.is_delete,
          'contact_id', contact.id,
          'contact_name', contact.name,
          'source_id', campaign_source.id,
          'source_status', campaign_source.status,
          'batch_id', ingest_batch.id,
          'batch_kind', ingest_batch.kind,
          'batch_source_name', ingest_batch.source_name,
          'dataset_ids', COALESCE(dataset_page.ids, '[]'::jsonb),
          'dataset_names', COALESCE(dataset_page.names, '[]'::jsonb),
          'automation_detail_id', automation_detail.id,
          'automation_id', automation.id,
          'automation_name', automation.name,
          'automation_source_campaign_id', automation_detail.source_campaign_id,
          'automation_source_campaign_name', automation_source_campaign.name,
          'automation_target_campaign_id', automation_detail.target_campaign_id,
          'automation_target_campaign_name', automation_target_campaign.name,
          'canonical_target_key', campaign_origin.canonical_target_key,
          'created_at', campaign_origin.created_at
        ))
        ORDER BY campaign_origin.created_at, campaign_origin.id
      ),
      '[]'::jsonb
    ) AS items
    FROM public.auto_campaign_input_origins AS campaign_origin
    LEFT JOIN public.auto_campaign_data_group_sources AS campaign_source
      ON campaign_source.id = campaign_origin.source_id
     AND campaign_source.campaign_id = p_campaign_id
     AND campaign_source.staff_id = p_staff_id
     AND campaign_source.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = COALESCE(campaign_origin.group_id, campaign_source.group_id)
     AND contact_group.staff_id = p_staff_id
     AND contact_group.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_group_members AS group_member
      ON group_member.id = campaign_origin.membership_id
     AND group_member.group_id = contact_group.id
    LEFT JOIN public.auto_account_contacts AS contact
      ON contact.id = group_member.contact_id
     AND contact.staff_id = p_staff_id
     AND contact.organization_id = p_organization_id
    LEFT JOIN public.auto_data_ingest_batches AS ingest_batch
      ON ingest_batch.id = campaign_origin.batch_id
     AND ingest_batch.staff_id = p_staff_id
     AND ingest_batch.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT member_origin.automation_detail_id
      FROM public.auto_account_contact_group_member_origins AS member_origin
      WHERE member_origin.membership_id = campaign_origin.membership_id
        AND member_origin.automation_detail_id IS NOT NULL
      ORDER BY member_origin.is_current DESC, member_origin.created_at DESC, member_origin.id DESC
      LIMIT 1
    ) AS preferred_automation_origin ON true
    LEFT JOIN public.auto_automation_detail AS automation_detail
      ON automation_detail.id = COALESCE(
        campaign_origin.automation_detail_id,
        preferred_automation_origin.automation_detail_id
      )
     AND automation_detail.staff_id = p_staff_id
     AND automation_detail.organization_id = p_organization_id
    LEFT JOIN public.auto_automation AS automation
      ON automation.id = automation_detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_source_campaign
      ON automation_source_campaign.id = automation_detail.source_campaign_id
     AND automation_source_campaign.staff_id = p_staff_id
     AND automation_source_campaign.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_target_campaign
      ON automation_target_campaign.id = automation_detail.target_campaign_id
     AND automation_target_campaign.staff_id = p_staff_id
     AND automation_target_campaign.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(jsonb_agg(dataset_row.id ORDER BY dataset_row.id), '[]'::jsonb) AS ids,
        COALESCE(jsonb_agg(dataset_row.name ORDER BY dataset_row.id), '[]'::jsonb) AS names
      FROM (
        SELECT dataset.id, dataset.name
        FROM public.auto_account_contacts_dataset AS dataset
        WHERE dataset.id = ingest_batch.dataset_id
          AND dataset.staff_id = p_staff_id
          AND dataset.organization_id = p_organization_id
        UNION
        SELECT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS member_origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = member_origin.dataset_id
         AND dataset.staff_id = p_staff_id
         AND dataset.organization_id = p_organization_id
        WHERE member_origin.membership_id = campaign_origin.membership_id
      ) AS dataset_row
    ) AS dataset_page ON true
    WHERE campaign_origin.input_data_id = paged.id
  ) AS origin_page ON true
  ORDER BY CASE WHEN v_sort = 'created_asc' THEN paged.created_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'created_desc' THEN paged.created_at END DESC NULLS LAST,
      CASE WHEN v_sort = 'processed_asc' THEN COALESCE(paged.date_action, paged.created_at) END ASC NULLS LAST,
      CASE WHEN v_sort = 'processed_desc' THEN COALESCE(paged.date_action, paged.created_at) END DESC NULLS LAST,
      CASE WHEN v_sort IN ('created_asc', 'processed_asc') THEN paged.id END ASC,
      CASE WHEN v_sort IN ('created_desc', 'processed_desc') THEN paged.id END DESC;
END;
$function$
;
ALTER FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,bigint[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,bigint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,bigint[]) TO service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_origin_filter text, p_offset integer, p_limit integer, p_auth_username text, p_auth_password text, p_sort text, p_input_data_ids bigint[])
 RETURNS TABLE(input_data jsonb, origins jsonb, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_origin_filter, p_offset, p_limit, p_sort, p_input_data_ids
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$
;
ALTER FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[]) TO anon, authenticated, service_role;

-- New RPC signatures require PostgREST metadata refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;
