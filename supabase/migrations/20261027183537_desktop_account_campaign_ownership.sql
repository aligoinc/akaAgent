-- Live capture: migrations/snapshots/desktop-account-ownership/before.json. No customer data changes.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='5a9a503db72b965eb644739f5f60905d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_claim_allowed(bigint,bigint,text)') AND md5(pg_get_functiondef(oid))='e204dc76d6ca7fe8806d135b53201902' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_claim_allowed(bigint,bigint,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)') AND md5(pg_get_functiondef(oid))='687fc3efe8378dd175f88f852bc47a51' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_orphan_turns(bigint,bigint)') AND md5(pg_get_functiondef(oid))='ea0c365929e5731b4e6436bfc1c58883' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_orphan_turns(bigint,bigint)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_pause_requested(bigint,bigint,uuid)') AND md5(pg_get_functiondef(oid))='172635824af6f7a3a0cae242c0d1d978' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_pause_requested(bigint,bigint,uuid)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_unit_gate(bigint,bigint,uuid,integer)') AND md5(pg_get_functiondef(oid))='39c1403afa099c706b38f2850adf52ec' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_unit_gate(bigint,bigint,uuid,integer)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_unit_recover(bigint,bigint,uuid)') AND md5(pg_get_functiondef(oid))='0aea61ae267927a82b4f3e921ba468cf' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_unit_recover(bigint,bigint,uuid)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_unit_settled(bigint,bigint,uuid,boolean)') AND md5(pg_get_functiondef(oid))='865b74966309d70fbb81f9e76dd491a0' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_unit_settled(bigint,bigint,uuid,boolean)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.facebook_random_unit_started(bigint,bigint,uuid)') AND md5(pg_get_functiondef(oid))='62ffac318d74ac671a5a1b9e51630c4a' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.facebook_random_unit_started(bigint,bigint,uuid)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') AND md5(pg_get_functiondef(oid))='07630b82e68cba560a8c7538b24702d5' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])') AND md5(pg_get_functiondef(oid))='65cd07b8ae16017794e56977c2f76aff' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)') AND md5(pg_get_functiondef(oid))='841a8fc8da0bca527508e71dcdc6b8fa' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='92b00c0827a801e9ffece28d14805f84' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_facebook_login(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='4ab7e726d3bc9c9e17c35b61f186ed55' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_facebook_login(bigint,text,text,text,jsonb)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(bigint,bigint,text,integer)') AND md5(pg_get_functiondef(oid))='01a16672ec57fac76a9afe140a242f11' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_finalize_expired_zalo_server_data_group_campaigns(bigint,bigint,text,integer)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)') AND md5(pg_get_functiondef(oid))='d6ea4c72508274a8c3fc8c827e52276d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)') AND md5(pg_get_functiondef(oid))='0cf1c121dc19713c46305bbf41dec680' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_contact_dataset_member_ids(bigint,bigint,bigint,bigint,text)') AND md5(pg_get_functiondef(oid))='a726cda368e948073c609d963912e637' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_contact_dataset_member_ids(bigint,bigint,bigint,bigint,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_contact_datasets(bigint,bigint,bigint,text,text,text,text)') AND md5(pg_get_functiondef(oid))='e0a575612eb1ce7a72dbe47e65daf62a' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_contact_datasets(bigint,bigint,bigint,text,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_email_campaign_link_tracking_summaries(bigint)') AND md5(pg_get_functiondef(oid))='be12f4fe693b615e984d660116d5267d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_email_campaign_link_tracking_summaries(bigint)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') AND md5(pg_get_functiondef(oid))='74c082aacb1de27a8cedff2e824f219f' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_lock_campaign_input_serialization(bigint)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_prepare_zalo_message_opt_out(bigint,bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='0217c031e0d6aaef63c2589cbe1f7b94' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_prepare_zalo_message_opt_out(bigint,bigint,bigint,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)') AND md5(pg_get_functiondef(oid))='a46368117d2815b67442383cd753089b' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)') AND md5(pg_get_functiondef(oid))='006a6da075ede4e9c6b07194422f65c9' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)') AND md5(pg_get_functiondef(oid))='b4be76b63cd90ef5f4d7bdd93a22b288' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.append_auto_campaign_log(bigint,bigint,text)') AND md5(pg_get_functiondef(oid))='230e219f5b854a2d2154ee0dc6c867a2' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','append_auto_campaign_log(bigint,bigint,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text)') AND md5(pg_get_functiondef(oid))='91fb0001b629cb058a41454068b439d2' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_finalize_zalo_server_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid)') AND md5(pg_get_functiondef(oid))='c97300fa762faa37e7b931761a9b2abb' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_finalize_zalo_server_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.reconcile_auto_automation_enqueue_failures(bigint,bigint,text,integer,text,text)') AND md5(pg_get_functiondef(oid))='8cb7ed969e34334dc874f2ffea08a93d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','reconcile_auto_automation_enqueue_failures(bigint,bigint,text,integer,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='869d902d319748ea1ce3376b3526df3d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='9391f47e1be976e0d7e595325d3c2f31' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)') AND md5(pg_get_functiondef(oid))='8cd5def0920f178d5efed9fb73ddefab' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_desktop_campaign_logs(bigint,bigint,text,text,jsonb,bigint,jsonb)') AND md5(pg_get_functiondef(oid))='61f1ce6860cfc474d998cc70005717a1' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_desktop_campaign_logs(bigint,bigint,text,text,jsonb,bigint,jsonb)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)') AND md5(pg_get_functiondef(oid))='2c7b2243ebe72dbd544a270dd56310fc' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)') AND md5(pg_get_functiondef(oid))='df426447a1fd533e052437699bb8dd5d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)') AND md5(pg_get_functiondef(oid))='475e69ab388df822777e035d1dd03cb4' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='d225647b4faec110607f9bfb1d574511' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_campaign_automation_details(bigint,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text)') AND md5(pg_get_functiondef(oid))='ecad3867d725b6fbb27148366f90b6ce' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_campaign_automation_details(bigint,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_campaign_detail_automation_triggers(bigint,bigint,bigint,bigint[],text,text)') AND md5(pg_get_functiondef(oid))='56822434723347452c8944484764daea' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_campaign_detail_automation_triggers(bigint,bigint,bigint,bigint[],text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)') AND md5(pg_get_functiondef(oid))='10fc44b5eb273974bb44aa3aaf757630' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[])') AND md5(pg_get_functiondef(oid))='6faf48dceae54faacb69b6c3aa3b5ca6' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[])'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text)') AND md5(pg_get_functiondef(oid))='440e2c6163518d4c0563c275d33e8474' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='967d28f6e9df5472bfefeffa6746ffb7' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)') AND md5(pg_get_functiondef(oid))='56c07dc3ce73ba9bb5e0660bf15ab34e' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)') AND md5(pg_get_functiondef(oid))='7f163f902b82a72f8f850e432050a7e6' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)') AND md5(pg_get_functiondef(oid))='aa9006241ecdb9a8bb4fccd4a868dc67' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)') AND md5(pg_get_functiondef(oid))='9cc36d9836b829660a9d5f29f2db281d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'ownership function source drift: %','private.aka_agent_staff_scope_for_request()'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_accounts'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=arw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_accounts'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_campaigns'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=rw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_campaigns'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_account_groups'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=r/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_account_groups'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_proxies'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_proxies'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_account_action_status'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=arw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_account_action_status'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_account_error_state'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=arw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_account_error_state'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_account_logs'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_account_logs'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_campaign_inputs'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=rw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_campaign_inputs'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_campaign_input_data'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=arw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_campaign_input_data'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_campaign_details'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=ar/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_campaign_details'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_campaign_error_state'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=arw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_campaign_error_state'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_email_message_trackings'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_email_message_trackings'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_email_link_trackings'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_email_link_trackings'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_runs'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_runs'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_run_steps'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_run_steps'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_campaign_zalo_realtime_group_events'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=arw/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_campaign_zalo_realtime_group_events'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_campaign_run_events'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=r/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_campaign_run_events'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_zalo_api_error_logs'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=a/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: auto_zalo_api_error_logs'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.ai_log'::regclass AND relrowsecurity=true AND relforcerowsecurity=false AND relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=a/postgres,crm_interest_worker=ar/postgres}' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'ownership relation source drift: ai_log'; END IF;
IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN (to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)'),to_regprocedure('private.aka_agent_guard_parent_ownership()'))) THEN RAISE EXCEPTION 'ownership helper already exists'; END IF;
IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename=ANY(ARRAY['auto_accounts','auto_campaigns','auto_account_groups','auto_proxies','auto_account_action_status','auto_account_error_state','auto_account_logs','auto_campaign_inputs','auto_campaign_input_data','auto_campaign_details','auto_campaign_error_state','auto_email_message_trackings','auto_email_link_trackings','auto_runs','auto_run_steps','auto_campaign_zalo_realtime_group_events','auto_campaign_run_events','auto_zalo_api_error_logs','ai_log'])) IS DISTINCT FROM '[{"cmd":"SELECT","qual":"(created_at >= (now() - ''00:05:00''::interval))","roles":["anon","authenticated"],"tablename":"ai_log","permissive":"PERMISSIVE","policyname":"ai_log_client_select_after_insert","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["anon","authenticated"],"tablename":"ai_log","permissive":"PERMISSIVE","policyname":"chat_followup_ai_log_client_insert_guard","schemaname":"public","with_check":"(COALESCE(block_name, ''''::text) <> ''chat-followup-precreate-v2''::text)"},{"cmd":"INSERT","qual":null,"roles":["aka_agent_desktop"],"tablename":"ai_log","permissive":"PERMISSIVE","policyname":"desktop_legacy_0","schemaname":"public","with_check":"(COALESCE(block_name, ''''::text) <> ''chat-followup-precreate-v2''::text)"},{"cmd":"SELECT","qual":"(created_at >= (now() - ''00:05:00''::interval))","roles":["aka_agent_desktop"],"tablename":"ai_log","permissive":"PERMISSIVE","policyname":"desktop_legacy_1","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_account_action_status","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_account_error_state","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_account_groups","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"INSERT","qual":null,"roles":["aka_agent_chat_api","anon","authenticated"],"tablename":"auto_account_logs","permissive":"PERMISSIVE","policyname":"auto_account_logs_insert","schemaname":"public","with_check":"((EXISTS ( SELECT 1\n   FROM auto_accounts a\n  WHERE (a.id = auto_account_logs.account_id))) AND ((campaign_id IS NULL) OR (EXISTS ( SELECT 1\n   FROM auto_campaigns c\n  WHERE ((c.id = auto_account_logs.campaign_id) AND ((c.account_id = auto_account_logs.account_id) OR (c.secondary_account_id = auto_account_logs.account_id)))))))"},{"cmd":"INSERT","qual":null,"roles":["aka_agent_desktop"],"tablename":"auto_account_logs","permissive":"PERMISSIVE","policyname":"desktop_legacy_0","schemaname":"public","with_check":"((EXISTS ( SELECT 1\n   FROM auto_accounts a\n  WHERE (a.id = auto_account_logs.account_id))) AND ((campaign_id IS NULL) OR (EXISTS ( SELECT 1\n   FROM auto_campaigns c\n  WHERE ((c.id = auto_account_logs.campaign_id) AND ((c.account_id = auto_account_logs.account_id) OR (c.secondary_account_id = auto_account_logs.account_id)))))))"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_accounts","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_campaign_details","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_campaign_error_state","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_campaign_input_data","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_campaign_inputs","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_campaign_run_events","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_campaign_zalo_realtime_group_events","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_campaigns","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_email_link_trackings","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_email_message_trackings","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_proxies","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_run_steps","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_runs","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_zalo_api_error_logs","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"}]'::jsonb THEN RAISE EXCEPTION 'ownership policy source drift'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint DEFAULT NULL, p_account_id bigint DEFAULT NULL, p_campaign_id bigint DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
BEGIN
 IF v_staff IS NULL THEN RETURN true; END IF;
 IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied';
 END IF;
 -- Preserve each caller's existing not-found/cleanup semantics.
 IF p_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_account_scope_denied'; END IF;
 IF p_campaign_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=p_campaign_id AND staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_campaign_scope_denied'; END IF;
 RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) TO aka_agent_desktop,service_role,aka_agent_chat_api;
CREATE OR REPLACE FUNCTION private.aka_agent_guard_parent_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request(); v_org bigint;
BEGIN
 IF v_staff IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF v_staff<=0 OR (TG_OP<>'INSERT' AND OLD.staff_id IS DISTINCT FROM v_staff)
   OR (TG_OP<>'DELETE' AND NEW.staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_parent_owner_denied'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.staff_id IS DISTINCT FROM OLD.staff_id THEN
   SELECT organization_id INTO v_org FROM public.org_staff WHERE id=v_staff;
   IF NEW.organization_id IS DISTINCT FROM v_org THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_parent_organization_denied'; END IF;
 END IF;
 IF TG_TABLE_NAME='auto_campaigns' THEN
   PERFORM private.aka_agent_assert_request_ownership(v_staff,NEW.account_id,NEW.id);
   PERFORM private.aka_agent_assert_request_ownership(v_staff,NEW.secondary_account_id,NULL);
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_guard_parent_ownership() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.aka_agent_guard_parent_ownership() TO aka_agent_desktop,service_role,aka_agent_chat_api;
CREATE OR REPLACE FUNCTION public.auto_assert_automation_identity(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_claim_role text;
  v_claims jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.

  v_claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_claim_role IS NULL THEN
    BEGIN
      v_claims := NULLIF(
        current_setting('request.jwt.claims', true),
        ''
      )::jsonb;
      v_claim_role := NULLIF(v_claims ->> 'role', '');
    EXCEPTION
      WHEN OTHERS THEN
        v_claim_role := NULL;
    END;
  END IF;

  IF v_claim_role IS NULL THEN
    v_claim_role := NULLIF(auth.jwt() ->> 'role', '');
  END IF;

  IF v_claim_role = 'service_role' THEN
    RETURN;
  END IF;

  IF p_auth_username IS NULL OR p_auth_password IS NULL THEN
    RAISE EXCEPTION 'automation_auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
      AND staff.username = p_auth_username
      AND staff.password = p_auth_password
  ) THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_claim_allowed(p_campaign bigint, p_account bigint, p_turn text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH desktop_request_guard AS MATERIALIZED (SELECT private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign) AS allowed)
 SELECT result.* FROM desktop_request_guard
 CROSS JOIN LATERAL (
SELECT EXISTS (
   SELECT 1 FROM public.auto_account_random_run_days d
   JOIN public.auto_accounts a ON a.id=d.account_id,
   LATERAL (SELECT x FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY q(x,n)
     WHERE x->>'status' IN ('planned','running') ORDER BY n LIMIT 1) next_turn
   WHERE d.account_id=p_account AND d.run_date=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date
     AND d.status='open' AND next_turn.x->>'status'='planned'
     AND next_turn.x->>'id'=p_turn AND (next_turn.x->>'campaignId')::bigint=p_campaign
     AND (next_turn.x->>'revision')::int=(a.facebook_random_run_config->>'revision')::int
 )
 ) AS result WHERE desktop_request_guard.allowed;
$function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_finalize_turn(p_campaign bigint, p_account bigint, p_claim uuid, p_unit uuid, p_recovered boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.auto_campaigns%ROWTYPE; d public.auto_account_random_run_days%ROWTYPE; turns jsonb; reason text;
 today date:=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign); -- Bind Desktop token before privileged work.

 SELECT * INTO c FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account;
 IF NOT FOUND OR (p_claim IS NULL AND p_unit IS NULL) THEN RETURN; END IF;
 IF NOT p_recovered AND (c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL) THEN RETURN; END IF;
 IF p_recovered AND ((c.runtime_unit_token IS NOT NULL AND c.runtime_unit_token IS DISTINCT FROM p_unit)
   OR (c.runtime_claim_token IS NOT NULL AND c.runtime_claim_token IS DISTINCT FROM p_claim)) THEN RETURN; END IF;
 reason:=CASE WHEN p_recovered THEN 'Lượt chạy đã gián đoạn; không tự phát lại thao tác chưa rõ kết quả'
   WHEN c.is_delete THEN 'Chiến dịch đã bị xóa'
   WHEN c.status='tạm dừng' THEN coalesce(nullif(c.note,''),'Chiến dịch đã tạm dừng')
   ELSE nullif(c.note,'') END;
 FOR d IN SELECT * FROM public.auto_account_random_run_days dd WHERE dd.account_id=p_account AND dd.staff_id=c.staff_id AND dd.status='open'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(dd.state->'turns') x WHERE x->>'status'='running' AND (x->>'campaignId')::bigint=p_campaign
     AND ((p_claim IS NOT NULL AND x->>'claimToken'=p_claim::text) OR (p_unit IS NOT NULL AND (x->>'unitToken'=p_unit::text OR x->>'lastUnitToken'=p_unit::text)))) FOR UPDATE LOOP
   SELECT jsonb_agg(CASE WHEN x->>'status'='running' AND (x->>'campaignId')::bigint=p_campaign
     AND ((p_claim IS NOT NULL AND x->>'claimToken'=p_claim::text) OR (p_unit IS NOT NULL AND (x->>'unitToken'=p_unit::text OR x->>'lastUnitToken'=p_unit::text)))
     THEN (x-'unitToken'-'unitStartedAt')||jsonb_build_object('status',CASE WHEN reason IS NOT NULL OR (x->>'processed')::int=0 THEN 'stopped' ELSE 'completed' END,
       'reason',coalesce(reason,CASE WHEN (x->>'processed')::int=0 THEN 'Đợt chưa thực hiện được đối tượng nào' END),'endedAt',clock_timestamp())
     WHEN x->>'status'='planned' AND d.run_date<today THEN x||jsonb_build_object('status','expired','reason','Hết ngày','endedAt',clock_timestamp())
     ELSE x END ORDER BY n) INTO turns FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY q(x,n);
   UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,'{turns}',turns),updated_at=clock_timestamp(),
     status=CASE WHEN run_date<today AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(turns) x WHERE x->>'status'='running') THEN 'closed' ELSE status END WHERE id=d.id;
 END LOOP;
END $function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_orphan_turns(p_staff bigint, p_org bigint)
 RETURNS TABLE(id bigint, account_id bigint, claim text, unit text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH desktop_request_guard AS MATERIALIZED (SELECT private.aka_agent_assert_request_ownership(p_staff, NULL, NULL) AS allowed)
 SELECT result.* FROM desktop_request_guard
 CROSS JOIN LATERAL (
SELECT DISTINCT c.id,c.account_id,x->>'claimToken',x->>'lastUnitToken'
 FROM public.auto_account_random_run_days d CROSS JOIN LATERAL jsonb_array_elements(d.state->'turns') x
 JOIN public.auto_campaigns c ON c.id=(x->>'campaignId')::bigint AND c.account_id=d.account_id AND c.staff_id=d.staff_id
 JOIN public.auto_accounts a ON a.id=c.account_id AND a.staff_id=c.staff_id
 JOIN public.org_staff s ON s.id=c.staff_id AND s.organization_id=p_org
 WHERE d.staff_id=p_staff AND d.organization_id=p_org AND d.status='open' AND x->>'status'='running'
   AND a.flatform_type='facebook' AND (c.organization_id IS NULL OR c.organization_id=p_org) AND (a.organization_id IS NULL OR a.organization_id=p_org)
   AND c.runtime_claim_token IS NULL AND c.runtime_unit_token IS NULL AND c.status<>'đang chạy'
 ) AS result WHERE desktop_request_guard.allowed;
$function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_pause_requested(p_campaign bigint, p_account bigint, p_claim uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH desktop_request_guard AS MATERIALIZED (SELECT private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign) AS allowed)
 SELECT result.* FROM desktop_request_guard
 CROSS JOIN LATERAL (
SELECT EXISTS(
   SELECT 1 FROM public.auto_campaigns c JOIN public.auto_account_random_run_days d ON d.account_id=c.account_id AND d.staff_id=c.staff_id,
     jsonb_array_elements(d.state->'turns') x
   WHERE c.id=p_campaign AND c.account_id=p_account AND c.runtime_claim_token=p_claim AND c.note='Đang chờ tạm dừng'
     AND d.status='open' AND x->>'campaignId'=p_campaign::text AND x->>'claimToken'=p_claim::text AND x->>'status'='running'
 )
 ) AS result WHERE desktop_request_guard.allowed;
$function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_unit_gate(p_campaign bigint, p_account bigint, p_claim uuid, p_count integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t jsonb; enabled boolean;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign); -- Bind Desktop token before privileged work.

 SELECT a.facebook_random_run_enabled INTO enabled FROM public.auto_accounts a WHERE a.id=p_account AND a.flatform_type='facebook';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT x INTO t FROM public.auto_account_random_run_days d, jsonb_array_elements(d.state->'turns') x
 WHERE d.account_id=p_account AND d.status='open' AND x->>'claimToken'=p_claim::text AND (x->>'campaignId')::bigint=p_campaign AND x->>'status'='running';
 IF enabled AND t IS NULL OR NOT enabled AND t IS NOT NULL THEN RETURN 'random_mode_changed'; END IF;
 IF t IS NULL THEN RETURN NULL; END IF;
 IF (t->>'unit'='data' AND (t->>'processed')::int+p_count>(t->>'quantity')::int)
   OR (t->>'unit'<>'data' AND (t->>'processed')::int>=1) THEN RETURN 'random_budget_exhausted'; END IF;
 RETURN NULL;
END $function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_unit_recover(p_campaign bigint, p_account bigint, p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record;t jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign); -- Bind Desktop token before privileged work.

 SELECT runtime_unit_input_data_ids ids,runtime_claim_token claim INTO c FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT x INTO t FROM public.auto_account_random_run_days d,jsonb_array_elements(d.state->'turns') x
 WHERE d.account_id=p_account AND d.status='open' AND x->>'unitToken'=p_unit::text AND x->>'status'='running';
 IF t IS NULL THEN RETURN; END IF;
 PERFORM private.facebook_random_unit_settled(p_campaign,p_account,p_unit,true);
 UPDATE public.auto_campaign_input_data SET status='hoàn thành',note='Lượt ngẫu nhiên bị gián đoạn; kết quả chưa rõ, không tự thực hiện lại'
 WHERE campaign_id=p_campaign AND id=ANY(c.ids) AND status IN ('đang chạy','chờ xử lý');
 IF t->>'unit'<>'data' THEN
   UPDATE public.auto_campaigns SET status='tạm dừng',note='Lượt ngẫu nhiên bị gián đoạn; kiểm tra kết quả trước khi chạy lại' WHERE id=p_campaign;
 END IF;
 PERFORM private.facebook_random_finalize_turn(p_campaign,p_account,c.claim,p_unit,true);
END $function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_unit_settled(p_campaign bigint, p_account bigint, p_unit uuid, p_cancelled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record; done integer; seconds integer;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign); -- Bind Desktop token before privileged work.

 SELECT runtime_unit_input_data_ids ids, runtime_unit_vietnam_date AS unit_day, runtime_unit_claimed_at started
 INTO c FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*)::int INTO done FROM public.auto_campaign_input_data i WHERE i.campaign_id=p_campaign AND i.id=ANY(c.ids)
 AND i.status NOT IN ('chờ xử lý','đang chạy');
 seconds:=greatest(0,floor(extract(epoch FROM clock_timestamp()-c.started))::int);
 UPDATE public.auto_account_random_run_days d SET state=jsonb_set(d.state,'{turns}',(
   SELECT jsonb_agg(CASE WHEN x->>'unitToken'=p_unit::text AND x->>'status'='running'
     THEN (x-'unitToken'-'unitStartedAt')||jsonb_build_object(
       'processed',(x->>'processed')::int+CASE WHEN x->>'unit'='data' THEN done WHEN p_cancelled THEN 0 ELSE 1 END,
       'elapsedSeconds',CASE WHEN x->>'unit'='minute' AND NOT p_cancelled THEN least((x->>'quantity')::bigint*60,seconds) ELSE coalesce((x->>'elapsedSeconds')::int,0) END,
       'lastUnitToken',p_unit) ELSE x END ORDER BY n)
   FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY a(x,n))),updated_at=clock_timestamp()
 WHERE d.account_id=p_account AND d.run_date=c.unit_day AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'unitToken'=p_unit::text AND x->>'status'='running');
