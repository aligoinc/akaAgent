const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
async function main(){
  const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations/snapshots/general-form-ai-v429')
  const before=require(path.join(dir,'before-config.json')),next=require(path.join(dir,'config-override.json'))
  const source=fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8')
  const key=source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)?.[1]
  assert(key);assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role,'anon')
  const get=async route=>{
    const response=await fetch('https://cgjbsmqtfhqvttudyjzq.supabase.co/rest/v1/'+route,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)})
    assert.equal(response.status,200,`HTTP ${response.status}`);return response.json()
  }
  const [row]=await get('ai_form_configs?select=*&id=eq.14')
  assert(row)
  for(const [key,value]of Object.entries(before)){
    if(['updated_at','prompt_system','name','campaign_scope','campaign_action_ids'].includes(key))continue
    assert.deepEqual(row[key],value,key)
  }
  for(const key of ['prompt_system','name','campaign_scope','campaign_action_ids'])assert.deepEqual(row[key],next[key],key)
  const metadata=await get('ai_form_configs?select=desktop_section_id,campaign_scope,campaign_action_ids&is_active=eq.true&desktop_section_id=eq.campaign.facebook.general')
  assert.deepEqual(metadata,[{desktop_section_id:'campaign.facebook.general',campaign_scope:'all',campaign_action_ids:[]}])
  // Check the exact added HTTP columns without reading any real account data.
  assert.deepEqual(await get('auto_accounts?select=id,name,flatform_type,is_zalo_show_web,is_zalo_server&id=eq.-1'),[])
  const receipt={checkedAt:new Date().toISOString(),project:'cgjbsmqtfhqvttudyjzq',status:'PASS',configId:14,modelId:row.model_id,
    checks:['exact new prompt/scope/name','schema/template/options/model/bindings preserved','public metadata all scope','account catalog column permissions; zero account records read']}
  fs.writeFileSync(path.join(dir,'http-smoke.json'),JSON.stringify(receipt,null,2)+'\n')
  console.log('PASS live HTTP: general config prompt, metadata all scope, preserved schema/model/options, catalog columns readable')
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
