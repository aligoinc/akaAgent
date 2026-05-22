-- Normalize existing find-data campaigns that use "Những người tương tác mới".
-- Runtime reads sortTypePost/sortTypeComment from campaign extra_settings as the source of truth.

BEGIN;

UPDATE public.auto_campaigns
SET
  extra_settings = jsonb_set(
    jsonb_set(
      COALESCE(extra_settings, '{}'::jsonb),
      '{sortTypePost}',
      '"recent_activity"'::jsonb,
      true
    ),
    '{sortTypeComment}',
    '"newest"'::jsonb,
    true
  )
WHERE action_id = 'facebook_find_data_group'
  AND COALESCE(extra_settings->>'isFindNewInteractors', 'false') = 'true'
  AND (
    extra_settings->>'sortTypePost' IS DISTINCT FROM 'recent_activity'
    OR extra_settings->>'sortTypeComment' IS DISTINCT FROM 'newest'
  );

COMMIT;
