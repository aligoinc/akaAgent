-- V672: Bot sự kiện (sinh nhật, thêm / gỡ tag Zalo, vào / ra nhóm điều kiện) cho akaAgent.
-- Hợp đồng: docs/EVENT_BOT_TECH.md; phương án: docs/EVENT_BOT_PLAN.md (bản 3); ghi chú DB: docs/EVENT_BOT_DB_V672.md.
--
-- Bộ máy gửi riêng, độc lập với chiến dịch (anh chốt 26/11/2026): DB khớp quy tắc và tạo việc ở auto_event_bot_jobs, nơi
-- chạy (Desktop / App Server, Fly đợt 2) hỏi việc đến hạn rồi gửi. Không đọc / ghi auto_account_action_status,
-- auto_campaign_details, auto_engine_leases, auto_campaigns; không cộng hạn mức.
--
-- Chỉ thêm đối tượng mới. Sửa đúng một hàm có sẵn: private.aka_agent_zalo_tag_sync_watched (V660) thêm tài khoản có quy tắc
-- tag đang bật (preflight kiểm md5 thân hàm production d21d55c1…). Thêm 3 trigger AFTER (không đổi câu gốc; mọi lỗi của
-- trigger chỉ RAISE WARNING): một trên auto_zalo_tag_member_events, hai trên auto_account_contact_group_member_origins.
-- Công tắc auto_system_settings `event_bot` V672 đặt audience off: không ai dùng được tới khi đổi.
-- DDL làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';

DO $preflight$
DECLARE
  v_md5 text;
  v_missing text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v672\_%') THEN
    RAISE EXCEPTION 'v672 already recorded in the migration ledger';
  END IF;
  IF to_regclass('public.auto_event_bot_settings') IS NOT NULL OR to_regclass('public.auto_event_bot_rules') IS NOT NULL
     OR to_regclass('public.auto_event_bot_jobs') IS NOT NULL OR to_regclass('public.auto_event_bot_exclusions') IS NOT NULL THEN
    RAISE EXCEPTION 'v672 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'event_bot') THEN
    RAISE EXCEPTION 'v672 setting event_bot already exists';
  END IF;
  SELECT string_agg(t, ', ') INTO v_missing FROM unnest(ARRAY[
    'public.auto_accounts', 'public.auto_account_contacts', 'public.auto_account_contact_groups',
    'public.auto_account_contact_group_members', 'public.auto_account_contact_group_member_origins',
    'public.auto_account_contact_group_dynamic_filters', 'public.auto_zalo_tag_member_events', 'public.auto_zalo_tag_members',
    'public.auto_zalo_tag_sync_campaigns', 'public.auto_zalo_tag_sync_resets', 'public.auto_campaigns',
    'public.auto_system_settings', 'public.org_staff', 'public.zalo_accounts', 'public.chat_zalo_account_organization',
    'public.category_item', 'public.auto_staff_device_presence']) AS t WHERE to_regclass(t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v672 needs tables: %', v_missing;
  END IF;
  SELECT string_agg(f, ', ') INTO v_missing FROM unnest(ARRAY[
    'private.aka_agent_desktop_data_context()', 'public.aka_agent_app_access_chat_runtime(bigint,boolean)',
    'public.aka_agent_zalo_server_flag_route(bigint)', 'private.aka_agent_zalo_tag_sync_org_covered(jsonb,bigint)',
    'private.aka_agent_zalo_tag_sync_watched(jsonb,text,bigint,bigint[])']) AS f WHERE to_regprocedure(f) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v672 needs functions: %', v_missing;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
  WHERE p.oid = to_regprocedure('private.aka_agent_zalo_tag_sync_watched(jsonb,text,bigint,bigint[])');
  IF v_md5 IS DISTINCT FROM 'd21d55c1ea0d6396c6d16e39ca70ff2e' THEN
    RAISE EXCEPTION 'v672: private.aka_agent_zalo_tag_sync_watched body changed (md5 %), rebuild V672 from the live body', v_md5;
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing FROM unnest(ARRAY[
    'auto_account_contact_group_member_origins.dynamic_filter_id', 'auto_account_contact_group_member_origins.is_current',
    'auto_account_contact_group_member_origins.membership_id', 'auto_account_contact_group_member_origins.updated_at',
    'auto_account_contact_group_members.group_id', 'auto_account_contact_group_members.contact_id',
    'auto_account_contact_group_dynamic_filters.staff_id', 'auto_account_contacts.phone', 'auto_account_contacts.uid',
    'auto_accounts.is_zalo_server', 'auto_accounts.is_zalo_show_web', 'auto_accounts.zalo_account_id', 'auto_accounts.login_status',
    'auto_account_contact_groups.bound_zalo_account_id', 'auto_account_contact_groups.data_type_category_item_id',
    'chat_zalo_account_organization.auto_account_id', 'org_staff.is_admin_akabiz', 'org_staff.deleted_at']) AS c
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public'
                    AND ic.table_name = split_part(c, '.', 1) AND ic.column_name = split_part(c, '.', 2));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v672 needs columns: %', v_missing;
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Bảng
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE public.auto_event_bot_settings (
  account_id bigint PRIMARY KEY,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  blocklist_ids bigint[] NOT NULL DEFAULT '{}',
  paused_until timestamptz,
  pause_code text,
  pause_reason text,
  birthday_scanned_on date,
  last_claim_at timestamptz,
  last_claim_source text,
  revision integer NOT NULL DEFAULT 1,
  updated_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.auto_event_bot_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('birthday', 'tag_change', 'condition_group')),
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 80),
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_group_id bigint,
  min_gap_minutes integer NOT NULL DEFAULT 0 CHECK (min_gap_minutes BETWEEN 0 AND 43200),
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((event_type = 'condition_group') = (data_group_id IS NOT NULL) OR is_delete)
);
CREATE INDEX idx_auto_event_bot_rules_account ON public.auto_event_bot_rules (account_id, event_type) WHERE NOT is_delete;
CREATE INDEX idx_auto_event_bot_rules_group ON public.auto_event_bot_rules (data_group_id)
  WHERE event_type = 'condition_group' AND enabled AND NOT is_delete;

CREATE TABLE public.auto_event_bot_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  rule_id bigint,
  rule_revision integer,
  event_type text NOT NULL CHECK (event_type IN ('birthday', 'tag_change', 'condition_group')),
  direction text NOT NULL CHECK (direction IN ('birthday', 'added', 'removed', 'enter', 'leave')),
  recipient_uid text,
  recipient_name text,
  contact_id bigint,
  tag_id text,
  source_ref text,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'expired', 'failed', 'unknown')),
  reason_code text,
  zalo_error_code text,
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 300),
  message_template text,
  send_after timestamptz,
  expires_at timestamptz,
  claim_token uuid,
  claimed_at timestamptz,
  claimed_by text,
  runner_id text,
  sent_at timestamptz,
  zalo_msg_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_event_bot_jobs_pending ON public.auto_event_bot_jobs (account_id, send_after) WHERE status = 'pending';
CREATE INDEX idx_auto_event_bot_jobs_account_created ON public.auto_event_bot_jobs (account_id, created_at DESC);
CREATE INDEX idx_auto_event_bot_jobs_expires ON public.auto_event_bot_jobs (expires_at) WHERE status = 'pending';
CREATE INDEX idx_auto_event_bot_jobs_sending ON public.auto_event_bot_jobs (claimed_at) WHERE status = 'sending';
-- Mỗi tài khoản tối đa một việc đang gửi.
CREATE UNIQUE INDEX uq_auto_event_bot_jobs_one_sending ON public.auto_event_bot_jobs (account_id) WHERE status = 'sending';
CREATE INDEX idx_auto_event_bot_jobs_rule_sent ON public.auto_event_bot_jobs (rule_id, recipient_uid, sent_at DESC) WHERE status = 'sent';
CREATE INDEX idx_auto_event_bot_jobs_created ON public.auto_event_bot_jobs (created_at);

CREATE TABLE public.auto_event_bot_exclusions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('uid', 'phone')),
  value text NOT NULL,
  name text CHECK (name IS NULL OR char_length(name) <= 80),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'log')),
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind, value)
);

ALTER TABLE public.auto_event_bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_event_bot_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_event_bot_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_event_bot_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_event_bot_settings, public.auto_event_bot_rules, public.auto_event_bot_jobs, public.auto_event_bot_exclusions
  FROM PUBLIC, anon, authenticated, service_role;
DO $seq$
DECLARE v_seq text;
BEGIN
  FOR v_seq IN SELECT pg_get_serial_sequence('public.' || t, 'id') FROM unnest(ARRAY['auto_event_bot_rules', 'auto_event_bot_jobs', 'auto_event_bot_exclusions']) t LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
  END LOOP;
END
$seq$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Công tắc
-- ---------------------------------------------------------------------------------------------------------------------

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('event_bot', '{"audience":"off","organizationIds":[],"runtimes":{"desktop":true,"server":true,"fly":false},"pollSeconds":30}',
   'Bot sự kiện: audience off|admin_akabiz|orgs|all, organizationIds, runtimes {desktop,server,fly}, pollSeconds (10-600). JSON sai = off.',
   false, true);

CREATE FUNCTION private.aka_agent_event_bot_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_raw text;
  v jsonb;
  v_rt jsonb;
