-- Clean Facebook tracking parameters from find-data post links before returning
-- them to scheduler/detail logs.

BEGIN;

UPDATE public.auto_blocks
SET code = replace(
  replace(
    code,
$$  function normalizeHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      return url.href;
    } catch {
      return String(href || '').trim();
    }
  }
$$,
$$  function cleanPostHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      if (/^(m|mbasic|mobile)\\.facebook\\.com$/i.test(url.hostname)) {
        url.hostname = 'www.facebook.com';
      }
      url.hash = '';
      Array.from(url.searchParams.keys()).forEach(key => {
        if (
          key.startsWith('__') ||
          key === 'mibextid' ||
          key === 'ref' ||
          key === 'locale' ||
          key === 'comment_id' ||
          key === 'reply_comment_id'
        ) {
          url.searchParams.delete(key);
        }
      });
      return url.href;
    } catch {
      return String(href || '').trim();
    }
  }

  function normalizeHref(href) {
    return cleanPostHref(href);
  }
$$
  ),
$$      rawPostLink = rawPostLink || normalizeHref(hrefOf(rawLinkEl));
$$,
$$      rawPostLink = rawPostLink || cleanPostHref(hrefOf(rawLinkEl));
$$
),
updated_at = now()
WHERE name = 'fb_collect_group_posts'
  AND code NOT LIKE '%function cleanPostHref%';

COMMIT;
