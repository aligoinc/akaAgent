CREATE OR REPLACE FUNCTION public.aka_agent_cleanup_failed_campaign_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_runtime_unit_token uuid, p_unstarted_input_data_ids bigint[], p_note text, p_pause_unknown_outcome boolean, p_campaign_status text DEFAULT NULL::text, p_account_status text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint;
  v_optimistic_ids bigint[];
  v_ids bigint[];
  v_parent uuid;
  v_unit uuid;
  v_account_token uuid;
  v_target text;
  v_claim_date date;
  v_claim_at timestamptz;
  v_unit_date date;
  v_unit_at timestamptz;
  v_campaign_status text;
  v_account_status text;
  v_now timestamptz := clock_timestamp();
  v_unstarted bigint[] := COALESCE(p_unstarted_input_data_ids, ARRAY[]::bigint[]);
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop', 'server')
    OR p_runtime_claim_token IS NULL OR p_pause_unknown_outcome IS NULL
    OR cardinality(v_unstarted) > 50 OR array_position(v_unstarted, NULL) IS NOT NULL
    OR (p_campaign_status IS NOT NULL AND p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng'))
    OR (p_account_status IS NOT NULL AND p_account_status NOT IN ('chờ xử lý', 'tạm dừng'))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid failure cleanup payload';
  END IF;

  -- Like v2 settlement, cleanup survives entitlement/subtype changes, but
  -- requires the original opaque token and tenant scope under invoker RLS.
  SELECT staff.organization_id INTO v_org
  FROM public.org_staff staff WHERE staff.id = p_staff_id FOR SHARE OF staff;
  IF NOT FOUND OR v_org IS NULL THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
  SELECT c.runtime_unit_input_data_ids INTO v_optimistic_ids
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org);
  PERFORM d.id FROM public.auto_campaign_input_data d
  WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_optimistic_ids)
  ORDER BY d.id FOR UPDATE OF d;

  SELECT c.runtime_claim_token, c.runtime_claim_target, c.runtime_claim_vietnam_date, c.runtime_claimed_at,
    c.runtime_unit_token, c.runtime_unit_vietnam_date, c.runtime_unit_claimed_at, c.runtime_unit_input_data_ids,
    c.status, a.status, a.runtime_operation_claim_token
  INTO v_parent, v_target, v_claim_date, v_claim_at, v_unit, v_unit_date, v_unit_at, v_ids,
    v_campaign_status, v_account_status, v_account_token
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org)
  FOR UPDATE OF c, a;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'; RETURN;
  END IF;

  IF (v_parent IS NOT NULL AND v_parent <> p_runtime_claim_token)
    OR (v_account_token IS NOT NULL AND v_account_token <> p_runtime_claim_token)
    OR (v_unit IS NOT NULL AND v_unit IS DISTINCT FROM p_runtime_unit_token)
    OR (v_parent IS NOT NULL AND v_target IS DISTINCT FROM p_runtime_target)
  THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  IF v_ids IS DISTINCT FROM v_optimistic_ids
    OR (v_parent IS NOT NULL AND (v_claim_date IS NULL OR v_claim_at IS NULL))
    OR (v_parent IS NULL AND (v_target IS NOT NULL OR v_claim_date IS NOT NULL OR v_claim_at IS NOT NULL))
    OR (v_unit IS NOT NULL AND (v_unit_date IS NULL OR v_unit_at IS NULL OR v_ids IS NULL OR cardinality(v_ids) > 50))
    OR (v_unit IS NULL AND (v_unit_date IS NOT NULL OR v_unit_at IS NOT NULL OR v_ids IS NOT NULL))
    OR (v_campaign_status = 'đang chạy' AND v_parent IS DISTINCT FROM p_runtime_claim_token)
    OR (v_account_status = 'đang chạy' AND v_account_token IS DISTINCT FROM p_runtime_claim_token)
  THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;
  IF v_parent IS NULL AND v_unit IS NULL AND v_account_token IS NULL THEN
    -- A committed response can be lost. This branch performs no writes and
    -- cannot release a new owner, including a tokenless legacy running row.
    RETURN QUERY SELECT true, 'already_cleaned'; RETURN;
  END IF;
  IF v_unit IS NOT NULL AND NOT (v_unstarted <@ v_ids) THEN
    RETURN QUERY SELECT false, 'invalid_unstarted_ids'; RETURN;
  END IF;
  IF v_unit IS NULL AND cardinality(v_unstarted) > 0 THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;

  IF v_unit IS NOT NULL THEN
    UPDATE public.auto_campaign_input_data d
    SET status = CASE WHEN d.id = ANY(v_unstarted) THEN 'chờ xử lý' ELSE 'hoàn thành' END,
      date_action = CASE WHEN d.id = ANY(v_unstarted) THEN NULL ELSE d.date_action END,
      note = CASE WHEN d.id = ANY(v_unstarted) THEN d.note
        ELSE left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000) || ' — Kết quả chưa xác nhận; không tự gửi lại.' END
    WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_ids)
      AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND NOT (d.id = ANY(v_unstarted))));
    -- An inner error/pause handler may have requeued a started input before its
    -- next write failed. Its still-owned lease proves it cannot be sent again.
    -- Already paused/completed inputs are deliberately untouched.
    PERFORM private.facebook_random_unit_settled(p_campaign_id,p_account_id,p_runtime_unit_token,p_pause_unknown_outcome);
    UPDATE public.auto_campaigns c
    SET runtime_unit_token = NULL, runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL, runtime_unit_input_data_ids = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_unit_token = p_runtime_unit_token;
  END IF;

  IF v_parent = p_runtime_claim_token THEN
    UPDATE public.auto_campaigns c
    SET status = CASE WHEN p_pause_unknown_outcome THEN 'tạm dừng' ELSE COALESCE(p_campaign_status, 'chờ xử lý') END,
      note = left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000)
        || CASE WHEN p_pause_unknown_outcome THEN ' — Chưa xác định phần đã thực hiện; tạm dừng để kiểm tra.' ELSE '' END,
      updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token AND c.status = 'đang chạy';
    -- The existing server pause trigger preserves the parent tuple on a status
    -- transition. Clear it separately, under the same row lock/transaction.
    UPDATE public.auto_campaigns c
    SET runtime_claim_token = NULL, runtime_claim_target = NULL,
      runtime_claim_vietnam_date = NULL, runtime_claimed_at = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token;
  END IF;
  IF v_account_token = p_runtime_claim_token THEN
    UPDATE public.auto_accounts a
    SET status = CASE WHEN a.status = 'đang chạy' THEN COALESCE(p_account_status, 'chờ xử lý') ELSE a.status END,
      runtime_operation_claim_token = NULL, updated_at = v_now
    WHERE a.id = p_account_id AND a.staff_id = p_staff_id
      AND a.runtime_operation_claim_token = p_runtime_claim_token;
  END IF;
  RETURN QUERY SELECT true, 'cleaned';
END;
$function$
;
