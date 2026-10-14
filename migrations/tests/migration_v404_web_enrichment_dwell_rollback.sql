-- Rehearsal by default. Change the final ROLLBACK to COMMIT only for an intentional rollback.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $preflight$
DECLARE
  source_code text;
BEGIN
  SELECT code INTO STRICT source_code FROM public.auto_blocks
    WHERE name='fb_web_enrichment_browse' FOR UPDATE;
  IF md5(source_code) IS DISTINCT FROM '8d1223574f8fc342317da3ce63db240b' THEN
    RAISE EXCEPTION 'V404 rollback source changed; inspect live code';
  END IF;
END $preflight$;
UPDATE public.auto_blocks
SET code=replace(replace(code,
      'read(random(10000,30000))','read(random(30000,60000))'),
      'read(random(60000,180000))','read(random(180000,300000))'),
    updated_at=now()
WHERE name='fb_web_enrichment_browse';
DO $verify$
BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name='fb_web_enrichment_browse')
    IS DISTINCT FROM 'd106492c55706db94fbc8daa44514d8b' THEN
    RAISE EXCEPTION 'V404 rollback checksum mismatch';
  END IF;
END $verify$;
ROLLBACK;
