-- Candidate only. Apply before new clients; policy stays OFF until the activation migration.
-- No CRM source/endpoint changes. No application mode/revision columns.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
  IF to_regclass('private.app_access_requests') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'aka_agent_app_access%')
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN ('org_staff','auto_accounts')
      AND column_name IN ('is_aka_agent_enabled','is_akachat_enabled'))
  THEN RAISE EXCEPTION 'app_access_schema_drift'; END IF;
  -- Reuse the live staff-scoped view; Desktop has no SELECT on org_staff.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.aka_agent_staff_runtime_profile')
      AND c.relkind='v' AND pg_get_userbyid(c.relowner)='postgres'
      AND md5(pg_get_viewdef(c.oid,true))='bb879c13f7469398e75650bf7403a7d7'
      AND c.relacl::text='{postgres=arwdDxtm/postgres,service_role=r/postgres,aka_agent_chat_api=r/postgres,aka_agent_desktop=r/postgres}'
      AND c.reloptions=ARRAY['security_barrier=true']
      AND has_table_privilege('aka_agent_desktop',c.oid,'SELECT')
  ) THEN RAISE EXCEPTION 'app_access_view_drift'; END IF;
END $preflight$;

ALTER TABLE public.org_staff ADD COLUMN is_aka_agent_enabled boolean,
  ADD COLUMN is_akachat_enabled boolean;
ALTER TABLE public.auto_accounts ADD COLUMN is_aka_agent_enabled boolean,
  ADD COLUMN is_akachat_enabled boolean;

