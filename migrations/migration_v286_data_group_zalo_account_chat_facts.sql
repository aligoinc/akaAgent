-- v286: optional Zalo account binding and akaChat facts for Data Groups.
-- Existing RPC definitions below are captured from linked production, not historical bodies.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'))) IS DISTINCT FROM '758ca8404d7913b6cc347d7fb5e2897d' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'; END IF;
IF to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'))) IS DISTINCT FROM '0d5f27ba28557eecc1c75d2adec394a5' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)'))) IS DISTINCT FROM 'e8f05ce4f5fb5b77dfed72e27a8a0f37' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_data_group_dynamic_values_match(bigint,text,text[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_dynamic_values_match(bigint,text,text[])'))) IS DISTINCT FROM '4b479af42dc79aaee0308da2bb36276f' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_data_group_dynamic_values_match(bigint,text,text[])'; END IF;
IF to_regprocedure('public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint)'))) IS DISTINCT FROM '12a1ccc256fd0fdb79d326c908f524a6' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_data_group_dynamic_rule_matches(bigint,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'))) IS DISTINCT FROM 'e384f8113c0166531de3eacd724d7241' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'; END IF;
IF to_regprocedure('public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)'))) IS DISTINCT FROM '5c8507459cb2dc0e39b2b8906f6047ee' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)'))) IS DISTINCT FROM 'c891b833f9d1624ef60fbd119cb4842c' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_dynamic_filter_sync_chat_contact()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_dynamic_filter_sync_chat_contact()'))) IS DISTINCT FROM '56b901cd4d2751f250ff3d0e7ff85cd3' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_dynamic_filter_sync_chat_contact()'; END IF;
IF to_regprocedure('public.aka_agent_create_data_group(bigint,bigint,text,text,text,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_create_data_group(bigint,bigint,text,text,text,bigint)'))) IS DISTINCT FROM '591c4a312eafb4968c34e47cd2bbd0e5' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_create_data_group(bigint,bigint,text,text,text,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,bigint,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,bigint,boolean)'))) IS DISTINCT FROM 'b077c1ae61c53a5115632ad64d3a2d92' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,bigint,boolean)'; END IF;
IF to_regprocedure('public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)'))) IS DISTINCT FROM 'd4d42baec8810c79db4090b982a100e9' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)'; END IF;
IF to_regprocedure('public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)'))) IS DISTINCT FROM '4564edccd0be59ea0f9563367859f3d3' THEN RAISE EXCEPTION 'v286 RPC drift: aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_data_group_account_available(bigint,bigint,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_data_group_account_available(bigint,bigint,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_data_group_zalo_facts(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_data_group_zalo_facts(bigint)'; END IF;
IF to_regprocedure('public.aka_agent_data_group_validate_bound_rule(bigint,bigint,bigint,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_data_group_validate_bound_rule(bigint,bigint,bigint,jsonb)'; END IF;
IF to_regprocedure('public.aka_agent_guard_data_group_bound_account()') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_guard_data_group_bound_account()'; END IF;
IF to_regprocedure('public.aka_agent_guard_data_group_bound_member()') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_guard_data_group_bound_member()'; END IF;
IF to_regprocedure('public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_dynamic_filter_chat_event()') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_dynamic_filter_chat_event()'; END IF;
IF to_regprocedure('public.aka_agent_guard_bound_data_group_source()') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_guard_bound_data_group_source()'; END IF;
IF to_regprocedure('public.aka_agent_create_data_group_v2_internal(bigint,bigint,text,text,text,bigint,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_create_data_group_v2_internal(bigint,bigint,text,text,text,bigint,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_create_data_group_v2(bigint,bigint,text,text,text,bigint,bigint,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_create_data_group_v2(bigint,bigint,text,text,text,bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)'; END IF;
IF to_regprocedure('public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'v286 new signature already exists: aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)'; END IF;
END; $preflight$;

ALTER TABLE public.auto_account_contact_groups
  ADD COLUMN bound_zalo_account_id bigint REFERENCES public.auto_accounts(id) ON DELETE RESTRICT;
CREATE INDEX idx_data_group_bound_zalo_account ON public.auto_account_contact_groups(bound_zalo_account_id)
  WHERE bound_zalo_account_id IS NOT NULL AND is_delete = false;

CREATE FUNCTION public.aka_agent_data_group_account_available(p_account_id bigint, p_staff_id bigint, p_organization_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.auto_accounts a
    JOIN LATERAL private.resolve_organization_zalo_entitlement_pools(p_organization_id) e
      ON e.account_subtype = CASE WHEN a.is_zalo_show_web THEN 'web' WHEN a.is_zalo_server THEN 'server' ELSE 'qr' END
      AND e.entitlement_id IS NOT NULL
    WHERE a.id = p_account_id AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
      AND a.flatform_type = 'zalo' AND a.is_delete = false
  );
$$;

-- One canonical read projection, shared by list/search/status and the event filter.
CREATE FUNCTION public.aka_agent_data_group_zalo_facts(p_contact_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'zalo_name', CASE WHEN c.flatform_type = 'zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),c.name) END,
    'display_name', CASE WHEN c.flatform_type = 'zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),c.name) END,
    'zalo_friend_status', CASE WHEN c.flatform_type = 'zalo' AND c.contact_type = 'person' THEN
      CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
        WHEN c.is_friend IS TRUE THEN 'friend'
        WHEN COALESCE(c.extra_data->>'friendRequestReceived',c.extra_data->>'friend_request_received','false') = 'true' THEN 'request_received'
        WHEN COALESCE(c.extra_data->>'friendRequestSent',c.extra_data->>'friend_request_sent','false') = 'true' THEN 'request_sent'
        ELSE 'stranger' END END,
    'chat_account_conversation_id', ac.id,
    'chat_conversation_id', conv.id,
    'zalo_tag_keys', CASE WHEN ac.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(t.zalo_id ORDER BY t.zalo_id)
      FROM public.chat_zalo_account_conversation_tag link JOIN public.chat_zalo_account_tag t
        ON t.id = link.chat_zalo_account_tag_id AND t.chat_zalo_account_id = ac.chat_zalo_account_id
      WHERE link.chat_zalo_account_conversation_id = ac.id
    ),'[]'::jsonb) ELSE NULL END,
    'akabiz_tag_keys', CASE WHEN conv.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(t.id::text ORDER BY t.id)
      FROM public.chat_zalo_conversation_system_tag link JOIN public.auto_contact_tags t ON t.id=link.auto_contact_tag_id
      WHERE link.chat_zalo_conversation_id=conv.id AND link.organization_id=c.organization_id
        AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete
        AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
    ),'[]'::jsonb) ELSE COALESCE((
      SELECT jsonb_agg(t.id::text ORDER BY t.id) FROM public.auto_contact_tags t
      WHERE t.id=ANY(c.akabiz_tag_ids) AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id
        AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
    ),'[]'::jsonb) END
  )
  FROM public.auto_account_contacts c
  LEFT JOIN public.zalo_users z ON z.account_id=c.account_id AND z.zalo_uid=c.uid
    AND z.staff_id=c.staff_id AND z.organization_id=c.organization_id AND c.flatform_type='zalo'
  LEFT JOIN public.chat_zalo_account_organization b ON b.auto_account_id=c.account_id
    AND b.organization_id=c.organization_id AND b.is_active AND c.flatform_type='zalo'
  LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=b.chat_zalo_account_id AND u.zalo_id=c.uid AND c.contact_type='person'
  LEFT JOIN public.category_item status ON status.id=u.friendship_status_category_item_id
  LEFT JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id
    AND ac.zalo_id=c.uid AND ac.conversation_type=CASE WHEN c.contact_type='person' THEN 'user' WHEN c.contact_type='group' THEN 'group' END
  LEFT JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id
    AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
  WHERE c.id=p_contact_id;
$$;

CREATE FUNCTION public.aka_agent_data_group_validate_bound_rule(p_account_id bigint, p_staff_id bigint, p_organization_id bigint, p_rule jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_key text; v_raw text; v_field text := p_rule->>'field_code';
BEGIN
  IF p_account_id IS NULL THEN RETURN; END IF;
  IF NULLIF(p_rule->>'account_id','')::bigint IS NOT NULL AND (p_rule->>'account_id')::bigint <> p_account_id THEN
    RAISE EXCEPTION 'data_group_bound_rule_mismatch';
  END IF;
  FOR v_key IN SELECT jsonb_array_elements_text(COALESCE(p_rule->'value_keys','[]'::jsonb)) LOOP
    v_raw := v_key;
    IF v_field IN ('zalo_tag','zalo_group_membership') AND position(':' IN v_key)>0 THEN
      IF split_part(v_key,':',1) <> p_account_id::text THEN RAISE EXCEPTION 'data_group_bound_rule_mismatch'; END IF;
      v_raw := substring(v_key FROM position(':' IN v_key)+1);
    END IF;
    IF v_field='akabiz_tag' AND NOT EXISTS (
      SELECT 1 FROM public.auto_contact_tags t WHERE t.id::text=v_raw AND t.staff_id=p_staff_id
        AND t.organization_id=p_organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=p_account_id)
    ) THEN RAISE EXCEPTION 'data_group_bound_rule_mismatch'; END IF;
    IF v_field='zalo_tag' AND NOT EXISTS (
      SELECT 1 FROM public.chat_zalo_account_tag t JOIN public.chat_zalo_account_organization b ON b.chat_zalo_account_id=t.chat_zalo_account_id
      WHERE b.auto_account_id=p_account_id AND b.organization_id=p_organization_id AND b.is_active AND t.zalo_id=v_raw
      UNION ALL
      SELECT 1 FROM public.auto_account_contacts c WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id
        AND c.organization_id=p_organization_id AND c.contact_type='zalo_tag' AND NOT c.is_delete AND c.uid=v_raw
    ) THEN RAISE EXCEPTION 'data_group_bound_rule_mismatch'; END IF;
    IF v_field='zalo_group_membership' AND NOT EXISTS (
      SELECT 1 FROM public.zalo_groups g WHERE g.account_id=p_account_id AND g.staff_id=p_staff_id
        AND g.organization_id=p_organization_id AND g.zalo_group_id=v_raw
    ) THEN RAISE EXCEPTION 'data_group_bound_rule_mismatch'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.aka_agent_guard_data_group_bound_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_type text; v_bad bigint; v_rule record;
