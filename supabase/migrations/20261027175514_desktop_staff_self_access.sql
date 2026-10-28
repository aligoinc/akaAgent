-- akachat only. Server-side Desktop staff privacy; no client update or business-row edits.
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NOT NULL THEN RAISE EXCEPTION 'staff self-access helper already exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='251162422553d81d432151554b5ea16a' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_cron(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='56a86a47ffa20258ea837b2a1289609c' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_admin_cron(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_docs(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='1a760b48ffee2a75ae29f85c02ce5cb8' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_admin_docs(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_notifications(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='ec4117c4cc813bf8fe926c21e7da3c8d' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_admin_notifications(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_settings(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='6bdb2aebad3cd7a8b83ccfdba3e103c9' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_admin_settings(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_triggers(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='9f2b68cdb38f9e3209d32e1420af4b01' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_admin_triggers(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='d6bbdca20f780005a411e8a6be6ae8e5' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='689c389e3380c75497c720e7e6c5dafb' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_staff_management(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)') AND md5(pg_get_functiondef(oid))='41d7a8af8bb781e59157a5b919621492' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_staff_runtime_scope(bigint,text)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') AND md5(pg_get_functiondef(oid))='a294e60011edd8d42e90ac2f74ce744c' AND pg_get_userbyid(proowner)='postgres' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}') THEN RAISE EXCEPTION 'staff self-access source drift: %','public.aka_agent_staff_time_allowed(bigint)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.aka_agent_staff_runtime_profile') AND pg_get_viewdef(oid,true)=' SELECT id,
    organization_id,
    name,
    phone,
    username,
    is_active,
    is_admin,
    is_admin_akabiz,
    use_test_workflow,
    deleted_at,
    expiration_date,
    max_running_zalo_web_accounts,
    max_running_facebook_accounts
   FROM org_staff;' AND relacl::text='{postgres=arwdDxtm/postgres,service_role=r/postgres,aka_agent_chat_api=r/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres' AND reloptions=ARRAY['security_barrier=true']) THEN RAISE EXCEPTION 'staff self-access runtime view drift'; END IF;
END $guard$;
CREATE FUNCTION private.aka_agent_staff_scope_for_request()
 RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
BEGIN
 -- SET ROLE is retained across SECURITY DEFINER calls; current_user is not.
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
 BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
  v_user := NULLIF(v_claims->>'sub','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
 END;
 SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user;
 RETURN COALESCE(v_staff,0);
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_staff_scope_for_request() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO aka_agent_desktop,service_role,aka_agent_chat_api;
CREATE OR REPLACE VIEW public.aka_agent_staff_runtime_profile WITH (security_barrier=true) AS SELECT id,
    organization_id,
    name,
    phone,
    username,
    is_active,
    is_admin,
    is_admin_akabiz,
    use_test_workflow,
    deleted_at,
    expiration_date,
    max_running_zalo_web_accounts,
    max_running_facebook_accounts
   FROM org_staff
 WHERE (SELECT private.aka_agent_staff_scope_for_request()) IS NULL
    OR id=(SELECT private.aka_agent_staff_scope_for_request());
CREATE OR REPLACE FUNCTION private.group_access(p_kind text, p_group_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH resource AS (
    SELECT id,staff_id,organization_id,sharing_scope,sharing_revision
    FROM public.auto_account_contact_groups
    WHERE p_kind='data' AND id=p_group_id AND purpose='data_group' AND NOT is_delete
    UNION ALL
    SELECT id,staff_id,organization_id,sharing_scope,sharing_revision
    FROM public.auto_content_groups
    WHERE p_kind='content' AND id=p_group_id AND NOT is_delete
  )
  SELECT jsonb_build_object(
    'ownerStaffId',g.staff_id,'ownerName',CASE WHEN (SELECT private.aka_agent_staff_scope_for_request()) IS NOT NULL
      AND owner.id IS DISTINCT FROM (SELECT private.aka_agent_staff_scope_for_request())
      THEN 'Nhân viên #'||owner.id ELSE COALESCE(NULLIF(owner.name,''),'Nhân viên #'||owner.id) END,
    'role',CASE WHEN g.staff_id=p_staff_id THEN 'owner' ELSE 'shared' END,
    'canManage',g.staff_id=p_staff_id,'canUse',true,'canCopy',true,
    'scope',g.sharing_scope,'revision',g.sharing_revision::text)
  FROM resource g
  JOIN public.org_staff owner ON owner.id=g.staff_id AND owner.organization_id=g.organization_id
    AND owner.deleted_at IS NULL AND owner.is_active
  JOIN public.org_staff viewer ON viewer.id=p_staff_id AND viewer.organization_id=g.organization_id
    AND viewer.deleted_at IS NULL AND viewer.is_active
  WHERE g.organization_id=p_organization_id AND (
    g.staff_id=p_staff_id OR g.sharing_scope='organization' OR
    (g.sharing_scope='selected' AND (
      (p_kind='data' AND EXISTS(SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id=g.id AND r.staff_id=p_staff_id))
      OR (p_kind='content' AND EXISTS(SELECT 1 FROM public.auto_content_group_recipients r WHERE r.group_id=g.id AND r.staff_id=p_staff_id))
    ))
  );
$function$
;
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
    IF private.aka_agent_staff_scope_for_request() IS NOT NULL THEN RETURN '[]'::jsonb; END IF;
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
CREATE OR REPLACE FUNCTION public.aka_agent_staff_runtime_scope(p_staff_id bigint, p_lock text)
 RETURNS SETOF aka_agent_staff_runtime_profile
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF p_staff_id IS NULL OR p_staff_id<=0 OR p_lock IS NULL OR p_lock NOT IN ('share','update') THEN
  RAISE EXCEPTION 'staff_runtime_scope_invalid';
 END IF;
 IF private.aka_agent_staff_scope_for_request() IS NOT NULL
    AND p_staff_id IS DISTINCT FROM private.aka_agent_staff_scope_for_request() THEN RETURN; END IF;
 IF p_lock='share' THEN
  RETURN QUERY SELECT s.id,s.organization_id,s.name,s.phone,s.username,s.is_active,s.is_admin,s.is_admin_akabiz,s.use_test_workflow,s.deleted_at,s.expiration_date,s.max_running_zalo_web_accounts,s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id=p_staff_id FOR SHARE OF s;
 ELSE
  RETURN QUERY SELECT s.id,s.organization_id,s.name,s.phone,s.username,s.is_active,s.is_admin,s.is_admin_akabiz,s.use_test_workflow,s.deleted_at,s.expiration_date,s.max_running_zalo_web_accounts,s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id=p_staff_id FOR UPDATE OF s;
 END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_staff_time_allowed(p_staff_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce((SELECT s.is_active AND s.deleted_at IS NULL AND
    (NOT o.use_staff_expiration OR s.expiration_date IS NULL OR
      timezone('Asia/Ho_Chi_Minh',s.expiration_date)::date >= timezone('Asia/Ho_Chi_Minh',now())::date)
    FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id WHERE s.id=p_staff_id
      AND ((SELECT private.aka_agent_staff_scope_for_request()) IS NULL
        OR s.id=(SELECT private.aka_agent_staff_scope_for_request()))),false);
$function$
;
REVOKE EXECUTE ON FUNCTION public.aka_agent_admin_cron(bigint,text,text,text,jsonb) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_admin_docs(bigint,text,text,text,jsonb) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_admin_notifications(bigint,text,text,text,jsonb) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_admin_settings(bigint,text,text,text,jsonb) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_admin_triggers(bigint,text,text,text,jsonb) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_staff_management(bigint,text,text,text,jsonb) FROM aka_agent_desktop;
NOTIFY pgrst,'reload schema';
-- Exact target postconditions
DO $post$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text='{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','private.aka_agent_staff_scope_for_request()'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='d173eaf22b0b6b6958a6f8f40cdaa82d' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_cron(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='56a86a47ffa20258ea837b2a1289609c' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_cron(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_docs(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='1a760b48ffee2a75ae29f85c02ce5cb8' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_docs(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_notifications(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='ec4117c4cc813bf8fe926c21e7da3c8d' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_notifications(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_settings(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='6bdb2aebad3cd7a8b83ccfdba3e103c9' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_settings(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_triggers(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='9f2b68cdb38f9e3209d32e1420af4b01' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_triggers(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='5bb87b66104f2dad716797e28cd6cccc' AND proacl::text='{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='689c389e3380c75497c720e7e6c5dafb' AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_staff_management(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)') AND md5(pg_get_functiondef(oid))='b24e654e7f7d3e840db80611affdaa43' AND proacl::text='{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_staff_runtime_scope(bigint,text)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') AND md5(pg_get_functiondef(oid))='7569f2b3816985cac48c114c891b5672' AND proacl::text='{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_staff_time_allowed(bigint)'; END IF;
 IF pg_get_viewdef('public.aka_agent_staff_runtime_profile'::regclass,true) IS DISTINCT FROM ' SELECT id,
    organization_id,
    name,
    phone,
    username,
    is_active,
    is_admin,
    is_admin_akabiz,
    use_test_workflow,
    deleted_at,
    expiration_date,
    max_running_zalo_web_accounts,
    max_running_facebook_accounts
   FROM org_staff
  WHERE (( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request)) IS NULL OR id = (( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request));' THEN RAISE EXCEPTION 'staff self-access target view mismatch'; END IF;
END $post$;
