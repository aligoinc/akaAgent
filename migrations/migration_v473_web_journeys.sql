-- Candidate V473, production cgjbsmqtfhqvttudyjzq only. NOT APPLIED.
--
-- Quy trình tự động (customer journeys) trên Web: bảng mới + hai RPC cho API WebApp trên Fly.
-- Logic chọn bước nằm ở akaAgentWebApp packages/journey-core (TypeScript); SQL chỉ lưu bản nháp/phiên bản,
-- nhận khách theo con trỏ, giao khách cho bộ máy theo lô, thu kết quả chiến dịch và ghi thay đổi do API tính.
-- Hợp đồng: akaAgentWebApp docs/AUTOMATION_JOURNEYS_ENGINE.md. Kiểm thử cục bộ:
--   AKA_AGENT_REPO=… sh scripts/test-journeys-sql.sh (akaAgentWebApp, Postgres tạm).
--
-- Chỉ thêm đối tượng mới. Không ALTER bảng/index/hàm/quyền có sẵn:
--   * 11 bảng public.auto_journey* (RLS bật, không policy; REVOKE anon/authenticated; service_role ALL);
--   * hai dòng auto_system_settings chỉ chèn khi chưa có: journeys.engine_enabled = {"enabled":true} (công tắc
--     tắt nhanh bộ máy) và web.journeys = {"enabled":false,"organizationIds":[]} (mở theo tổ chức);
--   * public.aka_agent_journey_control(staff, org, action, payload) (15 s) và
--     public.aka_agent_journey_engine(action, payload) (20 s): SECURITY DEFINER, EXECUTE chỉ service_role;
--   * hàm phụ trong schema private (không cấp cho role API nào).
-- Bảng nóng chỉ được đọc theo index sẵn có: thành viên nhóm data (group_id, updated_at DESC, id DESC),
-- kết quả chiến dịch (campaign_id, status, action_code, created_at DESC) theo từng mã hành động,
-- auto_campaign_details(input_data_id), auto_campaign_input_data theo id và khóa chống trùng
-- control_append_idempotency_key = journey:<enrollment>:<step>. Mỗi dòng mục tiêu chèn sau
-- aka_agent_lock_campaign_input_serialization rồi khóa đúng một dòng auto_campaigns FOR UPDATE.
-- Con trỏ nhận khách đi chậm 3 phút so với now() để không bỏ sót dòng của giao dịch đang chạy.
--
-- Chi tiết ngoài hợp đồng (đã chốt trong kiểm thử):
--   * publish khi quy trình đang tạm dừng giữ nguyên 'paused'; quy trình 'stopped' không publish lại được
--     (journey_invalid_transition). Bản đồ step campaign theo (bước, tài khoản, mã hành động, config_hash);
--     publish tắt mọi bản đồ cũ rồi bật đúng tập trong payload; pause/stop/delete trả mọi campaign đã từng gắn,
--     resume chỉ trả campaign đang gắn.
--   * claim.recentSendTimes chỉ đếm step run còn 'dispatched' hoặc đã 'ok' (lần "không có Zalo" không chặn SMS).
--   * apply: kết quả lỗi giữ khóa thuê (hết hạn thì nhận lại) và ghi last_error; dispatch vào chiến dịch không còn
--     hợp lệ (khác tenant, đã xóa, sai tài khoản/hành động) thành kết quả 'failed' của bước thay vì lỗi lặp lại.
--   * xóa quy trình (không đang chạy) cho mọi khách còn trong quy trình ra (journey_deleted).
--   * khách chạy thử (is_test) đọc mark/từ chối nhận tin theo khóa thật, trần tin theo khóa 'test:'.
--
-- Rollback: migrations/rollback_v473_web_journeys.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.auto_journeys') IS NOT NULL
     OR to_regclass('public.auto_journey_versions') IS NOT NULL
     OR to_regclass('public.auto_journey_sources') IS NOT NULL
     OR to_regclass('public.auto_journey_marks') IS NOT NULL
     OR to_regclass('public.auto_journey_step_campaigns') IS NOT NULL
     OR to_regclass('public.auto_journey_enrollments') IS NOT NULL
     OR to_regclass('public.auto_journey_step_runs') IS NOT NULL
     OR to_regclass('public.auto_journey_events') IS NOT NULL
     OR to_regclass('public.auto_journey_step_stats') IS NOT NULL
     OR to_regclass('public.auto_journey_tasks') IS NOT NULL
     OR to_regclass('public.auto_journey_engine_state') IS NOT NULL
     OR to_regprocedure('public.aka_agent_journey_control(bigint,bigint,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_journey_engine(text,jsonb)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname IN ('public', 'private') AND p.proname LIKE 'aka\_agent\_journey\_%') THEN
    RAISE EXCEPTION 'v473_target_already_exists_do_not_overwrite';
  END IF;
  IF to_regclass('public.auto_campaigns') IS NULL
     OR to_regclass('public.auto_campaign_input_data') IS NULL
     OR to_regclass('public.auto_campaign_details') IS NULL
     OR to_regclass('public.auto_accounts') IS NULL
     OR to_regclass('public.auto_account_contact_groups') IS NULL
     OR to_regclass('public.auto_account_contact_group_members') IS NULL
     OR to_regclass('public.auto_account_contacts') IS NULL
     OR to_regclass('public.auto_zalo_message_opt_outs') IS NULL
     OR to_regclass('public.auto_system_settings') IS NULL
     OR to_regclass('public.org_staff') IS NULL
     OR to_regprocedure('public.aka_agent_internal_require_staff_tenant(bigint,bigint)') IS NULL
     OR to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL
     OR to_regprocedure('public.normalize_phone(text)') IS NULL
     OR to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') IS NULL
     OR to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)') IS NULL
     OR to_regprocedure('public.aka_agent_remove_data_group_members(bigint,bigint,text,bigint,bigint[])') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     -- Cursor scans and lookups rely on these existing indexes; stop instead of planning scans of hot tables.
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_auto_account_contact_group_members_active')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_auto_campaign_details_automation_status')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_details_input_data_id')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_auto_campaign_input_data_control_append')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'auto_campaign_input_data' AND column_name = 'control_append_idempotency_key')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'auto_accounts' AND column_name = 'mobile_device_id') THEN
    RAISE EXCEPTION 'v473_dependency_missing';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;

-- Tài khoản gửi sẵn sàng. SMS: máy đã đăng ký điện thoại (login_status của tài khoản SMS luôn 'chưa đăng nhập' trên
-- production, 1.968/1.968 ngày 07/11/2026); kênh khác: đã đăng nhập. Dùng chung cho bộ máy và cảnh báo sức khỏe.
CREATE FUNCTION private.aka_agent_journey_account_ready(p_platform text, p_login_status text, p_device_id text,
  p_is_delete boolean, p_is_active boolean, p_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT p_is_delete IS NOT TRUE AND p_is_active IS NOT FALSE AND p_status IS DISTINCT FROM 'tạm dừng'
    AND CASE WHEN p_platform = 'sms' THEN nullif(btrim(coalesce(p_device_id, '')), '') IS NOT NULL
             ELSE p_login_status = 'đã đăng nhập' END
$function$;

-- Hành động chiến dịch có mục tiêu KHÔNG phải một người (nhóm/trang/bài viết/từ khóa): khách vào quy trình từ kết quả
-- của các chiến dịch này mang targetKind = 'group' và không được gửi tin cá nhân (journey-core NON_PERSON_TARGET_ACTIONS).
CREATE FUNCTION private.aka_agent_journey_non_person_action(p_action_id text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT coalesce(p_action_id, '') = ANY (ARRAY['zalo_message_group', 'zalo_join_group_link', 'facebook_group_post',
    'facebook_join_group', 'facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding',
    'facebook_comment_seeding_post', 'facebook_page_post', 'facebook_timeline_post', 'facebook_newsfeed_interaction'])
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- Tables (new only)
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE public.auto_journeys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'stopped')),
  origin text NOT NULL DEFAULT 'blank' CHECK (origin IN ('blank', 'template', 'ai', 'legacy')),
  template_code text CHECK (template_code IS NULL OR char_length(template_code) <= 100),
  draft_graph jsonb NOT NULL CHECK (jsonb_typeof(draft_graph) = 'object'),
  draft_settings jsonb NOT NULL CHECK (jsonb_typeof(draft_settings) = 'object'),
  draft_revision integer NOT NULL DEFAULT 1,
  draft_updated_at timestamptz NOT NULL DEFAULT now(),
  active_version_id bigint,
  -- Khách mới nhận hôm nay (giờ VN, không tính chạy thử) cho maxNewPerDay; chỉ bộ máy ghi.
  entry_day date,
  entry_day_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  paused_at timestamptz,
  stopped_at timestamptz,
  deleted_at timestamptz,
  is_delete boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_auto_journeys_staff_list ON public.auto_journeys (staff_id, organization_id, updated_at DESC, id DESC)
  WHERE is_delete = false;
CREATE INDEX idx_auto_journeys_active ON public.auto_journeys (id) WHERE status = 'active' AND is_delete = false;

CREATE TABLE public.auto_journey_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  graph jsonb NOT NULL CHECK (jsonb_typeof(graph) = 'object'),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  checksum text NOT NULL,
  published_by_staff_id bigint,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, version_no)
);
ALTER TABLE public.auto_journeys ADD CONSTRAINT auto_journeys_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES public.auto_journey_versions(id) ON DELETE SET NULL;

CREATE TABLE public.auto_journey_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('data_group', 'campaign_result')),
  group_id bigint,
  campaign_id bigint,
  statuses text[] NOT NULL DEFAULT '{}',
  is_entry boolean NOT NULL DEFAULT false,
  is_stop boolean NOT NULL DEFAULT false,
  is_mark boolean NOT NULL DEFAULT false,
  include_existing boolean NOT NULL DEFAULT false,
  entry_since timestamptz,
  cursor_ts timestamptz,
  cursor_id bigint NOT NULL DEFAULT 0,
  seeded_at timestamptz,
  last_scanned_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'data_group' AND group_id IS NOT NULL AND campaign_id IS NULL)
      OR (kind = 'campaign_result' AND campaign_id IS NOT NULL AND group_id IS NULL AND NOT is_stop AND NOT is_mark))
);
CREATE UNIQUE INDEX uq_auto_journey_sources_group ON public.auto_journey_sources (journey_id, group_id) WHERE kind = 'data_group';
CREATE UNIQUE INDEX uq_auto_journey_sources_campaign ON public.auto_journey_sources (journey_id, campaign_id) WHERE kind = 'campaign_result';
CREATE INDEX idx_auto_journey_sources_active ON public.auto_journey_sources (last_scanned_at NULLS FIRST, id) WHERE is_active;

CREATE TABLE public.auto_journey_marks (
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  group_id bigint NOT NULL,
  contact_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_id, group_id, contact_key)
);

CREATE TABLE public.auto_journey_step_campaigns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  step_id text NOT NULL CHECK (char_length(step_id) BETWEEN 1 AND 100),
  account_id bigint NOT NULL,
  action_code text NOT NULL,
  config_hash text NOT NULL DEFAULT '' CHECK (char_length(config_hash) <= 200),
  campaign_id bigint NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, step_id, account_id, action_code, config_hash)
);

CREATE TABLE public.auto_journey_enrollments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  version_id bigint NOT NULL REFERENCES public.auto_journey_versions(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  contact_key text NOT NULL CHECK (char_length(contact_key) BETWEEN 1 AND 600),
  contact jsonb NOT NULL CHECK (jsonb_typeof(contact) = 'object'),
  source_kind text NOT NULL CHECK (source_kind IN ('data_group', 'campaign_result', 'test')),
  source_ref bigint,
  source_group_id bigint,
  source_campaign_id bigint,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exited', 'failed')),
  step_id text CHECK (step_id IS NULL OR char_length(step_id) BETWEEN 1 AND 100),
  phase text NOT NULL DEFAULT 'ready' CHECK (phase IN ('ready', 'waiting', 'awaiting', 'result')),
  pending_outcome text CHECK (pending_outcome IS NULL OR pending_outcome IN ('ok', 'no_zalo', 'rejected', 'failed')),
  pending_reason text,
  next_run_at timestamptz,
  paused_next_run_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  sticky_account_id bigint,
  zalo_uids jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(zalo_uids) = 'object'),
  zalo_status text NOT NULL DEFAULT 'unknown' CHECK (zalo_status IN ('unknown', 'has_zalo', 'no_zalo')),
  attempts integer NOT NULL DEFAULT 0,
  defer_code text CHECK (defer_code IS NULL OR char_length(defer_code) BETWEEN 1 AND 40),
  step_entered_at timestamptz,
  is_test boolean NOT NULL DEFAULT false,
  entered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  exit_code text,
  exit_reason text,
  last_error text,
  last_error_at timestamptz
);
CREATE UNIQUE INDEX uq_auto_journey_enrollments_active_contact ON public.auto_journey_enrollments (journey_id, contact_key)
  WHERE status = 'active';
CREATE INDEX idx_auto_journey_enrollments_due ON public.auto_journey_enrollments (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;
CREATE INDEX idx_auto_journey_enrollments_step ON public.auto_journey_enrollments (journey_id, step_id) WHERE status = 'active';
CREATE INDEX idx_auto_journey_enrollments_contact ON public.auto_journey_enrollments (journey_id, contact_key, entered_at DESC);
CREATE INDEX idx_auto_journey_enrollments_list ON public.auto_journey_enrollments (journey_id, id DESC);
CREATE INDEX idx_auto_journey_enrollments_finished ON public.auto_journey_enrollments (finished_at) WHERE status <> 'active';

CREATE TABLE public.auto_journey_step_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  enrollment_id bigint NOT NULL REFERENCES public.auto_journey_enrollments(id) ON DELETE CASCADE,
  version_id bigint,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  contact_key text NOT NULL,
  step_id text NOT NULL,
  account_id bigint NOT NULL,
  campaign_id bigint NOT NULL,
  action_code text NOT NULL,
  input_data_id bigint NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched', 'settled')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('ok', 'no_zalo', 'rejected', 'failed')),
  reason text,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  next_check_at timestamptz,
  check_count integer NOT NULL DEFAULT 0,
  deadline_at timestamptz NOT NULL,
  settled_at timestamptz,
  UNIQUE (enrollment_id, step_id)
);
CREATE INDEX idx_auto_journey_step_runs_due ON public.auto_journey_step_runs (next_check_at) WHERE status = 'dispatched';
CREATE INDEX idx_auto_journey_step_runs_contact ON public.auto_journey_step_runs (staff_id, contact_key, dispatched_at DESC);
CREATE INDEX idx_auto_journey_step_runs_account ON public.auto_journey_step_runs (account_id, dispatched_at DESC);
CREATE INDEX idx_auto_journey_step_runs_journey ON public.auto_journey_step_runs (journey_id, dispatched_at DESC);

CREATE TABLE public.auto_journey_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  enrollment_id bigint NOT NULL REFERENCES public.auto_journey_enrollments(id) ON DELETE CASCADE,
  step_id text,
  kind text NOT NULL CHECK (kind IN ('enter', 'step', 'wait', 'branch', 'dispatch', 'result', 'defer', 'group', 'task',
    'complete', 'exit', 'error')),
  message text NOT NULL,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_journey_events_enrollment ON public.auto_journey_events (enrollment_id, id);

CREATE TABLE public.auto_journey_step_stats (
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  field text NOT NULL,
  value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_id, step_id, field)
);