BEGIN
  IF TG_OP='UPDATE' AND NEW.bound_zalo_account_id IS NOT DISTINCT FROM OLD.bound_zalo_account_id
    AND NEW.data_type_category_item_id IS NOT DISTINCT FROM OLD.data_type_category_item_id
    AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.bound_zalo_account_id IS DISTINCT FROM OLD.bound_zalo_account_id AND OLD.dataset_sync_mode='dataset_auto' THEN
    RAISE EXCEPTION 'data_group_bound_account_read_only';
  END IF;
  IF NEW.bound_zalo_account_id IS NOT NULL THEN
    SELECT code INTO v_type FROM public.category_item WHERE id=NEW.data_type_category_item_id;
    IF NEW.purpose<>'data_group' OR v_type IS NULL OR v_type NOT IN ('zalo_person','zalo_group') THEN RAISE EXCEPTION 'data_group_bound_type_invalid'; END IF;
    IF NOT public.aka_agent_data_group_account_available(NEW.bound_zalo_account_id,NEW.staff_id,NEW.organization_id) THEN
      RAISE EXCEPTION 'data_group_bound_account_invalid';
    END IF;
    SELECT count(*) INTO v_bad FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id
      WHERE m.group_id=NEW.id AND NOT m.is_delete AND (c.account_id IS DISTINCT FROM NEW.bound_zalo_account_id
        OR EXISTS (SELECT 1 FROM public.auto_account_contact_group_member_origins o WHERE o.membership_id=m.id AND o.is_current AND o.source_account_id IS DISTINCT FROM NEW.bound_zalo_account_id));
    IF v_bad>0 THEN RAISE EXCEPTION 'data_group_bound_members_mismatch:%',v_bad; END IF;
    IF EXISTS (
      SELECT 1 FROM public.auto_automation a LEFT JOIN public.auto_campaigns c ON c.id=a.source_campaign_id
      WHERE a.target_data_group_id=NEW.id AND a.is_active AND NOT a.is_delete AND c.account_id IS DISTINCT FROM NEW.bound_zalo_account_id
    ) THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
    FOR v_rule IN SELECT r.*,f.code field_code FROM public.auto_account_contact_group_dynamic_filters d
      JOIN public.auto_account_contact_group_dynamic_filter_rules r ON r.dynamic_filter_id=d.id
      JOIN public.category_item f ON f.id=r.field_category_item_id WHERE d.group_id=NEW.id
    LOOP
      PERFORM public.aka_agent_data_group_validate_bound_rule(NEW.bound_zalo_account_id,NEW.staff_id,NEW.organization_id,to_jsonb(v_rule));
    END LOOP;
  END IF;
  IF TG_OP='UPDATE' AND NEW.bound_zalo_account_id IS DISTINCT FROM OLD.bound_zalo_account_id THEN
    -- Callers take the dynamic worker advisory lock before the group row lock.
    UPDATE public.auto_account_contact_group_dynamic_filters SET effective_from_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE group_id=NEW.id;
    NEW.revision := NEW.revision+1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_aka_agent_guard_data_group_bound_account BEFORE INSERT OR UPDATE OF bound_zalo_account_id,data_type_category_item_id,staff_id,organization_id
ON public.auto_account_contact_groups FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_data_group_bound_account();

CREATE FUNCTION public.aka_agent_guard_data_group_bound_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_group public.auto_account_contact_groups%ROWTYPE; v_contact public.auto_account_contacts%ROWTYPE; v_group_id bigint; v_contact_id bigint;
BEGIN
  IF TG_TABLE_NAME='auto_account_contact_group_member_origins' THEN
    IF NOT NEW.is_current THEN RETURN NEW; END IF;
    SELECT group_id,contact_id INTO v_group_id,v_contact_id FROM public.auto_account_contact_group_members WHERE id=NEW.membership_id;
  ELSE
    IF NEW.is_delete THEN RETURN NEW; END IF;
    v_group_id:=NEW.group_id; v_contact_id:=NEW.contact_id;
  END IF;
  -- A share lock fences concurrent binding changes, including unbound -> bound.
  SELECT * INTO v_group FROM public.auto_account_contact_groups WHERE id=v_group_id FOR SHARE;
  IF v_group.bound_zalo_account_id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,v_group.staff_id,v_group.organization_id) THEN
    RAISE EXCEPTION 'data_group_bound_account_invalid';
  END IF;
  SELECT * INTO v_contact FROM public.auto_account_contacts WHERE id=v_contact_id;
  IF v_contact.account_id IS DISTINCT FROM v_group.bound_zalo_account_id OR v_contact.staff_id IS DISTINCT FROM v_group.staff_id
    OR v_contact.organization_id IS DISTINCT FROM v_group.organization_id THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
  IF TG_TABLE_NAME='auto_account_contact_group_member_origins' THEN
    IF NEW.source_account_id IS DISTINCT FROM v_group.bound_zalo_account_id THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_aka_agent_guard_data_group_bound_member BEFORE INSERT OR UPDATE OF group_id,contact_id,is_delete ON public.auto_account_contact_group_members FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_data_group_bound_member();
CREATE TRIGGER trg_aka_agent_guard_data_group_bound_origin BEFORE INSERT OR UPDATE OF membership_id,source_account_id,is_current ON public.auto_account_contact_group_member_origins FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_data_group_bound_member();

-- Materialize only the affected contact; enqueue only enabled filters, never scan history.
CREATE FUNCTION public.aka_agent_enqueue_data_group_chat_user(p_chat_account_id bigint,p_uid text,p_organization_id bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_binding record; v_contact_id bigint; v_reason_id bigint;
BEGIN
  SELECT i.id INTO v_reason_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='common' AND t.code='data_filter_queue_reason' AND i.code='contact_changed' AND i.is_active;
  FOR v_binding IN SELECT b.auto_account_id,b.organization_id,a.staff_id FROM public.chat_zalo_account_organization b
    JOIN public.auto_accounts a ON a.id=b.auto_account_id AND a.organization_id=b.organization_id
    WHERE b.chat_zalo_account_id=p_chat_account_id AND b.is_active AND NOT a.is_delete
      AND (p_organization_id IS NULL OR b.organization_id=p_organization_id)
      AND EXISTS(SELECT 1 FROM public.auto_account_contact_group_dynamic_filters f
        WHERE f.staff_id=a.staff_id AND f.organization_id=b.organization_id AND f.is_enabled)
  LOOP
    INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,flatform_type,extra_data,is_delete,staff_id,organization_id)
    SELECT v_binding.auto_account_id::integer,'person',COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),p_uid),p_uid,'zalo','{"source":"chat_zalo_event"}'::jsonb,false,v_binding.staff_id,v_binding.organization_id
    FROM (SELECT 1) seed LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=p_chat_account_id AND u.zalo_id=p_uid
    ON CONFLICT(account_id,contact_type,uid) DO UPDATE SET updated_at=clock_timestamp()
    RETURNING id INTO v_contact_id;
    INSERT INTO public.auto_account_contact_dynamic_filter_queue(contact_id,staff_id,organization_id,reason_category_item_id,queued_at)
    VALUES(v_contact_id,v_binding.staff_id,v_binding.organization_id,v_reason_id,clock_timestamp())
    ON CONFLICT(contact_id) DO UPDATE SET reason_category_item_id=EXCLUDED.reason_category_item_id,
      queued_at=LEAST(public.auto_account_contact_dynamic_filter_queue.queued_at,EXCLUDED.queued_at),attempt_count=0,last_error=NULL;
  END LOOP;
END;
$$;
CREATE FUNCTION public.aka_agent_dynamic_filter_chat_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
      SELECT DISTINCT ac.chat_zalo_account_id,ac.zalo_id,c.organization_id
      FROM public.chat_zalo_conversation c JOIN public.chat_zalo_account_conversation ac ON ac.id=c.chat_zalo_account_conversation_id
      WHERE c.id IN ((v_row->>'chat_zalo_conversation_id')::bigint,(v_old->>'chat_zalo_conversation_id')::bigint)
        AND ac.conversation_type='user'
    LOOP PERFORM public.aka_agent_enqueue_data_group_chat_user(v_target.chat_zalo_account_id,v_target.zalo_id,v_target.organization_id); END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER trg_aka_agent_dynamic_filter_chat_friend AFTER INSERT OR UPDATE OF friendship_status_category_item_id ON public.chat_zalo_account_user FOR EACH ROW EXECUTE FUNCTION public.aka_agent_dynamic_filter_chat_event();
CREATE TRIGGER trg_aka_agent_dynamic_filter_chat_system_tag AFTER INSERT OR UPDATE OR DELETE ON public.chat_zalo_conversation_system_tag FOR EACH ROW EXECUTE FUNCTION public.aka_agent_dynamic_filter_chat_event();

CREATE FUNCTION public.aka_agent_guard_bound_data_group_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_group record; v_source_account_id bigint;
BEGIN
  IF TG_TABLE_NAME='auto_account_contacts' THEN
    IF NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
    FOR v_group IN SELECT g.* FROM public.auto_account_contact_groups g
      WHERE g.bound_zalo_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_account_contact_group_members m WHERE m.group_id=g.id AND m.contact_id=NEW.id AND NOT m.is_delete)
      ORDER BY g.id FOR SHARE
    LOOP
      IF NEW.account_id IS DISTINCT FROM v_group.bound_zalo_account_id OR NEW.staff_id IS DISTINCT FROM v_group.staff_id OR NEW.organization_id IS DISTINCT FROM v_group.organization_id THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
    END LOOP;
  ELSE
    IF NEW.target_data_group_id IS NULL OR NOT NEW.is_active OR NEW.is_delete THEN RETURN NEW; END IF;
    SELECT g.* INTO v_group FROM public.auto_account_contact_groups g WHERE g.id=NEW.target_data_group_id FOR SHARE;
    IF v_group.bound_zalo_account_id IS NULL THEN RETURN NEW; END IF;
    SELECT account_id INTO v_source_account_id FROM public.auto_campaigns WHERE id=NEW.source_campaign_id AND staff_id=NEW.staff_id AND organization_id=NEW.organization_id;
    IF v_source_account_id IS DISTINCT FROM v_group.bound_zalo_account_id OR NEW.staff_id IS DISTINCT FROM v_group.staff_id OR NEW.organization_id IS DISTINCT FROM v_group.organization_id THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_aka_agent_guard_bound_data_group_contact BEFORE UPDATE OF account_id,staff_id,organization_id ON public.auto_account_contacts FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_bound_data_group_source();
CREATE TRIGGER trg_aka_agent_guard_bound_data_group_automation BEFORE INSERT OR UPDATE OF target_data_group_id,source_campaign_id,is_active,is_delete ON public.auto_automation FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_bound_data_group_source();


CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_members_v205_internal(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_search text DEFAULT NULL::text, p_account_ids bigint[] DEFAULT NULL::bigint[], p_include_accountless boolean DEFAULT true, p_contact_types text[] DEFAULT NULL::text[], p_flatform_types text[] DEFAULT NULL::text[], p_status text DEFAULT 'all'::text, p_dataset_ids bigint[] DEFAULT NULL::bigint[], p_ids bigint[] DEFAULT NULL::bigint[], p_exclude_ids bigint[] DEFAULT NULL::bigint[], p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS TABLE(id bigint, group_id bigint, contact_id bigint, name text, uid text, url text, phone text, email text, info1 text, info2 text, info3 text, info4 text, info5 text, contact_type text, flatform_type text, source_account_id bigint, source_account_name text, source_account_deleted boolean, dataset_ids bigint[], dataset_names text[], is_friend boolean, is_joined boolean, is_delete boolean, change_revision bigint, provenance jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, primary_origin_id bigint, source_category_item_id bigint, source_code text, source_name text, source_automation_id bigint, source_automation_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF COALESCE(p_status, 'all') NOT IN (
    'all', 'active', 'inactive', 'friend', 'stranger', 'joined', 'not_joined', 'request_sent', 'request_received'
  )
    OR COALESCE(p_offset, 0) < 0
    OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_data_group_member_query';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      member.id AS selected_member_id,
      member.group_id AS selected_group_id,
      member.contact_id,
      member.created_at AS member_created_at,
      member.updated_at AS member_updated_at,
      member.is_delete AS member_is_delete,
      member.change_revision,
      member.primary_origin_id,
      contact.name,
      contact.uid,
      contact.url,
      contact.phone,
      contact.email,
      contact.extra_data,
      contact.contact_type,
      contact.flatform_type,
      contact.account_id,
      contact.is_friend,
      contact.is_joined,
      account.name AS selected_account_name,
      COALESCE(account.is_delete, false) AS selected_account_deleted
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contacts AS contact
      ON contact.id = member.contact_id
    LEFT JOIN public.auto_accounts AS account
      ON account.id = contact.account_id
    LEFT JOIN LATERAL (SELECT public.aka_agent_data_group_zalo_facts(contact.id) facts) zalo ON contact.flatform_type='zalo'
    WHERE member.group_id = p_group_id
      AND contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND member.is_delete = false
      AND (
        COALESCE(p_status, 'all') = 'all'
        OR (
          COALESCE(p_status, 'all') = 'active' AND (
            (contact.contact_type = 'person' AND contact.is_friend = true)
            OR (contact.contact_type = 'group' AND contact.is_joined = true)
            OR contact.contact_type NOT IN ('person', 'group')
          )
        )
        OR (
          COALESCE(p_status, 'all') = 'inactive' AND (
            (contact.contact_type = 'person' AND contact.is_friend = false)
            OR (contact.contact_type = 'group' AND contact.is_joined = false)
          )
        )
        OR (
          COALESCE(p_status, 'all') = 'friend'
          AND contact.contact_type = 'person'
          AND CASE WHEN contact.flatform_type='zalo' THEN zalo.facts->>'zalo_friend_status'='friend' ELSE contact.is_friend=true END
        )
        OR (
          COALESCE(p_status, 'all') = 'stranger'
          AND contact.contact_type = 'person'
          AND CASE WHEN contact.flatform_type='zalo' THEN zalo.facts->>'zalo_friend_status'='stranger' ELSE contact.is_friend=false END
        )
        OR (p_status IN ('request_sent','request_received') AND contact.flatform_type='zalo' AND contact.contact_type='person' AND zalo.facts->>'zalo_friend_status'=p_status)
        OR (
          COALESCE(p_status, 'all') = 'joined'
          AND contact.contact_type = 'group'
          AND contact.is_joined = true
        )
        OR (
          COALESCE(p_status, 'all') = 'not_joined'
          AND contact.contact_type = 'group'
          AND contact.is_joined = false
        )
      )
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR contact.name ILIKE '%' || btrim(p_search) || '%'
        OR zalo.facts->>'zalo_name' ILIKE '%' || btrim(p_search) || '%'
        OR zalo.facts->>'display_name' ILIKE '%' || btrim(p_search) || '%'
        OR contact.uid ILIKE '%' || btrim(p_search) || '%'
        OR contact.phone ILIKE '%' || btrim(p_search) || '%'
        OR contact.email ILIKE '%' || btrim(p_search) || '%'
      )
      AND (
        p_account_ids IS NULL
        OR contact.account_id = ANY(p_account_ids)
        OR (
          COALESCE(p_include_accountless, true)
          AND contact.account_id IS NULL
        )
      )
      AND (
        COALESCE(p_include_accountless, true)
        OR contact.account_id IS NOT NULL
      )
      AND (
        p_contact_types IS NULL
        OR contact.contact_type = ANY(p_contact_types)
      )
      AND (
        p_flatform_types IS NULL
        OR contact.flatform_type = ANY(p_flatform_types)
      )
      AND (p_ids IS NULL OR member.id = ANY(p_ids))
      AND (
        p_exclude_ids IS NULL
        OR NOT (member.id = ANY(p_exclude_ids))
      )
      AND (
        p_dataset_ids IS NULL OR EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS dataset_origin
          WHERE dataset_origin.membership_id = member.id
            AND dataset_origin.dataset_id = ANY(p_dataset_ids)
            AND dataset_origin.is_current = true
        )
      )
  )
  SELECT
    filtered.selected_member_id,
    filtered.selected_group_id,
    filtered.contact_id,
    filtered.name,
    filtered.uid,
    filtered.url,
    filtered.phone,
    filtered.email,
    NULLIF(filtered.extra_data ->> 'info1', ''),
    NULLIF(filtered.extra_data ->> 'info2', ''),
    NULLIF(filtered.extra_data ->> 'info3', ''),
    NULLIF(filtered.extra_data ->> 'info4', ''),
    NULLIF(filtered.extra_data ->> 'info5', ''),
    filtered.contact_type,
    filtered.flatform_type,
    filtered.account_id::bigint,
    filtered.selected_account_name,
    filtered.selected_account_deleted,
    COALESCE((
      SELECT array_agg(current_dataset.id ORDER BY current_dataset.id)
      FROM (
        SELECT DISTINCT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = origin.dataset_id
        WHERE origin.membership_id = filtered.selected_member_id
          AND origin.is_current = true
          AND dataset.is_delete = false
      ) AS current_dataset
    ), '{}'::bigint[]),
    COALESCE((
      SELECT array_agg(current_dataset.name ORDER BY current_dataset.id)
      FROM (
        SELECT DISTINCT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = origin.dataset_id
        WHERE origin.membership_id = filtered.selected_member_id
          AND origin.is_current = true
          AND dataset.is_delete = false
      ) AS current_dataset
    ), '{}'::text[]),
    filtered.is_friend,
    filtered.is_joined,
    filtered.member_is_delete,
    filtered.change_revision,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', origin.id,
        'membership_id', origin.membership_id,
        'kind', origin.kind,
        'relationship_kind', origin.relationship_kind,
        'dataset_id', origin.dataset_id,
        'batch_id', origin.batch_id,
        'source_account_id', origin.source_account_id,
        'source_account_name', source_account.name,
        'source_account_deleted', COALESCE(source_account.is_delete, false),
        'automation_detail_id', origin.automation_detail_id,
        'automation_id', automation_detail.automation_id,
        'automation_name', automation.name,
        'automation_detail_status', automation_detail.status,
        'source_campaign_id', automation_detail.source_campaign_id,
        'source_campaign_name', source_campaign.name,
        'target_campaign_id', automation_detail.target_campaign_id,
        'target_campaign_name', target_campaign.name,
        'source_name_snapshot', origin.source_name_snapshot,
        'is_current', origin.is_current,
        'created_at', origin.created_at,
        'updated_at', origin.updated_at
      ) ORDER BY origin.created_at, origin.id)
      FROM public.auto_account_contact_group_member_origins AS origin
      LEFT JOIN public.auto_accounts AS source_account
        ON source_account.id = origin.source_account_id
      LEFT JOIN public.auto_automation_detail AS automation_detail
        ON automation_detail.id = origin.automation_detail_id
      LEFT JOIN public.auto_automation AS automation
        ON automation.id = automation_detail.automation_id
      LEFT JOIN public.auto_campaigns AS source_campaign
        ON source_campaign.id = automation_detail.source_campaign_id
      LEFT JOIN public.auto_campaigns AS target_campaign
        ON target_campaign.id = automation_detail.target_campaign_id
      WHERE origin.membership_id = filtered.selected_member_id
    ), '[]'::jsonb),
    filtered.member_created_at,
    filtered.member_updated_at,
    primary_source.primary_origin_id,
    primary_source.source_category_item_id,
    primary_source.source_code,
    primary_source.source_name,
    primary_source.source_automation_id,
    primary_source.source_automation_name,
    count(*) OVER ()::bigint
  FROM filtered
  LEFT JOIN LATERAL (
    SELECT
      primary_origin.id AS primary_origin_id,
      category_item.id AS source_category_item_id,
      category_item.code AS source_code,
      category_item.name AS source_name,
      automation.id AS source_automation_id,
      CASE WHEN category_item.code = 'automation' THEN COALESCE(
        NULLIF(btrim(automation.name), ''),
        NULLIF(btrim(primary_origin.source_name_snapshot), '')
      ) END AS source_automation_name
    FROM public.auto_account_contact_group_member_origins AS primary_origin
    JOIN public.category_item AS category_item
      ON category_item.id = primary_origin.source_category_item_id
     AND category_item.is_active = true
     AND category_item.managed_by = 'system'
     AND category_item.code =
       public.aka_agent_data_group_source_code(primary_origin.kind)
    JOIN public.category_type AS category_type
      ON category_type.id = category_item.category_type_id
     AND category_type.namespace = 'common'
     AND category_type.code = 'data_source'
     AND category_type.managed_by = 'system'
     AND category_type.is_active = true
    LEFT JOIN public.auto_automation_detail AS automation_detail
      ON automation_detail.id = primary_origin.automation_detail_id
     AND automation_detail.staff_id = p_staff_id
     AND automation_detail.organization_id = p_organization_id
    LEFT JOIN public.auto_automation AS automation
      ON automation.id = automation_detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    WHERE primary_origin.id = filtered.primary_origin_id
      AND primary_origin.membership_id = filtered.selected_member_id
      AND primary_origin.is_current = true
    LIMIT 1
  ) AS primary_source ON true
  ORDER BY filtered.member_created_at DESC, filtered.selected_member_id DESC
  OFFSET COALESCE(p_offset, 0)
  LIMIT COALESCE(p_limit, 100);
END;
$function$
;


CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group_v186_internal(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint DEFAULT NULL::bigint, p_dataset_name text DEFAULT NULL::text, p_import_source text DEFAULT NULL::text, p_source_account_id bigint DEFAULT NULL::bigint, p_source_name text DEFAULT NULL::text, p_payload_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_source_account public.auto_accounts%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_row record;
  v_source record;
  v_raw_account_id text;
  v_raw_contact_id text;
  v_raw_automation_detail_id text;
  v_origin_automation_detail_id bigint;
  v_row_account_id bigint;
  v_contact_type text;
  v_platform text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_extra jsonb;
  v_dataset_contact_type text;
  v_dataset_platform text;
  v_dataset_source_key text;
  v_dataset_display_name text;
  v_duplicate_in_batch boolean := false;
  v_duplicate_conflict boolean := false;
  v_member_found boolean := false;
  v_batch_seen jsonb := '{}'::jsonb;
  v_first_payload jsonb;
  v_current_payload jsonb;
  v_request_hash text;
  v_revision bigint;
  v_revision_started boolean := false;
  v_inserted_members integer := 0;
  v_reactivated_members integer := 0;
  v_existing_members integer := 0;
  v_removed_members integer := 0;
  v_inserted_inputs integer := 0;
  v_existing_inputs integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_invalid integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_outcome jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
    OR p_kind NOT IN ('manual', 'upload', 'scan', 'automation', 'api')
    OR jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_rows) > 10000
    OR (p_import_source IS NOT NULL AND p_import_source NOT IN ('textbox', 'image', 'sheet', 'excel'))
  THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  IF p_source_account_id IS NOT NULL THEN
    SELECT * INTO v_source_account
    FROM public.auto_accounts AS account
    WHERE account.id = p_source_account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_source_account_not_found'; END IF;
  END IF;

  IF v_group.bound_zalo_account_id IS NOT NULL THEN
    IF NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id) THEN RAISE EXCEPTION 'data_group_bound_account_invalid'; END IF;
    IF (p_source_account_id IS NOT NULL AND p_source_account_id<>v_group.bound_zalo_account_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NULLIF(r->>'source_account_id','') IS NOT NULL AND r->>'source_account_id'<>v_group.bound_zalo_account_id::text)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.auto_account_contacts c ON c.id::text=r->>'contact_id'
        WHERE NULLIF(r->>'contact_id','') IS NOT NULL AND (c.id IS NULL OR c.account_id IS DISTINCT FROM v_group.bound_zalo_account_id OR c.staff_id IS DISTINCT FROM p_staff_id OR c.organization_id IS DISTINCT FROM p_organization_id))
      OR (p_dataset_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_account_contacts_dataset d WHERE d.id=p_dataset_id AND d.account_id IS DISTINCT FROM v_group.bound_zalo_account_id))
    THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'ingest', 'groupId', p_group_id, 'kind', p_kind,
    'rows', p_rows, 'datasetId', p_dataset_id, 'datasetName', p_dataset_name,
    'importSource', p_import_source, 'sourceAccountId', p_source_account_id,
    'sourceName', p_source_name
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, dataset_id, source_account_id,
    source_name, client_payload_hash, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'ingest', p_group_id, p_kind, p_dataset_id,
    p_source_account_id, NULLIF(btrim(COALESCE(p_source_name, '')), ''),
    NULLIF(btrim(COALESCE(p_payload_hash, '')), ''), v_request_hash, 'processing',
    p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT * INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'ingest' OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  p_source_account_id := COALESCE(p_source_account_id,v_group.bound_zalo_account_id);
  IF p_source_account_id IS NOT NULL THEN SELECT * INTO v_source_account FROM public.auto_accounts WHERE id=p_source_account_id; END IF;
  IF p_kind = 'upload' THEN
    v_dataset_display_name := COALESCE(
      NULLIF(btrim(COALESCE(p_dataset_name, '')), ''),
      NULLIF(btrim(COALESCE(p_source_name, '')), ''),
      v_group.name
    );
    IF length(v_dataset_display_name) > 255 THEN
      RAISE EXCEPTION 'invalid_data_group_dataset_name';
    END IF;
    -- The explicit dataset name is the logical identity.  When absent, the
    -- source filename/name becomes that identity. A changed physical filename
    -- therefore still refreshes the same named dataset.
    v_dataset_source_key := 'upload:'
      || lower(regexp_replace(v_dataset_display_name, '[[:space:]]+', ' ', 'g'));

    WITH row_types AS (
      SELECT DISTINCT lower(btrim(item.value ->> 'contact_type')) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
        AND lower(btrim(COALESCE(item.value ->> 'contact_type', ''))) IN (
          'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
          'phone', 'email', 'campaign_input'
        )
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'campaign_input' END
    INTO v_dataset_contact_type
    FROM row_types;

    WITH row_platforms AS (
      SELECT DISTINCT lower(btrim(COALESCE(
        NULLIF(item.value ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN lower(btrim(item.value ->> 'contact_type')) = 'email' THEN 'email' END,
        ''
      ))) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
    ), valid_platforms AS (
      SELECT value FROM row_platforms
      WHERE value IN ('facebook', 'zalo', 'email', 'sms')
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'mixed' END
    INTO v_dataset_platform
    FROM valid_platforms;
  END IF;

  IF p_dataset_id IS NOT NULL THEN
    SELECT * INTO v_dataset
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = p_dataset_id
      AND dataset.staff_id = p_staff_id
      AND dataset.organization_id = p_organization_id
      AND dataset.is_delete = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_dataset_not_found'; END IF;
    IF p_kind = 'upload' AND (
      v_dataset.source <> 'upload' OR v_dataset.group_id IS DISTINCT FROM v_group.id
    ) THEN
      RAISE EXCEPTION 'data_group_upload_dataset_mismatch';
    END IF;
    IF p_kind = 'upload' THEN
      UPDATE public.auto_account_contacts_dataset_members
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
      UPDATE public.auto_account_contact_group_member_origins
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
    END IF;
  ELSIF p_kind = 'upload' THEN
    INSERT INTO public.auto_account_contacts_dataset (
      name, link, description, source, account_id, group_id, flatform_type,
      contact_type, scan_type, source_key, last_scanned_at, last_scan_status,
      extra_data, contact_count, is_delete, staff_id, organization_id
    ) VALUES (
      v_dataset_display_name,
      NULL, NULL, 'upload', p_source_account_id, v_group.id,
      COALESCE(v_dataset_platform, 'mixed'),
      COALESCE(v_dataset_contact_type, 'campaign_input'),
      'upload_data', v_dataset_source_key, now(), 'completed',
      jsonb_strip_nulls(jsonb_build_object(
        'importSource', p_import_source, 'requestId', btrim(p_request_id)
      )),
      0, false, p_staff_id, p_organization_id
    )
    ON CONFLICT (
      staff_id, organization_id, group_id, COALESCE(account_id, 0::bigint),
      flatform_type, contact_type, scan_type, lower(btrim(source_key))
    )
      WHERE is_delete = false AND source = 'upload' AND group_id IS NOT NULL
    DO UPDATE SET
      name = EXCLUDED.name,
      extra_data = COALESCE(auto_account_contacts_dataset.extra_data, '{}'::jsonb)
        || EXCLUDED.extra_data,
      updated_at = now(), last_scanned_at = now(), last_scan_status = 'completed'
    RETURNING * INTO v_dataset;

    -- Re-import refreshes one logical dataset snapshot. Historical batch and
    -- origin rows remain, but only incoming contacts are current afterward.
    UPDATE public.auto_account_contacts_dataset_members
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;
    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;

    UPDATE public.auto_data_ingest_batches
    SET dataset_id = v_dataset.id, updated_at = now()
    WHERE id = v_batch.id;
  END IF;

  FOR v_row IN
    SELECT item.value AS payload, item.ordinality::integer AS row_index
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    v_duplicate_in_batch := false;
    v_duplicate_conflict := false;
    v_member_found := false;
    v_origin_automation_detail_id := NULL;
    v_contact_type := NULL;
    v_platform := NULL;
    v_name := NULL;
    v_uid := NULL;
    v_url := NULL;
    v_phone := NULL;
    v_email := NULL;
    v_extra := '{}'::jsonb;
    IF jsonb_typeof(v_row.payload) <> 'object' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    v_raw_account_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'source_account_id', '')), '');
    IF v_raw_account_id IS NOT NULL AND v_raw_account_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    v_row_account_id := COALESCE(
      CASE WHEN v_raw_account_id IS NULL THEN NULL ELSE v_raw_account_id::bigint END,
      p_source_account_id
    );
    v_contact := NULL;

    v_raw_contact_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'contact_id', '')), '');
    IF v_raw_contact_id IS NOT NULL AND v_raw_contact_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    IF v_raw_contact_id IS NOT NULL THEN
      SELECT * INTO v_contact
      FROM public.auto_account_contacts AS contact
      WHERE contact.id = v_raw_contact_id::bigint
        AND contact.staff_id = p_staff_id
        AND contact.organization_id = p_organization_id
      FOR UPDATE;
      IF NOT FOUND OR (
        v_row_account_id IS NOT NULL
        AND v_contact.account_id IS DISTINCT FROM v_row_account_id
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_row_account_id := COALESCE(v_row_account_id, v_contact.account_id);
      -- Selecting an existing source contact only changes group membership;
      -- it must never resurrect the source contact's own lifecycle flag.
      v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
      v_platform := NULLIF(lower(btrim(COALESCE(v_contact.flatform_type, ''))), '');
      v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
      v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
      v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
      v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_contact.phone, ''), NULLIF(v_contact.extra_data ->> 'phone', ''),
        CASE WHEN v_contact.contact_type = 'phone' THEN v_contact.uid END, ''
      )), '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_contact.email, ''), NULLIF(v_contact.extra_data ->> 'email', ''),
        CASE WHEN v_contact.contact_type = 'email' THEN v_contact.uid END, ''
      ))), '');
      v_extra := COALESCE(v_contact.extra_data, '{}'::jsonb);
    ELSE
      v_contact_type := lower(btrim(COALESCE(v_row.payload ->> 'contact_type', '')));
      IF v_contact_type NOT IN (
        'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
        'phone', 'email', 'campaign_input'
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      IF v_row_account_id IS NOT NULL THEN
        SELECT * INTO v_source_account
        FROM public.auto_accounts AS account
        WHERE account.id = v_row_account_id
          AND account.staff_id = p_staff_id
          AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
        IF NOT FOUND THEN
          v_invalid := v_invalid + 1;
          CONTINUE;
        END IF;
      ELSE
        v_source_account := NULL;
      END IF;

      v_platform := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN v_contact_type = 'email' THEN 'email' ELSE NULL END,
        ''
      ))), '');
      -- Accountless phone/email rows are deliberately platform-neutral.  A
      -- campaign decides portability from the validated value, not this label.
      IF (v_platform IS NULL AND v_contact_type NOT IN ('phone', 'email'))
        OR (v_platform IS NOT NULL AND v_platform NOT IN ('facebook', 'zalo', 'email', 'sms'))
      THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_row.payload ->> 'phone', ''),
        CASE WHEN v_contact_type = 'phone' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ));
      v_phone := NULLIF(v_phone, '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'email', ''),
        CASE WHEN v_contact_type = 'email' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ))), '');
      IF v_email IS NOT NULL AND (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR length(v_email) > 254) THEN
        v_email := NULL;
      END IF;
      v_url := NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), '');
      v_uid := CASE v_contact_type
        WHEN 'phone' THEN v_phone
        WHEN 'email' THEN v_email
        ELSE COALESCE(
          NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
          v_url
        )
      END;
      IF v_uid IS NULL THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_name := COALESCE(NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''), v_uid);
      v_extra := COALESCE(v_row.payload -> 'extra_data', '{}'::jsonb);
      IF jsonb_typeof(v_extra) <> 'object' THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_extra := v_extra || jsonb_strip_nulls(jsonb_build_object(
        'phone', v_phone,
        'email', v_email,
        'info1', NULLIF(v_row.payload ->> 'info1', ''),
        'info2', NULLIF(v_row.payload ->> 'info2', ''),
        'info3', NULLIF(v_row.payload ->> 'info3', ''),
        'info4', NULLIF(v_row.payload ->> 'info4', ''),
        'info5', NULLIF(v_row.payload ->> 'info5', '')
      ));

      IF v_row_account_id IS NULL THEN
        -- Accountless identity is intentionally NOT global. Reuse is allowed
        -- only inside the explicitly supplied dataset; otherwise each row gets
        -- its own canonical contact and campaign delivery dedupe happens later.
        IF v_dataset.id IS NOT NULL THEN
          SELECT contact.* INTO v_contact
          FROM public.auto_account_contacts_dataset_members AS dataset_member
          JOIN public.auto_account_contacts AS contact ON contact.id = dataset_member.contact_id
          WHERE dataset_member.dataset_id = v_dataset.id
            AND contact.account_id IS NULL
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type IS NOT DISTINCT FROM v_platform
            AND contact.contact_type = v_contact_type
            AND contact.uid = v_uid
          ORDER BY dataset_member.created_at, contact.id
          LIMIT 1
          FOR UPDATE OF contact;
        END IF;
        IF v_contact.id IS NULL THEN
          INSERT INTO public.auto_account_contacts (
            account_id, flatform_type, contact_type, name, uid, url, phone, email,
            extra_data, is_delete, staff_id, organization_id, updated_at
          ) VALUES (
            NULL, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
            v_extra, false, p_staff_id, p_organization_id, now()
          ) RETURNING * INTO v_contact;
        ELSE
          UPDATE public.auto_account_contacts AS contact
          SET name = CASE
                WHEN NULLIF(btrim(contact.name), '') IS NULL OR contact.name = contact.uid
                  THEN v_name ELSE contact.name END,
              url = COALESCE(contact.url, v_url),
              phone = COALESCE(contact.phone, v_phone),
              email = COALESCE(contact.email, v_email),
              -- Existing/earlier values win; this only fills absent keys.
              extra_data = v_extra || COALESCE(contact.extra_data, '{}'::jsonb),
              is_delete = false, updated_at = now()
          WHERE contact.id = v_contact.id
          RETURNING * INTO v_contact;
        END IF;
      ELSE
        INSERT INTO public.auto_account_contacts AS existing_contact (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        )
        ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
          flatform_type = COALESCE(existing_contact.flatform_type, EXCLUDED.flatform_type),
          name = CASE
            WHEN NULLIF(btrim(existing_contact.name), '') IS NULL
              OR existing_contact.name = existing_contact.uid THEN EXCLUDED.name
            ELSE existing_contact.name END,
          url = COALESCE(existing_contact.url, EXCLUDED.url),
          phone = COALESCE(existing_contact.phone, EXCLUDED.phone),
          email = COALESCE(existing_contact.email, EXCLUDED.email),
          -- First persisted value wins; later duplicates only fill missing keys.
          extra_data = EXCLUDED.extra_data || COALESCE(existing_contact.extra_data, '{}'::jsonb),
          is_delete = false,
          staff_id = EXCLUDED.staff_id,
          organization_id = EXCLUDED.organization_id,
          updated_at = now()
        RETURNING * INTO v_contact;
      END IF;
    END IF;

    SELECT * INTO v_member
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.contact_id = v_contact.id
    FOR UPDATE;
    v_member_found := FOUND;
    v_current_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''),
      'uid', NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
      'url', NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), ''),
      'phone', NULLIF(public.aka_agent_internal_normalize_phone(
        COALESCE(v_row.payload ->> 'phone', '')
      ), ''),
      'email', NULLIF(lower(btrim(COALESCE(v_row.payload ->> 'email', ''))), ''),
      'info1', NULLIF(v_row.payload ->> 'info1', ''),
      'info2', NULLIF(v_row.payload ->> 'info2', ''),
      'info3', NULLIF(v_row.payload ->> 'info3', ''),
      'info4', NULLIF(v_row.payload ->> 'info4', ''),
      'info5', NULLIF(v_row.payload ->> 'info5', ''),
      'extra_data', CASE WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
        THEN v_row.payload -> 'extra_data' ELSE '{}'::jsonb END
    ));
    v_raw_automation_detail_id := NULLIF(btrim(COALESCE(
      v_row.payload -> 'extra_data' ->> 'automationDetailId',
      v_row.payload ->> 'automation_detail_id',
      ''
    )), '');
    IF p_kind = 'automation'
      AND v_raw_automation_detail_id ~ '^[1-9][0-9]{0,17}$'
    THEN
      SELECT detail.id INTO v_origin_automation_detail_id
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = v_raw_automation_detail_id::bigint
        AND detail.staff_id = p_staff_id
        AND detail.organization_id = p_organization_id;
    END IF;
    v_duplicate_in_batch := v_batch_seen ? v_contact.id::text;

    IF v_duplicate_in_batch THEN
      v_first_payload := v_batch_seen -> v_contact.id::text;
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_each(v_first_payload - 'extra_data') AS first_value(key, value)
        JOIN jsonb_each(v_current_payload - 'extra_data') AS current_value(key, value)
          USING (key)
        WHERE first_value.value IS DISTINCT FROM current_value.value
      ) OR EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(v_first_payload -> 'extra_data', '{}'::jsonb))
          AS first_extra(key, value)
        JOIN jsonb_each(COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb))
          AS current_extra(key, value)
          USING (key)
        WHERE first_extra.value IS DISTINCT FROM current_extra.value
      ) INTO v_duplicate_conflict;

      -- Extend the first-row snapshot only with fields it did not provide.
      v_first_payload := v_current_payload || v_first_payload;
      v_first_payload := jsonb_set(
        v_first_payload,
        '{extra_data}',
        COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb)
          || COALESCE((v_batch_seen -> v_contact.id::text) -> 'extra_data', '{}'::jsonb),
        true
      );
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_first_payload, true
      );
      IF v_duplicate_conflict THEN
        v_conflict := v_conflict + 1;
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row.row_index - 1,
          'code', 'duplicate_identity_conflict',
          'message', 'Dòng trùng định danh có giá trị khác; giữ giá trị của dòng đầu.',
          'contactId', v_contact.id
        ));
      END IF;
    ELSE
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_current_payload, true
      );
    END IF;

    IF NOT v_revision_started THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1, updated_at = now()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;
      v_revision_started := true;
    END IF;

    IF NOT v_member_found THEN
      INSERT INTO public.auto_account_contact_group_members (
        group_id, contact_id, is_delete, change_revision, created_at, updated_at
      ) VALUES (v_group.id, v_contact.id, false, v_revision, now(), now())
      RETURNING * INTO v_member;
      v_inserted_members := v_inserted_members + 1;
    ELSIF v_duplicate_in_batch THEN
      IF NOT v_duplicate_conflict THEN
        v_existing_members := v_existing_members + 1;
      END IF;
    ELSIF v_member.is_delete THEN
      UPDATE public.auto_account_contact_group_members
      SET is_delete = false, change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_reactivated_members := v_reactivated_members + 1;
    ELSE
      UPDATE public.auto_account_contact_group_members
      SET change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_existing_members := v_existing_members + 1;
    END IF;

    INSERT INTO public.auto_account_contact_group_member_origins (
      membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
      source_name_snapshot, relationship_kind, is_current, created_at, updated_at
    ) VALUES (
      v_member.id, p_kind, v_dataset.id, v_batch.id,
      COALESCE(v_row_account_id, v_contact.account_id),
      v_origin_automation_detail_id,
      COALESCE(NULLIF(btrim(COALESCE(p_source_name, '')), ''), v_source_account.name),
      public.aka_agent_validate_data_group_relationship_kind(
        v_member.id,
        COALESCE(v_row_account_id, v_contact.account_id),
        v_dataset.id,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN COALESCE(
              v_row.payload -> 'extra_data' ->> 'relationshipKind',
              v_row.payload -> 'extra_data' ->> 'relationship_kind'
            )
          ELSE NULL
        END,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN v_row.payload -> 'extra_data'
          ELSE '{}'::jsonb
        END
      ),
      CASE
        WHEN v_dataset.id IS NOT NULL AND v_dataset.source = 'scan' THEN EXISTS (
          SELECT 1 FROM public.auto_account_contacts_dataset_members AS dataset_member
          WHERE dataset_member.dataset_id = v_dataset.id
            AND dataset_member.contact_id = v_contact.id
            AND dataset_member.is_current = true
        )
        ELSE true
      END,
      now(), now()
    )
    ON CONFLICT DO NOTHING;

    IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
      INSERT INTO public.auto_account_contacts_dataset_members (
        dataset_id, contact_id, sort_order, is_current,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        v_dataset.id, v_contact.id, GREATEST(v_row.row_index - 1, 0), true,
        now(), now(), now(), now()
      )
      ON CONFLICT (dataset_id, contact_id) DO UPDATE SET
        sort_order = LEAST(auto_account_contacts_dataset_members.sort_order, EXCLUDED.sort_order),
        is_current = true, last_seen_at = now(), updated_at = now();
    END IF;

    FOR v_source IN
      SELECT source.id
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.group_id = v_group.id AND source.status IN ('baselining', 'active')
      ORDER BY source.campaign_id
    LOOP
      v_outcome := public.aka_agent_internal_route_data_group_member(
        v_source.id, v_member.id, v_batch.id, v_revision
      );
      CASE v_outcome ->> 'status'
        WHEN 'inserted' THEN v_inserted_inputs := v_inserted_inputs + 1;
        WHEN 'existing' THEN v_existing_inputs := v_existing_inputs + 1;
        WHEN 'incompatible' THEN v_incompatible := v_incompatible + 1;
        WHEN 'conflict' THEN
          v_conflict := v_conflict + 1;
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'rowIndex', v_row.row_index - 1,
            'code', 'canonical_alias_conflict',
            'message', 'Các định danh của dòng đang trỏ tới nhiều target khác nhau.',
            'aliases', COALESCE(v_outcome -> 'aliases', '[]'::jsonb)
          ));
        ELSE NULL;
      END CASE;
    END LOOP;
  END LOOP;

  IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
    SELECT count(*)::integer INTO v_removed_members
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.is_delete = false
      AND EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
        WHERE historical_origin.membership_id = member.id
          AND historical_origin.dataset_id = v_dataset.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
        WHERE current_origin.membership_id = member.id
          AND current_origin.is_current = true
      );
    IF v_removed_members > 0 THEN
      IF NOT v_revision_started THEN
        UPDATE public.auto_account_contact_groups
        SET revision = revision + 1, updated_at = now()
        WHERE id = v_group.id
        RETURNING revision INTO v_revision;
        v_revision_started := true;
      END IF;
      UPDATE public.auto_account_contact_group_members AS member
      SET is_delete = true, change_revision = v_revision, updated_at = now()
      WHERE member.group_id = v_group.id AND member.is_delete = false
        AND EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
          WHERE historical_origin.membership_id = member.id
            AND historical_origin.dataset_id = v_dataset.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
          WHERE current_origin.membership_id = member.id
            AND current_origin.is_current = true
        );
    END IF;

    UPDATE public.auto_account_contacts_dataset AS dataset
    SET contact_count = (
      SELECT count(*)::integer
      FROM public.auto_account_contacts_dataset_members AS member
      WHERE member.dataset_id = v_dataset.id AND member.is_current = true
    ), updated_at = now()
    WHERE dataset.id = v_dataset.id;
  END IF;
  IF NOT v_revision_started THEN v_revision := v_group.revision; END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'batch_id', v_batch.id,
    'group_id', v_group.id,
    'group_revision', v_revision,
    'inserted_membership_count', v_inserted_members,
    'reactivated_membership_count', v_reactivated_members,
    'already_member_count', v_existing_members,
    'removed_membership_count', v_removed_members,
    'inserted_input_count', v_inserted_inputs,
    'already_seen_input_count', v_existing_inputs,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict,
    'invalid_count', v_invalid,
    'conflicts', v_conflicts
  );
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$function$
;


