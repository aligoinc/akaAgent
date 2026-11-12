-- V495: Engine kết quả chiến dịch v2, giai đoạn 1 (chỉ thêm, không đổi hành vi app hiện tại).
-- Thiết kế và hợp đồng: docs/CAMPAIGN_OUTCOME_ENGINE.md. CHƯA apply production.
--
-- Thêm:
--   * Cột nullable (không default) trên auto_error, auto_account_actions, auto_status.
--   * Bảng engine: luật phân loại, chính sách gộp, lịch sử chính sách, sổ chưa phân loại,
--     luật trạng thái theo sự kiện, cổng, lease, lượt data, kết quả, sự kiện dòng
--     thời gian, nhớ mục tiêu hỏng.
--   * Hàm/RPC engine (SECURITY DEFINER, chỉ cấp service_role và aka_agent_chat_api).
--   * Seed dựng lại ĐÚNG hành vi hiện tại từ dữ liệu live lúc apply (auto_error + chính sách
--     trạng thái), không hardcode ID.
-- Không thêm trigger trên auto_campaign_details / auto_campaign_input_data / auto_campaigns.
-- Dòng auto_error mới có error_type='engine v2': bộ kiểm lúc bắt đầu chạy của Desktop 8.2+
-- (actionResultRuntime.beginActionResultRun) và chat-sync chỉ xét dòng có error_type chứa tên
-- nền tảng hoặc bằng 'system', nên bỏ qua các dòng này. Cột cũ của chúng ghi tường minh.
-- Apply không đổi hành vi code cũ đang chạy: chỉ thêm đối tượng mới; không sửa hàm, trigger hay dữ liệu cũ
-- ngoài việc điền các cột mới thêm. Job dọn của bộ mới không bao giờ đụng data, chiến dịch, tài khoản mà bộ cũ đang giữ.
-- Không có công tắc nào: Desktop bản mới chạy bộ mới cho các loại đã phủ; trên Fly chỉ tổ chức có
-- org_organization.use_new_zalo_runtime = true (cột có sẵn từ V371; tổ chức tạo mới bị trigger ép true).
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE missing text;
BEGIN
  IF to_regclass('public.auto_outcome_policies') IS NOT NULL THEN
    RAISE EXCEPTION 'V495 already applied (public.auto_outcome_policies exists)';
  END IF;
  SELECT string_agg(t || '.' || c, ', ') INTO missing FROM (VALUES
    ('auto_error','zalo_action_codes'),('auto_error','detail_mode'),('auto_error','input_effect'),
    ('auto_status','status_value'),('auto_status','component_type'),
    ('auto_account_actions','flatform_type'),
    ('auto_account_action_status_policies','bad_target_effect'),
    ('auto_campaign_details','result_key'),('auto_campaign_details','policy_snapshot'),('auto_campaign_details','status_id'),
    ('auto_campaign_input_data','schedule'),('auto_campaigns','schedule'),('auto_campaigns','organization_id'),
    ('auto_campaigns','runtime_claim_token'),('auto_campaigns','runtime_unit_token'),('auto_campaigns','runtime_claim_vietnam_date'),
    ('auto_accounts','runtime_operation_claim_token'),('auto_accounts','account_group_id'),('auto_account_groups','settings'),
    ('org_organization_product','product_id'),('org_organization_product','expiration_date'),('org_organization_product','package_type'),
    ('org_organization_product','max_sends_per_day'),('org_organization_product','is_deleted'),
    ('auto_accounts','login_status'),('auto_account_action_status','disabled_error_code'),
    ('auto_campaign_error_state','count_consecutive_bad_targets'),('auto_system_settings','key'),
    ('org_organization','use_new_zalo_runtime')
  ) v(t, c)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=v.t AND column_name=v.c);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'V495 prerequisite columns missing: %', missing; END IF;
END $pre$;

-- ============================================================================================
-- 1. Cột mới trên bảng danh mục (nullable, không default: chỉ đổi metadata)
-- ============================================================================================
ALTER TABLE public.auto_error
  ADD COLUMN public_code text,
  ADD COLUMN error_class text,
  ADD COLUMN customer_title text,
  ADD COLUMN customer_help text;
ALTER TABLE public.auto_error
  ADD CONSTRAINT auto_error_error_class_v495_check CHECK (error_class IS NULL OR error_class IN (
    'target_permanent','target_temporary','unknown_delivery','already_done','account_restricted','quota',
    'auth','content_config','ui_changed','transient','internal','cancelled','run_control')),
  ADD CONSTRAINT auto_error_public_code_v495_check CHECK (public_code IS NULL OR public_code ~ '^[A-Z]{1,4}[0-9]{2,4}$');
COMMENT ON COLUMN public.auto_error.public_code IS 'V495: mã ngắn hiện cho khách (Z122, NET01…); nhiều dòng có thể chung một mã.';
COMMENT ON COLUMN public.auto_error.error_class IS 'V495: nhóm lỗi; mã mới chỉ cần khai nhóm là kế thừa chính sách mặc định của nhóm.';

ALTER TABLE public.auto_account_actions ADD COLUMN operation_class text;
ALTER TABLE public.auto_account_actions
  ADD CONSTRAINT auto_account_actions_operation_class_v495_check
  CHECK (operation_class IS NULL OR operation_class IN ('read','idempotent','delivery'));
COMMENT ON COLUMN public.auto_account_actions.operation_class IS 'V495: read (chỉ đọc) | idempotent (làm lại vô hại) | delivery (giao tới người nhận; chỉ loại này tính "đã gửi").';

ALTER TABLE public.auto_status
  ADD COLUMN parent_status_id bigint REFERENCES public.auto_status(id) ON DELETE RESTRICT,
  ADD COLUMN report_group text,
  ADD COLUMN counts_as_delivered boolean,
  ADD COLUMN progress_rank integer;
ALTER TABLE public.auto_status
  ADD CONSTRAINT auto_status_report_group_v495_check CHECK (report_group IS NULL OR report_group IN ('success','failure','skipped','pending')),
  ADD CONSTRAINT auto_status_parent_not_self_v495_check CHECK (parent_status_id IS NULL OR parent_status_id <> id);
COMMENT ON COLUMN public.auto_status.parent_status_id IS 'V495: trạng thái gốc để "xử lý như"; thuộc tính và chính sách NULL được kế thừa từ chuỗi cha.';

CREATE FUNCTION public.aka_agent_engine_guard_status_parent_v495() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $f$
DECLARE v_cur bigint := NEW.parent_status_id; v_depth integer := 0; v_comp text;
BEGIN
  IF NEW.parent_status_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.component_type INTO v_comp FROM public.auto_status s WHERE s.id = NEW.parent_status_id;
  IF v_comp IS DISTINCT FROM NEW.component_type THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_parent_component_mismatch';
  END IF;
  WHILE v_cur IS NOT NULL LOOP
    IF v_cur = NEW.id THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_parent_cycle'; END IF;
    v_depth := v_depth + 1;
    IF v_depth > 10 THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_parent_too_deep'; END IF;
    SELECT s.parent_status_id INTO v_cur FROM public.auto_status s WHERE s.id = v_cur;
  END LOOP;
  RETURN NEW;
END $f$;
CREATE TRIGGER auto_status_parent_guard_v495 BEFORE INSERT OR UPDATE OF parent_status_id ON public.auto_status
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_engine_guard_status_parent_v495();

-- ============================================================================================
-- 2. Bảng engine
-- ============================================================================================
CREATE TABLE public.auto_outcome_signal_rules (
  id bigserial PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('zalo','facebook','email','system')),
  action_code text REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  phase text CHECK (phase IN ('before_send','in_flight','after_send')),
  signal_kind text NOT NULL CHECK (signal_kind IN ('zalo_code','errno','http_status','timeout','message_like','block','exception','fly_command','engine')),
  pattern text NOT NULL CHECK (length(pattern) BETWEEN 1 AND 300),
  priority integer NOT NULL DEFAULT 100,
  error_code text NOT NULL REFERENCES public.auto_error(error_code) ON DELETE RESTRICT,
  note text,
  source text NOT NULL DEFAULT 'manual',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auto_outcome_signal_rules_match_v495
  ON public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern) NULLS NOT DISTINCT WHERE is_active;
COMMENT ON TABLE public.auto_outcome_signal_rules IS 'V495: tín hiệu thô → mã lỗi. Luật engine + "*" là luật bắt-tất-cả cho nền tảng × pha.';

CREATE TABLE public.auto_outcome_policies (
  id bigserial PRIMARY KEY,
  error_code text REFERENCES public.auto_error(error_code) ON DELETE RESTRICT,
  error_class text CHECK (error_class IN ('target_permanent','target_temporary','unknown_delivery','already_done','account_restricted','quota','auth','content_config','ui_changed','transient','internal','cancelled','run_control')),
  status_id bigint REFERENCES public.auto_status(id) ON DELETE RESTRICT,
  action_code text REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  campaign_action_id text REFERENCES public.auto_campaign_actions(id) ON DELETE RESTRICT,
  runtime_target text CHECK (runtime_target IN ('desktop','fly')),
  detail_mode text CHECK (detail_mode IN ('write','suppress')),
  detail_status_id bigint REFERENCES public.auto_status(id) ON DELETE RESTRICT,
  sub_status_id bigint REFERENCES public.auto_status(id) ON DELETE RESTRICT,
  log_template text,
  campaign_note_template text,
  quota_effect text CHECK (quota_effect IN ('count','no_count','count_if_committed')),
  target_streak_effect text CHECK (target_streak_effect IN ('increment','reset','ignore')),
  streak_threshold integer CHECK (streak_threshold > 0),
  target_effect text CHECK (target_effect IN ('complete','requeue','requeue_after','hold')),
  requeue_after_minutes integer CHECK (requeue_after_minutes >= 0),
  remaining_steps text CHECK (remaining_steps IN ('continue','skip')),
  lock_action_codes text[],
  lock_mode text CHECK (lock_mode IN ('fixed_minutes','end_of_day','days_at_time','indefinite')),
  lock_minutes integer CHECK (lock_minutes >= 0),
  lock_days integer CHECK (lock_days >= 0),
  lock_time time,
  run_effect text CHECK (run_effect IN ('continue','end_unit','stop_account','stop_campaign')),
  pace_mode text CHECK (pace_mode IN ('full','short','none')),
  pace_seconds integer CHECK (pace_seconds >= 0),
  remember_target_days integer CHECK (remember_target_days >= 0),
  campaign_effect text CHECK (campaign_effect IN ('none','hold','pause')),
  campaign_hold_minutes integer CHECK (campaign_hold_minutes >= 0),
  account_effect text CHECK (account_effect IN ('none','pause')),
  login_effect text CHECK (login_effect IN ('none','logged_out','checkpoint')),
  description text,
  source text NOT NULL DEFAULT 'manual',
  revision integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT current_user,
  CONSTRAINT auto_outcome_policies_match_kind_v495 CHECK (
    (status_id IS NOT NULL AND error_code IS NULL AND error_class IS NULL)
    OR (status_id IS NULL AND ((error_code IS NOT NULL) <> (error_class IS NOT NULL)))
    OR (status_id IS NULL AND error_code IS NULL AND error_class IS NULL AND action_code IS NOT NULL)
  )
);
CREATE UNIQUE INDEX auto_outcome_policies_match_v495
  ON public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target)
  NULLS NOT DISTINCT WHERE is_active AND NOT is_delete;
COMMENT ON TABLE public.auto_outcome_policies IS 'V495: chính sách gộp. Trường NULL = kế thừa. Thứ tự: mặc định < trạng thái (gốc→con) < nhóm lỗi < mã lỗi < chặn theo thao tác (dòng chỉ có action_code); cùng mức thì phạm vi hẹp thắng.';

CREATE TABLE public.auto_outcome_policy_history (
  id bigserial PRIMARY KEY,
  policy_id bigint NOT NULL,
  revision integer NOT NULL,
  op text NOT NULL CHECK (op IN ('insert','update','delete')),
  before_row jsonb,
  after_row jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT current_user
);
CREATE INDEX auto_outcome_policy_history_policy_v495 ON public.auto_outcome_policy_history (policy_id, revision);

CREATE FUNCTION public.aka_agent_engine_policy_revision_v495() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['revision','updated_at','updated_by']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['revision','updated_at','updated_by']) THEN
    RETURN NEW;
  END IF;
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  NEW.updated_by := current_user;
  RETURN NEW;
END $f$;
CREATE TRIGGER auto_outcome_policies_revision_v495 BEFORE UPDATE ON public.auto_outcome_policies
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_engine_policy_revision_v495();

