-- Phase 2/3. This file intentionally contains one statement only.
-- Run it outside any explicit transaction and in its own database invocation.
-- If a prior attempt failed, DROP the invalid index CONCURRENTLY in a separate
-- invocation before retrying; do not hide an invalid index with IF NOT EXISTS.
CREATE UNIQUE INDEX CONCURRENTLY uq_auto_campaign_input_data_control_append
  ON public.auto_campaign_input_data (
    campaign_id,
    control_append_idempotency_key,
    control_append_row_index
  )
  WHERE control_append_idempotency_key IS NOT NULL;
