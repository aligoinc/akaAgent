// "Gửi lặp lại sau mỗi x phút" (src/shared/zaloShareRepeat.ts): chạy đúng các method thật của CampaignScheduler
// với DB/runtime giả. Không gọi mạng, không gửi lệnh Zalo.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const schedulerFile = path.join(root, 'src/main/services/campaignScheduler.ts')
const source = ts.createSourceFile(schedulerFile, fs.readFileSync(schedulerFile, 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
const methods = [
  'handleCampaignCompletion', 'handleMultiDailyTimeSlotAfterCompletion', 'rescheduleCompletedCampaignPass',
  'handleZaloShareRepeatAfterCompletion', 'getFutureInputSchedule', 'getVietnamDateTimeParts', 'getVietnamDateKey',
  'isSameVietnamDay', 'parseDailyStopTime', 'isAfterDailyStopTime', 'isAtOrAfterCampaignDispatchCutoff',
  'formatVietnamDateTime', 'parseMultiDailyTimeSlot', 'normalizeMultiDailyTimeSlots', 'getTimeSlotMinute',
  'withVietnamTimeSlot'
].map(name => {
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
  assert.ok(method, name)
  return method.getText(source)
}).join('\n')

function loadShared(relativePath) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}
const repeat = loadShared('src/shared/zaloShareRepeat.ts')
const cooldown = loadShared('src/shared/campaignDeliveryCooldown.ts')

const globals = {
  ZALO_MESSAGE_FRIEND_ACTION_ID: 'zalo_message_friend', ZALO_MESSAGE_GROUP_ACTION_ID: 'zalo_message_group',
  PAGE_POST_ACTION_ID: 'facebook_page_post',
  MULTI_DAILY_TIME_SLOT_ACTION_IDS: new Set(['facebook_timeline_post', 'facebook_page_post', 'zalo_message_friend', 'zalo_message_group']),
  supportsZaloShareRepeat: repeat.supportsZaloShareRepeat,
  parseZaloShareRepeatMinutes: repeat.parseZaloShareRepeatMinutes,
  isRecentDeliveryCooldownEnabled: cooldown.isRecentDeliveryCooldownEnabled
}
const compiled = ts.transpileModule(`class Harness { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
const Scheduler = new Function(...Object.keys(globals), `${compiled}; return Harness`)(...Object.values(globals))

// Giờ Việt Nam = UTC+7.
const vn = (clock, day = '2026-11-12') => new Date(`${day}T${clock}:00+07:00`)
const done = id => ({ id, status: 'hoàn thành', isDelete: false })

function fixture({ now = vn('09:20'), actionId = 'zalo_message_group', server = false, mode = 'direct',
  dailyStopTime = '18:00:00', scheduleEndDate = null, claimedDate, details = [done(1), done(2)], extra = {},
  advance = { ok: true } } = {}) {
  const campaign = {
    id: 7, accountId: 3, name: 'Chia sẻ tin tới group', actionId, status: 'đang chạy',
    schedule: vn('09:00').toISOString(), dailyStopTime, scheduleEndDate, dataTargetSourceMode: mode,
    extraSettings: { zaloMessageSendMode: 'share', zaloShareRepeatEnabled: true, zaloShareRepeatAfterMinutes: 60, ...extra }
  }
  const calls = []
  const logs = []
  const scheduler = Object.assign(new Scheduler(), {
    runtimeTarget: server ? 'server' : 'desktop',
    claimedServerZaloCampaignIds: new Set(server ? [campaign.id] : []),
    claimedServerZaloAccountIds: new Set(server ? [campaign.accountId] : []),
    campaignRunBoundaries: new Map(claimedDate ? [[campaign.id, { claimedVietnamDateKey: claimedDate }]] : []),
    restoreFacebookPageIdentity: async () => {},
    getDatabaseBusinessNow: async () => now,
    handleZaloRealtimeGroupCompletion: async () => false,
    handleRerunAfterCompletion: async () => false,
    transitionCampaignToCompleted: async () => { calls.push('complete'); campaign.status = 'hoàn thành'; return true },
    logCampaignProgress: async (_campaign, message) => { logs.push(message) },
    updateCampaignAndBroadcast: async (_id, patch) => { calls.push({ update: patch }); Object.assign(campaign, patch); return campaign },
    updateRunningCampaignAndBroadcast: async (_id, patch) => { calls.push({ updateRunning: patch }); Object.assign(campaign, patch); return campaign },
    broadcastCampaignUpdate: () => {},
    latchServerZaloPause: () => calls.push('latch-pause'),
    completePauseAtBoundary: async () => { calls.push('pause-boundary'); campaign.status = 'tạm dừng' },
    getServerZaloBoundaryReason: async () => ({ paused: false }),
    supabase: {
      listCampaignInputData: async () => details,
      resetCampaignInputDataForRerun: async () => { calls.push('reset-inputs') },
      advanceZaloServerMultiDailySlot: async (_id, _accountId, schedule) => {
        calls.push({ advance: schedule })
        if (advance.ok) Object.assign(campaign, { status: 'chờ xử lý', schedule })
        return advance
      },
      getCampaign: async () => campaign,
      getAccount: async () => ({ id: campaign.accountId })
    }
  })
  return { campaign, calls, logs, now, run: () => scheduler.handleCampaignCompletion(campaign) }
}

const scheduled = value => value.calls.find(call => call.update)?.update
const lastLog = value => value.logs[value.logs.length - 1] || ''

async function main() {
  let cases = 0
  const check = async (name, options, verify) => {
    const value = fixture(options)
    await value.run()
    try { verify(value) } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    cases++
  }

  // 1. Gửi xong thì hẹn gửi lại sau đúng x phút, tính từ lúc hoàn thành lượt (không phải từ giờ chạy 09:00).
  for (const actionId of ['zalo_message_friend', 'zalo_message_group']) {
    for (const minutes of [5, 60, 120]) {
      await check(`desktop ${actionId} ${minutes}`, { actionId, extra: { zaloShareRepeatAfterMinutes: minutes } }, value => {
        const expected = new Date(value.now.getTime() + minutes * 60_000).toISOString()
        assert.deepEqual(value.calls, ['reset-inputs', { update: { status: 'chờ xử lý', schedule: expected, note: null } }])
        assert.equal(value.campaign.status, 'chờ xử lý')
        assert.match(lastLog(value), /^⏳ Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch "Chia sẻ tin tới group" lúc /)
      })
      await check(`server ${actionId} ${minutes}`, { actionId, server: true, extra: { zaloShareRepeatAfterMinutes: minutes } }, value => {
        const expected = new Date(value.now.getTime() + minutes * 60_000).toISOString()
        assert.deepEqual(value.calls, [{ advance: expected }])
        assert.equal(value.campaign.schedule, expected)
        assert.match(lastLog(value), /hẹn gửi lặp lại/)
      })
    }
  }

  // 2. Số phút lưu dạng chuỗi vẫn dùng được.
  await check('string minutes', { extra: { zaloShareRepeatAfterMinutes: '30' } }, value => {
    assert.equal(scheduled(value).schedule, new Date(value.now.getTime() + 30 * 60_000).toISOString())
  })

  // 3. Lượt kế tiếp chạm giờ dừng trong ngày: hoàn thành, không hẹn lại.
  for (const server of [false, true]) {
    await check(`stop time server=${server}`, { server, now: vn('17:30') }, value => {
      assert.deepEqual(value.calls, ['complete'])
      assert.match(lastLog(value), /lượt gửi lặp kế tiếp vượt quá giờ dừng trong ngày/)
    })
  }
  await check('exactly at stop time', { now: vn('17:00') }, value => assert.deepEqual(value.calls, ['complete']))
  await check('one minute before stop time', { now: vn('16:59') }, value => assert.equal(value.campaign.status, 'chờ xử lý'))

  // 4. Không đặt giờ dừng: dừng ở 23:59 hoặc khi sang ngày mới.
  await check('23:59 drain', { dailyStopTime: null, now: vn('22:59') }, value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.match(lastLog(value), /vượt quá giờ dừng trong ngày/)
  })
  await check('before 23:59', { dailyStopTime: null, now: vn('22:58') }, value => assert.equal(value.campaign.status, 'chờ xử lý'))
  await check('next day', { dailyStopTime: null, now: vn('23:10') }, value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.match(lastLog(value), /lượt gửi lặp kế tiếp đã sang ngày mới/)
  })

  // 5. Lượt nhận từ hôm qua, hoàn thành sau nửa đêm: không tự mở lại trong ngày mới.
  await check('claimed previous day', { now: vn('00:10'), claimedDate: '2026-11-11' }, value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.match(lastLog(value), /đã sang ngày mới/)
  })
  await check('claimed same day', { claimedDate: '2026-11-12' }, value => assert.equal(value.campaign.status, 'chờ xử lý'))

  // 6. Không đủ điều kiện thì hoàn thành như chiến dịch thường.
  const plain = value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.equal(lastLog(value), '✅ Hoàn thành chiến dịch "Chia sẻ tin tới group"')
  }
  await check('flag off', { extra: { zaloShareRepeatEnabled: false } }, plain)
  await check('flag missing', { extra: { zaloShareRepeatEnabled: undefined } }, plain)
  await check('normal send mode', { extra: { zaloMessageSendMode: 'normal' } }, plain)
  await check('other action', { actionId: 'zalo_message_phone' }, plain)
  await check('cooldown on', { extra: { recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 3 } }, plain)
  for (const minutes of [0, 4, 1440, 2.5, 'abc', null, undefined]) {
    await check(`invalid minutes ${minutes}`, { extra: { zaloShareRepeatAfterMinutes: minutes } }, plain)
  }
  await check('data group source', { mode: 'data_group' }, value => {
    assert.deepEqual(value.calls, ['complete'])
  })
  await check('past end date', { scheduleEndDate: vn('09:00').toISOString() }, value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.match(lastLog(value), /hết ngày kết thúc/)
  })

  // 7. Đang bật cả nhiều khung giờ: nhiều khung giờ được ưu tiên (hẹn theo khung 14:00, không theo x phút).
  await check('multi slot wins', { extra: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: '09:00, 14:00' } }, value => {
    assert.equal(scheduled(value).schedule, vn('14:00').toISOString())
    assert.match(lastLog(value), /ở khung giờ 14:00/)
  })

  // 8. Data: còn dòng đến lịch thì chạy nốt; toàn bộ tạm dừng hoặc không có data thì hoàn thành.
  await check('pending due input', { details: [done(1), { id: 2, status: 'chờ xử lý', isDelete: false }] }, value => {
    assert.deepEqual(value.calls, [{ updateRunning: { status: 'chờ xử lý', note: 'Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.' } }])
  })
  await check('all paused', { details: [{ id: 1, status: 'tạm dừng', isDelete: false }] }, value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.match(lastLog(value), /không có data cần chạy lại ở lượt gửi lặp kế tiếp/)
  })
  await check('no data', { details: [] }, value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.match(lastLog(value), /không có data cần chạy lại ở lượt gửi lặp kế tiếp/)
  })
  await check('paused rows are not counted as resettable', { details: [done(1), { id: 2, status: 'tạm dừng', isDelete: false }] }, value => {
    assert.equal(value.calls[0], 'reset-inputs')
    assert.equal(value.campaign.status, 'chờ xử lý')
  })

  // 9. Zalo Server: người dùng tạm dừng đúng lúc chuyển lượt thì dừng ở ranh giới, không hẹn lại.
  await check('server paused at boundary', { server: true, advance: { ok: false, reason: 'runtime_control_paused' } }, value => {
    assert.deepEqual(value.calls.slice(1), ['latch-pause', 'pause-boundary'])
    assert.equal(value.campaign.status, 'tạm dừng')
    assert(!value.logs.some(message => message.includes('hẹn gửi lặp lại')))
  })

  console.log(`PASS ${cases} zalo-share-repeat cases: Local/Server, friend/group, x phút tính từ lúc hoàn thành, giờ dừng/23:59/ngày mới, điều kiện không hợp lệ, ưu tiên nhiều khung giờ, data tạm dừng/đến lịch, tạm dừng ở ranh giới`)
}

main().catch(error => { console.error(error); process.exit(1) })
