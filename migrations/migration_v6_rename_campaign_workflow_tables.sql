-- ============================================================
-- Migration v6: Final campaign/workflow table names
-- - auto_campaign_result_actions -> auto_campaign_details
-- - auto_campaign_data_inputs -> auto_campaign_inputs
-- - auto_campaign_data_actions -> auto_campaign_input_data
-- - auto_v2_* tables -> auto_* tables
-- - FK columns renamed to match final table names where needed
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.auto_campaign_inputs') IS NULL
     AND to_regclass('public.auto_campaign_data_inputs') IS NOT NULL THEN
    ALTER TABLE public.auto_campaign_data_inputs RENAME TO auto_campaign_inputs;
  END IF;

  IF to_regclass('public.auto_campaign_input_data') IS NULL
     AND to_regclass('public.auto_campaign_data_actions') IS NOT NULL THEN
    ALTER TABLE public.auto_campaign_data_actions RENAME TO auto_campaign_input_data;
  END IF;

  IF to_regclass('public.auto_campaign_details') IS NULL
     AND to_regclass('public.auto_campaign_result_actions') IS NOT NULL THEN
    ALTER TABLE public.auto_campaign_result_actions RENAME TO auto_campaign_details;
  END IF;

  IF to_regclass('public.auto_blocks') IS NULL
     AND to_regclass('public.auto_v2_blocks') IS NOT NULL THEN
    ALTER TABLE public.auto_v2_blocks RENAME TO auto_blocks;
  END IF;

  IF to_regclass('public.auto_workflows') IS NULL
     AND to_regclass('public.auto_v2_workflows') IS NOT NULL THEN
    ALTER TABLE public.auto_v2_workflows RENAME TO auto_workflows;
  END IF;

  IF to_regclass('public.auto_elements') IS NULL
     AND to_regclass('public.auto_v2_elements') IS NOT NULL THEN
    ALTER TABLE public.auto_v2_elements RENAME TO auto_elements;
  END IF;

  IF to_regclass('public.auto_runs') IS NULL
     AND to_regclass('public.auto_v2_runs') IS NOT NULL THEN
    ALTER TABLE public.auto_v2_runs RENAME TO auto_runs;
  END IF;

  IF to_regclass('public.auto_run_steps') IS NULL
     AND to_regclass('public.auto_v2_run_steps') IS NOT NULL THEN
    ALTER TABLE public.auto_v2_run_steps RENAME TO auto_run_steps;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.auto_campaign_inputs_id_seq') IS NULL
     AND to_regclass('public.auto_campaign_data_inputs_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_campaign_data_inputs_id_seq RENAME TO auto_campaign_inputs_id_seq;
  END IF;

  IF to_regclass('public.auto_campaign_input_data_id_seq') IS NULL
     AND to_regclass('public.auto_campaign_data_actions_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_campaign_data_actions_id_seq RENAME TO auto_campaign_input_data_id_seq;
  END IF;

  IF to_regclass('public.auto_campaign_details_id_seq') IS NULL
     AND to_regclass('public.auto_campaign_result_actions_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_campaign_result_actions_id_seq RENAME TO auto_campaign_details_id_seq;
  END IF;

  IF to_regclass('public.auto_blocks_id_seq') IS NULL
     AND to_regclass('public.auto_v2_blocks_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_v2_blocks_id_seq RENAME TO auto_blocks_id_seq;
  END IF;

  IF to_regclass('public.auto_workflows_id_seq') IS NULL
     AND to_regclass('public.auto_v2_workflows_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_v2_workflows_id_seq RENAME TO auto_workflows_id_seq;
  END IF;

  IF to_regclass('public.auto_elements_id_seq') IS NULL
     AND to_regclass('public.auto_v2_elements_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_v2_elements_id_seq RENAME TO auto_elements_id_seq;
  END IF;

  IF to_regclass('public.auto_runs_id_seq') IS NULL
     AND to_regclass('public.auto_v2_runs_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_v2_runs_id_seq RENAME TO auto_runs_id_seq;
  END IF;

  IF to_regclass('public.auto_run_steps_id_seq') IS NULL
     AND to_regclass('public.auto_v2_run_steps_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.auto_v2_run_steps_id_seq RENAME TO auto_run_steps_id_seq;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_input_data' AND column_name = 'data_input_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_input_data' AND column_name = 'input_id'
  ) THEN
    ALTER TABLE public.auto_campaign_input_data RENAME COLUMN data_input_id TO input_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_details' AND column_name = 'data_action_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_details' AND column_name = 'input_data_id'
  ) THEN
    ALTER TABLE public.auto_campaign_details RENAME COLUMN data_action_id TO input_data_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_runs' AND column_name = 'campaign_data_action_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_runs' AND column_name = 'campaign_input_data_id'
  ) THEN
    ALTER TABLE public.auto_runs RENAME COLUMN campaign_data_action_id TO campaign_input_data_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_actions' AND column_name = 'workflow_v2_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_actions' AND column_name = 'workflow_id'
  ) THEN
    ALTER TABLE public.auto_campaign_actions RENAME COLUMN workflow_v2_id TO workflow_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_details' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_details' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.auto_campaign_details RENAME COLUMN channel_id TO account_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_runs' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_runs' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.auto_runs RENAME COLUMN channel_id TO account_id;
  END IF;
END $$;

DO $$
BEGIN
  -- Campaign input tables
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_data_inputs_pkey') THEN
    ALTER TABLE public.auto_campaign_inputs RENAME CONSTRAINT auto_campaign_data_inputs_pkey TO auto_campaign_inputs_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_data_inputs_status_check') THEN
    ALTER TABLE public.auto_campaign_inputs RENAME CONSTRAINT auto_campaign_data_inputs_status_check TO auto_campaign_inputs_status_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_data_inputs_campaign_id_fkey') THEN
    ALTER TABLE public.auto_campaign_inputs RENAME CONSTRAINT auto_campaign_data_inputs_campaign_id_fkey TO auto_campaign_inputs_campaign_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_data_actions_pkey') THEN
    ALTER TABLE public.auto_campaign_input_data RENAME CONSTRAINT auto_campaign_data_actions_pkey TO auto_campaign_input_data_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_data_actions_status_check') THEN
    ALTER TABLE public.auto_campaign_input_data RENAME CONSTRAINT auto_campaign_data_actions_status_check TO auto_campaign_input_data_status_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_data_actions_campaign_id_fkey') THEN
    ALTER TABLE public.auto_campaign_input_data RENAME CONSTRAINT auto_campaign_data_actions_campaign_id_fkey TO auto_campaign_input_data_campaign_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_data_actions_data_input_id_fkey') THEN
    ALTER TABLE public.auto_campaign_input_data RENAME CONSTRAINT auto_campaign_data_actions_data_input_id_fkey TO auto_campaign_input_data_input_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_result_actions_pkey') THEN
    ALTER TABLE public.auto_campaign_details RENAME CONSTRAINT auto_campaign_result_actions_pkey TO auto_campaign_details_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_result_actions_status_check') THEN
    ALTER TABLE public.auto_campaign_details RENAME CONSTRAINT auto_campaign_result_actions_status_check TO auto_campaign_details_status_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_result_actions_data_action_id_fkey') THEN
    ALTER TABLE public.auto_campaign_details RENAME CONSTRAINT auto_campaign_result_actions_data_action_id_fkey TO auto_campaign_details_input_data_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_result_actions_campaign_id_fkey') THEN
    ALTER TABLE public.auto_campaign_details RENAME CONSTRAINT auto_campaign_result_actions_campaign_id_fkey TO auto_campaign_details_campaign_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_result_actions_channel_id_fkey') THEN
    ALTER TABLE public.auto_campaign_details RENAME CONSTRAINT auto_campaign_result_actions_channel_id_fkey TO auto_campaign_details_account_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_result_actions_account_id_fkey') THEN
    ALTER TABLE public.auto_campaign_details RENAME CONSTRAINT auto_campaign_result_actions_account_id_fkey TO auto_campaign_details_account_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  -- Workflow engine tables
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_blocks_pkey') THEN
    ALTER TABLE public.auto_blocks RENAME CONSTRAINT auto_v2_blocks_pkey TO auto_blocks_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_blocks_name_key') THEN
    ALTER TABLE public.auto_blocks RENAME CONSTRAINT auto_v2_blocks_name_key TO auto_blocks_name_key;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_workflows_pkey') THEN
    ALTER TABLE public.auto_workflows RENAME CONSTRAINT auto_v2_workflows_pkey TO auto_workflows_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_workflows_name_key') THEN
    ALTER TABLE public.auto_workflows RENAME CONSTRAINT auto_v2_workflows_name_key TO auto_workflows_name_key;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_elements_pkey') THEN
    ALTER TABLE public.auto_elements RENAME CONSTRAINT auto_v2_elements_pkey TO auto_elements_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_elements_name_key') THEN
    ALTER TABLE public.auto_elements RENAME CONSTRAINT auto_v2_elements_name_key TO auto_elements_name_key;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_runs_pkey') THEN
    ALTER TABLE public.auto_runs RENAME CONSTRAINT auto_v2_runs_pkey TO auto_runs_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_runs_campaign_data_action_id_fkey') THEN
    ALTER TABLE public.auto_runs RENAME CONSTRAINT auto_v2_runs_campaign_data_action_id_fkey TO auto_runs_campaign_input_data_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_run_steps_pkey') THEN
    ALTER TABLE public.auto_run_steps RENAME CONSTRAINT auto_v2_run_steps_pkey TO auto_run_steps_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_v2_run_steps_run_id_fkey') THEN
    ALTER TABLE public.auto_run_steps RENAME CONSTRAINT auto_v2_run_steps_run_id_fkey TO auto_run_steps_run_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_actions_workflow_v2_id_fkey') THEN
    ALTER TABLE public.auto_campaign_actions RENAME CONSTRAINT auto_campaign_actions_workflow_v2_id_fkey TO auto_campaign_actions_workflow_id_fkey;
  END IF;
END $$;

ALTER INDEX IF EXISTS public.idx_data_inputs_campaign_id RENAME TO idx_campaign_inputs_campaign_id;
ALTER INDEX IF EXISTS public.idx_data_inputs_status RENAME TO idx_campaign_inputs_status;
ALTER INDEX IF EXISTS public.idx_data_actions_campaign_id RENAME TO idx_campaign_input_data_campaign_id;
ALTER INDEX IF EXISTS public.idx_data_actions_data_input_id RENAME TO idx_campaign_input_data_input_id;
ALTER INDEX IF EXISTS public.idx_data_actions_status RENAME TO idx_campaign_input_data_status;
ALTER INDEX IF EXISTS public.idx_result_actions_channel_id RENAME TO idx_campaign_details_account_id;
ALTER INDEX IF EXISTS public.idx_result_actions_account_id RENAME TO idx_campaign_details_account_id;
ALTER INDEX IF EXISTS public.idx_result_actions_campaign_id RENAME TO idx_campaign_details_campaign_id;
ALTER INDEX IF EXISTS public.idx_result_actions_data_action_id RENAME TO idx_campaign_details_input_data_id;
ALTER INDEX IF EXISTS public.idx_result_actions_rate_limit RENAME TO idx_campaign_details_rate_limit;
ALTER INDEX IF EXISTS public.idx_result_actions_rate_limit_account RENAME TO idx_campaign_details_rate_limit;

ALTER INDEX IF EXISTS public.idx_v2_blocks_category RENAME TO idx_blocks_category;
ALTER INDEX IF EXISTS public.idx_v2_blocks_staff RENAME TO idx_blocks_staff;
ALTER INDEX IF EXISTS public.idx_v2_blocks_builtin RENAME TO idx_blocks_builtin;
ALTER INDEX IF EXISTS public.idx_v2_workflows_staff RENAME TO idx_workflows_staff;
ALTER INDEX IF EXISTS public.idx_v2_workflows_builtin RENAME TO idx_workflows_builtin;
ALTER INDEX IF EXISTS public.idx_v2_elements_category RENAME TO idx_elements_category;
ALTER INDEX IF EXISTS public.idx_v2_elements_staff RENAME TO idx_elements_staff;
ALTER INDEX IF EXISTS public.idx_v2_runs_campaign RENAME TO idx_runs_campaign;
ALTER INDEX IF EXISTS public.idx_v2_runs_workflow RENAME TO idx_runs_workflow;
ALTER INDEX IF EXISTS public.idx_v2_runs_status RENAME TO idx_runs_status;
ALTER INDEX IF EXISTS public.idx_v2_runs_data_action RENAME TO idx_runs_campaign_input_data;
ALTER INDEX IF EXISTS public.idx_v2_run_steps_run RENAME TO idx_run_steps_run;
ALTER INDEX IF EXISTS public.idx_v2_run_steps_node RENAME TO idx_run_steps_node;
ALTER INDEX IF EXISTS public.idx_v2_run_steps_block_name RENAME TO idx_run_steps_block_name;

COMMENT ON COLUMN public.auto_campaign_actions.workflow_id IS 'FK auto_workflows.id. Scheduler runs the workflow when this is NOT NULL.';
COMMENT ON COLUMN public.auto_campaign_input_data.input_id IS 'FK auto_campaign_inputs.id; NULL when the row was entered directly.';
COMMENT ON COLUMN public.auto_campaign_details.input_data_id IS 'FK auto_campaign_input_data.id; nullable for simple campaigns.';
COMMENT ON COLUMN public.auto_runs.campaign_input_data_id IS 'FK auto_campaign_input_data.id for campaign workflow runs.';

NOTIFY pgrst, 'reload schema';

COMMIT;
