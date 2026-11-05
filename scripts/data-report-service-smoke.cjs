// Smoke test of the Desktop "Báo cáo dữ liệu" service (no DB): RPC contract, cache, phone guard, access, error codes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const stubs = {
  currentUser: `
    export const requireCurrentUser = () => globalThis.__user
    export const requireCurrentUserCredentials = () => ({ username: 'fixture-user', password: 'fixture-password' })
    export const runWithCurrentUser = (_user, operation) => operation()`,
  supabaseClient: `
    export const getSupabaseClient = () => ({ rpc: (name, params) => ({ abortSignal: signal => globalThis.__rpc(name, params, signal) }) })`,
  entitlementRepository: `
    export const loadCurrentUserEffectiveEntitlements = async () => globalThis.__entitlements
    export const canUseAccountPlatformWithEntitlements = (platform, entitlements) => entitlements.includes(platform)`
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-report-'))
  try {
    await build({
      entryPoints: [path.resolve(__dirname, '../src/main/services/dataReportService.ts')], outfile: path.join(dir, 'service.cjs'),
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{
        name: 'stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /(^|\/)(currentUser|supabaseClient|entitlementRepository)$/ }, args => ({
            path: args.path.split('/').pop(), namespace: 'stub'
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
        }
      }]
    })
    const service = require(path.join(dir, 'service.cjs'))
    // Minimal V465 shapes; the shared contract fills the rest with zeros.
    const payload = { version: 1, reportDate: '2026-10-31', store: { store: 8, bySource: { member: 2, phone: 4, friend: 2 } } }
    const journey = { found: true, phone: '0987654321', name: 'Khoa', customer: { careCount: 2 }, events: [], dataGroups: [] }
    const calls = []
    let answer = () => ({ data: null, error: null })
    globalThis.__user = { staffId: 7, organizationId: 9 }
    globalThis.__entitlements = ['zalo']
    globalThis.__rpc = async (name, params, signal) => {
      assert.equal(name, 'aka_agent_read_data_report')
      assert.ok(signal instanceof AbortSignal)
      assert.equal(params.p_staff_id, globalThis.__user.staffId)
      assert.equal(params.p_organization_id, globalThis.__user.organizationId)
      assert.equal(params.p_auth_username, 'fixture-user')
      assert.equal(params.p_auth_password, 'fixture-password')
      calls.push(params.p_query)
      return answer(params.p_query)
    }

    answer = () => ({ data: { reportDate: '2026-10-31', builtAt: '2026-10-31T19:02:00Z', payload }, error: null })
    const first = await service.handleDataReportRequest({ kind: 'snapshot' })
    assert.equal(first.ok, true)
    assert.equal(first.data.status, 'ready')
    assert.equal(first.data.payload.store.store, 8)
    const second = await service.handleDataReportRequest({ kind: 'snapshot' })
    assert.equal(second.data, first.data, 'snapshot reused for 10 minutes')
    assert.deepEqual(calls, [{ mode: 'snapshot' }])

    for (const phone of [undefined, '', 'abc', '12345', '0912; drop', '0'.repeat(25)]) {
      const result = await service.handleDataReportRequest({ kind: 'journey', phone })
      assert.deepEqual(result, { ok: false, code: 'invalid_report_query', message: 'Số điện thoại không hợp lệ.' })
    }
    assert.equal(calls.length, 1, 'invalid phones never read')
    answer = () => ({ data: journey, error: null })
    const found = await service.handleDataReportRequest({ kind: 'journey', phone: ' 0987 654 321 ' })
    assert.equal(found.ok, true)
    assert.equal(found.data.found, true)
    assert.deepEqual(calls.at(-1), { mode: 'journey', phone: '0987 654 321' })

    globalThis.__user = { staffId: 8, organizationId: 9 }
    answer = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.aka_agent_read_data_report' } })
    assert.deepEqual(await service.handleDataReportRequest({ kind: 'snapshot' }),
      { ok: false, code: 'data_report_not_ready', message: 'Báo cáo dữ liệu đang được cập nhật. Vui lòng thử lại sau.' })
    answer = () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
    assert.equal((await service.handleDataReportRequest({ kind: 'journey', phone: '0912345678' })).code, 'report_timeout')
    answer = () => ({ data: { reportDate: null, builtAt: null, payload: null }, error: null })
    assert.deepEqual((await service.handleDataReportRequest({ kind: 'snapshot' })).data, { status: 'preparing', reportDate: null, builtAt: null, payload: null })

    const before = calls.length
    globalThis.__user = { staffId: 9, organizationId: 9 }
    globalThis.__entitlements = ['facebook', 'email']
    assert.deepEqual(await service.handleDataReportRequest({ kind: 'snapshot' }),
      { ok: false, code: 'capability_required', message: 'Không có quyền xem báo cáo này.' })
    globalThis.__entitlements = ['sms']
    assert.equal((await service.handleDataReportRequest({ kind: 'snapshot' })).ok, true)
    assert.equal(calls.length, before + 1, 'no read without Zalo or SMS')
    assert.equal((await service.handleDataReportRequest({ kind: 'other' })).code, 'invalid_report_query')
    console.log('PASS data report service: RPC contract with Desktop credentials, 10-minute snapshot reuse, phone guard before reads, Zalo/SMS access, stable error codes')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
