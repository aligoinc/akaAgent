const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),cache=new Map();let calls=[],provider,authorization=0
function load(relative){const filename=path.resolve(root,relative);if(cache.has(filename))return cache.get(filename).exports;const m={exports:{}};cache.set(filename,m)
 const requireLocal=id=>{
  if(id.endsWith('/supabaseClient'))return {getSupabaseClient:()=>({rpc:(name,args)=>({abortSignal:signal=>({then:fn=>Promise.resolve().then(()=>{calls.push({name,args,signal});return provider(name,args,signal)}).then(fn)})})})}
  if(id.endsWith('/repositories/dataGroupRepository'))return {mapDataGroupMember:row=>({id:row.id,contactId:row.contact_id,name:row.name})}
  if(id.endsWith('/repositories/localAccountContactRepository'))return {listFilteredPageInboxContacts:async()=>({contacts:[],total:0})}
  if(!id.startsWith('.'))return require(id)
  return load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts')))
 }
 const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 new Function('require','module','exports',js)(requireLocal,m,m.exports);return m.exports
}
const auth=load('src/main/data/currentUser.ts'),service=load('src/main/data/filters/dataColumnReadService.ts')
auth.setCurrentUser({staffId:10,organizationId:1});auth.setCurrentUserCredentials({username:'owner',password:'fixture'})
const request=(patch={})=>({source:'contacts',accountId:1,formId:'form',requestId:Math.random().toString(16).slice(2),query:{columnFilters:{version:1,filters:[]}},...patch})
const row=n=>({id:n,account_id:1,contact_type:'person',name:'Row '+n,uid:'00'+n,is_delete:false})
const response=(rows,total=rows.length,after=null,hasMore=false)=>({data:{version:1,rows,total,after,hasMore},error:null})
const allow=async()=>{authorization++}
;(async()=>{
 let checks=0
 provider=async()=>response([row(1)],1)
 let result=await service.executeColumnRead('window1',request(),allow);assert.equal(result.contacts[0].uid,'001');assert.equal(authorization,1);assert.equal(calls[0].args.p_staff_id,10);checks++
 calls=[];await assert.rejects(service.executeColumnRead('window1',request(),async()=>{throw new Error('no capability')}),/no capability/);assert.equal(calls.length,0);checks++
 await assert.rejects(service.executeColumnRead('window1',request({query:{columnFilters:{version:1,filters:[{field:'password',op:'eq',value:'x'}]}}}),allow),/hợp lệ/);assert.equal(calls.length,0);checks++
 provider=async(_,args)=>{let q=args.p_query;return q.after?response([row(501)],null,{rank:0,name:'Row501',time:'2026-01-01',id:'501'}):response(Array.from({length:500},(_,i)=>row(i+1)),501,{rank:0,name:'Row500',time:'2026-01-01',id:'500'},true)}
 result=await service.executeColumnRead('window1',request(),allow,'export');assert.equal(result.contacts.length,501);assert.equal(result.total,501);assert.equal(calls.at(-1).args.p_query.countMode,'none');assert.equal(calls.at(-1).args.p_query.offset,0);checks++
 let cursorCalls=0;provider=async()=>response([row(++cursorCalls)],10,{id:'1'},true)
 await assert.rejects(service.executeColumnRead('window1',request(),allow,'export'),/không tiến lên/);checks++
 provider=async()=>({data:null,error:{code:'PGRST202'}})
 result=await service.executeColumnRead('window1',request(),allow);assert.equal(result.available,false)
 await assert.rejects(service.executeColumnRead('window1',request({query:{columnFilters:{version:1,filters:[{field:'name',op:'contains',value:'Row'}]}}}),allow),/chưa được cập nhật/);checks++
 auth.setCurrentUserCredentials({username:'owner',password:'fixture'});
 provider=async()=>response([row(1)],10);await assert.rejects(service.executeColumnRead('window1',request(),allow,'export'),/Dữ liệu đã thay đổi/);checks++;
 provider=async()=>({data:null,error:{code:'57014'}});await assert.rejects(service.executeColumnRead('window1',request(),allow),/quá thời gian/);checks++;
 provider=async()=>response([row(1)],1);await service.executeColumnRead('window1',request({source:'remarketing',query:{dateFrom:'',dateTo:''}}),allow);assert.equal(calls.at(-1).args.p_query.dateFrom,undefined);checks++;
 let finish
 provider=()=>new Promise(resolve=>finish=resolve)
 const old=service.executeColumnRead('window1',request(),allow).catch(e=>e.message);await new Promise(r=>setTimeout(r,10));auth.setCurrentUserCredentials({username:'owner',password:'fixture'});finish(response([row(1)],1));assert.match(await old,/Phiên/);checks++
 // Cancelling a form fences immediately but does not detach an in-flight HTTP query.
 const pending=[];provider=(_name,_args,signal)=>new Promise(resolve=>pending.push({resolve,signal}));
 const one=service.executeColumnRead('cancel-test',request({formId:'one'}),allow).catch(e=>e.message);
 const two=service.executeColumnRead('cancel-test',request({formId:'two'}),allow);
 await new Promise(r=>setTimeout(r,10));assert.equal(pending.length,2);
 service.cancelColumnRead('cancel-test','one');assert.match(await one,/hủy/);assert.equal(pending[0].signal.aborted,false);checks++;
 const three=service.executeColumnRead('cancel-test',request({formId:'three'}),allow);
 await new Promise(r=>setTimeout(r,10));assert.equal(pending.length,2);checks++;
 pending[0].resolve(response([row(1)],1));await new Promise(r=>setTimeout(r,10));assert.equal(pending.length,3);
 pending[1].resolve(response([row(2)],1));pending[2].resolve(response([row(3)],1));
 assert.equal((await two).contacts[0].id,2);assert.equal((await three).contacts[0].id,3);checks++;
 console.log(`${checks} service checks passed`)
})().catch(e=>{console.error(e);process.exitCode=1})
