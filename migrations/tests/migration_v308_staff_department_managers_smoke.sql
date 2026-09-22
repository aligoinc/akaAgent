-- Synthetic fixtures only. Validates manager permissions and old Desktop payloads.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  customer_id bigint; org_id bigint; other_org bigint; actor_id bigint; username text;
  root_id bigint; sales_id bigint; support_id bigint; foreign_group bigint;
  alice_id bigint; bob_id bigint; cara_id bigint; membership_id bigint; lock_key bigint;
  alice jsonb; bob jsonb; cara jsonb; r jsonb; payload jsonb; replay_payload jsonb; replay_result jsonb; invalid jsonb;
BEGIN
  INSERT INTO public.aka_customer(name) VALUES('__staff_v308_rollback__') RETURNING aka_customer.id INTO customer_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__staff_v308_rollback__','0999999380',6,s.id,s.id FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING org_organization.id INTO org_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__staff_v308_foreign__','0999999389',6,s.id,s.id FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING org_organization.id INTO other_org;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin) VALUES(org_id,'Admin fixture','0999999380',true) RETURNING org_staff.id,org_staff.username INTO actor_id,username;
  INSERT INTO public.org_group(organization_id,name) VALUES(other_org,'Foreign') RETURNING org_group.id INTO foreign_group;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('name','Sales','parentId',NULL,'requestId',gen_random_uuid())); sales_id:=(r->>'id')::bigint;
  SELECT id INTO STRICT root_id FROM public.org_group WHERE organization_id=org_id AND parent_id IS NULL;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('name','Support','parentId',root_id,'requestId',gen_random_uuid())); support_id:=(r->>'id')::bigint;
  EXECUTE 'SET LOCAL ROLE anon';
  alice:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Alice','phone','0999999381','groupId',sales_id,'isDepartmentManager',true,'requestId',gen_random_uuid()));
  EXECUTE 'RESET ROLE';
  alice_id:=(alice->>'id')::bigint;
  IF alice->'managerGroupIds' IS DISTINCT FROM jsonb_build_array(sales_id) OR alice->>'isAdmin' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'manager create/admin separation failed'; END IF;
  bob:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Bob','phone','0999999382','groupId',sales_id,'isDepartmentManager',false,'requestId',gen_random_uuid())); bob_id:=(bob->>'id')::bigint;
  cara:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Cara','phone','0999999383','groupId',support_id,'isDepartmentManager',true,'requestId',gen_random_uuid())); cara_id:=(cara->>'id')::bigint;
  IF bob->'managerGroupIds' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'ordinary staff acquired manager'; END IF;
  r:=public.aka_agent_staff_management(actor_id,username,'123456','list',jsonb_build_object('search','Bob'));
  IF r->>'total' IS DISTINCT FROM '1' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'groups') g WHERE (g->>'id')::bigint=sales_id AND g->'managers'=jsonb_build_array(jsonb_build_object('id',alice_id,'name','Alice'))) THEN RAISE EXCEPTION 'manager metadata depends on staff page/filter'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'groups') g WHERE (g->>'id')::bigint=foreign_group) OR (r->'items'->0) ? 'password' THEN RAISE EXCEPTION 'tenant/secret leak'; END IF;
  BEGIN
    PERFORM public.aka_agent_staff_management(alice_id,alice->>'username','123456','list','{}');
    RAISE EXCEPTION 'manager granted organization admin';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_access_denied' THEN RAISE; END IF; END;
  SELECT id INTO STRICT membership_id FROM public.org_group_staff WHERE staff_id=bob_id AND group_id=sales_id;
  replay_payload:=jsonb_build_object('id',bob_id,'name','Bob','phone','0999999382','groupId',sales_id,'isDepartmentManager',true,'expectedVersion',bob->>'version','requestId',gen_random_uuid());
  replay_result:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',replay_payload);
  IF (SELECT count(*) FROM public.org_group_staff WHERE organization_id=org_id AND group_id=sales_id AND is_admin IS TRUE)<>1
    OR NOT EXISTS(SELECT 1 FROM public.org_group_staff WHERE id=membership_id AND is_admin IS TRUE)
    OR public.aka_agent_staff_management_row(alice_id)->'managerGroupIds' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'manager replacement or membership preservation failed'; END IF;
  BEGIN
    PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',alice_id,'name','Stale Alice','phone','0999999381','groupId',sales_id,'isDepartmentManager',true,'expectedVersion',alice->>'version','requestId',gen_random_uuid()));
    RAISE EXCEPTION 'manager replacement did not invalidate old staff revision';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_conflict' THEN RAISE; END IF; END;
  alice:=public.aka_agent_staff_management_row(alice_id);
  alice:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',alice_id,'name','Alice','phone','0999999381','groupId',sales_id,'isDepartmentManager',true,'expectedVersion',alice->>'version','requestId',gen_random_uuid()));
  IF public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',replay_payload) IS DISTINCT FROM replay_result
    OR public.aka_agent_staff_management_row(bob_id)->'managerGroupIds' IS DISTINCT FROM '[]'::jsonb
    OR public.aka_agent_staff_management_row(alice_id)->'managerGroupIds' IS DISTINCT FROM jsonb_build_array(sales_id) THEN RAISE EXCEPTION 'retry replaced a newer manager'; END IF;
  -- A manager moved with the explicit true flag replaces the destination manager.
  alice:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',alice_id,'name','Alice','phone','0999999381','groupId',support_id,'isDepartmentManager',true,'expectedVersion',alice->>'version','requestId',gen_random_uuid()));
  IF alice->'groupIds' IS DISTINCT FROM jsonb_build_array(support_id) OR alice->'managerGroupIds' IS DISTINCT FROM jsonb_build_array(support_id)
    OR public.aka_agent_staff_management_row(cara_id)->'managerGroupIds' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'manager transfer failed'; END IF;
  -- Old payload without the new key preserves manager on the same relationship.
  alice:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',alice_id,'name','Alice renamed','phone','0999999381','groupId',support_id,'expectedVersion',alice->>'version','requestId',gen_random_uuid()));
  IF alice->'managerGroupIds' IS DISTINCT FROM jsonb_build_array(support_id) THEN RAISE EXCEPTION 'legacy same-department save lost manager'; END IF;
  -- Explicit false demotes but retains the selected department.
  alice:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',alice_id,'name','Alice renamed','phone','0999999381','groupId',support_id,'isDepartmentManager',false,'expectedVersion',alice->>'version','requestId',gen_random_uuid()));
  IF alice->'managerGroupIds' IS DISTINCT FROM '[]'::jsonb OR alice->'groupIds' IS DISTINCT FROM jsonb_build_array(support_id) THEN RAISE EXCEPTION 'demotion changed department'; END IF;
  alice:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',alice_id,'name','Alice renamed','phone','0999999381','groupId',support_id,'isDepartmentManager',true,'expectedVersion',alice->>'version','requestId',gen_random_uuid()));
  alice:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',alice_id,'name','Alice renamed','phone','0999999381','groupId',sales_id,'expectedVersion',alice->>'version','requestId',gen_random_uuid()));
  IF alice->'managerGroupIds' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'legacy transfer unexpectedly acquired manager'; END IF;
  -- Root department is allowed, just as in Chat.
  bob:=public.aka_agent_staff_management_row(bob_id);
  bob:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('id',bob_id,'name','Bob','phone','0999999382','groupId',root_id,'isDepartmentManager',true,'expectedVersion',bob->>'version','requestId',gen_random_uuid()));
  IF bob->'managerGroupIds' IS DISTINCT FROM jsonb_build_array(root_id) OR bob->>'username' IS DISTINCT FROM org_id::text||'.0999999382' OR bob->>'isAdmin' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'root manager/immutable identity failed'; END IF;
  FOREACH invalid IN ARRAY ARRAY['null'::jsonb,'"true"'::jsonb,'1'::jsonb] LOOP
    BEGIN
      PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Invalid','phone','0999999384','groupId',sales_id,'isDepartmentManager',invalid,'requestId',gen_random_uuid()));
      RAISE EXCEPTION 'invalid manager flag accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_invalid_input' THEN RAISE; END IF; END;
  END LOOP;
  BEGIN
    PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Foreign','phone','0999999384','groupId',foreign_group,'isDepartmentManager',true,'requestId',gen_random_uuid()));
    RAISE EXCEPTION 'foreign department accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_not_found' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.org_staff WHERE organization_id=org_id AND is_admin IS TRUE)<>1 THEN RAISE EXCEPTION 'department manager changed organization admin'; END IF;
  lock_key:=hashtextextended('aka-agent-chat:workspace-staff:'||org_id::text,0);
  IF NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted AND objsubid=1
    AND classid::bigint=((lock_key >> 32) & 4294967295) AND objid::bigint=(lock_key & 4294967295)) THEN RAISE EXCEPTION 'Chat staff mutation lock missing'; END IF;
END; $smoke$;
SELECT 'PASS v308 manager create/replace/transfer/demotion, admin isolation, filtered metadata, CAS/retry, legacy payload, root and tenant guards' AS result;
ROLLBACK;
