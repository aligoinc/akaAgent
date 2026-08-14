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
  attached: Map<number, { ready: boolean }>
  attachedOnConnection: Set<number>
  bindings: Map<number, LocalRuntimeBindingRegistration>
  attachAccount(
    accountId: number,
    binding: LocalRuntimeBindingRegistration
  ): Promise<void>
  reconcile(): Promise<void>
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

async function main(): Promise<void> {
  await testSingleAttachLifecycle()
  await testEnsureFailureFallback()
  await testReconnectTransitionsRemainVisible()
  await testExistingReadyListenerIsNotLost()
  await testControlReconnectRestoresReadyWithoutReattachLoop()
  await testStaleAttachFailureDoesNotOverwriteCurrentGeneration()
  console.log('Zalo local Chat sync status smoke test passed.')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
