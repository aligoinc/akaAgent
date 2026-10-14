// Synthetic opt-in provider checks. Candidate uses the existing schedule binding's transport only;
// after apply, the real limits service loads its own DB prompt/binding without overrides.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), snapshotDir = path.join(root, 'migrations/snapshots/campaign-limits-ai-v402')
const sql = fs.readFileSync(path.join(root, 'migrations/migration_v402_campaign_action_limits_ai.sql'), 'utf8')
const prompt = sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)[1]
const action = (actionCode, label, unit) => ({ actionCode, label, unit, dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: 65 })
const exact = patch => result => assert.deepEqual(result, { ok: true, patch: { actions: [], ...patch } })
const fail = code => result => { assert.equal(result.ok, false); assert.equal(result.code, code); assert(result.message.length > 65) }
const cases = [
  { name: 'daily-hour-rest', description: 'Mỗi ngày gửi tối đa năm mươi tin, mỗi giờ mười tin, nghỉ nửa phút giữa hai lần gửi.', live: true,
    check: result => { assert(result.ok); assert.equal(result.patch.sleepBetweenActions ?? 30, 30, 'an already matching pause may be left unchanged');
      assert.deepEqual(result.patch.actions, [{ actionCode: 'zalo_message_friend', dailyLimit: 50, rateLimitCount: 10, rateLimitMinutes: 60 }]) } },
  { name: 'partial-day-preserves-window', description: 'Chỉ tăng giới hạn ngày lên 80, các mục khác giữ nguyên.', live: true,
    check: exact({ actions: [{ actionCode: 'zalo_message_friend', dailyLimit: 80 }] }) },
  { name: 'relative-rest', description: 'Nghỉ lâu gấp đôi hiện tại giữa hai lần gửi.', check: exact({ sleepBetweenActions: 60 }) },
  { name: 'window-duration', description: 'Trong hai tiếng chỉ gửi tối đa 15 tin.', check: exact({ actions: [{ actionCode: 'zalo_message_friend', rateLimitCount: 15, rateLimitMinutes: 120 }] }) },
  { name: 'two-actions', description: 'Nhắn tin thì mỗi ngày 60 tin, kết bạn thì 20 lời mời mỗi ngày. Mỗi nửa giờ chỉ kết bạn 5 người.', actionId: 'zalo_message_phone',
    actions: [action('zalo_message_stranger', 'Nhắn tin người lạ', 'tin nhắn'), action('zalo_add_friend', 'Kết bạn', 'lời mời')],
    check: result => { assert(result.ok); assert.deepEqual([...result.patch.actions].sort((a,b)=>a.actionCode.localeCompare(b.actionCode)), [
      { actionCode: 'zalo_add_friend', dailyLimit: 20, rateLimitCount: 5, rateLimitMinutes: 30 }, { actionCode: 'zalo_message_stranger', dailyLimit: 60 }]) } },
  { name: 'continue-other-actions', description: 'Nếu một hành động chạm giới hạn thì vẫn tiếp tục các hành động còn lại.', live: true,
    check: exact({ continueWhenActionLimitReached: true }) },
  { name: 'posts-per-target', description: 'Mỗi nhóm chỉ comment 5 bài, còn hạn mức comment trong ngày giữ nguyên.', actionId: 'facebook_comment_seeding',
    actions: [action('fb_comment', 'Comment', 'comment')], check: exact({ postsPerTarget: 5 }) },
  { name: 'all-actions', description: 'Đặt mọi hành động trong danh sách thành 40 lượt mỗi ngày.', actionId: 'zalo_message_phone',
    actions: [action('zalo_message_stranger', 'Nhắn tin người lạ', 'tin nhắn'), action('zalo_add_friend', 'Kết bạn', 'lời mời')],
    check: result => { assert(result.ok); assert.equal(result.patch.actions.length, 2); assert(result.patch.actions.every(item => item.dailyLimit === 40 && item.rateLimitMinutes === undefined)) } },
  { name: 'sleep-hidden', description: 'Nghỉ 30 giây giữa các bài đăng.', actionId: 'facebook_timeline_post',
    actions: [action('fb_post_my_profile', 'Đăng bài trang cá nhân', 'bài đăng')], check: fail('unsupported') },
  { name: 'missing-action', description: 'Đặt giới hạn kết bạn là 20 lời mời một ngày.', check: fail('unsupported') },
  { name: 'random-pause', description: 'Nghỉ ngẫu nhiên từ 30 đến 60 giây giữa hai lần gửi.', check: fail('unsupported') },
  { name: 'unlimited-is-not-zero', description: 'Bỏ hẳn mọi hạn mức số tin trong ngày và trong giờ, gửi không giới hạn.', check: fail('unsupported') },
  { name: 'explicit-zero-is-control-value', description: 'Chỉ điền số 0 vào giới hạn trong ngày, không thay mục nào khác.',
    check: exact({ actions: [{ actionCode: 'zalo_message_friend', dailyLimit: 0 }] }) },
  { name: 'clarify-action', description: 'Đặt một trong hai loại nhắn tin thành 40 tin mỗi ngày, tôi chưa chọn loại nào.', live: true,
    actions: [action('zalo_message_friend', 'Nhắn tin bạn bè', 'tin nhắn'), action('zalo_message_stranger', 'Nhắn tin người lạ', 'tin nhắn')], check: fail('unclear') }
]
async function main() {
  if (process.argv.includes('--verify-recorded')) {
    const file = path.join(snapshotDir, 'candidate-live.json'), saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(saved.migration_sha256, crypto.createHash('sha256').update(sql).digest('hex'))
    assert.deepEqual(saved.results.map(row => row.name), cases.map(row => row.name))
    for (const row of saved.results) { cases.find(fixture => fixture.name === row.name).check(row.result); row.passed = true; delete row.failure }
    saved.passed = true; saved.revalidatedAt = new Date().toISOString()
    fs.writeFileSync(file, JSON.stringify(saved, null, 2) + '\n')
    console.log('PASS recorded provider responses against effect-based assertions, including an already matching pause')
    return
  }
  assert(process.argv.includes('--live'), 'Pass --live for billable provider calls')
  const mode = process.argv.includes('--applied') ? 'applied' : 'candidate', results = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limits-ai-live-'))
  try {
    const entry = path.join(dir, 'entry.ts'), output = path.join(dir, 'entry.cjs')
    fs.writeFileSync(entry, `export { callAiUsing } from ${JSON.stringify(path.join(root, 'src/main/services/aiRuntimeService.ts'))};
      export { generateCampaignLimits } from ${JSON.stringify(path.join(root, 'src/main/services/campaignLimitsAiService.ts'))};
      export { setCurrentUser } from ${JSON.stringify(path.join(root, 'src/main/data/currentUser.ts'))};
      export * from ${JSON.stringify(path.join(root, 'src/shared/campaignLimitsAi.ts'))};`)
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
    const s = require(output); s.setCurrentUser({ staffId: 0, organizationId: null })
    for (const fixture of cases.filter(item => mode === 'candidate' || item.live)) {
      const request = { requestId: crypto.randomUUID(), description: fixture.description,
        context: { actionId: fixture.actionId || 'zalo_message_friend', dataTargetSourceMode: 'direct', accountGroupOverrides: false },
        limits: { sleepBetweenActions: 30, continueWhenActionLimitReached: false, postsPerTarget: 3,
          actions: fixture.actions || [action('zalo_message_friend', 'Nhắn tin bạn bè', 'tin nhắn')] } }
      let result, logId
      if (mode === 'applied') result = await s.generateCampaignLimits(request, AbortSignal.timeout(120000))
      else {
        const ai = await s.callAiUsing('app_campaign_schedule', {
          systemPromptOverride: prompt,
          promptOverride: JSON.stringify({ description: request.description, currentLimits: request.limits,
            ...request.context, capabilities: s.getLimitsAiCapabilities(request.context) }),
          bodyOverrides: { store: false, text: { format: { type: 'json_schema', name: 'campaign_action_limits', strict: true, schema: s.LIMITS_AI_SCHEMA } } }
        }, { organizationId: null }, { signal: AbortSignal.timeout(120000), expectedModel: 'gpt-6.1-sol' })
        assert(ai.ok, 'Provider failed'); assert.equal(ai.renderedSystemPrompt, prompt)
        assert.equal(JSON.parse(ai.renderedUserPrompt).description, request.description, 'candidate must receive the full input')
        result = s.parseLimitsAiResponse(ai.content, request); logId = ai.logId
      }
      const row = { name: fixture.name, description: fixture.description, result, logId }; results.push(row)
      try { fixture.check(result); row.passed = true; console.log('PASS', mode, fixture.name) }
      catch (error) { row.passed = false; row.failure = error.message; console.log('FAIL', fixture.name, JSON.stringify(result)) }
    }
    const passed = results.every(item => item.passed)
    fs.writeFileSync(path.join(snapshotDir, `${mode}-live.json`), JSON.stringify({ at: new Date().toISOString(), passed, model: 'gpt-6.1-sol',
      migration_sha256: crypto.createHash('sha256').update(sql).digest('hex'), results }, null, 2) + '\n', { flag: 'wx' })
    assert(passed, 'See recorded cases')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
