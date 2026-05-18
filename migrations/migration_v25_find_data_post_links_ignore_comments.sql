-- Fix find-data post-link extraction so comment permalinks are not pushed to
-- facebook_comment_seeding_post input data.

BEGIN;

UPDATE public.auto_elements
SET
  xpath = '//a[(contains(@href, ''/posts/'') or contains(@href, ''story_fbid='')) and not(contains(@href, ''comment_id='')) and not(contains(@href, ''reply_comment_id=''))]',
  updated_at = now()
WHERE name = 'PostLinkInUid';

UPDATE public.auto_blocks
SET code = replace(
  replace(
    code,
$$  function firstPostLink(post) {
    const links = xpathAll(selectors.postLink, post)
      .map(el => normalizeHref(hrefOf(el)))
      .filter(Boolean)
      .filter(href => href.includes('/posts/') || href.includes('story_fbid='));
    return links[0] || '';
  }
$$,
$$  function isCommentPermalink(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.href);
      if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return true;
      const rawQuery = String(url.search || '').toLowerCase();
      return rawQuery.includes('comment_id=') || rawQuery.includes('reply_comment_id=');
    } catch {
      const raw = String(href || '').toLowerCase();
      return raw.includes('comment_id=') || raw.includes('reply_comment_id=');
    }
  }

  function isPostPermalink(href) {
    if (!href || isCommentPermalink(href)) return false;
    return href.includes('/posts/') || href.includes('story_fbid=');
  }

  function firstPostLink(post) {
    const links = xpathAll(selectors.postLink, post)
      .map(el => normalizeHref(hrefOf(el)))
      .filter(Boolean)
      .filter(isPostPermalink);
    return links[0] || '';
  }
$$
  ),
$$    const rawLinks = xpathAll(selectors.rawPostLink, post).slice(0, 5);
$$,
$$    const rawLinks = xpathAll(selectors.rawPostLink, post)
      .filter(el => !isCommentPermalink(normalizeHref(hrefOf(el))))
      .slice(0, 5);
$$
),
updated_at = now()
WHERE name = 'fb_collect_group_posts'
  AND code NOT LIKE '%function isCommentPermalink%';

COMMIT;
