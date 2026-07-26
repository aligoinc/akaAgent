-- migration_v187_campaign_automation_execution_paging.sql
-- Tenant-safe, server-side paging for the Automation history tab inside a
-- campaign detail view. The existing per-automation history RPC remains
-- available for the standalone Automation page.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_source_campaign_history
  ON public.auto_automation_detail (
    staff_id,
    organization_id,
    source_campaign_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_target_campaign_history
  ON public.auto_automation_detail (
    staff_id,
    organization_id,
    target_campaign_id,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_automation_details(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_role text DEFAULT 'all',
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_role text := lower(COALESCE(NULLIF(btrim(p_role), ''), 'all'));
  v_status text := NULLIF(btrim(p_status), '');
  v_search text := NULLIF(btrim(p_search), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'invalid_automation_tenant';
  END IF;

  IF v_role NOT IN ('all', 'source', 'target') THEN
    RAISE EXCEPTION 'invalid_campaign_automation_role';
  END IF;

  IF v_status IS NOT NULL
    AND v_status NOT IN ('chờ xử lý', 'đang xử lý', 'đã thêm', 'bỏ qua', 'lỗi') THEN
    RAISE EXCEPTION 'invalid_automation_detail_status';
  END IF;

  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'invalid_campaign_automation_date_range';
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

  SELECT count(*)
  INTO v_total
  FROM public.auto_automation_detail AS detail
  JOIN public.auto_automation AS automation
    ON automation.id = detail.automation_id
   AND automation.staff_id = p_staff_id
   AND automation.organization_id = p_organization_id
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = detail.source_campaign_id
   AND source_campaign.staff_id = p_staff_id
   AND source_campaign.organization_id = p_organization_id
  JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = detail.target_campaign_id
   AND target_campaign.staff_id = p_staff_id
   AND target_campaign.organization_id = p_organization_id
  LEFT JOIN public.auto_account_contact_groups AS target_group
    ON target_group.id = detail.target_contact_group_id
   AND target_group.staff_id = p_staff_id
   AND target_group.organization_id = p_organization_id
  LEFT JOIN public.auto_account_contact_groups AS target_data_group
    ON target_data_group.id = detail.target_data_group_id
   AND target_data_group.purpose = 'data_group'
   AND target_data_group.staff_id = p_staff_id
   AND target_data_group.organization_id = p_organization_id
  WHERE detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
    AND (
      (v_role = 'all' AND (
        detail.source_campaign_id = p_campaign_id
        OR detail.target_campaign_id = p_campaign_id
      ))
      OR (v_role = 'source' AND detail.source_campaign_id = p_campaign_id)
      OR (v_role = 'target' AND detail.target_campaign_id = p_campaign_id)
    )
    AND (v_status IS NULL OR detail.status = v_status)
    AND (p_date_from IS NULL OR detail.created_at >= p_date_from)
    AND (p_date_to IS NULL OR detail.created_at <= p_date_to)
    AND (
      v_search IS NULL
      OR automation.name ILIKE '%' || v_search || '%'
      OR COALESCE(detail.data_value, '') ILIKE '%' || v_search || '%'
      OR detail.data_type_code ILIKE '%' || v_search || '%'
      OR detail.source_status ILIKE '%' || v_search || '%'
      OR detail.status ILIKE '%' || v_search || '%'
      OR COALESCE(detail.last_error, '') ILIKE '%' || v_search || '%'
      OR source_campaign.name ILIKE '%' || v_search || '%'
      OR target_campaign.name ILIKE '%' || v_search || '%'
      OR COALESCE(target_group.name, '') ILIKE '%' || v_search || '%'
      OR COALESCE(target_data_group.name, '') ILIKE '%' || v_search || '%'
    );

  SELECT COALESCE(
    jsonb_agg(page.payload ORDER BY page.created_at DESC, page.id DESC),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT
      detail.id,
      detail.created_at,
      to_jsonb(detail) || jsonb_build_object(
        'triggered_at', detail.created_at,
        'campaign_role', CASE
          WHEN detail.source_campaign_id = p_campaign_id THEN 'source'
          ELSE 'target'
        END,
        'automation_name', automation.name,
        'source_campaign_name', source_campaign.name,
        'source_campaign_detail_status', source_detail.status,
        'target_campaign_name', target_campaign.name,
        'target_campaign_status', target_campaign.status,
        'target_result_status', target_result.status,
        'target_result_count', COALESCE(target_result.result_count, 0),
        'target_contact_group_name', target_group.name,
        'target_data_group_name', target_data_group.name
      ) AS payload
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    JOIN public.auto_campaigns AS source_campaign
      ON source_campaign.id = detail.source_campaign_id
     AND source_campaign.staff_id = p_staff_id
     AND source_campaign.organization_id = p_organization_id
    JOIN public.auto_campaign_details AS source_detail
      ON source_detail.id = detail.source_campaign_detail_id
     AND source_detail.campaign_id = detail.source_campaign_id
    JOIN public.auto_campaigns AS target_campaign
      ON target_campaign.id = detail.target_campaign_id
     AND target_campaign.staff_id = p_staff_id
     AND target_campaign.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS target_group
      ON target_group.id = detail.target_contact_group_id
     AND target_group.staff_id = p_staff_id
     AND target_group.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS target_data_group
      ON target_data_group.id = detail.target_data_group_id
     AND target_data_group.purpose = 'data_group'
     AND target_data_group.staff_id = p_staff_id
     AND target_data_group.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT
        latest.status,
        count(*) OVER ()::integer AS result_count
      FROM public.auto_campaign_details AS latest
      WHERE latest.auto_automation_detail_id = detail.id
        AND latest.campaign_id = detail.target_campaign_id
        AND COALESCE(latest.is_delete, false) = false
      ORDER BY latest.created_at DESC, latest.id DESC
      LIMIT 1
    ) AS target_result ON true
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND (
        (v_role = 'all' AND (
          detail.source_campaign_id = p_campaign_id
          OR detail.target_campaign_id = p_campaign_id
        ))
        OR (v_role = 'source' AND detail.source_campaign_id = p_campaign_id)
        OR (v_role = 'target' AND detail.target_campaign_id = p_campaign_id)
      )
      AND (v_status IS NULL OR detail.status = v_status)
      AND (p_date_from IS NULL OR detail.created_at >= p_date_from)
      AND (p_date_to IS NULL OR detail.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR automation.name ILIKE '%' || v_search || '%'
        OR COALESCE(detail.data_value, '') ILIKE '%' || v_search || '%'
        OR detail.data_type_code ILIKE '%' || v_search || '%'
        OR detail.source_status ILIKE '%' || v_search || '%'
        OR detail.status ILIKE '%' || v_search || '%'
        OR COALESCE(detail.last_error, '') ILIKE '%' || v_search || '%'
        OR source_campaign.name ILIKE '%' || v_search || '%'
        OR target_campaign.name ILIKE '%' || v_search || '%'
        OR COALESCE(target_group.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_data_group.name, '') ILIKE '%' || v_search || '%'
      )
    ORDER BY detail.created_at DESC, detail.id DESC
    LIMIT v_limit
    OFFSET v_offset
  ) AS page;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

COMMENT ON FUNCTION public.aka_agent_list_campaign_automation_details(
  bigint, bigint, bigint, text, text, text, timestamptz, timestamptz,
  integer, integer, text, text
) IS
  'Tenant-authenticated campaign automation history with role/search/status/date filters and server paging.';

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_automation_details(
  bigint, bigint, bigint, text, text, text, timestamptz, timestamptz,
  integer, integer, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_automation_details(
  bigint, bigint, bigint, text, text, text, timestamptz, timestamptz,
  integer, integer, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
