#!/usr/bin/env node
// Kiểm tính năng "Lấy thông tin quản trị viên của group" của Tìm kiếm data bằng search (V577 + V578: selector lấy từ auto_elements).
// Không chạm DB thật, không chạm Facebook. Đoạn chạy trong trang của V578 phải cho kết quả giống hệt bản V577 trên cùng bộ trang giả.
//   1. Tách SĐT / email: đoạn chạy trong trang (contact-extract.fragment.js) và src/shared/facebookGroupAdmins.ts cho cùng kết quả.
//   2. Đoạn chạy trong trang trên Chromium thật với trang giả dựng theo DOM Facebook xem 18/11/2026 (danh sách quản trị viên: group công khai,
//      group riêng tư chưa tham gia; trang cá nhân: có / không có mục Thông tin liên hệ, trang đăng nhập).
//   3. Code block mới chạy như workflowEngine chạy (page / helpers giả): chỉ quản trị viên, nhớ trang cá nhân đã mở, group đã biết, dừng sớm.
//   4. Block tổng kết bản mới giữ admins / adminScan; bộ đọc của app (readFacebookGroupAdminFields) lọc payload sai.
//   5. Migration + bản gỡ trên PostgreSQL 17 cục bộ với workflow / block đọc từ production (fixture v577-live-20261118.json).
// Chạy: CHROMIUM_PATH=<Chrome> node scripts/facebook-search-groups/admins-smoke.cjs   (bỏ phần 2: --no-browser; bỏ phần 5: --no-sql)
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { buildSync } = require('esbuild')
const V577 = require('../build-v577-sql.cjs')
const V = require('../build-v578-sql.cjs')

const ROOT = path.resolve(__dirname, '../..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
// XPath đúng như V578 ghi vào auto_elements; block truyền cho đoạn chạy trong trang theo các khoá này.
const ELEMENT = Object.fromEntries(V.ELEMENTS.map(element => [element.name, element.xpath]))
const ADMINS_XP = { main: ELEMENT.fb_main_region, row: ELEMENT.fb_group_admin_row, link: ELEMENT.fb_group_admin_profile_link,
  avatar: ELEMENT.fb_group_admin_avatar, heading: ELEMENT.fb_group_admin_heading }
const PROFILE_XP = { main: ELEMENT.fb_main_region, tablist: ELEMENT.fb_profile_tablist, directoryLink: ELEMENT.fb_profile_directory_link,
  contactLink: ELEMENT.fb_profile_contact_link }
const args = new Set(process.argv.slice(2))
let passed = 0
const ok = name => { passed += 1; console.log(`  ✓ ${name}`) }

function loadShared() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-group-admins-'))
  buildSync({ entryPoints: [path.join(ROOT, 'src/shared/facebookGroupAdmins.ts')], outfile: path.join(dir, 'admins.cjs'), bundle: true, platform: 'node',
    format: 'cjs', logLevel: 'silent' })
  const shared = require(path.join(dir, 'admins.cjs'))
  fs.rmSync(dir, { recursive: true, force: true })
  return shared
}

const runBlock = (code, ctx) => new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${code}\n})`)(
  ctx.page, ctx.helpers, ctx.vars, ctx.input ?? {}, ctx.signal)()

// ---------- 1. Tách SĐT / email ----------
function checkExtract(shared) {
  const sandbox = {}
  vm.runInNewContext(`${V.EXTRACT}\nthis.findPhones = findPhones; this.findEmails = findEmails; this.normalizePhone = normalizePhone;`, sandbox)
  const samples = [
    ['Mỹ Trinh - 0908.111.404', ['0908111404'], []],
    ['Hotline: 0903221229', ['0903221229'], []],
    ['Số điện thoại\n090 322 12 29\nDi động\nSố WhatsApp\n+84 90 322 12 29\nWhatsApp', ['0903221229'], []],
    ['Thuê đăng bài liên hệ admin: 0333311152 hoặc 84 912 345 678', ['0333311152', '0912345678'], []],
    ['Email\nCanhoDN43@Gmail.com\nEmail', [], ['canhodn43@gmail.com']],
    ['Liên hệ a.b-c+tag@mail.example.vn. Hoặc zalo 0977-123-456.', ['0977123456'], ['a.b-c+tag@mail.example.vn']],
    // Không phải SĐT: mã Facebook, số nằm trong dãy dài hơn, số bàn, giá tiền.
    ['profile.php?id=100072022092879 và 61564418919912', [], []],
    ['20.484 người theo dõi • 1 đang theo dõi', [], []],
    ['Tổng đài 02363 888 999, giá 0912345678901 đồng', [], []],
    ['+840912345678', [], []],
    ['không có gì', [], []],
    ['', [], []]
  ]
  for (const [text, phones, emails] of samples) {
    assert.deepEqual([...sandbox.findPhones(text)], phones, `SĐT (trong trang): ${text}`)
    assert.deepEqual(shared.findVietnamMobiles(text), phones, `SĐT (app): ${text}`)
    assert.deepEqual([...sandbox.findEmails(text)], emails, `email (trong trang): ${text}`)
    assert.deepEqual(shared.findEmails(text), emails, `email (app): ${text}`)
  }
  ok(`tách SĐT / email: ${samples.length} mẫu, đoạn trong trang và app cho cùng kết quả`)
}

// ---------- 2. Đoạn chạy trong trang trên Chromium ----------
const personRow = (groupId, uid, name, role, extra) => `
  <div role="listitem"><div>
    <a role="link" aria-hidden="true" aria-label="${name}" href="/groups/${groupId}/user/${uid}/?__cft__[0]=abc"><svg role="none"></svg></a>
    <div><div><a role="link" href="/groups/${groupId}/user/${uid}/?__cft__[0]=abc"><span>${name}</span></a></div>
      <div><span>${role}</span></div><div><span>${extra}</span></div></div>
    <div role="button" aria-label="Thêm bạn bè">Thêm bạn bè</div>
  </div></div>`
const PAGES = {
  '/groups/111/members/admins': `<div role="main">
    <div><a href="/groups/111/">Hội Mua Bán</a><div>Nhóm Công khai · 137,4K thành viên</div></div>
    <h2>Thành viên · 137.423</h2><div>Người và Trang mới tham gia nhóm này sẽ hiển thị tại đây.</div>
    <h2>Quản trị viên và người kiểm duyệt · 5</h2>
    <div role="list">
      ${personRow('111', '100072022092879', 'Căn hộ cho thuê tại Đà Nẵng', 'Quản trị viên', 'Căn hộ dịch vụ · 20.484 người theo dõi trang cá nhân này')}
      ${personRow('111', '100044882776478', 'Trần Mỹ Trinh', 'Quản trị viên', 'THPT Huỳnh Ngọc Huệ')}
      ${personRow('111', '61564418919912', 'Mỹ Trinh - 0908.111.404', 'Quản trị viên', 'Bất động sản')}
      ${personRow('111', '100060937436725', 'Bang Ngo', 'Người kiểm duyệt', 'Làm việc tại Đà Nẵng')}
      ${personRow('111', '100002358148167', 'Quản trị viên giả', 'Người kiểm duyệt', 'Tên có chữ quản trị viên')}
    </div></div>`,
  '/groups/222/members/admins': `<div role="main">
    <div>Hội Riêng Tư</div><div>Nhóm Riêng tư · 284,0K thành viên</div><h2>Giới thiệu về nhóm này</h2>
    <div role="list"><div role="listitem"><div>Riêng tư</div><div>Chỉ thành viên mới nhìn thấy mọi người trong nhóm và những gì họ đăng.</div></div></div>
    <h2>Thành viên · 284,0K</h2>
    <div role="list">
      <div role="listitem"><a role="link" aria-label="Trang cá nhân" href="/dangyenbds91"><svg aria-label="Dang Yen"></svg></a></div>
      <div role="listitem"><a role="link" aria-label="Trang cá nhân" href="/profile.php?id=61550796591374"><svg aria-label="Nhà Đất"></svg></a></div>
    </div>
    <div>Elena và 7 thành viên khác là quản trị viên. HAn là người kiểm duyệt.</div></div>`,
  '/groups/333/members/admins': `<div role="main"><div>Bạn hiện không xem được nội dung này</div></div>`,
  '/groups/444/members/admins': `<div role="main"><h2>Admins & moderators · 2</h2><div role="list">
      ${personRow('444', '100000000000001', 'Jane Admin', 'Admin', 'Works at X')}
      ${personRow('444', '100000000000002', 'John Mod', 'Moderator', 'Lives in Y')}
    </div></div>`
}
const profilePage = ({ name, bio, nav, panel }) => `<div role="main">
  <div><div>
    <div></div>
    <div><div>${name}</div><div>20K người theo dõi • 1 đang theo dõi</div><div role="button">Nhắn tin</div>${bio.map(line => `<div>${line}</div>`).join('')}</div>
    <div><div><div role="tablist"><a role="tab" href="?sk=">Tất cả</a><a role="tab" aria-selected="true" href="?sk=about">Giới thiệu</a></div></div></div>
  </div></div>
  <div><div><div>
    <div><div><h2>Giới thiệu</h2></div><div role="tablist">${nav.map(item => `<a role="tab" aria-selected="${item.selected ? 'true' : 'false'}" href="/x/${item.key}">${item.label}</a>`).join('')}</div></div>
    <div>${panel}</div>
  </div></div></div>
  <div><h2>Đánh giá</h2><div>Khách cũ: gọi 0911222333 nhé, mail khac@example.com</div></div>
