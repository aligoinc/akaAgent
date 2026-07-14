-- Phase 1/3. Run this file in its own database invocation.
BEGIN;

ALTER TABLE public.auto_campaign_input_data
  ADD COLUMN IF NOT EXISTS control_append_idempotency_key text,
  ADD COLUMN IF NOT EXISTS control_append_row_index integer;

COMMENT ON COLUMN public.auto_campaign_input_data.control_append_idempotency_key IS
  'Stable client request key used by the control API to make campaign input append retry-safe.';
COMMENT ON COLUMN public.auto_campaign_input_data.control_append_row_index IS
  'Zero-based row position within a control API append request.';

COMMIT;
