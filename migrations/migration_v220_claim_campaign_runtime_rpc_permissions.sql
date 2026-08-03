-- Keep the scheduler claim executable by Desktop/App Server callers without
-- exposing the v186 Data Group support tables directly.
--
-- v219 added optimistic hard-end checks that joined
-- auto_campaign_data_group_sources from this SECURITY INVOKER function. That
-- table is intentionally RPC-only, so anon/authenticated callers failed before
-- an ordinary campaign could be claimed. The Desktop optimistic branch also
-- called a service-role-only finalizer. Preserve the safe Server wrapper, drop
-- the protected-table read, and leave Desktop hard-end cleanup to the existing
-- tenant sweep plus the post-lock race guard.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_claim_campaign_runtime';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_zalo_server_data_group_finalizer';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.resolve_organization_zalo_account_capabilities(bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_zalo_account_capability_resolver';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_zalo boolean;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Server hard-end cleanup must start before the ordinary campaign/account
  -- claim locks. Candidate discovery uses only caller-readable campaign and
  -- account rows; the SECURITY DEFINER wrapper authoritatively revalidates the
  -- RPC-only Data Group source after joining the common input-first barrier.
  IF v_runtime_target = 'server'
    AND COALESCE(v_capabilities.qr_enabled, false)
    AND COALESCE(v_capabilities.server_enabled, false)
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = campaign.staff_id
      WHERE campaign.id = p_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.account_id = p_account_id
        AND campaign.organization_id = v_organization_id
        AND campaign.data_target_source_mode = 'data_group'
        AND campaign.action_id IN (
          'zalo_message_phone',
          'zalo_join_group_link',
          'zalo_message_friend',
          'zalo_message_group_member',
          'zalo_message_remarketing_customer',
          'zalo_message_group',
          'zalo_add_group_member'
        )
        AND campaign.schedule_end_date IS NOT NULL
        AND campaign.schedule_end_date <= now()
        AND (
          account.organization_id IS NULL
          OR account.organization_id = v_organization_id
        )
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
    )
  THEN
    BEGIN
      PERFORM public.aka_agent_finalize_zalo_server_data_group_campaign(
        p_staff_id,
        v_organization_id,
        v_capabilities.capability_revision,
        p_campaign_id,
        'Chiến dịch đã hết hạn'
      );
    EXCEPTION
      -- The source, campaign or account subtype can change after optimistic
      -- candidate discovery. Those expected races are a rejected
      -- claim, not a scheduler error; the authoritative sweep handles any
      -- remaining hard-end cleanup on its next pass.
      WHEN raise_exception THEN
        IF SQLERRM NOT IN (
          'data_group_server_campaign_not_found',
          'data_group_server_runtime_not_owner'
        ) THEN
          RAISE;
        END IF;
    END;
    RETURN false;
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    THEN RETURN false; END IF;
  ELSIF v_is_zalo AND (
    v_is_server
    OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
    OR (NOT v_is_web AND NOT v_is_server
      AND NOT COALESCE(v_capabilities.qr_enabled, false))
  ) THEN RETURN false; END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.schedule_end_date IS NOT NULL
    AND v_campaign.schedule_end_date <= now()
  THEN
    -- Expiry can race the pre-claim sweep. Do not call a privileged finalizer
    -- while executing as anon/authenticated and do not change either row. The
    -- next tenant sweep completes the hard-end cleanup under its narrow RPC.
    RETURN false;
  END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS NULL
    OR v_campaign.schedule > now()
    OR COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready'
    OR (
      v_campaign.data_target_source_mode = 'data_group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý'
          AND (input_data.schedule IS NULL OR input_data.schedule <= now())
      )
    )
    OR (v_campaign.daily_stop_time IS NOT NULL
      AND v_campaign.daily_stop_time < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN RETURN false; END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.claim_campaign_runtime(bigint, bigint, bigint, text) IS
  'Atomically claim a campaign under caller privileges without reading RPC-only Data Group tables; hard-end cleanup remains behind narrow SECURITY DEFINER wrappers.';

NOTIFY pgrst, 'reload schema';

COMMIT;
