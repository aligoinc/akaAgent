-- Preserve source/post relationships as pairs for post-scoped scans.
-- This prevents a contact who liked one post and commented another from matching both combinations.

BEGIN;

UPDATE public.auto_blocks
SET
  code = replace(
    code,
$$sourcePostUrl,
        sourcePostUrls: sourcePostUrl ? [sourcePostUrl] : []$$,
$$sourcePostUrl,
        sourcePostUrls: sourcePostUrl ? [sourcePostUrl] : [],
        sourcePostRefs: sourcePostUrl ? [{ source: 'facebook_post_commenters', url: sourcePostUrl }] : []$$
  ),
  updated_at = now()
WHERE name = 'fb_scan_extract_post_commenters'
  AND position('sourcePostRefs' in code) = 0;

UPDATE public.auto_blocks
SET
  code = replace(
    code,
$$sourcePostUrl: sourcePostUrl,
        sourcePostUrls: sourcePostUrl ? [sourcePostUrl] : []$$,
$$sourcePostUrl: sourcePostUrl,
        sourcePostUrls: sourcePostUrl ? [sourcePostUrl] : [],
        sourcePostRefs: sourcePostUrl ? [{ source: 'facebook_post_likes', url: sourcePostUrl }] : []$$
  ),
  updated_at = now()
WHERE name = 'fb_scan_extract_post_likes'
  AND position('sourcePostRefs' in code) = 0;

NOTIFY pgrst, 'reload schema';

COMMIT;
