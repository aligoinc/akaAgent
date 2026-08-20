-- Allow authenticated one-time Data Group snapshots for direct Zalo Server
-- campaigns. The tenant wrapper resolves the account subtype; the preserved
-- core authoritatively rechecks that runtime target after locking campaign and
-- account, so subtype conversion cannot race the snapshot.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  v_wrapper_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_core_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_wrapper_definition text;
  v_core_definition text;
  v_wrapper_checksum text;
  v_core_checksum text;
  v_source_wrapper_checksum constant text := '3fbd438adaf2012cdf624528919219d6';
  v_source_core_checksum constant text := 'f8f73ae72d05f81ac666c9b63c1ee2ca';
  v_target_wrapper_checksum constant text := 'de05a4568d87acdfa2171517fe3f7c57';
  v_target_core_checksum constant text := 'fb238e9d8f3afa759f82d48388599795';
  v_old_wrapper_declaration constant text := $old_wrapper_declaration$
DECLARE
  v_action_id text;
  v_completed_result jsonb;
BEGIN
$old_wrapper_declaration$;
  v_new_wrapper_declaration constant text := $new_wrapper_declaration$
DECLARE
  v_action_id text;
  v_completed_result jsonb;
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
  v_result jsonb;
BEGIN
$new_wrapper_declaration$;
  v_old_wrapper_delegate constant text := $old_wrapper_delegate$
  RETURN public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_campaign_id,
    p_group_id,
    p_campaign_schedule,
    p_campaign_status,
    p_auth_username,
    p_auth_password
  );
$old_wrapper_delegate$;
  v_new_wrapper_delegate constant text := $new_wrapper_delegate$
  -- The desktop app is a tenant control surface for both runtime owners. Route
  -- this DB-only provisioning mutation by the persisted account subtype, then
  -- let the core repeat the proof under its campaign/account locks.
  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    v_result := public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
      p_staff_id,
      p_organization_id,
      p_request_id,
      p_campaign_id,
      p_group_id,
      p_campaign_schedule,
      p_campaign_status,
      p_auth_username,
      p_auth_password
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
$new_wrapper_delegate$;
  v_old_core_declaration constant text := $old_core_declaration$
  v_has_relationship boolean;
  v_account_is_server boolean;
BEGIN
$old_core_declaration$;
  v_new_core_declaration constant text := $new_core_declaration$
  v_has_relationship boolean;
  v_account_runtime_target text;
  v_runtime_target text := lower(btrim(COALESCE(
    NULLIF(current_setting('aka_agent.zalo_runtime_target', true), ''),
    'desktop'
  )));
BEGIN
$new_core_declaration$;
  v_old_core_guard constant text := $old_core_guard$
  -- Campaign is already locked above. Lock account second so campaign claims
  -- and subtype conversion cannot race this Desktop ownership decision.
  SELECT COALESCE(account.is_zalo_server, false)
  INTO v_account_is_server
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_account_not_found';
  END IF;
  IF v_account_is_server THEN
    RAISE EXCEPTION 'direct_campaign_runtime_not_owner';
  END IF;
$old_core_guard$;
  v_new_core_guard constant text := $new_core_guard$
  -- Campaign is already locked above. Lock account second so campaign claims
  -- and subtype conversion cannot race this runtime ownership decision.
  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_account_runtime_target
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_account_not_found';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server')
    OR v_runtime_target IS DISTINCT FROM v_account_runtime_target
  THEN
    RAISE EXCEPTION 'direct_campaign_runtime_not_owner';
  END IF;
$new_core_guard$;
  v_wrapper_owner name;
  v_core_owner name;
  v_wrapper_security_definer boolean;
  v_core_security_definer boolean;
  v_wrapper_volatility "char";
  v_core_volatility "char";
  v_wrapper_config text[];
  v_core_config text[];
