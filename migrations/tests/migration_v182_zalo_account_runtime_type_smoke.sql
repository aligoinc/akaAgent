-- Rollback smoke test for migration_v182_zalo_account_runtime_type.sql.
-- It validates the Product 16/Product 18 capability matrix, Web-over-Server
-- precedence, account subtype constraints and QR-only Server ownership.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $preflight$
DECLARE
  v_signature text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_accounts'
      AND column_name = 'is_zalo_show_web'
      AND is_nullable = 'NO' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'v182_smoke: auto_accounts.is_zalo_show_web contract is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.org_organization_product'::regclass
      AND trigger_row.tgname = 'trg_normalize_zalo_runtime_mode_flags'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'v182_smoke: v179 mutually-exclusive flag trigger still exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_accounts'::regclass
      AND conname = 'chk_auto_accounts_zalo_show_web_platform'
      AND convalidated = true
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.org_organization_product'::regclass
      AND conname = 'chk_org_product_zalo_show_web_product18'
      AND convalidated = true
  ) THEN
    RAISE EXCEPTION 'v182_smoke: subtype/product constraints are missing';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.resolve_organization_zalo_runtime_mode(bigint)',
    'public.get_staff_zalo_runtime_mode(bigint)',
    'public.discover_zalo_server_runtime_users(bigint,integer)',
    'public.inspect_staff_zalo_running_state(bigint)',
    'public.reset_desktop_running_statuses(bigint,boolean,boolean)',
    'public.recover_server_zalo_running_state(bigint,text,boolean)',
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)',
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)',
    'public.release_zalo_account_runtime_operation(bigint,bigint,text,text)',
    'public.aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)',
    'public.aka_agent_set_zalo_server_account_status(bigint,bigint,text)',
    'public.aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)',
    'public.aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])',
    'public.aka_agent_finalize_zalo_server_campaign(bigint,bigint,text,boolean)',
    'public.aka_agent_advance_zalo_server_multi_daily_slot(bigint,bigint,bigint,timestamptz)',
    'public.enqueue_campaign_zalo_realtime_group_event(bigint,bigint,bigint,text,text,text,text,text,text,timestamptz,timestamptz,jsonb)',
    'public.create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)',
    'public.aka_agent_authenticate_control_session(text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v182_smoke: missing RPC %', v_signature;
    END IF;
  END LOOP;
END;
$preflight$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_package_id bigint;
  v_p16_id bigint;
  v_p18_id bigint;
  v_qr_account_id bigint;
  v_web_account_id bigint;
  v_created_account_id bigint;
  v_legacy_qr_account_id bigint;
  v_mode record;
  v_result jsonb;
  v_discovery jsonb;
  v_control record;
  v_constraint_rejected boolean;
