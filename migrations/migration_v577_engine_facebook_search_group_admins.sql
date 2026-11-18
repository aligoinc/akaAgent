-- V577: "Tìm kiếm data bằng search" (Facebook) lấy thêm thông tin quản trị viên của từng group tìm được: tên, link trang cá nhân, SĐT, email.
-- Chỉ workflow engine 319: thêm block "[engine] fb_collect_search_group_admins" + node collect_group_admins giữa "Tải group" và "Tổng kết"; block tổng kết
-- 2910 cho admins / adminScan của từng group đi qua. Block mới chỉ chạy khi app gửi vars.isFindFacebookGroupAdmins = true (Desktop có ô chọn);
-- app chưa có ô chọn chạy như trước. Bộ cũ (workflow 239, block tìm group / tổng kết của bộ cũ) không đổi.
-- SINH TỪ scripts/build-v577-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v577-live-20261118.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc workflow / block mỗi lượt. Block mới không phải mốc gửi nên không có dòng
-- danh mục bước (engine coi là bước đọc). Gỡ: rollback_v577_engine_facebook_search_group_admins.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v577_%') THEN
      RAISE EXCEPTION 'V577 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_workflows') IS NULL THEN RAISE EXCEPTION 'V577 cần V556–V560 (workflow engine Facebook)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_workflows WHERE purpose = 'facebook_find_data_search' AND workflow_id = 319) THEN
    RAISE EXCEPTION 'V577: workflow engine của facebook_find_data_search không còn là 319';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_workflows w
   WHERE w.id = 319 AND w.name = '[engine] [Built-in] Facebook - Tìm kiếm data bằng search' AND md5(w.nodes::text || w.edges::text) = 'ef59b75906fb45bbb8cac5b737901823'
     AND md5(w.variables_schema::text || w.default_variables::text) = '3a413a6c107f8d02fe52bc2bff5b43c5';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V577: workflow 319 khác bản đã đọc (md5 ef59b75906fb45bbb8cac5b737901823), đọc lại và sinh lại'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2910 AND name = '[engine] fb_find_search_data_summary' AND md5(code) = 'c78abe7a868cedbd8db485278d109ba7') THEN
    RAISE EXCEPTION 'V577: block tổng kết 2910 khác bản đã đọc (md5 c78abe7a868cedbd8db485278d109ba7), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2909 AND name = '[engine] fb_collect_search_groups') THEN
    RAISE EXCEPTION 'V577: không thấy block tải group 2909';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = '[engine] fb_collect_search_group_admins') THEN
    RAISE EXCEPTION 'V577: đã có block "[engine] fb_collect_search_group_admins" (lần chạy trước để lại?), dọn trước rồi chạy lại';
  END IF;
END $pre$;

