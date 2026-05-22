-- Guard UID extraction for post/comment authors so permalink/post IDs are not
-- counted as Facebook user UIDs when collecting new interactors.

BEGIN;

UPDATE public.auto_blocks
SET code = replace(
  code,
$$function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}
$$,
$$function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const uid = String(item && item.authorUid ? item.authorUid : '').trim();
  if (!/^\d{5,}$/.test(uid)) return '';
  const href = String(item && item.authorUrl ? item.authorUrl : '').toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=')
  ) {
    return '';
  }
  return uid;
}
$$
),
updated_at = now()
WHERE name IN ('fb_extract_data_from_group_posts', 'fb_extract_data_from_group_comments')
  AND code NOT LIKE '%function authorUidFromItem%';

UPDATE public.auto_blocks
SET code = replace(
  replace(
    code,
$$      if (vars.isFindInPost && vars.isFindUid && post && post.authorUid) {
        results.uids.push(String(post.authorUid));
        sourcePost.uids.push(String(post.authorUid));
      }
$$,
$$      const authorUid = authorUidFromItem(post);
      if (vars.isFindInPost && vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourcePost.uids.push(authorUid);
      }
$$
  ),
$$    if (vars.isFindNewInteractors && vars.isFindUid && post && post.authorUid) {
      results.uids.push(String(post.authorUid));
      sourceNewInteractors.uids.push(String(post.authorUid));
    }
$$,
$$    const newInteractorUid = authorUidFromItem(post);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
$$
),
updated_at = now()
WHERE name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks
SET code = replace(
  replace(
    code,
$$      if (vars.isFindUid && comment && comment.authorUid) {
        results.uids.push(String(comment.authorUid));
        sourceComment.uids.push(String(comment.authorUid));
      }
$$,
$$      const authorUid = authorUidFromItem(comment);
      if (vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourceComment.uids.push(authorUid);
      }
$$
  ),
$$    if (vars.isFindNewInteractors && vars.isFindUid && comment && comment.authorUid) {
      results.uids.push(String(comment.authorUid));
      sourceNewInteractors.uids.push(String(comment.authorUid));
    }
$$,
$$    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
$$
),
updated_at = now()
WHERE name = 'fb_extract_data_from_group_comments';

COMMIT;
