import assert from 'node:assert/strict'

import type { AutoAccount } from '../src/shared/types'
import type { SupabaseService } from '../src/main/services/supabase'
import type {
  LocalRuntimeBindingRegistration,
  ZaloChatApiClient
} from '../src/main/services/zaloChatApiClient'
import { ZaloLocalChatSyncService } from '../src/main/services/zaloLocalChatSyncService'
import type {
  ZaloListenerStatusEvent,
  ZaloRealtimeListenerHandlers,
  ZaloRuntimeService
} from '../src/main/services/zaloRuntimeService'

interface RuntimeHarness {
  service: ZaloLocalChatSyncService
  messages: Array<Record<string, unknown>>
  status(event: ZaloListenerStatusEvent): void
  message(payload: unknown): void
  oldMessages(messages: unknown, type: unknown): void
  attach(): Promise<void>
}

type TestableSyncService = ZaloLocalChatSyncService & {
  running: boolean
  welcomed: boolean
  socket: {
    readyState: number
    send(payload: string): void
  }
  liveEventSocket: TestableSyncService['socket'] | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  attached: Map<number, { ready: boolean }>
  attachedOnConnection: Set<number>
  lastSentStatusFingerprintByAccount: Map<number, string>
  bindings: Map<number, LocalRuntimeBindingRegistration>
  listenerRetryStates: Map<number, {
    runtimeGeneration: string
    failedAttempts: number
    exhausted: boolean
  }>
  stickerDetailCache: Map<string, unknown>
  pendingStickerDetails: Map<string, unknown>
  activeStickerDetailLookup: unknown | null
  stickerDetailLookupBlocker: Promise<void> | null
  stickerDetailLookupEpoch: number
  pendingEvents: Map<string, {
    eventId: string
    autoAccountId: string
    runtimeGeneration: string
    eventType: string
    priority: 'raw' | 'synthetic'
    wire: string
    sent: boolean
    replayAttempts: number
  }>
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  attachAccount(
    accountId: number,
    binding: LocalRuntimeBindingRegistration
  ): Promise<void>
  handleIncoming(raw: string, sourceSocket?: TestableSyncService['socket']): Promise<void>
  handleHeartbeatAckTimeout(socket: TestableSyncService['socket']): void
  handleWelcomeTimeout(socket: TestableSyncService['socket']): void
  detachAccount(accountId: number, reason: string): void
  publishEvent(accountId: number, eventType: string, payload: unknown): void
  reconcile(): Promise<void>
  scheduleReconnect(): void
  sendPendingEvent(event: TestableSyncService['pendingEvents'] extends Map<string, infer T> ? T : never): void
}

const accountId = 71
const binding: LocalRuntimeBindingRegistration = {
  autoAccountId: String(accountId),
  chatZaloAccountId: '701',
  chatZaloAccountOrganizationId: '702',
  runtimeGeneration: '9',
  zaloId: 'zalo-71'
}

function createHarness(
  ensure: (handlers: ZaloRealtimeListenerHandlers) => Promise<void>,
  replay?: ZaloListenerStatusEvent,
  getStickersDetail: (stickerIds: number[]) => Promise<unknown[]> = async () => []
): RuntimeHarness {
  let handlers: ZaloRealtimeListenerHandlers | null = null
  const runtime = {
    subscribeRealtimeListener: (
      subscribedAccountId: number,
      nextHandlers: ZaloRealtimeListenerHandlers
    ) => {
      assert.equal(subscribedAccountId, accountId)
      handlers = nextHandlers
      if (replay) nextHandlers.status?.(replay)
      return () => {}
    },
    ensureRealtimeListenerReady: async () => {
      assert.ok(handlers)
      await ensure(handlers)
    },
    getAllFriendsPage: async () => [],
    getAllGroups: async () => ({}),
    listLabels: async () => [],
    getRealtimeStickerDetails: async (_accountId: number, stickerIds: number[]) => (
      getStickersDetail(stickerIds)
    ),
    ensureApi: async () => ({
      listener: {
        requestOldMessages: () => {},
        requestOldReactions: () => {}
      }
    })
  } as unknown as ZaloRuntimeService

  const service = new ZaloLocalChatSyncService(
    {} as SupabaseService,
    {} as ZaloChatApiClient,
    runtime
  )
  const messages: Array<Record<string, unknown>> = []
  const testable = service as TestableSyncService
  testable.socket = {
    readyState: 1,
    send: payload => messages.push(JSON.parse(payload) as Record<string, unknown>)
  }

  return {
    service,
    messages,
    status: event => {
      assert.ok(handlers)
      handlers.status?.(event)
    },
    message: payload => {
      assert.ok(handlers)
      handlers.message?.(payload as never)
    },
    oldMessages: (messages, type) => {
      assert.ok(handlers)
      handlers.oldMessages?.(messages, type)
    },
    attach: () => testable.attachAccount(accountId, binding)
  }
}

async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  assert.fail('Timed out waiting for asynchronous smoke-test state.')
}

function runtimeEvents(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages.filter(message => message.kind === 'zalo.event')
}

function stickerQueueIdle(service: TestableSyncService): boolean {
  return service.activeStickerDetailLookup === null && service.pendingStickerDetails.size === 0
}

function lifecycleMessages(messages: Array<Record<string, unknown>>) {
  return messages.filter(message => (
    message.kind === 'runtime.attach_account'
    || message.kind === 'runtime.account.status'
  ))
}

function states(messages: Array<Record<string, unknown>>): string[] {
  return messages
    .filter(message => message.kind === 'runtime.account.status')
    .map(message => String(message.state))
}

async function testSingleAttachLifecycle(): Promise<void> {
  const harness = createHarness(async handlers => {
    handlers.status?.({ accountId, status: 'starting', ready: false })
    handlers.status?.({ accountId, status: 'starting', ready: false })
    handlers.status?.({ accountId, status: 'running', ready: true })
    handlers.status?.({ accountId, status: 'running', ready: true })
  })
  await harness.attach()

  const lifecycle = lifecycleMessages(harness.messages)
  assert.equal(lifecycle.filter(message => message.kind === 'runtime.attach_account').length, 1)
  assert.deepEqual(states(lifecycle), ['connecting', 'ready'])
}

async function testSameStateWithChangedDetailsRemainsVisible(): Promise<void> {
  const harness = createHarness(async handlers => {
    handlers.status?.({ accountId, status: 'running', ready: true })
  })
  await harness.attach()

  harness.status({
    accountId,
    status: 'disconnected',
    ready: false,
    code: 1006,
    reason: 'network path A'
  })
  harness.status({
    accountId,
    status: 'disconnected',
    ready: false,
    code: 1006,
    reason: 'network path A'
  })
  harness.status({
    accountId,
    status: 'disconnected',
    ready: false,
    code: 1006,
    reason: 'network path B'
  })
  harness.status({
    accountId,
    status: 'disconnected',
    ready: false,
    code: 1006,
    reason: 'network path A'
  })

  const statusMessages = harness.messages.filter(message => (
    message.kind === 'runtime.account.status'
  ))
  assert.deepEqual(
    states(statusMessages),
    ['ready', 'reconnecting', 'reconnecting', 'reconnecting']
  )
  assert.deepEqual(
    statusMessages.slice(1).map(message => message.closeReason),
    ['network path A', 'network path B', 'network path A']
  )
}

