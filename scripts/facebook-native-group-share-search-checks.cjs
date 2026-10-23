// Run by the DOM smoke suite with a local Electron window. No Facebook requests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { buildSync } = require('esbuild')
const { before, elements, blocks } = require('./build-facebook-native-group-share.cjs')

const root = path.resolve(__dirname, '..')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const selectors = Object.fromEntries([...before.elements, ...elements].map(e => [e.name, e.xpath]))
const searchXPath = "//*[@role='dialog']" + selectors.SearchAddGroupToPostInp
const block = blocks.find(b => b.name === 'fb_select_native_share_group')
const oldBlock = before.blocks.find(b => b.name === 'fb_select_group_post_share_targets')
const oldInputHelpers = oldBlock.code.slice(oldBlock.code.indexOf('async function rawClear('), oldBlock.code.indexOf('\nlet attemptedCount'))

function loadPageController() {
  const mod = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/v2/runtime/pageController.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports)
  return mod.exports.PageController
}

const reactFixture = buildSync({
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    window.mountGroupSearch = ({initial, target, missing}) => {
      const host = document.createElement('div');
      document.body.replaceChildren(host);
      window.searchQueries = []; window.selected = 0; window.lastQuery = initial;
      function Search() {
        const [query, setQuery] = useState(initial);
        const [selected, setSelected] = useState(false);
        if (selected) return <div role="dialog"><form method="POST">Selected group</form></div>;
        const key = query === target ? 'target' : 'previous-result';
        return <div role="dialog">
          <input role="combobox" type="search" aria-label="Tìm kiếm nhóm" value={query}
            onChange={event => {
              window.searchQueries.push(event.target.value);
              window.lastQuery = event.target.value;
              setQuery(event.target.value);
            }} />
          <output>{query}</output>
          {query === target && missing
            ? <span>Không có nhóm nào khớp với tìm kiếm của bạn.</span>
            : <div role="button" onClick={() => { window.selected++; setSelected(true); }}>
                <a href={'https://www.facebook.com/groups/' + key + '/'}>{key}</a>
              </div>}
        </div>;
      }
      createRoot(host).render(<Search />);
    };
  ` },
  write: false, bundle: true, platform: 'browser', format: 'iife', logLevel: 'silent'
}).outputFiles[0].text

module.exports = async win => {
  const PageController = loadPageController()
  const target = { name: `Nhóm thử "A" & 'B'`, url: 'https://www.facebook.com/groups/target/', keys: ['target'] }
  const sourceUrl = 'https://www.facebook.com/author/posts/456'
  const menu = '<div role="dialog"><div role="button" aria-label="Chia sẻ lên nhóm" onclick="window.mountGroupSearch(window.fixtureSettings)">Nhóm</div></div>'
  const source = `<div role="dialog"><div role="button" aria-label="Chia sẻ" onclick='document.body.innerHTML=${JSON.stringify(menu).replace(/'/g, '&#39;')}'>Chia sẻ</div></div>`
  let checks = 0

  for (const mode of ['existing-input-method', 'empty-input', 'prefilled-input', 'missing', 'abort-clear', 'abort-type']) {
    const page = new PageController(win.webContents)
    const navigate = page.navigate.bind(page)
    const abort = new AbortController()
    const evaluate = page.evaluate.bind(page)
    page.evaluate = async (...args) => {
      const result = await evaluate(...args)
      if (mode === 'abort-type' && result?.typed === true) abort.abort()
      return result
    }
    const navigations = []
    let now = 0, lastSearch
    const settings = { initial: mode === 'empty-input' ? '' : 'Previous query', target: target.name, missing: mode === 'missing' }
    const readSearch = () => page.evaluate(`return {
      value: document.querySelector('input')?.value ?? null,
      query: window.lastQuery, queries: window.searchQueries || [], selected: window.selected || 0
    };`)
    page.navigate = async url => {
      navigations.push(url)
      if (url === target.url) lastSearch = await readSearch()
      await navigate('data:text/html;charset=utf-8,' + encodeURIComponent(url === sourceUrl ? source : '<main>Target group</main>'))
      if (url === sourceUrl) {
        await win.webContents.executeJavaScript(reactFixture)
        await page.evaluate('window.fixtureSettings = __args[0];', settings)
      }
    }

    if (mode === 'existing-input-method') {
      await page.navigate(sourceUrl)
      await page.evaluate('window.mountGroupSearch(window.fixtureSettings);')
      await page.waitForSelector(searchXPath)
      await page.fill(searchXPath, target.name)
      const failedFill = await readSearch()
      assert.equal(failedFill.value, target.name)
      assert.equal(failedFill.query, settings.initial)
      assert.deepEqual(failedFill.queries, [], 'plain value assignment does not invoke React onChange')
      checks++
      const out = await new AsyncFunction('page', 'xpath', 'text', oldInputHelpers + '\nreturn {clear: await rawClear(xpath), type: await rawType(xpath, text)};')(page, searchXPath, target.name)
      assert.equal(out.clear.cleared, true)
      assert.equal(out.type.typed, true)
      assert.deepEqual((await readSearch()).queries, ['', target.name], 'existing group-share method updates React')
      checks++
      continue
    }

    const helpers = {
      element: async name => { assert(selectors[name], name); return selectors[name] },
      sleep: async ms => {
        const state = await readSearch()
        if (mode === 'abort-clear' && state.queries.includes('')) abort.abort()
        if (mode === 'abort-type' && state.queries.includes(target.name)) abort.abort()
        abort.signal.throwIfAborted()
        now += ms
      }
    }
    const ClockDate = class extends Date { static now() { return now } }
    const vars = { groupShareTarget: target, groupShareSourceUrl: sourceUrl, groupShareSelected: false }
    let output, error
    try {
      output = await new AsyncFunction('vars', 'page', 'helpers', 'signal', 'Date', block.code)(vars, page, helpers, abort.signal, ClockDate)
    } catch (err) { error = err }
    const state = lastSearch || await readSearch()
    if (mode.startsWith('abort-')) {
      assert(error, 'cancel must not select a group or emit a skip result')
      assert.equal(vars.groupShareSelected, false)
      assert.equal(state.selected, 0)
      assert.deepEqual(state.queries, mode === 'abort-clear' ? [''] : ['', target.name])
    } else {
      assert.ifError(error)
      assert.deepEqual(state.queries, settings.initial ? ['', target.name] : [target.name])
      if (mode === 'missing') {
        assert.equal(output.actionResult.statusCode, 'campaign_detail_skipped')
        assert.equal(output.actionResult.operationState, 'not_committed')
        assert.equal(state.selected, 0)
        assert.equal(navigations.at(-1), target.url)
      } else {
        assert.equal(output.selected, true)
        assert.equal(vars.groupShareSelected, true)
        assert.equal(state.selected, 1)
      }
    }
    checks++
  }
  return checks
}
