const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const source=ts.transpileModule(fs.readFileSync(path.join(root,'src/main/data/desktopSession.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exportsObject={};vm.runInNewContext(source,{exports:exportsObject,Buffer,setTimeout,clearTimeout,AbortSignal,Date,Error,Promise,Number,JSON})
const {DesktopSessionManager}=exportsObject
let now=1_800_000_000_000, checks=0
const fixture=(extra={})=>{const session={refreshToken:'refresh-one',expiresAt:now/1000+3600,staffId:1,organizationId:10,sessionId:'11111111-1111-4111-8111-111111111111',...extra};session.accessToken='header.'+Buffer.from(JSON.stringify({role:'aka_agent_desktop',sub:'22222222-2222-4222-8222-222222222222',session_id:session.sessionId,exp:session.expiresAt})).toString('base64url')+'.signature';return session}
const pass=s=>{checks++;console.log('PASS',s)}
async function main(){
 let calls=0,finish
 const manager=new DesktopSessionManager(async()=>{calls++;return new Promise(resolve=>{finish=resolve})},()=>now)
 await assert.rejects(manager.token());pass('no anonymous fallback without session')
 const first=fixture();manager.install(first,manager.revision());assert.equal(await manager.token(),first.accessToken);assert.equal(calls,0);pass('valid token adds no auth round trip')
 now+=3_598_000
 const concurrent=Array.from({length:20},()=>manager.token())
 assert.equal(calls,1);finish(fixture({refreshToken:'refresh-two'}))
 const tokens=await Promise.all(concurrent);assert.equal(new Set(tokens).size,1);pass('twenty expired requests share one renewal')
 now+=3_598_000
 const aborted=new AbortController();const waiting=manager.token(aborted.signal);aborted.abort(new Error('caller deadline'))
 await assert.rejects(waiting,/caller deadline/);finish(fixture({refreshToken:'refresh-three'}));await new Promise(setImmediate);pass('caller abort settles without cancelling shared renewal')
 now+=3_598_000;const late=manager.token();const staleRevision=manager.revision();manager.clear();finish(fixture());await assert.rejects(late,/thay đổi|hết hạn/)
 assert.throws(()=>manager.install(fixture(),staleRevision));await assert.rejects(manager.token());pass('logout rejects both late refresh and late login')
 const failure=new DesktopSessionManager(async()=>{throw new Error('network down')},()=>now);const valid=fixture({expiresAt:now/1000+30});failure.install(valid,0)
 assert.equal(await failure.token(),valid.accessToken);now+=31_000;await assert.rejects(failure.token(),{name:'TypeError',message:'fetch failed'});failure.clear();pass('network failure may use still-valid JWT, never expired JWT or anon')
 const wrong=new DesktopSessionManager(async()=>fixture({staffId:2}),()=>now);wrong.install(fixture({expiresAt:now/1000+1}),0);await assert.rejects(wrong.token(),/không khớp/);await assert.rejects(wrong.token());pass('refresh cannot switch staff or organization')
 const hostile=fixture();hostile.accessToken='x.'+Buffer.from(JSON.stringify({role:'service_role',sub:'x',session_id:hostile.sessionId,exp:hostile.expiresAt})).toString('base64url')+'.x'
 assert.throws(()=>manager.install(hostile,manager.revision()),/Desktop/);manager.clear();wrong.clear();pass('never accept admin or anon token from issuer')
 console.log(JSON.stringify({checks,status:'passed'}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
