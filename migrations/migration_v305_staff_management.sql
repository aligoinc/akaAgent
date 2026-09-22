-- v305: tenant staff management and additive staff expiration.

-- Sources captured from linked akachat; never reconstructed from old migrations.

BEGIN;

SET LOCAL lock_timeout = '3s';

SET LOCAL statement_timeout = '120s';

DO $preflight$

DECLARE r record; p record;

BEGIN

  FOR r IN SELECT * FROM (VALUES ('aka_agent_admin_assert_access(bigint,text,text)','1644f95929edee967b02b51b1b785b0e','1644f95929edee967b02b51b1b785b0e','{"owner": "postgres", "prosecdef": true, "provolatile": "s", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres}"}'::jsonb),
    ('aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)','405ad2d62315e504c5ed998cfd22f0b4','8ea465944efda08fb2e89da9589e065a','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)','15517ca7d3dd7af4bf1bd46f4e9cf653','b721f2bf997eef62f72eaf5e2728fb8c','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])','698334ac50dcc485fbe4a825411df582','35d402155b69cc393621092d752605e5','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}"}'::jsonb),
    ('aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)','c822891785abb3fadf2576ec02b6b6f8','c822891785abb3fadf2576ec02b6b6f8','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}"}'::jsonb),
    ('aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])','b4c8813db5823e3867c6487e38263ff7','1d2e9fe42c493c523641741389496b5c','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=public"], "proacl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)','e65852b88d5d58994f305dcda9d8fc8a','5b849d4685b10d6446b4922ed70b0219','{"owner": "postgres", "prosecdef": false, "provolatile": "s", "proconfig": ["search_path=public"], "proacl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}"}'::jsonb),
    ('aka_agent_internal_require_staff_tenant(bigint,bigint)','3261f19ede3835caccc9cc425cbbc414','3261f19ede3835caccc9cc425cbbc414','{"owner": "postgres", "prosecdef": true, "provolatile": "s", "proconfig": ["search_path=public"], "proacl": "{postgres=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('aka_agent_prepare_device_change_v2(text)','28589c77ed8e440a0d8b6b4304e0311f','28589c77ed8e440a0d8b6b4304e0311f','{"owner": "postgres", "prosecdef": true, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)','dfc6d177499fbf9fc51526d7b9fba6f4','dfc6d177499fbf9fc51526d7b9fba6f4','{"owner": "postgres", "prosecdef": true, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public", "lock_timeout=3s"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('auto_assert_automation_identity(bigint,bigint,text,text)','5a9a503db72b965eb644739f5f60905d','5a9a503db72b965eb644739f5f60905d','{"owner": "postgres", "prosecdef": true, "provolatile": "s", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('claim_campaign_runtime(bigint,bigint,bigint,text)','e6b1889cda717cb0bea6f7d801633c75','02038a74bbd1238f276dee3109ae21cf','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=public"], "proacl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)','300b0873302bddc8f9db6ecf404eeeea','e590eca5b11f0b258309bcd13b01e6a6','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)','8fa70359975cb87d842310131438b2d4','4d23cf3365d335072c4fcb01e7942dd1','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)','78d5cdd05a02bdf3b78349e598e9d512','2f925040dd0bdc49725e0cebbf07c407','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=pg_catalog, public"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('discover_zalo_server_account_runtime_users(bigint,integer)','47fc86fdd6506bf1dbb8836569f792ab','e6c30bd94f312d1e181f936ac41bd026','{"owner": "postgres", "prosecdef": false, "provolatile": "s", "proconfig": ["search_path=public", "statement_timeout=60s"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('get_staff_zalo_account_capabilities(bigint)','29c273a8423689adfbeb62180ba3093f','6354ae2e66d0d7624e090750ac820a2b','{"owner": "postgres", "prosecdef": false, "provolatile": "s", "proconfig": ["search_path=pg_catalog, public, private"], "proacl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('get_staff_zalo_runtime_mode(bigint)','c4619e84b889125335078f3559feedd4','cf1fdfe5733240f9a52a0395e2cdefa1','{"owner": "postgres", "prosecdef": false, "provolatile": "s", "proconfig": ["search_path=public"], "proacl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('normalize_phone(text)','f6ccb574895043480e6523193f7be007','f6ccb574895043480e6523193f7be007','{"owner": "postgres", "prosecdef": false, "provolatile": "i", "proconfig": ["search_path=pg_catalog"], "proacl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb),
    ('set_staff_defaults()','140b74c234a2a71e9ae0455a888dc672','140b74c234a2a71e9ae0455a888dc672','{"owner": "postgres", "prosecdef": false, "provolatile": "v", "proconfig": ["search_path=public"], "proacl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}'::jsonb)) v(signature,source_hash,target_hash,attributes) LOOP

    SELECT md5(pg_get_functiondef(oid)) hash, jsonb_build_object('owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,'proconfig',proconfig,'proacl',proacl::text) attributes INTO p FROM pg_proc WHERE oid=to_regprocedure('public.'||r.signature);

    IF NOT FOUND OR p.hash NOT IN (r.source_hash,r.target_hash) OR p.attributes IS DISTINCT FROM r.attributes THEN RAISE EXCEPTION 'v305 dependency drift: %',r.signature; END IF;

  END LOOP;

  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_staff_time_allowed(bigint)'))) <> '878cba86a2426dae09bc9f69a163680e' THEN RAISE EXCEPTION 'v305 new function drift: aka_agent_staff_time_allowed(bigint)'; END IF;

  IF to_regprocedure('public.aka_agent_staff_access(bigint,text,text)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_staff_access(bigint,text,text)'))) <> '632942ca116ca830d4a7f5fff72e871f' THEN RAISE EXCEPTION 'v305 new function drift: aka_agent_staff_access(bigint,text,text)'; END IF;

  IF to_regprocedure('public.aka_agent_staff_management_row(bigint)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_staff_management_row(bigint)'))) <> '9e5db7f61b5768852c8dece5f6e6aebe' THEN RAISE EXCEPTION 'v305 new function drift: aka_agent_staff_management_row(bigint)'; END IF;

  IF to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)'))) <> 'b0fb02514a2b501b1e6d94d1122d330d' THEN RAISE EXCEPTION 'v305 new function drift: aka_agent_staff_management(bigint,text,text,text,jsonb)'; END IF;

END;

$preflight$;