CREATE TABLE public.auto_journey_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  enrollment_id bigint NOT NULL REFERENCES public.auto_journey_enrollments(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  step_id text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  done_by_staff_id bigint,
  UNIQUE (enrollment_id, step_id)
);
CREATE INDEX idx_auto_journey_tasks_list ON public.auto_journey_tasks (journey_id, id DESC);
CREATE INDEX idx_auto_journey_tasks_open ON public.auto_journey_tasks (journey_id) WHERE done_at IS NULL;

CREATE TABLE public.auto_journey_engine_state (
  id integer PRIMARY KEY CHECK (id = 1),
  lease_token uuid,
  lease_until timestamptz,
  last_tick_at timestamptz,
  last_run_at timestamptz,
  last_cleanup_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.auto_journey_engine_state (id) VALUES (1);

COMMENT ON TABLE public.auto_journeys IS 'V473 Quy trình tự động: đầu mục, bản nháp và phiên bản đang chạy. Chỉ đọc/ghi qua aka_agent_journey_control.';
COMMENT ON TABLE public.auto_journey_enrollments IS 'V473: mỗi khách trong một quy trình; bộ máy trên API Fly nhận theo next_run_at.';
COMMENT ON TABLE public.auto_journey_step_runs IS 'V473: mỗi lần đưa khách vào chiến dịch (input_data_id duy nhất), kết quả do collect thu.';
COMMENT ON TABLE public.auto_journey_engine_state IS 'V473: một dòng (id = 1), khóa thuê của nhịp bộ máy quy trình.';

-- RLS on, no policy; API roles have no direct access. service_role keeps table access for the backend.
DO $acl$
DECLARE
  v_table text;
  v_role text;
  v_seq text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['auto_journeys', 'auto_journey_versions', 'auto_journey_sources', 'auto_journey_marks',
    'auto_journey_step_campaigns', 'auto_journey_enrollments', 'auto_journey_step_runs', 'auto_journey_events',
    'auto_journey_step_stats', 'auto_journey_tasks', 'auto_journey_engine_state'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', v_table, v_role);
      END IF;
    END LOOP;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
    v_seq := NULL;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = format('public.%I', v_table)::regclass
               AND a.attname = 'id' AND NOT a.attisdropped) THEN
      v_seq := pg_get_serial_sequence(format('public.%I', v_table), 'id');
    END IF;
    IF v_seq IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', v_seq);
      FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
          EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %I', v_seq, v_role);
        END IF;
      END LOOP;
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
    END IF;
  END LOOP;
END
$acl$;

-- Settings: only inserted when the key is absent.
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'journeys.engine_enabled', '{"enabled":true}',
  'Công tắc tắt nhanh bộ máy Quy trình tự động (API WebApp trên Fly). enabled=false: nhịp không nhận khách, không giao khách, không thu kết quả; khách giữ nguyên chỗ, bật lại là chạy tiếp.',
  false, true
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'journeys.engine_enabled');
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'web.journeys', '{"enabled":false,"organizationIds":[]}',
  'Mở trang Quy trình tự động trên Web/iOS. enabled: bật tính năng; organizationIds: null = mọi tổ chức, mảng số = chỉ các tổ chức này.',
  false, true
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.journeys');

-- ---------------------------------------------------------------------------------------------------------
-- Private helpers: parsing and graph walking (pure)
-- ---------------------------------------------------------------------------------------------------------
-- Positive integer from a JSON number or numeric string; anything else is NULL.
CREATE FUNCTION private.aka_agent_journey_bigint(p_value jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT CASE
    WHEN jsonb_typeof(p_value) IN ('number', 'string') AND btrim(p_value #>> '{}') ~ '^[0-9]{1,18}$'
      THEN btrim(p_value #>> '{}')::bigint
    ELSE NULL
  END
$function$;

-- Every step object of a graph (tree of steps/branches[].steps), any depth, document order not guaranteed.
CREATE FUNCTION private.aka_agent_journey_steps(p_graph jsonb)
RETURNS TABLE(step_id text, step_type text, step jsonb)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  WITH RECURSIVE walk(step, depth) AS (
    SELECT s.value, 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_graph -> 'steps') = 'array' THEN p_graph -> 'steps' ELSE '[]'::jsonb END) s
    UNION ALL
    SELECT s.value, w.depth + 1
    FROM walk w
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.step -> 'branches') = 'array' THEN w.step -> 'branches' ELSE '[]'::jsonb END) b
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.value -> 'steps') = 'array' THEN b.value -> 'steps' ELSE '[]'::jsonb END) s
    WHERE w.depth < 64 AND jsonb_typeof(w.step) = 'object'
  )
  SELECT w.step ->> 'id', w.step ->> 'type', w.step
  FROM walk w
  WHERE jsonb_typeof(w.step) = 'object' AND jsonb_typeof(w.step -> 'id') = 'string'
$function$;

-- References used by the graph: accounts (config.accountIds[*], config.accountId), user campaigns
-- (use_campaign config.campaignId), data groups of add/remove steps and of "in_group" conditions.
CREATE FUNCTION private.aka_agent_journey_graph_refs(p_graph jsonb)
RETURNS TABLE(step_id text, kind text, ref_id bigint)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  WITH s AS MATERIALIZED (SELECT * FROM private.aka_agent_journey_steps(p_graph)),
  refs AS (
    SELECT s.step_id, 'account'::text AS kind, private.aka_agent_journey_bigint(a.value) AS ref_id
    FROM s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.step -> 'config' -> 'accountIds') = 'array'
      THEN s.step -> 'config' -> 'accountIds' ELSE '[]'::jsonb END) a
    UNION ALL
    SELECT s.step_id, 'account', private.aka_agent_journey_bigint(s.step -> 'config' -> 'accountId') FROM s
    UNION ALL
    SELECT s.step_id, 'campaign', private.aka_agent_journey_bigint(s.step -> 'config' -> 'campaignId') FROM s
    WHERE s.step_type = 'use_campaign'
    UNION ALL
    SELECT s.step_id, 'group', private.aka_agent_journey_bigint(s.step -> 'config' -> 'groupId') FROM s
    WHERE s.step_type IN ('add_to_group', 'remove_from_group')
    UNION ALL
    SELECT s.step_id, 'condition_group', private.aka_agent_journey_bigint(r.value -> 'value')
    FROM s
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.step -> 'branches') = 'array' THEN s.step -> 'branches' ELSE '[]'::jsonb END) b
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.value -> 'rules') = 'array' THEN b.value -> 'rules' ELSE '[]'::jsonb END) r
    WHERE s.step_type = 'condition' AND r.value ->> 'field' = 'in_group'
  )
  SELECT refs.step_id, refs.kind, refs.ref_id FROM refs WHERE refs.ref_id IS NOT NULL
$function$;

-- Bigint array from a JSON array (non-numeric items dropped).
CREATE FUNCTION private.aka_agent_journey_bigint_array(p_value jsonb) RETURNS bigint[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT coalesce(array_agg(DISTINCT x.id ORDER BY x.id), '{}'::bigint[])
  FROM (SELECT private.aka_agent_journey_bigint(v.value) AS id
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END) v) x
  WHERE x.id IS NOT NULL
$function$;

-- 00:00 today in Asia/Ho_Chi_Minh.
CREATE FUNCTION private.aka_agent_journey_vn_day_start() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog AS $function$
  SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
$function$;

