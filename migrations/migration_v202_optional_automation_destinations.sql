-- Optional Automation destinations.
--
-- A campaign-detail Automation may route to a campaign, a staff-shared Data
-- Group, or both. Existing A -> B behavior remains unchanged; group-only
-- executions never create a campaign input.

BEGIN;

UPDATE public.auto_automation_actions
SET description = 'Chuyển dữ liệu từ chiến dịch nguồn đến chiến dịch đích, Nhóm data, hoặc cả hai.',
    updated_at = now()
WHERE id = 'campaign_detail_route';

-- ---------------------------------------------------------------------------
-- 1. Destination-nullable rule and immutable execution snapshots
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_automation
  ALTER COLUMN target_campaign_id DROP NOT NULL;

ALTER TABLE public.auto_automation_detail
  ALTER COLUMN target_campaign_id DROP NOT NULL,
  ALTER COLUMN target_account_id DROP NOT NULL,
  ALTER COLUMN target_action_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auto_automation_target_data_group
  ON public.auto_automation (target_data_group_id, id);
CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_target_data_group
  ON public.auto_automation_detail (target_data_group_id, id);

ALTER TABLE public.auto_automation
  DROP CONSTRAINT IF EXISTS auto_automation_distinct_campaigns_check,
  DROP CONSTRAINT IF EXISTS auto_automation_destination_check,
  DROP CONSTRAINT IF EXISTS auto_automation_legacy_group_requires_campaign_check;

ALTER TABLE public.auto_automation
  ADD CONSTRAINT auto_automation_distinct_campaigns_check
    CHECK (
      target_campaign_id IS NULL
      OR source_campaign_id <> target_campaign_id
    ),
  ADD CONSTRAINT auto_automation_destination_check
    CHECK (
      target_campaign_id IS NOT NULL
      OR target_data_group_id IS NOT NULL
      OR is_active = false
      OR is_delete = true
    ),
  ADD CONSTRAINT auto_automation_legacy_group_requires_campaign_check
    CHECK (
      target_campaign_id IS NOT NULL
      OR target_contact_group_id IS NULL
    );

ALTER TABLE public.auto_automation_detail
  DROP CONSTRAINT IF EXISTS auto_automation_detail_destination_check,
  DROP CONSTRAINT IF EXISTS auto_automation_detail_campaign_snapshot_check;

ALTER TABLE public.auto_automation_detail
  ADD CONSTRAINT auto_automation_detail_campaign_snapshot_check
    CHECK (
      (
        target_campaign_id IS NULL
        AND target_account_id IS NULL
        AND target_action_id IS NULL
        AND target_contact_group_id IS NULL
      )
      OR (
        target_campaign_id IS NOT NULL
        AND target_account_id IS NOT NULL
        AND target_action_id IS NOT NULL
      )
    );

COMMENT ON COLUMN public.auto_automation.target_campaign_id IS
  'Optional campaign destination. At least this or target_data_group_id is required for a usable rule.';
COMMENT ON COLUMN public.auto_automation_detail.target_campaign_id IS
  'Frozen optional campaign destination; NULL means this execution routes only to its Data Group.';
COMMENT ON COLUMN public.auto_automation_detail.target_data_group_id IS
  'Frozen optional Data Group destination. It may become NULL later through the existing ON DELETE SET NULL history policy.';

-- Detaching a deleted Data Group must not leave a sole-destination rule active.
CREATE OR REPLACE FUNCTION public.aka_agent_guard_automation_destination_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.target_campaign_id IS NULL
    AND NEW.target_data_group_id IS NULL
    AND COALESCE(NEW.is_delete, false) = false
  THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;

-- A soft-deleted Data Group cannot remain the sole live destination. Dual
-- routes keep their campaign leg active; restoring a group never auto-enables
-- a rule that the user may have paused explicitly.
CREATE OR REPLACE FUNCTION public.aka_agent_deactivate_group_only_automations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
BEGIN
  IF TG_OP = 'DELETE'
    OR (
      COALESCE(OLD.is_delete, false) = false
      AND COALESCE(NEW.is_delete, false) = true
    )
  THEN
    UPDATE public.auto_automation AS automation
    SET is_active = false,
        updated_at = clock_timestamp()
    WHERE automation.target_data_group_id = v_group_id
      AND automation.target_campaign_id IS NULL
      AND automation.is_delete = false;

    -- Dual routes keep their campaign execution, but their deleted group leg
    -- must become terminal before ON DELETE SET NULL removes the snapshot FK.
    UPDATE public.auto_automation_detail AS detail
    SET target_data_group_sync_status = 'skipped',
        target_data_group_sync_error = 'data_group_deleted',
        updated_at = clock_timestamp()
    WHERE detail.target_data_group_id = v_group_id
      AND COALESCE(
        detail.target_data_group_sync_status,
        'pending'
      ) IN ('pending', 'failed');

    UPDATE public.auto_automation_detail AS detail
    SET status = 'bỏ qua',
        last_error = 'data_group_deleted',
        locked_at = NULL,
        locked_by = NULL,
        processed_at = COALESCE(detail.processed_at, clock_timestamp()),
        target_data_group_sync_status = 'skipped',
        target_data_group_sync_error = 'data_group_deleted',
        updated_at = clock_timestamp()
    WHERE detail.target_campaign_id IS NULL
      AND detail.target_data_group_id = v_group_id
      AND detail.status IN ('chờ xử lý', 'đang xử lý');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_deactivate_group_only_automations
  ON public.auto_account_contact_groups;
CREATE TRIGGER trg_aka_agent_deactivate_group_only_automations
BEFORE UPDATE OF is_delete OR DELETE
ON public.auto_account_contact_groups
FOR EACH ROW
WHEN (OLD.purpose = 'data_group')
EXECUTE FUNCTION public.aka_agent_deactivate_group_only_automations();