CREATE FUNCTION public.aka_agent_engine_policy_history_v495() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.auto_outcome_policy_history(policy_id, revision, op, before_row, after_row) VALUES (NEW.id, NEW.revision, 'insert', NULL, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.revision <> OLD.revision THEN
      INSERT INTO public.auto_outcome_policy_history(policy_id, revision, op, before_row, after_row) VALUES (NEW.id, NEW.revision, 'update', to_jsonb(OLD), to_jsonb(NEW));
    END IF;
  ELSE
    INSERT INTO public.auto_outcome_policy_history(policy_id, revision, op, before_row, after_row) VALUES (OLD.id, OLD.revision, 'delete', to_jsonb(OLD), NULL);
  END IF;
  RETURN NULL;
END $f$;
CREATE TRIGGER auto_outcome_policies_history_v495 AFTER INSERT OR UPDATE OR DELETE ON public.auto_outcome_policies
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_engine_policy_history_v495();

CREATE TABLE public.auto_outcome_unmatched (
  id bigserial PRIMARY KEY,
  platform text NOT NULL,
  action_code text,
  phase text,
  signal_kind text NOT NULL,
  pattern_key text NOT NULL,
  fallback_error_code text,
  sample jsonb NOT NULL DEFAULT '{}'::jsonb,
  hit_count bigint NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auto_outcome_unmatched_key_v495
  ON public.auto_outcome_unmatched (platform, action_code, phase, signal_kind, pattern_key) NULLS NOT DISTINCT;
COMMENT ON TABLE public.auto_outcome_unmatched IS 'V495: tín hiệu chỉ khớp luật bắt-tất-cả; dùng để bổ sung luật phân loại.';

CREATE TABLE public.auto_status_event_rules (
  id bigserial PRIMARY KEY,
  event_kind text NOT NULL CHECK (event_kind ~ '^[a-z]+\.[a-z_]+$'),
  action_code text REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  status_id bigint NOT NULL REFERENCES public.auto_status(id) ON DELETE RESTRICT,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auto_status_event_rules_key_v495
  ON public.auto_status_event_rules (event_kind, action_code) NULLS NOT DISTINCT WHERE is_active;

CREATE TABLE public.auto_engine_gates (
  code text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  on_error text NOT NULL CHECK (on_error IN ('open','closed')),
  retry_after_seconds integer NOT NULL DEFAULT 60 CHECK (retry_after_seconds >= 0),
  description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.auto_engine_gates IS 'V495: cổng kiểm trước khi gửi; on_error=open thì cổng lỗi vẫn cho gửi, closed thì chờ và thử lại.';

-- Bảng vận hành: không FK tới bảng nóng (data, chiến dịch, tài khoản, lịch sử) để migration không
-- khoá các bảng đó; RPC tự bảo đảm toàn vẹn.
CREATE TABLE public.auto_engine_leases (
  account_id bigint PRIMARY KEY,
  lease_token uuid NOT NULL,
  runner_id text NOT NULL CHECK (length(runner_id) BETWEEN 1 AND 200),
  runtime_target text NOT NULL CHECK (runtime_target IN ('desktop','fly')),
  campaign_id bigint,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auto_engine_leases_expires_v495 ON public.auto_engine_leases (expires_at);
COMMENT ON TABLE public.auto_engine_leases IS 'V495: giữ chỗ tài khoản có hạn (thay claim token). Hết hạn thì tự mất, không ai phải gỡ tay.';

CREATE TABLE public.auto_engine_target_runs (
  id bigserial PRIMARY KEY,
  input_data_id bigint NOT NULL,
  campaign_id bigint NOT NULL,
  account_id bigint NOT NULL,
  staff_id bigint,
  organization_id bigint,
  lease_token uuid NOT NULL,
  runner_id text NOT NULL,
  runtime_target text NOT NULL CHECK (runtime_target IN ('desktop','fly')),
  marks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(marks) = 'array'),
  started_at timestamptz NOT NULL DEFAULT now(),
  first_marked_at timestamptz,
  completed_at timestamptz,
  final_target_status text,
  final_error_code text,
  close_reason text,
  outcome_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX auto_engine_target_runs_active_v495 ON public.auto_engine_target_runs (input_data_id) WHERE completed_at IS NULL;
CREATE INDEX auto_engine_target_runs_input_v495 ON public.auto_engine_target_runs (input_data_id, id);
CREATE INDEX auto_engine_target_runs_open_v495 ON public.auto_engine_target_runs (account_id, started_at) WHERE completed_at IS NULL;
CREATE INDEX auto_engine_target_runs_started_v495 ON public.auto_engine_target_runs (started_at);
COMMENT ON TABLE public.auto_engine_target_runs IS 'V495: mỗi lần một data được nhận chạy. marks = dấu "sắp gửi" theo bước (state pending/delivered/partial/unknown/not_delivered).';

CREATE TABLE public.auto_engine_outcomes (
  result_key text PRIMARY KEY CHECK (length(result_key) BETWEEN 8 AND 200),
  target_run_id bigint NOT NULL REFERENCES public.auto_engine_target_runs(id) ON DELETE CASCADE,
  input_data_id bigint NOT NULL,
  campaign_id bigint NOT NULL,
  account_id bigint NOT NULL,
  action_code text NOT NULL,
  phase text NOT NULL,
  ok boolean NOT NULL,
  error_code text,
  status_id bigint,
  delivery_state text NOT NULL CHECK (delivery_state IN ('none','delivered','partial','unknown','not_delivered')),
  detail_id bigint,
  decision jsonb NOT NULL,
  signal jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_engine_outcomes_run_v495 ON public.auto_engine_outcomes (target_run_id);
CREATE INDEX auto_engine_outcomes_created_v495 ON public.auto_engine_outcomes (created_at);
COMMENT ON TABLE public.auto_engine_outcomes IS 'V495: mỗi kết quả đã báo (idempotent theo result_key); gọi lại trả đúng quyết định cũ.';

CREATE TABLE public.auto_engine_target_events (
  id bigserial PRIMARY KEY,
  input_data_id bigint NOT NULL,
  campaign_id bigint NOT NULL,
  target_run_id bigint REFERENCES public.auto_engine_target_runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('wait','interrupted','note')),
  error_code text,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_engine_target_events_input_v495 ON public.auto_engine_target_events (input_data_id, id);
COMMENT ON TABLE public.auto_engine_target_events IS 'V495: sự kiện dòng thời gian không phải mốc (chờ lâu, bị ngắt). Mốc vẫn ở auto_campaign_details.';

CREATE TABLE public.auto_target_memory (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL,
  target_key text NOT NULL,
  action_code text NOT NULL REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  error_code text NOT NULL REFERENCES public.auto_error(error_code) ON DELETE RESTRICT,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX auto_target_memory_key_v495 ON public.auto_target_memory (organization_id, target_key, action_code);
CREATE INDEX auto_target_memory_expires_v495 ON public.auto_target_memory (expires_at);
COMMENT ON TABLE public.auto_target_memory IS 'V495: nhớ mục tiêu hỏng cố định trong phạm vi tổ chức (chỉ ghi khi chính sách có remember_target_days).';

-- ============================================================================================
-- 3. Hàm tiện ích
-- ============================================================================================
CREATE FUNCTION public.aka_agent_engine_setting(p_key text, p_default text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $f$
  SELECT coalesce((SELECT s.value FROM public.auto_system_settings s WHERE s.key = p_key AND s.is_active LIMIT 1), p_default)
$f$;

CREATE FUNCTION public.aka_agent_engine_target_key(p_phone text, p_uid text, p_email text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  WITH n AS (SELECT regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') AS digits)
  SELECT CASE
    WHEN (SELECT digits FROM n) <> '' THEN 'phone:' || md5(CASE
      WHEN (SELECT digits FROM n) LIKE '84%' AND length((SELECT digits FROM n)) >= 11 THEN '0' || substr((SELECT digits FROM n), 3)
      ELSE (SELECT digits FROM n) END)
    WHEN nullif(btrim(coalesce(p_uid, '')), '') IS NOT NULL THEN 'uid:' || btrim(p_uid)
    WHEN nullif(btrim(coalesce(p_email, '')), '') IS NOT NULL THEN 'email:' || md5(lower(btrim(p_email)))
  END
$f$;

CREATE FUNCTION public.aka_agent_engine_lock_until(p_mode text, p_minutes integer, p_days integer, p_time time, p_now timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = '' AS $f$
DECLARE v_day_start timestamptz := date_trunc('day', p_now AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
  -- Cùng ngữ nghĩa với code hiện tại (src/shared/actionDisableTime.ts, campaignScheduler resolvePolicyActionDisableContext).
  IF p_mode = 'indefinite' THEN RETURN NULL; END IF;
  IF p_mode = 'end_of_day' THEN RETURN v_day_start + interval '1 day'; END IF;
  IF p_mode = 'days_at_time' THEN
    IF p_time IS NULL THEN RETURN p_now + make_interval(days => coalesce(p_days, 0)); END IF;
    RETURN greatest(v_day_start + make_interval(days => coalesce(p_days, 0)) + p_time::interval, p_now + interval '1 second');
  END IF;
  IF coalesce(p_minutes, 0) > 0 THEN RETURN p_now + make_interval(mins => p_minutes); END IF;
  RETURN NULL;
END $f$;

CREATE FUNCTION public.aka_agent_engine_render(p_template text, p_vars jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT nullif(btrim(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(p_template, ''),
      '{name}', coalesce(p_vars->>'name', '')),
      '{code}', coalesce(p_vars->>'code', '')),
      '{until}', coalesce(p_vars->>'until', '')),
      '{action}', coalesce(p_vars->>'action', '')),
      '{message}', coalesce(p_vars->>'message', '')),
      '[x]', coalesce(p_vars->>'x', p_vars->>'message', '')),
      '[t]', coalesce(p_vars->>'t', p_vars->>'until', '')),
      '[action]', coalesce(p_vars->>'action', '')),
      '[a]', coalesce(p_vars->>'action', ''))
  ), '')
$f$;

CREATE FUNCTION public.aka_agent_engine_format_vn(p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $f$
  SELECT CASE WHEN p_at IS NULL THEN NULL ELSE to_char(p_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') END
$f$;

CREATE FUNCTION public.aka_agent_engine_pattern_key(p_signal jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT left(btrim(regexp_replace(regexp_replace(
    coalesce(nullif(p_signal->>'code', ''), '') || CASE WHEN coalesce(p_signal->>'code', '') <> '' AND coalesce(p_signal->>'message', '') <> '' THEN ' | ' ELSE '' END
      || coalesce(p_signal->>'message', ''),
    '[0-9]{4,}', '#', 'g'), '\s+', ' ', 'g')), 200)
$f$;

-- Thuộc tính thật của một trạng thái, đi lên chuỗi cha để lấy giá trị đầu tiên khác NULL.
CREATE FUNCTION public.aka_agent_status_semantics(p_status_id bigint)
RETURNS TABLE(status_id bigint, root_status_id bigint, status_code text, status_value text, report_group text, counts_as_delivered boolean, progress_rank integer)
LANGUAGE sql STABLE SET search_path = '' AS $f$
  WITH RECURSIVE chain AS (
    SELECT s.id, s.parent_status_id, 0 AS depth FROM public.auto_status s WHERE s.id = p_status_id
    UNION ALL
    SELECT a.id, a.parent_status_id, c.depth + 1 FROM chain c JOIN public.auto_status a ON a.id = c.parent_status_id WHERE c.depth < 10
  )
  SELECT p_status_id,
    (SELECT c.id FROM chain c ORDER BY c.depth DESC LIMIT 1),
    (SELECT s.code FROM public.auto_status s WHERE s.id = p_status_id),
    (SELECT s.status_value FROM chain c JOIN public.auto_status s ON s.id = c.id WHERE s.status_value IS NOT NULL ORDER BY c.depth LIMIT 1),
    (SELECT s.report_group FROM chain c JOIN public.auto_status s ON s.id = c.id WHERE s.report_group IS NOT NULL ORDER BY c.depth LIMIT 1),
    coalesce((SELECT s.counts_as_delivered FROM chain c JOIN public.auto_status s ON s.id = c.id WHERE s.counts_as_delivered IS NOT NULL ORDER BY c.depth LIMIT 1), false),
    (SELECT s.progress_rank FROM chain c JOIN public.auto_status s ON s.id = c.id WHERE s.progress_rank IS NOT NULL ORDER BY c.depth LIMIT 1)
  WHERE EXISTS (SELECT 1 FROM chain)
$f$;

-- Tín hiệu thô → mã lỗi. Thứ tự: mã đã biết (direct) > luật chính xác > message_like > bắt-tất-cả.
CREATE FUNCTION public.aka_agent_engine_classify_signal(p_platform text, p_action_code text, p_phase text, p_signal jsonb)
RETURNS TABLE(error_code text, rule_id bigint, matched_by text, is_catch_all boolean)
LANGUAGE plpgsql STABLE SET search_path = '' AS $f$
DECLARE
  v_kind text := lower(coalesce(p_signal->>'kind', ''));
  v_code text := coalesce(p_signal->>'code', '');
  v_msg text := coalesce(p_signal->>'message', '');
  v_direct text := nullif(p_signal->>'errorCode', '');
BEGIN
  IF v_direct IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = v_direct AND e.is_active AND NOT e.is_delete) THEN
    RETURN QUERY SELECT v_direct, NULL::bigint, 'direct'::text, false;
    RETURN;
  END IF;
  -- Thứ tự: mã chính xác > câu lỗi (message_like) > mọi mã của đúng loại tín hiệu ('*') > bắt-tất-cả (engine '*').
  -- Cùng hạng thì luật của nền tảng trước luật 'system', có thao tác trước không thao tác, có pha trước không pha.
  RETURN QUERY
  SELECT r.error_code, r.id, r.signal_kind, (r.pattern = '*')
  FROM public.auto_outcome_signal_rules r
  JOIN public.auto_error e ON e.error_code = r.error_code AND e.is_active AND NOT e.is_delete
  WHERE r.is_active
    AND r.platform IN (p_platform, 'system')
    AND (r.action_code IS NULL OR r.action_code = p_action_code)
    AND (r.phase IS NULL OR r.phase = p_phase)
    AND (
      (r.signal_kind NOT IN ('message_like', 'engine') AND r.signal_kind = v_kind AND (r.pattern = v_code OR r.pattern = '*'))
      OR (r.signal_kind = 'engine' AND r.pattern <> '*' AND v_kind = 'engine' AND r.pattern = v_code)
      OR (r.signal_kind = 'message_like' AND v_msg <> '' AND v_msg ILIKE r.pattern)
      OR (r.signal_kind = 'engine' AND r.pattern = '*')
    )
  ORDER BY
    CASE WHEN r.signal_kind = 'engine' AND r.pattern = '*' THEN 3 WHEN r.pattern = '*' THEN 2
         WHEN r.signal_kind = 'message_like' THEN 1 ELSE 0 END,
    (r.platform = 'system'), (r.action_code IS NULL), (r.phase IS NULL), r.priority, r.id
  LIMIT 1;
END $f$;

-- Gộp chính sách từng trường. Trả jsonb các trường hiệu ứng + policy_ids/revisions/error_class.
CREATE FUNCTION public.aka_agent_engine_resolve_policy(
  p_error_code text, p_status_id bigint, p_action_code text, p_campaign_action_id text, p_runtime_target text, p_phase text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $f$
DECLARE
  c_fields constant text[] := ARRAY['detail_mode','detail_status_id','sub_status_id','log_template','campaign_note_template',
    'quota_effect','target_streak_effect','streak_threshold','target_effect','requeue_after_minutes','remaining_steps',
    'lock_action_codes','lock_mode','lock_minutes','lock_days','lock_time','run_effect','pace_mode','pace_seconds',
    'remember_target_days','campaign_effect','campaign_hold_minutes','account_effect','login_effect'];
  v_class text;
  v_failed bigint;
  v_success bigint;
  v_defaults jsonb;
  v_error jsonb := '{}'::jsonb;
  v_status jsonb := '{}'::jsonb;
  v_guard jsonb := '{}'::jsonb;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_revs jsonb := '{}'::jsonb;
  v_status_id bigint;
  r record;
  v_row jsonb;
BEGIN
  SELECT s.id INTO v_failed FROM public.auto_status s WHERE s.code = 'campaign_detail_failed';
  SELECT s.id INTO v_success FROM public.auto_status s WHERE s.code = 'campaign_detail_success';
  -- Mặc định an toàn có sẵn trong hàm (dùng khi dữ liệu chính sách thiếu); không ném lỗi.
  v_defaults := jsonb_build_object('lock_action_codes', '[]'::jsonb, 'remember_target_days', 0,
    'campaign_effect', 'none', 'account_effect', 'none', 'login_effect', 'none');
  IF p_error_code IS NULL THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',coalesce(p_status_id, v_success),
      'quota_effect','count','target_streak_effect','reset','target_effect','complete','remaining_steps','continue',
      'run_effect','continue','pace_mode','full');
  ELSIF p_phase = 'before_send' THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','suppress','detail_status_id',v_failed,
      'quota_effect','no_count','target_streak_effect','ignore','target_effect','requeue','remaining_steps','skip',
      'run_effect','end_unit','pace_mode','none');
  ELSIF p_phase = 'in_flight' THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',v_failed,
      'quota_effect','count_if_committed','target_streak_effect','ignore','target_effect','complete','remaining_steps','skip',
      'run_effect','continue','pace_mode','full');
  ELSE
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',v_failed,
      'quota_effect','count','target_streak_effect','increment','target_effect','complete','remaining_steps','continue',
      'run_effect','continue','pace_mode','full');
  END IF;

  IF p_error_code IS NOT NULL THEN
    SELECT e.error_class INTO v_class FROM public.auto_error e WHERE e.error_code = p_error_code;
    FOR r IN
      SELECT p.*,
        CASE WHEN p.error_code IS NOT NULL THEN 2 ELSE 1 END AS k,
        (CASE WHEN p.campaign_action_id IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.action_code IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
      FROM public.auto_outcome_policies p
      WHERE p.is_active AND NOT p.is_delete
        AND (p.error_code = p_error_code OR (v_class IS NOT NULL AND p.error_class = v_class))
        AND (p.action_code IS NULL OR p.action_code = p_action_code)
        AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
        AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
      ORDER BY k, spec, p.id
    LOOP
      v_row := to_jsonb(r);
      v_error := v_error || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
        WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
      v_ids := v_ids || r.id;
      v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
    END LOOP;
  END IF;

  -- Chặn theo thao tác (dòng chỉ có action_code): áp sau cùng, ví dụ thao tác phụ gắn tag/đổi tên
  -- không bao giờ tính lượt hay chuỗi lỗi, dù mã lỗi nói gì (giống guard auxiliaryAction hiện nay).
  FOR r IN
    SELECT p.*,
      (CASE WHEN p.campaign_action_id IS NOT NULL THEN 2 ELSE 0 END + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
    FROM public.auto_outcome_policies p
    WHERE p.is_active AND NOT p.is_delete
      AND p.status_id IS NULL AND p.error_code IS NULL AND p.error_class IS NULL
      AND p.action_code = p_action_code
      AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
      AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
    ORDER BY spec, p.id
  LOOP
    v_row := to_jsonb(r);
    v_guard := v_guard || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
      WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
    v_ids := v_ids || r.id;
    v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
  END LOOP;

  v_status_id := coalesce((v_guard->>'detail_status_id')::bigint, (v_error->>'detail_status_id')::bigint, p_status_id,
    (v_defaults->>'detail_status_id')::bigint);

  FOR r IN
    WITH RECURSIVE chain AS (
      SELECT s.id, s.parent_status_id, 0 AS depth FROM public.auto_status s WHERE s.id = v_status_id
      UNION ALL
      SELECT a.id, a.parent_status_id, c.depth + 1 FROM chain c JOIN public.auto_status a ON a.id = c.parent_status_id WHERE c.depth < 10
    )
    SELECT p.*, c.depth AS depth,
      (CASE WHEN p.campaign_action_id IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.action_code IS NOT NULL THEN 2 ELSE 0 END
        + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
    FROM chain c JOIN public.auto_outcome_policies p ON p.status_id = c.id
    WHERE p.is_active AND NOT p.is_delete
      AND (p.action_code IS NULL OR p.action_code = p_action_code)
      AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
      AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
    ORDER BY c.depth DESC, spec, p.id
  LOOP
    v_row := to_jsonb(r);
    v_status := v_status || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
      WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
    v_ids := v_ids || r.id;
    v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
  END LOOP;

  RETURN v_defaults || v_status || v_error || v_guard || jsonb_build_object(
    'detail_status_id', v_status_id, 'error_class', v_class, 'policy_ids', to_jsonb(v_ids), 'revisions', v_revs);
END $f$;

-- ============================================================================================
-- 4. RPC engine
-- ============================================================================================
-- Phạm vi nhân viên của lời gọi: Desktop (role aka_agent_desktop) chỉ được đụng việc của chính nhân viên đăng nhập.
-- service_role và aka_agent_chat_api (Fly) không bị giới hạn. Gọi qua EXECUTE để DB thiếu hàm private vẫn chạy.
CREATE FUNCTION public.aka_agent_engine_desktop_staff() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_scope bigint;
BEGIN
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT private.aka_agent_staff_scope_for_request()' INTO v_scope;
  RETURN v_scope;
END $f$;

CREATE FUNCTION public.aka_agent_engine_scope_ok(p_staff bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT CASE WHEN s.v IS NULL THEN true ELSE s.v = p_staff END
  FROM (SELECT public.aka_agent_engine_desktop_staff() AS v) s
$f$;

-- Giới hạn hiệu lực của một thao tác, đúng công thức bộ chạy Desktop/VPS:
--   getActionLimitConfig (campaignScheduler.ts): Tìm SĐT cố định 1.000 lượt (phút lấy từ cài đặt); thao tác khác lấy
--     actionLimits.byActionCode[mã], không có thì khối chung của actionLimits;
--   resolveAccountActionLimitConfig (src/shared/accountActionLimits.ts): nhóm tài khoản → chiến dịch → trần gói (min);
--   resolveAccountRateLimitStatus (campaignRepository.ts): mặc định 30/ngày, 9 lượt/65 phút.
-- Trần gói (getGroupedDailySendLimit): các gói Zalo (16, 18) còn hạn; gói có max_sends_per_day dương thì lấy số đó,
-- gói demo không đặt thì 30, gói khác không đặt là không giới hạn; có một gói không giới hạn thì không có trần.
-- Tìm SĐT không có trần gói. Chỉ phủ thao tác Zalo (giai đoạn 1 của engine v2 chỉ chạy Zalo).
CREATE FUNCTION public.aka_agent_engine_action_limit(p_campaign_id bigint, p_account_id bigint, p_action_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_limits jsonb;
  v_org bigint;
  v_base jsonb;
  v_group jsonb;
  v_daily numeric;
  v_count numeric;
  v_minutes numeric;
  v_cap numeric;
  v_unlimited boolean;
  v_rows integer;
BEGIN
  SELECT nullif(c.extra_settings->'actionLimits', 'null'::jsonb), c.organization_id INTO v_limits, v_org
    FROM public.auto_campaigns c WHERE c.id = p_campaign_id;
  IF p_action_code = 'zalo_find_phone_user' THEN
    v_base := jsonb_build_object('dailyLimit', 1000, 'rateLimitCount', 1000,
      'rateLimitMinutes', coalesce(nullif(v_limits->'byActionCode'->p_action_code->'rateLimitMinutes', 'null'::jsonb), v_limits->'rateLimitMinutes'));
  ELSE
    v_base := nullif(v_limits->'byActionCode'->p_action_code, 'null'::jsonb);
    IF v_base IS NULL AND v_limits IS NOT NULL THEN
      v_base := jsonb_build_object('dailyLimit', v_limits->'dailyLimit', 'rateLimitCount', v_limits->'rateLimitCount', 'rateLimitMinutes', v_limits->'rateLimitMinutes');
    END IF;
  END IF;
  SELECT nullif(g.settings->'byActionCode'->p_action_code, 'null'::jsonb) INTO v_group
    FROM public.auto_accounts a JOIN public.auto_account_groups g ON g.id = a.account_group_id WHERE a.id = p_account_id;

  -- normalizePositiveActionLimit: số dương thì lấy phần nguyên, còn lại là không đặt.
  IF v_group IS NOT NULL THEN
    v_daily := coalesce(public.aka_agent_engine_positive(v_group->'dailyLimit'), public.aka_agent_engine_number(v_base->'dailyLimit'));
    v_count := coalesce(public.aka_agent_engine_positive(v_group->'rateLimitCount'), public.aka_agent_engine_number(v_base->'rateLimitCount'));
    v_minutes := coalesce(public.aka_agent_engine_positive(v_group->'rateLimitMinutes'), public.aka_agent_engine_number(v_base->'rateLimitMinutes'));
  ELSE
    v_daily := public.aka_agent_engine_number(v_base->'dailyLimit');
    v_count := public.aka_agent_engine_number(v_base->'rateLimitCount');
    v_minutes := public.aka_agent_engine_number(v_base->'rateLimitMinutes');
  END IF;

  IF p_action_code <> 'zalo_find_phone_user' AND p_action_code LIKE 'zalo\_%' THEN
    SELECT count(*), bool_or(coalesce(p.max_sends_per_day, 0) <= 0 AND lower(btrim(coalesce(p.package_type, ''))) <> 'demo'),
           max(CASE WHEN coalesce(p.max_sends_per_day, 0) > 0 THEN p.max_sends_per_day ELSE 30 END)
      INTO v_rows, v_unlimited, v_cap
      FROM public.org_organization_product p
     WHERE p.organization_id = v_org AND p.is_deleted = false AND p.product_id IN (16, 18)
       AND p.expiration_date IS NOT NULL AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_vn;
    IF v_rows > 0 AND NOT v_unlimited THEN
      v_daily := least(coalesce(public.aka_agent_engine_positive(to_jsonb(v_daily)), 30), v_cap);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'daily', CASE WHEN v_daily > 0 THEN v_daily ELSE 30 END,
    'windowCount', CASE WHEN v_count > 0 THEN v_count ELSE 9 END,
    'windowMinutes', CASE WHEN v_minutes > 0 THEN v_minutes ELSE 65 END);
END $f$;

-- JSON → số như JS: số hoặc chuỗi số; còn lại là không đặt.
CREATE FUNCTION public.aka_agent_engine_number(p_value jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN (p_value #>> '{}')::numeric
              WHEN jsonb_typeof(p_value) = 'string' AND btrim(p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(p_value #>> '{}')::numeric
         END
$f$;

-- normalizePositiveActionLimit: Math.floor(Number(x)), chỉ nhận số dương.
CREATE FUNCTION public.aka_agent_engine_positive(p_value jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT CASE WHEN floor(public.aka_agent_engine_number(p_value)) > 0 THEN floor(public.aka_agent_engine_number(p_value)) END
$f$;

CREATE FUNCTION public.aka_agent_engine_wait_note(p_error_code text, p_until timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $f$
  SELECT '⏳ ' || coalesce(e.customer_title, e.error_name, 'Tạm chờ') ||
    CASE WHEN p_until IS NOT NULL THEN ', chạy tiếp lúc ' || public.aka_agent_engine_format_vn(p_until) ELSE '' END ||
    CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
  FROM (SELECT 1) one LEFT JOIN public.auto_error e ON e.error_code = p_error_code
$f$;

CREATE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_staff bigint := nullif(p_ctx->>'staffId', '')::bigint;
  v_account_id bigint := nullif(p_ctx->>'accountId', '')::bigint;
  v_campaign_id bigint := nullif(p_ctx->>'campaignId', '')::bigint;
  v_runner text := nullif(btrim(p_ctx->>'runnerId'), '');
  v_runtime text := p_ctx->>'runtimeTarget';
  v_req_token uuid := nullif(p_ctx->>'leaseToken', '')::uuid;
  v_lease_seconds integer := greatest(30, public.aka_agent_engine_setting('engine.lease_seconds', '180')::integer);
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  l public.auto_engine_leases%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_has_lease boolean;
  v_token uuid;
  v_run_id bigint;
  v_act jsonb;
  v_code text;
  v_required boolean;
  v_decision jsonb;
  v_decisions jsonb := '{}'::jsonb;
  v_target_wait jsonb;
  v_target_key text;
  v_lock record;
  v_limit jsonb;
  v_daily numeric;
  v_window_count numeric;
  v_window_minutes numeric;
  v_used integer;
  v_oldest timestamptz;
  v_mem record;
  v_allowed boolean;
  v_boundary text;
BEGIN
  IF v_staff IS NULL OR v_account_id IS NULL OR v_campaign_id IS NULL OR v_runner IS NULL OR v_runtime IS NULL OR v_runtime NOT IN ('desktop','fly') THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  -- Desktop chỉ nhận việc của chính nhân viên đăng nhập, và chỉ với vai trò Desktop.
  IF public.aka_agent_engine_desktop_staff() IS NOT NULL AND v_runtime <> 'desktop' THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  IF NOT public.aka_agent_engine_scope_ok(v_staff) THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.is_delete, false) OR c.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF c.account_id IS DISTINCT FROM v_account_id THEN RETURN jsonb_build_object('status', 'account_mismatch'); END IF;

  -- Không có công tắc theo loại chiến dịch: bộ chạy chỉ gọi claim cho loại mà lõi đã phủ.
  -- Desktop bản mới tự chạy bộ mới; Fly chỉ chạy bộ mới cho tổ chức bật cờ use_new_zalo_runtime (V371).
  IF v_runtime = 'fly'
     AND NOT coalesce((SELECT o.use_new_zalo_runtime FROM public.org_organization o WHERE o.id = c.organization_id), false) THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;

  SELECT * INTO a FROM public.auto_accounts WHERE id = v_account_id FOR UPDATE;
  IF NOT FOUND OR coalesce(a.is_delete, false) OR a.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'account_not_found');
  END IF;
  -- Bộ cũ còn giữ tài khoản (token thao tác) hoặc một chiến dịch của tài khoản (claim token, unit lease):
  -- chờ, không chạy chồng. Bộ mới không bao giờ dùng hay xoá các token này.
  IF a.runtime_operation_claim_token IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'account');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'campaign');
  END IF;
  -- Cùng điều kiện nhận lượt của bản cũ (aka_agent_claim_campaign_run_unit_v2): đúng runtime sở hữu
  -- tài khoản, tài khoản còn bật và đã đăng nhập, quyền dùng app, khung giờ cho phép của nhân viên.
  IF (v_runtime = 'fly' AND (lower(btrim(coalesce(a.flatform_type, ''))) <> 'zalo' OR coalesce(a.is_zalo_show_web, false)
                              OR NOT coalesce(a.is_zalo_server, false)))
     OR (v_runtime = 'desktop' AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND coalesce(a.is_zalo_server, false)) THEN
    RETURN jsonb_build_object('status', 'runtime_not_owner');
  END IF;
  IF a.is_active IS NOT TRUE OR a.login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN jsonb_build_object('status', 'account_logged_out', 'loginStatus', a.login_status);
  END IF;
  -- Hai hàm có sẵn trên production gọi qua EXECUTE: PL/pgSQL phân giải tên hàm khi lập kế hoạch biểu thức.
  IF to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_app_access_account_allowed($1, $2)' INTO v_allowed USING v_account_id, 'akaAgent';
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'app_access_denied', 'reason', 'app_access_account'); END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_staff_time_allowed($1)' INTO v_allowed USING v_staff;
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'staff_time_blocked'); END IF;
  END IF;

  -- Giữ chỗ tài khoản có hạn. Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ
  -- vẫn "đang chạy" và chỉ được aka_agent_engine_close_stale_v1 đóng (không bao giờ gửi lại).
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = v_account_id FOR UPDATE;
  v_has_lease := FOUND;
  IF v_has_lease AND l.expires_at > v_now AND l.lease_token IS DISTINCT FROM v_req_token THEN
    RETURN jsonb_build_object('status', 'busy', 'runnerId', l.runner_id, 'expiresAt', l.expires_at);
  END IF;
  v_token := CASE WHEN v_has_lease AND l.lease_token = v_req_token AND l.expires_at > v_now THEN l.lease_token ELSE gen_random_uuid() END;
  INSERT INTO public.auto_engine_leases AS el (account_id, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at)
  VALUES (v_account_id, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds))
  ON CONFLICT (account_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,
    heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at;

  IF c.status = 'tạm dừng' THEN RETURN jsonb_build_object('status', 'campaign_paused', 'leaseToken', v_token); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'campaign_not_runnable', 'campaignStatus', c.status, 'leaseToken', v_token);
  END IF;
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule > v_now THEN
    RETURN jsonb_build_object('status', 'not_due', 'schedule', c.schedule, 'leaseToken', v_token);
  END IF;
  -- Mốc ngày như bản cũ (daily_stop_due / daily_drain_due / vietnam_day_changed): sau giờ dừng trong ngày
  -- (mặc định 23:59) hoặc khi lease mở từ ngày trước thì không nhận data mới, để bảo trì ngày mới chạy.
  v_boundary := CASE
    WHEN c.daily_stop_time IS NOT NULL
     AND v_now >= ((v_vn + least(c.daily_stop_time, time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_stop_due'
    WHEN v_now >= ((v_vn + time '23:59:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_drain_due'
    WHEN v_has_lease AND l.lease_token = v_token AND (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < v_vn THEN 'vietnam_day_changed'
  END;
  IF v_boundary IS NOT NULL THEN
    -- Qua giờ dừng / giờ chốt trong ngày: không nhận data tới 0:00 hôm sau. Qua ngày khi lượt còn mở từ hôm trước:
    -- chỉ kết thúc lượt (nextAt = bây giờ) để bảo trì ngày mới chạy, xong là chạy tiếp ngay trong ngày.
    RETURN jsonb_build_object('status', 'daily_boundary', 'leaseToken', v_token, 'reason', v_boundary,
      'nextAt', CASE WHEN v_boundary = 'vietnam_day_changed' THEN v_now
                     ELSE ((v_vn + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END);
  END IF;

  SELECT * INTO t FROM public.auto_campaign_input_data
   WHERE campaign_id = v_campaign_id AND status = 'chờ xử lý' AND coalesce(is_delete, false) = false
     AND (schedule IS NULL OR schedule <= v_now)
   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token,
      'nextSchedule', (SELECT min(d.schedule) FROM public.auto_campaign_input_data d
                        WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false AND d.schedule > v_now),
      'runningTargets', (SELECT count(*) FROM public.auto_campaign_input_data d
                          WHERE d.campaign_id = v_campaign_id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false),
      -- Chiến dịch chưa có data nào (khác "đã chạy hết"): host có thể chờ nguồn bơm data thay vì hoàn thành.
      'hasTargets', EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                             WHERE d.campaign_id = v_campaign_id AND coalesce(d.is_delete, false) = false));
  END IF;

  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
  FOR v_act IN SELECT x.value FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) x LOOP
    v_code := v_act->>'code';
    v_required := coalesce((v_act->>'required')::boolean, true);
    v_decision := jsonb_build_object('decision', 'allow');

    SELECT s.is_disable, s.date_enable, s.disabled_error_code INTO v_lock
      FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
    IF FOUND AND v_lock.is_disable AND (v_lock.date_enable IS NULL OR v_lock.date_enable > v_now) THEN
      v_decision := jsonb_build_object('decision', 'wait', 'gate', 'action_lock', 'errorCode', v_lock.disabled_error_code, 'until', v_lock.date_enable);
    END IF;

    -- Hạn mức tính trong DB theo đúng công thức của bộ chạy Desktop/VPS (aka_agent_engine_action_limit).
    v_limit := public.aka_agent_engine_action_limit(v_campaign_id, v_account_id, v_code);
    IF v_decision->>'decision' = 'allow' AND v_limit IS NOT NULL THEN
      v_daily := (v_limit->>'daily')::numeric;
      v_window_count := (v_limit->>'windowCount')::numeric;
      v_window_minutes := (v_limit->>'windowMinutes')::numeric;
      IF coalesce(v_daily, 0) > 0 THEN
        SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_used
          FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
        IF coalesce(v_used, 0) >= v_daily THEN
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_day',
            'until', date_trunc('day', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' + interval '1 day');
        END IF;
      END IF;
      IF v_decision->>'decision' = 'allow' AND coalesce(v_window_count, 0) > 0 AND coalesce(v_window_minutes, 0) > 0 THEN
        SELECT count(*), min(x.at) INTO v_used, v_oldest FROM (
          -- Như countLimitDetailsInWindow của bộ chạy: không lọc is_delete.
          SELECT d.created_at AS at FROM public.auto_campaign_details d
           WHERE d.account_id = v_account_id AND d.action_code = v_code
             AND d.created_at >= v_now - make_interval(secs => (v_window_minutes * 60)::double precision)
             AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')))
          UNION ALL
          SELECT (m.value->>'markedAt')::timestamptz FROM public.auto_engine_target_runs rr, jsonb_array_elements(rr.marks) m
           WHERE rr.account_id = v_account_id AND rr.completed_at IS NULL
             AND m.value->>'actionCode' = v_code AND m.value->>'state' = 'pending'
        ) x;
        IF v_used >= v_window_count THEN
          -- Như bộ chạy: chờ tới khi lượt cũ nhất ra khỏi khung, ít nhất 60 giây.
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_hour',
            'until', greatest(v_now + interval '60 seconds', v_oldest + make_interval(secs => (v_window_minutes * 60)::double precision)));
        END IF;
      END IF;
    END IF;

    IF v_decision->>'decision' = 'allow' AND v_target_key IS NOT NULL THEN
      SELECT m.error_code, m.expires_at INTO v_mem FROM public.auto_target_memory m
       WHERE m.organization_id = coalesce(c.organization_id, 0) AND m.target_key = v_target_key
         AND m.action_code = v_code AND m.expires_at > v_now LIMIT 1;
      IF FOUND THEN
        v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_memory', 'errorCode', v_mem.error_code, 'until', v_mem.expires_at);
      END IF;
    END IF;

    -- Thao tác không bắt buộc chỉ được bỏ qua với các cổng khai trong skippableGates (không khai = mọi cổng),
    -- như preflightActions: hết lượt thì bỏ qua được, đang bị khoá thì không.
    IF NOT v_required AND v_decision->>'decision' = 'wait' AND jsonb_typeof(v_act->'skippableGates') = 'array'
       AND NOT (v_act->'skippableGates' ? coalesce(v_decision->>'gate', '')) THEN
      v_required := true;
    END IF;
    IF v_decision->>'decision' = 'wait' THEN
      v_decision := v_decision || jsonb_build_object('note', regexp_replace(
        public.aka_agent_engine_wait_note(v_decision->>'errorCode', nullif(v_decision->>'until', '')::timestamptz), '^⏳ ', ''));
    END IF;
    v_decisions := v_decisions || jsonb_build_object(v_code, v_decision || jsonb_build_object('required', v_required));
    IF v_required AND v_decision->>'decision' = 'wait' AND v_target_wait IS NULL THEN v_target_wait := v_decision; END IF;
  END LOOP;
  -- requireAny: cả nhóm thao tác đều phải chờ thì không nhận data (không tra số khi không gửi được gì),
  -- hẹn lại theo thao tác mở sớm nhất.
  IF v_target_wait IS NULL AND jsonb_typeof(p_ctx->'requireAny') = 'array' AND jsonb_array_length(p_ctx->'requireAny') > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
                      WHERE coalesce(v_decisions->q.code->>'decision', 'allow') <> 'wait') THEN
    SELECT v_decisions->q.code INTO v_target_wait FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
     ORDER BY nullif(v_decisions->q.code->>'until', '')::timestamptz NULLS LAST LIMIT 1;
  END IF;

  -- Bước bắt buộc phải chờ (khoá / hạn mức): không nhận data; hẹn chiến dịch qua schedule để không bị hỏi lại liên tục.
  IF v_target_wait IS NOT NULL THEN
    UPDATE public.auto_campaigns SET
      status = 'chờ xử lý',
      schedule = CASE WHEN v_target_wait->>'until' IS NOT NULL THEN greatest(coalesce(schedule, v_now), (v_target_wait->>'until')::timestamptz) ELSE schedule END,
      note = public.aka_agent_engine_wait_note(v_target_wait->>'errorCode', nullif(v_target_wait->>'until', '')::timestamptz),
      updated_at = v_now
    WHERE id = v_campaign_id;
    RETURN jsonb_build_object('status', 'wait', 'leaseToken', v_token, 'wait', v_target_wait, 'actions', v_decisions);
  END IF;

  -- Trigger phân quyền ứng dụng (V445) có thể từ chối chuyển "đang chạy": hoàn tác cả bước nhận data
  -- và giữ chỗ, trả trạng thái rõ ràng thay vì lỗi.
  BEGIN
    UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = t.id;
    -- Ghi lịch = lúc nhận khi lịch còn là ngày cũ: cổng bảo trì của bộ cũ đếm chiến dịch "đang chạy" có lịch
    -- trước đầu ngày, nên chiến dịch của bộ mới không được giữ cổng đó đóng.
    UPDATE public.auto_campaigns SET status = 'đang chạy',
           schedule = CASE WHEN schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN v_now ELSE schedule END,
           updated_at = v_now
     WHERE id = v_campaign_id
       AND (status = 'chờ xử lý' OR schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'));
    IF a.status = 'chờ xử lý' THEN UPDATE public.auto_accounts SET status = 'đang chạy', updated_at = v_now WHERE id = v_account_id; END IF;
    INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id, runtime_target, started_at)
    VALUES (t.id, v_campaign_id, v_account_id, v_staff, c.organization_id, v_token, v_runner, v_runtime, v_now)
    RETURNING id INTO v_run_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'app_access%' THEN RAISE; END IF;
    DELETE FROM public.auto_engine_leases WHERE account_id = v_account_id AND lease_token = v_token;
    RETURN jsonb_build_object('status', 'app_access_denied', 'reason', SQLERRM);
  END;

  RETURN jsonb_build_object('status', 'claimed', 'targetRunId', v_run_id, 'leaseToken', v_token,
    'leaseExpiresAt', v_now + make_interval(secs => v_lease_seconds),
    'target', (to_jsonb(t) - 'status') || jsonb_build_object('status', 'đang chạy'),
    'targetKey', v_target_key, 'actions', v_decisions,
    -- Cấu hình cổng kiểm cho adapter (on_error: open = lỗi kiểm vẫn gửi; closed = chờ rồi thử lại).
    'gates', (SELECT coalesce(jsonb_object_agg(g.code, jsonb_build_object('onError', g.on_error)), '{}'::jsonb) FROM public.auto_engine_gates g),
    'campaign', jsonb_build_object('id', c.id, 'actionId', c.action_id, 'status', 'đang chạy'));
END $f$;

CREATE FUNCTION public.aka_agent_engine_mark_sending_v1(p_target_run_id bigint, p_lease_token uuid, p_action_code text, p_step_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  r public.auto_engine_target_runs%ROWTYPE;
  v_key text := coalesce(nullif(btrim(p_step_key), ''), p_action_code);
BEGIN
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND OR r.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_closed'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token OR NOT EXISTS (
       SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = p_action_code) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.marks) m WHERE m.value->>'stepKey' = v_key) THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  -- Giữ chỗ hạn mức ngày ngay lúc ghi dấu; report hoàn lại nếu chính sách không tính.
  INSERT INTO public.auto_account_action_status AS s (account_id, action_code, count_action_in_day, count_date)
  VALUES (r.account_id, p_action_code, 1, v_vn)
  ON CONFLICT (account_id, action_code) DO UPDATE SET
    count_action_in_day = CASE WHEN s.count_date = v_vn THEN s.count_action_in_day + 1 ELSE 1 END,
    count_date = v_vn, updated_at = v_now;
  UPDATE public.auto_engine_target_runs SET
    marks = marks || jsonb_build_array(jsonb_build_object('stepKey', v_key, 'actionCode', p_action_code, 'markedAt', v_now,
      'state', 'pending', 'reservedQuotaDate', v_vn)),
    first_marked_at = coalesce(first_marked_at, v_now)
  WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'markedAt', v_now);
END $f$;

CREATE FUNCTION public.aka_agent_engine_report_v1(
  p_target_run_id bigint, p_lease_token uuid, p_outcomes jsonb, p_final boolean DEFAULT false, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  r public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_lease_ok boolean;
  v_run_open boolean;
  o jsonb;
  v_results jsonb := '[]'::jsonb;
  v_rk text;
  v_prev public.auto_engine_outcomes%ROWTYPE;
  v_is_replay boolean;
  v_action text;
  v_phase text;
  v_ok boolean;
  v_status_id bigint;
  v_signal jsonb;
  v_evidence jsonb;
  v_platform text;
  v_op_class text;
  v_action_name text;
  v_rule_id bigint;
  v_matched_by text;
  v_catch_all boolean;
  v_error_code text;
  v_policy jsonb;
  v_err public.auto_error%ROWTYPE;
  v_delivery text;
  v_count boolean;
  v_mark_idx integer;
  v_mark jsonb;
  v_reserved boolean;
  v_sem record;
  v_log text;
  v_detail_id bigint;
  v_until timestamptz;
  v_lock_until_max timestamptz;
  v_lc text;
  v_side boolean;
  v_decision jsonb;
  v_contrib jsonb;
  v_call jsonb := '[]'::jsonb;
  v_call_new jsonb := '[]'::jsonb;
  v_all jsonb;
  -- Chỉ thị của lượt gọi này.
  v_target_done boolean := false;
  v_run_rank integer := 0;
  v_rank integer;
  v_pace jsonb;
  v_pace_rank integer := 0;
  v_camp_effect text := 'none';
  v_camp_note text;
  v_camp_hold integer;
  v_acc_effect text := 'none';
  v_login_effect text := 'none';
  -- Tổng hợp theo data: mọi kết quả của lượt chạy data này, kể cả các lần gọi trước.
  v_target_effect text;
  v_target_rank integer := 0;
  v_requeue_minutes integer;
  v_note text;
  v_last_error_code text;
  v_last_action text;
  v_streak text := 'ignore';
  v_covered boolean := false;
  v_thr_effect text := 'none';
  v_thr_threshold integer;
  v_thr_hold integer;
  v_thr_source text;
  v_guard_code text;
  v_gp jsonb;
  v_streak_count integer;
  v_any_committed boolean := false;
  v_final_status text;
  v_schedule timestamptz;
  v_safety jsonb := '[]'::jsonb;
  v_camp_applied text := 'none';
  v_next text;
  v_target_key text;
  v_outcome_count integer := 0;
  v_more boolean;
BEGIN
  -- Lô rỗng chỉ hợp lệ khi chốt data (các bước còn lại bị bỏ vì bước trước không đạt).
  IF p_outcomes IS NULL OR jsonb_typeof(p_outcomes) <> 'array' OR (jsonb_array_length(p_outcomes) = 0 AND NOT p_final) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outcomes_required');
  END IF;
  IF (SELECT count(DISTINCT btrim(x.value->>'resultKey')) FROM jsonb_array_elements(p_outcomes) x) <> jsonb_array_length(p_outcomes) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_key_duplicate');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_not_found'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token THEN RETURN jsonb_build_object('ok', false, 'reason', 'lease_token_mismatch'); END IF;

  -- Kiểm cả lô trước khi ghi: lô sai thì không ghi phần nào.
  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := nullif(btrim(o->>'resultKey'), '');
    IF v_rk IS NULL OR length(v_rk) NOT BETWEEN 8 AND 200 THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_required'); END IF;
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    IF FOUND THEN
      IF v_prev.target_run_id <> r.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_conflict', 'resultKey', v_rk); END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = o->>'actionCode') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
    END IF;
    IF coalesce(nullif(o->>'phase', ''), 'after_send') NOT IN ('before_send', 'in_flight', 'after_send') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'phase_invalid', 'phase', o->>'phase');
    END IF;
    IF jsonb_typeof(coalesce(o->'ok', 'false'::jsonb)) <> 'boolean' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ok_invalid'); END IF;
    IF coalesce((o->>'ok')::boolean, false) AND NOT EXISTS (SELECT 1 FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail'
           AND s.is_active AND NOT s.is_delete) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
  END LOOP;

  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id;
  SELECT * INTO t FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
  v_run_open := r.completed_at IS NULL;
  v_lease_ok := v_run_open AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
    WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now);
  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);

  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := btrim(o->>'resultKey');
    -- Gọi lại cùng result_key: trả lại đúng quyết định cũ, không gộp chính sách lần nữa.
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    v_is_replay := FOUND;
    IF v_is_replay THEN
      v_decision := v_prev.decision;
      v_results := v_results || jsonb_build_array((v_decision->'result') || jsonb_build_object('replay', true));
      v_contrib := v_decision->'contrib';
    ELSE
      v_action := o->>'actionCode';
      SELECT aa.flatform_type, coalesce(aa.operation_class, 'delivery'), aa.name INTO v_platform, v_op_class, v_action_name
        FROM public.auto_account_actions aa WHERE aa.code = v_action;
      -- Tên thao tác ghi vào lịch sử: như helper Desktop ("Tìm SĐT"…) khi bộ chạy gửi kèm, không thì tên trong danh mục.
      v_action_name := coalesce(nullif(left(btrim(coalesce(o->>'actionName', '')), 120), ''), v_action_name);
      v_phase := coalesce(nullif(o->>'phase', ''), 'after_send');
      v_ok := coalesce((o->>'ok')::boolean, false);
      v_signal := coalesce(o->'signal', '{}'::jsonb);
      v_evidence := coalesce(o->'evidence', '{}'::jsonb);
      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;

      IF v_ok THEN
        SELECT s.id INTO v_status_id FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail';
      ELSE
        SELECT cs.error_code, cs.rule_id, cs.matched_by, cs.is_catch_all INTO v_error_code, v_rule_id, v_matched_by, v_catch_all
          FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, v_signal) cs;
        v_error_code := coalesce(v_error_code, 'err_undefined');
        IF coalesce(v_catch_all, true) AND NOT p_dry_run THEN
          INSERT INTO public.auto_outcome_unmatched AS u (platform, action_code, phase, signal_kind, pattern_key, fallback_error_code, sample, hit_count, first_seen_at, last_seen_at)
          VALUES (v_platform, v_action, v_phase, coalesce(nullif(v_signal->>'kind', ''), 'unknown'), coalesce(public.aka_agent_engine_pattern_key(v_signal), ''),
                  v_error_code, v_signal, 1, v_now, v_now)
          ON CONFLICT (platform, action_code, phase, signal_kind, pattern_key) DO UPDATE SET
            hit_count = u.hit_count + 1, last_seen_at = EXCLUDED.last_seen_at, sample = EXCLUDED.sample, fallback_error_code = EXCLUDED.fallback_error_code;
        END IF;
        SELECT * INTO v_err FROM public.auto_error e WHERE e.error_code = v_error_code;
      END IF;

      v_policy := public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, c.action_id, r.runtime_target, v_phase);
      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);

      -- Trạng thái giao: chỉ thao tác loại delivery mới có thể "đã giao".
      v_delivery := CASE
        WHEN v_op_class <> 'delivery' THEN 'none'
        WHEN v_ok THEN CASE WHEN coalesce(v_sem.counts_as_delivered, false) THEN 'delivered' ELSE 'none' END
        WHEN coalesce((v_evidence->>'partialDelivery')::boolean, false) THEN 'partial'
        WHEN v_phase = 'in_flight' OR v_policy->>'error_class' = 'unknown_delivery' OR v_evidence->>'deliveryState' = 'unknown' THEN 'unknown'
        ELSE 'not_delivered' END;

      -- Giải quyết dấu "sắp gửi" của bước này.
      v_reserved := false; v_mark_idx := NULL; v_mark := NULL;
      SELECT (x.ordinality - 1)::integer, x.value INTO v_mark_idx, v_mark
        FROM jsonb_array_elements(r.marks) WITH ORDINALITY x
       WHERE x.value->>'stepKey' = coalesce(nullif(o->>'stepKey', ''), v_action) AND x.value->>'state' = 'pending'
       LIMIT 1;
      IF v_mark_idx IS NOT NULL THEN
        v_reserved := (v_mark->>'reservedQuotaDate')::date = v_vn;
        r.marks := jsonb_set(r.marks, ARRAY[v_mark_idx::text, 'state'],
          to_jsonb(CASE WHEN v_delivery = 'none' THEN 'not_delivered' ELSE v_delivery END));
      ELSIF v_op_class = 'delivery' AND v_delivery IN ('delivered', 'partial', 'unknown') THEN
        v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'unmarked_delivery', 'actionCode', v_action, 'resultKey', v_rk));
      END IF;

      -- Giao một phần luôn tính lượt (giống partialDelivery hiện nay).
      v_count := CASE v_policy->>'quota_effect' WHEN 'count' THEN true WHEN 'no_count' THEN false
                 ELSE v_delivery IN ('delivered', 'partial', 'unknown') END
                 OR v_delivery = 'partial';
      IF NOT p_dry_run THEN
        IF v_reserved AND NOT v_count THEN
          UPDATE public.auto_account_action_status SET count_action_in_day = greatest(count_action_in_day - 1, 0), updated_at = v_now
           WHERE account_id = r.account_id AND action_code = v_action AND count_date = v_vn;
        ELSIF NOT v_reserved AND v_count THEN
          INSERT INTO public.auto_account_action_status AS s (account_id, action_code, count_action_in_day, count_date)
          VALUES (r.account_id, v_action, 1, v_vn)
          ON CONFLICT (account_id, action_code) DO UPDATE SET
            count_action_in_day = CASE WHEN s.count_date = v_vn THEN s.count_action_in_day + 1 ELSE 1 END, count_date = v_vn, updated_at = v_now;
        END IF;
      END IF;

      -- Khoá thao tác (sự thật về tài khoản: áp cả khi lease đã mất).
      v_until := NULL;
      IF jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0 THEN
        v_until := public.aka_agent_engine_lock_until(v_policy->>'lock_mode', (v_policy->>'lock_minutes')::integer,
          (v_policy->>'lock_days')::integer, (v_policy->>'lock_time')::time, v_now);
      END IF;

      v_log := CASE
        WHEN v_ok THEN coalesce(public.aka_agent_engine_render(v_policy->>'log_template',
                  jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name)), nullif(o->>'customerLog', ''),
                  coalesce(v_action_name, v_action) || ': ' || coalesce(v_sem.status_value, 'thành công'))
        ELSE coalesce(
                  public.aka_agent_engine_render(v_policy->>'log_template',
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  public.aka_agent_engine_render(coalesce(v_err.customer_title, v_err.noti_running_process, v_err.error_name),
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  coalesce(v_action_name, v_action) || ' không thành công')
             || CASE WHEN v_err.public_code IS NOT NULL THEN ' (' || v_err.public_code || ')' ELSE '' END
        END;

      IF NOT p_dry_run THEN
        FOR v_lc IN SELECT jsonb_array_elements_text(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) LOOP
          IF EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = v_lc) THEN
            INSERT INTO public.auto_account_action_status AS s (account_id, action_code, is_disable, date_enable, disabled_error_code, disabled_reason, disabled_at)
            VALUES (r.account_id, v_lc, true, v_until, v_error_code, v_log, v_now)
            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now;
          END IF;
        END LOOP;

        IF v_error_code IS NOT NULL AND coalesce((v_policy->>'remember_target_days')::integer, 0) > 0 AND v_target_key IS NOT NULL THEN
          INSERT INTO public.auto_target_memory AS m (organization_id, target_key, action_code, error_code, first_seen_at, last_seen_at, expires_at, hit_count)
          VALUES (coalesce(c.organization_id, 0), v_target_key, v_action, v_error_code, v_now, v_now,
                  v_now + make_interval(days => (v_policy->>'remember_target_days')::integer), 1)
          ON CONFLICT (organization_id, target_key, action_code) DO UPDATE SET error_code = EXCLUDED.error_code,
            last_seen_at = EXCLUDED.last_seen_at, expires_at = EXCLUDED.expires_at, hit_count = m.hit_count + 1;
        END IF;

        IF v_policy->>'detail_mode' = 'write' THEN
          INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, status_id, sub_status_id,
            error_code, counts_toward_limit, report_group, log, data, policy_snapshot, result_key, created_at)
          VALUES (r.input_data_id, r.campaign_id, r.account_id, v_action_name, v_action, coalesce(v_sem.status_value, 'thất bại'),
            (v_policy->>'detail_status_id')::bigint, (v_policy->>'sub_status_id')::bigint, v_error_code, v_count, v_sem.report_group, v_log,
            jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal, 'evidence', v_evidence)
              || coalesce(o->'data', '{}'::jsonb),
            jsonb_build_object('engine', 'v2',
              'operationState', CASE WHEN v_delivery IN ('delivered', 'partial') THEN 'committed'
                                     WHEN v_delivery = 'unknown' THEN 'unknown' ELSE 'not_committed' END,
              'actionCode', v_action, 'statusCode', v_sem.status_code, 'errorCode', v_error_code, 'countsTowardLimit', v_count,
              'badTargetEffect', v_policy->>'target_streak_effect',
              'v2', jsonb_build_object('errorClass', v_policy->>'error_class', 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)),
            v_rk, v_now)
          RETURNING id INTO v_detail_id;
        END IF;
      END IF;

      v_side := jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0
        OR coalesce(v_policy->>'campaign_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'account_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'login_effect', 'none') <> 'none';
      v_contrib := jsonb_build_object(
        'seq', r.outcome_count + v_outcome_count + 1,
        'ok', v_ok, 'actionCode', v_action, 'errorCode', v_error_code, 'delivery', v_delivery,
        'targetEffect', CASE WHEN v_ok AND v_policy->>'remaining_steps' <> 'skip' THEN NULL ELSE v_policy->>'target_effect' END,
        'requeueAfterMinutes', v_policy->'requeue_after_minutes',
        'remaining', v_policy->>'remaining_steps',
        'streak', v_policy->>'target_streak_effect', 'streakThreshold', v_policy->'streak_threshold', 'sideEffect', v_side,
        'runEffect', v_policy->>'run_effect',
        'pace', jsonb_build_object('mode', v_policy->>'pace_mode', 'seconds', v_policy->'pace_seconds'),
        'campaignEffect', v_policy->>'campaign_effect', 'campaignHoldMinutes', v_policy->'campaign_hold_minutes',
        'campaignNote', CASE WHEN v_policy->>'campaign_effect' IN ('pause', 'hold') THEN
             -- Như renderZaloPolicyCampaignNote: [x]/[t] là số phút khoá (khoá theo phút), không thì câu lỗi.
             coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign),
               jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                 'until', public.aka_agent_engine_format_vn(v_until),
                 'x', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE coalesce(v_signal->>'message', '') END,
                 't', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE '' END)), v_log)
             || CASE WHEN v_err.public_code IS NOT NULL
                     AND position('(' || v_err.public_code || ')' IN coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign), '{}'::jsonb), v_log)) = 0
                  THEN ' (' || v_err.public_code || ')' ELSE '' END
           ELSE NULL END,
        'accountEffect', v_policy->>'account_effect', 'loginEffect', v_policy->>'login_effect',
        'lockUntil', v_until, 'log', v_log);
      v_decision := jsonb_build_object(
        'result', jsonb_build_object('resultKey', v_rk, 'actionCode', v_action, 'actionName', v_action_name, 'ok', v_ok, 'errorCode', v_error_code,
          'publicCode', v_err.public_code, 'errorClass', v_policy->>'error_class', 'statusId', (v_policy->>'detail_status_id')::bigint,
          'statusCode', v_sem.status_code, 'reportGroup', v_sem.report_group, 'deliveryState', v_delivery, 'countsTowardLimit', v_count,
          'detailId', v_detail_id, 'log', v_log, 'lockUntil', v_until),
        'contrib', v_contrib,
        'policy', v_policy);
      IF NOT p_dry_run THEN
        INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok,
          error_code, status_id, delivery_state, detail_id, decision, signal, created_at)
        VALUES (v_rk, r.id, r.input_data_id, r.campaign_id, r.account_id, v_action, v_phase, v_ok, v_error_code,
          (v_policy->>'detail_status_id')::bigint, v_delivery, v_detail_id, v_decision, v_signal, v_now);
      END IF;
      v_results := v_results || jsonb_build_array(v_decision->'result');
      v_outcome_count := v_outcome_count + 1;
      v_call_new := v_call_new || jsonb_build_array(v_contrib);
    END IF;
    v_call := v_call || jsonb_build_array(v_contrib);
  END LOOP;

  -- Lượt gọi này: data xong chưa (bước còn lại có chạy tiếp không), hiệu ứng áp ngay.
  -- run_effect (dừng lượt/tài khoản/chiến dịch) chỉ có hiệu lực SAU khi data hiện tại xong,
  -- giống stopAfterTarget hiện nay; các bước còn lại của data vẫn chạy trừ khi remaining_steps=skip.
  FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_call) x LOOP
    IF v_contrib->>'remaining' = 'skip' THEN v_target_done := true; END IF;
    -- Hiệu ứng chiến dịch áp ngay khi mã không có ngưỡng hoặc kết quả không tăng chuỗi
    -- (applyRuntimeErrorPolicy hiện nay); có ngưỡng và tăng chuỗi thì xét ở cuối data.
    IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
       AND ((v_contrib->>'streakThreshold') IS NULL OR v_contrib->>'streak' IS DISTINCT FROM 'increment')
       AND (v_camp_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_contrib->>'campaignEffect';
      v_camp_note := v_contrib->>'campaignNote';
      v_camp_hold := (v_contrib->>'campaignHoldMinutes')::integer;
    END IF;
    IF coalesce(v_contrib->>'accountEffect', 'none') = 'pause' THEN v_acc_effect := 'pause'; END IF;
    IF coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN v_login_effect := v_contrib->>'loginEffect'; END IF;
    IF (v_contrib->>'lockUntil') IS NOT NULL THEN
      v_lock_until_max := greatest(coalesce(v_lock_until_max, (v_contrib->>'lockUntil')::timestamptz), (v_contrib->>'lockUntil')::timestamptz);
    END IF;
  END LOOP;
  v_target_done := v_target_done OR p_final;

  IF v_target_done THEN
    SELECT coalesce(jsonb_agg(eo.decision->'contrib' ORDER BY (eo.decision->'contrib'->>'seq')::integer, eo.result_key), '[]'::jsonb) INTO v_all
      FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = r.id;
    IF p_dry_run THEN v_all := v_all || v_call_new; END IF;
    -- Không bao giờ đóng data mà không có kết quả nào (chống "thành công giả"): runtime phải báo no_outcome.
    IF jsonb_array_length(v_all) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_outcomes'); END IF;
    FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_all) x LOOP
      IF v_contrib->>'delivery' IN ('delivered', 'partial', 'unknown') THEN v_any_committed := true; END IF;
      -- Sau khi data xong: dừng lượt/tài khoản/chiến dịch theo kết quả nặng nhất của data này.
      v_rank := greatest(
        CASE v_contrib->>'runEffect' WHEN 'stop_campaign' THEN 4 WHEN 'stop_account' THEN 3 WHEN 'end_unit' THEN 2 ELSE 0 END,
        CASE WHEN coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
              AND ((v_contrib->>'streakThreshold') IS NULL OR v_contrib->>'streak' IS DISTINCT FROM 'increment') THEN 4 ELSE 0 END,
        CASE WHEN coalesce(v_contrib->>'accountEffect', 'none') <> 'none' OR coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN 3 ELSE 0 END);
      IF v_rank > v_run_rank THEN v_run_rank := v_rank; END IF;
      -- Nghỉ sau data theo kết quả "nặng" nhất: full > short > none (bản cũ nghỉ sau mọi data).
      v_rank := CASE v_contrib->'pace'->>'mode' WHEN 'full' THEN 3 WHEN 'short' THEN 2 WHEN 'none' THEN 1 ELSE 0 END;
      IF v_rank > v_pace_rank OR (v_rank = v_pace_rank AND v_rank > 0
           AND coalesce((v_contrib->'pace'->>'seconds')::integer, -1) > coalesce((v_pace->>'seconds')::integer, -1)) THEN
        v_pace_rank := v_rank; v_pace := v_contrib->'pace';
      END IF;
      IF v_contrib->>'targetEffect' IS NOT NULL THEN
        v_rank := CASE v_contrib->>'targetEffect' WHEN 'hold' THEN 3 WHEN 'requeue' THEN 2 WHEN 'requeue_after' THEN 2 ELSE 1 END;
        IF v_rank > v_target_rank THEN
          v_target_rank := v_rank; v_target_effect := v_contrib->>'targetEffect';
          v_requeue_minutes := (v_contrib->>'requeueAfterMinutes')::integer;
        END IF;
      END IF;
      IF NOT coalesce((v_contrib->>'ok')::boolean, false) THEN
        v_note := v_contrib->>'log'; v_last_error_code := v_contrib->>'errorCode'; v_last_action := v_contrib->>'actionCode';
      END IF;
      -- Chuỗi mục tiêu lỗi: increment > reset > ignore (giống aggregateResultEffects).
      IF v_contrib->>'streak' = 'increment' THEN
        v_streak := 'increment';
        IF (v_contrib->>'streakThreshold') IS NOT NULL OR coalesce((v_contrib->>'sideEffect')::boolean, false) THEN v_covered := true; END IF;
      ELSIF v_contrib->>'streak' = 'reset' AND v_streak <> 'increment' THEN
        v_streak := 'reset';
      END IF;
      IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none' AND (v_contrib->>'streakThreshold') IS NOT NULL
         AND v_contrib->>'streak' = 'increment'
         AND (v_thr_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_thr_effect = 'hold')) THEN
        v_thr_effect := v_contrib->>'campaignEffect';
        v_thr_threshold := (v_contrib->>'streakThreshold')::integer;
        v_thr_hold := (v_contrib->>'campaignHoldMinutes')::integer;
        v_thr_source := v_contrib->>'errorCode';
      END IF;
    END LOOP;
    -- Bước đã giao trước đó trong lượt này cũng chặn việc trả về hàng đợi.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown')) THEN
      v_any_committed := true;
    END IF;

    v_target_effect := coalesce(v_target_effect, 'complete');
    IF v_target_effect IN ('requeue', 'requeue_after') AND v_any_committed THEN
      v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'no_requeue_after_delivery', 'from', v_target_effect));
      v_target_effect := 'complete';
    END IF;
    v_final_status := CASE v_target_effect WHEN 'hold' THEN 'tạm dừng' WHEN 'complete' THEN 'hoàn thành' ELSE 'chờ xử lý' END;
    v_schedule := CASE WHEN v_target_effect = 'requeue_after'
      THEN coalesce(v_lock_until_max, v_now + make_interval(mins => coalesce(v_requeue_minutes, 0))) ELSE NULL END;
    -- Data vừa trả về hàng đợi không được nhận lại ngay trong cùng lượt (tránh lặp nóng).
    IF v_final_status = 'chờ xử lý' AND (v_schedule IS NULL OR v_schedule <= v_now) AND v_run_rank < 2 THEN
      v_run_rank := 2;
      v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'requeue_ends_unit'));
    END IF;

    -- Chuỗi lỗi chỉ đổi khi lượt chạy còn mở (báo muộn sau khi data đã bị đóng không đếm lại).
    IF v_run_open AND NOT p_dry_run AND v_streak = 'increment' THEN
      INSERT INTO public.auto_campaign_error_state AS es (campaign_id, count_consecutive_bad_targets, last_input_data_id, last_reason, last_bad_target_at)
      VALUES (r.campaign_id, 1, r.input_data_id, coalesce(v_last_error_code, v_note), v_now)
      ON CONFLICT (campaign_id) DO UPDATE SET count_consecutive_bad_targets = es.count_consecutive_bad_targets + 1,
        last_input_data_id = EXCLUDED.last_input_data_id, last_reason = EXCLUDED.last_reason, last_bad_target_at = EXCLUDED.last_bad_target_at, updated_at = v_now
      RETURNING count_consecutive_bad_targets INTO v_streak_count;
    ELSIF v_run_open AND NOT p_dry_run AND v_streak = 'reset' THEN
      UPDATE public.auto_campaign_error_state SET count_consecutive_bad_targets = 0, updated_at = v_now WHERE campaign_id = r.campaign_id;
      v_streak_count := 0;
    ELSE
      SELECT es.count_consecutive_bad_targets INTO v_streak_count FROM public.auto_campaign_error_state es WHERE es.campaign_id = r.campaign_id;
      v_streak_count := CASE WHEN NOT v_run_open THEN coalesce(v_streak_count, 0)
                             WHEN v_streak = 'increment' THEN coalesce(v_streak_count, 0) + 1
                             WHEN v_streak = 'reset' THEN 0 ELSE coalesce(v_streak_count, 0) END;
    END IF;

    -- Ngưỡng chung: mã tăng chuỗi mà không có ngưỡng/hiệu ứng riêng thì theo mã canh chuỗi
    -- (mặc định err_undefined), giống guard đang chạy ở campaignScheduler.
    IF v_streak = 'increment' AND NOT v_covered AND v_thr_effect = 'none' THEN
      v_guard_code := nullif(btrim(public.aka_agent_engine_setting('engine.bad_target_guard_error_code', 'err_undefined')), '');
      IF v_guard_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = v_guard_code AND e.is_active AND NOT e.is_delete) THEN
        v_gp := public.aka_agent_engine_resolve_policy(v_guard_code, NULL, coalesce(v_last_action, ''), c.action_id, r.runtime_target, 'after_send');
        IF (v_gp->>'streak_threshold') IS NOT NULL AND coalesce(v_gp->>'campaign_effect', 'none') <> 'none' THEN
          v_thr_effect := v_gp->>'campaign_effect';
          v_thr_threshold := (v_gp->>'streak_threshold')::integer;
          v_thr_hold := (v_gp->>'campaign_hold_minutes')::integer;
          v_thr_source := v_guard_code;
        END IF;
      END IF;
    END IF;
    IF v_run_open AND v_thr_effect <> 'none' AND v_streak = 'increment' AND v_streak_count >= v_thr_threshold
       AND (v_camp_effect = 'none' OR (v_thr_effect = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_thr_effect;
      v_camp_hold := v_thr_hold;
      v_camp_note := 'Dừng sau ' || v_streak_count || ' data lỗi/thất bại liên tiếp (ngưỡng ' || v_thr_threshold || '): '
        || coalesce(v_note, 'Lỗi không xác định');
    END IF;

    IF NOT p_dry_run THEN
      IF v_run_open THEN
        UPDATE public.auto_campaign_input_data SET status = v_final_status,
          note = CASE WHEN v_note IS NOT NULL THEN v_note ELSE note END,
          schedule = CASE WHEN v_schedule IS NOT NULL THEN v_schedule ELSE schedule END,
          date_action = v_now
        WHERE id = r.input_data_id AND status = 'đang chạy';
      END IF;
      UPDATE public.auto_engine_target_runs SET marks = r.marks, completed_at = coalesce(completed_at, v_now),
        final_target_status = coalesce(final_target_status, v_final_status), final_error_code = coalesce(final_error_code, v_last_error_code),
        close_reason = coalesce(close_reason, 'reported'), outcome_count = outcome_count + v_outcome_count
      WHERE id = r.id;
    END IF;
  ELSIF NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET marks = r.marks, outcome_count = outcome_count + v_outcome_count WHERE id = r.id;
  END IF;
  -- Còn data đến hạn phía sau không: runtime chỉ nghỉ giữa 2 lần gửi khi còn việc.
  IF v_target_done THEN
    v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
      WHERE d.campaign_id = r.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
        AND (d.schedule IS NULL OR d.schedule <= v_now));
  END IF;

  -- Hiệu ứng chiến dịch/tài khoản chỉ áp khi còn giữ chỗ; mô phỏng thì chỉ báo sẽ áp gì.
  IF v_lease_ok AND NOT p_dry_run THEN
    IF v_camp_effect <> 'none' THEN
      UPDATE public.auto_campaigns SET
        status = CASE v_camp_effect WHEN 'pause' THEN 'tạm dừng' ELSE 'chờ xử lý' END,
        schedule = CASE WHEN v_camp_effect = 'hold' AND coalesce(v_camp_hold, 0) > 0 THEN v_now + make_interval(mins => v_camp_hold) ELSE schedule END,
        note = coalesce(v_camp_note, note), updated_at = v_now
      WHERE id = r.campaign_id;
      v_camp_applied := v_camp_effect;
    END IF;
    IF v_acc_effect = 'pause' THEN UPDATE public.auto_accounts SET status = 'tạm dừng', updated_at = v_now WHERE id = r.account_id; END IF;
    IF v_login_effect <> 'none' THEN
      UPDATE public.auto_accounts SET login_status = CASE v_login_effect WHEN 'checkpoint' THEN 'checkpoint' ELSE 'chưa đăng nhập' END, updated_at = v_now
       WHERE id = r.account_id;
    END IF;
  ELSIF p_dry_run AND v_lease_ok THEN
    v_camp_applied := v_camp_effect;
  END IF;

  v_next := CASE
    WHEN NOT v_lease_ok THEN 'ownership_lost'
    WHEN NOT v_target_done THEN 'next_step'
    WHEN v_camp_applied <> 'none' OR v_run_rank = 4 THEN 'stop_campaign'
    WHEN v_run_rank = 3 THEN 'stop_account'
    WHEN v_run_rank = 2 THEN 'end_unit'
    ELSE 'next_target' END;

  RETURN jsonb_build_object('ok', true, 'dryRun', p_dry_run, 'next', v_next,
    'pace', CASE WHEN v_target_done THEN v_pace ELSE NULL END,
    'outcomes', v_results,
    'target', jsonb_build_object('done', v_target_done, 'status', v_final_status, 'note', v_note, 'schedule', v_schedule, 'morePending', v_more),
    'streak', CASE WHEN v_target_done THEN jsonb_build_object('effect', v_streak, 'count', v_streak_count, 'threshold', v_thr_threshold, 'source', v_thr_source) END,
    'campaign', jsonb_build_object('effect', v_camp_applied, 'note', CASE WHEN v_camp_applied <> 'none' THEN v_camp_note END),
    'account', jsonb_build_object('effect', v_acc_effect, 'loginEffect', v_login_effect),
    'safety', v_safety);
END $f$;

CREATE FUNCTION public.aka_agent_engine_heartbeat_v1(p_account_id bigint, p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, public.aka_agent_engine_setting('engine.lease_seconds', '180')::integer);
  l public.auto_engine_leases%ROWTYPE;
  c record;
  a record;
BEGIN
  UPDATE public.auto_engine_leases SET heartbeat_at = v_now, expires_at = v_now + make_interval(secs => v_lease_seconds)
   WHERE account_id = p_account_id AND lease_token = p_lease_token
  RETURNING * INTO l;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  SELECT cc.status, coalesce(cc.is_delete, false) AS is_delete INTO c FROM public.auto_campaigns cc WHERE cc.id = l.campaign_id;
  SELECT aa.status, aa.login_status, coalesce(aa.is_delete, false) AS is_delete INTO a FROM public.auto_accounts aa WHERE aa.id = p_account_id;
  RETURN jsonb_build_object('ok', true, 'expiresAt', l.expires_at,
    'control', jsonb_build_object('campaignStatus', c.status, 'campaignDeleted', c.is_delete,
      'accountStatus', a.status, 'loginStatus', a.login_status, 'accountDeleted', a.is_delete));
END $f$;

CREATE FUNCTION public.aka_agent_engine_release_v1(p_account_id bigint, p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  l public.auto_engine_leases%ROWTYPE;
  v_open integer;
BEGIN
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = p_account_id AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  SELECT count(*) INTO v_open FROM public.auto_engine_target_runs WHERE account_id = p_account_id AND lease_token = p_lease_token AND completed_at IS NULL;
  IF v_open > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'open_target_runs', 'openRuns', v_open); END IF;
  DELETE FROM public.auto_engine_leases WHERE account_id = p_account_id AND lease_token = p_lease_token;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = l.campaign_id AND status = 'đang chạy' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
  UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = p_account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
  RETURN jsonb_build_object('ok', true,
    'pendingTargets', (SELECT count(*) FROM public.auto_campaign_input_data d WHERE d.campaign_id = l.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false));
END $f$;

-- Đóng data dở của lease đã hết hạn (pg_cron mỗi phút). Không bao giờ trả về hàng đợi data có dấu "sắp gửi".
CREATE FUNCTION public.aka_agent_engine_close_stale_v1(p_limit integer DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_stale interval := make_interval(mins => greatest(1, public.aka_agent_engine_setting('engine.stale_target_minutes', '10')::integer));
  v_unsent text := public.aka_agent_engine_setting('engine.stale_unsent_target_action', 'complete');
  rr public.auto_engine_target_runs%ROWTYPE;
  v_marked boolean;
  v_code text;
  v_msg text;
  v_status text;
  v_closed integer := 0;
  v_released integer := 0;
  v_lease record;
BEGIN
  FOR rr IN
    SELECT tr.* FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.started_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l
                        WHERE l.account_id = tr.account_id AND l.lease_token = tr.lease_token AND l.expires_at > v_now - v_stale)
     ORDER BY tr.id LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_marked := EXISTS (SELECT 1 FROM jsonb_array_elements(rr.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown'))
             OR EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id AND eo.delivery_state IN ('delivered', 'partial', 'unknown'));
    IF v_marked THEN
      v_code := 'err_engine_interrupted_while_sending'; v_status := 'hoàn thành';
    ELSIF v_unsent = 'requeue' THEN
      v_code := 'err_engine_interrupted_before_send'; v_status := 'chờ xử lý';
    ELSE
      v_code := 'err_engine_interrupted_before_send'; v_status := 'hoàn thành';
    END IF;
    SELECT coalesce(e.customer_title, e.error_name) || CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
      INTO v_msg FROM public.auto_error e WHERE e.error_code = v_code;
    -- Bộ cũ đã nhận lại chiến dịch (cập nhật app ngược, tắt cờ): không đụng data, chỉ đóng sổ lượt của bộ mới.
    UPDATE public.auto_campaign_input_data SET status = v_status, note = coalesce(v_msg, note), date_action = v_now
     WHERE id = rr.input_data_id AND status = 'đang chạy'
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = rr.campaign_id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
    INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, error_code, message, data)
    VALUES (rr.input_data_id, rr.campaign_id, rr.id, 'interrupted', v_code, coalesce(v_msg, v_code),
            jsonb_build_object('marked', v_marked, 'runnerId', rr.runner_id, 'leaseToken', rr.lease_token));
    UPDATE public.auto_engine_target_runs SET completed_at = v_now, final_target_status = v_status, final_error_code = v_code, close_reason = 'stale'
     WHERE id = rr.id;
    v_closed := v_closed + 1;
  END LOOP;

  FOR v_lease IN
    SELECT l.account_id, l.campaign_id, l.lease_token FROM public.auto_engine_leases l
     WHERE l.expires_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = l.account_id AND tr.lease_token = l.lease_token AND tr.completed_at IS NULL)
     ORDER BY l.expires_at LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    DELETE FROM public.auto_engine_leases WHERE account_id = v_lease.account_id AND lease_token = v_lease.lease_token;
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.campaign_id AND status = 'đang chạy' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
    UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
    v_released := v_released + 1;
  END LOOP;
  RETURN jsonb_build_object('closedTargets', v_closed, 'releasedLeases', v_released);
