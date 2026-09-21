// Exercises v304's native upload and missing-input fallback with unchanged PageController and
// Electron/CDP. Local fixtures only: no Facebook navigation or publication.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 120000 })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-post-upload-smoke-'))
app.setPath('userData', path.join(directory, 'profile'))
const sql = fs.readFileSync(path.join(root, 'migrations/migration_v304_facebook_post_media_missing_input_fallback.sql'), 'utf8')
const patch = JSON.parse(sql.split('$fallback_patch$')[1])
const md5 = value => createHash('md5').update(value).digest('hex')
const codes = new Map()
for (const block of patch.blocks) {
  const code = block.target_code
  assert.equal(md5(code), block.target_code_md5)
  new vm.Script('(async()=>{' + code + '\n})()')
  codes.set(block.id, code)
}
assert.deepEqual([...codes.keys()].sort((a,b) => a-b), [29, 2672])
const helperStart = 'async function uploadPostMediaInput('
const helpers = [...codes.values()].map(code => {
  assert.equal(code.split(helperStart).length, 2)
  return code.slice(code.indexOf(helperStart)).trim()
})
assert.equal(helpers[0], helpers[1], 'Both blocks use the same upload/fallback helper')
const helper = helpers[0]
assert.doesNotMatch(helper, /helpers\.log|console\./, 'Upload routing adds no technical progress logs')
assert.deepEqual(patch.workflows.map(w => w.id).sort((a,b) => a-b), [1, 2, 226, 250, 251, 252])

const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/v2/runtime/pageController.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const moduleObject = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, moduleObject, moduleObject.exports)
const { PageController } = moduleObject.exports
const xpath = "//*[@role='dialog']//form[@method='POST']"
const image1 = path.join(directory, 'one.png')
const image2 = path.join(directory, 'two.png')
const video = path.join(directory, 'clip.mp4')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
fs.writeFileSync(image1, png)
fs.writeFileSync(image2, png)
fs.writeFileSync(video, 'local CDP file transport fixture, not a playable video')
let window

