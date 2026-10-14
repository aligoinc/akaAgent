-- Fixtures only, inside a transaction ending in ROLLBACK. No source sequences.
CREATE TABLE public.__v384_campaign (LIKE public.auto_campaigns INCLUDING DEFAULTS);
ALTER TABLE public.__v384_campaign ADD PRIMARY KEY(id);
CREATE TRIGGER claim_before BEFORE UPDATE OF status ON public.__v384_campaign
  FOR EACH ROW EXECUTE FUNCTION public.aka_agent_clear_campaign_runtime_claim_metadata();
CREATE TRIGGER completed_before BEFORE UPDATE OF status ON public.__v384_campaign
  FOR EACH ROW EXECUTE FUNCTION public.aka_agent_set_campaign_completed_at();
CREATE TRIGGER capture AFTER INSERT OR UPDATE ON public.__v384_campaign
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('campaign_config_v1','id');
GRANT SELECT,INSERT,UPDATE ON public.__v384_campaign TO anon,authenticated,service_role;
INSERT INTO public.__v384_campaign(id,name,status,log,original_schedule,extra_settings)
  SELECT 1,'config','đang chạy',string_agg(md5(i::text),''),'2026-10-14 00:00Z',
    '{"actionLimits":{"dailyLimit":10},"sourceLinkIndex":1}' FROM generate_series(1,8192)i;

-- All excluded scalar fields, including the large log, change in one UPDATE.
UPDATE public.__v384_campaign SET log=log||'append',updated_at=clock_timestamp(),created_at=clock_timestamp(),
  status='đang chạy',note='runtime',schedule=clock_timestamp(),last_run_at=clock_timestamp(),completed_at=clock_timestamp(),
  control_idempotency_key='runtime',provisioning_state='ready',creation_bundle_id=383,creation_bundle_child_index=1,
  runtime_claim_token='00000000-0000-0000-0000-000000000383',runtime_claim_target='server',
  runtime_claimed_at=clock_timestamp(),runtime_claim_vietnam_date=CURRENT_DATE,
  runtime_unit_token='00000000-0000-0000-0000-000000000383',runtime_unit_vietnam_date=CURRENT_DATE,
  runtime_unit_claimed_at=clock_timestamp(),runtime_unit_input_data_ids=ARRAY[1::bigint],content_rotation_indexes='{"a":3}';
UPDATE public.__v384_campaign SET extra_settings=extra_settings||'{"sourceLinkIndex":2,"contentRotationIndex":1,"postBumpRotationIndex":3,
  "internalSmsCreatedCampaignIdsByAccount":{"a":1},"postBumpCreatedCampaignIdsByAccount":{"b":2},
  "zaloFriendDataMaterializedAt":"now","zaloFriendMaterializedCount":1,
  "zaloBirthdayDataMaterializedDate":"today","zaloBirthdayMaterializedCount":2,
  "zaloFriendRecommendationDataMaterializedAt":"now","zaloFriendRecommendationMaterializedCount":3,
  "zaloCancelFriendRequestDataMaterializedAt":"now","zaloCancelFriendRequestMaterializedCount":4}';
UPDATE public.__v384_campaign SET status='tạm dừng';
DO $pause$ BEGIN
  IF (SELECT runtime_claim_token FROM public.__v384_campaign WHERE id=1) IS NULL THEN
    RAISE EXCEPTION 'server pause claim behavior changed';
  END IF;
END $pause$;
UPDATE public.__v384_campaign SET status='chờ xử lý';
UPDATE public.__v384_campaign SET status='hoàn thành';
UPDATE public.__v384_campaign SET name=name;
DO $runtime$ BEGIN
  IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='__v384_campaign')<>1 THEN
    RAISE EXCEPTION 'runtime/no-op updates must not create logs';
  END IF;
  IF EXISTS(SELECT 1 FROM public.__v384_campaign WHERE runtime_claim_token IS NOT NULL OR completed_at IS NULL) THEN
    RAISE EXCEPTION 'claim cleanup/completion BEFORE behavior changed';
  END IF;
END $runtime$;

-- Every retained configuration column must independently produce one log.
DO $config$
DECLARE change record; previous_count bigint; assignment text;
BEGIN
  FOR change IN SELECT key,value FROM jsonb_each('{
    "id":2,"name":"Tiếng Việt 👋","action_id":"fixture","account_id":1,"secondary_account_id":2,
    "is_delete":true,"content":"new content","original_schedule":"2026-10-15T00:00:00Z",
    "schedule_type":"fixture","schedule_end_date":"2026-10-20T00:00:00Z","schedule_days":"1,2",
    "schedule_week_days":"2,3","continue_next_day":true,"refresh_data":true,
    "extra_settings":{"actionLimits":{"dailyLimit":20},"sourceLinkIndex":99},"images":["fixture.png"],
    "staff_id":10,"organization_id":20,"daily_stop_time":"20:15:00","time_sleep_between_2":17,
    "data_target_source_mode":"data_group","data_group_id":3
  }'::jsonb) LOOP
    SELECT count(*) INTO previous_count FROM public.auto_table_logs WHERE table_name='__v384_campaign';
    assignment:=format('UPDATE public.__v384_campaign SET %1$I=(jsonb_populate_record(NULL::public.__v384_campaign,$1)).%1$I',change.key);
    EXECUTE assignment USING jsonb_build_object(change.key,change.value);
    IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='__v384_campaign')<>previous_count+1 THEN
      RAISE EXCEPTION 'configuration field did not log: %',change.key;
    END IF;
  END LOOP;
