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
  bindings: Map<number, LocalRuntimeBindingRegistration>
  listenerRetryStates: Map<number, {
    runtimeGeneration: string
    failedAttempts: number
    exhausted: boolean
  }>
  pendingEvents: Map<string, {
    eventId: string
    autoAccountId: string
    runtimeGeneration: string
    eventType: string
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
  replay?: ZaloListenerStatusEvent
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
    attach: () => testable.attachAccount(accountId, binding)
  }
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
    handlers.status?.({ accountId, status: 'running', ready: true })
  })
  await harness.attach()

  const lifecycle = lifecycleMessages(harness.messages)
  assert.equal(lifecycle.filter(message => message.kind === 'runtime.attach_account').length, 1)
  assert.deepEqual(states(lifecycle), ['connecting', 'ready'])
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

async function main(): Promise<void> {
  await testSingleAttachLifecycle()
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
  console.log('Zalo local Chat sync status smoke test passed.')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
