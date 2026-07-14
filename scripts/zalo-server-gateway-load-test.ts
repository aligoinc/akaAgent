import { generateKeyPairSync, randomUUID, sign } from 'crypto'
import { createServer } from 'http'
import { strict as assert } from 'assert'
import { performance } from 'perf_hooks'
import { WebSocket, type RawData } from 'ws'
import { ZaloServerGateway } from '../src/server/main/zaloServerGateway'
import type {
  ZaloServerCommandResponse,
  ZaloServerOperationSnapshot,
  ZaloServerRuntimeEvent,
  ZaloServerSnapshot
} from '../src/shared/zaloServerProtocol'

const HOST = '127.0.0.1'
const ORIGIN = 'https://load-test.akabiz.net'
const TICKET_KEY_PAIR = generateKeyPairSync('ed25519')
const TICKET_PUBLIC_KEY = Buffer.from(
  TICKET_KEY_PAIR.publicKey.export({ type: 'spki', format: 'pem' }).toString()
).toString('base64')

interface LoadConfig {
  staffCount: number
  clientsPerStaff: number
  connectConcurrency: number
  timeoutMs: number
}

interface CommandResultWaiter {
  resolve(value: ZaloServerCommandResponse): void
  reject(error: Error): void
}

interface LoadMetrics {
  startMs: number
  connectMs: number
  commandMs: number
  fanoutMs: number
  snapshotMs: number
  shutdownMs: number
  totalMs: number
  rssBaselineBytes: number
  rssConnectedBytes: number
  rssPeakBytes: number
  rssAfterShutdownBytes: number
}

interface RealtimeTicketPayload {
  v: 1
  jti: string
  sessionId: string
  staffId: number
  organizationId: number
  capabilities: {
    zaloServer: boolean
    sms: boolean
  }
  iat: number
  exp: number
}

interface HelloMessage {
  type: 'hello'
  snapshot: ZaloServerSnapshot
  events: ZaloServerRuntimeEvent[]
  operations?: ZaloServerOperationSnapshot[]
  liveOnly?: boolean
}

interface RuntimeEventMessage {
  type: 'runtime-event'
  event: ZaloServerRuntimeEvent
}

interface SnapshotMessage {
  type: 'snapshot'
  snapshot: ZaloServerSnapshot
}

type ServerMessage = HelloMessage | RuntimeEventMessage | SnapshotMessage | ZaloServerCommandResponse

class ControlProbe {
  readonly runtimeEvents: ZaloServerRuntimeEvent[] = []
  snapshotCount = 0
  lastSnapshot: ZaloServerSnapshot | null = null
  hello: HelloMessage | null = null

  private helloResolve!: (value: HelloMessage) => void
  private helloReject!: (error: Error) => void
  private helloSettled = false
  private readonly helloPromise = new Promise<HelloMessage>((resolve, reject) => {
    this.helloResolve = resolve
    this.helloReject = reject
  })
  private readonly commandWaiters = new Map<string, CommandResultWaiter>()

  constructor(
    readonly socket: WebSocket,
    readonly staffId: number,
    readonly organizationId: number,
    readonly clientIndex: number
  ) {
    socket.on('message', raw => this.handleMessage(raw))
    socket.on('close', (code, reason) => {
      const error = new Error(
        `Client ${this.clientIndex} đóng trước khi hoàn tất (code=${code}, reason=${reason.toString()})`
      )
      if (!this.helloSettled) {
        this.helloSettled = true
        this.helloReject(error)
      }
      for (const waiter of this.commandWaiters.values()) waiter.reject(error)
      this.commandWaiters.clear()
    })
  }

  waitForHello(timeoutMs: number): Promise<HelloMessage> {
    return withTimeout(this.helloPromise, timeoutMs, `hello client ${this.clientIndex}`)
  }

  async sendCommand(timeoutMs: number): Promise<ZaloServerCommandResponse> {
    const requestId = `load-command-${this.clientIndex}-${randomUUID()}`
    const result = new Promise<ZaloServerCommandResponse>((resolve, reject) => {
      this.commandWaiters.set(requestId, { resolve, reject })
    })
    this.socket.send(JSON.stringify({
      type: 'command',
      requestId,
      command: 'campaign.pause',
      args: [this.staffId]
    }))
    return withTimeout(result, timeoutMs, `command client ${this.clientIndex}`)
  }

