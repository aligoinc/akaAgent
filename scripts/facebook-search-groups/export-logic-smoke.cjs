// Logic dựng file Excel tab "Data tìm được" (src/renderer/src/components/CampaignPanels/foundDataExport.ts), không Electron:
// trộn thẻ log vào kết quả cũ/kết quả đã lưu đủ, gộp nhóm trùng, thứ tự từ khóa, chặn lệch số bài/nguyên văn.
// Chạy: node scripts/facebook-search-groups/export-logic-smoke.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { buildSync } = require('esbuild')
const XLSX = require('xlsx')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'found-export-logic-'))
try {
  buildSync({ entryPoints: [path.resolve(__dirname, '../../src/renderer/src/components/CampaignPanels/foundDataExport.ts')],
    outfile: path.join(dir, 'export.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const h = require(path.join(dir, 'export.cjs'))
  const rows = items => XLSX.utils.sheet_to_json(h.buildFoundDataWorkbook(items, 'facebook_find_data_search').Sheets.Sheet1, { header: 1, defval: '' })

  // toFacebookGroupList: tên sạch, số bài 0 coi như không có, trường thêm hợp lệ được giữ.
  const [english, stored] = h.toFacebookGroupList([
    { url: 'https://www.facebook.com/groups/1/', name: 'Profile photo of  A', memberCount: '7500', postsPerDay: 0, keyword: 'k1', joinState: 'bad' },
    { url: 'https://www.facebook.com/groups/2/', name: 'B', postsPerDay: 4, postsText: '4', joinState: 'joined', unreadPosts: 2, cardVersion: 2 }
  ])
  assert.deepEqual(english, { url: 'https://www.facebook.com/groups/1/', name: 'A', privacy: undefined, memberCount: 7500, postsPerDay: undefined, keyword: 'k1' })
  assert.deepEqual(stored, { url: 'https://www.facebook.com/groups/2/', name: 'B', privacy: undefined, memberCount: undefined, postsPerDay: 4,
    keyword: undefined, postsText: '4', joinState: 'joined', unreadPosts: 2, cardVersion: 2 })

  // Kết quả cũ: lấy số liệu theo thẻ; thẻ thiếu trường thì giữ số đã lưu. Kết quả đã lưu đủ: giữ nguyên.
  const card = { name: 'Tên thẻ', privacy: 'Riêng tư', memberCount: 8000, postsPerDay: 90, postsText: '90+', friendMemberCount: 2, joinState: 'not_joined' }
  assert.deepEqual(h.applyFacebookGroupCard({ ...english, privacy: 'Công khai' }, card), { ...english, privacy: 'Riêng tư', memberCount: 8000,
    postsPerDay: 90, postsText: '90+', friendMemberCount: 2, joinState: 'not_joined', unreadPosts: undefined, memberSince: undefined })
  assert.equal(h.applyFacebookGroupCard({ ...english, postsPerDay: 3 }, { joinState: 'joined', unreadPosts: 5 }).postsPerDay, 3)
  assert.equal(h.applyFacebookGroupCard({ ...english, postsPerDay: 3 }, { joinState: 'joined', unreadPosts: 5 }).postsText, undefined)
  assert.equal(h.applyFacebookGroupCard({ ...english, name: '' }, card).name, 'Tên thẻ')
  assert.deepEqual(h.applyFacebookGroupCard(stored, card), stored)
  assert.equal(h.applyFacebookGroupCard({ ...stored, name: '' }, card).name, 'Tên thẻ')
  assert.equal(h.applyFacebookGroupCard(english, undefined), english)
  assert.equal(h.needsFacebookGroupCards([{ kind: 'facebookGroup', value: stored.url, facebookGroup: stored }]), false)
  assert.equal(h.needsFacebookGroupCards([{ kind: 'facebookGroup', value: english.url, facebookGroup: english }]), true)
  assert.equal(h.needsFacebookGroupCards([{ kind: 'phone', value: '0901234567' }]), false)
  const applied = h.applyFacebookGroupCards([
    { kind: 'facebookGroup', value: 'https://m.facebook.com/groups/1?ref=x', name: '', facebookGroup: { ...english, name: '' } },
    { kind: 'phone', value: '0901234567' }
  ], [{ key: 'facebook.com/groups/1', seenAt: '2026-09-27T12:00:00Z', card }])
  assert.equal(applied[0].name, 'Tên thẻ')
  assert.equal(applied[0].facebookGroup.postsText, '90+')
  assert.deepEqual(applied[1], { kind: 'phone', value: '0901234567' })
  console.log('PASS trộn thẻ log: kết quả cũ theo thẻ, thiếu thì giữ số đã lưu, kết quả đã lưu đủ giữ nguyên, khớp URL khác dạng')

  // Gộp nhóm trùng: từ khóa/tài khoản theo thứ tự tìm ra dù dữ liệu đến mới → cũ hay cũ → mới; thời gian sớm nhất.
  const item = (keyword, account, foundAt, group = {}) => ({ kind: 'facebookGroup', value: 'https://www.facebook.com/groups/9/', name: 'G',
    keywords: [keyword], accountNames: [account], foundAt, facebookGroup: { url: 'https://www.facebook.com/groups/9/', name: 'G', ...group } })
  const newestFirst = [item('c', 'TK2', '2026-09-27T12:30:00Z'), item('b', 'TK1', '2026-09-27T12:20:00Z'), item('a', 'TK1', '2026-09-27T12:10:00Z')]
  const tailOf = list => rows(list)[1].slice(11)
  const firstAt = new Date('2026-09-27T12:10:00Z').toLocaleString('vi-VN')
  assert.deepEqual(tailOf(newestFirst), ['a, b, c', 'TK1, TK2', firstAt])
  assert.deepEqual(tailOf([...newestFirst].reverse()), ['a, b, c', 'TK1, TK2', firstAt])
  // Số liệu: dòng đến trước thắng; số bài và nguyên văn đi theo cặp; nguyên văn lệch số bài thì để trống.
  assert.deepEqual(rows([item('x', 'T', '2026-09-27T12:30:00Z', { postsPerDay: 20, postsText: '20+', memberCount: 100 }),
    item('y', 'T', '2026-09-27T12:10:00Z', { postsPerDay: 5, postsText: '5', memberCount: 50, unreadPosts: 4 })])[1].slice(2, 8),
    [100, 20, 'ngày', '', '20+', 4])
  assert.deepEqual(rows([item('x', 'T', '2026-09-27T12:30:00Z', { postsText: '20+' }),
    item('y', 'T', '2026-09-27T12:10:00Z', { postsPerDay: 5 })])[1].slice(3, 7), [5, 'ngày', '', ''])
  assert.deepEqual(rows([item('x', 'T', undefined, { postsPerDay: 7, postsText: '8' })])[1].slice(3, 7), [7, 'ngày', '', ''])
  assert.equal(rows([item('x', 'T', 'không phải ngày')])[1][13], '')
  console.log('PASS gộp nhóm trùng: thứ tự từ khóa/tài khoản theo thời gian tìm ra, thời gian sớm nhất, số bài/nguyên văn không lệch')

  // Giá trị hiển thị dùng chung cho bảng ở tab và file Excel.
  const noAdmins = { adminScan: undefined, admins: [], adminSummary: '' }
  assert.deepEqual(h.describeFacebookGroup(h.applyFacebookGroupCard(english, card)), { memberCount: 8000, postsPerDay: 90, postsText: '90+',
    privacy: 'Riêng tư', joinState: 'Chưa tham gia', memberSince: '', unreadPosts: undefined, friendMemberCount: 2, ...noAdmins })
  assert.deepEqual(h.describeFacebookGroup({ url: 'u', name: 'n', privacy: 'Public', postsPerDay: 7, postsText: '8', joinState: 'requested' }),
    { memberCount: undefined, postsPerDay: 7, postsText: '', privacy: 'Công khai', joinState: 'Đã gửi yêu cầu', memberSince: '',
      unreadPosts: undefined, friendMemberCount: undefined, ...noAdmins })
  assert.deepEqual(h.describeFacebookGroup(undefined), { memberCount: undefined, postsPerDay: undefined, postsText: '', privacy: '',
    joinState: '', memberSince: '', unreadPosts: undefined, friendMemberCount: undefined, ...noAdmins })
  assert.equal(h.needsFacebookGroupCard(english), true)
  assert.equal(h.needsFacebookGroupCard(stored), false)
  console.log('PASS giá trị hiển thị chung bảng/Excel: riêng tư tiếng Việt, nguyên văn số bài chỉ khi khớp, nhãn trạng thái tham gia')

  // Quản trị viên của group (chiến dịch bật "Lấy thông tin quản trị viên của group"): cột thêm ở sheet nhóm + sheet "Admin group".
  const sheets = items => { const book = h.buildFoundDataWorkbook(items, 'facebook_find_data_search'); return Object.fromEntries(book.SheetNames.map(name => [name, XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' })])) }
  const adminA = { uid: '1001', name: 'Căn hộ A', url: 'https://www.facebook.com/canhoa', phones: ['090 322 12 29', '0977123456'], emails: ['A@Example.com'], profileRead: true }
  const adminB = { uid: '1002', name: 'Mỹ Trinh', url: 'https://www.facebook.com/profile.php?id=1002', phones: [], emails: [] }
  const groupItem = (id, name, keyword, foundAt, extra) => ({ kind: 'facebookGroup', value: `https://www.facebook.com/groups/${id}/`, name, keywords: [keyword], accountNames: ['TK1'], foundAt,
    facebookGroup: h.toFacebookGroupList([{ url: `https://www.facebook.com/groups/${id}/`, name, ...extra }])[0] })
  const listed = groupItem(1, 'Hội A', 'k1', '2026-11-18T03:00:00Z', { adminScan: 'listed', admins: [adminA, adminB, { name: 'sai', url: 'https://evil.example/x' }] })
  assert.deepEqual(listed.facebookGroup.admins, [
    { name: 'Căn hộ A', url: 'https://www.facebook.com/canhoa', uid: '1001', phones: ['0903221229', '0977123456'], emails: ['a@example.com'], profileRead: true },
    { name: 'Mỹ Trinh', url: 'https://www.facebook.com/profile.php?id=1002', uid: '1002', phones: [], emails: [] }])
  assert.deepEqual(h.describeFacebookGroup(listed.facebookGroup).adminSummary, '2')
  const hidden = groupItem(2, 'Hội B', 'k1', '2026-11-18T03:00:00Z', { adminScan: 'not_listed', admins: [adminA] })
  const failed = groupItem(3, 'Hội C', 'k2', '2026-11-18T03:00:00Z', { adminScan: 'failed' })
  const unscanned = groupItem(4, 'Hội D', 'k2', '2026-11-18T03:00:00Z', {})
  assert.deepEqual([h.describeFacebookGroup(hidden.facebookGroup).admins, h.describeFacebookGroup(hidden.facebookGroup).adminSummary], [[], 'Facebook không hiện'])
  let book = sheets([listed, hidden, failed, unscanned])
  assert.deepEqual(Object.keys(book), ['Sheet1', 'Admin group'])
  assert.equal(book.Sheet1[0].length, 15)
  assert.equal(book.Sheet1[0][14], 'Quản trị viên')
  assert.deepEqual(book.Sheet1.slice(1).map(row => row[14]), [2, 'Facebook không hiện', 'Chưa đọc được', ''])
  assert.deepEqual(book['Admin group'], [
    ['Tên group', 'Link group', 'Tên quản trị viên', 'Link trang cá nhân', 'UID', 'Số điện thoại', 'Email', 'Từ khóa'],
    ['Hội A', 'https://www.facebook.com/groups/1/', 'Căn hộ A', 'https://www.facebook.com/canhoa', '1001', '0903221229, 0977123456', 'a@example.com', 'k1'],
    ['Hội A', 'https://www.facebook.com/groups/1/', 'Mỹ Trinh', 'https://www.facebook.com/profile.php?id=1002', '1002', '', '', 'k1']])
  // Chiến dịch không bật: file giữ đúng mẫu 14 cột, không có sheet quản trị viên.
  book = sheets([unscanned])
  assert.deepEqual([Object.keys(book), book.Sheet1[0].length], [['Sheet1'], 14])
  // Chỉ group không đọc được danh sách: có cột lý do, không có sheet rỗng.
  book = sheets([hidden])
  assert.deepEqual([Object.keys(book), book.Sheet1[1][14]], [['Sheet1'], 'Facebook không hiện'])
  // Group trùng giữa hai lượt: lấy lượt đã đọc được danh sách dù lượt kia đến trước; từ khoá gộp; lẫn loại data khác thì sheet nhóm đổi tên.
  const again = groupItem(1, 'Hội A', 'k2', '2026-11-18T05:00:00Z', { adminScan: 'failed' })
  book = sheets([again, listed, { kind: 'phone', value: '0903221229', name: 'X' }])
  assert.deepEqual(Object.keys(book), ['Sheet1', 'Group Facebook', 'Admin group'])
  assert.equal(book['Group Facebook'][1][14], 2)
  assert.deepEqual(book['Admin group'].slice(1).map(row => [row[2], row[7]]), [['Căn hộ A', 'k1, k2'], ['Mỹ Trinh', 'k1, k2']])
  console.log('PASS quản trị viên của group: cột thêm + sheet "Admin group", lý do khi Facebook không hiện, không bật thì giữ mẫu 14 cột')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
