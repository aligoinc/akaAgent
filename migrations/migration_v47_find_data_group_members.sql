-- Add group member UID extraction to facebook_find_data_group.
-- Built-in workflow/block/element rows live in Supabase and are updated by name.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('fb_group_member_link', '//*[@role=''main'']//*[@class=''xt0psk2'']//a[@tabindex=''0'']', 'Link thành viên trong trang /members của group Facebook', 'facebook', true, NULL, NULL, now())
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

UPDATE public.auto_blocks
SET
  code = $block$
const raw = String(vars.targetUrl || vars.inputDataUid || input.raw || '').trim();
if (!raw) throw new Error('Thiếu link hoặc UID group');

function normalizeGroupUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || /^(www\.)?facebook\.com\//i.test(trimmed)) {
    const urlText = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed.replace(/^https?:\/\//i, '');
    try {
      const url = new URL(urlText);
      const parts = url.pathname.split('/').filter(Boolean);
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups');
      if (groupIndex >= 0 && parts[groupIndex + 1]) {
        return 'https://www.facebook.com/groups/' + parts[groupIndex + 1];
      }
      url.hash = '';
      url.search = '';
      return url.href.replace(/\/+$/g, '');
    } catch {}
  }

  const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] && parts[0].toLowerCase() === 'groups' && parts[1]) {
    return 'https://www.facebook.com/groups/' + parts[1];
  }
  return 'https://www.facebook.com/groups/' + cleaned;
}

const groupUrl = normalizeGroupUrl(raw);
vars.findDataGroupUrl = groupUrl;

const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true;
if (!needsFeed) {
  return { groupUrl, skippedFeed: true };
}

helpers.log('Mở group ' + (String(vars.inputDataName || '').trim() || groupUrl));

await page.navigate(groupUrl);
await helpers.sleep(5000, signal);

try {
  const discussionTab = await helpers.element('fb_group_discussion_tab');
  if (await page.$(discussionTab)) {
    await page.click(discussionTab);
    await helpers.sleep(2000, signal);
  }
} catch {}

return { groupUrl };
$block$,
  updated_at = now()
WHERE name = 'fb_open_group_discussion';

UPDATE public.auto_blocks
SET
  code = $block$
const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true;
if (!needsFeed) return { postSort: String(vars.sortTypePost || input.sortTypePost || 'most_relevant'), skippedFeed: true };

const sortType = String(vars.sortTypePost || input.sortTypePost || 'most_relevant');
if (sortType === 'most_relevant') return { postSort: sortType };

try {
  const sortButton = await helpers.element('fb_most_relevant_btn');
  if (await page.$(sortButton)) {
    await page.click(sortButton);
    await helpers.sleep(1000, signal);
    const optionName = sortType === 'new_posts' ? 'fb_new_post_btn' : 'fb_recent_activity_post_btn';
    const option = await helpers.element(optionName);
    if (await page.$(option)) {
      await page.click(option);
      await helpers.sleep(2500, signal);
    }
  }
} catch (err) {
  helpers.log('Không đổi được sắp xếp bài viết: ' + (err && err.message ? err.message : String(err)));
}

return { postSort: sortType };
$block$,
  updated_at = now()
WHERE name = 'fb_sort_group_posts';

UPDATE public.auto_blocks
SET
  code = replace(
    code,
    'const selectors = {',
    $prefix$const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true;
if (!needsFeed) {
  vars.findDataPosts = [];
  return { posts: [], skippedFeed: true };
}

const selectors = {$prefix$
  ),
  updated_at = now()
WHERE name = 'fb_collect_group_posts'
  AND code NOT LIKE '%skippedFeed: true%';

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_open_group_members',
  'Mở trang danh sách thành viên của group Facebook.',
  'UsersRound',
  'facebook',
  'js',
  NULL,
$block$
if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { memberPageUrl: '', skippedMembers: true };
}

const raw = String(vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || input.groupUrl || '').trim();
if (!raw) throw new Error('Thiếu link hoặc UID group');

function normalizeGroupUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || /^(www\.)?facebook\.com\//i.test(trimmed)) {
    const urlText = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed.replace(/^https?:\/\//i, '');
    try {
      const url = new URL(urlText);
      const parts = url.pathname.split('/').filter(Boolean);
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups');
      if (groupIndex >= 0 && parts[groupIndex + 1]) {
        return 'https://www.facebook.com/groups/' + parts[groupIndex + 1];
      }
      url.hash = '';
      url.search = '';
      return url.href.replace(/\/+$/g, '');
    } catch {}
  }

  const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] && parts[0].toLowerCase() === 'groups' && parts[1]) {
    return 'https://www.facebook.com/groups/' + parts[1];
  }
  return 'https://www.facebook.com/groups/' + cleaned;
}

