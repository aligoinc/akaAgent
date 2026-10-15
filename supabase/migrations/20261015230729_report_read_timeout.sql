-- Dedicated bounded report reader. No role/global timeout, pool, table or index changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $preflight$
BEGIN
  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc
      WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))
      IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN
    RAISE EXCEPTION 'report_identity_definition_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='aka_agent_read_report_page') THEN
    RAISE EXCEPTION 'report_reader_already_exists_do_not_overwrite';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.aka_agent_read_report_page(
  p_staff_id bigint, p_organization_id bigint,
  p_auth_username text, p_auth_password text, p_query jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '60s'
AS $function$
DECLARE
  v_source text := p_query->>'source';
  v_view text := p_query->>'view';
  v_accounts bigint[];
  v_campaigns bigint[];
  v_actions text[];
  v_from timestamptz := (p_query->>'startIso')::timestamptz;
  v_to timestamptz := (p_query->>'endIso')::timestamptz;
  v_limit integer := coalesce((p_query->>'limit')::integer,1000);
  v_offset integer := coalesce((p_query->>'offset')::integer,0);
  v_count boolean := coalesce((p_query->>'count')::boolean,false);
  v_head boolean := coalesce((p_query->>'head')::boolean,false);
  v_filter jsonb := p_query->'filter';
  v_where text;
  v_table text;
  v_select text;
  v_order text;
  v_rows jsonb := '[]';
  v_total bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id AND is_active=true
  ) THEN RAISE EXCEPTION 'report_access_denied' USING ERRCODE='42501'; END IF;
  IF v_source IS NULL OR v_source NOT IN ('results','pending') OR v_view IS NULL OR v_view NOT IN ('summary','details')
    OR v_from IS NULL OR v_to IS NULL OR v_from>=v_to OR v_limit<0 OR v_limit>1000 OR v_offset<0
    OR jsonb_typeof(p_query->'accountIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_query->'accountIds')>10000
    OR (p_query ? 'campaignIds' AND (jsonb_typeof(p_query->'campaignIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'campaignIds')>200)) THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(value::bigint),'{}') INTO v_accounts FROM jsonb_array_elements_text(p_query->'accountIds');
  SELECT array_agg(value::bigint) INTO v_campaigns FROM jsonb_array_elements_text(p_query->'campaignIds');
  SELECT coalesce(array_agg(value),'{}') INTO v_actions FROM jsonb_array_elements_text(p_query->'actionCodes');
  IF EXISTS (SELECT 1 FROM unnest(v_accounts) requested(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.auto_accounts a WHERE a.id=requested.id AND a.staff_id=p_staff_id
      AND a.organization_id=p_organization_id AND a.is_delete=false
  )) THEN RAISE EXCEPTION 'report_account_access_denied' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_campaigns) requested(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns c WHERE c.id=requested.id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id
  )) THEN RAISE EXCEPTION 'report_campaign_access_denied' USING ERRCODE='42501'; END IF;
  IF cardinality(v_accounts)=0 OR (p_query ? 'campaignIds' AND v_campaigns IS NULL) THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'count',CASE WHEN v_count OR v_head THEN 0 ELSE NULL END);
  END IF;

  -- All dynamic fragments below are fixed SQL; every caller value stays a bound parameter.
  IF v_source='results' THEN
    v_table := 'public.auto_campaign_details d';
    v_where := 'd.is_delete=false AND d.account_id=ANY($3) AND d.action_code=ANY($5) AND d.created_at >= $6 AND d.created_at < $7';
    IF v_campaigns IS NOT NULL THEN v_where:=v_where||' AND d.campaign_id=ANY($4)'; END IF;
    IF coalesce((p_query->>'requireCampaign')::boolean,false) THEN
      v_where:=v_where||' AND EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.id=d.campaign_id AND c.staff_id=$1 AND c.organization_id=$2)';
    END IF;
    IF v_filter->>'kind'='group' THEN
      IF v_filter->>'group' IS NULL OR v_filter->>'group' NOT IN ('all','success','failure','skipped','pending') THEN
        RAISE EXCEPTION 'invalid_report_group' USING ERRCODE='22023';
      END IF;
      v_where:=v_where||' AND ((($8#>>''{filter,group}'')=''all'' AND d.report_group IN (''success'',''failure'',''skipped'',''pending''))
        OR d.report_group=($8#>>''{filter,group}'') OR (d.report_group IS NULL AND d.status IN
          (SELECT jsonb_array_elements_text($8#>''{filter,legacyStatuses}''))))';
    ELSIF v_filter->>'kind' IN ('status','legacy') THEN
      v_where:=v_where||' AND d.report_group IS DISTINCT FROM ''pending''';
      IF v_filter->>'kind'='status' THEN
        IF (v_filter->>'statusId')::bigint IS NULL OR (v_filter->>'statusId')::bigint<=0 THEN
          RAISE EXCEPTION 'invalid_report_status' USING ERRCODE='22023';
        END IF;
        v_where:=v_where||' AND (d.status_id=($8#>>''{filter,statusId}'')::bigint OR (d.status_id IS NULL
          AND d.status=($8#>>''{filter,legacyStatus}'')))';
      ELSE
        IF jsonb_typeof(v_filter->'status') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'invalid_report_legacy_status' USING ERRCODE='22023';
        END IF;
        v_where:=v_where||' AND d.status_id IS NULL AND d.status=($8#>>''{filter,status}'')';
      END IF;
    ELSIF v_filter IS NOT NULL AND v_filter<>'null'::jsonb THEN
      RAISE EXCEPTION 'invalid_report_filter' USING ERRCODE='22023';
    END IF;
    v_order:=CASE WHEN v_view='summary' THEN 'd.created_at ASC,d.id ASC' ELSE 'd.created_at DESC,d.id DESC' END;
    IF p_query ? 'afterCreatedAt' THEN
      IF p_query->>'afterId' IS NULL THEN RAISE EXCEPTION 'invalid_report_cursor'; END IF;
      v_where:=v_where||' AND (d.created_at,d.id)'||CASE WHEN v_view='summary' THEN '>' ELSE '<' END
        ||'(($8->>''afterCreatedAt'')::timestamptz,($8->>''afterId'')::bigint)';
    END IF;
    IF v_view='summary' THEN
      v_select:='d.id,d.input_data_id,d.account_id,d.action_code,d.status,d.status_id,d.report_group,d.created_at';
    ELSE
      v_select:='d.id,d.input_data_id,d.campaign_id,d.account_id,d.action_code,d.action_name,d.status,d.error_code,d.log,d.data,d.post_url,d.created_at,
        (SELECT jsonb_build_object(''name'',s.name) FROM public.auto_status s WHERE s.id=d.status_id) AS main_status,
        (SELECT jsonb_build_object(''name'',s.name) FROM public.auto_status s WHERE s.id=d.sub_status_id) AS sub_status,
        (SELECT jsonb_build_object(''id'',c.id,''name'',c.name,''staff_id'',c.staff_id,''organization_id'',c.organization_id)
          FROM public.auto_campaigns c WHERE c.id=d.campaign_id AND c.staff_id=$1 AND c.organization_id=$2) AS auto_campaigns,
        (SELECT jsonb_build_object(''name'',i.name,''uid'',i.uid,''phone'',i.phone,''email'',i.email)
          FROM public.auto_campaign_input_data i JOIN public.auto_campaigns c ON c.id=i.campaign_id
          WHERE i.id=d.input_data_id AND c.staff_id=$1 AND c.organization_id=$2) AS report_input';
    END IF;
  ELSE
    IF v_campaigns IS NULL THEN RAISE EXCEPTION 'report_campaign_scope_required' USING ERRCODE='22023'; END IF;
    v_table:='public.auto_campaign_input_data d JOIN public.auto_campaigns c ON c.id=d.campaign_id';
    v_where:='d.campaign_id=ANY($4) AND d.is_delete=false AND d.status=''chờ xử lý'' AND c.is_delete=false
      AND c.staff_id=$1 AND c.organization_id=$2 AND c.account_id=ANY($3)';
    IF v_view='summary' THEN
      IF p_query->>'ownSchedule' IS NULL THEN RAISE EXCEPTION 'report_schedule_branch_required'; END IF;
      v_where:=v_where||CASE WHEN (p_query->>'ownSchedule')::boolean
        THEN ' AND d.schedule >= $6 AND d.schedule < $7'
        ELSE ' AND d.schedule IS NULL AND c.schedule >= $6 AND c.schedule < $7' END;
      v_select:='d.id,d.campaign_id,d.schedule';
    ELSE
      v_where:=v_where||' AND ((d.schedule >= $6 AND d.schedule < $7) OR (d.schedule IS NULL AND c.schedule >= $6 AND c.schedule < $7))';
      IF cardinality(v_accounts)<>1 OR cardinality(v_actions)<>1 THEN RAISE EXCEPTION 'report_pending_cell_required'; END IF;
      v_where:=v_where||' AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_details r WHERE r.input_data_id=d.id
        AND r.account_id=ANY($3) AND r.action_code=ANY($5) AND r.is_delete=false AND r.report_group=''pending''
        AND r.created_at >= $6 AND r.created_at < $7)';
      v_select:='d.id,d.campaign_id,d.name,d.phone,d.uid,d.email,d.note,d.schedule,d.created_at';
    END IF;
    v_order:='d.campaign_id ASC,d.id ASC';
    IF p_query ? 'afterId' THEN
      IF p_query->>'afterCampaignId' IS NULL THEN RAISE EXCEPTION 'invalid_report_pending_cursor'; END IF;
      v_where:=v_where||' AND (d.campaign_id,d.id)>(($8->>''afterCampaignId'')::bigint,($8->>''afterId'')::bigint)';
    END IF;
  END IF;
  IF v_count OR v_head THEN
    EXECUTE 'SELECT count(*) FROM '||v_table||' WHERE '||v_where INTO v_total
      USING p_staff_id,p_organization_id,v_accounts,v_campaigns,v_actions,v_from,v_to,p_query;
  END IF;
  IF NOT v_head AND v_limit>0 THEN
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM (SELECT '||v_select||' FROM '||v_table
      ||' WHERE '||v_where||' ORDER BY '||v_order||' LIMIT $9 OFFSET $10) r' INTO v_rows
      USING p_staff_id,p_organization_id,v_accounts,v_campaigns,v_actions,v_from,v_to,p_query,v_limit,v_offset;
  END IF;
  RETURN jsonb_build_object('rows',v_rows,'count',v_total);
END;
$function$;
ALTER FUNCTION public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb) IS
  'Read-only bounded report pages, credential/service-role identity and tenant/account scope; 60s per call, max 1000 rows. No global timeout changes.';
NOTIFY pgrst, 'reload schema';
COMMIT;
