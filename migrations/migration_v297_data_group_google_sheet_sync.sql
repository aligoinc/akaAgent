-- Google Sheet sources: append-only, tenant-scoped, cloud scheduled.
-- Live definitions and checksums captured 2026-09-20; see docs/DATA_GROUP_GOOGLE_SHEET_SYNC.md.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

DO $preflight$
DECLARE v_signature text; v_expected text;
BEGIN
  FOR v_signature,v_expected IN SELECT * FROM (VALUES
    ('public.aka_agent_get_data_group_panel(bigint,bigint,bigint,text,text)','0365d8eae3b99217e5063f0e5cbaa480'),
    ('public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)','221ed55d3a0acbfb6a4f1c1491f0915d'),
    ('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)','544d36b2c232653ce3168cd18ae25266'),
    ('public.aka_agent_data_group_source_code(text)','4c1ea3a984cd3c3c38d04b6ee6be8e3b'),
    ('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint)','357a849364fe21ee3d34876706f18bc2'),
    ('public.aka_agent_run_data_group_dynamic_filter_worker(integer,integer)','56510e2f6e8450b684486336e773746d')
  ) checks(signature,checksum) LOOP
    IF to_regprocedure(v_signature) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_signature))) IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'v297 RPC drift: %',v_signature;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='aka-agent-data-group-dynamic-filter-worker'
    AND command='SELECT public.aka_agent_run_data_group_dynamic_filter_worker(5, 100);'
    AND schedule='30 seconds' AND active) THEN RAISE EXCEPTION 'v297 cron drift'; END IF;
END;
$preflight$;

CREATE TABLE public.auto_data_group_external_sync_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id),
  staff_id bigint NOT NULL, organization_id bigint NOT NULL,
  create_request_id text NOT NULL, create_request_hash text NOT NULL,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object' AND octet_length(config::text)<=262144),
  data_type_category_item_id bigint NOT NULL REFERENCES public.category_item(id),
  source_account_id bigint REFERENCES public.auto_accounts(id),
  every_hours integer NOT NULL CHECK(every_hours BETWEEN 1 AND 8760),
  end_date date, is_enabled boolean NOT NULL DEFAULT true, is_delete boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','paused','success','retry','error','expired')),
  next_run_at timestamptz, last_run_at timestamptz, last_error text,
  row_count integer NOT NULL DEFAULT 0, added_count bigint NOT NULL DEFAULT 0, last_added_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0, run_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_id,organization_id,create_request_id)
);
CREATE INDEX idx_data_group_external_sync_due ON public.auto_data_group_external_sync_sources(next_run_at,id)
  WHERE is_enabled AND NOT is_delete AND status IN ('pending','success','retry','running');
CREATE INDEX idx_data_group_external_sync_group ON public.auto_data_group_external_sync_sources(group_id,id) WHERE NOT is_delete;

CREATE TABLE public.auto_data_group_external_sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id bigint NOT NULL REFERENCES public.auto_data_group_external_sync_sources(id),
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id),
  staff_id bigint NOT NULL, organization_id bigint NOT NULL,
  source_name text NOT NULL, token uuid NOT NULL UNIQUE, source_revision bigint NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','error','cancelled','interrupted')),
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  row_count integer NOT NULL DEFAULT 0, added_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0, invalid_count integer NOT NULL DEFAULT 0,
  error text, result jsonb
);
CREATE INDEX idx_data_group_external_sync_runs_group ON public.auto_data_group_external_sync_runs(group_id,id DESC);

CREATE TABLE public.auto_data_group_external_sync_seen (
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id),
  source_id bigint NOT NULL REFERENCES public.auto_data_group_external_sync_sources(id),
  staff_id bigint NOT NULL, organization_id bigint NOT NULL,
  data_type_code text NOT NULL, account_scope bigint NOT NULL DEFAULT 0,
  identity_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,data_type_code,account_scope,identity_key)
);
CREATE TABLE public.auto_data_group_sheet_worker_state (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  enabled boolean NOT NULL DEFAULT false,
  token uuid, claimed boolean NOT NULL DEFAULT false, lease_expires_at timestamptz,
  next_dispatch_at timestamptz NOT NULL DEFAULT now(), last_error text
);
INSERT INTO public.auto_data_group_sheet_worker_state(id) VALUES(true);

ALTER TABLE public.auto_data_group_external_sync_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_data_group_external_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_data_group_external_sync_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_data_group_sheet_worker_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_data_group_external_sync_sources,public.auto_data_group_external_sync_runs,
  public.auto_data_group_external_sync_seen,public.auto_data_group_sheet_worker_state FROM PUBLIC,anon,authenticated;

INSERT INTO public.category_item(category_type_id,code,name,managed_by,sort_order,color)
SELECT id,'external_sync','Đồng bộ ngoài','system',50,'#7c3aed' FROM public.category_type
WHERE namespace='common' AND code='data_source' AND managed_by='system';
ALTER TABLE public.auto_data_ingest_batches DROP CONSTRAINT auto_data_ingest_batches_kind_check;
ALTER TABLE public.auto_data_ingest_batches ADD CONSTRAINT auto_data_ingest_batches_kind_check
  CHECK(kind IS NULL OR kind IN ('manual','upload','scan','automation','api','external_sync','legacy','legacy_unknown'));
ALTER TABLE public.auto_account_contact_group_member_origins DROP CONSTRAINT auto_account_contact_group_member_origins_kind_check;
ALTER TABLE public.auto_account_contact_group_member_origins ADD CONSTRAINT auto_account_contact_group_member_origins_kind_check
  CHECK(kind IN ('manual','upload','scan','automation','dynamic_filter','api','external_sync','legacy','legacy_unknown'));

