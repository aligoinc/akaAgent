-- Build on the existing Management API connection, outside a transaction.
-- Run phases separately with scripts/apply-campaign-details-page-index.cjs.
-- CREATE INDEX CONCURRENTLY cannot run in a transaction/multi-statement request.
-- created_at and id are NOT NULL: one index serves ASC and backward DESC.
-- No API metadata changes, schema reload, columns, triggers or new connections.
-- @phase preflight
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_attribute
      WHERE attrelid = 'public.auto_campaign_details'::regclass
        AND attname IN ('created_at', 'id') AND attnotnull AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'campaign_details_page_requires_nonnull_order_keys';
  END IF;
  IF to_regclass('public.idx_campaign_details_page') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_campaign_details_page')
      AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_campaign_details_page ON public.auto_campaign_details USING btree (campaign_id, created_at, id) WHERE (is_delete = false)' AND indisvalid AND indisready
  ) THEN
    RAISE EXCEPTION 'campaign_details_page_index_changed_or_invalid';
  END IF;
END;
$preflight$;
-- @phase build
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaign_details_page
  ON public.auto_campaign_details (campaign_id, created_at, id)
  WHERE is_delete = false;
-- @phase postflight
DO $postflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('public.idx_campaign_details_page')
      AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_campaign_details_page ON public.auto_campaign_details USING btree (campaign_id, created_at, id) WHERE (is_delete = false)' AND indisvalid AND indisready) THEN
    RAISE EXCEPTION 'campaign_details_page_index_not_ready';
  END IF;
END;
$postflight$;
