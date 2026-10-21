from pathlib import Path
from sql_codegen import render_reader
root=Path(__file__).resolve().parents[2]
first=lambda xs:'COALESCE('+','.join("NULLIF(btrim("+x+"),'')" for x in xs)+')' 
e=lambda k:"c.extra_data->>'"+k+"'"
r=lambda k:"c.extra_data#>>'{rawPayload,"+k+"}'"
phone_fields=[e(k) for k in ['phone','phoneNumber','phone_number','mobilePhone','mobile_phone']]+[r(k) for k in ['phone','phoneNumber','phone_number','mobilePhone','mobile_phone']]
rawphone=first(phone_fields)
# Generic search retains every legacy phone alias; the column still uses its displayed value.
searchphone=','.join(phone_fields)
upload=lambda k:f"btrim(COALESCE({e(k)},{r(k)}))"
uploadphone=first([upload('phone'),first([e('phoneNumber'),e('phone_number'),r('phoneNumber'),r('phone_number')]),"CASE WHEN c.contact_type='phone' THEN c.uid END"])
uploaduid=first([upload('uid'),upload('url'),'c.url',"CASE WHEN c.contact_type NOT IN ('phone','email') THEN c.uid END"])
phone=f"CASE WHEN $4='upload' THEN {uploadphone} ELSE private.column_filter_phone_v1({rawphone}) END"
uid=f"CASE WHEN $4='upload' THEN {uploaduid} ELSE c.uid END"
rank="CASE WHEN gm.id IS NOT NULL THEN COALESCE(gm.role_rank,3) WHEN c.extra_data->>'zaloGroupRoleRank' IN ('1','2','3') THEN (c.extra_data->>'zaloGroupRoleRank')::integer WHEN c.extra_data->>'zaloGroupRole'='owner' OR c.extra_data->>'isCreator'='true' THEN 1 WHEN c.extra_data->>'zaloGroupRole'='admin' OR c.extra_data->>'isAdmin'='true' THEN 2 ELSE 3 END"
fields={'name':'c.name','uid':uid,'phone':phone,'url':'c.url','email':first([upload('email'),"CASE WHEN c.contact_type='email' THEN c.uid END"]),'avatar':"COALESCE("+','.join(f"NULLIF({e(k)},'')" for k in ['avatarUrl','avatar','avatar_url','fullAvatar','full_avatar'])+")",'gender':"CASE (CASE WHEN zu.id IS NOT NULL AND $4<>'group_members' THEN zu.gender::text ELSE c.extra_data->>'gender' END) WHEN '0' THEN 'male' WHEN '1' THEN 'female' ELSE 'unknown' END",'zaloTags':"private.column_filter_zalo_tags_v1(c.extra_data)",'akaBizTags':"c.akabiz_tag_ids::text[]",'memberCount':"CASE WHEN zg.id IS NOT NULL THEN zg.total_member::numeric WHEN c.extra_data->>'totalMember' ~ '^[-+]?[0-9]+([.][0-9]+)?$' THEN (c.extra_data->>'totalMember')::numeric END",'role':f"CASE ({rank}) WHEN 1 THEN 'owner' WHEN 2 THEN 'admin' ELSE 'member' END",'friendship':"CASE WHEN c.is_friend THEN 'friend' WHEN NOT c.is_friend THEN 'stranger' ELSE 'unknown' END",'joined':"CASE WHEN c.is_joined THEN 'joined' ELSE 'not_joined' END",'approval':"CASE WHEN c.requires_post_approval THEN 'required' WHEN NOT c.requires_post_approval THEN 'not_required' ELSE 'unknown' END"}
fields.update({f'info{i}':upload(f'info{i}') for i in range(1,6)})
extra="""COALESCE(c.extra_data,'{}'::jsonb)
 || CASE WHEN zu.id IS NOT NULL AND $4<>'group_members' THEN jsonb_build_object('gender',zu.gender) ELSE '{}'::jsonb END
 || CASE WHEN zg.id IS NOT NULL THEN jsonb_build_object('totalMember',zg.total_member,'groupType',zg.group_type) ELSE '{}'::jsonb END
 || CASE WHEN gm.id IS NOT NULL THEN jsonb_build_object('zaloGroupId',gm.zalo_group_id,'zaloGroupRole',gm.role,'zaloGroupRoleRank',gm.role_rank,'isCreator',gm.is_creator,'isAdmin',gm.is_admin,'zaloGroupRoleLabel',CASE WHEN gm.role='owner' THEN CASE WHEN mg.group_type=2 THEN 'Trưởng cộng đồng' ELSE 'Trưởng nhóm' END WHEN gm.role='admin' THEN CASE WHEN mg.group_type=2 THEN 'Phó cộng đồng' ELSE 'Phó nhóm' END ELSE 'Thành viên' END) ELSE '{}'::jsonb END"""
