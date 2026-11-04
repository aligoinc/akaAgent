CREATE OR REPLACE FUNCTION public.aka_agent_get_campaign_group_export_metadata(
  p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_detail_ids bigint[],
  p_auth_username text, p_auth_password text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE v_action text; v_rows jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id);
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  SELECT action_id INTO v_action FROM public.auto_campaigns
  WHERE id=p_campaign_id AND staff_id=p_staff_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF p_detail_ids IS NULL OR cardinality(p_detail_ids) NOT BETWEEN 1 AND 500
    OR EXISTS(SELECT 1 FROM unnest(p_detail_ids) id WHERE id IS NULL OR id<=0)
    OR (SELECT count(DISTINCT id) FROM unnest(p_detail_ids) id)<>cardinality(p_detail_ids) THEN
    RAISE EXCEPTION 'invalid_campaign_export_ids';
  END IF;
  -- Gate before reading provenance/contact tables. No metadata query during normal paging.
  IF v_action NOT IN ('facebook_group_post','facebook_join_group','facebook_find_data_group','facebook_comment_seeding') THEN
    RETURN jsonb_build_object('version',1,'eligible',false,'rows','[]'::jsonb);
  END IF;
  IF (SELECT count(*) FROM public.auto_campaign_details d WHERE d.campaign_id=p_campaign_id
      AND d.id=ANY(p_detail_ids) AND NOT d.is_delete)<>cardinality(p_detail_ids) THEN
    RAISE EXCEPTION 'campaign_export_results_changed';
  END IF;
  WITH targets AS MATERIALIZED (
    SELECT d.id detail_id, i.id input_data_id, i.uid, typ.code data_type_code
    FROM public.auto_campaign_details d
    LEFT JOIN public.auto_campaign_input_data i ON i.id=d.input_data_id AND i.campaign_id=p_campaign_id
    LEFT JOIN public.category_item typ ON typ.id=i.data_type_category_item_id
    WHERE d.campaign_id=p_campaign_id AND d.id=ANY(p_detail_ids) AND NOT d.is_delete
  ), input_sources AS MATERIALIZED (
    -- Deduplicate input IDs before expanding multiple provenance routes.
    SELECT t.input_data_id, COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
      'uid',c.uid,'url',c.url,'contact_type',c.contact_type,'flatform_type',c.flatform_type,
      'metadata',jsonb_build_object('memberCount',c.extra_data->'memberCount',
        'postsPerDay',c.extra_data->'postsPerDay','privacy',c.extra_data->'privacy')
    )),'[]'::jsonb) sources
    FROM (SELECT DISTINCT input_data_id FROM targets
      WHERE data_type_code IS NULL OR data_type_code='facebook_group') t
    JOIN public.auto_campaign_input_origins o ON o.input_data_id=t.input_data_id
    JOIN public.auto_account_contact_group_members m ON m.id=o.membership_id
      AND (o.group_id IS NULL OR m.group_id=o.group_id) AND NOT m.is_delete
    JOIN public.auto_account_contact_groups g ON g.id=m.group_id AND g.organization_id=p_organization_id
      AND private.can_read_data_group(g.id,p_staff_id,p_organization_id)
    JOIN public.auto_account_contacts c ON c.id=m.contact_id AND c.staff_id=g.staff_id
      AND c.organization_id=g.organization_id AND NOT c.is_delete
      AND c.flatform_type='facebook' AND c.contact_type IN ('group','campaign_input')
    GROUP BY t.input_data_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('detail_id',t.detail_id,'uid',t.uid,
    'data_type_code',t.data_type_code,'sources',COALESCE(s.sources,'[]'::jsonb)) ORDER BY t.detail_id),'[]'::jsonb)
  INTO v_rows FROM targets t LEFT JOIN input_sources s ON s.input_data_id=t.input_data_id;
  RETURN jsonb_build_object('version',1,'eligible',true,'rows',v_rows);
END;
$function$;
