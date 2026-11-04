BEGIN;
-- User-approved data edit only; exact supplied XPath, no parent/root change.
DO $guard$
DECLARE before_row jsonb; after_row jsonb;
BEGIN

  SELECT to_jsonb(e) INTO before_row FROM public.auto_elements e WHERE id=1489 FOR UPDATE;
  IF before_row IS NULL OR before_row->>'name' <> 'fb_comment_in_post_btn' OR md5(before_row::text) <> '985e63ddbe2ce722a9ae564794c56d54' THEN
    RAISE EXCEPTION 'Element 1489 drift: compare live capture before editing';
  END IF;
  UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Bình luận' or .='Comment' or contains(@aria-label,'Comment'))]$xpath$, updated_at=clock_timestamp()
    WHERE id=1489 AND name='fb_comment_in_post_btn';
  SELECT to_jsonb(e) INTO after_row FROM public.auto_elements e WHERE id=1489;
  IF after_row->>'xpath' IS DISTINCT FROM $xpath$.//*[@role='button' and (.='Bình luận' or .='Comment' or contains(@aria-label,'Comment'))]$xpath$
    OR (after_row-'xpath'-'updated_at') IS DISTINCT FROM (before_row-'xpath'-'updated_at') THEN
    RAISE EXCEPTION 'Element 1489 postcheck failed';
  END IF;

  SELECT to_jsonb(e) INTO before_row FROM public.auto_elements e WHERE id=1692 FOR UPDATE;
  IF before_row IS NULL OR before_row->>'name' <> 'fb_newsfeed_comment_button' OR md5(before_row::text) <> '4925eda928f4bf75b960d91f95da2d45' THEN
    RAISE EXCEPTION 'Element 1692 drift: compare live capture before editing';
  END IF;
  UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Bình luận' or contains(@aria-label,'Comment'))]$xpath$, updated_at=clock_timestamp()
    WHERE id=1692 AND name='fb_newsfeed_comment_button';
  SELECT to_jsonb(e) INTO after_row FROM public.auto_elements e WHERE id=1692;
  IF after_row->>'xpath' IS DISTINCT FROM $xpath$.//*[@role='button' and (.='Bình luận' or contains(@aria-label,'Comment'))]$xpath$
    OR (after_row-'xpath'-'updated_at') IS DISTINCT FROM (before_row-'xpath'-'updated_at') THEN
    RAISE EXCEPTION 'Element 1692 postcheck failed';
  END IF;
END
$guard$;
COMMIT;
