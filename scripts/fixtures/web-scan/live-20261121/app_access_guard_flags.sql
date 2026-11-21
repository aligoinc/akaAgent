CREATE OR REPLACE FUNCTION private.app_access_guard_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE q jsonb; app_name text; assigned boolean; previous boolean; used integer; owner_org bigint; req uuid;
BEGIN
  owner_org:=NEW.organization_id;
  IF owner_org IS NULL AND TG_TABLE_NAME='auto_accounts' THEN
    SELECT organization_id INTO owner_org FROM public.org_staff WHERE id=(to_jsonb(NEW)->>'staff_id')::bigint;
  END IF;
  IF NOT public.aka_agent_app_access_separate(owner_org) THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.organization_id=owner_org AND r.target_type='initialize'
    AND r.status='processing' AND r.result->>'transactionId'=pg_current_xact_id()::text)
    THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.is_aka_agent_enabled IS DISTINCT FROM OLD.is_aka_agent_enabled
    OR NEW.is_akachat_enabled IS DISTINCT FROM OLD.is_akachat_enabled)
    AND current_setting('role',true)='aka_agent_desktop' THEN
    req:=NULLIF(current_setting('aka_agent.app_access_request',true),'')::uuid;
    IF NOT EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.request_id=req AND r.status='processing'
      AND r.result->>'transactionId'=pg_current_xact_id()::text AND r.organization_id=owner_org
      AND r.target_type=CASE TG_TABLE_NAME WHEN 'org_staff' THEN 'staff' ELSE 'account' END
      AND r.target_id=NEW.id AND r.actor_staff_id=private.aka_agent_staff_scope_for_request())
      THEN RAISE EXCEPTION 'app_access_denied' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_TABLE_NAME='auto_accounts' THEN
    PERFORM private.app_access_validate_account(NEW,CASE WHEN TG_OP='UPDATE' THEN OLD ELSE NULL END);
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-staff-management:'||owner_org::text,0));
  FOREACH app_name IN ARRAY ARRAY['akaAgent','akaChat'] LOOP
    assigned:=CASE app_name WHEN 'akaAgent' THEN NEW.is_aka_agent_enabled ELSE NEW.is_akachat_enabled END;
    previous:=TG_OP='UPDATE' AND CASE app_name WHEN 'akaAgent' THEN OLD.is_aka_agent_enabled ELSE OLD.is_akachat_enabled END
      AND OLD.deleted_at IS NULL AND OLD.organization_id=owner_org;
    IF NOT assigned OR previous THEN CONTINUE; END IF;
    q:=private.app_access_quota(owner_org,NEW.id,app_name,'staff');
    IF NOT (q->>'hasPackage')::boolean THEN RAISE EXCEPTION 'app_access_package_required'; END IF;
    SELECT count(*) INTO used FROM public.org_staff s WHERE s.organization_id=owner_org AND s.id IS DISTINCT FROM NEW.id
      AND s.deleted_at IS NULL AND CASE app_name WHEN 'akaAgent' THEN s.is_aka_agent_enabled ELSE s.is_akachat_enabled END;
    IF used >= (q->>'limit')::integer THEN RAISE EXCEPTION 'app_access_staff_limit'; END IF;
  END LOOP;
  RETURN NEW;
END $function$
