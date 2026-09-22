-- v308: department managers in Desktop, using Chat's single-manager business rule.
-- Source: exact live definitions/attributes captured on cgjbsmqtfhqvttudyjzq.
-- Additive JSON only; retain signatures, ACL, expiry, root, CAS and device replay guards.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$ DECLARE r record; BEGIN
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,
      'proconfig',proconfig,'proacl',proacl::text,'result_type',pg_get_function_result(oid)) attrs
    INTO r FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management_row(bigint)');
  IF NOT FOUND OR r.checksum NOT IN ('9e5db7f61b5768852c8dece5f6e6aebe','e4d06c369e7c05e29c69ce089e549da6') OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "prosecdef": true, "provolatile": "s", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,service_role=X/postgres}", "result_type": "jsonb"}'::jsonb THEN
    RAISE EXCEPTION 'v308 preflight definition/attribute drift: aka_agent_staff_management_row(bigint)';
  END IF;
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,
      'proconfig',proconfig,'proacl',proacl::text,'result_type',pg_get_function_result(oid)) attrs
    INTO r FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)');
  IF NOT FOUND OR r.checksum NOT IN ('182c5e461d34e1028e5c6e19e32abe00','fe73d8c5812d395aa2d3a1d448418ef0') OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "prosecdef": true, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}", "result_type": "jsonb"}'::jsonb THEN
    RAISE EXCEPTION 'v308 preflight definition/attribute drift: aka_agent_staff_management(bigint,text,text,text,jsonb)';
  END IF;
