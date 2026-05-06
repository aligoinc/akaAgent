-- Migration v7: finish channel -> account terminology for package limits.
-- Safe to run after v5/v6; idempotent for already-renamed databases.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'org_product_package' AND column_name = 'max_channel'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'org_product_package' AND column_name = 'max_account'
  ) THEN
    ALTER TABLE public.org_product_package RENAME COLUMN max_channel TO max_account;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'org_organization_product' AND column_name = 'max_channels'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'org_organization_product' AND column_name = 'max_accounts'
  ) THEN
    ALTER TABLE public.org_organization_product RENAME COLUMN max_channels TO max_accounts;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'org_organization_product_history' AND column_name = 'max_channels'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'org_organization_product_history' AND column_name = 'max_accounts'
  ) THEN
    ALTER TABLE public.org_organization_product_history RENAME COLUMN max_channels TO max_accounts;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_organization(
  p_customer_id bigint,
  p_organization_name text,
  p_organization_phone text,
  p_organization_email text,
  p_product_package_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id  BIGINT;
  v_staff_id         BIGINT;
  v_group_id         BIGINT;
  v_customer         RECORD;
  v_package          RECORD;
  v_product          RECORD;
BEGIN
  SELECT * INTO v_customer FROM org_customer WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay customer %', p_customer_id; END IF;

  SELECT * INTO v_package FROM org_product_package WHERE id = p_product_package_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay package %', p_product_package_id; END IF;

  SELECT * INTO v_product FROM org_product WHERE id = v_package.product_id;

  INSERT INTO org_organization (customer_id, name, phone, email, max_staff)
  VALUES (p_customer_id, p_organization_name, p_organization_phone, p_organization_email, v_package.max_staff)
  RETURNING id INTO v_organization_id;

  INSERT INTO org_staff (
    organization_id, customer_id, name, phone, email, username, password
  )
  VALUES (
    v_organization_id,
    p_customer_id,
    v_customer.name,
    v_customer.phone,
    v_customer.email,
    v_organization_id::TEXT || '.' || v_customer.phone,
    '123456'
  )
  RETURNING id INTO v_staff_id;

  UPDATE org_organization
     SET staff_admin_id = v_staff_id
   WHERE id = v_organization_id;

  INSERT INTO org_group (organization_id, parent_id, name)
  VALUES (v_organization_id, NULL, p_organization_name)
  RETURNING id INTO v_group_id;

  INSERT INTO org_group_staff (group_id, staff_id, organization_id, is_admin)
  VALUES (v_group_id, v_staff_id, v_organization_id, TRUE);

  INSERT INTO org_organization_product (
    organization_id, product_package_id,
    organization_phone, organization_email,
    product_id, product_name,
    package_name, package_type, max_accounts, max_staff, duration_days,
    purchase_date, trial_start_date, expiration_date
  )
  VALUES (
    v_organization_id, p_product_package_id,
    p_organization_phone, p_organization_email,
    v_product.id, v_product.name,
    v_package.name, v_package.package_type, v_package.max_account, v_package.max_staff, v_package.duration_days,
    CASE WHEN v_package.package_type <> 'demo' THEN NOW() ELSE NULL END,
    CASE WHEN v_package.package_type = 'demo' THEN NOW() ELSE NULL END,
    NOW() + (v_package.duration_days || ' days')::INTERVAL
  );

  RETURN v_organization_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.change_organization_subscription(
  p_organization_id bigint,
  p_new_product_package_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_current RECORD;
  v_package RECORD;
  v_product RECORD;
  v_new_id  BIGINT;
BEGIN
  SELECT * INTO v_current
    FROM org_organization_product
   WHERE organization_id = p_organization_id AND is_deleted = FALSE;

  IF FOUND THEN
    INSERT INTO org_organization_product_history (
      organization_id, product_package_id, product_id, product_name,
      package_name, package_type, max_accounts, max_staff, duration_days,
      purchase_date, trial_start_date, expiration_date
    ) VALUES (
      v_current.organization_id, v_current.product_package_id, v_current.product_id, v_current.product_name,
      v_current.package_name, v_current.package_type, v_current.max_accounts, v_current.max_staff, v_current.duration_days,
      v_current.purchase_date, v_current.trial_start_date, v_current.expiration_date
    );

    UPDATE org_organization_product SET is_deleted = TRUE WHERE id = v_current.id;
  END IF;

  SELECT * INTO v_package FROM org_product_package WHERE id = p_new_product_package_id;
  SELECT * INTO v_product FROM org_product WHERE id = v_package.product_id;

  INSERT INTO org_organization_product (
    organization_id, product_package_id,
    product_id, product_name, package_name, package_type,
    max_accounts, max_staff, duration_days,
    purchase_date, expiration_date
  )
  VALUES (
    p_organization_id, p_new_product_package_id,
    v_product.id, v_product.name, v_package.name, v_package.package_type,
    v_package.max_account, v_package.max_staff, v_package.duration_days,
    NOW(), NOW() + (v_package.duration_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

COMMENT ON COLUMN public.org_product_package.max_account IS 'Maximum account slots included in this package';
COMMENT ON COLUMN public.org_organization_product.max_accounts IS 'Maximum account slots included in the active organization package';
COMMENT ON COLUMN public.org_organization_product_history.max_accounts IS 'Archived maximum account slots from the organization package';

NOTIFY pgrst, 'reload schema';
