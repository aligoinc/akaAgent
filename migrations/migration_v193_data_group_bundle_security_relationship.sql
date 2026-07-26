-- Atomic Data Group bundle baselines, authenticated automation destinations,
-- and exact per-row relationship provenance.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A campaign-creation bundle owns exactly one Data Group snapshot.
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_campaign_creation_bundles
  ADD COLUMN IF NOT EXISTS data_group_id bigint,
  ADD COLUMN IF NOT EXISTS baseline_revision bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_campaign_creation_bundles'::regclass
      AND conname = 'auto_campaign_creation_bundles_data_group_id_fkey'
  ) THEN
    ALTER TABLE public.auto_campaign_creation_bundles
      ADD CONSTRAINT auto_campaign_creation_bundles_data_group_id_fkey
      FOREIGN KEY (data_group_id)
      REFERENCES public.auto_account_contact_groups(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

-- v186 activated every child as it was registered. A staged bundle containing
-- an active source may therefore already expose a non-atomic snapshot. Fail it
-- closed instead of pretending that its children share one baseline. Ready
-- bundles are retained only when their persisted shape already proves one
-- group and one revision across every expected child.
WITH bundle_shape AS (
  SELECT
    bundle.id,
    bundle.status,
    bundle.expected_campaign_count,
    (
      SELECT count(*)::integer
      FROM public.auto_campaigns AS campaign
      WHERE campaign.creation_bundle_id = bundle.id
        AND campaign.staff_id = bundle.staff_id
        AND campaign.organization_id = bundle.organization_id
        AND COALESCE(campaign.is_delete, false) = false
    ) AS campaign_count,
    (
      SELECT count(DISTINCT campaign.creation_bundle_child_index)::integer
      FROM public.auto_campaigns AS campaign
      WHERE campaign.creation_bundle_id = bundle.id
        AND campaign.staff_id = bundle.staff_id
        AND campaign.organization_id = bundle.organization_id
        AND COALESCE(campaign.is_delete, false) = false
        AND campaign.creation_bundle_child_index >= 0
        AND campaign.creation_bundle_child_index < bundle.expected_campaign_count
    ) AS child_index_count,
    (
      SELECT count(*)::integer
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = bundle.id
    ) AS source_count,
    (
      SELECT count(DISTINCT source.group_id)::integer
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = bundle.id
    ) AS group_count,
    (
      SELECT min(source.group_id)
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = bundle.id
    ) AS resolved_group_id,
    (
      SELECT count(DISTINCT source.baseline_revision)::integer
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = bundle.id
    ) AS baseline_count,
    (
      SELECT min(source.baseline_revision)
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = bundle.id
    ) AS resolved_baseline_revision,
    (
      SELECT count(*)::integer
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = bundle.id
        AND source.status = 'active'
    ) AS active_source_count,
    (
      SELECT count(*)::integer
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = bundle.id
        AND source.status = 'stopped'
    ) AS stopped_source_count,
    (
      SELECT count(*)::integer
      FROM public.auto_campaign_data_group_sources AS source
      LEFT JOIN public.auto_campaigns AS campaign
        ON campaign.id = source.campaign_id
      WHERE source.bundle_id = bundle.id
        AND (
          source.staff_id IS DISTINCT FROM bundle.staff_id
          OR source.organization_id IS DISTINCT FROM bundle.organization_id
          OR campaign.id IS NULL
          OR campaign.creation_bundle_id IS DISTINCT FROM bundle.id
          OR campaign.staff_id IS DISTINCT FROM bundle.staff_id
          OR campaign.organization_id IS DISTINCT FROM bundle.organization_id
          OR COALESCE(campaign.is_delete, false)
          OR campaign.data_target_source_mode <> 'data_group'
          OR campaign.data_group_id IS DISTINCT FROM source.group_id
          OR (
            bundle.status = 'ready'
            AND campaign.provisioning_state <> 'ready'
          )
        )
    ) AS mismatch_count
  FROM public.auto_campaign_creation_bundles AS bundle
), classified AS (
  SELECT
    shape.*,
    CASE
      WHEN shape.status = 'failed' THEN true
      WHEN shape.status = 'ready' THEN NOT (
        shape.campaign_count = shape.expected_campaign_count
        AND shape.child_index_count = shape.expected_campaign_count
        AND shape.source_count = shape.expected_campaign_count
        AND shape.group_count = 1
        AND shape.baseline_count = 1
        AND shape.active_source_count = shape.expected_campaign_count
        AND shape.stopped_source_count = 0
        AND shape.mismatch_count = 0
      )
      ELSE (
        shape.campaign_count > shape.expected_campaign_count
        OR shape.child_index_count <> shape.campaign_count
        OR shape.source_count > shape.campaign_count
        OR shape.group_count > 1
        OR shape.active_source_count > 0
        OR shape.stopped_source_count > 0
        OR shape.mismatch_count > 0
      )
    END AS fail_closed
  FROM bundle_shape AS shape
)
UPDATE public.auto_campaign_creation_bundles AS bundle
SET
  data_group_id = CASE
    WHEN classified.group_count = 1 THEN classified.resolved_group_id
    ELSE NULL
  END,
  baseline_revision = CASE
    WHEN classified.status = 'ready' AND NOT classified.fail_closed
      THEN classified.resolved_baseline_revision
    ELSE NULL
  END,
  ready_campaign_count = CASE
    WHEN classified.fail_closed THEN 0
    WHEN classified.status = 'ready' THEN classified.expected_campaign_count
    ELSE 0
  END,
  status = CASE WHEN classified.fail_closed THEN 'failed' ELSE classified.status END,
  error = CASE
    WHEN classified.fail_closed
      THEN COALESCE(bundle.error, 'bundle_v193_inconsistent_legacy_state')
    ELSE bundle.error
  END,
  updated_at = now()
FROM classified
WHERE bundle.id = classified.id;

UPDATE public.auto_campaigns AS campaign
SET provisioning_state = 'failed',
    updated_at = now()
FROM public.auto_campaign_creation_bundles AS bundle
WHERE campaign.creation_bundle_id = bundle.id
  AND bundle.status = 'failed'
  AND campaign.provisioning_state <> 'failed';

UPDATE public.auto_campaign_data_group_sources AS source
SET status = 'stopped',
    stopped_at = COALESCE(source.stopped_at, now()),
    stop_reason = COALESCE(
      NULLIF(source.stop_reason, ''), 'bundle_v193_inconsistent_legacy_state'
    ),
    updated_at = now()
FROM public.auto_campaign_creation_bundles AS bundle
WHERE source.bundle_id = bundle.id
  AND bundle.status = 'failed'
  AND source.status <> 'stopped';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_campaign_creation_bundles'::regclass
      AND conname = 'auto_campaign_creation_bundles_baseline_revision_check'
  ) THEN
    ALTER TABLE public.auto_campaign_creation_bundles
      ADD CONSTRAINT auto_campaign_creation_bundles_baseline_revision_check
      CHECK (baseline_revision IS NULL OR baseline_revision >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_campaign_creation_bundles'::regclass
      AND conname = 'auto_campaign_creation_bundles_ready_snapshot_check'
  ) THEN
    ALTER TABLE public.auto_campaign_creation_bundles
      ADD CONSTRAINT auto_campaign_creation_bundles_ready_snapshot_check
      CHECK (
        status <> 'ready'
        OR (
          data_group_id IS NOT NULL
          AND baseline_revision IS NOT NULL
          AND ready_campaign_count = expected_campaign_count
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_guard_campaign_creation_bundle_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_bundle public.auto_campaign_creation_bundles%ROWTYPE;
BEGIN
  IF NEW.bundle_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT bundle.*
  INTO v_bundle
  FROM public.auto_campaign_creation_bundles AS bundle
  WHERE bundle.id = NEW.bundle_id
  FOR SHARE;

  IF NOT FOUND
    OR v_bundle.staff_id IS DISTINCT FROM NEW.staff_id
    OR v_bundle.organization_id IS DISTINCT FROM NEW.organization_id
    OR v_bundle.data_group_id IS NULL
    OR v_bundle.data_group_id IS DISTINCT FROM NEW.group_id
  THEN
    RAISE EXCEPTION 'campaign_creation_bundle_group_mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = NEW.campaign_id
      AND campaign.creation_bundle_id = NEW.bundle_id
      AND campaign.staff_id = NEW.staff_id
      AND campaign.organization_id = NEW.organization_id
      AND COALESCE(campaign.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'campaign_creation_bundle_child_invalid';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_campaign_creation_bundle_group
  ON public.auto_campaign_data_group_sources;
CREATE TRIGGER trg_aka_agent_guard_campaign_creation_bundle_group
BEFORE INSERT OR UPDATE OF campaign_id, group_id, bundle_id, staff_id, organization_id
ON public.auto_campaign_data_group_sources
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_campaign_creation_bundle_group();

CREATE OR REPLACE FUNCTION public.aka_agent_guard_campaign_creation_bundle_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.data_group_id IS DISTINCT FROM OLD.data_group_id
    AND OLD.data_group_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.bundle_id = OLD.id
    )
  THEN
    RAISE EXCEPTION 'campaign_creation_bundle_group_immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_campaign_creation_bundle_identity
  ON public.auto_campaign_creation_bundles;
CREATE TRIGGER trg_aka_agent_guard_campaign_creation_bundle_identity
BEFORE UPDATE OF data_group_id
ON public.auto_campaign_creation_bundles
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_campaign_creation_bundle_identity();

-- Bundle children register without routing. The last distinct child turns the
-- bundle into a transaction-local ready state, routes every child from the
-- locked group revision, and only then exposes active sources/ready campaigns
-- when the transaction commits.
CREATE OR REPLACE FUNCTION public.aka_agent_bind_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_bundle_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_bundle public.auto_campaign_creation_bundles%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_bundle_source record;
  v_request_hash text;
  v_rebinding boolean := false;
  v_source_found boolean := false;
  v_snapshot jsonb;
  v_campaign_count integer := 0;
  v_child_index_count integer := 0;
  v_min_child_index integer;
  v_max_child_index integer;
  v_invalid_campaign_count integer := 0;
  v_registered_count integer := 0;
  v_distinct_group_count integer := 0;
  v_invalid_source_count integer := 0;
  v_active_membership_count integer := 0;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_data_group_bind_request';
  END IF;

  -- Common lock root for bind, ingest, delete and stop.
  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  IF p_bundle_id IS NOT NULL THEN
    SELECT bundle.*
    INTO v_bundle
    FROM public.auto_campaign_creation_bundles AS bundle
    WHERE bundle.id = p_bundle_id
      AND bundle.staff_id = p_staff_id
      AND bundle.organization_id = p_organization_id
    FOR UPDATE;
    IF NOT FOUND OR v_bundle.status = 'failed' THEN
      RAISE EXCEPTION 'campaign_creation_bundle_not_found';
    END IF;

    IF v_bundle.data_group_id IS NULL THEN
      UPDATE public.auto_campaign_creation_bundles AS bundle
      SET data_group_id = v_group.id,
          updated_at = now()
      WHERE bundle.id = v_bundle.id
      RETURNING bundle.* INTO v_bundle;
    ELSIF v_bundle.data_group_id IS DISTINCT FROM v_group.id THEN
      RAISE EXCEPTION 'campaign_creation_bundle_group_mismatch';
    END IF;

    -- The bundle lock prevents new FK references while every existing child
    -- and source is locked in one deterministic order.
    PERFORM campaign.id
    FROM public.auto_campaigns AS campaign
    WHERE campaign.creation_bundle_id = p_bundle_id
    ORDER BY campaign.creation_bundle_child_index NULLS LAST, campaign.id
    FOR UPDATE OF campaign;

    SELECT campaign.*
    INTO v_campaign
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id;

    PERFORM source.id
    FROM public.auto_campaign_data_group_sources AS source
    WHERE source.bundle_id = p_bundle_id
    ORDER BY source.campaign_id, source.id
    FOR UPDATE OF source;
  ELSE
    SELECT campaign.*
    INTO v_campaign
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
    FOR UPDATE;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'bind_source',
    'campaignId', p_campaign_id,
    'groupId', p_group_id,
    'bundleId', p_bundle_id
  )::text);

  -- A committed bundle response is authoritative even if the campaign has
  -- subsequently started. This keeps retries stable across lifecycle changes.
  IF p_bundle_id IS NOT NULL THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF FOUND THEN
      IF v_batch.operation <> 'bind_source'
        OR v_batch.group_id IS DISTINCT FROM p_group_id
        OR v_batch.request_hash <> v_request_hash
      THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN
        RETURN v_batch.result;
      END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  IF v_campaign.id IS NULL OR COALESCE(v_campaign.is_delete, false) THEN
    RAISE EXCEPTION 'data_group_campaign_not_found';
  END IF;
  IF v_campaign.status IN ('đang chạy', 'hoàn thành')
    OR (
      v_campaign.schedule_end_date IS NOT NULL
      AND v_campaign.schedule_end_date <= now()
    )
  THEN
    RAISE EXCEPTION 'data_group_campaign_not_bindable';
  END IF;
  IF v_campaign.action_id NOT IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid',
    'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_comment_seeding', 'facebook_comment_seeding_post',
    'zalo_message_phone', 'zalo_join_group_link', 'email_send',
    'facebook_message_friend', 'facebook_group_invite', 'facebook_page_post',
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer', 'zalo_message_group',
    'zalo_add_group_member'
  ) THEN
    RAISE EXCEPTION 'data_group_campaign_action_incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
      AND account.staff_id = p_staff_id
      AND (
        account.organization_id IS NULL
        OR account.organization_id = p_organization_id
      )
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'data_group_campaign_account_not_found';
  END IF;

  IF p_bundle_id IS NOT NULL THEN
    IF v_campaign.creation_bundle_id IS DISTINCT FROM p_bundle_id
      OR v_campaign.creation_bundle_child_index IS NULL
      OR v_campaign.creation_bundle_child_index < 0
      OR v_campaign.creation_bundle_child_index >= v_bundle.expected_campaign_count
    THEN
      RAISE EXCEPTION 'campaign_creation_bundle_child_invalid';
    END IF;
  ELSIF v_campaign.creation_bundle_id IS NOT NULL THEN
    RAISE EXCEPTION 'campaign_creation_bundle_required';
  END IF;

  SELECT source.*
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id
  FOR UPDATE;
  v_source_found := FOUND;

  IF v_source_found THEN
    IF v_source.bundle_id IS DISTINCT FROM p_bundle_id THEN
      RAISE EXCEPTION 'campaign_data_group_source_immutable';
    END IF;
    IF v_source.group_id IS DISTINCT FROM v_group.id THEN
      IF p_bundle_id IS NOT NULL THEN
        RAISE EXCEPTION 'campaign_creation_bundle_group_mismatch';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND input_data.canonical_target_key IS NOT NULL
          AND COALESCE(input_data.is_delete, false) = false
      ) THEN
        RAISE EXCEPTION 'campaign_data_group_source_immutable_after_intake';
      END IF;
      v_rebinding := true;
    ELSIF v_source.status = 'stopped' THEN
      RAISE EXCEPTION 'campaign_data_group_source_stopped_use_reactivate';
    ELSIF p_bundle_id IS NULL AND v_source.status = 'active' THEN
      -- Preserve the established non-bundle idempotent response.
      RETURN to_jsonb(v_source);
    END IF;
  END IF;

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'bind_source', p_group_id, v_request_hash,
    'processing', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'bind_source'
      OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN
      RETURN v_batch.result;
    END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  -- A fresh request against an already committed ready bundle is harmless and
  -- gets its own completed idempotency row without replaying the snapshot.
  IF p_bundle_id IS NOT NULL AND v_bundle.status = 'ready' THEN
    IF NOT v_source_found
      OR v_source.status <> 'active'
      OR v_source.group_id IS DISTINCT FROM v_bundle.data_group_id
      OR v_source.baseline_revision IS DISTINCT FROM v_bundle.baseline_revision
    THEN
      RAISE EXCEPTION 'campaign_creation_bundle_ready_state_invalid';
    END IF;

    UPDATE public.auto_data_ingest_batches
    SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
    WHERE id = v_batch.id;
    RETURN to_jsonb(v_source);
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET data_target_source_mode = 'data_group',
      data_group_id = v_group.id,
      provisioning_state = 'staged',
      updated_at = now()
  WHERE campaign.id = v_campaign.id;

  IF NOT v_source_found THEN
    INSERT INTO public.auto_campaign_data_group_sources (
      campaign_id, group_id, bundle_id, baseline_revision, status,
      staff_id, organization_id
    ) VALUES (
      v_campaign.id, v_group.id, p_bundle_id,
      CASE WHEN p_bundle_id IS NULL THEN v_group.revision ELSE 0 END,
      'baselining',
      p_staff_id, p_organization_id
    )
    RETURNING * INTO v_source;
    v_source_found := true;
  ELSIF v_rebinding THEN
    -- The non-bundle path keeps v186's atomic empty-source rebind behavior.
    DELETE FROM public.auto_campaign_input_target_aliases AS alias
    WHERE alias.campaign_id = v_campaign.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.id = alias.input_data_id
          AND COALESCE(input_data.is_delete, false) = false
      );

    UPDATE public.auto_campaign_data_group_sources AS source
    SET group_id = v_group.id,
        baseline_revision = v_group.revision,
        status = 'baselining',
        started_at = NULL,
        stopped_at = NULL,
        stop_reason = NULL,
        last_ingest_at = NULL,
        updated_at = now()
    WHERE source.id = v_source.id
    RETURNING source.* INTO v_source;
  END IF;

  IF p_bundle_id IS NULL THEN
    -- Non-bundle behavior remains the established one-campaign transaction.
    v_snapshot := public.aka_agent_internal_route_group_snapshot(
      v_source.id, v_batch.id, v_group.revision
    );

    UPDATE public.auto_campaign_data_group_sources AS source
    SET status = 'active',
        baseline_revision = v_group.revision,
        started_at = COALESCE(source.started_at, now()),
        stopped_at = NULL,
        stop_reason = NULL,
        last_ingest_at = now(),
        updated_at = now()
    WHERE source.id = v_source.id
    RETURNING source.* INTO v_source;

    UPDATE public.auto_campaigns AS campaign
    SET provisioning_state = 'ready',
        note = CASE
          WHEN COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)
             + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0) = 0
            THEN 'Chờ data phù hợp'
          WHEN campaign.note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
          ELSE campaign.note
        END,
        updated_at = now()
    WHERE campaign.id = v_campaign.id;

    UPDATE public.auto_data_ingest_batches
    SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
    WHERE id = v_batch.id;
    RETURN to_jsonb(v_source);
  END IF;

  SELECT
    count(*)::integer,
    count(DISTINCT campaign.creation_bundle_child_index)::integer,
    min(campaign.creation_bundle_child_index),
    max(campaign.creation_bundle_child_index),
    count(*) FILTER (WHERE
      campaign.staff_id IS DISTINCT FROM p_staff_id
      OR campaign.organization_id IS DISTINCT FROM p_organization_id
      OR COALESCE(campaign.is_delete, false)
      OR campaign.creation_bundle_child_index IS NULL
      OR campaign.creation_bundle_child_index < 0
      OR campaign.creation_bundle_child_index >= v_bundle.expected_campaign_count
    )::integer
  INTO
    v_campaign_count,
    v_child_index_count,
    v_min_child_index,
    v_max_child_index,
    v_invalid_campaign_count
  FROM public.auto_campaigns AS campaign
  WHERE campaign.creation_bundle_id = p_bundle_id;

  SELECT
    count(*)::integer,
    count(DISTINCT source.group_id)::integer,
    count(*) FILTER (WHERE
      source.staff_id IS DISTINCT FROM p_staff_id
      OR source.organization_id IS DISTINCT FROM p_organization_id
      OR source.group_id IS DISTINCT FROM v_group.id
      OR source.status <> 'baselining'
      OR campaign.id IS NULL
      OR campaign.creation_bundle_id IS DISTINCT FROM p_bundle_id
      OR campaign.staff_id IS DISTINCT FROM p_staff_id
      OR campaign.organization_id IS DISTINCT FROM p_organization_id
      OR COALESCE(campaign.is_delete, false)
      OR campaign.data_target_source_mode <> 'data_group'
      OR campaign.data_group_id IS DISTINCT FROM v_group.id
      OR campaign.provisioning_state <> 'staged'
    )::integer
  INTO
    v_registered_count,
    v_distinct_group_count,
    v_invalid_source_count
  FROM public.auto_campaign_data_group_sources AS source
  LEFT JOIN public.auto_campaigns AS campaign ON campaign.id = source.campaign_id
  WHERE source.bundle_id = p_bundle_id;

  IF v_registered_count < v_bundle.expected_campaign_count THEN
    IF v_invalid_source_count <> 0 OR v_distinct_group_count > 1 THEN
      RAISE EXCEPTION 'campaign_creation_bundle_registration_invalid';
    END IF;

    UPDATE public.auto_campaign_creation_bundles AS bundle
    SET ready_campaign_count = 0,
        status = 'staged',
        baseline_revision = NULL,
        updated_at = now()
    WHERE bundle.id = p_bundle_id
    RETURNING bundle.* INTO v_bundle;

    UPDATE public.auto_data_ingest_batches
    SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
    WHERE id = v_batch.id;
    RETURN to_jsonb(v_source);
  END IF;

  IF v_campaign_count <> v_bundle.expected_campaign_count
    OR v_child_index_count <> v_bundle.expected_campaign_count
    OR v_min_child_index <> 0
    OR v_max_child_index <> v_bundle.expected_campaign_count - 1
    OR v_invalid_campaign_count <> 0
    OR v_registered_count <> v_bundle.expected_campaign_count
    OR v_distinct_group_count <> 1
    OR v_invalid_source_count <> 0
  THEN
    RAISE EXCEPTION 'campaign_creation_bundle_registration_invalid';
  END IF;

  -- This update is not externally visible until every snapshot succeeds. It
  -- is intentionally first so the router can distinguish this transaction's
  -- final baseline from ordinary ingest against a staged child.
  UPDATE public.auto_campaign_creation_bundles AS bundle
  SET data_group_id = v_group.id,
      baseline_revision = v_group.revision,
      ready_campaign_count = bundle.expected_campaign_count,
      status = 'ready',
      error = NULL,
      updated_at = now()
  WHERE bundle.id = p_bundle_id
  RETURNING bundle.* INTO v_bundle;

  UPDATE public.auto_campaign_data_group_sources AS source
  SET baseline_revision = v_group.revision,
      status = 'baselining',
      started_at = NULL,
      stopped_at = NULL,
      stop_reason = NULL,
      last_ingest_at = NULL,
      updated_at = now()
  WHERE source.bundle_id = p_bundle_id;

  SELECT count(*)::integer
  INTO v_active_membership_count
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_group.id
    AND member.is_delete = false;

  FOR v_bundle_source IN
    SELECT source.id, source.campaign_id
    FROM public.auto_campaign_data_group_sources AS source
    WHERE source.bundle_id = p_bundle_id
    ORDER BY source.campaign_id, source.id
  LOOP
    v_snapshot := public.aka_agent_internal_route_group_snapshot(
      v_bundle_source.id, v_batch.id, v_group.revision
    );

    IF COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)
         + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0)
         + COALESCE((v_snapshot ->> 'incompatible_count')::integer, 0)
         + COALESCE((v_snapshot ->> 'conflict_count')::integer, 0)
       <> v_active_membership_count
    THEN
      RAISE EXCEPTION 'campaign_creation_bundle_baseline_incomplete';
    END IF;

    UPDATE public.auto_campaigns AS campaign
    SET note = CASE
          WHEN COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)
             + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0) = 0
            THEN 'Chờ data phù hợp'
          WHEN campaign.note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
          ELSE campaign.note
        END,
        updated_at = now()
    WHERE campaign.id = v_bundle_source.campaign_id;
  END LOOP;

  UPDATE public.auto_campaign_data_group_sources AS source
  SET status = 'active',
      baseline_revision = v_group.revision,
      started_at = COALESCE(source.started_at, now()),
      stopped_at = NULL,
      stop_reason = NULL,
      last_ingest_at = now(),
      updated_at = now()
  WHERE source.bundle_id = p_bundle_id;

  UPDATE public.auto_campaigns AS campaign
  SET provisioning_state = 'ready',
      updated_at = now()
  WHERE campaign.creation_bundle_id = p_bundle_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false;

  SELECT source.*
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id;

  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;

  RETURN to_jsonb(v_source);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Staged bundle sources are not ordinary ingest destinations.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)'
  ) IS NULL THEN
    IF pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
    ) IS NULL THEN
      RAISE EXCEPTION 'missing_v190_data_group_router';
    END IF;

    ALTER FUNCTION public.aka_agent_internal_route_data_group_member(
      bigint, bigint, bigint, bigint
    ) RENAME TO aka_agent_internal_route_data_group_member_v190_internal;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member(
  p_source_id bigint,
  p_membership_id bigint,
  p_batch_id bigint,
  p_group_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_bundle_id bigint;
  v_group_id bigint;
  v_staff_id bigint;
  v_organization_id bigint;
  v_bundle_status text;
  v_bundle_group_id bigint;
  v_bundle_staff_id bigint;
  v_bundle_organization_id bigint;
  v_source_status text;
  v_campaign_bundle_id bigint;
  v_campaign_group_id bigint;
  v_campaign_staff_id bigint;
  v_campaign_organization_id bigint;
  v_campaign_provisioning_state text;
  v_final_baseline_proven boolean := false;
BEGIN
  SELECT
    source.bundle_id,
    source.group_id,
    source.staff_id,
    source.organization_id,
    bundle.status,
    bundle.data_group_id,
    bundle.staff_id,
    bundle.organization_id,
    source.status,
    campaign.creation_bundle_id,
    campaign.data_group_id,
    campaign.staff_id,
    campaign.organization_id,
    campaign.provisioning_state
  INTO
    v_bundle_id,
    v_group_id,
    v_staff_id,
    v_organization_id,
    v_bundle_status,
    v_bundle_group_id,
    v_bundle_staff_id,
    v_bundle_organization_id,
    v_source_status,
    v_campaign_bundle_id,
    v_campaign_group_id,
    v_campaign_staff_id,
    v_campaign_organization_id,
    v_campaign_provisioning_state
  FROM public.auto_campaign_data_group_sources AS source
  LEFT JOIN public.auto_campaign_creation_bundles AS bundle
    ON bundle.id = source.bundle_id
  LEFT JOIN public.auto_campaigns AS campaign
    ON campaign.id = source.campaign_id
  WHERE source.id = p_source_id;

  IF FOUND AND v_bundle_id IS NOT NULL THEN
    IF v_bundle_status IS NULL
      OR v_bundle_staff_id IS DISTINCT FROM v_staff_id
      OR v_bundle_organization_id IS DISTINCT FROM v_organization_id
      OR v_bundle_group_id IS DISTINCT FROM v_group_id
      OR v_campaign_bundle_id IS DISTINCT FROM v_bundle_id
      OR v_campaign_group_id IS DISTINCT FROM v_group_id
      OR v_campaign_staff_id IS DISTINCT FROM v_staff_id
      OR v_campaign_organization_id IS DISTINCT FROM v_organization_id
    THEN
      RETURN jsonb_build_object(
        'status', 'no_intake',
        'reason', 'campaign_creation_bundle_invalid'
      );
    END IF;

    IF v_bundle_status IN ('staged', 'ready')
      AND v_source_status = 'baselining'
      AND v_campaign_provisioning_state = 'staged'
    THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.auto_data_ingest_batches AS batch
        WHERE batch.id = p_batch_id
          AND batch.operation = 'bind_source'
          AND batch.status = 'processing'
          AND batch.result IS NULL
          AND batch.group_id = v_group_id
          AND batch.staff_id = v_staff_id
          AND batch.organization_id = v_organization_id
      )
      INTO v_final_baseline_proven;

      IF NOT v_final_baseline_proven THEN
        RETURN jsonb_build_object(
          'status', 'no_intake',
          'reason', 'campaign_creation_bundle_staged'
        );
      END IF;
    ELSIF NOT (
      v_bundle_status = 'ready'
      AND v_source_status = 'active'
      AND v_campaign_provisioning_state = 'ready'
    ) THEN
      RETURN jsonb_build_object(
        'status', 'no_intake',
        'reason', 'campaign_creation_bundle_not_ready'
      );
    END IF;
  END IF;

  -- v190 remains authoritative for exact account/relationship validation and
  -- delegates in turn to the preserved v186 routing matrix.
  RETURN public.aka_agent_internal_route_data_group_member_v190_internal(
    p_source_id, p_membership_id, p_batch_id, p_group_revision
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Authenticate before looking up an optional automation Data Group.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_save_automation(
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
  v_saved jsonb;
  v_rule_id bigint;
BEGIN
  -- This must precede every tenant-scoped existence check.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF p_target_data_group_id IS NOT NULL THEN
    -- FOR SHARE conflicts with the delete RPC's FOR UPDATE/soft-delete update.
    -- FOR KEY SHARE would not block a non-key UPDATE and is insufficient here.
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

  -- The v177 overload remains authoritative for graph, status and scheduling
  -- validation. Its second identity check is intentionally harmless.
  v_saved := public.aka_agent_save_automation(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_name,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    p_delay_days,
    p_delay_hours,
    p_fixed_at,
    p_note,
    p_is_active,
    p_trigger_statuses,
    p_auth_username,
    p_auth_password,
    p_delay_value,
    p_delay_unit,
    p_daily_time,
    p_delay_exact_time,
    p_delay_exact_time_present
  );

  v_rule_id := NULLIF(v_saved ->> 'id', '')::bigint;
  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'automation_save_failed';
  END IF;

  UPDATE public.auto_automation AS automation
  SET target_data_group_id = p_target_data_group_id,
      updated_at = clock_timestamp()
  WHERE automation.id = v_rule_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;

  RETURN public.auto_automation_to_json(
    v_rule_id, p_staff_id, p_organization_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Relationship provenance is exact per input row and per origin.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.uq_auto_account_contact_group_member_origins_identity;
CREATE UNIQUE INDEX uq_auto_account_contact_group_member_origins_identity
  ON public.auto_account_contact_group_member_origins (
    membership_id,
    kind,
    COALESCE(dataset_id, 0::bigint),
    COALESCE(batch_id, 0::bigint),
    COALESCE(source_account_id, 0::bigint),
    COALESCE(automation_detail_id, 0::bigint),
    COALESCE(source_name_snapshot, ''),
    COALESCE(relationship_kind, '')
  );

-- Validate a requested relationship against the exact row payload while the
-- v186 ingest loop still has that payload. This avoids ambiguous transaction
-- hints when two rows resolve to the same canonical contact.
CREATE OR REPLACE FUNCTION public.aka_agent_validate_data_group_relationship_kind(
  p_membership_id bigint,
  p_source_account_id bigint,
  p_dataset_id bigint,
  p_requested_kind text,
  p_row_extra_data jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_contact public.auto_account_contacts%ROWTYPE;
  v_effective_account_id bigint;
  v_requested_kind text;
  v_declared_kind text;
  v_source_marker text;
  v_campaign_id_text text;
  v_row_extra jsonb;
BEGIN
  SELECT contact.*
  INTO v_contact
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
  WHERE member.id = p_membership_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_effective_account_id := COALESCE(p_source_account_id, v_contact.account_id);
  IF v_effective_account_id IS NULL
    OR v_contact.account_id IS DISTINCT FROM v_effective_account_id
    OR lower(btrim(COALESCE(v_contact.flatform_type, ''))) <> 'zalo'
    OR lower(btrim(COALESCE(v_contact.contact_type, ''))) <> 'person'
  THEN
    RETURN NULL;
  END IF;

  v_row_extra := CASE
    WHEN jsonb_typeof(p_row_extra_data) = 'object' THEN p_row_extra_data
    ELSE '{}'::jsonb
  END;
  v_requested_kind := lower(NULLIF(btrim(COALESCE(p_requested_kind, '')), ''));
  IF v_requested_kind IS NOT NULL AND v_requested_kind NOT IN (
    'zalo_group_members', 'zalo_remarketing_customers'
  ) THEN
    RETURN NULL;
  END IF;

  -- An explicit per-row request is evaluated independently. A scan dataset or
  -- durable relation proves group membership; it never silently converts an
  -- explicitly requested remarketing origin into a group-member origin.
  IF v_requested_kind = 'zalo_group_members' THEN
    IF (
      p_dataset_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.auto_account_contacts_dataset AS dataset
        JOIN public.auto_account_contacts_dataset_members AS dataset_member
          ON dataset_member.dataset_id = dataset.id
        WHERE dataset.id = p_dataset_id
          AND dataset.account_id = v_effective_account_id
          AND dataset.staff_id = v_contact.staff_id
          AND dataset.organization_id = v_contact.organization_id
          AND dataset.scan_type = 'zalo_group_members'
          AND dataset.source = 'scan'
          AND dataset.is_delete = false
          AND dataset_member.contact_id = v_contact.id
          AND dataset_member.is_current = true
      )
    ) OR EXISTS (
      SELECT 1
      FROM public.zalo_group_members AS relation
      WHERE relation.account_id = v_effective_account_id
        AND relation.zalo_uid = v_contact.uid
        AND relation.is_current = true
        AND (
          relation.staff_id IS NULL
          OR relation.staff_id = v_contact.staff_id
        )
        AND (
          relation.organization_id IS NULL
          OR relation.organization_id = v_contact.organization_id
        )
    ) THEN
      RETURN 'zalo_group_members';
    END IF;
    RETURN NULL;
  END IF;

  IF v_requested_kind = 'zalo_remarketing_customers' THEN
    v_campaign_id_text := btrim(COALESCE(
      v_row_extra ->> 'latestCampaignId',
      v_row_extra ->> 'latest_campaign_id',
      v_row_extra ->> 'sourceCampaignId',
      v_row_extra ->> 'source_campaign_id',
      v_contact.extra_data ->> 'latestCampaignId',
      v_contact.extra_data ->> 'latest_campaign_id',
      v_contact.extra_data ->> 'sourceCampaignId',
      v_contact.extra_data ->> 'source_campaign_id',
      ''
    ));
    IF v_campaign_id_text ~ '^[1-9][0-9]{0,17}$'
      AND EXISTS (
        SELECT 1
        FROM public.auto_campaigns AS campaign
        WHERE campaign.id = v_campaign_id_text::bigint
          AND campaign.account_id = v_effective_account_id
          AND campaign.staff_id = v_contact.staff_id
          AND campaign.organization_id = v_contact.organization_id
          AND campaign.action_id IN (
            'zalo_message_phone',
            'zalo_message_friend',
            'zalo_message_group_member',
            'zalo_message_group_realtime',
            'zalo_message_friend_recommendation'
          )
      )
    THEN
      RETURN 'zalo_remarketing_customers';
    END IF;
    RETURN NULL;
  END IF;

  -- No explicit request: preserve the durable v190 derivation behavior.
  IF p_dataset_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_account_contacts_dataset AS dataset
    JOIN public.auto_account_contacts_dataset_members AS dataset_member
      ON dataset_member.dataset_id = dataset.id
    WHERE dataset.id = p_dataset_id
      AND dataset.account_id = v_effective_account_id
      AND dataset.staff_id = v_contact.staff_id
      AND dataset.organization_id = v_contact.organization_id
      AND dataset.scan_type = 'zalo_group_members'
      AND dataset.source = 'scan'
      AND dataset.is_delete = false
      AND dataset_member.contact_id = v_contact.id
      AND dataset_member.is_current = true
  ) THEN
    RETURN 'zalo_group_members';
  END IF;

  v_declared_kind := lower(btrim(COALESCE(
    v_row_extra ->> 'relationshipKind',
    v_row_extra ->> 'relationship_kind',
    v_contact.extra_data ->> 'relationshipKind',
    v_contact.extra_data ->> 'relationship_kind',
    ''
  )));
  v_source_marker := lower(btrim(COALESCE(
    v_row_extra ->> 'source',
    v_contact.extra_data ->> 'source',
    ''
  )));

  IF v_declared_kind = 'zalo_remarketing_customers'
    OR v_source_marker = 'zalo_remarketing_customers'
  THEN
    v_campaign_id_text := btrim(COALESCE(
      v_row_extra ->> 'latestCampaignId',
      v_row_extra ->> 'latest_campaign_id',
      v_row_extra ->> 'sourceCampaignId',
      v_row_extra ->> 'source_campaign_id',
      v_contact.extra_data ->> 'latestCampaignId',
      v_contact.extra_data ->> 'latest_campaign_id',
      v_contact.extra_data ->> 'sourceCampaignId',
      v_contact.extra_data ->> 'source_campaign_id',
      ''
    ));
    IF v_campaign_id_text ~ '^[1-9][0-9]{0,17}$'
      AND EXISTS (
        SELECT 1
        FROM public.auto_campaigns AS campaign
        WHERE campaign.id = v_campaign_id_text::bigint
          AND campaign.account_id = v_effective_account_id
          AND campaign.staff_id = v_contact.staff_id
          AND campaign.organization_id = v_contact.organization_id
          AND campaign.action_id IN (
            'zalo_message_phone',
            'zalo_message_friend',
            'zalo_message_group_member',
            'zalo_message_group_realtime',
            'zalo_message_friend_recommendation'
          )
      )
    THEN
      RETURN 'zalo_remarketing_customers';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.zalo_group_members AS relation
    WHERE relation.account_id = v_effective_account_id
      AND relation.zalo_uid = v_contact.uid
      AND relation.is_current = true
      AND (
        relation.staff_id IS NULL
        OR relation.staff_id = v_contact.staff_id
      )
      AND (
        relation.organization_id IS NULL
        OR relation.organization_id = v_contact.organization_id
      )
  ) THEN
    RETURN 'zalo_group_members';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_derive_data_group_relationship_kind(
  p_membership_id bigint,
  p_source_account_id bigint,
  p_dataset_id bigint
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.aka_agent_validate_data_group_relationship_kind(
    p_membership_id,
    p_source_account_id,
    p_dataset_id,
    NULL,
    '{}'::jsonb
  );
$$;

-- Patch the preserved implementation at the only point where it still owns
-- the current row payload. pg_get_functiondef preserves all v186 behavior;
-- strict occurrence assertions make upstream drift fail the migration.
DO $patch_v186_ingest$
DECLARE
  v_definition text;
  v_old_columns text := $old$
      source_name_snapshot, is_current, created_at, updated_at
$old$;
  v_new_columns text := $new$
      source_name_snapshot, relationship_kind, is_current, created_at, updated_at
$new$;
  v_old_values text := $old$
      COALESCE(NULLIF(btrim(COALESCE(p_source_name, '')), ''), v_source_account.name),
      CASE
$old$;
  v_new_values text := $new$
      COALESCE(NULLIF(btrim(COALESCE(p_source_name, '')), ''), v_source_account.name),
      public.aka_agent_validate_data_group_relationship_kind(
        v_member.id,
        COALESCE(v_row_account_id, v_contact.account_id),
        v_dataset.id,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN COALESCE(
              v_row.payload -> 'extra_data' ->> 'relationshipKind',
              v_row.payload -> 'extra_data' ->> 'relationship_kind'
            )
          ELSE NULL
        END,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN v_row.payload -> 'extra_data'
          ELSE '{}'::jsonb
        END
      ),
      CASE
$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(routine.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = pg_catalog.to_regprocedure(
    'public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
  );

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'missing_v186_data_group_ingest';
  END IF;

  IF pg_catalog.strpos(
    v_definition, 'aka_agent_validate_data_group_relationship_kind'
  ) > 0 THEN
    RETURN;
  END IF;

  IF (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_columns, ''))
  ) <> pg_catalog.length(v_old_columns)
  THEN
    RAISE EXCEPTION 'unexpected_v186_ingest_origin_column_shape';
  END IF;
  IF (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_values, ''))
  ) <> pg_catalog.length(v_old_values)
  THEN
    RAISE EXCEPTION 'unexpected_v186_ingest_origin_value_shape';
  END IF;

  v_definition := pg_catalog.replace(
    v_definition, v_old_columns, v_new_columns
  );
  v_definition := pg_catalog.replace(
    v_definition, v_old_values, v_new_values
  );
  EXECUTE v_definition;