-- 1. Block mới (chỉ đọc trang, không phải mốc gửi).
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] fb_collect_search_group_admins', 'Mở trang quản trị viên của từng group vừa tìm được và trang cá nhân từng quản trị viên để lấy tên, link, SĐT, email.',
        'UserCog', 'facebook', 'js', $v577_block$
  // Lấy thông tin quản trị viên của các group vừa tìm được bằng search (chỉ chạy khi chiến dịch bật vars.isFindFacebookGroupAdmins).
  // Mỗi group: mở /groups/<nhóm>/members/admins đọc danh sách, rồi mở trang cá nhân từng quản trị viên (?sk=directory_contact_info) đọc tên,
  // dòng giới thiệu dưới tên và mục "Thông tin liên hệ" để tách SĐT / email. Chỉ đọc trang, không bấm gì trên Facebook.
  // Kết quả gắn vào từng group của vars.findDataSearchGroups: admins (mảng) và adminScan ('listed' | 'not_listed' | 'failed').
  // Sinh từ scripts/facebook-search-groups/*.fragment.js, không sửa tay trong DB.
  if (!vars.findDataSearchHasGroup || vars.isFindFacebookGroupAdmins !== true) return { skipped: true, reason: 'Không bật lấy thông tin quản trị viên group' };

  const keyword = String(vars.findDataSearchKeyword || '').trim();
  function groupKey(url) { return String(url || '').replace(/\/+$/g, '').toLowerCase(); }
  function randomMs(minMs, maxMs) { return minMs + Math.floor(Math.random() * (maxMs - minMs + 1)); }
  function errorText(err) { return String(err && err.message ? err.message : err).slice(0, 300); }
  const allGroups = (Array.isArray(vars.findDataSearchGroups) ? vars.findDataSearchGroups : []).filter(group => group && typeof group === 'object' && group.url);
  // Group đã có ở các lượt chạy trước của cùng từ khoá (app gửi kèm) không đọc lại: app chỉ lưu group mới của mỗi lượt.
  const knownKeys = new Set((Array.isArray(vars.findDataAdminSkipGroupKeys) ? vars.findDataAdminSkipGroupKeys : []).map(groupKey).filter(Boolean));
  const groups = allGroups.filter(group => !knownKeys.has(groupKey(group.url)));
  if (groups.length === 0) return { skipped: true, reason: 'Không có group mới để lấy quản trị viên', groupCount: 0, knownGroupCount: allGroups.length };

  const ADMINS_PAGE_SCRIPT = String.raw`function normalizePhone(value) {
  let digits = String(value || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  return /^0[35789]\d{8}$/.test(digits) ? digits : '';
}
function findPhones(text) {
  const matches = String(text || '').match(/(?<![\d+])(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}(?!\d)/g) || [];
  return Array.from(new Set(matches.map(normalizePhone).filter(Boolean)));
}
function findEmails(text) {
  const matches = String(text || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g) || [];
  return Array.from(new Set(matches.map(value => value.replace(/[.\-]+$/g, '').toLowerCase()).filter(value => /\.[a-z]{2,}$/.test(value))));
}
const maxWaitMs = Number(__args[0]) || 45000;
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
const ADMIN_LABELS = ['quản trị viên', 'admin'];
const MODERATOR_LABELS = ['người kiểm duyệt', 'moderator'];
function profileOf(item) {
  for (const link of item.querySelectorAll('a[href]')) {
    let url;
    try { url = new URL(link.getAttribute('href') || '', location.href); } catch (error) { continue; }
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) continue;
    const label = norm(link.getAttribute('aria-label'));
    const scoped = url.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)\/?$/);
    if (scoped) return { uid: scoped[1], label };
    const id = url.searchParams.get('id') || '';
    if (url.pathname === '/profile.php' && /^\d+$/.test(id)) return { uid: id, label };
  }
  return null;
}
function read() {
  const main = document.querySelector('[role="main"]') || document.body;
  const people = [];
  const seen = new Set();
  let avatarOnly = 0;
  for (const item of main.querySelectorAll('[role="listitem"]')) {
    const lines = String(item.innerText || '').split('\n').map(norm).filter(Boolean);
    if (lines.length === 0) { if (item.querySelector('a[href] svg, a[href] img')) avatarOnly += 1; continue; }
    const lower = lines.map(line => line.toLowerCase());
    const role = lower.some(line => ADMIN_LABELS.includes(line)) ? 'admin' : lower.some(line => MODERATOR_LABELS.includes(line)) ? 'moderator' : '';
    if (!role) continue;
    const profile = profileOf(item);
    if (!profile || seen.has(profile.uid)) continue;
    seen.add(profile.uid);
    const name = profile.label || lines[0];
    people.push({ uid: profile.uid, name, role, phones: findPhones(name), emails: findEmails(name), rowText: lines.join(' | ').slice(0, 300) });
  }
  let expected = 0;
  for (const heading of main.querySelectorAll('h2, h3, [role="heading"]')) {
    const text = norm(heading.innerText || heading.textContent);
    if (!/quản trị viên|admin/i.test(text)) continue;
    const match = text.match(/·\s*([\d.,]+)\s*$/);
    if (match) { expected = Number(match[1].replace(/[.,]/g, '')) || 0; break; }
  }
  return { people, expected, avatarOnly };
}
const startedAt = Date.now();
let state = read();
let stable = 0;
while (Date.now() - startedAt < maxWaitMs && stable < 3) {
  if (state.expected > 0 && state.people.length >= state.expected) break;
  if (state.people.length === 0 && state.avatarOnly > 0 && Date.now() - startedAt > 4000) break;
  const before = state.people.length;
  window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
  await delay(1800);
  state = read();
  stable = state.people.length > before ? 0 : stable + 1;
}
const mainText = norm((document.querySelector('[role="main"]') || document.body).innerText).slice(0, 400);
return {
  listed: state.people.length > 0,
  people: state.people,
  expected: state.expected,
  avatarOnly: state.avatarOnly,
  path: location.pathname,
  pageText: state.people.length > 0 ? '' : mainText
};`;
  const PROFILE_PAGE_SCRIPT = String.raw`function normalizePhone(value) {
  let digits = String(value || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  return /^0[35789]\d{8}$/.test(digits) ? digits : '';
}
function findPhones(text) {
  const matches = String(text || '').match(/(?<![\d+])(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}(?!\d)/g) || [];
  return Array.from(new Set(matches.map(normalizePhone).filter(Boolean)));
}
function findEmails(text) {
  const matches = String(text || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g) || [];
  return Array.from(new Set(matches.map(value => value.replace(/[.\-]+$/g, '').toLowerCase()).filter(value => /\.[a-z]{2,}$/.test(value))));
}
const maxWaitMs = Number(__args[0]) || 9000;
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function linesOf(element) { return String((element && element.innerText) || '').split('\n').map(norm).filter(Boolean); }
function unique(values) { return Array.from(new Set(values)); }
function read() {
  const main = document.querySelector('[role="main"]') || document.body;
  const lists = Array.from(main.querySelectorAll('[role="tablist"]'));
  let headerLines = [];
  for (let element = lists[0]; element && element !== main; element = element.parentElement) {
    let lines = [];
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) lines = linesOf(sibling).concat(lines);
    if (lines.length > 0) { headerLines = lines; break; }
  }
  const nav = lists.find(list => list.querySelector('a[href*="directory_"]')) || null;
  const contactLink = nav ? nav.querySelector('a[href*="directory_contact_info"]') : null;
  const contactSelected = !!contactLink && contactLink.getAttribute('aria-selected') === 'true';
  let contactLines = [];
  if (contactSelected) {
    let element = nav;
    for (let level = 0; level < 4 && element && element !== main; level += 1) {
      const parent = element.parentElement;
      if (!parent) break;
      if (level >= 1) {
        const lines = [];
        for (const child of parent.children) { if (child !== element) lines.push(...linesOf(child)); }
        if (lines.length > 0) { contactLines = lines; break; }
      }
      element = parent;
    }
  }
  return { hasTabs: lists.length > 0, headerLines, hasNav: !!nav, hasContactSection: !!contactLink, contactSelected, contactLines };
}
const startedAt = Date.now();
let state = read();
while (Date.now() - startedAt < maxWaitMs) {
  const ready = state.hasTabs && state.headerLines.length > 0 && state.hasNav && (!state.contactSelected || state.contactLines.length > 0);
  if (ready) break;
  await delay(500);
  state = read();
}
const headerText = state.headerLines.slice(0, 20).join('\n').slice(0, 1500);
const contactText = state.contactLines.slice(0, 40).join('\n').slice(0, 1500);
const contactPhones = findPhones(contactText);
const contactEmails = findEmails(contactText);
const headerPhones = findPhones(headerText);
const headerEmails = findEmails(headerText);
const segments = location.pathname.split('/').filter(Boolean);
const first = String(segments[0] || '').toLowerCase();
const vanity = segments.length > 0 && !['profile.php', 'people', 'groups', 'checkpoint', 'login', 'login.php'].includes(first) && /^[a-z0-9.\-_]+$/i.test(segments[0]) ? segments[0] : '';
return {
  available: state.hasTabs && state.headerLines.length > 0,
  blocked: first === 'checkpoint' || first === 'login' || first === 'login.php',
  name: state.headerLines[0] || '',
  vanity,
  headerText,
  hasContactSection: state.hasContactSection,
  contactText,
  phones: unique(contactPhones.concat(headerPhones)),
  emails: unique(contactEmails.concat(headerEmails)),
  contactPhones,
  contactEmails,
  pageText: state.hasTabs ? '' : norm((document.querySelector('[role="main"]') || document.body).innerText).slice(0, 300)
};`;

  if (!vars.findDataAdminProfileCache || typeof vars.findDataAdminProfileCache !== 'object') vars.findDataAdminProfileCache = {};
  const profileCache = vars.findDataAdminProfileCache;
  const resultGroups = vars.findDataResults && Array.isArray(vars.findDataResults.facebookGroups) ? vars.findDataResults.facebookGroups : [];
  function saveGroup(group, adminScan, admins) {
    group.adminScan = adminScan;
    group.admins = admins;
    const key = groupKey(group.url);
    for (const other of resultGroups) {
      if (other && other !== group && groupKey(other.url) === key) { other.adminScan = adminScan; other.admins = admins; }
    }
  }
  function isLoginPath(pathname) { return /^\/(?:checkpoint|login|login\.php)(?:\/|$)/i.test(String(pathname || '')); }

  const totals = { groups: groups.length, listed: 0, notListed: 0, failed: 0, admins: 0, withPhone: 0, withEmail: 0, profilesOpened: 0 };
  const events = [];
  let stopReason = '';
  let groupFailures = 0;
  let profileFailures = 0;

  async function readProfile(person) {
    if (profileCache[person.uid]) return profileCache[person.uid];
    if (stopReason) return null;
    let profile = null;
    try {
      await page.navigate('https://www.facebook.com/profile.php?id=' + person.uid + '&sk=directory_contact_info');
      await helpers.sleep(randomMs(2500, 4500), signal);
      await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => false);
      const read = await page.evaluate(PROFILE_PAGE_SCRIPT, 9000);
      totals.profilesOpened += 1;
      if (read && read.blocked) { stopReason = 'Facebook chuyển sang trang đăng nhập / xác minh khi mở trang cá nhân'; return null; }
      if (read && read.available) {
        profileFailures = 0;
        profile = { read: true, vanity: String(read.vanity || ''), phones: Array.isArray(read.phones) ? read.phones : [], emails: Array.isArray(read.emails) ? read.emails : [], hasContactSection: read.hasContactSection === true };
      } else {
        profile = { read: false, vanity: '', phones: [], emails: [], hasContactSection: false };
      }
    } catch (err) {
      if (signal && signal.aborted) throw err;
      profileFailures += 1;
      if (profileFailures >= 3) stopReason = 'Không mở được trang cá nhân 3 lần liên tiếp: ' + errorText(err);
      return null;
    }
    profileCache[person.uid] = profile;
    return profile;
  }

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const groupName = String(group.name || group.url);
    if (stopReason) {
      saveGroup(group, 'failed', []);
      totals.failed += 1;
      continue;
    }
    const adminsUrl = String(group.url).replace(/\/+$/g, '') + '/members/admins';
    let listed = null;
    let failure = '';
    try {
      await page.navigate(adminsUrl);
      await helpers.sleep(randomMs(3000, 5000), signal);
      await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => false);
      listed = await page.evaluate(ADMINS_PAGE_SCRIPT, 45000);
    } catch (err) {
      if (signal && signal.aborted) throw err;
      failure = errorText(err);
    }
    if (listed && isLoginPath(listed.path)) stopReason = 'Facebook chuyển sang trang đăng nhập / xác minh khi mở trang quản trị viên của group';
    if (stopReason || !listed || listed.listed !== true) {
      const notListed = !stopReason && !!listed && Number(listed.avatarOnly || 0) > 0;
      saveGroup(group, notListed ? 'not_listed' : 'failed', []);
      if (notListed) { totals.notListed += 1; groupFailures = 0; } else {
        totals.failed += 1;
        groupFailures += 1;
        if (!stopReason && groupFailures >= 3) stopReason = 'Không đọc được trang quản trị viên của 3 group liên tiếp';
      }
      events.push({
        eventType: 'extract_facebook_group_admins', eventName: 'Lấy quản trị viên group Facebook', targetType: 'group', status: notListed ? 'skipped' : 'failed',
        isUserVisible: true, itemIndex: index + 1, targetUrl: group.url,
        message: notListed
          ? 'Group "' + groupName + '": Facebook không hiện danh sách quản trị viên của group riêng tư khi chưa tham gia'
          : 'Group "' + groupName + '": chưa đọc được danh sách quản trị viên',
        debugData: { searchKeyword: keyword, adminScan: notListed ? 'not_listed' : 'failed', adminsUrl, avatarOnly: listed ? Number(listed.avatarOnly || 0) : 0, pageText: listed ? String(listed.pageText || '') : '', error: failure || stopReason }
      });
      continue;
    }
    groupFailures = 0;
    const people = (Array.isArray(listed.people) ? listed.people : []).filter(person => person && person.role === 'admin' && /^\d+$/.test(String(person.uid || '')));
    const admins = [];
    for (const person of people) {
      const profile = await readProfile(person);
      const listPhones = Array.isArray(person.phones) ? person.phones : [];
      const listEmails = Array.isArray(person.emails) ? person.emails : [];
      const phones = Array.from(new Set((profile ? profile.phones : []).concat(listPhones)));
      const emails = Array.from(new Set((profile ? profile.emails : []).concat(listEmails)));
      admins.push({
        uid: String(person.uid),
        name: String(person.name || '').slice(0, 200),
        url: profile && profile.vanity ? 'https://www.facebook.com/' + profile.vanity : 'https://www.facebook.com/profile.php?id=' + person.uid,
        role: 'admin',
        phones,
        emails,
        profileRead: !!(profile && profile.read)
      });
    }
    saveGroup(group, 'listed', admins);
    totals.listed += 1;
    totals.admins += admins.length;
    const withPhone = admins.filter(admin => admin.phones.length > 0).length;
    const withEmail = admins.filter(admin => admin.emails.length > 0).length;
    totals.withPhone += withPhone;
    totals.withEmail += withEmail;
    const parts = [admins.length + ' quản trị viên'];
    if (withPhone > 0) parts.push(withPhone + ' người có số điện thoại');
    if (withEmail > 0) parts.push(withEmail + ' người có email');
    events.push({
      eventType: 'extract_facebook_group_admins', eventName: 'Lấy quản trị viên group Facebook', targetType: 'group', status: 'success',
      isUserVisible: true, itemIndex: index + 1, targetUrl: group.url, elementCount: admins.length,
      message: 'Group "' + groupName + '": ' + parts.join(', '),
      debugData: { searchKeyword: keyword, adminScan: 'listed', adminsUrl, expected: Number(listed.expected || 0), listedPeople: Array.isArray(listed.people) ? listed.people.length : 0, admins }
    });
  }

  helpers.log('Đã lấy ' + totals.admins + ' quản trị viên của ' + totals.listed + '/' + totals.groups + ' group' + (stopReason ? ' (dừng sớm: ' + stopReason + ')' : ''));
  await helpers.logRunEvents(events);
  await helpers.logRunEvent({
    eventType: 'collect_facebook_group_admins', eventName: 'Lấy quản trị viên các group Facebook', targetType: 'group', status: stopReason ? 'failed' : 'success',
    isUserVisible: true, elementCount: totals.admins,
    message: 'Lấy được ' + totals.admins + ' quản trị viên của ' + totals.listed + '/' + totals.groups + ' group' + (totals.notListed > 0 ? ', ' + totals.notListed + ' group riêng tư chưa tham gia nên Facebook không hiện danh sách' : '') + (totals.failed > 0 ? ', ' + totals.failed + ' group chưa đọc được' : ''),
    debugData: Object.assign({ searchKeyword: keyword, knownGroupCount: allGroups.length - groups.length, stopReason }, totals)
  });
  return Object.assign({ skipped: false, stopReason }, totals);
