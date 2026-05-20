-- Migration v45: Workflow v2 for background account data scans.
-- DataScanModal keeps its immediate UX; ContactLoader runs these built-in workflows
-- on hidden/offscreen pages and saves output into auto_account_contacts.

BEGIN;

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_scan_open_target',
  'Mở trang Facebook phục vụ quét danh bạ tài khoản.',
  'Globe',
  'facebook',
  'js',
  NULL,
$block$
const targetUrl = String(vars.targetUrl || input.targetUrl || '').trim();
if (!targetUrl) throw new Error('Thiếu URL quét data');
if (vars.contactScanCancelled) return { targetUrl, stopped: true };

helpers.log('Mở trang quét data');
await page.navigate(targetUrl);
await helpers.sleep(3000);

return { targetUrl };
$block$,
  '[]'::jsonb,
  '[{"name":"targetUrl","type":"string","label":"Target URL"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_scan_scroll_contacts',
  'Cuộn trang bạn bè/group đến khi số data hợp lệ không tăng thêm.',
  'ListEnd',
  'facebook',
  'js',
  NULL,
$block$
const contactType = String(vars.contactType || input.contactType || 'person');
if (contactType === 'page') return { loadedCount: 0 };

const maxNoChangeCycles = Math.max(1, Math.floor(Number(vars.maxNoChangeCycles ?? input.maxNoChangeCycles ?? 3)) || 3);
const delayMs = Math.max(500, Math.floor(Number(vars.scrollDelayMs ?? input.scrollDelayMs ?? 1500)) || 1500);
const typeName = contactType === 'group' ? 'group' : 'bạn bè';

async function countLoadedContacts() {
  const count = await page.evaluate(`
    const contactType = String(__args[0] || 'person');
    const reservedProfilePaths = new Set([
      'friends', 'groups', 'pages', 'photo', 'photos', 'story', 'watch', 'reel', 'reels',
      'hashtag', 'events', 'marketplace', 'gaming', 'settings', 'notifications',
      'messages', 'bookmarks', 'help', 'privacy', 'policies', 'ads', 'search'
    ]);
    const reservedGroupPaths = new Set([
      'feed', 'joins', 'discover', 'create', 'category', 'notifications',
      'your_groups', 'membership', 'browse'
    ]);

    function toFacebookUrl(href) {
      try {
        var url = new URL(href, window.location.origin);
        var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '');
        if (host !== 'facebook.com' && host !== 'fb.com') return null;
        return url;
      } catch (e) {
        return null;
      }
    }

    function extractProfileUid(href) {
      var url = toFacebookUrl(href);
      if (!url) return '';
      if (url.pathname === '/profile.php') return url.searchParams.get('id') || '';
      var parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return '';
      var slug = parts[0];
      if (!slug || reservedProfilePaths.has(slug.toLowerCase())) return '';
      return /^[a-zA-Z0-9._-]+$/.test(slug) ? slug : '';
    }

    function extractGroupUid(href) {
      var url = toFacebookUrl(href);
      if (!url) return '';
      var parts = url.pathname.split('/').filter(Boolean);
      var idx = parts.findIndex(function(part) { return part.toLowerCase() === 'groups'; });
      if (idx === -1 || idx + 1 >= parts.length) return '';
      var groupKey = parts[idx + 1];
      if (!groupKey || reservedGroupPaths.has(groupKey.toLowerCase())) return '';
      return /^[a-zA-Z0-9._-]+$/.test(groupKey) ? groupKey : '';
    }

    function normalizeText(txt) {
      return String(txt || '').replace(/\\s+/g, ' ').trim();
    }

    function cleanPersonName(a) {
      function clean(txt) {
        return normalizeText(txt)
          .replace(/\\d+\\s*bạn chung.*$/i, '')
          .replace(/Có\\s*[\\d,.]+[KkMm]?\\s*người theo dõi.*$/i, '')
          .replace(/\\d+\\s*mutual friends?.*$/i, '')
          .replace(/\\d+\\s*followers?.*$/i, '')
          .trim();
      }
      function bad(txt) {
        return !txt ||
          /bạn chung|mutual friends?|người theo dõi|followers?/i.test(txt) ||
          /^(Bạn bè|Friends|Thêm bạn bè|Add friend|Nhắn tin|Message|Theo dõi|Follow)$/i.test(txt);
      }
      var spans = a.querySelectorAll('span, strong, h2, h3');
      for (var s = 0; s < spans.length; s++) {
        var span = spans[s];
        if (span.querySelector('span, strong, h2, h3')) continue;
        var candidate = clean(span.textContent);
        if (candidate.length >= 2 && candidate.length <= 80 && !bad(candidate)) return candidate;
      }
      var text = clean(a.innerText || a.textContent);
      return text.length >= 2 && text.length <= 100 && !bad(text) ? text : '';
    }

    function isActivityText(txt) {
      return /Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity/i.test(txt);
    }

    function cleanGroupName(a) {
      function stripActivity(txt) {
        return normalizeText(txt)
          .replace(/\\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i, '')
          .trim();
      }
      var lines = String(a.innerText || '').split(/\\n+/).map(stripActivity).filter(Boolean);
      for (var l = 0; l < lines.length; l++) {
        if (!isActivityText(lines[l]) && lines[l].length >= 2 && lines[l].length <= 180) return lines[l];
      }
      var spans = a.querySelectorAll('span, strong, h2, h3');
      for (var s = 0; s < spans.length; s++) {
        var span = spans[s];
        if (span.querySelector('span, strong, h2, h3')) continue;
        var candidate = stripActivity(span.textContent);
        if (!isActivityText(candidate) && candidate.length >= 2 && candidate.length <= 180) return candidate;
      }
      return stripActivity(a.textContent);
    }

    var seen = new Set();
    var links = contactType === 'group'
      ? document.querySelectorAll('a[href*="/groups/"]')
      : document.querySelectorAll('a[href*="facebook.com/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var uid = contactType === 'group' ? extractGroupUid(a.href || '') : extractProfileUid(a.href || '');
      if (!uid) continue;
      var name = contactType === 'group' ? cleanGroupName(a) : cleanPersonName(a);
      if (!name || name.length < 2 || name.length > 200) continue;
      seen.add(uid);
    }
    return seen.size;
  `, contactType);
  return typeof count === 'number' ? count : 0;
}