</div>`
const PROFILES = {
  '100072022092879': { path: '/canhodichvu43/directory_contact_info/', html: profilePage({ name: 'Căn hộ cho thuê tại Đà Nẵng',
    bio: ['Cho thuê căn hộ, khách sạn ngắn và dài hạn', 'Hotline: 0903.221.229', 'Căn hộ dịch vụ'],
    nav: [{ key: 'directory_intro', label: 'Giới thiệu' }, { key: 'directory_contact_info', label: 'Thông tin liên hệ', selected: true }],
    panel: '<h2>Số điện thoại</h2><div>090 322 12 29</div><div>Di động</div><h2>Email</h2><div>CanhoDN43@gmail.com</div><div>Email</div><h2>Số WhatsApp</h2><div>+84 90 322 12 29</div><div>WhatsApp</div>' }) },
  '100044882776478': { path: '/thuykieu145/directory_contact_info/', html: profilePage({ name: 'Trần Mỹ Trinh', bio: ['Da Nang'],
    nav: [{ key: 'directory_personal_details', label: 'Thông tin cá nhân' }, { key: 'directory_education', label: 'Trình độ học vấn' }], panel: '' }) },
  '61564418919912': { path: '/profile.php', html: profilePage({ name: 'Mỹ Trinh - 0908.111.404', bio: ['Bất động sản', 'Mail: MyTrinh@Example.com'],
    nav: [{ key: 'directory_intro', label: 'Giới thiệu' }, { key: 'directory_contact_info', label: 'Thông tin liên hệ', selected: true }],
    panel: '<h2>Messenger</h2><div>Mỹ Trinh - 0908.111.404</div>' }) },
  '999': { path: '/checkpoint/1501092823525282/', html: '<div role="main"><div>Xác nhận danh tính của bạn</div></div>' },
  '998': { path: '/profile.php', html: '<div role="main"><div>Bạn hiện không xem được nội dung này</div></div>' }
}

async function checkPageScripts() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  try {
    const page = await browser.newPage()
    await page.route('https://www.facebook.com/**', route => {
      const url = new URL(route.request().url())
      const body = PAGES[url.pathname] ?? (url.pathname === '/profile.php' ? PROFILES[url.searchParams.get('id')]?.html
        : Object.values(PROFILES).find(profile => profile.path === url.pathname)?.html)
      return route.fulfill({ status: body ? 200 : 404, contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><body>${body ?? ''}</body>` })
    })
    // Đúng cách pageController.evaluate bọc code.
    const evaluateRaw = (code, ...list) => page.evaluate(`(async function() { var __args = ${JSON.stringify(list)}; ${code}\n})()`)
    // Mỗi lần đọc: chạy bản V578 (XPath từ auto_elements) và bản V577 (selector trong code) trên cùng trang, kết quả phải giống hệt.
    let compared = 0
    const evaluate = async (code, wait) => {
      const isAdmins = code === V.ADMINS_PAGE_SCRIPT
      const current = await evaluateRaw(code, wait, isAdmins ? ADMINS_XP : PROFILE_XP)
      const previous = await evaluateRaw(isAdmins ? V577.ADMINS_PAGE_SCRIPT : V577.PROFILE_PAGE_SCRIPT, wait)
      assert.deepEqual(current, previous, 'bản V578 khác bản V577 trên cùng trang')
      compared += 1
      return current
    }
    const open = async pathname => { await page.goto(`https://www.facebook.com${pathname}`); }

    await open('/groups/111/members/admins')
    let result = await evaluate(V.ADMINS_PAGE_SCRIPT, 6000)
    assert.equal(result.listed, true)
    assert.equal(result.expected, 5)
    assert.deepEqual(result.people.map(person => [person.uid, person.name, person.role]), [
      ['100072022092879', 'Căn hộ cho thuê tại Đà Nẵng', 'admin'], ['100044882776478', 'Trần Mỹ Trinh', 'admin'],
      ['61564418919912', 'Mỹ Trinh - 0908.111.404', 'admin'], ['100060937436725', 'Bang Ngo', 'moderator'],
      // Tên có chữ "Quản trị viên" nhưng dòng vai trò là "Người kiểm duyệt": vai trò lấy theo dòng đúng bằng nhãn, tên không tính.
      ['100002358148167', 'Quản trị viên giả', 'moderator']])
    assert.deepEqual(result.people[2].phones, ['0908111404'])
    ok('trang quản trị viên (group công khai): đủ 5 người, đúng UID / tên / vai trò, SĐT trong tên')

    await open('/groups/222/members/admins')
    result = await evaluate(V.ADMINS_PAGE_SCRIPT, 6000)
    assert.equal(result.listed, false)
    assert.equal(result.people.length, 0)
    assert.equal(result.avatarOnly, 2)
    ok('group riêng tư chưa tham gia: chỉ có ảnh đại diện, không đoán quản trị viên')

    await open('/groups/333/members/admins')
    result = await evaluate(V.ADMINS_PAGE_SCRIPT, 3000)
    assert.deepEqual([result.listed, result.avatarOnly, result.people.length], [false, 0, 0])
    assert.match(result.pageText, /không xem được/)
    ok('group không xem được: không có danh sách, giữ chữ trên trang để tra')

    await open('/groups/444/members/admins')
    result = await evaluate(V.ADMINS_PAGE_SCRIPT, 3000)
    assert.deepEqual(result.people.map(person => person.role), ['admin', 'moderator'])
    ok('giao diện tiếng Anh: nhãn Admin / Moderator')

    await open(PROFILES['100072022092879'].path)
    result = await evaluate(V.PROFILE_PAGE_SCRIPT, 4000)
    assert.equal(result.available, true)
    assert.equal(result.name, 'Căn hộ cho thuê tại Đà Nẵng')
    assert.equal(result.vanity, 'canhodichvu43')
    assert.equal(result.hasContactSection, true)
    assert.deepEqual(result.phones, ['0903221229'])
    assert.deepEqual(result.emails, ['canhodn43@gmail.com'])
    assert.ok(!result.contactText.includes('0911222333') && !result.headerText.includes('0911222333'), 'không đọc sang khối Đánh giá')
    ok('trang cá nhân có mục Thông tin liên hệ: SĐT (3 cách viết gộp một số), email chữ thường, không lấy số ở khối khác')

    await open(PROFILES['100044882776478'].path)
    result = await evaluate(V.PROFILE_PAGE_SCRIPT, 4000)
    assert.deepEqual([result.available, result.hasContactSection, result.vanity, result.phones, result.emails], [true, false, 'thuykieu145', [], []])
    ok('trang cá nhân không công khai liên hệ: trống, không lấy số ở khối khác')

    await open('/profile.php?id=61564418919912&sk=directory_contact_info')
    result = await evaluate(V.PROFILE_PAGE_SCRIPT, 4000)
    assert.deepEqual([result.vanity, result.phones, result.emails], ['', ['0908111404'], ['mytrinh@example.com']])
    ok('SĐT trong tên, email trong dòng giới thiệu dưới tên')

    await open(PROFILES['999'].path)
    result = await evaluate(V.PROFILE_PAGE_SCRIPT, 1500)
    assert.deepEqual([result.available, result.blocked], [false, true])
    await page.goto('https://www.facebook.com/profile.php?id=998')
    result = await evaluate(V.PROFILE_PAGE_SCRIPT, 1500)
    assert.deepEqual([result.available, result.blocked, result.phones], [false, false, []])
    ok('trang xác minh / trang không xem được: không có dữ liệu, báo đúng loại')
    assert.equal(compared, 9)
    ok(`XPath từ auto_elements: ${compared} lượt đọc cho kết quả giống hệt bản V577 (selector trong code)`)
    // Thiếu XPath (element bị xoá / để trống): không đọc bừa, trả như không thấy gì.
    await open('/groups/111/members/admins')
    result = await evaluateRaw(V.ADMINS_PAGE_SCRIPT, 1500, {})
    assert.deepEqual([result.listed, result.people.length, result.avatarOnly], [false, 0, 0])
    ok('thiếu XPath: không đọc được gì, không đoán')
  } finally {
    await browser.close()
  }
}

