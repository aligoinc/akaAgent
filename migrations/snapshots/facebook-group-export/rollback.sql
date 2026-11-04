-- Explicit rollback only; no business data is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ DECLARE e jsonb; a record; BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements($manifest$[{"signature":"public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)","checksum":"1d683e7bd73dcd86276b44b27f91901f","owner":"postgres","prosecdef":true,"provolatile":"v","proconfig":["search_path=pg_catalog, public","statement_timeout=60s"],"acl":"{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}","sourceChecksum":"0e17dec0570937cfea8a1ae035e2af4d"},{"signature":"public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)","checksum":"f4c329181aa3a2e1a3c1f41a6d89f237","owner":"postgres","prosecdef":true,"provolatile":"s","proconfig":["search_path=pg_catalog, public","statement_timeout=60s"],"acl":"{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}","sourceChecksum":"17ffadd05bb48b245a4382789c6d59ea"},{"signature":"public.aka_agent_get_campaign_group_export_metadata(bigint,bigint,bigint,bigint[],text,text)","checksum":"3b9d5d422593121d936effa8b225b496","owner":"postgres","prosecdef":true,"provolatile":"s","proconfig":["search_path=pg_catalog, public","statement_timeout=60s"],"acl":"{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}"}]$manifest$::jsonb) LOOP
  SELECT md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text acl
   INTO a FROM pg_proc p WHERE p.oid=to_regprocedure(e->>'signature');
  IF NOT FOUND OR a.checksum IS DISTINCT FROM e->>'checksum' OR a.owner IS DISTINCT FROM e->>'owner'
   OR a.prosecdef IS DISTINCT FROM (e->>'prosecdef')::boolean OR a.provolatile::text IS DISTINCT FROM e->>'provolatile'
   OR to_jsonb(a.proconfig) IS DISTINCT FROM e->'proconfig' OR a.acl IS DISTINCT FROM e->>'acl' THEN
   RAISE EXCEPTION 'V443 function drift: %',e->>'signature'; END IF;
 END LOOP;
END $guard$;

