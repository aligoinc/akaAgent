-- Make Data Group dynamic filters forward-only.
--
-- Saving a filter establishes a new effective cutoff but does not enqueue the
-- tenant's historical contacts. A queued contact is evaluated by a filter only
-- when its latest source event happened at or after that filter's cutoff.
--
-- Live source captured from linked project cgjbsmqtfhqvttudyjzq on 2026-08-25:
--   aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)
--     md5(pg_get_functiondef) = 2b21dad2b96491d4d6b07f652061b5bf
--   aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)
--     md5(pg_get_functiondef) = 645fd3e31e2096b61c820b622c64152e
--
-- Target checksums captured from linked-project rollback validation:
--   aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)
--     md5(pg_get_functiondef) = 5c8507459cb2dc0e39b2b8906f6047ee
--   aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)
--     md5(pg_get_functiondef) = 0b7d7dcf67514fa7a959f5a56fd72e7b
--   aka_agent_dynamic_filter_stamp_queue_event()
--     md5(pg_get_functiondef) = 82ca61f3031b277dbeceb8d3bfd14a14

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE
  v_save oid := pg_catalog.to_regprocedure(
    'public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)'
  );
  v_process oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  );
  v_stamp oid := pg_catalog.to_regprocedure(
    'public.aka_agent_dynamic_filter_stamp_queue_event()'
  );
  v_filter_cutoff_exists boolean;
  v_queue_event_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_account_contact_group_dynamic_filters'
      AND column_name = 'effective_from_at'
  ) INTO v_filter_cutoff_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_account_contact_dynamic_filter_queue'
      AND column_name = 'last_event_at'
  ) INTO v_queue_event_exists;

  IF NOT v_filter_cutoff_exists AND NOT v_queue_event_exists THEN
    IF v_save IS NULL
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_save))
        IS DISTINCT FROM '2b21dad2b96491d4d6b07f652061b5bf'
    THEN
      RAISE EXCEPTION 'v252_save_dynamic_filter_missing_or_changed';
    END IF;
    IF v_process IS NULL
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
        IS DISTINCT FROM '645fd3e31e2096b61c820b622c64152e'
    THEN
      RAISE EXCEPTION 'v252_process_dynamic_filter_missing_or_changed';
    END IF;
    IF v_stamp IS NOT NULL THEN
      RAISE EXCEPTION 'v252_unexpected_queue_event_stamp_signature';
    END IF;
  ELSIF v_filter_cutoff_exists AND v_queue_event_exists THEN
    IF v_save IS NULL
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_save))
        IS DISTINCT FROM '5c8507459cb2dc0e39b2b8906f6047ee'
    THEN
      RAISE EXCEPTION 'v252_target_save_dynamic_filter_changed';
    END IF;
    IF v_process IS NULL
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
        IS DISTINCT FROM '0b7d7dcf67514fa7a959f5a56fd72e7b'
    THEN
      RAISE EXCEPTION 'v252_target_process_dynamic_filter_changed';
    END IF;
    IF v_stamp IS NULL
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_stamp))
        IS DISTINCT FROM '82ca61f3031b277dbeceb8d3bfd14a14'
    THEN
      RAISE EXCEPTION 'v252_target_queue_event_stamp_changed';
    END IF;
  ELSE
    RAISE EXCEPTION 'v252_forward_only_schema_partially_exists';
  END IF;
END;
$preflight$;

ALTER TABLE public.auto_account_contact_group_dynamic_filters
  ADD COLUMN IF NOT EXISTS effective_from_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE public.auto_account_contact_dynamic_filter_queue
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz NOT NULL DEFAULT clock_timestamp();

UPDATE public.auto_account_contact_group_dynamic_filters
SET next_evaluation_at = NULL
WHERE next_evaluation_at IS NOT NULL;

COMMENT ON COLUMN public.auto_account_contact_group_dynamic_filters.effective_from_at IS
  'Only contact events at or after this cutoff are evaluated by the current saved rules.';
