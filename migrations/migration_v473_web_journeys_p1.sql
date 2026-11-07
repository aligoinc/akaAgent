-- V473 phần 1/4: Quy trình tự động trên Web (bảng, cài đặt, hàm dùng chung), production cgjbsmqtfhqvttudyjzq only.
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
-- Tách 4 phần, mỗi phần một giao dịch (cả V473 ~154 KB vượt sức một lần gửi của công cụ apply): p1 bảng/cài đặt/hàm
-- dùng chung, p2 hàm điều khiển của route Web, p3 bộ máy (nhận/thu/giao khách), p4 ghi kết quả + hai RPC public + khóa
-- quyền + kiểm tra cuối. Apply đúng thứ tự p1 → p2 → p3 → p4: phần sau kiểm phần trước đã xong, phần đã chạy thì từ chối
-- chạy lại. Schema private cấp USAGE cho anon/authenticated/aka_agent_desktop/aka_agent_chat_api nên mỗi phần khóa
-- EXECUTE của mọi hàm private.aka_agent_journey_* ngay trong giao dịch của nó; hai RPC public chỉ có ở p4. Thân bốn phần
-- ghép lại đúng từng byte bản một file đã kiểm thử; khung BEGIN/COMMIT, chặn đầu p2–p4 và khóa quyền p1–p3 là phần thêm.
-- Rollback (gỡ cả bốn phần, chạy được cả khi mới apply một phần): migrations/rollback_v473_web_journeys.sql
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

-- Khóa quyền ngay trong phần này (schema private có USAGE cho các role API): mọi hàm private.aka_agent_journey_*
-- thuộc postgres, không ai khác EXECUTE. p4 chạy lại bước này cho mọi hàm rồi mới cấp hai RPC public cho service_role.
DO $lockdown_p1$
DECLARE
  v_fn regprocedure;
  v_role text;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role);
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%'
      AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'))
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'aka\_agent\_journey\_%'
  ) THEN
    RAISE EXCEPTION 'v473_p1_function_acl_unexpected';
  END IF;
END
$lockdown_p1$;

COMMIT;
