-- Submit this ONE statement outside any transaction through the linked API.
-- Use the existing Management API timeout; do not combine SET with this batch.
CREATE INDEX CONCURRENTLY auto_detail_committed_delivery_v367 ON public.auto_campaign_details (account_id,action_code,created_at DESC,input_data_id) WHERE policy_snapshot->>'operationState'='committed';
