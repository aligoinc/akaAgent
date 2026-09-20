-- v289: shared Chat/Desktop tags, disabling stale filters, and preserved contact tombstones.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_data_group_account_available(bigint,bigint,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_account_available(bigint,bigint,bigint)'))) IS DISTINCT FROM 'a1ab32210c3f3cc16b814898fb26315c' THEN RAISE EXCEPTION 'v289 RPC drift: public.aka_agent_data_group_account_available(bigint,bigint,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_data_group_zalo_facts(bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_zalo_facts(bigint)'))) IS DISTINCT FROM '9cac9151db1cd2e208f5f0f160e7100e' THEN RAISE EXCEPTION 'v289 RPC drift: public.aka_agent_data_group_zalo_facts(bigint)'; END IF;
IF to_regprocedure('public.aka_agent_dynamic_filter_chat_event()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_dynamic_filter_chat_event()'))) IS DISTINCT FROM 'edbd8f005e263ac788b2fabef14ba987' THEN RAISE EXCEPTION 'v289 RPC drift: public.aka_agent_dynamic_filter_chat_event()'; END IF;
IF to_regprocedure('public.aka_agent_dynamic_filter_sync_chat_contact()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_dynamic_filter_sync_chat_contact()'))) IS DISTINCT FROM '39e1371dd3430e3b76d4f4a0a90d5a2c' THEN RAISE EXCEPTION 'v289 RPC drift: public.aka_agent_dynamic_filter_sync_chat_contact()'; END IF;
IF to_regprocedure('public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)'))) IS DISTINCT FROM '3dface1e4b48d8c92a5100dadaaf4ebb' THEN RAISE EXCEPTION 'v289 RPC drift: public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)'))) IS DISTINCT FROM '34fd38386ec751146db1e78b06f9195b' THEN RAISE EXCEPTION 'v289 RPC drift: public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)'; END IF;
IF to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))) IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN RAISE EXCEPTION 'v289 RPC drift: public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_refresh_contact_chat_tags(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v289 new RPC already exists: aka_agent_refresh_contact_chat_tags(bigint)'; END IF;
IF to_regprocedure('public.aka_agent_sync_contact_chat_tag_delta()') IS NOT NULL THEN RAISE EXCEPTION 'v289 new RPC already exists: aka_agent_sync_contact_chat_tag_delta()'; END IF;
IF to_regprocedure('public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'v289 new RPC already exists: aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)'; END IF;
END; $preflight$;

