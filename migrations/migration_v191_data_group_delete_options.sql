-- Optional automation detachment when a shared Data Group is soft-deleted.
--
-- The group/source/membership lifecycle is always closed.  Detaching the
-- optional automation destination is a separate user choice; either way the
-- established automation A -> B route remains untouched.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_delete_data_group_with_options(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_request_id text,
  p_detach_automations boolean,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_result jsonb;
  v_request_hash text;
  v_detached_count integer := 0;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );

  IF p_group_id IS NULL OR p_group_id <= 0
    OR NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_data_group_delete_request';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'delete_group',
    'groupId', p_group_id,
    'detachAutomations', COALESCE(p_detach_automations, false)
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'delete_group', p_group_id, v_request_hash,
    'processing', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT * INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;

    IF v_batch.operation <> 'delete_group'
      OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN
      RETURN v_batch.result;
    END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  -- The implementation overload owns the atomic group/source/membership
  -- lifecycle. Passing NULL avoids creating a second idempotency row because
  -- this wrapper already records the option as part of its request hash.
  v_result := public.aka_agent_delete_data_group(
    p_staff_id, p_organization_id, p_group_id, NULL
  );

  IF COALESCE(p_detach_automations, false) THEN
    UPDATE public.auto_automation AS automation
    SET target_data_group_id = NULL,
        updated_at = clock_timestamp()
    WHERE automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.target_data_group_id = p_group_id
      AND COALESCE(automation.is_delete, false) = false;
    GET DIAGNOSTICS v_detached_count = ROW_COUNT;
  END IF;

  v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'detach_automations', COALESCE(p_detach_automations, false),
    'detached_automation_count', v_detached_count
  );

  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = clock_timestamp()
  WHERE id = v_batch.id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_delete_data_group_with_options(
  bigint, bigint, bigint, text, boolean, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.aka_agent_delete_data_group_with_options(
  bigint, bigint, bigint, text, boolean, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
