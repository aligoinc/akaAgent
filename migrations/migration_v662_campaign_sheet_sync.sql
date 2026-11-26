-- V662: Đồng bộ định kỳ từ Google Sheet vào data của chiến dịch (docs/CAMPAIGN_SHEET_SYNC_PLAN.md).
-- Chỉ thêm đối tượng mới: 2 bảng (thông tin + log), hàm cho Desktop / API Web / worker, dòng cài đặt
-- `campaign.sheet_sync` (worker tắt, ô chọn ẩn) và một khối gọi dispatch trong hàm tick 30 giây đang có.
-- Không ALTER bảng nóng, không trigger mới trên bảng nóng. DDL: apply buổi tối.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v662_%') THEN
    RAISE EXCEPTION 'v662 đã có trong sổ migration, không chạy lại';
  END IF;
  IF to_regclass('public.auto_campaign_sheet_syncs') IS NOT NULL OR to_regclass('public.auto_campaign_sheet_sync_logs') IS NOT NULL THEN
    RAISE EXCEPTION 'v662: bảng đồng bộ Sheet của chiến dịch đã tồn tại';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_data_group_background_tick()'::regprocedure)) IS DISTINCT FROM '10a2465bf8273b269ed5123344cff4db' THEN
    RAISE EXCEPTION 'v662: aka_agent_data_group_background_tick đã khác bản đã đọc 26/11/2026';
  END IF;
  IF to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL
    OR to_regprocedure('public.aka_agent_get_vault_secret(text)') IS NULL
    OR to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL
    OR to_regclass('public.auto_campaign_logs') IS NULL
    OR to_regclass('public.auto_campaign_data_group_sources') IS NULL THEN
    RAISE EXCEPTION 'v662: thiếu đối tượng phụ thuộc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'campaign.sheet_sync') THEN
    RAISE EXCEPTION 'v662: dòng cài đặt campaign.sheet_sync đã có';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------------------------
-- Bảng thông tin: mỗi nguồn đồng bộ một dòng (một link Sheet cấp data cho một hoặc nhiều chiến dịch).
CREATE TABLE public.auto_campaign_sheet_syncs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  action_id text NOT NULL,
  -- {url, hasHeader, mapping{field:col}, expectedHeaders[], columnCount, phonePolicy, targetField, platform}
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND octet_length(config::text) <= 65536),
  every_hours integer NOT NULL CHECK (every_hours BETWEEN 1 AND 24),
  end_date date NOT NULL,
  split_mode text NOT NULL CHECK (split_mode IN ('split', 'all')),
  split_cursor integer NOT NULL DEFAULT 0 CHECK (split_cursor >= 0),
  -- Chiến dịch đang nhận; `campaigns` giữ mọi chiến dịch từng nhận:
  -- [{campaignId, position, state: active|left, leftReason, joinedAt, leftAt, added}]
  campaign_ids bigint[] NOT NULL DEFAULT '{}',
  campaigns jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(campaigns) = 'array'),
  -- Khoá các dòng cửa sổ Upload đã đọc mà không thêm vào chiến dịch nào (mốc ban đầu).
  skipped_keys text[] NOT NULL DEFAULT '{}' CHECK (cardinality(skipped_keys) <= 20000),
  is_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'retry', 'error', 'expired', 'paused')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_added integer NOT NULL DEFAULT 0,
  total_added bigint NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_error_message text,
  stopped_reason text,
  stopped_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  revision bigint NOT NULL DEFAULT 1,
  create_request_id text NOT NULL CHECK (create_request_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  create_request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, organization_id, create_request_id)
);
CREATE INDEX idx_campaign_sheet_syncs_due ON public.auto_campaign_sheet_syncs (next_run_at, id)
  WHERE is_enabled AND status IN ('pending', 'running', 'success', 'retry');
CREATE INDEX idx_campaign_sheet_syncs_staff ON public.auto_campaign_sheet_syncs (staff_id, organization_id);
CREATE INDEX idx_campaign_sheet_syncs_campaign_ids ON public.auto_campaign_sheet_syncs USING gin (campaign_ids);
CREATE INDEX idx_campaign_sheet_syncs_campaigns ON public.auto_campaign_sheet_syncs USING gin (campaigns jsonb_path_ops);

-- Bảng log: mỗi sự kiện một dòng, giữ 30 ngày.
CREATE TABLE public.auto_campaign_sheet_sync_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_id bigint NOT NULL REFERENCES public.auto_campaign_sheet_syncs(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('run', 'enable', 'edit', 'disable', 'resume', 'stop', 'campaign_left')),
  actor text NOT NULL CHECK (actor IN ('staff', 'system')),
  run_token uuid,
  status text CHECK (status IN ('running', 'success', 'error', 'interrupted')),
  started_at timestamptz,
  finished_at timestamptz,
  rows_read integer,
  added integer,
  duplicates integer,
  invalid integer,
  per_campaign jsonb,
  error_code text,
  error_message text,
  detail jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaign_sheet_sync_logs_sync ON public.auto_campaign_sheet_sync_logs (sync_id, id DESC);
CREATE INDEX idx_campaign_sheet_sync_logs_created ON public.auto_campaign_sheet_sync_logs (created_at);
CREATE UNIQUE INDEX uq_campaign_sheet_sync_logs_run_token ON public.auto_campaign_sheet_sync_logs (run_token)
  WHERE run_token IS NOT NULL;

ALTER TABLE public.auto_campaign_sheet_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_sheet_sync_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_campaign_sheet_syncs, public.auto_campaign_sheet_sync_logs
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
COMMENT ON TABLE public.auto_campaign_sheet_syncs IS
  'V662: nguồn đồng bộ Google Sheet của chiến dịch. Chỉ đọc / ghi qua hàm aka_agent_*campaign_sheet*.';
COMMENT ON TABLE public.auto_campaign_sheet_sync_logs IS
  'V662: log đồng bộ Google Sheet của chiến dịch (lượt chạy + thao tác), giữ 30 ngày.';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('campaign.sheet_sync',
  '{"audience":"off","worker":false,"maxSourcesPerStaff":20,"minEveryHours":1}',
  'Đồng bộ Google Sheet vào data chiến dịch (V662). audience off|admin_akabiz|all: ai thấy ô bật đồng bộ; worker: chạy đồng bộ nền.',
  false, true);

-- ---------------------------------------------------------------------------------------------
-- Hàm phụ (private)

CREATE FUNCTION private.aka_agent_campaign_sheet_setting()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT s.value::jsonb INTO v FROM public.auto_system_settings s WHERE s.key = 'campaign.sheet_sync' AND s.is_active;
  EXCEPTION WHEN OTHERS THEN v := NULL;
  END;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN v := '{}'::jsonb; END IF;
  RETURN jsonb_build_object(
    'audience', CASE WHEN v->>'audience' IN ('off', 'admin_akabiz', 'all') THEN v->>'audience' ELSE 'off' END,
    'worker', COALESCE(jsonb_typeof(v->'worker') = 'boolean' AND (v->>'worker')::boolean, false),
    'maxSourcesPerStaff', CASE WHEN COALESCE(v->>'maxSourcesPerStaff', '') ~ '^[0-9]{1,4}$'
      THEN LEAST(GREATEST((v->>'maxSourcesPerStaff')::integer, 1), 500) ELSE 20 END,
    'minEveryHours', CASE WHEN COALESCE(v->>'minEveryHours', '') ~ '^[0-9]{1,2}$'
      THEN LEAST(GREATEST((v->>'minEveryHours')::integer, 1), 24) ELSE 1 END);
