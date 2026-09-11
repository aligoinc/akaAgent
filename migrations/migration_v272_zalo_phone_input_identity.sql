-- Allow resolved Zalo name/UID on phone-campaign input snapshots.
-- Based on the live akachat definition captured on 2026-09-11; v186 body
-- matches production. Preserve phone/key, all other payload guards and ACL.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure('public.aka_agent_guard_canonical_campaign_input_payload()');
  v_checksum text;
  v_source_checksum constant text := '6595223cb49f34c3ce14bc0c55c52147';
  v_target_checksum constant text := 'e0053fd2dff2eee9ba40a019e8b79d2d';
  v_owner name;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_acl aclitem[];
  v_target_definition constant text := $definition$CREATE OR REPLACE FUNCTION public.aka_agent_guard_canonical_campaign_input_payload()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.canonical_target_key IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.input_id IS DISTINCT FROM OLD.input_id
    OR NEW.phone IS DISTINCT FROM OLD.phone
    OR NEW.phone_carrier IS DISTINCT FROM OLD.phone_carrier
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.info1 IS DISTINCT FROM OLD.info1
    OR NEW.info2 IS DISTINCT FROM OLD.info2
    OR NEW.info3 IS DISTINCT FROM OLD.info3
    OR NEW.info4 IS DISTINCT FROM OLD.info4
    OR NEW.info5 IS DISTINCT FROM OLD.info5
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.schedule IS DISTINCT FROM OLD.schedule
    OR NEW.canonical_target_key IS DISTINCT FROM OLD.canonical_target_key
    OR NEW.auto_automation_detail_id IS DISTINCT FROM OLD.auto_automation_detail_id
    OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
  THEN
    RAISE EXCEPTION 'canonical_campaign_input_payload_immutable';
  END IF;

  -- A phone target keeps its original phone/key. Only the resolved Zalo
  -- name/UID may change, for both direct snapshots and live Data Group inputs.
  IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.uid IS DISTINCT FROM OLD.uid)
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = OLD.campaign_id
        AND campaign.action_id = 'zalo_message_phone'
        AND NULLIF(btrim(OLD.phone), '') IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'canonical_campaign_input_payload_immutable';
  END IF;

  RETURN NEW;
END;
$function$
$definition$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'v272 preflight: canonical input guard signature missing';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner),
         p.prosecdef, p.provolatile, p.proconfig, p.proacl
  INTO v_checksum, v_owner, v_security_definer, v_volatility, v_config, v_acl
  FROM pg_proc AS p WHERE p.oid = v_signature;

  IF v_checksum NOT IN (v_source_checksum, v_target_checksum)
    OR v_owner IS DISTINCT FROM 'postgres'::name
    OR v_security_definer IS DISTINCT FROM false
    OR v_volatility IS DISTINCT FROM 'v'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
  THEN
    RAISE EXCEPTION 'v272 preflight: unexpected canonical input guard definition or attributes (checksum %)', v_checksum;
  END IF;

  IF v_checksum = v_source_checksum THEN
    EXECUTE v_target_definition;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc AS p WHERE p.oid = v_signature
      AND md5(pg_get_functiondef(p.oid)) = v_target_checksum
      AND pg_get_userbyid(p.proowner) = v_owner
      AND p.prosecdef = v_security_definer AND p.provolatile = v_volatility
      AND p.proconfig IS NOT DISTINCT FROM v_config
      AND p.proacl IS NOT DISTINCT FROM v_acl
  ) THEN
    RAISE EXCEPTION 'v272 postflight: canonical input guard definition or attributes changed unexpectedly';
  END IF;
END;
$migration$;

-- Function signature, table shape and API grants are unchanged; no explicit
-- PostgREST schema reload is needed for this trigger-body change.
COMMIT;
