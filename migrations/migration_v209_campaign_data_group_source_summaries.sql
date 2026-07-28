-- Batch campaign Data Group source summaries for the campaign list.
--
-- The group row is joined even after soft-delete so the campaign history keeps
-- its original display name. Client roles must still prove the process-only
-- tenant identity before any campaign/source existence is disclosed.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_data_group_source_summaries(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_ids bigint[],
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  campaign_id bigint,
  group_id bigint,
  group_name text,
  group_is_delete boolean,
  source_status text,
  stop_reason text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF COALESCE(pg_catalog.cardinality(p_campaign_ids), 0) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    source.campaign_id,
    source.group_id,
    contact_group.name,
    COALESCE(contact_group.is_delete, false),
    source.status,
    source.stop_reason,
    source.updated_at
  FROM public.auto_campaign_data_group_sources AS source
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = source.campaign_id
   AND campaign.staff_id = p_staff_id
   AND campaign.organization_id = p_organization_id
   AND COALESCE(campaign.is_delete, false) = false
  JOIN public.auto_account_contact_groups AS contact_group
    ON contact_group.id = source.group_id
   AND contact_group.staff_id = p_staff_id
   AND contact_group.organization_id = p_organization_id
  WHERE source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
    AND source.campaign_id = ANY(
      COALESCE(p_campaign_ids, ARRAY[]::bigint[])
    )
  ORDER BY source.campaign_id;
END;
$$;

COMMENT ON FUNCTION public.aka_agent_list_campaign_data_group_source_summaries(
  bigint, bigint, bigint[], text, text
) IS
  'Returns one authenticated tenant-scoped Data Group source summary per requested campaign, retaining soft-deleted group names.';

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_data_group_source_summaries(
  bigint, bigint, bigint[], text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_data_group_source_summaries(
  bigint, bigint, bigint[], text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
