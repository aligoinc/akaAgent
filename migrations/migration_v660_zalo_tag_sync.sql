-- V660: sổ tag Zalo + tự thêm người được gắn tag vào chiến dịch "Nhắn tin bạn bè" theo tag.
-- Phương án: docs/ZALO_TAG_AUTO_SEND_PLAN.md (anh chốt 26/11/2026). Chỉ thêm đối tượng mới, không sửa hàm cũ.
--
-- Cách chạy:
--   * Chương trình giữ kết nối Zalo (Fly, App Server, Desktop QR) đọc danh sách tài khoản cần hỏi tag
--     (aka_agent_zalo_tag_sync_accounts / aka_agent_desktop_zalo_tag_sync_accounts), mỗi `poll_seconds` gọi getLabels
--     rồi gửi một lô `{a, v}` (tài khoản, phiên bản tag). DB trả `needTags` cho tài khoản có phiên bản đổi; chương trình
--     gửi lại tài khoản đó kèm cả danh sách tag (`tags`).
--   * DB so với lần trước, ghi người mới gắn / mới gỡ vào sổ, rồi đưa người mới gắn vào các chiến dịch đang tự thêm.
--   * Lần đầu, hoặc lần báo trước cách hơn `stale_minutes`: chỉ lấy mốc, không đưa ai vào chiến dịch (anh chốt: mất kết
--     nối thì bỏ).
--   * Chiến dịch đang tự thêm nằm ở bảng nhỏ auto_zalo_tag_sync_campaigns do trigger trên auto_campaigns giữ đồng bộ, để
--     không phải đọc extra_settings của cả bảng chiến dịch mỗi phút.
-- Công tắc chung: auto_system_settings `zalo.tag_sync.enabled` (V660 đặt false). Tắt thì các hàm nhận lô trả
-- enabled=false, không ghi gì.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v660\_%') THEN
    RAISE EXCEPTION 'v660 already recorded in the migration ledger';
  END IF;
  IF to_regclass('public.auto_zalo_tag_sync_accounts') IS NOT NULL
     OR to_regclass('public.auto_zalo_tag_members') IS NOT NULL
     OR to_regclass('public.auto_zalo_tag_member_events') IS NOT NULL
     OR to_regclass('public.auto_zalo_tag_sync_campaigns') IS NOT NULL
     OR to_regclass('public.auto_campaign_zalo_tag_adds') IS NOT NULL
     OR to_regclass('public.auto_zalo_tag_sync_resets') IS NOT NULL THEN
    RAISE EXCEPTION 'v660 tables already exist';
  END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'v660 needs private.aka_agent_desktop_data_context()';
  END IF;
  IF EXISTS (SELECT 1 FROM auto_system_settings WHERE key LIKE 'zalo.tag_sync.%') THEN
    RAISE EXCEPTION 'v660 settings already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN ('err_engine_zalo_tag_not_friend', 'err_engine_zalo_tag_friend_unavailable')
             OR public_code IN ('EXC04', 'EXC05')) THEN
    RAISE EXCEPTION 'v660 error code EXC04 / EXC05 already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE code = 'campaign_detail_skipped') THEN
    RAISE EXCEPTION 'v660 needs auto_status campaign_detail_skipped';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Bảng
-- ---------------------------------------------------------------------------------------------------------------------

-- Mỗi tài khoản đang được hỏi tag một dòng.
CREATE TABLE public.auto_zalo_tag_sync_accounts (
  account_id bigint PRIMARY KEY,
  organization_id bigint NOT NULL,
  source text NOT NULL CHECK (source IN ('fly', 'server', 'desktop')),
  tag_version text,
  baseline_at timestamptz,
  last_seen_at timestamptz,
  last_snapshot_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ai đang nằm trong tag nào (mã hội thoại như Zalo trả: nhóm có tiền tố "g").
CREATE TABLE public.auto_zalo_tag_members (
  account_id bigint NOT NULL,
  tag_id text NOT NULL,
  member_uid text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, tag_id, member_uid)
);

-- Nhật ký gắn / gỡ (giữ `event_retention_days` ngày).
CREATE TABLE public.auto_zalo_tag_member_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  tag_id text NOT NULL,
  tag_name text,
  member_uid text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('add', 'remove')),
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_zalo_tag_member_events_account ON public.auto_zalo_tag_member_events (account_id, detected_at);
CREATE INDEX idx_auto_zalo_tag_member_events_detected ON public.auto_zalo_tag_member_events (detected_at);

-- Chiến dịch đang tự thêm (trigger trên auto_campaigns giữ đồng bộ). Có dòng = nhắn tin bạn bè, chế độ theo tag, bật ô,
-- chưa xoá. Hạn kết thúc và dấu "đã lấy danh sách lần đầu" kiểm lúc thêm.
CREATE TABLE public.auto_zalo_tag_sync_campaigns (
  campaign_id bigint PRIMARY KEY,
  account_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  tag_ids text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_zalo_tag_sync_campaigns_account ON public.auto_zalo_tag_sync_campaigns (account_id);

-- Người nào đã được đưa vào chiến dịch nào: mỗi người một lần mỗi chiến dịch (gỡ rồi gắn lại không thêm lần hai).
CREATE TABLE public.auto_campaign_zalo_tag_adds (
  campaign_id bigint NOT NULL,
  member_uid text NOT NULL,
  account_id bigint NOT NULL,
  tag_id text NOT NULL,
  input_data_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, member_uid)
);

-- Dấu đặt lại mốc của tài khoản (trigger ghi khi tài khoản hết / có lại chiến dịch đang tự thêm).
CREATE TABLE public.auto_zalo_tag_sync_resets (
  account_id bigint PRIMARY KEY,
  reset_at timestamptz NOT NULL
);

