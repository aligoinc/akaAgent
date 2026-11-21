CREATE OR REPLACE FUNCTION public.aka_agent_engine_release_v1(p_account_id bigint, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  l public.auto_engine_leases%ROWTYPE;
  v_open integer;
BEGIN
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = p_account_id AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  SELECT count(*) INTO v_open FROM public.auto_engine_target_runs WHERE account_id = p_account_id AND lease_token = p_lease_token AND completed_at IS NULL;
  IF v_open > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'open_target_runs', 'openRuns', v_open); END IF;
  DELETE FROM public.auto_engine_leases WHERE account_id = p_account_id AND lease_token = p_lease_token;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = l.campaign_id AND status = 'đang chạy' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
  UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = p_account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
  RETURN jsonb_build_object('ok', true,
    'pendingTargets', (SELECT count(*) FROM public.auto_campaign_input_data d WHERE d.campaign_id = l.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false));
END $function$
