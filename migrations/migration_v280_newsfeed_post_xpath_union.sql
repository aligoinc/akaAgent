-- v280: Add the user-verified feed article XPath to fb_newsfeed_post.
-- Source: live auto_elements row 1687 on cgjbsmqtfhqvttudyjzq, captured 2026-09-14.
-- Preserve the requested plain union exactly; change only xpath and updated_at.
-- Data-only: no schema/RPC/block/workflow changes or PostgREST reload.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $newsfeed_xpath_union$
DECLARE
  v_row jsonb;
  v_xpath constant text := $post_xpath$//*[@class='x1lliihq']//*[@class='x1lliihq']
|
//*[@role='feed']//*[@role='article']$post_xpath$;
BEGIN
  SELECT to_jsonb(e) INTO v_row FROM public.auto_elements e
  WHERE id = 1687 AND name = 'fb_newsfeed_post' FOR UPDATE;

  IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM '63d4e6be1b2dd0dd42e4ab5dc86b28d5' THEN
    RAISE EXCEPTION 'v280 live fb_newsfeed_post changed; recapture before applying';
  END IF;

  UPDATE public.auto_elements SET xpath = v_xpath, updated_at = now()
  WHERE id = 1687 AND name = 'fb_newsfeed_post';

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements e
    WHERE id = 1687 AND xpath = v_xpath
      AND (to_jsonb(e) - 'xpath' - 'updated_at') = (v_row - 'xpath' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'v280 fb_newsfeed_post postflight failed';
  END IF;
END;
$newsfeed_xpath_union$;
COMMIT;
