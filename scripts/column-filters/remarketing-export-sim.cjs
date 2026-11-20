// Giả lập đường đọc "Chọn khách hàng cũ Zalo" của Desktop trên Postgres cục bộ (127.0.0.1:55421/column_filters, dữ liệu giả).
// Chạy code thật của src/main/data/filters/dataColumnReadService.ts (vòng đọc 500 dòng/trang, con trỏ, kiểm tổng / trùng id),
// chỉ thay supabase-js bằng lời gọi psql tới hàm aka_agent_read_filtered_remarketing_v1 đang cài ở DB cục bộ.
// Dùng để so V441 với V600 (scripts/build-v600-sql.cjs). Không trỏ tới production.
// Chạy: python3 scripts/column-filters/start-local.py && python3 scripts/column-filters/reset-local.py, cài hàm cần so, rồi
//   LC_ALL=C node scripts/column-filters/remarketing-export-sim.cjs
'use strict'
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const root = path.resolve(__dirname, '../..'), cache = new Map()
const PSQL = ['-X', '-qAt', '-h', '127.0.0.1', '-p', '55421', '-d', 'column_filters', '-v', 'ON_ERROR_STOP=1']
let rpcCalls = 0, rpcMs = 0

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = execFile('/opt/homebrew/bin/psql', PSQL, { maxBuffer: 256 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(new Error(stderr || error.message), { stderr })); else resolve(stdout)
    })
    child.stdin.end(sql)
  })
}

async function rpc(name, args) {
  assert.equal(name, 'aka_agent_read_filtered_remarketing_v1')
  const q = JSON.stringify(args.p_query).replace(/'/g, "''")
  const started = Date.now()
  try {
    const out = await psql(`SET ROLE anon; SET statement_timeout='60s'; SELECT public.${name}(${args.p_staff_id},${args.p_organization_id},'owner','fixture','${q}'::jsonb);`)
    return { data: JSON.parse(out), error: null }
  } catch (error) {
    const code = /statement timeout/.test(error.stderr || '') ? '57014' : 'P0001'
    return { data: null, error: { code, message: String(error.stderr || error.message).slice(0, 300) } }
  } finally { rpcCalls++; rpcMs += Date.now() - started }
}

function load(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename).exports
  const m = { exports: {} }; cache.set(filename, m)
  const requireLocal = id => {
    if (id.endsWith('/supabaseClient')) return { isTrustedServerSupabaseConfigured: () => true, getSupabaseClient: () => ({ rpc: (name, args) => ({ abortSignal: () => rpc(name, args) }) }) }
    if (id.endsWith('/repositories/dataGroupRepository')) return { mapDataGroupMember: row => row }
    if (id.endsWith('/repositories/localAccountContactRepository')) return { listFilteredPageInboxContacts: async () => ({ contacts: [], total: 0 }) }
    if (!id.startsWith('.')) return require(id)
    return load(path.relative(root, path.resolve(path.dirname(filename), id + '.ts')))
  }
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', js)(requireLocal, m, m.exports)
  return m.exports
}

const auth = load('src/main/data/currentUser.ts'), service = load('src/main/data/filters/dataColumnReadService.ts')
auth.setCurrentUser({ staffId: 10, organizationId: 1 }); auth.setCurrentUserCredentials({ username: 'owner', password: 'fixture' })
const allow = async () => {}
const request = query => ({ source: 'remarketing', accountId: 3, formId: 'sim', requestId: Math.random().toString(16).slice(2), query: { columnFilters: { version: 1, filters: [] }, ...query } })

async function run(label, query, mode) {
  rpcCalls = 0; rpcMs = 0
  const started = Date.now()
  try {
    const result = await service.executeColumnRead('sim', request(query), allow, mode)
    const ms = Date.now() - started
    const ids = mode === 'ids' ? result.ids : result.contacts.map(c => c.id)
    assert.equal(new Set(ids).size, ids.length, `${label}: trùng id`)
    if (mode !== 'ids' && result.contacts.length > 1) {
      for (let i = 1; i < result.contacts.length; i++) {
        const a = Date.parse(result.contacts[i - 1].extraData.latestSentAt), b = Date.parse(result.contacts[i].extraData.latestSentAt)
        assert.ok(a > b || (a === b && result.contacts[i - 1].id > result.contacts[i].id), `${label}: sai thứ tự ở dòng ${i}`)
      }
    }
    return { label, ok: true, total: result.total, rows: ids.length, rpcCalls, ms, rpcMs, md5: require('node:crypto').createHash('md5').update(JSON.stringify(mode === 'ids' ? result.ids : result.contacts)).digest('hex') }
  } catch (error) {
    return { label, ok: false, error: String(error.message).slice(0, 160), rpcCalls, ms: Date.now() - started }
  }
}

;(async () => {
  const fn = (await psql("SELECT md5(pg_get_functiondef('public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)'::regprocedure));")).trim()
  if (process.env.SIM_ONLY === 'range') { console.log(JSON.stringify(await run('chọn khoảng 1–2000', { offset: 0, limit: 2000 }, 'export'))); return }
  const first = await run('trang đầu 100 dòng', { limit: 100 }, 'page')
  const all = await run('chọn tất cả (xuất toàn bộ)', {}, 'export')
  const range = await run('chọn khoảng 1–2000', { offset: 0, limit: 2000 }, 'export')
  // Chọn từng dòng: lấy 2000 id đầu rồi xuất theo ids, như khi tích tay gần 2.000 dòng.
  const idsRead = await run('lấy id để chọn tay', { offset: 0, limit: 2000 }, 'ids')
  let picked = { label: 'chọn tay 2000 id', ok: false, error: 'không lấy được id' }
  if (idsRead.ok) {
    const ids = (await service.executeColumnRead('sim', request({ offset: 0, limit: 2000 }), allow, 'ids')).ids
    picked = await run('chọn tay 2000 id', { ids }, 'export')
  }
  const filtered = await run('chọn tất cả có lọc cột + tìm kiếm', { search: 'a', columnFilters: { version: 1, filters: [{ field: 'sentCount', op: 'gte', value: 1 }] } }, 'export')
  const out = { function: fn, cases: [first, all, range, idsRead, picked, filtered] }
  console.log(JSON.stringify(out, null, 1))
})().catch(error => { console.error(error); process.exitCode = 1 })
