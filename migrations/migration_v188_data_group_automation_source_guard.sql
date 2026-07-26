-- Data Group automation lifecycle guard.
--
-- Automation A -> B predates live Data Group sources and its v174
-- materializer can reopen a completed target campaign after inserting an
-- input.  Preflight Data Group targets while holding the same lock order as
-- v174, so a stopped/deleted/expired source cannot receive automation input.

BEGIN;

CREATE OR REPLACE FUNCTION public.materialize_auto_automation_detail(
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
  v_result jsonb;
  v_automation_id bigint;
  v_execution public.auto_automation_detail%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_source_found boolean := false;
  v_block_reason text;
  v_should_finalize boolean := false;
  v_retry_later boolean := false;
  v_target_campaign_id bigint;
  v_earliest_pending_schedule timestamptz;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  -- Preserve v174's automation -> execution -> campaign lock order. Calling
  -- the internal materializer later in this transaction simply reacquires
  -- locks already owned by this transaction.
  SELECT detail.automation_id
  INTO v_automation_id
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id;

  IF FOUND THEN
    PERFORM automation.id
    FROM public.auto_automation AS automation
    WHERE automation.id = v_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
    FOR UPDATE;

    IF FOUND THEN
      SELECT detail.*
      INTO v_execution
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = p_automation_detail_id
        AND detail.automation_id = v_automation_id
        AND detail.staff_id = p_staff_id
        AND detail.organization_id = p_organization_id
      FOR UPDATE;

      -- Only the worker that owns a live claim may settle it here. Existing
      -- materialized/terminal/not-claimed executions keep v174's responses.
      IF FOUND
        AND v_execution.status = 'đang xử lý'
        AND v_execution.locked_by IS NOT DISTINCT FROM btrim(p_worker_id)
      THEN
        SELECT campaign.*
        INTO v_campaign
        FROM public.auto_campaigns AS campaign
        WHERE campaign.id = v_execution.target_campaign_id
          AND campaign.staff_id = p_staff_id
          AND campaign.organization_id = p_organization_id
        FOR UPDATE;

        IF FOUND AND v_campaign.data_target_source_mode = 'data_group' THEN
          SELECT source.*
          INTO v_source
          FROM public.auto_campaign_data_group_sources AS source
          WHERE source.campaign_id = v_campaign.id
            AND source.staff_id = p_staff_id
            AND source.organization_id = p_organization_id
          FOR UPDATE;
          v_source_found := FOUND;

          IF COALESCE(v_campaign.is_delete, false) THEN
            v_block_reason := 'target_data_group_campaign_deleted';
            v_should_finalize := true;
          ELSIF v_campaign.schedule_end_date IS NOT NULL
            AND v_campaign.schedule_end_date <= clock_timestamp()
          THEN
            v_block_reason := 'target_data_group_campaign_hard_ended';
            v_should_finalize := true;
          ELSIF COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready' THEN
            v_block_reason := 'target_data_group_campaign_not_ready';
            v_retry_later := true;
          ELSIF v_campaign.status NOT IN ('chờ xử lý', 'tạm dừng', 'đang chạy') THEN
            v_block_reason := 'target_data_group_campaign_terminal';
          ELSIF v_campaign.data_group_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM public.auto_account_contact_groups AS contact_group
            WHERE contact_group.id = v_campaign.data_group_id
              AND contact_group.staff_id = p_staff_id
              AND contact_group.organization_id = p_organization_id
              AND contact_group.purpose = 'data_group'
              AND COALESCE(contact_group.is_delete, false) = false
          ) THEN
            v_block_reason := 'target_data_group_deleted';
          ELSIF NOT v_source_found THEN
            v_block_reason := 'target_data_group_source_missing';
          ELSIF v_source.group_id IS DISTINCT FROM v_campaign.data_group_id THEN
            v_block_reason := 'target_data_group_source_mismatch';
          ELSIF v_source.status NOT IN ('baselining', 'active') THEN
            v_block_reason := 'target_data_group_source_stopped';
          END IF;

          IF v_block_reason IS NOT NULL THEN
            -- A child campaign is intentionally invisible to the scheduler
            -- while its bundle is still staging/baselining. Keep the claimed
            -- automation detail retryable instead of settling it before the
            -- bundle can atomically become ready.
            IF v_retry_later THEN
              RETURN jsonb_build_object(
                'result', 'target_running',
                'retryable', true,
                'automation_detail_id', v_execution.id,
                'target_campaign_id', v_campaign.id,
                'error', v_block_reason
              );
            END IF;

            UPDATE public.auto_automation_detail AS detail
            SET
              status = 'bỏ qua',
              last_error = v_block_reason,
              locked_at = NULL,
              locked_by = NULL,
              processed_at = COALESCE(detail.processed_at, clock_timestamp()),
              target_data_group_sync_status = 'skipped',
              target_data_group_sync_error = v_block_reason,
              updated_at = clock_timestamp()
            WHERE detail.id = v_execution.id
              AND detail.status = 'đang xử lý'
              AND detail.locked_by IS NOT DISTINCT FROM btrim(p_worker_id);

            -- Finalization is appropriate only for an actual delete/hard end.
            -- A staged bundle or temporarily absent source must not be closed
            -- merely because an automation worker observed it early.
            IF v_should_finalize THEN
              PERFORM public.aka_agent_finalize_data_group_campaign(
                p_staff_id,
                p_organization_id,
                v_campaign.id,
                CASE
                  WHEN COALESCE(v_campaign.is_delete, false)
                    THEN 'Chiến dịch đã bị xoá'
                  ELSE 'Chiến dịch đã hết hạn'
                END
              );
            END IF;

            RETURN jsonb_build_object(
              'result', 'skipped',
              'retryable', false,
              'automation_detail_id', v_execution.id,
              'target_campaign_id', v_campaign.id,
              'error', v_block_reason
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  v_result := public.materialize_auto_automation_detail_v174_internal(
    p_staff_id,
    p_organization_id,
    p_automation_detail_id,
    p_worker_id,
    p_target_input,
    p_auth_username,
    p_auth_password
  );

  -- Preserve v176's schedule alignment exactly: the target campaign follows
  -- its earliest pending input, and only a successfully materialized target
  -- may reopen a legacy completed campaign.
  IF v_result ->> 'result' IN ('materialized', 'already_materialized') THEN
    SELECT detail.target_campaign_id
    INTO v_target_campaign_id
    FROM public.auto_automation_detail AS detail
    WHERE detail.id = p_automation_detail_id
      AND detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND detail.target_input_data_id IS NOT NULL;

    IF v_target_campaign_id IS NOT NULL THEN
      PERFORM campaign.id
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_target_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.organization_id = p_organization_id
        AND COALESCE(campaign.is_delete, false) = false
      FOR UPDATE;

      IF FOUND THEN
        SELECT min(COALESCE(
          input_data.schedule,
          input_data.created_at,
          clock_timestamp()
        ))
        INTO v_earliest_pending_schedule
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_target_campaign_id
          AND input_data.status = 'chờ xử lý'
          AND COALESCE(input_data.is_delete, false) = false;

        IF v_earliest_pending_schedule IS NOT NULL THEN
          UPDATE public.auto_campaigns AS campaign
          SET
            status = CASE
              WHEN campaign.status = 'hoàn thành' THEN 'chờ xử lý'
              ELSE campaign.status
            END,
            schedule = v_earliest_pending_schedule,
            completed_at = CASE
              WHEN campaign.status = 'hoàn thành' THEN NULL
              ELSE campaign.completed_at
            END,
            note = CASE
              WHEN campaign.status = 'hoàn thành' THEN NULL
              ELSE campaign.note
            END,
            updated_at = clock_timestamp()
          WHERE campaign.id = v_target_campaign_id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

-- Defense in depth for callers that bypass the public materializer and invoke
-- the v174 implementation (or insert an automation input directly). The AFTER
-- INSERT exception rolls back the input before it can acquire a canonical key
-- or reopen a closed Data Group campaign.
CREATE OR REPLACE FUNCTION public.aka_agent_reserve_automation_data_group_input()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_source_found boolean := false;
  v_guard_error text;
  v_action text;
  v_scope text;
  v_target_kind text;
  v_target_value text;
  v_identity_value text;
  v_candidate_key text;
  v_canonical_key text;
  v_phone text;
  v_email text;
  v_mapped_keys text[] := '{}'::text[];
  v_winner_id bigint;
  v_group_revision bigint := 0;
  v_payload jsonb;
BEGIN
  IF NEW.auto_automation_detail_id IS NULL THEN RETURN NEW; END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = NEW.campaign_id
  FOR UPDATE;
  IF NOT FOUND OR v_campaign.data_target_source_mode <> 'data_group'
    OR v_campaign.data_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT source.*
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id
    AND source.staff_id = v_campaign.staff_id
    AND source.organization_id = v_campaign.organization_id
  FOR UPDATE;
  v_source_found := FOUND;

  IF COALESCE(v_campaign.is_delete, false) THEN
    v_guard_error := 'target_data_group_campaign_deleted';
  ELSIF v_campaign.schedule_end_date IS NOT NULL
    AND v_campaign.schedule_end_date <= clock_timestamp()
  THEN
    v_guard_error := 'target_data_group_campaign_hard_ended';
  ELSIF COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready' THEN
    v_guard_error := 'target_data_group_campaign_not_ready';
  ELSIF v_campaign.status NOT IN ('chờ xử lý', 'tạm dừng', 'đang chạy') THEN
    v_guard_error := 'target_data_group_campaign_terminal';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = v_campaign.data_group_id
      AND contact_group.staff_id = v_campaign.staff_id
      AND contact_group.organization_id = v_campaign.organization_id
      AND contact_group.purpose = 'data_group'
      AND COALESCE(contact_group.is_delete, false) = false
  ) THEN
    v_guard_error := 'target_data_group_deleted';
  ELSIF NOT v_source_found THEN
    v_guard_error := 'target_data_group_source_missing';
  ELSIF v_source.group_id IS DISTINCT FROM v_campaign.data_group_id THEN
    v_guard_error := 'target_data_group_source_mismatch';
  ELSIF v_source.status NOT IN ('baselining', 'active') THEN
    v_guard_error := 'target_data_group_source_stopped';
  END IF;

  IF v_guard_error IS NOT NULL THEN
    RAISE EXCEPTION 'data_group_automation_intake_closed:%', v_guard_error;
  END IF;

  v_action := btrim(COALESCE(v_campaign.action_id, ''));
  v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(NEW.phone, '')), '');
  v_email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  IF v_email IS NOT NULL AND (
    v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(v_email) > 254
  ) THEN v_email := NULL; END IF;

  IF v_action IN ('facebook_group_post', 'facebook_join_group', 'facebook_find_data_group') THEN
    v_target_kind := 'facebook_group';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'facebook_message_uid' THEN
    v_target_kind := 'facebook_person';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'facebook_find_data_search' THEN
    v_target_kind := 'facebook_search';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action IN ('facebook_comment_seeding', 'facebook_comment_seeding_post') THEN
    v_target_kind := CASE WHEN v_action = 'facebook_comment_seeding_post'
      THEN 'facebook_post' ELSE 'facebook_comment_target' END;
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'zalo_message_phone' THEN
    v_target_kind := 'phone'; v_target_value := v_phone; v_scope := 'portable';
  ELSIF v_action = 'zalo_join_group_link' THEN
    v_target_kind := 'zalo_group_link';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'email_send' THEN
    v_target_kind := 'email'; v_target_value := v_email; v_scope := 'portable';
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    v_target_kind := 'facebook_person';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action = 'facebook_page_post' THEN
    v_target_kind := 'facebook_page';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action IN (
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer'
  ) THEN
    v_target_kind := 'zalo_person';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action = 'zalo_message_group' THEN
    v_target_kind := 'zalo_group';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action = 'zalo_add_group_member' THEN
    IF v_phone IS NOT NULL THEN
      v_target_kind := 'phone'; v_target_value := v_phone; v_scope := 'portable';
      UPDATE public.auto_campaign_input_data SET uid = '' WHERE id = NEW.id;
    ELSE
      v_target_kind := 'zalo_person';
      v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
      v_scope := 'bound:' || v_campaign.account_id::text;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF v_target_value IS NULL THEN RETURN NEW; END IF;
  v_identity_value := CASE
    WHEN v_target_kind LIKE 'facebook_%'
      THEN public.aka_agent_internal_normalize_facebook_identity(v_target_value)
    WHEN v_target_kind = 'email' THEN lower(v_target_value)
    ELSE v_target_value
  END;
  IF NULLIF(v_identity_value, '') IS NULL THEN RETURN NEW; END IF;
  v_candidate_key := v_scope || ':' || v_target_kind || ':' || v_identity_value;

  SELECT COALESCE(array_agg(DISTINCT alias.canonical_target_key), '{}'::text[])
  INTO v_mapped_keys
  FROM public.auto_campaign_input_target_aliases AS alias
  WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = v_candidate_key;

  SELECT COALESCE(contact_group.revision, 0) INTO v_group_revision
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_campaign.data_group_id;
  v_group_revision := COALESCE(v_group_revision, 0);
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'name', NEW.name, 'phone', NEW.phone, 'phone_carrier', NEW.phone_carrier,
    'uid', NEW.uid, 'email', NEW.email,
    'info1', NEW.info1, 'info2', NEW.info2, 'info3', NEW.info3,
    'info4', NEW.info4, 'info5', NEW.info5,
    'automation_detail_id', NEW.auto_automation_detail_id,
    'canonical_target_key', v_candidate_key
  ));

  IF cardinality(v_mapped_keys) > 1 OR (
    cardinality(v_mapped_keys) = 1
    AND v_target_kind NOT LIKE 'facebook_%'
    AND v_mapped_keys[1] IS DISTINCT FROM v_candidate_key
  ) THEN
    UPDATE public.auto_campaign_input_target_aliases AS alias
    SET conflict_count = alias.conflict_count + 1,
        last_conflict_at = now(),
        last_conflict_payload = jsonb_build_object(
          'automationDetailId', NEW.auto_automation_detail_id,
          'candidateCanonicalKey', v_candidate_key,
          'mappedCanonicalKeys', to_jsonb(v_mapped_keys)
        ),
        updated_at = now()
    WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = v_candidate_key;
    UPDATE public.auto_campaign_input_data
    SET canonical_target_key = v_candidate_key,
        is_delete = true,
        status = 'hoàn thành',
        note = COALESCE(note, 'Xung đột định danh canonical; không tự gộp'),
        date_action = COALESCE(date_action, now())
    WHERE id = NEW.id;
    INSERT INTO public.auto_campaign_input_origins (
      input_data_id, source_id, group_id, membership_id, batch_id,
      origin_kind, automation_detail_id, group_revision,
      canonical_target_key, payload_snapshot
    ) VALUES (
      NEW.id, NULL, v_campaign.data_group_id, NULL, NULL,
      'automation', NEW.auto_automation_detail_id, v_group_revision,
      v_candidate_key, v_payload
    ) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  v_canonical_key := CASE
    WHEN v_target_kind LIKE 'facebook_%' AND cardinality(v_mapped_keys) = 1
      THEN v_mapped_keys[1]
    ELSE v_candidate_key
  END;

  SELECT input_data.id INTO v_winner_id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_campaign.id
    AND input_data.canonical_target_key = v_canonical_key
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.id <> NEW.id
  ORDER BY input_data.id
  LIMIT 1
  FOR UPDATE;

  IF v_winner_id IS NULL THEN
    v_winner_id := NEW.id;
    UPDATE public.auto_campaign_input_data
    SET canonical_target_key = v_canonical_key
    WHERE id = NEW.id;
  ELSE
    UPDATE public.auto_campaign_input_data
    SET canonical_target_key = v_canonical_key,
        is_delete = true,
        status = 'hoàn thành',
        note = COALESCE(note, 'Đã gộp vào target canonical #' || v_winner_id::text),
        date_action = COALESCE(date_action, now())
    WHERE id = NEW.id;
  END IF;

  INSERT INTO public.auto_campaign_input_target_aliases (
    campaign_id, alias_key, canonical_target_key, input_data_id
  ) VALUES (
    v_campaign.id, v_candidate_key, v_canonical_key, v_winner_id
  )
  ON CONFLICT (campaign_id, alias_key) DO UPDATE
  SET input_data_id = EXCLUDED.input_data_id, updated_at = now()
  WHERE auto_campaign_input_target_aliases.canonical_target_key = EXCLUDED.canonical_target_key;

  INSERT INTO public.auto_campaign_input_origins (
    input_data_id, source_id, group_id, membership_id, batch_id,
    origin_kind, automation_detail_id, group_revision,
    canonical_target_key, payload_snapshot
  ) VALUES (
    v_winner_id, NULL, v_campaign.data_group_id, NULL, NULL,
    'automation', NEW.auto_automation_detail_id, v_group_revision,
    v_canonical_key, v_payload || jsonb_build_object(
      'canonical_target_key', v_canonical_key
    )
  ) ON CONFLICT DO NOTHING;
  UPDATE public.auto_campaigns
  SET note = NULL, updated_at = now()
  WHERE id = v_campaign.id
    AND note IN ('Chờ data phù hợp', 'Chờ data mới');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_reserve_automation_data_group_input()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