ALTER TABLE public.auto_zalo_tag_sync_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_zalo_tag_sync_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_zalo_tag_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_zalo_tag_member_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_zalo_tag_sync_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_zalo_tag_adds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_zalo_tag_sync_resets, public.auto_zalo_tag_sync_accounts, public.auto_zalo_tag_members, public.auto_zalo_tag_member_events,
  public.auto_zalo_tag_sync_campaigns, public.auto_campaign_zalo_tag_adds FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Cấu hình
-- ---------------------------------------------------------------------------------------------------------------------

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('zalo.tag_sync.enabled', 'false', 'Sổ tag Zalo + tự thêm người được gắn tag vào chiến dịch: công tắc tổng true/false', false, true),
  ('zalo.tag_sync.organization_ids', 'all', 'Sổ tag Zalo: tổ chức áp dụng, "all" hoặc danh sách id cách nhau dấu phẩy', false, true),
  ('zalo.tag_sync.poll_seconds', '60', 'Sổ tag Zalo: nhịp hỏi danh sách tag (giây, 30-600)', false, true),
  ('zalo.tag_sync.stale_minutes', '30', 'Sổ tag Zalo: lần báo trước cách hơn N phút thì chỉ lấy mốc, không thêm ai (5-1440)', false, true),
  ('zalo.tag_sync.event_retention_days', '30', 'Sổ tag Zalo: số ngày giữ nhật ký gắn / gỡ (1-365)', false, true);

CREATE FUNCTION private.aka_agent_zalo_tag_sync_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH s AS (
    SELECT key, btrim(value) AS value FROM public.auto_system_settings
    WHERE key LIKE 'zalo.tag_sync.%' AND is_active
  )
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT lower(value) = 'true' FROM s WHERE key = 'zalo.tag_sync.enabled'), false),
    'organizationIds', COALESCE((SELECT value FROM s WHERE key = 'zalo.tag_sync.organization_ids'), 'all'),
    'pollSeconds', LEAST(600, GREATEST(30, COALESCE((SELECT CASE WHEN value ~ '^[0-9]{1,6}$' THEN value::int END FROM s WHERE key = 'zalo.tag_sync.poll_seconds'), 60))),
    'staleMinutes', LEAST(1440, GREATEST(5, COALESCE((SELECT CASE WHEN value ~ '^[0-9]{1,6}$' THEN value::int END FROM s WHERE key = 'zalo.tag_sync.stale_minutes'), 30))),
    'retentionDays', LEAST(365, GREATEST(1, COALESCE((SELECT CASE WHEN value ~ '^[0-9]{1,6}$' THEN value::int END FROM s WHERE key = 'zalo.tag_sync.event_retention_days'), 30)))
  );
$function$;

CREATE FUNCTION private.aka_agent_zalo_tag_sync_org_covered(p_config jsonb, p_organization_id bigint)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT COALESCE((p_config->>'enabled')::boolean, false) AND p_organization_id IS NOT NULL AND (
    lower(COALESCE(p_config->>'organizationIds', 'all')) = 'all'
    OR p_organization_id::text = ANY (
      SELECT btrim(x) FROM unnest(string_to_array(COALESCE(p_config->>'organizationIds', ''), ',')) AS x
    )
  );
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Bảng chiến dịch đang tự thêm: trigger trên auto_campaigns
-- ---------------------------------------------------------------------------------------------------------------------

