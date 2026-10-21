const {spawnSync}=require('node:child_process')
if(!process.versions.electron){let result=spawnSync(require('electron'),[__filename],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',timeout:60000});if(result.error)throw result.error;process.exit(result.status??1)}
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),esbuild=require('esbuild'),Database=require('better-sqlite3')
function load(file){const mod={exports:{}};new Function('module','exports','require',esbuild.buildSync({entryPoints:[path.resolve(file)],bundle:true,write:false,platform:'node',format:'cjs',external:['better-sqlite3']}).outputFiles[0].text)(mod,mod.exports,require);return mod.exports}
const {readSqliteFilterPage:read}=load('src/main/data/filters/sqliteFilterReader.ts')
const {compilePageInboxColumnFilters:compile}=load('src/main/data/filters/sqliteColumnFilters.ts')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'column-filter-sqlite-')),file=path.join(dir,'test.db')
const db=new Database(file);db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE auto_account_contacts(id INTEGER PRIMARY KEY,account_id INTEGER,staff_id INTEGER,organization_id INTEGER,name TEXT,uid TEXT,extra_data TEXT,updated_at TEXT); CREATE INDEX scope ON auto_account_contacts(account_id,staff_id,organization_id);`)
const insert=db.prepare('INSERT INTO auto_account_contacts VALUES(?,1,10,1,?,?,?,?)')
db.transaction(()=>{for(let n=1;n<=100000;n++)insert.run(n,n%100===0?'Nguyễn ÁNH '+n:'Khách '+n,'000'+n,JSON.stringify({phone:'090'+String(n).padStart(7,'0'),lastMessageText:n%7===0?'100%_literal':'normal',avatarUrl:n%5===0?'https://avatar.test/a':null,lastMessageAt:n%3===0?'2026-10-20T17:00:00Z':'2026-10-20T16:59:59Z'}),'2026-10-21T00:00:00Z')})();db.close()
;(async()=>{
 let checks=0;const times=[]
 async function query(filters){let c=compile({version:1,filters}),start=performance.now();const r=await read(file,'WHERE account_id=? AND staff_id=? AND organization_id=? AND ('+c.sql+')',[1,10,1,...c.params],100,0,new AbortController().signal);times.push(performance.now()-start);return r}
 assert.equal((await query([{field:'name',op:'contains',value:'nguyễn ánh'}])).total,1000);checks++
 assert.equal((await query([{field:'message',op:'contains',value:'%_'}])).total,14285);checks++
 assert.equal((await query([{field:'uid',op:'eq',value:'0001'}])).total,1);checks++
 assert.equal((await query([{field:'lastMessageAt',op:'gte',value:'2026-10-20T17:00:00Z'}])).total,33333);checks++
 let ticks=0,timer=setInterval(()=>ticks++,10);await query([]);clearInterval(timer);assert.ok(ticks>1);checks++
 const controller=new AbortController();timer=setTimeout(()=>controller.abort(),100);let started=performance.now();let rejected=false
 try { await read(file,'WHERE (SELECT count(*) FROM auto_account_contacts a CROSS JOIN auto_account_contacts b)>0',[],100,0,controller.signal,300) }catch(e){assert.match(e.message,/hủy/);rejected=true}finally{clearTimeout(timer)}
 assert.ok(rejected);assert.ok(performance.now()-started<1000,'native SQLite read did not stop within cancellation budget');checks++
 console.log(JSON.stringify({checks,timesMs:times,maxMs:Math.max(...times),cancelMs:performance.now()-started}))
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}))
