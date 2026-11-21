// Kiểm đẩy quản trị viên group vào hai Nhóm data riêng (UID / SĐT), docs/FIND_DATA_GROUP_ADMIN_DATA_GROUPS.md.
//   node scripts/find-data-push/group-admin-data-groups-smoke.cjs [<file JSON dữ liệu thật>]
// Phần A: hàm dựng dòng (src/shared/findDataGroupAdminRows.ts). Phần B: lớp CampaignScheduler thật (pushFoundDataToDataGroups)
// với supabase giả ghi lại lời gọi nạp nhóm data. Phần C (khi truyền file): dựng dòng từ quản trị viên thật đã xuất (chỉ đọc),
// file là [{ campaignId, groups: [{ url, name, keyword, adminScan, admins }] }], không commit.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createLoader, loadScheduler, root } = require('./load-scheduler.cjs')

const load = createLoader()
const { buildFindDataGroupAdminRows } = load(path.join(root, 'src/shared/findDataGroupAdminRows.ts'))
const { readFacebookGroupAdminFields } = load(path.join(root, 'src/shared/facebookGroupAdmins.ts'))

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const admin = (uid, name, phones = [], emails = [], extra = {}) => ({
  uid, name, url: `https://www.facebook.com/profile.php?id=${uid}`, phones, emails, profileRead: true, ...extra
})
const G1 = { url: 'https://www.facebook.com/groups/111', name: 'Group 1', keyword: 'nhà đất' }
const G2 = { url: 'https://www.facebook.com/groups/222', name: 'Group 2', keyword: 'nhà đất' }
const G3 = { url: 'https://www.facebook.com/groups/333', name: 'Group 3', keyword: 'căn hộ' }

// ---------------------------------------------------------------- A. dựng dòng
check('người quản trị nhiều group: một dòng UID, ghi đủ group và từ khoá', () => {
  const r = buildFindDataGroupAdminRows([
    { ...G1, admins: [admin('100001', 'A', ['0901000001'])] },
    { ...G3, admins: [admin('100001', 'A', ['0901000001'], ['a@x.vn'])] }
  ], null, { sourceCampaignId: 9 })
  assert.equal(r.uidRows.length, 1)
  assert.equal(r.uidRows[0].uid, '100001')
  assert.equal(r.uidRows[0].contactType, 'person')
  assert.equal(r.uidRows[0].flatformType, 'facebook')
  assert.deepEqual(r.uidRows[0].extraData.adminGroups.map(g => g.url), [G1.url, G3.url])
  assert.deepEqual(r.uidRows[0].extraData.keywords, ['nhà đất', 'căn hộ'])
  assert.deepEqual(r.uidRows[0].extraData.emails, ['a@x.vn'])
  assert.equal(r.uidRows[0].extraData.sourceCampaignId, 9)
  assert.equal(r.uidRows[0].extraData.sourceProfileKind, 'group_admin')
  assert.equal(r.phoneRows.length, 1)
  assert.equal(r.adminCount, 1)
})

check('SĐT dùng chung nhiều quản trị viên: một dòng, ghi đủ người; một người hai số: hai dòng', () => {
  const r = buildFindDataGroupAdminRows([
    { ...G1, admins: [admin('100001', 'A', ['0902000002']), admin('100002', 'B', ['0902000002', '0903000003'])] },
    { ...G2, admins: [admin('100003', 'C', ['+84 902 000 002']), admin('100004', 'D', ['0902000002'])] }
  ], null)
  assert.equal(r.uidRows.length, 4)
  const byPhone = Object.fromEntries(r.phoneRows.map(row => [row.phone, row]))
  assert.deepEqual(Object.keys(byPhone).sort(), ['0902000002', '0903000003'])
  assert.equal(byPhone['0902000002'].extraData.adminCount, 4)
  assert.deepEqual(byPhone['0902000002'].extraData.admins.map(a => a.uid), ['100001', '100002', '100003', '100004'])
  assert.equal(byPhone['0902000002'].name, 'A')
  assert.deepEqual(byPhone['0902000002'].extraData.adminGroups.map(g => g.url), [G1.url, G2.url])
  assert.equal(byPhone['0903000003'].extraData.adminCount, 1)
  assert.equal(byPhone['0903000003'].contactType, 'phone')
})

check('bỏ chính tài khoản chạy chiến dịch, giữ số của người khác dù trùng', () => {
  const r = buildFindDataGroupAdminRows([
    { ...G1, admins: [admin('100009', 'Tôi', ['0904000004', '0905000005']), admin('100002', 'B', ['0904000004'])] }
  ], '100009')
  assert.deepEqual(r.uidRows.map(row => row.uid), ['100002'])
  assert.deepEqual(r.phoneRows.map(row => row.phone), ['0904000004'])
  assert.equal(r.phoneRows[0].extraData.adminCount, 1)
  assert.equal(r.skippedOwnAccount, true)
})