CREATE TABLE private.app_access_requests (
  request_id uuid PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  actor_staff_id bigint,
  target_type text NOT NULL CHECK (target_type IN ('staff','account','initialize','qr')),
  target_id bigint NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('processing','completed','stopping')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.app_access_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.app_access_requests FROM PUBLIC,anon,authenticated,aka_agent_desktop,aka_agent_chat_api,service_role;
CREATE INDEX app_access_pending_requests ON private.app_access_requests(organization_id,target_type,target_id) WHERE status='stopping';
CREATE UNIQUE INDEX app_access_initialization ON private.app_access_requests(organization_id) WHERE target_type='initialize';
CREATE INDEX app_access_qr_claim ON private.app_access_requests(target_id,(result->>'claimToken')) WHERE target_type='qr';

-- Deployment gate, not a tenant mode. Activation changes this function only after all callers are ready.
CREATE FUNCTION private.app_access_policy_enabled() RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog AS $$ SELECT false $$;

CREATE FUNCTION public.aka_agent_app_access_separate(p_org bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT private.app_access_policy_enabled() AND EXISTS (
    SELECT 1 FROM public.org_organization_product WHERE organization_id=p_org AND product_id=5
  )
$$;

CREATE FUNCTION private.app_access_packages(p_org bigint,p_app text,p_platform text DEFAULT NULL)
RETURNS TABLE(id bigint,product_id bigint,max_accounts integer,max_staff integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT p.id,p.product_id,p.max_accounts,p.max_staff FROM public.org_organization_product p
  WHERE p.organization_id=p_org AND p.is_deleted=false
    AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >=
        (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    AND CASE p_app WHEN 'akaChat' THEN p.product_id=5 WHEN 'akaAgent' THEN
      CASE p_platform WHEN 'zalo' THEN p.product_id IN (16,18)
        WHEN 'facebook' THEN p.product_id IN (3,10) WHEN 'email' THEN p.product_id=13
        WHEN 'sms' THEN p.product_id=17 WHEN NULL THEN false
        ELSE p_platform IS NULL AND p.product_id IN (3,10,13,16,17,18) END ELSE false END
$$;

-- Internal cross-staff evaluator; entrypoints separately check actor/tenant scope.
CREATE FUNCTION private.app_access_staff_time_allowed(p_staff bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT COALESCE((SELECT s.is_active AND s.deleted_at IS NULL AND
    (NOT o.use_staff_expiration OR s.expiration_date IS NULL OR
      timezone('Asia/Ho_Chi_Minh',s.expiration_date)::date >= timezone('Asia/Ho_Chi_Minh',now())::date)
    FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id WHERE s.id=p_staff),false)
$$;

CREATE FUNCTION public.aka_agent_app_access_staff_allowed(p_staff bigint,p_app text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT COALESCE((SELECT CASE WHEN NOT public.aka_agent_app_access_separate(s.organization_id) THEN true
    ELSE s.deleted_at IS NULL AND s.is_active=true AND private.app_access_staff_time_allowed(s.id)
      AND CASE p_app WHEN 'akaAgent' THEN s.is_aka_agent_enabled WHEN 'akaChat' THEN s.is_akachat_enabled ELSE false END
      AND EXISTS (SELECT 1 FROM private.app_access_packages(s.organization_id,p_app)) END
    FROM public.org_staff s WHERE s.id=p_staff),false)
$$;

CREATE FUNCTION public.aka_agent_app_access_account_allowed(p_account bigint,p_app text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT COALESCE((SELECT CASE WHEN NOT public.aka_agent_app_access_separate(s.organization_id) THEN true ELSE
    NOT COALESCE(a.is_delete,false) AND s.deleted_at IS NULL AND s.is_active=true
    AND private.app_access_staff_time_allowed(s.id)
    AND (a.organization_id IS NULL OR a.organization_id=s.organization_id)
    AND CASE p_app WHEN 'akaAgent' THEN a.is_aka_agent_enabled
        AND public.aka_agent_app_access_staff_allowed(s.id,'akaAgent')
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaAgent',lower(a.flatform_type)))
        AND (lower(a.flatform_type)<>'zalo' OR EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(s.organization_id) p
          WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN a.is_zalo_show_web THEN 'web' WHEN a.is_zalo_server THEN 'server' ELSE 'qr' END))
      WHEN 'akaChat' THEN a.is_akachat_enabled AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaChat'))
      ELSE false END END FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE a.id=p_account),false)
$$;

-- Transport entitlement is intentionally independent of permission to open the Chat UI.
CREATE FUNCTION public.aka_agent_app_access_chat_runtime(p_org bigint,p_server boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT CASE WHEN public.aka_agent_app_access_separate(p_org) THEN
    EXISTS(SELECT 1 FROM private.app_access_packages(p_org,'akaChat'))
    OR EXISTS(SELECT 1 FROM public.resolve_organization_zalo_account_capabilities(p_org) c
      WHERE c.qr_enabled AND (NOT p_server OR c.server_enabled))
    OR EXISTS(SELECT 1 FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
      WHERE s.organization_id=p_org AND lower(a.flatform_type)='zalo'
        AND (a.runtime_operation_claim_token IS NOT NULL OR a.status='đang chạy'
          OR EXISTS(SELECT 1 FROM public.auto_campaigns c WHERE (c.account_id=a.id OR c.secondary_account_id=a.id)
            AND (c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL))))
  ELSE EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=p_org
      AND p.product_id IN (16,18) AND p.is_deleted=false AND p.is_chat_sync=true
      AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    AND (NOT p_server OR EXISTS(SELECT 1 FROM public.resolve_organization_zalo_account_capabilities(p_org) c
      WHERE c.qr_enabled AND c.server_enabled)) END
$$;

CREATE FUNCTION private.app_access_quota(p_org bigint,p_staff bigint,p_app text,p_type text,p_platform text DEFAULT 'zalo')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE cap integer; used integer; entitled boolean; products jsonb;
BEGIN
  SELECT count(*)>0,CASE WHEN p_type='staff' THEN COALESCE(max(greatest(max_staff,0)),0)
    WHEN bool_or(max_accounts IS NULL OR max_accounts<=0) THEN NULL ELSE max(max_accounts) END,
    COALESCE(jsonb_agg(DISTINCT product_id),'[]'::jsonb)
  INTO entitled,cap,products FROM private.app_access_packages(p_org,p_app,CASE WHEN p_type='staff' THEN NULL ELSE p_platform END);
  IF p_type='staff' THEN
    SELECT count(*) INTO used FROM public.org_staff s WHERE s.organization_id=p_org AND s.deleted_at IS NULL
      AND CASE p_app WHEN 'akaAgent' THEN s.is_aka_agent_enabled ELSE s.is_akachat_enabled END;
  ELSE
    SELECT count(*) INTO used FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE s.organization_id=p_org AND a.staff_id=p_staff AND NOT COALESCE(a.is_delete,false)
      AND (a.organization_id IS NULL OR a.organization_id=p_org)
      AND CASE p_app WHEN 'akaAgent' THEN a.is_aka_agent_enabled AND lower(a.flatform_type)=p_platform ELSE a.is_akachat_enabled END;
  END IF;
  IF NOT entitled THEN cap:=0; END IF;
  RETURN jsonb_build_object('hasPackage',entitled,'limit',cap,'used',used,
    'remaining',CASE WHEN cap IS NULL THEN NULL ELSE greatest(cap-used,0) END,
    'overLimit',cap IS NOT NULL AND used>cap,'productIds',products);
END $$;

CREATE FUNCTION private.app_access_held(p_type text,p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.auto_accounts a WHERE
    CASE p_type WHEN 'account' THEN a.id=p_id WHEN 'staff' THEN a.staff_id=p_id ELSE false END
    AND (a.runtime_operation_claim_token IS NOT NULL OR a.status='đang chạy'
      OR EXISTS(SELECT 1 FROM public.auto_campaigns c WHERE (c.account_id=a.id OR c.secondary_account_id=a.id)
        AND (c.status='đang chạy' OR c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL))))
$$;

CREATE FUNCTION private.app_access_flags(p_type text,p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT jsonb_build_object('isAkaAgentEnabled',agent,'isAkachatEnabled',chat,
    'akaAgentAllowed',CASE p_type WHEN 'staff' THEN public.aka_agent_app_access_staff_allowed(p_id,'akaAgent')
      ELSE public.aka_agent_app_access_account_allowed(p_id,'akaAgent') END,
    'akachatAllowed',CASE p_type WHEN 'staff' THEN public.aka_agent_app_access_staff_allowed(p_id,'akaChat')
      ELSE public.aka_agent_app_access_account_allowed(p_id,'akaChat') END,
    'stopping',EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.target_type=p_type
      AND r.target_id=p_id AND r.status='stopping') AND private.app_access_held(p_type,p_id))
  FROM (SELECT is_aka_agent_enabled agent,is_akachat_enabled chat FROM public.org_staff WHERE p_type='staff' AND id=p_id
    UNION ALL SELECT is_aka_agent_enabled,is_akachat_enabled FROM public.auto_accounts WHERE p_type='account' AND id=p_id) flags
$$;

-- Capture assigned historical access before setting defaults. Expired/locked rows retain seats.
UPDATE public.org_staff s SET is_aka_agent_enabled=true,is_akachat_enabled=EXISTS(
  SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id
    AND p.product_id IN (16,18) AND p.is_chat_sync=true);
UPDATE public.auto_accounts a SET is_aka_agent_enabled=true,is_akachat_enabled=
  lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
  AND EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=a.staff_id AND s.is_akachat_enabled);
ALTER TABLE public.org_staff ALTER COLUMN is_aka_agent_enabled SET NOT NULL,
  ALTER COLUMN is_aka_agent_enabled SET DEFAULT true, ALTER COLUMN is_akachat_enabled SET NOT NULL,
  ALTER COLUMN is_akachat_enabled SET DEFAULT false;
ALTER TABLE public.auto_accounts ALTER COLUMN is_aka_agent_enabled SET NOT NULL,
  ALTER COLUMN is_aka_agent_enabled SET DEFAULT true, ALTER COLUMN is_akachat_enabled SET NOT NULL,
  ALTER COLUMN is_akachat_enabled SET DEFAULT false;

CREATE FUNCTION private.app_access_initialize(p_org bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE admin_id bigint; had_chat boolean; had_agent boolean; cap integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-staff-management:'||p_org::text,0));
  IF EXISTS(SELECT 1 FROM private.app_access_requests WHERE organization_id=p_org AND target_type='initialize') THEN RETURN; END IF;
  SELECT staff_admin_id INTO admin_id FROM public.org_organization WHERE id=p_org;
  INSERT INTO private.app_access_requests(request_id,organization_id,actor_staff_id,target_type,target_id,payload,result,status)
  VALUES (md5('aka-app-access-initialize:'||p_org::text)::uuid,p_org,admin_id,'initialize',p_org,'{}',
    jsonb_build_object('transactionId',pg_current_xact_id()::text),'processing');
  SELECT EXISTS(SELECT 1 FROM public.org_organization_product WHERE organization_id=p_org AND product_id IN (16,18) AND is_chat_sync=true),
    EXISTS(SELECT 1 FROM public.org_organization_product WHERE organization_id=p_org AND product_id IN (3,10,13,16,17,18))
    INTO had_chat,had_agent;
  IF had_chat THEN
    UPDATE public.org_staff SET is_akachat_enabled=true WHERE organization_id=p_org;
    UPDATE public.auto_accounts a SET is_akachat_enabled=true FROM public.org_staff s
      WHERE s.id=a.staff_id AND s.organization_id=p_org AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false);
  ELSE
    SELECT COALESCE(max(greatest(max_staff,0)),0) INTO cap FROM private.app_access_packages(p_org,'akaChat');
    IF cap>0 THEN UPDATE public.org_staff SET is_akachat_enabled=true WHERE id=admin_id AND organization_id=p_org
      AND is_active=true AND deleted_at IS NULL AND public.aka_agent_staff_time_allowed(id); END IF;
  END IF;
  IF had_agent THEN
    -- Legacy ignores per-app flags, including false defaults from newer Chat clients.
    -- Capture that access once before the first product 5 activates separate checks.
    UPDATE public.org_staff SET is_aka_agent_enabled=true WHERE organization_id=p_org;
    UPDATE public.auto_accounts a SET is_aka_agent_enabled=true FROM public.org_staff s WHERE s.id=a.staff_id AND s.organization_id=p_org;
  ELSE
    UPDATE public.org_staff SET is_aka_agent_enabled=false WHERE organization_id=p_org;
    UPDATE public.auto_accounts a SET is_aka_agent_enabled=false FROM public.org_staff s WHERE s.id=a.staff_id AND s.organization_id=p_org;
  END IF;
  UPDATE private.app_access_requests SET payload=jsonb_build_object('hadChat',had_chat,'hadAgent',had_agent),
    result=jsonb_build_object('adminStaffId',admin_id),status='completed',updated_at=clock_timestamp()
    WHERE organization_id=p_org AND target_type='initialize';
END $$;

SELECT private.app_access_initialize(organization_id) FROM public.org_organization_product WHERE product_id=5 GROUP BY organization_id;
CREATE FUNCTION private.app_access_product_added() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private AS $$
BEGIN
  IF NEW.product_id=5 THEN PERFORM private.app_access_initialize(NEW.organization_id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_access_product_added AFTER INSERT OR UPDATE OF product_id ON public.org_organization_product
FOR EACH ROW EXECUTE FUNCTION private.app_access_product_added();

-- Only called in the activation transaction, with writer locks already held.
-- Preserve rights created by either client after V445 while all orgs were legacy.
CREATE FUNCTION private.app_access_capture_rollout() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private AS $$
BEGIN
  IF private.app_access_policy_enabled() THEN RAISE EXCEPTION 'app_access_already_active'; END IF;
  UPDATE public.org_staff s SET is_aka_agent_enabled=true WHERE NOT s.is_aka_agent_enabled
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id=5)
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id IN (3,10,13,16,17,18));
  UPDATE public.auto_accounts a SET is_aka_agent_enabled=true FROM public.org_staff s
    WHERE s.id=a.staff_id AND NOT a.is_aka_agent_enabled
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id=5)
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id IN (3,10,13,16,17,18));
  UPDATE public.org_staff s SET is_akachat_enabled=true WHERE NOT s.is_akachat_enabled
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id=5)
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id IN (16,18) AND p.is_chat_sync=true);
  UPDATE public.auto_accounts a SET is_akachat_enabled=true FROM public.org_staff s
    WHERE s.id=a.staff_id AND NOT a.is_akachat_enabled AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id=5)
    AND EXISTS(SELECT 1 FROM public.org_organization_product p WHERE p.organization_id=s.organization_id AND p.product_id IN (16,18) AND p.is_chat_sync=true);
  UPDATE private.app_access_requests SET result=result||jsonb_build_object('rolloutCapturedAt',clock_timestamp()),updated_at=clock_timestamp()
    WHERE target_type='initialize';
