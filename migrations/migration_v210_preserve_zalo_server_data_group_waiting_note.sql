-- Preserve durable Data Group waiting notes when a Zalo Server campaign is
-- paused or resumed. Other transient/error notes keep the existing reset
-- behavior so a manual control transition does not surface stale failures.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_campaign_status(
  p_campaign_id bigint,
  p_staff_id bigint,
  p_status text
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  account_status text
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_mode record;
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
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT COALESCE(v_mode.is_zalo_server, false) THEN
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

COMMENT ON FUNCTION public.aka_agent_set_zalo_server_campaign_status(bigint, bigint, text) IS
  'Tenant-scoped idempotent pause/resume for a Zalo Server campaign. Data Group waiting notes survive control transitions; other notes are cleared.';

NOTIFY pgrst, 'reload schema';

COMMIT;
