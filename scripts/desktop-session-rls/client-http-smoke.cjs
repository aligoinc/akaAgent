// Real Supabase SDK + custom fetch against an isolated local HTTP server.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http'),assert=require('node:assert/strict'),ts=require('typescript')
const root=path.resolve(__dirname,'../..')
function load(file,mocks={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>mocks[n]||require(n),Buffer,fetch,Request,Response,Headers,URL,AbortSignal,AbortController,setTimeout,clearTimeout,Date,Error,Promise,Number,JSON,console,...globals},{filename:file});return exports}
async function main(){
 let calls=[],mode='ok',ended
 const loginRows=[{id:1,key:'app.notification',value:'Public login notice',updated_at:'2026-10-27T00:00:00Z'},
  {id:2,key:'akabiz.links.website',value:'https://example.test/',updated_at:'2026-10-27T00:00:00Z'}]
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);calls.push({path:req.url,authorization:req.headers.authorization,apikey:req.headers.apikey,body:Buffer.concat(chunks).toString()});if(mode==='hang'){req.socket.once('close',()=>ended?.());return}res.writeHead(mode==='failure'?503:200,{'Content-Type':'application/json'});res.end(mode==='failure'?'{"message":"fixture outage"}':req.url==='/rest/v1/rpc/aka_agent_desktop_login_content'?JSON.stringify(loginRows):'[{"id":1}]')})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 const session=load('src/main/data/desktopSession.ts')
 let authCalls=0
 const transport={endpoint:async()=>{authCalls++;throw Error('unexpected auth call')},refresh:async()=>{authCalls++;throw Error('unexpected refresh')},revoke:async()=>{}}
 const clientModule=load('src/main/data/supabaseClient.ts',{'./desktopSession':session,'./desktopSessionTransport':{createDesktopSessionTransport:()=>transport},dotenv:{config(){}},ws:class{}},{process:{env:{SUPABASE_URL:base,SUPABASE_PUBLISHABLE_KEY:'public-project-id',SUPABASE_ANON_KEY:'legacy-key-must-be-ignored'},cwd:()=>root}})
 const client=clientModule.getSupabaseClient(),manager=clientModule.desktopSession
 const loginRepo=load('src/main/data/repositories/loginScreenRepository.ts',{
  '../supabaseClient':clientModule,'../../../shared/appNotification':load('src/shared/appNotification.ts')})
 try{
  let result=await client.from('auto_accounts').select('id');assert(result.error);assert.equal(calls.length,0)
  await client.rpc('aka_agent_staff_security_status');assert.equal(calls.length,1);assert.equal(calls[0].authorization,undefined);assert.equal(calls[0].apikey,'public-project-id')
  const publicContent=await loginRepo.getLoginScreenContent()
  assert.equal(publicContent.notification.message,'Public login notice');assert.equal(publicContent.links.website,'https://example.test/')
  assert.equal(calls.at(-1).path,'/rest/v1/rpc/aka_agent_desktop_login_content');assert.equal(calls.at(-1).body,'{}')
  assert.equal(calls.at(-1).authorization,undefined);assert.equal(calls.at(-1).apikey,'public-project-id');assert.equal(authCalls,0)
  const beforeSettings=calls.length
  result=await client.from('auto_system_settings').select('value');assert(result.error);assert.equal(calls.length,beforeSettings)
  const exp=Math.floor(Date.now()/1000)+3600,sid='22222222-2222-4222-8222-222222222222'
  const token='fixture.'+Buffer.from(JSON.stringify({role:'aka_agent_desktop',sub:'11111111-1111-4111-8111-111111111111',session_id:sid,exp})).toString('base64url')+'.fixture'
  manager.install({accessToken:token,refreshToken:'fixture-refresh',expiresAt:exp,staffId:1,organizationId:10,sessionId:sid},manager.revision())
  result=await client.from('auto_accounts').select('id').eq('staff_id',1);assert.equal(result.error,null);assert.deepEqual(result.data,[{id:1}]);assert.equal(calls.at(-1).authorization,'Bearer '+token);assert.equal(authCalls,0)
  mode='failure';const before=calls.length
  result=await client.from('auto_accounts').update({name:'fixture'}).eq('id',1);assert(result.error);assert.equal(calls.length-before,1);assert.equal(authCalls,0)
  mode='hang';const abort=new AbortController();const closed=new Promise(r=>ended=r)
  const pending=client.from('auto_accounts').select('id').abortSignal(abort.signal)
  const settled=Promise.resolve(pending);while(calls.length<before+2)await new Promise(r=>setTimeout(r,10))
  abort.abort(new Error('fixture caller timeout'));result=await settled;assert(result.error);await Promise.race([closed,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('HTTP request did not abort')),1000);t.unref()})])
  assert.equal(authCalls,0);manager.clear();const last=calls.length
  result=await client.from('auto_accounts').select('id');assert(result.error);assert.equal(calls.length,last)
  mode='ok';assert.equal((await loginRepo.getLoginScreenContent()).notification.message,'Public login notice')
  assert.equal(calls.length,last+1);assert.equal(calls.at(-1).authorization,undefined);assert.equal(authCalls,0)
  console.log('PASS real SDK HTTP: bootstrap only, public login content before login/after logout with no table access, login token header, no auth roundtrip, no failed-write replay, caller abort, no anon fallback after logout (8 checks)')
 }finally{manager.clear();server.closeAllConnections();await new Promise(r=>server.close(r))}
}
main().catch(e=>{console.error(e);process.exitCode=1})