async function scrollPage() {
  await page.evaluate(`
    function findScrollableParent(el) {
      var node = el;
      while (node && node !== document.body && node !== document.documentElement) {
        var style = window.getComputedStyle(node);
        var overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) return node;
        node = node.parentElement;
      }
      return null;
    }

    var anchorEl = document.querySelector('a[href*="/groups/"]') || document.querySelector('a[href*="facebook.com/"]');
    var scrolled = false;
    if (anchorEl) {
      var scrollContainer = findScrollableParent(anchorEl);
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        scrolled = true;
      }
    }

    if (!scrolled) {
      var candidates = [
        document.querySelector('[role="main"]'),
        document.querySelector('[role="navigation"]'),
        document.querySelector('[data-pagelet="ProfileAppSection_0"]')
      ];
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j];
        if (!c) continue;
        var sc = findScrollableParent(c);
        if (sc) {
          sc.scrollTop = sc.scrollHeight;
          scrolled = true;
          break;
        }
      }
    }

    if (!scrolled) {
      window.scrollTo(0, document.body.scrollHeight);
      document.documentElement.scrollTop = document.documentElement.scrollHeight;
    }

    var allDivs = document.querySelectorAll('div');
    for (var k = 0; k < allDivs.length; k++) {
      var div = allDivs[k];
      var st = window.getComputedStyle(div);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') &&
          div.scrollHeight > div.clientHeight + 200 &&
          div.clientHeight > 300) {
        div.scrollTop = div.scrollHeight;
      }
    }
    return true;
  `);
}

let prevCount = 0;
let noChangeCount = 0;
let scrollCount = 0;

