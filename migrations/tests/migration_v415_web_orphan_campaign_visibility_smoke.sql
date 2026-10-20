-- Read-only production assertions. Run inside BEGIN ... ROLLBACK.
-- Uses existing tenant-scoped orphan campaigns without returning customer data.
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE c record; p jsonb; n integer := 0;
BEGIN
  ASSERT md5(pg_get_functiondef(
    'public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'::regprocedure
  ))='e081e2adaa53652506e9628e851aa604', 'V415 target checksum';
  ASSERT md5(pg_get_functiondef(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[])'::regprocedure
  ))='fdff962116bb5f2c98830dbfaec6a7f4', 'progress RPC unchanged';
  ASSERT md5(pg_get_functiondef(
    'public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)'::regprocedure
  ))='1275ad05d4dd184f5f6d9cd937caa21c', 'history target checksum';
  ASSERT md5(pg_get_functiondef(
    'private.campaign_log_page(bigint,jsonb)'::regprocedure
  ))='9df075f367231f8ad06970bfb6a62a5a', 'preserve live custom-plan history reader';
  FOR c IN
    SELECT campaign.id, campaign.account_id, campaign.staff_id, campaign.organization_id,
      account.flatform_type, account.name AS account_name
    FROM public.auto_campaigns campaign
    JOIN public.auto_accounts account ON account.id=campaign.account_id
      AND account.staff_id=campaign.staff_id AND account.organization_id=campaign.organization_id
    WHERE campaign.is_delete=false AND account.is_delete=true
      AND (account.flatform_type='sms' OR (account.flatform_type='zalo'
        AND account.is_zalo_server=true AND account.is_zalo_show_web=false))
    ORDER BY campaign.id DESC LIMIT 6
  LOOP
    n := n+1;
    p := public.aka_agent_control_campaign_page(c.staff_id,c.organization_id,
      ARRAY[c.flatform_type],'{}',p_selected_id=>c.id,p_ids=>ARRAY[c.id]);
    ASSERT p->>'campaignTotal'='1' AND p->'items'->0->>'id'=c.id::text, 'orphan visible';
    ASSERT p->'items'->0->>'accountId'=c.account_id::text, 'original account link';
    ASSERT p->'items'->0->>'accountName' IS NOT DISTINCT FROM c.account_name, 'original account name';
    ASSERT p->'selected'->>'id'=c.id::text, 'selected orphan';
    ASSERT NOT (p->'items'->0 ? 'content') AND NOT (p->'items'->0 ? 'log'), 'narrow payload';
    p := public.aka_agent_control_campaign_page(c.staff_id,c.organization_id,
      ARRAY[c.flatform_type],jsonb_build_object('accountIds',jsonb_build_array(c.account_id)),
      p_selection=>true,p_ids=>ARRAY[c.id]);
    ASSERT jsonb_array_length(p->'items')=1 AND p->'items'->0->>'id'=c.id::text, 'filtered selection';
    p := public.aka_agent_control_campaign_page(c.staff_id,c.organization_id,
      ARRAY[]::text[],'{}',p_selected_id=>c.id,p_ids=>ARRAY[c.id]);
    ASSERT p->>'campaignTotal'='0' AND p->'selected'='null'::jsonb, 'capability scope';
    p := public.aka_agent_control_campaign_page(-1,c.organization_id,
      ARRAY[c.flatform_type],'{}',p_selected_id=>c.id,p_ids=>ARRAY[c.id]);
    ASSERT p->>'campaignTotal'='0' AND p->'selected'='null'::jsonb, 'staff scope';
    p := public.aka_agent_control_campaign_page(c.staff_id,-1,
      ARRAY[c.flatform_type],'{}',p_selected_id=>c.id,p_ids=>ARRAY[c.id]);
    ASSERT p->>'campaignTotal'='0' AND p->'selected'='null'::jsonb, 'organization scope';
    p := public.aka_agent_control_campaign_logs(c.staff_id,c.organization_id,c.id,ARRAY[c.flatform_type],'{"limit":2}');
    ASSERT p IS NOT NULL AND p->>'campaignId'=c.id::text, 'orphan history accessible';
    ASSERT jsonb_array_length(p->'items')<=2, 'history remains bounded';
    ASSERT public.aka_agent_control_campaign_logs(-1,c.organization_id,c.id,ARRAY[c.flatform_type]) IS NULL, 'history staff scope';
    ASSERT public.aka_agent_control_campaign_logs(c.staff_id,-1,c.id,ARRAY[c.flatform_type]) IS NULL, 'history organization scope';
    ASSERT public.aka_agent_control_campaign_logs(c.staff_id,c.organization_id,c.id,ARRAY[]::text[]) IS NULL, 'history capability scope';
  END LOOP;
  ASSERT n>0, 'production smoke requires an existing eligible orphan';
  ASSERT NOT has_function_privilege('anon',
    'public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated',
    'public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])','EXECUTE');
  ASSERT NOT has_function_privilege('anon',
    'public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated',
    'public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)','EXECUTE');
END;
$smoke$;
RESET ROLE;
