// Pure/service/VM smoke: no browser, network, database or real recipients.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = name => fs.readFileSync(path.join(root,name),'utf8')
const transpile = text => ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const cache = new Map()
function load(name) {
  const file=path.resolve(root,name)
  if(cache.has(file))return cache.get(file)
  const module={exports:{}};cache.set(file,module.exports)
  new Function('module','exports','require',transpile(fs.readFileSync(file,'utf8')))(module,module.exports,id=>
    id.startsWith('.')?load(path.resolve(path.dirname(file),id)+'.ts'):require(id))
  return module.exports
}
const core=load('src/shared/campaignContentPreparation.ts')
const spin=load('src/shared/contentSpin.ts')
const formatted=load('src/shared/formattedContent.ts')
const advanced=load('src/shared/advancedContent.ts')
const template=load('src/shared/campaignContentTemplate.ts')
const tree=ts.createSourceFile('scheduler.ts',read('src/main/services/campaignScheduler.ts'),ts.ScriptTarget.Latest,true)
const cls=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='CampaignScheduler')
const names=['prepareSelectedCampaignContent','prepareFacebookCampaignContent','prepareZaloOutgoingContent','emailSendMessage',
  'renderZaloTemplate','renderZaloTemplateText','resolveCampaignMediaForIndex','resolveAdvancedCommentMedia',
  'isAdvancedContentEnabled','shouldUseAdvancedContent','shouldUseAdvancedCommentContent',
  'campaignUsesMainContent','campaignUsesMainMedia','campaignUsesMessageMedia','campaignUsesCommentIterations']
const methods=names.map(name=>cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(tree)===name).getText(tree)).join('\n')
let allocator=async()=>0,aiCalls=0,aiFailure=false
const globals={...core,...spin,...formatted,...advanced,...template,splitSharedContentVariants:spin.splitContentVariants,
  takeCampaignContentIndex:args=>allocator(args),isImageOrVideoMediaSource:()=>true,isImageMediaSource:()=>true,isVideoMediaSource:()=>true,
  getErrorMessage:e=>e?.message||String(e),callAiUsing:async(_code,{content})=>{aiCalls++;if(aiFailure)throw Error('AI failed');return {ok:true,content:'AI:'+content}},
  replaceStopMessagesLink:text=>text,ZALO_MESSAGE_OPT_OUT_ACTION_IDS:new Set()}
for(const statement of tree.statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)
  if(ts.isIdentifier(d.name)&&d.initializer&&ts.isStringLiteral(d.initializer))globals[d.name.text]=d.initializer.text
