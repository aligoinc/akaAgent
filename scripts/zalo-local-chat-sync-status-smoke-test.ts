import assert from 'node:assert/strict'

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
  socket: {
    readyState: number
    send(payload: string): void
  }
  attachAccount(
    accountId: number,
    binding: LocalRuntimeBindingRegistration
  ): Promise<void>
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

async function main(): Promise<void> {
  await testSingleAttachLifecycle()
  await testEnsureFailureFallback()
  await testReconnectTransitionsRemainVisible()
  await testExistingReadyListenerIsNotLost()
  console.log('Zalo local Chat sync status smoke test passed.')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