while (!vars.contactScanCancelled) {
  scrollCount++;
  await scrollPage();
  await helpers.sleep(delayMs);
  if (vars.contactScanCancelled) break;

  const currentCount = await countLoadedContacts();
  helpers.log(`📜 Đang cuộn trang... lần ${scrollCount}, đã thấy ${currentCount} ${typeName}`);
  if (currentCount > prevCount) {
    prevCount = currentCount;
    noChangeCount = 0;
  } else {
    noChangeCount++;
    if (noChangeCount >= maxNoChangeCycles) break;
  }
}

return { loadedCount: prevCount, stopped: vars.contactScanCancelled === true };
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
  'fb_scan_extract_contacts',
  'Trích xuất bạn bè hoặc group đã render trên trang.',
  'Database',
  'facebook',
  'js',
  NULL,
$block$
const contactType = String(vars.contactType || input.contactType || 'person');
if (contactType === 'page') return { contacts: input.contacts || [] };

const contacts = await page.evaluate(`
  const contactType = String(__args[0] || 'person');
  const reservedProfilePaths = new Set([
    'friends', 'groups', 'pages', 'photo', 'photos', 'story', 'watch', 'reel', 'reels',
    'hashtag', 'events', 'marketplace', 'gaming', 'settings', 'notifications',
    'messages', 'bookmarks', 'help', 'privacy', 'policies', 'ads', 'search'
  ]);
  const reservedGroupPaths = new Set([
    'feed', 'joins', 'discover', 'create', 'category', 'notifications',
    'your_groups', 'membership', 'browse'
  ]);

  function toFacebookUrl(href) {
    try {
      var url = new URL(href, window.location.origin);
      var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '');
      if (host !== 'facebook.com' && host !== 'fb.com') return null;
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
    if (parts.length !== 1) return null;
    var slug = parts[0];
    if (!slug || reservedProfilePaths.has(slug.toLowerCase())) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
    return { uid: slug, url: 'https://www.facebook.com/' + slug };
  }

  function extractGroupTarget(href) {
    var url = toFacebookUrl(href);
    if (!url) return null;
    var parts = url.pathname.split('/').filter(Boolean);
    var idx = parts.findIndex(function(part) { return part.toLowerCase() === 'groups'; });
    if (idx === -1 || idx + 1 >= parts.length) return null;
    var groupKey = parts[idx + 1];
    if (!groupKey || reservedGroupPaths.has(groupKey.toLowerCase())) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(groupKey)) return null;
    return { uid: groupKey, url: 'https://www.facebook.com/groups/' + groupKey };
  }

  function normalizeText(txt) {
    return String(txt || '').replace(/\\s+/g, ' ').trim();
  }

  function cleanPersonName(a) {
    function clean(txt) {
      return normalizeText(txt)
        .replace(/\\d+\\s*bạn chung.*$/i, '')
        .replace(/Có\\s*[\\d,.]+[KkMm]?\\s*người theo dõi.*$/i, '')
        .replace(/\\d+\\s*mutual friends?.*$/i, '')
        .replace(/\\d+\\s*followers?.*$/i, '')
        .trim();
    }
    function bad(txt) {
      return !txt ||
        /bạn chung|mutual friends?|người theo dõi|followers?/i.test(txt) ||
        /^(Bạn bè|Friends|Thêm bạn bè|Add friend|Nhắn tin|Message|Theo dõi|Follow)$/i.test(txt);
    }
    var spans = a.querySelectorAll('span, strong, h2, h3');
    for (var s = 0; s < spans.length; s++) {
      var span = spans[s];
      if (span.querySelector('span, strong, h2, h3')) continue;
      var candidate = clean(span.textContent);
      if (candidate.length >= 2 && candidate.length <= 80 && !bad(candidate)) return candidate;
    }
    var text = clean(a.innerText || a.textContent);
    return text.length >= 2 && text.length <= 100 && !bad(text) ? text : '';
  }

  function isActivityText(txt) {
    return /Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity/i.test(txt);
  }

  function extractActivityText(a) {
    var lines = String(a.innerText || a.textContent || '').split(/\\n+/).map(normalizeText).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      if (isActivityText(lines[i])) return lines[i];
    }
    var full = normalizeText(a.textContent);
    var match = full.match(/(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i);
    return match ? normalizeText(match[0]) : '';
  }

  function cleanGroupName(a) {
    function stripActivity(txt) {
      return normalizeText(txt)
        .replace(/\\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i, '')
        .trim();
    }
    var lines = String(a.innerText || '').split(/\\n+/).map(stripActivity).filter(Boolean);
    for (var l = 0; l < lines.length; l++) {
      if (!isActivityText(lines[l]) && lines[l].length >= 2 && lines[l].length <= 180) return lines[l];
    }
    var spans = a.querySelectorAll('span, strong, h2, h3');
    for (var s = 0; s < spans.length; s++) {
      var span = spans[s];
      if (span.querySelector('span, strong, h2, h3')) continue;
      var candidate = stripActivity(span.textContent);
      if (!isActivityText(candidate) && candidate.length >= 2 && candidate.length <= 180) return candidate;
    }
    return stripActivity(a.textContent);
  }

  var results = [];
  var seen = new Set();
  var links = contactType === 'group'
    ? document.querySelectorAll('a[href*="/groups/"]')
    : document.querySelectorAll('a[href*="facebook.com/"]');

  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var target = contactType === 'group' ? extractGroupTarget(a.href || '') : extractProfileTarget(a.href || '');
    if (!target || seen.has(target.uid)) continue;

    if (contactType === 'group') {
      var groupName = cleanGroupName(a);
      if (!groupName || groupName.length < 2 || groupName.length > 200) continue;
      seen.add(target.uid);
      results.push({
        name: groupName,
        uid: target.uid,
        url: target.url,
        isJoined: true,
        extraData: {
          source: 'facebook_groups_joined',
          lastActivityText: extractActivityText(a) || null
        }
      });
    } else {
      var personName = cleanPersonName(a);
      if (!personName || personName.length < 2 || personName.length > 100) continue;
      seen.add(target.uid);
      results.push({
        name: personName,
        uid: target.uid,
        url: target.url,
        isFriend: true,
        extraData: { source: 'facebook_friends_list' }
      });
    }
  }

  return results;
`, contactType);

