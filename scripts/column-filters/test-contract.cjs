const assert=require('node:assert/strict'),esbuild=require('esbuild'),path=require('node:path')
function load(file){const mod={exports:{}};new Function('module','exports','require',esbuild.buildSync({entryPoints:[path.resolve(file)],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text)(mod,mod.exports,require);return mod.exports}
const {normalizeColumnFilters:normalize,columnFilterDateBoundary:boundary,DATA_COLUMNS}=load('src/shared/dataColumnFilters.ts')
const {FILTER_READ_POLICY,FilterReadCoordinator,FilterTransportTimeoutError}=load('src/main/data/filters/filterReadCoordinator.ts')
const {compilePageInboxColumnFilters:compile,foldColumnFilterText:fold}=load('src/main/data/filters/sqliteColumnFilters.ts')
const req=(...filters)=>({version:1,filters});let passed=0
function test(name,fn){fn();passed++;console.log('PASS',name)}
test('date interval is Vietnam midnight and exclusive next day',()=>{assert.equal(boundary('2026-10-21'),'2026-10-20T17:00:00.000Z');assert.equal(boundary('2026-10-21',true),'2026-10-21T17:00:00.000Z')})
test('invalid calendar date rejected',()=>{assert.throws(()=>boundary('2026-02-30'));assert.throws(()=>normalize('page_inbox',req({field:'lastMessageAt',op:'gte',value:'2026-02-30T00:00:00Z'})))})
test('mixed ISO precision normalized before range comparison',()=>{assert.equal(normalize('page_inbox',req({field:'lastMessageAt',op:'between',value:'2026-01-01T00:00:00Z',to:'2026-01-01T00:00:00.001Z'})).filters[0].value,'2026-01-01T00:00:00.000Z')})
test('unknown field/operator/source and duplicate field rejected',()=>{for(const request of [req({field:'password',op:'eq',value:'x'}),req({field:'name',op:'gt',value:'x'}),req({field:'name',op:'eq',value:'a'},{field:'name',op:'eq',value:'b'})])assert.throws(()=>normalize('data_group',request))})
test('identifier retains zeros and Unicode accents',()=>{assert.equal(normalize('data_group',req({field:'uid',op:'eq',value:'00001'})).filters[0].value,'00001');assert.equal(fold('NGUYỄN'),'nguyễn')})
test('bounded values, numeric values, and versions',()=>{assert.throws(()=>normalize('contacts',{version:2,filters:[]}));assert.throws(()=>normalize('contacts',req({field:'memberCount',op:'eq',value:NaN})));assert.throws(()=>normalize('data_group',req({field:'uid',op:'in',value:Array(201).fill('x')})))})
test('SQLite uses bound literal contains and strict field mapping',()=>{let q=compile(req({field:'message',op:'contains',value:"%_'; DROP TABLE x; --"}));assert.ok(!q.sql.includes('DROP'));assert.equal(q.params[0],"%_'; DROP TABLE x; --");assert.ok(q.sql.includes('instr('));for(const c of DATA_COLUMNS.filter(c=>c.sources.includes('page_inbox')))assert.doesNotThrow(()=>compile(req({field:c.id,op:'empty'})))})
test('bulk deadlines allow the full server budget',()=>{assert.equal(FILTER_READ_POLICY.serverBudgetMs,60000);assert.equal(FILTER_READ_POLICY.deadlineMs,65000)})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
;(async()=>{
 let coordinator=new FilterReadCoordinator({concurrency:2,pending:4,deadlineMs:180,serverBudgetMs:80})
 let running=0,max=0,starts=0
 const read=signal=>new Promise((resolve,reject)=>{starts++;running++;max=Math.max(max,running);let timer=setTimeout(()=>{running--;resolve('ok')},35);signal.addEventListener('abort',()=>{clearTimeout(timer);running--;reject(new Error('aborted'))},{once:true})})
 await Promise.all(Array.from({length:4},(_,i)=>coordinator.read('w:'+i,'r'+i,read)))
 assert.equal(max,2);passed++;console.log('PASS global concurrency bound')
 let old=coordinator.read('w:form','old',()=>new Promise(resolve=>setTimeout(()=>resolve('old'),100))).catch(e=>e.message)
 await sleep(5);let fresh=coordinator.read('w:form','fresh',async()=> 'fresh');assert.match(await old,/hủy/);assert.equal(await fresh,'fresh');passed++;console.log('PASS stale response rejected')
 // Fast transport rejection after abort must retain its database slot until server deadline.
 coordinator=new FilterReadCoordinator({concurrency:1,pending:4,deadlineMs:200,serverBudgetMs:70})
 let start=Date.now();let first=coordinator.read('a:1','old',async signal=>{try{return await read(signal)}catch{throw new FilterTransportTimeoutError('aborted transport')}}).catch(()=>null);await sleep(5);coordinator.cancel('a:1','old')
 let nextStarted=0;await coordinator.read('b:2','new',async()=>{nextStarted=Date.now();return 1});await first;assert.ok(nextStarted-start>=65);passed++;console.log('PASS aborted HTTP retains server budget')
 coordinator=new FilterReadCoordinator({concurrency:1,pending:4,deadlineMs:50,serverBudgetMs:30})
 let late=coordinator.read('a:1','late',async()=>{await sleep(110);return 'late'}).catch(e=>e.message)
 let queuedStarted=false;await sleep(5);let queued=coordinator.read('a:2','queued',async()=>{queuedStarted=true;return 1}).catch(e=>e.message)
 assert.match(await late,/thời gian/);assert.match(await queued,/thời gian/);assert.equal(queuedStarted,false);await sleep(60);assert.equal(await coordinator.read('a:3','new',async()=>3),3);passed++;console.log('PASS timeout preserves slot until transport settles; expired queued work never starts')
 coordinator=new FilterReadCoordinator({concurrency:1,pending:4,deadlineMs:200,serverBudgetMs:10})
 let protectedRead=coordinator.read('owner:form','new',async()=>{await sleep(20);return 2});coordinator.cancel('other:form','new');coordinator.cancel('owner:form','old');assert.equal(await protectedRead,2);passed++;console.log('PASS cancellation binds owner and request')
 coordinator=new FilterReadCoordinator({concurrency:1,pending:4,deadlineMs:200,serverBudgetMs:60});start=Date.now();
 await assert.rejects(coordinator.read('w:1','timeout',async()=>{throw new FilterTransportTimeoutError('timeout')}),/timeout/);
 await coordinator.read('w:2','next',async()=>{assert.ok(Date.now()-start>=55);return 1});passed++;console.log('PASS per-page transport timeout retains server budget')
 coordinator=new FilterReadCoordinator({concurrency:1,pending:4,deadlineMs:500,serverBudgetMs:400});start=Date.now();
 let confirmed=coordinator.read('w:1','old',async()=>{await sleep(40);return 1}).catch(()=>null);await sleep(5);coordinator.cancel('w:1','old');
 await coordinator.read('w:2','new',async()=>{assert.ok(Date.now()-start>=35&&Date.now()-start<200);return 2});await confirmed;passed++;console.log('PASS cancelled read holds slot until confirmed completion without extra cooldown');
 console.log(`${passed} checks passed`)
})().catch(e=>{console.error(e);process.exitCode=1})