-- This key is shared by preview, the append transaction, existing group members,
-- tombstones, and the durable seen ledger. It does not rewrite contact identity.
CREATE FUNCTION public.aka_agent_sheet_identity(p_type text,p_row jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog,public AS $fn$
DECLARE v text; v_id text; v_path text;
BEGIN
  IF p_type='phone' THEN
    v:=public.aka_agent_internal_normalize_phone(COALESCE(NULLIF(p_row->>'phone',''),p_row->>'uid'));
    RETURN CASE WHEN v ~ '^0[35789][0-9]{8}$' THEN v ELSE NULL END;
  ELSIF p_type='email' THEN
    v:=lower(btrim(COALESCE(NULLIF(p_row->>'email',''),p_row->>'uid','')));
    RETURN CASE WHEN length(v)<=254 AND v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v ELSE NULL END;
  ELSIF p_type='facebook_search_keyword' THEN
    RETURN NULLIF(lower(regexp_replace(btrim(COALESCE(p_row->>'uid','')),'[[:space:]]+',' ','g')),'');
  ELSIF p_type='zalo_person' THEN
    v:=btrim(COALESCE(p_row->>'uid','')); RETURN CASE WHEN v ~ '^[0-9]+$' AND length(v)<=100 THEN v ELSE NULL END;
  ELSIF p_type='zalo_group' THEN
    v:=COALESCE(NULLIF(p_row->>'url',''),p_row->>'uid','');
    v_id:=substring(v from '^(?:https?://)?(?:www\.)?(?:zalo\.me/g/|zaloapp\.com/qr/g/)([A-Za-z0-9_-]+)(?:[/?#].*)?$');
    RETURN CASE WHEN v_id IS NOT NULL THEN 'zalo.me/g/'||v_id ELSE NULL END;
  ELSIF p_type IN ('facebook_person','facebook_group','facebook_page','facebook_post_url') THEN
    v:=btrim(COALESCE(NULLIF(p_row->>'uid',''),p_row->>'url',''));
    IF v ~ '^[0-9]+$' AND p_type<>'facebook_post_url' THEN RETURN v; END IF;
    IF v !~* '^(https?://)?(www\.|m\.|mbasic\.)?(facebook\.com|fb\.com)/[^[:space:]]+$' THEN RETURN NULL; END IF;
    v:=regexp_replace(v,'^(https?://)?(www\.|m\.|mbasic\.)?(facebook\.com|fb\.com)/','','i');
    v:=split_part(v,'#',1); v_path:=regexp_replace(split_part(v,'?',1),'/$','');
    IF p_type='facebook_group' THEN
      v_id:=substring(v_path from '^groups/([^/]+)'); RETURN lower(v_id);
    ELSIF p_type='facebook_post_url' THEN
      v_id:=substring(v from '[?&](?:story_fbid|fbid)=([0-9]+)');
      IF v_id IS NOT NULL THEN RETURN 'post:'||v_id; END IF;
      v_id:=substring(v_path from '/posts/([^/]+)');
      IF v_id IS NOT NULL THEN RETURN 'post:'||v_id; END IF;
      RETURN lower(v_path);
    ELSE
      v_id:=substring(v from '[?&]id=([0-9]+)');
      RETURN COALESCE(v_id,NULLIF(lower(v_path),''));
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE FUNCTION public.aka_agent_data_group_external_sync(
  p_staff_id bigint,p_organization_id bigint,p_auth_username text,p_auth_password text,p_action text,p_data jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public SET statement_timeout TO '60s' AS $fn$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_source public.auto_data_group_external_sync_sources%ROWTYPE;
  v_config jsonb; v_type_id bigint; v_type text; v_end date; v_hours integer; v_enabled boolean;
  v_result jsonb; v_hash text; v_id bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR COALESCE(p_data->>'groupId','') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
  -- The same group-first lock order is used by mutations, claims and ingestion.
  SELECT * INTO v_group FROM public.auto_account_contact_groups
    WHERE id=(p_data->>'groupId')::bigint AND staff_id=p_staff_id AND organization_id=p_organization_id
      AND purpose='data_group' AND NOT is_delete;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF p_action IN ('save','toggle','delete') THEN
    SELECT * INTO v_group FROM public.auto_account_contact_groups WHERE id=v_group.id AND NOT is_delete FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  END IF;
  IF p_action='check' THEN RETURN jsonb_build_object('ok',true); END IF;
  IF p_action='list' THEN
    RETURN jsonb_build_object('sources',COALESCE((SELECT jsonb_agg(to_jsonb(s)-'staff_id'-'organization_id'-'create_request_id'-'create_request_hash'-'run_token'
      ORDER BY s.id) FROM public.auto_data_group_external_sync_sources s WHERE s.group_id=v_group.id AND NOT s.is_delete),'[]'::jsonb),
      'runs',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'token'-'staff_id'-'organization_id'-'result' ORDER BY r.id DESC)
        FROM (SELECT * FROM public.auto_data_group_external_sync_runs WHERE group_id=v_group.id ORDER BY id DESC LIMIT 30) r),'[]'::jsonb));
  END IF;
  IF p_action IN ('save','preview') THEN
    v_config:=p_data->'config'; PERFORM public.aka_agent_sheet_validate_config(v_config);
    v_type:=v_config->>'dataTypeCode';
    SELECT ci.id INTO v_type_id FROM public.category_item ci JOIN public.category_type ct ON ct.id=ci.category_type_id
      WHERE ct.namespace='common' AND ct.code='data_type' AND ci.code=v_type AND ci.is_active AND ct.is_active;
    IF v_type_id IS NULL OR (v_group.data_type_category_item_id IS NOT NULL AND v_group.data_type_category_item_id<>v_type_id)
      OR (v_group.bound_zalo_account_id IS NOT NULL AND (v_type NOT IN ('zalo_person','zalo_group') OR
        NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id)))
    THEN RAISE EXCEPTION 'sheet_sync_type'; END IF;
  END IF;
  IF p_action='preview' THEN
    v_result:=public.aka_agent_sheet_classify(v_group.id,v_type,p_data->'rows');
    RETURN v_result-'rows'-'keys';
  END IF;
  IF p_action='save' THEN
    IF COALESCE(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{1,100}$' OR length(btrim(COALESCE(p_data->>'name',''))) NOT BETWEEN 1 AND 200
      OR COALESCE(p_data->>'everyHours','') !~ '^[0-9]{1,4}$' OR jsonb_typeof(p_data->'isEnabled') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
    v_hours:=(p_data->>'everyHours')::integer; v_end:=NULLIF(p_data->>'endDate','')::date;
    v_enabled:=(p_data->>'isEnabled')::boolean;
    IF v_hours NOT BETWEEN 1 AND 8760 THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
    IF v_enabled AND v_end<(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN RAISE EXCEPTION 'sheet_sync_expired'; END IF;
    v_hash:=md5((p_data-'requestId')::text);
    IF p_data->>'id' IS NULL THEN
      SELECT * INTO v_source FROM public.auto_data_group_external_sync_sources
        WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND create_request_id=p_data->>'requestId';
      IF FOUND THEN
        IF v_source.create_request_hash<>v_hash OR v_source.is_delete THEN RAISE EXCEPTION 'sheet_sync_conflict'; END IF;
        RETURN to_jsonb(v_source)-'staff_id'-'organization_id'-'create_request_id'-'create_request_hash'-'run_token';
      ELSE
        INSERT INTO public.auto_data_group_external_sync_sources(group_id,staff_id,organization_id,create_request_id,create_request_hash,name,config,
          data_type_category_item_id,source_account_id,every_hours,end_date,is_enabled,status,next_run_at)
        VALUES(v_group.id,p_staff_id,p_organization_id,p_data->>'requestId',v_hash,btrim(p_data->>'name'),v_config,
          v_type_id,v_group.bound_zalo_account_id,v_hours,v_end,v_enabled,CASE WHEN v_enabled THEN 'pending' ELSE 'paused' END,now()) RETURNING * INTO v_source;
      END IF;
    ELSE
      UPDATE public.auto_data_group_external_sync_sources SET name=btrim(p_data->>'name'),config=v_config,
        data_type_category_item_id=v_type_id,source_account_id=v_group.bound_zalo_account_id,every_hours=v_hours,end_date=v_end,
        is_enabled=v_enabled,status=CASE WHEN v_enabled THEN 'pending' ELSE 'paused' END,next_run_at=now(),
        revision=revision+1,run_token=NULL,last_error=NULL,failure_count=0,updated_at=now()
      WHERE id=(p_data->>'id')::bigint AND group_id=v_group.id AND NOT is_delete AND revision=(p_data->>'expectedRevision')::bigint RETURNING * INTO v_source;
      IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_conflict'; END IF;
    END IF;
    UPDATE public.auto_data_group_external_sync_runs SET status='cancelled',finished_at=now(),error='Nguồn đã được cấu hình lại.'
      WHERE source_id=v_source.id AND status='running';
    RETURN to_jsonb(v_source)-'staff_id'-'organization_id'-'create_request_id'-'create_request_hash'-'run_token';
  END IF;
  IF p_action IN ('toggle','delete') THEN
    SELECT * INTO v_source FROM public.auto_data_group_external_sync_sources WHERE id=(p_data->>'id')::bigint AND group_id=v_group.id AND NOT is_delete FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_not_found'; END IF;
    IF v_source.revision IS DISTINCT FROM (p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'sheet_sync_conflict'; END IF;
    v_enabled:=p_action='toggle' AND COALESCE((p_data->>'enabled')::boolean,false);
    IF v_enabled AND v_source.status='error' THEN RAISE EXCEPTION 'sheet_sync_requires_save'; END IF;
    IF v_enabled AND v_source.end_date<(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN RAISE EXCEPTION 'sheet_sync_expired'; END IF;
    IF v_enabled AND (v_group.bound_zalo_account_id IS DISTINCT FROM v_source.source_account_id
      OR (v_group.data_type_category_item_id IS NOT NULL AND v_group.data_type_category_item_id<>v_source.data_type_category_item_id)) THEN RAISE EXCEPTION 'sheet_sync_type'; END IF;
    UPDATE public.auto_data_group_external_sync_sources SET is_enabled=v_enabled,is_delete=p_action='delete',revision=revision+1,
      status=CASE WHEN v_enabled THEN 'pending' ELSE 'paused' END,next_run_at=now(),run_token=NULL,last_error=NULL,failure_count=0,updated_at=now() WHERE id=v_source.id;
    UPDATE public.auto_data_group_external_sync_runs SET status='cancelled',finished_at=now(),error='Nguồn đã được tắt hoặc thay đổi.' WHERE source_id=v_source.id AND status='running';
    RETURN jsonb_build_object('ok',true);
  END IF;
  RAISE EXCEPTION 'sheet_sync_config';
END;
$fn$;

CREATE FUNCTION public.aka_agent_sheet_dispatch()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $fn$
DECLARE v_state public.auto_data_group_sheet_worker_state%ROWTYPE; v_token uuid; v_request bigint; v_secret text;
BEGIN
  SELECT * INTO v_state FROM public.auto_data_group_sheet_worker_state WHERE id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR NOT v_state.enabled OR v_state.next_dispatch_at>now() OR v_state.lease_expires_at>now() THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_sources WHERE is_enabled AND NOT is_delete
    AND status IN ('pending','success','retry','running') AND next_run_at<=now()) THEN RETURN NULL; END IF;
  v_secret:=public.aka_agent_get_vault_secret('INTERNAL_EDGE_FUNCTION_TOKEN');
  IF NULLIF(v_secret,'') IS NULL THEN
    UPDATE public.auto_data_group_sheet_worker_state SET last_error='Thiếu INTERNAL_EDGE_FUNCTION_TOKEN.',next_dispatch_at=now()+interval '5 minutes' WHERE id; RETURN NULL;
  END IF;
  v_token:=gen_random_uuid();
  UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds',next_dispatch_at=now()+interval '30 seconds',last_error=NULL WHERE id;
  SELECT net.http_post(url:='https://cgjbsmqtfhqvttudyjzq.supabase.co/functions/v1/aka-agent-google-sheet-sync',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-token',v_secret),
    body:=jsonb_build_object('token',v_token),timeout_milliseconds:=120000) INTO v_request;
  RETURN v_request;
END;
$fn$;

CREATE FUNCTION public.aka_agent_sheet_claim(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $fn$
DECLARE v_source public.auto_data_group_external_sync_sources%ROWTYPE; v_group public.auto_account_contact_groups%ROWTYPE;
  v_run_id bigint; v_state public.auto_data_group_sheet_worker_state%ROWTYPE;
BEGIN
  SELECT * INTO v_state FROM public.auto_data_group_sheet_worker_state WHERE id FOR UPDATE;
  IF NOT v_state.enabled OR v_state.token IS DISTINCT FROM p_token OR v_state.claimed OR v_state.lease_expires_at<=now() THEN RETURN NULL; END IF;
  UPDATE public.auto_data_group_sheet_worker_state SET claimed=true WHERE id;
  -- Expired worker runs are recoverable; their append transaction is atomic.
  UPDATE public.auto_data_group_external_sync_runs SET status='interrupted',finished_at=now(),error='Lượt trước bị gián đoạn; sẽ kiểm tra lại dữ liệu.'
    WHERE status='running' AND started_at<now()-interval '180 seconds';
  SELECT * INTO v_source FROM public.auto_data_group_external_sync_sources WHERE is_enabled AND NOT is_delete
    AND status IN ('pending','success','retry','running') AND next_run_at<=now() ORDER BY next_run_at,id LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  SELECT * INTO v_group FROM public.auto_account_contact_groups WHERE id=v_source.group_id FOR UPDATE;
  SELECT * INTO v_source FROM public.auto_data_group_external_sync_sources WHERE id=v_source.id FOR UPDATE;
  IF NOT v_source.is_enabled OR v_source.is_delete OR v_source.next_run_at>now() THEN
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  IF v_source.end_date<(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN
    UPDATE public.auto_data_group_external_sync_sources SET is_enabled=false,status='expired',run_token=NULL,updated_at=now() WHERE id=v_source.id;
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  INSERT INTO public.auto_data_group_external_sync_runs(source_id,group_id,staff_id,organization_id,source_name,token,source_revision)
    VALUES(v_source.id,v_source.group_id,v_source.staff_id,v_source.organization_id,v_source.name,p_token,v_source.revision) RETURNING id INTO v_run_id;
  IF v_group.is_delete OR v_group.staff_id<>v_source.staff_id OR v_group.organization_id<>v_source.organization_id
    OR NOT EXISTS(SELECT 1 FROM public.org_staff WHERE id=v_source.staff_id AND organization_id=v_source.organization_id AND is_active)
    OR v_group.bound_zalo_account_id IS DISTINCT FROM v_source.source_account_id
    OR (v_group.data_type_category_item_id IS NOT NULL AND v_group.data_type_category_item_id<>v_source.data_type_category_item_id)
    OR (v_source.source_account_id IS NOT NULL AND NOT public.aka_agent_data_group_account_available(v_source.source_account_id,v_source.staff_id,v_source.organization_id))
  THEN
    UPDATE public.auto_data_group_external_sync_sources SET is_enabled=false,status='error',run_token=NULL,last_error='Nhóm, loại data hoặc tài khoản nguồn không còn hợp lệ.',updated_at=now() WHERE id=v_source.id;
    UPDATE public.auto_data_group_external_sync_runs SET status='error',finished_at=now(),error='Nhóm, loại data hoặc tài khoản nguồn không còn hợp lệ.' WHERE id=v_run_id;
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  UPDATE public.auto_data_group_external_sync_sources SET status='running',run_token=p_token,last_run_at=now(),next_run_at=now()+interval '180 seconds',updated_at=now() WHERE id=v_source.id;
  RETURN jsonb_build_object('runId',v_run_id,'sourceId',v_source.id,'config',v_source.config);
END;
$fn$;

CREATE FUNCTION public.aka_agent_sheet_finish(p_token uuid,p_rows jsonb,p_row_count integer,p_invalid_count integer,p_error text DEFAULT NULL,p_permanent boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public SET statement_timeout TO '60s' AS $fn$
DECLARE v_run public.auto_data_group_external_sync_runs%ROWTYPE; v_source public.auto_data_group_external_sync_sources%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE; v_classified jsonb; v_result jsonb; v_ingest jsonb;
  v_error text:=left(p_error,1000); v_permanent boolean:=p_permanent; v_added integer:=0; v_invalid integer;
  v_previous text:=current_setting('aka_agent.sheet_sync_run_token',true);
BEGIN
  SELECT * INTO v_run FROM public.auto_data_group_external_sync_runs WHERE token=p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('stale',true); END IF;
  IF v_run.status IN ('success','error') AND v_run.result IS NOT NULL THEN RETURN v_run.result; END IF;
  -- Serialize against dispatch/claim before taking group -> source -> run locks.
  PERFORM 1 FROM public.auto_data_group_sheet_worker_state WHERE id AND token=p_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('stale',true); END IF;
  SELECT * INTO v_group FROM public.auto_account_contact_groups WHERE id=v_run.group_id FOR UPDATE;
  SELECT * INTO v_source FROM public.auto_data_group_external_sync_sources WHERE id=v_run.source_id FOR UPDATE;
  SELECT * INTO v_run FROM public.auto_data_group_external_sync_runs WHERE token=p_token FOR UPDATE;
  IF v_run.status<>'running' OR v_source.is_delete OR NOT v_source.is_enabled OR v_source.run_token IS DISTINCT FROM p_token OR v_source.revision<>v_run.source_revision THEN
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id AND token=p_token;
    RETURN jsonb_build_object('stale',true);
  END IF;
  IF v_group.is_delete OR v_group.bound_zalo_account_id IS DISTINCT FROM v_source.source_account_id
    OR (v_group.data_type_category_item_id IS NOT NULL AND v_group.data_type_category_item_id<>v_source.data_type_category_item_id)
    OR (v_source.source_account_id IS NOT NULL AND NOT public.aka_agent_data_group_account_available(v_source.source_account_id,v_source.staff_id,v_source.organization_id))
    OR NOT EXISTS(SELECT 1 FROM public.org_staff WHERE id=v_source.staff_id AND organization_id=v_source.organization_id AND is_active)
    OR v_source.end_date<(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  THEN v_error:='Nhóm, lịch hoặc tài khoản nguồn đã thay đổi. Hãy kiểm tra và lưu lại nguồn.'; v_permanent:=true; END IF;
  IF v_error IS NULL THEN
    BEGIN
      IF p_row_count NOT BETWEEN 0 AND 10000 OR p_invalid_count NOT BETWEEN 0 AND p_row_count
        OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)+p_invalid_count<>p_row_count
      THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
      v_classified:=public.aka_agent_sheet_classify(v_group.id,v_source.config->>'dataTypeCode',p_rows);
      PERFORM set_config('aka_agent.sheet_sync_run_token',p_token::text,true);
      IF jsonb_array_length(v_classified->'rows')>0 THEN
        v_ingest:=public.aka_agent_ingest_data_group(v_source.staff_id,v_source.organization_id,'sheet-run:'||v_run.id,
          v_group.id,'external_sync',v_classified->'rows',NULL,NULL,'sheet',v_source.source_account_id,
          'Google Sheet · '||v_source.name,NULL,v_source.data_type_category_item_id);
        v_added:=COALESCE((v_ingest->>'inserted_membership_count')::integer,0)+COALESCE((v_ingest->>'reactivated_membership_count')::integer,0);
        -- Never claim success or mark a key seen if the underlying ingest rejected it.
        IF COALESCE((v_ingest->>'invalid_count')::integer,0)>0 THEN RAISE EXCEPTION 'sheet_sync_ingest_rejected'; END IF;
      END IF;
      INSERT INTO public.auto_data_group_external_sync_seen(group_id,source_id,staff_id,organization_id,data_type_code,account_scope,identity_key)
      SELECT v_group.id,v_source.id,v_source.staff_id,v_source.organization_id,v_source.config->>'dataTypeCode',COALESCE(v_source.source_account_id,0),k
        FROM jsonb_array_elements_text(v_classified->'keys') k ON CONFLICT DO NOTHING;
      v_invalid:=p_invalid_count+(v_classified->>'invalid_count')::integer;
      v_result:=jsonb_build_object('addedCount',v_added,'rowCount',p_row_count,'duplicateCount',(v_classified->>'duplicate_count')::integer,'invalidCount',v_invalid);
      UPDATE public.auto_data_group_external_sync_runs SET status='success',finished_at=clock_timestamp(),row_count=p_row_count,
        added_count=v_added,duplicate_count=(v_classified->>'duplicate_count')::integer,invalid_count=v_invalid,result=v_result WHERE id=v_run.id;
      UPDATE public.auto_data_group_external_sync_sources SET status='success',last_error=NULL,run_token=NULL,failure_count=0,
        next_run_at=clock_timestamp()+make_interval(hours=>every_hours),row_count=p_row_count,added_count=added_count+v_added,
        last_added_count=v_added,updated_at=clock_timestamp() WHERE id=v_source.id;
      PERFORM set_config('aka_agent.sheet_sync_run_token',COALESCE(v_previous,''),true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('aka_agent.sheet_sync_run_token',COALESCE(v_previous,''),true);
      v_error:='Không thể nhập dữ liệu vào nhóm. Hệ thống sẽ thử lại.';
      v_permanent:=SQLERRM LIKE '%sheet_sync_config%' OR SQLERRM LIKE '%data_group_bound%' OR SQLERRM LIKE '%semantic_type%';
    END;
  END IF;
  IF v_error IS NOT NULL THEN
    v_result:=jsonb_build_object('error',v_error);
    UPDATE public.auto_data_group_external_sync_runs SET status='error',finished_at=clock_timestamp(),error=v_error,result=v_result WHERE id=v_run.id;
    UPDATE public.auto_data_group_external_sync_sources SET status=CASE WHEN v_permanent THEN 'error' ELSE 'retry' END,
      is_enabled=NOT v_permanent,last_error=v_error,run_token=NULL,failure_count=failure_count+1,
      next_run_at=clock_timestamp()+make_interval(mins=>CASE failure_count WHEN 0 THEN 5 WHEN 1 THEN 15 ELSE 60 END),updated_at=clock_timestamp() WHERE id=v_source.id;
  END IF;
  UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id AND token=p_token;
  RETURN v_result;
END;
$fn$;

CREATE FUNCTION public.aka_agent_data_group_background_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $fn$
BEGIN
  BEGIN PERFORM public.aka_agent_run_data_group_dynamic_filter_worker(5,100);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group dynamic filter worker failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_sheet_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group Sheet dispatch failed (%)',SQLSTATE; END;
END;
$fn$;

CREATE FUNCTION public.aka_agent_sheet_validate_config(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog,public AS $fn$
DECLARE v_required text; v_mapping jsonb; v_headers jsonb;
BEGIN
  v_mapping:=p_config->'mapping'; v_headers:=p_config->'expectedHeaders';
  IF jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR octet_length(p_config::text)>262144
    OR COALESCE(p_config->>'url','') !~ '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]+/edit(#gid=[0-9]{1,20})?$'
    OR jsonb_typeof(p_config->'hasHeader') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(v_mapping) IS DISTINCT FROM 'array' OR jsonb_typeof(v_headers) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
  IF jsonb_array_length(v_mapping) NOT BETWEEN 1 AND 10 OR jsonb_array_length(v_headers) NOT BETWEEN 1 AND 512
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_headers) h WHERE jsonb_typeof(h)<>'string' OR length(h#>>'{}')>2000)
  THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
  v_required:=CASE p_config->>'dataTypeCode'
    WHEN 'phone' THEN 'phone' WHEN 'email' THEN 'email'
    WHEN 'facebook_search_keyword' THEN 'uid' WHEN 'facebook_person' THEN 'uid'
    WHEN 'facebook_group' THEN 'uid' WHEN 'facebook_page' THEN 'uid' WHEN 'zalo_person' THEN 'uid'
    WHEN 'facebook_post_url' THEN 'url' WHEN 'zalo_group' THEN 'url' END;
  IF v_required IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_mapping) m WHERE m->>'field'=v_required)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_mapping) m WHERE
      COALESCE(m->>'field','') NOT IN ('uid','url','name','phone','email','info1','info2','info3','info4','info5')
      OR COALESCE(m->>'column','') !~ '^[0-9]{1,3}$')
  THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_mapping) m WHERE (m->>'column')::integer>=jsonb_array_length(v_headers))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_mapping) m GROUP BY m->>'field' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
END;
$fn$;

CREATE FUNCTION public.aka_agent_sheet_classify(p_group_id bigint,p_type text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog,public AS $fn$
DECLARE v_group public.auto_account_contact_groups%ROWTYPE; v_result jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
  IF jsonb_array_length(p_rows)>10000 OR octet_length(p_rows::text)>20971520 THEN RAISE EXCEPTION 'sheet_sync_config'; END IF;
  SELECT * INTO STRICT v_group FROM public.auto_account_contact_groups WHERE id=p_group_id;
  WITH incoming AS MATERIALIZED (
    SELECT value AS payload,ordinality AS row_index,public.aka_agent_sheet_identity(p_type,value) AS identity_key,
      row_number() OVER(PARTITION BY public.aka_agent_sheet_identity(p_type,value) ORDER BY ordinality) AS same_key_order
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  ), existing_keys AS MATERIALIZED (
    SELECT DISTINCT public.aka_agent_sheet_identity(p_type,to_jsonb(c)) AS identity_key
    FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts c ON c.id=m.contact_id
    WHERE m.group_id=p_group_id AND NOT m.is_delete
      AND (p_type NOT IN ('zalo_person','zalo_group') OR c.account_id IS NOT DISTINCT FROM v_group.bound_zalo_account_id)
      AND EXISTS(SELECT 1 FROM public.auto_account_contact_group_member_origins o JOIN public.category_item ci ON ci.id=o.data_type_category_item_id
        WHERE o.membership_id=m.id AND o.is_current AND ci.code=p_type)
  ), account_contacts AS MATERIALIZED (
    SELECT c.id,c.is_delete,public.aka_agent_sheet_identity(p_type,to_jsonb(c)) AS identity_key
    FROM public.auto_account_contacts c
    WHERE c.staff_id=v_group.staff_id AND c.organization_id=v_group.organization_id
      AND c.account_id IS NOT DISTINCT FROM v_group.bound_zalo_account_id
      AND (c.is_delete OR v_group.bound_zalo_account_id IS NOT NULL)
      AND c.contact_type=CASE p_type WHEN 'phone' THEN 'phone' WHEN 'email' THEN 'email'
        WHEN 'facebook_group' THEN 'group' WHEN 'zalo_group' THEN 'group' WHEN 'facebook_page' THEN 'page'
        WHEN 'facebook_search_keyword' THEN 'campaign_input' WHEN 'facebook_post_url' THEN 'campaign_input' ELSE 'person' END
      AND (p_type IN ('phone','email') OR c.flatform_type=CASE WHEN p_type LIKE 'zalo_%' THEN 'zalo' ELSE 'facebook' END)
  ), account_keys AS MATERIALIZED (
    SELECT identity_key,bool_or(is_delete) AS has_deleted,min(id) FILTER(WHERE NOT is_delete) AS contact_id
    FROM account_contacts WHERE identity_key IS NOT NULL GROUP BY identity_key
  ), classified AS (
    SELECT i.*,CASE
      WHEN i.identity_key IS NULL OR length(i.identity_key)>1000 THEN 'invalid'
      WHEN i.same_key_order>1 OR e.identity_key IS NOT NULL OR s.identity_key IS NOT NULL OR a.has_deleted THEN 'duplicate'
      ELSE 'new' END AS disposition,
      a.contact_id
    FROM incoming i
    LEFT JOIN existing_keys e ON e.identity_key=i.identity_key
    LEFT JOIN account_keys a ON a.identity_key=i.identity_key
    LEFT JOIN public.auto_data_group_external_sync_seen s ON s.group_id=p_group_id AND s.data_type_code=p_type
      AND s.account_scope=COALESCE(v_group.bound_zalo_account_id,0) AND s.identity_key=i.identity_key
  ) SELECT jsonb_build_object(
    'new_count',count(*) FILTER(WHERE disposition='new'),
    'duplicate_count',count(*) FILTER(WHERE disposition='duplicate'),
    'invalid_count',count(*) FILTER(WHERE disposition='invalid'),
    'rows',COALESCE(jsonb_agg(payload || CASE WHEN contact_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('contact_id',contact_id) END
      ORDER BY row_index) FILTER(WHERE disposition='new'),'[]'::jsonb),
    'keys',COALESCE(jsonb_agg(DISTINCT identity_key) FILTER(WHERE disposition<>'invalid'),'[]'::jsonb)
  ) INTO v_result FROM classified;
  RETURN v_result;
END;
$fn$;

-- Minimal patch of the captured live definition.
CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group_v186_internal(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint DEFAULT NULL::bigint, p_dataset_name text DEFAULT NULL::text, p_import_source text DEFAULT NULL::text, p_source_account_id bigint DEFAULT NULL::bigint, p_source_name text DEFAULT NULL::text, p_payload_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_source_account public.auto_accounts%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_row record;
  v_source record;
  v_raw_account_id text;
  v_raw_contact_id text;
  v_raw_automation_detail_id text;
  v_origin_automation_detail_id bigint;
  v_row_account_id bigint;
  v_contact_type text;
  v_platform text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_extra jsonb;
  v_dataset_contact_type text;
  v_dataset_platform text;
  v_dataset_source_key text;
  v_dataset_display_name text;
  v_duplicate_in_batch boolean := false;
  v_duplicate_conflict boolean := false;
  v_member_found boolean := false;
  v_batch_seen jsonb := '{}'::jsonb;
  v_first_payload jsonb;
  v_current_payload jsonb;
  v_request_hash text;
  v_revision bigint;
  v_revision_started boolean := false;
  v_inserted_members integer := 0;
  v_reactivated_members integer := 0;
  v_existing_members integer := 0;
  v_removed_members integer := 0;
  v_inserted_inputs integer := 0;
  v_existing_inputs integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_invalid integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_outcome jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
    OR p_kind NOT IN ('manual', 'upload', 'scan', 'automation', 'api', 'external_sync')
    OR jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_rows) > 10000
    OR (p_import_source IS NOT NULL AND p_import_source NOT IN ('textbox', 'image', 'sheet', 'excel'))
  THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  IF p_kind = 'external_sync' AND NOT EXISTS (
    SELECT 1 FROM public.auto_data_group_external_sync_runs r
    JOIN public.auto_data_group_external_sync_sources s ON s.id=r.source_id
    WHERE r.token::text=current_setting('aka_agent.sheet_sync_run_token',true)
      AND r.status='running' AND s.run_token=r.token AND s.revision=r.source_revision
      AND s.is_enabled AND NOT s.is_delete AND r.group_id=p_group_id
      AND r.staff_id=p_staff_id AND r.organization_id=p_organization_id
  ) THEN RAISE EXCEPTION 'sheet_sync_unclaimed'; END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  IF p_source_account_id IS NOT NULL THEN
    SELECT * INTO v_source_account
    FROM public.auto_accounts AS account
    WHERE account.id = p_source_account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_source_account_not_found'; END IF;
  END IF;

  IF v_group.bound_zalo_account_id IS NOT NULL THEN
    IF NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id) THEN RAISE EXCEPTION 'data_group_bound_account_invalid'; END IF;
    IF (p_source_account_id IS NOT NULL AND p_source_account_id<>v_group.bound_zalo_account_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NULLIF(r->>'source_account_id','') IS NOT NULL AND r->>'source_account_id'<>v_group.bound_zalo_account_id::text)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.auto_account_contacts c ON c.id::text=r->>'contact_id'
        WHERE NULLIF(r->>'contact_id','') IS NOT NULL AND (c.id IS NULL OR c.account_id IS DISTINCT FROM v_group.bound_zalo_account_id OR c.staff_id IS DISTINCT FROM p_staff_id OR c.organization_id IS DISTINCT FROM p_organization_id))
      OR (p_dataset_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_account_contacts_dataset d WHERE d.id=p_dataset_id AND d.account_id IS DISTINCT FROM v_group.bound_zalo_account_id))
    THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'ingest', 'groupId', p_group_id, 'kind', p_kind,
    'rows', p_rows, 'datasetId', p_dataset_id, 'datasetName', p_dataset_name,
    'importSource', p_import_source, 'sourceAccountId', p_source_account_id,
    'sourceName', p_source_name
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, dataset_id, source_account_id,
    source_name, client_payload_hash, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'ingest', p_group_id, p_kind, p_dataset_id,
    p_source_account_id, NULLIF(btrim(COALESCE(p_source_name, '')), ''),
    NULLIF(btrim(COALESCE(p_payload_hash, '')), ''), v_request_hash, 'processing',
    p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT * INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'ingest' OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  p_source_account_id := COALESCE(p_source_account_id,v_group.bound_zalo_account_id);
  IF p_source_account_id IS NOT NULL THEN SELECT * INTO v_source_account FROM public.auto_accounts WHERE id=p_source_account_id; END IF;
  IF p_kind = 'upload' THEN
    v_dataset_display_name := COALESCE(
      NULLIF(btrim(COALESCE(p_dataset_name, '')), ''),
      NULLIF(btrim(COALESCE(p_source_name, '')), ''),
      v_group.name
    );
    IF length(v_dataset_display_name) > 255 THEN
      RAISE EXCEPTION 'invalid_data_group_dataset_name';
    END IF;
    -- The explicit dataset name is the logical identity.  When absent, the
    -- source filename/name becomes that identity. A changed physical filename
    -- therefore still refreshes the same named dataset.
    v_dataset_source_key := 'upload:'
      || lower(regexp_replace(v_dataset_display_name, '[[:space:]]+', ' ', 'g'));

    WITH row_types AS (
      SELECT DISTINCT lower(btrim(item.value ->> 'contact_type')) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
        AND lower(btrim(COALESCE(item.value ->> 'contact_type', ''))) IN (
          'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
          'phone', 'email', 'campaign_input'
        )
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'campaign_input' END
    INTO v_dataset_contact_type
    FROM row_types;

    WITH row_platforms AS (
      SELECT DISTINCT lower(btrim(COALESCE(
        NULLIF(item.value ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN lower(btrim(item.value ->> 'contact_type')) = 'email' THEN 'email' END,
        ''
      ))) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
    ), valid_platforms AS (
      SELECT value FROM row_platforms
      WHERE value IN ('facebook', 'zalo', 'email', 'sms')
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'mixed' END
    INTO v_dataset_platform
    FROM valid_platforms;
  END IF;

  IF p_dataset_id IS NOT NULL THEN
    SELECT * INTO v_dataset
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = p_dataset_id
      AND dataset.staff_id = p_staff_id
      AND dataset.organization_id = p_organization_id
      AND dataset.is_delete = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_dataset_not_found'; END IF;
    IF p_kind = 'upload' AND (
      v_dataset.source <> 'upload' OR v_dataset.group_id IS DISTINCT FROM v_group.id
    ) THEN
      RAISE EXCEPTION 'data_group_upload_dataset_mismatch';
    END IF;
    IF p_kind = 'upload' THEN
      UPDATE public.auto_account_contacts_dataset_members
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
      UPDATE public.auto_account_contact_group_member_origins
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
    END IF;
  ELSIF p_kind = 'upload' THEN
    INSERT INTO public.auto_account_contacts_dataset (
      name, link, description, source, account_id, group_id, flatform_type,
      contact_type, scan_type, source_key, last_scanned_at, last_scan_status,
      extra_data, contact_count, is_delete, staff_id, organization_id
    ) VALUES (
      v_dataset_display_name,
      NULL, NULL, 'upload', p_source_account_id, v_group.id,
      COALESCE(v_dataset_platform, 'mixed'),
      COALESCE(v_dataset_contact_type, 'campaign_input'),
      'upload_data', v_dataset_source_key, now(), 'completed',
      jsonb_strip_nulls(jsonb_build_object(
        'importSource', p_import_source, 'requestId', btrim(p_request_id)
      )),
      0, false, p_staff_id, p_organization_id
    )
    ON CONFLICT (
      staff_id, organization_id, group_id, COALESCE(account_id, 0::bigint),
      flatform_type, contact_type, scan_type, lower(btrim(source_key))
    )
      WHERE is_delete = false AND source = 'upload' AND group_id IS NOT NULL
    DO UPDATE SET
      name = EXCLUDED.name,
      extra_data = COALESCE(auto_account_contacts_dataset.extra_data, '{}'::jsonb)
        || EXCLUDED.extra_data,
      updated_at = now(), last_scanned_at = now(), last_scan_status = 'completed'
    RETURNING * INTO v_dataset;

    -- Re-import refreshes one logical dataset snapshot. Historical batch and
    -- origin rows remain, but only incoming contacts are current afterward.
    UPDATE public.auto_account_contacts_dataset_members
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;
    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;

    UPDATE public.auto_data_ingest_batches
    SET dataset_id = v_dataset.id, updated_at = now()
    WHERE id = v_batch.id;
  END IF;

  FOR v_row IN
    SELECT item.value AS payload, item.ordinality::integer AS row_index
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    v_duplicate_in_batch := false;
    v_duplicate_conflict := false;
    v_member_found := false;
    v_origin_automation_detail_id := NULL;
    v_contact_type := NULL;
    v_platform := NULL;
    v_name := NULL;
    v_uid := NULL;
    v_url := NULL;
    v_phone := NULL;
    v_email := NULL;
    v_extra := '{}'::jsonb;
    IF jsonb_typeof(v_row.payload) <> 'object' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    v_raw_account_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'source_account_id', '')), '');
    IF v_raw_account_id IS NOT NULL AND v_raw_account_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    v_row_account_id := COALESCE(
      CASE WHEN v_raw_account_id IS NULL THEN NULL ELSE v_raw_account_id::bigint END,
      p_source_account_id
    );
    v_contact := NULL;

    v_raw_contact_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'contact_id', '')), '');
    IF v_raw_contact_id IS NOT NULL AND v_raw_contact_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    IF v_raw_contact_id IS NOT NULL THEN
      SELECT * INTO v_contact
      FROM public.auto_account_contacts AS contact
      WHERE contact.id = v_raw_contact_id::bigint
        AND contact.staff_id = p_staff_id
        AND contact.organization_id = p_organization_id
      FOR UPDATE;
      IF NOT FOUND OR (
        v_row_account_id IS NOT NULL
        AND v_contact.account_id IS DISTINCT FROM v_row_account_id
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_row_account_id := COALESCE(v_row_account_id, v_contact.account_id);
      -- Selecting an existing source contact only changes group membership;
      -- it must never resurrect the source contact's own lifecycle flag.
      v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
      v_platform := NULLIF(lower(btrim(COALESCE(v_contact.flatform_type, ''))), '');
      v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
      v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
      v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
      v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_contact.phone, ''), NULLIF(v_contact.extra_data ->> 'phone', ''),
        CASE WHEN v_contact.contact_type = 'phone' THEN v_contact.uid END, ''
      )), '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_contact.email, ''), NULLIF(v_contact.extra_data ->> 'email', ''),
        CASE WHEN v_contact.contact_type = 'email' THEN v_contact.uid END, ''
      ))), '');
      v_extra := COALESCE(v_contact.extra_data, '{}'::jsonb);
    ELSE
      v_contact_type := lower(btrim(COALESCE(v_row.payload ->> 'contact_type', '')));
      IF v_contact_type NOT IN (
        'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
        'phone', 'email', 'campaign_input'
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      IF v_row_account_id IS NOT NULL THEN
        SELECT * INTO v_source_account
        FROM public.auto_accounts AS account
        WHERE account.id = v_row_account_id
          AND account.staff_id = p_staff_id
          AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
        IF NOT FOUND THEN
          v_invalid := v_invalid + 1;
          CONTINUE;
        END IF;
      ELSE
        v_source_account := NULL;
      END IF;

      v_platform := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN v_contact_type = 'email' THEN 'email' ELSE NULL END,
        ''
      ))), '');
      -- Accountless phone/email rows are deliberately platform-neutral.  A
      -- campaign decides portability from the validated value, not this label.
      IF (v_platform IS NULL AND v_contact_type NOT IN ('phone', 'email'))
        OR (v_platform IS NOT NULL AND v_platform NOT IN ('facebook', 'zalo', 'email', 'sms'))
      THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_row.payload ->> 'phone', ''),
        CASE WHEN v_contact_type = 'phone' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ));
      v_phone := NULLIF(v_phone, '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'email', ''),
        CASE WHEN v_contact_type = 'email' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ))), '');
      IF v_email IS NOT NULL AND (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR length(v_email) > 254) THEN
        v_email := NULL;
      END IF;
      v_url := NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), '');
      v_uid := CASE v_contact_type
        WHEN 'phone' THEN v_phone
        WHEN 'email' THEN v_email
        ELSE COALESCE(
          NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
          v_url
        )
      END;
      IF v_uid IS NULL THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_name := COALESCE(NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''), v_uid);
      v_extra := COALESCE(v_row.payload -> 'extra_data', '{}'::jsonb);
      IF jsonb_typeof(v_extra) <> 'object' THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_extra := v_extra || jsonb_strip_nulls(jsonb_build_object(
        'phone', v_phone,
        'email', v_email,
        'info1', NULLIF(v_row.payload ->> 'info1', ''),
        'info2', NULLIF(v_row.payload ->> 'info2', ''),
        'info3', NULLIF(v_row.payload ->> 'info3', ''),
        'info4', NULLIF(v_row.payload ->> 'info4', ''),
        'info5', NULLIF(v_row.payload ->> 'info5', '')
      ));

      IF v_row_account_id IS NULL THEN
        -- Accountless identity is intentionally NOT global. Reuse is allowed
        -- only inside the explicitly supplied dataset; otherwise each row gets
        -- its own canonical contact and campaign delivery dedupe happens later.
        IF v_dataset.id IS NOT NULL THEN
          SELECT contact.* INTO v_contact
          FROM public.auto_account_contacts_dataset_members AS dataset_member
          JOIN public.auto_account_contacts AS contact ON contact.id = dataset_member.contact_id
          WHERE dataset_member.dataset_id = v_dataset.id
            AND contact.account_id IS NULL
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type IS NOT DISTINCT FROM v_platform
            AND contact.contact_type = v_contact_type
            AND contact.uid = v_uid
          ORDER BY dataset_member.created_at, contact.id
          LIMIT 1
          FOR UPDATE OF contact;
        END IF;
        IF v_contact.id IS NULL THEN
          INSERT INTO public.auto_account_contacts (
            account_id, flatform_type, contact_type, name, uid, url, phone, email,
            extra_data, is_delete, staff_id, organization_id, updated_at
          ) VALUES (
            NULL, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
            v_extra, false, p_staff_id, p_organization_id, now()
          ) RETURNING * INTO v_contact;
        ELSE
          UPDATE public.auto_account_contacts AS contact
          SET name = CASE
                WHEN NULLIF(btrim(contact.name), '') IS NULL OR contact.name = contact.uid
                  THEN v_name ELSE contact.name END,
              url = COALESCE(contact.url, v_url),
              phone = COALESCE(contact.phone, v_phone),
              email = COALESCE(contact.email, v_email),
              -- Existing/earlier values win; this only fills absent keys.
              extra_data = v_extra || COALESCE(contact.extra_data, '{}'::jsonb),
              is_delete = false, updated_at = now()
          WHERE contact.id = v_contact.id
          RETURNING * INTO v_contact;
        END IF;
      ELSIF p_kind = 'external_sync' THEN
        -- Preserve every existing contact field, including lifecycle flags.
        INSERT INTO public.auto_account_contacts (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        ) ON CONFLICT (account_id, contact_type, uid) DO NOTHING RETURNING * INTO v_contact;
        IF v_contact.id IS NULL THEN
          SELECT * INTO v_contact FROM public.auto_account_contacts
          WHERE account_id=v_row_account_id AND contact_type=v_contact_type AND uid=v_uid
            AND staff_id=p_staff_id AND organization_id=p_organization_id FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_contact_conflict'; END IF;
        END IF;
      ELSE
        INSERT INTO public.auto_account_contacts AS existing_contact (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        )
        ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
          flatform_type = COALESCE(existing_contact.flatform_type, EXCLUDED.flatform_type),
          name = CASE
            WHEN NULLIF(btrim(existing_contact.name), '') IS NULL
              OR existing_contact.name = existing_contact.uid THEN EXCLUDED.name
            ELSE existing_contact.name END,
          url = COALESCE(existing_contact.url, EXCLUDED.url),
          phone = COALESCE(existing_contact.phone, EXCLUDED.phone),
          email = COALESCE(existing_contact.email, EXCLUDED.email),
          -- First persisted value wins; later duplicates only fill missing keys.
          extra_data = EXCLUDED.extra_data || COALESCE(existing_contact.extra_data, '{}'::jsonb),
          is_delete = false,
          staff_id = EXCLUDED.staff_id,
          organization_id = EXCLUDED.organization_id,
          updated_at = now()
        RETURNING * INTO v_contact;
      END IF;
    END IF;

    IF p_kind = 'external_sync' AND v_contact.is_delete THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_member
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.contact_id = v_contact.id
    FOR UPDATE;
    v_member_found := FOUND;
    v_current_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''),
      'uid', NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
      'url', NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), ''),
      'phone', NULLIF(public.aka_agent_internal_normalize_phone(
        COALESCE(v_row.payload ->> 'phone', '')
      ), ''),
      'email', NULLIF(lower(btrim(COALESCE(v_row.payload ->> 'email', ''))), ''),
      'info1', NULLIF(v_row.payload ->> 'info1', ''),
      'info2', NULLIF(v_row.payload ->> 'info2', ''),
      'info3', NULLIF(v_row.payload ->> 'info3', ''),
      'info4', NULLIF(v_row.payload ->> 'info4', ''),
      'info5', NULLIF(v_row.payload ->> 'info5', ''),
      'extra_data', CASE WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
        THEN v_row.payload -> 'extra_data' ELSE '{}'::jsonb END
    ));
    v_raw_automation_detail_id := NULLIF(btrim(COALESCE(
      v_row.payload -> 'extra_data' ->> 'automationDetailId',
      v_row.payload ->> 'automation_detail_id',
      ''
    )), '');
    IF p_kind = 'automation'
      AND v_raw_automation_detail_id ~ '^[1-9][0-9]{0,17}$'
    THEN
      SELECT detail.id INTO v_origin_automation_detail_id
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = v_raw_automation_detail_id::bigint
        AND detail.staff_id = p_staff_id
        AND detail.organization_id = p_organization_id;
    END IF;
    v_duplicate_in_batch := v_batch_seen ? v_contact.id::text;

    IF v_duplicate_in_batch THEN
      v_first_payload := v_batch_seen -> v_contact.id::text;
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_each(v_first_payload - 'extra_data') AS first_value(key, value)
        JOIN jsonb_each(v_current_payload - 'extra_data') AS current_value(key, value)
          USING (key)
        WHERE first_value.value IS DISTINCT FROM current_value.value
      ) OR EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(v_first_payload -> 'extra_data', '{}'::jsonb))
          AS first_extra(key, value)
        JOIN jsonb_each(COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb))
          AS current_extra(key, value)
          USING (key)
        WHERE first_extra.value IS DISTINCT FROM current_extra.value
      ) INTO v_duplicate_conflict;

      -- Extend the first-row snapshot only with fields it did not provide.
      v_first_payload := v_current_payload || v_first_payload;
      v_first_payload := jsonb_set(
        v_first_payload,
        '{extra_data}',
        COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb)
          || COALESCE((v_batch_seen -> v_contact.id::text) -> 'extra_data', '{}'::jsonb),
        true
      );
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_first_payload, true
      );
      IF v_duplicate_conflict THEN
        v_conflict := v_conflict + 1;
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row.row_index - 1,
          'code', 'duplicate_identity_conflict',
          'message', 'Dòng trùng định danh có giá trị khác; giữ giá trị của dòng đầu.',
          'contactId', v_contact.id
        ));
      END IF;
    ELSE
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_current_payload, true
      );
    END IF;

    IF NOT v_revision_started THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1, updated_at = now()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;
      v_revision_started := true;
    END IF;

    IF NOT v_member_found THEN
      INSERT INTO public.auto_account_contact_group_members (
        group_id, contact_id, is_delete, change_revision, created_at, updated_at
      ) VALUES (v_group.id, v_contact.id, false, v_revision, now(), now())
      RETURNING * INTO v_member;
      v_inserted_members := v_inserted_members + 1;
    ELSIF v_duplicate_in_batch THEN
      IF NOT v_duplicate_conflict THEN
        v_existing_members := v_existing_members + 1;
      END IF;
    ELSIF v_member.is_delete THEN
      UPDATE public.auto_account_contact_group_members
      SET is_delete = false, change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_reactivated_members := v_reactivated_members + 1;
    ELSE
      UPDATE public.auto_account_contact_group_members
      SET change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_existing_members := v_existing_members + 1;
    END IF;

    INSERT INTO public.auto_account_contact_group_member_origins (
      membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
      source_name_snapshot, relationship_kind, is_current, created_at, updated_at
    ) VALUES (
      v_member.id, p_kind, v_dataset.id, v_batch.id,
      COALESCE(v_row_account_id, v_contact.account_id),
      v_origin_automation_detail_id,
      COALESCE(NULLIF(btrim(COALESCE(p_source_name, '')), ''), v_source_account.name),
      public.aka_agent_validate_data_group_relationship_kind(
        v_member.id,
        COALESCE(v_row_account_id, v_contact.account_id),
        v_dataset.id,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN COALESCE(
              v_row.payload -> 'extra_data' ->> 'relationshipKind',
              v_row.payload -> 'extra_data' ->> 'relationship_kind'
            )
          ELSE NULL
        END,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN v_row.payload -> 'extra_data'
          ELSE '{}'::jsonb
        END
      ),
      CASE
        WHEN v_dataset.id IS NOT NULL AND v_dataset.source = 'scan' THEN EXISTS (
          SELECT 1 FROM public.auto_account_contacts_dataset_members AS dataset_member
          WHERE dataset_member.dataset_id = v_dataset.id
            AND dataset_member.contact_id = v_contact.id
            AND dataset_member.is_current = true
        )
        ELSE true
      END,
      now(), now()
    )
    ON CONFLICT DO NOTHING;

    IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
      INSERT INTO public.auto_account_contacts_dataset_members (
        dataset_id, contact_id, sort_order, is_current,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        v_dataset.id, v_contact.id, GREATEST(v_row.row_index - 1, 0), true,
        now(), now(), now(), now()
      )
      ON CONFLICT (dataset_id, contact_id) DO UPDATE SET
        sort_order = LEAST(auto_account_contacts_dataset_members.sort_order, EXCLUDED.sort_order),
        is_current = true, last_seen_at = now(), updated_at = now();
    END IF;

    FOR v_source IN
      SELECT source.id
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.group_id = v_group.id AND source.status IN ('baselining', 'active')
      ORDER BY source.campaign_id
    LOOP
      v_outcome := public.aka_agent_internal_route_data_group_member(
        v_source.id, v_member.id, v_batch.id, v_revision
      );
      CASE v_outcome ->> 'status'
        WHEN 'inserted' THEN v_inserted_inputs := v_inserted_inputs + 1;
        WHEN 'existing' THEN v_existing_inputs := v_existing_inputs + 1;
        WHEN 'incompatible' THEN v_incompatible := v_incompatible + 1;
        WHEN 'conflict' THEN
          v_conflict := v_conflict + 1;
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'rowIndex', v_row.row_index - 1,
            'code', 'canonical_alias_conflict',
            'message', 'Các định danh của dòng đang trỏ tới nhiều target khác nhau.',
            'aliases', COALESCE(v_outcome -> 'aliases', '[]'::jsonb)
          ));
        ELSE NULL;
      END CASE;
    END LOOP;
  END LOOP;

  IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
    SELECT count(*)::integer INTO v_removed_members
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.is_delete = false
      AND EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
        WHERE historical_origin.membership_id = member.id
          AND historical_origin.dataset_id = v_dataset.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
        WHERE current_origin.membership_id = member.id
          AND current_origin.is_current = true
      );
    IF v_removed_members > 0 THEN
      IF NOT v_revision_started THEN
        UPDATE public.auto_account_contact_groups
        SET revision = revision + 1, updated_at = now()
        WHERE id = v_group.id
        RETURNING revision INTO v_revision;
        v_revision_started := true;
      END IF;
      UPDATE public.auto_account_contact_group_members AS member
      SET is_delete = true, change_revision = v_revision, updated_at = now()
      WHERE member.group_id = v_group.id AND member.is_delete = false
        AND EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
          WHERE historical_origin.membership_id = member.id
            AND historical_origin.dataset_id = v_dataset.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
          WHERE current_origin.membership_id = member.id
            AND current_origin.is_current = true
        );
    END IF;

    UPDATE public.auto_account_contacts_dataset AS dataset
    SET contact_count = (
      SELECT count(*)::integer
      FROM public.auto_account_contacts_dataset_members AS member
      WHERE member.dataset_id = v_dataset.id AND member.is_current = true
    ), updated_at = now()
    WHERE dataset.id = v_dataset.id;
  END IF;
  IF NOT v_revision_started THEN v_revision := v_group.revision; END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'batch_id', v_batch.id,
    'group_id', v_group.id,
    'group_revision', v_revision,
    'inserted_membership_count', v_inserted_members,
    'reactivated_membership_count', v_reactivated_members,
    'already_member_count', v_existing_members,
    'removed_membership_count', v_removed_members,
    'inserted_input_count', v_inserted_inputs,
    'already_seen_input_count', v_existing_inputs,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict,
    'invalid_count', v_invalid,
    'conflicts', v_conflicts
  );
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$function$;