check('không có SĐT: chỉ dòng UID; số không phải di động VN bị bỏ', () => {
  const r = buildFindDataGroupAdminRows([{ ...G1, admins: [admin('100005', 'E', []), admin('100006', 'F', ['02838123456', 'abc'])] }], null)
  assert.equal(r.uidRows.length, 2)
  assert.equal(r.phoneRows.length, 0)
})

check('quản trị viên chỉ có link tên riêng (không UID) vẫn ra dòng UID bằng link', () => {
  const r = buildFindDataGroupAdminRows([{ ...G1, admins: [{ name: 'Trang E', url: 'https://www.facebook.com/trang.e', phones: [], emails: [] }] }], null)
  assert.equal(r.uidRows.length, 1)
  assert.equal(r.uidRows[0].uid, 'https://www.facebook.com/trang.e')
  assert.equal(r.uidRows[0].url, 'https://www.facebook.com/trang.e')
})

check('group không có quản trị viên / dữ liệu rỗng: không dòng nào, không lỗi', () => {
  const r = buildFindDataGroupAdminRows([{ ...G1 }, { ...G2, admins: [] }, { url: '', admins: [{ name: '', url: '', phones: [], emails: [] }] }], 'x')
  assert.deepEqual([r.uidRows.length, r.phoneRows.length, r.adminCount], [0, 0, 0])
})

check('danh sách trong phần thêm có trần 20', () => {
  const groups = Array.from({ length: 30 }, (_, i) => ({ url: `https://www.facebook.com/groups/${i + 1}`, name: `G${i}`, admins: [admin('100001', 'A', ['0906000006'])] }))
  const many = Array.from({ length: 30 }, (_, i) => admin(String(200000 + i), `P${i}`, ['0907000007']))
  const r = buildFindDataGroupAdminRows([...groups, { ...G1, admins: many }], null)
  assert.equal(r.uidRows.find(row => row.uid === '100001').extraData.adminGroups.length, 20)
  const shared = r.phoneRows.find(row => row.phone === '0907000007')
  assert.equal(shared.extraData.admins.length, 20)
  assert.equal(shared.extraData.adminCount, 30)
})

// ---------------------------------------------------------------- B. bộ lập lịch thật
async function runScheduler({ extraSettings, groups, ownUid = '100009', failAccount = false }) {
  const { CampaignScheduler } = loadScheduler()
  const scheduler = Object.create(CampaignScheduler.prototype)
  const calls = []
  const logs = []
  scheduler.running = true
  scheduler.supabase = {
    listDataTypeCategoryItems: async () => [
      { id: 11, code: 'phone' }, { id: 12, code: 'facebook_person' }, { id: 13, code: 'facebook_group' },
      { id: 14, code: 'facebook_post_url' }, { id: 15, code: 'zalo_group' }
    ],
    getAccount: async () => { if (failAccount) throw new Error('boom'); return { id: 7, facebookUid: ownUid } },
    ingestDataGroup: async (request) => {
      calls.push(request)
      return { insertedMembershipCount: request.rows.length, reactivatedMembershipCount: 0, alreadyMemberCount: 0, invalidCount: 0, incompatibleCount: 0, conflictCount: 0 }
    }
  }
  scheduler.logCampaignProgress = async (_c, message) => { logs.push(message) }
  const campaign = { id: 500, name: 'Tìm group', actionId: 'facebook_find_data_search', extraSettings }
  await scheduler.pushFoundDataToDataGroups(campaign, 7, { id: 77 }, { runId: 88, id: 1 }, 'nhà đất', {
    phones: [], linkGroupZalos: [], uids: [], postLinks: [], groupMembers: [], facebookGroups: groups, uidProfiles: [], phoneProfiles: []
  })
  return { calls, logs }
}

const realGroups = [
  { ...G1, adminScan: 'listed', admins: [admin('100009', 'Tôi', ['0904000004']), admin('100001', 'A', ['0902000002'])] },
  { ...G2, adminScan: 'listed', admins: [admin('100002', 'B', ['0902000002', '0903000003'])] }
].map(group => ({ ...group, ...readFacebookGroupAdminFields(group) }))

