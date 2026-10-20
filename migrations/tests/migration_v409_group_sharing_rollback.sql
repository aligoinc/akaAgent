-- Run after rolling clients back. Retains copies, snapshots and sharing metadata.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)'))) IS DISTINCT FROM 'bf41a97876e47339e87545914e01bc1e' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'))) IS DISTINCT FROM '2ad6c67e8bcaf7267aaa1fecf25b4415' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'))) IS DISTINCT FROM 'efa9c1cfc197ec4d6fd7d61713a146a8' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'))) IS DISTINCT FROM '8d21e65d5e2a518afd71a9944258b818' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint)'))) IS DISTINCT FROM '77e3d34f6abe5bfb2803a138c5daf715' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_preview_data_group_campaign_targets(bigint,bigint,bigint,text,bigint[])'))) IS DISTINCT FROM '7617681f6baf14b768885934aa6f2e1e' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_preview_data_group_campaign_targets(bigint,bigint,bigint,text,bigint[]) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)'))) IS DISTINCT FROM '9f4db1d1c78dfe0e1b00e37678e5852e' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'))) IS DISTINCT FROM '204efa3c945d032b72d12ca700498a33' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text) changed after V409'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'))) IS DISTINCT FROM 'aa9006241ecdb9a8bb4fccd4a868dc67' THEN RAISE EXCEPTION 'Rollback blocked: aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text) changed after V409'; END IF;
END; $guard$;
DO $stop$ DECLARE g record; s record; BEGIN
      FOR g IN SELECT DISTINCT cg.id FROM public.auto_account_contact_groups cg JOIN public.auto_campaign_data_group_sources src ON src.group_id=cg.id
        WHERE src.staff_id<>cg.staff_id AND src.status IN ('active','baselining') ORDER BY cg.id LOOP
        PERFORM id FROM public.auto_account_contact_groups WHERE id=g.id FOR UPDATE;
        FOR s IN SELECT src.id,src.campaign_id FROM public.auto_campaign_data_group_sources src JOIN public.auto_account_contact_groups cg ON cg.id=src.group_id
          WHERE cg.id=g.id AND src.staff_id<>cg.staff_id AND src.status IN ('active','baselining') ORDER BY src.campaign_id,src.id LOOP
          PERFORM public.aka_agent_lock_campaign_input_serialization(s.campaign_id);
          UPDATE public.auto_campaign_data_group_sources SET status='stopped',stop_reason='sharing_revoked',stopped_at=now(),updated_at=now() WHERE id=s.id;
        END LOOP;
      END LOOP;
    END; $stop$;
