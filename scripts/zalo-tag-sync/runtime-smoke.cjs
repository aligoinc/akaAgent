// Kiểm phần chạy của sổ tag Zalo (zaloTagSyncRuntime.ts) với DB và Zalo giả. Cách chạy: node scripts/zalo-tag-sync/runtime-smoke.cjs
const path = require('path')
const esbuild = require('esbuild')
const assert = require('assert')
const root = path.resolve(__dirname, '../..')
const out = esbuild.buildSync({ entryPoints: [path.join(root, 'src/main/services/zaloTagSyncRuntime.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false })
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { ZaloTagSyncRuntime } = mod.exports

let n = 0
const ok = (cond, label) => { assert.ok(cond, label); n++; console.log('PASS:', label) }

function setup(opts = {}) {
  const state = { now: 0, calls: [], loads: 0, reads: 0,
    accounts: opts.accounts ?? { enabled: true, pollSeconds: 60, accountIds: [100, 200] },
    labels: { 100: { version: '1', labels: [{ id: 5, text: 'VIP', conversations: ['901', 'g55', '', 'x'] }] }, 200: null },
    db: { 100: null } }
  const rt = new ZaloTagSyncRuntime({
    now: () => state.now,
    loadAccounts: async () => { state.loads++; if (opts.loadFails) throw new Error('db down'); return state.accounts },
    readLabels: async id => { state.reads++; return state.labels[id] },
    sync: async items => {
      state.calls.push(items)
      if (opts.disabledAfter && state.calls.length >= opts.disabledAfter) return { enabled: false }
      const need = []; const rejected = []
      for (const item of items) {
        if (opts.reject?.includes(Number(item.a))) { rejected.push(item.a); continue }
        if (item.tags) { state.db[item.a] = item.v; continue }
        if (state.db[item.a] !== item.v) need.push(item.a)
      }
      return { enabled: true, pollSeconds: 60, needTags: need, rejected, baselined: [], added: 0, removed: 0, campaignRows: 0 }
    },
    warn: () => {}
  })
  return { rt, state }
}

;(async () => {
  let { rt, state } = setup()
  await rt.tick()
  ok(state.loads === 1, 'đọc danh sách tài khoản')
  ok(state.calls.length === 2 && !state.calls[0][0].tags && state.calls[0].length === 1, 'nhịp đầu: một lô phiên bản, bỏ tài khoản không có phiên')
  ok(state.calls[1][0].tags?.[0]?.m?.join(',') === '901,g55' && state.calls[1][0].tags[0].name === 'VIP', 'DB xin thì gửi cả danh sách tag, lọc mã hỏng')
  state.calls = []
  await rt.tick()
  ok(state.calls.length === 1 && state.loads === 1, 'phiên bản không đổi: một lời gọi, không đọc lại danh sách tài khoản')
  state.labels[100] = { version: '2', labels: [] }
  state.calls = []
  await rt.tick()
  ok(state.calls.length === 2 && state.calls[1][0].v === '2', 'phiên bản đổi: gửi danh sách mới')
  state.now += 2 * 60_000
  await rt.tick()
  ok(state.loads === 2, 'sau 2 phút đọc lại danh sách tài khoản')
  rt.refreshSoon(); await rt.tick()
  ok(state.loads === 3, 'refreshSoon đọc lại ngay')

  ;({ rt, state } = setup({ accounts: { enabled: false, pollSeconds: 60, accountIds: [100] } }))
  await rt.tick()
  ok(state.calls.length === 0 && state.reads === 0, 'tắt: không đọc Zalo, không gọi DB')

  ;({ rt, state } = setup({ reject: [100] }))
  await rt.tick(); state.calls = []; state.reads = 0
  await rt.tick()
  ok(state.reads === 1 && state.calls.length === 0, 'bị từ chối thì ngừng hỏi tài khoản đó (chỉ còn đọc tài khoản 200)')

  ;({ rt, state } = setup({ loadFails: true }))
  await rt.tick()
  ok(state.calls.length === 0, 'không đọc được danh sách thì không làm gì, không ném lỗi')

  ;({ rt, state } = setup({ disabledAfter: 1 }))
  await rt.tick(); state.calls = []; state.reads = 0
  await rt.tick()
  ok(state.calls.length === 0 && state.reads === 0, 'DB báo tắt giữa chừng thì ngừng')

  const many = { enabled: true, pollSeconds: 60, accountIds: Array.from({ length: 450 }, (_, i) => i + 1) }
  ;({ rt, state } = setup({ accounts: many }))
  for (const id of many.accountIds) state.labels[id] = { version: '1', labels: [] }
  await rt.tick()
  ok(state.calls.filter(c => !c[0].tags).length === 3 && Math.max(...state.calls.map(c => c.length)) === 200, 'lô tối đa 200 tài khoản')
  console.log(`ALL PASS (${n})`)
})().catch(e => { console.error('FAIL', e); process.exit(1) })
