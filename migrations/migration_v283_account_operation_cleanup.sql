-- v283: token-owned account operations with shared retryable cleanup.
-- Live dependencies captured from linked akachat/cgjbsmqtfhqvttudyjzq on 2026-09-15.
-- Additive RPCs only: legacy claim/release and campaign RPCs are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
DECLARE r record; f oid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)','78d5cdd05a02bdf3b78349e598e9d512'),
    ('public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)','300b0873302bddc8f9db6ecf404eeeea')
  ) v(signature,checksum) LOOP
    f:=to_regprocedure(r.signature);
    IF f IS NULL OR md5(pg_get_functiondef(f))<>r.checksum THEN
      RAISE EXCEPTION 'v283_dependency_changed:%',r.signature;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=f AND NOT prosecdef AND provolatile='v'
      AND pg_get_userbyid(proowner)='postgres'
      AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
      RAISE EXCEPTION 'v283_dependency_attributes_changed:%',r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)', '15517ca7d3dd7af4bf1bd46f4e9cf653'),
    ('public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)', 'f941b9177b447ca5da721d10dacf55e8')
  ) v(signature,checksum) LOOP
    f:=to_regprocedure(r.signature);
    IF f IS NOT NULL AND md5(pg_get_functiondef(f))<>r.checksum THEN
      RAISE EXCEPTION 'v283_unexpected_existing_function:%',r.signature;
    END IF;
    IF f IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=f AND NOT prosecdef
      AND provolatile='v' AND pg_get_userbyid(proowner)='postgres'
      AND proconfig=ARRAY['search_path=pg_catalog, public']
      AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
      RAISE EXCEPTION 'v283_unexpected_existing_attributes:%',r.signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_account_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_runtime_target text, p_previous_status text, p_claim_token uuid, p_requires_login boolean, p_operation_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_account public.auto_accounts%ROWTYPE; v_organization_id bigint;
BEGIN
  IF p_account_id IS NULL OR p_account_id<=0 OR p_staff_id IS NULL OR p_staff_id<=0
    OR p_claim_token IS NULL OR p_previous_status IS NULL
    OR p_previous_status NOT IN ('chờ xử lý','tạm dừng')
    OR p_platform IS NULL OR p_platform NOT IN ('zalo','facebook','email')
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop','server')
    OR (p_platform<>'zalo' AND p_runtime_target<>'desktop') THEN
    RAISE EXCEPTION 'invalid_account_operation_identity';
  END IF;
  IF p_operation_kind IS NULL OR p_operation_kind NOT IN ('operation','type_change')
    OR (p_operation_kind='type_change' AND p_platform<>'zalo') THEN
    RAISE EXCEPTION 'invalid_account_operation_kind';
  END IF;
  -- Keep the existing lock order: staff, entitlement advisory lock, account.
  SELECT organization_id INTO v_organization_id FROM public.org_staff
    WHERE id=p_staff_id AND is_active=true FOR SHARE;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('claimed',false,'reason','staff_not_active');
  END IF;
  IF p_platform='zalo' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  END IF;
  SELECT * INTO v_account FROM public.auto_accounts a
    WHERE a.id=p_account_id AND a.staff_id=p_staff_id
      AND (a.organization_id IS NULL OR a.organization_id=v_organization_id) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','account_not_found'); END IF;
  IF COALESCE(v_account.is_delete,false) OR lower(btrim(COALESCE(v_account.flatform_type,'')))<>p_platform
    OR (p_operation_kind='operation' AND v_account.is_active IS NOT TRUE) THEN
    RETURN jsonb_build_object('claimed',false,'reason','account_not_available');
  END IF;
  -- A retry after a lost response must never undo a newer pause/resume write.
  IF v_account.runtime_operation_claim_token=p_claim_token AND v_account.status<>'đang chạy' THEN
    RETURN jsonb_build_object('claimed',false,'reason','control_changed');
  END IF;
  -- Zalo already checks all work below in its existing RPC. Extend the same
  -- producer barrier to non-Zalo scans before delegating their existing claim.
  IF p_platform<>'zalo' AND (EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id
      AND (c.status='đang chạy' OR c.runtime_unit_token IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.auto_campaign_inputs i JOIN public.auto_campaigns c ON c.id=i.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND i.status='đang chạy')
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d JOIN public.auto_campaigns c ON c.id=d.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND d.status='đang chạy')) THEN
    RETURN jsonb_build_object('claimed',false,'reason','work_running');
  END IF;
  -- A different token on an idle account can be a completed legacy campaign's
  -- token. Eligibility remains governed by the existing status/work guards.
  IF p_platform='zalo' THEN
    RETURN public.claim_zalo_account_runtime_operation(p_account_id,p_staff_id,p_runtime_target,
      p_previous_status,p_claim_token,CASE WHEN p_operation_kind='type_change' THEN false ELSE COALESCE(p_requires_login,true) END);
  END IF;
  RETURN public.claim_non_zalo_account_runtime_operation(p_account_id,p_staff_id,p_platform,
    p_previous_status,p_claim_token,COALESCE(p_requires_login,true));
