-- Đồng bộ trạng thái tin nhắn Zalo cho tài khoản KHÔNG có akaChat: đã nhận, đã xem, đã tương tác, đã phản hồi.
--
-- KHÔNG apply khi chưa được chủ hệ thống duyệt. File này có ở hai repo, giống nhau từng byte (so md5 trước khi apply):
--   akaAgentWebApp scripts/sql/zalo-message-status-sync/migration_zalo_message_status_sync.sql   (nơi chạy bộ kiểm)
--   akaAgent       migrations/migration_v525_zalo_message_status_sync.sql                         (nơi giữ migration)
-- Ba file đi cùng, cũng có ở cả hai repo: rollback_zalo_message_status_sync.sql = rollback_v525_zalo_message_status_sync.sql;
-- catalog_zalo_message_status_statuses.sql = migration_v526_zalo_message_status_statuses.sql;
-- catalog_rollback_zalo_message_status_statuses.sql = rollback_v526_zalo_message_status_statuses.sql.
-- Số 525 / 526 (13/11/2026). Ban đầu giữ 522 / 523, nhưng sổ production nhận một migration_v522 khác lúc 22:23 VN và 524 cũng
-- đã dùng, nên đổi số trước khi merge; lúc đổi, số lớn nhất trong sổ và trên mọi nhánh akaAgent là 524. Trước khi apply phải
-- kiểm lại sổ migration của DB xem hai số này còn trống.
-- Apply ngoài giờ cao điểm: lệnh CREATE TRIGGER (lệnh cuối cùng) cần khoá ngắn trên auto_campaign_details; không lấy được
-- trong 2 giây thì cả migration bỏ cuộc và không để lại gì, chạy lại là được.
--
-- Độc lập với theo dõi tương tác V339/V341: không đọc, không ghi zalo.campaign_engagement.*, zaloEngagementSource,
-- zaloEngagementPending, auto_campaign_detail_zalo_engagement hay bảng chat_zalo_* nào.
-- Ngoài bảng riêng, tính năng ghi MỘT cột của bảng sẵn có: auto_campaign_details.sub_status_id (trạng thái phụ của kết quả).
-- Việc ghi đi qua đúng cơ chế quản lý trạng thái của hệ thống (akaAgent V495): bảng quy tắc auto_status_event_rules (loại sự
-- kiện 'zalo.delivered' / 'zalo.seen' / 'zalo.reaction' / 'zalo.reply' → trạng thái trong auto_status) và hàm
-- aka_agent_engine_apply_status_event_v1, như email "đã mở / đã click" và SMS "đã nhận". Migration này KHÔNG thêm quy tắc
-- nào: chưa có quy tắc 'zalo.*' thì không cột trạng thái nào bị đổi (xem catalog_zalo_message_status_statuses.sql).
-- Tắt riêng phần này bằng zalo.message_status_sync.update_result_status = 'false'.
-- Mọi công tắc mặc định tắt: apply xong không đổi hành vi nào cho tới khi zalo.message_status_sync.enabled = 'true'
-- VÀ runtime bắt đầu ghi khoá zaloStatusRef vào auto_campaign_details.data.
--
-- Kiểm chứng cục bộ: scripts/test-zalo-message-status-sql.sh. Gỡ bỏ: rollback_zalo_message_status_sync.sql.
-- Phương án và hợp đồng: docs/ZALO_MESSAGE_STATUS_SYNC_PLAN.md, docs/ZALO_MESSAGE_STATUS_SYNC.md.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Kiểm tra trước: không ghi đè, không chạy khi thiếu đối tượng nguồn
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing text;
BEGIN
  -- Sổ migration của DB (không có ở DB dựng để kiểm): số 525 đã được một migration khác dùng thì dừng, phải đổi số trước.
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\_v525\_%') THEN
      RAISE EXCEPTION 'zalo_message_status_sync_migration_number_525_already_in_ledger';
    END IF;
  END IF;
  IF to_regclass('public.auto_zalo_message_status') IS NOT NULL
     OR to_regclass('private.auto_zalo_status_events') IS NOT NULL
     OR to_regprocedure('public.aka_agent_ingest_zalo_message_status(text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_desktop_ingest_zalo_message_status(jsonb)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_zalo_status_register' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'zalo_message_status_sync_target_already_exists_do_not_overwrite';
  END IF;
  -- Migration không tạo schema (file gỡ bỏ chỉ xoá đúng những gì migration đã tạo). Kiểm trước danh sách hàm, vì một hàm
  -- cần có nằm trong schema này.
  IF to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'zalo_message_status_sync_expected_schema_missing: private';
  END IF;
  SELECT string_agg(need.fn, ', ' ORDER BY need.fn) INTO v_missing
  FROM (VALUES ('public.aka_agent_app_access_account_allowed(bigint,text)'),
               ('public.aka_agent_app_access_chat_runtime(bigint,boolean)'),
               ('public.aka_agent_engine_apply_status_event_v1(bigint,text)'),
               ('public.aka_agent_status_semantics(bigint)'),
               -- Phiên đăng nhập của app Desktop (akaAgent V436): hàm nhận lô của Desktop lấy nhân viên từ đây.
               ('private.aka_agent_desktop_data_context()')) AS need(fn)
  WHERE to_regprocedure(need.fn) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'zalo_message_status_sync_expected_function_missing: %', v_missing;
  END IF;
  -- Migration không ghi đè dòng cấu hình có sẵn, để file gỡ bỏ xoá đúng những gì migration đã tạo.
  IF EXISTS (SELECT 1 FROM public.auto_system_settings s WHERE s.key LIKE 'zalo.message\_status\_sync.%') THEN
    RAISE EXCEPTION 'zalo_message_status_sync_settings_already_exist_do_not_overwrite';
  END IF;
  SELECT string_agg(need.tbl || '.' || need.col, ', ' ORDER BY need.tbl, need.col) INTO v_missing
  FROM (VALUES
    ('auto_campaign_details', 'id'), ('auto_campaign_details', 'campaign_id'), ('auto_campaign_details', 'account_id'),
    ('auto_campaign_details', 'data'), ('auto_campaign_details', 'created_at'), ('auto_campaign_details', 'is_delete'),
    ('auto_campaign_details', 'status_id'), ('auto_campaign_details', 'sub_status_id'), ('auto_campaign_details', 'report_group'),
    ('auto_campaign_details', 'action_code'),
    ('auto_status', 'id'), ('auto_status', 'code'), ('auto_status', 'name'), ('auto_status', 'is_active'),
    ('auto_status_event_rules', 'event_kind'), ('auto_status_event_rules', 'action_code'),
    ('auto_status_event_rules', 'status_id'), ('auto_status_event_rules', 'is_active'),
    ('org_staff', 'id'), ('org_staff', 'organization_id'),
    ('auto_accounts', 'id'), ('auto_accounts', 'staff_id'), ('auto_accounts', 'organization_id'),
    ('auto_accounts', 'flatform_type'), ('auto_accounts', 'is_zalo_show_web'), ('auto_accounts', 'is_delete'),
    ('auto_system_settings', 'key'), ('auto_system_settings', 'value'), ('auto_system_settings', 'is_active'),
    ('auto_system_settings', 'is_secret')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.' || need.tbl) AND a.attname = need.col AND a.attnum > 0 AND NOT a.attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'zalo_message_status_sync_expected_column_missing: %', v_missing;
  END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
      WHERE a.attrelid = 'public.auto_campaign_details'::regclass AND a.attname = 'data') <> 'jsonb' THEN
    RAISE EXCEPTION 'zalo_message_status_sync_expected_jsonb: auto_campaign_details.data';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- Bảng
-- ---------------------------------------------------------------------------

-- Kết quả: một dòng cho mỗi lượt gửi được theo dõi. Bảng riêng của tính năng; API đọc bằng service_role.
-- Ba mốc khớp theo mã tin (delivered/seen/reacted) không có hạn. reply_until là hạn tính "đã phản hồi".
CREATE TABLE public.auto_zalo_message_status (
  campaign_detail_id bigint PRIMARY KEY,
  campaign_id bigint NOT NULL,
  organization_id bigint,
  staff_id bigint,
  account_id bigint NOT NULL,
  account_zalo_uid text NOT NULL,
  target_zalo_uid text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('message', 'friend_request')),
  message_ids text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz NOT NULL,
  reply_until timestamptz NOT NULL,
  delivered_at timestamptz,
  seen_at timestamptz,
  reacted_at timestamptz,
  responded_at timestamptz,
  friended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
) WITH (fillfactor = 85);
COMMENT ON TABLE public.auto_zalo_message_status IS
  'Đồng bộ trạng thái tin nhắn Zalo (tài khoản không có akaChat). Không lưu nội dung tin.';
-- Mọi sự kiện 1-1 đều mang (tài khoản, người kia): đây là chỉ mục duy nhất dùng để khớp.
-- Các cột mốc thời gian không nằm trong chỉ mục nào: ghi một mốc là cập nhật tại chỗ (HOT), không thêm mục chỉ mục.
CREATE INDEX idx_auto_zalo_message_status_match
  ON public.auto_zalo_message_status (account_id, target_zalo_uid, sent_at DESC);
CREATE INDEX idx_auto_zalo_message_status_campaign
  ON public.auto_zalo_message_status (campaign_id);
ALTER TABLE public.auto_zalo_message_status ENABLE ROW LEVEL SECURITY;

-- Hàng chờ đưa bậc trạng thái vào cột trạng thái của kết quả chiến dịch (auto_campaign_details.sub_status_id).
-- Một dòng chỉ nằm đây chừng một phút: hàm nhận lô (và job phụ) xếp vào khi lượt gửi có mốc mới thuộc loại đang có quy tắc
-- trạng thái; thủ tục chạy mỗi phút lấy ra, ghi rồi xoá. Bảng tách riêng để việc xếp hàng không làm bảng kết quả phải ghi
-- thêm mục chỉ mục.
-- attempts / error: lần ghi bị từ chối. Đủ 3 lần thì dòng nằm lại, không thử nữa, cho tới khi lượt gửi có mốc mới (xếp lại từ
-- đầu) hoặc quá hạn giữ (job phụ dọn).
CREATE TABLE private.auto_zalo_status_result_queue (
  campaign_detail_id bigint PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX idx_auto_zalo_status_result_queue_ready
  ON private.auto_zalo_status_result_queue (campaign_detail_id) WHERE attempts < 3;

-- Sự kiện gọn: bản thô (khi keep_raw_events bật) và biên nhận chưa khớp chờ job thử lại.
CREATE TABLE private.auto_zalo_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL,
  peer_uid text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('delivered', 'seen', 'reaction', 'reply', 'friend')),
  ref_msg_id text NOT NULL DEFAULT '',
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text,
  pending boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_auto_zalo_status_events UNIQUE (account_id, peer_uid, kind, ref_msg_id)
);
CREATE INDEX idx_auto_zalo_status_events_pending ON private.auto_zalo_status_events (id) WHERE pending;
CREATE INDEX idx_auto_zalo_status_events_received ON private.auto_zalo_status_events (received_at);

-- Bộ đệm phạm vi tài khoản: tránh gọi hàm quyền akaChat cho từng dòng.
CREATE TABLE private.auto_zalo_status_accounts (
  account_id bigint PRIMARY KEY,
  eligible boolean NOT NULL,
  organization_id bigint,
  staff_id bigint,
  checked_at timestamptz NOT NULL DEFAULT now()
);

-- Lượt gửi mà trigger chưa đăng ký được; job thử lại (tối đa 5 lần, bỏ sau retention_days).
CREATE TABLE private.auto_zalo_status_failures (
  campaign_detail_id bigint PRIMARY KEY,
  account_id bigint,
  error text,
  attempts integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  failed_at timestamptz NOT NULL DEFAULT now()
);
-- Khi một tài khoản còn lượt gửi chờ đăng ký bù, sự kiện chưa khớp của tài khoản đó được giữ lại chờ.
CREATE INDEX idx_auto_zalo_status_failures_account ON private.auto_zalo_status_failures (account_id);

-- Số đếm theo ngày, chia 16 ngăn để các lượt ghi lô đồng thời không chờ nhau trên một dòng.
CREATE TABLE private.auto_zalo_status_counters (
  day date NOT NULL,
  bucket smallint NOT NULL,
  calls bigint NOT NULL DEFAULT 0,
  events bigint NOT NULL DEFAULT 0,
  matched bigint NOT NULL DEFAULT 0,
  stored bigint NOT NULL DEFAULT 0,
  rejected bigint NOT NULL DEFAULT 0,
  -- Số dòng auto_campaign_details được đổi trạng thái phụ (thước đo lượng ghi vào bảng lớn) và số lần ghi bị từ chối.
  -- Thủ tục ghi cột trạng thái dùng riêng ngăn 16, không chung dòng với các lượt nhận lô (ngăn 0-15).
  detail_updates bigint NOT NULL DEFAULT 0,
  detail_failures bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);

