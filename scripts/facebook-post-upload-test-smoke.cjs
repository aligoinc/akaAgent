// Exercises v303's promoted, user-tested code with the unchanged PageController and
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
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 60000 })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-post-upload-smoke-'))
app.setPath('userData', path.join(directory, 'profile'))
const sql = fs.readFileSync(path.join(root, 'migrations/migration_v303_promote_facebook_post_media_upload.sql'), 'utf8')
const patch = JSON.parse(sql.split('$promote_patch$')[1])
const md5 = value => createHash('md5').update(value).digest('hex')
const codes = new Map()
for (const block of patch.blocks) {
  const code = block.target_code
  assert.equal(md5(code), block.target_code_md5)
  new vm.Script('(async()=>{' + code + '\n})()')
  assert.doesNotMatch(code, /page\.dropFile/)
  codes.set(block.id, code)
}
assert.deepEqual([...codes.keys()].sort((a,b) => a-b), [29, 2672])
const helperStart = 'async function uploadPostMediaInput('
const helpers = [...codes.values()].map(code => {
  assert.equal(code.split(helperStart).length, 2)
  return code.slice(code.indexOf(helperStart)).trim()
})
assert.equal(helpers[0], helpers[1], 'Both promoted blocks use the same tested upload helper')
const helper = helpers[0]
assert.deepEqual(patch.workflows.filter(w => w.node_id).map(w => w.id).sort(), [250, 251, 252])
assert.deepEqual(patch.workflows.filter(w => !w.node_id).map(w => w.id).sort((a,b) => a-b), [1, 2, 226])

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
      window.dropCount=0; window.changeTargets=[];
      window.addEventListener('drop',()=>window.dropCount++);
      document.addEventListener('change',e=>window.changeTargets.push(e.target.id));
    </script>`))
}

async function execute({ files = [image1], mutation = '', aborted = false, failUpload = false, shortCount = false, usePageHelper = false } = {}) {
  await fixture()
  const page = new PageController(window.webContents)
  if (mutation) await page.evaluate(mutation)
  let uploadCalls = 0
  const upload = page.uploadFile.bind(page)
  page.uploadFile = async (selector, paths) => {
    uploadCalls++
    if (failUpload) throw new Error('Simulated CDP failure')
    if (shortCount) return { fileCount: 0 }
    return upload(selector, paths)
  }
  page.dropFile = () => { throw new Error('Unexpected drag/drop fallback') }
  const ctx = vm.createContext({ page, input: { images: files }, vars: {}, signal: { aborted }, helpers: {
    element: async name => { assert.equal(name, 'FbComposerForm'); return xpath },
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
    drops: window.dropCount, changes: window.changeTargets
  }`)
  assert.equal(state.markers, 0, 'Temporary form marker is removed')
  assert.equal(state.drops, 0, 'No global drag/drop event reaches Messenger')
  assert.deepEqual(state.messageFiles, [], 'Messenger input remains empty')
  assert.ok(state.changes.every(id => id === 'post-files'), 'Only the post file input receives changes')
  assert.equal(state.hidden, true, 'Hidden input stays hidden')
  return { output, error, state, uploadCalls }
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
  }
  const empty = await execute({ files: [] })
  assert.equal(empty.output.fileCount, 0)
  assert.equal(empty.uploadCalls, 0)
  for (const [mutation, expected, files] of [
    ["document.querySelector('#composer').remove()", /đúng 1 form/, [image1]],
    ["document.querySelector('[role=dialog]').append(document.querySelector('#composer').cloneNode(true))", /đúng 1 form/, [image1]],
    ["document.querySelector('#post-files').remove()", /đúng 1 input/, [image1]],
    ["document.querySelector('#composer').append(document.querySelector('#post-files').cloneNode())", /đúng 1 input/, [image1]],
    ["document.querySelector('#post-files').disabled=true", /vô hiệu hóa/, [image1]],
    ["document.querySelector('#post-files').accept='application/pdf'", /không nhận ảnh/, [image1]],
    ["document.querySelector('#post-files').multiple=false", /không hỗ trợ chọn nhiều/, [image1,image2]]
  ]) {
    const result = await execute({ mutation, files })
    assert.match(result.error?.message || '', expected)
    assert.equal(result.uploadCalls, 0)
  }
  const cancelled = await execute({ aborted: true })
  assert.match(cancelled.error.message, /Đã dừng/)
  assert.equal(cancelled.uploadCalls, 0)
  const failed = await execute({ failUpload: true })
  assert.match(failed.error.message, /CDP failure/)
  const short = await execute({ shortCount: true })
  assert.match(short.error.message, /Không đưa đủ/)
  console.log('PASS: v303 promoted code, real Electron/CDP hidden-input upload, image/multiple/video file transport, Messenger isolation, ambiguity/disabled/cancel/error guards and cleanup.')
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
