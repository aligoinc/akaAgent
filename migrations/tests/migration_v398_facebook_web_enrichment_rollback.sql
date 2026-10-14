-- Operational rollback: keep API metadata/configuration, disable optional browsing only.
-- Close/stop Desktop runtimes first. Default is a dry run; COMMIT only for an intended rollback.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)')))
   IS DISTINCT FROM '4505f7334baa90908454c354dd091db5' THEN RAISE EXCEPTION 'v398 rollback: RPC changed; review live definition'; END IF;
 IF (SELECT md5(code) FROM public.auto_blocks WHERE name='fb_web_enrichment_browse') IS DISTINCT FROM 'd106492c55706db94fbc8daa44514d8b' THEN
   RAISE EXCEPTION 'v398 rollback: workflow changed; review live definition'; END IF;
END $guard$;
UPDATE public.auto_accounts SET facebook_web_enrichment_enabled=false,
 facebook_web_enrichment_config=CASE WHEN facebook_web_enrichment_config IS NULL THEN NULL ELSE
   jsonb_set(facebook_web_enrichment_config,'{revision}',to_jsonb(coalesce((facebook_web_enrichment_config->>'revision')::bigint,0)+1)) END,
 updated_at=clock_timestamp() WHERE facebook_web_enrichment_enabled;
ROLLBACK;
