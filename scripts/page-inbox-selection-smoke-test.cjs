// Real Electron/SQLite/service reads in a temporary database. No network or production writes.
// Run: node scripts/page-inbox-selection-smoke-test.cjs
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 120000
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const root = path.resolve(__dirname, '..'), ts = require('typescript'), Database = require('better-sqlite3')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-inbox-selection-')), cache = new Map()
function load(file) {
  file = path.resolve(root, file)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const localRequire = id => {
    if (id === 'electron') return { app: { getPath: () => dir } }
    if (id.endsWith('/supabaseClient')) return { getSupabaseClient: () => { throw Error('Unexpected network access') } }
    if (id.endsWith('/mappers') || id.endsWith('/repositories/dataGroupRepository')) return {}
    return id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.ts')) : require(id)
  }
  localRequire.resolve = require.resolve
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  new Function('require', 'module', 'exports', js)(localRequire, mod, mod.exports)
  return mod.exports
}
const auth = load('src/main/data/currentUser.ts')
auth.setCurrentUser({ staffId: 10, organizationId: 1 })
auth.setCurrentUserCredentials({ username: 'fixture', password: 'fixture' })
const repo = load('src/main/data/repositories/localAccountContactRepository.ts')
const service = load('src/main/data/filters/dataColumnReadService.ts')
const text = '🔥 Chăm sóc khách hàng ưu đãi Việt Nam. '.repeat(4)
const messages = Array.from({ length: 25 }, (_, i) => ({ id: 'm' + i, text, createdTime: '2026-10-26T01:00:00Z', fromId: '999', fromName: 'Page thử nghiệm' }))
const history = messages.map(m => `${m.createdTime} Page thử nghiệm: ${m.text}`).join('\n')
const extra = { source: 'facebook_page_inbox', pageUid: '999', pageName: 'Page thử nghiệm', phone: '0901234567',
  lastMessageAt: '2026-10-26T01:00:00Z', lastMessageText: text, messages, messageHistory: history }
repo.upsertPageInboxContacts([{ accountId: 1, name: 'Khách mẫu', uid: '1', extraData: extra }])
const db = new Database(repo.getLocalDataDbPath())
db.exec('DELETE FROM auto_account_contacts')
const insert = db.prepare(`INSERT INTO auto_account_contacts(id,account_id,contact_type,name,uid,extra_data,staff_id,organization_id,is_delete)
  VALUES(?,?,'page_inbox_customer',?,?,?, ?,?,?)`)