-- Keep the Desktop projection current without writing it back into Chat.
CREATE FUNCTION public.aka_agent_refresh_contact_chat_tags(p_contact_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE v_facts jsonb; v_tags bigint[]; v_previous text;
BEGIN
  IF current_setting('aka_agent.chat_tag_writeback',true)='on' THEN RETURN; END IF;
  -- Read canonical tags only after owning the row, so a waiting mirror cannot
  -- overwrite tags committed while it was waiting.
  PERFORM 1 FROM public.auto_account_contacts WHERE id=p_contact_id AND NOT is_delete FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_facts := public.aka_agent_data_group_zalo_facts(p_contact_id);
  IF v_facts->>'chat_conversation_id' IS NULL THEN RETURN; END IF;
  SELECT COALESCE(array_agg(k::bigint ORDER BY k::bigint),'{}'::bigint[])
    INTO v_tags FROM jsonb_array_elements_text(v_facts->'akabiz_tag_keys') k;
  v_previous:=current_setting('aka_agent.chat_tag_projection',true);
  PERFORM set_config('aka_agent.chat_tag_projection','on',true);
  BEGIN
    UPDATE public.auto_account_contacts SET akabiz_tag_ids=v_tags,updated_at=clock_timestamp()
      WHERE id=p_contact_id AND NOT is_delete AND akabiz_tag_ids IS DISTINCT FROM v_tags;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('aka_agent.chat_tag_projection',COALESCE(v_previous,''),true);
    RAISE;
  END;
  PERFORM set_config('aka_agent.chat_tag_projection',COALESCE(v_previous,''),true);
END;
$fn$;

-- Existing Desktop/Server clients PATCH the local array. Apply only their delta
-- to Chat; never replace another staff's tags or resurrect a deleted contact.
CREATE FUNCTION public.aka_agent_sync_contact_chat_tag_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_facts jsonb; v_conversation_id bigint; v_before bigint[];
  v_added bigint[]; v_removed bigint[]; v_previous text;
BEGIN
  IF current_setting('aka_agent.chat_tag_projection',true)='on'
    OR NEW.is_delete OR NEW.flatform_type IS DISTINCT FROM 'zalo' THEN RETURN NEW; END IF;
  v_before := CASE WHEN TG_OP='INSERT' THEN '{}'::bigint[] ELSE COALESCE(OLD.akabiz_tag_ids,'{}'::bigint[]) END;
  IF TG_OP='UPDATE' AND NEW.akabiz_tag_ids IS NOT DISTINCT FROM OLD.akabiz_tag_ids THEN RETURN NEW; END IF;
  v_facts := public.aka_agent_data_group_zalo_facts(NEW.id);
  v_conversation_id := (v_facts->>'chat_conversation_id')::bigint;
  IF v_conversation_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(array_agg(DISTINCT k),'{}'::bigint[]) INTO v_added
    FROM unnest(COALESCE(NEW.akabiz_tag_ids,'{}'::bigint[])) k WHERE NOT k=ANY(v_before);
  SELECT COALESCE(array_agg(DISTINCT k),'{}'::bigint[]) INTO v_removed
    FROM unnest(v_before) k WHERE NOT k=ANY(COALESCE(NEW.akabiz_tag_ids,'{}'::bigint[]));
  IF EXISTS (SELECT 1 FROM unnest(v_added) k WHERE NOT EXISTS (
    SELECT 1 FROM public.auto_contact_tags t WHERE t.id=k AND t.staff_id=NEW.staff_id
      AND t.organization_id=NEW.organization_id AND NOT t.is_delete
      AND (t.auto_account_id IS NULL OR t.auto_account_id=NEW.account_id)
  )) THEN RAISE EXCEPTION 'contact_tag_scope_invalid'; END IF;
  v_previous := current_setting('aka_agent.chat_tag_writeback',true);
  PERFORM set_config('aka_agent.chat_tag_writeback','on',true);
  BEGIN
    DELETE FROM public.chat_zalo_conversation_system_tag link USING public.auto_contact_tags t
      WHERE link.chat_zalo_conversation_id=v_conversation_id AND link.organization_id=NEW.organization_id
        AND link.auto_contact_tag_id=t.id AND t.id=ANY(v_removed)
        AND t.staff_id=NEW.staff_id AND t.organization_id=NEW.organization_id;
    INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id,assigned_by_org_staff_id)
      SELECT NEW.organization_id,v_conversation_id,k,NEW.staff_id FROM unnest(v_added) k
      ON CONFLICT(chat_zalo_conversation_id,auto_contact_tag_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('aka_agent.chat_tag_writeback',COALESCE(v_previous,''),true);
    RAISE;
  END;
  PERFORM set_config('aka_agent.chat_tag_writeback',COALESCE(v_previous,''),true);
  PERFORM public.aka_agent_refresh_contact_chat_tags(NEW.id);
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER trg_aka_agent_sync_contact_chat_tag_delta
AFTER INSERT OR UPDATE OF akabiz_tag_ids ON public.auto_account_contacts
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_sync_contact_chat_tag_delta();

-- Additive tag writes use current DB state, not a client-side array snapshot.
-- Optional credentials also preserve service-role campaign callers.
CREATE FUNCTION public.aka_agent_mutate_contact_tags(
  p_staff_id bigint,p_organization_id bigint,p_contact_ids bigint[],p_tag_ids bigint[],
  p_auth_username text,p_auth_password text,p_mode text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET statement_timeout = '60s'
AS $fn$
DECLARE v_contact public.auto_account_contacts%ROWTYPE; v_facts jsonb; v_tags bigint[];
  v_conversation_id bigint; v_changed integer; v_count integer:=0;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
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
    v_facts := public.aka_agent_data_group_zalo_facts(v_contact.id);
    v_conversation_id := (v_facts->>'chat_conversation_id')::bigint;
    IF v_conversation_id IS NOT NULL THEN
      IF p_mode='add' THEN
        INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id,assigned_by_org_staff_id)
          SELECT p_organization_id,v_conversation_id,k,p_staff_id FROM unnest(v_tags) k
          ON CONFLICT(chat_zalo_conversation_id,auto_contact_tag_id) DO NOTHING;
      ELSE
        DELETE FROM public.chat_zalo_conversation_system_tag
          WHERE chat_zalo_conversation_id=v_conversation_id AND organization_id=p_organization_id AND auto_contact_tag_id=ANY(v_tags);
      END IF;
      GET DIAGNOSTICS v_changed=ROW_COUNT;
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
$fn$;

REVOKE ALL ON FUNCTION public.aka_agent_refresh_contact_chat_tags(bigint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.aka_agent_sync_contact_chat_tag_delta() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text) TO anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.aka_agent_save_data_group_dynamic_filter(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_is_enabled boolean, p_rules jsonb, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_filter_id bigint;
  v_bound_account_id bigint;
  v_rule jsonb;
  v_rule_count integer;
  v_inserted_count integer;
  v_queued_count integer := 0;
  v_group_type_code text;
  v_revision bigint;
  v_effective_from_at timestamptz := clock_timestamp();
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  -- Same key and lock order as the processor: advisory lock, then group row.
  -- This prevents an old queued event from crossing a concurrent rule save.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:' || p_staff_id::text, 0)
  );

  SELECT data_type.code,contact_group.bound_zalo_account_id INTO v_group_type_code,v_bound_account_id
  FROM public.auto_account_contact_groups AS contact_group
  LEFT JOIN public.category_item AS data_type
    ON data_type.id = contact_group.data_type_category_item_id
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE OF contact_group;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF v_group_type_code IS DISTINCT FROM 'zalo_person' THEN
    RAISE EXCEPTION 'dynamic_filter_requires_zalo_person_group';
  END IF;

  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'dynamic_filter_rules_must_be_array';
  END IF;
  v_rule_count := jsonb_array_length(COALESCE(p_rules, '[]'::jsonb));
  IF v_rule_count > 50 THEN RAISE EXCEPTION 'dynamic_filter_rule_limit_exceeded'; END IF;
  IF COALESCE(p_is_enabled, false) AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE rule->>'scope_code' = 'enter'
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_enter_rule_required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE jsonb_typeof(COALESCE(rule->'value_keys', 'null'::jsonb)) <> 'array'
      OR jsonb_typeof(COALESCE(rule->'value_labels', 'null'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_rule_values_invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE jsonb_array_length(rule->'value_keys') NOT BETWEEN 1 AND 50
      OR jsonb_array_length(rule->'value_labels') > 50
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_rule_values_invalid';
  END IF;

  -- Disabling must remain possible after a tag/account becomes unavailable.
  IF COALESCE(p_is_enabled,false) AND v_bound_account_id IS NOT NULL THEN
    IF NOT public.aka_agent_data_group_account_available(v_bound_account_id,p_staff_id,p_organization_id) THEN RAISE EXCEPTION 'data_group_bound_account_invalid'; END IF;
    FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
      PERFORM public.aka_agent_data_group_validate_bound_rule(v_bound_account_id,p_staff_id,p_organization_id,v_rule);
    END LOOP;
  END IF;
  INSERT INTO public.auto_account_contact_group_dynamic_filters (
    group_id, staff_id, organization_id, is_enabled, revision,
    effective_from_at, next_evaluation_at, updated_at
  ) VALUES (
    p_group_id, p_staff_id, p_organization_id, COALESCE(p_is_enabled, false), 1,
    v_effective_from_at, NULL, clock_timestamp()
  )
  ON CONFLICT (group_id) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    revision = public.auto_account_contact_group_dynamic_filters.revision + 1,
    effective_from_at = EXCLUDED.effective_from_at,
    next_evaluation_at = NULL,
    updated_at = clock_timestamp()
  RETURNING id, revision INTO v_filter_id, v_revision;

  DELETE FROM public.auto_account_contact_group_dynamic_filter_rules
  WHERE dynamic_filter_id = v_filter_id;

  WITH raw_rule AS MATERIALIZED (
    SELECT
      input.value AS rule,
      input.ordinality::integer AS ordinality,
      row_number() OVER (
        PARTITION BY input.value->>'scope_code'
        ORDER BY COALESCE((input.value->>'sort_order')::integer, input.ordinality::integer), input.ordinality
      ) AS scope_position
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb))
      WITH ORDINALITY AS input(value, ordinality)
  ), normalized_rule AS MATERIALIZED (
    SELECT
      raw_rule.rule->>'scope_code' AS scope_code,
      CASE WHEN raw_rule.scope_position = 1 THEN 'and'
        ELSE COALESCE(NULLIF(raw_rule.rule->>'join_code', ''), 'and') END AS join_code,
      raw_rule.rule->>'field_code' AS field_code,
      raw_rule.rule->>'operator_code' AS operator_code,
      NULLIF(raw_rule.rule->>'account_id', '')::bigint AS account_id,
      COALESCE((raw_rule.rule->>'sort_order')::integer, raw_rule.ordinality) AS sort_order,
      CASE WHEN raw_rule.rule->>'field_code'='zalo_friend_status' THEN (SELECT jsonb_agg(CASE WHEN k IN ('not_friend','unknown','removed') THEN 'stranger' ELSE k END) FROM jsonb_array_elements_text(raw_rule.rule->'value_keys') k) ELSE raw_rule.rule->'value_keys' END AS value_keys,
      raw_rule.rule->'value_labels' AS value_labels
    FROM raw_rule
  )
  INSERT INTO public.auto_account_contact_group_dynamic_filter_rules (
    dynamic_filter_id,
    scope_category_item_id,
    join_category_item_id,
    field_category_item_id,
    operator_category_item_id,
    account_id,
    sort_order,
    value_keys,
    value_labels
  )
  SELECT
    v_filter_id,
    scope_item.id,
    join_item.id,
    field_item.id,
    operator_item.id,
    normalized_rule.account_id,
    normalized_rule.sort_order,
    normalized_rule.value_keys,
    normalized_rule.value_labels
  FROM normalized_rule
  JOIN public.category_type AS scope_type
    ON scope_type.namespace = 'common' AND scope_type.code = 'data_filter_scope'
  JOIN public.category_item AS scope_item
    ON scope_item.category_type_id = scope_type.id
   AND scope_item.code = normalized_rule.scope_code AND scope_item.is_active = true
  JOIN public.category_type AS join_type
    ON join_type.namespace = 'common' AND join_type.code = 'data_filter_join'
  JOIN public.category_item AS join_item
    ON join_item.category_type_id = join_type.id
   AND join_item.code = normalized_rule.join_code AND join_item.is_active = true
  JOIN public.category_type AS field_type
    ON field_type.namespace = 'common' AND field_type.code = 'data_filter_field'
  JOIN public.category_item AS field_item
    ON field_item.category_type_id = field_type.id
   AND field_item.code = normalized_rule.field_code AND field_item.is_active = true
  JOIN public.category_type AS operator_type
    ON operator_type.namespace = 'common' AND operator_type.code = 'data_filter_operator'
  JOIN public.category_item AS operator_item
    ON operator_item.category_type_id = operator_type.id
   AND operator_item.code = normalized_rule.operator_code AND operator_item.is_active = true
   AND field_item.metadata->'operators' ? operator_item.code
  LEFT JOIN public.auto_accounts AS account
    ON account.id = normalized_rule.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = p_organization_id
   AND account.flatform_type = 'zalo'
  WHERE normalized_rule.account_id IS NULL OR account.id IS NOT NULL;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> v_rule_count THEN
    RAISE EXCEPTION 'dynamic_filter_rule_category_or_account_invalid';
  END IF;

  RETURN jsonb_build_object(
    'filter_id', v_filter_id,
    'group_id', p_group_id,
    'revision', v_revision,
    'rule_count', v_inserted_count,
    'queued_count', v_queued_count,
    'effective_from_at', v_effective_from_at
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_dynamic_filter_sync_chat_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_link public.chat_zalo_account_conversation_tag%ROWTYPE;
  v_reason_id bigint;
BEGIN
  v_link := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_OP = 'UPDATE'
    AND NEW.chat_zalo_account_conversation_id
      IS NOT DISTINCT FROM OLD.chat_zalo_account_conversation_id
    AND NEW.chat_zalo_account_tag_id
      IS NOT DISTINCT FROM OLD.chat_zalo_account_tag_id
  THEN
    RETURN NEW;
  END IF;

  -- Tagging a user in Chat API also materializes the canonical contact needed
  -- by Data Group filtering. Existing descriptive/contact fields are retained.
  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data, is_delete,
    staff_id, organization_id, flatform_type, created_at, updated_at
  )
  SELECT
    binding.auto_account_id::integer,
    'person',
    conversation.zalo_id,
    conversation.zalo_id,
    jsonb_build_object('source', 'chat_zalo_tag'),
    false,
    account.staff_id,
    binding.organization_id,
    'zalo',
    clock_timestamp(),
    clock_timestamp()
  FROM public.chat_zalo_account_conversation AS conversation
  JOIN (
    SELECT v_link.chat_zalo_account_conversation_id AS conversation_id
    UNION
    SELECT OLD.chat_zalo_account_conversation_id
    WHERE TG_OP = 'UPDATE'
  ) AS changed_link ON changed_link.conversation_id = conversation.id
  JOIN public.chat_zalo_account_organization AS binding
    ON binding.chat_zalo_account_id = conversation.chat_zalo_account_id
  JOIN public.auto_accounts AS account
    ON account.id = binding.auto_account_id
   AND account.organization_id = binding.organization_id
  WHERE conversation.conversation_type = 'user'
    AND account.staff_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
      WHERE dynamic_filter.staff_id = account.staff_id
        AND dynamic_filter.organization_id = binding.organization_id
        AND dynamic_filter.is_enabled = true
    )
  ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
    -- A Chat event must never revive a contact explicitly deleted in Desktop.
    updated_at = clock_timestamp();

  SELECT item.id INTO v_reason_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_queue_reason'
    AND item.code = 'zalo_tag_changed' AND item.is_active = true;

  INSERT INTO public.auto_account_contact_dynamic_filter_queue (
    contact_id, staff_id, organization_id, reason_category_item_id, queued_at
  )
  SELECT contact.id, contact.staff_id, contact.organization_id, v_reason_id, clock_timestamp()
  FROM public.chat_zalo_account_conversation AS conversation
  JOIN (
    SELECT v_link.chat_zalo_account_conversation_id AS conversation_id
    UNION
    SELECT OLD.chat_zalo_account_conversation_id
    WHERE TG_OP = 'UPDATE'
  ) AS changed_link ON changed_link.conversation_id = conversation.id
  JOIN public.chat_zalo_account_organization AS binding
    ON binding.chat_zalo_account_id = conversation.chat_zalo_account_id
  JOIN public.auto_account_contacts AS contact
    ON contact.account_id = binding.auto_account_id::integer
   AND contact.contact_type = 'person'
   AND contact.uid = conversation.zalo_id
   AND contact.organization_id = binding.organization_id
  WHERE conversation.conversation_type = 'user'
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
      WHERE dynamic_filter.staff_id = contact.staff_id
        AND dynamic_filter.organization_id = contact.organization_id
        AND dynamic_filter.is_enabled = true
    )
  ON CONFLICT (contact_id) DO UPDATE SET
    reason_category_item_id = EXCLUDED.reason_category_item_id,
    queued_at = LEAST(
      public.auto_account_contact_dynamic_filter_queue.queued_at,
      EXCLUDED.queued_at
    ),
    attempt_count = 0,
    last_error = NULL;
  RETURN v_link;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_dynamic_filter_chat_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_row jsonb; v_old jsonb; v_target record;