END
$fn$;

CREATE FUNCTION private.aka_agent_campaign_sheet_today()
RETURNS date LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
$fn$;

-- Loại chiến dịch bật được đồng bộ ở đợt 1 (data nhập trực tiếp, có tab Link sheet). SMS / gọi tự động: đợt 2.
CREATE FUNCTION private.aka_agent_campaign_sheet_action_allowed(p_action_id text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$
  SELECT p_action_id = ANY (ARRAY[
    'zalo_message_phone', 'zalo_message_friend', 'zalo_message_group', 'zalo_message_group_member',
    'zalo_join_group_link', 'zalo_add_group_member',
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid', 'facebook_comment_seeding',
    'facebook_comment_seeding_post', 'facebook_find_data_group', 'facebook_find_data_search', 'facebook_group_invite',
    'email_send']);
$fn$;

-- Khoảng trắng theo nghĩa `\s` của JavaScript (app dùng trim / \s+): ASCII + NBSP + khoảng trắng Unicode + BOM.
CREATE FUNCTION private.aka_agent_campaign_sheet_trim(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $fn$
  SELECT regexp_replace(p_value, '^[\s   -     　﻿]+|[\s   -     　﻿]+$', '', 'g');
$fn$;
CREATE FUNCTION private.aka_agent_campaign_sheet_space(p_value text, p_with text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $fn$
  SELECT regexp_replace(p_value, '[\s   -     　﻿]+', p_with, 'g');
$fn$;

-- Khoá so trùng của một người nhận, cùng luật với cửa sổ Upload (src/shared/campaignImportVerification.ts):
-- SĐT chuẩn hoá; email theo isValidEmailInputDataValue rồi chữ thường; UID bỏ khoảng trắng và "/" cuối; UID Zalo chỉ số;
-- link group Zalo về https://zalo.me/g/<mã>; từ khoá tìm kiếm gộp khoảng trắng + chữ thường. Quá 2.048 ký tự: không nhận.
CREATE FUNCTION private.aka_agent_campaign_sheet_key(p_field text, p_action_id text, p_phone text, p_uid text, p_email text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $fn$
  SELECT CASE p_field
    WHEN 'phone' THEN NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '')
    WHEN 'email' THEN (SELECT e FROM (SELECT lower(private.aka_agent_campaign_sheet_trim(p_email)) AS e) z
      WHERE length(e) <= 254
        AND e ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
        AND split_part(e, '@', 1) !~ '(^\.|\.$|\.\.)' AND length(split_part(e, '@', 2)) <= 253)
    ELSE (SELECT CASE WHEN length(v) <= 2048 THEN NULLIF(v, '') END FROM (SELECT CASE
      WHEN p_action_id = 'facebook_find_data_search' THEN lower(private.aka_agent_campaign_sheet_space(private.aka_agent_campaign_sheet_trim(p_uid), ' '))
      WHEN p_action_id = 'zalo_message_group_member' THEN (SELECT u FROM (SELECT private.aka_agent_campaign_sheet_space(p_uid, '') AS u) z WHERE u ~ '^[0-9]{5,30}$')
      WHEN p_action_id = 'zalo_join_group_link' THEN (SELECT 'https://zalo.me/g/' || m[1]
        FROM regexp_match(private.aka_agent_campaign_sheet_trim(p_uid), '^(?:https?://)?(?:[^/?#\s]*\.)?(?:zalo\.me/g|zaloapp\.com/qr/g)/([^/?#\s]+)', 'i') m)
      ELSE regexp_replace(private.aka_agent_campaign_sheet_space(p_uid, ''), '/+$', '') END AS v) x)
  END;
$fn$;

-- Chiến dịch còn nhận được data từ nguồn không; trả lý do rời nguồn, NULL = còn nhận.
CREATE FUNCTION private.aka_agent_campaign_sheet_campaign_issue(
  p_campaign_id bigint, p_staff_id bigint, p_organization_id bigint, p_action_id text
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE c record;
BEGIN
  SELECT x.id, x.staff_id, x.organization_id, x.action_id, x.is_delete, x.data_group_id, x.schedule_end_date
    INTO c FROM public.auto_campaigns x WHERE x.id = p_campaign_id;
  IF NOT FOUND OR COALESCE(c.is_delete, false) THEN RETURN 'campaign_deleted'; END IF;
  IF c.staff_id IS DISTINCT FROM p_staff_id OR c.organization_id IS DISTINCT FROM p_organization_id THEN RETURN 'campaign_moved'; END IF;
  IF c.action_id IS DISTINCT FROM p_action_id OR NOT private.aka_agent_campaign_sheet_action_allowed(c.action_id) THEN
    RETURN 'campaign_type_changed';
  END IF;
  IF c.data_group_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.auto_campaign_data_group_sources g
     WHERE g.campaign_id = p_campaign_id AND g.status IN ('active', 'baselining')) THEN
    RETURN 'campaign_data_group';
  END IF;
  IF to_regclass('public.auto_journey_step_campaigns') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.auto_journey_step_campaigns j WHERE j.campaign_id = p_campaign_id) THEN
      RETURN 'campaign_journey';
    END IF;
  END IF;
  IF c.schedule_end_date IS NOT NULL
     AND (c.schedule_end_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < private.aka_agent_campaign_sheet_today() THEN
    RETURN 'campaign_schedule_ended';
  END IF;
  RETURN NULL;
END
$fn$;

CREATE FUNCTION private.aka_agent_campaign_sheet_view(s public.auto_campaign_sheet_syncs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $fn$
  SELECT jsonb_build_object(
    'id', s.id, 'revision', s.revision, 'actionId', s.action_id,
    'config', s.config - 'expectedHeaders',
    'everyHours', s.every_hours, 'endDate', to_char(s.end_date, 'YYYY-MM-DD'), 'splitMode', s.split_mode,
    'campaignIds', to_jsonb(s.campaign_ids), 'campaigns', s.campaigns,
    'isEnabled', s.is_enabled, 'status', s.status,
    'nextRunAt', s.next_run_at, 'lastRunAt', s.last_run_at, 'lastSuccessAt', s.last_success_at,
    'lastAdded', s.last_added, 'totalAdded', s.total_added, 'retryCount', s.retry_count,
    'lastErrorCode', s.last_error_code, 'lastErrorMessage', s.last_error_message,
    'stoppedReason', s.stopped_reason, 'stoppedAt', s.stopped_at,
    'createdAt', s.created_at, 'updatedAt', s.updated_at);
$fn$;

CREATE FUNCTION private.aka_agent_campaign_sheet_log(
  p_sync public.auto_campaign_sheet_syncs, p_kind text, p_actor text, p_detail jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  INSERT INTO public.auto_campaign_sheet_sync_logs (sync_id, organization_id, staff_id, kind, actor, detail, error_code, error_message)
  VALUES (p_sync.id, p_sync.organization_id, p_sync.staff_id, p_kind, p_actor, p_detail, p_error_code, left(p_error_message, 1000));
$fn$;

CREATE FUNCTION private.aka_agent_campaign_sheet_validate_config(p_config jsonb, p_action_id text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $fn$
DECLARE v_target text := p_config->>'targetField'; v_key text; v_col text;
BEGIN
  IF jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR octet_length(p_config::text) > 65536
    OR COALESCE(p_config->>'url', '') !~ '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{10,200}/edit(#gid=[0-9]{1,20})?$'
    OR jsonb_typeof(p_config->'hasHeader') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_config->'mapping') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_config->'expectedHeaders') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_config->'expectedHeaders') > 512
    OR COALESCE(p_config->>'columnCount', '') !~ '^[0-9]{1,3}$'
    OR COALESCE(p_config->>'phonePolicy', '') NOT IN ('first', 'discard', 'all')
    OR COALESCE(v_target, '') NOT IN ('phone', 'uid', 'email')
    OR COALESCE(p_config->>'platform', '') NOT IN ('zalo', 'facebook', 'email')
    OR (p_action_id = 'email_send' AND v_target <> 'email')
    OR (p_action_id IN ('zalo_message_phone', 'zalo_add_group_member') AND v_target <> 'phone')
    OR NOT (p_config->'mapping' ? v_target)
  THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
  FOR v_key, v_col IN SELECT key, value #>> '{}' FROM jsonb_each(p_config->'mapping') LOOP
    IF v_key NOT IN ('name', 'uid', 'phone', 'email', 'info1', 'info2', 'info3', 'info4', 'info5')
      OR COALESCE(v_col, '') !~ '^[0-9]{1,3}$' OR v_col::integer >= (p_config->>'columnCount')::integer THEN
      RAISE EXCEPTION 'sheet_sync_config';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_config->'expectedHeaders') h
              WHERE jsonb_typeof(h) <> 'string' OR length(h #>> '{}') > 500) THEN
    RAISE EXCEPTION 'sheet_sync_config';
  END IF;
END
$fn$;

-- Khoá của các giá trị đã đọc (mảng chuỗi) không có trong data của các chiến dịch và không nằm trong p_exclude.
-- Khoá data đang có được tính một lần rồi so bằng phép nối băm, không so từng dòng với từng dòng.
CREATE FUNCTION private.aka_agent_campaign_sheet_unmatched_keys(
  p_field text, p_action_id text, p_values jsonb, p_campaign_ids bigint[], p_exclude text[]
) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  WITH incoming AS MATERIALIZED (
    SELECT DISTINCT private.aka_agent_campaign_sheet_key(p_field, p_action_id, x, x, x) AS key
      FROM jsonb_array_elements_text(COALESCE(p_values, '[]'::jsonb)) x
  ), existing AS MATERIALIZED (
    SELECT DISTINCT k.key FROM public.auto_campaign_input_data d
     CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(p_field, p_action_id, d.phone, d.uid, d.email) AS key) k
     WHERE d.campaign_id = ANY (COALESCE(p_campaign_ids, '{}')) AND k.key IS NOT NULL
  )
  SELECT COALESCE(array_agg(i.key ORDER BY i.key), '{}') FROM incoming i
   WHERE i.key IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM existing e WHERE e.key = i.key)
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_exclude, '{}')) s(k) WHERE s.k = i.key);
$fn$;