async function testEnsureFailureFallback(): Promise<void> {
  const withoutListenerError = createHarness(async handlers => {
    handlers.status?.({ accountId, status: 'starting', ready: false })
    throw new Error('listener startup timed out')
  })
  await assert.rejects(withoutListenerError.attach(), /timed out/)
  assert.deepEqual(states(withoutListenerError.messages), ['connecting', 'error'])

  const withListenerError = createHarness(async handlers => {
    handlers.status?.({ accountId, status: 'starting', ready: false })
    handlers.status?.({
      accountId,
      status: 'error',
      ready: false,
      error: 'listener rejected startup'
    })
    throw new Error('listener rejected startup')
  })
  await assert.rejects(withListenerError.attach(), /rejected startup/)
  assert.deepEqual(states(withListenerError.messages), ['connecting', 'error'])
}

async function testReconnectTransitionsRemainVisible(): Promise<void> {
  const harness = createHarness(async handlers => {
    handlers.status?.({ accountId, status: 'starting', ready: false })
    handlers.status?.({ accountId, status: 'running', ready: true })
  })
  await harness.attach()
  harness.status({
    accountId,
    status: 'disconnected',
    ready: false,
    code: 1006,
    reason: 'network lost'
  })
  harness.status({ accountId, status: 'starting', ready: false })
  harness.status({ accountId, status: 'running', ready: true })

  assert.deepEqual(
    states(harness.messages),
    ['connecting', 'ready', 'reconnecting', 'connecting', 'ready']
  )
}

async function testExistingReadyListenerIsNotLost(): Promise<void> {
  const harness = createHarness(
    async () => {},
    { accountId, status: 'running', ready: true }
  )
  await harness.attach()
  assert.equal(
    lifecycleMessages(harness.messages)
      .filter(message => message.kind === 'runtime.attach_account').length,
    1
  )
  assert.deepEqual(states(harness.messages), ['ready'])
}

async function testControlReconnectRestoresReadyWithoutReattachLoop(): Promise<void> {
  const account = {
    id: accountId,
    flatformType: 'zalo',
    isZaloServer: false,
    isZaloShowWeb: false,
    isActive: true,
    isDelete: false
  } as AutoAccount
  const messages: Array<Record<string, unknown>> = []
  let handlers: ZaloRealtimeListenerHandlers | null = null
  let ensureCount = 0
  let registerCount = 0

  const supabase = {
    listAccounts: async () => [account],
    listZaloAccountsWithSession: async () => [{ account }]
  } as unknown as SupabaseService
  const chatApi = {
    registerLocalRuntimeAccount: async (
      registeredAccountId: number,
      candidateZaloId: string
    ) => {
      assert.equal(registeredAccountId, accountId)
      assert.equal(candidateZaloId, binding.zaloId)
      registerCount += 1
      return binding
    }
  } as unknown as ZaloChatApiClient
  const runtime = {
    isLoginQrActive: () => false,
    checkSession: async () => ({ loggedIn: true }),
    getOwnProfileForChat: async () => ({ zaloId: binding.zaloId }),
    subscribeRealtimeListener: (
      subscribedAccountId: number,
      nextHandlers: ZaloRealtimeListenerHandlers
    ) => {
      assert.equal(subscribedAccountId, accountId)
      handlers = nextHandlers
      return () => {}
    },
    ensureRealtimeListenerReady: async () => {
      assert.ok(handlers)
      ensureCount += 1
      if (ensureCount === 1) {
        handlers.status?.({ accountId, status: 'running', ready: true })
      }
    },
    getAllFriendsPage: async () => [],
    getAllGroups: async () => ({}),
    listLabels: async () => [],
    ensureApi: async () => ({
      listener: {
        requestOldMessages: () => {},
        requestOldReactions: () => {}
      }
    })
  } as unknown as ZaloRuntimeService

  const service = new ZaloLocalChatSyncService(supabase, chatApi, runtime)
  const testable = service as TestableSyncService
  testable.running = true
  testable.welcomed = true
  testable.socket = {
    readyState: 1,
    send: payload => messages.push(JSON.parse(payload) as Record<string, unknown>)
  }

  await testable.reconcile()
  assert.equal(testable.attached.get(accountId)?.ready, true)

  messages.length = 0
  registerCount = 0
  testable.attachedOnConnection.clear()
  const attached = testable.attached.get(accountId)
  assert.ok(attached)
  attached.ready = false

  await testable.reconcile()
  await testable.reconcile()

  const lifecycle = lifecycleMessages(messages)
  assert.equal(registerCount, 1)
  assert.equal(lifecycle.filter(message => message.kind === 'runtime.attach_account').length, 1)
  assert.deepEqual(states(lifecycle), ['ready'])
  assert.equal(testable.attached.get(accountId)?.ready, true)
}

async function testStaleAttachFailureDoesNotOverwriteCurrentGeneration(): Promise<void> {
  let rejectEnsure!: (error: Error) => void
  const pendingEnsure = new Promise<void>((_resolve, reject) => {
    rejectEnsure = reject
  })
  const harness = createHarness(async () => pendingEnsure)
  const testable = harness.service as TestableSyncService
  const staleAttempt = harness.attach()
  await Promise.resolve()

  const attached = testable.attached.get(accountId)
  assert.ok(attached)
  const nextBinding = { ...binding, runtimeGeneration: '10' }
  Object.assign(attached, nextBinding)
  attached.ready = true
  testable.bindings.set(accountId, nextBinding)

  rejectEnsure(new Error('old generation listener failed'))
  await staleAttempt

  assert.equal(attached.ready, true)
  assert.deepEqual(states(harness.messages), [])
}

