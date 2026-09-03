-- Run only after 20260903100510_zalo_message_opt_out.sql has been applied.
-- Every data mutation in this smoke test is rolled back.
BEGIN;

DO $smoke$
DECLARE
  v_campaign_id bigint;
  v_account_id bigint;
  v_staff_id bigint;
  v_first_id uuid;
  v_second_id uuid;
  v_state text;
  v_opted_out boolean;
  v_matched_by text;
  v_confirmed_at timestamptz;
BEGIN
  IF pg_catalog.to_regclass('public.auto_zalo_message_opt_outs') IS NULL THEN
    RAISE EXCEPTION 'auto_zalo_message_opt_outs is missing';
  END IF;

  SELECT campaign.id, campaign.account_id, campaign.staff_id
  INTO v_campaign_id, v_account_id, v_staff_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
   AND account.organization_id = campaign.organization_id
   AND account.flatform_type = 'zalo'
   AND COALESCE(account.is_delete, false) = false
  JOIN public.org_staff AS staff
    ON staff.id = campaign.staff_id
   AND staff.organization_id = campaign.organization_id
   AND staff.is_active = true
  WHERE campaign.action_id IN (
    'zalo_message_phone',
    'zalo_message_friend',
    'zalo_message_birthday',
    'zalo_message_group_member',
    'zalo_message_group_realtime',
    'zalo_message_remarketing_customer',
    'zalo_message_friend_recommendation'
  )
    AND COALESCE(campaign.is_delete, false) = false
  ORDER BY campaign.id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'smoke test requires one eligible Zalo campaign';
  END IF;

  BEGIN
    PERFORM *
    FROM public.aka_agent_prepare_zalo_message_opt_out(
      v_campaign_id, v_account_id, v_staff_id, '0900000000', NULL
    );
    RAISE EXCEPTION 'prepare accepted a missing global ID';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'zalo_global_id_required' THEN
        RAISE;
      END IF;
  END;

  SELECT prepared.id, prepared.is_opted_out
  INTO v_first_id, v_opted_out
  FROM public.aka_agent_prepare_zalo_message_opt_out(
    v_campaign_id, v_account_id, v_staff_id, '0900000000', 'codex-opt-out-smoke-global'
  ) AS prepared;
  IF v_first_id IS NULL OR v_opted_out THEN
    RAISE EXCEPTION 'first prepare did not return a pending UUID';
  END IF;

  SELECT prepared.id
  INTO v_second_id
  FROM public.aka_agent_prepare_zalo_message_opt_out(
    v_campaign_id, v_account_id, v_staff_id, '+84900000000', 'codex-opt-out-smoke-global'
  ) AS prepared;
  IF v_second_id IS DISTINCT FROM v_first_id THEN
    RAISE EXCEPTION 'prepare did not reuse the same UUID';
  END IF;

  SELECT checked.is_opted_out, checked.matched_by
  INTO v_opted_out, v_matched_by
  FROM public.aka_agent_check_zalo_message_opt_out(
    v_campaign_id, v_account_id, v_staff_id, '0900000000', 'codex-opt-out-smoke-global'
  ) AS checked;
  IF v_opted_out OR v_matched_by IS NOT NULL THEN
    RAISE EXCEPTION 'unconfirmed row blocked delivery';
  END IF;

  SELECT inspected.state INTO v_state
  FROM public.aka_agent_inspect_zalo_message_opt_out(v_first_id) AS inspected;
  IF v_state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'inspect did not return pending';
  END IF;

  SELECT confirmed.state INTO v_state
  FROM public.aka_agent_confirm_zalo_message_opt_out(v_first_id) AS confirmed;
  SELECT opt_out.confirmed_at INTO v_confirmed_at
  FROM public.auto_zalo_message_opt_outs AS opt_out
  WHERE opt_out.id = v_first_id;
  IF v_state IS DISTINCT FROM 'confirmed' OR v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'confirm did not set confirmed_at';
  END IF;

  PERFORM * FROM public.aka_agent_confirm_zalo_message_opt_out(v_first_id);
  IF (SELECT opt_out.confirmed_at FROM public.auto_zalo_message_opt_outs AS opt_out WHERE opt_out.id = v_first_id)
    IS DISTINCT FROM v_confirmed_at THEN
    RAISE EXCEPTION 'confirm was not idempotent';
  END IF;

  SELECT checked.is_opted_out, checked.matched_by
  INTO v_opted_out, v_matched_by
  FROM public.aka_agent_check_zalo_message_opt_out(
    v_campaign_id, v_account_id, v_staff_id, '0911111111', 'codex-opt-out-smoke-global'
  ) AS checked;
  IF NOT v_opted_out OR v_matched_by IS DISTINCT FROM 'zalo_global_id' THEN
    RAISE EXCEPTION 'global-ID fallback did not block after phone miss';
  END IF;

  UPDATE public.auto_zalo_message_opt_outs
  SET confirmed_at = NULL
  WHERE id = v_first_id;
  SELECT inspected.state INTO v_state
  FROM public.aka_agent_inspect_zalo_message_opt_out(v_first_id) AS inspected;
  IF v_state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'admin reset did not restore pending state';
  END IF;
END;
$smoke$;

ROLLBACK;
