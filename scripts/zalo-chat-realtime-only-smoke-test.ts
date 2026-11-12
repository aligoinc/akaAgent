// Smoke: tổ chức không Chat có tài khoản Zalo Server chạy trên Fly (V498). App Server đã thả tổ chức, nên Desktop dùng ChatApi
// cho tài khoản Server như tổ chức có Chat: kênh tiến trình realtime, kiểm phiên, quét data (nhãn…), đăng xuất. Runtime cục bộ
// vẫn chỉ cho tổ chức có Chat. (Tên file giữ từ bản đầu chỉ nghe realtime.)
// Chạy: node scripts/run-zalo-chat-realtime-only-smoke-test.cjs
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

import { IPC_EVENTS, type AuthUser } from '../src/shared/types'

const STAFF_ID = 547
const ORG_ID = 526

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    staffId: STAFF_ID,
    organizationId: ORG_ID,
    name: 'QN server',
    username: 'qn',
    organizationName: 'Tổ chức thử',
    isAdminAkabiz: false,
    useTestWorkflow: false,
    isZaloServer: true,
    isZaloShowWeb: false,
    zaloAccountCapabilities: { qr: true, web: false, server: true },
    entitlements: { zalo: true } as AuthUser['entitlements'],
    accountProducts: [],
    isChatSync: false,
    zaloServerOnFly: true,
    ...overrides
  } as AuthUser
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

