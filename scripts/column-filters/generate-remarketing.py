from pathlib import Path
from sql_codegen import render_reader
root=Path(__file__).resolve().parents[2]
first=lambda xs:'COALESCE('+','.join("NULLIF(btrim("+x+"),'')" for x in xs)+')' 
t=lambda path:"d.data#>>'{"+path+"}'"
uid=first(['i.uid',t('target,uid'),t('targetUid'),t('uid'),t('target,raw,inputData,uid'),t('target,raw,profile,uid')])
name=first(['i.name',t('target,displayName'),t('target,originalName'),t('target,raw,profile,displayName'),t('target,raw,profile,zaloName'),t('target,raw,profile,zalo_name'),t('target,raw,inputData,name')])
original=first([t('target,originalName'),t('target,raw,profile,zaloName'),t('target,raw,profile,zalo_name'),t('target,raw,inputData,originalName')])
userphone='private.column_filter_phone_v1('+first(['u.phone_number',"u.raw_payload->>'phoneNumber'","u.raw_payload->>'phone_number'","u.raw_payload->>'phone'"])+')'
contactphone='private.column_filter_phone_v1('+first([f"c.extra_data->>'{key}'" for key in ['phone','phoneNumber','phone_number','mobilePhone','mobile_phone']])+')'
friend="CASE WHEN u.is_fr=1 OR c.is_friend IS TRUE THEN true WHEN (u.zalo_uid IS NOT NULL AND COALESCE(u.is_fr,0)=0) OR c.is_friend IS FALSE THEN false END"
fields={'name':first(['c.name','u.display_name','u.zalo_name','r.fallback_name','r.uid']),'uid':'r.uid','phone':f"COALESCE({userphone},{contactphone},r.fallback_phone)",'groupName':'g.name','latestAction':'campaign.action_id','sentCount':'r.sent_count','latestSentAt':'d.created_at','daysSinceLatest':"(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-(d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date",'latestStatus':'d.status','latestLog':'d.log','recipientStatus':f"CASE WHEN ({friend}) THEN 'Bạn bè' WHEN NOT ({friend}) THEN 'Chưa kết bạn' END",'zaloTags':'private.column_filter_zalo_tags_v1(c.extra_data)','akaBizTags':'c.akabiz_tag_ids::text[]'}
projection=',\n'.join(f'{expr} AS "f_{field}"' for field,expr in fields.items())
cte=f"""history AS MATERIALIZED (
 SELECT d.id,d.created_at,{uid} uid,{name} fallback_name,private.column_filter_phone_v1(i.phone) fallback_phone,{original} original_name
 FROM public.auto_campaign_details d JOIN public.auto_campaigns campaign ON campaign.id=d.campaign_id
 LEFT JOIN public.auto_campaign_input_data i ON i.id=d.input_data_id
 WHERE d.account_id=($3->>'accountId')::bigint AND NOT d.is_delete
 AND campaign.account_id=d.account_id AND campaign.staff_id=$1 AND campaign.organization_id=$2 AND NOT campaign.is_delete
 AND campaign.action_id=ANY($4) AND d.action_code IN ('zalo_message_stranger','zalo_message_friend')
 AND (nullif($3->>'dateFrom','') IS NULL OR d.created_at >= (nullif($3->>'dateFrom','')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
 AND (nullif($3->>'dateTo','') IS NULL OR d.created_at < (((nullif($3->>'dateTo','')::date+1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh'))
), rollup AS MATERIALIZED (
 SELECT lower(uid) uid_key,count(*) sent_count,(array_agg(id ORDER BY created_at DESC,id DESC))[1] latest_id,
 (array_agg(uid ORDER BY created_at DESC,id DESC))[1] uid,
 (array_agg(fallback_name ORDER BY created_at DESC,id DESC) FILTER (WHERE fallback_name IS NOT NULL AND fallback_name<>uid))[1] fallback_name,
 (array_agg(fallback_phone ORDER BY created_at DESC,id DESC) FILTER (WHERE fallback_phone IS NOT NULL))[1] fallback_phone,
 (array_agg(original_name ORDER BY created_at DESC,id DESC) FILTER (WHERE original_name IS NOT NULL))[1] original_name
 FROM history WHERE uid IS NOT NULL GROUP BY lower(uid)
), candidate AS NOT MATERIALIZED (
 SELECT d.id,d.created_at,($3->>'accountId')::bigint account_id,{friend} is_friend,c.akabiz_tag_ids,
 COALESCE(c.extra_data,'{{}}'::jsonb)||jsonb_build_object('source','zalo_remarketing_customers','latestCampaignId',campaign.id,'latestCampaignName',campaign.name,'latestCampaignActionId',campaign.action_id,'latestCampaignActionName',COALESCE(NULLIF(action.name,''),campaign.action_id),'latestErrorCode',d.error_code,'originalName',{first(['u.zalo_name','u.display_name','r.original_name'])},'gender',u.gender) extra_data,
 {projection}
 FROM rollup r JOIN public.auto_campaign_details d ON d.id=r.latest_id JOIN public.auto_campaigns campaign ON campaign.id=d.campaign_id
 LEFT JOIN public.auto_campaign_actions action ON action.id=campaign.action_id
 LEFT JOIN public.auto_account_contacts c ON c.account_id=campaign.account_id AND c.staff_id=$1 AND c.organization_id=$2 AND c.uid=r.uid AND c.contact_type='person' AND NOT c.is_delete
 LEFT JOIN public.zalo_users u ON u.account_id=campaign.account_id AND u.staff_id=$1 AND u.organization_id=$2 AND u.zalo_uid=r.uid
 LEFT JOIN LATERAL (SELECT m.zalo_group_id FROM public.zalo_group_members m WHERE m.account_id=campaign.account_id AND m.staff_id=$1 AND m.organization_id=$2 AND m.zalo_uid=r.uid ORDER BY m.is_current DESC,m.last_seen_at DESC,m.updated_at DESC,m.id DESC LIMIT 1) member ON nullif(btrim(COALESCE(c.extra_data->>'zaloGroupId',c.extra_data->>'zalo_group_id')),'') IS NULL
 LEFT JOIN public.zalo_groups g ON g.account_id=campaign.account_id AND g.staff_id=$1 AND g.organization_id=$2 AND g.zalo_group_id={first(["c.extra_data->>'zaloGroupId'","c.extra_data->>'zalo_group_id'",'member.zalo_group_id'])}
)"""
head="""CREATE FUNCTION public.aka_agent_read_filtered_remarketing_v1(p_staff_id bigint,p_organization_id bigint,p_auth_username text,p_auth_password text,p_query jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='60s' AS $fn$
DECLARE predicate text; sql text; result jsonb; page_limit integer; page_offset integer; key text; cursor_clause text:='true'; count_sql text; actions text[];
 allowed_actions constant text[]:=ARRAY['zalo_message_phone','zalo_message_friend','zalo_message_group_member','zalo_message_group_realtime','zalo_message_friend_recommendation'];
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR octet_length(p_query::text)>2097152 THEN RAISE EXCEPTION 'invalid_filter_query'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=p_staff_id AND s.organization_id=p_organization_id AND s.is_active AND s.deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.auto_accounts a WHERE a.id=(p_query->>'accountId')::bigint AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.flatform_type='zalo' AND NOT a.is_delete) THEN RAISE EXCEPTION 'account_access_denied' USING ERRCODE='42501'; END IF;
 page_limit:=COALESCE((p_query->>'limit')::integer,100);page_offset:=COALESCE((p_query->>'offset')::integer,0);
 IF page_limit NOT BETWEEN 1 AND 500 OR page_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid_filter_query'; END IF;
 FOREACH key IN ARRAY ARRAY['ids','excludeIds','zaloTagIds','akaBizTagIds','campaignActionIds'] LOOP
  IF p_query ? key AND (jsonb_typeof(p_query->key) IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->key)>CASE WHEN key IN ('ids','excludeIds') THEN 100000 ELSE 1000 END) THEN RAISE EXCEPTION 'invalid_filter_query_array'; END IF;
  IF key<>'campaignActionIds' AND p_query->key='[]'::jsonb THEN p_query:=p_query-key; END IF;
 END LOOP;
 actions:=CASE WHEN p_query ? 'campaignActionIds' THEN ARRAY(SELECT jsonb_array_elements_text(p_query->'campaignActionIds')) WHEN nullif(p_query->>'campaignActionId','all') IS NOT NULL THEN ARRAY[p_query->>'campaignActionId'] ELSE allowed_actions END;
 actions:=ARRAY(SELECT v FROM unnest(actions) v WHERE v=ANY(allowed_actions));
 predicate:=private.column_filter_predicate_v1('remarketing',p_query->'columnFilters');
__CURSOR_VALIDATION__ count_sql:=CASE WHEN p_query->>'countMode'='none' THEN 'NULL::bigint' ELSE '(SELECT count(*) FROM matched)' END;
 sql:=$query$
 WITH __CTE__, filtered AS NOT MATERIALIZED (SELECT * FROM candidate WHERE __PREDICATE__
 AND (NOT ($3 ? 'ids') OR id IN (SELECT jsonb_array_elements_text($3->'ids')::bigint))
 AND (NOT ($3 ? 'excludeIds') OR id NOT IN (SELECT jsonb_array_elements_text($3->'excludeIds')::bigint))
 AND (NULLIF(btrim($3->>'search'),'') IS NULL OR strpos(lower(normalize(concat_ws(' ',f_name,f_uid,f_phone,extra_data->>'phoneNumber',extra_data->>'phone_number',extra_data->>'mobilePhone',extra_data->>'mobile_phone'),NFC)),lower(normalize(btrim($3->>'search'),NFC)))>0)
 AND ((COALESCE(jsonb_array_length($3->'zaloTagIds'),0)=0 AND NOT COALESCE(($3->>'zaloNoTag')::boolean,false)) OR "f_zaloTags" && ARRAY(SELECT jsonb_array_elements_text($3->'zaloTagIds')) OR (COALESCE(($3->>'zaloNoTag')::boolean,false) AND cardinality("f_zaloTags")=0))
 AND ((COALESCE(jsonb_array_length($3->'akaBizTagIds'),0)=0 AND NOT COALESCE(($3->>'akaBizNoTag')::boolean,false)) OR COALESCE(akabiz_tag_ids,'{}'::bigint[]) && ARRAY(SELECT jsonb_array_elements_text($3->'akaBizTagIds')::bigint) OR (COALESCE(($3->>'akaBizNoTag')::boolean,false) AND COALESCE(cardinality(akabiz_tag_ids),0)=0))
 ), matched AS __MATERIALIZED__ (SELECT id,created_at FROM filtered),
 page AS MATERIALIZED (SELECT * FROM matched WHERE __CURSOR__ ORDER BY created_at DESC,id DESC OFFSET __OFFSET__ LIMIT __LIMIT__)
 SELECT jsonb_build_object('version',1,'total',__COUNT__,'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'account_id',c.account_id,'contact_type','person','name',c.f_name,'uid',c.f_uid,'url','','is_delete',false,'is_friend',c.is_friend,'akabiz_tag_ids',c.akabiz_tag_ids,
 'extra_data',c.extra_data||jsonb_build_object('phone',c.f_phone,'groupName',c."f_groupName",'sentCount',c."f_sentCount",'latestSentAt',c."f_latestSentAt",'latestSentDate',to_char(c."f_latestSentAt" AT TIME ZONE 'Asia/Ho_Chi_Minh','DD/MM/YYYY'),'daysSinceLatest',c."f_daysSinceLatest",'latestStatus',c."f_latestStatus",'latestLog',c."f_latestLog",'recipientStatus',c."f_recipientStatus")) ORDER BY p.created_at DESC,p.id DESC) FROM page p JOIN filtered c ON c.id=p.id),'[]'::jsonb),
 'after',(SELECT jsonb_build_object('createdAt',created_at,'id',id::text) FROM page ORDER BY created_at,id LIMIT 1),'hasMore',(SELECT count(*) FROM page)=__LIMIT__)
 $query$;
 sql:=format(sql,predicate,cursor_clause,count_sql,CASE WHEN p_query->>'countMode'='none' THEN 'NOT MATERIALIZED' ELSE 'MATERIALIZED' END);
 EXECUTE sql INTO result USING p_staff_id,p_organization_id,p_query,actions,page_offset,page_limit;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb) TO anon,authenticated,service_role;
"""
(root/'scripts/column-filters/sql/remarketing.sql').write_text(render_reader(head.replace('__CTE__',cte),'remarketing'))
