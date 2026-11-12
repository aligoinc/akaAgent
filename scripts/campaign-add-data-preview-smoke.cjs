// Smoke test of Desktop "Thêm data" duplicate handling (no real DB, in-memory PostgREST fake):
// - the shared rule (src/shared/campaignAppendData.ts) is byte-for-byte the rule dev_3 used before the change,
// - preview (IPC service, read-only) and the real write path (addCampaignInputDataRows) classify the same rows the same way,
// - the existing-key read pages by id, the switch/validation/error codes, flight limit and deadline of the preview service.
// Run: node scripts/campaign-add-data-preview-smoke.cjs
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

let passed = 0
const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

// ── In-memory PostgREST fake ─────────────────────────────────────────────────────────────────────────────
function makeDb(state) {
  const log = []
  const match = (row, filters) => filters.every(([op, column, value]) => {
    const actual = row[column]
    if (op === 'eq') return actual === value
    if (op === 'neq') return actual !== value
    if (op === 'in') return value.includes(actual)
    if (op === 'is') return actual === value
    return true
  })
  function builder(table) {
    const q = { table, filters: [], order: [], range: null, columns: '*', op: 'select', single: false, payload: null, signal: null }
    const run = async () => {
      log.push(q)
      if (state.hang && table === state.hang) {
        await new Promise((resolveHang, rejectHang) => {
          if (!q.signal) return
          q.signal.addEventListener('abort', () => rejectHang(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        }).catch(() => {})
        return { data: null, error: { message: 'aborted' } }
      }
      if (state.delay) await new Promise(r => setTimeout(r, state.delay))
      if (table === 'auto_system_settings') {
        if (state.settingError) return { data: null, error: state.settingError }
        return { data: state.setting === undefined ? null : state.setting, error: null }
      }
      const rows = state.tables[table] || (state.tables[table] = [])
      if (q.op === 'insert') {
        const inserted = q.payload.map(row => ({ id: ++state.nextId, is_delete: false, ...row }))
        rows.push(...inserted)
        return { data: inserted, error: null }
      }
      let selected = rows.filter(row => match(row, q.filters))
      if (q.op === 'update') {
        selected.forEach(row => Object.assign(row, q.payload))
      }
      for (const [column, ascending] of [...q.order].reverse()) {
        selected = [...selected].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1))
      }
      if (q.range) selected = selected.slice(q.range[0], q.range[1] + 1)
      if (q.head) return { data: null, count: selected.length, error: null }
      if (q.single) return { data: selected[0] ?? null, error: null }
      return { data: selected, count: selected.length, error: null }
    }
    const self = {
      select(columns, options) { if (q.op === 'select') q.columns = columns; if (options?.head) q.head = true; return self },
      eq(column, value) { q.filters.push(['eq', column, value]); return self },
      neq(column, value) { q.filters.push(['neq', column, value]); return self },
      in(column, value) { q.filters.push(['in', column, value]); return self },
      is(column, value) { q.filters.push(['is', column, value]); return self },
      order(column, options) { q.order.push([column, options?.ascending !== false]); return self },
      range(from, to) { q.range = [from, to]; return self },
      limit(n) { q.range = [0, n - 1]; return self },
      abortSignal(signal) { q.signal = signal; return self },
      maybeSingle() { q.single = true; return self },
      single() { q.single = true; return self },
      insert(payload) { q.op = 'insert'; q.payload = Array.isArray(payload) ? payload : [payload]; return self },
      update(payload) { q.op = 'update'; q.payload = payload; return self },
      then(onFulfilled, onRejected) { return run().then(onFulfilled, onRejected) }
    }
    return self
  }
  return {
    log,
    client: {
      from: table => builder(table),
      rpc: async (name) => { log.push({ rpc: name }); return { data: null, error: { code: 'PGRST202', message: `rpc ${name} not in fake` } } }
    }
  }
}

