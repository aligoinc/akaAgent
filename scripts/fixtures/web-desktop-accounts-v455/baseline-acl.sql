-- ACL giống production cho 12 hàm baseline và kiểm baseline đúng bản live trước v455.
DO $acl$
DECLARE
  spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', '761108afe53ff4046efe0cd247846d10'),
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', '12d454fbc38217dea3497addd39ed832'),
    ('public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)', '1275ad05d4dd184f5f6d9cd937caa21c'),
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)', 'c1673974d0982ce6a731741072ca5338'),
    ('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)', '1b04e01063f2d59e23e063794a4574d2'),
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', 'f285e48f4deaf2e1bf7896d7aeddbcf8'),
    ('public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '3e1e2f8b67697d36b3c8c3830586a6c2'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '1955af1c590ec870cb098cde9dd0714b'),
    ('public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)', '0f22d3c6fe532176af0e3f38fd485f88'),
    ('public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)', 'a98a23f8e7f2e1e6582449f7ed45fb45'),
    ('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)', 'b504f4928a9dd271dec783796a7a0374'),
    ('public.aka_agent_authenticate_control_session(text)', 'c748df75349ebeef58c3c8f120439b0b')
  ) AS x(signature, source_md5) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', spec.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', spec.signature);
    IF md5(pg_get_functiondef(spec.signature::regprocedure)) IS DISTINCT FROM spec.source_md5 THEN
      RAISE EXCEPTION 'baseline_mismatch:%', spec.signature;
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.aka_agent_device_presence(text,text,uuid,jsonb,boolean) TO aka_agent_desktop;
END
$acl$;
