-- Validation only, suitable for the production ledger after CONCURRENTLY build.
DO $verify$
DECLARE definition text; is_valid boolean; is_ready boolean; is_live boolean;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive
    INTO definition,is_valid,is_ready,is_live
  FROM pg_index i
  WHERE i.indexrelid=to_regclass('public.idx_auto_campaigns_app_access_held_account')
    AND i.indrelid='public.auto_campaigns'::regclass;
  IF definition IS DISTINCT FROM
    'CREATE INDEX idx_auto_campaigns_app_access_held_account ON public.auto_campaigns USING btree (account_id) WHERE ((status = ''đang chạy''::text) OR (runtime_claim_token IS NOT NULL) OR (runtime_unit_token IS NOT NULL))'
    OR NOT COALESCE(is_valid AND is_ready AND is_live,false) THEN
    RAISE EXCEPTION 'app_access_held index missing, invalid, or definition drift';
  END IF;
  IF (SELECT md5(pg_get_functiondef('private.app_access_held(text,bigint)'::regprocedure)))
    IS DISTINCT FROM '091b58186a65975e5faf5e620569feac' THEN
    RAISE EXCEPTION 'app_access_held function drift';
  END IF;
END $verify$;
