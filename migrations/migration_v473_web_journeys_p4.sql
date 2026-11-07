-- V473 phần 4/4: Quy trình tự động trên Web (ghi kết quả, hai RPC public, khóa quyền, kiểm tra cuối), production cgjbsmqtfhqvttudyjzq only.
-- Apply sau p3; mỗi phần một giao dịch. Hợp đồng và lý do tách: đầu migration_v473_web_journeys_p1.sql.
-- Kiểm tra cuối (postflight) bao quát cả bốn phần. Rollback: migrations/rollback_v473_web_journeys.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Phần trước phải đã commit (hàm cuối của nó có mặt); phần này chưa chạy (hàm đầu của nó chưa có).
DO $guard_p4$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'private' AND p.proname = 'aka_agent_journey_group_members') THEN
    RAISE EXCEPTION 'v473_p4_requires_p3';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private' AND p.proname = 'aka_agent_journey_engine_apply')
     OR to_regprocedure('public.aka_agent_journey_control(bigint,bigint,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_journey_engine(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v473_p4_already_applied_do_not_overwrite';
  END IF;
END
$guard_p4$;

-- Apply: write each EngineResult (journey-core advanceEnrollment) in its own subtransaction. A result whose
-- lease token no longer matches is "lost"; a failing result keeps its lease (it expires and is claimed again).
CREATE FUNCTION private.aka_agent_journey_engine_apply(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_token uuid := private.aka_agent_journey_engine_lease(p_payload);
  v_allowed_kinds text[] := ARRAY['step', 'wait', 'branch', 'dispatch', 'result', 'defer', 'group', 'task', 'complete', 'exit', 'error'];
  res jsonb;
  e public.auto_journey_enrollments%ROWTYPE;
  v_eid bigint;
  v_status text;
  v_phase text;
  v_step text;
  v_next timestamptz;
  v_attempts integer;
  v_defer_last text;
  v_sticky bigint;
  v_zalo text;
  v_step_entered timestamptz;
  v_pending_outcome text;
  v_pending_reason text;
  v_events jsonb;
  v_extra_events jsonb;
  d jsonb;
  v_d_step text;
  v_d_campaign bigint;
  v_d_account bigint;
  v_d_action text;
  v_d_key text;
  v_input jsonb;
  v_campaign_ok boolean;
  v_campaign_status text;
  v_campaign_schedule timestamptz;
  v_input_id bigint;
  v_input_status text;
  v_mode text;
  v_defer_until timestamptz;
  v_defer_reason text;
  v_defer_code text;
  v_deadline_days numeric;
  v_local_stats jsonb;
  v_stats jsonb := '{}'::jsonb;
  v_stat jsonb;
  v_op jsonb;
  v_group bigint;
  v_op_step text;
  v_row jsonb;
  v_members bigint[];
  v_err text;
  v_last_err text;
  v_applied integer := 0;
  v_dispatched integer := 0;
  v_deferred integer := 0;
  v_lost integer := 0;
  v_failed integer := 0;
BEGIN
  IF jsonb_typeof(p_payload -> 'results') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload -> 'results') > 500 THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  FOR res IN SELECT x.value FROM jsonb_array_elements(p_payload -> 'results') x LOOP
    v_eid := CASE WHEN jsonb_typeof(res) = 'object' THEN private.aka_agent_journey_bigint(res -> 'enrollmentId') END;
    IF v_eid IS NULL THEN
      v_failed := v_failed + 1;
      CONTINUE;
    END IF;
    BEGIN
      SELECT * INTO e FROM public.auto_journey_enrollments
      WHERE id = v_eid AND lease_token = v_token AND status = 'active'
      FOR UPDATE;
      IF NOT FOUND THEN
        v_lost := v_lost + 1;
        CONTINUE;
      END IF;

      v_status := res ->> 'status';
      v_phase := res ->> 'phase';
      v_step := res ->> 'stepId';
      IF v_status IS NULL OR v_status NOT IN ('active', 'completed', 'exited', 'failed')
         OR v_phase IS NULL OR v_phase NOT IN ('ready', 'waiting', 'awaiting', 'result')
         OR (v_step IS NOT NULL AND char_length(v_step) NOT BETWEEN 1 AND 100) THEN
        RAISE EXCEPTION 'journey_invalid_result';
      END IF;
      v_next := (res ->> 'nextRunAt')::timestamptz;
      v_step_entered := (res ->> 'stepEnteredAt')::timestamptz;
      v_attempts := least(coalesce(private.aka_agent_journey_bigint(res -> 'attempts'), 0), 100000)::integer;
      -- Mã lý do hoãn gần nhất của bước: dòng thời gian ghi thêm khi lý do đổi (ngoài giờ gửi → tài khoản chưa sẵn sàng).
      v_defer_last := CASE WHEN char_length(res ->> 'deferCode') BETWEEN 1 AND 40 THEN res ->> 'deferCode' END;
      v_sticky := private.aka_agent_journey_bigint(res -> 'stickyAccountId');
      v_zalo := coalesce(res ->> 'zaloStatus', e.zalo_status);
      IF v_zalo NOT IN ('unknown', 'has_zalo', 'no_zalo') THEN
        RAISE EXCEPTION 'journey_invalid_result';
      END IF;
      v_events := CASE WHEN jsonb_typeof(res -> 'events') = 'array' THEN res -> 'events' ELSE '[]'::jsonb END;
      v_extra_events := '[]'::jsonb;
      v_pending_outcome := CASE WHEN v_phase = 'result' THEN e.pending_outcome END;
      v_pending_reason := CASE WHEN v_phase = 'result' THEN e.pending_reason END;
      v_local_stats := '{}'::jsonb;
      v_mode := 'none';
      v_input_id := NULL;
      v_input_status := NULL;

      d := res -> 'dispatch';
      IF jsonb_typeof(d) = 'object' AND v_status = 'active' THEN
        v_d_step := d ->> 'stepId';
        v_d_campaign := private.aka_agent_journey_bigint(d -> 'campaignId');
        v_d_account := private.aka_agent_journey_bigint(d -> 'accountId');
        v_d_action := nullif(d ->> 'actionCode', '');
        v_d_key := d ->> 'idempotencyKey';
        v_input := d -> 'input';
        IF v_d_step IS NULL OR char_length(v_d_step) NOT BETWEEN 1 AND 100 OR v_d_campaign IS NULL OR v_d_account IS NULL
           OR v_d_action IS NULL OR jsonb_typeof(v_input) IS DISTINCT FROM 'object'
           OR v_d_key IS DISTINCT FROM ('journey:' || e.id::text || ':' || v_d_step) THEN
          RAISE EXCEPTION 'journey_invalid_result';
        END IF;
        v_campaign_ok := NULL;
        SELECT c.staff_id = e.staff_id AND c.organization_id = e.organization_id AND c.is_delete IS NOT TRUE
               AND c.account_id = v_d_account AND c.action_id = v_d_action
        INTO v_campaign_ok
        FROM public.auto_campaigns c WHERE c.id = v_d_campaign;
        IF v_campaign_ok IS NOT TRUE THEN
          v_mode := 'invalid';
        ELSE
          -- Same order as every other writer: campaign serialization lock, then the one campaign row.
          PERFORM public.aka_agent_lock_campaign_input_serialization(v_d_campaign);
          SELECT c.status, c.schedule, c.is_delete IS NOT TRUE INTO v_campaign_status, v_campaign_schedule, v_campaign_ok
          FROM public.auto_campaigns c WHERE c.id = v_d_campaign FOR UPDATE;
          IF v_campaign_ok IS NOT TRUE THEN
            v_mode := 'invalid';
          ELSE
            SELECT i.id, i.status INTO v_input_id, v_input_status
            FROM public.auto_campaign_input_data i
            WHERE i.campaign_id = v_d_campaign AND i.control_append_idempotency_key = v_d_key AND i.control_append_row_index = 0;
            IF v_input_id IS NOT NULL THEN
              v_mode := 'dispatched';
            ELSIF v_campaign_status = 'đang chạy' THEN
              v_mode := 'defer';
              v_defer_until := now() + interval '60 seconds';
              v_defer_code := 'campaign_running';
              v_defer_reason := 'Chiến dịch của bước đang chạy lượt trước; khách vào lượt kế tiếp.';
            ELSIF v_campaign_status = 'tạm dừng' THEN
              v_mode := 'defer';
              v_defer_until := now() + interval '15 minutes';
              v_defer_code := 'campaign_paused';
              v_defer_reason := 'Chiến dịch chạy bước này đang tạm dừng; khách chờ tới khi chiến dịch được bật lại.';
            ELSE
              INSERT INTO public.auto_campaign_input_data (
                campaign_id, input_id, name, phone, phone_carrier, uid, email, info1, info2, info3, info4, info5, content,
                status, note, schedule, is_delete, created_at, control_append_idempotency_key, control_append_row_index)
              VALUES (
                v_d_campaign, NULL, nullif(v_input ->> 'name', ''), nullif(v_input ->> 'phone', ''),
                nullif(v_input ->> 'phoneCarrier', ''), nullif(v_input ->> 'uid', ''), nullif(v_input ->> 'email', ''),
                nullif(v_input ->> 'info1', ''), nullif(v_input ->> 'info2', ''), nullif(v_input ->> 'info3', ''),
                nullif(v_input ->> 'info4', ''), nullif(v_input ->> 'info5', ''), nullif(v_input ->> 'content', ''),
                'chờ xử lý', NULL, now(), false, now(), v_d_key, 0)
              RETURNING id INTO v_input_id;
              v_input_status := 'chờ xử lý';
              v_mode := 'dispatched';
            END IF;
            IF v_mode = 'dispatched' THEN
              IF v_campaign_status = 'hoàn thành' AND v_input_status = 'chờ xử lý' THEN
                UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now(), updated_at = now() WHERE id = v_d_campaign;
              ELSIF v_campaign_status = 'chờ xử lý' AND v_campaign_schedule > now()
                AND EXISTS (SELECT 1 FROM public.auto_journey_step_campaigns sc
                            WHERE sc.campaign_id = v_d_campaign AND sc.journey_id = e.journey_id) THEN
                UPDATE public.auto_campaigns SET schedule = now(), updated_at = now() WHERE id = v_d_campaign;
              END IF;
              v_deadline_days := CASE WHEN jsonb_typeof(res -> 'deadlineDays') = 'number'
                THEN least(greatest((res ->> 'deadlineDays')::numeric, 0.01), 30) ELSE 3 END;
              INSERT INTO public.auto_journey_step_runs (journey_id, enrollment_id, version_id, staff_id, organization_id, contact_key,
                step_id, account_id, campaign_id, action_code, input_data_id, status, dispatched_at, next_check_at, deadline_at)
              VALUES (e.journey_id, e.id, e.version_id, e.staff_id, e.organization_id, e.contact_key, v_d_step, v_d_account,
                v_d_campaign, v_d_action, v_input_id, 'dispatched', now(), now() + interval '1 minute',
                now() + make_interval(secs => (v_deadline_days * 86400)::double precision))
              ON CONFLICT (enrollment_id, step_id) DO UPDATE
              SET account_id = EXCLUDED.account_id, campaign_id = EXCLUDED.campaign_id, action_code = EXCLUDED.action_code,
                  input_data_id = EXCLUDED.input_data_id, version_id = EXCLUDED.version_id, status = 'dispatched', outcome = NULL,
                  reason = NULL, dispatched_at = EXCLUDED.dispatched_at, next_check_at = EXCLUDED.next_check_at, check_count = 0,
                  deadline_at = EXCLUDED.deadline_at, settled_at = NULL;
            END IF;
          END IF;
        END IF;
      END IF;

      IF v_mode IN ('defer', 'invalid') THEN
        -- Nothing was queued: keep the old sticky account and drop the "dispatch" events.
        v_sticky := e.sticky_account_id;
        v_events := (SELECT coalesce(jsonb_agg(x.value ORDER BY x.ord), '[]'::jsonb)
                     FROM jsonb_array_elements(v_events) WITH ORDINALITY x(value, ord)
                     WHERE x.value ->> 'kind' IS DISTINCT FROM 'dispatch');
        IF v_mode = 'defer' THEN
          IF v_attempts = 0 THEN
            v_local_stats := private.aka_agent_journey_stat_add(v_local_stats, e.journey_id, v_d_step, 'deferred', 1);
          END IF;
          IF v_attempts = 0 OR v_defer_last IS DISTINCT FROM v_defer_code THEN
            v_extra_events := jsonb_build_array(jsonb_build_object('stepId', v_d_step, 'kind', 'defer', 'message', v_defer_reason,
              'data', jsonb_build_object('code', v_defer_code, 'until', v_defer_until)));
          END IF;
          v_defer_last := v_defer_code;
          v_attempts := v_attempts + 1;
          v_phase := 'ready';
          v_next := v_defer_until;
        ELSE
          v_phase := 'result';
          v_pending_outcome := 'failed';
          v_pending_reason := 'Chiến dịch chạy bước này không còn hợp lệ';
          v_next := now();
        END IF;
      END IF;
      IF v_status = 'active' AND v_next IS NULL THEN
        v_next := CASE WHEN v_phase = 'result' THEN now() WHEN v_phase = 'awaiting' THEN NULL ELSE now() + interval '10 minutes' END;
      END IF;

      UPDATE public.auto_journey_enrollments
      SET status = v_status, step_id = v_step,
          phase = CASE WHEN v_status = 'active' THEN v_phase ELSE 'ready' END,
          next_run_at = CASE WHEN v_status = 'active' THEN v_next END,
          paused_next_run_at = NULL,
          pending_outcome = CASE WHEN v_status = 'active' AND v_phase = 'result' THEN v_pending_outcome END,
          pending_reason = CASE WHEN v_status = 'active' AND v_phase = 'result' THEN v_pending_reason END,
          sticky_account_id = v_sticky, zalo_status = v_zalo, attempts = v_attempts,
          defer_code = CASE WHEN v_status = 'active' AND v_attempts > 0 THEN v_defer_last END,
          step_entered_at = v_step_entered,
          exit_code = CASE WHEN v_status <> 'active' THEN left(res ->> 'exitCode', 100) END,
          exit_reason = CASE WHEN v_status <> 'active' THEN left(res ->> 'exitReason', 1000) END,
          finished_at = CASE WHEN v_status <> 'active' THEN now() END,
          lease_token = NULL, lease_until = NULL, last_error = NULL, last_error_at = NULL, updated_at = now()
      WHERE id = e.id;

      INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message, data)
      SELECT e.journey_id, e.id, left(x.value ->> 'stepId', 100), x.value ->> 'kind', left(coalesce(x.value ->> 'message', ''), 1000),
        CASE WHEN jsonb_typeof(x.value -> 'data') = 'object' THEN x.value -> 'data' END
      FROM jsonb_array_elements(v_events || v_extra_events) WITH ORDINALITY x(value, ord)
      WHERE jsonb_typeof(x.value) = 'object' AND (x.value ->> 'kind') = ANY(v_allowed_kinds)
      ORDER BY x.ord
      LIMIT 20;

      FOR v_stat IN SELECT x.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(res -> 'stats') = 'array'
          THEN res -> 'stats' ELSE '[]'::jsonb END) x LOOP
        IF jsonb_typeof(v_stat) = 'object' AND v_stat ->> 'stepId' IS NOT NULL AND v_stat ->> 'stepId' <> '*'
           AND char_length(v_stat ->> 'stepId') <= 100
           AND (v_stat ->> 'field') ~ '^(entered|passed|deferred|exited|completed|exit_[A-Za-z0-9_-]{1,40})$' THEN
          v_local_stats := private.aka_agent_journey_stat_add(v_local_stats, e.journey_id, v_stat ->> 'stepId', v_stat ->> 'field', 1);
        END IF;
      END LOOP;
      IF v_status <> 'active' THEN
        v_local_stats := private.aka_agent_journey_stat_add(v_local_stats, e.journey_id, '*', v_status, 1);
      END IF;

      -- Data group steps: a failing group never fails the result; the customer timeline shows it.
      FOR v_op IN SELECT x.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(res -> 'groupOps') = 'array'
          THEN res -> 'groupOps' ELSE '[]'::jsonb END) WITH ORDINALITY x(value, ord) WHERE x.ord <= 20 ORDER BY x.ord LOOP
        v_group := private.aka_agent_journey_bigint(v_op -> 'groupId');
        v_op_step := left(coalesce(v_op ->> 'stepId', ''), 100);
        CONTINUE WHEN v_group IS NULL OR v_op_step = '' OR coalesce(v_op ->> 'op', '') NOT IN ('add', 'remove');
        BEGIN
          IF v_op ->> 'op' = 'add' THEN
            v_row := private.aka_agent_journey_group_row(e.contact);
            IF v_row IS NULL THEN
              RAISE EXCEPTION 'journey_contact_missing';
            END IF;
            PERFORM public.aka_agent_ingest_data_group(e.staff_id, e.organization_id,
              'journey:' || e.id::text || ':' || v_op_step || ':add', v_group, 'automation'::text, jsonb_build_array(v_row),
              NULL::bigint, NULL::text, NULL::text, NULL::bigint, 'Quy trình tự động'::text, NULL::text);
          ELSE
            v_members := private.aka_agent_journey_group_members(e.staff_id, e.organization_id, v_group, e.contact_key, e.contact,
              e.source_group_id, e.source_ref);
            IF coalesce(cardinality(v_members), 0) > 0 THEN
              PERFORM public.aka_agent_remove_data_group_members(e.staff_id, e.organization_id,
                'journey:' || e.id::text || ':' || v_op_step || ':remove', v_group, v_members);
            END IF;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message, data)
          VALUES (e.journey_id, e.id, v_op_step, 'error',
            CASE WHEN v_op ->> 'op' = 'add' THEN 'Không thêm được khách vào nhóm data.' ELSE 'Không bỏ được khách khỏi nhóm data.' END,
            jsonb_build_object('groupId', v_group, 'error', left(SQLERRM, 200)));
        END;
      END LOOP;

      INSERT INTO public.auto_journey_tasks (journey_id, enrollment_id, staff_id, organization_id, step_id, note)
      SELECT e.journey_id, e.id, e.staff_id, e.organization_id, left(t.value ->> 'stepId', 100), left(coalesce(t.value ->> 'note', ''), 500)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(res -> 'tasks') = 'array' THEN res -> 'tasks' ELSE '[]'::jsonb END)
        WITH ORDINALITY t(value, ord)
      WHERE jsonb_typeof(t.value) = 'object' AND nullif(t.value ->> 'stepId', '') IS NOT NULL AND t.ord <= 20
      ON CONFLICT (enrollment_id, step_id) DO NOTHING;

      -- Counters only move once the whole result is written.
      v_stats := private.aka_agent_journey_stats_merge(v_stats, v_local_stats);
      v_applied := v_applied + 1;
      IF v_mode = 'dispatched' THEN
        v_dispatched := v_dispatched + 1;
      ELSIF v_mode = 'defer' THEN
        v_deferred := v_deferred + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_err := left(SQLERRM, 500);
      v_last_err := v_err;
      UPDATE public.auto_journey_enrollments SET last_error = v_err, last_error_at = now()
      WHERE id = v_eid AND lease_token = v_token;
    END;
  END LOOP;
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  IF v_last_err IS NOT NULL THEN
    UPDATE public.auto_journey_engine_state SET last_error = 'apply: ' || v_last_err, last_error_at = now(), updated_at = now()
    WHERE id = 1;
  END IF;
  RETURN jsonb_build_object('applied', v_applied, 'dispatched', v_dispatched, 'deferred', v_deferred, 'lost', v_lost,
    'failed', v_failed);