BEGIN
  IF v_wrapper_signature IS NULL OR v_core_signature IS NULL THEN
    RAISE EXCEPTION 'v243 preflight: direct snapshot signature missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_wrapper_signature),
         pg_catalog.md5(pg_catalog.pg_get_functiondef(v_wrapper_signature)),
         pg_catalog.pg_get_userbyid(routine.proowner),
         routine.prosecdef, routine.provolatile, routine.proconfig
  INTO v_wrapper_definition, v_wrapper_checksum, v_wrapper_owner,
       v_wrapper_security_definer, v_wrapper_volatility, v_wrapper_config
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = v_wrapper_signature;

  SELECT pg_catalog.pg_get_functiondef(v_core_signature),
         pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core_signature)),
         pg_catalog.pg_get_userbyid(routine.proowner),
         routine.prosecdef, routine.provolatile, routine.proconfig
  INTO v_core_definition, v_core_checksum, v_core_owner,
       v_core_security_definer, v_core_volatility, v_core_config
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = v_core_signature;

  IF v_wrapper_owner <> 'postgres'
    OR v_core_owner <> 'postgres'
    OR NOT v_wrapper_security_definer
    OR NOT v_core_security_definer
    OR v_wrapper_volatility <> 'v'
    OR v_core_volatility <> 'v'
    OR v_wrapper_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_core_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  THEN
    RAISE EXCEPTION 'v243 preflight: direct snapshot function attributes changed';
  END IF;

  IF v_wrapper_checksum NOT IN (
    v_source_wrapper_checksum, v_target_wrapper_checksum
  ) THEN
    RAISE EXCEPTION
      'v243 preflight: wrapper checksum changed (expected % or %, got %)',
      v_source_wrapper_checksum, v_target_wrapper_checksum, v_wrapper_checksum;
  END IF;
  IF v_core_checksum NOT IN (
    v_source_core_checksum, v_target_core_checksum
  ) THEN
    RAISE EXCEPTION
      'v243 preflight: core checksum changed (expected % or %, got %)',
      v_source_core_checksum, v_target_core_checksum, v_core_checksum;
  END IF;

  IF v_wrapper_checksum = v_source_wrapper_checksum THEN
    IF (
      pg_catalog.length(v_wrapper_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_wrapper_definition, v_old_wrapper_declaration, ''
        ))
    ) <> pg_catalog.length(v_old_wrapper_declaration)
      OR (
        pg_catalog.length(v_wrapper_definition)
        - pg_catalog.length(pg_catalog.replace(
            v_wrapper_definition, v_old_wrapper_delegate, ''
          ))
      ) <> pg_catalog.length(v_old_wrapper_delegate)
    THEN
      RAISE EXCEPTION 'v243 preflight: unexpected snapshot wrapper shape';
    END IF;

    EXECUTE pg_catalog.replace(
      pg_catalog.replace(
        v_wrapper_definition,
        v_old_wrapper_declaration,
        v_new_wrapper_declaration
      ),
      v_old_wrapper_delegate,
      v_new_wrapper_delegate
    );
  END IF;

  IF v_core_checksum = v_source_core_checksum THEN
    IF (
      pg_catalog.length(v_core_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_core_definition, v_old_core_declaration, ''
        ))
    ) <> pg_catalog.length(v_old_core_declaration)
      OR (
        pg_catalog.length(v_core_definition)
        - pg_catalog.length(pg_catalog.replace(
            v_core_definition, v_old_core_guard, ''
          ))
      ) <> pg_catalog.length(v_old_core_guard)
    THEN
      RAISE EXCEPTION 'v243 preflight: unexpected snapshot core shape';
    END IF;

    EXECUTE pg_catalog.replace(
      pg_catalog.replace(
        v_core_definition,
        v_old_core_declaration,
        v_new_core_declaration
      ),
      v_old_core_guard,
      v_new_core_guard
    );
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_wrapper_signature),
         pg_catalog.pg_get_functiondef(v_core_signature)
  INTO v_wrapper_definition, v_core_definition;

  IF pg_catalog.md5(v_wrapper_definition) <> v_target_wrapper_checksum
    OR pg_catalog.md5(v_core_definition) <> v_target_core_checksum
  THEN
    RAISE EXCEPTION 'v243 postflight: direct snapshot target checksum mismatch';
  END IF;

  IF pg_catalog.strpos(v_wrapper_definition, 'v_previous_target text') = 0
    OR pg_catalog.strpos(v_wrapper_definition, 'account.is_zalo_server') = 0
    OR pg_catalog.strpos(v_wrapper_definition, 'committed request returns its') = 0
    OR pg_catalog.strpos(v_wrapper_definition, 'aka_agent_data_group_type_compatible') = 0
    OR pg_catalog.strpos(
      v_wrapper_definition,
      $$set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true$$
    ) = 0
    OR pg_catalog.strpos(v_core_definition, 'v_account_runtime_target text') = 0
    OR pg_catalog.strpos(v_core_definition, $$v_runtime_target NOT IN ('desktop', 'server')$$) = 0
    OR pg_catalog.strpos(v_core_definition, 'direct_campaign_runtime_not_owner') = 0
    OR pg_catalog.strpos(v_core_definition, 'aka_agent_lock_campaign_input_serialization') = 0
    OR pg_catalog.strpos(v_core_definition, 'Reuse order for one-time snapshots:') = 0
    OR pg_catalog.strpos(v_core_definition, 'v226: Facebook UID/URL targets') = 0
    OR pg_catalog.strpos(v_core_definition, 'v227: snapshot Facebook routes') = 0
    OR pg_catalog.strpos(v_core_definition, 'v228: valid-phone routes') = 0
  THEN
    RAISE EXCEPTION 'v243 postflight: subtype routing or preserved live patch missing';
  END IF;

  IF pg_catalog.strpos(
      v_core_definition,
      'Return a committed response before consulting mutable campaign/group state.'
    ) >= pg_catalog.strpos(
      v_core_definition,
      'Match the shared Data Group lock hierarchy'
    )
    OR pg_catalog.strpos(
      v_core_definition,
      'Match the shared Data Group lock hierarchy'
    ) >= pg_catalog.strpos(
      v_core_definition,
      'aka_agent_lock_campaign_input_serialization'
    )
    OR pg_catalog.strpos(
      v_core_definition,
      'aka_agent_lock_campaign_input_serialization'
    ) >= pg_catalog.strpos(v_core_definition, 'SELECT campaign.*')
    OR pg_catalog.strpos(
      v_core_definition,
      'SELECT campaign.*'
    ) >= pg_catalog.strpos(
      v_core_definition,
      'runtime ownership decision'
    )
  THEN
    RAISE EXCEPTION 'v243 postflight: snapshot lock/retry order changed';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(routine.proowner),
         routine.prosecdef, routine.provolatile, routine.proconfig
  INTO v_wrapper_owner, v_wrapper_security_definer,
       v_wrapper_volatility, v_wrapper_config
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = v_wrapper_signature;

  SELECT pg_catalog.pg_get_userbyid(routine.proowner),
         routine.prosecdef, routine.provolatile, routine.proconfig
  INTO v_core_owner, v_core_security_definer,
       v_core_volatility, v_core_config
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = v_core_signature;

  IF v_wrapper_owner <> 'postgres'
    OR v_core_owner <> 'postgres'
    OR NOT v_wrapper_security_definer
    OR NOT v_core_security_definer
    OR v_wrapper_volatility <> 'v'
    OR v_core_volatility <> 'v'
    OR v_wrapper_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_core_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  THEN
    RAISE EXCEPTION 'v243 postflight: direct snapshot function attributes changed';
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) IS
  'Subtype-aware one-time Data Group snapshot for direct campaigns; tenant wrapper routes Desktop/Server and the locked core fails closed on ownership races.';

DO $postflight$
DECLARE
  v_wrapper_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_core_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_wrapper_checksum text := pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_wrapper_signature)
  );
  v_core_checksum text := pg_catalog.md5(
    pg_catalog.pg_get_functiondef(v_core_signature)
  );
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'anon', v_wrapper_signature, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', v_wrapper_signature, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', v_wrapper_signature, 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.oid = v_wrapper_signature
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v243 postflight: snapshot wrapper ACL changed';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', v_core_signature, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', v_core_signature, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role', v_core_signature, 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.oid = v_core_signature
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v243 postflight: snapshot core became externally executable';
  END IF;

  RAISE NOTICE 'v243 target checksums: wrapper=%, core=%',
    v_wrapper_checksum, v_core_checksum;
END;
$postflight$;

COMMIT;
