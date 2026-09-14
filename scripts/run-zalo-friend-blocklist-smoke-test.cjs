const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const { createClient } = require('@supabase/supabase-js')
const root = resolve(__dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'aka-blocklist-'))

async function repositorySmoke() {
  await build({
    entryPoints: [join(root, 'src/main/data/repositories/accountContactRepository.ts')],
    outfile: join(directory, 'repository.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
    plugins: [{ name: 'block-live-db', setup(builder) {
      builder.onResolve({ filter: /\/(supabaseClient|currentUser)$/ }, args => ({ path: args.path.endsWith('/supabaseClient') ? 'db' : 'auth', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'db'
        ? 'export const getSupabaseClient = () => globalThis.blocklistDb;'
        : 'export const requireCurrentUser = () => ({staffId:7,organizationId:9}); export const getCurrentUser = requireCurrentUser; export const requireCurrentUserCredentials = () => {throw new Error("Live credentials blocked")};' }))
    } }]
  })
  const contacts = Array.from({ length: 2605 }, (_, i) => ({
    id: i + 1, name: i < 100 ? `A Stranger ${i}` : `Friend ${String(Math.floor(i / 2)).padStart(4, '0')}`,
    uid: `uid-${i + 1}`, account_id: 11, staff_id: 7, organization_id: 9,
    contact_type: 'person', is_friend: i >= 100, is_delete: false
  }))
  const special = 'Bạn * 100%_ [VIP], "A" \\ (x) + $'
  contacts[2500].name = special
  const groups = [{ id: 31, account_id: 11, staff_id: 7, organization_id: 9, contact_type: 'person', purpose: 'zalo_friend_blocklist', is_delete: false, name: 'Blocked' }]
  const memberships = contacts.filter(row => row.id > 100 && row.id <= 1205).map(row => ({ contact_id: row.id, group_id: 31, is_delete: false }))
  memberships.push({ contact_id: 1206, group_id: 31, is_delete: true }, { contact_id: 1207, group_id: 32, is_delete: false })
  for (const [index, overrides] of [{ account_id: 22 }, { staff_id: 8 }, { organization_id: 10 }, { is_delete: true }, { contact_type: 'group' }].entries()) {
    contacts.push({ ...contacts[1500], ...overrides, id: 9001 + index })
  }
  const calls = []
  let fail = false
  let failCount = false
  let beforeContactRequest = null
  let failMutationAfter = null
  let loseMutationResponse = false
  globalThis.blocklistDb = createClient('https://fixture.invalid', 'fixture-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      const url = new URL(input)
      assert.equal(url.hostname, 'fixture.invalid')
      const p = url.searchParams
      const table = url.pathname.split('/').pop()
      assert.ok(['auto_account_contacts', 'auto_account_contact_groups', 'auto_account_contact_group_members'].includes(table), table)
      if (fail || (failCount && options.method === 'HEAD')) return new Response(JSON.stringify({ message: 'Fixture failure' }), { status: 500 })
      if (options.method === 'POST' || options.method === 'PATCH') {
        assert.equal(table, 'auto_account_contact_group_members')
        if (failMutationAfter !== null) {
          if (failMutationAfter-- === 0) return new Response(JSON.stringify({ message: 'Fixture mutation failure' }), { status: 400 })
        }
        if (options.method === 'POST') {
          const incoming = JSON.parse(options.body)
          calls.push({ table, method: 'POST', written: incoming.length })
          for (const row of incoming) {
            const existing = memberships.find(m => m.group_id === row.group_id && m.contact_id === row.contact_id)
            if (existing) Object.assign(existing, row)
            else memberships.push(row)
          }
          if (loseMutationResponse) {
            loseMutationResponse = false
            return new Response(JSON.stringify({ message: 'Fixture response lost after commit' }), { status: 400 })
          }
          return new Response(null, { status: 201 })
        }
      }
      if (table === 'auto_account_contacts') beforeContactRequest?.(options.method, p)
      let rows = (table === 'auto_account_contacts' ? contacts : table === 'auto_account_contact_groups' ? groups : memberships).filter(row => {
        return [...p].filter(([key]) => !key.includes('.')).every(([key, value]) => {
          if (value.startsWith('eq.')) return String(row[key]) === value.slice(3)
          if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]))
          return true
        })
      })
      if (options.method === 'PATCH') {
        rows.forEach(row => Object.assign(row, JSON.parse(options.body)))
        if (loseMutationResponse) {
          loseMutationResponse = false
          return new Response(JSON.stringify({ message: 'Fixture response lost after commit' }), { status: 400 })
        }
      }
      if (p.has('blocklist_members')) {
        const groupId = Number(p.get('blocklist_members.group_id').slice(3))
        rows = rows.filter(row => memberships.some(m => m.contact_id === row.id && m.group_id === groupId && !m.is_delete) === (p.get('blocklist_members') === 'not.is.null'))
      }
      if (p.has('or')) {
        const match = /^\(name\.imatch\.("(?:[^"\\]|\\.)*"),uid\.imatch\.("(?:[^"\\]|\\.)*")\)$/.exec(p.get('or'))
        assert.ok(match, `Unsafe/invalid search expression: ${p.get('or')}`)
        assert.equal(match[1], match[2])
        const regex = new RegExp(JSON.parse(match[1]), 'iu')
        rows = rows.filter(row => regex.test(row.name || '') || regex.test(row.uid || ''))
      }
      const total = rows.length
      if (table === 'auto_account_contacts' && p.has('offset')) assert.equal(p.get('order'), 'name.asc,id.asc')
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || a.id - b.id)
      const offset = Number(p.get('offset') || 0)
      const limit = Math.min(1000, Number(p.get('limit') || 1000)) // Simulate the unchanged API cap.
      rows = rows.slice(offset, offset + limit)
      const idFilter = p.get('id') || p.get('contact_id') || ''
      calls.push({ table, method: options.method, offset, limit, returned: options.method === 'HEAD' ? 0 : rows.length, select: p.get('select'), ids: idFilter.startsWith('in.(') ? idFilter.slice(4, -1).split(',').length : 0 })
      if (offset > 0 && offset >= total) {
        return new Response(JSON.stringify({
          code: 'PGRST103', message: 'Requested range not satisfiable',
          details: `An offset of ${offset} was requested, but there are only ${total} rows.`, hint: null
        }), { status: 416, headers: { 'content-type': 'application/json', 'content-range': `*/${total}` } })
      }
      const headers = { 'content-type': 'application/json', 'content-range': `${offset}-${offset + rows.length - 1}/${total}` }
      if (options.method === 'HEAD') return new Response(null, { headers })
      const single = new Headers(options.headers).get('accept')?.includes('vnd.pgrst.object')
      if (single && rows.length !== 1) return new Response(JSON.stringify({ message: 'Not found' }), { status: 406 })
      return new Response(JSON.stringify(single ? rows[0] : rows), { headers })
    } }
  })
  const repo = require(join(directory, 'repository.cjs'))
  const first = await repo.listZaloFriendBlocklistPage(11, { mode: 'available' })
  assert.equal(first.total, 2505)
  assert.equal(first.contacts.length, 100)
  assert.ok(first.contacts.every(row => row.id > 100 && row.id < 9000), 'filter friendship/tenant before pagination')
  const allIds = []
  for (let offset = 0; offset < 2505; offset += 100) {
    const result = await repo.listZaloFriendBlocklistPage(11, { mode: 'available', offset })
    allIds.push(...result.contacts.map(row => row.id))
  }
  assert.equal(new Set(allIds).size, 2505, 'all contacts beyond 1000; stable order for equal names')
  const available = await repo.listZaloFriendBlocklistPage(11, { mode: 'available', groupId: 31 })
  assert.equal(available.total, 1400)
  assert.ok(available.contacts.some(row => row.id === 1206), 'soft-deleted membership can be added again')
  assert.ok(available.contacts.some(row => row.id === 1207), 'membership in another list does not exclude')
  const members = await repo.listZaloFriendBlocklistPage(11, { mode: 'members', groupId: 31, offset: 1000 })
  assert.equal(members.total, 1105)
  assert.equal(members.contacts.length, 100)
  for (const search of ['uid-2501', special, '*', '%_', '[VIP]', '"A"', '\\']) {
    const result = await repo.listZaloFriendBlocklistPage(11, { mode: 'available', groupId: 31, search })
    assert.deepEqual(result.contacts.map(row => row.id), [2501], `literal global search: ${search}`)
  }
  assert.equal((await repo.listZaloFriendBlocklistPage(11, { mode: 'available', limit: 99999 })).contacts.length, 100)
  assert.equal((await repo.listZaloFriendBlocklistPage(11, { mode: 'available', search: 'no match' })).total, 0)
  for (const [query, expectedTotal] of [
    [{ mode: 'available', offset: 2600 }, 2505],
    [{ mode: 'available', groupId: 31, offset: 1400 }, 1400],
    [{ mode: 'members', groupId: 31, offset: 1200 }, 1105],
    [{ mode: 'available', groupId: 31, search: special, offset: 100 }, 1],
    [{ mode: 'available', search: 'no match', offset: 100 }, 0]
  ]) {
    calls.length = 0
    assert.deepEqual(await repo.listZaloFriendBlocklistPage(11, query), { contacts: [], total: expectedTotal }, '416 recovers the current filtered total')
    assert.deepEqual(calls.filter(call => call.table === 'auto_account_contacts').map(call => [call.method, call.offset, call.returned]), [
      ['GET', query.offset, 0], ['HEAD', 0, 0]
    ], 'recovery only adds one count-only query without the stale range')
  }
  failCount = true
  await assert.rejects(repo.listZaloFriendBlocklistPage(11, { mode: 'available', offset: 2600 }), /Failed to count/)
  failCount = false
  // A concurrent change can restore a page between GET 416 and the HEAD recount.
  const raceContacts = Array.from({ length: 101 }, (_, i) => ({
    ...contacts[1500], id: 20000 + i, name: `Concurrent * [VIP] ${String(i).padStart(3, '0')}`, uid: `race-${i}`
  }))
  contacts.push(...raceContacts)
  for (const mode of ['available', 'members']) {
    const membershipStart = memberships.length
    if (mode === 'members') memberships.push(...raceContacts.map(row => ({ contact_id: row.id, group_id: 31, is_delete: false })))
    for (const [scenario, totals] of [
      ['restored', [100, 101, 101]],
      ['shrinks-again', [100, 101, 100, 100]],
      ['keeps-changing', [100, 101, 100, 101]]
    ]) {
      const snapshots = [...totals]
      calls.length = 0
      beforeContactRequest = (method, params) => {
        assert.ok(snapshots.length, 'recovery must not exceed one page retry')
        raceContacts[100].is_delete = snapshots.shift() === 100
        assert.equal(params.get('account_id'), 'eq.11')
        assert.equal(params.get('staff_id'), 'eq.7')
        assert.equal(params.get('organization_id'), 'eq.9')
        assert.equal(params.get('blocklist_members.group_id'), 'eq.31')
        assert.equal(params.get('blocklist_members.is_delete'), 'eq.false')
        assert.equal(params.get('blocklist_members'), mode === 'members' ? 'not.is.null' : 'is.null')
        assert.ok(params.get('or')?.includes('Concurrent'), 'every recovery query keeps the search')
        if (method === 'GET') {
          assert.equal(params.get('offset'), '100')
          assert.equal(params.get('limit'), '100')
        }
      }
      const request = repo.listZaloFriendBlocklistPage(11, { mode, groupId: 31, search: 'Concurrent * [VIP]', offset: 100 })
      if (scenario === 'keeps-changing') {
        await assert.rejects(request, /Dữ liệu danh sách vừa thay đổi.*tải lại/, 'repeated races surface an error instead of a false empty page')
      } else {
        const result = await request
        assert.deepEqual(result, scenario === 'restored'
          ? { contacts: [{ id: 20100, name: 'Concurrent * [VIP] 100', uid: 'race-100' }], total: 101 }
          : { contacts: [], total: 100 }, `${mode}: ${scenario}`)
      }
      assert.equal(snapshots.length, 0)
      assert.deepEqual(calls.filter(call => call.table === 'auto_account_contacts').map(call => call.method),
        scenario === 'restored' ? ['GET', 'HEAD', 'GET'] : ['GET', 'HEAD', 'GET', 'HEAD'])
    }
    memberships.splice(membershipStart)
  }
  beforeContactRequest = null
  contacts.splice(contacts.length - raceContacts.length)
  assert.deepEqual(await repo.listZaloFriendBlocklistPage(11, { mode: 'members' }), { contacts: [], total: 0 })
  await assert.rejects(repo.listZaloFriendBlocklistPage(22, { mode: 'members', groupId: 31 }), /không thuộc/)
  await assert.rejects(repo.listZaloFriendBlocklistPage(11, { mode: 'members', groupId: -1 }), /không hợp lệ/)
  await assert.rejects(repo.listZaloFriendBlocklistPage(11, { mode: 'invalid' }), /không hợp lệ/)
  for (const [field, wrong] of [['staff_id', 8], ['organization_id', 10], ['purpose', 'data_group'], ['is_delete', true]]) {
    const old = groups[0][field]; groups[0][field] = wrong
    await assert.rejects(repo.listZaloFriendBlocklistPage(11, { mode: 'members', groupId: 31 }), /Not found/)
    groups[0][field] = old
  }
  calls.length = 0
  const listed = await repo.listZaloFriendBlocklists(11)
  assert.equal(listed[0].contactCount, 1105)
  assert.deepEqual(calls.filter(c => c.table === 'auto_account_contacts').map(c => [c.method, c.returned]), [['HEAD', 0]])
  const bulkIds = Array.from({ length: 1205 }, (_, i) => 1206 + i)
  calls.length = 0
  assert.deepEqual(await repo.addFriendsToZaloFriendBlocklist(31, [...bulkIds, 1206, 1, 9001, 9002, 9003, 9004, 9005]), { success: true, count: 1205 })
  assert.equal(memberships.filter(row => row.group_id === 31 && !row.is_delete).length, 2310)
  assert.deepEqual(await repo.addFriendsToZaloFriendBlocklist(31, bulkIds), { success: true, count: 0 }, 'repeat add is idempotent')
  assert.deepEqual(await repo.removeFriendsFromZaloFriendBlocklist(31, [...bulkIds, 1206]), { success: true, count: 1205 })
  assert.equal(memberships.filter(row => row.group_id === 31 && !row.is_delete).length, 1105)
  assert.equal(memberships.find(row => row.group_id === 32 && row.contact_id === 1207).is_delete, false, 'other lists are unchanged')
  assert.ok(calls.every(call => (call.ids || 0) <= 100 && (call.written || 0) <= 100), 'all multi-page mutation queries are bounded to 100 IDs')
  // Already committed chunks are safe to retry after a later chunk fails.
  failMutationAfter = 1
  const partialAdd = await repo.addFriendsToZaloFriendBlocklist(31, bulkIds.slice(0, 205))
  assert.equal(partialAdd.success, false)
  assert.equal(partialAdd.count, 100)
  assert.deepEqual(partialAdd.remainingIds, bulkIds.slice(100, 205))
  assert.match(partialAdd.error, /Fixture mutation failure/)
  assert.deepEqual(structuredClone(partialAdd), partialAdd, 'partial results survive IPC serialization')
  failMutationAfter = null
  assert.deepEqual(await repo.addFriendsToZaloFriendBlocklist(31, partialAdd.remainingIds), { success: true, count: 105 })
  failMutationAfter = 1
  const partialRemove = await repo.removeFriendsFromZaloFriendBlocklist(31, bulkIds.slice(0, 205))
  assert.equal(partialRemove.success, false)
  assert.equal(partialRemove.count, 100)
  assert.deepEqual(partialRemove.remainingIds, bulkIds.slice(100, 205))
  assert.match(partialRemove.error, /Fixture mutation failure/)
  failMutationAfter = null
  assert.deepEqual(await repo.removeFriendsFromZaloFriendBlocklist(31, partialRemove.remainingIds), { success: true, count: 105 })
  // No-op chunks are complete even when their changed-row count is zero.
  failMutationAfter = 0
  const afterNoOp = await repo.addFriendsToZaloFriendBlocklist(31, [...Array.from({ length: 100 }, (_, i) => 101 + i), ...bulkIds.slice(0, 5)])
  assert.equal(afterNoOp.success, false)
  assert.equal(afterNoOp.count, 0)
  assert.deepEqual(afterNoOp.remainingIds, bulkIds.slice(0, 5))
  failMutationAfter = null
  for (const method of ['addFriendsToZaloFriendBlocklist', 'removeFriendsFromZaloFriendBlocklist']) {
    loseMutationResponse = true
    const uncertain = await repo[method](31, bulkIds.slice(0, 205))
    assert.equal(uncertain.success, false)
    assert.equal(uncertain.count, 0, 'only acknowledged changes count as confirmed')
    assert.deepEqual(uncertain.remainingIds, bulkIds.slice(0, 205), 'uncertain chunks remain retryable')
    assert.deepEqual(await repo[method](31, uncertain.remainingIds), { success: true, count: 105 })
  }
  fail = true
  await assert.rejects(repo.listZaloFriendBlocklistPage(11, { mode: 'available' }), /Fixture failure/)
  console.log('PASS repository: 2,505 friends, 1,105 members, 100-row pages, search/guards, HTTP 416 recovery, 1,205-ID add/remove, partial/no-op/uncertain chunks, pending-ID retry.')
}

