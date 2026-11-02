BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE before_row jsonb; after_row jsonb;
BEGIN
 SELECT to_jsonb(e) INTO before_row FROM public.auto_elements e WHERE id=13 FOR UPDATE;
 IF before_row IS NULL OR before_row->>'name' <> 'fb_comment_box_at_n'
   OR md5(before_row::text) <> '4259e1d74de0db2871762fb4833cae28' THEN
   RAISE EXCEPTION 'Element 13 drift: compare live capture before editing';
 END IF;
 UPDATE public.auto_elements
 SET xpath=$xpath$(//div[@aria-label='Viết bình luận...' or @aria-label='Write a comment...' or @aria-label='Write a comment' or @aria-label='Viết bình luận' or contains(@aria-label,'Comment') or contains(@aria-label,'Bình luận về')]|//*[@role='button' and .='Bình luận'])[${n}]$xpath$, updated_at=clock_timestamp()
 WHERE id=13 AND name='fb_comment_box_at_n';
 SELECT to_jsonb(e) INTO after_row FROM public.auto_elements e WHERE id=13;
 IF after_row->>'xpath' IS DISTINCT FROM $xpath$(//div[@aria-label='Viết bình luận...' or @aria-label='Write a comment...' or @aria-label='Write a comment' or @aria-label='Viết bình luận' or contains(@aria-label,'Comment') or contains(@aria-label,'Bình luận về')]|//*[@role='button' and .='Bình luận'])[${n}]$xpath$
   OR (after_row-'xpath'-'updated_at') IS DISTINCT FROM (before_row-'xpath'-'updated_at') THEN
   RAISE EXCEPTION 'Element 13 postcheck failed';
 END IF;
END $guard$;
SELECT to_jsonb(e) AS row, md5(to_jsonb(e)::text) AS row_md5 FROM public.auto_elements e WHERE id=13;
COMMIT;