-- Một chiến dịch có đang tự thêm không, và với những tag nào (mã tag dạng chữ, bỏ trùng, bỏ rỗng).
CREATE FUNCTION private.aka_agent_zalo_tag_sync_campaign_tags(p_action_id text, p_is_delete boolean, p_extra jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_action_id IS DISTINCT FROM 'zalo_message_friend' OR COALESCE(p_is_delete, false) THEN NULL
    WHEN COALESCE(p_extra->>'zaloFriendTargetMode', '') <> 'tagged_friends' THEN NULL
    -- Chỉ giá trị JSON true (giao diện Desktop / Web / iOS cũng chỉ nhận true: chữ "true" thì ô hiện tắt, không có công tắc Dừng).
    WHEN (p_extra->'zaloFriendTagAutoAddEnabled') IS DISTINCT FROM 'true'::jsonb THEN NULL
    WHEN jsonb_typeof(p_extra->'zaloFriendSourceTagIds') <> 'array' THEN NULL
    ELSE NULLIF(ARRAY(
      SELECT DISTINCT btrim(t.value #>> '{}')
      FROM jsonb_array_elements(p_extra->'zaloFriendSourceTagIds') AS t(value)
      WHERE jsonb_typeof(t.value) IN ('string', 'number') AND btrim(t.value #>> '{}') <> ''
      ORDER BY 1
    ), '{}'::text[])
  END;
$function$;

CREATE FUNCTION private.aka_agent_zalo_tag_sync_campaign_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tags text[];
  v_accounts bigint[];
  v_before bigint[];
  v_after bigint[];
BEGIN
  -- Xoá hẳn dòng chiến dịch, hoặc đổi loại khỏi "Nhắn tin bạn bè": bỏ khỏi bảng (trigger riêng cho từng trường hợp).
  IF TG_OP = 'DELETE' THEN
    v_tags := NULL;
    v_accounts := ARRAY(SELECT x FROM unnest(ARRAY[OLD.account_id]::bigint[]) AS x WHERE x IS NOT NULL);
  ELSE
    v_tags := private.aka_agent_zalo_tag_sync_campaign_tags(NEW.action_id, NEW.is_delete, NEW.extra_settings);
    v_accounts := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[NEW.account_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.account_id END]::bigint[]) AS x WHERE x IS NOT NULL);
  END IF;
  -- Tài khoản nào đang có chiến dịch tự thêm, trước và sau thay đổi.
  v_before := ARRAY(SELECT DISTINCT sc.account_id FROM public.auto_zalo_tag_sync_campaigns sc WHERE sc.account_id = ANY (v_accounts));

  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.auto_zalo_tag_sync_campaigns WHERE campaign_id = OLD.id;
  ELSIF v_tags IS NULL OR NEW.account_id IS NULL OR NEW.staff_id IS NULL OR NEW.organization_id IS NULL THEN
    DELETE FROM public.auto_zalo_tag_sync_campaigns WHERE campaign_id = NEW.id;
  ELSE
    INSERT INTO public.auto_zalo_tag_sync_campaigns (campaign_id, account_id, staff_id, organization_id, tag_ids, updated_at)
    VALUES (NEW.id, NEW.account_id, NEW.staff_id, NEW.organization_id, v_tags, clock_timestamp())
    ON CONFLICT (campaign_id) DO UPDATE SET
      account_id = EXCLUDED.account_id, staff_id = EXCLUDED.staff_id, organization_id = EXCLUDED.organization_id,
      tag_ids = EXCLUDED.tag_ids, updated_at = EXCLUDED.updated_at
    WHERE (auto_zalo_tag_sync_campaigns.account_id, auto_zalo_tag_sync_campaigns.staff_id,
           auto_zalo_tag_sync_campaigns.organization_id, auto_zalo_tag_sync_campaigns.tag_ids)
      IS DISTINCT FROM (EXCLUDED.account_id, EXCLUDED.staff_id, EXCLUDED.organization_id, EXCLUDED.tag_ids);
  END IF;

  v_after := ARRAY(SELECT DISTINCT sc.account_id FROM public.auto_zalo_tag_sync_campaigns sc WHERE sc.account_id = ANY (v_accounts));

  -- Tài khoản vừa hết, hoặc vừa có lại chiến dịch tự thêm: ghi dấu đặt lại mốc. Lần đọc tag kế tiếp chỉ lấy mốc, nên người
  -- được gắn tag trong lúc dừng không được thêm bù (anh chốt 26/11). Không chạm bảng mốc ở đây để không khoá chéo với hàm
  -- nhận lô (hàm đó giữ dòng mốc rồi mới khoá dòng chiến dịch).
  INSERT INTO public.auto_zalo_tag_sync_resets (account_id, reset_at)
  SELECT acc, clock_timestamp() FROM unnest(v_accounts) AS acc
  WHERE (acc = ANY (v_before)) IS DISTINCT FROM (acc = ANY (v_after))
  ON CONFLICT (account_id) DO UPDATE SET reset_at = EXCLUDED.reset_at;
  RETURN NULL;
END;
$function$;

-- Chỉ chiến dịch nhắn tin bạn bè (WHEN rẻ: không đọc extra_settings với loại khác). Ba trigger vì WHEN của INSERT không được
-- nhắc OLD, của DELETE không được nhắc NEW: thêm mới; sửa (cả đổi loại khỏi nhắn tin bạn bè); xoá hẳn dòng.
CREATE TRIGGER trg_aka_agent_zalo_tag_sync_campaign
AFTER INSERT ON public.auto_campaigns
FOR EACH ROW
WHEN (NEW.action_id = 'zalo_message_friend')
EXECUTE FUNCTION private.aka_agent_zalo_tag_sync_campaign_trigger();
CREATE TRIGGER trg_aka_agent_zalo_tag_sync_campaign_update
AFTER UPDATE OF extra_settings, is_delete, account_id, staff_id, organization_id, action_id ON public.auto_campaigns
FOR EACH ROW
WHEN (NEW.action_id = 'zalo_message_friend' OR OLD.action_id = 'zalo_message_friend')
EXECUTE FUNCTION private.aka_agent_zalo_tag_sync_campaign_trigger();
CREATE TRIGGER trg_aka_agent_zalo_tag_sync_campaign_delete
AFTER DELETE ON public.auto_campaigns
FOR EACH ROW
WHEN (OLD.action_id = 'zalo_message_friend')
EXECUTE FUNCTION private.aka_agent_zalo_tag_sync_campaign_trigger();

-- Nạp sẵn chiến dịch cũ (bản này ra đời thì chưa chiến dịch nào bật ô, nên thường 0 dòng).
INSERT INTO public.auto_zalo_tag_sync_campaigns (campaign_id, account_id, staff_id, organization_id, tag_ids)
SELECT c.id, c.account_id, c.staff_id, c.organization_id, t.tags
FROM public.auto_campaigns c
CROSS JOIN LATERAL (SELECT private.aka_agent_zalo_tag_sync_campaign_tags(c.action_id, c.is_delete, c.extra_settings) AS tags) t
WHERE c.action_id = 'zalo_message_friend' AND COALESCE(c.is_delete, false) = false
  AND t.tags IS NOT NULL AND c.account_id IS NOT NULL AND c.staff_id IS NOT NULL AND c.organization_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- Danh sách tài khoản cần hỏi tag
-- ---------------------------------------------------------------------------------------------------------------------

-- Tài khoản Zalo (không phải Zalo trình duyệt, chưa xoá) có ít nhất một chiến dịch đang tự thêm, trong tổ chức đang bật.
CREATE FUNCTION private.aka_agent_zalo_tag_sync_watched(p_config jsonb, p_source text, p_staff_id bigint, p_account_ids bigint[])
RETURNS TABLE (account_id bigint, organization_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT DISTINCT a.id::bigint, a.organization_id::bigint
  FROM public.auto_zalo_tag_sync_campaigns sc
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

-- App Server (service_role, source 'server') và Chat API trên Fly (source 'fly'). p_account_ids NULL: mọi tài khoản.
CREATE FUNCTION public.aka_agent_zalo_tag_sync_accounts(p_source text, p_account_ids bigint[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_config jsonb := private.aka_agent_zalo_tag_sync_config();
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('server', 'fly') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'zalo_tag_sync_invalid_source';
  END IF;
  IF session_user = 'aka_agent_chat_api' AND p_source <> 'fly' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'zalo_tag_sync_source_not_allowed';
  END IF;
  RETURN jsonb_build_object(
    'enabled', COALESCE((v_config->>'enabled')::boolean, false),
    'pollSeconds', (v_config->>'pollSeconds')::int,
    'accountIds', CASE WHEN COALESCE((v_config->>'enabled')::boolean, false) THEN COALESCE((
      SELECT jsonb_agg(w.account_id ORDER BY w.account_id)
      FROM private.aka_agent_zalo_tag_sync_watched(v_config, p_source, NULL, p_account_ids) w
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$function$;

-- Desktop: tài khoản Zalo QR của nhân viên đang đăng nhập.
CREATE FUNCTION public.aka_agent_desktop_zalo_tag_sync_accounts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET statement_timeout TO '5s'
AS $function$
DECLARE
  v_config jsonb := private.aka_agent_zalo_tag_sync_config();
  v_staff bigint;
BEGIN
  SELECT ctx.staff_id INTO v_staff FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1;
  IF v_staff IS NULL OR v_staff <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'zalo_tag_sync_desktop_identity_required';
  END IF;
  RETURN jsonb_build_object(
    'enabled', COALESCE((v_config->>'enabled')::boolean, false),
    'pollSeconds', (v_config->>'pollSeconds')::int,
    'accountIds', CASE WHEN COALESCE((v_config->>'enabled')::boolean, false) THEN COALESCE((
      SELECT jsonb_agg(w.account_id ORDER BY w.account_id)
      FROM private.aka_agent_zalo_tag_sync_watched(v_config, 'desktop', v_staff, NULL) w
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Đưa người mới gắn tag vào chiến dịch
-- ---------------------------------------------------------------------------------------------------------------------

-- p_added: [{t: mã tag, n: tên tag, u: mã người}]. Trả số dòng data đã thêm.
CREATE FUNCTION private.aka_agent_zalo_tag_auto_add(p_account_id bigint, p_added jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_vn_today date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_stamp text := to_char(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY');
  v_account_name text;
  v_account_staff bigint;
  v_account_org bigint;
  r record;
  c public.auto_campaigns%ROWTYPE;
  v_rows jsonb;
  v_count integer;
  v_total integer := 0;
  v_line text;
BEGIN
  IF p_added IS NULL OR jsonb_typeof(p_added) <> 'array' OR jsonb_array_length(p_added) = 0 THEN RETURN 0; END IF;
  SELECT NULLIF(btrim(a.name), ''), a.staff_id, a.organization_id INTO v_account_name, v_account_staff, v_account_org
  FROM public.auto_accounts a WHERE a.id = p_account_id;

  -- Chỉ chiến dịch của đúng nhân viên / tổ chức đang sở hữu tài khoản (tag là dữ liệu của tài khoản đó).
  FOR r IN
    SELECT sc.campaign_id, sc.tag_ids FROM public.auto_zalo_tag_sync_campaigns sc
    WHERE sc.account_id = p_account_id AND sc.staff_id = v_account_staff AND sc.organization_id = v_account_org
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_added) x WHERE x->>'t' = ANY (sc.tag_ids))
    ORDER BY sc.campaign_id
  LOOP
  -- Mỗi chiến dịch một khối riêng: lỗi cố định của một chiến dịch (trigger quyền chặn mở lại chiến dịch của nhân viên hết gói…)
  -- chỉ bỏ qua chiến dịch đó; không thì cả lượt báo lỗi mãi, sổ tag của tài khoản đứng yên và mọi chiến dịch khác không nhận ai.
  -- Lỗi tạm thời (chờ khoá, khoá chéo, bị huỷ) vẫn dừng cả lượt: chưa ghi gì, lượt sau so lại và thêm đủ.
  BEGIN
    v_count := 0;
    -- Thứ tự khoá như luồng nạp data và engine: khoá nạp data của chiến dịch, rồi dòng chiến dịch.
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || r.campaign_id::text, 0));
    SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id FOR UPDATE;
    IF c.id IS NULL OR COALESCE(c.is_delete, false) OR c.account_id IS DISTINCT FROM p_account_id
       OR c.staff_id IS DISTINCT FROM v_account_staff OR c.organization_id IS DISTINCT FROM v_account_org
       OR private.aka_agent_zalo_tag_sync_campaign_tags(c.action_id, c.is_delete, c.extra_settings) IS NULL
       -- Chưa lấy danh sách lần đầu: lượt đầu sẽ đọc tag và thấy người này (thêm trước thì lượt đầu bị bỏ qua).
       OR NULLIF(btrim(COALESCE(c.extra_settings->>'zaloFriendDataMaterializedAt', '')), '') IS NULL
       OR (c.schedule_end_date IS NOT NULL AND (c.schedule_end_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < v_vn_today)
       OR c.status NOT IN ('chờ xử lý', 'đang chạy', 'hoàn thành', 'tạm dừng') THEN
      CONTINUE;
    END IF;

    WITH cand AS (
      SELECT DISTINCT ON (x->>'u') x->>'u' AS uid, x->>'t' AS tag_id, NULLIF(btrim(x->>'n'), '') AS tag_name
      FROM jsonb_array_elements(p_added) x
      WHERE x->>'t' = ANY (r.tag_ids) AND COALESCE(x->>'u', '') ~ '^[0-9]{1,40}$'
      ORDER BY x->>'u', x->>'t'
    ), fresh AS (
      SELECT cand.* FROM cand
      WHERE NOT EXISTS (SELECT 1 FROM public.auto_campaign_zalo_tag_adds ad WHERE ad.campaign_id = r.campaign_id AND ad.member_uid = cand.uid)
        AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                        WHERE d.campaign_id = r.campaign_id AND d.uid = cand.uid AND COALESCE(d.is_delete, false) = false)
    ), ins AS (
      INSERT INTO public.auto_campaign_input_data (campaign_id, input_id, name, uid, status, note, control_append_idempotency_key, control_append_row_index)
      SELECT r.campaign_id, NULL,
             COALESCE((SELECT COALESCE(NULLIF(btrim(z.display_name), ''), NULLIF(btrim(z.zalo_name), ''))
                       FROM public.zalo_users z WHERE z.account_id = p_account_id AND z.zalo_uid = f.uid LIMIT 1), f.uid),
             f.uid, 'chờ xử lý', '', 'zalotag:' || r.campaign_id::text || ':' || f.uid, 0
      FROM fresh f
      ON CONFLICT DO NOTHING
      RETURNING id, uid, name
    ), marks AS (
      INSERT INTO public.auto_campaign_zalo_tag_adds (campaign_id, member_uid, account_id, tag_id, input_data_id)
      SELECT r.campaign_id, i.uid, p_account_id, f.tag_id, i.id FROM ins i JOIN fresh f ON f.uid = i.uid
      ON CONFLICT DO NOTHING
      RETURNING member_uid
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', i.name, 'tag', COALESCE(f.tag_name, f.tag_id)) ORDER BY i.id), '[]'::jsonb)
    INTO v_rows
    FROM ins i JOIN fresh f ON f.uid = i.uid;

    v_count := jsonb_array_length(v_rows);
    IF v_count = 0 THEN CONTINUE; END IF;
    v_total := v_total + v_count;

    -- Như reopenCompletedCampaignAfterInputInsert của app: chỉ chiến dịch "hoàn thành" được mở lại; tạm dừng giữ nguyên.
    IF c.status = 'hoàn thành' THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = clock_timestamp()
      WHERE id = c.id AND status = 'hoàn thành';
    END IF;

    -- Dòng tiến trình (như formatStoredCampaignLogLine: giờ VN - tài khoản - chiến dịch - nội dung). Tối đa 20 dòng mỗi lần.
    PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:' || c.id::text, 0));
    FOR v_line IN
      SELECT format('🏷️ Đã thêm "%s" vào chiến dịch vì vừa được gắn tag "%s"', e->>'name', e->>'tag')
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, n) WHERE n <= 20 ORDER BY n
    LOOP
      INSERT INTO public.auto_campaign_logs (campaign_id, log)
      VALUES (c.id, concat_ws(' - ', v_stamp, v_account_name, NULLIF(btrim(c.name), ''), v_line));
    END LOOP;
    IF v_count > 20 THEN
      INSERT INTO public.auto_campaign_logs (campaign_id, log)
      VALUES (c.id, concat_ws(' - ', v_stamp, v_account_name, NULLIF(btrim(c.name), ''),
        format('🏷️ Đã thêm %s người vừa được gắn tag vào chiến dịch', v_count)));
    END IF;
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected OR serialization_failure OR query_canceled THEN RAISE;
    WHEN OTHERS THEN
      v_total := v_total - COALESCE(v_count, 0);
      RAISE WARNING 'zalo_tag_auto_add_campaign_skipped campaign=% sqlstate=% %', r.campaign_id, SQLSTATE, SQLERRM;
  END;
  END LOOP;
  RETURN v_total;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Nhận lô từ chương trình giữ kết nối Zalo
-- ---------------------------------------------------------------------------------------------------------------------

-- p_items: [{a: mã tài khoản, v: phiên bản tag, tags?: [{id, name, m: [mã hội thoại]}], p?, c?}], tối đa 200 tài khoản, chỉ một
-- tài khoản được kèm `tags` mỗi lần gọi. Fly gửi thêm `p` (phiên bản đã báo trước đó) và `c` (runtime đọc liền mạch từ đó). Trả {enabled, pollSeconds, staleMinutes, needTags[], rejected[], baselined[],
-- added (số người mới gắn), removed, campaignRows (số dòng data đã thêm)}.
CREATE FUNCTION private.aka_agent_zalo_tag_sync_core(p_source text, p_staff_id bigint, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_config jsonb := private.aka_agent_zalo_tag_sync_config();
  v_now timestamptz := clock_timestamp();
  v_stale interval;
  v_item jsonb;
  v_account bigint;
  v_version text;
  v_has_tags boolean;
  v_org bigint;
  st public.auto_zalo_tag_sync_accounts%ROWTYPE;
  v_need jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_baselined jsonb := '[]'::jsonb;
  v_added_total integer := 0;
  v_removed_total integer := 0;
  v_rows_total integer := 0;
  v_with_tags integer := 0;
  v_added jsonb;
  v_removed integer;
BEGIN
  IF NOT COALESCE((v_config->>'enabled')::boolean, false) THEN
    RETURN jsonb_build_object('enabled', false, 'pollSeconds', (v_config->>'pollSeconds')::int);
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'zalo_tag_sync_items_invalid';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'zalo_tag_sync_too_many_items';
  END IF;
  SELECT count(*) INTO v_with_tags FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x->'tags') = 'array';
  IF v_with_tags > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'zalo_tag_sync_one_snapshot_per_call';
  END IF;
  v_stale := make_interval(mins => (v_config->>'staleMinutes')::int);

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
    IF COALESCE(v_item->>'a', '') !~ '^[0-9]{1,15}$' THEN CONTINUE; END IF;
    v_account := (v_item->>'a')::bigint;
    v_version := left(COALESCE(v_item->>'v', ''), 64);
    v_has_tags := COALESCE(jsonb_typeof(v_item->'tags') = 'array', false);

    SELECT w.organization_id INTO v_org
    FROM private.aka_agent_zalo_tag_sync_watched(v_config, p_source, p_staff_id, ARRAY[v_account]) w;
    IF v_org IS NULL THEN
      v_rejected := v_rejected || to_jsonb(v_account::text);
      CONTINUE;
    END IF;

    INSERT INTO public.auto_zalo_tag_sync_accounts (account_id, organization_id, source)
    VALUES (v_account, v_org, p_source) ON CONFLICT (account_id) DO NOTHING;
    SELECT * INTO st FROM public.auto_zalo_tag_sync_accounts WHERE account_id = v_account FOR UPDATE;

    -- Dấu đặt lại mới hơn mốc: coi như chưa có mốc.
    IF st.baseline_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.auto_zalo_tag_sync_resets r WHERE r.account_id = v_account AND r.reset_at > st.baseline_at
    ) THEN
      st.baseline_at := NULL;
    END IF;

    IF NOT v_has_tags THEN
      IF st.baseline_at IS NOT NULL AND st.tag_version IS NOT DISTINCT FROM v_version AND v_version <> '' THEN
        UPDATE public.auto_zalo_tag_sync_accounts
        SET last_seen_at = v_now, source = p_source, organization_id = v_org, updated_at = v_now
        WHERE account_id = v_account;
      ELSE
        -- Phiên bản đổi hoặc chưa có mốc: xin cả danh sách. Không ghi last_seen_at, để khoảng hở được tính đúng.
        v_need := v_need || to_jsonb(v_account::text);
      END IF;
      CONTINUE;
    END IF;

    -- Có danh sách tag: dựng tập (tag, người) mới.
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.v660_snapshot (tag_id text, tag_name text, member_uid text) ON COMMIT DROP;
    TRUNCATE pg_temp.v660_snapshot;
    INSERT INTO pg_temp.v660_snapshot (tag_id, tag_name, member_uid)
    SELECT DISTINCT ON (btrim(t->>'id'), btrim(m #>> '{}')) btrim(t->>'id'), NULLIF(btrim(t->>'name'), ''), btrim(m #>> '{}')
    FROM jsonb_array_elements(v_item->'tags') t
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t->'m') = 'array' THEN t->'m' ELSE '[]'::jsonb END) m
    WHERE COALESCE(btrim(t->>'id'), '') ~ '^[0-9A-Za-z_-]{1,40}$'
      AND COALESCE(btrim(m #>> '{}'), '') ~ '^g?[0-9]{1,40}$';

    -- Fly chỉ báo khi tag đổi, không có nhịp mỗi phút: runtime tự tính cờ liền mạch `c` và phiên bản đã báo trước đó `p`.
    -- Desktop / App Server: lần báo trước cách quá `stale_minutes` thì chỉ lấy mốc.
    IF st.baseline_at IS NULL
       OR (p_source = 'fly' AND NOT (COALESCE(v_item->>'c', '') = 'true'
                                     AND st.tag_version IS NOT DISTINCT FROM left(v_item->>'p', 64)))
       OR (p_source <> 'fly' AND (st.last_seen_at IS NULL OR st.last_seen_at < v_now - v_stale)) THEN
      -- Lần đầu, hoặc mất kết nối quá lâu: chỉ lấy mốc.
      DELETE FROM public.auto_zalo_tag_members WHERE account_id = v_account;
      INSERT INTO public.auto_zalo_tag_members (account_id, tag_id, member_uid, first_seen_at)
      SELECT v_account, s.tag_id, s.member_uid, v_now FROM pg_temp.v660_snapshot s;
      UPDATE public.auto_zalo_tag_sync_accounts
      SET tag_version = v_version, baseline_at = v_now, last_seen_at = v_now, last_snapshot_at = v_now,
          source = p_source, organization_id = v_org, updated_at = v_now
      WHERE account_id = v_account;
      v_baselined := v_baselined || to_jsonb(v_account::text);
      CONTINUE;
    END IF;

    WITH gone AS (
      DELETE FROM public.auto_zalo_tag_members m
      WHERE m.account_id = v_account
        AND NOT EXISTS (SELECT 1 FROM pg_temp.v660_snapshot s WHERE s.tag_id = m.tag_id AND s.member_uid = m.member_uid)
      RETURNING m.tag_id, m.member_uid
    ), logged AS (
      INSERT INTO public.auto_zalo_tag_member_events (account_id, organization_id, tag_id, member_uid, kind, detected_at)
      SELECT v_account, v_org, g.tag_id, g.member_uid, 'remove', v_now FROM gone g
      RETURNING 1
    )
    SELECT count(*) INTO v_removed FROM logged;

    WITH fresh AS (
      INSERT INTO public.auto_zalo_tag_members (account_id, tag_id, member_uid, first_seen_at)
      SELECT v_account, s.tag_id, s.member_uid, v_now FROM pg_temp.v660_snapshot s
      ON CONFLICT DO NOTHING
      RETURNING tag_id, member_uid
    ), logged AS (
      INSERT INTO public.auto_zalo_tag_member_events (account_id, organization_id, tag_id, tag_name, member_uid, kind, detected_at)
      SELECT v_account, v_org, f.tag_id, (SELECT s.tag_name FROM pg_temp.v660_snapshot s WHERE s.tag_id = f.tag_id LIMIT 1),
             f.member_uid, 'add', v_now
      FROM fresh f
      RETURNING tag_id, tag_name, member_uid
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('t', l.tag_id, 'n', l.tag_name, 'u', l.member_uid)), '[]'::jsonb)
    INTO v_added FROM logged l;

    UPDATE public.auto_zalo_tag_sync_accounts
    SET tag_version = v_version, last_seen_at = v_now, last_snapshot_at = v_now,
        source = p_source, organization_id = v_org, updated_at = v_now
    WHERE account_id = v_account;

    v_added_total := v_added_total + jsonb_array_length(v_added);
    v_removed_total := v_removed_total + v_removed;
    v_rows_total := v_rows_total + private.aka_agent_zalo_tag_auto_add(v_account, v_added);
  END LOOP;

  RETURN jsonb_build_object(
    'enabled', true,
    'pollSeconds', (v_config->>'pollSeconds')::int,
    'staleMinutes', (v_config->>'staleMinutes')::int,
    'needTags', v_need,
    'rejected', v_rejected,
    'baselined', v_baselined,
    'added', v_added_total,
    'removed', v_removed_total,
    'campaignRows', v_rows_total
  );
END;
$function$;

-- App Server (service_role, 'server') và Chat API trên Fly (aka_agent_chat_api, chỉ 'fly').
CREATE FUNCTION public.aka_agent_sync_zalo_tags(p_source text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '5s'
SET statement_timeout TO '20s'
AS $function$
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('server', 'fly') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'zalo_tag_sync_invalid_source';
  END IF;
  IF session_user = 'aka_agent_chat_api' AND p_source <> 'fly' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'zalo_tag_sync_source_not_allowed';
  END IF;
  RETURN private.aka_agent_zalo_tag_sync_core(p_source, NULL, p_items);
END;
$function$;

-- Desktop: chỉ tài khoản Zalo QR của nhân viên đang đăng nhập.
CREATE FUNCTION public.aka_agent_desktop_sync_zalo_tags(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '5s'
SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_staff bigint;
BEGIN
  SELECT ctx.staff_id INTO v_staff FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1;
  IF v_staff IS NULL OR v_staff <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'zalo_tag_sync_desktop_identity_required';
  END IF;
  RETURN private.aka_agent_zalo_tag_sync_core('desktop', v_staff, p_items);
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Công tắc Dừng / Tiếp tục tự thêm (mục 4.6)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION private.aka_agent_set_campaign_zalo_tag_auto_add_core(
  p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c public.auto_campaigns%ROWTYPE;
  v_current boolean;
  v_account_name text;
BEGIN
  IF p_enabled IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'zalo_tag_auto_add_invalid_request';
  END IF;
  SELECT * INTO c FROM public.auto_campaigns
  WHERE id = p_campaign_id AND staff_id = p_staff_id AND organization_id = p_organization_id
    AND COALESCE(is_delete, false) = false
  FOR NO KEY UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'campaign_not_found'); END IF;
  IF c.action_id <> 'zalo_message_friend' OR COALESCE(c.extra_settings->>'zaloFriendTargetMode', '') <> 'tagged_friends' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'campaign_not_tagged_friends');
  END IF;
  v_current := (c.extra_settings->'zaloFriendTagAutoAddEnabled') IS NOT DISTINCT FROM 'true'::jsonb;
  IF v_current = p_enabled THEN
    RETURN jsonb_build_object('ok', true, 'enabled', p_enabled, 'changed', false);
  END IF;
  -- Chỉ đổi đúng một khoá; không đi qua đường lưu cả form.
  UPDATE public.auto_campaigns
  SET extra_settings = jsonb_set(COALESCE(extra_settings, '{}'::jsonb), '{zaloFriendTagAutoAddEnabled}', to_jsonb(p_enabled), true),
      updated_at = clock_timestamp()
  WHERE id = c.id;

  SELECT NULLIF(btrim(a.name), '') INTO v_account_name FROM public.auto_accounts a WHERE a.id = c.account_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:' || c.id::text, 0));
  INSERT INTO public.auto_campaign_logs (campaign_id, log)
  VALUES (c.id, concat_ws(' - ', to_char(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY'),
    v_account_name, NULLIF(btrim(c.name), ''),
    CASE WHEN p_enabled THEN '🏷️ Đã tiếp tục tự thêm người được gắn tag' ELSE '⏸ Đã dừng tự thêm người được gắn tag' END));
  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled, 'changed', true);
END;
$function$;

CREATE FUNCTION public.aka_agent_desktop_set_campaign_zalo_tag_auto_add(p_campaign_id bigint, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '5s'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_staff bigint;
  v_org bigint;
BEGIN
  SELECT ctx.staff_id, ctx.organization_id INTO v_staff, v_org FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1;
  IF v_staff IS NULL OR v_staff <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'zalo_tag_sync_desktop_identity_required';
  END IF;
  RETURN private.aka_agent_set_campaign_zalo_tag_auto_add_core(v_staff, v_org, p_campaign_id, p_enabled);
END;
$function$;

-- API Web (service_role): nhân viên và tổ chức do API xác thực theo phiên điều khiển.
CREATE FUNCTION public.aka_agent_control_set_campaign_zalo_tag_auto_add(
  p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET lock_timeout TO '5s'
SET statement_timeout TO '10s'
AS $function$
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'zalo_tag_auto_add_invalid_request';
  END IF;
  RETURN private.aka_agent_set_campaign_zalo_tag_auto_add_core(p_staff_id, p_organization_id, p_campaign_id, p_enabled);
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Dọn nhật ký
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION private.aka_agent_zalo_tag_sync_retention()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_days integer := (private.aka_agent_zalo_tag_sync_config()->>'retentionDays')::int;
  v_deleted integer;
BEGIN
  DELETE FROM public.auto_zalo_tag_member_events
  WHERE id IN (SELECT id FROM public.auto_zalo_tag_member_events
               WHERE detected_at < clock_timestamp() - make_interval(days => v_days)
               ORDER BY detected_at LIMIT 50000);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Mã kết quả EXC04: người vừa được gắn tag mà chưa là bạn bè (engine v2; bộ chạy cũ ghi cùng trạng thái "Bỏ qua")
-- ---------------------------------------------------------------------------------------------------------------------

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help, detail_status)
VALUES ('engine v2', 'err_engine_zalo_tag_not_friend', 'Người được gắn tag chưa là bạn bè',
  'V660: chiến dịch nhắn tin bạn bè tự thêm người vừa được gắn tag; người đó chưa là bạn bè nên không gửi (anh chốt 26/11/2026).',
  NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'EXC04', 'target_permanent',
  'Chưa là bạn bè nên không gửi', NULL, 'bỏ qua');

-- Như EXC03 (danh sách không gửi tin) nhưng ghi dòng lịch sử "Bỏ qua" (status 51).
INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode,
  detail_status_id, sub_status_id, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect,
  requeue_after_minutes, remaining_steps, lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds,
  campaign_effect, campaign_hold_minutes, account_effect, login_effect, description, source)
SELECT 'err_engine_zalo_tag_not_friend', NULL, NULL, NULL, NULL, NULL, 'write',
  (SELECT id FROM public.auto_status WHERE code = 'campaign_detail_skipped'), NULL,
  'Chưa là bạn bè nên không gửi', NULL, 'no_count', 'ignore', NULL, 'complete',
  NULL, 'skip', '{}', NULL, NULL, NULL, NULL, 'continue', 'none', NULL,
  'none', NULL, 'none', 'none', '[V660] Người vừa được gắn tag chưa là bạn bè: Bỏ qua, không tính lượt, không cộng chuỗi, không nghỉ.', 'v660';

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note)
VALUES ('system', NULL, NULL, 'engine', 'zalo_tag_not_friend', 50, 'err_engine_zalo_tag_not_friend', 'v660',
  '[V660] Người vừa được gắn tag chưa là bạn bè.');

-- EXC05: Zalo không trả lời rõ người vừa được gắn tag có là bạn bè không. Hẹn data chạy lại sau 30 phút, lượt chạy tiếp data
-- khác (không dùng gate_unavailable vì luật đó kết thúc lượt: một người Zalo luôn lỗi sẽ chặn cả chiến dịch; bộ kiểm 26/11).
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help, detail_status)
VALUES ('engine v2', 'err_engine_zalo_tag_friend_unavailable', 'Chưa kiểm tra được trạng thái bạn bè của người được gắn tag',
  'V660: không đọc được trạng thái bạn bè của người vừa được gắn tag; hẹn chạy lại, không chặn các data khác.',
  NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'EXC05', 'target_temporary',
  'Chưa kiểm tra được trạng thái bạn bè, sẽ thử lại sau', NULL, NULL);

INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode,
  detail_status_id, sub_status_id, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect,
  requeue_after_minutes, remaining_steps, lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds,
  campaign_effect, campaign_hold_minutes, account_effect, login_effect, description, source)
VALUES ('err_engine_zalo_tag_friend_unavailable', NULL, NULL, NULL, NULL, NULL, 'suppress',
  NULL, NULL, NULL, NULL, 'no_count', 'ignore', NULL, 'requeue_after',
  30, 'skip', '{}', NULL, NULL, NULL, NULL, 'continue', 'none', NULL,
  'none', NULL, 'none', 'none', '[V660] Không đọc được trạng thái bạn bè: hẹn data chạy lại sau 30 phút, chạy tiếp data khác.', 'v660');

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note)
VALUES ('system', NULL, NULL, 'engine', 'zalo_tag_friend_unavailable', 50, 'err_engine_zalo_tag_friend_unavailable', 'v660',
  '[V660] Không đọc được trạng thái bạn bè của người vừa được gắn tag.');

-- ---------------------------------------------------------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  private.aka_agent_zalo_tag_sync_config(),
  private.aka_agent_zalo_tag_sync_org_covered(jsonb, bigint),
  private.aka_agent_zalo_tag_sync_campaign_tags(text, boolean, jsonb),
  private.aka_agent_zalo_tag_sync_campaign_trigger(),
  private.aka_agent_zalo_tag_sync_watched(jsonb, text, bigint, bigint[]),
  private.aka_agent_zalo_tag_auto_add(bigint, jsonb),
  private.aka_agent_zalo_tag_sync_core(text, bigint, jsonb),
  private.aka_agent_set_campaign_zalo_tag_auto_add_core(bigint, bigint, bigint, boolean),
  private.aka_agent_zalo_tag_sync_retention(),
  public.aka_agent_zalo_tag_sync_accounts(text, bigint[]),
  public.aka_agent_desktop_zalo_tag_sync_accounts(),
  public.aka_agent_sync_zalo_tags(text, jsonb),
  public.aka_agent_desktop_sync_zalo_tags(jsonb),
  public.aka_agent_desktop_set_campaign_zalo_tag_auto_add(bigint, boolean),
  public.aka_agent_control_set_campaign_zalo_tag_auto_add(bigint, bigint, bigint, boolean)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_zalo_tag_sync_accounts(text, bigint[]) TO service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_sync_zalo_tags(text, jsonb) TO service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_zalo_tag_sync_accounts() TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_sync_zalo_tags(jsonb) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_set_campaign_zalo_tag_auto_add(bigint, boolean) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_set_campaign_zalo_tag_auto_add(bigint, bigint, bigint, boolean) TO service_role;

-- Job dọn nhật ký: 03:17 VN hằng ngày (chỉ khi có pg_cron).
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-zalo-tag-sync-retention') THEN
      PERFORM cron.schedule('aka-agent-zalo-tag-sync-retention', '17 20 * * *',
        'SELECT private.aka_agent_zalo_tag_sync_retention();');
    END IF;
  END IF;
END
$cron$;

COMMIT;