// ── The rule as it was on dev_3 before this change (campaignRepository.ts), kept here as the reference ──────
function makeReference(lib) {
  const { getCampaignInputDataRequirement, normalizeVietnamMobilePhone, isCampaignInputDataValidForAction } = lib
  const keys = (row, actionId) => {
    const requirement = getCampaignInputDataRequirement(actionId)
    if (!requirement) return []
    if (requirement.field === 'phone_or_uid') {
      const out = []
      const phone = normalizeVietnamMobilePhone(row.phone)
      const uid = String(row.uid || '').trim().replace(/\/+$/g, '').toLowerCase()
      if (phone) out.push(`phone:${phone}`)
      if (uid) out.push(`uid:${uid}`)
      return out
    }
    const value = String(row[requirement.field] || '').trim()
    if (actionId === 'email_send') return value ? [value.toLowerCase()] : []
    if (requirement.field === 'phone') {
      const phone = normalizeVietnamMobilePhone(value)
      return phone ? [phone] : []
    }
    const key = value.replace(/\/+$/g, '').toLowerCase()
    return key ? [key] : []
  }
  const normalize = (row, actionId) => {
    const requirement = getCampaignInputDataRequirement(actionId)
    const shouldNormalizePhone = requirement?.field === 'phone' || requirement?.field === 'phone_or_uid' || actionId === 'sms_send' || actionId === 'voice_call'
    return {
      phone: shouldNormalizePhone ? normalizeVietnamMobilePhone(row.phone) : String(row.phone || '').trim(),
      uid: String(row.uid || '').trim(),
      email: actionId === 'email_send' ? String(row.email || '').trim().toLowerCase() : String(row.email || '').trim()
    }
  }
  const classify = (actionId, rows, existingKeys, skip) => {
    const result = { acceptedIndexes: [], invalidIndexes: [], batchDuplicateIndexes: [], existingIndexes: [] }
    const batch = new Set()
    rows.forEach((raw, index) => {
      const row = normalize(raw, actionId)
      const rowKeys = keys(row, actionId)
      if (rowKeys.length === 0 || !isCampaignInputDataValidForAction(row, actionId)) { result.invalidIndexes.push(index); return }
      if (rowKeys.some(key => batch.has(key))) { result.batchDuplicateIndexes.push(index); return }
      if (skip && rowKeys.some(key => existingKeys.has(key))) { result.existingIndexes.push(index); return }
      rowKeys.forEach(key => batch.add(key))
      result.acceptedIndexes.push(index)
    })
    return result
  }
  return { keys, normalize, classify }
}

// Deterministic random rows covering the formats customers paste.
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 }
function sampleRows(random, count, pools) {
  const pick = list => list[Math.floor(random() * list.length)]
  return Array.from({ length: count }, (_, index) => ({
    name: `Khách ${index}`,
    phone: random() < 0.85 ? pick(pools.phones) : '',
    uid: random() < 0.85 ? pick(pools.uids) : '',
    email: random() < 0.85 ? pick(pools.emails) : '',
    info1: random() < 0.3 ? 'ghi chú' : ''
  }))
}
function pools(random) {
  const phones = []
  for (let i = 0; i < 60; i++) {
    const tail = String(10000000 + Math.floor(random() * 89999999)).slice(0, 8)
    const prefix = ['91', '98', '86', '33', '70', '56', '59', '87', '16'][i % 9]
    const base = `${prefix}${tail}`
    phones.push(`0${base}`, `+84${base}`, `84${base}`, `0${base.slice(0, 3)} ${base.slice(3, 6)} ${base.slice(6)}`, base, ` 0${base}.`, `(0${base})`)
  }
  phones.push('123', 'abc', '0123456789', '01688123456', '+841234', '0912-345-678', '84 912 345 678', '')
  const uids = []
  for (let i = 0; i < 80; i++) {
    const id = String(100000000000 + Math.floor(random() * 899999999999))
    uids.push(id, `${id}/`, ` ${id} `, `https://www.facebook.com/groups/${id}`, `https://www.facebook.com/groups/${id}/`, `HTTPS://WWW.FACEBOOK.COM/GROUPS/${id}`,
      `https://zalo.me/g/${id.slice(0, 6)}abc`, `https://zalo.me/g/${id.slice(0, 6)}ABC//`)
  }
  uids.push('', '   ', '/')
  const emails = []
  for (let i = 0; i < 50; i++) emails.push(`khach${i}@gmail.com`, `Khach${i}@Gmail.com `, ` KHACH${i}@GMAIL.COM`, `khach${i}@`, `khach ${i}@x.vn`, `a@b`)
  emails.push('', 'x@y.co')
  return { phones, uids, emails }
}

