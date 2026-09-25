-- Local test fixture: exact production definitions captured for v321. No credentials.
CREATE FUNCTION public.aka_agent_staff_time_allowed(bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.claim_non_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_previous_status text, p_claim_token uuid, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_platform NOT IN ('facebook', 'email') THEN
    RAISE EXCEPTION 'Non-Zalo runtime platform must be Facebook or Email';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  -- reset_desktop_running_statuses takes FOR UPDATE on this same row. The
  -- shared lock prevents a new account operation from entering recovery.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> v_platform
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  -- Retrying the same client-generated token is idempotent after an ambiguous
  -- network response: the caller still owns this exact account-only claim.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'platform', v_platform
    );
  END IF;

  IF (COALESCE(p_requires_login, true) AND v_account.login_status IS DISTINCT FROM 'đã đăng nhập')
    OR v_account.status IS DISTINCT FROM v_previous_status
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'platform', v_platform
  );
END;
$function$
;
ALTER FUNCTION public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean) TO anon,authenticated,service_role;
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
    WHERE id=p_staff_id AND is_active=true AND public.aka_agent_staff_time_allowed(p_staff_id) FOR SHARE;
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
ALTER FUNCTION public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text) TO anon,authenticated,service_role;
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
ALTER FUNCTION public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid) TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.guard_auto_account_runtime_operation_claim_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'đang chạy' THEN
    NEW.runtime_operation_claim_token := NULL;
  ELSIF OLD.status IS DISTINCT FROM 'đang chạy'
    AND NEW.runtime_operation_claim_token IS NOT DISTINCT FROM OLD.runtime_operation_claim_token
  THEN
    -- A different runtime (for example claim_campaign_runtime or an older app)
    -- entered running state without supplying an account-operation token.
    NEW.runtime_operation_claim_token := NULL;
  END IF;
  RETURN NEW;
END;
$function$
;
ALTER FUNCTION public.guard_auto_account_runtime_operation_claim_token() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_auto_account_runtime_operation_claim_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_auto_account_runtime_operation_claim_token() TO anon,authenticated,service_role;
CREATE TRIGGER trg_auto_accounts_runtime_operation_claim_token BEFORE UPDATE OF status,runtime_operation_claim_token ON public.auto_accounts FOR EACH ROW EXECUTE FUNCTION public.guard_auto_account_runtime_operation_claim_token();
