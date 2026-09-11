-- Fix v274's invoker trigger calling a normalizer unavailable to anon/authenticated.
-- Applied as 20260911063918 on akachat at 2026-09-11 06:43:34 UTC.
-- Only two phone-validity expressions change. normalize_phone is the already
-- callable pure function used by the current private normalizer; retain its
-- exact mobile-number validation. No GRANT or SECURITY DEFINER is introduced.
-- Live source: akachat (cgjbsmqtfhqvttudyjzq), captured 2026-09-11.
-- Guard checksum: aba73e0b45801cecf97f8c44c6a6b463 -> 6c656e83c8b38ccea75bcc8f7d81ffed.
-- Preserve all v274 target/reference checks, metadata fast path, owner and ACL;
-- leave private helpers and the snapshot RPC (v199/v226/v227/v228/v243/v245) intact.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

DO $preflight$
DECLARE actual record;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text
  INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_guard_canonical_campaign_input_payload()');
  IF NOT FOUND OR actual.md5 IS DISTINCT FROM 'aba73e0b45801cecf97f8c44c6a6b463'
    OR actual.pg_get_userbyid IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM false
    OR actual.provolatile IS DISTINCT FROM 'v'::"char" OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR actual.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  THEN RAISE EXCEPTION 'v275: live function drift: %', 'public.aka_agent_guard_canonical_campaign_input_payload()'; END IF;
  SELECT md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text
  INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_internal_normalize_phone(text)');
  IF NOT FOUND OR actual.md5 IS DISTINCT FROM 'b3ad52bceed9a68a6648956fbc622629'
    OR actual.pg_get_userbyid IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM false
    OR actual.provolatile IS DISTINCT FROM 'i'::"char" OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    OR actual.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  THEN RAISE EXCEPTION 'v275: live function drift: %', 'public.aka_agent_internal_normalize_phone(text)'; END IF;
  SELECT md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text
  INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure('public.normalize_phone(text)');
  IF NOT FOUND OR actual.md5 IS DISTINCT FROM 'f6ccb574895043480e6523193f7be007'
    OR actual.pg_get_userbyid IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM false
    OR actual.provolatile IS DISTINCT FROM 'i'::"char" OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    OR actual.proacl IS DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  THEN RAISE EXCEPTION 'v275: live function drift: %', 'public.normalize_phone(text)'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_campaign_input_data'::regclass
    AND tgname='trg_aka_agent_guard_canonical_campaign_input_payload' AND tgenabled='O'
    AND md5(pg_get_triggerdef(oid))='94676f55cfbcab9ba676a7024127a1eb')
  THEN RAISE EXCEPTION 'v275: canonical guard trigger drift'; END IF;
  IF NOT has_function_privilege('anon','public.normalize_phone(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.normalize_phone(text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.normalize_phone(text)','EXECUTE')
    OR has_function_privilege('anon','public.aka_agent_internal_normalize_phone(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.aka_agent_internal_normalize_phone(text)','EXECUTE')
  THEN RAISE EXCEPTION 'v275: normalizer privilege contract changed'; END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_guard_canonical_campaign_input_payload()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_action text;
  v_has_phone boolean;
  v_target_changed boolean;
