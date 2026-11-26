// Quét thành viên nhóm Zalo không được ghi Global ID của chính nick đang xem vào zalo_users (đo 26/11/2026: Zalo trả Global ID của
// người xem trong hồ sơ thành viên nhóm). Chạy đường thật, không I/O production:
//  1. ZaloRuntimeService.getJoinedGroupMembers + quét link (mapZaloGroupMember) với API Zalo giả (getmg + /api/social/group/members
//     trả globalId = Global ID của nick đang xem, như production);
//  2. upsertZaloUsersForGroupMembers (repository ghi zalo_users) với Data API giả trong bộ nhớ.
// Mỗi phần chạy trên bản trước khi sửa (BASE_REF, mặc định f45d44c8 = dev_3 lúc sửa) và bản hiện tại: bản trước phải đỏ, bản mới xanh.
//   node scripts/zalo-group-member-global-id-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const baseline = process.env.BASE_REF || 'f45d44c8'
const VIEWER_GID = 'VIEWERGID0000000000000000000000A0'
const REAL_GID = 'REALGID00000000000000000000000B00'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-group-member-gid-'))

function sourceOf(relative, old) {
  if (!old) return fs.readFileSync(path.join(root, relative), 'utf8')
  try {
    return execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// ---- 1. Đường quét của ZaloRuntimeService (transpile + vm, mọi import khác là stub) ----
function loadRuntime(old) {
  const cache = new Map()
  const fallback = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : class {} })
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative)
    const source = sourceOf(relative, old)
    if (source === null) return null
    const exports = {}
    cache.set(relative, exports)
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    vm.runInNewContext(code, {
      exports, Error, Buffer, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
      queueMicrotask, console: { log() {}, warn() {}, error() {} },
      require: id => {
        if (id === './zaloGroupMemberMapping') return load('src/main/services/zaloGroupMemberMapping.ts') || fallback
        if (id.startsWith('node:') || id === 'crypto') return require(id)
        return fallback
      }
    }, { filename: path.join(root, relative) })
    return exports
  }
  return load('src/main/services/zaloRuntimeService.ts').ZaloRuntimeService
}

function fakeZaloApi({ groupId, memberIds, viewerGlobalId }) {
  const calls = []
  const api = {
    zpwServiceMap: { group: ['https://group.fixture'], profile: ['https://profile.fixture'] },
    custom(name, handler) {
      api[name] = props => handler({
        ctx: { imei: 'fixture-imei' },
        props,
        utils: {
          makeURL: url => url,
          encodeAES: text => text,
          request: async (url, init) => ({ url, params: JSON.parse(init.body.get('params')) }),
          resolve: async ({ url, params }) => {
            calls.push(url)
            if (url.endsWith('/api/group/getmg')) {
              return { gridInfoMap: { [groupId]: { groupId, name: 'Nhóm thử', creatorId: memberIds[0], adminIds: [], memberIds } } }
            }
            if (url.endsWith('/api/social/group/members')) {
              // Như production: mỗi hồ sơ mang globalId của chính nick đang xem.
              return {
                profiles: Object.fromEntries(params.friend_pversion_map.map(key => {
                  const id = key.replace(/_0$/, '')
                  return [key, { id, displayName: `Người ${id}`, zaloName: `Người ${id}`, globalId: viewerGlobalId, type: 0 }]
                }))
              }
            }
            throw new Error(`Unexpected Zalo call ${url}`)
          }
        }
      })
    }
  }
  return { api, calls }
}