BEGIN
  SELECT staff.id, staff.organization_id
  INTO v_staff_id, v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1
  FOR UPDATE OF staff;

  SELECT package.id INTO v_package_id
  FROM public.org_product_package AS package
  ORDER BY package.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_package_id IS NULL THEN
    RAISE NOTICE 'v182_smoke: active staff or product package missing; behavioral fixture skipped';
    RETURN;
  END IF;

  -- Isolate this organization inside the rollback-only transaction.
  UPDATE public.org_organization_product
  SET is_deleted = true
  WHERE organization_id = v_organization_id AND product_id IN (16, 18);
  UPDATE public.auto_accounts
  SET is_delete = true
  WHERE staff_id = v_staff_id
    AND (organization_id IS NULL OR organization_id = v_organization_id)
    AND lower(btrim(COALESCE(flatform_type, ''))) = 'zalo';

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.qr_enabled OR v_mode.web_enabled OR v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke E0: empty entitlement must grant no Zalo capability';
  END IF;

  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
  ) VALUES (
    v_organization_id, v_package_id, 16, '__v182_p16__',
    '__v182__', 'month', 2, 100, now() + interval '10 years',
    now() + interval '100 years', false, false, false
  ) RETURNING id INTO v_p16_id;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR v_mode.is_zalo_server
    OR v_mode.max_accounts <> 2 OR v_mode.max_sends_per_day <> 100
  THEN RAISE EXCEPTION 'v182_smoke E1/R0: Product 16 local matrix mismatch: %', row_to_json(v_mode); END IF;

  UPDATE public.org_organization_product SET is_zalo_server = true WHERE id = v_p16_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR NOT v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke R1: Product 16 Server matrix mismatch';
  END IF;

  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
  ) VALUES (
    v_organization_id, v_package_id, 18, '__v182_p18__',
    '__v182__', 'month', 5, 300, now() + interval '10 years',
    now() + interval '101 years', false, true, true
  ) RETURNING id INTO v_p18_id;

  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR NOT v_mode.web_enabled OR v_mode.is_zalo_server
    OR v_mode.max_accounts <> 5 OR v_mode.max_sends_per_day <> 300
  THEN RAISE EXCEPTION 'v182_smoke E5/R3: simultaneous QR/Web or max-limit matrix mismatch'; END IF;
  IF NOT (SELECT is_zalo_server FROM public.org_organization_product WHERE id = v_p18_id) THEN
    RAISE EXCEPTION 'v182_smoke R3: Web precedence must preserve stored Server flag';
  END IF;

  UPDATE public.org_organization_product
  SET is_zalo_server = false
  WHERE id IN (v_p16_id, v_p18_id);
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR NOT v_mode.web_enabled OR v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke R2: Web/local matrix mismatch';
  END IF;
  UPDATE public.org_organization_product SET is_zalo_server = true WHERE id = v_p18_id;

  UPDATE public.org_organization_product SET is_deleted = true WHERE id = v_p16_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.qr_enabled OR NOT v_mode.web_enabled OR v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke E3: Product 18 Web-only matrix mismatch';
  END IF;

  UPDATE public.org_organization_product SET is_zalo_show_web = false WHERE id = v_p18_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR NOT v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke E2/R1: Product 18 QR/Server matrix mismatch';
  END IF;

  UPDATE public.org_organization_product SET is_deleted = false WHERE id = v_p16_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled THEN
    RAISE EXCEPTION 'v182_smoke E4: Product 16 + Product 18 QR matrix mismatch';
  END IF;

  -- A newer active row must win independently inside each product. Values on
  -- older rows must not leak into capability or limit aggregation.
  -- Production enforces one non-deleted subscription per organization/product,
  -- so archive the previous effective rows before creating their replacements.
  UPDATE public.org_organization_product
  SET is_deleted = true
  WHERE organization_id = v_organization_id
    AND product_id IN (16, 18);

  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
  ) VALUES (
    v_organization_id, v_package_id, 16, '__v182_p16_newest__',
    '__v182__', 'month', 4, 400, now() + interval '10 years',
    now() + interval '200 years', false, false, false
  ) RETURNING id INTO v_p16_id;
  UPDATE public.org_organization_product
  SET max_accounts = 999, max_sends_per_day = 999, is_zalo_server = true
  WHERE organization_id = v_organization_id AND product_id = 16 AND id <> v_p16_id;

  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
  ) VALUES (
    v_organization_id, v_package_id, 18, '__v182_p18_newest__',
    '__v182__', 'month', 6, 600, now() + interval '10 years',
    now() + interval '201 years', false, true, false
  ) RETURNING id INTO v_p18_id;
  UPDATE public.org_organization_product
  SET max_accounts = 999, max_sends_per_day = 999, is_zalo_show_web = true
  WHERE organization_id = v_organization_id AND product_id = 18 AND id <> v_p18_id;

  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR NOT v_mode.is_zalo_server
    OR v_mode.max_accounts <> 6 OR v_mode.max_sends_per_day <> 600
  THEN
    RAISE EXCEPTION 'v182_smoke: newest-active-per-product resolution leaked an older row: %', row_to_json(v_mode);
  END IF;

  -- Daily limit aggregation must be authoritative for Server: mixed demo +
  -- paid without a positive configured limit is unlimited, while all-demo
  -- without a configured limit uses the shared desktop default (30).
  UPDATE public.org_organization_product
  SET package_type = 'demo', max_sends_per_day = NULL, is_zalo_server = true
  WHERE id = v_p16_id;
  UPDATE public.org_organization_product
  SET package_type = 'month', max_sends_per_day = NULL, is_zalo_server = false
  WHERE id = v_p18_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.max_sends_per_day IS NOT NULL OR v_mode.package_type <> 'month'
    OR NOT v_mode.is_zalo_server
  THEN RAISE EXCEPTION 'v182_smoke: mixed paid/demo unlimited daily limit mismatch: %', row_to_json(v_mode); END IF;

  UPDATE public.org_organization_product SET package_type = 'demo' WHERE id = v_p18_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.max_sends_per_day <> 30 THEN
    RAISE EXCEPTION 'v182_smoke: all-demo daily fallback mismatch: %', row_to_json(v_mode);
  END IF;

  UPDATE public.org_organization_product
  SET package_type = 'month', max_sends_per_day = 400, is_zalo_server = false
  WHERE id = v_p16_id;
  UPDATE public.org_organization_product
  SET package_type = 'month', max_sends_per_day = 600, is_zalo_server = true
  WHERE id = v_p18_id;

  -- Product 16 must never be allowed to carry the Web flag.
  v_constraint_rejected := false;
  BEGIN
    UPDATE public.org_organization_product SET is_zalo_show_web = true WHERE id = v_p16_id;
  EXCEPTION WHEN check_violation THEN
    v_constraint_rejected := true;
  END;
  IF NOT v_constraint_rejected THEN
    RAISE EXCEPTION 'v182_smoke: Product 16 accepted is_zalo_show_web=true';
  END IF;

  INSERT INTO public.auto_accounts (
    name, flatform_type, login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v182_qr__', 'zalo', 'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  ) RETURNING id, is_zalo_show_web INTO v_qr_account_id, v_constraint_rejected;
  IF v_constraint_rejected THEN RAISE EXCEPTION 'v182_smoke: old/default account did not remain QR'; END IF;

  INSERT INTO public.auto_accounts (
    name, flatform_type, is_zalo_show_web, login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v182_web__', 'zalo', true, 'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  ) RETURNING id INTO v_web_account_id;

  v_constraint_rejected := false;
  BEGIN
    INSERT INTO public.auto_accounts (
      name, flatform_type, is_zalo_show_web, login_status, status, is_active,
      staff_id, organization_id, is_delete
    ) VALUES (
      '__v182_invalid__', 'facebook', true, 'chưa đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    );
  EXCEPTION WHEN check_violation THEN
    v_constraint_rejected := true;
  END;
  IF NOT v_constraint_rejected THEN RAISE EXCEPTION 'v182_smoke: non-Zalo Web account was accepted'; END IF;

  -- Server-side quota counts only account subtypes compatible with the live
  -- capability. A hidden Web row must not consume a QR slot. If an old QR row
  -- is restored and pushes the staff over the limit, it stays intact but the
  -- next create is rejected.
  UPDATE public.org_organization_product SET max_accounts = 1 WHERE id IN (v_p16_id, v_p18_id);
  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_qr_account_id;
  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object('name', '__v182_quota_created__', 'isActive', true)
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false) THEN
    RAISE EXCEPTION 'v182_smoke: hidden Web account incorrectly consumed QR quota: %', v_result;
  END IF;
  v_created_account_id := (v_result->>'account_id')::bigint;
  IF (SELECT is_zalo_show_web FROM public.auto_accounts WHERE id = v_created_account_id) THEN
    RAISE EXCEPTION 'v182_smoke: Server control created a Web account';
  END IF;

  -- A legacy staff-scoped QR account without organization_id is still
  -- eligible for this organization and must consume the shared quota.
  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_created_account_id;
  INSERT INTO public.auto_accounts (
    name, flatform_type, login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v182_legacy_qr__', 'zalo', 'chưa đăng nhập', 'chờ xử lý', true,
    v_staff_id, NULL, false
  ) RETURNING id INTO v_legacy_qr_account_id;
  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object('name', '__v182_legacy_quota_blocked__', 'isActive', true)
  );
  IF COALESCE((v_result->>'created')::boolean, false)
    OR v_result->>'reason' <> 'account_limit_reached'
  THEN RAISE EXCEPTION 'v182_smoke: legacy NULL-org QR account did not consume quota: %', v_result; END IF;
  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_legacy_qr_account_id;
  UPDATE public.auto_accounts SET is_delete = false WHERE id = v_created_account_id;

  UPDATE public.auto_accounts SET is_delete = false WHERE id = v_qr_account_id;
  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object('name', '__v182_quota_blocked__', 'isActive', true)
  );
  IF COALESCE((v_result->>'created')::boolean, false)
    OR v_result->>'reason' <> 'account_limit_reached'
  THEN RAISE EXCEPTION 'v182_smoke: restored over-limit QR accounts did not block create: %', v_result; END IF;
  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_created_account_id;
  UPDATE public.org_organization_product SET max_accounts = CASE product_id WHEN 16 THEN 4 ELSE 6 END
  WHERE id IN (v_p16_id, v_p18_id);

  -- Product 18 is QR/Server here: only QR may be discovered and claimed.
  v_discovery := public.discover_zalo_server_runtime_users(0, 1000);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_discovery->'items') AS item
    WHERE (item->>'staff_id')::bigint = v_staff_id
  ) THEN RAISE EXCEPTION 'v182_smoke server_guard: Server discovery missed QR organization'; END IF;

  v_result := public.claim_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'server', true);
  IF COALESCE((v_result->>'claimed')::boolean, false) = false THEN
    RAISE EXCEPTION 'v182_smoke server_guard: Server failed to claim QR account: %', v_result;
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'server', 'chờ xử lý') THEN
    RAISE EXCEPTION 'v182_smoke server_guard: Server failed to release QR account';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'server', true);
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v182_smoke server_guard: Server claimed Web account';
  END IF;

  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_account_status(v_web_account_id, v_staff_id, 'tạm dừng');
  IF COALESCE(v_control.ok, false) THEN RAISE EXCEPTION 'v182_smoke server_guard: Server run-control changed Web account'; END IF;
  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_account_status(v_qr_account_id, v_staff_id, 'tạm dừng');
  IF NOT COALESCE(v_control.ok, false) THEN RAISE EXCEPTION 'v182_smoke server_guard: Server run-control rejected QR account'; END IF;
  UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = v_qr_account_id;

  -- Recovery must settle QR and leave Web untouched.
  UPDATE public.auto_accounts SET status = 'đang chạy'
  WHERE id IN (v_qr_account_id, v_web_account_id);
  v_result := public.inspect_staff_zalo_running_state(v_staff_id);
  IF (v_result->>'accounts_running')::integer <> 1 THEN
    RAISE EXCEPTION 'v182_smoke recovery: running-state inspection counted Web as Server work: %', v_result;
  END IF;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  PERFORM public.recover_server_zalo_running_state(v_staff_id, v_mode.mode_revision, true);
  IF (SELECT status FROM public.auto_accounts WHERE id = v_qr_account_id) <> 'chờ xử lý'
    OR (SELECT status FROM public.auto_accounts WHERE id = v_web_account_id) <> 'đang chạy'
  THEN RAISE EXCEPTION 'v182_smoke recovery: crossed QR/Web ownership boundary'; END IF;
  v_result := public.inspect_staff_zalo_running_state(v_staff_id);
  IF COALESCE((v_result->>'has_running_state')::boolean, false) THEN
    RAISE EXCEPTION 'v182_smoke recovery: Web-only running state kept Server handoff blocked: %', v_result;
  END IF;
  UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = v_web_account_id;

  -- R3: Web wins globally but Product 16 simultaneously keeps QR local.
  UPDATE public.org_organization_product
  SET is_deleted = false, is_zalo_server = true
  WHERE id = v_p16_id;
  UPDATE public.org_organization_product
  SET is_zalo_show_web = true, is_zalo_server = true
  WHERE id = v_p18_id;
  v_discovery := public.discover_zalo_server_runtime_users(0, 1000);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_discovery->'items') AS item
    WHERE (item->>'staff_id')::bigint = v_staff_id
  ) THEN RAISE EXCEPTION 'v182_smoke R3: Web capability did not suppress Server discovery'; END IF;

  v_result := public.claim_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'desktop', true);
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v182_smoke R3: desktop failed to claim QR beside Web: %', v_result;
  END IF;
  PERFORM public.release_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'desktop', 'chờ xử lý');
  v_result := public.claim_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'desktop', true);
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v182_smoke R3: desktop failed to claim Web account: %', v_result;
  END IF;
  PERFORM public.release_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'desktop', 'chờ xử lý');

  -- Release remains cleanup-safe when entitlement changes after a desktop
  -- claim. Hidden Web can never be Server-owned; hidden QR may be released as
  -- long as the live mode did not become Server.
  v_result := public.claim_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'desktop', true);
  UPDATE public.org_organization_product SET is_zalo_show_web = false WHERE id = v_p18_id;
  IF NOT public.release_zalo_account_runtime_operation(
    v_web_account_id, v_staff_id, 'desktop', 'chờ xử lý'
  ) THEN RAISE EXCEPTION 'v182_smoke: desktop could not release Web after it became hidden'; END IF;
  UPDATE public.org_organization_product SET is_zalo_show_web = true WHERE id = v_p18_id;

  v_result := public.claim_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'desktop', true);
  UPDATE public.org_organization_product
  SET is_deleted = true
  WHERE organization_id = v_organization_id AND product_id = 16;
  IF NOT public.release_zalo_account_runtime_operation(
    v_qr_account_id, v_staff_id, 'desktop', 'chờ xử lý'
  ) THEN RAISE EXCEPTION 'v182_smoke: desktop could not release QR after it became hidden'; END IF;

  -- T0: no Product 16, saved Server=false. Turning Product 18 Web off grants
  -- QR local; Web is hidden.
  UPDATE public.org_organization_product
  SET is_zalo_show_web = true, is_zalo_server = false
  WHERE id = v_p18_id;
  UPDATE public.org_organization_product SET is_zalo_show_web = false WHERE id = v_p18_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke T0: Show Web off did not restore local QR';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'desktop', true);
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T0: QR local claim failed'; END IF;
  PERFORM public.release_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'desktop', 'chờ xử lý');
  v_result := public.claim_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'desktop', true);
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T0: hidden Web remained claimable'; END IF;

  -- T1: no Product 16, saved Server=true. Turning Web off restores VPS.
  UPDATE public.org_organization_product
  SET is_zalo_show_web = true, is_zalo_server = true
  WHERE id = v_p18_id;
  UPDATE public.org_organization_product SET is_zalo_show_web = false WHERE id = v_p18_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR NOT v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke T1: saved Server flag did not reactivate';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'server', true);
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T1: Server QR claim failed'; END IF;
  PERFORM public.release_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'server', 'chờ xử lý');
  v_result := public.claim_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'server', true);
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T1: Server claimed hidden Web'; END IF;

  -- T2: Product 16 exists and all saved Server flags are false.
  UPDATE public.org_organization_product SET is_deleted = false, is_zalo_server = false WHERE id = v_p16_id;
  UPDATE public.org_organization_product
  SET is_zalo_show_web = true, is_zalo_server = false
  WHERE id = v_p18_id;
  UPDATE public.org_organization_product SET is_zalo_show_web = false WHERE id = v_p18_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke T2: Product 16 local QR matrix mismatch';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'desktop', true);
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T2: local QR claim failed'; END IF;
  PERFORM public.release_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'desktop', 'chờ xử lý');
  v_result := public.claim_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'desktop', true);
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T2: hidden Web remained claimable'; END IF;

  -- T3: Product 16 exists and a saved Server flag is true.
  UPDATE public.org_organization_product
  SET is_zalo_show_web = true, is_zalo_server = true
  WHERE id = v_p18_id;
  UPDATE public.org_organization_product SET is_zalo_show_web = false WHERE id = v_p18_id;
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT v_mode.qr_enabled OR v_mode.web_enabled OR NOT v_mode.is_zalo_server THEN
    RAISE EXCEPTION 'v182_smoke T3: saved Server flag did not reactivate with Product 16';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'server', true);
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T3: Server QR claim failed'; END IF;
  PERFORM public.release_zalo_account_runtime_operation(v_qr_account_id, v_staff_id, 'server', 'chờ xử lý');
  v_result := public.claim_zalo_account_runtime_operation(v_web_account_id, v_staff_id, 'server', true);
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN RAISE EXCEPTION 'v182_smoke T3: Server claimed hidden Web'; END IF;
END;
$behavior$;

ROLLBACK;
