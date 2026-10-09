// Real helpers, result writer, settlement and SMS routing; local SQL/mock transports only.
const assert = require('node:assert/strict')
const path = require('node:path')
const { harness, step, result } = require('./action-status-mixed-output-smoke.cjs')
const { WorkflowEngineV2, js, edge } = require('./action-status-origin-tracking-smoke.cjs')
const claim = '11111111-1111-1111-1111-111111111111', unit = '22222222-2222-2222-2222-222222222222'
let checks = 0
const plain = value => JSON.parse(JSON.stringify(value))
async function begin(f, platform, actions) {
  await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform, claimToken: claim }, actions)
  f.runtime.beginActionResultUnit(1, unit, [1, 2])
}
function envelope(sent, status, state = 'not_committed') {
  return { ...sent, actionResult: result(sent.detail.actionCode, status,
    { inputDataId: 1, operationState: state, errorCode: sent.detail.errorCode }) }
}
async function legacyModes(zca) {
  for (const mode of [null, 'inherit', 'suppress']) for (const unknown of [false, true]) {
    let before
    for (const format of ['legacy', 'dual']) {
      const f = await harness(zca, 'zalo_message_friend', 'zalo')
      try {
        await f.db.query(`UPDATE auto_error SET is_active=true,is_delete=false,detail_mode=$1,detail_status=NULL,
          input_effect=NULL,counts_toward_limit=false,counts_toward_bad_target=false WHERE error_code='err_undefined'`, [mode])
        await begin(f, 'zalo', ['zalo_message_friend'])
        const policy = { errorCode: 'err_undefined', errorName: 'Fixture', detailStatus: null,
          countsTowardLimit: false, countsTowardBadTarget: false, disableActionCodes: [], notiCampaign: 'Existing policy text' }
        f.scheduler.supabase.getZaloErrorPolicyByCode = async () => policy
        f.scheduler.supabase.getErrorPolicy = async () => policy
        Object.assign(f.scheduler, { isZaloBrowserlessCampaign: () => true, pushZaloDetailToExternalSmsIfNeeded: async () => {} })
        const sent = { detail: await f.scheduler.createZaloErrorDetail(f.account, f.campaign,
          { code: unknown ? 'command_result_unknown' : '500', message: 'existing failure' }, 'zalo_message_friend', 'Existing action') }
        assert.equal(sent.detail.createDetail, false)
        const s = step(1, 'zalo_send_message', format === 'legacy' ? sent : envelope(sent, 'campaign_detail_error', unknown ? 'unknown' : 'not_committed'))
        const summary = await f.final([s])
        const effects = plain(f.runtime.managedTargetEffects(1, 1).results)
        await f.finish()
        const rows = await f.details()
        const input = (await f.db.query('SELECT status FROM auto_campaign_input_data WHERE id=1')).rows[0].status
        assert.equal(rows.length, mode === 'inherit' ? 1 : 0)
        assert.equal(input, unknown ? mode === 'inherit' ? 'hoàn thành' : 'tạm dừng' : 'chờ xử lý')
        assert.equal(await f.quota(), 0)
        const observed = { effects, input, logs: [...f.logs], stop: summary.stopAfterTarget || false, noRetry: summary.preventInputRetry || false }
        if (format === 'legacy') before = observed
        else {
          assert.deepEqual(observed, before, `${mode}/${unknown}: legacy NULL semantics and explicit modes stay aligned`)
          const logs = [...f.logs], writes = f.writes.length
          const relay = structuredClone(s); delete relay.output.detail
          await f.final([relay])
          assert.deepEqual(f.logs, logs); assert.equal(f.writes.length, writes)
        }
        checks++
      } finally { await f.close() }
    }
  }
}

