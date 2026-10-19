-- Run deliberately inside a transaction after reviewing the current live definition.
DO $preflight$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)'))) IS DISTINCT FROM '8811f009a969f2ce8dda19df95a8c614' THEN
    RAISE EXCEPTION 'campaign_orphan_pause rollback: source drift for aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)'))) IS DISTINCT FROM 'ba5a4107bf5adcbe13dee5834c644171' THEN
    RAISE EXCEPTION 'campaign_orphan_pause rollback: source drift for aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_campaign_status(p_campaign_id bigint, p_staff_id bigint, p_status text)
 RETURNS TABLE(ok boolean, reason text, campaign_id bigint, campaign_status text, account_status text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_status text;
  v_account_status text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status, account.status
  INTO v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_campaign_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;
  IF (v_target_status = 'tạm dừng' AND v_campaign_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_campaign_status = 'tạm dừng')
  THEN
    UPDATE public.auto_campaigns AS campaign
    SET
      status = v_target_status,
      note = CASE
        WHEN campaign.data_target_source_mode = 'data_group'
          AND btrim(COALESCE(campaign.note, '')) IN ('Chờ data phù hợp', 'Chờ data mới')
        THEN campaign.note
        ELSE NULL
      END,
      updated_at = now()
    WHERE campaign.id = p_campaign_id;
    RETURN QUERY SELECT true, 'updated', p_campaign_id, v_target_status, v_account_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_campaign_status, v_account_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_desktop_campaign_status_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_target_status text)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, db_now timestamp with time zone, vietnam_date_key date)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_target_status text := btrim(COALESCE(p_target_status, ''));
  v_organization_id bigint;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_is_active boolean;
  v_account_platform text;
  v_account_is_zalo_server boolean;
  v_runtime_claim_token uuid;
  v_runtime_claim_target text;
  v_runtime_unit_token uuid;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('tạm dừng', 'chờ xử lý') THEN
    RAISE EXCEPTION 'target status must be paused or pending';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.status, account.status,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    COALESCE(account.is_active, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_unit_token
  INTO v_campaign_status, v_account_status,
    v_campaign_is_delete, v_account_is_delete, v_account_is_active,
    v_account_platform, v_account_is_zalo_server,
    v_runtime_claim_token, v_runtime_claim_target, v_runtime_unit_token
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
  FOR UPDATE OF campaign, account;
  v_campaign_found := FOUND;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  IF NOT v_campaign_found THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  IF v_account_platform = 'zalo' AND v_account_is_zalo_server THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete THEN
    v_reason := 'account_deleted';
  ELSIF NOT v_account_is_active THEN
    v_reason := 'account_inactive';
  ELSIF v_target_status = 'tạm dừng' THEN
    IF v_campaign_status = 'tạm dừng' THEN
      v_reason := 'already_target';
    ELSIF v_campaign_status = 'đang chạy'
      OR v_runtime_claim_token IS NOT NULL
    THEN
      v_reason := 'runtime_busy';
    ELSIF v_runtime_unit_token IS NOT NULL THEN
      v_reason := 'unit_lease_busy';
    ELSIF v_campaign_status IS DISTINCT FROM 'chờ xử lý' THEN
      v_reason := 'invalid_transition';
    ELSE
      UPDATE public.auto_campaigns AS campaign
      SET status = 'tạm dừng',
        note = CASE
          WHEN campaign.data_target_source_mode = 'data_group'
            AND campaign.note IN ('Chờ data phù hợp', 'Chờ data mới')
          THEN campaign.note
          ELSE NULL
        END,
        updated_at = v_now
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
        AND campaign.status = 'chờ xử lý'
        AND campaign.runtime_claim_token IS NULL
        AND campaign.runtime_unit_token IS NULL;
      IF FOUND THEN
        v_campaign_status := 'tạm dừng';
        v_reason := 'updated';
      ELSE
        v_reason := 'runtime_busy';
      END IF;
    END IF;
  ELSE
    IF v_campaign_status = 'đang chạy' THEN
      v_reason := 'runtime_busy';
    ELSIF v_runtime_unit_token IS NOT NULL THEN
      v_reason := 'unit_lease_busy';
    ELSIF v_runtime_claim_token IS NOT NULL
      AND v_runtime_claim_target IS DISTINCT FROM 'server'
    THEN
      v_reason := 'runtime_busy';
    ELSIF NOT v_account_is_active THEN
      v_reason := 'account_inactive';
    ELSIF v_campaign_status IS DISTINCT FROM 'tạm dừng' THEN
      v_reason := 'invalid_transition';
    ELSE
      UPDATE public.auto_campaigns AS campaign
      SET status = 'chờ xử lý', note = NULL, updated_at = v_now
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
        AND campaign.status = 'tạm dừng'
        AND (
          campaign.runtime_claim_token IS NULL
          OR campaign.runtime_claim_target = 'server'
        )
        AND campaign.runtime_unit_token IS NULL;
      IF FOUND THEN
        v_campaign_status := 'chờ xử lý';
        v_reason := 'updated';
      ELSE
        v_reason := 'runtime_busy';
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_reason IN ('updated', 'already_target'),
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date;
END;
$function$;