END $f$;

-- Sự kiện sau khi gửi (đã xem, phản hồi, mở email…) → trạng thái tiến triển (sub_status_id), theo thứ hạng.
CREATE FUNCTION public.aka_agent_engine_apply_status_event_v1(p_detail_id bigint, p_event_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  d record;
  v_rule record;
  v_new_rank integer;
  v_cur_rank integer;
BEGIN
  SELECT cd.id, cd.action_code, cd.status_id, cd.sub_status_id INTO d FROM public.auto_campaign_details cd WHERE cd.id = p_detail_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'detail_not_found'); END IF;
  SELECT er.status_id INTO v_rule FROM public.auto_status_event_rules er
   WHERE er.is_active AND er.event_kind = p_event_kind AND (er.action_code IS NULL OR er.action_code = d.action_code)
   ORDER BY (er.action_code IS NULL) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'applied', false, 'reason', 'no_rule'); END IF;
  SELECT s.progress_rank INTO v_new_rank FROM public.aka_agent_status_semantics(v_rule.status_id) s;
  SELECT s.progress_rank INTO v_cur_rank FROM public.aka_agent_status_semantics(coalesce(d.sub_status_id, d.status_id)) s;
  IF d.sub_status_id IS NOT NULL AND coalesce(v_new_rank, 0) <= coalesce(v_cur_rank, 0) THEN
    RETURN jsonb_build_object('ok', true, 'applied', false, 'reason', 'not_higher');
  END IF;
  UPDATE public.auto_campaign_details SET sub_status_id = v_rule.status_id WHERE id = d.id;
  RETURN jsonb_build_object('ok', true, 'applied', true, 'subStatusId', v_rule.status_id);