END $$;

-- Narrow credential-bearing RPC. Caller identity is bound independently of browser payload.
CREATE FUNCTION public.aka_agent_app_access(p_actor_id bigint,p_username text,p_password text,p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private
SET lock_timeout='3s' SET statement_timeout='12s' AS $$
#variable_conflict use_variable
DECLARE actor public.org_staff%ROWTYPE; target_staff public.org_staff%ROWTYPE; account public.auto_accounts%ROWTYPE;
  req private.app_access_requests%ROWTYPE; rid uuid; tid bigint; kind text; app_name text; enabled boolean;
  old_enabled boolean; q jsonb; result jsonb; state text; token_staff bigint; target_owner bigint;
BEGIN
  IF p_action NOT IN ('snapshot','set') OR p_action IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'app_access_invalid_input'; END IF;
  token_staff:=private.aka_agent_staff_scope_for_request();
  SELECT * INTO actor FROM public.org_staff WHERE id=p_actor_id AND is_active=true AND deleted_at IS NULL
    AND public.aka_agent_staff_time_allowed(id);
  IF NOT FOUND OR (token_staff IS NOT NULL AND token_staff IS DISTINCT FROM actor.id)
    OR (token_staff IS NULL AND current_setting('role',true) NOT IN ('service_role','aka_agent_chat_api')
      AND session_user NOT IN ('postgres','aka_agent_chat_api'))
    OR (token_staff IS NOT NULL AND (actor.username IS DISTINCT FROM p_username OR actor.password IS DISTINCT FROM p_password))
    THEN RAISE EXCEPTION 'app_access_denied' USING ERRCODE='42501'; END IF;
  IF p_action='snapshot' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('accountIds','platform')) OR
      (p_data ? 'accountIds' AND (jsonb_typeof(p_data->'accountIds')<>'array' OR jsonb_array_length(p_data->'accountIds')>500))
      THEN RAISE EXCEPTION 'app_access_invalid_input'; END IF;
    RETURN jsonb_build_object('separateAccess',public.aka_agent_app_access_separate(actor.organization_id),
      'usesChatRuntime',public.aka_agent_app_access_chat_runtime(actor.organization_id),
      'staff',private.app_access_flags('staff',actor.id),
      'staffQuotas',jsonb_build_object('akaAgent',private.app_access_quota(actor.organization_id,actor.id,'akaAgent','staff'),
        'akaChat',private.app_access_quota(actor.organization_id,actor.id,'akaChat','staff')),
      'accountQuotas',jsonb_build_object('akaAgent',private.app_access_quota(actor.organization_id,actor.id,'akaAgent','account',COALESCE(p_data->>'platform','zalo')),
        'akaChat',private.app_access_quota(actor.organization_id,actor.id,'akaChat','account')),
      'accounts',COALESCE((SELECT jsonb_object_agg(a.id::text,private.app_access_flags('account',a.id))
        FROM public.auto_accounts a WHERE a.id IN (SELECT value::bigint FROM jsonb_array_elements_text(COALESCE(p_data->'accountIds','[]'::jsonb)))
        AND COALESCE(a.organization_id,(SELECT organization_id FROM public.org_staff WHERE id=a.staff_id))=actor.organization_id AND (a.staff_id=actor.id OR actor.is_admin IS TRUE
          OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_organization_staff_access x
            ON x.chat_zalo_account_organization_id=b.id AND x.organization_id=b.organization_id
            WHERE b.auto_account_id=a.id AND b.organization_id=actor.organization_id AND x.org_staff_id=actor.id AND x.access_role='administrator'))),'{}'::jsonb));
  END IF;
  IF NOT public.aka_agent_app_access_separate(actor.organization_id) THEN RAISE EXCEPTION 'app_access_legacy'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('requestId','targetType','targetId','app','enabled'))
    OR jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'app_access_invalid_input'; END IF;
  rid:=(p_data->>'requestId')::uuid; tid:=(p_data->>'targetId')::bigint; kind:=p_data->>'targetType'; app_name:=p_data->>'app'; enabled:=(p_data->>'enabled')::boolean;
  IF rid IS NULL OR tid IS NULL OR tid<=0 OR kind IS NULL OR kind NOT IN ('account','staff')
    OR app_name IS NULL OR app_name NOT IN ('akaAgent','akaChat') THEN RAISE EXCEPTION 'app_access_invalid_input'; END IF;
  -- Serialize replay even when the same request UUID is submitted against different tenants.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('app-access-request:'||rid::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-staff-management:'||actor.organization_id::text,0));
  SELECT * INTO req FROM private.app_access_requests WHERE request_id=rid;
  IF FOUND THEN
    IF req.organization_id<>actor.organization_id OR req.actor_staff_id IS DISTINCT FROM actor.id OR req.payload IS DISTINCT FROM p_data
      THEN RAISE EXCEPTION 'app_access_request_mismatch'; END IF;
    RETURN req.result || jsonb_build_object('status',CASE WHEN req.status='stopping' AND private.app_access_held(kind,tid) THEN 'stopping' ELSE 'completed' END);
  END IF;
  -- Existing staff management lock first; all staff rows in deterministic order before the account.
  IF kind='account' THEN SELECT staff_id INTO target_owner FROM public.auto_accounts WHERE id=tid AND (organization_id=actor.organization_id OR organization_id IS NULL);
  ELSE target_owner:=tid; END IF;
  PERFORM 1 FROM public.org_staff WHERE id IN (actor.id,target_owner) ORDER BY id FOR UPDATE;
  SELECT * INTO actor FROM public.org_staff WHERE id=p_actor_id AND is_active=true AND deleted_at IS NULL AND public.aka_agent_staff_time_allowed(id);
  IF NOT FOUND THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  SELECT * INTO target_staff FROM public.org_staff WHERE id=target_owner AND organization_id=actor.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  IF kind='staff' THEN
    IF actor.is_admin IS NOT TRUE THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    old_enabled:=CASE app_name WHEN 'akaAgent' THEN target_staff.is_aka_agent_enabled ELSE target_staff.is_akachat_enabled END;
  ELSE
    SELECT * INTO account FROM public.auto_accounts WHERE id=tid AND (organization_id=actor.organization_id OR organization_id IS NULL) AND NOT COALESCE(is_delete,false) FOR UPDATE;
    IF NOT FOUND OR account.staff_id IS DISTINCT FROM target_owner OR (account.staff_id<>actor.id AND actor.is_admin IS NOT TRUE AND NOT EXISTS(
      SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_organization_staff_access x
      ON x.chat_zalo_account_organization_id=b.id AND x.organization_id=b.organization_id
      WHERE b.auto_account_id=account.id AND b.organization_id=actor.organization_id AND x.org_staff_id=actor.id AND x.access_role='administrator'))
      THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    old_enabled:=CASE app_name WHEN 'akaAgent' THEN account.is_aka_agent_enabled ELSE account.is_akachat_enabled END;
    IF app_name='akaChat' AND (lower(account.flatform_type)<>'zalo' OR COALESCE(account.is_zalo_show_web,false))
      THEN RAISE EXCEPTION 'app_access_zalo_only'; END IF;
  END IF;
  IF enabled AND NOT old_enabled THEN
    IF app_name='akaAgent' AND EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.status='stopping' AND
      ((r.target_type=kind AND r.target_id=tid) OR (kind='account' AND r.target_type='staff' AND r.target_id=target_owner))
      AND private.app_access_held(r.target_type,r.target_id)) THEN RAISE EXCEPTION 'app_access_stopping'; END IF;
    q:=private.app_access_quota(actor.organization_id,target_owner,app_name,kind,COALESCE(lower(account.flatform_type),'zalo'));
    IF NOT (q->>'hasPackage')::boolean THEN RAISE EXCEPTION 'app_access_package_required'; END IF;
    IF q->>'limit' IS NOT NULL AND (q->>'used')::integer >= (q->>'limit')::integer THEN
      RAISE EXCEPTION USING MESSAGE=CASE kind WHEN 'staff' THEN 'app_access_staff_limit' ELSE 'app_access_account_limit' END; END IF;
    IF kind='account' AND app_name='akaAgent' AND NOT public.aka_agent_app_access_staff_allowed(target_owner,'akaAgent')
      THEN RAISE EXCEPTION 'app_access_owner_agent_required'; END IF;
    IF kind='account' AND app_name='akaAgent' AND lower(account.flatform_type)='zalo' AND NOT EXISTS (
      SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(actor.organization_id) p WHERE p.account_subtype=
        CASE WHEN account.is_zalo_show_web THEN 'web' WHEN account.is_zalo_server THEN 'server' ELSE 'qr' END AND p.entitlement_id IS NOT NULL)
      THEN RAISE EXCEPTION 'zalo_account_capability_unavailable'; END IF;
  END IF;
  IF NOT enabled AND old_enabled AND kind='staff' AND app_name='akaAgent' AND EXISTS(
    SELECT 1 FROM public.auto_accounts a WHERE a.staff_id=tid AND NOT COALESCE(a.is_delete,false)
      AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_server,false) AND NOT COALESCE(a.is_zalo_show_web,false)
      AND a.is_akachat_enabled) THEN RAISE EXCEPTION 'app_access_local_reader_required'; END IF;
  -- The trigger accepts Desktop flag writes only from this transaction's authenticated receipt.
  INSERT INTO private.app_access_requests(request_id,organization_id,actor_staff_id,target_type,target_id,payload,result,status)
    VALUES(rid,actor.organization_id,actor.id,kind,tid,p_data,jsonb_build_object('transactionId',pg_current_xact_id()::text),'processing');
  PERFORM set_config('aka_agent.app_access_request',rid::text,true);
  -- No command or claim is released here. Existing runtime control observes the permission.
  IF kind='staff' THEN
    IF app_name='akaAgent' THEN UPDATE public.org_staff SET is_aka_agent_enabled=enabled WHERE id=tid;
    ELSE UPDATE public.org_staff SET is_akachat_enabled=enabled WHERE id=tid; END IF;
  ELSE
    IF app_name='akaAgent' THEN UPDATE public.auto_accounts SET is_aka_agent_enabled=enabled WHERE id=tid;
    ELSE UPDATE public.auto_accounts SET is_akachat_enabled=enabled WHERE id=tid; END IF;
  END IF;
  state:=CASE WHEN NOT enabled AND app_name='akaAgent' AND private.app_access_held(kind,tid) THEN 'stopping' ELSE 'completed' END;
  result:=jsonb_build_object('requestId',rid,'status',state,'targetType',kind,'targetId',tid,
    'access',private.app_access_flags(kind,tid)||jsonb_build_object('stopping',state='stopping'));
  UPDATE private.app_access_requests SET result=result,status=state,updated_at=clock_timestamp() WHERE request_id=rid;
  RETURN result;
