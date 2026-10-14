-- Run in a transaction ending in ROLLBACK. Fixtures only; never mutate real
-- campaigns/error policies. Source sequence defaults are not used (explicit IDs).
DO $catalog$
BEGIN
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='private.auto_table_logs'::regclass
      AND attnum>0 AND NOT attisdropped)<>7
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.auto_table_logs'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='private.auto_table_logs'::regclass)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.auto_table_logs'::regclass AND contype='f')
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.auto_campaigns'::regclass,'public.auto_error'::regclass)
       AND tgname='trg_auto_table_log' AND tgtype=21 AND tgenabled='O' AND tgqual IS NULL
       AND tgfoid='private.aka_agent_capture_table_change()'::regprocedure
       AND encode(tgargs,'escape')=E'id\\000')<>2 THEN
    RAISE EXCEPTION 'v382 table/trigger contract failed';
  END IF;
END;
$catalog$;

CREATE TABLE public.__v382_campaign_fixture (LIKE public.auto_campaigns INCLUDING DEFAULTS);
ALTER TABLE public.__v382_campaign_fixture ADD PRIMARY KEY(id);
CREATE TRIGGER v382_claim_metadata BEFORE UPDATE OF status ON public.__v382_campaign_fixture
  FOR EACH ROW EXECUTE FUNCTION public.aka_agent_clear_campaign_runtime_claim_metadata();
CREATE TRIGGER v382_completed_at BEFORE UPDATE OF status ON public.__v382_campaign_fixture
  FOR EACH ROW EXECUTE FUNCTION public.aka_agent_set_campaign_completed_at();
CREATE TRIGGER v382_capture AFTER INSERT OR UPDATE ON public.__v382_campaign_fixture
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('id');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.__v382_campaign_fixture TO anon,authenticated,service_role,aka_agent_chat_api;

INSERT INTO public.__v382_campaign_fixture(id,name,status,runtime_claim_token,runtime_claim_target,runtime_claimed_at,runtime_claim_vietnam_date)
  VALUES(1,'fixture','đang chạy','00000000-0000-0000-0000-000000000382','server',now(),CURRENT_DATE);
UPDATE public.__v382_campaign_fixture SET name=name WHERE id=1;
UPDATE public.__v382_campaign_fixture SET name='Tiếng Việt 👋',note=NULL,log='line one',extra_settings='{"nested":{"a":null},"array":[1,2]}' WHERE id=1;
UPDATE public.__v382_campaign_fixture SET id=2 WHERE id=1;
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(3,'bulk 3','chờ xử lý'),(4,'bulk 4','chờ xử lý');
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(3,'upsert','chờ xử lý')
  ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(5,'upsert insert','chờ xử lý')
  ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(5,'ignored','chờ xử lý') ON CONFLICT DO NOTHING;
UPDATE public.__v382_campaign_fixture SET name='zero rows' WHERE id=999;
DELETE FROM public.__v382_campaign_fixture WHERE id=4;
UPDATE public.__v382_campaign_fixture SET status='tạm dừng' WHERE id=2;
DO $pause$
BEGIN
  IF (SELECT runtime_claim_token FROM public.__v382_campaign_fixture WHERE id=2) IS DISTINCT FROM '00000000-0000-0000-0000-000000000382'::uuid THEN
    RAISE EXCEPTION 'v382 changed live server pause claim guard';
  END IF;
END;
$pause$;
UPDATE public.__v382_campaign_fixture SET status='chờ xử lý' WHERE id=2;
DO $clear$
BEGIN
  IF (SELECT runtime_claim_token FROM public.__v382_campaign_fixture WHERE id=2) IS NOT NULL THEN
    RAISE EXCEPTION 'v382 changed live claim cleanup';
  END IF;
END;
$clear$;
UPDATE public.__v382_campaign_fixture SET status='hoàn thành' WHERE id=2;

DO $snapshots$
DECLARE v_log private.auto_table_logs%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture')<>11 THEN
    RAISE EXCEPTION 'v382 row/upsert/no-op/delete event count failed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture'
      AND operation='UPDATE' AND old_data=new_data)
     OR NOT EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture'
      AND record_pk='{"id":2}' AND old_data->>'id'='1' AND new_data->>'id'='2')
     OR NOT EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture'
      AND new_data->'extra_settings'='{"nested":{"a":null},"array":[1,2]}' AND new_data->'note'='null'::jsonb)
     OR NOT EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture'
      AND record_pk='{"id":4}' AND operation='INSERT' AND old_data IS NULL) THEN
    RAISE EXCEPTION 'v382 full snapshots/null/PK/no-op/delete retention failed';
  END IF;
  SELECT * INTO STRICT v_log FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture' AND record_pk='{"id":2}' ORDER BY id DESC LIMIT 1;
  IF v_log.new_data IS DISTINCT FROM (SELECT to_jsonb(c) FROM public.__v382_campaign_fixture c WHERE id=2)
     OR v_log.new_data->'completed_at'='null'::jsonb
     OR v_log.new_data->'runtime_claim_token'<>'null'::jsonb THEN
    RAISE EXCEPTION 'v382 snapshot must include live BEFORE-trigger results and every column';
  END IF;
END;
$snapshots$;