CREATE FUNCTION private.aka_agent_journey_phone(p_value text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $function$
  SELECT nullif(public.aka_agent_internal_normalize_phone(coalesce(p_value, '')), '')
$function$;

CREATE FUNCTION private.aka_agent_journey_email(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT CASE WHEN x.v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(x.v) <= 254 THEN x.v END
  FROM (SELECT lower(btrim(coalesce(p_value, ''))) AS v) x
$function$;

-- Contact key, same order as journey-core contactKeyOf and V468: phone → (account, UID) → email → fallback.
CREATE FUNCTION private.aka_agent_journey_contact_key(p_phone text, p_uid text, p_account_id bigint, p_email text, p_fallback text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT CASE
    WHEN nullif(p_phone, '') IS NOT NULL THEN 'phone:' || p_phone
    WHEN nullif(btrim(coalesce(p_uid, '')), '') IS NOT NULL AND p_account_id IS NOT NULL
      THEN 'zalo:' || p_account_id::text || ':' || lower(btrim(p_uid))
    WHEN nullif(p_email, '') IS NOT NULL THEN 'email:' || p_email
    ELSE p_fallback
  END
$function$;

-- JourneyContact JSON (camelCase, every key present).
CREATE FUNCTION private.aka_agent_journey_contact(p_name text, p_phone text, p_uid text, p_email text,
  p_info1 text, p_info2 text, p_info3 text, p_info4 text, p_info5 text, p_carrier text, p_account_id bigint)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT jsonb_build_object(
    'name', left(nullif(btrim(coalesce(p_name, '')), ''), 500),
    'phone', nullif(p_phone, ''),
    'uid', left(nullif(btrim(coalesce(p_uid, '')), ''), 500),
    'email', nullif(p_email, ''),
    'info1', left(nullif(p_info1, ''), 2000),
    'info2', left(nullif(p_info2, ''), 2000),
    'info3', left(nullif(p_info3, ''), 2000),
    'info4', left(nullif(p_info4, ''), 2000),
    'info5', left(nullif(p_info5, ''), 2000),
    'carrier', left(nullif(btrim(coalesce(p_carrier, '')), ''), 50),
    'accountId', p_account_id)
$function$;

-- Short customer-facing reason (≤ 160 characters).
CREATE FUNCTION private.aka_agent_journey_short(p_value text, p_max integer DEFAULT 160) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT CASE WHEN x.v IS NULL THEN NULL WHEN char_length(x.v) > p_max THEN left(x.v, p_max - 1) || '…' ELSE x.v END
  FROM (SELECT nullif(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), '') AS v) x
$function$;

-- Stat accumulator: {"<journey>\x1f<step>\x1f<field>": n}. Flushed once per call in key order.
CREATE FUNCTION private.aka_agent_journey_stat_add(p_stats jsonb, p_journey_id bigint, p_step_id text, p_field text, p_n bigint DEFAULT 1)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT CASE
    WHEN p_journey_id IS NULL OR nullif(p_step_id, '') IS NULL OR nullif(p_field, '') IS NULL OR coalesce(p_n, 0) = 0
      THEN coalesce(p_stats, '{}'::jsonb)
    ELSE coalesce(p_stats, '{}'::jsonb) || jsonb_build_object(x.k, coalesce((p_stats ->> x.k)::bigint, 0) + p_n)
  END
  FROM (SELECT p_journey_id::text || chr(31) || coalesce(p_step_id, '') || chr(31) || coalesce(p_field, '') AS k) x
$function$;

CREATE FUNCTION private.aka_agent_journey_stats_merge(p_into jsonb, p_add jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT coalesce(p_into, '{}'::jsonb) || coalesce((
    SELECT jsonb_object_agg(a.key, coalesce((p_into ->> a.key)::bigint, 0) + a.value::bigint)
    FROM jsonb_each_text(coalesce(p_add, '{}'::jsonb)) a), '{}'::jsonb)
$function$;

CREATE FUNCTION private.aka_agent_journey_stats_flush(p_stats jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  INSERT INTO public.auto_journey_step_stats AS s (journey_id, step_id, field, value, updated_at)
  SELECT split_part(e.key, chr(31), 1)::bigint, split_part(e.key, chr(31), 2), split_part(e.key, chr(31), 3), e.value::bigint, now()
  FROM jsonb_each_text(coalesce(p_stats, '{}'::jsonb)) e
  WHERE e.value::bigint <> 0
  ORDER BY 1, 2, 3
  ON CONFLICT (journey_id, step_id, field) DO UPDATE SET value = s.value + EXCLUDED.value, updated_at = now()
$function$;

-- auto_system_settings value as JSON (NULL when absent, inactive, secret or not JSON).
CREATE FUNCTION private.aka_agent_journey_setting(p_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_raw text;
BEGIN
  SELECT s.value INTO v_raw
  FROM public.auto_system_settings s
  WHERE s.key = p_key AND s.is_active IS TRUE AND s.is_secret IS NOT TRUE;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN NULL;
  END IF;
  RETURN v_raw::jsonb;
END
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- Control: read models
-- ---------------------------------------------------------------------------------------------------------
-- List item of one journey. Health is only computed while the published version runs (active/paused).
CREATE FUNCTION private.aka_agent_journey_summary(p_journey_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v public.auto_journey_versions%ROWTYPE;
  v_graph jsonb;
  v_stats jsonb;
  v_active bigint := 0;
  v_dispatched bigint := 0;
  v_open_tasks bigint := 0;
  v_paused bigint := 0;
  v_deleted bigint := 0;
  v_unusable bigint := 0;
  v_queued bigint := 0;
BEGIN
  SELECT * INTO j FROM public.auto_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF j.active_version_id IS NOT NULL THEN
    SELECT * INTO v FROM public.auto_journey_versions WHERE id = j.active_version_id;
  END IF;
  v_graph := coalesce(v.graph, j.draft_graph);

  SELECT coalesce(jsonb_object_agg(s.field, s.value), '{}'::jsonb) INTO v_stats
  FROM public.auto_journey_step_stats s
  WHERE s.journey_id = j.id AND s.step_id = '*';
  SELECT count(*) INTO v_active FROM public.auto_journey_enrollments e WHERE e.journey_id = j.id AND e.status = 'active';
  SELECT count(*) INTO v_dispatched FROM public.auto_journey_step_runs r
  WHERE r.journey_id = j.id AND r.dispatched_at >= private.aka_agent_journey_vn_day_start();
  SELECT count(*) INTO v_open_tasks FROM public.auto_journey_tasks t WHERE t.journey_id = j.id AND t.done_at IS NULL;

  IF v.id IS NOT NULL AND j.status IN ('active', 'paused') THEN
    SELECT count(*) FILTER (WHERE c.id IS NOT NULL AND c.is_delete IS NOT TRUE AND c.status = 'tạm dừng'),
           count(*) FILTER (WHERE c.id IS NULL OR c.is_delete IS TRUE)
    INTO v_paused, v_deleted
    FROM public.auto_journey_step_campaigns sc
    LEFT JOIN public.auto_campaigns c ON c.id = sc.campaign_id
    WHERE sc.journey_id = j.id AND sc.is_active;
    SELECT count(DISTINCT r.ref_id) INTO v_unusable
    FROM private.aka_agent_journey_graph_refs(v.graph) r
    LEFT JOIN public.auto_accounts a ON a.id = r.ref_id
    WHERE r.kind = 'account'
      AND (a.id IS NULL OR a.staff_id IS DISTINCT FROM j.staff_id
        OR NOT private.aka_agent_journey_account_ready(a.flatform_type, a.login_status, a.mobile_device_id, a.is_delete, a.is_active, a.status));
    SELECT count(*) INTO v_queued
    FROM public.auto_journey_enrollments e
    WHERE e.journey_id = j.id AND e.status = 'active' AND e.phase = 'ready' AND e.attempts > 0
      AND e.step_entered_at < now() - interval '3 days';
  END IF;

  RETURN jsonb_build_object(
    'id', j.id,
    'name', j.name,
    'status', j.status,
    'origin', j.origin,
    'templateCode', j.template_code,
    'sources', CASE WHEN jsonb_typeof(v_graph -> 'start' -> 'sources') = 'array' THEN v_graph -> 'start' -> 'sources' ELSE '[]'::jsonb END,
    'stepCount', (SELECT count(*) FROM private.aka_agent_journey_steps(v_graph)),
    'counts', jsonb_build_object(
      'enrolled', coalesce((v_stats ->> 'enrolled')::bigint, 0),
      'active', v_active,
      'completed', coalesce((v_stats ->> 'completed')::bigint, 0),
      'exited', coalesce((v_stats ->> 'exited')::bigint, 0),
      'failed', coalesce((v_stats ->> 'failed')::bigint, 0),
      'dispatchedToday', v_dispatched,
      'openTasks', v_open_tasks),
    'health', jsonb_build_object(
      'pausedCampaigns', v_paused,
      'deletedCampaigns', v_deleted,
      'unusableAccounts', v_unusable,
      'queuedLong', v_queued),
    'activeVersionNo', v.version_no,
    'hasUnpublishedChanges', CASE WHEN v.id IS NULL THEN true
      ELSE j.draft_graph IS DISTINCT FROM v.graph OR j.draft_settings IS DISTINCT FROM v.settings END,
    'createdAt', j.created_at,
    'updatedAt', j.updated_at,
    'activatedAt', j.activated_at);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_detail(p_journey_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v public.auto_journey_versions%ROWTYPE;
  v_summary jsonb;
  v_step_campaigns jsonb;
  v_step_stats jsonb;
  v_health jsonb;
  v_last_tick timestamptz;
BEGIN
  SELECT * INTO j FROM public.auto_journeys WHERE id = p_journey_id;
  IF j.active_version_id IS NOT NULL THEN
    SELECT * INTO v FROM public.auto_journey_versions WHERE id = j.active_version_id;
  END IF;
  v_summary := private.aka_agent_journey_summary(p_journey_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'stepId', sc.step_id, 'accountId', sc.account_id, 'actionCode', sc.action_code, 'campaignId', sc.campaign_id,
      'configHash', sc.config_hash, 'campaignName', c.name, 'campaignStatus', c.status,
      'campaignDeleted', c.id IS NULL OR c.is_delete IS TRUE)
    ORDER BY sc.step_id, sc.account_id, sc.action_code, sc.id), '[]'::jsonb)
  INTO v_step_campaigns
  FROM public.auto_journey_step_campaigns sc
  LEFT JOIN public.auto_campaigns c ON c.id = sc.campaign_id
  WHERE sc.journey_id = j.id AND sc.is_active;

  WITH stats AS (
    SELECT s.step_id, s.field, s.value FROM public.auto_journey_step_stats s
    WHERE s.journey_id = j.id AND s.step_id <> '*'
  ), cur AS (
    SELECT e.step_id, count(*) AS n FROM public.auto_journey_enrollments e
    WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id IS NOT NULL
    GROUP BY e.step_id
  ), ids AS (
    SELECT step_id FROM stats UNION SELECT step_id FROM cur
  )
  SELECT coalesce(jsonb_object_agg(ids.step_id, jsonb_build_object(
      'entered', coalesce((SELECT st.value FROM stats st WHERE st.step_id = ids.step_id AND st.field = 'entered'), 0),
      'passed', coalesce((SELECT st.value FROM stats st WHERE st.step_id = ids.step_id AND st.field = 'passed'), 0),
      'deferred', coalesce((SELECT st.value FROM stats st WHERE st.step_id = ids.step_id AND st.field = 'deferred'), 0),
      'exited', coalesce((SELECT st.value FROM stats st WHERE st.step_id = ids.step_id AND st.field = 'exited'), 0),
      'completed', coalesce((SELECT st.value FROM stats st WHERE st.step_id = ids.step_id AND st.field = 'completed'), 0),
      'current', coalesce((SELECT cur.n FROM cur WHERE cur.step_id = ids.step_id), 0),
      'exits', coalesce((SELECT jsonb_object_agg(substr(st.field, 6), st.value) FROM stats st
        WHERE st.step_id = ids.step_id AND st.field LIKE 'exit\_%'), '{}'::jsonb))), '{}'::jsonb)
  INTO v_step_stats
  FROM ids;

  v_health := '[]'::jsonb;
  IF v.id IS NOT NULL AND j.status IN ('active', 'paused') THEN
    SELECT v_health || coalesce(jsonb_agg(jsonb_build_object(
        'code', CASE WHEN c.id IS NULL OR c.is_delete IS TRUE THEN 'campaign_missing' ELSE 'campaign_paused' END,
        'stepId', sc.step_id, 'accountId', sc.account_id, 'campaignId', sc.campaign_id)
      ORDER BY sc.step_id, sc.campaign_id), '[]'::jsonb)
    INTO v_health
    FROM public.auto_journey_step_campaigns sc
    LEFT JOIN public.auto_campaigns c ON c.id = sc.campaign_id
    WHERE sc.journey_id = j.id AND sc.is_active
      AND (c.id IS NULL OR c.is_delete IS TRUE OR c.status = 'tạm dừng');

    SELECT v_health || coalesce(jsonb_agg(jsonb_build_object('code', 'account_unavailable', 'stepId', x.step_id, 'accountId', x.ref_id)
      ORDER BY x.step_id, x.ref_id), '[]'::jsonb)
    INTO v_health
    FROM (
      SELECT DISTINCT r.step_id, r.ref_id
      FROM private.aka_agent_journey_graph_refs(v.graph) r
      LEFT JOIN public.auto_accounts a ON a.id = r.ref_id
      WHERE r.kind = 'account'
        AND (a.id IS NULL OR a.staff_id IS DISTINCT FROM j.staff_id
          OR NOT private.aka_agent_journey_account_ready(a.flatform_type, a.login_status, a.mobile_device_id, a.is_delete, a.is_active, a.status))
    ) x;

    SELECT v_health || coalesce(jsonb_agg(jsonb_build_object('code', 'queued_long', 'stepId', q.step_id, 'count', q.n)
      ORDER BY q.step_id), '[]'::jsonb)
    INTO v_health
    FROM (
      SELECT e.step_id, count(*) AS n
      FROM public.auto_journey_enrollments e
      WHERE e.journey_id = j.id AND e.status = 'active' AND e.phase = 'ready' AND e.attempts > 0
        AND e.step_entered_at < now() - interval '3 days'
      GROUP BY e.step_id
    ) q;
  END IF;

  SELECT s.last_tick_at INTO v_last_tick FROM public.auto_journey_engine_state s WHERE s.id = 1;

  RETURN v_summary || jsonb_build_object(
    'draft', jsonb_build_object('graph', j.draft_graph, 'settings', j.draft_settings, 'revision', j.draft_revision,
      'updatedAt', j.draft_updated_at),
    'active', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('versionId', v.id, 'versionNo', v.version_no,
      'graph', v.graph, 'settings', v.settings, 'publishedAt', v.published_at) END,
    'stepCampaigns', v_step_campaigns,
    'stepStats', v_step_stats,
    'healthDetails', v_health,
    'engine', jsonb_build_object('lastTickAt', v_last_tick));
END
$function$;

-- One journey of this staff (not deleted). Raises journey_not_found otherwise.
CREATE FUNCTION private.aka_agent_journey_owned(p_staff_id bigint, p_organization_id bigint, p_payload jsonb, p_lock boolean)
RETURNS public.auto_journeys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_id bigint := private.aka_agent_journey_bigint(p_payload -> 'journeyId');
  j public.auto_journeys%ROWTYPE;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  IF p_lock THEN
    SELECT * INTO j FROM public.auto_journeys
    WHERE id = v_id AND staff_id = p_staff_id AND organization_id = p_organization_id AND is_delete = false
    FOR UPDATE;
  ELSE
    SELECT * INTO j FROM public.auto_journeys
    WHERE id = v_id AND staff_id = p_staff_id AND organization_id = p_organization_id AND is_delete = false;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  RETURN j;
END
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- Control actions
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.aka_agent_journey_ctl_access(p_staff_id bigint, p_organization_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_value jsonb := private.aka_agent_journey_setting('web.journeys');
  v_orgs jsonb;
  v_enabled boolean := false;
BEGIN
  IF jsonb_typeof(v_value) = 'object' AND jsonb_typeof(v_value -> 'enabled') = 'boolean' THEN
    v_enabled := (v_value ->> 'enabled')::boolean;
    v_orgs := v_value -> 'organizationIds';
    IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
      v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
    END IF;
  END IF;
  RETURN jsonb_build_object('enabled', coalesce(v_enabled, false));
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_list(p_staff_id bigint, p_organization_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT jsonb_build_object('items', coalesce(jsonb_agg(private.aka_agent_journey_summary(x.id) ORDER BY x.updated_at DESC, x.id DESC), '[]'::jsonb))
  FROM (
    SELECT j.id, j.updated_at FROM public.auto_journeys j
    WHERE j.staff_id = p_staff_id AND j.organization_id = p_organization_id AND j.is_delete = false
    ORDER BY j.updated_at DESC, j.id DESC
    LIMIT 200
  ) x
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_get(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  RETURN private.aka_agent_journey_detail(j.id);
END
$function$;

-- Draft payload checks shared by create and save_draft.
CREATE FUNCTION private.aka_agent_journey_check_draft(p_graph jsonb, p_settings jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $function$
BEGIN
  IF jsonb_typeof(p_graph) IS DISTINCT FROM 'object' OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  IF octet_length(p_graph::text) + octet_length(p_settings::text) > 262144 THEN
    RAISE EXCEPTION 'journey_payload_too_large';
  END IF;
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_create(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_origin text := coalesce(nullif(p_payload ->> 'origin', ''), 'blank');
  v_template text;
  v_count integer;
  v_id bigint;
BEGIN
  IF jsonb_typeof(p_payload -> 'name') IS DISTINCT FROM 'string' OR v_name = '' OR char_length(v_name) > 200
     OR v_origin NOT IN ('blank', 'template', 'ai', 'legacy')
     OR coalesce(jsonb_typeof(p_payload -> 'templateCode'), 'null') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_template := nullif(btrim(coalesce(p_payload ->> 'templateCode', '')), '');
  IF char_length(v_template) > 100 THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  PERFORM private.aka_agent_journey_check_draft(p_payload -> 'graph', p_payload -> 'settings');
  -- Serialize creates of one staff so the limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-journey-staff:' || p_staff_id::text, 0));
  SELECT count(*) INTO v_count FROM public.auto_journeys
  WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND is_delete = false;
  IF v_count >= 100 THEN
    RAISE EXCEPTION 'journey_limit_reached';
  END IF;
  INSERT INTO public.auto_journeys (staff_id, organization_id, name, status, origin, template_code, draft_graph, draft_settings)
  VALUES (p_staff_id, p_organization_id, v_name, 'draft', v_origin, v_template, p_payload -> 'graph', p_payload -> 'settings')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_save_draft(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_revision bigint := private.aka_agent_journey_bigint(p_payload -> 'revision');
  v_name text;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF p_payload ? 'name' AND jsonb_typeof(p_payload -> 'name') <> 'null' THEN
    v_name := btrim(coalesce(p_payload ->> 'name', ''));
    IF jsonb_typeof(p_payload -> 'name') <> 'string' OR v_name = '' OR char_length(v_name) > 200 THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
  END IF;
  PERFORM private.aka_agent_journey_check_draft(p_payload -> 'graph', p_payload -> 'settings');
  IF v_revision IS NULL OR v_revision <> j.draft_revision THEN
    RAISE EXCEPTION 'journey_revision_conflict';
  END IF;
  UPDATE public.auto_journeys
  SET draft_graph = p_payload -> 'graph', draft_settings = p_payload -> 'settings', name = coalesce(v_name, name),
      draft_revision = draft_revision + 1, draft_updated_at = now(), updated_at = now()
  WHERE id = j.id
  RETURNING * INTO j;
  RETURN jsonb_build_object('revision', j.draft_revision, 'updatedAt', j.draft_updated_at);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_campaign_ids(p_journey_id bigint, p_active_only boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT coalesce(jsonb_agg(sc.campaign_id ORDER BY sc.campaign_id), '[]'::jsonb)
  FROM public.auto_journey_step_campaigns sc
  WHERE sc.journey_id = p_journey_id AND (NOT p_active_only OR sc.is_active)
$function$;

-- Every active enrollment of a journey leaves (stop/delete). Returns how many left.
CREATE FUNCTION private.aka_agent_journey_exit_all(p_journey_id bigint, p_code text, p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_by_step jsonb;
  v_stats jsonb := '{}'::jsonb;
  v_total bigint := 0;
  r record;
BEGIN
  WITH o AS (
    UPDATE public.auto_journey_enrollments e
    SET status = 'exited', exit_code = p_code, exit_reason = p_reason, finished_at = now(), next_run_at = NULL,
        paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL, pending_reason = NULL,
        lease_token = NULL, lease_until = NULL, updated_at = now()
    WHERE e.journey_id = p_journey_id AND e.status = 'active'
    RETURNING e.id, e.step_id
  ), ev AS (
    INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
    SELECT p_journey_id, o.id, o.step_id, 'exit', p_reason FROM o
  )
  SELECT coalesce(jsonb_object_agg(coalesce(x.step_id, ''), x.n), '{}'::jsonb) INTO v_by_step
  FROM (SELECT o.step_id, count(*) AS n FROM o GROUP BY o.step_id) x;
  FOR r IN SELECT e.key, e.value::bigint AS n FROM jsonb_each_text(v_by_step) e LOOP
    v_total := v_total + r.n;
    IF r.key <> '' THEN
      v_stats := private.aka_agent_journey_stat_add(v_stats, p_journey_id, r.key, 'exited', r.n);
    END IF;
  END LOOP;
  v_stats := private.aka_agent_journey_stat_add(v_stats, p_journey_id, '*', 'exited', v_total);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN v_total;
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_publish_prepare(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v public.auto_journey_versions%ROWTYPE;
  v_revision bigint := private.aka_agent_journey_bigint(p_payload -> 'revision');
  v_steps text[];
  v_step_campaigns jsonb;
  v_orphans jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  IF v_revision IS NULL OR v_revision <> j.draft_revision THEN
    RAISE EXCEPTION 'journey_revision_conflict';
  END IF;
  IF j.active_version_id IS NOT NULL THEN
    SELECT * INTO v FROM public.auto_journey_versions WHERE id = j.active_version_id;
  END IF;
  v_steps := ARRAY(SELECT s.step_id FROM private.aka_agent_journey_steps(j.draft_graph) s);
  SELECT coalesce(jsonb_agg(jsonb_build_object('stepId', sc.step_id, 'accountId', sc.account_id, 'actionCode', sc.action_code,
      'campaignId', sc.campaign_id, 'configHash', sc.config_hash) ORDER BY sc.step_id, sc.account_id, sc.action_code, sc.id), '[]'::jsonb)
  INTO v_step_campaigns
  FROM public.auto_journey_step_campaigns sc
  WHERE sc.journey_id = j.id AND sc.is_active;
  SELECT coalesce(jsonb_object_agg(x.step_id, x.n), '{}'::jsonb) INTO v_orphans
  FROM (
    SELECT e.step_id, count(*) AS n
    FROM public.auto_journey_enrollments e
    WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id IS NOT NULL AND NOT (e.step_id = ANY(v_steps))
    GROUP BY e.step_id
  ) x;
  RETURN jsonb_build_object(
    'name', j.name,
    'draft', jsonb_build_object('graph', j.draft_graph, 'settings', j.draft_settings, 'revision', j.draft_revision),
    'active', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('versionId', v.id, 'graph', v.graph, 'settings', v.settings) END,
    'stepCampaigns', v_step_campaigns,
    'orphanedByStep', v_orphans,
    'status', j.status);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_publish(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  s public.auto_journey_sources%ROWTYPE;
  v_revision bigint := private.aka_agent_journey_bigint(p_payload -> 'revision');
  v_graph jsonb := p_payload -> 'graph';
  v_settings jsonb := p_payload -> 'settings';
  v_policy text := coalesce(nullif(p_payload ->> 'orphanPolicy', ''), 'continue');
  v_next jsonb := coalesce(nullif(p_payload -> 'orphanNext', 'null'::jsonb), '{}'::jsonb);
  v_checksum text;
  v_steps text[];
  v_item jsonb;
  v_step text;
  v_account bigint;
  v_action text;
  v_campaign bigint;
  v_hash text;
  v_kind text;
  v_group bigint;
  v_key text;
  v_entry boolean;
  v_stop boolean;
  v_mark boolean;
  v_include boolean;
  v_statuses text[];
  v_seen_keys text[] := '{}';
  v_seen_campaigns bigint[] := '{}';
  v_sources jsonb := '{}'::jsonb;
  v_src jsonb;
  v_old jsonb;
  v_gained boolean;
  v_found boolean;
  v_accounts bigint[];
  v_groups bigint[];
  v_campaigns bigint[];
  v_version_id bigint;
  v_version_no integer;
  v_paused boolean;
  v_by_step jsonb;
  v_stats jsonb := '{}'::jsonb;
  r record;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF j.status = 'stopped' THEN
    RAISE EXCEPTION 'journey_invalid_transition';
  END IF;
  IF v_revision IS NULL OR v_revision <> j.draft_revision
     OR v_graph IS DISTINCT FROM j.draft_graph OR v_settings IS DISTINCT FROM j.draft_settings THEN
    RAISE EXCEPTION 'journey_revision_conflict';
  END IF;
  IF v_policy NOT IN ('continue', 'exit') OR jsonb_typeof(v_next) <> 'object'
     OR coalesce(jsonb_typeof(p_payload -> 'stepCampaigns'), 'null') NOT IN ('array', 'null')
     OR coalesce(jsonb_typeof(p_payload -> 'sources'), 'null') NOT IN ('array', 'null')
     OR coalesce(jsonb_typeof(p_payload -> 'checksum'), 'null') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_checksum := left(coalesce(nullif(btrim(p_payload ->> 'checksum'), ''), md5(v_graph::text || v_settings::text)), 200);
  v_steps := ARRAY(SELECT st.step_id FROM private.aka_agent_journey_steps(v_graph) st);
  IF EXISTS (SELECT 1 FROM jsonb_each(v_next) n
             WHERE jsonb_typeof(n.value) <> 'null' AND (jsonb_typeof(n.value) <> 'string' OR NOT ((n.value #>> '{}') = ANY(v_steps)))) THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;

  -- Managed step campaigns: same tenant, not deleted, same account/action, not owned by another journey.
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(coalesce(nullif(p_payload -> 'stepCampaigns', 'null'::jsonb), '[]'::jsonb)) x LOOP
    IF jsonb_typeof(v_item) <> 'object' OR coalesce(jsonb_typeof(v_item -> 'configHash'), 'null') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    v_step := v_item ->> 'stepId';
    v_account := private.aka_agent_journey_bigint(v_item -> 'accountId');
    v_action := nullif(btrim(coalesce(v_item ->> 'actionCode', '')), '');
    v_campaign := private.aka_agent_journey_bigint(v_item -> 'campaignId');
    v_hash := coalesce(v_item ->> 'configHash', '');
    IF v_step IS NULL OR char_length(v_step) NOT BETWEEN 1 AND 100 OR v_account IS NULL OR v_action IS NULL
       OR v_campaign IS NULL OR char_length(v_hash) > 200 THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    v_key := v_step || chr(31) || v_account::text || chr(31) || v_action;
    IF NOT (v_step = ANY(v_steps)) OR v_key = ANY(v_seen_keys) OR v_campaign = ANY(v_seen_campaigns) THEN
      RAISE EXCEPTION 'journey_campaign_invalid';
    END IF;
    v_seen_keys := v_seen_keys || v_key;
    v_seen_campaigns := v_seen_campaigns || v_campaign;
    IF NOT EXISTS (
         SELECT 1 FROM public.auto_campaigns c
         WHERE c.id = v_campaign AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id
           AND c.is_delete IS NOT TRUE AND c.action_id = v_action AND c.account_id = v_account)
       OR EXISTS (
         SELECT 1 FROM public.auto_journey_step_campaigns sc
         WHERE sc.campaign_id = v_campaign
           AND (sc.journey_id <> j.id OR (sc.step_id, sc.account_id, sc.action_code, sc.config_hash)
                IS DISTINCT FROM (v_step, v_account, v_action, v_hash))) THEN
      RAISE EXCEPTION 'journey_campaign_invalid';
    END IF;
  END LOOP;

  -- Sources, merged by key (same data group may be entry + stop/mark).
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(coalesce(nullif(p_payload -> 'sources', 'null'::jsonb), '[]'::jsonb)) x LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR coalesce(jsonb_typeof(v_item -> 'isEntry'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'isStop'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'isMark'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'includeExisting'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'statuses'), 'null') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    v_kind := v_item ->> 'kind';
    v_entry := coalesce((v_item ->> 'isEntry')::boolean, false);
    v_stop := coalesce((v_item ->> 'isStop')::boolean, false);
    v_mark := coalesce((v_item ->> 'isMark')::boolean, false);
    v_include := coalesce((v_item ->> 'includeExisting')::boolean, false);
    v_statuses := '{}';
    IF v_kind = 'data_group' THEN
      v_group := private.aka_agent_journey_bigint(v_item -> 'groupId');
      IF v_group IS NULL THEN
        RAISE EXCEPTION 'journey_invalid_payload';
      END IF;
      v_key := 'g:' || v_group::text;
    ELSIF v_kind = 'campaign_result' THEN
      v_campaign := private.aka_agent_journey_bigint(v_item -> 'campaignId');
      IF v_campaign IS NULL OR v_stop OR v_mark
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(nullif(v_item -> 'statuses', 'null'::jsonb), '[]'::jsonb)) st
                    WHERE jsonb_typeof(st.value) <> 'string' OR char_length(st.value #>> '{}') > 100)
         OR jsonb_array_length(coalesce(nullif(v_item -> 'statuses', 'null'::jsonb), '[]'::jsonb)) > 30 THEN
        RAISE EXCEPTION 'journey_invalid_payload';
      END IF;
      v_statuses := ARRAY(SELECT DISTINCT btrim(st.value #>> '{}')
                          FROM jsonb_array_elements(coalesce(nullif(v_item -> 'statuses', 'null'::jsonb), '[]'::jsonb)) st
                          WHERE btrim(st.value #>> '{}') <> '' ORDER BY 1);
      IF v_entry AND cardinality(v_statuses) = 0 THEN
        RAISE EXCEPTION 'journey_invalid_payload';
      END IF;
      v_key := 'c:' || v_campaign::text;
    ELSE
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    CONTINUE WHEN NOT (v_entry OR v_stop OR v_mark);
    v_old := v_sources -> v_key;
    v_sources := v_sources || jsonb_build_object(v_key, jsonb_build_object(
      'kind', v_kind,
      'id', CASE WHEN v_kind = 'data_group' THEN v_group ELSE v_campaign END,
      'entry', v_entry OR coalesce((v_old ->> 'entry')::boolean, false),
      'stop', v_stop OR coalesce((v_old ->> 'stop')::boolean, false),
      'mark', v_mark OR coalesce((v_old ->> 'mark')::boolean, false),
      'include', v_include OR coalesce((v_old ->> 'include')::boolean, false),
      'statuses', (SELECT coalesce(jsonb_agg(DISTINCT u.x ORDER BY u.x), '[]'::jsonb) FROM (
          SELECT unnest(v_statuses) AS x
          UNION SELECT jsonb_array_elements_text(coalesce(v_old -> 'statuses', '[]'::jsonb))) u)));
  END LOOP;

  -- Every account, data group and campaign the version uses belongs to this staff.
  v_accounts := ARRAY(SELECT DISTINCT rf.ref_id FROM private.aka_agent_journey_graph_refs(v_graph) rf WHERE rf.kind = 'account');
  v_groups := ARRAY(SELECT DISTINCT g.id FROM (
      SELECT rf.ref_id AS id FROM private.aka_agent_journey_graph_refs(v_graph) rf WHERE rf.kind IN ('group', 'condition_group')
      UNION SELECT unnest(private.aka_agent_journey_bigint_array(v_settings -> 'stopGroupIds'))
      UNION SELECT (sv.value ->> 'id')::bigint FROM jsonb_each(v_sources) sv WHERE sv.value ->> 'kind' = 'data_group') g
    WHERE g.id IS NOT NULL);
  v_campaigns := ARRAY(SELECT DISTINCT c.id FROM (
      SELECT rf.ref_id AS id FROM private.aka_agent_journey_graph_refs(v_graph) rf WHERE rf.kind = 'campaign'
      UNION SELECT (sv.value ->> 'id')::bigint FROM jsonb_each(v_sources) sv WHERE sv.value ->> 'kind' = 'campaign_result') c
    WHERE c.id IS NOT NULL);
  IF EXISTS (SELECT 1 FROM unnest(v_accounts) a(id) WHERE NOT EXISTS (
         SELECT 1 FROM public.auto_accounts x WHERE x.id = a.id AND x.staff_id = p_staff_id
           AND (x.organization_id IS NULL OR x.organization_id = p_organization_id) AND x.is_delete IS NOT TRUE))
     OR EXISTS (SELECT 1 FROM unnest(v_groups) g(id) WHERE NOT EXISTS (
         SELECT 1 FROM public.auto_account_contact_groups x WHERE x.id = g.id AND x.staff_id = p_staff_id
           AND x.organization_id = p_organization_id AND x.purpose = 'data_group' AND x.is_delete IS NOT TRUE))
     OR EXISTS (SELECT 1 FROM unnest(v_campaigns) c(id) WHERE NOT EXISTS (
         SELECT 1 FROM public.auto_campaigns x WHERE x.id = c.id AND x.staff_id = p_staff_id
           AND x.organization_id = p_organization_id AND x.is_delete IS NOT TRUE)) THEN
    RAISE EXCEPTION 'journey_reference_invalid';
  END IF;

  -- Version.
  SELECT coalesce(max(version_no), 0) + 1 INTO v_version_no FROM public.auto_journey_versions WHERE journey_id = j.id;
  INSERT INTO public.auto_journey_versions (journey_id, version_no, graph, settings, checksum, published_by_staff_id)
  VALUES (j.id, v_version_no, v_graph, v_settings, v_checksum, p_staff_id)
  RETURNING id INTO v_version_id;
  v_paused := j.status = 'paused';
  UPDATE public.auto_journeys
  SET active_version_id = v_version_id, status = CASE WHEN v_paused THEN 'paused' ELSE 'active' END,
      activated_at = coalesce(activated_at, now()), updated_at = now()
  WHERE id = j.id;

  -- Step campaigns: the payload set becomes the active set.
  UPDATE public.auto_journey_step_campaigns SET is_active = false, updated_at = now() WHERE journey_id = j.id AND is_active;
  BEGIN
    INSERT INTO public.auto_journey_step_campaigns (journey_id, step_id, account_id, action_code, config_hash, campaign_id, is_active)
    SELECT j.id, x.value ->> 'stepId', private.aka_agent_journey_bigint(x.value -> 'accountId'), btrim(x.value ->> 'actionCode'),
      coalesce(x.value ->> 'configHash', ''), private.aka_agent_journey_bigint(x.value -> 'campaignId'), true
    FROM jsonb_array_elements(coalesce(nullif(p_payload -> 'stepCampaigns', 'null'::jsonb), '[]'::jsonb)) x
    ON CONFLICT (journey_id, step_id, account_id, action_code, config_hash)
    DO UPDATE SET campaign_id = EXCLUDED.campaign_id, is_active = true, updated_at = now();
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'journey_campaign_invalid';
  END;

  -- Sources: existing active ones keep their cursor; new (or re-activated) ones start per includeExisting.
  FOR v_key, v_src IN SELECT sv.key, sv.value FROM jsonb_each(v_sources) sv LOOP
    IF v_src ->> 'kind' = 'data_group' THEN
      SELECT * INTO s FROM public.auto_journey_sources
      WHERE journey_id = j.id AND kind = 'data_group' AND group_id = (v_src ->> 'id')::bigint FOR UPDATE;
    ELSE
      SELECT * INTO s FROM public.auto_journey_sources
      WHERE journey_id = j.id AND kind = 'campaign_result' AND campaign_id = (v_src ->> 'id')::bigint FOR UPDATE;
    END IF;
    v_found := FOUND;
    v_entry := (v_src ->> 'entry')::boolean;
    v_stop := (v_src ->> 'stop')::boolean;
    v_mark := (v_src ->> 'mark')::boolean;
    v_include := (v_src ->> 'include')::boolean;
    v_statuses := ARRAY(SELECT jsonb_array_elements_text(v_src -> 'statuses'));
    IF v_found AND s.is_active THEN
      -- Gaining stop/mark needs the whole group for marks; entries keep starting after the old cursor.
      v_gained := s.kind = 'data_group' AND (v_stop OR v_mark) AND NOT (s.is_stop OR s.is_mark);
      UPDATE public.auto_journey_sources
      SET is_entry = v_entry, is_stop = v_stop, is_mark = v_mark, include_existing = v_include, statuses = v_statuses,
          cursor_ts = CASE WHEN v_gained THEN NULL ELSE cursor_ts END,
          cursor_id = CASE WHEN v_gained THEN 0 ELSE cursor_id END,
          entry_since = CASE WHEN NOT v_gained THEN entry_since
            WHEN cursor_ts IS NULL THEN entry_since WHEN entry_since IS NULL THEN cursor_ts
            ELSE greatest(entry_since, cursor_ts) END,
          seeded_at = CASE WHEN v_gained THEN NULL ELSE seeded_at END,
          updated_at = now()
      WHERE id = s.id;
    ELSIF v_found THEN
      UPDATE public.auto_journey_sources
      SET is_entry = v_entry, is_stop = v_stop, is_mark = v_mark, include_existing = v_include, statuses = v_statuses,
          cursor_ts = CASE WHEN v_include OR v_stop OR v_mark THEN NULL ELSE now() END, cursor_id = 0,
          entry_since = CASE WHEN v_include THEN NULL ELSE now() END,
          seeded_at = NULL, last_scanned_at = NULL, is_active = true, updated_at = now()
      WHERE id = s.id;
    ELSE
      INSERT INTO public.auto_journey_sources (journey_id, kind, group_id, campaign_id, statuses, is_entry, is_stop, is_mark,
        include_existing, entry_since, cursor_ts, cursor_id)
      VALUES (j.id, v_src ->> 'kind',
        CASE WHEN v_src ->> 'kind' = 'data_group' THEN (v_src ->> 'id')::bigint END,
        CASE WHEN v_src ->> 'kind' = 'campaign_result' THEN (v_src ->> 'id')::bigint END,
        v_statuses, v_entry, v_stop, v_mark, v_include,
        CASE WHEN v_include THEN NULL ELSE now() END,
        CASE WHEN v_include OR v_stop OR v_mark THEN NULL ELSE now() END, 0);
    END IF;
  END LOOP;
  UPDATE public.auto_journey_sources src
  SET is_active = false, updated_at = now()
  WHERE src.journey_id = j.id AND src.is_active
    AND NOT ((CASE WHEN src.kind = 'data_group' THEN 'g:' || src.group_id::text ELSE 'c:' || src.campaign_id::text END)
             = ANY(ARRAY(SELECT jsonb_object_keys(v_sources))));

  -- Enrollments at a step that is not in the new graph.
  IF v_policy = 'exit' THEN
    WITH o AS (
      UPDATE public.auto_journey_enrollments e
      SET status = 'exited', exit_code = 'step_removed', exit_reason = 'Bước khách đang ở đã bị xóa khỏi quy trình.',
          finished_at = now(), next_run_at = NULL, paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL,
          pending_reason = NULL, lease_token = NULL, lease_until = NULL, version_id = v_version_id, updated_at = now()
      WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id IS NOT NULL AND NOT (e.step_id = ANY(v_steps))
      RETURNING e.id, e.step_id
    ), ev AS (
      INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
      SELECT j.id, o.id, o.step_id, 'exit', 'Bước khách đang ở đã bị xóa khỏi quy trình; khách ra khỏi quy trình.' FROM o
    )
    SELECT coalesce(jsonb_object_agg(x.step_id, x.n), '{}'::jsonb) INTO v_by_step
    FROM (SELECT o.step_id, count(*) AS n FROM o GROUP BY o.step_id) x;
    FOR r IN SELECT e.key, e.value::bigint AS n FROM jsonb_each_text(v_by_step) e LOOP
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.key, 'exited', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'exited', r.n);
    END LOOP;
  ELSE
    WITH o AS (
      UPDATE public.auto_journey_enrollments e
      SET step_id = nx.target, phase = 'ready',
          next_run_at = CASE WHEN v_paused THEN NULL ELSE now() END,
          paused_next_run_at = CASE WHEN v_paused THEN now() ELSE NULL END,
          attempts = 0, defer_code = NULL, step_entered_at = now(), pending_outcome = NULL, pending_reason = NULL,
          lease_token = NULL, lease_until = NULL, version_id = v_version_id, updated_at = now()
      FROM (SELECT n.key AS old_step, n.value #>> '{}' AS target FROM jsonb_each(v_next) n WHERE jsonb_typeof(n.value) = 'string') nx
      WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id = nx.old_step AND NOT (e.step_id = ANY(v_steps))
      RETURNING e.id, nx.old_step, nx.target
    ), ev AS (
      INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
      SELECT j.id, o.id, o.target, 'step', 'Bước cũ đã bị xóa khỏi quy trình; khách chuyển sang bước tiếp theo.' FROM o
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('old', x.old_step, 'new', x.target, 'n', x.n)), '[]'::jsonb) INTO v_by_step
    FROM (SELECT o.old_step, o.target, count(*) AS n FROM o GROUP BY o.old_step, o.target) x;
    FOR r IN SELECT x.value ->> 'old' AS old_step, x.value ->> 'new' AS new_step, (x.value ->> 'n')::bigint AS n
             FROM jsonb_array_elements(v_by_step) x LOOP
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.old_step, 'passed', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.new_step, 'entered', r.n);
    END LOOP;

    WITH o AS (
      UPDATE public.auto_journey_enrollments e
      SET status = 'completed', exit_code = 'step_removed',
          exit_reason = 'Bước khách đang ở đã bị xóa khỏi quy trình; khách hoàn thành quy trình.',
          finished_at = now(), next_run_at = NULL, paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL,
          pending_reason = NULL, lease_token = NULL, lease_until = NULL, version_id = v_version_id, updated_at = now()
      WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id IS NOT NULL AND NOT (e.step_id = ANY(v_steps))
      RETURNING e.id, e.step_id
    ), ev AS (
      INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
      SELECT j.id, o.id, o.step_id, 'complete', 'Bước khách đang ở đã bị xóa khỏi quy trình; khách hoàn thành quy trình.' FROM o
    )
    SELECT coalesce(jsonb_object_agg(x.step_id, x.n), '{}'::jsonb) INTO v_by_step
    FROM (SELECT o.step_id, count(*) AS n FROM o GROUP BY o.step_id) x;
    FOR r IN SELECT e.key, e.value::bigint AS n FROM jsonb_each_text(v_by_step) e LOOP
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.key, 'passed', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.key, 'completed', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'completed', r.n);
    END LOOP;
  END IF;
  -- Everyone else moves to the new version; in-flight engine results computed on the old one are dropped.
  UPDATE public.auto_journey_enrollments
  SET version_id = v_version_id, lease_token = NULL, lease_until = NULL, updated_at = now()
  WHERE journey_id = j.id AND status = 'active' AND (version_id <> v_version_id OR lease_token IS NOT NULL);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('versionId', v_version_id, 'versionNo', v_version_no);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_set_status(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_action text := p_payload ->> 'action';
  v_status text;
  v_campaigns jsonb;
BEGIN
  IF v_action IS NULL OR v_action NOT IN ('pause', 'resume', 'stop')
     OR coalesce(jsonb_typeof(p_payload -> 'skipPaused'), 'null') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF v_action = 'pause' THEN
    IF j.status <> 'active' THEN
      RAISE EXCEPTION 'journey_invalid_transition';
    END IF;
    UPDATE public.auto_journey_enrollments
    SET paused_next_run_at = next_run_at, next_run_at = NULL, lease_token = NULL, lease_until = NULL, updated_at = now()
    WHERE journey_id = j.id AND status = 'active';
    v_status := 'paused';
    UPDATE public.auto_journeys SET status = v_status, paused_at = now(), updated_at = now() WHERE id = j.id;
    v_campaigns := private.aka_agent_journey_campaign_ids(j.id, false);
  ELSIF v_action = 'resume' THEN
    IF j.status <> 'paused' THEN
      RAISE EXCEPTION 'journey_invalid_transition';
    END IF;
    UPDATE public.auto_journey_enrollments
    SET next_run_at = paused_next_run_at, paused_next_run_at = NULL, updated_at = now()
    WHERE journey_id = j.id AND status = 'active' AND paused_next_run_at IS NOT NULL;
    IF coalesce((p_payload ->> 'skipPaused')::boolean, false) THEN
      -- Skip customers who joined while paused; stop/mark groups keep reading so their marks stay complete.
      UPDATE public.auto_journey_sources
      SET entry_since = now(),
          cursor_ts = CASE WHEN is_stop OR is_mark THEN cursor_ts ELSE now() END,
          cursor_id = CASE WHEN is_stop OR is_mark THEN cursor_id ELSE 0 END,
          updated_at = now()
      WHERE journey_id = j.id AND is_active AND is_entry;
    END IF;
    v_status := 'active';
    UPDATE public.auto_journeys SET status = v_status, paused_at = NULL, updated_at = now() WHERE id = j.id;
    v_campaigns := private.aka_agent_journey_campaign_ids(j.id, true);
  ELSE
    IF j.status NOT IN ('active', 'paused') THEN
      RAISE EXCEPTION 'journey_invalid_transition';
    END IF;
    PERFORM private.aka_agent_journey_exit_all(j.id, 'journey_stopped', 'Quy trình đã dừng.');
    v_status := 'stopped';
    UPDATE public.auto_journeys SET status = v_status, stopped_at = now(), updated_at = now() WHERE id = j.id;
    v_campaigns := private.aka_agent_journey_campaign_ids(j.id, false);
  END IF;
  RETURN jsonb_build_object('status', v_status, 'campaignIds', v_campaigns);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_delete(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF j.status = 'active' THEN
    RAISE EXCEPTION 'journey_active';
  END IF;
  PERFORM private.aka_agent_journey_exit_all(j.id, 'journey_deleted', 'Quy trình đã bị xóa.');
  UPDATE public.auto_journey_sources SET is_active = false, updated_at = now() WHERE journey_id = j.id AND is_active;
  UPDATE public.auto_journeys SET is_delete = true, deleted_at = now(), updated_at = now() WHERE id = j.id;
  RETURN jsonb_build_object('campaignIds', private.aka_agent_journey_campaign_ids(j.id, false));
END
$function$;

CREATE FUNCTION private.aka_agent_journey_enrollment_row(e public.auto_journey_enrollments) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $function$
  SELECT jsonb_build_object('id', e.id, 'contactKey', e.contact_key, 'contact', e.contact, 'status', e.status,
    'stepId', e.step_id, 'phase', e.phase, 'nextRunAt', e.next_run_at, 'pausedNextRunAt', e.paused_next_run_at,
    'enteredAt', e.entered_at, 'finishedAt', e.finished_at, 'exitCode', e.exit_code, 'exitReason', e.exit_reason,
    'stickyAccountId', e.sticky_account_id, 'isTest', e.is_test, 'zaloStatus', e.zalo_status, 'stepEnteredAt', e.step_entered_at)
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_enrollments(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_status text := nullif(btrim(coalesce(p_payload ->> 'status', '')), '');
  v_step text := nullif(btrim(coalesce(p_payload ->> 'stepId', '')), '');
  v_search text := left(nullif(btrim(coalesce(p_payload ->> 'search', '')), ''), 100);
  v_cursor bigint := private.aka_agent_journey_bigint(p_payload -> 'cursor');
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 50), 1), 100)::integer;
  v_phone text;
  v_pattern text;
  v_items jsonb;
  v_count integer;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  IF v_status = 'all' THEN
    v_status := NULL;
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('active', 'completed', 'exited', 'failed') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  IF v_search IS NOT NULL THEN
    v_phone := private.aka_agent_journey_phone(v_search);
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  SELECT coalesce(jsonb_agg(private.aka_agent_journey_enrollment_row(p.e) ORDER BY (p.e).id DESC), '[]'::jsonb), count(*)
  INTO v_items, v_count
  FROM (
    SELECT e FROM public.auto_journey_enrollments e
    WHERE e.journey_id = j.id
      AND (v_status IS NULL OR e.status = v_status)
      AND (v_step IS NULL OR e.step_id = v_step)
      AND (v_cursor IS NULL OR e.id < v_cursor)
      AND (v_search IS NULL
        OR (v_phone IS NOT NULL AND e.contact_key IN ('phone:' || v_phone, 'test:phone:' || v_phone))
        OR (v_phone IS NULL AND (e.contact_key ILIKE v_pattern OR e.contact ->> 'name' ILIKE v_pattern
          OR e.contact ->> 'email' ILIKE v_pattern OR e.contact ->> 'uid' ILIKE v_pattern)))
    ORDER BY e.id DESC
    LIMIT v_limit + 1
  ) p;
  IF v_count > v_limit THEN
    v_items := v_items - v_limit;
    RETURN jsonb_build_object('items', v_items, 'nextCursor', (v_items -> (v_limit - 1) ->> 'id')::bigint);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'nextCursor', NULL);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_enrollment(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  e public.auto_journey_enrollments%ROWTYPE;
  v_id bigint := private.aka_agent_journey_bigint(p_payload -> 'enrollmentId');
  v_events jsonb;
  v_sends jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  SELECT * INTO e FROM public.auto_journey_enrollments WHERE id = v_id AND journey_id = j.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'stepId', x.step_id, 'kind', x.kind, 'message', x.message,
      'data', x.data, 'createdAt', x.created_at) ORDER BY x.id), '[]'::jsonb)
  INTO v_events
  FROM (SELECT * FROM public.auto_journey_events ev WHERE ev.enrollment_id = e.id ORDER BY ev.id DESC LIMIT 300) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'stepId', r.step_id, 'accountId', r.account_id,
      'campaignId', r.campaign_id, 'actionCode', r.action_code, 'status', r.status, 'outcome', r.outcome, 'reason', r.reason,
      'dispatchedAt', r.dispatched_at, 'settledAt', r.settled_at) ORDER BY r.dispatched_at, r.id), '[]'::jsonb)
  INTO v_sends
  FROM public.auto_journey_step_runs r WHERE r.enrollment_id = e.id;
  RETURN jsonb_build_object('enrollment', private.aka_agent_journey_enrollment_row(e), 'events', v_events, 'sends', v_sends);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_exit_enrollment(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_id bigint := private.aka_agent_journey_bigint(p_payload -> 'enrollmentId');
  v_step text;
  v_reason text := 'Nhân viên cho khách ra khỏi quy trình.';
  v_stats jsonb := '{}'::jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  UPDATE public.auto_journey_enrollments
  SET status = 'exited', exit_code = 'manual', exit_reason = v_reason, finished_at = now(), next_run_at = NULL,
      paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL, pending_reason = NULL,
      lease_token = NULL, lease_until = NULL, updated_at = now()
  WHERE id = v_id AND journey_id = j.id AND status = 'active'
  RETURNING step_id INTO v_step;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.auto_journey_enrollments WHERE id = v_id AND journey_id = j.id) THEN
      RETURN jsonb_build_object('ok', false);
    END IF;
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
  VALUES (j.id, v_id, v_step, 'exit', v_reason);
  v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, v_step, 'exited', 1);
  v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'exited', 1);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_test_enroll(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_c jsonb := p_payload -> 'contact';
  v_phone text;
  v_uid text;
  v_account bigint;
  v_email text;
  v_key text;
  v_id bigint;
  v_stats jsonb := '{}'::jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF j.status <> 'active' OR j.active_version_id IS NULL THEN
    RAISE EXCEPTION 'journey_not_active';
  END IF;
  IF jsonb_typeof(v_c) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_phone := private.aka_agent_journey_phone(v_c ->> 'phone');
  v_uid := left(nullif(btrim(coalesce(v_c ->> 'uid', '')), ''), 500);
  v_account := private.aka_agent_journey_bigint(v_c -> 'accountId');
  v_email := private.aka_agent_journey_email(v_c ->> 'email');
  IF v_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.auto_accounts a WHERE a.id = v_account AND a.staff_id = p_staff_id
        AND (a.organization_id IS NULL OR a.organization_id = p_organization_id) AND a.is_delete IS NOT TRUE) THEN
    RAISE EXCEPTION 'journey_reference_invalid';
  END IF;
  v_key := private.aka_agent_journey_contact_key(v_phone, v_uid, v_account, v_email, NULL);
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_key := 'test:' || v_key;
  INSERT INTO public.auto_journey_enrollments (journey_id, version_id, staff_id, organization_id, contact_key, contact,
    source_kind, status, phase, next_run_at, is_test)
  VALUES (j.id, j.active_version_id, j.staff_id, j.organization_id, v_key,
    private.aka_agent_journey_contact(v_c ->> 'name', v_phone, v_uid, v_email, v_c ->> 'info1', v_c ->> 'info2', v_c ->> 'info3',
      v_c ->> 'info4', v_c ->> 'info5', v_c ->> 'carrier', v_account),
    'test', 'active', 'ready', now(), true)
  ON CONFLICT (journey_id, contact_key) WHERE status = 'active' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.auto_journey_enrollments WHERE journey_id = j.id AND contact_key = v_key AND status = 'active';
    RETURN jsonb_build_object('enrollmentId', v_id, 'created', false);
  END IF;
  INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
  VALUES (j.id, v_id, NULL, 'enter', 'Chạy thử với 1 khách: tin gửi thật trong giờ gửi, mỗi bước Chờ rút còn 1 phút, không tính trần tin mỗi ngày.');
  v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'enrolled', 1);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('enrollmentId', v_id, 'created', true);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_tasks(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_done boolean;
  v_cursor bigint := private.aka_agent_journey_bigint(p_payload -> 'cursor');
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 50), 1), 100)::integer;
  v_items jsonb;
  v_count integer;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  IF coalesce(jsonb_typeof(p_payload -> 'done'), 'null') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_done := (p_payload ->> 'done')::boolean;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'enrollmentId', x.enrollment_id, 'stepId', x.step_id, 'note', x.note,
      'contact', x.contact, 'createdAt', x.created_at, 'doneAt', x.done_at) ORDER BY x.id DESC), '[]'::jsonb), count(*)
  INTO v_items, v_count
  FROM (
    SELECT t.id, t.enrollment_id, t.step_id, t.note, e.contact, t.created_at, t.done_at
    FROM public.auto_journey_tasks t
    JOIN public.auto_journey_enrollments e ON e.id = t.enrollment_id
    WHERE t.journey_id = j.id
      AND (v_done IS NULL OR (v_done AND t.done_at IS NOT NULL) OR (NOT v_done AND t.done_at IS NULL))
      AND (v_cursor IS NULL OR t.id < v_cursor)
    ORDER BY t.id DESC
    LIMIT v_limit + 1
  ) x;
  IF v_count > v_limit THEN
    v_items := v_items - v_limit;
    RETURN jsonb_build_object('items', v_items, 'nextCursor', (v_items -> (v_limit - 1) ->> 'id')::bigint);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'nextCursor', NULL);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_task_done(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_id bigint := private.aka_agent_journey_bigint(p_payload -> 'taskId');
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  UPDATE public.auto_journey_tasks
  SET done_at = coalesce(done_at, now()), done_by_staff_id = coalesce(done_by_staff_id, p_staff_id)
  WHERE id = v_id AND journey_id = j.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Builder catalog: the staff's 300 most recently updated campaigns (any action) and which ones journeys manage.
CREATE FUNCTION private.aka_agent_journey_ctl_catalog_campaigns(p_staff_id bigint, p_organization_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  WITH managed AS MATERIALIZED (
    SELECT DISTINCT sc.campaign_id
    FROM public.auto_journeys j
    JOIN public.auto_journey_step_campaigns sc ON sc.journey_id = j.id
    WHERE j.staff_id = p_staff_id AND j.organization_id = p_organization_id AND j.is_delete = false
  ), recent AS MATERIALIZED (
    SELECT c.id, c.name, c.action_id, c.account_id, c.status, c.updated_at
    FROM public.auto_campaigns c
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete IS NOT TRUE
    ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
    LIMIT 300
  )
  SELECT jsonb_build_object(
    'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'actionCode', r.action_id,
        'accountId', r.account_id, 'status', r.status, 'managed', EXISTS (SELECT 1 FROM managed m WHERE m.campaign_id = r.id))
      ORDER BY r.updated_at DESC NULLS LAST, r.id DESC) FROM recent r), '[]'::jsonb),
    'managedCampaignIds', coalesce((SELECT jsonb_agg(m.campaign_id ORDER BY m.campaign_id) FROM managed m), '[]'::jsonb))
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- Engine
-- ---------------------------------------------------------------------------------------------------------
-- Every action after tick needs the unexpired lease token; it extends the lease by 60 seconds.
CREATE FUNCTION private.aka_agent_journey_engine_lease(p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_token uuid;
BEGIN
  IF jsonb_typeof(p_payload -> 'token') = 'string'
     AND (p_payload ->> 'token') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_token := (p_payload ->> 'token')::uuid;
  END IF;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'journey_lease_lost';
  END IF;
  UPDATE public.auto_journey_engine_state
  SET lease_until = now() + interval '60 seconds', updated_at = now()
  WHERE id = 1 AND lease_token = v_token AND lease_until > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_lease_lost';
  END IF;
  RETURN v_token;
END
$function$;

CREATE FUNCTION private.aka_agent_journey_engine_tick() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_flag jsonb := private.aka_agent_journey_setting('journeys.engine_enabled');
  v_enabled boolean;
  v_active integer;
  st public.auto_journey_engine_state%ROWTYPE;
  v_token uuid;
BEGIN
  -- Missing or unreadable switch = enabled; only an explicit {"enabled":false} stops the engine.
  v_enabled := NOT (jsonb_typeof(v_flag) = 'object' AND jsonb_typeof(v_flag -> 'enabled') = 'boolean'
    AND NOT (v_flag ->> 'enabled')::boolean);
  SELECT * INTO st FROM public.auto_journey_engine_state WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.auto_journey_engine_state (id) VALUES (1) RETURNING * INTO st;
  END IF;
  IF NOT v_enabled THEN
    UPDATE public.auto_journey_engine_state SET last_tick_at = now(), updated_at = now() WHERE id = 1;
    RETURN jsonb_build_object('run', false, 'enabled', false);
  END IF;
  SELECT count(*) INTO v_active FROM public.auto_journeys WHERE status = 'active' AND is_delete = false;
  IF v_active = 0 THEN
    UPDATE public.auto_journey_engine_state SET last_tick_at = now(), updated_at = now() WHERE id = 1;
    RETURN jsonb_build_object('run', false, 'enabled', true, 'active', 0);
  END IF;
  IF st.lease_token IS NOT NULL AND st.lease_until > now() THEN
    UPDATE public.auto_journey_engine_state SET last_tick_at = now(), updated_at = now() WHERE id = 1;
    RETURN jsonb_build_object('run', false, 'enabled', true, 'busy', true, 'active', v_active);
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.auto_journey_engine_state
  SET lease_token = v_token, lease_until = now() + interval '60 seconds', last_tick_at = now(), updated_at = now()
  WHERE id = 1;
  RETURN jsonb_build_object('run', true, 'enabled', true, 'token', v_token, 'active', v_active,
    'cleanupDue', st.last_cleanup_at IS NULL OR st.last_cleanup_at < now() - interval '1 hour');
END
$function$;

CREATE FUNCTION private.aka_agent_journey_engine_release(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_token uuid := private.aka_agent_journey_engine_lease(p_payload);
  v_error text := CASE WHEN jsonb_typeof(p_payload -> 'error') = 'string' THEN left(p_payload ->> 'error', 1000) END;
BEGIN
  UPDATE public.auto_journey_engine_state
  SET lease_token = NULL, lease_until = NULL, last_run_at = now(),
      last_error = coalesce(v_error, last_error), last_error_at = CASE WHEN v_error IS NULL THEN last_error_at ELSE now() END,
      updated_at = now()
  WHERE id = 1 AND lease_token = v_token;
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Retention in small batches, at most once an hour. Events/step runs walk the oldest ids only.
CREATE FUNCTION private.aka_agent_journey_engine_cleanup(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_last timestamptz;
  v_events integer := 0;
  v_runs integer := 0;
  v_enrollments integer := 0;
BEGIN
  PERFORM private.aka_agent_journey_engine_lease(p_payload);
  SELECT last_cleanup_at INTO v_last FROM public.auto_journey_engine_state WHERE id = 1;
  IF v_last IS NOT NULL AND v_last > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('events', 0, 'runs', 0, 'enrollments', 0, 'skipped', true);
  END IF;
  WITH w AS (SELECT ev.id, ev.created_at FROM public.auto_journey_events ev ORDER BY ev.id LIMIT 5000),
  d AS (DELETE FROM public.auto_journey_events ev USING w WHERE ev.id = w.id AND w.created_at < now() - interval '90 days' RETURNING 1)
  SELECT count(*) INTO v_events FROM d;
  WITH w AS (SELECT r.id, r.status, r.settled_at FROM public.auto_journey_step_runs r ORDER BY r.id LIMIT 5000),
  d AS (DELETE FROM public.auto_journey_step_runs r USING w
        WHERE r.id = w.id AND w.status = 'settled' AND w.settled_at < now() - interval '90 days' RETURNING 1)
  SELECT count(*) INTO v_runs FROM d;
  WITH c AS (
    SELECT e.id FROM public.auto_journey_enrollments e
    WHERE e.status <> 'active' AND e.finished_at < now() - interval '180 days'
    ORDER BY e.finished_at LIMIT 500
  ), d AS (DELETE FROM public.auto_journey_enrollments e USING c WHERE e.id = c.id RETURNING 1)
  SELECT count(*) INTO v_enrollments FROM d;
  UPDATE public.auto_journey_engine_state SET last_cleanup_at = now(), updated_at = now() WHERE id = 1;
  RETURN jsonb_build_object('events', v_events, 'runs', v_runs, 'enrollments', v_enrollments);
END
$function$;

-- Next results of a campaign after the cursor, for the given statuses. The existing index is
-- (campaign_id, status, action_code, created_at DESC) WHERE is_delete = false, so each (status, action code)
-- pair is read as its own created_at range; distinct action codes come from a loose index scan.
CREATE FUNCTION private.aka_agent_journey_detail_page(p_campaign_id bigint, p_statuses text[], p_cursor_ts timestamptz,
  p_cursor_id bigint, p_limit integer, p_horizon timestamptz)
RETURNS TABLE(id bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_status text;
  v_code text;
  v_ts timestamptz := coalesce(p_cursor_ts, '-infinity'::timestamptz);
  v_id bigint := coalesce(p_cursor_id, 0);
  v_probes integer := 0;
BEGIN
  FOREACH v_status IN ARRAY coalesce(p_statuses, '{}'::text[]) LOOP
    RETURN QUERY
      SELECT d.id, d.created_at FROM public.auto_campaign_details d
      WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code IS NULL
        AND d.created_at >= v_ts AND d.created_at < p_horizon AND (d.created_at, d.id) > (v_ts, v_id)
      ORDER BY d.created_at, d.id
      LIMIT p_limit;
    v_code := NULL;
    LOOP
      v_probes := v_probes + 1;
      EXIT WHEN v_probes > 200;
      IF v_code IS NULL THEN
        SELECT min(d.action_code) INTO v_code FROM public.auto_campaign_details d
        WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code IS NOT NULL;
      ELSE
        SELECT min(d.action_code) INTO v_code FROM public.auto_campaign_details d
        WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code > v_code;
      END IF;
      EXIT WHEN v_code IS NULL;
      RETURN QUERY
        SELECT d.id, d.created_at FROM public.auto_campaign_details d
        WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code = v_code
          AND d.created_at >= v_ts AND d.created_at < p_horizon AND (d.created_at, d.id) > (v_ts, v_id)
        ORDER BY d.created_at, d.id
        LIMIT p_limit;
    END LOOP;
  END LOOP;
END
$function$;

-- Ingest: new customers by cursor; stop/mark sources first; ≤ budget rows in total, ≤ 500 per source.
CREATE FUNCTION private.aka_agent_journey_engine_ingest(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_budget integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'budget'), 1000), 1), 5000)::integer;
  v_left integer;
  -- Rows younger than this may belong to transactions that have not committed yet; read them next time.
  v_horizon timestamptz := now() - interval '3 minutes';
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_source_ids bigint[];
  v_source_id bigint;
  src public.auto_journey_sources%ROWTYPE;
  j public.auto_journeys%ROWTYPE;
  v_settings jsonb;
  v_reentry text;
  v_reentry_days integer;
  v_max_new bigint;
  v_stop_groups bigint[];
  v_day_count integer;
  v_day_start integer;
  v_limit integer;
  v_batch jsonb;
  v_fetched integer;
  v_rows integer;
  v_capped boolean;
  v_last_ts timestamptz;
  v_last_id bigint;
  v_source_name text;
  v_source_group_target boolean;
  r record;
  v_key text;
  v_candidate boolean;
  v_skip boolean;
  v_new_id bigint;
  v_n integer;
  v_exit_step text;
  v_scanned integer := 0;
  v_enrolled integer := 0;
  v_stopped integer := 0;
  v_marked integer := 0;
  v_skipped integer := 0;
  v_stats jsonb := '{}'::jsonb;
BEGIN
  PERFORM private.aka_agent_journey_engine_lease(p_payload);
  v_left := v_budget;
  v_source_ids := ARRAY(
    SELECT s.id FROM public.auto_journey_sources s
    JOIN public.auto_journeys jj ON jj.id = s.journey_id
    WHERE s.is_active AND jj.status = 'active' AND jj.is_delete = false
    ORDER BY CASE WHEN s.is_stop OR s.is_mark THEN 0 ELSE 1 END, s.last_scanned_at NULLS FIRST, s.id
    LIMIT 500);
  FOREACH v_source_id IN ARRAY v_source_ids LOOP
    EXIT WHEN v_left <= 0;
    -- A control action holding the journey (publish, pause…) wins; this source waits for the next tick.
    SELECT jj.* INTO j FROM public.auto_journeys jj
    WHERE jj.id = (SELECT s.journey_id FROM public.auto_journey_sources s WHERE s.id = v_source_id)
      AND jj.status = 'active' AND jj.is_delete = false
    FOR NO KEY UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO src FROM public.auto_journey_sources WHERE id = v_source_id AND is_active FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    SELECT v.settings INTO v_settings FROM public.auto_journey_versions v WHERE v.id = j.active_version_id;
    CONTINUE WHEN v_settings IS NULL;
    v_reentry := coalesce(v_settings -> 'reentry' ->> 'mode', 'never');
    v_reentry_days := least(greatest(coalesce(private.aka_agent_journey_bigint(v_settings -> 'reentry' -> 'days'), 30), 1), 3650)::integer;
    v_max_new := private.aka_agent_journey_bigint(v_settings -> 'maxNewPerDay');
    v_stop_groups := private.aka_agent_journey_bigint_array(v_settings -> 'stopGroupIds');
    v_day_count := CASE WHEN j.entry_day = v_today THEN j.entry_day_count ELSE 0 END;
    v_day_start := v_day_count;
    -- Daily cap already reached: the entry source waits for tomorrow without reading.
    IF src.is_entry AND v_max_new IS NOT NULL AND v_day_count >= v_max_new THEN
      UPDATE public.auto_journey_sources SET last_scanned_at = now() WHERE id = src.id;
      CONTINUE;
    END IF;
    v_limit := least(500, v_left);
    v_capped := false;
    v_rows := 0;
    v_last_ts := src.cursor_ts;
    v_last_id := src.cursor_id;

    IF src.kind = 'data_group' THEN
      SELECT g.name INTO v_source_name FROM public.auto_account_contact_groups g WHERE g.id = src.group_id;
      v_source_group_target := false;
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.row_ts, x.row_id), '[]'::jsonb) INTO v_batch
      FROM (
        SELECT m.updated_at AS row_ts, m.id AS row_id, m.id AS ref,
          private.aka_agent_journey_phone(coalesce(nullif(c.phone, ''), nullif(c.extra_data ->> 'phone', ''),
            CASE WHEN c.contact_type = 'phone' THEN c.uid END)) AS phone,
          CASE WHEN c.contact_type IN ('phone', 'email') THEN NULL ELSE nullif(btrim(c.uid), '') END AS uid,
          private.aka_agent_journey_email(coalesce(nullif(c.email, ''), nullif(c.extra_data ->> 'email', ''),
            CASE WHEN c.contact_type = 'email' THEN c.uid END)) AS email,
          c.name, c.extra_data ->> 'info1' AS info1, c.extra_data ->> 'info2' AS info2, c.extra_data ->> 'info3' AS info3,
          c.extra_data ->> 'info4' AS info4, c.extra_data ->> 'info5' AS info5,
          coalesce(c.extra_data ->> 'phone_carrier', c.extra_data ->> 'carrier') AS carrier,
          c.account_id, 'contact:' || c.id::text AS fallback_key,
          (c.is_delete IS TRUE OR c.organization_id IS DISTINCT FROM j.organization_id) AS invalid,
          NULL::text AS detail_status,
          -- Nhóm data có thể chứa nhóm/trang Facebook hoặc tag Zalo: không phải một người.
          coalesce(c.contact_type IN ('group', 'page', 'zalo_tag'), false) AS group_target
        FROM public.auto_account_contact_group_members m
        JOIN public.auto_account_contacts c ON c.id = m.contact_id
        WHERE m.group_id = src.group_id AND m.is_delete = false
          AND (m.updated_at, m.id) > (coalesce(src.cursor_ts, '-infinity'::timestamptz), src.cursor_id)
          AND m.updated_at < v_horizon
        ORDER BY m.updated_at, m.id
        LIMIT v_limit
      ) x;
    ELSE
      SELECT c.name, private.aka_agent_journey_non_person_action(c.action_id) INTO v_source_name, v_source_group_target
      FROM public.auto_campaigns c WHERE c.id = src.campaign_id;
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.row_ts, x.row_id), '[]'::jsonb) INTO v_batch
      FROM (
        SELECT p.created_at AS row_ts, p.id AS row_id, d.id AS ref,
          private.aka_agent_journey_phone(i.phone) AS phone, nullif(btrim(i.uid), '') AS uid,
          private.aka_agent_journey_email(i.email) AS email,
          i.name, i.info1, i.info2, i.info3, i.info4, i.info5, i.phone_carrier AS carrier,
          d.account_id, 'detail:' || d.id::text AS fallback_key, false AS invalid, d.status AS detail_status
        FROM private.aka_agent_journey_detail_page(src.campaign_id, src.statuses, src.cursor_ts, src.cursor_id, v_limit, v_horizon) p
        JOIN public.auto_campaign_details d ON d.id = p.id
        LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
        ORDER BY p.created_at, p.id
        LIMIT v_limit
      ) x;
    END IF;
    v_fetched := jsonb_array_length(v_batch);

    FOR r IN
      SELECT * FROM jsonb_to_recordset(v_batch) AS x(row_ts timestamptz, row_id bigint, ref bigint, phone text, uid text,
        email text, name text, info1 text, info2 text, info3 text, info4 text, info5 text, carrier text, account_id bigint,
        fallback_key text, invalid boolean, detail_status text, group_target boolean)
      ORDER BY x.row_ts, x.row_id
    LOOP
      v_key := private.aka_agent_journey_contact_key(r.phone, r.uid, r.account_id, r.email, r.fallback_key);
      v_candidate := NOT r.invalid AND src.is_entry AND NOT src.is_stop
        AND (src.entry_since IS NULL OR r.row_ts >= src.entry_since);
      v_skip := false;
      IF v_candidate THEN
        IF EXISTS (SELECT 1 FROM public.auto_journey_enrollments e
                   WHERE e.journey_id = j.id AND e.contact_key = v_key AND e.status = 'active') THEN
          v_skip := true;
        ELSIF v_reentry = 'never' AND EXISTS (SELECT 1 FROM public.auto_journey_enrollments e
                   WHERE e.journey_id = j.id AND e.contact_key = v_key AND NOT e.is_test) THEN
          v_skip := true;
        ELSIF v_reentry = 'after_days' AND EXISTS (SELECT 1 FROM public.auto_journey_enrollments e
                   WHERE e.journey_id = j.id AND e.contact_key = v_key AND NOT e.is_test
                     AND e.entered_at > now() - make_interval(days => v_reentry_days)) THEN
          v_skip := true;
        ELSIF r.phone IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs o
                   WHERE o.staff_id = j.staff_id AND o.organization_id = j.organization_id AND o.phone = r.phone
                     AND o.confirmed_at IS NOT NULL) THEN
          v_skip := true;
        ELSIF cardinality(v_stop_groups) > 0 AND EXISTS (SELECT 1 FROM public.auto_journey_marks mk
                   WHERE mk.journey_id = j.id AND mk.group_id = ANY(v_stop_groups) AND mk.contact_key = v_key) THEN
          v_skip := true;
        END IF;
        -- Daily cap: stop this source before the row so the cursor does not pass it.
        IF NOT v_skip AND v_max_new IS NOT NULL AND v_day_count >= v_max_new THEN
          v_capped := true;
          EXIT;
        END IF;
      END IF;
      v_rows := v_rows + 1;

      IF NOT r.invalid AND (src.is_stop OR src.is_mark) THEN
        INSERT INTO public.auto_journey_marks (journey_id, group_id, contact_key)
        VALUES (j.id, src.group_id, v_key) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_marked := v_marked + v_n;
      END IF;
      IF NOT r.invalid AND src.is_stop THEN
        WITH o AS (
          UPDATE public.auto_journey_enrollments e
          SET status = 'exited', exit_code = 'stop_group', exit_reason = 'Khách đã vào nhóm dừng quy trình.', finished_at = now(),
              next_run_at = NULL, paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL, pending_reason = NULL,
              lease_token = NULL, lease_until = NULL, updated_at = now()
          WHERE e.journey_id = j.id AND e.contact_key = v_key AND e.status = 'active'
          RETURNING e.id, e.step_id
        ), ev AS (
          INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message, data)
          SELECT j.id, o.id, o.step_id, 'exit', 'Khách đã vào nhóm dừng quy trình.', jsonb_build_object('groupId', src.group_id) FROM o
        )
        SELECT count(*), max(o.step_id) INTO v_n, v_exit_step FROM o;
        IF v_n > 0 THEN
          v_stopped := v_stopped + v_n;
          v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, v_exit_step, 'exited', v_n);
          v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'exited', v_n);
        END IF;
      END IF;

      IF v_candidate THEN
        v_new_id := NULL;
        IF NOT v_skip THEN
          INSERT INTO public.auto_journey_enrollments (journey_id, version_id, staff_id, organization_id, contact_key, contact,
            source_kind, source_ref, source_group_id, source_campaign_id, status, phase, next_run_at)
          VALUES (j.id, j.active_version_id, j.staff_id, j.organization_id, v_key,
            private.aka_agent_journey_contact(r.name, r.phone, r.uid, r.email, r.info1, r.info2, r.info3, r.info4, r.info5,
              r.carrier, r.account_id)
              || CASE WHEN v_source_group_target IS TRUE OR r.group_target IS TRUE THEN '{"targetKind":"group"}'::jsonb ELSE '{}'::jsonb END,
            src.kind, r.ref, src.group_id, src.campaign_id, 'active', 'ready', now())
          ON CONFLICT (journey_id, contact_key) WHERE status = 'active' DO NOTHING
          RETURNING id INTO v_new_id;
        END IF;
        IF v_new_id IS NULL THEN
          v_skipped := v_skipped + 1;
        ELSE
          v_enrolled := v_enrolled + 1;
          v_day_count := v_day_count + 1;
          v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'enrolled', 1);
          INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message, data)
          VALUES (j.id, v_new_id, NULL, 'enter',
            CASE WHEN src.kind = 'data_group'
              THEN format('Khách vào quy trình từ nhóm data "%s".', coalesce(v_source_name, src.group_id::text))
              ELSE format('Khách vào quy trình từ kết quả "%s" của chiến dịch "%s".', r.detail_status,
                coalesce(v_source_name, src.campaign_id::text)) END,
            jsonb_strip_nulls(jsonb_build_object('sourceKind', src.kind, 'groupId', src.group_id, 'campaignId', src.campaign_id,
              'ref', r.ref)));
        END IF;
      END IF;
      v_last_ts := r.row_ts;
      v_last_id := r.row_id;
    END LOOP;

    UPDATE public.auto_journey_sources
    SET cursor_ts = v_last_ts, cursor_id = coalesce(v_last_id, 0), last_scanned_at = now(),
        seeded_at = CASE WHEN seeded_at IS NULL AND NOT v_capped AND v_fetched < v_limit THEN now() ELSE seeded_at END,
        updated_at = now()
    WHERE id = src.id;
    IF v_day_count <> v_day_start OR j.entry_day IS DISTINCT FROM v_today THEN
      UPDATE public.auto_journeys SET entry_day = v_today, entry_day_count = v_day_count WHERE id = j.id;
    END IF;
    v_scanned := v_scanned + v_rows;
    v_left := v_left - greatest(v_rows, CASE WHEN v_capped THEN 0 ELSE v_fetched END);
  END LOOP;
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('scanned', v_scanned, 'enrolled', v_enrolled, 'stopped', v_stopped, 'marked', v_marked,
    'skipped', v_skipped);
