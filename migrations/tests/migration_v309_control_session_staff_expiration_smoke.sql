-- Synthetic fixtures only; no account/campaign execution. Always rolls back.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  customer_id bigint; org_id bigint; other_org_id bigint; staff_id bigint; product_id bigint;
  package_id bigint; session_id uuid; token_hash text; result jsonb; c record; client text;
  day_start timestamptz:=date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
  IF NOT has_function_privilege('service_role','public.aka_agent_authenticate_control_session(text)','EXECUTE')
    OR has_function_privilege('anon','public.aka_agent_authenticate_control_session(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.aka_agent_authenticate_control_session(text)','EXECUTE')
  THEN RAISE EXCEPTION 'control auth ACL changed'; END IF;
  INSERT INTO public.aka_customer(name) VALUES('__control_expiry_v309_rollback__') RETURNING id INTO customer_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__control_expiry_v309_rollback__','0999999309',5,s.id,s.id
    FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING id INTO org_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__control_expiry_v309_foreign__','0999999399',5,s.id,s.id
    FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING id INTO other_org_id;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin)
    VALUES(org_id,'Expiry fixture','0999999309',false) RETURNING id INTO staff_id;
  SELECT p.product_package_id INTO STRICT package_id FROM public.org_organization_product p WHERE p.product_id=17 LIMIT 1;
  INSERT INTO public.org_organization_product(organization_id,product_id,product_package_id,expiration_date,max_accounts)
    VALUES(org_id,17,package_id,day_start+interval '400 days',10) RETURNING id INTO product_id;

  FOR c IN SELECT * FROM (VALUES
    ('legacy null',false,NULL::timestamptz,400,true,false,'authenticated',true),
    ('staff today midnight',false,day_start,400,true,false,'authenticated',true),
    ('staff yesterday final second',false,day_start-interval '1 second',400,true,false,'invalid_staff',false),
    ('staff future',false,day_start+interval '10 days',400,true,false,'authenticated',true),
    ('org mode ignores expired staff',true,day_start-interval '1 day',400,true,false,'authenticated',true),
    ('org mode null',true,NULL::timestamptz,400,true,false,'authenticated',true),
    ('product expired before staff',false,day_start+interval '10 days',-1,true,false,'capability_unavailable',true),
    ('legacy null product expired',false,NULL::timestamptz,-1,true,false,'capability_unavailable',true),
    ('org mode product expired',true,day_start+interval '10 days',-1,true,false,'capability_unavailable',true),
    ('product today remains valid',false,NULL::timestamptz,0,true,false,'authenticated',true),
    ('inactive staff',true,NULL::timestamptz,400,false,false,'invalid_staff',false),
    ('deleted staff',true,NULL::timestamptz,400,false,true,'invalid_staff',false)
  ) AS cases(label,org_mode,staff_expiry,product_days,active,deleted,expected,allowed)
  LOOP
    UPDATE public.org_organization SET use_organization_expiration=c.org_mode WHERE id=org_id;
    UPDATE public.org_staff SET expiration_date=c.staff_expiry,is_active=c.active,
      deleted_at=CASE WHEN c.deleted THEN now() ELSE NULL END WHERE id=staff_id;
    UPDATE public.org_organization_product SET expiration_date=day_start+make_interval(days=>c.product_days) WHERE id=product_id;
    IF public.aka_agent_staff_time_allowed(staff_id) IS DISTINCT FROM c.allowed THEN
      RAISE EXCEPTION 'login helper mismatch: %',c.label;
    END IF;
    FOREACH client IN ARRAY ARRAY['web','native'] LOOP
      token_hash:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
      INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,client_type,expires_at,last_seen_at)
        VALUES(staff_id,org_id,token_hash,client,now()+interval '1 day',now()-interval '6 minutes') RETURNING id INTO session_id;
      EXECUTE 'SET LOCAL ROLE service_role';
      result:=public.aka_agent_authenticate_control_session(token_hash);
      EXECUTE 'RESET ROLE';
      IF result->>'status' IS DISTINCT FROM c.expected THEN
        RAISE EXCEPTION 'auth mismatch %/%: %',c.label,client,result->>'status';
      END IF;
      IF c.expected='authenticated' THEN
        IF (result->'staff'->>'id')::bigint IS DISTINCT FROM staff_id
          OR (result->'organization'->>'id')::bigint IS DISTINCT FROM org_id
          OR result->'capabilities'->>'sms' IS DISTINCT FROM 'true'
          OR result->'staff' ? 'password'
          OR NOT EXISTS(SELECT 1 FROM public.auto_control_sessions WHERE id=session_id AND revoked_at IS NULL AND last_seen_at=now())
        THEN RAISE EXCEPTION 'identity/capability/secret/last_seen regression'; END IF;
      ELSE
        IF NOT EXISTS(SELECT 1 FROM public.auto_control_sessions WHERE id=session_id AND revoked_at IS NOT NULL)
          OR public.aka_agent_authenticate_control_session(token_hash)->>'status' IS DISTINCT FROM 'invalid_session'
        THEN RAISE EXCEPTION 'rejected session was not revoked'; END IF;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.org_staff SET expiration_date=NULL,is_active=true,deleted_at=NULL WHERE id=staff_id;
  -- A valid token cannot authorize a staff member in a different tenant.
  INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,expires_at)
    VALUES(staff_id,other_org_id,repeat('a',64),now()+interval '1 day');
  IF public.aka_agent_authenticate_control_session(repeat('a',64))->>'status' IS DISTINCT FROM 'invalid_staff' THEN
    RAISE EXCEPTION 'session tenant guard lost';
  END IF;
  -- Expired staff check must not authorize expired/revoked/unknown tokens.
  INSERT INTO public.auto_control_sessions(staff_id,organization_id,token_hash,created_at,last_seen_at,expires_at)
    VALUES(staff_id,org_id,repeat('b',64),now()-interval '1 day',now()-interval '1 day',now()-interval '1 second');
  IF public.aka_agent_authenticate_control_session(repeat('b',64))->>'status' IS DISTINCT FROM 'invalid_session'
    OR public.aka_agent_authenticate_control_session(repeat('c',64))->>'status' IS DISTINCT FROM 'invalid_session'
  THEN RAISE EXCEPTION 'session validity guard lost'; END IF;
END; $smoke$;
SELECT 'PASS v309 staff/org/NULL expiry, Vietnam date boundary, product expiry, web/native, revoked/expired sessions, tenant/ACL/secret/last_seen guards' AS result;
ROLLBACK;