helpers.log(`Đã đọc ${Array.isArray(contacts) ? contacts.length : 0} data từ trang`);
return { contacts: Array.isArray(contacts) ? contacts : [] };
$block$,
  '[]'::jsonb,
  '[{"name":"contacts","type":"json","label":"Contacts"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_scan_pages_graph',
  'Lấy danh sách page quản lý qua Facebook Graph API bằng session hiện tại.',
  'FileJson',
  'facebook',
  'js',
  NULL,
$block$
if (vars.contactScanCancelled) return { contacts: [], stopped: true };

helpers.log('Đang lấy quyền truy cập page...');
const token = await page.evaluate(`
  const body = document.body ? document.body.innerHTML : '';
  const match = body.match(/EAAG(.*?)"/);
  return match && match[1] ? 'EAAG' + match[1] : '';
`);

if (!token) {
  throw new Error('Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử tải page.');
}

helpers.log('Đang tải danh sách page qua Facebook API...');
const cookieHeader = await page.getCookieHeader('https://graph.facebook.com/');
const pages = [];
const seen = new Set();
let nextPage = 'https://graph.facebook.com/me/accounts?' + new URLSearchParams({ access_token: token }).toString();
let pageIndex = 0;

function formatGraphError(status, error) {
  const parts = [`Facebook Graph API lỗi HTTP ${status}`];
  if (error && error.message) parts.push(String(error.message));
  if (error && error.type) parts.push(`type=${error.type}`);
  if (error && error.code) parts.push(`code=${error.code}`);
  if (error && error.error_subcode) parts.push(`subcode=${error.error_subcode}`);
  return parts.join(' - ');
}

