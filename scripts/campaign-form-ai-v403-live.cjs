// Synthetic opt-in provider regression checks. No customer campaigns are read or changed.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), snapshots = path.join(root, 'migrations/snapshots/campaign-form-ai-v403')
const sql = fs.readFileSync(path.join(root, 'migrations/migration_v403_campaign_form_ai_repeat.sql'), 'utf8')
const prompts = Object.fromEntries([49,52].map(id => [id, sql.match(new RegExp(`\\$prompt${id}\\$([\\s\\S]*?)\\$prompt${id}\\$`))[1]]))
const limits = { sleepBetweenActions: 30, continueWhenActionLimitReached: false, postsPerTarget: 3,
  actions: [{ actionCode: 'zalo_message_friend', label: 'Nhắn tin bạn bè', unit: 'tin nhắn', dailyLimit: 100, rateLimitCount: 15, rateLimitMinutes: 60 }] }
const schedule = { scheduleType: 'weekly', startDate: '2026-10-15', startTime: '08:00', scheduleEndDate: '2026-12-31',
  scheduleDays: '1,15', scheduleWeekDays: '2,4,6', useDailyStopTime: false, dailyStopTime: '18:00', continueNextDay: true,
  refreshData: false, findDataRerunEnabled: false, findDataRerunAfterHours: 1, multiDailyTimeSlotsEnabled: false, multiDailyTimeSlots: '' }
