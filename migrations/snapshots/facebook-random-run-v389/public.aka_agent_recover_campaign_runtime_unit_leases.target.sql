CREATE OR REPLACE FUNCTION public.aka_agent_recover_campaign_runtime_unit_leases(p_staff_id bigint, p_runtime_target text, p_platform_scope text DEFAULT 'all'::text)
 RETURNS TABLE(ok boolean, reason text, recovered_lease_count bigint, requeued_input_count bigint, db_now timestamp with time zone, vietnam_date_key date)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_random record;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_platform_scope text := lower(btrim(COALESCE(p_platform_scope, '')));
  v_organization_id bigint;
  v_candidate record;
  v_locked_token uuid;
  v_locked_input_data_ids bigint[];
  v_recovered_lease_count bigint := 0;
  v_requeued_input_count bigint := 0;
  v_row_count bigint := 0;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF v_platform_scope NOT IN ('all', 'zalo') THEN
    RAISE EXCEPTION 'platform scope must be all or zalo';
  END IF;

  -- Startup recovery is cleanup and therefore remains available for an
  -- inactive staff row. The caller must invoke it only after its existing
  -- runtime-specific recovery has proved the scheduler process idle.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', 0::bigint, 0::bigint,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  FOR v_candidate IN
    SELECT campaign.id AS campaign_id,
      campaign.account_id,
      campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(
      v_candidate.campaign_id
    );

    IF cardinality(COALESCE(
      v_candidate.runtime_unit_input_data_ids,
      ARRAY[]::bigint[]
    )) > 0 THEN
      PERFORM input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_candidate.runtime_unit_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
      ORDER BY input_data.id
      FOR UPDATE OF input_data;
    END IF;

    SELECT campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    INTO v_locked_token, v_locked_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.account_id = v_candidate.account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_candidate.runtime_unit_token
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    FOR UPDATE OF campaign, account;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    PERFORM private.facebook_random_unit_recover(v_candidate.campaign_id,v_candidate.account_id,v_locked_token);

    IF cardinality(COALESCE(v_locked_input_data_ids, ARRAY[]::bigint[])) > 0 THEN
      UPDATE public.auto_campaign_input_data AS input_data
      SET status = 'chờ xử lý', date_action = NULL
      WHERE input_data.id = ANY(v_locked_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
        AND input_data.status = 'đang chạy';
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_requeued_input_count := v_requeued_input_count + v_row_count;
    END IF;

    v_now := clock_timestamp();
    UPDATE public.auto_campaigns AS campaign
    SET runtime_unit_token = NULL,
      runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL,
      runtime_unit_input_data_ids = NULL,
      updated_at = v_now
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_locked_token;

    IF FOUND THEN
      v_recovered_lease_count := v_recovered_lease_count + 1;
    END IF;
  END LOOP;

  -- Same startup recovery proof/locks; includes orphan turns when mode is off.
  IF v_runtime_target='desktop' AND v_platform_scope='all' THEN
    FOR v_random IN SELECT * FROM private.facebook_random_orphan_turns(p_staff_id,v_organization_id) ORDER BY id
    LOOP
      PERFORM public.aka_agent_lock_campaign_input_serialization(v_random.id);
      PERFORM 1 FROM public.auto_campaigns cc JOIN public.auto_accounts aa ON aa.id=cc.account_id AND aa.staff_id=cc.staff_id
        WHERE cc.id=v_random.id AND cc.account_id=v_random.account_id AND cc.staff_id=p_staff_id AND aa.flatform_type='facebook'
          AND (cc.organization_id IS NULL OR cc.organization_id=v_organization_id)
          AND (aa.organization_id IS NULL OR aa.organization_id=v_organization_id)
          AND cc.runtime_claim_token IS NULL AND cc.runtime_unit_token IS NULL AND cc.status<>'đang chạy'
        FOR UPDATE OF cc,aa;
      IF FOUND THEN PERFORM private.facebook_random_finalize_turn(v_random.id,v_random.account_id,v_random.claim::uuid,v_random.unit::uuid,true); END IF;
    END LOOP;
  END IF;
  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  RETURN QUERY SELECT
    true, 'recovered', v_recovered_lease_count, v_requeued_input_count,
    v_now, v_vietnam_date;
END;
$function$
;
