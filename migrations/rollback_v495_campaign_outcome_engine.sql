-- Rollback V495: gỡ toàn bộ engine kết quả chiến dịch v2.
-- Chỉ chạy khi không còn lượt nào của bộ mới đang mở. Không đụng dữ liệu cũ:
-- lịch sử (auto_campaign_details) engine v2 đã ghi được giữ nguyên; mã lỗi engine v2 nào đã được lịch sử
-- hoặc khoá thao tác tham chiếu thì chỉ tắt (is_active=false) thay vì xoá, để giữ khoá ngoại.
-- Không xoá dòng trong supabase_migrations (sổ ghi lại cả lần apply lẫn rollback).
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.auto_outcome_policies') IS NULL THEN
    RAISE EXCEPTION 'V495 rollback: V495 is not applied (public.auto_outcome_policies missing)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs WHERE completed_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_engine_leases) THEN
    RAISE EXCEPTION 'V495 rollback: tắt cờ các tổ chức và chờ mọi lượt của bộ mới kết thúc trước';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs WHERE completed_at IS NULL) THEN
    RAISE EXCEPTION 'V495 rollback: open engine target runs exist; wait for aka_agent_engine_close_stale_v1 or close them first';
  END IF;
END $pre$;

DO $cron$
BEGIN
  -- IF lồng: câu đọc cron.job chỉ được phân tích khi pg_cron có cài.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'aka-agent-engine-close-stale';
  END IF;
END $cron$;

DROP VIEW IF EXISTS public.aka_agent_engine_policy_lint;
DROP VIEW IF EXISTS public.aka_agent_public_error_catalog;

