BEGIN;
-- Manual rollback only. Refuse to overwrite any later row change.
DO $guard$
DECLARE current_row jsonb; restored_row jsonb;
BEGIN
  SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=1132 FOR UPDATE;
  IF current_row IS NULL OR md5(current_row::text) <> '57df25510f7354602a6f4788e8563b9b' THEN
    RAISE EXCEPTION 'Element 1132 drift: do not roll back a later update';
  END IF;
  UPDATE public.auto_elements
    SET xpath=$xpath$.//*[@role='button' and (@aria-label='Thích' or @aria-label='Like')]$xpath$, updated_at='2026-10-20T08:08:58.949167+00:00'::timestamptz
    WHERE id=1132 AND name='fb_like_button';
  SELECT to_jsonb(e) INTO restored_row FROM public.auto_elements e WHERE id=1132;
  IF md5(restored_row::text) <> 'abde47e52e8a594f9df5cdb68d98b1f4' THEN
    RAISE EXCEPTION 'Element 1132 rollback postcheck failed';
  END IF;
  SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id=1691 FOR UPDATE;
  IF current_row IS NULL OR md5(current_row::text) <> '4fa6a9c694c25517ba13a3cd359562f3' THEN
    RAISE EXCEPTION 'Element 1691 drift: do not roll back a later update';
  END IF;
  UPDATE public.auto_elements
    SET xpath=$xpath$.//*[@role='button' and .='Thích']$xpath$, updated_at='2026-05-29T08:38:42.804159+00:00'::timestamptz
    WHERE id=1691 AND name='fb_newsfeed_like_button';
  SELECT to_jsonb(e) INTO restored_row FROM public.auto_elements e WHERE id=1691;
  IF md5(restored_row::text) <> '3f136fa78a2aa28aef2b5b9f5a27ee40' THEN
    RAISE EXCEPTION 'Element 1691 rollback postcheck failed';
  END IF;
END
$guard$;
COMMIT;