const groupUrl = normalizeGroupUrl(raw);
const memberPageUrl = groupUrl.replace(/\/+$/g, '') + '/members';
vars.findDataGroupUrl = groupUrl;
vars.findDataGroupMembersUrl = memberPageUrl;

helpers.log('Mở danh sách thành viên group ' + (String(vars.inputDataName || '').trim() || groupUrl));
await page.navigate(memberPageUrl);
await helpers.sleep(5000, signal);

return { groupUrl, memberPageUrl };
$block$,
  '[]'::jsonb,
  '[{"name":"groupUrl","type":"string","label":"Group URL"},{"name":"memberPageUrl","type":"string","label":"Member page URL"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_collect_group_members',
  'Cuộn trang thành viên group và lấy UID user Facebook.',
  'UserRoundSearch',
  'facebook',
  'js',
  NULL,
$block$
if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { members: [], uids: [], skippedMembers: true };
}

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = { phones: [], linkGroupZalos: [], uids: [], postLinks: [] };
  }
  if (!Array.isArray(vars.findDataResults.phones)) vars.findDataResults.phones = [];
  if (!Array.isArray(vars.findDataResults.linkGroupZalos)) vars.findDataResults.linkGroupZalos = [];
  if (!Array.isArray(vars.findDataResults.uids)) vars.findDataResults.uids = [];
  if (!Array.isArray(vars.findDataResults.postLinks)) vars.findDataResults.postLinks = [];
  if (!Array.isArray(vars.findDataResults.groupMembers)) vars.findDataResults.groupMembers = [];
  return vars.findDataResults;
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

const selector = await helpers.element('fb_group_member_link');
const limit = Math.max(1, Number(vars.countGroupMemberFindData || input.countGroupMemberFindData || 100));

const members = await page.evaluate(`
  const selector = __args[0];
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

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractUserUid(href) {
    if (!href || !String(href).includes('/user/')) return '';
    try {
      const url = new URL(href, location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.findIndex(part => part.toLowerCase() === 'user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1].replace(/\\D/g, '') || parts[userIndex + 1];
      return '';
    } catch {
      const match = String(href || '').match(/\\/user\\/([^/?#]+)/i);
      return match ? match[1].replace(/\\D/g, '') || match[1] : '';
    }
  }

  function extractName(link) {
    if (!link) return '';
    const text = (link.innerText || link.textContent || '').trim();
    const firstLine = text.split('\\n').map(x => x.trim()).filter(Boolean)[0];
    if (firstLine) return firstLine;
    return String(link.getAttribute('aria-label') || link.getAttribute('title') || '').trim();
  }

  function isScrollable(el) {
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

  const rows = [];
  const rowByUid = new Map();

  function collectVisibleMembers() {
    const links = xpathAll(selector);
    for (const link of links) {
      const href = hrefOf(link);
      const uid = extractUserUid(href);
      if (!uid) continue;
      const name = extractName(link);
      if (!name) continue;
      const existing = rowByUid.get(uid);
      if (existing) {
        if (!existing.url && href) existing.url = href;
        continue;
      }
      const row = {
        uid,
        name,
        url: href
      };
      rowByUid.set(uid, row);
      rows.push(row);
      if (rows.length >= limit) break;
    }
    return links;
  }

  let links = collectVisibleMembers();
  let stableCount = 0;

  while (rows.length < limit && stableCount < 5) {
    const oldCount = rows.length;
    scrollForMore(links);
    await delay(2000);
    links = collectVisibleMembers();
    stableCount = rows.length <= oldCount ? stableCount + 1 : 0;
  }

  return rows.slice(0, limit);
`, selector, limit);

const memberRows = (Array.isArray(members) ? members : [])
  .filter(member => member && member.uid && String(member.name || '').trim());
const memberUids = unique(memberRows.map(member => member && member.uid));
const results = ensureResults();
results.uids = unique([...(results.uids || []), ...memberUids]);
results.groupMembers = memberRows;
vars.findDataGroupMembers = memberRows;

helpers.log('Đã lấy ' + memberUids.length + ' thành viên group');

return {
  members: memberRows,
  uids: memberUids
};
$block$,
  '[]'::jsonb,
  '[{"name":"members","type":"json","label":"Members"},{"name":"uids","type":"json","label":"UIDs"}]'::jsonb,
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

UPDATE public.auto_blocks
SET
  code = $block$
function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function uniqueMembers(arr) {
  const map = new Map();
  for (const raw of Array.isArray(arr) ? arr : []) {
    if (!raw || typeof raw !== 'object') continue;
    const uid = String(raw.uid || '').trim();
    const name = String(raw.name || '').trim();
    if (!uid || !name || map.has(uid)) continue;
    map.set(uid, {
      uid,
      name,
      url: String(raw.url || '').trim()
    });
  }
  return Array.from(map.values());
}

