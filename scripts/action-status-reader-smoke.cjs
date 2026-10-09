const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file) {
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports: mod.exports, module: mod, Object, Array, Number, Set, Map, Error, JSON })
  return mod.exports
}
const { automationSubStatusField: field, automationSubFilterCovers: covers } = load('src/shared/automationResultFilters.ts')
const json = value => JSON.parse(JSON.stringify(value))
assert.deepEqual(json(field({})), {})
assert.deepEqual(json(field({ subStatusIds: undefined })), {})
assert.deepEqual(json(field({ sub_status_ids: null })), { subStatusIds: null })
assert.deepEqual(json(field({ sub_status_ids: [53,52,52] })), { subStatusIds: [52,53] })
for (const value of [[], [null], ['52'], [0], [-1], [1.5], '52']) assert.throws(() => field({ subStatusIds: value }), /invalid_automation_sub_status_ids/)
assert(covers(null, [52]))
assert(covers([52,53], [52]))
assert(!covers([52], [53]))
assert(!covers([52], null))
const { formatAutomationTriggerLabel: label } = load('src/renderer/src/components/Automation/automationDisplay.ts')
assert.equal(label({ status: 'thành công', actionCode: 'fb_post_group', actionName: 'Đăng bài', subStatusIds: [52], subStatusLabels: ['Chờ duyệt bài'] }), 'thành công (Chờ duyệt bài) — Đăng bài')
assert.equal(label({ status: 'thành công', actionCode: 'fb_post_group', actionName: 'Đăng bài' }), 'thành công — Đăng bài')
console.log('PASS Automation preserves omission/null/arrays, constrained wildcard scopes, and legacy labels')
