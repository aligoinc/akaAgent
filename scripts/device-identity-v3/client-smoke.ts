import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { CompositeHardwareDeviceIdentity, type CompositeHardware } from '../../src/main/services/hardwareDeviceIdentity'
import { parseMacComposite, parseWindowsComposite, WINDOWS_COMPOSITE_SCRIPT } from '../../src/main/services/deviceHardwareReaders'
import { DeviceBindingMigration } from '../../src/main/services/deviceBindingMigration'
import { LocalLoginStore } from '../../src/main/services/localLoginStore'
import { IPC_EVENTS } from '../../src/shared/types'
import { reviewRegressions } from './review-regressions'
let checks=0
const pass=(s:string)=>{checks++;console.log('PASS',s)}
const credentials={username:'alice',password:'fixture-password'}, options={rememberLogin:true,autoLogin:true,startupEnabled:false}
const hash=(n:number)=>n.toString(16).padStart(64,'0')
const uuid='12345678-1234-1234-1234-123456789012'
const hardware=():CompositeHardware=>({uuid,serials:['board-111'],machineGuid:'22345678-1234-1234-1234-123456789012',adapters:[{key:'pci:builtin',kind:'ethernet',permanentAddress:'00:11:22:33:44:55'}]})
async function load(file:string, mocks:Record<string,unknown>):Promise<any>{
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports={};runInNewContext(code,{exports,console,Buffer,AbortSignal,require:(name:string)=>{if(name in mocks)return mocks[name];if(name.startsWith('node:'))return require(name);throw Error('Unexpected dependency '+name)}});return exports
}
async function identity(root:string){
 let current=hardware(),fail=false
 const file=join(root,'identity.json'),make=()=>new CompositeHardwareDeviceIdentity({platform:'win',file,readHardware:async()=>{if(fail)throw Error('WMI failed');return current}})
 const base=await make().fingerprint();assert.equal(await make().fingerprint(),base);pass('v3 stable over restarts')
 for(const field of ['uuid','serials','machineGuid','adapters'] as const){current=hardware();if(field==='uuid')current.uuid='32345678-1234-1234-1234-123456789012';if(field==='serials')current.serials=['board-222'];if(field==='machineGuid')current.machineGuid='42345678-1234-1234-1234-123456789012';if(field==='adapters')current.adapters[0].permanentAddress='00:11:22:33:44:66';assert.notEqual(await make().fingerprint(),base);checks++}
 current=hardware();current.adapters.unshift({key:'aaa:usb-or-other',kind:'ethernet',permanentAddress:'00:11:22:33:44:77'});assert.equal(await make().fingerprint(),base);pass('fixed adapter does not change with order or later devices')
 current=hardware();current.adapters=[];await assert.rejects(make().fingerprint());fail=true;await assert.rejects(make().fingerprint());fail=false;current=hardware();assert.equal(await make().fingerprint(),base);pass('missing selected hardware and WMI errors cannot silently replace formula')
 const badFile=join(root,'bad-uuid.json');current=hardware();current.uuid='03000200-0400-0500-0006-000700080009';await new CompositeHardwareDeviceIdentity({platform:'win',file:badFile,readHardware:async()=>current}).fingerprint();assert(!(JSON.parse(await readFile(badFile,'utf8')).components).includes('uuid'));pass('known shared UUID omitted from v3 only')
 const sparse=join(root,'sparse.json');current={uuid:null,serials:'board-valid',adapters:[]};const sparseIdentity=()=>new CompositeHardwareDeviceIdentity({platform:'win',file:sparse,readHardware:async()=>current});const sparseHash=await sparseIdentity().fingerprint();current.uuid=uuid;assert.equal(await sparseIdentity().fingerprint(),sparseHash);pass('newly available components are not appended')
 await assert.rejects(new CompositeHardwareDeviceIdentity({platform:'win',file:join(root,'empty.json'),readHardware:async()=>({uuid:null,serials:'To be filled by O.E.M.',adapters:[]})}).fingerprint());pass('no empty or random fallback identity')
 await assert.rejects(new CompositeHardwareDeviceIdentity({platform:'win',file:join(root,'disk.json'),readHardware:async()=>hardware(),write:async()=>{throw Error('disk full')}}).fingerprint());pass('source manifest must be durably written before use')
 await writeFile(join(root,'corrupt.json'),'{');await assert.rejects(new CompositeHardwareDeviceIdentity({platform:'win',file:join(root,'corrupt.json'),readHardware:async()=>hardware()}).fingerprint());pass('corrupt manifest fails closed')
 assert.equal(parseWindowsComposite(JSON.stringify(hardware())).adapters.length,1);assert.throws(()=>parseWindowsComposite('{"uuid":null}'));assert(!/Status|MediaConnectState/.test(WINDOWS_COMPOSITE_SCRIPT));pass('Windows response validation; no connected/active adapter selection')
 const data=Buffer.from('001122334455','hex').toString('base64')
 const plist=`<plist><array><dict><key>IOPlatformUUID</key><string>${uuid}</string><key>IOPlatformSerialNumber</key><string>mac-serial</string><key>IORegistryEntryChildren</key><array><dict><key>IOObjectClass</key><string>IOUserNetworkWLAN</string><key>IOMACAddress</key><data>${data}</data><key>IORegistryEntryChildren</key><array><dict><key>IOBuiltin</key><true/></dict></array></dict></array></dict></array></plist>`
 assert.equal(parseMacComposite(plist).adapters.length,1);for(const type of ['AppleThunderboltIPPort','AppleUSBDeviceNCMData','VirtualNetwork'])assert.equal(parseMacComposite(plist.replace('IOUserNetworkWLAN',type)).adapters.length,0);pass('Mac parser selects builtin physical interface; ignores USB/Thunderbolt/virtual')
}
async function local(root:string){
 const file=join(root,'login.json');let store=new LocalLoginStore({file});await store.initialize();await store.updateOptions(options);await store.saveAuthenticated(credentials)
 const s=await store.requireManualDeviceLogin();assert.equal(s.warningMessage,null);assert.equal(s.rememberedLogin,null);assert.deepEqual(s.loginOptions,options)
 await store.updateOptions({startupEnabled:true},credentials);store=new LocalLoginStore({file});await store.initialize();assert.equal(store.snapshot().manualLoginRequired,true);assert.equal(store.getCredentials(),null);assert.equal(store.snapshot().warningMessage,null);pass('collision is silent, durable, preserves checkboxes and cannot be undone by options save')
 await store.saveAuthenticated(credentials,false);assert.equal(store.getCredentials(),null);await store.saveAuthenticated(credentials,true);assert.deepEqual(store.getCredentials(),credentials);assert.equal(store.snapshot().manualLoginRequired,false);pass('manual login persists only after clean v3 confirmation')
 const migration=new DeviceBindingMigration(join(root,'journal'));const input={staffId:1,fingerprintHash:hash(3),legacyHash:hash(2),source:'automatic' as const,expected:{hash:hash(2),version:2 as const,revision:'0'}}
 const first=await migration.request(input,1,true);assert.deepEqual(await new DeviceBindingMigration(join(root,'journal')).request(input,1,true),first);assert(!(await readFile(join(root,'journal/1.json'),'utf8')).includes('password'));pass('unknown commit replay uses the same password-free journal')
 await migration.confirmed(1);assert.notEqual((await migration.request(input,1,true)).requestId,first.requestId);pass('confirmed request is cleared')
}
async function handlers(root:string){
 for(const scenario of ['fresh','clean','collision','remember-off-auto','manual-collision','policy-auto','recover-collision','late-username','no-autologin-collision','late-options'] as const){
  const store=new LocalLoginStore({file:join(root,`handler-${scenario}.json`)});await store.initialize()
  if(scenario!=='fresh'){await store.updateOptions({...options,autoLogin:scenario!=='no-autologin-collision'&&scenario!=='remember-off-auto'});await store.saveAuthenticated(credentials)}
  const callbacks:Record<string,Function>={};let user:any=null,saved:any=null,start=0,loginCalls=0,sourceSeen='',entered!:()=>void,release!:()=>void
  const enteredPromise=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r)
  const repo={
   login:async(_u:string,_p:string,assertCurrent:()=>void,source:string)=>{loginCalls++;sourceSeen=source;if(['late-username','late-options'].includes(scenario)){entered();await pending;assertCurrent()};if(scenario==='collision')return{status:'manual_login_required'};if(scenario==='policy-auto')return{status:'policy_required'};return{status:'authenticated',automaticLoginAllowed:scenario!=='manual-collision',user:{staffId:1,organizationId:1,username:'alice'}}},
   checkRememberedDeviceLogin:async()=>scenario!=='no-autologin-collision',
   acceptPolicyAndLogin:async(_u:string,_p:string,_a:unknown,source:string)=>{sourceSeen=source;return{status:'manual_login_required'}},
   recoverDeviceCredentials:async()=>null,
   loadLegacyLoginCandidate:()=>{throw Error('legacy import must not be called')}
  }
  const mod=await load('src/main/ipc/handlers/authHandlers.ts',{
   electron:{app:{getLoginItemSettings:()=>({openAtLogin:false}),setLoginItemSettings:()=>{}},ipcMain:{handle:(k:string,f:Function)=>callbacks[k]=f}},
   '../../../shared/types':{IPC_EVENTS},'../../data/repositories/authRepository':repo,
   '../../data/currentUser':{getCurrentUser:()=>user,getCurrentUserCredentials:()=>saved,setCurrentUser:(v:unknown)=>user=v,setCurrentUserCredentials:(v:unknown)=>saved=v},
   '../../services/deviceIdentity':{resetCompositeSelection:async()=>{}},
   '../../services/localLoginService':{getLocalLoginStore:()=>store},'../../services/deviceChangeService':{getDeviceChangeRequests:()=>({})},
   '../../services/devicePresenceService':{devicePresence:{start:()=>{},stop:()=>{}}},'../../services/zaloCampaignEngagement':{resumeDesktopCampaignEngagement:()=>{}}
  })
  mod.registerAuthHandlers({afterLogin:()=>{start++},beforeLogout:()=>{}})
  const boot=callbacks[IPC_EVENTS.AUTH_BOOTSTRAP]()
  if(['late-username','late-options'].includes(scenario)){await enteredPromise;if(scenario==='late-username')callbacks[IPC_EVENTS.AUTH_CANCEL_PENDING_LOGIN]();else await callbacks[IPC_EVENTS.AUTH_UPDATE_LOGIN_PREFERENCES](null,{autoLogin:false});release()}
  const result=await boot
  if(scenario==='fresh'){assert.equal(loginCalls,0);assert.equal(result.rememberedLogin,null)}
  if(scenario==='clean'){assert.equal(sourceSeen,'automatic');assert.equal(result.user.staffId,1);assert.equal(start,1)}
  if(['collision','no-autologin-collision'].includes(scenario)){assert.equal(result.user,null);assert.equal(result.rememberedLogin,null);assert.equal(result.manualLoginRequired,true);assert.equal(result.warningMessage,null);assert.equal(start,0);await assert.rejects(callbacks[IPC_EVENTS.AUTH_LOGIN_REMEMBERED](null,'alice',options));assert.equal((await callbacks[IPC_EVENTS.AUTH_UPDATE_LOGIN_PREFERENCES](null,{rememberLogin:true})).rememberedLogin,null)}
  if(scenario==='remember-off-auto'){assert.equal(result.user,null);assert.equal(result.rememberedLogin.username,'alice');assert.equal(loginCalls,0)}
  if(scenario==='manual-collision'){await callbacks[IPC_EVENTS.AUTH_LOGOUT]();const manual=await callbacks[IPC_EVENTS.AUTH_LOGIN](null,'alice',credentials.password,options);assert.equal(manual.status,'authenticated');assert.equal(store.getCredentials(),null)}
  if(scenario==='policy-auto'){assert.equal(result.policyAcceptanceRequired,true);const policy=await callbacks[IPC_EVENTS.AUTH_ACCEPT_POLICY_AND_LOGIN]();assert.equal(sourceSeen,'automatic');assert.equal(policy.status,'manual_login_required');assert.equal(start,0)}
  if(scenario==='recover-collision'){await callbacks[IPC_EVENTS.AUTH_LOGOUT]();const recover=await callbacks[IPC_EVENTS.AUTH_RECOVER_DEVICE_CREDENTIALS]();assert.equal(recover.rememberedLogin,null);assert.equal(recover.manualLoginRequired,true);assert.equal(recover.warningMessage,null)}
  if(['late-username','late-options'].includes(scenario)){assert.equal(result.user,null);assert.equal(start,0)}
  pass('Main IPC '+scenario)
 }
}
async function repository(root:string){
 for(const scenario of ['clean','collision','changed-hardware','bind-collision','policy','recovery-no-proof','recovery-collision','recovery-clean','wrong-org','unknown-commit'] as const){
  let calls:string[]=[],readCount=0,requests:any[]=[],failOnce=scenario==='unknown-commit'
  const decision=(manual=false)=>({decision:manual?'manual_login_required':'allowed',automaticAllowed:!manual,needsBinding:true,binding:{hash:hash(2),version:2,revision:'0'}})
  const profile={id:1,organization_id:1,username:'alice',is_active:true,is_policy_accepted:scenario!=='policy'}
  const rpc=async(_c:unknown,action:string,data:any)=>{calls.push(action);if(action==='bind_device_v3'){requests.push(data);if(failOnce){failOnce=false;throw Error('response lost')}};return{...profile,organization_id:action==='bind_device_v3'&&scenario==='wrong-org'?2:1,deviceV3:{...decision(scenario==='collision'||(scenario==='bind-collision'&&action==='bind_device_v3')), ...(action==='bind_device_v3'?{needsBinding:false,binding:{hash:hash(3),version:3,revision:'1'}}:{})}}}
  const builder:any={select:()=>builder,eq:()=>builder,maybeSingle:async()=>({data:{id:1,name:'fixture'},error:null})}
  const module=await load('src/main/data/repositories/authRepository.ts',{
   electron:{app:{getPath:()=>join(root,'repo-'+scenario)}},'../../services/deviceBindingMigration':{DeviceBindingMigration},
   '../../services/deviceIdentity':{getCurrentDeviceIdentity:async()=>({fingerprintHash:hash(scenario==='changed-hardware'&&++readCount>1?4:3),platform:'win',label:'fixture'}),getV2DeviceIdentity:async()=>({fingerprintHash:hash(2)})},
   '../../services/deviceChangeService':{},'../currentUser':{},'../supabaseClient':{getSupabaseClient:()=>({from:(name:string)=>{assert.equal(name,'org_organization','no direct staff/password reads');return builder}})},
   './staffClientRepository':{callStaffClient:rpc},'../../services/staffDeviceRecovery':{registerStaffDeviceRecovery:async()=>{},recoverStaffDeviceCredentials:async()=>scenario==='recovery-no-proof'?null:scenario==='recovery-collision'?'manual_login_required':credentials},
   './entitlementRepository':{ensureAkaAgentSubscriptionActive:async()=>{},loadOrganizationEntitlementAccess:async()=>({entitlements:{},zaloAccountCapabilities:{},chatSyncEnabled:false}),loadOrganizationAccountProducts:async()=>[],loadOrganizationChatSyncProducts:async()=>[]},
   './zaloRuntimeModeRepository':{loadStaffZaloServerModeSnapshot:async()=>({})},'./staffManagementRepository':{readStaffAccess:async()=>({isActive:true,timeAllowed:true})}
  })
  if(scenario==='recovery-no-proof')await assert.rejects(module.recoverDeviceCredentials())
  else if(scenario==='recovery-collision')assert.equal(await module.recoverDeviceCredentials(),null)
  else if(scenario==='recovery-clean')assert.deepEqual(await module.recoverDeviceCredentials(),credentials)
  else if(['changed-hardware','wrong-org'].includes(scenario))await assert.rejects(module.login('alice',credentials.password,()=>{},'automatic'))
  else if(scenario==='unknown-commit'){await assert.rejects(module.login('alice',credentials.password,()=>{},'automatic'));await module.login('alice',credentials.password,()=>{},'automatic');assert.equal(requests[0].requestId,requests[1].requestId)}
  else {const result=await module.login('alice',credentials.password,()=>{},'automatic');assert.equal(result.status,scenario==='policy'?'policy_required':scenario.includes('collision')?'manual_login_required':'authenticated')}
  if(scenario==='collision'||scenario==='policy')assert(!calls.includes('bind_device_v3'))
  pass('auth repository '+scenario)
 }
}
async function main(){const root=await mkdtemp(join(tmpdir(),'aka-device-v3-client-'));try{await identity(root);await local(root);await handlers(root);await repository(root);checks+=await reviewRegressions(root);console.log(checks+' v3 client checks passed')}finally{await rm(root,{recursive:true,force:true})}}
void main().catch(e=>{console.error(e);process.exitCode=1})
