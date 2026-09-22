-- Synthetic fixtures only; all business rows are rolled back.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='120s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  customer_id bigint; org_id bigint; other_org bigint; actor_id bigint; other_id bigint; member_id bigint;
  username text; group_id bigint; child_id bigint; foreign_group bigint; r jsonb; payload jsonb; before_row jsonb;
  rid uuid; today date:=timezone('Asia/Ho_Chi_Minh',now())::date; saved_expiry timestamptz; old_username text; rev text;
BEGIN
  INSERT INTO public.aka_customer(name,phone) VALUES('__staff_v305_rollback__','0999999305') RETURNING aka_customer.id INTO customer_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__staff_v305_rollback__','0999999305',3,s.id,s.id FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING org_organization.id INTO org_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__staff_v305_foreign__','0999999304',3,s.id,s.id FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING org_organization.id INTO other_org;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin) VALUES(org_id,'Admin fixture','0999999305',true) RETURNING org_staff.id,org_staff.username INTO actor_id,username;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin) VALUES(other_org,'Foreign fixture','0999999304',true) RETURNING org_staff.id INTO other_id;
  INSERT INTO public.org_group(organization_id,name) VALUES(other_org,'Foreign group') RETURNING org_group.id INTO foreign_group;
  INSERT INTO public.org_organization_product(organization_id,product_id,product_package_id,expiration_date,max_accounts)
    SELECT org_id,16,p.product_package_id,(today+800)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh',10 FROM public.org_organization_product p WHERE p.product_id=16 LIMIT 1;
  r:=public.aka_agent_staff_access(actor_id,username,'123456');
  IF r->>'isAdmin'<>'true' OR r->>'timeAllowed'<>'true' THEN RAISE EXCEPTION 'legacy NULL expiry login failed'; END IF;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','list','{}');
  IF r->>'total'<>'1' OR r->'organization'->>'staffDurationDays'<>'365' OR (r->'items'->0) ? 'password' THEN RAISE EXCEPTION 'list/default/secret failed'; END IF;
  BEGIN PERFORM public.aka_agent_staff_management(other_id,username,'123456','list','{}'); RAISE EXCEPTION 'cross credential accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_access_denied' THEN RAISE; END IF; END;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('name','Root','parentId',NULL,'requestId',gen_random_uuid())); group_id:=(r->>'id')::bigint;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('name','Child','parentId',group_id,'requestId',gen_random_uuid())); child_id:=(r->>'id')::bigint;
  SELECT g.xmin::text INTO rev FROM public.org_group g WHERE g.id=group_id;
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('id',group_id,'name','Root','parentId',child_id,'expectedVersion',rev,'requestId',gen_random_uuid())); RAISE EXCEPTION 'cycle accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_group_cycle' THEN RAISE; END IF; END;
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('name','Wrong','parentId',foreign_group,'requestId',gen_random_uuid())); RAISE EXCEPTION 'foreign group accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_not_found' THEN RAISE; END IF; END;
  rid:=gen_random_uuid();payload:=jsonb_build_object('name','Staff fixture','phone','+84 999 999 306','groupId',child_id,'requestId',rid);
  r:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',payload); member_id:=(r->>'id')::bigint;
  IF r->>'phone'<>'0999999306' OR r->>'username'<>org_id::text||'.0999999306' OR r->>'isAdmin'<>'false' OR timezone('Asia/Ho_Chi_Minh',(r->>'createdAt')::timestamptz)::date+366<>timezone('Asia/Ho_Chi_Minh',(r->>'expirationDate')::timestamptz)::date OR (r->>'expirationDate')::timestamptz<>(today+366)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' THEN RAISE EXCEPTION 'staff defaults failed'; END IF;
  IF public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',payload) IS DISTINCT FROM r THEN RAISE EXCEPTION 'create replay failed'; END IF;
  saved_expiry:=(r->>'expirationDate')::timestamptz; old_username:=r->>'username';
  r:=public.aka_agent_staff_management(actor_id,username,'123456','list',jsonb_build_object('groupId',group_id)); IF r->>'total'<>'1' THEN RAISE EXCEPTION 'descendant filtering failed'; END IF;
  UPDATE public.org_group_staff gs SET is_admin=true WHERE gs.staff_id=member_id;
  before_row:=public.aka_agent_staff_management_row(member_id);
  r:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',member_id,'name','Staff updated','phone','0999999307','groupId',child_id,'expectedVersion',before_row->>'version','requestId',gen_random_uuid()));
  IF r->>'username'<>old_username OR (r->>'expirationDate')::timestamptz<>saved_expiry OR NOT(SELECT gs.is_admin FROM public.org_group_staff gs WHERE gs.staff_id=member_id) THEN RAISE EXCEPTION 'edit changed immutable fields/membership'; END IF;
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Duplicate','phone','84999999307','groupId',child_id,'requestId',gen_random_uuid())); RAISE EXCEPTION 'duplicate accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_phone_exists' THEN RAISE; END IF; END;
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',member_id,'name','Overwrite','phone','0999999307','groupId',child_id,'expectedVersion','stale','requestId',gen_random_uuid())); RAISE EXCEPTION 'stale update accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_conflict' THEN RAISE; END IF; END;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','revealPassword',jsonb_build_object('id',member_id)); IF r->>'password'<>'123456' THEN RAISE EXCEPTION 'password failed'; END IF;
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','revealPassword',jsonb_build_object('id',other_id)); RAISE EXCEPTION 'foreign password leaked'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_not_found' THEN RAISE; END IF; END;
  UPDATE public.org_organization o SET max_staff=2 WHERE o.id=org_id;
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Over quota','phone','0999999308','groupId',child_id,'requestId',gen_random_uuid())); RAISE EXCEPTION 'quota accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_quota_full' THEN RAISE; END IF; END;
  before_row:=public.aka_agent_staff_management_row(actor_id);
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','setStatus',jsonb_build_object('targets',jsonb_build_array(jsonb_build_object('id',actor_id,'expectedVersion',before_row->>'version')),'isActive',false,'requestId',gen_random_uuid())); RAISE EXCEPTION 'self lock accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_admin_required' THEN RAISE; END IF; END;
  before_row:=public.aka_agent_staff_management_row(member_id);
  r:=public.aka_agent_staff_management(actor_id,username,'123456','setStatus',jsonb_build_object('targets',jsonb_build_array(jsonb_build_object('id',member_id,'expectedVersion',before_row->>'version')),'isActive',false,'requestId',gen_random_uuid()));
  IF public.aka_agent_staff_time_allowed(member_id) THEN RAISE EXCEPTION 'locked guard failed'; END IF;
  UPDATE public.org_staff s SET is_active=true,aka_agent_device_fingerprint_hash='old-fixture' WHERE s.id=member_id;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','prepareDevices',jsonb_build_object('ids',jsonb_build_array(member_id)));
  payload:=jsonb_build_object('targets',jsonb_build_array(jsonb_build_object('id',member_id,'expectedVersion',r->'items'->0->>'version')),'requestId',gen_random_uuid());
  PERFORM public.aka_agent_staff_management(actor_id,username,'123456','resetDevices',payload);
  UPDATE public.org_staff s SET aka_agent_device_fingerprint_hash='new-fixture' WHERE s.id=member_id;
  PERFORM public.aka_agent_staff_management(actor_id,username,'123456','resetDevices',payload);
  IF (SELECT s.aka_agent_device_fingerprint_hash FROM public.org_staff s WHERE s.id=member_id)<>'new-fixture' THEN RAISE EXCEPTION 'device retry erased new binding'; END IF;
  UPDATE public.org_staff s SET expiration_date=(today-1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE s.id=member_id;
  IF public.aka_agent_staff_time_allowed(member_id) THEN RAISE EXCEPTION 'staff expiry ignored'; END IF;
  IF public.aka_agent_staff_management_row(member_id)->>'status'<>'expired' THEN RAISE EXCEPTION 'package longer than staff'; END IF;
  UPDATE public.org_organization o SET use_organization_expiration=true WHERE o.id=org_id;
  IF NOT public.aka_agent_staff_time_allowed(member_id) THEN RAISE EXCEPTION 'organization mode failed'; END IF;
  UPDATE public.org_organization o SET use_organization_expiration=false,staff_duration_days=10 WHERE o.id=org_id;
  UPDATE public.org_staff s SET expiration_date=today::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE s.id=member_id;
  IF NOT public.aka_agent_staff_time_allowed(member_id) THEN RAISE EXCEPTION 'inclusive Vietnam expiry failed'; END IF;
  UPDATE public.org_staff s SET expiration_date=saved_expiry WHERE s.id=member_id;
  -- Exercise shipped signatures through the actual anon role. Keep the unit
  -- token alive while staff expiry changes, then settle and refuse the next unit.
  DECLARE
    account_id bigint; campaign_id bigint; input_id bigint; runtime_target text;
    claim_token uuid; unit_token uuid; action_id text; response jsonb; platform text;
  BEGIN
    UPDATE public.org_organization_product p SET is_zalo_server=true WHERE p.organization_id=org_id;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    FOREACH platform IN ARRAY ARRAY['facebook','zalo'] LOOP
      runtime_target:=CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END;
      UPDATE public.org_staff s SET expiration_date=NULL WHERE s.id=member_id;
      SELECT a.id INTO STRICT action_id FROM public.auto_campaign_actions a WHERE a.flatform_type=platform AND a.is_active AND NOT a.is_delete ORDER BY a.id LIMIT 1;
      INSERT INTO public.auto_accounts(name,flatform_type,is_zalo_server,is_zalo_show_web,login_status,status,is_active,staff_id,organization_id,is_delete)
        VALUES('__v305_runtime__',platform,platform='zalo',false,'đã đăng nhập','chờ xử lý',true,member_id,org_id,false) RETURNING auto_accounts.id INTO account_id;
      INSERT INTO public.auto_campaigns(name,action_id,account_id,status,content,schedule,original_schedule,schedule_type,daily_stop_time,continue_next_day,data_target_source_mode,staff_id,organization_id,is_delete)
        VALUES('__v305_runtime__',action_id,account_id,'chờ xử lý','',now()-interval '1 hour',now()-interval '1 hour','daily',NULL,true,'direct',member_id,org_id,false) RETURNING auto_campaigns.id INTO campaign_id;
      INSERT INTO public.auto_campaign_input_data(campaign_id,name,uid,status,note,schedule,is_delete)
        VALUES(campaign_id,'__v305_target__','1000000305','chờ xử lý','',now()-interval '1 hour',false) RETURNING auto_campaign_input_data.id INTO input_id;
      EXECUTE 'SET LOCAL ROLE anon';
      IF NOT public.claim_campaign_runtime(campaign_id,account_id,member_id,runtime_target) THEN RAISE EXCEPTION 'legacy % claim failed',platform; END IF;
      EXECUTE 'RESET ROLE';
      UPDATE public.auto_campaigns c SET status='chờ xử lý' WHERE c.id=campaign_id;
      UPDATE public.auto_accounts a SET status='chờ xử lý' WHERE a.id=account_id;
      claim_token:=gen_random_uuid(); unit_token:=gen_random_uuid();
      EXECUTE 'SET LOCAL ROLE anon';
      SELECT to_jsonb(t) INTO response FROM public.aka_agent_claim_campaign_runtime_v2(campaign_id,account_id,member_id,runtime_target,claim_token) t;
      IF response->>'ok'<>'true' THEN RAISE EXCEPTION 'v2 % claim failed: %',platform,response->>'reason'; END IF;
      SELECT to_jsonb(t) INTO response FROM public.aka_agent_claim_campaign_run_unit_v2(campaign_id,account_id,member_id,runtime_target,claim_token,today,unit_token,ARRAY[input_id]) t;
      IF response->>'ok'<>'true' THEN RAISE EXCEPTION 'v2 % unit failed: %',platform,response->>'reason'; END IF;
      EXECUTE 'RESET ROLE';
      UPDATE public.org_staff s SET expiration_date=(today-1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE s.id=member_id;
      EXECUTE 'SET LOCAL ROLE anon';
      SELECT to_jsonb(t) INTO response FROM public.aka_agent_claim_campaign_run_unit_v2(campaign_id,account_id,member_id,runtime_target,claim_token,today,unit_token,ARRAY[input_id]) t;
      IF response->>'ok'<>'true' OR response->>'reason'<>'already_claimed' THEN RAISE EXCEPTION 'expired committed replay failed'; END IF;
      IF platform='zalo' THEN
        SELECT to_jsonb(t) INTO response FROM public.aka_agent_get_zalo_server_run_control_state(campaign_id,account_id,member_id) t;
        IF response->>'should_stop'<>'false' THEN RAISE EXCEPTION 'expiry interrupted held server unit: %',response->>'hard_stop_reason'; END IF;
        response:=public.discover_zalo_server_account_runtime_users(member_id-1,10);
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(response->'items') item WHERE (item->>'staff_id')::bigint=member_id) THEN RAISE EXCEPTION 'expired staff discovered'; END IF;
      END IF;
      UPDATE public.auto_campaign_input_data i SET status='hoàn thành',note='__v305_result_preserved__' WHERE i.id=input_id;
      SELECT to_jsonb(t) INTO response FROM public.aka_agent_settle_campaign_run_unit_v2(campaign_id,account_id,member_id,runtime_target,unit_token,false) t;
      IF response->>'ok'<>'true' THEN RAISE EXCEPTION 'expired unit settlement failed'; END IF;
      SELECT to_jsonb(t) INTO response FROM public.aka_agent_claim_campaign_run_unit_v2(campaign_id,account_id,member_id,runtime_target,claim_token,today,gen_random_uuid(),ARRAY[]::bigint[]) t;
      IF response->>'ok'<>'false' OR response->>'reason'<>'runtime_not_owner' THEN RAISE EXCEPTION 'expired next unit allowed'; END IF;
      EXECUTE 'RESET ROLE';
      IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_input_data i WHERE i.id=input_id AND i.status='hoàn thành' AND i.note='__v305_result_preserved__')
        OR EXISTS(SELECT 1 FROM public.auto_campaigns c WHERE c.id=campaign_id AND c.runtime_unit_token IS NOT NULL) THEN RAISE EXCEPTION 'result/lease not preserved'; END IF;
      UPDATE public.auto_campaigns c SET status='hoàn thành' WHERE c.id=campaign_id;
      UPDATE public.auto_accounts a SET status='chờ xử lý' WHERE a.id=account_id;
      UPDATE public.org_staff s SET expiration_date=NULL WHERE s.id=member_id;
      unit_token:=gen_random_uuid();
      EXECUTE 'SET LOCAL ROLE anon';
      IF platform='facebook' THEN response:=public.claim_non_zalo_account_runtime_operation(account_id,member_id,platform,'chờ xử lý',unit_token,true);
      ELSE response:=public.claim_zalo_account_runtime_operation(account_id,member_id,runtime_target,'chờ xử lý',unit_token,true); END IF;
      IF response->>'ok'<>'true' THEN RAISE EXCEPTION 'legacy account operation failed: %',response; END IF;
      EXECUTE 'RESET ROLE';
      UPDATE public.org_staff s SET expiration_date=(today-1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE s.id=member_id;
      EXECUTE 'SET LOCAL ROLE anon';
      IF platform='facebook' THEN
        IF NOT public.release_non_zalo_account_runtime_operation(account_id,member_id,platform,'chờ xử lý',unit_token) THEN RAISE EXCEPTION 'expired FB release failed'; END IF;
        response:=public.claim_non_zalo_account_runtime_operation(account_id,member_id,platform,'chờ xử lý',gen_random_uuid(),true);
      ELSE
        IF NOT public.release_zalo_account_runtime_operation(account_id,member_id,runtime_target,'chờ xử lý',unit_token) THEN RAISE EXCEPTION 'expired Zalo release failed'; END IF;
        response:=public.claim_zalo_account_runtime_operation(account_id,member_id,runtime_target,'chờ xử lý',gen_random_uuid(),true);
      END IF;
      IF response->>'ok'<>'false' THEN RAISE EXCEPTION 'expired account claim allowed'; END IF;
      EXECUTE 'RESET ROLE';
    END LOOP;
    UPDATE public.org_staff s SET expiration_date=saved_expiry WHERE s.id=member_id;
    IF NOT has_function_privilege('aka_agent_chat_api','public.aka_agent_staff_time_allowed(bigint)','EXECUTE') THEN RAISE EXCEPTION 'Chat runtime cannot call staff guard'; END IF;
  END;

  UPDATE public.org_organization_product p SET expiration_date=(today-1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE p.organization_id=org_id;
  IF public.aka_agent_staff_management_row(member_id)->>'status'<>'expired' THEN RAISE EXCEPTION 'package shorter than staff'; END IF;
  UPDATE public.org_staff s SET is_admin=false WHERE s.id=actor_id;
  BEGIN PERFORM public.aka_agent_staff_management(actor_id,username,'123456','list','{}'); RAISE EXCEPTION 'revoked admin accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_access_denied' THEN RAISE; END IF; END;
  IF has_function_privilege('anon','public.aka_agent_staff_management_row(bigint)','EXECUTE') OR has_table_privilege('anon','public.auto_staff_management_requests','SELECT') THEN RAISE EXCEPTION 'private data ACL'; END IF;
  IF NOT has_function_privilege('anon','public.aka_agent_staff_management(bigint,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public RPC inaccessible'; END IF;
END;

$smoke$;
SELECT 'passed' AS staff_management_and_legacy_runtime;
ROLLBACK;
