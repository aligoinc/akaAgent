BEGIN;

DROP INDEX IF EXISTS public.idx_sms_campaigns_account_status_schedule;
DROP INDEX IF EXISTS public.idx_sms_input_data_campaign_status_schedule;

CREATE INDEX IF NOT EXISTS idx_sms_campaigns_account_status_schedule
  ON public.auto_campaigns (account_id, action_id, status, schedule, id)
  WHERE COALESCE(is_delete, false) = false
    AND action_id = 'sms_send';

CREATE INDEX IF NOT EXISTS idx_sms_input_data_campaign_status_schedule
  ON public.auto_campaign_input_data (campaign_id, status, schedule, created_at, id)
  WHERE COALESCE(is_delete, false) = false;

DROP FUNCTION IF EXISTS public.aka_agent_list_sms_due_input_data(bigint, bigint, text, integer);
DROP FUNCTION IF EXISTS public.aka_agent_list_sms_due_input_data(bigint, bigint, text, integer, integer);
DROP FUNCTION IF EXISTS public.aka_agent_get_next_sms_due_at(bigint, bigint, text);
DROP FUNCTION IF EXISTS public.aka_agent_record_sms_message_status(bigint, bigint, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.aka_agent_list_sms_due_input_data(
  p_account_id bigint,
  p_campaign_ids bigint[] DEFAULT NULL,
  p_carrier text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_per_campaign_limit integer DEFAULT 30
)
RETURNS TABLE (
  input_data_id bigint,
  campaign_id bigint,
  campaign_name text,
  campaign_schedule timestamptz,
  campaign_extra_settings jsonb,
  input_schedule timestamptz,
  effective_schedule timestamptz,
  input_created_at timestamptz,
  phone text,
  phone_carrier text,
  content text,
  name text,
  info1 text,
  info2 text,
  info3 text,
  info4 text,
  info5 text
)
LANGUAGE sql
STABLE
SET search_path TO public
AS $$
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
      AND campaign.action_id = 'sms_send'
      AND campaign.status = 'chờ xử lý'
      AND COALESCE(campaign.is_delete, false) = false
      AND (
        normalized.campaign_ids IS NULL
        OR campaign.id = ANY(normalized.campaign_ids)
      )
  )
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
    data.info5
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
  LIMIT (SELECT row_limit FROM normalized);
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_next_sms_due_at(
  p_account_id bigint,
  p_campaign_ids bigint[] DEFAULT NULL,
  p_carrier text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO public
AS $$
  WITH normalized AS (
    SELECT
      p_campaign_ids AS campaign_ids,
      NULLIF(btrim(lower(coalesce(p_carrier, ''))), '') AS carrier
  )
  SELECT MIN(COALESCE(data.schedule, campaign.schedule))
  FROM public.auto_campaign_input_data AS data
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = data.campaign_id
  CROSS JOIN normalized
  WHERE campaign.account_id = p_account_id
    AND campaign.action_id = 'sms_send'
    AND campaign.status = 'chờ xử lý'
    AND COALESCE(campaign.is_delete, false) = false
    AND (
      normalized.campaign_ids IS NULL
      OR campaign.id = ANY(normalized.campaign_ids)
    )
    AND data.status = 'chờ xử lý'
    AND COALESCE(data.is_delete, false) = false
    AND NULLIF(btrim(coalesce(data.phone, '')), '') IS NOT NULL
    AND NULLIF(btrim(coalesce(data.content, '')), '') IS NOT NULL
    AND (
      normalized.carrier IS NULL
      OR normalized.carrier = 'all'
      OR lower(coalesce(data.phone_carrier, 'unknown')) = normalized.carrier
    )
    AND COALESCE(data.schedule, campaign.schedule) > now();
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_record_sms_message_status(
  p_input_data_id bigint,
  p_account_id bigint,
  p_detail_status text,
  p_log text DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_note text DEFAULT NULL
)
RETURNS TABLE (
  input_data_id bigint,
  campaign_id bigint,
  detail_id bigint,
  detail_status text,
  counted boolean,
  input_updated boolean,
  accepted boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_input record;
  v_existing record;
  v_detail_id bigint := NULL;
  v_final_status text := p_detail_status;
  v_counted boolean := false;
  v_input_updated boolean := false;
  v_note text := p_note;
  v_existing_found boolean := false;
BEGIN
  IF p_input_data_id IS NULL OR p_account_id IS NULL THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'input_data_id/account_id không hợp lệ';
    RETURN;
  END IF;

  IF p_detail_status NOT IN ('đã gửi', 'đã nhận', 'thất bại') THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'Trạng thái SMS không hợp lệ';
    RETURN;
  END IF;

  SELECT
    input_data.id,
    input_data.campaign_id,
    input_data.status,
    campaign.account_id
  INTO v_input
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = input_data.campaign_id
  WHERE input_data.id = p_input_data_id
    AND COALESCE(input_data.is_delete, false) = false
    AND campaign.account_id = p_account_id
    AND campaign.action_id = 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
  FOR UPDATE OF input_data;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'Dữ liệu SMS không thuộc tài khoản đang đăng nhập';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('aka_agent_sms_status:' || p_input_data_id::text, 0));

  SELECT
    detail.id,
    detail.status,
    detail.log,
    detail.data
  INTO v_existing
  FROM public.auto_campaign_details AS detail
  WHERE detail.input_data_id = p_input_data_id
    AND detail.action_code = 'sms_send'
    AND COALESCE(detail.is_delete, false) = false
  ORDER BY detail.created_at DESC NULLS LAST, detail.id DESC
  LIMIT 1
  FOR UPDATE;
  v_existing_found := FOUND;

  IF NOT v_existing_found THEN
    IF p_detail_status = 'đã nhận' THEN
      RETURN QUERY SELECT
        p_input_data_id,
        v_input.campaign_id,
        NULL::bigint,
        NULL::text,
        false,
        false,
        false,
        'Chưa có trạng thái đã gửi để cập nhật đã nhận';
      RETURN;
    END IF;

    INSERT INTO public.auto_campaign_details (
      input_data_id,
      campaign_id,
      account_id,
      action_code,
      action_name,
      status,
      log,
      data,
      counts_toward_limit
    )
    VALUES (
      p_input_data_id,
      v_input.campaign_id,
      p_account_id,
      'sms_send',
      'Gửi tin nhắn SMS',
      p_detail_status,
      p_log,
      COALESCE(p_data, '{}'::jsonb),
      true
    )
    RETURNING id INTO v_detail_id;

    PERFORM public.increment_auto_account_action_count(p_account_id, 'sms_send', 1);
    v_counted := true;
    v_input_updated := true;
  ELSE
    v_detail_id := v_existing.id;
    v_final_status := v_existing.status;

    IF v_existing.status <> 'đã nhận'
      AND (
        p_detail_status = 'đã nhận'
        OR (p_detail_status = 'thất bại' AND v_existing.status <> 'thất bại')
      )
    THEN
      UPDATE public.auto_campaign_details
      SET
        status = p_detail_status,
        log = p_log,
        data = COALESCE(v_existing.data, '{}'::jsonb) || COALESCE(p_data, '{}'::jsonb)
      WHERE id = v_existing.id;

      v_final_status := p_detail_status;
      v_input_updated := true;
    END IF;

    IF NOT v_input_updated AND v_input.status <> 'hoàn thành' THEN
      v_input_updated := true;
      IF v_final_status = 'thất bại' THEN
        v_note := COALESCE(
          v_existing.log,
          v_existing.data ->> 'errorMessage',
          v_existing.data ->> 'errorCode',
          'Gửi SMS thất bại'
        );
      ELSE
        v_note := NULL;
      END IF;
    END IF;
  END IF;

  IF v_input_updated THEN
    IF v_final_status = 'thất bại' THEN
      v_note := COALESCE(v_note, p_log, 'Gửi SMS thất bại');
    ELSE
      v_note := NULL;
    END IF;

    UPDATE public.auto_campaign_input_data
    SET
      status = 'hoàn thành',
      note = v_note,
      date_action = now()
    WHERE id = p_input_data_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS remaining
    WHERE remaining.campaign_id = v_input.campaign_id
      AND COALESCE(remaining.is_delete, false) = false
      AND remaining.status IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
  ) THEN
    UPDATE public.auto_campaigns
    SET
      status = 'hoàn thành',
      note = 'Hoàn thành chiến dịch SMS từ mobile app',
      updated_at = now()
    WHERE id = v_input.campaign_id
      AND action_id = 'sms_send'
      AND COALESCE(is_delete, false) = false;
  END IF;

  RETURN QUERY SELECT
    p_input_data_id,
    v_input.campaign_id,
    v_detail_id,
    v_final_status,
    v_counted,
    v_input_updated,
    true,
    NULL::text;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