END
$function$;

-- Collect: classify due step runs from the input row and its result rows (same lists as journey-core
-- RESULT_STATUS_GROUPS / AUXILIARY_ACTION_CODES), wake the customer, reopen finished campaigns that still hold
-- a queued row.
CREATE FUNCTION private.aka_agent_journey_engine_collect(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 500), 1), 1000)::integer;
  v_ok text[] := ARRAY['thành công', 'đã gửi', 'đã gửi lời mời', 'đã gửi lời mời kết bạn', 'đã gửi tin nhắn', 'đã là bạn bè',
    'đã là thành viên', 'đã nhận', 'đã tham gia', 'đã xem', 'đã click', 'đã duyệt bài', 'chờ duyệt bài'];
  v_no_zalo text[] := ARRAY['không tồn tại'];
  v_rejected text[] := ARRAY['thất bại'];
  v_aux text[] := ARRAY['zalo_find_phone_user', 'zalo_tag_contact', 'zalo_change_alias'];
  sr public.auto_journey_step_runs%ROWTYPE;
  v_in_id bigint;
  v_in_status text;
  v_in_note text;
  v_in_uid text;
  v_in_deleted boolean;
  v_n bigint;
  v_has_no_zalo boolean;
  v_has_ok boolean;
  v_ok_status text;
  v_has_rejected boolean;
  v_outcome text;
  v_reason text;
  v_uid text;
  v_delay interval;
  v_e_id bigint;
  v_e_status text;
  v_e_phase text;
  v_e_step text;
  v_e_lease timestamptz;
  v_journey_status text;
  v_campaign_status text;
  v_reopen bigint[] := '{}';
  v_campaign bigint;
  v_checked integer := 0;
  v_settled integer := 0;
  v_reopened integer := 0;