async function testRawEventUsesExactSerializedWire(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const wires: string[] = []
  const payload = { message: 'before enqueue' }
  testable.running = true
  testable.reconnectAttempt = 7
  testable.bindings.set(accountId, binding)
  testable.attachedOnConnection.add(accountId)
  testable.socket = {
    readyState: 1,
    send: wire => wires.push(wire)
  }
  testable.liveEventSocket = testable.socket
  testable.reconcile = async () => undefined

  testable.publishEvent(accountId, 'message', payload)
  assert.equal(testable.pendingEvents.size, 1)
  const pending = testable.pendingEvents.values().next().value
  assert.ok(pending)
  assert.equal(wires.length, 1)
  assert.equal(pending.wire, wires[0])
  assert.equal(
    (JSON.parse(pending.wire) as { payload: { message: string } }).payload.message,
    'before enqueue'
  )

  payload.message = 'mutated after enqueue'
  await testable.handleIncoming(JSON.stringify({
    protocolVersion: 1,
    kind: 'runtime.welcome',
    connectedAt: new Date().toISOString()
  }))

  assert.equal(testable.reconnectAttempt, 7)
  assert.equal(wires.length, 2)
  assert.equal(wires[1], pending.wire)
  assert.equal(
    (JSON.parse(wires[1]) as { payload: { message: string } }).payload.message,
    'before enqueue'
  )
  await testable.handleIncoming(JSON.stringify({
    protocolVersion: 1,
    kind: 'runtime.heartbeat_ack',
    receivedAt: new Date().toISOString()
  }))
  assert.equal(testable.reconnectAttempt, 0)
  harness.service.stop()
}

async function testFailedWelcomeBootstrapDoesNotResetReconnectBudget(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  testable.running = true
  testable.reconnectAttempt = 7
  testable.reconcile = async () => {
    throw new Error('deterministic bootstrap failure')
  }

  await assert.rejects(
    testable.handleIncoming(JSON.stringify({
      protocolVersion: 1,
      kind: 'runtime.welcome',
      connectedAt: new Date().toISOString()
    })),
    /deterministic bootstrap failure/
  )

  assert.equal(testable.reconnectAttempt, 7)
  harness.service.stop()
}

async function testUnserializableEventIsSkippedWithoutPayloadLogging(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const wires: string[] = []
  const warnings: string[] = []
  const originalWarn = console.warn
  testable.running = true
  testable.bindings.set(accountId, binding)
  testable.attachedOnConnection.add(accountId)
  testable.socket = {
    readyState: 1,
    send: wire => wires.push(wire)
  }
  testable.liveEventSocket = testable.socket
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))

  try {
    const circular: Record<string, unknown> = { secret: 'TOP_SECRET_PAYLOAD' }
    circular.self = circular
    testable.publishEvent(accountId, 'message\nunsafe', circular)
    testable.publishEvent(accountId, 'message', { value: 1n })

    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let index = 0; index < 20_000; index += 1) {
      const next: Record<string, unknown> = {}
      cursor.next = next
      cursor = next
    }
    testable.publishEvent(accountId, 'old_messages', deep)
  } finally {
    console.warn = originalWarn
  }

  assert.equal(testable.pendingEvents.size, 0)
  assert.equal(wires.length, 0)
  assert.equal(warnings.length, 3)
  assert.ok(warnings.every(line => line.includes(`accountId=${accountId}`)))
  assert.ok(warnings.some(line => line.includes('eventType=message?unsafe')))
  assert.ok(warnings.every(line => !line.includes('TOP_SECRET_PAYLOAD')))

  testable.publishEvent(accountId, 'message', { ok: true })
  assert.equal(testable.pendingEvents.size, 1)
  assert.equal(wires.length, 1)
  harness.service.stop()
}

async function testUnacknowledgedEventIsDroppedAfterTenReplays(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const wires: string[] = []
  const warnings: string[] = []
  const originalWarn = console.warn
  testable.running = true
  testable.bindings.set(accountId, binding)
  testable.attachedOnConnection.add(accountId)
  testable.socket = {
    readyState: 1,
    send: wire => wires.push(wire)
  }
  testable.liveEventSocket = testable.socket

  testable.publishEvent(accountId, 'message\nunsafe', { secret: 'DO_NOT_LOG' })
  const pending = testable.pendingEvents.values().next().value
  assert.ok(pending)
  assert.equal(wires.length, 1)

  for (let replay = 1; replay <= 10; replay += 1) {
    testable.sendPendingEvent(pending)
  }
  assert.equal(pending.replayAttempts, 10)
  assert.equal(testable.pendingEvents.size, 1)
  assert.equal(wires.length, 11)

  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
  try {
    testable.sendPendingEvent(pending)
  } finally {
    console.warn = originalWarn
  }

  assert.equal(testable.pendingEvents.size, 0)
  assert.equal(wires.length, 11)
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes('after 10 replays'))
  assert.ok(warnings[0].includes(`accountId=${accountId}`))
  assert.ok(warnings[0].includes('eventType=message?unsafe'))
  assert.ok(!warnings[0].includes('DO_NOT_LOG'))
  harness.service.stop()
}

async function testWelcomeTimeoutClosesTheCurrentSocket(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const closes: Array<{ code: number; reason: string }> = []
  const socket = {
    readyState: 1,
    send: () => {},
    close: (code: number, reason: string) => closes.push({ code, reason })
  }
  testable.running = true
  testable.welcomed = false
  testable.socket = socket

  testable.handleWelcomeTimeout(socket)

  assert.deepEqual(closes, [{ code: 1011, reason: 'local Chat welcome timeout' }])
  harness.service.stop()
}

async function testHeartbeatAckTimeoutClosesTheCurrentSocket(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const closes: Array<{ code: number; reason: string }> = []
  const socket = {
    readyState: 1,
    send: () => {},
    close: (code: number, reason: string) => closes.push({ code, reason })
  }
  testable.running = true
  testable.welcomed = true
  testable.socket = socket

  testable.handleHeartbeatAckTimeout(socket)

  assert.deepEqual(closes, [{ code: 1011, reason: 'local Chat heartbeat ACK timeout' }])
  harness.service.stop()
}

async function testStaleControlSocketCannotResetOrReplay(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const oldWires: string[] = []
  const newWires: string[] = []
  const oldSocket = { readyState: 1, send: (wire: string) => oldWires.push(wire) }
  const newSocket = { readyState: 1, send: (wire: string) => newWires.push(wire) }
  let finishReconcile!: () => void
  const pendingReconcile = new Promise<void>(resolve => { finishReconcile = resolve })

  testable.running = true
  testable.welcomed = true
  testable.reconnectAttempt = 7
  testable.socket = oldSocket
  testable.liveEventSocket = oldSocket
  testable.bindings.set(accountId, binding)
  testable.attachedOnConnection.add(accountId)
  testable.publishEvent(accountId, 'message', { value: 'pending' })
  assert.equal(oldWires.length, 1)
  testable.reconcile = async () => pendingReconcile

  const staleWelcome = testable.handleIncoming(JSON.stringify({
    protocolVersion: 1,
    kind: 'runtime.welcome',
    connectedAt: new Date().toISOString()
  }), oldSocket as TestableSyncService['socket'])
  await Promise.resolve()
  testable.socket = newSocket
  finishReconcile()
  await staleWelcome

  await testable.handleIncoming(JSON.stringify({
    protocolVersion: 1,
    kind: 'runtime.heartbeat_ack',
    receivedAt: new Date().toISOString()
  }), oldSocket as TestableSyncService['socket'])

  assert.equal(testable.reconnectAttempt, 7)
  assert.equal(oldWires.length, 1)
  assert.equal(newWires.length, 0)
  harness.service.stop()
}

