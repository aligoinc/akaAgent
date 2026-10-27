const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {execFileSync}=require('node:child_process'), {build}=require('esbuild')
const root=path.resolve(__dirname,'..'), tmp=fs.mkdtempSync(path.join(os.tmpdir(),'facebook-ai-service-')), live=process.argv.includes('--live')
const generalOverride=require('../migrations/snapshots/general-form-ai-v429/config-override.json')
const overrides=[generalOverride,...require('../migrations/snapshots/facebook-form-ai-v428/prompt-overrides.json'),...require('../migrations/snapshots/facebook-form-ai-v427/prompt-overrides.json'),...require('../migrations/snapshots/facebook-form-ai-v426/prompt-overrides.json')]
const specs=require('../migrations/snapshots/facebook-form-ai-v425/configs.json').map(spec=>({...spec,prompt_system:overrides.find(row=>row.kind===spec.kind)?.prompt_system||spec.prompt_system}))
let row, model, output, requests=[],logs=[],reads=[], blockFetch=false
global.__fbUser={staffId:7,organizationId:9,entitlements:{facebookCore:true,zalo:true,email:true,sms:true},zaloAccountCapabilities:{qr:true,web:true,server:true}}
const nativeFetch=global.fetch
const actions=specs[0].campaign_action_ids.map(id=>({id,flatform_type:'facebook',is_active:true,is_delete:false,allow_multiple_accounts:true}))
const accounts=[{id:11,name:'Tài khoản An',staff_id:7,organization_id:9,is_delete:false,flatform_type:'facebook'},
  {id:12,name:'Tài khoản Bình',staff_id:7,organization_id:9,is_delete:false,flatform_type:'facebook'},
  {id:13,name:'Tài khoản Châu',staff_id:7,organization_id:9,is_delete:false,flatform_type:'facebook'},
  {id:99,name:'Khác tổ chức',staff_id:99,organization_id:99,is_delete:false,flatform_type:'facebook'}]