  private handleMessage(raw: RawData): void {
    let message: ServerMessage
    try {
      message = JSON.parse(raw.toString()) as ServerMessage
    } catch (error) {
      this.rejectHello(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (message.type === 'hello') {
      if (this.hello) {
        this.rejectHello(new Error(`Client ${this.clientIndex} nhận hello trùng`))
        return
      }
      this.hello = message
      this.lastSnapshot = message.snapshot
      this.helloSettled = true
      this.helloResolve(message)
      return
    }
    if (message.type === 'runtime-event') {
      this.runtimeEvents.push(message.event)
      return
    }
    if (message.type === 'snapshot') {
      this.snapshotCount += 1
      this.lastSnapshot = message.snapshot
      return
    }
    if (message.type === 'command-result') {
      const waiter = this.commandWaiters.get(message.requestId)
      if (!waiter) return
      this.commandWaiters.delete(message.requestId)
      waiter.resolve(message)
    }
  }

  private rejectHello(error: Error): void {
    if (this.helloSettled) return
    this.helloSettled = true
    this.helloReject(error)
  }
}

function parsePositiveInteger(name: string, fallback: number, maximum: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${prefix}<số nguyên 1..${maximum}> không hợp lệ`)
  }
  return value
}

function readConfig(): LoadConfig {
  return {
    staffCount: parsePositiveInteger('staff', 1_000, 20_000),
    clientsPerStaff: parsePositiveInteger('clients-per-staff', 3, 20),
    connectConcurrency: parsePositiveInteger('connect-concurrency', 250, 2_000),
    timeoutMs: parsePositiveInteger('timeout-ms', 30_000, 180_000)
  }
}

function organizationIdFor(staffId: number): number {
  return 100_000 + staffId
}

function sessionIdFor(staffId: number): string {
  return `load-session-${staffId}`
}

function makeTicket(payload: RealtimeTicketPayload): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(
    null,
    Buffer.from(payloadPart, 'utf8'),
    TICKET_KEY_PAIR.privateKey
  ).toString('base64url')
  return `${payloadPart}.${signature}`
}

function makeRuntimeEvent(staffId: number, sequence: number, phase: 'old' | 'live'): ZaloServerRuntimeEvent {
  return {
    sequence,
    timestamp: new Date().toISOString(),
    staffId,
    organizationId: organizationIdFor(staffId),
    channel: 'campaign:log',
    payload: { phase, staffId }
  }
}

function makeSnapshot(staffId: number | undefined, connectedClients: number): ZaloServerSnapshot {
  const normalizedStaffId = staffId || 0
  return {
    state: 'running',
    startedAt: new Date(0).toISOString(),
    vietnamTime: new Date().toISOString(),
    timeZoneOk: true,
    listeningAt: 'load-test',
    connectedClients,
    runtimeCount: staffId ? 1 : 0,
    staffs: [],
    recentEvents: [makeRuntimeEvent(normalizedStaffId, -1, 'old')]
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms: ${label}`)), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitUntil(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timeout ${timeoutMs}ms: ${label}`)
    await delay(10)
  }
}

async function findOpenPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, HOST, () => resolve())
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Không lấy được port load test')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function connectProbe(
  url: string,
  config: LoadConfig,
  clientIndex: number
): Promise<ControlProbe> {
  const staffId = Math.floor(clientIndex / config.clientsPerStaff) + 1
  const organizationId = organizationIdFor(staffId)
  const now = Math.floor(Date.now() / 1_000)
  // Client đầu tiên mô phỏng máy ký ticket nhanh hơn VPS 30 giây. Gateway
  // không được từ chối chỉ vì iat nằm sau đồng hồ cục bộ của máy chạy server.
  const issuedAt = clientIndex === 0 ? now + 30 : now
  const ticket = makeTicket({
    v: 1,
    jti: `load-ticket-${clientIndex}-${randomUUID()}`,
    sessionId: sessionIdFor(staffId),
    staffId,
    organizationId,
    capabilities: { zaloServer: true, sms: staffId % 2 === 0 },
    iat: issuedAt,
    exp: issuedAt + 60
  })
  const socket = new WebSocket(url, {
    origin: ORIGIN,
    perMessageDeflate: false,
    handshakeTimeout: config.timeoutMs
  })
  const probe = new ControlProbe(socket, staffId, organizationId, clientIndex)
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  await withTimeout(opened, config.timeoutMs, `open client ${clientIndex}`)
  socket.send(JSON.stringify({ type: 'authenticate', token: ticket }))
  const hello = await probe.waitForHello(config.timeoutMs)
  assert.equal(hello.liveOnly, true, `Client ${clientIndex}: hello phải liveOnly`)
  assert.deepEqual(hello.events, [], `Client ${clientIndex}: không được replay transient log`)
  assert.deepEqual(hello.snapshot.recentEvents, [], `Client ${clientIndex}: snapshot không được chứa log cũ`)
  assert(Array.isArray(hello.operations), `Client ${clientIndex}: thiếu operation snapshot`)
  return probe
}

async function connectAll(
  url: string,
  config: LoadConfig,
  totalClients: number
): Promise<ControlProbe[]> {
  const probes = new Array<ControlProbe>(totalClients)
  let nextIndex = 0
  const workerCount = Math.min(config.connectConcurrency, totalClients)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= totalClients) return
      probes[index] = await connectProbe(url, config, index)
    }
  }))
  return probes
}

function countMapValues(values: Map<number, number>): number {
  let total = 0
  for (const value of values.values()) total += value
  return total
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

async function run(): Promise<void> {
  const config = readConfig()
  const totalClients = config.staffCount * config.clientsPerStaff
  const startedAt = performance.now()
  if (typeof global.gc === 'function') global.gc()
  const metrics: LoadMetrics = {
    startMs: 0,
    connectMs: 0,
    commandMs: 0,
    fanoutMs: 0,
    snapshotMs: 0,
    shutdownMs: 0,
    totalMs: 0,
    rssBaselineBytes: process.memoryUsage().rss,
    rssConnectedBytes: 0,
    rssPeakBytes: process.memoryUsage().rss,
    rssAfterShutdownBytes: 0
  }
  const memorySampler = setInterval(() => {
    metrics.rssPeakBytes = Math.max(metrics.rssPeakBytes, process.memoryUsage().rss)
  }, 25)

  process.env.AKA_AGENT_REALTIME_TICKET_PUBLIC_KEY = TICKET_PUBLIC_KEY
  delete process.env.AKA_AGENT_REALTIME_ALLOWED_ORIGINS

  const port = await findOpenPort()
  let gateway: ZaloServerGateway | null = null
  let probes: ControlProbe[] = []
  let phase: 'hello' | 'broadcast' | 'shutdown' = 'hello'
  const snapshotCalls = { hello: 0, broadcast: 0, shutdown: 0 }
  const sessionValidationCalls = new Map<number, number>()
  const capabilityValidationCalls = new Map<number, number>()
  let clientCountNotifications = 0
  let operationStarts = 0

  try {
    gateway = new ZaloServerGateway({
      host: HOST,
      port,
      authenticate: async () => {
        throw new Error('Desktop auth không thuộc load test này')
      },
      handoffToDesktop: async () => {
        throw new Error('Desktop handoff không thuộc load test này')
      },
      getSnapshot: staffId => {
        snapshotCalls[phase] += 1
        return makeSnapshot(staffId, gateway?.connectedClientCount || 0)
      },
      getOperations: () => [],
      executeCommand: async () => {
        throw new Error('Desktop command không thuộc load test này')
      },
      startControlOperation: (staffId, command) => {
        operationStarts += 1
        const timestamp = new Date().toISOString()
        return {
          operationId: `load-operation-${operationStarts}`,
          staffId,
          organizationId: organizationIdFor(staffId),
          command,
          accountId: null,
          status: 'completed',
          startedAt: timestamp,
          updatedAt: timestamp,
          completedAt: timestamp,
          result: { accepted: true }
        }
      },
      revalidateControlSession: async (staffId, organizationId, sessionId) => {
        sessionValidationCalls.set(staffId, (sessionValidationCalls.get(staffId) || 0) + 1)
        await new Promise<void>(resolve => setImmediate(resolve))
        return organizationId === organizationIdFor(staffId) && sessionId === sessionIdFor(staffId)
      },
      revalidateControlCapability: async (staffId, organizationId) => {
        capabilityValidationCalls.set(staffId, (capabilityValidationCalls.get(staffId) || 0) + 1)
        await new Promise<void>(resolve => setImmediate(resolve))
        return organizationId === organizationIdFor(staffId)
      },
      onClientCountChanged: () => {
        clientCountNotifications += 1
      }
    })

    const startStep = performance.now()
    await gateway.start()
    metrics.startMs = performance.now() - startStep

    // Seed a transient event before any control client connects. A control hello
    // must use the connection boundary and never replay these buffered events.
    for (let staffId = 1; staffId <= config.staffCount; staffId += 1) {
      gateway.publish(makeRuntimeEvent(staffId, staffId, 'old'))
    }

    const connectStep = performance.now()
    probes = await connectAll(`ws://${HOST}:${port}/ws`, config, totalClients)
    metrics.connectMs = performance.now() - connectStep
    metrics.rssConnectedBytes = process.memoryUsage().rss
    assert.equal(gateway.connectedClientCount, totalClients, 'Gateway đếm sai số client đã xác thực')
    assert.equal(clientCountNotifications, totalClients, 'Mỗi auth chỉ được phát một thay đổi client count')
    assert.equal(snapshotCalls.hello, totalClients, 'Mỗi control hello chỉ lấy một snapshot')
    assert.equal(sessionValidationCalls.size, config.staffCount, 'Thiếu staff được kiểm tra session')
    assert.equal(capabilityValidationCalls.size, config.staffCount, 'Thiếu staff được kiểm tra capability')
    assert.equal(
      countMapValues(sessionValidationCalls),
      config.staffCount,
      'Session cache phải gộp 3 client cùng session thành một lần kiểm tra'
    )
    assert.equal(
      countMapValues(capabilityValidationCalls),
      config.staffCount,
      'Capability cache phải gộp 3 client cùng staff thành một lần kiểm tra'
    )

    const sessionCallsBeforeCommands = countMapValues(sessionValidationCalls)
    const capabilityCallsBeforeCommands = countMapValues(capabilityValidationCalls)
    const commandStep = performance.now()
    const commandResults = await Promise.all(probes.map(probe => probe.sendCommand(config.timeoutMs)))
    metrics.commandMs = performance.now() - commandStep
    assert(commandResults.every(result => result.ok), 'Có control command thất bại')
    assert.equal(operationStarts, totalClients, 'Không phải mọi control client đều khởi tạo được operation')
    assert.equal(
      countMapValues(sessionValidationCalls),
      sessionCallsBeforeCommands,
      'Command đồng thời không được bỏ qua cache và gọi lại session DB'
    )
    assert.equal(
      countMapValues(capabilityValidationCalls),
      capabilityCallsBeforeCommands,
      'Command đồng thời không được bỏ qua cache và gọi lại entitlement DB'
    )

    const fanoutStep = performance.now()
    for (let staffId = 1; staffId <= config.staffCount; staffId += 1) {
      gateway.publish(makeRuntimeEvent(staffId, config.staffCount + staffId, 'live'))
    }
    await waitUntil(
      () => probes.every(probe => probe.runtimeEvents.length === 1),
      config.timeoutMs,
      'fan-out một event đến mọi client'
    )
    for (const probe of probes) {
      const [event] = probe.runtimeEvents
      assert.equal(event.staffId, probe.staffId, `Client ${probe.clientIndex} nhận event chéo staff`)
      assert.equal(
        event.organizationId,
        probe.organizationId,
        `Client ${probe.clientIndex} nhận event chéo organization`
      )
      assert.equal((event.payload as { phase?: string }).phase, 'live', 'Client nhận lại transient event cũ')
    }
    const receivedBeforeCrossTenant = probes.reduce((sum, probe) => sum + probe.runtimeEvents.length, 0)
    gateway.publish({
      ...makeRuntimeEvent(1, config.staffCount * 3, 'live'),
      organizationId: organizationIdFor(1) + 1
    })
    await delay(100)
    assert.equal(
      probes.reduce((sum, probe) => sum + probe.runtimeEvents.length, 0),
      receivedBeforeCrossTenant,
      'Event sai organization đã lọt sang client cùng staffId'
    )
    metrics.fanoutMs = performance.now() - fanoutStep

    phase = 'broadcast'
    const snapshotStep = performance.now()
    gateway.broadcastSnapshot()
    await waitUntil(
      () => probes.every(probe => probe.snapshotCount === 1),
      config.timeoutMs,
      'broadcast một snapshot đến mọi client'
    )
    metrics.snapshotMs = performance.now() - snapshotStep
    assert.equal(
      snapshotCalls.broadcast,
      config.staffCount,
      'Snapshot phải chỉ serialize/lấy dữ liệu một lần cho mỗi staff, không phải mỗi client hoặc O(N²)'
    )
    for (const probe of probes) {
      assert.deepEqual(
        probe.lastSnapshot?.recentEvents,
        [],
        `Snapshot realtime của client ${probe.clientIndex} chứa transient log cũ`
      )
    }

    phase = 'shutdown'
    const shutdownStep = performance.now()
    await gateway.stop()
    metrics.shutdownMs = performance.now() - shutdownStep
    await waitUntil(
      () => probes.every(probe => probe.socket.readyState === WebSocket.CLOSED),
      config.timeoutMs,
      'đóng sạch toàn bộ WebSocket'
    )
    assert.equal(gateway.connectedClientCount, 0, 'Gateway vẫn giữ client sau shutdown')
    assert.equal(
      clientCountNotifications,
      totalClients * 2,
      'Auth/close phải cân bằng, không rò client record'
    )
  } finally {
    phase = 'shutdown'
    await gateway?.stop().catch(() => {})
    clearInterval(memorySampler)
    if (typeof global.gc === 'function') {
      global.gc()
      await delay(50)
      global.gc()
    }
    metrics.rssAfterShutdownBytes = process.memoryUsage().rss
    metrics.rssPeakBytes = Math.max(metrics.rssPeakBytes, metrics.rssAfterShutdownBytes)
    metrics.totalMs = performance.now() - startedAt
  }

