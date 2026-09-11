-- Direct campaign imports remain editable; preserve group-source contracts.
-- Source capture: akachat, 2026-09-11. Guard matches v272; snapshot matches
-- v245 (including v199/v226/v227/v228/v243). No DB-only patches were found.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

DO $preflight$
DECLARE expected record; actual record; signature regprocedure;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
      ('public.aka_agent_guard_canonical_campaign_input_payload()','e0053fd2dff2eee9ba40a019e8b79d2d','2c28a342e22c40b4c3681865263577fe',false,ARRAY['search_path=public']::text[],ARRAY['search_path=public']::text[],'{postgres=X/postgres,service_role=X/postgres}'::aclitem[]),
      ('public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)','94048cb3085c23ae578f5cd722d8c7ba','47bae8503ed1afe6ba1ca79540a55cd5',true,ARRAY['search_path=pg_catalog, public']::text[],ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[],'{postgres=X/postgres}'::aclitem[]),
      ('public.aka_agent_release_changed_direct_input_identity()',NULL,'f0661981a4b9e4c77635a4da16e43027',true,ARRAY['search_path=pg_catalog, public']::text[],ARRAY['search_path=pg_catalog, public']::text[],'{postgres=X/postgres}'::aclitem[])
  ) AS definitions(signature, source_hash, target_hash, definer, source_config, target_config, acl)
  LOOP
    signature := to_regprocedure(expected.signature);
    IF signature IS NULL THEN
      IF expected.source_hash IS NOT NULL THEN RAISE EXCEPTION 'v273: missing %', expected.signature; END IF;
      CONTINUE;
    END IF;
    SELECT md5(pg_get_functiondef(p.oid)) checksum, pg_get_userbyid(proowner) owner,
      prosecdef, provolatile, proconfig, proacl INTO actual FROM pg_proc p WHERE p.oid=signature;
    IF actual.checksum IS DISTINCT FROM expected.source_hash AND actual.checksum IS DISTINCT FROM expected.target_hash
      OR actual.owner IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM expected.definer
      OR actual.provolatile IS DISTINCT FROM 'v'::"char" OR actual.proacl IS DISTINCT FROM expected.acl
      OR actual.proconfig IS DISTINCT FROM (CASE WHEN actual.checksum=expected.target_hash THEN expected.target_config ELSE expected.source_config END)
    THEN RAISE EXCEPTION 'v273: definition or attributes drift for % (%)', expected.signature, actual.checksum; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_campaign_input_data'::regclass
    AND tgname='trg_aka_agent_guard_canonical_campaign_input_payload' AND tgenabled='O'
    AND tgfoid='public.aka_agent_guard_canonical_campaign_input_payload()'::regprocedure AND tgtype=19)
  THEN RAISE EXCEPTION 'v273: canonical guard wiring changed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_campaign_input_data'::regclass
    AND tgname='trg_aka_agent_release_changed_direct_input_identity'
    AND (tgfoid IS DISTINCT FROM to_regprocedure('public.aka_agent_release_changed_direct_input_identity()')
      OR tgenabled<>'O' OR tgtype<>19 OR tgnargs<>0 OR tgqual IS NULL))
  THEN RAISE EXCEPTION 'v273: identity release trigger drift'; END IF;
END;
$preflight$;

DO $replace$
BEGIN
  IF to_regprocedure('public.aka_agent_guard_canonical_campaign_input_payload()') IS NULL
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_guard_canonical_campaign_input_payload()'))) <> '2c28a342e22c40b4c3681865263577fe'
  THEN EXECUTE $definition$CREATE OR REPLACE FUNCTION public.aka_agent_guard_canonical_campaign_input_payload()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.canonical_target_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- One-time group imports belong to a direct campaign and remain editable.
  -- System references stay protected; a separate integrity trigger releases
  -- target aliases only when the actual delivery identity changes.
  IF NEW.campaign_id IS NOT DISTINCT FROM OLD.campaign_id
    AND NEW.canonical_target_key IS NOT DISTINCT FROM OLD.canonical_target_key
    AND NEW.auto_automation_detail_id IS NOT DISTINCT FROM OLD.auto_automation_detail_id
    AND EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = OLD.campaign_id
        AND campaign.data_target_source_mode = 'direct'
    )
  THEN
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
$function$;$definition$; END IF;
END;
$replace$;