const cases = [
  { name: 'limits-repeat-user-report', kind: 'limits', description: 'Mỗi ngày gửi tối đa 100 tin, mỗi giờ gửi không quá 15 tin', repeat: 2, applied: true },
  { name: 'limits-keep-current', kind: 'limits', description: 'Giữ nguyên toàn bộ giới hạn hiện tại.' },
  { name: 'limits-partial-edit', kind: 'limits', description: 'Chỉ đổi hạn mức ngày thành 80 tin, các mục khác giữ nguyên.', dailyLimit: 80 },
  { name: 'limits-unclear', kind: 'limits', description: 'Đặt một trong hai loại nhắn tin thành 40 tin mỗi ngày, tôi chưa chọn loại nào.',
    extraAction: true, error: 'unclear', applied: true },
  { name: 'limits-unsupported', kind: 'limits', description: 'Bỏ hết các hạn mức để nhắn không giới hạn.', error: 'unsupported' },
  { name: 'schedule-repeat', kind: 'schedule', description: 'Gửi vào thứ 2, 4, 6 hàng tuần lúc 8h.', repeat: 2, applied: true },
  { name: 'schedule-keep-current', kind: 'schedule', description: 'Giữ nguyên toàn bộ lịch hiện tại.' },
  { name: 'schedule-partial-edit', kind: 'schedule', description: 'Chỉ đổi giờ chạy thành 9h, giữ nguyên các phần khác.', startTime: '09:00' },
  { name: 'schedule-unclear', kind: 'schedule', description: 'Chỉ chạy lúc 8h sáng hoặc 8h tối, tôi chưa chọn giờ nào.', error: 'unclear', applied: true }
]
async function main() {
  assert(process.argv.includes('--live'), 'Pass --live for billable provider calls')
  const mode = process.argv.includes('--applied') ? 'applied' : 'candidate', results = []
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-form-ai-v403-live-'))
  try {
    const entry = path.join(temp, 'entry.ts'), output = path.join(temp, 'entry.cjs')
    fs.writeFileSync(entry, `export { callAiUsing } from ${JSON.stringify(path.join(root, 'src/main/services/aiRuntimeService.ts'))};
      export { generateCampaignSchedule } from ${JSON.stringify(path.join(root, 'src/main/services/campaignScheduleAiService.ts'))};
      export { generateCampaignLimits } from ${JSON.stringify(path.join(root, 'src/main/services/campaignLimitsAiService.ts'))};
      export { setCurrentUser } from ${JSON.stringify(path.join(root, 'src/main/data/currentUser.ts'))};
      export * from ${JSON.stringify(path.join(root, 'src/shared/campaignLimitsAi.ts'))};
      export * from ${JSON.stringify(path.join(root, 'src/shared/campaignScheduleAi.ts'))};`)
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
    const s = require(output); s.setCurrentUser({ staffId: 0, organizationId: null })
    for (const f of cases.filter(f => mode === 'candidate' || f.applied)) {
      const isLimits = f.kind === 'limits'
      const current = structuredClone(isLimits ? limits : schedule)
      if (f.extraAction) current.actions.push({ ...current.actions[0], actionCode: 'zalo_message_stranger', label: 'Nhắn tin người lạ' })
      for (let attempt = 1; attempt <= (f.repeat || 1); attempt++) {
        const request = { requestId: crypto.randomUUID(), description: f.description,
          context: { actionId: isLimits ? 'zalo_message_friend' : 'facebook_group_post', dataTargetSourceMode: 'direct', ...(isLimits ? { accountGroupOverrides: false } : {}) },
          [isLimits ? 'limits' : 'schedule']: current }
        let result, logId
        if (mode === 'applied') result = await (isLimits ? s.generateCampaignLimits : s.generateCampaignSchedule)(request, AbortSignal.timeout(120000))
        else {
          const prompt = prompts[isLimits ? 52 : 49]
          const input = JSON.stringify({ description: f.description, ...request.context, [isLimits ? 'currentLimits' : 'currentSchedule']: current,
            capabilities: (isLimits ? s.getLimitsAiCapabilities : s.getScheduleAiCapabilities)(request.context),
            ...(!isLimits ? { currentDateTime: '2026-10-15T01:00', timeZone: 'Asia/Ho_Chi_Minh' } : {}) })
          const ai = await s.callAiUsing(isLimits ? s.CAMPAIGN_LIMITS_AI_CODE : s.CAMPAIGN_SCHEDULE_AI_CODE, {
            systemPromptOverride: prompt, promptOverride: input,
            bodyOverrides: { store: false, text: { format: { type: 'json_schema', name: isLimits ? 'campaign_action_limits' : 'campaign_schedule', strict: true,
              schema: isLimits ? s.LIMITS_AI_SCHEMA : s.SCHEDULE_AI_SCHEMA } } }
          }, { organizationId: null }, { signal: AbortSignal.timeout(120000), expectedModel: 'gpt-6.1-sol' })
          assert(ai.ok, 'Provider failed'); assert.equal(ai.renderedSystemPrompt, prompt); assert.equal(ai.renderedUserPrompt, input)
          result = (isLimits ? s.parseLimitsAiResponse : s.parseScheduleAiResponse)(ai.content, request); logId = ai.logId
        }
        const row = { name: f.name, attempt, description: f.description, result, logId }; results.push(row)
        try {
          if (f.error) { assert.equal(result.ok, false); assert.equal(result.code, f.error) }
          else {
            assert.equal(result.ok, true)
            if (isLimits) {
              const next = { ...current, ...result.patch, actions: current.actions.map(action => ({ ...action, ...result.patch.actions.find(p => p.actionCode === action.actionCode) })) }
              const expected = structuredClone(limits)
              if (f.dailyLimit !== undefined) expected.actions[0].dailyLimit = f.dailyLimit
              assert.deepEqual(next, expected, 'only requested fields may change'); Object.assign(current, next)
            } else {
              const next = { ...current, ...result.patch }
              assert.deepEqual(next, { ...schedule, ...(f.startTime ? { startTime: f.startTime } : {}) }); Object.assign(current, next)
            }
          }
          row.passed = true; console.log('PASS', mode, f.name, attempt)
        } catch (error) { row.passed = false; row.failure = error.message; console.log('FAIL', mode, f.name, JSON.stringify(result)) }
      }
    }
    const passed = results.every(row => row.passed)
    fs.writeFileSync(path.join(snapshots, `${mode}-live.json`), JSON.stringify({ at: new Date().toISOString(), passed, model: 'gpt-6.1-sol',
      migration_sha256: crypto.createHash('sha256').update(sql).digest('hex'), results }, null, 2) + '\n', { flag: 'wx' })
    assert(passed, 'See recorded cases')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