BEGIN
  IF OLD.canonical_target_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Information is editable in both direct and data_group campaigns; the
  -- delivery target and ledger references are not. No alias cleanup is needed.
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.input_id IS DISTINCT FROM OLD.input_id
    OR NEW.canonical_target_key IS DISTINCT FROM OLD.canonical_target_key
    OR NEW.auto_automation_detail_id IS DISTINCT FROM OLD.auto_automation_detail_id
    OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
  THEN
    RAISE EXCEPTION 'canonical_campaign_input_payload_immutable';
  END IF;

  -- Status, name, notes, carrier, info1..5, content and scheduling changes
  -- require no campaign lookup. Only possible target changes need the action.
  IF NEW.phone IS NOT DISTINCT FROM OLD.phone
    AND NEW.uid IS NOT DISTINCT FROM OLD.uid
    AND NEW.email IS NOT DISTINCT FROM OLD.email
  THEN
    RETURN NEW;
  END IF;

  SELECT campaign.action_id INTO v_action
  FROM public.auto_campaigns AS campaign WHERE campaign.id = OLD.campaign_id;

  IF v_action IN ('zalo_message_phone', 'sms_send', 'voice_call', 'zalo_add_group_member') THEN
    v_has_phone := COALESCE(public.normalize_phone(OLD.phone) ~ '^0[35789][0-9]{8}$', false);
    IF v_action = 'zalo_add_group_member' AND NOT v_has_phone THEN
      -- Adding a valid phone would switch this UID-based row to another route.
      v_target_changed := NEW.uid IS DISTINCT FROM OLD.uid
        OR COALESCE(public.normalize_phone(NEW.phone) ~ '^0[35789][0-9]{8}$', false);
    ELSE
      v_target_changed := NEW.phone IS DISTINCT FROM OLD.phone
        OR (NOT v_has_phone AND NEW.uid IS DISTINCT FROM OLD.uid)
        OR (v_action = 'zalo_add_group_member' AND NULLIF(btrim(OLD.uid), '') IS NOT NULL
          AND NEW.uid IS DISTINCT FROM OLD.uid);
    END IF;
  ELSIF v_action = 'email_send' THEN
    v_target_changed := NEW.email IS DISTINCT FROM OLD.email;
  ELSIF v_action LIKE 'facebook_%' OR v_action LIKE 'zalo_%' THEN
    v_target_changed := NEW.uid IS DISTINCT FROM OLD.uid;
  ELSE
    -- Unknown/legacy actions keep all potential target fields protected.
    v_target_changed := NEW.phone IS DISTINCT FROM OLD.phone
      OR NEW.uid IS DISTINCT FROM OLD.uid OR NEW.email IS DISTINCT FROM OLD.email;
  END IF;

  IF v_target_changed THEN
    RAISE EXCEPTION 'canonical_campaign_input_target_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DO $postflight$
DECLARE actual record;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text
  INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_guard_canonical_campaign_input_payload()');
  IF NOT FOUND OR actual.md5 IS DISTINCT FROM '6c656e83c8b38ccea75bcc8f7d81ffed'
    OR actual.pg_get_userbyid IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM false
    OR actual.provolatile IS DISTINCT FROM 'v'::"char" OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR actual.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  THEN RAISE EXCEPTION 'v275: live function drift: %', 'public.aka_agent_guard_canonical_campaign_input_payload()'; END IF;
  SELECT md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text
  INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_internal_normalize_phone(text)');
  IF NOT FOUND OR actual.md5 IS DISTINCT FROM 'b3ad52bceed9a68a6648956fbc622629'
    OR actual.pg_get_userbyid IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM false
    OR actual.provolatile IS DISTINCT FROM 'i'::"char" OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    OR actual.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  THEN RAISE EXCEPTION 'v275: live function drift: %', 'public.aka_agent_internal_normalize_phone(text)'; END IF;
  SELECT md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text
  INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure('public.normalize_phone(text)');
  IF NOT FOUND OR actual.md5 IS DISTINCT FROM 'f6ccb574895043480e6523193f7be007'
    OR actual.pg_get_userbyid IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM false
    OR actual.provolatile IS DISTINCT FROM 'i'::"char" OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    OR actual.proacl IS DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  THEN RAISE EXCEPTION 'v275: live function drift: %', 'public.normalize_phone(text)'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_campaign_input_data'::regclass
    AND tgname='trg_aka_agent_guard_canonical_campaign_input_payload' AND tgenabled='O'
    AND md5(pg_get_triggerdef(oid))='94676f55cfbcab9ba676a7024127a1eb')
  THEN RAISE EXCEPTION 'v275: canonical guard trigger drift'; END IF;
  IF NOT has_function_privilege('anon','public.normalize_phone(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.normalize_phone(text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.normalize_phone(text)','EXECUTE')
    OR has_function_privilege('anon','public.aka_agent_internal_normalize_phone(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.aka_agent_internal_normalize_phone(text)','EXECUTE')
  THEN RAISE EXCEPTION 'v275: normalizer privilege contract changed'; END IF;
END;
$postflight$;

COMMIT;