DO $replace$
BEGIN
  IF to_regprocedure('public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)') IS NULL
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'))) <> '47bae8503ed1afe6ba1ca79540a55cd5'
  THEN EXECUTE $definition$CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_campaign_id bigint, p_group_id bigint, p_campaign_schedule timestamp with time zone, p_campaign_status text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_action text;
  v_platform text;
  v_contact_type text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_input_uid text;
  v_input_phone text;
  v_input_email text;
  v_target_value text;
  v_identity_value text;
  v_uid_identity text;
  v_url_identity text;
  v_allow_alias_resolution boolean;
  v_target_kind text;
  v_scope text;
  v_candidate_key text;
  v_canonical_key text;
  v_aliases text[];
  v_mapped_keys text[];
  v_payload jsonb;
  v_input_id bigint;
  v_inserted_row boolean;
  v_info1 text;
  v_info2 text;
  v_info3 text;
  v_info4 text;
  v_info5 text;
  v_phone_carrier text;
  v_request_hash text;
  v_result jsonb;
  v_active integer := 0;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_account_runtime_target text;
  v_runtime_target text := lower(btrim(COALESCE(
    NULLIF(current_setting('aka_agent.zalo_runtime_target', true), ''),
    'desktop'
  )));
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_group_id IS NULL OR p_group_id <= 0
    OR p_campaign_schedule IS NULL
    OR p_campaign_status IS NULL
    OR p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng')
    OR NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_direct_campaign_group_snapshot';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'snapshot_campaign',
    'campaignId', p_campaign_id,
    'groupId', p_group_id,
    'campaignSchedule', to_char(
      p_campaign_schedule AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US'
    ),
    'campaignStatus', p_campaign_status
  )::text);

  -- Return a committed response before consulting mutable campaign/group state.
  -- This makes response-loss retries stable even if the group changes later.
  SELECT batch.*
  INTO v_batch
  FROM public.auto_data_ingest_batches AS batch
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = btrim(p_request_id)
  FOR UPDATE;
  IF FOUND THEN
    IF v_batch.operation <> 'snapshot_campaign'
      OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  -- Match the shared Data Group lock hierarchy (group -> campaign) used by
  -- ingest/bind/delete; do not invert those locks during live intake.
  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  -- Keep the shared Data Group hierarchy: batch -> group -> barrier ->
  -- campaign -> account/input. Bind/reactivate/router paths take the same
  -- group-before-barrier order.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;
  IF v_campaign.data_target_source_mode IS DISTINCT FROM 'direct'
    OR v_campaign.provisioning_state IS DISTINCT FROM 'ready'
    OR v_campaign.status = 'đang chạy'
    OR EXISTS (
      SELECT 1
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.campaign_id = v_campaign.id
    )
  THEN
    RAISE EXCEPTION 'campaign_not_direct_snapshot_eligible';
  END IF;
  IF v_campaign.action_id NOT IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid',
    'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_comment_seeding', 'facebook_comment_seeding_post',
    'zalo_message_phone', 'zalo_join_group_link', 'email_send',
    'facebook_message_friend', 'facebook_group_invite', 'facebook_page_post',
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer', 'zalo_message_group',
    'zalo_add_group_member'
  ) THEN
    RAISE EXCEPTION 'data_group_campaign_action_incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_actions AS action
    WHERE action.id = v_campaign.action_id
      AND action.is_active = true
      AND COALESCE(action.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'campaign_action_inactive';
  END IF;
  -- Campaign is already locked above. Lock account second so campaign claims
  -- and subtype conversion cannot race this runtime ownership decision.
  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_account_runtime_target
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_account_not_found';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server')
    OR v_runtime_target IS DISTINCT FROM v_account_runtime_target
  THEN
    RAISE EXCEPTION 'direct_campaign_runtime_not_owner';
  END IF;

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, source_name, request_hash,
    status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'snapshot_campaign', v_group.id, 'manual',
    'Snapshot Nhóm data: ' || v_group.name, v_request_hash,
    'processing', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'snapshot_campaign'
      OR v_batch.group_id IS DISTINCT FROM v_group.id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  v_action := btrim(COALESCE(v_campaign.action_id, ''));

  FOR v_member IN
    SELECT member.*
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id
      AND member.is_delete = false
    ORDER BY member.id
  LOOP
    v_active := v_active + 1;
    v_input_uid := NULL;
    v_input_phone := NULL;
    v_input_email := NULL;
    v_target_value := NULL;
    v_identity_value := NULL;
    v_uid_identity := NULL;
    v_url_identity := NULL;
    v_target_kind := NULL;
    v_scope := NULL;
    v_candidate_key := NULL;
    v_canonical_key := NULL;
    v_aliases := '{}'::text[];
    v_mapped_keys := '{}'::text[];
    v_allow_alias_resolution := false;
    v_input_id := NULL;
    v_inserted_row := false;

    IF NOT (
      -- v228: valid-phone routes ignore all source semantic and contact
      -- metadata constraints; UID-only add-member still uses the old guard.
      v_action IN ('zalo_message_phone', 'zalo_add_group_member')
      AND public.aka_agent_data_group_membership_has_valid_phone(
        v_member.id, v_group.id
      )
    ) AND NOT public.aka_agent_data_group_membership_semantic_compatible(
      v_member.id, v_action, v_group.id
    ) THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;

    SELECT contact.*
    INTO v_contact
    FROM public.auto_account_contacts AS contact
    WHERE contact.id = v_member.contact_id
      AND contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND COALESCE(contact.is_delete, false) = false;
    IF NOT FOUND THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;

    v_platform := lower(btrim(COALESCE(v_contact.flatform_type, '')));
    v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
    v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
    v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
    v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
    v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
      NULLIF(v_contact.phone, ''),
      NULLIF(v_contact.extra_data ->> 'phone', ''),
      CASE WHEN v_contact_type = 'phone' THEN v_contact.uid ELSE NULL END,
      ''
    ));
    v_phone := NULLIF(v_phone, '');
    v_email := NULLIF(lower(btrim(COALESCE(
      NULLIF(v_contact.email, ''),
      NULLIF(v_contact.extra_data ->> 'email', ''),
      CASE WHEN v_contact_type = 'email' THEN v_contact.uid ELSE NULL END,
      ''
    ))), '');
    IF v_email IS NOT NULL AND (
      v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR length(v_email) > 254
    ) THEN
      v_email := NULL;
    END IF;
    v_info1 := NULLIF(v_contact.extra_data ->> 'info1', '');
    v_info2 := NULLIF(v_contact.extra_data ->> 'info2', '');
    v_info3 := NULLIF(v_contact.extra_data ->> 'info3', '');
    v_info4 := NULLIF(v_contact.extra_data ->> 'info4', '');
    v_info5 := NULLIF(v_contact.extra_data ->> 'info5', '');
    v_phone_carrier := COALESCE(
      NULLIF(v_contact.extra_data ->> 'phoneCarrier', ''),
      NULLIF(v_contact.extra_data ->> 'phone_carrier', '')
    );

    IF v_action IN ('facebook_group_post', 'facebook_join_group', 'facebook_find_data_group') THEN
      -- v227: snapshot Facebook routes use semantic type plus UID/URL only.
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_group'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_message_uid' THEN
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_find_data_search' THEN
      v_target_value := v_uid;
      v_target_kind := 'facebook_search'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action IN ('facebook_comment_seeding', 'facebook_comment_seeding_post') THEN
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := CASE WHEN v_action = 'facebook_comment_seeding_post'
        THEN 'facebook_post' ELSE 'facebook_comment_target' END;
      v_scope := 'portable'; v_input_uid := v_target_value;
    ELSIF v_action = 'zalo_message_phone' THEN
      IF v_phone IS NULL THEN v_incompatible := v_incompatible + 1; CONTINUE; END IF;
      v_target_value := v_phone; v_target_kind := 'phone'; v_scope := 'portable';
      v_input_phone := v_phone;
    ELSIF v_action = 'zalo_join_group_link' THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'group' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'zalo_group_link'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'email_send' THEN
      IF v_email IS NULL THEN v_incompatible := v_incompatible + 1; CONTINUE; END IF;
      v_target_value := v_email; v_target_kind := 'email'; v_scope := 'portable';
      v_input_email := v_email;
    ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
      -- v226: Facebook UID/URL targets do not inherit source-account or
      -- is_friend restrictions from scan metadata.
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_page_post' THEN
      -- v226: Page ID/URL validity is sufficient for a Facebook target.
      v_target_value := COALESCE(v_uid, v_url);
      v_target_kind := 'facebook_page';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action IN (
      'zalo_message_friend', 'zalo_message_group_member',
      'zalo_message_remarketing_customer'
    ) THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'person'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR (v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true)
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := v_uid; v_target_kind := 'zalo_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSIF v_action = 'zalo_message_group' THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'group'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR v_contact.is_joined IS DISTINCT FROM true
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := v_uid; v_target_kind := 'zalo_group';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSIF v_action = 'zalo_add_group_member' THEN
      IF v_phone IS NOT NULL THEN
        v_target_value := v_phone; v_target_kind := 'phone'; v_scope := 'portable';
        v_input_phone := v_phone; v_input_uid := '';
      ELSIF v_platform = 'zalo' AND v_contact_type = 'person'
        AND v_uid IS NOT NULL
        AND v_contact.account_id IS NOT DISTINCT FROM v_campaign.account_id
      THEN
        v_target_value := v_uid; v_target_kind := 'zalo_person';
        v_scope := 'bound:' || v_campaign.account_id::text;
        v_input_uid := v_uid;
      ELSE
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
    ELSE
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    IF NULLIF(v_target_value, '') IS NULL THEN
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    IF v_target_kind LIKE 'facebook_%' THEN
      v_uid_identity := CASE WHEN v_uid IS NULL THEN NULL
        ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_uid), '') END;
      v_url_identity := CASE WHEN v_url IS NULL THEN NULL
        ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_url), '') END;
      v_identity_value := COALESCE(
        v_uid_identity,
        v_url_identity,
        NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_target_value), '')
      );
      v_allow_alias_resolution := true;
    ELSIF v_target_kind = 'email' THEN
      v_identity_value := lower(v_target_value);
    ELSE
      v_identity_value := v_target_value;
    END IF;
    IF NULLIF(v_identity_value, '') IS NULL THEN
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    v_candidate_key := v_scope || ':' || v_target_kind || ':' || v_identity_value;
    v_aliases := array_append(v_aliases, v_candidate_key);
    IF v_target_kind LIKE 'facebook_%' AND v_uid_identity IS NOT NULL THEN
      v_aliases := array_append(
        v_aliases, v_scope || ':' || v_target_kind || ':' || v_uid_identity
      );
    END IF;
    IF v_target_kind LIKE 'facebook_%' AND v_url_identity IS NOT NULL THEN
      v_aliases := array_append(
        v_aliases, v_scope || ':' || v_target_kind || ':' || v_url_identity
      );
    END IF;

    SELECT COALESCE(array_agg(DISTINCT alias.canonical_target_key), '{}'::text[])
    INTO v_mapped_keys
    FROM public.auto_campaign_input_target_aliases AS alias
    WHERE alias.campaign_id = v_campaign.id
      AND alias.alias_key = ANY(v_aliases);

    IF cardinality(v_mapped_keys) > 1
      OR (
        cardinality(v_mapped_keys) = 1
        AND NOT v_allow_alias_resolution
        AND v_mapped_keys[1] IS DISTINCT FROM v_candidate_key
      )
    THEN
      UPDATE public.auto_campaign_input_target_aliases AS alias
      SET conflict_count = alias.conflict_count + 1,
          last_conflict_at = now(),
          last_conflict_payload = jsonb_build_object(
            'membershipId', v_member.id,
            'candidateCanonicalKey', v_candidate_key,
            'mappedCanonicalKeys', to_jsonb(v_mapped_keys),
            'aliases', to_jsonb(v_aliases),
            'snapshotBatchId', v_batch.id
          ),
          updated_at = now()
      WHERE alias.campaign_id = v_campaign.id
        AND alias.alias_key = ANY(v_aliases);
      v_conflict := v_conflict + 1;
      CONTINUE;
    END IF;

    v_canonical_key := CASE
      WHEN v_allow_alias_resolution AND cardinality(v_mapped_keys) = 1
        THEN v_mapped_keys[1]
      ELSE v_candidate_key
    END;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', COALESCE(v_name, v_target_value),
      'phone', v_input_phone,
      'phone_carrier', v_phone_carrier,
      'uid', v_input_uid,
      'email', v_input_email,
      'info1', v_info1,
      'info2', v_info2,
      'info3', v_info3,
      'info4', v_info4,
      'info5', v_info5,
      'contact_id', v_contact.id,
      'membership_id', v_member.id,
      'source_account_id', v_contact.account_id,
      'contact_type', v_contact.contact_type,
      'flatform_type', v_contact.flatform_type,
      'canonical_target_key', v_canonical_key,
      'snapshot_group_id', v_group.id,
      'snapshot_group_revision', v_group.revision
    ));

    -- Reuse order for one-time snapshots:
    --   1. the active canonical row;
    --   2. an active row already mapped by one of this target's aliases;
    --   3. the oldest active legacy row whose action target normalizes equally;
    --   4. a newly inserted canonical row.
    -- Legacy rows remain canonical_target_key=NULL.  Aliases and immutable
    -- origin provenance below make every later snapshot resolve to that row.
    SELECT input_data.id
    INTO v_input_id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND input_data.canonical_target_key = v_canonical_key
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    LIMIT 1
    FOR UPDATE;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_target_aliases AS alias
      JOIN public.auto_campaign_input_data AS input_data
        ON input_data.id = alias.input_data_id
       AND input_data.campaign_id = v_campaign.id
       AND COALESCE(input_data.is_delete, false) = false
       AND (
         input_data.canonical_target_key IS NULL
         OR input_data.canonical_target_key = v_canonical_key
       )
      WHERE alias.campaign_id = v_campaign.id
        AND alias.canonical_target_key = v_canonical_key
        AND alias.alias_key = ANY(v_aliases)
        -- Recheck the current target under the input lock. An edit may have
        -- released an alias after this statement took its MVCC snapshot.
        AND CASE
          WHEN v_target_kind = 'phone' THEN
            public.aka_agent_internal_normalize_phone(
              COALESCE(input_data.phone, '')
            ) = v_identity_value
          WHEN v_target_kind = 'email' THEN
            lower(btrim(COALESCE(input_data.email, ''))) = v_identity_value
          WHEN v_target_kind LIKE 'facebook_%' THEN
            (
              v_scope || ':' || v_target_kind || ':' ||
              public.aka_agent_internal_normalize_facebook_identity(
                COALESCE(input_data.uid, '')
              )
            ) = ANY(v_aliases)
          ELSE
            btrim(COALESCE(input_data.uid, '')) = v_identity_value
        END
      ORDER BY input_data.id
      LIMIT 1
      FOR UPDATE OF input_data;
    END IF;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_campaign.id
        AND input_data.canonical_target_key IS NULL
        AND COALESCE(input_data.is_delete, false) = false
        AND CASE
          WHEN v_target_kind = 'phone' THEN
            public.aka_agent_internal_normalize_phone(
              COALESCE(input_data.phone, '')
            ) = v_identity_value
          WHEN v_target_kind = 'email' THEN
            lower(btrim(COALESCE(input_data.email, ''))) = v_identity_value
          WHEN v_target_kind LIKE 'facebook_%' THEN
            (
              v_scope || ':' || v_target_kind || ':' ||
              public.aka_agent_internal_normalize_facebook_identity(
                COALESCE(input_data.uid, '')
              )
            ) = ANY(v_aliases)
          ELSE
            btrim(COALESCE(input_data.uid, '')) = v_identity_value
        END
      ORDER BY input_data.id
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_input_id IS NULL THEN
      INSERT INTO public.auto_campaign_input_data (
        campaign_id, input_id, name, phone, phone_carrier, uid, email,
        info1, info2, info3, info4, info5, status, schedule, is_delete,
        canonical_target_key, created_at
      ) VALUES (
        v_campaign.id, NULL, COALESCE(v_name, v_target_value),
        v_input_phone, v_phone_carrier, v_input_uid, v_input_email,
        v_info1, v_info2, v_info3, v_info4, v_info5,
        'chờ xử lý', p_campaign_schedule, false,
        v_canonical_key, now()
      )
      ON CONFLICT (campaign_id, canonical_target_key)
        WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false
      DO NOTHING
      RETURNING id INTO v_input_id;

      IF v_input_id IS NULL THEN
        SELECT input_data.id
        INTO v_input_id
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND input_data.canonical_target_key = v_canonical_key
          AND COALESCE(input_data.is_delete, false) = false
        FOR UPDATE;
      ELSE
        v_inserted_row := true;
      END IF;
    END IF;

    INSERT INTO public.auto_campaign_input_target_aliases (
      campaign_id, alias_key, canonical_target_key, input_data_id
    )
    SELECT v_campaign.id, candidate.alias_key, v_canonical_key, v_input_id
    FROM (SELECT DISTINCT unnest(v_aliases) AS alias_key) AS candidate
    ON CONFLICT (campaign_id, alias_key) DO UPDATE
    SET input_data_id = EXCLUDED.input_data_id,
        updated_at = now()
    WHERE auto_campaign_input_target_aliases.canonical_target_key
      = EXCLUDED.canonical_target_key;

    INSERT INTO public.auto_campaign_input_origins (
      input_data_id, source_id, group_id, membership_id, batch_id,
      origin_kind, group_revision, canonical_target_key, payload_snapshot
    ) VALUES (
      v_input_id, NULL, v_group.id, v_member.id, v_batch.id,
      'group', v_group.revision, v_canonical_key, v_payload
    ) ON CONFLICT DO NOTHING;

    IF v_inserted_row THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_existing := v_existing + 1;
    END IF;
  END LOOP;

  IF v_inserted > 0 THEN
    UPDATE public.auto_campaigns AS campaign
    SET schedule = p_campaign_schedule,
        original_schedule = p_campaign_schedule,
        status = p_campaign_status,
        note = CASE
          WHEN campaign.note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
          ELSE campaign.note
        END,
        updated_at = now()
    WHERE campaign.id = v_campaign.id;
  END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'campaign_id', v_campaign.id,
    'group_id', v_group.id,
    'group_revision', v_group.revision,
    'active_membership_count', v_active,
    'inserted_count', v_inserted,
    'already_seen_count', v_existing,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict
  );

  UPDATE public.auto_data_ingest_batches AS batch
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE batch.id = v_batch.id;

  RETURN v_result;
