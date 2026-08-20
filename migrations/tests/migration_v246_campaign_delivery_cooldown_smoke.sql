-- Run only after migration_v246_campaign_delivery_cooldown.sql.
-- All fixtures and cooldown status mutations are rolled back.

BEGIN;
SET LOCAL statement_timeout = '2min';

DO $smoke$
DECLARE
  v_staff_id bigint;
  v_org_id bigint;
  v_account_id bigint;
  v_other_account_id bigint;
  v_source_campaign_id bigint;
  v_target_campaign_id bigint;
  v_source_input_id bigint;
  v_source_exact_input_id bigint;
  v_blocked_id bigint;
  v_duplicate_id bigint;
  v_exact_id bigint;
  v_first_new_id bigint;
  v_second_new_id bigint;
  v_nonpending_id bigint;
  v_decision text;
  v_status text;
  v_today_start timestamptz := (
    pg_catalog.timezone('Asia/Ho_Chi_Minh', pg_catalog.clock_timestamp())::date::timestamp
    AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  SELECT a.staff_id, a.organization_id, a.id
  INTO v_staff_id, v_org_id, v_account_id
  FROM public.auto_accounts AS a
  JOIN public.org_staff AS s
    ON s.id = a.staff_id
   AND s.organization_id = a.organization_id
   AND s.is_active = true
  WHERE COALESCE(a.is_delete, false) = false
    AND a.staff_id IS NOT NULL
    AND a.organization_id IS NOT NULL
  ORDER BY a.id
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'v246 smoke: no active tenant account available';
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, staff_id, organization_id, extra_settings
  ) VALUES (
    '_v246_smoke_sms_source', 'sms_send', v_account_id, 'hoàn thành', v_staff_id, v_org_id, '{}'::jsonb
  ) RETURNING id INTO v_source_campaign_id;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, staff_id, organization_id, extra_settings
  ) VALUES (
    '_v246_smoke_sms_target', 'sms_send', v_account_id, 'đang chạy', v_staff_id, v_org_id,
    '{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":3}'::jsonb
  ) RETURNING id INTO v_target_campaign_id;

  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status)
  VALUES (v_source_campaign_id, '+84 838 678 421', 'hoàn thành')
  RETURNING id INTO v_source_input_id;

  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status)
  VALUES (v_source_campaign_id, '0901234567', 'hoàn thành')
  RETURNING id INTO v_source_exact_input_id;

  INSERT INTO public.auto_campaign_details (
    campaign_id, account_id, input_data_id, action_name, action_code, status, created_at, is_delete
  ) VALUES
    (v_source_campaign_id, v_account_id, v_source_input_id, 'SMS', 'sms_send', 'đã gửi', v_today_start, true),
    (v_source_campaign_id, v_account_id, v_source_exact_input_id, 'SMS', 'sms_send', 'đã gửi', v_today_start - interval '3 days' + interval '1 hour', false);

  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status) VALUES
    (v_target_campaign_id, '0838678421', 'chờ xử lý') RETURNING id INTO v_blocked_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status) VALUES
    (v_target_campaign_id, '+84 838 678 421', 'chờ xử lý') RETURNING id INTO v_duplicate_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status) VALUES
    (v_target_campaign_id, '0901234567', 'chờ xử lý') RETURNING id INTO v_exact_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status) VALUES
    (v_target_campaign_id, '0912345678', 'chờ xử lý') RETURNING id INTO v_first_new_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status) VALUES
    (v_target_campaign_id, '+84 912 345 678', 'chờ xử lý') RETURNING id INTO v_second_new_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status) VALUES
    (v_target_campaign_id, '0987654321', 'hoàn thành') RETURNING id INTO v_nonpending_id;

  BEGIN
    PERFORM * FROM public.aka_agent_apply_campaign_delivery_cooldown(
      v_target_campaign_id, v_account_id, 9223372036854775000, ARRAY[v_blocked_id]
    );
    RAISE EXCEPTION 'v246_smoke_tenant_isolation_not_enforced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'v246_smoke_tenant_isolation_not_enforced' THEN
      RAISE;
    END IF;
    IF pg_catalog.strpos(SQLERRM, 'campaign_delivery_cooldown_scope_not_found') = 0 THEN
      RAISE EXCEPTION 'v246 smoke: unexpected tenant-isolation error: %', SQLERRM;
    END IF;
  END;

  PERFORM *
  FROM public.aka_agent_apply_campaign_delivery_cooldown(
    v_target_campaign_id,
    v_account_id,
    v_staff_id,
    ARRAY[v_blocked_id, v_duplicate_id, v_exact_id, v_first_new_id, v_second_new_id, v_nonpending_id]
  );

  SELECT r.decision INTO v_decision
  FROM public.aka_agent_apply_campaign_delivery_cooldown(
    v_target_campaign_id, v_account_id, v_staff_id, ARRAY[v_blocked_id]
  ) AS r;
  IF v_decision <> 'not_pending' THEN
    RAISE EXCEPTION 'v246 smoke: CAS/idempotency expected not_pending, got %', v_decision;
  END IF;

  SELECT status INTO v_status FROM public.auto_campaign_input_data WHERE id = v_blocked_id;
  IF v_status <> 'tạm dừng' THEN
    RAISE EXCEPTION 'v246 smoke: same-day target was not paused';
  END IF;
  SELECT status INTO v_status FROM public.auto_campaign_input_data WHERE id = v_duplicate_id;
  IF v_status <> 'chờ xử lý' THEN
    RAISE EXCEPTION 'v246 smoke: in-batch duplicate must remain pending';
  END IF;
  SELECT status INTO v_status FROM public.auto_campaign_input_data WHERE id = v_exact_id;
  IF v_status <> 'chờ xử lý' THEN
    RAISE EXCEPTION 'v246 smoke: exact X-day target must be allowed';
  END IF;
  SELECT status INTO v_status FROM public.auto_campaign_input_data WHERE id = v_second_new_id;
  IF v_status <> 'chờ xử lý' THEN
    RAISE EXCEPTION 'v246 smoke: later new duplicate must remain pending';
  END IF;
  SELECT status INTO v_status FROM public.auto_campaign_input_data WHERE id = v_nonpending_id;
  IF v_status <> 'hoàn thành' THEN
    RAISE EXCEPTION 'v246 smoke: CAS changed a non-pending row';
  END IF;

  -- X=1: a successful send on the previous Vietnam date is eligible today.
  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status)
  VALUES (v_source_campaign_id, '0931234567', 'hoàn thành') RETURNING id INTO v_source_input_id;
  INSERT INTO public.auto_campaign_details (
    campaign_id, account_id, input_data_id, action_name, action_code, status, created_at
  ) VALUES (
    v_source_campaign_id, v_account_id, v_source_input_id, 'SMS', 'sms_send', 'đã gửi',
    v_today_start - interval '1 day'
  );
  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, staff_id, organization_id, extra_settings
  ) VALUES (
    '_v246_smoke_sms_x1', 'sms_send', v_account_id, 'đang chạy', v_staff_id, v_org_id,
    '{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":1}'::jsonb
  ) RETURNING id INTO v_target_campaign_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, phone, status)
  VALUES (v_target_campaign_id, '+84 931 234 567', 'chờ xử lý') RETURNING id INTO v_first_new_id;
  SELECT r.decision INTO v_decision FROM public.aka_agent_apply_campaign_delivery_cooldown(
    v_target_campaign_id, v_account_id, v_staff_id, ARRAY[v_first_new_id]
  ) AS r;
  IF v_decision <> 'allowed' THEN
    RAISE EXCEPTION 'v246 smoke: X=1 must allow a previous-date send: %', v_decision;
  END IF;

  -- Facebook URL/UID normalization and friend/UID shared family.
  INSERT INTO public.auto_campaigns (name, action_id, account_id, status, staff_id, organization_id, extra_settings)
  VALUES ('_v246_smoke_fb_source', 'facebook_message_friend', v_account_id, 'hoàn thành', v_staff_id, v_org_id, '{}')
  RETURNING id INTO v_source_campaign_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, uid, status)
  VALUES (v_source_campaign_id, 'https://www.facebook.com/profile.php?id=123456789', 'hoàn thành')
  RETURNING id INTO v_source_input_id;
  INSERT INTO public.auto_campaign_details (campaign_id, account_id, input_data_id, action_name, action_code, status, created_at)
  VALUES (v_source_campaign_id, v_account_id, v_source_input_id, 'Tin Facebook', 'fb_message_friend', 'thành công', v_today_start);
  INSERT INTO public.auto_campaigns (name, action_id, account_id, status, staff_id, organization_id, extra_settings)
  VALUES ('_v246_smoke_fb_target', 'facebook_message_uid', v_account_id, 'đang chạy', v_staff_id, v_org_id,
    '{"enableMessage":true,"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":1}')
  RETURNING id INTO v_target_campaign_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, uid, status)
  VALUES (v_target_campaign_id, '123456789', 'chờ xử lý') RETURNING id INTO v_blocked_id;
  SELECT r.decision INTO v_decision FROM public.aka_agent_apply_campaign_delivery_cooldown(
    v_target_campaign_id, v_account_id, v_staff_id, ARRAY[v_blocked_id]
  ) AS r;
  IF v_decision <> 'paused_recent_delivery' THEN
    RAISE EXCEPTION 'v246 smoke: Facebook friend/UID normalization failed: %', v_decision;
  END IF;

  -- Zalo person matches by UID alias, independent of phone formatting.
  INSERT INTO public.auto_campaigns (name, action_id, account_id, status, staff_id, organization_id, extra_settings)
  VALUES ('_v246_smoke_zalo_source', 'zalo_message_phone', v_account_id, 'hoàn thành', v_staff_id, v_org_id, '{}')
  RETURNING id INTO v_source_campaign_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, uid, phone, status)
  VALUES (v_source_campaign_id, 'ZaLo-Uid-1', '+84 901 234 567', 'hoàn thành') RETURNING id INTO v_source_input_id;
  INSERT INTO public.auto_campaign_details (campaign_id, account_id, input_data_id, action_name, action_code, status, created_at)
  VALUES (v_source_campaign_id, v_account_id, v_source_input_id, 'Tin Zalo', 'zalo_message_stranger', 'đã nhận', v_today_start);
  INSERT INTO public.auto_campaigns (name, action_id, account_id, status, staff_id, organization_id, extra_settings)
  VALUES ('_v246_smoke_zalo_target', 'zalo_message_friend', v_account_id, 'đang chạy', v_staff_id, v_org_id,
    '{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":1}')
  RETURNING id INTO v_target_campaign_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, uid, status)
  VALUES (v_target_campaign_id, 'zalo-uid-1', 'chờ xử lý') RETURNING id INTO v_blocked_id;
  SELECT r.decision INTO v_decision FROM public.aka_agent_apply_campaign_delivery_cooldown(
    v_target_campaign_id, v_account_id, v_staff_id, ARRAY[v_blocked_id]
  ) AS r;
  IF v_decision <> 'paused_recent_delivery' THEN
    RAISE EXCEPTION 'v246 smoke: Zalo UID alias match failed: %', v_decision;
  END IF;

  -- Email addresses are case-insensitive.
  INSERT INTO public.auto_campaigns (name, action_id, account_id, status, staff_id, organization_id, extra_settings)
  VALUES ('_v246_smoke_email_source', 'email_send', v_account_id, 'hoàn thành', v_staff_id, v_org_id, '{}')
  RETURNING id INTO v_source_campaign_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, email, status)
  VALUES (v_source_campaign_id, 'Customer@Example.COM', 'hoàn thành') RETURNING id INTO v_source_input_id;
  INSERT INTO public.auto_campaign_details (campaign_id, account_id, input_data_id, action_name, action_code, status, created_at)
  VALUES (v_source_campaign_id, v_account_id, v_source_input_id, 'Email', 'email_send', 'đã click', v_today_start);
  INSERT INTO public.auto_campaigns (name, action_id, account_id, status, staff_id, organization_id, extra_settings)
  VALUES ('_v246_smoke_email_target', 'email_send', v_account_id, 'đang chạy', v_staff_id, v_org_id,
    '{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":1}')
  RETURNING id INTO v_target_campaign_id;
  INSERT INTO public.auto_campaign_input_data (campaign_id, email, status)
  VALUES (v_target_campaign_id, 'customer@example.com', 'chờ xử lý') RETURNING id INTO v_blocked_id;
  SELECT r.decision INTO v_decision FROM public.aka_agent_apply_campaign_delivery_cooldown(
    v_target_campaign_id, v_account_id, v_staff_id, ARRAY[v_blocked_id]
  ) AS r;
  IF v_decision <> 'paused_recent_delivery' THEN
    RAISE EXCEPTION 'v246 smoke: lowercase email match failed: %', v_decision;
  END IF;

  -- Same target on another account must not inherit this account's history.
  SELECT a.id INTO v_other_account_id
  FROM public.auto_accounts AS a
  WHERE a.staff_id = v_staff_id
    AND a.organization_id = v_org_id
    AND a.id <> v_account_id
    AND COALESCE(a.is_delete, false) = false
  ORDER BY a.id
  LIMIT 1;
  IF v_other_account_id IS NOT NULL THEN
    INSERT INTO public.auto_campaigns (name, action_id, account_id, status, staff_id, organization_id, extra_settings)
    VALUES ('_v246_smoke_other_account', 'email_send', v_other_account_id, 'đang chạy', v_staff_id, v_org_id,
      '{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":1}')
    RETURNING id INTO v_target_campaign_id;
    INSERT INTO public.auto_campaign_input_data (campaign_id, email, status)
    VALUES (v_target_campaign_id, 'customer@example.com', 'chờ xử lý') RETURNING id INTO v_first_new_id;
    SELECT r.decision INTO v_decision FROM public.aka_agent_apply_campaign_delivery_cooldown(
      v_target_campaign_id, v_other_account_id, v_staff_id, ARRAY[v_first_new_id]
    ) AS r;
    IF v_decision <> 'allowed' THEN
      RAISE EXCEPTION 'v246 smoke: history leaked across accounts: %', v_decision;
    END IF;
  END IF;

  RAISE NOTICE 'v246 cooldown smoke passed';
END;
$smoke$;

ROLLBACK;
