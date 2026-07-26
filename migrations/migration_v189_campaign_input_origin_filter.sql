-- migration_v189_campaign_input_origin_filter.sql
-- Server-side provenance filtering for the paged Campaign Data tab.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_auto_campaign_input_origins_input_kind
  ON public.auto_campaign_input_origins (input_data_id, origin_kind);

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text,
  p_status text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_origin_filter text,
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  input_data jsonb,
  origins jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_origin_filter text := lower(NULLIF(btrim(COALESCE(p_origin_filter, '')), ''));
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
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
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  RETURN QUERY
  WITH filtered AS MATERIALIZED (
    SELECT input_row.*
    FROM public.auto_campaign_input_data AS input_row
    WHERE input_row.campaign_id = p_campaign_id
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
    ORDER BY filtered.created_at DESC, filtered.id DESC
    OFFSET COALESCE(p_offset, 0)
    LIMIT COALESCE(p_limit, 100)
  )
  SELECT
    to_jsonb(paged) - 'page_total_count' AS input_data,
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
  ORDER BY paged.created_at DESC, paged.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz, text, integer, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text,
  p_status text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_origin_filter text,
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  input_data jsonb,
  origins jsonb,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT *
  FROM public.aka_agent_list_campaign_input_data_page(
    p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
    p_date_from, p_date_to, p_origin_filter, p_offset, p_limit
  );
$$;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz, text,
  integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz, text,
  integer, integer, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