DROP FUNCTION IF EXISTS public.aka_agent_engine_simulate_v1(text, text, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_engine_enabled_orgs_v1();
DROP FUNCTION IF EXISTS public.aka_agent_engine_action_limit(bigint, bigint, text);
DROP FUNCTION IF EXISTS public.aka_agent_engine_positive(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_engine_number(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_engine_scope_ok(bigint);
DROP FUNCTION IF EXISTS public.aka_agent_engine_desktop_staff();
DROP FUNCTION IF EXISTS public.aka_agent_engine_finish_campaign_v1(bigint, uuid, text);
DROP FUNCTION IF EXISTS public.aka_agent_engine_take_content_index_v1(bigint, uuid, text, integer);
DROP FUNCTION IF EXISTS public.aka_agent_engine_record_wait_v1(bigint, uuid, text, timestamptz, integer);
DROP FUNCTION IF EXISTS public.aka_agent_engine_target_timeline_v1(bigint);
DROP FUNCTION IF EXISTS public.aka_agent_engine_apply_status_event_v1(bigint, text);
DROP FUNCTION IF EXISTS public.aka_agent_engine_close_stale_v1(integer);
DROP FUNCTION IF EXISTS public.aka_agent_engine_release_v1(bigint, uuid);
DROP FUNCTION IF EXISTS public.aka_agent_engine_heartbeat_v1(bigint, uuid);
DROP FUNCTION IF EXISTS public.aka_agent_engine_report_v1(bigint, uuid, jsonb, boolean, boolean);
DROP FUNCTION IF EXISTS public.aka_agent_engine_mark_sending_v1(bigint, uuid, text, text);
DROP FUNCTION IF EXISTS public.aka_agent_engine_claim_target_v1(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_engine_wait_note(text, timestamptz);
DROP FUNCTION IF EXISTS public.aka_agent_engine_resolve_policy(text, bigint, text, text, text, text);
DROP FUNCTION IF EXISTS public.aka_agent_engine_classify_signal(text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_status_semantics(bigint);
DROP FUNCTION IF EXISTS public.aka_agent_engine_pattern_key(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_engine_format_vn(timestamptz);
DROP FUNCTION IF EXISTS public.aka_agent_engine_render(text, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_engine_lock_until(text, integer, integer, time, timestamptz);
DROP FUNCTION IF EXISTS public.aka_agent_engine_target_key(text, text, text);
DROP FUNCTION IF EXISTS public.aka_agent_engine_setting(text, text);

DROP TABLE IF EXISTS public.auto_target_memory;
DROP TABLE IF EXISTS public.auto_engine_target_events;
DROP TABLE IF EXISTS public.auto_engine_outcomes;
DROP TABLE IF EXISTS public.auto_engine_target_runs;
DROP TABLE IF EXISTS public.auto_engine_leases;
DROP TABLE IF EXISTS public.auto_engine_gates;
DROP TABLE IF EXISTS public.auto_status_event_rules;
DROP TABLE IF EXISTS public.auto_outcome_unmatched;
DROP TABLE IF EXISTS public.auto_outcome_policies;
DROP TABLE IF EXISTS public.auto_outcome_policy_history;
DROP TABLE IF EXISTS public.auto_outcome_signal_rules;
DROP FUNCTION IF EXISTS public.aka_agent_engine_policy_history_v495();
DROP FUNCTION IF EXISTS public.aka_agent_engine_policy_revision_v495();

-- Mã lỗi engine v2: xoá nếu không ai tham chiếu, ngược lại chỉ tắt.
DO $codes$
DECLARE v_code text; v_kept text[] := ARRAY[]::text[];
BEGIN
  FOR v_code IN SELECT e.error_code FROM public.auto_error e WHERE e.error_type = 'engine v2' LOOP
    IF EXISTS (SELECT 1 FROM public.auto_campaign_details d WHERE d.error_code = v_code)
       OR EXISTS (SELECT 1 FROM public.auto_account_action_status s WHERE s.disabled_error_code = v_code) THEN
      UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = v_code;
      v_kept := v_kept || v_code;
    ELSE
      DELETE FROM public.auto_error WHERE error_code = v_code;
    END IF;
  END LOOP;
  IF cardinality(v_kept) > 0 THEN RAISE NOTICE 'V495 rollback kept (inactive) referenced engine codes: %', v_kept; END IF;
END $codes$;

DELETE FROM public.auto_system_settings
 WHERE key IN ('engine.lease_seconds', 'engine.stale_target_minutes', 'engine.stale_unsent_target_action',
               'engine.timeline_min_wait_seconds', 'engine.bad_target_guard_error_code');

DROP TRIGGER IF EXISTS auto_status_parent_guard_v495 ON public.auto_status;
DROP FUNCTION IF EXISTS public.aka_agent_engine_guard_status_parent_v495();
ALTER TABLE public.auto_status
  DROP CONSTRAINT IF EXISTS auto_status_parent_not_self_v495_check,
  DROP CONSTRAINT IF EXISTS auto_status_report_group_v495_check,
  DROP COLUMN IF EXISTS progress_rank,
  DROP COLUMN IF EXISTS counts_as_delivered,
  DROP COLUMN IF EXISTS report_group,
  DROP COLUMN IF EXISTS parent_status_id;
ALTER TABLE public.auto_account_actions
  DROP CONSTRAINT IF EXISTS auto_account_actions_operation_class_v495_check,
  DROP COLUMN IF EXISTS operation_class;
ALTER TABLE public.auto_error
  DROP CONSTRAINT IF EXISTS auto_error_public_code_v495_check,
  DROP CONSTRAINT IF EXISTS auto_error_error_class_v495_check,
  DROP COLUMN IF EXISTS customer_help,
  DROP COLUMN IF EXISTS customer_title,
  DROP COLUMN IF EXISTS error_class,
  DROP COLUMN IF EXISTS public_code;

DO $post$
BEGIN
  IF to_regclass('public.auto_outcome_policies') IS NOT NULL OR to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'V495 rollback postflight: engine objects remain';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND ((table_name = 'auto_error' AND column_name IN ('public_code','error_class','customer_title','customer_help'))
                OR (table_name = 'auto_status' AND column_name IN ('parent_status_id','report_group','counts_as_delivered','progress_rank'))
                OR (table_name = 'auto_account_actions' AND column_name = 'operation_class'))) THEN
    RAISE EXCEPTION 'V495 rollback postflight: V495 columns remain';
  END IF;
END $post$;

COMMIT;
