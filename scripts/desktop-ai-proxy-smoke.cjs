// Real Desktop repository/runtime/transport -> real local Fastify bridge -> fake
// provider. Compare against the pre-change runtime. Never calls production.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const {build}=require('esbuild')
const root=path.resolve(__dirname,'..'),web=process.env.AKA_AGENT_WEB_REPO||path.resolve(root,'../akaAgentWebApp')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-ai-http-')),realFetch=global.fetch
let trusted=true,model,using,prompt,form,replyText,status,logs=[],queries=[],sent=[],providerFailure=false
const db={from(table){let filters=[],single=false,insert,projection='*';const q={
 select(value='*'){projection=value;queries.push([table,value]);return q},eq(k,v){filters.push(r=>r[k]===v);return q},
 not(k,_op,v){filters.push(r=>r[k]!==v);return q},abortSignal(){return q},returns(){return q},maybeSingle(){single=true;return q},
 insert(value){insert=value;return q},then(ok,bad){return Promise.resolve().then(()=>{
  if(insert){logs.push(insert);return {data:{id:99},error:null}}
  const rows=(table==='ai_model'?[model]:table==='ai_using'?[using]:table==='ai_prompt'?[prompt]:[form]).filter(r=>filters.every(f=>f(r)))
    .map(r=>projection==='*'?{...r}:Object.fromEntries(projection.split(',').map(k=>[k,r[k]])))
  return {data:single?rows[0]||null:rows,error:null}
 }).then(ok,bad)}};return q}}
