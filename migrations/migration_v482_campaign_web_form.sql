-- V482 (09/11/2026): auto_campaigns.web_campaign_form — form Web đã tạo chiến dịch, để Web sửa chiến dịch bằng đúng form đó.
-- Hợp đồng: akaAgentWebApp docs/CAMPAIGN_FORM_V2.md. Giá trị (một cột, phân loại cả form thủ công và form Agent):
--   'form_1' | 'form_2' = form "Thêm chiến dịch" / "Thêm chiến dịch 2"; 'agent_1' | 'agent_2' = "Thêm bằng Agent" / "Thêm bằng Agent 2".
--   NULL = chiến dịch tạo trước V482 hoặc không tạo từ form Web (Desktop, iOS, Quy trình, nhập SQL...).
-- Ghi một lần lúc tạo: lớp bọc public.create_control_campaign_v2 (chỉ service_role; API Web/iOS gọi) đọc p_campaign->>'webCampaignForm'
--   và ghi cột cho chiến dịch vừa tạo trong cùng giao dịch; hàm tạo chính public.create_control_campaign KHÔNG đổi.
--   Nhánh 'chờ xử lý' chỉ cập nhật cột này (không nêu status) nên không chạy trigger UPDATE OF status; trigger nhật ký cấu hình
--   trg_auto_table_log so phép chiếu cấu hình không gồm cột này nên không ghi thêm dòng; aka_agent_campaign_config_version không đổi.
--   Lần gọi lặp cùng Idempotency-Key (created=false) không ghi lại. Sửa chiến dịch không đổi cột.
-- Web: Sửa / Nhân bản / sửa lịch từ Chẩn đoán mở đúng phiên bản form đã ghi, không có nút chuyển form; tắt khóa (chỉ dữ liệu) bằng
--   khóa web.campaign_form (V481) {"followCampaignForm": false}.
-- ADD COLUMN nullable không DEFAULT chỉ đổi metadata; CHECK thêm NOT VALID (không quét bảng ~64 MB/51 nghìn dòng dưới khóa
--   ACCESS EXCLUSIVE; mọi dòng hiện có NULL, dòng ghi mới vẫn bị kiểm) như auto_campaigns_content_rotation_indexes_object.
--   lock_timeout 3 giây (bảng nóng của fleet). DDL làm PostgREST nạp lại schema ⇒ apply ngoài giờ cao điểm.
-- Quyền: aka_agent_desktop SELECT cấp bảng, aka_agent_chat_api SELECT/UPDATE cấp bảng ⇒ select * vẫn chạy; Desktop ghi theo cột
--   nên không ghi được cột này (không cần). CREATE OR REPLACE giữ owner/quyền/comment của hàm.
-- Không phụ thuộc V481. Web/API bản mới chạy được cả khi DB chưa có V482 (đọc lại không có cột, nhớ 5 phút; RPC cũ bỏ qua khóa lạ).
-- Rollback: migrations/rollback_v482_campaign_web_form.sql. Kiểm thử cục bộ: bash scripts/test-v482-campaign-web-form.sh
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v482_preflight$
DECLARE
  v_fn regprocedure := to_regprocedure('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)');
