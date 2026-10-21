-- Canonical v420. New objects only. Live contract audited on akachat 2026-10-21.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
 IF to_regprocedure('public.akabiz_import_sql_zalo_web_v1(jsonb)') IS NOT NULL
 OR to_regclass('public.akabiz_zalo_import_history') IS NOT NULL THEN
   RAISE EXCEPTION 'v420 objects already exist; inspect before applying';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)'))) IS DISTINCT FROM 'a42a8a093fd19dc094b002c45890e1bd'
 OR md5(pg_get_functiondef(to_regprocedure('private.resolve_organization_zalo_entitlement_pools(bigint)'))) IS DISTINCT FROM 'f4524e751fbca68adc364272885e07ae'
 OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_staff_time_allowed(bigint)'))) IS DISTINCT FROM 'a294e60011edd8d42e90ac2f74ce744c' THEN
   RAISE EXCEPTION 'v420 account/entitlement contract changed; audit again';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_set_campaign_completed_at()'))) IS DISTINCT FROM '1b346c7a6b25dfb7057ee0c5a32adde7' THEN RAISE EXCEPTION 'v420 staging trigger changed: aka_agent_set_campaign_completed_at()'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_close_terminal_campaign_data_group_source()'))) IS DISTINCT FROM '139c06853af9872e2f55a3a3e9006015' THEN RAISE EXCEPTION 'v420 staging trigger changed: aka_agent_close_terminal_campaign_data_group_source()'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_stamp_campaign_input_semantic_type()'))) IS DISTINCT FROM 'e0e2a82080ed3afe00fd95aa9a1954f1' THEN RAISE EXCEPTION 'v420 staging trigger changed: aka_agent_stamp_campaign_input_semantic_type()'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_clear_campaign_runtime_claim_metadata()'))) IS DISTINCT FROM 'dacc6362ba94f2f62c9e4cb43f965510' THEN RAISE EXCEPTION 'v420 staging trigger changed: aka_agent_clear_campaign_runtime_claim_metadata()'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.auto_validate_campaign_send_exclusion()'))) IS DISTINCT FROM '8dd9a7ee0baafd762154de59cb2bd953' THEN RAISE EXCEPTION 'v420 staging trigger changed: auto_validate_campaign_send_exclusion()'; END IF;
END $preflight$;

CREATE TABLE public.akabiz_zalo_import_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_system text NOT NULL CHECK(source_system='akabiz_main_sql'),
 source_account_id bigint NOT NULL CHECK(source_account_id>0),
 source_staff_id bigint NOT NULL CHECK(source_staff_id>0),
 target_organization_id bigint NOT NULL,
 target_staff_id bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('run','account','campaign','input','tag','blocklist','blocklist_member')),
 source_id text NOT NULL,
 target_id bigint,
 parent_source_id text,
 run_id uuid NOT NULL,
 source_version text,
 source_status text,
 state text NOT NULL CHECK(state IN ('pending','complete','needs_resolution')),
 data jsonb NOT NULL DEFAULT '{}',
 adjustments jsonb NOT NULL DEFAULT '[]',
 error_code text,
 as_of timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_system,source_account_id,source_staff_id,target_organization_id,target_staff_id,kind,source_id)
);
CREATE UNIQUE INDEX akabiz_zalo_import_one_open_run ON public.akabiz_zalo_import_history
 (source_system,source_account_id,source_staff_id,target_organization_id,target_staff_id)
 WHERE kind='run' AND state<>'complete';
CREATE INDEX akabiz_zalo_import_parent ON public.akabiz_zalo_import_history
 (source_system,source_account_id,source_staff_id,target_organization_id,target_staff_id,kind,parent_source_id);
ALTER TABLE public.akabiz_zalo_import_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.akabiz_zalo_import_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.akabiz_zalo_import_history TO service_role;

