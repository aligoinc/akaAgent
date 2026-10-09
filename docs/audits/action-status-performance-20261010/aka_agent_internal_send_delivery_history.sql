CREATE OR REPLACE FUNCTION public.aka_agent_internal_send_delivery_history(p_account_id bigint, p_action_codes text[], p_since timestamp with time zone, p_now timestamp with time zone)
 RETURNS TABLE(detail_id bigint, created_at timestamp with time zone, campaign_id bigint, campaign_name text, target_keys text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT
      d.id AS detail_id,
      d.created_at,
      d.campaign_id,
      c.name AS campaign_name,
      public.aka_agent_internal_delivery_cooldown_target_keys(
        CASE d.action_code
          WHEN 'fb_post_group' THEN 'facebook_group'
          WHEN 'fb_post_page' THEN 'facebook_page'
          WHEN 'fb_message_friend' THEN 'facebook_person'
          WHEN 'fb_message_stranger' THEN 'facebook_person'
          WHEN 'fb_message_page_inbox_customer' THEN 'facebook_page_inbox'
          WHEN 'zalo_message_friend' THEN 'zalo_person'
          WHEN 'zalo_message_stranger' THEN 'zalo_person'
          WHEN 'zalo_message_group' THEN 'zalo_group'
          WHEN 'sms_send' THEN 'phone'
          WHEN 'email_send' THEN 'email'
          ELSE ''
        END,
        source_input.uid,
        source_input.phone,
        source_input.email
      ) AS target_keys
    FROM (
      -- Disjoint branches retain the existing legacy partial-index path.
      -- Evidence wins over names/report groups, including partial deliveries.
      SELECT id,created_at,campaign_id,input_data_id,action_code
      FROM public.auto_campaign_details
      WHERE account_id=p_account_id AND action_code=ANY(p_action_codes)
        AND created_at>=p_since AND created_at<=p_now
        AND policy_snapshot->>'operationState'='committed'
      UNION ALL
      SELECT id,created_at,campaign_id,input_data_id,action_code
      FROM public.auto_campaign_details
      WHERE account_id=p_account_id AND action_code=ANY(p_action_codes)
        AND created_at>=p_since AND created_at<=p_now
        AND policy_snapshot->>'operationState' IS NULL
        AND status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
    ) AS d
    JOIN public.auto_campaign_input_data AS source_input ON source_input.id = d.input_data_id
    LEFT JOIN public.auto_campaigns AS c ON c.id = d.campaign_id

$function$

