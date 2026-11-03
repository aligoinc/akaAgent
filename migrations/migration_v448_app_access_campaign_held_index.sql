-- Local/fresh replay. Production must build the same index CONCURRENTLY first,
-- then record this version with validation-only SQL; never run this blocking
-- CREATE on production. No RPC, permission, trigger or runtime setting changes.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regprocedure('private.app_access_held(text,bigint)') IS NULL OR
    (SELECT md5(pg_get_functiondef('private.app_access_held(text,bigint)'::regprocedure)))
      IS DISTINCT FROM '091b58186a65975e5faf5e620569feac' THEN
    RAISE EXCEPTION 'app_access_held definition drift; inspect live before index rollout';
  END IF;
  IF to_regclass('public.idx_auto_campaigns_app_access_held_account') IS NOT NULL THEN
    RAISE EXCEPTION 'Target index already exists; validate its identity instead of rebuilding';
  END IF;
END $preflight$;

-- Deleted rows may still own claims. Do not add an is_delete predicate.
CREATE INDEX idx_auto_campaigns_app_access_held_account
ON public.auto_campaigns USING btree (account_id)
WHERE status = 'đang chạy'
   OR runtime_claim_token IS NOT NULL
   OR runtime_unit_token IS NOT NULL;

COMMIT;
