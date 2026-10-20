CREATE FUNCTION private.copy_shared_group(p_staff_id bigint,p_organization_id bigint,p_kind text,p_group_id bigint,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE
  v_request text:=p_data->>'requestId';
  v_hash text:=md5(p_data::text);
  v_prior private.group_copy_requests%ROWTYPE;
  v_access jsonb;
  v_source public.auto_account_contact_groups%ROWTYPE;
  v_target public.auto_account_contact_groups%ROWTYPE;
  v_content_group public.auto_content_groups%ROWTYPE;
  v_target_id bigint:=NULLIF(p_data->>'targetGroupId','')::bigint;
  v_template_id bigint:=NULLIF(p_data->>'templateId','')::bigint;
  v_member_ids bigint[];
  v_contact_id bigint;
  v_member_id bigint;
  v_count integer:=0;
  v_row record;
  v_revision bigint;
  v_result jsonb;
  v_base_name text;
  v_copy_name text;
  v_name_attempt integer;
  v_inserted_template_id bigint;
BEGIN
  IF v_request IS NULL OR length(v_request) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_group_copy_request'; END IF;
  IF p_kind='data' THEN
    PERFORM id FROM public.auto_account_contact_groups WHERE id IN (p_group_id,v_target_id) ORDER BY id FOR UPDATE;
  ELSE
    -- Copies into the same staff library allocate names in one transaction.
    -- Take this before group locks so overlapping multi-template copies cannot
    -- wait on each other's unique names in opposite source-template orders.
    PERFORM pg_advisory_xact_lock(hashtextextended('group-sharing-content-copy:'||p_staff_id::text,0));
    PERFORM id FROM public.auto_content_groups WHERE id IN (p_group_id,v_target_id) ORDER BY id FOR UPDATE;
  END IF;
  v_access:=private.group_access(p_kind,p_group_id,p_staff_id,p_organization_id);
  IF v_access IS NULL THEN RAISE EXCEPTION 'group_sharing_access_denied'; END IF;
  IF v_target_id IS NOT NULL AND NOT COALESCE((private.group_access(p_kind,v_target_id,p_staff_id,p_organization_id)->>'canManage')::boolean,false)
    THEN RAISE EXCEPTION 'group_sharing_owner_required'; END IF;
  IF v_target_id=p_group_id THEN RAISE EXCEPTION 'invalid_group_copy_target'; END IF;
  INSERT INTO private.group_copy_requests(staff_id,organization_id,request_id,request_hash)
    VALUES(p_staff_id,p_organization_id,v_request,v_hash) ON CONFLICT DO NOTHING;
  SELECT * INTO v_prior FROM private.group_copy_requests WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND request_id=v_request FOR UPDATE;
  IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'data_group_request_id_conflict'; END IF;
  IF v_prior.result IS NOT NULL THEN RETURN v_prior.result; END IF;
  IF p_kind='data' THEN
    SELECT * INTO v_source FROM public.auto_account_contact_groups WHERE id=p_group_id;
    IF v_target_id IS NULL THEN
      INSERT INTO public.auto_account_contact_groups(name,color,sort_order,purpose,staff_id,organization_id,data_type_category_item_id,dataset_sync_mode,is_delete)
        VALUES(COALESCE(NULLIF(btrim(p_data->>'name'),''),v_source.name||' - Bản sao'),v_source.color,0,'data_group',p_staff_id,p_organization_id,v_source.data_type_category_item_id,'manual',false)
        RETURNING id INTO v_target_id;
    END IF;
    SELECT * INTO v_target FROM public.auto_account_contact_groups WHERE id=v_target_id;
    IF v_target.bound_zalo_account_id IS NOT NULL THEN RAISE EXCEPTION 'data_group_bound_source_unknown'; END IF;
    IF v_target.data_type_category_item_id IS NOT NULL AND v_target.data_type_category_item_id IS DISTINCT FROM v_source.data_type_category_item_id
      THEN RAISE EXCEPTION 'data_group_ingest_semantic_type_mismatch'; END IF;
    IF jsonb_typeof(p_data->'membershipIds')='array' THEN
      SELECT COALESCE(array_agg(DISTINCT x::bigint),'{}'::bigint[]) INTO v_member_ids FROM jsonb_array_elements_text(p_data->'membershipIds') x;
      IF EXISTS(SELECT 1 FROM unnest(v_member_ids) requested(id) WHERE NOT EXISTS(
        SELECT 1 FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id
        WHERE m.id=requested.id AND m.group_id=p_group_id AND NOT m.is_delete AND NOT COALESCE(c.is_delete,false)
          AND c.staff_id=v_source.staff_id AND c.organization_id=p_organization_id))
        THEN RAISE EXCEPTION 'invalid_group_copy_members'; END IF;
    END IF;
    UPDATE public.auto_account_contact_groups SET revision=revision+1 WHERE id=v_target_id RETURNING revision INTO v_revision;
    FOR v_row IN SELECT c.*,COALESCE(o.data_type_category_item_id,v_source.data_type_category_item_id) copied_type
      FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id
      LEFT JOIN public.auto_account_contact_group_member_origins o ON o.id=m.primary_origin_id AND o.is_current
      WHERE m.group_id=p_group_id AND NOT m.is_delete AND NOT COALESCE(c.is_delete,false)
        AND c.staff_id=v_source.staff_id AND c.organization_id=p_organization_id
        AND (v_member_ids IS NULL OR m.id=ANY(v_member_ids)) ORDER BY m.id
    LOOP
      -- Independent accountless records: never copy account permissions, tags, relationship flags or raw extra_data.
      INSERT INTO public.auto_account_contacts(staff_id,organization_id,account_id,contact_type,flatform_type,name,uid,url,phone,email,extra_data,is_delete)
        VALUES(p_staff_id,p_organization_id,NULL,v_row.contact_type,v_row.flatform_type,v_row.name,v_row.uid,v_row.url,v_row.phone,v_row.email,
          jsonb_strip_nulls(jsonb_build_object('info1',v_row.extra_data->'info1','info2',v_row.extra_data->'info2',
            'info3',v_row.extra_data->'info3','info4',v_row.extra_data->'info4','info5',v_row.extra_data->'info5')),false)
        RETURNING id INTO v_contact_id;
      INSERT INTO public.auto_account_contact_group_members(group_id,contact_id,change_revision,is_delete)
        VALUES(v_target_id,v_contact_id,v_revision,false) RETURNING id INTO v_member_id;
      INSERT INTO public.auto_account_contact_group_member_origins(membership_id,kind,source_name_snapshot,data_type_category_item_id,is_current)
        VALUES(v_member_id,'manual','Bản sao: '||v_source.name,v_row.copied_type,true);
      -- Preserve normal intake for the recipient's existing target group.
      FOR v_result IN SELECT public.aka_agent_internal_route_data_group_member(s.id,v_member_id,NULL,v_revision)
        FROM public.auto_campaign_data_group_sources s WHERE s.group_id=v_target_id AND s.status IN ('active','baselining') ORDER BY s.campaign_id
      LOOP NULL; END LOOP;
      v_count:=v_count+1;
    END LOOP;
  ELSE
    SELECT * INTO v_content_group FROM public.auto_content_groups WHERE id=p_group_id;
    IF NOT v_content_group.is_active AND (v_access->>'role')='shared' THEN RAISE EXCEPTION 'group_sharing_access_denied'; END IF;
    IF v_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.auto_content_templates
      WHERE id=v_template_id AND group_id=p_group_id AND staff_id=v_content_group.staff_id AND organization_id=p_organization_id AND NOT is_delete)
      THEN RAISE EXCEPTION 'invalid_group_copy_template'; END IF;
    IF v_target_id IS NULL THEN
      v_base_name:=COALESCE(NULLIF(btrim(p_data->>'name'),''),v_content_group.name||' - Bản sao');
      v_copy_name:=v_base_name;
      v_name_attempt:=1;
      LOOP
        -- Let the existing unique index arbitrate concurrent copies/ordinary
        -- creates as well as case-insensitive, trimmed-name collisions.
        INSERT INTO public.auto_content_groups(name,description,stt,is_active,staff_id,organization_id,is_delete)
          VALUES(v_copy_name,v_content_group.description,100,true,p_staff_id,p_organization_id,false)
          ON CONFLICT (staff_id, (lower(btrim(name)))) WHERE staff_id IS NOT NULL AND is_delete=false
          DO NOTHING RETURNING id INTO v_target_id;
        EXIT WHEN v_target_id IS NOT NULL;
        v_name_attempt:=v_name_attempt+1;
        v_copy_name:=v_base_name||' ('||v_name_attempt||')';
      END LOOP;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.auto_content_groups WHERE id=v_target_id AND is_active) THEN RAISE EXCEPTION 'invalid_group_copy_target'; END IF;
    FOR v_row IN SELECT * FROM public.auto_content_templates
      WHERE group_id=p_group_id AND staff_id=v_content_group.staff_id AND organization_id=p_organization_id
        AND NOT is_delete AND (v_template_id IS NULL OR id=v_template_id) ORDER BY id
    LOOP
      v_copy_name:=v_row.name;
      v_base_name:=v_row.name||' - Bản sao';
      v_name_attempt:=0;
      LOOP
        INSERT INTO public.auto_content_templates(name,content,group_id,content_type_id,image_urls,channels,channel_image_urls,base_content_html,staff_id,organization_id,is_delete)
          VALUES(v_copy_name,v_row.content,v_target_id,v_row.content_type_id,v_row.image_urls,v_row.channels,v_row.channel_image_urls,v_row.base_content_html,p_staff_id,p_organization_id,false)
          ON CONFLICT (staff_id, (lower(btrim(name)))) WHERE is_delete=false
          DO NOTHING RETURNING id INTO v_inserted_template_id;
        EXIT WHEN v_inserted_template_id IS NOT NULL;
        v_name_attempt:=v_name_attempt+1;
        v_copy_name:=v_base_name||CASE WHEN v_name_attempt=1 THEN '' ELSE ' ('||v_name_attempt||')' END;
      END LOOP;
      v_count:=v_count+1;
    END LOOP;
  END IF;
  v_result:=jsonb_build_object('groupId',v_target_id,'count',v_count);
  UPDATE private.group_copy_requests SET result=v_result WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND request_id=v_request;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION private.copy_shared_group(bigint,bigint,text,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
