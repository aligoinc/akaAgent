-- Clone a dedicated test workflow for the Zalo phone campaign.
-- The action may currently have no test workflow, or it may temporarily point
-- to the production workflow. Keep the test workflow separate so staff using
-- test mode can edit it without touching production.

BEGIN;

WITH source_action AS (
  SELECT
    ca.id AS action_id,
    wf.id AS workflow_id,
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
  WHERE ca.id = 'zalo_message_phone'
    AND ca.workflow_id IS NOT NULL
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
  source_action.test_workflow_name,
  source_action.description,
  source_action.nodes,
  source_action.edges,
  source_action.variables_schema,
  source_action.default_variables,
  false,
  source_action.staff_id,
  source_action.organization_id,
  now()
FROM source_action
WHERE NOT EXISTS (
  SELECT 1
  FROM public.auto_workflows existing
  WHERE existing.name = source_action.test_workflow_name
);

WITH source_action AS (
  SELECT
    ca.id AS action_id,
    wf.name || '__test__' || ca.id AS test_workflow_name
  FROM public.auto_campaign_actions ca
  JOIN public.auto_workflows wf ON wf.id = ca.workflow_id
  WHERE ca.id = 'zalo_message_phone'
    AND ca.workflow_id IS NOT NULL
)
UPDATE public.auto_campaign_actions ca
SET test_workflow_id = test_wf.id
FROM source_action
JOIN public.auto_workflows test_wf
  ON test_wf.name = source_action.test_workflow_name
WHERE ca.id = source_action.action_id
  AND ca.test_workflow_id IS DISTINCT FROM test_wf.id;

NOTIFY pgrst, 'reload schema';

COMMIT;