DO $metadata_preflight$
DECLARE r record; a record; p record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('org_organization','staff_duration_days','integer',false,NULL::text),
    ('org_organization','use_organization_expiration','boolean',true,'false'),
    ('org_staff','expiration_date','timestamp with time zone',false,NULL::text)
  ) expected(table_name,column_name,type_name,not_null,default_expr) LOOP
    SELECT format_type(atttypid,atttypmod) type_name,attnotnull,
      pg_get_expr(d.adbin,d.adrelid) default_expr INTO a
    FROM pg_attribute attribute LEFT JOIN pg_attrdef d ON d.adrelid=attribute.attrelid AND d.adnum=attribute.attnum
    WHERE attribute.attrelid=to_regclass('public.'||r.table_name) AND attribute.attname=r.column_name AND NOT attribute.attisdropped;
    IF FOUND AND (a.type_name IS DISTINCT FROM r.type_name OR a.attnotnull IS DISTINCT FROM r.not_null OR a.default_expr IS DISTINCT FROM r.default_expr)
      THEN RAISE EXCEPTION 'v305 column drift: %.%',r.table_name,r.column_name; END IF;
  END LOOP;
  FOR p IN SELECT oid,proname,proowner,prosecdef,proacl FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('aka_agent_staff_time_allowed','aka_agent_staff_access','aka_agent_staff_management_row','aka_agent_staff_management') LOOP
    IF pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
      OR (p.proname<>'aka_agent_staff_time_allowed' AND EXISTS(SELECT 1 FROM aclexplode(p.proacl) acl WHERE acl.grantee=0))
      OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')
      OR has_function_privilege('anon',p.oid,'EXECUTE') IS DISTINCT FROM (p.proname<>'aka_agent_staff_management_row')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE') IS DISTINCT FROM (p.proname<>'aka_agent_staff_management_row')
    THEN RAISE EXCEPTION 'v305 new function ACL/owner drift: %',p.proname; END IF;
  END LOOP;
  IF to_regclass('public.auto_staff_management_requests') IS NOT NULL THEN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.auto_staff_management_requests'::regclass)
      OR has_table_privilege('anon','public.auto_staff_management_requests','SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated','public.auto_staff_management_requests','SELECT,INSERT,UPDATE,DELETE')
      OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.auto_staff_management_requests'::regclass)
      OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.auto_staff_management_requests'::regclass AND attnum>0 AND NOT attisdropped)<>7
    THEN RAISE EXCEPTION 'v305 ledger metadata drift'; END IF;
    FOR r IN SELECT * FROM (VALUES ('request_id','uuid'),('actor_id','bigint'),('organization_id','bigint'),('action','text'),('payload','jsonb'),('result','jsonb'),('created_at','timestamp with time zone')) expected(name,type_name) LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.auto_staff_management_requests'::regclass AND attname=r.name AND attnotnull AND format_type(atttypid,atttypmod)=r.type_name) THEN RAISE EXCEPTION 'v305 ledger column drift: %',r.name; END IF;
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.auto_staff_management_requests'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (request_id)') THEN RAISE EXCEPTION 'v305 ledger PK drift'; END IF;
  END IF;
END;
$metadata_preflight$;


-- Acquire in the staff -> organization order used by runtime guards, before any ALTER holds organization exclusively.
LOCK TABLE public.org_staff, public.org_organization IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.org_organization ADD COLUMN IF NOT EXISTS staff_duration_days integer;
ALTER TABLE public.org_organization ADD COLUMN IF NOT EXISTS use_organization_expiration boolean NOT NULL DEFAULT false;
DO $constraint$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.org_organization'::regclass AND conname='org_staff_duration_days_positive') THEN ALTER TABLE public.org_organization ADD CONSTRAINT org_staff_duration_days_positive CHECK (staff_duration_days IS NULL OR staff_duration_days > 0); END IF; END; $constraint$;
ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS expiration_date timestamptz;