END;
$patch_v186_ingest$;

-- Keep the public arity and transformed request hash from v190, but remove the
-- ambiguous session-wide hint array. The patched v186 loop now validates the
-- projected relationshipKind against each exact row.
CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_group_id bigint,
  p_kind text,
  p_rows jsonb,
  p_dataset_id bigint DEFAULT NULL,
  p_dataset_name text DEFAULT NULL,
  p_import_source text DEFAULT NULL,
  p_source_account_id bigint DEFAULT NULL,
  p_source_name text DEFAULT NULL,
  p_payload_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(row_value.value) = 'object'
        AND row_value.value ->> 'relationship_kind' IN (
          'zalo_group_members', 'zalo_remarketing_customers'
        )
      THEN jsonb_set(
        row_value.value - 'relationship_kind',
        '{extra_data}',
        CASE
          WHEN jsonb_typeof(row_value.value -> 'extra_data') = 'object'
            THEN row_value.value -> 'extra_data'
          ELSE '{}'::jsonb
        END || jsonb_build_object(
          'relationshipKind', row_value.value ->> 'relationship_kind'
        ),
        true
      )
      ELSE row_value.value
    END
    ORDER BY row_value.ordinality
  ), '[]'::jsonb)
  INTO v_rows
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
    WITH ORDINALITY AS row_value(value, ordinality);

  RETURN public.aka_agent_ingest_data_group_v186_internal(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_group_id,
    p_kind,
    v_rows,
    p_dataset_id,
    p_dataset_name,
    p_import_source,
    p_source_account_id,
    p_source_name,
    p_payload_hash
  );
