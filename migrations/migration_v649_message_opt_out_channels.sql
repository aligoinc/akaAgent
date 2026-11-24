-- V649: link từ chối nhận tin cho SMS, email và Facebook (docs/MESSAGE_OPT_OUT_CHANNELS_PLAN.md).
--
-- Anh chốt 24/11/2026: từ chối ở kênh nào chỉ chặn kênh đó; SMS bật ô mà không chèn biến thì tự thêm dòng
-- cuối; Facebook làm cả 3 loại nhắn tin; email có nút "Hủy đăng ký" một chạm.
--
-- Chỉ thêm, không sửa dữ liệu cũ:
--   * auto_zalo_message_opt_outs: cột channel (mặc định 'zalo') + facebook_key, zalo_global_id thành nullable,
--     CHECK theo kênh, khoá duy nhất riêng từng kênh. 42.071 link Zalo đã phát giữ nguyên.
--   * aka_agent_check_zalo_message_opt_out: so theo SĐT chỉ còn khớp dòng kênh Zalo (từ chối SMS không chặn Zalo).
--   * RPC mới cho Desktop: aka_agent_prepare_message_opt_out, aka_agent_check_message_opt_out.
--   * RPC mới cho API Web: aka_agent_inspect_message_opt_out (trả cả kênh).
--   * aka_agent_list_sms_due_input_data (dịch vụ gửi SMS đọc): gắn link / bỏ qua người đã từ chối ngay lúc lấy tin.
--     Cùng tham số, cùng cột trả về. Kênh SMS tắt thì chỉ bỏ biến khỏi nội dung (không gửi nguyên văn).
--   * aka_agent_list_message_opt_out_customers: trả thêm channel, facebookKey.
--   * Mã lỗi engine OPT02 (Facebook) theo đúng chính sách của OPT01.
--   * Công tắc auto_system_settings message_opt_out.channels, mặc định tắt cả ba kênh.
--
-- Thân hàm cũ (đọc production 24/11/2026): migrations/snapshots/message-opt-out-channels-v649/live-functions-20261124.sql.
-- Bản gỡ: migrations/rollback_v649_message_opt_out_channels.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $preflight$
DECLARE
  v_md5 text;
BEGIN
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v649_%') THEN
    RAISE EXCEPTION 'migration_v649 đã có trong sổ migration, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_zalo_message_opt_outs' AND column_name = 'channel') THEN
    RAISE EXCEPTION 'V649: cột channel đã có';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'debba6a72e49cf2ad16b7ac764fc2e06' THEN
    RAISE EXCEPTION 'V649: thân aka_agent_check_zalo_message_opt_out khác bản đã đọc (%)', v_md5;
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '9b7c118534bf14c7ace4a4c60fc68755' THEN
    RAISE EXCEPTION 'V649: thân aka_agent_list_sms_due_input_data khác bản đã đọc (%)', v_md5;
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.aka_agent_list_message_opt_out_customers(bigint,bigint,text,text,text,integer)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '90a3006ec70fec161ec7eb5862c10368' THEN
    RAISE EXCEPTION 'V649: thân aka_agent_list_message_opt_out_customers khác bản đã đọc (%)', v_md5;
  END IF;
  IF pg_catalog.to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') IS NULL
    OR pg_catalog.to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL THEN
    RAISE EXCEPTION 'V649: thiếu hàm phụ thuộc';
  END IF;
  IF pg_catalog.to_regprocedure('public.aka_agent_prepare_message_opt_out(bigint,bigint,bigint,text,text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.aka_agent_check_message_opt_out(bigint,bigint,bigint,text,text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.aka_agent_inspect_message_opt_out(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'V649: RPC mới đã có';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_engine_recipient_opted_out')
    OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_engine_recipient_opted_out'
      AND action_code IS NULL AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V649: thiếu mã / chính sách err_engine_recipient_opted_out để chép';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_engine_recipient_opted_out_facebook' OR public_code = 'OPT02') THEN
    RAISE EXCEPTION 'V649: mã OPT02 đã có';
  END IF;
END
$preflight$;

-- ── Bảng ─────────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.auto_zalo_message_opt_outs
  ADD COLUMN channel text NOT NULL DEFAULT 'zalo',
  ADD COLUMN facebook_key text NULL,
  ALTER COLUMN zalo_global_id DROP NOT NULL;