-- Only new management mutations use this ledger. No credentials or device hashes.
CREATE TABLE IF NOT EXISTS public.auto_staff_management_requests (
  request_id uuid PRIMARY KEY,
  actor_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.auto_staff_management_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_staff_management_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auto_staff_management_requests TO service_role;

-- A boolean guard for existing SECURITY INVOKER runtime entrypoints. Product
-- entitlement checks remain in their existing owners. No state is changed.
CREATE OR REPLACE FUNCTION public.aka_agent_staff_time_allowed(p_staff_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public AS $function$
  SELECT coalesce((SELECT s.is_active AND s.deleted_at IS NULL AND
    (o.use_organization_expiration OR s.expiration_date IS NULL OR
      timezone('Asia/Ho_Chi_Minh',s.expiration_date)::date >= timezone('Asia/Ho_Chi_Minh',now())::date)
    FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id WHERE s.id=p_staff_id),false);
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_access(p_staff_id bigint,p_username text,p_password text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public AS $function$
DECLARE s public.org_staff%ROWTYPE; o public.org_organization%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.org_staff WHERE id=p_staff_id AND username=p_username AND password=p_password;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_auth_invalid'; END IF;
  SELECT * INTO STRICT o FROM public.org_organization WHERE id=s.organization_id;
  RETURN jsonb_build_object('isAdmin',s.is_admin IS TRUE AND s.is_active AND s.deleted_at IS NULL,
    'isActive',s.is_active AND s.deleted_at IS NULL,'timeAllowed',public.aka_agent_staff_time_allowed(s.id),
    'expirationDate',s.expiration_date,'useOrganizationExpiration',o.use_organization_expiration);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_management_row(p_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public AS $function$
  SELECT jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone,'username',s.username,
    'isAdmin',s.is_admin IS TRUE,'isActive',s.is_active,'createdAt',s.created_at,
    'expirationDate',s.expiration_date,'effectiveExpirationDate',e.expires,
    'expirySource',CASE WHEN o.use_organization_expiration OR s.expiration_date IS NULL THEN 'organization' ELSE 'staff' END,
    'status',CASE WHEN NOT s.is_active THEN 'locked' WHEN e.expires IS NULL OR timezone('Asia/Ho_Chi_Minh',e.expires)::date < timezone('Asia/Ho_Chi_Minh',now())::date THEN 'expired' ELSE 'active' END,
    'daysRemaining',greatest(0,timezone('Asia/Ho_Chi_Minh',e.expires)::date-timezone('Asia/Ho_Chi_Minh',now())::date),
    'groupIds',coalesce(g.ids,'[]'::jsonb),'groupNames',coalesce(g.names,'[]'::jsonb),
    'version',s.xmin::text||':'||md5(coalesce(g.revision,'')))
  FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id
  LEFT JOIN LATERAL (SELECT max(p.expiration_date) expires FROM public.org_organization_product p
    WHERE p.organization_id=s.organization_id AND NOT p.is_deleted AND p.product_id IN (3,10,13,16,17,18)) p ON true
  CROSS JOIN LATERAL (SELECT CASE WHEN o.use_organization_expiration OR s.expiration_date IS NULL THEN p.expires
    WHEN p.expires IS NULL THEN NULL ELSE least(s.expiration_date,p.expires) END expires) e
  LEFT JOIN LATERAL (SELECT jsonb_agg(g.id ORDER BY g.id) ids,jsonb_agg(g.name ORDER BY g.id) names,
    string_agg(gs.id::text||':'||gs.group_id::text||':'||gs.is_admin::text,',' ORDER BY gs.id) revision
    FROM public.org_group_staff gs JOIN public.org_group g ON g.id=gs.group_id AND g.organization_id=s.organization_id
    WHERE gs.staff_id=s.id AND gs.organization_id=s.organization_id) g ON true
  WHERE s.id=p_id AND s.deleted_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_management(p_actor_id bigint,p_username text,p_password text,p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public SET lock_timeout TO '3s' SET statement_timeout TO '12s' AS $function$
#variable_conflict use_variable
DECLARE
  actor public.org_staff%ROWTYPE; org public.org_organization%ROWTYPE;
  target public.org_staff%ROWTYPE; grp public.org_group%ROWTYPE;
  request public.auto_staff_management_requests%ROWTYPE;
  result jsonb; obj jsonb; ids bigint[]; id bigint; parent_id bigint; group_id bigint;
  request_id uuid; revision text; phone text; label text; allowed text[];
  mutation boolean; total bigint; offset_rows integer; group_ids bigint[]; stamp timestamptz:=clock_timestamp();
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('list','saveGroup','saveStaff','setStatus','revealPassword','prepareDevices','resetDevices') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
  allowed:=CASE p_action
    WHEN 'list' THEN ARRAY['search','groupId','status','page']
    WHEN 'saveGroup' THEN ARRAY['id','name','parentId','expectedVersion','requestId']
    WHEN 'saveStaff' THEN ARRAY['id','name','phone','groupId','expectedVersion','requestId']
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
        'staffCount',(SELECT count(DISTINCT gs.staff_id) FROM public.org_group_staff gs JOIN public.org_staff s ON s.id=gs.staff_id
          WHERE gs.group_id=g.id AND gs.organization_id=org.id AND s.organization_id=org.id AND s.deleted_at IS NULL)) ORDER BY g.id)
        FROM public.org_group g WHERE g.organization_id=org.id),'[]'::jsonb));

  ELSIF p_action='saveGroup' THEN
    id:=(p_data->>'id')::bigint; parent_id:=(p_data->>'parentId')::bigint; label:=btrim(p_data->>'name');
    IF label IS NULL OR length(label) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    IF parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=parent_id AND g.organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF id IS NOT NULL THEN
      SELECT * INTO grp FROM public.org_group g WHERE g.id=id AND g.organization_id=org.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
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
    IF NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=group_id AND g.organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF EXISTS(SELECT 1 FROM public.org_staff s WHERE s.organization_id=org.id AND public.normalize_phone(s.phone)=phone AND (id IS NULL OR s.id<>id)) THEN RAISE EXCEPTION 'staff_phone_exists'; END IF;
    IF id IS NULL THEN
      SELECT count(*) INTO total FROM public.org_staff s WHERE s.organization_id=org.id AND s.deleted_at IS NULL;
      IF total>=org.max_staff THEN RAISE EXCEPTION 'staff_quota_full'; END IF;
      INSERT INTO public.org_staff(organization_id,name,phone,username,password,is_active,is_admin,expiration_date)
      VALUES(org.id,label,phone,org.id::text||'.'||phone,'123456',true,false,
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
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_staff_management_row(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_management_row(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_staff_time_allowed(bigint),public.aka_agent_staff_access(bigint,text,text),public.aka_agent_staff_management(bigint,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_time_allowed(bigint),public.aka_agent_staff_access(bigint,text,text),public.aka_agent_staff_management(bigint,text,text,text,jsonb) TO anon, authenticated, service_role;

-- Legacy runtime entrypoints retain PUBLIC EXECUTE, including Chat API callers.
-- This guard exposes only the same active/allowed boolean, never tenant rows.
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_time_allowed(bigint) TO PUBLIC;


-- Preserve live signature/attributes: aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)
CREATE OR REPLACE FUNCTION public.aka_agent_check_campaign_daily_boundary(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_claimed_vietnam_date date)
 RETURNS TABLE(allow_new_unit boolean, reason text, campaign_status text, account_status text, db_now timestamp with time zone, vietnam_date_key date, claimed_vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone, day_changed boolean)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_daily_stop_time time without time zone;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_is_active boolean;
  v_account_login_status text;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_day_changed boolean;
  v_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF p_claimed_vietnam_date IS NULL THEN
    RAISE EXCEPTION 'claimed Vietnam date is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
    AND (public.aka_agent_staff_time_allowed(staff.id) OR EXISTS (
      SELECT 1 FROM public.auto_campaigns held WHERE held.id=p_campaign_id
        AND held.account_id=p_account_id AND held.staff_id=p_staff_id AND held.runtime_unit_token IS NOT NULL
    ))
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date;
    RETURN;
  END IF;

  SELECT
    campaign.status,
    account.status,
    campaign.daily_stop_time,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    COALESCE(account.is_active, false),
    account.login_status,
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_status,
    v_daily_stop_time,
    v_campaign_is_delete,
    v_account_is_delete,
    v_account_is_active,
    v_account_login_status,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    );

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date;
    RETURN;
  END IF;

  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_boundary_at := (
    p_claimed_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_day_changed := v_vietnam_date > p_claimed_vietnam_date;

  IF (v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_account_platform = 'zalo' AND v_account_is_zalo_server
    ))
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete THEN
    v_reason := 'account_deleted';
  ELSIF NOT v_account_is_active THEN
    v_reason := 'account_inactive';
  ELSIF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    v_reason := 'account_logged_out';
  ELSIF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    -- A concurrent manual campaign/account pause always wins.
    v_reason := 'runtime_control_paused';
  ELSIF p_claimed_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_day_changed THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    -- Inclusive comparison: no unit may start exactly at the cutoff.
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSE
    v_reason := 'allowed';
  END IF;

  RETURN QUERY SELECT
    v_reason = 'allowed',
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date,
    p_claimed_vietnam_date,
    v_effective_stop_time,
    v_boundary_at,
    v_day_changed;
END;
$function$;

-- Preserve live signature/attributes: aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)
CREATE OR REPLACE FUNCTION public.aka_agent_claim_account_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_runtime_target text, p_previous_status text, p_claim_token uuid, p_requires_login boolean, p_operation_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_account public.auto_accounts%ROWTYPE; v_organization_id bigint;
BEGIN
  IF p_account_id IS NULL OR p_account_id<=0 OR p_staff_id IS NULL OR p_staff_id<=0
    OR p_claim_token IS NULL OR p_previous_status IS NULL
    OR p_previous_status NOT IN ('chờ xử lý','tạm dừng')
    OR p_platform IS NULL OR p_platform NOT IN ('zalo','facebook','email')
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop','server')
    OR (p_platform<>'zalo' AND p_runtime_target<>'desktop') THEN
    RAISE EXCEPTION 'invalid_account_operation_identity';
  END IF;
  IF p_operation_kind IS NULL OR p_operation_kind NOT IN ('operation','type_change')
    OR (p_operation_kind='type_change' AND p_platform<>'zalo') THEN
    RAISE EXCEPTION 'invalid_account_operation_kind';
  END IF;
  -- Keep the existing lock order: staff, entitlement advisory lock, account.
  SELECT organization_id INTO v_organization_id FROM public.org_staff
    WHERE id=p_staff_id AND is_active=true AND public.aka_agent_staff_time_allowed(p_staff_id) FOR SHARE;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('claimed',false,'reason','staff_not_active');
  END IF;
  IF p_platform='zalo' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  END IF;
  SELECT * INTO v_account FROM public.auto_accounts a
    WHERE a.id=p_account_id AND a.staff_id=p_staff_id
      AND (a.organization_id IS NULL OR a.organization_id=v_organization_id) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','account_not_found'); END IF;
  IF COALESCE(v_account.is_delete,false) OR lower(btrim(COALESCE(v_account.flatform_type,'')))<>p_platform
    OR (p_operation_kind='operation' AND v_account.is_active IS NOT TRUE) THEN
    RETURN jsonb_build_object('claimed',false,'reason','account_not_available');
  END IF;
  -- A retry after a lost response must never undo a newer pause/resume write.
  IF v_account.runtime_operation_claim_token=p_claim_token AND v_account.status<>'đang chạy' THEN
    RETURN jsonb_build_object('claimed',false,'reason','control_changed');
  END IF;
  -- Zalo already checks all work below in its existing RPC. Extend the same
  -- producer barrier to non-Zalo scans before delegating their existing claim.
  IF p_platform<>'zalo' AND (EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id
      AND (c.status='đang chạy' OR c.runtime_unit_token IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.auto_campaign_inputs i JOIN public.auto_campaigns c ON c.id=i.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND i.status='đang chạy')
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d JOIN public.auto_campaigns c ON c.id=d.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND d.status='đang chạy')) THEN
    RETURN jsonb_build_object('claimed',false,'reason','work_running');
  END IF;
  -- A different token on an idle account can be a completed legacy campaign's
  -- token. Eligibility remains governed by the existing status/work guards.
  IF p_platform='zalo' THEN
    RETURN public.claim_zalo_account_runtime_operation(p_account_id,p_staff_id,p_runtime_target,
      p_previous_status,p_claim_token,CASE WHEN p_operation_kind='type_change' THEN false ELSE COALESCE(p_requires_login,true) END);
  END IF;
  RETURN public.claim_non_zalo_account_runtime_operation(p_account_id,p_staff_id,p_platform,
    p_previous_status,p_claim_token,COALESCE(p_requires_login,true));