END $$;

-- Reserve the existing Chat identity before confirming a new Chat seat.
-- Do not move a deleted binding: the established QR/enrollment path owns that reuse.
CREATE FUNCTION private.app_access_reserve_chat_identity(p_account bigint,p_org bigint,p_zalo bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE uid text; chat_id bigint; bound_id bigint; login_id bigint; socket_id bigint;
BEGIN
  SELECT zalo_uid INTO uid FROM public.zalo_accounts WHERE id=p_zalo;
  IF uid IS NULL THEN RAISE EXCEPTION 'app_access_invalid_identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||uid,0));
  -- Flags protect an enrollment waiting to reuse a deleted binding too.
  IF EXISTS(SELECT 1 FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE s.organization_id=p_org AND a.id<>p_account AND NOT COALESCE(a.is_delete,false)
      AND a.is_akachat_enabled AND a.zalo_account_id=p_zalo AND a.login_status='đã đăng nhập') THEN
    RAISE EXCEPTION 'zalo_already_linked';
  END IF;
  IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.auto_account_id=p_account AND (b.organization_id<>p_org OR z.zalo_id<>uid)) THEN
    RAISE EXCEPTION 'account_already_has_another_zalo';
  END IF;
  SELECT b.auto_account_id INTO bound_id FROM public.chat_zalo_account_organization b
    JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.organization_id=p_org AND z.zalo_id=uid FOR UPDATE OF b;
  IF bound_id IS NOT NULL THEN
    IF bound_id<>p_account AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=bound_id AND NOT COALESCE(is_delete,false))
      THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
    RETURN;
  END IF;
  INSERT INTO public.chat_zalo_account(zalo_id) VALUES(uid)
    ON CONFLICT(zalo_id) DO NOTHING;
  SELECT id INTO chat_id FROM public.chat_zalo_account WHERE zalo_id=uid;
  SELECT i.id INTO login_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_login_status' AND i.code='logged_out' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  SELECT i.id INTO socket_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_socket_status' AND i.code='disconnected' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  IF login_id IS NULL OR socket_id IS NULL THEN RAISE EXCEPTION 'app_access_category_missing'; END IF;
  INSERT INTO public.chat_zalo_account_organization(chat_zalo_account_id,organization_id,auto_account_id,
    login_status_category_item_id,socket_status_category_item_id,is_active,runtime_generation)
    VALUES(chat_id,p_org,p_account,login_id,socket_id,false,0);
END $$;

