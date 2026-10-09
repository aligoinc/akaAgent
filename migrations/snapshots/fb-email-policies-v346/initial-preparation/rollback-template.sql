-- Template only: apply history supplies the exact inserted ID/code/checksum receipt.
-- The unresolved receipt intentionally fails closed. Use the finalized migrations/tests rollback after apply.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.auto_error IN SHARE ROW EXCLUSIVE MODE;
DO $rollback$
DECLARE
  expected jsonb := '__APPLIED_ROWS_JSON__'::jsonb;
  codes text[];
  removed integer;
BEGIN
  IF md5((jsonb_build_object(
  'columns', (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.auto_error'::regclass AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.auto_error'::regclass),
  'incoming_foreign_keys', (SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid='public.auto_error'::regclass),
  'indexes', (SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='auto_error'),
  'triggers', (SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.auto_error'::regclass AND NOT tgisinternal),
  'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_error'),
  'access', (SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid='public.auto_error'::regclass),
  'sequence_definition', (SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_error_id_seq') - 'last_value'
))::text) <> '945c03cb00f463cc10642bf0cdb89a63' THEN
    RAISE EXCEPTION 'v346 guard: auto_error schema/access/constraints changed'; END IF;
  
  IF EXISTS (SELECT 1 FROM jsonb_each_text($old_hashes${"1":"cde204ef721a0709992019c989c9dc74","2":"39af6d3558fe67d07128427d008d9a69","3":"e01a8c709b8ddca5607d99c4f2adb188","4":"fc1ac8018f6cf18f185875f9ae30c4d6","5":"6962d5198d9884f148a8affa8f168dfa","6":"ffcac753dd901f0e06905d1a35d2dd0f","7":"e9614ca486fa6faa042914def39234d4","8":"1900462f4ceb8682c595140a68b00c5b","9":"10d8ab73ef809991b40cdf90fdcb930b","10":"d53de701e30c8bdab611240b5af14927","11":"541972c8188d73be665b10eea4a50222","12":"d0d3d328bea8d8a994df113ea609a231","13":"7ec0365d5347a58046fcccc48762664b","14":"58b5b8c9fbf970a875d62ea6a692d29d","15":"1da20c622657be8867245afef9d152d6","16":"23ffa15841f8e53a741ff562040db48d","17":"5cd3f744a1610fdbca4ea38ce4181285","18":"620145588f938528e5ce2d384790e59e","31":"60012afb6d3bdcd81bbde8599a1d099a","32":"f284d00d5eb4ac4f7baf7cb2808fad0f","33":"9a995bf015f8664753cc5b702ec8051e","34":"c11325b983700a4b0ab5819fcab0f182","35":"ab62f24355de58e938a59903b51eb795","36":"b60a31d5fb2821e83073bf583432cde6","41":"36ca53432b5cb02e0da0f1f2d51b90dc","42":"232225b6201be8000a4d6cc283250570","43":"b2036f71ceaa0a476efd012bae2b2099","44":"9ea0eb0d38911023c2784b9b092e1640","45":"c1b893ee1220f455284f8778390375ac","46":"566921b1b5f7c9c712267cd755a49a1f","47":"9d2d8d548c95da0a50ac26543402a18e","48":"5bd2f85b7c3cbf43cc4b3e51725e7687","49":"5e944cc2bb311335848d0eac36bce708","50":"453505419a158e99e123365b7aeca991","51":"2a9ecfef77871648eab8ef53faef9d3f","52":"f54d268ff3f4e80adc387651161f1c44","53":"5df315bf00971a7fe5a9f864eb37e725","54":"8b4658c17d37f2d5711db3abb525a0e8","55":"8ee1e9c2a56b5f7ffc16e515add1c47e","56":"1860997dcc68f749af83d25a81e0e10b","57":"c85ae290afa882eb3b5b14ca9f8b9004","58":"b31a383072a53800c7547736b31a39a1","59":"7090537926fca2b9ded67c929c2085db","60":"7db733c60002587e8b91507c7d690ce7","61":"9da26d1c8587fcd7d31539f749f2e8f9"}$old_hashes$::jsonb) h
    LEFT JOIN public.auto_error e ON e.id=h.key::bigint
    WHERE e.id IS NULL OR md5(to_jsonb(e)::text) <> h.value) THEN
    RAISE EXCEPTION 'v346 guard: original policy changed or missing'; END IF;
  IF jsonb_array_length(expected) <> 58 THEN RAISE EXCEPTION 'v346 rollback: invalid receipt'; END IF;
  SELECT array_agg(x->>'error_code') INTO codes FROM jsonb_array_elements(expected) x;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(expected) x
    LEFT JOIN public.auto_error e ON e.id=(x->>'id')::bigint AND e.error_code=x->>'error_code'
    WHERE e.id IS NULL OR md5(to_jsonb(e)::text) IS DISTINCT FROM x->>'md5') THEN
    RAISE EXCEPTION 'v346 rollback: new row changed or missing'; END IF;
  IF EXISTS (WITH candidates AS (SELECT jsonb_array_elements_text($codes$["err_fb_checkpoint","err_fb_feature_blocked","err_fb_identity_switch_failed","err_fb_identity_restore_failed","err_fb_page_permission_token_missing","err_fb_page_permission_no_page_token","err_fb_page_permission_api_error","err_fb_group_cannot_post_not_member","err_fb_group_cannot_post_join_pending","err_fb_group_cannot_post_admin_only","err_fb_group_cannot_post_unavailable","err_fb_comment_unavailable_post_pending","err_fb_comment_unavailable_comment_disabled","err_fb_comment_unavailable_post_not_found","err_fb_comment_unavailable_not_member","err_fb_messenger_unavailable_target_not_messageable","err_fb_messenger_unavailable_e2ee_pin_required","err_fb_messenger_unavailable_account_restricted","err_fb_add_friend_unavailable","err_fb_page_inbox_customer_not_found","err_fb_page_inbox_wrong_conversation","err_fb_page_inbox_cannot_reply_outside_window","err_fb_page_inbox_cannot_reply_blocked_by_user","err_fb_join_group_failed_limit","err_fb_join_group_failed_questions_required","err_fb_join_group_failed_ui","err_fb_post_not_confirmed","err_fb_post_not_published_content_blocked","err_fb_post_not_published_duplicate","err_fb_formatted_content_rejected","err_fb_media_upload_timeout","err_fb_composer_editor_not_found","err_fb_post_button_not_found","err_fb_page_inbox_ui","err_fb_upload_form_changed","err_fb_group_invite_ui","err_media_file_missing","err_input_invalid","err_campaign_config_invalid","err_system_block_load","err_network_offline","err_proxy_failed","err_ai_service_unavailable","err_device_sleep","err_runtime_browser","err_server_unreachable","err_email_daily_limit","err_email_web_login_required","err_email_bad_credentials","err_email_login_throttled","err_email_server_busy","err_email_connection","err_email_system_temporary","err_email_smtp_not_configured","err_email_missing_recipient","err_email_message_too_large","err_email_content_blocked","err_email_send_failed"]$codes$::jsonb) AS code)
SELECT 'block' AS kind,b.id::text AS id,b.name,c.code,md5(to_jsonb(b)::text) AS md5
FROM public.auto_blocks b JOIN candidates c ON strpos(coalesce(b.code,'')||coalesce(b.config_schema::text,'')||coalesce(b.default_config::text,'')||coalesce(b.output_schema::text,''),c.code)>0
UNION ALL
SELECT 'workflow',w.id::text,w.name,c.code,md5(to_jsonb(w)::text)
FROM public.auto_workflows w JOIN candidates c ON strpos(coalesce(w.nodes::text,'')||coalesce(w.edges::text,'')||coalesce(w.variables_schema::text,'')||coalesce(w.default_variables::text,''),c.code)>0
UNION ALL
SELECT 'function',p.oid::text,p.oid::regprocedure::text,c.code,md5(p.prosrc)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN candidates c ON strpos(p.prosrc,c.code)>0
WHERE n.nspname='public' AND p.prokind='f') THEN
    RAISE EXCEPTION 'v346 rollback: live runtime now references these codes'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_account_error_state WHERE error_code=ANY(codes))
    OR EXISTS (SELECT 1 FROM public.auto_account_action_status WHERE disabled_error_code=ANY(codes))
    OR EXISTS (SELECT 1 FROM public.auto_campaign_details WHERE error_code=ANY(codes))
    OR EXISTS (SELECT 1 FROM public.auto_zalo_api_error_logs WHERE normalized_error_code=ANY(codes)) THEN
      RAISE EXCEPTION 'v346 rollback: policy has runtime references; refusing deletion'; END IF;
  DELETE FROM public.auto_error e USING jsonb_array_elements(expected) x
    WHERE e.id=(x->>'id')::bigint AND e.error_code=x->>'error_code' AND md5(to_jsonb(e)::text)=x->>'md5';
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> 58 THEN RAISE EXCEPTION 'v346 rollback: incomplete deletion'; END IF;
  IF md5((jsonb_build_object(
  'columns', (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.auto_error'::regclass AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.auto_error'::regclass),
  'incoming_foreign_keys', (SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid='public.auto_error'::regclass),
  'indexes', (SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='auto_error'),
  'triggers', (SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.auto_error'::regclass AND NOT tgisinternal),
  'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_error'),
  'access', (SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid='public.auto_error'::regclass),
  'sequence_definition', (SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_error_id_seq') - 'last_value'
))::text) <> '945c03cb00f463cc10642bf0cdb89a63' THEN
    RAISE EXCEPTION 'v346 guard: auto_error schema/access/constraints changed'; END IF;
  
  IF EXISTS (SELECT 1 FROM jsonb_each_text($old_hashes${"1":"cde204ef721a0709992019c989c9dc74","2":"39af6d3558fe67d07128427d008d9a69","3":"e01a8c709b8ddca5607d99c4f2adb188","4":"fc1ac8018f6cf18f185875f9ae30c4d6","5":"6962d5198d9884f148a8affa8f168dfa","6":"ffcac753dd901f0e06905d1a35d2dd0f","7":"e9614ca486fa6faa042914def39234d4","8":"1900462f4ceb8682c595140a68b00c5b","9":"10d8ab73ef809991b40cdf90fdcb930b","10":"d53de701e30c8bdab611240b5af14927","11":"541972c8188d73be665b10eea4a50222","12":"d0d3d328bea8d8a994df113ea609a231","13":"7ec0365d5347a58046fcccc48762664b","14":"58b5b8c9fbf970a875d62ea6a692d29d","15":"1da20c622657be8867245afef9d152d6","16":"23ffa15841f8e53a741ff562040db48d","17":"5cd3f744a1610fdbca4ea38ce4181285","18":"620145588f938528e5ce2d384790e59e","31":"60012afb6d3bdcd81bbde8599a1d099a","32":"f284d00d5eb4ac4f7baf7cb2808fad0f","33":"9a995bf015f8664753cc5b702ec8051e","34":"c11325b983700a4b0ab5819fcab0f182","35":"ab62f24355de58e938a59903b51eb795","36":"b60a31d5fb2821e83073bf583432cde6","41":"36ca53432b5cb02e0da0f1f2d51b90dc","42":"232225b6201be8000a4d6cc283250570","43":"b2036f71ceaa0a476efd012bae2b2099","44":"9ea0eb0d38911023c2784b9b092e1640","45":"c1b893ee1220f455284f8778390375ac","46":"566921b1b5f7c9c712267cd755a49a1f","47":"9d2d8d548c95da0a50ac26543402a18e","48":"5bd2f85b7c3cbf43cc4b3e51725e7687","49":"5e944cc2bb311335848d0eac36bce708","50":"453505419a158e99e123365b7aeca991","51":"2a9ecfef77871648eab8ef53faef9d3f","52":"f54d268ff3f4e80adc387651161f1c44","53":"5df315bf00971a7fe5a9f864eb37e725","54":"8b4658c17d37f2d5711db3abb525a0e8","55":"8ee1e9c2a56b5f7ffc16e515add1c47e","56":"1860997dcc68f749af83d25a81e0e10b","57":"c85ae290afa882eb3b5b14ca9f8b9004","58":"b31a383072a53800c7547736b31a39a1","59":"7090537926fca2b9ded67c929c2085db","60":"7db733c60002587e8b91507c7d690ce7","61":"9da26d1c8587fcd7d31539f749f2e8f9"}$old_hashes$::jsonb) h
    LEFT JOIN public.auto_error e ON e.id=h.key::bigint
    WHERE e.id IS NULL OR md5(to_jsonb(e)::text) <> h.value) THEN
    RAISE EXCEPTION 'v346 guard: original policy changed or missing'; END IF;
  IF (SELECT count(*) FROM public.auto_error)=45
    AND (SELECT md5(string_agg(to_jsonb(e)::text,'|' ORDER BY id)) FROM public.auto_error e) <> '159646ca3dafb959177c1379c63e573a' THEN
    RAISE EXCEPTION 'v346 rollback: original table checksum not restored'; END IF;
END $rollback$;
COMMIT;