COMMENT ON COLUMN public.auto_account_contact_dynamic_filter_queue.last_event_at IS
  'Latest source-data change represented by this contact-deduplicated queue row.';

CREATE OR REPLACE FUNCTION public.aka_agent_dynamic_filter_stamp_queue_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.attempt_count = 0 THEN
    NEW.last_event_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$function$;

-- Exact captured live body plus the event-cutoff predicate. Periodic timestamps
-- are cleared because this feature is now purely event-driven.
CREATE OR REPLACE FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  p_staff_id bigint,
  p_organization_id bigint,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_limit integer := LEAST(500, GREATEST(1, COALESCE(p_limit, 200)));
  v_queue record;
  v_filter record;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member_id bigint;
  v_origin_current boolean;
  v_was_member boolean;
  v_enter boolean;
  v_leave boolean;
  v_should_be_member boolean;
  v_processed integer := 0;
  v_pairs integer := 0;
  v_entered integer := 0;
  v_exited integer := 0;
  v_remaining bigint := 0;
  v_touched_filter_ids bigint[] := ARRAY[]::bigint[];
  v_changed_group_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:' || p_staff_id::text, 0)
  ) THEN
    RETURN jsonb_build_object(
      'processed_contact_count', 0,
      'evaluated_pair_count', 0,
      'entered_count', 0,
      'exited_count', 0,
      'remaining_queue_count', (
        SELECT count(*) FROM public.auto_account_contact_dynamic_filter_queue AS queue
        WHERE queue.staff_id = p_staff_id AND queue.organization_id = p_organization_id
      ),
      'busy', true
    );
  END IF;

  FOR v_queue IN
    SELECT queue.contact_id, queue.last_event_at
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.staff_id = p_staff_id
      AND queue.organization_id = p_organization_id
      AND queue.queued_at <= clock_timestamp()
    ORDER BY queue.queued_at, queue.contact_id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  LOOP
    BEGIN
      FOR v_filter IN
        SELECT dynamic_filter.id, dynamic_filter.group_id
        FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
        JOIN public.auto_account_contact_groups AS contact_group
          ON contact_group.id = dynamic_filter.group_id
         AND contact_group.staff_id = p_staff_id
         AND contact_group.organization_id = p_organization_id
         AND contact_group.purpose = 'data_group'
         AND contact_group.is_delete = false
        JOIN public.category_item AS data_type
          ON data_type.id = contact_group.data_type_category_item_id
         AND data_type.code = 'zalo_person'
        WHERE dynamic_filter.staff_id = p_staff_id
          AND dynamic_filter.organization_id = p_organization_id
          AND dynamic_filter.is_enabled = true
          AND dynamic_filter.effective_from_at <= v_queue.last_event_at
          AND EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
            JOIN public.category_item AS scope_item ON scope_item.id = rule.scope_category_item_id
            WHERE rule.dynamic_filter_id = dynamic_filter.id
              AND scope_item.code = 'enter'
          )
        ORDER BY dynamic_filter.id
      LOOP
        v_member_id := NULL;
        v_origin_current := false;
        v_was_member := false;
        v_pairs := v_pairs + 1;
        IF NOT v_filter.id = ANY (v_touched_filter_ids) THEN
          v_touched_filter_ids := pg_catalog.array_append(v_touched_filter_ids, v_filter.id);
          UPDATE public.auto_account_contact_group_dynamic_filters
          SET last_entered_count = 0, last_exited_count = 0
          WHERE id = v_filter.id;
        END IF;

        SELECT contact_group.* INTO v_group
        FROM public.auto_account_contact_groups AS contact_group
        WHERE contact_group.id = v_filter.group_id
        FOR UPDATE;

        IF EXISTS (
          SELECT 1 FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type = 'zalo'
            AND contact.contact_type = 'person'
            AND contact.is_delete = false
        ) THEN
          v_enter := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'enter'
          );
          v_leave := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'leave'
          );
          v_should_be_member := v_enter AND NOT v_leave;
        ELSE
          v_should_be_member := false;
        END IF;

        SELECT member.id, member.is_delete = false
        INTO v_member_id, v_was_member
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_filter.group_id
          AND member.contact_id = v_queue.contact_id
        FOR UPDATE;

        SELECT origin.is_current INTO v_origin_current
        FROM public.auto_account_contact_group_member_origins AS origin
        WHERE origin.membership_id = v_member_id
          AND origin.dynamic_filter_id = v_filter.id;

        IF v_should_be_member THEN
          INSERT INTO public.auto_account_contact_group_members (
            group_id, contact_id, is_delete, change_revision, updated_at
          ) VALUES (
            v_filter.group_id, v_queue.contact_id, false, v_group.revision + 1, clock_timestamp()
          )
          ON CONFLICT (group_id, contact_id) DO UPDATE SET
            is_delete = false,
            change_revision = v_group.revision + 1,
            updated_at = clock_timestamp()
          RETURNING id INTO v_member_id;

          INSERT INTO public.auto_account_contact_group_member_origins (
            membership_id, kind, dynamic_filter_id, source_account_id,
            source_name_snapshot, is_current, data_type_category_item_id, updated_at
          )
          SELECT
            v_member_id, 'dynamic_filter', v_filter.id, contact.account_id::bigint,
            'Bộ lọc động', true, v_group.data_type_category_item_id, clock_timestamp()
          FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
          ON CONFLICT (membership_id, dynamic_filter_id)
            WHERE dynamic_filter_id IS NOT NULL
          DO UPDATE SET
            source_account_id = EXCLUDED.source_account_id,
            source_name_snapshot = EXCLUDED.source_name_snapshot,
            is_current = true,
            data_type_category_item_id = EXCLUDED.data_type_category_item_id,
            updated_at = clock_timestamp();

          IF NOT COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = matched_count + 1
            WHERE id = v_filter.id;
          END IF;

          IF NOT COALESCE(v_was_member, false) THEN
            v_entered := v_entered + 1;
            v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET last_entered_count = last_entered_count + 1
            WHERE id = v_filter.id;
          END IF;
        ELSE
          IF COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_member_origins
            SET is_current = false, updated_at = clock_timestamp()
            WHERE membership_id = v_member_id
              AND dynamic_filter_id = v_filter.id
              AND is_current = true;

            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = GREATEST(0, matched_count - 1)
            WHERE id = v_filter.id;

            IF COALESCE(v_was_member, false) AND NOT EXISTS (
              SELECT 1
              FROM public.auto_account_contact_group_member_origins AS origin
              WHERE origin.membership_id = v_member_id
                AND origin.is_current = true
            ) THEN
              UPDATE public.auto_account_contact_group_members
              SET is_delete = true,
                  primary_origin_id = NULL,
                  change_revision = v_group.revision + 1,
                  updated_at = clock_timestamp()
              WHERE id = v_member_id;
              v_exited := v_exited + 1;
              v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
              UPDATE public.auto_account_contact_group_dynamic_filters
              SET last_exited_count = last_exited_count + 1
              WHERE id = v_filter.id;
            END IF;
          END IF;
        END IF;
      END LOOP;

      DELETE FROM public.auto_account_contact_dynamic_filter_queue
      WHERE contact_id = v_queue.contact_id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.auto_account_contact_dynamic_filter_queue
      SET attempt_count = attempt_count + 1,
          last_error = left(SQLERRM, 1000),
          queued_at = clock_timestamp() + make_interval(
            secs => CASE
              WHEN attempt_count >= 8 THEN 3600
              ELSE 5 * (attempt_count + 1) * (attempt_count + 1)
            END
          )
      WHERE contact_id = v_queue.contact_id;
    END;
  END LOOP;

  IF pg_catalog.array_length(v_changed_group_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_groups AS contact_group
    SET revision = contact_group.revision + 1,
        updated_at = clock_timestamp()
    WHERE contact_group.id = ANY (v_changed_group_ids);
  END IF;

  IF pg_catalog.array_length(v_touched_filter_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_group_dynamic_filters AS dynamic_filter
    SET last_evaluated_at = clock_timestamp(),
        next_evaluation_at = NULL,
        updated_at = clock_timestamp()
    WHERE dynamic_filter.id = ANY (v_touched_filter_ids);
  END IF;

  SELECT count(*)::bigint INTO v_remaining
  FROM public.auto_account_contact_dynamic_filter_queue AS queue
  WHERE queue.staff_id = p_staff_id
    AND queue.organization_id = p_organization_id
    AND queue.queued_at <= clock_timestamp();

  RETURN jsonb_build_object(
    'processed_contact_count', v_processed,
    'evaluated_pair_count', v_pairs,
    'entered_count', v_entered,
    'exited_count', v_exited,
    'remaining_queue_count', v_remaining,
    'busy', false
  );
END;
$function$;

-- Exact captured live body with only these forward-only changes:
--   1. serialize save against the existing processor advisory lock;
--   2. advance effective_from_at and clear the unused periodic timestamp;
--   3. remove the historical-contact bulk enqueue.
CREATE OR REPLACE FUNCTION public.aka_agent_save_data_group_dynamic_filter(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_is_enabled boolean,
  p_rules jsonb,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_filter_id bigint;
  v_rule_count integer;
  v_inserted_count integer;
  v_queued_count integer := 0;
  v_group_type_code text;
  v_revision bigint;
  v_effective_from_at timestamptz := clock_timestamp();
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  -- Same key and lock order as the processor: advisory lock, then group row.
  -- This prevents an old queued event from crossing a concurrent rule save.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:' || p_staff_id::text, 0)
  );

  SELECT data_type.code INTO v_group_type_code
  FROM public.auto_account_contact_groups AS contact_group
  LEFT JOIN public.category_item AS data_type
    ON data_type.id = contact_group.data_type_category_item_id
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE OF contact_group;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF v_group_type_code IS DISTINCT FROM 'zalo_person' THEN
    RAISE EXCEPTION 'dynamic_filter_requires_zalo_person_group';
  END IF;

  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'dynamic_filter_rules_must_be_array';
  END IF;
  v_rule_count := jsonb_array_length(COALESCE(p_rules, '[]'::jsonb));
  IF v_rule_count > 50 THEN RAISE EXCEPTION 'dynamic_filter_rule_limit_exceeded'; END IF;
  IF COALESCE(p_is_enabled, false) AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE rule->>'scope_code' = 'enter'
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_enter_rule_required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE jsonb_typeof(COALESCE(rule->'value_keys', 'null'::jsonb)) <> 'array'
      OR jsonb_typeof(COALESCE(rule->'value_labels', 'null'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_rule_values_invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE jsonb_array_length(rule->'value_keys') NOT BETWEEN 1 AND 50
      OR jsonb_array_length(rule->'value_labels') > 50
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_rule_values_invalid';
  END IF;

  INSERT INTO public.auto_account_contact_group_dynamic_filters (
    group_id, staff_id, organization_id, is_enabled, revision,
    effective_from_at, next_evaluation_at, updated_at
  ) VALUES (
    p_group_id, p_staff_id, p_organization_id, COALESCE(p_is_enabled, false), 1,
    v_effective_from_at, NULL, clock_timestamp()
  )
  ON CONFLICT (group_id) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    revision = public.auto_account_contact_group_dynamic_filters.revision + 1,
    effective_from_at = EXCLUDED.effective_from_at,
    next_evaluation_at = NULL,
    updated_at = clock_timestamp()
  RETURNING id, revision INTO v_filter_id, v_revision;

  DELETE FROM public.auto_account_contact_group_dynamic_filter_rules
  WHERE dynamic_filter_id = v_filter_id;

  WITH raw_rule AS MATERIALIZED (
    SELECT
      input.value AS rule,
      input.ordinality::integer AS ordinality,
      row_number() OVER (
        PARTITION BY input.value->>'scope_code'
        ORDER BY COALESCE((input.value->>'sort_order')::integer, input.ordinality::integer), input.ordinality
      ) AS scope_position
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb))
      WITH ORDINALITY AS input(value, ordinality)
  ), normalized_rule AS MATERIALIZED (
    SELECT
      raw_rule.rule->>'scope_code' AS scope_code,
      CASE WHEN raw_rule.scope_position = 1 THEN 'and'
        ELSE COALESCE(NULLIF(raw_rule.rule->>'join_code', ''), 'and') END AS join_code,
      raw_rule.rule->>'field_code' AS field_code,
      raw_rule.rule->>'operator_code' AS operator_code,
      NULLIF(raw_rule.rule->>'account_id', '')::bigint AS account_id,
      COALESCE((raw_rule.rule->>'sort_order')::integer, raw_rule.ordinality) AS sort_order,
      raw_rule.rule->'value_keys' AS value_keys,
      raw_rule.rule->'value_labels' AS value_labels
    FROM raw_rule
  )
  INSERT INTO public.auto_account_contact_group_dynamic_filter_rules (
    dynamic_filter_id,
    scope_category_item_id,
    join_category_item_id,
    field_category_item_id,
    operator_category_item_id,
    account_id,
    sort_order,
    value_keys,
    value_labels
  )
  SELECT
    v_filter_id,
    scope_item.id,
    join_item.id,
    field_item.id,
    operator_item.id,
    normalized_rule.account_id,
    normalized_rule.sort_order,
    normalized_rule.value_keys,
    normalized_rule.value_labels
  FROM normalized_rule
  JOIN public.category_type AS scope_type
    ON scope_type.namespace = 'common' AND scope_type.code = 'data_filter_scope'
  JOIN public.category_item AS scope_item
    ON scope_item.category_type_id = scope_type.id
   AND scope_item.code = normalized_rule.scope_code AND scope_item.is_active = true
  JOIN public.category_type AS join_type
    ON join_type.namespace = 'common' AND join_type.code = 'data_filter_join'
  JOIN public.category_item AS join_item
    ON join_item.category_type_id = join_type.id
   AND join_item.code = normalized_rule.join_code AND join_item.is_active = true
  JOIN public.category_type AS field_type
    ON field_type.namespace = 'common' AND field_type.code = 'data_filter_field'
  JOIN public.category_item AS field_item
    ON field_item.category_type_id = field_type.id
   AND field_item.code = normalized_rule.field_code AND field_item.is_active = true
  JOIN public.category_type AS operator_type
    ON operator_type.namespace = 'common' AND operator_type.code = 'data_filter_operator'
  JOIN public.category_item AS operator_item
    ON operator_item.category_type_id = operator_type.id
   AND operator_item.code = normalized_rule.operator_code AND operator_item.is_active = true
   AND field_item.metadata->'operators' ? operator_item.code
  LEFT JOIN public.auto_accounts AS account
    ON account.id = normalized_rule.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = p_organization_id
   AND account.flatform_type = 'zalo'
  WHERE normalized_rule.account_id IS NULL OR account.id IS NOT NULL;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> v_rule_count THEN
    RAISE EXCEPTION 'dynamic_filter_rule_category_or_account_invalid';
  END IF;

  RETURN jsonb_build_object(
    'filter_id', v_filter_id,
    'group_id', p_group_id,
    'revision', v_revision,
    'rule_count', v_inserted_count,
    'queued_count', v_queued_count,
    'effective_from_at', v_effective_from_at
  );
END;
$function$;

DROP TRIGGER IF EXISTS trg_aka_agent_dynamic_filter_stamp_queue_event
  ON public.auto_account_contact_dynamic_filter_queue;
CREATE TRIGGER trg_aka_agent_dynamic_filter_stamp_queue_event
BEFORE INSERT OR UPDATE ON public.auto_account_contact_dynamic_filter_queue
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_dynamic_filter_stamp_queue_event();

ALTER FUNCTION public.aka_agent_dynamic_filter_stamp_queue_event() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_dynamic_filter_stamp_queue_event()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_dynamic_filter_stamp_queue_event() TO postgres;

ALTER FUNCTION public.aka_agent_save_data_group_dynamic_filter(
  bigint,bigint,bigint,boolean,jsonb,text,text
) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.aka_agent_save_data_group_dynamic_filter(
  bigint,bigint,bigint,boolean,jsonb,text,text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_save_data_group_dynamic_filter(
  bigint,bigint,bigint,boolean,jsonb,text,text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_save_data_group_dynamic_filter(
  bigint,bigint,bigint,boolean,jsonb,text,text
) IS 'Atomically replaces category-backed rules with a forward-only effective cutoff; historical contacts are not enqueued.';
COMMENT ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) IS 'Single-worker contact queue processor; each filter sees only events at or after its current effective cutoff.';

DO $postflight$
DECLARE
  v_save oid := pg_catalog.to_regprocedure(
    'public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)'
  );
  v_process oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  );
  v_stamp oid := pg_catalog.to_regprocedure(
    'public.aka_agent_dynamic_filter_stamp_queue_event()'
  );
  v_valid boolean;
BEGIN
  IF v_save IS NULL OR v_process IS NULL OR v_stamp IS NULL THEN
    RAISE EXCEPTION 'v252_target_signature_missing';
  END IF;

  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_save))
      IS DISTINCT FROM '5c8507459cb2dc0e39b2b8906f6047ee'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
      IS DISTINCT FROM '0b7d7dcf67514fa7a959f5a56fd72e7b'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_stamp))
      IS DISTINCT FROM '82ca61f3031b277dbeceb8d3bfd14a14'
  THEN
    RAISE EXCEPTION 'v252_target_checksum_mismatch';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auto_account_contact_group_dynamic_filters'
        AND column_name = 'effective_from_at'
        AND is_nullable = 'NO'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auto_account_contact_dynamic_filter_queue'
        AND column_name = 'last_event_at'
        AND is_nullable = 'NO'
    )
  THEN
    RAISE EXCEPTION 'v252_target_column_contract_mismatch';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
    AND proc.prosecdef = true
    AND proc.provolatile = 'v'
    AND proc.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
    AND pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    AND pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND proc.proacl IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(proc.proacl) AS acl
      WHERE acl.grantee <> ALL(ARRAY[
        pg_catalog.to_regrole('postgres')::oid,
        pg_catalog.to_regrole('anon')::oid,
        pg_catalog.to_regrole('authenticated')::oid,
        pg_catalog.to_regrole('service_role')::oid
      ]) OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable
    )
  INTO v_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_save;
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v252_save_metadata_or_acl_mismatch';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
    AND proc.prosecdef = true
    AND proc.provolatile = 'v'
    AND proc.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
    AND pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    AND pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND proc.proacl IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(proc.proacl) AS acl
      WHERE acl.grantee <> ALL(ARRAY[
        pg_catalog.to_regrole('postgres')::oid,
        pg_catalog.to_regrole('anon')::oid,
        pg_catalog.to_regrole('authenticated')::oid,
        pg_catalog.to_regrole('service_role')::oid
      ]) OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable
    )
  INTO v_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_process;
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v252_process_metadata_or_acl_mismatch';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
    AND proc.prosecdef = true
    AND proc.provolatile = 'v'
    AND proc.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
    AND proc.proacl IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(proc.proacl) AS acl
      WHERE acl.grantee <> pg_catalog.to_regrole('postgres')::oid
        OR acl.privilege_type <> 'EXECUTE'
        OR acl.is_grantable
    )
  INTO v_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_stamp;
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v252_stamp_metadata_or_acl_mismatch';
  END IF;

  IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_save),
      'pg_advisory_xact_lock'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_save),
      'INSERT INTO public.auto_account_contact_dynamic_filter_queue'
    ) <> 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_process),
      'dynamic_filter.effective_from_at <= v_queue.last_event_at'
    ) = 0
  THEN
    RAISE EXCEPTION 'v252_forward_only_behavior_marker_missing';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
