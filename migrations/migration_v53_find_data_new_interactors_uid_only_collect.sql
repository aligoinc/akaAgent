-- Keep the existing post/comment collector for full data sources, but use a
-- lighter UID-only post scan when "Những người tương tác mới" is the only
-- source that needs post authors. This avoids running post-content/link
-- extraction work for a source that only needs UID user Facebook.

BEGIN;

UPDATE public.auto_blocks
SET
  code = $block$
const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true || vars.isFindNewInteractors === true;
if (!needsFeed) {
  vars.findDataPosts = [];
  return { posts: [], skippedFeed: true };
}

const limit = Math.max(1, Number(vars.countPostFindData || input.countPostFindData || 10));
const collectPostDetails = vars.isFindInPost === true || vars.isFindPostLink === true;
const useUidOnlyPostScan = vars.isFindNewInteractors === true && collectPostDetails !== true;

if (useUidOnlyPostScan) {
  const selectors = {
    posts: await helpers.element('fb_post_in_uid'),
    uidInPost: await helpers.element('fb_uid_in_post_in_uid')
  };

  const posts = await page.evaluate(`
    const selectors = __args[0];
    const limit = __args[1];

    function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function xpathAll(xpath, root) {
      const out = [];
      if (!xpath) return out;
      try {
        const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
      } catch {}
      return out.filter(Boolean);
    }

    function hrefOf(el) {
      return el ? (el.href || el.getAttribute('href') || '') : '';
    }

    function extractUid(href) {
      if (!href) return '';
      try {
        const url = new URL(href, location.href);
        const id = url.searchParams.get('id');
        if (id) return id;
        const parts = url.pathname.split('/').filter(Boolean);
        const userIndex = parts.indexOf('user');
        if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
        return parts[parts.length - 1] || '';
      } catch {
        return String(href || '').trim();
      }
    }

    let postElements = xpathAll(selectors.posts);
    const startedAt = Date.now();
    let stableCount = 0;
    while (postElements.length < limit && Date.now() - startedAt < 90 * 1000 && stableCount < 2) {
      const oldCount = postElements.length;
      if (postElements.length > 0) {
        try { postElements[postElements.length - 1].scrollIntoView(true); } catch {}
      } else {
        window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
      }
      await delay(2000);
      postElements = xpathAll(selectors.posts);
      stableCount = postElements.length <= oldCount ? stableCount + 1 : 0;
    }

    return postElements.slice(0, limit).map((post, i) => {
      const authorLink = xpathAll(selectors.uidInPost, post)[0];
      const authorUrl = hrefOf(authorLink);
      return {
        index: i + 1,
        content: '',
        authorUrl,
        authorUid: extractUid(authorUrl),
        rawPostLink: '',
        postLink: ''
      };
    });
  `, selectors, limit);

  vars.findDataPosts = Array.isArray(posts) ? posts : [];
  helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
  return { posts: vars.findDataPosts };
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),
  uidInPost: await helpers.element('fb_uid_in_post_in_uid'),
  content: await helpers.element('fb_content_in_post_in_uid'),
  rawPostLink: await helpers.element('RawPostLinkInUid'),
  postLink: await helpers.element('PostLinkInUid')
};
const collectPostLinks = vars.isFindPostLink === true || input.isFindPostLink === true;

const posts = await page.evaluate(`
  const selectors = __args[0];
  const limit = __args[1];
  const collectPostLinks = __args[2] === true;

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    const context = root || document;
    try {
      const result = document.evaluate(xpath, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    const filtered = out.filter(Boolean);
    if (root && root !== document && root.nodeType === 1) {
      return filtered.filter(el => el === root || (root.contains && root.contains(el)));
    }
    return filtered;
  }

  function clickSynthetic(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  function simulateFocusin(element) {
    if (!element) return;
    try {
      let event = new FocusEvent("focusin", {
        view: window,
        bubbles: true,
        cancelable: true,
      });

      element.dispatchEvent(event);
    } catch {
      try { element.dispatchEvent(new Event('focusin', { bubbles: true, cancelable: true })); } catch {}
    }
  }

  function hrefOf(el) {
    return el ? (el.href || el.getAttribute('href') || '') : '';
  }

  function cleanPostHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      if (/^(m|mbasic|mobile)\.facebook\.com$/i.test(url.hostname)) {
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

  function isCommentPermalink(href) {
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

  async function resolvePostLink(post) {
    let rawPostLink = '';
    let postLink = firstPostLink(post);
    if (postLink) return { rawPostLink, postLink };

    const rawLinks = xpathAll(selectors.rawPostLink, post)
      .filter(el => !isCommentPermalink(normalizeHref(hrefOf(el))))
      .slice(0, 5);
    for (const rawLinkEl of rawLinks) {
      rawPostLink = rawPostLink || cleanPostHref(hrefOf(rawLinkEl));
      try { rawLinkEl.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
      simulateFocusin(rawLinkEl);
      await delay(500);
      postLink = firstPostLink(post);
      if (postLink) break;
    }

    return { rawPostLink, postLink };
  }

  function extractUid(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id');
      if (id) return id;
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      return parts[parts.length - 1] || '';
    } catch {
      return String(href || '').trim();
    }
  }

  let postElements = xpathAll(selectors.posts);
  const startedAt = Date.now();
  let stableCount = 0;
  while (postElements.length < limit && Date.now() - startedAt < 5 * 60 * 1000 && stableCount < 2) {
    const oldCount = postElements.length;
    if (postElements.length > 0) {
      postElements[postElements.length - 1].scrollIntoView(true);
    }
    await delay(2500);
    postElements = xpathAll(selectors.posts);
    stableCount = postElements.length <= oldCount ? stableCount + 1 : 0;
  }

  const rows = [];
  const selected = postElements.slice(0, limit);
  for (let i = 0; i < selected.length; i++) {
    const post = selected[i];
    try {
      const seeMoreButtons = xpathAll(selectors.seeMore, post).filter(isVisible).slice(0, 5);
      for (const btn of seeMoreButtons) {
        clickSynthetic(btn);
        await delay(300);
      }
    } catch {}

    const contentParts = xpathAll(selectors.content, post)
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    const content = Array.from(new Set(contentParts)).join('\\n').trim() || (post.innerText || post.textContent || '').trim();
    const authorLink = xpathAll(selectors.uidInPost, post)[0];
    const authorUrl = authorLink ? (authorLink.href || authorLink.getAttribute('href') || '') : '';
    const linkInfo = collectPostLinks ? await resolvePostLink(post) : { rawPostLink: '', postLink: '' };
    rows.push({
      index: i + 1,
      content,
      authorUrl,
      authorUid: extractUid(authorUrl),
      rawPostLink: linkInfo.rawPostLink || '',
      postLink: linkInfo.postLink || ''
    });
  }

  return rows;
`, selectors, limit, collectPostLinks);

vars.findDataPosts = Array.isArray(posts) ? posts : [];
helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
return { posts: vars.findDataPosts };
$block$,
  updated_at = now()
WHERE name = 'fb_collect_group_posts';

COMMIT;