-- Số sự kiện app Desktop đã gửi, theo nhân viên và theo ngày. App Desktop chạy trên máy của khách (máy khách không tin cậy):
-- mỗi nhân viên có một trần riêng trong ngày và mọi app Desktop cộng lại có một trần chung, để máy khách không thể làm cạn
-- trần max_events_per_day của cả hệ thống. Mỗi ngày một dòng cho mỗi nhân viên có dùng Desktop (vài trăm dòng).
CREATE TABLE private.auto_zalo_status_desktop_usage (
  day date NOT NULL,
  staff_id bigint NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  events bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, staff_id)
);

CREATE TABLE private.auto_zalo_status_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  paused_reason text,
  paused_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.auto_zalo_status_state DEFAULT VALUES;

-- Tình trạng của việc ghi cột trạng thái của kết quả: lần gần nhất có việc, lỗi gần nhất, số lần bị từ chối liên tiếp, và
-- hạn tự tạm nghỉ (30 phút) sau 30 lần bị từ chối liên tiếp mà không ghi được dòng nào.
-- Bảng riêng, không chung dòng với auto_zalo_status_state: job phụ khoá dòng đó suốt lượt chạy của nó (tới 60 giây), và hai
-- lịch cùng khởi động ở các phút chia hết cho 5.
CREATE TABLE private.auto_zalo_status_result_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_flush_at timestamptz,
  last_error text,
  fail_streak integer NOT NULL DEFAULT 0,
  paused_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.auto_zalo_status_result_state DEFAULT VALUES;

CREATE TABLE private.auto_zalo_status_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Cấu hình: các dòng zalo.message_status_sync.* trong auto_system_settings
-- (cùng mặc định và giới hạn với packages/control-api/src/zaloMessageStatusSync.ts)
-- ---------------------------------------------------------------------------
-- search_path của mọi hàm là "pg_catalog, pg_temp": mọi đối tượng ngoài pg_catalog đều được gọi kèm tên schema, và schema
-- tạm bị ép đứng CUỐI. Nếu để trống ('') hoặc không nêu pg_temp thì PostgreSQL tìm kiểu dữ liệu và bảng trong schema tạm
-- TRƯỚC pg_catalog: một phiên máy khách tạo được kiểu tạm tên "timestamptz" sẽ chạy mã của nó với quyền chủ hàm
-- SECURITY DEFINER (trigger dưới đây chạy trong phiên của bất kỳ ai ghi kết quả gửi). Bộ kiểm SQL có bước dựng lại đúng
-- cách tấn công này.
-- Biểu thức chính quy dùng [0-9], không dùng \d: ở DB có collation ICU, \d khớp cả chữ số của hệ chữ khác và phép ép kiểu
-- ngay sau đó sẽ lỗi.

CREATE FUNCTION private.auto_zalo_status_bool(p_value text, p_default boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(p_value)) WHEN 'true' THEN true WHEN 'false' THEN false ELSE p_default END
$$;

CREATE FUNCTION private.auto_zalo_status_int(p_value text, p_default integer, p_min integer, p_max integer) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(p_value) ~ '^[0-9]{1,9}$' AND btrim(p_value)::bigint BETWEEN p_min AND p_max
              THEN btrim(p_value)::integer ELSE p_default END
$$;