UPDATE public.__v382_campaign_fixture SET note='bulk update' WHERE id IN (3,5);
DO $bulk$
BEGIN
  IF (SELECT count(*) FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture')<>13
     OR (SELECT count(*) FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture' AND new_data->>'note'='bulk update')<>2 THEN
    RAISE EXCEPTION 'v382 bulk UPDATE must emit one log per affected row';
  END IF;
END;
$bulk$;

-- Real role switches, not JWT-only impersonation. INSERT works through the
-- trigger even though direct table/sequence/function access is not granted.
SET LOCAL ROLE anon;
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(21,'anon','chờ xử lý');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(22,'authenticated','chờ xử lý');
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(23,'service_role','chờ xử lý');
DO $denied$
BEGIN
  BEGIN
    PERFORM 1 FROM private.auto_table_logs LIMIT 0;
    RAISE EXCEPTION 'v382 unauthorized SELECT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO private.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('forged','{"id":1}','INSERT','{}');
    RAISE EXCEPTION 'v382 unauthorized INSERT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$denied$;
RESET ROLE;
DO $chat_role$
BEGIN
  IF pg_has_role(current_user,'aka_agent_chat_api','SET') THEN
    EXECUTE 'SET LOCAL ROLE aka_agent_chat_api';
    INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(24,'chat role','chờ xử lý');
    EXECUTE 'RESET ROLE';
  ELSE
    RAISE NOTICE 'v382: caller cannot SET ROLE aka_agent_chat_api; execution covered in isolated DB, ACL checked below';
  END IF;
END;
$chat_role$;
DO $acl$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','aka_agent_chat_api'] LOOP
    IF has_table_privilege(v_role,'private.auto_table_logs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_sequence_privilege(v_role,'private.auto_table_logs_id_seq','USAGE,SELECT,UPDATE')
       OR has_function_privilege(v_role,'private.aka_agent_capture_table_change()','EXECUTE') THEN
      RAISE EXCEPTION 'v382 application role has direct audit privileges';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture' AND (record_pk->>'id')::bigint BETWEEN 21 AND 24)
      <>(3+CASE WHEN pg_has_role(current_user,'aka_agent_chat_api','SET') THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'v382 source writes must log under every application role';
  END IF;
END;
$acl$;

SAVEPOINT v382_rolled_back_write;
INSERT INTO public.__v382_campaign_fixture(id,name,status) VALUES(50,'rolled back','chờ xử lý');
ROLLBACK TO SAVEPOINT v382_rolled_back_write;
DO $rollback$
BEGIN
  IF EXISTS(SELECT 1 FROM public.__v382_campaign_fixture WHERE id=50)
     OR EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture' AND record_pk='{"id":50}') THEN
    RAISE EXCEPTION 'v382 rolled-back write retained source/log';
  END IF;
END;
$rollback$;

CREATE TABLE public.__v382_composite_fixture(tenant_id bigint,id text,payload jsonb,PRIMARY KEY(tenant_id,id));
CREATE TRIGGER v382_capture AFTER INSERT OR UPDATE ON public.__v382_composite_fixture
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('tenant_id','id');
INSERT INTO public.__v382_composite_fixture VALUES(7,'a','{"x":true}');
UPDATE public.__v382_composite_fixture SET id='b',payload=NULL;
DO $composite$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_composite_fixture'
      AND record_pk='{"tenant_id":7,"id":"b"}' AND old_data->>'id'='a' AND new_data->'payload'='null'::jsonb) THEN
    RAISE EXCEPTION 'v382 composite key/NULL update failed';
  END IF;
END;
$composite$;

-- Force a real log INSERT/index failure without altering/locking the live log
-- table. Deliberately misconfigure the key with a large non-key text field.
CREATE TABLE public.__v382_failure_fixture(id bigint PRIMARY KEY,log text);
CREATE TRIGGER v382_capture AFTER INSERT OR UPDATE ON public.__v382_failure_fixture
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('id','log');
INSERT INTO public.__v382_failure_fixture SELECT 1,string_agg(md5(i::text),'') FROM generate_series(1,1000)i;
UPDATE public.__v382_failure_fixture SET log=log||'updated';
DO $failure$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.__v382_failure_fixture WHERE id=1 AND right(log,7)='updated')
     OR EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_failure_fixture') THEN
    RAISE EXCEPTION 'v382 failed log INSERT must not abort source INSERT/UPDATE';
  END IF;
END;
$failure$;

CREATE TEMP TABLE __v382_wrong_schema(id bigint);
CREATE TRIGGER v382_capture AFTER INSERT OR UPDATE ON __v382_wrong_schema
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('id');
INSERT INTO __v382_wrong_schema VALUES(1);
DO $schema_guard$
BEGIN
  IF EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='__v382_wrong_schema') THEN
    RAISE EXCEPTION 'v382 must not capture non-public tables';
  END IF;
END;
$schema_guard$;

DO $constraints$
BEGIN
  BEGIN
    INSERT INTO private.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('invalid','{"id":1}','DELETE','{}');
    RAISE EXCEPTION 'v382 accepted DELETE';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO private.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('invalid','{"id":1}','UPDATE','{}');
    RAISE EXCEPTION 'v382 accepted UPDATE without old_data';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO private.auto_table_logs(table_name,record_pk,operation,old_data,new_data) VALUES('invalid','{"id":1}','INSERT','{}','{}');
    RAISE EXCEPTION 'v382 accepted INSERT with old_data';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO private.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('invalid','[]','INSERT','{}');
    RAISE EXCEPTION 'v382 accepted non-object key';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO private.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('invalid','{"id":1}','INSERT','null');
    RAISE EXCEPTION 'v382 accepted non-object new_data';
  EXCEPTION WHEN check_violation THEN NULL; END;
END;
$constraints$;