CREATE OR REPLACE FUNCTION public.aka_agent_duplicate_data_group(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_name text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source public.auto_account_contact_groups%ROWTYPE;
  v_target public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_member_count integer := 0;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  SELECT * INTO v_source
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'invalid_data_group_name';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'duplicate_group', 'groupId', p_group_id,
    'name', COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_source.name || ' (Bản sao)')
  )::text);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NOT NULL THEN
    INSERT INTO public.auto_data_ingest_batches (
      request_id, operation, group_id, request_hash, status, staff_id, organization_id
    ) VALUES (
      btrim(p_request_id), 'duplicate_group', p_group_id, v_request_hash, 'processing',
      p_staff_id, p_organization_id
    )
    ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
    RETURNING * INTO v_batch;
    IF NOT FOUND THEN
      SELECT * INTO v_batch
      FROM public.auto_data_ingest_batches
      WHERE staff_id = p_staff_id AND organization_id = p_organization_id
        AND request_id = btrim(p_request_id)
      FOR UPDATE;
      IF v_batch.operation <> 'duplicate_group' OR v_batch.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    account_id, contact_type, name, purpose, color, sort_order, revision,
    data_type_category_item_id, bound_zalo_account_id, dataset_sync_mode, dataset_sync_key, is_delete, staff_id, organization_id
  ) VALUES (
    NULL, NULL,
    COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_source.name || ' (Bản sao)'),
    'data_group', v_source.color,
    COALESCE((
      SELECT max(contact_group.sort_order) + 1
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
    ), 0),
    CASE WHEN EXISTS (
      SELECT 1 FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_source.id AND member.is_delete = false
    ) THEN 1 ELSE 0 END,
    v_source.data_type_category_item_id, v_source.bound_zalo_account_id, 'manual', NULL,
    false, p_staff_id, p_organization_id
  ) RETURNING * INTO v_target;

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision, created_at, updated_at
  )
  SELECT v_target.id, member.contact_id, false, v_target.revision, now(), now()
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_source.id AND member.is_delete = false;
  GET DIAGNOSTICS v_member_count = ROW_COUNT;

  INSERT INTO public.auto_account_contact_group_member_origins (
    membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
    source_name_snapshot, relationship_kind, data_type_category_item_id, is_current, created_at, updated_at
  )
  SELECT
    target_member.id, origin.kind, origin.dataset_id, origin.batch_id,
    origin.source_account_id, origin.automation_detail_id,
    origin.source_name_snapshot, origin.relationship_kind, origin.data_type_category_item_id, true, now(), now()
  FROM public.auto_account_contact_group_members AS source_member
  JOIN public.auto_account_contact_group_members AS target_member
    ON target_member.group_id = v_target.id
   AND target_member.contact_id = source_member.contact_id
  JOIN public.auto_account_contact_group_member_origins AS origin
    ON origin.membership_id = source_member.id AND origin.is_current = true
  WHERE source_member.group_id = v_source.id AND source_member.is_delete = false
  ON CONFLICT DO NOTHING;

  PERFORM public.aka_agent_sync_copied_data_group_origins(
    source_member.id,
    target_member.id,
    true
  )
  FROM public.auto_account_contact_group_members AS source_member
  JOIN public.auto_account_contact_group_members AS target_member
    ON target_member.group_id = v_target.id
   AND target_member.contact_id = source_member.contact_id
  WHERE source_member.group_id = v_source.id
    AND source_member.is_delete = false
  ORDER BY source_member.id;

  IF v_batch.id IS NOT NULL THEN
    UPDATE public.auto_data_ingest_batches
    SET target_group_id = v_target.id,
        status = 'completed',
        result = to_jsonb(v_target) || public.aka_agent_data_type_json(v_target.data_type_category_item_id) || jsonb_build_object('active_membership_count', v_member_count),
        updated_at = now()
    WHERE id = v_batch.id
    RETURNING result INTO v_batch.result;
    RETURN v_batch.result;
  END IF;
  RETURN to_jsonb(v_target) || public.aka_agent_data_type_json(v_target.data_type_category_item_id) || jsonb_build_object('active_membership_count', v_member_count);