END $f$;

-- Dòng thời gian một data: lượt chạy, dấu "sắp gửi", mốc lịch sử, sự kiện chờ/bị ngắt.
CREATE FUNCTION public.aka_agent_engine_target_timeline_v1(p_input_data_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.at, x.ord), '[]'::jsonb) FROM (
    SELECT tr.started_at AS at, 1 AS ord, jsonb_build_object('at', tr.started_at, 'kind', 'started', 'targetRunId', tr.id, 'runnerId', tr.runner_id) AS item
      FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = p_input_data_id
    UNION ALL
    SELECT (m.value->>'markedAt')::timestamptz, 2, jsonb_build_object('at', m.value->>'markedAt', 'kind', 'mark_sending',
             'actionCode', m.value->>'actionCode', 'state', m.value->>'state')
      FROM public.auto_engine_target_runs tr, jsonb_array_elements(tr.marks) m WHERE tr.input_data_id = p_input_data_id
    UNION ALL
    SELECT cd.created_at, 3, jsonb_build_object('at', cd.created_at, 'kind', 'milestone', 'detailId', cd.id, 'actionCode', cd.action_code,
             'status', cd.status, 'errorCode', cd.error_code, 'publicCode', e.public_code, 'log', cd.log)
      FROM public.auto_campaign_details cd LEFT JOIN public.auto_error e ON e.error_code = cd.error_code
     WHERE cd.input_data_id = p_input_data_id AND cd.is_delete = false
    UNION ALL
    SELECT ev.created_at, 4, jsonb_build_object('at', ev.created_at, 'kind', ev.kind, 'errorCode', ev.error_code, 'message', ev.message)
      FROM public.auto_engine_target_events ev WHERE ev.input_data_id = p_input_data_id
    UNION ALL
    SELECT tr.completed_at, 5, jsonb_build_object('at', tr.completed_at, 'kind', 'completed', 'status', tr.final_target_status,
             'errorCode', tr.final_error_code, 'reason', tr.close_reason)
      FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = p_input_data_id AND tr.completed_at IS NOT NULL
  ) x
  WHERE public.aka_agent_engine_scope_ok((SELECT c.staff_id FROM public.auto_campaign_input_data d
                                           JOIN public.auto_campaigns c ON c.id = d.campaign_id WHERE d.id = p_input_data_id))
