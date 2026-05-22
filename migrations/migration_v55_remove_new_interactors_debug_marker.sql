-- Remove the temporary UID-only scan marker from find-data workflow output.
-- The branch remains UID-only; it just no longer writes debug metadata to
-- auto_run_steps.output.

BEGIN;

UPDATE public.auto_blocks
SET
  code = replace(
    code,
    'return { posts: vars.findDataPosts, uidOnlyPostScan: true };',
    'return { posts: vars.findDataPosts };'
  ),
  updated_at = now()
WHERE name = 'fb_collect_group_posts'
  AND code LIKE '%uidOnlyPostScan: true%';

COMMIT;
