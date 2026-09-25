-- Synthetic rollback only; can follow v321 without its COMMIT for pre-apply validation.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $fixture$
DECLARE fixture_customer bigint; fixture_org bigint; fixture_actor bigint;
BEGIN
  IF EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=321000000001) THEN RAISE EXCEPTION 'v321 fixture ID occupied'; END IF;
  INSERT INTO public.aka_customer(name,phone) VALUES('__facebook_v321_rollback__','0999999321') RETURNING id INTO fixture_customer;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT fixture_customer,'__facebook_v321_rollback__','0999999321',3,id,id FROM public.org_staff
    WHERE organization_id=1 AND is_admin IS TRUE LIMIT 1 RETURNING id INTO fixture_org;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin)
    VALUES(fixture_org,'Facebook v321 fixture','0999999321',true) RETURNING id INTO fixture_actor;
  INSERT INTO public.org_organization_product(organization_id,product_id,product_package_id,expiration_date,max_accounts)
    SELECT fixture_org,3,product_package_id,now()+interval '800 days',50 FROM public.org_organization_product WHERE product_id=3 LIMIT 1;
  INSERT INTO public.auto_accounts(id,name,flatform_type,staff_id,organization_id,is_active,is_delete,login_status,status)
    OVERRIDING SYSTEM VALUE VALUES(321000000001,'FB v321 fixture','facebook',fixture_actor,fixture_org,true,false,'chưa đăng nhập','tạm dừng');
  PERFORM set_config('test.fb_account','321000000001',true);
  PERFORM set_config('test.fb_staff',fixture_actor::text,true);
END $fixture$;
SET LOCAL ROLE anon;
-- Append migration_v321_facebook_login_claim_cancellation_smoke.sql here, then RESET ROLE; ROLLBACK.