$f$;

CREATE FUNCTION public.aka_agent_engine_record_wait_v1(p_target_run_id bigint, p_lease_token uuid, p_error_code text, p_until timestamptz, p_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE r public.auto_engine_target_runs%ROWTYPE;
BEGIN
  IF coalesce(p_seconds, 0) < public.aka_agent_engine_setting('engine.timeline_min_wait_seconds', '30')::integer THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false);
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id;
  IF NOT FOUND OR r.lease_token IS DISTINCT FROM p_lease_token THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, error_code, message, data)
  VALUES (r.input_data_id, r.campaign_id, r.id, 'wait', p_error_code, public.aka_agent_engine_wait_note(p_error_code, p_until),
          jsonb_build_object('seconds', p_seconds, 'until', p_until));
  RETURN jsonb_build_object('ok', true, 'recorded', true);
END $f$;

-- Tổ chức chạy bộ mới trên Fly: chỉ theo cờ org_organization.use_new_zalo_runtime (V371). Không có công tắc nào khác.
CREATE FUNCTION public.aka_agent_engine_enabled_orgs_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT jsonb_build_object('organizationIds',
    (SELECT coalesce(jsonb_agg(o.id::text ORDER BY o.id), '[]'::jsonb) FROM public.org_organization o WHERE o.use_new_zalo_runtime IS TRUE))
