-- Synthetic fixtures only. Never commits or starts an external task.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  customer_id bigint; org_id bigint; actor_id bigint; staff_id bigint; package_id bigint;
  actor_username text; staff_username text; result jsonb; row_result jsonb; c record;
  day_start timestamptz:=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
  INSERT INTO public.aka_customer(name) VALUES('__staff_opt_in_v310_rollback__') RETURNING id INTO customer_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__staff_opt_in_v310_rollback__','0999999312',5,s.id,s.id
    FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING id INTO org_id;
  IF (SELECT use_staff_expiration FROM public.org_organization WHERE id=org_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'new organization must default to organization expiry';
  END IF;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin)
    VALUES(org_id,'Admin fixture','0999999312',true) RETURNING id,username INTO actor_id,actor_username;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin,expiration_date)
    VALUES(org_id,'Staff fixture','0999999313',false,day_start-interval '1 day') RETURNING id,username INTO staff_id,staff_username;
  SELECT product_package_id INTO STRICT package_id FROM public.org_organization_product WHERE product_id=17 LIMIT 1;
  INSERT INTO public.org_organization_product(organization_id,product_id,product_package_id,expiration_date,max_accounts)
    VALUES(org_id,17,package_id,day_start+interval '400 days',10);
  IF NOT public.aka_agent_staff_time_allowed(staff_id) THEN RAISE EXCEPTION 'default must ignore expired staff date'; END IF;

  FOR c IN SELECT * FROM (VALUES
    (false, day_start-interval '1 second',400,true,'organization','active'),
    (false, day_start-interval '1 day',400,true,'organization','active'),
    (true, day_start-interval '1 second',400,false,'staff','expired'),
    (true, day_start,400,true,'staff','active'),
    (true, NULL::timestamptz,400,true,'organization','active'),
    (false, NULL::timestamptz,400,true,'organization','active'),
    (true, day_start+interval '10 days',-1,true,'staff','expired'),
    (false, day_start+interval '10 days',-1,true,'organization','expired'),
    (true, NULL::timestamptz,-1,true,'organization','expired')
  ) AS cases(staff_mode,expires,product_days,allowed,source,status)
  LOOP
    UPDATE public.org_organization SET use_staff_expiration=c.staff_mode WHERE id=org_id;
    UPDATE public.org_staff SET expiration_date=c.expires WHERE id=staff_id;
    UPDATE public.org_organization_product SET expiration_date=day_start+make_interval(days=>c.product_days) WHERE organization_id=org_id;
    EXECUTE 'SET LOCAL ROLE anon';
    result:=public.aka_agent_staff_access(staff_id,staff_username,'123456');
    IF (result->>'timeAllowed')::boolean IS DISTINCT FROM c.allowed
      OR (result->>'useStaffExpiration')::boolean IS DISTINCT FROM c.staff_mode
      OR (result->>'useOrganizationExpiration')::boolean IS DISTINCT FROM NOT c.staff_mode THEN
      RAISE EXCEPTION 'access/legacy response mismatch: %',c;
    END IF;
    result:=public.aka_agent_staff_management(actor_id,actor_username,'123456','list','{}');
    EXECUTE 'RESET ROLE';
    IF (result->'organization'->>'useStaffExpiration')::boolean IS DISTINCT FROM c.staff_mode
      OR (result->'organization'->>'useOrganizationExpiration')::boolean IS DISTINCT FROM NOT c.staff_mode
      OR result->'organization'->>'staffDurationDays' IS DISTINCT FROM '365' THEN
      RAISE EXCEPTION 'list mode/legacy/default mismatch';
    END IF;
    SELECT value INTO STRICT row_result FROM jsonb_array_elements(result->'items') WHERE (value->>'id')::bigint=staff_id;
    IF row_result->>'status' IS DISTINCT FROM c.status OR row_result->>'expirySource' IS DISTINCT FROM c.source
      OR (row_result->>'expirationDate')::timestamptz IS DISTINCT FROM c.expires OR row_result ? 'password' THEN
      RAISE EXCEPTION 'row expiry/status/secret mismatch: %',c;
    END IF;
  END LOOP;
  UPDATE public.org_organization SET use_staff_expiration=false WHERE id=org_id;
  UPDATE public.org_staff SET is_active=false WHERE id=staff_id;
  IF public.aka_agent_staff_time_allowed(staff_id) THEN RAISE EXCEPTION 'org mode bypassed lock'; END IF;
  UPDATE public.org_staff SET is_active=false,deleted_at=now() WHERE id=staff_id;
  IF public.aka_agent_staff_time_allowed(staff_id) THEN RAISE EXCEPTION 'org mode bypassed deletion'; END IF;
  IF public.aka_agent_staff_time_allowed(-1) THEN RAISE EXCEPTION 'missing staff allowed'; END IF;
END; $smoke$;
SELECT 'PASS v310: new default, both modes, legacy JSON, NULL fallback, Vietnam date, products, active/deleted guards' AS result;
ROLLBACK;