-- Lõi thao tác của Desktop và API Web. p_actor_admin: nhân viên là admin akaBiz (dùng cho audience admin_akabiz).
CREATE FUNCTION private.aka_agent_campaign_sheet_sync_core(
  p_staff_id bigint, p_organization_id bigint, p_actor_admin boolean, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_action text := p_payload->>'action';
  v_setting jsonb := private.aka_agent_campaign_sheet_setting();
  v_sync public.auto_campaign_sheet_syncs%ROWTYPE;
  v_campaign_id bigint; v_ids bigint[]; v_id bigint; v_issue text; v_action_id text;
  v_hours integer; v_end date; v_today date := private.aka_agent_campaign_sheet_today();
  v_split text; v_config jsonb; v_hash text; v_skipped text[]; v_campaigns jsonb; v_pos integer;
  v_limit integer; v_count integer; v_entry jsonb; v_new_ids bigint[];
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL THEN RAISE EXCEPTION 'sheet_sync_unauthorized' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;

  IF v_action = 'settings' THEN
    RETURN jsonb_build_object('available', v_setting->>'audience' = 'all' OR (v_setting->>'audience' = 'admin_akabiz' AND p_actor_admin),
      'maxSourcesPerStaff', v_setting->'maxSourcesPerStaff', 'minEveryHours', v_setting->'minEveryHours');
  END IF;

  IF v_action = 'state' THEN
    IF COALESCE(p_payload->>'campaignId', '') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;
    v_campaign_id := (p_payload->>'campaignId')::bigint;
    SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs s
     WHERE s.staff_id = p_staff_id AND s.organization_id = p_organization_id
       AND s.campaigns @> jsonb_build_array(jsonb_build_object('campaignId', v_campaign_id))
     ORDER BY (v_campaign_id = ANY (s.campaign_ids)) DESC, s.id DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('sync', NULL); END IF;
    RETURN jsonb_build_object('sync', private.aka_agent_campaign_sheet_view(v_sync),
      'active', v_campaign_id = ANY (v_sync.campaign_ids));
  END IF;

  IF v_action = 'list' THEN
    IF jsonb_typeof(p_payload->'campaignIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'campaignIds') > 500 THEN
      RAISE EXCEPTION 'sheet_sync_invalid';
    END IF;
    SELECT COALESCE(array_agg(x::bigint), '{}') INTO v_ids
      FROM jsonb_array_elements_text(p_payload->'campaignIds') x WHERE x ~ '^[1-9][0-9]{0,17}$';
    RETURN jsonb_build_object('items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('campaignId', c, 'syncId', s.id, 'status', s.status, 'isEnabled', s.is_enabled,
               'everyHours', s.every_hours, 'endDate', to_char(s.end_date, 'YYYY-MM-DD'), 'lastErrorCode', s.last_error_code))
        FROM public.auto_campaign_sheet_syncs s CROSS JOIN LATERAL unnest(s.campaign_ids) c
       WHERE s.staff_id = p_staff_id AND s.organization_id = p_organization_id
         AND s.campaign_ids && v_ids AND c = ANY (v_ids)), '[]'::jsonb));
  END IF;

  IF v_action = 'runs' THEN
    IF COALESCE(p_payload->>'syncId', '') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;
    SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs
     WHERE id = (p_payload->>'syncId')::bigint AND staff_id = p_staff_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_not_found'; END IF;
    RETURN jsonb_build_object('runs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'actor', l.actor, 'status', l.status,
               'startedAt', l.started_at, 'finishedAt', l.finished_at, 'createdAt', l.created_at,
               'rowsRead', l.rows_read, 'added', l.added, 'duplicates', l.duplicates, 'invalid', l.invalid,
               'perCampaign', l.per_campaign, 'errorCode', l.error_code, 'errorMessage', l.error_message,
               'detail', l.detail) ORDER BY l.id DESC)
        FROM (SELECT * FROM public.auto_campaign_sheet_sync_logs
               WHERE sync_id = v_sync.id ORDER BY id DESC LIMIT 30) l), '[]'::jsonb));
  END IF;

  IF v_action NOT IN ('save', 'stop', 'resume') THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;

  -- Một khoá cho mọi thao tác ghi của nhân viên: luật "mỗi chiến dịch một nguồn đang bật" không đặt được bằng chỉ mục.
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-sheet-sync-staff:' || p_staff_id::text, 662));

  IF v_action = 'save' THEN
    IF NOT (v_setting->>'audience' = 'all' OR (v_setting->>'audience' = 'admin_akabiz' AND p_actor_admin)) THEN
      RAISE EXCEPTION 'sheet_sync_unavailable';
    END IF;
    IF COALESCE(p_payload->>'everyHours', '') !~ '^[0-9]{1,2}$' OR COALESCE(p_payload->>'endDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
      OR COALESCE(p_payload->>'splitMode', '') NOT IN ('split', 'all')
      OR (p_payload ? 'sheetValues' AND (jsonb_typeof(p_payload->'sheetValues') <> 'array'
          OR jsonb_array_length(p_payload->'sheetValues') > 20000)) THEN
      RAISE EXCEPTION 'sheet_sync_invalid';
    END IF;
    v_hours := (p_payload->>'everyHours')::integer;
    BEGIN v_end := (p_payload->>'endDate')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sheet_sync_invalid'; END;
    IF v_hours < (v_setting->>'minEveryHours')::integer OR v_hours > 24 THEN RAISE EXCEPTION 'sheet_sync_every_hours'; END IF;
    IF v_end < v_today OR v_end > v_today + 365 THEN RAISE EXCEPTION 'sheet_sync_end_date'; END IF;
    v_split := p_payload->>'splitMode';

    IF p_payload->>'syncId' IS NULL THEN
      -- Tạo mới.
      IF COALESCE(p_payload->>'requestId', '') !~ '^[A-Za-z0-9_-]{1,100}$'
        OR jsonb_typeof(p_payload->'campaignIds') IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_payload->'campaignIds') NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'sheet_sync_invalid';
      END IF;
      v_hash := md5((p_payload - 'requestId')::text);
      SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs
       WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND create_request_id = p_payload->>'requestId';
      IF FOUND THEN
        IF v_sync.create_request_hash <> v_hash THEN RAISE EXCEPTION 'sheet_sync_conflict'; END IF;
        RETURN jsonb_build_object('sync', private.aka_agent_campaign_sheet_view(v_sync), 'replayed', true);
      END IF;
      SELECT array_agg(DISTINCT x::bigint ORDER BY x::bigint) INTO v_ids
        FROM jsonb_array_elements_text(p_payload->'campaignIds') x;
      IF EXISTS (SELECT 1 FROM unnest(v_ids) i WHERE i IS NULL OR i <= 0) THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;
      SELECT c.action_id INTO v_action_id FROM public.auto_campaigns c WHERE c.id = v_ids[1];
      FOREACH v_id IN ARRAY v_ids LOOP
        v_issue := private.aka_agent_campaign_sheet_campaign_issue(v_id, p_staff_id, p_organization_id, v_action_id);
        IF v_issue IS NOT NULL THEN
          RAISE EXCEPTION 'sheet_sync_campaign_invalid' USING DETAIL = jsonb_build_object('campaignId', v_id, 'reason', v_issue)::text;
        END IF;
      END LOOP;
      IF EXISTS (SELECT 1 FROM public.auto_campaign_sheet_syncs s
                  WHERE s.staff_id = p_staff_id AND s.organization_id = p_organization_id AND s.campaign_ids && v_ids) THEN
        RAISE EXCEPTION 'sheet_sync_campaign_taken';
      END IF;
      v_limit := (v_setting->>'maxSourcesPerStaff')::integer;
      SELECT count(*) INTO v_count FROM public.auto_campaign_sheet_syncs
       WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND is_enabled;
      IF v_count >= v_limit THEN RAISE EXCEPTION 'sheet_sync_limit' USING DETAIL = v_limit::text; END IF;
      v_config := p_payload->'config';
      PERFORM private.aka_agent_campaign_sheet_validate_config(v_config, v_action_id);
      v_config := jsonb_build_object('url', v_config->'url', 'hasHeader', v_config->'hasHeader', 'mapping', v_config->'mapping',
        'expectedHeaders', v_config->'expectedHeaders', 'columnCount', (v_config->>'columnCount')::integer,
        'phonePolicy', v_config->'phonePolicy', 'targetField', v_config->'targetField', 'platform', v_config->'platform');
      -- Mốc ban đầu: dòng cửa sổ Upload đã đọc mà không có trong data của các chiến dịch này.
      v_skipped := private.aka_agent_campaign_sheet_unmatched_keys(v_config->>'targetField', v_action_id,
        COALESCE(p_payload->'sheetValues', '[]'::jsonb), v_ids, '{}');
      SELECT jsonb_agg(jsonb_build_object('campaignId', i, 'position', o - 1, 'state', 'active', 'joinedAt', clock_timestamp(),
               'added', 0) ORDER BY o)
        INTO v_campaigns FROM unnest(v_ids) WITH ORDINALITY AS t(i, o);
      INSERT INTO public.auto_campaign_sheet_syncs (organization_id, staff_id, action_id, config, every_hours, end_date,
        split_mode, campaign_ids, campaigns, skipped_keys, is_enabled, status, next_run_at, create_request_id, create_request_hash)
      VALUES (p_organization_id, p_staff_id, v_action_id, v_config, v_hours, v_end, v_split, v_ids, v_campaigns,
        v_skipped[1:20000], true, 'pending', clock_timestamp(), p_payload->>'requestId', v_hash)
      RETURNING * INTO v_sync;
      PERFORM private.aka_agent_campaign_sheet_log(v_sync, 'enable', 'staff',
        jsonb_build_object('campaignIds', to_jsonb(v_ids), 'everyHours', v_hours, 'endDate', v_end, 'splitMode', v_split,
          'skippedKeys', cardinality(v_skipped)));
      RETURN jsonb_build_object('sync', private.aka_agent_campaign_sheet_view(v_sync), 'replayed', false);
    END IF;

    -- Sửa nguồn đang có: chu kỳ, ngày dừng, và (nếu gửi) kết nối + ghép cột lại. Danh sách chiến dịch giữ nguyên.
    IF COALESCE(p_payload->>'syncId', '') !~ '^[1-9][0-9]{0,17}$' OR COALESCE(p_payload->>'expectedRevision', '') !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'sheet_sync_invalid';
    END IF;
    SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs
     WHERE id = (p_payload->>'syncId')::bigint AND staff_id = p_staff_id AND organization_id = p_organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_not_found'; END IF;
    IF v_sync.revision <> (p_payload->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'sheet_sync_conflict'; END IF;
    v_config := v_sync.config;
    IF p_payload ? 'config' THEN
      PERFORM private.aka_agent_campaign_sheet_validate_config(p_payload->'config', v_sync.action_id);
      IF (p_payload->'config'->>'targetField') IS DISTINCT FROM (v_sync.config->>'targetField') THEN
        RAISE EXCEPTION 'sheet_sync_config';
      END IF;
      v_config := jsonb_build_object('url', p_payload->'config'->'url', 'hasHeader', p_payload->'config'->'hasHeader',
        'mapping', p_payload->'config'->'mapping', 'expectedHeaders', p_payload->'config'->'expectedHeaders',
        'columnCount', (p_payload->'config'->>'columnCount')::integer, 'phonePolicy', p_payload->'config'->'phonePolicy',
        'targetField', p_payload->'config'->'targetField', 'platform', p_payload->'config'->'platform');
    END IF;
    IF cardinality(v_sync.campaign_ids) = 0 THEN RAISE EXCEPTION 'sheet_sync_no_campaign'; END IF;
    IF NOT v_sync.is_enabled THEN
      v_limit := (v_setting->>'maxSourcesPerStaff')::integer;
      SELECT count(*) INTO v_count FROM public.auto_campaign_sheet_syncs
       WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND is_enabled;
      IF v_count >= v_limit THEN RAISE EXCEPTION 'sheet_sync_limit' USING DETAIL = v_limit::text; END IF;
    END IF;
    -- Link mới: dòng đã đọc mà chưa có trong data của chiến dịch nào từng nhận cũng là mốc.
    IF p_payload ? 'sheetValues' THEN
      SELECT array_agg((e->>'campaignId')::bigint) INTO v_ids FROM jsonb_array_elements(v_sync.campaigns) e;
      v_skipped := private.aka_agent_campaign_sheet_unmatched_keys(v_config->>'targetField', v_sync.action_id,
        p_payload->'sheetValues', v_ids, v_sync.skipped_keys);
      v_skipped := (v_sync.skipped_keys || v_skipped)[1:20000];
    ELSE
      v_skipped := v_sync.skipped_keys;
    END IF;
    UPDATE public.auto_campaign_sheet_syncs SET config = v_config, every_hours = v_hours, end_date = v_end,
      split_mode = v_split, skipped_keys = v_skipped, is_enabled = true, status = 'pending', next_run_at = clock_timestamp(),
      retry_count = 0, last_error_code = NULL, last_error_message = NULL, stopped_reason = NULL, stopped_at = NULL,
      lease_token = NULL, lease_until = NULL, revision = revision + 1, updated_at = clock_timestamp()
     WHERE id = v_sync.id RETURNING * INTO v_sync;
    UPDATE public.auto_campaign_sheet_sync_logs SET status = 'interrupted', finished_at = clock_timestamp(),
      error_message = 'Nguồn đã được cấu hình lại.' WHERE sync_id = v_sync.id AND kind = 'run' AND status = 'running';
    PERFORM private.aka_agent_campaign_sheet_log(v_sync, 'edit', 'staff',
      jsonb_build_object('everyHours', v_hours, 'endDate', v_end, 'reconnected', p_payload ? 'config'));
    RETURN jsonb_build_object('sync', private.aka_agent_campaign_sheet_view(v_sync), 'replayed', false);
  END IF;

  -- stop / resume theo từng chiến dịch.
  IF COALESCE(p_payload->>'syncId', '') !~ '^[1-9][0-9]{0,17}$' OR COALESCE(p_payload->>'campaignId', '') !~ '^[1-9][0-9]{0,17}$' THEN
    RAISE EXCEPTION 'sheet_sync_invalid';
  END IF;
  v_campaign_id := (p_payload->>'campaignId')::bigint;
  SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs
   WHERE id = (p_payload->>'syncId')::bigint AND staff_id = p_staff_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR NOT v_sync.campaigns @> jsonb_build_array(jsonb_build_object('campaignId', v_campaign_id)) THEN
    RAISE EXCEPTION 'sheet_sync_not_found';
  END IF;

  IF v_action = 'stop' THEN
    IF NOT (v_campaign_id = ANY (v_sync.campaign_ids)) AND NOT v_sync.is_enabled THEN
      RETURN jsonb_build_object('sync', private.aka_agent_campaign_sheet_view(v_sync), 'changed', false);
    END IF;
    SELECT jsonb_agg(CASE WHEN (e->>'campaignId')::bigint = v_campaign_id AND e->>'state' = 'active'
             THEN e || jsonb_build_object('state', 'left', 'leftReason', 'staff_off', 'leftAt', clock_timestamp()) ELSE e END
             ORDER BY o)
      INTO v_campaigns FROM jsonb_array_elements(v_sync.campaigns) WITH ORDINALITY AS t(e, o);
    v_new_ids := array_remove(v_sync.campaign_ids, v_campaign_id);
    UPDATE public.auto_campaign_sheet_syncs SET campaign_ids = v_new_ids, campaigns = v_campaigns,
      is_enabled = cardinality(v_new_ids) > 0 AND is_enabled,
      status = CASE WHEN cardinality(v_new_ids) = 0 THEN 'paused' ELSE status END,
      stopped_reason = CASE WHEN cardinality(v_new_ids) = 0 THEN 'staff_off' ELSE stopped_reason END,
      stopped_at = CASE WHEN cardinality(v_new_ids) = 0 THEN clock_timestamp() ELSE stopped_at END,
      lease_token = CASE WHEN cardinality(v_new_ids) = 0 THEN NULL ELSE lease_token END,
      lease_until = CASE WHEN cardinality(v_new_ids) = 0 THEN NULL ELSE lease_until END,
      revision = revision + 1, updated_at = clock_timestamp()
     WHERE id = v_sync.id RETURNING * INTO v_sync;
    PERFORM private.aka_agent_campaign_sheet_log(v_sync, 'disable', 'staff', jsonb_build_object('campaignId', v_campaign_id));
    RETURN jsonb_build_object('sync', private.aka_agent_campaign_sheet_view(v_sync), 'changed', true);
  END IF;

  -- resume: chiến dịch nhận lại data; nguồn lỗi do cột / quyền phải Sửa (kết nối lại) trước.
  IF v_sync.status = 'error' AND COALESCE(v_sync.last_error_code, '') IN ('sheet_columns_changed', 'sheet_config') THEN
    RAISE EXCEPTION 'sheet_sync_requires_save';
  END IF;
  IF p_payload ? 'endDate' THEN
    IF COALESCE(p_payload->>'endDate', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;
    BEGIN v_end := (p_payload->>'endDate')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sheet_sync_invalid'; END;
  ELSE
    v_end := v_sync.end_date;
  END IF;
  IF v_end < v_today OR v_end > v_today + 365 THEN RAISE EXCEPTION 'sheet_sync_end_date'; END IF;
  v_issue := private.aka_agent_campaign_sheet_campaign_issue(v_campaign_id, p_staff_id, p_organization_id, v_sync.action_id);
  IF v_issue IS NOT NULL THEN
    RAISE EXCEPTION 'sheet_sync_campaign_invalid' USING DETAIL = jsonb_build_object('campaignId', v_campaign_id, 'reason', v_issue)::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaign_sheet_syncs s
              WHERE s.staff_id = p_staff_id AND s.organization_id = p_organization_id AND s.id <> v_sync.id
                AND v_campaign_id = ANY (s.campaign_ids)) THEN
    RAISE EXCEPTION 'sheet_sync_campaign_taken';
  END IF;
  IF NOT v_sync.is_enabled THEN
    v_limit := (v_setting->>'maxSourcesPerStaff')::integer;
    SELECT count(*) INTO v_count FROM public.auto_campaign_sheet_syncs
     WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND is_enabled;
    IF v_count >= v_limit THEN RAISE EXCEPTION 'sheet_sync_limit' USING DETAIL = v_limit::text; END IF;
  END IF;
  SELECT jsonb_agg(CASE WHEN (e->>'campaignId')::bigint = v_campaign_id
           THEN (e - 'leftReason' - 'leftAt') || jsonb_build_object('state', 'active') ELSE e END ORDER BY o)
    INTO v_campaigns FROM jsonb_array_elements(v_sync.campaigns) WITH ORDINALITY AS t(e, o);
  v_new_ids := CASE WHEN v_campaign_id = ANY (v_sync.campaign_ids) THEN v_sync.campaign_ids
    ELSE (SELECT array_agg(x ORDER BY x) FROM unnest(v_sync.campaign_ids || v_campaign_id) x) END;
  UPDATE public.auto_campaign_sheet_syncs SET campaign_ids = v_new_ids, campaigns = v_campaigns, end_date = v_end,
    is_enabled = true, status = 'pending', next_run_at = clock_timestamp(), retry_count = 0,
    last_error_code = NULL, last_error_message = NULL, stopped_reason = NULL, stopped_at = NULL,
    lease_token = NULL, lease_until = NULL, revision = revision + 1, updated_at = clock_timestamp()
   WHERE id = v_sync.id RETURNING * INTO v_sync;
  PERFORM private.aka_agent_campaign_sheet_log(v_sync, 'resume', 'staff',
    jsonb_build_object('campaignId', v_campaign_id, 'endDate', v_end));
  RETURN jsonb_build_object('sync', private.aka_agent_campaign_sheet_view(v_sync), 'changed', true);
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Hàm cho Desktop (phiên Desktop) và API Web (service_role).

CREATE FUNCTION public.aka_agent_campaign_sheet_sync(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '20s' AS $fn$
DECLARE v_ctx record;
BEGIN
  SELECT ctx.staff_id, ctx.organization_id, ctx.system_admin INTO v_ctx FROM private.aka_agent_desktop_data_context() ctx LIMIT 1;
  IF v_ctx.staff_id IS NULL THEN RAISE EXCEPTION 'sheet_sync_unauthorized' USING ERRCODE = '42501'; END IF;
  RETURN private.aka_agent_campaign_sheet_sync_core(v_ctx.staff_id, v_ctx.organization_id, COALESCE(v_ctx.system_admin, false), p_payload);
END
$fn$;

CREATE FUNCTION public.aka_agent_control_campaign_sheet_sync(p_staff_id bigint, p_organization_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '20s' AS $fn$
DECLARE v_admin boolean;
BEGIN
  SELECT COALESCE(s.is_admin_akabiz AND s.is_active AND s.deleted_at IS NULL, false) INTO v_admin
    FROM public.org_staff s WHERE s.id = p_staff_id AND s.organization_id = p_organization_id AND s.is_active AND s.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_unauthorized' USING ERRCODE = '42501'; END IF;
  RETURN private.aka_agent_campaign_sheet_sync_core(p_staff_id, p_organization_id, v_admin, p_payload);
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Worker: dispatch (job 30 giây) → Edge Function → claim → đọc Sheet → finish.

CREATE FUNCTION public.aka_agent_campaign_sheet_dispatch()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE v_setting jsonb := private.aka_agent_campaign_sheet_setting(); v_secret text; v_request bigint;
BEGIN
  -- Dọn log cũ (nhẹ, theo chỉ mục created_at).
  DELETE FROM public.auto_campaign_sheet_sync_logs WHERE id IN (
    SELECT id FROM public.auto_campaign_sheet_sync_logs WHERE created_at < now() - interval '30 days' ORDER BY created_at LIMIT 2000);
  IF NOT (v_setting->>'worker')::boolean THEN RETURN NULL; END IF;
  -- Một làn: còn nguồn đang được giữ (Edge đang chạy) thì không gọi thêm.
  IF EXISTS (SELECT 1 FROM public.auto_campaign_sheet_syncs WHERE lease_until > now()) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_sheet_syncs
                  WHERE is_enabled AND status IN ('pending', 'running', 'success', 'retry') AND next_run_at <= now()) THEN
    RETURN NULL;
  END IF;
  v_secret := public.aka_agent_get_vault_secret('INTERNAL_EDGE_FUNCTION_TOKEN');
  IF NULLIF(v_secret, '') IS NULL THEN RAISE WARNING 'campaign sheet dispatch: thiếu INTERNAL_EDGE_FUNCTION_TOKEN'; RETURN NULL; END IF;
  SELECT net.http_post(url := 'https://cgjbsmqtfhqvttudyjzq.supabase.co/functions/v1/aka-agent-campaign-sheet-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-token', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000) INTO v_request;
  RETURN v_request;
END
$fn$;

-- Nhận một nguồn đến hạn. Nguồn hết hạn / không còn chiến dịch được đóng ngay; trả NULL khi hết việc.
CREATE FUNCTION public.aka_agent_campaign_sheet_claim()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '30s' AS $fn$
DECLARE
  v_sync public.auto_campaign_sheet_syncs%ROWTYPE; v_token uuid; v_issue text; v_campaigns jsonb; v_ids bigint[];
  v_left jsonb; v_guard integer := 0; v_e jsonb;
BEGIN
  IF NOT (private.aka_agent_campaign_sheet_setting()->>'worker')::boolean THEN RETURN NULL; END IF;
  UPDATE public.auto_campaign_sheet_sync_logs SET status = 'interrupted', finished_at = clock_timestamp(),
    error_message = 'Lượt bị gián đoạn trước khi xong; lượt sau đọc lại Sheet.'
   WHERE kind = 'run' AND status = 'running' AND started_at < clock_timestamp() - interval '10 minutes';
  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 50 THEN RETURN NULL; END IF;
    SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs
     WHERE is_enabled AND status IN ('pending', 'running', 'success', 'retry') AND next_run_at <= clock_timestamp()
       AND (lease_until IS NULL OR lease_until < clock_timestamp())
     ORDER BY next_run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF v_sync.end_date < private.aka_agent_campaign_sheet_today() THEN
      UPDATE public.auto_campaign_sheet_syncs SET is_enabled = false, status = 'expired', stopped_reason = 'expired',
        stopped_at = clock_timestamp(), lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
       WHERE id = v_sync.id RETURNING * INTO v_sync;
      PERFORM private.aka_agent_campaign_sheet_log(v_sync, 'stop', 'system', NULL, 'expired', 'Đã hết thời hạn đồng bộ.');
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id = v_sync.staff_id AND organization_id = v_sync.organization_id
                    AND is_active AND deleted_at IS NULL) THEN
      -- Nhân viên bị khoá: bỏ qua lượt, kiểm lại ở hạn kế tiếp.
      UPDATE public.auto_campaign_sheet_syncs SET next_run_at = clock_timestamp() + make_interval(hours => every_hours),
        updated_at = clock_timestamp() WHERE id = v_sync.id;
      CONTINUE;
    END IF;

    -- Chiến dịch không còn nhận được data thì rời nguồn.
    v_campaigns := '[]'::jsonb; v_ids := '{}'; v_left := '[]'::jsonb;
    FOR v_e IN SELECT e FROM jsonb_array_elements(v_sync.campaigns) e LOOP
      IF v_e->>'state' = 'active' THEN
        v_issue := private.aka_agent_campaign_sheet_campaign_issue((v_e->>'campaignId')::bigint, v_sync.staff_id,
          v_sync.organization_id, v_sync.action_id);
        IF v_issue IS NOT NULL THEN
          v_e := v_e || jsonb_build_object('state', 'left', 'leftReason', v_issue, 'leftAt', clock_timestamp());
          v_left := v_left || jsonb_build_object('campaignId', (v_e->>'campaignId')::bigint, 'reason', v_issue);
        ELSE
          v_ids := v_ids || (v_e->>'campaignId')::bigint;
        END IF;
      END IF;
      v_campaigns := v_campaigns || jsonb_build_array(v_e);
    END LOOP;
    IF jsonb_array_length(v_left) > 0 THEN
      UPDATE public.auto_campaign_sheet_syncs SET campaigns = v_campaigns,
        campaign_ids = (SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM unnest(v_ids) x),
        updated_at = clock_timestamp() WHERE id = v_sync.id RETURNING * INTO v_sync;
      PERFORM private.aka_agent_campaign_sheet_log(v_sync, 'campaign_left', 'system', jsonb_build_object('campaigns', v_left));
    END IF;
    IF cardinality(v_sync.campaign_ids) = 0 THEN
      UPDATE public.auto_campaign_sheet_syncs SET is_enabled = false, status = 'paused',
        stopped_reason = COALESCE(v_left->0->>'reason', 'no_campaign'), stopped_at = clock_timestamp(),
        lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
       WHERE id = v_sync.id RETURNING * INTO v_sync;
      PERFORM private.aka_agent_campaign_sheet_log(v_sync, 'stop', 'system', NULL, v_sync.stopped_reason,
        'Không còn chiến dịch nhận data.');
      CONTINUE;
    END IF;

    v_token := gen_random_uuid();
    UPDATE public.auto_campaign_sheet_syncs SET status = 'running', lease_token = v_token,
      lease_until = clock_timestamp() + interval '180 seconds', last_run_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = v_sync.id RETURNING * INTO v_sync;
    INSERT INTO public.auto_campaign_sheet_sync_logs (sync_id, organization_id, staff_id, kind, actor, run_token, status, started_at)
    VALUES (v_sync.id, v_sync.organization_id, v_sync.staff_id, 'run', 'system', v_token, 'running', clock_timestamp());
    RETURN jsonb_build_object('token', v_token, 'syncId', v_sync.id, 'actionId', v_sync.action_id, 'config', v_sync.config);
  END LOOP;
END
$fn$;

-- Kết thúc một lượt. p_result: {rows:[{name,phone,uid,email,info1..info5,phoneCarrier}], rowCount, invalid, duplicates}
-- hoặc {error:{code, message, permanent}}. Gọi lại cùng token trả lại kết quả đã lưu.
CREATE FUNCTION public.aka_agent_campaign_sheet_finish(p_token uuid, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '60s' AS $fn$
DECLARE
  v_log public.auto_campaign_sheet_sync_logs%ROWTYPE; v_sync public.auto_campaign_sheet_syncs%ROWTYPE;
  v_field text; v_rows jsonb; v_active bigint[]; v_all bigint[]; v_id bigint; v_n integer; v_cursor integer;
  v_added integer := 0; v_dups integer := 0; v_invalid integer; v_read integer; v_per jsonb := '[]'::jsonb;
  v_result jsonb; v_error_code text; v_error_message text; v_permanent boolean; v_campaigns jsonb;
  v_unique integer; c record; v_line text; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_log FROM public.auto_campaign_sheet_sync_logs WHERE run_token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('stale', true); END IF;
  IF v_log.status IN ('success', 'error') AND v_log.result IS NOT NULL THEN RETURN v_log.result; END IF;
  SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs WHERE id = v_log.sync_id FOR UPDATE;
  IF NOT FOUND OR v_sync.lease_token IS DISTINCT FROM p_token OR v_log.status <> 'running' THEN
    RETURN jsonb_build_object('stale', true);
  END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;

  -- Lỗi đọc Sheet.
  IF p_result ? 'error' THEN
    v_error_code := left(COALESCE(p_result->'error'->>'code', 'sheet_read_failed'), 100);
    v_error_message := left(COALESCE(p_result->'error'->>'message', 'Không thể đọc Google Sheet.'), 1000);
    v_permanent := COALESCE(jsonb_typeof(p_result->'error'->'permanent') = 'boolean' AND (p_result->'error'->>'permanent')::boolean, false);
    v_result := jsonb_build_object('ok', false, 'errorCode', v_error_code, 'permanent', v_permanent);
    UPDATE public.auto_campaign_sheet_sync_logs SET status = 'error', finished_at = v_now, error_code = v_error_code,
      error_message = v_error_message, result = v_result WHERE id = v_log.id;
    UPDATE public.auto_campaign_sheet_syncs SET
      status = CASE WHEN v_permanent THEN 'error' ELSE 'retry' END, is_enabled = NOT v_permanent,
      last_error_code = v_error_code, last_error_message = v_error_message,
      stopped_reason = CASE WHEN v_permanent THEN v_error_code ELSE NULL END,
      stopped_at = CASE WHEN v_permanent THEN v_now ELSE NULL END,
      retry_count = retry_count + 1,
      next_run_at = v_now + make_interval(mins => CASE retry_count WHEN 0 THEN 5 WHEN 1 THEN 15 ELSE 60 END),
      lease_token = NULL, lease_until = NULL, updated_at = v_now
     WHERE id = v_sync.id;
    RETURN v_result;
  END IF;

  v_rows := p_result->'rows';
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(v_rows) > 20000 OR octet_length(v_rows::text) > 20971520
    OR COALESCE(p_result->>'rowCount', '') !~ '^[0-9]{1,6}$' OR COALESCE(p_result->>'invalid', '') !~ '^[0-9]{1,6}$'
    OR COALESCE(p_result->>'duplicates', '0') !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'sheet_sync_invalid';
  END IF;
  v_active := v_sync.campaign_ids;
  IF cardinality(v_active) = 0 THEN RETURN jsonb_build_object('stale', true); END IF;
  v_field := v_sync.config->>'targetField';
  v_read := (p_result->>'rowCount')::integer;
  v_invalid := (p_result->>'invalid')::integer;
  v_dups := COALESCE((p_result->>'duplicates')::integer, 0);
  SELECT array_agg((e->>'campaignId')::bigint) INTO v_all FROM jsonb_array_elements(v_sync.campaigns) e;

  -- Khoá chiến dịch đích theo thứ tự id (cùng khoá với đường nhận / thêm data của bộ chạy cũ).
  FOREACH v_id IN ARRAY v_active LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_id::text, 0));
  END LOOP;

  CREATE TEMP TABLE IF NOT EXISTS campaign_sheet_plan (
    ord integer, key text, name text, phone text, uid text, email text, info1 text, info2 text, info3 text,
    info4 text, info5 text, phone_carrier text, campaign_id bigint) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS campaign_sheet_existing (campaign_id bigint, key text) ON COMMIT DROP;
  TRUNCATE campaign_sheet_plan, campaign_sheet_existing;

  -- Dòng gửi lên: tính khoá ở DB (không tin khoá của bên gọi), mỗi khoá giữ dòng đầu.
  INSERT INTO campaign_sheet_plan (ord, key, name, phone, uid, email, info1, info2, info3, info4, info5, phone_carrier)
  SELECT DISTINCT ON (r.key) r.ord, r.key, r.name, r.phone, r.uid, r.email, r.info1, r.info2, r.info3, r.info4, r.info5, r.carrier
    FROM (
      SELECT o::integer AS ord,
             private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, x->>'phone', x->>'uid', x->>'email') AS key,
             NULLIF(left(btrim(COALESCE(x->>'name', '')), 500), '') AS name,
             CASE WHEN v_field = 'phone' THEN public.aka_agent_internal_normalize_phone(x->>'phone') END AS phone,
             CASE WHEN v_field = 'uid' THEN btrim(x->>'uid') END AS uid,
             CASE WHEN v_field = 'email' THEN lower(btrim(x->>'email')) END AS email,
             NULLIF(left(COALESCE(x->>'info1', ''), 4000), '') AS info1, NULLIF(left(COALESCE(x->>'info2', ''), 4000), '') AS info2,
             NULLIF(left(COALESCE(x->>'info3', ''), 4000), '') AS info3, NULLIF(left(COALESCE(x->>'info4', ''), 4000), '') AS info4,
             NULLIF(left(COALESCE(x->>'info5', ''), 4000), '') AS info5,
             CASE WHEN v_field = 'phone' THEN NULLIF(left(COALESCE(x->>'phoneCarrier', ''), 40), '') END AS carrier
        FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(x, o)
       WHERE jsonb_typeof(x) = 'object'
    ) r
   WHERE r.key IS NOT NULL
   ORDER BY r.key, r.ord;
  GET DIAGNOSTICS v_unique = ROW_COUNT;
  v_invalid := v_invalid + (SELECT count(*) FROM jsonb_array_elements(v_rows) x
    WHERE jsonb_typeof(x) <> 'object'
       OR private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, x->>'phone', x->>'uid', x->>'email') IS NULL)::integer;
  v_dups := v_dups + GREATEST(jsonb_array_length(v_rows) - v_unique - (SELECT count(*) FROM jsonb_array_elements(v_rows) x
    WHERE jsonb_typeof(x) <> 'object'
       OR private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, x->>'phone', x->>'uid', x->>'email') IS NULL)::integer, 0);

  -- Mốc ban đầu: dòng Upload đã đọc mà không thêm.
  DELETE FROM campaign_sheet_plan p WHERE p.key IN (SELECT unnest(v_sync.skipped_keys));
  -- Khoá data đang có của mọi chiến dịch từng nhận từ nguồn (cả dòng đã xoá mềm), tính một lần.
  INSERT INTO campaign_sheet_existing (campaign_id, key)
  SELECT DISTINCT d.campaign_id, k.key FROM public.auto_campaign_input_data d
   CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, d.phone, d.uid, d.email) AS key) k
   WHERE d.campaign_id = ANY (v_all) AND k.key IS NOT NULL;

  v_cursor := v_sync.split_cursor;
  IF v_sync.split_mode = 'split' THEN
    -- Bỏ dòng đã có ở bất kỳ chiến dịch nào, rồi chia lần lượt cho các chiến dịch đang nhận.
    DELETE FROM campaign_sheet_plan p USING (SELECT DISTINCT key FROM campaign_sheet_existing) e WHERE e.key = p.key;
    v_n := cardinality(v_active);
    UPDATE campaign_sheet_plan p SET campaign_id = v_active[((n.rn + v_cursor) % v_n) + 1]
      FROM (SELECT ord, (row_number() OVER (ORDER BY ord) - 1)::integer AS rn FROM campaign_sheet_plan) n
     WHERE n.ord = p.ord;
    v_cursor := (v_cursor + (SELECT count(*) FROM campaign_sheet_plan)::integer) % v_n;
  ELSE
    -- Mỗi chiến dịch đang nhận đủ dòng mới (bỏ dòng chính chiến dịch đó đã có).
    INSERT INTO campaign_sheet_plan (ord, key, name, phone, uid, email, info1, info2, info3, info4, info5, phone_carrier, campaign_id)
    SELECT p.ord, p.key, p.name, p.phone, p.uid, p.email, p.info1, p.info2, p.info3, p.info4, p.info5, p.phone_carrier, a.x
      FROM campaign_sheet_plan p CROSS JOIN unnest(v_active) a(x)
     WHERE p.campaign_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM campaign_sheet_existing e WHERE e.campaign_id = a.x AND e.key = p.key);
    DELETE FROM campaign_sheet_plan WHERE campaign_id IS NULL;
  END IF;
  v_dups := v_dups + GREATEST(v_unique - (SELECT count(DISTINCT key) FROM campaign_sheet_plan)::integer, 0);

  INSERT INTO public.auto_campaign_input_data (campaign_id, name, phone, uid, email, info1, info2, info3, info4, info5,
    phone_carrier, status)
  SELECT p.campaign_id, p.name, p.phone, p.uid, p.email, p.info1, p.info2, p.info3, p.info4, p.info5, p.phone_carrier, 'chờ xử lý'
    FROM campaign_sheet_plan p ORDER BY p.campaign_id, p.ord;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  FOR c IN SELECT p.campaign_id AS id, count(*)::integer AS n FROM campaign_sheet_plan p GROUP BY p.campaign_id ORDER BY p.campaign_id
  LOOP
    UPDATE public.auto_campaigns x SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = v_now
     WHERE x.id = c.id AND x.status = 'hoàn thành' AND NOT COALESCE(x.is_delete, false);
    v_per := v_per || jsonb_build_object('campaignId', c.id, 'added', c.n, 'reopened', FOUND);
    v_line := to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY')
      || ' - 📥 Đồng bộ Google Sheet: đã thêm ' || c.n || ' data mới';
    PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:' || c.id::text, 0));
    INSERT INTO public.auto_campaign_logs (campaign_id, log) VALUES (c.id, v_line);
  END LOOP;

  SELECT jsonb_agg(CASE WHEN pc.added IS NOT NULL
           THEN e || jsonb_build_object('added', COALESCE((e->>'added')::bigint, 0) + pc.added) ELSE e END ORDER BY o)
    INTO v_campaigns
    FROM jsonb_array_elements(v_sync.campaigns) WITH ORDINALITY AS t(e, o)
    LEFT JOIN LATERAL (SELECT (x->>'added')::bigint AS added FROM jsonb_array_elements(v_per) x
                        WHERE x->>'campaignId' = e->>'campaignId' LIMIT 1) pc ON true;
  v_result := jsonb_build_object('ok', true, 'added', v_added, 'rowCount', v_read, 'invalid', v_invalid,
    'duplicates', v_dups, 'perCampaign', v_per);
  UPDATE public.auto_campaign_sheet_sync_logs SET status = 'success', finished_at = clock_timestamp(), rows_read = v_read,
    added = v_added, duplicates = v_dups, invalid = v_invalid, per_campaign = v_per, result = v_result WHERE id = v_log.id;
  UPDATE public.auto_campaign_sheet_syncs SET status = 'success', campaigns = v_campaigns, split_cursor = v_cursor,
    last_success_at = v_now, last_added = v_added, total_added = total_added + v_added, retry_count = 0,
    last_error_code = NULL, last_error_message = NULL,
    next_run_at = v_now + make_interval(hours => every_hours),
    lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
   WHERE id = v_sync.id;
  RETURN v_result;
