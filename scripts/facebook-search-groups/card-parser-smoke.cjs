// Bộ đọc thẻ nhóm Facebook Search (src/shared/facebookSearchGroupCard.ts).
// card-samples.json: 385 thẻ thật (rawText 30 ngày tới 10/11/2026, đủ dạng tiếng Việt/tiếng Anh/đã tham gia/có bạn
// bè/N+/By Trang), tên nhóm và tên Trang đã thay bằng tên giả. Kết quả mong đợi tính bằng cách đọc độc lập (Python),
// số thành viên và số bài tiếng Việt lấy từ block fb_collect_search_groups đang chạy. Chạy: node scripts/facebook-search-groups/card-parser-smoke.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { buildSync } = require('esbuild')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-search-card-'))
try {
  buildSync({ entryPoints: [path.resolve(__dirname, '../../src/shared/facebookSearchGroupCard.ts')], outfile: path.join(dir, 'card.cjs'),
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const h = require(path.join(dir, 'card.cjs'))
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'card-samples.json'), 'utf8'))
  assert.ok(fixture.cards.length >= 300)
  const states = new Set()
  for (const sample of fixture.cards) {
    const parsed = h.parseFacebookSearchGroupCard(sample.text)
    const { name, ...fields } = parsed
    assert.deepEqual(fields, sample.expected, sample.text)
    assert.match(name, /^Nhóm mẫu \d+$/, sample.text)
    states.add(parsed.joinState)
  }
  assert.deepEqual([...states].sort(), ['joined', 'not_joined', 'requested'])
  console.log(`PASS ${fixture.cards.length} thẻ thật: privacy, thành viên, số bài + dấu +, bài chưa đọc, bạn bè, tham gia từ, trạng thái, tên`)

  const parse = h.parseFacebookSearchGroupCard
  // Tên có chữ giống phần thông tin: lấy phần thông tin cuối cùng.
  assert.deepEqual(parse('Chợ Public · 5 members giá rẻ Công khai · 1,6K thành viên · 7 bài viết/ngày Tham gia'), {
    name: 'Chợ Public · 5 members giá rẻ', privacy: 'Công khai', memberCount: 1600, postsPerDay: 7, postsText: '7', joinState: 'not_joined' })
  // Tên có "10 bài viết/ngày"/"Tham gia" không được đọc thành thông tin.
  assert.deepEqual(parse('Đăng 10 bài viết/ngày - Tham gia ngay Riêng tư · 1 triệu thành viên Tham gia'), {
    name: 'Đăng 10 bài viết/ngày - Tham gia ngay', privacy: 'Riêng tư', memberCount: 1000000, joinState: 'not_joined' })
  assert.deepEqual(parse('  =SUM(A1)\n Public ·   1.2M members ·  1 unread post · Recently joined   1 friend is a member  Visit '), {
    name: '=SUM(A1)', privacy: 'Công khai', memberCount: 1200000, unreadPosts: 1, friendMemberCount: 1, memberSince: 'Mới tham gia', joinState: 'joined' })
  assert.deepEqual(parse('X Private · 899 members · 3 posts per day Join'), {
    name: 'X', privacy: 'Riêng tư', memberCount: 899, postsPerDay: 3, postsText: '3', joinState: 'not_joined' })
  assert.deepEqual(parse('Y Công khai · 1.234 thành viên · Là thành viên từ năm 2019 Truy cập'), {
    name: 'Y', privacy: 'Công khai', memberCount: 1234, memberSince: '2019', joinState: 'joined' })
  assert.deepEqual(parse('Z Public · 7.5K members · Member since 2019 Visit'), {
    name: 'Z', privacy: 'Công khai', memberCount: 7500, memberSince: '2019', joinState: 'joined' })
  assert.deepEqual(parse('Q Riêng tư · 3,5K thành viên Hủy yêu cầu'), { name: 'Q', privacy: 'Riêng tư', memberCount: 3500, joinState: 'requested' })
  // Ngôn ngữ/mẫu lạ: không đoán.
  assert.deepEqual(parse('กลุ่ม สาธารณะ · สมาชิก 5.2 พัน คน เข้าร่วม'), {})
  assert.deepEqual(parse(''), {})
  assert.deepEqual(parse(null), {})
  assert.deepEqual(parse('Chỉ có tên'), {})
  console.log('PASS ca biên: tên chứa chữ giống thông tin, công thức Excel, khoảng trắng lạ, đơn vị triệu/M, dấu tách nghìn, năm tham gia, đã gửi yêu cầu, mẫu lạ')

  assert.equal(h.cleanFacebookGroupName('Profile photo of  Những người con Hải Vân'), 'Những người con Hải Vân')
  assert.equal(h.cleanFacebookGroupName('Ảnh đại diện của NHỮNG NGƯỜI CON HẢI HẬU'), 'NHỮNG NGƯỜI CON HẢI HẬU')
  assert.equal(h.cleanFacebookGroupName('Hội Profile photo of'), 'Hội Profile photo of')
  assert.equal(h.cleanFacebookGroupName(undefined), '')
  assert.equal(h.facebookGroupUrlKey('https://www.facebook.com/groups/482000583973699/'), 'facebook.com/groups/482000583973699')
  assert.equal(h.facebookGroupUrlKey('https://m.facebook.com/groups/HoiChoQuan1?ref=share'), 'facebook.com/groups/hoichoquan1')
  assert.equal(h.facebookGroupUrlKey('https://www.facebook.com/groups/%C4%91%C3%A0n/'), 'facebook.com/groups/đàn')
  assert.equal(h.facebookGroupUrlKey('https://example.test/groups/12/'), 'https://example.test/groups/12')
  assert.equal(h.facebookGroupUrlKey(''), '')
  assert.equal(h.parseFacebookCount('1,6', 'K'), 1600)
  assert.equal(h.parseFacebookCount('1,234'), 1234)
  assert.equal(h.parseFacebookCount('12a'), undefined)
  console.log('PASS làm sạch tên, khoá URL nhóm, đọc số')

  const merged = h.mergeFacebookSearchGroupCards([
    { joinState: 'joined', unreadPosts: 25, memberCount: 1600, privacy: 'Công khai' },
    { joinState: 'not_joined', postsPerDay: 20, postsText: '20+', memberCount: 1500, friendMemberCount: 2, name: 'A' },
    { postsPerDay: 5, postsText: '5', name: 'B' }
  ])
  assert.deepEqual(merged, { joinState: 'joined', unreadPosts: 25, memberCount: 1600, privacy: 'Công khai',
    postsPerDay: 20, postsText: '20+', friendMemberCount: 2, name: 'A' })
  assert.deepEqual(h.mergeFacebookSearchGroupCards([]), {})
  console.log('PASS gộp nhiều thẻ của một nhóm: mỗi trường theo thẻ mới nhất có giá trị, số bài đi theo cặp')

  assert.deepEqual(h.readFacebookSearchGroupCardFields({ url: 'x', postsText: '90+', unreadPosts: '25', friendMemberCount: 0,
    joinState: 'joined', memberSince: '02/2026', cardVersion: 2 }),
  { postsText: '90+', unreadPosts: 25, friendMemberCount: 0, joinState: 'joined', memberSince: '02/2026', cardVersion: 2 })
  assert.deepEqual(h.readFacebookSearchGroupCardFields({ postsText: '0', unreadPosts: -1, friendMemberCount: 1.5, joinState: 'admin',
    memberSince: '13/2026', cardVersion: 0 }), {})
  assert.deepEqual(h.readFacebookSearchGroupCardFields({ postsText: '=1+1', memberSince: 'Mới tham gia', joinState: 'requested' }),
    { memberSince: 'Mới tham gia', joinState: 'requested' })
  for (const value of [null, undefined, 'x', 1, []]) assert.deepEqual(h.readFacebookSearchGroupCardFields(value), {})
  console.log('PASS đọc trường thêm từ payload: nhận đúng kiểu/mẫu, bỏ giá trị sai')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
