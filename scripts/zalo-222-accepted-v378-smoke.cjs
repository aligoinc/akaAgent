// Real policy lookup, scheduler helper, result writers and settlement; offline only.
const assert = require('node:assert/strict'), path = require('node:path')
const { harness, step } = require('./action-status-mixed-output-smoke.cjs')
const { loader } = require('./action-status-runtime-smoke.cjs')
const { createFixture } = require('./action-status-fixes-fixture.cjs')
const v = require('./zalo-222-accepted-v378.cjs')
const root = path.resolve(__dirname, '..'), chatRoot = path.resolve(root, '../akaAgentChatApi')
const claim = '11111111-1111-1111-1111-111111111111', unit = '22222222-2222-2222-2222-222222222222'
const before = v.backup().rows.find(r => r.row.id === v.id).row
const mapped = row => Object.fromEntries(Object.entries(row).map(([k, val]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), val]))
async function seed(db, after) {
  const row = { ...before, ...(after ? v.patch : {}) }
  const keys = ['error_name', 'error_desc', 'noti_running_process', 'noti_campaign', 'detail_status', 'counts_toward_limit', 'zalo_action_codes']
  await db.query(`UPDATE auto_error SET ${keys.map((k, i) => k + '=$' + (i + 1)).join(',')} WHERE id=$${keys.length + 1}`,
    [...keys.map(k => row[k]), v.id])
  await db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,3)')
  return row
}
function checkDetail(row, after) {
  assert.equal(row.status, after ? 'thành công' : 'đã gửi lời mời')
  assert.equal(row.report_group, after ? 'success' : 'skipped')
  assert.equal(row.counts_toward_limit, after)
  assert.equal(row.log, after ? v.patch.noti_running_process : before.noti_running_process)
  assert.equal(row.error_code, v.code)
  assert.equal(row.policy_snapshot.operationState, after ? 'committed' : 'not_committed')
  assert.equal(row.policy_snapshot.badTargetEffect, 'ignore')
  assert.equal(row.policy_snapshot.resetErrorStreak, after)
  assert.equal(row.policy_snapshot.inputEffect, 'complete')
}
async function checkSettlement(db, after) {
  assert.equal((await db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state WHERE campaign_id=1')).rows[0].n, 3)
  assert.equal((await db.query('SELECT coalesce(sum(count_action_in_day),0)::int n FROM auto_account_action_status')).rows[0].n, after ? 1 : 0)
  assert.equal((await db.query('SELECT status FROM auto_campaign_input_data WHERE id=1')).rows[0].status, 'hoàn thành')
}
async function desktop(zca, after, target) {
  const f = await harness(zca, 'zalo_message_phone', 'zalo')
  try {
    f.scheduler.runtimeTarget = target; f.account.isZaloServer = target === 'server'
    const row = await seed(f.db, after), policy = mapped(row)
    const policies = new Map([[v.code, policy]])
    const load = loader({ '/actionResultRuntime': { currentActionResultErrors: () => policies },
      '/supabaseClient': { getSupabaseClient: () => { throw Error('Unexpected external request') } },
      '/mappers': { mapAutoErrorPolicyFromDB: mapped } })
    const lookup = load(path.join(root, 'src/main/data/repositories/errorPolicyRepository.ts')).getZaloErrorPolicyByCode
    assert.equal((await lookup('222', 'zalo_add_friend')).errorCode, v.code)
    assert.equal((await lookup('222', 'zalo_message_friend'))?.errorCode ?? null, after ? null : v.code)
    assert.equal(await lookup('225', 'zalo_add_friend'), null)
    f.scheduler.supabase.getZaloErrorPolicyByCode = lookup
    f.scheduler.supabase.getErrorPolicy = async code => policies.get(code) ?? null
    f.scheduler.updateErrorPolicyAccount = async () => { throw Error('Must not update account') }
    f.scheduler.updateErrorPolicyCampaign = async () => { throw Error('Must not stop campaign') }
    await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'zalo', claimToken: claim }, ['zalo_add_friend'])
    f.runtime.beginActionResultUnit(1, unit, [1, 2])
    const detail = await f.scheduler.createZaloErrorDetail(f.account, f.campaign,
      Object.assign(new Error('Tự động kết bạn'), { code: 222 }), 'zalo_add_friend', 'Kết bạn')
    assert.equal(detail.stopAfterTarget, false); assert.equal(detail.resetInputToPending, false)
    assert.equal(detail.data.zalo.code, '222'); assert.equal(detail.data.zalo.message, 'Tự động kết bạn')
    await f.final([step(1, 'zalo_send_friend_request', { detail })]); await f.finish()
    const rows = await f.details(); assert.equal(rows.length, 1); checkDetail(rows[0], after)
    assert.deepEqual(f.logs, [`Kết bạn: ${row.noti_running_process}`])
    await checkSettlement(f.db, after)
    await f.finish(); await checkSettlement(f.db, after)
  } finally { await f.close() }
}
async function chat(after) {
  const db = await createFixture()
  const { Kysely, PGliteDialect } = require(path.join(chatRoot, 'node_modules/kysely'))
  const database = new Kysely({ dialect: new PGliteDialect({ pglite: db }) })
  try {
    const row = await seed(db, after)
    const load = loader()
    const { CampaignActionResults } = load(path.join(chatRoot, 'packages/database/src/campaignActionResults.ts'))
    const runtime = new CampaignActionResults(database)
    const campaign = { campaignId: '1', accountId: '1', staffId: '1' }
    await runtime.begin(campaign, claim, ['zalo_add_friend'])
    await runtime.withUnit(campaign, unit, ['1', '2'], async () => {
      const policy = runtime.errorRows('222', 'zalo_add_friend')[0]
      assert.equal(policy.error_code, v.code)
      assert.equal(runtime.errorRows('222', 'zalo_message_friend').some(p => p.error_code === v.code), !after)
      await runtime.write({ campaign, inputDataId: '1', actionCode: 'zalo_add_friend', actionName: 'Kết bạn',
        status: policy.detail_status, log: policy.noti_running_process, errorCode: policy.error_code,
        countsTowardLimit: policy.counts_toward_limit, data: { rawCode: '222' } })
      const rows = (await db.query('SELECT * FROM auto_campaign_details')).rows
      assert.equal(rows.length, 1); checkDetail(rows[0], after)
      await runtime.input('1', { status: 'hoàn thành' })
      await checkSettlement(db, after)
    })
    runtime.end('1')
  } finally { await database.destroy() }
}
async function main() {
  const zca = await import('zca-js')
  for (const after of [false, true]) {
    for (const target of ['desktop', 'server']) await desktop(zca, after, target)
    await chat(after)
  }
  const receipt = { at: new Date().toISOString(), passed: true, scenarios: 6,
    runtimes: ['desktop', 'packaged-server', 'chat-result-writer'], scoped_lookup: true,
    success_quota_and_input_verified: true, no_bad_target_increment_or_reset: true,
    approved_notice_only: true, no_account_or_campaign_stop: true, external_operations: 0 }
  if (process.argv.includes('--receipt')) v.save('runtime-smoke.json', receipt)
  console.log(JSON.stringify(receipt))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