CREATE FUNCTION private.app_access_reserve_enabled_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE org bigint;
BEGIN
  SELECT organization_id INTO org FROM public.org_staff WHERE id=NEW.staff_id;
  IF EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.organization_id=org AND r.target_type='initialize'
    AND r.status='processing' AND r.result->>'transactionId'=pg_current_xact_id()::text) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.is_akachat_enabled IS NOT DISTINCT FROM OLD.is_akachat_enabled
    AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
    AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.login_status IS NOT DISTINCT FROM OLD.login_status
    THEN RETURN NEW; END IF;
  IF public.aka_agent_app_access_separate(org) AND NEW.is_akachat_enabled AND NOT COALESCE(NEW.is_delete,false)
    AND NEW.zalo_account_id IS NOT NULL AND NEW.login_status='đã đăng nhập' THEN
    PERFORM private.app_access_reserve_chat_identity(NEW.id,org,NEW.zalo_account_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_access_reserve_enabled_identity AFTER INSERT OR UPDATE OF is_akachat_enabled,zalo_account_id,is_delete,staff_id,organization_id,login_status
ON public.auto_accounts FOR EACH ROW EXECUTE FUNCTION private.app_access_reserve_enabled_identity();

CREATE FUNCTION private.app_access_validate_account(n public.auto_accounts,o public.auto_accounts DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE owner_row public.org_staff%ROWTYPE; q jsonb; used integer; app_name text; assigned boolean; previous boolean; uid text;
BEGIN
  SELECT * INTO owner_row FROM public.org_staff WHERE id=n.staff_id;
  IF NOT public.aka_agent_app_access_separate(owner_row.organization_id) OR COALESCE(n.is_delete,false) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:'||n.staff_id::text,0));
  FOREACH app_name IN ARRAY ARRAY['akaAgent','akaChat'] LOOP
    assigned:=CASE app_name WHEN 'akaAgent' THEN n.is_aka_agent_enabled ELSE n.is_akachat_enabled END;
    previous:=CASE app_name WHEN 'akaAgent' THEN o.is_aka_agent_enabled ELSE o.is_akachat_enabled END;
    IF NOT assigned OR (previous AND NOT COALESCE(o.is_delete,false)
      AND o.staff_id=n.staff_id AND o.organization_id IS NOT DISTINCT FROM n.organization_id
      AND o.flatform_type IS NOT DISTINCT FROM n.flatform_type
      AND o.is_zalo_show_web IS NOT DISTINCT FROM n.is_zalo_show_web
      AND o.is_zalo_server IS NOT DISTINCT FROM n.is_zalo_server) THEN CONTINUE; END IF;
    IF NOT private.app_access_staff_time_allowed(owner_row.id) OR (n.organization_id IS NOT NULL AND n.organization_id IS DISTINCT FROM owner_row.organization_id)
      THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    q:=private.app_access_quota(owner_row.organization_id,n.staff_id,app_name,'account',lower(n.flatform_type));
    IF NOT (q->>'hasPackage')::boolean THEN RAISE EXCEPTION 'app_access_package_required'; END IF;
    SELECT count(*) INTO used FROM public.auto_accounts a WHERE a.staff_id=n.staff_id AND a.id IS DISTINCT FROM n.id
      AND NOT COALESCE(a.is_delete,false) AND (a.organization_id IS NULL OR a.organization_id=owner_row.organization_id)
      AND CASE app_name WHEN 'akaAgent' THEN a.is_aka_agent_enabled AND lower(a.flatform_type)=lower(n.flatform_type) ELSE a.is_akachat_enabled END;
    IF q->>'limit' IS NOT NULL AND used >= (q->>'limit')::integer THEN RAISE EXCEPTION 'app_access_account_limit'; END IF;
    IF app_name='akaAgent' THEN
      IF NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent') THEN RAISE EXCEPTION 'app_access_owner_agent_required'; END IF;
      IF lower(n.flatform_type)='zalo' AND NOT EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(owner_row.organization_id) p
        WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN n.is_zalo_show_web THEN 'web' WHEN n.is_zalo_server THEN 'server' ELSE 'qr' END)
        THEN RAISE EXCEPTION 'zalo_account_capability_unavailable'; END IF;
    ELSE
      IF lower(n.flatform_type)<>'zalo' OR COALESCE(n.is_zalo_show_web,false) THEN RAISE EXCEPTION 'app_access_zalo_only'; END IF;
      IF NOT COALESCE(n.is_zalo_server,false) AND NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent')
        THEN RAISE EXCEPTION 'app_access_local_reader_required'; END IF;
      SELECT z.zalo_uid INTO uid FROM public.zalo_accounts z WHERE z.id=n.zalo_account_id;
      IF uid IS NOT NULL THEN
        -- Same identity lock as Chat API QR completion, never another UNIQUE or identity record.
        PERFORM pg_advisory_xact_lock(hashtextextended(owner_row.organization_id::text||':'||uid,0));
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          JOIN public.auto_accounts bound ON bound.id=b.auto_account_id
          WHERE b.organization_id=owner_row.organization_id AND z.zalo_id=uid AND b.auto_account_id<>n.id AND NOT COALESCE(bound.is_delete,false))
          THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          WHERE b.auto_account_id=n.id AND z.zalo_id<>uid) THEN RAISE EXCEPTION 'account_already_has_another_zalo'; END IF;
      END IF;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION private.app_access_guard_flags() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE q jsonb; app_name text; assigned boolean; previous boolean; used integer; owner_org bigint; req uuid;
BEGIN
  owner_org:=NEW.organization_id;
  IF owner_org IS NULL AND TG_TABLE_NAME='auto_accounts' THEN
    SELECT organization_id INTO owner_org FROM public.org_staff WHERE id=(to_jsonb(NEW)->>'staff_id')::bigint;
  END IF;
  IF NOT public.aka_agent_app_access_separate(owner_org) THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.organization_id=owner_org AND r.target_type='initialize'
    AND r.status='processing' AND r.result->>'transactionId'=pg_current_xact_id()::text)
    THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.is_aka_agent_enabled IS DISTINCT FROM OLD.is_aka_agent_enabled
    OR NEW.is_akachat_enabled IS DISTINCT FROM OLD.is_akachat_enabled)
    AND current_setting('role',true)='aka_agent_desktop' THEN
    req:=NULLIF(current_setting('aka_agent.app_access_request',true),'')::uuid;
    IF NOT EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.request_id=req AND r.status='processing'
      AND r.result->>'transactionId'=pg_current_xact_id()::text AND r.organization_id=owner_org
      AND r.target_type=CASE TG_TABLE_NAME WHEN 'org_staff' THEN 'staff' ELSE 'account' END
      AND r.target_id=NEW.id AND r.actor_staff_id=private.aka_agent_staff_scope_for_request())
      THEN RAISE EXCEPTION 'app_access_denied' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_TABLE_NAME='auto_accounts' THEN
    PERFORM private.app_access_validate_account(NEW,CASE WHEN TG_OP='UPDATE' THEN OLD ELSE NULL END);
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-staff-management:'||owner_org::text,0));
  FOREACH app_name IN ARRAY ARRAY['akaAgent','akaChat'] LOOP
    assigned:=CASE app_name WHEN 'akaAgent' THEN NEW.is_aka_agent_enabled ELSE NEW.is_akachat_enabled END;
    previous:=TG_OP='UPDATE' AND CASE app_name WHEN 'akaAgent' THEN OLD.is_aka_agent_enabled ELSE OLD.is_akachat_enabled END
      AND OLD.deleted_at IS NULL AND OLD.organization_id=owner_org;
    IF NOT assigned OR previous THEN CONTINUE; END IF;
    q:=private.app_access_quota(owner_org,NEW.id,app_name,'staff');
    IF NOT (q->>'hasPackage')::boolean THEN RAISE EXCEPTION 'app_access_package_required'; END IF;
    SELECT count(*) INTO used FROM public.org_staff s WHERE s.organization_id=owner_org AND s.id IS DISTINCT FROM NEW.id
      AND s.deleted_at IS NULL AND CASE app_name WHEN 'akaAgent' THEN s.is_aka_agent_enabled ELSE s.is_akachat_enabled END;
    IF used >= (q->>'limit')::integer THEN RAISE EXCEPTION 'app_access_staff_limit'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER app_access_guard_flags BEFORE INSERT OR UPDATE OF is_aka_agent_enabled,is_akachat_enabled,is_delete,staff_id,organization_id,flatform_type,is_zalo_show_web,is_zalo_server
ON public.auto_accounts FOR EACH ROW EXECUTE FUNCTION private.app_access_guard_flags();
CREATE TRIGGER app_access_guard_flags BEFORE INSERT OR UPDATE OF is_aka_agent_enabled,is_akachat_enabled,deleted_at,organization_id
ON public.org_staff FOR EACH ROW EXECUTE FUNCTION private.app_access_guard_flags();

CREATE FUNCTION private.app_access_guard_campaign_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
BEGIN
  IF NOT public.aka_agent_app_access_separate(COALESCE(NEW.organization_id,(SELECT organization_id FROM public.org_staff WHERE id=NEW.staff_id))) THEN RETURN NEW; END IF;
  IF (TG_OP='INSERT' AND NOT COALESCE(NEW.is_delete,false)) OR (TG_OP='UPDATE' AND (
    (NEW.runtime_claim_token IS NOT NULL AND NEW.runtime_claim_token IS DISTINCT FROM OLD.runtime_claim_token)
    OR (NEW.runtime_unit_token IS NOT NULL AND NEW.runtime_unit_token IS DISTINCT FROM OLD.runtime_unit_token)
    OR ((NEW.status='đang chạy' OR (NEW.status='chờ xử lý' AND OLD.status<>'đang chạy')) AND NEW.status IS DISTINCT FROM OLD.status)
    OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.secondary_account_id IS DISTINCT FROM OLD.secondary_account_id)) THEN
    PERFORM 1 FROM public.org_staff WHERE id=NEW.staff_id FOR SHARE;
    PERFORM 1 FROM public.auto_accounts WHERE id IN (NEW.account_id,NEW.secondary_account_id) ORDER BY id FOR SHARE;
    IF NOT public.aka_agent_app_access_staff_allowed(NEW.staff_id,'akaAgent')
      OR NOT public.aka_agent_app_access_account_allowed(NEW.account_id,'akaAgent')
      OR (NEW.secondary_account_id IS NOT NULL AND NOT public.aka_agent_app_access_account_allowed(NEW.secondary_account_id,'akaAgent'))
      THEN RAISE EXCEPTION 'app_access_denied' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_access_guard_campaign_claim BEFORE INSERT OR UPDATE OF status,account_id,secondary_account_id,runtime_claim_token,runtime_unit_token
