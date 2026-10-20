-- V414: display the source account name already read for authorized shared-group members.
-- Built from the captured live V409 RPC; keep every other permission/redaction/lock unchanged.
-- Same signature/result keys/ACL: no schema reload is needed.
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'))) IS DISTINCT FROM '75e14dbec647c96812bed7d8c165fc18' THEN
    RAISE EXCEPTION 'V414 preflight: RPC definition changed or missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)')
    AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v'
    AND proconfig=ARRAY['search_path=pg_catalog, public','statement_timeout=60s']
    AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'V414 preflight: RPC attributes changed';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.aka_agent_group_sharing(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_kind text := p_data->>'kind';
  v_id bigint := NULLIF(p_data->>'groupId','')::bigint;
  v_access jsonb;
  v_scope text;
  v_revision bigint;
  v_recipients bigint[];
  v_owner bigint;
  v_result jsonb;
  v_row record;
  v_ids bigint[];
  v_template_id bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF NOT EXISTS(SELECT 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id
    AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'group_sharing_access_denied'; END IF;

  IF p_action='staff' THEN
    RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',COALESCE(NULLIF(s.name,''),'Nhân viên #'||s.id)) ORDER BY s.name,s.id),'[]'::jsonb)
      FROM public.org_staff s WHERE s.organization_id=p_organization_id AND s.deleted_at IS NULL AND s.is_active AND s.id<>p_staff_id);
  ELSIF p_action='data_groups' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(g)||jsonb_build_object(
      'access',private.group_access('data',g.id,p_staff_id,p_organization_id),
      'bound_zalo_account_id',cg.bound_zalo_account_id,
      'bound_zalo_account_name',CASE WHEN cg.staff_id=p_staff_id THEN a.name END)),'[]'::jsonb)
    INTO v_result FROM private.list_shared_data_groups(
      p_staff_id,p_organization_id,p_data->>'search',p_data->>'compatibleActionId',
      (p_data->>'compatibleDataTypeCategoryItemId')::bigint,
      CASE WHEN jsonb_typeof(p_data->'dataTypeCategoryItemIds')='array' AND jsonb_array_length(p_data->'dataTypeCategoryItemIds')>0 THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'dataTypeCategoryItemIds')::bigint) END,
      COALESCE((p_data->>'offset')::integer,0),LEAST(500,COALESCE((p_data->>'limit')::integer,50)),
      COALESCE((p_data->>'unrestrictedOnly')::boolean,false),COALESCE((p_data->>'ownedOnly')::boolean,false)
    ) g JOIN public.auto_account_contact_groups cg ON cg.id=g.id LEFT JOIN public.auto_accounts a ON a.id=cg.bound_zalo_account_id;
    RETURN v_result;
  ELSIF p_action='content_groups' THEN
    RETURN (SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'id')::bigint),'[]'::jsonb) FROM (
      SELECT to_jsonb(g)||jsonb_build_object('access',private.group_access('content',g.id,p_staff_id,p_organization_id)) row_data
      FROM public.auto_content_groups g WHERE g.organization_id=p_organization_id AND NOT g.is_delete
        AND g.id>COALESCE((p_data->>'afterId')::bigint,0)
        AND private.group_access('content',g.id,p_staff_id,p_organization_id) IS NOT NULL
        AND (NOT COALESCE((p_data->>'ownedOnly')::boolean,false) OR g.staff_id=p_staff_id)
      ORDER BY g.id LIMIT 500
    ) page);
  ELSIF p_action='content_templates' THEN
    RETURN (SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'id')::bigint),'[]'::jsonb) FROM (
      SELECT to_jsonb(t)||jsonb_build_object('content_group',jsonb_build_object('name',g.name),
        'access',CASE WHEN t.staff_id=p_staff_id THEN jsonb_build_object('role','owner','ownerStaffId',p_staff_id,'canManage',true,'canUse',true,'canCopy',true)
          ELSE private.group_access('content',g.id,p_staff_id,p_organization_id) END) row_data
      FROM public.auto_content_templates t LEFT JOIN public.auto_content_groups g ON g.id=t.group_id
      WHERE t.organization_id=p_organization_id AND NOT t.is_delete
        AND t.id>COALESCE((p_data->>'afterId')::bigint,0)
        AND (t.staff_id=p_staff_id OR (g.staff_id=t.staff_id AND g.organization_id=t.organization_id
          AND g.is_active AND private.group_access('content',g.id,p_staff_id,p_organization_id) IS NOT NULL))
      ORDER BY t.id LIMIT 500
    ) page);
  END IF;

  IF v_kind NOT IN ('data','content') OR v_kind IS NULL OR v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_group_sharing_request';
  END IF;
  -- Lock writes/copies with the source group; all affected destinations are locked in ID order by copy RPC.
  IF p_action='save' THEN
    IF v_kind='data' THEN PERFORM id FROM public.auto_account_contact_groups WHERE id=v_id FOR UPDATE;
    ELSE PERFORM id FROM public.auto_content_groups WHERE id=v_id FOR UPDATE; END IF;
  END IF;
  v_access:=private.group_access(v_kind,v_id,p_staff_id,p_organization_id);
  IF v_access IS NULL THEN RAISE EXCEPTION 'group_sharing_access_denied'; END IF;
  v_owner:=(v_access->>'ownerStaffId')::bigint;

  IF p_action IN ('get','save') THEN
    IF NOT (v_access->>'canManage')::boolean THEN
      IF p_action='save' THEN RAISE EXCEPTION 'group_sharing_owner_required'; END IF;
      RETURN jsonb_build_object('scope',v_access->>'scope','revision',v_access->>'revision','recipientIds','[]'::jsonb,'access',v_access);
    END IF;
    IF p_action='save' THEN
      v_scope:=p_data->>'scope';
      IF v_scope IS NULL OR v_scope NOT IN ('private','organization','selected') THEN RAISE EXCEPTION 'invalid_group_sharing_scope'; END IF;
      IF p_data->>'expectedRevision' IS DISTINCT FROM v_access->>'revision' THEN RAISE EXCEPTION 'group_sharing_conflict'; END IF;
      IF jsonb_typeof(p_data->'recipientIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_group_sharing_recipients'; END IF;
      SELECT COALESCE(array_agg(DISTINCT x::bigint),'{}'::bigint[]) INTO v_recipients FROM jsonb_array_elements_text(p_data->'recipientIds') x;
      IF v_scope<>'selected' THEN v_recipients:='{}'::bigint[]; END IF;
      IF v_scope='selected' AND cardinality(v_recipients)=0 THEN RAISE EXCEPTION 'group_sharing_recipients_required'; END IF;
      IF EXISTS(SELECT 1 FROM unnest(v_recipients) r(id) LEFT JOIN public.org_staff s
        ON s.id=r.id AND s.organization_id=p_organization_id AND s.deleted_at IS NULL AND s.is_active
        WHERE s.id IS NULL OR s.id=p_staff_id) THEN RAISE EXCEPTION 'invalid_group_sharing_recipients'; END IF;
      IF v_kind='data' THEN
        DELETE FROM public.auto_data_group_recipients WHERE group_id=v_id;
        INSERT INTO public.auto_data_group_recipients SELECT v_id,unnest(v_recipients);
        UPDATE public.auto_account_contact_groups SET sharing_scope=v_scope,sharing_revision=sharing_revision+1 WHERE id=v_id;
        -- No campaign pause, deletion or input reset. A new grant never reactivates stopped sources.
        FOR v_row IN SELECT source.id,source.campaign_id FROM public.auto_campaign_data_group_sources source
          WHERE source.group_id=v_id AND source.staff_id<>p_staff_id AND source.status IN ('active','baselining')
          AND NOT private.can_read_data_group(v_id,source.staff_id,source.organization_id)
          ORDER BY source.campaign_id,source.id
        LOOP
          PERFORM public.aka_agent_lock_campaign_input_serialization(v_row.campaign_id);
          UPDATE public.auto_campaign_data_group_sources SET status='stopped',stop_reason='sharing_revoked',stopped_at=now(),updated_at=now()
            WHERE id=v_row.id AND status IN ('active','baselining');
        END LOOP;
      ELSE
        DELETE FROM public.auto_content_group_recipients WHERE group_id=v_id;
        INSERT INTO public.auto_content_group_recipients SELECT v_id,unnest(v_recipients);
        UPDATE public.auto_content_groups SET sharing_scope=v_scope,sharing_revision=sharing_revision+1 WHERE id=v_id;
      END IF;
      v_access:=private.group_access(v_kind,v_id,p_staff_id,p_organization_id);
    END IF;
    IF v_kind='data' THEN SELECT COALESCE(array_agg(staff_id ORDER BY staff_id),'{}'::bigint[]) INTO v_recipients FROM public.auto_data_group_recipients WHERE group_id=v_id;
    ELSE SELECT COALESCE(array_agg(staff_id ORDER BY staff_id),'{}'::bigint[]) INTO v_recipients FROM public.auto_content_group_recipients WHERE group_id=v_id; END IF;
    RETURN jsonb_build_object('scope',v_access->>'scope','revision',v_access->>'revision','recipientIds',to_jsonb(v_recipients),'access',v_access);
  ELSIF p_action='validate_content_selection' AND v_kind='content' THEN
    PERFORM id FROM public.auto_content_groups WHERE id=v_id AND is_active FOR SHARE;
    IF NOT FOUND OR private.group_access('content',v_id,p_staff_id,p_organization_id) IS NULL THEN
      RAISE EXCEPTION 'group_sharing_access_denied';
    END IF;
    RETURN jsonb_build_object('allowed',true);
  ELSIF p_action='copy' THEN
    RETURN private.copy_shared_group(p_staff_id,p_organization_id,v_kind,v_id,p_data);
  ELSIF p_action='data_members' AND v_kind='data' THEN
    IF jsonb_typeof(p_data->'ids')='array' THEN SELECT array_agg(x::bigint) INTO v_ids FROM jsonb_array_elements_text(p_data->'ids') x; END IF;
    IF jsonb_typeof(p_data->'sourceCodes')='array' AND jsonb_array_length(p_data->'sourceCodes')>0 THEN
      IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_data->'sourceCodes') code
        WHERE code NOT IN ('upload','scan','automation','dynamic_filter','external_sync')) THEN
        RAISE EXCEPTION 'invalid_data_group_source_filter';
      END IF;
      SELECT COALESCE(array_agg(m.id),ARRAY[-1]::bigint[]) INTO v_ids
      FROM public.auto_account_contact_group_members m WHERE m.group_id=v_id AND NOT m.is_delete
        AND (v_ids IS NULL OR m.id=ANY(v_ids))
        AND EXISTS(SELECT 1 FROM public.auto_account_contact_group_member_origins o JOIN public.category_item c ON c.id=o.source_category_item_id
          WHERE o.membership_id=m.id AND o.is_current AND c.code IN (SELECT jsonb_array_elements_text(p_data->'sourceCodes')));
    END IF;
    RETURN (SELECT COALESCE(jsonb_agg(CASE WHEN v_owner=p_staff_id THEN to_jsonb(m) ELSE to_jsonb(m)||jsonb_build_object(
      'source_automation_id',NULL,'source_automation_name',NULL,
      'dataset_ids','[]'::jsonb,'dataset_names','[]'::jsonb,'provenance','[]'::jsonb) END),'[]'::jsonb)
    FROM private.read_shared_group_members(
      v_owner,p_organization_id,v_id,p_data->>'search',
      CASE WHEN jsonb_typeof(p_data->'accountIds')='array' AND jsonb_array_length(p_data->'accountIds')>0 THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'accountIds')::bigint) END,
      COALESCE((p_data->>'includeAccountless')::boolean,true),
      CASE WHEN jsonb_typeof(p_data->'contactTypes')='array' AND jsonb_array_length(p_data->'contactTypes')>0 THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'contactTypes')) END,
      CASE WHEN jsonb_typeof(p_data->'flatformTypes')='array' AND jsonb_array_length(p_data->'flatformTypes')>0 THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'flatformTypes')) END,
      COALESCE(p_data->>'status','all'),
      CASE WHEN jsonb_typeof(p_data->'datasetIds')='array' AND jsonb_array_length(p_data->'datasetIds')>0 THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'datasetIds')::bigint) END,
      CASE WHEN jsonb_typeof(p_data->'dataTypeCategoryItemIds')='array' AND jsonb_array_length(p_data->'dataTypeCategoryItemIds')>0 THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'dataTypeCategoryItemIds')::bigint) END,
      v_ids,CASE WHEN jsonb_typeof(p_data->'excludeIds')='array' AND jsonb_array_length(p_data->'excludeIds')>0 THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'excludeIds')::bigint) END,
      COALESCE((p_data->>'offset')::integer,0),LEAST(1000,COALESCE((p_data->>'limit')::integer,100))) m);
  ELSIF p_action='data_datasets' AND v_kind='data' THEN
    IF v_owner<>p_staff_id THEN RETURN '[]'::jsonb; END IF;
    RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM public.aka_agent_list_data_group_datasets(p_staff_id,p_organization_id,v_id) d);
  ELSIF p_action='data_panel' AND v_kind='data' THEN
    IF v_owner=p_staff_id THEN RETURN public.aka_agent_get_data_group_panel(p_staff_id,p_organization_id,v_id,p_auth_username,p_auth_password); END IF;
    RETURN (SELECT jsonb_build_object('group',jsonb_build_object('id',g.id,'name',g.name,'color',g.color,'note',g.note,
        'created_at',g.created_at,'updated_at',g.updated_at,'data_type_category_item_id',g.data_type_category_item_id,
        'bound_zalo_account_id',g.bound_zalo_account_id)||public.aka_agent_data_type_json(g.data_type_category_item_id)
        ||jsonb_build_object('creator_name',v_access->>'ownerName','access',v_access),
      'summary',jsonb_build_object('active_membership_count',(SELECT count(*) FROM public.auto_account_contact_group_members WHERE group_id=v_id AND NOT is_delete)),
      'quality','{}'::jsonb,'source_breakdown','[]'::jsonb,'data_type_breakdown','[]'::jsonb,
      'account_breakdown','[]'::jsonb,'tags','[]'::jsonb,'history','[]'::jsonb,'campaigns','[]'::jsonb)
      FROM public.auto_account_contact_groups g WHERE g.id=v_id);
  END IF;
  RAISE EXCEPTION 'invalid_group_sharing_action';
END;
$function$;

DO $guard$
BEGIN
  IF to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'))) IS DISTINCT FROM 'd6bbdca20f780005a411e8a6be6ae8e5' THEN
    RAISE EXCEPTION 'V414 postflight: RPC definition changed or missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)')
    AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v'
    AND proconfig=ARRAY['search_path=pg_catalog, public','statement_timeout=60s']
    AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'V414 postflight: RPC attributes changed';
  END IF;
END;
$guard$;