async function runtimeChecks(old) {
  const ZaloRuntimeService = loadRuntime(old)
  const results = []
  const check = (label, fn) => {
    try { fn(); results.push({ label, ok: true }) } catch (error) { results.push({ label, ok: false, error: error.message }) }
  }
  const groupId = '6784869142295974592'
  const memberIds = Array.from({ length: 7 }, (_, index) => `16122276180319${String(index).padStart(3, '0')}`)
  const { api, calls } = fakeZaloApi({ groupId, memberIds, viewerGlobalId: VIEWER_GID })
  const service = new ZaloRuntimeService({}, async () => null, () => {})
  service.ensureApi = async () => api
  const result = await service.getJoinedGroupMembers(11, groupId)
  check('quét group đã tham gia gọi getmg và /api/social/group/members', () => {
    assert.ok(calls.some(url => url.endsWith('/api/group/getmg')))
    assert.ok(calls.some(url => url.endsWith('/api/social/group/members')))
    assert.equal(result.members.length, memberIds.length)
    // Mảng tạo trong vm khác realm: so qua JSON.
    assert.deepEqual(JSON.parse(JSON.stringify(result.members.map(member => member.zaloUid))), memberIds)
  })
  check('thành viên không mang Global ID của nick đang xem', () => {
    for (const member of result.members) assert.equal(member.globalId ?? null, null, `UID ${member.zaloUid} globalId=${member.globalId}`)
  })
  check('rawPayload của thành viên không còn globalId của nick đang xem', () => {
    for (const member of result.members) {
      assert.equal(member.rawPayload.globalId, undefined)
      assert.equal(member.rawPayload.source, 'profile')
      assert.equal(member.rawPayload.zaloGroupId, groupId)
    }
  })
  check('vai trò / tên giữ nguyên', () => {
    assert.equal(result.members[0].role, 'owner')
    assert.equal(result.members[1].role, 'member')
    assert.equal(result.members[1].displayName, `Người ${memberIds[1]}`)
  })
  // Trang link group: thành viên chỉ có globalId (không có id) không được thành Zalo ID.
  const linkMember = service.mapZaloGroupMember(groupId, { creatorId: '' }, { globalId: VIEWER_GID, dName: 'Không có id' }, 'link')
  check('hồ sơ chỉ có globalId không bị dùng làm Zalo ID', () => {
    assert.equal(linkMember.zaloUid, '')
    assert.equal(linkMember.globalId ?? null, null)
  })
  return results
}

// ---- 2. Repository ghi zalo_users (esbuild, Data API giả) ----
const existingRows = [
  // Đã có Global ID đúng (từ danh sách bạn bè / tra số).
  { id: 1, account_id: 11, staff_id: 7, zalo_uid: 'u-friend', display_name: 'Bạn', global_id: REAL_GID,
    raw_payload: { userId: 'u-friend', globalId: REAL_GID } },
  // Đã có, chưa có Global ID.
  { id: 2, account_id: 11, staff_id: 7, zalo_uid: 'u-empty', display_name: 'Trống', global_id: null, raw_payload: {} }
]

function fixtureDb() {
  const state = { writes: [] }
  const chain = (table, args) => {
    let payload
    const query = {
      select() { return query },
      eq() { return query },
      in() { return query },
      upsert(rows) { payload = rows; return query },
      then(resolve, reject) {
        let data = []
        if (payload) {
          state.writes.push({ table, payload: structuredClone(payload) })
          data = payload.map((row, index) => ({ ...row, id: 100 + index }))
        } else if (args) {
          data = existingRows.filter(row => row.account_id === args.p_account_id && row.staff_id === args.p_staff_id &&
            args.p_zalo_uids.includes(row.zalo_uid))
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      }
    }
    return query
  }
  state.db = {
    from: table => chain(table),
    rpc(name, args) {
      assert.equal(name, 'aka_agent_lookup_zalo_users')
      return chain('zalo_users', args)
    }
  }
  return state
}

async function compileRepository(old) {
  const relative = 'src/main/data/repositories/accountContactRepository.ts'
  const absolute = path.join(root, relative)
  const source = sourceOf(relative, old)
  const outfile = path.join(temporary, `repository-${old ? 'old' : 'new'}.cjs`)
  await build({
    stdin: { contents: `export { testGroupUsers } from './${relative}';`, resolveDir: root, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent',
    external: ['better-sqlite3'],
    plugins: [{ name: 'isolated-repository', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
      builder.onLoad({ filter: /[\\/]repositories[\\/]accountContactRepository\.ts$/ }, args =>
        args.path === absolute
          ? { contents: `${source}\nexport { upsertZaloUsersForGroupMembers as testGroupUsers };`, loader: 'ts' }
          : undefined)
      builder.onResolve({ filter: /\/(supabaseClient|currentUser)$/ }, args => ({
        path: args.path.endsWith('/supabaseClient') ? 'db' : 'auth', namespace: 'fixture'
      }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        contents: args.path === 'electron'
          ? 'export const app={on(){},getPath(){throw new Error("No filesystem runtime")}}; export const BrowserWindow={getAllWindows:()=>[]};'
          : args.path === 'db'
            ? 'export const getSupabaseClient=()=>globalThis.__groupGidDb; export const getSupabaseUrl=()=>{throw new Error("No live URL")};'
            : 'export const requireCurrentUser=()=>({staffId:7,organizationId:9}); export const getCurrentUser=requireCurrentUser; export const requireCurrentUserCredentials=()=>{throw new Error("No credentials")}; export const getCurrentUserCredentials=requireCurrentUserCredentials;',
        loader: 'js'
      }))
    } }]
  })
  return require(outfile)
}