BEGIN
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'event_bot' AND s.is_active ORDER BY s.id LIMIT 1;
  BEGIN
    v := v_raw::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN
    v := '{}'::jsonb;
  END IF;
  v_rt := CASE WHEN jsonb_typeof(v->'runtimes') = 'object' THEN v->'runtimes' ELSE '{}'::jsonb END;
  RETURN jsonb_build_object(
    'audience', CASE WHEN v->>'audience' IN ('off', 'admin_akabiz', 'orgs', 'all') THEN v->>'audience' ELSE 'off' END,
    'organizationIds', COALESCE((
      SELECT jsonb_agg(DISTINCT btrim(x #>> '{}'))
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'organizationIds') = 'array' THEN v->'organizationIds' ELSE '[]'::jsonb END) x
      WHERE jsonb_typeof(x) IN ('number', 'string') AND btrim(x #>> '{}') ~ '^[0-9]{1,18}$'
    ), '[]'::jsonb),
    'runtimes', jsonb_build_object(
      'desktop', CASE WHEN v_rt ? 'desktop' THEN v_rt->'desktop' = 'true'::jsonb ELSE true END,
      'server', CASE WHEN v_rt ? 'server' THEN v_rt->'server' = 'true'::jsonb ELSE true END,
      'fly', v_rt->'fly' IS NOT DISTINCT FROM 'true'::jsonb),
    'pollSeconds', LEAST(600, GREATEST(10, COALESCE(CASE WHEN jsonb_typeof(v->'pollSeconds') = 'number'
      AND (v->>'pollSeconds') ~ '^[0-9]{1,6}$' THEN (v->>'pollSeconds')::int END, 30)))
  );
END;
$function$;

-- Nhân viên + tổ chức có được dùng Bot sự kiện không (theo công tắc). Nhân viên phải còn hoạt động trong tổ chức.
CREATE FUNCTION private.aka_agent_event_bot_access(p_organization_id bigint, p_staff_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb := private.aka_agent_event_bot_config();
  v_admin boolean;
BEGIN
  IF p_organization_id IS NULL OR p_staff_id IS NULL OR v_cfg->>'audience' = 'off' THEN
    RETURN false;
  END IF;
  SELECT COALESCE(s.is_admin_akabiz, false) INTO v_admin FROM public.org_staff s
  WHERE s.id = p_staff_id AND s.organization_id = p_organization_id AND COALESCE(s.is_active, true) AND s.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN CASE v_cfg->>'audience'
    WHEN 'all' THEN true
    WHEN 'orgs' THEN (v_cfg->'organizationIds') ? p_organization_id::text
    WHEN 'admin_akabiz' THEN v_admin
    ELSE false
  END;
END;
$function$;

CREATE FUNCTION private.aka_agent_event_bot_runtime_on(p_config jsonb, p_runs_on text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p_runs_on IN ('desktop', 'server', 'fly') AND COALESCE(p_config->'runtimes'->p_runs_on = 'true'::jsonb, false);
$function$;

-- Nơi chạy bot của một tài khoản: desktop (Zalo QR / trình duyệt) | server (Zalo Server, App Server) | fly (Zalo Server đi Fly)
-- | akachat (đã có binding akaChat và tổ chức có akaChat) | NULL (không phải tài khoản Zalo chưa xoá).
CREATE FUNCTION private.aka_agent_event_bot_runs_on(p_account_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
BEGIN
  SELECT acc.id, acc.organization_id, acc.flatform_type, acc.is_delete, acc.is_zalo_server INTO a
  FROM public.auto_accounts acc WHERE acc.id = p_account_id;
  IF a.id IS NULL OR lower(btrim(COALESCE(a.flatform_type, ''))) <> 'zalo' OR COALESCE(a.is_delete, false) OR a.organization_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_zalo_account_organization b WHERE b.auto_account_id = a.id AND b.is_active)
     AND public.aka_agent_app_access_chat_runtime(a.organization_id::bigint, false) THEN
    RETURN 'akachat';
  END IF;
  IF COALESCE(a.is_zalo_server, false) THEN
    RETURN CASE WHEN public.aka_agent_zalo_server_flag_route(a.organization_id::bigint) THEN 'fly' ELSE 'server' END;
  END IF;
  RETURN 'desktop';
END;
$function$;

-- SĐT như normalizeEventBotPhone của src/shared/eventBot.ts.
CREATE FUNCTION private.aka_agent_event_bot_norm_phone(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  d text := regexp_replace(COALESCE(p_value, ''), '[^0-9+]', '', 'g');
BEGIN
  IF left(d, 1) = '+' THEN d := substr(d, 2); END IF;
  IF left(d, 2) = '84' THEN d := '0' || substr(d, 3); END IF;
  IF d !~ '^0[0-9]{9,10}$' THEN RETURN NULL; END IF;
  RETURN d;
END;
$function$;

-- Người nhận có bị loại trừ không: danh sách của riêng tài khoản (UID hoặc SĐT) + danh sách không gửi dùng chung đã chọn
-- (nhóm purpose zalo_friend_blocklist của nhân viên; so theo UID Zalo của liên hệ trong danh sách).
CREATE FUNCTION private.aka_agent_event_bot_excluded(p_account_id bigint, p_blocklist_ids bigint[], p_uid text, p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.auto_event_bot_exclusions x
                 WHERE x.account_id = p_account_id AND x.kind = 'uid' AND x.value = btrim(p_uid) AND NULLIF(btrim(p_uid), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.auto_event_bot_exclusions x
                 WHERE x.account_id = p_account_id AND x.kind = 'phone'
                   AND x.value = private.aka_agent_event_bot_norm_phone(p_phone))
      OR (cardinality(COALESCE(p_blocklist_ids, '{}'::bigint[])) > 0 AND NULLIF(btrim(p_uid), '') IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.auto_account_contact_groups g
            JOIN public.auto_account_contact_group_members m ON m.group_id = g.id AND NOT m.is_delete
            JOIN public.auto_account_contacts ac ON ac.id = m.contact_id
            WHERE g.id = ANY (p_blocklist_ids) AND g.purpose = 'zalo_friend_blocklist' AND NOT g.is_delete
              AND ac.contact_type = 'person' AND NOT COALESCE(ac.is_delete, false) AND btrim(ac.uid) = btrim(p_uid)));
$function$;

-- Đã có tin `sent` cùng quy tắc + người nhận (+ chiều, với nhóm) trong p_minutes phút.
CREATE FUNCTION private.aka_agent_event_bot_gap_hit(p_rule_id bigint, p_uid text, p_direction text, p_minutes integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT COALESCE(p_minutes, 0) > 0 AND EXISTS (
    SELECT 1 FROM public.auto_event_bot_jobs j
    WHERE j.rule_id = p_rule_id AND j.recipient_uid = p_uid AND j.status = 'sent'
      AND j.sent_at > clock_timestamp() - make_interval(mins => p_minutes)
      AND (p_direction NOT IN ('enter', 'leave') OR j.direction = p_direction));
$function$;

-- Tài khoản có được tạo việc không: bot bật, tài khoản Zalo chưa xoá của đúng nhân viên, công tắc cho nhân viên, nơi chạy hỗ
-- trợ (không phải akaChat, runtime của nơi chạy đang bật). Không có dòng = không tạo việc.
CREATE FUNCTION private.aka_agent_event_bot_create_ctx(p_account_id bigint, p_config jsonb)
RETURNS TABLE (staff_id bigint, organization_id bigint, blocklist_ids bigint[], runs_on text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  s record;
  v_runs text;
BEGIN
  SELECT st.staff_id, st.organization_id, st.blocklist_ids INTO s
  FROM public.auto_event_bot_settings st
  JOIN public.auto_accounts a ON a.id = st.account_id AND a.staff_id = st.staff_id AND a.organization_id = st.organization_id
  WHERE st.account_id = p_account_id AND st.enabled;
  IF s.staff_id IS NULL OR NOT private.aka_agent_event_bot_access(s.organization_id, s.staff_id) THEN
    RETURN;
  END IF;
  v_runs := private.aka_agent_event_bot_runs_on(p_account_id);
  IF v_runs IS NULL OR v_runs = 'akachat' OR NOT private.aka_agent_event_bot_runtime_on(p_config, v_runs) THEN
    RETURN;
  END IF;
  staff_id := s.staff_id; organization_id := s.organization_id; blocklist_ids := s.blocklist_ids; runs_on := v_runs;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Tạo việc: thêm / gỡ tag (trigger câu lệnh trên sổ tag V660)
-- ---------------------------------------------------------------------------------------------------------------------

-- Mỗi dòng sổ tag khớp quy tắc đứng đầu (position, id) cùng chiều có tag đó. > 20 dòng cùng tài khoản + tag + chiều trong một
-- câu lệnh = gắn / gỡ hàng loạt: ghi từng dòng `skipped bulk_tag`. Gỡ ≥ 2 người mà tag không còn ai = tag bị xoá: `tag_deleted`.
CREATE FUNCTION private.aka_agent_event_bot_tag_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_acc bigint;
  v_cfg jsonb;
  c record;
  v_now timestamptz := clock_timestamp();
BEGIN
  BEGIN
    FOR v_acc IN SELECT DISTINCT e.account_id FROM new_rows e LOOP
      IF NOT EXISTS (SELECT 1 FROM public.auto_event_bot_rules r
                     WHERE r.account_id = v_acc AND r.event_type = 'tag_change' AND r.enabled AND NOT r.is_delete) THEN
        CONTINUE;
      END IF;
      IF v_cfg IS NULL THEN v_cfg := private.aka_agent_event_bot_config(); END IF;
      c := NULL;
      SELECT * INTO c FROM private.aka_agent_event_bot_create_ctx(v_acc, v_cfg);
      IF c.staff_id IS NULL THEN CONTINUE; END IF;

      INSERT INTO public.auto_event_bot_jobs (account_id, organization_id, staff_id, rule_id, rule_revision, event_type, direction,
        recipient_uid, recipient_name, contact_id, tag_id, source_ref, dedupe_key, status, reason_code, message_template,
        send_after, expires_at, created_at, updated_at)
      SELECT v_acc, c.organization_id, c.staff_id, m.rule_id, m.rule_revision, 'tag_change', m.dir,
        m.member_uid, ct.name, ct.id, m.tag_id, m.event_id::text,
        'tag:' || m.rule_id || ':' || m.member_uid || ':' || m.tag_id || ':' || m.dir || ':' || m.event_id,
        CASE WHEN z.reason IS NULL THEN 'pending' ELSE 'skipped' END, z.reason, m.message,
        v_now + make_interval(secs => m.dmin + floor(random() * (m.dmax - m.dmin + 1))), v_now + interval '30 minutes', v_now, v_now
      FROM (
        SELECT e.id AS event_id, e.tag_id, e.member_uid, e.kind, e.n_group,
          CASE e.kind WHEN 'add' THEN 'added' ELSE 'removed' END AS dir,
          r.id AS rule_id, r.revision AS rule_revision, r.min_gap_minutes, r.config->>'message' AS message,
          GREATEST(0, LEAST(600, COALESCE(CASE WHEN (r.config->'delay'->>'minSeconds') ~ '^[0-9]{1,4}$' THEN (r.config->'delay'->>'minSeconds')::int END, 20))) AS dmin,
          GREATEST(0, LEAST(600, COALESCE(CASE WHEN (r.config->'delay'->>'maxSeconds') ~ '^[0-9]{1,4}$' THEN (r.config->'delay'->>'maxSeconds')::int END, 60))) AS dmax0
        FROM (SELECT ev.*, count(*) OVER (PARTITION BY ev.tag_id, ev.kind) AS n_group FROM new_rows ev WHERE ev.account_id = v_acc) e
        CROSS JOIN LATERAL (
          SELECT rr.id, rr.revision, rr.min_gap_minutes, rr.config FROM public.auto_event_bot_rules rr
          WHERE rr.account_id = v_acc AND rr.event_type = 'tag_change' AND rr.enabled AND NOT rr.is_delete
            AND rr.config->>'direction' = CASE e.kind WHEN 'add' THEN 'added' ELSE 'removed' END
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(rr.config->'tagIds') = 'array' THEN rr.config->'tagIds' ELSE '[]'::jsonb END) t
                        WHERE btrim(t #>> '{}') = e.tag_id)
          ORDER BY rr.position, rr.id LIMIT 1
        ) r
      ) m0
      CROSS JOIN LATERAL (SELECT m0.event_id, m0.tag_id, m0.member_uid, m0.kind, m0.n_group, m0.dir, m0.rule_id, m0.rule_revision,
        m0.min_gap_minutes, m0.message, m0.dmin, GREATEST(m0.dmin, m0.dmax0) AS dmax) m
      LEFT JOIN LATERAL (
        SELECT ac.id, ac.name, ac.phone FROM public.auto_account_contacts ac
        WHERE ac.account_id = v_acc AND ac.contact_type = 'person' AND ac.uid = m.member_uid AND NOT COALESCE(ac.is_delete, false)
        LIMIT 1
      ) ct ON true
      CROSS JOIN LATERAL (SELECT CASE
        WHEN left(m.member_uid, 1) = 'g' THEN 'not_person'
        WHEN m.kind = 'remove' AND m.n_group >= 2 AND NOT EXISTS (
          SELECT 1 FROM public.auto_zalo_tag_members tm WHERE tm.account_id = v_acc AND tm.tag_id = m.tag_id) THEN 'tag_deleted'
        WHEN m.n_group > 20 THEN 'bulk_tag'
        WHEN private.aka_agent_event_bot_excluded(v_acc, c.blocklist_ids, m.member_uid, ct.phone) THEN 'excluded'
        WHEN private.aka_agent_event_bot_gap_hit(m.rule_id, m.member_uid, m.dir, m.min_gap_minutes) THEN 'min_gap'
        END AS reason) z
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'event_bot tag trigger failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_aka_agent_event_bot_tag_events
AFTER INSERT ON public.auto_zalo_tag_member_events
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION private.aka_agent_event_bot_tag_trigger();

-- ---------------------------------------------------------------------------------------------------------------------
-- Tạo việc: vào / ra nhóm điều kiện (trigger dòng trên nguồn thành viên của bộ lọc động)
-- ---------------------------------------------------------------------------------------------------------------------

-- Chỉ tính thay đổi do job lọc động (aka_agent_process_data_group_dynamic_filters_core) ghi: lúc đó giao dịch đang giữ khoá
-- advisory `data-group-dynamic-filter:<staff>`. Đường khác (xoá thành viên tay, chuyển nhóm, xoá nhóm) không tạo việc.
CREATE FUNCTION private.aka_agent_event_bot_group_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_dir text := CASE WHEN NEW.is_current THEN 'enter' ELSE 'leave' END;
  v_group bigint;
  v_contact bigint;
  v_fstaff bigint;
  v_key bigint;
  v_cfg jsonb;
  ct record;
  r record;
  c record;
  v_now timestamptz := clock_timestamp();
  v_msg text;
  v_reason text;
  v_dmin integer;
  v_dmax integer;
BEGIN
  BEGIN
    SELECT m.group_id, m.contact_id INTO v_group, v_contact
    FROM public.auto_account_contact_group_members m WHERE m.id = NEW.membership_id;
    IF v_group IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.auto_event_bot_rules rr
      WHERE rr.data_group_id = v_group AND rr.event_type = 'condition_group' AND rr.enabled AND NOT rr.is_delete) THEN
      RETURN NULL;
    END IF;
    SELECT f.staff_id INTO v_fstaff FROM public.auto_account_contact_group_dynamic_filters f WHERE f.id = NEW.dynamic_filter_id;
    IF v_fstaff IS NULL THEN RETURN NULL; END IF;
    v_key := hashtextextended('data-group-dynamic-filter:' || v_fstaff::text, 0);
    IF NOT EXISTS (
      SELECT 1 FROM pg_locks l
      WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
        AND l.classid::bigint = ((v_key >> 32) & 4294967295) AND l.objid::bigint = (v_key & 4294967295)) THEN
      RETURN NULL;
    END IF;
    SELECT ac.id, ac.account_id, NULLIF(btrim(ac.uid), '') AS uid, ac.name, ac.phone, ac.contact_type INTO ct
    FROM public.auto_account_contacts ac WHERE ac.id = v_contact;
    IF ct.id IS NULL THEN RETURN NULL; END IF;
    v_cfg := private.aka_agent_event_bot_config();

    FOR r IN
      SELECT rr.id, rr.revision, rr.config, rr.min_gap_minutes, rr.account_id FROM public.auto_event_bot_rules rr
      WHERE rr.data_group_id = v_group AND rr.account_id = ct.account_id
        AND rr.event_type = 'condition_group' AND rr.enabled AND NOT rr.is_delete
      ORDER BY rr.position, rr.id
    LOOP
      IF NOT COALESCE(r.config->CASE v_dir WHEN 'enter' THEN 'onEnter' ELSE 'onLeave' END->'enabled' = 'true'::jsonb, false) THEN
        CONTINUE;
      END IF;
      c := NULL;
      SELECT * INTO c FROM private.aka_agent_event_bot_create_ctx(r.account_id, v_cfg);
      IF c.staff_id IS NULL THEN CONTINUE; END IF;
      v_msg := r.config->CASE v_dir WHEN 'enter' THEN 'onEnter' ELSE 'onLeave' END->>'message';
      v_dmin := GREATEST(0, LEAST(600, COALESCE(CASE WHEN (r.config->'delay'->>'minSeconds') ~ '^[0-9]{1,4}$' THEN (r.config->'delay'->>'minSeconds')::int END, 20)));
      v_dmax := GREATEST(v_dmin, LEAST(600, COALESCE(CASE WHEN (r.config->'delay'->>'maxSeconds') ~ '^[0-9]{1,4}$' THEN (r.config->'delay'->>'maxSeconds')::int END, 60)));
      v_reason := CASE
        WHEN ct.uid IS NULL THEN 'no_uid'
        WHEN left(ct.uid, 1) = 'g' OR ct.contact_type IS DISTINCT FROM 'person' THEN 'not_person'
        WHEN private.aka_agent_event_bot_excluded(r.account_id, c.blocklist_ids, ct.uid, ct.phone) THEN 'excluded'
        WHEN private.aka_agent_event_bot_gap_hit(r.id, ct.uid, v_dir, r.min_gap_minutes) THEN 'min_gap'
      END;
      INSERT INTO public.auto_event_bot_jobs (account_id, organization_id, staff_id, rule_id, rule_revision, event_type, direction,
        recipient_uid, recipient_name, contact_id, source_ref, dedupe_key, status, reason_code, message_template,
        send_after, expires_at, created_at, updated_at)
      VALUES (r.account_id, c.organization_id, c.staff_id, r.id, r.revision, 'condition_group', v_dir,
        ct.uid, ct.name, ct.id, NEW.id::text,
        'group:' || r.id || ':' || ct.id || ':' || v_dir || ':' || floor(extract(epoch FROM NEW.updated_at) * 1000)::bigint,
        CASE WHEN v_reason IS NULL THEN 'pending' ELSE 'skipped' END, v_reason, v_msg,
        v_now + make_interval(secs => v_dmin + floor(random() * (v_dmax - v_dmin + 1))), v_now + interval '30 minutes', v_now, v_now)
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'event_bot group trigger failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_aka_agent_event_bot_group_origin_insert
AFTER INSERT ON public.auto_account_contact_group_member_origins
FOR EACH ROW
WHEN (NEW.dynamic_filter_id IS NOT NULL AND NEW.is_current)
EXECUTE FUNCTION private.aka_agent_event_bot_group_trigger();
CREATE TRIGGER trg_aka_agent_event_bot_group_origin_update
AFTER UPDATE OF is_current ON public.auto_account_contact_group_member_origins
FOR EACH ROW
WHEN (NEW.dynamic_filter_id IS NOT NULL AND OLD.is_current IS DISTINCT FROM NEW.is_current)
EXECUTE FUNCTION private.aka_agent_event_bot_group_trigger();

-- ---------------------------------------------------------------------------------------------------------------------
-- Sổ tag V660: hỏi thêm tài khoản có quy tắc tag đang bật
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.aka_agent_zalo_tag_sync_watched(p_config jsonb, p_source text, p_staff_id bigint, p_account_ids bigint[])
RETURNS TABLE (account_id bigint, organization_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  -- V672: thêm tài khoản có quy tắc tag_change đang bật của Bot sự kiện (bot bật, công tắc cho nhân viên, không phải akaChat).
  SELECT DISTINCT a.id::bigint, a.organization_id::bigint
  FROM (
    SELECT sc0.account_id, sc0.staff_id, sc0.organization_id FROM public.auto_zalo_tag_sync_campaigns sc0
    UNION
    SELECT r.account_id, r.staff_id, r.organization_id
    FROM public.auto_event_bot_rules r
    JOIN public.auto_event_bot_settings s ON s.account_id = r.account_id AND s.enabled
    WHERE r.event_type = 'tag_change' AND r.enabled AND NOT r.is_delete
      AND (p_account_ids IS NULL OR r.account_id = ANY (p_account_ids))
      AND (p_staff_id IS NULL OR r.staff_id = p_staff_id)
      AND private.aka_agent_event_bot_access(r.organization_id, r.staff_id)
      AND private.aka_agent_event_bot_runs_on(r.account_id) IN ('desktop', 'server', 'fly')
  ) sc
  JOIN public.auto_accounts a ON a.id = sc.account_id
  WHERE (p_account_ids IS NULL OR sc.account_id = ANY (p_account_ids))
    AND (p_staff_id IS NULL OR sc.staff_id = p_staff_id)
    AND a.staff_id = sc.staff_id AND a.organization_id = sc.organization_id
    AND lower(btrim(COALESCE(a.flatform_type, ''))) = 'zalo'
    AND COALESCE(a.is_zalo_show_web, false) = false
    AND COALESCE(a.is_delete, false) = false
    AND CASE WHEN p_source = 'desktop' THEN COALESCE(a.is_zalo_server, false) = false
             ELSE COALESCE(a.is_zalo_server, false) = true END
    AND private.aka_agent_zalo_tag_sync_org_covered(p_config, a.organization_id::bigint);
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- RPC cho nơi chạy
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION private.aka_agent_event_bot_sync_core(p_source text, p_staff_id bigint, p_account_ids bigint[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb := private.aka_agent_event_bot_config();
  v_today date := (timezone('Asia/Ho_Chi_Minh', clock_timestamp()))::date;
  v_enabled boolean;
  v_org bigint;
BEGIN
  IF p_staff_id IS NOT NULL THEN
    SELECT s.organization_id INTO v_org FROM public.org_staff s WHERE s.id = p_staff_id;
    v_enabled := private.aka_agent_event_bot_runtime_on(v_cfg, p_source) AND private.aka_agent_event_bot_access(v_org, p_staff_id);
  ELSE
    v_enabled := private.aka_agent_event_bot_runtime_on(v_cfg, p_source) AND v_cfg->>'audience' <> 'off';
  END IF;
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', true, 'enabled', false, 'pollSeconds', (v_cfg->>'pollSeconds')::int, 'accounts', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'enabled', true, 'pollSeconds', (v_cfg->>'pollSeconds')::int, 'accounts', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'accountId', s.account_id, 'staffId', s.staff_id,
      'birthday', jsonb_build_object('enabled', br.id IS NOT NULL,
        'sendTime', COALESCE(br.config->>'sendTime', '08:30'),
        'scanToday', br.id IS NOT NULL AND s.birthday_scanned_on IS DISTINCT FROM v_today)) ORDER BY s.account_id)
    FROM public.auto_event_bot_settings s
    JOIN public.auto_accounts a ON a.id = s.account_id AND a.staff_id = s.staff_id AND a.organization_id = s.organization_id
    LEFT JOIN LATERAL (
      SELECT r.id, r.config FROM public.auto_event_bot_rules r
      WHERE r.account_id = s.account_id AND r.event_type = 'birthday' AND r.enabled AND NOT r.is_delete
      ORDER BY r.position, r.id LIMIT 1
    ) br ON true
    WHERE s.enabled
      AND (p_staff_id IS NULL OR s.staff_id = p_staff_id)
      AND (p_account_ids IS NULL OR s.account_id = ANY (p_account_ids))
      AND private.aka_agent_event_bot_access(s.organization_id, s.staff_id)
      AND private.aka_agent_event_bot_runs_on(s.account_id) = p_source
  ), '[]'::jsonb));
END;
$function$;

-- Tài khoản có thuộc nơi chạy (và nhân viên, với Desktop) và đang bật bot không. Trả dòng settings hoặc không có dòng.
CREATE FUNCTION private.aka_agent_event_bot_runner_account(p_source text, p_staff_id bigint, p_account_id bigint)
RETURNS SETOF public.auto_event_bot_settings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  s public.auto_event_bot_settings%ROWTYPE;
BEGIN
  SELECT st.* INTO s FROM public.auto_event_bot_settings st
  JOIN public.auto_accounts a ON a.id = st.account_id AND a.staff_id = st.staff_id AND a.organization_id = st.organization_id
  WHERE st.account_id = p_account_id AND st.enabled AND (p_staff_id IS NULL OR st.staff_id = p_staff_id);
  IF s.account_id IS NULL OR NOT private.aka_agent_event_bot_access(s.organization_id, s.staff_id)
     OR private.aka_agent_event_bot_runs_on(p_account_id) IS DISTINCT FROM p_source THEN
    RETURN;
  END IF;
  RETURN NEXT s;
END;
$function$;

CREATE FUNCTION private.aka_agent_event_bot_birthdays_core(p_source text, p_staff_id bigint, p_account_id bigint, p_people jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb := private.aka_agent_event_bot_config();
  v_now timestamptz := clock_timestamp();
  v_today date := (timezone('Asia/Ho_Chi_Minh', clock_timestamp()))::date;
  s public.auto_event_bot_settings%ROWTYPE;
  r record;
  v_send timestamptz;
  v_exp timestamptz;
  v_created integer := 0;
  v_skipped integer := 0;
  v_total integer := 0;
BEGIN
  IF NOT private.aka_agent_event_bot_runtime_on(v_cfg, p_source) OR v_cfg->>'audience' = 'off' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_enabled', 'message', 'Bot sự kiện đang tắt.');
  END IF;
  IF p_people IS NULL OR jsonb_typeof(p_people) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'Danh sách người sinh nhật không hợp lệ.');
  END IF;
  IF jsonb_array_length(p_people) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many_people', 'message', 'Tối đa 2.000 người mỗi lần.');
  END IF;
  SELECT * INTO s FROM private.aka_agent_event_bot_runner_account(p_source, p_staff_id, p_account_id);
  IF s.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'account_not_eligible', 'message', 'Tài khoản không chạy bot ở nơi này.');
  END IF;
  SELECT rr.id, rr.revision, rr.config INTO r FROM public.auto_event_bot_rules rr
  WHERE rr.account_id = p_account_id AND rr.event_type = 'birthday' AND rr.enabled AND NOT rr.is_delete
  ORDER BY rr.position, rr.id LIMIT 1;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rule_off', 'message', 'Quy tắc sinh nhật đang tắt.');
  END IF;
  v_send := GREATEST(v_now, (v_today + (CASE WHEN COALESCE(r.config->>'sendTime', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    THEN r.config->>'sendTime' ELSE '08:30' END)::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_exp := ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '1 second';

  WITH p AS (
    SELECT DISTINCT ON (btrim(x->>'uid')) btrim(x->>'uid') AS uid, left(NULLIF(btrim(x->>'name'), ''), 200) AS name
    FROM jsonb_array_elements(p_people) x
    WHERE jsonb_typeof(x) = 'object' AND COALESCE(btrim(x->>'uid'), '') ~ '^g?[0-9]{1,40}$'
    ORDER BY btrim(x->>'uid')
  ), ins AS (
    INSERT INTO public.auto_event_bot_jobs (account_id, organization_id, staff_id, rule_id, rule_revision, event_type, direction,
      recipient_uid, recipient_name, contact_id, source_ref, dedupe_key, status, reason_code, message_template,
      send_after, expires_at, created_at, updated_at)
    SELECT p_account_id, s.organization_id, s.staff_id, r.id, r.revision, 'birthday', 'birthday',
      p.uid, COALESCE(p.name, ct.name), ct.id, to_char(v_today, 'YYYY-MM-DD'),
      'birthday:' || p_account_id || ':' || p.uid || ':' || extract(year FROM v_today)::int,
      CASE WHEN z.reason IS NULL THEN 'pending' ELSE 'skipped' END, z.reason, r.config->>'message', v_send, v_exp, v_now, v_now
    FROM p
    LEFT JOIN LATERAL (
      SELECT ac.id, ac.name, ac.phone FROM public.auto_account_contacts ac
      WHERE ac.account_id = p_account_id AND ac.contact_type = 'person' AND ac.uid = p.uid AND NOT COALESCE(ac.is_delete, false) LIMIT 1
    ) ct ON true
    CROSS JOIN LATERAL (SELECT CASE
      WHEN left(p.uid, 1) = 'g' THEN 'not_person'
      WHEN private.aka_agent_event_bot_excluded(p_account_id, s.blocklist_ids, p.uid, ct.phone) THEN 'excluded'
      END AS reason) z
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING status
  )
  SELECT count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE status = 'skipped') INTO v_created, v_skipped FROM ins;
  SELECT count(*) INTO v_total FROM jsonb_array_elements(p_people);

  UPDATE public.auto_event_bot_settings SET birthday_scanned_on = v_today WHERE account_id = p_account_id;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped,
    'duplicates', GREATEST(0, v_total - v_created - v_skipped), 'date', to_char(v_today, 'YYYY-MM-DD'));
END;
$function$;

CREATE FUNCTION private.aka_agent_event_bot_claim_core(p_source text, p_staff_id bigint, p_runner_id text, p_account_ids bigint[], p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb := private.aka_agent_event_bot_config();
  v_now timestamptz := clock_timestamp();
  v_limit integer := LEAST(20, GREATEST(1, COALESCE(p_limit, 5)));
  v_jobs jsonb := '[]'::jsonb;
  v_paused jsonb := '[]'::jsonb;
  v_acc bigint;
  s public.auto_event_bot_settings%ROWTYPE;
  j public.auto_event_bot_jobs%ROWTYPE;
  r public.auto_event_bot_rules%ROWTYPE;
  v_status text;
  v_reason text;
  v_tries integer;
  v_token uuid;
  v_phone text;
  v_by text := CASE WHEN p_source = 'desktop' THEN 'desktop:' || p_staff_id::text ELSE p_source END;
BEGIN
  IF NOT private.aka_agent_event_bot_runtime_on(v_cfg, p_source) OR v_cfg->>'audience' = 'off'
     OR (p_staff_id IS NOT NULL AND NOT private.aka_agent_event_bot_access((SELECT s0.organization_id FROM public.org_staff s0 WHERE s0.id = p_staff_id), p_staff_id)) THEN
    RETURN jsonb_build_object('ok', true, 'enabled', false, 'pollSeconds', (v_cfg->>'pollSeconds')::int, 'jobs', '[]'::jsonb, 'paused', '[]'::jsonb);
  END IF;
  IF p_account_ids IS NOT NULL AND cardinality(p_account_ids) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many_accounts', 'message', 'Tối đa 500 tài khoản mỗi lần hỏi việc.');
  END IF;

  FOR v_acc IN SELECT DISTINCT x FROM unnest(COALESCE(p_account_ids, '{}'::bigint[])) x WHERE x IS NOT NULL ORDER BY 1 LOOP
    EXIT WHEN jsonb_array_length(v_jobs) >= v_limit;
    s := NULL;
    SELECT * INTO s FROM private.aka_agent_event_bot_runner_account(p_source, p_staff_id, v_acc);
    IF s.account_id IS NULL THEN CONTINUE; END IF;
    -- Khoá dòng settings: một nơi hỏi việc cho một tài khoản tại một lúc.
    PERFORM 1 FROM public.auto_event_bot_settings st WHERE st.account_id = v_acc AND st.enabled FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.auto_event_bot_settings SET last_claim_at = v_now, last_claim_source = p_source WHERE account_id = v_acc;
    IF s.paused_until IS NOT NULL AND s.paused_until > v_now THEN
      v_paused := v_paused || jsonb_build_object('accountId', v_acc, 'until', s.paused_until, 'code', s.pause_code);
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.auto_event_bot_jobs x WHERE x.account_id = v_acc AND x.status = 'sending') THEN
      CONTINUE;
    END IF;
    v_tries := 0;
    LOOP
      v_tries := v_tries + 1;
      EXIT WHEN v_tries > 50;
      j := NULL;
      SELECT * INTO j FROM public.auto_event_bot_jobs x
      WHERE x.account_id = v_acc AND x.status = 'pending' AND x.send_after <= v_now
      ORDER BY x.send_after, x.id LIMIT 1 FOR UPDATE SKIP LOCKED;
      EXIT WHEN j.id IS NULL;
      v_status := NULL; v_reason := NULL; r := NULL;
      IF j.expires_at IS NOT NULL AND j.expires_at <= v_now THEN
        v_status := 'expired'; v_reason := 'expired';
      ELSE
        SELECT * INTO r FROM public.auto_event_bot_rules rr WHERE rr.id = j.rule_id;
        IF r.id IS NULL OR r.is_delete OR NOT r.enabled OR r.account_id <> v_acc THEN
          v_status := 'skipped'; v_reason := 'rule_off';
        ELSIF r.revision IS DISTINCT FROM j.rule_revision THEN
          v_status := 'skipped'; v_reason := 'rule_changed';
        ELSE
          v_phone := NULL;
          SELECT ac.phone INTO v_phone FROM public.auto_account_contacts ac
          WHERE (j.contact_id IS NOT NULL AND ac.id = j.contact_id)
             OR (j.contact_id IS NULL AND ac.account_id = v_acc AND ac.contact_type = 'person' AND ac.uid = j.recipient_uid)
          LIMIT 1;
          IF private.aka_agent_event_bot_excluded(v_acc, s.blocklist_ids, j.recipient_uid, v_phone) THEN
            v_status := 'skipped'; v_reason := 'excluded';
          ELSIF j.event_type <> 'birthday' AND private.aka_agent_event_bot_gap_hit(r.id, j.recipient_uid, j.direction, r.min_gap_minutes) THEN
            v_status := 'skipped'; v_reason := 'min_gap';
          ELSIF j.direction = 'added' AND NOT EXISTS (SELECT 1 FROM public.auto_zalo_tag_members tm
              WHERE tm.account_id = v_acc AND tm.tag_id = j.tag_id AND tm.member_uid = j.recipient_uid) THEN
            v_status := 'skipped'; v_reason := 'no_longer_tagged';
          ELSIF j.direction = 'removed' AND EXISTS (SELECT 1 FROM public.auto_zalo_tag_members tm
              WHERE tm.account_id = v_acc AND tm.tag_id = j.tag_id AND tm.member_uid = j.recipient_uid) THEN
            v_status := 'skipped'; v_reason := 'tagged_again';
          ELSIF j.direction = 'enter' AND NOT COALESCE((SELECT o.is_current FROM public.auto_account_contact_group_member_origins o
              WHERE o.id = CASE WHEN j.source_ref ~ '^[0-9]{1,18}$' THEN j.source_ref::bigint END), false) THEN
            v_status := 'skipped'; v_reason := 'left_group';
          ELSIF j.direction = 'leave' AND COALESCE((SELECT o.is_current FROM public.auto_account_contact_group_member_origins o
              WHERE o.id = CASE WHEN j.source_ref ~ '^[0-9]{1,18}$' THEN j.source_ref::bigint END), false) THEN
            v_status := 'skipped'; v_reason := 'back_in_group';
          ELSIF NULLIF(btrim(COALESCE(j.message_template, '')), '') IS NULL OR NULLIF(btrim(COALESCE(j.recipient_uid, '')), '') IS NULL THEN
            v_status := 'skipped'; v_reason := 'rule_changed';
          END IF;
        END IF;
      END IF;
      IF v_status IS NOT NULL THEN
        UPDATE public.auto_event_bot_jobs SET status = v_status, reason_code = v_reason, updated_at = v_now WHERE id = j.id;
        CONTINUE;
      END IF;
      v_token := gen_random_uuid();
      UPDATE public.auto_event_bot_jobs
      SET status = 'sending', claim_token = v_token, claimed_at = v_now, claimed_by = v_by,
          runner_id = left(NULLIF(btrim(COALESCE(p_runner_id, '')), ''), 100), updated_at = v_now
      WHERE id = j.id;
      v_jobs := v_jobs || jsonb_build_object('jobId', j.id, 'claimToken', v_token, 'accountId', v_acc, 'eventType', j.event_type,
        'direction', j.direction, 'recipientUid', j.recipient_uid, 'recipientName', j.recipient_name, 'message', j.message_template);
      EXIT;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'enabled', true, 'pollSeconds', (v_cfg->>'pollSeconds')::int, 'jobs', v_jobs, 'paused', v_paused);
END;
$function$;

-- p_result: {status:'sent'|'failed'|'unknown', msgId?, zaloCode?, errorMessage?}.
CREATE FUNCTION private.aka_agent_event_bot_report_core(p_source text, p_staff_id bigint, p_job_id bigint, p_claim_token uuid, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  j public.auto_event_bot_jobs%ROWTYPE;
  v_in text := p_result->>'status';
  v_msg_id text := left(NULLIF(btrim(COALESCE(p_result->>'msgId', '')), ''), 100);
  v_code text := left(NULLIF(btrim(COALESCE(p_result->>'zaloCode', '')), ''), 20);
  v_err text := left(NULLIF(btrim(COALESCE(p_result->>'errorMessage', '')), ''), 300);
  v_status text;
  v_reason text;
  v_pause_min integer;
  v_pause_code text;
  v_until timestamptz;
  v_by text := CASE WHEN p_source = 'desktop' THEN 'desktop:' || p_staff_id::text ELSE p_source END;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL OR p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
     OR v_in IS NULL OR v_in NOT IN ('sent', 'failed', 'unknown') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_result', 'message', 'Kết quả gửi không hợp lệ.');
  END IF;
  SELECT * INTO j FROM public.auto_event_bot_jobs x WHERE x.id = p_job_id FOR UPDATE;
  IF j.id IS NULL OR (p_staff_id IS NOT NULL AND j.staff_id <> p_staff_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'job_not_found', 'message', 'Không tìm thấy việc của bot.');
  END IF;
  IF j.claim_token IS DISTINCT FROM p_claim_token OR j.claimed_by IS DISTINCT FROM v_by THEN
    RETURN jsonb_build_object('ok', false, 'code', 'claim_lost', 'message', 'Việc này không còn do nơi chạy này giữ.');
  END IF;
  -- Đã báo rồi (hoặc job dọn đã đóng mà không phải "mất nơi chạy"): trả lại kết quả cũ.
  IF NOT (j.status = 'sending' OR (j.status = 'unknown' AND j.reason_code = 'runner_lost')) THEN
    SELECT CASE WHEN st.paused_until > v_now THEN st.paused_until END INTO v_until
    FROM public.auto_event_bot_settings st WHERE st.account_id = j.account_id;
    RETURN jsonb_build_object('ok', true, 'status', j.status, 'pausedUntil', v_until, 'replay', true);
  END IF;

  IF v_in = 'sent' AND v_msg_id IS NOT NULL THEN
    v_status := 'sent';
  ELSIF v_in = 'sent' THEN
    v_status := 'failed'; v_reason := 'no_msg_id'; v_pause_min := 30; v_pause_code := 'no_msg_id';
  ELSIF v_in = 'failed' THEN
    v_status := 'failed';
    IF v_code IN ('120', '802') THEN
      v_reason := 'account_restricted'; v_pause_min := 24 * 60; v_pause_code := v_code;
    ELSIF v_code = '221' THEN
      v_reason := 'rate_limited'; v_pause_min := 60; v_pause_code := v_code;
    ELSIF v_code IS NOT NULL THEN
      v_reason := 'recipient_error';
    ELSE
      v_reason := 'send_error';
    END IF;
  ELSE
    v_status := 'unknown';
  END IF;

  UPDATE public.auto_event_bot_jobs
  SET status = v_status, reason_code = v_reason, zalo_error_code = v_code, error_message = v_err,
      sent_at = CASE WHEN v_status = 'sent' THEN v_now END, zalo_msg_id = CASE WHEN v_status = 'sent' THEN v_msg_id END,
      updated_at = v_now
  WHERE id = j.id;

  IF v_pause_min IS NOT NULL THEN
    UPDATE public.auto_event_bot_settings
    SET paused_until = GREATEST(COALESCE(paused_until, v_now), v_now + make_interval(mins => v_pause_min)),
        pause_code = v_pause_code,
        pause_reason = CASE v_pause_code
          WHEN '120' THEN 'Zalo đang chặn tài khoản nhắn người lạ (120)'
          WHEN '802' THEN 'Zalo đang chặn tài khoản nhắn người lạ (802)'
          WHEN '221' THEN 'Zalo báo gửi quá nhiều (221)'
          ELSE 'Zalo không nhận tin, có thể do gửi quá 30 tin trong 30 phút' END
    WHERE account_id = j.account_id
    RETURNING paused_until INTO v_until;
  ELSE
    SELECT CASE WHEN st.paused_until > v_now THEN st.paused_until END INTO v_until
    FROM public.auto_event_bot_settings st WHERE st.account_id = j.account_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', v_status, 'pausedUntil', v_until);
END;
$function$;

CREATE FUNCTION public.aka_agent_event_bot_sync_v1(p_source text, p_account_ids bigint[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET statement_timeout TO '10s'
AS $function$
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('server', 'fly') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_source', 'message', 'Nơi chạy không hợp lệ.');
  END IF;
  IF session_user = 'aka_agent_chat_api' AND p_source <> 'fly' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'event_bot_source_not_allowed';
  END IF;
  RETURN private.aka_agent_event_bot_sync_core(p_source, NULL, p_account_ids);
END;
$function$;

CREATE FUNCTION public.aka_agent_event_bot_birthdays_v1(p_source text, p_account_id bigint, p_people jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '5s'
SET statement_timeout TO '20s'
AS $function$
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('server', 'fly') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_source', 'message', 'Nơi chạy không hợp lệ.');
  END IF;
  IF session_user = 'aka_agent_chat_api' AND p_source <> 'fly' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'event_bot_source_not_allowed';
  END IF;
  RETURN private.aka_agent_event_bot_birthdays_core(p_source, NULL, p_account_id, p_people);
END;
$function$;

CREATE FUNCTION public.aka_agent_event_bot_claim_v1(p_source text, p_runner_id text, p_account_ids bigint[], p_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '3s'
SET statement_timeout TO '15s'
AS $function$
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('server', 'fly') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_source', 'message', 'Nơi chạy không hợp lệ.');
  END IF;
  IF session_user = 'aka_agent_chat_api' AND p_source <> 'fly' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'event_bot_source_not_allowed';
  END IF;
  RETURN private.aka_agent_event_bot_claim_core(p_source, NULL, p_runner_id, p_account_ids, p_limit);
END;
$function$;

CREATE FUNCTION public.aka_agent_event_bot_report_v1(p_source text, p_job_id bigint, p_claim_token uuid, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '3s'
SET statement_timeout TO '10s'
AS $function$
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('server', 'fly') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_source', 'message', 'Nơi chạy không hợp lệ.');
  END IF;
  IF session_user = 'aka_agent_chat_api' AND p_source <> 'fly' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'event_bot_source_not_allowed';
  END IF;
  RETURN private.aka_agent_event_bot_report_core(p_source, NULL, p_job_id, p_claim_token, p_result);
END;
$function$;

-- Desktop theo phiên: nhân viên lấy từ phiên (private.aka_agent_desktop_data_context), chỉ tài khoản của chính nhân viên.
CREATE FUNCTION private.aka_agent_event_bot_desktop_staff()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_staff bigint;
BEGIN
  SELECT ctx.staff_id INTO v_staff FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1;
  IF v_staff IS NULL OR v_staff <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'event_bot_desktop_identity_required';
  END IF;
  RETURN v_staff;
END;
$function$;

CREATE FUNCTION public.aka_agent_desktop_event_bot_sync_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET statement_timeout TO '5s'
AS $function$
BEGIN
  RETURN private.aka_agent_event_bot_sync_core('desktop', private.aka_agent_event_bot_desktop_staff(), NULL);
END;
$function$;

CREATE FUNCTION public.aka_agent_desktop_event_bot_birthdays_v1(p_account_id bigint, p_people jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '3s'
SET statement_timeout TO '10s'
AS $function$
BEGIN
  RETURN private.aka_agent_event_bot_birthdays_core('desktop', private.aka_agent_event_bot_desktop_staff(), p_account_id, p_people);
END;
$function$;

CREATE FUNCTION public.aka_agent_desktop_event_bot_claim_v1(p_runner_id text, p_account_ids bigint[], p_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '2s'
SET statement_timeout TO '3s'
AS $function$
BEGIN
  RETURN private.aka_agent_event_bot_claim_core('desktop', private.aka_agent_event_bot_desktop_staff(), p_runner_id, p_account_ids, p_limit);
END;
$function$;

CREATE FUNCTION public.aka_agent_desktop_event_bot_report_v1(p_job_id bigint, p_claim_token uuid, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '2s'
SET statement_timeout TO '3s'
AS $function$
BEGIN
  RETURN private.aka_agent_event_bot_report_core('desktop', private.aka_agent_event_bot_desktop_staff(), p_job_id, p_claim_token, p_result);
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Job dọn
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION private.aka_agent_event_bot_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '5s'
SET statement_timeout TO '90s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expired integer := 0;
  v_lost integer := 0;
  v_deleted integer := 0;
  v_n integer;
  v_batches integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent-event-bot-maintenance', 0)) THEN
    RETURN jsonb_build_object('busy', true);
  END IF;
  UPDATE public.auto_event_bot_jobs SET status = 'expired', reason_code = 'expired', updated_at = v_now
  WHERE id IN (SELECT x.id FROM public.auto_event_bot_jobs x WHERE x.status = 'pending' AND x.expires_at < v_now
               ORDER BY x.expires_at LIMIT 20000 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  UPDATE public.auto_event_bot_jobs SET status = 'unknown', reason_code = 'runner_lost', updated_at = v_now
  WHERE id IN (SELECT x.id FROM public.auto_event_bot_jobs x WHERE x.status = 'sending' AND x.claimed_at < v_now - interval '5 minutes'
               FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_lost = ROW_COUNT;
  -- Dọn việc cũ hơn 90 ngày theo lô (tối đa ~60 giây mỗi lượt, dưới trần 120 giây của job cron).
  LOOP
    DELETE FROM public.auto_event_bot_jobs
    WHERE id IN (SELECT x.id FROM public.auto_event_bot_jobs x WHERE x.created_at < v_now - interval '90 days'
                 AND x.status NOT IN ('pending', 'sending') ORDER BY x.created_at LIMIT 5000);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted + v_n;
    v_batches := v_batches + 1;
    EXIT WHEN v_n < 5000 OR v_batches >= 20 OR clock_timestamp() > v_now + interval '60 seconds';
  END LOOP;
  RETURN jsonb_build_object('expired', v_expired, 'runnerLost', v_lost, 'deleted', v_deleted);
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- RPC cho trang (API Web, service_role)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION private.aka_agent_event_bot_fail(p_code text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'event_bot:' || p_code, DETAIL = COALESCE(p_detail, '{}'::jsonb)::text;
END;
$function$;

CREATE FUNCTION private.aka_agent_event_bot_error_message(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT CASE p_code
    WHEN 'not_enabled' THEN 'Bot sự kiện chưa được mở cho tài khoản của bạn.'
    WHEN 'invalid_request' THEN 'Yêu cầu không hợp lệ.'
    WHEN 'unknown_action' THEN 'Thao tác không hợp lệ.'
    WHEN 'account_not_found' THEN 'Không tìm thấy tài khoản Zalo.'
    WHEN 'revision_conflict' THEN 'Cài đặt vừa được sửa ở nơi khác. Tải lại trang rồi sửa lại.'
    WHEN 'account_on_akachat' THEN 'Tài khoản này đang dùng bot của akaChat. Hãy cài bot sự kiện trong akaChat.'
    WHEN 'runtime_not_supported' THEN 'Bot sự kiện chưa hỗ trợ tài khoản Zalo Server trên máy chủ mới.'
    WHEN 'blocklist_not_found' THEN 'Không tìm thấy danh sách không gửi đã chọn.'
    WHEN 'rule_not_found' THEN 'Không tìm thấy quy tắc. Tải lại trang rồi thử lại.'
    WHEN 'rule_invalid' THEN 'Quy tắc chưa hợp lệ.'
    WHEN 'data_group_not_found' THEN 'Không tìm thấy nhóm điều kiện đã chọn.'
    WHEN 'data_group_no_filter' THEN 'Nhóm đã chọn chưa có bộ lọc động.'
    WHEN 'duplicate_group' THEN 'Mỗi nhóm điều kiện chỉ cài một lần cho một tài khoản.'
    WHEN 'exclusion_limit' THEN 'Mỗi tài khoản tối đa 5.000 người trong danh sách loại trừ.'
    WHEN 'exclusion_invalid' THEN 'UID hoặc số điện thoại không hợp lệ.'
    WHEN 'job_not_found' THEN 'Không tìm thấy việc của bot.'
    ELSE 'Có lỗi xảy ra, vui lòng thử lại.'
  END;
$function$;

-- Số nguyên từ jsonb (số nguyên hoặc chuỗi chữ số); không phải thì NULL.
CREATE FUNCTION private.aka_agent_event_bot_int(p_value jsonb)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_value) IN ('number', 'string') AND btrim(p_value #>> '{}') ~ '^-?[0-9]{1,15}$'
    THEN btrim(p_value #>> '{}')::bigint END;
$function$;

-- Dòng tài khoản cho danh sách / get. p_chat, p_fly: kết quả theo tổ chức đã tính sẵn.
CREATE FUNCTION private.aka_agent_event_bot_account_json(p_account_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'accountId', a.id,
    'name', COALESCE(NULLIF(btrim(a.name), ''), NULLIF(btrim(za.display_name), ''), ''),
    'avatarUrl', za.avatar_url,
    'kind', CASE WHEN COALESCE(a.is_zalo_server, false) THEN 'server' WHEN COALESCE(a.is_zalo_show_web, false) THEN 'web' ELSE 'qr' END,
    'loginStatus', a.login_status,
    'runsOn', private.aka_agent_event_bot_runs_on(a.id),
    'botEnabled', COALESCE(s.enabled, false),
    'enabledEvents', (SELECT count(*) FROM public.auto_event_bot_rules r WHERE r.account_id = a.id AND r.enabled AND NOT r.is_delete),
    'pausedUntil', CASE WHEN s.paused_until > clock_timestamp() THEN s.paused_until END,
    'pauseCode', CASE WHEN s.paused_until > clock_timestamp() THEN s.pause_code END,
    'lastClaimAt', s.last_claim_at)
  FROM public.auto_accounts a
  LEFT JOIN public.zalo_accounts za ON za.id = a.zalo_account_id
  LEFT JOIN public.auto_event_bot_settings s ON s.account_id = a.id
  WHERE a.id = p_account_id;
$function$;

CREATE FUNCTION private.aka_agent_event_bot_exclusions_json(p_account_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'value', x.value, 'name', x.name, 'source', x.source,
    'createdAt', x.created_at) ORDER BY x.id DESC), '[]'::jsonb)
  FROM public.auto_event_bot_exclusions x WHERE x.account_id = p_account_id;
$function$;

-- Tài khoản Zalo chưa xoá của đúng nhân viên + tổ chức, hoặc lỗi account_not_found.
CREATE FUNCTION private.aka_agent_event_bot_owned_account(p_staff_id bigint, p_organization_id bigint, p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_acc bigint := private.aka_agent_event_bot_int(p_payload->'accountId');
BEGIN
  IF v_acc IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.auto_accounts a
    WHERE a.id = v_acc AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
      AND lower(btrim(COALESCE(a.flatform_type, ''))) = 'zalo' AND NOT COALESCE(a.is_delete, false)) THEN
    PERFORM private.aka_agent_event_bot_fail('account_not_found');
  END IF;
  RETURN v_acc;
END;
$function$;

CREATE FUNCTION private.aka_agent_event_bot_get(p_staff_id bigint, p_organization_id bigint, p_account_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  s public.auto_event_bot_settings%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO s FROM public.auto_event_bot_settings st WHERE st.account_id = p_account_id;
  RETURN jsonb_build_object(
    'account', private.aka_agent_event_bot_account_json(p_account_id),
    'settings', jsonb_build_object(
      'enabled', COALESCE(s.enabled, false), 'blocklistIds', to_jsonb(COALESCE(s.blocklist_ids, '{}'::bigint[])),
      'pausedUntil', CASE WHEN s.paused_until > v_now THEN s.paused_until END,
      'pauseCode', CASE WHEN s.paused_until > v_now THEN s.pause_code END,
      'pauseReason', CASE WHEN s.paused_until > v_now THEN s.pause_reason END,
      'revision', COALESCE(s.revision, 0), 'updatedAt', s.updated_at,
      'lastClaimAt', s.last_claim_at, 'lastClaimSource', s.last_claim_source),
    'rules', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'eventType', r.event_type, 'name', r.name, 'enabled', r.enabled,
        'position', r.position, 'config', r.config, 'dataGroupId', r.data_group_id, 'minGapMinutes', r.min_gap_minutes,
        'revision', r.revision) ORDER BY r.position, r.id)
      FROM public.auto_event_bot_rules r WHERE r.account_id = p_account_id AND NOT r.is_delete), '[]'::jsonb),
    'exclusions', private.aka_agent_event_bot_exclusions_json(p_account_id),
    'blocklists', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'accountId', g.account_id,
        'count', (SELECT count(*) FROM public.auto_account_contact_group_members m WHERE m.group_id = g.id AND NOT m.is_delete),
        'updatedAt', g.updated_at) ORDER BY g.name, g.id)
      FROM public.auto_account_contact_groups g
      WHERE g.staff_id = p_staff_id AND g.organization_id = p_organization_id AND NOT g.is_delete
        AND g.purpose = 'zalo_friend_blocklist' AND g.contact_type = 'person'), '[]'::jsonb),
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.uid, 'name', t.name) ORDER BY t.name, t.uid)
      FROM public.auto_account_contacts t
      WHERE t.account_id = p_account_id AND t.contact_type = 'zalo_tag' AND NOT COALESCE(t.is_delete, false)
        AND NULLIF(btrim(t.uid), '') IS NOT NULL), '[]'::jsonb),
    'dataGroups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
        'hasDynamicFilter', EXISTS (SELECT 1 FROM public.auto_account_contact_group_dynamic_filters f WHERE f.group_id = g.id AND f.is_enabled),
        'memberCount', (SELECT count(*) FROM public.auto_account_contact_group_members m WHERE m.group_id = g.id AND NOT m.is_delete))
        ORDER BY g.name, g.id)
      FROM (SELECT g0.* FROM public.auto_account_contact_groups g0
            JOIN public.category_item ci ON ci.id = g0.data_type_category_item_id AND ci.code = 'zalo_person'
            WHERE g0.staff_id = p_staff_id AND g0.organization_id = p_organization_id AND NOT g0.is_delete
              AND g0.purpose = 'data_group' AND (g0.bound_zalo_account_id IS NULL OR g0.bound_zalo_account_id = p_account_id)
            ORDER BY g0.updated_at DESC, g0.id DESC LIMIT 300) g), '[]'::jsonb),
    -- Máy Desktop gần nhất của nhân viên (dải trạng thái phân biệt "app đang tắt" với "app cần cập nhật").
    'desktop', (SELECT jsonb_build_object(
        'online', pr.ended_at IS NULL AND pr.last_seen_at > v_now - interval '2 minutes',
        'lastSeenAt', pr.last_seen_at, 'appVersion', pr.app_version,
        'supportsEventBot', CASE WHEN pr.runtime_state IS NULL THEN NULL ELSE pr.runtime_state ? 'eventBot' END)
      FROM public.auto_staff_device_presence pr
      WHERE pr.staff_id = p_staff_id AND pr.organization_id = p_organization_id
      ORDER BY pr.last_seen_at DESC NULLS LAST LIMIT 1),
    'conflicts', jsonb_build_object(
      'birthdayCampaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.id)
        FROM public.auto_campaigns c WHERE c.account_id = p_account_id AND c.action_id = 'zalo_message_birthday'
          AND NOT COALESCE(c.is_delete, false) AND c.status IN ('chờ xử lý', 'đang chạy')), '[]'::jsonb),
      'tagAutoAddCampaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'tagIds', to_jsonb(sc.tag_ids)) ORDER BY c.id)
        FROM public.auto_zalo_tag_sync_campaigns sc JOIN public.auto_campaigns c ON c.id = sc.campaign_id
        WHERE sc.account_id = p_account_id), '[]'::jsonb)),
    'stats', COALESCE((SELECT jsonb_object_agg(r.id::text, jsonb_build_object(
        'inGroup', (SELECT count(*) FROM public.auto_account_contact_group_members m
                    JOIN public.auto_account_contacts ac ON ac.id = m.contact_id AND ac.account_id = p_account_id
                    WHERE m.group_id = r.data_group_id AND NOT m.is_delete),
        'entered24h', (SELECT count(*) FROM public.auto_event_bot_jobs j WHERE j.account_id = p_account_id AND j.rule_id = r.id
                       AND j.direction = 'enter' AND j.created_at > v_now - interval '24 hours'),
        'left24h', (SELECT count(*) FROM public.auto_event_bot_jobs j WHERE j.account_id = p_account_id AND j.rule_id = r.id
                    AND j.direction = 'leave' AND j.created_at > v_now - interval '24 hours'),
        'sent7d', (SELECT count(*) FROM public.auto_event_bot_jobs j WHERE j.account_id = p_account_id AND j.rule_id = r.id
                   AND j.status = 'sent' AND j.created_at > v_now - interval '7 days')))
      FROM public.auto_event_bot_rules r
      WHERE r.account_id = p_account_id AND r.event_type = 'condition_group' AND NOT r.is_delete), '{}'::jsonb)
  );
