// Kiểm phần Desktop của link từ chối cho email / nhắn tin Facebook (V649) bằng mã thật của campaignScheduler.ts
// (nạp qua scripts/find-data-push/load-scheduler.cjs, DB giả). Chạy: node scripts/message-opt-out-channels/desktop-smoke.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadScheduler, createLoader, root } = require('../find-data-push/load-scheduler.cjs')

let channels = { sms: false, email: false, facebook: false }
const guard = { getMessageOptOutChannels: () => channels }
const { CampaignScheduler } = loadScheduler({ './messageOptOutChannelsSetting': guard })
const shared = createLoader()(path.join(root, 'src/shared/zaloMessageOptOut.ts'))

const ID = '550e8400-e29b-41d4-a716-446655440000'
const LINK = shared.buildStopMessagesLink(ID)
const TOKEN = '#{STOP_MESSAGES_LINK}'

function scheduler(db = {}) {
  const s = Object.create(CampaignScheduler.prototype)
  s.channelOptOutContexts = new Map()
  s.logs = []
  s.calls = []
  s.logCampaignProgress = async (_c, text) => { s.logs.push(text) }
  s.supabase = {
    prepareMessageOptOut: async (...args) => { s.calls.push(['prepare', ...args]); if (db.fail) throw new Error(db.fail === true ? 'mất mạng' : db.fail); return { id: ID, isOptedOut: db.optedOut === true } },
    checkMessageOptOut: async (...args) => { s.calls.push(['check', ...args]); if (db.fail) throw new Error('mất mạng'); return db.optedOut === true },
  }
  return s
}
const campaign = (actionId, extra = {}) => ({ id: 7, actionId, extraSettings: extra })
const account = { id: 3 }

let passed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1 }
}