// ---------- 3. Code block ----------
function fakeRuntime({ groups, admins, profiles, known = [], failNavigate = () => false, elements = ELEMENT }) {
  const calls = { navigate: [], events: [], logs: [], sleeps: 0, elements: [] }
  let current = ''
  const page = {
    async navigate(url) { calls.navigate.push(url); current = url; if (failNavigate(url)) throw new Error('net::ERR_FAILED'); },
    async waitForSelector(selector) { assert.equal(selector, ELEMENT.fb_main_region); return true },
    async evaluate(code, wait, xpaths) {
      const url = new URL(current)
      assert.deepEqual(xpaths, code === V.ADMINS_PAGE_SCRIPT ? ADMINS_XP : PROFILE_XP, 'block truyền đúng XPath lấy từ auto_elements')
      if (code === V.ADMINS_PAGE_SCRIPT) {
        const key = url.pathname.replace(/\/members\/admins$/, '/')
        const value = admins[key]
        if (!value) throw new Error(`Bài kiểm: thiếu trang quản trị viên ${key}`)
        return typeof value === 'function' ? value() : { path: url.pathname, expected: 0, avatarOnly: 0, pageText: '', people: [], ...value }
      }
      if (code === V.PROFILE_PAGE_SCRIPT) {
        assert.equal(url.searchParams.get('sk'), 'directory_contact_info')
        const value = profiles[url.searchParams.get('id')]
        if (!value) throw new Error(`Bài kiểm: thiếu trang cá nhân ${url.search}`)
        return { available: true, blocked: false, vanity: '', phones: [], emails: [], hasContactSection: false, ...value }
      }
      throw new Error('Bài kiểm: đoạn chạy trong trang lạ')
    }
  }
  const helpers = {
    async sleep(ms, signal) { calls.sleeps += 1; assert.ok(ms >= 2500 && ms <= 5000, `nghỉ ${ms} ms`); if (signal?.aborted) throw new Error('Block bị huỷ trong khi sleep') },
    log(message) { calls.logs.push(message) },
    async element(name) { calls.elements.push(name); const xpath = elements[name]; if (!xpath) throw new Error(`Element không tìm thấy: ${name}`); return xpath },
    async logRunEvents(events) { calls.events.push(...events) },
    async logRunEvent(event) { calls.events.push(event) }
  }
  const searchGroups = groups.map(group => ({ ...group }))
  const vars = { findDataSearchHasGroup: true, isFindFacebookGroupAdmins: true, findDataSearchKeyword: 'bất động sản', findDataSearchGroups: searchGroups,
    findDataResults: { facebookGroups: [...searchGroups] }, findDataAdminSkipGroupKeys: known }
  return { page, helpers, vars, calls }
}
const person = (uid, name, role = 'admin', phones = []) => ({ uid, name, role, phones, emails: [] })
const G1 = { url: 'https://www.facebook.com/groups/111/', name: 'Hội A' }
const G2 = { url: 'https://www.facebook.com/groups/222/', name: 'Hội B' }
const G3 = { url: 'https://www.facebook.com/groups/333/', name: 'Hội C' }
const G4 = { url: 'https://www.facebook.com/groups/444/', name: 'Hội D' }

