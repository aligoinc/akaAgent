const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../src/shared/campaignHistory.ts'), 'utf8')
const context = { exports: {}, Map, Error }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const { readCampaignHistory, displayHistoryEntry, validateHistoryQuery } = context.exports
const row = id => ({ id: String(id), log: `12:00:00 16/10/2026 - row ${id}`, createdAt: '2026-10-16T05:00:00Z' })
const checks = []
const ok = text => checks.push(text)
;(async () => {
  const first = await readCampaignHistory(1, undefined, async () => ({ campaignId: 1, items: [row('9007199254740993'), row('9007199254740992')], hasMore: true, nextCursor: '9007199254740992' }))
  assert.equal(first.newestId, '9007199254740993')
  assert.equal(first.hasOlder, true)
  ok('bigint string ordering and initial cursor')
  const calls = []
  const updated = await readCampaignHistory(1, first, async query => {
    calls.push(query)
    return calls.length === 1
      ? { campaignId: 1, items: [row('9007199254740994')], hasMore: true, nextCursor: '9007199254740994', throughId: '9007199254740995' }
      : { campaignId: 1, items: [row('9007199254740995')], hasMore: false, nextCursor: '9007199254740995', throughId: '9007199254740995' }
  })
  assert.equal(updated.items[0].id, '9007199254740995')
  assert.equal(calls[1].afterId, '9007199254740994')
  assert.equal(calls[1].throughId, '9007199254740995')
  assert.equal(first.newestId, '9007199254740993')
  ok('drains all new pages within a fixed high-water mark before publishing cursor')
  let count = 0
  await assert.rejects(readCampaignHistory(1, first, async () => {
    if (++count === 2) throw Error('network')
    return { campaignId: 1, items: [row('9007199254740994')], hasMore: true, nextCursor: '9007199254740994' }
  }), /network/)
  assert.equal(first.newestId, '9007199254740993')
  ok('failed later page cannot advance stored cursor or mutate old history')
  let valid = true
  assert.equal(await readCampaignHistory(1, first, async () => {
    valid = false
    return { campaignId: 1, items: [row('9007199254740994')], hasMore: true }
  }, false, () => valid), null)
  ok('tab/session cancellation fences responses and further requests')
  const bounded = await readCampaignHistory(1, { id: 1, items: [row(1)], newestId: '1', hasOlder: false }, async () => ({ campaignId: 1, items: Array.from({ length: 500 }, (_, i) => row(i + 2)), hasMore: false }))
  assert.equal(bounded.items.length, 100); assert.equal(bounded.newestId, '501'); assert.equal(bounded.hasOlder, true)
  const older = await readCampaignHistory(1, bounded, async query => {
    assert.equal(query.beforeId, '402')
    return { campaignId: 1, items: [row(401)], hasMore: true }
  }, true)
  assert.equal(older.items.length, 101); assert.equal(older.newestId, '501')
  ok('automatic window stays bounded; older pages retain newest cursor')
  const display = displayHistoryEntry({ ...row(1), log: '12:00:00 16/10/2026 - first\n12:00:01 16/10/2026 - continuation 😀\n<!-- screenshotEventId:91 -->' })
  assert.equal(display.timestamp, '12:00:00 16/10/2026')
  assert.match(display.message, /continuation 😀/); assert.equal(display.screenshotEventId, 91)
  ok('one record stays one entry, including multiline timestamps and screenshots')
  for (const query of [{ afterId: '9223372036854775808' }, { beforeId: '0' }, { beforeId: '1', afterId: '2' }, { limit: 501 }, { throughId: '1' }]) assert.throws(() => validateHistoryQuery(query))
  assert.equal(validateHistoryQuery({ afterId: '0', limit: 100 }).afterId, '0')
  ok('cursor validation including bigint overflow')
  const web = path.resolve(__dirname, '../../akaAgentWebApp/packages/campaign-core/src/campaignHistory.ts')
  assert.equal(fs.readFileSync(web, 'utf8'), source)
  ok('Desktop/Web shared history contract parity')
  console.log(JSON.stringify({ checks }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
