-- V578: block "[engine] fb_collect_search_group_admins" (lấy quản trị viên của group khi tìm group bằng search) lấy chỗ tìm phần tử trên trang từ bảng
-- auto_elements thay vì viết thẳng trong code: thêm 8 element (category facebook, built-in) và đổi code block. Hành vi không đổi so với V577.
-- Facebook đổi giao diện thì sửa XPath ở màn Cài đặt Workflow → Element. Chỉ workflow engine; bộ cũ không đổi.
-- SINH TỪ scripts/build-v578-sql.cjs, không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt;
-- element mới được app đọc lại khi gặp tên chưa có trong bộ nhớ đệm (elementV2Repository.resolveXpathByName). Gỡ: rollback_v578_engine_facebook_group_admin_elements.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v578_%') THEN
      RAISE EXCEPTION 'V578 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = '[engine] fb_collect_search_group_admins' AND md5(code) = '8c90de2814e6dd273251c89d3c6e6a90') THEN
    RAISE EXCEPTION 'V578: block "[engine] fb_collect_search_group_admins" không còn đúng bản V577 (md5 8c90de2814e6dd273251c89d3c6e6a90), đọc lại và sinh lại';
  END IF;
  SELECT string_agg(name, ', ') INTO v_bad FROM public.auto_elements WHERE name IN ('fb_main_region', 'fb_group_admin_row', 'fb_group_admin_profile_link', 'fb_group_admin_avatar', 'fb_group_admin_heading', 'fb_profile_tablist', 'fb_profile_directory_link', 'fb_profile_contact_link');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V578: đã có element trùng tên: %', v_bad; END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin) VALUES
  ('fb_main_region', '//*[@role=''main'']', 'Vùng nội dung chính của trang Facebook', 'facebook', true),
  ('fb_group_admin_row', '//*[@role=''main'']//*[@role=''listitem'']', 'Trang quản trị viên của group (/members/admins): dòng của từng người; group riêng tư chưa tham gia thì là từng ảnh đại diện', 'facebook', true),
  ('fb_group_admin_profile_link', './/a[contains(@href,''/user/'') or contains(@href,''profile.php'')]', 'Trong dòng quản trị viên của group: link tới người đó (lấy UID và tên)', 'facebook', true),
  ('fb_group_admin_avatar', './/a[@href]//*[local-name()=''svg'' or local-name()=''img'']', 'Trong dòng quản trị viên của group: ảnh đại diện (dòng chỉ có ảnh, không chữ = Facebook không hiện danh sách)', 'facebook', true),
  ('fb_group_admin_heading', '//*[@role=''main'']//*[self::h2 or self::h3 or @role=''heading'']', 'Trang quản trị viên của group: các tiêu đề (tìm "Quản trị viên và người kiểm duyệt · N" để biết số người)', 'facebook', true),
  ('fb_profile_tablist', '//*[@role=''main'']//*[@role=''tablist'']', 'Trang cá nhân: các hàng tab (hàng đầu tiên là tab của trang cá nhân, vùng tên + dòng giới thiệu đứng ngay trước nó)', 'facebook', true),
  ('fb_profile_directory_link', './/a[contains(@href,''directory_'')]', 'Trang cá nhân, mục Giới thiệu: link của một mục ở cột trái (nhận ra hàng tab nào là cột trái)', 'facebook', true),
  ('fb_profile_contact_link', './/a[contains(@href,''directory_contact_info'')]', 'Trang cá nhân, mục Giới thiệu: link "Thông tin liên hệ" ở cột trái (chỉ có khi người đó để công khai)', 'facebook', true);

