-- Nền test phải đúng 6 định nghĩa live trước V476 (md5 production 07/11/2026) và đúng ACL production.
DO $check$
DECLARE spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', 'a2bc3f7cae264e647ac576c9895e840f'),
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', '6b148777006903e4830925c55616820b'),
    ('public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)', '214999ca7a2830b2a0b85389a0325fbf'),
    ('public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'ea05f7ca98ceb9c8794c447abe79dc7c'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '4cfcad941c3acf22e674a77b203d086d'),
    ('public.aka_agent_authenticate_control_session(text)', '2c10aa78ac5e4ab8069c741b356e88c8')
  ) AS x(signature, source_md5) LOOP
    IF md5(pg_get_functiondef(spec.signature::regprocedure)) IS DISTINCT FROM spec.source_md5 THEN
      RAISE EXCEPTION 'baseline_mismatch:%', spec.signature;
    END IF;
    IF (SELECT proacl::text FROM pg_proc WHERE oid = spec.signature::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'baseline_acl_mismatch:%', spec.signature;
    END IF;
  END LOOP;
END
$check$;
