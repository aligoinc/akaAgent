const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
const vm = require('node:vm')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-rest-browse-ui-'))
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'facebook-rest-browse-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="facebook-rest-browse-ui-smoke.css"><body><div id="root"></div><script src="facebook-rest-browse-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    const page = await app.firstWindow(); page.setDefaultTimeout(10000)
    page.on('pageerror', error => console.error('Renderer:', error.stack))
    if (process.argv.includes('--blocks-only')) { await blockSmoke(page); return }
    await page.waitForFunction(() => !!window.restSmoke)
    const form = page.locator('.campaign-full-modal'), card = page.locator('.facebook-rest-browse-settings')
    const toggle = card.getByRole('checkbox', { name: 'Kiêm nghỉ và lướt Facebook khi đạt giới hạn giờ' })
    const open = async (mode, actionId = 'facebook_group_post') => {
      await page.evaluate(({ mode, actionId }) => window.restSmoke.open(mode, actionId), { mode, actionId })
      await form.waitFor()
    }
    for (const actionId of ['facebook_group_post', 'facebook_comment_seeding', 'facebook_message_uid']) {
      console.log('Checking defaults:', actionId)
      await open('new', actionId); await toggle.waitFor(); assert.equal(await toggle.isChecked(), false)
      await toggle.check(); assert.equal(await card.getByLabel('Tổng thời gian lướt (giây)').inputValue(), '180')
      assert.equal(await card.getByLabel('Thời gian nghỉ (giây)').inputValue(), '60')
      assert(await card.getByLabel('Lướt trong group/profile/page').isChecked()); assert(await card.getByLabel('Lướt trang chủ', { exact: true }).isChecked())
      assert.equal(await card.getByRole('checkbox').count(), 3)
    }
    for (const actionId of ['facebook_comment_seeding_post', 'facebook_message_friend']) {
      await open('new', actionId); await page.waitForTimeout(100); assert.equal(await card.count(), 0)
    }
    await open('edit'); await toggle.waitFor()
    await card.getByLabel('Lướt trong group/profile/page').uncheck()
    await form.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.restSmoke.state.alerts.some(item => /ít nhất một nơi/.test(item.message)))
    assert.equal(await page.evaluate(() => window.restSmoke.state.calls.some(call => call.method === 'updateCampaign')), false)
    await card.getByLabel('Lướt trang chủ', { exact: true }).check()
    await card.getByLabel('Tổng thời gian lướt (giây)').fill('0')
    await form.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.restSmoke.state.alerts.some(item => /số nguyên dương/.test(item.message)))

    for (const mode of ['edit', 'clone', 'draft']) {
      await open(mode); await toggle.waitFor(); assert(await toggle.isChecked())
      assert.equal(await card.getByLabel('Tổng thời gian lướt (giây)').inputValue(), '240')
      assert.equal(await card.getByLabel('Thời gian nghỉ (giây)').inputValue(), '30')
      assert.equal(await card.getByLabel('Lướt trang chủ', { exact: true }).isChecked(), false)
      if (mode === 'edit') {
        for (const theme of ['dark', 'light']) {
          await page.evaluate(theme => document.body.classList.toggle('theme-light', theme === 'light'), theme)
          for (const width of [1550, 780]) {
            await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1100), width)
            await card.screenshot({ path: `/tmp/akaagent-rest-browse-${theme}-${width}.png` })
            assert(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
          }
        }
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1550, 1100))
      }
      const method = mode === 'edit' ? 'updateCampaign' : 'createCampaign'
      await form.getByRole('button', { name: mode === 'draft' ? 'Tạo chiến dịch' : 'Lưu chiến dịch', exact: true }).click()
      await page.waitForFunction(method => window.restSmoke.state.calls.some(call => call.method === method), method)
      const payload = await page.evaluate(method => { const call = window.restSmoke.state.calls.find(call => call.method === method); return call.args[method === 'updateCampaign' ? 1 : 0] }, method)
      assert.deepEqual(payload.extraSettings.facebookRestBrowse, { enabled: true, browseSeconds: 240, restSeconds: 30, browseTarget: true, browseHome: false })
    }
    await open('new'); await toggle.waitFor(); await toggle.check()
    await form.getByPlaceholder('Nhập tên chiến dịch...').fill('Nháp nghỉ và lướt Facebook')
    await card.getByLabel('Thời gian nghỉ (giây)').fill('0')
    await form.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await page.waitForFunction(() => !!window.restSmoke.state.draft)
    await open('draft'); await toggle.waitFor(); assert.equal(await card.getByLabel('Thời gian nghỉ (giây)').inputValue(), '0')
    assert.deepEqual(await page.evaluate(() => window.restSmoke.state.errors), [])
    console.log('PASS real campaign form: action scope, defaults, validation, save/edit/clone/draft, dark/light and narrow layout')
    await blockSmoke(page)
  } finally { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }) }
}

