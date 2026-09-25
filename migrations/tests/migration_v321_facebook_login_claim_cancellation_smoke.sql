-- Run in an isolated fixture database, or with caller-created actor/account IDs in a rollback.
DO $smoke$
DECLARE a bigint:=current_setting('test.fb_account')::bigint; staff bigint:=current_setting('test.fb_staff')::bigint;
  g bigint; token uuid:=gen_random_uuid(); newer uuid:=gen_random_uuid(); r jsonb; before_status text;
BEGIN
  SELECT facebook_login_claim_generation,status INTO g,before_status FROM public.auto_accounts WHERE id=a;
  -- Cancellation wins: a request not yet received must never acquire a key later.
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'cleanup');
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'cancel before claim failed:%',r; END IF;
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'claim');
  IF r->>'reason'<>'claim_closed' THEN RAISE EXCEPTION 'late claim resurrected:%',r; END IF;
  IF (SELECT status FROM public.auto_accounts WHERE id=a)<>before_status THEN RAISE EXCEPTION 'cancel altered idle status'; END IF;

  SELECT facebook_login_claim_generation INTO g FROM public.auto_accounts WHERE id=a;
  token:=gen_random_uuid();
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'claim');
  IF r->>'claimed'<>'true' THEN RAISE EXCEPTION 'claim failed:%',r; END IF;
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'claim');
  IF r->>'claimed'<>'true' THEN RAISE EXCEPTION 'same token retry failed:%',r; END IF;
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,newer,g,'claim');
  IF r->>'claimed'='true' THEN RAISE EXCEPTION 'competing claim succeeded'; END IF;
  -- Losing request cleanup must not release the winner or invalidate its replay.
  PERFORM public.aka_agent_facebook_account_operation(a,staff,before_status,newer,g,'cleanup');
  IF (SELECT runtime_operation_claim_token FROM public.auto_accounts WHERE id=a) IS DISTINCT FROM token THEN
    RAISE EXCEPTION 'cleanup released another owner'; END IF;
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'claim');
  IF r->>'claimed'<>'true' THEN RAISE EXCEPTION 'loser cleanup invalidated winner'; END IF;
  PERFORM public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'cleanup');
  PERFORM public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'cleanup');
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'claim');
  IF r->>'reason'<>'claim_closed' THEN RAISE EXCEPTION 'replay after cleanup acquired again'; END IF;

  -- A new generation succeeds; stale cleanup cannot affect it.
  SELECT facebook_login_claim_generation INTO g FROM public.auto_accounts WHERE id=a;
  token:=gen_random_uuid();
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'claim');
  IF r->>'claimed'<>'true' THEN RAISE EXCEPTION 'new generation blocked'; END IF;
  PERFORM public.aka_agent_facebook_account_operation(a,staff,before_status,newer,g-1,'cleanup');
  IF (SELECT runtime_operation_claim_token FROM public.auto_accounts WHERE id=a) IS DISTINCT FROM token THEN
    RAISE EXCEPTION 'old cleanup touched new owner'; END IF;
  -- Pause clears the token through the existing trigger; the generation follows.
  UPDATE public.auto_accounts SET status='tạm dừng' WHERE id=a;
  r:=public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'claim');
  IF r->>'reason'<>'claim_closed' THEN RAISE EXCEPTION 'late claim undid user pause'; END IF;
  PERFORM public.aka_agent_facebook_account_operation(a,staff,before_status,token,g,'cleanup');
  IF (SELECT status FROM public.auto_accounts WHERE id=a)<>'tạm dừng' THEN RAISE EXCEPTION 'cleanup lost user pause'; END IF;

  -- Existing cleanup/recovery also closes the generation (legacy API unchanged).
  SELECT facebook_login_claim_generation INTO g FROM public.auto_accounts WHERE id=a;
  token:=gen_random_uuid();
  r:=public.aka_agent_facebook_account_operation(a,staff,'tạm dừng',token,g,'claim');
  IF r->>'claimed'<>'true' THEN RAISE EXCEPTION 'paused claim failed'; END IF;
  PERFORM public.aka_agent_cleanup_account_operation(a,staff,'facebook','desktop','tạm dừng',token);
  r:=public.aka_agent_facebook_account_operation(a,staff,'tạm dừng',token,g,'claim');
  IF r->>'reason'<>'claim_closed' THEN RAISE EXCEPTION 'legacy cleanup failed to fence replay'; END IF;

  UPDATE public.auto_accounts SET is_active=false WHERE id=a;
  SELECT facebook_login_claim_generation INTO g FROM public.auto_accounts WHERE id=a;
  r:=public.aka_agent_facebook_account_operation(a,staff,'tạm dừng',gen_random_uuid(),g,'claim');
  IF r->>'claimed'='true' THEN RAISE EXCEPTION 'inactive guard lost'; END IF;
  UPDATE public.auto_accounts SET is_active=true,status=before_status WHERE id=a;
END $smoke$;
SELECT 'v321_facebook_claim_smoke_passed' AS result;