END;
$function$
;


CREATE OR REPLACE FUNCTION public.aka_agent_data_group_dynamic_values_match(p_contact_id bigint, p_field_code text, p_value_keys text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_contact public.auto_account_contacts%ROWTYPE;
  v_friend_status text;
  v_facts jsonb;
  v_result boolean := false;
BEGIN
  IF COALESCE(pg_catalog.array_length(p_value_keys, 1), 0) = 0 THEN
    RETURN false;
  END IF;

  SELECT contact.* INTO v_contact
  FROM public.auto_account_contacts AS contact
  WHERE contact.id = p_contact_id;
  IF NOT FOUND THEN RETURN false; END IF;

  v_facts := public.aka_agent_data_group_zalo_facts(p_contact_id);
  IF p_field_code IN ('zalo_tag','zalo_group_membership') THEN
    SELECT array_agg(CASE WHEN position(':' IN k)>0 THEN substring(k FROM position(':' IN k)+1) ELSE k END)
      INTO p_value_keys FROM unnest(p_value_keys) k
      WHERE position(':' IN k)=0 OR split_part(k,':',1)=v_contact.account_id::text;
    IF COALESCE(array_length(p_value_keys,1),0)=0 THEN RETURN false; END IF;
  END IF;
  CASE p_field_code
    WHEN 'akabiz_tag' THEN
      SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_facts->'akabiz_tag_keys') k WHERE k=ANY(p_value_keys)) INTO v_result;

    WHEN 'zalo_tag' THEN
      IF v_facts->>'chat_account_conversation_id' IS NOT NULL THEN
        RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_facts->'zalo_tag_keys') k WHERE k=ANY(p_value_keys));
      END IF;
      SELECT
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(v_contact.extra_data->'zaloTags') = 'array'
                THEN v_contact.extra_data->'zaloTags'
              WHEN jsonb_typeof(v_contact.extra_data->'zalo_tags') = 'array'
                THEN v_contact.extra_data->'zalo_tags'
              ELSE '[]'::jsonb
            END
          ) AS tag(value)
          WHERE COALESCE(
            tag.value->>'id', tag.value->>'labelId', tag.value->>'label_id',
            tag.value->>'tagId', tag.value->>'tag_id', tag.value #>> '{}'
          ) = ANY (p_value_keys)
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(v_contact.extra_data->'zaloTagIds') = 'array'
                THEN v_contact.extra_data->'zaloTagIds'
              WHEN jsonb_typeof(v_contact.extra_data->'zalo_tag_ids') = 'array'
                THEN v_contact.extra_data->'zalo_tag_ids'
              WHEN jsonb_typeof(v_contact.extra_data->'labelIds') = 'array'
                THEN v_contact.extra_data->'labelIds'
              WHEN jsonb_typeof(v_contact.extra_data->'label_ids') = 'array'
                THEN v_contact.extra_data->'label_ids'
              ELSE '[]'::jsonb
            END
          ) AS tag_id(value)
          WHERE tag_id.value #>> '{}' = ANY (p_value_keys)
        )
        OR EXISTS (
          SELECT 1
          FROM public.chat_zalo_account_organization AS binding
          JOIN public.chat_zalo_account_conversation AS conversation
            ON conversation.chat_zalo_account_id = binding.chat_zalo_account_id
           AND conversation.conversation_type = 'user'
           AND conversation.zalo_id = v_contact.uid
          JOIN public.chat_zalo_account_conversation_tag AS conversation_tag
            ON conversation_tag.chat_zalo_account_conversation_id = conversation.id
          JOIN public.chat_zalo_account_tag AS tag
            ON tag.id = conversation_tag.chat_zalo_account_tag_id
           AND tag.chat_zalo_account_id = conversation.chat_zalo_account_id
          WHERE binding.auto_account_id = v_contact.account_id::bigint
            AND binding.organization_id = v_contact.organization_id
            AND tag.zalo_id = ANY (p_value_keys)
        )
      INTO v_result;

    WHEN 'zalo_friend_status' THEN
      v_friend_status := v_facts->>'zalo_friend_status';
      v_result := v_friend_status = ANY (ARRAY(SELECT CASE WHEN k IN ('not_friend','unknown','removed') THEN 'stranger' ELSE k END FROM unnest(p_value_keys) k));

    WHEN 'zalo_group_membership' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.zalo_group_members AS group_member
        WHERE group_member.account_id = v_contact.account_id::bigint
          AND group_member.zalo_uid = v_contact.uid
          AND group_member.is_current = true
          AND group_member.zalo_group_id = ANY (p_value_keys)
      ) INTO v_result;

    ELSE
      v_result := false;
  END CASE;

  RETURN COALESCE(v_result, false);
END;
$function$
;


