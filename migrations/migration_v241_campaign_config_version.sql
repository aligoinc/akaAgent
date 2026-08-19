-- v241: distinguish editable campaign changes from runtime-only writes.
--
-- auto_campaigns.updated_at is shared by configuration edits and runtime
-- log/note/status updates. The Control Web edit flow must therefore compare a
-- digest of editable fields before retrying the existing atomic RPC with the
-- latest timestamp. The existing RPC remains byte-for-byte unchanged.

BEGIN;

DO $preflight$
DECLARE
  v_oid regprocedure;
  v_checksum text;
  v_owner text;
  v_prosecdef boolean;
  v_provolatile "char";
  v_proparallel "char";
  v_proconfig text[];
  v_proacl text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'
  );
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'v241 preflight: core campaign update RPC is missing';
  END IF;

  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.provolatile,
    p.proparallel,
    p.proconfig,
    p.proacl::text
  INTO
    v_checksum,
    v_owner,
    v_prosecdef,
    v_provolatile,
    v_proparallel,
    v_proconfig,
    v_proacl
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_oid;

  IF v_checksum <> '0d03ac88faa1b01608129a33b64752f8'
    OR v_owner <> 'postgres'
    OR v_prosecdef IS DISTINCT FROM true
    OR v_provolatile <> 'v'
    OR v_proparallel <> 'u'
    OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR v_proacl <> '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION
      'v241 preflight: unexpected core RPC definition or metadata (checksum %, owner %, ACL %) — inspect live before applying',
      v_checksum,
      v_owner,
      v_proacl;
  END IF;

  v_oid := pg_catalog.to_regprocedure(
    'public.aka_agent_campaign_config_version(public.auto_campaigns)'
  );
  IF v_oid IS NOT NULL THEN
    SELECT
      pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef,
      p.provolatile,
      p.proparallel,
      p.proconfig,
      p.proacl::text
    INTO
      v_checksum,
      v_owner,
      v_prosecdef,
      v_provolatile,
      v_proparallel,
      v_proconfig,
      v_proacl
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_checksum <> '5992a9958a3df3ccba087f9c9388ebb4'
      OR v_owner <> 'postgres'
      OR v_prosecdef IS DISTINCT FROM false
      OR v_provolatile <> 'i'
      OR v_proparallel <> 's'
      OR v_proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
      OR v_proacl <> '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION
        'v241 preflight: unexpected config-version function definition or metadata (checksum %, owner %, ACL %) — inspect live before applying',
        v_checksum,
        v_owner,
        v_proacl;
    END IF;
  END IF;

  v_oid := pg_catalog.to_regprocedure(
    'public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'
  );
  IF v_oid IS NOT NULL THEN
    SELECT
      pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef,
      p.provolatile,
      p.proparallel,
      p.proconfig,
      p.proacl::text
    INTO
      v_checksum,
      v_owner,
      v_prosecdef,
      v_provolatile,
      v_proparallel,
      v_proconfig,
      v_proacl
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_checksum <> '4d824c50515201bc8410d7114bd3a8a7'
      OR v_owner <> 'postgres'
      OR v_prosecdef IS DISTINCT FROM true
      OR v_provolatile <> 'v'
      OR v_proparallel <> 'u'
      OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
      OR v_proacl <> '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION
        'v241 preflight: unexpected config-version update RPC definition or metadata (checksum %, owner %, ACL %) — inspect live before applying',
        v_checksum,
        v_owner,
        v_proacl;
    END IF;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_campaign_config_version(
  p_campaign public.auto_campaigns
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
  SELECT pg_catalog.md5(
    pg_catalog.jsonb_build_array(
      p_campaign.name,
      p_campaign.action_id,
      p_campaign.account_id,
      p_campaign.secondary_account_id,
      p_campaign.schedule,
      p_campaign.original_schedule,
      p_campaign.content,
      p_campaign.schedule_type,
      p_campaign.schedule_end_date,
      p_campaign.daily_stop_time,
      p_campaign.schedule_days,
      p_campaign.schedule_week_days,
      p_campaign.continue_next_day,
      p_campaign.refresh_data,
      p_campaign.extra_settings,
      p_campaign.images,
      p_campaign.data_target_source_mode,
      p_campaign.data_group_id
    )::text
  )
$function$;

ALTER FUNCTION public.aka_agent_campaign_config_version(public.auto_campaigns)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_campaign_config_version(public.auto_campaigns)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_config_version(public.auto_campaigns)
  TO service_role;

COMMENT ON FUNCTION public.aka_agent_campaign_config_version(public.auto_campaigns) IS
  'Stable digest of user-editable campaign configuration; excludes runtime status, log, note, progress, claims, and timestamps.';

CREATE OR REPLACE FUNCTION public.update_control_campaign_by_config_version_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_expected_updated_at timestamptz,
  p_campaign_patch jsonb,
  p_sms_inputs jsonb DEFAULT NULL,
  p_update_sms_schedule boolean DEFAULT false,
  p_append_idempotency_key text DEFAULT NULL,
  p_expected_input_count integer DEFAULT NULL,
  p_append_inputs jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_expected_config_version text := lower(
    NULLIF(btrim(COALESCE(p_campaign_patch->>'_expected_config_version', '')), '')
  );
  v_campaign_patch jsonb := COALESCE(p_campaign_patch, '{}'::jsonb)
    - '_expected_config_version';
  v_result jsonb;
  v_attempt integer;
BEGIN
  IF v_expected_config_version IS NULL
    OR v_expected_config_version !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_campaign_config_version';
  END IF;

  -- Preserve the core RPC's durable append-idempotency fast path. A retry of
  -- an already committed append must succeed even though its config digest is
  -- necessarily stale after the first transaction.
  IF p_append_inputs IS NOT NULL THEN
    v_result := public.update_control_campaign_atomic(
      p_staff_id,
      p_organization_id,
      p_campaign_id,
      p_expected_updated_at,
      v_campaign_patch,
      p_sms_inputs,
      p_update_sms_schedule,
      p_append_idempotency_key,
      p_expected_input_count,
      p_append_inputs
    );

    IF COALESCE((v_result->>'updated')::boolean, false)
      OR v_result->>'reason' IS DISTINCT FROM 'version_conflict' THEN
      RETURN v_result;
    END IF;
  END IF;

  -- Runtime log/note/status writes also advance auto_campaigns.updated_at.
  -- Retry those timestamp-only races while the editable config digest stays
  -- equal to the version that the user loaded.
  FOR v_attempt IN 1..5 LOOP
    SELECT campaign.*
    INTO v_campaign
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
    END IF;

    IF public.aka_agent_campaign_config_version(v_campaign)
      IS DISTINCT FROM v_expected_config_version THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
    END IF;

    v_result := public.update_control_campaign_atomic(
      p_staff_id,
      p_organization_id,
      p_campaign_id,
      v_campaign.updated_at,
      v_campaign_patch,
      p_sms_inputs,
      p_update_sms_schedule,
      p_append_idempotency_key,
      p_expected_input_count,
      p_append_inputs
    );

    IF COALESCE((v_result->>'updated')::boolean, false)
      OR v_result->>'reason' IS DISTINCT FROM 'version_conflict' THEN
      RETURN v_result;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
END;
$function$;

ALTER FUNCTION public.update_control_campaign_by_config_version_atomic(
  bigint, bigint, bigint, timestamptz, jsonb, jsonb, boolean, text, integer, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_control_campaign_by_config_version_atomic(
  bigint, bigint, bigint, timestamptz, jsonb, jsonb, boolean, text, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_control_campaign_by_config_version_atomic(
  bigint, bigint, bigint, timestamptz, jsonb, jsonb, boolean, text, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION public.update_control_campaign_by_config_version_atomic(
  bigint, bigint, bigint, timestamptz, jsonb, jsonb, boolean, text, integer, jsonb
) IS
  'Control Web campaign update wrapper that ignores runtime-only updated_at churn while preserving true config conflicts and core RPC guards.';

DO $postflight$
DECLARE
  v_core_checksum text;
  v_helper_checksum text;
  v_wrapper_checksum text;
  v_metadata_count integer;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'::regprocedure
  )) INTO v_core_checksum;
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.aka_agent_campaign_config_version(public.auto_campaigns)'::regprocedure
  )) INTO v_helper_checksum;
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'::regprocedure
  )) INTO v_wrapper_checksum;

  IF v_core_checksum <> '0d03ac88faa1b01608129a33b64752f8'
    OR v_helper_checksum <> '5992a9958a3df3ccba087f9c9388ebb4'
    OR v_wrapper_checksum <> '4d824c50515201bc8410d7114bd3a8a7' THEN
    RAISE EXCEPTION
      'v241 postflight: checksum mismatch (core %, helper %, wrapper %)',
      v_core_checksum,
      v_helper_checksum,
      v_wrapper_checksum;
  END IF;

  SELECT count(*)::integer
  INTO v_metadata_count
  FROM pg_catalog.pg_proc AS p
  WHERE (
      p.oid = 'public.aka_agent_campaign_config_version(public.auto_campaigns)'::regprocedure
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef = false
      AND p.provolatile = 'i'
      AND p.proparallel = 's'
      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
      AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
    )
    OR (
      p.oid = 'public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'::regprocedure
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef = true
      AND p.provolatile = 'v'
      AND p.proparallel = 'u'
      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[]
      AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
    );

  IF v_metadata_count <> 2 THEN
    RAISE EXCEPTION 'v241 postflight: owner/security/volatility/search_path/ACL mismatch';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
