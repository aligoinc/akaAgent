-- Fixtures only; all mutations roll back. No runtime API / real Zalo commands.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $smoke$
DECLARE
  a record; b record; g bigint; unbound bigint; mixed bigint; c bigint; other_c bigint; member_id bigint;
  member_row jsonb; expected jsonb; gc bigint; cg bigint; gac bigint; gconv bigint; fallback_c bigint;
  tag2 bigint; bad_tag bigint; dyn bigint; outcome jsonb; u bigint; ac bigint; conv bigint; tag bigint; native_tag bigint; f bigint; rule_id bigint;
  v_status_code text; typ bigint:=public.aka_agent_data_type_category_item_id('zalo_person'); result jsonb; facts jsonb; rows jsonb;
  prefix text:='v290-smoke-'||txid_current()::text; total bigint;
BEGIN
  SELECT account.*,binding.id binding_id,binding.chat_zalo_account_id INTO a
  FROM public.auto_accounts account JOIN public.chat_zalo_account_organization binding ON binding.auto_account_id=account.id AND binding.organization_id=account.organization_id AND binding.is_active
  JOIN public.org_staff staff ON staff.id=account.staff_id AND staff.is_active
  WHERE public.aka_agent_data_group_account_available(account.id,account.staff_id,account.organization_id)
  ORDER BY account.id LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'v290_smoke:no_eligible_chat_account'; END IF;
  SELECT * INTO b FROM public.auto_accounts WHERE flatform_type='zalo' AND id<>a.id AND staff_id=a.staff_id AND organization_id=a.organization_id AND NOT is_delete ORDER BY id LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'v290_smoke:second_account_required'; END IF;

  result:=public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix,'#123456',prefix,typ,a.id,NULL,NULL); g:=(result->>'id')::bigint;
  IF (result->>'bound_zalo_account_id')::bigint IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'v290_smoke:create_binding'; END IF;
  IF public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix,'#123456',prefix,typ,a.id,NULL,NULL) IS DISTINCT FROM result THEN RAISE EXCEPTION 'v290_smoke:create_replay'; END IF;
  BEGIN
    PERFORM public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix,'#123456',prefix,typ,NULL,NULL,NULL);
    RAISE EXCEPTION 'v290_smoke:missing_create_conflict';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_request_id_conflict%' THEN RAISE; END IF; END;
  result:=public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix||'-unbound','#123456',NULL,typ,NULL,NULL,NULL);unbound:=(result->>'id')::bigint;
  result:=public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix||'-mixed','#123456',NULL,typ,NULL,NULL,NULL);mixed:=(result->>'id')::bigint;

  rows:=jsonb_build_array(jsonb_build_object('contact_type','person','flatform_type','zalo','uid',prefix,'name','Tên cũ'));
  result:=public.aka_agent_ingest_data_group(a.staff_id,a.organization_id,prefix||'-ingest',g,'upload',rows,NULL,prefix,'textbox',NULL,NULL,NULL,typ);
  SELECT contact_id,id INTO c,member_id FROM public.auto_account_contact_group_members WHERE group_id=g AND NOT is_delete;
  IF c IS NULL OR NOT EXISTS(SELECT 1 FROM public.auto_account_contacts WHERE id=c AND account_id=a.id) THEN RAISE EXCEPTION 'v290_smoke:default_upload_account'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_group_member_origins WHERE membership_id=member_id AND source_account_id=a.id AND is_current) THEN RAISE EXCEPTION 'v290_smoke:upload_provenance'; END IF;
  IF public.aka_agent_ingest_data_group(a.staff_id,a.organization_id,prefix||'-ingest',g,'upload',rows,NULL,prefix,'textbox',NULL,NULL,NULL,typ) IS DISTINCT FROM result THEN RAISE EXCEPTION 'v290_smoke:ingest_replay'; END IF;
  BEGIN
    PERFORM public.aka_agent_ingest_data_group(a.staff_id,a.organization_id,prefix||'-wrong',g,'manual',jsonb_build_array(jsonb_build_object('contact_type','person','uid',prefix||'-wrong','source_account_id',b.id)),NULL,NULL,NULL,NULL,NULL,NULL,typ);
    RAISE EXCEPTION 'v290_smoke:missing_cross_account_rejection';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_source_mismatch%' THEN RAISE; END IF; END;
  INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,flatform_type,staff_id,organization_id) VALUES(b.id,'person',prefix,prefix||'-other','zalo',a.staff_id,a.organization_id) RETURNING id INTO other_c;
  BEGIN
    INSERT INTO public.auto_account_contact_group_members(group_id,contact_id) VALUES(g,other_c);
    RAISE EXCEPTION 'v290_smoke:missing_member_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_source_mismatch%' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_ingest_data_group(a.staff_id,a.organization_id,prefix||'-mixed',mixed,'manual',jsonb_build_array(jsonb_build_object('contact_id',other_c)),NULL,NULL,NULL,NULL,NULL,NULL,typ);
  BEGIN
    PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,mixed,NULL,NULL,NULL,NULL,false,a.id,true,NULL,NULL);
    RAISE EXCEPTION 'v290_smoke:missing_rebind_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_members_mismatch:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,g,NULL,NULL,NULL,public.aka_agent_data_type_category_item_id('phone'),true,a.id,true,NULL,NULL);
    RAISE EXCEPTION 'v290_smoke:missing_type_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_type_invalid%' THEN RAISE; END IF; END;
  result:=public.aka_agent_duplicate_data_group(a.staff_id,a.organization_id,g,prefix||'-copy',prefix||'-copy');
  IF (result->>'bound_zalo_account_id')::bigint IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'v290_smoke:duplicate_binding'; END IF;
  BEGIN
    UPDATE public.auto_account_contacts SET account_id=b.id WHERE id=c;
    RAISE EXCEPTION 'v290_smoke:missing_contact_identity_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_source_mismatch%' THEN RAISE; END IF; END;

  -- Move and reactivation must use the same DB guard, including legacy clients.
  BEGIN
    PERFORM public.aka_agent_move_data_group_members(a.staff_id,a.organization_id,prefix||'-move',mixed,ARRAY[(SELECT id FROM public.auto_account_contact_group_members WHERE group_id=mixed AND contact_id=other_c)],g);
    RAISE EXCEPTION 'v290_smoke:missing_move_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_source_mismatch%' THEN RAISE; END IF; END;
  IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE group_id=mixed AND contact_id=other_c AND NOT is_delete) THEN RAISE EXCEPTION 'v290_smoke:move_rollback'; END IF;
  INSERT INTO public.auto_account_contact_group_members(group_id,contact_id,is_delete) VALUES(g,other_c,true);
  BEGIN
    UPDATE public.auto_account_contact_group_members SET is_delete=false WHERE group_id=g AND contact_id=other_c;
    RAISE EXCEPTION 'v290_smoke:missing_reactivation_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_source_mismatch%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_data_group_validate_bound_rule(a.id,a.staff_id,a.organization_id,jsonb_build_object('field_code','zalo_tag','value_keys',jsonb_build_array(b.id::text||':same-tag')));
    RAISE EXCEPTION 'v290_smoke:missing_scoped_tag_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_rule_mismatch%' THEN RAISE; END IF; END;
  IF NOT EXISTS(SELECT 1 FROM public.aka_agent_list_data_groups_v2(a.staff_id,a.organization_id,prefix,NULL,NULL,NULL,0,100,NULL,NULL,false) r WHERE (r->>'id')::bigint=g AND (r->>'bound_zalo_account_id')::bigint=a.id) THEN RAISE EXCEPTION 'v290_smoke:list_group_binding'; END IF;

  -- Canonical Chat profile, relationship and two separate tag memberships.
  INSERT INTO public.chat_zalo_account_user(chat_zalo_account_id,zalo_id,zalo_name,display_name,friendship_status_category_item_id)
  SELECT a.chat_zalo_account_id,prefix,'Tên gốc 286','Biệt danh 286',i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='zalo' AND t.code='friendship_status' AND i.code='request_received' RETURNING id INTO u;
  INSERT INTO public.chat_zalo_account_conversation(chat_zalo_account_id,chat_zalo_account_user_id,zalo_id,conversation_type) VALUES(a.chat_zalo_account_id,u,prefix,'user') RETURNING id INTO ac;
  INSERT INTO public.chat_zalo_conversation(organization_id,chat_zalo_account_organization_id,chat_zalo_account_conversation_id,conversation_status_category_item_id,conversation_priority_category_item_id)
  SELECT a.organization_id,a.binding_id,ac,
    (SELECT i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='zalo' AND t.code='chat_conversation_status' ORDER BY i.sort_order LIMIT 1),
    (SELECT i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='zalo' AND t.code='chat_conversation_priority' ORDER BY i.sort_order LIMIT 1) RETURNING id INTO conv;
  facts:=public.aka_agent_data_group_zalo_facts(c);
  IF facts->>'zalo_name'<>'Tên gốc 286' OR facts->>'display_name'<>'Biệt danh 286' OR facts->>'zalo_friend_status'<>'request_received' THEN RAISE EXCEPTION 'v290_smoke:chat_facts'; END IF;
  SELECT count(*) INTO total FROM public.aka_agent_list_data_group_members_v2(a.staff_id,a.organization_id,g,'Biệt danh 286',NULL,true,NULL,NULL,'request_received',NULL,NULL,NULL,NULL,0,1,NULL,NULL);
  IF total<>1 THEN RAISE EXCEPTION 'v290_smoke:search_status_before_pagination'; END IF;
  FOREACH v_status_code IN ARRAY ARRAY['friend','request_sent','request_received','stranger','unknown','removed'] LOOP
    UPDATE public.chat_zalo_account_user SET friendship_status_category_item_id=(SELECT i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='zalo' AND t.code='friendship_status' AND i.code=v_status_code) WHERE id=u;
    IF public.aka_agent_data_group_zalo_facts(c)->>'zalo_friend_status' IS DISTINCT FROM (CASE WHEN v_status_code IN ('friend','request_sent','request_received') THEN v_status_code ELSE 'stranger' END) THEN RAISE EXCEPTION 'v290_smoke:status:%',v_status_code; END IF;
    expected:=public.aka_agent_data_group_zalo_facts(c);
    SELECT r INTO member_row FROM public.aka_agent_list_data_group_members_v2(a.staff_id,a.organization_id,g,NULL,NULL,true,NULL,NULL,expected->>'zalo_friend_status',NULL,NULL,ARRAY[member_id],NULL,0,1,NULL,NULL) r;
    IF member_row IS NULL OR member_row->'zalo_name' IS DISTINCT FROM expected->'zalo_name'
      OR member_row->'display_name' IS DISTINCT FROM expected->'display_name'
      OR member_row->'zalo_friend_status' IS DISTINCT FROM expected->'zalo_friend_status'
      THEN RAISE EXCEPTION 'v290_smoke:profile_status_parity:%',v_status_code; END IF;

  END LOOP;
  INSERT INTO public.auto_contact_tags(name,staff_id,organization_id,auto_account_id) VALUES(prefix,a.staff_id,a.organization_id,a.id) RETURNING id INTO tag;
  UPDATE public.auto_account_contacts SET akabiz_tag_ids=ARRAY[tag],extra_data=jsonb_build_object('zaloTagIds',jsonb_build_array(prefix)) WHERE id=c;
  INSERT INTO public.chat_zalo_account_tag(chat_zalo_account_id,zalo_id,name) VALUES(a.chat_zalo_account_id,prefix,prefix) RETURNING id INTO native_tag;
  INSERT INTO public.chat_zalo_account_conversation_tag(chat_zalo_account_id,chat_zalo_account_conversation_id,chat_zalo_account_tag_id) VALUES(a.chat_zalo_account_id,ac,native_tag);
  INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id) VALUES(a.organization_id,conv,tag) ON CONFLICT(chat_zalo_conversation_id,auto_contact_tag_id) DO NOTHING;
  IF NOT public.aka_agent_data_group_dynamic_values_match(c,'zalo_tag',ARRAY[a.id::text||':'||prefix]) OR NOT public.aka_agent_data_group_dynamic_values_match(c,'akabiz_tag',ARRAY[tag::text]) THEN RAISE EXCEPTION 'v290_smoke:chat_tag_match'; END IF;
  DELETE FROM public.chat_zalo_account_conversation_tag WHERE chat_zalo_account_conversation_id=ac;
  DELETE FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=conv;
  IF public.aka_agent_data_group_dynamic_values_match(c,'zalo_tag',ARRAY[prefix]) OR public.aka_agent_data_group_dynamic_values_match(c,'akabiz_tag',ARRAY[tag::text]) THEN RAISE EXCEPTION 'v290_smoke:stale_local_tag_resurrection'; END IF;

  result:=public.aka_agent_save_data_group_dynamic_filter(a.staff_id,a.organization_id,g,true,jsonb_build_array(jsonb_build_object('scope_code','enter','join_code','and','field_code','zalo_friend_status','operator_code','equals','value_keys',jsonb_build_array('request_received'),'value_labels',jsonb_build_array('Nhận kết bạn'))),NULL,NULL);
  f:=(result->>'filter_id')::bigint;
  IF (result->>'queued_count')::int<>0 THEN RAISE EXCEPTION 'v290_smoke:historical_enqueue'; END IF;
  UPDATE public.chat_zalo_account_user SET friendship_status_category_item_id=(SELECT i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='zalo' AND t.code='friendship_status' AND i.code='request_received') WHERE id=u;
  IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_dynamic_filter_queue WHERE contact_id=c) THEN RAISE EXCEPTION 'v290_smoke:chat_event_not_queued'; END IF;
  SELECT id INTO rule_id FROM public.auto_account_contact_group_dynamic_filter_rules WHERE dynamic_filter_id=f;
  IF NOT public.aka_agent_data_group_dynamic_rule_matches(rule_id,c) OR public.aka_agent_data_group_dynamic_rule_matches(rule_id,other_c) THEN RAISE EXCEPTION 'v290_smoke:bound_dynamic_scope'; END IF;
  UPDATE public.auto_account_contact_group_dynamic_filter_rules SET operator_category_item_id=(SELECT i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='common' AND t.code='data_filter_operator' AND i.code='not_equals') WHERE id=rule_id;
  IF public.aka_agent_data_group_dynamic_rule_matches(rule_id,other_c) THEN RAISE EXCEPTION 'v290_smoke:negation_cross_account'; END IF;
  BEGIN
    PERFORM public.aka_agent_save_data_group_dynamic_filter(a.staff_id,a.organization_id,g,true,jsonb_build_array(jsonb_build_object('scope_code','enter','join_code','and','field_code','zalo_friend_status','operator_code','equals','account_id',b.id,'value_keys',jsonb_build_array('friend'),'value_labels',jsonb_build_array('Bạn bè'))),NULL,NULL);
    RAISE EXCEPTION 'v290_smoke:missing_save_rule_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_rule_mismatch%' THEN RAISE; END IF; END;
  result:=public.aka_agent_get_data_group_dynamic_filter(a.staff_id,a.organization_id,g,NULL,NULL);
  IF (result->'filter'->>'bound_zalo_account_id')::bigint IS DISTINCT FROM a.id OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'values') v WHERE v->>'account_id' IS NOT NULL AND (v->>'account_id')::bigint<>a.id) THEN RAISE EXCEPTION 'v290_smoke:catalog_scope'; END IF;
  result:=public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,g,NULL,NULL,NULL,NULL,false,NULL,true,NULL,NULL);
  IF result->>'bound_zalo_account_id' IS NOT NULL THEN RAISE EXCEPTION 'v290_smoke:unbind'; END IF;


  -- Group/account context remains bound in a dedicated filter for these checks.
  result:=public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix||'-fix','#123456',NULL,typ,a.id,NULL,NULL);dyn:=(result->>'id')::bigint;
  INSERT INTO public.auto_contact_tags(name,staff_id,organization_id,auto_account_id) VALUES(prefix||'-two',a.staff_id,a.organization_id,a.id) RETURNING id INTO tag2;
  INSERT INTO public.auto_contact_tags(name,staff_id,organization_id,auto_account_id) VALUES(prefix||'-wrong',a.staff_id,a.organization_id,b.id) RETURNING id INTO bad_tag;

  -- Legacy Desktop PATCH -> canonical Chat membership -> dynamic matcher.
  UPDATE public.auto_account_contacts SET akabiz_tag_ids=ARRAY[tag] WHERE id=c;
  IF NOT EXISTS(SELECT 1 FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=conv AND auto_contact_tag_id=tag)
    OR NOT public.aka_agent_data_group_dynamic_values_match(c,'akabiz_tag',ARRAY[tag::text]) THEN RAISE EXCEPTION 'v290_smoke:desktop_write_not_canonical'; END IF;
  -- Chat additions/removals immediately project back, including while this group's filter is off.
  INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id) VALUES(a.organization_id,conv,tag2);
  IF NOT (SELECT akabiz_tag_ids @> ARRAY[tag,tag2] FROM public.auto_account_contacts WHERE id=c) THEN RAISE EXCEPTION 'v290_smoke:chat_add_not_mirrored'; END IF;
  DELETE FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=conv AND auto_contact_tag_id=tag;
  IF (SELECT tag=ANY(akabiz_tag_ids) FROM public.auto_account_contacts WHERE id=c) THEN RAISE EXCEPTION 'v290_smoke:chat_remove_not_mirrored'; END IF;

  -- Additive RPC preserves other tags, is idempotent and rejects account leakage.
  result:=public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[tag],NULL,NULL,'add');
  IF (result->>'count')::integer<>1 OR NOT (SELECT akabiz_tag_ids @> ARRAY[tag,tag2] FROM public.auto_account_contacts WHERE id=c) THEN RAISE EXCEPTION 'v290_smoke:additive_rpc'; END IF;
  IF (public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[tag],NULL,NULL,'add')->>'count')::integer<>0 THEN RAISE EXCEPTION 'v290_smoke:rpc_replay'; END IF;
  BEGIN
    PERFORM public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[bad_tag],NULL,NULL,'add');
    RAISE EXCEPTION 'v290_smoke:missing_rpc_tag_scope_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%contact_tag_scope_invalid%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.auto_account_contacts SET akabiz_tag_ids=akabiz_tag_ids||bad_tag WHERE id=c;
    RAISE EXCEPTION 'v290_smoke:missing_legacy_tag_scope_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%contact_tag_scope_invalid%' THEN RAISE; END IF; END;
  IF current_setting('aka_agent.chat_tag_writeback',true)='on' OR current_setting('aka_agent.chat_tag_projection',true)='on' THEN RAISE EXCEPTION 'v290_smoke:sync_context_leaked'; END IF;
  UPDATE public.auto_account_contacts SET akabiz_tag_ids=ARRAY[tag2] WHERE id=c;
  IF EXISTS(SELECT 1 FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=conv AND auto_contact_tag_id=tag) THEN RAISE EXCEPTION 'v290_smoke:desktop_remove_not_canonical'; END IF;

  PERFORM public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[tag],NULL,NULL,'add');
  PERFORM public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[tag],NULL,NULL,'remove');
  IF (SELECT tag=ANY(akabiz_tag_ids) OR NOT tag2=ANY(akabiz_tag_ids) FROM public.auto_account_contacts WHERE id=c)
    OR EXISTS(SELECT 1 FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=conv AND auto_contact_tag_id=tag) THEN RAISE EXCEPTION 'v290_smoke:delta_remove'; END IF;

  -- An already-equal local array must not swallow a new canonical tag event.
  DELETE FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=conv AND auto_contact_tag_id=tag;
  PERFORM set_config('aka_agent.chat_tag_projection','on',true);
  UPDATE public.auto_account_contacts SET akabiz_tag_ids=ARRAY[tag,tag2] WHERE id=c;
  PERFORM set_config('aka_agent.chat_tag_projection','',true);
  DELETE FROM public.auto_account_contact_dynamic_filter_queue WHERE contact_id=c;
  result:=public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[tag,tag2],NULL,NULL,'add');
  IF (result->>'count')::integer<>1 OR NOT EXISTS(SELECT 1 FROM public.auto_account_contact_dynamic_filter_queue WHERE contact_id=c)
    THEN RAISE EXCEPTION 'v290_smoke:batch_canonical_event_not_queued'; END IF;
  IF current_setting('aka_agent.chat_tag_batch',true)='on' THEN RAISE EXCEPTION 'v290_smoke:batch_context_leaked'; END IF;
  DELETE FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=conv AND auto_contact_tag_id=tag;
  IF (SELECT tag=ANY(akabiz_tag_ids) FROM public.auto_account_contacts WHERE id=c) THEN RAISE EXCEPTION 'v290_smoke:chat_trigger_after_batch'; END IF;

  -- Page after filtering/counting, retaining local-name/legacy-relationship fallback.
  result:=public.aka_agent_ingest_data_group(a.staff_id,a.organization_id,prefix||'-fallback',g,'upload',
    jsonb_build_array(jsonb_build_object('contact_type','person','flatform_type','zalo','uid',prefix||'-fallback','name','v290 fallback alias')),NULL,prefix,'textbox',NULL,NULL,NULL,typ);
  SELECT id INTO fallback_c FROM public.auto_account_contacts WHERE account_id=a.id AND uid=prefix||'-fallback' AND contact_type='person';
  UPDATE public.auto_account_contacts SET is_friend=false,extra_data='{"friendRequestSent":"true"}' WHERE id=fallback_c;
  SELECT r INTO member_row FROM public.aka_agent_list_data_group_members_v2(a.staff_id,a.organization_id,g,'v290 fallback alias',NULL,true,NULL,NULL,'request_sent',NULL,NULL,NULL,NULL,0,1,NULL,NULL) r;
  IF (member_row->>'contact_id')::bigint IS DISTINCT FROM fallback_c OR (member_row->>'total_count')::bigint<>1
    OR member_row->>'display_name'<>'v290 fallback alias' THEN RAISE EXCEPTION 'v290_smoke:local_profile_fallback'; END IF;
  SELECT r INTO member_row FROM public.aka_agent_list_data_group_members_v2(a.staff_id,a.organization_id,g,NULL,NULL,true,NULL,NULL,'all',NULL,NULL,NULL,NULL,1,1,NULL,NULL) r;
  IF member_row IS NULL OR (member_row->>'total_count')::bigint<>2 THEN RAISE EXCEPTION 'v290_smoke:page_total_before_limit'; END IF;

  -- Group conversations use the same lightweight tag projection.
  INSERT INTO public.chat_zalo_account_group(chat_zalo_account_id,zalo_id,name,membership_status_category_item_id)
  SELECT a.chat_zalo_account_id,prefix||'-chat-group',prefix,i.id
  FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
  WHERE t.namespace='zalo' AND t.code='group_membership_status' ORDER BY i.sort_order LIMIT 1 RETURNING id INTO cg;
  IF cg IS NULL THEN RAISE EXCEPTION 'v290_smoke:group_status_fixture_missing'; END IF;
  INSERT INTO public.chat_zalo_account_conversation(chat_zalo_account_id,chat_zalo_account_group_id,zalo_id,conversation_type)
  VALUES(a.chat_zalo_account_id,cg,prefix||'-chat-group','group') RETURNING id INTO gac;
  INSERT INTO public.chat_zalo_conversation(organization_id,chat_zalo_account_organization_id,chat_zalo_account_conversation_id,conversation_status_category_item_id,conversation_priority_category_item_id)
  SELECT organization_id,chat_zalo_account_organization_id,gac,conversation_status_category_item_id,conversation_priority_category_item_id FROM public.chat_zalo_conversation WHERE id=conv RETURNING id INTO gconv;
  INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,flatform_type,staff_id,organization_id)
  VALUES(a.id,'group',prefix,prefix||'-chat-group','zalo',a.staff_id,a.organization_id) RETURNING id INTO gc;
  PERFORM public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[gc],ARRAY[tag,tag2],NULL,NULL,'add');
  IF NOT (SELECT akabiz_tag_ids @> ARRAY[tag,tag2] FROM public.auto_account_contacts WHERE id=gc) THEN RAISE EXCEPTION 'v290_smoke:group_batch_mirror'; END IF;
  DELETE FROM public.chat_zalo_conversation_system_tag WHERE chat_zalo_conversation_id=gconv AND auto_contact_tag_id=tag;
  IF (SELECT tag=ANY(akabiz_tag_ids) OR NOT tag2=ANY(akabiz_tag_ids) FROM public.auto_account_contacts WHERE id=gc) THEN RAISE EXCEPTION 'v290_smoke:group_chat_mirror'; END IF;

  -- Unlinked contacts retain local storage and account/tenant scope.
  INSERT INTO public.auto_contact_tags(name,staff_id,organization_id) VALUES(prefix||'-global',a.staff_id,a.organization_id) RETURNING id INTO tag;
  result:=public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[other_c],ARRAY[tag],NULL,NULL,'add');
  IF (result->>'count')::integer<>1 OR NOT (SELECT tag=ANY(akabiz_tag_ids) FROM public.auto_account_contacts WHERE id=other_c) THEN RAISE EXCEPTION 'v290_smoke:local_fallback'; END IF;
  IF (public.aka_agent_mutate_contact_tags(a.staff_id,-1,ARRAY[other_c],ARRAY[tag],NULL,NULL,'add')->>'count')::integer<>0 THEN RAISE EXCEPTION 'v290_smoke:tenant_scope'; END IF;

  rows:=jsonb_build_array(jsonb_build_object('scope_code','enter','join_code','and','field_code','akabiz_tag','operator_code','contains','value_keys',jsonb_build_array(tag2::text),'value_labels',jsonb_build_array(prefix)));
  PERFORM public.aka_agent_save_data_group_dynamic_filter(a.staff_id,a.organization_id,dyn,true,rows,NULL,NULL);
  UPDATE public.auto_contact_tags SET is_delete=true WHERE id=tag2;
  PERFORM public.aka_agent_save_data_group_dynamic_filter(a.staff_id,a.organization_id,dyn,false,rows,NULL,NULL);
  IF (SELECT is_enabled FROM public.auto_account_contact_group_dynamic_filters WHERE group_id=dyn) THEN RAISE EXCEPTION 'v290_smoke:disabled_filter_still_enabled'; END IF;
  BEGIN
    PERFORM public.aka_agent_save_data_group_dynamic_filter(a.staff_id,a.organization_id,dyn,true,rows,NULL,NULL);
    RAISE EXCEPTION 'v290_smoke:reenabled_invalid_rule';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%data_group_bound_rule_mismatch%' THEN RAISE; END IF; END;

  -- Future friendship/native/system tag events preserve a contact tombstone.
  rows:=jsonb_build_array(jsonb_build_object('scope_code','enter','join_code','and','field_code','zalo_friend_status','operator_code','equals','value_keys',jsonb_build_array('request_received'),'value_labels',jsonb_build_array('Nhận kết bạn')));
  PERFORM public.aka_agent_save_data_group_dynamic_filter(a.staff_id,a.organization_id,dyn,true,rows,NULL,NULL);
  UPDATE public.auto_account_contacts SET is_delete=true WHERE id=c;
  UPDATE public.chat_zalo_account_user SET friendship_status_category_item_id=(SELECT i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='zalo' AND t.code='friendship_status' AND i.code='stranger') WHERE id=u;
  UPDATE public.chat_zalo_account_user SET friendship_status_category_item_id=(SELECT i.id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id WHERE t.namespace='zalo' AND t.code='friendship_status' AND i.code='request_received') WHERE id=u;
  INSERT INTO public.chat_zalo_account_conversation_tag(chat_zalo_account_id,chat_zalo_account_conversation_id,chat_zalo_account_tag_id) VALUES(a.chat_zalo_account_id,ac,native_tag);
  INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id) VALUES(a.organization_id,conv,tag);
  IF NOT (SELECT is_delete FROM public.auto_account_contacts WHERE id=c) THEN RAISE EXCEPTION 'v290_smoke:chat_event_revived_contact'; END IF;
  IF (public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[tag],NULL,NULL,'add')->>'count')::integer<>0 THEN RAISE EXCEPTION 'v290_smoke:tag_rpc_touches_deleted_contact'; END IF;
  UPDATE public.auto_account_contact_dynamic_filter_queue SET queued_at='-infinity' WHERE contact_id=c;
  outcome:=public.aka_agent_process_data_group_dynamic_filters_core(a.staff_id,a.organization_id,1);
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE group_id=dyn AND contact_id=c AND NOT is_delete) THEN RAISE EXCEPTION 'v290_smoke:worker_reentered_deleted_contact'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_dynamic_filter_queue WHERE contact_id=c) THEN RAISE EXCEPTION 'v290_smoke:event_not_processed'; END IF;
  IF has_function_privilege('anon','public.aka_agent_refresh_contact_chat_tags(bigint)','EXECUTE') OR has_function_privilege('service_role','public.aka_agent_sync_contact_chat_tag_delta()','EXECUTE') THEN RAISE EXCEPTION 'v290_smoke:private_helper_exposed'; END IF;

  IF has_function_privilege('anon','public.aka_agent_data_group_zalo_facts(bigint)','EXECUTE') THEN RAISE EXCEPTION 'v290_smoke:helper_exposure'; END IF;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  BEGIN
    PERFORM public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix,'#123456',NULL,typ,a.id,NULL,NULL);
    RAISE EXCEPTION 'v290_smoke:missing_auth_guard';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%automation_auth_required%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_mutate_contact_tags(a.staff_id,a.organization_id,ARRAY[c],ARRAY[tag],NULL,NULL,'add');
    RAISE EXCEPTION 'v290_smoke:missing_tag_auth';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%automation_auth_required%' THEN RAISE; END IF; END;
  PERFORM set_config('v290.smoke_result','passed: profile/status parity, pagination, batched tag events, group tags, legacy deltas, scope/auth, tombstones and worker',true);
  RAISE NOTICE 'v290 smoke passed: bindings, ingest, guards, Chat facts/tags/status/events, pagination, ACL/auth';
END;
$smoke$;
SELECT current_setting('v290.smoke_result') AS smoke_result;
ROLLBACK;