async function checkBlock() {
  // Tắt ô chọn / không tìm group: không mở trang nào.
  for (const patch of [{ isFindFacebookGroupAdmins: false }, { isFindFacebookGroupAdmins: undefined }, { isFindFacebookGroupAdmins: 'true' }, { findDataSearchHasGroup: false }]) {
    const rt = fakeRuntime({ groups: [G1], admins: {}, profiles: {} })
    Object.assign(rt.vars, patch)
    const out = await runBlock(V.NEW_CODE, rt)
    assert.equal(out.skipped, true)
    assert.equal(rt.calls.navigate.length, 0)
    assert.equal(rt.calls.elements.length, 0, 'không bật thì không tra element nào')
    assert.equal(rt.vars.findDataSearchGroups[0].adminScan, undefined)
  }
  ok('không bật ô chọn (hoặc app cũ không gửi biến): block không mở trang nào, không gắn gì vào group')

  // Ca chính: 3 group, quản trị viên trùng giữa hai group chỉ mở trang cá nhân một lần.
  let rt = fakeRuntime({
    groups: [G1, G2, G3],
    admins: {
      '/groups/111/': { listed: true, expected: 3, people: [person('1001', 'Căn hộ A'), person('1002', 'Mỹ Trinh - 0908.111.404', 'admin', ['0908111404']), person('1003', 'Bang', 'moderator')] },
      '/groups/222/': { listed: false, avatarOnly: 9 },
      '/groups/333/': { listed: true, expected: 2, people: [person('1002', 'Mỹ Trinh - 0908.111.404', 'admin', ['0908111404']), person('1004', 'Không mở được')] }
    },
    profiles: {
      1001: { vanity: 'canhoa', phones: ['0903221229'], emails: ['a@example.com'], hasContactSection: true },
      1002: { phones: ['0908111404'] },
      1004: { available: false }
    }
  })
  let out = await runBlock(V.NEW_CODE, rt)
  const [g1, g2, g3] = rt.vars.findDataSearchGroups
  assert.equal(g1.adminScan, 'listed')
  assert.deepEqual(g1.admins, [
    { uid: '1001', name: 'Căn hộ A', url: 'https://www.facebook.com/canhoa', role: 'admin', phones: ['0903221229'], emails: ['a@example.com'], profileRead: true },
    { uid: '1002', name: 'Mỹ Trinh - 0908.111.404', url: 'https://www.facebook.com/profile.php?id=1002', role: 'admin', phones: ['0908111404'], emails: [], profileRead: true }])
  assert.deepEqual([g2.adminScan, g2.admins], ['not_listed', []])
  assert.equal(g3.adminScan, 'listed')
  assert.deepEqual(g3.admins.map(admin => [admin.uid, admin.profileRead, admin.phones]), [['1002', true, ['0908111404']], ['1004', false, []]])
  assert.deepEqual(rt.calls.navigate, [
    'https://www.facebook.com/groups/111/members/admins',
    'https://www.facebook.com/profile.php?id=1001&sk=directory_contact_info',
    'https://www.facebook.com/profile.php?id=1002&sk=directory_contact_info',
    'https://www.facebook.com/groups/222/members/admins',
    'https://www.facebook.com/groups/333/members/admins',
    'https://www.facebook.com/profile.php?id=1004&sk=directory_contact_info'])
  assert.equal(rt.calls.sleeps, rt.calls.navigate.length)
  assert.deepEqual([out.groups, out.listed, out.notListed, out.failed, out.admins, out.withPhone, out.withEmail, out.profilesOpened, out.stopReason], [3, 2, 1, 0, 4, 3, 1, 3, ''])
  assert.equal(rt.vars.findDataResults.facebookGroups[0].admins.length, 2, 'kết quả tìm data của từ khoá nhận cùng dữ liệu')
  const messages = rt.calls.events.map(event => event.message)
  assert.deepEqual(messages, [
    'Group "Hội A": 2 quản trị viên, 2 người có số điện thoại, 1 người có email',
    'Group "Hội B": Facebook không hiện danh sách quản trị viên của group riêng tư khi chưa tham gia',
    'Group "Hội C": 2 quản trị viên, 1 người có số điện thoại',
    'Lấy được 4 quản trị viên của 2/3 group, 1 group riêng tư chưa tham gia nên Facebook không hiện danh sách'])
  assert.ok(rt.calls.events.every(event => !event.extractedData), 'event không mang extractedData (không lẫn với SĐT tìm được)')
  ok('3 group: chỉ quản trị viên, link theo tên riêng khi có, group riêng tư ghi not_listed, người trùng mở trang cá nhân một lần')

  // Group đã có ở lượt trước không đọc lại; kết quả tìm data là object khác (không cùng tham chiếu) vẫn được gắn.
  rt = fakeRuntime({ groups: [G1, G4], known: ['https://www.facebook.com/groups/111', 'HTTPS://www.facebook.com/GROUPS/999/'],
    admins: { '/groups/444/': { listed: true, people: [person('2001', 'Jane')] } }, profiles: { 2001: {} } })
  rt.vars.findDataResults.facebookGroups = rt.vars.findDataSearchGroups.map(group => ({ ...group }))
  out = await runBlock(V.NEW_CODE, rt)
  assert.deepEqual(rt.calls.navigate.map(url => new URL(url).pathname + new URL(url).search), ['/groups/444/members/admins', '/profile.php?id=2001&sk=directory_contact_info'])
  assert.equal(rt.vars.findDataSearchGroups[0].adminScan, undefined)
  assert.equal(rt.vars.findDataResults.facebookGroups[1].adminScan, 'listed')
  assert.equal(rt.vars.findDataResults.facebookGroups[1].admins[0].uid, '2001')
  assert.equal(out.groups, 1)
  rt = fakeRuntime({ groups: [G1], known: [G1.url], admins: {}, profiles: {} })
  out = await runBlock(V.NEW_CODE, rt)
  assert.deepEqual([out.skipped, out.knownGroupCount, rt.calls.navigate.length], [true, 1, 0])
  ok('group đã tìm thấy ở lượt trước: không đọc lại; mọi group đều đã biết thì không mở trang nào')

  assert.equal(rt.calls.elements.length, 0, 'mọi group đã biết: thoát trước khi tra element')
  rt = fakeRuntime({ groups: [G4], admins: { '/groups/444/': { listed: true, people: [] } }, profiles: {} })
  await runBlock(V.NEW_CODE, rt)
  assert.deepEqual([...rt.calls.elements].sort(), Object.keys(ELEMENT).sort(), 'block tra đủ 8 element, mỗi tên một lần, không tra tên nào khác')
  // Thiếu một element trong bảng (bị xoá / đổi tên): block báo lỗi rõ tên, không mở trang nào.
  const { fb_profile_contact_link: removed, ...missingOne } = ELEMENT
  rt = fakeRuntime({ groups: [G1], admins: {}, profiles: {}, elements: missingOne })
  await assert.rejects(runBlock(V.NEW_CODE, rt), /Element không tìm thấy: fb_profile_contact_link/)
  assert.equal(rt.calls.navigate.length, 0)
  ok('element lấy từ bảng: tra đủ 8 tên; thiếu một tên thì báo lỗi rõ, không mở trang nào')

  // Trang đăng nhập / xác minh: dừng hẳn, các group còn lại ghi failed.
  rt = fakeRuntime({ groups: [G1, G2, G3],
    admins: { '/groups/111/': { listed: true, people: [person('3001', 'A'), person('3002', 'B')] }, '/groups/222/': { listed: false, avatarOnly: 3 } },
    profiles: { 3001: { available: false, blocked: true } } })
  out = await runBlock(V.NEW_CODE, rt)
  assert.match(out.stopReason, /đăng nhập \/ xác minh/)
  assert.deepEqual(rt.vars.findDataSearchGroups.map(group => group.adminScan), ['listed', 'failed', 'failed'])
  assert.deepEqual(rt.vars.findDataSearchGroups[0].admins.map(admin => admin.profileRead), [false, false])
  assert.equal(rt.calls.navigate.length, 2, 'không mở thêm trang nào sau khi gặp trang xác minh')
  rt = fakeRuntime({ groups: [G1, G2], admins: { '/groups/111/': { listed: false, path: '/checkpoint/123/' } }, profiles: {} })
  out = await runBlock(V.NEW_CODE, rt)
  assert.deepEqual(rt.vars.findDataSearchGroups.map(group => group.adminScan), ['failed', 'failed'])
  assert.equal(rt.calls.navigate.length, 1)
  ok('gặp trang đăng nhập / xác minh: dừng, không mở thêm trang, phần chưa đọc ghi failed')

  // Lỗi mở trang: 3 group liên tiếp không đọc được thì dừng; lỗi lẻ thì đi tiếp.
  const five = [G1, G2, G3, G4, { url: 'https://www.facebook.com/groups/555/', name: 'Hội E' }]
  rt = fakeRuntime({ groups: five, admins: {}, profiles: {}, failNavigate: () => true })
  out = await runBlock(V.NEW_CODE, rt)
  assert.equal(rt.calls.navigate.length, 3)
  assert.deepEqual([out.failed, out.listed], [5, 0])
  assert.match(out.stopReason, /3 group liên tiếp/)
  rt = fakeRuntime({ groups: [G1, G2, G3], failNavigate: url => url.includes('/groups/111/') || url.includes('id=4002'),
    admins: { '/groups/222/': { listed: true, people: [person('4001', 'A'), person('4002', 'B - 0912 345 678', 'admin', ['0912345678'])] }, '/groups/333/': { listed: true, people: [] } },
    profiles: { 4001: { phones: ['0977000111'] } } })
  out = await runBlock(V.NEW_CODE, rt)
  assert.deepEqual(rt.vars.findDataSearchGroups.map(group => group.adminScan), ['failed', 'listed', 'listed'])
  assert.deepEqual(rt.vars.findDataSearchGroups[1].admins.map(admin => [admin.profileRead, admin.phones]), [[true, ['0977000111']], [false, ['0912345678']]])
  assert.deepEqual(rt.vars.findDataSearchGroups[2].admins, [])
  assert.equal(out.stopReason, '')
  ok('lỗi mở trang: 3 group liên tiếp thì dừng; lỗi lẻ đi tiếp, không mở được trang cá nhân thì giữ SĐT trong tên')

  // Dừng chiến dịch giữa chừng: block ném lỗi huỷ, không nuốt.
  const controller = new AbortController()
  rt = fakeRuntime({ groups: [G1], admins: { '/groups/111/': () => { controller.abort(); return { listed: true, people: [person('5001', 'A')], path: '/groups/111/members/admins' } } }, profiles: { 5001: {} } })
  rt.signal = controller.signal
  await assert.rejects(runBlock(V.NEW_CODE, rt), /huỷ/)
  ok('huỷ giữa chừng: block dừng bằng lỗi huỷ')
}

