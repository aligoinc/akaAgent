-- Synthetic fixtures; all rows roll back. Run after v307 (or in its pre-apply rollback).
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  customer_id bigint; org_id bigint; actor_id bigint; username text;
  root_id bigint; department_id bigint; nested_id bigint; staff_id bigint; root_revision text;
  response jsonb; payload jsonb; before_memberships jsonb; after_memberships jsonb; lock_key bigint;
BEGIN
  INSERT INTO public.aka_customer(name) VALUES('__staff_v307_rollback__') RETURNING aka_customer.id INTO customer_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__staff_v307_rollback__','0999999309',5,s.id,s.id FROM public.org_staff s WHERE s.organization_id=1 AND s.is_admin IS TRUE LIMIT 1 RETURNING org_organization.id INTO org_id;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin) VALUES(org_id,'Root admin fixture','0999999309',true) RETURNING org_staff.id,org_staff.username INTO actor_id,username;
  -- Old Desktop's NULL parent must create one canonical organization root plus its actual department.
  payload:=jsonb_build_object('name','Sales','parentId',NULL,'requestId',gen_random_uuid());
  EXECUTE 'SET LOCAL ROLE anon';
  response:=public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',payload);
  EXECUTE 'RESET ROLE';
  department_id:=(response->>'id')::bigint;
  SELECT g.id,g.xmin::text INTO STRICT root_id,root_revision FROM public.org_group g WHERE g.organization_id=org_id AND g.parent_id IS NULL;
  IF NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=root_id AND g.name='__staff_v307_rollback__')
    OR NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=department_id AND g.name='Sales' AND g.parent_id=root_id) THEN RAISE EXCEPTION 'canonical root/child creation failed'; END IF;
  IF public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',payload) IS DISTINCT FROM response THEN RAISE EXCEPTION 'group request replay failed'; END IF;
  IF (SELECT count(*) FROM public.org_group g WHERE g.organization_id=org_id)<>2 THEN RAISE EXCEPTION 'group replay duplicated rows'; END IF;
  lock_key:=hashtextextended('aka-agent-chat:workspace-staff:'||org_id::text,0);
  IF NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted AND objsubid=1
    AND classid::bigint=((lock_key >> 32) & 4294967295) AND objid::bigint=(lock_key & 4294967295)) THEN RAISE EXCEPTION 'Chat root creation lock missing'; END IF;
  response:=public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('name','Nested','parentId',department_id,'requestId',gen_random_uuid()));
  nested_id:=(response->>'id')::bigint;
  response:=public.aka_agent_staff_management(actor_id,username,'123456','saveStaff',jsonb_build_object('name','Root staff','phone','0999999310','groupId',root_id,'requestId',gen_random_uuid()));
  staff_id:=(response->>'id')::bigint;
  IF response->'groupIds'<>jsonb_build_array(root_id) THEN RAISE EXCEPTION 'staff at organization root failed'; END IF;
  SELECT jsonb_agg(to_jsonb(gs) ORDER BY gs.id) INTO before_memberships FROM public.org_group_staff gs WHERE gs.organization_id=org_id;
  SELECT g.xmin::text INTO root_revision FROM public.org_group g WHERE g.id=nested_id;
  -- Moving an existing department to 'organization' must still retain a non-NULL parent.
  PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('id',nested_id,'name','Moved','parentId',NULL,'expectedVersion',root_revision,'requestId',gen_random_uuid()));
  IF NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=nested_id AND g.parent_id=root_id) THEN RAISE EXCEPTION 'department moved outside canonical root'; END IF;
  SELECT jsonb_agg(to_jsonb(gs) ORDER BY gs.id) INTO after_memberships FROM public.org_group_staff gs WHERE gs.organization_id=org_id;
  IF after_memberships IS DISTINCT FROM before_memberships THEN RAISE EXCEPTION 'group reparent changed memberships'; END IF;
  BEGIN
    PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('id',nested_id,'name','Stale','parentId',root_id,'expectedVersion','stale','requestId',gen_random_uuid()));
    RAISE EXCEPTION 'stale group edit accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_conflict' THEN RAISE; END IF; END;
  SELECT g.xmin::text INTO root_revision FROM public.org_group g WHERE g.id=root_id;
  BEGIN
    PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('id',root_id,'name','Changed root','parentId',department_id,'expectedVersion',root_revision,'requestId',gen_random_uuid()));
    RAISE EXCEPTION 'root edit accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_group_root_read_only' THEN RAISE; END IF; END;
  INSERT INTO public.org_group(organization_id,name) VALUES(org_id,'Invalid second root');
  BEGIN
    PERFORM public.aka_agent_staff_management(actor_id,username,'123456','saveGroup',jsonb_build_object('name','Must not create','parentId',NULL,'requestId',gen_random_uuid()));
    RAISE EXCEPTION 'ambiguous roots accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staff_group_multiple_roots' THEN RAISE; END IF; END;
  IF EXISTS(SELECT 1 FROM public.org_group g WHERE g.organization_id=org_id AND g.name='Must not create') THEN RAISE EXCEPTION 'failed root guard wrote group'; END IF;
END; $smoke$;
SELECT 'PASS v307 canonical root, legacy NULL parent, root staff, move/CAS, membership preservation, root guard, replay and Chat lock' AS result;
ROLLBACK;
