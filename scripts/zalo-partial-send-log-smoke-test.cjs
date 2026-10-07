// Offline regression: partial delivery retains the existing policy/fallback
// message through normal dispatch and share batches. No Zalo or DB calls.
const assert = require('node:assert/strict')
const { schedulerClass, fixture, timeout, media } = require('./campaign-media-timeout-smoke-test.cjs')

const fallback = { errorCode: 'err_zalo_api_business_failed', detailStatus: 'thất bại',
  countsTowardLimit: true, countsTowardBadTarget: true, disableActionCodes: [] }
const mapped = { ...fallback, errorCode: 'err_fixture', notiRunningProcess: 'Thông báo theo policy',
  notiCampaign: 'Tạm dừng theo policy [x] phút', timeDisableActions: 60, updateStatusCampaign: 'tạm dừng' }
const cases = [
  { name: 'generic 112', error: { code: 112, message: 'Lỗi không xác định' }, fallback,
    expected: 'Nhắn tin thất bại: Lỗi không xác định (mã Zalo: 112)' },
  { name: 'mapped 118', error: { code: 118, message: 'Nội dung quá dài' }, policy: mapped,
    expected: 'Thông báo theo policy' },
  { name: 'policy without detail', error: { code: 221, message: 'Giới hạn thao tác' },
    policy: { ...mapped, detailStatus: null }, expected: 'Thông báo theo policy' },
  { name: 'policy error status and no counters', error: { code: 500, message: 'Lỗi thao tác' },
    policy: { ...mapped, detailStatus: 'lỗi', countsTowardLimit: false, countsTowardBadTarget: false },
    expected: 'Thông báo theo policy' },
  { name: 'no policy', error: { code: 112, message: 'Lỗi không xác định' }, expected: 'Lỗi không xác định' },
  { name: 'string error without policy', error: 'Kết nối bị ngắt', expected: 'Kết nối bị ngắt' },
  { name: 'timeout generic', error: timeout(), fallback,
    expected: 'Nhắn tin thất bại: ' + timeout().message + ' (mã Zalo: ' + media.CAMPAIGN_MEDIA_TIMEOUT_CODE + ')' },
  { name: 'timeout mapped', error: timeout(), policy: mapped, expected: 'Thông báo theo policy' }
]

function setup(Scheduler, target, group, scenario) {
  const f = fixture(Scheduler, { target, group, threshold: 100 })
  f.db.getZaloErrorPolicyByCode = async (_code, action) => {
    assert.equal(action, f.campaign.actionId)
    return scenario.policy || null
  }
  const baseLookup = f.db.getErrorPolicy
  f.db.getErrorPolicy = async code => code === fallback.errorCode ? scenario.fallback || null : baseLookup(code)
  f.logs = []
  f.scheduler.logCampaignProgress = async (_campaign, log) => { f.logs.push(log) }
  f.scheduler.pushZaloDetailToExternalSmsIfNeeded = async () => {}
  return f
}

async function dispatchCases(Scheduler) {
  let count = 0
  for (const target of ['desktop', 'server']) for (const group of [false, true]) for (const scenario of cases) {
    // Non-partial errors and campaign notes keep the exact existing text.
    const normal = setup(Scheduler, target, group, scenario)
    const original = await normal.scheduler.createZaloErrorDetail(normal.account, normal.campaign,
      scenario.error, normal.campaign.actionId, 'Nhắn tin', {})
    assert.equal(original.log, scenario.expected, scenario.name)
    assert.equal(original.pendingNote, scenario.policy ? 'Tạm dừng theo policy 60 phút' : scenario.expected)

    for (const sequence of ['media_then_content', 'content_then_media']) {
      const f = setup(Scheduler, target, group, scenario)
      const sent = []
      const acknowledged = { message: { msgId: 'text' }, attachment: [{ msgId: 'photo' }] }
      f.scheduler.zaloRuntime.sendMessageToUser = async (_id, _thread, text, files) => {
        sent.push({ text, files })
        if (sent.length === 2) throw scenario.error
        return acknowledged
      }
      const mediaFirst = sequence === 'media_then_content'
      const files = mediaFirst ? ['one.jpg', 'two.jpg'] : ['one.jpg']
      let failure
      try { await f.scheduler.dispatchZaloMessage(20, 'recipient', group, { msg: 'Nội dung', styles: [] }, files) }
      catch (error) { failure = error }
      assert.ok(failure, scenario.name)
      const detail = await f.scheduler.createZaloPartialSendDetail(f.account, f.campaign, failure,
        f.campaign.actionId, 'Nhắn tin', { inputData: { id: 100 } })
      const prefix = mediaFirst ? 'Đã gửi file nhưng gửi nội dung thất bại' : 'Đã gửi nội dung nhưng gửi file thất bại'
      assert.equal(detail.log, prefix + '. ' + scenario.expected, scenario.name)
      assert.equal(detail.data.partialSend.sequence, sequence)
      assert.equal(detail.data.partialSend[mediaFirst ? 'mediaResponse' : 'contentResponse'], acknowledged)
      assert.equal(detail.data.zalo.message, original.data.zalo.message)
      assert.equal(detail.data.zalo.code, original.data.zalo.code)
      assert.equal(detail.status, 'thất bại')
      assert.equal(detail.createDetail, true)
      assert.equal(detail.countsTowardLimit, true)
      assert.equal(detail.countsTowardBadTarget, original.data.zalo.code === media.CAMPAIGN_MEDIA_TIMEOUT_CODE
        ? original.countsTowardBadTarget : false)
      assert.equal(detail.resetInputToPending, false)
      assert.equal(detail.preventInputRetry, true)
      assert.equal(detail.pendingNote, undefined)
      assert.equal(detail.stopAfterTarget, original.stopAfterTarget)
      assert.equal(sent.length, 2, 'retaining the log must never resend')
      const summary = await f.scheduler.logZaloMessagePhoneMilestones(f.campaign, { id: 100 }, 20,
        [{ blockName: 'zalo_send_message', nodeId: 'send', output: { detail } }])
      assert.equal(f.details.length, 1)
      assert.equal(f.details[0].log, detail.log)
      assert.ok(f.logs.some(log => log.includes(detail.log)))
      assert.ok(summary.inputCompletionNote.includes(detail.log))
      assert.equal(summary.preventInputRetry, true)
      assert.equal(Boolean(summary.resetInputToPending), false)
      count++
    }
  }
  return count
}