END $config$;
UPDATE public.__v384_campaign SET content=NULL,log=log||'another append';
UPDATE public.__v384_campaign SET extra_settings=NULL;
UPDATE public.__v384_campaign SET extra_settings='{}';
UPDATE public.__v384_campaign SET extra_settings='{"sourceLinkIndex":12}';
DO $payload$ BEGIN
  IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='__v384_campaign')<>25
     OR EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='__v384_campaign'
       AND (new_data ?| ARRAY['log','updated_at','created_at','status','note','schedule','runtime_claim_token','content_rotation_indexes']
         OR new_data->'extra_settings' ?| ARRAY['sourceLinkIndex','postBumpRotationIndex','zaloFriendMaterializedCount']))
     OR NOT EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='__v384_campaign'
       AND record_pk='{"id":2}' AND old_data->>'id'='1')
     OR NOT EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='__v384_campaign'
       AND new_data->'content'='null'::jsonb AND old_data->>'content'='new content') THEN
    RAISE EXCEPTION 'config payload/key/NULL/normalization contract failed';
  END IF;
END $payload$;

SET LOCAL ROLE anon;
INSERT INTO public.__v384_campaign(id,name) VALUES(10,'anon');
RESET ROLE;
SET LOCAL ROLE authenticated;
UPDATE public.__v384_campaign SET content='auth config' WHERE id=10;
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.__v384_campaign SET updated_at=clock_timestamp(),log='only runtime' WHERE id=10;
DO $denied$ BEGIN
  BEGIN
    PERFORM 1 FROM public.auto_table_logs LIMIT 0;
    RAISE EXCEPTION 'application can read admin-only log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $denied$;
RESET ROLE;
DO $roles$ BEGIN
  IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='__v384_campaign' AND record_pk='{"id":10}')<>2 THEN
    RAISE EXCEPTION 'role execution/filter failed';
  END IF;
END $roles$;

INSERT INTO public.__v384_campaign(id,name) VALUES(10,'upsert config') ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO public.__v384_campaign(id,name) VALUES(10,'upsert config') ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO public.__v384_campaign(id,name) VALUES(11,'new upsert'),(12,'bulk') ON CONFLICT(id) DO UPDATE SET name=excluded.name;
UPDATE public.__v384_campaign SET content='bulk config' WHERE id IN (11,12);
UPDATE public.__v384_campaign SET content='zero' WHERE id=-1;
DELETE FROM public.__v384_campaign WHERE id=12;
DO $bulk$ BEGIN
  IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='__v384_campaign')<>32 THEN
    RAISE EXCEPTION 'bulk/upsert/delete count failed';
  END IF;
END $bulk$;
SAVEPOINT source_rollback;
UPDATE public.__v384_campaign SET content='must rollback';
ROLLBACK TO source_rollback;
DO $rollback$ BEGIN
  IF EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='__v384_campaign' AND new_data->>'content'='must rollback') THEN
    RAISE EXCEPTION 'rolled-back config retained a log';
  END IF;
END $rollback$;

CREATE TABLE public.__v384_error (LIKE public.auto_error INCLUDING DEFAULTS);
ALTER TABLE public.__v384_error ADD PRIMARY KEY(id);
CREATE TRIGGER capture AFTER INSERT OR UPDATE ON public.__v384_error
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('error_config_v1','id');
INSERT INTO public.__v384_error(id,error_type,error_code,error_name) VALUES(1,'fixture','fixture','fixture');
UPDATE public.__v384_error SET updated_at=clock_timestamp(),created_at=clock_timestamp();
UPDATE public.__v384_error SET error_name=error_name;
UPDATE public.__v384_error SET counts_toward_limit=NOT coalesce(counts_toward_limit,false),error_desc=NULL;
DO $error$ BEGIN
  IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='__v384_error')<>2
     OR EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='__v384_error' AND new_data ?| ARRAY['created_at','updated_at']) THEN
    RAISE EXCEPTION 'error policy/timestamp filtering failed';
  END IF;
END $error$;

CREATE TABLE public.__v384_composite(tenant_id bigint,id text,payload jsonb,PRIMARY KEY(tenant_id,id));
CREATE TRIGGER capture AFTER INSERT OR UPDATE ON public.__v384_composite
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('error_config_v1','tenant_id','id');
INSERT INTO public.__v384_composite VALUES(7,'a','{"x":true}');
UPDATE public.__v384_composite SET id='b';
DO $composite$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='__v384_composite' AND record_pk='{"tenant_id":7,"id":"b"}' AND old_data->>'id'='a') THEN
    RAISE EXCEPTION 'composite key failed';
  END IF;
END $composite$;
CREATE TABLE public.__v384_failure(id bigint PRIMARY KEY,payload text);
CREATE TRIGGER capture AFTER INSERT OR UPDATE ON public.__v384_failure
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('error_config_v1','id','payload');
INSERT INTO public.__v384_failure SELECT 1,string_agg(md5(i::text),'') FROM generate_series(1,1000)i;
UPDATE public.__v384_failure SET payload=payload||'updated';
DO $failure$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.__v384_failure WHERE right(payload,7)='updated')
     OR EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='__v384_failure') THEN
    RAISE EXCEPTION 'logging failure aborted original write';
  END IF;
END $failure$;

DO $privileges$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','aka_agent_chat_api'] LOOP
    IF has_table_privilege(r,'public.auto_table_logs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_sequence_privilege(r,'public.auto_table_logs_id_seq','USAGE,SELECT,UPDATE')
      OR has_function_privilege(r,'private.aka_agent_capture_table_change()','EXECUTE') THEN
      RAISE EXCEPTION 'v384 application role gained direct audit access';
    END IF;
  END LOOP;
END $privileges$;