UPDATE public.auto_blocks SET code = $v578_block$
  // Lấy thông tin quản trị viên của các group vừa tìm được bằng search (chỉ chạy khi chiến dịch bật vars.isFindFacebookGroupAdmins).
  // Mỗi group: mở /groups/<nhóm>/members/admins đọc danh sách, rồi mở trang cá nhân từng quản trị viên (?sk=directory_contact_info) đọc tên,
  // dòng giới thiệu dưới tên và mục "Thông tin liên hệ" để tách SĐT / email. Chỉ đọc trang, không bấm gì trên Facebook.
  // Kết quả gắn vào từng group của vars.findDataSearchGroups: admins (mảng) và adminScan ('listed' | 'not_listed' | 'failed').
  // Chỗ tìm phần tử trên trang lấy từ bảng auto_elements (sửa được ở màn Element khi Facebook đổi giao diện): fb_main_region,
  // fb_group_admin_row, fb_group_admin_profile_link, fb_group_admin_avatar, fb_group_admin_heading, fb_profile_tablist,
  // fb_profile_directory_link, fb_profile_contact_link.
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

  const mainXpath = await helpers.element('fb_main_region');
  const adminsXpaths = {
    main: mainXpath,
    row: await helpers.element('fb_group_admin_row'),
    link: await helpers.element('fb_group_admin_profile_link'),
    avatar: await helpers.element('fb_group_admin_avatar'),
    heading: await helpers.element('fb_group_admin_heading')
  };
  const profileXpaths = {
    main: mainXpath,
    tablist: await helpers.element('fb_profile_tablist'),
    directoryLink: await helpers.element('fb_profile_directory_link'),
    contactLink: await helpers.element('fb_profile_contact_link')
  };

  const ADMINS_PAGE_SCRIPT = String.raw`function xpathAll(expression, context) {
  const found = [];
  if (!expression) return found;
  const result = document.evaluate(String(expression), context || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let index = 0; index < result.snapshotLength; index += 1) found.push(result.snapshotItem(index));
  return found;
}
function normalizePhone(value) {
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
const xp = __args[1] || {};
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
const ADMIN_LABELS = ['quản trị viên', 'admin'];
const MODERATOR_LABELS = ['người kiểm duyệt', 'moderator'];
function profileOf(item) {
  for (const link of xpathAll(xp.link, item)) {
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
  const people = [];
  const seen = new Set();
  let avatarOnly = 0;
  for (const item of xpathAll(xp.row)) {
    const lines = String(item.innerText || '').split('\n').map(norm).filter(Boolean);
    if (lines.length === 0) { if (xpathAll(xp.avatar, item).length > 0) avatarOnly += 1; continue; }
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
  for (const heading of xpathAll(xp.heading)) {
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
const mainText = norm((xpathAll(xp.main)[0] || document.body).innerText).slice(0, 400);
return {
  listed: state.people.length > 0,
  people: state.people,
  expected: state.expected,
  avatarOnly: state.avatarOnly,
  path: location.pathname,
  pageText: state.people.length > 0 ? '' : mainText
};`;
  const PROFILE_PAGE_SCRIPT = String.raw`function xpathAll(expression, context) {
  const found = [];
  if (!expression) return found;
  const result = document.evaluate(String(expression), context || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let index = 0; index < result.snapshotLength; index += 1) found.push(result.snapshotItem(index));
  return found;
}
function normalizePhone(value) {
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
const xp = __args[1] || {};
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function linesOf(element) { return String((element && element.innerText) || '').split('\n').map(norm).filter(Boolean); }
function unique(values) { return Array.from(new Set(values)); }
function read() {
  const main = xpathAll(xp.main)[0] || document.body;
  const lists = xpathAll(xp.tablist);
  let headerLines = [];
  for (let element = lists[0]; element && element !== main; element = element.parentElement) {
    let lines = [];
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) lines = linesOf(sibling).concat(lines);
    if (lines.length > 0) { headerLines = lines; break; }
  }
  const nav = lists.find(list => xpathAll(xp.directoryLink, list).length > 0) || null;
  const contactLink = nav ? xpathAll(xp.contactLink, nav)[0] || null : null;
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
  pageText: state.hasTabs ? '' : norm((xpathAll(xp.main)[0] || document.body).innerText).slice(0, 300)
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
      await page.waitForSelector(mainXpath, { timeout: 15000 }).catch(() => false);
      const read = await page.evaluate(PROFILE_PAGE_SCRIPT, 9000, profileXpaths);
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
      await page.waitForSelector(mainXpath, { timeout: 15000 }).catch(() => false);
      listed = await page.evaluate(ADMINS_PAGE_SCRIPT, 45000, adminsXpaths);
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
$v578_block$, updated_at = now()
 WHERE name = '[engine] fb_collect_search_group_admins' AND md5(code) = '8c90de2814e6dd273251c89d3c6e6a90';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = '[engine] fb_collect_search_group_admins' AND md5(code) = '0dbc5efcd3a4be06491a2d95ee7c2a05') THEN
    RAISE EXCEPTION 'V578 postflight: code block không phải bản mới (md5 0dbc5efcd3a4be06491a2d95ee7c2a05)';
  END IF;
  IF (SELECT count(*) FROM public.auto_elements WHERE name IN ('fb_main_region', 'fb_group_admin_row', 'fb_group_admin_profile_link', 'fb_group_admin_avatar', 'fb_group_admin_heading', 'fb_profile_tablist', 'fb_profile_directory_link', 'fb_profile_contact_link') AND category = 'facebook' AND is_builtin
        AND staff_id IS NULL AND organization_id IS NULL AND btrim(xpath) <> '') <> 8 THEN
    RAISE EXCEPTION 'V578 postflight: chưa đủ 8 element';
  END IF;
END $post$;

COMMIT;
