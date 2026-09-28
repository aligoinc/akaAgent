const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { randomUUID } = require('node:crypto')
const { build } = require('esbuild')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  const deadline = Date.now() + 5000
  while (!check()) { assert(Date.now() < deadline, 'Timed out waiting for IPC update'); await delay(5) }
}
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-support-routing-'))
  const originalFetch = global.fetch
  let lifecycle
  try {
    const handlers = new Map()
    const states = new Map()
    const calls = []
    const remote = new Map()
    const user = { staffId: 7, organizationId: 1 }
    let destroyed
    const webContents = { mainFrame: {}, once: (_event, fn) => { destroyed = fn },
      send: (_channel, state) => states.set(state.variant, state) }
    global.__supportRouting = { directory, handlers, user }
    const output = join(directory, 'routing.cjs')
    await build({
      stdin: { contents: `
        export { registerCampaignSupportHandlers } from './src/main/ipc/handlers/campaignSupportHandlers';
        export { CAMPAIGN_SUPPORT_IPC } from './src/shared/campaignSupport';
        export { webp } from './scripts/campaign-support-image-fixtures';
      `, resolveDir: resolve(__dirname, '..') },
      outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning',
      plugins: [{ name: 'local-support-routing', setup(plugin) {
        plugin.onResolve({ filter: /^(electron)$|\/data\/currentUser$|\/repositories\/campaignRepository$/ }, args => ({ path: args.path, namespace: 'routing' }))
        plugin.onLoad({ filter: /.*/, namespace: 'routing' }, args => ({ contents: args.path === 'electron' ? `
          export const app = { getPath: () => globalThis.__supportRouting.directory };
          export const ipcMain = { handle: (channel, fn) => globalThis.__supportRouting.handlers.set(channel, fn) };
          export const nativeImage = { createFromBuffer: () => { throw new Error('Image decode is covered by Electron smoke'); } };
        ` : args.path.endsWith('/currentUser') ? `
          export const getCurrentUser = () => globalThis.__supportRouting.user;
        ` : `export const requireCampaignSupportAccess = async (id, staffId, organizationId) => {
          if (id !== 17 || staffId !== 7 || organizationId !== 1) throw new Error('No access');
        };` }))
      } }]
    })
    const { registerCampaignSupportHandlers, CAMPAIGN_SUPPORT_IPC: ipc, webp } = require(output)
    let failNext = false
    global.fetch = async (input, init) => {
      const url = new URL(input)
      assert.equal(url.origin, 'https://aka10000.fly.dev')
      const match = url.pathname.match(/^\/api\/public\/agents\/(campaign-support(?:-dsh)?)\/(respond|runs\/.+)$/)
      assert(match, 'Only the documented API family may be used')
      const variant = match[1].endsWith('-dsh') ? 'dsh' : 'standard'
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ variant, url: url.href, body })
      if (failNext) {
        failNext = false
        return new Response(JSON.stringify({ success: false, error: { code: 'UNAVAILABLE', message: 'Retry fixture' } }), { status: 503 })
      }
      let data
      if (match[2] === 'respond') {
        const conversationId = body.conversationId || randomUUID()
        const turnId = randomUUID()
        data = { conversationId, turnId, status: body.question === 'busy' ? 'working' : 'completed',
          statusUrl: `${url.origin}/api/public/agents/${match[1]}/runs/${conversationId}/${turnId}` }
        remote.set(data.statusUrl, data)
      } else {
        data = remote.get(url.href)
        assert(data, 'Run must belong to the selected API')
        if (body?.action) data.status = body.action === 'cancel' ? 'cancelled' : 'completed'
      }
      return new Response(JSON.stringify({ success: true, data: { ...data, answer: data.status === 'completed' ? 'Fixture answer' : '',
        progress: { state: data.status, stage: null, reason: null, attempts: 1 } } }))
    }
    lifecycle = registerCampaignSupportHandlers({ webContents, isDestroyed: () => false })
    const event = { sender: webContents, senderFrame: webContents.mainFrame }
    const invoke = async (channel, ...args) => handlers.get(channel)(event, ...args)
    const latest = variant => states.get(variant)
    await delay(20)
    assert.equal(calls.length, 0, 'Idle registration must not make requests')
    for (const variant of ['invalid', '__proto__', null]) await assert.rejects(invoke(ipc.open, 17, undefined, variant), /không hợp lệ/)
    assert.throws(() => handlers.get(ipc.open)({ sender: {}, senderFrame: {} }, 17), /quyền/)
    const standard = await invoke(ipc.open, 17)
    const dsh = await invoke(ipc.open, 17, randomUUID(), 'dsh')
    await until(() => latest('standard')?.turns[0]?.result && latest('dsh')?.turns[0]?.result)
    assert.notEqual(standard.id, dsh.id)
    const standardSnapshot = structuredClone(latest('standard'))
    for (const variant of ['standard', 'dsh']) {
      const folder = variant === 'standard' ? 'campaign-support' : 'campaign-support-dsh'
      assert.equal(JSON.parse(readFileSync(join(directory, folder, '1_7/17/current.json'))).variant, variant)
    }
    await assert.rejects(invoke(ipc.send, { variant: 'standard', campaignId: 17, conversationKey: dsh.id, question: 'wrong', images: [] }), /thay đổi/)
    const request = { variant: 'dsh', campaignId: 17, conversationKey: dsh.id, question: 'busy', images: [webp] }
    await invoke(ipc.send, request)
    await until(() => latest('dsh').turns.at(-1)?.result?.status === 'working')
    const turn = latest('dsh').turns.at(-1)
    const follow = calls.at(-1)
    assert.equal(follow.variant, 'dsh')
    assert.equal(follow.body.conversationId, latest('dsh').turns[0].result.conversationId)
    assert.equal(await invoke(ipc.image, { ...request, requestId: turn.requestId, index: 0 }), `data:image/webp;base64,${webp.dataBase64}`)
    await invoke(ipc.control, { ...request, requestId: turn.requestId, action: 'cancel' })
    await until(() => latest('dsh').turns.at(-1)?.result?.status === 'cancelled')
    await invoke(ipc.control, { ...request, requestId: turn.requestId, action: 'resume' })
    await until(() => latest('dsh').turns.at(-1)?.result?.status === 'completed')
    failNext = true
    await invoke(ipc.send, { ...request, question: 'retry', images: [] })
    await until(() => latest('dsh').turns.at(-1)?.retryable)
    const retryBody = calls.at(-1).body
    await invoke(ipc.retry, 17, dsh.id, 'dsh')
    await until(() => latest('dsh').turns.at(-1)?.result?.status === 'completed')
    assert.deepEqual(calls.at(-1).body, retryBody)
    const empty = await invoke(ipc.reset, 17, dsh.id, 'dsh')
    assert.equal(empty.turns.length, 0)
    assert.equal((await invoke(ipc.open, 17, undefined, 'dsh')).id, empty.id)
    assert.deepEqual(latest('standard'), standardSnapshot, 'DSH operations must not modify the original conversation')
    assert.equal(calls.filter(call => call.variant === 'standard').length, 1)
    lifecycle.stop()
    for (const variant of ['standard', 'dsh']) await assert.rejects(invoke(ipc.open, 17, undefined, variant), /đăng nhập/)
    lifecycle.startSession()
    assert.equal((await invoke(ipc.open, 17)).id, standard.id)
    assert.equal((await invoke(ipc.open, 17, undefined, 'dsh')).id, empty.id)
    destroyed()
    for (const variant of ['standard', 'dsh']) await assert.rejects(invoke(ipc.open, 17, undefined, variant), /đăng nhập/)
    console.log('PASS actual IPC/service routing: isolated storage, events, follow-up/images/cancel/resume/retry/reset, allowlist and shared lifecycle')
  } finally {
    lifecycle?.stop()
    global.fetch = originalFetch
    delete global.__supportRouting
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
