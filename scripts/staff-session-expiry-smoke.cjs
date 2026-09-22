const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {runInNewContext}=require('node:vm')
const ts=require('typescript')
async function main(){
 const auth=ts.transpileModule(readFileSync('src/main/data/repositories/authRepository.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 for(const scenario of ['active','locked','expired','network']){
  let productChecks=0
  const exports={}
  runInNewContext(auth+'\nexports.check=ensureStaffSubscriptionActive;', {exports,require:(name)=>{
   if(name.endsWith('staffManagementRepository'))return {readStaffAccess:async()=>{if(scenario==='network')throw Error('network');return {isActive:scenario!=='locked',timeAllowed:scenario!=='expired'}}}
   if(name.endsWith('entitlementRepository'))return {ensureAkaAgentSubscriptionActive:async()=>{productChecks++}}
   return {}
  }})
  const attempt=exports.check({id:1,organization_id:2,username:'fixture',password:'fixture'})
  if(scenario==='active'){await attempt;assert.equal(productChecks,1)}else{await assert.rejects(attempt);assert.equal(productChecks,0)}
 }
 const source=ts.createSourceFile('handlers.ts',readFileSync('src/main/ipc/handlers.ts','utf8'),ts.ScriptTarget.Latest,true)
 let declaration
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='runSessionExpiryCheck')declaration=node;ts.forEachChild(node,visit)};visit(source);assert(declaration)
 const code=ts.transpileModule('const '+declaration.getText(source)+'; globalThis.check=runSessionExpiryCheck;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 for(const scenario of ['expired-busy','expired-idle','locked-busy','credential-race']){
  const credentials={username:'fixture',password:'fixture'}
  let current={staffId:1,organizationId:2,isAdmin:true}, currentCredentials=credentials
  const events=[]
  const context={scheduleSessionExpiryCheck:()=>{},sessionExpiryCheckRunning:false,getCurrentUser:()=>current,getCurrentUserCredentials:()=>currentCredentials,
   loadOrganizationEntitlementAccess:async()=>({entitlements:{facebook:true}}),loadOrganizationAccountProducts:async()=>[],loadOrganizationChatSyncProducts:async()=>[],
   readStaffAccess:async()=>{if(scenario==='credential-race')currentCredentials={...credentials};return {isActive:scenario!=='locked-busy',timeAllowed:false,isAdmin:true}},
   campaignScheduler:{stopAcceptingNewZaloWork:()=>events.push('scheduler-drain'),waitForIdle:async()=>scenario==='expired-idle'},
   automationProcessor:{stopAcceptingNewWork:()=>events.push('automation-drain'),waitForIdle:async()=>true},
   setCurrentUser:user=>{current=user},notifyRendererUserUpdated:()=>events.push('revoke-ui'),admin:{revokeIfNeeded:async()=>events.push('revoke-admin')},
   expireCurrentSession:async()=>events.push('expire'),console:{error:(...args)=>{throw Error(args.join(' '))}}}
  runInNewContext(code,context);await context.check('runtime')
  if(scenario==='credential-race')assert.deepEqual(events,[])
  else{assert(events.includes('scheduler-drain'));assert(events.includes('automation-drain'));assert(events.includes('revoke-ui'));assert.equal(events.includes('expire'),scenario==='expired-idle')}
 }
 console.log('PASS staff session: login blocks lock/expiry/network; product gate retained; refresh drains scheduler/automation, revokes admin UI, waits for held work, ignores stale credentials')
}
main().catch(error=>{console.error(error);process.exitCode=1})
