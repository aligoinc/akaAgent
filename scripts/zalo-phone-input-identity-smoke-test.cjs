// Run: node scripts/zalo-phone-input-identity-smoke-test.cjs
// Execute the real repository update and scheduler phone helper with local
// adapters. No Zalo request, credentials or customer database writes.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function readSource(relativePath) {
  const path = resolve(__dirname, '..', relativePath)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

const repositorySource = readSource('src/main/data/repositories/campaignRepository.ts')
const updateFunction = repositorySource.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'updateCampaignInputData')
assert.ok(updateFunction)
const schedulerSource = readSource('src/main/services/campaignScheduler.ts')
const schedulerClass = schedulerSource.statements.find(node =>
  ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
const phoneMethod = schedulerClass?.members.find(node =>
  ts.isMethodDeclaration(node) && node.name.getText(schedulerSource) === 'zaloFindPhoneUser')
assert.ok(phoneMethod)

function compile(code, globals, resultName) {
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  return new Function(...Object.keys(globals), `${compiled}; return ${resultName}`)(...Object.values(globals))
}

const normalizeVietnamMobilePhone = compile(readSource('src/shared/phone.ts').text,
  { exports: {} }, 'normalizeVietnamMobilePhone')
const sharedTypes = readSource('src/shared/types.ts')
const requirementNodes = sharedTypes.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(d => ['CAMPAIGN_INPUT_DATA_REQUIREMENTS', 'getCampaignInputDataRequirement'].includes(d.name.getText(sharedTypes))))
const getCampaignInputDataRequirement = compile(requirementNodes.map(node =>
  node.getText(sharedTypes).replace(/^export /, '')).join('\n'), {}, 'getCampaignInputDataRequirement')

function fixture(options = {}) {
  const campaign = {
    id: 10, staffId: 20, actionId: 'zalo_message_phone', dataTargetSourceMode: 'direct',
    ...options.campaign
  }
  const account = { id: 30, isZaloServer: false, ...options.account }
  const row = {
    id: 40, campaign_id: campaign.id, phone: '0900000000', name: 'Original', uid: null,
    canonical_target_key: 'portable:phone:0900000000', email: 'original@example.invalid', input_id: null, is_delete: false,
    ...options.row
  }
  const writes = []
  const db = {
    from(table) {
      assert.equal(table, 'auto_campaign_input_data')
      let patch
      const filters = []
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push([key, value]); return query },
        update: value => { patch = value; return query },
        maybeSingle: async () => ({
          data: options.missing || !filters.every(([key, value]) => row[key] === value) ? null : { ...row },
          error: options.readError ? { message: 'read failed' } : null
        }),
        single: async () => {
          assert.ok(filters.some(([key, value]) => key === 'id' && value === row.id))
          if (options.writeError) return { data: null, error: { message: 'write failed' } }
          writes.push({ ...patch })
          Object.assign(row, patch)
          return { data: { ...row }, error: null }
        }
      }
      return query
    }
  }
  const update = compile(updateFunction.getText(repositorySource).replace(/^export /, ''), {
    normalizeVietnamMobilePhone, getCampaignInputDataRequirement,
    client: () => db,
    requireCurrentUser: () => ({ staffId: 20 }),
    getCampaign: async () => campaign,
    getCampaignActionIdForInputData: async () => campaign.actionId,
    isMobileManagedSmsCampaignAction: () => false,
    normalizeCampaignInputPhoneCarrier: () => { throw new Error('Unexpected SMS normalization') },
    mapCampaignInputDataFromDB: value => value
  }, 'updateCampaignInputData')
  const Harness = compile(`class Harness { ${phoneMethod.getText(schedulerSource)} }`, {
    ZALO_MESSAGE_PHONE_ACTION_ID: 'zalo_message_phone'
  }, 'Harness')
  const scheduler = new Harness()
  const target = { uid: 'resolved-zalo-uid', displayName: 'Resolved Zalo', originalName: 'Zalo' }
  Object.assign(scheduler, {
    supabase: { updateCampaignInputData: update, getZaloErrorPolicyByCode: async () => ({}) },
    zaloRuntime: {
      findUserByPhone: async (accountId, phone) => {
        assert.equal(accountId, account.id)
        assert.equal(phone, '0900000000')
        return { user: options.notFound ? null : target, attempts: [] }
      }
    },
    getCachedZaloMessageOptOutTarget: () => null,
    throwIfZaloRuntimeStopping: () => {},
    normalizeZaloTarget: () => target,
    upsertZaloFoundUserContact: async () => {},
    upsertZaloResolvedProfileTarget: async () => {},
    getZaloTargetLabel: value => value.displayName,
    createZaloSuccessDetail: detail => ({ ...detail, status: 'thành công' }),
    createZaloErrorDetail: async (_account, _campaign, error) => ({ status: 'thất bại', error: error.message }),
    createZaloPolicyDetailFromCode: async () => ({ status: 'không tồn tại' }),
    getZaloNotFoundPolicy: async () => ({}),
    zaloMessageOptOutContexts: new Map(),
    zaloMessageOptOutContextKey: (campaignId, id) => `${campaignId}:${id}`,
    applyAkaBizTagsToZaloTarget: async () => {}
  })
  return {
    row, writes, update,
    find: () => scheduler.zaloFindPhoneUser(account, campaign, {
      phone: '0900000000', inputData: { id: row.id, canonicalTargetKey: row.canonical_target_key }
    })
  }
}

