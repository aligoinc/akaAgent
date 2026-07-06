-- Facebook DataScan: collect friends of a specific profile.
-- DOM interaction mirrors akaBizAuto LoadFriend_FromUid_Fb.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  (
    'FbProfileFriendDivLink',
    $$//*[@class='xjp7ctv']//a[@role='link' and @tabindex=0 and not(contains(@href,'friends_mutual'))]$$,
    'Facebook profile friend link. Mirrors C# FriendDiv_Link.',
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
  'fb_scan_profile_friends_scroll',
  'Cuộn danh sách bạn bè của một profile Facebook, bám DOM C# LoadFriend_FromUid_Fb.',
  'ListEnd',
  'facebook',
  'js',
  NULL,
$block$
const friendLinkSelector = await helpers.element('FbProfileFriendDivLink');
const maxFriends = Math.max(1, Math.floor(Number(vars.maxFriends ?? input.maxFriends ?? 1000)) || 1000);
const delayMs = Math.max(0, Math.floor(Number(vars.scrollDelayMs ?? input.scrollDelayMs ?? 1500)) || 1500);
const growthTimeoutMs = Math.max(0, Math.floor(Number(vars.friendGrowthTimeoutMs ?? input.friendGrowthTimeoutMs ?? 10000)) || 10000);

async function getFriendLinkCount() {
  const count = await page.evaluate(`
    function xpathAll(xpath, root) {
      var out = [];
      if (!xpath) return out;
      var result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
      return out;
    }
    return xpathAll(String(__args[0] || '')).length;
  `, friendLinkSelector);
  return typeof count === 'number' ? count : 0;
}

async function scrollLastFriendIntoView() {
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
    if (last) {
      try { last.scrollIntoView(true); } catch (e) {}
    }
    return { count: links.length, scrolled: !!last };
  `, friendLinkSelector);
}

let friendCount = await getFriendLinkCount();
let previousCount = 0;
let cycles = 0;
let waitedMs = 0;

while (!vars.contactScanCancelled && friendCount !== previousCount && friendCount !== 0) {
  if (friendCount > maxFriends) break;
  cycles++;
  previousCount = friendCount;

  await scrollLastFriendIntoView();
  await helpers.sleep(delayMs);

  waitedMs = 0;
  friendCount = await getFriendLinkCount();
  while (waitedMs < growthTimeoutMs && friendCount === previousCount) {
    await helpers.sleep(500);
    waitedMs += 500;
    friendCount = await getFriendLinkCount();
  }

  helpers.log(`Đã thấy ${Math.min(friendCount, maxFriends)} profile`);
}

return {
  loadedCount: Math.min(friendCount, maxFriends),
  rawCount: friendCount,
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
  'fb_scan_profile_friends_extract',
  'Trích xuất bạn bè của một profile Facebook từ XPath C# FriendDiv_Link.',
  'Database',
  'facebook',
  'js',
  NULL,
$block$
const friendLinkSelector = await helpers.element('FbProfileFriendDivLink');
const maxFriends = Math.max(1, Math.floor(Number(vars.maxFriends ?? input.maxFriends ?? 1000)) || 1000);
const sourceProfileUrl = String(vars.sourceProfileUrl || vars.profileUrl || '').trim();
const sourceProfileUid = String(vars.sourceProfileUid || '').trim();

const contacts = await page.evaluate(`
  var selector = String(__args[0] || '');
  var limit = Math.max(1, Math.floor(Number(__args[1] || 1000)) || 1000);
  var sourceProfileUrl = String(__args[2] || '');
  var sourceProfileUid = String(__args[3] || '');

  function xpathAll(xpath, root) {
    var out = [];
    if (!xpath) return out;
    var result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (var i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    return out;
  }

  function normalizeText(txt) {
    return String(txt || '').replace(/\\s+/g, ' ').trim();
  }

  function toFacebookUrl(href) {
    try {
      var url = new URL(href, window.location.origin);
      var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '').replace(/^mobile\\./i, '').replace(/^mbasic\\./i, '');
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
      return {
        uid: parts[userIndex + 1],
        url: 'https://www.facebook.com/' + parts.slice(0, userIndex + 2).join('/')
      };
    }
    if (parts.length !== 1) return null;
    var slug = parts[0];
    if (!slug || !/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
    return { uid: slug, url: 'https://www.facebook.com/' + slug };
  }

  var rows = [];
  var seen = new Set();
  var links = xpathAll(selector);
  for (var i = 0; i < links.length; i++) {
    if (rows.length >= limit) break;
    var link = links[i];
    var target = extractProfileTarget(link && link.getAttribute ? link.getAttribute('href') : '');
    if (!target || !target.uid || seen.has(target.uid)) continue;
    var name = normalizeText(link.innerText || link.textContent || '');
    if (!name) continue;
    seen.add(target.uid);
    rows.push({
      name: name,
      uid: target.uid,
      url: target.url,
      isFriend: null,
      extraData: {
        source: 'facebook_profile_friends',
        sourceProfileUrl: sourceProfileUrl,
        sourceProfileUid: sourceProfileUid
      }
    });
  }
  return rows;
`, friendLinkSelector, maxFriends, sourceProfileUrl, sourceProfileUid);

helpers.log(`Đã đọc ${Array.isArray(contacts) ? contacts.length : 0} bạn bè từ profile`);
return { contacts: Array.isArray(contacts) ? contacts : [] };
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
    'fb_scan_profile_friends_scroll',
    'fb_scan_profile_friends_extract',
    'fb_scan_contacts_summary'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  '[Built-in] Facebook - Quét bạn bè của profile',
  'Workflow quét danh sách bạn bè của một profile Facebook vào auto_account_contacts.',
  jsonb_build_array(
    jsonb_build_object('id', 'node-open', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_open_target'), 'blockName', 'fb_scan_open_target', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở profile friends'),
    jsonb_build_object('id', 'node-scroll', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_profile_friends_scroll'), 'blockName', 'fb_scan_profile_friends_scroll', 'position', jsonb_build_object('x', 260, 'y', 0), 'config', '{}'::jsonb, 'label', 'Cuộn danh sách'),
    jsonb_build_object('id', 'node-extract', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_profile_friends_extract'), 'blockName', 'fb_scan_profile_friends_extract', 'position', jsonb_build_object('x', 520, 'y', 0), 'config', '{}'::jsonb, 'label', 'Đọc bạn bè profile'),
    jsonb_build_object('id', 'node-summary', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_contacts_summary'), 'blockName', 'fb_scan_contacts_summary', 'position', jsonb_build_object('x', 780, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tổng kết')
  ),
  '[
    {"id":"e-open-scroll","source":"node-open","target":"node-scroll"},
    {"id":"e-scroll-extract","source":"node-scroll","target":"node-extract"},
    {"id":"e-extract-summary","source":"node-extract","target":"node-summary"}
  ]'::jsonb,
  '[
    {"name":"targetUrl","type":"string","label":"Profile friends URL"},
    {"name":"profileUrl","type":"string","label":"Profile URL"},
    {"name":"sourceProfileUrl","type":"string","label":"Source profile URL"},
    {"name":"sourceProfileUid","type":"string","label":"Source profile UID"},
    {"name":"contactType","type":"string","label":"Contact type","default":"person"},
    {"name":"maxFriends","type":"number","label":"Số lượng","default":1000},
    {"name":"scrollDelayMs","type":"number","label":"Scroll delay","default":1500},
    {"name":"friendGrowthTimeoutMs","type":"number","label":"Growth timeout","default":10000}
  ]'::jsonb,
  '{"targetUrl":"","profileUrl":"","sourceProfileUrl":"","sourceProfileUid":"","contactType":"person","maxFriends":1000,"scrollDelayMs":1500,"friendGrowthTimeoutMs":10000}'::jsonb,
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
