// Execute the actual migration block code with a deterministic browser/clock.
// No Facebook posting, production data writes or real large media allocation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createHash } = require('node:crypto')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const sql = fs.readFileSync(path.join(root, 'migrations/migration_v278_facebook_post_publish_confirmation.sql'), 'utf8')
const patch = JSON.parse(sql.split('$publish_patch$')[1])
const codes = new Map(patch.blocks.map(item => [item.name, item.code]))
const dataVideoSql = fs.readFileSync(path.join(root, 'migrations/migration_v279_facebook_data_video_publish_timeout.sql'), 'utf8')
const dataVideoPatch = JSON.parse(dataVideoSql.split('$data_video_patch$')[1])
const md5 = value => createHash('md5').update(value).digest('hex')
for (const item of dataVideoPatch.blocks) {
  const source = codes.get(item.name)
  assert.equal(md5(source), item.source_code_md5, item.name + ': fixture matches live source')
  assert.equal(source.split(item.before).length, 2, item.name + ': exactly one replacement')
  const updated = source.replace(item.before, item.after)
  assert.equal(md5(updated), item.code_md5, item.name + ': fixture matches migration output')
  codes.set(item.name, updated)
}

const cache = new Map()
function loadTs(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename)
  const exports = {}
  cache.set(filename, exports)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  new Function('exports', 'require', compiled)(exports, name => name.startsWith('.')
    ? loadTs(path.resolve(path.dirname(filename), name + '.ts'))
    : require(name))
  return exports
}

async function runBlock(name, options = {}) {
  let now = 1_000_000
  let submittedAt = null
  let clickCount = 0
  let closeAfterSubmit = 0
  let abort = false
  const requestedElements = []
  const logs = []
  const vars = {
    images: options.images ?? ['/local/image.jpg'],
    videoPath: '/local/video.mp4',
    campaignContent: '',
    ...(options.vars || {})
  }
  const signal = { get aborted() { return abort } }
  const closeAt = options.closeAt ?? 12_000
  const age = () => submittedAt === null ? 0 : now - submittedAt
  const isPublish = selector => ['fb_post_button', 'fb_reels_publish_button', 'FbComposerSubmitButton'].includes(selector)
  function element(selector) {
    return {
      disabled: true, // Important: disabled must not be treated as disappeared.
      style: { display: 'block', visibility: 'visible', opacity: '1' },
      getBoundingClientRect: () => ({ width: 100, height: 40 }),
      getAttribute: () => '',
      scrollIntoView() {}, focus() {}, dispatchEvent() {},
      click() {
        if (isPublish(selector)) { submittedAt = now; clickCount++ }
        if (selector === 'FbComposerCloseDialogButton' && submittedAt !== null) closeAfterSubmit++
      }
    }
  }
  function matches(selector) {
    if (selector === 'GroupPostFrequencyLimitError') return options.frequencyLimit ? [element(selector)] : []
    if (selector === 'FbComposerErrorMessage') return []
    if (isPublish(selector) || selector === 'GroupPostSubmitButtonAfterClick') {
      return age() >= closeAt || options.missingButton ? [] : [element(selector)]
    }
    if (['FbComposerOpenButton', 'FbComposerCloseDialogButton'].includes(selector)) return [element(selector)]
    return []
  }
  const document = {
    evaluate(selector) {
      if (options.browserError && submittedAt !== null) throw new Error('Browser unavailable')
      const list = matches(selector)
      return { snapshotLength: list.length, snapshotItem: index => list[index] }
    }
  }
  const browserWindow = { getComputedStyle: el => el.style }
  class BrowserEvent {}
  const page = {
    async $(selector) { return matches(selector)[0] || null },
    async waitForSelector(selector) { if (!matches(selector).length) throw new Error('Missing button'); return true },
    async click(selector) {
      const el = matches(selector)[0]
      if (!el) throw new Error('Missing button')
      el.click()
    },
    async navigate() {}, async fill() {},
    async uploadFile() { return { fileCount: 1 } },
    async dropFile(_selector, images) { return { fileCount: images.length } },
    async evaluate(code, ...args) {
      return new Function('document', 'window', 'XPathResult', '__args', 'location', 'FocusEvent', 'PointerEvent', 'MouseEvent', code)(
        document, browserWindow, { ORDERED_NODE_SNAPSHOT_TYPE: 7 }, args,
        { href: 'https://www.facebook.com/profile.php' }, BrowserEvent, BrowserEvent, BrowserEvent
      )
    }
  }
  const helpers = {
    async element(value) { requestedElements.push(value); return value },
    async sleep(ms) {
      now += ms
      if (options.abortAt !== undefined && age() >= options.abortAt) abort = true
      if (abort) throw new Error('Cancelled')
    },
    log(message) { logs.push(message) }
  }
  class Clock extends Date { static now() { return now } }
  const context = vm.createContext({ page, helpers, vars, input: { verifyPostAfterClick: true }, signal, Date: Clock, URL })
  let output, error
  try {
    if (name === 'fb_verify_group_post_form_closed') {
      context.input = {}
      await vm.runInContext(`(async()=>{${codes.get('fb_click_post_button')}\n})()`, context)
    }
    output = await vm.runInContext(`(async()=>{${codes.get(name)}\n})()`, context)
  } catch (e) { error = e }
  return { output, error, elapsed: age(), clickCount, closeAfterSubmit, requestedElements, logs, vars }
}