END
$fn$;

-- Hàm tick 30 giây: thân production đọc 26/11/2026 (md5 10a2465b…) + một khối gọi dispatch của chiến dịch.
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_background_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  BEGIN PERFORM public.aka_agent_run_data_group_dynamic_filter_worker(5,100);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group dynamic filter worker failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_sheet_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group Sheet dispatch failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_notification_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Notification dispatch failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_campaign_sheet_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Campaign Sheet dispatch failed (%)',SQLSTATE; END;
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Quyền: hàm mới mặc định cho PUBLIC; schema private có USAGE cho nhiều vai trò nên khoá từng hàm.
DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'aka_agent_campaign_sheet_%')
               OR (n.nspname = 'public' AND p.proname IN ('aka_agent_campaign_sheet_sync', 'aka_agent_control_campaign_sheet_sync',
                   'aka_agent_campaign_sheet_dispatch', 'aka_agent_campaign_sheet_claim', 'aka_agent_campaign_sheet_finish'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM aka_agent_desktop', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM aka_agent_chat_api', r.sig);
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', r.sig);
  END LOOP;
END
$grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_sheet_sync(jsonb) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_campaign_sheet_sync(bigint, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_sheet_claim() TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_sheet_finish(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.aka_agent_campaign_sheet_sync(jsonb) IS
  'V662 Desktop: {action: settings|state|list|runs|save|stop|resume, ...}; nhân viên lấy từ phiên.';
COMMENT ON FUNCTION public.aka_agent_control_campaign_sheet_sync(bigint, bigint, jsonb) IS
  'V662 API Web (service_role): cùng lõi với aka_agent_campaign_sheet_sync.';

DO $postflight$
BEGIN
  IF has_function_privilege('anon', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.aka_agent_campaign_sheet_claim()', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_sheet_sync(jsonb)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'private.aka_agent_campaign_sheet_sync_core(bigint,bigint,boolean,jsonb)', 'EXECUTE')
  THEN RAISE EXCEPTION 'v662 postflight: quyền hàm sai'; END IF;
END
$postflight$;

COMMIT;
