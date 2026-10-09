// Real result writer, workflow and scheduler; local PostgreSQL WASM/mock browser only.
const assert = require('node:assert/strict')
const { harness, step, result } = require('./action-status-mixed-output-smoke.cjs')
const { environment } = require('./fb-composer-policy-v375-smoke.cjs')
const claim = '11111111-1111-1111-1111-111111111111'
const unit = '22222222-2222-2222-2222-222222222222'
const errorCode = 'err_fb_composer_editor_not_found'
const notice = 'Không tìm thấy ô đăng bài'
const mapped = row => Object.fromEntries(Object.entries(row).map(([k, value]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]))
let checks = 0

async function setup(zca, { actionId = 'facebook_group_post', platform = 'facebook', mode = 'inherit', stop = false } = {}) {
  const f = await harness(zca, actionId, platform)
  await f.db.query(`UPDATE auto_error SET detail_mode=$1,counts_toward_bad_target=true,counts_toward_limit=false,
    count_consecutive_errors=NULL,update_status_campaign=$2,noti_running_process=$3,noti_campaign=$3
    WHERE error_code=$4`, [mode, stop ? 'chờ xử lý' : null, notice, errorCode])
  const policies = new Map((await f.db.query('SELECT * FROM auto_error')).rows.map(row => [row.error_code, mapped(row)]))
  f.scheduler.supabase.getErrorPolicy = async code => policies.get(code) ?? null
  f.scheduler.supabase.getAccount = async () => f.account
  await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform, claimToken: claim },
    ['fb_post_group', 'fb_post_my_profile', 'fb_comment', 'fb_like_post', 'email_send', 'zalo_message_friend'])
  f.runtime.beginActionResultUnit(1, unit, [1, 2])
  return f
}

async function explicitCases(zca) {
  for (const mode of ['inherit', 'suppress']) for (const stop of [false, true]) {
    for (const action of ['fb_post_group', 'email_send', 'zalo_message_friend']) {
      const f = await setup(zca, { mode, stop })
      try {
        const s = step(1, 'custom_result', { actionResult: result(action, 'campaign_detail_error', { inputDataId: 1, errorCode }) })
        await Promise.all([f.realtime(s), f.realtime(structuredClone(s))])
        await f.final([structuredClone(s)]); await f.finish()
        const before = [...f.logs]
        await f.final([structuredClone(s)])
        assert.deepEqual(f.logs, before, 'relay/finalization must not log again')
        const notices = f.logs.filter(log => log.includes(notice) && !log.includes('Dừng chiến dịch'))
        assert.equal(notices.length, 1, `${action}/${mode}/${stop}: one action notice, independent of stop/detail`)
        assert.equal(f.logs.filter(log => log.includes('Dừng chiến dịch')).length, stop ? 1 : 0)
        assert.equal((await f.details()).length, mode === 'suppress' ? 0 : 1)
        assert.equal(await f.quota(), 0)
        checks++
      } finally { await f.close() }
    }
  }

  // No error code is necessary when the status policy reports a failure.
  // Distinct targets keep distinct receipts even when their message is identical.
  const batch = await setup(zca)
  try {
    const output = result('fb_comment', 'campaign_detail_failed', { message: 'Existing failure' })
    const s = step(1, 'custom_result', { actionResults: [{ ...output, inputDataId: 1 }, { ...output, inputDataId: 2 }] })
    await batch.final([s]); await batch.final([structuredClone(s)])
    assert.equal(batch.logs.length, 2)
    assert(batch.logs[0].includes('Fixture group'))
    assert(!batch.logs[1].includes('Fixture group'), 'a sibling cannot borrow the first target name')
    assert(batch.logs.every(log => log.includes('Existing failure')))
    checks++
  } finally { await batch.close() }

  const custom = await setup(zca)
  try {
    await custom.db.exec(`INSERT INTO auto_status(code,name,status_key,component_type,flatform_type,status_value,is_active,is_delete)
      VALUES('fixture_failure','Fixture','fixture_failure','campaign_detail','facebook','fixture failure',true,false);
      INSERT INTO auto_account_action_status_policies(status_id,report_group,counts_toward_limit,bad_target_effect,reset_error_streak,input_effect,description)
      SELECT id,'failure',false,'ignore',false,'complete','Fixture' FROM auto_status WHERE code='fixture_failure'`)
    await custom.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'facebook', claimToken: claim }, ['fb_comment'])
    custom.runtime.beginActionResultUnit(1, unit, [1, 2])
    await custom.final([step(1, 'custom_result', { actionResult: result('fb_comment', 'fixture_failure', { message: 'Existing custom notice' }) })])
    assert.equal(custom.logs.length, 1)
    assert(custom.logs[0].includes('Existing custom notice'))
    checks++
  } finally { await custom.close() }

  for (const block of ['fb_newsfeed_like_post', 'fb_newsfeed_comment_submit']) {
    const f = await setup(zca, { actionId: 'facebook_newsfeed_interaction' })
    try {
      const s = step(1, block, { liked: true, commented: true, targetName: 'Fixture',
        actionResult: result(block.includes('like') ? 'fb_like_post' : 'fb_comment', 'campaign_detail_error', { errorCode }) })
      await f.realtime(s); await f.final([structuredClone(s)])
      assert.equal(f.logs.length, 1)
      assert(f.logs[0].includes(notice), 'policy result owns failure progress even with legacy success flags')
      checks++
    } finally { await f.close() }
  }
}