END;
$function$;$definition$; END IF;
END;
$replace$;

DO $replace$
BEGIN
  IF to_regprocedure('public.aka_agent_release_changed_direct_input_identity()') IS NULL
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_release_changed_direct_input_identity()'))) <> 'f0661981a4b9e4c77635a4da16e43027'
  THEN EXECUTE $definition$CREATE OR REPLACE FUNCTION public.aka_agent_release_changed_direct_input_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_action text;
  v_mode text;
  v_old_phone text;
  v_new_phone text;
  v_identity_changed boolean := false;
BEGIN
  -- Integrity maintenance only: callers never receive write access to aliases.
  IF TG_RELID <> 'public.auto_campaign_input_data'::regclass
    OR TG_OP <> 'UPDATE' OR TG_WHEN <> 'BEFORE'
  THEN
    RAISE EXCEPTION 'direct_input_identity_invalid_trigger_context';
  END IF;

  SELECT campaign.action_id, campaign.data_target_source_mode
  INTO v_action, v_mode
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = OLD.campaign_id;
  IF v_mode IS DISTINCT FROM 'direct' THEN RETURN NEW; END IF;

  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
  THEN
    v_identity_changed := true;
  ELSIF v_action IN ('zalo_message_phone', 'zalo_add_group_member') THEN
    v_old_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(OLD.phone, '')), '');
    v_new_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(NEW.phone, '')), '');
    v_identity_changed := v_new_phone IS DISTINCT FROM v_old_phone;
    IF v_action = 'zalo_add_group_member' AND v_old_phone IS NULL AND v_new_phone IS NULL THEN
      v_identity_changed := NULLIF(btrim(NEW.uid), '') IS DISTINCT FROM NULLIF(btrim(OLD.uid), '');
    END IF;
  ELSIF v_action = 'email_send' THEN
    v_identity_changed := NULLIF(lower(btrim(NEW.email)), '')
      IS DISTINCT FROM NULLIF(lower(btrim(OLD.email)), '');
  ELSIF v_action LIKE 'facebook_%' THEN
    v_identity_changed := NULLIF(public.aka_agent_internal_normalize_facebook_identity(COALESCE(NEW.uid, '')), '')
      IS DISTINCT FROM NULLIF(public.aka_agent_internal_normalize_facebook_identity(COALESCE(OLD.uid, '')), '');
  ELSIF v_action LIKE 'zalo_%' THEN
    v_identity_changed := NULLIF(btrim(NEW.uid), '') IS DISTINCT FROM NULLIF(btrim(OLD.uid), '');
  ELSE
    v_identity_changed := NEW.phone IS DISTINCT FROM OLD.phone
      OR NEW.uid IS DISTINCT FROM OLD.uid OR NEW.email IS DISTINCT FROM OLD.email;
  END IF;

  IF v_identity_changed THEN
    -- Keep historical origins/payload_snapshot. A later import must compare the
    -- current target instead of matching this row through its former aliases.
    NEW.canonical_target_key := NULL;
    DELETE FROM public.auto_campaign_input_target_aliases AS alias
    WHERE alias.campaign_id = OLD.campaign_id AND alias.input_data_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;$definition$; END IF;