async function testReconnectReplayBarrierSendsEachEventOnceInSequence(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const wires: string[] = []
  let finishReconcile!: () => void
  const pendingReconcile = new Promise<void>(resolve => { finishReconcile = resolve })
  const socket = { readyState: 1, send: (wire: string) => wires.push(wire) }

  testable.running = true
  testable.welcomed = true
  testable.socket = socket
  testable.liveEventSocket = null
  testable.bindings.set(accountId, binding)
  testable.attachedOnConnection.add(accountId)
  testable.reconcile = async () => pendingReconcile

  testable.publishEvent(accountId, 'message', { order: 1 })
  assert.equal(wires.length, 0)
  const welcome = testable.handleIncoming(JSON.stringify({
    protocolVersion: 1,
    kind: 'runtime.welcome',
    connectedAt: new Date().toISOString()
  }), socket as TestableSyncService['socket'])
  await Promise.resolve()
  assert.equal(testable.heartbeatTimer, null)

  testable.publishEvent(accountId, 'message', { order: 2 })
  assert.equal(wires.length, 0)
  finishReconcile()
  await welcome

  assert.equal(testable.liveEventSocket, socket)
  assert.ok(testable.heartbeatTimer)
  assert.deepEqual(
    wires.map(wire => {
      const event = JSON.parse(wire) as { sequence: string; payload: { order: number } }
      return [event.sequence, event.payload.order]
    }),
    [['1', 1], ['2', 2]]
  )

  testable.publishEvent(accountId, 'message', { order: 3 })
  assert.deepEqual(
    wires.map(wire => (JSON.parse(wire) as { sequence: string }).sequence),
    ['1', '2', '3']
  )
  harness.service.stop()
}

async function testLocalListenerRetryBudgetIsPerAccountAndManuallyResettable(): Promise<void> {
  const healthyAccountId = 72
  const accounts = [accountId, healthyAccountId].map(id => ({
    id,
    flatformType: 'zalo',
    isZaloServer: false,
    isZaloShowWeb: false,
    isActive: true,
    isDelete: false
  } as AutoAccount))
  const bindings = new Map<number, LocalRuntimeBindingRegistration>(accounts.map(account => [
    account.id,
    {
      autoAccountId: String(account.id),
      chatZaloAccountId: `chat-${account.id}`,
      chatZaloAccountOrganizationId: 'organization-1',
      runtimeGeneration: '9',
      zaloId: `zalo-${account.id}`
    }
  ]))
  const handlers = new Map<number, ZaloRealtimeListenerHandlers>()
  const ensureCalls = new Map<number, number>()
  const registerCalls = new Map<number, number>()
  const invalidatedAccounts: number[] = []
  let failingAccountCanRecover = false
  const messages: Array<Record<string, unknown>> = []

  const supabase = {
    listAccounts: async () => accounts,
    listZaloAccountsWithSession: async () => accounts.map(account => ({ account })),
    getAccount: async (requestedAccountId: number) => (
      accounts.find(account => account.id === requestedAccountId) ?? null
    )
  } as unknown as SupabaseService
  const chatApi = {
    registerLocalRuntimeAccount: async (registeredAccountId: number) => {
      registerCalls.set(registeredAccountId, (registerCalls.get(registeredAccountId) ?? 0) + 1)
      const nextBinding = bindings.get(registeredAccountId)
      assert.ok(nextBinding)
      return nextBinding
    }
  } as unknown as ZaloChatApiClient
  const runtime = {
    isLoginQrActive: () => false,
    invalidateAccount: (requestedAccountId: number) => {
      invalidatedAccounts.push(requestedAccountId)
    },
    checkSession: async () => ({ loggedIn: true }),
    getOwnProfileForChat: async (requestedAccountId: number) => ({
      zaloId: bindings.get(requestedAccountId)?.zaloId
    }),
    subscribeRealtimeListener: (
      subscribedAccountId: number,
      nextHandlers: ZaloRealtimeListenerHandlers
    ) => {
      handlers.set(subscribedAccountId, nextHandlers)
      return () => handlers.delete(subscribedAccountId)
    },
    ensureRealtimeListenerReady: async (requestedAccountId: number) => {
      ensureCalls.set(requestedAccountId, (ensureCalls.get(requestedAccountId) ?? 0) + 1)
      const subscribedHandlers = handlers.get(requestedAccountId)
      assert.ok(subscribedHandlers)
      if (requestedAccountId === accountId && !failingAccountCanRecover) {
        subscribedHandlers.status?.({
          accountId: requestedAccountId,
          status: 'closed',
          ready: false,
          code: 1006,
          reason: 'listener retry exhausted'
        })
        throw new Error('listener retry exhausted')
      }
      subscribedHandlers.status?.({
        accountId: requestedAccountId,
        status: 'running',
        ready: true
      })
    },
    getAllFriendsPage: async () => [],
    getAllGroups: async () => ({}),
    listLabels: async () => [],
    ensureApi: async () => ({
      listener: {
        requestOldMessages: () => {},
        requestOldReactions: () => {}
      }
    })
  } as unknown as ZaloRuntimeService

  const service = new ZaloLocalChatSyncService(supabase, chatApi, runtime)
  const testable = service as TestableSyncService
  testable.running = true
  testable.welcomed = true
  testable.socket = {
    readyState: 1,
    send: payload => messages.push(JSON.parse(payload) as Record<string, unknown>)
  }

  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
  try {
    for (let cycle = 0; cycle < 12; cycle += 1) await testable.reconcile()
  } finally {
    console.warn = originalWarn
  }

  assert.equal(ensureCalls.get(accountId), 10)
  assert.equal(ensureCalls.get(healthyAccountId), 1)
  assert.equal(registerCalls.get(accountId), 10)
  assert.equal(registerCalls.get(healthyAccountId), 1)
  assert.equal(testable.attached.get(accountId)?.ready, false)
  assert.equal(testable.attached.get(healthyAccountId)?.ready, true)
  assert.deepEqual(testable.listenerRetryStates.get(accountId), {
    runtimeGeneration: '9',
    failedAttempts: 10,
    exhausted: true
  })
  assert.equal(
    messages.filter(message => (
      message.kind === 'runtime.attach_account' &&
      message.autoAccountId === String(accountId)
    )).length,
    1
  )
  assert.equal(
    messages.filter(message => (
      message.kind === 'runtime.account.status' &&
      message.autoAccountId === String(accountId) &&
      message.state === 'error' &&
      String(message.errorMessage).includes('10 lần thử')
    )).length,
    1
  )
  assert.ok(warnings.some(line => (
    line.includes(`accountId=${accountId}`) && line.includes('attempts=10')
  )))

  // A new control connection gets one attach + terminal status, without
  // restarting the exhausted Zalo listener. Other accounts recover normally.
  messages.length = 0
  testable.attachedOnConnection.clear()
  const healthyAttached = testable.attached.get(healthyAccountId)
  assert.ok(healthyAttached)
  healthyAttached.ready = false
  await testable.reconcile()
  await testable.reconcile()
  assert.equal(ensureCalls.get(accountId), 10)
  assert.equal(ensureCalls.get(healthyAccountId), 2)
  assert.equal(registerCalls.get(accountId), 11)
  assert.equal(registerCalls.get(healthyAccountId), 2)
  assert.equal(
    messages.filter(message => (
      message.kind === 'runtime.attach_account' &&
      message.autoAccountId === String(accountId)
    )).length,
    1
  )
  assert.equal(
    messages.filter(message => (
      message.kind === 'runtime.account.status' &&
      message.autoAccountId === String(accountId) &&
      message.state === 'error' &&
      String(message.errorMessage).includes('10 lần thử')
    )).length,
    1
  )

  // A user-triggered retry opens a fresh budget and can restore this account.
  failingAccountCanRecover = true
  await testable.handleIncoming(JSON.stringify({
    protocolVersion: 1,
    kind: 'runtime.local_account.retry_attach.command',
    runtimeId: 'chat-runtime',
    requestId: 'manual-retry-1',
    autoAccountId: String(accountId)
  }))
  assert.equal(ensureCalls.get(accountId), 11)
  assert.deepEqual(invalidatedAccounts, [accountId])
  assert.equal(testable.attached.get(accountId)?.ready, true)
  assert.equal(testable.listenerRetryStates.has(accountId), false)

  // A binding generation rotation and a real detach are also fresh lifecycles.
  testable.listenerRetryStates.set(accountId, {
    runtimeGeneration: '9',
    failedAttempts: 10,
    exhausted: true
  })
  const rotatedBinding = { ...bindings.get(accountId)!, runtimeGeneration: '10' }
  await testable.attachAccount(accountId, rotatedBinding)
  assert.equal(testable.listenerRetryStates.has(accountId), false)
  testable.listenerRetryStates.set(accountId, {
    runtimeGeneration: '10',
    failedAttempts: 10,
    exhausted: true
  })
  testable.detachAccount(accountId, 'test lifecycle cleanup')
  assert.equal(testable.listenerRetryStates.has(accountId), false)
  assert.equal(testable.lastSentStatusFingerprintByAccount.has(accountId), false)
  service.stop()
}

