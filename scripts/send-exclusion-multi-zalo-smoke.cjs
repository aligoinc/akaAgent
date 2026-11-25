// V653: luật đánh giá loại trừ gửi theo nhiều Zalo (evaluateSendExclusionWithRemote, src/shared/campaignSendExclusion.ts) và
// bản chép trong lõi engine giống từng byte. Không DB, không Zalo. Chạy: node scripts/send-exclusion-multi-zalo-smoke.cjs
const assert = require('node:assert/strict')
const {readFileSync, mkdtempSync, rmSync} = require('node:fs')
const {tmpdir} = require('node:os')
const {join, resolve} = require('node:path')
const {buildSync} = require('esbuild')
const dir = mkdtempSync(join(tmpdir(), 'send-exclusion-v653-'))
async function main() {
  buildSync({entryPoints: [resolve(__dirname, '../src/shared/campaignSendExclusion.ts')], outfile: join(dir, 'core.cjs'), bundle: true, platform: 'node', format: 'cjs'})
  const core = require(join(dir, 'core.cjs'))
  assert.equal(readFileSync(resolve(__dirname, '../src/shared/campaignSendExclusion.ts'), 'utf8'),
    readFileSync(resolve(__dirname, '../packages/campaign-engine/src/zalo/sendExclusionRules.ts'), 'utf8'), 'lõi engine chép nguyên văn')
  const {catalog} = require('./fixtures/send-exclusion-ui-page.json')
  const field = code => catalog.fields.find(f => f.code === code), op = code => catalog.operators.find(o => o.code === code)
  const rule = (code, operator, value) => ({fieldId: field(code).id, operatorId: op(operator).id, value, isEnabled: true, sortOrder: 0})
  const friend = rule('zalo_friend_status', 'equals', 'friend'), tag = rule('zalo_tag', 'contains', ['7'])
  const own = rules => ({id: 1, accountId: 100, name: 'Khách đã chăm sóc', matchMode: 'or', revision: 1, rules})
  const plan = (extra = {}) => ({groupName: 'Khách đã chăm sóc', blocks: [{accountId: 101, accountName: 'Zalo Minh Thư', matchMode: 'and', rules: [friend, tag]}],
    blocklistIds: [], dataGroups: [], campaigns: [], ...extra})
  const snapshot = (group, remote, blocklistUids = []) => ({catalog, group, blocklistUids, version: 2, remote})
  let calls
  const run = async (snap, facts, remoteFacts) => {
    calls = []
    return core.evaluateSendExclusionWithRemote(snap, 'u1', async key => { calls.push(key); return facts[key] }, async () => {
      calls.push('remote'); if (remoteFacts instanceof Error) throw remoteFacts; return remoteFacts })
  }
  const ok = (id, facts) => ({match: null, blocks: [{accountId: id, state: 'ok', facts}]})

  // Danh sách Zalo ID của Zalo đang gửi: không tra DB, không đọc Zalo.
  assert.deepEqual(await run(snapshot(own([friend]), plan(), ['u1']), {}, ok(101, {})), {decision: 'excluded', note: 'Thuộc danh sách Zalo ID loại trừ.'})
  assert.deepEqual(calls, [])
  // Khớp danh sách trong DB: không đọc Zalo.
  const match = {match: {kind: 'campaign', id: 800, name: 'KM', note: 'Đã được gửi ở chiến dịch “KM” ngày 18/11.'}, blocks: []}
  assert.deepEqual(await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'friend'}}, match), {decision: 'excluded', note: match.match.note})
  assert.deepEqual(calls, ['remote'])
  // Khối Zalo khác khớp (VÀ trong khối): không đọc Zalo đang gửi; câu nêu Zalo.
  const d1 = await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'stranger'}},
    ok(101, {zalo_friendship: {status: 'friend'}, zalo_labels: {ids: ['7'], availableValues: ['7']}}))
  assert.deepEqual(d1, {decision: 'excluded', note: 'Thỏa điều kiện loại trừ của nhóm “Khách đã chăm sóc” ở Zalo Minh Thư.'})
  assert.deepEqual(calls, ['remote'])
  // Khối Zalo khác không khớp → khối Zalo đang gửi (HOẶC giữa các khối).
  const d2 = await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'friend'}},
    ok(101, {zalo_friendship: {status: 'friend'}, zalo_labels: {ids: [], availableValues: ['7']}}))
  assert.equal(d2.decision, 'excluded')
  assert.deepEqual(calls, ['remote', 'zalo_friendship'])
  assert.equal((await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'stranger'}},
    ok(101, {zalo_friendship: {status: 'stranger'}, zalo_labels: {ids: ['7'], availableValues: ['7']}}))).decision, 'allowed')
  // Khối Zalo khác chưa đủ dữ liệu: chỉ "chưa đủ" khi không khối nào khớp.
  const unknownFacts = {match: null, blocks: [{accountId: 101, state: 'unknown'}]}
  assert.deepEqual(await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'stranger'}}, unknownFacts),
    {decision: 'unknown', note: 'Chưa xác định được khách ở Zalo Minh Thư để kiểm tra nhóm “Khách đã chăm sóc”.'})
  assert.equal((await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'friend'}}, unknownFacts)).decision, 'excluded')
  assert.equal((await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'stranger'}},
    ok(101, {zalo_friendship: {status: 'friend'}}))).decision, 'unknown', 'thiếu dữ kiện tag trong DB → chưa đủ dữ liệu')
  // Zalo chưa đồng bộ lần nào / khối rỗng: bỏ qua khối.
  for (const state of ['not_synced', 'empty']) {
    assert.equal((await run(snapshot(own([friend]), plan()), {zalo_friendship: {status: 'stranger'}}, {match: null, blocks: [{accountId: 101, state}]})).decision, 'allowed')
  }
  // Nhóm không có khối của Zalo đang gửi.
  assert.equal((await run(snapshot(null, plan()), {}, ok(101, {zalo_friendship: {status: 'stranger'}, zalo_labels: {ids: ['7'], availableValues: ['7']}}))).decision, 'allowed')
  assert.deepEqual(calls, ['remote'])
  // Tag Zalo đã xoá ở Zalo khác (V573): điều kiện chỉ còn tag đã xoá thì bỏ, không loại oan.
  const onlyTag = plan({blocks: [{accountId: 101, accountName: 'Zalo Minh Thư', matchMode: 'and', rules: [rule('zalo_tag', 'not_contains', ['7'])]}]})
  assert.equal((await run(snapshot(null, onlyTag), {}, ok(101, {zalo_labels: {ids: [], availableValues: []}}))).decision, 'allowed')
  assert.equal((await run(snapshot(null, onlyTag), {}, ok(101, {zalo_labels: {ids: [], availableValues: ['7']}}))).decision, 'excluded')
  // Không có phần remote: y như evaluateSendExclusion (bộ chạy cũ / cấu hình một Zalo).
  for (const facts of [{zalo_friendship: {status: 'friend'}}, {zalo_friendship: {status: 'stranger'}}, {zalo_friendship: null}]) {
    const snap = {catalog, group: own([friend]), blocklistUids: ['x']}
    const a = await core.evaluateSendExclusion(snap, 'u1', async key => facts[key])
    const b = await run(snap, facts, new Error('không được gọi'))
    assert.deepEqual(b, a)
    assert.ok(!calls.includes('remote'))
  }
  // Lỗi tra DB ném ra cho bên gọi.
  await assert.rejects(run(snapshot(own([friend]), plan()), {}, new Error('db down')), /db down/)
  // Cấu hình: khoá mới hợp lệ, có nghĩa là "có loại trừ".
  assert.equal(core.hasSendExclusions({zaloSendExclusionsByAccountId: {100: {groupId: null, blocklistIds: [], dataGroupIds: [5]}}}, 100), true)
  assert.equal(core.hasSendExclusions({zaloSendExclusionsByAccountId: {100: {groupId: null, blocklistIds: [], sentCampaignIds: [9]}}}, 100), true)
  assert.equal(core.hasSendExclusions({zaloSendExclusionsByAccountId: {100: {groupId: null, blocklistIds: [], dataGroupIds: [], sentCampaignIds: []}}}, 100), false)
  assert.throws(() => core.exclusionSelection({zaloSendExclusionsByAccountId: {100: {groupId: null, blocklistIds: [], dataGroupIds: [0]}}}, 100), /không hợp lệ/)
  assert.throws(() => core.exclusionSelection({zaloSendExclusionsByAccountId: {100: {groupId: null, blocklistIds: [], sentCampaignIds: Array.from({length: 21}, (_, i) => i + 1)}}}, 100), /không hợp lệ/)
  console.log('PASS V653 luật: danh sách Zalo đang gửi trước, một lần tra DB, khối Zalo khác HOẶC khối Zalo đang gửi, chưa đồng bộ bỏ qua, chưa đủ dữ liệu chỉ khi không khối nào khớp, không remote thì như cũ.')
}
main().finally(() => rmSync(dir, {recursive: true, force: true})).catch(error => { console.error(error); process.exit(1) })