async function shareCases(Scheduler) {
  let count = 0
  for (const target of ['desktop', 'server']) for (const group of [false, true]) {
    for (const policy of [null, fallback, mapped]) for (const batchThrows of [false, true]) for (const hasMedia of [false, true]) {
      const scenario = { policy, error: { code: 112, message: 'Lỗi không xác định' } }
      const f = setup(Scheduler, target, group, scenario)
      f.scheduler.zaloRuntime.sendMessageToUser = async () => ({ attachment: [{ msgId: 'photo' }] })
      f.scheduler.zaloRuntime.forwardMessageToUsers = async (_id, ids) => {
        f.forwards.push(ids)
        if (batchThrows) throw scenario.error
        return { results: ids.map((threadId, i) => i === 0 ? { threadId, ok: true }
          : { threadId, ok: false, errorCode: String(111 + i), errorMessage: 'Lỗi người nhận ' + i }) }
      }
      const result = await f.scheduler.processZaloShareMessageBatch(f.account, f.campaign, f.rows(3), [],
        { code: f.campaign.actionId, name: 'Nhắn tin' }, 'Nội dung', hasMedia ? ['one.jpg', 'two.jpg'] : [], new Map())
      assert.equal(f.forwards.length, 1)
      const noDetails = !hasMedia && batchThrows && !policy
      assert.equal(f.details.length, noDetails ? 0 : 3)
      const failures = f.details.filter(d => d.status === 'thất bại')
      assert.equal(failures.length, noDetails ? 0 : batchThrows ? 3 : 2)
      for (const detail of failures) {
        const raw = detail.data.zalo.message
        const originalLog = policy === mapped ? 'Thông báo theo policy' : policy === fallback
          ? 'Nhắn tin thất bại: ' + raw + ' (mã Zalo: ' + detail.data.zalo.code + ')' : raw
        assert.equal(detail.log, (hasMedia ? 'Đã gửi file nhưng gửi nội dung thất bại. ' : '') + originalLog)
        assert.ok(f.logs.some(log => log.includes(detail.log)))
        assert.equal(f.updates.findLast(update => update.id === detail.inputDataId).note, detail.log)
      }
      assert.equal(f.logs.filter(log => log.startsWith('⚠️')).length, batchThrows || policy === mapped ? 1 : 2)
      assert.equal(result.stopAfterBatch, batchThrows && !hasMedia)
      assert.equal(f.effects.length, batchThrows && !hasMedia ? 1 : 0)
      if (!hasMedia && batchThrows && policy === mapped) assert.equal(result.stopNote, 'Tạm dừng theo policy 60 phút')
      count++
    }
  }
  return count
}

