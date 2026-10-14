-- Run inside the migration rollback transaction, or BEGIN/ROLLBACK after apply.
DO $fixture$
DECLARE v record;
BEGIN
  SELECT c.id,c.staff_id,s.organization_id,s.username,s.password,c.account_id INTO STRICT v
  FROM public.auto_campaigns c JOIN public.org_staff s ON s.id=c.staff_id
  JOIN public.org_organization o ON o.id=s.organization_id JOIN public.auto_accounts a ON a.id=c.account_id
  WHERE s.is_active AND NOT c.is_delete AND a.staff_id=c.staff_id
    AND a.flatform_type IN ('facebook','zalo','email') AND s.username IS NOT NULL AND s.password IS NOT NULL
    AND (a.organization_id=s.organization_id OR a.organization_id IS NULL)
    AND (c.organization_id=s.organization_id OR c.organization_id IS NULL)
  ORDER BY c.id DESC LIMIT 1;
  PERFORM set_config('diagnostics.smoke.staff',v.staff_id::text,true),set_config('diagnostics.smoke.org',v.organization_id::text,true),
    set_config('diagnostics.smoke.campaign',v.id::text,true),set_config('diagnostics.smoke.username',v.username,true),set_config('diagnostics.smoke.password',v.password,true);
  IF has_table_privilege('anon','public.auto_account_logs','SELECT') OR has_table_privilege('authenticated','public.auto_account_logs','SELECT') THEN
    RAISE EXCEPTION 'unexpected_direct_log_access';
  END IF;
  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)')) <> '5a9a503db72b965eb644739f5f60905d' THEN RAISE EXCEPTION 'helper_modified'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_using u JOIN public.ai_model m ON m.id=u.model_id JOIN public.ai_prompt p ON p.id=u.prompt_id
    WHERE u.code='app_campaign_diagnostics' AND m.model='gpt-6.1-sol' AND p.code=u.code AND u.timeout_ms=120000 AND u.is_active) THEN RAISE EXCEPTION 'wrong_ai_config'; END IF;
END;
$fixture$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
DO $smoke$
DECLARE
  v_staff bigint:=current_setting('diagnostics.smoke.staff')::bigint;
  v_org bigint:=current_setting('diagnostics.smoke.org')::bigint;
  v_campaign bigint:=current_setting('diagnostics.smoke.campaign')::bigint;
  v_user text:=current_setting('diagnostics.smoke.username');
  v_pass text:=current_setting('diagnostics.smoke.password');
  v_result jsonb;
  k text;
BEGIN
  v_result:=public.aka_agent_campaign_diagnostics_evidence(v_staff,v_org,v_campaign,v_user,v_pass);
  FOREACH k IN ARRAY ARRAY['accountHistory','campaignHistory','results','inputs'] LOOP
    IF jsonb_typeof(v_result->k)<>'array' OR jsonb_array_length(v_result->k)>30 THEN RAISE EXCEPTION 'unbounded_evidence'; END IF;
  END LOOP;
  BEGIN
    PERFORM public.aka_agent_campaign_diagnostics_evidence(v_staff,v_org,v_campaign,v_user,'wrong-password');
    RAISE EXCEPTION 'bad_password_accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='bad_password_accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_campaign_diagnostics_evidence(v_staff,v_org+1,v_campaign,v_user,v_pass);
    RAISE EXCEPTION 'wrong_tenant_accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='wrong_tenant_accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_campaign_diagnostics_evidence(v_staff,v_org,-1,v_user,v_pass);
    RAISE EXCEPTION 'wrong_campaign_accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$smoke$;
RESET ROLE;