END;
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text) TO postgres,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_cleanup_account_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_runtime_target text, p_previous_status text, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_account public.auto_accounts%ROWTYPE; v_organization_id bigint;
BEGIN
  IF p_account_id IS NULL OR p_account_id<=0 OR p_staff_id IS NULL OR p_staff_id<=0
    OR p_claim_token IS NULL OR p_previous_status IS NULL
    OR p_previous_status NOT IN ('chờ xử lý','tạm dừng')
    OR p_platform IS NULL OR p_platform NOT IN ('zalo','facebook','email')
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop','server')
    OR (p_platform<>'zalo' AND p_runtime_target<>'desktop') THEN
    RAISE EXCEPTION 'invalid_account_operation_identity';
  END IF;
  -- Cleanup is allowed after entitlement/subtype/active changes, but only for
  -- this staff, organization, platform and exact operation token.
  SELECT organization_id INTO v_organization_id FROM public.org_staff
    WHERE id=p_staff_id FOR SHARE;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','staff_not_found');
  END IF;
  IF p_platform='zalo' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  END IF;
  SELECT * INTO v_account FROM public.auto_accounts a
    WHERE a.id=p_account_id AND a.staff_id=p_staff_id
      AND (a.organization_id IS NULL OR a.organization_id=v_organization_id)
      AND lower(btrim(COALESCE(a.flatform_type,'')))=p_platform FOR UPDATE;
  IF NOT FOUND OR v_account.runtime_operation_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok',true,'reason','not_owner');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id
      AND (c.status='đang chạy' OR c.runtime_unit_token IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.auto_campaign_inputs i JOIN public.auto_campaigns c ON c.id=i.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND i.status='đang chạy')
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d JOIN public.auto_campaigns c ON c.id=d.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND d.status='đang chạy') THEN
    RETURN jsonb_build_object('ok',false,'reason','work_running');
  END IF;
  UPDATE public.auto_accounts a SET
    status=CASE WHEN a.status='đang chạy' THEN p_previous_status ELSE a.status END,
    runtime_operation_claim_token=NULL, updated_at=now()
    WHERE a.id=p_account_id AND a.staff_id=p_staff_id AND a.runtime_operation_claim_token=p_claim_token;
  RETURN jsonb_build_object('ok',true,'reason','cleaned');
END;
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid) TO postgres,anon,authenticated,service_role;

DO $postflight$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)', '15517ca7d3dd7af4bf1bd46f4e9cf653'),
    ('public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)', 'f941b9177b447ca5da721d10dacf55e8')
  ) v(signature,checksum) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(r.signature)
      AND md5(pg_get_functiondef(oid))=r.checksum AND NOT prosecdef AND provolatile='v'
      AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=pg_catalog, public']
      AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
      RAISE EXCEPTION 'v283_postflight_failed:%',r.signature;
    END IF;
  END LOOP;
END;
$postflight$;
-- New RPC signatures change API metadata. Production's existing DDL event
-- trigger refreshes PostgREST on commit; no redundant NOTIFY is emitted here.
COMMIT;
