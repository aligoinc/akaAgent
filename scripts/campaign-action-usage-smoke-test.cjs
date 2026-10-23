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
        const run = code => win.webContents.executeJavaScript(code).catch(error => { console.error('Failed UI check:', code); throw error; });
        const wait = async code => { for (let i=0;i<200;i++) { if(await run(code)) return; await delay(); } throw new Error('Timed out: '+code); };
        const calls = () => run('usageFixture.calls.length');
        const select = async patch => { await run('usageFixture.select('+JSON.stringify(patch)+')'); await delay(); };
        const probe = () => run('JSON.parse(document.querySelector("#usage-probe").textContent)');
        const assertPickerLoginsFit = async () => assert.ok(await run(
          'Array.from(document.querySelectorAll(".campaign-account-picker-row")).every(row=>{const label=row.querySelector(".account-select-account-label");const text=document.createRange();text.selectNodeContents(label.lastElementChild);const bounds=text.getBoundingClientRect();const container=label.getBoundingClientRect();const viewport=row.closest(".campaign-account-picker-scroll").getBoundingClientRect();return bounds.width>0&&bounds.left>=container.left-1&&bounds.right<=container.right+1&&bounds.top>=container.top-1&&bounds.bottom<=container.bottom+1&&bounds.right<=viewport.right+1;})'
        ), 'full login status stays visible beside long names, including in a narrow window');
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
        await run('usageFixture.select({ready:false,userScope:"session-a",scopes:[{accountIds:[41,42],actionCodes:["fb_message_stranger","fb_add_friend"]}]});usageFixture.openSnapshotProbe()');
        await delay(100); assert.equal(await calls(),0,'wait for catalogs');
        await select({ready:true}); await wait('usageFixture.calls.length===1');
        await select({scopes:[{accountIds:[41],actionCodes:['fb_add_friend']}],irrelevant:8});
        await run('usageFixture.pending[0].resolve(15)');
        await wait('JSON.parse(document.querySelector("#snapshot-probe").textContent).status==="ready"');
        await delay(350); assert.equal(await calls(),1,'selection/field changes never reload the snapshot, including StrictMode');
        await select({userScope:'session-b'}); await wait('usageFixture.calls.length===2');
        await select({userScope:'session-c'}); await wait('usageFixture.calls.length===3');
        await run('usageFixture.pending[2].resolve(25);usageFixture.pending[1].resolve(99)'); await delay(100);
        assert.equal(await run('JSON.parse(document.querySelector("#snapshot-probe").textContent).snapshot.accounts[0].actions[0].dailyActionCount'),25,'discard previous-session response');
        await select({userScope:'session-d'}); await wait('usageFixture.calls.length===4');
        await run('usageFixture.pending[3].reject(new Error("offline"))'); await delay(500);
        assert.equal(await run('JSON.parse(document.querySelector("#snapshot-probe").textContent).status'),'error');
        assert.equal(await calls(),4,'failed snapshot has no automatic retry');
        for (const cached of [false, true]) {
          await run('usageFixture.configureVisibility(["facebook_timeline_post"],true,'+(cached ? '[]' : 'undefined')+');usageFixture.openForm("new")');
          await wait('usageFixture.visibilityPending.length===1');
          await delay(350); assert.equal(await calls(),0,'wait for fresh visibility even when cache exists: '+cached);
          await run('usageFixture.visibilityPending[0].resolve()');
          await wait('usageFixture.calls.length===1');
          assert.deepEqual(await run('usageFixture.calls'),[{scopes:[{accountIds:[41,42],actionCodes:['fb_message_stranger','fb_add_friend']}]}],
            'hidden campaign types contribute no action queries');
          assert.equal(await run('!!document.querySelector("option[value=facebook_timeline_post]")'),false);
          await run('window.dispatchEvent(new Event("focus"))');
          await delay(100); assert.equal(await calls(),1);
        }
        for (const mode of ['clone','draft']) {
          await run('usageFixture.configureVisibility(["facebook_message_uid","facebook_timeline_post"]);usageFixture.openForm('+JSON.stringify(mode)+')');
          await wait('document.querySelector(".action-limit-used-pill")?.textContent.includes("12/40")');
          assert.deepEqual(await run('usageFixture.calls[0].scopes[0].actionCodes'),['fb_message_stranger','fb_add_friend'],
            mode+' retains the currently selected hidden action');
          assert.equal(await calls(),1);
        }
        await run('usageFixture.configureVisibility(["facebook_message_uid","facebook_timeline_post"]);usageFixture.openForm("edit")');
        await wait('document.querySelector(".action-limit-used-pill")?.textContent.includes("12/40")');
        assert.deepEqual(await run('[...usageFixture.calls[0].scopes[0].actionCodes].sort()'),
          ['fb_message_stranger','fb_add_friend','fb_post_my_profile'].sort(),
          'editing preloads every selectable campaign type, including hidden types');
        assert.equal(await run('!!document.querySelector("option[value=facebook_timeline_post]")'),true);
        await run('(()=>{const action=Array.from(document.querySelectorAll("select")).find(select=>Array.from(select.options).some(option=>option.value==="facebook_timeline_post"));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(action,"facebook_timeline_post");action.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await wait('document.querySelectorAll(".campaign-account-picker-row").length===2');
        assert.deepEqual(await run('Array.from(document.querySelectorAll(".campaign-account-picker thead tr:nth-child(2) th")).map(cell=>cell.textContent)'),
          ['Đăng bài trang cá nhân'],'timeline posting never shows unrelated Comment/Like columns');
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).every(cell=>cell.textContent.includes("12 - "))'),
          'switching to a hidden type in edit displays its preloaded statistics');
        await wait('document.querySelector(".action-limit-used-pill")?.textContent.includes("12/")');
        await run('document.querySelector(".stepper-input[aria-disabled]").click();window.dispatchEvent(new Event("focus"))');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await delay(150); assert.equal(await calls(),1,'edit action change, focus and reopening the picker never query again');
        await run('usageFixture.configureVisibility(["facebook_message_uid","facebook_timeline_post"],true);usageFixture.openForm("unselected")');
        await wait('usageFixture.visibilityPending.length===1');
        await run('usageFixture.visibilityPending[0].resolve()');
        await wait('!document.body.textContent.includes("Đang tải cài đặt hiển thị")');
        await delay(350); assert.equal(await calls(),0,'no visible actions and no selection means no statistics query');
        await run('usageFixture.configureVisibility(["facebook_timeline_post"],true,[]);usageFixture.openForm("new")');
        await wait('usageFixture.visibilityPending.length===1');
        await run('usageFixture.visibilityPending[0].reject(new Error("visibility offline"))');
        await wait('document.querySelector(".field-error")?.textContent.includes("visibility offline")');
        await delay(350); assert.equal(await calls(),0,'failed refresh never falls back to querying cached hidden actions');
        await run('document.querySelector(".field-error button").click()');
        await wait('usageFixture.visibilityPending.length===2');
        await run('usageFixture.visibilityPending[1].resolve()');
        await wait('usageFixture.calls.length===1');
        assert.deepEqual(await run('usageFixture.calls[0].scopes[0].actionCodes'),['fb_message_stranger','fb_add_friend']);
        console.log('PASS visibility: fresh/cached loading, hidden scopes, existing edit/clone/draft, empty scope, error/manual retry.');
        await run('usageFixture.configureVisibility(["facebook_message_uid","facebook_timeline_post"])');
        await run('usageFixture.openForm("locked-edit")');
        await wait('document.querySelector(".action-limit-used-pill")?.textContent.includes("12/40")');
        assert.equal(await run('document.querySelector(".stepper-input[aria-disabled]").getAttribute("aria-disabled")'),'true');
        assert.deepEqual(await run('usageFixture.calls'),[{scopes:[{accountIds:[41],actionCodes:['fb_message_stranger','fb_add_friend']}]}],
          'locked data-group form only reads the fixed account and action');
        await run('document.querySelector(".stepper-input[aria-disabled]").click();window.dispatchEvent(new Event("focus"))');
        await delay(100);
        assert.equal(await run('document.querySelectorAll(".campaign-account-picker").length'),0);
        assert.equal(await calls(),1,'locked picker and focus never reload');
        await run('usageFixture.configureVisibility([])');
        for(const mode of ['new','edit','clone','draft']) {
          await run('usageFixture.openForm('+JSON.stringify(mode)+')');
          await wait('document.querySelector(".action-limit-used-pill")?.textContent.includes("12/40")');
          assert.equal(await calls(),1,mode+' initializes only once');
          assert.deepEqual(await run('usageFixture.calls[0].scopes[0].accountIds'),[41,42],mode+' retains all selectable accounts');
          assert.ok(!await run('document.body.textContent.includes("3/7")'),'no hourly usage queried or displayed');
          assert.ok(await run('document.body.textContent.includes("Theo nhóm Nhóm smoke")'));
          assert.ok(!await run('document.body.textContent.includes("trong 65 phút 3/7")'));
        }
        await run('document.querySelector(".action-limit-minute-toggle").click()');
        await run('const field=document.querySelector(".action-limit-minute-field input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"120");field.dispatchEvent(new Event("input",{bubbles:true}));');
        await run('window.dispatchEvent(new Event("focus"));document.querySelectorAll(".stepper-step")[1].click()');
        await delay(700); assert.equal(await calls(),1,'minute edits, navigation and focus do not query');
        assert.ok(!await run('document.body.textContent.includes("trong 65 phút 3/7")'));
        await run('const inputs=document.querySelectorAll(".action-limit-card")[1].querySelectorAll("input");for(const [index,value] of [[0,"20"],[1,"4"]]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(inputs[index],value);inputs[index].dispatchEvent(new Event("input",{bubbles:true}));}');
        await delay(400); assert.equal(await calls(),1,'editing thresholds does not count again');
        assert.ok(await run('document.querySelectorAll(".action-limit-card")[1].textContent.includes("12/20")'));
        assert.ok(!await run('document.querySelectorAll(".action-limit-card")[1].textContent.includes("3/4")'));
        await run('Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Kết bạn").querySelector("input").click()');
        await delay(400); assert.equal(await run('document.querySelectorAll(".action-limit-card").length'),1);
        await run('Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Nhắn tin").querySelector("input").click();document.querySelector(".stepper-input[aria-disabled]").click()');
        await wait('document.querySelectorAll(".campaign-account-picker-row").length===2');
        assert.deepEqual(await run('Array.from(document.querySelectorAll(".campaign-account-picker thead tr:nth-child(2) th")).map(cell=>cell.textContent)'),
          ['Nhắn tin người lạ','Kết bạn'],'both main Facebook actions remain visible when unchecked');
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).every(cell=>cell.textContent.includes("12 - "))'));
        await run('document.querySelector(".stepper-input[aria-disabled]").click();Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Nhắn tin").querySelector("input").click()');
        await run('Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Kết bạn").querySelector("input").click()');
        await delay(400); assert.equal(await calls(),1,'optional actions reuse the initial snapshot');
        assert.ok(await run('document.querySelectorAll(".action-limit-card")[1].textContent.includes("12/20")'));
        await run('document.querySelector(".action-limit-card").scrollIntoView({block:"center"})'); await delay(150);
        const screenshot = ${JSON.stringify(join(tmpdir(), 'akaagent-action-usage-smoke.png'))};
        require('node:fs').writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
        await run('const action=Array.from(document.querySelectorAll("select")).find(select=>Array.from(select.options).some(option=>option.value==="facebook_timeline_post"));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(action,"facebook_timeline_post");action.dispatchEvent(new Event("change",{bubbles:true}));');
        await delay(500); assert.equal(await calls(),1,'real form action changes filter the opening snapshot');
        assert.ok(await run('usageFixture.calls[0].scopes[0].actionCodes.includes("fb_post_my_profile")'),'opening snapshot includes other form choices');
        await run('usageFixture.openForm("multiple")'); await delay(700);
        assert.equal(await calls(),1,'all selectable accounts share one opening request');
        assert.equal(await run('document.querySelectorAll(".action-limit-usage").length'),0,'multiple accounts hide the usage');
        await run('const optional=Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Kết bạn").querySelector("input");if(!optional.checked)optional.click()');
        await delay(100);
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await wait('document.querySelectorAll(".campaign-account-picker-row").length===2');
        const picker = () => run('document.querySelector(".campaign-account-picker").textContent');
        assert.ok((await picker()).includes('12 - Bình thường'));
        assert.ok((await picker()).includes('Bị giới hạn - Còn 18 phút'));
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).some(cell=>cell.textContent.trim()==="12 - Bị giới hạn")'), 'indefinite action limit remains explicit');
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-row")).every(row=>row.getBoundingClientRect().height<=34)'), 'compact single-line rows');
        await assertPickerLoginsFit();
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).every(cell=>getComputedStyle(cell).whiteSpace==="nowrap")'));
        assert.equal(await calls(),1);
        await run('document.querySelectorAll(".campaign-account-picker-row input")[1].click()');
        await delay(200); assert.equal(await calls(),1,'selecting accounts reuses opening snapshot');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()'); await delay(50);
        await run('document.querySelector(".stepper-input[aria-disabled]").click();window.dispatchEvent(new Event("focus"))');
        await delay(300); assert.equal(await calls(),1,'reopening dropdown and focus do not query');
        await run('document.querySelector(".campaign-account-picker").scrollIntoView({block:"center"})'); await delay(100);
        require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'akaagent-account-picker-smoke.png'))},(await win.webContents.capturePage()).toPNG());
        await run('usageFixture.openGroupPostForm()');
        await wait('usageFixture.calls.length===1');
        assert.deepEqual(await run('usageFixture.calls[0].scopes[0].actionCodes'),['fb_post_group','fb_comment'],
          'group-post scope reads posting and the separate daily comment limit, with no unused like count');
        for (const commentEnabled of [true,false,true]) {
          await run('(()=>{const input=Array.from(document.querySelectorAll("label.schedule-checkbox-label")).find(label=>label.textContent.trim()==="Kiêm comment").querySelector("input");if(input.checked!=='+commentEnabled+') input.click();})()');
          await run('document.querySelector(".stepper-input[aria-disabled]").click()');
          await wait('document.querySelectorAll(".campaign-account-picker-row").length===2');
          assert.deepEqual(await run('Array.from(document.querySelectorAll(".campaign-account-picker thead tr:nth-child(2) th")).map(cell=>cell.textContent)'),
            commentEnabled ? ['Đăng bài group','Comment'] : ['Đăng bài group'],'group posting shows companion Comment only when selected');
          assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).every(cell=>cell.textContent.includes("12 - "))'));
          await run('document.querySelector(".stepper-input[aria-disabled]").click()');
          assert.equal(await calls(),1,'group-post option changes never reload statistics');
        }
        for (const actionId of ['facebook_comment_seeding','facebook_comment_seeding_post','facebook_newsfeed_interaction']) {
          await run('usageFixture.openInteractionForm('+JSON.stringify(actionId)+')');
          await wait('usageFixture.calls.length===1');
          const isNewsfeed = actionId === 'facebook_newsfeed_interaction';
          assert.deepEqual(await run('usageFixture.calls[0].scopes[0].actionCodes'),['fb_comment','fb_like_post'],
            'optional Like is preloaded even when absent from limitCheckActionCodes');
          for (const enabled of [false,true,false]) {
            await run('for (const input of document.querySelectorAll(".newsfeed-action-toggle input, label.schedule-checkbox-label input")) { const label=input.closest("label"); if (input.checked!=='+enabled+' && (label.classList.contains("newsfeed-action-toggle") || label.textContent.includes("Like bài post khi comment"))) input.click(); }');
            await run('document.querySelector(".stepper-input[aria-disabled]").click()');
            await wait('document.querySelectorAll(".campaign-account-picker-row").length===2');
            assert.deepEqual(await run('Array.from(document.querySelectorAll(".campaign-account-picker thead tr:nth-child(2) th")).map(cell=>cell.textContent)'),
              isNewsfeed || enabled ? ['Comment','Like post'] : ['Comment'],actionId+' keeps the correct columns with options '+enabled);
            assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).every(cell=>cell.textContent.includes("12 - "))'));
            await run('document.querySelector(".stepper-input[aria-disabled]").click()');
            assert.equal(await calls(),1,'comment/newsfeed option changes never reload statistics');
          }
        }
        console.log('PASS companion columns: group Comment and seeding Like follow checkboxes using preloaded counts; both newsfeed columns always remain visible.');
        await run('usageFixture.openZaloForm()'); await delay(700);
        assert.deepEqual(await run('usageFixture.errors'),[], 'Zalo form renders without errors');
        if (!await run('!!document.querySelector(".stepper-input[aria-disabled]")')) {
          console.log('Zalo form state:', await run('document.body.innerText.slice(0,1500)'));
        }
        assert.equal(await calls(),1);
        assert.deepEqual(await run('usageFixture.calls[0].scopes[0].accountIds'),[41,42,43,44,45,46]);
        assert.deepEqual(await run('usageFixture.calls[0].scopes[0].actionCodes'),['zalo_find_phone_user','zalo_message_stranger','zalo_add_friend'],
          'Zalo snapshot excludes unused tag/alias counters');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await wait('document.querySelectorAll(".campaign-account-picker-row").length===6');
        assert.equal(await run('document.querySelectorAll(".campaign-account-picker thead tr:nth-child(2) th").length'),3,'all main Zalo actions displayed');
        assert.ok((await picker()).includes('Bị giới hạn - Còn 18 phút'));
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-row")).every(row=>row.getBoundingClientRect().height<=34)'), 'Zalo stays one line');
        await assertPickerLoginsFit();
        await run('document.querySelector(".campaign-account-picker").scrollIntoView({block:"center"})'); await delay(100);
        await run('document.querySelector(".campaign-account-picker-scroll").scrollTop=0'); await delay(100);
        require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'akaagent-account-picker-zalo-smoke.png'))},(await win.webContents.capturePage()).toPNG());
        win.setSize(1000,800); await delay(150);
        await assertPickerLoginsFit();
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).every(cell=>getComputedStyle(cell).whiteSpace==="nowrap")'));
        assert.equal(await calls(),1,'resizing never queries');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await run('for (const label of document.querySelectorAll("label.schedule-checkbox-label")) { const name=label.textContent.trim(); const input=label.querySelector("input"); if ((["Nhắn tin","Kết bạn"].includes(name) && input.checked) || (label.classList.contains("zalo-auxiliary-toggle") && !input.checked)) input.click(); }');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await wait('document.querySelectorAll(".campaign-account-picker-row").length===6');
        assert.deepEqual(await run('Array.from(document.querySelectorAll(".campaign-account-picker thead tr:nth-child(2) th")).map(cell=>cell.textContent)'),
          ['Tìm SĐT','Nhắn tin người lạ','Kết bạn'],'Zalo main actions stay visible while enabled tag/alias stay hidden');
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-action")).every(cell=>cell.textContent.includes("12 - "))'));
        assert.equal(await calls(),1,'Zalo option changes reuse the opening snapshot');
        console.log('PASS picker columns: unchecked main actions stay visible, tag/alias stay hidden, timeline only displays posting; no extra queries.');
        const realtimeCodes = ['zalo_message_stranger','zalo_add_friend'];
        const realtimeScope = {accountIds:[41,42,43,44,45],actionCodes:realtimeCodes};
        for (const locked of [false,true]) {
          await run('usageFixture.configureVisibility('+JSON.stringify(locked ? [] : ['zalo_message_phone'])+');usageFixture.openZaloForm('+JSON.stringify({actionId:'zalo_message_group_realtime',extraActionId:'zalo_message_phone',locked})+')');
          await wait('usageFixture.calls.length===1');
          assert.deepEqual(await run('usageFixture.calls'),[{scopes:[realtimeScope]}],
            'realtime excludes web statistics when other types are hidden or the form is locked');
          await run('document.querySelector(".stepper-input[aria-disabled]").click()');
          await wait('document.querySelectorAll(".campaign-account-picker-row").length===5');
          assert.deepEqual(await run('Array.from(document.querySelectorAll(".campaign-account-picker-row")).map(row=>Number(row.dataset.accountId))'),realtimeScope.accountIds,
            'statistics scope matches selectable QR/server accounts');
          await run('window.dispatchEvent(new Event("focus"))'); await delay(100); assert.equal(await calls(),1);
        }
        await run('usageFixture.configureVisibility([]);usageFixture.openZaloForm({actionId:"zalo_message_group_realtime",extraActionId:"zalo_message_group"})');
        await wait('usageFixture.calls.length===1');
        assert.deepEqual(await run('usageFixture.calls.map(call=>({scopes:call.scopes.map(scope=>({...scope,actionCodes:[...scope.actionCodes].sort()}))}))'),[{scopes:[
          {accountIds:[41,42,43,44,45],actionCodes:[...realtimeCodes,'zalo_message_group'].sort()},
          {accountIds:[46],actionCodes:['zalo_message_group']}
        ]}],'mixed choices only add codes from compatible campaign types per account');
        await run('(()=>{const action=Array.from(document.querySelectorAll("select")).find(select=>Array.from(select.options).some(option=>option.value==="zalo_message_group"));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(action,"zalo_message_group");action.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await wait('document.querySelectorAll(".campaign-account-picker-row").length===6');
        assert.ok(await run('Array.from(document.querySelectorAll(".campaign-account-picker-row")).find(row=>row.dataset.accountId==="46").querySelector(".campaign-account-picker-action").textContent.includes("12 - Bình thường")'),
          'switching to a compatible type uses the preloaded web count');
        assert.equal(await calls(),1,'switching campaign types does not reload statistics');
        await run('usageFixture.openZaloForm({actionId:"zalo_message_group_realtime",extraActionId:"zalo_message_phone"})');
        await wait('usageFixture.calls.length===1');
        assert.equal(await run('usageFixture.calls[0].scopes.length'),1,'equal code sets still share one scope');
        assert.deepEqual(await run('usageFixture.calls[0].scopes[0].accountIds'),[41,42,43,44,45,46],
          'shared realtime codes remain available to web accounts through the phone campaign');
        await run('usageFixture.openZaloForm({actionId:"zalo_message_group_realtime",onlyWeb:true})');
        await wait('!document.body.textContent.includes("Đang tải cài đặt hiển thị")');
        await delay(350); assert.equal(await calls(),0,'no compatible accounts means no statistics query');
        await run('document.querySelector(".stepper-input[aria-disabled]").click()');
        await wait('!!document.querySelector(".campaign-account-picker-empty")');
        console.log('PASS account compatibility: hidden/locked realtime, QR/server, mixed and shared action codes, web selection without refetch, empty scope.');
        assert.deepEqual(await run('usageFixture.errors'),[]);
        console.log('PASS React/form: selection triggers, debounce, in-flight reuse, stale responses, error/no retry, create/edit/clone/draft, daily-only form snapshot, compact picker, one load across action/account/toggle changes, stale-session guards. Screenshot: '+screenshot);
        win.destroy();app.exit(0);
      }).catch(error=>{console.error(error);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [join(directory, 'electron.cjs')], { cwd: root, env, stdio: 'inherit', timeout: 60000 })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    if (process.exitCode) console.log('Failed fixture retained:', directory)
    else rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
