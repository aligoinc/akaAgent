-- Manual rollback only if separately requested; refuses any subsequent edit.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE current_row jsonb;
BEGIN
 SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=13 FOR UPDATE;
 IF current_row IS NULL OR md5(current_row::text) <> 'e0ad79c693e48f62be7ab0e79af2352a' THEN
   RAISE EXCEPTION 'Element 13 drift: do not overwrite later edits';
 END IF;
 UPDATE public.auto_elements SET
   xpath=$xpath$(//div[@aria-label='Viết bình luận...' or @aria-label='Write a comment...' or @aria-label='Write a comment' or @aria-label='Viết bình luận' or contains(@aria-label,'Comment')]|//*[@role='button' and .='Bình luận'])[${n}]$xpath$,
   updated_at='2026-11-01T06:14:37.409568+00:00'::timestamptz
 WHERE id=13;
END $guard$;
COMMIT;
