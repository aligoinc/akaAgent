const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = ts.createSourceFile('handlers.ts', fs.readFileSync(path.join(root, 'src/main/ipc/handlers.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
let subject
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'syncZaloBackgroundForCurrentUser') subject = node.initializer.getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
assert(subject)
function run(user) {
  const calls = []
  const context = {
    getCurrentUser: () => user,
    getUserZaloAccountCapabilities: () => ({ qr: user?.entitlements?.zalo === true }),
    warmZaloSessions: () => calls.push('warm'),
    zaloLocalChatSync: { start: () => calls.push('chat-start'), stop: () => calls.push('chat-stop') },
    zaloRealtimeGroupManager: { start: () => calls.push('group-start'), stop: () => calls.push('group-stop') },
    zaloRuntime: { clearAll: () => calls.push('runtime-clear') },
    stopZaloRemoteClients: () => calls.push('clients-stop')
  }
  vm.runInNewContext(ts.transpileModule(`(${subject})('test')`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return calls
}
assert.deepEqual(run({ entitlements: { zalo: true } }), ['warm', 'chat-start', 'group-start'])
assert.deepEqual(run({ entitlements: { zalo: false } }), ['group-stop', 'chat-stop', 'runtime-clear', 'clients-stop'])
const user = { entitlements: { zalo: false, facebook: true }, appAccess: { separateAccess: true, usesChatRuntime: true, staff: { akaAgentAllowed: true, akachatAllowed: false, stopping: false } } }
assert.deepEqual(run(user), ['warm', 'chat-start', 'group-stop'])
user.appAccess.staff.akaAgentAllowed = false
assert.deepEqual(run(user), ['group-stop', 'chat-stop', 'runtime-clear', 'clients-stop'])
user.appAccess.staff.stopping = true
assert.deepEqual(run(user), ['group-stop'])
console.log('app-access runtime smoke: 5 cases passed (production lifecycle function, simulated runtime)')
