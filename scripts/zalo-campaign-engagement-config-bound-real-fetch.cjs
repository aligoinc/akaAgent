#!/usr/bin/env node
// Log bước treo của lần đọc cấu hình theo dõi tương tác, đi qua supabase-js + fetch thật của Node (undici).
// Chạy bằng Node của Electron để giống App Server:
//   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/zalo-campaign-engagement-config-bound-real-fetch.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), http = require('node:http')
const ts = require('typescript'), { createClient } = require('@supabase/supabase-js')
const warnings = []
const capture = { ...console, warn: (...args) => { warnings.push(args); if (process.env.SHOW_LOGS) console.warn(...args) } }
function load(file, mocks = {}, edit = s => s) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(edit(fs.readFileSync(file, 'utf8')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: key => Object.hasOwn(mocks, key) ? mocks[key] : require(key), console: capture, Buffer, AbortSignal, Date, setTimeout, clearTimeout, performance }, { filename: file })
  return module.exports
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const server = http.createServer((req, res) => {
  const mode = req.headers['x-test-mode']
  if (mode === 'silent') return // không bao giờ trả lời
  if (mode === 'slow-body') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '500' }); res.write('[{"key":"'); return }
  res.setHeader('content-type', 'application/json'); res.end('[]')
})
const sockets = new Set(); server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })

async function run(mode, { stuckBeforeFetch = false } = {}) {
  const base = `http://127.0.0.1:${server.address().port}`
  const client = createClient(base, 'sb_secret_' + 'x'.repeat(32), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-test-mode': mode }, ...(stuckBeforeFetch ? { fetch: () => new Promise(() => {}) } : {}) }
  })
  // Giới hạn 30 giây của bản chạy rút xuống 6 giây (vẫn sau tín hiệu huỷ 5 giây) cho bài kiểm.
  const shared = load('src/shared/zaloCampaignEngagement.ts', {}, s => s.replace('ENGAGEMENT_CONFIG_READ_MAX_MS = 30_000', 'ENGAGEMENT_CONFIG_READ_MAX_MS = 6_000'))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-real-'))
  const api = load('src/main/services/zaloCampaignEngagement.ts', {
    electron: { app: { getPath: () => directory } },
    '../data/currentUser': { getCurrentUser: () => ({ staffId: 1, organizationId: 1 }), getCurrentUserCredentials: () => undefined },
    '../data/supabaseClient': { getSupabaseClient: () => client },
    '../data/repositories/runtimeClockRepository': { peekDatabaseRuntimeClock: () => ({ dbNow: new Date().toISOString() }) },
    '../../shared/zaloCampaignEngagement': shared
  })
  const before = warnings.length
  api.campaignEngagementEnabled()
  await wait(7_000)
  fs.rmSync(directory, { recursive: true, force: true })
  return warnings.slice(before).map(([line, detail]) => ({ line, ...detail }))
}

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const silent = await run('silent')
  const slowBody = await run('slow-body')
  const beforeFetch = await run('ok', { stuckBeforeFetch: true })
  for (const s of sockets) s.destroy(); server.close()
  const result = { node: process.versions.node, electron: process.versions.electron || null, silent, slowBody, beforeFetch }
  console.log(JSON.stringify(result, null, 1))
  const failed = silent.find(w => w.line === '[ZaloEngagement] config read failed')
  assert.ok(failed, 'không trả lời: lần đọc phải hết hạn bằng tín hiệu huỷ 5 giây và ghi log')
  assert.equal(failed.call, 'config'); assert.ok(failed.requestMs !== null && failed.sentMs !== null, 'request đã tạo và đã gửi')
  assert.equal(failed.responseMs, null); assert.ok(failed.abortMs >= 4_900 && failed.errorMs >= 4_900)
  const body = slowBody.find(w => w.line === '[ZaloEngagement] config read failed')
  assert.ok(body && body.responseMs !== null && body.status === 200 && body.bodyDoneMs === null, 'có trả lời nhưng chưa đọc xong nội dung')
  const stalled = beforeFetch.find(w => w.line === '[ZaloEngagement] config read stalled; giving up on it')
  assert.ok(stalled, 'kẹt trước khi tới fetch: giới hạn phải thả lần đọc')
  assert.equal(stalled.requestMs, null, 'chưa tạo request nào'); assert.ok(stalled.abortMs >= 4_900, 'tín hiệu huỷ đã bắn mà lần đọc vẫn treo')
  assert.ok(!silent.concat(slowBody).some(w => w.line.includes('stalled')), 'request thật tự hết hạn ở 5 giây, không tới giới hạn')
  console.log('PASS: log ghi đúng bước của lần đọc: không trả lời, trả lời dở nội dung, kẹt trước khi gửi request')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