  const report = {
    status: 'passed',
    config: { ...config, totalClients },
    verification: {
      futureIssuedTicketAccepted: 1,
      helloLiveOnly: totalClients,
      liveEventsDelivered: totalClients,
      crossTenantEventsDelivered: 0,
      snapshotDataReads: snapshotCalls.broadcast,
      snapshotMessages: totalClients,
      initialSessionRevalidations: countMapValues(sessionValidationCalls),
      initialCapabilityRevalidations: countMapValues(capabilityValidationCalls),
      controlCommands: operationStarts,
      connectedAfterShutdown: gateway?.connectedClientCount || 0
    },
    timingsMs: {
      start: Math.round(metrics.startMs),
      connectAndAuthenticate: Math.round(metrics.connectMs),
      cachedCommands: Math.round(metrics.commandMs),
      tenantFanout: Math.round(metrics.fanoutMs),
      snapshotBroadcast: Math.round(metrics.snapshotMs),
      shutdown: Math.round(metrics.shutdownMs),
      total: Math.round(metrics.totalMs)
    },
    rssMiB: {
      baseline: mb(metrics.rssBaselineBytes),
      connected: mb(metrics.rssConnectedBytes),
      peak: mb(metrics.rssPeakBytes),
      afterShutdown: mb(metrics.rssAfterShutdownBytes),
      peakIncrease: mb(metrics.rssPeakBytes - metrics.rssBaselineBytes)
    }
  }
  console.log('\nZaloServerGateway load test PASSED')
  console.log(JSON.stringify(report, null, 2))
}

void run().catch(error => {
  console.error('\nZaloServerGateway load test FAILED')
  console.error(error)
  process.exitCode = 1
})