// ---------- 4. Block tổng kết + bộ đọc của app ----------
async function checkSummary(shared) {
  const admins = [{ uid: '1001', name: 'A', url: 'https://www.facebook.com/a', role: 'admin', phones: ['0903221229'], emails: [], profileRead: true }]
  const run = async code => {
    const vars = { isFindFacebookGroup: true, findDataSearchHasGroup: true, findDataSearchKeyword: 'k', findDataResults: { facebookGroups: [
      { url: 'https://www.facebook.com/groups/111/', name: 'A', privacy: 'Công khai', memberCount: 10, postsPerDay: 2, keyword: 'k', adminScan: 'listed', admins, rawText: 'x' },
      { url: 'https://www.facebook.com/groups/222/', name: 'B', privacy: 'Riêng tư', memberCount: 5, postsPerDay: 0, keyword: 'k', adminScan: 'not_listed', admins: [] },
      { url: 'https://www.facebook.com/groups/333/', name: 'C', privacy: '', memberCount: 0, postsPerDay: 0, keyword: 'k' }] } }
    return runBlock(code, { page: {}, helpers: { log() {}, async logRunEvent() {} }, vars })
  }
  const before = await run(V577.SUMMARY_OLD)
  const after = await run(V577.SUMMARY_NEW)
  assert.ok(before.facebookGroups.every(group => !('admins' in group)), 'bản cũ bỏ mất admins (lý do phải sửa)')
  assert.deepEqual(after.facebookGroups[0], { url: 'https://www.facebook.com/groups/111/', name: 'A', privacy: 'Công khai', memberCount: 10, postsPerDay: 2, keyword: 'k', adminScan: 'listed', admins })
  assert.deepEqual([after.facebookGroups[1].adminScan, after.facebookGroups[1].admins], ['not_listed', []])
  assert.deepEqual(after.facebookGroups[2], before.facebookGroups[2], 'group không quét quản trị viên: y như bản cũ')
  const strip = out => ({ ...out, facebookGroups: out.facebookGroups.map(({ adminScan, admins: list, ...rest }) => rest) })
  assert.deepEqual(strip(after), strip(before), 'mọi phần khác của kết quả tổng kết giữ nguyên')
  ok('block tổng kết bản mới giữ admins / adminScan, phần còn lại y bản cũ')

  const read = shared.readFacebookGroupAdminFields
  assert.deepEqual(read(after.facebookGroups[0]), { adminScan: 'listed', admins: [{ name: 'A', url: 'https://www.facebook.com/a', uid: '1001', phones: ['0903221229'], emails: [], profileRead: true }] })
  assert.deepEqual(read(after.facebookGroups[2]), {})
  assert.deepEqual(read({ adminScan: 'weird', admins }), {})
  assert.deepEqual(read({ adminScan: 'not_listed', admins }), { adminScan: 'not_listed', admins: [] })
  assert.deepEqual(read({ adminScan: 'listed', admins: [
    { uid: '12', name: ' Tên   dài ', url: 'javascript:alert(1)', phones: ['090 322 12 29', '0903221229', '123', 5], emails: ['X@Y.vn', 'sai'] },
    { uid: 'abc', name: 'Không link', url: 'https://evil.example/profile.php?id=1' },
    { name: 'Trùng', url: 'https://www.facebook.com/profile.php?id=12&x=1' },
    { name: 'Tên riêng', url: 'https://m.facebook.com/ten.rieng/about?x=1', phones: 'x', emails: null },
    null, 'x'] }), { adminScan: 'listed', admins: [
    { name: 'Tên dài', url: 'https://www.facebook.com/profile.php?id=12', uid: '12', phones: ['0903221229'], emails: ['x@y.vn'] },
    { name: 'Trùng', url: 'https://www.facebook.com/profile.php?id=12', phones: [], emails: [] },
    { name: 'Tên riêng', url: 'https://www.facebook.com/ten.rieng', phones: [], emails: [] }] })
  assert.equal(shared.describeFacebookGroupAdminScan({ adminScan: 'listed', admins }), '1')
  assert.equal(shared.describeFacebookGroupAdminScan({ adminScan: 'not_listed', admins: [] }), 'Facebook không hiện')
  assert.equal(shared.describeFacebookGroupAdminScan({ adminScan: 'failed', admins: [] }), 'Chưa đọc được')
  assert.equal(shared.describeFacebookGroupAdminScan({}), '')
  const line = shared.formatFacebookGroupAdminsLine
  assert.equal(line([{}, { url: 'x' }]), '', 'lượt không quét quản trị viên: không thêm dòng nào')
  assert.equal(line([read(after.facebookGroups[0]), read(after.facebookGroups[1]), {}]), 'Quản trị viên group: 1 người của 1/2 group (1 người có số điện thoại)')
  assert.equal(line([{ adminScan: 'failed', admins: [] }]), 'Quản trị viên group: 0 người của 0/1 group')
  assert.equal(line([{ adminScan: 'listed', admins: [{ name: 'a', url: 'u', phones: ['0903221229'], emails: ['a@b.vn'] }, { name: 'b', url: 'v', phones: [], emails: ['c@d.vn'] }] }]),
    'Quản trị viên group: 2 người của 1/1 group (1 người có số điện thoại, 2 người có email)')
  ok('bộ đọc của app: chỉ giữ link facebook.com, UID số, SĐT / email hợp lệ; payload sai dạng thì bỏ')
}