db.transaction(() => {
  for (let i = 1; i <= 15211; i++) insert.run(i, 1, `Khách ${i}`, String(100000 + i), JSON.stringify({ ...extra,
    lastMessageAt: new Date(Date.UTC(2026, 9, 26, 1, 0, i % 7)).toISOString(),
    messageHistory: history + (i % 2 ? '\nDấu riêng trong tin nhắn cũ' : '') }), 10, 1, 0)
  for (const [id, account, staff, org, page, deleted] of [
    [20001, 2, 10, 1, '999', 0], [20002, 1, 11, 1, '999', 0], [20003, 1, 10, 2, '999', 0],
    [20004, 1, 10, 1, 'other', 0], [20005, 1, 10, 1, '999', 1]
  ]) insert.run(id, account, 'Không được chọn', String(id), JSON.stringify({ ...extra, pageUid: page }), staff, org, deleted)
})()
let checks = 0
const measurements = []
async function read(query = {}, mode = 'export', authorize = async () => {}) {
  return service.executeColumnRead('selection-test', { source: 'page_inbox', accountId: 1,
    formId: 'selection', requestId: crypto.randomUUID(), query: {
      pageUid: '999', projection: 'campaign', columnFilters: { version: 1, filters: [] }, ...query
    } }, authorize, mode)
}
function identities(result, expected) {
  assert.deepEqual(result.contacts.map(c => c.id), expected)
  assert.equal(new Set(result.contacts.map(c => c.uid)).size, expected.length)
  for (const c of result.contacts) {
    assert.equal(c.name, `Khách ${c.id}`); assert.equal(c.uid, String(100000 + c.id))
    assert.equal(c.contactType, 'page_inbox_customer'); assert.equal(c.accountId, 1)
    assert.deepEqual(c.extraData, { source: extra.source, pageUid: '999', pageName: extra.pageName, phone: extra.phone })
  }
  checks++
}
const sortedIds = Array.from({ length: 15211 }, (_, i) => i + 1).sort((a, b) => (b % 7 - a % 7) || b - a)
;(async () => {
  for (const [limit, offset] of [[5000, 1000], [10000, 0]]) {
    const start = performance.now(), result = await read({ limit, offset })
    identities(result, sortedIds.slice(offset, offset + limit)); assert.equal(result.total, 15211)
    const bytes = Buffer.byteLength(JSON.stringify(result.contacts)); assert.ok(bytes < 32 * 1024 * 1024)
    measurements.push({ selected: limit, offset, bytes, ms: Math.round(performance.now() - start) })
    console.log(JSON.stringify(measurements.at(-1)))
  }
  identities(await read({ ids: sortedIds.slice(0, 10000).reverse() }), sortedIds.slice(0, 10000))
  identities(await read({ ids: [1, 2, 3], excludeIds: [2] }), [3, 1])
  // Filtering must still see old messages that are absent from the projected result.
  const matching = sortedIds.filter(id => id % 2 === 1)
  identities(await read({ messageFilterMode: 'contain_any', messageKeywords: 'Dấu riêng', excludeIds: [15211], limit: 5000 }), matching.filter(id => id !== 15211).slice(0, 5000))
  identities(await read({ columnFilters: { version: 1, filters: [{ field: 'message', op: 'contains', value: 'Chăm sóc' }] }, limit: 5000 }), sortedIds.slice(0, 5000))
  identities(await read({ dateFrom: '2026-10-26', dateTo: '2026-10-26', phoneFilter: 'has_phone', search: 'Khách 15211' }), [15211])
  identities(await read({ phoneFilter: 'no_phone' }), [])
  const full = await read({ projection: undefined, ids: [15211] })
  assert.deepEqual(full.contacts[0].extraData.messages, messages)
  assert.equal(full.contacts[0].extraData.messageHistory, history + '\nDấu riêng trong tin nhắn cũ'); checks++
  // The unprojected selection still hits the existing cap; no guard was disabled.
  await assert.rejects(read({ projection: undefined, limit: 5000 }), /Kết quả quá lớn/); checks++
  const legacy = repo.exportPageInboxContacts(1, { pageUid: '999', projection: 'campaign', ids: [3, 1] })
  identities({ contacts: legacy }, [3, 1])
  assert.deepEqual(repo.exportPageInboxContacts(1, { pageUid: '999', ids: [1] })[0].extraData.messages, messages); checks++
  await assert.rejects(read({}, 'export', async () => { throw new Error('Không có quyền fixture') }), /Không có quyền fixture/); checks++
  // Cancellation stops the real SQLite child and a subsequent request can recover.
  const pending = read({ limit: 10000 })
  setTimeout(() => service.cancelColumnRead('selection-test', 'selection'), 20)
  await assert.rejects(pending, /hủy/)
  identities(await read({ ids: [1] }), [1]); checks++
  // Count UTF-8 bytes, not characters, and keep the child response limit active.
  insert.run(30000, 1, 'Khách lớn', '30000', JSON.stringify({ ...extra, pageUid: 'large', messageHistory: '🔥'.repeat(5 * 1024 * 1024) }), 10, 1, 0)
  await assert.rejects(read({ pageUid: 'large', projection: undefined }), /Trang dữ liệu quá lớn/); checks++
  const largeCompact = await read({ pageUid: 'large' })
  assert.equal(largeCompact.contacts.length, 1)
  assert.equal(largeCompact.contacts[0].extraData.pageUid, 'large')
  assert.equal(largeCompact.contacts[0].extraData.messageHistory, undefined); checks++
  console.log(JSON.stringify({ checks, fixtureRows: 15211, historyBytesPerContact: Buffer.byteLength(JSON.stringify(extra)), measurements }))
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  // The reader waits for child shutdown before releasing its coordinator slot.
  db.close(); fs.rmSync(dir, { recursive: true, force: true })
})
