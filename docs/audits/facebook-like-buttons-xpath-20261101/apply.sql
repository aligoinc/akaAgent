BEGIN;
-- User-approved data edit: add the supplied Like aria-label condition only.
DO $guard$
DECLARE before_row jsonb; after_row jsonb;
BEGIN

  SELECT to_jsonb(e) INTO before_row FROM public.auto_elements e WHERE id=1132 FOR UPDATE;
  IF before_row IS NULL OR before_row->>'name' <> 'fb_like_button' OR md5(before_row::text) <> 'abde47e52e8a594f9df5cdb68d98b1f4' THEN
    RAISE EXCEPTION 'Element 1132 drift: compare live capture before editing';
  END IF;
  UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (@aria-label='Thích' or @aria-label='Like' or contains(@aria-label,'Bày tỏ cảm xúc Thích'))]$xpath$, updated_at=clock_timestamp()
    WHERE id=1132 AND name='fb_like_button';
  SELECT to_jsonb(e) INTO after_row FROM public.auto_elements e WHERE id=1132;
  IF after_row->>'xpath' IS DISTINCT FROM $xpath$.//*[@role='button' and (@aria-label='Thích' or @aria-label='Like' or contains(@aria-label,'Bày tỏ cảm xúc Thích'))]$xpath$
    OR (after_row-'xpath'-'updated_at') IS DISTINCT FROM (before_row-'xpath'-'updated_at') THEN
    RAISE EXCEPTION 'Element 1132 postcheck failed';
  END IF;

  SELECT to_jsonb(e) INTO before_row FROM public.auto_elements e WHERE id=1691 FOR UPDATE;
  IF before_row IS NULL OR before_row->>'name' <> 'fb_newsfeed_like_button' OR md5(before_row::text) <> '3f136fa78a2aa28aef2b5b9f5a27ee40' THEN
    RAISE EXCEPTION 'Element 1691 drift: compare live capture before editing';
  END IF;
  UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Thích' or contains(@aria-label,'Bày tỏ cảm xúc Thích'))]$xpath$, updated_at=clock_timestamp()
    WHERE id=1691 AND name='fb_newsfeed_like_button';
  SELECT to_jsonb(e) INTO after_row FROM public.auto_elements e WHERE id=1691;
  IF after_row->>'xpath' IS DISTINCT FROM $xpath$.//*[@role='button' and (.='Thích' or contains(@aria-label,'Bày tỏ cảm xúc Thích'))]$xpath$
    OR (after_row-'xpath'-'updated_at') IS DISTINCT FROM (before_row-'xpath'-'updated_at') THEN
    RAISE EXCEPTION 'Element 1691 postcheck failed';
  END IF;
END
$guard$;
COMMIT;
