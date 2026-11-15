-- V545: bộ đếm "Đã gửi hôm nay" cho trang Chiến dịch của WebApp (docs/TODAY_SENT_COUNTER_V545.md).
--
-- Đếm tin nhắn gửi thành công theo tài khoản và ngày (giờ Việt Nam) ngay lúc kết quả được ghi, để trang Chiến dịch đọc
-- tổng hôm nay bằng vài lượt dò chỉ mục thay vì đếm trên auto_campaign_details (khoảng 14,5 triệu dòng; đếm trực tiếp một
-- ngày của nhân viên nhiều tài khoản mất khoảng 5,2 giây, đo 15/11/2026).
--
-- Thiết kế (đã chốt với người dùng 15/11/2026):
-- * Bảng private.auto_account_sent_events chỉ THÊM dòng (một dòng cho mỗi kết quả gửi thành công). Trigger không khoá dòng
--   chung nào, không có ON CONFLICT, không có khối EXCEPTION (không mở giao dịch con), nên không thể chặn hay làm chậm
--   lượt ghi kết quả của bộ chạy vì tranh khoá. Bảng không có khoá ngoại, ràng buộc duy nhất chỉ là khoá chính tự tăng.
-- * Hai trigger theo dòng trên public.auto_campaign_details, điều kiện nằm ở WHEN (PostgreSQL xét WHEN mà không gọi hàm):
--   - AFTER INSERT: kết quả mới có trạng thái thành công.
--   - AFTER UPDATE OF status: kết quả đổi từ trạng thái không thành công sang thành công (đổi giữa hai trạng thái thành
--     công, ví dụ "thành công" -> "đã nhận", không đếm lần nữa). INSERT ... ON CONFLICT DO UPDATE đi theo đường này.
--   Trạng thái thành công là danh sách của chỉ mục idx_campaign_details_delivery_cooldown. Chỉ đếm hành động gửi tin
--   (Zalo bạn bè/người lạ/nhóm, SMS, email, Facebook nhắn tin): "Tìm SĐT", "Đổi tên", "Gắn tag", kết bạn, đăng bài không
--   phải "đã gửi".
-- * Công tắc auto_system_settings key 'campaigns.today_sent', mặc định {"enabled":false}. Khi tắt, trigger đọc công tắc
--   rồi thoát (không ghi), hàm đọc trả {"enabled":false} và Web không hiện ô. Bật: xem tài liệu.
-- * Job pg_cron 'aka-agent-today-sent-cleanup' mỗi đêm 03:41 VN xoá dòng cũ hơn hai ngày (DELETE, không TRUNCATE để không
--   lấy khoá ACCESS EXCLUSIVE).
-- * public.aka_agent_control_today_sent(staff, organization, platforms) chỉ đọc, chỉ service_role; phạm vi tài khoản giống
--   hệt aka_agent_control_campaign_page (cùng điều kiện nền tảng), timeout 5 giây.
--
-- Số đo trên bản dựng cục bộ (PostgreSQL 16, đủ cột và 17 chỉ mục): thêm khoảng 25–35 µs cho mỗi dòng gửi tin thành công,
-- gần như 0 cho dòng khác; chi tiết ở docs/TODAY_SENT_COUNTER_V545.md.
--
-- Không sửa hàm hay trigger nào đang có, không đổi chỉ mục của auto_campaign_details, không đổi pool/kết nối/timeout chung.
-- Hai lệnh CREATE TRIGGER là hai lệnh cuối của giao dịch (khoá SHARE ROW EXCLUSIVE trên auto_campaign_details giữ ngắn
-- nhất), và lock_timeout 2 giây để lệnh không xếp hàng chặn các lượt ghi kết quả; quá hạn thì giao dịch huỷ, chạy lại sau.
-- Rollback: migrations/rollback_v545_today_sent_counter.sql
BEGIN;
SET LOCAL lock_timeout = '2s';