END $function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_unit_started(p_campaign bigint, p_account bigint, p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign); -- Bind Desktop token before privileged work.

 SELECT runtime_claim_token, runtime_unit_claimed_at, runtime_unit_vietnam_date INTO c
 FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.auto_account_random_run_days d SET state=jsonb_set(d.state,'{turns}',(
   SELECT jsonb_agg(CASE WHEN x->>'claimToken'=c.runtime_claim_token::text AND x->>'status'='running'
     THEN x||jsonb_build_object('unitToken',p_unit,'unitStartedAt',c.runtime_unit_claimed_at) ELSE x END ORDER BY n)
   FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY AS a(x,n))), updated_at=clock_timestamp()
 WHERE d.account_id=p_account AND d.run_date=c.runtime_unit_vietnam_date
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'claimToken'=c.runtime_claim_token::text AND x->>'status'='running');
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_apply_campaign_delivery_cooldown(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[])
 RETURNS TABLE(input_data_id bigint, decision text, note text, last_sent_at timestamp with time zone, eligible_date date, source_campaign_id bigint, source_campaign_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_extra jsonb;
  v_enabled boolean;
  v_all_accounts boolean;
  v_days_text text;
  v_days integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := pg_catalog.timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_history_since timestamptz;
  v_target_kind text;
  v_history_action_codes text[];
  v_ids bigint[];
  v_requested_count integer;
  v_locked_count integer;
  v_supported boolean := true;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_scope';
  END IF;

  SELECT pg_catalog.array_agg(requested.id ORDER BY requested.ordinality), pg_catalog.count(*)::integer
  INTO v_ids, v_requested_count
  FROM (
    SELECT DISTINCT ON (u.id) u.id, u.ordinality
    FROM pg_catalog.unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) WITH ORDINALITY AS u(id, ordinality)
    WHERE u.id IS NOT NULL AND u.id > 0
    ORDER BY u.id, u.ordinality
  ) AS requested;

  IF v_requested_count IS NULL OR v_requested_count < 1 OR v_requested_count > 500 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_batch_size';
  END IF;

  SELECT c.*
  INTO v_campaign
  FROM public.auto_campaigns AS c
  JOIN public.auto_accounts AS a
    ON a.id = c.account_id
   AND a.staff_id = p_staff_id
   AND a.organization_id = c.organization_id
   AND COALESCE(a.is_delete, false) = false
  JOIN public.org_staff AS s
    ON s.id = p_staff_id
   AND s.organization_id = c.organization_id
   AND s.is_active = true
  WHERE c.id = p_campaign_id
    AND c.account_id = p_account_id
    AND c.staff_id = p_staff_id
    AND COALESCE(c.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_delivery_cooldown_scope_not_found';
  END IF;

  PERFORM i.id
  FROM public.auto_campaign_input_data AS i
  WHERE i.id = ANY(v_ids)
    AND i.campaign_id = p_campaign_id
    AND COALESCE(i.is_delete, false) = false
  ORDER BY i.id
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_count = ROW_COUNT;

  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'campaign_delivery_cooldown_input_scope_mismatch';
  END IF;

  v_extra := COALESCE(v_campaign.extra_settings, '{}'::jsonb);
  v_enabled := COALESCE((v_extra->>'recentDeliveryCooldownEnabled')::boolean, false);
  v_all_accounts := v_campaign.action_id = 'zalo_message_phone'
    AND COALESCE(v_extra->'recentDeliveryCooldownAllAccounts' = 'true'::jsonb, false);

  IF NOT v_enabled THEN
    RETURN QUERY
    SELECT i.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text
    FROM public.auto_campaign_input_data AS i
    WHERE i.id = ANY(v_ids)
    ORDER BY pg_catalog.array_position(v_ids, i.id);
    RETURN;
  END IF;

  v_days_text := COALESCE(NULLIF(pg_catalog.btrim(v_extra->>'recentDeliveryCooldownDays'), ''), '3');
  IF v_days_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_days';
  END IF;
  v_days := v_days_text::integer;
  IF v_days < 1 OR v_days > 3650 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_days';
  END IF;

  CASE v_campaign.action_id
    WHEN 'facebook_group_post' THEN
      v_target_kind := 'facebook_group';
      v_history_action_codes := ARRAY['fb_post_group', 'fb_post_page'];
    WHEN 'facebook_page_post' THEN
      v_target_kind := 'facebook_page';
      v_history_action_codes := ARRAY['fb_post_group', 'fb_post_page'];
    WHEN 'facebook_message_friend' THEN
      v_target_kind := 'facebook_person';
      v_history_action_codes := ARRAY['fb_message_friend', 'fb_message_stranger'];
    WHEN 'facebook_message_uid' THEN
      IF COALESCE((v_extra->>'enableMessage')::boolean, true) THEN
        v_target_kind := 'facebook_person';
        v_history_action_codes := ARRAY['fb_message_friend', 'fb_message_stranger'];
      ELSE
        v_supported := false;
      END IF;
    WHEN 'facebook_page_to_message' THEN
      v_target_kind := 'facebook_page_inbox';
      v_history_action_codes := ARRAY['fb_message_page_inbox_customer'];
    WHEN 'zalo_message_friend', 'zalo_message_birthday' THEN
      v_target_kind := 'zalo_person';
      v_history_action_codes := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
    WHEN 'zalo_message_group' THEN
      v_target_kind := 'zalo_group';
      v_history_action_codes := ARRAY['zalo_message_group'];
    WHEN 'zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
         'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation' THEN
      IF COALESCE((v_extra->>'enableMessage')::boolean, false) THEN
        v_target_kind := 'zalo_person';
        v_history_action_codes := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
      ELSE
        v_supported := false;
      END IF;
    WHEN 'sms_send' THEN
      v_target_kind := 'phone';
      v_history_action_codes := ARRAY['sms_send'];
    WHEN 'email_send' THEN
      v_target_kind := 'email';
      v_history_action_codes := ARRAY['email_send'];
    ELSE
      v_supported := false;
  END CASE;

  IF NOT v_supported THEN
    RETURN QUERY
    SELECT i.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text
    FROM public.auto_campaign_input_data AS i
    WHERE i.id = ANY(v_ids)
    ORDER BY pg_catalog.array_position(v_ids, i.id);
    RETURN;
  END IF;

  v_history_since := ((v_today - (v_days - 1))::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');

  RETURN QUERY
  WITH requested AS MATERIALIZED (
    SELECT
      i.id,
      i.status,
      u.ordinality,
      public.aka_agent_internal_delivery_cooldown_target_keys(
        v_target_kind,
        i.uid,
        i.phone,
        i.email
      ) AS target_keys
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS u(id, ordinality)
    JOIN public.auto_campaign_input_data AS i ON i.id = u.id
  ),
  batch_duplicates AS MATERIALIZED (
    SELECT current_row.id
    FROM requested AS current_row
    WHERE EXISTS (
      SELECT 1
      FROM requested AS earlier_row
      WHERE earlier_row.ordinality < current_row.ordinality
        AND earlier_row.target_keys && current_row.target_keys
    )
  ),
  requested_keys AS MATERIALIZED (
    SELECT COALESCE(pg_catalog.array_agg(DISTINCT target.key), ARRAY[]::text[]) AS keys
    FROM requested AS r
    CROSS JOIN LATERAL pg_catalog.unnest(r.target_keys) AS target(key)
  ),
  history_accounts AS MATERIALIZED (
    SELECT p_account_id AS id WHERE NOT v_all_accounts
    UNION ALL
    SELECT a.id
    FROM public.auto_accounts AS a
    WHERE v_all_accounts
      AND a.staff_id = p_staff_id
      AND a.organization_id = v_campaign.organization_id
  ),
  history AS MATERIALIZED (
    -- Keep V367's disjoint committed/legacy branches and existing partial indexes.
    -- Filter to this batch before materializing history or reading campaign names.
    SELECT d.id AS detail_id, d.created_at, d.campaign_id, keys.target_keys
    FROM history_accounts AS account
    CROSS JOIN LATERAL (
      SELECT hd.id, hd.created_at, hd.campaign_id, hd.input_data_id, hd.action_code
      FROM public.auto_campaign_details AS hd
      WHERE hd.account_id = account.id AND hd.action_code = ANY(v_history_action_codes)
        AND hd.created_at >= v_history_since AND hd.created_at <= v_now
        AND hd.policy_snapshot->>'operationState' = 'committed'
      UNION ALL
      SELECT hd.id, hd.created_at, hd.campaign_id, hd.input_data_id, hd.action_code
      FROM public.auto_campaign_details AS hd
      WHERE hd.account_id = account.id AND hd.action_code = ANY(v_history_action_codes)
        AND hd.created_at >= v_history_since AND hd.created_at <= v_now
        AND hd.policy_snapshot->>'operationState' IS NULL
        AND hd.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
    ) AS d
    JOIN public.auto_campaign_input_data AS source_input ON source_input.id = d.input_data_id
    CROSS JOIN LATERAL (
      -- Same key expressions as the guarded target-key helper. Array overlap
      -- ignores NULL/duplicate elements, avoiding per-history-row aggregation.
      SELECT ARRAY[
        CASE CASE d.action_code
            WHEN 'fb_post_group' THEN 'facebook_group'
            WHEN 'fb_post_page' THEN 'facebook_page'
            WHEN 'fb_message_friend' THEN 'facebook_person'
            WHEN 'fb_message_stranger' THEN 'facebook_person'
            WHEN 'fb_message_page_inbox_customer' THEN 'facebook_page_inbox'
            WHEN 'zalo_message_friend' THEN 'zalo_person'
            WHEN 'zalo_message_stranger' THEN 'zalo_person'
            WHEN 'zalo_message_group' THEN 'zalo_group'
            WHEN 'sms_send' THEN 'phone'
            WHEN 'email_send' THEN 'email'
            ELSE ''
          END
          WHEN 'facebook_group' THEN NULLIF('facebook_group:' ||
            public.aka_agent_internal_normalize_facebook_identity(COALESCE(source_input.uid, '')), 'facebook_group:')
          WHEN 'facebook_page' THEN NULLIF('facebook_page:' ||
            public.aka_agent_internal_normalize_facebook_identity(COALESCE(source_input.uid, '')), 'facebook_page:')
          WHEN 'facebook_person' THEN NULLIF('facebook_person:' ||
            public.aka_agent_internal_normalize_facebook_identity(COALESCE(source_input.uid, '')), 'facebook_person:')
          WHEN 'facebook_page_inbox' THEN NULLIF('facebook_page_inbox:' ||
            public.aka_agent_internal_normalize_facebook_identity(COALESCE(source_input.uid, '')), 'facebook_page_inbox:')
          WHEN 'zalo_person' THEN NULLIF('zalo_person_uid:' ||
            lower(pg_catalog.btrim(COALESCE(source_input.uid, ''))), 'zalo_person_uid:')
          WHEN 'zalo_group' THEN NULLIF('zalo_group:' ||
            lower(pg_catalog.btrim(COALESCE(source_input.uid, ''))), 'zalo_group:')
          WHEN 'phone' THEN NULLIF('phone:' ||
            public.aka_agent_internal_normalize_phone(COALESCE(source_input.phone, '')), 'phone:')
          WHEN 'email' THEN CASE
            WHEN lower(pg_catalog.btrim(COALESCE(source_input.email, ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
            THEN 'email:' || lower(pg_catalog.btrim(source_input.email))
            ELSE NULL END
          ELSE NULL
        END,
        CASE WHEN d.action_code IN ('zalo_message_friend', 'zalo_message_stranger')
          THEN NULLIF('zalo_person_phone:' ||
            public.aka_agent_internal_normalize_phone(COALESCE(source_input.phone, '')), 'zalo_person_phone:')
          ELSE NULL END
      ]::text[] AS target_keys
      OFFSET 0
    ) AS keys
    CROSS JOIN requested_keys AS batch
    WHERE pg_catalog.cardinality(batch.keys) > 0
      AND keys.target_keys && batch.keys
  ),
  latest AS MATERIALIZED (
    SELECT DISTINCT ON (r.id)
      r.id AS input_data_id,
      h.created_at AS last_sent_at,
      h.campaign_id AS source_campaign_id,
      c.name AS source_campaign_name
    FROM requested AS r
    JOIN history AS h ON h.target_keys && r.target_keys
    LEFT JOIN public.auto_campaigns AS c ON c.id = h.campaign_id
    ORDER BY r.id, h.created_at DESC, h.detail_id DESC
  ),
  decisions AS MATERIALIZED (
    SELECT
      r.id AS input_data_id,
      CASE
        WHEN r.status IS DISTINCT FROM 'chờ xử lý' THEN 'not_pending'
        WHEN pg_catalog.cardinality(r.target_keys) = 0 THEN 'paused_unidentifiable'
        WHEN bd.id IS NOT NULL THEN 'deferred_batch_duplicate'
        WHEN l.input_data_id IS NOT NULL
          AND v_today < (pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days)
          THEN 'paused_recent_delivery'
        ELSE 'allowed'
      END AS decision,
      CASE
        WHEN r.status IS DISTINCT FROM 'chờ xử lý' THEN 'Data không còn ở trạng thái chờ xử lý.'
        WHEN pg_catalog.cardinality(r.target_keys) = 0
          THEN 'Tạm dừng vì không thể chuẩn hóa đối tượng để kiểm tra giới hạn gửi/đăng lặp.'
        WHEN bd.id IS NOT NULL
          THEN 'Giữ chờ xử lý vì trùng đối tượng với một data đứng trước trong cùng batch.'
        WHEN l.input_data_id IS NOT NULL
          AND v_today < (pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days)
          THEN pg_catalog.format(
            CASE
              WHEN v_campaign.action_id IN ('facebook_group_post', 'facebook_page_post')
                THEN 'Tạm dừng: đã đăng bài trước đó ngày %s. Đăng lại từ %s.'
              WHEN v_campaign.action_id = 'email_send'
                THEN 'Tạm dừng: đã gửi email trước đó ngày %s. Gửi lại từ %s.'
              WHEN v_campaign.action_id = 'sms_send'
                THEN 'Tạm dừng: đã gửi SMS trước đó ngày %s. Gửi lại từ %s.'
              ELSE 'Tạm dừng: đã gửi tin trước đó ngày %s. Gửi lại từ %s.'
            END,
            pg_catalog.to_char(pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date, 'DD/MM/YYYY'),
            pg_catalog.to_char(pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days, 'DD/MM/YYYY')
          )
        ELSE NULL
      END AS note,
      l.last_sent_at,
      CASE WHEN l.last_sent_at IS NULL THEN NULL
        ELSE pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days
      END AS eligible_date,
      l.source_campaign_id,
      l.source_campaign_name,
      r.ordinality
    FROM requested AS r
    LEFT JOIN batch_duplicates AS bd ON bd.id = r.id
    LEFT JOIN latest AS l ON l.input_data_id = r.id
  ),
  paused AS (
    UPDATE public.auto_campaign_input_data AS i
    SET status = 'tạm dừng',
        note = d.note
    FROM decisions AS d
    WHERE i.id = d.input_data_id
      AND i.status = 'chờ xử lý'
      AND d.decision IN ('paused_recent_delivery', 'paused_unidentifiable')
    RETURNING i.id
  )
  SELECT
    d.input_data_id,
    d.decision,
    d.note,
    d.last_sent_at,
    d.eligible_date,
    d.source_campaign_id,
    d.source_campaign_name
  FROM decisions AS d
  LEFT JOIN paused AS p ON p.id = d.input_data_id
  ORDER BY d.ordinality;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_apply_zalo_server_campaign_tags(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_account_id bigint, p_runtime_claim_token uuid, p_runtime_unit_token uuid, p_input_data_id bigint, p_contact_type text, p_target_uid text, p_tag_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
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
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_staff_id IS NULL OR p_staff_id<=0 OR p_organization_id IS NULL OR p_organization_id<=0
    OR p_campaign_id IS NULL OR p_campaign_id<=0 OR p_account_id IS NULL OR p_account_id<=0
    OR p_runtime_claim_token IS NULL OR p_runtime_unit_token IS NULL
    OR p_input_data_id IS NULL OR p_input_data_id<=0
    OR p_contact_type IS NULL OR p_contact_type NOT IN ('person','group')
    OR v_uid IS NULL OR length(v_uid)>256
    OR COALESCE(cardinality(p_tag_ids),0)<1
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
        AND t.organization_id=p_organization_id
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
CREATE OR REPLACE FUNCTION public.aka_agent_campaign_send_exclusion_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_claim_token uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE c public.auto_campaigns%ROWTYPE; selection jsonb; g jsonb; ids bigint[]; input public.auto_campaign_input_data%ROWTYPE;
 contact_id bigint; fact jsonb; v_uid text; days integer; last_sent timestamptz; current_time_value timestamptz:=clock_timestamp(); keys text[]; tag_ids jsonb; changed integer;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

 SELECT campaign.* INTO c FROM public.auto_campaigns campaign JOIN public.auto_accounts a ON a.id=campaign.account_id
  JOIN public.org_staff s ON s.id=campaign.staff_id AND s.organization_id=campaign.organization_id AND s.is_active
  WHERE campaign.id=p_campaign_id AND campaign.account_id=p_account_id AND campaign.staff_id=p_staff_id AND NOT campaign.is_delete
   AND a.staff_id=p_staff_id AND a.organization_id=campaign.organization_id AND NOT a.is_delete
   AND campaign.runtime_claim_token=p_claim_token AND p_claim_token IS NOT NULL
  FOR UPDATE OF campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_runtime_claim_lost'; END IF;
 IF p_operation='snapshot' THEN
  selection:=c.extra_settings->'zaloSendExclusionsByAccountId'->p_account_id::text;
  IF selection IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
  -- Other accounts are validated when saving configuration or starting their own run.
  PERFORM public.aka_agent_internal_validate_send_exclusion_selection(jsonb_build_object(p_account_id::text,selection),c.staff_id,c.organization_id,p_account_id);
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(COALESCE(selection->'blocklistIds','[]'))) INTO ids;
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),'group',public.aka_agent_internal_send_exclusion_group((selection->>'groupId')::bigint),
   'blocklistUids',COALESCE((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts ac ON ac.id=m.contact_id WHERE m.group_id=ANY(ids) AND NOT m.is_delete AND NOT ac.is_delete
    AND ac.account_id=p_account_id AND ac.staff_id=p_staff_id AND ac.organization_id=c.organization_id AND ac.contact_type='person' AND NULLIF(btrim(ac.uid),'') IS NOT NULL),'[]'));
 END IF;
 SELECT * INTO input FROM public.auto_campaign_input_data WHERE id=(p_payload->>'inputId')::bigint AND campaign_id=p_campaign_id AND NOT is_delete;
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_input_not_found'; END IF;
 IF p_operation='pause' THEN
  UPDATE public.auto_campaign_input_data SET status='tạm dừng',note=left(p_payload->>'note',2000)
   WHERE id=input.id AND campaign_id=c.id AND status=p_payload->>'expectedStatus' AND status IN ('chờ xử lý','đang chạy') AND NOT is_delete;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('changed',changed=1);
 ELSIF p_operation<>'facts' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 v_uid:=COALESCE(NULLIF(btrim(p_payload->>'uid'),''),NULLIF(btrim(input.uid),''));
 IF COALESCE((p_payload->>'tags')::boolean,false) THEN
  IF v_uid IS NULL THEN tag_ids:=NULL; ELSE
   SELECT ac.id INTO contact_id FROM public.auto_account_contacts ac WHERE ac.account_id=c.account_id AND ac.staff_id=c.staff_id AND ac.organization_id=c.organization_id AND ac.contact_type='person' AND ac.uid=v_uid AND NOT ac.is_delete ORDER BY ac.id LIMIT 1;
   IF contact_id IS NOT NULL THEN
    fact:=public.aka_agent_data_group_zalo_facts(contact_id); tag_ids:=fact->'akabiz_tag_keys';
   ELSE
    SELECT COALESCE(jsonb_agg(DISTINCT t.id::text),'[]') INTO tag_ids
     FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id AND ac.zalo_id=v_uid AND ac.conversation_type='user'
     JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
     JOIN public.chat_zalo_conversation_system_tag link ON link.chat_zalo_conversation_id=conv.id AND link.organization_id=c.organization_id
     JOIN public.auto_contact_tags t ON t.id=link.auto_contact_tag_id AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
     WHERE b.auto_account_id=c.account_id AND b.organization_id=c.organization_id AND b.is_active;
   END IF;
  END IF;
 END IF;
 IF p_payload ? 'days' THEN
  days:=(p_payload->>'days')::integer;
  IF days<1 OR days>3650 THEN RAISE EXCEPTION 'send_exclusion_days_invalid'; END IF;
  keys:=public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',COALESCE(v_uid,input.uid),input.phone,input.email);
  IF cardinality(keys)>0 THEN
   SELECT max(h.created_at) INTO last_sent FROM public.aka_agent_internal_send_delivery_history(c.account_id,ARRAY['zalo_message_friend','zalo_message_stranger'],((timezone('Asia/Ho_Chi_Minh',current_time_value)::date-days)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),current_time_value) h WHERE h.target_keys && keys;
  END IF;
 END IF;
 RETURN jsonb_build_object('akabiz_contact',CASE WHEN tag_ids IS NULL THEN NULL ELSE jsonb_build_object('ids',tag_ids,'availableValues',(SELECT COALESCE(jsonb_agg(t.id::text),'[]') FROM public.auto_contact_tags t WHERE t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id))) END,
  'campaign_delivery',CASE WHEN days IS NULL OR cardinality(keys)=0 THEN NULL ELSE jsonb_build_object('daysSince',CASE WHEN last_sent IS NULL THEN 3651 ELSE timezone('Asia/Ho_Chi_Minh',current_time_value)::date-timezone('Asia/Ho_Chi_Minh',last_sent)::date END) END);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_check_zalo_message_opt_out(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_phone text DEFAULT NULL::text, p_zalo_global_id text DEFAULT NULL::text)
 RETURNS TABLE(is_opted_out boolean, matched_by text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_phone text := NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '');
  v_zalo_global_id text := NULLIF(pg_catalog.btrim(p_zalo_global_id), '');
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_zalo_message_opt_out_scope';
  END IF;

  SELECT campaign.organization_id
  INTO v_organization_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = campaign.organization_id
   AND account.flatform_type = 'zalo'
   AND COALESCE(account.is_delete, false) = false
  JOIN public.org_staff AS staff
    ON staff.id = p_staff_id
   AND staff.organization_id = campaign.organization_id
   AND staff.is_active = true
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_message_friend',
      'zalo_message_birthday',
      'zalo_message_group_member',
      'zalo_message_group_realtime',
      'zalo_message_remarketing_customer',
      'zalo_message_friend_recommendation'
    )
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_message_opt_out_scope_not_found';
  END IF;

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_zalo_message_opt_outs AS opt_out
    WHERE opt_out.staff_id = p_staff_id
      AND opt_out.organization_id = v_organization_id
      AND opt_out.phone = v_phone
      AND opt_out.confirmed_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT true, 'phone'::text;
    RETURN;
  END IF;

  IF v_zalo_global_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_zalo_message_opt_outs AS opt_out
    WHERE opt_out.staff_id = p_staff_id
      AND opt_out.organization_id = v_organization_id
      AND opt_out.zalo_global_id = v_zalo_global_id
      AND opt_out.confirmed_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT true, 'zalo_global_id'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_facebook_login(p_staff_id bigint, p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  access jsonb; org_id bigint; a public.auto_accounts%ROWTYPE;
  s public.auto_facebook_login_sessions%ROWTYPE; secret jsonb; result jsonb;
  reservation public.auto_facebook_login_imports%ROWTYPE;
  uid text; import_request uuid; account_id_input bigint; secret_id_input uuid;
  limit_value text; batch_limit integer:=10; account_limit integer; product_count integer; used_count integer;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.

  IF p_action IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>2000000 THEN
    RAISE EXCEPTION 'facebook_invalid_input';
  END IF;
  access:=public.aka_agent_staff_access(p_staff_id,p_username,p_password);
  SELECT organization_id INTO org_id FROM public.org_staff WHERE id=p_staff_id;
  -- Cleanup/read-after-commit stay available to the same authenticated owner after entitlement expiry.
  IF p_action NOT IN ('abort','request_status') THEN
    IF NOT coalesce((access->>'isActive')::boolean,false) OR NOT coalesce((access->>'timeAllowed')::boolean,false) THEN
      RAISE EXCEPTION 'facebook_access_denied';
    END IF;
    SELECT count(*),CASE WHEN bool_or(max_accounts IS NULL OR max_accounts<=0) THEN NULL ELSE max(max_accounts) END
    INTO product_count,account_limit FROM public.org_organization_product
    WHERE organization_id=org_id AND product_id IN (3,10) AND is_deleted=false
      AND expiration_date >= (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh');
    IF product_count=0 THEN RAISE EXCEPTION 'facebook_access_denied'; END IF;
  END IF;
  SELECT value INTO limit_value FROM public.auto_system_settings
    WHERE key='facebook.account_import.max_accounts_per_batch' AND is_active=true;
  IF limit_value ~ '^[0-9]{1,6}$' AND limit_value::integer>0 THEN batch_limit:=limit_value::integer; END IF;

  IF p_action='preview' THEN
    SELECT coalesce(jsonb_agg(DISTINCT facebook_uid),'[]') INTO result FROM public.auto_accounts
    WHERE staff_id=p_staff_id AND organization_id=org_id AND flatform_type='facebook' AND is_delete=false
      AND facebook_uid IN (SELECT jsonb_array_elements_text(p_data->'uids'));
    RETURN jsonb_build_object('limit',batch_limit,'duplicates',result);
  END IF;
  IF p_action='pending' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',i.account_id,'requestId',i.request_id)),'[]') INTO result
    FROM public.auto_facebook_login_imports i WHERE i.staff_id=p_staff_id AND i.organization_id=org_id
      AND i.created_at < now()-interval '5 minutes';
    RETURN result;
  END IF;
  IF p_action IN ('reserve','finish','abort','request_status') THEN
    import_request:=(p_data->>'requestId')::uuid;
    IF import_request IS NULL THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    -- Serialize only account creation per staff, including quota check. UID is NOT a global constraint.
    PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR UPDATE;
    SELECT a1.* INTO a FROM public.auto_accounts a1 JOIN public.auto_facebook_login_sessions s1 ON s1.account_id=a1.id
      WHERE s1.import_request_id=import_request AND a1.staff_id=p_staff_id AND a1.organization_id=org_id;
    IF FOUND THEN
      SELECT * INTO s FROM public.auto_facebook_login_sessions WHERE account_id=a.id;
      RETURN jsonb_build_object('accountId',a.id,'state','ready','ready',true,'revision',s.revision);
    END IF;
    SELECT * INTO reservation FROM public.auto_facebook_login_imports
      WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id FOR UPDATE;
    IF p_action='request_status' THEN
      IF reservation.account_id IS NULL THEN RETURN NULL; END IF;
      RETURN jsonb_build_object('accountId',reservation.account_id,'state','initializing');
    END IF;
    IF p_action='abort' THEN
      DELETE FROM public.auto_facebook_login_imports WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id;
      RETURN jsonb_build_object('removed',true);
    END IF;
    IF p_action='reserve' AND reservation.account_id IS NOT NULL THEN
      RETURN jsonb_build_object('accountId',reservation.account_id,'state','initializing');
    END IF;
    IF (p_data->>'batchSize') IS NULL OR (p_data->>'batchSize')::integer NOT BETWEEN 1 AND batch_limit THEN RAISE EXCEPTION 'facebook_batch_limit'; END IF;
    secret:=p_data->'secret'; uid:=secret->>'uid';
    IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' OR jsonb_typeof(secret->'cookies') IS DISTINCT FROM 'array'
      OR length(coalesce(secret->>'password',''))>1024 OR length(coalesce(secret->>'twoFactorSecret',''))>256
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(secret->'cookies') c WHERE c->>'name'='c_user' AND c->>'value'=uid)
      THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF EXISTS(SELECT 1 FROM public.auto_accounts WHERE staff_id=p_staff_id AND flatform_type='facebook'
      AND is_delete=false AND facebook_uid=uid) THEN
      DELETE FROM public.auto_facebook_login_imports WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id;
      RETURN jsonb_build_object('skipped',true);
    END IF;
    SELECT count(*) INTO used_count FROM public.auto_accounts WHERE staff_id=p_staff_id AND flatform_type='facebook' AND is_delete=false;
    IF account_limit IS NOT NULL AND used_count>=account_limit THEN RAISE EXCEPTION 'facebook_account_quota'; END IF;
    IF p_data->>'accountGroupId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.auto_account_groups
      WHERE id=(p_data->>'accountGroupId')::bigint AND staff_id=p_staff_id AND organization_id=org_id AND flatform_type='facebook' AND is_delete=false AND is_active=true) THEN
      RAISE EXCEPTION 'facebook_invalid_group'; END IF;
    IF p_data->>'proxyId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.auto_proxies
      WHERE id=(p_data->>'proxyId')::bigint AND staff_id=p_staff_id AND organization_id=org_id AND is_delete=false) THEN RAISE EXCEPTION 'facebook_invalid_proxy'; END IF;
    IF p_action='reserve' THEN
      INSERT INTO public.auto_facebook_login_imports(request_id,account_id,staff_id,organization_id)
        VALUES(import_request,nextval('public.auto_accounts_id_seq'),p_staff_id,org_id) RETURNING * INTO reservation;
      RETURN jsonb_build_object('accountId',reservation.account_id,'state','initializing');
    END IF;
    IF reservation.account_id IS NULL OR reservation.account_id IS DISTINCT FROM (p_data->>'accountId')::bigint THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
    INSERT INTO public.auto_accounts(id,name,flatform_type,login_status,status,is_active,is_delete,staff_id,organization_id,
      account_group_id,proxy_id,is_zalo_show_web,is_zalo_server,facebook_uid,facebook_login_managed)
    OVERRIDING SYSTEM VALUE VALUES (reservation.account_id,coalesce(nullif(p_data->>'name',''),uid),'facebook','đã đăng nhập','chờ xử lý',true,false,p_staff_id,org_id,
      (p_data->>'accountGroupId')::bigint,(p_data->>'proxyId')::bigint,false,false,uid,true) RETURNING * INTO a;
    secret_id_input:=vault.create_secret(secret::text,'akaagent_facebook_'||a.id,'Facebook session managed by akaAgent');
    INSERT INTO public.auto_facebook_login_sessions(account_id,secret_id,import_request_id,last_verified_at)
      VALUES(a.id,secret_id_input,import_request,now());
    DELETE FROM public.auto_facebook_login_imports WHERE request_id=(p_data->>'requestId')::uuid AND staff_id=p_staff_id AND organization_id=org_id;
    RETURN jsonb_build_object('accountId',a.id,'state','ready','ready',true,'revision',1);
  END IF;

  account_id_input:=(p_data->>'accountId')::bigint;
  SELECT * INTO a FROM public.auto_accounts WHERE id=account_id_input AND staff_id=p_staff_id AND organization_id=org_id
    AND flatform_type='facebook' AND is_delete=false FOR UPDATE;
  IF NOT FOUND THEN
    IF p_action='abort' THEN RETURN jsonb_build_object('removed',true); END IF;
    RAISE EXCEPTION 'facebook_not_found';
  END IF;
  SELECT * INTO s FROM public.auto_facebook_login_sessions WHERE account_id=a.id FOR UPDATE;
  -- Existing manual accounts expose only metadata until an explicit verified login.
  IF p_action='metadata' AND s.account_id IS NULL THEN
    RETURN jsonb_build_object('uid',a.facebook_uid,'revision',0,
      'hasPassword',false,'hasTwoFactor',false,'hasCookie',false);
  END IF;
  IF p_action='login' THEN
    IF coalesce(s.revision,0) IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
    secret:=p_data->'secret'; uid:=secret->>'uid';
    IF jsonb_typeof(secret) IS DISTINCT FROM 'object' OR uid IS NULL OR uid !~ '^[0-9]{5,24}$'
      OR jsonb_typeof(secret->'cookies') IS DISTINCT FROM 'array'
      OR length(coalesce(secret->>'password','')) NOT BETWEEN 1 AND 1024
      OR length(coalesce(secret->>'twoFactorSecret','')) NOT BETWEEN 16 AND 256 THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(secret->'cookies') c WHERE c->>'name'='c_user' AND c->>'value'=uid)
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(secret->'cookies') c WHERE c->>'name'='xs' AND coalesce(c->>'value','')<>'')
      THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    secret:=jsonb_build_object('uid',uid,'password',secret->>'password','twoFactorSecret',secret->>'twoFactorSecret','cookies',secret->'cookies');
    -- Reuse this account; duplicate UID filtering and creation quota belong to import only.
    IF s.account_id IS NULL THEN
      secret_id_input:=vault.create_secret(secret::text,'akaagent_facebook_'||a.id,'Facebook session managed by akaAgent');
      INSERT INTO public.auto_facebook_login_sessions(account_id,secret_id,import_request_id,last_verified_at)
        VALUES(a.id,secret_id_input,gen_random_uuid(),now()) RETURNING * INTO s;
    ELSE
      PERFORM vault.update_secret(s.secret_id,secret::text);
      UPDATE public.auto_facebook_login_sessions SET revision=revision+1,last_verified_at=now(),updated_at=now()
        WHERE account_id=a.id RETURNING * INTO s;
    END IF;
    UPDATE public.auto_accounts SET facebook_login_managed=true,facebook_uid=uid,login_status='đã đăng nhập',updated_at=now() WHERE id=a.id;
    RETURN jsonb_build_object('revision',s.revision);
  END IF;
  IF p_action='observe' AND s.account_id IS NULL THEN
    IF a.facebook_uid IS DISTINCT FROM (p_data->>'expectedUid') THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
    IF p_data->>'state'='authenticated' THEN
      uid:=p_data->>'uid'; IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
      UPDATE public.auto_accounts SET facebook_uid=uid,login_status='đã đăng nhập',updated_at=now() WHERE id=a.id;
    ELSIF p_data->>'state' IN ('logged_out','challenge') THEN
      UPDATE public.auto_accounts SET login_status=CASE WHEN p_data->>'state'='challenge' THEN 'checkpoint' ELSE 'chưa đăng nhập' END,
        updated_at=now() WHERE id=a.id;
    END IF;
    RETURN jsonb_build_object('revision',0);
  END IF;
  IF s.account_id IS NULL THEN RAISE EXCEPTION 'facebook_not_managed'; END IF;
  SELECT decrypted_secret::jsonb INTO secret FROM vault.decrypted_secrets WHERE id=s.secret_id;
  IF p_action='get' THEN RETURN jsonb_build_object('secret',secret,'revision',s.revision); END IF;
  IF p_action='metadata' THEN RETURN jsonb_build_object('uid',secret->>'uid','revision',s.revision,
    'hasPassword',coalesce(secret->>'password','')<>'','hasTwoFactor',coalesce(secret->>'twoFactorSecret','')<>'',
    'hasCookie',jsonb_array_length(coalesce(secret->'cookies','[]'))>0); END IF;
  IF s.revision IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'facebook_conflict'; END IF;
  IF p_action='observe' THEN
    IF p_data->>'state'='authenticated' THEN
      uid:=p_data->>'uid';
      IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' OR jsonb_typeof(p_data->'cookies') IS DISTINCT FROM 'array'
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'cookies') c WHERE c->>'name'='c_user' AND c->>'value'=uid)
        THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
      IF secret->>'uid' IS DISTINCT FROM uid THEN secret:=jsonb_build_object('uid',uid); END IF;
      secret:=secret||jsonb_build_object('cookies',p_data->'cookies');
      PERFORM vault.update_secret(s.secret_id,secret::text);
      UPDATE public.auto_accounts SET facebook_uid=uid,login_status='đã đăng nhập',updated_at=now() WHERE id=a.id;
      UPDATE public.auto_facebook_login_sessions SET revision=revision+1,last_verified_at=now(),updated_at=now() WHERE account_id=a.id;
    ELSIF p_data->>'state' IN ('logged_out','challenge') THEN
      UPDATE public.auto_accounts SET login_status=CASE WHEN p_data->>'state'='challenge' THEN 'checkpoint' ELSE 'chưa đăng nhập' END,
        updated_at=now() WHERE id=a.id;
    ELSE RAISE EXCEPTION 'facebook_invalid_input'; END IF;
  ELSIF p_action='save' THEN
    uid:=p_data->>'uid';
    IF uid IS NULL OR uid !~ '^[0-9]{5,24}$' THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF coalesce(p_data->>'observedState','') NOT IN ('authenticated','logged_out') THEN RAISE EXCEPTION 'facebook_unverified'; END IF;
    IF length(coalesce(p_data->>'password',''))>1024 OR length(coalesce(p_data->>'twoFactorSecret',''))>256 THEN RAISE EXCEPTION 'facebook_invalid_input'; END IF;
    IF p_data->>'observedState'='authenticated' AND uid IS DISTINCT FROM (p_data->>'observedUid') THEN RAISE EXCEPTION 'facebook_uid_mismatch'; END IF;
    IF secret->>'uid' IS DISTINCT FROM uid THEN secret:=jsonb_build_object('uid',uid,'cookies','[]'::jsonb); END IF;
    IF p_data ? 'password' THEN secret:=secret||jsonb_build_object('password',p_data->>'password'); END IF;
    IF p_data ? 'twoFactorSecret' THEN secret:=secret||jsonb_build_object('twoFactorSecret',p_data->>'twoFactorSecret'); END IF;
    PERFORM vault.update_secret(s.secret_id,secret::text);
    UPDATE public.auto_facebook_login_sessions SET revision=revision+1,updated_at=now() WHERE account_id=a.id;
  ELSE RAISE EXCEPTION 'facebook_invalid_action'; END IF;
  SELECT revision INTO s.revision FROM public.auto_facebook_login_sessions WHERE account_id=a.id;
  RETURN jsonb_build_object('revision',s.revision);
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(p_staff_id bigint, p_organization_id bigint, p_expected_mode_revision text, p_limit integer DEFAULT 200)
 RETURNS TABLE(campaign_id bigint, campaign_status text, result jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_candidate record;
  v_result jsonb;
  v_limit integer := COALESCE(p_limit, 200);
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.

  PERFORM public.aka_agent_internal_require_zalo_server_data_group_runtime(
    p_staff_id,
    p_organization_id,
    p_expected_mode_revision
  );

  IF v_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_expired_data_group_campaign_limit';
  END IF;

  FOR v_candidate IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    JOIN public.auto_campaign_data_group_sources AS source
      ON source.campaign_id = campaign.id
     AND source.staff_id = p_staff_id
     AND source.organization_id = p_organization_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND campaign.data_target_source_mode = 'data_group'
      AND campaign.action_id IN (
        'zalo_message_phone',
        'zalo_join_group_link',
        'zalo_message_friend',
        'zalo_message_group_member',
        'zalo_message_remarketing_customer',
        'zalo_message_group',
        'zalo_add_group_member'
      )
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND campaign.schedule_end_date IS NOT NULL
      AND campaign.schedule_end_date <= now()
      AND (
        campaign.status <> 'hoàn thành'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS pending_input
          WHERE pending_input.campaign_id = campaign.id
            AND COALESCE(pending_input.is_delete, false) = false
            AND pending_input.status IN ('chờ xử lý', 'đang chạy')
        )
      )
    -- Do not pre-lock campaign here: the per-candidate wrapper first locks all
    -- live inputs, then campaign/account. Concurrent sweeps remain idempotent
    -- because the wrapper/global finalizer rechecks durable terminal state.
    ORDER BY campaign.schedule_end_date, campaign.id
    LIMIT v_limit
  LOOP
    v_result := public.aka_agent_finalize_zalo_server_data_group_campaign(
      p_staff_id,
      p_organization_id,
      p_expected_mode_revision,
      v_candidate.id,
      'Chiến dịch đã hết hạn'
    );
    campaign_id := v_candidate.id;
    campaign_status := v_result ->> 'status';
    result := v_result;
    RETURN NEXT;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_data_group_campaign(p_staff_id bigint, p_organization_id bigint, p_expected_mode_revision text, p_campaign_id bigint, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign_id bigint;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  -- This is a cleanup/finalization path for work that was already claimed.
  -- Capability/revision changes prevent the next run-unit claim, but must not
  -- strand the target that is currently being settled. Keep tenant/staff and
  -- persisted Server-subtype checks below as the ownership boundary.
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  -- Reject an unowned/local target before the SECURITY DEFINER function locks
  -- any input row. The same proof is repeated authoritatively after locking.
  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  JOIN public.auto_campaign_data_group_sources AS source
    ON source.campaign_id = campaign.id
   AND source.staff_id = campaign.staff_id
   AND source.organization_id = campaign.organization_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.data_target_source_mode = 'data_group'
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_join_group_link',
      'zalo_message_friend',
      'zalo_message_group_member',
      'zalo_message_remarketing_customer',
      'zalo_message_group',
      'zalo_add_group_member'
    )
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- The shared Data Group finalizer takes campaign/source before inspecting
  -- inputs. Pre-lock all live inputs here so the effective Server lock order
  -- remains input -> campaign -> account and cannot invert Control pause/resume.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.id INTO v_campaign_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  JOIN public.auto_campaign_data_group_sources AS source
    ON source.campaign_id = campaign.id
   AND source.staff_id = campaign.staff_id
   AND source.organization_id = campaign.organization_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.data_target_source_mode = 'data_group'
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_join_group_link',
      'zalo_message_friend',
      'zalo_message_group_member',
      'zalo_message_remarketing_customer',
      'zalo_message_group',
      'zalo_add_group_member'
    )
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  RETURN public.aka_agent_internal_finalize_data_group_campaign_v219(
    p_staff_id,
    p_organization_id,
    v_campaign_id,
    p_note
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(p_staff_id bigint, p_organization_id bigint, p_expected_mode_revision text, p_campaign_id bigint, p_note text, p_update_note boolean)
 RETURNS TABLE(completed boolean, reason text, campaign_id bigint, campaign_status text, pending_input_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_authorized_campaign_id bigint;
  v_action_id text;
  v_schedule timestamptz;
  v_original_schedule timestamptz;
  v_schedule_type text;
  v_schedule_days text;
  v_schedule_week_days text;
  v_schedule_end_date timestamptz;
  v_schedule_time time without time zone;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_candidate_date date;
  v_next_schedule timestamptz;
  v_allowed_days integer[] := ARRAY[]::integer[];
  v_day_token text;
  v_day_numeric numeric;
  v_day_number integer;
  v_day_offset integer;
  v_is_birthday_maintenance boolean := false;
  v_is_schedule_end_maintenance boolean := false;
  v_maintenance_note text;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.aka_agent_internal_require_zalo_server_runtime(
    p_staff_id,
    p_organization_id,
    p_expected_mode_revision
  );

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'zalo_server_maintenance_campaign_invalid';
  END IF;

  -- Avoid locking rows for a local or cross-tenant campaign through this
  -- SECURITY DEFINER surface. The full schedule/candidate proof is repeated
  -- with campaign/account row locks after the input-first barrier.
  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.data_target_source_mode, 'direct') = 'direct'
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Maintenance may complete the campaign based on its current input set.
  -- Stabilize that set before the schedule proof locks campaign/account.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT
    campaign.id,
    campaign.action_id,
    campaign.schedule,
    campaign.original_schedule,
    COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'),
    campaign.schedule_days,
    campaign.schedule_week_days,
    campaign.schedule_end_date
  INTO
    v_authorized_campaign_id,
    v_action_id,
    v_schedule,
    v_original_schedule,
    v_schedule_type,
    v_schedule_days,
    v_schedule_week_days,
    v_schedule_end_date
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.data_target_source_mode, 'direct') = 'direct'
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.schedule IS NOT NULL
    AND campaign.schedule < (
      date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
    )
    AND campaign.status IN ('chờ xử lý', 'hoàn thành')
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  -- Mirror resolveNextSchedule() in campaignRepository.ts. The capability
  -- revision is a freshness/CAS boundary rather than a secret, so the public
  -- Server RPC independently proves this is a real maintenance candidate.
  v_schedule_time := (
    date_trunc(
      'second',
      COALESCE(v_original_schedule, v_schedule)
        AT TIME ZONE 'Asia/Ho_Chi_Minh'
    )
  )::time;

  IF v_schedule_type = 'daily' THEN
    v_candidate_date := v_today;
  ELSIF v_schedule_type IN ('weekly', 'monthly') THEN
    FOREACH v_day_token IN ARRAY string_to_array(
      CASE
        WHEN v_schedule_type = 'weekly' THEN COALESCE(v_schedule_week_days, '')
        ELSE COALESCE(v_schedule_days, '')
      END,
      ','
    )
    LOOP
      BEGIN
        v_day_numeric := btrim(v_day_token)::numeric;
        IF v_day_numeric = trunc(v_day_numeric)
          AND (
            (v_schedule_type = 'weekly' AND v_day_numeric BETWEEN 2 AND 8)
            OR (v_schedule_type = 'monthly' AND v_day_numeric BETWEEN 1 AND 31)
          )
        THEN
          v_day_number := v_day_numeric::integer;
          IF NOT v_day_number = ANY(v_allowed_days) THEN
            v_allowed_days := array_append(v_allowed_days, v_day_number);
          END IF;
        END IF;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          NULL;
      END;
    END LOOP;

    IF cardinality(v_allowed_days) > 0 THEN
      FOR v_day_offset IN 0..(
        CASE WHEN v_schedule_type = 'weekly' THEN 13 ELSE 369 END
      )
      LOOP
        v_candidate_date := v_today + v_day_offset;
        IF (
          v_schedule_type = 'weekly'
          AND (extract(isodow FROM v_candidate_date)::integer + 1) = ANY(v_allowed_days)
        ) OR (
          v_schedule_type = 'monthly'
          AND extract(day FROM v_candidate_date)::integer = ANY(v_allowed_days)
        ) THEN
          EXIT;
        END IF;
        v_candidate_date := NULL;
      END LOOP;
    END IF;
  END IF;

  IF v_candidate_date IS NOT NULL THEN
    v_next_schedule := (
      v_candidate_date + v_schedule_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  END IF;

  v_is_birthday_maintenance := (
    v_schedule_type = 'daily'
    AND v_action_id = 'zalo_message_birthday'
  );
  v_is_schedule_end_maintenance := (
    v_schedule_end_date IS NOT NULL
    AND v_next_schedule IS NOT NULL
    AND v_next_schedule > v_schedule_end_date
  );

  IF NOT v_is_birthday_maintenance AND NOT v_is_schedule_end_maintenance THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  v_maintenance_note := CASE
    WHEN v_is_schedule_end_maintenance THEN 'Chiến dịch đã hết ngày kết thúc'
    ELSE 'Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày'
  END;

  RETURN QUERY
  SELECT
    result.completed,
    result.reason,
    result.campaign_id,
    result.campaign_status,
    result.pending_input_count
  FROM public.aka_agent_internal_finalize_zalo_server_maintenance_guard(
    p_staff_id,
    p_organization_id,
    v_authorized_campaign_id,
    v_maintenance_note,
    true,
    'chờ xử lý'
  ) AS result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_contact_dataset_member_ids(p_staff_id bigint, p_organization_id bigint, p_account_id bigint, p_dataset_id bigint, p_contact_type text DEFAULT NULL::text)
 RETURNS TABLE(contact_id bigint, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
 WITH desktop_request_guard AS MATERIALIZED (SELECT private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL) AS allowed)
 SELECT result.* FROM desktop_request_guard
 CROSS JOIN LATERAL (
SELECT member.contact_id, member.sort_order
  FROM public.auto_account_contacts_dataset AS dataset
  JOIN public.auto_account_contacts_dataset_members AS member
    ON member.dataset_id = dataset.id
  JOIN public.auto_account_contacts AS contact
    ON contact.id = member.contact_id
  WHERE dataset.id = p_dataset_id
    AND dataset.staff_id = p_staff_id
    AND dataset.organization_id = p_organization_id
    AND dataset.account_id = p_account_id
    AND dataset.is_delete = false
    AND member.is_current = true
    AND (p_contact_type IS NULL OR dataset.contact_type = p_contact_type)
    AND contact.staff_id = p_staff_id
    AND contact.organization_id = p_organization_id
    AND contact.account_id = p_account_id
    AND contact.contact_type = dataset.contact_type
    AND COALESCE(contact.is_delete, false) = false
  ORDER BY member.sort_order ASC, member.contact_id ASC
 ) AS result WHERE desktop_request_guard.allowed;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_contact_datasets(p_staff_id bigint, p_organization_id bigint, p_account_id bigint, p_scan_type text DEFAULT NULL::text, p_contact_type text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_flatform_type text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, name text, link text, description text, source text, account_id bigint, flatform_type text, contact_type text, scan_type text, source_key text, last_scanned_at timestamp with time zone, last_scan_status text, extra_data jsonb, contact_count integer, is_delete boolean, staff_id bigint, organization_id bigint, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH desktop_request_guard AS MATERIALIZED (SELECT private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL) AS allowed)
 SELECT result.* FROM desktop_request_guard
 CROSS JOIN LATERAL (
SELECT
    dataset.id,
    dataset.name,
    dataset.link,
    dataset.description,
    dataset.source,
    dataset.account_id,
    dataset.flatform_type,
    dataset.contact_type,
    dataset.scan_type,
    dataset.source_key,
    dataset.last_scanned_at,
    dataset.last_scan_status,
    dataset.extra_data,
    (
      SELECT count(*)::integer
      FROM public.auto_account_contacts_dataset_members AS current_member
      JOIN public.auto_account_contacts AS current_contact
        ON current_contact.id = current_member.contact_id
      WHERE current_member.dataset_id = dataset.id
        AND current_member.is_current = true
        AND current_contact.account_id = dataset.account_id
        AND current_contact.staff_id = dataset.staff_id
        AND current_contact.organization_id = dataset.organization_id
        AND current_contact.contact_type = dataset.contact_type
        AND COALESCE(current_contact.is_delete, false) = false
    ) AS contact_count,
    dataset.is_delete,
    dataset.staff_id,
    dataset.organization_id,
    dataset.created_at,
    dataset.updated_at
  FROM public.auto_account_contacts_dataset AS dataset
  JOIN public.auto_accounts AS account
    ON account.id = dataset.account_id
  WHERE dataset.staff_id = p_staff_id
    AND dataset.organization_id = p_organization_id
    AND dataset.account_id = p_account_id
    AND dataset.is_delete = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false
    AND (p_scan_type IS NULL OR dataset.scan_type = p_scan_type)
    AND (p_contact_type IS NULL OR dataset.contact_type = p_contact_type)
    AND (p_source IS NULL OR dataset.source = p_source)
    AND (p_flatform_type IS NULL OR dataset.flatform_type = p_flatform_type)
  ORDER BY dataset.updated_at DESC, dataset.id DESC
 ) AS result WHERE desktop_request_guard.allowed;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_email_campaign_link_tracking_summaries(p_campaign_id bigint)
 RETURNS TABLE(url text, email_count bigint, link_count bigint, click_count bigint, first_clicked_at timestamp with time zone, last_clicked_at timestamp with time zone, first_tracked_at timestamp with time zone, last_tracked_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH desktop_request_guard AS MATERIALIZED (SELECT private.aka_agent_assert_request_ownership(NULL, NULL, p_campaign_id) AS allowed)
 SELECT result.* FROM desktop_request_guard
 CROSS JOIN LATERAL (
SELECT
    link_tracking.original_url AS url,
    COUNT(DISTINCT message_tracking.id) AS email_count,
    COUNT(*) AS link_count,
    COALESCE(SUM(link_tracking.click_count), 0)::bigint AS click_count,
    MIN(link_tracking.first_clicked_at) AS first_clicked_at,
    MAX(link_tracking.last_clicked_at) AS last_clicked_at,
    MIN(link_tracking.created_at) AS first_tracked_at,
    MAX(link_tracking.created_at) AS last_tracked_at
  FROM public.auto_email_link_trackings AS link_tracking
  INNER JOIN public.auto_email_message_trackings AS message_tracking
    ON message_tracking.id = link_tracking.message_tracking_id
  WHERE message_tracking.campaign_id = p_campaign_id
    AND message_tracking.is_delete = false
    AND link_tracking.is_delete = false
  GROUP BY link_tracking.original_url
  ORDER BY
    COALESCE(SUM(link_tracking.click_count), 0) DESC,
    COUNT(*) DESC,
    link_tracking.original_url ASC
 ) AS result WHERE desktop_request_guard.allowed;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_lock_campaign_input_serialization(p_campaign_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(NULL, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'campaign_input_serialization_id_invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'aka-agent-campaign-input-serialization:' || p_campaign_id::text, 0
  ));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_prepare_zalo_message_opt_out(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_phone text, p_zalo_global_id text)
 RETURNS TABLE(id uuid, is_opted_out boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_phone text := NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '');
  v_zalo_global_id text := NULLIF(pg_catalog.btrim(p_zalo_global_id), '');
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_zalo_message_opt_out_scope';
  END IF;
  IF v_zalo_global_id IS NULL THEN
    RAISE EXCEPTION 'zalo_global_id_required';
  END IF;

  SELECT campaign.organization_id
  INTO v_organization_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = campaign.organization_id
   AND account.flatform_type = 'zalo'
   AND COALESCE(account.is_delete, false) = false
  JOIN public.org_staff AS staff
    ON staff.id = p_staff_id
   AND staff.organization_id = campaign.organization_id
   AND staff.is_active = true
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_message_friend',
      'zalo_message_birthday',
      'zalo_message_group_member',
      'zalo_message_group_realtime',
      'zalo_message_remarketing_customer',
      'zalo_message_friend_recommendation'
    )
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_message_opt_out_scope_not_found';
  END IF;

  RETURN QUERY
  INSERT INTO public.auto_zalo_message_opt_outs AS opt_out (
    phone,
    zalo_global_id,
    staff_id,
    organization_id
  )
  VALUES (
    v_phone,
    v_zalo_global_id,
    p_staff_id,
    v_organization_id
  )
  ON CONFLICT (staff_id, organization_id, zalo_global_id)
  DO UPDATE SET phone = COALESCE(EXCLUDED.phone, opt_out.phone)
  RETURNING opt_out.id, opt_out.confirmed_at IS NOT NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_settle_action_results_v1(p_staff_id bigint, p_campaign_id bigint, p_account_id bigint, p_claim_token uuid, p_unit_token uuid, p_input_data_id bigint, p_detail_ids bigint[], p_input_patch jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
 c public.auto_campaigns%ROWTYPE;
 i public.auto_campaign_input_data%ROWTYPE;
 d public.auto_campaign_details%ROWTYPE;
 v_ids bigint[];
 v_bad text:='ignore'; v_effect text:='none'; v_committed boolean:=false; v_reset_before boolean:=false;
 v_existing jsonb; v_settlement jsonb; v_count integer; v_status text;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

 IF p_claim_token IS NULL OR p_unit_token IS NULL OR (COALESCE(cardinality(p_detail_ids),0)=0 AND (p_input_patch->'suppressedResult' IS NULL))
   OR array_position(p_detail_ids,NULL) IS NOT NULL
   OR (p_input_patch IS NOT NULL AND jsonb_typeof(p_input_patch)<>'object')
 THEN RAISE EXCEPTION 'action_result_settlement_invalid'; END IF;
 PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_scope_invalid'; END IF;
 PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
 IF p_input_data_id IS NOT NULL THEN
   SELECT * INTO i FROM public.auto_campaign_input_data WHERE id=p_input_data_id AND campaign_id=p_campaign_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'action_result_input_invalid'; END IF;
 END IF;
 SELECT x.* INTO c FROM public.auto_campaigns x JOIN public.auto_accounts a ON a.id=p_account_id
   AND a.staff_id=x.staff_id AND a.organization_id IS NOT DISTINCT FROM x.organization_id
 WHERE x.id=p_campaign_id AND x.staff_id=p_staff_id AND p_account_id IN (x.account_id,x.secondary_account_id)
   AND x.runtime_claim_token=p_claim_token AND x.runtime_unit_token=p_unit_token
   AND x.runtime_unit_claimed_at IS NOT NULL FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_claim_invalid'; END IF;
 IF p_input_data_id IS NOT NULL AND NOT COALESCE(p_input_data_id=ANY(c.runtime_unit_input_data_ids),false)
 THEN RAISE EXCEPTION 'action_result_input_not_in_unit'; END IF;
 IF p_input_patch ? 'suppressedResult' THEN
   v_effect:=p_input_patch->'suppressedResult'->>'inputEffect';
   IF v_effect IS NULL OR v_effect NOT IN ('complete','pause','requeue','none') THEN RAISE EXCEPTION 'action_result_suppression_invalid'; END IF;
   v_committed:=COALESCE(p_input_patch->'suppressedResult'->>'operationState','unknown')<>'not_committed';
 END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}'::bigint[]) INTO v_ids FROM unnest(p_detail_ids) id;
 IF cardinality(v_ids)<>cardinality(p_detail_ids) THEN RAISE EXCEPTION 'action_result_settlement_duplicate_id'; END IF;
 IF (SELECT count(*) FROM public.auto_campaign_details WHERE id=ANY(v_ids) AND campaign_id=p_campaign_id
    AND account_id=p_account_id AND input_data_id IS NOT DISTINCT FROM p_input_data_id
    AND policy_snapshot->>'unitKey'=md5(p_unit_token::text))<>cardinality(v_ids)
 THEN RAISE EXCEPTION 'action_result_settlement_scope_invalid'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_campaign_details sibling
   WHERE sibling.campaign_id=p_campaign_id
     AND ((p_input_data_id IS NULL AND sibling.input_data_id IS NULL) OR sibling.input_data_id=p_input_data_id)
     AND sibling.policy_snapshot->>'unitKey'=md5(p_unit_token::text) AND NOT sibling.id=ANY(v_ids))
 THEN RAISE EXCEPTION 'action_result_settlement_incomplete'; END IF;
 FOR d IN SELECT * FROM public.auto_campaign_details WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE LOOP
   v_reset_before:=v_reset_before OR COALESCE(d.policy_snapshot->'badTargetResetBefore'='true'::jsonb,false);
   IF d.policy_snapshot->>'badTargetEffect'='increment' THEN v_bad:='increment';
   ELSIF d.policy_snapshot->>'badTargetEffect'='reset' AND v_bad='ignore' THEN v_bad:='reset'; END IF;
   IF d.policy_snapshot->>'inputEffect'='pause' THEN v_effect:='pause';
   ELSIF d.policy_snapshot->>'inputEffect'='requeue' AND v_effect<>'pause' THEN v_effect:='requeue';
   ELSIF d.policy_snapshot->>'inputEffect'='complete' AND v_effect='none' THEN v_effect:='complete'; END IF;
   v_committed:=v_committed OR d.policy_snapshot->>'operationState'<>'not_committed';
   IF d.policy_snapshot ? 'settlement' THEN
     IF v_existing IS NOT NULL AND v_existing IS DISTINCT FROM d.policy_snapshot->'settlement'
     THEN RAISE EXCEPTION 'action_result_settlement_conflict'; END IF;
     v_existing:=d.policy_snapshot->'settlement';
   END IF;
 END LOOP;
 IF v_committed AND v_effect='requeue' THEN v_effect:='pause'; END IF;
 IF v_existing IS NOT NULL THEN
   IF v_existing->'detailIds' IS DISTINCT FROM to_jsonb(v_ids)
   THEN RAISE EXCEPTION 'action_result_settlement_conflict'; END IF;
   v_settlement:=v_existing; v_count:=(v_existing->>'badTargetCount')::integer;
 ELSE
   IF v_bad='increment' THEN
     INSERT INTO public.auto_campaign_error_state(campaign_id,count_consecutive_bad_targets,last_input_data_id,last_reason,last_bad_target_at,updated_at)
     VALUES(p_campaign_id,1,p_input_data_id,left(p_reason,2000),now(),now())
     ON CONFLICT(campaign_id) DO UPDATE SET count_consecutive_bad_targets=CASE WHEN v_reset_before THEN 1 ELSE auto_campaign_error_state.count_consecutive_bad_targets+1 END,
       last_input_data_id=EXCLUDED.last_input_data_id,last_reason=EXCLUDED.last_reason,last_bad_target_at=now(),updated_at=now()
     RETURNING count_consecutive_bad_targets INTO v_count;
   ELSIF v_bad='reset' OR v_reset_before THEN
     INSERT INTO public.auto_campaign_error_state(campaign_id,count_consecutive_bad_targets,last_reason,updated_at)
     VALUES(p_campaign_id,0,NULL,now()) ON CONFLICT(campaign_id) DO UPDATE
       SET count_consecutive_bad_targets=0,last_reason=NULL,updated_at=now() RETURNING count_consecutive_bad_targets INTO v_count;
   ELSE
     SELECT count_consecutive_bad_targets INTO v_count FROM public.auto_campaign_error_state WHERE campaign_id=p_campaign_id;
     v_count:=COALESCE(v_count,0);
   END IF;
   v_settlement:=jsonb_build_object('detailIds',v_ids,'badTargetEffect',v_bad,'badTargetResetBefore',v_reset_before,'badTargetCount',v_count,'inputEffect',v_effect,'inputApplied',false);
 END IF;
 IF p_input_patch IS NOT NULL AND p_input_data_id IS NOT NULL AND NOT COALESCE((p_input_patch->>'deferInput')::boolean,false) AND NOT (v_settlement->>'inputApplied')::boolean THEN
   v_status:=CASE v_effect WHEN 'complete' THEN 'hoàn thành' WHEN 'pause' THEN 'tạm dừng' WHEN 'requeue' THEN 'chờ xử lý' ELSE i.status END;
   -- Existing cancellation/account/opt-out guards may strengthen, never weaken,
   -- the configured decision. A completed/unknown operation cannot be requeued.
   IF p_input_patch->>'status'='tạm dừng' THEN v_status:='tạm dừng'; END IF;
   IF p_input_patch->>'status'='chờ xử lý' AND v_effect<>'pause' THEN v_status:=CASE WHEN v_committed THEN 'tạm dừng' ELSE 'chờ xử lý' END; END IF;
   IF i.status='tạm dừng' THEN v_status:='tạm dừng'; END IF;
   UPDATE public.auto_campaign_input_data SET status=v_status,
     note=CASE WHEN p_input_patch ? 'note' THEN p_input_patch->>'note' ELSE note END,
     date_action=CASE WHEN v_status='hoàn thành' THEN now() ELSE date_action END
   WHERE id=p_input_data_id RETURNING * INTO i;
   v_settlement:=v_settlement || jsonb_build_object('inputApplied',true,'inputStatus',v_status);
 END IF;
 UPDATE public.auto_campaign_details SET policy_snapshot=jsonb_set(policy_snapshot,'{settlement}',v_settlement) WHERE id=ANY(v_ids);
 RETURN jsonb_build_object('settlement',v_settlement,'input',CASE WHEN p_input_data_id IS NULL THEN NULL ELSE to_jsonb(i) END);
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_take_campaign_content_index(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_runtime_unit_token uuid, p_input_data_id bigint, p_action_code text, p_variant_count integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_input public.auto_campaign_input_data%ROWTYPE;
  v_raw text;
  v_index integer;
  v_first boolean;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 OR p_runtime_target IS NULL
    OR p_runtime_target NOT IN ('desktop','server')
    OR p_runtime_claim_token IS NULL OR p_runtime_unit_token IS NULL
    OR p_action_code IS NULL OR btrim(p_action_code) = '' OR length(p_action_code) > 128
    OR p_variant_count IS NULL OR p_variant_count < 1
    OR (p_input_data_id IS NOT NULL AND p_input_data_id <= 0) THEN
    RAISE EXCEPTION 'campaign_content_invalid_arguments';
  END IF;

  SELECT organization_id INTO v_org FROM public.org_staff
  WHERE id=p_staff_id AND is_active IS TRUE FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'campaign_content_not_owner'; END IF;

  -- Same lock order as unit claim: staff -> entitlement -> serialization -> input -> campaign/account.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
  IF p_input_data_id IS NOT NULL THEN
    SELECT * INTO v_input FROM public.auto_campaign_input_data
    WHERE id=p_input_data_id AND campaign_id=p_campaign_id
      AND NOT COALESCE(is_delete,false) AND status='đang chạy' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_content_input_not_owned'; END IF;
  END IF;

  SELECT c.* INTO v_campaign FROM public.auto_campaigns c
  JOIN public.auto_accounts a ON a.id=c.account_id AND a.staff_id=c.staff_id
  WHERE c.id=p_campaign_id AND c.account_id=p_account_id AND c.staff_id=p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id=v_org)
    AND (a.organization_id IS NULL OR a.organization_id=v_org)
    AND NOT COALESCE(c.is_delete,false) AND NOT COALESCE(a.is_delete,false)
    AND a.is_active IS TRUE AND a.login_status='đã đăng nhập'
    -- Server pause drains the already-claimed unit before releasing ownership.
    AND (p_runtime_target='server' OR (c.status='đang chạy' AND a.status='đang chạy'))
    AND c.runtime_claim_token=p_runtime_claim_token AND c.runtime_claim_target=p_runtime_target
    AND c.runtime_unit_token=p_runtime_unit_token AND c.runtime_unit_claimed_at IS NOT NULL
  FOR UPDATE OF c,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_content_not_owner'; END IF;
  IF p_input_data_id IS NOT NULL AND NOT COALESCE(p_input_data_id=ANY(v_campaign.runtime_unit_input_data_ids),false) THEN
    RAISE EXCEPTION 'campaign_content_input_not_in_unit';
  END IF;
  IF p_variant_count=1 THEN RETURN 0; END IF;

  v_first := p_input_data_id IS NULL OR NOT (v_input.content_rotation_indexes ? p_action_code);
  IF v_first THEN
    v_raw := v_campaign.content_rotation_indexes->>p_action_code;
    IF v_raw IS NULL AND v_campaign.action_id IN ('facebook_timeline_post','facebook_page_post')
      AND p_action_code IN ('fb_post_my_profile','fb_post_page') THEN
      v_raw := v_campaign.extra_settings->>'contentRotationIndex';
    END IF;
  ELSE
    v_raw := v_input.content_rotation_indexes->>p_action_code;
  END IF;
  -- Modulo the current snapshot size; changing templates does not clear state.
  v_index := CASE WHEN v_raw ~ '^[0-9]{1,16}$'
    THEN mod(v_raw::numeric,p_variant_count)::integer ELSE 0 END;
  IF v_first THEN
    UPDATE public.auto_campaigns SET content_rotation_indexes=jsonb_set(
      content_rotation_indexes,ARRAY[p_action_code],to_jsonb((v_index+1)%p_variant_count),true)
    WHERE id=p_campaign_id;
  END IF;
  IF p_input_data_id IS NOT NULL THEN
    UPDATE public.auto_campaign_input_data SET content_rotation_indexes=jsonb_set(
      content_rotation_indexes,ARRAY[p_action_code],to_jsonb((v_index+1)%p_variant_count),true)
    WHERE id=p_input_data_id;
  END IF;
  RETURN v_index;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_write_action_result_v1(p_staff_id bigint, p_campaign_id bigint, p_account_id bigint, p_claim_token uuid, p_unit_token uuid, p_result_key text, p_detail jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
 c public.auto_campaigns%ROWTYPE;
 d public.auto_campaign_details%ROWTYPE;
 p public.auto_account_action_status_policies%ROWTYPE;
 v_input_id bigint := (p_detail->>'input_data_id')::bigint;
 decision jsonb := p_detail->'policy_snapshot';
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

 IF p_staff_id IS NULL OR p_campaign_id IS NULL OR p_account_id IS NULL
   OR p_claim_token IS NULL OR p_unit_token IS NULL OR NULLIF(p_result_key,'') IS NULL
   OR jsonb_typeof(p_detail) IS DISTINCT FROM 'object'
   OR jsonb_typeof(decision) IS DISTINCT FROM 'object'
   OR jsonb_typeof(decision->'countsTowardLimit') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(decision->'resetErrorStreak') IS DISTINCT FROM 'boolean'
   OR decision->>'reportGroup' IS NULL OR decision->>'reportGroup' NOT IN ('success','failure','skipped','pending')
   OR decision->>'badTargetEffect' IS NULL OR decision->>'badTargetEffect' NOT IN ('increment','reset','ignore')
   OR decision->>'inputEffect' IS NULL OR decision->>'inputEffect' NOT IN ('complete','pause','requeue','none')
   OR decision->>'operationState' IS NULL OR decision->>'operationState' NOT IN ('committed','not_committed','unknown')
   OR decision ? 'settlement'
 THEN RAISE EXCEPTION 'action_result_payload_invalid'; END IF;
 -- Result commit drains an already claimed operation. Do not reject its error
 -- detail because an error policy just disabled the account or staff access.
 PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_scope_invalid'; END IF;
 PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
 IF v_input_id IS NOT NULL THEN
   PERFORM 1 FROM public.auto_campaign_input_data WHERE id=v_input_id AND campaign_id=p_campaign_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'action_result_input_invalid'; END IF;
 END IF;
 SELECT x.* INTO c FROM public.auto_campaigns x JOIN public.auto_accounts a ON a.id=p_account_id
   AND a.staff_id=x.staff_id AND a.organization_id IS NOT DISTINCT FROM x.organization_id
 WHERE x.id=p_campaign_id AND x.staff_id=p_staff_id
   AND p_account_id IN (x.account_id,x.secondary_account_id)
   AND x.runtime_claim_token=p_claim_token AND x.runtime_unit_token=p_unit_token
   AND x.runtime_unit_claimed_at IS NOT NULL FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'action_result_claim_invalid'; END IF;
 IF v_input_id IS NOT NULL AND NOT COALESCE(v_input_id=ANY(c.runtime_unit_input_data_ids),false)
 THEN RAISE EXCEPTION 'action_result_input_not_in_unit'; END IF;
 SELECT * INTO d FROM public.auto_campaign_details WHERE result_key=p_result_key;
 IF FOUND THEN
   IF d.campaign_id<>p_campaign_id OR d.account_id<>p_account_id
     OR d.input_data_id IS DISTINCT FROM v_input_id
     OR d.action_code IS DISTINCT FROM p_detail->>'action_code'
     OR d.status_id IS DISTINCT FROM (p_detail->>'status_id')::bigint
     OR d.policy_snapshot->>'unitKey' IS DISTINCT FROM md5(p_unit_token::text)
   THEN RAISE EXCEPTION 'action_result_key_conflict'; END IF;
   RETURN jsonb_build_object('detail',to_jsonb(d),'inserted',false);
 END IF;
 SELECT * INTO p FROM public.auto_account_action_status_policies
   WHERE id=(p_detail->>'action_status_policy_id')::bigint FOR SHARE;
 IF NOT FOUND OR p.status_id IS DISTINCT FROM (p_detail->>'status_id')::bigint
   OR (p.action_code IS NOT NULL AND p.action_code IS DISTINCT FROM p_detail->>'action_code')
 THEN RAISE EXCEPTION 'result_policy_identity_mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_campaign_details old
   WHERE old.campaign_id=p_campaign_id AND ((v_input_id IS NULL AND old.input_data_id IS NULL) OR old.input_data_id=v_input_id) AND old.policy_snapshot->>'unitKey'=md5(p_unit_token::text)
     AND old.policy_snapshot ? 'settlement')
 THEN RAISE EXCEPTION 'action_result_target_settled'; END IF;
 decision:=decision || jsonb_build_object('unitKey',md5(p_unit_token::text));
 -- Guard execution evidence even if a caller supplied an unsafe retry decision.
 IF decision->>'inputEffect'='requeue' AND decision->>'operationState'<>'not_committed'
 THEN decision:=jsonb_set(decision,'{inputEffect}','"pause"'); END IF;
 INSERT INTO public.auto_campaign_details(input_data_id,campaign_id,account_id,action_code,action_name,status,
   error_code,log,data,post_url,status_id,sub_status_id,action_status_policy_id,report_group,
   counts_toward_limit,policy_snapshot,result_key)
 VALUES(v_input_id,p_campaign_id,p_account_id,p_detail->>'action_code',p_detail->>'action_name',p_detail->>'status',
   NULLIF(p_detail->>'error_code',''),p_detail->>'log',p_detail->'data',p_detail->>'post_url',
   (p_detail->>'status_id')::bigint,(p_detail->>'sub_status_id')::bigint,p.id,decision->>'reportGroup',
   (decision->>'countsTowardLimit')::boolean,decision,p_result_key) RETURNING * INTO d;
 IF (decision->>'countsTowardLimit')::boolean THEN
   PERFORM public.increment_auto_account_action_count(p_account_id,d.action_code,1);
 END IF;
 IF (decision->>'resetErrorStreak')::boolean THEN
   UPDATE public.auto_account_error_state SET count_consecutive_errors=0,updated_at=now()
     WHERE account_id=p_account_id AND action_code=d.action_code;
 END IF;
 RETURN jsonb_build_object('detail',to_jsonb(d),'inserted',true);