const pages=[{account_id:12,uid:'page-b',name:'Shop Hoa',staff_id:7,is_delete:false,contact_type:'page'}]
global.__fbDb={from(table){let filters=[],single=false,insert,signal,select,limit=Infinity
  const q={select: v=>{select=v;return q},eq:(k,v)=>{filters.push(r=>r[k]===v);return q},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q},
    limit:v=>{limit=v;return q},order:()=>q,abortSignal:v=>{signal=v;return q},returns:()=>q,maybeSingle:()=>{single=true;return q},
    insert:v=>{insert=v;return q},then:(ok,fail)=>Promise.resolve().then(()=>{
      signal?.throwIfAborted(); reads.push({table,select,signal})
      if(insert){logs.push(insert);return {data:{id:10},error:null}}
      const rows=({ai_form_configs:[row],ai_model:[model],auto_campaign_actions:actions,auto_accounts:accounts,auto_account_contacts:pages}[table]||[]).filter(r=>filters.every(f=>f(r))).slice(0,limit)
      return {data:single?rows[0]||null:rows,error:null}
    }).then(ok,fail)};return q
}}
async function main(){
  await build({stdin:{contents:`export * from './src/shared/campaignFacebookAi'; export * from './src/main/services/campaignFacebookAiService';`,resolveDir:root},outfile:path.join(tmp,'m.cjs'),bundle:true,platform:'node',logLevel:'silent',plugins:[{name:'fixtures',setup(b){
    b.onLoad({filter:/\/supabaseClient\.ts$/},()=>({contents:'export const isTrustedServerSupabaseConfigured = () => true; export const desktopSession = { token: async () => null }; export const getSupabaseClient=()=>globalThis.__fbDb',loader:'ts'}))
    b.onLoad({filter:/\/currentUser\.ts$/},()=>({contents:'export const getCurrentUser=()=>({...globalThis.__fbUser,entitlements:globalThis.__fbAllowed?globalThis.__fbUser.entitlements:{}});export const requireCurrentUser=getCurrentUser',loader:'ts'}))
    // Keep entitlementRepository real so subtype guards exercise the account policy.
  }}]})
  const m=require(path.join(tmp,'m.cjs'))
  if(live){
    const workdir=process.env.AKA_AGENT_LINKED_REPO||'/Users/lequangnhut/Repos/akaAgent'
    assert.equal(fs.readFileSync(path.join(workdir,'supabase/.temp/project-ref'),'utf8').trim(),'cgjbsmqtfhqvttudyjzq')
    // Key stays in this process. Never print CLI output or the model object.
    model=JSON.parse(execFileSync('supabase',['db','query','--linked','--workdir',workdir,'--agent=no','-o','json','select * from public.ai_model where id=21'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0]
  }else model={id:21,provider:'openai',model:'gpt-6.1-sol',endpoint:'https://ai.example.test/v1/responses',api_key:'fixture',is_active:true,organization_id:null,default_body:{store:false}}
  global.fetch=async(url,options)=>{
    options.signal.throwIfAborted()
    const body=JSON.parse(options.body);requests.push(body)
    if(blockFetch)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))
    if(live){
      if(process.argv.includes('--legacy-catalog')) {
        // Rehearse the old Desktop wire context with the new DB prompt.
        for(const message of body.input||[]) for(const content of message.content||[]) {
          if(content.type!=='input_text')continue
          const context=JSON.parse(content.text)
          delete context.platform
          if(context.catalog){delete context.catalog.platform;delete context.catalog.allowPageIdentity}
          content.text=JSON.stringify(context)
        }
      }
      return nativeFetch(url,{...options,body:JSON.stringify(body)})
    }
    return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}],usage:{input_tokens:10,output_tokens:20}}))
  }
  const base={requestId:'12345678-1234-1234-1234-123456789012',lockedFields:[],eligibleAccountIds:[11,12,99],singleAccountOnly:false,secondaryAccountId:null}
  const cases=[
    ['general','Chạy bằng Page Shop Hoa của tài khoản Bình, đặt tên chiến dịch là Tháng mười',{name:'Cũ',accountIds:[11],runAsPage:false,runAsPageUid:''},{name:'Tháng mười',accountIds:[12],runAsPage:true,runAsPageUid:'page-b'}],
    ['search','Tìm số điện thoại trong bình luận có từ khóa cần mua, quét 30 bình luận mỗi bài',{isFindPhone:true,isFindInPost:true,isFindInComment:false,findDataGoalModeEnabled:false},{isFindInComment:true,isFindCommentByKeywords:true,commentKeywords:'cần mua',countCommentFindData:30}],
    ['keywords','Thêm 5 từ khóa tìm khách muốn mua căn hộ tại quận 7',{keywords:['mua căn hộ']},{keywords:['mua căn hộ','cần mua căn hộ quận 7','tìm chung cư quận 7','mua nhà quận 7','căn hộ quận 7 giá tốt','tìm mua căn hộ Phú Mỹ Hưng']}],
    ['postSearch','Chỉ lấy bài mới nhất có từ khóa tuyển dụng',{commentPostSort:'recent_activity',commentOnlyLatestPost:false,isFindPostByKeywords:false,postKeywords:''},{commentPostSort:'new_posts',commentOnlyLatestPost:true,isFindPostByKeywords:true,postKeywords:'tuyển dụng'}],
    ['newsfeed','Lướt 15 phút, like tối đa 5 bài vui vẻ, không comment',{newsfeedTimeMinutes:5,enablePostLike:false,enableComment:true,newsfeedLikeLimit:1},{newsfeedTimeMinutes:15,enablePostLike:true,newsfeedLikeLimit:5,newsfeedLikeKind:'vui vẻ',enableComment:false}],
    ['groupComment','Kiêm comment tối đa 3 bài của người khác trong group bị duyệt, nội dung là Xin chào',{enableComment:false,commentType:'own',commentGroupMode:'all',commentCount:1,commentContent:'cũ'},{enableComment:true,commentType:'others',commentGroupMode:'pending_only',commentCount:3,commentContent:'Xin chào'}]
  ]
  global.__fbAllowed=true
  const receipts=[]
  const generalOnly=live&&process.argv.includes('--general-only')
  const secondaryOnly=live&&process.argv.includes('--secondary-only')
  const pageSecondaryOnly=live&&process.argv.includes('--page-secondary-only')
  for(const [kind,description,current,expected]of (live&&(process.argv.includes('--review-only')||secondaryOnly||pageSecondaryOnly||generalOnly)?[]:cases)){
    const spec=specs.find(r=>r.kind===kind)
    row={...spec,id:101+cases.findIndex(c=>c[0]===kind),model_id:21,is_active:true,campaign_scope:'selected',timeout_ms:120000,request_options:{}}
    output={status:'ok',reason:'',changes:{...Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS[kind]).map(k=>[k,null])),...expected}}
    const request={...base,kind,description,current,actionId:kind==='search'?'facebook_find_data_search':m.facebookAiActions(kind)[0]}
    const result=await m.generateCampaignFacebook(request,AbortSignal.timeout(120000))
    if(!result.ok){console.error('Result',kind,result,'Log status',logs.at(-1)?.status,logs.at(-1)?.error_message);throw Error(`Failed ${kind}`)}
    if(!live)for(const [k,v]of Object.entries(expected))assert.deepEqual(result.patch[k],v)
    else if(kind==='general'){assert.deepEqual(result.patch.accountIds,[12]);assert.equal(result.patch.runAsPageUid,'page-b')}
    else if(kind==='keywords'){assert.ok(result.patch.keywords.includes('mua căn hộ'));assert.equal(result.patch.keywords.length,6)}
    else if(kind==='search'){assert.equal(result.patch.countCommentFindData,30);assert.equal(result.patch.isFindInComment,true)}
    else if(kind==='newsfeed'){assert.equal(result.patch.newsfeedTimeMinutes,15);assert.equal(result.patch.newsfeedLikeLimit,5)}
    else if(kind==='groupComment'){assert.equal(result.patch.commentCount,3);assert.equal(result.patch.commentGroupMode,'pending_only')}
    assert.equal(logs.at(-1).form_config_id,row.id)
    const sent=JSON.parse(logs.at(-1).rendered_user_prompt)
    assert.equal(sent.description,description);assert.equal(logs.at(-1).rendered_system_prompt,spec.prompt_system)
    if(kind==='general'){assert.deepEqual(sent.catalog.accounts.map(a=>a.id),[11,12]);assert.deepEqual(Object.keys(sent.catalog.accounts[0]).sort(),['id','name'])}
    receipts.push({kind,ok:result.ok,patch:result.patch,model:model.model})
    console.log(`PASS ${live?'live Sol':'fixture runtime'} ${kind}`)
  }
  const currentGeneral={name:'Giữ tên',accountIds:[11],runAsPage:false,runAsPageUid:''}
  const currentNewOnly={isFindUid:true,isFindInPost:false,isFindInComment:false,isFindNewInteractors:true,findDataGoalModeEnabled:false,
    sortTypePost:'recent_activity',sortTypeComment:'newest',countCommentFindData:10,isFindCommentByKeywords:false,commentKeywords:'',isFindCommentByContentAI:false,commentContentAI:''}
  const reviewCases=[
    {name:'single-account rejects multiple selection',kind:'general',current:currentGeneral,singleAccountOnly:true,description:'Chọn cả tài khoản An và Bình',status:'unsupported',patch:{}},
    {name:'single-account allows replacement',kind:'general',current:currentGeneral,singleAccountOnly:true,description:'Chuyển sang tài khoản Bình',patch:{accountIds:[12]}},
    {name:'new interactors reject keyword filter',kind:'search',current:currentNewOnly,description:'Chỉ lấy những người tương tác mới có bình luận chứa từ cần mua',status:'unsupported',patch:{}},
    {name:'new interactors reject semantic filter',kind:'search',current:currentNewOnly,description:'Giữ nguồn hiện tại, thêm điều kiện AI lọc nội dung comment có ý định mua nhà',status:'unsupported',patch:{}},
    {name:'new interactors allow scan count',kind:'search',current:currentNewOnly,description:'Quét 30 bình luận trên mỗi bài',patch:{countCommentFindData:30}},
    {name:'explicit Comment source permits content filter',kind:'search',current:currentNewOnly,description:'Lấy thêm UID từ nguồn Comment, lọc comment có từ khóa cần mua, giữ nguồn tương tác mới',patch:{isFindInComment:true,isFindCommentByKeywords:true,commentKeywords:'cần mua'}},
    {name:'secondary account cannot become primary',kind:'general',current:currentGeneral,singleAccountOnly:true,secondaryAccountId:12,description:'Đổi tài khoản chính sang Bình, giữ các cấu hình còn lại',status:'unsupported',patch:{}},
    {name:'different primary preserves secondary',kind:'general',current:currentGeneral,singleAccountOnly:true,secondaryAccountId:12,eligibleAccountIds:[11,12,13],description:'Đổi tài khoản chính sang Châu, giữ các cấu hình còn lại',patch:{accountIds:[13]}},
    {name:'Page on a different primary keeps secondary',pageSecondary:true,kind:'general',current:currentGeneral,singleAccountOnly:true,secondaryAccountId:13,eligibleAccountIds:[11,12,13],description:'Chạy bằng Page Shop Hoa của tài khoản Bình, đặt tên là Tháng mười, giữ tài khoản phụ',status:'unsupported',patch:{}},
    {name:'AI cannot remove secondary to select Page',pageSecondary:true,kind:'general',current:{...currentGeneral,accountIds:[12]},singleAccountOnly:true,secondaryAccountId:13,eligibleAccountIds:[11,12,13],description:'Bỏ tài khoản phụ rồi chạy bằng Page Shop Hoa',status:'unsupported',patch:{}},
    {name:'Page works after secondary removed',pageSecondary:true,kind:'general',current:currentGeneral,singleAccountOnly:true,description:'Chạy bằng Page Shop Hoa của tài khoản Bình',patch:{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'}}
  ]
  for(const test of reviewCases.filter(test=>!generalOnly&&(!secondaryOnly||test.secondaryAccountId)&&(!pageSecondaryOnly||test.pageSecondary))){
    const spec=specs.find(row=>row.kind===test.kind)
    row={...spec,id:test.kind==='general'?14:15,model_id:21,is_active:true,campaign_scope:'selected',timeout_ms:120000,request_options:{}}
    output={status:test.status||'ok',reason:test.status?'Form hiện tại chưa hỗ trợ yêu cầu này.':'',changes:{...Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS[test.kind]).map(k=>[k,null])),...test.patch}}
    const request={...base,kind:test.kind,description:test.description,current:test.current,singleAccountOnly:test.singleAccountOnly||false,secondaryAccountId:test.secondaryAccountId??null,
      eligibleAccountIds:test.eligibleAccountIds||base.eligibleAccountIds,actionId:test.kind==='search'?'facebook_find_data_group':'facebook_group_post'}
    const result=await m.generateCampaignFacebook(request,AbortSignal.timeout(120000))
    assert.equal(result.ok,!test.status,JSON.stringify({name:test.name,result}))
    if(test.status)assert.equal(result.code,test.status,JSON.stringify(result))
    else for(const [key,value]of Object.entries(test.patch))assert.deepEqual(result.patch[key],value,test.name)
    const context=JSON.parse(logs.at(-1).rendered_user_prompt)
    if(test.kind==='general'){
      assert.equal(context.catalog.allowMultipleAccounts,!request.singleAccountOnly)
      assert.equal(context.catalog.hasSecondaryAccount,request.secondaryAccountId!==null)
    }
    if(test.secondaryAccountId){assert.equal(context.catalog.secondaryAccount.id,test.secondaryAccountId);assert.ok(context.catalog.accounts.every(account=>account.id!==test.secondaryAccountId))}
    assert.equal(logs.at(-1).rendered_system_prompt,spec.prompt_system);assert.equal(logs.at(-1).form_config_id,row.id)
    receipts.push({name:test.name,result,model:model.model})
    if(!live){
      // An incorrect model output must fail atomically even if it includes another valid edit.
      const bad=test.pageSecondary&&test.secondaryAccountId?{name:'Do not apply',accountIds:[12],runAsPage:true,runAsPageUid:'page-b'}:test.kind==='general'?{name:'Do not apply',accountIds:[11,12]}:{countCommentFindData:30,isFindCommentByKeywords:true,commentKeywords:'cần mua'}
      output={status:'ok',reason:'',changes:{...Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS[test.kind]).map(k=>[k,null])),...bad}}
      const invalid=await m.generateCampaignFacebook(request,AbortSignal.timeout(5000))
      assert.equal(invalid.ok,false);assert.equal(invalid.code,test.secondaryAccountId?'unsupported':'invalid');assert.equal(invalid.patch,undefined)
    }
    console.log(`PASS ${live?'live Sol':'fixture runtime'} review: ${test.name}`)
  }
  if (!live || generalOnly) {
    await require('./campaign-general-ai-service-checks.cjs')({ m, live, base, receipts, model, generalSpec:specs.find(r=>r.kind==='general'),
      accounts, actions, reads, logs, requests, setRow:value=>{row=value}, setOutput:value=>{output=value} })
  }
  if(!live){
    const generalSpec=specs.find(r=>r.kind==='general'),action=actions.find(r=>r.id==='facebook_group_post')
    row={...generalSpec,id:14,model_id:21,is_active:true,campaign_scope:'selected',timeout_ms:120000,request_options:{}}
    const secondaryRequest={...base,kind:'general',actionId:action.id,current:currentGeneral,description:'Đổi tài khoản chính sang Bình',secondaryAccountId:12}
    output={status:'ok',reason:'',changes:{...Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS.general).map(k=>[k,null])),name:'Do not partially apply',accountIds:[12]}}
    const readStart=reads.length
    const conflict=await m.generateCampaignFacebook(secondaryRequest,AbortSignal.timeout(5000))
    assert.equal(conflict.ok,false);assert.equal(conflict.code,'unsupported');assert.equal(conflict.patch,undefined)
    const secondaryContext=JSON.parse(logs.at(-1).rendered_user_prompt)
    assert.deepEqual(secondaryContext.catalog.accounts,[{id:11,name:'Tài khoản An'}])
    assert.deepEqual(secondaryContext.catalog.secondaryAccount,{id:12,name:'Tài khoản Bình'})
    assert.deepEqual(secondaryContext.catalog.pages,[])
    assert.equal(secondaryContext.catalog.allowMultipleAccounts,false)
    assert.deepEqual(reads.slice(readStart).map(r=>r.table),['auto_campaign_actions','ai_form_configs','ai_model','auto_accounts','auto_account_contacts','ai_log'])
    // An unowned secondary ID must never reveal its name via the new context.
    output.changes={...output.changes,name:null,accountIds:[12]}
    const different=await m.generateCampaignFacebook({...secondaryRequest,secondaryAccountId:99},AbortSignal.timeout(5000))
    assert.equal(different.ok,true);assert.deepEqual(different.patch.accountIds,[12])
    assert.equal(JSON.parse(logs.at(-1).rendered_user_prompt).catalog.secondaryAccount,null)
    assert.equal(JSON.parse(logs.at(-1).rendered_user_prompt).catalog.hasSecondaryAccount,true)
    output.changes={...output.changes,runAsPage:true,runAsPageUid:'page-b'}
    const unknownSecondary=await m.generateCampaignFacebook({...secondaryRequest,secondaryAccountId:99},AbortSignal.timeout(5000))
    assert.equal(unknownSecondary.ok,false);assert.equal(unknownSecondary.code,'unsupported');assert.equal(unknownSecondary.patch,undefined)
    console.log('PASS secondary account: excluded from primary/Page catalog, rejected atomically, authorized name only, unchanged query count')
    action.allow_multiple_accounts=false
    output={status:'ok',reason:'',changes:{...Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS.general).map(k=>[k,null])),accountIds:[11,12]}}
    const narrowed=await m.generateCampaignFacebook({...base,kind:'general',actionId:action.id,current:currentGeneral,description:'Chọn cả hai'},AbortSignal.timeout(5000))
    assert.equal(narrowed.ok,false);assert.equal(JSON.parse(logs.at(-1).rendered_user_prompt).catalog.allowMultipleAccounts,false)
    action.allow_multiple_accounts=true
    const spec=specs.find(r=>r.kind==='groupComment')
    row={...spec,id:106,model_id:21,is_active:true,campaign_scope:'selected',timeout_ms:120000,request_options:{}}
    output={status:'ok',reason:'',changes:Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS.groupComment).map(k=>[k,null]))}
    const request={...base,kind:'groupComment',description:'Test',current:{},actionId:'facebook_group_post'}
    for(const mutate of [()=>row.is_active=false,()=>row.campaign_action_ids=[],()=>model.is_active=false,()=>model.organization_id=9,()=>global.__fbAllowed=false]){
      const oldRow=structuredClone(row),oldModel=structuredClone(model),count=requests.length;mutate()
      await assert.rejects(()=>m.generateCampaignFacebook(request,new AbortController().signal));assert.equal(requests.length,count)
      row=oldRow;model=oldModel;global.__fbAllowed=true
    }
    const c=new AbortController();c.abort();await assert.rejects(()=>m.generateCampaignFacebook(request,c.signal))
    model={...model,provider:'claude',endpoint:'https://ai.example.test/v1/messages',model:'compatible-model',default_body:{max_tokens:1000}}
    global.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]}))}
    assert.equal((await m.generateCampaignFacebook(request,AbortSignal.timeout(5000))).ok,true)
    assert.equal(requests.at(-1).model,'compatible-model')
    blockFetch=true;model={...model,provider:'openai',endpoint:'https://ai.example.test/v1/responses'}
    global.fetch=async(_url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))
    const cancel=new AbortController(),timer=setTimeout(()=>cancel.abort(),50)
    await assert.rejects(()=>m.generateCampaignFacebook(request,cancel.signal));clearTimeout(timer)
    console.log('PASS service guards: inactive config/model, scope, tenant, capability, preabort, in-flight abort, compatible model switch, log binding and server catalog')
  }else fs.writeFileSync(path.join(root,'migrations/snapshots/general-form-ai-v429',generalOnly?'general-provider-smoke.json':process.argv.includes('--legacy-catalog')?'legacy-provider-smoke.json':pageSecondaryOnly?'page-secondary-smoke.json':secondaryOnly?'secondary-account-smoke.json':'provider-smoke.json'),JSON.stringify({testedAt:new Date().toISOString(),legacyCatalog:process.argv.includes('--legacy-catalog'),syntheticCatalog:true,productionWrites:false,receipts},null,2)+'\n')
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{global.fetch=nativeFetch;fs.rmSync(tmp,{recursive:true,force:true})})
