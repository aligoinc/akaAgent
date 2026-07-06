-- Add DataScan workflow for collecting commenters from a single Facebook post.
-- Results are saved by ContactLoader into auto_account_contacts as person rows.

BEGIN;

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_scan_select_all_comments',
  'Chuyển dialog bài post sang chế độ Tất cả bình luận trước khi lấy người comment.',
  'ListFilter',
  'facebook',
  'js',
  NULL,
$block$
const commentSortDelayMs = Math.max(0, Math.floor(Number(vars.commentSortDelayMs || input.commentSortDelayMs || 1500)) || 1500);
const commentSortAfterSelectDelayMs = Math.max(0, Math.floor(Number(vars.commentSortAfterSelectDelayMs || input.commentSortAfterSelectDelayMs || 3500)) || 3500);

let result;
try {
  result = await page.evaluate(`
  const commentSortDelayMs = Number(__args[0] || 1500);
  const commentSortAfterSelectDelayMs = Number(__args[1] || 3500);

  function xpathFirst(xpath, root) {
    try {
      return document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch {
      return null;
    }
  }

  function textOf(el) {
    return String((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView(true); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); return true; } catch {}
    return false;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  try {
    const sortButton = xpathFirst("//*[@role='button' and contains(.,'Phù hợp nhất')]");
    if (!sortButton) {
      return { selectedAll: false, skipped: true, reason: 'Không thấy nút Phù hợp nhất' };
    }

    if (!clickSynthetic(sortButton)) {
      return { selectedAll: false, skipped: true, reason: 'Không click được nút Phù hợp nhất' };
    }

    await delay(commentSortDelayMs);

    const allCommentsButton = xpathFirst("//*[@role='menuitem' and contains(.,'Tất cả bình luận')]");
    if (!allCommentsButton) {
      return { selectedAll: false, skipped: true, reason: 'Không thấy nút Tất cả bình luận' };
    }

    if (!clickSynthetic(allCommentsButton)) {
      return { selectedAll: false, skipped: true, reason: 'Không click được nút Tất cả bình luận' };
    }

    await delay(commentSortAfterSelectDelayMs);
    return { selectedAll: true, label: textOf(allCommentsButton) };
  } catch (err) {
    return { selectedAll: false, skipped: true, reason: err && err.message ? err.message : String(err) };
  }
`, commentSortDelayMs, commentSortAfterSelectDelayMs);
} catch (err) {
  result = { selectedAll: false, skipped: true, reason: err && err.message ? err.message : String(err) };
}

helpers.log(result && result.skipped
  ? 'Không chuyển được sang Tất cả bình luận, tiếp tục với trạng thái hiện tại: ' + (result.reason || 'không rõ lý do')
  : 'Đã chuyển sang Tất cả bình luận');

return result;
$block$,
  '[]'::jsonb,
  '[{"name":"selectedAll","type":"boolean","label":"Selected all comments"},{"name":"reason","type":"string","label":"Reason"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_scan_scroll_post_comments',
  'Tải thêm comment trong dialog bài post bằng cách scroll comment cuối và chờ Facebook lazy-load thêm.',
  'ListEnd',
  'facebook',
  'js',
  NULL,
$block$
const limit = Math.max(1, Math.floor(Number(vars.maxCommenters || input.maxCommenters || 100)) || 100);
const delayMs = Math.max(500, Math.floor(Number(vars.scrollDelayMs || input.scrollDelayMs || 1500)) || 1500);
const maxNoChangeCycles = Math.max(1, Math.floor(Number(vars.maxNoChangeCycles || input.maxNoChangeCycles || 3)) || 3);
const commentGrowthTimeoutMs = Math.max(1000, Math.floor(Number(vars.commentGrowthTimeoutMs || input.commentGrowthTimeoutMs || 10000)) || 10000);