async function emailQuota(zca) {
  for (const scenario of ['missing-recipient', 'sent', 'smtp-failed']) {
    let before
    for (const format of ['legacy', 'dual']) {
      const f = await harness(zca, 'email_send', 'email')
      try {
        let sends = 0
        f.scheduler.emailRuntime = { checkRecipientExists: async () => ({ status: 'unknown' }), sendEmail: async () => {
          sends++; if (scenario === 'smtp-failed') throw new Error('existing SMTP failure')
          return { messageId: 'fixture' }
        } }
        Object.assign(f.scheduler, { getTemplateBusinessNow: async () => new Date(), renderZaloTemplate: x => x,
          rewriteEmailPlainTextBodyForRun: async (_a, _c, _o, x) => x })
        const sent = await f.scheduler.emailSendMessage(f.account, f.campaign,
          { to: scenario === 'missing-recipient' ? '' : 'recipient@fixture.invalid', subject: 'Subject', body: 'Body' })
        const s = step(1, 'email_send_message', format === 'legacy' ? sent : envelope(sent,
          scenario === 'sent' ? 'campaign_detail_success' : 'campaign_detail_failed', scenario === 'sent' ? 'committed' : 'not_committed'))
        await f.final([s]); await f.finish()
        const rows = await f.details()
        assert.equal(rows.length, 1)
        assert.equal(sends, scenario === 'missing-recipient' ? 0 : 1)
        assert.equal(await f.quota(), scenario === 'missing-recipient' ? 0 : 1)
        assert.equal(rows[0].policy_snapshot.resetErrorStreak, scenario !== 'missing-recipient')
        const observed = { decisions: rows[0].policy_snapshot, logs: [...f.logs], quota: await f.quota() }
        if (format === 'legacy') before = observed
        else {
          assert.deepEqual(observed, before)
          await f.final([structuredClone(s)])
          assert.deepEqual(f.logs, before.logs); assert.equal(f.writes.length, 1)
        }
        checks++
      } finally { await f.close() }
    }
  }
}