async function fixture() {
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
    <style>form{width:400px;height:200px}input[type=file]{display:none}</style>
    <section role="dialog"><form method="POST" id="composer">
      <div contenteditable="true" role="textbox">Post draft</div>
      <input id="post-files" type="file" accept="image/*,video/*" multiple>
    </form></section>
    <section id="messenger"><div contenteditable="true" role="textbox">Message draft</div>
      <input id="message-files" type="file" accept="image/*" multiple></section>
    <script>
      window.dropCount=0; window.changeTargets=[]; window.postDrops=[]; window.messageDrops=0;
      window.addEventListener('drop',()=>window.dropCount++);
      document.querySelector('#composer').addEventListener('drop',e=>window.postDrops.push({
        files:Array.from(e.dataTransfer.files,f=>f.name),
        editor:e.target.matches('[contenteditable="true"]')
      }));
      document.querySelector('#messenger').addEventListener('drop',()=>window.messageDrops++);
      document.addEventListener('change',e=>window.changeTargets.push(e.target.id));
    </script>`))
}

async function execute({ files = [image1], mutation = '', aborted = false, cancelAfterPrepare = false, failUpload = false, shortCount = false, failDrop = false, shortDrop = false, usePageHelper = false } = {}) {
  await fixture()
  const page = new PageController(window.webContents)
  if (mutation) await page.evaluate(mutation)
  let uploadCalls = 0
  let dropCalls = 0
  const signal = { aborted }
  const evaluate = page.evaluate.bind(page)
  page.evaluate = async (...args) => {
    const result = await evaluate(...args)
    if (cancelAfterPrepare && (result === 'upload' || result === 'drop')) signal.aborted = true
    return result
  }
  const upload = page.uploadFile.bind(page)
  page.uploadFile = async (selector, paths) => {
    uploadCalls++
    if (failUpload) throw new Error('Simulated CDP failure')
    if (shortCount) return { fileCount: 0 }
    return upload(selector, paths)
  }
  const drop = page.dropFile.bind(page)
  page.dropFile = async (selector, paths) => {
    dropCalls++
    assert.match(selector, /^form\[data-aka-post-media-upload="post_media_[^"]+"\]$/)
    assert.equal(await evaluate('return document.querySelector(__args[0])?.id', selector), 'composer')
    if (failDrop) throw new Error('Simulated drop failure')
    if (shortDrop) return { fileCount: 0 }
    return drop(selector, paths)
  }
  const ctx = vm.createContext({ page, input: { images: files }, vars: {}, signal, helpers: {
    element: async name => { assert.equal(name, 'FbComposerForm'); return xpath },
    log: () => { throw new Error('Unexpected technical progress log') },
    sleep: async ms => assert.equal(ms, 2000)
  } })
  let output, error
  try {
    output = usePageHelper
      ? await vm.runInContext('(async()=>{' + helper + '\nreturn uploadPostMediaInput(' + JSON.stringify(xpath) + ', input.images)})()', ctx)
      : await vm.runInContext('(async()=>{' + codes.get(29) + '\n})()', ctx)
  } catch (e) { error = e }
  const state = await page.evaluate(`return {
    postFiles: Array.from(document.querySelector('#post-files')?.files || [], f=>f.name),
    messageFiles: Array.from(document.querySelector('#message-files').files, f=>f.name),
    hidden: document.querySelector('#post-files') ? getComputedStyle(document.querySelector('#post-files')).display === 'none' : true,
    markers: document.querySelectorAll('[data-aka-post-media-upload]').length,
    drops: window.dropCount, changes: window.changeTargets,
    postDrops: window.postDrops, messageDrops: window.messageDrops
  }`)
  assert.equal(state.markers, 0, 'Temporary form marker is removed')
  if (!dropCalls) assert.equal(state.drops, 0, 'Native upload dispatches no drop events')
  assert.equal(state.messageDrops, 0, 'Messenger is never the direct drop target')
  assert.deepEqual(state.messageFiles, [], 'Messenger input remains empty')
  if (!dropCalls) assert.ok(state.changes.every(id => id === 'post-files'), 'Only the post file input receives changes')
  assert.equal(state.hidden, true, 'Hidden input stays hidden')
  return { output, error, state, uploadCalls, dropCalls }
}

async function main() {
  await app.whenReady()
  app.dock?.hide()
  window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  for (const [files, usePageHelper] of [[[image1], false], [[image1,image2], false], [[video], true], [[image1,video], true]]) {
    const result = await execute({ files, usePageHelper })
    assert.equal(result.error, undefined)
    assert.equal(result.output.fileCount, files.length)
    assert.deepEqual(result.state.postFiles, files.map(p => path.basename(p)))
    assert.equal(result.uploadCalls, 1)
    assert.equal(result.dropCalls, 0)
  }
  const missingInput = "document.querySelector('#post-files').remove()"
  for (const [files, usePageHelper] of [[Array(8).fill(image1), false], [[video], true]]) {
    const result = await execute({ files, mutation: missingInput, usePageHelper })
    assert.equal(result.error, undefined)
    assert.equal(result.output.fileCount, files.length)
    assert.equal(result.uploadCalls, 0)
    assert.equal(result.dropCalls, 1)
    assert.equal(result.state.drops, files.length)
    assert.deepEqual(result.state.postDrops.map(d => d.files), files.map(p => [path.basename(p)]))
    assert.ok(result.state.postDrops.every(d => d.editor), 'One editor receives one drop per file')
  }
  const empty = await execute({ files: [] })
  assert.equal(empty.output.fileCount, 0)
  assert.equal(empty.uploadCalls, 0)
  assert.equal(empty.dropCalls, 0)
  for (const [mutation, expected, files] of [
    ["document.querySelector('#composer').remove()", /đúng 1 form/, [image1]],
    ["document.querySelector('[role=dialog]').append(document.querySelector('#composer').cloneNode(true))", /đúng 1 form/, [image1]],
    ["document.querySelector('#composer').append(document.querySelector('#post-files').cloneNode())", /đúng 1 input/, [image1]],
    ["document.querySelector('#post-files').disabled=true", /vô hiệu hóa/, [image1]],
    ["document.querySelector('#post-files').accept='application/pdf'", /không nhận ảnh/, [image1]],
    ["document.querySelector('#post-files').multiple=false", /không hỗ trợ chọn nhiều/, [image1,image2]]
  ]) {
    const result = await execute({ mutation, files })
    assert.match(result.error?.message || '', expected)
    assert.equal(result.uploadCalls, 0)
    assert.equal(result.dropCalls, 0)
  }
  const cancelled = await execute({ aborted: true })
  assert.match(cancelled.error.message, /Đã dừng/)
  assert.equal(cancelled.uploadCalls, 0)
  assert.equal(cancelled.dropCalls, 0)
  for (const mutation of ['', missingInput]) {
    const cancelledAfterPrepare = await execute({ mutation, cancelAfterPrepare: true })
    assert.match(cancelledAfterPrepare.error.message, /Đã dừng/)
    assert.equal(cancelledAfterPrepare.uploadCalls, 0)
    assert.equal(cancelledAfterPrepare.dropCalls, 0)
  }
  const failed = await execute({ failUpload: true })
  assert.match(failed.error.message, /CDP failure/)
  assert.equal(failed.dropCalls, 0, 'An upload exception must not retry by drag/drop')
  const short = await execute({ shortCount: true })
  assert.match(short.error.message, /Không đưa đủ/)
  assert.equal(short.dropCalls, 0, 'A partial upload must not be duplicated by fallback')
  const dropFailure = await execute({ mutation: missingInput, failDrop: true })
  assert.match(dropFailure.error.message, /drop failure/)
  assert.equal(dropFailure.dropCalls, 1)
  const partialDrop = await execute({ mutation: missingInput, shortDrop: true })
  assert.match(partialDrop.error.message, /Không đưa đủ/)
  assert.equal(partialDrop.dropCalls, 1)
  console.log('PASS: v304 native upload, zero-input legacy fallback (8 files and Page helper), no technical progress logs, no fallback on ambiguity/upload failure/partial upload, cancellation and cleanup. Local fixture only; Facebook global drop routing is not verified.')
}

main().then(() => finish(0), error => { console.error(error); finish(1) })
function finish(code) {
  process.exitCode = code
  window?.destroy()
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } finally {
    // app.quit() can exit successfully before a deferred app.exit(1) runs.
    app.exit(code)
  }
}