BEGIN
  PERFORM private.aka_agent_journey_engine_lease(p_payload);
  FOR sr IN
    SELECT r.* FROM public.auto_journey_step_runs r
    WHERE r.status = 'dispatched' AND r.next_check_at <= now()
    ORDER BY r.next_check_at, r.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_checked := v_checked + 1;
    v_outcome := NULL;
    v_reason := NULL;
    v_in_id := NULL; v_in_status := NULL; v_in_note := NULL; v_in_uid := NULL; v_in_deleted := NULL;
    SELECT i.id, i.status, i.note, i.uid, i.is_delete INTO v_in_id, v_in_status, v_in_note, v_in_uid, v_in_deleted
    FROM public.auto_campaign_input_data i WHERE i.id = sr.input_data_id;
    SELECT count(*),
      coalesce(bool_or(d.status = ANY(v_no_zalo)), false),
      coalesce(bool_or(d.status = ANY(v_ok) AND NOT (coalesce(d.action_code, '') = ANY(v_aux))), false),
      (array_agg(d.status ORDER BY d.created_at, d.id) FILTER (WHERE d.status = ANY(v_ok) AND NOT (coalesce(d.action_code, '') = ANY(v_aux))))[1],
      coalesce(bool_or(d.status = ANY(v_rejected) AND NOT (coalesce(d.action_code, '') = ANY(v_aux))), false)
    INTO v_n, v_has_no_zalo, v_has_ok, v_ok_status, v_has_rejected
    FROM public.auto_campaign_details d
    WHERE d.input_data_id = sr.input_data_id AND d.is_delete = false;

    IF v_has_no_zalo THEN
      v_outcome := 'no_zalo';
    ELSIF v_has_ok THEN
      v_outcome := 'ok';
      v_reason := CASE WHEN v_ok_status = 'thành công' THEN NULL ELSE v_ok_status END;
    ELSIF v_has_rejected THEN
      v_outcome := 'rejected';
    ELSIF v_in_id IS NULL OR v_in_deleted IS TRUE THEN
      v_outcome := 'failed';
      v_reason := 'Khách đã bị xóa khỏi chiến dịch';
    ELSIF v_in_status = 'hoàn thành' THEN
      v_outcome := 'failed';
      v_reason := coalesce(private.aka_agent_journey_short(v_in_note), 'Chiến dịch kết thúc mà không gửi được');
    ELSIF v_in_status = 'tạm dừng' AND v_n > 0 THEN
      v_outcome := 'failed';
      v_reason := coalesce(private.aka_agent_journey_short(v_in_note), 'Chiến dịch tạm dừng khách này sau lần chạy');
    ELSIF now() >= sr.deadline_at THEN
      v_outcome := 'failed';
      v_reason := 'Quá hạn chờ kết quả';
    END IF;

    IF v_outcome IS NULL THEN
      IF v_in_status = 'chờ xử lý' AND NOT (sr.campaign_id = ANY(v_reopen)) THEN
        SELECT c.status INTO v_campaign_status FROM public.auto_campaigns c WHERE c.id = sr.campaign_id AND c.is_delete IS NOT TRUE;
        IF v_campaign_status = 'hoàn thành' THEN
          v_reopen := v_reopen || sr.campaign_id;
        END IF;
      END IF;
      v_delay := CASE sr.check_count WHEN 0 THEN interval '2 minutes' WHEN 1 THEN interval '5 minutes' ELSE interval '10 minutes' END;
      UPDATE public.auto_journey_step_runs
      SET check_count = check_count + 1, next_check_at = least(now() + v_delay, deadline_at)
      WHERE id = sr.id;
      CONTINUE;
    END IF;

    -- A customer still leased by a claim keeps its run open until the lease ends (its result must not be overwritten).
    v_e_id := NULL;
    SELECT e.id, e.status, e.phase, e.step_id, e.lease_until, j.status
    INTO v_e_id, v_e_status, v_e_phase, v_e_step, v_e_lease, v_journey_status
    FROM public.auto_journey_enrollments e
    JOIN public.auto_journeys j ON j.id = e.journey_id
    WHERE e.id = sr.enrollment_id
    FOR UPDATE OF e SKIP LOCKED;
    IF v_e_id IS NULL THEN
      UPDATE public.auto_journey_step_runs SET next_check_at = now() + interval '15 seconds' WHERE id = sr.id;
      CONTINUE;
    END IF;
    IF v_e_status = 'active' AND v_e_lease IS NOT NULL AND v_e_lease > now() THEN
      UPDATE public.auto_journey_step_runs SET next_check_at = v_e_lease + interval '5 seconds' WHERE id = sr.id;
      CONTINUE;
    END IF;
    UPDATE public.auto_journey_step_runs
    SET status = 'settled', outcome = v_outcome, reason = v_reason, settled_at = now(), next_check_at = NULL,
        check_count = check_count + 1
    WHERE id = sr.id;
    v_settled := v_settled + 1;
    IF v_e_status = 'active' AND v_e_phase = 'awaiting' AND v_e_step = sr.step_id THEN
      v_uid := CASE WHEN sr.action_code LIKE 'zalo%' AND v_outcome <> 'no_zalo' THEN left(nullif(btrim(coalesce(v_in_uid, '')), ''), 500) END;
      UPDATE public.auto_journey_enrollments
      SET phase = 'result', pending_outcome = v_outcome, pending_reason = v_reason,
          next_run_at = CASE WHEN v_journey_status = 'active' THEN now() ELSE NULL END,
          paused_next_run_at = CASE WHEN v_journey_status = 'active' THEN NULL ELSE now() END,
          zalo_uids = CASE WHEN v_uid IS NULL THEN zalo_uids ELSE zalo_uids || jsonb_build_object(sr.account_id::text, v_uid) END,
          lease_token = NULL, lease_until = NULL, updated_at = now()
      WHERE id = v_e_id;
    END IF;
  END LOOP;

  FOR v_campaign IN SELECT DISTINCT x FROM unnest(v_reopen) x ORDER BY x LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign);
    SELECT c.status INTO v_campaign_status FROM public.auto_campaigns c
    WHERE c.id = v_campaign AND c.is_delete IS NOT TRUE FOR UPDATE;
    IF v_campaign_status = 'hoàn thành' THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now(), updated_at = now() WHERE id = v_campaign;
      v_reopened := v_reopened + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('checked', v_checked, 'settled', v_settled, 'reopened', v_reopened);