END;
$function$;

-- Kiểm + chuẩn hoá một quy tắc gửi lên (luật như validateEventBotRule của src/shared/eventBot.ts). Trả jsonb chuẩn hoá.
CREATE FUNCTION private.aka_agent_event_bot_rule_normalize(p_rule jsonb, p_index integer, p_staff_id bigint, p_organization_id bigint, p_account_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_type text := p_rule->>'eventType';
  v_c jsonb := CASE WHEN jsonb_typeof(p_rule->'config') = 'object' THEN p_rule->'config' ELSE '{}'::jsonb END;
  v_name text := COALESCE(btrim(p_rule->>'name'), '');
  v_gap bigint;
  v_cfg jsonb;
  v_group bigint;
  v_min bigint;
  v_max bigint;
  v_tags jsonb;
  v_tag_names jsonb;
  v_msg text;
  v_enter jsonb;
  v_leave jsonb;
  v_issue text;
  v_field text;
BEGIN
  IF jsonb_typeof(p_rule) <> 'object' OR v_type IS NULL OR v_type NOT IN ('birthday', 'tag_change', 'condition_group') THEN
    PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'eventType', 'message', 'Loại sự kiện không hợp lệ'));
  END IF;
  IF char_length(v_name) > 80 THEN
    PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'name', 'message', 'Tên tối đa 80 ký tự'));
  END IF;
  v_gap := CASE WHEN p_rule ? 'minGapMinutes' AND jsonb_typeof(p_rule->'minGapMinutes') <> 'null'
    THEN private.aka_agent_event_bot_int(p_rule->'minGapMinutes')
    ELSE CASE v_type WHEN 'tag_change' THEN 720 ELSE 0 END END;
  IF v_gap IS NULL OR v_gap < 0 OR v_gap > 43200 THEN
    PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'minGapMinutes', 'message', 'Khoảng cách tối thiểu không hợp lệ'));
  END IF;

  IF v_type IN ('tag_change', 'condition_group') THEN
    v_min := private.aka_agent_event_bot_int(v_c->'delay'->'minSeconds');
    v_max := private.aka_agent_event_bot_int(v_c->'delay'->'maxSeconds');
    IF v_min IS NULL OR v_max IS NULL OR v_min < 0 OR v_max < v_min OR v_max > 600 THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'delay',
        'message', 'Thời gian chờ phải từ 0 đến 600 giây, số đầu không lớn hơn số sau'));
    END IF;
  END IF;

  IF v_type = 'birthday' THEN
    IF COALESCE(v_c->>'sendTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'sendTime', 'message', 'Giờ gửi dạng HH:MM'));
    END IF;
    v_msg := v_c->>'message'; v_field := 'message';
  ELSIF v_type = 'tag_change' THEN
    IF COALESCE(v_c->>'direction', '') NOT IN ('added', 'removed') THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'direction', 'message', 'Chọn được gắn hoặc bị gỡ tag'));
    END IF;
    SELECT COALESCE(jsonb_agg(DISTINCT btrim(t #>> '{}')), '[]'::jsonb) INTO v_tags
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_c->'tagIds') = 'array' THEN v_c->'tagIds' ELSE '[]'::jsonb END) t
    WHERE jsonb_typeof(t) IN ('string', 'number') AND btrim(t #>> '{}') <> '';
    IF jsonb_array_length(v_tags) = 0 THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'tagIds', 'message', 'Chọn ít nhất một tag'));
    END IF;
    IF jsonb_array_length(v_tags) > 20 THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'tagIds', 'message', 'Tối đa 20 tag mỗi quy tắc'));
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_tags) t WHERE t !~ '^[0-9A-Za-z_-]{1,40}$') THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'tagIds', 'message', 'Mã tag không hợp lệ'));
    END IF;
    SELECT COALESCE(jsonb_agg(left(t #>> '{}', 80)), '[]'::jsonb) INTO v_tag_names
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_c->'tagNames') = 'array' THEN v_c->'tagNames' ELSE '[]'::jsonb END) t
    WHERE jsonb_typeof(t) = 'string';
    v_msg := v_c->>'message'; v_field := 'message';
  ELSE
    v_group := private.aka_agent_event_bot_int(p_rule->'dataGroupId');
    IF v_group IS NULL OR v_group <= 0 THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'dataGroupId', 'message', 'Chọn nhóm điều kiện'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.auto_account_contact_groups g
                   JOIN public.category_item ci ON ci.id = g.data_type_category_item_id AND ci.code = 'zalo_person'
                   WHERE g.id = v_group AND g.staff_id = p_staff_id AND g.organization_id = p_organization_id AND NOT g.is_delete
                     AND g.purpose = 'data_group' AND (g.bound_zalo_account_id IS NULL OR g.bound_zalo_account_id = p_account_id)) THEN
      PERFORM private.aka_agent_event_bot_fail('data_group_not_found', jsonb_build_object('index', p_index, 'field', 'dataGroupId'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.auto_account_contact_group_dynamic_filters f WHERE f.group_id = v_group) THEN
      PERFORM private.aka_agent_event_bot_fail('data_group_no_filter', jsonb_build_object('index', p_index, 'field', 'dataGroupId'));
    END IF;
    v_enter := jsonb_build_object('enabled', v_c->'onEnter'->'enabled' = 'true'::jsonb, 'message', COALESCE(v_c->'onEnter'->>'message', ''));
    v_leave := jsonb_build_object('enabled', v_c->'onLeave'->'enabled' = 'true'::jsonb, 'message', COALESCE(v_c->'onLeave'->>'message', ''));
    IF NOT ((v_enter->>'enabled')::boolean OR (v_leave->>'enabled')::boolean) THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', 'onEnter',
        'message', 'Bật ít nhất một tin: khi vào nhóm hoặc khi ra nhóm'));
    END IF;
  END IF;

  -- Nội dung tin.
  FOR v_field, v_msg IN
    SELECT f, m FROM (VALUES ('message', v_msg), ('onEnter', CASE WHEN (v_enter->>'enabled')::boolean THEN v_enter->>'message' END),
                             ('onLeave', CASE WHEN (v_leave->>'enabled')::boolean THEN v_leave->>'message' END)) x(f, m)
    WHERE (v_type <> 'condition_group' AND f = 'message') OR (v_type = 'condition_group' AND f <> 'message' AND m IS NOT NULL)
  LOOP
    v_issue := CASE
      WHEN NULLIF(btrim(COALESCE(v_msg, '')), '') IS NULL THEN 'Nhập nội dung tin'
      WHEN char_length(v_msg) > 2000 THEN 'Nội dung tối đa 2000 ký tự'
      WHEN v_msg ~* '#\{\s*INPUT_' THEN 'Bot không điền được biến cột file (#{INPUT_…})'
    END;
    IF v_issue IS NOT NULL THEN
      PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', p_index, 'field', v_field, 'message', v_issue));
    END IF;
  END LOOP;

  v_cfg := CASE v_type
    WHEN 'birthday' THEN jsonb_build_object('sendTime', v_c->>'sendTime', 'message', v_c->>'message')
    WHEN 'tag_change' THEN jsonb_build_object('direction', v_c->>'direction', 'tagIds', v_tags, 'tagNames', v_tag_names,
      'message', v_c->>'message', 'delay', jsonb_build_object('minSeconds', v_min, 'maxSeconds', v_max))
    ELSE jsonb_build_object('onEnter', v_enter, 'onLeave', v_leave, 'delay', jsonb_build_object('minSeconds', v_min, 'maxSeconds', v_max))
  END;
  RETURN jsonb_build_object(
    'id', private.aka_agent_event_bot_int(p_rule->'id'),
    'eventType', v_type, 'name', v_name,
    'enabled', COALESCE(p_rule->'enabled' <> 'false'::jsonb, true),
    'position', COALESCE(private.aka_agent_event_bot_int(p_rule->'position'), p_index),
    'config', v_cfg, 'dataGroupId', v_group, 'minGapMinutes', v_gap);
