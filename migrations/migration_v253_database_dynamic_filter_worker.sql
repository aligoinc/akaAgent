-- Run Data Group dynamic filters entirely from the shared database queue.
--
-- The desktop RPC remains backward compatible, but delegates to a private core
-- that is also used by one bounded pg_cron worker. Zalo local, Zalo Server and
-- Chat API therefore share the same event queue and evaluator without requiring
-- any client process to stay online.
--
-- Live source captured from linked project cgjbsmqtfhqvttudyjzq on 2026-08-25:
--   aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)
--     md5(pg_get_functiondef) = 0b7d7dcf67514fa7a959f5a56fd72e7b
--     owner=postgres, SECURITY DEFINER, VOLATILE,
--     search_path=pg_catalog, public,
--     ACL=postgres/anon/authenticated/service_role EXECUTE
--
-- Target checksums captured from linked-project rollback validation:
--   aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)
--     md5(pg_get_functiondef) = 4e855f4769b4f5537bdf351d9f20c6b6
--   aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)
--     md5(pg_get_functiondef) = e384f8113c0166531de3eacd724d7241
--   aka_agent_run_data_group_dynamic_filter_worker(integer,integer)
--     md5(pg_get_functiondef) = 56510e2f6e8450b684486336e773746d

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE
  v_process oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  );
  v_core oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'
  );
  v_worker oid := pg_catalog.to_regprocedure(
    'public.aka_agent_run_data_group_dynamic_filter_worker(integer,integer)'
  );
  v_job_count integer;
  v_global_index_exists boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE EXCEPTION 'v253_pg_cron_missing';
  END IF;

  SELECT count(*)::integer INTO v_job_count
  FROM cron.job
  WHERE jobname = 'aka-agent-data-group-dynamic-filter-worker';

  SELECT pg_catalog.to_regclass(
    'public.idx_data_group_dynamic_filter_queue_global_due'
  ) IS NOT NULL INTO v_global_index_exists;

  IF v_core IS NULL
    AND v_worker IS NULL
    AND v_job_count = 0
    AND NOT v_global_index_exists
  THEN
    IF v_process IS NULL
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
        IS DISTINCT FROM '0b7d7dcf67514fa7a959f5a56fd72e7b'
    THEN
      RAISE EXCEPTION 'v253_process_dynamic_filter_missing_or_changed';
    END IF;
  ELSIF v_core IS NOT NULL
    AND v_worker IS NOT NULL
    AND v_job_count = 1
    AND v_global_index_exists
  THEN
    IF v_process IS NULL
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
        IS DISTINCT FROM '4e855f4769b4f5537bdf351d9f20c6b6'
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core))
        IS DISTINCT FROM 'e384f8113c0166531de3eacd724d7241'
      OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_worker))
        IS DISTINCT FROM '56510e2f6e8450b684486336e773746d'
    THEN
      RAISE EXCEPTION 'v253_database_worker_target_changed';
    END IF;
  ELSE
    RAISE EXCEPTION 'v253_database_worker_partial_state';
  END IF;
END;
$preflight$;

CREATE INDEX IF NOT EXISTS idx_data_group_dynamic_filter_queue_global_due
  ON public.auto_account_contact_dynamic_filter_queue (
    queued_at, contact_id, staff_id, organization_id
  );

-- Exact v252 live processor body with only the credential assertion removed.
-- This function is private to postgres; the public wrapper below still performs
-- the exact existing tenant credential assertion before delegating here.
CREATE OR REPLACE FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(
  p_staff_id bigint,
  p_organization_id bigint,
  p_limit integer
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

-- Preserve the exact public signature and authentication behavior for old apps.
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
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  RETURN public.aka_agent_process_data_group_dynamic_filters_core(
    p_staff_id, p_organization_id, p_limit
  );
END;
$function$;

-- One global, bounded driver. It selects at most five distinct due tenants,
-- processes at most 100 contacts for each tenant and will not start another
-- tenant after its 20-second budget is exhausted. The queue remains the retry
-- boundary; there is no tight loop when a backlog exists.
CREATE OR REPLACE FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(
  p_tenant_limit integer,
  p_contact_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tenant_limit integer := LEAST(20, GREATEST(1, COALESCE(p_tenant_limit, 5)));
  v_contact_limit integer := LEAST(200, GREATEST(1, COALESCE(p_contact_limit, 100)));
  v_started_at timestamptz := clock_timestamp();
  v_deadline timestamptz := v_started_at + interval '20 seconds';
  v_seen_tenants text[] := ARRAY[]::text[];
  v_tenant record;
  v_tenant_key text;
  v_result jsonb;
  v_tenants integer := 0;
  v_processed bigint := 0;
  v_pairs bigint := 0;
  v_entered bigint := 0;
  v_exited bigint := 0;
  v_busy_tenants integer := 0;
  v_has_more boolean := false;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:database-worker', 0)
  ) THEN
    RETURN jsonb_build_object(
      'tenant_count', 0,
      'processed_contact_count', 0,
      'evaluated_pair_count', 0,
      'entered_count', 0,
      'exited_count', 0,
      'busy_tenant_count', 0,
      'has_more', EXISTS (
        SELECT 1 FROM public.auto_account_contact_dynamic_filter_queue AS queue
        WHERE queue.queued_at <= clock_timestamp()
      ),
      'busy', true
    );
  END IF;

  FOR v_iteration IN 1..v_tenant_limit LOOP
    EXIT WHEN clock_timestamp() >= v_deadline;

    SELECT queue.staff_id, queue.organization_id
    INTO v_tenant
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.queued_at <= clock_timestamp()
      AND NOT (
        (queue.staff_id::text || ':' || queue.organization_id::text)
        = ANY (v_seen_tenants)
      )
    ORDER BY queue.queued_at, queue.contact_id
    LIMIT 1;

    EXIT WHEN NOT FOUND;
    v_tenant_key := v_tenant.staff_id::text || ':' || v_tenant.organization_id::text;
    v_seen_tenants := pg_catalog.array_append(v_seen_tenants, v_tenant_key);
    v_tenants := v_tenants + 1;

    v_result := public.aka_agent_process_data_group_dynamic_filters_core(
      v_tenant.staff_id,
      v_tenant.organization_id,
      v_contact_limit
    );

    v_processed := v_processed
      + COALESCE((v_result->>'processed_contact_count')::bigint, 0);
    v_pairs := v_pairs
      + COALESCE((v_result->>'evaluated_pair_count')::bigint, 0);
    v_entered := v_entered
      + COALESCE((v_result->>'entered_count')::bigint, 0);
    v_exited := v_exited
      + COALESCE((v_result->>'exited_count')::bigint, 0);
    IF COALESCE((v_result->>'busy')::boolean, false) THEN
      v_busy_tenants := v_busy_tenants + 1;
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.queued_at <= clock_timestamp()
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'tenant_count', v_tenants,
    'processed_contact_count', v_processed,
    'evaluated_pair_count', v_pairs,
    'entered_count', v_entered,
    'exited_count', v_exited,
    'busy_tenant_count', v_busy_tenants,
    'has_more', v_has_more,
    'busy', false,
    'elapsed_ms', GREATEST(
      0,
      floor(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000)::bigint
    )
  );
