-- v361 post-commit stages, executed individually through the existing linked
-- Management API by scripts/apply-action-status-policy-migration.cjs indexes.
-- Already applied on akachat. Do not execute this file inside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY auto_detail_result_key_uq ON public.auto_campaign_details(result_key) WHERE result_key IS NOT NULL;
CREATE INDEX CONCURRENTLY auto_detail_status_id_idx ON public.auto_campaign_details(status_id) WHERE status_id IS NOT NULL;
CREATE INDEX CONCURRENTLY auto_detail_sub_status_id_idx ON public.auto_campaign_details(sub_status_id) WHERE sub_status_id IS NOT NULL;
CREATE INDEX CONCURRENTLY auto_detail_action_status_policy_id_idx ON public.auto_campaign_details(action_status_policy_id) WHERE action_status_policy_id IS NOT NULL;

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
ALTER TABLE public.auto_campaign_details VALIDATE CONSTRAINT auto_detail_status_fk;
ALTER TABLE public.auto_campaign_details VALIDATE CONSTRAINT auto_detail_sub_status_fk;
ALTER TABLE public.auto_campaign_details VALIDATE CONSTRAINT auto_detail_policy_fk;
ALTER TABLE public.auto_campaign_details VALIDATE CONSTRAINT auto_detail_report_group_check;
ALTER TABLE public.auto_campaign_details VALIDATE CONSTRAINT auto_detail_snapshot_check;
ALTER TABLE public.auto_campaign_details VALIDATE CONSTRAINT auto_detail_result_key_check;
COMMIT;
