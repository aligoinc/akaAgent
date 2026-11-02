-- Manual rollback only if separately requested; refuses later edits.
BEGIN;
DO $guard$
DECLARE current_row jsonb;
BEGIN
  SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=13 FOR UPDATE;
  IF current_row IS NULL OR md5(current_row::text) <> '4259e1d74de0db2871762fb4833cae28' THEN
    RAISE EXCEPTION 'Element 13 drift: do not overwrite a later edit';
  END IF;
  UPDATE public.auto_elements SET xpath=$xpath$(//div[@aria-label='Viết bình luận...' or @aria-label='Write a comment...' or @aria-label='Write a comment' or @aria-label='Viết bình luận']|//*[@role='button' and .='Bình luận'])[${n}]$xpath$,
    updated_at='2026-05-15T18:35:35.525+00:00'::timestamptz WHERE id=13;
END
$guard$;
COMMIT;
