-- User-authorized data edit: add Vietnamese comment label only.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE before_row jsonb; after_row jsonb;
BEGIN

 SELECT to_jsonb(e) INTO before_row FROM public.auto_elements e WHERE id=1489 FOR UPDATE;
 IF before_row IS NULL OR before_row->>'name' <> 'fb_comment_in_post_btn' OR md5(before_row::text) <> 'e5f78ae7d73347bb18ac6fb17c62eff9' THEN
   RAISE EXCEPTION 'Element 1489 drift: compare live capture before editing';
 END IF;
 UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Bình luận' or .='Comment' or contains(@aria-label,'Comment') or contains(@aria-label,'Bình luận về'))]$xpath$,updated_at=clock_timestamp()
 WHERE id=1489 AND name='fb_comment_in_post_btn';
 SELECT to_jsonb(e) INTO after_row FROM public.auto_elements e WHERE id=1489;
 IF after_row->>'xpath' IS DISTINCT FROM $xpath$.//*[@role='button' and (.='Bình luận' or .='Comment' or contains(@aria-label,'Comment') or contains(@aria-label,'Bình luận về'))]$xpath$
   OR (after_row-'xpath'-'updated_at') IS DISTINCT FROM (before_row-'xpath'-'updated_at') THEN
   RAISE EXCEPTION 'Element 1489 postcheck failed';
 END IF;

 SELECT to_jsonb(e) INTO before_row FROM public.auto_elements e WHERE id=1692 FOR UPDATE;
 IF before_row IS NULL OR before_row->>'name' <> 'fb_newsfeed_comment_button' OR md5(before_row::text) <> '3e51b1001b3e04b0ae1483c826abfeeb' THEN
   RAISE EXCEPTION 'Element 1692 drift: compare live capture before editing';
 END IF;
 UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Bình luận' or contains(@aria-label,'Comment') or contains(@aria-label,'Bình luận về'))]$xpath$,updated_at=clock_timestamp()
 WHERE id=1692 AND name='fb_newsfeed_comment_button';
 SELECT to_jsonb(e) INTO after_row FROM public.auto_elements e WHERE id=1692;
 IF after_row->>'xpath' IS DISTINCT FROM $xpath$.//*[@role='button' and (.='Bình luận' or contains(@aria-label,'Comment') or contains(@aria-label,'Bình luận về'))]$xpath$
   OR (after_row-'xpath'-'updated_at') IS DISTINCT FROM (before_row-'xpath'-'updated_at') THEN
   RAISE EXCEPTION 'Element 1692 postcheck failed';
 END IF;
END $guard$;
SELECT to_jsonb(e) AS row,md5(to_jsonb(e)::text) AS row_md5 FROM public.auto_elements e WHERE id IN (1489,1692) ORDER BY id;
COMMIT;