ALTER TABLE public.auto_zalo_message_opt_outs
  ADD CONSTRAINT auto_message_opt_outs_channel_check CHECK (channel IN ('zalo', 'sms', 'email', 'facebook')),
  ADD CONSTRAINT auto_message_opt_outs_identity_check CHECK (
    (channel = 'zalo' AND zalo_global_id IS NOT NULL)
    OR (channel = 'sms' AND phone IS NOT NULL AND zalo_global_id IS NULL)
    OR (channel = 'email' AND email IS NOT NULL AND zalo_global_id IS NULL)
    OR (channel = 'facebook' AND facebook_key IS NOT NULL AND zalo_global_id IS NULL)
  );

CREATE UNIQUE INDEX auto_message_opt_outs_sms_phone_uidx
  ON public.auto_zalo_message_opt_outs (staff_id, organization_id, phone) WHERE channel = 'sms';
CREATE UNIQUE INDEX auto_message_opt_outs_email_uidx
  ON public.auto_zalo_message_opt_outs (staff_id, organization_id, email) WHERE channel = 'email';
CREATE UNIQUE INDEX auto_message_opt_outs_facebook_uidx
  ON public.auto_zalo_message_opt_outs (staff_id, organization_id, facebook_key) WHERE channel = 'facebook';

COMMENT ON COLUMN public.auto_zalo_message_opt_outs.channel IS
  'Kênh phát link (zalo / sms / email / facebook). Từ chối ở kênh nào chỉ chặn kênh đó (V649).';
COMMENT ON COLUMN public.auto_zalo_message_opt_outs.email IS
  'Email người nhận (chữ thường) của dòng kênh email (V649). Dòng Zalo không dùng.';
COMMENT ON COLUMN public.auto_zalo_message_opt_outs.facebook_key IS
  'Khoá người nhận Facebook: uid:<số> / user:<tên> / page:<id Page>:<id khách> (V649).';

-- ── Công tắc ─────────────────────────────────────────────────────────────────────────────────────────────────────

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'message_opt_out.channels', '{"sms":false,"email":false,"facebook":false}',
  'Link từ chối nhận tin cho SMS / email / Facebook (V649). false hoặc thiếu = tắt kênh đó.', false, true
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'message_opt_out.channels');

