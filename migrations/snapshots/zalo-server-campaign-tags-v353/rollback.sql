BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])')
      AND md5(pg_get_functiondef(p.oid))='0116ee4872248f3286cdc727866add13'
      AND p.proconfig=ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
  THEN RAISE EXCEPTION 'v353 postflight: definition or attributes mismatch'; END IF;
END;
$verify$;
CREATE OR REPLACE FUNCTION public.aka_agent_apply_zalo_server_campaign_tags(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_account_id bigint, p_runtime_claim_token uuid, p_runtime_unit_token uuid, p_input_data_id bigint, p_contact_type text, p_target_uid text, p_tag_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
 SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_input public.auto_campaign_input_data%ROWTYPE;
  v_caps record;
  v_uid text := NULLIF(btrim(p_target_uid),'');
  v_input_uid text;
  v_uids text[];
  v_contacts bigint[];
  v_tags bigint[];
BEGIN
  IF p_staff_id IS NULL OR p_staff_id<=0 OR p_organization_id IS NULL OR p_organization_id<=0
    OR p_campaign_id IS NULL OR p_campaign_id<=0 OR p_account_id IS NULL OR p_account_id<=0
    OR p_runtime_claim_token IS NULL OR p_runtime_unit_token IS NULL
    OR p_input_data_id IS NULL OR p_input_data_id<=0
    OR p_contact_type IS NULL OR p_contact_type NOT IN ('person','group')
    OR v_uid IS NULL OR length(v_uid)>256
    OR COALESCE(cardinality(p_tag_ids),0) NOT BETWEEN 1 AND 100
    OR EXISTS (SELECT 1 FROM unnest(p_tag_ids) id WHERE id IS NULL OR id<=0)
  THEN RAISE EXCEPTION 'server_campaign_tag_claim_required'; END IF;

  -- Same lock order as run-unit claim/content allocation. No separate lease,
  -- SQL connection, credential lookup, or change to campaign ownership.
  PERFORM 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id
    AND is_active IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'server_campaign_tag_staff_invalid'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  SELECT * INTO v_caps FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);
  IF NOT COALESCE(v_caps.qr_enabled,false) OR NOT COALESCE(v_caps.server_enabled,false)
    THEN RAISE EXCEPTION 'server_campaign_tag_runtime_not_owner'; END IF;
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
  SELECT * INTO v_input FROM public.auto_campaign_input_data
    WHERE id=p_input_data_id AND campaign_id=p_campaign_id AND NOT COALESCE(is_delete,false)
      AND status='đang chạy' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'server_campaign_tag_input_not_owned'; END IF;

  SELECT c.* INTO v_campaign FROM public.auto_campaigns c
    JOIN public.auto_accounts a ON a.id=c.account_id AND a.staff_id=c.staff_id
    WHERE c.id=p_campaign_id AND c.account_id=p_account_id AND c.staff_id=p_staff_id
      AND c.organization_id=p_organization_id AND a.organization_id=p_organization_id
      AND NOT COALESCE(c.is_delete,false) AND NOT COALESCE(a.is_delete,false)
      AND a.is_active IS TRUE AND a.login_status='đã đăng nhập'
      AND lower(btrim(a.flatform_type))='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS NOT TRUE
      AND c.runtime_claim_target='server' AND c.runtime_claim_token=p_runtime_claim_token
      AND c.runtime_unit_token=p_runtime_unit_token AND c.runtime_unit_claimed_at IS NOT NULL
    FOR UPDATE OF c,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'server_campaign_tag_claim_invalid'; END IF;
  -- A soft pause drains the already-owned unit; do not require running status
  -- on campaign/account. Release or replacement invalidates these tokens.
  IF NOT COALESCE(p_input_data_id=ANY(v_campaign.runtime_unit_input_data_ids),false)
    THEN RAISE EXCEPTION 'server_campaign_tag_input_not_in_unit'; END IF;

  IF (v_campaign.extra_settings->'enableAkaBizTag') IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(v_campaign.extra_settings->'akaBizTagIds') IS DISTINCT FROM 'array'
    OR v_campaign.action_id IS NULL
    OR v_campaign.action_id NOT IN ('zalo_message_phone','zalo_message_friend','zalo_message_group_member',
      'zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation',
      'zalo_message_group','zalo_add_group_member')
    OR (p_contact_type='group') IS DISTINCT FROM (v_campaign.action_id='zalo_message_group')
  THEN RAISE EXCEPTION 'server_campaign_tag_configuration_invalid'; END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_tags FROM unnest(p_tag_ids) id;
  IF EXISTS (SELECT 1 FROM unnest(v_tags) requested(id) WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_campaign.extra_settings->'akaBizTagIds') configured(value)
      WHERE configured.value=requested.id::text))
    OR EXISTS (SELECT 1 FROM unnest(v_tags) requested(id) WHERE NOT EXISTS (
      SELECT 1 FROM public.auto_contact_tags t WHERE t.id=requested.id AND t.staff_id=p_staff_id
        AND t.organization_id=p_organization_id AND NOT t.is_delete
        AND (t.auto_account_id IS NULL OR t.auto_account_id=p_account_id)))
  THEN RAISE EXCEPTION 'server_campaign_tag_scope_invalid'; END IF;

  -- Phone resolution persists input.uid before tagging. All other paths retain
  -- their input UID. Never accept arbitrary contact IDs from the Server client.
  v_input_uid := NULLIF(btrim(v_input.uid),'');
  IF p_contact_type='group' THEN
    IF NULLIF(regexp_replace(v_uid,'^[gG]',''),'') IS NULL
      OR NULLIF(regexp_replace(v_uid,'^[gG]',''),'') IS DISTINCT FROM
      NULLIF(regexp_replace(v_input_uid,'^[gG]',''),'') OR v_input_uid IS NULL
      THEN RAISE EXCEPTION 'server_campaign_tag_target_mismatch'; END IF;
    v_uids := ARRAY[v_uid,regexp_replace(v_uid,'^[gG]','')];
  ELSE
    IF v_uid IS DISTINCT FROM v_input_uid THEN RAISE EXCEPTION 'server_campaign_tag_target_mismatch'; END IF;
    v_uids := ARRAY[v_uid];
  END IF;
  SELECT COALESCE(array_agg(c.id ORDER BY c.id),'{}'::bigint[]) INTO v_contacts
    FROM public.auto_account_contacts c WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id
      AND c.organization_id=p_organization_id AND c.contact_type=p_contact_type
      AND c.uid=ANY(v_uids) AND NOT c.is_delete;
  RETURN public.aka_agent_internal_mutate_contact_tags(p_staff_id,p_organization_id,v_contacts,v_tags,'add');
END;
$function$
;
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])')
    AND md5(pg_get_functiondef(p.oid))='8f78a6f048faf4581b93674e16632ecd'
    AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true
    AND p.provolatile='v' AND p.proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
  THEN RAISE EXCEPTION 'v353 preflight: source or attributes changed: aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text)')
    AND md5(pg_get_functiondef(p.oid))='abafd33b61827378f82e5f47bc93db18'
    AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false
    AND p.provolatile='v' AND p.proacl::text='{postgres=X/postgres}')
  THEN RAISE EXCEPTION 'v353 preflight: source or attributes changed: aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)')
    AND md5(pg_get_functiondef(p.oid))='5c8e5a68ee2b52e240d01386e05b90b6'
    AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true
    AND p.provolatile='v' AND p.proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
  THEN RAISE EXCEPTION 'v353 preflight: source or attributes changed: aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)'; END IF;
END;
$preflight$;
COMMIT;