async function main(): Promise<void> {
  // Máy chủ ChatApi giả: cấp phiên Desktop và kênh realtime /ws, cùng hợp đồng với ChatApi.
  const sessionRequests: Array<Record<string, unknown>> = []
  const scanSessionRequests: Array<Record<string, unknown>> = []
  const apiCalls: string[] = []
  const http = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', chunk => { body += String(chunk) })
    request.on('end', () => {
      const json = (status: number, value: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value))
      }
      const session = (token: string) => ({ token, expiresAt: new Date(Date.now() + 600_000).toISOString(),
        staffId: String(STAFF_ID), organizationId: String(ORG_ID) })
      if (request.method === 'POST' && request.url === '/api/chat/desktop/session') {
        sessionRequests.push(JSON.parse(body) as Record<string, unknown>)
        return json(200, session('desktop-token'))
      }
      if (request.method === 'POST' && request.url === '/api/chat/desktop/data-scan-session') {
        scanSessionRequests.push(JSON.parse(body) as Record<string, unknown>)
        return json(200, session('scan-token'))
      }
      apiCalls.push(`${request.method} ${request.url} ${request.headers.authorization ?? ''}`)
      if (request.method === 'GET' && request.url === '/api/chat/zalo/accounts') {
        return json(200, [{ autoAccountId: '2445', loginStatusCode: 'logged_in', loginStatusName: 'Đã đăng nhập',
          socketStatusCode: 'connected', socketStatusName: 'Đã kết nối', sessionLastError: null }])
      }
      if (request.method === 'POST' && request.url === '/api/chat/zalo/accounts/2445/data-scan-queries') {
        const parsed = JSON.parse(body) as { requestId: string; queryType: string }
        return json(202, { requestId: parsed.requestId, autoAccountId: '2445', queryType: parsed.queryType,
          status: 'succeeded', result: [{ id: 7, text: 'Khách VIP', conversations: ['u1', 'u1', 'u2'] }] })
      }
      if (request.method === 'POST' && request.url === '/api/chat/zalo/accounts/2445/logout') {
        return json(200, { success: true, loggedIn: false, status: 'chưa đăng nhập', autoAccountId: '2445' })
      }
      json(404, { error: 'not_found', message: 'không có' })
    })
  })
  const sockets: WebSocket[] = []
  const authenticated: string[] = []
  const wss = new WebSocketServer({ server: http, path: '/ws' })
  wss.on('connection', socket => {
    sockets.push(socket)
    socket.on('message', raw => {
      const message = JSON.parse(String(raw)) as { type?: string; token?: string }
      if (message.type !== 'authenticate') return
      authenticated.push(String(message.token))
      socket.send(JSON.stringify({ type: 'hello', snapshot: { startedAt: 'server-1' }, events: [] }))
    })
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()))
  const { port } = http.address() as AddressInfo
  process.env.AKA_AGENT_CHAT_API_URL = `http://127.0.0.1:${port}`
  // Nạp client sau khi đặt địa chỉ ChatApi giả (constructor đọc biến môi trường).
  const { ZaloChatApiClient, isServerOnFlyRealtimeUser, serverAccountsUseChatApi } = await import('../src/main/services/zaloChatApiClient')

  let checks = 0
  const pass = (label: string): void => { checks++; console.log('PASS', label) }
  try {
    assert.equal(isServerOnFlyRealtimeUser(user()), true)
    assert.equal(isServerOnFlyRealtimeUser(user({ zaloServerOnFly: undefined })), false)
    assert.equal(isServerOnFlyRealtimeUser(user({ zaloServerOnFly: false })), false)
    assert.equal(isServerOnFlyRealtimeUser(user({ isChatSync: true })), false, 'tổ chức có Chat dùng đường đầy đủ như cũ')
    assert.equal(isServerOnFlyRealtimeUser(user({ zaloAccountCapabilities: { qr: true, web: false, server: false } })), false)
    assert.equal(isServerOnFlyRealtimeUser(user({ entitlements: { zalo: false } as AuthUser['entitlements'] })), false)
    assert.equal(isServerOnFlyRealtimeUser(user({ appAccess: { separateAccess: true } as AuthUser['appAccess'] })), false)
    assert.equal(serverAccountsUseChatApi(user()), true)
    assert.equal(serverAccountsUseChatApi(user({ isChatSync: true, zaloServerOnFly: undefined })), true, 'tổ chức có Chat')
    assert.equal(serverAccountsUseChatApi(user({ zaloServerOnFly: false })), false, 'tổ chức còn trên App Server')
    assert.equal(serverAccountsUseChatApi(null), false)
    pass('chỉ tổ chức có Chat hoặc tổ chức không Chat được báo đang chạy trên Fly mới đưa tài khoản Server sang ChatApi')

    const events: Array<{ channel: string; payload: unknown }> = []
    let refreshes = 0
    const client = new ZaloChatApiClient(() => undefined, event => { events.push(event) }, () => { refreshes++ })
    client.start(user(), 'qn', 'secret')
    assert.equal(client.isEnabled(), false, 'không phải tổ chức có Chat')
    assert.equal(client.isServerOnFlyOnly(), true)
    assert.equal(client.serverAccountsUseChatApi(), true)
    await waitFor(() => authenticated.length === 1, 'xác thực kênh realtime')
    assert.deepEqual(sessionRequests[0], { username: 'qn', password: 'secret', organizationId: ORG_ID })
    assert.equal(authenticated[0], 'desktop-token')
    await waitFor(() => refreshes === 1, 'làm mới dữ liệu khi vừa nối')
    pass('đăng nhập: lấy phiên Desktop của ChatApi rồi nối /ws, làm mới dữ liệu một lần như tổ chức có Chat')

    const send = (sequence: number, staffId: number, organizationId: number, channel: string, payload: unknown): void => {
      sockets[0].send(JSON.stringify({ type: 'runtime-event', event: {
        sequence, timestamp: new Date().toISOString(), staffId, organizationId, channel, payload } }))
    }
    send(1, STAFF_ID, ORG_ID, IPC_EVENTS.CAMPAIGN_LOG, { campaignId: 9150, message: '▶️ Xử lý - 0xxxxxx423' })
    send(2, STAFF_ID, ORG_ID, IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, { campaignId: 9150, status: 'đang chạy' })
    send(3, 999, ORG_ID, IPC_EVENTS.CAMPAIGN_LOG, { campaignId: 1, message: 'nhân viên khác' })
    send(4, STAFF_ID, ORG_ID, 'zalo:login-qr', { accountId: 2445 })
    await waitFor(() => events.length === 2, 'nhận tiến trình chiến dịch')
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.deepEqual(events.map(event => event.channel), [IPC_EVENTS.CAMPAIGN_LOG, IPC_EVENTS.CAMPAIGN_STATUS_UPDATED])
    pass('nhận dòng tiến trình và trạng thái chiến dịch của đúng nhân viên; bỏ kênh khác và nhân viên khác')

    const session = await client.checkSession(2445)
    assert.deepEqual(session, { success: true, loggedIn: true, status: 'đã đăng nhập' })
    assert.ok(apiCalls.includes('GET /api/chat/zalo/accounts Bearer desktop-token'))
    assert.equal(sessionRequests.length, 1, 'dùng lại phiên Desktop đã có, không lấy thêm')
    pass('kiểm phiên tài khoản Server đi ChatApi bằng phiên Desktop')

    const labels = await client.listLabels(2445)
    assert.deepEqual(labels, [{ id: 7, text: 'Khách VIP', conversations: ['u1', 'u2'] }])
    assert.deepEqual(scanSessionRequests, [{ username: 'qn', password: 'secret', organizationId: ORG_ID }])
    assert.ok(apiCalls.some(call => call.startsWith('POST /api/chat/zalo/accounts/2445/data-scan-queries Bearer scan-token')))
    pass('quét data (nhãn) của tài khoản Server đi ChatApi bằng phiên quét data riêng')

    const logout = await client.logout(2445)
    assert.equal(logout.success, true)
    assert.equal(logout.loggedIn, false)
    assert.ok(apiCalls.includes('POST /api/chat/zalo/accounts/2445/logout Bearer desktop-token'))
    pass('đăng xuất tài khoản Server đi ChatApi')

    await assert.rejects(client.getLocalRuntimeSession(), /chưa được cấp quyền Đồng bộ Chat/)
    pass('runtime cục bộ vẫn chỉ dành cho tổ chức có Chat')

    client.stop()
    await waitFor(() => sockets[0].readyState === sockets[0].CLOSED, 'đóng kênh khi dừng')
    const callsBeforePlain = apiCalls.length
    const plain = new ZaloChatApiClient(() => undefined)
    plain.start(user({ zaloServerOnFly: false }), 'qn', 'secret')
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(plain.isServerOnFlyOnly(), false)
    assert.equal(plain.serverAccountsUseChatApi(), false)
    await assert.rejects(plain.checkSession(2445), /chưa được cấp quyền Đồng bộ Chat/)
    assert.equal(sockets.length, 1, 'tổ chức không chạy trên Fly thì không mở kênh ChatApi')
    assert.equal(sessionRequests.length, 1)
    assert.equal(apiCalls.length, callsBeforePlain)
    plain.stop()
    pass('tổ chức không chạy trên Fly: không gọi ChatApi, giữ đúng hành vi cũ')
  } finally {
    for (const socket of sockets) socket.terminate()
    wss.close()
    await new Promise(resolve => http.close(() => resolve(undefined)))
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(error => { console.error(error); process.exit(1) })
