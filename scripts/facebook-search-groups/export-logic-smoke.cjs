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
  assert.deepEqual(h.describeFacebookGroup(h.applyFacebookGroupCard(english, card)), { memberCount: 8000, postsPerDay: 90, postsText: '90+',
    privacy: 'Riêng tư', joinState: 'Chưa tham gia', memberSince: '', unreadPosts: undefined, friendMemberCount: 2 })
  assert.deepEqual(h.describeFacebookGroup({ url: 'u', name: 'n', privacy: 'Public', postsPerDay: 7, postsText: '8', joinState: 'requested' }),
    { memberCount: undefined, postsPerDay: 7, postsText: '', privacy: 'Công khai', joinState: 'Đã gửi yêu cầu', memberSince: '',
      unreadPosts: undefined, friendMemberCount: undefined })
  assert.deepEqual(h.describeFacebookGroup(undefined), { memberCount: undefined, postsPerDay: undefined, postsText: '', privacy: '',
    joinState: '', memberSince: '', unreadPosts: undefined, friendMemberCount: undefined })
  assert.equal(h.needsFacebookGroupCard(english), true)
  assert.equal(h.needsFacebookGroupCard(stored), false)
  console.log('PASS giá trị hiển thị chung bảng/Excel: riêng tư tiếng Việt, nguyên văn số bài chỉ khi khớp, nhãn trạng thái tham gia')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