const results = vars.findDataResults || { phones: [], linkGroupZalos: [], uids: [], postLinks: [], groupMembers: [] };
const groupMembers = uniqueMembers(results.groupMembers || vars.findDataGroupMembers || []);
const phones = unique(results.phones);
const linkGroupZalos = unique(results.linkGroupZalos);
const uids = unique([...(results.uids || []), ...groupMembers.map(member => member.uid)]);
const postLinks = unique(results.postLinks);
const total = phones.length + linkGroupZalos.length + uids.length + postLinks.length;
const notes = [];
if (vars.isFindPhone) notes.push('Đã tìm được ' + phones.length + ' số điện thoại');
if (vars.isFindLinkGroupZalo) notes.push('Đã tìm được ' + linkGroupZalos.length + ' link group Zalo');
if (vars.isFindUid) notes.push('Đã tìm được ' + uids.length + ' UID');
if (vars.isFindPostLink) notes.push('Đã tìm được ' + postLinks.length + ' link bài post');
const message = notes.join(' - ') || 'Không có loại data nào được chọn';

vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers };
helpers.log(message);

return {
  ok: true,
  groupUrl: vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || '',
  phones,
  linkGroupZalos,
  uids,
  postLinks,
  groupMembers,
  total,
  message
};
$block$,
  output_schema = '[
    {"name":"phones","type":"json","label":"Phones"},
    {"name":"linkGroupZalos","type":"json","label":"Zalo links"},
    {"name":"uids","type":"json","label":"UIDs"},
    {"name":"postLinks","type":"json","label":"Post links"},
    {"name":"groupMembers","type":"json","label":"Group members"},
    {"name":"total","type":"number","label":"Total"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_find_group_data_summary';

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name IN (
    'fb_open_group_members',
    'fb_collect_group_members'
  )
)
UPDATE public.auto_workflows AS wf
SET
  nodes = (
    COALESCE((
      SELECT jsonb_agg(node.value ORDER BY node.ordinality)
      FROM jsonb_array_elements(COALESCE(wf.nodes, '[]'::jsonb)) WITH ORDINALITY AS node(value, ordinality)
      WHERE node.value->>'id' NOT IN ('node-open-members', 'node-collect-members')
    ), '[]'::jsonb)
    || jsonb_build_array(
      jsonb_build_object(
        'id', 'node-open-members',
        'blockId', (SELECT id FROM block_ids WHERE name = 'fb_open_group_members'),
        'blockName', 'fb_open_group_members',
        'position', jsonb_build_object('x', 1560, 'y', 180),
        'config', '{}'::jsonb,
        'label', 'Mở danh sách thành viên'
      ),
      jsonb_build_object(
        'id', 'node-collect-members',
        'blockId', (SELECT id FROM block_ids WHERE name = 'fb_collect_group_members'),
        'blockName', 'fb_collect_group_members',
        'position', jsonb_build_object('x', 1820, 'y', 180),
        'config', '{}'::jsonb,
        'label', 'Lấy thành viên group'
      )
    )
  ),
  edges = (
    COALESCE((
      SELECT jsonb_agg(edge.value ORDER BY edge.ordinality)
      FROM jsonb_array_elements(COALESCE(wf.edges, '[]'::jsonb)) WITH ORDINALITY AS edge(value, ordinality)
      WHERE edge.value->>'id' NOT IN (
        'e-extract-comments-summary',
        'e-extract-comments-open-members',
        'e-open-members-collect',
        'e-collect-members-summary'
      )
        AND NOT (
          edge.value->>'source' = 'node-extract-comments'
          AND edge.value->>'target' = 'node-summary'
        )
    ), '[]'::jsonb)
    || '[
      {"id":"e-extract-comments-open-members","source":"node-extract-comments","target":"node-open-members"},
      {"id":"e-open-members-collect","source":"node-open-members","target":"node-collect-members"},
      {"id":"e-collect-members-summary","source":"node-collect-members","target":"node-summary"}
    ]'::jsonb
  ),
  variables_schema = (
    COALESCE((
      SELECT jsonb_agg(variable.value ORDER BY variable.ordinality)
      FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) WITH ORDINALITY AS variable(value, ordinality)
      WHERE variable.value->>'name' NOT IN ('isFindInGroupMembers', 'countGroupMemberFindData')
    ), '[]'::jsonb)
    || '[
      {"name":"isFindInGroupMembers","type":"boolean","label":"Tìm thành viên group","default":false},
      {"name":"countGroupMemberFindData","type":"number","label":"Số thành viên tối đa","default":100}
    ]'::jsonb
  ),
  default_variables = COALESCE(wf.default_variables, '{}'::jsonb) || '{"isFindInPost": false, "isFindInGroupMembers": false, "countGroupMemberFindData": 100}'::jsonb,
  updated_at = now()
WHERE wf.name = '[Built-in] Facebook - Tìm kiếm data trong group';

COMMIT;