async function helperCases(Scheduler) {
  let count = 0
  const helpers = [
    ['zaloSendPhoneMessage', 'zalo_message_stranger', 'Nhắn tin người lạ'],
    ['zaloSendFriendMessage', 'zalo_message_friend', 'Nhắn tin bạn bè'],
    ['zaloSendGroupMessage', 'zalo_message_group', 'Nhắn tin group']
  ]
  for (const target of ['desktop', 'server']) for (const [method, actionCode, actionName] of helpers) {
    for (const scenario of [cases[0], cases[1], cases[4]]) for (const mediaFirst of [true, false]) for (const failOn of [1, 2]) {
      const f = setup(Scheduler, target, actionCode === 'zalo_message_group', scenario)
      f.campaign.actionId = actionCode
      const recipient = { uid: 'recipient', displayName: 'Fixture' }
      const files = mediaFirst ? ['one.jpg', 'two.jpg'] : ['one.jpg']
      Object.assign(f.scheduler, {
        prepareZaloOutgoingContent: async () => ({ content: { msg: 'Nội dung', styles: [] }, media: files }),
        getCachedZaloMessageOptOutTarget: () => recipient,
        normalizeZaloTargetFromInputData: () => recipient,
        upsertZaloResolvedProfileTarget: async () => {},
        applyAkaBizTagsToZaloTarget: async () => {}
      })
      let sends = 0
      f.scheduler.zaloRuntime.sendMessageToUser = async () => {
        if (++sends === failOn) throw scenario.error
        return { message: { msgId: 'text' }, attachment: [{ msgId: 'photo' }] }
      }
      const result = await f.scheduler[method](f.account, f.campaign, {
        enabled: true, target: recipient, targetUid: recipient.uid, inputData: { id: 100 }
      })
      const originalLog = scenario.expected.replace(/^Nhắn tin thất bại:/, actionName + ' thất bại:')
      const prefix = mediaFirst ? 'Đã gửi file nhưng gửi nội dung thất bại. ' : 'Đã gửi nội dung nhưng gửi file thất bại. '
      assert.equal(result.ok, false)
      assert.equal(result.detail.log, (failOn === 2 ? prefix : '') + originalLog, method)
      assert.equal(Boolean(result.detail.data.partialSend), failOn === 2)
      assert.equal(sends, failOn, 'helpers must not resend or start a second stage after the first fails')
      count++
    }
  }
  return count
}

async function shareEdgeCases(Scheduler) {
  let count = 0
  for (const target of ['desktop', 'server']) for (const group of [false, true]) {
    for (const policy of [null, fallback]) {
      const f = setup(Scheduler, target, group, { fallback: policy })
      f.scheduler.zaloRuntime.sendMessageToUser = async () => ({ attachment: [{ msgId: 'photo' }] })
      f.scheduler.zaloRuntime.forwardMessageToUsers = async () => ({ results: [] })
      const result = await f.scheduler.processZaloShareMessageBatch(f.account, f.campaign, f.rows(2), [],
        { code: f.campaign.actionId, name: 'Nhắn tin' }, 'Nội dung', ['one.jpg'], new Map())
      assert.equal(f.details.length, 2)
      const originalLog = (policy ? 'Nhắn tin thất bại: ' : '') + 'Chia sẻ tin nhắn Zalo thất bại'
      for (const detail of f.details) {
        assert.equal(detail.log, 'Đã gửi file nhưng gửi nội dung thất bại. ' + originalLog)
        assert.equal(detail.data.zalo.code, null)
        assert.equal(f.updates.findLast(update => update.id === detail.inputDataId).note, detail.log)
      }
      assert.equal(result.stopAfterBatch, false)
      assert.equal(f.effects.length, 0)
      count++
    }

    // One recipient received media, then a later media failure stops the batch
    // before text forwarding. Preserve that unsent-text reason as well.
    const f = setup(Scheduler, target, group, { fallback })
    const stopPolicy = { ...mapped, notiRunningProcess: 'Thông báo dừng media', notiCampaign: 'Dừng theo policy media' }
    f.db.getZaloErrorPolicyByCode = async code => code === media.CAMPAIGN_MEDIA_TIMEOUT_CODE ? stopPolicy : null
    f.scheduler.zaloRuntime.sendMessageToUser = async (_id, thread) => {
      f.attempts.push(thread)
      if (thread === '1') throw timeout()
      return { attachment: [{ msgId: 'photo' }] }
    }
    const result = await f.scheduler.processZaloShareMessageBatch(f.account, f.campaign, f.rows(3), [],
      { code: f.campaign.actionId, name: 'Nhắn tin' }, 'Nội dung', ['one.jpg'], new Map())
    const partial = f.details.find(detail => detail.inputDataId === 100)
    assert.equal(partial.log, 'Đã gửi file nhưng gửi nội dung thất bại. Nhắn tin thất bại: Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung.')
    assert.equal(f.updates.findLast(update => update.id === 100).note, partial.log)
    assert.deepEqual(f.attempts, ['0', '1'])
    assert.equal(f.forwards.length, 0)
    assert.equal(result.stopAfterBatch, true)
    assert.equal(result.stopNote, 'Dừng theo policy media')
    assert.equal(f.effects.length, 1)
    count++
  }
  return count
}

async function main() {
  const Scheduler = schedulerClass(await import('zca-js'))
  const { scheduler } = fixture(Scheduler)
  for (const error of ['Lỗi dự phòng', '']) {
    const detail = scheduler.finalizeZaloPartialSendDetail({ log: '' }, {}, {
      stage: 'content_after_media', sequence: 'media_then_content', error
    })
    assert.equal(detail.log, 'Đã gửi file nhưng gửi nội dung thất bại' + (error ? '. ' + error : ''))
  }
  const dispatch = await dispatchCases(Scheduler)
  const share = await shareCases(Scheduler)
  const helpers = await helperCases(Scheduler)
  const edges = await shareEdgeCases(Scheduler)
  console.log('PASS: ' + dispatch + ' partial dispatch, ' + share + ' share batch, ' + helpers + ' real helper and ' + edges + ' share edge cases; Desktop/Server, user/group, policy/no policy, original log/note preservation, metadata, progress/input notes and no resend')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
