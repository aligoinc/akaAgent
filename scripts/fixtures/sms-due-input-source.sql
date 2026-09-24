-- Exact unchanged production fetch function, 2026-09-24; local fixture only.
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
