// Bước cập nhật lịch đầu ngày với chiến dịch lịch tuần/tháng bật "làm mới data": chạy đúng hàm thật
// `maintainCampaignSchedules` (và các hàm tính lịch, mapper thật) của campaignRepository.ts với Supabase giả trong
// bộ nhớ. Không gọi mạng, không đọc/ghi DB thật.
// Run: node scripts/campaign-schedule-refresh-paused-smoke-test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function readSource(relativePath) {
  const file = path.join(root, relativePath)
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}
function pickDeclarations(source, names) {
  return names.map(name => {
    const node = source.statements.find(statement =>
      (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === name)))
    assert.ok(node, `không tìm thấy ${name}`)
    return node.getText(source).replace(/^export /, '')
  }).join('\n')
}

const repositoryCode = pickDeclarations(readSource('src/main/data/repositories/campaignRepository.ts'), [
  'VIETNAM_TIME_ZONE', 'VIETNAM_UTC_OFFSET', 'NEWSFEED_INTERACTION_ACTION_ID', 'ZALO_MESSAGE_BIRTHDAY_ACTION_ID',
  'ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID', 'ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID', 'SMS_SEND_ACTION_ID',
  'VOICE_CALL_ACTION_ID', 'MOBILE_MANAGED_SMS_ACTION_IDS', 'CAMPAIGN_INPUT_DATA_FETCH_CHUNK',
  'vietnamDateTimeFormatter', 'vietnamWeekdayFormatter', 'pad2', 'parseVietnamParts', 'makeVietnamDate',
  'startOfVietnamDateKey', 'addVietnamDays', 'withVietnamTime', 'formatVietnamTimeForQuery',
  'isAtOrAfterDailyDrainTime', 'getVietnamWeekdayNumber', 'parseNumberList', 'resolveNextSchedule',
  'isPastScheduleEnd', 'clearZaloBirthdayMaterializedExtra', 'clearZaloFriendRecommendationMaterializedExtra',
  'clearZaloCancelSentFriendRequestMaterializedExtra', 'listCampaignInputData', 'clearCampaignInputData',
  'maintainCampaignSchedules'
])
const mapperCode = pickDeclarations(readSource('src/main/data/mappers.ts'),
  ['mapCampaignFromDB', 'mapCampaignInputDataFromDB'])
