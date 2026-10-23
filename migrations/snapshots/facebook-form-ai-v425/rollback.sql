-- Disable only this rollout; retain rows/log references. Wrap in a transaction.
DO $rollback$
BEGIN
  LOCK TABLE public.ai_form_configs IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT md5(to_jsonb(c)::text) FROM public.ai_form_configs c WHERE code='app_facebook_form_general') IS DISTINCT FROM 'efec185180ec5e50a8fd515841bb110e'
    OR (SELECT md5(to_jsonb(c)::text) FROM public.ai_form_configs c WHERE code='app_facebook_form_search') IS DISTINCT FROM 'a7697b507752abe3922f49ecd6fe8d2f'
    OR (SELECT md5(to_jsonb(c)::text) FROM public.ai_form_configs c WHERE code='app_facebook_form_keywords') IS DISTINCT FROM '3589337606a59059c223df258af256e1'
    OR (SELECT md5(to_jsonb(c)::text) FROM public.ai_form_configs c WHERE code='app_facebook_form_post_search') IS DISTINCT FROM 'cfa02a5f8b22aed40ce62a74978f66d1'
    OR (SELECT md5(to_jsonb(c)::text) FROM public.ai_form_configs c WHERE code='app_facebook_form_newsfeed') IS DISTINCT FROM 'e8f5332d01bbe3d09d40830e4cd46845'
    OR (SELECT md5(to_jsonb(c)::text) FROM public.ai_form_configs c WHERE code='app_facebook_form_group_comment') IS DISTINCT FROM '5be8ba543be6121731767a5f53e2a09e' THEN
    RAISE EXCEPTION 'Facebook AI configuration changed; inspect before rollback';
  END IF;
  UPDATE public.ai_form_configs SET is_active=false WHERE code IN ('app_facebook_form_general','app_facebook_form_search','app_facebook_form_keywords','app_facebook_form_post_search','app_facebook_form_newsfeed','app_facebook_form_group_comment');
END;
$rollback$;