$v577_block$, '[]'::jsonb, '[{"label":"Số group đã đọc","name":"listed","type":"number"},{"label":"Số quản trị viên","name":"admins","type":"number"}]'::jsonb, '{}'::jsonb, true);

-- 2. Workflow: node mới giữa "Tải group" và "Tổng kết", biến isFindFacebookGroupAdmins (mặc định tắt).
UPDATE public.auto_workflows w
   SET nodes = w.nodes || jsonb_build_array(jsonb_build_object(
         'id', 'collect_group_admins', 'blockId', b.id, 'blockName', 'fb_collect_search_group_admins', 'config', '{}'::jsonb,
         'label', 'Lấy quản trị viên group', 'position', '{"x":2470,"y":160}'::jsonb)),
       edges = (SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality), '[]'::jsonb)
                  FROM jsonb_array_elements(w.edges) WITH ORDINALITY e WHERE e.value->>'id' <> 'e-collect-groups-summary')
               || '[{"id":"e-collect-groups-admins","source":"collect_groups","target":"collect_group_admins"},{"id":"e-group-admins-summary","source":"collect_group_admins","target":"summary"}]'::jsonb,
       variables_schema = w.variables_schema || '[{"default":false,"label":"Lấy thông tin quản trị viên của group","name":"isFindFacebookGroupAdmins","type":"boolean"}]'::jsonb,
       default_variables = w.default_variables || '{"isFindFacebookGroupAdmins":false}'::jsonb,
       updated_at = now()
  FROM public.auto_blocks b
 WHERE w.id = 319 AND b.name = '[engine] fb_collect_search_group_admins' AND md5(w.nodes::text || w.edges::text) = 'ef59b75906fb45bbb8cac5b737901823';