END $function$
;
CREATE OR REPLACE FUNCTION public.append_auto_campaign_log(p_campaign_id bigint, p_staff_id bigint, p_log_line text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 v_log text:=p_log_line;
 v_marker constant text:=' … [nội dung quá dài đã được rút gọn]';
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

 IF p_campaign_id IS NULL OR p_campaign_id<=0 THEN RAISE EXCEPTION 'Campaign ID must be a positive integer'; END IF;
 IF p_staff_id IS NULL OR p_staff_id<=0 THEN RAISE EXCEPTION 'Staff ID must be a positive integer'; END IF;
 IF nullif(btrim(coalesce(v_log,'')),'') IS NULL THEN RAISE EXCEPTION 'Campaign log line must not be empty'; END IF;
 IF char_length(v_log)>16000 THEN v_log:=left(v_log,16000-char_length(v_marker))||v_marker; END IF;
 -- All writers acquire this lock before identity allocation. A later cursor
 -- can therefore never jump over an earlier uncommitted append for this campaign.
 PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:'||p_campaign_id::text,0));
 IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.id=p_campaign_id AND c.staff_id=p_staff_id AND coalesce(c.is_delete,false)=false)
 THEN RAISE EXCEPTION 'Active campaign % was not found',p_campaign_id; END IF;
 INSERT INTO public.auto_campaign_logs(campaign_id,log) VALUES(p_campaign_id,v_log);
 RETURN true;
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_zalo_phone_check_usage(p_staff_id bigint, p_organization_id bigint, p_account_id bigint, p_runtime_target text, p_claim_token uuid, p_consume boolean, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '5s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_capabilities record;
  v_today date;
  v_count integer := 0;
  v_limit integer := 600;
  v_setting text;
  v_allowed boolean;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL); -- Bind Desktop token before privileged work.

  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 OR p_consume IS NULL
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop','server') THEN
    RAISE EXCEPTION 'phone_check_identity_invalid';
  END IF;
  IF p_auth_username IS NOT NULL OR p_auth_password IS NOT NULL THEN
    PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  ELSIF p_runtime_target <> 'server' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'phone_check_auth_required';
  END IF;
  -- Preserve the existing scan lock order: staff, entitlement barrier, account.
  PERFORM 1 FROM public.org_staff s WHERE s.id=p_staff_id AND s.organization_id=p_organization_id
    AND s.is_active=true AND public.aka_agent_staff_time_allowed(s.id) FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'phone_check_staff_invalid'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  SELECT * INTO v_capabilities FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);
  IF p_consume OR p_auth_username IS NULL THEN
    SELECT * INTO v_account FROM public.auto_accounts a
      WHERE a.id=p_account_id AND a.staff_id=p_staff_id
        AND (a.organization_id IS NULL OR a.organization_id=p_organization_id) FOR UPDATE OF a;
  ELSE
    SELECT * INTO v_account FROM public.auto_accounts a
      WHERE a.id=p_account_id AND a.staff_id=p_staff_id
        AND (a.organization_id IS NULL OR a.organization_id=p_organization_id);
  END IF;
  IF NOT FOUND OR COALESCE(v_account.is_delete,false)
    OR lower(btrim(COALESCE(v_account.flatform_type,''))) <> 'zalo' THEN
    RAISE EXCEPTION 'phone_check_account_invalid';
  END IF;
  IF (p_runtime_target='server' AND (v_account.is_zalo_server IS NOT TRUE OR v_account.is_zalo_show_web IS TRUE
      OR NOT COALESCE(v_capabilities.qr_enabled,false) OR NOT COALESCE(v_capabilities.server_enabled,false)))
    OR (p_runtime_target='desktop' AND (v_account.is_zalo_server IS TRUE
      OR (v_account.is_zalo_show_web IS TRUE AND NOT COALESCE(v_capabilities.web_enabled,false))
      OR (v_account.is_zalo_show_web IS NOT TRUE AND NOT COALESCE(v_capabilities.qr_enabled,false)))) THEN
    RAISE EXCEPTION 'phone_check_runtime_not_owner';
  END IF;
  IF (p_consume OR p_auth_username IS NULL) AND (p_claim_token IS NULL
    OR v_account.runtime_operation_claim_token IS DISTINCT FROM p_claim_token
    OR v_account.status IS DISTINCT FROM 'đang chạy'
    OR v_account.is_active IS NOT TRUE OR v_account.login_status IS DISTINCT FROM 'đã đăng nhập') THEN
    RAISE EXCEPTION 'phone_check_claim_invalid';
  END IF;
  -- Compute after acquiring the row lock, including a wait across midnight.
  v_today := timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
  IF (v_account.zalo_phone_check_usage->>'date')::date > v_today THEN
    RAISE EXCEPTION 'phone_check_usage_date_in_future';
  END IF;
  IF v_account.zalo_phone_check_usage->>'date' = v_today::text THEN
    v_count := (v_account.zalo_phone_check_usage->>'count')::integer;
  END IF;
  SELECT value INTO v_setting FROM public.auto_system_settings
    WHERE key='zalo.phone_check.daily_limit' AND is_active=true AND is_secret=false;
  IF v_setting ~ '^[1-9][0-9]{0,9}$' AND v_setting::numeric <= 2147483647 THEN
    v_limit := v_setting::integer;
  END IF;
  v_allowed := v_count < v_limit;
  IF p_consume AND v_allowed THEN
    v_count := v_count+1;
    UPDATE public.auto_accounts SET zalo_phone_check_usage=jsonb_build_object('date',v_today,'count',v_count)
      WHERE id=p_account_id;
  END IF;
  RETURN jsonb_build_object('allowed',v_allowed,'date',v_today,'count',v_count,'limit',v_limit,
    'remaining',greatest(0,v_limit-v_count),
    'resetAt',((v_today+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_contact_dataset(p_staff_id bigint, p_organization_id bigint, p_account_id bigint, p_scan_type text, p_contact_type text, p_source_key text, p_name text, p_link text, p_description text, p_status text, p_contact_uids text[], p_extra_data jsonb, p_data_type_category_item_id bigint, p_claim_token uuid)
 RETURNS SETOF auto_account_contacts_dataset
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_capabilities record;
  v_expected_type bigint;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL); -- Bind Desktop token before privileged work.

  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_claim_token IS NULL
  THEN
    RAISE EXCEPTION 'server_contact_dataset_claim_required';
  END IF;
  IF p_scan_type IS DISTINCT FROM 'zalo_group_members'
    OR p_contact_type IS DISTINCT FROM 'person'
  THEN
    RAISE EXCEPTION 'server_contact_dataset_scan_not_supported';
  END IF;

  -- Match claim lock order: staff, entitlement barrier, account.
  PERFORM 1 FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'server_contact_dataset_staff_invalid';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RAISE EXCEPTION 'server_contact_dataset_runtime_not_owner';
  END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
    OR v_account.is_zalo_server IS NOT TRUE
    OR v_account.is_zalo_show_web IS TRUE
    OR v_account.status IS DISTINCT FROM 'đang chạy'
    OR v_account.runtime_operation_claim_token IS DISTINCT FROM p_claim_token
  THEN
    RAISE EXCEPTION 'server_contact_dataset_claim_invalid';
  END IF;

  v_expected_type := public.aka_agent_data_type_category_item_id('zalo_person', true);
  IF v_expected_type IS NULL OR (p_data_type_category_item_id IS NOT NULL
    AND p_data_type_category_item_id <> v_expected_type)
  THEN
    RAISE EXCEPTION 'server_contact_dataset_data_type_invalid';
  END IF;

  -- Reuse the live v244 semantic core and v205 snapshot behavior. In particular,
  -- partial results merge, completed snapshots replace, and failed scans preserve members.
  RETURN QUERY SELECT * FROM public.aka_agent_finalize_contact_dataset(
    p_staff_id, p_organization_id, p_account_id,
    p_scan_type, p_contact_type, p_source_key, p_name, p_link, p_description,
    p_status, p_contact_uids, p_extra_data, v_expected_type
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_auto_automation_enqueue_failures(p_staff_id bigint, p_organization_id bigint, p_worker_id text, p_limit integer DEFAULT 100, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_base jsonb;
  v_detail record;
  v_outcome jsonb;
  v_processed integer := 0;
  v_completed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.

  v_base := public.reconcile_auto_automation_enqueue_failures_v185_internal(
    p_staff_id, p_organization_id, p_worker_id, p_limit,
    p_auth_username, p_auth_password
  );

  FOR v_detail IN
    SELECT detail.id
    FROM public.auto_automation_detail AS detail
    WHERE detail.staff_id = p_staff_id AND detail.organization_id = p_organization_id
      AND detail.status = 'đã thêm'
      AND detail.target_data_group_id IS NOT NULL
      AND detail.target_data_group_member_id IS NULL
      AND COALESCE(detail.target_data_group_sync_status, 'pending') IN ('pending', 'failed')
    ORDER BY detail.processed_at, detail.id
    LIMIT v_limit
  LOOP
    v_processed := v_processed + 1;
    v_outcome := public.aka_agent_ingest_automation_data_group_result(
      p_staff_id, p_organization_id, v_detail.id
    );
    CASE v_outcome ->> 'code'
      WHEN 'completed' THEN v_completed := v_completed + 1;
      WHEN 'skipped' THEN v_skipped := v_skipped + 1;
      ELSE v_failed := v_failed + 1;
    END CASE;
  END LOOP;

  RETURN COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
    'data_group_processed', v_processed,
    'data_group_completed', v_completed,
    'data_group_skipped', v_skipped,
    'data_group_failed', v_failed
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_bind_campaign_data_group_source(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_campaign_id bigint, p_group_id bigint, p_bundle_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
  v_result jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    v_result := public.aka_agent_bind_campaign_data_group_source(
      p_staff_id, p_organization_id, p_request_id, p_campaign_id,
      p_group_id, p_bundle_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_campaign_diagnostics_evidence(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_account_id bigint;
  v_log text;
  v_account_history jsonb;
  v_campaign_history jsonb;
  v_results jsonb;
  v_summary jsonb;
  v_inputs jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  -- Explicit credentials and tenant ownership are required even for a service-role caller.
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_campaign_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id
      WHERE s.id=p_staff_id AND s.organization_id=p_organization_id AND s.is_active
        AND s.username=p_auth_username AND s.password=p_auth_password) THEN
    RAISE EXCEPTION 'diagnostics_access_denied' USING ERRCODE='42501';
  END IF;
  SELECT c.account_id INTO v_account_id
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id=c.account_id
  WHERE c.id=p_campaign_id AND c.staff_id=p_staff_id AND NOT c.is_delete
    AND (c.organization_id=p_organization_id OR c.organization_id IS NULL)
    AND a.staff_id=p_staff_id AND (a.organization_id=p_organization_id OR a.organization_id IS NULL)
    AND a.flatform_type IN ('facebook','zalo','email');
  IF NOT FOUND THEN RAISE EXCEPTION 'diagnostics_access_denied' USING ERRCODE='42501'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_account_history FROM (
    SELECT id,created_at,login_status,account_status,source,event_type,left(message,8000) AS message,details
    FROM public.auto_account_logs WHERE account_id=v_account_id
    ORDER BY created_at DESC,id DESC LIMIT 30
  ) x;
  -- Latest 30 nonempty physical lines, preserving the existing evidence contract.
  SELECT coalesce(jsonb_agg(left(x.line,8000) ORDER BY x.id DESC,x.n DESC),'[]') INTO v_campaign_history FROM (
    SELECT h.id,l.line,l.n
    FROM (SELECT id,log FROM public.auto_campaign_logs WHERE campaign_id=p_campaign_id ORDER BY id DESC LIMIT 30) h
    CROSS JOIN LATERAL unnest(string_to_array(h.log,E'\n')) WITH ORDINALITY l(line,n)
    WHERE btrim(l.line)<>'' ORDER BY h.id DESC,l.n DESC LIMIT 30
  ) x;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_results FROM (
    SELECT id,input_data_id,created_at,action_name,action_code,status,left(log,8000) AS log,
      error_code,status_id,sub_status_id,action_status_policy_id,report_group,policy_snapshot,counts_toward_limit,post_url
    FROM public.auto_campaign_details WHERE campaign_id=p_campaign_id AND account_id=v_account_id AND NOT is_delete
    ORDER BY created_at DESC,id DESC LIMIT 30
  ) x;
  SELECT coalesce(jsonb_object_agg(x.status,x.total),'{}') INTO v_summary FROM (
    SELECT coalesce(status,'chưa xác minh') AS status,count(*) AS total FROM public.auto_campaign_input_data
    WHERE campaign_id=p_campaign_id AND NOT is_delete GROUP BY status
  ) x;
  WITH pending AS MATERIALIZED (
    SELECT id,input_id,name,phone,uid,email,status,schedule,note,content,info1,info2,info3,info4,info5,created_at
    FROM public.auto_campaign_input_data WHERE campaign_id=p_campaign_id AND NOT is_delete AND status='chờ xử lý'
    ORDER BY created_at DESC,id DESC LIMIT 30
  ), others AS (
    SELECT id,input_id,name,phone,uid,email,status,schedule,note,content,info1,info2,info3,info4,info5,created_at
    FROM public.auto_campaign_input_data WHERE campaign_id=p_campaign_id AND NOT is_delete AND status IS DISTINCT FROM 'chờ xử lý'
    ORDER BY created_at DESC,id DESC LIMIT (SELECT 30-count(*) FROM pending)
  ), sample AS (SELECT * FROM pending UNION ALL SELECT * FROM others)
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY (x.status='chờ xử lý') DESC NULLS LAST,x.created_at DESC,x.id DESC),'[]') INTO v_inputs FROM sample x;
  RETURN jsonb_build_object('accountHistory',v_account_history,'campaignHistory',v_campaign_history,
    'results',v_results,'inputSummary',v_summary,'inputs',v_inputs);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_campaign_detail(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_access jsonb, p_campaign_id bigint, p_part text, p_cursor jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_row jsonb; v_version text; v_log text; v_updated_at timestamptz;
  v_tail text; v_length integer; v_end integer; v_prefix text; v_keep integer;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_access IS NULL OR p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_part NOT IN ('config','log') OR p_part IS NULL THEN
    RAISE EXCEPTION 'Invalid campaign detail scope';
  END IF;
  IF p_part='config' THEN
    SELECT jsonb_build_object('id',c.id,'name',c.name,'action_id',c.action_id,'account_id',c.account_id,'secondary_account_id',c.secondary_account_id,'status',c.status,'schedule',c.schedule,'original_schedule',c.original_schedule,'schedule_type',c.schedule_type,'schedule_end_date',c.schedule_end_date,'daily_stop_time',c.daily_stop_time,'schedule_days',c.schedule_days,'schedule_week_days',c.schedule_week_days,'continue_next_day',c.continue_next_day,'refresh_data',c.refresh_data,'content',c.content,'extra_settings',c.extra_settings,'images',c.images,'note',c.note,'is_delete',c.is_delete,'staff_id',c.staff_id,'organization_id',c.organization_id,'created_at',c.created_at,'updated_at',c.updated_at,'completed_at',c.completed_at,'last_run_at',c.last_run_at,'data_target_source_mode',c.data_target_source_mode,'data_group_id',c.data_group_id,'provisioning_state',c.provisioning_state,'creation_bundle_id',c.creation_bundle_id,'creation_bundle_child_index',c.creation_bundle_child_index,'primary_account',jsonb_build_object('name',a.name,'flatform_type',a.flatform_type,'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server),'auto_campaign_actions',jsonb_build_object('name',ca.name)),public.aka_agent_desktop_campaign_config_version(c) INTO v_row,v_version
    FROM public.auto_campaigns c
    LEFT JOIN public.auto_campaign_actions ca ON ca.id=c.action_id
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND coalesce((p_access->>CASE
        WHEN c.action_id IN ('sms_send','voice_call') THEN 'sms'
        WHEN c.action_id='email_send' THEN 'email'
        WHEN c.action_id = ANY(ARRAY['zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation','zalo_message_group','zalo_add_group_member','zalo_join_group_link','zalo_cancel_sent_friend_request']) THEN 'zalo'
        WHEN c.action_id IN ('facebook_page_post','facebook_page_to_message') THEN 'facebookFanpage'
        ELSE 'facebookCore' END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
      AND c.id=p_campaign_id;
    RETURN CASE WHEN v_row IS NULL THEN NULL ELSE jsonb_build_object('row',v_row,'version',v_version) END;
  END IF;
  IF p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object'
    OR coalesce(p_cursor->>'version','') !~ '^[a-f0-9]{32}$'
    OR coalesce(p_cursor->>'length','') !~ '^[0-9]{1,7}$'
    OR jsonb_typeof(p_cursor->'tail') IS DISTINCT FROM 'string'
    OR char_length(p_cursor->>'tail')>1024) THEN
    RAISE EXCEPTION 'Invalid campaign log cursor';
  END IF;
  SELECT h.data->>'log',(h.data->>'updatedAt')::timestamptz INTO v_log,v_updated_at
  FROM public.auto_campaigns c
  CROSS JOIN LATERAL (SELECT private.campaign_log_legacy(c.id) AS data) h
    LEFT JOIN public.auto_campaign_actions ca ON ca.id=c.action_id
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND coalesce((p_access->>CASE
        WHEN c.action_id IN ('sms_send','voice_call') THEN 'sms'
        WHEN c.action_id='email_send' THEN 'email'
        WHEN c.action_id = ANY(ARRAY['zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation','zalo_message_group','zalo_add_group_member','zalo_join_group_link','zalo_cancel_sent_friend_request']) THEN 'zalo'
        WHEN c.action_id IN ('facebook_page_post','facebook_page_to_message') THEN 'facebookFanpage'
        ELSE 'facebookCore' END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
      AND c.id=p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_version:=md5(v_log);
  IF v_version=p_cursor->>'version' THEN
    RETURN jsonb_build_object('mode','unchanged','version',v_version,'updatedAt',v_updated_at);
  END IF;
  -- A rolling log can drop its oldest entries. Locate the old suffix, retain
  -- the overlap and send only a small new prefix plus the appended text. The
  -- caller MUST verify the reconstructed MD5 and refetch without a cursor if
  -- an anchor is ambiguous, the log was replaced or a concurrent edit occurred.
  v_tail:=p_cursor->>'tail';
  v_length:=(p_cursor->>'length')::integer;
  IF char_length(v_tail)>0 AND char_length(v_tail)<=v_length THEN
    v_end:=strpos(v_log,v_tail);
    IF v_end>0 THEN
      v_end:=v_end+char_length(v_tail)-1;
      v_prefix:=left(v_log,least(256,v_end));
      v_keep:=v_end-char_length(v_prefix);
      IF v_keep>=0 AND v_keep<=v_length THEN
        RETURN jsonb_build_object('mode','delta','version',v_version,'updatedAt',v_updated_at,
          'prefix',v_prefix,'keepChars',v_keep,'append',substr(v_log,v_end+1));
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('mode','replace','version',v_version,'updatedAt',v_updated_at,'log',v_log);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_campaign_logs(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_access jsonb, p_campaign_id bigint, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_access IS NULL OR p_campaign_id IS NULL OR p_campaign_id<=0 THEN RAISE EXCEPTION 'Invalid campaign log scope'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns c
    LEFT JOIN public.auto_campaign_actions ca ON ca.id=c.action_id
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND coalesce((p_access->>CASE
        WHEN c.action_id IN ('sms_send','voice_call') THEN 'sms'
        WHEN c.action_id='email_send' THEN 'email'
        WHEN c.action_id = ANY(ARRAY['zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation','zalo_message_group','zalo_add_group_member','zalo_join_group_link','zalo_cancel_sent_friend_request']) THEN 'zalo'
        WHEN c.action_id IN ('facebook_page_post','facebook_page_to_message') THEN 'facebookFanpage'
        ELSE 'facebookCore' END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
      AND c.id=p_campaign_id
 ) THEN RETURN NULL; END IF;
 RETURN private.campaign_log_page(p_campaign_id,p_options);
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_facebook_random_run(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_account_id bigint, p_operation text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE a public.auto_accounts%ROWTYPE; d public.auto_account_random_run_days%ROWTYPE;
 cfg jsonb; rev integer; rule jsonb; choice jsonb; turns jsonb; t jsonb; result jsonb; c record;
 day date:=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
 idx integer; round_no integer; row_no integer; total integer; page integer; claim uuid; turn_id uuid;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL); -- Bind Desktop token before privileged work.

 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_operation NOT IN ('get','save','toggle','dates','day','plan','claim','finish','progress') THEN RAISE EXCEPTION 'random_invalid_operation'; END IF;
 SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='facebook' AND NOT is_delete;
 IF NOT FOUND THEN RAISE EXCEPTION 'random_account_not_found'; END IF;
 -- Runtime claim must acquire staff/admission/campaign/account locks through v2 first.
 IF p_operation='claim' THEN
   claim:=(p_input->>'claimToken')::uuid;turn_id:=(p_input->>'turnId')::uuid;
   PERFORM set_config('aka.facebook_random_turn',turn_id::text,true);
   SELECT to_jsonb(r) INTO result FROM public.aka_agent_claim_campaign_runtime_v2((p_input->>'campaignId')::bigint,p_account_id,p_staff_id,'desktop',claim) r;
   PERFORM set_config('aka.facebook_random_turn','',true);
   IF (result->>'ok')::boolean THEN
     -- Existing exact-token retry is retained even after stop or midnight.
     SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND run_date=(result->>'runtime_claim_vietnam_date')::date FOR UPDATE;
     SELECT x INTO t FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'id'=turn_id::text AND (x->>'campaignId')::bigint=(p_input->>'campaignId')::bigint;
     IF t IS NULL OR (t->>'status'<>'planned' AND NOT(t->>'status'='running' AND t->>'claimToken'=claim::text)) THEN RAISE EXCEPTION 'random_turn_claim_mismatch'; END IF;
     UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,ARRAY['turns',((t->>'order')::int-1)::text],
       t||jsonb_build_object('status','running','claimToken',claim,'startedAt',coalesce(t->'startedAt',result->'runtime_claimed_at'))),updated_at=clock_timestamp() WHERE id=d.id;
   END IF;
   RETURN result;
 END IF;
 IF p_operation IN ('save','toggle','plan','finish') THEN
   PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE;
   SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND NOT is_delete FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'random_account_not_found'; END IF;
 END IF;
 cfg:=a.facebook_random_run_config; rev:=coalesce((cfg->>'revision')::int,0);
 IF p_operation='save' THEN
   cfg:=p_input->'config';
   IF (cfg->>'revision')::int IS DISTINCT FROM rev THEN RAISE EXCEPTION 'random_config_conflict'; END IF;
   IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR cfg->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(cfg->'rules') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'random_invalid_config'; END IF;
   IF jsonb_array_length(cfg->'rules') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'random_invalid_rules'; END IF;
   FOR rule IN SELECT x FROM jsonb_array_elements(cfg->'rules') x LOOP
     IF jsonb_typeof(rule) IS DISTINCT FROM 'object' OR jsonb_typeof(rule->'quantity') IS DISTINCT FROM 'number'
       OR coalesce(rule->>'quantity','') !~ '^[1-9][0-9]*$' OR (rule->>'quantity')::numeric>2147483647
       OR rule->>'unit' IS DISTINCT FROM (CASE rule->>'campaignActionId' WHEN 'facebook_timeline_post' THEN 'run' WHEN 'facebook_newsfeed_interaction' THEN 'minute' ELSE 'data' END)
       OR (rule->>'campaignActionId'='facebook_timeline_post' AND rule->>'quantity'<>'1')
       OR NOT EXISTS(SELECT 1 FROM public.auto_campaign_actions ca WHERE ca.id=rule->>'campaignActionId' AND ca.flatform_type='facebook' AND ca.is_active AND NOT ca.is_delete)
     THEN RAISE EXCEPTION 'random_invalid_rule'; END IF;
   END LOOP;
   cfg:=jsonb_build_object('version',1,'revision',rev+1,'rules',cfg->'rules');
   UPDATE public.auto_accounts SET facebook_random_run_config=cfg,updated_at=clock_timestamp() WHERE id=p_account_id;
 ELSIF p_operation='toggle' THEN
   IF (p_input->>'revision')::int IS DISTINCT FROM rev THEN RAISE EXCEPTION 'random_config_conflict'; END IF;
   IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'random_invalid_enabled'; END IF;
   IF (p_input->>'enabled')::boolean AND cfg IS NULL THEN RAISE EXCEPTION 'random_rules_required'; END IF;
   a.facebook_random_run_enabled:=(p_input->>'enabled')::boolean;
   UPDATE public.auto_accounts SET facebook_random_run_enabled=a.facebook_random_run_enabled,updated_at=clock_timestamp() WHERE id=p_account_id;
   IF NOT a.facebook_random_run_enabled THEN
     UPDATE public.auto_account_random_run_days dd SET state=jsonb_set(state,'{turns}',(
       SELECT jsonb_agg(CASE WHEN x->>'status'='planned' THEN x||jsonb_build_object('status','skipped','reason','Đã dừng chạy ngẫu nhiên','endedAt',clock_timestamp()) ELSE x END ORDER BY n)
       FROM jsonb_array_elements(dd.state->'turns') WITH ORDINALITY q(x,n))),updated_at=clock_timestamp()
     WHERE dd.account_id=p_account_id AND dd.status='open';
   END IF;
 END IF;
 IF p_operation IN ('get','save','toggle') THEN RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg); END IF;
 IF p_operation='dates' THEN
   RETURN coalesce((SELECT jsonb_agg(run_date ORDER BY run_date DESC) FROM (SELECT run_date FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND (p_input->>'before' IS NULL OR run_date<(p_input->>'before')::date) ORDER BY run_date DESC LIMIT 100) q),'[]');
 END IF;
 IF p_operation='day' THEN
   day:=(p_input->>'date')::date;page:=greatest(1,least(1000000,coalesce((p_input->>'page')::int,1)));
   SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND run_date=day;
   SELECT count(*)::int INTO total FROM jsonb_array_elements(coalesce(d.state->'turns','[]')) x WHERE p_input->>'campaignId' IS NULL OR x->>'campaignId'=p_input->>'campaignId';
   SELECT coalesce(jsonb_agg(x ORDER BY n),'[]') INTO turns FROM (
     SELECT (x-'claimToken'-'unitToken'-'lastUnitToken')||CASE WHEN x->>'status'='running' AND x->>'unit'='minute' AND x->>'unitStartedAt' IS NOT NULL
       THEN jsonb_build_object('elapsedSeconds',least((x->>'quantity')::bigint*60,greatest(0,floor(extract(epoch FROM clock_timestamp()-(x->>'unitStartedAt')::timestamptz))))) ELSE '{}'::jsonb END x,n
     FROM jsonb_array_elements(coalesce(d.state->'turns','[]')) WITH ORDINALITY q(x,n)
     WHERE p_input->>'campaignId' IS NULL OR x->>'campaignId'=p_input->>'campaignId' ORDER BY n LIMIT 100 OFFSET (page-1)*100) q;
   RETURN jsonb_build_object('accountId',p_account_id,'date',day,'status',coalesce(d.status,'open'),'turns',turns,'total',total,'page',page);
 END IF;
 IF p_operation='progress' THEN
   SELECT x INTO t FROM public.auto_account_random_run_days dd, jsonb_array_elements(dd.state->'turns') x
   WHERE dd.account_id=p_account_id AND dd.status='open' AND x->>'claimToken'=p_input->>'claimToken' AND x->>'id'=p_input->>'turnId';
   IF t IS NULL THEN
     SELECT x INTO t FROM public.auto_account_random_run_days dd,jsonb_array_elements(dd.state->'turns') x
     WHERE dd.account_id=p_account_id AND dd.status='closed' AND x->>'claimToken'=p_input->>'claimToken' AND x->>'id'=p_input->>'turnId';
   END IF;
   IF t IS NULL THEN RAISE EXCEPTION 'random_turn_not_found'; END IF;
   RETURN t;
 END IF;
 IF p_operation='finish' THEN
   SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND status='open'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'turns') x WHERE x->>'id'=p_input->>'turnId') FOR UPDATE;
   IF NOT FOUND THEN
     SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND status='closed'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'turns') x WHERE x->>'id'=p_input->>'turnId') FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'random_turn_not_found'; END IF;
   END IF;
   SELECT x INTO t FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'id'=p_input->>'turnId';
   IF t->>'status' NOT IN ('planned','running') THEN RETURN t; END IF;
   IF t->>'claimToken' IS DISTINCT FROM p_input->>'claimToken' THEN RAISE EXCEPTION 'random_turn_not_owner'; END IF;
   IF EXISTS(SELECT 1 FROM public.auto_campaigns cc WHERE cc.account_id=p_account_id AND (cc.runtime_unit_token IS NOT NULL OR cc.runtime_claim_token IS NOT NULL OR cc.status='đang chạy')) THEN RAISE EXCEPTION 'random_runtime_still_owned'; END IF;
   t:=t||jsonb_build_object('status',CASE WHEN t->>'status'='planned' THEN 'skipped' WHEN p_input->>'reason' IS NOT NULL THEN 'stopped' ELSE 'completed' END,'reason',p_input->>'reason','endedAt',clock_timestamp());
   UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,ARRAY['turns',((t->>'order')::int-1)::text],t),updated_at=clock_timestamp() WHERE id=d.id;
   IF d.run_date<day THEN
     UPDATE public.auto_account_random_run_days dd SET status='closed',state=jsonb_set(state,'{turns}',(
       SELECT jsonb_agg(CASE WHEN x->>'status'='planned' THEN x||jsonb_build_object('status','expired','reason','Hết ngày','endedAt',clock_timestamp()) ELSE x END ORDER BY n)
       FROM jsonb_array_elements(dd.state->'turns') WITH ORDINALITY q(x,n))) WHERE dd.id=d.id;
   END IF;
   RETURN t;
 END IF;
 -- Plan/recovery does not clear runtime ownership; wait until existing recovery/drain has done so.
 IF EXISTS(SELECT 1 FROM public.auto_campaigns cc WHERE cc.account_id=p_account_id AND (cc.runtime_unit_token IS NOT NULL OR cc.runtime_claim_token IS NOT NULL OR cc.status='đang chạy')) THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns','[]'::jsonb);
 END IF;
 FOR d IN SELECT * FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND status='open' ORDER BY run_date FOR UPDATE LOOP
   SELECT coalesce(jsonb_agg(CASE WHEN x->>'status'='planned' AND (d.run_date<day OR (x->>'revision')::int<>rev OR NOT a.facebook_random_run_enabled) THEN x||jsonb_build_object('status',CASE WHEN d.run_date<day THEN 'expired' ELSE 'skipped' END,'reason',CASE WHEN d.run_date<day THEN 'Hết ngày' WHEN NOT a.facebook_random_run_enabled THEN 'Đã dừng chạy ngẫu nhiên' ELSE 'Cấu hình đã thay đổi' END,'endedAt',clock_timestamp()) ELSE x END ORDER BY n),'[]') INTO turns
   FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY q(x,n);
   UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,'{turns}',turns),status=CASE WHEN d.run_date<day AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(turns) x WHERE x->>'status'='running') THEN 'closed' ELSE 'open' END,updated_at=clock_timestamp() WHERE id=d.id;
 END LOOP;
 SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND run_date=day;
 SELECT coalesce(jsonb_agg(x ORDER BY n),'[]') INTO turns FROM jsonb_array_elements(coalesce(d.state->'turns','[]')) WITH ORDINALITY q(x,n) WHERE x->>'status'='planned';
 IF EXISTS(SELECT 1 FROM public.auto_account_random_run_days dd,jsonb_array_elements(dd.state->'turns') x WHERE dd.account_id=p_account_id AND dd.status='open' AND x->>'status'='running') THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns','[]'::jsonb);
 END IF;
 IF jsonb_array_length(turns)>0 OR NOT a.facebook_random_run_enabled OR cfg IS NULL OR (p_input->>'revision')::int IS DISTINCT FROM rev THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns',turns);
 END IF;
 IF a.status<>'chờ xử lý' OR NOT a.is_active OR a.login_status<>'đã đăng nhập' OR timezone('Asia/Ho_Chi_Minh',clock_timestamp())::time>=time '23:59' THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns','[]'::jsonb);
 END IF;
 turns:='[]';round_no:=coalesce((d.state->>'round')::int,0)+1;row_no:=jsonb_array_length(coalesce(d.state->'turns','[]'));
 IF jsonb_typeof(p_input->'choices') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'choices')>100 THEN RAISE EXCEPTION 'random_invalid_choices'; END IF;
 -- Server orders and validates every selected campaign against the saved rule snapshot.
 FOR choice IN SELECT x FROM jsonb_array_elements(p_input->'choices') x ORDER BY (x->>'ruleIndex')::int LOOP
   idx:=(choice->>'ruleIndex')::int;rule:=cfg->'rules'->idx;
   IF idx<0 OR rule IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(turns) x WHERE (x->>'ruleIndex')::int=idx) THEN RAISE EXCEPTION 'random_invalid_choice'; END IF;
   SELECT cc.* INTO c FROM public.auto_campaigns cc WHERE cc.id=(choice->>'campaignId')::bigint AND cc.account_id=p_account_id AND cc.staff_id=p_staff_id AND cc.organization_id=p_organization_id
     AND cc.action_id=rule->>'campaignActionId' AND NOT cc.is_delete AND cc.status='chờ xử lý'
     AND coalesce(cc.provisioning_state,'ready')='ready'
     AND private.campaign_dispatch_schedule_allowed(
       cc.schedule,cc.data_target_source_mode,cc.schedule_end_date,cc.daily_stop_time,clock_timestamp(),false);
   IF FOUND THEN
     row_no:=row_no+1;
     turns:=turns||jsonb_build_array(rule||jsonb_build_object('id',gen_random_uuid(),'order',row_no,'round',round_no,'ruleIndex',idx,'revision',rev,'campaignId',c.id,'campaignName',c.name,'processed',0,'elapsedSeconds',0,'status','planned'));
   END IF;
 END LOOP;
 IF jsonb_array_length(turns)>0 THEN
   INSERT INTO public.auto_account_random_run_days(account_id,staff_id,organization_id,run_date,state)
   VALUES(p_account_id,p_staff_id,p_organization_id,day,jsonb_build_object('round',round_no,'turns',turns,'configs',jsonb_build_object(rev::text,cfg)))
   ON CONFLICT(account_id,run_date) DO UPDATE SET state=jsonb_build_object('round',round_no,'turns',auto_account_random_run_days.state->'turns'||turns,'configs',coalesce(auto_account_random_run_days.state->'configs','{}')||jsonb_build_object(rev::text,cfg)),updated_at=clock_timestamp();
 END IF;
 RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns',turns);
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_facebook_web_enrichment_settings(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_account_id bigint, p_operation text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE a public.auto_accounts%ROWTYPE; cfg jsonb; rev integer; enabled boolean;
 key text; item jsonb; items jsonb; text_value text; authority text; url_path text; urls jsonb:='[]';
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL); -- Bind Desktop token before privileged work.

 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_operation IS NULL OR p_operation NOT IN ('get','save') THEN RAISE EXCEPTION 'web_enrichment_operation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'web_enrichment_identity'; END IF;
 IF p_operation='save' THEN PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE; END IF;
 SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id
   AND organization_id=p_organization_id AND flatform_type='facebook' AND NOT is_delete;
 IF NOT FOUND THEN RAISE EXCEPTION 'web_enrichment_account'; END IF;
 IF p_operation='save' THEN
   SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id
     AND organization_id=p_organization_id AND flatform_type='facebook' AND NOT is_delete FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'web_enrichment_account'; END IF;
 END IF;
 cfg:=a.facebook_web_enrichment_config; rev:=coalesce((cfg->>'revision')::integer,0);
 enabled:=a.facebook_web_enrichment_enabled;
 -- Reading and disabling remain available to the owning staff after entitlement expiry.
 IF p_operation='save' THEN
   IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'web_enrichment_enabled'; END IF;
   enabled:=(p_input->>'enabled')::boolean; cfg:=p_input->'config';
   IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR cfg->>'version' IS DISTINCT FROM '1'
     OR jsonb_typeof(cfg->'revision') IS DISTINCT FROM 'number' OR cfg->>'revision' !~ '^[0-9]+$'
     OR (cfg->>'revision')::numeric IS DISTINCT FROM rev THEN RAISE EXCEPTION 'web_enrichment_conflict'; END IF;
   IF rev=2147483647 OR octet_length(cfg::text)>100000 THEN RAISE EXCEPTION 'web_enrichment_size'; END IF;
   IF jsonb_typeof(cfg->'industry') IS DISTINCT FROM 'string' OR length(cfg->>'industry')>8000 THEN RAISE EXCEPTION 'web_enrichment_industry'; END IF;
   FOREACH key IN ARRAY ARRAY['keywords','websites','hobbies','slots'] LOOP
     items:=cfg->key;
     IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'web_enrichment_list'; END IF;
     IF jsonb_array_length(items)>(CASE key WHEN 'keywords' THEN 200 WHEN 'websites' THEN 5 WHEN 'hobbies' THEN 100 ELSE 48 END)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')>2048) THEN RAISE EXCEPTION 'web_enrichment_list'; END IF;
     SELECT coalesce(jsonb_agg(v ORDER BY n),'[]') INTO items FROM (
       SELECT DISTINCT ON (CASE WHEN key='websites' THEN btrim(x#>>'{}') ELSE lower(btrim(x#>>'{}')) END) btrim(x#>>'{}') v,n FROM jsonb_array_elements(items) WITH ORDINALITY t(x,n)
       WHERE btrim(x#>>'{}')<>'' ORDER BY CASE WHEN key='websites' THEN btrim(x#>>'{}') ELSE lower(btrim(x#>>'{}')) END,n) q;
     cfg:=jsonb_set(cfg,ARRAY[key],items);
   END LOOP;
   IF enabled THEN
     IF NOT EXISTS(SELECT 1 FROM public.org_organization_product WHERE organization_id=p_organization_id AND NOT is_deleted
       AND product_id IN (3,10) AND expiration_date>=date_trunc('day',timezone('Asia/Ho_Chi_Minh',clock_timestamp())) AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN
       RAISE EXCEPTION 'web_enrichment_feature'; END IF;
     IF btrim(cfg->>'industry')='' OR jsonb_array_length(cfg->'keywords')<3 OR jsonb_array_length(cfg->'websites')<>3
       OR jsonb_array_length(cfg->'slots')<1 THEN RAISE EXCEPTION 'web_enrichment_required'; END IF;
     IF jsonb_typeof(cfg->'minutesPerSession') IS DISTINCT FROM 'number' OR cfg->>'minutesPerSession' !~ '^[0-9]+$'
       OR (cfg->>'minutesPerSession')::numeric NOT BETWEEN 5 AND 240 OR (cfg->>'minutesPerSession')::numeric%5<>0 THEN RAISE EXCEPTION 'web_enrichment_minutes'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(cfg->'slots') x WHERE x !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RAISE EXCEPTION 'web_enrichment_slots'; END IF;
     IF cfg->>'stopDate' IS NOT NULL AND (cfg->>'stopDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (cfg->>'stopDate')::date::text<>cfg->>'stopDate') THEN RAISE EXCEPTION 'web_enrichment_date'; END IF;
     FOR text_value IN SELECT jsonb_array_elements_text(cfg->'websites') LOOP
       IF text_value !~* '^[a-z][a-z0-9+.-]*:' OR text_value ~* '^[a-z0-9.-]+:[0-9]+([/?#]|$)' THEN text_value:='https://'||text_value; END IF;
       IF text_value !~* '^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$' THEN RAISE EXCEPTION 'web_enrichment_url'; END IF;
       authority:=lower(substring(text_value FROM '(?i)^https?://([^/?#]+)'));
       IF authority !~ '^([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(:[0-9]{1,5})?$'
         OR (authority ~ ':[0-9]+$' AND substring(authority FROM ':([0-9]+)$')::integer NOT BETWEEN 1 AND 65535) THEN RAISE EXCEPTION 'web_enrichment_url'; END IF;
       url_path:=regexp_replace(text_value,'(?i)^https?://[^/?#]+',''); url_path:=split_part(url_path,'#',1);
       IF url_path='' OR left(url_path,1)='?' THEN url_path:='/'||url_path; END IF;
       text_value:=lower(split_part(text_value,'://',1))||'://'||authority||url_path;
       IF urls ? text_value THEN RAISE EXCEPTION 'web_enrichment_duplicate_url'; END IF;
       urls:=urls||jsonb_build_array(text_value);
     END LOOP;
     cfg:=jsonb_set(cfg,'{websites}',urls);
   END IF;
   cfg:=jsonb_build_object('version',1,'revision',rev+1,'industry',btrim(cfg->>'industry'),
     'keywords',cfg->'keywords','websites',cfg->'websites','hobbies',cfg->'hobbies',
     'minutesPerSession',CASE WHEN jsonb_typeof(cfg->'minutesPerSession')='number' THEN cfg->'minutesPerSession' ELSE '30'::jsonb END,
     'slots',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM jsonb_array_elements_text(cfg->'slots') x),'stopDate',cfg->'stopDate');
   UPDATE public.auto_accounts SET facebook_web_enrichment_enabled=enabled,facebook_web_enrichment_config=cfg,updated_at=clock_timestamp() WHERE id=p_account_id;
 END IF;
 RETURN jsonb_build_object('enabled',enabled,'config',cfg);
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_campaign(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_note text DEFAULT NULL::text, p_update_note boolean DEFAULT false, p_expected_status text DEFAULT 'đang chạy'::text, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text)
 RETURNS TABLE(completed boolean, reason text, campaign_id bigint, campaign_status text, pending_input_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign_status text;
  v_source_mode text;
  v_pending_input_count bigint := 0;
  v_expected_status text := lower(btrim(COALESCE(p_expected_status, '')));
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
  THEN
    RAISE EXCEPTION 'campaign_finalize_identity_invalid';
  END IF;
  IF v_expected_status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RAISE EXCEPTION 'campaign_finalize_expected_status_invalid';
  END IF;

  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct')
  INTO v_campaign_status, v_source_mode
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  IF v_source_mode = 'data_group' THEN
    RETURN QUERY SELECT
      false,
      'specialized_finalizer_required',
      p_campaign_id,
      v_campaign_status,
      0::bigint;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_pending_input_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'chờ xử lý';

  IF v_pending_input_count > 0 THEN
    IF v_campaign_status = v_expected_status OR v_campaign_status = 'hoàn thành' THEN
      UPDATE public.auto_campaigns
      SET status = 'chờ xử lý',
          note = NULL,
          completed_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = p_campaign_id;
      v_campaign_status := 'chờ xử lý';
    END IF;

    RETURN QUERY SELECT
      false,
      'pending_input_remaining',
      p_campaign_id,
      v_campaign_status,
      v_pending_input_count;
    RETURN;
  END IF;

  IF v_campaign_status = v_expected_status THEN
    UPDATE public.auto_campaigns AS campaign
    SET status = 'hoàn thành',
        note = CASE
          WHEN COALESCE(p_update_note, false) THEN p_note
          ELSE campaign.note
        END,
        updated_at = clock_timestamp()
    WHERE campaign.id = p_campaign_id;

    RETURN QUERY SELECT
      true,
      'completed',
      p_campaign_id,
      'hoàn thành'::text,
      0::bigint;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_campaign_status = 'hoàn thành',
    'campaign_control_won',
    p_campaign_id,
    v_campaign_status,
    0::bigint;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_get_campaign_data_group_source(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
  v_result jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    v_result := public.aka_agent_get_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_automation_details(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_role text DEFAULT 'all'::text, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_role text := lower(COALESCE(NULLIF(btrim(p_role), ''), 'all'));
  v_status text := NULLIF(btrim(p_status), '');
  v_search text := NULLIF(btrim(p_search), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_staff_id IS NULL
    OR p_organization_id IS NULL
    OR p_campaign_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_automation_tenant';
  END IF;
  IF v_role NOT IN ('all', 'source', 'target') THEN
    RAISE EXCEPTION 'invalid_campaign_automation_role';
  END IF;
  IF v_status IS NOT NULL
    AND v_status NOT IN (
      'chờ xử lý', 'đang xử lý', 'đã thêm', 'bỏ qua', 'lỗi'
    )
  THEN
    RAISE EXCEPTION 'invalid_automation_detail_status';
  END IF;
  IF p_date_from IS NOT NULL
    AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to
  THEN
    RAISE EXCEPTION 'invalid_campaign_automation_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT
      detail.*,
      automation.name AS automation_name,
      source_campaign.name AS source_campaign_name,
      source_detail.status AS source_campaign_detail_status,
      target_campaign.name AS target_campaign_name,
      target_campaign.status AS target_campaign_status,
      target_group.name AS target_contact_group_name,
      target_data_group.name AS target_data_group_name
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    JOIN public.auto_campaigns AS source_campaign
      ON source_campaign.id = detail.source_campaign_id
     AND source_campaign.staff_id = p_staff_id
     AND source_campaign.organization_id = p_organization_id
    JOIN public.auto_campaign_details AS source_detail
      ON source_detail.id = detail.source_campaign_detail_id
     AND source_detail.campaign_id = detail.source_campaign_id
    LEFT JOIN public.auto_campaigns AS target_campaign
      ON target_campaign.id = detail.target_campaign_id
     AND target_campaign.staff_id = p_staff_id
     AND target_campaign.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS target_group
      ON target_group.id = detail.target_contact_group_id
     AND target_group.staff_id = p_staff_id
     AND target_group.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS target_data_group
      ON target_data_group.id = detail.target_data_group_id
     AND target_data_group.purpose = 'data_group'
     AND target_data_group.staff_id = p_staff_id
     AND target_data_group.organization_id = p_organization_id
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND (
        (
          v_role = 'all'
          AND (
            detail.source_campaign_id = p_campaign_id
            OR detail.target_campaign_id = p_campaign_id
          )
        )
        OR (
          v_role = 'source'
          AND detail.source_campaign_id = p_campaign_id
        )
        OR (
          v_role = 'target'
          AND detail.target_campaign_id = p_campaign_id
        )
      )
      AND (v_status IS NULL OR detail.status = v_status)
      AND (p_date_from IS NULL OR detail.created_at >= p_date_from)
      AND (p_date_to IS NULL OR detail.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR automation.name ILIKE '%' || v_search || '%'
        OR COALESCE(detail.data_value, '') ILIKE '%' || v_search || '%'
        OR detail.data_type_code ILIKE '%' || v_search || '%'
        OR detail.source_status ILIKE '%' || v_search || '%'
        OR detail.status ILIKE '%' || v_search || '%'
        OR COALESCE(detail.last_error, '') ILIKE '%' || v_search || '%'
        OR source_campaign.name ILIKE '%' || v_search || '%'
        OR COALESCE(target_campaign.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_group.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_data_group.name, '') ILIKE '%' || v_search || '%'
      )
  )
  SELECT count(*)
  INTO v_total
  FROM filtered;

  WITH filtered AS MATERIALIZED (
    SELECT
      detail.*,
      automation.name AS automation_name,
      source_campaign.name AS source_campaign_name,
      source_detail.status AS source_campaign_detail_status,
      target_campaign.name AS target_campaign_name,
      target_campaign.status AS target_campaign_status,
      target_group.name AS target_contact_group_name,
      target_data_group.name AS target_data_group_name
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    JOIN public.auto_campaigns AS source_campaign
      ON source_campaign.id = detail.source_campaign_id
     AND source_campaign.staff_id = p_staff_id
     AND source_campaign.organization_id = p_organization_id
    JOIN public.auto_campaign_details AS source_detail
      ON source_detail.id = detail.source_campaign_detail_id
     AND source_detail.campaign_id = detail.source_campaign_id
    LEFT JOIN public.auto_campaigns AS target_campaign
      ON target_campaign.id = detail.target_campaign_id
     AND target_campaign.staff_id = p_staff_id
     AND target_campaign.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS target_group
      ON target_group.id = detail.target_contact_group_id
     AND target_group.staff_id = p_staff_id
     AND target_group.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS target_data_group
      ON target_data_group.id = detail.target_data_group_id
     AND target_data_group.purpose = 'data_group'
     AND target_data_group.staff_id = p_staff_id
     AND target_data_group.organization_id = p_organization_id
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND (
        (
          v_role = 'all'
          AND (
            detail.source_campaign_id = p_campaign_id
            OR detail.target_campaign_id = p_campaign_id
          )
        )
        OR (
          v_role = 'source'
          AND detail.source_campaign_id = p_campaign_id
        )
        OR (
          v_role = 'target'
          AND detail.target_campaign_id = p_campaign_id
        )
      )
      AND (v_status IS NULL OR detail.status = v_status)
      AND (p_date_from IS NULL OR detail.created_at >= p_date_from)
      AND (p_date_to IS NULL OR detail.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR automation.name ILIKE '%' || v_search || '%'
        OR COALESCE(detail.data_value, '') ILIKE '%' || v_search || '%'
        OR detail.data_type_code ILIKE '%' || v_search || '%'
        OR detail.source_status ILIKE '%' || v_search || '%'
        OR detail.status ILIKE '%' || v_search || '%'
        OR COALESCE(detail.last_error, '') ILIKE '%' || v_search || '%'
        OR source_campaign.name ILIKE '%' || v_search || '%'
        OR COALESCE(target_campaign.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_group.name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(target_data_group.name, '') ILIKE '%' || v_search || '%'
      )
  ),
  page AS (
    SELECT filtered.*
    FROM filtered
    ORDER BY filtered.created_at DESC, filtered.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT COALESCE(
    jsonb_agg(
      public.aka_agent_semantic_row_json(to_jsonb(page))
      || jsonb_build_object(
        'triggered_at', page.created_at,
        'campaign_role', CASE
          WHEN page.source_campaign_id = p_campaign_id THEN 'source'
          ELSE 'target'
        END,
        'automation_name', page.automation_name,
        'source_campaign_name', page.source_campaign_name,
        'source_campaign_detail_status',
          page.source_campaign_detail_status,
        'target_campaign_name', page.target_campaign_name,
        'target_campaign_status', page.target_campaign_status,
        'target_result_status', target_result.status,
        'target_result_count', COALESCE(target_result.result_count, 0),
        'target_contact_group_name', page.target_contact_group_name,
        'target_data_group_id', COALESCE(
          page.target_data_group_id,
          CASE
            WHEN page.config_snapshot ->> 'target_data_group_id'
              ~ '^[1-9][0-9]*$'
            THEN (page.config_snapshot ->> 'target_data_group_id')::bigint
          END
        ),
        'target_data_group_name', page.target_data_group_name
      )
      ORDER BY page.created_at DESC, page.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM page
  LEFT JOIN LATERAL (
    SELECT latest.status, count(*) OVER ()::integer AS result_count
    FROM public.auto_campaign_details AS latest
    WHERE latest.auto_automation_detail_id = page.id
      AND page.target_campaign_id IS NOT NULL
      AND latest.campaign_id = page.target_campaign_id
      AND COALESCE(latest.is_delete, false) = false
    ORDER BY latest.created_at DESC, latest.id DESC
    LIMIT 1
  ) AS target_result ON true;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_detail_automation_triggers(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_campaign_detail_ids bigint[], p_auth_username text, p_auth_password text)
 RETURNS TABLE(source_campaign_detail_id bigint, automation_detail_id bigint, automation_id bigint, automation_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(cardinality(p_campaign_detail_ids), 0) > 500
  THEN
    RAISE EXCEPTION 'invalid_campaign_detail_automation_trigger_query';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  RETURN QUERY
  SELECT
    detail.source_campaign_detail_id,
    detail.id,
    automation.id,
    automation.name
  FROM public.auto_automation_detail AS detail
  JOIN public.auto_automation AS automation
    ON automation.id = detail.automation_id
   AND automation.staff_id = p_staff_id
   AND automation.organization_id = p_organization_id
  JOIN public.auto_campaign_details AS source_detail
    ON source_detail.id = detail.source_campaign_detail_id
   AND source_detail.campaign_id = p_campaign_id
   AND COALESCE(source_detail.is_delete, false) = false
  WHERE detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
    AND detail.source_campaign_id = p_campaign_id
    AND detail.source_campaign_detail_id
      = ANY(COALESCE(p_campaign_detail_ids, '{}'::bigint[]))
  ORDER BY detail.source_campaign_detail_id, detail.id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page_v2(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer, p_sort text, p_auth_username text, p_auth_password text, p_engagement_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_sort text := COALESCE(p_sort, 'created_desc');
  v_search text := NULLIF(btrim(left(p_search, 200)), '');
  v_status text := NULLIF(btrim(left(p_status, 120)), '');
  v_where text := 'd.campaign_id = $1 AND d.is_delete = false';
  v_direction text;
  v_status_ids bigint[];
  v_search_ids bigint[];
  v_count_sql text;
  v_page_sql text;
  v_branch_order text;
  v_result jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  -- Same credential + campaign ownership guard as the live detail provenance RPC.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0 OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_campaign_details_page';
  END IF;
  IF v_sort NOT IN ('created_asc', 'created_desc') THEN
    RAISE EXCEPTION 'invalid_campaign_details_sort';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'invalid_campaign_details_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Only fixed SQL fragments are concatenated. All user values are bound.
  -- Omitting inactive predicates avoids generic OR plans scanning wide rows.
  -- Resolve the small catalog once, not once per matching detail. STABLE
  -- keeps these reads in the caller's snapshot, including the payload below.
  -- Keep historical/inactive catalog entries and the exact legacy comparisons.
  IF v_status IS NOT NULL THEN
    v_status_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.status_value=v_status OR lower(s.name)=lower(v_status));
  END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_search_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.name ILIKE '%' || v_search || '%' OR s.status_value ILIKE '%' || v_search || '%');
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5';
    IF cardinality(v_search_ids)>0 THEN
      v_where := v_where || ' OR d.status_id=ANY($9) OR d.sub_status_id=ANY($9)';
    END IF;
    v_where := v_where || ')';
  END IF;
  IF COALESCE(p_engagement_filter, 'all') NOT IN ('all','seen','responded','reacted','friended','none') THEN
    RAISE EXCEPTION 'invalid_engagement_filter';
  END IF;
  IF p_engagement_filter IN ('seen','responded','reacted','friended','none') THEN
    v_where := v_where || ' AND EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND ' ||
      CASE p_engagement_filter WHEN 'seen' THEN 'e.seen_at IS NOT NULL' WHEN 'responded' THEN 'e.responded_at IS NOT NULL'
        WHEN 'reacted' THEN 'e.reacted_at IS NOT NULL' WHEN 'friended' THEN 'e.friended_at IS NOT NULL'
        ELSE 'e.seen_at IS NULL AND e.responded_at IS NULL AND e.reacted_at IS NULL AND e.friended_at IS NULL' END || ')';
  END IF;
  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;
  -- Count text matches with the existing covering status index. The second
  -- branch only counts additional main/sub-status matches: no double counting,
  -- even when both IDs match, or when the legacy text is NULL.
  v_count_sql := 'SELECT count(*) FROM public.auto_campaign_details AS d WHERE ' || v_where;
  v_page_sql := 'SELECT d.id, d.created_at FROM public.auto_campaign_details AS d WHERE ' || v_where;
  IF v_status IS NOT NULL THEN
    v_count_sql := 'SELECT (' || v_count_sql || ' AND d.status = $2)';
    v_page_sql := v_page_sql || ' AND d.status = $2';
    IF cardinality(v_status_ids)>0 THEN
      v_count_sql := v_count_sql || ' + (SELECT count(*) FROM public.auto_campaign_details AS d WHERE '
        || v_where || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8)))';
      -- The same disjoint branches avoid a full campaign scan when a status
      -- has no matches. Each ordered prefix is sufficient for the final page;
      -- only the outer query applies OFFSET. bigint prevents integer overflow.
      v_branch_order := ' ORDER BY d.created_at ' || v_direction || ', d.id ' || v_direction
        || ' LIMIT ($6::bigint + $7::bigint)';
      v_page_sql := '(' || v_page_sql || v_branch_order || ') UNION ALL (SELECT d.id, d.created_at'
        || ' FROM public.auto_campaign_details AS d WHERE ' || v_where
        || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8))'
        || v_branch_order || ')';
    END IF;
  END IF;

  -- Both keys are NOT NULL in the live schema (checked by preflight). Default
  -- NULL placement is therefore equivalent to NULLS LAST for both directions,
  -- and allows one index to support forward and backward index-only scans.
  -- MATERIALIZED limits the narrow ID set before any full-row payload lookup.
  -- Count, page IDs and payload are read by one statement / MVCC snapshot;
  -- count remains available even when the requested page has no items.
  EXECUTE format($query$
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM (%1$s) AS d
      ORDER BY d.created_at %2$s, d.id %2$s
      LIMIT $6 OFFSET $7
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(((to_jsonb(detail) || jsonb_build_object(
          'status_presentation', CASE WHEN main_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',main_status.code,'name',main_status.name,'color',main_status.color,'statusValue',main_status.status_value) END,
          'sub_status_presentation', CASE WHEN sub_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',sub_status.code,'name',sub_status.name,'color',sub_status.color,'statusValue',sub_status.status_value) END)) || jsonb_build_object('zalo_engagement', to_jsonb(engagement), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR (account.flatform_type='zalo' AND NOT COALESCE(account.is_zalo_show_web,false)
            AND detail.status='thành công' AND detail.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
            AND detail.data->'partialSend' IS NULL))) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_status main_status ON main_status.id=detail.status_id
        LEFT JOIN public.auto_status sub_status ON sub_status.id=detail.sub_status_id
        LEFT JOIN public.auto_campaign_detail_zalo_engagement engagement ON engagement.campaign_detail_id=page.id
        LEFT JOIN public.auto_accounts account ON account.id=detail.account_id
      ), '[]'::jsonb),
      'total', (%3$s)
    )
  $query$, v_page_sql, v_direction, v_count_sql)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0), v_status_ids, v_search_ids;
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page_by_ids(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_origin_filter text, p_offset integer, p_limit integer, p_auth_username text, p_auth_password text, p_sort text, p_input_data_ids bigint[])
 RETURNS TABLE(input_data jsonb, origins jsonb, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_origin_filter, p_offset, p_limit, p_sort, p_input_data_ids
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page_v2(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_origin_filter text, p_offset integer, p_limit integer, p_auth_username text, p_auth_password text, p_sort text)
 RETURNS TABLE(input_data jsonb, origins jsonb, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_list_campaign_input_data_page_v2(
      p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_origin_filter, p_offset, p_limit, p_sort
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_preflight_campaign_data_group_change(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_group_id bigint, p_auth_username text, p_auth_password text)
 RETURNS TABLE(allowed boolean, reason text, canonical_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_preflight_campaign_data_group_change(
      p_staff_id, p_organization_id, p_campaign_id, p_group_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_reactivate_campaign_data_group_source(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_request_id text, p_reason text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
  v_result jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    v_result := public.aka_agent_reactivate_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id, p_request_id, p_reason
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_send_exclusion_groups(p_staff_id bigint, p_organization_id bigint, p_account_id bigint, p_operation text, p_payload jsonb, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE gid bigint; revision bigint; r jsonb; prior jsonb; request_id uuid;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL); -- Bind Desktop token before privileged work.

 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='zalo' AND NOT is_delete) THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
 IF p_operation='list' THEN
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),
   'options',public.aka_agent_internal_send_exclusion_options(p_staff_id,p_organization_id,p_account_id),
   'groups',COALESCE((SELECT jsonb_agg(public.aka_agent_internal_send_exclusion_group(id) ORDER BY name,id) FROM public.auto_campaign_send_exclusion_groups WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND account_id=p_account_id AND NOT is_delete),'[]'),
   'blocklists',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'count',(SELECT count(*) FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id WHERE m.group_id=g.id AND NOT m.is_delete AND NOT c.is_delete AND c.account_id=p_account_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id)) ORDER BY g.name,g.id)
   FROM public.auto_account_contact_groups g WHERE g.account_id=p_account_id AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist'),'[]'));
 ELSIF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 PERFORM public.aka_agent_internal_validate_send_exclusion_rules(p_payload->'rules',p_staff_id,p_organization_id,p_account_id);
 gid:=(p_payload->>'id')::bigint;
 IF gid IS NULL THEN
  request_id:=(p_payload->>'requestId')::uuid;
  IF request_id IS NULL THEN RAISE EXCEPTION 'send_exclusion_request_id_required'; END IF;
  INSERT INTO public.auto_campaign_send_exclusion_groups(staff_id,organization_id,account_id,name,match_mode,create_request_id)
   VALUES(p_staff_id,p_organization_id,p_account_id,btrim(p_payload->>'name'),p_payload->>'matchMode',request_id)
   ON CONFLICT(staff_id,organization_id,account_id,create_request_id) DO NOTHING RETURNING id INTO gid;
  IF gid IS NULL THEN
   SELECT public.aka_agent_internal_send_exclusion_group(id) INTO prior FROM public.auto_campaign_send_exclusion_groups
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND account_id=p_account_id AND create_request_id=request_id AND NOT is_delete;
   IF prior IS NULL OR prior->>'name' IS DISTINCT FROM btrim(p_payload->>'name') OR prior->>'matchMode' IS DISTINCT FROM p_payload->>'matchMode'
    OR (SELECT jsonb_agg(v ORDER BY v->>'fieldId') FROM jsonb_array_elements(prior->'rules') v) IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY v->>'fieldId') FROM jsonb_array_elements(p_payload->'rules') v)
   THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
   RETURN prior;
  END IF;
 ELSE
  UPDATE public.auto_campaign_send_exclusion_groups g SET name=btrim(p_payload->>'name'),match_mode=p_payload->>'matchMode',revision=g.revision+1,updated_at=now()
   WHERE g.id=gid AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND g.account_id=p_account_id AND NOT g.is_delete AND g.revision=(p_payload->>'revision')::bigint RETURNING g.revision INTO revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
  DELETE FROM public.auto_campaign_send_exclusion_rules WHERE group_id=gid;
 END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_payload->'rules') LOOP
  INSERT INTO public.auto_campaign_send_exclusion_rules(group_id,field_id,operator_id,value,is_enabled,sort_order)
  VALUES(gid,(r->>'fieldId')::bigint,(r->>'operatorId')::bigint,COALESCE(r->'value','null'),COALESCE((r->>'isEnabled')::boolean,false),COALESCE((r->>'sortOrder')::integer,0));
 END LOOP;
 RETURN public.aka_agent_internal_send_exclusion_group(gid);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_campaign_id bigint, p_group_id bigint, p_campaign_schedule timestamp with time zone, p_campaign_status text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_action_id text;
  v_completed_result jsonb;
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
  v_result jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  -- Preserve the pre-v206 retry contract: a committed request returns its
  -- immutable result even if the group/account subtype changed afterward.
  -- No campaign/input mutation occurs on this branch.
  SELECT batch.result
  INTO v_completed_result
  FROM public.auto_data_ingest_batches AS batch
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = btrim(COALESCE(p_request_id, ''))
    AND batch.operation = 'snapshot_campaign'
    AND batch.group_id = p_group_id
    AND batch.result IS NOT NULL;

  IF v_completed_result IS NULL THEN
    SELECT campaign.action_id
    INTO v_action_id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = p_group_id
     AND private.can_read_data_group(contact_group.id,p_staff_id,p_organization_id)
     AND contact_group.organization_id = p_organization_id
     AND contact_group.purpose = 'data_group'
     AND contact_group.is_delete = false
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false;

    IF v_action_id IS NOT NULL
      AND NOT public.aka_agent_data_group_type_compatible(
        p_group_id, v_action_id
      )
    THEN
      RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
    END IF;
  END IF;

  -- The desktop app is a tenant control surface for both runtime owners. Route
  -- this DB-only provisioning mutation by the persisted account subtype, then
  -- let the core repeat the proof under its campaign/account locks.
  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    v_result := public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
      p_staff_id,
      p_organization_id,
      p_request_id,
      p_campaign_id,
      p_group_id,
      p_campaign_schedule,
      p_campaign_status,
      p_auth_username,
      p_auth_password
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_stop_campaign_data_group_source(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_request_id text, p_reason text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
  v_result jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    v_result := public.aka_agent_stop_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id, p_request_id, p_reason
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$
;
CREATE POLICY desktop_owned_resource ON public."auto_accounts" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request())) WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()) AND ("auto_accounts"."account_group_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_account_groups" owned WHERE owned.id="auto_accounts"."account_group_id")) AND ("auto_accounts"."proxy_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_proxies" owned WHERE owned.id="auto_accounts"."proxy_id")));
CREATE POLICY desktop_owned_resource ON public."auto_campaigns" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request())) WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()) AND ("auto_campaigns"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaigns"."account_id")) AND ("auto_campaigns"."secondary_account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaigns"."secondary_account_id")));
CREATE POLICY desktop_owned_resource ON public."auto_account_groups" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request())) WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY desktop_owned_resource ON public."auto_proxies" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request())) WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY desktop_owned_resource ON public."auto_account_action_status" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_account_action_status"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_account_action_status"."account_id"))) WITH CHECK (("auto_account_action_status"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_account_action_status"."account_id")));
CREATE POLICY desktop_owned_resource ON public."auto_account_error_state" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_account_error_state"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_account_error_state"."account_id"))) WITH CHECK (("auto_account_error_state"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_account_error_state"."account_id")));
CREATE POLICY desktop_owned_resource ON public."auto_account_logs" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_account_logs"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_account_logs"."account_id")) AND ("auto_account_logs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_account_logs"."campaign_id"))) WITH CHECK (("auto_account_logs"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_account_logs"."account_id")) AND ("auto_account_logs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_account_logs"."campaign_id")));
CREATE POLICY desktop_owned_resource ON public."auto_campaign_inputs" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_campaign_inputs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_inputs"."campaign_id"))) WITH CHECK (("auto_campaign_inputs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_inputs"."campaign_id")));
CREATE POLICY desktop_owned_resource ON public."auto_campaign_input_data" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_campaign_input_data"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_input_data"."campaign_id")) AND ("auto_campaign_input_data"."input_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_inputs" owned WHERE owned.id="auto_campaign_input_data"."input_id"))) WITH CHECK (("auto_campaign_input_data"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_input_data"."campaign_id")) AND ("auto_campaign_input_data"."input_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_inputs" owned WHERE owned.id="auto_campaign_input_data"."input_id")));
CREATE POLICY desktop_owned_resource ON public."auto_campaign_details" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_campaign_details"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_details"."campaign_id")) AND ("auto_campaign_details"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaign_details"."account_id")) AND ("auto_campaign_details"."input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_campaign_details"."input_data_id"))) WITH CHECK (("auto_campaign_details"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_details"."campaign_id")) AND ("auto_campaign_details"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaign_details"."account_id")) AND ("auto_campaign_details"."input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_campaign_details"."input_data_id")));
CREATE POLICY desktop_owned_resource ON public."auto_campaign_error_state" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_campaign_error_state"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_error_state"."campaign_id"))) WITH CHECK (("auto_campaign_error_state"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_error_state"."campaign_id")));
CREATE POLICY desktop_owned_resource ON public."auto_email_message_trackings" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_email_message_trackings"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_email_message_trackings"."campaign_id")) AND ("auto_email_message_trackings"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_email_message_trackings"."account_id")) AND ("auto_email_message_trackings"."campaign_detail_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_details" owned WHERE owned.id="auto_email_message_trackings"."campaign_detail_id")) AND ("auto_email_message_trackings"."input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_email_message_trackings"."input_data_id"))) WITH CHECK (("auto_email_message_trackings"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_email_message_trackings"."campaign_id")) AND ("auto_email_message_trackings"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_email_message_trackings"."account_id")) AND ("auto_email_message_trackings"."campaign_detail_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_details" owned WHERE owned.id="auto_email_message_trackings"."campaign_detail_id")) AND ("auto_email_message_trackings"."input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_email_message_trackings"."input_data_id")));
CREATE POLICY desktop_owned_resource ON public."auto_email_link_trackings" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_email_link_trackings"."message_tracking_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_email_message_trackings" owned WHERE owned.id="auto_email_link_trackings"."message_tracking_id"))) WITH CHECK (("auto_email_link_trackings"."message_tracking_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_email_message_trackings" owned WHERE owned.id="auto_email_link_trackings"."message_tracking_id")));
CREATE POLICY desktop_owned_resource ON public."auto_runs" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_runs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_runs"."campaign_id")) AND ("auto_runs"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_runs"."account_id")) AND ("auto_runs"."campaign_detail_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_details" owned WHERE owned.id="auto_runs"."campaign_detail_id")) AND ("auto_runs"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_runs"."campaign_input_data_id"))) WITH CHECK (("auto_runs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_runs"."campaign_id")) AND ("auto_runs"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_runs"."account_id")) AND ("auto_runs"."campaign_detail_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_details" owned WHERE owned.id="auto_runs"."campaign_detail_id")) AND ("auto_runs"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_runs"."campaign_input_data_id")));
CREATE POLICY desktop_owned_resource ON public."auto_run_steps" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_run_steps"."run_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_runs" owned WHERE owned.id="auto_run_steps"."run_id"))) WITH CHECK (("auto_run_steps"."run_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_runs" owned WHERE owned.id="auto_run_steps"."run_id")));
CREATE POLICY desktop_owned_resource ON public."auto_campaign_zalo_realtime_group_events" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_campaign_zalo_realtime_group_events"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_zalo_realtime_group_events"."campaign_id")) AND ("auto_campaign_zalo_realtime_group_events"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaign_zalo_realtime_group_events"."account_id")) AND ("auto_campaign_zalo_realtime_group_events"."input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_campaign_zalo_realtime_group_events"."input_data_id"))) WITH CHECK (("auto_campaign_zalo_realtime_group_events"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_zalo_realtime_group_events"."campaign_id")) AND ("auto_campaign_zalo_realtime_group_events"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaign_zalo_realtime_group_events"."account_id")) AND ("auto_campaign_zalo_realtime_group_events"."input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_campaign_zalo_realtime_group_events"."input_data_id")));
CREATE POLICY desktop_owned_resource ON public."auto_campaign_run_events" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("auto_campaign_run_events"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_run_events"."campaign_id")) AND ("auto_campaign_run_events"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaign_run_events"."account_id")) AND ("auto_campaign_run_events"."campaign_input_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_inputs" owned WHERE owned.id="auto_campaign_run_events"."campaign_input_id")) AND ("auto_campaign_run_events"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_campaign_run_events"."campaign_input_data_id")) AND ("auto_campaign_run_events"."run_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_runs" owned WHERE owned.id="auto_campaign_run_events"."run_id")) AND ("auto_campaign_run_events"."run_step_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_run_steps" owned WHERE owned.id="auto_campaign_run_events"."run_step_id"))) WITH CHECK (("auto_campaign_run_events"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_campaign_run_events"."campaign_id")) AND ("auto_campaign_run_events"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_campaign_run_events"."account_id")) AND ("auto_campaign_run_events"."campaign_input_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_inputs" owned WHERE owned.id="auto_campaign_run_events"."campaign_input_id")) AND ("auto_campaign_run_events"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_campaign_run_events"."campaign_input_data_id")) AND ("auto_campaign_run_events"."run_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_runs" owned WHERE owned.id="auto_campaign_run_events"."run_id")) AND ("auto_campaign_run_events"."run_step_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_run_steps" owned WHERE owned.id="auto_campaign_run_events"."run_step_id")));
CREATE POLICY desktop_owned_resource ON public."auto_zalo_api_error_logs" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING ((staff_id IS NULL OR (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))) AND ("auto_zalo_api_error_logs"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_zalo_api_error_logs"."account_id")) AND ("auto_zalo_api_error_logs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_zalo_api_error_logs"."campaign_id")) AND ("auto_zalo_api_error_logs"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_zalo_api_error_logs"."campaign_input_data_id")) AND ("auto_zalo_api_error_logs"."campaign_detail_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_details" owned WHERE owned.id="auto_zalo_api_error_logs"."campaign_detail_id"))) WITH CHECK ((staff_id IS NULL OR (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))) AND ("auto_zalo_api_error_logs"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="auto_zalo_api_error_logs"."account_id")) AND ("auto_zalo_api_error_logs"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="auto_zalo_api_error_logs"."campaign_id")) AND ("auto_zalo_api_error_logs"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="auto_zalo_api_error_logs"."campaign_input_data_id")) AND ("auto_zalo_api_error_logs"."campaign_detail_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_details" owned WHERE owned.id="auto_zalo_api_error_logs"."campaign_detail_id")));
CREATE POLICY desktop_owned_resource ON public."ai_log" AS RESTRICTIVE FOR ALL TO aka_agent_desktop USING (("ai_log"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="ai_log"."campaign_id")) AND ("ai_log"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="ai_log"."account_id")) AND ("ai_log"."campaign_input_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_inputs" owned WHERE owned.id="ai_log"."campaign_input_id")) AND ("ai_log"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="ai_log"."campaign_input_data_id")) AND ("ai_log"."run_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_runs" owned WHERE owned.id="ai_log"."run_id")) AND ("ai_log"."run_step_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_run_steps" owned WHERE owned.id="ai_log"."run_step_id"))) WITH CHECK (("ai_log"."campaign_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaigns" owned WHERE owned.id="ai_log"."campaign_id")) AND ("ai_log"."account_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_accounts" owned WHERE owned.id="ai_log"."account_id")) AND ("ai_log"."campaign_input_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_inputs" owned WHERE owned.id="ai_log"."campaign_input_id")) AND ("ai_log"."campaign_input_data_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_campaign_input_data" owned WHERE owned.id="ai_log"."campaign_input_data_id")) AND ("ai_log"."run_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_runs" owned WHERE owned.id="ai_log"."run_id")) AND ("ai_log"."run_step_id" IS NULL OR EXISTS (SELECT 1 FROM public."auto_run_steps" owned WHERE owned.id="ai_log"."run_step_id")));
CREATE TRIGGER aaa_desktop_parent_ownership BEFORE INSERT OR UPDATE OR DELETE ON public.auto_accounts FOR EACH ROW EXECUTE FUNCTION private.aka_agent_guard_parent_ownership();
CREATE TRIGGER aaa_desktop_parent_ownership BEFORE INSERT OR UPDATE OR DELETE ON public.auto_campaigns FOR EACH ROW EXECUTE FUNCTION private.aka_agent_guard_parent_ownership();
NOTIFY pgrst,'reload schema';
