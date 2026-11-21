CREATE OR REPLACE FUNCTION public.aka_agent_engine_action_limit(p_campaign_id bigint, p_account_id bigint, p_action_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_limits jsonb;
  v_org bigint;
  v_base jsonb;
  v_group jsonb;
  v_daily numeric;
  v_count numeric;
  v_minutes numeric;
  v_cap numeric;
  v_unlimited boolean;
  v_rows integer;
BEGIN
  SELECT nullif(c.extra_settings->'actionLimits', 'null'::jsonb), c.organization_id INTO v_limits, v_org
    FROM public.auto_campaigns c WHERE c.id = p_campaign_id;
  IF p_action_code = 'zalo_find_phone_user' THEN
    v_base := jsonb_build_object('dailyLimit', 1000, 'rateLimitCount', 1000,
      'rateLimitMinutes', coalesce(nullif(v_limits->'byActionCode'->p_action_code->'rateLimitMinutes', 'null'::jsonb), v_limits->'rateLimitMinutes'));
  ELSE
    v_base := nullif(v_limits->'byActionCode'->p_action_code, 'null'::jsonb);
    IF v_base IS NULL AND v_limits IS NOT NULL THEN
      v_base := jsonb_build_object('dailyLimit', v_limits->'dailyLimit', 'rateLimitCount', v_limits->'rateLimitCount', 'rateLimitMinutes', v_limits->'rateLimitMinutes');
    END IF;
  END IF;
  SELECT nullif(g.settings->'byActionCode'->p_action_code, 'null'::jsonb) INTO v_group
    FROM public.auto_accounts a JOIN public.auto_account_groups g ON g.id = a.account_group_id WHERE a.id = p_account_id;

  -- normalizePositiveActionLimit: số dương thì lấy phần nguyên, còn lại là không đặt.
  IF v_group IS NOT NULL THEN
    v_daily := coalesce(public.aka_agent_engine_positive(v_group->'dailyLimit'), public.aka_agent_engine_number(v_base->'dailyLimit'));
    v_count := coalesce(public.aka_agent_engine_positive(v_group->'rateLimitCount'), public.aka_agent_engine_number(v_base->'rateLimitCount'));
    v_minutes := coalesce(public.aka_agent_engine_positive(v_group->'rateLimitMinutes'), public.aka_agent_engine_number(v_base->'rateLimitMinutes'));
  ELSE
    v_daily := public.aka_agent_engine_number(v_base->'dailyLimit');
    v_count := public.aka_agent_engine_number(v_base->'rateLimitCount');
    v_minutes := public.aka_agent_engine_number(v_base->'rateLimitMinutes');
  END IF;

  -- V558: trần gói Facebook như bộ cũ (getGroupedDailySendLimit, gộp facebookCore sản phẩm 3 và facebookFanpage sản phẩm 10 cho mọi
  -- thao tác Facebook): gói trả phí không đặt số = không giới hạn; gói demo không đặt số = 30; nhiều gói lấy số lớn nhất.
  IF p_action_code <> 'zalo_find_phone_user' AND (p_action_code LIKE 'zalo\_%' OR p_action_code LIKE 'fb\_%') THEN
    SELECT count(*), bool_or(coalesce(p.max_sends_per_day, 0) <= 0 AND lower(btrim(coalesce(p.package_type, ''))) <> 'demo'),
           max(CASE WHEN coalesce(p.max_sends_per_day, 0) > 0 THEN p.max_sends_per_day ELSE 30 END)
      INTO v_rows, v_unlimited, v_cap
      FROM public.org_organization_product p
     WHERE p.organization_id = v_org AND p.is_deleted = false
       AND p.product_id IN (SELECT x FROM unnest(CASE WHEN p_action_code LIKE 'fb\_%' THEN ARRAY[3, 10] ELSE ARRAY[16, 18] END) x)
       AND p.expiration_date IS NOT NULL AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_vn;
    IF v_rows > 0 AND NOT v_unlimited THEN
      v_daily := least(coalesce(public.aka_agent_engine_positive(to_jsonb(v_daily)), 30), v_cap);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'daily', CASE WHEN v_daily > 0 THEN v_daily ELSE 30 END,
    'windowCount', CASE WHEN v_count > 0 THEN v_count ELSE 9 END,
    'windowMinutes', CASE WHEN v_minutes > 0 THEN v_minutes ELSE 65 END);
END $function$
