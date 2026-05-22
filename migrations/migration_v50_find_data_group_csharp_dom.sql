-- Align direct DOM interactions in facebook_find_data_group with the verified C# flow.
-- Keep extraction, dedupe, source counts, logging, fan-out, timing, and stop policy unchanged.

BEGIN;

UPDATE public.auto_elements
SET
  xpath = CASE name
    WHEN 'fb_most_relevant_btn' THEN '//*[@role=''button'' and contains(.,''Phù hợp nhất'')]'
    WHEN 'fb_all_comments_btn' THEN '//*[@role=''menuitem'' and contains(.,''Tất cả bình luận'')]'
    WHEN 'fb_newest_comments_btn' THEN '//*[@role=''menuitem'' and contains(.,''Mới nhất'')]'
    WHEN 'fb_dialog' THEN '//*[@role=''dialog'' and not(@aria-label=''Thông báo'') and not(@aria-label=''Messenger'')]'
    WHEN 'fb_uid_in_cmt_element' THEN './/*[@class=''xjp7ctv'']//a[@role=''link'' and @tabindex=0]'
    WHEN 'fb_close_dialog_btn' THEN '//*[@role=''dialog'']//*[@role=''button'' and @aria-label=''Đóng'']|//*[@role=''button'' and .=''Dùng Trang'']'
    ELSE xpath
  END,
  updated_at = now()
WHERE name IN (
  'fb_most_relevant_btn',
  'fb_all_comments_btn',
  'fb_newest_comments_btn',
  'fb_dialog',
  'fb_uid_in_cmt_element',
  'fb_close_dialog_btn'
);

UPDATE public.auto_blocks
SET
  code = replace(code, E'\r\n', E'\n'),
  updated_at = now()
WHERE name IN (
  'fb_collect_group_posts',
  'fb_collect_group_comments',
  'fb_collect_group_members'
);

UPDATE public.auto_blocks
SET
  code = replace(
    replace(
      replace(
        code,
$$  let postElements = xpathAll(selectors.posts).filter(isVisible);
$$,
$$  let postElements = xpathAll(selectors.posts);
$$
      ),
$$    if (postElements.length > 0) {
      postElements[postElements.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
    } else {
      window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
    }
$$,
$$    if (postElements.length > 0) {
      postElements[postElements.length - 1].scrollIntoView(true);
    }
$$
    ),
$$    postElements = xpathAll(selectors.posts).filter(isVisible);
$$,
$$    postElements = xpathAll(selectors.posts);
$$
  ),
  updated_at = now()
WHERE name = 'fb_collect_group_posts';

UPDATE public.auto_blocks
SET
  code = replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              code,
$$  closeDialog: await helpers.element('fb_close_dialog_btn'),
  seeMoreComments: await helpers.element('fb_see_more_comments_btn')
$$,
$$  closeDialog: await helpers.element('fb_close_dialog_btn')
$$
            ),
$$  const posts = xpathAll(selectors.posts).filter(isVisible).slice(0, postLimit);
$$,
$$  const posts = xpathAll(selectors.posts).slice(0, postLimit);
$$
          ),
$$      post.scrollIntoView({ block: 'center', inline: 'nearest' });
$$,
$$      post.scrollIntoView(true);
$$
        ),
$$      let comments = xpathAll(selectors.commentElement, root).filter(isVisible);
$$,
$$      let comments = xpathAll(selectors.commentElement, root);
$$
      ),
$$        const moreButton = first(selectors.seeMoreComments, root) || first(selectors.seeMoreComments, document);
        if (moreButton) clickSynthetic(moreButton);
        if (comments.length > 0) comments[comments.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
        else root.scrollBy ? root.scrollBy(0, 700) : window.scrollBy(0, 700);
$$,
$$        if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
$$
    ),
$$        comments = xpathAll(selectors.commentElement, root).filter(isVisible);
$$,
$$        comments = xpathAll(selectors.commentElement, root);
$$
  ),
  updated_at = now()
WHERE name = 'fb_collect_group_comments';

UPDATE public.auto_blocks
SET
  code = replace(
    replace(
      code,
$$  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractUserUid(href) {
$$,
$$  function extractUserUid(href) {
$$
    ),
$$  function isScrollable(el) {
    if (!el || el === document.body) return false;
    try {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY || style.overflow;
      if (!/(auto|scroll|overlay)/i.test(overflowY)) return false;
      return el.scrollHeight > el.clientHeight + 80;
    } catch {
      return false;
    }
  }

  function scrollContainers() {
    const seen = new Set();
    const out = [];
    function add(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      out.push(el);
    }
    add(document.scrollingElement || document.documentElement);
    const candidates = Array.from(document.querySelectorAll('main, div, section'))
      .filter(el => isVisible(el) && isScrollable(el))
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 8);
    candidates.forEach(add);
    return out;
  }

  function scrollForMore(links) {
    const amount = Math.max(900, Math.floor((window.innerHeight || 800) * 0.9));
    if (links.length > 0) {
      try { links[links.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' }); } catch {}
    }
    for (const container of scrollContainers()) {
      try { container.scrollTop = container.scrollTop + amount; } catch {}
    }
    window.scrollBy(0, amount);
  }
$$,
$$  function scrollForMore(links) {
    if (links.length > 0) {
      try { links[links.length - 1].scrollIntoView(true); } catch {}
    }
  }
$$
  ),
  updated_at = now()
WHERE name = 'fb_collect_group_members';

UPDATE public.auto_blocks
SET
  code = replace(
    code,
$$    scrollForMore(links);
    await delay(2000);
    links = collectVisibleMembers();
$$,
$$    if (links.length > 0) {
      scrollForMore(links);
      await delay(2000);
      try { window.scrollBy(0, 500); } catch {}
      await delay(2000);
    }
    links = collectVisibleMembers();
$$
  ),
  updated_at = now()
WHERE name = 'fb_collect_group_members';

NOTIFY pgrst, 'reload schema';

COMMIT;
