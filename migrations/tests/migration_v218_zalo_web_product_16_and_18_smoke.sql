-- Rollback smoke test for migration_v218_zalo_web_product_16_and_18.sql.
-- It validates one global newest effective Product 16/18 row, id tie-breaking,
-- QR baseline + optional Web, and that older rows never aggregate capability
-- or quota into the selected row.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.org_organization_product'::regclass
      AND conname = 'chk_org_product_zalo_show_web_product18'
  ) THEN
    RAISE EXCEPTION 'v218_smoke: Product 18-only Zalo Web constraint still exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.org_organization_product'::regclass
      AND conname = 'chk_org_product_zalo_show_web_product16_18'
      AND convalidated = true
  ) THEN
    RAISE EXCEPTION 'v218_smoke: Product 16/18 Zalo Web constraint is missing';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.resolve_organization_zalo_runtime_mode(bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v218_smoke: Zalo runtime resolver is missing';
  END IF;
END;
$preflight$;

-- Keep the rollback-only fixture isolated from concurrent entitlement writers.
LOCK TABLE public.org_organization_product IN SHARE ROW EXCLUSIVE MODE;

-- A fresh migration.sql schema still has the legacy organization-wide unique
-- index. Drop it only inside this transaction so the resolver can be exercised
-- with concurrent Product 16/18 rows; ROLLBACK restores the original schema.
DROP INDEX IF EXISTS public.uq_active_subscription_per_org;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_package_id bigint;
  v_p16_id bigint;
  v_p18_id bigint;
  v_selected_xmin text;
  v_expected_revision text;
  v_tie_created_at timestamptz;
  v_test_limit integer;
  v_mode record;
  v_staff_mode jsonb;
  v_null_product_rejected boolean := false;
  v_non_zalo_product_rejected boolean := false;
BEGIN
  SELECT staff.id, staff.organization_id
  INTO v_staff_id, v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1
  FOR UPDATE OF staff;

  SELECT package.id
  INTO v_package_id
  FROM public.org_product_package AS package
  ORDER BY package.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_package_id IS NULL THEN
    RAISE EXCEPTION 'v218_smoke: active staff or product package missing; cannot run behavioral fixture';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  UPDATE public.org_organization_product
  SET is_deleted = true
  WHERE organization_id = v_organization_id;

  -- Web is limited to Product 16/18, including when a row is already deleted.
  BEGIN
    INSERT INTO public.org_organization_product (
      organization_id, product_package_id, product_id, product_name,
      package_name, package_type, max_accounts, max_sends_per_day,
      expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
    ) VALUES (
      v_organization_id, v_package_id, NULL, '__v218_null_product__',
      '__v218__', 'month', 1, 100, now() + interval '10 years',
      now(), true, false, true
    );
  EXCEPTION WHEN check_violation THEN
    v_null_product_rejected := true;
  END;
  IF NOT v_null_product_rejected THEN
    RAISE EXCEPTION 'v218_smoke: NULL product accepted is_zalo_show_web=true';
  END IF;

  BEGIN
    INSERT INTO public.org_organization_product (
      organization_id, product_package_id, product_id, product_name,
      package_name, package_type, max_accounts, max_sends_per_day,
      expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
    ) VALUES (
      v_organization_id, v_package_id, 17, '__v218_non_zalo_product__',
      '__v218__', 'month', 1, 100, now() + interval '10 years',
      now(), true, false, true
    );
  EXCEPTION WHEN check_violation THEN
    v_non_zalo_product_rejected := true;
  END;
  IF NOT v_non_zalo_product_rejected THEN
    RAISE EXCEPTION 'v218_smoke: non-Zalo product accepted is_zalo_show_web=true';
  END IF;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.entitlement_id IS NOT NULL
    OR v_mode.product_id IS NOT NULL
    OR v_mode.max_sends_per_day IS NOT NULL
    OR v_mode.max_accounts IS NOT NULL
    OR v_mode.qr_enabled IS DISTINCT FROM false
    OR v_mode.web_enabled IS DISTINCT FROM false
    OR v_mode.is_zalo_server IS DISTINCT FROM false
    OR v_mode.mode_revision IS DISTINCT FROM 'none:' || v_organization_id::text
  THEN
    RAISE EXCEPTION 'v218_smoke: empty entitlement resolved incorrectly: %', row_to_json(v_mode);
  END IF;

  -- Older Product 16 requests Web and has larger quotas. Newer Product 18 is
  -- QR-only. Every returned field/capability must come from Product 18 alone.
  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
  ) VALUES (
    v_organization_id, v_package_id, 16, '__v218_p16_older_web__',
    '__v218_p16__', 'demo', 99, 900, now() + interval '10 years',
    now() - interval '2 hours', false, true, true
  ) RETURNING id INTO v_p16_id;

  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
  ) VALUES (
    v_organization_id, v_package_id, 18, '__v218_p18_newer_qr__',
    '__v218_p18__', 'month', 4, 400, now() + interval '10 years',
    now() - interval '1 hour', false, true, false
  ) RETURNING id INTO v_p18_id;

  SELECT entitlement.xmin::text
  INTO v_selected_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.id = v_p18_id;
  v_expected_revision := v_p18_id::text || ':' || v_selected_xmin;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.entitlement_id IS DISTINCT FROM v_p18_id
    OR v_mode.product_id IS DISTINCT FROM 18::bigint
    OR v_mode.product_name IS DISTINCT FROM '__v218_p18_newer_qr__'
    OR v_mode.package_name IS DISTINCT FROM '__v218_p18__'
    OR v_mode.package_type IS DISTINCT FROM 'month'
    OR v_mode.max_accounts IS DISTINCT FROM 4
    OR v_mode.max_sends_per_day IS DISTINCT FROM 400
    OR v_mode.qr_enabled IS DISTINCT FROM true
    OR v_mode.web_enabled IS DISTINCT FROM false
    OR v_mode.is_zalo_server IS DISTINCT FROM true
    OR v_mode.mode_revision IS DISTINCT FROM v_expected_revision
  THEN
    RAISE EXCEPTION 'v218_smoke: older Product 16 leaked into newer Product 18: %', row_to_json(v_mode);
  END IF;

  v_staff_mode := public.get_staff_zalo_runtime_mode(v_staff_id);
  IF COALESCE((v_staff_mode->>'zalo_qr_enabled')::boolean, false) IS DISTINCT FROM true
    OR COALESCE((v_staff_mode->>'zalo_web_enabled')::boolean, false) IS DISTINCT FROM false
    OR COALESCE((v_staff_mode->>'is_zalo_server')::boolean, false) IS DISTINCT FROM true
    OR v_staff_mode->>'revision' IS DISTINCT FROM v_expected_revision
  THEN
    RAISE EXCEPTION 'v218_smoke: staff mode did not expose the one selected row: %', v_staff_mode;
  END IF;

  -- Equal created_at values are resolved only by id DESC. Product 18 was
  -- inserted second, so the older Product 16 Web flag still must not aggregate.
  v_tie_created_at := now() - interval '30 minutes';
  UPDATE public.org_organization_product
  SET created_at = v_tie_created_at
  WHERE id IN (v_p16_id, v_p18_id);

  IF v_p18_id <= v_p16_id THEN
    RAISE EXCEPTION 'v218_smoke: fixture IDs do not preserve insert order';
  END IF;

  SELECT entitlement.xmin::text
  INTO v_selected_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.id = v_p18_id;
  v_expected_revision := v_p18_id::text || ':' || v_selected_xmin;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.entitlement_id IS DISTINCT FROM v_p18_id
    OR v_mode.web_enabled IS DISTINCT FROM false
    OR v_mode.is_zalo_server IS DISTINCT FROM true
    OR v_mode.max_accounts IS DISTINCT FROM 4
    OR v_mode.max_sends_per_day IS DISTINCT FROM 400
    OR v_mode.mode_revision IS DISTINCT FROM v_expected_revision
  THEN
    RAISE EXCEPTION 'v218_smoke: global id DESC tie-break mismatch: %', row_to_json(v_mode);
  END IF;

  -- Product 16 can itself be the single winner. Its true flag adds Web while
  -- QR remains enabled and Web suppresses only the effective Server mode.
  UPDATE public.org_organization_product
  SET created_at = v_tie_created_at + interval '1 second'
  WHERE id = v_p16_id;

  SELECT entitlement.xmin::text
  INTO v_selected_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.id = v_p16_id;
  v_expected_revision := v_p16_id::text || ':' || v_selected_xmin;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.entitlement_id IS DISTINCT FROM v_p16_id
    OR v_mode.product_id IS DISTINCT FROM 16::bigint
    OR v_mode.max_accounts IS DISTINCT FROM 99
    OR v_mode.max_sends_per_day IS DISTINCT FROM 900
    OR v_mode.qr_enabled IS DISTINCT FROM true
    OR v_mode.web_enabled IS DISTINCT FROM true
    OR v_mode.is_zalo_server IS DISTINCT FROM false
    OR v_mode.mode_revision IS DISTINCT FROM v_expected_revision
  THEN
    RAISE EXCEPTION 'v218_smoke: newest Product 16 Web row mismatch: %', row_to_json(v_mode);
  END IF;

  -- Product 18 may also opt into Web. Make it newest again and verify its own
  -- flag controls the result without consulting Product 16.
  UPDATE public.org_organization_product
  SET created_at = v_tie_created_at + interval '2 seconds',
      is_zalo_show_web = true
  WHERE id = v_p18_id;

  SELECT entitlement.xmin::text
  INTO v_selected_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.id = v_p18_id;
  v_expected_revision := v_p18_id::text || ':' || v_selected_xmin;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.entitlement_id IS DISTINCT FROM v_p18_id
    OR v_mode.product_id IS DISTINCT FROM 18::bigint
    OR v_mode.qr_enabled IS DISTINCT FROM true
    OR v_mode.web_enabled IS DISTINCT FROM true
    OR v_mode.is_zalo_server IS DISTINCT FROM false
    OR v_mode.mode_revision IS DISTINCT FROM v_expected_revision
  THEN
    RAISE EXCEPTION 'v218_smoke: newest Product 18 Web row mismatch: %', row_to_json(v_mode);
  END IF;

  -- A newer but ineffective row is ignored. Once Product 18 expires, Product
  -- 16 becomes the sole selected row; there is still no cross-row aggregation.
  UPDATE public.org_organization_product
  SET expiration_date = now() - interval '1 day'
  WHERE id = v_p18_id;

  SELECT entitlement.xmin::text
  INTO v_selected_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.id = v_p16_id;
  v_expected_revision := v_p16_id::text || ':' || v_selected_xmin;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.entitlement_id IS DISTINCT FROM v_p16_id
    OR v_mode.product_id IS DISTINCT FROM 16::bigint
    OR v_mode.max_accounts IS DISTINCT FROM 99
    OR v_mode.max_sends_per_day IS DISTINCT FROM 900
    OR v_mode.qr_enabled IS DISTINCT FROM true
    OR v_mode.web_enabled IS DISTINCT FROM true
    OR v_mode.is_zalo_server IS DISTINCT FROM false
    OR v_mode.mode_revision IS DISTINCT FROM v_expected_revision
  THEN
    RAISE EXCEPTION 'v218_smoke: ineffective newer row affected selection: %', row_to_json(v_mode);
  END IF;

  -- Quota fallback is evaluated from the selected row only. Demo defaults to
  -- 30 for both NULL and nonpositive values; paid packages remain unlimited.
  UPDATE public.org_organization_product
  SET package_type = 'demo'
  WHERE id = v_p16_id;

  FOREACH v_test_limit IN ARRAY ARRAY[NULL::integer, 0] LOOP
    UPDATE public.org_organization_product
    SET max_sends_per_day = v_test_limit
    WHERE id = v_p16_id;

    SELECT * INTO v_mode
    FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
    IF v_mode.entitlement_id IS DISTINCT FROM v_p16_id
      OR v_mode.max_sends_per_day IS DISTINCT FROM 30
    THEN
      RAISE EXCEPTION 'v218_smoke: selected demo quota fallback mismatch for %: %',
        v_test_limit, row_to_json(v_mode);
    END IF;
  END LOOP;

  UPDATE public.org_organization_product
  SET package_type = 'month'
  WHERE id = v_p16_id;

  FOREACH v_test_limit IN ARRAY ARRAY[NULL::integer, 0] LOOP
    UPDATE public.org_organization_product
    SET max_sends_per_day = v_test_limit
    WHERE id = v_p16_id;

    SELECT * INTO v_mode
    FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
    IF v_mode.entitlement_id IS DISTINCT FROM v_p16_id
      OR v_mode.max_sends_per_day IS NOT NULL
    THEN
      RAISE EXCEPTION 'v218_smoke: selected paid quota fallback mismatch for %: %',
        v_test_limit, row_to_json(v_mode);
    END IF;
  END LOOP;

  -- Restore Product 18's expiry but soft-delete it with a newer timestamp.
  -- Product 16 must remain the winner and keep its own paid quota semantics.
  UPDATE public.org_organization_product
  SET expiration_date = now() + interval '10 years',
      created_at = v_tie_created_at + interval '3 seconds',
      is_deleted = true,
      package_type = 'demo',
      max_sends_per_day = 777
  WHERE id = v_p18_id;

  SELECT entitlement.xmin::text
  INTO v_selected_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.id = v_p16_id;
  v_expected_revision := v_p16_id::text || ':' || v_selected_xmin;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_mode.entitlement_id IS DISTINCT FROM v_p16_id
    OR v_mode.product_id IS DISTINCT FROM 16::bigint
    OR v_mode.package_type IS DISTINCT FROM 'month'
    OR v_mode.max_sends_per_day IS NOT NULL
    OR v_mode.qr_enabled IS DISTINCT FROM true
    OR v_mode.web_enabled IS DISTINCT FROM true
    OR v_mode.is_zalo_server IS DISTINCT FROM false
    OR v_mode.mode_revision IS DISTINCT FROM v_expected_revision
  THEN
    RAISE EXCEPTION 'v218_smoke: newer soft-deleted row affected fallback: %', row_to_json(v_mode);
  END IF;
END;
$behavior$;

ROLLBACK;
