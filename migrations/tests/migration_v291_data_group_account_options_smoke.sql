-- Run after v291. Synthetic rows only; every write rolls back.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $smoke$
DECLARE
 a record; b record; g bigint; mixed bigint; auto_g bigint; dataset_id bigint; c bigint; other_c bigint;
 campaign_id bigint; automation_id bigint; auto_target bigint; rule_group bigint; filter_id bigint;
 typ bigint:=public.aka_agent_data_type_category_item_id('zalo_person');
 prefix text:='v291-smoke-'||txid_current()::text; result jsonb; reason text; options jsonb;
BEGIN
 SELECT x.* INTO a FROM public.auto_accounts x
 WHERE public.aka_agent_data_group_account_available(x.id,x.staff_id,x.organization_id)
 AND EXISTS(SELECT 1 FROM public.auto_accounts y WHERE y.id<>x.id AND y.staff_id=x.staff_id AND y.organization_id=x.organization_id
   AND public.aka_agent_data_group_account_available(y.id,y.staff_id,y.organization_id))
 ORDER BY x.id LIMIT 1;
 SELECT x.* INTO b FROM public.auto_accounts x WHERE x.id<>a.id AND x.staff_id=a.staff_id AND x.organization_id=a.organization_id
 AND public.aka_agent_data_group_account_available(x.id,x.staff_id,x.organization_id) ORDER BY x.id LIMIT 1;
 IF b.id IS NULL THEN RAISE EXCEPTION 'v291_smoke:two_eligible_accounts_required'; END IF;

 SELECT jsonb_agg(o) INTO options FROM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,NULL,typ,NULL,NULL) o;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(options) o WHERE (o->>'account_id')::bigint=b.id AND o->>'reason' IS NULL)
 THEN RAISE EXCEPTION 'v291_smoke:new_group_options'; END IF;
 result:=public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix,'#123456',NULL,typ,NULL,NULL,NULL);g:=(result->>'id')::bigint;
 SELECT o->>'reason' INTO reason FROM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,g,typ,NULL,NULL) o WHERE (o->>'account_id')::bigint=b.id;
 IF reason IS NOT NULL THEN RAISE EXCEPTION 'v291_smoke:empty_group_allows_account'; END IF;

 INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,flatform_type,staff_id,organization_id)
 VALUES(a.id,'person',prefix,prefix||'-a','zalo',a.staff_id,a.organization_id) RETURNING id INTO c;
 INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,flatform_type,staff_id,organization_id)
 VALUES(b.id,'person',prefix,prefix||'-b','zalo',a.staff_id,a.organization_id) RETURNING id INTO other_c;
 PERFORM public.aka_agent_ingest_data_group(a.staff_id,a.organization_id,prefix||'-a',g,'manual',jsonb_build_array(jsonb_build_object('contact_id',c)),NULL,NULL,NULL,NULL,NULL,NULL,typ);
 SELECT o->>'reason' INTO reason FROM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,g,typ,NULL,NULL) o WHERE (o->>'account_id')::bigint=b.id;
 IF reason IS DISTINCT FROM 'data_group_bound_members_mismatch:1' THEN RAISE EXCEPTION 'v291_smoke:member_option:%',reason; END IF;
 BEGIN
  PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,g,NULL,NULL,NULL,NULL,false,b.id,true,NULL,NULL);
  RAISE EXCEPTION 'v291_smoke:missing_member_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>reason THEN RAISE; END IF; END;
 PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,g,NULL,NULL,NULL,NULL,false,a.id,true,NULL,NULL);
 PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,g,NULL,NULL,NULL,NULL,false,NULL,true,NULL,NULL);
 PERFORM public.aka_agent_ingest_data_group(a.staff_id,a.organization_id,prefix||'-b',g,'manual',jsonb_build_array(jsonb_build_object('contact_id',other_c)),NULL,NULL,NULL,NULL,NULL,NULL,typ);
 IF EXISTS(SELECT 1 FROM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,g,typ,NULL,NULL) o WHERE o->>'account_id' IS NOT NULL AND o->>'reason' IS NULL)
 THEN RAISE EXCEPTION 'v291_smoke:mixed_group'; END IF;

 -- An empty current snapshot still has a fixed scan source. Same rule engine, no disabled whole picker.
 INSERT INTO public.auto_account_contacts_dataset(name,source,account_id,flatform_type,contact_type,scan_type,source_key,last_scan_status,staff_id,organization_id,data_type_category_item_id)
 VALUES(prefix,'scan',a.id,'zalo','person','zalo_group_members',prefix,'completed',a.staff_id,a.organization_id,typ)
 RETURNING id INTO dataset_id;
 SELECT d.auto_data_group_id INTO auto_g FROM public.auto_account_contacts_dataset d WHERE d.id=dataset_id;
 IF auto_g IS NULL THEN RAISE EXCEPTION 'v291_smoke:auto_group_missing'; END IF;
 SELECT o->>'reason' INTO reason FROM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,auto_g,typ,NULL,NULL) o WHERE (o->>'account_id')::bigint=b.id;
 IF reason IS DISTINCT FROM 'data_group_bound_source_mismatch' THEN RAISE EXCEPTION 'v291_smoke:dataset_source_option:%',reason; END IF;
 BEGIN
  PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,auto_g,NULL,NULL,NULL,NULL,false,b.id,true,NULL,NULL);
  RAISE EXCEPTION 'v291_smoke:missing_dataset_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>reason THEN RAISE; END IF; END;
 PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,auto_g,NULL,NULL,NULL,NULL,false,a.id,true,NULL,NULL);
 PERFORM public.aka_agent_internal_sync_dataset_auto_group_member(dataset_id,c,true);
 UPDATE public.auto_account_contacts_dataset SET last_scan_status='completed',contact_count=1,updated_at=clock_timestamp() WHERE id=dataset_id;
 IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_groups WHERE id=auto_g AND bound_zalo_account_id=a.id)
 OR NOT EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE group_id=auto_g AND contact_id=c AND NOT is_delete)
 THEN RAISE EXCEPTION 'v291_smoke:rescan_preserves_binding'; END IF;
 BEGIN
  PERFORM public.aka_agent_internal_sync_dataset_auto_group_member(dataset_id,other_c,true);
  RAISE EXCEPTION 'v291_smoke:missing_rescan_guard';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'data_group_bound_source_mismatch' THEN RAISE; END IF; END;
 PERFORM public.aka_agent_update_data_group_v2(a.staff_id,a.organization_id,auto_g,NULL,NULL,NULL,NULL,false,NULL,true,NULL,NULL);

 -- Active automation constrains an otherwise empty, manually-created group too.
 result:=public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix||'-automation','#123456',NULL,typ,NULL,NULL,NULL); auto_target:=(result->>'id')::bigint;
 INSERT INTO public.auto_campaigns(name,account_id,action_id,staff_id,organization_id,status)
 VALUES(prefix,a.id,'zalo_message_friend',a.staff_id,a.organization_id,'tạm dừng') RETURNING id INTO campaign_id;
 INSERT INTO public.auto_automation(name,source_campaign_id,target_data_group_id,data_type_code,data_type_category_item_id,is_active,activated_at,staff_id,organization_id)
 VALUES(prefix,campaign_id,auto_target,'zalo_uid',typ,true,clock_timestamp(),a.staff_id,a.organization_id) RETURNING id INTO automation_id;
 SELECT o->>'reason' INTO reason FROM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,auto_target,typ,NULL,NULL) o WHERE (o->>'account_id')::bigint=b.id;
 IF reason IS DISTINCT FROM 'data_group_bound_source_mismatch' THEN RAISE EXCEPTION 'v291_smoke:automation_option:%',reason; END IF;

 -- Explicit rule account is checked even without members or an enabled filter.
 result:=public.aka_agent_create_data_group_v2(a.staff_id,a.organization_id,prefix||'-rule','#123456',NULL,typ,NULL,NULL,NULL); rule_group:=(result->>'id')::bigint;
 PERFORM public.aka_agent_save_data_group_dynamic_filter(a.staff_id,a.organization_id,rule_group,false,
 jsonb_build_array(jsonb_build_object('scope_code','enter','join_code','and','field_code','zalo_friend_status','operator_code','equals','account_id',a.id,'value_keys',jsonb_build_array('friend'),'value_labels',jsonb_build_array('Bạn bè'))),NULL,NULL);
 SELECT o->>'reason' INTO reason FROM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,rule_group,typ,NULL,NULL) o WHERE (o->>'account_id')::bigint=b.id;
 IF reason IS DISTINCT FROM 'data_group_bound_rule_mismatch' THEN RAISE EXCEPTION 'v291_smoke:rule_option:%',reason; END IF;

 -- Existing rows/account permissions are tenant scoped; helper remains private.
 BEGIN
  PERFORM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,-1,typ,NULL,NULL);
  RAISE EXCEPTION 'v291_smoke:missing_group_guard';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'data_group_not_found' THEN RAISE; END IF; END;
 IF has_function_privilege('anon','public.aka_agent_data_group_account_options_internal(public.auto_account_contact_groups,bigint[])','EXECUTE')
 THEN RAISE EXCEPTION 'v291_smoke:private_helper_acl'; END IF;
 PERFORM set_config('request.jwt.claim.role','anon',true);
 BEGIN
  PERFORM public.aka_agent_get_data_group_account_options(a.staff_id,a.organization_id,g,typ,NULL,NULL);
  RAISE EXCEPTION 'v291_smoke:missing_auth';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%automation_auth_required%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
END;
$smoke$;
ROLLBACK;
