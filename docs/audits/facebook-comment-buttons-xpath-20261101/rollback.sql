-- Manual rollback only when requested; rejects later edits.
BEGIN;
DO $guard$
DECLARE current_row jsonb;
BEGIN
  SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=1489 FOR UPDATE;
  IF current_row IS NULL OR md5(current_row::text) <> 'e5f78ae7d73347bb18ac6fb17c62eff9' THEN
    RAISE EXCEPTION 'Element 1489 drift: do not overwrite later edits';
  END IF;
  UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and (.='Bình luận' or .='Comment')]$xpath$,
    updated_at='2026-05-06T10:39:48.503+00:00'::timestamptz WHERE id=1489;
  SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=1692 FOR UPDATE;
  IF current_row IS NULL OR md5(current_row::text) <> '3e51b1001b3e04b0ae1483c826abfeeb' THEN
    RAISE EXCEPTION 'Element 1692 drift: do not overwrite later edits';
  END IF;
  UPDATE public.auto_elements SET xpath=$xpath$.//*[@role='button' and .='Bình luận']$xpath$,
    updated_at='2026-05-28T16:28:42.550407+00:00'::timestamptz WHERE id=1692;
END
$guard$;
COMMIT;