-- Minimal patch of the captured live definition.
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_source_code(p_origin_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_origin_kind, '')))
    WHEN 'manual' THEN 'upload'
    WHEN 'upload' THEN 'upload'
    WHEN 'scan' THEN 'scan'
    WHEN 'automation' THEN 'automation'
    WHEN 'dynamic_filter' THEN 'dynamic_filter'
    WHEN 'external_sync' THEN 'external_sync'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_data_group_panel(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_creator_name text;
  v_data_type_code text;
  v_data_type_name text;
  v_campaign_ids bigint[] := ARRAY[]::bigint[];
  v_unique_target_count bigint := 0;
  v_campaign_input_count bigint := 0;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  SELECT staff.name, data_type.code, data_type.name
  INTO v_creator_name, v_data_type_code, v_data_type_name
  FROM public.auto_account_contact_groups AS contact_group
  LEFT JOIN public.org_staff AS staff
    ON staff.id = contact_group.staff_id
   AND staff.organization_id = contact_group.organization_id
  LEFT JOIN public.category_item AS data_type
    ON data_type.id = contact_group.data_type_category_item_id
  WHERE contact_group.id = v_group.id;

  SELECT
    stats.unique_compatible_target_count,
    stats.campaign_input_count
  INTO
    v_unique_target_count,
    v_campaign_input_count
  FROM public.aka_agent_get_data_group_latest_ingest_stats(
    p_staff_id,
    p_organization_id,
    p_group_id
  ) AS stats;

  SELECT COALESCE(array_agg(campaign.id ORDER BY campaign.id), ARRAY[]::bigint[])
  INTO v_campaign_ids
  FROM public.auto_campaigns AS campaign
  LEFT JOIN public.auto_campaign_data_group_sources AS source
    ON source.campaign_id = campaign.id
   AND source.staff_id = p_staff_id
   AND source.organization_id = p_organization_id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(source.group_id, campaign.data_group_id) = p_group_id;

  RETURN jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id,
      'name', v_group.name,
      'color', v_group.color,
      'note', v_group.note,
      'creator_name', COALESCE(v_creator_name, '—'),
      'data_type_category_item_id', v_group.data_type_category_item_id,
      'data_type_code', v_data_type_code,
      'data_type_name', COALESCE(v_data_type_name, 'Mọi loại dữ liệu'),
      'dataset_sync_mode', v_group.dataset_sync_mode,
      'revision', v_group.revision,
      'created_at', v_group.created_at,
      'updated_at', v_group.updated_at,
      'latest_data_added_at', (
        SELECT max(COALESCE(origin.created_at, member.created_at))
        FROM public.auto_account_contact_group_members AS member
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
      )
    ),
    'summary', jsonb_build_object(
      'external_sync_source_count', (SELECT count(*) FROM public.auto_data_group_external_sync_sources WHERE group_id=v_group.id AND NOT is_delete),
      'active_membership_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
      ),
      'unique_target_count', COALESCE(v_unique_target_count, 0),
      'duplicate_count', GREATEST(
        0,
        (
          SELECT count(*)::bigint
          FROM public.auto_account_contact_group_members AS member
          WHERE member.group_id = v_group.id
            AND member.is_delete = false
        ) - COALESCE(v_unique_target_count, 0)
      ),
      'campaign_input_count', COALESCE(v_campaign_input_count, 0),
      'campaign_count', COALESCE(cardinality(v_campaign_ids), 0),
      'active_campaign_count', (
        SELECT count(*)::bigint
        FROM public.auto_campaigns AS campaign
        LEFT JOIN public.auto_campaign_data_group_sources AS source
          ON source.campaign_id = campaign.id
         AND source.staff_id = p_staff_id
         AND source.organization_id = p_organization_id
        WHERE campaign.id = ANY(v_campaign_ids)
          AND campaign.status IN ('chờ xử lý', 'đang chạy', 'tạm dừng')
          AND COALESCE(source.status, 'active') <> 'stopped'
      ),
      'run_count', (
        SELECT count(*)::bigint
        FROM public.auto_runs AS run
        WHERE run.campaign_id = ANY(v_campaign_ids)
      )
    ),
    'quality', jsonb_build_object(
      'with_link_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
          AND NULLIF(btrim(contact.url), '') IS NOT NULL
      ),
      'with_phone_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
          AND NULLIF(btrim(contact.phone), '') IS NOT NULL
      ),
      'with_uid_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
          AND NULLIF(btrim(contact.uid), '') IS NOT NULL
      ),
      'duplicate_count', GREATEST(
        0,
        (
          SELECT count(*)::bigint
          FROM public.auto_account_contact_group_members AS member
          WHERE member.group_id = v_group.id
            AND member.is_delete = false
        ) - COALESCE(v_unique_target_count, 0)
      )
    ),
    'source_breakdown', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'kind', source_rows.kind,
          'count', source_rows.member_count
        )
        ORDER BY source_rows.member_count DESC, source_rows.kind
      )
      FROM (
        SELECT
          COALESCE(origin.kind, 'legacy_unknown') AS kind,
          count(*)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY COALESCE(origin.kind, 'legacy_unknown')
      ) AS source_rows
    ), '[]'::jsonb),
    'data_type_breakdown', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'data_type_category_item_id', type_rows.data_type_category_item_id,
          'code', type_rows.code,
          'name', type_rows.name,
          'count', type_rows.member_count
        )
        ORDER BY type_rows.member_count DESC, type_rows.name
      )
      FROM (
        SELECT
          COALESCE(origin.data_type_category_item_id, v_group.data_type_category_item_id)
            AS data_type_category_item_id,
          COALESCE(data_type.code, contact.flatform_type || '_' || contact.contact_type, 'unknown')
            AS code,
          COALESCE(
            data_type.name,
            CASE
              WHEN contact.flatform_type = 'facebook' AND contact.contact_type = 'person' THEN 'Facebook · User'
              WHEN contact.flatform_type = 'facebook' AND contact.contact_type = 'group' THEN 'Facebook · Group'
              WHEN contact.flatform_type = 'facebook' AND contact.contact_type = 'page' THEN 'Facebook · Page'
              WHEN contact.flatform_type = 'zalo' AND contact.contact_type = 'person' THEN 'Zalo · User'
              WHEN contact.flatform_type = 'zalo' AND contact.contact_type = 'group' THEN 'Zalo · Group'
              WHEN contact.contact_type = 'phone' THEN 'Số điện thoại'
              WHEN contact.contact_type = 'email' THEN 'Email'
              ELSE 'Chưa xác định'
            END
          ) AS name,
          count(*)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        LEFT JOIN public.category_item AS data_type
          ON data_type.id = COALESCE(
            origin.data_type_category_item_id,
            v_group.data_type_category_item_id
          )
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY
          COALESCE(origin.data_type_category_item_id, v_group.data_type_category_item_id),
          data_type.code,
          data_type.name,
          contact.flatform_type,
          contact.contact_type
      ) AS type_rows
    ), '[]'::jsonb),
    'account_breakdown', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'account_id', account_rows.account_id,
          'name', account_rows.name,
          'is_delete', account_rows.is_delete,
          'count', account_rows.member_count
        )
        ORDER BY account_rows.member_count DESC, account_rows.name
      )
      FROM (
        SELECT
          COALESCE(origin.source_account_id, contact.account_id::bigint) AS account_id,
          COALESCE(account.name, 'Chưa gắn tài khoản') AS name,
          COALESCE(account.is_delete, false) AS is_delete,
          count(*)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        LEFT JOIN public.auto_accounts AS account
          ON account.id = COALESCE(origin.source_account_id, contact.account_id::bigint)
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY
          COALESCE(origin.source_account_id, contact.account_id::bigint),
          account.name,
          account.is_delete
      ) AS account_rows
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', tag_rows.id,
          'name', tag_rows.name,
          'color', tag_rows.color,
          'count', tag_rows.member_count
        )
        ORDER BY tag_rows.member_count DESC, tag_rows.name
      )
      FROM (
        SELECT
          tag.id,
          tag.name,
          tag.color,
          count(DISTINCT member.id)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        CROSS JOIN LATERAL unnest(COALESCE(contact.akabiz_tag_ids, ARRAY[]::bigint[])) AS tag_id
        JOIN public.auto_contact_tags AS tag
          ON tag.id = tag_id
         AND tag.staff_id = p_staff_id
         AND tag.organization_id = p_organization_id
         AND tag.is_delete = false
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY tag.id, tag.name, tag.color
      ) AS tag_rows
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', history_rows.id,
          'operation', history_rows.operation,
          'kind', history_rows.kind,
          'source_name', history_rows.source_name,
          'status', history_rows.status,
          'result', COALESCE(history_rows.result, '{}'::jsonb),
          'is_target_group', history_rows.target_group_id = v_group.id,
          'created_at', history_rows.created_at,
          'updated_at', history_rows.updated_at
        )
        ORDER BY history_rows.created_at DESC, history_rows.id DESC
      )
      FROM (
        SELECT batch.*
        FROM public.auto_data_ingest_batches AS batch
        WHERE batch.staff_id = p_staff_id
          AND batch.organization_id = p_organization_id
          AND (batch.group_id = v_group.id OR batch.target_group_id = v_group.id)
        ORDER BY batch.created_at DESC, batch.id DESC
        LIMIT 20
      ) AS history_rows
    ), '[]'::jsonb),
    'campaigns', COALESCE((
      WITH progress AS (
        SELECT *
        FROM public.aka_agent_control_campaign_progress(
          p_staff_id,
          p_organization_id,
          v_campaign_ids
        )
      ),
      detail_counts AS (
        SELECT
          detail.campaign_id,
          count(*) FILTER (
            WHERE detail.status IN ('thành công', 'hoàn thành', 'đã xem', 'đã click')
          )::bigint AS success_count,
          count(*) FILTER (
            WHERE detail.status IN ('thất bại', 'không tồn tại')
          )::bigint AS failure_count,
          count(*) FILTER (WHERE detail.status = 'lỗi')::bigint AS error_count
        FROM public.auto_campaign_details AS detail
        WHERE detail.campaign_id = ANY(v_campaign_ids)
          AND COALESCE(detail.is_delete, false) = false
        GROUP BY detail.campaign_id
      ),
      run_counts AS (
        SELECT run.campaign_id, count(*)::bigint AS run_count
        FROM public.auto_runs AS run
        WHERE run.campaign_id = ANY(v_campaign_ids)
        GROUP BY run.campaign_id
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', campaign.id,
          'name', campaign.name,
          'action_id', campaign.action_id,
          'action_name', COALESCE(action.name, campaign.action_id, '—'),
          'account_id', campaign.account_id,
          'account_name', COALESCE(account.name, '—'),
          'status', campaign.status,
          'schedule', campaign.schedule,
          'original_schedule', campaign.original_schedule,
          'schedule_type', campaign.schedule_type,
          'schedule_days', campaign.schedule_days,
          'schedule_week_days', campaign.schedule_week_days,
          'last_run_at', campaign.last_run_at,
          'completed_at', campaign.completed_at,
          'created_at', campaign.created_at,
          'updated_at', campaign.updated_at,
          'daily_limit', account.daily_limit,
          'source_status', source.status,
          'input_total', COALESCE(progress.input_total, 0),
          'input_completed', COALESCE(progress.input_completed, 0),
          'input_failed', COALESCE(progress.input_failed, 0),
          'success_count', COALESCE(detail_counts.success_count, 0),
          'failure_count', COALESCE(detail_counts.failure_count, 0),
          'error_count', COALESCE(detail_counts.error_count, 0),
          'run_count', COALESCE(run_counts.run_count, 0)
        )
        ORDER BY
          CASE campaign.status
            WHEN 'đang chạy' THEN 0
            WHEN 'tạm dừng' THEN 1
            WHEN 'chờ xử lý' THEN 2
            WHEN 'lỗi' THEN 3
            WHEN 'hoàn thành' THEN 4
            ELSE 5
          END,
          campaign.updated_at DESC,
          campaign.id DESC
      )
      FROM public.auto_campaigns AS campaign
      LEFT JOIN public.auto_campaign_actions AS action ON action.id = campaign.action_id
      LEFT JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      LEFT JOIN public.auto_campaign_data_group_sources AS source
        ON source.campaign_id = campaign.id
       AND source.staff_id = p_staff_id
       AND source.organization_id = p_organization_id
      LEFT JOIN progress ON progress.campaign_id = campaign.id
      LEFT JOIN detail_counts ON detail_counts.campaign_id = campaign.id
      LEFT JOIN run_counts ON run_counts.campaign_id = campaign.id
      WHERE campaign.id = ANY(v_campaign_ids)
    ), '[]'::jsonb)
  );
