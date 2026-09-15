import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { CampaignSupportService, CAMPAIGN_SUPPORT_BASE, parseCampaignSupportRun, validateCampaignSupportImages } from '../src/main/services/campaignSupportService'
import { CAMPAIGN_SUPPORT_QUESTION, isCampaignSupportTurnBusy, type CampaignSupportConversation,
  type CampaignSupportOwner, type CampaignSupportStatus } from '../src/shared/campaignSupport'
import { png, webp } from './campaign-support-image-fixtures'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 4000
  while (!check()) { if (Date.now() > deadline) throw new Error(`Timeout: ${label}`); await delay(5) }
}
function run(status: CampaignSupportStatus, conversationId = randomUUID(), turnId = randomUUID()) {
  return { conversationId, turnId, status, answer: status === 'completed' ? 'Chiến dịch chưa đến lịch chạy.' : '',
    progress: { state: status, stage: 'diagnosis', attempts: 1, reason: status === 'needs_input' ? 'Gửi thêm ảnh lỗi.' : null,
      nextAttemptAt: null, startedAt: null, updatedAt: new Date().toISOString() },
    statusUrl: `/api/public/agents/campaign-support/runs/${conversationId}/${turnId}` }
}
const response = (data: ReturnType<typeof run>, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify({ success: true, data }), { status, headers })

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'akaagent-support-tests-'))
  const services: CampaignSupportService[] = []
  let index = 0
  function fixture(handler: (url: string, init: RequestInit) => Promise<Response>, path?: string, pollIntervalMs = 10) {
    let owner: CampaignSupportOwner | null = { organizationId: 1, staffId: 7 }
    const states: CampaignSupportConversation[] = []
    const calls: Array<{ url: string; init: RequestInit; body: any }> = []
    const folder = path ?? join(directory, String(++index))
    let accessAllowed = true
    let authorizationCount = 0
    const service = new CampaignSupportService({ directory: folder, pollIntervalMs, timeoutMs: 80,
      getOwner: () => owner,
      authorizeCampaign: async (id, expectedOwner) => {
        authorizationCount++
        assert.deepEqual(expectedOwner, owner)
        if (!accessAllowed || id !== 17) throw new Error('Không có quyền truy cập.')
      },
      onUpdate: state => states.push(state),
      fetch: (async (input, init = {}) => {
        const url = String(input)
        assert(url.startsWith(CAMPAIGN_SUPPORT_BASE + '/'))
        assert.equal(init.redirect, 'error')
        assert.equal(init.credentials, 'omit')
        assert(!JSON.stringify(init.headers ?? {}).includes('Authorization'))
        calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : null })
        return handler(url, init)
      }) as typeof fetch
    })
    services.push(service)
    return { service, folder, states, calls, latest: () => states.at(-1)!, owner: (value: CampaignSupportOwner | null) => { owner = value },
      deny: () => { accessAllowed = false }, authCount: () => authorizationCount }
  }
  try {
    {
      let remote = run('queued')
      const f = fixture(async (_url, init) => {
        if (init.method === 'POST') return response(remote, 202)
        remote = run('completed', remote.conversationId, remote.turnId)
        return response(remote)
      })
      const [a, b] = await Promise.all([f.service.open(17), f.service.open(17)])
      assert.equal(a.id, b.id)
      await until(() => f.latest()?.turns.at(-1)?.result?.status === 'completed', 'initial completion')
      assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1)
      assert.equal(f.calls[0].body.question, CAMPAIGN_SUPPORT_QUESTION)
      assert.deepEqual(f.calls[0].body.scope, { organizationId: 1, campaignId: 17 })
      assert.equal(f.calls[0].body.waitSeconds, 0)
      assert.equal(f.authCount(), 2, 'polling does not query Supabase each tick')
      const key = a.id
      remote = run('needs_input', remote.conversationId)
      const requests = await Promise.allSettled([
        f.service.send({ campaignId: 17, conversationKey: key, question: 'Kiểm tra lại', images: [png, webp] }),
        f.service.send({ campaignId: 17, conversationKey: key, question: 'Không gửi trùng', images: [] })
      ])
      assert.equal(requests.filter(r => r.status === 'fulfilled').length, 1)
      await until(() => f.latest()?.turns.at(-1)?.result?.status === 'needs_input', 'needs input')
      const follow = f.calls.filter(c => c.body?.question).at(-1)!
      assert.equal(follow.body.conversationId, remote.conversationId)
      assert(!('scope' in follow.body))
      assert.notEqual(follow.body.requestId, f.calls[0].body.requestId)
      const turn = f.latest().turns.at(-1)!
      assert.equal(await f.service.image({ campaignId: 17, conversationKey: key, requestId: turn.requestId, index: 0 }), `data:image/png;base64,${png.dataBase64}`)
      assert.deepEqual(follow.body.images, [png, webp], 'send original WebP bytes and MIME to the API')
      assert.equal(await f.service.image({ campaignId: 17, conversationKey: key, requestId: turn.requestId, index: 1 }), `data:image/webp;base64,${webp.dataBase64}`)
      assert(!JSON.stringify(f.latest()).includes(png.dataBase64), 'progress events never repeat image payloads')
      const count = f.calls.length
      await delay(50)
      assert.equal(f.calls.length, count, 'needs_input stops polling')
      await f.service.open(17)
      await delay(20)
      assert.equal(f.calls.length, count, 'reopening completed conversation does not submit a new question')
      const next = await f.service.reset(17, key)
      assert.notEqual(next.id, key)
      assert.equal(next.turns.length, 0)
      await assert.rejects(f.service.send({ campaignId: 17, conversationKey: key, question: 'stale', images: [] }), /thay đổi/)
      assert.equal((await f.service.open(17)).turns.length, 0)
      await delay(35)
      assert.equal(f.calls.length, count, 'Tạo mới and reopen never submit an automatic question')
      f.service.stop()
      const g = fixture(async () => response(run('completed')), f.folder)
      const restoredEmpty = await g.service.open(17)
      assert.equal(restoredEmpty.id, next.id)
      assert.equal(restoredEmpty.turns.length, 0)
      await delay(35)
      assert.equal(g.calls.length, 0, 'empty conversation stays empty after restarting the app')
      const sent = await g.service.send({ campaignId: 17, conversationKey: next.id,
        question: 'Tôi muốn kiểm tra lịch chạy ngày mai', images: [webp] })
      await until(() => g.latest()?.turns[0]?.result?.status === 'completed', 'first manual question after reset')
      assert.equal(g.calls.length, 1)
      assert.equal(g.calls[0].body.question, 'Tôi muốn kiểm tra lịch chạy ngày mai')
      assert.deepEqual(g.calls[0].body.images, [webp])
      assert.deepEqual(g.calls[0].body.scope, { organizationId: 1, campaignId: 17 })
      assert.equal(g.calls[0].body.conversationId, undefined)
      assert.notEqual(sent.turns[0].requestId, turn.requestId)
      g.service.stop()
      console.log('PASS first question, follow-up, images, dedupe; reset/reopen/restart stay empty until a manual send')
    }
    {
      const f = fixture(async () => response(run('completed')))
      const firstSelection = randomUUID()
      const [first, duplicate] = await Promise.all([f.service.open(17, firstSelection), f.service.open(17, firstSelection)])
      assert.equal(first.id, duplicate.id)
      await until(() => f.latest()?.turns[0]?.result?.status === 'completed', 'first menu selection')
      assert.equal(f.calls.length, 1, 'remounting the same selection must not submit twice')
      assert.equal((await f.service.open(17, firstSelection)).id, first.id)

      const secondSelection = randomUUID()
      const second = await f.service.open(17, secondSelection)
      assert.notEqual(second.id, first.id)
      assert.equal(second.turns.length, 1)
      assert.equal(second.turns[0].question, CAMPAIGN_SUPPORT_QUESTION)
      await until(() => f.latest()?.turns[0]?.result?.status === 'completed', 'repeat menu selection')
      assert.equal(f.calls.length, 2)
      assert.notEqual(f.calls[0].body.requestId, f.calls[1].body.requestId)
      assert.equal(f.calls[1].body.conversationId, undefined)
      assert.deepEqual(f.calls[1].body.scope, { organizationId: 1, campaignId: 17 })
      await assert.rejects(f.service.send({ campaignId: 17, conversationKey: first.id, question: 'stale', images: [] }), /thay đổi/)
      await assert.rejects(readFile(join(f.folder, '1_7', '17', first.id, `${first.turns[0].requestId}.json`)), { code: 'ENOENT' })

      const empty = await f.service.reset(17, second.id)
      assert.equal((await f.service.open(17, secondSelection)).id, empty.id)
      assert.equal((await f.service.open(17, secondSelection)).turns.length, 0)
      await delay(35)
      assert.equal(f.calls.length, 2, 'Tạo mới and tab remount must stay empty')

      const third = await f.service.open(17, randomUUID())
      assert.notEqual(third.id, empty.id)
      await until(() => f.latest()?.turns[0]?.result?.status === 'completed', 'menu selection after empty reset')
      assert.equal(f.calls.length, 3)
      f.service.stop()
      const restored = fixture(async () => response(run('completed')), f.folder)
      const fresh = await restored.service.open(17, randomUUID())
      assert.notEqual(fresh.id, third.id, 'a menu selection replaces a conversation restored from disk')
      await until(() => restored.latest()?.turns[0]?.result?.status === 'completed', 'menu selection after restart')
      assert.equal(restored.calls.length, 1)
      assert.equal(restored.calls[0].body.conversationId, undefined)
      restored.service.stop()
      console.log('PASS each new menu selection creates a scoped question; same-selection remount and empty reset never duplicate it')
    }
    {
      let requests = 0
      let aborted = false
      const remote = run('working')
      let oldRequestId: string | undefined
      const f = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        requests++
        if (body?.action === 'cancel') return response(run('cancelled', remote.conversationId, remote.turnId))
        if (requests > 1) return response(body?.requestId === oldRequestId ? remote : run('completed'))
        oldRequestId = body.requestId
        return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => {
          aborted = true
          reject(new Error('Old request interrupted'))
        }, { once: true }))
      })
      const selection = randomUUID()
      const first = await f.service.open(17, selection)
      await until(() => requests === 1, 'old request in flight')
      assert.equal((await f.service.open(17, selection)).id, first.id)
      assert.equal(aborted, false, 'a tab remount must not interrupt a request')
      const nextSelection = randomUUID()
      const next = await f.service.open(17, nextSelection)
      assert.equal(aborted, true)
      assert.equal(next.id, first.id, 'keep the previous conversation until the server cancellation finishes')
      assert.equal(next.pendingStartRequestId, nextSelection)
      await until(() => f.latest()?.id !== first.id && f.latest()?.turns[0]?.result?.status === 'completed', 'replacement after cancelling an unacknowledged request')
      assert.equal(f.latest().pendingStartRequestId, undefined)
      assert.equal(f.latest().turns.length, 1)
      assert.equal(requests, 4)
      assert.deepEqual(f.calls[1].body, f.calls[0].body, 'recover the old remote IDs using the exact durable request')
      assert.deepEqual(f.calls[2].body, { action: 'cancel' })
      assert(f.calls[2].url.endsWith(`/runs/${remote.conversationId}/${remote.turnId}`))
      assert.notEqual(f.calls[3].body.requestId, oldRequestId)
      assert.equal(f.calls[3].body.conversationId, undefined)
      assert.equal((await f.service.open(17, nextSelection)).id, f.latest().id)
      f.service.stop()
      console.log('PASS menu restart recovers an unacknowledged request, cancels it remotely, then starts exactly one fresh question')
    }
    for (const failureKind of ['lost', '503', '503-uncommitted', 'delayed', 'completed', '404', 'permanent'] as const) {
      let remote = run('working')
      const oldConversationId = remote.conversationId
      const oldTurnId = remote.turnId
      let oldRequestId: string | undefined
      let cancelCalls = 0
      let releaseCancel: (() => void) | undefined
      const f = fixture(async (url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.question) {
          if (!oldRequestId) { oldRequestId = body.requestId; return response(remote, 202, { 'Retry-After': '1' }) }
          assert.notEqual(body.requestId, oldRequestId)
          assert(!['working', 'queued', 'waiting_dependency'].includes(remote.status), 'no new question before the previous remote run stops')
          return response(run('completed'))
        }
        assert(url.endsWith(`/runs/${oldConversationId}/${oldTurnId}`))
        if (body?.action === 'cancel') {
          cancelCalls++
          if (failureKind === 'permanent') return new Response(JSON.stringify({ success: false, error: { code: 'CONFLICT', message: 'Chưa thể dừng lượt cũ' } }), { status: 409 })
          if (cancelCalls === 1 && failureKind === '503-uncommitted') return new Response(JSON.stringify({ success: false, error: { code: 'UNAVAILABLE' } }), { status: 503 })
          if (failureKind === 'delayed') await new Promise<void>(resolve => { releaseCancel = resolve })
          remote = run(failureKind === 'completed' ? 'completed' : 'cancelled', oldConversationId, oldTurnId)
          if (failureKind === '404') return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' } }), { status: 404 })
          if (cancelCalls === 1 && failureKind === 'lost') throw new Error('Cancel committed but response lost')
          if (cancelCalls === 1 && failureKind === '503') return new Response(JSON.stringify({ success: false, error: { code: 'UNAVAILABLE' } }), { status: 503 })
          return response(remote)
        }
        assert.equal(init.method, 'GET')
        return response(remote)
      })
      const opened = await f.service.open(17, randomUUID())
      await until(() => !!f.latest()?.turns[0]?.result, 'known run before menu restart')
      const selection = randomUUID()
      const pending = await f.service.open(17, selection)
      assert.equal(pending.id, opened.id)
      assert.equal(pending.pendingStartRequestId, selection)
      assert.equal((await f.service.open(17, selection)).id, opened.id)
      if (failureKind === 'delayed') {
        await until(() => !!releaseCancel, 'cancel awaiting server response')
        assert.equal(f.calls.filter(call => call.body?.question).length, 1)
        const saved = JSON.parse(await readFile(join(f.folder, '1_7', '17', 'current.json'), 'utf8'))
        assert.equal(saved.pendingStartRequestId, selection)
        assert.equal(saved.turns[0].controlPending, 'cancel')
        releaseCancel!()
      }
      if (failureKind === 'permanent') {
        await until(() => !!f.latest()?.turns[0]?.error, 'permanent cancel error')
        await delay(35)
        assert.equal(f.latest().id, opened.id)
        assert.equal(f.latest().pendingStartRequestId, selection)
        assert.equal(f.calls.filter(call => call.body?.question).length, 1, 'do not abandon a run when cancel fails')
      } else {
        await until(() => f.latest()?.id !== opened.id && f.latest()?.turns[0]?.result?.status === 'completed', `restart after ${failureKind} cancel`)
        assert.equal(cancelCalls, failureKind === '503-uncommitted' ? 2 : 1)
        assert.equal(f.calls.filter(call => call.body?.question).length, 2)
        if (failureKind === 'lost' || failureKind === '503' || failureKind === '503-uncommitted') {
          const index = f.calls.findIndex(call => call.body?.action === 'cancel')
          assert.equal(f.calls[index + 1].init.method, 'GET', 'read the old run before retrying an uncertain cancel')
        }
        assert.equal((await f.service.open(17, selection)).id, f.latest().id)
        assert.equal(f.latest().pendingStartRequestId, undefined)
      }
      f.service.stop()
    }
    console.log('PASS menu cancellation: wait for server, lost response/503 reconciliation, completion race, missing run and permanent failure')
    {
      let remote = run('working')
      let cancelSignal: AbortSignal | undefined
      let oldRequestId: string | undefined
      const f = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.question) {
          if (!oldRequestId) { oldRequestId = body.requestId; return response(remote, 202, { 'Retry-After': '1' }) }
          assert.equal(remote.status, 'cancelled')
          return response(run('completed'))
        }
        if (body?.action === 'cancel') {
          remote = run('cancelled', remote.conversationId, remote.turnId)
          cancelSignal = init.signal as AbortSignal
          return new Promise((_resolve, reject) => cancelSignal!.addEventListener('abort', () => reject(new Error('Interrupted cancel response')), { once: true }))
        }
        return response(remote)
      })
      const first = await f.service.open(17, randomUUID())
      await until(() => !!f.latest()?.turns[0]?.result, 'known run before repeated menu clicks')
      await f.service.open(17, randomUUID())
      await until(() => !!cancelSignal, 'cancel in flight before another menu click')
      const finalSelection = randomUUID()
      await f.service.open(17, finalSelection)
      await until(() => f.latest()?.id !== first.id && f.latest()?.turns[0]?.result?.status === 'completed', 'coalesced latest menu selection')
      assert.equal(f.calls.filter(call => call.body?.action === 'cancel').length, 1)
      assert.equal(f.calls.filter(call => call.body?.question).length, 2)
      assert.equal((await f.service.open(17, finalSelection)).id, f.latest().id)
      f.service.stop()
      console.log('PASS repeated menu clicks during cancellation reconcile the old run and create only the latest replacement')
    }
    {
      let f: ReturnType<typeof fixture>
      const remote = run('working')
      f = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.action === 'cancel') {
          f.deny()
          return response(run('cancelled', remote.conversationId, remote.turnId))
        }
        return response(remote, 202, { 'Retry-After': '1' })
      })
      const opened = await f.service.open(17, randomUUID())
      await until(() => !!f.latest()?.turns[0]?.result, 'run before access changes during cancellation')
      await f.service.open(17, randomUUID())
      await until(() => !!f.latest()?.turns[0]?.error, 'recheck access before deferred new question')
      assert.equal(f.latest().id, opened.id)
      assert.equal(f.latest().turns[0].result?.status, 'cancelled')
      assert.equal(f.calls.filter(call => call.body?.question).length, 1)
      f.service.stop()
      console.log('PASS access is checked again after cancellation before sending the new question')
    }
    {
      let remote = run('working')
      const f = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.action === 'cancel') {
          remote = run('cancelled', remote.conversationId, remote.turnId)
          return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('App closed after cancel committed')), { once: true }))
        }
        return response(remote, 202, { 'Retry-After': '1' })
      })
      const opened = await f.service.open(17, randomUUID())
      await until(() => !!f.latest()?.turns[0]?.result, 'known run before restart during cancellation')
      const selection = randomUUID()
      await f.service.open(17, selection)
      await until(() => remote.status === 'cancelled', 'server committed cancel before app closes')
      f.service.stop()
      const g = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.question) return response(run('completed'))
        assert.equal(init.method, 'GET', 'restart must reconcile the stored cancel rather than repeat it')
        return response(remote)
      }, f.folder)
      const restored = await g.service.open(17, selection)
      assert.equal(restored.id, opened.id)
      assert.equal(restored.pendingStartRequestId, selection)
      await until(() => g.latest()?.id !== opened.id && g.latest()?.turns[0]?.result?.status === 'completed', 'fresh question after recovering pending cancellation')
      assert.equal(g.calls[0].init.method, 'GET')
      assert.equal(g.calls.filter(call => call.body?.question).length, 1)
      g.service.stop()
      console.log('PASS app restart reconciles a pending cancel before creating the replacement conversation')
    }
    {
      let signal: AbortSignal | null = null
      const f = fixture(async (_url, init) => {
        signal = init.signal as AbortSignal
        return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }))
      })
      const opened = await f.service.open(17, randomUUID())
      await until(() => !!signal, 'request before rejected selection')
      f.deny()
      await assert.rejects(f.service.open(17, randomUUID()), /quyền/)
      assert.equal((signal as unknown as AbortSignal).aborted, false, 'authorization failure must not interrupt the current request')
      assert.equal(f.latest().id, opened.id)
      f.service.stop()
      console.log('PASS new menu selections verify access before interrupting the old request')
    }
    {
      const remote = run('completed')
      let attempt = 0
      const f = fixture(async () => {
        attempt++
        if (attempt === 1) throw new Error('Response lost after server commit')
        if (attempt === 2) return new Response(JSON.stringify({ success: false, error: { code: 'UNAVAILABLE', message: 'Máy chủ bận' } }), { status: 503 })
        return response(remote)
      })
      await f.service.open(17)
      await until(() => f.latest()?.turns[0]?.result?.status === 'completed', 'idempotent retry')
      assert.equal(f.calls.length, 3)
      assert.deepEqual(f.calls.map(c => c.body), [f.calls[0].body, f.calls[0].body, f.calls[0].body])
      f.service.stop()
      console.log('PASS lost POST/503 retries preserve UUID and exact payload')
    }
    {
      const remote = run('working')
      const f = fixture(async () => response(remote, 202, { 'Retry-After': '1' }))
      const opened = await f.service.open(17)
      await until(() => !!f.latest()?.turns[0]?.result, 'ack before restart')
      f.service.stop()
      const g = fixture(async (_url, init) => { assert.equal(init.method, 'GET'); return response(run('completed', remote.conversationId, remote.turnId)) }, f.folder)
      assert.equal((await g.service.open(17)).id, opened.id)
      await until(() => g.latest()?.turns[0]?.result?.status === 'completed', 'GET after restart')
      assert.equal(g.calls.length, 1)
      g.service.stop()
      console.log('PASS restart restores known run with GET only')
    }
    {
      let remote = run('working')
      const f = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.action) remote = run(body.action === 'cancel' ? 'cancelled' : 'completed', remote.conversationId, remote.turnId)
        return response(remote)
      })
      const opened = await f.service.open(17)
      await until(() => !!f.latest()?.turns[0]?.result, 'initial active run')
      await assert.rejects(f.service.reset(17, opened.id), /Dừng/)
      await f.service.control({ campaignId: 17, conversationKey: opened.id, requestId: opened.turns[0].requestId, action: 'cancel' })
      await until(() => f.latest()?.turns[0]?.result?.status === 'cancelled', 'cancel')
      const before = f.calls.length
      await delay(40)
      assert.equal(f.calls.length, before)
      await f.service.control({ campaignId: 17, conversationKey: opened.id, requestId: opened.turns[0].requestId, action: 'resume' })
      await until(() => f.latest()?.turns[0]?.result?.status === 'completed', 'resume')
      assert.deepEqual(f.calls.filter(c => c.body?.action).map(c => c.body), [{ action: 'cancel' }, { action: 'resume' }])
      assert.equal(f.calls.filter(c => c.body?.question).length, 1)
      f.service.stop()
      console.log('PASS cancel/resume controls same turn, reset blocked while running')
    }
    {
      const remote = run('working')
      let received = false
      const f = fixture(async (_url, init) => {
        const body = JSON.parse(String(init.body))
        if (body.action) return response(run('cancelled', remote.conversationId, remote.turnId))
        if (!received) {
          received = true
          return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        }
        return response(remote, 202)
      })
      const opened = await f.service.open(17)
      await until(() => received, 'unacknowledged POST')
      await f.service.control({ campaignId: 17, conversationKey: opened.id, requestId: opened.turns[0].requestId, action: 'cancel' })
      await until(() => f.latest()?.turns[0]?.result?.status === 'cancelled', 'cancel before POST ack')
      const posts = f.calls.filter(c => c.body?.question)
      assert.equal(posts.length, 2)
      assert.deepEqual(posts[0].body, posts[1].body)
      f.service.stop()
      console.log('PASS early cancellation recovers same committed request then cancels it')
    }
    {
      let remote = run('working')
      let lost = false
      const f = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.action === 'cancel') {
          remote = run('cancelled', remote.conversationId, remote.turnId)
          lost = true
          throw new Error('Lost committed cancel response')
        }
        return response(remote)
      })
      const opened = await f.service.open(17)
      await until(() => !!f.latest()?.turns[0]?.result, 'control retry setup')
      await f.service.control({ campaignId: 17, conversationKey: opened.id, requestId: opened.turns[0].requestId, action: 'cancel' })
      await until(() => f.latest()?.turns[0]?.result?.status === 'cancelled', 'read after lost cancel')
      assert(lost)
      assert.equal(f.calls.filter(c => c.body?.action).length, 1, 'already committed control must not be submitted twice')
      assert.equal(f.calls.at(-1)?.init.method, 'GET')
      f.service.stop()
      console.log('PASS uncertain cancel is reconciled by GET before any replay')
    }
    {
      for (const action of ['cancel', 'resume'] as const) {
        for (const failure of ['network', '503'] as const) {
          let remote = run(action === 'cancel' ? 'working' : 'cancelled')
          const expected = action === 'cancel' ? 'cancelled' : 'working'
          const f = fixture(async (_url, init) => {
            const body = init.body ? JSON.parse(String(init.body)) : null
            if (body?.action) {
              remote = run(expected, remote.conversationId, remote.turnId)
              if (failure === 'network') throw new Error('Control committed but response lost')
              return new Response(JSON.stringify({ success: false, error: { code: 'UNAVAILABLE', message: 'Service unavailable' } }), { status: 503 })
            }
            return response(remote)
          }, undefined, 1000)
          const opened = await f.service.open(17)
          await until(() => !!f.latest()?.turns[0]?.result, 'manual retry setup')
          await f.service.control({ campaignId: 17, conversationKey: opened.id, requestId: opened.turns[0].requestId, action })
          await until(() => !!f.latest()?.turns[0]?.retryable, `lost ${action} response`)
          await f.service.retry(17, opened.id)
          await until(() => f.latest()?.turns[0]?.result?.status === expected, `manual ${action} recovery`)
          assert.deepEqual(f.calls.map(call => call.body?.action ?? call.init.method), ['POST', action, 'GET'])
          assert.equal(f.latest().turns[0].controlPending, null)
          assert.equal(f.latest().turns[0].error, null)
          f.service.stop()
        }
      }
      console.log('PASS manual Retry reconciles lost cancel/resume and 503 responses by GET without duplicate controls')
    }
    {
      let remote = run('working')
      let controls = 0
      const f = fixture(async (_url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : null
        if (body?.action) {
          if (++controls === 1) throw new Error('Control never reached server')
          remote = run('cancelled', remote.conversationId, remote.turnId)
        }
        return response(remote)
      }, undefined, 1000)
      const opened = await f.service.open(17)
      await until(() => !!f.latest()?.turns[0]?.result, 'uncommitted control setup')
      await f.service.control({ campaignId: 17, conversationKey: opened.id, requestId: opened.turns[0].requestId, action: 'cancel' })
      await until(() => !!f.latest()?.turns[0]?.retryable, 'uncommitted control failure')
      await f.service.retry(17, opened.id)
      await until(() => f.latest()?.turns[0]?.result?.status === 'cancelled', 'retry uncommitted control after GET')
      assert.deepEqual(f.calls.map(call => call.body?.action ?? call.init.method), ['POST', 'cancel', 'GET', 'cancel'])
      f.service.stop()
      console.log('PASS manual Retry still applies an uncommitted control after reading its current state')
    }
    {
      const remote = run('working')
      let committedControl = false
      const f = fixture(async (_url, init) => {
        if (init.body && JSON.parse(String(init.body)).action) {
          committedControl = true
          return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true }))
        }
        return response(remote)
      })
      const opened = await f.service.open(17)
      await until(() => !!f.latest()?.turns[0]?.result, 'control restart setup')
      await f.service.control({ campaignId: 17, conversationKey: opened.id, requestId: opened.turns[0].requestId, action: 'cancel' })
      await until(() => committedControl, 'committed control before crash')
      const reopened = await Promise.race([f.service.open(17), delay(50).then(() => { throw new Error('Reopen blocked behind HTTP') })])
      assert.equal(reopened.id, opened.id)
      f.service.stop()
      const g = fixture(async (_url, init) => {
        assert.equal(init.method, 'GET', 'restart must read before replaying an uncertain control')
        return response(run('cancelled', remote.conversationId, remote.turnId))
      }, f.folder)
      await g.service.open(17)
      await until(() => g.latest()?.turns[0]?.result?.status === 'cancelled', 'control recovery after crash')
      g.service.stop()
      console.log('PASS reopen stays responsive during HTTP; restart reconciles persisted pending control')
    }
    {
      for (const status of [400, 404, 409, 413]) {
        const f = fixture(async () => new Response(JSON.stringify({ success: false, error: { message: `Lỗi ${status}` } }), { status }))
        await f.service.open(17)
        await until(() => !!f.latest()?.turns[0]?.error, String(status))
        await delay(35)
        assert.equal(f.calls.length, 1)
        assert.equal(f.latest().turns[0].retryable, false)
        f.service.stop()
      }
      const malformed = fixture(async () => response({ ...run('completed'), statusUrl: 'https://evil.example/collect' }))
      await malformed.service.open(17)
      await until(() => !!malformed.latest()?.turns[0]?.error, 'wrong status URL')
      await delay(35)
      assert.equal(malformed.calls.length, 1)
      malformed.service.stop()
      assert.throws(() => parseCampaignSupportRun({ ...run('completed'), answer: '' }))
      assert.throws(() => parseCampaignSupportRun({ ...run('working'), progress: { state: 'completed' } }))
      console.log('PASS permanent HTTP errors, malformed response and status URL fail closed')
    }
    {
      for (const restart of [false, true]) {
        const remote = run('working')
        const f = fixture(async url => url.endsWith('/respond') ? response(remote)
          : new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Run not found' } }), { status: 404 }))
        const opened = await f.service.open(17)
        await until(() => !!f.latest()?.turns[0]?.error, 'known run 404')
        assert.equal(isCampaignSupportTurnBusy(f.latest().turns[0]), false, 'Tạo mới must be enabled after a known run disappears')
        const count = f.calls.length
        await delay(35)
        assert.equal(f.calls.length, count, '404 stops polling without creating another run')
        let current = f
        if (restart) {
          f.service.stop()
          current = fixture(async () => response(run('completed')), f.folder)
          const restored = await current.service.open(17)
          assert.equal(restored.id, opened.id)
          assert.equal(restored.turns[0].runNotFound, true)
          assert.equal(isCampaignSupportTurnBusy(restored.turns[0]), false)
          assert.equal(current.calls.length, 0, 'restart must not submit a replacement automatically')
        }
        await assert.rejects(current.service.retry(17, opened.id))
        await assert.rejects(current.service.control({ campaignId: 17, conversationKey: opened.id,
          requestId: opened.turns[0].requestId, action: 'cancel' }), /Tạo mới/)
        const beforeReset = current.calls.length
        const fresh = await current.service.reset(17, opened.id)
        assert.notEqual(fresh.id, opened.id)
        assert.equal(fresh.turns.length, 0)
        await delay(35)
        assert.equal(current.calls.length, beforeReset)
        const sent = await current.service.send({ campaignId: 17, conversationKey: fresh.id, question: 'Kiểm tra lại sau lỗi', images: [] })
        assert.notEqual(sent.turns[0].requestId, opened.turns[0].requestId)
        await until(() => !!current.calls.find(call => call.body?.requestId === sent.turns[0].requestId), 'manual question after 404')
        const request = current.calls.find(call => call.body?.requestId === sent.turns[0].requestId)!.body
        assert.equal(request.question, 'Kiểm tra lại sau lỗi')
        assert.deepEqual(request.scope, { organizationId: 1, campaignId: 17 })
        assert.equal(request.conversationId, undefined)
        current.service.stop()
      }
      console.log('PASS known-run 404 allows explicit Tạo mới, including after restart, without stale controls or automatic replacement')
    }
    {
      const remote = run('waiting_dependency')
      const f = fixture(async () => response(remote, 202, { 'Retry-After': '0.1' }))
      await assert.rejects(f.service.open(18))
      await f.service.open(17)
      await until(() => !!f.latest()?.turns[0]?.result, 'dependency wait')
      const before = f.calls.length
      await delay(40)
      assert.equal(f.calls.length, before, 'honor Retry-After')
      f.service.stop()
      f.owner(null)
      await assert.rejects(f.service.open(17))
      f.owner({ organizationId: 2, staffId: 7 })
      f.service.startSession()
      const other = await f.service.open(17)
      assert.equal(other.organizationId, 2)
      assert.equal(other.turns.length, 1)
      f.deny()
      await assert.rejects(f.service.image({ campaignId: 17, conversationKey: other.id, requestId: other.turns[0].requestId, index: 0 }))
      f.service.stop()
      console.log('PASS owner/tenant isolation, authorization, dependency pacing and logout')
    }
    {
      let finish: (response: Response) => void = () => {}
      const f = fixture(async () => new Promise(resolve => { finish = resolve }))
      await f.service.open(17)
      await until(() => f.calls.length > 0, 'in flight before logout')
      const count = f.states.length
      f.service.stop(); f.owner(null)
      finish(response(run('completed')))
      await delay(35)
      assert.equal(f.states.length, count, 'late response cannot restore expired session')
      const saved = JSON.parse(await readFile(join(f.folder, '1_7/17/current.json'), 'utf8'))
      assert.equal(saved.turns[0].result, null)
      console.log('PASS late response cannot publish or persist under another session')
    }
    {
      assert.equal(validateCampaignSupportImages([png]).length, 1)
      assert.throws(() => validateCampaignSupportImages(Array(6).fill(png)))
      assert.throws(() => validateCampaignSupportImages([{ ...png, name: 'a'.repeat(201) }]))
      assert.throws(() => validateCampaignSupportImages([{ ...png, dataBase64: 'data:image/png;base64,' + png.dataBase64 }]))
      assert.throws(() => validateCampaignSupportImages([{ ...png, mimeType: 'image/gif' }]))
      assert.throws(() => validateCampaignSupportImages([{ ...png, dataBase64: 'YWJj' }]))
      const animated = Buffer.from(png.dataBase64, 'base64')
      animated.write('acTL', 12, 'ascii')
      assert.throws(() => validateCampaignSupportImages([{ ...png, dataBase64: animated.toString('base64') }]))
      assert.throws(() => validateCampaignSupportImages([{ ...png, dataBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }]))
      const jpg = Buffer.alloc(4 * 1024 * 1024); jpg[0] = 0xff; jpg[1] = 0xd8; jpg[2] = 0xff
      assert.equal(validateCampaignSupportImages([{ name: 'large.jpg', mimeType: 'image/jpeg', dataBase64: jpg.toString('base64') }]).length, 1, 'large base64 does not overflow the regex stack')
      assert.throws(() => validateCampaignSupportImages(Array(4).fill({ name: 'large.jpg', mimeType: 'image/jpeg', dataBase64: jpg.toString('base64') })))
      const f = fixture(async () => response(run('completed')))
      const opened = await f.service.open(17)
      await until(() => f.latest()?.turns[0]?.result?.status === 'completed', 'validation setup')
      await assert.rejects(f.service.send({ campaignId: 17, conversationKey: opened.id, question: 'x'.repeat(4001), images: [] }))
      await assert.rejects(f.service.send({ campaignId: 17, conversationKey: opened.id, question: '', images: [] }))
      assert.equal(f.calls.length, 1)
      f.service.stop()
      assert.equal(isCampaignSupportTurnBusy({ ...opened.turns[0], result: run('working'), error: 'Conflict', retryable: false }), true)
      console.log('PASS text/image limits, MIME, animated PNG and no new run on invalid input')
    }
    console.log('Campaign support smoke: OK (no production API or DB calls)')
  } finally { services.forEach(service => service.stop()); await rm(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
