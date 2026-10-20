const assert = require('node:assert/strict')
const expectGroup = (days, withFriend = true, mode = 'and') => result => {
  assert.equal(result.ok, true)
  assert.equal(result.patch.matchMode, mode)
  const rows = result.patch.rules
  assert.equal(rows.length, withFriend ? 3 : 2)
  assert.deepEqual(rows.find(row => row.fieldId === 2)?.value, ['6'])
  assert.equal(rows.find(row => row.fieldId === 2)?.operatorId, 3)
  assert.equal(rows.find(row => row.fieldId === 4)?.value, days)
  assert.equal(rows.find(row => row.fieldId === 4)?.operatorId, 5)
  if (withFriend) {
    assert.equal(rows.find(row => row.fieldId === 1)?.value, 'friend')
    assert.equal(rows.find(row => row.fieldId === 1)?.operatorId, 1)
  }
}
const expectFailure = code => result => { assert.equal(result.ok, false); assert.equal(result.code, code) }
const original = 'loại trừ bạn bè đã gửi tin trước đó 3 ngày và có tag dong nghiẹp'
module.exports = [
  { name: 'original-natural-request', description: original, check: expectGroup(3) },
  { name: 'original-natural-repeat', description: original, check: expectGroup(3) },
  { name: 'natural-lookback-five-days', description: 'Bạn nào là bạn bè có nhãn dong nghiep mà đã nhắn mấy hôm trước trong vòng 5 ngày thì bỏ qua nhé.', check: expectGroup(5) },
  { name: 'natural-or', description: 'Bỏ qua khách có nhãn đồng nghiệp hoặc đã nhắn trước đó 3 ngày.', check: expectGroup(3, false, 'or') },
  { name: 'explicit-exact-day', description: 'Chỉ loại trừ khách được gửi tin đúng 3 ngày trước, không phải trong 3 ngày gần nhất.', check: expectFailure('unsupported') },
  { name: 'missing-day-value', description: 'Loại trừ khách đã gửi tin trong mấy ngày gần nhất; tôi chưa quyết định số ngày.', check: expectFailure('unclear') },
  { name: 'unknown-tag', description: 'Bỏ qua khách có tag Zalo Kim Cương.', check: expectFailure('unclear') },
  { name: 'ambiguous-tag-source', description: 'Bỏ qua khách có tag Đồng nghiệp.',
    extraOptions: [{ fieldId: 3, code: 'fixture-6', label: 'Đồng nghiệp', value: 'fixture-6', isActive: true, sortOrder: 0 }],
    check: expectFailure('unclear') },
  { name: 'nested-condition', description: 'Loại trừ khi (là Bạn bè VÀ có tag Zalo Đồng nghiệp) HOẶC đã nhận tin trong 3 ngày gần nhất. Phải giữ chính xác logic này.',
    check: expectFailure('unsupported') }
]