-- 3. Block tổng kết: giữ admins / adminScan của từng group.
UPDATE public.auto_blocks SET code = $v577_block$  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function uniqueGroups(rawGroups) { const map = new Map(); for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) { if (!rawGroup || typeof rawGroup !== 'object') continue; const url = String(rawGroup.url || '').trim(); const key = url.replace(/\/+$/g, '').toLowerCase(); if (!url || !key || map.has(key)) continue; map.set(key, { url, name: String(rawGroup.name || '').trim(), privacy: String(rawGroup.privacy || '').trim(), memberCount: Number(rawGroup.memberCount || 0), postsPerDay: Number(rawGroup.postsPerDay || 0), keyword: String(rawGroup.keyword || vars.findDataSearchKeyword || '').trim(), ...(typeof rawGroup.adminScan === 'string' && rawGroup.adminScan ? { adminScan: rawGroup.adminScan, admins: Array.isArray(rawGroup.admins) ? rawGroup.admins : [] } : {}) }); } return Array.from(map.values()); }
  function uniqueUidProfiles(arr, allowedUids) { const allowed = new Set(unique(allowedUids)); const map = new Map(); for (const item of Array.isArray(arr) ? arr : []) { if (!item || typeof item !== 'object') continue; const uid = String(item.uid || '').trim(); if (!uid || !allowed.has(uid)) continue; const current = map.get(uid) || { uid, name: '', url: '', source: '' }; map.set(uid, { uid, name: current.name || String(item.name || '').trim(), url: current.url || String(item.url || '').trim(), source: current.source || String(item.source || '').trim() }); } return Array.from(map.values()); }
  function uniquePhoneProfiles(arr, allowedPhones) { const allowed = new Set(unique(allowedPhones).map(phone => phone.toLowerCase())); const map = new Map(); for (const item of Array.isArray(arr) ? arr : []) { if (!item || typeof item !== 'object') continue; const phone = String(item.phone || '').trim(); const key = phone.toLowerCase(); if (!phone || !allowed.has(key)) continue; const current = map.get(key) || { phone, name: '', uid: '', url: '', source: '' }; map.set(key, { phone: current.phone || phone, name: current.name || String(item.name || '').trim(), uid: current.uid || String(item.uid || '').trim(), url: current.url || String(item.url || '').trim(), source: current.source || String(item.source || '').trim() }); } return Array.from(map.values()); }
  function ensureSourceData(results) { if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {}; for (const key of ['post', 'comment']) { if (!results.sourceData[key] || typeof results.sourceData[key] !== 'object') results.sourceData[key] = {}; if (!Array.isArray(results.sourceData[key].phones)) results.sourceData[key].phones = []; if (!Array.isArray(results.sourceData[key].linkGroupZalos)) results.sourceData[key].linkGroupZalos = []; if (!Array.isArray(results.sourceData[key].uids)) results.sourceData[key].uids = []; } if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = []; if (!results.sourceData.facebookGroups || typeof results.sourceData.facebookGroups !== 'object') results.sourceData.facebookGroups = {}; if (!Array.isArray(results.sourceData.facebookGroups.groups)) results.sourceData.facebookGroups.groups = []; results.sourceData.post.phones = unique(results.sourceData.post.phones); results.sourceData.post.linkGroupZalos = unique(results.sourceData.post.linkGroupZalos); results.sourceData.post.uids = unique(results.sourceData.post.uids); results.sourceData.post.postLinks = unique(results.sourceData.post.postLinks); results.sourceData.comment.phones = unique(results.sourceData.comment.phones); results.sourceData.comment.linkGroupZalos = unique(results.sourceData.comment.linkGroupZalos); results.sourceData.comment.uids = unique(results.sourceData.comment.uids); results.sourceData.facebookGroups.groups = unique(results.sourceData.facebookGroups.groups); return results.sourceData; }
  const results = vars.findDataResults || {};
  const sourceData = ensureSourceData(results);
  const facebookGroups = uniqueGroups(results.facebookGroups || vars.findDataSearchGroups || []);
  sourceData.facebookGroups.groups = unique([...(sourceData.facebookGroups.groups || []), ...facebookGroups.map(group => group.url)]);
  const phones = unique(results.phones); const linkGroupZalos = unique(results.linkGroupZalos); const uids = unique(results.uids); const postLinks = unique(results.postLinks); const uidProfiles = uniqueUidProfiles(results.uidProfiles, uids); const phoneProfiles = uniquePhoneProfiles(results.phoneProfiles, phones);
  const sourceCounts = { post: { phones: sourceData.post.phones.length, linkGroupZalos: sourceData.post.linkGroupZalos.length, uids: sourceData.post.uids.length, postLinks: sourceData.post.postLinks.length }, comment: { phones: sourceData.comment.phones.length, linkGroupZalos: sourceData.comment.linkGroupZalos.length, uids: sourceData.comment.uids.length }, groupMembers: { uids: 0 }, newInteractors: { uids: 0 }, facebookGroups: { groups: sourceData.facebookGroups.groups.length } };
  const total = phones.length + linkGroupZalos.length + uids.length + postLinks.length + facebookGroups.length;
  const notes = [];
  if (vars.isFindPhone) notes.push('Đã tìm được ' + phones.length + ' số điện thoại');
  if (vars.isFindLinkGroupZalo) notes.push('Đã tìm được ' + linkGroupZalos.length + ' link group Zalo');
  if (vars.isFindUid) notes.push('Đã tìm được ' + uids.length + ' UID');
  if (vars.isFindPostLink) notes.push('Đã tìm được ' + postLinks.length + ' link bài post');
  if (vars.isFindFacebookGroup) notes.push('Đã tìm được ' + facebookGroups.length + ' link group Facebook');
  const message = notes.join(' - ') || 'Không có loại data nào được chọn';
  vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, uidProfiles, phoneProfiles, sourceData, sourceCounts };
  helpers.log(message);
  if (vars.findDataSearchHasPost || vars.findDataSearchHasGroup) {
    await helpers.logRunEvent({ eventType: 'find_data_source_summary', eventName: 'Tổng kết tìm data', targetType: 'summary', status: 'success', isUserVisible: true, elementCount: total, message, extractedData: { entity: { type: 'summary', url: '', name: String(vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || ''), uid: null, contentText: message }, filters: { keywordEnabled: false, keyword: null, matchedKeyword: null, aiPrompt: null, aiFinalPrompt: '', aiRawResult: '', aiCheckResult: '', aiMatched: null, aiReason: null, aiResult: null }, values: { phones, zaloGroupLinks: linkGroupZalos, postLinks, uids, facebookGroups: facebookGroups.map(group => group.url), uidProfiles, phoneProfiles } }, debugData: { searchKeyword: vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || '', sourceCounts, facebookGroups } });
  }
  return { ok: true, searchKeyword: vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || '', phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, uidProfiles, phoneProfiles, sourceCounts, total, message };
