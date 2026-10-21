import { strict as assert } from 'node:assert'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { ZaloServerGateway } from '../src/server/main/zaloServerGateway'
import type { ZaloServerSnapshot } from '../src/shared/zaloServerProtocol'

async function main() {
  const key = generateKeyPairSync('ed25519')
  process.env.AKA_AGENT_REALTIME_TICKET_PUBLIC_KEY = Buffer.from(key.publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString('base64')
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()))
  const pending = new Map<string, (value: unknown) => void>(), cancellations: string[] = []
  let started = 0
  const gateway = new ZaloServerGateway({ host: '127.0.0.1', port,
    authenticate: async () => { throw new Error('unused') }, handoffToDesktop: async () => { throw new Error('unused') },
    getSnapshot: () => ({ state: 'running', startedAt: 'fixture', staffs: [], recentEvents: [] } as unknown as ZaloServerSnapshot), getOperations: () => [],
    revalidateControlCapability: async () => true, revalidateControlSession: async () => true,
    executeCommand: async (_staff, command, args) => {
      assert.equal(command, 'contacts.checkZaloPhones'); started++
      const input = args[1] as { runId: string; accountId: number }
      return new Promise(resolve => pending.set(input.runId, resolve))
    },
    startControlOperation: () => { throw new Error('Phone checks must remain socket-owned, not detached.') },
    cancelPhoneCheck: (_staff, _account, runId) => { cancellations.push(runId); pending.get(runId)?.({ stopped: true }); pending.delete(runId) }
  })
  const sockets: WebSocket[] = []
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://load-test.akabiz.net' }); sockets.push(socket)
    await once(socket, 'open')
    const now = Math.floor(Date.now() / 1000)
    const payload = Buffer.from(JSON.stringify({ v: 1, jti: randomUUID(), sessionId: 'fixture', staffId: 7, organizationId: 9, capabilities: { zaloServer: true, sms: false }, iat: now, exp: now + 60 })).toString('base64url')
    const hello = once(socket, 'message')
    socket.send(JSON.stringify({ type: 'authenticate', token: `${payload}.${sign(null, Buffer.from(payload), key.privateKey).toString('base64url')}` }))
    assert(JSON.parse(String((await hello)[0])).phoneCheckCapabilities.includes('phone_check_web_v1'))
    return socket
  }
  const wait = async (predicate: () => boolean) => { const end = Date.now() + 3000; while (!predicate()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)) } }
  const command = (socket: WebSocket, name: string, args: unknown[]) => {
    const requestId = randomUUID()
    const promise = new Promise<any>(resolve => {
      const listener = (raw: unknown) => { const result = JSON.parse(String(raw)); if (result.requestId === requestId) { socket.off('message', listener); resolve(result) } }
      socket.on('message', listener)
    })
    socket.send(JSON.stringify({ type: 'command', command: name, args, requestId })); return promise
  }
  try {
    await gateway.start(); const first = await connect(), other = await connect()
    const input = { runId: randomUUID(), accountId: 11, limit: 600, phones: ['0901234567'] }
    const run = command(first, 'contacts.checkZaloPhones', [11, input]); await wait(() => started === 1)
    assert.equal((await command(other, 'contacts.cancelPhoneCheck', [11, input.runId])).ok, false)
    assert.equal(cancellations.length, 0)
    assert.equal((await command(first, 'contacts.checkZaloPhones', [11, input])).ok, false)
    assert.equal((await command(first, 'contacts.cancelPhoneCheck', [11, input.runId])).ok, true)
    assert.equal((await run).result.stopped, true)
    const next = { ...input, runId: randomUUID() }; const secondRun = command(first, 'contacts.checkZaloPhones', [11, next]); void secondRun
    await wait(() => started === 2); first.close(); await wait(() => cancellations.includes(next.runId))
    assert.equal(started, 2)
    console.log('PASS: Web capability, live-owned start, duplicate rejection, same-socket cancel, foreign-socket denial, disconnect cancellation.')
  } finally { sockets.forEach(socket => socket.terminate()); await gateway.stop() }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