END; $preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_management_row(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone,'username',s.username,
    'isAdmin',s.is_admin IS TRUE,'isActive',s.is_active,'createdAt',s.created_at,
    'expirationDate',s.expiration_date,'effectiveExpirationDate',e.expires,
    'expirySource',CASE WHEN o.use_organization_expiration OR s.expiration_date IS NULL THEN 'organization' ELSE 'staff' END,
    'status',CASE WHEN NOT s.is_active THEN 'locked' WHEN e.expires IS NULL OR timezone('Asia/Ho_Chi_Minh',e.expires)::date < timezone('Asia/Ho_Chi_Minh',now())::date THEN 'expired' ELSE 'active' END,
    'daysRemaining',greatest(0,timezone('Asia/Ho_Chi_Minh',e.expires)::date-timezone('Asia/Ho_Chi_Minh',now())::date),
    'groupIds',coalesce(g.ids,'[]'::jsonb),'groupNames',coalesce(g.names,'[]'::jsonb),
    'managerGroupIds',coalesce(g.manager_ids,'[]'::jsonb),
    'version',s.xmin::text||':'||md5(coalesce(g.revision,'')))
  FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id
  LEFT JOIN LATERAL (SELECT max(p.expiration_date) expires FROM public.org_organization_product p
    WHERE p.organization_id=s.organization_id AND NOT p.is_deleted AND p.product_id IN (3,10,13,16,17,18)) p ON true
  CROSS JOIN LATERAL (SELECT CASE WHEN o.use_organization_expiration OR s.expiration_date IS NULL THEN p.expires
    WHEN p.expires IS NULL THEN NULL ELSE least(s.expiration_date,p.expires) END expires) e
  LEFT JOIN LATERAL (SELECT jsonb_agg(g.id ORDER BY g.id) ids,jsonb_agg(g.name ORDER BY g.id) names,
    jsonb_agg(g.id ORDER BY g.id) FILTER (WHERE gs.is_admin IS TRUE) manager_ids,
    string_agg(gs.id::text||':'||gs.group_id::text||':'||gs.is_admin::text,',' ORDER BY gs.id) revision
    FROM public.org_group_staff gs JOIN public.org_group g ON g.id=gs.group_id AND g.organization_id=s.organization_id
    WHERE gs.staff_id=s.id AND gs.organization_id=s.organization_id) g ON true
  WHERE s.id=p_id AND s.deleted_at IS NULL;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_management(p_actor_id bigint, p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '12s'
AS $function$
#variable_conflict use_variable
DECLARE
  actor public.org_staff%ROWTYPE; org public.org_organization%ROWTYPE;
  target public.org_staff%ROWTYPE; grp public.org_group%ROWTYPE;
  request public.auto_staff_management_requests%ROWTYPE;
  result jsonb; obj jsonb; ids bigint[]; id bigint; parent_id bigint; group_id bigint;
  request_id uuid; revision text; phone text; label text; allowed text[];
  root_id bigint; root_count integer;
  mutation boolean; total bigint; offset_rows integer; group_ids bigint[]; stamp timestamptz:=clock_timestamp();
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('list','saveGroup','saveStaff','setStatus','revealPassword','prepareDevices','resetDevices') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
  allowed:=CASE p_action
    WHEN 'list' THEN ARRAY['search','groupId','status','page']
    WHEN 'saveGroup' THEN ARRAY['id','name','parentId','expectedVersion','requestId']
    WHEN 'saveStaff' THEN ARRAY['id','name','phone','groupId','isDepartmentManager','expectedVersion','requestId']
    WHEN 'setStatus' THEN ARRAY['targets','isActive','requestId']
    WHEN 'revealPassword' THEN ARRAY['id']
    WHEN 'prepareDevices' THEN ARRAY['ids']
    ELSE ARRAY['targets','requestId'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
  SELECT s.* INTO actor FROM public.org_staff s WHERE s.id=p_actor_id AND s.username=p_username AND s.password=p_password;
  IF NOT FOUND OR actor.is_admin IS NOT TRUE OR NOT public.aka_agent_staff_time_allowed(actor.id) THEN RAISE EXCEPTION 'staff_access_denied'; END IF;
  mutation:=p_action IN ('saveGroup','saveStaff','setStatus','resetDevices');
  IF mutation THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-staff-management:'||actor.organization_id::text,0));
    IF p_action IN ('saveGroup','saveStaff') THEN
      -- Share Chat's organization lock before actor/group/staff rows, including manager replacement.
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-chat:workspace-staff:'||actor.organization_id::text,0));
    END IF;
  END IF;
  -- Revalidate after waiting. Keep the authorizing row locked through commit.
  SELECT s.* INTO actor FROM public.org_staff s WHERE s.id=p_actor_id AND s.username=p_username AND s.password=p_password FOR SHARE;
  IF NOT FOUND OR actor.is_admin IS NOT TRUE OR NOT public.aka_agent_staff_time_allowed(actor.id) THEN RAISE EXCEPTION 'staff_access_denied'; END IF;
  SELECT o.* INTO STRICT org FROM public.org_organization o WHERE o.id=actor.organization_id FOR SHARE;
  IF mutation THEN
    request_id:=(p_data->>'requestId')::uuid;
    IF request_id IS NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    SELECT * INTO request FROM public.auto_staff_management_requests WHERE auto_staff_management_requests.request_id=request_id;
    IF FOUND THEN
      IF request.actor_id<>actor.id OR request.organization_id<>org.id OR request.action<>p_action OR request.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      RETURN request.result;
    END IF;
  END IF;

  IF p_action='list' THEN
    IF length(coalesce(p_data->>'search',''))>200 OR coalesce(p_data->>'status','all') NOT IN ('all','active','locked','expired') THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    offset_rows:=greatest(0,coalesce((p_data->>'page')::integer,0))*100;
    group_id:=(p_data->>'groupId')::bigint;
    IF group_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.org_group WHERE org_group.id=group_id AND organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
      WITH RECURSIVE tree AS (SELECT g.id FROM public.org_group g WHERE g.id=group_id AND g.organization_id=org.id
        UNION SELECT g.id FROM public.org_group g JOIN tree t ON g.parent_id=t.id WHERE g.organization_id=org.id)
      SELECT array_agg(t.id) INTO group_ids FROM tree t;
    END IF;
    WITH rows AS MATERIALIZED (SELECT public.aka_agent_staff_management_row(s.id) row FROM public.org_staff s
      WHERE s.organization_id=org.id AND s.deleted_at IS NULL
      AND (coalesce(p_data->>'search','')='' OR strpos(lower(s.name||' '||s.phone||' '||s.username),lower(p_data->>'search'))>0)
      AND (group_id IS NULL OR EXISTS (SELECT 1 FROM public.org_group_staff gs WHERE gs.staff_id=s.id AND gs.organization_id=org.id AND gs.group_id=ANY(group_ids)))),
    filtered AS (SELECT row FROM rows WHERE coalesce(p_data->>'status','all')='all' OR row->>'status'=p_data->>'status'),
    page AS (SELECT row FROM filtered ORDER BY (row->>'id')::bigint OFFSET offset_rows LIMIT 100)
    SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(row ORDER BY (row->>'id')::bigint) FROM page),'[]'::jsonb),
      'total',(SELECT count(*) FROM filtered),'page',offset_rows/100) INTO result;
    SELECT count(*) INTO total FROM public.org_staff s WHERE s.organization_id=org.id AND s.deleted_at IS NULL;
    result:=result||jsonb_build_object('organization',jsonb_build_object('id',org.id,'name',org.name,'maxStaff',org.max_staff,
      'staffCount',total,'staffDurationDays',coalesce(org.staff_duration_days,365),'useOrganizationExpiration',org.use_organization_expiration,
      'expirationDate',(SELECT max(p.expiration_date) FROM public.org_organization_product p WHERE p.organization_id=org.id AND NOT p.is_deleted AND p.product_id IN (3,10,13,16,17,18)),
      'today',timezone('Asia/Ho_Chi_Minh',stamp)::date),
      'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'parentId',g.parent_id,'version',g.xmin::text,
        'managers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) ORDER BY m.id)
          FROM public.org_staff m WHERE m.organization_id=org.id AND m.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM public.org_group_staff gm WHERE gm.group_id=g.id AND gm.organization_id=org.id AND gm.staff_id=m.id AND gm.is_admin IS TRUE)),'[]'::jsonb),
        'staffCount',(SELECT count(DISTINCT gs.staff_id) FROM public.org_group_staff gs JOIN public.org_staff s ON s.id=gs.staff_id
          WHERE gs.group_id=g.id AND gs.organization_id=org.id AND s.organization_id=org.id AND s.deleted_at IS NULL)) ORDER BY g.id)
        FROM public.org_group g WHERE g.organization_id=org.id),'[]'::jsonb));

  ELSIF p_action='saveGroup' THEN
    id:=(p_data->>'id')::bigint; parent_id:=(p_data->>'parentId')::bigint; label:=btrim(p_data->>'name');
    IF label IS NULL OR length(label) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    SELECT count(*),min(g.id) INTO root_count,root_id FROM public.org_group g WHERE g.organization_id=org.id AND g.parent_id IS NULL;
    IF root_count>1 THEN RAISE EXCEPTION 'staff_group_multiple_roots'; END IF;
    IF root_id IS NULL THEN
      INSERT INTO public.org_group(organization_id,name,parent_id) VALUES(org.id,org.name,NULL) RETURNING org_group.id INTO root_id;
    END IF;
    -- NULL is the legacy Desktop value for 'directly under the organization'.
    parent_id:=coalesce(parent_id,root_id);
    IF parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=parent_id AND g.organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF id IS NOT NULL THEN
      SELECT * INTO grp FROM public.org_group g WHERE g.id=id AND g.organization_id=org.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
      IF grp.parent_id IS NULL THEN RAISE EXCEPTION 'staff_group_root_read_only'; END IF;
      SELECT g.xmin::text INTO revision FROM public.org_group g WHERE g.id=id;
      IF revision IS DISTINCT FROM p_data->>'expectedVersion' THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      IF parent_id IS NOT NULL AND EXISTS (WITH RECURSIVE descendants AS (
        SELECT g.id FROM public.org_group g WHERE g.id=id AND g.organization_id=org.id
        UNION SELECT g.id FROM public.org_group g JOIN descendants d ON g.parent_id=d.id WHERE g.organization_id=org.id)
        SELECT 1 FROM descendants d WHERE d.id=parent_id) THEN RAISE EXCEPTION 'staff_group_cycle'; END IF;
      UPDATE public.org_group g SET name=label,parent_id=save_parent.parent_id,updated_at=stamp
        FROM (SELECT parent_id) save_parent WHERE g.id=id;
    ELSE
      INSERT INTO public.org_group(organization_id,name,parent_id) VALUES(org.id,label,parent_id) RETURNING org_group.id INTO id;
    END IF;
    result:=jsonb_build_object('id',id);

  ELSIF p_action='saveStaff' THEN
    id:=(p_data->>'id')::bigint;group_id:=(p_data->>'groupId')::bigint;label:=btrim(p_data->>'name');phone:=public.normalize_phone(p_data->>'phone');
    IF label IS NULL OR length(label) NOT BETWEEN 1 AND 200 OR phone IS NULL OR phone !~ '^0[0-9]{9,10}$' OR group_id IS NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    IF p_data ? 'isDepartmentManager' AND jsonb_typeof(p_data->'isDepartmentManager') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=group_id AND g.organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF EXISTS(SELECT 1 FROM public.org_staff s WHERE s.organization_id=org.id AND public.normalize_phone(s.phone)=phone AND (id IS NULL OR s.id<>id)) THEN RAISE EXCEPTION 'staff_phone_exists'; END IF;
    IF id IS NULL THEN
      SELECT count(*) INTO total FROM public.org_staff s WHERE s.organization_id=org.id AND s.deleted_at IS NULL;
      IF total>=org.max_staff THEN RAISE EXCEPTION 'staff_quota_full'; END IF;
      INSERT INTO public.org_staff(organization_id,name,phone,username,password,is_active,is_admin,created_at,updated_at,expiration_date)
      VALUES(org.id,label,phone,org.id::text||'.'||phone,'123456',true,false,stamp,stamp,
        (timezone('Asia/Ho_Chi_Minh',stamp)::date+coalesce(org.staff_duration_days,365)+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      RETURNING org_staff.id INTO id;
    ELSE
      SELECT * INTO target FROM public.org_staff s WHERE s.id=id AND s.organization_id=org.id AND s.deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
      IF public.aka_agent_staff_management_row(id)->>'version' IS DISTINCT FROM p_data->>'expectedVersion' THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      UPDATE public.org_staff s SET name=label,phone=save_phone.phone,updated_at=stamp FROM (SELECT phone) save_phone WHERE s.id=id;
    END IF;
    DELETE FROM public.org_group_staff gs WHERE gs.staff_id=id AND gs.organization_id=org.id AND gs.group_id<>group_id;
    IF NOT EXISTS(SELECT 1 FROM public.org_group_staff gs WHERE gs.staff_id=id AND gs.organization_id=org.id AND gs.group_id=group_id) THEN
      INSERT INTO public.org_group_staff(organization_id,staff_id,group_id,is_admin) VALUES(org.id,id,group_id,false);
    END IF;
    -- Optional for legacy clients: omission keeps the previous membership behavior.
    -- Explicit true replaces every current manager of the chosen department, as Chat does.
    IF p_data ? 'isDepartmentManager' THEN
      IF (p_data->>'isDepartmentManager')::boolean THEN
        UPDATE public.org_group_staff gs SET is_admin=false
          WHERE gs.organization_id=org.id AND gs.group_id=group_id AND gs.staff_id<>id AND gs.is_admin IS TRUE;
      END IF;
      UPDATE public.org_group_staff gs SET is_admin=(p_data->>'isDepartmentManager')::boolean
        WHERE gs.organization_id=org.id AND gs.group_id=group_id AND gs.staff_id=id
          AND gs.is_admin IS DISTINCT FROM (p_data->>'isDepartmentManager')::boolean;
    END IF;
    result:=public.aka_agent_staff_management_row(id);

  ELSIF p_action='revealPassword' THEN
    SELECT s.password INTO revision FROM public.org_staff s WHERE s.id=(p_data->>'id')::bigint AND s.organization_id=org.id AND s.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    result:=jsonb_build_object('password',revision);

  ELSE
    IF p_action='prepareDevices' THEN
      IF jsonb_typeof(p_data->'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
      SELECT array_agg(DISTINCT value::bigint ORDER BY value::bigint) INTO ids FROM jsonb_array_elements_text(p_data->'ids');
    ELSE
      IF jsonb_typeof(p_data->'targets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
      SELECT array_agg(DISTINCT (value->>'id')::bigint ORDER BY (value->>'id')::bigint) INTO ids FROM jsonb_array_elements(p_data->'targets');
    END IF;
    IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    IF p_action='prepareDevices' THEN
      PERFORM s.id FROM public.org_staff s WHERE s.id=ANY(ids) AND s.organization_id=org.id ORDER BY s.id FOR SHARE;
    ELSE
      PERFORM s.id FROM public.org_staff s WHERE s.id=ANY(ids) AND s.organization_id=org.id ORDER BY s.id FOR UPDATE;
    END IF;
    IF (SELECT count(*) FROM public.org_staff s WHERE s.id=ANY(ids) AND s.organization_id=org.id AND s.deleted_at IS NULL)<>cardinality(ids) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF p_action='prepareDevices' THEN
      SELECT jsonb_build_object('items',jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'username',s.username,
        'version',s.xmin::text,'isBound',s.aka_agent_device_fingerprint_hash IS NOT NULL,
        'label',presence.device_label,'platform',presence.device_platform,'lastSeenAt',presence.last_seen_at) ORDER BY s.id)) INTO result
      FROM public.org_staff s LEFT JOIN LATERAL (SELECT p.device_label,p.device_platform,p.last_seen_at FROM public.auto_staff_device_presence p
        WHERE p.staff_id=s.id AND p.organization_id=org.id ORDER BY p.last_seen_at DESC LIMIT 1) presence ON true WHERE s.id=ANY(ids);
    ELSE
      IF jsonb_array_length(p_data->'targets')<>cardinality(ids) THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
      FOR obj IN SELECT value FROM jsonb_array_elements(p_data->'targets') LOOP
        IF jsonb_typeof(obj) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(obj) k WHERE k NOT IN ('id','expectedVersion')) THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
        IF (obj->>'id')::bigint IS NULL OR obj->>'expectedVersion' IS NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
        IF p_action='setStatus' THEN revision:=public.aka_agent_staff_management_row((obj->>'id')::bigint)->>'version';
        ELSE SELECT s.xmin::text INTO revision FROM public.org_staff s WHERE s.id=(obj->>'id')::bigint; END IF;
        IF revision IS DISTINCT FROM obj->>'expectedVersion' THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      END LOOP;
      IF p_action='setStatus' THEN
        IF jsonb_typeof(p_data->'isActive') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
        IF NOT (p_data->>'isActive')::boolean AND (actor.id=ANY(ids) OR NOT EXISTS(SELECT 1 FROM public.org_staff s
          WHERE s.organization_id=org.id AND s.is_admin IS TRUE AND s.is_active AND s.deleted_at IS NULL AND NOT s.id=ANY(ids))) THEN RAISE EXCEPTION 'staff_admin_required'; END IF;
        UPDATE public.org_staff s SET is_active=(p_data->>'isActive')::boolean,updated_at=stamp WHERE s.id=ANY(ids);
      ELSE
        UPDATE public.org_staff s SET aka_agent_device_fingerprint_hash=NULL,updated_at=stamp
          WHERE s.id=ANY(ids) AND s.aka_agent_device_fingerprint_hash IS NOT NULL;
      END IF;
      result:=jsonb_build_object('count',cardinality(ids));
    END IF;
  END IF;
  IF mutation THEN
    INSERT INTO public.auto_staff_management_requests(request_id,actor_id,organization_id,action,payload,result)
      VALUES(request_id,actor.id,org.id,p_action,p_data,result);
  END IF;
  RETURN result;
END;
$function$
;

DO $postflight$ DECLARE r record; BEGIN
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,
      'proconfig',proconfig,'proacl',proacl::text,'result_type',pg_get_function_result(oid)) attrs
    INTO r FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management_row(bigint)');
  IF NOT FOUND OR r.checksum NOT IN ('e4d06c369e7c05e29c69ce089e549da6') OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "prosecdef": true, "provolatile": "s", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,service_role=X/postgres}", "result_type": "jsonb"}'::jsonb THEN
    RAISE EXCEPTION 'v308 postflight definition/attribute drift: aka_agent_staff_management_row(bigint)';
  END IF;
  SELECT md5(pg_get_functiondef(oid)) checksum,
    jsonb_build_object('owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,
      'proconfig',proconfig,'proacl',proacl::text,'result_type',pg_get_function_result(oid)) attrs
    INTO r FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)');
  IF NOT FOUND OR r.checksum NOT IN ('fe73d8c5812d395aa2d3a1d448418ef0') OR r.attrs IS DISTINCT FROM '{"owner": "postgres", "prosecdef": true, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}", "result_type": "jsonb"}'::jsonb THEN
    RAISE EXCEPTION 'v308 postflight definition/attribute drift: aka_agent_staff_management(bigint,text,text,text,jsonb)';
  END IF;
END; $postflight$;
-- Function result types/API metadata stay unchanged; no explicit PostgREST reload.
COMMIT;