END
$function$;

-- Claim: due customers of running journeys, leased for 120 s, plus every fact the engine needs.
CREATE FUNCTION private.aka_agent_journey_engine_claim(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_token uuid := private.aka_agent_journey_engine_lease(p_payload);
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 300), 1), 500)::integer;
  v_ids bigint[];
  v_day_start timestamptz := private.aka_agent_journey_vn_day_start();
  v_out jsonb;
BEGIN
  WITH c AS (
    SELECT e.id FROM public.auto_journey_enrollments e
    JOIN public.auto_journeys j ON j.id = e.journey_id
    WHERE e.status = 'active' AND e.next_run_at IS NOT NULL AND e.next_run_at <= now()
      AND (e.lease_until IS NULL OR e.lease_until <= now())
      AND j.status = 'active' AND j.is_delete = false
    ORDER BY e.next_run_at
    LIMIT v_limit
    FOR UPDATE OF e SKIP LOCKED
  ), u AS (
    UPDATE public.auto_journey_enrollments e
    SET lease_token = v_token, lease_until = now() + interval '120 seconds'
    FROM c WHERE e.id = c.id
    RETURNING e.id
  )
  SELECT coalesce(array_agg(u.id), '{}'::bigint[]) INTO v_ids FROM u;

  WITH e AS MATERIALIZED (
    SELECT * FROM public.auto_journey_enrollments WHERE id = ANY(v_ids)
  ), v AS MATERIALIZED (
    SELECT ver.* FROM public.auto_journey_versions ver WHERE ver.id IN (SELECT DISTINCT e.version_id FROM e)
  ), vr AS MATERIALIZED (
    SELECT v.id AS version_id, v.journey_id, rf.kind, rf.ref_id
    FROM v CROSS JOIN LATERAL private.aka_agent_journey_graph_refs(v.graph) rf
  ), vg AS MATERIALIZED (
    SELECT v.id AS version_id,
      private.aka_agent_journey_bigint_array(v.settings -> 'stopGroupIds') AS stop_groups,
      ARRAY(SELECT DISTINCT vr.ref_id FROM vr WHERE vr.version_id = v.id AND vr.kind = 'condition_group') AS cond_groups
    FROM v
  ), jr AS MATERIALIZED (
    SELECT DISTINCT e.journey_id, e.staff_id, e.organization_id FROM e
  ), sc AS MATERIALIZED (
    SELECT s.journey_id, s.step_id, s.account_id, s.action_code, s.campaign_id, s.config_hash,
      c.status AS campaign_status, (c.id IS NULL OR c.is_delete IS TRUE) AS campaign_deleted, c.action_id,
      c.content, c.schedule, c.original_schedule, c.extra_settings
    FROM public.auto_journey_step_campaigns s
    LEFT JOIN public.auto_campaigns c ON c.id = s.campaign_id
    WHERE s.journey_id IN (SELECT jr.journey_id FROM jr) AND s.is_active
  ), uc AS MATERIALIZED (
    SELECT DISTINCT ON (c.id) c.id, c.account_id, c.action_id, c.status, c.is_delete, c.content, c.schedule,
      c.original_schedule, c.extra_settings
    FROM vr
    JOIN jr ON jr.journey_id = vr.journey_id
    JOIN public.auto_campaigns c ON c.id = vr.ref_id AND c.staff_id = jr.staff_id AND c.organization_id = jr.organization_id
    WHERE vr.kind = 'campaign'
    ORDER BY c.id
  ), acc AS MATERIALIZED (
    SELECT DISTINCT x.id FROM (
      SELECT vr.ref_id AS id FROM vr WHERE vr.kind = 'account'
      UNION ALL SELECT e.sticky_account_id FROM e
      UNION ALL SELECT private.aka_agent_journey_bigint(e.contact -> 'accountId') FROM e
      UNION ALL SELECT uc.account_id FROM uc
      UNION ALL SELECT sc.account_id FROM sc
    ) x WHERE x.id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'enrollments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'journeyId', e.journey_id, 'versionId', e.version_id,
        'staffId', e.staff_id, 'organizationId', e.organization_id, 'contactKey', e.contact_key, 'contact', e.contact,
        'stepId', e.step_id, 'phase', e.phase, 'pendingOutcome', e.pending_outcome, 'pendingReason', e.pending_reason,
        'stickyAccountId', e.sticky_account_id, 'zaloUids', e.zalo_uids, 'zaloStatus', e.zalo_status, 'attempts', e.attempts,
        'deferCode', e.defer_code, 'stepEnteredAt', e.step_entered_at, 'isTest', e.is_test) ORDER BY e.next_run_at, e.id), '[]'::jsonb) FROM e),
    'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'journeyId', v.journey_id, 'graph', v.graph,
        'settings', v.settings) ORDER BY v.id), '[]'::jsonb) FROM v),
    'facts', (SELECT coalesce(jsonb_object_agg(e.id::text, jsonb_build_object(
        'optedOut', EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs o
          WHERE o.staff_id = e.staff_id AND o.organization_id = e.organization_id
            AND o.phone = private.aka_agent_journey_phone(e.contact ->> 'phone') AND o.confirmed_at IS NOT NULL),
        'stopMarked', EXISTS (SELECT 1 FROM public.auto_journey_marks mk
          WHERE mk.journey_id = e.journey_id AND mk.group_id = ANY(vg.stop_groups)
            AND mk.contact_key = regexp_replace(e.contact_key, '^test:', '')),
        'groupMarks', coalesce((SELECT jsonb_agg(mk.group_id ORDER BY mk.group_id) FROM public.auto_journey_marks mk
          WHERE mk.journey_id = e.journey_id AND mk.group_id = ANY(vg.cond_groups)
            AND mk.contact_key = regexp_replace(e.contact_key, '^test:', '')), '[]'::jsonb),
        'recentSendTimes', coalesce((SELECT jsonb_agg(to_jsonb(r.dispatched_at) ORDER BY r.dispatched_at)
          FROM public.auto_journey_step_runs r
          WHERE r.staff_id = e.staff_id AND r.contact_key = e.contact_key AND r.dispatched_at > now() - interval '24 hours'
            -- Only sends that may have reached the customer count toward the daily cap (a "no Zalo" attempt must not
            -- block the SMS fallback for 24 hours).
            AND (r.status = 'dispatched' OR r.outcome = 'ok')),
          '[]'::jsonb))), '{}'::jsonb)
      FROM e JOIN vg ON vg.version_id = e.version_id),
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.flatform_type,
        'usable', private.aka_agent_journey_account_ready(a.flatform_type, a.login_status, a.mobile_device_id, a.is_delete, a.is_active, a.status),
        'isServer', coalesce(a.is_zalo_server, false),
        'dispatchedToday', (SELECT count(*) FROM public.auto_journey_step_runs r
          WHERE r.account_id = a.id AND r.dispatched_at >= v_day_start)) ORDER BY a.id), '[]'::jsonb)
      FROM public.auto_accounts a WHERE a.id IN (SELECT acc.id FROM acc)),
    'stepCampaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('journeyId', sc.journey_id, 'stepId', sc.step_id,
        'accountId', sc.account_id, 'actionCode', sc.action_code, 'campaignId', sc.campaign_id, 'configHash', sc.config_hash,
        'status', sc.campaign_status, 'deleted', sc.campaign_deleted)
      ORDER BY sc.journey_id, sc.step_id, sc.account_id, sc.campaign_id), '[]'::jsonb) FROM sc),
    'userCampaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', uc.id, 'accountId', uc.account_id,
        'actionCode', uc.action_id, 'status', uc.status, 'deleted', uc.is_delete IS TRUE) ORDER BY uc.id), '[]'::jsonb) FROM uc),
    'smsCampaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'content', x.content, 'schedule', x.schedule,
        'originalSchedule', x.original_schedule, 'extraSettings', coalesce(x.extra_settings, '{}'::jsonb)) ORDER BY x.id), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (y.id) y.* FROM (
          SELECT sc.campaign_id AS id, sc.content, sc.schedule, sc.original_schedule, sc.extra_settings
          FROM sc WHERE sc.action_id IN ('sms_send', 'voice_call') AND NOT sc.campaign_deleted
          UNION ALL
          SELECT uc.id, uc.content, uc.schedule, uc.original_schedule, uc.extra_settings
          FROM uc WHERE uc.action_id IN ('sms_send', 'voice_call') AND uc.is_delete IS NOT TRUE
        ) y ORDER BY y.id
      ) x)
  ) INTO v_out;
  RETURN v_out;
