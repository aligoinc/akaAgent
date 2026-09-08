// Run: node scripts/page-inbox-search-smoke-test.cjs [--baseline path/to/live-block.js]
// Execute the migration's actual block in an isolated Electron DOM fixture.
// No Facebook session, network request, campaign execution or production write.
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const directory = mkdtempSync(join(tmpdir(), 'akaagent-inbox-search-'))
app.setPath('userData', directory)
app.disableHardwareAcceleration()
const migration = readFileSync(resolve(__dirname, '../migrations/migration_v263_facebook_page_inbox_search_recovery.sql'), 'utf8')
const baseCode = migration.match(/\$block_code\$([\s\S]*?)\$block_code\$/)?.[1]
assert.ok(baseCode, 'migration must contain the block to exercise')
const headerMigration = readFileSync(resolve(__dirname, '../migrations/migration_v264_facebook_page_inbox_require_customer_header.sql'), 'utf8')
const oldHeader = headerMigration.match(/\$old_header\$([\s\S]*?)\$old_header\$/)?.[1]
const newHeader = headerMigration.match(/\$new_header\$([\s\S]*?)\$new_header\$/)?.[1]
assert.ok(oldHeader && newHeader, 'header migration must contain its exact replacement')
assert.equal(baseCode.split(oldHeader).length, 2, 'replace exactly one header guard')
const code = baseCode.replace(oldHeader, newHeader)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const compile = source => new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', source)
const block = compile(code)
const openMigration = readFileSync(resolve(__dirname, '../migrations/migration_v265_facebook_page_inbox_campaign_run_start.sql'), 'utf8')
const openCode = openMigration.match(/\$block_code\$([\s\S]*?)\$block_code\$/)?.[1]
assert.ok(openCode, 'open migration must contain the block to exercise')
const openBlock = compile(openCode)
const names = ['SearchButton', 'SearchInput', 'SearchResult', 'ConversationResult', 'SearchClearButton', 'CloseButton', 'HeaderName', 'MessageInput', 'MessengerReplyInput', 'SendButtonDisabled', 'SendButton', 'SendFailIcon']
const selectors = Object.fromEntries(names.map(name => [`FbPageInbox${name}`, `//*[@data-test='${name}']`]))

function fixture(options) {
  window.options = options
  window.state = { mode: options.stale ? 'selected' : 'idle', search: options.stale ? 'PN PN' : '', header: 'Hiền Huỳnh', sends: [], content: '' }
  const nativeTimeout = window.setTimeout.bind(window)
  window.setTimeout = (callback, ms) => nativeTimeout(callback, Math.min(ms, 5))
  document.body.innerHTML = '<input data-test="SearchInput" value="HIDDEN OLD VALUE" style="display:none"><section id="search"></section><h2 id="header-name" data-test="HeaderName"></h2><textarea data-test="MessageInput"></textarea><button data-test="SendButton">Gửi</button>'
  if (options.noHiddenInput) document.querySelector('input').remove()
  function render() {
    const { mode, search } = state
    const root = document.querySelector('#search')
    root.replaceChildren()
    const add = (tag, test, text = '') => {
      const el = document.createElement(tag)
      el.setAttribute('data-test', test)
      el.textContent = text
      root.appendChild(el)
      return el
    }
    if (mode === 'idle') {
      add('button', 'SearchButton', 'Tìm kiếm').onclick = () => {
        if (options.delayedOpen) setTimeout(() => { state.mode = 'typing'; render() }, 5)
        else { state.mode = 'typing'; render() }
      }
    }
    if (mode === 'typing') {
      const input = add('input', 'SearchInput')
      input.value = search
      input.oninput = () => {
        state.search = options.rejectName && input.value ? 'PN PN' : input.value
        render()
      }
      if (search && search !== options.noMatchFor) {
        const result = add('span', 'SearchResult', search)
        result.onmouseup = () => {
          state.header = options.wrongHeader || search
          state.mode = 'selected'
          render()
        }
      }
    }
    if (mode === 'selected') add('span', 'SelectedSearch', search)
    if (search && !options.missingClear) {
      add('button', 'SearchClearButton', 'Xóa').onclick = () => {
        if ((options.stale && options.staleClearFails) || (state.mode === 'selected' && options.clearAfterSelectionFails)) return
        state.search = ''
        state.mode = 'idle'
        options.stale = false
        render()
      }
    }
    document.querySelector('[data-test="HeaderName"]').textContent = state.header
  }
  document.querySelector('textarea').onpaste = event => { state.content = event.clipboardData.getData('text/plain'); event.preventDefault() }
  document.querySelector('[data-test="SendButton"]').onclick = () => {
    state.sends.push({ name: state.header, content: state.content })
    if (options.sendFails) {
      const failure = document.createElement('span')
      failure.setAttribute('data-test', 'SendFailIcon')
      document.body.appendChild(failure)
    }
  }
  render()
}