BEGIN
  IF to_regclass('public.auto_campaigns') IS NULL OR v_fn IS NULL
     OR to_regprocedure('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v482: thiếu public.auto_campaigns hoặc create_control_campaign/_v2';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'public.auto_campaigns'::regclass AND attname = 'web_campaign_form' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v482: đã apply (auto_campaigns.web_campaign_form đã có), không chạy lại';
  END IF;
  -- Thân hàm đang chạy phải đúng bản đã đọc trên production 09/11/2026; khác thì dựng lại migration từ bản live (không ghi đè bản vá khác).
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM 'b92f89114e063687609a3a08c89d9d55' THEN
    RAISE EXCEPTION 'v482: thân create_control_campaign_v2 khác bản đọc 09/11/2026';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef AND provolatile = 'v'
                   AND pg_get_userbyid(proowner) = 'postgres'
                   AND proconfig = ARRAY['search_path=public', 'statement_timeout=60s']
                   AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'v482: owner/SECURITY DEFINER/cấu hình/quyền của create_control_campaign_v2 khác bản đọc';
  END IF;
END
$v482_preflight$;

ALTER TABLE public.auto_campaigns ADD COLUMN web_campaign_form text;
ALTER TABLE public.auto_campaigns ADD CONSTRAINT auto_campaigns_web_campaign_form_check
  CHECK (web_campaign_form IS NULL OR web_campaign_form = ANY (ARRAY['form_1', 'form_2', 'agent_1', 'agent_2'])) NOT VALID;

COMMENT ON COLUMN public.auto_campaigns.web_campaign_form IS
  'Form Web đã tạo chiến dịch (V482): form_1/form_2 = form thủ công 1/2, agent_1/agent_2 = Thêm bằng Agent / Agent 2. NULL = tạo trước V482 hoặc không từ form Web (Desktop, iOS, Quy trình...). Ghi một lần lúc tạo qua create_control_campaign_v2; Web sửa/nhân bản bằng đúng phiên bản này. akaAgentWebApp docs/CAMPAIGN_FORM_V2.md.';

CREATE OR REPLACE FUNCTION public.create_control_campaign_v2(p_staff_id bigint, p_organization_id bigint, p_idempotency_key text, p_campaign jsonb, p_inputs jsonb DEFAULT '[]'::jsonb, p_initial_status text DEFAULT 'chờ xử lý'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_id bigint;
  v_web_form text;
BEGIN
  IF p_initial_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_campaign_initial_status';
  END IF;

  v_result := public.create_control_campaign(
    p_staff_id,
    p_organization_id,
    p_idempotency_key,
    p_campaign,
    p_inputs
  );

  -- V482: form Web đã tạo chiến dịch (form thủ công/Agent, phiên bản 1/2). Không gửi hoặc giá trị lạ = NULL
  -- (Desktop, iOS, Quy trình, nhập SQL...). Chỉ ghi lúc tạo; lần gọi lặp cùng Idempotency-Key không ghi lại.
  v_web_form := CASE WHEN p_campaign->>'webCampaignForm' IN ('form_1', 'form_2', 'agent_1', 'agent_2')
    THEN p_campaign->>'webCampaignForm' END;

  -- The inner insert and this update share a transaction, so a cloned campaign is
  -- never externally visible in the runnable state.
  IF COALESCE((v_result->>'created')::boolean, false) THEN
    v_campaign_id := NULLIF(v_result->>'campaign_id', '')::bigint;
    IF p_initial_status = 'tạm dừng' THEN
      UPDATE public.auto_campaigns
      SET status = 'tạm dừng', web_campaign_form = v_web_form, updated_at = now()
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    ELSIF v_web_form IS NOT NULL THEN
      -- Chỉ ghi cột form, không nêu status: không chạy trigger UPDATE OF status, không đổi config version.
      UPDATE public.auto_campaigns
      SET web_campaign_form = v_web_form
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

DO $v482_postflight$
DECLARE
  v_fn regprocedure := to_regprocedure('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)');
  v_check text;
  v_rejected_valid integer;
  v_accepted_invalid integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = 'public.auto_campaigns'::regclass AND a.attname = 'web_campaign_form'
                   AND NOT a.attisdropped AND NOT a.attnotnull AND NOT a.atthasdef AND a.atttypid = 'text'::regtype) THEN
    RAISE EXCEPTION 'v482 postflight: cột auto_campaigns.web_campaign_form không đúng';
  END IF;
  SELECT pg_get_expr(conbin, conrelid) INTO v_check FROM pg_constraint
   WHERE conrelid = 'public.auto_campaigns'::regclass AND conname = 'auto_campaigns_web_campaign_form_check' AND contype = 'c';
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'v482 postflight: thiếu CHECK auto_campaigns_web_campaign_form_check';
  END IF;
  -- Thử chính biểu thức CHECK trên giá trị mẫu (không ghi dòng nào).
  EXECUTE format('SELECT count(*) FILTER (WHERE (%s) IS FALSE) FROM (VALUES (NULL::text), (''form_1''), (''form_2''), (''agent_1''), (''agent_2'')) AS t(web_campaign_form)', v_check)
    INTO v_rejected_valid;
  EXECUTE format('SELECT count(*) FILTER (WHERE (%s) IS NOT FALSE) FROM (VALUES (''''), (''form_3''), (''agent_0''), (''Form_1''), (''form_1 ''), (''form''), (''agent''), (''1''), (''desktop'')) AS t(web_campaign_form)', v_check)
    INTO v_accepted_invalid;
  IF v_rejected_valid <> 0 OR v_accepted_invalid <> 0 THEN
    RAISE EXCEPTION 'v482 postflight: CHECK sai (chặn % giá trị hợp lệ, nhận % giá trị sai)', v_rejected_valid, v_accepted_invalid;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaigns WHERE web_campaign_form IS NOT NULL) THEN
    RAISE EXCEPTION 'v482 postflight: có chiến dịch đã mang giá trị form';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND md5(prosrc) = '51f354426f1e1a2b0500199fc08b14cf'
                   AND prosecdef AND provolatile = 'v' AND pg_get_userbyid(proowner) = 'postgres'
                   AND proconfig = ARRAY['search_path=public', 'statement_timeout=60s']
                   AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'v482 postflight: create_control_campaign_v2 không đúng bản mới hoặc mất thuộc tính/quyền';
  END IF;
END
$v482_postflight$;

COMMIT;