// ---------- 5. Migration ----------
async function checkSql() {
  const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
  const LIVE = V577.LIVE
  const migration = fs.readFileSync(path.join(ROOT, `migrations/${V577.NAME}.sql`), 'utf8')
  const rollback = fs.readFileSync(path.join(ROOT, `migrations/${V577.ROLLBACK_NAME}.sql`), 'utf8')
  assert.equal(md5(migration), md5(V577.migration), 'file migration khác bản sinh: chạy lại node scripts/build-v577-sql.cjs')
  assert.equal(md5(rollback), md5(V577.rollback), 'file gỡ khác bản sinh')
  const cluster = startCluster({ port: 55477, label: 'aka-v577-' })
  const db = await cluster.connect()
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  try {
    await db.query(`
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
      CREATE TABLE public.auto_blocks (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, description text, icon text, category text NOT NULL,
        kind text NOT NULL DEFAULT 'js', system_type text, code text NOT NULL DEFAULT '', config_schema jsonb NOT NULL DEFAULT '[]', output_schema jsonb NOT NULL DEFAULT '[]',
        default_config jsonb DEFAULT '{}', is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.auto_workflows (id bigserial PRIMARY KEY, name text NOT NULL, description text, nodes jsonb NOT NULL, edges jsonb NOT NULL,
        variables_schema jsonb NOT NULL DEFAULT '[]', default_variables jsonb NOT NULL DEFAULT '{}', is_builtin boolean DEFAULT false, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.auto_engine_workflows (purpose text PRIMARY KEY, workflow_id bigint NOT NULL REFERENCES public.auto_workflows(id), source_workflow_id bigint, source_md5 text, engine_md5 text);
      CREATE TABLE public.auto_engine_block_copies (engine_block_id bigint PRIMARY KEY REFERENCES public.auto_blocks(id) ON DELETE CASCADE, source_block_id bigint NOT NULL REFERENCES public.auto_blocks(id) ON DELETE CASCADE);
      CREATE TABLE public.auto_engine_block_steps (id bigserial PRIMARY KEY, block_id bigint NOT NULL REFERENCES public.auto_blocks(id) ON DELETE RESTRICT);
      CREATE TABLE public.auto_elements (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, xpath text NOT NULL, description text, category text,
        is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`)
    const seed = async () => {
      await db.query('TRUNCATE public.auto_elements, public.auto_engine_block_steps, public.auto_engine_block_copies, public.auto_engine_workflows, public.auto_workflows, public.auto_blocks, supabase_migrations.schema_migrations RESTART IDENTITY CASCADE')
      await db.query(`INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin) VALUES ('fb_dialog', '//*[@role=''dialog'']', 'Dialog Facebook', 'facebook', true)`)
      await db.query(`INSERT INTO public.auto_blocks (id, name, category, code, is_builtin) VALUES ($1, 'fb_find_search_data_summary', 'data', $2, true), ($3, $4, 'data', $2, true), ($5, $6, 'facebook', 'x', true)`,
        [2724, LIVE.summary.code, LIVE.summary.id, LIVE.summary.name, LIVE.collect.id, LIVE.collect.name])
      await db.query(`SELECT setval('public.auto_blocks_id_seq', 2921)`)
      await db.query('INSERT INTO public.auto_workflows (id, name, nodes, edges, variables_schema, default_variables, is_builtin) VALUES ($1, $2, $3, $4, $5, $6, true), ($7, $8, $9, $10, $11, $12, true)',
        [LIVE.workflow.id, LIVE.workflow.name, JSON.stringify(LIVE.workflow.nodes), JSON.stringify(LIVE.workflow.edges), JSON.stringify(LIVE.workflow.variablesSchema), JSON.stringify(LIVE.workflow.defaultVariables),
          LIVE.legacy.workflowId, LIVE.legacy.workflowName, JSON.stringify(LIVE.legacy.nodes), JSON.stringify(LIVE.legacy.edges), '[]', '{}'])
      await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id, source_workflow_id) VALUES ('facebook_find_data_search', $1, $2)`, [LIVE.workflow.id, LIVE.legacy.workflowId])
      await db.query('INSERT INTO public.auto_engine_block_copies VALUES ($1, 2724)', [LIVE.summary.id])
    }
    const state = () => one(`SELECT md5(w.nodes::text || w.edges::text) AS graph, md5(w.variables_schema::text || w.default_variables::text) AS vars, w.nodes, w.edges, w.default_variables,
      (SELECT md5(code) FROM public.auto_blocks WHERE id = $2) AS summary,
      (SELECT json_build_object('id', id, 'md5', md5(code), 'kind', kind, 'category', category, 'builtin', is_builtin, 'config', config_schema) FROM public.auto_blocks WHERE name = $3) AS block,
      (SELECT md5(nodes::text || edges::text) FROM public.auto_workflows WHERE id = $4) AS legacy, (SELECT count(*)::int FROM public.auto_blocks) AS blocks
      FROM public.auto_workflows w WHERE w.id = $1`, [LIVE.workflow.id, LIVE.summary.id, V577.BLOCK_NAME, LIVE.legacy.workflowId])

    await seed()
    const before = await state()
    assert.deepEqual([before.graph, before.vars, before.summary, before.legacy, before.block], [LIVE.workflow.md5, LIVE.workflow.varsMd5, LIVE.summary.md5, LIVE.legacy.workflowMd5, null],
      'fixture dựng lại đúng md5 production (jsonb::text của Postgres)')
    ok('fixture: workflow / block dựng lại khớp md5 đọc từ production')

    await db.query(migration)
    const after = await state()
    assert.equal(after.block.md5, V577.ADMINS_MD5)
    assert.deepEqual([after.block.id, after.block.kind, after.block.category, after.block.builtin, after.block.config], [2922, 'js', 'facebook', true, []])
    assert.equal(after.summary, V577.SUMMARY_NEW_MD5)
    assert.equal(after.legacy, LIVE.legacy.workflowMd5)
    assert.deepEqual(after.nodes.slice(0, -1), LIVE.workflow.nodes, 'các node cũ giữ nguyên, đúng thứ tự')
    assert.deepEqual(after.nodes.at(-1), { id: V577.NODE_ID, blockId: 2922, blockName: 'fb_collect_search_group_admins', config: {}, label: 'Lấy quản trị viên group', position: { x: 2470, y: 160 } })
    assert.deepEqual(after.edges, [...LIVE.workflow.edges.filter(edge => edge.id !== 'e-collect-groups-summary'), ...V577.NEW_EDGES])
    assert.equal(after.default_variables[V577.VAR_NAME], false)
    // Đường đi: collect_groups → collect_group_admins → summary, không còn đường tắt.
    const next = id => after.edges.filter(edge => edge.source === id).map(edge => edge.target)
    assert.deepEqual([next('collect_groups'), next(V577.NODE_ID)], [[V577.NODE_ID], ['summary']])
    assert.equal(md5(await (async () => (await one('SELECT code FROM public.auto_blocks WHERE name = $1', [V577.BLOCK_NAME])).code)()), V577.ADMINS_MD5)
    ok('migration: block mới, node giữa "Tải group" và "Tổng kết", biến mặc định tắt, block tổng kết bản mới, bộ cũ không đổi')

    await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261118000000', $1, ARRAY[$2])`, [V577.NAME, migration])
    await assert.rejects(db.query(migration), /đã có trong sổ migration/)
    await db.query('ROLLBACK')
    await db.query('DELETE FROM supabase_migrations.schema_migrations')
    await assert.rejects(db.query(migration), /khác bản đã đọc/)
    await db.query('ROLLBACK')
    assert.deepEqual(await state(), after, 'lần chạy bị từ chối không đổi gì')
    ok('chạy lại bị từ chối (sổ migration, workflow đã đổi), không đổi dữ liệu')

    await db.query(rollback)
    const reverted = await state()
    assert.deepEqual([reverted.graph, reverted.vars, reverted.summary, reverted.legacy, reverted.block, reverted.blocks], [before.graph, before.vars, before.summary, before.legacy, null, before.blocks])
    await assert.rejects(db.query(rollback), /không thấy block/)
    await db.query('ROLLBACK')
    ok('bản gỡ: workflow, biến, block tổng kết về đúng md5 trước V577, block mới bị xoá; gỡ lần hai bị từ chối')

    // Guard: workflow / block tổng kết đã có người sửa thì migration dừng; block đã sửa sau V577 thì bản gỡ không ghi đè.
    await seed()
    await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE id = $1`, [LIVE.summary.id])
    await assert.rejects(db.query(migration), /block tổng kết .* khác bản đã đọc/)
    await db.query('ROLLBACK')
    await seed()
    await db.query(`UPDATE public.auto_workflows SET default_variables = default_variables || '{"x":1}' WHERE id = $1`, [LIVE.workflow.id])
    await assert.rejects(db.query(migration), /workflow .* khác bản đã đọc/)
    await db.query('ROLLBACK')
    await seed()
    await db.query(migration)
    await db.query(`UPDATE public.auto_blocks SET code = code || ' ' WHERE name = $1`, [V577.BLOCK_NAME])
    await assert.rejects(db.query(rollback), /không thấy block/)
    await db.query('ROLLBACK')
    await seed()
    await db.query(migration)
    await db.query(`UPDATE public.auto_workflows SET nodes = jsonb_set(nodes, '{0,label}', '"khác"') WHERE id = $1`, [LIVE.workflow.id])
    await assert.rejects(db.query(rollback), /không phải bản V577/)
    await db.query('ROLLBACK')
    ok('guard: dữ liệu khác bản đã đọc thì migration dừng; đã có sửa khác sau V577 thì bản gỡ không ghi đè')

    // ----- V578: selector sang auto_elements -----
    const migration578 = fs.readFileSync(path.join(ROOT, `migrations/${V.NAME}.sql`), 'utf8')
    const rollback578 = fs.readFileSync(path.join(ROOT, `migrations/${V.ROLLBACK_NAME}.sql`), 'utf8')
    assert.equal(md5(migration578), md5(V.migration), 'file migration V578 khác bản sinh: chạy lại node scripts/build-v578-sql.cjs')
    assert.equal(md5(rollback578), md5(V.rollback), 'file gỡ V578 khác bản sinh')
    const state578 = () => one(`SELECT (SELECT md5(code) FROM public.auto_blocks WHERE name = $1) AS block,
      (SELECT json_agg(json_build_object('name', name, 'xpath', xpath, 'category', category, 'builtin', is_builtin) ORDER BY id) FROM public.auto_elements WHERE name <> 'fb_dialog') AS elements,
      (SELECT count(*)::int FROM public.auto_elements) AS total, (SELECT md5(nodes::text || edges::text) FROM public.auto_workflows WHERE id = $2) AS graph,
      (SELECT md5(code) FROM public.auto_blocks WHERE id = $3) AS summary`, [V.BLOCK_NAME, LIVE.workflow.id, LIVE.summary.id])
    await seed()
    await assert.rejects(db.query(migration578), /không còn đúng bản V577/)   // chưa có V577 thì không chạy
    await db.query('ROLLBACK')
    await db.query(migration)
    const before578 = await state578()
    assert.deepEqual([before578.block, before578.elements, before578.total], [V577.ADMINS_MD5, null, 1])
    await db.query(migration578)
    const after578 = await state578()
    assert.equal(after578.block, V.NEW_MD5)
    assert.deepEqual(after578.elements, V.ELEMENTS.map(element => ({ name: element.name, xpath: element.xpath, category: 'facebook', builtin: true })))
    assert.deepEqual([after578.total, after578.graph, after578.summary], [9, before578.graph, before578.summary], 'element cũ, workflow, block tổng kết không đổi')
    await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261118000001', $1, ARRAY[$2])`, [V.NAME, migration578])
    await assert.rejects(db.query(migration578), /đã có trong sổ migration/)
    await db.query('ROLLBACK')
    await db.query('DELETE FROM supabase_migrations.schema_migrations')
    await assert.rejects(db.query(migration578), /không còn đúng bản V577/)
    await db.query('ROLLBACK')
    ok('V578: thêm 8 element đúng XPath, code block bản mới; workflow / block tổng kết / element cũ không đổi; chạy lại bị từ chối')
    // Admin đã sửa XPath ở màn Element: bản gỡ vẫn gỡ được (bản V577 không dùng element), không đụng element khác.
    await db.query(`UPDATE public.auto_elements SET xpath = '//*[@role=''main'']//li' WHERE name = 'fb_group_admin_row'`)
    await db.query(rollback578)
    const reverted578 = await state578()
    assert.deepEqual([reverted578.block, reverted578.elements, reverted578.total], [V577.ADMINS_MD5, null, 1])
    await assert.rejects(db.query(rollback578), /không phải bản V578/)
    await db.query('ROLLBACK')
    // Trùng tên element có sẵn: migration dừng, không ghi đè.
    await db.query(`INSERT INTO public.auto_elements (name, xpath, category) VALUES ('fb_profile_tablist', '//x', 'facebook')`)
    await assert.rejects(db.query(migration578), /đã có element trùng tên: fb_profile_tablist/)
    await db.query('ROLLBACK')
    ok('V578: bản gỡ trả code V577 và xoá 8 element; trùng tên element có sẵn thì migration dừng')
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}

async function main() {
  const shared = loadShared()
  checkExtract(shared)
  if (args.has('--no-browser')) console.log('  - bỏ qua phần Chromium (--no-browser)')
  else await checkPageScripts()
  await checkBlock()
  await checkSummary(shared)
  if (args.has('--no-sql')) console.log('  - bỏ qua phần PostgreSQL (--no-sql)')
  else await checkSql()
  console.log(`PASS ${passed} nhóm`)
}
main().catch(error => { console.error(error); process.exit(1) })