CREATE OR REPLACE FUNCTION public.aka_agent_data_group_dynamic_rule_matches(p_rule_id bigint, p_contact_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_field_code text;
  v_operator_code text;
  v_account_id bigint;
  v_contact_account_id bigint;
  v_value_keys text[];
  v_base boolean;
BEGIN
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_dynamic_filter_rules r
    JOIN public.auto_account_contact_group_dynamic_filters f ON f.id=r.dynamic_filter_id
    JOIN public.auto_account_contact_groups g ON g.id=f.group_id
    JOIN public.auto_account_contacts c ON c.id=p_contact_id
    WHERE r.id=p_rule_id AND g.bound_zalo_account_id IS NOT NULL AND (g.bound_zalo_account_id IS DISTINCT FROM c.account_id
      OR NOT public.aka_agent_data_group_account_available(g.bound_zalo_account_id,g.staff_id,g.organization_id))) THEN RETURN false; END IF;
  SELECT field_item.code, operator_item.code, rule.account_id,
    ARRAY(
      SELECT value #>> '{}'
      FROM jsonb_array_elements(rule.value_keys) AS value
      WHERE btrim(value #>> '{}') <> ''
    )
  INTO v_field_code, v_operator_code, v_account_id, v_value_keys
  FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
  JOIN public.category_item AS field_item ON field_item.id = rule.field_category_item_id
  JOIN public.category_item AS operator_item ON operator_item.id = rule.operator_category_item_id
  WHERE rule.id = p_rule_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT contact.account_id::bigint INTO v_contact_account_id
  FROM public.auto_account_contacts AS contact
  WHERE contact.id = p_contact_id;
  IF NOT FOUND OR (v_account_id IS NOT NULL AND v_account_id IS DISTINCT FROM v_contact_account_id) THEN
    RETURN false;
  END IF;

  IF v_field_code IN ('zalo_tag','zalo_group_membership') AND NOT EXISTS(
    SELECT 1 FROM unnest(v_value_keys) k WHERE position(':' IN k)=0 OR split_part(k,':',1)=v_contact_account_id::text
  ) THEN RETURN false; END IF;
  v_base := public.aka_agent_data_group_dynamic_values_match(
    p_contact_id, v_field_code, v_value_keys
  );
  RETURN CASE
    WHEN v_operator_code IN ('not_contains', 'not_equals', 'out') THEN NOT v_base
    ELSE v_base
  END;
END;
$function$
;


CREATE OR REPLACE FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(p_staff_id bigint, p_organization_id bigint, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(500, GREATEST(1, COALESCE(p_limit, 200)));
  v_queue record;
  v_filter record;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member_id bigint;
  v_origin_current boolean;
  v_was_member boolean;
  v_enter boolean;
  v_leave boolean;
  v_should_be_member boolean;
  v_processed integer := 0;
  v_pairs integer := 0;
  v_entered integer := 0;
  v_exited integer := 0;
  v_remaining bigint := 0;
  v_touched_filter_ids bigint[] := ARRAY[]::bigint[];
  v_changed_group_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:' || p_staff_id::text, 0)
  ) THEN
    RETURN jsonb_build_object(
      'processed_contact_count', 0,
      'evaluated_pair_count', 0,
      'entered_count', 0,
      'exited_count', 0,
      'remaining_queue_count', (
        SELECT count(*) FROM public.auto_account_contact_dynamic_filter_queue AS queue
        WHERE queue.staff_id = p_staff_id AND queue.organization_id = p_organization_id
      ),
      'busy', true
    );
  END IF;

  FOR v_queue IN
    SELECT queue.contact_id, queue.last_event_at
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.staff_id = p_staff_id
      AND queue.organization_id = p_organization_id
      AND queue.queued_at <= clock_timestamp()
    ORDER BY queue.queued_at, queue.contact_id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  LOOP
    BEGIN
      FOR v_filter IN
        SELECT dynamic_filter.id, dynamic_filter.group_id
        FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
        JOIN public.auto_account_contact_groups AS contact_group
          ON contact_group.id = dynamic_filter.group_id
         AND contact_group.staff_id = p_staff_id
         AND contact_group.organization_id = p_organization_id
         AND contact_group.purpose = 'data_group'
         AND contact_group.is_delete = false
        JOIN public.category_item AS data_type
          ON data_type.id = contact_group.data_type_category_item_id
         AND data_type.code = 'zalo_person'
        WHERE dynamic_filter.staff_id = p_staff_id
          AND dynamic_filter.organization_id = p_organization_id
          AND dynamic_filter.is_enabled = true
          AND dynamic_filter.effective_from_at <= v_queue.last_event_at
          AND EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
            JOIN public.category_item AS scope_item ON scope_item.id = rule.scope_category_item_id
            WHERE rule.dynamic_filter_id = dynamic_filter.id
              AND scope_item.code = 'enter'
          )
        ORDER BY dynamic_filter.id
      LOOP
        v_member_id := NULL;
        v_origin_current := false;
        v_was_member := false;
        v_pairs := v_pairs + 1;
        IF NOT v_filter.id = ANY (v_touched_filter_ids) THEN
          v_touched_filter_ids := pg_catalog.array_append(v_touched_filter_ids, v_filter.id);
          UPDATE public.auto_account_contact_group_dynamic_filters
          SET last_entered_count = 0, last_exited_count = 0
          WHERE id = v_filter.id;
        END IF;

        SELECT contact_group.* INTO v_group
        FROM public.auto_account_contact_groups AS contact_group
        WHERE contact_group.id = v_filter.group_id
        FOR UPDATE;

        IF v_group.bound_zalo_account_id IS NOT NULL AND (
          NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id)
          OR NOT EXISTS(SELECT 1 FROM public.auto_account_contacts WHERE id=v_queue.contact_id AND account_id=v_group.bound_zalo_account_id)
        ) THEN CONTINUE; END IF;
        IF EXISTS (
          SELECT 1 FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type = 'zalo'
            AND contact.contact_type = 'person'
            AND contact.is_delete = false
        ) THEN
          v_enter := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'enter'
          );
          v_leave := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'leave'
          );
          v_should_be_member := v_enter AND NOT v_leave;
        ELSE
          v_should_be_member := false;
        END IF;

        SELECT member.id, member.is_delete = false
        INTO v_member_id, v_was_member
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_filter.group_id
          AND member.contact_id = v_queue.contact_id
        FOR UPDATE;

        SELECT origin.is_current INTO v_origin_current
        FROM public.auto_account_contact_group_member_origins AS origin
        WHERE origin.membership_id = v_member_id
          AND origin.dynamic_filter_id = v_filter.id;

        IF v_should_be_member THEN
          INSERT INTO public.auto_account_contact_group_members (
            group_id, contact_id, is_delete, change_revision, updated_at
          ) VALUES (
            v_filter.group_id, v_queue.contact_id, false, v_group.revision + 1, clock_timestamp()
          )
          ON CONFLICT (group_id, contact_id) DO UPDATE SET
            is_delete = false,
            change_revision = v_group.revision + 1,
            updated_at = clock_timestamp()
          RETURNING id INTO v_member_id;

          INSERT INTO public.auto_account_contact_group_member_origins (
            membership_id, kind, dynamic_filter_id, source_account_id,
            source_name_snapshot, is_current, data_type_category_item_id, updated_at
          )
          SELECT
            v_member_id, 'dynamic_filter', v_filter.id, contact.account_id::bigint,
            'Bộ lọc động', true, v_group.data_type_category_item_id, clock_timestamp()
          FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
          ON CONFLICT (membership_id, dynamic_filter_id)
            WHERE dynamic_filter_id IS NOT NULL
          DO UPDATE SET
            source_account_id = EXCLUDED.source_account_id,
            source_name_snapshot = EXCLUDED.source_name_snapshot,
            is_current = true,
            data_type_category_item_id = EXCLUDED.data_type_category_item_id,
            updated_at = clock_timestamp();

          IF NOT COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = matched_count + 1
            WHERE id = v_filter.id;
          END IF;

          IF NOT COALESCE(v_was_member, false) THEN
            v_entered := v_entered + 1;
            v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET last_entered_count = last_entered_count + 1
            WHERE id = v_filter.id;
          END IF;
        ELSE
          IF COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_member_origins
            SET is_current = false, updated_at = clock_timestamp()
            WHERE membership_id = v_member_id
              AND dynamic_filter_id = v_filter.id
              AND is_current = true;

            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = GREATEST(0, matched_count - 1)
            WHERE id = v_filter.id;

            IF COALESCE(v_was_member, false) AND NOT EXISTS (
              SELECT 1
              FROM public.auto_account_contact_group_member_origins AS origin
              WHERE origin.membership_id = v_member_id
                AND origin.is_current = true
            ) THEN
              UPDATE public.auto_account_contact_group_members
              SET is_delete = true,
                  primary_origin_id = NULL,
                  change_revision = v_group.revision + 1,
                  updated_at = clock_timestamp()
              WHERE id = v_member_id;
              v_exited := v_exited + 1;
              v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
              UPDATE public.auto_account_contact_group_dynamic_filters
              SET last_exited_count = last_exited_count + 1
              WHERE id = v_filter.id;
            END IF;
          END IF;
        END IF;
      END LOOP;

      DELETE FROM public.auto_account_contact_dynamic_filter_queue
      WHERE contact_id = v_queue.contact_id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.auto_account_contact_dynamic_filter_queue
      SET attempt_count = attempt_count + 1,
          last_error = left(SQLERRM, 1000),
          queued_at = clock_timestamp() + make_interval(
            secs => CASE
              WHEN attempt_count >= 8 THEN 3600
              ELSE 5 * (attempt_count + 1) * (attempt_count + 1)
            END
          )
      WHERE contact_id = v_queue.contact_id;
    END;
  END LOOP;

  IF pg_catalog.array_length(v_changed_group_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_groups AS contact_group
    SET revision = contact_group.revision + 1,
        updated_at = clock_timestamp()
    WHERE contact_group.id = ANY (v_changed_group_ids);
  END IF;

  IF pg_catalog.array_length(v_touched_filter_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_group_dynamic_filters AS dynamic_filter
    SET last_evaluated_at = clock_timestamp(),
        next_evaluation_at = NULL,
        updated_at = clock_timestamp()
    WHERE dynamic_filter.id = ANY (v_touched_filter_ids);
  END IF;

  SELECT count(*)::bigint INTO v_remaining
  FROM public.auto_account_contact_dynamic_filter_queue AS queue
  WHERE queue.staff_id = p_staff_id
    AND queue.organization_id = p_organization_id
    AND queue.queued_at <= clock_timestamp();

  RETURN jsonb_build_object(
    'processed_contact_count', v_processed,
    'evaluated_pair_count', v_pairs,
    'entered_count', v_entered,
    'exited_count', v_exited,
    'remaining_queue_count', v_remaining,
    'busy', false
  );
END;
$function$
;


CREATE OR REPLACE FUNCTION public.aka_agent_save_data_group_dynamic_filter(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_is_enabled boolean, p_rules jsonb, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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

  IF v_bound_account_id IS NOT NULL THEN
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


CREATE OR REPLACE FUNCTION public.aka_agent_get_data_group_dynamic_filter(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_filter public.auto_account_contact_group_dynamic_filters%ROWTYPE;
  v_result jsonb;
  v_bound_account_id bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  SELECT bound_zalo_account_id INTO v_bound_account_id FROM public.auto_account_contact_groups WHERE id=p_group_id;
  SELECT dynamic_filter.* INTO v_filter
  FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
  WHERE dynamic_filter.group_id = p_group_id
    AND dynamic_filter.staff_id = p_staff_id
    AND dynamic_filter.organization_id = p_organization_id;

  SELECT jsonb_build_object(
    'filter', jsonb_build_object(
      'id', v_filter.id,
      'group_id', p_group_id,
      'bound_zalo_account_id', v_bound_account_id,
      'is_enabled', COALESCE(v_filter.is_enabled, false),
      'revision', COALESCE(v_filter.revision, 0),
      'evaluation_interval_minutes', COALESCE(v_filter.evaluation_interval_minutes, 15),
      'last_evaluated_at', v_filter.last_evaluated_at,
      'next_evaluation_at', v_filter.next_evaluation_at,
      'matched_count', COALESCE(v_filter.matched_count, 0),
      'last_entered_count', COALESCE(v_filter.last_entered_count, 0),
      'last_exited_count', COALESCE(v_filter.last_exited_count, 0)
    ),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rule.id,
        'scope_code', scope_item.code,
        'join_code', join_item.code,
        'field_code', field_item.code,
        'operator_code', operator_item.code,
        'account_id', rule.account_id,
        'sort_order', rule.sort_order,
        'value_keys', rule.value_keys,
        'value_labels', rule.value_labels
      ) ORDER BY scope_item.sort_order, rule.sort_order, rule.id)
      FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
      JOIN public.category_item AS scope_item ON scope_item.id = rule.scope_category_item_id
      JOIN public.category_item AS join_item ON join_item.id = rule.join_category_item_id
      JOIN public.category_item AS field_item ON field_item.id = rule.field_category_item_id
      JOIN public.category_item AS operator_item ON operator_item.id = rule.operator_category_item_id
      WHERE rule.dynamic_filter_id = v_filter.id
    ), '[]'::jsonb),
    'catalog', jsonb_build_object(
      'scopes', public.aka_agent_dynamic_filter_catalog_json('data_filter_scope'),
      'joins', public.aka_agent_dynamic_filter_catalog_json('data_filter_join'),
      'operators', public.aka_agent_dynamic_filter_catalog_json('data_filter_operator'),
      'fields', public.aka_agent_dynamic_filter_catalog_json('data_filter_field')
    ),
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', account.id, 'name', account.name, 'is_delete', account.is_delete
      ) ORDER BY account.is_delete, account.name, account.id)
      FROM public.auto_accounts AS account
      WHERE account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND account.flatform_type = 'zalo'
        AND (v_bound_account_id IS NULL OR account.id=v_bound_account_id)
    ), '[]'::jsonb),
    'values', COALESCE((
      SELECT jsonb_agg(to_jsonb(value_catalog) || jsonb_build_object('key',CASE WHEN value_catalog.field_code IN ('zalo_tag','zalo_group_membership') THEN value_catalog.account_id::text || ':' || value_catalog.key ELSE value_catalog.key END) ORDER BY value_catalog.field_order, value_catalog.label, value_catalog.key)
      FROM (
        SELECT DISTINCT 10 AS field_order, 'zalo_tag'::text AS field_code,
          tag.zalo_id AS key, COALESCE(tag.name, tag.zalo_id) AS label,
          binding.auto_account_id AS account_id, account.name AS account_name,
          'Tag Zalo'::text AS secondary_label
        FROM public.chat_zalo_account_tag AS tag
        JOIN public.chat_zalo_account_organization AS binding
          ON binding.chat_zalo_account_id = tag.chat_zalo_account_id
         AND binding.organization_id = p_organization_id
        JOIN public.auto_accounts AS account ON account.id = binding.auto_account_id
        WHERE account.staff_id = p_staff_id AND binding.is_active AND NOT account.is_delete
        UNION ALL
        SELECT DISTINCT 10, 'zalo_tag', c.uid, COALESCE(NULLIF(c.name,''),c.uid), c.account_id::bigint, a.name, 'Tag Zalo'
        FROM public.auto_account_contacts c JOIN public.auto_accounts a ON a.id=c.account_id
        WHERE c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.contact_type='zalo_tag' AND NOT c.is_delete AND NOT a.is_delete
          AND NOT EXISTS(SELECT 1 FROM public.chat_zalo_account_tag t JOIN public.chat_zalo_account_organization b ON b.chat_zalo_account_id=t.chat_zalo_account_id WHERE b.auto_account_id=c.account_id AND b.organization_id=c.organization_id AND b.is_active)
        UNION ALL
        SELECT 20, 'akabiz_tag', contact_tag.id::text, contact_tag.name,
          contact_tag.auto_account_id, account.name, 'Tag akaBiz'
        FROM public.auto_contact_tags AS contact_tag
        LEFT JOIN public.auto_accounts AS account ON account.id = contact_tag.auto_account_id
        WHERE contact_tag.staff_id = p_staff_id
          AND contact_tag.organization_id = p_organization_id
          AND contact_tag.is_delete = false
        UNION ALL
        SELECT DISTINCT 30, 'zalo_group_membership', zalo_group.zalo_group_id,
          COALESCE(zalo_group.name, zalo_group.zalo_group_id),
          zalo_group.account_id, account.name, 'Group Zalo'
        FROM public.zalo_groups AS zalo_group
        JOIN public.auto_accounts AS account ON account.id = zalo_group.account_id
        WHERE zalo_group.staff_id = p_staff_id
          AND zalo_group.organization_id = p_organization_id
        UNION ALL
        SELECT 40, 'zalo_friend_status', friend_status.code, friend_status.name,
          NULL::bigint, NULL::text, 'Trạng thái kết bạn'
        FROM public.category_type AS friend_type
        JOIN public.category_item AS friend_status ON friend_status.category_type_id = friend_type.id
        WHERE friend_type.namespace = 'common'
          AND friend_type.code = 'zalo_friend_status'
          AND friend_status.is_active = true
      ) AS value_catalog
      WHERE (v_bound_account_id IS NULL OR value_catalog.account_id IS NULL OR value_catalog.account_id=v_bound_account_id)
    ), '[]'::jsonb),
    'queue_count', (
      SELECT count(*)::bigint
      FROM public.auto_account_contact_dynamic_filter_queue AS queue
      WHERE queue.staff_id = p_staff_id AND queue.organization_id = p_organization_id
    )
  ) INTO v_result;
  RETURN v_result;
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
    is_delete = false,
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


