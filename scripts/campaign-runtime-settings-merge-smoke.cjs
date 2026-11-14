// Smoke test: bộ chạy ghi từng khoá extra_settings của nó qua RPC V530 `aka_agent_desktop_merge_campaign_runtime_settings`
// (akaAgentWebApp docs/FACEBOOK_EMAIL_AUTHORING_IMPLEMENTATION.md mục 3 dòng 10, mục 8.2). Không DB thật: PostgREST/RPC giả.
// - mergeCampaignRuntimeSettings (repository thật, esbuild): RPC thành công chỉ gửi khoá đổi; DB chưa có RPC / không có quyền
//   (PGRST202, 404, 42883, 42501) thì ghi cả khối như trước và nhớ trong tiến trình; lỗi tạm thời thì ném như lượt ghi cũ;
// - bảo trì lịch (maintainCampaignSchedules thật) xoá dấu "đã lấy data" bằng p_remove, không có RPC thì một lượt ghi như cũ;
// - các chỗ ghi trong CampaignScheduler (chạy thật từng hàm, bản trong RAM giữ như trước, sửa từ Web giữa lượt không bị đè);
// - kiểm tĩnh: mọi chỗ ghi khoá do bộ chạy sở hữu đều qua helper, không còn chỗ nào ghi extraSettings cả khối khác.
// Run: node scripts/campaign-runtime-settings-merge-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const clone = value => structuredClone(value)
const RPC = 'aka_agent_desktop_merge_campaign_runtime_settings'
// Hợp đồng mục 3.2: khoá do bộ chạy sở hữu.
const RUNTIME_OWNED_KEYS = new Set([
  'sourceLinkIndex', 'contentRotationIndex', 'postBumpRotationIndex', 'postBumpCreatedCampaignIdsByAccount',
  'internalSmsCreatedCampaignIdsByAccount', 'zaloFriendDataMaterializedAt', 'zaloFriendMaterializedCount',
  'zaloBirthdayDataMaterializedDate', 'zaloBirthdayMaterializedCount', 'zaloFriendRecommendationDataMaterializedAt',
  'zaloFriendRecommendationMaterializedCount', 'zaloCancelFriendRequestDataMaterializedAt', 'zaloCancelFriendRequestMaterializedCount'
])
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

let passed = 0
const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

// ── PostgREST + RPC giả ────────────────────────────────────────────────────────────────────────────────────
function makeDb(mode = 'ok') {
  const db = { mode, campaigns: new Map(), rpcCalls: [], queries: [], seq: 0 }
  const nextUpdatedAt = () => new Date(Date.UTC(2026, 10, 14, 1, 0, ++db.seq)).toISOString()
  const filterValue = (q, op, column) => q.filters.find(filter => filter[0] === op && filter[1] === column)?.[2]

  function rpcResponse(name, params) {
    assert.equal(name, RPC)
    const current = typeof db.mode === 'function' ? db.mode(params) : db.mode
    const failure = (code, message, status) => ({ data: null, error: { code, message, details: null, hint: null }, status })
    if (current === 'missing') return failure('PGRST202', `Could not find the function public.${RPC}(p_campaign_id, p_remove, p_set) in the schema cache`, 404)
    if (current === 'http-404') return failure('', 'Not Found', 404)
    if (current === 'undefined-function') return failure('42883', `function public.${RPC}(bigint, jsonb, text[]) does not exist`, 404)
    if (current === 'denied') return failure('42501', `permission denied for function ${RPC}`, 403)
    if (current === 'timeout') return failure('57014', 'canceling statement due to statement timeout', 500)
    if (current === 'network') return failure('', 'TypeError: fetch failed', 0)
    if (current === 'unexpected') return { data: { ok: true }, error: null, status: 200 }
    const row = db.campaigns.get(params.p_campaign_id)
    if (current === 'not-updated' || !row) return { data: { updated: false, updatedAt: null }, error: null, status: 200 }
    const extra = { ...(row.extra_settings || {}) }
    for (const key of params.p_remove) delete extra[key]
    row.extra_settings = { ...extra, ...clone(params.p_set) }
    row.updated_at = nextUpdatedAt()
    return { data: { updated: true, updatedAt: row.updated_at }, error: null, status: 200 }
  }

  function respond(q) {
    db.queries.push(q)
    if (q.table === 'auto_campaigns' && q.op === 'select' && String(q.columns).startsWith('*, auto_campaign_actions')) {
      const after = Number(filterValue(q, 'gt', 'id') || 0)
      return { data: [...db.campaigns.values()].filter(row => row.id > after).map(clone), error: null }
    }
    if (q.table === 'auto_campaigns' && q.op === 'select' && q.columns === 'action_id') {
      const row = db.campaigns.get(filterValue(q, 'eq', 'id'))
      return { data: row ? { action_id: row.action_id } : null, error: null }
    }
    if (q.table === 'auto_campaign_input_data' && q.op === 'select') return { data: [], error: null }
    if (q.table === 'auto_campaigns' && q.op === 'update') {
      const row = db.campaigns.get(filterValue(q, 'eq', 'id'))
      if (!row) return { data: null, error: null }
      Object.assign(row, clone(q.payload))
      return { data: clone(row), error: null }
    }
    throw new Error(`Unexpected query ${q.table} ${q.op} ${q.columns}`)
  }

  function builder(table) {
    const q = { table, op: 'select', columns: '*', filters: [], payload: null, single: false }
    const self = {}
    for (const op of ['eq', 'neq', 'not', 'lt', 'lte', 'gt', 'gte', 'in', 'is', 'or', 'order', 'limit', 'range', 'abortSignal']) {
      self[op] = (...args) => { q.filters.push([op, ...args]); return self }
    }
    self.select = columns => { if (q.op === 'select') q.columns = columns; else q.returning = columns; return self }
    self.update = payload => { q.op = 'update'; q.payload = clone(payload); return self }
    self.maybeSingle = () => { q.single = true; return self }
    self.single = () => { q.single = true; return self }
    self.then = (onFulfilled, onRejected) => Promise.resolve().then(() => respond(q)).then(onFulfilled, onRejected)
    return self
  }

  db.client = {
    rpc(name, params) {
      db.rpcCalls.push({ name, params: clone(params) })
      return Promise.resolve().then(() => rpcResponse(name, params))
    },
    from: table => builder(table)
  }
  return db
}

