const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { buildSync } = require('esbuild'), root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facebook-ai-test-'))
try {
  buildSync({ stdin:{contents:`export * from './src/shared/campaignFacebookAi'; export * from './src/shared/campaignFormAiConfig'; export * from './src/main/services/formAiSchema';`, resolveDir:root}, outfile:path.join(tmp,'m.cjs'), bundle:true, platform:'node', logLevel:'silent' })
  const m = require(path.join(tmp,'m.cjs')), configs = require('../migrations/snapshots/facebook-form-ai-v425/configs.json')
  let checks=0
  const request = (kind, current={}, actionId=m.facebookAiActions(kind)[0]) => ({ requestId:'12345678-1234-1234-1234-123456789012',description:'Điền theo yêu cầu',kind,actionId,current,lockedFields:[],eligibleAccountIds:[11,12],singleAccountOnly:false,secondaryAccountId:null })
  const response=(kind,patch={},status='ok')=>JSON.stringify({status,reason:'',changes:{...Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS[kind]).map(k=>[k,null])),...patch}})
  const parse=(r,p,c)=>m.parseFacebookAiResponse(response(r.kind,p),r,c)
  const check=(v,expected=true)=>{assert.equal(v.ok,expected,JSON.stringify(v));checks++}
  for(const config of configs){
    const r=request(config.kind)
    assert.deepEqual(m.validateFacebookAiRequest({...r,model_id:99,prompt:'ignore scope'}),r);checks++
    assert.deepEqual(config.output_schema,m.facebookAiSchema(config.kind));checks++
    const validate=m.compileFormAiSchema(config.output_schema,config.desktop_section_id)
    assert.equal(validate(response(config.kind)),true);checks++
    assert.throws(()=>m.compileFormAiSchema({...config.output_schema,additionalProperties:true},config.desktop_section_id));checks++
    check(parse(r,{unexpected:true}),false)
    check(m.parseFacebookAiResponse(response(config.kind,{},'unclear'),r),false)
    const metadata=m.formAiAvailability([{desktop_section_id:config.desktop_section_id,campaign_scope:'selected',campaign_action_ids:config.campaign_action_ids}], 'desktop')
    assert.equal(m.formAiAvailable(metadata,config.desktop_section_id,config.campaign_action_ids[0]),true);checks++
    assert.equal(m.formAiAvailable(metadata,config.desktop_section_id,'zalo_message_friend'),false);checks++
  }
  const general=request('general',{accountIds:[11],runAsPage:false,runAsPageUid:'',name:'Keep'})
  const catalog={platform:'facebook',allowPageIdentity:true,accounts:[{id:11,name:'A'},{id:12,name:'B'}],pages:[{accountId:12,uid:'page-b',name:'Page B'}],allowMultipleAccounts:true,hasSecondaryAccount:false,secondaryAccount:null}
  check(parse(general,{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},catalog))
  assert.equal(parse(general,{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},catalog).patch.runAsPageName,'Page B');checks++
  check(parse(general,{accountIds:[999]},catalog),false)
  check(parse(general,{accountIds:[11],runAsPage:true,runAsPageUid:'page-b'},catalog),false)
  check(parse(general,{accountIds:[11,12],runAsPage:true,runAsPageUid:'page-b'},catalog),false)
  check(parse(general,{accountIds:[11,12]},{...catalog,allowMultipleAccounts:false}),false)
  check(parse({...general,singleAccountOnly:true},{accountIds:[11,12]},catalog),false)
  check(parse({...general,singleAccountOnly:true},{accountIds:[12]},catalog))
  check(parse({...general,singleAccountOnly:true},{name:'Tên mới'},catalog))
  // Page-only restriction can be removed explicitly; editing/secondary restrictions cannot.
  const fromPage={...general,current:{...general.current,accountIds:[12],runAsPage:true,runAsPageUid:'page-b'}}
  check(parse(fromPage,{runAsPage:false,accountIds:[11,12]},catalog))
  check(parse({...fromPage,singleAccountOnly:true},{runAsPage:false,accountIds:[11,12]},catalog),false)
  for(const value of [undefined,null,'false',0]) {assert.throws(()=>m.validateFacebookAiRequest({...general,singleAccountOnly:value}));checks++}
  for(const value of [undefined,0,-1,1.5,'12',{},Number.MAX_SAFE_INTEGER+1]) {assert.throws(()=>m.validateFacebookAiRequest({...general,secondaryAccountId:value}));checks++}
  const withSecondary=m.validateFacebookAiRequest({...general,secondaryAccountId:12})
  assert.equal(withSecondary.secondaryAccountId,12);checks++
  // Reject the entire response, including an otherwise valid name edit.
  const conflict=parse(withSecondary,{name:'Must not apply',accountIds:[12]},catalog)
  check(conflict,false);assert.equal(conflict.code,'unsupported');assert.equal(conflict.patch,undefined);checks+=2
  check(parse(withSecondary,{accountIds:[11]},catalog))
  check(parse(withSecondary,{name:'Keep secondary'},catalog))
  check(parse(withSecondary,{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},catalog),false)
  check(parse({...general,secondaryAccountId:13},{accountIds:[11,12]},catalog),false)
  check(parse({...general,secondaryAccountId:13},{accountIds:[12]},catalog))
  // A valid Page on a different primary must not remove the secondary account.
  for(const current of [general.current,{...general.current,accountIds:[12]},fromPage.current]) {
    for(const pagePatch of [{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'}, {runAsPage:true,runAsPageUid:'page-b'}]) {
      const rejected=parse({...general,current,secondaryAccountId:13},{name:'Must not apply',...pagePatch},catalog)
      check(rejected,false);assert.equal(rejected.code,'unsupported');assert.equal(rejected.message,m.FACEBOOK_AI_MESSAGES.pageSecondaryAccountConflict);assert.equal(rejected.patch,undefined);checks+=3
    }
  }
  check(parse({...fromPage,secondaryAccountId:13},{runAsPageUid:'page-b'},catalog),false)
  check(parse({...fromPage,secondaryAccountId:13},{runAsPage:false},catalog))
  check(parse({...fromPage,secondaryAccountId:13},{name:'Keep secondary'},catalog))
  check(parse({...general,secondaryAccountId:null},{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},catalog))
  check(parse({...general,lockedFields:['accountIds']},{accountIds:[12]},catalog),false)
  check(parse({...general,actionId:'facebook_timeline_post'},{runAsPage:true,runAsPageUid:'page-b'},catalog),false)
  check(parse(general,{name:''},catalog),false)
  check(parse(general,{name:'Chiến dịch mới'},catalog))
  const search=request('search',{isFindPhone:true,isFindInPost:true,isFindInComment:false,findDataGoalModeEnabled:false},'facebook_find_data_search')
  check(parse(search,{isFindInComment:true,countCommentFindData:30,isFindCommentByKeywords:true,commentKeywords:'cần mua'}))
  check(parse(search,{isFindInGroupMembers:true}),false)
  check(parse(search,{countPostFindData:30}),false)
  check(parse(search,{countSearchPostFindData:-1}),false)
  check(parse(search,{countSearchPostFindData:1.5}),false)
  check(parse(search,{isFindPhone:false}),false)
  check(parse({...search,lockedFields:['isFindPhone']},{isFindPhone:false,isFindInPost:false}),false)
  check(parse(search,{findDataGoalModeEnabled:true,findDataGoalPriority:'facebook_uid',findDataGoalDailyLimit:20}),false)
  check(parse(search,{findDataGoalModeEnabled:true,findDataGoalPriority:'phone',findDataGoalDailyLimit:20}))
  check(parse(search,{isFindFacebookGroup:true,countSearchGroupFindData:20,minSearchGroupMembers:1000}))
  check(parse(search,{countSearchGroupFindData:20}),false)
  check(parse(search,{sortTypeComment:'newest'}),false)
  check(parse(search,{isFindPostLink:true,isFindInPost:false}),false)
  const group=request('search',{isFindUid:true,isFindInPost:true,isFindNewInteractors:true},'facebook_find_data_group')
  check(parse(group,{sortTypeComment:'newest'}))
  check(parse(group,{sortTypeComment:'all_comments'}),false)
  check(parse(group,{searchPostRecentOnly:true}),false)
  const newOnly=request('search',{isFindUid:true,isFindInPost:false,isFindInComment:false,isFindNewInteractors:true},'facebook_find_data_group')
  check(parse(newOnly,{countCommentFindData:30,sortTypeComment:'newest'}))
  for(const patch of [{isFindCommentByKeywords:true,commentKeywords:'cần mua'}, {isFindCommentByContentAI:true,commentContentAI:'đang cần mua nhà'},
    {commentKeywords:'cần mua'}, {commentContentAI:'cần mua'}, {countCommentFindData:30,isFindCommentByKeywords:true,commentKeywords:'cần mua'}]) check(parse(newOnly,patch),false)
  check(parse(newOnly,{isFindInComment:true,isFindCommentByKeywords:true,commentKeywords:'cần mua'}))
  check(parse({...newOnly,current:{...newOnly.current,isFindInComment:true}},{isFindCommentByContentAI:true,commentContentAI:'cần mua'}))
  check(parse({...newOnly,current:{...newOnly.current,isFindInComment:true}},{isFindInComment:false,isFindCommentByKeywords:true,commentKeywords:'cần mua'}),false)
  for(const bad of [[],['same','same'],['comma, split'],['line\nbreak'],['a'.repeat(301)],[''],Array.from({length:501},(_,i)=>String(i))])check(parse(request('keywords'),{keywords:bad}),false)
  check(parse(request('keywords'),{keywords:['cần mua nhà','mua căn hộ']}))
  check(parse(request('postSearch'),{commentPostSort:'new_posts',isFindPostByKeywords:true,postKeywords:'tuyển dụng'}))
  check(parse(request('newsfeed'),{newsfeedCheckMessageRequests:true}),false)
  check(parse(request('newsfeed'),{enablePostLike:true,newsfeedLikeLimit:5,newsfeedTimeMinutes:10}))
  check(parse(request('groupComment'),{enableComment:true,commentType:'others',commentGroupMode:'pending_only',commentCount:3,commentContent:'Xin chào | Chào bạn'}))
  for(const kind of ['search','keywords','postSearch','newsfeed','groupComment']) {
    assert.throws(()=>m.validateFacebookAiRequest({...request(kind),actionId:'zalo_message_friend'}));checks++
  }
  for(const [actionId,platform] of [['zalo_message_phone','zalo'],['email_send','email'],['sms_send','sms'],['voice_call','sms']]) {
    const r=m.validateFacebookAiRequest({...general,actionId}),c={...catalog,platform,allowPageIdentity:false,pages:[]}
    check(parse(r,{name:'Tên mới',accountIds:[12]},c))
    for(const patch of [{runAsPage:true,runAsPageUid:'page-b'},{runAsPage:false},{runAsPageUid:''}])check(parse(r,patch,c),false)
    assert.equal(m.campaignSectionAiSupportsAction('general',actionId),true);checks++
  }
  check(parse(general,{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},{...catalog,platform:'zalo'}),false)
  check(parse(general,{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},{...catalog,allowPageIdentity:false}),false)
  for(const actionId of ['', ' ', 'a'.repeat(101)]){assert.throws(()=>m.validateFacebookAiRequest({...general,actionId}));checks++}
  const broken=m.facebookAiSchema('keywords');broken.properties.changes.properties.keywords.items.type='number'
  assert.throws(()=>m.compileFormAiSchema(broken,m.FACEBOOK_AI_SECTIONS.keywords));checks++
  console.log(`PASS ${checks} Facebook AI checks: schemas, seed parity, scope, protected fields, accounts/Page ownership, bounds and search dependencies`)
} finally {fs.rmSync(tmp,{recursive:true,force:true})}
