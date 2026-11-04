const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const source = ts.createSourceFile('runtime.ts', fs.readFileSync(path.join(__dirname, '../src/main/services/zaloRuntimeService.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const runtime = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ZaloRuntimeService')
const names = ['startLoginQr', 'cancelLoginQr', 'cancelLoginQrAndWait', 'runLoginQr']
const methods = names.map(name => runtime.members.find(node => node.name?.getText(source) === name).getText(source)).join('\n')
const subject = {}
vm.runInNewContext(ts.transpileModule(`export class Subject { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: subject, console, DEFAULT_ZALO_USER_AGENT: 'fixture', DEFAULT_LANGUAGE: 'vi',
  ZaloQrCandidateValidationError: class extends Error {}
})
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function fixture() {
  const calls = [], events = []
  const account = { id: 1, flatformType: 'zalo' }
  const service = Object.assign(new subject.Subject(), {
    activeQrLogins: new Map(), cacheVersion: 0,
    supabase: {
      getAccountForZaloRuntime: async () => account,
      updateLocalQrOperation: async (_id, _op, action) => { calls.push(action) },
      upsertZaloAccount: async () => ({ id: 10, zaloUid: 'fixture' }),
      updateAccountZaloSession: async (_id, data) => { calls.push(['commit', data]); return account },
      markAccountZaloSessionCheck: async () => calls.push('mark')
    },
    invalidateAccount() {},
    createZaloClient: async () => ({ loginQR: async () => { calls.push('provider'); return {} } }),
    getSessionCredentialsFromApi: () => ({ cookie: 'synthetic-only' }),
    loadOwnProfile: async () => ({ zaloUid: 'fixture' }),
    cacheApi: () => calls.push('cache'),
    logLoginQrFailure() {}, getErrorMessage: error => error.message,
    publishLoginQrEvent: event => events.push(event),
    waitForSettled: async promises => { await Promise.allSettled(promises); return true }
  })
  return { service, calls, events }
}
async function main() {
  for (const remote of [false, true]) {
    const { service, calls } = fixture()
    await service.startLoginQr(1, { operationId: 'fixture-operation', claimToken: 'fixture-token', remote })
    await flush()
    assert.equal(calls[0], remote ? 'bind' : 'begin')
    assert.equal(calls[1], 'provider')
    const commit = calls.find(call => Array.isArray(call))
    assert.equal(commit[1].qrOperationId, 'fixture-operation')
    assert.equal(commit[1].claimToken, 'fixture-token')
    assert(calls.includes('cache'))
  }
  {
    const { service, calls, events } = fixture()
    service.supabase.updateAccountZaloSession = async () => { throw Error('Quyền đã thay đổi') }
    await service.startLoginQr(1, { operationId: 'fixture-operation', claimToken: 'fixture-token' })
    await flush()
    assert(!calls.includes('mark')) // Do not downgrade the previously saved session.
    assert(!calls.includes('cache'))
    assert.equal(events.at(-1).status, 'error')
  }
  {
    const { service, calls } = fixture()
    let prepared
    service.supabase.updateLocalQrOperation = async (_id, _op, action) => {
      calls.push(action)
      if (action === 'begin') await new Promise(resolve => { prepared = resolve })
    }
    const starting = service.startLoginQr(1, { operationId: 'fixture-operation', claimToken: 'fixture-token' })
    await flush()
    let stopped = false
    const stopping = service.cancelLoginQrAndWait(1).then(value => { stopped = true; return value })
    await flush()
    assert.equal(stopped, false)
    prepared()
    assert.equal((await starting).success, false)
    assert.equal(await stopping, true)
    assert(!calls.includes('provider'))
    assert.equal(calls.at(-1), 'cancel')
    assert.equal(service.activeQrLogins.size, 0)
  }
  console.log('app-access QR smoke: 4 cases passed (production methods, simulated provider/DB)')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
