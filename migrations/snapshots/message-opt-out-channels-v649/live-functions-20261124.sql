-- Thân production đọc 24/11/2026 (chỉ đọc), dùng cho bản gỡ V649 và kiểm thử.
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

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_zalo_message_opt_outs AS opt_out
    WHERE opt_out.staff_id = p_staff_id
      AND opt_out.organization_id = v_organization_id
      AND opt_out.phone = v_phone
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
      OR o.zalo_global_id ILIKE v_pattern OR o.source_campaign_name ILIKE v_pattern);
  v_page := least(v_page, greatest(1, ceil(v_total::numeric / 50)::integer));
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.confirmed_at DESC, x.id DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT o.id, o.confirmed_at, jsonb_build_object(
      'id', o.id, 'phone', o.phone, 'email', o.email, 'zaloGlobalId', o.zalo_global_id,
      'zaloName', o.zalo_name, 'zaloAvatar', o.zalo_avatar, 'confirmedAt', o.confirmed_at,
      'sourceCampaignId', o.source_campaign_id, 'sourceCampaignName', o.source_campaign_name,
      'sourceDetailId', o.source_detail_id, 'sourceSentAt', o.source_sent_at,
      'sourceActionName', o.source_action_name, 'sourceStatus', o.source_status
    ) AS item
    FROM public.auto_zalo_message_opt_outs o
    WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.confirmed_at IS NOT NULL
      AND (v_search = '' OR o.zalo_name ILIKE v_pattern OR o.phone ILIKE v_pattern OR o.email ILIKE v_pattern
        OR o.zalo_global_id ILIKE v_pattern OR o.source_campaign_name ILIKE v_pattern)
    ORDER BY o.confirmed_at DESC, o.id DESC LIMIT 50 OFFSET (v_page - 1) * 50
  ) x;
  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', 50);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_sms_due_input_data(p_account_id bigint, p_campaign_ids bigint[] DEFAULT NULL::bigint[], p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_per_campaign_limit integer DEFAULT 30)
 RETURNS TABLE(input_data_id bigint, campaign_id bigint, campaign_name text, campaign_schedule timestamp with time zone, campaign_extra_settings jsonb, input_schedule timestamp with time zone, effective_schedule timestamp with time zone, input_created_at timestamp with time zone, phone text, phone_carrier text, content text, name text, info1 text, info2 text, info3 text, info4 text, info5 text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;