while (nextPage && pageIndex < 25 && !vars.contactScanCancelled) {
  pageIndex++;
  const response = await page.apiCall({
    url: nextPage,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    timeout: 30000
  });

  if (response.status < 200 || response.status >= 300) {
    const data = response.data && typeof response.data === 'object' ? response.data : {};
    throw new Error(formatGraphError(response.status, data.error || null));
  }

  const json = response.data && typeof response.data === 'object' ? response.data : {};
  if (json.error) throw new Error(formatGraphError(response.status, json.error));

  const rows = Array.isArray(json.data) ? json.data : [];
  for (const pageRow of rows) {
    const uid = String(pageRow && pageRow.id || '').trim();
    const name = String(pageRow && pageRow.name || '').replace(/\s+/g, ' ').trim();
    if (!uid || !name || seen.has(uid)) continue;
    seen.add(uid);
    pages.push({
      name,
      uid,
      url: 'https://www.facebook.com/' + uid,
      extraData: {
        source: 'facebook_graph_me_accounts',
        category: String(pageRow && pageRow.category || '').trim() || null
      }
    });
  }

  nextPage = json.paging && typeof json.paging.next === 'string' ? json.paging.next : '';
}

helpers.log(`Đã đọc ${pages.length} page qua Facebook API`);
return { contacts: pages, stopped: vars.contactScanCancelled === true };
$block$,
  '[]'::jsonb,
  '[{"name":"contacts","type":"json","label":"Pages"},{"name":"stopped","type":"boolean","label":"Stopped"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_scan_contacts_summary',
  'Tổng kết output quét data cho ContactLoader lưu DB.',
  'CheckCircle',
  'facebook',
  'js',
  NULL,
$block$
const contacts = Array.isArray(input.contacts) ? input.contacts : [];
const contactType = String(vars.contactType || input.contactType || '');
const stopped = vars.contactScanCancelled === true || input.stopped === true;
helpers.log(stopped
  ? `Dừng quét data. Dùng ${contacts.length} data hiện có trên trang.`
  : `Tổng kết quét data: ${contacts.length} data.`);

return {
  contacts,
  contactType,
  total: contacts.length,
  stopped
};
$block$,
  '[]'::jsonb,
  '[{"name":"contacts","type":"json","label":"Contacts"},{"name":"total","type":"number","label":"Total"},{"name":"stopped","type":"boolean","label":"Stopped"}]'::jsonb,
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
    'fb_scan_scroll_contacts',
    'fb_scan_extract_contacts',
    'fb_scan_pages_graph',
    'fb_scan_contacts_summary'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  workflow_name,
  workflow_description,
  nodes,
  edges,
  variables_schema,
  default_variables,
  true,
  NULL,
  NULL,
  now()