END;
$$;

-- Copy and move must preserve both exact origins when the same membership has
-- both relationship kinds. The trigger is only a derivation fallback; it
-- cannot reconstruct two distinct source origins after the fact.
DO $patch_origin_copies$
DECLARE
  v_signature text;
  v_definition text;
  v_old_columns text :=
    'source_name_snapshot, is_current, created_at, updated_at';
  v_new_columns text :=
    'source_name_snapshot, relationship_kind, is_current, created_at, updated_at';
  v_old_values text :=
    'origin.source_name_snapshot, true, now(), now()';
  v_new_values text :=
    'origin.source_name_snapshot, origin.relationship_kind, true, now(), now()';
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)',
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)'
  ] LOOP
    SELECT pg_catalog.pg_get_functiondef(routine.oid)
    INTO v_definition
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(v_signature);

    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'missing_data_group_origin_copy: %', v_signature;
    END IF;

    IF pg_catalog.strpos(v_definition, 'origin.relationship_kind') > 0 THEN
      CONTINUE;
    END IF;

    IF (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_columns, ''))
    ) <> pg_catalog.length(v_old_columns)
    THEN
      RAISE EXCEPTION 'unexpected_origin_copy_column_shape: %', v_signature;
    END IF;
    IF (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_values, ''))
    ) <> pg_catalog.length(v_old_values)
    THEN
      RAISE EXCEPTION 'unexpected_origin_copy_value_shape: %', v_signature;
    END IF;

    v_definition := pg_catalog.replace(
      v_definition, v_old_columns, v_new_columns
    );
    v_definition := pg_catalog.replace(
      v_definition, v_old_values, v_new_values
    );
    EXECUTE v_definition;
  END LOOP;
