BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE sharing_revoke_original ON COMMIT DROP AS SELECT (SELECT md5(jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,md5(pg_get_functiondef(p.oid)),p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND a.attnum>0 AND NOT a.attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND NOT t.tgisinternal)
 )::text)) AS full_fingerprint,(SELECT md5(jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,CASE WHEN p.oid='public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'::regprocedure THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END,p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND a.attnum>0 AND NOT a.attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND NOT t.tgisinternal)
 )::text)) AS unchanged_fingerprint;
-- Candidate: preserve owner-authorized sharing revocation after Desktop ownership cutover.
-- Only the captured sharing RPC body changes; existing ACL/RLS/helpers remain unchanged.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='af95bdbae9bfc75343ddd96eda51dcc7' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke source drift: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') AND md5(pg_get_functiondef(oid))='ca07284b7f0f0a3ab5a6ee7c8e745ab6' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke source drift: %','public.aka_agent_lock_campaign_input_serialization(bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='f50796438b0e90ef184fa25cc4043e98' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke source drift: %','public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='31494192d0a18efeafa4fb0296008230' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke source drift: %','private.aka_agent_assert_request_ownership(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke source drift: %','private.aka_agent_staff_scope_for_request()'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='c47165554f49d3099d1f95e7d136eae5' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke source drift: %','private.can_read_data_group(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='d173eaf22b0b6b6958a6f8f40cdaa82d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke source drift: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
END $guard$;
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
  IF private.aka_agent_staff_scope_for_request() IS NOT NULL
    AND p_staff_id IS DISTINCT FROM private.aka_agent_staff_scope_for_request() THEN
    RAISE EXCEPTION 'group_sharing_access_denied';
  END IF;
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
          -- The group owner may stop a revoked recipient's source after the
          -- checks above. Keep the public helper guarded for direct callers.
          -- Same lock key/order as aka_agent_lock_campaign_input_serialization.
          IF v_row.campaign_id IS NULL OR v_row.campaign_id <= 0 THEN
            RAISE EXCEPTION 'campaign_input_serialization_id_invalid';
          END IF;
          PERFORM pg_advisory_xact_lock(hashtextextended(
            'aka-agent-campaign-input-serialization:' || v_row.campaign_id::text, 0
          ));
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
$function$
;
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='0e17dec0570937cfea8a1ae035e2af4d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') AND md5(pg_get_functiondef(oid))='ca07284b7f0f0a3ab5a6ee7c8e745ab6' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','public.aka_agent_lock_campaign_input_serialization(bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='f50796438b0e90ef184fa25cc4043e98' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='31494192d0a18efeafa4fb0296008230' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.aka_agent_assert_request_ownership(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.aka_agent_staff_scope_for_request()'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='c47165554f49d3099d1f95e7d136eae5' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.can_read_data_group(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='d173eaf22b0b6b6958a6f8f40cdaa82d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
END $guard$;
NOTIFY pgrst,'reload schema';

DO $behavior$
DECLARE u record; expected jsonb; actual jsonb; other_campaign bigint; denied boolean; users_checked integer:=0;
BEGIN
 IF has_function_privilege('anon','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'legacy sharing access reopened'; END IF;
 IF NOT has_function_privilege('aka_agent_desktop','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'required sharing access missing'; END IF;
 FOR u IN SELECT m.staff_id,m.auth_user_id,s.organization_id,s.username,s.password
 FROM private.aka_agent_desktop_users m JOIN public.org_staff s ON s.id=m.staff_id
 WHERE s.is_active AND s.deleted_at IS NULL AND public.aka_agent_staff_time_allowed(s.id)
 ORDER BY m.staff_id LIMIT 6 LOOP
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',COALESCE(NULLIF(s.name,''),'Nhân viên #'||s.id)) ORDER BY s.name,s.id),'[]'::jsonb) INTO expected FROM public.org_staff s WHERE s.organization_id=u.organization_id AND s.deleted_at IS NULL AND s.is_active AND s.id<>u.staff_id;
  SELECT id INTO other_campaign FROM public.auto_campaigns WHERE staff_id IS DISTINCT FROM u.staff_id ORDER BY id LIMIT 1;
  IF other_campaign IS NULL THEN RAISE EXCEPTION 'foreign campaign sample missing'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',u.auth_user_id)::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  IF private.aka_agent_staff_scope_for_request() IS DISTINCT FROM u.staff_id THEN RAISE EXCEPTION 'staff binding mismatch'; END IF;
  actual:=public.aka_agent_group_sharing(u.staff_id,u.organization_id,u.username,u.password,'staff','{}');
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'sharing directory changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=other_campaign) THEN RAISE EXCEPTION 'foreign campaign exposed'; END IF;
  denied:=false;
  BEGIN PERFORM public.aka_agent_lock_campaign_input_serialization(other_campaign);
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM='desktop_campaign_scope_denied' THEN denied:=true; ELSE RAISE; END IF; END;
  IF NOT denied THEN RAISE EXCEPTION 'cross-staff lock guard failed'; END IF;
  denied:=false;
  BEGIN PERFORM public.aka_agent_group_sharing(u.staff_id+10000000,u.organization_id,'invalid','invalid','save','{}');
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='group_sharing_access_denied' THEN denied:=true; ELSE RAISE; END IF; END;
  IF NOT denied THEN RAISE EXCEPTION 'foreign sharing identity accepted'; END IF;
  RESET ROLE;
  users_checked:=users_checked+1;
 END LOOP;
 IF users_checked=0 THEN RAISE EXCEPTION 'active mapped users required'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE aka_agent_desktop;
 denied:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(-1,-1,'invalid','invalid','save','{}');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='group_sharing_access_denied' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'missing claims accepted'; END IF;
 RESET ROLE;
 SET LOCAL ROLE anon;
 denied:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(-1,-1,'invalid','invalid','save','{}');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'anon sharing allowed'; END IF;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 IF private.aka_agent_staff_scope_for_request() IS NOT NULL THEN RAISE EXCEPTION 'backend scope changed'; END IF;
 RESET ROLE;
END $behavior$;
DO $compare$ DECLARE original text; actual text; BEGIN SELECT unchanged_fingerprint INTO original FROM sharing_revoke_original; SELECT md5(jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,CASE WHEN p.oid='public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'::regprocedure THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END,p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND a.attnum>0 AND NOT a.attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND NOT t.tgisinternal)
 )::text) INTO actual; IF actual IS DISTINCT FROM original THEN RAISE EXCEPTION 'sharing rehearsal metadata changed: unchanged_fingerprint'; END IF; END $compare$;
SET LOCAL aka_agent.group_sharing_revoke_rollback='approved';
-- Manual rollback of this one body; restores the sharing-revocation bug.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $approval$ BEGIN IF current_setting('aka_agent.group_sharing_revoke_rollback',true) IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'sharing revoke rollback requires approval'; END IF; END $approval$;
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='0e17dec0570937cfea8a1ae035e2af4d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback drift: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') AND md5(pg_get_functiondef(oid))='ca07284b7f0f0a3ab5a6ee7c8e745ab6' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback drift: %','public.aka_agent_lock_campaign_input_serialization(bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='f50796438b0e90ef184fa25cc4043e98' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback drift: %','public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='31494192d0a18efeafa4fb0296008230' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback drift: %','private.aka_agent_assert_request_ownership(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback drift: %','private.aka_agent_staff_scope_for_request()'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='c47165554f49d3099d1f95e7d136eae5' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback drift: %','private.can_read_data_group(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='d173eaf22b0b6b6958a6f8f40cdaa82d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback drift: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
END $guard$;
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
  IF private.aka_agent_staff_scope_for_request() IS NOT NULL
    AND p_staff_id IS DISTINCT FROM private.aka_agent_staff_scope_for_request() THEN
    RAISE EXCEPTION 'group_sharing_access_denied';
  END IF;
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
$function$
;
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='af95bdbae9bfc75343ddd96eda51dcc7' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback mismatch: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') AND md5(pg_get_functiondef(oid))='ca07284b7f0f0a3ab5a6ee7c8e745ab6' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback mismatch: %','public.aka_agent_lock_campaign_input_serialization(bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='f50796438b0e90ef184fa25cc4043e98' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback mismatch: %','public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='31494192d0a18efeafa4fb0296008230' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback mismatch: %','private.aka_agent_assert_request_ownership(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback mismatch: %','private.aka_agent_staff_scope_for_request()'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='c47165554f49d3099d1f95e7d136eae5' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback mismatch: %','private.can_read_data_group(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='d173eaf22b0b6b6958a6f8f40cdaa82d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke rollback mismatch: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
END $guard$;
NOTIFY pgrst,'reload schema';

DO $compare$ DECLARE original text; actual text; BEGIN SELECT full_fingerprint INTO original FROM sharing_revoke_original; SELECT md5(jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,md5(pg_get_functiondef(p.oid)),p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND a.attnum>0 AND NOT a.attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND NOT t.tgisinternal)
 )::text) INTO actual; IF actual IS DISTINCT FROM original THEN RAISE EXCEPTION 'sharing rehearsal metadata changed: full_fingerprint'; END IF; END $compare$;
ROLLBACK; SELECT true AS production_rollback_trial_passed;
