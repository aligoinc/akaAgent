-- Candidate only: staff-wide delivery history for zalo_message_phone.
-- Captured live akachat (cgjbsmqtfhqvttudyjzq); keep V330/V367 helpers unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') IS NULL
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])'))) <> '7e9107c0957684230afa2b86e40f2e2c' THEN
    RAISE EXCEPTION 'v424 source drift: aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])';
  END IF;
  IF (SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'security_definer',prosecdef,
      'volatility',provolatile,'config',proconfig,'acl',proacl::text)
      FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])'))
    IS DISTINCT FROM '{"owner":"postgres","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}"}'::jsonb THEN
    RAISE EXCEPTION 'v424 attributes drift: aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])';
  END IF;
  IF to_regprocedure('public.aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)') IS NULL
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)'))) <> 'f356ae8c97cab7890f4a1740b99adce3' THEN
    RAISE EXCEPTION 'v424 source drift: aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)';
  END IF;
  IF (SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'security_definer',prosecdef,
      'volatility',provolatile,'config',proconfig,'acl',proacl::text)
      FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)'))
    IS DISTINCT FROM '{"owner":"postgres","security_definer":false,"volatility":"i","config":["search_path=pg_catalog, public"],"acl":"{postgres=X/postgres,service_role=X/postgres}"}'::jsonb THEN
    RAISE EXCEPTION 'v424 attributes drift: aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)';
  END IF;
  IF to_regprocedure('public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)') IS NULL
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)'))) <> 'a8e94d7a35d42064236d369c6e0e088d' THEN
    RAISE EXCEPTION 'v424 source drift: aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)';
  END IF;
  IF (SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'security_definer',prosecdef,
      'volatility',provolatile,'config',proconfig,'acl',proacl::text)
      FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)'))
    IS DISTINCT FROM '{"owner":"postgres","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"acl":"{postgres=X/postgres}"}'::jsonb THEN
    RAISE EXCEPTION 'v424 attributes drift: aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE id='zalo_message_phone') THEN
    RAISE EXCEPTION 'v424 missing zalo_message_phone';
  END IF;
END;
$preflight$;

ALTER TABLE public.auto_campaign_actions
  ADD COLUMN show_staff_delivery_cooldown boolean NOT NULL DEFAULT false;

UPDATE public.auto_campaign_actions
SET show_staff_delivery_cooldown = true
WHERE id = 'zalo_message_phone';