const Scheduler=new Function(...Object.keys(globals),`${transpile(`class Harness {${methods}}`)};return Harness`)(...Object.values(globals))
function harness() {
  const s=new Scheduler()
  Object.assign(s,{campaignContentPreparationRuns:new Set([1]),campaignContentMediaPaths:new Map(),activeV2Aborts:new Map(),
    campaignRunBoundaries:new Map([[1,{runtimeClaimToken:'claim'}]]),activeCampaignRunUnits:new Map([[1,{runtimeUnitToken:'unit'}]]),runtimeTarget:'desktop',
    isFormattedContentCampaign:c=>c.extraSettings.formattedContentEnabled===true,
    renderSpinContent:text=>spin.renderContentSpin(text,{rng:()=>0}),getPostActionCode:c=>c.actionId==='facebook_page_post'?'fb_post_page':null,
    getMessageActionCode:()=> 'fb_message_friend',hasDeclaredMediaSource:x=>!!x?.url,isCampaignMediaImageOrVideo:()=>true,
    resolveMediaSelection:async(items,option)=>option==='none'?[]:items.map(x=>x.url),logCampaignProgress:async()=>{},
    getTemplateBusinessNow:async()=>new Date('2026-10-06T00:00:00Z'),firstNormalizedVietnamMobilePhone:()=>'',throwIfZaloRuntimeStopping:()=>{}})
  return s
}
const variants=['A','B','C'].map((content,i)=>({id:String(i),content:content+' #{FULL_NAME}',emailSubject:'Subject '+content,mediaOption:'all',mediaItems:[{url:content+'.jpg'}]}))
const campaign={id:1,accountId:2,actionId:'facebook_page_post',extraSettings:{advancedContentEnabled:true,advancedContentItems:variants},content:'',images:[]}
async function main() {
  const s=harness(),account={id:2},data={id:11,name:'{An|Bình}'}
  let calls=0
  allocator=async args=>{calls++;assert.equal(args.inputDataId,11);assert.equal(args.actionCode,'fb_post_page');assert.equal(args.runtimeClaimToken,'claim');return 1}
  const result=await s.prepareFacebookCampaignContent(account,campaign,data,null,{rewriteCode:'page'}, {},[])
  assert.equal(result.content,'B {An|Bình}');assert.deepEqual(result.media,['B.jpg']);assert.equal(result.variantIndex,1);assert.equal(calls,1)
  aiCalls=0;aiFailure=true
  const aiCampaign={...campaign,extraSettings:{...campaign.extraSettings,rewriteContentEachRun:true}}
  assert.equal((await s.prepareFacebookCampaignContent(account,aiCampaign,data,null,{rewriteCode:'page'}, {},[])).content,'B {An|Bình}')
  assert.equal(aiCalls,1,'AI fallback returns already-rendered text without another spin')
  const html={...campaign,extraSettings:{...campaign.extraSettings,formattedContentEnabled:true,rewriteContentEachRun:true,
    advancedContentItems:variants.map(v=>({...v,content:'<p><b>'+v.content+'</b></p>'}))}}
  const rich=await s.prepareFacebookCampaignContent(account,html,{...data,name:'<An>'},null,{rewriteCode:'page',sourceText:'Source & text',sourceMedia:['source.jpg']},{},[])
  assert(rich.content.includes('&lt;An&gt;'));assert(rich.content.includes('Source &amp; text'));assert.deepEqual(rich.media,['B.jpg','source.jpg']);assert.equal(aiCalls,1,'rich content skips plain rewrite')
  // Post and comment AI switches must stay independent, including advanced seeding content.
  aiFailure=false
  for (const actionId of ['facebook_group_post','facebook_comment_seeding','facebook_comment_seeding_post']) {
    for (const [rewriteContentEachRun,rewriteCommentContentEachRun] of [[false,true],[true,false]]) {
      aiCalls=0
      const commentCampaign={...campaign,actionId,extraSettings:{
        commentContent:'Comment #{FULL_NAME}',commentImageOption:'none',rewriteContentEachRun,rewriteCommentContentEachRun,
        advancedContentEnabled:actionId!=='facebook_group_post',
        advancedContentItems:[{id:'comment',content:'Comment #{FULL_NAME}',mediaOption:'none',mediaItems:[]}]
      }}
      const comment=await s.prepareFacebookCampaignContent(account,commentCampaign,data,null,
        {kind:'comment',rewriteCode:'fb_comment_at_position_rewrite'}, {},[])
      assert.equal(aiCalls,rewriteCommentContentEachRun?1:0,actionId+': use the comment AI switch')
      assert.equal(comment.content,(rewriteCommentContentEachRun?'AI:':'')+'Comment {An|Bình}')
    }
  }
  for (const [rewriteContentEachRun,rewriteCommentContentEachRun] of [[false,true],[true,false]]) {
    aiCalls=0
    const postCampaign={...campaign,extraSettings:{...campaign.extraSettings,
      advancedContentItems:[variants[0]],rewriteContentEachRun,rewriteCommentContentEachRun}}
    const post=await s.prepareFacebookCampaignContent(account,postCampaign,data,null,{rewriteCode:'page'}, {},[])
    assert.equal(aiCalls,rewriteContentEachRun?1:0,'posts keep their own AI switch')
    assert.equal(post.content,(rewriteContentEachRun?'AI:':'')+'A {An|Bình}')
  }
  allocator=async()=>{throw Error('RPC failed')}
  await assert.rejects(()=>s.prepareFacebookCampaignContent(account,campaign,data,null,{}, {},[]),/RPC failed/)
  const abort=new AbortController();abort.abort();s.activeV2Aborts.set(1,abort)
  let took=false;allocator=async()=>{took=true;return 0}
  await assert.rejects(()=>s.prepareFacebookCampaignContent(account,campaign,data,null,{}, {},[]));assert.equal(took,false)
  s.activeV2Aborts.clear()
  // Subject/media follow the same advanced item, allocated after recipient check.
  let sends=0,recipient='not_found',rewrites=0;calls=0
  allocator=async args=>{calls++;assert.equal(args.actionCode,'email_send');return 2}
  s.emailRuntime={checkRecipientExists:async()=>({status:recipient}),sendEmail:async(_id,payload)=>{
    sends++;assert.equal(payload.subject,'Subject C');assert.equal(payload.body,'C ');assert.deepEqual(payload.attachments,['C.jpg']);return {messageId:'test'}}}
  s.rewriteEmailPlainTextBodyForRun=async(_account,_campaign,_options,body)=>{rewrites++;return body}
  const email={...campaign,actionId:'email_send'},options={to:'fixture@example.invalid',inputData:{id:11},subject:'stale',body:'stale'}
  await s.emailSendMessage(account,email,options);assert.equal(calls,0);assert.equal(sends,0)
  recipient='exists';await s.emailSendMessage(account,email,options);assert.equal(calls,1);assert.equal(sends,1);assert.equal(rewrites,1)
  // A singleton doesn't need ownership/cursor service; malformed responses fail closed.
  let rendered=0
  const base={variantCount:1,takeIndex:async()=>{throw Error('must not call')},variant:()=>({content:'one',media:[]}),prepare:v=>{rendered++;return v}}
  assert.equal((await core.prepareCampaignContent(base)).content,'one');assert.equal(rendered,1)
  await assert.rejects(()=>core.prepareCampaignContent({...base,variantCount:3,takeIndex:async()=>99}),/Invalid campaign content rotation/)
  // Execute migrated live block bodies in VM to check helper use and legacy fallback.
  const sql=read('migrations/migration_v351_campaign_content_blocks.sql')
  const bodies=[...sql.matchAll(/UPDATE public.auto_blocks SET code=\$content_v351\$([\s\S]*?)\$content_v351\$, updated_at=now\(\) WHERE id=(\d+);/g)]
  const byId=new Map(bodies.map(m=>[Number(m[2]),m[1]]))
  for(const [,code] of byId)new vm.Script(`(async()=>{${code}\n})()`)
  const invoke=async(id,helpers,vars={},page={})=>vm.runInNewContext(`(async()=>{${byId.get(id)}\n})()`,{
    helpers,vars,input:{},signal:new AbortController().signal,page,URL,console})
  const old=await invoke(2614,{log:()=>{}},{commentVariants:['legacy'],commentImageBatches:[['legacy.jpg']]})
  assert.equal(old.commentIterations[0].text,'legacy')
  const lazy=await invoke(2614,{log:()=>{},prepareCampaignContent:async()=>{throw Error('too early')}},{commentVariants:[''],commentImageBatches:[[]]})
  assert.equal(lazy.commentIterations.length,1,'empty scaffolding still reaches the consuming comment')
  const sourceResult=await invoke(2674,{prepareCampaignContent:async()=>{throw Error('too early')}})
  assert.deepEqual(JSON.parse(JSON.stringify(sourceResult)),{},'source rewrite is deferred to preparation')
  let allocated=0,gateAi=0
  const newsVars={newsfeedState:{currentPost:{readablePost:true,postContent:'fixture'},remainingComment:1,commentKind:'news',commentContent:'old',commentUseAI:true}}
  await invoke(2706,{log:()=>{},callAIUsing:async()=>{gateAi++;return {ok:true,content:'có'}},prepareCampaignContent:async()=>{allocated++;return {content:'selected',media:[],variantIndex:2}}},newsVars)
  assert.equal(allocated,1);assert.equal(gateAi,1,'only relevance AI remains in the block');assert.equal(newsVars.newsfeedState.commentText,'selected')
  await invoke(2706,{log:()=>{},callAIUsing:async()=>({ok:true,content:'không'}),prepareCampaignContent:async()=>{throw Error('must skip')}},newsVars)
  // Messenger prepares exactly once; fill/upload share the returned bundle.
  let messengerPrepared=0,legacyRewrite=0
  const sentActions=[]
  const browser={waitForSelector:async()=>false,click:async()=>{},getText:async()=>'',
    fill:async(_box,text)=>sentActions.push(['text',text]),dropFile:async(_box,files)=>sentActions.push(['media',files]),
    press:async()=>sentActions.push(['send'])}
  const browserHelpers={log:()=>{},sleep:async()=>{},element:async key=>key,callAIUsing:async()=>{legacyRewrite++;return {ok:true,content:'legacy AI'}}}
  const messenger=await invoke(38,{...browserHelpers,prepareCampaignContent:async()=>{
    messengerPrepared++;return {content:'selected',media:['selected.jpg'],variantIndex:1}
  }},{rewriteContentEachRun:true,campaignContent:'stale',images:['stale.jpg']},browser)
  assert.equal(messenger.ok,true);assert.equal(messengerPrepared,1);assert.equal(legacyRewrite,0)
  assert.deepEqual(sentActions,[['text','selected'],['media',['selected.jpg']],['send']])
  sentActions.length=0
  const rpcFailed=await invoke(38,{...browserHelpers,prepareCampaignContent:async()=>{throw Error('allocation failed')}},{campaignContent:'stale'},browser)
  assert.equal(rpcFailed.ok,false);assert.equal(sentActions.length,0,'allocation error cannot fall back and send stale content')
  await invoke(38,browserHelpers,{campaignContent:'legacy',images:[]},browser)
  assert.equal(sentActions[0][1],'legacy','old app still uses its original selected text')
  // Unmatched Page Inbox is skipped before allocation, matching other target gates.
  let inboxAllocations=0,typedInbox=false
  const inboxHelpers={...browserHelpers,prepareCampaignContent:async()=>{inboxAllocations++;return {content:'selected',media:[],variantIndex:0}}}
  const inboxPage={evaluate:async(_script,{action})=>{
    if(action==='searchState')return {inputFound:true,value:'',clearFound:false}
    if(action==='readText')return {ok:true,text:'Someone else'}
    if(action==='setMessageText')typedInbox=true
    return {ok:true,found:true}
  }}
  const wrong=await invoke(2679,inboxHelpers,{inputDataName:'Customer',inputDataUid:'123'},inboxPage)
  assert.equal(wrong.reason,'wrong_conversation');assert.equal(inboxAllocations,0);assert.equal(typedInbox,false)
  for(const file of ['campaignContentPreparation.ts','campaignContentTemplate.ts','contentSpin.ts']) {
    if(process.env.AKA_CHAT_REPO)assert.equal(read('src/shared/'+file),fs.readFileSync(path.join(process.env.AKA_CHAT_REPO,'packages/runtime-protocol/src',file),'utf8'),'cross-runtime shared source parity: '+file)
  }
  console.log('PASS: scheduler preparation/bundle, single spin/personalization/AI, fallback/cancel/RPC failure, Email gate/subject/media, migrated VM blocks, old helper fallback and shared-source parity')
}
main().catch(e=>{console.error(e);process.exitCode=1})
