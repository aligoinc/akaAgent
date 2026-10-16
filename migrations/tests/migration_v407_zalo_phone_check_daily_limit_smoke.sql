-- Run only inside an explicit BEGIN ... ROLLBACK; no Zalo API calls.
DO $smoke$
DECLARE a public.auto_accounts%ROWTYPE; r jsonb; before_account jsonb; after_account jsonb;
  token uuid := gen_random_uuid(); today date := timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
  policy_hash text; reset_hash text; cron_sql text; target text;
BEGIN
  SELECT aa.* INTO STRICT a FROM public.auto_accounts aa JOIN public.org_staff s ON s.id=aa.staff_id
    AND (aa.organization_id IS NULL OR s.organization_id=aa.organization_id)
  CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(s.organization_id) cap
  WHERE aa.flatform_type='zalo' AND aa.is_active=true AND NOT coalesce(aa.is_delete,false)
    AND aa.login_status='đã đăng nhập' AND aa.status IN ('chờ xử lý','tạm dừng')
    AND s.is_active=true AND public.aka_agent_staff_time_allowed(s.id) AND aa.organization_id IS NOT NULL
    AND ((aa.is_zalo_server IS TRUE AND cap.qr_enabled AND cap.server_enabled AND aa.is_zalo_show_web IS NOT TRUE)
      OR (aa.is_zalo_server IS NOT TRUE AND ((aa.is_zalo_show_web IS TRUE AND cap.web_enabled) OR (aa.is_zalo_show_web IS NOT TRUE AND cap.qr_enabled))))
    AND NOT EXISTS(SELECT 1 FROM public.auto_campaigns c WHERE c.account_id=aa.id AND (c.status='đang chạy' OR c.runtime_unit_token IS NOT NULL))
  LIMIT 1;
  target:=CASE WHEN a.is_zalo_server THEN 'server' ELSE 'desktop' END;
  SELECT md5(string_agg(to_jsonb(e)::text,',' ORDER BY id)) INTO policy_hash FROM public.auto_error e;
  SELECT md5(pg_get_functiondef('public.reset_auto_account_action_status_daily()'::regprocedure)) INTO reset_hash;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  r:=public.claim_zalo_account_runtime_operation(a.id,a.staff_id,target,a.status,token,true);
  IF r->>'claimed' <> 'true' THEN RAISE EXCEPTION 'fixture account could not be claimed'; END IF;
  SELECT to_jsonb(x)-'zalo_phone_check_usage' INTO before_account FROM public.auto_accounts x WHERE id=a.id;
  UPDATE public.auto_accounts SET zalo_phone_check_usage=NULL WHERE id=a.id;
  r:=public.aka_agent_zalo_phone_check_usage(a.staff_id,a.organization_id,a.id,target,NULL,false,'','');
  IF r->>'count'<>'0' OR r->>'limit'<>'600' THEN RAISE EXCEPTION 'initial usage failed'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=a.id AND zalo_phone_check_usage IS NOT NULL) THEN RAISE EXCEPTION 'read wrote usage'; END IF;
  UPDATE public.auto_accounts SET zalo_phone_check_usage=jsonb_build_object('date',today,'count',599) WHERE id=a.id;
  r:=public.aka_agent_zalo_phone_check_usage(a.staff_id,a.organization_id,a.id,target,token,true,'','');
  IF r->>'count'<>'600' OR r->>'allowed'<>'true' THEN RAISE EXCEPTION 'last reservation failed'; END IF;
  r:=public.aka_agent_zalo_phone_check_usage(a.staff_id,a.organization_id,a.id,target,token,true,'','');
  IF r->>'count'<>'600' OR r->>'allowed'<>'false' THEN RAISE EXCEPTION 'cap bypassed'; END IF;
  UPDATE public.auto_accounts SET zalo_phone_check_usage=jsonb_build_object('date',today-1,'count',600) WHERE id=a.id;
  r:=public.aka_agent_zalo_phone_check_usage(a.staff_id,a.organization_id,a.id,target,token,true,'','');
  IF r->>'count'<>'1' OR r->>'date'<>today::text THEN RAISE EXCEPTION 'lazy rollover failed'; END IF;
  SELECT command INTO STRICT cron_sql FROM cron.job WHERE jobname='zalo_phone_check_usage_reset_daily';
  -- Scoped fixture check uses the identical production reset predicate, without
  -- touching usage of other accounts even inside this rolled-back transaction.
  EXECUTE replace(cron_sql,';',format(' AND id=%s;',a.id));
  IF (SELECT zalo_phone_check_usage->>'count' FROM public.auto_accounts WHERE id=a.id)<>'1' THEN RAISE EXCEPTION 'late cron erased today'; END IF;
  UPDATE public.auto_accounts SET zalo_phone_check_usage=jsonb_build_object('date',today-1,'count',600) WHERE id=a.id;
  EXECUTE replace(cron_sql,';',format(' AND id=%s;',a.id));
  IF (SELECT zalo_phone_check_usage->>'count' FROM public.auto_accounts WHERE id=a.id)<>'0' THEN RAISE EXCEPTION 'cron rollover failed'; END IF;
  BEGIN
    PERFORM public.aka_agent_zalo_phone_check_usage(a.staff_id,a.organization_id,a.id,target,gen_random_uuid(),true,'','');
    RAISE EXCEPTION 'bad claim accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'phone_check_claim_invalid' THEN RAISE; END IF; END;
  BEGIN
    PERFORM set_config('request.jwt.claim.role','anon',true);
    PERFORM public.aka_agent_zalo_phone_check_usage(a.staff_id,a.organization_id,a.id,target,token,true,'v407-invalid','v407-invalid');
    RAISE EXCEPTION 'bad credentials accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
  SELECT to_jsonb(x)-'zalo_phone_check_usage' INTO after_account FROM public.auto_accounts x WHERE id=a.id;
  IF before_account IS DISTINCT FROM after_account THEN RAISE EXCEPTION 'unrelated account fields changed'; END IF;
  IF policy_hash IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(e)::text,',' ORDER BY id)) FROM public.auto_error e)
    OR reset_hash IS DISTINCT FROM md5(pg_get_functiondef('public.reset_auto_account_action_status_daily()'::regprocedure)) THEN RAISE EXCEPTION 'campaign policy/reset changed'; END IF;
  IF NOT has_function_privilege('anon','public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text)','EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_proc p,aclexplode(p.proacl) acl WHERE p.oid='public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text)'::regprocedure AND acl.grantee=0) THEN RAISE EXCEPTION 'RPC ACL failed'; END IF;
END $smoke$;