END;
$function$;

-- Preserve live signature/attributes: aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])
CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_run_unit_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_runtime_claim_vietnam_date date, p_runtime_unit_token uuid, p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[])
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, claimed_count integer, runtime_claim_token uuid, runtime_claim_vietnam_date date, runtime_unit_token uuid, runtime_unit_vietnam_date date, runtime_unit_claimed_at timestamp with time zone, runtime_unit_input_data_ids bigint[], db_now timestamp with time zone, vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_input_data_ids bigint[] := ARRAY(
    SELECT DISTINCT ids.input_id
    FROM unnest(
      COALESCE(p_input_data_ids, ARRAY[]::bigint[])
    ) AS ids(input_id)
    ORDER BY ids.input_id
  );
  v_organization_id bigint;
  v_staff_is_active boolean := false;
  v_capabilities record;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_stored_claim_token uuid;
  v_stored_claim_target text;
  v_stored_claim_vietnam_date date;
  v_stored_unit_token uuid;
  v_stored_unit_vietnam_date date;
  v_stored_unit_claimed_at timestamptz;
  v_stored_unit_input_data_ids bigint[];
  v_daily_stop_time time without time zone;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_requested_found_count integer := 0;
  v_requested_pending_count integer := 0;
  v_total_running_count integer := 0;
  v_claimed_count integer := 0;
  v_reason text;
  v_legacy_unit record;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF p_runtime_claim_token IS NULL
    OR p_runtime_claim_vietnam_date IS NULL
    OR p_runtime_unit_token IS NULL
  THEN
    RAISE EXCEPTION 'parent claim token/date and runtime unit token are required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN
    RAISE EXCEPTION 'input data IDs must be positive integers';
  END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'a campaign run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id, COALESCE(staff.is_active, false)
  INTO v_organization_id, v_staff_is_active
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text, 0,
      NULL::uuid, NULL::date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  -- Keep the established entitlement -> campaign barrier lock order for both
  -- fresh claims and response recovery. Exact committed-unit recovery does not
  -- consult mutable entitlement/staff-active values after taking these locks.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  IF cardinality(v_input_data_ids) > 0 THEN
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    FOR UPDATE OF input_data;

    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE input_data.status = 'chờ xử lý')::integer
    INTO v_requested_found_count, v_requested_pending_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false;
  END IF;

  -- Reject a fresh v2 unit while legacy/unrecovered input rows are running.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy'
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT count(*)::integer
  INTO v_total_running_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy';

  SELECT
    campaign.status,
    account.status,
    account.login_status,
    COALESCE(account.is_active, false),
    COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token,
    campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at,
    campaign.runtime_unit_input_data_ids,
    campaign.daily_stop_time
  INTO
    v_campaign_status,
    v_account_status,
    v_account_login_status,
    v_account_is_active,
    v_account_is_delete,
    v_campaign_is_delete,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_unit_token,
    v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at,
    v_stored_unit_input_data_ids,
    v_daily_stop_time
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
  FOR UPDATE OF campaign, account;
  v_campaign_found := FOUND;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_boundary_at := (
    p_runtime_claim_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  IF NOT v_campaign_found THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text, 0,
      NULL::uuid, NULL::date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  -- The exact committed unit token/date/target/canonical payload is the
  -- linearization point for a lost response. Resolve it only after the same
  -- campaign/input/account locks as a fresh claim, but before mutable
  -- staff-active, entitlement, control, login, or subtype checks. This lets the
  -- caller recover the response and settle instead of stranding maintenance.
  -- Parent fields are NULL-or-match because Desktop soft-pause deliberately
  -- clears that weaker tuple while the opaque unit token/date/exact payload
  -- remains durable; a still-present Server/newer parent must match exactly.
  IF v_stored_unit_token = p_runtime_unit_token
    AND v_stored_unit_vietnam_date = p_runtime_claim_vietnam_date
    AND v_stored_unit_claimed_at IS NOT NULL
    AND v_stored_unit_input_data_ids = v_input_data_ids
    AND (
      v_stored_claim_token IS NULL
      OR v_stored_claim_token = p_runtime_claim_token
    )
    AND (
      v_stored_claim_target IS NULL
      OR v_stored_claim_target = v_runtime_target
    )
    AND (
      v_stored_claim_vietnam_date IS NULL
      OR v_stored_claim_vietnam_date = p_runtime_claim_vietnam_date
    )
  THEN
    RETURN QUERY SELECT
      true, 'already_claimed', v_campaign_status, v_account_status,
      cardinality(v_stored_unit_input_data_ids),
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  -- A different/new unit still passes the complete mutable runtime guard.
  IF NOT v_staff_is_active OR NOT public.aka_agent_staff_time_allowed(p_staff_id) THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Durable token identity remains authoritative ahead of mutable campaign,
  -- account, login, and subtype checks after the active/entitlement guard.
  IF v_stored_unit_token IS NOT NULL THEN
    IF v_stored_unit_vietnam_date IS NULL
      OR v_stored_unit_claimed_at IS NULL
      OR v_stored_unit_input_data_ids IS NULL
    THEN
      v_reason := 'unit_lease_corrupt';
    ELSIF v_stored_unit_token IS DISTINCT FROM p_runtime_unit_token THEN
      v_reason := 'unit_lease_busy';
    ELSIF (
        v_stored_claim_token IS NOT NULL
        AND v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
      ) OR (
        v_stored_claim_target IS NOT NULL
        AND v_stored_claim_target IS DISTINCT FROM v_runtime_target
      ) OR (
        v_stored_claim_vietnam_date IS NOT NULL
        AND v_stored_claim_vietnam_date
          IS DISTINCT FROM p_runtime_claim_vietnam_date
      )
    THEN
      v_reason := 'runtime_claim_mismatch';
    ELSIF v_stored_unit_vietnam_date IS DISTINCT FROM p_runtime_claim_vietnam_date
      OR v_stored_unit_input_data_ids IS DISTINCT FROM v_input_data_ids
    THEN
      v_reason := 'unit_lease_payload_mismatch';
    ELSE
      RETURN QUERY SELECT
        true, 'already_claimed', v_campaign_status, v_account_status,
        cardinality(v_stored_unit_input_data_ids),
        v_stored_claim_token, v_stored_claim_vietnam_date,
        v_stored_unit_token, v_stored_unit_vietnam_date,
        v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
        v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      false, v_reason, v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  ELSIF v_stored_unit_vietnam_date IS NOT NULL
    OR v_stored_unit_claimed_at IS NOT NULL
    OR v_stored_unit_input_data_ids IS NOT NULL
  THEN
    RETURN QUERY SELECT
      false, 'unit_lease_corrupt', v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      NULL::uuid, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  IF v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_runtime_target = 'desktop'
    AND v_account_platform = 'zalo'
    AND (
      v_account_is_zalo_server
      OR (
        v_account_is_zalo_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_account_is_zalo_web
        AND NOT v_account_is_zalo_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete THEN
    v_reason := 'account_deleted';
  ELSIF NOT v_account_is_active THEN
    v_reason := 'account_inactive';
  ELSIF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    v_reason := 'account_logged_out';
  ELSIF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    v_reason := 'runtime_control_paused';
  ELSIF v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
    OR v_stored_claim_target IS DISTINCT FROM v_runtime_target
    OR v_stored_claim_vietnam_date IS DISTINCT FROM p_runtime_claim_vietnam_date
  THEN
    v_reason := 'runtime_claim_mismatch';
  ELSIF p_runtime_claim_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_vietnam_date > p_runtime_claim_vietnam_date THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSIF v_total_running_count > 0
    OR v_requested_found_count <> cardinality(v_input_data_ids)
    OR v_requested_pending_count <> cardinality(v_input_data_ids)
  THEN
    v_reason := 'input_not_pending';
  ELSE
    v_reason := 'allowed';
  END IF;

  IF v_reason <> 'allowed' THEN
    RETURN QUERY SELECT
      false, v_reason, v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  BEGIN
    IF v_runtime_target = 'server' THEN
      SELECT * INTO v_legacy_unit
      FROM public.aka_agent_claim_zalo_server_run_unit(
        p_campaign_id,
        p_account_id,
        p_staff_id,
        v_input_data_ids
      );
      IF v_legacy_unit.ok IS DISTINCT FROM true THEN
        v_reason := COALESCE(v_legacy_unit.reason, 'unit_claim_rejected');
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'legacy Server unit claim rejected';
      END IF;
      v_claimed_count := COALESCE(v_legacy_unit.claimed_count, 0)::integer;
      IF v_claimed_count IS DISTINCT FROM cardinality(v_input_data_ids) THEN
        v_reason := 'unit_claim_count_mismatch';
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'legacy Server unit claim count mismatch';
      END IF;
    ELSE
      IF cardinality(v_input_data_ids) > 0 THEN
        UPDATE public.auto_campaign_input_data AS input_data
        SET status = 'đang chạy', date_action = v_now
        WHERE input_data.id = ANY(v_input_data_ids)
          AND input_data.campaign_id = p_campaign_id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý';
        GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
      END IF;
      IF v_claimed_count IS DISTINCT FROM cardinality(v_input_data_ids) THEN
        v_reason := 'unit_claim_count_mismatch';
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'Desktop unit claim count mismatch';
      END IF;
    END IF;

    -- The lease is written only after the exact reservation succeeds and a
    -- final DB-clock sample confirms the inclusive boundary is still open.
    v_now := clock_timestamp();
    v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    IF v_vietnam_date > p_runtime_claim_vietnam_date THEN
      v_reason := 'vietnam_day_changed';
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run unit crossed Vietnam midnight';
    ELSIF v_now >= v_boundary_at THEN
      v_reason := CASE
        WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
        ELSE 'daily_stop_due'
      END;
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run unit crossed its daily boundary';
    END IF;

    UPDATE public.auto_campaigns AS campaign
    SET runtime_unit_token = p_runtime_unit_token,
      runtime_unit_vietnam_date = p_runtime_claim_vietnam_date,
      runtime_unit_claimed_at = v_now,
      runtime_unit_input_data_ids = v_input_data_ids,
      updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
      AND campaign.runtime_claim_token = p_runtime_claim_token
      AND campaign.runtime_claim_target = v_runtime_target
      AND campaign.runtime_claim_vietnam_date = p_runtime_claim_vietnam_date
      AND campaign.runtime_unit_token IS NULL;

    IF NOT FOUND THEN
      v_reason := 'unit_lease_lost';
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run-unit lease lost parent ownership';
    END IF;

    RETURN QUERY SELECT
      true, 'claimed', v_campaign_status, v_account_status, v_claimed_count,
      p_runtime_claim_token, p_runtime_claim_vietnam_date,
      p_runtime_unit_token, p_runtime_claim_vietnam_date,
      v_now, v_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  EXCEPTION
    WHEN SQLSTATE 'P0232' THEN
      -- Reservation and lease writes in this subtransaction are rolled back
      -- together; no compensating UPDATE can clobber a concurrent control row.
      NULL;
  END;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  SELECT campaign.status, account.status,
    campaign.runtime_claim_token, campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token, campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at, campaign.runtime_unit_input_data_ids
  INTO v_campaign_status, v_account_status,
    v_stored_claim_token, v_stored_claim_vietnam_date,
    v_stored_unit_token, v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at, v_stored_unit_input_data_ids
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id;

  RETURN QUERY SELECT
    false, COALESCE(v_reason, 'unit_claim_lost'),
    v_campaign_status, v_account_status, 0,
    v_stored_claim_token, v_stored_claim_vietnam_date,
    v_stored_unit_token, v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
    v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
END;
$function$;

-- Preserve live signature/attributes: aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])
CREATE OR REPLACE FUNCTION public.aka_agent_claim_zalo_server_run_unit(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[])
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, claimed_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_input_data_ids bigint[] := ARRAY(
    SELECT DISTINCT ids.input_id
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    ORDER BY ids.input_id
  );
  v_input_data_id bigint;
  v_claimed_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN RAISE EXCEPTION 'Input data IDs must be positive integers'; END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'A Zalo Server run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Match Control input pause/resume: requested inputs are always the first
  -- mutable rows in the lock chain, followed by campaign and account below.
  -- The status predicate is rechecked by PostgreSQL after any blocked updater.
  IF cardinality(v_input_data_ids) > 0 THEN
    FOR v_input_data_id IN
      SELECT input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_input_data_ids)
        AND input_data.campaign_id = p_campaign_id
        AND COALESCE(input_data.is_delete, false) = false
        AND input_data.status = 'chờ xử lý'
      ORDER BY input_data.id
      FOR UPDATE OF input_data
    LOOP
      v_claimed_count := v_claimed_count + 1;
    END LOOP;
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0; RETURN; END IF;
  IF v_campaign_is_delete THEN RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_is_delete THEN RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF NOT v_account_is_active THEN RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' OR v_account_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  IF cardinality(v_input_data_ids) > 0 THEN
    IF v_claimed_count <> cardinality(v_input_data_ids) THEN
      RETURN QUERY SELECT false, 'input_not_pending', v_campaign_status, v_account_status, 0;
      RETURN;
    END IF;
    UPDATE public.auto_campaign_input_data
    SET status = 'đang chạy', date_action = now()
    WHERE id = ANY(v_input_data_ids) AND campaign_id = p_campaign_id;
  END IF;

  RETURN QUERY SELECT true, 'claimed', v_campaign_status, v_account_status, v_claimed_count;
