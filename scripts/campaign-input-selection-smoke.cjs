const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { buildSync } = require('esbuild')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-input-selection-'))
  try {
    const outfile = join(directory, 'selection.cjs')
    buildSync({ entryPoints: [resolve(__dirname, '../src/shared/campaignInputDataSelection.ts')],
      bundle: true, platform: 'node', format: 'cjs', outfile })
    const { loadSelectedCampaignInputData: load, sortCampaignInputDataSelection: sort } = require(outfile)
    let calls = []
    const rows = Array.from({ length: 10000 }, (_, i) => ({ id: i + 1,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }))
    const query = { campaignId: 91, inputDataIds: [10000], sort: 'created_asc', search: 'Data', status: 'hoàn thành' }
    const read = async request => {
      calls.push(request)
      assert.equal(request.offset, 0)
      assert.ok(request.inputDataIds.length <= 500)
      assert.equal(request.limit, request.inputDataIds.length)
      const items = rows.filter(row => request.inputDataIds.includes(row.id)).reverse()
      return { items, total: items.length }
    }
    assert.deepEqual((await load(query, read)).map(row => row.id), [10000])
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].inputDataIds, [10000])
    assert.equal(calls[0].search, 'Data')
    assert.equal(calls[0].status, 'hoàn thành')

    calls = []
    const selected = Array.from({ length: 1001 }, (_, i) => i + 1)
    const result = await load({ campaignId: 91, inputDataIds: selected, sort: 'processed_desc' }, async request => {
      if (calls.length === 1) rows[1000].dateAction = '2027-01-01T00:00:00Z'
      return read(request)
    })
    assert.equal(calls.length, 3)
    assert.equal(new Set(result.map(row => row.id)).size, 1001)
    assert.equal(result[0].id, 1001)
    assert.equal(result.at(-1).id, 1)

    const sample = [
      { id: 1, createdAt: '2026-01-01T00:00:00.000900Z' },
      { id: 2, createdAt: '2026-01-01T00:00:00.000100+00:00', dateAction: '2026-01-02T00:00:00Z' },
      { id: 3, createdAt: null },
      { id: 4, createdAt: '2026-01-01T00:00:00.000900Z' },
      { id: 5, createdAt: null }
    ]
    for (const [mode, expected] of Object.entries({ created_asc: [2, 1, 4, 3, 5],
      created_desc: [4, 1, 2, 5, 3], processed_asc: [1, 4, 2, 3, 5], processed_desc: [2, 4, 1, 5, 3] })) {
      assert.deepEqual(sort(sample, mode).map(row => row.id), expected)
    }
    for (const items of [[{ id: 1 }], [{ id: 1 }, { id: 1 }], [{ id: 1 }, { id: 3 }]]) {
      await assert.rejects(load({ campaignId: 91, inputDataIds: [1, 2] }, async () => ({ items, total: 2 })),
        /Không thể tải đủ data đã chọn/)
    }
    assert.deepEqual(await load({ campaignId: 91, inputDataIds: [] }, () => assert.fail('empty selection queried')), [])
    console.log('PASS selected IDs only, one RPC for far row, moving timestamps across 3 batches, completeness, four orders, microseconds/ties/nulls')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
