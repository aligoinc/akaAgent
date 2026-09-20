-- Index only: recovery and cancellation must not scan completed run history.
-- No RPC/table metadata change or schema reload.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';

DO $preflight$
DECLARE item record; signature_oid oid;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('public.aka_agent_sheet_claim(uuid)','00bc55ed63fadabdb76c8a3f0283a639'),
    ('public.aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb)','b85a58727a68514b9a5837861adfe35b')
  ) expected(signature,checksum) LOOP
    signature_oid:=to_regprocedure(item.signature);
    IF signature_oid IS NULL OR md5(pg_get_functiondef(signature_oid)) IS DISTINCT FROM item.checksum THEN
      RAISE EXCEPTION 'v301 RPC drift: %',item.signature;
    END IF;
  END LOOP;
  -- The audited table has three rows. Fail closed if a later deployment would
  -- turn this short transactional build into a large blocking index build.
  IF to_regclass('public.idx_data_group_external_sync_runs_running') IS NULL
    AND pg_relation_size('public.auto_data_group_external_sync_runs')>10485760 THEN
    RAISE EXCEPTION 'v301 run history grew beyond 10 MiB; reassess index build';
  END IF;
END;
$preflight$;

CREATE INDEX IF NOT EXISTS idx_data_group_external_sync_runs_running
  ON public.auto_data_group_external_sync_runs(source_id,started_at)
  WHERE status='running';

DO $postflight$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid=to_regclass('public.idx_data_group_external_sync_runs_running')
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND pg_get_indexdef(i.indexrelid)='CREATE INDEX idx_data_group_external_sync_runs_running ON public.auto_data_group_external_sync_runs USING btree (source_id, started_at) WHERE (status = ''running''::text)'
  ) THEN RAISE EXCEPTION 'v301 running index definition drift'; END IF;
END;
$postflight$;

COMMIT;