END;
$patch_origin_copies$;

-- ---------------------------------------------------------------------------
-- 5. Surface the exact relationship on each provenance object.
-- ---------------------------------------------------------------------------

DO $patch_member_provenance$
DECLARE
  v_definition text;
  v_old text := $old$
        'kind', origin.kind,
        'dataset_id', origin.dataset_id,
$old$;
  v_new text := $new$
        'kind', origin.kind,
        'relationship_kind', origin.relationship_kind,
        'dataset_id', origin.dataset_id,
$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(routine.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'
  );

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'missing_data_group_member_list_implementation';
  END IF;

  IF pg_catalog.strpos(
    v_definition, '''relationship_kind'', origin.relationship_kind'
  ) = 0 THEN
    IF (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) <> pg_catalog.length(v_old)
    THEN
      RAISE EXCEPTION 'unexpected_data_group_member_provenance_shape';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_member_provenance$;

COMMENT ON COLUMN public.auto_campaign_creation_bundles.data_group_id IS
  'Single Data Group shared by every child source in this creation bundle.';
COMMENT ON COLUMN public.auto_campaign_creation_bundles.baseline_revision IS
  'Group revision atomically baselined by every child when the bundle became ready.';
COMMENT ON FUNCTION public.aka_agent_internal_route_data_group_member(
  bigint, bigint, bigint, bigint
) IS
  'Internal v193 staged-bundle intake gate; delegates exact relationship checks to v190.';
COMMENT ON FUNCTION public.aka_agent_validate_data_group_relationship_kind(
  bigint, bigint, bigint, text, jsonb
) IS
  'Internal exact-row validator for account-bound Data Group relationship provenance.';
COMMENT ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) IS
  'Service-role ingest entrypoint; validates top-level relationship_kind per exact input row.';

-- Trigger helpers and preserved implementations are never Data API entrypoints.
REVOKE ALL ON FUNCTION public.aka_agent_guard_campaign_creation_bundle_group()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_guard_campaign_creation_bundle_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_validate_data_group_relationship_kind(
  bigint, bigint, bigint, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_derive_data_group_relationship_kind(
  bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member(
  bigint, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member_v190_internal(
  bigint, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member_v186_internal(
  bigint, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_ingest_data_group_v186_internal(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Service-only implementations plus their existing authenticated wrappers.
REVOKE ALL ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text,
  text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text,
  text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_data_group_members(
  bigint, bigint, bigint, text, bigint[], boolean, text[], text[], text,
  bigint[], bigint[], bigint[], integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_data_group_members(
  bigint, bigint, bigint, text, bigint[], boolean, text[], text[], text,
  bigint[], bigint[], bigint[], integer, integer
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_list_data_group_members(
  bigint, bigint, bigint, text, bigint[], boolean, text[], text[], text,
  bigint[], bigint[], bigint[], integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_data_group_members(
  bigint, bigint, bigint, text, bigint[], boolean, text[], text[], text,
  bigint[], bigint[], bigint[], integer, integer, text, text
) TO anon, authenticated, service_role;

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

NOTIFY pgrst, 'reload schema';

COMMIT;
