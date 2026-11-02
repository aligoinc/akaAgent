-- Manual rollback only if separately requested; fails on later edits.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE current_row jsonb;
BEGIN
 SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=1489 FOR UPDATE;
 IF current_row IS NULL OR md5(current_row::text) <> '917b771cb8f2ffa0cb747e4051b05a4a' THEN
   RAISE EXCEPTION 'Element 1489 drift: do not overwrite later edits';
 END IF;
 UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Bình luận' or .='Comment' or contains(@aria-label,'Comment'))]$xpath$,
 updated_at='2026-11-01T06:31:54.282234+00:00'::timestamptz WHERE id=1489;
 SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=1692 FOR UPDATE;
 IF current_row IS NULL OR md5(current_row::text) <> '990d2d77a1b18f1acc81c91a933dc5f9' THEN
   RAISE EXCEPTION 'Element 1692 drift: do not overwrite later edits';
 END IF;
 UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Bình luận' or contains(@aria-label,'Comment'))]$xpath$,
 updated_at='2026-11-01T06:31:54.283749+00:00'::timestamptz WHERE id=1692;
END $guard$;
COMMIT;