DO $preflight$
BEGIN
  IF to_regclass('public.auto_campaign_details') IS NULL OR to_regclass('public.auto_accounts') IS NULL
     OR to_regclass('public.auto_system_settings') IS NULL THEN
    RAISE EXCEPTION 'v545_base_tables_missing';
  END IF;
  IF to_regnamespace('private') IS NULL OR to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'v545_schema_missing';
  END IF;
  IF to_regclass('private.auto_account_sent_events') IS NOT NULL
     OR to_regprocedure('private.auto_today_sent_capture()') IS NOT NULL
     OR to_regprocedure('public.aka_agent_control_today_sent(bigint,bigint,text[])') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_campaign_details'::regclass
                AND tgname IN ('trg_aka_agent_today_sent_insert', 'trg_aka_agent_today_sent_update'))
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-today-sent-cleanup') THEN
    RAISE EXCEPTION 'v545_already_applied_or_partial_do_not_reapply';
  END IF;
  -- Hàm đọc chạy với quyền của service_role (SECURITY INVOKER, như aka_agent_control_campaign_page).
  IF NOT has_table_privilege('service_role', 'public.auto_accounts', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.auto_system_settings', 'SELECT')
     OR NOT has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'v545_service_role_privileges_unexpected';
  END IF;
  -- Cột mà trigger và hàm đọc dùng phải có đúng kiểu.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_details'
      AND (column_name, data_type) IN (('account_id', 'bigint'), ('status', 'text'), ('action_code', 'text'),
        ('is_delete', 'boolean'), ('created_at', 'timestamp with time zone'))) <> 5 THEN
    RAISE EXCEPTION 'v545_campaign_details_columns_unexpected';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_accounts'
      AND (column_name, data_type) IN (('id', 'bigint'), ('staff_id', 'bigint'), ('organization_id', 'bigint'),
        ('flatform_type', 'text'), ('is_zalo_server', 'boolean'), ('is_zalo_show_web', 'boolean'))) <> 6 THEN
    RAISE EXCEPTION 'v545_accounts_columns_unexpected';
  END IF;
END
$preflight$;

CREATE TABLE private.auto_account_sent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL,
  day date NOT NULL
);
CREATE INDEX auto_account_sent_events_account_day ON private.auto_account_sent_events (account_id, day);
ALTER TABLE private.auto_account_sent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_account_sent_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE private.auto_account_sent_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE private.auto_account_sent_events TO service_role;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('campaigns.today_sent', '{"enabled":false}',
  'Ô "Đã gửi hôm nay" ở trang Chiến dịch (V545). {"enabled":true,"countingSince":"<giờ bật, ISO>"} để đếm và hiện; false để tắt cả ghi lẫn đọc.',
  false, true)
ON CONFLICT (key) DO NOTHING;

