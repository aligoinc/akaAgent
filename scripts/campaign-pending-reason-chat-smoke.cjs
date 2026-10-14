const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function load(file, imports = {}) {
  const mod = { exports: {} }
  const source = ts.transpileModule(readFileSync(resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', source)(id => {
    if (id in imports) return imports[id]
    throw new Error(`Unexpected dependency ${id}`)
  }, mod, mod.exports)
  return mod.exports
}

const now = '2026-10-12T03:00:00Z', day = '2026-10-12'
const message = 'zalo_message_stranger', friend = 'zalo_add_friend', lookup = 'zalo_find_phone_user'
let user, tables, campaign, queries, legacyCalls, workflowFlags, failCounts
function reset() {
  user = { staffId: 9, organizationId: 1, isChatSync: true, entitlements: { zalo: true, dailySendLimits: {} } }
  campaign = { id: 1, accountId: 2, actionId: 'zalo_message_phone', status: 'chờ xử lý', note: null,
    schedule: '2026-10-12T02:00:00Z', scheduleType: 'daily', updatedAt: now,
    extraSettings: { enableMessage: true, enableAddFriend: true, actionLimits: { continueWhenActionLimitReached: true } } }
  tables = {
    auto_accounts: [{ id: 2, organization_id: 1, staff_id: 9, flatform_type: 'zalo', is_zalo_server: true,
      is_zalo_show_web: false, status: 'chờ xử lý', login_status: 'đã đăng nhập', is_active: true, is_delete: false,
      auto_account_groups: null }],
    auto_campaign_actions: [{ id: campaign.actionId, flatform_type: 'zalo', is_active: true, is_delete: false,
      workflow_id: null, test_workflow_id: null, limit_check_action_codes: [lookup, message, friend] }],
    auto_account_action_status: [], auto_campaign_details: [], auto_workflows: []
  }
  queries = []; legacyCalls = 0; workflowFlags = []; failCounts = false
}
const auth = { requireCurrentUser: () => user, getCurrentUser: () => user,
  requireCurrentUserCredentials: () => ({ username: 'fixture', password: 'fixture' }) }
const client = { from(table) {
  assert.ok(table in tables, `Unexpected table ${table}`)
  const filters = [], trace = { table, filters, projection: '', options: {} }
  let single = false, signal
  const query = {
    select(projection, options = {}) { trace.projection = projection; trace.options = options; return query },
    eq(key, value) { filters.push(['eq', key, value]); return query },
    in(key, value) { filters.push(['in', key, value]); return query },
    gte(key, value) { filters.push(['gte', key, value]); return query },
    or(value) { filters.push(['or', value]); return query },
    limit(value) { trace.limit = value; return query },
    abortSignal(value) { signal = value; return query },
    maybeSingle() { single = true; return query },
    then(onResolve, onReject) {
      return Promise.resolve().then(() => {
        signal?.throwIfAborted(); queries.push(trace)
        if (table === 'auto_campaign_details' && failCounts) return { data: null, count: null, error: new Error('Fixture count failure') }
        const rows = tables[table].filter(row => filters.every(([op, key, value]) => {
          if (op === 'eq') return row[key] === value
          if (op === 'in') return value.includes(row[key])
          if (op === 'gte') return row[key] >= value
          if (op === 'or') {
            assert.equal(key, 'organization_id.is.null,organization_id.eq.1')
            return row.organization_id == null || row.organization_id === 1
          }
          throw new Error(`Unexpected filter ${op}`)
        }))
        return { data: trace.options.head ? null : single ? rows[0] || null : rows.slice(0, trace.limit),
          count: trace.options.count === 'exact' ? rows.length : null, error: null }
      }).then(onResolve, onReject)
    }
  }
  return query // No RPC/write methods: any mutation fails this smoke immediately.
} }
const supabase = { getSupabaseClient: () => client }
const entitlements = load('src/main/data/repositories/entitlementRepository.ts', {
  '../../../shared/authProductCatalog': load('src/shared/authProductCatalog.ts'),
  '../../../shared/vietnamTime': load('src/shared/vietnamTime.ts'), '../currentUser': auth, '../supabaseClient': supabase
})
const readers = load('src/main/data/repositories/campaignPendingReasonRepository.ts', {
  '../currentUser': auth, '../supabaseClient': supabase,
  '../mappers': load('src/main/data/mappers.ts', { './currentUser': auth })
})
const chatLimits = load('src/main/data/repositories/campaignPendingChatLimitRepository.ts', {
  '../../../shared/accountActionLimits': load('src/shared/accountActionLimits.ts'),
  '../../domain/campaigns/campaignActionDescriptors': load('src/main/domain/campaigns/campaignActionDescriptors.ts'),
  '../supabaseClient': supabase, './entitlementRepository': entitlements
})
const service = load('src/main/services/campaignPendingReasonService.ts', {
  '../../shared/facebookRandomRunDiagnostics': load('src/shared/facebookRandomRunDiagnostics.ts', { './facebookRandomRun': load('src/shared/facebookRandomRun.ts') }),
  '../../shared/campaignPendingReason': load('src/shared/campaignPendingReason.ts'), '../data/currentUser': auth,
  '../data/repositories/runtimeClockRepository': { getDatabaseRuntimeClock: async () => ({ dbNow: now }) },
  '../data/repositories/entitlementRepository': { canUseCampaignActionWithEntitlements: () => true,
    canUseAccountWithEntitlementsAndCapabilities: () => true, getUserZaloAccountCapabilities: () => ({}) },
  '../data/repositories/staffManagementRepository': { readStaffAccess: async () => ({ isActive: true, timeAllowed: true }) },
  '../data/repositories/browserRunLimitsRepository': { getBrowserRunLimits: async () => ({ zaloWebMax: null }) },
  '../data/repositories/campaignPendingReasonRepository': { ...readers,
    readPendingReasonCampaign: async () => ({ campaign, hasClaim: false }), readBusyCampaign: async () => null,
    readPendingInputAvailability: async () => ({ state: 'due' }) },
  '../data/repositories/campaignPendingChatLimitRepository': chatLimits
})
const runtime = { busyReason: () => null, readinessReason: () => null,
  configurationReason: (_, __, requiresWorkflow) => { workflowFlags.push(requiresWorkflow); return null },
  limitReason: async () => { legacyCalls++; return 'Legacy scheduler reason' } }