async function schedulerLoop(zca) {
  const f = await setup(zca)
  try {
    const inputs = [{ id: 1, name: 'Nhóm loại mua và bán', status: 'chờ xử lý' },
      { id: 2, name: 'Nhóm tiếp theo', status: 'chờ xử lý' }]
    const visited = [], counters = []
    await f.db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,0)')
    f.scheduler.supabase.listCampaignInputData = async () => inputs
    f.scheduler.supabase.updateCampaignInputData = (id, patch) => f.runtime.settleManagedActionInput(id, patch)
    f.scheduler.supabase.incrementCampaignBadTargetCount = async (campaignId, id, reason) => ({
      countConsecutiveBadTargets: await f.runtime.settleManagedBadTarget(campaignId, id, reason)
    })
    for (const name of ['stopCampaignAtRunBoundaryIfNeeded', 'finalizeDataGroupCampaignAtHardEnd',
      'shouldMaterializeZaloFriendInputData', 'shouldMaterializeZaloBirthdayInputData',
      'shouldMaterializeZaloFriendRecommendationInputData', 'shouldMaterializeZaloCancelSentFriendRequestInputData',
      'shouldUseSuggestedFriends', 'shouldUseZaloShareMessageBatch', 'shouldUseFacebookGroupInviteBatch',
      'shouldSkipMessageByLimit', 'shouldSkipAddFriendByLimit', 'isRunUnitStartCancelled']) f.scheduler[name] = () => false
    for (const name of ['releaseRunningAccount', 'handleCampaignCompletion', 'cleanupCampaignMediaTempFiles',
      'logSkippedLimitActionsOnce', 'markCampaignRunUnitStarted', 'resetCampaignBadTargetCount']) f.scheduler[name] = async () => {}
    Object.assign(f.scheduler, {
      running: true, loadZaloFriendBlocklistContext: async () => null,
      getServerZaloBoundaryReason: async () => ({ paused: false }), getAccountRunBlockReason: async () => null,
      resolveGroupPostApprovalForTarget: async () => ({}), getAdvancedContentConfigError: () => null,
      checkActionDisabled: async () => null,
      checkActionLimitsForContinuation: async () => ({ runnableActionDescriptors: [], skippedLimitStatuses: [] }),
      getAutomationPage: async () => ({ page: {}, source: 'foreground' }),
      resolveGroupPostShareQuotaCapacity: async () => 0, buildGroupPostShareTargets: async () => [],
      resolveCampaignContentRotation: () => ({ index: 0, count: 1 }),
      buildVariablesV2: async (_c, input) => ({ inputDataId: input.id }), createBlockRuntimeHelpers: () => ({}),
      getEffectiveSleepBetweenActions: () => 30,
      sleepBetweenTargets: async () => ({ status: 'completed' }),
      beginCampaignRunUnit: async (_a, _c, ids) => {
        await f.db.query('UPDATE auto_campaigns SET runtime_unit_input_data_ids=$1 WHERE id=1', [ids])
        f.runtime.beginActionResultUnit(1, unit, ids)
        return true
      },
      settleActiveCampaignRunUnit: async () => {
        await f.runtime.finishActionResultUnit(1)
        counters.push((await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n)
        return true
      },
      engineV2: { run: async (_w, vars, _p, context) => {
        visited.push(vars.inputDataId)
        if (vars.inputDataId === 1) {
          const env = environment(1, { stage: 'button' })
          return env.run({ observe: context.onStepProgress })
        }
        return { status: 'completed', steps: [step(2, 'second_target', {
          actionResult: result('fb_post_group', 'campaign_detail_success', { inputDataId: 2 })
        })] }
      } }
    })
    await f.scheduler.executeCampaignV2(f.account, f.campaign, 1, [], [])
    assert.deepEqual(visited, [1, 2], 'non-stopping policy continues through the actual scheduler loop')
    assert.deepEqual(counters, [1, 0])
    const errors = f.logs.filter(log => log.includes(notice))
    assert.deepEqual(errors, [`❌ Lỗi "Nhóm loại mua và bán": ${notice}`])
    const complete = '✅ Hoàn thành "Nhóm loại mua và bán"'
    assert(f.logs.includes(complete), 'data completion is retained even when its action failed')
    assert(f.logs.indexOf(errors[0]) < f.logs.indexOf(complete), 'action error precedes data completion')
    assert(f.logs.includes('⏳ Nghỉ 30s trước khi xử lý mục tiếp theo...'))
    assert(f.logs.includes('✅ Hoàn thành "Nhóm tiếp theo"'))
    assert(!f.logs.some(log => log.includes('Dừng chiến dịch') || log.includes('waitForSelector timeout:')))
    assert.deepEqual((await f.details()).map(row => row.status), ['lỗi', 'thành công'])
    assert.equal(await f.quota(), 1)
    checks++
  } finally { await f.close() }
}

async function main() {
  const zca = await import('zca-js')
  await explicitCases(zca)
  await schedulerLoop(zca)
  console.log(JSON.stringify({ checks, actual_scheduler_loop: true, completion_log_preserved: true, external_operations: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