// ── Repository thật (esbuild), mỗi lần nạp là một tiến trình mới (cờ "không có RPC" trong RAM) ─────────────────
async function bundleRepository(outDir) {
  const outfile = path.join(outDir, 'campaign-runtime-settings-merge.cjs')
  await build({
    stdin: {
      contents: `
        export { mergeCampaignRuntimeSettings, maintainCampaignSchedules } from './src/main/data/repositories/campaignRepository';
        export { setCurrentUser } from './src/main/data/currentUser';
      `,
      resolveDir: root
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['better-sqlite3'], logLevel: 'warning',
    plugins: [{ name: 'fakes', setup(plugin) {
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fake-electron' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fake-electron' }, () => ({ contents: `
        export const app = { getPath: () => { throw new Error('no userData in this smoke') }, isPackaged: false, getVersion: () => '0.0.0' };
        export const ipcMain = { handle() {} }; export const BrowserWindow = { getAllWindows: () => [] };
        export default { app, ipcMain, BrowserWindow };` }))
      plugin.onResolve({ filter: /\/supabaseClient$/ }, () => ({ path: 'db', namespace: 'fake-db' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fake-db' }, () => ({ contents: `
        export const getSupabaseClient = () => globalThis.__fakeDb.client;
        export const getSupabaseUrl = () => 'https://mock.invalid';
        export const desktopSession = { matches: () => true, clear() {} };
        export const isTrustedServerSupabaseConfigured = () => true;` }))
    } }]
  })
  return () => {
    delete require.cache[require.resolve(outfile)]
    const repo = require(outfile)
    repo.setCurrentUser({ staffId: 7, organizationId: 9, isAdminAkabiz: false,
      entitlements: { zalo: true, sms: true, email: true, facebookCore: true, facebookFanpage: true } })
    return repo
  }
}

async function captureWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    return { result: await run(), warnings }
  } finally {
    console.warn = original
  }
}

async function repositoryCases(freshRepository) {
  const fallbackCampaign = { id: 1, extraSettings: { whole: true } }
  const fallbackCalls = []
  const wholeObjectWrite = async () => { fallbackCalls.push(1); return clone(fallbackCampaign) }
  const row = extra => ({ id: 1, action_id: 'facebook_group_post', extra_settings: extra, updated_at: '2026-11-14T00:00:00.000Z' })

  // RPC có: chỉ gửi khoá đổi, không ghi cả khối, trả updatedAt.
  globalThis.__fakeDb = makeDb('ok')
  globalThis.__fakeDb.campaigns.set(1, row({ content: 'Web edit', postBumpRotationIndex: 0, stale: 'x' }))
  let repo = freshRepository()
  const merged = await repo.mergeCampaignRuntimeSettings(1, { postBumpRotationIndex: 2 }, [], wholeObjectWrite)
  assert.equal(merged.via, 'rpc')
  assert.match(merged.updatedAt, ISO)
  assert.deepEqual(globalThis.__fakeDb.rpcCalls, [{ name: RPC, params: { p_campaign_id: 1, p_set: { postBumpRotationIndex: 2 }, p_remove: [] } }])
  assert.deepEqual(globalThis.__fakeDb.campaigns.get(1).extra_settings, { content: 'Web edit', postBumpRotationIndex: 2, stale: 'x' })
  assert.equal(fallbackCalls.length, 0)
  assert.equal(globalThis.__fakeDb.queries.length, 0, 'one request: no action-id read, no table write')
  // undefined bị JSON bỏ ở lượt ghi cả khối cũ (mất khoá) → gửi thành p_remove; khoá vừa đặt vừa xoá thì đặt thắng.
  await repo.mergeCampaignRuntimeSettings(1, { contentRotationIndex: undefined, sourceLinkIndex: 1 }, ['stale', 'sourceLinkIndex'], wholeObjectWrite)
  assert.deepEqual(globalThis.__fakeDb.rpcCalls[1].params, { p_campaign_id: 1, p_set: { sourceLinkIndex: 1 }, p_remove: ['stale', 'contentRotationIndex'] })
  ok('RPC available: sends only the runtime keys (one request), keeps every other key, undefined becomes a removal')

  // Không đăng nhập: lỗi như updateCampaign, không gọi RPC.
  globalThis.__fakeDb = makeDb('ok')
  repo = freshRepository()
  repo.setCurrentUser(null)
  await assert.rejects(repo.mergeCampaignRuntimeSettings(1, { sourceLinkIndex: 1 }, [], wholeObjectWrite), /Chưa đăng nhập/)
  assert.equal(globalThis.__fakeDb.rpcCalls.length, 0)
  ok('no logged-in user: throws like updateCampaign before any request')

  // DB chưa có RPC / không có quyền: ghi cả khối, nhớ trong tiến trình, lần sau không gọi RPC nữa.
  for (const mode of ['missing', 'http-404', 'undefined-function', 'denied']) {
    globalThis.__fakeDb = makeDb(mode)
    repo = freshRepository()
    fallbackCalls.length = 0
    const first = await captureWarnings(() => repo.mergeCampaignRuntimeSettings(1, { sourceLinkIndex: 1 }, [], wholeObjectWrite))
    assert.deepEqual(first.result, { via: 'fallback', campaign: fallbackCampaign })
    assert.equal(first.warnings.length, 1, `${mode}: one warning when switching to whole-object writes`)
    const second = await captureWarnings(() => repo.mergeCampaignRuntimeSettings(1, { contentRotationIndex: 2 }, [], wholeObjectWrite))
    assert.equal(second.result.via, 'fallback')
    assert.deepEqual(second.warnings, [], `${mode}: no repeated warning`)
    assert.equal(globalThis.__fakeDb.rpcCalls.length, 1, `${mode}: the missing/denied RPC is not retried in this process`)
    assert.equal(fallbackCalls.length, 2)
  }
  ok('RPC missing (PGRST202/404/42883) or not permitted (42501, App Server): whole-object write, remembered per process')

  // Trả về lạ: ghi cả khối, nhớ. `updated: false`: ghi cả khối cho lần đó (lượt ghi cũ tự báo lỗi), lần sau vẫn thử RPC.
  globalThis.__fakeDb = makeDb('unexpected')
  repo = freshRepository()
  fallbackCalls.length = 0
  await captureWarnings(async () => {
    assert.equal((await repo.mergeCampaignRuntimeSettings(1, { sourceLinkIndex: 1 }, [], wholeObjectWrite)).via, 'fallback')
    assert.equal((await repo.mergeCampaignRuntimeSettings(1, { sourceLinkIndex: 1 }, [], wholeObjectWrite)).via, 'fallback')
  })
  assert.equal(globalThis.__fakeDb.rpcCalls.length, 1)
  globalThis.__fakeDb = makeDb('not-updated')
  repo = freshRepository()
  fallbackCalls.length = 0
  await captureWarnings(async () => {
    assert.equal((await repo.mergeCampaignRuntimeSettings(404, { sourceLinkIndex: 1 }, [], wholeObjectWrite)).via, 'fallback')
    assert.equal((await repo.mergeCampaignRuntimeSettings(404, { sourceLinkIndex: 1 }, [], wholeObjectWrite)).via, 'fallback')
  })
  assert.equal(globalThis.__fakeDb.rpcCalls.length, 2, 'updated:false is not remembered')
  assert.equal(fallbackCalls.length, 2)
  ok('unexpected response: whole-object write (remembered); updated:false: whole-object write for that call only')

  // Lỗi tạm thời: ném như lượt ghi cũ ("Failed to update campaign: ..."), không ghi cả khối, lần sau vẫn thử RPC.
  for (const mode of ['timeout', 'network']) {
    globalThis.__fakeDb = makeDb(mode)
    repo = freshRepository()
    fallbackCalls.length = 0
    await assert.rejects(repo.mergeCampaignRuntimeSettings(1, { sourceLinkIndex: 1 }, [], wholeObjectWrite), /^Error: Failed to update campaign: /)
    globalThis.__fakeDb.mode = 'ok'
    globalThis.__fakeDb.campaigns.set(1, row({}))
    assert.equal((await repo.mergeCampaignRuntimeSettings(1, { sourceLinkIndex: 1 }, [], wholeObjectWrite)).via, 'rpc')
    assert.equal(fallbackCalls.length, 0)
  }
  ok('transient errors (timeout, network) throw like the old write and do not switch to whole-object writes')
}

// ── Bảo trì lịch (maintainCampaignSchedules thật) ────────────────────────────────────────────────────────────
const MAINTENANCE_KEYS = {
  zalo_message_friend_recommendation: ['zaloFriendRecommendationDataMaterializedAt', 'zaloFriendRecommendationMaterializedCount'],
  zalo_cancel_sent_friend_request: ['zaloCancelFriendRequestDataMaterializedAt', 'zaloCancelFriendRequestMaterializedCount'],
  zalo_message_birthday: ['zaloBirthdayDataMaterializedDate', 'zaloBirthdayMaterializedCount']
}

function staleRow(id, actionId) {
  const keys = MAINTENANCE_KEYS[actionId]
  return {
    id, name: `Zalo ${id}`, action_id: actionId, account_id: 50 + id, secondary_account_id: null, status: 'hoàn thành',
    schedule: '2026-11-10T02:00:00.000Z', original_schedule: '2026-11-10T02:00:00.000Z', schedule_type: 'weekly',
    schedule_week_days: '2,3,4,5,6,7,8', schedule_days: null, schedule_end_date: null, daily_stop_time: null,
    continue_next_day: false, refresh_data: false, content: 'Xin chào', images: [], note: 'Đã xong lượt trước',
    extra_settings: { zaloFriendRecommendationCount: 10, webEditedKey: 'Web', [keys[0]]: '2026-11-10', [keys[1]]: 4 },
    is_delete: false, staff_id: 7, organization_id: 9, updated_at: '2026-11-10T03:00:00.000Z', data_target_source_mode: 'direct',
    data_group_id: null, provisioning_state: 'ready', auto_campaign_actions: { name: actionId },
    primary_account: { name: 'Zalo', flatform_type: 'zalo', is_delete: false, is_zalo_show_web: false, is_zalo_server: false, staff_id: 7 }
  }
}

async function maintenanceCases(freshRepository) {
  const actions = Object.keys(MAINTENANCE_KEYS)
  for (const mode of ['ok', 'missing']) {
    globalThis.__fakeDb = makeDb(mode)
    actions.forEach((actionId, index) => globalThis.__fakeDb.campaigns.set(index + 1, staleRow(index + 1, actionId)))
    const before = new Map([...globalThis.__fakeDb.campaigns].map(([id, row]) => [id, clone(row)]))
    const repo = freshRepository()
    const { result: updated } = await captureWarnings(() => repo.maintainCampaignSchedules('2026-11-14'))
    assert.deepEqual(updated.map(campaign => campaign.id), [1, 2, 3])
    const updates = globalThis.__fakeDb.queries.filter(q => q.table === 'auto_campaigns' && q.op === 'update')
    assert.equal(updates.length, 3, 'one column write per campaign in both modes')
    actions.forEach((actionId, index) => {
      const id = index + 1
      const keys = MAINTENANCE_KEYS[actionId]
      const payload = updates.find(q => q.filters.some(filter => filter[0] === 'eq' && filter[1] === 'id' && filter[2] === id)).payload
      assert.equal(payload.status, 'chờ xử lý')
      assert.equal(payload.schedule, '2026-11-14T02:00:00.000Z')
      assert.equal(payload.note, null)
      const expectedExtra = { ...before.get(id).extra_settings }
      for (const key of keys) delete expectedExtra[key]
      if (mode === 'ok') {
        assert.equal('extra_settings' in payload, false, `${actionId}: the column write no longer carries extra_settings`)
        const call = globalThis.__fakeDb.rpcCalls.find(item => item.params.p_campaign_id === id)
        assert.deepEqual(call.params, { p_campaign_id: id, p_set: {}, p_remove: keys })
        const rpcIndex = globalThis.__fakeDb.rpcCalls.indexOf(call)
        assert.ok(rpcIndex >= 0)
      } else {
        assert.deepEqual(payload.extra_settings, expectedExtra, `${actionId}: whole-object write exactly as before`)
      }
      assert.deepEqual(globalThis.__fakeDb.campaigns.get(id).extra_settings, expectedExtra, `${actionId}: markers removed, other keys kept`)
    })
    assert.equal(globalThis.__fakeDb.rpcCalls.length, mode === 'ok' ? 3 : 1)
  }
  // Thứ tự: xoá dấu trước rồi mới ghi cột (lỗi ở giữa: chiến dịch vẫn trễ lịch, lượt bảo trì sau làm lại).
  globalThis.__fakeDb = makeDb('ok')
  globalThis.__fakeDb.campaigns.set(1, staleRow(1, 'zalo_message_friend_recommendation'))
  const order = []
  const rpc = globalThis.__fakeDb.client.rpc
  globalThis.__fakeDb.client.rpc = (...args) => { order.push('rpc'); return rpc(...args) }
  const from = globalThis.__fakeDb.client.from
  globalThis.__fakeDb.client.from = table => {
    const query = from(table)
    const update = query.update
    query.update = payload => { order.push('update'); return update(payload) }
    return query
  }
  await freshRepository().maintainCampaignSchedules('2026-11-14')
  assert.deepEqual(order, ['rpc', 'update'])
  ok('schedule maintenance removes the materialized markers via p_remove before the column write; without the RPC it is the old single write')
}

// ── CampaignScheduler: chạy thật từng hàm có chỗ ghi ──────────────────────────────────────────────────────────
const schedulerFile = 'src/main/services/campaignScheduler.ts'
const schedulerSource = ts.createSourceFile(schedulerFile, read(schedulerFile), ts.ScriptTarget.Latest, true)
const schedulerClass = schedulerSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')

function schedulerHarness() {
  const names = [
    'persistCampaignRuntimeSettings', 'markZaloFriendRecommendationMaterialized', 'markZaloCancelSentFriendRequestMaterialized',
    'materializeZaloBirthdayInputData', 'isZaloBirthdayToday', 'materializeZaloFriendInputData', 'normalizeZaloFriendProfile',
    'getZaloFriendSourceTagIds', 'getZaloFriendSourceTagLogLabel', 'ensureInternalSmsChildCampaign', 'getInternalSmsCreatedCampaignIdMap',
    'isUsableInternalSmsChildCampaign', 'enqueuePostBumpAfterGroupPost', 'resolvePostBumpTargets', 'resolveCreatedPostBumpTargets',
    'normalizePostBumpCount', 'normalizePostBumpMinutes', 'normalizePostBumpRotationIndex', 'advanceCampaignContentRotation'
  ]
  const body = names.map(name => {
    const node = schedulerClass.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(schedulerSource) === name)
    assert.ok(node, name)
    return node.getText(schedulerSource)
  }).join('\n')
  const globals = { IPC_EVENTS: { CAMPAIGN_STATUS_UPDATED: 'campaign:status-updated' } }
  for (const statement of schedulerSource.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer
      if (!ts.isIdentifier(declaration.name) || !init) continue
      if (ts.isStringLiteral(init)) globals[declaration.name.text] = init.text
      if (ts.isNumericLiteral(init)) globals[declaration.name.text] = Number(init.text)
    }
  }
  const code = ts.transpileModule(`class Harness { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(globals), `${code}; return Harness`)(...Object.values(globals))
}

const mapRow = row => ({
  id: row.id, name: row.name, actionId: row.action_id, accountId: row.account_id, status: row.status,
  isDelete: Boolean(row.is_delete), extraSettings: clone(row.extra_settings || {}), updatedAt: row.updated_at
})

function makeScheduler(Harness, repo, db, events) {
  const scheduler = new Harness()
  Object.assign(scheduler, {
    mainWindow: { webContents: { send: (channel, payload) => events.broadcasts.push({ channel, payload: clone(payload) }) } },
    supabase: {
      mergeCampaignRuntimeSettings: (...args) => repo.mergeCampaignRuntimeSettings(...args),
      getCampaign: async id => (db.campaigns.has(id) ? mapRow(db.campaigns.get(id)) : null),
      getAccount: async id => events.accounts.get(id) ?? null,
      createCampaign: async input => {
        const id = 100 + events.created.length
        db.campaigns.set(id, { id, name: input.name, action_id: input.actionId, account_id: input.accountId, status: input.status,
          extra_settings: clone(input.extraSettings || {}), is_delete: false, updated_at: '2026-11-14T00:00:00.000Z' })
        events.created.push(id)
        return mapRow(db.campaigns.get(id))
      },
      createCampaignInputData: async input => { events.inputs.push(input); return input },
      listCampaignInputData: async () => []
    },
    // Lượt ghi cả khối cũ: thay toàn bộ extra_settings bằng bản gửi lên.
    updateCampaignAndBroadcast: async (id, updates) => {
      events.wholeWrites.push({ id, updates: clone(updates) })
      const row = db.campaigns.get(id)
      if (updates.extraSettings !== undefined) row.extra_settings = clone(updates.extraSettings)
      row.updated_at = '2026-11-14T09:00:00.000Z'
      return mapRow(row)
    },
    logCampaignProgress: async () => {}, throwIfZaloRuntimeStopping: () => {}, paceZaloCampaignRead: async () => true,
    runZaloCampaignReadWith429Retry: async (_account, _campaign, _label, readValue) => ({ status: 'completed', value: await readValue() }),
    normalizeUidForCompare: uid => String(uid || '').trim(),
    firstNonEmptyString: (...values) => values.map(value => String(value ?? '').trim()).find(Boolean) || '',
    upsertZaloApiUserContacts: async () => {}, mapZaloApiRawUserContact: (accountId, raw) => ({ accountId, raw }),
    createMaterializedCampaignInputDataBatch: async rows => { events.inputs.push(...rows) },
    getVietnamDateKey: () => '2026-11-14', getVietnamBirthdayKey: () => '14/11',
    getZaloFriendTargetMode: campaign => campaign.extraSettings?.zaloFriendTargetMode || 'selected',
    cleanPostLinkForStorage: link => link, getDatabaseBusinessNow: async () => new Date('2026-11-14T03:00:00.000Z'),
    refreshPostBumpTargetCampaignSchedule: async () => {},
    createPostBumpTargetCampaign: async (_source, accountId) => scheduler.supabase.createCampaign({
      name: `Up tin ${accountId}`, actionId: 'facebook_comment_seeding_post', accountId, status: 'chờ xử lý', extraSettings: {}
    }),
    zaloRuntime: {
      listLabels: async () => [{ id: 7, name: 'Khách VIP', conversations: [] }],
      getAllFriendsPage: async (_accountId, _size, page) => page === 1
        ? [{ userId: 'u1', displayName: 'An', sdob: '14/11/1990' }, { userId: 'u2', displayName: 'Bình', sdob: '01/01/1991' }]
        : []
    }
  })
  return scheduler
}

const account = { id: 5, name: 'Tài khoản', flatformType: 'zalo' }
const baseExtra = { content: 'Nội dung', webEditedKey: 'in memory' }
// Mỗi ca: dòng DB, hàm gọi, khoá ghi, và bản trong RAM sau khi gọi (y như trước).
const SCHEDULER_CASES = [
  {
    method: 'markZaloFriendRecommendationMaterialized', actionId: 'zalo_message_friend_recommendation',
    keys: ['zaloFriendRecommendationDataMaterializedAt', 'zaloFriendRecommendationMaterializedCount'],
    run: (scheduler, campaign) => scheduler.markZaloFriendRecommendationMaterialized(campaign, 5),
    values: { zaloFriendRecommendationMaterializedCount: 5 }, memory: 'before-write'
  },
  {
    method: 'markZaloCancelSentFriendRequestMaterialized', actionId: 'zalo_cancel_sent_friend_request',
    keys: ['zaloCancelFriendRequestDataMaterializedAt', 'zaloCancelFriendRequestMaterializedCount'],
    run: (scheduler, campaign) => scheduler.markZaloCancelSentFriendRequestMaterialized(campaign, 3),
    values: { zaloCancelFriendRequestMaterializedCount: 3 }, memory: 'before-write'
  },
  {
    method: 'materializeZaloBirthdayInputData', actionId: 'zalo_message_birthday',
    keys: ['zaloBirthdayDataMaterializedDate', 'zaloBirthdayMaterializedCount'],
    run: (scheduler, campaign) => scheduler.materializeZaloBirthdayInputData(account, campaign, new Date('2026-11-14T03:00:00.000Z')),
    values: { zaloBirthdayDataMaterializedDate: '2026-11-14', zaloBirthdayMaterializedCount: 1 }, memory: 'before-write'
  },
  {
    method: 'materializeZaloFriendInputData', actionId: 'zalo_message_friend', label: 'all friends',
    keys: ['zaloFriendDataMaterializedAt', 'zaloFriendMaterializedCount'], extra: { zaloFriendTargetMode: 'all_friends' },
    run: (scheduler, campaign) => scheduler.materializeZaloFriendInputData(account, campaign),
    values: { zaloFriendMaterializedCount: 2 }, memory: 'before-write'
  },
  {
    method: 'materializeZaloFriendInputData', actionId: 'zalo_message_friend', label: 'tagged friends, empty tag',
    keys: ['zaloFriendDataMaterializedAt', 'zaloFriendMaterializedCount'],
    extra: { zaloFriendTargetMode: 'tagged_friends', zaloFriendSourceTagIds: ['7'] },
    run: (scheduler, campaign) => scheduler.materializeZaloFriendInputData(account, campaign),
    values: { zaloFriendMaterializedCount: 0 }, memory: 'unchanged'
  },
  {
    method: 'ensureInternalSmsChildCampaign', actionId: 'zalo_message_phone',
    keys: ['internalSmsCreatedCampaignIdsByAccount'], extra: { internalSmsCreatedCampaignIdsByAccount: { 8: 77 } },
    setup: events => events.accounts.set(9, { id: 9, name: 'Sms', flatformType: 'sms', isDelete: false }),
    run: (scheduler, campaign) => scheduler.ensureInternalSmsChildCampaign(campaign, 9, '2026-11-14T03:00:00.000Z'),
    values: { internalSmsCreatedCampaignIdsByAccount: { 8: 77, 9: 100 } }, memory: 'from-write'
  },
  {
    method: 'enqueuePostBumpAfterGroupPost', actionId: 'facebook_group_post',
    keys: ['postBumpRotationIndex'],
    extra: { enablePostBump: true, postBumpMode: 'select', postBumpTargetCampaignIds: [201, 202], postBumpCount: 3, postBumpRotationIndex: 1 },
    setup: (_events, db) => {
      for (const id of [201, 202]) db.campaigns.set(id, { id, name: `Up ${id}`, action_id: 'facebook_comment_seeding_post', extra_settings: {}, is_delete: false })
    },
    run: (scheduler, campaign) => scheduler.enqueuePostBumpAfterGroupPost(campaign, 'https://www.facebook.com/groups/1/posts/2'),
    values: { postBumpRotationIndex: 0 }, memory: 'before-write'
  },
  {
    method: 'resolveCreatedPostBumpTargets', actionId: 'facebook_group_post',
    keys: ['postBumpCreatedCampaignIdsByAccount'],
    extra: { enablePostBump: true, postBumpMode: 'create', postBumpAccountIds: [31, 32], postBumpCreatedCampaignIdsByAccount: { 31: 300 } },
    setup: (_events, db) => db.campaigns.set(300, { id: 300, name: 'Up 31', action_id: 'facebook_comment_seeding_post', extra_settings: {}, is_delete: false }),
    run: (scheduler, campaign) => scheduler.resolveCreatedPostBumpTargets(campaign),
    values: { postBumpCreatedCampaignIdsByAccount: { 31: 300, 32: 100 } }, memory: 'before-write'
  },
  {
    method: 'advanceCampaignContentRotation', actionId: 'facebook_page_post',
    keys: ['contentRotationIndex'], extra: { contentRotationIndex: 1 },
    run: (scheduler, campaign) => scheduler.advanceCampaignContentRotation(campaign, { index: 1, count: 3 }),
    values: { contentRotationIndex: 2 }, memory: 'latest-db'
  }
]

async function schedulerCases(freshRepository) {
  const Harness = schedulerHarness()
  for (const mode of ['ok', 'denied']) {
    globalThis.__fakeDb = makeDb(mode)
    const db = globalThis.__fakeDb
    const repo = freshRepository()
    let writes = 0
    await captureWarnings(async () => {
      for (const [index, item] of SCHEDULER_CASES.entries()) {
        const id = index + 1
        const events = { broadcasts: [], wholeWrites: [], accounts: new Map(), created: [], inputs: [] }
        item.setup?.(events, db)
        db.campaigns.set(id, { id, name: item.method, action_id: item.actionId, account_id: 5, status: 'đang chạy', is_delete: false,
          extra_settings: { ...baseExtra, ...clone(item.extra || {}) }, updated_at: '2026-11-14T00:00:00.000Z' })
        const campaign = mapRow(db.campaigns.get(id))      // bản trong RAM lúc bắt đầu lượt
        const memoryBefore = clone(campaign.extraSettings)
        db.campaigns.get(id).extra_settings.webEditedKey = 'edited on Web'   // Web sửa giữa lượt
        const dbBefore = clone(db.campaigns.get(id).extra_settings)
        const scheduler = makeScheduler(Harness, repo, db, events)
        const label = item.label ? `${item.method} (${item.label})` : item.method
        await item.run(scheduler, campaign)
        writes += 1

        let written
        if (mode === 'ok') {
          const call = db.rpcCalls.at(-1)
          assert.equal(call.params.p_campaign_id, id, label)
          assert.deepEqual(Object.keys(call.params.p_set).sort(), [...item.keys].sort(), `${label}: only the runtime keys are sent`)
          assert.deepEqual(call.params.p_remove, [])
          written = call.params.p_set
          assert.deepEqual(events.wholeWrites, [], `${label}: no whole-object write`)
          assert.deepEqual(db.campaigns.get(id).extra_settings, { ...dbBefore, ...written }, `${label}: the Web edit survives`)
          assert.deepEqual(events.broadcasts, [{ channel: 'campaign:status-updated',
            payload: { id, invalidateConfig: true, updatedAt: db.campaigns.get(id).updated_at } }], `${label}: config refresh signal without stale status`)
        } else {
          assert.equal(events.wholeWrites.length, 1, `${label}: one whole-object write`)
          const whole = events.wholeWrites[0].updates
          assert.deepEqual(Object.keys(whole), ['extraSettings'])
          written = Object.fromEntries(item.keys.map(key => [key, whole.extraSettings[key]]))
          const base = item.memory === 'latest-db' ? dbBefore : memoryBefore
          assert.deepEqual(whole.extraSettings, { ...base, ...written }, `${label}: exactly the old whole-object write`)
          assert.deepEqual(events.broadcasts, [])
        }
        for (const [key, value] of Object.entries(item.values)) assert.deepEqual(written[key], value, `${label}: ${key}`)
        for (const key of item.keys.filter(key => /MaterializedAt$/.test(key))) assert.match(written[key], ISO)

        // Bản trong RAM như trước.
        const memoryBase = item.memory === 'latest-db' ? dbBefore : memoryBefore
        if (item.memory === 'unchanged') assert.deepEqual(campaign.extraSettings, memoryBefore, `${label}: in-memory copy untouched as before`)
        else if (mode === 'denied' && item.memory !== 'before-write') {
          assert.deepEqual(campaign.extraSettings, mapRow(db.campaigns.get(id)).extraSettings, `${label}: in-memory copy from the write result as before`)
        } else assert.deepEqual(campaign.extraSettings, { ...memoryBase, ...written }, `${label}: in-memory copy as before`)
      }
    })
    assert.equal(db.rpcCalls.length, mode === 'ok' ? writes : 1, 'denied RPC is called once, then whole-object writes')
  }
  ok(`CampaignScheduler call sites (${SCHEDULER_CASES.length} cases) send only their runtime keys; without the RPC they write exactly the old whole object; in-memory copies unchanged`)
}

// ── Kiểm tĩnh: mọi chỗ ghi đều qua helper ─────────────────────────────────────────────────────────────────────
function enclosingMethodName(node, sourceFile) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) return current.name?.getText(sourceFile)
  }
  return null
}

function objectKeys(argument, scope, sourceFile) {
  let literal = argument
  if (ts.isIdentifier(argument)) {
    let found = null
    const visit = node => {
      if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === argument.text && node.initializer) found = node.initializer
      ts.forEachChild(node, visit)
    }
    visit(scope)
    literal = found
  }
  assert.ok(literal && ts.isObjectLiteralExpression(literal), `object literal for ${argument.getText(sourceFile)}`)
  return literal.properties.map(property => {
    if (ts.isSpreadAssignment(property)) return '...'
    return property.name.getText(sourceFile)
  })
}

function staticChecks() {
  const writers = new Set(['updateCampaignAndBroadcast', 'updateCampaign', 'updateClaimedZaloServerCampaign',
    'updateRunningCampaignAndBroadcast', 'updateRunningDesktopCampaign'])
  const extraWrites = []
  const persistCalls = []
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text
      const method = enclosingMethodName(node, schedulerSource)
      if (writers.has(name) && node.arguments.some(arg => ts.isObjectLiteralExpression(arg) &&
        arg.properties.some(property => property.name?.getText(schedulerSource) === 'extraSettings'))) {
        extraWrites.push(method)
      }
      if (name === 'persistCampaignRuntimeSettings' && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const methodNode = (() => { let current = node.parent; while (!ts.isMethodDeclaration(current)) current = current.parent; return current })()
        persistCalls.push({ method, keys: objectKeys(node.arguments[1], methodNode, schedulerSource) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(schedulerClass)
  assert.deepEqual(extraWrites, ['persistCampaignRuntimeSettings'], 'the only extraSettings write left in CampaignScheduler is the helper fallback')
  assert.deepEqual(persistCalls.map(call => call.method).sort(), [
    'advanceCampaignContentRotation', 'ensureInternalSmsChildCampaign', 'enqueuePostBumpAfterGroupPost', 'executeCampaignV2',
    'markZaloCancelSentFriendRequestMaterialized', 'markZaloFriendRecommendationMaterialized', 'materializeZaloBirthdayInputData',
    'materializeZaloFriendInputData', 'materializeZaloFriendInputData', 'resolveCreatedPostBumpTargets'
  ].sort())
  for (const call of persistCalls) {
    assert.ok(call.keys.length > 0)
    for (const key of call.keys) assert.ok(RUNTIME_OWNED_KEYS.has(key), `${call.method} writes ${key}, which is not a runtime-owned key`)
  }
  const sourceLink = persistCalls.find(call => call.method === 'executeCampaignV2')
  assert.deepEqual(sourceLink.keys, ['sourceLinkIndex'])

  // Repository: bảo trì lịch không còn ghi extraSettings cả khối; ba nhánh xoá dấu qua helper với đúng khoá.
  const repoFile = 'src/main/data/repositories/campaignRepository.ts'
  const repoSource = ts.createSourceFile(repoFile, read(repoFile), ts.ScriptTarget.Latest, true)
  const constants = {}
  for (const statement of repoSource.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      let init = declaration.initializer
      if (init && ts.isAsExpression(init)) init = init.expression
      if (init && ts.isArrayLiteralExpression(init) && /_MATERIALIZED_KEYS$/.test(declaration.name.getText(repoSource))) {
        constants[declaration.name.getText(repoSource)] = init.elements.map(element => element.text)
      }
    }
  }
  const maintain = repoSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'maintainCampaignSchedules')
  const helperCalls = []
  const repoExtraWrites = []
  const visitRepo = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'updateCampaignRemovingRuntimeSettings') helperCalls.push(constants[node.arguments[2].getText(repoSource)])
      if (node.expression.text === 'updateCampaign' && node.arguments.some(arg => ts.isObjectLiteralExpression(arg) &&
        arg.properties.some(property => property.name?.getText(repoSource) === 'extraSettings'))) repoExtraWrites.push(node.getText(repoSource))
    }
    ts.forEachChild(node, visitRepo)
  }
  visitRepo(maintain)
  assert.deepEqual(repoExtraWrites, [], 'maintenance has no whole extraSettings write left')
  assert.deepEqual(helperCalls.map(keys => keys.join(',')).sort(), Object.values(MAINTENANCE_KEYS).map(keys => keys.join(',')).sort())
  for (const keys of helperCalls) for (const key of keys) assert.ok(RUNTIME_OWNED_KEYS.has(key))
  ok(`static check: ${persistCalls.length} scheduler writes + 3 maintenance writes go through the per-key helper; no other extraSettings write remains`)
}

async function main() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-runtime-settings-merge-'))
  try {
    staticChecks()
    const freshRepository = await bundleRepository(outDir)
    await repositoryCases(freshRepository)
    await maintenanceCases(freshRepository)
    await schedulerCases(freshRepository)
    console.log(`PASS ${passed}/${passed}: campaign runtime settings merge smoke`)
  } finally {
    delete globalThis.__fakeDb
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