async function blockSmoke(page) {
  const seed = readFileSync(join(__dirname, '../migrations/migration_v337_facebook_rest_browse.sql'), 'utf8')
  const pacing = readFileSync(join(__dirname, '../migrations/migration_v338_facebook_rest_browse_pacing.sql'), 'utf8')
  const browse = pacing.match(/\$browse\$([\s\S]*?)\$browse\$/)[1], rest = seed.match(/\$rest\$([\s\S]*?)\$rest\$/)[1]
  const selectors = {
    fb_rest_browse_home_post: "//*[@role='feed']//*[@role='article']",
    fb_rest_browse_target_post: "//*[@role='feed']//*[@role='article']",
    fb_rest_browse_see_more: ".//*[@role='button' and .='Xem thêm']",
    fb_rest_browse_photo: seed.match(/\('fb_rest_browse_photo', \$xpath\$([\s\S]*?)\$xpath\$/)[1],
    fb_rest_browse_notifications: seed.match(/\('fb_rest_browse_notifications', \$xpath\$([\s\S]*?)\$xpath\$/)[1]
  }
  const epoch = 1_800_000_000_000
  let now, urls, sleeps, controller, events, chance, upper, afterSleep
  const reset = async (posts = 1) => {
    now = epoch; urls = []; sleeps = []; events = []; controller = new AbortController(); chance = 0; upper = false; afterSleep = null
    await page.setContent(`<div role="banner"><button role="button" aria-label="Thông báo" onclick="window.record('notifications')">Thông báo</button></div>
      <button role="button" onclick="window.record('outside')">Xem thêm</button><div role="feed">${Array.from({ length: posts }, (_, i) => `<article role="article" style="height:400px">
      <button role="button" onclick="window.record('more')">Xem thêm</button><a href="https://www.facebook.com/photo/?fbid=${i + 1}"><img alt="fixture"></a>
      <button onclick="window.record('social')">Like</button><button onclick="window.record('social')">Comment</button></article>`).join('')}</div>`)
    await page.evaluate(() => {
      window.counts = { notifications: 0, outside: 0, more: 0, social: 0 }; window.browserEvents = []
      window.record = type => { window.counts[type]++; window.browserEvents.push({ type, at: window.fixtureNow }) }
      delete window.__akaRestBrowsePost
      // Observe requested scrolling without relying on real animation wall time.
      Element.prototype.scrollIntoView = function(options) { window.browserEvents.push({ type: 'scroll', at: window.fixtureNow, ...options }) }
      window.scrollBy = options => window.browserEvents.push({ type: 'scroll', at: window.fixtureNow, ...options })
      window.scrollTo = options => window.browserEvents.push({ type: 'restore-scroll', at: window.fixtureNow, ...options })
    })
  }
  const NativeDate = Date
  const run = (code, vars, overrides = {}) => vm.runInNewContext(`(async () => {${code}})()`, {
    vars, signal: controller.signal, URL, setTimeout, clearTimeout, console,
    Math: Object.assign(Object.create(Math), { random: () => chance }),
    Date: class extends NativeDate { static now() { return now } },
    helpers: {
      element: async name => selectors[name] || '', log: () => {}, randomBetween: (min, max) => upper ? max : min,
      sleep: async ms => { sleeps.push(ms); events.push({ type: 'sleep', at: now, ms }); now += ms; if (afterSleep) await afterSleep(ms) }
    },
    page: {
      navigate: async url => { urls.push(url); events.push({ type: 'navigate', url, at: now }); now += 100; await page.evaluate(() => { delete window.__akaRestBrowsePost }) },
      evaluate: (code, ...args) => page.evaluate(({ code, args, now }) => { window.fixtureNow = now; return new Function('__args', code)(args) }, { code, args, now })
    }, ...overrides
  })
  const group = 'https://www.facebook.com/groups/123/', home = 'https://www.facebook.com/'
  const targetVars = ms => ({ restBrowseSegments: [{ url: group, home: false, until: now + ms }], restBrowseUntil: now + ms })
  await reset()
  const vars = { restBrowseSegments: [{ url: group, home: false, until: now + 45000 }, { url: home, home: true, until: now + 90000 }], restBrowseSeconds: 2, restBrowseUntil: now + 92000 }
  await run(browse, vars)
  assert(sleeps.every(ms => ms >= 0 && ms <= 8000)); assert.equal(now, epoch + 90000, 'browse budget was not extended')
  await run(rest, vars)
  const browser = await page.evaluate(() => window.browserEvents), counts = await page.evaluate(() => window.counts)
  const firstScroll = browser.find(e => e.type === 'scroll'), firstMore = browser.find(e => e.type === 'more')
  assert(firstScroll.at - events.find(e => e.type === 'navigate').at >= 2000, 'settle after initial navigation')
  assert(firstMore.at - firstScroll.at >= 2800, 'settle scroll and read before expanding')
  const photoIndex = events.findIndex(e => e.type === 'navigate' && e.url.includes('/photo/'))
  assert(photoIndex >= 0); const photo = events[photoIndex]
  assert(photo.at - firstMore.at >= 3000, 'read expanded text before opening a photo')
  assert(events.slice(photoIndex + 1).find(e => e.type === 'navigate').at - photo.at >= 3000, 'view the photo')
  const notification = browser.find(e => e.type === 'notifications')
  assert(notification); assert(events.find(e => e.type === 'navigate' && e.at > notification.at).at - notification.at >= 3000)
  assert(browser.filter(e => e.type === 'scroll' || e.type === 'restore-scroll').every(e => e.behavior === 'smooth'))
  assert(counts.more > 0); assert.equal(counts.notifications, 1); assert.equal(counts.outside, 0); assert.equal(counts.social, 0)
  assert.equal(sleeps.at(-1), 2000); assert.equal(now, epoch + 92000)

  await reset(5); chance = 0.99; upper = true
  await run(browse, targetVars(60000))
  assert.equal((await page.evaluate(() => window.counts)).more, 0, 'some sessions only read')
  assert.equal(urls.length, 1, 'photos are optional, not opened for every post')
  const readingScrolls = (await page.evaluate(() => window.browserEvents)).filter(e => e.type === 'scroll')
  assert(readingScrolls[1].at - readingScrolls[0].at >= 9500, 'upper pacing keeps 8 seconds reading plus scroll settlement')
  assert.equal((await page.evaluate(() => window.counts)).notifications, 0)

  await reset(); afterSleep = async () => { if (now >= epoch + 4000) controller.abort() }
  await run(browse, targetVars(45000))
  assert.equal(urls.length, 1); assert.equal((await page.evaluate(() => window.counts)).more, 0, 'abort during reading prevents the delayed click')
  const cancelledAt = now; assert(!events.some(e => e.type === 'navigate' && e.at >= cancelledAt))

  await reset(); let detached = false
  afterSleep = async () => {
    if (!detached && now >= epoch + 4000) {
      detached = true
      await page.evaluate(() => { const old = document.querySelector('article'); old.replaceWith(old.cloneNode(true)) })
    }
  }
  await run(browse, targetVars(20000))
  assert.equal((await page.evaluate(() => window.counts)).more, 0, 'do not click a replacement post after a delay')
  assert.equal(urls.length, 1)

  await reset(); await run(browse, targetVars(1000))
  assert.equal(now, epoch + 1000); assert.equal((await page.evaluate(() => window.browserEvents)).length, 0)
  await reset(); controller.abort(); await run(browse, targetVars(45000)); assert.equal(urls.length, 0)
  await reset()
  await run(browse, targetVars(20000), { helpers: {
    element: async () => { throw Error('missing') }, log: () => {}, randomBetween: min => min, sleep: async ms => { now += ms }
  } })
  assert.equal(now, epoch + 20000); assert.equal((await page.evaluate(() => window.counts)).social, 0)
  await reset()
  await run(browse, targetVars(20000), { page: { navigate: async () => { throw Error('offline') } } })
  console.log('PASS actual browse block: paced/scoped actions, smooth scroll, optional photos/expand, exact budget, cancellation, detached posts, missing selectors and navigation failure')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