async function partB() {
  const destinations = {
    facebook_group: { groupId: 301, groupName: 'Group tìm được' },
    facebook_group_admin_uid: { groupId: 302, groupName: 'UID admin' },
    facebook_group_admin_phone: { groupId: 303, groupName: 'SĐT admin' }
  }
  {
    const { calls, logs } = await runScheduler({ extraSettings: { isFindFacebookGroupAdmins: true, findDataTargetDataGroups: destinations }, groups: realGroups })
    assert.deepEqual(calls.map(c => c.groupId), [301, 302, 303])
    const [g, u, p] = calls
    assert.equal(g.dataTypeCategoryItemId, 13)
    assert.equal(u.dataTypeCategoryItemId, 12)
    assert.equal(p.dataTypeCategoryItemId, 11)
    assert.deepEqual(u.rows.map(r => r.uid), ['100001', '100002'])
    assert.deepEqual(p.rows.map(r => r.phone), ['0902000002', '0903000003'])
    assert.equal(p.rows[0].extraData.adminCount, 2)
    assert.match(u.requestId, /:facebook_person~admin_uid:/)
    assert.match(p.requestId, /:phone~admin_phone:/)
    assert.match(g.requestId, /:facebook_group:/)
    assert.equal(new Set(calls.map(c => c.requestId)).size, 3)
    assert.equal(u.kind, 'scan')
    assert.equal(u.rows[0].extraData.sourceCampaignId, 500)
    assert(logs.some(l => l.startsWith('✅ Đã đẩy 2 quản trị viên group (UID) sang Nhóm data "UID admin"')), logs.join('\n'))
    assert(logs.some(l => l.startsWith('✅ Đã đẩy 2 SĐT quản trị viên group sang Nhóm data "SĐT admin"')), logs.join('\n'))
    console.log('PASS bộ lập lịch: group + UID + SĐT quản trị viên ra 3 lượt nạp riêng, bỏ tài khoản chạy, câu tiến trình đúng')
    passed += 1
  }
  {
    const { calls } = await runScheduler({ extraSettings: { isFindFacebookGroupAdmins: false, findDataTargetDataGroups: destinations }, groups: realGroups })
    assert.deepEqual(calls.map(c => c.groupId), [301])
    console.log('PASS bộ lập lịch: tắt "Lấy thông tin quản trị viên" thì không đẩy hai loại quản trị viên')
    passed += 1
  }
  {
    const { calls, logs } = await runScheduler({
      extraSettings: { isFindFacebookGroupAdmins: true, findDataTargetDataGroups: { facebook_group_admin_phone: destinations.facebook_group_admin_phone } },
      groups: realGroups
    })
    assert.deepEqual(calls.map(c => c.groupId), [303])
    assert.equal(logs.length, 1)
    console.log('PASS bộ lập lịch: chỉ bật SĐT quản trị viên thì chỉ một lượt nạp, độc lập với UID / group')
    passed += 1
  }
  {
    const { calls } = await runScheduler({ extraSettings: { isFindFacebookGroupAdmins: true, findDataTargetDataGroups: destinations }, groups: realGroups, failAccount: true })
    assert.deepEqual(calls[1].rows.map(r => r.uid), ['100009', '100001', '100002'])
    console.log('PASS bộ lập lịch: không đọc được tài khoản thì vẫn đẩy (không bỏ ai)')
    passed += 1
  }
  {
    const noAdmins = [{ ...G1, adminScan: 'not_listed', admins: [] }]
    const { calls, logs } = await runScheduler({ extraSettings: { isFindFacebookGroupAdmins: true, findDataTargetDataGroups: { facebook_group_admin_uid: destinations.facebook_group_admin_uid } }, groups: noAdmins })
    assert.equal(calls.length, 0)
    assert.equal(logs.length, 0)
    console.log('PASS bộ lập lịch: lượt không có quản trị viên thì không gọi DB, không in dòng nào')
    passed += 1
  }
}

// ---------------------------------------------------------------- C. dữ liệu thật (tuỳ chọn)
function partC(file) {
  const runs = JSON.parse(fs.readFileSync(file, 'utf8'))
  let uid = 0; let phone = 0; let admins = 0
  const allUid = new Set(); const allPhone = new Set()
  for (const run of runs) {
    const groups = run.groups.map(group => ({ ...group, ...readFacebookGroupAdminFields(group) }))
    const r = buildFindDataGroupAdminRows(groups, null, { sourceCampaignId: run.campaignId })
    uid += r.uidRows.length; phone += r.phoneRows.length; admins += r.adminCount
    for (const row of r.uidRows) { assert(row.uid); assert(!allUid.has(`${run.detailId}:${row.uid}`)); allUid.add(`${run.detailId}:${row.uid}`) }
    for (const row of r.phoneRows) { assert.match(row.phone, /^0[35789]\d{8}$/); allPhone.add(row.phone) }
    assert.equal(new Set(r.uidRows.map(x => x.uid)).size, r.uidRows.length)
    assert.equal(new Set(r.phoneRows.map(x => x.phone)).size, r.phoneRows.length)
  }
  console.log(`PASS dữ liệu thật: ${runs.length} lượt, ${admins} quản trị viên → ${uid} dòng UID, ${phone} dòng SĐT (${allPhone.size} số khác nhau)`)
  passed += 1
}

partB().then(() => {
  if (process.argv[2]) partC(process.argv[2])
  console.log(`== ${passed} PASS`)
}).catch(error => {
  console.error(error)
  process.exit(1)
})
