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

  const ADMINS_PAGE_SCRIPT = String.raw`__ADMINS_PAGE_SCRIPT__`;
  const PROFILE_PAGE_SCRIPT = String.raw`__PROFILE_PAGE_SCRIPT__`;

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