-- Danh sách từ JSON (["a","b"]) hoặc chuỗi cách nhau bằng dấu phẩy. NULL khi không có dòng cấu hình.
CREATE FUNCTION private.auto_zalo_status_list(p_value text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_text text := btrim(p_value);
  v_json jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  IF left(v_text, 1) = '[' THEN
    BEGIN
      v_json := v_text::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN '{}'::text[];
    END;
    IF jsonb_typeof(v_json) <> 'array' THEN RETURN '{}'::text[]; END IF;
    RETURN COALESCE((
      SELECT array_agg(btrim(e.item #>> '{}') ORDER BY e.ord)
      FROM jsonb_array_elements(v_json) WITH ORDINALITY AS e(item, ord)
      WHERE jsonb_typeof(e.item) IN ('string', 'number', 'boolean') AND btrim(e.item #>> '{}') <> ''
    ), '{}'::text[]);
  END IF;
  RETURN COALESCE((
    SELECT array_agg(btrim(s.item) ORDER BY s.ord)
    FROM unnest(string_to_array(v_text, ',')) WITH ORDINALITY AS s(item, ord)
    WHERE btrim(s.item) <> ''
  ), '{}'::text[]);
END
$$;

CREATE FUNCTION private.auto_zalo_status_timestamp(p_value text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' THEN RETURN NULL; END IF;
  RETURN btrim(p_value)::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

CREATE FUNCTION private.auto_zalo_status_config() RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v jsonb;
  v_org_text text;
  v_org_list text[];
  v_orgs jsonb;
  v_kinds text[];
  v_ignored text[];
  v_window text[];
  v_start integer := 120;
  v_end integer := 360;
BEGIN
  SELECT COALESCE(jsonb_object_agg(substr(s.key, 26), to_jsonb(s.value) #>> '{}'), '{}'::jsonb) INTO v
  FROM public.auto_system_settings s
  WHERE s.key = ANY (ARRAY[
      'zalo.message_status_sync.enabled', 'zalo.message_status_sync.capture_enabled',
      'zalo.message_status_sync.reconcile_enabled', 'zalo.message_status_sync.organization_ids',
      'zalo.message_status_sync.realtime_kinds', 'zalo.message_status_sync.keep_raw_events',
      'zalo.message_status_sync.reply_window_days', 'zalo.message_status_sync.reply_ignored_kinds',
      'zalo.message_status_sync.seen_match_mode', 'zalo.message_status_sync.track_friend_accept',
      'zalo.message_status_sync.reconcile_window', 'zalo.message_status_sync.reconcile_every_minutes',
      'zalo.message_status_sync.retention_days', 'zalo.message_status_sync.flush_interval_seconds',
      'zalo.message_status_sync.flush_max_rows', 'zalo.message_status_sync.max_events_per_day',
      'zalo.message_status_sync.update_result_status', 'zalo.message_status_sync.result_status_max_per_minute'])
    AND COALESCE(s.is_active, true) AND NOT COALESCE(s.is_secret, false);

  -- Phạm vi tổ chức: thiếu dòng / 'all' = mọi tổ chức (JSON null); sai định dạng = không tổ chức nào.
  IF NOT (v ? 'organization_ids') OR v->>'organization_ids' IS NULL THEN
    v_orgs := 'null'::jsonb;
  ELSE
    v_org_text := lower(btrim(v->>'organization_ids'));
    IF v_org_text IN ('', 'all', 'null') THEN
      v_orgs := 'null'::jsonb;
    ELSE
      v_org_list := private.auto_zalo_status_list(v->>'organization_ids');
      IF EXISTS (SELECT 1 FROM unnest(v_org_list) AS o(item) WHERE o.item !~ '^[0-9]{1,15}$' OR o.item::bigint <= 0) THEN
        v_orgs := '[]'::jsonb;
      ELSE
        v_orgs := COALESCE((SELECT jsonb_agg(DISTINCT o.item::bigint) FROM unnest(v_org_list) AS o(item)), '[]'::jsonb);
      END IF;
    END IF;
  END IF;

  v_kinds := private.auto_zalo_status_list(v->>'realtime_kinds');
  IF v_kinds IS NULL THEN
    v_kinds := ARRAY['delivered', 'seen', 'reaction', 'reply', 'friend'];
  ELSE
    v_kinds := COALESCE((SELECT array_agg(k.item ORDER BY k.ord)
      FROM unnest(ARRAY['delivered', 'seen', 'reaction', 'reply', 'friend']) WITH ORDINALITY AS k(item, ord)
      WHERE k.item = ANY (v_kinds)), '{}'::text[]);
  END IF;

  v_ignored := private.auto_zalo_status_list(v->>'reply_ignored_kinds');
  IF v_ignored IS NULL THEN
    v_ignored := ARRAY['ecard', 'system'];
  ELSE
    v_ignored := COALESCE((SELECT array_agg(k.item ORDER BY k.ord)
      FROM unnest(ARRAY['message', 'sticker', 'call', 'ecard', 'system']) WITH ORDINALITY AS k(item, ord)
      WHERE k.item = ANY (v_ignored)), '{}'::text[]);
  END IF;

  v_window := regexp_match(btrim(COALESCE(v->>'reconcile_window', '')), '^([0-9]{1,2}):([0-9]{2})\s*-\s*([0-9]{1,2}):([0-9]{2})$');
  IF v_window IS NOT NULL
     AND v_window[2]::integer <= 59 AND v_window[4]::integer <= 59
     AND v_window[1]::integer * 60 + v_window[2]::integer <= 1439
     AND v_window[3]::integer * 60 + v_window[4]::integer <= 1440
     AND v_window[1]::integer * 60 + v_window[2]::integer <> v_window[3]::integer * 60 + v_window[4]::integer THEN
    v_start := v_window[1]::integer * 60 + v_window[2]::integer;
    v_end := v_window[3]::integer * 60 + v_window[4]::integer;
  END IF;

  RETURN jsonb_build_object(
    'updateResultStatus', private.auto_zalo_status_bool(v->>'update_result_status', true),
    -- Trần số kết quả được ghi cột trạng thái mỗi phút; 0 = tạm ngừng ghi nhưng vẫn xếp hàng.
    'resultStatusMaxPerMinute', private.auto_zalo_status_int(v->>'result_status_max_per_minute', 600, 0, 6000),
    'enabled', private.auto_zalo_status_bool(v->>'enabled', false),
    'captureEnabled', private.auto_zalo_status_bool(v->>'capture_enabled', true),
    'reconcileEnabled', private.auto_zalo_status_bool(v->>'reconcile_enabled', true),
    'organizationIds', v_orgs,
    'realtimeKinds', to_jsonb(v_kinds),
    'keepRawEvents', private.auto_zalo_status_bool(v->>'keep_raw_events', true),
    'replyWindowDays', private.auto_zalo_status_int(v->>'reply_window_days', 7, 1, 30),
    'replyIgnoredKinds', to_jsonb(v_ignored),
    'seenMatchMode', CASE WHEN lower(btrim(v->>'seen_match_mode')) = 'thread' THEN 'thread' ELSE 'message' END,
    'trackFriendAccept', private.auto_zalo_status_bool(v->>'track_friend_accept', false),
    'reconcileWindow', jsonb_build_object('startMinute', v_start, 'endMinute', v_end),
    'reconcileEveryMinutes', private.auto_zalo_status_int(v->>'reconcile_every_minutes', 5, 5, 1440),
    'retentionDays', private.auto_zalo_status_int(v->>'retention_days', 4, 1, 30),
    'flushIntervalSeconds', private.auto_zalo_status_int(v->>'flush_interval_seconds', 60, 30, 600),
    'flushMaxRows', private.auto_zalo_status_int(v->>'flush_max_rows', 500, 50, 2000),
    'maxEventsPerDay', private.auto_zalo_status_int(v->>'max_events_per_day', 1000000, 1000, 50000000)
  );
END
$$;

-- ---------------------------------------------------------------------------
-- Phạm vi tài khoản: Zalo mã QR, chưa xoá, KHÔNG có akaChat
-- ---------------------------------------------------------------------------

-- "Có akaChat" theo đúng luật của hệ thống (akaAgent V445-V490; cùng luật với staffChatAllowed ở
-- packages/control-api/src/appAccess.ts): tài khoản được quyền akaChat VÀ tổ chức có hạ tầng Chat.
--   * Tổ chức kiểu cũ (chưa tách quyền): hàm quyền aka_agent_app_access_account_allowed trả TRUE cho MỌI tài khoản, kể cả
--     khi tổ chức không hề có đồng bộ chat. Vì vậy không dùng riêng hàm đó được: "có akaChat" khi tổ chức có gói đồng bộ
--     chat còn hạn, đúng điều aka_agent_app_access_chat_runtime(org, false) trả lời (Control API dùng chính hàm này cho
--     chatSyncEnabled).
--   * Tổ chức đã tách quyền (có gói akaChat riêng): theo cờ akaChat của từng tài khoản và gói còn hạn; khi đó tổ chức có
--     hạ tầng Chat nên vế thứ hai luôn đúng.
-- Số thật ngày 13/11/2026: hàm quyền trả TRUE cho 3.678 / 3.711 tài khoản Zalo, trong khi chỉ khoảng 270 tài khoản thực sự có
-- akaChat. Tổ chức lấy qua nhân viên phụ trách (org_staff), như chính các hàm quyền.
-- NULL = không xác định (không có tài khoản, không còn nhân viên phụ trách, hàm quyền trả NULL): nơi gọi coi như CÓ akaChat.
-- Các hàm quyền là hàm sẵn có của hệ thống, có thể được viết dựa vào search_path của nơi gọi (tên bảng không kèm schema): gọi
-- chúng ở đây với "public" có mặt như ở mọi nơi gọi khác, pg_catalog đứng trước và schema tạm đứng cuối.
-- Cả hai hàm quyền LUÔN được gọi (OFFSET 0 giữ nguyên truy vấn con): một hàm lỗi thì kết quả là lỗi, tức "không xác định",
-- chứ không tuỳ vào việc PostgreSQL có bỏ qua vế sau của AND hay không.
CREATE FUNCTION private.auto_zalo_status_has_akachat(p_account_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT x.allowed AND x.runtime
  FROM (
    SELECT public.aka_agent_app_access_account_allowed(a.id, 'akaChat') AS allowed,
           public.aka_agent_app_access_chat_runtime(s.organization_id, false) AS runtime
    FROM public.auto_accounts a JOIN public.org_staff s ON s.id = a.staff_id
    WHERE a.id = p_account_id
    OFFSET 0
  ) x
$$;

-- Trả dòng bộ đệm của tài khoản. checked_at NULL = lần này không xác định được quyền akaChat (hàm quyền lỗi): coi như không
-- thuộc phạm vi và KHÔNG nhớ kết quả.
-- Không bao giờ chờ khoá: chỉ phiên lấy được khoá tư vấn của tài khoản mới ghi dòng bộ đệm; phiên khác dùng kết quả vừa tính
-- mà không ghi. Nhờ vậy một giao dịch ghi kết quả còn mở (hay một lượt job dài) không giữ chân lượt ghi kết quả khác.
CREATE FUNCTION private.auto_zalo_status_account(p_account_id bigint, p_max_age interval DEFAULT interval '10 minutes')
RETURNS private.auto_zalo_status_accounts
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r private.auto_zalo_status_accounts;
  v_candidate boolean;
  v_has_chat boolean;
BEGIN
  SELECT c.* INTO r FROM private.auto_zalo_status_accounts c WHERE c.account_id = p_account_id;
  IF FOUND AND r.checked_at > now() - p_max_age THEN RETURN r; END IF;

  r.account_id := p_account_id;
  r.eligible := false;
  r.organization_id := NULL;
  r.staff_id := NULL;
  r.checked_at := now();

  -- Tổ chức của tài khoản là tổ chức của nhân viên phụ trách, như các hàm quyền của hệ thống tính (cột organization_id của
  -- tài khoản có thể trống); phạm vi thí điểm organization_ids và "có akaChat" vì vậy xét cùng một tổ chức.
  SELECT COALESCE(s.organization_id, a.organization_id), a.staff_id,
         lower(btrim(COALESCE(a.flatform_type, ''))) = 'zalo'
           AND NOT COALESCE(a.is_zalo_show_web, false) AND NOT COALESCE(a.is_delete, false)
    INTO r.organization_id, r.staff_id, v_candidate
  FROM public.auto_accounts a LEFT JOIN public.org_staff s ON s.id = a.staff_id WHERE a.id = p_account_id;

  IF FOUND AND v_candidate THEN
    -- Không xác định được quyền akaChat thì coi như CÓ akaChat: không bao giờ đụng vào tài khoản đó.
    BEGIN
      v_has_chat := COALESCE(private.auto_zalo_status_has_akachat(p_account_id), true);
    EXCEPTION WHEN OTHERS THEN
      r.eligible := false;
      r.checked_at := NULL;
      RETURN r;
    END;
    r.eligible := NOT v_has_chat;
  END IF;

  IF pg_try_advisory_xact_lock(hashtextextended('aka-agent:zalo-message-status:account', p_account_id)) THEN
    INSERT INTO private.auto_zalo_status_accounts AS c (account_id, eligible, organization_id, staff_id, checked_at)
    VALUES (r.account_id, r.eligible, r.organization_id, r.staff_id, r.checked_at)
    ON CONFLICT (account_id) DO UPDATE
      SET eligible = EXCLUDED.eligible, organization_id = EXCLUDED.organization_id,
          staff_id = EXCLUDED.staff_id, checked_at = EXCLUDED.checked_at;
  END IF;
  RETURN r;
END
$$;

CREATE FUNCTION private.auto_zalo_status_in_scope(p_config jsonb, p_organization_id bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_config->'organizationIds') = 'null'
      OR (p_organization_id IS NOT NULL AND (p_config->'organizationIds') @> to_jsonb(p_organization_id))
$$;

-- ---------------------------------------------------------------------------
-- Đăng ký lượt gửi từ dấu tham chiếu zaloStatusRef
-- ---------------------------------------------------------------------------

-- Trả true khi tạo được dòng theo dõi. Ném lỗi khi lần này không xác định được quyền akaChat: nơi gọi ghi lại để thử lại sau.
CREATE FUNCTION private.auto_zalo_status_register_detail(
  p_detail_id bigint, p_campaign_id bigint, p_account_id bigint, p_ref jsonb, p_created_at timestamptz,
  p_config jsonb DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  cfg jsonb := COALESCE(p_config, private.auto_zalo_status_config());
  acc private.auto_zalo_status_accounts;
  v_account_uid text;
  v_target_uid text;
  v_kind text;
  v_ids text[];
  -- Giờ ghi kết quả do nơi ghi cung cấp; không thể ở tương lai so với giờ DB.
  v_created timestamptz := LEAST(COALESCE(p_created_at, now()), now());
  v_sent timestamptz;
BEGIN
  IF NOT (cfg->>'enabled')::boolean THEN RETURN false; END IF;
  IF p_detail_id IS NULL OR p_campaign_id IS NULL OR p_account_id IS NULL
     OR p_ref IS NULL OR jsonb_typeof(p_ref) <> 'object' OR p_ref->>'v' IS DISTINCT FROM '1' THEN
    RETURN false;
  END IF;

  v_account_uid := btrim(COALESCE(p_ref->>'a', ''));
  v_target_uid := btrim(COALESCE(p_ref->>'t', ''));
  v_kind := p_ref->>'k';
  IF v_account_uid = '' OR v_target_uid = '' OR v_target_uid = '0' OR v_account_uid = v_target_uid
     OR length(v_account_uid) > 64 OR length(v_target_uid) > 64
     OR v_kind IS NULL OR v_kind NOT IN ('message', 'friend_request') THEN
    RETURN false;
  END IF;
  IF v_kind = 'friend_request' AND NOT (cfg->>'trackFriendAccept')::boolean THEN RETURN false; END IF;

  acc := private.auto_zalo_status_account(p_account_id);
  IF acc.checked_at IS NULL THEN RAISE EXCEPTION 'zalo_message_status_access_check_failed'; END IF;
  IF NOT acc.eligible OR NOT private.auto_zalo_status_in_scope(cfg, acc.organization_id) THEN RETURN false; END IF;

  IF jsonb_typeof(p_ref->'m') = 'array' THEN
    SELECT COALESCE(array_agg(DISTINCT btrim(e.item #>> '{}')), '{}'::text[]) INTO v_ids
    FROM (SELECT item FROM jsonb_array_elements(p_ref->'m') AS j(item) LIMIT 50) e
    WHERE jsonb_typeof(e.item) IN ('string', 'number')
      AND btrim(e.item #>> '{}') <> '' AND length(btrim(e.item #>> '{}')) <= 64;
  ELSE
    v_ids := '{}'::text[];
  END IF;

  -- Giờ gửi do runtime ghi; lệch quá xa so với giờ DB ghi kết quả (đồng hồ máy khách sai) thì dùng giờ DB.
  v_sent := private.auto_zalo_status_timestamp(p_ref->>'s');
  IF v_sent IS NULL OR v_sent > v_created + interval '1 minute' OR v_sent < v_created - interval '15 minutes' THEN
    v_sent := v_created;
  END IF;

  INSERT INTO public.auto_zalo_message_status (
    campaign_detail_id, campaign_id, organization_id, staff_id, account_id, account_zalo_uid, target_zalo_uid,
    action_type, message_ids, sent_at, reply_until
  ) VALUES (
    p_detail_id, p_campaign_id, acc.organization_id, acc.staff_id, p_account_id, v_account_uid, v_target_uid,
    v_kind, v_ids, v_sent, v_sent + make_interval(days => (cfg->>'replyWindowDays')::integer)
  ) ON CONFLICT (campaign_detail_id) DO NOTHING;
  RETURN FOUND;
END
$$;

-- Trigger chạy trong giao dịch ghi kết quả gửi: mọi lỗi được nuốt và ghi lại, không bao giờ làm hỏng việc ghi kết quả.
-- lock_timeout 2 giây cho trường hợp hiếm phải chờ khoá: bỏ qua, ghi vào bảng lỗi để job đăng ký bù.
-- Công tắc được đọc trước tiên. Chỉ khi đã đọc được và đang bật thì lỗi mới được ghi lại: đang tắt thì không ghi gì cả.
-- (Biến PL/pgSQL giữ nguyên giá trị khi khối lệnh bị lỗi, nên v_enabled phản ánh đúng những gì đã đọc được.)
CREATE FUNCTION private.auto_zalo_status_on_detail_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '2s' AS $$
DECLARE
  cfg jsonb;
  v_enabled boolean := false;
BEGIN
  BEGIN
    cfg := private.auto_zalo_status_config();
    v_enabled := (cfg->>'enabled')::boolean;
    IF v_enabled THEN
      PERFORM private.auto_zalo_status_register_detail(
        NEW.id, NEW.campaign_id, NEW.account_id, NEW.data -> 'zaloStatusRef', NEW.created_at, cfg);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF v_enabled THEN
      BEGIN
        INSERT INTO private.auto_zalo_status_failures AS f (campaign_detail_id, account_id, error)
        VALUES (NEW.id, NEW.account_id, left(SQLSTATE || ' ' || SQLERRM, 500))
        ON CONFLICT (campaign_detail_id) DO UPDATE
          SET attempts = f.attempts + 1, error = EXCLUDED.error, failed_at = now();
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- Khớp sự kiện với lượt gửi (dùng chung cho hàm nhận lô và job)
-- ---------------------------------------------------------------------------
-- p_events: mảng {a: account_id, p: UID người kia, k: loại, m: mã tin tham chiếu, t: giờ sự kiện (ISO)}.
-- Trả {"events": mỗi sự kiện kèm cờ "hit" (đã khớp)}.
-- Mốc sớm nhất thắng; chạy lại không đổi kết quả.
-- p_result_kinds: các loại đang có quy tắc trạng thái (private.auto_zalo_status_result_kinds). Lượt gửi vừa có mốc mới
-- thuộc một trong các loại đó được xếp vào hàng chờ ghi cột trạng thái; hàm này KHÔNG tự ghi bảng kết quả chiến dịch.
--   delivered / reaction: đúng mã tin, KHÔNG xét thời gian.
--   seen: đúng mã tin; ở chế độ thread thì tính cho mọi tin gửi trước giờ xem trong hội thoại. KHÔNG có hạn.
--   reply: tin của người nhận sau giờ gửi và trước reply_until.
--   friend: người nhận đồng ý lời mời do chiến dịch gửi, trước reply_until.
CREATE FUNCTION private.auto_zalo_status_apply(p_events jsonb, p_config jsonb, p_result_kinds text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_thread boolean := p_config->>'seenMatchMode' = 'thread';
  v_kinds text[] := COALESCE(p_result_kinds, '{}'::text[]);
  v_events jsonb;
BEGIN
  WITH ev AS MATERIALIZED (
    SELECT x.a::bigint AS account_id, x.p AS peer_uid, x.k AS kind, x.m AS ref_msg_id, x.t::timestamptz AS event_at
    FROM jsonb_to_recordset(p_events) AS x(a text, p text, k text, m text, t text)
  ), hits AS MATERIALIZED (
    -- Mốc không thể sớm hơn giờ gửi: giờ sự kiện sai (đồng hồ lệch) được kéo về giờ gửi.
    SELECT e.account_id, e.peer_uid, e.kind, e.ref_msg_id, GREATEST(e.event_at, s.sent_at) AS event_at, s.campaign_detail_id
    FROM ev e
    JOIN public.auto_zalo_message_status s
      ON s.account_id = e.account_id AND s.target_zalo_uid = e.peer_uid
    WHERE CASE e.kind
      WHEN 'delivered' THEN s.action_type = 'message' AND e.ref_msg_id = ANY (s.message_ids)
      WHEN 'reaction' THEN s.action_type = 'message' AND e.ref_msg_id = ANY (s.message_ids)
      WHEN 'seen' THEN s.action_type = 'message'
        AND (e.ref_msg_id = ANY (s.message_ids) OR (v_thread AND s.sent_at <= e.event_at))
      WHEN 'reply' THEN s.action_type = 'message' AND e.event_at >= s.sent_at AND e.event_at <= s.reply_until
      WHEN 'friend' THEN s.action_type = 'friend_request' AND e.event_at >= s.sent_at AND e.event_at <= s.reply_until
      ELSE false
    END
  ), agg AS (
    SELECT h.campaign_detail_id,
      min(h.event_at) FILTER (WHERE h.kind = 'delivered') AS delivered_at,
      min(h.event_at) FILTER (WHERE h.kind = 'seen') AS seen_at,
      min(h.event_at) FILTER (WHERE h.kind = 'reaction') AS reacted_at,
      min(h.event_at) FILTER (WHERE h.kind = 'reply') AS responded_at,
      min(h.event_at) FILTER (WHERE h.kind = 'friend') AS friended_at
    FROM hits h GROUP BY h.campaign_detail_id
  ), upd AS (
    UPDATE public.auto_zalo_message_status s
    SET delivered_at = LEAST(s.delivered_at, a.delivered_at),
        seen_at = LEAST(s.seen_at, a.seen_at),
        reacted_at = LEAST(s.reacted_at, a.reacted_at),
        responded_at = LEAST(s.responded_at, a.responded_at),
        friended_at = LEAST(s.friended_at, a.friended_at),
        updated_at = now()
    FROM agg a
    WHERE s.campaign_detail_id = a.campaign_detail_id
      AND (a.delivered_at < COALESCE(s.delivered_at, 'infinity'::timestamptz)
        OR a.seen_at < COALESCE(s.seen_at, 'infinity'::timestamptz)
        OR a.reacted_at < COALESCE(s.reacted_at, 'infinity'::timestamptz)
        OR a.responded_at < COALESCE(s.responded_at, 'infinity'::timestamptz)
        OR a.friended_at < COALESCE(s.friended_at, 'infinity'::timestamptz))
    RETURNING s.campaign_detail_id
  ), queued AS (
    -- Theo thứ tự mã để hai lô cùng xếp các lượt gửi trùng nhau không khoá chéo. Dòng đang nằm chờ (kể cả dòng từng bị từ
    -- chối) được xếp lại từ đầu. DO UPDATE chứ không DO NOTHING: nếu thủ tục ghi đang xử lý đúng dòng này thì lệnh chờ nó
    -- xong (vài mili-giây) rồi xếp lại, nên mốc mới không bao giờ bị bỏ sót.
    INSERT INTO private.auto_zalo_status_result_queue AS q (campaign_detail_id)
    SELECT x.campaign_detail_id FROM (
      SELECT a.campaign_detail_id FROM agg a JOIN upd u ON u.campaign_detail_id = a.campaign_detail_id
      WHERE (a.delivered_at IS NOT NULL AND 'delivered' = ANY (v_kinds)) OR (a.seen_at IS NOT NULL AND 'seen' = ANY (v_kinds))
         OR (a.reacted_at IS NOT NULL AND 'reaction' = ANY (v_kinds)) OR (a.responded_at IS NOT NULL AND 'reply' = ANY (v_kinds))
         OR (a.friended_at IS NOT NULL AND 'friend' = ANY (v_kinds))
      ORDER BY a.campaign_detail_id
    ) x
    ON CONFLICT (campaign_detail_id) DO UPDATE SET queued_at = now(), attempts = 0, error = NULL
    RETURNING 1
  )
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('a', e.account_id, 'p', e.peer_uid, 'k', e.kind, 'm', e.ref_msg_id, 't', e.event_at,
                     'hit', EXISTS (SELECT 1 FROM hits h
                                    WHERE h.account_id = e.account_id AND h.peer_uid = e.peer_uid
                                      AND h.kind = e.kind AND h.ref_msg_id = e.ref_msg_id)))
                   FROM ev e), '[]'::jsonb)
    INTO v_events;
  RETURN jsonb_build_object('events', v_events);
END
$$;

-- ---------------------------------------------------------------------------
-- Đưa bậc trạng thái vào cột trạng thái của kết quả chiến dịch
-- ---------------------------------------------------------------------------
-- Bậc cao nhất đã đạt của một lượt gửi được đưa vào auto_campaign_details.sub_status_id (trạng thái phụ) bằng chính cơ chế
-- quản lý trạng thái của hệ thống (akaAgent V495), như email "đã mở / đã click" và SMS "đã nhận":
--   * bảng quy tắc auto_status_event_rules nói loại sự kiện nào ứng với trạng thái nào trong auto_status. Tính năng dùng
--     các loại 'zalo.delivered', 'zalo.seen', 'zalo.reaction', 'zalo.reply', 'zalo.friend'. Loại chưa có quy tắc đang bật thì
--     không được đưa vào cột trạng thái (mốc thời gian vẫn được ghi ở bảng riêng);
--   * hàm aka_agent_engine_apply_status_event_v1 khoá dòng kết quả, tra quy tắc và chỉ ghi khi trạng thái mới đứng CAO HƠN
--     trạng thái đang có theo thứ bậc progress_rank của auto_status. Vì vậy bậc thấp tới sau không kéo trạng thái xuống,
--     và trạng thái cao hơn do nơi khác ghi không bị đè.
-- Trạng thái chính, nhóm báo cáo, hạn mức và log của kết quả giữ nguyên. Chỉ kết quả THÀNH CÔNG do bộ quy tắc trạng thái quản
-- lý (status_id có giá trị), chưa xoá, mới được đổi. Thứ bậc của tính năng: đã phản hồi > đã thả cảm xúc > đã xem > đã nhận.
--
-- HAI HỆ THỐNG CÙNG CẬP NHẬT TRẠNG THÁI (người dùng chốt 13/11/2026: giữ cả cơ chế theo dõi cũ lẫn tính năng này, hai bên độc
-- lập). Quy tắc: khi có mốc mới, xem trạng thái hiện tại của kết quả đã ở bậc đó (hoặc cao hơn) chưa; đã có rồi, dù do bên nào
-- ghi, thì bỏ qua, không khoá và không ghi gì vào bảng kết quả; chưa có thì ghi. Mốc thời gian của tính năng thì luôn được ghi
-- vào bảng riêng (là thứ cột "Tương tác Zalo" hiển thị), bất kể cột trạng thái có được ghi hay không.
--
-- VÌ SAO GHI THEO TỪNG ĐỢT NHỎ, TÁCH KHỎI HÀM NHẬN LÔ. Mỗi lần đổi trạng thái phụ của một kết quả, trigger tự động hoá của hệ
-- thống (aka_agent_enqueue_campaign_detail_automations) mở hai giao dịch con có ghi và cập nhật một dòng dùng chung của cả
-- hành động trong auto_campaign_action_detail_statuses; dòng đó bị khoá tới khi giao dịch kết thúc, và mọi lượt GHI KẾT QUẢ
-- của các chiến dịch cũng cập nhật chính dòng đó. Nếu ghi hàng trăm kết quả trong một giao dịch (như một lô sự kiện) thì:
-- (1) giao dịch vượt bộ nhớ 64 giao dịch con của PostgreSQL, làm chậm mọi phiên khác; (2) dòng dùng chung bị giữ khoá suốt
-- thời gian đó, các chiến dịch đang chạy phải đứng chờ. Vì vậy hàm nhận lô chỉ xếp hàng; một thủ tục chạy mỗi phút ghi theo
-- từng đợt tối đa 10 kết quả, COMMIT sau mỗi đợt, có trần mỗi phút và tự tạm nghỉ khi bị từ chối liên tiếp.

-- Quy tắc trạng thái đang bật của tính năng: loại (không kèm tiền tố 'zalo.'), hành động áp dụng (NULL = mọi hành động).
CREATE FUNCTION private.auto_zalo_status_result_rules()
RETURNS TABLE (kind text, action_code text, status_id bigint)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT substr(r.event_kind, 6), r.action_code, r.status_id
  FROM public.auto_status_event_rules r
  WHERE r.is_active AND r.event_kind = ANY (ARRAY['zalo.delivered', 'zalo.seen', 'zalo.reaction', 'zalo.reply', 'zalo.friend'])
$$;

-- Các loại mà lượt gửi có mốc mới thì cần xếp hàng ghi cột trạng thái. Rỗng khi công tắc tắt hoặc chưa có quy tắc nào.
CREATE FUNCTION private.auto_zalo_status_result_kinds(p_config jsonb) RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN COALESCE((p_config->>'updateResultStatus')::boolean, false)
    THEN COALESCE((SELECT array_agg(DISTINCT r.kind) FROM private.auto_zalo_status_result_rules() r), '{}'::text[])
    ELSE '{}'::text[] END
$$;

-- Cho người vận hành: mỗi bậc đang trỏ tới trạng thái nào (null = chưa có quy tắc đang bật, bậc đó không vào cột trạng thái).
CREATE FUNCTION private.auto_zalo_status_result_status_map() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_object_agg(k.kind, (
    SELECT jsonb_agg(jsonb_build_object('eventKind', r.event_kind, 'actionCode', r.action_code, 'statusId', s.id, 'code', s.code,
                                        'name', s.name, 'statusActive', s.is_active) ORDER BY r.action_code NULLS FIRST)
    FROM public.auto_status_event_rules r JOIN public.auto_status s ON s.id = r.status_id
    WHERE r.is_active AND r.event_kind = 'zalo.' || k.kind) ORDER BY k.ord)
  FROM (VALUES ('delivered', 1), ('seen', 2), ('reaction', 3), ('reply', 4), ('friend', 5)) AS k(kind, ord)
$$;

-- Một đợt: lấy tối đa p_limit (không quá 10) dòng của hàng chờ có mã lớn hơn p_after, ghi rồi xoá khỏi hàng chờ.
-- Nơi gọi (thủ tục bên dưới) COMMIT ngay sau mỗi đợt.
--
-- Khoá, và vì sao đợt này không làm phiên ghi kết quả của chiến dịch phải chờ lâu hay bị huỷ vì khoá chéo:
--   * Dòng hàng chờ của đợt được khoá lúc lấy (dòng đang bị hàm nhận lô giữ thì bỏ qua).
--   * Dòng kết quả được khoá ngay trước khi ghi, trong cùng khối với lần ghi, bằng SKIP LOCKED: đang bị phiên khác giữ thì để
--     nguyên trong hàng chờ cho phút sau (không tính là bị từ chối). Đợt này không bao giờ đứng chờ một dòng kết quả.
--   * Khoá duy nhất có thể phải chờ là khoá mà trigger của hệ thống tự lấy (dòng dùng chung của hành động). lock_timeout
--     200 mili-giây, thấp hơn deadlock_timeout (1 giây): nếu có vòng chờ thì chính đợt này bỏ cuộc trước khi PostgreSQL kịp
--     chọn một phiên để huỷ; trigger hệ thống tự nuốt lỗi đó và trạng thái vẫn được ghi.
--   * Một kết quả mất hơn 150 mili-giây nghĩa là có tranh chấp: đợt dừng ngay sau dòng đó để COMMIT và nhả mọi khoá; cả lượt
--     cũng dừng, phút sau làm tiếp. Nhờ vậy đợt này không giữ khoá của mình trong lúc chờ hết dòng này tới dòng khác.
-- Mỗi kết quả là một khối riêng: dòng bị từ chối ghi lại lý do và không giữ chân dòng khác. Tối đa 10 dòng mỗi giao dịch: mỗi
-- dòng được ghi dùng 3-5 giao dịch con (khối này và các khối của trigger hệ thống), 10 dòng nằm trong bộ nhớ 64 giao dịch con
-- của PostgreSQL. Khoá và ghi một dòng kết quả nằm trong cùng một giao dịch con, và dòng hàng chờ được xoá ở giao dịch ngoài
-- (nơi đã khoá nó), nên không sinh MultiXact.
CREATE FUNCTION private.auto_zalo_status_flush_result_chunk(p_limit integer, p_after bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp SET lock_timeout = '200ms' AS $$
DECLARE
  v_ids bigint[];
  v_done bigint[] := '{}';
  v_id bigint;
  m record;
  d record;
  v_kind text;
  v_target bigint;
  v_res jsonb;
  v_outcome text;
  v_row_started timestamptz;
  v_picked integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_already integer := 0;
  v_failed integer := 0;
  v_waiting integer := 0;
  v_slow boolean := false;
  v_last bigint := COALESCE(p_after, 0);
  v_error text;
BEGIN
  -- Mỗi lúc chỉ một phiên ghi cột trạng thái (lịch mỗi phút và một lần gọi tay không chạy chồng nhau).
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent:zalo-message-status:results', 0)) THEN
    RETURN jsonb_build_object('busy', true, 'picked', 0, 'updated', 0, 'skipped', 0, 'already', 0, 'failed', 0, 'waiting', 0, 'slow', false, 'last', v_last);
  END IF;
  SELECT array_agg(x.campaign_detail_id ORDER BY x.campaign_detail_id) INTO v_ids FROM (
    SELECT q.campaign_detail_id FROM private.auto_zalo_status_result_queue q
    WHERE q.attempts < 3 AND q.campaign_detail_id > v_last
    ORDER BY q.campaign_detail_id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 10)
    FOR UPDATE SKIP LOCKED
  ) x;
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('busy', false, 'picked', 0, 'updated', 0, 'skipped', 0, 'already', 0, 'failed', 0, 'waiting', 0, 'slow', false, 'last', v_last);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    v_picked := v_picked + 1;
    v_last := v_id;
    v_row_started := clock_timestamp();
    v_outcome := NULL;
    BEGIN
      v_kind := NULL;
      SELECT s.action_type, s.delivered_at, s.seen_at, s.reacted_at, s.responded_at, s.friended_at INTO m
      FROM public.auto_zalo_message_status s WHERE s.campaign_detail_id = v_id;
      IF FOUND THEN
        -- Chỉ kết quả thành công do bộ quy tắc trạng thái quản lý, chưa xoá. (Đọc thường, chưa khoá.)
        SELECT c.action_code, c.sub_status_id INTO d FROM public.auto_campaign_details c
        WHERE c.id = v_id AND c.status_id IS NOT NULL AND c.report_group = 'success' AND c.is_delete IS NOT TRUE;
        IF FOUND THEN
          -- Bậc cao nhất đã đạt mà hành động này có quy tắc trạng thái, và trạng thái mà quy tắc đó trỏ tới (quy tắc riêng
          -- của hành động được ưu tiên hơn quy tắc chung, như hàm chuẩn của hệ thống).
          SELECT k.kind, r.status_id INTO v_kind, v_target
          FROM (VALUES ('reply', 4, m.responded_at), ('reaction', 3, m.reacted_at), ('seen', 2, m.seen_at),
                       ('delivered', 1, m.delivered_at), ('friend', 0, m.friended_at)) AS k(kind, ord, reached_at)
          CROSS JOIN LATERAL (
            SELECT x.status_id FROM private.auto_zalo_status_result_rules() x
            WHERE x.kind = k.kind AND (x.action_code IS NULL OR x.action_code = d.action_code)
            ORDER BY (x.action_code IS NULL) LIMIT 1
          ) r
          WHERE k.reached_at IS NOT NULL AND (k.kind = 'friend') = (m.action_type = 'friend_request')
          ORDER BY k.ord DESC LIMIT 1;
        END IF;
      END IF;
      IF v_kind IS NULL THEN
        -- Không có gì để ghi (kết quả kiểu cũ, không thành công, đã xoá, không còn tồn tại, hoặc bậc chưa có quy tắc).
        v_outcome := 'skipped';
      ELSIF d.sub_status_id IS NOT NULL
            AND COALESCE((SELECT x.progress_rank FROM public.aka_agent_status_semantics(v_target) x), 0)
             <= COALESCE((SELECT x.progress_rank FROM public.aka_agent_status_semantics(d.sub_status_id) x), 0) THEN
        -- Kết quả đã mang trạng thái của bậc này hoặc một trạng thái cao hơn, do tính năng này hay do hệ thống khác ghi (cùng
        -- phép so thứ bậc với hàm chuẩn): bỏ qua, không khoá và không ghi gì vào bảng kết quả.
        v_outcome := 'already';
      ELSE
        PERFORM 1 FROM public.auto_campaign_details c WHERE c.id = v_id FOR UPDATE SKIP LOCKED;
        IF NOT FOUND THEN
          v_outcome := 'waiting';
        ELSE
          v_res := public.aka_agent_engine_apply_status_event_v1(v_id, 'zalo.' || v_kind);
          -- Không ghi = kết quả đã ở bậc bằng hoặc cao hơn, hoặc quy tắc vừa bị tắt.
          v_outcome := CASE WHEN COALESCE((v_res->>'applied')::boolean, false) THEN 'updated' ELSE 'skipped' END;
        END IF;
      END IF;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        v_outcome := 'waiting';
      WHEN OTHERS THEN
        v_error := left(SQLSTATE || ' ' || SQLERRM, 300);
        v_outcome := 'failed';
        UPDATE private.auto_zalo_status_result_queue q SET attempts = q.attempts + 1, error = v_error
        WHERE q.campaign_detail_id = v_id;
    END;
    IF v_outcome = 'updated' THEN
      v_updated := v_updated + 1;
      v_done := v_done || v_id;
    ELSIF v_outcome = 'skipped' THEN
      v_skipped := v_skipped + 1;
      v_done := v_done || v_id;
    ELSIF v_outcome = 'already' THEN
      -- Tính vào "skipped" (không cần ghi), và đếm riêng để theo dõi.
      v_skipped := v_skipped + 1;
      v_already := v_already + 1;
      v_done := v_done || v_id;
    ELSIF v_outcome = 'failed' THEN
      v_failed := v_failed + 1;
    ELSE
      v_waiting := v_waiting + 1;
    END IF;
    IF clock_timestamp() - v_row_started > interval '150 milliseconds' THEN
      v_slow := true;
      EXIT;
    END IF;
  END LOOP;

  IF cardinality(v_done) > 0 THEN
    DELETE FROM private.auto_zalo_status_result_queue q WHERE q.campaign_detail_id = ANY (v_done);
  END IF;
  IF v_updated > 0 OR v_failed > 0 THEN
    INSERT INTO private.auto_zalo_status_counters AS c (day, bucket, detail_updates, detail_failures)
    VALUES ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 16, v_updated, v_failed)
    ON CONFLICT (day, bucket) DO UPDATE
      SET detail_updates = c.detail_updates + EXCLUDED.detail_updates, detail_failures = c.detail_failures + EXCLUDED.detail_failures;
  END IF;
  RETURN jsonb_build_object('busy', false, 'picked', v_picked, 'updated', v_updated, 'skipped', v_skipped, 'already', v_already,
    'failed', v_failed, 'waiting', v_waiting, 'slow', v_slow, 'last', v_last)
    || CASE WHEN v_error IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('error', v_error) END;
END
$$;

-- Một bước của lượt ghi: quyết định có làm tiếp không, chạy một đợt, và khi lượt kết thúc thì ghi lại tình trạng.
-- p_run là trạng thái lượt chạy do chính hàm này trả về ở bước trước (NULL ở bước đầu). Trả về p_run mới, kèm
-- "done" (đã xong lượt) và "reason": disabled, switch_off, paused_by_setting, paused_after_failures, busy, budget, cap,
-- contention (gặp tranh chấp khoá, phút sau làm tiếp), drained.
-- Tự tạm nghỉ: khi một đợt có dòng bị từ chối và đã đủ 30 lần bị từ chối liên tiếp mà chưa ghi được dòng nào thì nghỉ 30 phút
-- rồi thử lại một đợt; ghi được thì chạy tiếp như thường. Nhờ vậy một lỗi có hệ thống (ví dụ trigger của bảng kết quả từ chối
-- mọi dòng) không biến thành hàng trăm nghìn lượt ghi hỏng vào bảng lớn. Đợt không có dòng nào bị từ chối thì không bao giờ
-- làm thủ tục nghỉ.
-- Lượt không có gì để làm thì không ghi gì cả: đang tắt, mỗi phút chỉ tốn một lần đọc cấu hình.
CREATE FUNCTION private.auto_zalo_status_flush_result_step(p_run jsonb, p_budget_seconds integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp SET lock_timeout = '1s' AS $$
DECLARE
  cfg jsonb := private.auto_zalo_status_config();
  v_run jsonb := COALESCE(p_run, jsonb_build_object('startedAt', clock_timestamp(), 'picked', 0, 'updated', 0, 'skipped', 0,
    'already', 0, 'failed', 0, 'waiting', 0, 'after', 0, 'chunks', 0));
  v_budget interval := make_interval(secs => LEAST(GREATEST(COALESCE(p_budget_seconds, 40), 5), 50));
  v_cap integer := (cfg->>'resultStatusMaxPerMinute')::integer;
  v_picked integer := (v_run->>'picked')::integer;
  v_state private.auto_zalo_status_result_state;
  v_chunk jsonb;
  v_reason text;
  v_streak integer;
  v_pause boolean := false;
BEGIN
  SELECT s.* INTO v_state FROM private.auto_zalo_status_result_state s;
  v_streak := COALESCE((v_run->>'failStreak')::integer, v_state.fail_streak, 0);
  IF NOT (cfg->>'enabled')::boolean THEN
    v_reason := 'disabled';
  ELSIF NOT (cfg->>'updateResultStatus')::boolean THEN
    v_reason := 'switch_off';
  ELSIF v_cap <= 0 THEN
    v_reason := 'paused_by_setting';
  ELSIF v_state.paused_until IS NOT NULL AND v_state.paused_until > now() THEN
    v_reason := 'paused_after_failures';
  ELSIF clock_timestamp() - (v_run->>'startedAt')::timestamptz > v_budget THEN
    v_reason := 'budget';
  ELSIF v_picked >= v_cap THEN
    v_reason := 'cap';
  ELSE
    v_chunk := private.auto_zalo_status_flush_result_chunk(LEAST(10, v_cap - v_picked), (v_run->>'after')::bigint);
    IF (v_chunk->>'busy')::boolean THEN
      v_reason := 'busy';
    ELSE
      IF (v_chunk->>'updated')::integer > 0 THEN
        v_streak := 0;
      ELSIF (v_chunk->>'failed')::integer > 0 THEN
        v_streak := v_streak + (v_chunk->>'failed')::integer;
      END IF;
      v_picked := v_picked + (v_chunk->>'picked')::integer;
      v_run := v_run || jsonb_build_object(
        'picked', v_picked,
        'updated', (v_run->>'updated')::integer + (v_chunk->>'updated')::integer,
        'skipped', (v_run->>'skipped')::integer + (v_chunk->>'skipped')::integer,
        'already', (v_run->>'already')::integer + (v_chunk->>'already')::integer,
        'failed', (v_run->>'failed')::integer + (v_chunk->>'failed')::integer,
        'waiting', (v_run->>'waiting')::integer + (v_chunk->>'waiting')::integer,
        'after', v_chunk->'last', 'chunks', (v_run->>'chunks')::integer + 1, 'failStreak', v_streak);
      IF v_chunk ? 'error' THEN v_run := v_run || jsonb_build_object('error', v_chunk->'error'); END IF;
      IF (v_chunk->>'failed')::integer > 0 AND v_streak >= 30 THEN
        v_reason := 'paused_after_failures';
        v_pause := true;
      ELSIF (v_chunk->>'slow')::boolean THEN
        v_reason := 'contention';
      ELSIF (v_chunk->>'picked')::integer = 0 THEN
        v_reason := 'drained';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL AND (v_picked > 0 OR v_pause) THEN
    UPDATE private.auto_zalo_status_result_state s
    SET last_flush_at = now(),
        last_error = CASE WHEN (v_run->>'failed')::integer > 0 THEN v_run->>'error'
                          WHEN (v_run->>'updated')::integer > 0 THEN NULL ELSE s.last_error END,
        fail_streak = v_streak,
        paused_until = CASE WHEN v_pause THEN now() + interval '30 minutes'
                            WHEN v_streak = 0 THEN NULL ELSE s.paused_until END,
        updated_at = now();
  END IF;
  RETURN v_run || jsonb_build_object('done', v_reason IS NOT NULL, 'reason', v_reason);
END
$$;

-- Thủ tục do pg_cron gọi mỗi phút: lặp các bước, COMMIT sau mỗi bước, để mỗi đợt ghi là một giao dịch ngắn riêng.
-- Thủ tục có COMMIT thì PostgreSQL không cho đặt search_path hay SECURITY DEFINER trên nó, nên thân thủ tục chỉ gồm lời gọi
-- kèm tên schema đầy đủ; mọi việc thật nằm trong các hàm (đã ghim search_path) ở trên. Chỉ chủ sở hữu được gọi.
-- Phải gọi ở mức ngoài cùng (CALL ... không nằm trong BEGIN ... COMMIT của nơi gọi).
CREATE PROCEDURE private.auto_zalo_status_flush_results(p_budget_seconds pg_catalog.int4 DEFAULT 40)
LANGUAGE plpgsql AS $proc$
DECLARE
  v_run pg_catalog.jsonb := NULL;
BEGIN
  LOOP
    v_run := private.auto_zalo_status_flush_result_step(v_run, p_budget_seconds);
    COMMIT;
    EXIT WHEN COALESCE((v_run OPERATOR(pg_catalog.->>) 'done')::pg_catalog.bool, true);
  END LOOP;
END
$proc$;

-- ---------------------------------------------------------------------------
-- Nhận một lô sự kiện từ runtime
-- ---------------------------------------------------------------------------
-- Chỉ backend tin cậy được gọi (service_role, vai trò SQL của Chat API). App Desktop là máy khách không tin cậy: nó gọi
-- hàm bọc aka_agent_desktop_ingest_zalo_message_status ở ngay dưới.
-- lock_timeout 5 giây: gặp khoá lâu thì cả lô thất bại, runtime giữ lô và gửi lại (ghi lại không đổi kết quả).
CREATE FUNCTION public.aka_agent_ingest_zalo_message_status(p_source text, p_events jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $$
DECLARE
  cfg jsonb := private.auto_zalo_status_config();
  v_base jsonb;
  v_off jsonb := jsonb_build_object('enabled', false, 'accepted', 0, 'matched', 0, 'stored', 0,
    'rejectedAccountIds', '[]'::jsonb);
  v_day date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_source text := COALESCE(NULLIF(left(lower(regexp_replace(COALESCE(p_source, ''), '[^A-Za-z0-9_-]', '', 'g')), 16), ''), 'unknown');
  v_kinds text[];
  v_keep boolean;
  v_today bigint;
  v_waiting bigint[];
  v_applied jsonb;
  v_events jsonb;
  v_ok jsonb;
  v_rejected jsonb;
  v_accepted integer := 0;
  v_matched integer := 0;
  v_stored integer := 0;
BEGIN
  v_base := jsonb_build_object(
    'flushIntervalSeconds', cfg->'flushIntervalSeconds', 'flushMaxRows', cfg->'flushMaxRows',
    'trackFriendAccept', cfg->'trackFriendAccept', 'replyIgnoredKinds', cfg->'replyIgnoredKinds');
  IF NOT (cfg->>'enabled')::boolean OR NOT (cfg->>'captureEnabled')::boolean THEN RETURN v_base || v_off; END IF;
  IF EXISTS (SELECT 1 FROM private.auto_zalo_status_state s WHERE s.paused_reason IS NOT NULL) THEN
    RETURN v_base || v_off || jsonb_build_object('paused', true);
  END IF;
  SELECT COALESCE(sum(c.events), 0) INTO v_today FROM private.auto_zalo_status_counters c WHERE c.day = v_day;
  IF v_today >= (cfg->>'maxEventsPerDay')::bigint THEN
    RETURN v_base || v_off || jsonb_build_object('paused', true);
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) = 0 THEN
    RETURN v_base || v_off || jsonb_build_object('enabled', true);
  END IF;

  v_kinds := ARRAY(SELECT jsonb_array_elements_text(cfg->'realtimeKinds'));
  v_keep := (cfg->>'keepRawEvents')::boolean;

  -- Làm sạch và bỏ trùng trong lô (giữ giờ sớm nhất); giờ sự kiện sai hoặc ở tương lai thì dùng giờ DB.
  -- Mã tài khoản được đưa về dạng số chuẩn ("0501" và "501" là một) trước khi bỏ trùng.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('a', d.a, 'p', d.p, 'k', d.k, 'm', d.m, 't', d.t)), '[]'::jsonb) INTO v_events
  FROM (
    SELECT DISTINCT ON (c.a, c.p, c.k, c.m) c.a, c.p, c.k, c.m, c.t
    FROM (
      -- Phần tử không phải object (dòng hỏng từ runtime) bị bỏ qua, không làm hỏng cả lô.
      SELECT CASE WHEN btrim(x.item->>'a') ~ '^[0-9]{1,15}$' THEN btrim(x.item->>'a')::bigint::text END AS a,
             btrim(x.item->>'p') AS p, x.item->>'k' AS k, COALESCE(btrim(x.item->>'m'), '') AS m,
             LEAST(COALESCE(private.auto_zalo_status_timestamp(x.item->>'t'), now()), now()) AS t
      FROM (SELECT j.item FROM jsonb_array_elements(p_events) AS j(item) LIMIT 2000) x
      WHERE jsonb_typeof(x.item) = 'object'
    ) c
    WHERE c.a IS NOT NULL AND c.p <> '' AND c.p <> '0' AND length(c.p) <= 64 AND length(c.m) <= 128
      AND c.k IN ('delivered', 'seen', 'reaction', 'reply', 'friend')
      AND (c.k <> 'friend' OR (cfg->>'trackFriendAccept')::boolean)
    ORDER BY c.a, c.p, c.k, c.m, c.t
  ) d;

  -- Lớp quyết định về phạm vi: tài khoản có akaChat, ngoài phạm vi thí điểm hoặc không tồn tại đều bị từ chối.
  WITH accounts AS MATERIALIZED (
    SELECT a.account_id, private.auto_zalo_status_account(a.account_id) AS acc
    -- Thứ tự cố định: hai lô đồng thời làm mới cùng các tài khoản không khoá chéo nhau.
    FROM (SELECT DISTINCT (e->>'a')::bigint AS account_id FROM jsonb_array_elements(v_events) AS e ORDER BY 1) a
  ), verdict AS (
    SELECT a.account_id,
           (a.acc).eligible AND private.auto_zalo_status_in_scope(cfg, (a.acc).organization_id) AS allowed
    FROM accounts a
  )
  SELECT COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(v_events) AS e
                   JOIN verdict v ON v.account_id = (e->>'a')::bigint AND v.allowed), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(v.account_id::text ORDER BY v.account_id) FROM verdict v WHERE NOT v.allowed), '[]'::jsonb)
    INTO v_ok, v_rejected;

  v_accepted := jsonb_array_length(v_ok);
  IF v_accepted > 0 THEN
    -- Tài khoản còn lượt gửi chờ đăng ký bù: mọi sự kiện chưa khớp của nó (kể cả phản hồi) được giữ lại chờ job.
    v_waiting := ARRAY(SELECT DISTINCT f.account_id FROM private.auto_zalo_status_failures f
                       WHERE f.account_id = ANY (ARRAY(SELECT DISTINCT (e->>'a')::bigint FROM jsonb_array_elements(v_ok) AS e)));
    -- Lượt gửi vừa lên bậc được xếp hàng ghi cột trạng thái của kết quả; hàm này không tự ghi bảng kết quả chiến dịch.
    v_applied := private.auto_zalo_status_apply(
      COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(v_ok) AS e WHERE e->>'k' = ANY (v_kinds)), '[]'::jsonb), cfg,
      private.auto_zalo_status_result_kinds(cfg));
    WITH applied AS MATERIALIZED (
      SELECT (r->>'a')::bigint AS account_id, r->>'p' AS peer_uid, r->>'k' AS kind, r->>'m' AS ref_msg_id,
             (r->>'t')::timestamptz AS event_at, (r->>'hit')::boolean AS hit
      FROM jsonb_array_elements(v_applied->'events') AS r
      UNION ALL
      -- Loại không nằm trong realtime_kinds chỉ được lưu, chờ job đối soát.
      SELECT (e->>'a')::bigint, e->>'p', e->>'k', e->>'m', (e->>'t')::timestamptz, NULL::boolean
      FROM jsonb_array_elements(v_ok) AS e WHERE NOT (e->>'k' = ANY (v_kinds))
    ), marked AS (
      -- Chờ job: loại chưa khớp ngay; biên nhận tới trước khi lượt gửi kịp đăng ký; mọi sự kiện chưa khớp của tài khoản còn
      -- lượt gửi chờ đăng ký bù.
      SELECT a.account_id, a.peer_uid, a.kind, a.ref_msg_id, a.event_at,
             a.hit IS NULL OR (NOT a.hit AND (a.kind IN ('delivered', 'seen', 'reaction') OR a.account_id = ANY (v_waiting))) AS wait
      FROM applied a
    ), stored AS (
      INSERT INTO private.auto_zalo_status_events AS ev (account_id, peer_uid, kind, ref_msg_id, event_at, source, pending)
      SELECT m.account_id, m.peer_uid, m.kind, m.ref_msg_id, m.event_at, v_source, m.wait
      FROM marked m
      WHERE v_keep OR m.wait
      -- Sự kiện đang chờ mà tới lại với giờ sớm hơn: giữ giờ sớm nhất.
      ON CONFLICT ON CONSTRAINT uq_auto_zalo_status_events DO UPDATE SET event_at = EXCLUDED.event_at
        WHERE ev.pending AND EXCLUDED.event_at < ev.event_at
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM applied a WHERE a.hit), (SELECT count(*) FROM stored)
      INTO v_matched, v_stored;
  END IF;

  INSERT INTO private.auto_zalo_status_counters AS c (day, bucket, calls, events, matched, stored, rejected)
  VALUES (v_day, floor(random() * 16)::smallint, 1, v_accepted, v_matched, v_stored, jsonb_array_length(v_rejected))
  ON CONFLICT (day, bucket) DO UPDATE
    SET calls = c.calls + 1, events = c.events + EXCLUDED.events, matched = c.matched + EXCLUDED.matched,
        stored = c.stored + EXCLUDED.stored, rejected = c.rejected + EXCLUDED.rejected;

  RETURN v_base || jsonb_build_object('enabled', true, 'accepted', v_accepted, 'matched', v_matched,
    'stored', v_stored, 'rejectedAccountIds', v_rejected);
END
$$;

-- ---------------------------------------------------------------------------
-- Nhận một lô sự kiện từ app Desktop
-- ---------------------------------------------------------------------------
-- App Desktop chạy trên máy của khách nên không được gọi thẳng hàm nhận lô ở trên. Hàm bọc này:
--   * chỉ chạy trong phiên Desktop đã đăng nhập. Nhân viên lấy từ phiên (private.aka_agent_desktop_data_context của akaAgent
--     V436), không nhận từ tham số; không có phiên thì lỗi 42501;
--   * chỉ chuyển tiếp sự kiện của tài khoản do chính nhân viên đó phụ trách. Tài khoản khác bị trả về trong
--     rejectedAccountIds, như tài khoản ngoài phạm vi;
--   * giữ hai trần trong ngày, để máy khách không thể làm cạn trần chung max_events_per_day của cả hệ thống:
--       - mỗi nhân viên: 1/20 trần chung (tối thiểu 1.000 sự kiện);
--       - mọi app Desktop cộng lại: 1/2 trần chung, nên phần còn lại luôn dành cho App Server.
--     Chạm một trong hai trần thì trả enabled = false, paused = true: app ngừng thu và hỏi lại sau, như khi cả hệ thống tạm
--     ngừng nhận.
-- Chỗ của lô được giữ TRƯỚC khi nhận (một lệnh ghi có điều kiện trên dòng của nhân viên): các lần gọi đồng thời của cùng một
-- nhân viên xếp hàng trên dòng đó, không thể cùng đọc "còn dưới trần" rồi cùng vượt. Vượt tối đa một lô (2.000 sự kiện).
-- Phạm vi akaChat, khớp và lưu vẫn do hàm nhận lô chung quyết định; nguồn ghi là 'desktop'.
-- statement_timeout 15 giây đặt ngay trên hàm (PostgREST áp cho lượt gọi): vai trò Desktop mặc định chỉ có 3 giây, không đủ
-- chắc cho một lô khi bộ đệm phạm vi tài khoản còn nguội, và ngắn hơn cả lock_timeout 5 giây của chính hàm.
CREATE FUNCTION public.aka_agent_desktop_ingest_zalo_message_status(p_events jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' SET statement_timeout = '15s' AS $$
DECLARE
  cfg jsonb;
  v_staff bigint;
  v_day date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_limit bigint;
  v_total_limit bigint;
  v_total bigint;
  v_state jsonb;
  v_paused jsonb;
  v_own jsonb;
  v_foreign jsonb;
  v_count integer;
  v_result jsonb;
BEGIN
  SELECT ctx.staff_id INTO v_staff FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1;
  IF v_staff IS NULL OR v_staff <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'zalo_message_status_desktop_identity_required';
  END IF;

  -- Trạng thái hiện hành (đang bật, tạm ngừng, cấu hình cho app), không ghi gì. Mảng rỗng, đang tắt hoặc tạm ngừng: trả luôn.
  v_state := public.aka_agent_ingest_zalo_message_status('desktop', '[]'::jsonb);
  IF NOT COALESCE((v_state->>'enabled')::boolean, false)
     OR p_events IS NULL OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) = 0 THEN
    RETURN v_state;
  END IF;
  v_paused := v_state || jsonb_build_object('enabled', false, 'paused', true);

  -- Cùng giới hạn 2.000 phần tử và cùng cách đọc mã tài khoản với hàm nhận lô chung. Phần tử hỏng bị bỏ ở đây.
  WITH items AS MATERIALIZED (
    SELECT x.item,
           CASE WHEN btrim(x.item->>'a') ~ '^[0-9]{1,15}$' THEN btrim(x.item->>'a')::bigint END AS account_id
    FROM (SELECT j.item FROM jsonb_array_elements(p_events) AS j(item) LIMIT 2000) x
    WHERE jsonb_typeof(x.item) = 'object'
  ), owned AS MATERIALIZED (
    SELECT a.id FROM public.auto_accounts a
    WHERE a.id = ANY (ARRAY(SELECT DISTINCT i.account_id FROM items i WHERE i.account_id IS NOT NULL))
      AND a.staff_id = v_staff
  )
  SELECT COALESCE((SELECT jsonb_agg(i.item) FROM items i JOIN owned o ON o.id = i.account_id), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(f.account_id::text ORDER BY f.account_id)
                   FROM (SELECT DISTINCT i.account_id FROM items i
                         WHERE i.account_id IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM owned o WHERE o.id = i.account_id)) f), '[]'::jsonb)
    INTO v_own, v_foreign;
  v_count := jsonb_array_length(v_own);
  -- Không có sự kiện nào của tài khoản mình: không giữ chỗ, không gọi hàm chung.
  IF v_count = 0 THEN
    RETURN v_state || jsonb_build_object('rejectedAccountIds', v_foreign);
  END IF;

  cfg := private.auto_zalo_status_config();
  v_limit := GREATEST(1000, (cfg->>'maxEventsPerDay')::bigint / 20);
  v_total_limit := GREATEST(1000, (cfg->>'maxEventsPerDay')::bigint / 2);
  SELECT COALESCE(sum(u.events), 0) INTO v_total FROM private.auto_zalo_status_desktop_usage u WHERE u.day = v_day;
  IF v_total >= v_total_limit THEN RETURN v_paused; END IF;

  -- Giữ chỗ cho lô. Dòng đã chạm trần thì không được cập nhật (không có dòng trả về); lần gọi đồng thời của cùng nhân viên
  -- chờ khoá dòng này rồi xét lại điều kiện trên số đã cộng.
  INSERT INTO private.auto_zalo_status_desktop_usage AS u (day, staff_id, calls, events)
  VALUES (v_day, v_staff, 1, v_count)
  ON CONFLICT (day, staff_id) DO UPDATE SET calls = u.calls + 1, events = u.events + EXCLUDED.events
    WHERE u.events < v_limit;
  IF NOT FOUND THEN RETURN v_paused; END IF;

  v_result := public.aka_agent_ingest_zalo_message_status('desktop', v_own);
  IF jsonb_array_length(v_foreign) = 0 THEN RETURN v_result; END IF;
  RETURN v_result || jsonb_build_object('rejectedAccountIds',
    COALESCE(v_result->'rejectedAccountIds', '[]'::jsonb) || v_foreign);
END
$$;

-- ---------------------------------------------------------------------------
-- Job phụ: đăng ký bù, khớp lại phần chờ, dọn dẹp. Trạng thái bình thường KHÔNG chờ job này.
-- ---------------------------------------------------------------------------
-- lock_timeout 5 giây: job không bao giờ đứng chờ khoá tới khi bị trần 120 giây của pg_cron cắt ngang.
CREATE FUNCTION private.auto_zalo_status_run(p_budget_seconds integer DEFAULT 60) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $$
DECLARE
  cfg jsonb := private.auto_zalo_status_config();
  v_started timestamptz := clock_timestamp();
  v_budget interval := make_interval(secs => LEAST(GREATEST(COALESCE(p_budget_seconds, 60), 5), 100));
  v_minute integer := (extract(hour FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh') * 60
                       + extract(minute FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer;
  v_start integer := (cfg #>> '{reconcileWindow,startMinute}')::integer;
  v_end integer := (cfg #>> '{reconcileWindow,endMinute}')::integer;
  v_last timestamptz;
  v_registered integer := 0;
  v_retry_dropped integer := 0;
  v_rematched integer := 0;
  v_deleted integer := 0;
  v_n integer;
  v_ids bigint[];
  v_after bigint := 0;
  v_applied jsonb;
  v_result_kinds text[] := private.auto_zalo_status_result_kinds(cfg);
  v_result jsonb;
  f record;
  d record;
BEGIN
  IF NOT (cfg->>'enabled')::boolean THEN RETURN jsonb_build_object('run', false, 'reason', 'disabled'); END IF;
  IF NOT (cfg->>'reconcileEnabled')::boolean THEN RETURN jsonb_build_object('run', false, 'reason', 'reconcile_disabled'); END IF;
  -- Khung giờ có thể vắt qua nửa đêm (ví dụ 22:30-01:15).
  IF (v_start < v_end AND NOT (v_minute >= v_start AND v_minute < v_end))
     OR (v_start > v_end AND NOT (v_minute >= v_start OR v_minute < v_end)) THEN
    RETURN jsonb_build_object('run', false, 'reason', 'outside_window');
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent:zalo-message-status:run', 0)) THEN
    RETURN jsonb_build_object('run', false, 'reason', 'busy');
  END IF;
  SELECT s.last_run_at INTO v_last FROM private.auto_zalo_status_state s;
  IF v_last IS NOT NULL
     AND v_last > now() - make_interval(mins => (cfg->>'reconcileEveryMinutes')::integer) + interval '30 seconds' THEN
    RETURN jsonb_build_object('run', false, 'reason', 'throttled');
  END IF;
  UPDATE private.auto_zalo_status_state SET last_run_at = now(), updated_at = now();

  BEGIN
    -- 1. Đăng ký bù các lượt gửi mà trigger chưa ghi được. Mỗi lượt tối đa 50: mỗi lần thử là một giao dịch con có ghi,
    --    và PostgreSQL chỉ nhớ nhanh được 64 giao dịch con cho một giao dịch.
    FOR f IN SELECT x.campaign_detail_id, x.attempts FROM private.auto_zalo_status_failures x
             ORDER BY x.failed_at LIMIT 50 LOOP
      EXIT WHEN clock_timestamp() - v_started > v_budget;
      SELECT c.id, c.campaign_id, c.account_id, c.data, c.created_at INTO d
      FROM public.auto_campaign_details c WHERE c.id = f.campaign_detail_id;
      IF NOT FOUND OR f.attempts >= 5 THEN
        DELETE FROM private.auto_zalo_status_failures x WHERE x.campaign_detail_id = f.campaign_detail_id;
        v_retry_dropped := v_retry_dropped + 1;
        CONTINUE;
      END IF;
      BEGIN
        IF private.auto_zalo_status_register_detail(d.id, d.campaign_id, d.account_id, d.data -> 'zaloStatusRef', d.created_at, cfg) THEN
          v_registered := v_registered + 1;
        END IF;
        DELETE FROM private.auto_zalo_status_failures x WHERE x.campaign_detail_id = f.campaign_detail_id;
      EXCEPTION WHEN OTHERS THEN
        UPDATE private.auto_zalo_status_failures x
        SET attempts = x.attempts + 1, error = left(SQLSTATE || ' ' || SQLERRM, 500), failed_at = now()
        WHERE x.campaign_detail_id = f.campaign_detail_id;
      END;
    END LOOP;

    -- 2. Khớp lại sự kiện đang chờ. Bỏ qua sự kiện vừa nhận trong 2 phút: lượt gửi của nó có thể chưa ghi xong.
    LOOP
      EXIT WHEN clock_timestamp() - v_started > v_budget;
      SELECT array_agg(p.id) INTO v_ids FROM (
        SELECT e.id FROM private.auto_zalo_status_events e
        WHERE e.pending AND e.id > v_after AND e.received_at < now() - interval '2 minutes'
        ORDER BY e.id LIMIT 5000 FOR UPDATE SKIP LOCKED
      ) p;
      EXIT WHEN v_ids IS NULL;
      -- Đi tiếp theo mã: sự kiện chưa đủ 30 phút vẫn chờ nhưng không bị đọc lại trong cùng lượt.
      v_after := v_ids[array_upper(v_ids, 1)];
      v_applied := private.auto_zalo_status_apply((
        SELECT jsonb_agg(jsonb_build_object('a', e.account_id::text, 'p', e.peer_uid, 'k', e.kind,
                                            'm', e.ref_msg_id, 't', e.event_at))
        FROM private.auto_zalo_status_events e WHERE e.id = ANY (v_ids)), cfg, v_result_kinds);
      WITH applied AS MATERIALIZED (
        SELECT (r->>'a')::bigint AS account_id, r->>'p' AS peer_uid, r->>'k' AS kind, r->>'m' AS ref_msg_id, (r->>'hit')::boolean AS hit
        FROM jsonb_array_elements(v_applied->'events') AS r
      ), settled AS (
        -- Đã khớp thì xong. Chưa khớp sau 30 phút thì thôi chờ: lượt gửi của nó không được theo dõi. Riêng tài khoản còn
        -- lượt gửi chờ đăng ký bù thì chưa bỏ: lượt gửi của sự kiện này có thể nằm trong số đó.
        UPDATE private.auto_zalo_status_events e SET pending = false
        FROM applied a
        WHERE e.id = ANY (v_ids) AND e.account_id = a.account_id AND e.peer_uid = a.peer_uid
          AND e.kind = a.kind AND e.ref_msg_id = a.ref_msg_id
          AND (a.hit OR (e.received_at < now() - interval '30 minutes'
                         AND NOT EXISTS (SELECT 1 FROM private.auto_zalo_status_failures w WHERE w.account_id = e.account_id)))
        RETURNING a.hit
      )
      SELECT count(*) FILTER (WHERE s.hit) INTO v_n FROM settled s;
      v_rematched := v_rematched + COALESCE(v_n, 0);
      EXIT WHEN array_length(v_ids, 1) < 5000;
    END LOOP;

    -- 3. Dọn dẹp theo lô: dòng quá hạn giữ (theo chỉ mục received_at) ...
    LOOP
      EXIT WHEN clock_timestamp() - v_started > v_budget;
      WITH gone AS (
        DELETE FROM private.auto_zalo_status_events e
        WHERE e.id IN (
          SELECT x.id FROM private.auto_zalo_status_events x
          WHERE x.received_at < now() - make_interval(days => (cfg->>'retentionDays')::integer)
          LIMIT 20000)
        RETURNING 1
      ) SELECT count(*) INTO v_n FROM gone;
      v_deleted := v_deleted + v_n;
      EXIT WHEN v_n < 20000;
    END LOOP;
    -- ... và, khi không giữ bản thô, mọi dòng đã hết chờ.
    IF NOT (cfg->>'keepRawEvents')::boolean THEN
      LOOP
        EXIT WHEN clock_timestamp() - v_started > v_budget;
        WITH gone AS (
          DELETE FROM private.auto_zalo_status_events e
          WHERE e.id IN (SELECT x.id FROM private.auto_zalo_status_events x WHERE NOT x.pending LIMIT 20000)
          RETURNING 1
        ) SELECT count(*) INTO v_n FROM gone;
        v_deleted := v_deleted + v_n;
        EXIT WHEN v_n < 20000;
      END LOOP;
    END IF;
    DELETE FROM private.auto_zalo_status_runs r WHERE r.started_at < now() - interval '30 days';
    DELETE FROM private.auto_zalo_status_counters c WHERE c.day < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 60;
    DELETE FROM private.auto_zalo_status_desktop_usage u WHERE u.day < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 60;
    -- Lượt gửi chờ đăng ký bù quá hạn giữ thì bỏ hẳn.
    DELETE FROM private.auto_zalo_status_failures x
    WHERE x.first_failed_at < now() - make_interval(days => (cfg->>'retentionDays')::integer);
    -- Dòng của hàng chờ ghi cột trạng thái nằm lại quá hạn giữ (đã bị từ chối đủ số lần, hoặc việc ghi cột trạng thái đang
    -- tắt): bỏ. Dòng bị thủ tục ghi đang giữ thì để nguyên.
    DELETE FROM private.auto_zalo_status_result_queue q
    WHERE q.campaign_detail_id IN (
      SELECT x.campaign_detail_id FROM private.auto_zalo_status_result_queue x
      WHERE x.queued_at < now() - make_interval(days => (cfg->>'retentionDays')::integer)
      LIMIT 20000 FOR UPDATE SKIP LOCKED);
    -- Dòng bộ đệm cũ: chỉ xoá dòng lấy được khoá tư vấn của tài khoản, cùng quy ước với nơi ghi bộ đệm.
    WITH old AS MATERIALIZED (
      SELECT a.account_id FROM private.auto_zalo_status_accounts a WHERE a.checked_at < now() - interval '1 day' LIMIT 5000
    )
    DELETE FROM private.auto_zalo_status_accounts a USING old o
    WHERE a.account_id = o.account_id
      AND pg_try_advisory_xact_lock(hashtextextended('aka-agent:zalo-message-status:account', o.account_id));

    v_result := jsonb_build_object('run', true, 'registered', v_registered, 'retryDropped', v_retry_dropped,
      'rematched', v_rematched, 'deleted', v_deleted,
      'pending', (SELECT count(*) FROM private.auto_zalo_status_events e WHERE e.pending),
      'failures', (SELECT count(*) FROM private.auto_zalo_status_failures),
      'resultQueue', (SELECT count(*) FROM private.auto_zalo_status_result_queue),
      'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
    -- Job chạy lại được thì tự mở lại việc nhận lô; tạm dừng vì lý do khác (đặt tay) thì giữ nguyên.
    UPDATE private.auto_zalo_status_state s
    SET last_success_at = now(), consecutive_failures = 0,
        paused_at = CASE WHEN s.paused_reason = 'job_failures' THEN NULL ELSE s.paused_at END,
        paused_reason = NULLIF(s.paused_reason, 'job_failures'),
        updated_at = now();
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    -- Lỗi (kể cả bị cắt vì quá giờ) làm hoàn tác phần việc của lượt này; ghi lại và tự tạm dừng sau 5 lần liên tiếp.
    -- Tạm dừng do người vận hành đặt thì giữ nguyên lý do, để lượt chạy sạch sau đó không tự gỡ nó.
    v_result := jsonb_build_object('run', true, 'error', left(SQLSTATE || ' ' || SQLERRM, 500));
    UPDATE private.auto_zalo_status_state s
    SET consecutive_failures = s.consecutive_failures + 1,
        paused_reason = CASE WHEN s.consecutive_failures + 1 >= 5 AND s.paused_reason IS NULL THEN 'job_failures' ELSE s.paused_reason END,
        paused_at = CASE WHEN s.consecutive_failures + 1 >= 5 AND s.paused_reason IS NULL THEN now() ELSE s.paused_at END,
        updated_at = now();
  END;

  INSERT INTO private.auto_zalo_status_runs (started_at, finished_at, result)
  VALUES (v_started, clock_timestamp(), v_result);
  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- Quyền: không cấp gì cho vai trò máy khách
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.auto_zalo_message_status FROM PUBLIC;
REVOKE ALL ON TABLE private.auto_zalo_status_events, private.auto_zalo_status_accounts, private.auto_zalo_status_failures,
  private.auto_zalo_status_counters, private.auto_zalo_status_state, private.auto_zalo_status_runs,
  private.auto_zalo_status_result_queue, private.auto_zalo_status_result_state,
  private.auto_zalo_status_desktop_usage FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_ingest_zalo_message_status(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_ingest_zalo_message_status(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_run(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_apply(jsonb, jsonb, text[]) FROM PUBLIC;
REVOKE ALL ON PROCEDURE private.auto_zalo_status_flush_results(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_flush_result_step(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_flush_result_chunk(integer, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_result_kinds(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_result_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_result_status_map() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_register_detail(bigint, bigint, bigint, jsonb, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_has_akachat(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_on_detail_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_account(bigint, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_in_scope(jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_bool(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_int(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auto_zalo_status_timestamp(text) FROM PUBLIC;

DO $grants$
DECLARE
  v_role text;
  v_object record;
BEGIN
  -- Quyền mặc định (ALTER DEFAULT PRIVILEGES) của DB có thể đã cấp sẵn cho các vai trò API trên đối tượng vừa tạo, ở cả
  -- public lẫn private: thu lại hết từng vai trò một, rồi mới cấp đúng hai quyền cần.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.auto_zalo_message_status, private.auto_zalo_status_events, '
        'private.auto_zalo_status_accounts, private.auto_zalo_status_failures, private.auto_zalo_status_counters, '
        'private.auto_zalo_status_state, private.auto_zalo_status_runs, private.auto_zalo_status_result_queue, '
        'private.auto_zalo_status_result_state, private.auto_zalo_status_desktop_usage FROM %I', v_role);
      -- Sequence của các cột tự tăng (bảng sự kiện, nhật ký job): quyền mặc định trên sequence cũng có thể đã được cấp sẵn.
      FOR v_object IN
        SELECT c.oid::regclass AS signature FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND n.nspname IN ('private', 'public') AND c.relname LIKE 'auto\_zalo\_%'
      LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %I', v_object.signature, v_role);
      END LOOP;
      FOR v_object IN
        SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE (n.nspname = 'private' AND p.proname LIKE 'auto\_zalo\_status\_%')
           OR (n.nspname = 'public' AND p.proname IN ('aka_agent_ingest_zalo_message_status',
                                                      'aka_agent_desktop_ingest_zalo_message_status'))
      LOOP
        -- ROUTINE: danh sách gồm cả hàm lẫn thủ tục.
        EXECUTE format('REVOKE ALL ON ROUTINE %s FROM %I', v_object.signature, v_role);
      END LOOP;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- API chỉ được đọc bảng kết quả. Ghi chỉ qua hàm của tính năng.
    GRANT SELECT ON TABLE public.auto_zalo_message_status TO service_role;
    GRANT EXECUTE ON FUNCTION public.aka_agent_ingest_zalo_message_status(text, jsonb) TO service_role;
  END IF;
  -- Vai trò SQL của Chat API ghi lô trực tiếp qua nhóm kết nối sẵn có của nó.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_ingest_zalo_message_status(text, jsonb) TO aka_agent_chat_api;
  END IF;
  -- App Desktop chỉ được gọi hàm bọc của riêng nó (xác thực theo phiên, lọc theo nhân viên, có trần theo nhân viên).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_ingest_zalo_message_status(jsonb) TO aka_agent_desktop;
  END IF;
END
$grants$;

-- ---------------------------------------------------------------------------
-- Dòng cấu hình: công tắc tổng tắt
-- ---------------------------------------------------------------------------
INSERT INTO public.auto_system_settings (key, value, description)
SELECT v.key, v.value, v.description
FROM (VALUES
  ('zalo.message_status_sync.enabled', 'false', 'Đồng bộ trạng thái tin nhắn Zalo (tài khoản không có akaChat): công tắc tổng true/false'),
  ('zalo.message_status_sync.capture_enabled', 'true', 'Thu sự kiện từ runtime: true/false'),
  ('zalo.message_status_sync.reconcile_enabled', 'true', 'Job phụ (đăng ký bù, khớp lại, dọn dẹp): true/false'),
  ('zalo.message_status_sync.organization_ids', 'all', 'Phạm vi: all hoặc danh sách mã tổ chức, ví dụ [1,9]'),
  ('zalo.message_status_sync.realtime_kinds', 'delivered,seen,reaction,reply,friend', 'Loại sự kiện khớp ngay khi nhận lô; để trống = chỉ lưu, chờ job'),
  ('zalo.message_status_sync.keep_raw_events', 'true', 'Giữ bản thô mọi sự kiện để kiểm quy tắc (tắt sau giai đoạn thí điểm): true/false'),
  ('zalo.message_status_sync.reply_window_days', '7', 'Số ngày tính "đã phản hồi" kể từ giờ gửi (1-30). Đã nhận/đã xem/đã tương tác không có hạn'),
  ('zalo.message_status_sync.reply_ignored_kinds', 'ecard,system', 'Loại tin đến không tính là phản hồi: message, sticker, call, ecard, system'),
  ('zalo.message_status_sync.seen_match_mode', 'message', 'message = khớp đúng mã tin; thread = tính cho mọi tin gửi trước đó trong hội thoại'),
  ('zalo.message_status_sync.track_friend_accept', 'false', 'Ghi nhận "đồng ý kết bạn": true/false'),
  ('zalo.message_status_sync.reconcile_window', '02:00-06:00', 'Khung giờ Việt Nam cho job phụ, HH:MM-HH:MM; 00:00-24:00 = cả ngày'),
  ('zalo.message_status_sync.reconcile_every_minutes', '5', 'Nhịp chạy job phụ trong khung giờ (5-1440 phút)'),
  ('zalo.message_status_sync.retention_days', '4', 'Số ngày giữ dòng trong bảng sự kiện gọn (1-30)'),
  ('zalo.message_status_sync.flush_interval_seconds', '60', 'Runtime gom bao lâu thì ghi một lô (30-600 giây)'),
  ('zalo.message_status_sync.flush_max_rows', '500', 'Số dòng tối đa mỗi lô (50-2000)'),
  ('zalo.message_status_sync.max_events_per_day', '1000000', 'Trần sự kiện mỗi ngày; vượt thì ngừng nhận tới hết ngày'),
  ('zalo.message_status_sync.update_result_status', 'true', 'Đưa bậc trạng thái (đã nhận, đã xem...) vào trạng thái phụ của kết quả chiến dịch theo quy tắc zalo.* trong auto_status_event_rules: true/false'),
  ('zalo.message_status_sync.result_status_max_per_minute', '600', 'Trần số kết quả chiến dịch được ghi cột trạng thái mỗi phút (0-6000); 0 = tạm ngừng ghi, vẫn xếp hàng')
) AS v(key, value, description);

-- ---------------------------------------------------------------------------
-- Lịch pg_cron. Cả hai tự thoát ngay khi đang tắt; job phụ còn thoát khi ngoài khung giờ cấu hình.
--   aka-agent-zalo-message-status          5 phút một lần: đăng ký bù, khớp lại phần chờ, dọn dẹp.
--   aka-agent-zalo-message-status-results  mỗi phút: ghi cột trạng thái của kết quả theo từng đợt nhỏ. Lệnh phải là đúng MỘT
--                                          câu CALL: thủ tục tự COMMIT giữa các đợt, và chỉ được phép làm vậy khi là câu lệnh
--                                          ngoài cùng.
-- ---------------------------------------------------------------------------
DO $schedule$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('aka-agent-zalo-message-status', '*/5 * * * *', 'SELECT private.auto_zalo_status_run(60);');
    PERFORM cron.schedule('aka-agent-zalo-message-status-results', '* * * * *', 'CALL private.auto_zalo_status_flush_results(40)');
  ELSE
    RAISE NOTICE 'pg_cron không có: bỏ qua đặt lịch aka-agent-zalo-message-status và aka-agent-zalo-message-status-results';
  END IF;
END
$schedule$;

-- ---------------------------------------------------------------------------
-- Thử các hàm quyền akaChat đúng như cách tính năng sẽ gọi chúng. Hàm lỗi thì dừng cài: nếu cứ cài, tính năng sẽ coi mọi
-- tài khoản là có akaChat và lặng lẽ không làm gì.
-- ---------------------------------------------------------------------------
DO $probe$
DECLARE
  v_account bigint;
BEGIN
  -- Một tài khoản có nhân viên phụ trách, để cả hai hàm quyền thật sự được gọi (tài khoản không có nhân viên phụ trách thì hàm
  -- bọc trả NULL mà không gọi hàm nào).
  SELECT a.id INTO v_account FROM public.auto_accounts a JOIN public.org_staff s ON s.id = a.staff_id ORDER BY a.id LIMIT 1;
  IF v_account IS NULL THEN
    RAISE NOTICE 'Không có tài khoản nào có nhân viên phụ trách: bỏ qua bước thử các hàm quyền akaChat';
  ELSE
    PERFORM private.auto_zalo_status_has_akachat(v_account);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'zalo_message_status_sync_access_helper_failed: % %', SQLSTATE, SQLERRM;
END
$probe$;

-- ---------------------------------------------------------------------------
-- Trigger: lệnh CUỐI CÙNG của migration. CREATE TRIGGER chặn mọi lượt ghi vào auto_campaign_details cho tới khi giao dịch
-- kết thúc, nên không lệnh nào được phép chạy (và chờ khoá) sau nó. Không lấy được khoá trong 2 giây thì bỏ cuộc, chạy lại.
-- Kết quả đã xoá mềm ngay từ lúc ghi thì không theo dõi.
-- ---------------------------------------------------------------------------
SET LOCAL lock_timeout = '2s';
CREATE TRIGGER trg_auto_zalo_status_register
  AFTER INSERT ON public.auto_campaign_details
  FOR EACH ROW WHEN (NEW.data ? 'zaloStatusRef' AND NEW.is_delete IS NOT TRUE)
  EXECUTE FUNCTION private.auto_zalo_status_on_detail_insert();

COMMIT;
