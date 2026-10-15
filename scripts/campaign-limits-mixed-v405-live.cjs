// Synthetic provider checks; uses existing AI runtime/logging, no customer campaigns.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'migrations/snapshots/campaign-limits-mixed-v405')
const sql = fs.readFileSync(path.join(root, 'migrations/migration_v405_campaign_limits_mixed_windows.sql'), 'utf8')
const prompt = sql.match(/SET prompt_system='([\s\S]*?)'\nWHERE id=52/)[1].replace(/''/g, "'")
const action = { actionCode: 'zalo_message_friend', label: 'Nhắn tin bạn bè', unit: 'tin nhắn', dailyLimit: 100, rateLimitCount: 15 }
const cases = [
  { name: 'mixed-keep', description: 'Giữ nguyên các khung giờ đang có, chỉ đổi mỗi ngày thành 80 tin.', expected: { dailyLimit: 80 } },
  { name: 'mixed-count-only', description: 'Mỗi khung hiện tại chỉ gửi 12 tin, giữ nguyên độ dài khung của từng tài khoản.', expected: { rateLimitCount: 12 } },
  { name: 'mixed-common', description: 'Đổi tất cả về khung 45 phút, số tin giữ nguyên.', expected: { rateLimitMinutes: 45 } },
  { name: 'mixed-relative-distinct', description: 'Tăng gấp đôi độ dài khung hiện tại của từng tài khoản.', error: 'unsupported' },
  { name: 'mixed-relative-common', description: 'Tất cả dùng khung bằng hai lần khung ngắn nhất hiện tại, số lượt giữ nguyên.', expected: { rateLimitMinutes: 60 } },
  { name: 'legacy-repeat', legacy: true, description: 'Mỗi ngày 100 tin, mỗi giờ 15 tin.', expected: { dailyLimit: 100, rateLimitCount: 15, rateLimitMinutes: 60 } }
]
async function main() {
  assert(process.argv.includes('--live'), 'Pass --live for billable provider verification')
  const applied = process.argv.includes('--applied'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'limits-v405-'))
  const results = []
  try {
    const entry = path.join(temp, 'entry.ts'), output = path.join(temp, 'entry.cjs')
    fs.writeFileSync(entry, `export { callAiUsing } from ${JSON.stringify(path.join(root, 'src/main/services/aiRuntimeService.ts'))};
      export * from ${JSON.stringify(path.join(root, 'src/shared/campaignLimitsAi.ts'))};`)
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
    const s = require(output)
    for (const f of cases.filter(f => !applied || ['mixed-common', 'legacy-repeat'].includes(f.name))) {
      const current = { ...action, ...(f.legacy ? { rateLimitMinutes: 60 } : s.limitsAiWindowSnapshot(65, [30, 60], false)) }
      const request = s.validateLimitsAiRequest({ requestId: crypto.randomUUID(), description: f.description,
        context: { actionId: 'zalo_message_friend', dataTargetSourceMode: 'direct', accountGroupOverrides: false },
        limits: { sleepBetweenActions: 30, continueWhenActionLimitReached: false, postsPerTarget: 1, actions: [current] } })
      const input = JSON.stringify({ description: request.description, currentLimits: request.limits,
        ...request.context, capabilities: s.getLimitsAiCapabilities(request.context) })
      const ai = await s.callAiUsing(s.CAMPAIGN_LIMITS_AI_CODE, {
        ...(applied ? { limitsContext: input } : { systemPromptOverride: prompt, promptOverride: input }),
        bodyOverrides: { store: false, text: { format: { type: 'json_schema', name: 'campaign_action_limits', strict: true, schema: s.LIMITS_AI_SCHEMA } } }
      }, { organizationId: null }, { signal: AbortSignal.timeout(120000), expectedModel: 'gpt-6.1-sol' })
      assert(ai.ok, 'Provider call failed'); assert.equal(ai.renderedSystemPrompt, prompt)
      const result = s.parseLimitsAiResponse(ai.content, request), row = { name: f.name, result, logId: ai.logId }
      results.push(row)
      try {
        if (f.error) assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: f.error })
        else {
          assert.equal(result.ok, true)
          const { actions, ...scalars } = result.patch
          assert.deepEqual(scalars, {})
          assert(actions.length <= 1)
          if (actions[0]) assert.equal(actions[0].actionCode, action.actionCode)
          assert.deepEqual({ ...current, ...actions[0] }, { ...current, ...f.expected })
        }
        row.passed = true; console.log('PASS', f.name)
      } catch (error) { row.passed = false; row.failure = error.message; console.log('FAIL', f.name, JSON.stringify(result)) }
    }
    const passed = results.every(row => row.passed)
    fs.writeFileSync(path.join(dir, applied ? 'applied-live.json' : 'candidate-live.json'), JSON.stringify({
      at: new Date().toISOString(), passed, migration_sha256: crypto.createHash('sha256').update(sql).digest('hex'), results
    }, null, 2) + '\n', { flag: 'wx' })
    assert(passed, 'See recorded provider cases')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
