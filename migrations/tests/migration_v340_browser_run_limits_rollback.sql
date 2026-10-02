BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $smoke$
DECLARE s record; r jsonb; current_revision bigint;
BEGIN
  SELECT id,organization_id,username,password INTO s FROM public.org_staff
  WHERE is_active=true AND deleted_at IS NULL AND organization_id IS NOT NULL
    AND username IS NOT NULL AND password IS NOT NULL AND public.aka_agent_staff_time_allowed(id)
  ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RAISE EXCEPTION 'v340_smoke_no_eligible_staff'; END IF;
  r:=public.aka_agent_browser_run_limits(s.id,s.organization_id,s.username,s.password,'get');
  current_revision:=(r->'settings'->>'revision')::bigint;
  r:=public.aka_agent_browser_run_limits(s.id,s.organization_id,s.username,s.password,'save',
    jsonb_build_object('zaloWebMax',2,'facebookMax',3,'revision',current_revision));
  IF r->'settings'->>'zaloWebMax'<>'2' OR r->'settings'->>'facebookMax'<>'3'
    OR (r->'settings'->>'revision')::bigint<>current_revision+1 THEN RAISE EXCEPTION 'v340_smoke_save'; END IF;
  r:=public.aka_agent_browser_run_limits(s.id,s.organization_id,s.username,s.password,'save',
    jsonb_build_object('zaloWebMax',5,'facebookMax',5,'revision',current_revision));
  IF r->>'reason'<>'conflict' THEN RAISE EXCEPTION 'v340_smoke_cas'; END IF;
  BEGIN
    PERFORM public.aka_agent_browser_run_limits(s.id,s.organization_id,s.username,NULL,'get');
    RAISE EXCEPTION 'v340_smoke_auth_bypass';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('automation_auth_required','browser_run_limits_access_denied') THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.aka_agent_browser_run_limits(s.id,-1,s.username,s.password,'get');
    RAISE EXCEPTION 'v340_smoke_tenant_bypass';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('automation_auth_invalid','browser_run_limits_access_denied') THEN RAISE; END IF;
  END;
END;
$smoke$;
SELECT 'PASS v340 live rollback: real anon role, settings save, revision CAS, missing credentials and tenant guards' AS result;
ROLLBACK;
