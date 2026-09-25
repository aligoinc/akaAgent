BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';

-- Captured from akachat/cgjbsmqtfhqvttudyjzq. The shared RPCs stay unchanged.
DO $preflight$
DECLARE item record; target regprocedure;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)','b721f2bf997eef62f72eaf5e2728fb8c'),
    ('public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)','f941b9177b447ca5da721d10dacf55e8'),
    ('public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)','e590eca5b11f0b258309bcd13b01e6a6'),
    ('public.guard_auto_account_runtime_operation_claim_token()','aa29df91b50cd6bc11e24bd912545c40')
  ) AS definitions(signature,checksum) LOOP
    target:=to_regprocedure(item.signature);
    IF target IS NULL OR md5(pg_get_functiondef(target)) IS DISTINCT FROM item.checksum THEN
      RAISE EXCEPTION 'v321_dependency_changed:%',item.signature;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=target AND p.proowner='postgres'::regrole
      AND NOT p.prosecdef AND p.provolatile='v'
      AND p.proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
      RAISE EXCEPTION 'v321_dependency_attributes_changed:%',item.signature;
    END IF;
  END LOOP;
  IF to_regprocedure('public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)') IS NOT NULL
    OR to_regprocedure('public.guard_facebook_login_claim_generation()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.auto_accounts'::regclass
      AND attname='facebook_login_claim_generation' AND NOT attisdropped)
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_accounts'::regclass
      AND tgname='trg_zz_facebook_login_claim_generation') THEN
    RAISE EXCEPTION 'v321_target_already_exists: recapture before replacing';
  END IF;
END $preflight$;

ALTER TABLE public.auto_accounts ADD COLUMN facebook_login_claim_generation bigint NOT NULL DEFAULT 0
  CHECK (facebook_login_claim_generation>=0);

CREATE FUNCTION public.guard_facebook_login_claim_generation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
  -- Runs AFTER the existing BEFORE trigger which clears tokens on pause/reset.
  -- A legacy cleanup or lifecycle recovery must invalidate old FB requests too.
  IF lower(btrim(coalesce(OLD.flatform_type,'')))='facebook'
    AND NEW.runtime_operation_claim_token IS DISTINCT FROM OLD.runtime_operation_claim_token THEN
    NEW.facebook_login_claim_generation:=OLD.facebook_login_claim_generation+1;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.guard_facebook_login_claim_generation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_facebook_login_claim_generation() FROM PUBLIC;
CREATE TRIGGER trg_zz_facebook_login_claim_generation
BEFORE UPDATE OF status,runtime_operation_claim_token ON public.auto_accounts
FOR EACH ROW EXECUTE FUNCTION public.guard_facebook_login_claim_generation();

CREATE FUNCTION public.aka_agent_facebook_account_operation(
  p_account_id bigint,p_staff_id bigint,p_previous_status text,p_claim_token uuid,p_generation bigint,p_action text
)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE a public.auto_accounts%ROWTYPE; org_id bigint; result jsonb;
BEGIN
  IF p_account_id IS NULL OR p_account_id<=0 OR p_staff_id IS NULL OR p_staff_id<=0
    OR p_claim_token IS NULL OR p_generation IS NULL OR p_generation<0 OR p_generation>9007199254740991
    OR p_previous_status IS NULL OR p_previous_status NOT IN ('chờ xử lý','tạm dừng')
    OR p_action IS NULL OR p_action NOT IN ('claim','cleanup') THEN
    RAISE EXCEPTION 'invalid_facebook_operation_identity';
  END IF;
  -- Same staff -> account lock order as the existing claim, cleanup and recovery.
  -- Cleanup remains possible after staff deactivation/expiry or soft deletion.
  SELECT organization_id INTO org_id FROM public.org_staff WHERE id=p_staff_id FOR SHARE;
  IF NOT FOUND OR org_id IS NULL THEN
    RETURN CASE WHEN p_action='claim' THEN jsonb_build_object('claimed',false,'reason','staff_not_active')
      ELSE jsonb_build_object('ok',false,'reason','staff_not_found') END;
  END IF;
  SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id
    AND (organization_id IS NULL OR organization_id=org_id) AND lower(btrim(coalesce(flatform_type,'')))='facebook'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN CASE WHEN p_action='claim' THEN jsonb_build_object('claimed',false,'reason','account_not_found')
      ELSE jsonb_build_object('ok',true,'reason','not_owner') END;
  END IF;
  IF p_action='claim' THEN
    -- The trigger increments once on acquisition. A retry may still observe
    -- that same owned token, but a closed generation can never acquire it again.
    IF a.facebook_login_claim_generation<>p_generation AND NOT (
      a.runtime_operation_claim_token IS NOT DISTINCT FROM p_claim_token
      AND a.facebook_login_claim_generation=p_generation+1) THEN
      RETURN jsonb_build_object('claimed',false,'reason','claim_closed');
    END IF;
    RETURN public.aka_agent_claim_account_operation(p_account_id,p_staff_id,'facebook','desktop',
      p_previous_status,p_claim_token,false,'operation');
  END IF;

  result:=public.aka_agent_cleanup_account_operation(p_account_id,p_staff_id,'facebook','desktop',
    p_previous_status,p_claim_token);
  IF coalesce((result->>'ok')::boolean,false) AND result->>'reason' IN ('cleaned','not_owner','already_cleaned') THEN
    -- If cleanup wins the row lock BEFORE claim, close its generation even
    -- though no token is present yet. Do not alter status or another token.
    UPDATE public.auto_accounts SET facebook_login_claim_generation=facebook_login_claim_generation+1
      WHERE id=p_account_id AND facebook_login_claim_generation=p_generation;
  END IF;
  RETURN result;
END;
$function$;
ALTER FUNCTION public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)
  TO anon,authenticated,service_role;

DO $postflight$
DECLARE item record; target regprocedure;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('public.guard_facebook_login_claim_generation()','2f6e2f7b901d816cd7a5c29deb8c43e4'),
    ('public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)','a5c7a6181fb3af9b1d47eeed8bc912cf')
  ) AS definitions(signature,checksum) LOOP
    target:=to_regprocedure(item.signature);
    IF target IS NULL OR md5(pg_get_functiondef(target)) IS DISTINCT FROM item.checksum THEN
      RAISE EXCEPTION 'v321_target_changed:%',item.signature;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=target AND p.proowner='postgres'::regrole
      AND NOT p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog, public']) THEN
      RAISE EXCEPTION 'v321_target_attributes_changed:%',item.signature;
    END IF;
  END LOOP;
END $postflight$;

-- A column, trigger and RPC signature are new. Existing DDL event triggers
-- perform the necessary schema reload; do not issue an extra NOTIFY here.
COMMIT;