END;
$function$;

-- Đóng việc đang chờ của tài khoản (bot tắt / quy tắc tắt / quy tắc đổi).
CREATE FUNCTION private.aka_agent_event_bot_close_pending(p_account_id bigint, p_reason text, p_rule_ids bigint[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.auto_event_bot_jobs SET status = 'skipped', reason_code = p_reason, updated_at = clock_timestamp()
  WHERE account_id = p_account_id AND status = 'pending' AND (p_rule_ids IS NULL OR rule_id = ANY (p_rule_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- Tài khoản có đang được bot nhờ hỏi tag không (để ghi dấu đặt lại mốc sổ tag khi đổi).
CREATE FUNCTION private.aka_agent_event_bot_tag_watched(p_account_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.auto_event_bot_settings s
                 JOIN public.auto_event_bot_rules r ON r.account_id = s.account_id
                 WHERE s.account_id = p_account_id AND s.enabled AND r.event_type = 'tag_change' AND r.enabled AND NOT r.is_delete);
$function$;

CREATE FUNCTION private.aka_agent_event_bot_save(p_staff_id bigint, p_organization_id bigint, p_account_id bigint, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  s public.auto_event_bot_settings%ROWTYPE;
  v_rev bigint := private.aka_agent_event_bot_int(p_payload->'revision');
  v_enabled boolean := p_payload->'enabled' = 'true'::jsonb;
  v_block bigint[];
  v_rules jsonb := '[]'::jsonb;
  v_rule jsonb;
  v_norm jsonb;
  v_i integer := 0;
  v_runs text;
  v_keep bigint[] := '{}';
  v_changed bigint[] := '{}';
  v_off bigint[] := '{}';
  v_old public.auto_event_bot_rules%ROWTYPE;
  v_id bigint;
  v_was_watched boolean;
  v_closed integer := 0;
BEGIN
  IF jsonb_typeof(p_payload->'rules') IS DISTINCT FROM 'array' OR v_rev IS NULL
     OR jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean' THEN
    PERFORM private.aka_agent_event_bot_fail('invalid_request');
  END IF;
  IF jsonb_array_length(p_payload->'rules') > 81 THEN
    PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', -1, 'field', 'rules', 'message', 'Quá nhiều quy tắc'));
  END IF;

  INSERT INTO public.auto_event_bot_settings (account_id, organization_id, staff_id, enabled, revision, updated_by)
  VALUES (p_account_id, p_organization_id, p_staff_id, false, 0, p_staff_id)
  ON CONFLICT (account_id) DO NOTHING;
  SELECT * INTO s FROM public.auto_event_bot_settings st WHERE st.account_id = p_account_id FOR UPDATE;
  IF s.revision <> v_rev THEN
    RETURN jsonb_build_object('ok', false, 'code', 'revision_conflict',
      'message', private.aka_agent_event_bot_error_message('revision_conflict'), 'revision', s.revision);
  END IF;
  v_was_watched := private.aka_agent_event_bot_tag_watched(p_account_id);

  IF v_enabled THEN
    v_runs := private.aka_agent_event_bot_runs_on(p_account_id);
    IF v_runs = 'akachat' THEN
      PERFORM private.aka_agent_event_bot_fail('account_on_akachat');
    ELSIF v_runs IS NULL OR NOT private.aka_agent_event_bot_runtime_on(private.aka_agent_event_bot_config(), v_runs) THEN
      PERFORM private.aka_agent_event_bot_fail('runtime_not_supported');
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_block
  FROM (SELECT private.aka_agent_event_bot_int(e) AS x
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload->'blocklistIds') = 'array' THEN p_payload->'blocklistIds' ELSE '[]'::jsonb END) e) q;
  IF cardinality(v_block) > 50 OR EXISTS (SELECT 1 FROM unnest(v_block) b WHERE b IS NULL)
     OR cardinality(v_block) <> (SELECT count(*) FROM public.auto_account_contact_groups g
       WHERE g.id = ANY (v_block) AND g.staff_id = p_staff_id AND g.organization_id = p_organization_id AND NOT g.is_delete
         AND g.purpose = 'zalo_friend_blocklist' AND g.contact_type = 'person') THEN
    PERFORM private.aka_agent_event_bot_fail('blocklist_not_found');
  END IF;

  FOR v_rule IN SELECT e FROM jsonb_array_elements(p_payload->'rules') e LOOP
    v_rules := v_rules || jsonb_build_array(private.aka_agent_event_bot_rule_normalize(v_rule, v_i, p_staff_id, p_organization_id, p_account_id));
    v_i := v_i + 1;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(v_rules) e WHERE e->>'eventType' = 'birthday') > 1 THEN
    PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', -1, 'field', 'rules', 'message', 'Mỗi tài khoản chỉ có một quy tắc sinh nhật'));
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_rules) e WHERE e->>'eventType' = 'tag_change') > 50 THEN
    PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', -1, 'field', 'rules', 'message', 'Tối đa 50 quy tắc tag'));
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_rules) e WHERE e->>'eventType' = 'condition_group') > 30 THEN
    PERFORM private.aka_agent_event_bot_fail('rule_invalid', jsonb_build_object('index', -1, 'field', 'rules', 'message', 'Tối đa 30 nhóm điều kiện'));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) e WHERE e->>'eventType' = 'condition_group'
             GROUP BY e->>'dataGroupId' HAVING count(*) > 1) THEN
    PERFORM private.aka_agent_event_bot_fail('duplicate_group');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) e WHERE e->>'id' IS NOT NULL GROUP BY e->>'id' HAVING count(*) > 1) THEN
    PERFORM private.aka_agent_event_bot_fail('invalid_request');
  END IF;

  FOR v_norm IN SELECT e FROM jsonb_array_elements(v_rules) e LOOP
    v_id := (v_norm->>'id')::bigint;
    IF v_id IS NOT NULL THEN
      SELECT * INTO v_old FROM public.auto_event_bot_rules r WHERE r.id = v_id AND r.account_id = p_account_id AND NOT r.is_delete FOR UPDATE;
      IF v_old.id IS NULL OR v_old.event_type <> v_norm->>'eventType' THEN
        PERFORM private.aka_agent_event_bot_fail('rule_not_found', jsonb_build_object('ruleId', v_id));
      END IF;
      IF v_old.config IS DISTINCT FROM v_norm->'config' OR v_old.data_group_id IS DISTINCT FROM (v_norm->>'dataGroupId')::bigint
         OR v_old.min_gap_minutes IS DISTINCT FROM (v_norm->>'minGapMinutes')::int THEN
        v_changed := v_changed || v_id;
      END IF;
      IF NOT (v_norm->>'enabled')::boolean AND v_old.enabled THEN
        v_off := v_off || v_id;
      END IF;
      UPDATE public.auto_event_bot_rules SET
        name = v_norm->>'name', enabled = (v_norm->>'enabled')::boolean, position = (v_norm->>'position')::int,
        config = v_norm->'config', data_group_id = (v_norm->>'dataGroupId')::bigint, min_gap_minutes = (v_norm->>'minGapMinutes')::int,
        revision = revision + CASE WHEN v_id = ANY (v_changed) THEN 1 ELSE 0 END,
        updated_at = v_now
      WHERE id = v_id;
      v_keep := v_keep || v_id;
    ELSE
      INSERT INTO public.auto_event_bot_rules (account_id, organization_id, staff_id, event_type, name, enabled, position, config,
        data_group_id, min_gap_minutes, created_at, updated_at)
      VALUES (p_account_id, p_organization_id, p_staff_id, v_norm->>'eventType', v_norm->>'name', (v_norm->>'enabled')::boolean,
        (v_norm->>'position')::int, v_norm->'config', (v_norm->>'dataGroupId')::bigint, (v_norm->>'minGapMinutes')::int, v_now, v_now)
      RETURNING id INTO v_id;
      v_keep := v_keep || v_id;
    END IF;
  END LOOP;

  -- Quy tắc không có trong danh sách gửi lên: xoá mềm.
  WITH gone AS (
    UPDATE public.auto_event_bot_rules SET is_delete = true, enabled = false, updated_at = v_now
    WHERE account_id = p_account_id AND NOT is_delete AND NOT (id = ANY (v_keep))
    RETURNING id
  )
  SELECT v_off || COALESCE(array_agg(id), '{}') INTO v_off FROM gone;

  UPDATE public.auto_event_bot_settings SET
    organization_id = p_organization_id, staff_id = p_staff_id, enabled = v_enabled, blocklist_ids = v_block,
    revision = s.revision + 1, updated_by = p_staff_id, updated_at = v_now
  WHERE account_id = p_account_id;

  IF NOT v_enabled THEN
    v_closed := private.aka_agent_event_bot_close_pending(p_account_id, 'bot_off');
  ELSE
    IF cardinality(v_off) > 0 THEN v_closed := v_closed + private.aka_agent_event_bot_close_pending(p_account_id, 'rule_off', v_off); END IF;
    IF cardinality(v_changed) > 0 THEN v_closed := v_closed + private.aka_agent_event_bot_close_pending(p_account_id, 'rule_changed', v_changed); END IF;
  END IF;

  -- Tài khoản vừa bắt đầu / thôi được bot nhờ hỏi tag (và không có chiến dịch tự thêm): sổ tag lấy lại mốc ở lần đọc kế tiếp,
  -- để tag gắn trong lúc tắt không được gửi bù.
  IF v_was_watched IS DISTINCT FROM private.aka_agent_event_bot_tag_watched(p_account_id)
     AND NOT EXISTS (SELECT 1 FROM public.auto_zalo_tag_sync_campaigns sc WHERE sc.account_id = p_account_id) THEN
    INSERT INTO public.auto_zalo_tag_sync_resets (account_id, reset_at) VALUES (p_account_id, v_now)
    ON CONFLICT (account_id) DO UPDATE SET reset_at = EXCLUDED.reset_at;
  END IF;

  RETURN jsonb_build_object('ok', true, 'data', private.aka_agent_event_bot_get(p_staff_id, p_organization_id, p_account_id) || jsonb_build_object('closedJobs', v_closed));