async function context(options = {}) {
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false, partition: `inbox-smoke-${Math.random()}` } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }))
  const stats = { navigations: [], delays: [], logs: [], headerReadDelays: [] }
  let currentUrl = options.currentUrl || 'https://business.facebook.com/latest/inbox/all?asset_id=999'
  const load = async config => {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body></body></html>'))
    await win.webContents.executeJavaScript(`(${fixture.toString()})(${JSON.stringify(config)})`)
  }
  await load(options)
  const page = {
    getURL: () => currentUrl,
    evaluate: async (source, ...args) => {
      if (args[0]?.action === 'readText' && args[0]?.payload?.selector === selectors.FbPageInboxHeaderName) {
        const index = stats.headerReadDelays.length
        stats.headerReadDelays.push(stats.delays.at(-1))
        if (Array.isArray(options.headerSequence)) {
          const value = options.headerSequence[Math.min(index, options.headerSequence.length - 1)]
          // Change real DOM presence/text before letting the block query it.
          await win.webContents.executeJavaScript(`
            (() => {
              const value = ${JSON.stringify(value)};
              const el = document.getElementById('header-name');
              if (value === null) el.removeAttribute('data-test');
              else {
                el.setAttribute('data-test', 'HeaderName');
                el.textContent = value;
                if (value.trim()) state.header = value;
              }
            })()
          `)
        }
      }
      return win.webContents.executeJavaScript(`(async () => { const __args = ${JSON.stringify(args)}; ${source}\n })()`)
    },
    navigate: async url => {
      stats.navigations.push(url)
      if (options.navigationFails) throw new Error('Navigation failed')
      await load(options.persistentStale ? options : { ...options, stale: false, missingClear: false, staleClearFails: false })
      currentUrl = url
    }
  }
  const helpers = {
    element: async name => { assert.ok(selectors[name], name); return selectors[name] },
    log: message => stats.logs.push(message),
    sleep: async (ms, signal) => {
      stats.delays.push(ms)
      if (signal?.aborted) throw new Error('Aborted')
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }
  return {
    stats,
    open: (vars = {}) => openBlock(page, helpers, { pageInboxPageUid: '999', facebookStepMs: 1000, ...vars }, {}, new AbortController().signal),
    run: (name = 'Cu Thóc', fn = block, signal = new AbortController().signal) => fn(page, helpers, { inputDataName: name, inputDataUid: '123', pageInboxPageUid: '999', campaignContent: 'Chào #{FULL_NAME}', facebookStepMs: 1000 }, {}, signal),
    state: () => win.webContents.executeJavaScript('JSON.parse(JSON.stringify(state))'),
    setOptions: patch => win.webContents.executeJavaScript(`Object.assign(options, ${JSON.stringify(patch)}); true`),
    close: () => win.destroy()
  }
}

async function test(name, options, check) {
  const ctx = await context(options)
  try { await check(ctx); console.log(`PASS ${name}`) } finally { ctx.close() }
}