END;
$replace$;

ALTER FUNCTION public.aka_agent_release_changed_direct_input_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_release_changed_direct_input_identity() FROM PUBLIC, anon, authenticated, service_role;
DO $trigger$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_campaign_input_data'::regclass
    AND tgname='trg_aka_agent_release_changed_direct_input_identity') THEN
    CREATE TRIGGER trg_aka_agent_release_changed_direct_input_identity
    BEFORE UPDATE OF phone, uid, email, is_delete, campaign_id ON public.auto_campaign_input_data
    FOR EACH ROW
    WHEN (OLD.phone IS DISTINCT FROM NEW.phone OR OLD.uid IS DISTINCT FROM NEW.uid
      OR OLD.email IS DISTINCT FROM NEW.email OR OLD.is_delete IS DISTINCT FROM NEW.is_delete
      OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id)
    EXECUTE FUNCTION public.aka_agent_release_changed_direct_input_identity();
  END IF;
END;
$trigger$;

DO $postflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_guard_canonical_campaign_input_payload()')
    AND md5(pg_get_functiondef(p.oid))='2c28a342e22c40b4c3681865263577fe' AND pg_get_userbyid(proowner)='postgres'
    AND prosecdef=false AND provolatile='v' AND proconfig=ARRAY['search_path=public']::text[]
    AND proacl='{postgres=X/postgres,service_role=X/postgres}'::aclitem[])
  THEN RAISE EXCEPTION 'v273: postflight failed for aka_agent_guard_canonical_campaign_input_payload()'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)')
    AND md5(pg_get_functiondef(p.oid))='47bae8503ed1afe6ba1ca79540a55cd5' AND pg_get_userbyid(proowner)='postgres'
    AND prosecdef=true AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
    AND proacl='{postgres=X/postgres}'::aclitem[])
  THEN RAISE EXCEPTION 'v273: postflight failed for aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_release_changed_direct_input_identity()')
    AND md5(pg_get_functiondef(p.oid))='f0661981a4b9e4c77635a4da16e43027' AND pg_get_userbyid(proowner)='postgres'
    AND prosecdef=true AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
    AND proacl='{postgres=X/postgres}'::aclitem[])
  THEN RAISE EXCEPTION 'v273: postflight failed for aka_agent_release_changed_direct_input_identity()'; END IF;
END;
$postflight$;

-- No table/API signature or caller grants changed; no explicit schema reload.
COMMIT;