BEGIN
  v_row:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_OP='UPDATE' THEN
    v_old:=to_jsonb(OLD);
    IF TG_TABLE_NAME='chat_zalo_account_user' AND v_row->'friendship_status_category_item_id' IS NOT DISTINCT FROM v_old->'friendship_status_category_item_id' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME<>'chat_zalo_account_user' AND (v_row - ARRAY['updated_at','created_at']) IS NOT DISTINCT FROM (v_old - ARRAY['updated_at','created_at']) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='chat_zalo_account_user' THEN
    PERFORM public.aka_agent_enqueue_data_group_chat_user((v_row->>'chat_zalo_account_id')::bigint,v_row->>'zalo_id');
  ELSE
    FOR v_target IN
      SELECT DISTINCT ac.chat_zalo_account_id,ac.zalo_id,c.organization_id,c.id conversation_id,ac.conversation_type
      FROM public.chat_zalo_conversation c JOIN public.chat_zalo_account_conversation ac ON ac.id=c.chat_zalo_account_conversation_id
      WHERE c.id IN ((v_row->>'chat_zalo_conversation_id')::bigint,(v_old->>'chat_zalo_conversation_id')::bigint)
        AND ac.conversation_type IN ('user','group')
    LOOP
      -- Mirror only existing, live contacts; this also works with filters off.
      PERFORM public.aka_agent_refresh_contact_chat_tags(contact.id)
      FROM public.chat_zalo_conversation conv
      JOIN public.chat_zalo_account_organization binding ON binding.id=conv.chat_zalo_account_organization_id AND binding.organization_id=conv.organization_id AND binding.is_active
      JOIN public.auto_accounts account ON account.id=binding.auto_account_id AND account.organization_id=binding.organization_id AND NOT account.is_delete
      JOIN public.auto_account_contacts contact ON contact.account_id=account.id AND contact.staff_id=account.staff_id AND contact.organization_id=conv.organization_id
        AND contact.uid=v_target.zalo_id AND contact.flatform_type='zalo'
        AND contact.contact_type=CASE WHEN v_target.conversation_type='user' THEN 'person' ELSE 'group' END AND NOT contact.is_delete
      WHERE conv.id=v_target.conversation_id;
      IF v_target.conversation_type='user' THEN
        PERFORM public.aka_agent_enqueue_data_group_chat_user(v_target.chat_zalo_account_id,v_target.zalo_id,v_target.organization_id);
        -- The helper may have materialized a new contact after the first mirror.
        PERFORM public.aka_agent_refresh_contact_chat_tags(contact.id)
        FROM public.auto_account_contacts contact
        JOIN public.chat_zalo_account_organization binding ON binding.auto_account_id=contact.account_id AND binding.organization_id=contact.organization_id AND binding.is_active
        WHERE binding.chat_zalo_account_id=v_target.chat_zalo_account_id AND binding.organization_id=v_target.organization_id
          AND contact.uid=v_target.zalo_id AND contact.contact_type='person' AND NOT contact.is_delete;
      END IF;
    END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$function$
;

-- New Data API RPC metadata requires one schema refresh.
NOTIFY pgrst,'reload schema';
COMMIT;
