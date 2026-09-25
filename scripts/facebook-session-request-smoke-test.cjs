const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/main/services/facebookSessionRequest.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const uid='100000000001111'
const envelope=define=>'<html><script type="application/json" data-sjs>'+JSON.stringify({require:[['ScheduledServerJS','handle',null,[{__bbox:{define}}]]]})+'</script></html>'
const modules=(id=uid,token='fixture-dtsg')=>[
  ['CurrentUserInitialData',[],{ACCOUNT_ID:id,USER_ID:id},270],
  ['DTSGInitialData',[],token?{token}:{},258],
  ['SiteData',[],{pkg_cohort:id==='0'?'HYP:comet_loggedout_pkg':'HYP:comet_pkg'},1]
]
const load=(fetch=()=>{},timers,realAgents=false)=>{
 const globals={URL,Buffer,AbortSignal,AbortController,setTimeout:timers?((cb,ms)=>{const id={};timers.set(id,{cb,ms});return id}):setTimeout,clearTimeout:timers?(id=>timers.delete(id)):clearTimeout}
 const deadline={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/main/services/requestDeadline.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...globals,exports:deadline})
 class Agent {constructor(address){this.address=typeof address==='string'?address:address.href}destroy(){this.destroyed=true}}
 const exports={};vm.runInNewContext(source,{...globals,exports,require:name=>name==='node-fetch'?{default:fetch}:name==='https-proxy-agent'?(realAgents?require(name):{HttpsProxyAgent:Agent}):name==='socks-proxy-agent'?(realAgents?require(name):{SocksProxyAgent:Agent}):name==='./requestDeadline'?deadline:{}});return exports
}
const parser=load().parseFacebookSessionResponse
assert.equal(parser(envelope(modules()),uid).state,'authenticated')
assert.equal(parser(envelope(modules('0',null)),uid).state,'logged_out','HTTP 200 at homepage can represent an expired cookie')
const asPage=modules();asPage[0][2].USER_ID='100000000002222';assert.equal(parser(envelope(asPage),uid).uid,uid,'Page actor must not replace account identity')
for(const body of [
  '<html><main role="feed">UID '+uid+'</main></html>',
  JSON.stringify({id:uid,access_token:'Graph token'}),
  envelope(modules('100000000002222')),envelope(modules(uid,null)),
  envelope(modules().concat([['CurrentUserInitialData',[],{ACCOUNT_ID:'0',USER_ID:'0'},270]])),
  envelope([['CurrentUserInitialData',[],{ACCOUNT_ID:uid,USER_ID:uid},270]]),
  envelope([['CurrentUserInitialData',[],{ACCOUNT_ID:'0',USER_ID:'0'},270]]),
  '<script type="application/json" data-sjs>{bad-json}</script>',
  '<script>throw Error("must never execute")</script>',
  '<script type="application/json" data-sjs>'+JSON.stringify({post:envelope(modules())})+'</script>'
])assert.equal(parser(body,uid).state,'unknown')
assert.match(parser('<html>private response</html>',uid).message,/không có JSON bootstrap/)
assert.match(parser(envelope([['SiteData',[],{},1]]),uid).message,/thiếu dữ liệu CurrentUserInitialData/)
assert.match(parser(envelope(modules(uid,null)),uid).message,/thiếu token DTSG/)
assert.match(parser(envelope(modules('100000000002222')),uid).message,/ACCOUNT_ID.*không khớp/)
assert.match(parser('<script type="application/json" data-sjs>{private-response}</script>',uid).message,/Không đọc được JSON/)
function fixture(replies,cookies=[{name:'c_user',value:uid},{name:'xs',value:'fixture'}],proxyRoute='DIRECT'){
  const timers=new Map(),calls=[]
  const ses={getUserAgent:()=> 'Fixture browser UA',resolveProxy:async()=>proxyRoute,cookies:{get:async()=>cookies}}
  const fetch=(url,options)=>new Promise((resolve,reject)=>{
    const call={url,options,aborted:false,resolve,reject};calls.push(call)
    const abort=()=>{call.aborted=true;reject(Error('aborted'))}
    options.signal.addEventListener('abort',abort,{once:true})
    const reply=replies[calls.length-1];assert(reply,'unexpected extra verification')
    queueMicrotask(()=>{
      if(typeof reply==='function'){reply(call);return}
      options.signal.removeEventListener('abort',abort)
      resolve({status:reply.redirect?302:reply.status||200,headers:{get:()=>reply.redirect||null},body:{destroy(){}},text:async()=>{if(Buffer.byteLength(reply.body||'')>options.size)throw Object.assign(Error('private-response'),{type:'max-size'});return reply.body||''}})
    })
  })
  const mod=load(fetch,timers)
  return{calls,timers,run:(signal=new AbortController().signal,proxy)=>mod.verifyFacebookSessionRequest(ses,signal,proxy)}
}
async function stalledProxyChecks(){
  const net=require('node:net'),{default:realFetch}=await import('node-fetch')
  for(const route of ['PROXY','HTTPS'])for(const reason of ['timeout','cancel']){
    const sockets=new Set(),timers=new Map()
    let received,closed
    const server=net.createServer(socket=>{
      sockets.add(socket);socket.on('error',()=>{})
      socket.on('close',()=>{sockets.delete(socket);closed?.()})
      socket.once('data',data=>{if(route==='PROXY')assert(data.toString().startsWith('CONNECT www.facebook.com:443 '));received()})
      // HTTP: never answer CONNECT. HTTPS: never answer the TLS handshake.
    })
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    try{
      const ses={getUserAgent:()=> 'Fixture UA',resolveProxy:async()=>`${route} 127.0.0.1:${server.address().port}`,
        cookies:{get:async()=>[{name:'c_user',value:uid},{name:'xs',value:'fixture'}]}}
      const mod=load(realFetch,timers,true)
      for(let i=0;i<3;i++){
        const accepted=new Promise(resolve=>received=resolve),disconnected=new Promise(resolve=>closed=resolve)
        const abort=new AbortController(),work=mod.verifyFacebookSessionRequest(ses,abort.signal)
        // Consume cancellation immediately so a regression cannot cause an unhandled rejection.
        const result=work.then(value=>({value}),error=>({error}))
        await accepted
        if(reason==='cancel')abort.abort()
        else{const timer=[...timers.values()][0];assert.equal(timer.ms,30000);timer.cb()}
        const outcome=await result
        if(reason==='cancel')assert(outcome.error)
        else assert.equal(outcome.value.state,'unknown')
        let closeTimer
        try{await Promise.race([disconnected,new Promise(resolve=>closeTimer=setTimeout(resolve,500))])}
        finally{clearTimeout(closeTimer)}
        assert.equal(sockets.size,0,`${route} ${reason}: pending proxy socket must close, including repeated attempts`)
        assert.equal(timers.size,0)
      }
    }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}
  }
}
async function run(){
  const valid=fixture([{body:envelope(modules())}]);assert.equal((await valid.run()).uid,uid)
  const options=valid.calls[0].options
  assert.equal(options.redirect,'manual');assert.equal(options.headers['Cache-Control'],'no-cache');assert.equal(options.size,8*1024*1024)
  assert.equal(options.headers.Cookie,'c_user='+uid+'; xs=fixture');assert.equal(valid.timers.size,0)
  assert.equal(options.headers['User-Agent'],undefined,'stateless verification must use its HTTP client UA, not the browser UA')
  const absent=fixture([],[]);assert.equal((await absent.run()).state,'logged_out');assert.equal(absent.calls.length,0)
  for(const [url,state] of [['https://www.facebook.com/login/','logged_out'],['https://www.facebook.com/checkpoint/','challenge'],['https://www.facebook.com/two_factor/','challenge'],['https://facebook.com.evil.test/','unknown'],['http://www.facebook.com/','unknown']]){
    const f=fixture([{redirect:url}]);assert.equal((await f.run()).state,state);assert.equal(f.calls.length,1)
  }
  const redirected=fixture([{redirect:'https://m.facebook.com/'},{body:envelope(modules())}]);assert.equal((await redirected.run()).state,'authenticated');assert.equal(redirected.calls.length,2)
  const loop=fixture(Array.from({length:5},()=>({redirect:'https://www.facebook.com/'})));assert.equal((await loop.run()).state,'unknown');assert.equal(loop.calls.length,5)
  for(const [reply,reason] of [
    [{status:503,body:envelope(modules())},/HTTP 503/],
    [{status:429,body:envelope(modules())},/HTTP 429/],
    [{body:'x'.repeat(8*1024*1024+1)},/8 MiB/],
    [({reject})=>reject(Error('private cookie data')),/Lỗi kết nối/],
    [({reject})=>reject(Object.assign(Error('private cookie data'),{code:'ECONNRESET'})),/ECONNRESET/],
    [({reject})=>reject(Object.assign(Error('private cookie data'),{code:'ERR_REQUIRE_ESM'})),/thư viện HTTP/],
    [({reject})=>reject(Object.assign(Error('private cookie data'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'})),/Chứng chỉ TLS/],
    [({reject})=>reject(Object.assign(Error('private cookie data'),{code:'private-code',type:'private-type'})),/Lỗi kết nối/]
  ]){
    const f=fixture([reply]),outcome=await f.run();assert.equal(outcome.state,'unknown');assert.match(outcome.message,reason)
    assert(!JSON.stringify(outcome).includes('private'));assert(!JSON.stringify(outcome).includes('ERR_'))
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0)
  }
  const timeout=fixture([()=>{}]),pending=timeout.run();await new Promise(setImmediate)
  const timer=[...timeout.timers.values()][0];assert.equal(timer.ms,30000);timer.cb()
  const timedOut=await pending;assert.equal(timedOut.state,'unknown');assert.match(timedOut.message,/30 giây/)
  assert(timeout.calls[0].aborted);assert.equal(timeout.timers.size,0)
  const cancelled=fixture([()=>{}]),abort=new AbortController(),work=cancelled.run(abort.signal),rejected=assert.rejects(work)
  await new Promise(setImmediate);abort.abort();await rejected;assert(cancelled.calls[0].aborted)
  cancelled.calls[0].resolve({status:200,headers:{get:()=>null},text:async()=>envelope(modules())});await new Promise(setImmediate);assert.equal(cancelled.calls.length,1)
  const pre=fixture([]);await assert.rejects(pre.run(AbortSignal.abort()));assert.equal(pre.calls.length,0)
  for(const route of ['PROXY proxy.test:8080','HTTPS proxy.test:8080','SOCKS5 proxy.test:8080']){
    const proxied=fixture([{body:envelope(modules())}],undefined,route)
    assert.equal((await proxied.run(new AbortController().signal,{host:'proxy.test',port:8080,username:'user',password:'pass'})).state,'authenticated')
    const agent=proxied.calls[0].options.agent;assert(agent.address.includes('user:pass@proxy.test:8080'));assert(agent.destroyed)
  }
  const isolated=fixture([{body:envelope(modules())}],undefined,'PROXY another.test:8080')
  await isolated.run(new AbortController().signal,{host:'proxy.test',port:8080,username:'user',password:'pass'})
  assert(!isolated.calls[0].options.agent.address.includes('user'))
  for(const [route,host,port] of [['PROXY proxy.test:80','PROXY.TEST',80],['HTTPS proxy.test:443','proxy.test',443],['SOCKS5 [::1]:1080','::1',1080]]){
    const f=fixture([{body:envelope(modules())}],undefined,route)
    await f.run(new AbortController().signal,{host,port,username:'user',password:'pass'})
    assert(f.calls[0].options.agent.address.includes('user:pass@'),'default proxy ports and IPv6 must keep scoped authentication')
  }
  await stalledProxyChecks()
  console.log('PASS Facebook HTTP session verification: server JSON, account/Page identity, definite logout/checkpoint, unknown errors, redirects, response limit, timeout/cancel, scoped proxy auth, repeated stalled HTTP CONNECT/HTTPS handshake cleanup')
}
run().catch(error=>{console.error(error);process.exitCode=1})