async function testShortReadyFlapsStillExhaustTheLocalListenerBudget(): Promise<void> {
  let ensureCount = 0
  const warnings: string[] = []
  const originalWarn = console.warn
  const harness = createHarness(async handlers => {
    ensureCount += 1
    handlers.status?.({ accountId, status: 'running', ready: true })
  })
  const testable = harness.service as TestableSyncService

  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
  try {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await harness.attach()
      if (attempt === 2) {
        assert.deepEqual(testable.listenerRetryStates.get(accountId), {
          runtimeGeneration: binding.runtimeGeneration,
          failedAttempts: 1,
          exhausted: false
        })
      }
      harness.status({
        accountId,
        status: 'closed',
        ready: false,
        code: 1006,
        reason: 'short ready flap'
      })
    }
  } finally {
    console.warn = originalWarn
  }

  assert.equal(ensureCount, 10)
  assert.deepEqual(testable.listenerRetryStates.get(accountId), {
    runtimeGeneration: binding.runtimeGeneration,
    failedAttempts: 10,
    exhausted: true
  })
  await harness.attach()
  assert.equal(ensureCount, 10)
  assert.equal(warnings.filter(line => line.includes('attempts=10')).length, 1)
  harness.service.stop()
}

async function testControlReconnectStopsAfterTenAttemptsAndKeepsPending(): Promise<void> {
  const harness = createHarness(async () => {})
  const testable = harness.service as TestableSyncService
  const warnings: string[] = []
  const originalWarn = console.warn
  let unsubscribeCount = 0
  testable.running = true
  testable.socket = null as unknown as TestableSyncService['socket']
  testable.pendingEvents.set('pending-event', {
    eventId: 'pending-event',
    autoAccountId: String(accountId),
    runtimeGeneration: binding.runtimeGeneration,
    eventType: 'message',
    priority: 'raw',
    wire: '{"kind":"zalo.event"}',
    sent: true,
    replayAttempts: 0
  })
  testable.attached.set(accountId, {
    ready: true,
    unsubscribe: () => { unsubscribeCount += 1 }
  } as unknown as { ready: boolean })
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))

  try {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      testable.scheduleReconnect()
      assert.equal(testable.running, true)
      assert.equal(testable.reconnectAttempt, attempt)
      assert.ok(testable.reconnectTimer)
      clearTimeout(testable.reconnectTimer)
      testable.reconnectTimer = null
    }

    testable.scheduleReconnect()
  } finally {
    console.warn = originalWarn
  }

  assert.equal(testable.running, false)
  assert.equal(testable.reconnectTimer, null)
  assert.equal(unsubscribeCount, 1)
  assert.equal(testable.attached.size, 0)
  assert.equal(testable.pendingEvents.size, 1)
  assert.ok(warnings.some(line => (
    line.includes('10 reconnect attempts') && line.includes('pendingEvents=1')
  )))

  // Explicit lifecycle cleanup after the diagnostic stop still removes RAM data.
  harness.service.stop()
  assert.equal(testable.pendingEvents.size, 0)
}

function stickerMessage(
  stickerId: number,
  conversationZaloId: string,
  type: 0 | 1 = 0
): Record<string, unknown> {
  return {
    type,
    threadId: conversationZaloId,
    isSelf: false,
    data: {
      msgId: `message-${conversationZaloId}-${stickerId}`,
      msgType: 'chat.sticker',
      content: { id: stickerId, catId: 42, type: 7 }
    }
  }
}

function stickerDetail(stickerId: number): Record<string, unknown> {
  return {
    id: stickerId,
    type: 7,
    text: `sticker-${stickerId}`,
    uri: `sticker-uri-${stickerId}`,
    fkey: stickerId + 100,
    status: 1,
    stickerUrl: `https://cdn.example.invalid/stickers/${stickerId}.png`,
    stickerSpriteUrl: `https://cdn.example.invalid/stickers/${stickerId}-sprite.png`,
    stickerWebpUrl: `https://cdn.example.invalid/stickers/${stickerId}.webp`,
    totalFrames: 4,
    duration: 500,
    effectId: stickerId + 200,
    checksum: `checksum-${stickerId}`,
    ext: 1,
    source: 2,
    version: 3
  }
}