CREATE FUNCTION public.aka_agent_create_data_group_v2_internal(p_staff_id bigint, p_organization_id bigint, p_name text, p_color text, p_request_id text, p_data_type_category_item_id bigint, p_bound_zalo_account_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(COALESCE(p_color, '#2563EB'))) NOT BETWEEN 1 AND 64
  THEN
    RAISE EXCEPTION 'invalid_data_group_payload';
  END IF;
  IF p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'create_group',
    'name', btrim(p_name),
    'color', btrim(COALESCE(p_color, '#2563EB')),
    'dataTypeCategoryItemId', p_data_type_category_item_id,
    'boundZaloAccountId',p_bound_zalo_account_id
  )::text);

  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NOT NULL THEN
    INSERT INTO public.auto_data_ingest_batches (
      request_id, operation, request_hash, status,
      staff_id, organization_id
    ) VALUES (
      btrim(p_request_id), 'create_group', v_request_hash, 'processing',
      p_staff_id, p_organization_id
    )
    ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
    RETURNING * INTO v_batch;

    IF NOT FOUND THEN
      SELECT *
      INTO v_batch
      FROM public.auto_data_ingest_batches AS batch
      WHERE batch.staff_id = p_staff_id
        AND batch.organization_id = p_organization_id
        AND batch.request_id = btrim(p_request_id)
      FOR UPDATE;
      IF v_batch.operation <> 'create_group'
        OR v_batch.request_hash <> v_request_hash
      THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN
        RETURN v_batch.result;
      END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    account_id, contact_type, name, purpose, color, sort_order, revision,
    data_type_category_item_id, bound_zalo_account_id, dataset_sync_mode, dataset_sync_key,
    is_delete, staff_id, organization_id
  ) VALUES (
    NULL, NULL, btrim(p_name), 'data_group',
    btrim(COALESCE(p_color, '#2563EB')),
    COALESCE((
      SELECT max(contact_group.sort_order) + 1
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
    ), 0),
    0, p_data_type_category_item_id, p_bound_zalo_account_id, 'manual', NULL,
    false, p_staff_id, p_organization_id
  )
  RETURNING * INTO v_group;

  v_result := to_jsonb(v_group)
    || public.aka_agent_data_type_json(v_group.data_type_category_item_id)
    || jsonb_build_object('active_membership_count', 0);

  IF v_batch.id IS NOT NULL THEN
    UPDATE public.auto_data_ingest_batches
    SET group_id = v_group.id,
        status = 'completed',
        result = v_result,
        updated_at = clock_timestamp()
    WHERE id = v_batch.id;
  END IF;
  RETURN v_result;
END;
$function$
;

CREATE FUNCTION public.aka_agent_create_data_group_v2(p_staff_id bigint,p_organization_id bigint,p_name text,p_color text,p_request_id text,p_data_type_category_item_id bigint,p_bound_zalo_account_id bigint,p_auth_username text,p_auth_password text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '60s' AS $new$
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  RETURN public.aka_agent_create_data_group_v2_internal(p_staff_id,p_organization_id,p_name,p_color,p_request_id,p_data_type_category_item_id,p_bound_zalo_account_id);
END;
$new$;


CREATE FUNCTION public.aka_agent_update_data_group_v2(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_name text, p_color text, p_sort_order integer, p_data_type_category_item_id bigint, p_update_data_type boolean, p_bound_zalo_account_id bigint, p_update_bound_account boolean, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  PERFORM pg_advisory_xact_lock(hashtextextended('data-group-dynamic-filter:' || p_staff_id::text,0));
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF p_name IS NOT NULL
    AND length(btrim(p_name)) NOT BETWEEN 1 AND 255
  THEN
    RAISE EXCEPTION 'invalid_data_group_name';
  END IF;
  IF p_color IS NOT NULL
    AND length(btrim(p_color)) NOT BETWEEN 1 AND 64
  THEN
    RAISE EXCEPTION 'invalid_data_group_color';
  END IF;
  IF p_sort_order IS NOT NULL AND p_sort_order < 0 THEN
    RAISE EXCEPTION 'invalid_data_group_sort_order';
  END IF;
  IF COALESCE(p_update_data_type, false)
    AND p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;
  IF COALESCE(p_update_data_type, false)
    AND v_group.dataset_sync_mode = 'dataset_auto'
  THEN
    RAISE EXCEPTION 'dataset_auto_data_group_type_read_only';
  END IF;

  UPDATE public.auto_account_contact_groups AS contact_group
  SET name = COALESCE(btrim(p_name), contact_group.name),
      color = COALESCE(btrim(p_color), contact_group.color),
      sort_order = COALESCE(p_sort_order, contact_group.sort_order),
      data_type_category_item_id = CASE
        WHEN COALESCE(p_update_data_type, false)
          THEN p_data_type_category_item_id
        ELSE contact_group.data_type_category_item_id
      END,
      bound_zalo_account_id = CASE WHEN COALESCE(p_update_bound_account,false) THEN p_bound_zalo_account_id ELSE contact_group.bound_zalo_account_id END,
      revision = contact_group.revision + CASE
        WHEN COALESCE(p_update_data_type, false)
          AND contact_group.data_type_category_item_id IS DISTINCT FROM
            p_data_type_category_item_id
        THEN 1 ELSE 0
      END,
      updated_at = clock_timestamp()
  WHERE contact_group.id = v_group.id
  RETURNING contact_group.* INTO v_group;

  RETURN to_jsonb(v_group)
    || public.aka_agent_data_type_json(v_group.data_type_category_item_id)
    || jsonb_build_object(
      'active_membership_count', (
        SELECT count(*)
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
      )
    );
END;
$function$
;

CREATE FUNCTION public.aka_agent_list_data_groups_v2(p_staff_id bigint, p_organization_id bigint, p_search text, p_compatible_action_id text, p_compatible_data_type_category_item_id bigint, p_data_type_category_item_ids bigint[], p_offset integer, p_limit integer, p_auth_username text, p_auth_password text, p_unrestricted_only boolean) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '60s' AS $new$
BEGIN
  RETURN QUERY SELECT to_jsonb(g) || jsonb_build_object('bound_zalo_account_id',cg.bound_zalo_account_id,'bound_zalo_account_name',a.name)
  FROM public.aka_agent_list_data_groups(p_staff_id,p_organization_id,p_search,p_compatible_action_id,p_compatible_data_type_category_item_id,p_data_type_category_item_ids,p_offset,p_limit,p_auth_username,p_auth_password,p_unrestricted_only) g
  JOIN public.auto_account_contact_groups cg ON cg.id=g.id
  LEFT JOIN public.auto_accounts a ON a.id=cg.bound_zalo_account_id;
END;
$new$;


CREATE FUNCTION public.aka_agent_list_data_group_members_v2(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_search text, p_account_ids bigint[], p_include_accountless boolean, p_contact_types text[], p_flatform_types text[], p_status text, p_dataset_ids bigint[], p_data_type_category_item_ids bigint[], p_ids bigint[], p_exclude_ids bigint[], p_offset integer, p_limit integer, p_auth_username text, p_auth_password text) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '60s' AS $new$
BEGIN
  RETURN QUERY SELECT to_jsonb(m) || jsonb_build_object('zalo_name',f->'zalo_name','display_name',f->'display_name','zalo_friend_status',f->'zalo_friend_status')
  FROM public.aka_agent_list_data_group_members(p_staff_id,p_organization_id,p_group_id,p_search,p_account_ids,p_include_accountless,p_contact_types,p_flatform_types,p_status,p_dataset_ids,p_data_type_category_item_ids,p_ids,p_exclude_ids,p_offset,p_limit,p_auth_username,p_auth_password) m
  CROSS JOIN LATERAL (SELECT public.aka_agent_data_group_zalo_facts(m.contact_id) f) facts;
END;
$new$;



INSERT INTO public.category_item(category_type_id,code,name,managed_by,sort_order,external_id,metadata,is_active)
SELECT t.id,v.code,v.name,'system',v.ord,v.code,'{}'::jsonb,true
FROM public.category_type t CROSS JOIN (VALUES ('friend','Bạn bè',10),('request_sent','Gửi lời mời kết bạn',20),('request_received','Nhận kết bạn',30),('stranger','Người lạ',40)) v(code,name,ord)
WHERE t.namespace='common' AND t.code='zalo_friend_status'
ON CONFLICT(category_type_id,code) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,is_active=true;
UPDATE public.category_item i SET is_active=false FROM public.category_type t
WHERE i.category_type_id=t.id AND t.namespace='common' AND t.code='zalo_friend_status' AND i.code IN ('not_friend','unknown');


REVOKE ALL ON FUNCTION public.aka_agent_data_group_account_available(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_data_group_zalo_facts(bigint) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_data_group_validate_bound_rule(bigint,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_guard_data_group_bound_account() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_guard_data_group_bound_member() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_dynamic_filter_chat_event() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_guard_bound_data_group_source() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_create_data_group_v2_internal(bigint,bigint,text,text,text,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_create_data_group_v2(bigint,bigint,text,text,text,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_create_data_group_v2(bigint,bigint,text,text,text,bigint,bigint,text,text) TO anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text) TO anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean) TO anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text) TO anon,authenticated,service_role;

-- API metadata changed: one schema-cache notification, then verify REST.
NOTIFY pgrst, 'reload schema';
COMMIT;
