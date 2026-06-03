-- Add per-staff workflow test mode and per-action test workflows.
ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS use_test_workflow boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_staff.use_test_workflow IS
  'Nếu true: campaign scheduler của staff này chạy auto_campaign_actions.test_workflow_id thay vì workflow_id.';

ALTER TABLE public.auto_campaign_actions
  ADD COLUMN IF NOT EXISTS test_workflow_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auto_campaign_actions_test_workflow_id_fkey'
  ) THEN
    ALTER TABLE public.auto_campaign_actions
      ADD CONSTRAINT auto_campaign_actions_test_workflow_id_fkey
      FOREIGN KEY (test_workflow_id) REFERENCES public.auto_workflows(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS auto_campaign_actions_test_workflow_id_idx
  ON public.auto_campaign_actions(test_workflow_id);

COMMENT ON COLUMN public.auto_campaign_actions.test_workflow_id IS
  'FK auto_workflows.id. Used only when current org_staff.use_test_workflow=true.';

WITH source_actions AS (
  SELECT
    ca.id AS action_id,
    ca.workflow_id,
    wf.name || '__test__' || ca.id AS test_workflow_name,
    wf.description,
    wf.nodes,
    wf.edges,
    wf.variables_schema,
    wf.default_variables,
    wf.staff_id,
    wf.organization_id
  FROM public.auto_campaign_actions ca
  JOIN public.auto_workflows wf ON wf.id = ca.workflow_id
  WHERE ca.workflow_id IS NOT NULL
    AND ca.is_delete = false
)
INSERT INTO public.auto_workflows (
  name,
  description,
  nodes,
  edges,
  variables_schema,
  default_variables,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
SELECT
  source_actions.test_workflow_name,
  source_actions.description,
  source_actions.nodes,
  source_actions.edges,
  source_actions.variables_schema,
  source_actions.default_variables,
  false,
  source_actions.staff_id,
  source_actions.organization_id,
  now()
FROM source_actions
WHERE NOT EXISTS (
  SELECT 1
  FROM public.auto_workflows existing
  WHERE existing.name = source_actions.test_workflow_name
);

WITH source_actions AS (
  SELECT
    ca.id AS action_id,
    wf.name || '__test__' || ca.id AS test_workflow_name
  FROM public.auto_campaign_actions ca
  JOIN public.auto_workflows wf ON wf.id = ca.workflow_id
  WHERE ca.workflow_id IS NOT NULL
    AND ca.is_delete = false
)
UPDATE public.auto_campaign_actions ca
SET test_workflow_id = test_wf.id
FROM source_actions
JOIN public.auto_workflows test_wf
  ON test_wf.name = source_actions.test_workflow_name
WHERE ca.id = source_actions.action_id
  AND ca.test_workflow_id IS NULL;