async function scrollAndCountCommentAuthors() {
  return page.evaluate(`
    const limit = Number(__args[0] || 100);
    const delayMs = Number(__args[1] || 1500);
    const commentGrowthTimeoutMs = Number(__args[2] || 10000);

    function xpathAll(xpath, root) {
      const out = [];
      if (!xpath) return out;
      try {
        const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
      } catch {}
      return out.filter(Boolean);
    }

    function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function findPostDialogRoot() {
      const dialogs = xpathAll("//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')]");
      if (dialogs.length > 0) return dialogs[0];
      return document.documentElement;
    }

    function extractProfileUidFromLink(link) {
      if (!link) return '';
      try {
        const href = link.href || link.getAttribute('href') || '';
        const url = new URL(href, location.href);
        const host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '').toLowerCase();
        if (host !== 'facebook.com' && host !== 'fb.com') return '';
        if (url.pathname === '/profile.php') return url.searchParams.get('id') || '';
        const parts = url.pathname.split('/').filter(Boolean);
        const userIndex = parts.findIndex(part => part.toLowerCase() === 'user');
        if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
        if (parts.length === 1 && /^[a-zA-Z0-9._-]+$/.test(parts[0])) return parts[0];
      } catch {}
      return '';
    }

    function findVisibleCommentNodes(root) {
      return xpathAll(".//*[@role='article' and .//*[@class='xt0psk2']]", root);
    }

    function findCommentAuthorLink(comment) {
      return xpathAll(".//*[@class='xjp7ctv']//a[@role='link' and @tabindex='0']", comment)[0] || null;
    }

    function countUniqueCommentAuthors(root) {
      const seen = new Set();
      const comments = findVisibleCommentNodes(root);
      for (const comment of comments) {
        const uid = extractProfileUidFromLink(findCommentAuthorLink(comment));
        if (uid) seen.add(uid);
        if (seen.size >= limit) break;
      }
      return seen.size;
    }

    const root = findPostDialogRoot();
    let comments = findVisibleCommentNodes(root);
    const oldCommentCount = comments.length;
    let scrolled = false;

    if (comments.length > 0) {
      try {
        comments[comments.length - 1].scrollIntoView(true);
        scrolled = true;
      } catch {}
    }

    await delay(delayMs);

    let waitedMs = 0;
    comments = findVisibleCommentNodes(root);
    while (waitedMs <= commentGrowthTimeoutMs && comments.length === oldCommentCount) {
      await delay(500);
      waitedMs += 500;
      comments = findVisibleCommentNodes(root);
    }

    return {
      count: countUniqueCommentAuthors(root),
      commentCount: comments.length,
      oldCommentCount,
      waitedMs,
      scrolled
    };
  `, limit, delayMs, commentGrowthTimeoutMs);
}

let previousAuthorCount = 0;
let stableCount = 0;
let cycles = 0;
let previousCommentCount = 0;

while (!vars.contactScanCancelled && previousAuthorCount < limit && stableCount < maxNoChangeCycles) {
  cycles++;
  const current = await scrollAndCountCommentAuthors();
  const authorCount = Number(current && current.count ? current.count : 0);
  const commentCount = Number(current && current.commentCount ? current.commentCount : 0);
  helpers.log('Đang tải comment: đã thấy ' + authorCount + '/' + limit + ' người comment từ ' + commentCount + ' comment');

  if (authorCount > previousAuthorCount) {
    previousAuthorCount = authorCount;
    stableCount = 0;
  } else if (commentCount > previousCommentCount) {
    stableCount = 0;
  } else {
    stableCount++;
  }
  previousCommentCount = Math.max(previousCommentCount, commentCount);

  if (previousAuthorCount >= limit || stableCount >= maxNoChangeCycles || vars.contactScanCancelled || commentCount <= 0) break;
}

