// Opt-in synthetic examples through the existing provider/runtime/logger, never customer campaigns.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const snapshotDir = path.join(root, 'migrations/snapshots/campaign-schedule-ai-v400')
const sql = fs.readFileSync(path.join(root, 'migrations/migration_v400_campaign_schedule_natural_language.sql'), 'utf8')
const candidate = sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)[1]
const schedule = { scheduleType: 'monthly', startDate: '2026-10-14', startTime: '20:00', scheduleEndDate: '2026-10-12',
  scheduleDays: '1,15', scheduleWeekDays: '4,5', useDailyStopTime: false, dailyStopTime: '18:00', continueNextDay: true,
  refreshData: false, findDataRerunEnabled: false, findDataRerunAfterHours: 1, multiDailyTimeSlotsEnabled: false, multiDailyTimeSlots: '' }
const exact = patch => result => assert.deepEqual(result, { ok: true, patch })
const status = code => result => { assert.equal(result.ok, false); assert.equal(result.code, code); assert(result.message.length > 70, 'include a specific reason') }
const cases = [
  { name: 'noon-start-middle-month', description: 'chạy vào buổi trưa, vào đầu và giữa tháng',
    check: exact({ scheduleType: 'monthly', startTime: '12:00', scheduleDays: '1,15' }) },
  { name: 'noon-explicit-time', description: 'chạy vào 11h30 trưa đầu tháng và giữa tháng',
    check: exact({ scheduleType: 'monthly', startTime: '11:30', scheduleDays: '1,15' }) },
  { name: 'today-replaces-monthly', description: 'chạy vào 7h30 sáng hôm nay', service: true,
    check: (result, now) => exact({ scheduleType: 'daily', startDate: now.slice(0, 10), startTime: '07:30' })(result) },
  { name: 'hour-only-keeps-monthly', description: 'chỉ đổi giờ chạy thành 7h30 sáng', service: true,
    check: exact({ startTime: '07:30' }) },
  { name: 'start-only-keeps-monthly', description: 'đổi ngày bắt đầu sang hôm nay',
    check: (result, now) => exact({ startDate: now.slice(0, 10) })(result) },
  { name: 'explicit-keep-cycle', description: 'giữ nguyên lịch hàng tháng, bắt đầu từ ngày mai lúc 9h',
    check: result => { assert(result.ok); assert.equal(result.patch.startDate, '2026-10-15'); assert.equal(result.patch.startTime, '09:00'); assert([undefined, 'monthly'].includes(result.patch.scheduleType)); assert.equal(result.patch.scheduleEndDate, undefined); assert.equal(result.patch.scheduleDays, undefined) } },
  { name: 'tomorrow-year-boundary', description: 'ngày mai lúc 9h', now: '2026-12-31T23:58',
    check: exact({ scheduleType: 'daily', startDate: '2027-01-01', startTime: '09:00' }) },
  { name: 'next-month-noon', description: 'chạy trưa đầu tháng sau', now: '2026-12-31T23:58',
    check: exact({ scheduleType: 'daily', startDate: '2027-01-01', startTime: '12:00' }) },
  { name: 'weekly-no-refresh', description: 'gửi vào thứ 2,4,6 hàng tuần lúc 8h',
    check: exact({ scheduleType: 'weekly', startTime: '08:00', scheduleWeekDays: '2,4,6' }) },
  { name: 'weekend-data-group', description: 'chạy cuối tuần lúc 8h', dataTargetSourceMode: 'data_group',
    check: exact({ scheduleType: 'weekly', startTime: '08:00', scheduleWeekDays: '7,8' }) },
  { name: 'single-time-disables-slots', description: 'chỉ đổi giờ chạy thành 7h30 sáng', actionId: 'facebook_timeline_post',
    schedule: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: '08:00, 14:00' },
    check: exact({ startTime: '07:30', multiDailyTimeSlotsEnabled: false }) },
  { name: 'multiple-times', description: 'đầu và giữa tháng chạy lúc 8h sáng và 8h tối', actionId: 'facebook_timeline_post',
    check: exact({ scheduleType: 'monthly', startTime: '08:00', scheduleDays: '1,15', multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: '08:00, 20:00' }) },
  { name: 'business-conflicts-still-fill', description: 'chỉ đổi giờ chạy thành 23:59 và giờ dừng thành 18h, ngày kết thúc thành 01/10/2026',
    check: exact({ startTime: '23:59', scheduleEndDate: '2026-10-01', useDailyStopTime: true, dailyStopTime: '18:00' }) },
  { name: 'unsupported-realtime', description: 'chạy buổi trưa đầu và giữa tháng', actionId: 'zalo_message_group_realtime',
    schedule: { scheduleType: 'daily' }, check: status('unsupported') },
  { name: 'unsupported-once-only', description: 'chỉ chạy đúng một lần hôm nay lúc 7h30, không bao giờ tiếp tục ngày sau', check: status('unsupported') },
  { name: 'unsupported-last-day', description: 'chạy ngày cuối cùng mỗi tháng vào buổi trưa', check: status('unsupported') },
  { name: 'general-morning-intent', description: 'chạy buổi sáng đầu và giữa tháng',
    check: result => { assert(result.ok); assert.equal(result.patch.scheduleType, 'monthly'); assert.equal(result.patch.scheduleDays, '1,15'); assert.match(result.patch.startTime, /^(0[6-9]|1[01]):[0-5]\d$/); assert.equal(result.patch.scheduleEndDate, undefined) } },
  { name: 'spoken-weekday-and-hour', description: 'Tuần nào cũng gửi vào thứ ba với thứ năm nhé, tầm tám giờ rưỡi sáng.',
    check: exact({ scheduleType: 'weekly', startTime: '08:30', scheduleWeekDays: '3,5' }) },
  { name: 'early-afternoon-unseen-phrasing', description: 'Cứ đầu giờ chiều các ngày từ thứ hai tới thứ sáu thì gửi.',
    check: result => { assert(result.ok); assert.equal(result.patch.scheduleType, 'weekly'); assert.equal(result.patch.scheduleWeekDays, '2,3,4,5,6'); assert.match(result.patch.startTime, /^1[23]:[0-5]\d$/); assert.equal(result.patch.refreshData, undefined) } },
  { name: 'partial-relative-shift', description: 'Lịch như cũ, chỉ lùi ngày bắt đầu thêm hai ngày.',
    check: exact({ startDate: '2026-10-16' }) },
  { name: 'negation-and-partial-edit', description: 'Không cần dừng theo giờ nữa, lịch với giờ gửi cứ để vậy.',
    check: exact({ useDailyStopTime: false }) },
  { name: 'clarify-unselected-alternative', description: 'Chạy lúc 8h sáng hoặc 8h tối, tôi chưa chọn giờ nào; chỉ chạy ở một giờ thôi.', service: true,
    check: result => { status('unclear')(result); assert.match(result.message, /giờ|sáng|tối/) } }
]
async function main() {
  assert(process.argv.includes('--live'), 'Pass --live to make billable provider calls')
  const mode = process.argv.includes('--applied') ? 'applied' : 'candidate'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-ai-v400-live-'))
  const results = []
  try {
    const entry = path.join(dir, 'entry.ts'), output = path.join(dir, 'entry.cjs')
    fs.writeFileSync(entry, `export { callAiUsing } from ${JSON.stringify(path.join(root, 'src/main/services/aiRuntimeService.ts'))};
      export { generateCampaignSchedule } from ${JSON.stringify(path.join(root, 'src/main/services/campaignScheduleAiService.ts'))};
      export { setCurrentUser } from ${JSON.stringify(path.join(root, 'src/main/data/currentUser.ts'))};
      export * from ${JSON.stringify(path.join(root, 'src/shared/campaignScheduleAi.ts'))};`)
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
    const s = require(output)
    s.setCurrentUser({ staffId: 0, organizationId: null })
    for (const fixture of cases.filter(row => mode === 'candidate' || row.service || row.name === 'noon-start-middle-month')) {
      const request = { requestId: crypto.randomUUID(), description: fixture.description,
        context: { actionId: fixture.actionId || 'facebook_group_post', dataTargetSourceMode: fixture.dataTargetSourceMode || 'direct' },
        schedule: { ...schedule, ...fixture.schedule } }
      const now = mode === 'applied' && fixture.service ? s.formatScheduleVietnam(new Date()) : fixture.now || '2026-10-14T23:48'
      let result, logId
      if (mode === 'applied' && fixture.service) {
        result = await s.generateCampaignSchedule(request, AbortSignal.timeout(120000))
      } else {
        const ai = await s.callAiUsing(s.CAMPAIGN_SCHEDULE_AI_CODE, {
          scheduleContext: JSON.stringify({ description: request.description, currentSchedule: request.schedule, ...request.context,
            capabilities: s.getScheduleAiCapabilities(request.context), currentDateTime: now, timeZone: 'Asia/Ho_Chi_Minh' }),
          ...(mode === 'candidate' ? { systemPromptOverride: candidate } : {}),
          bodyOverrides: { store: false, text: { format: { type: 'json_schema', name: 'campaign_schedule', strict: true, schema: s.SCHEDULE_AI_SCHEMA } } }
        }, { organizationId: null }, { signal: AbortSignal.timeout(120000), expectedModel: s.CAMPAIGN_SCHEDULE_AI_MODEL })
        assert(ai.ok, 'Provider call failed'); assert.equal(ai.renderedSystemPrompt, candidate)
        result = s.parseScheduleAiResponse(ai.content, request); logId = ai.logId
      }
      const row = { name: fixture.name, description: fixture.description, currentDateTime: now, result, logId }
      results.push(row)
      try { fixture.check(result, now); row.passed = true; console.log('PASS', mode, fixture.name) }
      catch (error) { row.passed = false; row.failure = error.message; console.log('FAIL', mode, fixture.name, JSON.stringify(result)) }
    }
    const passed = results.every(row => row.passed)
    fs.writeFileSync(path.join(snapshotDir, `${mode}-live.json`), JSON.stringify({ at: new Date().toISOString(),
      model: 'gpt-6.1-sol', migration_sha256: crypto.createHash('sha256').update(sql).digest('hex'), passed, results }, null, 2) + '\n', { flag: 'wx' })
    assert(passed, 'See recorded cases for failures')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