-- ---------------------------------------------------------------------------
-- 2. History projections retain group-only executions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_list_automation_details(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint DEFAULT NULL,
  p_status text DEFAULT NULL,
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
  v_total integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_status IS NOT NULL
    AND p_status NOT IN (
      'chờ xử lý', 'đang xử lý', 'đã thêm', 'bỏ qua', 'lỗi'
    )
  THEN
    RAISE EXCEPTION 'invalid_automation_detail_status';
  END IF;
  IF p_automation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.auto_automation AS automation
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  SELECT count(*)::integer
  INTO v_total
  FROM public.auto_automation_detail AS detail
  WHERE detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
    AND (p_automation_id IS NULL OR detail.automation_id = p_automation_id)
    AND (p_status IS NULL OR detail.status = p_status);

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
        'automation_name', automation.name,
        'source_campaign_name', source_campaign.name,
        'source_campaign_detail_status', source_detail.status,
        'target_campaign_name', target_campaign.name,
        'target_campaign_status', target_campaign.status,
        'target_result_status', target_result.status,
        'target_result_count', COALESCE(target_result.result_count, 0),
        'target_contact_group_name', target_group.name,
        'target_data_group_id', COALESCE(
          detail.target_data_group_id,
          CASE
            WHEN detail.config_snapshot ->> 'target_data_group_id'
              ~ '^[1-9][0-9]*$'
            THEN (detail.config_snapshot ->> 'target_data_group_id')::bigint
          END
        ),
        'target_data_group_name', target_data_group.name
      ) AS payload
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
    JOIN public.auto_campaigns AS source_campaign
      ON source_campaign.id = detail.source_campaign_id
    JOIN public.auto_campaign_details AS source_detail
      ON source_detail.id = detail.source_campaign_detail_id
    LEFT JOIN public.auto_campaigns AS target_campaign
      ON target_campaign.id = detail.target_campaign_id
    LEFT JOIN public.auto_account_contact_groups AS target_group
      ON target_group.id = detail.target_contact_group_id
    LEFT JOIN public.auto_account_contact_groups AS target_data_group
      ON target_data_group.id = detail.target_data_group_id
     AND target_data_group.purpose = 'data_group'
    LEFT JOIN LATERAL (
      SELECT latest.status, count(*) OVER ()::integer AS result_count
      FROM public.auto_campaign_details AS latest
      WHERE latest.auto_automation_detail_id = detail.id
        AND COALESCE(latest.is_delete, false) = false
      ORDER BY latest.created_at DESC, latest.id DESC
      LIMIT 1
    ) AS target_result ON true
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND (p_automation_id IS NULL OR detail.automation_id = p_automation_id)
      AND (p_status IS NULL OR detail.status = p_status)
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
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_staff_id IS NULL
    OR p_organization_id IS NULL
    OR p_campaign_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_automation_tenant';
  END IF;
  IF v_role NOT IN ('all', 'source', 'target') THEN
    RAISE EXCEPTION 'invalid_campaign_automation_role';
  END IF;
  IF v_status IS NOT NULL
    AND v_status NOT IN (
      'chờ xử lý', 'đang xử lý', 'đã thêm', 'bỏ qua', 'lỗi'
    )
  THEN
    RAISE EXCEPTION 'invalid_automation_detail_status';
  END IF;
  IF p_date_from IS NOT NULL
    AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to
  THEN
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

  WITH filtered AS MATERIALIZED (
    SELECT
      detail.*,
      automation.name AS automation_name,
      source_campaign.name AS source_campaign_name,
      source_detail.status AS source_campaign_detail_status,
      target_campaign.name AS target_campaign_name,
      target_campaign.status AS target_campaign_status,
      target_group.name AS target_contact_group_name,
      target_data_group.name AS target_data_group_name
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
    LEFT JOIN public.auto_campaigns AS target_campaign
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
        (
          v_role = 'all'
          AND (
            detail.source_campaign_id = p_campaign_id
            OR detail.target_campaign_id = p_campaign_id
          )
        )
        OR (
          v_role = 'source'
          AND detail.source_campaign_id = p_campaign_id
        )
        OR (
          v_role = 'target'
          AND detail.target_campaign_id = p_campaign_id
        )
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
        OR COALESCE(target_campaign.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_group.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_data_group.name, '') ILIKE '%' || v_search || '%'
      )
  )
  SELECT count(*)
  INTO v_total
  FROM filtered;

  WITH filtered AS MATERIALIZED (
    SELECT
      detail.*,
      automation.name AS automation_name,
      source_campaign.name AS source_campaign_name,
      source_detail.status AS source_campaign_detail_status,
      target_campaign.name AS target_campaign_name,
      target_campaign.status AS target_campaign_status,
      target_group.name AS target_contact_group_name,
      target_data_group.name AS target_data_group_name
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
    LEFT JOIN public.auto_campaigns AS target_campaign
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
        (
          v_role = 'all'
          AND (
            detail.source_campaign_id = p_campaign_id
            OR detail.target_campaign_id = p_campaign_id
          )
        )
        OR (
          v_role = 'source'
          AND detail.source_campaign_id = p_campaign_id
        )
        OR (
          v_role = 'target'
          AND detail.target_campaign_id = p_campaign_id
        )
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
        OR COALESCE(target_campaign.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_group.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_data_group.name, '') ILIKE '%' || v_search || '%'
      )
  ),
  page AS (
    SELECT filtered.*
    FROM filtered
    ORDER BY filtered.created_at DESC, filtered.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(page)
      || jsonb_build_object(
        'triggered_at', page.created_at,
        'campaign_role', CASE
          WHEN page.source_campaign_id = p_campaign_id THEN 'source'
          ELSE 'target'
        END,
        'automation_name', page.automation_name,
        'source_campaign_name', page.source_campaign_name,
        'source_campaign_detail_status',
          page.source_campaign_detail_status,
        'target_campaign_name', page.target_campaign_name,
        'target_campaign_status', page.target_campaign_status,
        'target_result_status', target_result.status,
        'target_result_count', COALESCE(target_result.result_count, 0),
        'target_contact_group_name', page.target_contact_group_name,
        'target_data_group_id', COALESCE(
          page.target_data_group_id,
          CASE
            WHEN page.config_snapshot ->> 'target_data_group_id'
              ~ '^[1-9][0-9]*$'
            THEN (page.config_snapshot ->> 'target_data_group_id')::bigint
          END
        ),
        'target_data_group_name', page.target_data_group_name
      )
      ORDER BY page.created_at DESC, page.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM page
  LEFT JOIN LATERAL (
    SELECT latest.status, count(*) OVER ()::integer AS result_count
    FROM public.auto_campaign_details AS latest
    WHERE latest.auto_automation_detail_id = page.id
      AND page.target_campaign_id IS NOT NULL
      AND latest.campaign_id = page.target_campaign_id
      AND COALESCE(latest.is_delete, false) = false
    ORDER BY latest.created_at DESC, latest.id DESC
    LIMIT 1
  ) AS target_result ON true;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. Claim rows without allocating a campaign counter for group-only routes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_auto_automation_details(
  p_staff_id bigint,
  p_organization_id bigint,
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS TABLE (
  automation_detail_id bigint,
  automation_id bigint,
  parent_automation_detail_id bigint,
  source_campaign_detail_id bigint,
  source_campaign_input_data_id bigint,
  source_campaign_id bigint,
  source_account_id bigint,
  source_action_id text,
  source_action_code text,
  source_status text,
  target_campaign_id bigint,
  target_account_id bigint,
  target_action_id text,
  data_type_code text,
  data_value text,
  source_input_snapshot jsonb,
  config_snapshot jsonb,
  target_contact_group_id bigint,
  target_data_group_id bigint,
  scheduled_at timestamptz,
  target_row_index bigint,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_execution record;
  v_row_index bigint;
  v_existing_input_count bigint;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR length(btrim(p_worker_id)) > 200
  THEN
    RAISE EXCEPTION 'invalid_automation_worker_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_automation_staff';
  END IF;

  FOR v_execution IN
    SELECT detail.id, detail.target_campaign_id, detail.target_row_index
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND detail.status = 'chờ xử lý'
      AND detail.next_attempt_at <= clock_timestamp()
      AND (
        detail.target_campaign_id IS NOT NULL
        OR detail.scheduled_at <= clock_timestamp()
      )
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_active = true
      AND automation.is_delete = false
    ORDER BY
      detail.next_attempt_at,
      detail.scheduled_at,
      detail.created_at,
      detail.id
    FOR UPDATE OF detail SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_row_index := v_execution.target_row_index;

    IF v_execution.target_campaign_id IS NOT NULL
      AND v_row_index IS NULL
    THEN
      SELECT count(*)::bigint
      INTO v_existing_input_count
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_execution.target_campaign_id
        AND COALESCE(input_data.is_delete, false) = false;

      INSERT INTO public.auto_automation_target_counters AS counter (
        target_campaign_id, next_row_index, staff_id, organization_id,
        updated_at
      ) VALUES (
        v_execution.target_campaign_id, v_existing_input_count + 1,
        p_staff_id, p_organization_id, clock_timestamp()
      )
      ON CONFLICT ON CONSTRAINT auto_automation_target_counters_pkey
      DO UPDATE SET
        next_row_index = GREATEST(
          counter.next_row_index + 1,
          EXCLUDED.next_row_index
        ),
        updated_at = clock_timestamp()
      RETURNING counter.next_row_index - 1
      INTO v_row_index;
    END IF;

    UPDATE public.auto_automation_detail AS detail
    SET status = 'đang xử lý',
        target_row_index = v_row_index,
        attempt_count = detail.attempt_count + 1,
        locked_at = clock_timestamp(),
        locked_by = btrim(p_worker_id),
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;

    RETURN QUERY
    SELECT
      claimed.id,
      claimed.automation_id,
      claimed.parent_automation_detail_id,
      claimed.source_campaign_detail_id,
      claimed.source_campaign_input_data_id,
      claimed.source_campaign_id,
      claimed.source_account_id,
      claimed.source_action_id,
      claimed.source_action_code,
      claimed.source_status,
      claimed.target_campaign_id,
      claimed.target_account_id,
      claimed.target_action_id,
      claimed.data_type_code,
      claimed.data_value,
      claimed.source_input_snapshot,
      claimed.config_snapshot,
      claimed.target_contact_group_id,
      claimed.target_data_group_id,
      claimed.scheduled_at,
      claimed.target_row_index,
      claimed.attempt_count
    FROM public.auto_automation_detail AS claimed
    WHERE claimed.id = v_execution.id;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Materialize a group-only claim atomically with its Data Group membership
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) RENAME TO materialize_auto_automation_detail_v201_campaign_internal;

REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail_v201_campaign_internal(
  bigint, bigint, bigint, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.materialize_auto_automation_detail(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_detail_id bigint,
  p_worker_id text,
  p_target_input jsonb,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_automation_id bigint;
  v_target_campaign_id bigint;
  v_target_data_group_id bigint;
  v_execution public.auto_automation_detail%ROWTYPE;
  v_group_result jsonb;
  v_group_code text;
  v_group_error text;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF jsonb_typeof(COALESCE(p_target_input, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_automation_target_input';
  END IF;

  SELECT
    detail.automation_id,
    detail.target_campaign_id,
    detail.target_data_group_id
  INTO
    v_automation_id,
    v_target_campaign_id,
    v_target_data_group_id
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'result', 'not_claimed',
      'automation_detail_id', p_automation_detail_id
    );
  END IF;

  IF v_target_campaign_id IS NOT NULL THEN
    RETURN public.materialize_auto_automation_detail_v201_campaign_internal(
      p_staff_id, p_organization_id, p_automation_detail_id, p_worker_id,
      p_target_input, p_auth_username, p_auth_password
    );
  END IF;

  -- Sole-group routes share the same group -> automation -> detail lock order
  -- as Data Group deletion/activation, preventing a delete/materialize
  -- deadlock while preserving atomic membership creation.
  IF v_target_data_group_id IS NOT NULL THEN
    PERFORM contact_group.id
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = v_target_data_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
    FOR UPDATE OF contact_group;
  END IF;

  PERFORM automation.id
  FROM public.auto_automation AS automation
  WHERE automation.id = v_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
  FOR UPDATE;

  SELECT detail.*
  INTO v_execution
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.automation_id = v_automation_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
  FOR UPDATE;

  IF v_execution.target_campaign_id IS NOT NULL THEN
    RETURN public.materialize_auto_automation_detail_v201_campaign_internal(
      p_staff_id, p_organization_id, p_automation_detail_id, p_worker_id,
      p_target_input, p_auth_username, p_auth_password
    );
  END IF;

  IF v_execution.status = 'đã thêm'
    AND v_execution.target_data_group_sync_status = 'completed'
  THEN
    RETURN jsonb_build_object(
      'result', 'already_materialized',
      'automation_detail_id', v_execution.id,
      'target_data_group_member_id', v_execution.target_data_group_member_id,
      'target_row_index', NULL
    );
  END IF;
  IF v_execution.status <> 'đang xử lý'
    OR v_execution.locked_by IS DISTINCT FROM btrim(p_worker_id)
  THEN
    RETURN jsonb_build_object(
      'result', 'not_claimed',
      'automation_detail_id', v_execution.id
    );
  END IF;
  IF v_execution.target_data_group_id IS NULL THEN
    UPDATE public.auto_automation_detail AS detail
    SET status = 'bỏ qua',
        last_error = 'automation_destination_required',
        locked_at = NULL,
        locked_by = NULL,
        processed_at = COALESCE(detail.processed_at, clock_timestamp()),
        target_data_group_sync_status = 'skipped',
        target_data_group_sync_error = 'automation_destination_required',
        updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;
    RETURN jsonb_build_object(
      'result', 'skipped',
      'automation_detail_id', v_execution.id,
      'error', 'automation_destination_required'
    );
  END IF;

  -- The ingest RPC intentionally accepts only a materialized snapshot. Keep
  -- the worker lock while it creates/resolves the idempotent membership.
  UPDATE public.auto_automation_detail AS detail
  SET status = 'đã thêm',
      target_input_snapshot = p_target_input,
      target_input_data_id = NULL,
      target_contact_id = NULL,
      target_contact_group_member_id = NULL,
      target_row_index = NULL,
      processed_at = clock_timestamp(),
      target_data_group_sync_status = 'pending',
      target_data_group_sync_error = NULL,
      updated_at = clock_timestamp()
  WHERE detail.id = v_execution.id
    AND detail.status = 'đang xử lý'
    AND detail.locked_by IS NOT DISTINCT FROM btrim(p_worker_id);

  v_group_result := public.aka_agent_ingest_automation_data_group_result(
    p_staff_id, p_organization_id, v_execution.id
  );
  v_group_code := COALESCE(v_group_result ->> 'code', 'failed');

  IF v_group_code = 'completed' THEN
    UPDATE public.auto_automation_detail AS detail
    SET locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        processed_at = COALESCE(detail.processed_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;

    UPDATE public.auto_automation AS automation
    SET last_data_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE automation.id = v_execution.automation_id;

    RETURN jsonb_build_object(
      'result', 'materialized',
      'automation_detail_id', v_execution.id,
      'target_input_data_id', NULL,
      'target_data_group_member_id',
        NULLIF(v_group_result ->> 'target_data_group_member_id', '')::bigint,
      'target_row_index', NULL
    );
  END IF;

  v_group_error := COALESCE(
    NULLIF(v_group_result ->> 'error', ''),
    NULLIF(v_group_result ->> 'reason', ''),
    'data_group_ingest_failed'
  );
  IF v_group_code = 'skipped' THEN
    UPDATE public.auto_automation_detail AS detail
    SET status = 'bỏ qua',
        last_error = v_group_error,
        locked_at = NULL,
        locked_by = NULL,
        processed_at = COALESCE(detail.processed_at, clock_timestamp()),
        target_data_group_sync_status = 'skipped',
        target_data_group_sync_error = v_group_error,
        updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;
    RETURN jsonb_build_object(
      'result', 'skipped',
      'automation_detail_id', v_execution.id,
      'error', v_group_error
    );
  END IF;

  -- Restore the claimed state so the processor's established retry RPC owns
  -- backoff/terminal-attempt policy.
  UPDATE public.auto_automation_detail AS detail
  SET status = 'đang xử lý',
      last_error = v_group_error,
      updated_at = clock_timestamp()
  WHERE detail.id = v_execution.id
    AND detail.locked_by IS NOT DISTINCT FROM btrim(p_worker_id);

  RETURN jsonb_build_object(
    'result', 'failed',
    'automation_detail_id', v_execution.id,
    'error', v_group_error
  );
END;
$$;


DROP TRIGGER IF EXISTS trg_aka_agent_guard_automation_destination_update
  ON public.auto_automation;
CREATE TRIGGER trg_aka_agent_guard_automation_destination_update
BEFORE INSERT OR UPDATE OF
  target_campaign_id, target_data_group_id, is_active, is_delete
ON public.auto_automation
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_automation_destination_update();

-- Keep group-only terminal executions out of the optional-sync retry set.
CREATE OR REPLACE FUNCTION public.aka_agent_set_group_only_sync_terminal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.target_campaign_id IS NULL
    AND NEW.target_data_group_id IS NOT NULL
    AND NEW.status IN ('bỏ qua', 'lỗi')
  THEN
    NEW.target_data_group_sync_status := 'skipped';
    NEW.target_data_group_sync_error := COALESCE(
      NEW.target_data_group_sync_error,
      NEW.last_error,
      CASE WHEN NEW.status = 'lỗi' THEN 'automation_failed' ELSE 'automation_skipped' END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_aka_agent_set_group_only_sync_terminal
  ON public.auto_automation_detail;
CREATE TRIGGER trg_zz_aka_agent_set_group_only_sync_terminal
BEFORE INSERT OR UPDATE OF
  status, target_campaign_id, target_data_group_id, last_error
ON public.auto_automation_detail
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_set_group_only_sync_terminal();

-- ---------------------------------------------------------------------------
-- 5. Save and activation RPCs
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) RENAME TO aka_agent_save_automation_v201_campaign_internal;

REVOKE ALL ON FUNCTION public.aka_agent_save_automation_v201_campaign_internal(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.aka_agent_save_automation(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_name text,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_target_data_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_note text,
  p_is_active boolean,
  p_trigger_statuses jsonb,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL,
  p_delay_value integer DEFAULT NULL,
  p_delay_unit text DEFAULT NULL,
  p_daily_time time without time zone DEFAULT NULL,
  p_delay_exact_time time without time zone DEFAULT NULL,
  p_delay_exact_time_present boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.auto_automation%ROWTYPE;
  v_rule_id bigint;
  v_source_action_id text;
  v_schedule_mode text := lower(NULLIF(btrim(COALESCE(p_schedule_mode, '')), ''));
  v_delay_value integer := p_delay_value;
  v_delay_unit text := lower(NULLIF(btrim(COALESCE(p_delay_unit, '')), ''));
  v_effective_delay_exact_time time without time zone;
  v_status jsonb;
  v_status_mapping_id bigint;
  v_status_mapping_id_text text;
  v_action_code text;
  v_status_value text;
  v_semantic_status_id bigint;
  v_mapping record;
BEGIN
  -- Authentication must precede every tenant-scoped existence check.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF p_target_campaign_id IS NULL AND p_target_data_group_id IS NULL THEN
    RAISE EXCEPTION 'automation_destination_required';
  END IF;

  IF p_target_campaign_id IS NOT NULL THEN
    -- The established campaign validator/save stack remains authoritative for
    -- campaign-only and dual-destination rules.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
      0
    ));
    IF p_target_data_group_id IS NOT NULL THEN
      PERFORM contact_group.id
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.id = p_target_data_group_id
        AND contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
      FOR SHARE OF contact_group;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_target_data_group';
      END IF;
    END IF;
    RETURN public.aka_agent_save_automation_v201_campaign_internal(
      p_staff_id, p_organization_id, p_automation_id, p_name,
      p_source_campaign_id, p_target_campaign_id, p_data_type_code,
      p_target_contact_group_id, p_target_data_group_id, p_schedule_mode,
      p_delay_days, p_delay_hours, p_fixed_at, p_note, p_is_active,
      p_trigger_statuses, p_auth_username, p_auth_password, p_delay_value,
      p_delay_unit, p_daily_time, p_delay_exact_time,
      p_delay_exact_time_present
    );
  END IF;

  IF p_target_contact_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'target_contact_group_requires_campaign';
  END IF;
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL
    OR length(btrim(p_name)) > 200
  THEN
    RAISE EXCEPTION 'invalid_automation_name';
  END IF;
  IF length(COALESCE(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'invalid_automation_note';
  END IF;
  IF jsonb_typeof(COALESCE(p_trigger_statuses, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_trigger_statuses) = 0
    OR jsonb_array_length(p_trigger_statuses) > 100
  THEN
    RAISE EXCEPTION 'invalid_automation_trigger_statuses';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_automation_staff';
  END IF;

  SELECT campaign.action_id
  INTO v_source_action_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_campaign_actions AS campaign_action
    ON campaign_action.id = campaign.action_id
   AND campaign_action.is_active = true
   AND COALESCE(campaign_action.is_delete, false) = false
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = p_organization_id
   AND COALESCE(account.is_delete, false) = false
  WHERE campaign.id = p_source_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false;
  IF v_source_action_id IS NULL THEN
    RAISE EXCEPTION 'invalid_source_campaign';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_automation_data_types AS data_type
    JOIN public.auto_campaign_action_data_types AS mapping
      ON mapping.data_type_code = data_type.code
     AND mapping.campaign_action_id = v_source_action_id
     AND mapping.can_source = true
     AND mapping.is_active = true
     AND mapping.is_delete = false
    WHERE data_type.code = p_data_type_code
      AND data_type.is_active = true
      AND data_type.is_delete = false
  ) THEN
    RAISE EXCEPTION 'source_campaign_data_type_not_supported';
  END IF;

  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_target_data_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR SHARE OF contact_group;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_target_data_group';
  END IF;

  IF v_schedule_mode NOT IN ('immediate', 'after_delay', 'daily_time', 'fixed_at')
    OR COALESCE(p_delay_days, 0) NOT BETWEEN 0 AND 3650
    OR COALESCE(p_delay_hours, 0) NOT BETWEEN 0 AND 23
  THEN
    RAISE EXCEPTION 'invalid_automation_schedule';
  END IF;

  -- Preserve the v176 compatibility contract for clients that still send only
  -- delay_days/delay_hours.
  IF v_schedule_mode = 'after_delay'
    AND v_delay_value IS NULL
    AND v_delay_unit IS NULL
    AND (
      COALESCE(p_delay_days, 0) > 0
      OR COALESCE(p_delay_hours, 0) > 0
    )
  THEN
    IF COALESCE(p_delay_hours, 0) = 0 THEN
      v_delay_value := COALESCE(p_delay_days, 0);
      v_delay_unit := 'day';
    ELSE
      v_delay_value := LEAST(
        (
          COALESCE(p_delay_days, 0) * 24
        ) + COALESCE(p_delay_hours, 0),
        87600
      );
      v_delay_unit := 'hour';
    END IF;
  END IF;

  IF v_schedule_mode = 'after_delay' THEN
    IF COALESCE(p_delay_exact_time_present, false) THEN
      v_effective_delay_exact_time := p_delay_exact_time;
    ELSIF p_automation_id IS NOT NULL THEN
      SELECT automation.delay_exact_time
      INTO v_effective_delay_exact_time
      FROM public.auto_automation AS automation
      WHERE automation.id = p_automation_id
        AND automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
        AND automation.is_delete = false;
    END IF;
  END IF;

  IF v_schedule_mode = 'immediate' AND (
    COALESCE(p_delay_days, 0) <> 0
    OR COALESCE(p_delay_hours, 0) <> 0
    OR v_delay_value IS NOT NULL OR v_delay_unit IS NOT NULL
    OR p_daily_time IS NOT NULL OR p_fixed_at IS NOT NULL
    OR v_effective_delay_exact_time IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid_immediate_schedule';
  ELSIF v_schedule_mode = 'after_delay' AND (
    v_delay_value IS NULL
    OR v_delay_unit NOT IN ('minute', 'hour', 'day')
    OR v_delay_value <= 0
    OR (v_delay_unit = 'minute' AND v_delay_value > 5256000)
    OR (v_delay_unit = 'hour' AND v_delay_value > 87600)
    OR (v_delay_unit = 'day' AND v_delay_value > 3650)
    OR p_daily_time IS NOT NULL OR p_fixed_at IS NOT NULL
    OR (
      v_effective_delay_exact_time IS NOT NULL
      AND (
        v_effective_delay_exact_time >= time '24:00'
        OR EXTRACT(SECOND FROM v_effective_delay_exact_time) <> 0
      )
    )
  ) THEN
    RAISE EXCEPTION 'invalid_delay_schedule';
  ELSIF v_schedule_mode = 'daily_time' AND (
    COALESCE(p_delay_days, 0) <> 0
    OR COALESCE(p_delay_hours, 0) <> 0
    OR v_delay_value IS NOT NULL OR v_delay_unit IS NOT NULL
    OR p_daily_time IS NULL
    OR EXTRACT(SECOND FROM p_daily_time) <> 0
    OR p_fixed_at IS NOT NULL
    OR v_effective_delay_exact_time IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid_daily_time_schedule';
  ELSIF v_schedule_mode = 'fixed_at' AND (
    p_fixed_at IS NULL
    OR COALESCE(p_delay_days, 0) <> 0
    OR COALESCE(p_delay_hours, 0) <> 0
    OR v_delay_value IS NOT NULL OR v_delay_unit IS NOT NULL
    OR p_daily_time IS NOT NULL
    OR v_effective_delay_exact_time IS NOT NULL
    OR (COALESCE(p_is_active, false) AND p_fixed_at <= clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'invalid_fixed_schedule';
  END IF;

  IF p_automation_id IS NULL THEN
    INSERT INTO public.auto_automation (
      automation_action_id, name, source_campaign_id, target_campaign_id,
      data_type_code, target_contact_group_id, target_data_group_id,
      schedule_mode, delay_days, delay_hours, delay_value, delay_unit,
      delay_exact_time, daily_time, fixed_at, note, is_active, activated_at,
      config_version, is_delete, staff_id, organization_id
    ) VALUES (
      'campaign_detail_route', btrim(p_name), p_source_campaign_id, NULL,
      p_data_type_code, NULL, p_target_data_group_id,
      v_schedule_mode, COALESCE(p_delay_days, 0), COALESCE(p_delay_hours, 0),
      v_delay_value, v_delay_unit, v_effective_delay_exact_time, p_daily_time,
      p_fixed_at, NULLIF(btrim(COALESCE(p_note, '')), ''),
      COALESCE(p_is_active, false),
      CASE WHEN COALESCE(p_is_active, false) THEN clock_timestamp() ELSE NULL END,
      1, false, p_staff_id, p_organization_id
    )
    RETURNING id INTO v_rule_id;
  ELSE
    SELECT *
    INTO v_existing
    FROM public.auto_automation AS automation
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'automation_not_found';
    END IF;

    UPDATE public.auto_automation AS automation
    SET name = btrim(p_name),
        source_campaign_id = p_source_campaign_id,
        target_campaign_id = NULL,
        data_type_code = p_data_type_code,
        target_contact_group_id = NULL,
        target_data_group_id = p_target_data_group_id,
        schedule_mode = v_schedule_mode,
        delay_days = COALESCE(p_delay_days, 0),
        delay_hours = COALESCE(p_delay_hours, 0),
        delay_value = v_delay_value,
        delay_unit = v_delay_unit,
        delay_exact_time = v_effective_delay_exact_time,
        daily_time = p_daily_time,
        fixed_at = p_fixed_at,
        note = NULLIF(btrim(COALESCE(p_note, '')), ''),
        is_active = COALESCE(p_is_active, false),
        activated_at = CASE
          WHEN COALESCE(p_is_active, false) THEN clock_timestamp()
          ELSE automation.activated_at
        END,
        config_version = automation.config_version + 1,
        updated_at = clock_timestamp()
    WHERE automation.id = v_existing.id
    RETURNING automation.id INTO v_rule_id;

    DELETE FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id;
  END IF;

  FOR v_status IN
    SELECT item.value
    FROM jsonb_array_elements(p_trigger_statuses) AS item(value)
  LOOP
    IF jsonb_typeof(v_status) <> 'object' THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    v_status_mapping_id := NULL;
    v_status_mapping_id_text := NULLIF(btrim(COALESCE(
      v_status ->> 'statusMappingId',
      v_status ->> 'status_mapping_id',
      ''
    )), '');

    IF v_status_mapping_id_text IS NOT NULL THEN
      IF v_status_mapping_id_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status';
      END IF;
      v_status_mapping_id := v_status_mapping_id_text::bigint;
    ELSE
      v_action_code := NULLIF(btrim(COALESCE(
        v_status ->> 'actionCode', v_status ->> 'action_code', ''
      )), '');
      v_status_value := NULLIF(btrim(COALESCE(
        v_status ->> 'statusValue', v_status ->> 'status_value',
        v_status ->> 'status', ''
      )), '');
      IF v_status_value IS NULL OR length(v_status_value) > 200 THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status_value';
      END IF;
      IF v_action_code IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_actions AS account_action
        WHERE account_action.code = v_action_code
          AND account_action.is_active = true
          AND account_action.is_delete = false
      ) THEN
        RAISE EXCEPTION 'invalid_automation_trigger_action_code';
      END IF;

      SELECT status_mapping.id
      INTO v_status_mapping_id
      FROM public.auto_campaign_action_detail_statuses AS status_mapping
      WHERE status_mapping.campaign_action_id = v_source_action_id
        AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
        AND lower(status_mapping.status_value) = lower(v_status_value)
        AND status_mapping.is_active = true
        AND status_mapping.is_delete = false
      ORDER BY status_mapping.id
      LIMIT 1;

      IF v_status_mapping_id IS NULL THEN
        SELECT status_catalog.id
        INTO v_semantic_status_id
        FROM public.auto_status AS status_catalog
        WHERE status_catalog.component_type = 'campaign_detail'
          AND status_catalog.is_active = true
          AND status_catalog.is_delete = false
          AND lower(status_catalog.name) = lower(v_status_value)
        ORDER BY status_catalog.sort_order, status_catalog.id
        LIMIT 1;

        INSERT INTO public.auto_campaign_action_detail_statuses (
          campaign_action_id, action_code, status_id, status_value, label,
          is_active, is_delete, updated_at
        ) VALUES (
          v_source_action_id, v_action_code, v_semantic_status_id,
          v_status_value, v_status_value, true, false, clock_timestamp()
        )
        ON CONFLICT DO NOTHING;

        UPDATE public.auto_campaign_action_detail_statuses AS status_mapping
        SET is_active = true,
            label = v_status_value,
            status_id = COALESCE(
              status_mapping.status_id,
              v_semantic_status_id
            ),
            updated_at = clock_timestamp()
        WHERE status_mapping.campaign_action_id = v_source_action_id
          AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
          AND lower(status_mapping.status_value) = lower(v_status_value)
          AND status_mapping.is_delete = false;

        SELECT status_mapping.id
        INTO v_status_mapping_id
        FROM public.auto_campaign_action_detail_statuses AS status_mapping
        WHERE status_mapping.campaign_action_id = v_source_action_id
          AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
          AND lower(status_mapping.status_value) = lower(v_status_value)
          AND status_mapping.is_active = true
          AND status_mapping.is_delete = false
        ORDER BY status_mapping.id
        LIMIT 1;
      END IF;
    END IF;

    SELECT
      status_mapping.id,
      status_mapping.action_code,
      status_mapping.status_value
    INTO v_mapping
    FROM public.auto_campaign_action_detail_statuses AS status_mapping
    WHERE status_mapping.id = v_status_mapping_id
      AND status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.is_active = true
      AND status_mapping.is_delete = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    INSERT INTO public.auto_automation_trigger_statuses (
      automation_id, status_mapping_id, action_code, status_value
    ) VALUES (
      v_rule_id, v_mapping.id, v_mapping.action_code, v_mapping.status_value
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- A wildcard already covers specifics with the same semantic status.
  DELETE FROM public.auto_automation_trigger_statuses AS specific
  USING public.auto_campaign_action_detail_statuses AS specific_mapping,
    public.auto_automation_trigger_statuses AS wildcard,
    public.auto_campaign_action_detail_statuses AS wildcard_mapping
  WHERE specific.automation_id = v_rule_id
    AND specific.status_mapping_id = specific_mapping.id
    AND specific.action_code IS NOT NULL
    AND wildcard.automation_id = specific.automation_id
    AND wildcard.action_code IS NULL
    AND wildcard.status_mapping_id = wildcard_mapping.id
    AND (
      lower(wildcard.status_value) = lower(specific.status_value)
      OR (
        wildcard_mapping.status_id IS NOT NULL
        AND specific_mapping.status_id IS NOT NULL
        AND wildcard_mapping.status_id = specific_mapping.status_id
      )
    );

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id
  ) THEN
    RAISE EXCEPTION 'automation_trigger_status_required';
  END IF;

  RETURN public.auto_automation_to_json(
    v_rule_id, p_staff_id, p_organization_id
  );
END;
$$;

ALTER FUNCTION public.aka_agent_set_automation_active(
  bigint, bigint, bigint, boolean, text, text
) RENAME TO aka_agent_set_automation_active_v201_campaign_internal;

REVOKE ALL ON FUNCTION public.aka_agent_set_automation_active_v201_campaign_internal(
  bigint, bigint, bigint, boolean, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.aka_agent_set_automation_active(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_is_active boolean,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule public.auto_automation%ROWTYPE;
  v_locked_group_id bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  SELECT *
  INTO v_rule
  FROM public.auto_automation AS automation
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
    AND automation.is_delete = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'automation_not_found'; END IF;

  IF v_rule.target_campaign_id IS NOT NULL THEN
    RETURN public.aka_agent_set_automation_active_v201_campaign_internal(
      p_staff_id, p_organization_id, p_automation_id, p_is_active,
      p_auth_username, p_auth_password
    );
  END IF;

  IF COALESCE(p_is_active, false) THEN
    v_locked_group_id := v_rule.target_data_group_id;
    IF v_locked_group_id IS NULL THEN
      RAISE EXCEPTION 'automation_destination_required';
    END IF;
    PERFORM contact_group.id
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = v_locked_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
    FOR SHARE OF contact_group;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_target_data_group';
    END IF;
  END IF;

  SELECT *
  INTO v_rule
  FROM public.auto_automation AS automation
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
    AND automation.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  IF v_rule.target_campaign_id IS NOT NULL THEN
    RETURN public.aka_agent_set_automation_active_v201_campaign_internal(
      p_staff_id, p_organization_id, p_automation_id, p_is_active,
      p_auth_username, p_auth_password
    );
  END IF;

  IF COALESCE(p_is_active, false) THEN
    IF v_rule.target_data_group_id IS NULL
      OR v_rule.target_data_group_id IS DISTINCT FROM v_locked_group_id
    THEN
      RAISE EXCEPTION 'automation_destination_required';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_campaign_actions AS campaign_action
        ON campaign_action.id = campaign.action_id
       AND campaign_action.is_active = true
       AND campaign_action.is_delete = false
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = p_staff_id
       AND account.organization_id = p_organization_id
       AND account.is_delete = false
      JOIN public.auto_automation_data_types AS data_type
        ON data_type.code = v_rule.data_type_code
       AND data_type.is_active = true
       AND data_type.is_delete = false
      JOIN public.auto_campaign_action_data_types AS mapping
        ON mapping.campaign_action_id = campaign.action_id
       AND mapping.data_type_code = v_rule.data_type_code
       AND mapping.can_source = true
       AND mapping.is_active = true
       AND mapping.is_delete = false
      WHERE campaign.id = v_rule.source_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.organization_id = p_organization_id
        AND campaign.is_delete = false
    ) THEN
      RAISE EXCEPTION 'source_campaign_data_type_not_supported';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.auto_automation_trigger_statuses AS trigger_status
      WHERE trigger_status.automation_id = v_rule.id
    ) THEN
      RAISE EXCEPTION 'automation_trigger_status_required';
    END IF;
    IF v_rule.schedule_mode = 'fixed_at'
      AND v_rule.fixed_at <= clock_timestamp()
    THEN
      RAISE EXCEPTION 'invalid_fixed_schedule';
    END IF;
  END IF;

  UPDATE public.auto_automation AS automation
  SET is_active = COALESCE(p_is_active, false),
      activated_at = CASE
        WHEN COALESCE(p_is_active, false) AND NOT automation.is_active
          THEN clock_timestamp()
        ELSE automation.activated_at
      END,
      updated_at = clock_timestamp()
  WHERE automation.id = v_rule.id;

  RETURN public.auto_automation_to_json(
    v_rule.id, p_staff_id, p_organization_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Nullable JSON projection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_automation_to_json(
  p_automation_id bigint,
  p_staff_id bigint,
  p_organization_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    to_jsonb(automation)
    || jsonb_build_object(
      'automation_action_name', automation_action.name,
      'data_type_name', data_type.name,
      'target_data_group_name', target_data_group.name,
      'source_campaign', jsonb_build_object(
        'id', source_campaign.id,
        'name', source_campaign.name,
        'action_id', source_campaign.action_id,
        'action_name', source_action.name,
        'account_id', source_campaign.account_id,
        'account_name', source_account.name,
        'flatform_type', source_action.flatform_type
      ),
      'target_campaign', CASE
        WHEN target_campaign.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', target_campaign.id,
          'name', target_campaign.name,
          'action_id', target_campaign.action_id,
          'action_name', target_action.name,
          'account_id', target_campaign.account_id,
          'account_name', target_account.name,
          'flatform_type', target_action.flatform_type
        )
      END,
      'target_contact_group', CASE
        WHEN target_group.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', target_group.id,
          'name', target_group.name,
          'contact_type', target_group.contact_type,
          'purpose', target_group.purpose
        )
      END,
      'trigger_statuses', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', trigger_status.id,
          'status_mapping_id', trigger_status.status_mapping_id,
          'semantic_status_id', status_mapping.status_id,
          'action_code', trigger_status.action_code,
          'action_name', account_action.name,
          'is_wildcard', trigger_status.action_code IS NULL,
          'status_value', trigger_status.status_value,
          'status_label', COALESCE(status_mapping.label, trigger_status.status_value)
        ) ORDER BY
          lower(trigger_status.status_value),
          status_mapping.sort_order,
          trigger_status.id
        )
        FROM public.auto_automation_trigger_statuses AS trigger_status
        JOIN public.auto_campaign_action_detail_statuses AS status_mapping
          ON status_mapping.id = trigger_status.status_mapping_id
        LEFT JOIN public.auto_account_actions AS account_action
          ON account_action.code = trigger_status.action_code
        WHERE trigger_status.automation_id = automation.id
      ), '[]'::jsonb),
      'execution_summary', jsonb_build_object(
        'total', COALESCE(execution_count.total, 0),
        'queued', COALESCE(execution_count.queued, 0),
        'processing', COALESCE(execution_count.processing, 0),
        'materialized', COALESCE(execution_count.materialized, 0),
        'skipped', COALESCE(execution_count.skipped, 0),
        'failed', COALESCE(execution_count.failed, 0),
        'latest_status', latest_execution.status,
        'latest_created_at', latest_execution.created_at,
        'latest_processed_at', latest_execution.processed_at
      )
    )
  FROM public.auto_automation AS automation
  JOIN public.auto_automation_actions AS automation_action
    ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type
    ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_actions AS source_action
    ON source_action.id = source_campaign.action_id
  JOIN public.auto_accounts AS source_account
    ON source_account.id = source_campaign.account_id
  LEFT JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = automation.target_campaign_id
  LEFT JOIN public.auto_campaign_actions AS target_action
    ON target_action.id = target_campaign.action_id
  LEFT JOIN public.auto_accounts AS target_account
    ON target_account.id = target_campaign.account_id
  LEFT JOIN public.auto_account_contact_groups AS target_group
    ON target_group.id = automation.target_contact_group_id
  LEFT JOIN public.auto_account_contact_groups AS target_data_group
    ON target_data_group.id = automation.target_data_group_id
   AND target_data_group.purpose = 'data_group'
   AND target_data_group.is_delete = false
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE detail.status = 'chờ xử lý')::integer AS queued,
      count(*) FILTER (WHERE detail.status = 'đang xử lý')::integer AS processing,
      count(*) FILTER (WHERE detail.status = 'đã thêm')::integer AS materialized,
      count(*) FILTER (WHERE detail.status = 'bỏ qua')::integer AS skipped,
      count(*) FILTER (WHERE detail.status = 'lỗi')::integer AS failed
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
  ) AS execution_count ON true
  LEFT JOIN LATERAL (
    SELECT detail.status, detail.created_at, detail.processed_at
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
    ORDER BY detail.created_at DESC, detail.id DESC
    LIMIT 1
  ) AS latest_execution ON true
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;
$$;

-- ---------------------------------------------------------------------------
-- 7. Group-only enqueue path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_enqueue_group_only_automations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_at timestamptz := clock_timestamp();
  v_reconcile_event_at text;
  v_is_reconcile boolean := false;
  v_enqueue_error text;
BEGIN
  v_is_reconcile := COALESCE(
    current_setting('aka_agent.automation_reconcile', true),
    ''
  ) = 'on';
  v_reconcile_event_at := NULLIF(
    current_setting('aka_agent.automation_event_at', true),
    ''
  );
  IF v_is_reconcile AND v_reconcile_event_at IS NOT NULL THEN
    BEGIN
      v_event_at := v_reconcile_event_at::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_event_at := clock_timestamp();
    END;
  END IF;

  IF NEW.input_data_id IS NULL OR COALESCE(NEW.is_delete, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.action_code IS NOT DISTINCT FROM OLD.action_code
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete
    AND NOT v_is_reconcile
  THEN
    RETURN NEW;
  END IF;

  -- Serialize sole-group enqueue against Data Group soft/hard deletion. Lock
  -- every candidate group in a deterministic order, then let the INSERT query
  -- re-check both the group and rule live state.
  PERFORM locked_group.id
  FROM public.auto_account_contact_groups AS locked_group
  WHERE locked_group.purpose = 'data_group'
    AND locked_group.is_delete = false
    AND EXISTS (
      SELECT 1
      FROM public.auto_automation AS automation
      WHERE automation.source_campaign_id = NEW.campaign_id
        AND automation.target_campaign_id IS NULL
        AND automation.target_data_group_id = locked_group.id
        AND automation.staff_id = locked_group.staff_id
        AND automation.organization_id = locked_group.organization_id
        AND automation.is_active = true
        AND automation.is_delete = false
    )
  ORDER BY locked_group.id
  FOR SHARE OF locked_group;

  INSERT INTO public.auto_automation_detail (
    automation_id,
    parent_automation_detail_id,
    source_campaign_detail_id,
    source_campaign_input_data_id,
    source_campaign_id,
    source_account_id,
    source_action_id,
    source_action_code,
    source_status,
    target_campaign_id,
    target_account_id,
    target_action_id,
    data_type_code,
    data_value,
    source_input_snapshot,
    config_snapshot,
    target_contact_group_id,
    target_data_group_id,
    scheduled_at,
    status,
    next_attempt_at,
    last_error,
    processed_at,
    staff_id,
    organization_id,
    created_at,
    updated_at
  )
  SELECT
    automation.id,
    parent_execution.id,
    NEW.id,
    source_input.id,
    source_campaign.id,
    source_campaign.account_id,
    source_campaign.action_id,
    NEW.action_code,
    NEW.status,
    NULL,
    NULL,
    NULL,
    automation.data_type_code,
    NULLIF(btrim(CASE data_type.source_column
      WHEN 'phone' THEN source_input.phone
      WHEN 'email' THEN source_input.email
      ELSE source_input.uid
    END), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'id', source_input.id,
      'campaign_id', source_input.campaign_id,
      'input_id', source_input.input_id,
      'name', source_input.name,
      'phone', source_input.phone,
      'phone_carrier', source_input.phone_carrier,
      'uid', source_input.uid,
      'email', source_input.email,
      'info1', source_input.info1,
      'info2', source_input.info2,
      'info3', source_input.info3,
      'info4', source_input.info4,
      'info5', source_input.info5,
      'content', source_input.content,
      'schedule', source_input.schedule,
      'created_at', source_input.created_at
    )),
    jsonb_build_object(
      'automation_id', automation.id,
      'automation_name', automation.name,
      'automation_action_id', automation.automation_action_id,
      'config_version', automation.config_version,
      'data_type_code', automation.data_type_code,
      'target_contact_type', source_mapping.target_contact_type,
      'target_contact_group_id', NULL,
      'target_data_group_id', automation.target_data_group_id,
      'target_campaign', NULL
    ),
    NULL,
    automation.target_data_group_id,
    v_event_at,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN 'bỏ qua'
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN 'bỏ qua'
      ELSE 'chờ xử lý'
    END,
    v_event_at,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN 'fixed_schedule_expired'
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN 'source_data_missing'
      ELSE NULL
    END,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN v_event_at
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN v_event_at
      ELSE NULL
    END,
    automation.staff_id,
    automation.organization_id,
    v_event_at,
    v_event_at
  FROM public.auto_automation AS automation
  JOIN public.auto_automation_actions AS automation_action
    ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type
    ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_input_data AS source_input
    ON source_input.id = NEW.input_data_id
   AND source_input.campaign_id = source_campaign.id
   AND COALESCE(source_input.is_delete, false) = false
  JOIN public.auto_campaign_action_data_types AS source_mapping
    ON source_mapping.campaign_action_id = source_campaign.action_id
   AND source_mapping.data_type_code = automation.data_type_code
   AND source_mapping.can_source = true
   AND source_mapping.is_active = true
   AND source_mapping.is_delete = false
  JOIN public.auto_account_contact_groups AS target_data_group
    ON target_data_group.id = automation.target_data_group_id
   AND target_data_group.staff_id = automation.staff_id
   AND target_data_group.organization_id = automation.organization_id
   AND target_data_group.purpose = 'data_group'
   AND target_data_group.is_delete = false
  LEFT JOIN public.auto_automation_detail AS parent_execution
    ON parent_execution.id = NEW.auto_automation_detail_id
   AND parent_execution.staff_id = automation.staff_id
   AND parent_execution.organization_id = automation.organization_id
  WHERE automation.source_campaign_id = NEW.campaign_id
    AND automation.target_campaign_id IS NULL
    AND automation.target_data_group_id IS NOT NULL
    AND automation.is_active = true
    AND automation.is_delete = false
    AND automation.activated_at IS NOT NULL
    AND automation.activated_at <= v_event_at
    AND automation_action.id = 'campaign_detail_route'
    AND automation_action.is_available = true
    AND automation_action.is_active = true
    AND automation_action.is_delete = false
    AND source_campaign.staff_id = automation.staff_id
    AND source_campaign.organization_id = automation.organization_id
    AND EXISTS (
      SELECT 1
      FROM public.auto_automation_trigger_statuses AS trigger_status
      WHERE trigger_status.automation_id = automation.id
        AND lower(trigger_status.status_value) = lower(NEW.status)
        AND (
          trigger_status.action_code IS NULL
          OR trigger_status.action_code IS NOT DISTINCT FROM NEW.action_code
        )
    )
  ON CONFLICT (automation_id, source_campaign_detail_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  v_enqueue_error := SQLERRM;
  BEGIN
    INSERT INTO public.auto_automation_enqueue_failures (
      source_campaign_detail_id, source_campaign_id, source_status,
      source_action_code, source_is_delete, event_at, status,
      next_attempt_at, last_error, resolved_at, staff_id,
      organization_id, updated_at
    )
    SELECT
      NEW.id, campaign.id, NEW.status, NEW.action_code,
      COALESCE(NEW.is_delete, false), v_event_at, 'pending',
      clock_timestamp(), left(v_enqueue_error, 2000), NULL,
      campaign.staff_id, campaign.organization_id, clock_timestamp()
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = NEW.campaign_id
    ON CONFLICT (source_campaign_detail_id) DO UPDATE SET
      source_campaign_id = EXCLUDED.source_campaign_id,
      source_status = EXCLUDED.source_status,
      source_action_code = EXCLUDED.source_action_code,
      source_is_delete = EXCLUDED.source_is_delete,
      event_at = EXCLUDED.event_at,
      status = 'pending',
      next_attempt_at = clock_timestamp(),
      last_error = EXCLUDED.last_error,
      resolved_at = NULL,
      staff_id = EXCLUDED.staff_id,
      organization_id = EXCLUDED.organization_id,
      updated_at = clock_timestamp();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'Group-only Automation enqueue failure could not be persisted for detail %: %',
      NEW.id, SQLERRM;
  END;
  RAISE WARNING
    'Group-only Automation enqueue deferred for campaign detail %: %',
    NEW.id, v_enqueue_error;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_enqueue_group_only_automations
  ON public.auto_campaign_details;
CREATE TRIGGER trg_aka_agent_enqueue_group_only_automations
AFTER INSERT OR UPDATE OF status, action_code, is_delete
ON public.auto_campaign_details
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_enqueue_group_only_automations();

-- ---------------------------------------------------------------------------
-- 8. Effective account for group ingestion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_automation_data_group_result(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_detail_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_detail public.auto_automation_detail%ROWTYPE;
  v_snapshot_group_id bigint;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_effective_account_id bigint;
  v_ingest jsonb;
  v_member_id bigint;
  v_contact_type text;
  v_row jsonb;
  v_request_id text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );

  SELECT detail.target_data_group_id
  INTO v_snapshot_group_id
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'code', 'skipped', 'reason', 'automation_detail_not_found'
    );
  END IF;

  -- Keep the shared group -> detail lock order used by Data Group deletion.
  -- The live/deleted state is checked only after the detail snapshot is locked.
  IF v_snapshot_group_id IS NOT NULL THEN
    PERFORM contact_group.id
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = v_snapshot_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
    FOR UPDATE OF contact_group;
  END IF;

  SELECT *
  INTO v_detail
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'code', 'skipped', 'reason', 'automation_detail_not_found'
    );
  END IF;
  IF v_detail.target_data_group_id IS DISTINCT FROM v_snapshot_group_id
    AND v_detail.target_data_group_id IS NOT NULL
  THEN
    RETURN jsonb_build_object(
      'code', 'failed',
      'reason', 'automation_data_group_destination_changed',
      'automation_detail_id', v_detail.id
    );
  END IF;
  IF v_detail.target_data_group_id IS NULL THEN
    RETURN jsonb_build_object(
      'code', 'skipped', 'reason', 'no_target_data_group',
      'automation_detail_id', v_detail.id
    );
  END IF;
  IF v_detail.target_data_group_sync_status IN ('completed', 'skipped') THEN
    RETURN jsonb_build_object(
      'code', v_detail.target_data_group_sync_status,
      'reason', 'already_final',
      'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id,
      'target_data_group_member_id', v_detail.target_data_group_member_id
    );
  END IF;
  IF v_detail.status <> 'đã thêm'
    OR v_detail.target_input_snapshot IS NULL
  THEN
    RETURN jsonb_build_object(
      'code', 'pending', 'reason', 'automation_not_materialized',
      'automation_detail_id', v_detail.id
    );
  END IF;

  SELECT *
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_detail.target_data_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false;
  IF NOT FOUND THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'skipped',
        target_data_group_sync_error = 'data_group_deleted',
        updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'skipped', 'reason', 'data_group_deleted',
      'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id
    );
  END IF;

  v_effective_account_id := COALESCE(
    v_detail.target_account_id,
    v_detail.source_account_id
  );
  SELECT *
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = v_effective_account_id
    AND account.staff_id = p_staff_id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    );
  IF NOT FOUND THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'failed',
        target_data_group_sync_error = 'effective_account_not_found',
        updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'failed', 'reason', 'effective_account_not_found',
      'automation_detail_id', v_detail.id
    );
  END IF;

  v_contact_type := COALESCE(
    NULLIF(btrim(v_detail.config_snapshot ->> 'target_contact_type'), ''),
    CASE v_detail.data_type_code
      WHEN 'phone' THEN 'phone'
      WHEN 'email' THEN 'email'
      ELSE 'person'
    END
  );
  v_row := jsonb_strip_nulls(jsonb_build_object(
    'source_account_id', v_effective_account_id,
    'contact_type', v_contact_type,
    'flatform_type', v_account.flatform_type,
    'name', v_detail.target_input_snapshot ->> 'name',
    'uid', COALESCE(
      v_detail.target_input_snapshot ->> 'contactUid',
      v_detail.target_input_snapshot ->> 'contact_uid',
      v_detail.target_input_snapshot ->> 'uid'
    ),
    'url', COALESCE(
      v_detail.target_input_snapshot ->> 'url',
      v_detail.target_input_snapshot ->> 'contactUrl',
      v_detail.target_input_snapshot ->> 'contact_url'
    ),
    'phone', v_detail.target_input_snapshot ->> 'phone',
    'email', v_detail.target_input_snapshot ->> 'email',
    'info1', v_detail.target_input_snapshot ->> 'info1',
    'info2', v_detail.target_input_snapshot ->> 'info2',
    'info3', v_detail.target_input_snapshot ->> 'info3',
    'info4', v_detail.target_input_snapshot ->> 'info4',
    'info5', v_detail.target_input_snapshot ->> 'info5',
    'extra_data', jsonb_build_object(
      'automationDetailId', v_detail.id,
      'sourceCampaignDetailId', v_detail.source_campaign_detail_id,
      'content', v_detail.target_input_snapshot ->> 'content'
    )
  ));
  v_request_id := 'automation-detail:'
    || v_detail.id::text
    || ':data-group:v1';

  BEGIN
    v_ingest := public.aka_agent_ingest_data_group(
      p_staff_id, p_organization_id, v_request_id,
      v_detail.target_data_group_id, 'automation', jsonb_build_array(v_row),
      NULL, NULL, NULL, v_effective_account_id,
      'Automation #' || v_detail.automation_id::text,
      md5(v_row::text)
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'failed',
        target_data_group_sync_error = left(SQLERRM, 2000),
        updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'failed', 'reason', 'data_group_ingest_failed',
      'error', left(SQLERRM, 2000),
      'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id
    );
  END;

  SELECT member.id
  INTO v_member_id
  FROM public.auto_data_ingest_batches AS batch
  JOIN public.auto_account_contact_group_member_origins AS origin
    ON origin.batch_id = batch.id
  JOIN public.auto_account_contact_group_members AS member
    ON member.id = origin.membership_id
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = v_request_id
    AND member.group_id = v_detail.target_data_group_id
  ORDER BY member.id
  LIMIT 1;

  IF v_member_id IS NULL THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'failed',
        target_data_group_sync_error = 'automation_data_group_row_invalid',
        updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'failed',
      'reason', 'automation_data_group_row_invalid',
      'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id,
      'ingest', v_ingest
    );
  END IF;

  UPDATE public.auto_automation_detail
  SET target_data_group_member_id = v_member_id,
      target_data_group_sync_status = 'completed',
      target_data_group_sync_error = NULL,
      updated_at = now()
  WHERE id = v_detail.id;

  RETURN jsonb_build_object(
    'code', 'completed',
    'automation_detail_id', v_detail.id,
    'target_data_group_id', v_detail.target_data_group_id,
    'target_data_group_member_id', v_member_id,
    'inserted_membership_count',
      COALESCE((v_ingest ->> 'inserted_membership_count')::integer, 0),
    'reactivated_membership_count',
      COALESCE((v_ingest ->> 'reactivated_membership_count')::integer, 0),
    'already_member_count',
      COALESCE((v_ingest ->> 'already_member_count')::integer, 0),
    'inserted_input_count',
      COALESCE((v_ingest ->> 'inserted_input_count')::integer, 0),
    'already_seen_input_count',
      COALESCE((v_ingest ->> 'already_seen_input_count')::integer, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_guard_automation_destination_update()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_deactivate_group_only_automations()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_set_group_only_sync_terminal()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_enqueue_group_only_automations()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_set_automation_active(
  bigint, bigint, bigint, boolean, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_set_automation_active(
  bigint, bigint, bigint, boolean, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
