BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
-- Source captured from linked akachat/cgjbsmqtfhqvttudyjzq, not a historical body.
-- Existing signature/return type, owner, ACL, config and all v319 behavior are retained.
DO $preflight$
DECLARE target regprocedure:=to_regprocedure('public.aka_agent_facebook_login(bigint,text,text,text,jsonb)');
BEGIN
  IF target IS NULL OR md5(pg_get_functiondef(target)) IS DISTINCT FROM '9da25936c98428774debffcafcc0d8f8' THEN
    RAISE EXCEPTION 'v320 source changed; recapture the live Facebook RPC before applying';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_facebook_login(p_staff_id bigint, p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  access jsonb; org_id bigint; a public.auto_accounts%ROWTYPE;
  s public.auto_facebook_login_sessions%ROWTYPE; secret jsonb; result jsonb;
  reservation public.auto_facebook_login_imports%ROWTYPE;
  uid text; import_request uuid; account_id_input bigint; secret_id_input uuid;
  limit_value text; batch_limit integer:=10; account_limit integer; product_count integer; used_count integer;
BEGIN
  IF p_action IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>2000000 THEN
    RAISE EXCEPTION 'facebook_invalid_input';
  END IF;
  access:=public.aka_agent_staff_access(p_staff_id,p_username,p_password);
  SELECT organization_id INTO org_id FROM public.org_staff WHERE id=p_staff_id;
  -- Cleanup/read-after-commit stay available to the same authenticated owner after entitlement expiry.
  IF p_action NOT IN ('abort','request_status') THEN
    IF NOT coalesce((access->>'isActive')::boolean,false) OR NOT coalesce((access->>'timeAllowed')::boolean,false) THEN
      RAISE EXCEPTION 'facebook_access_denied';
    END IF;
    SELECT count(*),CASE WHEN bool_or(max_accounts IS NULL OR max_accounts<=0) THEN NULL ELSE max(max_accounts) END
    INTO product_count,account_limit FROM public.org_organization_product
    WHERE organization_id=org_id AND product_id IN (3,10) AND is_deleted=false
      AND expiration_date >= (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh');
    IF product_count=0 THEN RAISE EXCEPTION 'facebook_access_denied'; END IF;
  END IF;
  SELECT value INTO limit_value FROM public.auto_system_settings
    WHERE key='facebook.account_import.max_accounts_per_batch' AND is_active=true;
  IF limit_value ~ '^[0-9]{1,6}$' AND limit_value::integer>0 THEN batch_limit:=limit_value::integer; END IF;

  IF p_action='preview' THEN
    SELECT coalesce(jsonb_agg(DISTINCT facebook_uid),'[]') INTO result FROM public.auto_accounts
    WHERE staff_id=p_staff_id AND organization_id=org_id AND flatform_type='facebook' AND is_delete=false
      AND facebook_uid IN (SELECT jsonb_array_elements_text(p_data->'uids'));
    RETURN jsonb_build_object('limit',batch_limit,'duplicates',result);
  END IF;
  IF p_action='pending' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',i.account_id,'requestId',i.request_id)),'[]') INTO result
    FROM public.auto_facebook_login_imports i WHERE i.staff_id=p_staff_id AND i.organization_id=org_id
      AND i.created_at < now()-interval '5 minutes';
    RETURN result;
  END IF;
  IF p_action IN ('reserve','finish','abort','request_status') THEN
    import_request:=(p_data->>'requestId')::uuid;
    IF import_request IS NULL THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    -- Serialize only account creation per staff, including quota check. UID is NOT a global constraint.
    PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR UPDATE;
    SELECT a1.* INTO a FROM public.auto_accounts a1 JOIN public.auto_facebook_login_sessions s1 ON s1.account_id=a1.id
      WHERE s1.import_request_id=import_request AND a1.staff_id=p_staff_id AND a1.organization_id=org_id;
    IF FOUND THEN
      SELECT * INTO s FROM public.auto_facebook_login_sessions WHERE account_id=a.id;
      RETURN jsonb_build_object('accountId',a.id,'state','ready','ready',true,'revision',s.revision);
    END IF;
    SELECT * INTO reservation FROM public.auto_facebook_login_imports
      WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id FOR UPDATE;
    IF p_action='request_status' THEN
      IF reservation.account_id IS NULL THEN RETURN NULL; END IF;
      RETURN jsonb_build_object('accountId',reservation.account_id,'state','initializing');
    END IF;
    IF p_action='abort' THEN
      DELETE FROM public.auto_facebook_login_imports WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id;
      RETURN jsonb_build_object('removed',true);
    END IF;
    IF p_action='reserve' AND reservation.account_id IS NOT NULL THEN
      RETURN jsonb_build_object('accountId',reservation.account_id,'state','initializing');
    END IF;
    IF (p_data->>'batchSize') IS NULL OR (p_data->>'batchSize')::integer NOT BETWEEN 1 AND batch_limit THEN RAISE EXCEPTION 'facebook_batch_limit'; END IF;
    secret:=p_data->'secret'; uid:=secret->>'uid';
    IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' OR jsonb_typeof(secret->'cookies') IS DISTINCT FROM 'array'
      OR length(coalesce(secret->>'password',''))>1024 OR length(coalesce(secret->>'twoFactorSecret',''))>256
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(secret->'cookies') c WHERE c->>'name'='c_user' AND c->>'value'=uid)
      THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF EXISTS(SELECT 1 FROM public.auto_accounts WHERE staff_id=p_staff_id AND flatform_type='facebook'
      AND is_delete=false AND facebook_uid=uid) THEN
      DELETE FROM public.auto_facebook_login_imports WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id;
      RETURN jsonb_build_object('skipped',true);
    END IF;
    SELECT count(*) INTO used_count FROM public.auto_accounts WHERE staff_id=p_staff_id AND flatform_type='facebook' AND is_delete=false;
    IF account_limit IS NOT NULL AND used_count>=account_limit THEN RAISE EXCEPTION 'facebook_account_quota'; END IF;
    IF p_data->>'accountGroupId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.auto_account_groups
      WHERE id=(p_data->>'accountGroupId')::bigint AND staff_id=p_staff_id AND organization_id=org_id AND flatform_type='facebook' AND is_delete=false AND is_active=true) THEN
      RAISE EXCEPTION 'facebook_invalid_group'; END IF;
    IF p_data->>'proxyId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.auto_proxies
      WHERE id=(p_data->>'proxyId')::bigint AND staff_id=p_staff_id AND organization_id=org_id AND is_delete=false) THEN RAISE EXCEPTION 'facebook_invalid_proxy'; END IF;
    IF p_action='reserve' THEN
      INSERT INTO public.auto_facebook_login_imports(request_id,account_id,staff_id,organization_id)
        VALUES(import_request,nextval('public.auto_accounts_id_seq'),p_staff_id,org_id) RETURNING * INTO reservation;
      RETURN jsonb_build_object('accountId',reservation.account_id,'state','initializing');
    END IF;
    IF reservation.account_id IS NULL OR reservation.account_id IS DISTINCT FROM (p_data->>'accountId')::bigint THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
    INSERT INTO public.auto_accounts(id,name,flatform_type,login_status,status,is_active,is_delete,staff_id,organization_id,
      account_group_id,proxy_id,is_zalo_show_web,is_zalo_server,facebook_uid,facebook_login_managed)
    OVERRIDING SYSTEM VALUE VALUES (reservation.account_id,coalesce(nullif(p_data->>'name',''),uid),'facebook','đã đăng nhập','chờ xử lý',true,false,p_staff_id,org_id,
      (p_data->>'accountGroupId')::bigint,(p_data->>'proxyId')::bigint,false,false,uid,true) RETURNING * INTO a;
    secret_id_input:=vault.create_secret(secret::text,'akaagent_facebook_'||a.id,'Facebook session managed by akaAgent');
    INSERT INTO public.auto_facebook_login_sessions(account_id,secret_id,import_request_id,last_verified_at)
      VALUES(a.id,secret_id_input,import_request,now());
    DELETE FROM public.auto_facebook_login_imports WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id;
    RETURN jsonb_build_object('accountId',a.id,'state','ready','ready',true,'revision',1);
  END IF;

  account_id_input:=(p_data->>'accountId')::bigint;
  SELECT * INTO a FROM public.auto_accounts WHERE id=account_id_input AND staff_id=p_staff_id AND organization_id=org_id
    AND flatform_type='facebook' AND is_delete=false FOR UPDATE;
  IF NOT FOUND THEN
    IF p_action='abort' THEN RETURN jsonb_build_object('removed',true); END IF;
    RAISE EXCEPTION 'facebook_not_found';
  END IF;
  SELECT * INTO s FROM public.auto_facebook_login_sessions WHERE account_id=a.id FOR UPDATE;
  -- Existing manual accounts expose only metadata until an explicit verified login.
  IF p_action='metadata' AND s.account_id IS NULL THEN
    RETURN jsonb_build_object('uid',a.facebook_uid,'revision',0,
      'hasPassword',false,'hasTwoFactor',false,'hasCookie',false);
  END IF;
  IF p_action='login' THEN
    IF coalesce(s.revision,0) IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
    secret:=p_data->'secret'; uid:=secret->>'uid';
    IF jsonb_typeof(secret) IS DISTINCT FROM 'object' OR uid IS NULL OR uid !~ '^[0-9]{5,24}$'
      OR jsonb_typeof(secret->'cookies') IS DISTINCT FROM 'array'
      OR length(coalesce(secret->>'password','')) NOT BETWEEN 1 AND 1024
      OR length(coalesce(secret->>'twoFactorSecret','')) NOT BETWEEN 16 AND 256 THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(secret->'cookies') c WHERE c->>'name'='c_user' AND c->>'value'=uid)
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(secret->'cookies') c WHERE c->>'name'='xs' AND coalesce(c->>'value','')<>'')
      THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    secret:=jsonb_build_object('uid',uid,'password',secret->>'password','twoFactorSecret',secret->>'twoFactorSecret','cookies',secret->'cookies');
    -- Reuse this account; duplicate UID filtering and creation quota belong to import only.
    IF s.account_id IS NULL THEN
      secret_id_input:=vault.create_secret(secret::text,'akaagent_facebook_'||a.id,'Facebook session managed by akaAgent');
      INSERT INTO public.auto_facebook_login_sessions(account_id,secret_id,import_request_id,last_verified_at)
        VALUES(a.id,secret_id_input,gen_random_uuid(),now()) RETURNING * INTO s;
    ELSE
      PERFORM vault.update_secret(s.secret_id,secret::text);
      UPDATE public.auto_facebook_login_sessions SET revision=revision+1,last_verified_at=now(),updated_at=now()
        WHERE account_id=a.id RETURNING * INTO s;
    END IF;
    UPDATE public.auto_accounts SET facebook_login_managed=true,facebook_uid=uid,login_status='đã đăng nhập',updated_at=now() WHERE id=a.id;
    RETURN jsonb_build_object('revision',s.revision);
  END IF;
  IF p_action='observe' AND s.account_id IS NULL THEN
    IF a.facebook_uid IS DISTINCT FROM (p_data->>'expectedUid') THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
    IF p_data->>'state'='authenticated' THEN
      uid:=p_data->>'uid'; IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
      UPDATE public.auto_accounts SET facebook_uid=uid,login_status='đã đăng nhập',updated_at=now() WHERE id=a.id;
    ELSIF p_data->>'state' IN ('logged_out','challenge') THEN
      UPDATE public.auto_accounts SET login_status=CASE WHEN p_data->>'state'='challenge' THEN 'checkpoint' ELSE 'chưa đăng nhập' END,
        updated_at=now() WHERE id=a.id;
    END IF;
    RETURN jsonb_build_object('revision',0);
  END IF;
  IF s.account_id IS NULL THEN RAISE EXCEPTION 'facebook_not_managed'; END IF;
  SELECT decrypted_secret::jsonb INTO secret FROM vault.decrypted_secrets WHERE id=s.secret_id;
  IF p_action='get' THEN RETURN jsonb_build_object('secret',secret,'revision',s.revision); END IF;
  IF p_action='metadata' THEN RETURN jsonb_build_object('uid',secret->>'uid','revision',s.revision,
    'hasPassword',coalesce(secret->>'password','')<>'','hasTwoFactor',coalesce(secret->>'twoFactorSecret','')<>'',
    'hasCookie',jsonb_array_length(coalesce(secret->'cookies','[]'))>0); END IF;
  IF s.revision IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
  IF p_action='observe' THEN
    IF p_data->>'state'='authenticated' THEN
      uid:=p_data->>'uid';
      IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' OR jsonb_typeof(p_data->'cookies') IS DISTINCT FROM 'array'
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'cookies') c WHERE c->>'name'='c_user' AND c->>'value'=uid)
        THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
      IF secret->>'uid' IS DISTINCT FROM uid THEN secret:=jsonb_build_object('uid',uid); END IF;
      secret:=secret||jsonb_build_object('cookies',p_data->'cookies');
      PERFORM vault.update_secret(s.secret_id,secret::text);
      UPDATE public.auto_accounts SET facebook_uid=uid,login_status='đã đăng nhập',updated_at=now() WHERE id=a.id;
      UPDATE public.auto_facebook_login_sessions SET revision=revision+1,last_verified_at=now(),updated_at=now() WHERE account_id=a.id;
    ELSIF p_data->>'state' IN ('logged_out','challenge') THEN
      UPDATE public.auto_accounts SET login_status=CASE WHEN p_data->>'state'='challenge' THEN 'checkpoint' ELSE 'chưa đăng nhập' END,
        updated_at=now() WHERE id=a.id;
    ELSE RAISE EXCEPTION 'facebook_invalid_input'; END IF;
  ELSIF p_action='save' THEN
    uid:=p_data->>'uid';
    IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF coalesce(p_data->>'observedState','') NOT IN ('authenticated','logged_out') THEN RAISE EXCEPTION 'facebook_unverified'; END IF;
    IF length(coalesce(p_data->>'password',''))>1024 OR length(coalesce(p_data->>'twoFactorSecret',''))>256 THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF p_data->>'observedState'='authenticated' AND uid IS DISTINCT FROM (p_data->>'observedUid') THEN RAISE EXCEPTION 'facebook_uid_mismatch'; END IF;
    IF secret->>'uid' IS DISTINCT FROM uid THEN secret:=jsonb_build_object('uid',uid,'cookies','[]'::jsonb); END IF;
    IF p_data ? 'password' THEN secret:=secret||jsonb_build_object('password',p_data->>'password'); END IF;
    IF p_data ? 'twoFactorSecret' THEN secret:=secret||jsonb_build_object('twoFactorSecret',p_data->>'twoFactorSecret'); END IF;
    PERFORM vault.update_secret(s.secret_id,secret::text);
    UPDATE public.auto_facebook_login_sessions SET revision=revision+1,updated_at=now() WHERE account_id=a.id;
  ELSE RAISE EXCEPTION 'facebook_invalid_action'; END IF;
  SELECT revision INTO s.revision FROM public.auto_facebook_login_sessions WHERE account_id=a.id;
  RETURN jsonb_build_object('revision',s.revision);
END $function$;

-- Body-only change: no API metadata change or explicit PostgREST reload.
COMMIT;