return {
  loadedCount: Math.min(previousAuthorCount, limit),
  cycles,
  commentCount: previousCommentCount,
  stopped: vars.contactScanCancelled === true
};
$block$,
  '[]'::jsonb,
  '[{"name":"loadedCount","type":"number","label":"Loaded count"},{"name":"stopped","type":"boolean","label":"Stopped"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_scan_extract_post_commenters',
  'Trích tên, UID và link profile của người comment đang hiển thị trong dialog bài post.',
  'UserRoundSearch',
  'facebook',
  'js',
  NULL,
$block$
const limit = Math.max(1, Math.floor(Number(vars.maxCommenters || input.maxCommenters || 100)) || 100);
const sourcePostUrl = String(vars.sourcePostUrl || vars.targetUrl || input.sourcePostUrl || '').trim();

const contacts = await page.evaluate(`
  const limit = Number(__args[0] || 100);
  const sourcePostUrl = String(__args[1] || '');
  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    try {
      const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    return out.filter(Boolean);
  }

  function findPostDialogRoot() {
    const dialogs = xpathAll("//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')]");
    if (dialogs.length > 0) return dialogs[0];
    return document.documentElement;
  }

  function normalizeName(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function findVisibleCommentNodes(root) {
    return xpathAll(".//*[@role='article' and .//*[@class='xt0psk2']]", root);
  }

  function findCommentAuthorLink(comment) {
    return xpathAll(".//*[@class='xjp7ctv']//a[@role='link' and @tabindex='0']", comment)[0] || null;
  }

  function extractProfileTarget(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      const host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '').toLowerCase();
      if (host !== 'facebook.com' && host !== 'fb.com') return null;
      if (url.pathname === '/profile.php') {
        const id = url.searchParams.get('id');
        return id ? { uid: id, url: 'https://www.facebook.com/profile.php?id=' + id } : null;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.findIndex(part => part.toLowerCase() === 'user');
      if (userIndex >= 0 && parts[userIndex + 1]) {
        const uid = parts[userIndex + 1];
        return { uid, url: /^\\d+$/.test(uid) ? 'https://www.facebook.com/profile.php?id=' + uid : 'https://www.facebook.com/' + uid };
      }
      if (parts.length !== 1) return null;
      const slug = parts[0];
      if (!slug || /^(friends|groups|pages|photo|photos|story|stories|posts|watch|reel|reels|hashtag|events|marketplace|gaming|settings|notifications|messages|bookmarks|help|privacy|policies|ads|search|permalink.php|story.php)$/i.test(slug)) return null;
      if (!/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
      return { uid: slug, url: 'https://www.facebook.com/' + slug };
    } catch {
      return null;
    }
  }

  function cleanAuthorName(link) {
    const lines = String(link.innerText || link.textContent || '')
      .split(/\\n+/)
      .map(normalizeName)
      .filter(Boolean);
    const name = lines[0] || normalizeName(link.getAttribute('aria-label') || link.getAttribute('title') || '');
    if (!name || name.length < 2 || name.length > 100) return '';
    if (/^(Thích|Like|Trả lời|Reply|Chia sẻ|Share|Theo dõi|Follow)$/i.test(name)) return '';
    return name;
  }

  const root = findPostDialogRoot();
  const rows = [];
  const seen = new Set();
  const comments = findVisibleCommentNodes(root);

  for (const comment of comments) {
    const link = findCommentAuthorLink(comment);
    const target = extractProfileTarget(link ? (link.href || link.getAttribute('href') || '') : '');
    if (!target || seen.has(target.uid)) continue;
    const name = cleanAuthorName(link);
    if (!name) continue;
    seen.add(target.uid);
    rows.push({
      name,
      uid: target.uid,
      url: target.url,
      isFriend: false,
      extraData: {
        source: 'facebook_post_commenters',
        sourcePostUrl,
        sourcePostUrls: sourcePostUrl ? [sourcePostUrl] : [],
        sourcePostRefs: sourcePostUrl ? [{ source: 'facebook_post_commenters', url: sourcePostUrl }] : []
      }
    });
    if (rows.length >= limit) break;
  }

  return rows.slice(0, limit);
`, limit, sourcePostUrl);