ON public.auto_campaigns FOR EACH ROW EXECUTE FUNCTION private.app_access_guard_campaign_claim();

CREATE FUNCTION private.app_access_guard_account_runtime() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE allowed boolean; req uuid;
BEGIN
  IF NOT public.aka_agent_app_access_separate(COALESCE(NEW.organization_id,(SELECT organization_id FROM public.org_staff WHERE id=NEW.staff_id))) THEN RETURN NEW; END IF;
  IF lower(NEW.flatform_type)='zalo' AND NOT COALESCE(NEW.is_zalo_server,false) AND NOT COALESCE(NEW.is_zalo_show_web,false)
    AND NEW.zalo_session IS NOT NULL AND (TG_OP='INSERT' OR NEW.zalo_session IS DISTINCT FROM OLD.zalo_session
      OR NEW.zalo_account_id IS DISTINCT FROM OLD.zalo_account_id) THEN
    req:=NULLIF(current_setting('aka_agent.app_access_qr_operation',true),'')::uuid;
    IF NOT EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.request_id=req AND r.target_type='qr'
      AND r.target_id=NEW.id AND r.status='completed' AND r.result->>'transactionId'=pg_current_xact_id()::text
      AND r.result->>'claimToken'=NEW.runtime_operation_claim_token::text
      AND (r.result->>'zaloAccountId')::bigint=NEW.zalo_account_id) THEN RAISE EXCEPTION 'app_access_qr_required'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF (NEW.runtime_operation_claim_token IS NOT NULL AND NEW.runtime_operation_claim_token IS DISTINCT FROM OLD.runtime_operation_claim_token)
    OR (NEW.zalo_session IS NOT NULL AND NEW.zalo_session IS DISTINCT FROM OLD.zalo_session)
    OR (NEW.zalo_account_id IS NOT NULL AND NEW.zalo_account_id IS DISTINCT FROM OLD.zalo_account_id) THEN
    PERFORM 1 FROM public.org_staff WHERE id=NEW.staff_id FOR SHARE;
    IF private.aka_agent_staff_scope_for_request() IS NOT NULL AND NOT public.aka_agent_app_access_staff_allowed(NEW.staff_id,'akaAgent') THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    allowed:=public.aka_agent_app_access_account_allowed(NEW.id,'akaAgent') OR public.aka_agent_app_access_account_allowed(NEW.id,'akaChat');
    IF NOT allowed THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  ELSIF (NEW.status='đang chạy' OR (NEW.status='chờ xử lý' AND OLD.status<>'đang chạy')) AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.runtime_operation_claim_token IS NULL AND OLD.runtime_operation_claim_token IS NULL
    AND NOT public.aka_agent_app_access_account_allowed(NEW.id,'akaAgent') THEN
    RAISE EXCEPTION 'app_access_denied';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_access_guard_account_runtime BEFORE INSERT OR UPDATE OF status,runtime_operation_claim_token,zalo_account_id,zalo_session
ON public.auto_accounts FOR EACH ROW EXECUTE FUNCTION private.app_access_guard_account_runtime();

-- Piggyback on existing cleanup writes: no worker, timer, polling or claim release.
CREATE FUNCTION private.app_access_finish_stops() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private AS $$
BEGIN
  UPDATE private.app_access_requests r SET status='completed',result=r.result||jsonb_build_object('status','completed',
    'access',r.result->'access'||jsonb_build_object('stopping',false)),updated_at=clock_timestamp()
  WHERE r.status='stopping' AND r.organization_id=COALESCE(NEW.organization_id,(SELECT organization_id FROM public.org_staff WHERE id=NEW.staff_id))
    AND ((r.target_type='staff' AND r.target_id=NEW.staff_id) OR
      (r.target_type='account' AND r.target_id=ANY(CASE TG_TABLE_NAME WHEN 'auto_accounts' THEN ARRAY[NEW.id] ELSE ARRAY[(to_jsonb(NEW)->>'account_id')::bigint,(to_jsonb(NEW)->>'secondary_account_id')::bigint] END)))
    AND NOT private.app_access_held(r.target_type,r.target_id);
  RETURN NEW;
END $$;
CREATE TRIGGER app_access_finish_stops AFTER UPDATE OF status,runtime_operation_claim_token ON public.auto_accounts
FOR EACH ROW EXECUTE FUNCTION private.app_access_finish_stops();
CREATE TRIGGER app_access_finish_stops AFTER UPDATE OF status,runtime_claim_token,runtime_unit_token ON public.auto_campaigns
FOR EACH ROW EXECUTE FUNCTION private.app_access_finish_stops();

CREATE FUNCTION public.aka_agent_app_access_state(p_type text,p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE actor bigint:=private.aka_agent_staff_scope_for_request();
BEGIN
  IF actor IS NOT NULL AND NOT (
    (p_type='staff' AND p_id=actor) OR (p_type='account' AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_id AND staff_id=actor))
  ) THEN RAISE EXCEPTION 'app_access_denied' USING ERRCODE='42501'; END IF;
  RETURN private.app_access_flags(p_type,p_id);
END $$;
CREATE FUNCTION public.aka_agent_app_access_quota(p_org bigint,p_staff bigint,p_app text,p_type text,p_platform text DEFAULT 'zalo')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT private.app_access_quota(p_org,p_staff,p_app,p_type,p_platform)
$$;

