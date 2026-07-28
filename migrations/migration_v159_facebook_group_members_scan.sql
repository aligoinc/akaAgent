-- Facebook DataScan: collect members of a single group.
-- Reuses the existing find-data group open block and uses a DataScan-specific
-- collect block so progress can be logged between scroll cycles.

BEGIN;

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_scan_collect_group_members',
  'Cuộn trang thành viên group và log số lượng realtime cho DataScan.',
  'UserRoundSearch',
  'facebook',
  'js',
  NULL,
$block$
if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { members: [], uids: [], skippedMembers: true };
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.groupMembers || typeof results.sourceData.groupMembers !== 'object') results.sourceData.groupMembers = {};
  if (!Array.isArray(results.sourceData.groupMembers.uids)) results.sourceData.groupMembers.uids = [];
  return results;
}

const selector = await helpers.element('fb_group_member_link');
const limit = Math.max(1, Math.floor(Number(vars.countGroupMemberFindData ?? input.countGroupMemberFindData ?? 1000)) || 1000);
const rows = [];
const rowByUid = new Map();
let stableCount = 0;

helpers.log('Bắt đầu cuộn danh sách thành viên group');

while (rows.length < limit && stableCount < 5) {
  const before = rows.length;
  const scan = await page.evaluate(`
    const selector = __args[0];

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

    function scrollForMore(links) {
      if (links.length > 0) {
        try { links[links.length - 1].scrollIntoView(true); } catch {}
      }
    }

    const links = xpathAll(selector);
    const members = [];
    for (const link of links) {
      const href = hrefOf(link);
      const uid = extractUserUid(href);
      if (!uid) continue;
      const name = extractName(link);
      if (!name) continue;
      members.push({ uid, name, url: href });
    }

    if (links.length > 0) {
      scrollForMore(links);
      try { window.scrollBy(0, 500); } catch {}
    }

    return { members, linkCount: links.length };
  `, selector);

  const visibleMembers = Array.isArray(scan?.members) ? scan.members : [];
  for (const member of visibleMembers) {
    if (!member || typeof member !== 'object') continue;
    const uid = String(member.uid || '').trim();
    const name = String(member.name || '').replace(/\s+/g, ' ').trim();
    if (!uid || !name) continue;
    const existing = rowByUid.get(uid);
    if (existing) {
      if (!existing.url && member.url) existing.url = String(member.url || '').trim();
      continue;
    }
    const row = { uid, name, url: String(member.url || '').trim() };
    rowByUid.set(uid, row);
    rows.push(row);
    if (rows.length >= limit) break;
  }

  const added = rows.length - before;
  helpers.log('Đã đọc ' + rows.length + ' thành viên group.');

  if (rows.length >= limit) break;
  stableCount = added > 0 ? 0 : stableCount + 1;
  await helpers.sleep(5000, signal);
}

const memberRows = rows.slice(0, limit);
const memberUids = unique(memberRows.map(member => member && member.uid));
const results = ensureResults();
results.uids = unique([...(results.uids || []), ...memberUids]);
results.groupMembers = memberRows;
results.sourceData.groupMembers.uids = unique([...(results.sourceData.groupMembers.uids || []), ...memberUids]);
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
),
(
  'fb_scan_extract_group_members',
  'Chuyển output fb_scan_collect_group_members thành contacts để DataScan lưu vào auto_account_contacts.',
  'UserRoundSearch',
  'facebook',
  'js',
  NULL,
$block$
const rawMembers = Array.isArray(vars.findDataGroupMembers)
  ? vars.findDataGroupMembers
  : Array.isArray(input.members)
    ? input.members
    : [];
const maxGroupMembers = Math.max(1, Math.floor(Number(vars.countGroupMemberFindData ?? input.countGroupMemberFindData ?? 1000)) || 1000);

function normalizeGroupUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (!/facebook\.com|fb\.com/i.test(raw)) {
    const cleaned = raw.replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/').filter(Boolean);
    const groupKey = parts[0] && parts[0].toLowerCase() === 'groups' && parts[1] ? parts[1] : cleaned;
    return /^[a-zA-Z0-9._-]+$/.test(groupKey || '')
      ? 'https://www.facebook.com/groups/' + groupKey
      : '';
  }

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    const host = url.hostname
      .replace(/^www\./i, '')
      .replace(/^web\./i, '')
      .replace(/^m\./i, '')
      .replace(/^mobile\./i, '')
      .replace(/^mbasic\./i, '')
      .toLowerCase();
    if (host !== 'facebook.com' && host !== 'fb.com') return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups');
    if (groupIndex < 0 || !parts[groupIndex + 1]) return '';
    const groupKey = decodeURIComponent(parts[groupIndex + 1] || '').trim();
    return groupKey && /^[a-zA-Z0-9._-]+$/.test(groupKey)
      ? 'https://www.facebook.com/groups/' + groupKey
      : '';
  } catch {
    return '';
  }
}