async function prepareStickerHarness(
  getStickersDetail: (stickerIds: number[]) => Promise<unknown[]>
): Promise<RuntimeHarness> {
  const harness = createHarness(async () => {}, undefined, getStickersDetail)
  const testable = harness.service as TestableSyncService
  testable.running = true
  testable.liveEventSocket = testable.socket
  await harness.attach()
  await new Promise<void>(resolve => setImmediate(resolve))
  harness.messages.length = 0
  testable.pendingEvents.clear()
  return harness
}

async function testStickerDetailsPublishRawFirstAndReuseInflightCache(): Promise<void> {
  const lookupCalls: number[][] = []
  let finishLookup!: (details: unknown[]) => void
  const lookup = new Promise<unknown[]>(resolve => { finishLookup = resolve })
  const harness = await prepareStickerHarness(async stickerIds => {
    lookupCalls.push(stickerIds)
    return lookup
  })

  const first = stickerMessage(501, 'user-501')
  const second = stickerMessage(501, 'user-502')
  harness.message(first)
  harness.message(second)
  await waitFor(() => lookupCalls.length === 1)

  let events = runtimeEvents(harness.messages)
    .filter(event => ['message', 'sticker_details'].includes(String(event.eventType)))
  assert.deepEqual(events.map(event => event.eventType), ['message', 'message'])
  assert.deepEqual(lookupCalls, [[501]])
  assert.deepEqual(
    ((events[0].payload as Record<string, unknown>).data as Record<string, unknown>).content,
    { id: 501, catId: 42, type: 7 }
  )

  finishLookup([stickerDetail(501)])
  await waitFor(() => runtimeEvents(harness.messages)
    .filter(event => event.eventType === 'sticker_details').length === 1)

  events = runtimeEvents(harness.messages)
    .filter(event => ['message', 'sticker_details'].includes(String(event.eventType)))
  assert.deepEqual(
    events.map(event => event.eventType),
    ['message', 'message', 'sticker_details']
  )
  const firstDerived = events.find(event => event.eventType === 'sticker_details')
  assert.ok(firstDerived)
  const firstItems = (firstDerived.payload as { items: Array<Record<string, unknown>> }).items
  assert.equal(firstItems.length, 2)
  assert.deepEqual(firstItems[0], {
    conversationType: 'user',
    conversationZaloId: 'user-501',
    stickerZaloId: '501',
    stickerCategoryZaloId: '42',
    stickerTypeCode: 7,
    stickerText: 'sticker-501',
    stickerUri: 'sticker-uri-501',
    stickerFileKey: '601',
    stickerStatusCode: 1,
    stickerUrl: 'https://cdn.example.invalid/stickers/501.png',
    stickerSpriteUrl: 'https://cdn.example.invalid/stickers/501-sprite.png',
    stickerWebpUrl: 'https://cdn.example.invalid/stickers/501.webp',
    stickerTotalFrames: 4,
    stickerDurationMs: 500,
    stickerEffectZaloId: '701',
    stickerChecksum: 'checksum-501',
    stickerExtension: '1',
    stickerSource: '2',
    stickerVersion: '3'
  })
  assert.equal(firstItems[1].conversationZaloId, 'user-502')

  harness.message(stickerMessage(501, 'user-503'))
  events = runtimeEvents(harness.messages)
    .filter(event => ['message', 'sticker_details'].includes(String(event.eventType)))
  assert.deepEqual(
    events.slice(-2).map(event => event.eventType),
    ['message', 'sticker_details']
  )
  assert.equal(lookupCalls.length, 1)
  harness.service.stop()
}

async function testOldStickerDetailsDedupeLookupAndFanOutConversations(): Promise<void> {
  const lookupCalls: number[][] = []
  const harness = await prepareStickerHarness(async stickerIds => {
    lookupCalls.push(stickerIds)
    return stickerIds.map(stickerDetail)
  })
  const messages = [
    stickerMessage(601, 'group-601', 1),
    stickerMessage(601, 'group-601', 1),
    stickerMessage(601, 'group-602', 1),
    stickerMessage(602, 'group-602', 1),
    {
      type: 1,
      threadId: 'group-602',
      data: { msgType: 'webchat', content: 'not a sticker' }
    }
  ]

  harness.oldMessages(messages, 1)
  await waitFor(() => runtimeEvents(harness.messages)
    .some(event => event.eventType === 'sticker_details'))

  const events = runtimeEvents(harness.messages)
    .filter(event => ['old_messages', 'sticker_details'].includes(String(event.eventType)))
  assert.deepEqual(events.map(event => event.eventType), ['old_messages', 'sticker_details'])
  assert.deepEqual(lookupCalls, [[601, 602]])
  assert.deepEqual(
    (events[0].payload as { messages: unknown[] }).messages,
    messages
  )
  const items = (events[1].payload as { items: Array<Record<string, unknown>> }).items
  assert.deepEqual(
    items.map(item => [item.conversationType, item.conversationZaloId, item.stickerZaloId]),
    [
      ['group', 'group-601', '601'],
      ['group', 'group-602', '601'],
      ['group', 'group-602', '602']
    ]
  )
  harness.service.stop()
}

async function testStickerDetailFailureIsNegativeCachedAndDoesNotChangeRuntimeState(): Promise<void> {
  let lookupCount = 0
  const warnings: string[] = []
  const originalWarn = console.warn
  const harness = await prepareStickerHarness(async () => {
    lookupCount += 1
    throw new Error('SECRET_STICKER_LOOKUP_PAYLOAD')
  })
  const testable = harness.service as TestableSyncService
  testable.reconnectAttempt = 6
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
  try {
    harness.message(stickerMessage(701, 'user-701'))
    await waitFor(() => lookupCount === 1 && stickerQueueIdle(testable))
    harness.message(stickerMessage(701, 'user-702'))
    await new Promise<void>(resolve => setImmediate(resolve))
  } finally {
    console.warn = originalWarn
  }

  const events = runtimeEvents(harness.messages)
    .filter(event => ['message', 'sticker_details'].includes(String(event.eventType)))
  assert.deepEqual(events.map(event => event.eventType), ['message', 'message'])
  assert.equal(lookupCount, 1)
  assert.equal(testable.reconnectAttempt, 6)
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes(`accountId=${accountId}`))
  assert.ok(!warnings[0].includes('SECRET_STICKER_LOOKUP_PAYLOAD'))
  harness.service.stop()
}