async function smsRouting(zca) {
  for (const mode of ['internal', 'external']) for (const format of ['legacy', 'dual', 'new-only', 'batch', 'batch-missing-phone']) {
    const sms = [], action = 'zalo_message_stranger'
    const f = await harness(zca, 'zalo_message_phone', 'zalo', {
      './akaBizApiClient': { addSmsCampaignDetail: async data => { sms.push(plain(data)) } },
      '../../shared/phone': { normalizeVietnamMobilePhone: value => /^0\d{9}$/.test(String(value)) ? String(value) : '' }
    })
    try {
      await begin(f, 'zalo', [action])
      f.input.phone = '0900000001'
      f.campaign.extraSettings = { internalSmsEnabled: mode === 'internal', internalSmsAccountIds: [9],
        internalSmsStatuses: ['thành công'], externalSmsEnabled: true, externalSmsShopIds: [8], externalSmsStatuses: ['thành công'] }
      Object.assign(f.scheduler, { isZaloBrowserlessCampaign: () => true,
        getDatabaseBusinessNow: async () => new Date('2026-10-09T00:00:00Z'), getTemplateBusinessNow: async () => new Date(),
        getInternalSmsContentForZaloDetail: () => 'Existing SMS template', getExternalSmsContentForZaloDetail: () => 'Existing SMS template',
        ensureInternalSmsChildCampaign: async () => ({ id: 9 }), loadAkaBizIntegrationsForCampaign: async () => ({ sms: { staffId: 1 } }),
        prepareZaloOutgoingContent: async () => ({ content: 'Content', media: [] }) })
      f.scheduler.supabase.createSmsCampaignInputDataSnapshot = async data => { sms.push(plain(data)) }
      f.scheduler.supabase.reopenCompletedCampaignAfterInputInsert = async () => null
      let sends = 0
      f.scheduler.zaloRuntime.sendMessageToUser = async () => { sends++; return { message: { msgId: 'fixture' } } }
      const send = () => f.scheduler.zaloSendPhoneMessage(f.account, f.campaign,
        { enabled: true, target: { uid: 'first', phone: f.input.phone, displayName: 'Fixture' }, inputData: { id: 1 } })
      let steps
      if (format === 'legacy') steps = [step(1, 'zalo_send_message', await send())]
      else {
        const secondTarget = JSON.stringify({ uid: 'second', displayName: 'Second',
          ...(format === 'batch' ? { phone: '0900000002' } : {}) })
        const code = `const sent=await helpers.send(); const row={actionCode:"${action}",actionName:sent.detail.actionName,statusCode:"campaign_detail_success",operationState:"committed",inputDataId:1,message:sent.detail.log,data:sent.detail.data}; return `
          + (format === 'dual' ? '{...sent,actionResult:row}' : format === 'new-only' ? '{actionResult:row}'
            : '{actionResults:[row,{...row,inputDataId:2,data:{target:' + secondTarget + '}}]}')
        const nodes = [js('send', code, 'zalo_send_message'), js('relay', 'return JSON.parse(JSON.stringify(input))')]
        const executed = await new WorkflowEngineV2().run({ id: 8, nodes, edges: [edge('send', 'relay')] }, {}, null,
          { persist: false, runtimeHelpers: { send } })
        assert.equal(executed.status, 'completed')
        steps = executed.steps
      }
      await f.final(steps); await f.finish()
      const expected = format === 'batch' ? 2 : 1
      const detailsExpected = format.startsWith('batch') ? 2 : 1
      assert.equal(sends, 1)
      assert.equal(sms.length, expected, `${mode}/${format}: execute the real SMS routing once per recipient; ${JSON.stringify(f.logs)}`)
      assert.deepEqual(sms.map(row => row.phone), expected === 1 ? ['0900000001'] : ['0900000001', '0900000002'])
      assert(sms.every(row => row.content === 'Existing SMS template'))
      assert.equal(f.logs.filter(log => log.startsWith('Nhắn tin người lạ:')).length, detailsExpected)
      assert.equal(f.logs.filter(log => log.startsWith('✅ Đã kiêm gửi SMS')).length, expected)
      assert.equal((await f.details()).length, detailsExpected)
      if (format === 'batch-missing-phone') assert(f.logs.some(log => log.includes('thiếu SĐT')), 'never borrow the primary recipient phone for a different batch result')
      if (format !== 'legacy') {
        const logs = [...f.logs]
        await f.final(structuredClone(steps))
        assert.equal(sms.length, expected); assert.deepEqual(f.logs, logs); assert.equal(f.writes.length, detailsExpected)
      }
      checks++
    } finally { await f.close() }
  }
}

async function smsFailure(zca) {
  for (const format of ['legacy', 'dual']) {
    const f = await harness(zca, 'zalo_message_friend', 'zalo')
    try {
      let attempts = 0
      const warnings = []
      Object.assign(f.scheduler, { isZaloBrowserlessCampaign: () => true,
        pushZaloDetailToExternalSmsIfNeeded: async () => { attempts++; throw new Error('SMS unavailable') },
        logExternalPushWarning: async (_c, message) => { warnings.push(message) } })
      const sent = { detail: f.scheduler.createZaloSuccessDetail({ actionCode: 'zalo_message_friend', actionName: 'Existing action', log: 'Existing send log' }) }
      const s = step(1, 'zalo_send_message', format === 'legacy' ? sent : envelope(sent, 'campaign_detail_success', 'committed'))
      const original = console.error; console.error = () => {}
      try { await f.final([s]); if (format === 'dual') await f.final([structuredClone(s)]) }
      finally { console.error = original }
      assert.equal(attempts, 1); assert.deepEqual(warnings, ['Không thể xử lý kiêm gửi SMS'])
      assert.equal((await f.details()).length, 1); assert.equal(await f.quota(), 1)
      checks++
    } finally { await f.close() }
  }
}

async function main() {
  const zca = await import(path.resolve(__dirname, '../node_modules/zca-js/dist/index.js'))
  await legacyModes(zca); await emailQuota(zca); await smsRouting(zca); await smsFailure(zca)
  console.log(JSON.stringify({ checks, external_operations: 0 }))
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