END
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- Public RPCs (service_role only)
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.aka_agent_journey_control(p_staff_id bigint, p_organization_id bigint, p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  CASE p_action
    WHEN 'access' THEN RETURN private.aka_agent_journey_ctl_access(p_staff_id, p_organization_id);
    WHEN 'list' THEN RETURN private.aka_agent_journey_ctl_list(p_staff_id, p_organization_id);
    WHEN 'get' THEN RETURN private.aka_agent_journey_ctl_get(p_staff_id, p_organization_id, v_payload);
    WHEN 'create' THEN RETURN private.aka_agent_journey_ctl_create(p_staff_id, p_organization_id, v_payload);
    WHEN 'save_draft' THEN RETURN private.aka_agent_journey_ctl_save_draft(p_staff_id, p_organization_id, v_payload);
    WHEN 'publish_prepare' THEN RETURN private.aka_agent_journey_ctl_publish_prepare(p_staff_id, p_organization_id, v_payload);
    WHEN 'publish' THEN RETURN private.aka_agent_journey_ctl_publish(p_staff_id, p_organization_id, v_payload);
    WHEN 'set_status' THEN RETURN private.aka_agent_journey_ctl_set_status(p_staff_id, p_organization_id, v_payload);
    WHEN 'delete' THEN RETURN private.aka_agent_journey_ctl_delete(p_staff_id, p_organization_id, v_payload);
    WHEN 'enrollments' THEN RETURN private.aka_agent_journey_ctl_enrollments(p_staff_id, p_organization_id, v_payload);
    WHEN 'enrollment' THEN RETURN private.aka_agent_journey_ctl_enrollment(p_staff_id, p_organization_id, v_payload);
    WHEN 'exit_enrollment' THEN RETURN private.aka_agent_journey_ctl_exit_enrollment(p_staff_id, p_organization_id, v_payload);
    WHEN 'test_enroll' THEN RETURN private.aka_agent_journey_ctl_test_enroll(p_staff_id, p_organization_id, v_payload);
    WHEN 'tasks' THEN RETURN private.aka_agent_journey_ctl_tasks(p_staff_id, p_organization_id, v_payload);
    WHEN 'task_done' THEN RETURN private.aka_agent_journey_ctl_task_done(p_staff_id, p_organization_id, v_payload);
    WHEN 'catalog_campaigns' THEN RETURN private.aka_agent_journey_ctl_catalog_campaigns(p_staff_id, p_organization_id);
    ELSE RAISE EXCEPTION 'journey_unknown_action';
  END CASE;
END
$function$;

CREATE FUNCTION public.aka_agent_journey_engine(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  CASE p_action
    WHEN 'tick' THEN RETURN private.aka_agent_journey_engine_tick();
    WHEN 'ingest' THEN RETURN private.aka_agent_journey_engine_ingest(v_payload);
    WHEN 'collect' THEN RETURN private.aka_agent_journey_engine_collect(v_payload);
    WHEN 'claim' THEN RETURN private.aka_agent_journey_engine_claim(v_payload);
    WHEN 'apply' THEN RETURN private.aka_agent_journey_engine_apply(v_payload);
    WHEN 'release' THEN RETURN private.aka_agent_journey_engine_release(v_payload);
    WHEN 'cleanup' THEN RETURN private.aka_agent_journey_engine_cleanup(v_payload);
    ELSE RAISE EXCEPTION 'journey_unknown_action';
  END CASE;
END
$function$;

COMMENT ON FUNCTION public.aka_agent_journey_control(bigint,bigint,text,jsonb) IS
  'V473 Quy trình tự động: route Web/iOS (access, list, get, create, save_draft, publish_prepare, publish, set_status, delete, enrollments, enrollment, exit_enrollment, test_enroll, tasks, task_done, catalog_campaigns). service_role only; staff/organization scope; 15 s.';
COMMENT ON FUNCTION public.aka_agent_journey_engine(text,jsonb) IS
  'V473 Quy trình tự động: bộ máy 30 giây của API Fly (tick, ingest, collect, claim, apply, release, cleanup) với khóa thuê 60 giây. service_role only; 20 s.';

DO $grants$
DECLARE
  v_fn regprocedure;
  v_role text;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%')
       OR (n.nspname = 'public' AND p.proname IN ('aka_agent_journey_control', 'aka_agent_journey_engine'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role);
      END IF;
    END LOOP;
  END LOOP;
END
$grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_journey_control(bigint,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_journey_engine(text,jsonb) TO service_role;

DO $postflight$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.aka_agent_journey_control(bigint,bigint,text,jsonb)', 'public.aka_agent_journey_engine(text,jsonb)'] LOOP
    IF (SELECT array_agg(g ORDER BY g) FROM (
          SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
          FROM pg_proc pr, aclexplode(pr.proacl) a WHERE pr.oid = to_regprocedure(v_fn)) x)
       IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
      RAISE EXCEPTION 'v473_rpc_acl_unexpected: %', v_fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION 'v473_rpc_not_security_definer: %', v_fn;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%'
      AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'))
  ) THEN
    RAISE EXCEPTION 'v473_private_function_acl_unexpected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'auto\_journey%' AND NOT c.relrowsecurity
  ) OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'auto\_journey%') <> 11 THEN
    RAISE EXCEPTION 'v473_table_rls_unexpected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relname LIKE 'auto\_journey%' AND c.relkind IN ('r', 'S')
      AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'))
  ) THEN
    RAISE EXCEPTION 'v473_table_acl_unexpected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'journeys.engine_enabled')
     OR NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.journeys')
     OR NOT EXISTS (SELECT 1 FROM public.auto_journey_engine_state WHERE id = 1) THEN
    RAISE EXCEPTION 'v473_seed_missing';
  END IF;
END
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