async function testStickerDetailsQueueWhileControlSocketIsClosed(): Promise<void> {
  const harness = await prepareStickerHarness(async stickerIds => stickerIds.map(stickerDetail))
  const testable = harness.service as TestableSyncService
  testable.socket = null as unknown as TestableSyncService['socket']
  testable.liveEventSocket = null

  harness.message(stickerMessage(801, 'user-801-closed'))
  await waitFor(() => stickerQueueIdle(testable))

  const pending = Array.from(testable.pendingEvents.values())
    .map(event => JSON.parse(event.wire) as { eventType: string; sequence: string })
    .filter(event => ['message', 'sticker_details'].includes(event.eventType))
  assert.deepEqual(pending.map(event => event.eventType), ['message', 'sticker_details'])
  assert.equal(BigInt(pending[1].sequence), BigInt(pending[0].sequence) + 1n)
  assert.equal(harness.messages.length, 0)
  harness.service.stop()
}

async function testStickerDetailsNeverEvictRawPendingEvents(): Promise<void> {
  const harness = await prepareStickerHarness(async stickerIds => stickerIds.map(stickerDetail))
  const testable = harness.service as TestableSyncService

  harness.message(stickerMessage(811, 'user-811-cache'))
  await waitFor(() => stickerQueueIdle(testable))
  testable.pendingEvents.clear()
  harness.messages.length = 0
  testable.liveEventSocket = null

  for (let index = 0; index < 499; index += 1) {
    testable.publishEvent(accountId, 'message', { index })
  }
  harness.message(stickerMessage(811, 'user-811-cached-again'))

  assert.equal(testable.pendingEvents.size, 500)
  assert.ok(Array.from(testable.pendingEvents.values()).every(event => event.priority === 'raw'))
  assert.equal(
    Array.from(testable.pendingEvents.values())
      .filter(event => event.eventType === 'sticker_details').length,
    0
  )

  testable.pendingEvents.clear()
  for (let index = 0; index < 499; index += 1) {
    testable.publishEvent(accountId, 'message', { index: `raw-${index}` })
  }
  testable.publishEvent(accountId, 'sticker_details', { items: [{ marker: 'synthetic' }] })
  assert.equal(testable.pendingEvents.size, 500)
  assert.equal(
    Array.from(testable.pendingEvents.values()).filter(event => event.priority === 'synthetic').length,
    1
  )

  testable.publishEvent(accountId, 'message', { index: 'raw-new' })
  const retained = Array.from(testable.pendingEvents.values())
  assert.equal(retained.length, 500)
  assert.ok(retained.every(event => event.priority === 'raw'))
  assert.ok(retained.some(event => (
    (JSON.parse(event.wire) as { payload?: { index?: string } }).payload?.index === 'raw-new'
  )))
  for (let index = 0; index < 499; index += 1) {
    assert.ok(retained.some(event => (
      (JSON.parse(event.wire) as { payload?: { index?: string } }).payload?.index === `raw-${index}`
    )))
  }
  harness.service.stop()
}

async function testStickerDetailsSurviveControlReconnectWithinGeneration(): Promise<void> {
  let finishLookup!: (details: unknown[]) => void
  let lookupStarted = false
  const harness = await prepareStickerHarness(async () => {
    lookupStarted = true
    return new Promise<unknown[]>(resolve => { finishLookup = resolve })
  })
  const testable = harness.service as TestableSyncService
  harness.message(stickerMessage(802, 'user-802-reconnect'))
  await waitFor(() => lookupStarted)

  const replacementWires: string[] = []
  const replacementSocket = {
    readyState: 1,
    send: (wire: string) => replacementWires.push(wire)
  }
  testable.socket = replacementSocket
  testable.liveEventSocket = null
  testable.welcomed = false
  testable.attachedOnConnection.clear()
  testable.reconcile = async () => {
    testable.attachedOnConnection.add(accountId)
  }

  finishLookup([stickerDetail(802)])
  await waitFor(() => stickerQueueIdle(testable))
  assert.equal(replacementWires.length, 0)
  await testable.handleIncoming(JSON.stringify({
    protocolVersion: 1,
    kind: 'runtime.welcome',
    connectedAt: new Date().toISOString()
  }), replacementSocket)

  const replayedEvents = replacementWires
    .map(wire => JSON.parse(wire) as Record<string, unknown>)
    .filter(event => event.kind === 'zalo.event')
  assert.deepEqual(
    replayedEvents.map(event => event.eventType),
    ['message', 'sticker_details']
  )
  assert.equal(
    BigInt(String(replayedEvents[1].sequence)),
    BigInt(String(replayedEvents[0].sequence)) + 1n
  )
  harness.service.stop()
}

async function testStickerDetailQueueDrainsSaturatedHistorySequentially(): Promise<void> {
  const lookupCalls: number[][] = []
  const lookupResolvers: Array<() => void> = []
  let activeLookups = 0
  let maxActiveLookups = 0
  const harness = await prepareStickerHarness(async stickerIds => {
    lookupCalls.push(stickerIds)
    activeLookups += 1
    maxActiveLookups = Math.max(maxActiveLookups, activeLookups)
    return new Promise<unknown[]>(resolve => {
      lookupResolvers.push(() => {
        activeLookups -= 1
        resolve(stickerIds.map(stickerDetail))
      })
    })
  })
  const testable = harness.service as TestableSyncService
  const messages = Array.from({ length: 101 }, (_, index) => (
    stickerMessage(1_000 + index, `group-${1_000 + index}`, 1)
  ))

  harness.oldMessages(messages, 1)
  assert.equal(testable.pendingStickerDetails.size, 101)
  let resolvedStickerCount = 0
  for (let batchIndex = 0; resolvedStickerCount < messages.length; batchIndex += 1) {
    await waitFor(() => lookupCalls.length > batchIndex)
    assert.equal(activeLookups, 1)
    assert.ok(lookupCalls[batchIndex].length <= 10)
    resolvedStickerCount += lookupCalls[batchIndex].length
    lookupResolvers[batchIndex]()
  }
  await waitFor(() => stickerQueueIdle(testable))

  assert.equal(maxActiveLookups, 1)
  assert.deepEqual(lookupCalls.map(call => call.length), [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1])
  const events = runtimeEvents(harness.messages)
    .filter(event => ['old_messages', 'sticker_details'].includes(String(event.eventType)))
  assert.equal(events[0].eventType, 'old_messages')
  const derivedPayloads = events
    .filter(event => event.eventType === 'sticker_details')
    .map(event => event.payload as { items: unknown[] })
  assert.ok(derivedPayloads.every(payload => payload.items.length <= 100))
  assert.equal(
    derivedPayloads.reduce((total, payload) => total + payload.items.length, 0),
    messages.length
  )
  harness.service.stop()
}

