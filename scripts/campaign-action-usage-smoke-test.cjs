const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')

async function checkRepository(root, directory) {
  const clock = { dbNow: '2035-01-01T17:30:00.000Z', vietnamDateKey: '2035-01-02', nextVietnamMidnight: '2035-01-02T17:00:00.000Z' }
  const queries = []
  let denied = false
  let failWindow = false
  let statuses = [
    { action_code: 'fb_message_stranger', count_date: '2035-01-02', count_action_in_day: 12 },
    { action_code: 'fb_add_friend', count_date: '2035-01-01', count_action_in_day: 99 }
  ]
  const details = [
    [41, 'fb_message_stranger', '2035-01-01T16:25:00.000Z', true, 'lỗi'], // inclusive 65-minute boundary, previous Vietnam day
    [41, 'fb_message_stranger', clock.dbNow, null, 'thành công'],
    [41, 'fb_message_stranger', clock.dbNow, null, 'thất bại'],
    [41, 'fb_message_stranger', clock.dbNow, null, 'lỗi'],
    [41, 'fb_message_stranger', clock.dbNow, false, 'thành công'],
    [41, 'fb_message_stranger', '2035-01-01T16:24:59.999Z', true, 'thành công'],
    [42, 'fb_message_stranger', clock.dbNow, true, 'thành công'],
    [41, 'fb_add_friend', clock.dbNow, true, 'thành công'],
    [41, 'sms_send', clock.dbNow, null, 'lỗi']
  ].map(([account_id, action_code, created_at, counts_toward_limit, status]) => ({ account_id, action_code, created_at, counts_toward_limit, status }))
  globalThis.usageMock = {
    account: async () => denied ? null : { id: 41 }, clock: () => clock,
    client: () => ({ from(table) {
      const query = { table, filters: [], columns: '', options: null }
      const builder = {
        select(columns, options) { query.columns = columns; query.options = options; return builder },
        eq(...args) { query.filters.push(['eq', ...args]); return builder },
        in(...args) { query.filters.push(['in', ...args]); return builder },
        is(...args) { query.filters.push(['eq', ...args]); return builder },
        gte(...args) { query.filters.push(['gte', ...args]); return builder },
        then(success, failure) {
          queries.push(query)
          let result
          if (table === 'auto_account_action_status') result = { data: statuses, error: null }
          else {
            assert.equal(table, 'auto_campaign_details')
            assert.deepEqual(query.options, { count: 'exact', head: true }, 'never download detail rows')
            const count = details.filter(row => query.filters.every(([op, field, value]) =>
              op === 'eq' ? row[field] === value : op === 'in' ? value.includes(row[field]) : row[field] >= value)).length
            result = failWindow ? { error: { message: 'fetch failed' } } : { count, error: null }
          }
          return Promise.resolve(result).then(success, failure)
        }
      }
      return builder
    } })
  }
  const stubs = {
    supabaseClient: 'export const getSupabaseClient = () => globalThis.usageMock.client()',
    accountRepository: 'export const getAccount = (...args) => globalThis.usageMock.account(...args)',
    currentUser: 'export const requireCurrentUser = () => ({staffId:41,organizationId:1})',
    runtimeClockRepository: 'export const getDatabaseRuntimeClock = async () => globalThis.usageMock.clock(); export const parseDatabaseRuntimeClock = x => x',
    mappers: 'export const mapAutoAccountActionFromDB = x => x; export const mapAutoAccountActionStatusFromDB = x => x',
    entitlementRepository: ['canUseAccountActionWithEntitlements', 'canUseAccountPlatformWithEntitlements', 'emptyAuthEntitlements', 'loadCurrentUserEffectiveEntitlements']
      .map(name => `export const ${name} = () => ({})`).join(';')
  }
  const output = join(directory, 'repository.cjs')
  await build({ stdin: { contents: `export { getCampaignActionUsage } from './src/main/data/repositories/accountActionRepository'; export { resolveAccountActionLimitConfig } from './src/shared/accountActionLimits'`, resolveDir: root },
    outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', plugins: [{ name: 'isolated-usage', setup(plugin) {
      plugin.onResolve({ filter: /(?:supabaseClient|accountRepository|currentUser|runtimeClockRepository|mappers|entitlementRepository)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'usage-mock' }))
      plugin.onLoad({ filter: /.*/, namespace: 'usage-mock' }, args => ({ contents: stubs[args.path], loader: 'js' }))
    } }] })
  const { getCampaignActionUsage, resolveAccountActionLimitConfig: limits } = require(output)
  assert.deepEqual(await getCampaignActionUsage(41, ['fb_message_stranger', 'fb_add_friend', 'fb_post', 'fb_message_stranger']), [
    { actionCode: 'fb_message_stranger', dailyActionCount: 12, windowActionCount: 3 },
    { actionCode: 'fb_add_friend', dailyActionCount: 0, windowActionCount: 1 },
    { actionCode: 'fb_post', dailyActionCount: 0, windowActionCount: 0 }
  ])
  assert.equal(queries.length, 7, 'one daily read and two indexed counts per unique action')
  assert.equal(queries[0].columns, 'action_code, count_action_in_day, count_date')
  for (const query of queries.slice(1)) assert.ok(query.filters.some(filter => filter[0] === 'gte' && filter[2] === '2035-01-01T16:25:00.000Z'))
  assert.equal((await getCampaignActionUsage(41, ['sms_send']))[0].windowActionCount, 1, 'mobile legacy quota semantics are retained')
  queries.length = 0
  denied = true
  await assert.rejects(getCampaignActionUsage(42, ['fb_post']), /Không tìm thấy/)
  assert.equal(queries.length, 0, 'ownership/capability is checked before counting')
  denied = false
  await assert.rejects(getCampaignActionUsage(41, Array(33).fill('fb_post')), /không hợp lệ/)
  statuses = [{ action_code: 'fb_post', count_date: '2035-01-03', count_action_in_day: 1 }]
  await assert.rejects(getCampaignActionUsage(41, ['fb_post']), /vượt quá/)
  statuses = []
  queries.length = 0
  failWindow = true
  await assert.rejects(getCampaignActionUsage(41, ['fb_post']), /fetch failed/)
  assert.equal(queries.length, 3, 'a failed count is not retried')
  const campaign = { dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: 65 }
  assert.deepEqual(limits(campaign), campaign)
  assert.deepEqual(limits(campaign, { dailyLimit: 50, rateLimitCount: 7, rateLimitMinutes: 90 }, 40), { dailyLimit: 40, rateLimitCount: 7, rateLimitMinutes: 90 })
  assert.deepEqual(limits(campaign, { dailyLimit: 0, rateLimitCount: -1 }, 20), { ...campaign, dailyLimit: 20 })
  assert.deepEqual(limits({ dailyLimit: 0 }, undefined, 40), { dailyLimit: 30 })
  assert.equal(limits(), undefined)
  console.log('PASS repository: read-only, scoped counts, Vietnam rollover, fixed 65 minutes, legacy semantics, no retry; runtime limit precedence.')
}

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-action-usage-'))
  try {
    await checkRepository(root, directory)
    await build({ entryPoints: [join(__dirname, 'campaign-action-usage-ui-smoke.tsx')], outfile: join(directory, 'renderer.js'),
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.svg': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    writeFileSync(join(directory, 'electron.cjs'), `
      const { app, BrowserWindow } = require('electron');
      const assert = require('node:assert/strict');
      const { join } = require('node:path');
      app.setPath('userData', join(__dirname, 'user-data'));
      const delay = (ms=30) => new Promise(resolve => setTimeout(resolve, ms));
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show:false, width:1440, height:1000, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
        const run = code => win.webContents.executeJavaScript(code);
        const wait = async code => { for (let i=0;i<200;i++) { if(await run(code)) return; await delay(); } throw new Error('Timed out: '+code); };
        const calls = () => run('usageFixture.calls.length');
        const select = async patch => { await run('usageFixture.select('+JSON.stringify(patch)+')'); await delay(); };
        const probe = () => run('JSON.parse(document.querySelector("#usage-probe").textContent)');
        await win.loadFile(join(__dirname, 'index.html'));
        await wait('!!window.usageFixture');
        await delay(400); assert.equal(await calls(),0);
        await select({accountId:41,actionId:'facebook_message_uid',codes:['fb_message_stranger','fb_add_friend']});
        await wait('usageFixture.calls.length===1');
        await select({irrelevant:1,codes:['fb_message_stranger','fb_add_friend']});
        await run('usageFixture.pending[0].resolve(12)');
        await wait('JSON.parse(document.querySelector("#usage-probe").textContent).status==="ready"');
        await delay(400); assert.equal(await calls(),1,'StrictMode and rerenders do not duplicate queries');
        await select({accountId:42});
        assert.equal((await probe()).rows.length,0,'old-account counts disappear immediately');
        await wait('usageFixture.calls.length===2');
        await select({accountId:41}); await wait('usageFixture.calls.length===3');
        await run('usageFixture.pending[2].resolve(24)'); await delay();
        await run('usageFixture.pending[1].resolve(99)'); await delay();
        assert.equal((await probe()).rows[0].dailyActionCount,24,'late response cannot replace the selected account');
        await select({accountId:null}); await delay(400); assert.equal(await calls(),3); assert.equal((await probe()).status,'idle');
        await select({accountId:42}); await select({accountId:41}); await wait('usageFixture.calls.length===4');
        assert.equal(await run('usageFixture.calls[3].accountId'),41,'rapid changes are debounced');
        await select({accountId:42}); await wait('usageFixture.calls.length===5');
        await select({accountId:41}); await delay(400); assert.equal(await calls(),5,'returning to an in-flight selection reuses the request');
        await run('usageFixture.pending[3].resolve(31);usageFixture.pending[4].resolve(99)'); await delay();
        assert.equal((await probe()).rows[0].dailyActionCount,31);
        await select({actionId:'facebook_timeline_post',codes:['fb_post']}); await wait('usageFixture.calls.length===6');
        await run('usageFixture.pending[5].reject(new Error("offline"))'); await delay(700);
        assert.equal((await probe()).status,'error'); assert.equal(await calls(),6,'no automatic retry');
        for(const mode of ['new','edit','clone','draft']) {
          await run('usageFixture.openForm('+JSON.stringify(mode)+')');
          await wait('document.querySelector(".action-limit-usage")?.textContent.includes("12/40")');
          assert.equal(await calls(),1,mode+' initializes only once');
          assert.ok(await run('document.body.textContent.includes("3/7")'),'hourly group limit');
          assert.ok(await run('document.body.textContent.includes("Theo nhóm Nhóm smoke")'));
          assert.ok(await run('document.body.textContent.includes("Đã chạy trong giờ (65 phút)")'));
        }
        await run('document.querySelector(".action-limit-minute-toggle").click()');
        await run('const field=document.querySelector(".action-limit-minute-field input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"120");field.dispatchEvent(new Event("input",{bubbles:true}));');
        await run('window.dispatchEvent(new Event("focus"));document.querySelectorAll(".stepper-step")[1].click()');
        await delay(700); assert.equal(await calls(),1,'minute edits, navigation and focus do not query');
        assert.ok(await run('document.body.textContent.includes("Đã chạy trong giờ (65 phút): 3/7")'));
        await run('const inputs=document.querySelectorAll(".action-limit-card")[1].querySelectorAll("input");for(const [index,value] of [[0,"20"],[1,"4"]]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(inputs[index],value);inputs[index].dispatchEvent(new Event("input",{bubbles:true}));}');
        await delay(400); assert.equal(await calls(),1,'editing thresholds does not count again');
        assert.ok(await run('document.querySelectorAll(".action-limit-card")[1].textContent.includes("12/20")'));
        assert.ok(await run('document.querySelectorAll(".action-limit-card")[1].textContent.includes("3/4")'));
        await run('Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Kết bạn").querySelector("input").click()');
        await delay(400); assert.equal(await run('document.querySelectorAll(".action-limit-card").length'),1);
        await run('Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Kết bạn").querySelector("input").click()');
        await delay(400); assert.equal(await calls(),1,'optional actions reuse the initial snapshot');
        assert.ok(await run('document.querySelectorAll(".action-limit-card")[1].textContent.includes("12/20")'));
        await run('document.querySelector(".action-limit-card").scrollIntoView({block:"center"})'); await delay(150);
        const screenshot = ${JSON.stringify(join(tmpdir(), 'akaagent-action-usage-smoke.png'))};
        require('node:fs').writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
        await run('const action=Array.from(document.querySelectorAll("select")).find(select=>Array.from(select.options).some(option=>option.value==="facebook_timeline_post"));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(action,"facebook_timeline_post");action.dispatchEvent(new Event("change",{bubbles:true}));');
        await wait('usageFixture.calls.length===2');
        assert.deepEqual(await run('usageFixture.calls[1].codes'),['fb_post'],'real form action changes request only the new candidate codes');
        await run('usageFixture.openForm("multiple")'); await delay(700);
        assert.equal(await calls(),0,'multiple selected accounts never query');
        assert.equal(await run('document.querySelectorAll(".action-limit-usage").length'),0,'multiple accounts hide the usage');
        assert.deepEqual(await run('usageFixture.errors'),[]);
        console.log('PASS React/form: selection triggers, debounce, in-flight reuse, stale responses, error/no retry, create/edit/clone/draft, multi-account hiding, fixed 65 minutes. Screenshot: '+screenshot);
        win.destroy();app.exit(0);
      }).catch(error=>{console.error(error);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [join(directory, 'electron.cjs')], { cwd: root, env, stdio: 'inherit', timeout: 60000 })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