END;
$function$
;

CREATE FUNCTION public.aka_agent_list_data_group_members_v3(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_search text, p_account_ids bigint[], p_include_accountless boolean, p_contact_types text[], p_flatform_types text[], p_status text, p_dataset_ids bigint[], p_data_type_category_item_ids bigint[], p_ids bigint[], p_exclude_ids bigint[], p_offset integer, p_limit integer, p_auth_username text, p_auth_password text, p_source_codes text[])
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_groups WHERE id=p_group_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND purpose='data_group' AND NOT is_delete) THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF p_source_codes IS NULL OR cardinality(p_source_codes)=0 OR NOT p_source_codes <@ ARRAY['upload','scan','automation','dynamic_filter','external_sync']::text[] THEN RAISE EXCEPTION 'invalid_data_group_source_filter'; END IF;
  -- Filter membership IDs before the existing paging/count query. No contact
  -- facts, tag aggregation or per-row RPC is needed for this source predicate.
  SELECT COALESCE(array_agg(m.id),ARRAY[-1]::bigint[]) INTO p_ids
    FROM public.auto_account_contact_group_members m
    WHERE m.group_id=p_group_id AND NOT m.is_delete
      AND (p_ids IS NULL OR cardinality(p_ids)=0 OR m.id=ANY(p_ids))
      AND EXISTS(SELECT 1 FROM public.auto_account_contact_group_member_origins o
        JOIN public.category_item ci ON ci.id=o.source_category_item_id
        WHERE o.membership_id=m.id AND o.is_current AND ci.code=ANY(p_source_codes));
  RETURN QUERY SELECT to_jsonb(m) || jsonb_build_object('zalo_name',CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),contact.name) END,'display_name',CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),contact.name) END,'zalo_friend_status',CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)
  FROM public.aka_agent_list_data_group_members(p_staff_id,p_organization_id,p_group_id,p_search,p_account_ids,p_include_accountless,p_contact_types,p_flatform_types,p_status,p_dataset_ids,p_data_type_category_item_ids,p_ids,p_exclude_ids,p_offset,p_limit,p_auth_username,p_auth_password) m
  JOIN public.auto_account_contacts contact ON contact.id=m.contact_id
  LEFT JOIN public.zalo_users z ON z.account_id=contact.account_id AND z.zalo_uid=contact.uid
      AND z.staff_id=contact.staff_id AND z.organization_id=contact.organization_id AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_organization b ON b.auto_account_id=contact.account_id
      AND b.organization_id=contact.organization_id AND b.is_active AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=b.chat_zalo_account_id
      AND u.zalo_id=contact.uid AND contact.contact_type='person'
    LEFT JOIN public.category_item status ON status.id=u.friendship_status_category_item_id
  ORDER BY m.created_at DESC,m.id DESC;
END;
$function$
;

DO $acl$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname LIKE 'aka_agent_sheet_%' OR p.proname IN ('aka_agent_data_group_external_sync','aka_agent_data_group_background_tick','aka_agent_list_data_group_members_v3'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_data_group_members_v3(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text,text[]) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_sheet_claim(uuid),public.aka_agent_sheet_finish(uuid,jsonb,integer,integer,text,boolean) TO service_role;
-- Reuse the existing cron connection, cadence and concurrency budget. The new
-- dispatcher remains disabled until the authenticated Edge worker is deployed.
DO $cron$
BEGIN
  PERFORM cron.alter_job(jobid,command:='SELECT public.aka_agent_data_group_background_tick();')
    FROM cron.job WHERE jobname='aka-agent-data-group-dynamic-filter-worker';
END;
$cron$;
-- API metadata changed: these new RPCs must be visible to PostgREST.
NOTIFY pgrst,'reload schema';
COMMIT;