END;
$function$;

CREATE FUNCTION public.aka_agent_control_event_bot(p_staff_id bigint, p_organization_id bigint, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_payload jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  v_cfg jsonb := private.aka_agent_event_bot_config();
  v_acc bigint;
  v_n integer;
  v_days integer;
  v_limit integer;
  v_before bigint;
  v_items jsonb;
  v_res jsonb;
  v_msg text;
  v_detail text;
  v_d jsonb;
  v_code text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    PERFORM private.aka_agent_event_bot_fail('invalid_request');
  END IF;
  IF p_action = 'access' THEN
    RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'enabled', private.aka_agent_event_bot_access(p_organization_id, p_staff_id), 'audience', v_cfg->>'audience'));
  END IF;
  IF NOT private.aka_agent_event_bot_access(p_organization_id, p_staff_id) THEN
    PERFORM private.aka_agent_event_bot_fail('not_enabled');
  END IF;

  IF p_action = 'accounts' THEN
    RETURN jsonb_build_object('ok', true, 'data', COALESCE((
      SELECT jsonb_agg(private.aka_agent_event_bot_account_json(a.id) ORDER BY a.name, a.id)
      FROM public.auto_accounts a
      WHERE a.staff_id = p_staff_id AND a.organization_id = p_organization_id
        AND lower(btrim(COALESCE(a.flatform_type, ''))) = 'zalo' AND NOT COALESCE(a.is_delete, false)), '[]'::jsonb));
  END IF;

  IF p_action NOT IN ('get', 'save', 'stop', 'exclusion_add', 'exclusion_remove', 'log', 'log_detail', 'report') THEN
    PERFORM private.aka_agent_event_bot_fail('unknown_action');
  END IF;
  v_acc := private.aka_agent_event_bot_owned_account(p_staff_id, p_organization_id, v_payload);

  IF p_action = 'get' THEN
    RETURN jsonb_build_object('ok', true, 'data', private.aka_agent_event_bot_get(p_staff_id, p_organization_id, v_acc));

  ELSIF p_action = 'save' THEN
    RETURN private.aka_agent_event_bot_save(p_staff_id, p_organization_id, v_acc, v_payload);

  ELSIF p_action = 'stop' THEN
    PERFORM 1 FROM public.auto_event_bot_settings s WHERE s.account_id = v_acc FOR UPDATE;
    UPDATE public.auto_event_bot_settings SET enabled = false, revision = revision + 1, updated_by = p_staff_id, updated_at = clock_timestamp()
    WHERE account_id = v_acc AND enabled;
    v_n := private.aka_agent_event_bot_close_pending(v_acc, 'bot_off');
    RETURN jsonb_build_object('ok', true, 'data', private.aka_agent_event_bot_get(p_staff_id, p_organization_id, v_acc) || jsonb_build_object('closedJobs', v_n));

  ELSIF p_action = 'exclusion_add' THEN
    IF jsonb_typeof(v_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(v_payload->'items') > 500 THEN
      PERFORM private.aka_agent_event_bot_fail('invalid_request');
    END IF;
    WITH raw AS (
      SELECT e->>'kind' AS kind, btrim(COALESCE(e->>'value', '')) AS value, left(NULLIF(btrim(COALESCE(e->>'name', '')), ''), 80) AS name,
        CASE WHEN e->>'source' = 'log' THEN 'log' ELSE 'manual' END AS source
      FROM jsonb_array_elements(v_payload->'items') e WHERE jsonb_typeof(e) = 'object'
    )
    SELECT jsonb_agg(jsonb_build_object('kind', kind, 'value', CASE WHEN kind = 'phone' THEN private.aka_agent_event_bot_norm_phone(value) ELSE value END,
      'name', name, 'source', source)) INTO v_items FROM raw;
    IF v_items IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i
       WHERE NOT ((i->>'kind' = 'uid' AND COALESCE(i->>'value', '') ~ '^[0-9]{8,25}$') OR (i->>'kind' = 'phone' AND i->>'value' IS NOT NULL))) THEN
      PERFORM private.aka_agent_event_bot_fail('exclusion_invalid');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-event-bot-exclusions:' || v_acc::text, 0));
    IF (SELECT count(*) FROM public.auto_event_bot_exclusions x WHERE x.account_id = v_acc)
       + (SELECT count(DISTINCT (i->>'kind', i->>'value')) FROM jsonb_array_elements(v_items) i
          WHERE NOT EXISTS (SELECT 1 FROM public.auto_event_bot_exclusions x WHERE x.account_id = v_acc AND x.kind = i->>'kind' AND x.value = i->>'value')) > 5000 THEN
      PERFORM private.aka_agent_event_bot_fail('exclusion_limit');
    END IF;
    INSERT INTO public.auto_event_bot_exclusions (account_id, kind, value, name, source, created_by)
    SELECT DISTINCT ON (i->>'kind', i->>'value') v_acc, i->>'kind', i->>'value', i->>'name', i->>'source', p_staff_id
    FROM jsonb_array_elements(v_items) i
    ON CONFLICT (account_id, kind, value) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object('added', v_n, 'exclusions', private.aka_agent_event_bot_exclusions_json(v_acc)));

  ELSIF p_action = 'exclusion_remove' THEN
    IF jsonb_typeof(v_payload->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(v_payload->'ids') > 5000 THEN
      PERFORM private.aka_agent_event_bot_fail('invalid_request');
    END IF;
    DELETE FROM public.auto_event_bot_exclusions x
    WHERE x.account_id = v_acc AND x.id IN (SELECT private.aka_agent_event_bot_int(e) FROM jsonb_array_elements(v_payload->'ids') e);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object('removed', v_n, 'exclusions', private.aka_agent_event_bot_exclusions_json(v_acc)));

  ELSIF p_action = 'log' THEN
    v_days := LEAST(90, GREATEST(1, COALESCE(private.aka_agent_event_bot_int(v_payload->'days'), 7)));
    v_limit := LEAST(100, GREATEST(1, COALESCE(private.aka_agent_event_bot_int(v_payload->'limit'), 50)));
    v_before := private.aka_agent_event_bot_int(v_payload->'before');
    SELECT COALESCE(jsonb_agg(x.j ORDER BY x.id DESC), '[]'::jsonb), CASE WHEN count(*) = v_limit THEN min(x.id) END INTO v_items, v_before
    FROM (
      SELECT j.id, jsonb_build_object('id', j.id, 'eventType', j.event_type, 'direction', j.direction, 'ruleName', r.name,
        'recipientName', j.recipient_name, 'recipientUid', j.recipient_uid, 'status', j.status, 'reasonCode', j.reason_code,
        'zaloErrorCode', j.zalo_error_code, 'sendAfter', j.send_after, 'sentAt', j.sent_at, 'createdAt', j.created_at) AS j
      FROM public.auto_event_bot_jobs j
      LEFT JOIN public.auto_event_bot_rules r ON r.id = j.rule_id
      WHERE j.account_id = v_acc AND j.created_at > clock_timestamp() - make_interval(days => v_days)
        AND (v_before IS NULL OR j.id < v_before)
        AND (v_payload->>'status' IS NULL OR j.status = v_payload->>'status')
        AND (v_payload->>'eventType' IS NULL OR j.event_type = v_payload->>'eventType')
      ORDER BY j.id DESC LIMIT v_limit
    ) x;
    RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object('items', v_items, 'nextBefore', v_before));

  ELSIF p_action = 'log_detail' THEN
    SELECT jsonb_build_object('id', j.id, 'eventType', j.event_type, 'direction', j.direction, 'ruleId', j.rule_id, 'ruleName', r.name,
      'ruleRevision', j.rule_revision, 'recipientName', j.recipient_name, 'recipientUid', j.recipient_uid, 'contactId', j.contact_id,
      'tagId', j.tag_id, 'sourceRef', j.source_ref, 'status', j.status, 'reasonCode', j.reason_code, 'zaloErrorCode', j.zalo_error_code,
      'errorMessage', j.error_message, 'messageTemplate', j.message_template, 'sendAfter', j.send_after, 'expiresAt', j.expires_at,
      'claimedAt', j.claimed_at, 'claimedBy', j.claimed_by, 'sentAt', j.sent_at, 'zaloMsgId', j.zalo_msg_id,
      'createdAt', j.created_at, 'updatedAt', j.updated_at) INTO v_res
    FROM public.auto_event_bot_jobs j LEFT JOIN public.auto_event_bot_rules r ON r.id = j.rule_id
    WHERE j.account_id = v_acc AND j.id = private.aka_agent_event_bot_int(v_payload->'jobId');
    IF v_res IS NULL THEN PERFORM private.aka_agent_event_bot_fail('job_not_found'); END IF;
    RETURN jsonb_build_object('ok', true, 'data', v_res);

  ELSE -- report
    v_days := LEAST(90, GREATEST(1, COALESCE(private.aka_agent_event_bot_int(v_payload->'days'), 7)));
    WITH j AS MATERIALIZED (
      SELECT x.* FROM public.auto_event_bot_jobs x
      WHERE x.account_id = v_acc AND x.created_at > clock_timestamp() - make_interval(days => v_days)
    )
    SELECT jsonb_build_object(
      'totals', (SELECT jsonb_build_object('matched', count(*), 'sent', count(*) FILTER (WHERE status = 'sent'),
          'skipped', count(*) FILTER (WHERE status = 'skipped'), 'expired', count(*) FILTER (WHERE status = 'expired'),
          'failed', count(*) FILTER (WHERE status = 'failed'), 'unknown', count(*) FILTER (WHERE status = 'unknown')) FROM j),
      'byDay', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d, 'sent', sent, 'skipped', skipped, 'expired', expired, 'failed', failed) ORDER BY d)
          FROM (SELECT to_char(timezone('Asia/Ho_Chi_Minh', created_at)::date, 'YYYY-MM-DD') AS d,
                  count(*) FILTER (WHERE status = 'sent') sent, count(*) FILTER (WHERE status = 'skipped') skipped,
                  count(*) FILTER (WHERE status = 'expired') expired, count(*) FILTER (WHERE status = 'failed') failed
                FROM j GROUP BY 1) q), '[]'::jsonb),
      'byRule', COALESCE((SELECT jsonb_agg(jsonb_build_object('ruleId', q.rule_id, 'name', COALESCE(r.name, ''), 'eventType', q.event_type,
            'matched', q.matched, 'sent', q.sent) ORDER BY q.matched DESC, q.rule_id)
          FROM (SELECT rule_id, event_type, count(*) matched, count(*) FILTER (WHERE status = 'sent') sent FROM j
                WHERE rule_id IS NOT NULL GROUP BY rule_id, event_type) q
          LEFT JOIN public.auto_event_bot_rules r ON r.id = q.rule_id), '[]'::jsonb),
      'byReason', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', reason_code, 'count', n) ORDER BY n DESC, reason_code)
          FROM (SELECT reason_code, count(*) n FROM j WHERE reason_code IS NOT NULL GROUP BY reason_code) q), '[]'::jsonb)
    ) INTO v_res;
    RETURN jsonb_build_object('ok', true, 'data', v_res);
  END IF;
EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
  IF v_msg NOT LIKE 'event_bot:%' THEN
    RAISE;
  END IF;
  v_code := substr(v_msg, 11);
  BEGIN
    v_d := NULLIF(v_detail, '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_d := NULL;
  END;
  RETURN jsonb_build_object('ok', false, 'code', v_code,
      'message', COALESCE(v_d->>'message', private.aka_agent_event_bot_error_message(v_code)))
    || CASE WHEN v_d ? 'index' THEN jsonb_build_object('index', v_d->'index') ELSE '{}'::jsonb END
    || CASE WHEN v_d ? 'field' THEN jsonb_build_object('field', v_d->'field') ELSE '{}'::jsonb END
    || CASE WHEN v_d ? 'ruleId' THEN jsonb_build_object('ruleId', v_d->'ruleId') ELSE '{}'::jsonb END;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  private.aka_agent_event_bot_config(),
  private.aka_agent_event_bot_access(bigint, bigint),
  private.aka_agent_event_bot_runtime_on(jsonb, text),
  private.aka_agent_event_bot_runs_on(bigint),
  private.aka_agent_event_bot_norm_phone(text),
  private.aka_agent_event_bot_excluded(bigint, bigint[], text, text),
  private.aka_agent_event_bot_gap_hit(bigint, text, text, integer),
  private.aka_agent_event_bot_create_ctx(bigint, jsonb),
  private.aka_agent_event_bot_tag_trigger(),
  private.aka_agent_event_bot_group_trigger(),
  private.aka_agent_event_bot_sync_core(text, bigint, bigint[]),
  private.aka_agent_event_bot_runner_account(text, bigint, bigint),
  private.aka_agent_event_bot_birthdays_core(text, bigint, bigint, jsonb),
  private.aka_agent_event_bot_claim_core(text, bigint, text, bigint[], integer),
  private.aka_agent_event_bot_report_core(text, bigint, bigint, uuid, jsonb),
  private.aka_agent_event_bot_desktop_staff(),
  private.aka_agent_event_bot_maintenance(),
  private.aka_agent_event_bot_fail(text, jsonb),
  private.aka_agent_event_bot_error_message(text),
  private.aka_agent_event_bot_int(jsonb),
  private.aka_agent_event_bot_account_json(bigint),
  private.aka_agent_event_bot_exclusions_json(bigint),
  private.aka_agent_event_bot_owned_account(bigint, bigint, jsonb),
  private.aka_agent_event_bot_get(bigint, bigint, bigint),
  private.aka_agent_event_bot_rule_normalize(jsonb, integer, bigint, bigint, bigint),
  private.aka_agent_event_bot_close_pending(bigint, text, bigint[]),
  private.aka_agent_event_bot_tag_watched(bigint),
  private.aka_agent_event_bot_save(bigint, bigint, bigint, jsonb),
  public.aka_agent_event_bot_sync_v1(text, bigint[]),
  public.aka_agent_event_bot_birthdays_v1(text, bigint, jsonb),
  public.aka_agent_event_bot_claim_v1(text, text, bigint[], integer),
  public.aka_agent_event_bot_report_v1(text, bigint, uuid, jsonb),
  public.aka_agent_desktop_event_bot_sync_v1(),
  public.aka_agent_desktop_event_bot_birthdays_v1(bigint, jsonb),
  public.aka_agent_desktop_event_bot_claim_v1(text, bigint[], integer),
  public.aka_agent_desktop_event_bot_report_v1(bigint, uuid, jsonb),
  public.aka_agent_control_event_bot(bigint, bigint, text, jsonb)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_event_bot_sync_v1(text, bigint[]) TO service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_event_bot_birthdays_v1(text, bigint, jsonb) TO service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_event_bot_claim_v1(text, text, bigint[], integer) TO service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_event_bot_report_v1(text, bigint, uuid, jsonb) TO service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_event_bot_sync_v1() TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_event_bot_birthdays_v1(bigint, jsonb) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_event_bot_claim_v1(text, bigint[], integer) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_event_bot_report_v1(bigint, uuid, jsonb) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_event_bot(bigint, bigint, text, jsonb) TO service_role;

-- Job dọn mỗi phút (chỉ khi có pg_cron).
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-event-bot-maintenance') THEN
      PERFORM cron.schedule('aka-agent-event-bot-maintenance', '* * * * *', 'SELECT private.aka_agent_event_bot_maintenance();');
    END IF;
  END IF;
END
$cron$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Hậu kiểm
-- ---------------------------------------------------------------------------------------------------------------------

DO $postflight$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing FROM unnest(ARRAY['public.auto_event_bot_settings', 'public.auto_event_bot_rules',
    'public.auto_event_bot_jobs', 'public.auto_event_bot_exclusions']) t WHERE to_regclass(t) IS NULL;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'v672 postflight: missing tables %', v_missing; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_aka_agent_event_bot_tag_events', 'trg_aka_agent_event_bot_group_origin_insert',
      'trg_aka_agent_event_bot_group_origin_update') AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'v672 postflight: triggers missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('private.aka_agent_zalo_tag_sync_watched(jsonb,text,bigint,bigint[])')
                 AND md5(prosrc) = '4bb3fc3d196074f4a8e6e76fcffa5ac7' AND prosecdef) THEN
    RAISE EXCEPTION 'v672 postflight: aka_agent_zalo_tag_sync_watched not patched';
  END IF;
  IF (SELECT private.aka_agent_event_bot_config()->>'audience') <> 'off' THEN
    RAISE EXCEPTION 'v672 postflight: event_bot audience must start off';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_control_event_bot(bigint,bigint,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_event_bot_claim_v1(text,text,bigint[],integer)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_event_bot_claim_v1(text,text,bigint[],integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.aka_agent_event_bot_maintenance()', 'EXECUTE')
     OR NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_desktop_event_bot_claim_v1(text,bigint[],integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_control_event_bot(bigint,bigint,text,jsonb)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.auto_event_bot_jobs', 'SELECT')
     OR has_table_privilege('service_role', 'public.auto_event_bot_jobs', 'SELECT') THEN
    RAISE EXCEPTION 'v672 postflight: privileges wrong';
  END IF;
END
$postflight$;

COMMIT;