async function testPublish() {
  for (const name of codes.keys()) {
    const result = await runBlock(name, { images: ['/local/video.mp4'], closeAt: 12_000 })
    assert.equal(result.error, undefined, name)
    assert.equal(result.output.posted, true, name)
    assert.ok(result.elapsed >= 12_000 && result.elapsed < 20_000, name + ': exits early')
    assert.equal(result.clickCount, 1, name + ': no repeated submit')
    const timeout = await runBlock(name, { images: ['/local/video.mp4'], closeAt: Infinity })
    assert.equal(timeout.elapsed, 180_000, name + ': exactly 180 seconds since submit')
    assert.match(String(timeout.error?.message || timeout.output?.message || timeout.output?.error), /180 giây/, name)
    assert.notEqual(timeout.output?.posted, true, name)
    assert.equal(timeout.clickCount, 1, name)
    assert.equal(timeout.closeAfterSubmit, 0, name + ': preserve failed browser for screenshot')
    const cancelled = await runBlock(name, { closeAt: Infinity, abortAt: 5_000 })
    assert.ok(cancelled.error, name + ': cancellation propagates')
    assert.ok(cancelled.elapsed < 60_000, name)
  }
  for (const name of ['fb_click_post_button', 'fb_verify_group_post_form_closed', 'fb_post_current_identity_ui']) {
    const result = await runBlock(name, { images: ['/local/image.jpg'], closeAt: Infinity })
    const expected = name === 'fb_post_current_identity_ui' ? 120_000 : 60_000
    assert.equal(result.elapsed, expected, name)
    assert.match(String(result.error?.message || result.output?.message || result.output?.error), new RegExp(`${expected / 1000} giây`))
    // Any selected video extends the timeout, even when it is not the first media.
    const mixed = await runBlock(name, { images: ['/local/image.jpg', '/local/VIDEO.MOV'], closeAt: Infinity })
    assert.equal(mixed.elapsed, 180_000, name)
    for (const media of ['data:video/mp4;base64,AAAA', 'data:video/webm;base64,AAAA']) {
      const dataVideo = await runBlock(name, { images: ['/local/image.jpg', media], closeAt: Infinity })
      assert.equal(dataVideo.elapsed, 180_000, name + ': data video gets the full timeout')
      assert.match(String(dataVideo.error?.message || dataVideo.output?.message || dataVideo.output?.error), /180 giây/)
      assert.notEqual(dataVideo.output?.posted, true)
    }
    const dataVideoClosed = await runBlock(name, { images: ['data:video/mp4;base64,AAAA'], closeAt: 90_000 })
    assert.equal(dataVideoClosed.error, undefined, name + ': data video can close after 60 seconds')
    assert.equal(dataVideoClosed.output.posted, true, name)
    assert.ok(dataVideoClosed.elapsed >= 90_000 && dataVideoClosed.elapsed < 100_000, name + ': data video exits early')
    const dataImage = await runBlock(name, { images: ['data:image/png;base64,AAAA'], closeAt: Infinity })
    assert.equal(dataImage.elapsed, expected, name + ': data image keeps the non-video timeout')
  }
  const limited = await runBlock('fb_verify_group_post_form_closed', { closeAt: Infinity, frequencyLimit: true })
  assert.match(limited.error.message, /giới hạn tần suất bạn đăng bài/)
  assert.equal(limited.vars.groupPostSubmitted, false)
  for (const name of ['fb_click_post_button', 'fb_post_reels']) {
    const missing = await runBlock(name, { missingButton: true })
    assert.ok(missing.error)
    assert.equal(missing.clickCount, 0)
    const broken = await runBlock(name, { browserError: true })
    assert.match(broken.error.message, /Browser unavailable/)
    assert.notEqual(broken.output?.posted, true)
  }
}