async function rendererSmoke() {
  const entry = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Settings from ${JSON.stringify(join(root, 'src/renderer/src/components/Settings/ZaloFriendBlocklistSettings.tsx'))};
    import {useUiStore} from ${JSON.stringify(join(root, 'src/renderer/src/stores/uiStore.ts'))};
    import ${JSON.stringify(join(root, 'src/renderer/src/styles/global.css'))};
    const friends=Array.from({length:2105},(_,i)=>({id:i+1,name:'Friend '+String(i+1).padStart(4,'0'),uid:'uid-'+(i+1)}));
    const members=new Set(Array.from({length:1105},(_,i)=>i+1));
    const calls=[],alerts=[];let defer=false,pending=[],failure=false,partialMode=null,metadataFailure=false;
    const mutate=(mode,ids)=>{
      calls.push({[mode]:ids});const failureMode=partialMode;partialMode=null;
      const applied=failureMode?ids.slice(0,100):ids;let count=0;
      applied.forEach(id=>{if(mode==='add'){if(!members.has(id))count++;members.add(id)}else{if(members.has(id))count++;members.delete(id)}});
      if(failureMode==='ipc')throw new Error('Fixture IPC response lost');
      return failureMode?{success:false,count,remainingIds:ids.slice(100),error:'Fixture second chunk failed'}:{success:true,count};
    };
    window.fixture={calls,alerts,hold:()=>{defer=true},release:()=>{defer=false;pending.splice(0).forEach(fn=>fn())},fail:v=>{failure=v},partial:mode=>{partialMode=mode},failNextMetadata:()=>{metadataFailure=true},reset:()=>{members.clear();for(let id=1;id<=1105;id++)members.add(id)}};
    useUiStore.setState({showAlert:(message,kind)=>{alerts.push({message,kind})},showConfirm:(_text,fn)=>fn()});
    window.electronAPI={
      listAccounts:async()=>[{id:11,name:'Account A',flatformType:'zalo'},{id:22,name:'Account B',flatformType:'zalo'}],
      listZaloFriendBlocklists:async accountId=>{if(metadataFailure){metadataFailure=false;throw new Error('Fixture metadata refresh failed')}return accountId===11?[{id:31,accountId:11,name:'Blocked',contactCount:members.size},{id:32,accountId:11,name:'Other list',contactCount:0}]:[]},
      listZaloFriendBlocklistPage:async (accountId,q)=>{
        calls.push({accountId,...q});
        if(failure)throw new Error('Fixture load error');
        let rows=accountId===11?friends:[{id:9999,name:'Account B Friend',uid:'uid-B'}];
        if(q.groupId)rows=rows.filter(row=>(q.groupId===31 && members.has(row.id))===(q.mode==='members'));
        if(q.search)rows=rows.filter(row=>(row.name+' '+row.uid).toLowerCase().includes(q.search.toLowerCase()));
        // This mocks the IPC result after repository HTTP 416 recovery, tested above.
        const data={contacts:rows.slice(q.offset,q.offset+q.limit),total:rows.length};
        if(defer)await new Promise(resolve=>pending.push(resolve));
        return data;
      },
      addFriendsToZaloFriendBlocklist:async (_id,ids)=>mutate('add',ids),
      removeFriendsFromZaloFriendBlocklist:async (_id,ids)=>mutate('remove',ids)
    };
    document.body.style.height='900px';
    createRoot(document.getElementById('root')).render(<Settings/>);
  `
  await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, outfile: join(directory, 'renderer.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'warning', loader: { '.woff2': 'dataurl' } })
  writeFileSync(join(directory, 'index.html'), '<html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root" style="height:850px;padding:20px"></div><script type="module" src="renderer.js"></script></body></html>')
  writeFileSync(join(directory, 'renderer-test.cjs'), `
    const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');const {join}=require('node:path');
    app.setPath('userData',join(__dirname,'user-data'));
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,width:1500,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3&&!message.includes('ERR_FILE_NOT_FOUND'))errors.push(message)});
      const run=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){throw new Error(s+' -> '+e.message)}};
      const wait=async(s)=>{for(let i=0;i<150;i++){if(await run(s))return;await new Promise(r=>setTimeout(r,20))}throw new Error('Timed out: '+s)};
      const change=async(selector,value)=>run('Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(document.querySelector('+JSON.stringify(selector)+'),'+JSON.stringify(value)+');document.querySelector('+JSON.stringify(selector)+').dispatchEvent(new Event("input",{bubbles:true}))');
      const panel=n=>'document.querySelectorAll(".zalo-blocklist-panel")['+n+']';
      const ready=n=>'('+panel(n)+'?.querySelectorAll("tbody input[type=checkbox]").length || 0)';
      await win.loadFile(join(__dirname,'index.html'));
      await wait(ready(2)+'===100 && '+ready(1)+'===100');
      assert.match(await run(panel(1)+'.textContent'),/1105 bạn bè/);
      assert.match(await run(panel(2)+'.textContent'),/1000 có thể thêm/);
      if(process.env.BLOCKLIST_SMOKE_SCREENSHOT)require('node:fs').writeFileSync(process.env.BLOCKLIST_SMOKE_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
      assert.equal(await run('document.querySelectorAll("thead input[type=checkbox]").length'),0,'no select-all control is added');
      // Selections span searched pages, and both actions submit every selected ID.
      for(const partial of [null,'structured','ipc'])for(const n of [2,1]){
        const searchSelector=n===2?'input[placeholder="Tìm bạn bè"]':'input[placeholder="Tìm trong danh sách"]';
        const action=n===2?'add':'remove';
        const totalPages=n===2?10:12;
        await change(searchSelector,'Friend');
        await wait(ready(n)+'===100');
        await run(panel(n)+'.querySelectorAll("tbody input").forEach(e=>e.click())');
        assert.match(await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions").textContent'),/\\(100\\)/);
        await run(panel(n)+'.querySelectorAll(".zalo-blocklist-pagination button")[1].click()');
        await wait(ready(n)+'===100 && '+panel(n)+'.textContent.includes("Trang 2 / '+totalPages+'")');
        assert.match(await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions").textContent'),/\\(100\\)/,'off-page selection is kept');
        await run('Array.from('+panel(n)+'.querySelectorAll("tbody input")).slice(0,20).forEach(e=>e.click())');
        assert.match(await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions").textContent'),/\\(120\\)/);
        await run(panel(n)+'.querySelectorAll(".zalo-blocklist-pagination button")[0].click()');
        await wait(ready(n)+'===100 && '+panel(n)+'.textContent.includes("Trang 1 / '+totalPages+'")');
        assert.equal(await run(panel(n)+'.querySelectorAll("tbody input:checked").length'),100,'returning to the first page restores checked rows');
        await run(panel(n)+'.querySelector("tbody input").click()');
        assert.match(await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions").textContent'),/\\(119\\)/,'individual uncheck preserves the other page');
        await run(panel(n)+'.querySelector("tbody input").click()');
        if(partial)await run('window.fixture.partial('+JSON.stringify(partial)+')');
        if(partial==='structured'&&n===1)await run('window.fixture.failNextMetadata()');
        await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions button").click()');
        if(partial){
          await wait(panel(1)+'.textContent.includes("'+(n===2?1205:1005)+' bạn bè") && '+panel(2)+'.textContent.includes("'+(n===2?900:1100)+' có thể thêm") && '+ready(1)+'===100 && '+ready(2)+'===100');
          const firstIds=await run('window.fixture.calls.filter(c=>c.'+action+').at(-1).'+action);
          const remaining=partial==='structured'?firstIds.slice(100):firstIds;
          const message=await run('window.fixture.alerts.at(-1).message');
          assert.equal(await run('window.fixture.alerts.at(-1).kind'),'error');
          assert.ok(message.includes(remaining.length+' bạn bè chưa xác nhận xử lý'));
          assert.ok(message.includes(partial==='structured'?'100 bạn bè':'Chưa xác nhận'));
          assert.ok((await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions").textContent')).includes('('+remaining.length+')'),'pending selection survives refresh');
          assert.equal(await run(panel(n)+'.querySelectorAll("tbody input:checked").length'),20,'confirmed rows disappear from this list');
          if(partial==='structured'&&n===1)assert.ok(message.includes('Chưa tải lại được số lượng danh sách'),'metadata failure is reported without losing pending IDs');
          await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions button").click()');
          await wait(panel(1)+'.textContent.includes("'+(n===2?1225:985)+' bạn bè") && '+ready(1)+'===100 && '+ready(2)+'===100');
          assert.deepEqual(await run('window.fixture.calls.filter(c=>c.'+action+').at(-1).'+action),remaining,'retry uses only pending/uncertain IDs');
        }
        await wait(panel(1)+'.textContent.includes("'+(n===2?1225:985)+' bạn bè") && '+ready(1)+'===100 && '+ready(2)+'===100');
        if(!partial)assert.deepEqual(await run('window.fixture.calls.filter(c=>c.'+action+').at(-1).'+action+'.slice().sort((a,b)=>a-b)'),Array.from({length:120},(_,i)=>(n===2?1106:1)+i));
        assert.equal(await run(panel(n)+'.querySelectorAll("tbody input:checked").length'),0,'successful mutation clears selections');
        await run('window.fixture.reset();document.querySelector(".content-template-editor-head button").click()');
        await wait(panel(1)+'.textContent.includes("1105 bạn bè") && '+panel(2)+'.textContent.includes("1000 có thể thêm") && '+ready(1)+'===100 && '+ready(2)+'===100');
      }
      for(const n of [1,2]){
        const searchSelector=n===2?'input[placeholder="Tìm bạn bè"]':'input[placeholder="Tìm trong danh sách"]';
        await run(panel(n)+'.querySelector("tbody input").click()');
        await change(searchSelector,n===2?'uid-2105':'uid-1105');
        await wait(ready(n)+'===1');
        assert.equal(await run(panel(n)+'.querySelectorAll("tbody input:checked").length'),0,'new search clears the old selection');
        assert.equal(await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions button").disabled'),true);
        await run(panel(n)+'.querySelector("tbody input").click()');
        await change(searchSelector,'');
        await wait(ready(n)+'===100');
        assert.equal(await run(panel(n)+'.querySelector(".zalo-blocklist-panel-actions button").disabled'),true,'clearing search also clears selections');
      }
      await run(panel(1)+'.querySelector("tbody input").click();'+panel(2)+'.querySelector("tbody input").click()');
      await run('document.querySelectorAll(".zalo-blocklist-row")[0].click()');
      assert.match(await run(panel(2)+'.querySelector(".zalo-blocklist-panel-actions").textContent'),/\\(1\\)/,'clicking the active list keeps selection');
      await run('document.querySelectorAll(".zalo-blocklist-row")[1].click()');
      await wait(ready(1)+'===0 && '+ready(2)+'===100 && '+panel(2)+'.textContent.includes("2105 có thể thêm")');
      await run('document.querySelectorAll(".zalo-blocklist-row")[0].click()');
      await wait(ready(1)+'===100 && '+ready(2)+'===100 && '+panel(2)+'.textContent.includes("1000 có thể thêm")');
      assert.equal(await run('document.querySelectorAll("tbody input:checked").length'),0,'changing list clears both selections');
      await run(panel(1)+'.querySelector("tbody input").click();'+panel(2)+'.querySelector("tbody input").click()');
      await run('document.querySelector("select").value="22";document.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}))');
      await wait(ready(2)+'===1 && '+panel(2)+'.textContent.includes("Account B Friend")');
      await run('document.querySelector("select").value="11";document.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}))');
      await wait(ready(1)+'===100 && '+ready(2)+'===100');
      assert.equal(await run('document.querySelectorAll("tbody input:checked").length'),0,'changing account clears both selections');
      await run(panel(2)+'.querySelector("tbody input").click()');
      assert.match(await run(panel(2)+'.querySelector(".zalo-blocklist-panel-actions").textContent'),/\\(1\\)/);
      await run(panel(2)+'.querySelectorAll(".zalo-blocklist-pagination button")[1].click()');
      await wait(ready(2)+'===100 && '+panel(2)+'.textContent.includes("Trang 2 / 10")');
      assert.equal(await run(panel(2)+'.querySelectorAll("tbody input:checked").length'),0,'the current page has no selected rows yet');
      assert.match(await run(panel(2)+'.querySelector(".zalo-blocklist-panel-actions").textContent'),/\\(1\\)/,'previous-page selection remains selected');
      for(let page=2;page<=11;page++){
        await run(panel(1)+'.querySelectorAll(".zalo-blocklist-pagination button")[1].click()');
        await wait(ready(1)+'>0 && '+panel(1)+'.textContent.includes("Trang '+page+' / 12")');
      }
      assert.match(await run(panel(1)+'.textContent'),/1001–1100/);
      await change('input[placeholder="Tìm bạn bè"]','uid-2105');
      await wait(ready(2)+'===1');
      assert.match(await run(panel(2)+'.textContent'),/Friend 2105/);
      assert.ok((await run(panel(2)+'.textContent')).includes('Trang 1 / 1'));
      await run(panel(2)+'.querySelector("tbody input").click();'+panel(2)+'.querySelector(".zalo-blocklist-panel-actions button").click()');
      await wait(panel(2)+'.textContent.includes("Không tìm thấy")');
      assert.equal(await run('window.fixture.calls.filter(c=>c.add).at(-1).add[0]'),2105);
      await change('input[placeholder="Tìm trong danh sách"]','uid-2105');
      await wait(ready(1)+'===1');
      await run(panel(1)+'.querySelector("tbody input").click();'+panel(1)+'.querySelector(".zalo-blocklist-panel-actions button").click()');
      await wait(ready(2)+'===1 && '+panel(1)+'.textContent.includes("Không tìm thấy")');
      assert.equal(await run('window.fixture.calls.filter(c=>c.remove).at(-1).remove[0]'),2105);
      // Deleting the only row on the last page must return to the last nonempty page.
      await change('input[placeholder="Tìm trong danh sách"]','');
      await wait(ready(1)+'===100');
      for(let page=2;page<=12;page++){
        await run(panel(1)+'.querySelectorAll(".zalo-blocklist-pagination button")[1].click()');
        await wait(ready(1)+'>0 && '+panel(1)+'.textContent.includes("Trang '+page+' / 12")');
      }
      await run(panel(1)+'.querySelectorAll("tbody input").forEach(e=>e.click())');
      await run(panel(1)+'.querySelector(".zalo-blocklist-panel-actions button").click()');
      await wait(ready(1)+'===100 && '+panel(1)+'.textContent.includes("Trang 11 / 11")');
      // Adding all remaining friends on the last page must also move back.
      await change('input[placeholder="Tìm bạn bè"]','');
      await wait(ready(2)+'===100 && '+panel(2)+'.textContent.includes("1005 có thể thêm")');
      for(let page=2;page<=11;page++){
        await run(panel(2)+'.querySelectorAll(".zalo-blocklist-pagination button")[1].click()');
        await wait(ready(2)+'>0 && '+panel(2)+'.textContent.includes("Trang '+page+' / 11")');
      }
      await run(panel(2)+'.querySelectorAll("tbody input").forEach(e=>e.click())');
      await run(panel(2)+'.querySelector(".zalo-blocklist-panel-actions button").click()');
      await wait(ready(2)+'===100 && '+panel(2)+'.textContent.includes("Trang 10 / 10")');
      await run('window.fixture.fail(true)');
      await change('input[placeholder="Tìm bạn bè"]','fail');
      await wait(panel(2)+'.querySelector("[role=alert]")!==null');
      assert.equal(await run(ready(2)),0,'failure clears stale rows');
      await run('window.fixture.fail(false);window.fixture.hold()');
      await change('input[placeholder="Tìm bạn bè"]','Friend');
      await wait('window.fixture.calls.some(c=>c.accountId===11 && c.search==="Friend")');
      await run('document.querySelector("select").value="22";document.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}))');
      await wait('window.fixture.calls.some(c=>c.accountId===22)');
      await run('window.fixture.release()');
      await wait(ready(2)+'===1 && '+panel(2)+'.textContent.includes("Account B Friend")');
      assert.equal(await run(panel(2)+'.textContent.includes("Friend 2105")'),false,'late response from account A is ignored');
      assert.ok(await run('window.fixture.calls.filter(c=>c.mode).every(c=>c.limit===100)'), 'all UI requests bounded to 100');
      assert.equal(errors.length,0,errors.join('\\n'));
      console.log('PASS renderer: cross-page selection, partial add/remove refresh and pending-ID retry, IPC uncertainty, metadata failure, search/list/account reset, empty last page, stale response.');
      win.destroy();app.exit(0);
    }).catch(e=>{console.error(e);app.exit(1)});
  `)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [join(directory, 'renderer-test.cjs')], { cwd: root, env, stdio: 'inherit', timeout: 60000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, 'Renderer smoke failed')
}

repositorySmoke().then(rendererSmoke).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  delete globalThis.blocklistDb
  rmSync(directory, { recursive: true, force: true })
})