async function main() {
  await app.whenReady()
  app.on('window-all-closed', () => {})
  await test('campaign start reopens a matching Page URL with retained PN PN', { stale: true }, async ctx => {
    const opened = await ctx.open({ pageInboxForceNavigate: true })
    assert.equal(opened.ok, true)
    assert.deepEqual(ctx.stats.navigations, ['https://business.facebook.com/latest/inbox/all?asset_id=999'])
    assert.deepEqual(ctx.stats.delays, [6000])
    const state = await ctx.state()
    assert.equal(state.search, '')
    assert.equal(state.sends.length, 0)
    assert.equal((await ctx.run()).ok, true)
    assert.equal(ctx.stats.navigations.length, 1, 'normal send needs no recovery reload after reopening')
    assert.deepEqual((await ctx.state()).sends, [{ name: 'Cu Thóc', content: 'Chào Cu Thóc' }])
  })
  await test('later customers reuse Inbox while a new campaign execution reopens it', {}, async ctx => {
    await ctx.open({ pageInboxForceNavigate: true })
    await ctx.open({ pageInboxForceNavigate: false })
    await ctx.open({ pageInboxForceNavigate: false })
    assert.equal(ctx.stats.navigations.length, 1)
    await ctx.open({ pageInboxForceNavigate: true })
    assert.deepEqual(ctx.stats.navigations, [
      'https://business.facebook.com/latest/inbox/all?asset_id=999',
      'https://business.facebook.com/latest/inbox/all?asset_id=999'
    ])
    assert.deepEqual(ctx.stats.delays, [6000, 6000])
    assert.equal((await ctx.state()).sends.length, 0)
  })
  await test('opening another Page preserves the target URL and configured delay', { currentUrl: 'https://business.facebook.com/latest/inbox/all?asset_id=888' }, async ctx => {
    const opened = await ctx.open({ pageInboxPageUid: '777', pageInboxPageName: 'Test Page', facebookStepMs: 1500 })
    assert.deepEqual(opened, { ok: true, pageUid: '777', pageName: 'Test Page', url: 'https://business.facebook.com/latest/inbox/all?asset_id=777' })
    assert.deepEqual(ctx.stats.navigations, [opened.url])
    assert.deepEqual(ctx.stats.delays, [6500])
  })
  await test('failed Inbox navigation propagates without sending or retrying navigation', { stale: true, navigationFails: true }, async ctx => {
    await assert.rejects(ctx.open({ pageInboxForceNavigate: true }), /Navigation failed/)
    assert.equal(ctx.stats.navigations.length, 1)
    assert.equal((await ctx.state()).sends.length, 0)
  })
  await test('missing Page ID fails before navigation', {}, async ctx => {
    await assert.rejects(ctx.open({ pageInboxPageUid: '' }), /Thiếu Page ID/)
    assert.equal(ctx.stats.navigations.length, 0)
  })
  await test('legacy clients without a campaign-start flag keep matching Inbox open', {}, async ctx => {
    assert.equal((await ctx.open()).ok, true)
    assert.equal(ctx.stats.navigations.length, 0)
  })
  const baselineIndex = process.argv.indexOf('--baseline')
  if (baselineIndex >= 0) {
    const baseline = compile(readFileSync(process.argv[baselineIndex + 1], 'utf8'))
    await test('live baseline reproduces retained PN PN and missing search input', { stale: true, staleClearFails: true, noHiddenInput: true }, async ctx => {
      await assert.rejects(ctx.run('Cu Thóc', baseline), /Lỗi khi nhập tên vào ô tìm kiếm/)
      assert.equal((await ctx.state()).search, 'PN PN')
      assert.equal(ctx.stats.navigations.length, 0)
    })
  }
  await test('clear stale PN PN before next customer; ignore hidden duplicate input', { stale: true }, async ctx => {
    assert.equal((await ctx.run()).ok, true)
    assert.deepEqual((await ctx.state()).sends, [{ name: 'Cu Thóc', content: 'Chào Cu Thóc' }])
    assert.equal((await ctx.state()).search, '')
    assert.equal(ctx.stats.navigations.length, 0)
    assert.ok(ctx.stats.delays.includes(5000), 'preserve composer settle delay')
  })
  await test('failed clear recovers once by navigating before any send', { stale: true, staleClearFails: true }, async ctx => {
    assert.equal((await ctx.run()).ok, true)
    assert.deepEqual(ctx.stats.navigations, ['https://business.facebook.com/latest/inbox/all?asset_id=999'])
    assert.equal((await ctx.state()).sends.length, 1)
  })
  await test('missing clear control recovers a selected search chip', { stale: true, missingClear: true }, async ctx => {
    assert.equal((await ctx.run()).ok, true)
    assert.equal(ctx.stats.navigations.length, 1)
  })
  await test('persistent stuck UI has bounded recovery and never sends', { stale: true, missingClear: true, persistentStale: true }, async ctx => {
    await assert.rejects(ctx.run(), /khôi phục ô tìm kiếm trống/)
    assert.equal(ctx.stats.navigations.length, 1)
    assert.equal((await ctx.state()).sends.length, 0)
  })
  await test('not_found cleans up before a later successful customer', { noMatchFor: 'PN PN' }, async ctx => {
    assert.equal((await ctx.run('PN PN')).reason, 'not_found')
    assert.equal((await ctx.state()).search, '')
    assert.equal((await ctx.run()).ok, true)
    assert.equal((await ctx.state()).sends.length, 1)
  })
  await test('failed post-selection clear stops before message input/send', { clearAfterSelectionFails: true }, async ctx => {
    await assert.rejects(ctx.run(), /Không thể xoá tìm kiếm/)
    const state = await ctx.state()
    assert.equal(state.content, '')
    assert.equal(state.sends.length, 0)
    assert.equal(ctx.stats.navigations.length, 0, 'do not reload a selected conversation mid-send flow')
  })
  await test('wrong conversation never sends and leaves search clean', { wrongHeader: 'Hiền Huỳnh' }, async ctx => {
    assert.equal((await ctx.run('PN PN')).reason, 'wrong_conversation')
    assert.equal((await ctx.state()).search, '')
    assert.equal((await ctx.state()).sends.length, 0)
    assert.deepEqual(ctx.stats.headerReadDelays, [5000, 2000])
  })
  for (const [name, sequence] of [
    ['missing header', [null, null]],
    ['empty header', ['', '']],
    ['whitespace header', ['   ', '\n\t']],
    ['wrong header becomes missing', ['Hiền Huỳnh', null]],
    ['wrong header becomes empty', ['Hiền Huỳnh', '']]
  ]) {
    await test(`${name} stops before message input and send`, { wrongHeader: 'Hiền Huỳnh', headerSequence: sequence }, async ctx => {
      await assert.rejects(ctx.run('PN PN'), /Không đọc được tên khách trong inbox page để xác minh người nhận/)
      const state = await ctx.state()
      assert.equal(state.content, '')
      assert.equal(state.sends.length, 0)
      assert.equal(state.search, '')
      assert.deepEqual(ctx.stats.headerReadDelays, [5000, 2000])
      assert.equal(ctx.stats.navigations.length, 0)
    })
  }
  for (const [name, initial] of [['missing', null], ['empty', ''], ['wrong', 'Hiền Huỳnh']]) {
    await test(`${name} header becomes correct on recheck and sends once`, { wrongHeader: 'Hiền Huỳnh', headerSequence: [initial, 'PN PN'] }, async ctx => {
      assert.equal((await ctx.run('PN PN')).ok, true)
      assert.deepEqual((await ctx.state()).sends, [{ name: 'PN PN', content: 'Chào PN PN' }])
      assert.deepEqual(ctx.stats.headerReadDelays, [5000, 2000])
    })
  }
  await test('missing header becomes wrong on recheck and does not send', { headerSequence: [null, 'Hiền Huỳnh'] }, async ctx => {
    const result = await ctx.run('PN PN')
    assert.equal(result.reason, 'wrong_conversation')
    assert.equal(result.openedName, 'Hiền Huỳnh')
    assert.equal((await ctx.state()).sends.length, 0)
    assert.deepEqual(ctx.stats.headerReadDelays, [5000, 2000])
  })
  await test('correct header sends without the recheck delay', { headerSequence: ['PN PN'] }, async ctx => {
    assert.equal((await ctx.run('PN PN')).ok, true)
    assert.equal((await ctx.state()).sends.length, 1)
    assert.deepEqual(ctx.stats.headerReadDelays, [5000])
  })
  await test('rejected search text stops and cleans up', { rejectName: true }, async ctx => {
    await assert.rejects(ctx.run(), /tên tìm kiếm chưa khớp/)
    assert.equal((await ctx.state()).search, '')
    assert.equal((await ctx.state()).sends.length, 0)
  })
  await test('wait for asynchronously opened search input', { delayedOpen: true }, async ctx => {
    assert.equal((await ctx.run()).ok, true)
    assert.equal(ctx.stats.navigations.length, 0)
  })
  await test('send failure does not trigger reload or duplicate submission', { sendFails: true }, async ctx => {
    assert.equal((await ctx.run()).reason, 'send_failed')
    assert.equal((await ctx.state()).sends.length, 1)
    assert.equal(ctx.stats.navigations.length, 0)
  })
  await test('cancelled run does not navigate or send', { stale: true }, async ctx => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(ctx.run('Cu Thóc', block, controller.signal), /Aborted/)
    assert.equal(ctx.stats.navigations.length, 0)
    assert.equal((await ctx.state()).sends.length, 0)
  })
}

main().then(() => { rmSync(directory, { recursive: true, force: true }); app.exit(0) }).catch(error => {
  console.error(error)
  rmSync(directory, { recursive: true, force: true })
  app.exit(1)
})
