const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname,'../src/shared/actionStatusPolicy.ts'),'utf8')
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require,Object,Map,Set,Error,Number,JSON})
const { ActionStatusCatalog, ResultContractError, aggregateResultEffects, secondaryConditionTransition } = mod.exports
const status = (id,code,value) => ({id,code,name:code,statusValue:value,color:null,componentType:'campaign_detail',platform:'all',isActive:true,isDelete:false})
const statuses = [status(1,'success','thành công'),status(2,'already_friend','đã là bạn bè'),status(3,'post_pending','chờ duyệt bài'),status(4,'failure','thất bại')]
const policy = (id,statusId,actionCode=null,extra={}) => ({id,statusId,actionCode,reportGroup:'success',countsTowardLimit:true,badTargetEffect:'reset',resetErrorStreak:true,inputEffect:'complete',isActive:true,isDelete:false,...extra})
const defaults = [policy(1,1),policy(2,2,null,{reportGroup:'skipped',countsTowardLimit:false,badTargetEffect:'ignore',resetErrorStreak:false}),policy(4,4,null,{reportGroup:'failure',badTargetEffect:'increment'})]
const output = extra => ({actionCode:'new_action',statusCode:'success',operationState:'committed',...extra})
let checks=0
function test(name,run){run();checks++;console.log('PASS '+name)}
function throwsReason(run,reason){assert.throws(run,e=>e instanceof ResultContractError&&e.reason===reason)}
test('new action inherits default; no action row required',()=>{
 const c=new ActionStatusCatalog(statuses,defaults);c.preflight([{actionCode:'new_action',statusCodes:['success']}]);const r=c.resolve(output());assert.equal(r.actionStatusPolicyId,1);assert.equal(r.countsTowardLimit,true)
})
test('specific overrides entire policy; inactive specific blocks; deleted specific falls back',()=>{
 const custom=policy(10,1,'new_action',{countsTowardLimit:false,badTargetEffect:'ignore',resetErrorStreak:false});
 assert.equal(new ActionStatusCatalog(statuses,[...defaults,custom]).resolve(output()).countsTowardLimit,false)
 throwsReason(()=>new ActionStatusCatalog(statuses,[...defaults,{...custom,isActive:false}]).resolve(output()),'policy_disabled')
 assert.equal(new ActionStatusCatalog(statuses,[...defaults,{...custom,isDelete:true,isActive:false}]).resolve(output()).actionStatusPolicyId,1)
})
test('existing friendship differs from a newly sent request',()=>{
 const c=new ActionStatusCatalog(statuses,defaults);const fresh=c.resolve(output());const old=c.resolve(output({statusCode:'already_friend',operationState:'not_committed'}));assert.equal(fresh.reportGroup,'success');assert.equal(old.reportGroup,'skipped');assert.equal(old.countsTowardLimit,false)
})
test('secondary requires no policy; promotion to main needs policy and leaves old result intact',()=>{
 const c=new ActionStatusCatalog(statuses,defaults), old=c.resolve(output({subStatusCode:'post_pending'}));assert.equal(old.statusId,1);assert.equal(old.subStatusId,3);assert.equal(old.countsTowardLimit,true)
 throwsReason(()=>c.resolve(output({statusCode:'post_pending'})),'policy_missing')
 const next=new ActionStatusCatalog(statuses,[...defaults,policy(3,3,null,{reportGroup:'pending',countsTowardLimit:false})]);assert.equal(next.resolve(output({statusCode:'post_pending'})).reportGroup,'pending');assert.equal(old.reportGroup,'success')
})
test('changed configuration affects only newly resolved results',()=>{
 const old=new ActionStatusCatalog(statuses,defaults).resolve(output());const changed=new ActionStatusCatalog(statuses,defaults.map(p=>p.id===1?{...p,countsTowardLimit:false}:p)).resolve(output());assert.equal(old.countsTowardLimit,true);assert.equal(changed.countsTowardLimit,false);assert(Object.isFrozen(old))
})
test('override resolves final main before policy selection; suppress retains no detail',()=>{
 const c=new ActionStatusCatalog(statuses,defaults);const e={detailMode:'override',detailStatusId:2,inputEffect:null};const r=c.resolve(output(),e);assert.equal(r.actionStatusPolicyId,2);assert.equal(r.statusValue,'đã là bạn bè')
 const suppressed=c.resolve(output(),{detailMode:'suppress',detailStatusId:null,inputEffect:'requeue'});assert.equal(suppressed.createDetail,false);assert.equal(suppressed.inputEffect,'pause')
})
test('legacy NULL mode uses supplied flow semantics, never implicit Error',()=>{
 const c=new ActionStatusCatalog(statuses,defaults);const e={detailMode:null,detailStatusId:null,inputEffect:null};assert.equal(c.resolve(output(),e).statusId,1);assert.equal(c.resolve(output({operationState:'not_committed'}),e,{legacySuppress:true,legacyInputEffect:'requeue'}).inputEffect,'requeue')
})
test('partial, auxiliary, mixed batch and unknown-operation guards survive overrides',()=>{
 const c=new ActionStatusCatalog(statuses,defaults);const e={detailMode:'inherit',detailStatusId:null,inputEffect:'requeue',countsTowardLimit:false,badTargetEffect:'increment'};
 const partial=c.resolve(output({operationState:'not_committed'}),e,{partialDelivery:true});assert.equal(partial.countsTowardLimit,true);assert.equal(partial.inputEffect,'pause')
 const aux=c.resolve(output(),e,{auxiliaryAction:true});assert.equal(aux.countsTowardLimit,false);assert.equal(aux.badTargetEffect,'ignore');assert.equal(aux.resetErrorStreak,false)
 assert.equal(c.resolve(output({operationState:'unknown'}),e).inputEffect,'pause');assert.equal(c.resolve(output(),e,{targetOnlyFailure:true}).badTargetEffect,'ignore')
})
test('multiple results cannot requeue a target with a committed sibling action',()=>{
 const c=new ActionStatusCatalog(statuses,defaults);const rows=[c.resolve(output()),c.resolve(output({operationState:'not_committed'}),{detailMode:'inherit',detailStatusId:null,inputEffect:'requeue'})];assert.equal(aggregateResultEffects(rows).inputEffect,'pause')
})
test('secondary automation fires only on a false-to-true edge',()=>{
 assert.equal(secondaryConditionTransition(true,true,null,3,[3]),true);assert.equal(secondaryConditionTransition(true,true,3,3,[3]),false);assert.equal(secondaryConditionTransition(true,true,null,3,null),false);assert.equal(secondaryConditionTransition(false,false,null,3,[3]),false)
})
test('unknown main, inactive catalog and duplicate identities fail closed',()=>{
 throwsReason(()=>new ActionStatusCatalog(statuses,defaults).resolve(output({statusCode:'unknown'})),'status_unknown');throwsReason(()=>new ActionStatusCatalog(statuses.map(s=>s.id===1?{...s,isActive:false}:s),defaults).resolve(output()),'status_unavailable');throwsReason(()=>new ActionStatusCatalog(statuses,[...defaults,policy(99,1)]),'policy_duplicate')
})
console.log(JSON.stringify({checks,external_operations:0}))
