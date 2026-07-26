-- Serialize a manual source stop with group ingest/baseline.
--
-- Intake and baseline already lock group -> campaign.  The v186 stop RPC only
-- locked the source row, which left a narrow race where an ingest transaction
-- could observe `active`, then commit a new campaign input after stop.  Use the
-- same deterministic group -> campaign -> source order as bind/reactivate so
-- every input committed before stop is retained and none can appear after it.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_stop_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_locked_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_hash text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_data_group_source_request';
  END IF;

  -- Discover immutable lock keys without retaining a row lock.  All state is
  -- revalidated after acquiring the common group -> campaign -> source locks.
  SELECT source.*
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_data_group_source_not_found';
  END IF;

  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_source.group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_campaign_not_found';
  END IF;

  SELECT source.*
  INTO v_locked_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = v_source.id
    AND source.campaign_id = p_campaign_id
    AND source.group_id = v_source.group_id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_data_group_source_changed';
  END IF;
  v_source := v_locked_source;

  v_hash := md5(jsonb_build_object(
    'operation', 'stop_source',
    'campaignId', p_campaign_id,
    'reason', COALESCE(
      NULLIF(btrim(COALESCE(p_reason, '')), ''), 'manual_stop'
    )
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'stop_source', v_source.group_id, v_hash,
    'processing', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'stop_source'
      OR v_batch.request_hash <> v_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN
      RETURN v_batch.result;
    END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'stopped',
      stopped_at = COALESCE(stopped_at, now()),
      stop_reason = COALESCE(
        NULLIF(btrim(COALESCE(p_reason, '')), ''), 'manual_stop'
      ),
      updated_at = now()
  WHERE id = v_source.id
  RETURNING * INTO v_source;

  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;

  RETURN to_jsonb(v_source);
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