END;
$function$;

-- Preserve live signature/attributes: aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)
CREATE OR REPLACE FUNCTION public.aka_agent_get_zalo_server_run_control_state(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint)
 RETURNS TABLE(campaign_id bigint, account_id bigint, campaign_status text, account_status text, account_login_status text, account_is_active boolean, account_is_delete boolean, campaign_is_delete boolean, pause_requested boolean, should_stop boolean, hard_stop_reason text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_pause_requested boolean := false;
  v_hard_stop_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
    AND (public.aka_agent_staff_time_allowed(staff.id) OR EXISTS (
      SELECT 1 FROM public.auto_campaigns held WHERE held.id=p_campaign_id
        AND held.account_id=p_account_id AND held.staff_id=p_staff_id AND held.runtime_unit_token IS NOT NULL
    ));
  IF NOT FOUND OR v_organization_id IS NULL THEN
    v_hard_stop_reason := 'runtime_not_owner';
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true;

  IF NOT FOUND THEN
    v_hard_stop_reason := COALESCE(v_hard_stop_reason, 'not_found');
  ELSE
    v_pause_requested := v_campaign_status IS DISTINCT FROM 'đang chạy'
      OR v_account_status IS DISTINCT FROM 'đang chạy';
    IF v_hard_stop_reason IS NULL AND v_campaign_is_delete THEN
      v_hard_stop_reason := 'campaign_deleted';
    ELSIF v_hard_stop_reason IS NULL AND v_account_is_delete THEN
      v_hard_stop_reason := 'account_deleted';
    ELSIF v_hard_stop_reason IS NULL AND NOT v_account_is_active THEN
      v_hard_stop_reason := 'account_inactive';
    ELSIF v_hard_stop_reason IS NULL AND v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
      v_hard_stop_reason := 'account_logged_out';
    END IF;
  END IF;

  RETURN QUERY SELECT p_campaign_id, p_account_id, v_campaign_status,
    v_account_status, v_account_login_status, v_account_is_active,
    v_account_is_delete, v_campaign_is_delete, v_pause_requested,
    v_pause_requested OR v_hard_stop_reason IS NOT NULL, v_hard_stop_reason;
END;
$function$;

-- Preserve live signature/attributes: claim_campaign_runtime(bigint,bigint,bigint,text)
CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_zalo boolean;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Server hard-end cleanup must start before the ordinary campaign/account
  -- claim locks. Candidate discovery uses only caller-readable campaign and
  -- account rows; the SECURITY DEFINER wrapper authoritatively revalidates the
  -- RPC-only Data Group source after joining the common input-first barrier.
  IF v_runtime_target = 'server'
    AND COALESCE(v_capabilities.qr_enabled, false)
    AND COALESCE(v_capabilities.server_enabled, false)
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = campaign.staff_id
      WHERE campaign.id = p_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.account_id = p_account_id
        AND campaign.organization_id = v_organization_id
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
        AND campaign.schedule_end_date IS NOT NULL
        AND campaign.schedule_end_date <= now()
        AND (
          account.organization_id IS NULL
          OR account.organization_id = v_organization_id
        )
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
    )
  THEN
    BEGIN
      PERFORM public.aka_agent_finalize_zalo_server_data_group_campaign(
        p_staff_id,
        v_organization_id,
        v_capabilities.capability_revision,
        p_campaign_id,
        'Chiến dịch đã hết hạn'
      );
    EXCEPTION
      -- The source, campaign or account subtype can change after optimistic
      -- candidate discovery. Those expected races are a rejected
      -- claim, not a scheduler error; the authoritative sweep handles any
      -- remaining hard-end cleanup on its next pass.
      WHEN raise_exception THEN
        IF SQLERRM NOT IN (
          'data_group_server_campaign_not_found',
          'data_group_server_runtime_not_owner'
        ) THEN
          RAISE;
        END IF;
    END;
    RETURN false;
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    THEN RETURN false; END IF;
  ELSIF v_is_zalo AND (
    v_is_server
    OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
    OR (NOT v_is_web AND NOT v_is_server
      AND NOT COALESCE(v_capabilities.qr_enabled, false))
  ) THEN RETURN false; END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.schedule_end_date IS NOT NULL
    AND v_campaign.schedule_end_date <= now()
  THEN
    -- Expiry can race the pre-claim sweep. Do not call a privileged finalizer
    -- while executing as anon/authenticated and do not change either row. The
    -- next tenant sweep completes the hard-end cleanup under its narrow RPC.
    RETURN false;
  END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS NULL
    OR v_campaign.schedule > now()
    OR COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready'
    OR (
      v_campaign.data_target_source_mode = 'data_group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý'
          AND (input_data.schedule IS NULL OR input_data.schedule <= now())
      )
    )
    OR (v_campaign.daily_stop_time IS NOT NULL
      AND v_campaign.daily_stop_time < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN RETURN false; END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN true;
END;
$function$;

-- Preserve live signature/attributes: claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)
CREATE OR REPLACE FUNCTION public.claim_non_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_previous_status text, p_claim_token uuid, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_platform NOT IN ('facebook', 'email') THEN
    RAISE EXCEPTION 'Non-Zalo runtime platform must be Facebook or Email';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  -- reset_desktop_running_statuses takes FOR UPDATE on this same row. The
  -- shared lock prevents a new account operation from entering recovery.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> v_platform
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  -- Retrying the same client-generated token is idempotent after an ambiguous
  -- network response: the caller still owns this exact account-only claim.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'platform', v_platform
    );
  END IF;

  IF (COALESCE(p_requires_login, true) AND v_account.login_status IS DISTINCT FROM 'đã đăng nhập')
    OR v_account.status IS DISTINCT FROM v_previous_status
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'platform', v_platform
  );