projection=", ".join(f'{expr} AS "f_{field}"' for field,expr in fields.items())
base=f"""SELECT c.id,
 CASE WHEN $4='group_members' OR $3->>'sortBy'='zalo_group_role' THEN ({rank}) WHEN $3 ? 'datasetId' THEN COALESCE(dm.sort_order,2147483647) ELSE 0 END sort_rank,
 CASE WHEN $4='group_members' OR $3 ? 'datasetId' THEN '' ELSE COALESCE(c.name,'') END sort_name,
 CASE WHEN $4='group_members' THEN COALESCE(gm.updated_at,'epoch'::timestamptz) ELSE 'epoch'::timestamptz END sort_time,
 to_jsonb(c)||jsonb_build_object('extra_data',{extra}) row_data,
 {projection}
 FROM public.auto_account_contacts c
 LEFT JOIN public.auto_account_contacts_dataset_members dm ON dm.dataset_id=($3->>'datasetId')::bigint AND dm.contact_id=c.id AND dm.is_current
 LEFT JOIN public.zalo_users zu ON zu.id=c.zalo_user_id AND zu.account_id=c.account_id AND zu.staff_id=c.staff_id AND zu.organization_id=c.organization_id
 LEFT JOIN public.zalo_groups zg ON c.contact_type='group' AND c.extra_data->>'platform'='zalo' AND zg.account_id=c.account_id AND zg.staff_id=c.staff_id AND zg.organization_id=c.organization_id AND zg.zalo_group_id=c.uid
 LEFT JOIN public.zalo_group_members gm ON $4='group_members' AND gm.account_id=c.account_id AND gm.staff_id=c.staff_id AND gm.organization_id=c.organization_id AND gm.zalo_uid=c.uid AND gm.zalo_group_id=$3->>'zaloGroupId' AND gm.is_current
 LEFT JOIN public.zalo_groups mg ON mg.account_id=gm.account_id AND mg.staff_id=gm.staff_id AND mg.organization_id=gm.organization_id AND mg.zalo_group_id=gm.zalo_group_id
 WHERE c.staff_id=$1 AND c.organization_id=$2 AND c.account_id=($3->>'accountId')::bigint AND c.is_delete=false
 AND ($3->>'contactType' IS NULL OR c.contact_type=$3->>'contactType')
 AND (NOT ($3 ? 'datasetId') OR (dm.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_account_contacts_dataset d WHERE d.id=dm.dataset_id AND d.contact_type=c.contact_type)))
 AND (NOT ($3 ? 'contactGroupId') OR EXISTS(SELECT 1 FROM public.auto_account_contact_group_members g WHERE g.group_id=($3->>'contactGroupId')::bigint AND g.contact_id=c.id AND NOT g.is_delete))
 AND ($4<>'group_members' OR (gm.id IS NOT NULL AND c.contact_type='person'))
 AND (COALESCE($3->>'statusFilter','all')='all' OR c.contact_type NOT IN ('person','group') OR CASE WHEN $3->>'statusFilter'='active' THEN CASE c.contact_type WHEN 'person' THEN c.is_friend IS TRUE ELSE c.is_joined IS TRUE END ELSE CASE c.contact_type WHEN 'person' THEN c.is_friend IS NOT TRUE ELSE c.is_joined IS NOT TRUE END END)
 AND (NOT ($3 ? 'ids') OR c.id IN (SELECT jsonb_array_elements_text($3->'ids')::bigint))
 AND (NOT ($3 ? 'excludeIds') OR c.id NOT IN (SELECT jsonb_array_elements_text($3->'excludeIds')::bigint))
 AND (NULLIF(btrim($3->>'search'),'') IS NULL OR strpos(lower(normalize(concat_ws(' ',c.name,c.uid,{searchphone}),NFC)),lower(normalize(btrim($3->>'search'),NFC)))>0)
 AND (NOT ($3 ?| ARRAY['source','sourcePostUrl','sourceProfileUrl','sourceGroupUrl']) OR private.column_filter_source_match_v1(c.extra_data,$3))
 AND ((COALESCE(jsonb_array_length($3->'zaloTagIds'),0)=0 AND NOT COALESCE(($3->>'zaloNoTag')::boolean,false)) OR private.column_filter_zalo_tags_v1(c.extra_data) && ARRAY(SELECT jsonb_array_elements_text($3->'zaloTagIds')) OR (COALESCE(($3->>'zaloNoTag')::boolean,false) AND cardinality(private.column_filter_zalo_tags_v1(c.extra_data))=0))
 AND ((COALESCE(jsonb_array_length($3->'akaBizTagIds'),0)=0 AND NOT COALESCE(($3->>'akaBizNoTag')::boolean,false)) OR COALESCE(c.akabiz_tag_ids,'{{}}'::bigint[]) && ARRAY(SELECT jsonb_array_elements_text($3->'akaBizTagIds')::bigint) OR (COALESCE(($3->>'akaBizNoTag')::boolean,false) AND COALESCE(cardinality(c.akabiz_tag_ids),0)=0))
"""
head="""CREATE FUNCTION public.aka_agent_read_filtered_contacts_v1(p_staff_id bigint,p_organization_id bigint,p_auth_username text,p_auth_password text,p_source text,p_query jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='60s' AS $fn$
DECLARE predicate text; sql text; result jsonb; page_limit integer; page_offset integer; key text; cursor_clause text:='true'; count_sql text;
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_source IS NULL OR p_source NOT IN ('contacts','upload','group_members') OR jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR octet_length(p_query::text)>2097152 THEN RAISE EXCEPTION 'invalid_filter_query'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=p_staff_id AND s.organization_id=p_organization_id AND s.is_active AND s.deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.auto_accounts a WHERE a.id=(p_query->>'accountId')::bigint AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND NOT a.is_delete) THEN RAISE EXCEPTION 'account_access_denied' USING ERRCODE='42501'; END IF;
 IF p_source='group_members' AND nullif(btrim(p_query->>'zaloGroupId'),'') IS NULL THEN RAISE EXCEPTION 'group_required'; END IF;
 IF p_query ? 'datasetId' AND NOT EXISTS(SELECT 1 FROM public.auto_account_contacts_dataset d WHERE d.id=(p_query->>'datasetId')::bigint AND d.staff_id=p_staff_id AND d.organization_id=p_organization_id AND d.account_id=(p_query->>'accountId')::bigint AND NOT d.is_delete AND (p_query->>'contactType' IS NULL OR d.contact_type=p_query->>'contactType')) THEN RAISE EXCEPTION 'dataset_access_denied' USING ERRCODE='42501'; END IF;
 IF p_query ? 'contactGroupId' AND NOT EXISTS(SELECT 1 FROM public.auto_account_contact_groups g WHERE g.id=(p_query->>'contactGroupId')::bigint AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND g.account_id IS NULL AND g.contact_type IS NULL AND g.purpose='data_group' AND NOT g.is_delete) THEN RAISE EXCEPTION 'group_access_denied' USING ERRCODE='42501'; END IF;
 page_limit:=COALESCE((p_query->>'limit')::integer,100);page_offset:=COALESCE((p_query->>'offset')::integer,0);
 IF page_limit NOT BETWEEN 1 AND 500 OR page_offset NOT BETWEEN 0 AND 100000 OR COALESCE(p_query->>'statusFilter','all') NOT IN ('all','active','inactive') THEN RAISE EXCEPTION 'invalid_filter_query'; END IF;
 FOREACH key IN ARRAY ARRAY['ids','excludeIds','zaloTagIds','akaBizTagIds'] LOOP
  IF p_query ? key AND (jsonb_typeof(p_query->key) IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->key)>CASE WHEN key IN ('ids','excludeIds') THEN 100000 ELSE 1000 END) THEN RAISE EXCEPTION 'invalid_filter_query_array'; END IF;
  IF p_query->key='[]'::jsonb THEN p_query:=p_query-key; END IF;
 END LOOP;
 predicate:=private.column_filter_predicate_v1(p_source,p_query->'columnFilters');
__CURSOR_VALIDATION__ count_sql:=CASE WHEN p_query->>'countMode'='none' THEN 'NULL::bigint' ELSE '(SELECT count(*) FROM matched)' END;
 sql:=$query$
 WITH candidate AS NOT MATERIALIZED (__BASE__), matched AS __MATERIALIZED__ (SELECT id,sort_rank,sort_name,sort_time FROM candidate WHERE __PREDICATE__),
 page AS MATERIALIZED (SELECT * FROM matched WHERE __CURSOR__ ORDER BY sort_rank,sort_name,sort_time DESC,id OFFSET __OFFSET__ LIMIT __LIMIT__)
 SELECT jsonb_build_object('version',1,'total',__COUNT__,'rows',COALESCE((SELECT jsonb_agg(c.row_data ORDER BY p.sort_rank,p.sort_name,p.sort_time DESC,p.id) FROM page p JOIN candidate c ON c.id=p.id),'[]'::jsonb),
 'after',(SELECT jsonb_build_object('rank',sort_rank,'name',sort_name,'time',sort_time,'id',id::text) FROM page ORDER BY sort_rank DESC,sort_name DESC,sort_time,id DESC LIMIT 1),'hasMore',(SELECT count(*) FROM page)=__LIMIT__)
 $query$;
 sql:=format(sql,predicate,cursor_clause,count_sql,CASE WHEN p_query->>'countMode'='none' THEN 'NOT MATERIALIZED' ELSE 'MATERIALIZED' END);
 EXECUTE sql INTO result USING p_staff_id,p_organization_id,p_query,p_source,page_offset,page_limit;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb) TO anon,authenticated,service_role;
"""
(root/'scripts/column-filters/sql/contacts.sql').write_text(render_reader(head.replace('__BASE__',base),'contacts'))
