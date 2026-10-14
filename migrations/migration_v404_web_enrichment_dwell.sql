-- Data-only change to the existing browser block. No RPC/schema/reload.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $preflight$
DECLARE
  source_code text;
BEGIN
  SELECT code INTO STRICT source_code FROM public.auto_blocks
    WHERE name='fb_web_enrichment_browse' FOR UPDATE;
  IF md5(source_code) IS DISTINCT FROM 'd106492c55706db94fbc8daa44514d8b' THEN
    RAISE EXCEPTION 'V404 source block changed; inspect live code before applying';
  END IF;
END $preflight$;

UPDATE public.auto_blocks
SET code=replace(replace(code,
      $google_before$read(random(30000,60000))$google_before$,
      $google_after$read(random(10000,30000))$google_after$),
      $page_before$read(random(180000,300000))$page_before$,
      $page_after$read(random(60000,180000))$page_after$),
    updated_at=now()
WHERE name='fb_web_enrichment_browse';

DO $verify$
BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name='fb_web_enrichment_browse')
    IS DISTINCT FROM '8d1223574f8fc342317da3ce63db240b' THEN
    RAISE EXCEPTION 'V404 result checksum mismatch';
  END IF;
END $verify$;
COMMIT;
