// Smoke: chọn chiến dịch engine v2 cho tài khoản "đang chạy" mà máy này không chạy gì cho nó (src/main/services/staleRunningAccount.ts,
// sự cố 27/11/2026: 153 tài khoản Zalo Server đứng im vì trạng thái "đang chạy" còn sót). Hàm thuần, không DB.
// Chạy: node scripts/stale-running-account-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-stale-running-'))
  try {
    const outfile = join(dir, 'staleRunningAccount.cjs')
    await build({ entryPoints: [join(ROOT, 'src/main/services/staleRunningAccount.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' })
    const { staleRunningEngineCampaigns: pick, ENGINE_STALE_STATUS_PROBE_MS } = require(outfile)

    const A = { id: 1, due: true, engine: true }
    const B = { id: 2, due: true, engine: false }
    const C = { id: 3, due: false, engine: true }
    const base = (over = {}) => ({
      status: 'đang chạy', loginStatus: 'đã đăng nhập', hasLocalRun: false, probeDue: true,
      campaigns: [A, B, C], dueNow: c => c.due, engineSupports: c => c.engine, ...over
    })

    assert.equal(ENGINE_STALE_STATUS_PROBE_MS, 2 * 60_000)
    pass('hỏi lại tối đa 2 phút một lần mỗi tài khoản')

    assert.deepEqual(pick(base()).map(c => c.id), [1])
    pass('"đang chạy" không do máy này: chỉ chiến dịch đã tới lịch VÀ chạy bằng engine')

    for (const status of ['chờ xử lý', 'tạm dừng', 'hoàn thành', null, undefined, '']) {
      assert.equal(pick(base({ status })), null, String(status))
    }
    pass('tài khoản không "đang chạy": không dùng đường này (chờ xử lý đi hàng đợi thường, tạm dừng thì đứng)')

    for (const loginStatus of ['chưa đăng nhập', 'checkpoint', null]) assert.equal(pick(base({ loginStatus })), null, String(loginStatus))
    pass('chưa đăng nhập / checkpoint: không hỏi DB')

    assert.equal(pick(base({ hasLocalRun: true })), null)
    pass('máy này đang chạy cho tài khoản (làn riêng): "đang chạy" là thật, không hỏi')

    assert.equal(pick(base({ probeDue: false })), null)
    pass('chưa tới lượt hỏi lại: không hỏi')

    assert.equal(pick(base({ campaigns: [B, C] })), null)
    assert.equal(pick(base({ campaigns: [] })), null)
    pass('không chiến dịch engine nào tới lịch: null (bộ cũ đòi "chờ xử lý", không mở hàng đợi)')

    const engineAsked = []
    const out = pick(base({ engineSupports: c => { engineAsked.push(c.id); return c.engine } }))
    assert.deepEqual(out.map(c => c.id), [1])
    assert.deepEqual(engineAsked, [1, 2], 'chiến dịch chưa tới lịch không hỏi bộ chạy (có thể nạp danh mục engine)')
    pass('xét lịch trước, rồi mới hỏi bộ chạy engine')

    const many = [{ id: 10, due: true, engine: true }, { id: 11, due: true, engine: true }, { id: 12, due: true, engine: false }]
    assert.deepEqual(pick(base({ campaigns: many })).map(c => c.id), [10, 11])
    pass('giữ thứ tự chiến dịch của hàng đợi')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${checks} PASS`)
}

main().catch(err => { console.error(err); process.exitCode = 1 })