const compiled = ts.transpileModule(`${mapperCode}\n${repositoryCode}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText

const STAFF_ID = 347
const ORGANIZATION_ID = 9
const TODAY = '2026-11-11' // thứ Tư, giờ Việt Nam
const vn = (day, clock) => new Date(`${day}T${clock}:00+07:00`).toISOString()
const column = (row, name) => name.split('.').reduce((value, key) => value?.[key], row)

/** PostgREST giả: đủ các phép lọc mà maintainCampaignSchedules và hai hàm đọc/xoá data dùng. */
function createDatabase(tables) {
  const inputWrites = []
  function from(table) {
    const rows = tables[table]
    assert.ok(rows, `bảng ngoài phạm vi: ${table}`)
    const tests = []
    const orders = []
    let patch = null
    let limitCount = null
    let rangeBounds = null
    const query = {
      select: () => query,
      update: value => { patch = value; return query },
      eq: (name, value) => { tests.push(row => column(row, name) === value); return query },
      neq: (name, value) => { tests.push(row => column(row, name) !== value); return query },
      lt: (name, value) => {
        tests.push(row => column(row, name) != null && new Date(column(row, name)).getTime() < new Date(value).getTime())
        return query
      },
      gt: (name, value) => { tests.push(row => Number(column(row, name)) > Number(value)); return query },
      in: (name, values) => { tests.push(row => values.includes(column(row, name))); return query },
      not: (name, operator, value) => {
        if (operator === 'is' && value === null) tests.push(row => column(row, name) != null)
        else if (operator === 'in') {
          const excluded = String(value).replace(/^\(|\)$/g, '').split(',')
          tests.push(row => !excluded.includes(String(column(row, name))))
        } else throw new Error(`not(${operator}) ngoài phạm vi`)
        return query
      },
      or: (expression, options) => {
        const match = /^organization_id\.is\.null,organization_id\.eq\.(\d+)$/.exec(expression)
        assert.ok(match && options?.referencedTable === 'primary_account', expression)
        tests.push(row => row.primary_account.organization_id == null ||
          row.primary_account.organization_id === Number(match[1]))
        return query
      },
      order: (name, options) => { orders.push([name, options?.ascending !== false]); return query },
      limit: count => { limitCount = count; return query },
      range: (start, end) => { rangeBounds = [start, end]; return query },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject)
    }
    function run() {
      let matched = rows.filter(row => tests.every(test => test(row)))
      if (patch) {
        assert.equal(table, 'auto_campaign_input_data', 'chiến dịch chỉ được ghi qua updateCampaign')
        matched.forEach(row => Object.assign(row, patch))
        inputWrites.push({ patch: { ...patch }, ids: matched.map(row => row.id) })
        return { data: null, error: null }
      }
      matched = [...matched].sort((left, right) => {
        for (const [name, ascending] of orders) {
          const a = column(left, name)
          const b = column(right, name)
          if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1)
        }
        return 0
      })
      if (rangeBounds) matched = matched.slice(rangeBounds[0], rangeBounds[1] + 1)
      if (limitCount != null) matched = matched.slice(0, limitCount)
      return { data: matched.map(row => ({ ...row })), error: null }
    }
    return query
  }
  return { client: () => ({ from }), inputWrites }
}

let nextInputId = 1
function inputRows(campaignId, statuses) {
  return statuses.map((status, index) => ({
    id: nextInputId++, campaign_id: campaignId, status, is_delete: false,
    note: status === 'chờ xử lý' ? '' : `ghi chú ${status}`,
    date_action: status === 'chờ xử lý' ? null : vn('2026-11-10', '20:45'),
    created_at: new Date(Date.parse(vn('2026-11-01', '08:00')) + index * 1000).toISOString()
  }))
}
const repeat = (status, count) => Array.from({ length: count }, () => status)

function fixture({
  statuses = [], actionId = 'facebook_comment_seeding', scheduleType = 'weekly', weekDays = '2,3,4,5,6,7,8',
  monthDays = '', status = 'hoàn thành', refreshData = true, server = false, schedule = vn('2026-11-10', '20:30'),
  scheduleEndDate = null, continueNextDay = false, extraSettings = {}, extraRows = []
} = {}) {
  const campaignRow = {
    id: 31676, name: 'Seeding hằng tuần', action_id: actionId, account_id: 5, staff_id: STAFF_ID,
    organization_id: ORGANIZATION_ID, status, is_delete: false, schedule, original_schedule: schedule,
    schedule_type: scheduleType, schedule_week_days: weekDays, schedule_days: monthDays,
    schedule_end_date: scheduleEndDate, daily_stop_time: null, continue_next_day: continueNextDay,
    refresh_data: refreshData, note: 'Ghi chú của lượt trước', extra_settings: extraSettings,
    data_target_source_mode: 'direct', provisioning_state: 'ready', auto_campaign_actions: { name: actionId },
    primary_account: {
      name: 'Tài khoản thử', flatform_type: server || actionId.startsWith('zalo_') ? 'zalo' : 'facebook',
      is_delete: false, is_zalo_show_web: false, is_zalo_server: server, staff_id: STAFF_ID,
      organization_id: ORGANIZATION_ID
    }
  }
  const inputs = [...inputRows(campaignRow.id, statuses), ...extraRows.map(row => ({ campaign_id: campaignRow.id, ...row }))]
  const before = inputs.map(row => ({ ...row }))
  const database = createDatabase({ auto_campaigns: [campaignRow], auto_campaign_input_data: inputs })
  const campaignUpdates = []
  const finalized = []
  const globals = {
    client: database.client,
    requireCurrentUser: () => ({ staffId: STAFF_ID, organizationId: ORGANIZATION_ID }),
    getCampaign: async id => (id === campaignRow.id ? mapCampaign(campaignRow) : null),
    updateCampaign: async (id, updates) => {
      assert.equal(id, campaignRow.id)
      campaignUpdates.push({ ...updates })
      if (updates.status !== undefined) campaignRow.status = updates.status
      if (updates.schedule !== undefined) campaignRow.schedule = updates.schedule
      if (updates.note !== undefined) campaignRow.note = updates.note
      if (updates.extraSettings !== undefined) campaignRow.extra_settings = updates.extraSettings
      return mapCampaign(campaignRow)
    },
    finalizeCampaign: async (id, note, expectedStatus) => {
      finalized.push({ runtime: 'desktop', id, note, expectedStatus })
      campaignRow.status = 'hoàn thành'
      return { completed: true, reason: 'completed' }
    },
    finalizeZaloServerMaintenanceCampaign: async (id, note, revision) => {
      finalized.push({ runtime: 'server', id, note, revision })
      campaignRow.status = 'hoàn thành'
      return { completed: true, reason: 'completed' }
    },
    finalizeDataGroupCampaign: async () => { throw new Error('không dùng Nhóm data trong smoke này') }
  }
  const exported = new Function(...Object.keys(globals),
    `${compiled}; return { maintainCampaignSchedules, mapCampaignFromDB }`)(...Object.values(globals))
  function mapCampaign(row) { return exported.mapCampaignFromDB(row) }
  const run = () => (server
    ? exported.maintainCampaignSchedules(TODAY, 'zalo', { runtimeTarget: 'server', runtimeModeRevision: 'rev-1' })
    : exported.maintainCampaignSchedules(TODAY))
  return { campaignRow, inputs, before, inputWrites: database.inputWrites, campaignUpdates, finalized, run }
}

const RESET_PATCH = { status: 'chờ xử lý', note: '', date_action: null }

/** Đã làm mới: mọi dòng khác `tạm dừng` về chờ xử lý, dòng `tạm dừng` giữ nguyên, chiến dịch mở lại ở kỳ mới. */
function assertRefreshed(value, nextSchedule) {
  const live = value.before.filter(row => !row.is_delete)
  const resettable = live.filter(row => row.status !== 'tạm dừng')
  if (live.length > 0) {
    assert.deepEqual(value.inputWrites, [{ patch: RESET_PATCH, ids: resettable.map(row => row.id) }])
  } else {
    assert.deepEqual(value.inputWrites, [])
  }
  for (const original of value.before) {
    const current = value.inputs.find(row => row.id === original.id)
    if (original.is_delete || original.status === 'tạm dừng') assert.deepEqual(current, original)
    else assert.deepEqual(current, { ...original, ...RESET_PATCH })
  }
  assert.deepEqual(value.campaignUpdates, [{ status: 'chờ xử lý', schedule: nextSchedule, note: null }])
  assert.equal(value.campaignRow.status, 'chờ xử lý')
  assert.equal(value.campaignRow.schedule, nextSchedule)
  assert.equal(value.campaignRow.note, null)
  assert.deepEqual(value.finalized, [])
}

/** Không làm mới: không dòng data nào bị đụng tới, chỉ dời lịch sang kỳ mới và giữ nguyên trạng thái chiến dịch. */
function assertOnlyRescheduled(value, nextSchedule, status) {
  assert.deepEqual(value.inputWrites, [])
  assert.deepEqual(value.inputs, value.before)
  assert.deepEqual(value.campaignUpdates, [{ schedule: nextSchedule, note: null }])
  assert.equal(value.campaignRow.status, status)
  assert.equal(value.campaignRow.schedule, nextSchedule)
  assert.deepEqual(value.finalized, [])
}

async function main() {
  let cases = 0
  const check = async (name, options, verify) => {
    const value = fixture(options)
    try {
      const updated = await value.run()
      await verify(value, updated)
    } catch (error) {
      console.error(`Ca lỗi: ${name}`)
      throw error
    }
    cases++
  }

  const recurrences = [
    { label: 'tuần đủ 7 thứ', options: { scheduleType: 'weekly' }, next: vn('2026-11-11', '20:30') },
    { label: 'tuần chỉ thứ Sáu', options: { scheduleType: 'weekly', weekDays: '6' }, next: vn('2026-11-13', '20:30') },
    { label: 'tháng ngày 15', options: { scheduleType: 'monthly', weekDays: '', monthDays: '15' }, next: vn('2026-11-15', '20:30') }
  ]
  const runtimes = [
    { label: 'Desktop', options: {} },
    { label: 'App Server', options: { server: true, actionId: 'zalo_message_friend' } }
  ]

  for (const recurrence of recurrences) {
    for (const runtime of runtimes) {
      const base = { ...recurrence.options, ...runtime.options }
      const label = `${runtime.label}, ${recurrence.label}`

      // 1. Mọi dòng đã xong: làm mới như trước.
      await check(`${label}: mọi dòng xong`, { ...base, statuses: repeat('hoàn thành', 5) }, (value, updated) => {
        assertRefreshed(value, recurrence.next)
        assert.equal(updated.length, 1)
      })

      // 2. Có dòng tạm dừng, các dòng còn lại đã xong (đúng ca production 62 + 1): vẫn làm mới, bỏ qua dòng tạm dừng.
      await check(`${label}: 62 xong + 1 tạm dừng`, {
        ...base, statuses: [...repeat('hoàn thành', 40), 'tạm dừng', ...repeat('hoàn thành', 22)]
      }, value => {
        assertRefreshed(value, recurrence.next)
        assert.equal(value.inputWrites[0].ids.length, 62)
        assert.equal(value.inputs.filter(row => row.status === 'tạm dừng').length, 1)
      })
      await check(`${label}: nhiều dòng tạm dừng xen kẽ`, {
        ...base, statuses: ['tạm dừng', 'hoàn thành', 'tạm dừng', 'hoàn thành', 'tạm dừng']
      }, value => assertRefreshed(value, recurrence.next))
      await check(`${label}: chiến dịch đang chờ xử lý, data xong + tạm dừng`, {
        ...base, status: 'chờ xử lý', statuses: ['hoàn thành', 'tạm dừng', 'hoàn thành']
      }, value => assertRefreshed(value, recurrence.next))

      // 3. Mọi dòng đều tạm dừng: không còn gì để đặt lại nên không mở lại chiến dịch.
      await check(`${label}: mọi dòng tạm dừng`, { ...base, statuses: repeat('tạm dừng', 3) },
        value => assertOnlyRescheduled(value, recurrence.next, 'hoàn thành'))
      await check(`${label}: mọi dòng tạm dừng, chiến dịch chờ xử lý`, {
        ...base, status: 'chờ xử lý', statuses: repeat('tạm dừng', 3)
      }, value => assertOnlyRescheduled(value, recurrence.next, 'chờ xử lý'))

      // 4. Còn dòng chờ xử lý: chưa chạy hết, chỉ dời lịch (có hay không có dòng tạm dừng).
      await check(`${label}: còn dòng chờ xử lý`, {
        ...base, status: 'chờ xử lý', statuses: ['hoàn thành', 'chờ xử lý', 'hoàn thành']
      }, value => assertOnlyRescheduled(value, recurrence.next, 'chờ xử lý'))
      await check(`${label}: còn dòng chờ xử lý + tạm dừng`, {
        ...base, status: 'chờ xử lý', statuses: ['hoàn thành', 'tạm dừng', 'chờ xử lý']
      }, value => assertOnlyRescheduled(value, recurrence.next, 'chờ xử lý'))
      await check(`${label}: chiến dịch hoàn thành nhưng còn dòng chờ xử lý`, {
        ...base, statuses: ['hoàn thành', 'tạm dừng', 'chờ xử lý']
      }, value => assertOnlyRescheduled(value, recurrence.next, 'hoàn thành'))

      // 5. Dòng đang chạy là dòng một lượt chạy còn giữ: không đặt lại, chỉ dời lịch.
      await check(`${label}: còn dòng đang chạy`, { ...base, statuses: ['hoàn thành', 'đang chạy', 'hoàn thành'] },
        value => assertOnlyRescheduled(value, recurrence.next, 'hoàn thành'))
      await check(`${label}: còn dòng đang chạy + tạm dừng`, {
        ...base, statuses: ['hoàn thành', 'tạm dừng', 'đang chạy']
      }, value => assertOnlyRescheduled(value, recurrence.next, 'hoàn thành'))

      // 6. Không bật làm mới data: chỉ dời lịch dù data đã xong.
      await check(`${label}: tắt làm mới data`, {
        ...base, refreshData: false, statuses: ['hoàn thành', 'tạm dừng', 'hoàn thành']
      }, value => assertOnlyRescheduled(value, recurrence.next, 'hoàn thành'))

      // 7. Không có data (hoặc chỉ còn dòng đã xoá): mở lại như trước.
      await check(`${label}: không có data`, { ...base, statuses: [] }, value => assertRefreshed(value, recurrence.next))
      await check(`${label}: dòng đã xoá không tính`, {
        ...base, statuses: ['hoàn thành', 'tạm dừng'],
        extraRows: [{ id: 900001, status: 'chờ xử lý', is_delete: true, note: '', date_action: null, created_at: vn('2026-11-02', '08:00') }]
      }, value => assertRefreshed(value, recurrence.next))
    }
  }

  // 8. Data nhiều hơn một trang đọc (1.000 dòng): dòng tạm dừng/chờ xử lý ở trang sau vẫn được xét.
  await check('2.001 dòng, tạm dừng ở trang cuối', {
    statuses: [...repeat('hoàn thành', 2000), 'tạm dừng']
  }, value => {
    assertRefreshed(value, vn('2026-11-11', '20:30'))
    assert.equal(value.inputWrites[0].ids.length, 2000)
  })
  await check('2.001 dòng, chờ xử lý ở trang cuối', {
    statuses: [...repeat('hoàn thành', 1500), 'tạm dừng', ...repeat('hoàn thành', 499), 'chờ xử lý']
  }, value => assertOnlyRescheduled(value, vn('2026-11-11', '20:30'), 'hoàn thành'))

  // 9. Lượt cập nhật lịch thứ hai trong cùng ngày không đụng lại chiến dịch đã dời lịch.
  await check('chạy lại trong ngày', { statuses: ['hoàn thành', 'tạm dừng'] }, async value => {
    assertRefreshed(value, vn('2026-11-11', '20:30'))
    const afterFirstRun = value.inputs.map(row => ({ ...row }))
    assert.deepEqual(await value.run(), [])
    assert.equal(value.inputWrites.length, 1)
    assert.equal(value.campaignUpdates.length, 1)
    assert.deepEqual(value.inputs, afterFirstRun)
  })

  // 10. Hết ngày kết thúc: hoàn thành như trước, không làm mới dù có dòng tạm dừng.
  for (const runtime of runtimes) {
    await check(`${runtime.label}: quá ngày kết thúc`, {
      ...runtime.options, statuses: ['hoàn thành', 'tạm dừng'], scheduleEndDate: vn('2026-11-10', '23:59')
    }, value => {
      assert.deepEqual(value.inputWrites, [])
      assert.deepEqual(value.inputs, value.before)
      assert.equal(value.finalized.length, 1)
      assert.equal(value.finalized[0].note, 'Chiến dịch đã hết ngày kết thúc')
      assert.deepEqual(value.campaignUpdates, [{ schedule: vn('2026-11-11', '20:30') }])
    })
  }

  // 11. Các nhánh đặc thù của lịch tuần/tháng không phụ thuộc dòng tạm dừng: luôn xoá data đã dựng và mở lại.
  const specialActions = [
    { actionId: 'zalo_message_friend_recommendation', extra: { zaloFriendRecommendationDataMaterializedAt: 'x', zaloFriendRecommendationMaterializedCount: 2, keep: 1 } },
    { actionId: 'zalo_cancel_sent_friend_request', extra: { zaloCancelFriendRequestDataMaterializedAt: 'x', zaloCancelFriendRequestMaterializedCount: 2, keep: 1 } },
    { actionId: 'zalo_message_birthday', extra: { zaloBirthdayDataMaterializedDate: 'x', zaloBirthdayMaterializedCount: 2, keep: 1 } }
  ]
  for (const special of specialActions) {
    for (const statuses of [['hoàn thành', 'hoàn thành'], ['hoàn thành', 'tạm dừng'], ['tạm dừng', 'tạm dừng'], ['chờ xử lý', 'tạm dừng'], []]) {
      for (const scheduleType of ['weekly', 'monthly']) {
        await check(`${special.actionId} ${scheduleType} [${statuses.join(', ')}]`, {
          actionId: special.actionId, scheduleType, weekDays: '2,3,4,5,6,7,8', monthDays: '11',
          statuses, extraSettings: special.extra
        }, value => {
          assert.deepEqual(value.inputWrites, statuses.length > 0
            ? [{ patch: { is_delete: true }, ids: value.before.map(row => row.id) }]
            : [])
          assert.ok(value.inputs.every(row => row.is_delete === true))
          assert.deepEqual(value.inputs.map(row => row.status), statuses)
          assert.deepEqual(value.campaignUpdates, [{
            status: 'chờ xử lý', schedule: vn('2026-11-11', '20:30'), note: null, extraSettings: { keep: 1 }
          }])
        })
      }
    }
  }

  // 12. Lịch hằng ngày không đi qua nhánh làm mới: chiến dịch đã hoàn thành giữ nguyên, đang chờ chỉ dời lịch.
  await check('hằng ngày đã hoàn thành', { scheduleType: 'daily', statuses: ['hoàn thành', 'tạm dừng'] }, (value, updated) => {
    assert.deepEqual(updated, [])
    assert.deepEqual(value.inputWrites, [])
    assert.deepEqual(value.campaignUpdates, [])
    assert.deepEqual(value.inputs, value.before)
  })
  await check('hằng ngày đang chờ, chờ giờ hẹn ngày mới', {
    scheduleType: 'daily', status: 'chờ xử lý', continueNextDay: true, statuses: ['hoàn thành', 'tạm dừng', 'chờ xử lý']
  }, value => assertOnlyRescheduled(value, vn('2026-11-11', '20:30'), 'chờ xử lý'))
  for (const actionId of ['zalo_message_birthday', 'facebook_newsfeed_interaction']) {
    await check(`${actionId} hằng ngày đã hoàn thành`, { actionId, scheduleType: 'daily', statuses: ['hoàn thành', 'tạm dừng'] }, value => {
      assert.deepEqual(value.inputWrites, [])
      assert.deepEqual(value.campaignUpdates, [])
      assert.deepEqual(value.finalized, [])
    })
  }

  console.log(`campaign-schedule-refresh-paused smoke: ${cases} ca đạt`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
