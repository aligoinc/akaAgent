BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Live source captured from linked project cgjbsmqtfhqvttudyjzq on 2026-09-03:
--   public.aka_agent_internal_normalize_phone(text)
--   md5(pg_get_functiondef) = b3ad52bceed9a68a6648956fbc622629
-- The four RPC signatures and the target table did not exist at capture time.
DO $preflight$
DECLARE
  v_phone_helper regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_normalize_phone(text)'
  );
  v_phone_helper_md5 text;
  v_signature text;
BEGIN
  IF pg_catalog.to_regclass('public.auto_zalo_message_opt_outs') IS NOT NULL THEN
    RAISE EXCEPTION 'zalo message opt-out table already exists';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)',
    'public.aka_agent_prepare_zalo_message_opt_out(bigint,bigint,bigint,text,text)',
    'public.aka_agent_inspect_zalo_message_opt_out(uuid)',
    'public.aka_agent_confirm_zalo_message_opt_out(uuid)'
  ]
  LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NOT NULL THEN
      RAISE EXCEPTION 'zalo message opt-out RPC already exists: %', v_signature;
    END IF;
  END LOOP;

  IF v_phone_helper IS NULL THEN
    RAISE EXCEPTION 'required phone normalizer is missing';
  END IF;

  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(v_phone_helper))
  INTO v_phone_helper_md5;
  IF v_phone_helper_md5 IS DISTINCT FROM 'b3ad52bceed9a68a6648956fbc622629' THEN
    RAISE EXCEPTION
      'phone normalizer changed unexpectedly (expected %, got %)',
      'b3ad52bceed9a68a6648956fbc622629',
      v_phone_helper_md5;
  END IF;
END;
$preflight$;

CREATE TABLE public.auto_zalo_message_opt_outs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  phone text NULL,
  email text NULL,
  zalo_global_id text NOT NULL,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  confirmed_at timestamptz NULL
);

CREATE UNIQUE INDEX auto_zalo_message_opt_outs_scope_global_id_uidx
  ON public.auto_zalo_message_opt_outs (staff_id, organization_id, zalo_global_id);

CREATE INDEX auto_zalo_message_opt_outs_scope_phone_idx
  ON public.auto_zalo_message_opt_outs (staff_id, organization_id, phone);

ALTER TABLE public.auto_zalo_message_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auto_zalo_message_opt_outs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.auto_zalo_message_opt_outs TO service_role;

COMMENT ON TABLE public.auto_zalo_message_opt_outs IS
  'Stable per-tenant Zalo opt-out links. confirmed_at NULL means issued but not opted out.';
COMMENT ON COLUMN public.auto_zalo_message_opt_outs.email IS
  'Reserved for future use; Zalo runtime does not read or match this column.';

CREATE FUNCTION public.aka_agent_check_zalo_message_opt_out(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_phone text DEFAULT NULL,
  p_zalo_global_id text DEFAULT NULL
)
RETURNS TABLE (
  is_opted_out boolean,
  matched_by text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_organization_id bigint;
  v_phone text := NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '');
  v_zalo_global_id text := NULLIF(pg_catalog.btrim(p_zalo_global_id), '');
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_zalo_message_opt_out_scope';
  END IF;

  SELECT campaign.organization_id
  INTO v_organization_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = campaign.organization_id
   AND account.flatform_type = 'zalo'
   AND COALESCE(account.is_delete, false) = false
  JOIN public.org_staff AS staff
    ON staff.id = p_staff_id
   AND staff.organization_id = campaign.organization_id
   AND staff.is_active = true
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_message_friend',
      'zalo_message_birthday',
      'zalo_message_group_member',
      'zalo_message_group_realtime',
      'zalo_message_remarketing_customer',
      'zalo_message_friend_recommendation'
    )
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_message_opt_out_scope_not_found';
  END IF;

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_zalo_message_opt_outs AS opt_out
    WHERE opt_out.staff_id = p_staff_id
      AND opt_out.organization_id = v_organization_id
      AND opt_out.phone = v_phone
      AND opt_out.confirmed_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT true, 'phone'::text;
    RETURN;
  END IF;

  IF v_zalo_global_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_zalo_message_opt_outs AS opt_out
    WHERE opt_out.staff_id = p_staff_id
      AND opt_out.organization_id = v_organization_id
      AND opt_out.zalo_global_id = v_zalo_global_id
      AND opt_out.confirmed_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT true, 'zalo_global_id'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text;
END;
$function$;

CREATE FUNCTION public.aka_agent_prepare_zalo_message_opt_out(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_phone text,
  p_zalo_global_id text
)
RETURNS TABLE (
  id uuid,
  is_opted_out boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_organization_id bigint;
  v_phone text := NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '');
  v_zalo_global_id text := NULLIF(pg_catalog.btrim(p_zalo_global_id), '');
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_zalo_message_opt_out_scope';
  END IF;
  IF v_zalo_global_id IS NULL THEN
    RAISE EXCEPTION 'zalo_global_id_required';
  END IF;

  SELECT campaign.organization_id
  INTO v_organization_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = campaign.organization_id
   AND account.flatform_type = 'zalo'
   AND COALESCE(account.is_delete, false) = false
  JOIN public.org_staff AS staff
    ON staff.id = p_staff_id
   AND staff.organization_id = campaign.organization_id
   AND staff.is_active = true
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_message_friend',
      'zalo_message_birthday',
      'zalo_message_group_member',
      'zalo_message_group_realtime',
      'zalo_message_remarketing_customer',
      'zalo_message_friend_recommendation'
    )
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_message_opt_out_scope_not_found';
  END IF;

  RETURN QUERY
  INSERT INTO public.auto_zalo_message_opt_outs AS opt_out (
    phone,
    zalo_global_id,
    staff_id,
    organization_id
  )
  VALUES (
    v_phone,
    v_zalo_global_id,
    p_staff_id,
    v_organization_id
  )
  ON CONFLICT (staff_id, organization_id, zalo_global_id)
  DO UPDATE SET phone = COALESCE(EXCLUDED.phone, opt_out.phone)
  RETURNING opt_out.id, opt_out.confirmed_at IS NOT NULL;