$f$;

-- Vị trí nội dung xoay vòng của bước gửi: đúng quy tắc aka_agent_take_campaign_content_index (v350),
-- xác thực bằng lease của engine thay cho claim token cũ.
CREATE FUNCTION public.aka_agent_engine_take_content_index_v1(p_target_run_id bigint, p_lease_token uuid, p_action_code text, p_variant_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  r public.auto_engine_target_runs%ROWTYPE;
  v_input public.auto_campaign_input_data%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_raw text;
  v_index integer;
  v_first boolean;
BEGIN
  IF p_action_code IS NULL OR btrim(p_action_code) = '' OR length(p_action_code) > 128 OR coalesce(p_variant_count, 0) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND OR r.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_closed'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token OR NOT EXISTS (
       SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  IF p_variant_count = 1 THEN RETURN jsonb_build_object('ok', true, 'index', 0); END IF;
  SELECT * INTO v_input FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
  SELECT * INTO v_campaign FROM public.auto_campaigns WHERE id = r.campaign_id FOR UPDATE;
  -- Data đã lấy nội dung cho thao tác này thì đi tiếp từ vị trí của data; lần đầu lấy theo chiến dịch.
  v_first := NOT (coalesce(v_input.content_rotation_indexes, '{}'::jsonb) ? p_action_code);
  IF v_first THEN
    v_raw := v_campaign.content_rotation_indexes->>p_action_code;
    IF v_raw IS NULL AND v_campaign.action_id IN ('facebook_timeline_post','facebook_page_post')
       AND p_action_code IN ('fb_post_my_profile','fb_post_page') THEN
      v_raw := v_campaign.extra_settings->>'contentRotationIndex';
    END IF;
  ELSE
    v_raw := v_input.content_rotation_indexes->>p_action_code;
  END IF;
  v_index := CASE WHEN v_raw ~ '^[0-9]{1,16}$' THEN mod(v_raw::numeric, p_variant_count)::integer ELSE 0 END;
  IF v_first THEN
    UPDATE public.auto_campaigns SET content_rotation_indexes = jsonb_set(coalesce(content_rotation_indexes, '{}'::jsonb),
      ARRAY[p_action_code], to_jsonb((v_index + 1) % p_variant_count), true) WHERE id = r.campaign_id;
  END IF;
  UPDATE public.auto_campaign_input_data SET content_rotation_indexes = jsonb_set(coalesce(content_rotation_indexes, '{}'::jsonb),
    ARRAY[p_action_code], to_jsonb((v_index + 1) % p_variant_count), true) WHERE id = r.input_data_id;
  RETURN jsonb_build_object('ok', true, 'index', v_index);
END $f$;

-- Hết data (lúc còn giữ lease): hoàn thành chiến dịch, hoặc hẹn lại khi còn data đến lịch sau.
-- Như completeOrReschedule + aka_agent_finalize_zalo_server_campaign của Fly cho chiến dịch không có
-- khung giờ/nguồn data động (runtime chỉ gọi cho loại chiến dịch đó).
CREATE FUNCTION public.aka_agent_engine_finish_campaign_v1(p_account_id bigint, p_lease_token uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  l public.auto_engine_leases%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  v_next timestamptz;
BEGIN
  SELECT * INTO l FROM public.auto_engine_leases
   WHERE account_id = p_account_id AND lease_token = p_lease_token AND expires_at > v_now FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = l.campaign_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'campaign_deleted'); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_control_won', 'campaignStatus', c.status);
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.campaign_id = c.id AND tr.completed_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                 WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false
                   AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND (d.schedule IS NULL OR d.schedule <= v_now)))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
   WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
  IF v_next IS NOT NULL THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = 'Hẹn chạy tiếp khi data đến lịch.', updated_at = v_now
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled', 'schedule', v_next);
  END IF;
  UPDATE public.auto_campaigns SET status = 'hoàn thành', note = p_note, updated_at = v_now WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'reason', 'completed');
END $f$;

-- Mô phỏng không cần lượt chạy: phân loại + gộp chính sách cho một kết quả giả định.
CREATE FUNCTION public.aka_agent_engine_simulate_v1(p_campaign_action_id text, p_runtime_target text, p_outcome jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_action text := p_outcome->>'actionCode';
  v_phase text := coalesce(nullif(p_outcome->>'phase', ''), 'after_send');
  v_platform text;
  v_rule_id bigint;
  v_matched_by text;
  v_catch_all boolean;
  v_status_id bigint;
  v_error_code text;
BEGIN
  SELECT aa.flatform_type INTO v_platform FROM public.auto_account_actions aa WHERE aa.code = v_action;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown'); END IF;
  IF coalesce((p_outcome->>'ok')::boolean, false) THEN
    SELECT s.id INTO v_status_id FROM public.auto_status s WHERE s.code = coalesce(nullif(p_outcome->>'statusCode', ''), 'campaign_detail_success');
  ELSE
    SELECT cs.error_code, cs.rule_id, cs.matched_by, cs.is_catch_all INTO v_error_code, v_rule_id, v_matched_by, v_catch_all
      FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, coalesce(p_outcome->'signal', '{}'::jsonb)) cs;
    v_error_code := coalesce(v_error_code, 'err_undefined');
  END IF;
  RETURN jsonb_build_object('ok', true, 'errorCode', v_error_code, 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
    'isCatchAll', v_catch_all,
    'publicCode', (SELECT e.public_code FROM public.auto_error e WHERE e.error_code = v_error_code),
    'policy', public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, p_campaign_action_id, p_runtime_target, v_phase));
END $f$;

-- ============================================================================================
-- 5. View: danh mục mã công khai (trang tra cứu trên web) và lint chính sách
-- ============================================================================================
CREATE VIEW public.aka_agent_public_error_catalog AS
SELECT e.public_code, e.error_class,
       min(coalesce(e.customer_title, e.error_name)) AS title,
       min(e.customer_help) AS help,
       array_agg(DISTINCT e.error_code ORDER BY e.error_code) AS error_codes,
       array_agg(DISTINCT z.code ORDER BY z.code) FILTER (WHERE z.code IS NOT NULL) AS action_codes
  FROM public.auto_error e
  LEFT JOIN LATERAL unnest(e.zalo_action_codes) z(code) ON true
 WHERE e.public_code IS NOT NULL AND e.is_active AND NOT e.is_delete
 GROUP BY e.public_code, e.error_class;

CREATE VIEW public.aka_agent_engine_policy_lint AS
SELECT 'missing_catch_all'::text AS issue, p.platform || ' / ' || ph.phase AS subject
  FROM (VALUES ('zalo'), ('facebook'), ('email')) p(platform)
  CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(phase)
 WHERE NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules r
                    WHERE r.is_active AND r.signal_kind = 'engine' AND r.pattern = '*'
                      AND r.platform IN (p.platform, 'system') AND (r.phase IS NULL OR r.phase = ph.phase) AND r.action_code IS NULL)
UNION ALL
SELECT 'error_without_class', e.error_code FROM public.auto_error e WHERE e.is_active AND NOT e.is_delete AND e.error_class IS NULL
UNION ALL
SELECT 'policy_on_inactive_error', p.id::text FROM public.auto_outcome_policies p JOIN public.auto_error e ON e.error_code = p.error_code
 WHERE p.is_active AND NOT p.is_delete AND (NOT e.is_active OR e.is_delete)
UNION ALL
SELECT 'rule_on_inactive_error', r.id::text FROM public.auto_outcome_signal_rules r JOIN public.auto_error e ON e.error_code = r.error_code
 WHERE r.is_active AND (NOT e.is_active OR e.is_delete);

