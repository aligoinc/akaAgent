-- Keep the facebook_group_post test workflow aligned with the production workflow.

UPDATE public.auto_workflows test_wf
SET
  description = prod_wf.description,
  nodes = prod_wf.nodes,
  edges = prod_wf.edges,
  variables_schema = prod_wf.variables_schema,
  default_variables = prod_wf.default_variables,
  updated_at = now()
FROM public.auto_campaign_actions action
JOIN public.auto_workflows prod_wf
  ON prod_wf.id = action.workflow_id
WHERE action.id = 'facebook_group_post'
  AND action.test_workflow_id IS NOT NULL
  AND test_wf.id = action.test_workflow_id;