END
$function$;

-- Row for aka_agent_ingest_data_group: phone contact, else (account, UID) person, else email.
CREATE FUNCTION private.aka_agent_journey_group_row(p_contact jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT CASE
    WHEN nullif(p_contact ->> 'phone', '') IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
      'contact_type', 'phone', 'uid', p_contact ->> 'phone', 'phone', p_contact ->> 'phone', 'name', p_contact ->> 'name',
      'email', p_contact ->> 'email', 'info1', p_contact ->> 'info1', 'info2', p_contact ->> 'info2', 'info3', p_contact ->> 'info3',
      'info4', p_contact ->> 'info4', 'info5', p_contact ->> 'info5'))
    WHEN nullif(btrim(coalesce(p_contact ->> 'uid', '')), '') IS NOT NULL
      AND private.aka_agent_journey_bigint(p_contact -> 'accountId') IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
      'contact_type', 'person', 'uid', btrim(p_contact ->> 'uid'),
      'source_account_id', private.aka_agent_journey_bigint(p_contact -> 'accountId'), 'name', p_contact ->> 'name',
      'email', p_contact ->> 'email', 'info1', p_contact ->> 'info1', 'info2', p_contact ->> 'info2', 'info3', p_contact ->> 'info3',
      'info4', p_contact ->> 'info4', 'info5', p_contact ->> 'info5'))
    WHEN nullif(p_contact ->> 'email', '') IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
      'contact_type', 'email', 'uid', p_contact ->> 'email', 'email', p_contact ->> 'email', 'name', p_contact ->> 'name',
      'info1', p_contact ->> 'info1', 'info2', p_contact ->> 'info2', 'info3', p_contact ->> 'info3',
      'info4', p_contact ->> 'info4', 'info5', p_contact ->> 'info5'))
  END
