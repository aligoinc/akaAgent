import assert from 'node:assert/strict'

import { ZaloChatApiClient } from '../src/main/services/zaloChatApiClient'
import { ZaloChatContactScanSource } from '../src/main/services/zaloChatContactScanSource'

type TestableClient = ZaloChatApiClient & {
  user: Record<string, unknown>
  credentials: { username: string; password: string }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function enabledClient(): ZaloChatApiClient {
  const client = new ZaloChatApiClient(() => undefined) as TestableClient
  client.user = {
    staffId: 7,
    organizationId: 9,
    isChatSync: true,
    entitlements: { zalo: true },
    zaloAccountCapabilities: { server: true }
  }
  client.credentials = { username: 'staff', password: 'secret' }
  return client
}

async function testIdempotentQueryAndDedicatedScope(): Promise<void> {
  const originalFetch = globalThis.fetch
  const requestIds: string[] = []
  const authorizations: string[] = []
  let polls = 0
  const progressMessages: string[] = []
  const progress = { message: 'Zalo đang giới hạn yêu cầu. Chờ 15 giây rồi thử lại (1/3)...' }
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    const authorization = new Headers(init?.headers).get('authorization')
    if (authorization) authorizations.push(authorization)
    if (url.pathname === '/api/chat/desktop/data-scan-session') {
      return response({
        token: 'scan-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        staffId: '7',
        organizationId: '9'
      })
    }
    if (url.pathname === '/api/chat/zalo/accounts/71/data-scan-queries') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestIds.push(String(body.requestId))
      assert.equal(body.queryType, 'get_all_friends_page')
      assert.deepEqual(body.payload, { count: 500, page: 2 })
      return response({
        requestId: body.requestId,
        autoAccountId: '71',
        queryType: body.queryType,
        status: 'accepted',
        progress
      }, 202)
    }
    if (/\/api\/chat\/zalo\/data-scan-queries\/[0-9a-f-]+$/.test(url.pathname)) {
      const requestId = url.pathname.split('/').at(-1)!
      requestIds.push(requestId)
      polls += 1
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_all_friends_page',
        status: polls === 1 ? 'running' : 'succeeded',
        ...(polls === 1 ? { progress } : { result: [{ userId: 'friend-1' }] })
      })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }

  try {
    const source = new ZaloChatContactScanSource(enabledClient(), { getSystemSettingValue: async () => null })
    const result = await source.getAllFriendsPage(71, 500, 2, message => progressMessages.push(message))
    assert.deepEqual(result, [{ userId: 'friend-1' }])
    assert.ok(requestIds.length >= 3)
    assert.equal(new Set(requestIds).size, 1)
    assert.ok(authorizations.every(value => value === 'Bearer scan-token'))
    assert.deepEqual(progressMessages, [progress.message])
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testListLabelsUsesChatDataScanRoute(): Promise<void> {
  const originalFetch = globalThis.fetch
  let receivedQueryType = ''
  let receivedPayload: unknown
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/chat/desktop/data-scan-session') {
      return response({
        token: 'scan-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        staffId: '7',
        organizationId: '9'
      })
    }
    if (url.pathname === '/api/chat/zalo/accounts/71/data-scan-queries') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      receivedQueryType = String(body.queryType)
      receivedPayload = body.payload
      return response({
        requestId: body.requestId,
        autoAccountId: '71',
        queryType: body.queryType,
        status: 'succeeded',
        result: [{
          id: 12,
          text: 'Khách VIP',
          textKey: 'vip',
          color: '#ff0000',
          emoji: '🔥',
          conversations: ['friend-1', 'friend-1', '']
        }]
      })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }

  try {
    const labels = await enabledClient().listLabels(71)
    assert.equal(receivedQueryType, 'list_labels')
    assert.deepEqual(receivedPayload, {})
    assert.deepEqual(labels, [{
      id: 12,
      text: 'Khách VIP',
      textKey: 'vip',
      color: '#ff0000',
      emoji: '🔥',
      conversations: ['friend-1']
    }])
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testCancelUsesCurrentRequestId(): Promise<void> {
  const originalFetch = globalThis.fetch
  let requestId = ''
  let cancelled = false
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/chat/desktop/data-scan-session') {
      return response({
        token: 'scan-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        staffId: '7',
        organizationId: '9'
      })
    }
    if (url.pathname === '/api/chat/zalo/accounts/71/data-scan-queries') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestId = String(body.requestId)
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_joined_group_members',
        status: 'accepted'
      }, 202)
    }
    if (url.pathname === `/api/chat/zalo/data-scan-queries/${requestId}/cancel`) {
      cancelled = true
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_joined_group_members',
        status: 'cancelled'
      })
    }
    if (url.pathname === `/api/chat/zalo/data-scan-queries/${requestId}`) {
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_joined_group_members',
        status: cancelled ? 'cancelled' : 'running'
      })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }

  try {
    const client = enabledClient()
    const pending = client.getJoinedGroupMembers(71, 'group-1')
    while (!requestId) await new Promise(resolve => setTimeout(resolve, 0))
    await client.cancelActiveQuery(71)
    await assert.rejects(pending, /đã bị dừng/)
    assert.equal(cancelled, true)
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testFailedPollCancelsAcceptedOperation(): Promise<void> {
  const originalFetch = globalThis.fetch
  let requestId = ''
  let cancelled = false
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/chat/desktop/data-scan-session') {
      return response({
        token: 'scan-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        staffId: '7',
        organizationId: '9'
      })
    }
    if (url.pathname === '/api/chat/zalo/accounts/71/data-scan-queries') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestId = String(body.requestId)
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_all_groups',
        status: 'accepted'
      }, 202)
    }
    if (url.pathname === `/api/chat/zalo/data-scan-queries/${requestId}/cancel`) {
      cancelled = true
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_all_groups',
        status: 'cancelled'
      })
    }
    if (url.pathname === `/api/chat/zalo/data-scan-queries/${requestId}`) {
      return response({ error: 'data_scan_query_not_found' }, 404)
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }

  try {
    await assert.rejects(enabledClient().getAllGroups(71), /data_scan_query_not_found/)
    while (!cancelled) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(cancelled, true)
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testLegacyProxySettingNormalization(): Promise<void> {
  let receivedProxyUrl: string | undefined
  const source = new ZaloChatContactScanSource(
    {
      getGroupMembersByLink: async (_accountId, _link, proxyUrl) => {
        receivedProxyUrl = proxyUrl
        return { group: { groupId: 'group-1' }, members: [] }
      }
    } as unknown as ZaloChatApiClient,
    {
      getSystemSettingValue: async () => '127.0.0.1:8080:user:p:a:ss'
    }
  )

  await source.getGroupMembersByLink(71, 'https://zalo.me/g/example')
  assert.equal(receivedProxyUrl, 'http://user:p%3Aa%3Ass@127.0.0.1:8080')
}

async function testSuccessfulStartResetsConsecutiveFailureBudget(): Promise<void> {
  const originalFetch = globalThis.fetch
  const requestIds: string[] = []
  let startAttempts = 0
  let pollAttempts = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/chat/desktop/data-scan-session') {
      return response({
        token: 'scan-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        staffId: '7',
        organizationId: '9'
      })
    }
    if (url.pathname === '/api/chat/zalo/accounts/71/data-scan-queries') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestIds.push(String(body.requestId))
      startAttempts += 1
      if (startAttempts < 3) return response({ error: 'temporary' }, 503)
      return response({
        requestId: body.requestId,
        autoAccountId: '71',
        queryType: 'get_all_groups',
        status: 'accepted'
      }, 202)
    }
    if (/\/api\/chat\/zalo\/data-scan-queries\/[0-9a-f-]+$/.test(url.pathname)) {
      const currentRequestId = url.pathname.split('/').at(-1)!
      requestIds.push(currentRequestId)
      pollAttempts += 1
      if (pollAttempts === 1) return response({ error: 'temporary' }, 503)
      return response({
        requestId: currentRequestId,
        autoAccountId: '71',
        queryType: 'get_all_groups',
        status: 'succeeded',
        result: { 'group-1': 'version-1' }
      })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }

  try {
    const result = await enabledClient().getAllGroups(71)
    assert.deepEqual(result, { 'group-1': 'version-1' })
    assert.equal(startAttempts, 3)
    assert.equal(pollAttempts, 2)
    assert.equal(new Set(requestIds).size, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testGroupMembershipMetadataIsPreserved(): Promise<void> {
  const originalFetch = globalThis.fetch
  let requestId = ''
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/chat/desktop/data-scan-session') {
      return response({
        token: 'scan-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        staffId: '7',
        organizationId: '9'
      })
    }
    if (url.pathname === '/api/chat/zalo/accounts/71/data-scan-queries') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestId = String(body.requestId)
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_joined_group_members',
        status: 'accepted'
      }, 202)
    }
    if (url.pathname === `/api/chat/zalo/data-scan-queries/${requestId}`) {
      return response({
        requestId,
        autoAccountId: '71',
        queryType: 'get_joined_group_members',
        status: 'succeeded',
        result: {
          group: {
            groupId: 'group-1',
            currentMems: [{ id: 'member-1' }],
            memberIds: ['member-1'],
            memVerList: ['member-1_0']
          },
          members: [{ zaloGroupId: 'group-1', zaloUid: 'member-1', rawPayload: { id: 'member-1' } }]
        }
      })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }

  try {
    const result = await enabledClient().getJoinedGroupMembers(71, 'group-1')
    assert.deepEqual(result.group.currentMems, [{ id: 'member-1' }])
    assert.deepEqual(result.group.memberIds, ['member-1'])
    assert.deepEqual(result.group.memVerList, ['member-1_0'])
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function main(): Promise<void> {
  await testIdempotentQueryAndDedicatedScope()
  await testListLabelsUsesChatDataScanRoute()
  await testCancelUsesCurrentRequestId()
  await testFailedPollCancelsAcceptedOperation()
  await testLegacyProxySettingNormalization()
  await testSuccessfulStartResetsConsecutiveFailureBudget()
  await testGroupMembershipMetadataIsPreserved()
  console.log('Zalo Chat Data Scan smoke test passed')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