END;
$function$;

CREATE FUNCTION public.aka_agent_inspect_zalo_message_opt_out(p_id uuid)
RETURNS TABLE (state text)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN opt_out.confirmed_at IS NULL THEN 'pending'
        ELSE 'confirmed'
      END
      FROM public.auto_zalo_message_opt_outs AS opt_out
      WHERE opt_out.id = p_id
    ),
    'invalid'
  )::text
$function$;

CREATE FUNCTION public.aka_agent_confirm_zalo_message_opt_out(p_id uuid)
RETURNS TABLE (state text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
BEGIN
  UPDATE public.auto_zalo_message_opt_outs AS opt_out
  SET confirmed_at = COALESCE(opt_out.confirmed_at, pg_catalog.clock_timestamp())
  WHERE opt_out.id = p_id;

  IF FOUND THEN
    RETURN QUERY SELECT 'confirmed'::text;
  ELSE
    RETURN QUERY SELECT 'invalid'::text;
  END IF;
END;
$function$;

ALTER FUNCTION public.aka_agent_check_zalo_message_opt_out(bigint, bigint, bigint, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.aka_agent_prepare_zalo_message_opt_out(bigint, bigint, bigint, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.aka_agent_inspect_zalo_message_opt_out(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.aka_agent_confirm_zalo_message_opt_out(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.aka_agent_check_zalo_message_opt_out(bigint, bigint, bigint, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_prepare_zalo_message_opt_out(bigint, bigint, bigint, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_inspect_zalo_message_opt_out(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_confirm_zalo_message_opt_out(uuid)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.aka_agent_check_zalo_message_opt_out(bigint, bigint, bigint, text, text)
  TO anon, authenticated, service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_prepare_zalo_message_opt_out(bigint, bigint, bigint, text, text)
  TO anon, authenticated, service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_inspect_zalo_message_opt_out(uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_confirm_zalo_message_opt_out(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_check_zalo_message_opt_out(bigint, bigint, bigint, text, text) IS
  'Tenant-scoped fail-closed database lookup used by runtimes as a fail-open delivery gate.';
COMMENT ON FUNCTION public.aka_agent_prepare_zalo_message_opt_out(bigint, bigint, bigint, text, text) IS
  'Atomically creates or reuses the stable opt-out UUID for a Zalo global ID.';
COMMENT ON FUNCTION public.aka_agent_inspect_zalo_message_opt_out(uuid) IS
  'Public-page server RPC that returns only invalid, pending, or confirmed without PII.';
COMMENT ON FUNCTION public.aka_agent_confirm_zalo_message_opt_out(uuid) IS
  'Idempotently confirms a Zalo message opt-out UUID; GET/HEAD must never call this RPC.';

DO $postflight$
DECLARE
  v_signature text;
  v_definition text;
  v_acl aclitem[];
  v_function_oid oid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.auto_zalo_message_opt_outs'::regclass
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on auto_zalo_message_opt_outs';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.auto_zalo_message_opt_outs', 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.auto_zalo_message_opt_outs', 'SELECT')
    OR pg_catalog.has_table_privilege('aka_agent_chat_api', 'public.auto_zalo_message_opt_outs', 'SELECT') THEN
    RAISE EXCEPTION 'runtime roles must not have direct table read access';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)',
    'public.aka_agent_prepare_zalo_message_opt_out(bigint,bigint,bigint,text,text)',
    'public.aka_agent_inspect_zalo_message_opt_out(uuid)',
    'public.aka_agent_confirm_zalo_message_opt_out(uuid)'
  ]
  LOOP
    SELECT routine.oid, pg_catalog.pg_get_functiondef(routine.oid), routine.proacl
    INTO v_function_oid, v_definition, v_acl
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(v_signature)
      AND routine.proowner = 'postgres'::regrole
      AND routine.prosecdef = true
      AND routine.proconfig = ARRAY['search_path=pg_catalog, public'];
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RPC security attributes are invalid: %', v_signature;
    END IF;
    IF v_acl IS NULL OR EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(v_acl) AS permission
      WHERE permission.grantee = 0
        AND permission.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'RPC still grants EXECUTE to PUBLIC: %', v_signature;
    END IF;
  END LOOP;
END;
$postflight$;

-- Target pg_get_functiondef checksums validated against linked production in a
-- transaction that was rolled back on 2026-09-03:
--   check   92b00c0827a801e9ffece28d14805f84
--   prepare 0217c031e0d6aaef63c2589cbe1f7b94
--   inspect abd87ff2937831d2ee3ab999f2ebe091
--   confirm 4fe1c52c866b3afec96e956302a52eee
COMMIT;
