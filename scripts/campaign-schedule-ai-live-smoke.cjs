// Opt-in provider smoke: real existing HTTP AI configuration/runtime; synthetic schedule data only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
async function main() {
  assert(process.argv.includes('--live'), 'Pass --live to make billable AI calls')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-ai-live-'))
  try {
    const entry = path.join(dir, 'entry.ts'), output = path.join(dir, 'entry.cjs')
    fs.writeFileSync(entry, `export { generateCampaignSchedule } from ${JSON.stringify(path.join(root,'src/main/services/campaignScheduleAiService.ts'))};
      export { setCurrentUser } from ${JSON.stringify(path.join(root,'src/main/data/currentUser.ts'))};`)
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
    const { generateCampaignSchedule, setCurrentUser } = require(output)
    // No customer/account/campaign IDs: the normal logger records these as system smoke calls.
    setCurrentUser({ staffId: 0, organizationId: null })
    const schedule = { scheduleType: 'daily', startDate: '2026-10-14', startTime: '09:00', scheduleEndDate: '2026-10-21',
      scheduleDays: '', scheduleWeekDays: '', useDailyStopTime: false, dailyStopTime: '18:00', continueNextDay: true,
      refreshData: true, findDataRerunEnabled: false, findDataRerunAfterHours: 1, multiDailyTimeSlotsEnabled: false, multiDailyTimeSlots: '' }
    const cases = [
      { name: 'weekly', description: 'gửi vào thứ 2,4,6 hàng tuần lúc 8h',
        check: result => assert.deepEqual(result, { ok: true, patch: { scheduleType: 'weekly', startTime: '08:00', scheduleWeekDays: '2,4,6' } }) },
      { name: 'business-conflict-filled', description: 'Chỉ đổi giờ chạy sang 20h và bật giờ dừng lúc 18h.',
        check: result => { assert(result.ok); assert.equal(result.patch.startTime, '20:00'); assert.equal(result.patch.dailyStopTime, '18:00'); assert.equal(result.patch.useDailyStopTime, true) } },
      { name: 'monthly', description: 'chạy các ngày 1,15,28 hàng tháng lúc 09:30',
        check: result => { assert(result.ok); assert.equal(result.patch.scheduleType, 'monthly'); assert.equal(result.patch.scheduleDays, '1,15,28'); assert.equal(result.patch.startTime, '09:30'); assert.equal(result.patch.scheduleEndDate, undefined) } },
      { name: 'unsupported', actionId: 'zalo_message_group_realtime', description: 'chỉ chạy thứ 2 và thứ 6 hàng tuần lúc 8h',
        check: result => assert.equal(result.code, 'unsupported') },
      { name: 'unclear', description: 'gửi vào lúc nào đó tiện nhất', check: result => assert.equal(result.code, 'unclear') },
      { name: 'relative-date', description: 'ngày mai lúc 8h', check: result => { assert(result.ok); const date = new Date(Date.now() + 7 * 3600_000 + 86400_000).toISOString().slice(0, 10); assert.equal(result.patch.startDate, date); assert.equal(result.patch.startTime, '08:00') } }
    ]
    const results = []
    for (const fixture of cases) {
      const result = await generateCampaignSchedule({ requestId: crypto.randomUUID(), description: fixture.description,
        context: { actionId: fixture.actionId || 'facebook_timeline_post', dataTargetSourceMode: 'direct' }, schedule }, AbortSignal.timeout(120000))
      fixture.check(result); results.push({ name: fixture.name, result }); console.log('PASS live', fixture.name)
    }
    fs.writeFileSync(path.join(root, 'migrations/snapshots/campaign-schedule-ai-v399/live-ai.json'), JSON.stringify({ at: new Date().toISOString(), model: 'gpt-6.1-sol', passed: true, results }, null, 2) + '\n')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
