const {app,session,net,BrowserWindow}=require('electron')
const assert=require('node:assert/strict')
const path=require('node:path')
const http=require('node:http')
const https=require('node:https')
const tcp=require('node:net')
const fs=require('node:fs')
const {keyResponse,decryptPassword,createPasswordKeyFixture}=require('./facebook-password-crypto.cjs')
const replacementKey=createPasswordKeyFixture(43)
app.setPath('userData',process.env.FACEBOOK_SMOKE_DIRECTORY)
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
  const {FacebookLoginSession,inspectFacebookSession,readFacebookCookies,writeFacebookCookies,trustedFacebookUrl,loadFacebookHome}=require(process.env.FACEBOOK_SMOKE_BROWSER_BUNDLE)
  const uid='100000000001111',secondUid='100000000002222'
  let authMode='otp',verifyMode='cookie',graphMode='success',afterAuthMode='cookie'
  let authRequests=0,verifyRequests=0,graphRequests=0,keyRequests=0,approvalRequests=0,proxyChallenges=0,expectedWindows=0
  let entered,lateResponse,crossSiteProbe
  const forms=[],requests=[]
  const page=(id,token=true)=>'<html><script type="application/json" data-sjs>'+JSON.stringify({require:[['ScheduledServerJS','handle',null,[{__bbox:{define:[
    ['CurrentUserInitialData',[],{ACCOUNT_ID:id,USER_ID:id},270],
    ['DTSGInitialData',[],token?{token:'fixture-dtsg'}:{},258],
    ['SiteData',[],{pkg_cohort:id==='0'?'HYP:comet_loggedout_pkg':'HYP:comet_pkg'},1]
  ]}}]]]})+'</script></html>'
  const tlsServer=https.createServer({key:fs.readFileSync(path.join(process.env.FACEBOOK_SMOKE_DIRECTORY,'key.pem')),cert:fs.readFileSync(path.join(process.env.FACEBOOK_SMOKE_DIRECTORY,'cert.pem'))},(request,response)=>{
    const target='https://'+request.headers.host+request.url
    if(target==='https://outside.fixture.test/'){
      response.setHeader('Content-Type','text/html');response.end('<html><img src="https://www.facebook.com/cookie-probe"></html>');return
    }
    if(target==='https://www.facebook.com/cookie-probe'){
      crossSiteProbe?.(request.headers.cookie||'');response.writeHead(204);response.end();return
    }
    if(target==='https://graph.facebook.com/pwd_key_fetch'){
      keyRequests++;response.end(JSON.stringify(keyResponse));return
    }
    if(target==='https://graph.facebook.com/check_approved_machine'){
      let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
        const form=new URLSearchParams(body)
        assert.equal(form.get('u'),uid);assert.equal(form.get('m'),'approval-machine')
        assert.equal(form.get('password'),null)
        approvalRequests++;response.end(JSON.stringify({data:[{approved:approvalRequests>=2}]}))
      });return
    }
    if(target==='https://www.facebook.com/'||target==='https://m.facebook.com/'){
      verifyRequests++
      if(expectedWindows===0)assert.equal(request.headers['user-agent'],'node-fetch','verification uses the real HTTP client UA')
      assert.equal(BrowserWindow.getAllWindows().length,expectedWindows,'verification must not create a browser window')
      const cookie=request.headers.cookie||''
      if(verifyMode==='hang'){lateResponse=response;entered();return}
      if(verifyMode==='challenge'){response.writeHead(302,{Location:'https://www.facebook.com/checkpoint/'});response.end();return}
      if(verifyMode==='external'){response.writeHead(302,{Location:'https://outside.fixture.test/'});response.end();return}
      if(verifyMode==='login-redirect'){response.writeHead(302,{Location:'https://www.facebook.com/login/'});response.end();return}
      if(verifyMode==='home-redirect'&&target==='https://www.facebook.com/'){
        response.writeHead(302,{Location:'https://m.facebook.com/'});response.end();return
      }
      response.setHeader('Content-Type','text/html')
      // Stateless verification must ignore response Set-Cookie headers.
      response.setHeader('Set-Cookie','probe_side_effect=1; Domain=.facebook.com; Path=/')
      if(verifyMode==='error'){response.writeHead(503);response.end(page(uid));return}
      if(verifyMode==='unknown'){response.end('<html>Response not understood</html>');return}
      const id=cookie.match(/(?:^|; )c_user=(\d+)/)?.[1]
      const valid=verifyMode!=='login'&&id&&/xs=(?:http-session|saved|user-new)/.test(cookie)
      // Simulate body download time so the independent name response can arrive.
      setTimeout(()=>response.end(page(valid?id:'0',!!valid)),30);return
    }
    if(target==='https://graph.facebook.com/me?fields=id,name'){
      graphRequests++;assert.equal(request.headers.authorization,'Bearer fixture-user-token')
      assert.equal(request.headers.cookie,undefined)
      if(graphMode==='hang'){lateResponse=response;return}
      if(graphMode==='error'){response.writeHead(401);response.end('{"error":{"message":"fixture-user-token"}}');return}
      response.end(JSON.stringify({id:'app-scoped-id',name:'Tên từ Graph API'}));return
    }
    assert.equal(target,'https://b-graph.facebook.com/auth/login')
    let body='';request.on('data',chunk=>body+=chunk)
    request.on('end',()=>{
      authRequests++;const form=new URLSearchParams(body);forms.push(form)
      assert.equal(request.method,'POST')
      assert.equal(request.headers['content-type'],'application/x-www-form-urlencoded')
      assert.equal(request.headers.authorization,'OAuth null')
      assert(request.headers['user-agent'].includes('[FBAN/Orca-Android;FBAV/412.0.0.15.69;'))
      assert.equal(BrowserWindow.getAllWindows().length,expectedWindows,'HTTP login must not create a window')
      assert.equal(form.get('email'),uid);assert(!body.includes('JBSWY3DPEHPK3PXP'))
      if(form.get('credentials_type')==='password') {
        const refreshed=authMode==='key-refresh'&&form.get('machine_id')==='replacement-machine'
        assert((refreshed?replacementKey.decryptPassword:decryptPassword)(form.get('password')))
        if(authMode==='key-refresh'&&!refreshed){
          response.writeHead(400);response.end(JSON.stringify({error:{code:418,error_subcode:2779001,
            error_data:{machine_id:'replacement-machine',pwd_enc_key_pkg:{...replacementKey.keyResponse,seconds_to_live:3600}}}}));return
        }
      }
      if(authMode==='approval'&&form.get('credentials_type')==='password'){
        response.writeHead(400);response.end(JSON.stringify({error:{code:406,error_data:{uid,login_first_factor:'fixture-factor',
          machine_id:'approval-machine',auth_token:'fixture-approval-token'}}}));return
      }
      if(authMode==='approval'){
        assert.equal(form.get('credentials_type'),'transient_token');assert.equal(form.get('password'),'fixture-approval-token')
        assert.equal(form.get('machine_id'),'approval-machine');assert.equal(form.get('twofactor_code'),null)
      }
      if(authMode==='error'){response.writeHead(400);response.end('{"error":{"code":401}}');return}
      if(authMode==='hang'){lateResponse=response;entered();return}
      if(authMode==='redirect'){response.writeHead(307,{Location:'https://outside.fixture.test/'});response.end();return}
      if(['otp','key-refresh'].includes(authMode)&&form.get('credentials_type')==='password'){
        response.writeHead(400);response.end(JSON.stringify({error:{error_subcode:1348162,error_data:{uid,login_first_factor:'fixture-factor',machine_id:'fixture-machine'}}}));return
      }
      if(['otp','key-refresh'].includes(authMode)){assert.equal(form.get('first_factor'),'fixture-factor');assert.equal(form.get('machine_id'),'fixture-machine');assert.match(form.get('twofactor_code'),/^\d{6}$/)}
      verifyMode=afterAuthMode
      response.end(JSON.stringify({uid,access_token:'fixture-user-token',session_cookies:[
        {name:'c_user',value:uid,domain:'.facebook.com',path:'/'},{name:'xs',value:'http-session',domain:'.facebook.com',path:'/'}
      ]}))
    })
  })
  await new Promise(resolve=>tlsServer.listen(0,'127.0.0.1',resolve))
  const sockets=new Set()
  const server=http.createServer((_request,response)=>{response.writeHead(500);response.end()})
  server.on('connect',(request,socket,head)=>{
    if(request.headers['proxy-authorization']!=='Basic '+Buffer.from('fixture-user:fixture-pass').toString('base64')){
      proxyChallenges++;socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\nContent-Length: 0\r\n\r\n');return
    }
    assert(['www.facebook.com:443','m.facebook.com:443','b-graph.facebook.com:443','graph.facebook.com:443','outside.fixture.test:443'].includes(request.url))
    const upstream=tcp.connect(tlsServer.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)})
    for(const stream of [socket,upstream]){sockets.add(stream);stream.on('error',()=>{});stream.on('close',()=>sockets.delete(stream))}
    socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy())
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const proxy={host:'127.0.0.1',port:server.address().port,username:'fixture-user',password:'fixture-pass'}
  const originalRequest=net.request
  const destinations={
    'https://outside.fixture.test/':'http://outside.fixture.test/',
    'https://b-graph.facebook.com/auth/login':'http://facebook-auth.fixture.test/auth/login',
    'https://graph.facebook.com/pwd_key_fetch':'http://facebook-graph.fixture.test/pwd_key_fetch',
    'https://graph.facebook.com/check_approved_machine':'http://facebook-graph.fixture.test/check_approved_machine',
    'https://graph.facebook.com/me?fields=id,name':'http://facebook-graph.fixture.test/me?fields=id,name',
    'https://www.facebook.com/':'http://www.facebook.com/',
    'https://m.facebook.com/':'http://m.facebook.com/'
  }
  net.request=(options,...args)=>{
    assert(destinations[options.url],'unexpected real network request: '+options.url)
    const request=originalRequest(options,...args)
    const record={url:options.url,aborted:false};requests.push(record);request.on('abort',()=>record.aborted=true)
    return request
  }
  const credentials=new WeakMap()
  async function configure(partition){const ses=session.fromPartition(partition);ses.setCertificateVerifyProc((request,callback)=>callback(Object.keys(destinations).some(url=>new URL(url).hostname===request.hostname)?0:-3));await ses.setProxy({mode:'fixed_servers',proxyRules:`http://${proxy.host}:${proxy.port}`});credentials.set(ses,proxy)}
  async function make(signal=AbortSignal.timeout(15000),partition){const s=new FacebookLoginSession(signal,partition);await configure(s.partition);return s}
  const saved=[{name:'c_user',value:uid,domain:'.facebook.com',path:'/',secure:true,httpOnly:true},{name:'xs',value:'saved',domain:'.facebook.com',path:'/',secure:true,httpOnly:true}]
  const input={uid,password:'fixture',twoFactorSecret:'JBSWY3DPEHPK3PXP',cookies:[]}
  const empty=await make();const beforeEmpty=verifyRequests
  assert.equal((await empty.observe(proxy)).state,'logged_out');assert.equal(verifyRequests,beforeEmpty);await empty.dispose()
  const login=await make()
  const result=await login.login(input,proxy,true)
  assert.equal(result.state,'authenticated');assert.equal(result.uid,uid);assert.equal(result.name,'Tên từ Graph API')
  assert.equal(authRequests,2);assert.equal(graphRequests,1);assert(proxyChallenges>0)
  assert.equal(BrowserWindow.getAllWindows().length,0)
  assert.equal((await login.ses.cookies.get({name:'probe_side_effect'})).length,0,'HTTP verification must never write response cookies')
  assert.equal((await login.ses.cookies.get({name:'c_user'}))[0].httpOnly,false)
  assert.equal((await login.ses.cookies.get({name:'xs'}))[0].httpOnly,true)
  assert((await readFacebookCookies(login.ses)).every(c=>c.sameSite==='no_restriction'&&c.secure))
  assert(!JSON.stringify(result).includes('fixture-user-token'))
  assert(!login.ses.storagePath);await login.dispose()
  authMode='key-refresh'
  const refreshedLogin=await make(),beforeRefresh=authRequests
  assert.equal((await refreshedLogin.login(input,proxy)).state,'authenticated')
  assert.equal(authRequests-beforeRefresh,3,'stale key → replacement key → OTP → verified web cookies')
  const refreshForms=forms.slice(-3)
  assert(refreshForms.every(f=>f.get('device_id')===refreshForms[0].get('device_id')))
  assert.equal(refreshForms[1].get('machine_id'),'replacement-machine')
  await refreshedLogin.dispose()
  authMode='password'
  // Inspect the body received by the HTTPS server after Electron/proxy transport,
  // not just the form passed to a mock. No real Facebook credentials are used.
  const transportProbe=await make(),probePassword=' fixture +&=%#é thử 測試 '
  await transportProbe.login({...input,password:probePassword},proxy)
  assert.equal(decryptPassword(forms.at(-1).get('password')),probePassword,'encrypted transport must preserve every password character')
  assert.equal(forms.at(-1).get('email'),uid)
  await transportProbe.dispose()
  authMode='approval'
  const approvalLogin=await make(),messages=[],beforeApproval=authRequests
  const approvedResult=await approvalLogin.login({...input,twoFactorSecret:''},proxy,false,message=>messages.push(message))
  assert.equal(approvedResult.state,'authenticated');assert.equal(approvalRequests,2);assert.equal(authRequests-beforeApproval,2)
  assert(messages.some(message=>message.includes('chờ bạn phê duyệt')))
  assert(!JSON.stringify(messages).includes('fixture-approval-token'));assert(keyRequests>=3)
  await approvalLogin.dispose();authMode='password'
  for(const mode of ['cookie','login','challenge','unknown','external','login-redirect','home-redirect','error']){
    verifyMode=mode;const s=await make();const before=authRequests,beforeGraph=graphRequests
    if(['challenge','unknown','external','error'].includes(mode)) await assert.rejects(s.login({...input,cookies:saved},proxy,true))
    else assert.equal((await s.login({...input,cookies:saved},proxy,true)).state,'authenticated')
    const fallback=['login','login-redirect'].includes(mode)
    assert.equal(authRequests-before,fallback?1:0,'unexpected password fallback: '+mode)
    assert.equal(graphRequests-beforeGraph,fallback?1:0)
    if(mode==='cookie'){
      assert.equal((await s.ses.cookies.get({name:'c_user'}))[0].httpOnly,false,'restore normalizes an old HttpOnly UID cookie')
      assert.equal((await s.ses.cookies.get({name:'xs'}))[0].httpOnly,true)
      assert((await readFacebookCookies(s.ses)).every(c=>c.sameSite==='no_restriction'&&c.secure),'restore also normalizes old cookie policies')
      assert.equal(saved[0].httpOnly,true,'normalization must not mutate the saved input')
    }
    await s.dispose()
  }
  for(const mode of ['error','hang']){
    graphMode=mode;const s=await make();const result=await s.login(input,proxy,true)
    assert.equal(result.state,'authenticated');assert.equal(result.name,undefined)
    if(mode==='hang'){await new Promise(setImmediate);assert(requests.filter(r=>r.url.includes('fields=id,name')).at(-1).aborted);lateResponse.end('{"name":"late"}')}
    await s.dispose()
  }
  graphMode='success';afterAuthMode='challenge'
  const challenged=await make();await assert.rejects(challenged.login(input,proxy),/xác minh thêm/);await challenged.dispose();afterAuthMode='cookie'
  for(const [mode,reason] of [['unknown',/không có JSON bootstrap/],['error',/HTTP 503/],
    ['login',/dữ liệu chưa đăng nhập/],['login-redirect',/chuyển hướng về trang đăng nhập/]]){
    afterAuthMode=mode;const s=await make(),beforeAuth=authRequests,beforeVerify=verifyRequests
    await assert.rejects(s.login(input,proxy),error=>{
      assert.match(error.message,/Chưa xác minh được cookie/);assert.match(error.message,reason)
      assert(!/fixture|http-session|ERR_|https?:|\{/.test(error.message));assert(error.message.length<=250)
      return true
    })
    assert.equal(authRequests-beforeAuth,1);assert.equal(verifyRequests-beforeVerify,1,'diagnostics must not send another verification request')
    assert.equal(BrowserWindow.getAllWindows().length,0);await s.dispose()
  }
  afterAuthMode='cookie'
  for(const mode of ['error','redirect']){
    authMode=mode;const s=await make();await assert.rejects(s.login(input,proxy));assert.equal(BrowserWindow.getAllWindows().length,0);await s.dispose()
  }
  for(const phase of ['auth','verify']){
    authMode=phase==='auth'?'hang':'password';afterAuthMode=phase==='verify'?'hang':'cookie'
    const abort=new AbortController(),s=await make(abort.signal),pending=new Promise(resolve=>entered=resolve)
    const rejected=assert.rejects(s.login(input,proxy));await pending;abort.abort();await rejected
    assert.equal(BrowserWindow.getAllWindows().length,0);lateResponse.end('{}');await s.dispose()
  }
  // Exercise Node's proxy socket cancellation inside the actual Electron runtime,
  // before HTTP CONNECT or the HTTPS proxy TLS handshake has completed.
  for(const protocol of ['http','https']){
    const peers=new Set();let received,closed
    const pending=new Promise(resolve=>received=resolve),disconnected=new Promise(resolve=>closed=resolve)
    const stalled=tcp.createServer(socket=>{
      peers.add(socket);socket.on('error',()=>{});socket.on('close',()=>{peers.delete(socket);closed()})
      socket.once('data',()=>received())
    })
    await new Promise(resolve=>stalled.listen(0,'127.0.0.1',resolve))
    const abort=new AbortController(),s=await make(abort.signal)
    try{
      await s.ses.setProxy({mode:'fixed_servers',proxyRules:`${protocol}://127.0.0.1:${stalled.address().port}`})
      for(const cookie of saved)await s.ses.cookies.set({url:'https://www.facebook.com/',...cookie})
      const rejected=assert.rejects(s.observe())
      await pending;abort.abort();await rejected
      let timer
      try{await Promise.race([disconnected,new Promise(resolve=>timer=setTimeout(resolve,1000))])}
      finally{clearTimeout(timer)}
      assert.equal(peers.size,0,`${protocol} proxy socket must close on cancel before its handshake completes`)
    }finally{abort.abort();await s.dispose();for(const socket of peers)socket.destroy();await new Promise(resolve=>stalled.close(resolve))}
  }
  authMode='password';afterAuthMode='cookie';verifyMode='cookie'
  const switched=await make();await switched.login(input,proxy)
  verifyMode='hang';const waiting=new Promise(resolve=>entered=resolve),check=inspectFacebookSession(switched.ses,switched.signal,proxy)
  await waiting;await switched.ses.cookies.set({url:'https://www.facebook.com/',domain:'.facebook.com',name:'c_user',value:secondUid,httpOnly:true,secure:true})
  lateResponse.end(page(uid));assert.equal((await check).state,'unknown','never accept an old HTTP response after a UID switch')
  await switched.dispose();verifyMode='cookie'
  const permanent=await make(AbortSignal.timeout(10000),'persist:account_319000001')
  assert.equal(path.resolve(permanent.ses.storagePath),path.resolve(app.getPath('sessionData'),'Partitions','account_319000001'));await permanent.dispose()
  assert.equal(trustedFacebookUrl('https://facebook.com.evil.test/'),false)
  const cancelled=new AbortController()
  const navigation=loadFacebookHome({loadURL:()=>new Promise(()=>{}),stop:()=>assert.fail('Never stop user navigation')},cancelled.signal)
  cancelled.abort();await assert.rejects(navigation)

  // A real cross-site subresource sends web auth cookies after normalization.
  // The Lax control proves this checks browser policy, not just stored metadata.
  for(const laxControl of [true,false]){
    const browser=await make(),ses=browser.ses
    await writeFacebookCookies(ses,saved,AbortSignal.timeout(5000))
    if(laxControl)for(const c of await readFacebookCookies(ses))await ses.cookies.set({url:'https://www.facebook.com/',...c,sameSite:'lax'})
    const probe=new Promise(resolve=>crossSiteProbe=resolve)
    const win=new BrowserWindow({show:false,webPreferences:{partition:browser.partition,sandbox:true,nodeIntegration:false,contextIsolation:true}})
    const proxyLogin=(event,wc,_details,authInfo,callback)=>{
      if(wc===win.webContents&&authInfo.isProxy&&authInfo.host===proxy.host&&authInfo.port===proxy.port){event.preventDefault();callback(proxy.username,proxy.password)}
    }
    app.on('login',proxyLogin)
    expectedWindows=1;await win.loadURL('https://outside.fixture.test/')
    const header=await probe
    assert.equal(header.includes('c_user='+uid),!laxControl);assert.equal(header.includes('xs=saved'),!laxControl)
    app.removeListener('login',proxyLogin);win.destroy();expectedWindows=0;crossSiteProbe=undefined;await browser.dispose()
  }

  const {FacebookLoginService}=require(process.env.FACEBOOK_SMOKE_SERVICE_BUNDLE)
  const proxyRuntime={getSessionProxyAuthentication:ses=>credentials.get(ses)||null,applyProxyToPartition:configure}
  for(const [index,scenario] of [{},{changeDuringGet:true},{httpFailure:true},{localValid:true},
    {explicit:true,manual:true,localValid:true,previousUid:secondUid},{explicit:true,localValid:true},
    {explicit:true,manual:true,localValid:true,httpFailure:true},{explicit:true,localValid:true,httpFailure:true},
    {explicit:true,manual:true,localValid:true,databaseFailure:true},
    {explicit:true,manual:true,localValid:true,previousUid:secondUid,duplicateScopes:true},
    {explicit:true,localValid:true,previousUid:secondUid,duplicateScopes:true},
    {explicit:true,localValid:true,duplicateScopes:true,httpFailure:true},
    {explicit:true,localValid:true,duplicateScopes:true,changeDuringCleanup:true},
    {explicit:true,localValid:true,duplicateScopes:true,cleanupFailure:true}].entries()){
    const id=scenario.databaseFailure?319000099:319000002+index,partition=`persist:account_${id}`
    await configure(partition)
    const ses=session.fromPartition(partition)
    await ses.protocol.handle('https',()=>new Response('<html>Visible user tab</html>',{headers:{'content-type':'text/html'}}))
    const visible=new BrowserWindow({show:false,webPreferences:{partition,sandbox:true,nodeIntegration:false,contextIsolation:true}})
    expectedWindows=1;await visible.loadURL('https://www.facebook.com/');if(visible.webContents.isLoadingMainFrame())await new Promise(resolve=>visible.webContents.once('did-stop-loading',resolve))
    // Only the test reads document.cookie to assert compatibility with the existing legacy check.
    const readCookieInTest=visible.webContents.executeJavaScript.bind(visible.webContents)
    visible.webContents.executeJavaScript=()=>{throw Error('Session logic must not read DOM')}
    if(scenario.localValid){for(const c of saved)await ses.cookies.set({url:'https://www.facebook.com/',...c,httpOnly:scenario.databaseFailure&&c.name==='c_user'?false:c.httpOnly,value:c.name==='c_user'?(scenario.previousUid||uid):c.value})}
    const originalCookieSet=ses.cookies.set.bind(ses.cookies)
    if(scenario.duplicateScopes){
      for(const c of saved)for(const scope of [{domain:undefined,path:'/'},{domain:'.facebook.com',path:'/messages'}])
        await originalCookieSet({url:'https://www.facebook.com/',...c,...scope,value:c.name==='c_user'?(scenario.previousUid||uid):c.value})
      await originalCookieSet({url:'https://www.facebook.com/',domain:'.facebook.com',name:'datr',value:'keep-device',secure:true,httpOnly:true,sameSite:'strict'})
      await originalCookieSet({url:'https://outside.fixture.test/',name:'c_user',value:'keep-other-site',secure:true})
      await readCookieInTest('localStorage.setItem("fixture-marker","keep-storage")')
      let injected=false
      ses.cookies.set=async details=>{
        if(!injected&&details.expirationDate===1){
          injected=true
          if(scenario.cleanupFailure)throw Error('Fixture cookie cleanup failure')
          await originalCookieSet(details)
          if(scenario.changeDuringCleanup)await originalCookieSet({url:'https://www.facebook.com/',domain:'.facebook.com',name:'c_user',value:secondUid,httpOnly:true,secure:true})
          return
        }
        return originalCookieSet(details)
      }
    }
    const fixture={user:{staffId:1,organizationId:1},credentials:{username:'fixture'},released:0,revision:scenario.manual?0:1,commits:0,proxy,
      account:{id,staffId:1,proxyId:9,flatformType:'facebook',facebookLoginManaged:!scenario.manual,facebookLoginClaimGeneration:0,isActive:true,status:'tạm dừng',facebookUid:scenario.previousUid||uid,loginStatus:scenario.localValid?'đã đăng nhập':'chưa đăng nhập'},
      async rpc(action,payload){
        if(action==='metadata')return{revision:this.revision}
        if(action==='login'){if(scenario.databaseFailure)throw Error('Fixture DB unavailable');this.commits++;this.account.facebookLoginManaged=true;this.account.facebookUid=payload.secret.uid;assert.equal(payload.secret.cookies.find(c=>c.name==='xs').value,'http-session');return{revision:++this.revision}}
        if(action==='observe'){if(payload.state==='authenticated')this.revision++;this.account.loginStatus=payload.state==='authenticated'?'đã đăng nhập':'chưa đăng nhập';return{revision:this.revision}}
        if(action==='get'){
          if(scenario.changeDuringGet)await ses.cookies.set({url:'https://www.facebook.com/',domain:'.facebook.com',name:'c_user',value:secondUid,httpOnly:true,secure:true})
          return{revision:this.revision,secret:scenario.explicit?{...input,cookies:saved}:input}
        }
        throw Error('Unexpected RPC '+action)
      }
    }
    globalThis.facebookServiceFixture=fixture
    const service=new FacebookLoginService({isDestroyed:()=>false,webContents:{send(){}}},{getWebContentsId:()=>visible.webContents.id,listRegistered:()=>[]},proxyRuntime)
    service.startSession(false);let navigations=0;visible.webContents.on('did-start-navigation',()=>navigations++)
    const beforeAuth=authRequests,beforeGraph=graphRequests
    authMode=scenario.httpFailure?'error':scenario.explicit?'otp':'password'
    const loginWork=()=>scenario.explicit?service.login(id,{uid,revision:scenario.manual?0:1,...(scenario.manual?{password:input.password,twoFactorSecret:input.twoFactorSecret}:{})}):service.restore(id)
    if(scenario.databaseFailure)assert((await readCookieInTest('document.cookie')).includes('c_user='))
    if(scenario.changeDuringGet||scenario.httpFailure||scenario.databaseFailure||scenario.changeDuringCleanup||scenario.cleanupFailure)await assert.rejects(loginWork(),scenario.databaseFailure?/Đã đăng nhập Facebook, nhưng chưa xác nhận lưu/:undefined)
    else{await loginWork();assert.equal(navigations,scenario.explicit||!scenario.localValid?1:0);if(visible.webContents.isLoadingMainFrame())await new Promise(resolve=>visible.webContents.once('did-stop-loading',resolve));assert.equal((await service.checkAccount(id,visible.webContents)).loggedIn,true)}
    assert.equal(fixture.released,1);assert.equal(graphRequests,beforeGraph,'restore never looks up names')
    if(scenario.explicit){
      assert.equal(authRequests-beforeAuth,scenario.httpFailure?1:2,'explicit login uses password/TOTP despite valid local/cloud cookies')
      assert.equal(fixture.commits,scenario.httpFailure||scenario.databaseFailure||scenario.changeDuringCleanup||scenario.cleanupFailure?0:1)
      if(!scenario.changeDuringCleanup&&!scenario.cleanupFailure){
        assert.equal((await ses.cookies.get({name:'xs'}))[0].value,scenario.httpFailure?'saved':'http-session')
        assert.equal((await ses.cookies.get({url:'https://www.facebook.com/',name:'c_user'}))[0].value,uid)
      }
      if(scenario.httpFailure||scenario.databaseFailure)assert.equal(fixture.account.facebookLoginManaged,!scenario.manual)
      assert(!service.isLoggingIn(id))
    }
    if(scenario.databaseFailure){
      assert((await readCookieInTest('document.cookie')).includes('c_user='+uid),'failed enrollment keeps legacy login detection usable')
      assert.equal((await ses.cookies.get({name:'c_user'}))[0].httpOnly,false)
      assert.equal((await ses.cookies.get({name:'xs'}))[0].httpOnly,true)
      assert.equal((await inspectFacebookSession(ses,AbortSignal.timeout(5000),proxy)).state,'authenticated')
    }
    if(!scenario.changeDuringGet&&!scenario.httpFailure&&!scenario.changeDuringCleanup&&!scenario.cleanupFailure&&(scenario.explicit||!scenario.localValid)){
      assert((await readCookieInTest('document.cookie')).includes('c_user='+uid),'managed/manual logins and restores expose the public web identity')
      assert(!(await readCookieInTest('document.cookie')).includes('xs='),'session secret never becomes script-readable')
    }
    if(scenario.changeDuringGet){assert.equal(authRequests,beforeAuth);assert.equal((await ses.cookies.get({name:'c_user'}))[0].value,secondUid)}
    if(scenario.duplicateScopes){
      ses.cookies.set=originalCookieSet
      const facebook=await readFacebookCookies(ses)
      if(!scenario.httpFailure&&!scenario.changeDuringCleanup&&!scenario.cleanupFailure){
        assert.equal(facebook.filter(c=>c.name==='c_user').length,1);assert.equal(facebook.filter(c=>c.name==='xs').length,1)
        assert((await ses.cookies.get({url:'https://www.facebook.com/messages/'})).filter(c=>c.name==='c_user').every(c=>c.value===uid))
      }
      if(scenario.httpFailure||scenario.cleanupFailure)assert.equal(facebook.filter(c=>c.name==='c_user').length,3,'failed authentication or first cleanup must not replace the original session')
      if(scenario.changeDuringCleanup)assert.equal((await ses.cookies.get({url:'https://www.facebook.com/',name:'c_user'})).find(c=>c.domain==='.facebook.com').value,secondUid,'user session wins during cleanup')
      assert.equal(facebook.find(c=>c.name==='datr').value,'keep-device');assert.equal(facebook.find(c=>c.name==='datr').sameSite,'strict')
      assert.equal((await ses.cookies.get({url:'https://outside.fixture.test/',name:'c_user'}))[0].value,'keep-other-site')
      assert.equal(await readCookieInTest('localStorage.getItem("fixture-marker")'),'keep-storage')
    }
    assert.equal(BrowserWindow.getAllWindows().length,1,'only the pre-existing user tab may exist')
    await service.stop();visible.destroy();expectedWindows=0
  }
  // Real Electron ordering: initial about:blank registration/load versus startup restore.
  const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
  for(const browserFirst of [true,false]){
    const id=browserFirst?319000080:319000081,partition='persist:account_'+id
    const pending=deferred(),pageRequested=deferred(),pageResponse=deferred(),claimed=deferred(),claimGate=deferred()
    const ses=session.fromPartition(partition)
    await configure(partition)
    let firstLoad=true,visible=null
    await ses.protocol.handle('https',async()=>{
      if(browserFirst&&firstLoad){firstLoad=false;pageRequested.resolve();await pageResponse.promise}
      return new Response('<html>Initial user tab</html>',{headers:{'content-type':'text/html'}})
    })
    const account={id,staffId:1,proxyId:9,flatformType:'facebook',facebookLoginManaged:true,facebookLoginClaimGeneration:0,isActive:true,status:'tạm dừng',loginStatus:'chưa đăng nhập'}
    const fixture={user:{staffId:1,organizationId:1},credentials:{},proxy,account,startupAccounts:[account],released:0,claims:0,revision:1,
      async onClaim(){this.claims++;claimed.resolve();if(!browserFirst)await claimGate.promise},
      async rpc(action,payload){
        if(action==='pending'){await pending.promise;return[]}
        if(action==='metadata')return{revision:this.revision}
        if(action==='get')return{revision:this.revision,secret:input}
        if(action==='observe'){if(payload.state==='authenticated')this.revision++;return{revision:this.revision}}
        throw Error('Unexpected startup RPC '+action)
      }}
    globalThis.facebookServiceFixture=fixture
    const service=new FacebookLoginService({isDestroyed:()=>false,webContents:{send(){}}},
      {getWebContentsId:()=>visible?.webContents.id||null,listRegistered:()=>[]},proxyRuntime)
    const open=()=>{
      visible=new BrowserWindow({show:false,webPreferences:{partition,sandbox:true,nodeIntegration:false,contextIsolation:true}})
      expectedWindows=1
      visible.webContents.executeJavaScript=()=>{throw Error('Startup must not read DOM')}
      service.startupBrowserRegistered(id,visible.webContents)
      return visible.loadURL('https://www.facebook.com/')
    }
    authMode='password';afterAuthMode='cookie';verifyMode='cookie'
    const beforeAuth=authRequests
    service.startSession();const work=service.startupWork
    if(browserFirst){
      await service.prepareStartupBrowser(id)
      const loaded=open();await pageRequested.promise;pending.resolve()
      await new Promise(resolve=>setTimeout(resolve,30))
      assert.equal(fixture.claims,0,'initial navigation must finish before account claim')
      assert.equal(authRequests,beforeAuth)
      pageResponse.resolve();await loaded;await work
    }else{
      pending.resolve();await claimed.promise
      let prepared=false
      const preparing=service.prepareStartupBrowser(id).then(()=>{prepared=true})
      await new Promise(resolve=>setTimeout(resolve,20));assert.equal(prepared,false)
      claimGate.resolve();await work;await preparing;await open()
    }
    assert.equal(fixture.claims,1);assert.equal(fixture.released,1)
    assert.equal(authRequests-beforeAuth,1,'exactly one password login')
    assert.equal((await ses.cookies.get({name:'c_user'}))[0].value,uid)
    assert.equal((await inspectFacebookSession(ses,AbortSignal.timeout(5000),proxy)).state,'authenticated')
    assert.equal(service.startupBrowsers.size,0)
    await service.stop();visible.destroy();expectedWindows=0
  }
  console.log('PASS Electron startup: renderer-first about:blank/load and restore-first preparation both restore exactly once without DOM')
  authMode='password'
  for(const success of [true,false]){
    afterAuthMode=success?'cookie':'challenge';const calls=[]
    const fixture={user:{staffId:1,organizationId:1},credentials:{},proxy,async rpc(action,payload){
      calls.push({action,payload})
      if(action==='preview')return{limit:10,duplicates:[]}
      if(action==='reserve')return{accountId:319000010,state:'initializing'}
      if(action==='finish'){this.account={id:319000010,staffId:1,proxyId:9,flatformType:'facebook',facebookLoginManaged:true,isActive:true,status:'tạm dừng',facebookUid:uid,loginStatus:'đã đăng nhập'};return{accountId:319000010,state:'ready'}}
      if(action==='metadata'||action==='observe'||action==='save')return{revision:1}
      throw Error('Unexpected import RPC '+action)
    }}
    globalThis.facebookServiceFixture=fixture
    const service=new FacebookLoginService({isDestroyed:()=>false,webContents:{send(){}}},{getWebContentsId:()=>null,listRegistered:()=>[]},proxyRuntime)
    service.startSession(false)
    const preview=await service.preview({text:uid+'|fixture|JBSWY3DPEHPK3PXP',proxyId:9})
    await service.start(preview.id);await service.batchWork
    assert.equal(service.state().rows[0].status,success?'success':'failed')
    assert.equal(calls.some(c=>c.action==='reserve'),success)
    assert.equal(calls.some(c=>c.action==='finish'),success)
    assert.equal(BrowserWindow.getAllWindows().length,0,'import and profile promotion must remain browserless')
    if(success){assert.equal((await service.checkAccount(319000010)).loggedIn,true);await service.save(319000010,{uid,revision:1,password:'edited'});assert(calls.some(c=>c.action==='save'));assert.equal(BrowserWindow.getAllWindows().length,0)}
    await service.stop()
  }
  net.request=originalRequest;for(const socket of sockets)socket.destroy();tlsServer.closeAllConnections();server.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>tlsServer.close(resolve))])
  console.log('PASS Electron HTTP-only Facebook login/verification/import/restore: real proxy + cookies, no hidden window or DOM, no Set-Cookie side effects, redirects, unknown/checkpoint/logout, stalled HTTP/HTTPS proxy cancellation, UID switch, optional Graph name, visible refresh and claim release')
  app.quit()
}).catch(error=>{console.error(error);app.exit(1)})
