// Actual repository + Supabase SDK. A narrow SQL bridge checks its exact
// request against the equivalent join under the caller's real PostgreSQL role.
// This does not pretend to run a local PostgREST server.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict')
const {createClient}=require('@supabase/supabase-js')
const catalogQuery=`SELECT coalesce(jsonb_agg(to_jsonb(result) ORDER BY result.sort_order,result.id),'[]') FROM (
 SELECT i.id,i.code,i.name,i.sort_order,i.is_active,
 jsonb_build_object('namespace',t.namespace,'code',t.code,'managed_by',t.managed_by,'is_active',t.is_active) AS category_type
 FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
 WHERE t.namespace='common' AND t.code='data_type' AND t.managed_by='system' AND t.is_active=true
 AND i.managed_by='system' AND i.is_active=true ORDER BY i.sort_order,i.id) result`
async function readCatalog(runAs,role='aka_agent_desktop') {
  let calls=0
  const client=createClient('http://127.0.0.1:1','fixture-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input)=>{
    calls++
    const url=new URL(typeof input==='string'?input:input.url)
    assert.equal(url.pathname,'/rest/v1/category_item')
    assert.deepEqual(Object.fromEntries(url.searchParams),{
      select:'id,code,name,sort_order,is_active,category_type!inner(namespace,code,managed_by,is_active)',
      'category_type.namespace':'eq.common','category_type.code':'eq.data_type','category_type.managed_by':'eq.system',
      'category_type.is_active':'eq.true',managed_by:'eq.system',is_active:'eq.true',order:'sort_order.asc,id.asc'
    })
    try { return new Response(runAs(role,catalogQuery),{status:200,headers:{'Content-Type':'application/json'}}) }
    catch(error) { if(!/permission denied for table category_type/.test(error.message))throw error
      return new Response(JSON.stringify({code:'42501',message:'permission denied for table category_type'}),{status:403,headers:{'Content-Type':'application/json'}}) }
  }}})
  const file=path.join(__dirname,'../../src/main/data/repositories/dataGroupRepository.ts'),exports={}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:name=>name==='../supabaseClient'?{getSupabaseClient:()=>client}:{},console},{filename:file})
  const result=await exports.listDataTypeCategoryItems()
  assert.equal(calls,1)
  return JSON.parse(JSON.stringify(result))
}
module.exports={catalogQuery,readCatalog}
