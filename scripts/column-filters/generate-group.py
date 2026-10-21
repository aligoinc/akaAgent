import json,re
from pathlib import Path
from sql_codegen import render_reader
root=Path(__file__).resolve().parents[2]
cap=root/'migrations/snapshots/column-filters-v421'
legacy=json.loads((cap/'public.aka_agent_list_data_group_members_v205_internal.json').read_text())['definition']
base=legacy.split('WITH filtered AS (',1)[1].split('), paged AS MATERIALIZED',1)[0].strip()
# Preserve all legacy scope/search/status predicates verbatim; add typed columns before paging.
status="""CASE WHEN contact.contact_type='group' THEN CASE WHEN contact.is_joined IS TRUE THEN 'joined' ELSE 'not_joined' END
 WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
  CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
   WHEN contact.is_friend IS TRUE THEN 'friend'
   WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
   WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent' ELSE 'stranger' END
 WHEN contact.contact_type='person' THEN CASE WHEN contact.is_friend THEN 'friend' WHEN NOT contact.is_friend THEN 'stranger' ELSE 'unknown' END
 ELSE NULL END"""
name="COALESCE(NULLIF(CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),contact.name) END,''),NULLIF(contact.name,''),contact.email)"
display="CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),contact.name) END"
fields={'name':name,'displayName':display,'uid':"COALESCE(NULLIF(contact.uid,''),contact.email)",'phone':'contact.phone','url':'contact.url','email':'contact.email','account':'contact.account_id::text','dataType':'origin.data_type_category_item_id::text','status':status,'source':"CASE WHEN source_type.id IS NOT NULL THEN source_category.code END",'automation':"CASE WHEN p_viewer_id=p_staff_id AND source_type.id IS NOT NULL AND source_category.code='automation' THEN COALESCE(NULLIF(btrim(automation.name),''),NULLIF(btrim(origin.source_name_snapshot),'')) END"}
fields.update({f'info{n}':f"contact.extra_data->>'info{n}'" for n in range(1,6)})
projection=',\n'.join(f'{expr} AS "f_{field}"' for field,expr in fields.items())
base=base.replace('FROM public.auto_account_contact_group_members AS member',',\n'+projection+'\n    FROM public.auto_account_contact_group_members AS member\n    CROSS JOIN params')
lateral=legacy.split('LEFT JOIN LATERAL (',1)[1].split(') AS primary_source ON true',1)[0]
lateral=lateral.replace('filtered.primary_origin_id','member.primary_origin_id').replace('filtered.selected_member_id','member.id')
base=base.replace('WHERE member.group_id = p_group_id',f"""LEFT JOIN public.auto_account_contact_group_member_origins origin ON origin.id=member.primary_origin_id AND origin.membership_id=member.id AND origin.is_current
 LEFT JOIN public.category_item source_category ON source_category.id=origin.source_category_item_id AND source_category.is_active AND source_category.managed_by='system' AND source_category.code=public.aka_agent_data_group_source_code(origin.kind)
 LEFT JOIN public.category_type source_type ON source_type.id=source_category.category_type_id AND source_type.namespace='common' AND source_type.code='data_source' AND source_type.managed_by='system' AND source_type.is_active
 LEFT JOIN public.auto_automation_detail automation_detail ON automation_detail.id=origin.automation_detail_id AND automation_detail.staff_id=p_staff_id AND automation_detail.organization_id=p_organization_id
 LEFT JOIN public.auto_automation automation ON automation.id=automation_detail.automation_id AND automation.staff_id=p_staff_id AND automation.organization_id=p_organization_id
 WHERE member.group_id = p_group_id""")
base+="""
 AND (p_data_type_category_item_ids IS NULL OR origin.data_type_category_item_id=ANY(p_data_type_category_item_ids))
 AND (p_source_codes IS NULL OR EXISTS(SELECT 1 FROM public.auto_account_contact_group_member_origins o JOIN public.category_item c ON c.id=o.source_category_item_id WHERE o.membership_id=member.id AND o.is_current AND c.code=ANY(p_source_codes)))
"""
params=['$1::bigint AS p_staff_id','$2::bigint AS p_organization_id','$4::bigint AS p_viewer_id',"($3->>'groupId')::bigint AS p_group_id","$3->>'search' AS p_search","COALESCE(($3->>'includeAccountless')::boolean,true) AS p_include_accountless","COALESCE($3->>'status','all') AS p_status"]
for key,param,typ in [('accountIds','p_account_ids','bigint'),('contactTypes','p_contact_types','text'),('flatformTypes','p_flatform_types','text'),('datasetIds','p_dataset_ids','bigint'),('dataTypeCategoryItemIds','p_data_type_category_item_ids','bigint'),('sourceCodes','p_source_codes','text'),('ids','p_ids','bigint'),('excludeIds','p_exclude_ids','bigint')]:
 params.append(f"CASE WHEN jsonb_array_length(COALESCE($3->'{key}','[]'::jsonb))>0 THEN ARRAY(SELECT jsonb_array_elements_text($3->'{key}')::{typ}) END AS {param}")
head="""CREATE FUNCTION public.aka_agent_read_filtered_group_v1(p_staff_id bigint,p_organization_id bigint,p_auth_username text,p_auth_password text,p_query jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='60s' AS $fn$
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
__CURSOR_VALIDATION__ count_sql:=CASE WHEN p_query->>'countMode'='none' THEN 'NULL::bigint' ELSE '(SELECT count(*) FROM matched)' END;
 sql:=$query$
 WITH params AS (SELECT __PARAMS__), candidate AS (__BASE__),
 matched AS __MATERIALIZED__ (SELECT selected_member_id,member_created_at FROM candidate WHERE __PREDICATE__),
 page AS MATERIALIZED (SELECT * FROM matched WHERE __CURSOR__ ORDER BY member_created_at DESC,selected_member_id DESC OFFSET __OFFSET__ LIMIT __LIMIT__)
 SELECT (SELECT array_agg(selected_member_id ORDER BY member_created_at DESC,selected_member_id DESC) FROM page), __COUNT__,
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
END $fn$;
REVOKE ALL ON FUNCTION public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb) TO anon,authenticated,service_role;
"""
(root/'scripts/column-filters/sql/data-group.sql').write_text(render_reader(head.replace('__PARAMS__',',\n'.join(params)).replace('__BASE__',base),'group'))
