-- Disable six Facebook AI configs in the verified V428 state; preserve history/logs.
BEGIN;
DO $rollback$
BEGIN
  PERFORM 1 FROM public.ai_form_configs WHERE id IN (14,15,16,17,18,19) ORDER BY id FOR UPDATE;
  IF (SELECT md5((to_jsonb(c)-'updated_at')::text) FROM public.ai_form_configs c WHERE id=14) IS DISTINCT FROM '0fb5656a4b28aaba3eb1afcc992a84da' THEN
    RAISE EXCEPTION 'Facebook AI config 14 changed since V428';
  END IF;
  IF (SELECT md5((to_jsonb(c)-'updated_at')::text) FROM public.ai_form_configs c WHERE id=15) IS DISTINCT FROM '5c57b8619155251fca865f96297da9f7' THEN
    RAISE EXCEPTION 'Facebook AI config 15 changed since V428';
  END IF;
  IF (SELECT md5((to_jsonb(c)-'updated_at')::text) FROM public.ai_form_configs c WHERE id=16) IS DISTINCT FROM '9f417a19fb8be69c8411c5779f453a1c' THEN
    RAISE EXCEPTION 'Facebook AI config 16 changed since V428';
  END IF;
  IF (SELECT md5((to_jsonb(c)-'updated_at')::text) FROM public.ai_form_configs c WHERE id=17) IS DISTINCT FROM '29aa0c44171fbb915bce6bf440a74d22' THEN
    RAISE EXCEPTION 'Facebook AI config 17 changed since V428';
  END IF;
  IF (SELECT md5((to_jsonb(c)-'updated_at')::text) FROM public.ai_form_configs c WHERE id=18) IS DISTINCT FROM '04fe3eba0678a8aa68d795fa850974d6' THEN
    RAISE EXCEPTION 'Facebook AI config 18 changed since V428';
  END IF;
  IF (SELECT md5((to_jsonb(c)-'updated_at')::text) FROM public.ai_form_configs c WHERE id=19) IS DISTINCT FROM 'ff17014d87fbc61925209d2829042d69' THEN
    RAISE EXCEPTION 'Facebook AI config 19 changed since V428';
  END IF;
  UPDATE public.ai_form_configs SET is_active=false WHERE id IN (14,15,16,17,18,19);
END;
$rollback$;
COMMIT;