FROM (
  VALUES
  (
    '[Built-in] Facebook - Quét danh sách bạn bè',
    'Workflow quét danh sách bạn bè Facebook vào auto_account_contacts.',
    jsonb_build_array(
      jsonb_build_object('id', 'node-open', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_open_target'), 'blockName', 'fb_scan_open_target', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở danh sách bạn bè'),
      jsonb_build_object('id', 'node-scroll', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_scroll_contacts'), 'blockName', 'fb_scan_scroll_contacts', 'position', jsonb_build_object('x', 260, 'y', 0), 'config', '{}'::jsonb, 'label', 'Cuộn danh sách'),
      jsonb_build_object('id', 'node-extract', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_extract_contacts'), 'blockName', 'fb_scan_extract_contacts', 'position', jsonb_build_object('x', 520, 'y', 0), 'config', '{}'::jsonb, 'label', 'Đọc bạn bè'),
      jsonb_build_object('id', 'node-summary', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_contacts_summary'), 'blockName', 'fb_scan_contacts_summary', 'position', jsonb_build_object('x', 780, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tổng kết')
    ),
    '[
      {"id":"e-open-scroll","source":"node-open","target":"node-scroll"},
      {"id":"e-scroll-extract","source":"node-scroll","target":"node-extract"},
      {"id":"e-extract-summary","source":"node-extract","target":"node-summary"}
    ]'::jsonb,
    '[
      {"name":"targetUrl","type":"string","label":"Friends URL","default":"https://www.facebook.com/friends/list"},
      {"name":"contactType","type":"string","label":"Contact type","default":"person"},
      {"name":"scrollDelayMs","type":"number","label":"Scroll delay","default":1500},
      {"name":"maxNoChangeCycles","type":"number","label":"Stop after no-change cycles","default":3}
    ]'::jsonb,
    '{"targetUrl":"https://www.facebook.com/friends/list","contactType":"person","scrollDelayMs":1500,"maxNoChangeCycles":3}'::jsonb
  ),
  (
    '[Built-in] Facebook - Quét group đã tham gia',
    'Workflow quét group Facebook đã tham gia vào auto_account_contacts.',
    jsonb_build_array(
      jsonb_build_object('id', 'node-open', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_open_target'), 'blockName', 'fb_scan_open_target', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở danh sách group'),
      jsonb_build_object('id', 'node-scroll', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_scroll_contacts'), 'blockName', 'fb_scan_scroll_contacts', 'position', jsonb_build_object('x', 260, 'y', 0), 'config', '{}'::jsonb, 'label', 'Cuộn danh sách'),
      jsonb_build_object('id', 'node-extract', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_extract_contacts'), 'blockName', 'fb_scan_extract_contacts', 'position', jsonb_build_object('x', 520, 'y', 0), 'config', '{}'::jsonb, 'label', 'Đọc group'),
      jsonb_build_object('id', 'node-summary', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_contacts_summary'), 'blockName', 'fb_scan_contacts_summary', 'position', jsonb_build_object('x', 780, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tổng kết')
    ),
    '[
      {"id":"e-open-scroll","source":"node-open","target":"node-scroll"},
      {"id":"e-scroll-extract","source":"node-scroll","target":"node-extract"},
      {"id":"e-extract-summary","source":"node-extract","target":"node-summary"}
    ]'::jsonb,
    '[
      {"name":"targetUrl","type":"string","label":"Groups URL","default":"https://www.facebook.com/groups/joins/"},
      {"name":"contactType","type":"string","label":"Contact type","default":"group"},
      {"name":"scrollDelayMs","type":"number","label":"Scroll delay","default":1500},
      {"name":"maxNoChangeCycles","type":"number","label":"Stop after no-change cycles","default":3}
    ]'::jsonb,
    '{"targetUrl":"https://www.facebook.com/groups/joins/","contactType":"group","scrollDelayMs":1500,"maxNoChangeCycles":3}'::jsonb
  ),
  (
    '[Built-in] Facebook - Quét page quản lý',
    'Workflow quét page Facebook quản lý qua Graph API vào auto_account_contacts.',
    jsonb_build_array(
      jsonb_build_object('id', 'node-open', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_open_target'), 'blockName', 'fb_scan_open_target', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở Business'),
      jsonb_build_object('id', 'node-pages', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_pages_graph'), 'blockName', 'fb_scan_pages_graph', 'position', jsonb_build_object('x', 260, 'y', 0), 'config', '{}'::jsonb, 'label', 'Lấy page'),
      jsonb_build_object('id', 'node-summary', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_contacts_summary'), 'blockName', 'fb_scan_contacts_summary', 'position', jsonb_build_object('x', 520, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tổng kết')
    ),
    '[
      {"id":"e-open-pages","source":"node-open","target":"node-pages"},
      {"id":"e-pages-summary","source":"node-pages","target":"node-summary"}
    ]'::jsonb,
    '[
      {"name":"targetUrl","type":"string","label":"Business URL","default":"https://business.facebook.com/content_management"},
      {"name":"contactType","type":"string","label":"Contact type","default":"page"}
    ]'::jsonb,
    '{"targetUrl":"https://business.facebook.com/content_management","contactType":"page"}'::jsonb
  )
) AS wf(workflow_name, workflow_description, nodes, edges, variables_schema, default_variables)
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