function extractGroupUid(groupUrl) {
  try {
    const url = new URL(groupUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups');
    return groupIndex >= 0 && parts[groupIndex + 1] ? parts[groupIndex + 1] : '';
  } catch {
    return '';
  }
}

function normalizeMemberUrl(uid, href) {
  const cleanUid = String(uid || '').trim();
  if (/^\d+$/.test(cleanUid)) return 'https://www.facebook.com/profile.php?id=' + cleanUid;
  const rawHref = String(href || '').trim();
  if (!rawHref) return '';
  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const host = url.hostname
      .replace(/^www\./i, '')
      .replace(/^web\./i, '')
      .replace(/^m\./i, '')
      .replace(/^mobile\./i, '')
      .replace(/^mbasic\./i, '')
      .toLowerCase();
    if (host !== 'facebook.com' && host !== 'fb.com') return rawHref;
    url.hostname = 'www.facebook.com';
    url.hash = '';
    return url.toString();
  } catch {
    return rawHref;
  }
}

const sourceGroupUrl = normalizeGroupUrl(vars.sourceGroupUrl || vars.findDataGroupUrl || vars.targetUrl || input.sourceGroupUrl || '');
const sourceGroupUid = String(vars.sourceGroupUid || extractGroupUid(sourceGroupUrl) || '').trim();
const contacts = [];
const seen = new Set();

for (const rawMember of rawMembers) {
  if (!rawMember || typeof rawMember !== 'object') continue;
  const uid = String(rawMember.uid || '').trim();
  const name = String(rawMember.name || '').replace(/\s+/g, ' ').trim();
  if (!uid || !name || seen.has(uid)) continue;
  seen.add(uid);

  const rawUrl = String(rawMember.url || '').trim();
  const url = normalizeMemberUrl(uid, rawUrl);
  contacts.push({
    name,
    uid,
    url,
    isFriend: null,
    extraData: {
      source: 'facebook_group_members',
      sources: ['facebook_group_members'],
      tag: 'Group member',
      sourceGroupUrl,
      sourceGroupUid,
      sourceGroupUrls: sourceGroupUrl ? [sourceGroupUrl] : [],
      rawGroupMemberUrl: rawUrl
    }
  });
  if (contacts.length >= maxGroupMembers) break;
}

vars.groupMemberContacts = contacts;
helpers.log('Đã đọc ' + contacts.length + ' thành viên group');

return { contacts };
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

DO $$
DECLARE
  missing_blocks text[];
BEGIN
  SELECT array_agg(name ORDER BY name)
  INTO missing_blocks
  FROM (
    VALUES
      ('fb_open_group_members'),
      ('fb_scan_collect_group_members'),
      ('fb_scan_extract_group_members'),
      ('fb_scan_contacts_summary')
  ) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.auto_blocks block
    WHERE block.name = required.name
  );

  IF missing_blocks IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required blocks for Facebook group members scan: %', missing_blocks;
  END IF;
END $$;

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name IN (
    'fb_open_group_members',
    'fb_scan_collect_group_members',
    'fb_scan_extract_group_members',
    'fb_scan_contacts_summary'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  '[Built-in] Facebook - Quét thành viên group',
  'Workflow quét thành viên của một group Facebook vào auto_account_contacts.',
  jsonb_build_array(
    jsonb_build_object('id', 'node-open-members', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_open_group_members'), 'blockName', 'fb_open_group_members', 'position', jsonb_build_object('x', 0, 'y', 0), 'config', '{}'::jsonb, 'label', 'Mở thành viên group'),
    jsonb_build_object('id', 'node-collect-members', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_collect_group_members'), 'blockName', 'fb_scan_collect_group_members', 'position', jsonb_build_object('x', 300, 'y', 0), 'config', '{}'::jsonb, 'label', 'Lấy thành viên group'),
    jsonb_build_object('id', 'node-extract', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_extract_group_members'), 'blockName', 'fb_scan_extract_group_members', 'position', jsonb_build_object('x', 600, 'y', 0), 'config', '{}'::jsonb, 'label', 'Chuẩn hoá data'),
    jsonb_build_object('id', 'node-summary', 'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scan_contacts_summary'), 'blockName', 'fb_scan_contacts_summary', 'position', jsonb_build_object('x', 900, 'y', 0), 'config', '{}'::jsonb, 'label', 'Tổng kết')
  ),
  '[
    {"id":"e-open-collect","source":"node-open-members","target":"node-collect-members"},
    {"id":"e-collect-extract","source":"node-collect-members","target":"node-extract"},
    {"id":"e-extract-summary","source":"node-extract","target":"node-summary"}
  ]'::jsonb,
  '[
    {"name":"targetUrl","type":"string","label":"Group members URL","default":""},
    {"name":"findDataGroupUrl","type":"string","label":"Group URL","default":""},
    {"name":"sourceGroupUrl","type":"string","label":"Source group URL","default":""},
    {"name":"sourceGroupUid","type":"string","label":"Source group UID","default":""},
    {"name":"contactType","type":"string","label":"Contact type","default":"person"},
    {"name":"isFindInGroupMembers","type":"boolean","label":"Find group members","default":true},
    {"name":"isFindUid","type":"boolean","label":"Find UID","default":true},
    {"name":"countGroupMemberFindData","type":"number","label":"Số lượng","default":1000}
  ]'::jsonb,
  '{"targetUrl":"","findDataGroupUrl":"","sourceGroupUrl":"","sourceGroupUid":"","contactType":"person","isFindInGroupMembers":true,"isFindUid":true,"countGroupMemberFindData":1000}'::jsonb,
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