async function repositoryChecks(old) {
  const { testGroupUsers } = await compileRepository(old)
  const results = []
  const check = (label, fn) => {
    try { fn(); results.push({ label, ok: true }) } catch (error) { results.push({ label, ok: false, error: error.message }) }
  }
  const scanned = uid => ({ zaloUid: uid, displayName: `Người ${uid}`, globalId: VIEWER_GID,
    rawPayload: { id: uid, globalId: VIEWER_GID, source: 'profile', zaloGroupId: 'g1' } })
  const many = Array.from({ length: 205 }, (_, index) => `u-new-${index}`)
  const state = fixtureDb()
  globalThis.__groupGidDb = state.db
  const ids = await testGroupUsers(11, [scanned('u-friend'), scanned('u-empty'), ...many.map(scanned)], 7, 9)
  const rows = state.writes.filter(write => write.table === 'zalo_users').flatMap(write => write.payload)
  const byUid = new Map(rows.map(row => [row.zalo_uid, row]))
  check('ghi đủ 207 dòng zalo_users, mỗi lô tối đa 100', () => {
    assert.equal(rows.length, 207)
    assert.ok(state.writes.every(write => write.payload.length <= 100))
    assert.equal(ids.size, 207)
  })
  check('không dòng nào mang Global ID của nick đang xem', () => {
    assert.deepEqual(rows.filter(row => row.global_id === VIEWER_GID).map(row => row.zalo_uid), [])
  })
  check('Global ID đúng đã có (bạn bè / tra số) không bị đè', () => {
    assert.equal(byUid.get('u-friend').global_id, REAL_GID)
    assert.deepEqual(byUid.get('u-friend').raw_payload, existingRows[0].raw_payload)
  })
  check('dòng mới / dòng chưa có Global ID để trống Global ID', () => {
    assert.equal(byUid.get('u-empty').global_id, null)
    assert.equal(byUid.get('u-new-0').global_id, null)
  })
  check('raw_payload của dòng mới không còn globalId của nick đang xem', () => {
    assert.equal(byUid.get('u-new-0').raw_payload.globalId, undefined)
    assert.equal(byUid.get('u-new-0').raw_payload.zaloGroupId, 'g1')
  })
  check('tên thành viên vẫn cập nhật từ lần quét', () => {
    assert.equal(byUid.get('u-friend').display_name, 'Người u-friend')
  })
  return results
}

async function main() {
  const report = {}
  for (const [label, old] of [['trước khi sửa', true], ['hiện tại', false]]) {
    report[label] = [...await runtimeChecks(old), ...await repositoryChecks(old)]
  }
  for (const [label, results] of Object.entries(report)) {
    console.log(`\n== ${label} (${baseline === 'f45d44c8' && label === 'trước khi sửa' ? 'f45d44c8' : label})`)
    for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label}${result.ok ? '' : ` — ${result.error.split('\n')[0]}`}`)
  }
  const before = report['trước khi sửa']
  const after = report['hiện tại']
  const failedBefore = before.filter(result => !result.ok).length
  const failedAfter = after.filter(result => !result.ok).length
  console.log(`\nTrước khi sửa: ${failedBefore}/${before.length} đỏ (phải > 0). Hiện tại: ${after.length - failedAfter}/${after.length} xanh.`)
  if (failedAfter > 0) throw new Error(`${failedAfter} kiểm tra đỏ trên bản hiện tại`)
  if (failedBefore === 0) throw new Error('Bản trước khi sửa không đỏ: bài kiểm không bắt được lỗi')
  console.log('PASS zalo-group-member-global-id-smoke')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
  .finally(() => fs.rmSync(temporary, { recursive: true, force: true }))