function testMedia() {
  global.window = { electronAPI: { getPathForFile: file => '/local/' + file.name, fileExists: () => true, platform: 'darwin' } }
  const { selectLocalCampaignMedia } = loadTs('src/renderer/src/components/CampaignPanels/localCampaignMedia.ts')
  const video = { name: 'large.mp4', type: 'video/mp4', size: 8 * 1024 ** 3 }
  for (const actionId of ['facebook_timeline_post', 'facebook_group_post', 'facebook_page_post']) {
    const result = selectLocalCampaignMedia([video], { mode: 'image-video', actionId, target: 'post' })
    assert.equal(result.failures.length, 0, actionId)
    assert.equal(result.snapshots[0].sizeBytes, video.size)
    assert.equal(result.snapshots[0].provider, 'local')
    assert.equal(selectLocalCampaignMedia([video], { mode: 'image-video', actionId, target: 'comment' }).snapshots.length, 0)
    assert.equal(selectLocalCampaignMedia([{ name: 'big.jpg', type: 'image/jpeg', size: 6 * 1024 ** 2 }], { mode: 'image-video', actionId, target: 'post' }).snapshots.length, 0)
  }
  for (const actionId of ['facebook_message_friend', 'facebook_comment_seeding', 'zalo_message_friend', 'email_send', undefined]) {
    assert.equal(selectLocalCampaignMedia([video], { mode: 'file', actionId, target: 'post' }).snapshots.length, 0, actionId)
  }
  assert.equal(selectLocalCampaignMedia([video], { mode: 'video', actionId: 'facebook_timeline_post', target: 'post' }).snapshots.length, 1)
  assert.equal(selectLocalCampaignMedia([video], { mode: 'image', actionId: 'facebook_page_post', target: 'post' }).snapshots.length, 0, 'Page API remains image-only')
  const limits = loadTs('src/shared/types.ts')
  assert.equal(limits.MEDIA_FILE_MAX_SIZE_BYTES, 25 * 1024 ** 2)
  assert.equal(limits.MEDIA_IMAGE_MAX_SIZE_BYTES, 5 * 1024 ** 2)
}

function testCapturePolicy() {
  const source = ts.createSourceFile('engine.ts', fs.readFileSync(path.join(root, 'src/main/v2/runtime/workflowEngine.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const klass = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'WorkflowEngineV2')
  const method = klass.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === 'resolveAfterScreenshotCapture').getText(source)
  const helpers = source.statements.filter(n => ts.isFunctionDeclaration(n) && ['normalizeScreenshotCaptureTiming','normalizeScreenshotCaptureOn','getBlockResultCaptureReason'].includes(n.name?.text)).map(n => n.getText(source)).join('\n')
  const compiled = ts.transpileModule(`const SCREENSHOT_CAPTURE_TIMINGS=new Set(['before','after','both']); const SCREENSHOT_CAPTURE_ON=new Set(['off','success','failure','always']); ${helpers}\nclass Harness {${method}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const Harness = new Function(compiled + ';return Harness')()
  const h = new Harness()
  assert.equal(patch.workflows.length, 6)
  for (const workflow of patch.workflows) {
    for (const node of workflow.nodes) {
      assert.equal(h.resolveAfterScreenshotCapture(node, { success: true, output: { ok: true, posted: true } }), null)
      assert.equal(h.resolveAfterScreenshotCapture(node, { success: true, output: { ok: false, posted: false } }).captureReason, 'failure')
      assert.equal(h.resolveAfterScreenshotCapture(node, { success: false, error: 'Timeout', output: {} }).captureReason, 'failure')
    }
    const click = workflow.nodes.find(n => n.block_name === 'fb_click_post_button')
    if (workflow.name.startsWith('facebook_timeline_post')) assert.equal(click.config.verifyPostAfterClick, true)
    if (workflow.name.startsWith('facebook_group_post')) assert.equal(click.config.verifyPostAfterClick, undefined)
  }
}

async function main() {
  await testPublish()
  testMedia()
  testCapturePolicy()
  console.log('PASS: publish early exit, 60/120/180s deadlines including data:video, disabled buttons, cancellation, failure preservation/screenshots, Group frequency policy, local-video-only size exemption')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
