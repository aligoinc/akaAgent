#!/usr/bin/env node
// Mốc "Đã nhận" (V653): ghép dòng của đồng bộ trạng thái tin nhắn Zalo vào mốc tương tác, hiển thị, chế độ gộp theo người
// nhận và phễu của tab Báo cáo. Hàm thuần, không gọi DB.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-received-'))

async function load() {
  const entry = path.join(out, 'entry.ts')
  fs.writeFileSync(entry, `
    export * from ${JSON.stringify(path.join(root, 'src/shared/zaloMessageStatusMarks.ts'))}
    export { engagementDisplay } from ${JSON.stringify(path.join(root, 'src/shared/zaloCampaignEngagement.ts'))}
    export { parseCampaignResultRecipientsRpc } from ${JSON.stringify(path.join(root, 'src/shared/campaignResultActions.ts'))}
    export * as report from ${JSON.stringify(path.join(root, 'src/shared/campaignRunReport.ts'))}
  `)
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'bundle.cjs'), logLevel: 'silent' })
  return require(path.join(out, 'bundle.cjs'))
}

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`ok ${passed} - ${name}`) }

load().then(m => {
  const engagement = { sent_at: '2026-11-25T01:00:00Z', tracking_until: '2026-12-02T01:00:00Z', seen_at: '2026-11-25T03:00:00Z', responded_at: null, reacted_at: null, friended_at: null }
  const status = { campaign_detail_id: 9, sent_at: '2026-11-25T01:00:01Z', reply_until: '2026-12-02T01:00:01Z', delivered_at: '2026-11-25T01:00:20Z', seen_at: '2026-11-25T02:00:00Z', reacted_at: null, responded_at: '2026-11-25T04:00:00Z', friended_at: null }

  check('không có dòng trạng thái thì giữ nguyên mốc cũ', () => {
    assert.equal(m.mergeZaloMessageStatus(engagement, null), engagement)
    assert.equal(m.mergeZaloMessageStatus(null, undefined), null)
  })
  check('có cả hai: mỗi mốc lấy giờ sớm nhất, thêm "đã nhận", giữ hạn theo dõi cũ', () => {
    const merged = m.mergeZaloMessageStatus(engagement, status)
    assert.equal(merged.delivered_at, status.delivered_at)
    assert.equal(merged.seen_at, '2026-11-25T02:00:00Z')
    assert.equal(merged.responded_at, status.responded_at)
    assert.equal(merged.tracking_until, engagement.tracking_until)
  })
  check('chỉ có dòng trạng thái: dựng mốc từ dòng đó (hạn = hạn tính phản hồi)', () => {
    const merged = m.mergeZaloMessageStatus(null, status)
    assert.equal(merged.sent_at, status.sent_at)
    assert.equal(merged.tracking_until, status.reply_until)
    assert.equal(merged.delivered_at, status.delivered_at)
  })
  check('dòng trạng thái hỏng (thiếu giờ gửi) bị bỏ qua', () => {
    assert.equal(m.mergeZaloMessageStatus(engagement, { delivered_at: status.delivered_at }), engagement)
  })
  check('cột Tương tác Zalo hiện "Đã nhận" trước "Đã xem"', () => {
    const text = m.engagementDisplay(m.mergeZaloMessageStatus(null, status), true)
    const lines = text.split('\n')
    assert.ok(lines[0].startsWith('Đã nhận: '))
    assert.ok(lines[1].startsWith('Đã xem: '))
    assert.equal(m.engagementDisplay(engagement, true).includes('Đã nhận'), false)
  })
  check('chế độ gộp theo người nhận ghép zaloMessageStatus và ra bậc "Đã nhận"', () => {
    const page = m.parseCampaignResultRecipientsRpc({ total: 1, items: [{ id: 5, resultCount: 1, results: [{ id: 9, actionCode: 'zalo_message_stranger', status: 'thành công', reportGroup: 'success', zaloEngagement: null,
      zaloMessageStatus: { ...status, seen_at: null, responded_at: null } }] }] }, 'page')
    assert.equal(page.items[0].results[0].zaloEngagement.delivered_at, status.delivered_at)
  })
  check('tab Báo cáo: phễu có "Đã nhận" thật khi mọi lượt theo dõi đều có biên nhận', () => {
    const rpc = { dbNow: '2026-11-25T05:00:00Z', campaign: { id: 1, status: 'đang chạy', createdAt: '2026-11-20T00:00:00Z' }, inputs: [],
      results: { total: 10, firstAt: null, lastAt: null, groups: [] }, timeline: { unit: 'day', points: [] }, inputOutcomes: [], statuses: [],
      engagement: { messageSent: 10, messageTracked: 10, responded: 1, reacted: 1, seen: 2, received: 4, deliveryTracked: 10, friendRequested: 0, friendTracked: 0, friended: 0 } }
    const parsed = m.report.parseCampaignRunReportRpc(rpc)
    assert.equal(parsed.engagement.received, 4)
    assert.equal(parsed.engagement.deliveryTracked, 10)
    const built = m.report.buildCampaignRunReport({ rpc: parsed, catalog: null, platform: 'zalo', usesInputData: true, configuredActionCodes: ['zalo_message_stranger'] })
    assert.equal(built.engagement.message.received, 8)
    assert.equal(built.engagement.message.seen, 4)
    assert.equal(built.engagement.message.receivedIsMinimum, false)
  })
  check('tab Báo cáo: DB chưa có V653 (không có received) thì "Đã nhận" là số tối thiểu', () => {
    const rpc = { dbNow: '2026-11-25T05:00:00Z', campaign: { id: 1, status: 'đang chạy', createdAt: '2026-11-20T00:00:00Z' }, inputs: [],
      results: { total: 10, firstAt: null, lastAt: null, groups: [] }, timeline: { unit: 'day', points: [] }, inputOutcomes: [], statuses: [],
      engagement: { messageSent: 10, messageTracked: 10, responded: 1, reacted: 0, seen: 2, friendRequested: 0, friendTracked: 0, friended: 0 } }
    const built = m.report.buildCampaignRunReport({ rpc: m.report.parseCampaignRunReportRpc(rpc), catalog: null, platform: 'zalo', usesInputData: true, configuredActionCodes: ['zalo_message_stranger'] })
    assert.equal(built.engagement.message.receivedIsMinimum, true)
    assert.equal(built.engagement.message.received, built.engagement.message.seen)
  })
  console.log(`zalo received marks smoke: ${passed}/8 passed`)
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(out, { recursive: true, force: true }))