$function$;

-- Active memberships of a group whose contact matches the customer key. Fast path: the member the customer
-- entered from; then indexed lookups by (account_id, contact_type, uid) or contact id; last, the 2.000 most
-- recently updated members of the group compared by computed key.
CREATE FUNCTION private.aka_agent_journey_group_members(p_staff_id bigint, p_organization_id bigint, p_group_id bigint,
  p_contact_key text, p_contact jsonb, p_source_group_id bigint, p_source_ref bigint)
RETURNS bigint[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_key text := regexp_replace(coalesce(p_contact_key, ''), '^test:', '');
  v_ids bigint[];
  v_value text;
  v_account bigint;
  v_uid text := btrim(coalesce(p_contact ->> 'uid', ''));
BEGIN
  IF p_source_group_id = p_group_id AND p_source_ref IS NOT NULL THEN
    SELECT array_agg(m.id) INTO v_ids FROM public.auto_account_contact_group_members m
    WHERE m.id = p_source_ref AND m.group_id = p_group_id AND m.is_delete = false;
    IF coalesce(cardinality(v_ids), 0) > 0 THEN
      RETURN v_ids;
    END IF;
  END IF;
  IF v_key LIKE 'phone:%' OR v_key LIKE 'email:%' THEN
    v_value := substr(v_key, 7);
    SELECT array_agg(DISTINCT m.id) INTO v_ids
    FROM public.auto_account_contacts c
    JOIN public.auto_account_contact_group_members m ON m.contact_id = c.id AND m.group_id = p_group_id AND m.is_delete = false
    WHERE c.account_id IS NULL AND c.contact_type = CASE WHEN v_key LIKE 'phone:%' THEN 'phone' ELSE 'email' END
      AND c.uid = v_value AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id;
  ELSIF v_key LIKE 'zalo:%' AND split_part(v_key, ':', 2) ~ '^[0-9]{1,18}$' THEN
    v_account := split_part(v_key, ':', 2)::bigint;
    v_value := substr(v_key, length('zalo:' || split_part(v_key, ':', 2) || ':') + 1);
    SELECT array_agg(DISTINCT m.id) INTO v_ids
    FROM public.auto_account_contacts c
    JOIN public.auto_account_contact_group_members m ON m.contact_id = c.id AND m.group_id = p_group_id AND m.is_delete = false
    WHERE c.account_id = v_account AND c.contact_type IN ('person', 'group', 'page', 'page_inbox_customer', 'zalo_tag', 'campaign_input')
      AND c.uid IN (v_value, v_uid);
  ELSIF v_key ~ '^contact:[0-9]{1,18}$' THEN
    SELECT array_agg(m.id) INTO v_ids FROM public.auto_account_contact_group_members m
    WHERE m.group_id = p_group_id AND m.contact_id = substr(v_key, 9)::bigint AND m.is_delete = false;
  END IF;
  IF coalesce(cardinality(v_ids), 0) > 0 THEN
    RETURN v_ids;
  END IF;
  SELECT array_agg(x.id) INTO v_ids FROM (
    SELECT m.id, private.aka_agent_journey_contact_key(
      private.aka_agent_journey_phone(coalesce(nullif(c.phone, ''), nullif(c.extra_data ->> 'phone', ''),
        CASE WHEN c.contact_type = 'phone' THEN c.uid END)),
      CASE WHEN c.contact_type IN ('phone', 'email') THEN NULL ELSE nullif(btrim(c.uid), '') END,
      c.account_id,
      private.aka_agent_journey_email(coalesce(nullif(c.email, ''), nullif(c.extra_data ->> 'email', ''),
        CASE WHEN c.contact_type = 'email' THEN c.uid END)),
      'contact:' || c.id::text) AS k
    FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts c ON c.id = m.contact_id
    WHERE m.group_id = p_group_id AND m.is_delete = false
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT 2000
  ) x WHERE x.k = v_key;
  RETURN coalesce(v_ids, '{}'::bigint[]);
END
$function$;

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