END;
$function$;

-- Preserve live signature/attributes: claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)
CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'staff_not_active'
    );
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT *
  INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(
    v_organization_id
  );

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'account_not_found'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = campaign_input.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign_input.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND input_data.status = 'đang chạy'
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'work_running'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
    OR (
      COALESCE(p_requires_login, true)
      AND v_account.login_status <> 'đã đăng nhập'
    )
    OR v_account.status NOT IN ('chờ xử lý', 'tạm dừng')
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'account_not_available'
    );
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  IF (
    v_runtime_target = 'server'
    AND (
      v_is_web
      OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  ) OR (
    v_runtime_target = 'desktop'
    AND (
      v_is_server
      OR (
        v_is_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_is_web
        AND NOT v_is_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'runtime_not_owner'
    );
  END IF;

  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_account.status,
    'runtime_target', v_runtime_target
  );
END;
$function$;

-- Preserve live signature/attributes: claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)
CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_previous_status text, p_claim_token uuid, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_capabilities record;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT *
  INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(
    v_organization_id
  );

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  IF (
    v_runtime_target = 'server'
    AND (
      v_is_web
      OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  ) OR (
    v_runtime_target = 'desktop'
    AND (
      v_is_server
      OR (
        v_is_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_is_web
        AND NOT v_is_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'runtime_not_owner'
    );
  END IF;

  -- Retry of the same account-operation token remains idempotent after an
  -- ambiguous response. A campaign cannot form a unit while this account row
  -- is already owned/running by that token.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'runtime_target', v_runtime_target
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = campaign_input.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign_input.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND input_data.status = 'đang chạy'
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'work_running'
    );
  END IF;

  IF v_account.status IS DISTINCT FROM v_previous_status
    OR (
      COALESCE(p_requires_login, true)
      AND (
        v_account.is_active IS NOT TRUE
        OR v_account.login_status IS DISTINCT FROM 'đã đăng nhập'
      )
    )
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.status = v_previous_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'runtime_target', v_runtime_target
  );
END;
$function$;

-- Preserve live signature/attributes: discover_zalo_server_account_runtime_users(bigint,integer)
CREATE OR REPLACE FUNCTION public.discover_zalo_server_account_runtime_users(p_after_staff_id bigint DEFAULT 0, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_page_size integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_result jsonb;
BEGIN
  IF p_after_staff_id IS NULL OR p_after_staff_id < 0 THEN
    RAISE EXCEPTION 'After staff ID must be zero or greater';
  END IF;

  WITH organization_capabilities AS (
    SELECT capabilities.*, organizations.organization_id
    FROM (
      SELECT DISTINCT entitlement.organization_id
      FROM public.org_organization_product AS entitlement
      WHERE entitlement.product_id IN (16, 18)
        AND entitlement.is_deleted = false
        AND entitlement.expiration_date IS NOT NULL
        AND entitlement.expiration_date >= (
          date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
            AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
    ) AS organizations
    CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(
      organizations.organization_id
    ) AS capabilities
    WHERE capabilities.qr_enabled = true
      AND capabilities.server_enabled = true
  ),
  page_candidates AS (
    SELECT
      staff.id AS staff_id,
      staff.organization_id,
      staff.name AS staff_name,
      staff.phone AS staff_phone,
      staff.username,
      COALESCE(staff.is_admin_akabiz, false) AS is_admin_akabiz,
      COALESCE(staff.use_test_workflow, false) AS use_test_workflow,
      organization.name AS organization_name,
      capabilities.entitlement_id,
      capabilities.capability_revision AS mode_revision,
      capabilities.product_id,
      capabilities.product_name,
      capabilities.package_name,
      capabilities.package_type,
      capabilities.expiration_date,
      capabilities.max_sends_per_day,
      capabilities.max_accounts,
      capabilities.created_at,
      capabilities.qr_enabled,
      capabilities.web_enabled,
      capabilities.server_enabled
    FROM organization_capabilities AS capabilities
    JOIN public.org_staff AS staff
      ON staff.organization_id = capabilities.organization_id
    JOIN public.org_organization AS organization
      ON organization.id = staff.organization_id
    WHERE staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
      AND staff.id > p_after_staff_id
    ORDER BY staff.id ASC
    LIMIT v_page_size + 1
  ),
  page_items AS (
    SELECT candidate.*
    FROM page_candidates AS candidate
    ORDER BY candidate.staff_id ASC
    LIMIT v_page_size
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'staff_id', item.staff_id,
          'organization_id', item.organization_id,
          'staff_name', item.staff_name,
          'staff_phone', item.staff_phone,
          'username', item.username,
          'is_admin_akabiz', item.is_admin_akabiz,
          'use_test_workflow', item.use_test_workflow,
          'organization_name', item.organization_name,
          'entitlement_id', item.entitlement_id,
          'mode_revision', item.mode_revision,
          'product_id', item.product_id,
          'product_name', item.product_name,
          'package_name', item.package_name,
          'package_type', item.package_type,
          'expiration_date', item.expiration_date,
          'max_sends_per_day', item.max_sends_per_day,
          'max_accounts', item.max_accounts,
          'created_at', item.created_at,
          'zalo_qr_enabled', item.qr_enabled,
          'zalo_web_enabled', item.web_enabled,
          'zalo_server_enabled', item.server_enabled
        ) ORDER BY item.staff_id ASC
      ) FROM page_items AS item
    ), '[]'::jsonb),
    'next_after_staff_id', CASE
      WHEN (SELECT count(*) FROM page_candidates) > v_page_size
        THEN (SELECT max(item.staff_id) FROM page_items AS item)
      ELSE NULL
    END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- Preserve live signature/attributes: get_staff_zalo_account_capabilities(bigint)
CREATE OR REPLACE FUNCTION public.get_staff_zalo_account_capabilities(p_staff_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_organization_id bigint;
  v_capabilities record;
  v_quota_pools jsonb;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id);

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  SELECT *
  INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  SELECT jsonb_object_agg(
    pool.account_subtype,
    jsonb_build_object(
      'enabled', pool.entitlement_id IS NOT NULL,
      'entitlement_id', pool.entitlement_id,
      'product_id', pool.product_id,
      'product_name', pool.product_name,
      'package_name', pool.package_name,
      'package_type', pool.package_type,
      'expiration_date', pool.expiration_date,
      'max_sends_per_day', pool.max_sends_per_day,
      'max_accounts', pool.max_accounts,
      'created_at', pool.created_at,
      'revision', pool.pool_revision
    )
  )
  INTO v_quota_pools
  FROM private.resolve_organization_zalo_entitlement_pools(
    v_organization_id
  ) AS pool;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'organization_id', v_organization_id,
    'entitlement_id', v_capabilities.entitlement_id,
    'product_id', v_capabilities.product_id,
    'product_name', v_capabilities.product_name,
    'package_name', v_capabilities.package_name,
    'package_type', v_capabilities.package_type,
    'expiration_date', v_capabilities.expiration_date,
    'max_sends_per_day', v_capabilities.max_sends_per_day,
    'max_accounts', v_capabilities.max_accounts,
    'created_at', v_capabilities.created_at,
    'zalo_qr_enabled', COALESCE(v_capabilities.qr_enabled, false),
    'zalo_web_enabled', COALESCE(v_capabilities.web_enabled, false),
    'zalo_server_enabled', COALESCE(v_capabilities.server_enabled, false),
    'revision', COALESCE(
      v_capabilities.capability_revision,
      'none:' || v_organization_id::text
    ),
    'quota_pools', COALESCE(v_quota_pools, '{}'::jsonb)
  );
END;
$function$;

-- Preserve live signature/attributes: get_staff_zalo_runtime_mode(bigint)
CREATE OR REPLACE FUNCTION public.get_staff_zalo_runtime_mode(p_staff_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id);

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'is_zalo_server', COALESCE(v_mode.is_zalo_server, false),
    'is_zalo_show_web', COALESCE(v_mode.web_enabled, false),
    'zalo_qr_enabled', COALESCE(v_mode.qr_enabled, false),
    'zalo_web_enabled', COALESCE(v_mode.web_enabled, false),
    'revision', COALESCE(v_mode.mode_revision, 'none:' || v_organization_id::text)
  );
END;
$function$;

-- Metadata adds columns and RPCs; PostgREST must see this schema. (DDL watcher remains enabled.)

NOTIFY pgrst, 'reload schema';

COMMIT;