async function testHungStickerLookupCannotBlockOrCorruptRestartedService(): Promise<void> {
  let lookupCount = 0
  let finishHungLookup!: () => void
  const harness = await prepareStickerHarness(async stickerIds => {
    lookupCount += 1
    if (lookupCount === 1) {
      return new Promise<unknown[]>(resolve => {
        finishHungLookup = () => resolve(stickerIds.map(stickerDetail))
      })
    }
    return stickerIds.map(stickerDetail)
  })
  const testable = harness.service as TestableSyncService
  const previousEpoch = testable.stickerDetailLookupEpoch

  harness.message(stickerMessage(901, 'user-901-hung'))
  await waitFor(() => (
    lookupCount === 1 &&
    testable.activeStickerDetailLookup !== null &&
    testable.stickerDetailLookupBlocker !== null
  ))
  harness.service.stop()
  assert.ok(testable.stickerDetailLookupEpoch > previousEpoch)
  assert.equal(testable.activeStickerDetailLookup, null)
  assert.equal(testable.pendingStickerDetails.size, 0)

  const restartedWires: string[] = []
  testable.running = true
  testable.bindings.set(accountId, binding)
  testable.socket = {
    readyState: 1,
    send: wire => restartedWires.push(wire)
  }
  testable.liveEventSocket = testable.socket
  testable.attachedOnConnection.add(accountId)
  harness.messages.length = 0
  testable.pendingEvents.clear()

  harness.message(stickerMessage(902, 'user-902-restarted'))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(lookupCount, 1)
  assert.equal(testable.activeStickerDetailLookup, null)
  assert.equal(testable.pendingStickerDetails.size, 1)
  assert.ok(testable.stickerDetailLookupBlocker)

  finishHungLookup()
  await waitFor(() => lookupCount === 2 && stickerQueueIdle(testable))
  assert.deepEqual(
    restartedWires
      .map(wire => JSON.parse(wire) as Record<string, unknown>)
      .filter(event => event.kind === 'zalo.event')
      .map(event => event.eventType),
    ['message', 'sticker_details']
  )
  assert.equal(testable.activeStickerDetailLookup, null)
  assert.equal(testable.stickerDetailLookupBlocker, null)
  assert.equal(testable.pendingStickerDetails.size, 0)
  assert.equal(lookupCount, 2)
  harness.service.stop()
}

async function testGenerationChangeQueuesBehindExistingStickerLookup(): Promise<void> {
  let lookupCount = 0
  let finishOldLookup!: () => void
  const harness = await prepareStickerHarness(async stickerIds => {
    lookupCount += 1
    if (lookupCount === 1) {
      return new Promise<unknown[]>(resolve => {
        finishOldLookup = () => resolve(stickerIds.map(stickerDetail))
      })
    }
    return stickerIds.map(stickerDetail)
  })
  const testable = harness.service as TestableSyncService

  harness.message(stickerMessage(911, 'user-911-old-generation'))
  await waitFor(() => lookupCount === 1 && testable.stickerDetailLookupBlocker !== null)
  testable.bindings.set(accountId, { ...binding, runtimeGeneration: '10' })
  harness.message(stickerMessage(912, 'user-912-new-generation'))
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.equal(lookupCount, 1)
  assert.ok(testable.pendingStickerDetails.size >= 2)
  finishOldLookup()
  await waitFor(() => lookupCount === 2 && stickerQueueIdle(testable))

  const relevantEvents = runtimeEvents(harness.messages)
    .filter(event => ['message', 'sticker_details'].includes(String(event.eventType)))
  assert.deepEqual(
    relevantEvents.map(event => [event.eventType, event.runtimeGeneration]),
    [
      ['message', '9'],
      ['message', '10'],
      ['sticker_details', '10']
    ]
  )
  const derivedItems = (relevantEvents[2].payload as { items: Array<Record<string, unknown>> }).items
  assert.deepEqual(derivedItems.map(item => item.stickerZaloId), ['912'])
  harness.service.stop()
}

async function testStickerDetailDerivedPublishStopsAtGenerationOrServiceBoundary(): Promise<void> {
  for (const staleBy of ['generation', 'stop'] as const) {
    let finishLookup!: (details: unknown[]) => void
    let lookupStarted = false
    const harness = await prepareStickerHarness(async () => {
      lookupStarted = true
      return new Promise<unknown[]>(resolve => { finishLookup = resolve })
    })
    const testable = harness.service as TestableSyncService
    harness.message(stickerMessage(803, `user-803-${staleBy}`))
    await waitFor(() => lookupStarted)

    if (staleBy === 'generation') {
      testable.bindings.set(accountId, { ...binding, runtimeGeneration: '10' })
    } else {
      harness.service.stop()
    }

    finishLookup([stickerDetail(803)])
    if (staleBy === 'generation') {
      await waitFor(() => stickerQueueIdle(testable))
    } else {
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    const eventTypes = runtimeEvents(harness.messages)
      .filter(event => ['message', 'sticker_details'].includes(String(event.eventType)))
      .map(event => event.eventType)
    assert.deepEqual(eventTypes, ['message'])
    if (staleBy === 'generation') harness.service.stop()
  }
}

async function main(): Promise<void> {
  await testSingleAttachLifecycle()
  await testSameStateWithChangedDetailsRemainsVisible()
  await testEnsureFailureFallback()
  await testReconnectTransitionsRemainVisible()
  await testExistingReadyListenerIsNotLost()
  await testControlReconnectRestoresReadyWithoutReattachLoop()
  await testStaleAttachFailureDoesNotOverwriteCurrentGeneration()
  await testRawEventUsesExactSerializedWire()
  await testFailedWelcomeBootstrapDoesNotResetReconnectBudget()
  await testUnserializableEventIsSkippedWithoutPayloadLogging()
  await testUnacknowledgedEventIsDroppedAfterTenReplays()
  await testWelcomeTimeoutClosesTheCurrentSocket()
  await testHeartbeatAckTimeoutClosesTheCurrentSocket()
  await testStaleControlSocketCannotResetOrReplay()
  await testReconnectReplayBarrierSendsEachEventOnceInSequence()
  await testLocalListenerRetryBudgetIsPerAccountAndManuallyResettable()
  await testShortReadyFlapsStillExhaustTheLocalListenerBudget()
  await testControlReconnectStopsAfterTenAttemptsAndKeepsPending()
  await testStickerDetailsPublishRawFirstAndReuseInflightCache()
  await testOldStickerDetailsDedupeLookupAndFanOutConversations()
  await testStickerDetailFailureIsNegativeCachedAndDoesNotChangeRuntimeState()
  await testStickerDetailsQueueWhileControlSocketIsClosed()
  await testStickerDetailsNeverEvictRawPendingEvents()
  await testStickerDetailsSurviveControlReconnectWithinGeneration()
  await testStickerDetailQueueDrainsSaturatedHistorySequentially()
  await testHungStickerLookupCannotBlockOrCorruptRestartedService()
  await testGenerationChangeQueuesBehindExistingStickerLookup()
  await testStickerDetailDerivedPublishStopsAtGenerationOrServiceBoundary()
  console.log('Zalo local Chat sync status smoke test passed.')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
