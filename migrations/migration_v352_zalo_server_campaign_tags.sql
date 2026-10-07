-- Fix packaged Server campaign tagging without Desktop credentials.
-- Live source and metadata: snapshots/zalo-server-campaign-tags-v352/source.json.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $preflight$
DECLARE v_oid oid;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '2e2d262fa88fd2be5051c2e3aac35f9c' THEN
    RAISE EXCEPTION 'v352 preflight: source changed: public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)';
  END IF;
  v_oid := to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN
    RAISE EXCEPTION 'v352 preflight: source changed: public.auto_assert_automation_identity(bigint,bigint,text,text)';
  END IF;
  v_oid := to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '46412e94cf00a788230835f6d56d8d3b' THEN
    RAISE EXCEPTION 'v352 preflight: source changed: public.resolve_organization_zalo_account_capabilities(bigint)';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '74c082aacb1de27a8cedff2e824f219f' THEN
    RAISE EXCEPTION 'v352 preflight: source changed: public.aka_agent_lock_campaign_input_serialization(bigint)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('aka_agent_internal_mutate_contact_tags','aka_agent_apply_zalo_server_campaign_tags')) THEN
    RAISE EXCEPTION 'v352 preflight: target already exists';
  END IF;
  SELECT oid INTO v_oid FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)')
    AND prosecdef AND provolatile='v' AND pg_get_userbyid(proowner)='postgres'
    AND proconfig=ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
    AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'v352 preflight: source attributes changed'; END IF;
END;
$preflight$;

-- Exact live v290 mutation body, with authentication moved to its callers.
-- No public execution: SECURITY INVOKER inherits the checked wrapper's context.
CREATE FUNCTION public.aka_agent_internal_mutate_contact_tags(p_staff_id bigint, p_organization_id bigint, p_contact_ids bigint[], p_tag_ids bigint[], p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE v_contact public.auto_account_contacts%ROWTYPE; v_tags bigint[];
  v_previous_batch text; v_chat_account_id bigint; v_zalo_uid text; v_conversation_type text;
  v_conversation_id bigint; v_changed integer; v_count integer:=0;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('add','remove') THEN RAISE EXCEPTION 'contact_tag_mode_invalid'; END IF;
  IF COALESCE(cardinality(p_contact_ids),0)>100
    THEN RAISE EXCEPTION 'contact_tag_batch_limit_exceeded'; END IF;
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),'{}'::bigint[]) INTO v_tags
    FROM public.auto_contact_tags WHERE id=ANY(p_tag_ids) AND staff_id=p_staff_id
      AND organization_id=p_organization_id AND (p_mode='remove' OR NOT is_delete);
  IF cardinality(v_tags)=0 THEN RETURN jsonb_build_object('success',true,'count',0); END IF;
  FOR v_contact IN SELECT * FROM public.auto_account_contacts
    WHERE id=ANY(p_contact_ids) AND staff_id=p_staff_id AND organization_id=p_organization_id AND NOT is_delete
    ORDER BY id
  LOOP
    IF p_mode='add' AND EXISTS (SELECT 1 FROM public.auto_contact_tags t WHERE t.id=ANY(v_tags)
      AND t.auto_account_id IS NOT NULL AND t.auto_account_id IS DISTINCT FROM v_contact.account_id)
      THEN RAISE EXCEPTION 'contact_tag_scope_invalid'; END IF;
    SELECT conv.id,ac.chat_zalo_account_id,ac.zalo_id,ac.conversation_type
      INTO v_conversation_id,v_chat_account_id,v_zalo_uid,v_conversation_type
    FROM public.auto_account_contacts c
    JOIN public.chat_zalo_account_organization b ON b.auto_account_id=c.account_id
      AND b.organization_id=c.organization_id AND b.is_active AND c.flatform_type='zalo'
    JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id
      AND ac.zalo_id=c.uid AND ac.conversation_type=CASE WHEN c.contact_type='person' THEN 'user' WHEN c.contact_type='group' THEN 'group' END
    JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id
      AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
    WHERE c.id=v_contact.id;
    IF v_conversation_id IS NOT NULL THEN
      -- Suppress per-tag mirrors/queue writes only inside this batch. Restore
      -- before the single contact event and projection, including on errors.
      v_previous_batch:=current_setting('aka_agent.chat_tag_batch',true);
      PERFORM set_config('aka_agent.chat_tag_batch','on',true);
      BEGIN
        IF p_mode='add' THEN
          INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id,assigned_by_org_staff_id)
            SELECT p_organization_id,v_conversation_id,k,p_staff_id FROM unnest(v_tags) k
            ON CONFLICT(chat_zalo_conversation_id,auto_contact_tag_id) DO NOTHING;
        ELSE
          DELETE FROM public.chat_zalo_conversation_system_tag
            WHERE chat_zalo_conversation_id=v_conversation_id AND organization_id=p_organization_id AND auto_contact_tag_id=ANY(v_tags);
        END IF;
        GET DIAGNOSTICS v_changed=ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('aka_agent.chat_tag_batch',COALESCE(v_previous_batch,''),true);
        RAISE;
      END;
      PERFORM set_config('aka_agent.chat_tag_batch',COALESCE(v_previous_batch,''),true);
      IF v_changed>0 AND v_conversation_type='user' THEN
        PERFORM public.aka_agent_enqueue_data_group_chat_user(v_chat_account_id,v_zalo_uid,p_organization_id);
      END IF;
      PERFORM public.aka_agent_refresh_contact_chat_tags(v_contact.id);
    ELSE
      UPDATE public.auto_account_contacts SET akabiz_tag_ids=ARRAY(
        SELECT DISTINCT k FROM unnest(COALESCE(akabiz_tag_ids,'{}'::bigint[])||CASE WHEN p_mode='add' THEN v_tags ELSE '{}'::bigint[] END) k
        WHERE p_mode='add' OR NOT k=ANY(v_tags) ORDER BY k
      ),updated_at=clock_timestamp()
      WHERE id=v_contact.id AND NOT is_delete AND CASE WHEN p_mode='add'
        THEN NOT COALESCE(akabiz_tag_ids,'{}'::bigint[]) @> v_tags
        ELSE COALESCE(akabiz_tag_ids,'{}'::bigint[]) && v_tags END;
      GET DIAGNOSTICS v_changed=ROW_COUNT;
    END IF;
    IF v_changed>0 THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success',true,'count',v_count);
END;
$function$;

ALTER FUNCTION public.aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text) FROM PUBLIC,anon,authenticated,service_role;

-- Existing entrypoint keeps its exact signature, owner, ACL and authentication.
CREATE OR REPLACE FUNCTION public.aka_agent_mutate_contact_tags(p_staff_id bigint, p_organization_id bigint, p_contact_ids bigint[], p_tag_ids bigint[], p_auth_username text, p_auth_password text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  RETURN public.aka_agent_internal_mutate_contact_tags(p_staff_id,p_organization_id,p_contact_ids,p_tag_ids,p_mode);
END;
$function$;

CREATE FUNCTION public.aka_agent_apply_zalo_server_campaign_tags(
  p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_account_id bigint,
  p_runtime_claim_token uuid, p_runtime_unit_token uuid, p_input_data_id bigint,
  p_contact_type text, p_target_uid text, p_tag_ids bigint[]
)
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
$function$;

ALTER FUNCTION public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[]) TO anon,authenticated,service_role;

COMMIT;