const rows = Array.isArray(contacts) ? contacts : [];
vars.postCommenterContacts = rows;
helpers.log('Đã đọc ' + rows.length + ' người comment từ bài post');

return { contacts: rows };
$block$,
  '[]'::jsonb,
  '[{"name":"contacts","type":"json","label":"Contacts"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  kind = EXCLUDED.kind,
  system_type = EXCLUDED.system_type,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name IN (
    'fb_scan_open_target',
    'fb_scan_select_all_comments',
    'fb_scan_scroll_post_comments',
    'fb_scan_extract_post_commenters',
    'fb_scan_contacts_summary'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  '[Built-in] Facebook - Quét người comment bài post',
  'Workflow quét người comment của một bài post Facebook vào auto_account_contacts.',
  jsonb_build_array(
    jsonb_build_object('id', 'node-open', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_open_target'), 'blockName', 'fb_scan_open_target', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở bài post'),
    jsonb_build_object('id', 'node-select-all', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_select_all_comments'), 'blockName', 'fb_scan_select_all_comments', 'position', jsonb_build_object('x', 260, 'y', 0), 'config', '{}'::jsonb, 'label', 'Chọn tất cả bình luận'),
    jsonb_build_object('id', 'node-scroll-comments', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_scroll_post_comments'), 'blockName', 'fb_scan_scroll_post_comments', 'position', jsonb_build_object('x', 520, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tải thêm comment'),
    jsonb_build_object('id', 'node-extract', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_extract_post_commenters'), 'blockName', 'fb_scan_extract_post_commenters', 'position', jsonb_build_object('x', 780, 'y', 0), 'config', '{}'::jsonb, 'label', 'Đọc người comment'),
    jsonb_build_object('id', 'node-summary', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_contacts_summary'), 'blockName', 'fb_scan_contacts_summary', 'position', jsonb_build_object('x', 1040, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tổng kết')
  ),
  '[
    {"id":"e-open-select-all","source":"node-open","target":"node-select-all"},
    {"id":"e-select-all-scroll","source":"node-select-all","target":"node-scroll-comments"},
    {"id":"e-scroll-extract","source":"node-scroll-comments","target":"node-extract"},
    {"id":"e-extract-summary","source":"node-extract","target":"node-summary"}
  ]'::jsonb,
  '[
    {"name":"targetUrl","type":"string","label":"Post URL","default":""},
    {"name":"sourcePostUrl","type":"string","label":"Source post URL","default":""},
    {"name":"contactType","type":"string","label":"Contact type","default":"person"},
    {"name":"maxCommenters","type":"number","label":"Số lượng","default":100},
    {"name":"commentSortDelayMs","type":"number","label":"Comment sort delay","default":1500},
    {"name":"commentSortAfterSelectDelayMs","type":"number","label":"Comment sort after select delay","default":3500},
    {"name":"scrollDelayMs","type":"number","label":"Scroll delay","default":1500},
    {"name":"maxNoChangeCycles","type":"number","label":"Stop after no-change cycles","default":3},
    {"name":"commentGrowthTimeoutMs","type":"number","label":"Comment growth timeout","default":10000}
  ]'::jsonb,
  '{"targetUrl":"","sourcePostUrl":"","contactType":"person","maxCommenters":100,"commentSortDelayMs":1500,"commentSortAfterSelectDelayMs":3500,"scrollDelayMs":1500,"maxNoChangeCycles":3,"commentGrowthTimeoutMs":10000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  nodes = EXCLUDED.nodes,
  edges = EXCLUDED.edges,
  variables_schema = EXCLUDED.variables_schema,
  default_variables = (EXCLUDED.default_variables || COALESCE(auto_workflows.default_variables, '{}'::jsonb)) - 'scrollStepPx',
  is_builtin = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

COMMIT;
