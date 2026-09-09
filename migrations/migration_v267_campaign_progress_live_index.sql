-- Index-only optimization for aka_agent_control_campaign_progress.
-- Matches its exact is_delete = false predicate; NULL remains excluded.
-- No RPC, API contract, data or PostgREST schema reload changes.
--
-- Run this file outside a transaction, on one persistent connection with:
--   SET maintenance_work_mem = '128MB';
--   SET max_parallel_maintenance_workers = 0;
--   SET lock_timeout = '120s';
--   SET statement_timeout = '10min';
-- Confirm the target name is absent and no equivalent valid index exists first.
-- Do not use IF NOT EXISTS: a failed concurrent build can leave an invalid index.
-- After success, verify indisvalid/indisready and record this migration in the
-- existing migration history without creating/altering its schema.
CREATE INDEX CONCURRENTLY idx_campaign_input_data_progress_live
  ON public.auto_campaign_input_data (campaign_id, status)
  WHERE is_delete = false;
