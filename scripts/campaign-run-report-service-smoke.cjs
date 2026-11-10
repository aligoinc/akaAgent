// Smoke test of the Desktop campaign detail "Báo cáo" service (no DB): RPC contract, real V487 JSON shapes,
// usesInputData, action names, catalog cache/fallback, error codes, in-flight dedupe, busy gate and deadline.
// Run: node scripts/campaign-run-report-service-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

// Two RPC results returned by production V487 on 10/11/2026 (campaign ids replaced; counts only, no customer data):
// Facebook "Đăng bài vào nhóm" and Zalo "Nhắn tin theo SĐT" with Tìm SĐT, Gắn tag, Đổi tên and Kết bạn.
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/campaign-run-report-rpc-samples.json'), 'utf8'))

const stubs = {
  currentUser: `
    export const requireCurrentUser = () => { if (!globalThis.__user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi thao tác dữ liệu.'); return globalThis.__user }
    export const requireCurrentUserCredentials = () => ({ username: 'fixture-user', password: 'fixture-password' })
    export const runWithCurrentUser = (_user, operation) => operation()`,
  supabaseClient: `
    function builder(table, calls) {
      const state = { table, filters: [], maybeSingle: false }
      const self = {
        select(columns) { state.columns = columns; return self },
        eq(column, value) { state.filters.push(['eq', column, value]); return self },
        gt(column, value) { state.filters.push(['gt', column, value]); return self },
        order() { return self }, limit() { return self },
        abortSignal(signal) { state.signal = signal; return self },
        maybeSingle() { state.maybeSingle = true; return self },
        then(resolve, reject) { calls.push(state); return Promise.resolve(globalThis.__table(state)).then(resolve, reject) }
      }
      return self
    }
    export const getSupabaseClient = () => ({
      from: table => builder(table, globalThis.__calls),
      rpc: (name, params) => ({ abortSignal: signal => globalThis.__rpc(name, params, signal) })
    })`,
  reportReadRpc: 'export const REPORT_READ_TIMEOUT_MS = globalThis.__deadlineMs || 65000'
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-run-report-'))
  try {
    await build({
      entryPoints: [path.resolve(__dirname, '../src/main/services/campaignRunReportService.ts')], outfile: path.join(dir, 'service.cjs'),
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{
        name: 'stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /(^|\/)(currentUser|supabaseClient|reportReadRpc)$/ }, args => ({
            path: args.path.split('/').pop(), namespace: 'stub'
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
        }
      }]
    })
    globalThis.__deadlineMs = 300
    const outfile = path.join(dir, 'service.cjs')
    // A fresh module instance has an empty status-catalog cache.
    const freshService = () => { delete require.cache[require.resolve(outfile)]; return require(outfile) }
    let service = freshService()
    let passed = 0
    const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

    const campaigns = new Map(samples.map(sample => [sample.id, {
      id: sample.id, action_id: sample.actionId, extra_settings: sample.extra, primary_account: { flatform_type: sample.platform }
    }]))
    const rpcs = new Map(samples.map(sample => [sample.id, sample.rpc]))
    const statuses = [
      ...new Map(samples.flatMap(sample => sample.rpc.statuses).map(status => [status.id, status])).values()
    ].map(status => ({ id: status.id, name: status.name, status_value: status.statusValue, flatform_type: 'all',
      component_type: 'campaign_detail', is_active: true, is_delete: false }))
    let catalogFails = false
    let rpcCalls = []
    globalThis.__user = { staffId: 7, organizationId: 9 }
    globalThis.__calls = []
    globalThis.__table = state => {
      if (state.table === 'auto_campaigns') {
        const id = state.filters.find(filter => filter[1] === 'id')[2]
        assert.deepEqual(state.filters.filter(filter => filter[1] !== 'id'),
          [['eq', 'staff_id', 7], ['eq', 'organization_id', 9], ['eq', 'is_delete', false]])
        assert.equal(state.maybeSingle, true)
        return { data: campaigns.get(id) ?? null, error: null }
      }
      if (catalogFails) return { data: null, error: { message: 'boom' } }
      if (state.table === 'auto_status') return { data: state.filters.some(filter => filter[0] === 'gt') ? [] : statuses, error: null }
      if (state.table === 'auto_campaign_action_detail_statuses') return { data: [], error: null }
      if (state.table === 'auto_campaign_actions') return { data: [{ id: 'zalo_message_phone', is_active: true, is_delete: false }], error: null }
      throw new Error(`unexpected table ${state.table}`)
    }
    const rpcResponse = { mode: 'data' }
    globalThis.__rpc = async (name, params, signal) => {
      rpcCalls.push({ name, params })
      if (rpcResponse.mode === 'error') return { data: null, error: rpcResponse.error }
      if (rpcResponse.mode === 'hang') {
        return new Promise(resolve => signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'TimeoutError: aborted', code: '' } }), { once: true }))
      }
      if (rpcResponse.mode === 'slow') await new Promise(resolve => setTimeout(resolve, 60))
      if (rpcResponse.mode === 'raw') return { data: rpcResponse.data, error: null }
      return { data: JSON.parse(JSON.stringify(rpcs.get(params.p_campaign_id))), error: null }
    }

    // 1. Zalo campaign: RPC parameters and totals equal the V487 JSON in every block.
    let result = await service.handleCampaignRunReportRequest({ campaignId: 102 })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].name, 'aka_agent_read_campaign_run_report')
    assert.deepEqual(Object.keys(rpcCalls[0].params).sort(),
      ['p_auth_password', 'p_auth_username', 'p_campaign_id', 'p_organization_id', 'p_query', 'p_staff_id'])
    assert.equal(rpcCalls[0].params.p_staff_id, 7)
    assert.equal(rpcCalls[0].params.p_organization_id, 9)
    assert.equal(rpcCalls[0].params.p_campaign_id, 102)
    assert.equal(rpcCalls[0].params.p_auth_username, 'fixture-user')
    assert.deepEqual(rpcCalls[0].params.p_query.auxiliaryActionCodes, ['zalo_find_phone_user', 'zalo_tag_contact', 'zalo_change_alias'])
    ok('RPC gọi bằng staff/tổ chức/mật khẩu tự động hóa và query hợp đồng')
    const zaloRpc = rpcs.get(102)
    const zalo = result.data
    const sum = values => values.reduce((total, value) => total + value, 0)
    const resultTotal = sum(zaloRpc.results.groups.map(group => group.count))
    const inputTotal = sum(zaloRpc.inputs.map(row => row.count))
    assert.equal(zalo.results.total, resultTotal)
    assert.equal(zalo.inputs.total, inputTotal)
    assert.equal(sum(zalo.actions.map(action => action.total)), resultTotal)
    assert.equal(sum(Object.values(zalo.results.groups)), resultTotal)
    assert.equal(sum(zalo.timeline.points.map(point => point.total)), resultTotal)
    assert.equal(sum(zalo.inputs.byStatus.map(status => status.count)), inputTotal)
    assert.equal(sum(zalo.inputs.matrix.map(row => row.total)), inputTotal)
    assert.equal(zalo.usesInputData, true)
    ok('Zalo: tổng lượt/data khớp ở mọi khối (hành động, nhóm, thời gian, trạng thái data, ma trận)')
    const names = Object.fromEntries(zalo.actions.map(action => [action.code, action]))
    for (const code of ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend', 'zalo_tag_contact', 'zalo_change_alias']) {
      assert.ok(names[code], `missing ${code}`)
    }
    assert.equal(names.zalo_find_phone_user.auxiliary, true)
    assert.equal(names.zalo_tag_contact.auxiliary, true)
    assert.equal(names.zalo_message_stranger.auxiliary, false)
    assert.ok(zalo.actions.every(action => action.name && !/^zalo_/.test(action.name)), 'every action has a Vietnamese name')
    assert.ok(zalo.engagement === null || zalo.engagement.message.sent === zaloRpc.engagement.messageSent)
    ok('Zalo: hành động cấu hình gồm Tìm SĐT/Gắn tag/Đổi tên (phụ) và tên tiếng Việt')

    // 2. Facebook group post: data campaign; catalog from cache (no second status read).
    globalThis.__calls = []
    result = await service.handleCampaignRunReportRequest({ campaignId: 101 })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(globalThis.__calls.filter(call => call.table === 'auto_status').length, 0)
    const fbRpc = rpcs.get(101)
    assert.equal(result.data.results.total, sum(fbRpc.results.groups.map(group => group.count)))
    assert.equal(result.data.inputs.total, sum(fbRpc.inputs.map(row => row.count)))
    assert.equal(result.data.usesInputData, true)
    assert.ok(result.data.actions.some(action => action.code === 'fb_post_group'))
    ok('Facebook đăng nhóm: dùng data, tổng khớp, danh mục trạng thái lấy từ cache 5 phút')

    // 3. Facebook timeline post has no input data; any campaign without data but with results shows the per-run layout.
    campaigns.set(103, { id: 103, action_id: 'facebook_timeline_post', extra_settings: {}, primary_account: { flatform_type: 'facebook' } })
    rpcs.set(103, { ...fbRpc, campaign: { ...fbRpc.campaign, id: 103 } })
    result = await service.handleCampaignRunReportRequest({ campaignId: 103 })
    assert.equal(result.ok, true)
    assert.equal(result.data.usesInputData, false)
    campaigns.set(104, { id: 104, action_id: 'facebook_comment_seeding', extra_settings: {}, primary_account: { flatform_type: 'facebook' } })
    rpcs.set(104, { ...fbRpc, campaign: { ...fbRpc.campaign, id: 104 }, inputs: [], inputOutcomes: [] })
    result = await service.handleCampaignRunReportRequest({ campaignId: 104 })
    assert.equal(result.ok, true)
    assert.equal(result.data.usesInputData, false)
    ok('Không có data đầu vào (đăng trang cá nhân, hoặc 0 data mà có kết quả): bố cục theo lượt')

    // 4. Catalog failure still builds the report with stored status names.
    service = freshService()
    catalogFails = true
    campaigns.set(105, { ...campaigns.get(102), id: 105 })
    rpcs.set(105, { ...zaloRpc, campaign: { ...zaloRpc.campaign, id: 105 } })
    result = await service.handleCampaignRunReportRequest({ campaignId: 105 })
    catalogFails = false
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.data.results.total, resultTotal)
    ok('Không tải được danh mục trạng thái: vẫn dựng báo cáo bằng tên đã ghi')

    // 5. Error mapping (Vietnamese messages, no SQL).
    const expectError = async (campaignId, code, mutate) => {
      if (mutate) mutate()
      const response = await service.handleCampaignRunReportRequest({ campaignId })
      rpcResponse.mode = 'data'
      assert.equal(response.ok, false, JSON.stringify(response))
      assert.equal(response.code, code, JSON.stringify(response))
      assert.ok(!/select|function|rpc|aka_agent/i.test(response.message), response.message)
      return response
    }
    await expectError(0, 'invalid_campaign_id')
    await expectError(999, 'campaign_not_found')
    await expectError(102, 'campaign_report_not_ready', () => Object.assign(rpcResponse, { mode: 'error', error: { code: 'PGRST202', message: 'Could not find the function' } }))
    await expectError(102, 'campaign_report_not_ready', () => Object.assign(rpcResponse, { mode: 'error', error: { code: '42501', message: 'permission denied for function aka_agent_read_campaign_run_report' } }))
    await expectError(102, 'report_access_denied', () => Object.assign(rpcResponse, { mode: 'error', error: { code: '42501', message: 'desktop_staff_scope_denied' } }))
    await expectError(102, 'campaign_not_found', () => Object.assign(rpcResponse, { mode: 'error', error: { code: 'P0002', message: 'campaign_report_not_found' } }))
    await expectError(102, 'report_timeout', () => Object.assign(rpcResponse, { mode: 'error', error: { code: '57014', message: 'canceling statement due to statement timeout' } }))
    await expectError(102, 'session_invalid', () => Object.assign(rpcResponse, { mode: 'error', error: { code: 'P0001', message: 'automation_auth_invalid' } }))
    await expectError(102, 'campaign_report_unavailable', () => Object.assign(rpcResponse, { mode: 'raw', data: [] }))
    const saved = globalThis.__user
    globalThis.__user = null
    await expectError(102, 'session_invalid')
    globalThis.__user = saved
    ok('Mã lỗi: chưa có hàm/chưa cấp quyền = đang cập nhật; quyền, không thấy, quá giờ, phiên, dữ liệu hỏng')

    // 6. Same campaign twice in flight = one RPC; a third distinct read while two run = busy (no queue).
    rpcCalls = []
    rpcResponse.mode = 'slow'
    const [first, second] = await Promise.all([
      service.handleCampaignRunReportRequest({ campaignId: 102 }),
      service.handleCampaignRunReportRequest({ campaignId: 102 })
    ])
    assert.equal(first.ok && second.ok, true)
    assert.equal(rpcCalls.length, 1)
    rpcResponse.mode = 'slow'
    const three = await Promise.all([101, 102, 105].map(campaignId => service.handleCampaignRunReportRequest({ campaignId })))
    rpcResponse.mode = 'data'
    assert.deepEqual(three.map(response => response.ok), [true, true, false])
    assert.equal(three[2].code, 'report_busy')
    ok('Gộp lượt trùng; quá 2 lượt khác nhau thì báo bận, không xếp hàng')

    // 7. Whole-read deadline (65 s in production, shortened here).
    // AbortSignal.timeout uses an unref'd timer: keep this script's event loop alive (Electron's main loop always is).
    const keepAlive = setTimeout(() => {}, 10_000)
    const timedOut = await expectError(102, 'report_timeout', () => { rpcResponse.mode = 'hang' })
    clearTimeout(keepAlive)
    assert.match(timedOut.message, /Chiến dịch quá lớn/)
    ok('Hết hạn cả lượt đọc: báo quá giờ, không treo')

    console.log(`campaign run report service smoke: ${passed}/${passed} passed`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