-- Keep transport until an existing producer has acknowledged cleanup. This never
-- authorizes a new command; dispatch and claim guards use account_allowed.
CREATE FUNCTION public.aka_agent_app_access_runtime_allowed(p_account bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT public.aka_agent_app_access_account_allowed(p_account,'akaChat')
    OR public.aka_agent_app_access_account_allowed(p_account,'akaAgent')
    OR private.app_access_held('account',p_account)
$$;

CREATE FUNCTION public.aka_agent_app_access_chat_organizations(p_orgs bigint[]) RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
  SELECT id FROM unnest(p_orgs) id WHERE public.aka_agent_app_access_separate(id)
    OR public.aka_agent_app_access_chat_runtime(id)
$$;

-- Main/backend only. Sessions remain inside the owning runtime, never in a UI snapshot.
CREATE FUNCTION public.aka_agent_app_access_runtime_accounts(p_staff bigint,p_ids bigint[] DEFAULT NULL,p_sessions boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private SET statement_timeout='60s' AS $$
DECLARE actor bigint:=private.aka_agent_staff_scope_for_request();
BEGIN
  IF (actor IS NOT NULL AND actor IS DISTINCT FROM p_staff) OR
    (actor IS NULL AND current_setting('role',true) NOT IN ('service_role','aka_agent_chat_api') AND session_user NOT IN ('postgres','aka_agent_chat_api'))
    OR NOT (public.aka_agent_app_access_staff_allowed(p_staff,'akaAgent') OR private.app_access_held('staff',p_staff))
    THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  RETURN COALESCE((SELECT jsonb_agg((CASE WHEN p_sessions THEN to_jsonb(a) ELSE to_jsonb(a)-'zalo_session' END)
      || jsonb_build_object('zalo_accounts',to_jsonb(z),'app_access',private.app_access_flags('account',a.id)))
    FROM public.auto_accounts a LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff AND NOT COALESCE(a.is_delete,false) AND lower(a.flatform_type)='zalo'
      AND (p_ids IS NULL OR a.id=ANY(p_ids))
      AND public.aka_agent_app_access_runtime_allowed(a.id)),'[]'::jsonb);
END $$;

-- The SELECT scope also protects old Desktop clients. The RPC exceptions below
-- use PostgREST's request path (not a caller header) and keep the existing owner
-- policy plus the exact claim/token/receipt guards of these invoker functions.
-- They cannot expose a list through /auto_accounts, including embedded/count reads.
CREATE POLICY app_access_desktop_accounts ON public.auto_accounts AS RESTRICTIVE FOR SELECT TO aka_agent_desktop
USING (is_aka_agent_enabled OR NOT public.aka_agent_app_access_separate(
    COALESCE(organization_id,(SELECT profile.organization_id FROM public.aka_agent_staff_runtime_profile profile WHERE profile.id=auto_accounts.staff_id)))
  OR (current_setting('request.method',true)='POST' AND current_setting('request.path',true)=ANY(ARRAY[
    '/rpc/aka_agent_app_access_local_session',
    '/rpc/aka_agent_claim_account_operation','/rpc/aka_agent_cleanup_account_operation',
    '/rpc/aka_agent_facebook_account_operation','/rpc/release_zalo_account_runtime_operation',
    '/rpc/aka_agent_settle_campaign_run_unit_v2','/rpc/aka_agent_cleanup_failed_campaign_runtime',
    '/rpc/aka_agent_recover_campaign_runtime_unit_leases','/rpc/inspect_staff_zalo_running_state',
    '/rpc/recover_server_zalo_running_state','/rpc/reset_desktop_running_statuses_no_retry'
  ])));

-- QR origin is sealed before scanning; no credentials/session enter the receipt.
CREATE FUNCTION public.aka_agent_app_access_qr_operation(p_owner bigint,p_account bigint,p_operation uuid,p_action text,p_data jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private
SET lock_timeout='3s' SET statement_timeout='12s' AS $$
DECLARE scope bigint:=private.aka_agent_staff_scope_for_request(); a public.auto_accounts%ROWTYPE;
  r private.app_access_requests%ROWTYPE; actor bigint; app_name text; token uuid; payload jsonb;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('prepare','begin','bind','cancel','commit') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
    OR (scope IS NOT NULL AND scope IS DISTINCT FROM p_owner)
    OR (scope IS NULL AND current_setting('role',true) NOT IN ('service_role','aka_agent_chat_api') AND session_user NOT IN ('postgres','aka_agent_chat_api'))
    THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  -- Receipt actor/payload are immutable. Read the sealed actor before taking row locks.
  SELECT actor_staff_id INTO actor FROM private.app_access_requests WHERE request_id=p_operation;
  IF p_action='prepare' THEN actor:=(p_data->>'actorStaffId')::bigint; END IF;
  IF p_action='begin' THEN actor:=p_owner; END IF;
  -- Same order as permission mutation: staff -> account -> receipt/identity.
  PERFORM 1 FROM public.org_staff WHERE id IN (p_owner,actor) ORDER BY id FOR SHARE;
  SELECT * INTO a FROM public.auto_accounts WHERE id=p_account AND staff_id=p_owner FOR UPDATE;
  IF NOT FOUND OR COALESCE(a.is_delete,false) OR a.flatform_type<>'zalo' OR a.is_zalo_server OR a.is_zalo_show_web THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  IF NOT public.aka_agent_app_access_separate(COALESCE(a.organization_id,(SELECT organization_id FROM public.org_staff WHERE id=p_owner))) THEN RETURN; END IF;
  IF p_operation IS NULL THEN RAISE EXCEPTION 'app_access_qr_required'; END IF;
  SELECT * INTO r FROM private.app_access_requests WHERE request_id=p_operation FOR UPDATE;
  token:=(p_data->>'claimToken')::uuid;
  IF p_action IN ('prepare','begin') THEN
    IF p_action='prepare' THEN
      IF scope IS NOT NULL THEN RAISE EXCEPTION 'app_access_denied'; END IF;
      actor:=(p_data->>'actorStaffId')::bigint; app_name:=p_data->>'app';
    ELSE actor:=p_owner; app_name:='akaAgent'; END IF;
    IF app_name IS NULL OR app_name NOT IN ('akaAgent','akaChat') OR NOT EXISTS(
      SELECT 1 FROM public.org_staff s WHERE s.id=actor AND s.organization_id=COALESCE(a.organization_id,(SELECT organization_id FROM public.org_staff WHERE id=p_owner))
        AND public.aka_agent_app_access_staff_allowed(s.id,app_name)
        AND (s.id=p_owner OR s.is_admin OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b
          JOIN public.chat_zalo_account_organization_staff_access x ON x.chat_zalo_account_organization_id=b.id AND x.organization_id=b.organization_id
          WHERE b.auto_account_id=a.id AND b.organization_id=s.organization_id AND x.org_staff_id=s.id AND x.access_role='administrator')))
      OR NOT public.aka_agent_app_access_account_allowed(a.id,app_name)
      OR NOT public.aka_agent_app_access_staff_allowed(p_owner,'akaAgent') THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    IF p_action='begin' AND (token IS NULL OR token IS DISTINCT FROM a.runtime_operation_claim_token) THEN RAISE EXCEPTION 'app_access_qr_stale'; END IF;
    payload:=jsonb_build_object('ownerStaffId',p_owner,'app',app_name);
    IF r.request_id IS NOT NULL THEN
      IF r.target_type<>'qr' OR r.target_id<>a.id OR r.actor_staff_id IS DISTINCT FROM actor OR r.payload IS DISTINCT FROM payload
        OR r.status<>'processing' OR (p_action='begin' AND r.result->>'claimToken' IS DISTINCT FROM token::text)
        THEN RAISE EXCEPTION 'app_access_qr_stale'; END IF;
      RETURN;
    END IF;
    IF p_action='begin' AND EXISTS(SELECT 1 FROM private.app_access_requests other WHERE other.target_type='qr'
      AND other.target_id=a.id AND other.result->>'claimToken'=token::text) THEN RAISE EXCEPTION 'app_access_qr_stale'; END IF;
    INSERT INTO private.app_access_requests(request_id,organization_id,actor_staff_id,target_type,target_id,payload,result,status)
      VALUES(p_operation,COALESCE(a.organization_id,(SELECT organization_id FROM public.org_staff WHERE id=p_owner)),actor,'qr',a.id,payload,
        CASE WHEN p_action='begin' THEN jsonb_build_object('claimToken',token) ELSE '{}'::jsonb END,'processing');
    RETURN;
  END IF;
  IF r.request_id IS NULL OR r.target_type<>'qr' OR r.target_id<>a.id OR (r.payload->>'ownerStaffId')::bigint<>p_owner THEN RAISE EXCEPTION 'app_access_qr_stale'; END IF;
  IF p_action='cancel' THEN
    UPDATE private.app_access_requests SET status='completed',result=result||'{"cancelled":true}'::jsonb,updated_at=clock_timestamp() WHERE request_id=p_operation AND status='processing';
    RETURN;
  END IF;
  IF r.status<>'processing' OR token IS NULL OR token IS DISTINCT FROM a.runtime_operation_claim_token
    OR EXISTS(SELECT 1 FROM private.app_access_requests other WHERE other.target_type='qr' AND other.request_id<>p_operation
      AND other.target_id=a.id AND other.result->>'claimToken'=token::text) THEN RAISE EXCEPTION 'app_access_qr_stale'; END IF;
  IF p_action='bind' THEN
    IF r.result ? 'claimToken' AND r.result->>'claimToken' IS DISTINCT FROM token::text THEN RAISE EXCEPTION 'app_access_qr_stale'; END IF;
    UPDATE private.app_access_requests SET result=jsonb_build_object('claimToken',token),updated_at=clock_timestamp() WHERE request_id=p_operation;
    RETURN;
  END IF;
  IF r.result->>'claimToken' IS DISTINCT FROM token::text
    OR NOT public.aka_agent_app_access_staff_allowed(r.actor_staff_id,r.payload->>'app')
    OR NOT public.aka_agent_app_access_staff_allowed(p_owner,'akaAgent')
    OR NOT public.aka_agent_app_access_account_allowed(a.id,r.payload->>'app')
    OR NOT EXISTS(SELECT 1 FROM public.org_staff WHERE id=r.actor_staff_id AND organization_id=r.organization_id)
    THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  PERFORM private.app_access_reserve_chat_identity(a.id,r.organization_id,(p_data->>'zaloAccountId')::bigint);
  -- Recheck shared/admin management too, under the binding lock used by ACL writers.
  PERFORM 1 FROM public.chat_zalo_account_organization WHERE auto_account_id=a.id FOR UPDATE;
  IF r.actor_staff_id<>p_owner AND NOT EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=r.actor_staff_id AND
    (s.is_admin OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_organization_staff_access x
      ON x.chat_zalo_account_organization_id=b.id AND x.organization_id=b.organization_id
      WHERE b.auto_account_id=a.id AND b.organization_id=r.organization_id AND x.org_staff_id=s.id AND x.access_role='administrator')))
    THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  UPDATE private.app_access_requests SET status='completed',result=result||jsonb_build_object('transactionId',pg_current_xact_id()::text,
    'zaloAccountId',p_data->'zaloAccountId'),updated_at=clock_timestamp() WHERE request_id=p_operation;
  PERFORM set_config('aka_agent.app_access_qr_operation',p_operation::text,true);