;(async () => {
  await check('kênh tắt: không gọi DB, biến bị bỏ, không dòng cuối', async () => {
    channels = { sms: false, email: false, facebook: false }
    const s = scheduler()
    const c = campaign('email_send', { zaloOptOutLinkEnabled: true })
    assert.deepEqual(await s.resolveChannelOptOut(account, c, { email: 'a@x.com' }), { blocked: null })
    assert.equal(s.calls.length, 0)
    assert.equal(s.applyChannelOptOutLink(c, `Chào ${TOKEN}`), 'Chào ')
    assert.equal(s.applyChannelOptOutLink(c, 'Chào'), 'Chào')
    assert.equal(s.channelOptOutOneClickUrl(c), null)
  })

  await check('email bật link: tạo link theo email chữ thường, thêm dòng cuối / thay biến', async () => {
    channels = { sms: false, email: true, facebook: false }
    const s = scheduler()
    const c = campaign('email_send', { zaloOptOutLinkEnabled: true })
    assert.deepEqual(await s.resolveChannelOptOut(account, c, { email: ' An@X.com ' }), { blocked: null })
    assert.deepEqual(s.calls, [['prepare', 7, 3, 'email', 'an@x.com']])
    assert.equal(s.applyChannelOptOutLink(c, 'Chào bạn  '), `Chào bạn\n\nTừ chối nhận tin: ${LINK}`)
    assert.equal(s.applyChannelOptOutLink(c, `Chào ${TOKEN}`), `Chào ${LINK}`)
    assert.equal(s.applyChannelOptOutLink(c, '<html><body><p>Chào</p></body></html>', { html: true }),
      `<html><body><p>Chào</p><p>Từ chối nhận tin: <a href="${LINK}">${LINK}</a></p></body></html>`)
    assert.equal(s.channelOptOutOneClickUrl(c), `https://b.akabiz.biz/api/public/message-opt-out/${shared.encodeStopMessagesId(ID)}/one-click`)
  })

  await check('email đã từ chối (prepare trả is_opted_out) → chặn', async () => {
    channels = { sms: false, email: true, facebook: false }
    const s = scheduler({ optedOut: true })
    assert.deepEqual(await s.resolveChannelOptOut(account, campaign('email_send', { zaloOptOutLinkEnabled: true }), { email: 'a@x.com' }), { blocked: 'email' })
  })

  await check('không bật link: chỉ kiểm, không thêm dòng cuối; đã từ chối vẫn chặn', async () => {
    channels = { sms: false, email: true, facebook: true }
    let s = scheduler({ optedOut: false })
    const c = campaign('email_send', {})
    assert.deepEqual(await s.resolveChannelOptOut(account, c, { email: 'a@x.com' }), { blocked: null })
    assert.equal(s.calls[0][0], 'check')
    assert.equal(s.applyChannelOptOutLink(c, `Chào ${TOKEN}`), 'Chào ')
    assert.equal(s.applyChannelOptOutLink(c, 'Chào'), 'Chào')
    assert.equal(s.channelOptOutOneClickUrl(c), null)
    s = scheduler({ optedOut: true })
    assert.deepEqual(await s.resolveChannelOptOut(account, c, { email: 'a@x.com' }), { blocked: 'email' })
  })

  await check('DB lỗi: vẫn gửi, cảnh báo, biến thành trang báo lỗi, không dòng cuối', async () => {
    channels = { sms: false, email: true, facebook: false }
    const s = scheduler({ fail: true })
    const c = campaign('email_send', { zaloOptOutLinkEnabled: true })
    assert.deepEqual(await s.resolveChannelOptOut(account, c, { email: 'a@x.com' }), { blocked: null })
    assert.match(s.logs[0], /Không thể kiểm tra từ chối nhận tin; vẫn tiếp tục gửi/)
    assert.equal(s.applyChannelOptOutLink(c, `Chào ${TOKEN}`), 'Chào https://b.akabiz.biz/s/error')
    assert.equal(s.applyChannelOptOutLink(c, 'Chào'), 'Chào')
  })

  await check('kênh vừa tắt trên DB (đăng nhập trước lúc tắt): bỏ biến, không dòng cuối, không cảnh báo', async () => {
    channels = { sms: false, email: true, facebook: false }
    const s = scheduler({ fail: 'Không thể tạo link từ chối nhận tin: message_opt_out_channel_disabled' })
    const c = campaign('email_send', { zaloOptOutLinkEnabled: true })
    assert.deepEqual(await s.resolveChannelOptOut(account, c, { email: 'a@x.com' }), { blocked: null })
    assert.equal(s.logs.length, 0)
    assert.equal(s.applyChannelOptOutLink(c, `Chào ${TOKEN}`), 'Chào ')
    assert.equal(s.applyChannelOptOutLink(c, 'Chào'), 'Chào')
  })

  await check('Facebook: khoá UID / inbox Page đúng; data thiếu UID thì không gọi DB', async () => {
    channels = { sms: false, email: false, facebook: true }
    let s = scheduler()
    await s.resolveChannelOptOut(account, campaign('facebook_message_uid', { zaloOptOutLinkEnabled: true }), { uid: 'https://facebook.com/profile.php?id=100012345678901' })
    assert.deepEqual(s.calls, [['prepare', 7, 3, 'facebook', 'uid:100012345678901']])
    s = scheduler()
    await s.resolveChannelOptOut(account, campaign('facebook_page_to_message', { pageInboxPageUid: '111' }), { uid: '222' })
    assert.deepEqual(s.calls, [['check', 7, 3, 'facebook', 'page:111:222']])
    s = scheduler()
    assert.deepEqual(await s.resolveChannelOptOut(account, campaign('facebook_message_friend', {}), { uid: '' }), { blocked: null })
    assert.equal(s.calls.length, 0)
  })

  await check('SMS không chạy trên Desktop; loại khác không đổi nội dung', async () => {
    channels = { sms: true, email: true, facebook: true }
    const s = scheduler()
    assert.deepEqual(await s.resolveChannelOptOut(account, campaign('sms_send', { zaloOptOutLinkEnabled: true }), { phone: '0912345678' }), { blocked: null })
    assert.equal(s.calls.length, 0)
    assert.equal(s.applyChannelOptOutLink(campaign('zalo_message_phone'), `Chào ${TOKEN}`), `Chào ${TOKEN}`)
    assert.equal(s.applyChannelOptOutLink(campaign('facebook_group_post'), `Chào ${TOKEN}`), `Chào ${TOKEN}`)
  })

  await check('email: link từ chối không bị bọc đếm lượt bấm', async () => {
    const { EmailRuntimeService } = createLoader()(path.join(root, 'src/main/services/emailRuntimeService.ts'))
    const runtime = Object.create(EmailRuntimeService.prototype)
    assert.equal(runtime.normalizeTrackableUrl(LINK), null)
    assert.equal(runtime.normalizeTrackableUrl('https://b.akabiz.biz/api/public/message-opt-out/abc/one-click'), null)
    assert.equal(runtime.normalizeTrackableUrl('https://example.com/a'), 'https://example.com/a')
  })

  console.log(`\n${passed} PASS`)
})()
