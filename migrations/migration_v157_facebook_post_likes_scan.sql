-- Facebook DataScan: collect people who liked/reacted to a single post.
-- DOM interaction mirrors akaBizAuto LoadUid_React_FromPost_Fb.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  (
    'FbPostReactionDialog',
    $$//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')]$$,
    'Facebook dialog scope. Mirrors C# Dialog.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'FbPostReactionSeeUidButton',
    $$//*[@role='button' and (contains(.,'Tất cả cảm xúc') or contains(@aria-label,'Thích:') or contains(@aria-label,'Yêu thích:')) and not(ancestor::*[@aria-hidden='true' or contains(@style,'display: none') or contains(@style,'hidden')])]$$,
    'Button that opens the post reaction user list. Mirrors C# SeeUidReactBtn.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'FbPostReactionUidInReact',
    $$//*[@role='dialog']//*[@class='x1rg5ohu']//a|//*[@class='x1rg5ohu']//a$$,
    'User links inside the post reactions dialog. Mirrors C# UidInReact.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  )
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_scan_post_likes_open_reactions',
  'Mở dialog người like/react bài post, bám DOM C# LoadUid_React_FromPost_Fb.',
  'MousePointerClick',
  'facebook',
  'js',
  NULL,
$block$
const dialogSelector = await helpers.element('FbPostReactionDialog');
const seeUidSelector = await helpers.element('FbPostReactionSeeUidButton');
const reactOpenDelayMs = Math.max(0, Math.floor(Number(vars.reactOpenDelayMs ?? input.reactOpenDelayMs ?? 1500)) || 1500);

const result = await page.evaluate(`
  var dialogSelector = String(__args[0] || '');
  var seeUidSelector = String(__args[1] || '');

  function xpathAll(xpath, root) {
    var out = [];
    if (!xpath) return out;
    try {
      var result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch (e) {}
    return out;
  }

  var seeUidBtn = xpathAll(dialogSelector + seeUidSelector)[0] || null;
  var usedDialogScope = !!seeUidBtn;
  if (!seeUidBtn) {
    seeUidBtn = xpathAll(seeUidSelector)[0] || null;
  }

  if (!seeUidBtn) {
    return {
      opened: false,
      usedDialogScope: usedDialogScope,
      reason: 'Không có người nào like bài viết'
    };
  }

  try {
    seeUidBtn.click();
    return { opened: true, usedDialogScope: usedDialogScope };
  } catch (e) {
    return {
      opened: false,
      usedDialogScope: usedDialogScope,
      reason: e && e.message ? e.message : String(e)
    };
  }
`, dialogSelector, seeUidSelector);

if (!result || result.opened !== true) {
  throw new Error(result && result.reason ? result.reason : 'Không có người nào like bài viết');
}

await helpers.sleep(reactOpenDelayMs);
helpers.log('Đã mở danh sách người like bài post');

return result;
$block$,
  '[]'::jsonb,
  '[{"name":"opened","type":"boolean","label":"Opened"},{"name":"usedDialogScope","type":"boolean","label":"Used dialog scope"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_scan_post_likes_scroll',
  'Cuộn danh sách người like/react bài post bằng scrollIntoView(true) trên link cuối, bám C#.',
  'ListEnd',
  'facebook',
  'js',
  NULL,
$block$
const uidSelector = await helpers.element('FbPostReactionUidInReact');
const maxLikes = Math.max(1, Math.floor(Number(vars.maxLikes ?? input.maxLikes ?? 1000)) || 1000);
const scrollDelayMs = Math.max(0, Math.floor(Number(vars.scrollDelayMs ?? input.scrollDelayMs ?? 1500)) || 1500);
const reactionGrowthTimeoutMs = Math.max(0, Math.floor(Number(vars.reactionGrowthTimeoutMs ?? input.reactionGrowthTimeoutMs ?? 10000)) || 10000);

async function getUidLinkCount() {
  const count = await page.evaluate(`
    function xpathAll(xpath, root) {
      var out = [];
      if (!xpath) return out;
      var result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
      return out;
    }
    return xpathAll(String(__args[0] || '')).length;
  `, uidSelector);
  return typeof count === 'number' ? count : 0;
}

async function scrollLastUidIntoView() {
  return await page.evaluate(`
    function xpathAll(xpath, root) {
      var out = [];
      if (!xpath) return out;
      var result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
      return out;
    }
    var links = xpathAll(String(__args[0] || ''));
    var last = links.length > 0 ? links[links.length - 1] : null;
    if (!last) return { count: links.length, scrolled: false };
    try { last.scrollIntoView(true); } catch (e) {}
    return { count: links.length, scrolled: true };
  `, uidSelector);
}

let uidCount = await getUidLinkCount();
if (uidCount === 0) {
  throw new Error('Không đọc được người like bài viết');
}

let cycles = 0;
let waitedMs = 0;

while (!vars.contactScanCancelled && uidCount < maxLikes) {
  cycles++;
  const oldCount = uidCount;

  await scrollLastUidIntoView();
  await helpers.sleep(scrollDelayMs);

  waitedMs = 0;
  uidCount = await getUidLinkCount();
  while (waitedMs <= reactionGrowthTimeoutMs && uidCount === oldCount) {
    await helpers.sleep(500);
    waitedMs += 500;
    uidCount = await getUidLinkCount();
  }

  helpers.log(`Đã thấy ${Math.min(uidCount, maxLikes)} profile`);

  if (oldCount >= uidCount || uidCount >= maxLikes) break;
}

return {
  loadedCount: Math.min(uidCount, maxLikes),
  rawCount: uidCount,
  cycles,
  waitedMs,
  stopped: vars.contactScanCancelled === true
};
$block$,
  '[]'::jsonb,
  '[{"name":"loadedCount","type":"number","label":"Loaded count"},{"name":"rawCount","type":"number","label":"Raw count"},{"name":"stopped","type":"boolean","label":"Stopped"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_scan_extract_post_likes',
  'Trích tên, UID và link profile của người like/react bài post từ XPath C# UidInReact.',
  'UserRoundSearch',
  'facebook',
  'js',
  NULL,
$block$
const uidSelector = await helpers.element('FbPostReactionUidInReact');
const maxLikes = Math.max(1, Math.floor(Number(vars.maxLikes ?? input.maxLikes ?? 1000)) || 1000);
const sourcePostUrl = String(vars.sourcePostUrl || vars.targetUrl || input.sourcePostUrl || '').trim();

const contacts = await page.evaluate(`
  var uidSelector = String(__args[0] || '');
  var limit = Math.max(1, Math.floor(Number(__args[1] || 1000)) || 1000);
  var sourcePostUrl = String(__args[2] || '');

  function xpathAll(xpath, root) {
    var out = [];
    if (!xpath) return out;
    var result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (var i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    return out;
  }

  function normalizeText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function toFacebookUrl(href) {
    try {
      var url = new URL(href, window.location.origin);
      var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '').replace(/^mobile\\./i, '').replace(/^mbasic\\./i, '').toLowerCase();
      if (host !== 'facebook.com' && host !== 'fb.com') return null;
      url.hostname = 'www.facebook.com';
      url.hash = '';
      return url;
    } catch (e) {
      return null;
    }
  }

  function extractProfileTarget(href) {
    var url = toFacebookUrl(href);
    if (!url) return null;
    if (url.pathname === '/profile.php') {
      var id = url.searchParams.get('id');
      return id ? { uid: id, url: 'https://www.facebook.com/profile.php?id=' + id } : null;
    }
    var parts = url.pathname.split('/').filter(Boolean);
    var userIndex = parts.findIndex(function(part) { return part.toLowerCase() === 'user'; });
    if (userIndex >= 0 && parts[userIndex + 1]) {
      var userUid = parts[userIndex + 1];
      return {
        uid: userUid,
        url: /^\\d+$/.test(userUid) ? 'https://www.facebook.com/profile.php?id=' + userUid : 'https://www.facebook.com/' + userUid
      };
    }
    if (parts.length !== 1) return null;
    var slug = parts[0];
    if (!slug || !/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
    return { uid: slug, url: 'https://www.facebook.com/' + slug };
  }

  var rawRows = [];
  var links = xpathAll(uidSelector);
  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    var href = link && link.getAttribute ? (link.getAttribute('href') || '') : '';
    var target = extractProfileTarget(href);
    if (!target || !target.uid) continue;
    rawRows.push({
      name: normalizeText(link.innerText || link.textContent || ''),
      uid: target.uid,
      url: target.url,
      isFriend: null,
      extraData: {
        source: 'facebook_post_likes',
        sources: ['facebook_post_likes'],
        tag: 'Like',
        sourcePostUrl: sourcePostUrl,
        sourcePostUrls: sourcePostUrl ? [sourcePostUrl] : [],
        sourcePostRefs: sourcePostUrl ? [{ source: 'facebook_post_likes', url: sourcePostUrl }] : []
      }
    });
  }

  var rows = [];
  var seen = new Set();
  var sliced = rawRows.slice(0, limit);
  for (var j = 0; j < sliced.length; j++) {
    var row = sliced[j];
    if (!row.uid || seen.has(row.uid)) continue;
    seen.add(row.uid);
    rows.push(row);
  }
  return rows;
`, uidSelector, maxLikes, sourcePostUrl);

const rows = Array.isArray(contacts) ? contacts : [];
vars.postLikeContacts = rows;
helpers.log('Đã đọc ' + rows.length + ' người like từ bài post');

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
    'fb_scan_post_likes_open_reactions',
    'fb_scan_post_likes_scroll',
    'fb_scan_extract_post_likes',
    'fb_scan_contacts_summary'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  '[Built-in] Facebook - Quét người like bài post',
  'Workflow quét người like/react của một bài post Facebook vào auto_account_contacts.',
  jsonb_build_array(
    jsonb_build_object('id', 'node-open', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_open_target'), 'blockName', 'fb_scan_open_target', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở bài post'),
    jsonb_build_object('id', 'node-open-reactions', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_post_likes_open_reactions'), 'blockName', 'fb_scan_post_likes_open_reactions', 'position', jsonb_build_object('x', 260, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở danh sách like'),
    jsonb_build_object('id', 'node-scroll', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_post_likes_scroll'), 'blockName', 'fb_scan_post_likes_scroll', 'position', jsonb_build_object('x', 520, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tải thêm người like'),
    jsonb_build_object('id', 'node-extract', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_extract_post_likes'), 'blockName', 'fb_scan_extract_post_likes', 'position', jsonb_build_object('x', 780, 'y', 0), 'config', '{}'::jsonb, 'label', 'Đọc người like'),
    jsonb_build_object('id', 'node-summary', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_contacts_summary'), 'blockName', 'fb_scan_contacts_summary', 'position', jsonb_build_object('x', 1040, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tổng kết')
  ),
  '[
    {"id":"e-open-open-reactions","source":"node-open","target":"node-open-reactions"},
    {"id":"e-open-reactions-scroll","source":"node-open-reactions","target":"node-scroll"},
    {"id":"e-scroll-extract","source":"node-scroll","target":"node-extract"},
    {"id":"e-extract-summary","source":"node-extract","target":"node-summary"}
  ]'::jsonb,
  '[
    {"name":"targetUrl","type":"string","label":"Post URL","default":""},
    {"name":"sourcePostUrl","type":"string","label":"Source post URL","default":""},
    {"name":"contactType","type":"string","label":"Contact type","default":"person"},
    {"name":"maxLikes","type":"number","label":"Số lượng","default":1000},
    {"name":"reactOpenDelayMs","type":"number","label":"Reaction open delay","default":1500},
    {"name":"scrollDelayMs","type":"number","label":"Scroll delay","default":1500},
    {"name":"reactionGrowthTimeoutMs","type":"number","label":"Reaction growth timeout","default":10000}
  ]'::jsonb,
  '{"targetUrl":"","sourcePostUrl":"","contactType":"person","maxLikes":1000,"reactOpenDelayMs":1500,"scrollDelayMs":1500,"reactionGrowthTimeoutMs":10000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  nodes = EXCLUDED.nodes,
  edges = EXCLUDED.edges,
  variables_schema = EXCLUDED.variables_schema,
  default_variables = EXCLUDED.default_variables,
  is_builtin = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

COMMIT;