END $$;

-- Main-only local reader writes. SECURITY INVOKER retains owner RLS and all
-- existing identity/session triggers; no arbitrary column update or new claim path.
CREATE FUNCTION public.aka_agent_app_access_local_session(p_staff bigint,p_account bigint,p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public SET lock_timeout='3s' SET statement_timeout='12s' AS $$
DECLARE a public.auto_accounts%ROWTYPE; result jsonb; scope bigint:=private.aka_agent_staff_scope_for_request();
BEGIN
  IF (scope IS NOT NULL AND scope IS DISTINCT FROM p_staff) OR
    (scope IS NULL AND current_setting('role',true) NOT IN ('service_role','aka_agent_chat_api') AND session_user NOT IN ('postgres','aka_agent_chat_api'))
    OR p_action IS NULL OR p_action NOT IN ('pause_route','commit','mark','clear','clear_invalid') OR jsonb_typeof(p_data)<>'object'
    THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  IF p_action='commit' THEN
    PERFORM public.aka_agent_app_access_qr_operation(p_staff,p_account,(p_data->>'qrOperationId')::uuid,'commit',p_data);
  END IF;
  PERFORM 1 FROM public.aka_agent_staff_runtime_scope(p_staff,'share') WHERE id=p_staff;
  IF NOT FOUND THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  SELECT * INTO a FROM public.auto_accounts WHERE id=p_account AND staff_id=p_staff FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_action='pause_route' THEN
    RETURN jsonb_build_object('id',a.id,'flatform_type',a.flatform_type,'is_zalo_server',a.is_zalo_server);
  END IF;
  IF a.flatform_type<>'zalo' OR a.is_zalo_server OR a.is_zalo_show_web OR COALESCE(a.is_delete,false) THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  IF p_action IN ('commit','mark') AND NOT (
    public.aka_agent_app_access_staff_allowed(p_staff,'akaAgent') AND
    (public.aka_agent_app_access_account_allowed(p_account,'akaAgent') OR public.aka_agent_app_access_account_allowed(p_account,'akaChat'))
  ) THEN RAISE EXCEPTION 'app_access_denied'; END IF;
  IF p_action='commit' THEN
    IF p_data->'session' IS NULL OR jsonb_typeof(p_data->'session')<>'object' OR NULLIF(p_data->>'zaloAccountId','') IS NULL
      THEN RAISE EXCEPTION 'app_access_invalid_input'; END IF;
    UPDATE public.auto_accounts SET zalo_account_id=(p_data->>'zaloAccountId')::bigint,zalo_session=p_data->'session',
      zalo_session_updated_at=now(),zalo_session_last_verified_at=CASE WHEN (p_data->>'verified')::boolean THEN now() ELSE NULL END,
      zalo_session_last_error=CASE WHEN p_data->>'clearError'='false' THEN a.zalo_session_last_error ELSE NULL END,
      login_status=CASE WHEN (p_data->>'verified')::boolean THEN 'đã đăng nhập' ELSE a.login_status END,updated_at=now() WHERE id=a.id;
  ELSIF p_action='mark' THEN
    UPDATE public.auto_accounts SET login_status=CASE WHEN (p_data->>'ok')::boolean THEN 'đã đăng nhập' ELSE 'chưa đăng nhập' END,
      zalo_session_last_verified_at=CASE WHEN (p_data->>'ok')::boolean THEN now() ELSE a.zalo_session_last_verified_at END,
      zalo_session_last_error=CASE WHEN (p_data->>'ok')::boolean THEN NULL ELSE p_data->>'error' END,updated_at=now() WHERE id=a.id;
  ELSE
    IF p_action='clear_invalid' AND (a.zalo_session IS NULL OR a.zalo_session_updated_at IS DISTINCT FROM (p_data->>'expectedSessionUpdatedAt')::timestamptz) THEN RETURN NULL; END IF;
    UPDATE public.auto_accounts SET zalo_session=NULL,zalo_session_updated_at=NULL,zalo_session_last_verified_at=NULL,
      zalo_session_last_error=CASE WHEN p_action='clear_invalid' THEN p_data->>'error' ELSE NULL END,
      login_status='chưa đăng nhập',updated_at=now() WHERE id=a.id;
  END IF;
  SELECT (to_jsonb(updated)-'zalo_session')||jsonb_build_object('zalo_accounts',to_jsonb(z)) INTO result
    FROM public.auto_accounts updated LEFT JOIN public.zalo_accounts z ON z.id=updated.zalo_account_id WHERE updated.id=a.id;
  RETURN result;
END $$;

-- Called by the existing IP pre-request hook (private source); never replaces its IP checks.
CREATE FUNCTION public.aka_agent_app_access_check_request() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE actor bigint;
BEGIN
  actor:=private.aka_agent_staff_scope_for_request();
  IF actor IS NULL OR public.aka_agent_app_access_staff_allowed(actor,'akaAgent') THEN RETURN; END IF;
  -- Existing claims retain their scoped cleanup context, including restart recovery.
  -- Claim/account triggers still reject new work; never revoke the context before receipts settle.
  IF private.app_access_held('staff',actor) THEN RETURN; END IF;
  RAISE SQLSTATE 'PT403' USING MESSAGE='app_access_denied';
END $$;

DO $acl$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='private' AND p.proname LIKE 'app_access_%') OR (n.nspname='public' AND p.proname LIKE 'aka_agent_app_access%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,aka_agent_desktop,aka_agent_chat_api',f.signature);
  END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_separate(bigint),
  public.aka_agent_app_access_staff_allowed(bigint,text),public.aka_agent_app_access_account_allowed(bigint,text),
  public.aka_agent_app_access_chat_runtime(bigint,boolean),public.aka_agent_app_access(bigint,text,text,text,jsonb)
TO service_role,aka_agent_desktop,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_state(text,bigint) TO service_role,aka_agent_desktop,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_quota(bigint,bigint,text,text,text) TO service_role,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_runtime_allowed(bigint) TO service_role,aka_agent_desktop,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_chat_organizations(bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_local_session(bigint,bigint,text,jsonb) TO service_role,aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb) TO service_role,aka_agent_desktop,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_runtime_accounts(bigint,bigint[],boolean) TO service_role,aka_agent_desktop,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_app_access_check_request() TO anon,authenticated,service_role,aka_agent_desktop;
NOTIFY pgrst,'reload schema';
COMMIT;