CREATE OR REPLACE FUNCTION public.aka_agent_apply_campaign_delivery_cooldown(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[])
 RETURNS TABLE(input_data_id bigint, decision text, note text, last_sent_at timestamp with time zone, eligible_date date, source_campaign_id bigint, source_campaign_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_extra jsonb;
  v_enabled boolean;
  v_all_accounts boolean;
  v_days_text text;
  v_days integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := pg_catalog.timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_history_since timestamptz;
  v_target_kind text;
  v_history_action_codes text[];
  v_ids bigint[];
  v_requested_count integer;
  v_locked_count integer;
  v_supported boolean := true;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_scope';
  END IF;

  SELECT pg_catalog.array_agg(requested.id ORDER BY requested.ordinality), pg_catalog.count(*)::integer
  INTO v_ids, v_requested_count
  FROM (
    SELECT DISTINCT ON (u.id) u.id, u.ordinality
    FROM pg_catalog.unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) WITH ORDINALITY AS u(id, ordinality)
    WHERE u.id IS NOT NULL AND u.id > 0
    ORDER BY u.id, u.ordinality
  ) AS requested;

  IF v_requested_count IS NULL OR v_requested_count < 1 OR v_requested_count > 500 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_batch_size';
  END IF;

  SELECT c.*
  INTO v_campaign
  FROM public.auto_campaigns AS c
  JOIN public.auto_accounts AS a
    ON a.id = c.account_id
   AND a.staff_id = p_staff_id
   AND a.organization_id = c.organization_id
   AND COALESCE(a.is_delete, false) = false
  JOIN public.org_staff AS s
    ON s.id = p_staff_id
   AND s.organization_id = c.organization_id
   AND s.is_active = true
  WHERE c.id = p_campaign_id
    AND c.account_id = p_account_id
    AND c.staff_id = p_staff_id
    AND COALESCE(c.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_delivery_cooldown_scope_not_found';
  END IF;

  PERFORM i.id
  FROM public.auto_campaign_input_data AS i
  WHERE i.id = ANY(v_ids)
    AND i.campaign_id = p_campaign_id
    AND COALESCE(i.is_delete, false) = false
  ORDER BY i.id
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_count = ROW_COUNT;

  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'campaign_delivery_cooldown_input_scope_mismatch';
  END IF;

  v_extra := COALESCE(v_campaign.extra_settings, '{}'::jsonb);
  v_enabled := COALESCE((v_extra->>'recentDeliveryCooldownEnabled')::boolean, false);
  v_all_accounts := v_campaign.action_id = 'zalo_message_phone'
    AND COALESCE(v_extra->'recentDeliveryCooldownAllAccounts' = 'true'::jsonb, false);

  IF NOT v_enabled THEN
    RETURN QUERY
    SELECT i.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text
    FROM public.auto_campaign_input_data AS i
    WHERE i.id = ANY(v_ids)
    ORDER BY pg_catalog.array_position(v_ids, i.id);
    RETURN;
  END IF;

  v_days_text := COALESCE(NULLIF(pg_catalog.btrim(v_extra->>'recentDeliveryCooldownDays'), ''), '3');
  IF v_days_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_days';
  END IF;
  v_days := v_days_text::integer;
  IF v_days < 1 OR v_days > 3650 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_days';
  END IF;

  CASE v_campaign.action_id
    WHEN 'facebook_group_post' THEN
      v_target_kind := 'facebook_group';
      v_history_action_codes := ARRAY['fb_post_group', 'fb_post_page'];
    WHEN 'facebook_page_post' THEN
      v_target_kind := 'facebook_page';
      v_history_action_codes := ARRAY['fb_post_group', 'fb_post_page'];
    WHEN 'facebook_message_friend' THEN
      v_target_kind := 'facebook_person';
      v_history_action_codes := ARRAY['fb_message_friend', 'fb_message_stranger'];
    WHEN 'facebook_message_uid' THEN
      IF COALESCE((v_extra->>'enableMessage')::boolean, true) THEN
        v_target_kind := 'facebook_person';
        v_history_action_codes := ARRAY['fb_message_friend', 'fb_message_stranger'];
      ELSE
        v_supported := false;
      END IF;
    WHEN 'facebook_page_to_message' THEN
      v_target_kind := 'facebook_page_inbox';
      v_history_action_codes := ARRAY['fb_message_page_inbox_customer'];
    WHEN 'zalo_message_friend', 'zalo_message_birthday' THEN
      v_target_kind := 'zalo_person';
      v_history_action_codes := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
    WHEN 'zalo_message_group' THEN
      v_target_kind := 'zalo_group';
      v_history_action_codes := ARRAY['zalo_message_group'];
    WHEN 'zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
         'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation' THEN
      IF COALESCE((v_extra->>'enableMessage')::boolean, false) THEN
        v_target_kind := 'zalo_person';
        v_history_action_codes := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
      ELSE
        v_supported := false;
      END IF;
    WHEN 'sms_send' THEN
      v_target_kind := 'phone';
      v_history_action_codes := ARRAY['sms_send'];
    WHEN 'email_send' THEN
      v_target_kind := 'email';
      v_history_action_codes := ARRAY['email_send'];
    ELSE
      v_supported := false;
  END CASE;

  IF NOT v_supported THEN
    RETURN QUERY
    SELECT i.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text
    FROM public.auto_campaign_input_data AS i
    WHERE i.id = ANY(v_ids)
    ORDER BY pg_catalog.array_position(v_ids, i.id);
    RETURN;
  END IF;

  v_history_since := ((v_today - (v_days - 1))::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');

  RETURN QUERY
  WITH requested AS MATERIALIZED (
    SELECT
      i.id,
      i.status,
      u.ordinality,
      public.aka_agent_internal_delivery_cooldown_target_keys(
        v_target_kind,
        i.uid,
        i.phone,
        i.email
      ) AS target_keys
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS u(id, ordinality)
    JOIN public.auto_campaign_input_data AS i ON i.id = u.id
  ),
  batch_duplicates AS MATERIALIZED (
    SELECT current_row.id
    FROM requested AS current_row
    WHERE EXISTS (
      SELECT 1
      FROM requested AS earlier_row
      WHERE earlier_row.ordinality < current_row.ordinality
        AND earlier_row.target_keys && current_row.target_keys
    )
  ),
  history AS MATERIALIZED (
    SELECT h.*
    FROM (
      SELECT p_account_id AS id WHERE NOT v_all_accounts
      UNION ALL
      SELECT a.id
      FROM public.auto_accounts AS a
      WHERE v_all_accounts
        AND a.staff_id = p_staff_id
        AND a.organization_id = v_campaign.organization_id
    ) AS history_accounts
    CROSS JOIN LATERAL public.aka_agent_internal_send_delivery_history(
      history_accounts.id, v_history_action_codes, v_history_since, v_now
    ) AS h
  ),
  latest AS MATERIALIZED (
    SELECT DISTINCT ON (r.id)
      r.id AS input_data_id,
      h.created_at AS last_sent_at,
      h.campaign_id AS source_campaign_id,
      h.campaign_name AS source_campaign_name
    FROM requested AS r
    JOIN history AS h ON h.target_keys && r.target_keys
    ORDER BY r.id, h.created_at DESC, h.detail_id DESC
  ),
  decisions AS MATERIALIZED (
    SELECT
      r.id AS input_data_id,
      CASE
        WHEN r.status IS DISTINCT FROM 'chờ xử lý' THEN 'not_pending'
        WHEN pg_catalog.cardinality(r.target_keys) = 0 THEN 'paused_unidentifiable'
        WHEN bd.id IS NOT NULL THEN 'deferred_batch_duplicate'
        WHEN l.input_data_id IS NOT NULL
          AND v_today < (pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days)
          THEN 'paused_recent_delivery'
        ELSE 'allowed'
      END AS decision,
      CASE
        WHEN r.status IS DISTINCT FROM 'chờ xử lý' THEN 'Data không còn ở trạng thái chờ xử lý.'
        WHEN pg_catalog.cardinality(r.target_keys) = 0
          THEN 'Tạm dừng vì không thể chuẩn hóa đối tượng để kiểm tra giới hạn gửi/đăng lặp.'
        WHEN bd.id IS NOT NULL
          THEN 'Giữ chờ xử lý vì trùng đối tượng với một data đứng trước trong cùng batch.'
        WHEN l.input_data_id IS NOT NULL
          AND v_today < (pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days)
          THEN pg_catalog.format(
            CASE
              WHEN v_campaign.action_id IN ('facebook_group_post', 'facebook_page_post')
                THEN 'Tạm dừng: đã đăng bài trước đó ngày %s. Đăng lại từ %s.'
              WHEN v_campaign.action_id = 'email_send'
                THEN 'Tạm dừng: đã gửi email trước đó ngày %s. Gửi lại từ %s.'
              WHEN v_campaign.action_id = 'sms_send'
                THEN 'Tạm dừng: đã gửi SMS trước đó ngày %s. Gửi lại từ %s.'
              ELSE 'Tạm dừng: đã gửi tin trước đó ngày %s. Gửi lại từ %s.'
            END,
            pg_catalog.to_char(pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date, 'DD/MM/YYYY'),
            pg_catalog.to_char(pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days, 'DD/MM/YYYY')
          )
        ELSE NULL
      END AS note,
      l.last_sent_at,
      CASE WHEN l.last_sent_at IS NULL THEN NULL
        ELSE pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days
      END AS eligible_date,
      l.source_campaign_id,
      l.source_campaign_name,
      r.ordinality
    FROM requested AS r
    LEFT JOIN batch_duplicates AS bd ON bd.id = r.id
    LEFT JOIN latest AS l ON l.input_data_id = r.id
  ),
  paused AS (
    UPDATE public.auto_campaign_input_data AS i
    SET status = 'tạm dừng',
        note = d.note
    FROM decisions AS d
    WHERE i.id = d.input_data_id
      AND i.status = 'chờ xử lý'
      AND d.decision IN ('paused_recent_delivery', 'paused_unidentifiable')
    RETURNING i.id
  )
  SELECT
    d.input_data_id,
    d.decision,
    d.note,
    d.last_sent_at,
    d.eligible_date,
    d.source_campaign_id,
    d.source_campaign_name
  FROM decisions AS d
  LEFT JOIN paused AS p ON p.id = d.input_data_id
  ORDER BY d.ordinality;
END;
$function$;

-- A new catalog column changes PostgREST metadata.
NOTIFY pgrst, 'reload schema';
COMMIT;