-- ── Hàm nội bộ ───────────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.aka_agent_message_opt_out_channel_enabled(p_channel text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_value text;
  v_json jsonb;
BEGIN
  IF p_channel NOT IN ('sms', 'email', 'facebook') THEN RETURN false; END IF;
  SELECT s.value INTO v_value FROM public.auto_system_settings s
  WHERE s.key = 'message_opt_out.channels' AND s.is_active = true
  ORDER BY s.id DESC LIMIT 1;
  IF v_value IS NULL THEN RETURN false; END IF;
  BEGIN
    v_json := v_value::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN COALESCE(jsonb_typeof(v_json) = 'object' AND (v_json -> p_channel) = 'true'::jsonb, false);
END;
$function$;

CREATE FUNCTION private.aka_agent_message_opt_out_channel_of_action(p_action_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog
AS $function$
  SELECT CASE p_action_id
    WHEN 'sms_send' THEN 'sms'
    WHEN 'email_send' THEN 'email'
    WHEN 'facebook_message_uid' THEN 'facebook'
    WHEN 'facebook_message_friend' THEN 'facebook'
    WHEN 'facebook_page_to_message' THEN 'facebook'
  END
$function$;

-- Chuẩn hoá định danh người nhận theo kênh; NULL = không hợp lệ.
CREATE FUNCTION private.aka_agent_message_opt_out_identity(p_channel text, p_identity text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, public
AS $function$
  SELECT CASE p_channel
    WHEN 'sms' THEN NULLIF(public.aka_agent_internal_normalize_phone(p_identity), '')
    WHEN 'email' THEN CASE
      WHEN pg_catalog.length(pg_catalog.btrim(p_identity)) <= 320
        AND pg_catalog.lower(pg_catalog.btrim(p_identity)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      THEN pg_catalog.lower(pg_catalog.btrim(p_identity)) END
    WHEN 'facebook' THEN CASE
      WHEN pg_catalog.length(pg_catalog.btrim(p_identity)) <= 300
        AND pg_catalog.btrim(p_identity) ~ '^(uid|user|page):[^[:space:]]+$'
      THEN pg_catalog.btrim(p_identity) END
  END
$function$;

CREATE FUNCTION private.aka_agent_message_opt_out_token(p_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog
AS $function$
  -- Như encodeStopMessagesId: base64url 16 byte của UUID, bỏ dấu "=".
  SELECT pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(pg_catalog.uuid_send(p_id), 'base64'), '+/', '-_'), '=')
$function$;

-- Đã xác nhận từ chối chưa (đúng kênh, đúng nhân viên + tổ chức).
CREATE FUNCTION private.aka_agent_message_opt_out_confirmed(
  p_staff_id bigint, p_organization_id bigint, p_channel text, p_identity text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
BEGIN
  -- Mỗi kênh một câu riêng để dùng đúng khoá duy nhất (index một phần) của kênh đó.
  IF p_channel = 'sms' THEN
    RETURN EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs o
      WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.channel = 'sms'
        AND o.phone = p_identity AND o.confirmed_at IS NOT NULL);
  ELSIF p_channel = 'email' THEN
    RETURN EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs o
      WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.channel = 'email'
        AND o.email = p_identity AND o.confirmed_at IS NOT NULL);
  ELSIF p_channel = 'facebook' THEN
    RETURN EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs o
      WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.channel = 'facebook'
        AND o.facebook_key = p_identity AND o.confirmed_at IS NOT NULL);
  END IF;
  RETURN false;
END;
$function$;

-- Tạo (hoặc lấy) link của người nhận. Ghi nguồn (chiến dịch, giờ phát link) khi chưa xác nhận.
CREATE FUNCTION private.aka_agent_message_opt_out_issue(
  p_staff_id bigint, p_organization_id bigint, p_channel text, p_identity text,
  p_campaign_id bigint, p_campaign_name text, p_action_name text
)
RETURNS TABLE (id uuid, is_opted_out boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_id uuid;
  v_confirmed timestamptz;
  v_source bigint;
BEGIN
  FOR i IN 1..2 LOOP
    IF p_channel = 'sms' THEN
      SELECT o.id, o.confirmed_at, o.source_campaign_id INTO v_id, v_confirmed, v_source
      FROM public.auto_zalo_message_opt_outs o
      WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.channel = 'sms' AND o.phone = p_identity;
    ELSIF p_channel = 'email' THEN
      SELECT o.id, o.confirmed_at, o.source_campaign_id INTO v_id, v_confirmed, v_source
      FROM public.auto_zalo_message_opt_outs o
      WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.channel = 'email' AND o.email = p_identity;
    ELSIF p_channel = 'facebook' THEN
      SELECT o.id, o.confirmed_at, o.source_campaign_id INTO v_id, v_confirmed, v_source
      FROM public.auto_zalo_message_opt_outs o
      WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.channel = 'facebook' AND o.facebook_key = p_identity;
    ELSE
      RAISE EXCEPTION 'invalid_message_opt_out_channel';
    END IF;
    EXIT WHEN v_id IS NOT NULL;
    INSERT INTO public.auto_zalo_message_opt_outs AS o (
      channel, phone, email, facebook_key, staff_id, organization_id,
      source_campaign_id, source_campaign_name, source_action_name, source_sent_at
    ) VALUES (
      p_channel,
      CASE WHEN p_channel = 'sms' THEN p_identity END,
      CASE WHEN p_channel = 'email' THEN p_identity END,
      CASE WHEN p_channel = 'facebook' THEN p_identity END,
      p_staff_id, p_organization_id,
      p_campaign_id, p_campaign_name, p_action_name, pg_catalog.clock_timestamp()
    )
    ON CONFLICT DO NOTHING
    RETURNING o.id INTO v_id;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, false;
      RETURN;
    END IF;
  END LOOP;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'message_opt_out_issue_failed';
  END IF;
  IF v_confirmed IS NULL AND v_source IS DISTINCT FROM p_campaign_id THEN
    UPDATE public.auto_zalo_message_opt_outs o
    SET source_campaign_id = p_campaign_id, source_campaign_name = p_campaign_name,
        source_action_name = p_action_name, source_sent_at = pg_catalog.clock_timestamp()
    WHERE o.id = v_id AND o.confirmed_at IS NULL;
  END IF;
  RETURN QUERY SELECT v_id, v_confirmed IS NOT NULL;
END;
$function$;

-- Phạm vi của lời gọi từ Desktop: chiến dịch đúng loại của kênh, tài khoản + nhân viên cùng tổ chức.
CREATE FUNCTION private.aka_agent_message_opt_out_scope(
  p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_channel text
)
RETURNS TABLE (organization_id bigint, campaign_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 OR p_channel NOT IN ('sms', 'email', 'facebook') THEN
    RAISE EXCEPTION 'invalid_message_opt_out_scope';
  END IF;
  RETURN QUERY
  SELECT campaign.organization_id, campaign.name::text
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = campaign.organization_id
   AND COALESCE(account.is_delete, false) = false
  JOIN public.org_staff AS staff
    ON staff.id = p_staff_id
   AND staff.organization_id = campaign.organization_id
   AND staff.is_active = true
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND private.aka_agent_message_opt_out_channel_of_action(campaign.action_id) = p_channel
    AND COALESCE(campaign.is_delete, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_opt_out_scope_not_found';
  END IF;
END;
$function$;

-- ── RPC cho Desktop ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.aka_agent_prepare_message_opt_out(
  p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_channel text, p_identity text
)
RETURNS TABLE (id uuid, is_opted_out boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_scope record;
  v_identity text;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.
  SELECT * INTO v_scope FROM private.aka_agent_message_opt_out_scope(p_campaign_id, p_account_id, p_staff_id, p_channel);
  IF NOT private.aka_agent_message_opt_out_channel_enabled(p_channel) THEN
    RAISE EXCEPTION 'message_opt_out_channel_disabled';
  END IF;
  v_identity := private.aka_agent_message_opt_out_identity(p_channel, p_identity);
  IF v_identity IS NULL THEN
    RAISE EXCEPTION 'message_opt_out_identity_invalid';
  END IF;
  RETURN QUERY SELECT issued.id, issued.is_opted_out
  FROM private.aka_agent_message_opt_out_issue(p_staff_id, v_scope.organization_id, p_channel, v_identity,
    p_campaign_id, v_scope.campaign_name,
    CASE p_channel WHEN 'email' THEN 'Gửi email' WHEN 'facebook' THEN 'Nhắn tin Facebook' ELSE 'Gửi tin nhắn SMS' END) AS issued;
END;
$function$;

CREATE FUNCTION public.aka_agent_check_message_opt_out(
  p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_channel text, p_identity text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_scope record;
  v_identity text;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.
  SELECT * INTO v_scope FROM private.aka_agent_message_opt_out_scope(p_campaign_id, p_account_id, p_staff_id, p_channel);
  IF NOT private.aka_agent_message_opt_out_channel_enabled(p_channel) THEN RETURN false; END IF;
  v_identity := private.aka_agent_message_opt_out_identity(p_channel, p_identity);
  IF v_identity IS NULL THEN RETURN false; END IF;
  RETURN private.aka_agent_message_opt_out_confirmed(p_staff_id, v_scope.organization_id, p_channel, v_identity);
END;
$function$;

-- ── RPC cho API Web (trang từ chối) ──────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.aka_agent_inspect_message_opt_out(p_id uuid)
RETURNS TABLE (state text, channel text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
  SELECT COALESCE(
      (SELECT CASE WHEN o.confirmed_at IS NULL THEN 'pending' ELSE 'confirmed' END
       FROM public.auto_zalo_message_opt_outs o WHERE o.id = p_id),
      'invalid')::text,
    COALESCE((SELECT o.channel FROM public.auto_zalo_message_opt_outs o WHERE o.id = p_id), 'zalo')::text
$function$;

-- ── Zalo: so theo SĐT chỉ khớp dòng kênh Zalo ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aka_agent_check_zalo_message_opt_out(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_phone text DEFAULT NULL::text, p_zalo_global_id text DEFAULT NULL::text)
 RETURNS TABLE(is_opted_out boolean, matched_by text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_phone text := NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '');
  v_zalo_global_id text := NULLIF(pg_catalog.btrim(p_zalo_global_id), '');
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_zalo_message_opt_out_scope';
  END IF;

  SELECT campaign.organization_id
  INTO v_organization_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = campaign.organization_id
   AND account.flatform_type = 'zalo'
   AND COALESCE(account.is_delete, false) = false
  JOIN public.org_staff AS staff
    ON staff.id = p_staff_id
   AND staff.organization_id = campaign.organization_id
   AND staff.is_active = true
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_message_friend',
      'zalo_message_birthday',
      'zalo_message_group_member',
      'zalo_message_group_realtime',
      'zalo_message_remarketing_customer',
      'zalo_message_friend_recommendation'
    )
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_message_opt_out_scope_not_found';
  END IF;

  -- V649: từ chối ở kênh nào chỉ chặn kênh đó; dòng SMS cùng SĐT không chặn tin Zalo.
  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_zalo_message_opt_outs AS opt_out
    WHERE opt_out.staff_id = p_staff_id
      AND opt_out.organization_id = v_organization_id
      AND opt_out.phone = v_phone
      AND opt_out.channel = 'zalo'
      AND opt_out.confirmed_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT true, 'phone'::text;
    RETURN;
  END IF;

  IF v_zalo_global_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_zalo_message_opt_outs AS opt_out
    WHERE opt_out.staff_id = p_staff_id
      AND opt_out.organization_id = v_organization_id
      AND opt_out.zalo_global_id = v_zalo_global_id
      AND opt_out.confirmed_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT true, 'zalo_global_id'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text;
END;
$function$;

-- ── SMS: gắn link / bỏ qua người đã từ chối lúc dịch vụ gửi SMS lấy tin ──────────────────────────────────────────

CREATE FUNCTION private.aka_agent_sms_opt_out_render(
  p_input_data_id bigint, p_campaign_id bigint, p_extra jsonb, p_phone text, p_content text, p_enabled boolean
)
RETURNS TABLE (content text, blocked boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  c_token constant text := '#{STOP_MESSAGES_LINK}';
  c_error_url constant text := 'https://b.akabiz.biz/s/error';
  c_note constant text := 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn SMS';
  v_campaign record;
  v_phone text;
  v_link_enabled boolean := COALESCE(p_extra ->> 'zaloOptOutLinkEnabled', '') = 'true';
  v_issued record;
  v_link text;
  v_body text;
BEGIN
  IF p_content IS NULL THEN
    RETURN QUERY SELECT p_content, false;
    RETURN;
  END IF;
  -- Kênh tắt hoặc chiến dịch không bật link: bỏ biến khỏi nội dung, không gửi nguyên văn.
  IF NOT p_enabled THEN
    RETURN QUERY SELECT pg_catalog.replace(p_content, c_token, ''), false;
    RETURN;
  END IF;

  SELECT c.staff_id, c.organization_id, c.name INTO v_campaign
  FROM public.auto_campaigns c WHERE c.id = p_campaign_id;
  v_phone := NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '');

  IF v_campaign.staff_id IS NOT NULL AND v_phone IS NOT NULL
    AND private.aka_agent_message_opt_out_confirmed(v_campaign.staff_id, v_campaign.organization_id, 'sms', v_phone) THEN
    -- Như lượt gửi xong: data đóng ("hoàn thành" kèm ghi chú, không lịch sử, không tính lượt), hết data thì chiến dịch hoàn thành.
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'hoàn thành', note = c_note, date_action = now()
    WHERE input_data.id = p_input_data_id AND input_data.status = 'chờ xử lý';
    IF NOT EXISTS (
      SELECT 1 FROM public.auto_campaign_input_data AS remaining
      WHERE remaining.campaign_id = p_campaign_id AND COALESCE(remaining.is_delete, false) = false
        AND remaining.status IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
    ) THEN
      UPDATE public.auto_campaigns
      SET status = 'hoàn thành', note = NULL, updated_at = now()
      WHERE id = p_campaign_id AND action_id = 'sms_send' AND COALESCE(is_delete, false) = false;
    END IF;
    RETURN QUERY SELECT p_content, true;
    RETURN;
  END IF;

  IF NOT v_link_enabled THEN
    RETURN QUERY SELECT pg_catalog.replace(p_content, c_token, ''), false;
    RETURN;
  END IF;

  BEGIN
    IF v_campaign.staff_id IS NULL OR v_phone IS NULL THEN RAISE EXCEPTION 'message_opt_out_identity_invalid'; END IF;
    SELECT * INTO v_issued FROM private.aka_agent_message_opt_out_issue(v_campaign.staff_id, v_campaign.organization_id,
      'sms', v_phone, p_campaign_id, v_campaign.name::text, 'Gửi tin nhắn SMS');
    v_link := 'https://b.akabiz.biz/s/' || private.aka_agent_message_opt_out_token(v_issued.id);
  EXCEPTION WHEN others THEN
    -- Như Zalo khi tạo link lỗi: vẫn gửi, biến thành trang báo lỗi, không thêm dòng cuối.
    RETURN QUERY SELECT pg_catalog.replace(p_content, c_token, c_error_url), false;
    RETURN;
  END;

  IF pg_catalog.strpos(p_content, c_token) > 0 THEN
    RETURN QUERY SELECT pg_catalog.replace(p_content, c_token, v_link), false;
    RETURN;
  END IF;
  v_body := pg_catalog.rtrim(p_content);
  RETURN QUERY SELECT
    v_body
      || CASE WHEN v_body = '' THEN '' WHEN COALESCE(p_extra ->> 'smsKeepNewLines', '') = 'true' THEN E'\n' ELSE ' ' END
      || CASE WHEN COALESCE(p_extra ->> 'smsUseUnicode', '') = 'true' THEN 'Từ chối nhận tin: ' ELSE 'Tu choi nhan tin: ' END
      || v_link,
    false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_sms_due_input_data(p_account_id bigint, p_campaign_ids bigint[] DEFAULT NULL::bigint[], p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_per_campaign_limit integer DEFAULT 30)
 RETURNS TABLE(input_data_id bigint, campaign_id bigint, campaign_name text, campaign_schedule timestamp with time zone, campaign_extra_settings jsonb, input_schedule timestamp with time zone, effective_schedule timestamp with time zone, input_created_at timestamp with time zone, phone text, phone_carrier text, content text, name text, info1 text, info2 text, info3 text, info4 text, info5 text)
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_enabled boolean := private.aka_agent_message_opt_out_channel_enabled('sms');
BEGIN
  -- V649: câu chọn giữ nguyên bản trước; mỗi dòng đi qua private.aka_agent_sms_opt_out_render
  -- (gắn link từ chối, bỏ qua người đã từ chối SMS). Dòng bị bỏ qua không trả về.
  RETURN QUERY
  WITH normalized AS (
    SELECT
      p_campaign_ids AS campaign_ids,
      NULLIF(btrim(lower(coalesce(p_carrier, ''))), '') AS carrier,
      LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) AS row_limit,
      LEAST(GREATEST(COALESCE(p_per_campaign_limit, 30), 1), 500) AS per_campaign_limit
  ),
  allowed_campaigns AS (
    SELECT
      campaign.id,
      campaign.name,
      campaign.schedule,
      COALESCE(campaign.extra_settings, '{}'::jsonb) AS extra_settings
    FROM public.auto_campaigns AS campaign
    CROSS JOIN normalized
    WHERE campaign.account_id = p_account_id
      AND public.aka_agent_app_access_account_allowed(p_account_id, 'akaAgent')
      AND campaign.action_id = 'sms_send'
      AND campaign.status = 'chờ xử lý'
      AND COALESCE(campaign.is_delete, false) = false
      AND (
        normalized.campaign_ids IS NULL
        OR campaign.id = ANY(normalized.campaign_ids)
      )
  ),
  due AS MATERIALIZED (
    SELECT
      data.id AS input_data_id,
      campaign.id AS campaign_id,
      campaign.name AS campaign_name,
      campaign.schedule AS campaign_schedule,
      campaign.extra_settings AS campaign_extra_settings,
      data.schedule AS input_schedule,
      COALESCE(data.schedule, campaign.schedule) AS effective_schedule,
      data.created_at AS input_created_at,
      data.phone,
      data.phone_carrier,
      data.content,
      data.name,
      data.info1,
      data.info2,
      data.info3,
      data.info4,
      data.info5,
      row_number() OVER (ORDER BY
        COALESCE(data.schedule, campaign.schedule) ASC NULLS FIRST,
        data.created_at ASC NULLS FIRST,
        data.id ASC) AS ordinal
    FROM allowed_campaigns AS campaign
    CROSS JOIN normalized
    CROSS JOIN LATERAL (
      SELECT input_data.*
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = campaign.id
        AND input_data.status = 'chờ xử lý'
        AND COALESCE(input_data.is_delete, false) = false
        AND NULLIF(btrim(coalesce(input_data.phone, '')), '') IS NOT NULL
        AND NULLIF(btrim(coalesce(input_data.content, '')), '') IS NOT NULL
        AND (
          normalized.carrier IS NULL
          OR normalized.carrier = 'all'
          OR lower(coalesce(input_data.phone_carrier, 'unknown')) = normalized.carrier
        )
        AND (
          COALESCE(input_data.schedule, campaign.schedule) IS NULL
          OR COALESCE(input_data.schedule, campaign.schedule) <= now()
        )
      ORDER BY
        COALESCE(input_data.schedule, campaign.schedule) ASC NULLS FIRST,
        input_data.created_at ASC NULLS FIRST,
        input_data.id ASC
      LIMIT (SELECT per_campaign_limit FROM normalized)
    ) AS data
    ORDER BY
      COALESCE(data.schedule, campaign.schedule) ASC NULLS FIRST,
      data.created_at ASC NULLS FIRST,
      data.id ASC
    LIMIT (SELECT row_limit FROM normalized)
  ),
  rendered AS MATERIALIZED (
    SELECT due.*, r.content AS rendered_content, r.blocked
    FROM due
    CROSS JOIN LATERAL private.aka_agent_sms_opt_out_render(
      due.input_data_id, due.campaign_id, due.campaign_extra_settings, due.phone, due.content, v_enabled
    ) AS r
  )
  SELECT
    rendered.input_data_id,
    rendered.campaign_id,
    rendered.campaign_name,
    rendered.campaign_schedule,
    rendered.campaign_extra_settings,
    rendered.input_schedule,
    rendered.effective_schedule,
    rendered.input_created_at,
    rendered.phone,
    rendered.phone_carrier,
    rendered.rendered_content,
    rendered.name,
    rendered.info1,
    rendered.info2,
    rendered.info3,
    rendered.info4,
    rendered.info5
  FROM rendered
  WHERE NOT rendered.blocked
  ORDER BY rendered.ordinal;
END;
$function$;

-- ── Danh sách khách từ chối: thêm kênh ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aka_agent_list_message_opt_out_customers(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_search text := left(btrim(COALESCE(p_search, '')), 200);
  v_pattern text;
  v_page integer := greatest(1, least(COALESCE(p_page, 1), 1000000));
  v_total bigint;
  v_items jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id
    AND is_active = true AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Không có quyền truy cập danh sách.';
  END IF;
  v_pattern := '%' || replace(replace(replace(v_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  SELECT count(*) INTO v_total FROM public.auto_zalo_message_opt_outs o
  WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.confirmed_at IS NOT NULL
    AND (v_search = '' OR o.zalo_name ILIKE v_pattern OR o.phone ILIKE v_pattern OR o.email ILIKE v_pattern
      OR o.zalo_global_id ILIKE v_pattern OR o.facebook_key ILIKE v_pattern OR o.source_campaign_name ILIKE v_pattern);
  v_page := least(v_page, greatest(1, ceil(v_total::numeric / 50)::integer));
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.confirmed_at DESC, x.id DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT o.id, o.confirmed_at, jsonb_build_object(
      'id', o.id, 'phone', o.phone, 'email', o.email, 'zaloGlobalId', o.zalo_global_id,
      'zaloName', o.zalo_name, 'zaloAvatar', o.zalo_avatar, 'confirmedAt', o.confirmed_at,
      'sourceCampaignId', o.source_campaign_id, 'sourceCampaignName', o.source_campaign_name,
      'sourceDetailId', o.source_detail_id, 'sourceSentAt', o.source_sent_at,
      'sourceActionName', o.source_action_name, 'sourceStatus', o.source_status,
      'channel', o.channel, 'facebookKey', o.facebook_key
    ) AS item
    FROM public.auto_zalo_message_opt_outs o
    WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.confirmed_at IS NOT NULL
      AND (v_search = '' OR o.zalo_name ILIKE v_pattern OR o.phone ILIKE v_pattern OR o.email ILIKE v_pattern
        OR o.zalo_global_id ILIKE v_pattern OR o.facebook_key ILIKE v_pattern OR o.source_campaign_name ILIKE v_pattern)
    ORDER BY o.confirmed_at DESC, o.id DESC LIMIT 50 OFFSET (v_page - 1) * 50
  ) x;
  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', 50);
END;
$function$;

-- ── Mã lỗi engine Facebook OPT02: chép mã + chính sách của OPT01 ──────────────────────────────────────────────────

DO $codes$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auto_error'
    AND column_name NOT IN ('id', 'created_at', 'updated_at', 'error_code', 'public_code', 'error_desc', 'customer_title');
  EXECUTE format(
    'INSERT INTO public.auto_error (error_code, public_code, error_desc, customer_title, %1$s)
     SELECT %2$L, %3$L, %4$L, %5$L, %1$s FROM public.auto_error WHERE error_code = %6$L',
    v_cols, 'err_engine_recipient_opted_out_facebook', 'OPT02',
    'Engine v2: người nhận đã bấm từ chối nhận tin nhắn Facebook (V649); data tạm dừng, không gửi.',
    'Bỏ qua vì người nhận đã từ chối nhận tin nhắn Facebook', 'err_engine_recipient_opted_out');

  SELECT string_agg(pg_catalog.quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auto_outcome_policies'
    AND column_name NOT IN ('id', 'created_at', 'updated_at', 'error_code', 'source', 'description');
  EXECUTE format(
    'INSERT INTO public.auto_outcome_policies (error_code, source, description, %1$s)
     SELECT %2$L, %3$L, %4$L, %1$s FROM public.auto_outcome_policies
     WHERE error_code = %5$L AND action_code IS NULL AND is_active AND NOT is_delete',
    v_cols, 'err_engine_recipient_opted_out_facebook', 'v649',
    'Từ chối nhận tin Facebook: như OPT01 (data tạm dừng, không ghi lịch sử, không tính lượt).',
    'err_engine_recipient_opted_out');
END
$codes$;

-- ── Quyền ────────────────────────────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION private.aka_agent_message_opt_out_channel_enabled(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.aka_agent_message_opt_out_channel_of_action(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.aka_agent_message_opt_out_identity(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.aka_agent_message_opt_out_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.aka_agent_message_opt_out_confirmed(bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.aka_agent_message_opt_out_issue(bigint, bigint, text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.aka_agent_message_opt_out_scope(bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.aka_agent_sms_opt_out_render(bigint, bigint, jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;
-- Hàm danh sách SMS chạy với quyền người gọi (dịch vụ gửi SMS = service_role): người gọi cần gọi được hai hàm này.
GRANT EXECUTE ON FUNCTION private.aka_agent_message_opt_out_channel_enabled(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.aka_agent_sms_opt_out_render(bigint, bigint, jsonb, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.aka_agent_prepare_message_opt_out(bigint, bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_check_message_opt_out(bigint, bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_inspect_message_opt_out(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_prepare_message_opt_out(bigint, bigint, bigint, text, text) TO service_role, aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_check_message_opt_out(bigint, bigint, bigint, text, text) TO service_role, aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_inspect_message_opt_out(uuid) TO service_role;

-- ── Hậu kiểm ─────────────────────────────────────────────────────────────────────────────────────────────────────

DO $postflight$
BEGIN
  IF (SELECT count(*) FROM public.auto_zalo_message_opt_outs WHERE channel <> 'zalo') <> 0 THEN
    RAISE EXCEPTION 'V649: có dòng không phải Zalo sau migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_engine_recipient_opted_out_facebook' AND public_code = 'OPT02')
    OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_engine_recipient_opted_out_facebook' AND is_active) THEN
    RAISE EXCEPTION 'V649: thiếu mã / chính sách OPT02';
  END IF;
  IF private.aka_agent_message_opt_out_channel_enabled('sms') OR private.aka_agent_message_opt_out_channel_enabled('email')
    OR private.aka_agent_message_opt_out_channel_enabled('facebook') THEN
    RAISE EXCEPTION 'V649: công tắc phải tắt sau migration';
  END IF;
  IF private.aka_agent_message_opt_out_token('550e8400-e29b-41d4-a716-446655440000') <> 'VQ6EAOKbQdSnFkRmVUQAAA' THEN
    RAISE EXCEPTION 'V649: mã hoá link khác encodeStopMessagesId';
  END IF;
END
$postflight$;

COMMIT;
