-- Explicit selected-input rerun parity with akaAgent CampaignPanel.
-- Derived from live v219 body (no DB-only patches); no signature/ACL/owner changes.
-- Source: 5472937dcee43064392f109d5fb63a34
-- Target: a98a23f8e7f2e1e6582449f7ed45fb45
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $preflight$
DECLARE
  v_oid regprocedure := to_regprocedure('public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)');
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'v269: exact RPC signature missing'; END IF;
  IF md5(pg_get_functiondef(v_oid)) NOT IN ('5472937dcee43064392f109d5fb63a34', 'a98a23f8e7f2e1e6582449f7ed45fb45') THEN
    RAISE EXCEPTION 'v269: live RPC changed; recapture and review before applying';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid
    AND proowner::regrole::text = 'postgres' AND prosecdef AND provolatile = 'v'
    AND proconfig = ARRAY['search_path=pg_catalog, public']
    AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'v269: RPC attributes changed';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.update_control_campaign_input_statuses_atomic(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_input_ids bigint[], p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_input_ids bigint[];
  v_from_statuses text[];
  v_campaign_status text;
  v_account_platform text;
  v_is_zalo_show_web boolean;
  v_is_zalo_server boolean;
  v_updated_count integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0
  THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF p_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_input_status';
  END IF;
  IF p_input_ids IS NULL
    OR cardinality(p_input_ids) < 1
    OR cardinality(p_input_ids) > 5000
    OR EXISTS (
      SELECT 1
      FROM unnest(p_input_ids) AS requested(input_id)
      WHERE requested.input_id IS NULL OR requested.input_id <= 0
    )
  THEN
    RAISE EXCEPTION 'invalid_control_input_ids';
  END IF;

  SELECT array_agg(DISTINCT requested.input_id ORDER BY requested.input_id)
  INTO v_input_ids
  FROM unnest(p_input_ids) AS requested(input_id);
  v_from_statuses := CASE p_status
    WHEN 'tạm dừng' THEN ARRAY['chờ xử lý']
    ELSE ARRAY['tạm dừng', 'hoàn thành']
  END;

  -- Optimistic tenant/owner read. The authoritative check is repeated while
  -- holding both the campaign and account rows below.
  SELECT
    campaign.status,
    account.flatform_type,
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_platform,
    v_is_zalo_show_web,
    v_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'campaign_not_found'
    );
  END IF;
  IF v_account_platform = 'zalo'
    AND (v_is_zalo_show_web OR NOT v_is_zalo_server)
  THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'account_not_server'
    );
  ELSIF v_account_platform NOT IN ('zalo', 'sms') THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'invalid_owner'
    );
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Keep the established input -> campaign -> account lock order shared with
  -- SMS completion recording and the other control-web mutations.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND input_data.id = ANY(v_input_ids)
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT
    campaign.status,
    account.flatform_type,
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_platform,
    v_is_zalo_show_web,
    v_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'campaign_not_found'
    );
  END IF;
  IF v_account_platform = 'zalo'
    AND (v_is_zalo_show_web OR NOT v_is_zalo_server)
  THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'account_not_server'
    );
  ELSIF v_account_platform NOT IN ('zalo', 'sms') THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'invalid_owner'
    );
  END IF;
  -- An explicit selected-input rerun matches desktop. This changes input rows
  -- only: it never resumes the campaign or account, including completed campaigns.

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = p_status,
    note = CASE WHEN p_note IS NULL THEN input_data.note ELSE p_note END
  WHERE input_data.campaign_id = p_campaign_id
    AND input_data.id = ANY(v_input_ids)
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = ANY(v_from_statuses);
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'updated', true,
    'updated_count', v_updated_count
  );
END;
$function$;

DO $verify$
BEGIN
  IF md5(pg_get_functiondef('public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)'::regprocedure))
    <> 'a98a23f8e7f2e1e6582449f7ed45fb45' THEN RAISE EXCEPTION 'v269: unexpected target definition'; END IF;
END;
$verify$;
COMMIT;