DROP FUNCTION public.aka_agent_get_campaign_group_export_metadata(bigint,bigint,bigint,bigint[],text,text);
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
CREATE OR REPLACE FUNCTION public.aka_agent_read_filtered_group_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE access jsonb; owner_id bigint; group_id bigint; predicate text; sql text; selected_ids bigint[]; total bigint; rows jsonb;
 page_limit integer; page_offset integer; page_cursor jsonb; cursor_clause text:='true'; count_sql text; key text;
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR octet_length(p_query::text)>2097152 THEN RAISE EXCEPTION 'invalid_filter_query' USING ERRCODE='22023'; END IF;
 group_id:=(p_query->>'groupId')::bigint;
 access:=private.group_access('data',group_id,p_staff_id,p_organization_id);
 IF access IS NULL THEN RAISE EXCEPTION 'group_access_denied' USING ERRCODE='42501'; END IF;
 owner_id:=(access->>'ownerStaffId')::bigint;
 page_limit:=COALESCE((p_query->>'limit')::integer,100); page_offset:=COALESCE((p_query->>'offset')::integer,0);
 IF page_limit NOT BETWEEN 1 AND 500 OR page_offset NOT BETWEEN 0 AND 100000 OR COALESCE(p_query->>'status','all') NOT IN ('all','active','inactive','friend','stranger','joined','not_joined','request_sent','request_received') THEN RAISE EXCEPTION 'invalid_filter_query' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY ARRAY['accountIds','contactTypes','flatformTypes','datasetIds','dataTypeCategoryItemIds','sourceCodes','ids','excludeIds'] LOOP
  IF p_query ? key AND (jsonb_typeof(p_query->key) IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->key)>CASE WHEN key IN ('ids','excludeIds') THEN 100000 ELSE 1000 END) THEN RAISE EXCEPTION 'invalid_filter_query_array' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_query->'sourceCodes','[]')) v WHERE v NOT IN ('upload','scan','automation','dynamic_filter','external_sync')) THEN RAISE EXCEPTION 'invalid_data_group_source_filter'; END IF;
 predicate:=private.column_filter_predicate_v1('data_group',p_query->'columnFilters');
 IF p_query ? 'after' THEN
  IF page_offset<>0
   OR jsonb_typeof(p_query->'after') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_query#>'{after,id}') IS DISTINCT FROM 'string'
   OR (p_query#>>'{after,id}') !~ '^[1-9][0-9]{0,15}$'
   OR jsonb_typeof(p_query#>'{after,createdAt}') IS DISTINCT FROM 'string'
   OR (p_query#>>'{after,createdAt}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'invalid_filter_cursor' USING ERRCODE='22023'; END IF;
  BEGIN
   IF (p_query#>>'{after,id}')::bigint>9007199254740991 OR NOT isfinite((p_query#>>'{after,createdAt}')::timestamptz) THEN
    RAISE EXCEPTION 'invalid_filter_cursor' USING ERRCODE='22023';
   END IF;
   
  EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'invalid_filter_cursor' USING ERRCODE='22023'; END;
  cursor_clause:=$cursor$(member_created_at,selected_member_id)<(($3#>>'{after,createdAt}')::timestamptz,($3#>>'{after,id}')::bigint)$cursor$;
 END IF;
 count_sql:=CASE WHEN p_query->>'countMode'='none' THEN 'NULL::bigint' ELSE '(SELECT count(*) FROM matched)' END;
 sql:=$query$
 WITH params AS (SELECT $1::bigint AS p_staff_id,
$2::bigint AS p_organization_id,
$4::bigint AS p_viewer_id,
($3->>'groupId')::bigint AS p_group_id,
$3->>'search' AS p_search,
COALESCE(($3->>'includeAccountless')::boolean,true) AS p_include_accountless,
COALESCE($3->>'status','all') AS p_status,
CASE WHEN jsonb_array_length(COALESCE($3->'accountIds','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'accountIds')::bigint) END AS p_account_ids,
CASE WHEN jsonb_array_length(COALESCE($3->'contactTypes','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'contactTypes')::text) END AS p_contact_types,
CASE WHEN jsonb_array_length(COALESCE($3->'flatformTypes','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'flatformTypes')::text) END AS p_flatform_types,
CASE WHEN jsonb_array_length(COALESCE($3->'datasetIds','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'datasetIds')::bigint) END AS p_dataset_ids,
CASE WHEN jsonb_array_length(COALESCE($3->'dataTypeCategoryItemIds','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'dataTypeCategoryItemIds')::bigint) END AS p_data_type_category_item_ids,
CASE WHEN jsonb_array_length(COALESCE($3->'sourceCodes','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'sourceCodes')::text) END AS p_source_codes,
CASE WHEN jsonb_array_length(COALESCE($3->'ids','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'ids')::bigint) END AS p_ids,
CASE WHEN jsonb_array_length(COALESCE($3->'excludeIds','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'excludeIds')::bigint) END AS p_exclude_ids), candidate AS (SELECT
      member.id AS selected_member_id,
      member.group_id AS selected_group_id,
      member.contact_id,
      member.created_at AS member_created_at,
      member.updated_at AS member_updated_at,
      member.is_delete AS member_is_delete,
      member.change_revision,
      member.primary_origin_id,
      contact.name,
      contact.uid,
      contact.url,
      contact.phone,
      contact.email,
      contact.extra_data,
      contact.contact_type,
      contact.flatform_type,
      contact.account_id,
      contact.is_friend,
      contact.is_joined,
      account.name AS selected_account_name,
      COALESCE(account.is_delete, false) AS selected_account_deleted
    ,
COALESCE(NULLIF(CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),contact.name) END,''),NULLIF(contact.name,''),contact.email) AS "f_name",
CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),contact.name) END AS "f_displayName",
COALESCE(NULLIF(contact.uid,''),contact.email) AS "f_uid",
contact.phone AS "f_phone",
contact.url AS "f_url",
contact.email AS "f_email",
contact.account_id::text AS "f_account",
origin.data_type_category_item_id::text AS "f_dataType",
CASE WHEN contact.contact_type='group' THEN CASE WHEN contact.is_joined IS TRUE THEN 'joined' ELSE 'not_joined' END
 WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
  CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
   WHEN contact.is_friend IS TRUE THEN 'friend'
   WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
   WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent' ELSE 'stranger' END
 WHEN contact.contact_type='person' THEN CASE WHEN contact.is_friend THEN 'friend' WHEN NOT contact.is_friend THEN 'stranger' ELSE 'unknown' END
 ELSE NULL END AS "f_status",
CASE WHEN source_type.id IS NOT NULL THEN source_category.code END AS "f_source",
CASE WHEN p_viewer_id=p_staff_id AND source_type.id IS NOT NULL AND source_category.code='automation' THEN COALESCE(NULLIF(btrim(automation.name),''),NULLIF(btrim(origin.source_name_snapshot),'')) END AS "f_automation",
contact.extra_data->>'info1' AS "f_info1",
contact.extra_data->>'info2' AS "f_info2",
contact.extra_data->>'info3' AS "f_info3",
contact.extra_data->>'info4' AS "f_info4",
contact.extra_data->>'info5' AS "f_info5"
    FROM public.auto_account_contact_group_members AS member
    CROSS JOIN params
    JOIN public.auto_account_contacts AS contact
      ON contact.id = member.contact_id
    LEFT JOIN public.auto_accounts AS account
      ON account.id = contact.account_id
    LEFT JOIN public.zalo_users z ON z.account_id=contact.account_id AND z.zalo_uid=contact.uid
      AND z.staff_id=contact.staff_id AND z.organization_id=contact.organization_id AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_organization b ON b.auto_account_id=contact.account_id
      AND b.organization_id=contact.organization_id AND b.is_active AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=b.chat_zalo_account_id
      AND u.zalo_id=contact.uid AND contact.contact_type='person'
    LEFT JOIN public.category_item status ON status.id=u.friendship_status_category_item_id
    LEFT JOIN public.auto_account_contact_group_member_origins origin ON origin.id=member.primary_origin_id AND origin.membership_id=member.id AND origin.is_current
 LEFT JOIN public.category_item source_category ON source_category.id=origin.source_category_item_id AND source_category.is_active AND source_category.managed_by='system' AND source_category.code=public.aka_agent_data_group_source_code(origin.kind)
 LEFT JOIN public.category_type source_type ON source_type.id=source_category.category_type_id AND source_type.namespace='common' AND source_type.code='data_source' AND source_type.managed_by='system' AND source_type.is_active
 LEFT JOIN public.auto_automation_detail automation_detail ON automation_detail.id=origin.automation_detail_id AND automation_detail.staff_id=p_staff_id AND automation_detail.organization_id=p_organization_id
 LEFT JOIN public.auto_automation automation ON automation.id=automation_detail.automation_id AND automation.staff_id=p_staff_id AND automation.organization_id=p_organization_id
 WHERE member.group_id = p_group_id
      AND contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND member.is_delete = false
      AND (
        COALESCE(p_status, 'all') = 'all'
        OR (
          COALESCE(p_status, 'all') = 'active' AND (
            (contact.contact_type = 'person' AND contact.is_friend = true)
            OR (contact.contact_type = 'group' AND contact.is_joined = true)
            OR contact.contact_type NOT IN ('person', 'group')
          )
        )
        OR (
          COALESCE(p_status, 'all') = 'inactive' AND (
            (contact.contact_type = 'person' AND contact.is_friend = false)
            OR (contact.contact_type = 'group' AND contact.is_joined = false)
          )
        )
        OR (
          COALESCE(p_status, 'all') = 'friend'
          AND contact.contact_type = 'person'
          AND CASE WHEN contact.flatform_type='zalo' THEN (CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)='friend' ELSE contact.is_friend=true END
        )
        OR (
          COALESCE(p_status, 'all') = 'stranger'
          AND contact.contact_type = 'person'
          AND CASE WHEN contact.flatform_type='zalo' THEN (CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)='stranger' ELSE contact.is_friend=false END
        )
        OR (p_status IN ('request_sent','request_received') AND contact.flatform_type='zalo' AND contact.contact_type='person' AND (CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)=p_status)
        OR (
          COALESCE(p_status, 'all') = 'joined'
          AND contact.contact_type = 'group'
          AND contact.is_joined = true
        )
        OR (
          COALESCE(p_status, 'all') = 'not_joined'
          AND contact.contact_type = 'group'
          AND contact.is_joined = false
        )
      )
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR contact.name ILIKE '%%' || btrim(p_search) || '%%'
        OR (CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),contact.name) END) ILIKE '%%' || btrim(p_search) || '%%'
        OR (CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),contact.name) END) ILIKE '%%' || btrim(p_search) || '%%'
        OR contact.uid ILIKE '%%' || btrim(p_search) || '%%'
        OR contact.phone ILIKE '%%' || btrim(p_search) || '%%'
        OR contact.email ILIKE '%%' || btrim(p_search) || '%%'
      )
      AND (
        p_account_ids IS NULL
        OR contact.account_id = ANY(p_account_ids)
        OR (
          COALESCE(p_include_accountless, true)
          AND contact.account_id IS NULL
        )
      )
      AND (
        COALESCE(p_include_accountless, true)
        OR contact.account_id IS NOT NULL
      )
      AND (
        p_contact_types IS NULL
        OR contact.contact_type = ANY(p_contact_types)
      )
      AND (
        p_flatform_types IS NULL
        OR contact.flatform_type = ANY(p_flatform_types)
      )
      AND (p_ids IS NULL OR member.id = ANY(p_ids))
      AND (
        p_exclude_ids IS NULL
        OR NOT (member.id = ANY(p_exclude_ids))
      )
      AND (
        p_dataset_ids IS NULL OR EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS dataset_origin
          WHERE dataset_origin.membership_id = member.id
            AND dataset_origin.dataset_id = ANY(p_dataset_ids)
            AND dataset_origin.is_current = true
        )
      )
 AND (p_data_type_category_item_ids IS NULL OR origin.data_type_category_item_id=ANY(p_data_type_category_item_ids))
 AND (p_source_codes IS NULL OR EXISTS(SELECT 1 FROM public.auto_account_contact_group_member_origins o JOIN public.category_item c ON c.id=o.source_category_item_id WHERE o.membership_id=member.id AND o.is_current AND c.code=ANY(p_source_codes)))
),
 matched AS %4$s (SELECT selected_member_id,member_created_at FROM candidate WHERE %1$s),
 page AS MATERIALIZED (SELECT * FROM matched WHERE %2$s ORDER BY member_created_at DESC,selected_member_id DESC OFFSET $5 LIMIT $6)
 SELECT (SELECT array_agg(selected_member_id ORDER BY member_created_at DESC,selected_member_id DESC) FROM page), %3$s,
 (SELECT jsonb_build_object('createdAt',member_created_at,'id',selected_member_id::text) FROM page ORDER BY member_created_at,selected_member_id LIMIT 1)
 $query$;
 sql:=format(sql,predicate,cursor_clause,count_sql,CASE WHEN p_query->>'countMode'='none' THEN 'NOT MATERIALIZED' ELSE 'MATERIALIZED' END);
 EXECUTE sql INTO selected_ids,total,page_cursor USING owner_id,p_organization_id,p_query,p_staff_id,page_offset,page_limit;
 IF p_query->>'idsOnly'='true' THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v) ORDER BY n),'[]'::jsonb) INTO rows FROM unnest(selected_ids) WITH ORDINALITY t(v,n);
 ELSIF cardinality(selected_ids)>0 THEN
  SELECT COALESCE(jsonb_agg(CASE WHEN owner_id=p_staff_id THEN m-'total_count' ELSE (m-'total_count')||jsonb_build_object('source_automation_id',NULL,'source_automation_name',NULL,'dataset_ids','[]'::jsonb,'dataset_names','[]'::jsonb,'provenance','[]'::jsonb) END),'[]') INTO rows
  FROM private.read_shared_group_members(owner_id,p_organization_id,group_id,NULL,NULL,true,NULL,NULL,'all',NULL,NULL,selected_ids,NULL,0,page_limit) m;
 ELSE rows:='[]'; END IF;
 RETURN jsonb_build_object('version',1,'rows',rows,'total',total,'after',page_cursor,'hasMore',COALESCE(cardinality(selected_ids),0)=page_limit);
END $function$
;
DO $guard$ DECLARE e jsonb; a record; BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements($manifest$[{"signature":"public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)","checksum":"0e17dec0570937cfea8a1ae035e2af4d","owner":"postgres","prosecdef":true,"provolatile":"v","proconfig":["search_path=pg_catalog, public","statement_timeout=60s"],"acl":"{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}"},{"signature":"public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)","checksum":"17ffadd05bb48b245a4382789c6d59ea","owner":"postgres","prosecdef":true,"provolatile":"s","proconfig":["search_path=pg_catalog, public","statement_timeout=60s"],"acl":"{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}"}]$manifest$::jsonb) LOOP
  SELECT md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text acl
   INTO a FROM pg_proc p WHERE p.oid=to_regprocedure(e->>'signature');
  IF NOT FOUND OR a.checksum IS DISTINCT FROM e->>'checksum' OR a.owner IS DISTINCT FROM e->>'owner'
   OR a.prosecdef IS DISTINCT FROM (e->>'prosecdef')::boolean OR a.provolatile::text IS DISTINCT FROM e->>'provolatile'
   OR to_jsonb(a.proconfig) IS DISTINCT FROM e->'proconfig' OR a.acl IS DISTINCT FROM e->>'acl' THEN
   RAISE EXCEPTION 'V443 function drift: %',e->>'signature'; END IF;
 END LOOP;
END $guard$;
NOTIFY pgrst, 'reload schema';
COMMIT;
