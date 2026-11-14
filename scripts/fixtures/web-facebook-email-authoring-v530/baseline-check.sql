-- Nền test phải đúng 11 định nghĩa live trước v530 + 4 hàm phụ thuộc (md5 production 14/11/2026) và đúng ACL.
DO $check$
DECLARE spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('private.aka_agent_web_facebook_campaigns_policy(bigint)', '592f487518ef14f3bef6f0c7177f2ab5', '{postgres=X/postgres}'),
    ('public.aka_agent_authenticate_control_session(text)', '692e2a068ce51377f6bd71fec20a8b0c', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_authenticate_control_session_chat_v2(text)', '61e874b9b47b827d78e16c71bc9ef687', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', '367cf7ba9d72aff72c4907586cf1c3ba', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', 'db8942b09904e535987b94745b159ca3', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)', '6030f0d9c8429e36955a405920f751f9', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', '87f7002ac924f647896a7635663562b5', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '2af929cc5e02683e5e9dc16a48cc9bac', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)', '61a6b5c855fbcf86cafaf3c3c7ce6f0a', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', 'a86278195e18d1ef8d0091b41d1d0c5b', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)', 'd283261c5e77558d10f5df86cd4d1127', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)', '661579fa2e8b6571f429079dd0b89c0a', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '3e1e2f8b67697d36b3c8c3830586a6c2', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)', '26875e2b1652ca56cc8e59460df8cae1', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_web_facebook_campaigns_policy(bigint)', '7f487421358f987502dc2bc6405dae0b', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_campaign_config_version(auto_campaigns)', '5992a9958a3df3ccba087f9c9388ebb4', '{postgres=X/postgres,service_role=X/postgres}')
  ) AS x(signature, source_md5, acl) LOOP
    IF md5(pg_get_functiondef(spec.signature::regprocedure)) IS DISTINCT FROM spec.source_md5 THEN
      RAISE EXCEPTION 'baseline_mismatch:%:%', spec.signature, md5(pg_get_functiondef(spec.signature::regprocedure));
    END IF;
    IF (SELECT proacl::text FROM pg_proc WHERE oid = spec.signature::regprocedure) IS DISTINCT FROM spec.acl THEN
      RAISE EXCEPTION 'baseline_acl_mismatch:%:%', spec.signature, (SELECT proacl::text FROM pg_proc WHERE oid = spec.signature::regprocedure);
    END IF;
  END LOOP;
END
$check$;
