-- Fix newsfeed interaction data flow after if/merge nodes.
-- The workflow engine passes branch metadata through merge nodes, so later
-- action blocks must use persisted newsfeed state for the current post.

BEGIN;

UPDATE public.auto_blocks
SET code = replace(
  code,
  $$if (input.shouldLike !== true || state.remainingLike <= 0) return { liked: false }$$,
  $$const shouldRunLike = input.shouldLike === true || input.conditionResult === true || input.branch === 'true'
if (shouldRunLike !== true || state.remainingLike <= 0) return { liked: false }$$
),
updated_at = now()
WHERE name = 'fb_newsfeed_like_post';

UPDATE public.auto_blocks
SET code = replace(
  code,
  $$if (input.hasPost !== true || input.readablePost !== true || state.remainingComment <= 0) return { shouldComment: false }$$,
  $$if (!post || post.readablePost !== true || state.remainingComment <= 0) return { shouldComment: false }$$
),
updated_at = now()
WHERE name = 'fb_newsfeed_check_comment';

UPDATE public.auto_blocks
SET code = replace(
  code,
  $$if (input.shouldComment !== true || state.remainingComment <= 0) return { opened: false }$$,
  $$const shouldRunComment = input.shouldComment === true || input.conditionResult === true || input.branch === 'true'
if (shouldRunComment !== true || state.remainingComment <= 0) return { opened: false }$$
),
updated_at = now()
WHERE name = 'fb_newsfeed_comment_open';

COMMIT;