-- Trigger: không khối EXCEPTION, không ON CONFLICT, không khoá dòng chung. Kết quả nhập từ hệ thống cũ (created_at cũ
-- hơn hôm qua) không được đếm để bảng không phình.
CREATE FUNCTION private.auto_today_sent_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_enabled text;
  v_today date;
  v_day date;
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Công tắc đọc thẳng (không qua hàm phụ: hàm SQL có SET không gộp vào câu được, tốn thêm khoảng 15 µs mỗi dòng).
  -- Chỉ nhận chuỗi JSON object; giá trị hỏng, thiếu dòng hay is_active khác true coi như tắt, không ném lỗi.
  SELECT CASE WHEN s.value IS JSON OBJECT THEN s.value::jsonb ->> 'enabled' END INTO v_enabled
  FROM public.auto_system_settings s
  WHERE s.key = 'campaigns.today_sent' AND s.is_active IS TRUE;
  IF v_enabled IS DISTINCT FROM 'true' THEN
    RETURN NULL;
  END IF;
  v_today := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_day := CASE WHEN TG_OP = 'INSERT' AND NEW.created_at IS NOT NULL
    THEN (NEW.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ELSE v_today END;
  IF v_day < v_today - 1 OR v_day > v_today THEN
    RETURN NULL;
  END IF;
  INSERT INTO private.auto_account_sent_events (account_id, day) VALUES (NEW.account_id, v_day);
  RETURN NULL;
END;
$function$;

-- Hàm đọc cho trang Chiến dịch: phạm vi tài khoản giống aka_agent_control_campaign_page (tài khoản của nhân viên trong
-- tổ chức, cùng điều kiện nền tảng theo token của phiên).
CREATE FUNCTION public.aka_agent_control_today_sent(p_staff_id bigint, p_organization_id bigint, p_platforms text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_setting jsonb;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_day_start timestamptz := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_since timestamptz;
  v_count bigint;
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_platforms IS NULL THEN
    RAISE EXCEPTION 'Missing campaign scope';
  END IF;
  SELECT CASE WHEN s.value IS JSON OBJECT THEN s.value::jsonb END INTO v_setting
  FROM public.auto_system_settings s
  WHERE s.key = 'campaigns.today_sent' AND s.is_active IS TRUE;
  IF v_setting IS NULL OR (v_setting ->> 'enabled') IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  SELECT count(*) INTO v_count
  FROM public.auto_accounts a
  JOIN private.auto_account_sent_events e ON e.account_id = a.id AND e.day = v_today
  WHERE a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    AND (a.flatform_type = ANY(p_platforms) OR (a.flatform_type = 'zalo' AND p_platforms && ARRAY['zalo_qr','zalo_web']::text[]))
    AND (a.flatform_type = 'sms' OR (a.flatform_type = 'facebook' AND 'facebook' = ANY(p_platforms)) OR (a.flatform_type = 'zalo' AND (('zalo' = ANY(p_platforms) AND a.is_zalo_show_web = false AND a.is_zalo_server = true) OR ('zalo_qr' = ANY(p_platforms) AND a.is_zalo_show_web IS NOT TRUE AND a.is_zalo_server IS NOT TRUE) OR ('zalo_web' = ANY(p_platforms) AND a.is_zalo_show_web IS TRUE AND a.is_zalo_server IS NOT TRUE))));
  -- Giờ bắt đầu đếm (ghi khi bật công tắc): chỉ trả khi rơi vào hôm nay, để Web ghi "tính từ HH:MM".
  IF jsonb_typeof(v_setting -> 'countingSince') = 'string'
     AND (v_setting ->> 'countingSince') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$' THEN
    BEGIN
      v_since := (v_setting ->> 'countingSince')::timestamptz;
    EXCEPTION WHEN others THEN
      v_since := NULL;
    END;
  END IF;
  RETURN jsonb_build_object(
    'enabled', true,
    'day', to_char(v_today, 'YYYY-MM-DD'),
    'todaySent', v_count,
    'countingSince', CASE WHEN v_since > v_day_start AND v_since <= now() THEN v_since END
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.auto_today_sent_capture() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_control_today_sent(bigint, bigint, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_today_sent(bigint, bigint, text[]) TO service_role;

SELECT cron.schedule('aka-agent-today-sent-cleanup', '41 20 * * *',
  $cron$DELETE FROM private.auto_account_sent_events WHERE day < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 2$cron$);

-- Hai lệnh cuối: khoá SHARE ROW EXCLUSIVE trên auto_campaign_details chỉ giữ tới COMMIT ngay sau đó.
CREATE TRIGGER trg_aka_agent_today_sent_insert
AFTER INSERT ON public.auto_campaign_details
FOR EACH ROW
WHEN (NEW.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
  AND NEW.action_code IN ('zalo_message_friend', 'zalo_message_stranger', 'zalo_message_group', 'sms_send', 'email_send',
    'fb_message_friend', 'fb_message_stranger', 'fb_message_page_inbox_customer')
  AND NEW.is_delete IS NOT TRUE)
EXECUTE FUNCTION private.auto_today_sent_capture();

CREATE TRIGGER trg_aka_agent_today_sent_update
AFTER UPDATE OF status ON public.auto_campaign_details
FOR EACH ROW
WHEN (NEW.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
  AND (OLD.status IS NULL OR OLD.status NOT IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click'))
  AND NEW.action_code IN ('zalo_message_friend', 'zalo_message_stranger', 'zalo_message_group', 'sms_send', 'email_send',
    'fb_message_friend', 'fb_message_stranger', 'fb_message_page_inbox_customer')
  AND NEW.is_delete IS NOT TRUE)
EXECUTE FUNCTION private.auto_today_sent_capture();

COMMIT;