global.__desktopAiDb=db;global.__desktopAiTrusted=()=>trusted
const provider=async(url,init)=>{if(providerFailure)throw new TypeError('fetch failed');sent.push({url,body:JSON.parse(init.body),headers:Object.fromEntries(new Headers(init.headers))});return new Response(replyText,{status})}
const clean=result=>{const copy=JSON.parse(JSON.stringify(result));delete copy.durationMs;delete copy.duration_ms;delete copy.generatedAt;return copy}
async function main(){let app;try{
 const Fastify=require(path.join(web,'node_modules/fastify'))
 await build({entryPoints:[path.join(web,'apps/api/src/modules/desktop-ai/desktop-ai.routes.ts')],outfile:path.join(tmp,'routes.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'no-backend-secrets',setup(b){
  b.onLoad({filter:/\/config\/env\.ts$/},()=>({contents:'export const env={};export const requireConnectionString=()=>{throw Error("unexpected Auth network")}',loader:'ts'}))
  b.onLoad({filter:/\/db\/akaAgentSupabase\.ts$/},()=>({contents:'export const getAkaAgentSupabaseClient=()=>{throw Error("unexpected remote DB")}',loader:'ts'}))
 }}]})
 const {desktopAiRoutes,DESKTOP_AI_PATH}=require(path.join(tmp,'routes.cjs'))
 app=Fastify({logger:false});await app.register(desktopAiRoutes,{dependencies:{
  authenticate:async token=>{assert.equal(token,'fixture.jwt.token');return {staffId:1,organizationId:10}},
  config:async input=>{assert.equal(input.modelId,model.id);return {apiKey:model.api_key,endpoint:model.endpoint,provider:model.provider,model:model.model,timeoutMs:using.timeout_ms}},send:provider
 }})
 const address=await app.listen({host:'127.0.0.1',port:0});process.env.AKA_AGENT_AI_API_URL=address+DESKTOP_AI_PATH
 const plugins=[{name:'desktop-fixture',setup(b){
  b.onLoad({filter:/\/supabaseClient\.ts$/},()=>({contents:'export const getSupabaseClient=()=>globalThis.__desktopAiDb;export const isTrustedServerSupabaseConfigured=()=>globalThis.__desktopAiTrusted();export const desktopSession={token:async signal=>{signal.throwIfAborted();return "fixture.jwt.token"}}',loader:'ts'}))
  b.onLoad({filter:/\/currentUser\.ts$/},()=>({contents:'export const getCurrentUser=()=>({staffId:1,organizationId:10})',loader:'ts'}))
 }}]
 const entry="export * from './src/main/services/aiRuntimeService'; export * from './src/main/data/repositories/aiRepository'"
 await build({stdin:{contents:entry,resolveDir:root},outfile:path.join(tmp,'next.cjs'),bundle:true,platform:'node',format:'cjs',plugins,logLevel:'silent'})
 const old=execFileSync('git',['show','HEAD:src/main/services/aiRuntimeService.ts'],{cwd:root,encoding:'utf8'})
 await build({stdin:{contents:old,resolveDir:path.join(root,'src/main/services'),loader:'ts'},outfile:path.join(tmp,'old.cjs'),bundle:true,platform:'node',format:'cjs',plugins,logLevel:'silent'})
 const next=require(path.join(tmp,'next.cjs')),previous=require(path.join(tmp,'old.cjs'))
 const payload={name:'Hữu Thực',date:'2026-10-27T10:01:02.123456+07:00',count:12,promptOverride:'Ngày {{date}}: [name]',
   messages:[{role:'system',content:'A system'},{role:'user',content:'Xin chào'}],imageDataUrls:['data:image/png;base64,ZmFrZQ=='],bodyOverrides:{temperature:0.1}}
 let cases=0
 for(const kind of ['responses','chat','custom','claude'])for(const outcome of ['ok','http_error','invalid_output','network_error']){
  const isForm=kind==='claude';providerFailure=outcome==='network_error';status=outcome==='http_error'?429:200
  model={id:2,code:'fixture',provider:isForm?'claude':kind==='custom'?'custom':'openai',model:'fixture-model',endpoint:'https://provider.fixture.test/v1/'+(kind==='responses'?'responses':isForm?'messages':'chat/completions'),api_key:'fixture-secret',is_active:true,organization_id:null,default_body:{max_tokens:1000}}
  using={id:1,code:'fixture',model_id:2,prompt_id:3,is_active:true,is_system:true,organization_id:null,timeout_ms:180000,response_path:kind==='custom'?'data.answer':null,request_options:{temperature:0.2}}
  prompt={id:3,code:'fixture',is_active:true,prompt_system:'System {{name}}',prompt_user:'Ngày [date]'}
  form={...using,...prompt,id:5,code:'fixture',model_id:2,desktop_section_id:'campaign.content',campaign_scope:'all',campaign_action_ids:[],output_schema:{type:'object'}}
  replyText=outcome==='http_error'?JSON.stringify({error:{message:'Quota exceeded'},usage:{input_tokens:4}}):outcome==='invalid_output'?'{}':JSON.stringify(kind==='responses'?{output_text:'Kết quả ✓',usage:{input_tokens:2,output_tokens:3}}:kind==='chat'?{choices:[{message:{content:'Kết quả ✓'}}],usage:{prompt_tokens:2,completion_tokens:3}}:isForm?{content:[{type:'text',text:'Kết quả ✓'}],usage:{input_tokens:2,output_tokens:3}}:{data:{answer:'Kết quả ✓'}})
  trusted=true;global.fetch=provider;logs=[];sent=[]
  const oldConfig=isForm?await next.getFormAiConfig('campaign.content','email_send',new AbortController().signal):undefined
  const expected=await previous.callAiUsing('fixture',payload,{organizationId:10},{formConfig:oldConfig});const expectedLogs=logs.map(clean),expectedSent=sent
  trusted=false;global.fetch=realFetch;logs=[];sent=[];queries=[]
  const config=isForm?await next.getFormAiConfig('campaign.content','email_send',new AbortController().signal):undefined
  assert(!config?.model.apiKey)
  const actual=await next.callAiUsing('fixture',payload,{organizationId:10},{formConfig:config})
  // Network failures retain the pre-existing generic fetch-error path.
  assert.deepEqual(clean(actual),clean(expected),kind+' '+outcome)
  assert.deepEqual(logs.map(clean),expectedLogs)
  assert.deepEqual(sent,expectedSent)
  assert(queries.filter(([table])=>table==='ai_model').every(([,columns])=>columns!=='*'&&!columns.includes('api_key')))
  cases++
 }
 // Rejections from the bridge are not mistaken for provider errors and never
 // replay the request against the provider directly.
 providerFailure=false;trusted=false;let calls=0;global.fetch=async()=>{calls++;return new Response('{}',{status:503})}
 assert.equal((await next.callAiUsing('fixture')).error,'fetch failed');assert.equal(calls,1)
 const controller=new AbortController();controller.abort();await assert.rejects(()=>next.callAiUsing('fixture',{}, {},{signal:controller.signal}));assert.equal(calls,1)
 console.log(`PASS ${cases} old/new real HTTP cases: payload/headers/content/usage/error/log parity, secret-free Desktop queries, no retry/fallback and cancellation`)
}finally{global.fetch=realFetch;if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});delete process.env.AKA_AGENT_AI_API_URL}}
main().catch(error=>{console.error(error);process.exitCode=1})