$v577_block$, updated_at = now()
 WHERE id = 2910 AND md5(code) = 'c78abe7a868cedbd8db485278d109ba7';

DO $post$
DECLARE v_block bigint; v_nodes jsonb; v_edges jsonb;
BEGIN
  SELECT id INTO v_block FROM public.auto_blocks WHERE name = '[engine] fb_collect_search_group_admins' AND md5(code) = '8c90de2814e6dd273251c89d3c6e6a90';
  IF v_block IS NULL THEN RAISE EXCEPTION 'V577 postflight: không thấy block mới đúng code (md5 8c90de2814e6dd273251c89d3c6e6a90)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2910 AND md5(code) = '0c15da28a84eaad80cb4169f088c56b6') THEN
    RAISE EXCEPTION 'V577 postflight: block tổng kết 2910 không phải bản mới (md5 0c15da28a84eaad80cb4169f088c56b6)';
  END IF;
  SELECT nodes, edges INTO v_nodes, v_edges FROM public.auto_workflows WHERE id = 319;
  IF jsonb_array_length(v_nodes) <> 25 OR jsonb_array_length(v_edges) <> 28 THEN
    RAISE EXCEPTION 'V577 postflight: workflow 319 có % node / % cạnh, cần 25 / 28', jsonb_array_length(v_nodes), jsonb_array_length(v_edges);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_nodes) n WHERE n->>'id' = 'collect_group_admins' AND (n->>'blockId')::bigint = v_block
                    AND jsonb_typeof(n->'blockId') = 'number') THEN
    RAISE EXCEPTION 'V577 postflight: node collect_group_admins không trỏ tới block mới';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'collect_groups' AND e->>'target' = 'summary')
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE (e->>'source' = 'collect_groups' AND e->>'target' = 'collect_group_admins')
           OR (e->>'source' = 'collect_group_admins' AND e->>'target' = 'summary')) <> 2
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'collect_groups') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'target' = 'summary') <> 1 THEN
    RAISE EXCEPTION 'V577 postflight: cạnh quanh node collect_group_admins không đúng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = 319 AND w.default_variables->'isFindFacebookGroupAdmins' = 'false'::jsonb
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.variables_schema) v WHERE v->>'name' = 'isFindFacebookGroupAdmins')) THEN
    RAISE EXCEPTION 'V577 postflight: workflow 319 chưa có biến isFindFacebookGroupAdmins';
  END IF;
  -- Bộ cũ không được đổi.
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows WHERE id = 239 AND md5(nodes::text || edges::text) = 'a7159797e8b002fe486af069026850dc')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.source_block_id = b.id
                     WHERE c.engine_block_id = 2910 AND md5(b.code) = 'c78abe7a868cedbd8db485278d109ba7') THEN
    RAISE EXCEPTION 'V577 postflight: workflow / block bộ cũ đã đổi (V577 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