CREATE FUNCTION public.akabiz_import_sql_zalo_web_v1(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog,public,private
SET lock_timeout TO '3s'
SET statement_timeout TO '15s'
AS $function$
#variable_conflict use_variable
DECLARE
 op text:=p->>'operation'; r public.akabiz_zalo_import_history%ROWTYPE;
 h public.akabiz_zalo_import_history%ROWTYPE; n public.akabiz_zalo_import_history%ROWTYPE; block_history public.akabiz_zalo_import_history%ROWTYPE;
 staff_id bigint; org_id bigint; staff_count integer; pool record;
 a public.auto_accounts%ROWTYPE; c public.auto_campaigns%ROWTYPE;
 item jsonb; payload jsonb:=p->'payload'; result jsonb; config jsonb; label_checks jsonb;
 expected_offset integer; next_offset integer; batch_hash text;
 target bigint; profile_id bigint; count_matches integer; actual_count bigint;
 hash text; desired text; mapped_status text; created boolean:=false; dry boolean:=coalesce((p->>'dry_run')::boolean,false);
 scope_lock bigint; source_key text:=p->>'source_id'; entity_kind text:=p->>'kind';
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>1048576 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
 IF op IN ('inspect','begin','account_preview','campaign_preview','dependency_preview','dependencies_preview') THEN
   SELECT count(*),min(s.id),min(s.organization_id) INTO staff_count,staff_id,org_id
   FROM public.org_staff s WHERE s.username=p->>'target_username';
   IF staff_count<>1 OR org_id IS NULL THEN RAISE EXCEPTION 'TARGET_STAFF_UNRESOLVED'; END IF;
   IF NOT public.aka_agent_staff_time_allowed(staff_id) THEN RAISE EXCEPTION 'TARGET_STAFF_INACTIVE'; END IF;
   SELECT * INTO pool FROM private.resolve_organization_zalo_entitlement_pools(org_id) WHERE account_subtype='server';
   IF pool.entitlement_id IS NULL THEN RAISE EXCEPTION 'TARGET_ZALO_SERVER_REQUIRED'; END IF;
   IF (p->>'source_account_id')::bigint IS NULL OR (p->>'source_account_id')::bigint<=0
   OR (p->>'source_staff_id')::bigint IS NULL OR (p->>'source_staff_id')::bigint<=0 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   scope_lock:=hashtextextended('sql-zalo-import:'||(p->>'source_account_id')||':'||(p->>'source_staff_id')||':'||org_id||':'||staff_id,0);
   IF op='begin' THEN PERFORM pg_advisory_xact_lock(scope_lock); END IF;
   SELECT * INTO r FROM public.akabiz_zalo_import_history x WHERE x.source_system='akabiz_main_sql'
     AND x.source_account_id=(p->>'source_account_id')::bigint AND x.source_staff_id=(p->>'source_staff_id')::bigint
     AND x.target_staff_id=staff_id AND x.target_organization_id=org_id AND x.kind='run' AND x.state<>'complete';
   IF op='inspect' THEN
     RETURN jsonb_build_object('id',staff_id::text,'organizationId',org_id::text,'username',p->>'target_username',
       'maxAccounts',pool.max_accounts,'run_id',r.run_id,'as_of',coalesce(r.as_of,clock_timestamp()),'progress',coalesce(r.data,'{}'));
   ELSIF op='begin' THEN
     IF r.id IS NOT NULL AND r.lease_until>clock_timestamp() AND r.lease_token IS DISTINCT FROM (p->>'lease_token')::uuid THEN RAISE EXCEPTION 'IMPORT_BUSY'; END IF;
     IF (p->>'lease_token')::uuid IS NULL THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
     IF r.id IS NULL THEN
       r.id:=gen_random_uuid(); r.run_id:=r.id; r.source_id:=r.id::text; r.source_system:='akabiz_main_sql';
       r.source_account_id:=(p->>'source_account_id')::bigint; r.source_staff_id:=(p->>'source_staff_id')::bigint;
       r.target_staff_id:=staff_id; r.target_organization_id:=org_id; r.kind:='run'; r.state:='pending';
       r.data:='{}'; r.adjustments:='[]'; r.as_of:=clock_timestamp(); r.created_at:=clock_timestamp(); r.updated_at:=r.created_at;
       INSERT INTO public.akabiz_zalo_import_history SELECT r.*;
     END IF;
     UPDATE public.akabiz_zalo_import_history SET lease_token=(p->>'lease_token')::uuid,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
     RETURN jsonb_build_object('run_id',r.run_id,'as_of',r.as_of,'progress',r.data);
   END IF;
   -- A read-only account preview uses the same scope as a real run, without a lease.
   r.source_system:='akabiz_main_sql'; r.source_account_id:=(p->>'source_account_id')::bigint;
   r.source_staff_id:=(p->>'source_staff_id')::bigint; r.target_staff_id:=staff_id; r.target_organization_id:=org_id;
   dry:=true; op:=CASE op WHEN 'campaign_preview' THEN 'preview' WHEN 'dependency_preview' THEN 'dependency' WHEN 'dependencies_preview' THEN 'dependencies' ELSE 'account' END;
 ELSE
   SELECT * INTO r FROM public.akabiz_zalo_import_history x WHERE x.run_id=(p->>'run_id')::uuid AND x.kind='run' FOR UPDATE;
   IF r.id IS NULL OR r.state='complete' OR r.lease_token IS DISTINCT FROM (p->>'lease_token')::uuid OR r.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'IMPORT_LEASE_LOST'; END IF;
   staff_id:=r.target_staff_id; org_id:=r.target_organization_id;
   IF NOT public.aka_agent_staff_time_allowed(staff_id) OR NOT EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=staff_id AND s.organization_id=org_id) THEN RAISE EXCEPTION 'TARGET_STAFF_INACTIVE'; END IF;
   SELECT * INTO pool FROM private.resolve_organization_zalo_entitlement_pools(org_id) WHERE account_subtype='server';
   IF pool.entitlement_id IS NULL THEN RAISE EXCEPTION 'TARGET_ZALO_SERVER_REQUIRED'; END IF;
   UPDATE public.akabiz_zalo_import_history SET lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE id=r.id;
 END IF;
 IF op IN ('checkpoint','release','finish') THEN
   UPDATE public.akabiz_zalo_import_history SET data=coalesce(p->'progress',data),
     state=CASE WHEN op='finish' THEN CASE WHEN (p->>'has_issues')::boolean THEN 'needs_resolution' ELSE 'complete' END ELSE state END,
     lease_until=CASE WHEN op IN ('release','finish') THEN NULL ELSE lease_until END,
     lease_token=CASE WHEN op IN ('release','finish') THEN NULL ELSE lease_token END,
     updated_at=clock_timestamp() WHERE id=r.id;
   RETURN jsonb_build_object('ok',true);
 END IF;
 IF op='dependencies' THEN
   IF jsonb_typeof(payload) IS DISTINCT FROM 'array' OR jsonb_array_length(payload)>500 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   result:='[]';
   FOR item IN SELECT value FROM jsonb_array_elements(payload) LOOP
     result:=result||jsonb_build_array(public.akabiz_import_sql_zalo_web_v1((p-'payload')||item||jsonb_build_object('operation',CASE WHEN dry THEN 'dependency_preview' ELSE 'dependency' END)));
   END LOOP;
   RETURN result;
 END IF;
 IF source_key IS NULL OR source_key='' OR entity_kind NOT IN ('account','campaign','tag','blocklist','blocklist_member') THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
 SELECT * INTO h FROM public.akabiz_zalo_import_history x WHERE x.source_system=r.source_system AND x.source_account_id=r.source_account_id
   AND x.source_staff_id=r.source_staff_id AND x.target_staff_id=staff_id AND x.target_organization_id=org_id AND x.kind=entity_kind AND x.source_id=source_key;
 n:=r; n.id:=gen_random_uuid(); n.kind:=entity_kind; n.source_id:=source_key; n.parent_source_id:=p->>'parent_source_id';
 n.target_id:=NULL; n.source_version:=p->>'source_version'; n.source_status:=p->>'source_status'; n.state:='pending'; n.data:='{}';
 n.adjustments:=coalesce(p->'adjustments','[]'); n.error_code:=NULL; n.lease_token:=NULL; n.lease_until:=NULL;
 n.created_at:=clock_timestamp(); n.updated_at:=n.created_at;
 IF op='issue' THEN
   IF h.id IS NULL THEN n.state:='needs_resolution'; n.error_code:=p->>'code'; INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   ELSIF h.state<>'complete' THEN UPDATE public.akabiz_zalo_import_history SET error_code=p->>'code',state='needs_resolution',updated_at=clock_timestamp() WHERE id=h.id; END IF;
   RETURN jsonb_build_object('ok',true);
 END IF;
 IF op='account' AND entity_kind='account' THEN
   IF coalesce(payload->>'uid','') !~ '^[0-9]+$' OR payload->>'uid' ~ '^0+$' THEN RAISE EXCEPTION 'ACCOUNT_UID_MISSING'; END IF;
   IF NOT dry THEN
     PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
     PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:'||staff_id,0));
   END IF;
   SELECT count(*),min(account.id) INTO count_matches,target FROM public.auto_accounts account
     LEFT JOIN public.zalo_accounts z ON z.id=account.zalo_account_id
     WHERE account.staff_id=staff_id AND account.organization_id=org_id AND NOT coalesce(account.is_delete,false)
       AND (z.zalo_uid=payload->>'uid' OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account zc ON zc.id=b.chat_zalo_account_id
         WHERE b.auto_account_id=account.id AND b.organization_id=org_id AND b.is_active AND zc.zalo_id=payload->>'uid'));
   IF count_matches>1 THEN RAISE EXCEPTION 'ACCOUNT_UID_AMBIGUOUS'; END IF;
   IF h.target_id IS NOT NULL AND target IS DISTINCT FROM h.target_id THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF target IS NOT NULL THEN
     SELECT * INTO a FROM public.auto_accounts WHERE id=target;
     IF a.flatform_type IS DISTINCT FROM 'zalo' OR a.is_zalo_server IS DISTINCT FROM true OR coalesce(a.is_zalo_show_web,false) THEN RAISE EXCEPTION 'ACCOUNT_MODE_CONFLICT'; END IF;
     IF EXISTS(SELECT 1 FROM public.zalo_accounts z WHERE z.id=a.zalo_account_id AND z.zalo_uid IS DISTINCT FROM payload->>'uid')
       OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
         WHERE b.auto_account_id=a.id AND b.organization_id=org_id AND b.is_active AND z.zalo_id IS DISTINCT FROM payload->>'uid') THEN RAISE EXCEPTION 'ACCOUNT_UID_AMBIGUOUS'; END IF;
   ELSE
     IF dry THEN
       SELECT count(*) INTO actual_count FROM public.auto_accounts account WHERE account.staff_id=staff_id
         AND (account.organization_id=org_id OR account.organization_id IS NULL) AND account.flatform_type='zalo' AND NOT coalesce(account.is_delete,false)
         AND (CASE WHEN coalesce(account.is_zalo_show_web,false) THEN 'web' WHEN coalesce(account.is_zalo_server,false) THEN 'server' ELSE 'qr' END)
           IN (SELECT account_subtype FROM private.resolve_organization_zalo_entitlement_pools(org_id) WHERE entitlement_id=pool.entitlement_id);
       IF pool.max_accounts>0 AND actual_count+coalesce((p->>'planned_accounts')::integer,0)>=pool.max_accounts THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED'; END IF;
       RETURN jsonb_build_object('created',true,'account_id',null,'already_imported',false);
     END IF;
     result:=public.create_control_zalo_account_atomic(staff_id,org_id,NULL,jsonb_build_object('name',payload->>'name','isActive',payload->'isActive'));
     IF NOT coalesce((result->>'created')::boolean,false) THEN RAISE EXCEPTION 'ACCOUNT_CREATE_REJECTED'; END IF;
     target:=(result->>'account_id')::bigint; created:=true;
     INSERT INTO public.zalo_accounts(zalo_uid,display_name,phone) VALUES(payload->>'uid',payload->>'name',payload->>'phone') ON CONFLICT(zalo_uid) DO NOTHING;
     SELECT id INTO profile_id FROM public.zalo_accounts WHERE zalo_uid=payload->>'uid';
     UPDATE public.auto_accounts SET zalo_account_id=profile_id WHERE id=target;
   END IF;
   IF NOT dry AND h.id IS NULL THEN n.target_id:=target; n.state:='complete'; n.data:=jsonb_build_object('created',created,'uid',payload->>'uid'); INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   ELSIF NOT dry AND h.target_id IS NULL THEN UPDATE public.akabiz_zalo_import_history SET target_id=target,state='complete',source_version=n.source_version,error_code=NULL,data=jsonb_build_object('created',created,'uid',payload->>'uid') WHERE id=h.id; END IF;
   RETURN jsonb_build_object('account_id',target::text,'created',created,'already_imported',h.target_id IS NOT NULL);
 END IF;
 IF op='dependency' AND entity_kind IN ('tag','blocklist','blocklist_member') THEN
   IF entity_kind='blocklist' AND coalesce((payload->>'member_count')::integer,-1)<0 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   IF h.target_id IS NOT NULL THEN
     IF h.source_version IS DISTINCT FROM n.source_version THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
     IF entity_kind='blocklist' AND (payload->>'member_count')::integer IS DISTINCT FROM (h.data->>'expected_count')::integer THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
     IF entity_kind='tag' THEN SELECT md5(to_jsonb(t)::text) INTO hash FROM public.auto_contact_tags t WHERE t.id=h.target_id AND t.staff_id=staff_id AND t.organization_id=org_id AND NOT coalesce(t.is_delete,false);
     ELSIF entity_kind='blocklist' THEN SELECT md5(to_jsonb(t)::text) INTO hash FROM public.auto_account_contact_groups t WHERE t.id=h.target_id AND t.staff_id=staff_id AND t.organization_id=org_id
       AND t.account_id=(payload->>'account_id')::bigint AND NOT coalesce(t.is_delete,false);
     ELSE SELECT md5(to_jsonb(t)::text) INTO hash FROM public.auto_account_contact_group_members t
       JOIN public.auto_account_contacts contact ON contact.id=t.contact_id
       JOIN public.auto_account_contact_groups g ON g.id=t.group_id
       WHERE t.id=h.target_id AND NOT t.is_delete AND NOT coalesce(contact.is_delete,false) AND NOT coalesce(g.is_delete,false)
         AND contact.account_id=(payload->>'account_id')::bigint AND contact.staff_id=staff_id AND contact.organization_id=org_id
         AND contact.uid=payload->>'uid' AND g.id=(payload->>'group_id')::bigint AND g.account_id=contact.account_id
         AND g.staff_id=staff_id AND g.organization_id=org_id; END IF;
     IF hash IS DISTINCT FROM h.data->>'target_hash' THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
     RETURN jsonb_build_object('target_id',h.target_id::text,'progress',h.data);
   END IF;
   IF dry THEN RETURN jsonb_build_object('target_id',null); END IF;
   IF entity_kind='tag' THEN
     INSERT INTO public.auto_contact_tags(name,color,staff_id,organization_id,is_delete)
       VALUES(payload->>'name',payload->>'color',staff_id,org_id,false) RETURNING id,md5(to_jsonb(auto_contact_tags)::text) INTO target,hash;
   ELSE
     SELECT * INTO a FROM public.auto_accounts WHERE id=(payload->>'account_id')::bigint AND auto_accounts.staff_id=staff_id AND organization_id=org_id AND NOT coalesce(is_delete,false);
     IF a.id IS NULL OR a.is_zalo_server IS DISTINCT FROM true OR coalesce(a.is_zalo_show_web,false) THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
     IF entity_kind='blocklist' THEN
       INSERT INTO public.auto_account_contact_groups(name,purpose,contact_type,account_id,staff_id,organization_id,is_delete)
         VALUES(payload->>'name','zalo_friend_blocklist','person',a.id,staff_id,org_id,false) RETURNING id,md5(to_jsonb(auto_account_contact_groups)::text) INTO target,hash;
     ELSE
       PERFORM 1 FROM public.akabiz_zalo_import_history x JOIN public.auto_account_contact_groups g ON g.id=x.target_id
         WHERE x.kind='blocklist' AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
         AND x.target_staff_id=staff_id AND x.target_organization_id=org_id AND x.target_id=(payload->>'group_id')::bigint
         AND g.account_id=a.id AND NOT coalesce(g.is_delete,false);
       IF NOT FOUND OR coalesce(payload->>'uid','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
       SELECT id INTO profile_id FROM public.auto_account_contacts t WHERE t.account_id=a.id AND t.contact_type='person' AND t.uid=payload->>'uid'
         AND t.staff_id=staff_id AND t.organization_id=org_id AND NOT coalesce(t.is_delete,false);
       IF profile_id IS NULL THEN
         IF EXISTS(SELECT 1 FROM public.auto_account_contacts t WHERE t.account_id=a.id AND t.contact_type='person' AND t.uid=payload->>'uid') THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
         INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,staff_id,organization_id,is_delete,flatform_type)
           VALUES(a.id,'person',payload->>'uid',payload->>'uid',staff_id,org_id,false,'zalo') RETURNING id INTO profile_id;
       END IF;
       INSERT INTO public.auto_account_contact_group_members(group_id,contact_id,is_delete) VALUES((payload->>'group_id')::bigint,profile_id,false)
         RETURNING id,md5(to_jsonb(auto_account_contact_group_members)::text) INTO target,hash;
     END IF;
   END IF;
   n.target_id:=target; n.state:='complete'; n.data:=jsonb_build_object('target_hash',hash);
   IF entity_kind='blocklist' THEN
     n.data:=n.data||jsonb_build_object('expected_count',(payload->>'member_count')::integer,'next_offset',0,'account_id',a.id::text);
     n.state:=CASE WHEN (payload->>'member_count')::integer=0 THEN 'complete' ELSE 'pending' END;
   END IF;
   INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   RETURN jsonb_build_object('target_id',target::text,'progress',n.data);
 END IF;
 IF op='blocklist_members' AND entity_kind='blocklist' THEN
   IF h.target_id IS NULL THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF h.source_version IS DISTINCT FROM n.source_version THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
   expected_offset:=(payload->>'expected_offset')::integer; next_offset:=(payload->>'next_offset')::integer;
   IF jsonb_typeof(payload->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'members') NOT BETWEEN 1 AND 500
     OR expected_offset IS NULL OR expected_offset<0 OR next_offset IS DISTINCT FROM expected_offset+jsonb_array_length(payload->'members')
     OR coalesce((h.data->>'expected_count')::integer,-1)<next_offset THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   PERFORM 1 FROM public.auto_account_contact_groups g WHERE g.id=h.target_id AND g.account_id=(h.data->>'account_id')::bigint
     AND g.staff_id=staff_id AND g.organization_id=org_id AND NOT g.is_delete AND md5(to_jsonb(g)::text)=h.data->>'target_hash' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF (SELECT count(*) FROM public.akabiz_zalo_import_history x WHERE x.kind='blocklist_member' AND x.parent_source_id=source_key
     AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
     AND x.target_staff_id=staff_id AND x.target_organization_id=org_id) IS DISTINCT FROM (h.data->>'next_offset')::bigint THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   batch_hash:=md5((payload->'members')::text);
   IF expected_offset IS DISTINCT FROM (h.data->>'next_offset')::integer THEN
     IF next_offset=(h.data->>'next_offset')::integer AND expected_offset=(h.data->>'last_batch_start')::integer
       AND batch_hash=h.data->>'last_batch_hash' THEN RETURN jsonb_build_object('progress',h.data); END IF;
     RAISE EXCEPTION 'IMPORT_CURSOR_CONFLICT';
   END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(payload->'members') LOOP
     PERFORM public.akabiz_import_sql_zalo_web_v1(jsonb_build_object('operation','dependency','run_id',r.run_id,'lease_token',p->>'lease_token',
       'kind','blocklist_member','source_id',source_key||':'||(item->>'uid'),'parent_source_id',source_key,'source_version',item->>'source_version',
       'payload',jsonb_build_object('uid',item->>'uid','group_id',h.target_id::text,'account_id',h.data->>'account_id')));
   END LOOP;
   IF (SELECT count(*) FROM public.akabiz_zalo_import_history x WHERE x.kind='blocklist_member' AND x.parent_source_id=source_key
     AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
     AND x.target_staff_id=staff_id AND x.target_organization_id=org_id)<>next_offset THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   -- The cursor commits with member rows and mappings, including after a lost response.
   UPDATE public.akabiz_zalo_import_history SET data=data||jsonb_build_object('next_offset',next_offset,'last_batch_start',expected_offset,'last_batch_hash',batch_hash),
     state=CASE WHEN next_offset=(data->>'expected_count')::integer THEN 'complete' ELSE 'pending' END,updated_at=clock_timestamp()
     WHERE id=h.id RETURNING * INTO h;
   RETURN jsonb_build_object('progress',h.data);
 END IF;
 IF entity_kind<>'campaign' OR op NOT IN ('campaign','inputs','publish','preview') THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
 IF h.target_id IS NOT NULL THEN
   IF dry THEN SELECT * INTO c FROM public.auto_campaigns WHERE id=h.target_id AND auto_campaigns.staff_id=staff_id AND organization_id=org_id;
   ELSE SELECT * INTO c FROM public.auto_campaigns WHERE id=h.target_id AND auto_campaigns.staff_id=staff_id AND organization_id=org_id FOR UPDATE; END IF;
   IF c.id IS NULL THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF h.state='complete' THEN
     IF coalesce(c.is_delete,false) THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
     RETURN jsonb_build_object('campaign_id',c.id::text,'already_imported',true,'progress',h.data);
   END IF;
   IF c.is_delete IS DISTINCT FROM true OR c.status IS DISTINCT FROM 'tạm dừng' OR md5(to_jsonb(c)::text) IS DISTINCT FROM h.data->>'target_hash' THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF h.source_version IS DISTINCT FROM n.source_version THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
 END IF;
 IF h.target_id IS NOT NULL AND op IN ('campaign','preview','publish') THEN
   -- Validate the stored campaign's references, never labels freshly remapped by a retry.
   config:=c.extra_settings; label_checks:='[]';
   IF config->>'zaloFriendTargetMode'='tagged_friends' THEN
     IF jsonb_typeof(config->'zaloFriendSourceTagIds') IS DISTINCT FROM 'array'
       OR jsonb_typeof(config->'zaloFriendSourceTagNames') IS DISTINCT FROM 'array'
       OR jsonb_array_length(config->'zaloFriendSourceTagIds')=0
       OR jsonb_array_length(config->'zaloFriendSourceTagIds')<>jsonb_array_length(config->'zaloFriendSourceTagNames') THEN RAISE EXCEPTION 'ZALO_LABELS_REQUIRED'; END IF;
     SELECT jsonb_agg(jsonb_build_object('uid',tag.value,'name',config->'zaloFriendSourceTagNames'->>((tag.position-1)::integer))) INTO label_checks
       FROM jsonb_array_elements_text(config->'zaloFriendSourceTagIds') WITH ORDINALITY AS tag(value,position);
   END IF;
   IF coalesce((config->>'enableZaloTag')::boolean,false) THEN
     label_checks:=label_checks||jsonb_build_array(jsonb_build_object('uid',config->>'zaloTagId','name',config->>'zaloTagName'));
   END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(label_checks) LOOP
     IF coalesce(item->>'uid','')='' OR coalesce(item->>'name','')='' THEN RAISE EXCEPTION 'ZALO_LABELS_REQUIRED'; END IF;
     IF NOT dry THEN PERFORM 1 FROM public.auto_account_contacts t WHERE t.account_id=c.account_id AND t.staff_id=staff_id AND t.organization_id=org_id
       AND t.contact_type='zalo_tag' AND NOT coalesce(t.is_delete,false) AND t.name=item->>'name' FOR SHARE; END IF;
     SELECT count(*) INTO count_matches FROM public.auto_account_contacts t WHERE t.account_id=c.account_id AND t.staff_id=staff_id AND t.organization_id=org_id
       AND t.contact_type='zalo_tag' AND NOT coalesce(t.is_delete,false) AND t.name=item->>'name';
     IF count_matches<>1 THEN RAISE EXCEPTION 'ZALO_LABELS_REQUIRED'; END IF;
     IF NOT EXISTS(SELECT 1 FROM public.auto_account_contacts t WHERE t.account_id=c.account_id AND t.staff_id=staff_id AND t.organization_id=org_id
       AND t.contact_type='zalo_tag' AND NOT coalesce(t.is_delete,false) AND t.name=item->>'name' AND t.uid=item->>'uid') THEN RAISE EXCEPTION 'ZALO_LABEL_MAPPING_CONFLICT'; END IF;
   END LOOP;
 END IF;
 IF op='preview' AND h.target_id IS NULL THEN RETURN jsonb_build_object('exists',false); END IF;
 IF op='campaign' THEN
   IF h.target_id IS NOT NULL THEN RETURN jsonb_build_object('campaign_id',c.id::text,'already_imported',false,'progress',h.data); END IF;
   config:=payload->'campaign'; desired:=payload->>'desiredStatus';
   IF desired NOT IN ('chờ xử lý','tạm dừng') OR coalesce((payload->>'input_count')::bigint,-1)<0 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   SELECT * INTO a FROM public.auto_accounts WHERE id=(config->>'accountId')::bigint AND auto_accounts.staff_id=staff_id AND organization_id=org_id AND NOT coalesce(is_delete,false) FOR SHARE;
   IF a.id IS NULL OR a.flatform_type IS DISTINCT FROM 'zalo' OR a.is_zalo_server IS DISTINCT FROM true OR coalesce(a.is_zalo_show_web,false) THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_actions ac WHERE ac.id=config->>'actionId' AND ac.is_active=true AND NOT coalesce(ac.is_delete,false)) THEN RAISE EXCEPTION 'ACTION_UNAVAILABLE'; END IF;
   INSERT INTO public.auto_campaigns(name,account_id,action_id,status,is_delete,staff_id,organization_id,schedule,original_schedule,
     schedule_type,schedule_end_date,schedule_days,schedule_week_days,daily_stop_time,continue_next_day,refresh_data,time_sleep_between_2,content,images,extra_settings)
   VALUES(config->>'name',a.id,config->>'actionId','tạm dừng',true,staff_id,org_id,(config->>'schedule')::timestamptz,(config->>'originalSchedule')::timestamptz,
     config->>'scheduleType',(config->>'scheduleEndDate')::timestamptz,config->>'scheduleDays',config->>'scheduleWeekDays',(config->>'dailyStopTime')::time,
     (config->>'continueNextDay')::boolean,(config->>'refreshData')::boolean,(config->>'timeSleepBetween2')::integer,config->>'content',config->'images',config->'extraSettings') RETURNING * INTO c;
   n.target_id:=c.id; n.data:=jsonb_build_object('target_hash',md5(to_jsonb(c)::text),'desired_status',desired,'expected_count',payload->'input_count','imported_count',0,'cursor',null);
   IF h.id IS NULL THEN INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   ELSE UPDATE public.akabiz_zalo_import_history SET target_id=n.target_id,parent_source_id=n.parent_source_id,source_version=n.source_version,source_status=n.source_status,state='pending',data=n.data,adjustments=n.adjustments,error_code=NULL WHERE id=h.id; END IF;
   RETURN jsonb_build_object('campaign_id',c.id::text,'already_imported',false,'progress',n.data);
 END IF;
 IF h.target_id IS NULL THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
 -- Do not reread/hash or lock previously imported inputs for each batch.
 -- The run/campaign locks, unique mappings and atomic cursor prevent duplicates.
 IF op='preview' THEN RETURN jsonb_build_object('exists',true,'progress',h.data); END IF;
 IF op='inputs' THEN
   IF jsonb_typeof(payload->'inputs') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'inputs')>500 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   IF h.data->'cursor' IS DISTINCT FROM coalesce(payload->'expected_cursor','null'::jsonb) THEN
     -- A lost response may be retried. Only the exact already-committed cursor is accepted.
     IF h.data->'cursor'=payload->'cursor' THEN RETURN jsonb_build_object('progress',h.data); END IF;
     RAISE EXCEPTION 'IMPORT_CURSOR_CONFLICT';
   END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(payload->'inputs') LOOP
     mapped_status:=CASE (item->>'source_status')::integer WHEN 1 THEN 'chờ xử lý' WHEN 0 THEN 'tạm dừng'
       WHEN 2 THEN 'hoàn thành' WHEN 4 THEN 'hoàn thành' WHEN 5 THEN 'hoàn thành' WHEN 10 THEN 'hoàn thành' WHEN 13 THEN 'hoàn thành'
       WHEN 51 THEN 'hoàn thành' WHEN 52 THEN 'hoàn thành' WHEN 53 THEN 'hoàn thành' WHEN 54 THEN 'hoàn thành' END;
     IF mapped_status IS NULL OR mapped_status IS DISTINCT FROM item->>'status' OR item->>'source_id' IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DETAIL_STATUS'; END IF;
     INSERT INTO public.auto_campaign_input_data(campaign_id,name,phone,uid,email,info1,info2,info3,info4,info5,status,is_delete)
       VALUES(c.id,item->>'name',item->>'phone',item->>'uid',item->>'email',item->>'info1',item->>'info2',item->>'info3',item->>'info4',item->>'info5',mapped_status,false)
       RETURNING id INTO target;
     n.id:=gen_random_uuid(); n.kind:='input'; n.source_id:=item->>'source_id'; n.parent_source_id:=source_key; n.target_id:=target;
     n.source_version:=item->>'source_hash'; n.source_status:=item->>'source_status'; n.state:='complete'; n.adjustments:='[]';
     n.data:=jsonb_build_object('imported_status',mapped_status); INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   END LOOP;
   UPDATE public.akabiz_zalo_import_history SET data=data||jsonb_build_object('cursor',payload->'cursor','imported_count',(data->>'imported_count')::bigint+jsonb_array_length(payload->'inputs')),error_code=NULL,state='pending',updated_at=clock_timestamp() WHERE id=h.id RETURNING * INTO h;
   IF (h.data->>'imported_count')::bigint>(h.data->>'expected_count')::bigint THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
   RETURN jsonb_build_object('progress',h.data);
 END IF;
 IF (h.data->>'imported_count')::bigint IS DISTINCT FROM (h.data->>'expected_count')::bigint THEN RAISE EXCEPTION 'IMPORT_INCOMPLETE'; END IF;
 -- One count at completion catches missing/extra/deleted inputs. Content/status
 -- edits outside the importer are accepted; no full-row comparison is performed.
 SELECT count(*) INTO actual_count FROM public.auto_campaign_input_data i WHERE i.campaign_id=c.id AND NOT coalesce(i.is_delete,false);
 IF actual_count IS DISTINCT FROM (h.data->>'imported_count')::bigint THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 PERFORM 1 FROM public.auto_accounts account WHERE account.id=c.account_id AND account.staff_id=staff_id AND account.organization_id=org_id
   AND account.flatform_type='zalo' AND account.is_zalo_server=true AND NOT coalesce(account.is_zalo_show_web,false) AND NOT coalesce(account.is_delete,false) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 SELECT x.data->>'uid' INTO desired FROM public.akabiz_zalo_import_history x WHERE x.kind='account' AND x.source_id=h.parent_source_id
   AND x.target_id=c.account_id AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
   AND x.target_staff_id=staff_id AND x.target_organization_id=org_id;
 IF desired IS NULL OR NOT EXISTS(SELECT 1 FROM public.auto_accounts account LEFT JOIN public.zalo_accounts z ON z.id=account.zalo_account_id
   WHERE account.id=c.account_id AND (z.zalo_uid=desired OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account zc ON zc.id=b.chat_zalo_account_id
     WHERE b.auto_account_id=account.id AND b.organization_id=org_id AND b.is_active AND zc.zalo_id=desired)))
   OR EXISTS(SELECT 1 FROM public.auto_accounts account JOIN public.zalo_accounts z ON z.id=account.zalo_account_id
     WHERE account.id=c.account_id AND z.zalo_uid IS DISTINCT FROM desired)
   OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
     WHERE b.auto_account_id=c.account_id AND b.organization_id=org_id AND b.is_active AND z.zalo_id IS DISTINCT FROM desired) THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(c.extra_settings->'akaBizTagIds','[]')) LOOP
   PERFORM 1 FROM public.auto_contact_tags t WHERE t.id=(item#>>'{}')::bigint AND t.staff_id=staff_id AND t.organization_id=org_id AND NOT coalesce(t.is_delete,false) FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.auto_contact_tags t JOIN public.akabiz_zalo_import_history x ON x.target_id=t.id AND x.kind='tag'
     WHERE t.id=(item#>>'{}')::bigint AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
       AND x.target_staff_id=staff_id AND x.target_organization_id=org_id AND md5(to_jsonb(t)::text)=x.data->>'target_hash') THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 END LOOP;
 IF coalesce((c.extra_settings->>'zaloFriendBlocklistEnabled')::boolean,false) THEN
   PERFORM 1 FROM public.auto_account_contact_groups g WHERE g.id=(c.extra_settings->>'zaloFriendBlocklistId')::bigint
     AND g.account_id=c.account_id AND g.staff_id=staff_id AND g.organization_id=org_id AND g.purpose='zalo_friend_blocklist' AND NOT coalesce(g.is_delete,false) FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   SELECT x.* INTO block_history FROM public.akabiz_zalo_import_history x WHERE x.kind='blocklist' AND x.target_id=(c.extra_settings->>'zaloFriendBlocklistId')::bigint
     AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
     AND x.target_staff_id=staff_id AND x.target_organization_id=org_id;
   IF block_history.id IS NULL OR block_history.state<>'complete' OR block_history.data->>'next_offset' IS DISTINCT FROM block_history.data->>'expected_count'
     OR (SELECT count(*) FROM public.akabiz_zalo_import_history x WHERE x.kind='blocklist_member' AND x.parent_source_id=block_history.source_id
       AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
       AND x.target_staff_id=staff_id AND x.target_organization_id=org_id) IS DISTINCT FROM (block_history.data->>'expected_count')::bigint THEN RAISE EXCEPTION 'IMPORT_INCOMPLETE'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_groups g JOIN public.akabiz_zalo_import_history x ON x.target_id=g.id AND x.kind='blocklist'
     WHERE g.id=(c.extra_settings->>'zaloFriendBlocklistId')::bigint AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
       AND x.target_staff_id=staff_id AND x.target_organization_id=org_id AND md5(to_jsonb(g)::text)=x.data->>'target_hash') THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF EXISTS(SELECT 1 FROM public.akabiz_zalo_import_history x LEFT JOIN public.auto_account_contact_group_members m ON m.id=x.target_id
     LEFT JOIN public.auto_account_contacts contact ON contact.id=m.contact_id
     WHERE x.kind='blocklist_member' AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id AND x.source_staff_id=r.source_staff_id
       AND x.target_staff_id=staff_id AND x.target_organization_id=org_id
       AND x.parent_source_id=(SELECT b.source_id FROM public.akabiz_zalo_import_history b WHERE b.kind='blocklist'
         AND b.source_system=r.source_system AND b.source_account_id=r.source_account_id AND b.source_staff_id=r.source_staff_id
         AND b.target_staff_id=staff_id AND b.target_organization_id=org_id AND b.target_id=(c.extra_settings->>'zaloFriendBlocklistId')::bigint)
       AND (md5(to_jsonb(m)::text) IS DISTINCT FROM x.data->>'target_hash' OR coalesce(contact.is_delete,true) OR contact.account_id IS DISTINCT FROM c.account_id
         OR contact.uid IS DISTINCT FROM split_part(x.source_id,':',2))) THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_members m LEFT JOIN public.akabiz_zalo_import_history x
     ON x.target_id=m.id AND x.kind='blocklist_member' AND x.source_system=r.source_system AND x.source_account_id=r.source_account_id
       AND x.source_staff_id=r.source_staff_id AND x.target_staff_id=staff_id AND x.target_organization_id=org_id
     WHERE m.group_id=(c.extra_settings->>'zaloFriendBlocklistId')::bigint AND x.id IS NULL) THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 END IF;
 UPDATE public.auto_campaigns SET is_delete=false,status=h.data->>'desired_status',updated_at=clock_timestamp() WHERE id=c.id;
 UPDATE public.akabiz_zalo_import_history SET state='complete',error_code=NULL,updated_at=clock_timestamp() WHERE id=h.id;
 RETURN jsonb_build_object('campaign_id',c.id::text,'published',true,'progress',h.data);
END;
$function$;
ALTER FUNCTION public.akabiz_import_sql_zalo_web_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.akabiz_import_sql_zalo_web_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.akabiz_import_sql_zalo_web_v1(jsonb) TO service_role;
COMMIT;
