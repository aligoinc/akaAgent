-- Rollback V482 bước 2 — gỡ hẳn auto_campaigns.web_campaign_form (mất phân loại form đã ghi). Chỉ chạy khi bỏ hẳn tính năng,
-- ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema). Khôi phục nguyên văn thân create_control_campaign_v2 trước V482
-- (md5 prosrc b92f89114e063687609a3a08c89d9d55) TRƯỚC khi xoá cột vì bản V482 ghi vào cột. API bản mới tự bỏ cột khi DB thiếu
-- (đọc lại không có cột, nhớ 5 phút) nên không cần rollback API trước.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v482_remove_preflight$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
      WHERE oid = 'public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)'::regprocedure)
     IS DISTINCT FROM '51f354426f1e1a2b0500199fc08b14cf' THEN
    RAISE EXCEPTION 'rollback v482: create_control_campaign_v2 không phải bản V482, dừng để không ghi đè bản vá khác';
  END IF;
END
$v482_remove_preflight$;

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

  -- The inner insert and this update share a transaction, so a cloned campaign is
  -- never externally visible in the runnable state.
  IF p_initial_status = 'tạm dừng' AND COALESCE((v_result->>'created')::boolean, false) THEN
    v_campaign_id := NULLIF(v_result->>'campaign_id', '')::bigint;
    UPDATE public.auto_campaigns
    SET status = 'tạm dừng', updated_at = now()
    WHERE id = v_campaign_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND COALESCE(is_delete, false) = false;
  END IF;

  RETURN v_result;
END;
$function$;

DO $v482_remove_postflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                 WHERE oid = 'public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)'::regprocedure
                   AND md5(prosrc) = 'b92f89114e063687609a3a08c89d9d55' AND prosecdef AND pg_get_userbyid(proowner) = 'postgres'
                   AND proconfig = ARRAY['search_path=public', 'statement_timeout=60s']
                   AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'rollback v482: khôi phục create_control_campaign_v2 không khớp bản trước V482';
  END IF;
END
$v482_remove_postflight$;

ALTER TABLE public.auto_campaigns DROP CONSTRAINT IF EXISTS auto_campaigns_web_campaign_form_check;
ALTER TABLE public.auto_campaigns DROP COLUMN IF EXISTS web_campaign_form;
COMMIT;