-- ============================================================================================
-- 6. Seed (dựng từ dữ liệu live lúc apply; giữ đúng hành vi hiện tại)
-- ============================================================================================
INSERT INTO public.auto_system_settings (key, value, description) VALUES
  ('engine.lease_seconds', '180', 'V495: hạn giữ chỗ tài khoản của engine v2 (giây); runner heartbeat mỗi 60 giây.'),
  ('engine.stale_target_minutes', '10', 'V495: lease hết hạn bao nhiêu phút thì đóng data dở.'),
  ('engine.stale_unsent_target_action', 'complete', 'V495: data dở CHƯA có dấu "sắp gửi": complete (đóng) hoặc requeue (trả về hàng đợi).'),
  ('engine.timeline_min_wait_seconds', '30', 'V495: chỉ ghi sự kiện chờ vào dòng thời gian khi dài hơn mức này (giây).'),
  ('engine.bad_target_guard_error_code', 'err_undefined', 'V495: mã có ngưỡng chung cho chuỗi data lỗi liên tiếp khi mã lỗi không tự có ngưỡng/hiệu ứng (giống guard err_undefined hiện nay).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.auto_engine_gates (code, on_error, retry_after_seconds, description) VALUES
  ('action_lock', 'closed', 60, 'Khoá thao tác của tài khoản (auto_account_action_status).'),
  ('quota', 'closed', 60, 'Hạn mức ngày / cửa sổ hiện có.'),
  ('target_memory', 'open', 0, 'Mục tiêu đã nhớ là hỏng cố định.'),
  ('opt_out', 'open', 0, 'Danh sách từ chối nhận tin (giữ như hiện nay: lỗi kiểm thì vẫn gửi).'),
  ('send_exclusion', 'open', 0, 'Danh sách loại trừ gửi (giữ như hiện nay).'),
  ('delivery_cooldown', 'closed', 60, 'Chống gửi lặp (giữ như hiện nay: lỗi kiểm thì chờ rồi thử lại).');

-- 6.1 Lớp thao tác
UPDATE public.auto_account_actions SET operation_class = CASE
    WHEN code = 'zalo_find_phone_user' THEN 'read'
    WHEN code IN ('zalo_tag_contact', 'zalo_change_alias', 'zalo_cancel_sent_friend_request',
                  'zalo_join_group', 'zalo_join_group_link', 'fb_join_group') THEN 'idempotent'
    ELSE 'delivery' END
 WHERE operation_class IS NULL;

-- 6.2 Thuộc tính trạng thái kết quả (theo code; status chưa biết giữ NULL)
UPDATE public.auto_status s SET
  report_group = coalesce(s.report_group, v.report_group),
  counts_as_delivered = coalesce(s.counts_as_delivered, v.delivered),
  progress_rank = coalesce(s.progress_rank, v.rank)
FROM (VALUES
  ('campaign_detail_success', 'success', true, 10),
  ('campaign_detail_sent', 'success', true, 10),
  ('campaign_detail_message_sent', 'success', true, 10),
  ('campaign_detail_invitation_sent', 'skipped', false, NULL),
  ('campaign_detail_friend_request_sent', 'success', true, 10),
  ('campaign_detail_received', 'success', true, 20),
  ('campaign_detail_viewed', 'success', true, 30),
  ('campaign_detail_clicked', 'success', true, 40),
  ('campaign_detail_alias_changed', 'success', false, NULL),
  ('campaign_detail_tag_applied', 'success', false, NULL),
  ('campaign_detail_post_approved', 'success', true, 20),
  ('campaign_detail_failed', 'failure', false, NULL),
  ('campaign_detail_error', 'failure', false, NULL),
  ('campaign_detail_not_found', 'failure', false, NULL),
  ('campaign_detail_tag_not_found', 'failure', false, NULL),
  ('campaign_detail_invalid_parameter', 'failure', false, NULL),
  ('campaign_detail_already_friend', 'skipped', false, NULL),
  ('campaign_detail_already_member', 'skipped', false, NULL),
  ('campaign_detail_joined', 'skipped', false, NULL),
  ('campaign_detail_skipped', 'skipped', false, NULL),
  ('campaign_detail_post_pending', 'pending', true, 15),
  ('campaign_detail_calling', 'pending', false, NULL)
) v(code, report_group, delivered, rank)
WHERE s.code = v.code AND s.component_type = 'campaign_detail';
-- Ưu tiên report_group đã khai trong chính sách trạng thái mặc định (action_code NULL) nếu có.
UPDATE public.auto_status s SET report_group = p.report_group
  FROM public.auto_account_action_status_policies p
 WHERE p.status_id = s.id AND p.action_code IS NULL AND p.is_active AND NOT p.is_delete AND p.report_group IS NOT NULL;

-- 6.3 Mã công khai + nhóm cho các mã hiện có (mã chưa có trong danh sách giữ NULL; lint sẽ báo)
UPDATE public.auto_error e SET public_code = v.public_code, error_class = v.error_class
FROM (VALUES
  ('err_logout','AUTH01','auth'), ('err_zalo_session_invalid','Z600','auth'),
  ('error_limit_in_day','LIM01','quota'), ('error_limit_in_hour','LIM02','quota'),
  ('err_email_recipient_not_found','EM01','target_permanent'), ('err_email_daily_limit','EM02','quota'),
  ('err_email_web_login_required','EM03','auth'), ('err_email_bad_credentials','EM04','auth'),
  ('err_email_login_throttled','EM05','account_restricted'), ('err_email_server_busy','EM06','transient'),
  ('err_email_connection','EM07','transient'), ('err_email_smtp_not_configured','EM08','content_config'),
  ('err_email_missing_recipient','EM09','target_permanent'), ('err_email_message_too_large','EM10','content_config'),
  ('err_email_content_blocked','EM11','content_config'), ('err_email_send_failed','EM12','target_temporary'),
  ('err_email_system_temporary','EM13','transient'),
  ('err_limit_waiting_message','FB01','quota'), ('err_group_post_frequency_limit','FB02','account_restricted'),
  ('err_comment_frequency_limit','FB03','account_restricted'), ('err_fb_checkpoint','FB04','auth'),
  ('err_fb_feature_blocked','FB05','account_restricted'), ('err_fb_identity_switch_failed','FB06','ui_changed'),
  ('err_fb_identity_restore_failed','FB07','ui_changed'), ('err_fb_page_permission_token_missing','FB08','content_config'),
  ('err_fb_page_permission_no_page_token','FB09','content_config'), ('err_fb_page_permission_api_error','FB10','transient'),
  ('err_fb_group_cannot_post_not_member','FB11','target_permanent'), ('err_fb_group_cannot_post_join_pending','FB12','target_temporary'),
  ('err_fb_group_cannot_post_admin_only','FB13','target_permanent'), ('err_fb_group_cannot_post_unavailable','FB14','target_permanent'),
  ('err_fb_comment_unavailable_post_pending','FB15','target_temporary'), ('err_fb_comment_unavailable_comment_disabled','FB16','target_permanent'),
  ('err_fb_comment_unavailable_post_not_found','FB17','target_permanent'), ('err_fb_comment_unavailable_not_member','FB18','target_permanent'),
  ('err_fb_messenger_unavailable_target_not_messageable','FB19','target_permanent'),
  ('err_fb_messenger_unavailable_e2ee_pin_required','FB20','content_config'),
  ('err_fb_messenger_unavailable_account_restricted','FB21','account_restricted'), ('err_fb_add_friend_unavailable','FB22','target_permanent'),
  ('err_fb_page_inbox_customer_not_found','FB23','target_permanent'), ('err_fb_page_inbox_wrong_conversation','FB24','ui_changed'),
  ('err_fb_page_inbox_cannot_reply_outside_window','FB25','target_permanent'),
  ('err_fb_page_inbox_cannot_reply_blocked_by_user','FB26','target_permanent'), ('err_fb_join_group_failed_limit','FB27','quota'),
  ('err_fb_join_group_failed_questions_required','FB28','target_permanent'), ('err_fb_join_group_failed_ui','FB29','ui_changed'),
  ('err_fb_post_not_confirmed','FB30','unknown_delivery'), ('err_fb_post_not_published_content_blocked','FB31','content_config'),
  ('err_fb_post_not_published_duplicate','FB32','content_config'), ('err_fb_formatted_content_rejected','FB33','content_config'),
  ('err_fb_media_upload_timeout','FB34','transient'), ('err_fb_composer_editor_not_found','FB35','ui_changed'),
  ('err_fb_post_button_not_found','FB36','ui_changed'), ('err_fb_page_inbox_ui','FB37','ui_changed'),
  ('err_fb_upload_form_changed','FB38','ui_changed'), ('err_fb_group_invite_ui','FB39','ui_changed'),
  ('err_fb_group_composer_editor_not_found','FB40','target_permanent'), ('err_fb_comment_box_not_found','FB41','ui_changed'),
  ('err_zalo_user_not_found','Z216','target_permanent'), ('err_zalo_invalid_param','Z114','target_permanent'),
  ('err_zalo_find_phone_limit','Z221','quota'), ('err_zalo_receiver_blocks_stranger_message','Z122','target_permanent'),
  ('err_zalo_receiver_blocks_message','Z119','target_permanent'), ('err_zalo_message_too_long','Z118','content_config'),
  ('err_zalo_add_friend_failed','Z311','target_permanent'), ('err_zalo_group_invite_stranger_limit','Z314','account_restricted'),
  ('err_zalo_api_business_failed','Z999','target_permanent'), ('err_zalo_friend_request_sent','Z222','already_done'),
  ('err_zalo_already_friend','Z225','already_done'), ('err_zalo_group_member_already_exists','Z178','already_done'),
  ('err_zalo_find_phone_day_limit','Z313','quota'), ('err_zalo_add_friend_limit','Z221','quota'),
  ('err_zalo_120_message_stranger','Z120','account_restricted'), ('err_zalo_120_add_group_member','Z120','account_restricted'),
  ('err_zalo_802_message_stranger','Z802','account_restricted'), ('err_zalo_802_add_group_member','Z802','account_restricted'),
  ('err_zalo_123_message_friend','Z123','account_restricted'), ('err_zalo_123_message_stranger','Z123','account_restricted'),
  ('err_zalo_123_message_group','Z123','account_restricted'), ('err_zalo_126_127_message_personal','Z126','account_restricted'),
  ('err_zalo_126_127_message_group','Z126','account_restricted'), ('err_zalo_126_add_group_member','Z126','account_restricted'),
  ('err_zalo_221_message_group','Z221','quota'), ('err_zalo_223_add_friend_pause','Z223','account_restricted'),
  ('err_zalo_224_add_friend_full','Z224','account_restricted'), ('err_zalo_215_251_add_friend_rejected','Z215','target_permanent'),
  ('err_zalo_219_find_phone_invalid','Z219','target_permanent'), ('err_zalo_227_join_group_link_invalid','Z227','target_permanent'),
  ('err_zalo_210_target_unavailable','Z210','target_permanent'), ('err_zalo_264_269_add_group_member_pause','Z264','account_restricted'),
  ('err_zalo_127_message_friend','Z127','account_restricted'), ('err_zalo_127_message_stranger','Z127','account_restricted'),
  ('err_zalo_221_message_friend','Z221','quota'), ('err_zalo_112_message_group','Z112','target_permanent'),
  ('err_zalo_161_group_not_found','Z161','target_permanent'),
  ('err_undefined','SYS99','internal'), ('err_media_file_missing','CFG01','content_config'),
  ('err_input_invalid','DAT01','target_permanent'), ('err_campaign_config_invalid','CFG02','content_config'),
  ('err_system_block_load','SYS03','transient'), ('err_network_offline','NET01','transient'),
  ('err_proxy_failed','NET02','transient'), ('err_ai_service_unavailable','SYS06','transient'),
  ('err_device_sleep','SYS05','transient'), ('err_runtime_browser','SYS04','transient'),
  ('err_server_unreachable','DB01','transient')
) v(error_code, public_code, error_class)
WHERE e.error_code = v.error_code;
-- Tên ngắn cho khách (trang tra cứu mã, câu chờ): error_name, không có ký hiệu [x]/[t].
-- Câu tiến trình vẫn là noti_running_process (log_template của chính sách), giữ nguyên chữ hiện tại.
UPDATE public.auto_error SET customer_title = error_name
 WHERE customer_title IS NULL AND public_code IS NOT NULL;

-- 6.4 Mã của engine v2 (error_type='engine v2' để bộ kiểm của bản cũ bỏ qua; cột cũ ghi tường minh)
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
  ('engine v2','err_engine_interrupted_before_send','Bị ngắt trước khi gửi','Engine v2: lượt chạy bị ngắt (app tắt, mất mạng, máy chủ lỗi) khi data chưa tới bước gửi.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'SYS01','transient','Bị ngắt trước khi gửi','Không có tin nào được gửi cho data này. Có thể chạy lại data nếu cần.'),
  ('engine v2','err_engine_interrupted_while_sending','Bị ngắt khi đang gửi','Engine v2: lượt chạy bị ngắt sau khi đã tới bước gửi; không rõ người nhận đã nhận chưa.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'SYS02','unknown_delivery','Bị ngắt khi đang gửi, không rõ kết quả; không gửi lại để tránh trùng','Kiểm tra trong hội thoại với người nhận trước khi tự gửi lại.'),
  ('engine v2','err_engine_unknown_delivery','Không xác nhận được kết quả gửi','Engine v2: đã gửi đi nhưng không nhận được phản hồi rõ ràng.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'UNK01','unknown_delivery','Không xác nhận được tin đã tới; không gửi lại để tránh trùng','Kiểm tra trong hội thoại với người nhận trước khi tự gửi lại.'),
  ('engine v2','err_engine_runtime_unavailable','Máy gửi chưa sẵn sàng','Engine v2: runtime/kết nối tới nền tảng chưa sẵn sàng trước khi gửi; data quay lại hàng đợi.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'NET03','transient','Kết nối tới Zalo chưa sẵn sàng, sẽ tự chạy lại','Hệ thống tự thử lại; không cần thao tác.'),
  ('engine v2','err_engine_no_outcome','Không có kết quả','Engine v2: workflow kết thúc mà không báo kết quả nào (lỗi cấu hình workflow/block).',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'SYS07','internal','Lượt chạy không ghi nhận được kết quả','Báo bộ phận hỗ trợ kèm mã này.'),
  ('engine v2','err_engine_cancelled','Đã dừng','Engine v2: lượt chạy bị dừng chủ động (khách dừng, đăng xuất, tắt app).',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'RUN01','cancelled','Đã dừng theo yêu cầu','Không cần thao tác.'),
  ('engine v2','err_engine_recipient_opted_out','Người nhận từ chối nhận tin','Engine v2: người nhận đã bấm từ chối nhận tin nhắn Zalo (danh sách opt-out); data tạm dừng, không gửi.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'OPT01','target_permanent','Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo','Người nhận tự bấm từ chối; không gửi lại cho người này.'),
  ('engine v2','err_engine_gate_unavailable','Chưa kiểm tra được điều kiện gửi','Engine v2: cổng kiểm đặt on_error=closed (auto_engine_gates) bị lỗi khi kiểm; chưa gửi gì, data về hàng đợi.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'SYS08','transient','Chưa kiểm tra được điều kiện gửi, sẽ tự chạy lại','Hệ thống tự thử lại; không cần thao tác.'),
  ('engine v2','err_cfg_zalo_web_image_only','Zalo Web chỉ gửi ảnh','Cấu hình: tài khoản Zalo Web chỉ gửi được ảnh JPG, JPEG, PNG, WEBP hoặc GIF.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'CFG10','content_config','Tài khoản Zalo Web chỉ gửi được ảnh JPG, JPEG, PNG, WEBP hoặc GIF','Bỏ tệp không phải ảnh khỏi nội dung, hoặc đổi sang tài khoản đăng nhập QR.'),
  ('engine v2','err_cfg_zalo_too_many_files','Quá số tệp cho một tin','Cấu hình: số tệp vượt giới hạn Zalo cho một tin.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'CFG11','content_config','Số tệp vượt giới hạn Zalo cho một tin','Giảm số tệp trong nội dung.'),
  ('engine v2','err_cfg_zalo_file_extension','Đuôi tệp bị Zalo chặn','Cấu hình: Zalo không cho gửi loại tệp này.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'CFG12','content_config','Zalo không cho gửi loại tệp này','Đổi sang định dạng tệp khác.'),
  ('engine v2','err_cfg_template_missing_column','Thiếu dữ liệu cho biến mẫu','Cấu hình theo data: mẫu nội dung dùng biến mà data này thiếu cột, nên nội dung rỗng.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'CFG13','content_config','Nội dung rỗng vì data thiếu cột dùng trong mẫu','Bổ sung cột cho data hoặc sửa mẫu nội dung.'),
  ('engine v2','err_cfg_fb_api_post_image_only','Đăng fanpage bằng API chỉ hỗ trợ ảnh','Cấu hình: chế độ đăng fanpage qua API chỉ hỗ trợ ảnh.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'CFG14','content_config','Đăng fanpage bằng API chỉ hỗ trợ ảnh','Chuyển sang chế độ đăng qua giao diện để dùng video.'),
  ('engine v2','err_cfg_fb_media_type','Loại media Facebook không hỗ trợ','Cấu hình: media Facebook / comment chỉ hỗ trợ ảnh hoặc video.',
   NULL,NULL,'{}',false,false,'fixed_minutes','{}','{}',true,false,'CFG15','content_config','Media Facebook chỉ hỗ trợ ảnh hoặc video','Bỏ tệp không phải ảnh/video.');

-- 6.5 Luật phân loại: dựng 1:1 từ zalo_error_codes × zalo_action_codes đang có (hành vi hiện tại).
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note)
SELECT 'zalo', act.code, NULL, 'zalo_code', z.code, CASE WHEN act.code IS NULL THEN 20 ELSE 10 END, e.error_code, 'seed_v495',
       'Dựng từ auto_error.zalo_error_codes (V495)'
  FROM public.auto_error e
  CROSS JOIN LATERAL unnest(e.zalo_error_codes) z(code)
  CROSS JOIN LATERAL (SELECT unnest(CASE WHEN cardinality(e.zalo_action_codes) = 0 THEN ARRAY[NULL]::text[] ELSE e.zalo_action_codes END) AS code) act
 WHERE e.is_active AND NOT e.is_delete AND btrim(z.code) <> ''
   AND (act.code IS NULL OR EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = act.code))
 ORDER BY e.id, act.code NULLS FIRST, z.code
ON CONFLICT DO NOTHING;

-- Luật bắt-tất-cả theo nền tảng (đúng fallback hiện tại).
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', NULL, NULL, 'engine', '*', 1000, 'err_zalo_api_business_failed', 'seed_v495', 'Fallback hiện tại cho mọi lỗi Zalo chưa có luật (campaignScheduler.ts:14340).'),
  ('facebook', NULL, NULL, 'engine', '*', 1000, 'err_undefined', 'seed_v495', 'Fallback hiện tại của Facebook (normalizeRuntimeError).'),
  ('email', NULL, NULL, 'engine', '*', 1000, 'err_email_send_failed', 'seed_v495', 'Hiện tại lỗi gửi email ghi thất bại, tính hạn mức và chuỗi lỗi.'),
  ('system', NULL, NULL, 'engine', '*', 2000, 'err_undefined', 'seed_v495', 'Fallback cuối cùng.'),
  ('system', NULL, NULL, 'exception', '*', 900, 'err_undefined', 'seed_v495', 'Ngoại lệ trong code của mình (ngoài lời gọi nền tảng): như handleCampaignBadTarget(err_undefined).');

-- Tín hiệu do app tự đặt trước khi gọi Zalo (bản rà ZL-T1/T3/S5): giữ đúng mã đang dùng hôm nay.
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', NULL, NULL, 'engine', 'target_missing_identity', 50, 'err_zalo_invalid_param', 'seed_v495', 'Thiếu hoặc sai định dạng SĐT/UID/ID nhóm/link: hôm nay app tự đặt mã 114 (ZL-T1).'),
  ('zalo', NULL, NULL, 'engine', 'forward_to_self', 50, 'err_zalo_invalid_param', 'seed_v495', 'Chia sẻ tới chính tài khoản gửi: hôm nay app tự đặt mã 114 (ZL-S5).'),
  ('zalo', NULL, NULL, 'engine', 'find_user_without_uid', 50, 'err_zalo_user_not_found', 'seed_v495', 'Tìm thấy nhưng không có UID: hôm nay app tự đặt mã 216 (ZL-T3).'),
  ('zalo', NULL, NULL, 'engine', 'empty_content', 50, 'err_zalo_api_business_failed', 'seed_v495', 'Nội dung và media đều rỗng: Desktop gửi, zca-js từ chối "Missing message content" (lỗi không mã → err_zalo_api_business_failed).'),
  ('zalo', NULL, NULL, 'engine', 'recipient_opted_out', 50, 'err_engine_recipient_opted_out', 'seed_v495', 'Cổng từ chối nhận tin chặn: data tạm dừng, không ghi lịch sử (như hiện nay).'),
  ('system', NULL, NULL, 'engine', 'db_unavailable', 50, 'err_engine_runtime_unavailable', 'seed_v495', 'DB của mình lỗi trước bước gửi (lấy nội dung xoay vòng…): chưa gửi gì, trả về hàng đợi.'),
  ('system', NULL, NULL, 'engine', 'gate_unavailable', 50, 'err_engine_gate_unavailable', 'seed_v495', 'Cổng kiểm đặt on_error=closed bị lỗi: chưa gửi gì, chờ rồi thử lại.');

-- Mã lệnh Fly (chat-sync) theo cách chat-sync đang xử lý (B71–B77 trong bản rà).
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', NULL, NULL, 'fly_command', 'command_result_unknown', 50, 'err_engine_unknown_delivery', 'seed_v495', 'Lệnh đã gửi, không rõ kết quả: không gửi lại.'),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_runtime_unavailable', 50, 'err_engine_runtime_unavailable', 'seed_v495', 'Runtime chưa sẵn sàng: trả data về hàng đợi.'),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_runtime_unavailable_before_dispatch', 50, 'err_engine_runtime_unavailable', 'seed_v495', NULL),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_runtime_binding_changed', 50, 'err_engine_runtime_unavailable', 'seed_v495', NULL),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_command_cancelled', 50, 'err_engine_cancelled', 'seed_v495', NULL),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_command_cancelled_before_dispatch', 50, 'err_engine_cancelled', 'seed_v495', NULL),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_failed_before_dispatch', 50, 'err_engine_runtime_unavailable', 'seed_v495', NULL),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_media_timeout', 50, 'err_engine_unknown_delivery', 'seed_v495', 'Media quá giờ chờ: không rõ đã tới, không gửi lại.'),
  ('zalo', NULL, NULL, 'fly_command', 'command_dispatch_failed', 50, 'err_engine_unknown_delivery', 'seed_v495', 'Có thể đã gửi rồi mới lỗi ghi (B84): không gửi lại.'),
  ('zalo', NULL, NULL, 'fly_command', 'zalo_command_timeout', 50, 'err_engine_runtime_unavailable', 'seed_v495', 'Lệnh đọc quá giờ (B93): chưa gửi gì, chạy lại sau.'),
  ('zalo', NULL, NULL, 'fly_command', 'command_handler_unavailable', 50, 'err_engine_runtime_unavailable', 'seed_v495', 'Runtime chưa có bộ xử lý lệnh: chưa gửi gì.'),
  ('zalo', NULL, NULL, 'fly_command', 'campaign_media_download_failed', 50, 'err_media_file_missing', 'seed_v495', 'Không tải được tệp media trước khi gửi: như Desktop (CFG01).');

-- 6.6 Chính sách theo mã: dựng 1:1 từ cột cũ của auto_error, ghi TƯỜNG MINH mọi trường để không kế thừa
-- mặc định nhóm (giữ đúng hành vi hiện tại).
INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, campaign_note_template,
  quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, remember_target_days,
  campaign_effect, campaign_hold_minutes, account_effect, login_effect, description, source)
SELECT e.error_code,
  -- Câu tiến trình như renderZaloPolicyLog: noti_running_process, không có thì noti_campaign.
  x.detail_mode, x.detail_status_id, coalesce(e.noti_running_process, e.noti_campaign), e.noti_campaign,
  -- Kết quả không ghi lịch sử thì không tính lượt, không đổi chuỗi lỗi (nhánh suppressed của
  -- ActionStatusCatalog.resolve; hạn mức ngày chỉ cộng khi có dòng lịch sử).
  CASE WHEN x.detail_mode = 'write' AND coalesce(e.counts_toward_limit, true) THEN 'count' ELSE 'no_count' END,
  CASE WHEN x.detail_mode = 'write' AND coalesce(e.counts_toward_bad_target, true) THEN 'increment' ELSE 'ignore' END,
  -- Ngưỡng của mã; report_v1 chỉ dùng ngưỡng khi kết quả thật sự tăng chuỗi, còn không thì áp hiệu ứng ngay
  -- (receipt.countsTowardBadTarget ? handleCampaignBadTarget : applyRuntimeErrorPolicy).
  nullif(e.count_consecutive_errors, 0),
  CASE
    WHEN e.input_effect = 'pause' THEN 'hold'
    WHEN e.input_effect = 'requeue' THEN 'requeue'
    WHEN e.input_effect = 'complete' THEN 'complete'
    WHEN x.detail_mode = 'suppress' THEN 'requeue'
    ELSE 'complete' END,
  NULL,
  -- Bản cũ không cắt các bước còn lại của data khi lỗi có hiệu ứng phụ; chỉ dừng sau khi data xong
  -- (stopAfterTarget). Cắt bước còn lại chỉ có ở media quá giờ / không rõ kết quả (mã engine riêng).
  'continue',
  coalesce(e.disable_action_codes, '{}'::text[]),
  coalesce(e.disable_action_mode, 'fixed_minutes'), e.time_disable_actions, e.disable_action_days, e.disable_action_time,
  CASE WHEN x.side_effect THEN 'end_unit' ELSE 'continue' END,
  'full', NULL, 0,
  CASE e.update_status_campaign WHEN 'tạm dừng' THEN 'pause' WHEN 'chờ xử lý' THEN 'hold' ELSE 'none' END, NULL,
  CASE WHEN e.update_status_account = 'tạm dừng' THEN 'pause' ELSE 'none' END,
  CASE e.update_login_status WHEN 'chưa đăng nhập' THEN 'logged_out' WHEN 'checkpoint' THEN 'checkpoint' ELSE 'none' END,
  'Dựng 1:1 từ auto_error id ' || e.id || ' lúc apply V495', 'seed_v495_error'
FROM public.auto_error e
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN e.detail_mode = 'suppress' THEN 'suppress'
         WHEN e.detail_mode = 'override' AND e.detail_status_id IS NOT NULL THEN 'write'
         WHEN e.detail_status IS NULL THEN 'suppress'
         ELSE 'write' END AS detail_mode,
    CASE WHEN e.detail_mode = 'override' AND e.detail_status_id IS NOT NULL THEN e.detail_status_id
         ELSE (SELECT s.id FROM public.auto_status s
                WHERE s.component_type = 'campaign_detail' AND s.status_value = e.detail_status AND s.is_active AND NOT s.is_delete
                ORDER BY s.id LIMIT 1) END AS detail_status_id,
    (e.update_status_campaign IS NOT NULL OR e.update_status_account IS NOT NULL OR e.update_login_status IS NOT NULL
      OR cardinality(coalesce(e.disable_action_codes, '{}'::text[])) > 0) AS side_effect
) x
WHERE e.is_active AND NOT e.is_delete AND e.error_type <> 'engine v2' AND e.error_code <> 'err_undefined';

-- err_undefined là mã của lỗi code/ngoại lệ. Bản cũ không đi qua detail_status: ghi lịch sử "lỗi",
-- không tính lượt, tăng chuỗi data lỗi và chỉ áp update_status_campaign khi đủ count_consecutive_errors
-- (handleCampaignBadTarget); data đang chạy dừng các bước còn lại. Đây cũng là mã canh chuỗi chung.
INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, campaign_note_template,
  quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode,
  run_effect, pace_mode, remember_target_days, campaign_effect, account_effect, login_effect, description, source)
SELECT e.error_code, 'write', (SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_error'),
  e.noti_running_process, e.noti_campaign, 'no_count', 'increment', nullif(e.count_consecutive_errors, 0), 'complete', 'skip',
  coalesce(e.disable_action_codes, '{}'::text[]), coalesce(e.disable_action_mode, 'fixed_minutes'), 'continue', 'full', 0,
  CASE e.update_status_campaign WHEN 'tạm dừng' THEN 'pause' WHEN 'chờ xử lý' THEN 'hold' ELSE 'none' END,
  CASE WHEN e.update_status_account = 'tạm dừng' THEN 'pause' ELSE 'none' END,
  CASE e.update_login_status WHEN 'chưa đăng nhập' THEN 'logged_out' WHEN 'checkpoint' THEN 'checkpoint' ELSE 'none' END,
  'Lỗi code/ngoại lệ: dựng theo handleCampaignBadTarget (auto_error id ' || e.id || ')', 'seed_v495_error'
FROM public.auto_error e WHERE e.error_code = 'err_undefined' AND e.is_active AND NOT e.is_delete;

-- Chính sách của mã engine v2 (cấu trúc mới, không có hành vi cũ tương ứng).
INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, quota_effect, target_streak_effect, target_effect,
  remaining_steps, lock_action_codes, run_effect, pace_mode, remember_target_days, campaign_effect, account_effect, login_effect, description, source)
SELECT v.error_code, v.detail_mode, (SELECT s.id FROM public.auto_status s WHERE s.code = v.status_code),
       -- Lỗi cấu hình: câu cụ thể do luật kiểm sinh ra (tên tệp, cột thiếu) nằm trong signal.message.
       CASE WHEN v.error_code LIKE 'err_cfg_%' THEN '{message}' END,
       v.quota, v.streak, v.target,
       v.remaining, '{}'::text[], v.run, v.pace, 0, v.campaign, 'none', 'none', v.description, 'seed_v495_engine'
FROM (VALUES
  ('err_engine_unknown_delivery','write','campaign_detail_failed','count_if_committed','ignore','complete','skip','continue','full','none','Không rõ kết quả: hoàn thành, không gửi lại.'),
  ('err_engine_runtime_unavailable','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','end_unit','none','none','Runtime chưa sẵn sàng: trả về hàng đợi, dừng lượt.'),
  ('err_engine_no_outcome','write','campaign_detail_error','no_count','increment','complete','skip','continue','full','none','Workflow không báo kết quả.'),
  ('err_engine_cancelled','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','end_unit','none','none','Bị dừng chủ động: không tính là lỗi.'),
  ('err_engine_recipient_opted_out','suppress','campaign_detail_skipped','no_count','ignore','hold','skip','continue','none','none','Từ chối nhận tin: data tạm dừng, không ghi lịch sử, không nghỉ (như hiện nay).'),
  ('err_engine_gate_unavailable','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','end_unit','none','none','Cổng đóng khi lỗi: chưa gửi gì, data về hàng đợi, dừng lượt.'),
  ('err_cfg_zalo_web_image_only','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','stop_campaign','none','pause','Cấu hình sai: tạm dừng chiến dịch một lần.'),
  ('err_cfg_zalo_too_many_files','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','stop_campaign','none','pause','Cấu hình sai: tạm dừng chiến dịch một lần.'),
  ('err_cfg_zalo_file_extension','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','stop_campaign','none','pause','Cấu hình sai: tạm dừng chiến dịch một lần.'),
  ('err_cfg_template_missing_column','write','campaign_detail_failed','no_count','ignore','complete','skip','continue','none','none','Thiếu dữ liệu cho mẫu: báo theo data.'),
  ('err_cfg_fb_api_post_image_only','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','stop_campaign','none','pause','Cấu hình sai: tạm dừng chiến dịch một lần.'),
  ('err_cfg_fb_media_type','suppress','campaign_detail_failed','no_count','ignore','requeue','skip','stop_campaign','none','pause','Cấu hình sai: tạm dừng chiến dịch một lần.')
) v(error_code, detail_mode, status_code, quota, streak, target, remaining, run, pace, campaign, description);

-- Tra số là thao tác chỉ đọc: lệnh tra không rõ kết quả thì chưa gửi gì cho người nhận. Như Fly bản cũ
-- (CampaignRuntimeUnavailable): data về hàng đợi, dừng lượt, không ghi lịch sử, không tính lượt.
INSERT INTO public.auto_outcome_policies (error_code, action_code, detail_mode, quota_effect, target_streak_effect, target_effect,
  remaining_steps, run_effect, pace_mode, description, source)
VALUES ('err_engine_unknown_delivery', 'zalo_find_phone_user', 'suppress', 'no_count', 'ignore', 'requeue', 'skip', 'end_unit', 'none',
  'Tra số không rõ kết quả: chưa gửi gì, trả về hàng đợi và dừng lượt (như Fly bản cũ).', 'seed_v495_engine');

-- 6.7 Chính sách theo trạng thái: dựng từ auto_account_action_status_policies.
INSERT INTO public.auto_outcome_policies (status_id, action_code, quota_effect, target_streak_effect, target_effect, description, source)
SELECT p.status_id, p.action_code,
  CASE WHEN p.counts_toward_limit THEN 'count' ELSE 'no_count' END,
  CASE p.bad_target_effect WHEN 'increment' THEN 'increment' WHEN 'reset' THEN 'reset' ELSE 'ignore' END,
  CASE p.input_effect WHEN 'pause' THEN 'hold' WHEN 'requeue' THEN 'requeue' WHEN 'complete' THEN 'complete' ELSE NULL END,
  'Dựng từ auto_account_action_status_policies id ' || p.id || ' lúc apply V495', 'seed_v495_status'
FROM public.auto_account_action_status_policies p
WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NOT NULL;

-- Tra SĐT thành công là bước chỉ đọc: nghỉ giữa 2 lần gửi tính theo bước nhắn tin/kết bạn của data. Như Desktop,
-- data bị cổng từ chối nhận tin chặn sau khi tra số thì không nghỉ (bản cũ "continue" trước bước nghỉ).
-- Sau 6.7: dòng (thành công, Tìm SĐT) dựng từ chính sách trạng thái (nếu có) chỉ được thêm pace_mode.
UPDATE public.auto_outcome_policies p SET pace_mode = 'none'
  FROM public.auto_status s
 WHERE s.code = 'campaign_detail_success' AND s.component_type = 'campaign_detail' AND p.status_id = s.id
   AND p.action_code = 'zalo_find_phone_user' AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL
   AND p.is_active AND NOT p.is_delete;
INSERT INTO public.auto_outcome_policies (status_id, action_code, pace_mode, description, source)
SELECT s.id, 'zalo_find_phone_user', 'none',
  'Tra SĐT thành công không tự gây nghỉ; nghỉ theo bước gửi của data (như Desktop với data bị chặn vì từ chối nhận tin).', 'seed_v495_engine'
  FROM public.auto_status s
 WHERE s.code = 'campaign_detail_success' AND s.component_type = 'campaign_detail'
   AND NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.status_id = s.id AND p.action_code = 'zalo_find_phone_user'
                    AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete);

-- 6.8 Mặc định theo nhóm: chỉ áp cho mã MỚI (mã hiện có đã ghi tường minh mọi trường).
INSERT INTO public.auto_outcome_policies (error_class, detail_mode, quota_effect, target_streak_effect, target_effect, remaining_steps,
  run_effect, pace_mode, remember_target_days, campaign_effect, account_effect, login_effect, lock_action_codes, description, source)
VALUES
  ('target_permanent','write','no_count','ignore','complete','skip','continue','none',30,'none','none','none','{}','Mục tiêu không bao giờ nhận được: hoàn thành, nhớ 30 ngày trong tổ chức.','seed_v495_class'),
  ('target_temporary','write','no_count','ignore','requeue_after','skip','continue','short',0,'none','none','none','{}','Mục tiêu tạm chưa nhận: hẹn chạy lại.','seed_v495_class'),
  ('unknown_delivery','write','count_if_committed','ignore','complete','skip','continue','full',0,'none','none','none','{}','Không rõ kết quả: hoàn thành, không gửi lại.','seed_v495_class'),
  ('already_done','write','no_count','reset','complete','continue','continue','none',0,'none','none','none','{}','Đã làm từ trước: hoàn thành, không tính hạn mức.','seed_v495_class'),
  ('account_restricted','write','no_count','ignore','requeue_after','skip','end_unit','none',0,'none','none','none','{}','Nền tảng hạn chế tài khoản: khoá đúng thao tác (khai lock ở dòng mã), hẹn chạy lại.','seed_v495_class'),
  ('quota','suppress','no_count','ignore','requeue_after','skip','end_unit','none',0,'none','none','none','{}','Chạm hạn mức: chờ tới lúc mở.','seed_v495_class'),
  ('auth','suppress','no_count','ignore','requeue','skip','stop_account','none',0,'none','none','logged_out','{}','Phiên hỏng: dừng tài khoản, đổi trạng thái đăng nhập.','seed_v495_class'),
  ('content_config','suppress','no_count','ignore','requeue','skip','stop_campaign','none',0,'pause','none','none','{}','Cấu hình chiến dịch sai: tạm dừng một lần, không đốt data.','seed_v495_class'),
  ('ui_changed','write','no_count','ignore','requeue_after','skip','end_unit','none',0,'none','none','none','{}','Giao diện nền tảng đổi: không đốt data, thử lại sau.','seed_v495_class'),
  ('transient','suppress','no_count','ignore','requeue','skip','end_unit','none',0,'none','none','none','{}','Hạ tầng tạm thời: chờ, thử lại.','seed_v495_class'),
  ('internal','write','no_count','increment','complete','skip','continue','full',0,'none','none','none','{}','Lỗi code: ghi vết, đếm chuỗi lỗi.','seed_v495_class'),
  ('cancelled','suppress','no_count','ignore','requeue','skip','end_unit','none',0,'none','none','none','{}','Bị dừng chủ động: không tính là lỗi.','seed_v495_class'),
  ('run_control','suppress','no_count','ignore','requeue','skip','end_unit','none',0,'none','none','none','{}','Điều phối chưa cho chạy: ghi lý do, hẹn lại.','seed_v495_class');
UPDATE public.auto_outcome_policies p SET requeue_after_minutes = v.minutes
FROM (VALUES ('target_temporary', 60), ('account_restricted', 30), ('quota', 60), ('ui_changed', 60)) v(error_class, minutes)
WHERE p.error_class = v.error_class AND p.source = 'seed_v495_class';

-- 6.8b Chặn theo thao tác: thao tác phụ (gắn tag, đổi tên) không bao giờ tính lượt hay đổi chuỗi lỗi,
-- dù mã lỗi nói gì (giống guard auxiliaryAction trong actionResultRuntime.ts).
INSERT INTO public.auto_outcome_policies (action_code, quota_effect, target_streak_effect, description, source)
SELECT aa.code, 'no_count', 'ignore', 'Thao tác phụ: không tính lượt, không đổi chuỗi data lỗi (auxiliaryAction hiện nay).', 'seed_v495_action'
  FROM public.auto_account_actions aa WHERE aa.code IN ('zalo_tag_contact', 'zalo_change_alias');

-- 6.9 Luật trạng thái theo sự kiện đang thu sẵn (email mở/click, SMS đã nhận).
INSERT INTO public.auto_status_event_rules (event_kind, action_code, status_id, description)
SELECT v.event_kind, NULL, s.id, v.description
  FROM (VALUES ('email.open', 'campaign_detail_viewed', 'Email đã mở'),
               ('email.click', 'campaign_detail_clicked', 'Email đã click'),
               ('sms.received', 'campaign_detail_received', 'SMS đã nhận')) v(event_kind, status_code, description)
  JOIN public.auto_status s ON s.code = v.status_code AND s.component_type = 'campaign_detail';

-- ============================================================================================
-- 7. Quyền: RLS bật, không policy; anon/authenticated không có quyền; RPC chỉ cho backend
-- ============================================================================================
DO $grants$
DECLARE
  t text;
  f text;
  v_seq text;
  v_has_chat boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api');
  v_has_service boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
  v_has_desktop boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop');
BEGIN
  FOREACH t IN ARRAY ARRAY['auto_outcome_signal_rules','auto_outcome_policies','auto_outcome_policy_history','auto_outcome_unmatched',
    'auto_status_event_rules','auto_engine_gates','auto_engine_leases','auto_engine_target_runs',
    'auto_engine_outcomes','auto_engine_target_events','auto_target_memory'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t); END IF;
    IF v_has_service THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t); END IF;
    -- Quyền mặc định của Supabase cũng cấp sequence mới cho anon/authenticated: thu hồi luôn.
    IF EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = 'id') THEN
      v_seq := pg_get_serial_sequence(format('public.%I', t), 'id');
      IF v_seq IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', v_seq);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', v_seq); END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM authenticated', v_seq); END IF;
        IF v_has_service THEN EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq); END IF;
      END IF;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['aka_agent_public_error_catalog','aka_agent_engine_policy_lint'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t); END IF;
    IF v_has_service THEN EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', t); END IF;
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'aka_agent_engine_%' OR p.proname = 'aka_agent_status_semantics') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF v_has_service THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END IF;
    IF v_has_chat AND f ~ '^aka_agent_engine_(claim_target|mark_sending|report|heartbeat|release|record_wait|target_timeline|apply_status_event|enabled_orgs|take_content_index|finish_campaign)_v1' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO aka_agent_chat_api', f);
    END IF;
    -- Desktop: chỉ các RPC của một lượt chạy; claim và dòng thời gian kiểm phạm vi nhân viên, các RPC khác cần lease của claim đó.
    IF v_has_desktop AND f ~ '^aka_agent_engine_(claim_target|mark_sending|report|heartbeat|release|record_wait|target_timeline|take_content_index|finish_campaign)_v1' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO aka_agent_desktop', f);
    END IF;
  END LOOP;