async function main() {
  for (const account of [{ isZaloServer: false }, { isZaloServer: false, isZaloShowWeb: true }, { isZaloServer: true }]) {
    for (const mode of ['direct', 'data_group']) {
      const test = fixture({ account, campaign: { dataTargetSourceMode: mode } })
      const result = await test.find()
      assert.equal(result.ok, true)
      assert.equal(result.zaloTarget.uid, 'resolved-zalo-uid', 'resolved target is available to the send step')
      assert.equal(result.detail.data.target.uid, 'resolved-zalo-uid', 'details retain the resolved identity')
      assert.deepEqual(test.writes, [{ name: 'Resolved Zalo', uid: 'resolved-zalo-uid' }])
      assert.equal(test.row.phone, '0900000000')
      assert.equal(test.row.canonical_target_key, 'portable:phone:0900000000')
      await test.update(40, { name: 'Refreshed', uid: 'refreshed', status: 'hoàn thành', note: 'Done' })
      assert.equal(test.row.uid, 'refreshed')
    }
  }
  console.log('PASS: local QR/Web and Server, direct/group canonical input, repeated identity save and workflow output')

  const ordinary = fixture({ row: { canonical_target_key: null } })
  assert.equal((await ordinary.find()).ok, true)
  await ordinary.update(40, { phone: '0911111111', content: 'Edited' })
  assert.equal(ordinary.row.phone, '0911111111')
  const notFound = fixture({ notFound: true })
  assert.equal((await notFound.find()).zaloTarget, null)
  assert.equal(notFound.writes.length, 0)
  console.log('PASS: ordinary input editing and not-found behavior preserved')

  for (const mode of ['direct', 'data_group']) {
    for (const actionId of ['zalo_message_phone', 'zalo_add_group_member', 'facebook_message_uid',
      'facebook_group_post', 'zalo_message_friend', 'zalo_join_group_link', 'email_send']) {
      const test = fixture({ campaign: { actionId, dataTargetSourceMode: mode } })
      await test.update(40, {
        name: 'Edited', phoneCarrier: 'vinaphone',
        info1: '1', info2: '2', info3: '3', info4: '4', info5: '5',
        content: 'Edited content', schedule: '2026-09-11T08:00:00Z'
      })
      assert.equal(test.row.phone_carrier, 'vinaphone')
      assert.equal(test.row.info5, '5')
      const targetField = ['zalo_message_phone', 'zalo_add_group_member'].includes(actionId)
        ? 'phone' : actionId === 'email_send' ? 'email' : 'uid'
      const information = { phone: '0911111111', uid: 'enriched-uid', email: 'info@example.invalid' }
      delete information[targetField]
      await test.update(40, information)
      if (actionId === 'zalo_add_group_member') {
        await assert.rejects(test.update(40, { uid: 'different-resolved-uid' }), /đối tượng chạy/)
      }
      const original = { ...test.row }
      const count = test.writes.length
      await assert.rejects(test.update(40, { [targetField]: 'another-target', name: 'Must not save' }), /đối tượng chạy/)
      assert.deepEqual(test.row, original)
      assert.equal(test.writes.length, count)
      await test.update(40, { [targetField]: test.row[targetField], name: 'Same target' })
      assert.equal(test.row.canonical_target_key, 'portable:phone:0900000000')
    }
    for (const field of ['campaignId', 'inputId', 'isDelete', 'canonicalTargetKey']) {
      const test = fixture({ campaign: { dataTargetSourceMode: mode } })
      await assert.rejects(test.update(40, { name: 'Must not save', [field]: field === 'isDelete' ? true : 999 }), /liên kết/)
      assert.equal(test.writes.length, 0)
    }
    for (const phone of [null, '', 'invalid']) {
      const test = fixture({ campaign: { actionId: 'zalo_add_group_member', dataTargetSourceMode: mode }, row: { phone, uid: 'original-uid' } })
      await test.update(40, { name: 'Information', info5: 'Five', email: 'info@example.invalid' })
      await assert.rejects(test.update(40, { uid: 'another-uid' }), /đối tượng chạy/)
      await assert.rejects(test.update(40, { phone: '0911111111' }), /đối tượng chạy/)
      const emptyPhone = fixture({ campaign: { dataTargetSourceMode: mode }, row: { phone } })
      await assert.rejects(emptyPhone.update(40, { uid: 'another-uid' }), /đối tượng chạy/)
    }
    for (const account of [{ isZaloServer: false }, { isZaloShowWeb: true }, { isZaloServer: true }]) {
      const test = fixture({ account, campaign: { actionId: 'zalo_add_group_member', dataTargetSourceMode: mode } })
      assert.equal((await test.find()).ok, true)
      assert.equal(test.row.uid, 'resolved-zalo-uid')
      assert.equal(test.row.phone, '0900000000')
    }
  }
  console.log('PASS: both modes, seven action types, metadata enrichment, immutable targets/references and add-group phone lookup on QR/Web/Server')

  for (const [options, message] of [
    [{ campaign: { staffId: 999 } }, /chiến dịch của input/],
    [{ missing: true }, /Không tìm thấy input/],
    [{ row: { is_delete: true } }, /Không tìm thấy input/],
    [{ readError: true }, /read failed/],
    [{ writeError: true }, /write failed/]
  ]) {
    const test = fixture(options)
    await assert.rejects(test.update(40, { name: 'Resolved', uid: 'resolved' }), message)
    assert.equal(test.writes.length, 0)
  }
  console.log('PASS: ownership, deleted/missing input and database failure handling')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