END;
$function$;

ALTER FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(
  bigint,bigint,integer
) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(
  integer,integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(
  bigint,bigint,integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(
  integer,integer
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(
  bigint,bigint,integer
) TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(
  integer,integer
) TO postgres;

COMMENT ON FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(
  bigint,bigint,integer
) IS 'Private bounded dynamic-filter queue evaluator shared by the credentialed legacy RPC and the database cron worker.';
COMMENT ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  bigint,bigint,integer,text,text
) IS 'Backward-compatible credentialed wrapper for the shared database dynamic-filter evaluator.';
COMMENT ON FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(
  integer,integer
) IS 'Postgres-only global driver: bounded tenants, bounded contacts and a per-run time budget; consumes only due queue rows.';

SELECT cron.schedule(
  'aka-agent-data-group-dynamic-filter-worker',
  '30 seconds',
  'SELECT public.aka_agent_run_data_group_dynamic_filter_worker(5, 100);'
);

DO $postflight$
DECLARE
  v_process oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  );
  v_core oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'
  );
  v_worker oid := pg_catalog.to_regprocedure(
    'public.aka_agent_run_data_group_dynamic_filter_worker(integer,integer)'
  );
  v_valid boolean;
BEGIN
  IF v_process IS NULL OR v_core IS NULL OR v_worker IS NULL THEN
    RAISE EXCEPTION 'v253_target_signature_missing';
  END IF;

  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
      IS DISTINCT FROM '4e855f4769b4f5537bdf351d9f20c6b6'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core))
      IS DISTINCT FROM 'e384f8113c0166531de3eacd724d7241'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_worker))
      IS DISTINCT FROM '56510e2f6e8450b684486336e773746d'
  THEN
    RAISE EXCEPTION 'v253_target_checksum_mismatch';
  END IF;

  IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_process),
      'auto_assert_automation_identity'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_core),
      'dynamic_filter.effective_from_at <= v_queue.last_event_at'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_core),
      'pg_try_advisory_xact_lock'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_worker),
      'v_deadline'
    ) = 0
  THEN
    RAISE EXCEPTION 'v253_database_worker_behavior_marker_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'aka-agent-data-group-dynamic-filter-worker'
      AND schedule = '30 seconds'
      AND command = 'SELECT public.aka_agent_run_data_group_dynamic_filter_worker(5, 100);'
      AND active = true
      AND username = 'postgres'
      AND database = current_database()
  ) THEN
    RAISE EXCEPTION 'v253_database_worker_cron_contract_mismatch';
  END IF;

  IF (
    SELECT pg_catalog.pg_get_indexdef(index_oid)
    FROM pg_catalog.pg_class AS index_class
    CROSS JOIN LATERAL (SELECT index_class.oid AS index_oid) AS resolved
    WHERE index_class.oid = pg_catalog.to_regclass(
      'public.idx_data_group_dynamic_filter_queue_global_due'
    )
  ) IS DISTINCT FROM
    'CREATE INDEX idx_data_group_dynamic_filter_queue_global_due ON public.auto_account_contact_dynamic_filter_queue USING btree (queued_at, contact_id, staff_id, organization_id)'
  THEN
    RAISE EXCEPTION 'v253_database_worker_index_contract_mismatch';
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
    RAISE EXCEPTION 'v253_process_metadata_or_acl_mismatch';
  END IF;

  SELECT bool_and(
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
  )
  INTO v_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid IN (v_core, v_worker);
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v253_private_function_metadata_or_acl_mismatch';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