END $grants$;

-- pg_cron: đóng data dở mỗi phút (chỉ chạm lượt của bộ mới; chưa có lượt nào thì không làm gì).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('aka-agent-engine-close-stale', '* * * * *', 'SELECT public.aka_agent_engine_close_stale_v1(200)');
  END IF;
END $cron$;

-- ============================================================================================
-- 8. Hậu kiểm
-- ============================================================================================
DO $post$
DECLARE v_bad text; v_n integer;
BEGIN
  SELECT string_agg(issue || ':' || subject, ', ') INTO v_bad FROM public.aka_agent_engine_policy_lint WHERE issue = 'missing_catch_all';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V495 postflight: %', v_bad; END IF;
  SELECT count(*) INTO v_n FROM public.auto_error e
   WHERE e.is_active AND NOT e.is_delete AND e.error_type <> 'engine v2'
     AND NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.error_code = e.error_code AND p.source = 'seed_v495_error');
  IF v_n > 0 THEN RAISE EXCEPTION 'V495 postflight: % active auto_error rows without seeded policy', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies p
   WHERE p.source = 'seed_v495_error' AND p.detail_mode = 'write' AND p.detail_status_id IS NULL;
  IF v_n > 0 THEN RAISE EXCEPTION 'V495 postflight: % seeded policies write a detail without a resolvable status', v_n; END IF;
END $post$;

COMMIT;