const ACTIONS = ['zalo_message_phone', 'sms_send', 'voice_call', 'zalo_add_group_member', 'email_send', 'facebook_group_post',
  'facebook_join_group', 'facebook_page_post', 'zalo_message_friend', 'zalo_message_group', 'zalo_join_group_link', 'facebook_message_uid',
  'facebook_comment_seeding_post', 'zalo_message_remarketing_customer']

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'akaagent-add-data-preview-'))
  try {
    const outfile = join(dir, 'bundle.cjs')
    const servicePath = resolve(__dirname, '../src/main/services/campaignAddDataPreviewService.ts')
    await build({
      stdin: { contents: `
        export { handleCampaignAddDataPreviewRequest, ADD_DATA_PREVIEW_DEADLINE_MS } from './src/main/services/campaignAddDataPreviewService';
        export { addCampaignInputDataRows } from './src/main/data/repositories/campaignRepository';
        export { setCurrentUser, setCurrentUserCredentials } from './src/main/data/currentUser';
        export * from './src/shared/campaignAppendData';
        export { getCampaignInputDataRequirement, isCampaignInputDataValidForAction } from './src/shared/types';
        export { normalizeVietnamMobilePhone } from './src/shared/phone';
      `, resolveDir: resolve(__dirname, '..') },
      outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['better-sqlite3'], logLevel: 'warning',
      plugins: [{ name: 'fakes', setup(plugin) {
        plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fake-electron' }))
        plugin.onLoad({ filter: /.*/, namespace: 'fake-electron' }, () => ({ contents: `
          export const app = { getPath: () => { throw new Error('preview/write must not touch userData') }, isPackaged: false, getVersion: () => '0.0.0' };
          export const ipcMain = { handle() {} }; export const BrowserWindow = { getAllWindows: () => [] };
          export default { app, ipcMain, BrowserWindow };` }))
        plugin.onResolve({ filter: /\/supabaseClient$/ }, () => ({ path: 'db', namespace: 'fake-db' }))
        plugin.onLoad({ filter: /.*/, namespace: 'fake-db' }, () => ({ contents: `
          export const getSupabaseClient = () => globalThis.__fakeDb.client;
          export const getSupabaseUrl = () => 'https://mock.invalid';
          export const desktopSession = { matches: () => true, clear() {} };
          export const isTrustedServerSupabaseConfigured = () => true;` }))
        // Short deadline so the timeout case runs in a fraction of a second.
        plugin.onLoad({ filter: /campaignAddDataPreviewService\.ts$/ }, args => ({
          loader: 'ts', contents: readFileSync(args.path, 'utf8').replace('ADD_DATA_PREVIEW_DEADLINE_MS = 20_000', 'ADD_DATA_PREVIEW_DEADLINE_MS = 300')
        }))
      } }]
    })
    const lib = require(outfile)
    assert.equal(lib.ADD_DATA_PREVIEW_DEADLINE_MS, 300)
    assert.ok(servicePath)
    const reference = makeReference(lib)

    // 1. Shared rule == dev_3 rule, and classifying raw rows == classifying rows normalized for the write.
    let compared = 0
    for (const [seedIndex, actionId] of ACTIONS.entries()) {
      for (let round = 0; round < 6; round++) {
        const random = rng(1000 * seedIndex + round + 1)
        const p = pools(random)
        const existingRows = sampleRows(random, 400, p)
        const pending = sampleRows(random, 900, p)
        const existingKeys = new Set(existingRows.flatMap(row => reference.keys(row, actionId)))
        const existingKeysNew = new Set(existingRows.flatMap(row => lib.appendInputDataDedupeKeys(row, actionId)))
        assert.deepEqual([...existingKeysNew].sort(), [...existingKeys].sort(), `${actionId}: existing keys`)
        for (const skip of [true, false]) {
          const expected = reference.classify(actionId, pending, existingKeys, skip)
          const actualRaw = lib.classifyAppendInputData(actionId, pending, existingKeys, { skipExisting: skip })
          const actualNormalized = lib.classifyAppendInputData(actionId, pending.map(row => ({ ...row, ...lib.normalizeAppendInputIdentity(row, actionId) })), existingKeys, { skipExisting: skip })
          assert.deepEqual(actualRaw, expected, `${actionId} skip=${skip}: raw rows`)
          assert.deepEqual(actualNormalized, expected, `${actionId} skip=${skip}: rows normalized like the write path`)
          compared += pending.length
        }
        pending.forEach(row => {
          assert.deepEqual(lib.appendInputRowKeys(row, actionId), reference.keys(reference.normalize(row, actionId), actionId))
          assert.equal(lib.isAppendInputRowValid(row, actionId), reference.classify(actionId, [row], new Set(), true).invalidIndexes.length === 0)
        })
      }
    }
    ok(`shared rule identical to dev_3 rule on ${compared.toLocaleString('en')} classified rows across ${ACTIONS.length} campaign types (raw and write-normalized)`)

    const unsupported = ['zalo_message_group_realtime', 'facebook_newsfeed_interaction', 'unknown_action']
    for (const actionId of unsupported) assert.equal(lib.appendInputDataKeyColumns(actionId), actionId === 'zalo_message_group_realtime' ? 'uid' : null)
    assert.equal(lib.appendInputDataKeyColumns('zalo_add_group_member'), 'phone, uid')
    assert.equal(lib.appendInputDataKeyColumns('email_send'), 'email')
    assert.equal(lib.parseAppendPreviewEnabled(undefined), true)
    assert.equal(lib.parseAppendPreviewEnabled('{"audience":"all"}'), true)
    assert.equal(lib.parseAppendPreviewEnabled('{"audience":"all","appendPreview":false}'), false)
    assert.equal(lib.parseAppendPreviewEnabled({ appendPreview: 'false' }), true)
    assert.equal(lib.parseAppendPreviewEnabled('not json'), true)
    ok('key columns per campaign type; switch: missing/bad = on, only appendPreview:false turns it off (as Web)')

    // 2. Preview service + real write path on the same fake campaign.
    lib.setCurrentUser({ staffId: 7, organizationId: 9, isAdminAkabiz: false, entitlements: { zalo: true, sms: true, email: true, facebookCore: true, facebookFanpage: true } })
    lib.setCurrentUserCredentials({ username: 'fixture-user', password: 'fixture-password' })
    const campaignRow = (id, actionId, extra = {}) => ({
      id, staff_id: 7, organization_id: 9, is_delete: false, action_id: actionId, name: `Chiến dịch ${id}`, status: 'tạm dừng',
      schedule: '2026-11-12T03:00:00.000Z', original_schedule: '2026-11-12T03:00:00.000Z', account_id: 501, data_target_source_mode: 'direct',
      extra_settings: {}, content: 'Xin chào', updated_at: '2026-11-12T03:00:00.000Z', created_at: '2026-11-01T03:00:00.000Z',
      auto_campaign_actions: { name: actionId, is_active: true, is_delete: false }, ...extra
    })
    const freshState = () => ({
      nextId: 100000, setting: { value: '{"audience":"all","defaultDays":30,"maxDays":365}' }, settingError: null,
      tables: { auto_campaigns: [], auto_campaign_input_data: [] }
    })
    let state = freshState()
    globalThis.__fakeDb = makeDb(state)
    const resetDb = () => { state = freshState(); globalThis.__fakeDb = makeDb(state) }

    const call = request => lib.handleCampaignAddDataPreviewRequest(request)
    let parityRuns = 0
    for (const [seedIndex, actionId] of ['zalo_message_phone', 'sms_send', 'zalo_add_group_member', 'email_send', 'facebook_group_post', 'zalo_message_friend'].entries()) {
      resetDb()
      const random = rng(77 + seedIndex)
      const p = pools(random)
      state.tables.auto_campaigns.push(campaignRow(11 + seedIndex, actionId))
      // 2.300 existing rows (three pages + a short one), some deleted, plus rows of another campaign that must not count.
      sampleRows(random, 2300, p).forEach((row, index) => state.tables.auto_campaign_input_data.push({ id: 5000 + (index * 7919) % 2300, campaign_id: 11 + seedIndex, is_delete: index % 23 === 0, ...row }))
      sampleRows(random, 300, p).forEach((row, index) => state.tables.auto_campaign_input_data.push({ id: 90000 + index, campaign_id: 999, is_delete: false, ...row }))
      const pending = sampleRows(random, 1500, p)
      const preview = await call({ campaignId: 11 + seedIndex, items: pending.map(row => ({ phone: row.phone, uid: row.uid, email: row.email })) })
      assert.equal(preview.ok, true, JSON.stringify(preview))
      const liveExisting = state.tables.auto_campaign_input_data.filter(row => row.campaign_id === 11 + seedIndex && !row.is_delete)
      assert.equal(preview.data.campaignInputCount, liveExisting.length)
      assert.equal(preview.data.itemCount, pending.length)
      const reads = globalThis.__fakeDb.log.filter(q => q.table === 'auto_campaign_input_data')
      assert.ok(reads.length >= 3, 'existing keys read in pages')
      reads.forEach((q, index) => {
        assert.deepEqual(q.order, [['id', true]], 'pages ordered by id')
        assert.deepEqual(q.range, [index * 1000, index * 1000 + 999])
        assert.equal(q.columns, lib.appendInputDataKeyColumns(actionId))
        assert.deepEqual(q.filters, [['eq', 'campaign_id', 11 + seedIndex], ['eq', 'is_delete', false]])
        assert.ok(q.signal, 'reads carry the deadline signal')
      })
      const campaignRead = globalThis.__fakeDb.log.find(q => q.table === 'auto_campaigns')
      assert.deepEqual(campaignRead.filters, [['eq', 'id', 11 + seedIndex], ['eq', 'staff_id', 7], ['eq', 'organization_id', 9], ['eq', 'is_delete', false]])
      assert.equal(globalThis.__fakeDb.log.some(q => q.op === 'insert' || q.op === 'update'), false, 'preview writes nothing')

      const before = state.tables.auto_campaign_input_data.length
      const written = await lib.addCampaignInputDataRows({ campaignId: 11 + seedIndex, rows: pending, campaignSchedule: '2026-11-12T04:00:00.000Z', campaignStatus: 'tạm dừng', skipExistingInCampaign: true })
      assert.equal(written.skippedExistingCount, preview.data.existingIndexes.length, `${actionId}: existing`)
      assert.equal(written.skippedBatchDuplicateCount, preview.data.batchDuplicateIndexes.length, `${actionId}: batch duplicates`)
      assert.equal(written.skippedInvalidCount, preview.data.invalidIndexes.length, `${actionId}: invalid`)
      assert.equal(written.insertedCount, pending.length - preview.data.existingIndexes.length - preview.data.batchDuplicateIndexes.length - preview.data.invalidIndexes.length)
      assert.equal(state.tables.auto_campaign_input_data.length - before, written.insertedCount)
      // After the write, previewing the same rows finds every accepted row already in the campaign.
      const again = await call({ campaignId: 11 + seedIndex, items: pending.map(row => ({ phone: row.phone, uid: row.uid, email: row.email })) })
      // Rows inserted by the write now count as "already in the campaign", including later repeats of them in the list.
      const keysAfterWrite = new Set(state.tables.auto_campaign_input_data.filter(row => row.campaign_id === 11 + seedIndex && !row.is_delete)
        .flatMap(row => reference.keys(row, actionId)))
      const expectedAgain = reference.classify(actionId, pending, keysAfterWrite, true)
      assert.deepEqual(again.data.existingIndexes, expectedAgain.existingIndexes)
      assert.equal(expectedAgain.acceptedIndexes.length, 0, 'nothing left to add after the write')
      assert.ok(again.data.existingIndexes.length >= written.insertedCount + written.skippedExistingCount)
      parityRuns++
    }
    ok(`preview == real write path on ${parityRuns} campaign types (existing/batch/invalid counts, inserted rows), preview reads by id pages and writes nothing`)

    // 3. Switch, validation, errors.
    resetDb()
    state.tables.auto_campaigns.push(campaignRow(31, 'zalo_message_phone'))
    const items = [{ phone: '0912345678' }]
    state.setting = { value: '{"audience":"all","appendPreview":false}' }
    assert.equal((await call({ campaignId: 31, items })).code, 'append_preview_disabled')
    assert.equal(globalThis.__fakeDb.log.some(q => q.table === 'auto_campaign_input_data'), false)
    state.setting = null
    assert.equal((await call({ campaignId: 31, items })).ok, true)
    state.setting = { value: '{"audience":"off"}' }
    assert.equal((await call({ campaignId: 31, items })).ok, true, 'audience is for the other-campaign check, not this preview')
    state.settingError = { code: 'PGRST301', message: 'boom' }
    assert.equal((await call({ campaignId: 31, items })).code, 'append_preview_failed')
    state.settingError = null
    const settingRead = globalThis.__fakeDb.log.find(q => q.table === 'auto_system_settings')
    assert.deepEqual(settingRead.filters, [['eq', 'key', 'web.campaign_input_duplicates'], ['eq', 'is_active', true], ['eq', 'is_secret', false]])
    ok('switch re-read every call: appendPreview:false = disabled before any data read; missing row = on; read error = retryable failure')

    assert.equal((await call({ campaignId: 0, items })).code, 'invalid_append_preview_request')
    assert.equal((await call({ campaignId: 31, items: [] })).code, 'invalid_append_preview_request')
    assert.equal((await call({ campaignId: 31, items: Array.from({ length: 10001 }, () => ({ phone: '0912345678' })) })).code, 'invalid_append_preview_request')
    assert.equal((await call({ campaignId: 31, items: [{ phone: 912345678 }] })).code, 'invalid_append_preview_request')
    assert.equal((await call({ campaignId: 31, items: [{ uid: 'x'.repeat(10001) }] })).code, 'invalid_append_preview_request')
    assert.equal((await call(null)).code, 'invalid_append_preview_request')
    assert.equal((await call({ campaignId: 31, items: Array.from({ length: 10000 }, (_, i) => ({ phone: `09${String(10000000 + i)}` })) })).ok, true)
    ok('validation: campaign id, 1..10.000 items, string fields with length caps')

    assert.equal((await call({ campaignId: 32, items })).code, 'campaign_not_found')
    state.tables.auto_campaigns.push(campaignRow(33, 'zalo_message_phone', { staff_id: 8 }))
    assert.equal((await call({ campaignId: 33, items })).code, 'campaign_not_found', 'another staff')
    state.tables.auto_campaigns.push(campaignRow(34, 'zalo_message_phone', { is_delete: true }))
    assert.equal((await call({ campaignId: 34, items })).code, 'campaign_not_found', 'deleted')
    state.tables.auto_campaigns.push(campaignRow(35, 'zalo_message_phone', { data_target_source_mode: 'data_group' }))
    assert.equal((await call({ campaignId: 35, items })).code, 'campaign_append_unsupported')
    state.tables.auto_campaigns.push(campaignRow(36, 'zalo_message_group_realtime'))
    assert.equal((await call({ campaignId: 36, items })).code, 'campaign_append_unsupported')
    state.tables.auto_campaigns.push(campaignRow(37, 'facebook_newsfeed_interaction'))
    assert.equal((await call({ campaignId: 37, items })).code, 'campaign_append_unsupported')
    assert.equal(lib.isAppendPreviewGone('campaign_append_unsupported'), true)
    assert.equal(lib.isAppendPreviewGone('append_preview_disabled'), true)
    assert.equal(lib.isAppendPreviewGone('append_preview_failed'), false)
    ok('ownership (staff + org + not deleted) and unsupported campaigns (data group, realtime, newsfeed) are refused; gone vs retryable codes')

    // 4. Flight limit and deadline.
    state.delay = 60
    const flights = await Promise.all([call({ campaignId: 31, items }), call({ campaignId: 31, items }), call({ campaignId: 31, items })])
    assert.deepEqual(flights.map(result => result.ok ? 'ok' : result.code).sort(), ['append_preview_busy', 'ok', 'ok'])
    state.delay = 0
    assert.equal((await call({ campaignId: 31, items })).ok, true, 'slots released')
    state.hang = 'auto_campaign_input_data'
    const started = Date.now()
    const timedOut = await call({ campaignId: 31, items })
    assert.equal(timedOut.code, 'append_preview_timeout')
    assert.ok(Date.now() - started < 2000)
    state.hang = null
    assert.equal((await call({ campaignId: 31, items })).ok, true, 'slot released after timeout')
    ok('at most 2 previews per process (third = busy, no queue); deadline aborts the read and frees the slot')

    lib.setCurrentUser(null)
    assert.equal((await call({ campaignId: 31, items })).code, 'session_invalid')
    ok('no session = session_invalid, nothing read')

    console.log(`PASS ${passed} checks`)
  } finally {
    delete globalThis.__fakeDb
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