const inspect = async () => (await service.inspectPendingCampaign(1, runtime, new AbortController().signal)).message
const clear = value => assert.match(value, /Chưa xác minh được trạng thái thực thi/)
const status = (code, count, extra = {}) => tables.auto_account_action_status.push({ account_id: 2, action_code: code,
  count_date: day, count_action_in_day: count, is_disable: false, ...extra })
const detail = (code, flag, extra = {}) => tables.auto_campaign_details.push({ id: tables.auto_campaign_details.length + 1,
  account_id: 2, action_code: code, counts_toward_limit: flag, created_at: '2026-10-12T02:59:00Z', ...extra })

async function verifySchedulerAdapter() {
  // Execute the actual diagnostic adapter without loading/starting the real scheduler.
  const source = ts.createSourceFile('campaignScheduler.ts', readFileSync(resolve(__dirname,
    '../src/main/services/campaignScheduler.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
  const methods = declaration.members.filter(node => ['inspectPendingReason', 'getDiagnosticRuntime'].includes(node.name?.getText(source)))
  const javascript = ts.transpileModule(`class Adapter { ${methods.map(method => method.getText(source)).join("\n")} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const Adapter = new Function('inspectPendingCampaign', 'getCurrentUser', 'accountOperationRegistry',
    `${javascript}; return Adapter`)(service.inspectPendingCampaign, () => user, { peek: () => null })
  const adapter = new Adapter()
  let workflowResolutions = 0, contentChecks = 0
  Object.assign(adapter, { hasFailedAccountRun: () => false, activeAccountRuns: new Set(), externalAccountRuns: new Set(),
    resolveCampaignWorkflow: action => { workflowResolutions++; return { workflowId: action.workflowId, missingNote: 'Workflow missing' } },
    isFormattedContentCampaign: () => false, getAdvancedContentConfigError: () => { contentChecks++; return null },
    getCampaignPreclaimLimitStatus: async () => ({ reason: 'Legacy scheduler reason' }), buildLimitPreflightNote: status => status.reason })
  reset(); clear((await adapter.inspectPendingReason(1, new AbortController().signal)).message)
  assert.equal(workflowResolutions, 0); assert.equal(contentChecks, 1)
  user.isChatSync = false
  assert.equal((await adapter.inspectPendingReason(1, new AbortController().signal)).message, 'Workflow missing')
  assert.equal(workflowResolutions, 1)
  tables.auto_campaign_actions[0].workflow_id = 7; tables.auto_workflows = [{ id: 7 }]
  assert.equal((await adapter.inspectPendingReason(1, new AbortController().signal)).message, 'Legacy scheduler reason')
  console.log('PASS actual scheduler diagnostic adapter skips only akaChat workflow, retains content validation and legacy limit reader')
}

async function main() {
  for (const action of ['zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
    'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation']) {
    for (const blocked of [message, friend]) {
      for (const source of ['catalog', 'enabled']) {
        reset(); campaign.actionId = action; tables.auto_campaign_actions[0].id = action
        if (source === 'catalog') tables.auto_campaign_actions[0].limit_check_action_codes = [blocked]
        else campaign.extraSettings.actionLimits.enabledActionCodes = [blocked]
        status(blocked, 30); clear(await inspect())
        assert.equal(legacyCalls, 0)
        assert.ok(!queries.some(q => q.table === 'auto_workflows'))
        assert.deepEqual(workflowFlags, [false])
        campaign.extraSettings.actionLimits.continueWhenActionLimitReached = false
        assert.match(await inspect(), /Đạt giới hạn ngày/)
      }
    }
  }
  reset(); status(message, 30); status(friend, 30); assert.match(await inspect(), /Nhắn tin người lạ/)
  reset(); status(message, 30); campaign.extraSettings.enableAddFriend = false; assert.match(await inspect(), /Đạt giới hạn ngày/)
  reset(); status(lookup, 1000); assert.match(await inspect(), /Tìm SĐT/)
  reset(); status(friend, 0, { is_disable: true, disabled_reason: 'Friend disabled' })
  campaign.extraSettings.actionLimits.enabledActionCodes = [message]
  assert.equal(await inspect(), 'Friend disabled', 'unmetered disabled actions still block')
  console.log('PASS optional continuation in both directions across five akaChat actions; all-blocked/lookup/disabled guards')

  for (const group of [null, { is_active: false, is_delete: false, organization_id: 1 },
    { is_active: true, is_delete: true, organization_id: 1 }, { is_active: true, is_delete: false, organization_id: 99 },
    { is_active: true, is_delete: false, organization_id: null }]) {
    reset(); campaign.extraSettings.enableAddFriend = false; status(message, 1)
    tables.auto_accounts[0].auto_account_groups = group && { ...group, settings: { byActionCode: { [message]: { dailyLimit: 1 } } } }
    clear(await inspect())
    assert.ok(queries.find(q => q.table === 'auto_accounts').projection.includes('organization_id,is_active,is_delete,settings'))
  }
  reset(); campaign.extraSettings.enableAddFriend = false; status(message, 1)
  tables.auto_accounts[0].auto_account_groups = { is_active: true, is_delete: false, organization_id: 1,
    settings: { byActionCode: { [message]: { dailyLimit: 1 } } } }
  assert.match(await inspect(), /\(1\/1\)/)
  reset(); campaign.extraSettings.enableAddFriend = false; status(message, 3)
  user.entitlements.dailySendLimits.zalo = 3; assert.match(await inspect(), /\(3\/3\)/)
  console.log('PASS group tenant/active/deleted rules and package cap through real account/entitlement mappers')

  for (const patch of [{ is_active: false }, { is_delete: true }, { flatform_type: 'facebook' }]) {
    reset(); Object.assign(tables.auto_campaign_actions[0], patch)
    assert.match(await inspect(), /chưa có cấu hình chạy hợp lệ/)
    assert.ok(!queries.some(q => q.table === 'auto_account_action_status'))
  }
  reset(); user.useTestWorkflow = true; clear(await inspect()); assert.deepEqual(workflowFlags, [false])
  for (const patch of [{ isChatSync: false }, { isChatSync: undefined }]) {
    reset(); Object.assign(user, patch); assert.match(await inspect(), /chưa có cấu hình chạy hợp lệ/)
    tables.auto_campaign_actions[0].workflow_id = 7; tables.auto_workflows = [{ id: 7 }]
    assert.equal(await inspect(), 'Legacy scheduler reason'); assert.equal(legacyCalls, 1)
    assert.deepEqual(workflowFlags, [true, true])
  }
  for (const patch of [{ is_zalo_server: false }, { is_zalo_show_web: true }, { organization_id: null }]) {
    reset(); Object.assign(tables.auto_accounts[0], patch)
    const state = await readers.readPendingReasonAccount(2, new AbortController().signal)
    assert.equal(state.isChatManaged, false)
  }
  reset(); tables.auto_accounts[0].staff_id = 10
  assert.equal(await readers.readPendingReasonAccount(2, new AbortController().signal), null)
  console.log('PASS active catalog without workflow on akaChat; Desktop/legacy workflow and quota path preserved')

  reset(); campaign.extraSettings.enableAddFriend = false
  for (let i = 0; i < 9; i++) { detail(message, null); detail(message, false); detail(message, true, { account_id: 99 }) }
  clear(await inspect())
  assert.ok(queries.filter(q => q.table === 'auto_campaign_details').every(q =>
    q.options.head === true && q.filters.some(([op, key, value]) => op === 'eq' && key === 'counts_toward_limit' && value === true)))
  for (let i = 0; i < 9; i++) detail(message, true)
  assert.match(await inspect(), /9\/9 lần \/ 65 phút/)
  reset(); status(message, 100, { count_date: '2026-10-11' }); clear(await inspect())
  reset(); status(message, 100, { count_date: '2026-10-13' }); await assert.rejects(inspect(), /Invalid counter date/)
  reset(); failCounts = true; await assert.rejects(inspect(), /Fixture count failure/)
  reset(); await assert.rejects(service.inspectPendingCampaign(1, runtime, AbortSignal.abort()))
  console.log('PASS explicit-true window counts, day rollover, corrupt dates, failed counts, cancellation; read-only queries only')
  await verifySchedulerAdapter()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