CREATE OR REPLACE FUNCTION public.aka_agent_bind_campaign_data_group_source(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_campaign_id bigint, p_group_id bigint, p_bundle_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
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
  v_serialized_campaign_id bigint;
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

    FOR v_serialized_campaign_id IN
      SELECT campaign.id
      FROM public.auto_campaigns AS campaign
      WHERE campaign.creation_bundle_id = p_bundle_id
      ORDER BY campaign.id
    LOOP
      PERFORM public.aka_agent_lock_campaign_input_serialization(
        v_serialized_campaign_id
      );
    END LOOP;

    -- The bundle lock prevents new FK references while every existing child
    -- and source is locked in one deterministic order.
    PERFORM campaign.id
    FROM public.auto_campaigns AS campaign
    WHERE campaign.creation_bundle_id = p_bundle_id
    ORDER BY campaign.creation_bundle_child_index NULLS LAST, campaign.id
    FOR UPDATE OF campaign;

    -- Binding the last child activates the whole bundle, so ownership of every
    -- child account is locked and revalidated rather than only the requested
    -- child. The bundle row above prevents a new child from joining this set.
    PERFORM account.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.creation_bundle_id = p_bundle_id
    ORDER BY account.id
    FOR UPDATE OF account;

    IF EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      LEFT JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      WHERE campaign.creation_bundle_id = p_bundle_id
        AND (
          account.id IS NULL
          OR account.staff_id IS DISTINCT FROM p_staff_id
          OR NOT (
            account.organization_id IS NULL
            OR account.organization_id = p_organization_id
          )
          OR COALESCE(account.is_delete, false)
          OR NOT (
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
                  AND COALESCE(account.is_active, true) = true
                )
              )
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'data_group_campaign_account_not_found';
    END IF;

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
    PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

    SELECT campaign.*
    INTO v_campaign
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
    FOR UPDATE;
  END IF;

  IF p_bundle_id IS NULL AND v_campaign.id IS NOT NULL THEN
    PERFORM account.id
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
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
              AND COALESCE(account.is_active, true) = true
            )
          )
        )
      )
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'data_group_campaign_account_not_found';
    END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_reactivate_campaign_data_group_source(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_request_id text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_hash text;
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_data_group_source_request';
  END IF;

  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_not_found'; END IF;
  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_source.group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  -- Reactivation routes the existing group snapshot after locking campaign and
  -- source rows. Join the common campaign/input barrier before either of those
  -- row locks so the nested legacy router can re-enter it without inversion.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
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
              AND COALESCE(account.is_active, true) = true
            )
          )
        )
      )
  FOR UPDATE OF campaign, account;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.data_group_id IS DISTINCT FROM v_source.group_id
    OR v_campaign.data_target_source_mode <> 'data_group'
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now()) THEN
    RAISE EXCEPTION 'data_group_campaign_terminal';
  END IF;
  -- Re-lock in the shared group -> campaign -> source order used by bind and
  -- intake, then verify the optimistic source read did not change underneath.
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = v_source.id
    AND source.campaign_id = p_campaign_id
    AND source.group_id = v_group.id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_changed'; END IF;
  IF v_source.status <> 'stopped' THEN RETURN to_jsonb(v_source); END IF;

  v_hash := md5(jsonb_build_object(
    'operation', 'reactivate_source', 'campaignId', p_campaign_id,
    'groupId', v_source.group_id
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'reactivate_source', v_source.group_id, v_hash,
    'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'reactivate_source' OR v_batch.request_hash <> v_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'baselining', stopped_at = NULL, stop_reason = NULL, updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  PERFORM public.aka_agent_internal_route_group_snapshot(
    v_source.id, v_batch.id, v_group.revision
  );
  UPDATE public.auto_campaign_data_group_sources
  SET status = 'active', baseline_revision = v_group.revision,
      started_at = COALESCE(started_at, now()), last_ingest_at = now(), updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  UPDATE public.auto_campaigns
  SET status = CASE WHEN status = 'hoàn thành' THEN 'chờ xử lý' ELSE status END,
      completed_at = CASE WHEN status = 'hoàn thành' THEN NULL ELSE completed_at END,
      note = CASE WHEN status = 'hoàn thành' THEN 'Chờ data mới' ELSE note END,
      updated_at = now()
  WHERE id = v_campaign.id;
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;
  RETURN to_jsonb(v_source);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_campaign_id bigint, p_group_id bigint, p_campaign_schedule timestamp with time zone, p_campaign_status text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_action_id text;
  v_completed_result jsonb;
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  -- Preserve the pre-v206 retry contract: a committed request returns its
  -- immutable result even if the group/account subtype changed afterward.
  -- No campaign/input mutation occurs on this branch.
  SELECT batch.result
  INTO v_completed_result
  FROM public.auto_data_ingest_batches AS batch
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = btrim(COALESCE(p_request_id, ''))
    AND batch.operation = 'snapshot_campaign'
    AND batch.group_id = p_group_id
    AND batch.result IS NOT NULL;

  IF v_completed_result IS NULL THEN
    SELECT campaign.action_id
    INTO v_action_id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = p_group_id
     AND contact_group.staff_id = p_staff_id
     AND contact_group.organization_id = p_organization_id
     AND contact_group.purpose = 'data_group'
     AND contact_group.is_delete = false
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false;

    IF v_action_id IS NOT NULL
      AND NOT public.aka_agent_data_group_type_compatible(
        p_group_id, v_action_id
      )
    THEN
      RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
    END IF;
  END IF;

  -- The desktop app is a tenant control surface for both runtime owners. Route
  -- this DB-only provisioning mutation by the persisted account subtype, then
  -- let the core repeat the proof under its campaign/account locks.
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
    v_result := public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
      p_staff_id,
      p_organization_id,
      p_request_id,
      p_campaign_id,
      p_group_id,
      p_campaign_schedule,
      p_campaign_status,
      p_auth_username,
      p_auth_password
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
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_campaign_id bigint, p_group_id bigint, p_campaign_schedule timestamp with time zone, p_campaign_status text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_action text;
  v_platform text;
  v_contact_type text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_input_uid text;
  v_input_phone text;
  v_input_email text;
  v_target_value text;
  v_identity_value text;
  v_uid_identity text;
  v_url_identity text;
  v_allow_alias_resolution boolean;
  v_target_kind text;
  v_scope text;
  v_candidate_key text;
  v_canonical_key text;
  v_aliases text[];
  v_mapped_keys text[];
  v_payload jsonb;
  v_input_id bigint;
  v_inserted_row boolean;
  v_info1 text;
  v_info2 text;
  v_info3 text;
  v_info4 text;
  v_info5 text;
  v_phone_carrier text;
  v_request_hash text;
  v_result jsonb;
  v_active integer := 0;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_account_runtime_target text;
  v_runtime_target text := lower(btrim(COALESCE(
    NULLIF(current_setting('aka_agent.zalo_runtime_target', true), ''),
    'desktop'
  )));
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_group_id IS NULL OR p_group_id <= 0
    OR p_campaign_schedule IS NULL
    OR p_campaign_status IS NULL
    OR p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng')
    OR NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_direct_campaign_group_snapshot';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'snapshot_campaign',
    'campaignId', p_campaign_id,
    'groupId', p_group_id,
    'campaignSchedule', to_char(
      p_campaign_schedule AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US'
    ),
    'campaignStatus', p_campaign_status
  )::text);

  -- Return a committed response before consulting mutable campaign/group state.
  -- This makes response-loss retries stable even if the group changes later.
  SELECT batch.*
  INTO v_batch
  FROM public.auto_data_ingest_batches AS batch
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = btrim(p_request_id)
  FOR UPDATE;
  IF FOUND THEN
    IF v_batch.operation <> 'snapshot_campaign'
      OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  -- Match the shared Data Group lock hierarchy (group -> campaign) used by
  -- ingest/bind/delete; do not invert those locks during live intake.
  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  -- Keep the shared Data Group hierarchy: batch -> group -> barrier ->
  -- campaign -> account/input. Bind/reactivate/router paths take the same
  -- group-before-barrier order.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;
  IF v_campaign.data_target_source_mode IS DISTINCT FROM 'direct'
    OR v_campaign.provisioning_state IS DISTINCT FROM 'ready'
    OR v_campaign.status = 'đang chạy'
    OR EXISTS (
      SELECT 1
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.campaign_id = v_campaign.id
    )
  THEN
    RAISE EXCEPTION 'campaign_not_direct_snapshot_eligible';
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
    FROM public.auto_campaign_actions AS action
    WHERE action.id = v_campaign.action_id
      AND action.is_active = true
      AND COALESCE(action.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'campaign_action_inactive';
  END IF;
  -- Campaign is already locked above. Lock account second so campaign claims
  -- and subtype conversion cannot race this runtime ownership decision.
  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_account_runtime_target
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_account_not_found';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server')
    OR v_runtime_target IS DISTINCT FROM v_account_runtime_target
  THEN
    RAISE EXCEPTION 'direct_campaign_runtime_not_owner';
  END IF;

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, source_name, request_hash,
    status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'snapshot_campaign', v_group.id, 'manual',
    'Snapshot Nhóm data: ' || v_group.name, v_request_hash,
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
    IF v_batch.operation <> 'snapshot_campaign'
      OR v_batch.group_id IS DISTINCT FROM v_group.id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  v_action := btrim(COALESCE(v_campaign.action_id, ''));

  FOR v_member IN
    SELECT member.*
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id
      AND member.is_delete = false
    ORDER BY member.id
  LOOP
    v_active := v_active + 1;
    v_input_uid := NULL;
    v_input_phone := NULL;
    v_input_email := NULL;
    v_target_value := NULL;
    v_identity_value := NULL;
    v_uid_identity := NULL;
    v_url_identity := NULL;
    v_target_kind := NULL;
    v_scope := NULL;
    v_candidate_key := NULL;
    v_canonical_key := NULL;
    v_aliases := '{}'::text[];
    v_mapped_keys := '{}'::text[];
    v_allow_alias_resolution := false;
    v_input_id := NULL;
    v_inserted_row := false;

    IF NOT (
      -- v228: valid-phone routes ignore all source semantic and contact
      -- metadata constraints; UID-only add-member still uses the old guard.
      v_action IN ('zalo_message_phone', 'zalo_add_group_member')
      AND public.aka_agent_data_group_membership_has_valid_phone(
        v_member.id, v_group.id
      )
    ) AND NOT public.aka_agent_data_group_membership_semantic_compatible(
      v_member.id, v_action, v_group.id
    ) THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;

    SELECT contact.*
    INTO v_contact
    FROM public.auto_account_contacts AS contact
    WHERE contact.id = v_member.contact_id
      AND contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND COALESCE(contact.is_delete, false) = false;
    IF NOT FOUND THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;

    v_platform := lower(btrim(COALESCE(v_contact.flatform_type, '')));
    v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
    v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
    v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
    v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
    v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
      NULLIF(v_contact.phone, ''),
      NULLIF(v_contact.extra_data ->> 'phone', ''),
      CASE WHEN v_contact_type = 'phone' THEN v_contact.uid ELSE NULL END,
      ''
    ));
    v_phone := NULLIF(v_phone, '');
    v_email := NULLIF(lower(btrim(COALESCE(
      NULLIF(v_contact.email, ''),
      NULLIF(v_contact.extra_data ->> 'email', ''),
      CASE WHEN v_contact_type = 'email' THEN v_contact.uid ELSE NULL END,
      ''
    ))), '');
    IF v_email IS NOT NULL AND (
      v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR length(v_email) > 254
    ) THEN
      v_email := NULL;
    END IF;
    v_info1 := NULLIF(v_contact.extra_data ->> 'info1', '');
    v_info2 := NULLIF(v_contact.extra_data ->> 'info2', '');
    v_info3 := NULLIF(v_contact.extra_data ->> 'info3', '');
    v_info4 := NULLIF(v_contact.extra_data ->> 'info4', '');
    v_info5 := NULLIF(v_contact.extra_data ->> 'info5', '');
    v_phone_carrier := COALESCE(
      NULLIF(v_contact.extra_data ->> 'phoneCarrier', ''),
      NULLIF(v_contact.extra_data ->> 'phone_carrier', '')
    );

    IF v_action IN ('facebook_group_post', 'facebook_join_group', 'facebook_find_data_group') THEN
      -- v227: snapshot Facebook routes use semantic type plus UID/URL only.
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_group'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_message_uid' THEN
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_find_data_search' THEN
      v_target_value := v_uid;
      v_target_kind := 'facebook_search'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action IN ('facebook_comment_seeding', 'facebook_comment_seeding_post') THEN
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := CASE WHEN v_action = 'facebook_comment_seeding_post'
        THEN 'facebook_post' ELSE 'facebook_comment_target' END;
      v_scope := 'portable'; v_input_uid := v_target_value;
    ELSIF v_action = 'zalo_message_phone' THEN
      IF v_phone IS NULL THEN v_incompatible := v_incompatible + 1; CONTINUE; END IF;
      v_target_value := v_phone; v_target_kind := 'phone'; v_scope := 'portable';
      v_input_phone := v_phone;
    ELSIF v_action = 'zalo_join_group_link' THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'group' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'zalo_group_link'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'email_send' THEN
      IF v_email IS NULL THEN v_incompatible := v_incompatible + 1; CONTINUE; END IF;
      v_target_value := v_email; v_target_kind := 'email'; v_scope := 'portable';
      v_input_email := v_email;
    ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
      -- v226: Facebook UID/URL targets do not inherit source-account or
      -- is_friend restrictions from scan metadata.
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_page_post' THEN
      -- v226: Page ID/URL validity is sufficient for a Facebook target.
      v_target_value := COALESCE(v_uid, v_url);
      v_target_kind := 'facebook_page';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action IN (
      'zalo_message_friend', 'zalo_message_group_member',
      'zalo_message_remarketing_customer'
    ) THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'person'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR (v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true)
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := v_uid; v_target_kind := 'zalo_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSIF v_action = 'zalo_message_group' THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'group'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR v_contact.is_joined IS DISTINCT FROM true
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := v_uid; v_target_kind := 'zalo_group';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSIF v_action = 'zalo_add_group_member' THEN
      IF v_phone IS NOT NULL THEN
        v_target_value := v_phone; v_target_kind := 'phone'; v_scope := 'portable';
        v_input_phone := v_phone; v_input_uid := '';
      ELSIF v_platform = 'zalo' AND v_contact_type = 'person'
        AND v_uid IS NOT NULL
        AND v_contact.account_id IS NOT DISTINCT FROM v_campaign.account_id
      THEN
        v_target_value := v_uid; v_target_kind := 'zalo_person';
        v_scope := 'bound:' || v_campaign.account_id::text;
        v_input_uid := v_uid;
      ELSE
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
    ELSE
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    IF NULLIF(v_target_value, '') IS NULL THEN
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    IF v_target_kind LIKE 'facebook_%' THEN
      v_uid_identity := CASE WHEN v_uid IS NULL THEN NULL
        ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_uid), '') END;
      v_url_identity := CASE WHEN v_url IS NULL THEN NULL
        ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_url), '') END;
      v_identity_value := COALESCE(
        v_uid_identity,
        v_url_identity,
        NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_target_value), '')
      );
      v_allow_alias_resolution := true;
    ELSIF v_target_kind = 'email' THEN
      v_identity_value := lower(v_target_value);
    ELSE
      v_identity_value := v_target_value;
    END IF;
    IF NULLIF(v_identity_value, '') IS NULL THEN
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    v_candidate_key := v_scope || ':' || v_target_kind || ':' || v_identity_value;
    v_aliases := array_append(v_aliases, v_candidate_key);
    IF v_target_kind LIKE 'facebook_%' AND v_uid_identity IS NOT NULL THEN
      v_aliases := array_append(
        v_aliases, v_scope || ':' || v_target_kind || ':' || v_uid_identity
      );
    END IF;
    IF v_target_kind LIKE 'facebook_%' AND v_url_identity IS NOT NULL THEN
      v_aliases := array_append(
        v_aliases, v_scope || ':' || v_target_kind || ':' || v_url_identity
      );
    END IF;

    SELECT COALESCE(array_agg(DISTINCT alias.canonical_target_key), '{}'::text[])
    INTO v_mapped_keys
    FROM public.auto_campaign_input_target_aliases AS alias
    WHERE alias.campaign_id = v_campaign.id
      AND alias.alias_key = ANY(v_aliases);

    IF cardinality(v_mapped_keys) > 1
      OR (
        cardinality(v_mapped_keys) = 1
        AND NOT v_allow_alias_resolution
        AND v_mapped_keys[1] IS DISTINCT FROM v_candidate_key
      )
    THEN
      UPDATE public.auto_campaign_input_target_aliases AS alias
      SET conflict_count = alias.conflict_count + 1,
          last_conflict_at = now(),
          last_conflict_payload = jsonb_build_object(
            'membershipId', v_member.id,
            'candidateCanonicalKey', v_candidate_key,
            'mappedCanonicalKeys', to_jsonb(v_mapped_keys),
            'aliases', to_jsonb(v_aliases),
            'snapshotBatchId', v_batch.id
          ),
          updated_at = now()
      WHERE alias.campaign_id = v_campaign.id
        AND alias.alias_key = ANY(v_aliases);
      v_conflict := v_conflict + 1;
      CONTINUE;
    END IF;

    v_canonical_key := CASE
      WHEN v_allow_alias_resolution AND cardinality(v_mapped_keys) = 1
        THEN v_mapped_keys[1]
      ELSE v_candidate_key
    END;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', COALESCE(v_name, v_target_value),
      'phone', v_input_phone,
      'phone_carrier', v_phone_carrier,
      'uid', v_input_uid,
      'email', v_input_email,
      'info1', v_info1,
      'info2', v_info2,
      'info3', v_info3,
      'info4', v_info4,
      'info5', v_info5,
      'contact_id', v_contact.id,
      'membership_id', v_member.id,
      'source_account_id', v_contact.account_id,
      'contact_type', v_contact.contact_type,
      'flatform_type', v_contact.flatform_type,
      'canonical_target_key', v_canonical_key,
      'snapshot_group_id', v_group.id,
      'snapshot_group_revision', v_group.revision
    ));

    -- Reuse order for one-time snapshots:
    --   1. the active canonical row;
    --   2. an active row already mapped by one of this target's aliases;
    --   3. the oldest active legacy row whose action target normalizes equally;
    --   4. a newly inserted canonical row.
    -- Legacy rows remain canonical_target_key=NULL.  Aliases and immutable
    -- origin provenance below make every later snapshot resolve to that row.
    SELECT input_data.id
    INTO v_input_id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND input_data.canonical_target_key = v_canonical_key
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    LIMIT 1
    FOR UPDATE;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_target_aliases AS alias
      JOIN public.auto_campaign_input_data AS input_data
        ON input_data.id = alias.input_data_id
       AND input_data.campaign_id = v_campaign.id
       AND COALESCE(input_data.is_delete, false) = false
       AND (
         input_data.canonical_target_key IS NULL
         OR input_data.canonical_target_key = v_canonical_key
       )
      WHERE alias.campaign_id = v_campaign.id
        AND alias.canonical_target_key = v_canonical_key
        AND alias.alias_key = ANY(v_aliases)
      ORDER BY input_data.id
      LIMIT 1
      FOR UPDATE OF input_data;
    END IF;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_campaign.id
        AND input_data.canonical_target_key IS NULL
        AND COALESCE(input_data.is_delete, false) = false
        AND CASE
          WHEN v_target_kind = 'phone' THEN
            public.aka_agent_internal_normalize_phone(
              COALESCE(input_data.phone, '')
            ) = v_identity_value
          WHEN v_target_kind = 'email' THEN
            lower(btrim(COALESCE(input_data.email, ''))) = v_identity_value
          WHEN v_target_kind LIKE 'facebook_%' THEN
            (
              v_scope || ':' || v_target_kind || ':' ||
              public.aka_agent_internal_normalize_facebook_identity(
                COALESCE(input_data.uid, '')
              )
            ) = ANY(v_aliases)
          ELSE
            btrim(COALESCE(input_data.uid, '')) = v_identity_value
        END
      ORDER BY input_data.id
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_input_id IS NULL THEN
      INSERT INTO public.auto_campaign_input_data (
        campaign_id, input_id, name, phone, phone_carrier, uid, email,
        info1, info2, info3, info4, info5, status, schedule, is_delete,
        canonical_target_key, created_at
      ) VALUES (
        v_campaign.id, NULL, COALESCE(v_name, v_target_value),
        v_input_phone, v_phone_carrier, v_input_uid, v_input_email,
        v_info1, v_info2, v_info3, v_info4, v_info5,
        'chờ xử lý', p_campaign_schedule, false,
        v_canonical_key, now()
      )
      ON CONFLICT (campaign_id, canonical_target_key)
        WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false
      DO NOTHING
      RETURNING id INTO v_input_id;

      IF v_input_id IS NULL THEN
        SELECT input_data.id
        INTO v_input_id
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND input_data.canonical_target_key = v_canonical_key
          AND COALESCE(input_data.is_delete, false) = false
        FOR UPDATE;
      ELSE
        v_inserted_row := true;
      END IF;
    END IF;

    INSERT INTO public.auto_campaign_input_target_aliases (
      campaign_id, alias_key, canonical_target_key, input_data_id
    )
    SELECT v_campaign.id, candidate.alias_key, v_canonical_key, v_input_id
    FROM (SELECT DISTINCT unnest(v_aliases) AS alias_key) AS candidate
    ON CONFLICT (campaign_id, alias_key) DO UPDATE
    SET input_data_id = EXCLUDED.input_data_id,
        updated_at = now()
    WHERE auto_campaign_input_target_aliases.canonical_target_key
      = EXCLUDED.canonical_target_key;

    INSERT INTO public.auto_campaign_input_origins (
      input_data_id, source_id, group_id, membership_id, batch_id,
      origin_kind, group_revision, canonical_target_key, payload_snapshot
    ) VALUES (
      v_input_id, NULL, v_group.id, v_member.id, v_batch.id,
      'group', v_group.revision, v_canonical_key, v_payload
    ) ON CONFLICT DO NOTHING;

    IF v_inserted_row THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_existing := v_existing + 1;
    END IF;
  END LOOP;

  IF v_inserted > 0 THEN
    UPDATE public.auto_campaigns AS campaign
    SET schedule = p_campaign_schedule,
        original_schedule = p_campaign_schedule,
        status = p_campaign_status,
        note = CASE
          WHEN campaign.note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
          ELSE campaign.note
        END,
        updated_at = now()
    WHERE campaign.id = v_campaign.id;
  END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'campaign_id', v_campaign.id,
    'group_id', v_group.id,
    'group_revision', v_group.revision,
    'active_membership_count', v_active,
    'inserted_count', v_inserted,
    'already_seen_count', v_existing,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict
  );

  UPDATE public.auto_data_ingest_batches AS batch
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE batch.id = v_batch.id;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_preflight_campaign_data_group_change(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_group_id bigint)
 RETURNS TABLE(allowed boolean, reason text, canonical_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
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
  canonical_count := 0;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false) THEN
    allowed := false;
    reason := 'data_group_campaign_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Ownership precedes every early-return branch, including `unchanged`, so a
  -- service caller cannot reuse a source after its Zalo account becomes local.
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
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
              AND COALESCE(account.is_active, true) = true
            )
          )
        )
      )
  ) THEN
    allowed := false;
    reason := 'data_group_campaign_account_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::bigint INTO canonical_count
  FROM public.auto_campaign_input_data AS input_row
  WHERE input_row.campaign_id = v_campaign.id
    AND input_row.canonical_target_key IS NOT NULL
    AND COALESCE(input_row.is_delete, false) = false;

  IF p_group_id IS NULL OR p_group_id <= 0 OR NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    allowed := false;
    reason := 'data_group_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.data_group_id IS NOT DISTINCT FROM p_group_id
  THEN
    allowed := true;
    reason := 'unchanged';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.status IN ('đang chạy', 'hoàn thành')
    OR (v_campaign.schedule_end_date IS NOT NULL
      AND v_campaign.schedule_end_date <= now())
  THEN
    allowed := false;
    reason := 'data_group_campaign_not_bindable';
    RETURN NEXT;
    RETURN;
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
    allowed := false;
    reason := 'data_group_campaign_action_incompatible';
    RETURN NEXT;
    RETURN;
  END IF;
  IF canonical_count > 0 THEN
    allowed := false;
    reason := 'campaign_data_group_source_immutable_after_intake';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT source.* INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF FOUND AND v_source.bundle_id IS NOT NULL THEN
    allowed := false;
    reason := 'campaign_data_group_source_immutable';
    RETURN NEXT;
    RETURN;
  END IF;

  allowed := true;
  reason := 'allowed';
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_preview_data_group_campaign_targets(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_action_id text, p_account_ids bigint[])
 RETURNS TABLE(account_id bigint, active_membership_count bigint, compatible_membership_count bigint, valid_target_count bigint, incompatible_membership_count bigint, duplicate_target_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_action text := btrim(COALESCE(p_action_id, ''));
  v_requested_account_count integer;
  v_valid_account_count integer;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF p_group_id IS NULL OR p_group_id <= 0
    OR p_account_ids IS NULL
    OR cardinality(p_account_ids) NOT BETWEEN 1 AND 100
    OR EXISTS (
      SELECT 1 FROM unnest(p_account_ids) AS requested(id)
      WHERE requested.id IS NULL OR requested.id <= 0
    )
  THEN
    RAISE EXCEPTION 'invalid_data_group_campaign_preview';
  END IF;
  IF v_action NOT IN (
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
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;
  IF NOT public.aka_agent_data_group_type_compatible(p_group_id, v_action) THEN
    RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
  INTO v_requested_account_count
  FROM unnest(p_account_ids) AS requested(id);

  SELECT count(DISTINCT account.id)::integer
  INTO v_valid_account_count
  FROM unnest(p_account_ids) AS requested(id)
  JOIN public.auto_accounts AS account
    ON account.id = requested.id
  WHERE account.staff_id = p_staff_id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND COALESCE(account.is_delete, false) = false;
  IF v_valid_account_count IS DISTINCT FROM v_requested_account_count THEN
    RAISE EXCEPTION 'data_group_campaign_account_not_found';
  END IF;

  RETURN QUERY
  WITH requested_accounts AS (
    SELECT DISTINCT requested.id AS account_id
    FROM unnest(p_account_ids) AS requested(id)
  ), active_members AS (
    SELECT member.id AS membership_id
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = p_group_id
      AND member.is_delete = false
  ), routed AS (
    SELECT
      requested.account_id,
      member.membership_id,
      public.aka_agent_internal_preview_data_group_target_key(
        p_staff_id,
        p_organization_id,
        p_group_id,
        member.membership_id,
        v_action,
        requested.account_id
      ) AS target_key
    FROM requested_accounts AS requested
    LEFT JOIN active_members AS member ON true
  ), counts AS (
    SELECT
      routed.account_id,
      count(routed.membership_id)::bigint AS active_count,
      count(routed.membership_id) FILTER (
        WHERE routed.target_key IS NOT NULL
      )::bigint AS compatible_count,
      count(DISTINCT routed.target_key)::bigint AS target_count
    FROM routed
    GROUP BY routed.account_id
  )
  SELECT
    counts.account_id,
    counts.active_count,
    counts.compatible_count,
    counts.target_count,
    counts.active_count - counts.compatible_count,
    counts.compatible_count - counts.target_count
  FROM counts
  ORDER BY counts.account_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_preview_data_group_target_key(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_membership_id bigint, p_action_id text, p_account_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_contact public.auto_account_contacts%ROWTYPE;
  v_action text := btrim(COALESCE(p_action_id, ''));
  v_platform text;
  v_contact_type text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_target_value text;
  v_identity_value text;
  v_target_kind text;
  v_scope text;
BEGIN
  IF NOT (
    -- v228: preview applies the same valid-phone-only route as materialization.
    v_action IN ('zalo_message_phone', 'zalo_add_group_member')
    AND public.aka_agent_data_group_membership_has_valid_phone(
      p_membership_id, p_group_id
    )
  ) AND NOT public.aka_agent_data_group_membership_semantic_compatible(
    p_membership_id, v_action, p_group_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT contact.*
  INTO v_contact
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contacts AS contact
    ON contact.id = member.contact_id
  WHERE member.id = p_membership_id
    AND member.group_id = p_group_id
    AND member.is_delete = false
    AND contact.staff_id = p_staff_id
    AND contact.organization_id = p_organization_id
    AND COALESCE(contact.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_platform := lower(btrim(COALESCE(v_contact.flatform_type, '')));
  v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
  v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
  v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
  v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
    NULLIF(v_contact.phone, ''),
    NULLIF(v_contact.extra_data ->> 'phone', ''),
    CASE WHEN v_contact_type = 'phone' THEN v_contact.uid ELSE NULL END,
    ''
  )), '');
  v_email := NULLIF(lower(btrim(COALESCE(
    NULLIF(v_contact.email, ''),
    NULLIF(v_contact.extra_data ->> 'email', ''),
    CASE WHEN v_contact_type = 'email' THEN v_contact.uid ELSE NULL END,
    ''
  ))), '');
  IF v_email IS NOT NULL AND (
    v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(v_email) > 254
  ) THEN
    v_email := NULL;
  END IF;

  IF v_action IN (
    'facebook_group_post', 'facebook_join_group',
    'facebook_find_data_group'
  ) THEN
    -- v227: preview Facebook routes use semantic type plus UID/URL only.
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_group';
    v_scope := 'portable';
  ELSIF v_action = 'facebook_message_uid' THEN
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'portable';
  ELSIF v_action = 'facebook_find_data_search' THEN
    v_target_value := v_uid;
    v_target_kind := 'facebook_search';
    v_scope := 'portable';
  ELSIF v_action IN (
    'facebook_comment_seeding', 'facebook_comment_seeding_post'
  ) THEN
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := CASE
      WHEN v_action = 'facebook_comment_seeding_post' THEN 'facebook_post'
      ELSE 'facebook_comment_target'
    END;
    v_scope := 'portable';
  ELSIF v_action = 'zalo_message_phone' THEN
    IF v_phone IS NULL THEN
      RETURN NULL;
    END IF;
    v_target_value := v_phone;
    v_target_kind := 'phone';
    v_scope := 'portable';
  ELSIF v_action = 'zalo_join_group_link' THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'group' THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'zalo_group_link';
    v_scope := 'portable';
  ELSIF v_action = 'email_send' THEN
    IF v_email IS NULL THEN
      RETURN NULL;
    END IF;
    v_target_value := v_email;
    v_target_kind := 'email';
    v_scope := 'portable';
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    -- v226: preview follows the portable Facebook UID/URL route.
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'facebook_page_post' THEN
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action IN (
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer'
  ) THEN
    IF v_platform <> 'zalo'
      OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
      OR v_uid IS NULL
      OR (
        v_action = 'zalo_message_friend'
        AND v_contact.is_friend IS DISTINCT FROM true
      )
    THEN
      RETURN NULL;
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_person';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'zalo_message_group' THEN
    IF v_platform <> 'zalo'
      OR v_contact_type <> 'group'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
      OR v_contact.is_joined IS DISTINCT FROM true
    THEN
      RETURN NULL;
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_group';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'zalo_add_group_member' THEN
    IF v_phone IS NOT NULL THEN
      v_target_value := v_phone;
      v_target_kind := 'phone';
      v_scope := 'portable';
    ELSIF v_platform = 'zalo'
      AND v_contact_type = 'person'
      AND v_uid IS NOT NULL
      AND v_contact.account_id IS NOT DISTINCT FROM p_account_id
    THEN
      v_target_value := v_uid;
      v_target_kind := 'zalo_person';
      v_scope := 'bound:' || p_account_id::text;
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  IF NULLIF(v_target_value, '') IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_target_kind LIKE 'facebook_%' THEN
    v_identity_value := COALESCE(
      NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_uid), ''),
      NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_url), ''),
      NULLIF(
        public.aka_agent_internal_normalize_facebook_identity(v_target_value),
        ''
      )
    );
  ELSIF v_target_kind = 'email' THEN
    v_identity_value := lower(v_target_value);
  ELSE
    v_identity_value := v_target_value;
  END IF;
  IF NULLIF(v_identity_value, '') IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_scope || ':' || v_target_kind || ':' || v_identity_value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member_v186_internal(p_source_id bigint, p_membership_id bigint, p_batch_id bigint, p_group_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_action text;
  v_platform text;
  v_contact_type text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_input_uid text;
  v_input_phone text;
  v_input_email text;
  v_target_value text;
  v_identity_value text;
  v_uid_identity text;
  v_url_identity text;
  v_allow_alias_resolution boolean := false;
  v_target_kind text;
  v_scope text;
  v_candidate_key text;
  v_canonical_key text;
  v_aliases text[] := '{}'::text[];
  v_mapped_keys text[] := '{}'::text[];
  v_payload jsonb;
  v_input_id bigint;
  v_inserted boolean := false;
  v_info1 text;
  v_info2 text;
  v_info3 text;
  v_info4 text;
  v_info5 text;
  v_phone_carrier text;
BEGIN
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = p_source_id;
  IF NOT FOUND OR v_source.status NOT IN ('baselining', 'active') THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'source_stopped');
  END IF;

  SELECT * INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_source.campaign_id
  FOR UPDATE;
  IF FOUND AND v_campaign.data_target_source_mode = 'data_group'
    AND (
      COALESCE(v_campaign.is_delete, false)
      OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now())
    )
  THEN
    EXECUTE 'SELECT public.aka_agent_finalize_data_group_campaign($1, $2, $3, $4)'
    USING v_source.staff_id, v_source.organization_id, v_campaign.id,
      CASE WHEN COALESCE(v_campaign.is_delete, false)
        THEN 'Chiến dịch đã bị xoá' ELSE 'Chiến dịch đã hết hạn' END;
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'campaign_hard_ended');
  END IF;
  IF NOT FOUND
    OR v_campaign.staff_id IS DISTINCT FROM v_source.staff_id
    OR v_campaign.organization_id IS DISTINCT FROM v_source.organization_id
    OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.data_target_source_mode <> 'data_group'
    OR v_campaign.data_group_id IS DISTINCT FROM v_source.group_id
    OR v_campaign.status NOT IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now())
  THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'campaign_terminal');
  END IF;

  SELECT * INTO v_member
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = p_membership_id
    AND member.group_id = v_source.group_id
    AND member.is_delete = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'membership_inactive');
  END IF;

  SELECT * INTO v_contact
  FROM public.auto_account_contacts AS contact
  WHERE contact.id = v_member.contact_id
    AND contact.staff_id = v_source.staff_id
    AND contact.organization_id = v_source.organization_id
    AND COALESCE(contact.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'contact_inactive');
  END IF;

  SELECT * INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id
    AND account.staff_id = v_source.staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_source.organization_id)
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'campaign_account_inactive');
  END IF;

  v_action := btrim(COALESCE(v_campaign.action_id, ''));
  v_platform := lower(btrim(COALESCE(v_contact.flatform_type, '')));
  v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
  v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
  v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
  v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
  v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
    NULLIF(v_contact.phone, ''), NULLIF(v_contact.extra_data ->> 'phone', ''),
    CASE WHEN v_contact_type = 'phone' THEN v_contact.uid ELSE NULL END, ''
  ));
  v_phone := NULLIF(v_phone, '');
  v_email := NULLIF(lower(btrim(COALESCE(
    NULLIF(v_contact.email, ''), NULLIF(v_contact.extra_data ->> 'email', ''),
    CASE WHEN v_contact_type = 'email' THEN v_contact.uid ELSE NULL END, ''
  ))), '');
  IF v_email IS NOT NULL AND (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR length(v_email) > 254) THEN
    v_email := NULL;
  END IF;
  v_info1 := NULLIF(v_contact.extra_data ->> 'info1', '');
  v_info2 := NULLIF(v_contact.extra_data ->> 'info2', '');
  v_info3 := NULLIF(v_contact.extra_data ->> 'info3', '');
  v_info4 := NULLIF(v_contact.extra_data ->> 'info4', '');
  v_info5 := NULLIF(v_contact.extra_data ->> 'info5', '');
  v_phone_carrier := COALESCE(
    NULLIF(v_contact.extra_data ->> 'phoneCarrier', ''),
    NULLIF(v_contact.extra_data ->> 'phone_carrier', '')
  );

  -- Portable Facebook routes.
  IF v_action IN ('facebook_group_post', 'facebook_join_group', 'facebook_find_data_group') THEN
    -- v227: Facebook routes use semantic type plus UID/URL only.
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_group';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_message_uid' THEN
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_find_data_search' THEN
    v_target_value := v_uid;
    v_target_kind := 'facebook_search';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action IN ('facebook_comment_seeding', 'facebook_comment_seeding_post') THEN
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := CASE WHEN v_action = 'facebook_comment_seeding_post'
      THEN 'facebook_post' ELSE 'facebook_comment_target' END;
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'zalo_message_phone' THEN
    IF v_phone IS NULL THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'valid_phone_required');
    END IF;
    v_target_value := v_phone;
    v_target_kind := 'phone';
    v_scope := 'portable';
    v_input_phone := v_target_value;
  ELSIF v_action = 'zalo_join_group_link' THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'group' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'zalo_group_required');
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'zalo_group_link';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'email_send' THEN
    IF v_email IS NULL THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'valid_email_required');
    END IF;
    v_target_value := v_email;
    v_target_kind := 'email';
    v_scope := 'portable';
    v_input_email := v_target_value;

  -- Account-bound routes.
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    -- v226: Facebook UID/URL targets are portable across source accounts.
    -- is_friend and contact.account_id are scan metadata only.
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    -- Retain the legacy per-campaign key namespace so existing active inputs
    -- are not duplicated when this migration is applied mid-campaign.
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_page_post' THEN
    -- v226: Page ID/URL validity is sufficient; source account is not binding.
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action IN (
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer'
  ) THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_zalo_person_required');
    END IF;
    IF v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_zalo_friend_required');
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_person';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action = 'zalo_message_group' THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'group'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
      OR v_contact.is_joined IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_joined_zalo_group_required');
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_group';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;

  -- Hybrid: a valid phone is portable and must force uid=''; UID-only remains
  -- account-bound so one account's Zalo identity is never used by another.
  ELSIF v_action = 'zalo_add_group_member' THEN
    IF v_phone IS NOT NULL THEN
      v_target_value := v_phone;
      v_target_kind := 'phone';
      v_scope := 'portable';
      v_input_phone := v_phone;
      v_input_uid := '';
    ELSIF v_platform = 'zalo' AND v_contact_type = 'person'
      AND v_uid IS NOT NULL
      AND v_contact.account_id IS NOT DISTINCT FROM v_campaign.account_id THEN
      v_target_value := v_uid;
      v_target_kind := 'zalo_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSE
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'hybrid_target_not_routable');
    END IF;
  ELSE
    -- Includes SMS, voice, Zalo realtime, cancel-request and every future action
    -- until its delivery contract is explicitly added here.
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'unsupported_action');
  END IF;

  IF NULLIF(v_target_value, '') IS NULL THEN
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'target_value_missing');
  END IF;

  -- Canonicalization is action-aware.  Phone/email routes intentionally carry
  -- no unrelated UID/URL aliases; doing so could merge two different people
  -- merely because an imported row happened to contain extra columns.
  IF v_target_kind LIKE 'facebook_%' THEN
    v_uid_identity := CASE WHEN v_uid IS NULL THEN NULL
      ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_uid), '') END;
    v_url_identity := CASE WHEN v_url IS NULL THEN NULL
      ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_url), '') END;
    v_identity_value := COALESCE(
      v_uid_identity,
      v_url_identity,
      NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_target_value), '')
    );
    -- UID and URL stored on the same Facebook contact are explicit aliases for
    -- that row. Canonical identity prefers UID while input.uid keeps the raw
    -- URL/value required by the runtime.
    v_allow_alias_resolution := true;
  ELSIF v_target_kind = 'email' THEN
    v_identity_value := lower(v_target_value);
  ELSE
    v_identity_value := v_target_value;
  END IF;
  IF NULLIF(v_identity_value, '') IS NULL THEN
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'canonical_identity_missing');
  END IF;
  v_candidate_key := v_scope || ':' || v_target_kind || ':' || v_identity_value;
  v_aliases := array_append(v_aliases, v_candidate_key);
  IF v_target_kind LIKE 'facebook_%' AND v_uid_identity IS NOT NULL THEN
    v_aliases := array_append(
      v_aliases, v_scope || ':' || v_target_kind || ':' || v_uid_identity
    );
  END IF;
  IF v_target_kind LIKE 'facebook_%' AND v_url_identity IS NOT NULL THEN
    v_aliases := array_append(
      v_aliases, v_scope || ':' || v_target_kind || ':' || v_url_identity
    );
  END IF;
  SELECT COALESCE(array_agg(DISTINCT alias.canonical_target_key), '{}'::text[])
  INTO v_mapped_keys
  FROM public.auto_campaign_input_target_aliases AS alias
  WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = ANY(v_aliases);

  IF cardinality(v_mapped_keys) > 1
    OR (
      cardinality(v_mapped_keys) = 1
      AND NOT v_allow_alias_resolution
      AND v_mapped_keys[1] IS DISTINCT FROM v_candidate_key
    )
  THEN
    UPDATE public.auto_campaign_input_target_aliases AS alias
    SET conflict_count = alias.conflict_count + 1,
        last_conflict_at = now(),
        last_conflict_payload = jsonb_build_object(
          'membershipId', v_member.id,
          'candidateCanonicalKey', v_candidate_key,
          'mappedCanonicalKeys', to_jsonb(v_mapped_keys),
          'aliases', to_jsonb(v_aliases)
        ),
        updated_at = now()
    WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = ANY(v_aliases);
    RETURN jsonb_build_object(
      'status', 'conflict', 'reason', 'canonical_alias_conflict',
      'aliases', to_jsonb(v_aliases), 'canonicalKeys', to_jsonb(v_mapped_keys)
    );
  END IF;
  -- One established Facebook alias may resolve a UID-only or URL-only row.
  -- All other actions require exact candidate agreement.
  v_canonical_key := CASE
    WHEN v_allow_alias_resolution AND cardinality(v_mapped_keys) = 1
      THEN v_mapped_keys[1]
    ELSE v_candidate_key
  END;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'name', COALESCE(v_name, v_target_value),
    'phone', v_input_phone,
    'phone_carrier', v_phone_carrier,
    'uid', v_input_uid,
    'email', v_input_email,
    'info1', v_info1, 'info2', v_info2, 'info3', v_info3,
    'info4', v_info4, 'info5', v_info5,
    'contact_id', v_contact.id,
    'membership_id', v_member.id,
    'source_account_id', v_contact.account_id,
    'contact_type', v_contact.contact_type,
    'flatform_type', v_contact.flatform_type,
    'canonical_target_key', v_canonical_key
  ));

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, phone, phone_carrier, uid, email,
    info1, info2, info3, info4, info5, status, schedule, is_delete,
    canonical_target_key, created_at
  ) VALUES (
    v_campaign.id, NULL, COALESCE(v_name, v_target_value),
    v_input_phone, v_phone_carrier, v_input_uid, v_input_email,
    v_info1, v_info2, v_info3, v_info4, v_info5,
    'chờ xử lý', COALESCE(v_campaign.schedule, now()), false,
    v_canonical_key, now()
  )
  ON CONFLICT (campaign_id, canonical_target_key)
    WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false
  DO NOTHING
  RETURNING id INTO v_input_id;

  IF v_input_id IS NULL THEN
    SELECT input_data.id INTO v_input_id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND input_data.canonical_target_key = v_canonical_key
      AND COALESCE(input_data.is_delete, false) = false
    FOR UPDATE;
  ELSE
    v_inserted := true;
  END IF;

  INSERT INTO public.auto_campaign_input_target_aliases (
    campaign_id, alias_key, canonical_target_key, input_data_id
  )
  SELECT v_campaign.id, candidate.alias_key, v_canonical_key, v_input_id
  FROM (SELECT DISTINCT unnest(v_aliases) AS alias_key) AS candidate
  ON CONFLICT (campaign_id, alias_key) DO UPDATE
  SET input_data_id = EXCLUDED.input_data_id,
      updated_at = now()
  WHERE auto_campaign_input_target_aliases.canonical_target_key = EXCLUDED.canonical_target_key;

  INSERT INTO public.auto_campaign_input_origins (
    input_data_id, source_id, group_id, membership_id, batch_id,
    group_revision, canonical_target_key, payload_snapshot
  ) VALUES (
    v_input_id, v_source.id, v_source.group_id, v_member.id, p_batch_id,
    p_group_revision, v_canonical_key, v_payload
  ) ON CONFLICT DO NOTHING;

  UPDATE public.auto_campaign_data_group_sources
  SET last_ingest_at = now(), updated_at = now()
  WHERE id = v_source.id;

  UPDATE public.auto_campaigns
  SET note = NULL, updated_at = now()
  WHERE id = v_campaign.id
    AND note IN ('Chờ data phù hợp', 'Chờ data mới');

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted THEN 'inserted' ELSE 'existing' END,
    'inputDataId', v_input_id,
    'canonicalTargetKey', v_canonical_key
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member(p_source_id bigint, p_membership_id bigint, p_batch_id bigint, p_group_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign_id bigint;
  v_action_id text;
  v_group_id bigint;
  v_staff_id bigint;
  v_organization_id bigint;
  v_campaign_is_delete boolean;
  v_campaign_schedule_end_date timestamptz;
BEGIN
  SELECT
    campaign.id,
    campaign.action_id,
    source.group_id,
    campaign.staff_id,
    campaign.organization_id
  INTO
    v_campaign_id,
    v_action_id,
    v_group_id,
    v_staff_id,
    v_organization_id
  FROM public.auto_campaign_data_group_sources AS source
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = source.campaign_id
  WHERE source.id = p_source_id;

  IF v_campaign_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_members AS member
      WHERE member.id = p_membership_id
        AND member.group_id = v_group_id
    )
    AND NOT (
      -- v228: valid-phone routes ignore semantic/platform/contact/account and
      -- relationship metadata. UID-only add-member routing does not enter here.
      v_action_id IN ('zalo_message_phone', 'zalo_add_group_member')
      AND public.aka_agent_data_group_membership_has_valid_phone(
        p_membership_id, v_group_id
      )
    )
    AND NOT public.aka_agent_data_group_membership_semantic_compatible(
      p_membership_id, v_action_id, v_group_id
    )
  THEN
    RETURN jsonb_build_object(
      'status', 'incompatible',
      'reason', 'data_group_member_semantic_type_mismatch'
    );
  END IF;

  IF v_campaign_id IS NOT NULL THEN
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);

    SELECT
      COALESCE(campaign.is_delete, false),
      campaign.schedule_end_date
    INTO
      v_campaign_is_delete,
      v_campaign_schedule_end_date
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = v_campaign_id
      AND campaign.staff_id = v_staff_id
      AND campaign.organization_id = v_organization_id
      AND campaign.data_target_source_mode = 'data_group'
    FOR UPDATE OF campaign;

    IF FOUND AND (
      v_campaign_is_delete
      OR (
        v_campaign_schedule_end_date IS NOT NULL
        AND v_campaign_schedule_end_date <= now()
      )
    ) THEN
      PERFORM public.aka_agent_internal_finalize_data_group_campaign_v219(
        v_staff_id,
        v_organization_id,
        v_campaign_id,
        CASE
          WHEN v_campaign_is_delete THEN 'Chiến dịch đã bị xoá'
          ELSE 'Chiến dịch đã hết hạn'
        END
      );
      RETURN jsonb_build_object(
        'status', 'no_intake', 'reason', 'campaign_hard_ended'
      );
    END IF;
  END IF;

  RETURN public.aka_agent_internal_route_data_group_member_v205_internal(
    p_source_id, p_membership_id, p_batch_id, p_group_revision
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
