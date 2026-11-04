const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{build}=require('esbuild'),{randomUUID}=require('node:crypto')
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'agent-smoke-'))
const configs=require('../migrations/snapshots/campaign-agent-v442/new-configs.json')
const f=global.__agent={outputs:[],calls:[],sectionCalls:[],groups:[],campaigns:[],deny:false,accounts:[11,12],tags:[{account_id:11,uid:'tag-1',name:'VIP'},{account_id:12,uid:'tag-2',name:'VIP'}],actions:[{id:'zalo_message_phone',flatform_type:'zalo',allow_multiple_accounts:true,limit_check_action_codes:['zalo_message_stranger','zalo_add_friend']},{id:'email_send',flatform_type:'email',allow_multiple_accounts:true,limit_check_action_codes:['email_send']}],configs}
async function main(){try{
 await build({stdin:{contents:`export * from './src/main/services/campaignAgentService';export * from './src/shared/campaignAgent';export * from './src/shared/campaignContentAi';export * from './src/shared/campaignAgentData';export * from './src/shared/campaignLimitsAi';export * from './src/renderer/src/components/CampaignPanels/campaignAgentPresentation';`,resolveDir:root},outfile:path.join(tmp,'m.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/\/(?:currentUser|supabaseClient|aiRepository|entitlementRepository|dataGroupRepository|aiRuntimeService|campaignAgentImages|campaign(?:Facebook|Schedule|Limits|Content|Exclusion)AiService)$/},a=>({path:a.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>{let source
 if(a.path.endsWith('currentUser'))source=`export const requireCurrentUser=()=>({staffId:7,organizationId:9})`
 else if(a.path.endsWith('supabaseClient'))source=`export const getSupabaseClient=()=>({from:(table)=>{const q={filters:[],select(){return q},eq(k,v){q.filters.push([k,v]);return q},in(k,v){q.filters.push([k,v]);return q},limit(){return q},abortSignal(){return q},then(resolve){global.__agent.calls.push({table,filters:q.filters});return Promise.resolve({data:table==='auto_campaign_actions'?global.__agent.actions:(table==='auto_campaigns'?global.__agent.campaigns:global.__agent.tags).filter(t=>q.filters.every(([k,v])=>!(k in t)||(Array.isArray(v)?v.includes(t[k]):v===t[k]))),error:null}).then(resolve)}};return q}})`
 else if(a.path.endsWith('aiRepository'))source=`export const getFormAiConfig=async(section)=>{const c=global.__agent.configs.find(c=>c.desktop_section_id===section);return{section,using:{code:c.code},model:{provider:'openai',endpoint:'https://api.openai.com/v1/responses'},prompt:{promptSystem:c.prompt_system},outputSchema:c.output_schema}}`
 else if(a.path.endsWith('entitlementRepository'))source=`export const loadCurrentUserEffectiveEntitlements=async()=>({});export const canUseCampaignActionWithEntitlements=()=>!global.__agent.deny;export const ensureCurrentUserCanUseCampaignAction=async()=>{if(global.__agent.deny)throw Error('denied')}`
 else if(a.path.endsWith('dataGroupRepository'))source=`export const listDataGroups=async()=>({groups:global.__agent.groups,total:global.__agent.groupTotal??global.__agent.groups.length})`
 else if(a.path.endsWith('aiRuntimeService'))source=`export const callAiUsing=async(code,variables,scope,{signal,imageInput})=>{signal.throwIfAborted();const call={code,context:JSON.parse(variables.agentContext),scope,imageInput,imageDataUrls:variables.imageDataUrls,systemPromptOverride:variables.systemPromptOverride};global.__agent.calls.push(call);const result=global.__agent.outputs.shift();return{ok:true,content:JSON.stringify(typeof result==='function'?result(call):result)}}`
 else if(a.path.endsWith('campaignAgentImages'))source=`export const agentImageUrls=async(_draftId,refs)=>refs.map(ref=>global.__agent.imageDataUrls[ref.id])`
 else source=`const run=async(request)=>{global.__agent.sectionCalls.push(request);return global.__agent.sectionResults?.[request.kind||('accountId' in (request.context||{})?'exclusions':'other')]||global.__agent.sectionResult||{ok:true,patch:request.kind==='general'?{accountIds:[12]}:request.limits?{actions:[]}: {}}};export const generateCampaignFacebook=run;export const generateCampaignSchedule=run;export const generateCampaignLimits=run;export const generateCampaignContent=run;export const generateCampaignExclusion=run;export const loadFacebookAiCatalog=async()=>({accounts:global.__agent.accounts.map(id=>({id,name:'Account '+id}))})`
 return{contents:source,loader:'js'}})
 }}]})
 const m=require(path.join(tmp,'m.cjs')),signal=()=>new AbortController().signal
 const request=()=>({requestId:randomUUID(),sessionId:randomUUID(),draftId:randomUUID(),revision:2,description:'Yêu cầu',section:null,images:[],dataFiles:[{id:randomUUID(),name:'data.txt',kind:'text',bytes:100}],history:[],snapshot:{actionId:'zalo_message_phone',availableActionIds:f.actions.map(a=>a.id),accountIds:[11],sections:['general','options','data','limits','cooldown'],lockedFields:[],directDataEditable:true,form:{enableMessage:true,enableAddFriend:false,recentDeliveryCooldownEnabled:false,recentDeliveryCooldownDays:3},facebook:{general:{kind:'general',actionId:'zalo_message_phone',current:{name:'Giữ nguyên',accountIds:[11],runAsPage:false,runAsPageUid:''},lockedFields:[],eligibleAccountIds:[11,12],singleAccountOnly:false,secondaryAccountId:null}},limits:{context:{actionId:'zalo_message_phone',dataTargetSourceMode:'direct',accountGroupOverrides:false},limits:{sleepBetweenActions:10,continueWhenActionLimitReached:false,postsPerTarget:3,actions:['zalo_message_stranger','zalo_add_friend'].map(actionCode=>({actionCode,label:actionCode,unit:'lượt',dailyLimit:30,rateLimitCount:9,rateLimitMinutes:65}))}}}})
 const plan=(sections,more={})=>({status:'ok',message:'',extractedText:'',actionId:'zalo_message_phone',tasks:sections.map(section=>({section,description:'Yêu cầu cho '+section})),...more})
 const extra=(more={})=>({status:'ok',reason:'',fields:[],rows:[],dataMode:null,dataGroupId:null,directSource:false,tags:[],sourceTagIds:null,sourceTagMode:null,campaignLinks:[],...more})
 const run=(r=request())=>m.generateCampaignAgent(m.validateAgentRequest(r),signal())
 // Hidden lookup quotas never reach either model, even from an older renderer snapshot.
 const internalLimits=request()
 internalLimits.snapshot.limits.limits.actions.push({actionCode:'zalo_find_phone_user',label:'Tìm SĐT',unit:'SĐT',dailyLimit:1000,rateLimitCount:1000,rateLimitMinutes:65})
 const safeLimits=m.validateAgentRequest(internalLimits)
 assert(!safeLimits.snapshot.limits.limits.actions.some(a=>a.actionCode==='zalo_find_phone_user'))
 f.outputs=[call=>{assert(!call.context.current.limits.actions.some(a=>a.actionCode==='zalo_find_phone_user'));return plan(['limits'])}]
 await run(internalLimits)
 const limitCall=f.sectionCalls.findLast(call=>call.limits)
 assert(!limitCall.limits.actions.some(a=>a.actionCode==='zalo_find_phone_user'))
 const hiddenPatch={status:'ok',reason:'',changes:{sleepBetweenActions:null,continueWhenActionLimitReached:null,postsPerTarget:null,actions:[{actionCode:'zalo_find_phone_user',dailyLimit:50,rateLimitCount:null,rateLimitMinutes:null}]}}
 assert.equal(m.parseLimitsAiResponse(JSON.stringify(hiddenPatch),{...safeLimits.snapshot.limits,requestId:internalLimits.requestId,description:'Đổi giới hạn'}).code,'unsupported')
 const limitValues={dailyLimit:30,rateLimitCount:9,rateLimitMinutes:65}
 const limitChange={key:'formData.actionLimitsByCode',label:'Hạn mức theo hành động',section:'limits',before:{zalo_add_friend:limitValues,zalo_find_phone_user:{...limitValues,dailyLimit:1000}},after:{zalo_add_friend:{...limitValues,dailyLimit:50},zalo_find_phone_user:{...limitValues,dailyLimit:10}}}
 const readable=m.agentChangeRows(limitChange)
 assert.equal(readable.length,1);assert.equal(readable[0].label,'Kết bạn · Giới hạn trong ngày')
 assert.equal(readable[0].beforeText,'30 lời mời/ngày');assert.equal(readable[0].afterText,'50 lời mời/ngày')
 const visibleText=readable.map(r=>[r.label,r.beforeText,r.afterText].join(' ')).join(' ')
 assert(!/zalo_|dailyLimit|rateLimit|SĐT/.test(visibleText))
 assert.equal(m.agentChangeRows({...limitChange,before:{},after:{zalo_find_phone_user:limitValues}}).length,0)
 const newLimits=m.agentChangeRows({...limitChange,before:undefined,after:{zalo_add_friend:limitValues,zalo_message_stranger:limitValues,zalo_find_phone_user:limitValues}})
 assert.equal(newLimits.length,4);assert(newLimits.some(r=>r.afterText==='9 tin nhắn trong 65 phút'))
 const inheritedChange={...limitChange,before:{zalo_add_friend:limitValues},after:{zalo_add_friend:{...limitValues,rateLimitCount:7}},
   limitWindows:{before:{zalo_add_friend:[75,90]},after:{zalo_add_friend:[75,90]}}}
 const inherited=m.agentChangeRows(inheritedChange)
 assert.equal(inherited.length,1);assert.equal(inherited[0].afterText,'7 lời mời trong 75/90 phút (tùy tài khoản)')
 assert.equal(inheritedChange.after.zalo_add_friend.rateLimitMinutes,65,'display metadata must not change raw values used by undo')
 const displayDraft={version:1,turns:[{id:randomUUID(),role:'assistant',text:'Đã điền',changes:[inheritedChange]}]}
 assert(m.isAgentDraft(displayDraft),'effective window metadata survives draft validation')
 assert(!m.isAgentDraft({...displayDraft,turns:[{...displayDraft.turns[0],changes:[{...inheritedChange,limitWindows:{before:{},after:{zalo_add_friend:['invalid']}}}]}]}))
 const generic=m.agentChangeRows({key:'formData.zaloFriendTargetMode',label:'Nguồn bạn bè',section:'options',before:'selected',after:'tagged_friends'})
 assert.equal(generic[0].afterText,'Bạn bè theo tag')
 const structured=m.agentChangeRows({key:'config',label:'Thiết lập',section:'general',before:{privateKey:'old'},after:{privateKey:'new'}})
 assert(!JSON.stringify(structured).includes('privateKey'))
 // Local source metadata only; no recipient rows, OCR, or image bytes reach either model call.
 const recipients=Array.from({length:120},(_,i)=>({name:'Khách '+i,phone:String(901000000+i).padStart(10,'0'),uid:'',email:''}))
 const sourceOcr=recipients.map(row=>row.phone).join('\n')
 const rawData=request();rawData.description='Thêm danh sách\n'+sourceOcr
 rawData.history=[{role:'user',text:sourceOcr}]
 rawData.snapshot.data={mode:'direct',groupName:'',count:120,pendingGroupCount:0,rows:recipients}
 const dataRequest=m.validateAgentRequest(rawData)
 assert.equal(dataRequest.snapshot.data.rows.length,0);assert(!JSON.stringify(dataRequest).includes(recipients[0].phone))
 const split=m.splitAgentDataMessage('Gửi tin lúc 20h ngày 2026-11-02\n'+sourceOcr)
 assert.equal(split.data,sourceOcr);assert(split.description.includes('2026-11-02'))
 const bulk=Array.from({length:10000},(_,i)=>String(903000000+i).padStart(10,'0')).join('\n')
 const splitBulk=m.splitAgentDataMessage('Nhập danh sách\n'+bulk)
 assert.equal(splitBulk.data,bulk);assert.equal(splitBulk.description,'Nhập danh sách')
 assert.equal(m.agentDataSafeText('Nhập danh sách\n'+bulk),m.agentDataSafeText('Nhập danh sách\n'+sourceOcr),'AI input must not grow with row count')
 assert.equal(m.splitAgentDataMessage('https://facebook.com/groups/123456789').description,'https://facebook.com/groups/123456789')
 assert.equal(m.splitAgentDataMessage('Gửi tới test@example.com').data,'test@example.com')
 assert.equal(m.splitAgentDataMessage('Fullname\tMobile\nNguyễn An\t0901234567').data,'Fullname\tMobile\nNguyễn An\t0901234567')
 // Excel clipboard records can span several lines inside quoted TSV cells.
 for(const tsv of [
   'Tên\tSĐT\tInfo1\nAn\t0901234567\t"Ghi chú\nkhách VIP"\nBình\t0987654321\tOK',
   'Tên\tSĐT\tInfo1\n\nAn\t0901234567\t"Ghi chú\n\nNội dung: khách VIP\n0908888888"\nBình\t0987654321\tOK',
   'Tên\tSĐT\tInfo1\n"An\tNguyễn\nVăn"\t0901234567\t"Mã ""00017"""\nBình\t0987654321\tOK',
   'An\t0901234567\t"Ghi chú\nkhách VIP"',
   'Tên\tSĐT\tInfo1\nAn\t0901234567\tOK\nBình\t0987654321\t"Ghi chú\nkhách VIP"'
 ]) {
   assert.deepEqual(m.splitAgentDataMessage(tsv),{description:'',data:tsv},'quoted TSV records stay intact')
   assert.equal(m.isAgentCsvData(tsv),false,'TSV keeps the existing TXT/table importer')
   const description='Nhập danh sách:\nTên chiến dịch: Chăm sóc TSV',source='Nhập danh sách:\n'+tsv+'\nTên chiến dịch: Chăm sóc TSV'
   assert.deepEqual(m.splitAgentDataMessage(source),{description,data:tsv})
   assert.deepEqual(m.splitAgentDataMessage('Nội dung:\n'+tsv),{description:'Nội dung:\n'+tsv,data:''})
   assert.deepEqual(m.splitAgentDataMessage(tsv,true),{description:tsv,data:''})
   const r={...request(),description:source,history:[{role:'user',text:source}]}
   f.outputs=[call=>{
     const context=JSON.stringify(call.context)
     for(const local of ['0901234567','0987654321','0908888888','khách VIP'])assert(!context.includes(local),'TSV rows and multiline notes stay out of AI')
     assert(call.context.description.includes(description));assert(call.context.history[0].text.includes(description))
     return plan([])
   }]
   assert.equal((await run(r)).ok,true)
 }
 for(const csv of ['Tên,SĐT\nNguyễn An,0901234567\nBình,0987654321',
   'Tên;SĐT;Info1\n"An; Nguyễn";0901234567;"Ghi chú\nqua hai dòng"\nBình;0987654321;"Mã ""00017"""',
   'Fullname,Email\n"An, Nguyễn",an@example.com\nBình,binh@example.com',
   'An,0901234567\nBình,0987654321',
   'Tên,SĐT\nAn,0901234567\n\nBình,0987654321',
   'Tên;SĐT\n\nAn;0901234567',
   'An,0901234567\n  \nBình,0987654321',
   'Tên,SĐT,Info1\nAn,0901234567,"Dòng 1\n\nDòng 2"\n,,\n""\nBình,0987654321,00018',
   'Tên,SĐT\nAn,không hợp lệ\nBình,0987654321',
   'Tên,SĐT\nAn,0901234567\nĐạt Nguyễn,0987654321',
   'Tên,SĐT\nĐạt Nguyễn,0901234567\n\nBình,0987654321',
   'Đạt Nguyễn,0901234567\nBình,0987654321',
   'SĐT;Tên;Info1\n0901234567;Đạt Nguyễn;Gửi tin lúc 20h\n0987654321;Bình;Không gửi trùng',
   'Fullname,Email\nĐạt Nguyễn,an@example.com\nBình,binh@example.com',
   'Tên,UID\nĐạt Nguyễn,123456789012345\nBình,987654321012345']) {
   assert.deepEqual(m.splitAgentDataMessage(csv),{description:'',data:csv})
   assert.equal(m.isAgentCsvData(csv),true)
   const mixed='Nhập danh sách:\n'+csv+'\nNội dung: Liên hệ 0909999999'
   const separated=m.splitAgentDataMessage(mixed)
   assert.equal(separated.data,csv);assert.equal(separated.description,'Nhập danh sách:\nNội dung: Liên hệ 0909999999')
   const r={...request(),description:mixed,history:[{role:'user',text:csv}]}
   f.outputs=[call=>{assert(!JSON.stringify(call.context).includes('0987654321'));assert(!JSON.stringify(call.context).includes('an@example.com'));assert(call.context.description.includes('0909999999'));return plan([])}]
   assert.equal((await run(r)).ok,true)
   assert.deepEqual(m.splitAgentDataMessage('Viết nội dung:\n'+csv),{description:'Viết nội dung:\n'+csv,data:''})
 }
 const csvBulk='Tên,SĐT\n'+bulk.split('\n').map((phone,index)=>`Khách ${index},${phone}`).join('\n')
 assert.equal(m.splitAgentDataMessage(csvBulk).data,csvBulk)
 assert.equal(m.agentDataSafeText(csvBulk),m.agentDataSafeText('Tên,SĐT\nAn,0901234567\nBình,0987654321'))
 assert.equal(m.isAgentCsvData('0901234567\n0987654321'),false)
 assert.deepEqual(m.splitAgentDataMessage('Tên,SĐT\nAn,0901234567\nBình,0987654321\nChạy lúc 20h, nghỉ 30 giây'),
   {description:'Chạy lúc 20h, nghỉ 30 giây',data:'Tên,SĐT\nAn,0901234567\nBình,0987654321'})
 for(const separator of [',',';'])for(const prefix of ['', 'Nhập danh sách:\n'])for(const tail of [
   `Vào 20h tối nay${separator} gửi tin và kết bạn`,
   `Lúc 20h${separator} tài khoản Zalo chính`,
   `Sau đó${separator} hãy đặt tên chiến dịch Chăm sóc`,
   `20h tối nay${separator} gửi tin và kết bạn`,
   `Đặt số lượng bài đăng${separator} 3`,
   'Tên chiến dịch: Chăm sóc khách hàng tháng 11',
   'Tên chiến dịch là Chăm sóc',
   `Tên chiến dịch: Chăm sóc${separator} tháng 11`,
   'Email subject: Cảm ơn bạn',
   `Vào 20h tối nay${separator} nội dung: Liên hệ 0909999999`
 ]) {
   const csv=`Tên${separator}SĐT\nĐạt Nguyễn${separator}0901234567\n\nBình${separator}0987654321`
   const source=prefix+csv+'\n'+tail,description=(prefix+tail).trim()
   assert.deepEqual(m.splitAgentDataMessage(source),{description,data:csv})
   assert.equal(m.agentDataSafeText(description),description)
   const r={...request(),description:source,history:[{role:'user',text:source}]}
   f.outputs=[call=>{const context=JSON.stringify(call.context);assert(!context.includes('0901234567'));assert(!context.includes('0987654321'));assert(call.context.description.includes(tail));assert(call.context.history[0].text.includes(tail));return plan([])}]
   assert.equal((await run(r)).ok,true)
 }
 for(const header of ['SĐT','Số điện thoại','Mobile','Email']) {
   const source=header+'\n'+(header==='Email'?'an@example.com\nbinh@example.com':'0901234567\n0987654321')
   assert.deepEqual(m.splitAgentDataMessage(source),{description:'',data:source},'standalone recognized headers stay with data')
 }
 for(const text of ['Tên chiến dịch: Chăm sóc khách hàng tháng 11','Email subject: Cảm ơn bạn','Phone dùng trong nội dung: 0909999999']) {
   const csv='Tên,SĐT\nAn,0901234567\nBình,0987654321'
   for(const source of [csv+'\n'+text,text+'\n'+csv])assert.deepEqual(m.splitAgentDataMessage(source),{description:text,data:csv})
   assert.deepEqual(m.splitAgentDataMessage(text),{description:text,data:''})
 }
 assert.deepEqual(m.splitAgentDataMessage('Liên hệ An, SĐT 0901234567\nLiên hệ Bình, SĐT 0987654321'),
   {description:'Liên hệ An, SĐT 0901234567\nLiên hệ Bình, SĐT 0987654321',data:''})
 // Contact information in copy/names must survive renderer, main and history sanitizers.
 for(const prompt of ['Viết nội dung: Liên hệ 0901234567 để được tư vấn.',
   'Hãy viết email: liên hệ sales@example.com để nhận báo giá.',
   'Viet noi dung: lien he 0901234567 hoac sales@example.com.',
   'Đặt tên chiến dịch Chăm sóc 20261103',
   'Nội dung:\n0901234567\nsales@example.com\nhttps://example.com',
   'Viết nội dung quảng cáo\nHotline: 0901234567\nEmail: sales@example.com']) {
   assert.deepEqual(m.splitAgentDataMessage(prompt),{description:prompt,data:''})
   assert.equal(m.agentDataSafeText(m.agentDataSafeText(prompt)),prompt)
   const r={...request(),description:prompt,dataFiles:[],history:[{role:'user',text:prompt}]}
   f.outputs=[call=>{assert.equal(call.context.description,prompt);assert.equal(call.context.history[0].text,prompt);return plan([])}]
   assert.equal((await run(r)).ok,true)
 }
 const mixed=m.splitAgentDataMessage('Gửi tới 0901234567,0987654321 nội dung: Liên hệ 0909999999')
 assert.equal(mixed.data,'0901234567\n0987654321');assert(mixed.description.endsWith('nội dung: Liên hệ 0909999999'))
 for(const prompt of ['Thêm danh sách 0901234567 với nội dung: Liên hệ 0909999999',
   'Gửi tới 0901234567 nội dung:\n0909999999']) {
   const split=m.splitAgentDataMessage(prompt)
   assert.equal(split.data,'0901234567');assert(split.description.includes('0909999999'))
   assert.equal(m.agentDataSafeText(m.agentDataSafeText(split.description)),split.description)
 }
 const twoBlocks=m.splitAgentDataMessage('Nội dung: Liên hệ 0909999999\nNhập danh sách:\n0901234567\n0987654321')
 assert.equal(twoBlocks.data,'0901234567\n0987654321');assert(twoBlocks.description.includes('0909999999'))
 assert.deepEqual(m.splitAgentDataMessage('0901234567',true),{description:'0901234567',data:''})
 const contentOnly={...request(),section:'content',description:'0901234567',dataFiles:[]}
 f.outputs=[call=>{assert.equal(call.context.description,'0901234567');return plan([])}]
 assert.equal((await run(contentOnly)).ok,true)
 assert(!m.validAgentDataFiles([{id:randomUUID(),kind:'image',name:'big.png',bytes:6*1024*1024}]))
 assert(!m.validAgentDataFiles([{id:randomUUID(),kind:'text',name:'big.txt',bytes:11*1024*1024}]))
 for(const stage of ['router','data'])assert.equal(m.agentDataSafeText(sourceOcr).includes(recipients[0].phone),false,stage)
 f.outputs=[call=>{
   assert(!JSON.stringify(call).includes(recipients[0].phone));assert.deepEqual(call.imageDataUrls,[])
   assert.equal(call.context.dataFiles.length,1);return plan(['data'])
 },call=>{
   assert(!('sourceContext'in call.context));assert(!JSON.stringify(call).includes(recipients[0].phone));assert.deepEqual(call.imageDataUrls,[])
   return extra({dataMode:'append'})
 }]
 const importReply=await run(dataRequest);assert.equal(importReply.patch.entries[0].patch.importMode,'append');assert.deepEqual(importReply.patch.entries[0].patch.rows,[])
 f.outputs=[plan(['data']),extra({rows:[recipients[0]],dataMode:'append'})];assert.equal((await run(dataRequest)).code,'unsupported','AI must never generate recipient data')
 const lockedDataRequest=structuredClone(dataRequest);lockedDataRequest.snapshot.directDataEditable=false
 f.outputs=[plan(['data']),extra({dataMode:'append'})];assert.equal((await run(lockedDataRequest)).code,'unclear')
 f.outputs=[plan(['data']),extra({fields:[{key:'enableMessage',value:false}]})];await assert.rejects(()=>run(dataRequest))
 // Pending group snapshots materialize only on save and must not survive a purported full replace.
 const pendingGroupRequest=request()
 pendingGroupRequest.snapshot.data={mode:'direct',groupName:'',count:1,pendingGroupCount:2,rows:[recipients[0]]}
 pendingGroupRequest.snapshot.lockedFields=['dataGroupId']
 for(const pendingGroupCount of [undefined,null,-1,0.5,Number.MAX_SAFE_INTEGER+1]) {
   const invalid=structuredClone(pendingGroupRequest);invalid.snapshot.data.pendingGroupCount=pendingGroupCount
   assert.throws(()=>m.validateAgentRequest(invalid),'pending group count must be an explicit nonnegative safe integer')
 }
 f.outputs=[call=>{
   assert.equal(call.context.current.data.pendingGroupCount,2)
   return plan(['general','data'],{extractedText:sourceOcr})
 },call=>{
   assert.equal(call.context.currentData.pendingGroupCount,2)
   return extra({dataMode:'replace'})
 }]
 const blockedReplace=await run(pendingGroupRequest)
 assert.equal(blockedReplace.code,'unclear');assert.equal(blockedReplace.message,m.AGENT_PENDING_GROUP_REPLACE_MESSAGE)
 assert(!blockedReplace.patch,'no earlier General patch may escape when Data replacement is blocked')
 assert.equal(blockedReplace.extractedText,'')
 for(const mode of ['count-only','lock-only']) {
   const guarded=structuredClone(pendingGroupRequest)
   if(mode==='count-only')guarded.snapshot.lockedFields=[]
   else delete guarded.snapshot.data
   f.outputs=[plan(['data']),extra({dataMode:'replace'})]
   assert.equal((await run(guarded)).code,'unclear')
 }
 f.outputs=[plan(['data']),extra({dataMode:'append'})]
 assert.equal((await run(pendingGroupRequest)).patch.entries[0].patch.importMode,'append','adding rows preserves pending groups')
 const clearedGroups=structuredClone(pendingGroupRequest);clearedGroups.snapshot.data.pendingGroupCount=0;clearedGroups.snapshot.lockedFields=[]
 f.outputs=[plan(['data']),extra({dataMode:'replace'})]
 assert.equal((await run(clearedGroups)).patch.entries[0].patch.importMode,'replace','replace is available after the user removes pending groups')
 // Group mode hides, but does not remove, retained direct-source groups.
 const dormantGroups=structuredClone(pendingGroupRequest);dormantGroups.snapshot.data.mode='data_group';dormantGroups.snapshot.lockedFields=[]
 for(const change of [
   {dataMode:'replace'},
   {dataMode:'append'},
   {directSource:true}
 ]) {
   f.outputs=[call=>{
     assert.equal(call.context.current.data.pendingGroupCount,2)
     assert.equal(call.context.current.data.mode,'data_group')
     return plan(['general','data'],{extractedText:sourceOcr})
   },call=>{
     assert.equal(call.context.currentData.pendingGroupCount,2)
     return extra(change)
   }]
   const blocked=await run(dormantGroups)
   assert.equal(blocked.code,'unclear');assert.equal(blocked.message,m.AGENT_PENDING_GROUP_REPLACE_MESSAGE)
   assert(!blocked.patch);assert.equal(blocked.extractedText,'')
   const noDormantGroups=structuredClone(dormantGroups);noDormantGroups.snapshot.data.pendingGroupCount=0
   f.outputs=[plan(['data']),extra(change)]
   assert.equal((await run(noDormantGroups)).ok,true,'switching to direct is allowed when no retained groups can reappear')
 }
 f.groups=[{id:7,name:'Nhóm chạy mới'}]
 f.outputs=[plan(['data']),extra({dataGroupId:7})]
 assert.equal((await run(dormantGroups)).patch.entries[0].patch.dataGroup.id,7,'switching between running groups keeps retained direct sources dormant')
 f.groups=[]
 f.calls=[];f.sectionCalls=[]
 const blank=request();blank.snapshot={...blank.snapshot,actionId:'',accountIds:[],form:{},facebook:{},sections:['general'],directDataEditable:false};delete blank.snapshot.limits
 f.outputs=[plan(['general'],{actionId:'zalo_message_phone'})]
 const selected=await run(blank);assert(selected.ok);assert.equal(selected.patch.actionId,'zalo_message_phone');assert.deepEqual(selected.patch.entries,[])
 assert.deepEqual(f.calls.find(c=>c.code).imageInput,{maxImages:5},'Agent opts into the validated five-image provider path')
 assert.equal(f.sectionCalls.length,0,'blank form routes first, before any action-specific section runs')
 assert.throws(()=>m.validateAgentRequest({...blank,snapshot:{...blank.snapshot,limits:{...request().snapshot.limits,context:{...request().snapshot.limits.context,actionId:''}}}}),'invalid action-specific contexts still fail closed')
 f.calls=[]
 assert.throws(()=>m.validateAgentRequest({...request(),draftId:'../private'}))
 assert.throws(()=>m.validateAgentRequest({...request(),section:'arbitrary'}))
 const historyText='a'.repeat(m.AGENT_MAX_TURN_TEXT)+'\n'+'b'.repeat(m.AGENT_MAX_EXTRACTED_TEXT)
 assert.equal(historyText.length,m.AGENT_MAX_HISTORY_TEXT)
 assert.equal(m.validateAgentRequest({...request(),history:[{role:'assistant',text:historyText}]}).history[0].text.length,4000)
 assert.throws(()=>m.validateAgentRequest({...request(),history:[{role:'assistant',text:historyText+'!'}]}))
 assert.throws(()=>m.validateAgentRequest({...request(),history:Array.from({length:m.AGENT_MAX_HISTORY_TURNS+1},()=>({role:'user',text:'x'}))}))
 const fullOcr='x'.repeat(m.AGENT_MAX_EXTRACTED_TEXT-10)+'0987654321'
 f.outputs=[plan([],{status:'unclear',message:'Chọn tài khoản nào?',actionId:null,extractedText:fullOcr})]
 assert.equal((await run()).extractedText,'')
 f.outputs=[plan([],{status:'unclear',message:'Chọn tài khoản nào?',actionId:null,extractedText:fullOcr+'!'})];await assert.rejects(run)
 const ocrTurn={id:randomUUID(),role:'assistant',text:'a'.repeat(m.AGENT_MAX_TURN_TEXT),extractedText:fullOcr}
 assert(m.isAgentDraft({version:1,turns:[ocrTurn]}));assert(!m.isAgentDraft({version:1,turns:[{...ocrTurn,extractedText:fullOcr+'!'}]}))
 let r=request();r.snapshot.form.apiKey='secret';assert(!('apiKey'in m.validateAgentRequest(r).snapshot.form))
 f.outputs=[plan(['limits','options','general']),extra({fields:[{key:'enableAddFriend',value:true}],tags:[{accountId:12,tagId:'tag-2'}]})]
 let result=await run();assert(result.ok);assert.deepEqual(result.patch.entries.map(e=>e.section),['general','options','limits'])
 assert.equal(f.sectionCalls.at(-1).limits.actions.length,2,'option dependency enables friend quota in same turn')
 assert.deepEqual(f.calls.find(c=>c.context?.section==='options').context.tags.map(t=>t.accountId),[12])
 f.outputs=[plan(['data']),extra({rows:[{name:'An',uid:'',phone:'+84901234567',email:''}],dataMode:'append'})]
 result=await run();assert.equal(result.code,'unsupported')
 f.outputs=[plan(['data']),extra({rows:[{name:'Fake',uid:'123',phone:'',email:''}],dataMode:'append'})];assert.equal((await run()).code,'unsupported')
 f.outputs=[plan(['options']),extra({fields:[{key:'sourceLinks',value:'not allowed'}]})];await assert.rejects(run)
 f.outputs=[plan(['options']),extra({tags:[{accountId:99,tagId:'tag-1'}]})];await assert.rejects(run)
 r=request();r.snapshot.lockedFields=['enableAddFriend'];f.outputs=[plan(['options']),extra({fields:[{key:'enableAddFriend',value:true}]})];await assert.rejects(()=>run(r))
 r=request();r.section='cooldown';f.outputs=[plan(['options'])];await assert.rejects(()=>run(r))
 r=request();r.snapshot.accountIds=[99];f.outputs=[plan(['options'])];await assert.rejects(()=>run(r))
 f.outputs=[plan([],{actionId:'email_send'})];result=await run();assert(result.ok&&result.patch.actionId==='email_send'&&result.patch.entries.length===0)
 f.outputs=[plan([],{status:'unclear',message:'Chọn tài khoản nào?',actionId:null,extractedText:'Nội dung ảnh'})];result=await run();assert.equal(result.code,'unclear');assert.equal(result.extractedText,'')
 f.outputs=[plan(['options','data'],{extractedText:'0901234567 từ ảnh'}),extra({fields:[{key:'enableAddFriend',value:true}]}),extra({status:'unclear',reason:'Chọn nhóm nào?'})];result=await run();assert(!result.ok&&!result.patch,'no partial result when later section asks clarification')
 assert.equal(result.extractedText,'')
 f.outputs=[plan(['general'],{extractedText:'Khách An: 0901234567'})];f.sectionResult={ok:false,code:'unclear',message:'Chọn tài khoản nào?'}
 result=await run();assert.equal(result.code,'unclear');assert.equal(result.extractedText,'');assert(!result.patch)
 delete f.sectionResult
 f.outputs=[plan(['data']),extra({dataGroupId:99})];await assert.rejects(run)
 f.groups=[{id:7,name:'Nhóm hợp lệ'}];f.outputs=[plan(['data']),extra({dataGroupId:7})];result=await run();assert.equal(result.patch.entries[0].patch.dataGroup.id,7)
 f.groups=[{id:7,name:'Nhóm khác tài khoản',boundZaloAccountId:12}];f.outputs=[plan(['data']),extra({dataGroupId:7})];assert.equal((await run()).code,'unclear');f.groups=[]
 f.actions.push({id:'facebook_find_data_search',flatform_type:'facebook',allow_multiple_accounts:true,limit_check_action_codes:[]},{id:'facebook_page_post',flatform_type:'facebook',allow_multiple_accounts:true,limit_check_action_codes:[]},{id:'zalo_message_friend',flatform_type:'zalo',allow_multiple_accounts:true,limit_check_action_codes:[]})
 const forAction=id=>{const r=request();r.snapshot.actionId=id;r.snapshot.facebook.general.actionId=id;r.snapshot.limits.context.actionId=id;r.snapshot.sections.push('extras');if(id==='zalo_message_friend')r.snapshot.sourceTagSelection={accountId:11,tagIds:[]};return r}
 // Capabilities must follow preceding Options without losing independent editing locks.
 f.actions.push({id:'facebook_message_uid',flatform_type:'facebook',allow_multiple_accounts:true,limit_check_action_codes:[]})
 const uidRow={name:'Khách mới',uid:'123456789012345',phone:'',email:''}
 for(const [actionId,key,automatic,manual] of [
   ['zalo_message_friend','zaloFriendTargetMode','all_friends','selected'],
   ['zalo_message_friend','zaloFriendTargetMode','tagged_friends','selected'],
   ['facebook_message_uid','useSuggestedFriends',true,false]
 ]) {
   const source=forAction(actionId);source.snapshot.form[key]=automatic
   source.snapshot.data={mode:'direct',groupName:'',count:0,pendingGroupCount:0,rows:[]}
   const sourcePlan=()=>plan(['data','options'],{actionId,extractedText:'UID từ ảnh'})
   f.outputs=[sourcePlan(),extra({fields:[{key,value:manual}]}),call=>{
     assert.equal(call.context.directDataAllowed,true);assert.equal(call.context.current[key],manual)
     return extra({dataMode:'append'})
   }]
   const allowed=await run(source);assert(allowed.ok);assert.equal(allowed.patch.entries[1].patch.importMode,'append')
   source.snapshot.directDataEditable=false
   f.outputs=[sourcePlan(),extra({fields:[{key,value:manual}]}),extra({dataMode:'append'})]
   assert.equal((await run(source)).code,'unclear','changing an option must not unlock a hard-locked input list')
   source.snapshot.directDataEditable=true;source.snapshot.form[key]=manual
   f.outputs=[sourcePlan(),extra({fields:[{key,value:automatic}]}),call=>{
     assert.equal(call.context.directDataAllowed,false);return extra({dataMode:'append'})
   }]
   const conflict=await run(source);assert.equal(conflict.code,'unclear');assert(!conflict.patch);assert.equal(conflict.extractedText,'')
   source.snapshot.form[key]=automatic;f.groups=[{id:7,name:'Nhóm chạy'}]
   f.outputs=[plan(['data'],{actionId}),extra({dataGroupId:7})]
   assert((await run(source)).ok,'choosing a group may replace the previous automatic source')
   f.outputs=[sourcePlan(),extra({fields:[{key,value:automatic}]}),extra({dataGroupId:7})]
   assert.equal((await run(source)).code,'unclear','explicit automatic and group sources conflict')
   f.groups=[]
 }
 // Dormant values from another action must not disable the current content editor.
 const dormantContentFlags={enableMessage:false,copyContentFromSource:true,sharePost:true,groupPostShareFromPost:true,zaloMessageSendMode:'share'}
 for(const actionId of ['email_send','sms_send','voice_call']) assert.equal(m.agentContentEnabled(actionId,dormantContentFlags),true,actionId)
 assert.equal(m.agentContentEnabled('facebook_timeline_post',{enableMessage:false,zaloMessageSendMode:'share'}),true)
 assert.equal(m.agentContentEnabled('zalo_message_phone',{...dormantContentFlags,enableMessage:true}),true)
 for(const [actionId,key,value] of [
   ['facebook_message_uid','enableMessage',false],['zalo_message_phone','enableMessage',false],
   ['facebook_timeline_post','copyContentFromSource',true],['facebook_timeline_post','sharePost',true],
   ['facebook_group_post','groupPostShareFromPost',true],['zalo_message_friend','zaloMessageSendMode','share'],
   ['zalo_message_group','zaloMessageSendMode','share']
 ]) assert.equal(m.agentContentEnabled(actionId,{[key]:value}),false,`${actionId}/${key} remains an active blocker`)
 assert.deepEqual(dormantContentFlags,{enableMessage:false,copyContentFromSource:true,sharePost:true,groupPostShareFromPost:true,zaloMessageSendMode:'share'},'checking availability does not clear values needed for undo')
 // Hidden editable content becomes available after enabling messages or disabling sharing.
 for(const mode of ['message-off','share']) {
   const source=forAction(mode==='share'?'zalo_message_friend':'zalo_message_phone')
   source.snapshot.sections.push('content')
   source.snapshot.form={...source.snapshot.form,enableMessage:mode!=='message-off',zaloMessageSendMode:mode==='share'?'share':'normal',zaloFriendTargetMode:'selected'}
   source.snapshot.content={context:{actionId:source.snapshot.actionId,mode:'advanced',format:'plain'},items:[{content:'Bản cũ',emailSubject:null}]}
   const key=mode==='share'?'zaloMessageSendMode':'enableMessage',value=mode==='share'?'normal':true
   f.sectionResults={other:{ok:true,patch:{edits:[{index:0,content:'Bản mới',emailSubject:null}],additions:[]}}}
   f.outputs=[plan(['content','options'],{actionId:source.snapshot.actionId}),extra({fields:[{key,value}]})]
   assert((await run(source)).ok)
   f.outputs=[plan(['content'],{actionId:source.snapshot.actionId,extractedText:'Giữ OCR'})]
   const blocked=await run(source);assert.equal(blocked.code,'unclear');assert.equal(blocked.extractedText,'');assert(!blocked.patch)
   delete f.sectionResults
 }
 // Content AI limits must not become campaign-wide limits or truncate valid form data.
 for(const [items,tooLarge] of [
   [Array.from({length:100},()=>({content:'Biến thể',emailSubject:null})),false],
   [Array.from({length:101},()=>({content:'Biến thể',emailSubject:null})),true],
   [[{content:'x'.repeat(16000),emailSubject:null}],false],
   [[{content:'x'.repeat(16001),emailSubject:null}],true],
   [Array.from({length:5},()=>({content:'x'.repeat(15000),emailSubject:null})),true],
   [[{content:'Thư',emailSubject:'x'.repeat(501)}],true]
 ]) {
   assert.equal(m.exceedsContentAiInputLimits(items),tooLarge)
   const source=forAction('email_send');source.snapshot.sections.push('content')
   source.snapshot.content={context:{actionId:'email_send',mode:'advanced',format:'plain'},items}
   if(tooLarge)assert.throws(()=>m.validateAgentRequest(source),'raw oversized content still fails closed')
   else assert.deepEqual(m.validateAgentRequest(source).snapshot.content.items,items)
 }
 const oversized=request();oversized.snapshot.sections.push('content')
 oversized.snapshot.contentUnavailable={reason:'size',context:{actionId:oversized.snapshot.actionId,mode:'advanced',format:'plain'}}
 for(const scope of [null,'general','limits']) {
   oversized.section=scope;const kind=scope||'general'
   f.outputs=[call=>{
     assert.equal(call.context.current.content,undefined)
     assert.deepEqual(call.context.current.contentUnavailable,oversized.snapshot.contentUnavailable)
     assert(call.systemPromptOverride.includes('không coi đó là nội dung rỗng'))
     return plan([kind])
   }]
   const independent=await run(oversized);assert(independent.ok);assert.deepEqual(independent.patch.entries.map(e=>e.section),[kind])
 }
 oversized.section='content';f.outputs=[];f.sectionCalls=[]
 const scopedOversized=await run(oversized);assert.equal(scopedOversized.message,m.AGENT_CONTENT_SIZE_MESSAGE);assert.equal(scopedOversized.code,'unsupported')
 assert.equal(f.sectionCalls.length,0,'scoped oversized content never invokes a section model')
 oversized.section=null;f.outputs=[plan(['general','content'],{extractedText:'Giữ nội dung ảnh'})]
 const mixedOversized=await run(oversized);assert.equal(mixedOversized.code,'unsupported');assert.equal(mixedOversized.extractedText,'');assert(!mixedOversized.patch)
 assert(!f.sectionCalls.some(c=>c.context?.mode),'no partial content call or patch for an oversized request')
 for(const change of [
   {contentUnavailable:{...oversized.snapshot.contentUnavailable,reason:'unknown'}},
   {contentUnavailable:{...oversized.snapshot.contentUnavailable,items:[]}},
   {contentUnavailable:{reason:'size',context:{actionId:'email_send',mode:'advanced',format:'plain'}}},
   {contentUnavailable:{reason:'size',context:{actionId:oversized.snapshot.actionId,mode:'bad',format:'plain'}}},
   {content:{context:oversized.snapshot.contentUnavailable.context,items:[{content:'x',emailSubject:null}]}},
   {sections:['general']}
 ]) assert.throws(()=>m.validateAgentRequest({...oversized,snapshot:{...oversized.snapshot,...change}}),'content capability marker is strictly validated')
 const oversizedRich=forAction('facebook_page_post');oversizedRich.snapshot.sections.push('content')
 oversizedRich.snapshot.form={pagePostMode:'ui',postWithBackground:false}
 oversizedRich.snapshot.contentUnavailable={reason:'size',context:{actionId:'facebook_page_post',mode:'advanced',format:'html'}}
 f.outputs=[plan(['extras'],{actionId:'facebook_page_post'}),extra({fields:[{key:'postWithBackground',value:true}]})]
 assert.equal((await run(oversizedRich)).code,'unsupported','omitting oversized text must preserve format-dependent guards')
 const firstAccount=request();firstAccount.snapshot.accountIds=[];firstAccount.snapshot.facebook.general.current.accountIds=[]
 firstAccount.snapshot.form.enableMessage=false;firstAccount.snapshot.sections.push('exclusions')
 f.sectionResults={exclusions:{ok:true,patch:{name:'Nhóm mới',matchMode:'or',rules:[]}}}
 f.outputs=[plan(['exclusions','options','general']),extra({fields:[{key:'enableMessage',value:true}]})]
 const firstExclusion=await run(firstAccount);assert(firstExclusion.ok);assert.equal(firstExclusion.patch.entries.find(e=>e.section==='exclusions').accountId,12)
 const ambiguous=request();ambiguous.snapshot.sections.push('exclusions');ambiguous.snapshot.facebook.general.secondaryAccountId=12
 f.outputs=[plan(['exclusions'],{extractedText:'Nội dung ảnh'})]
 const asked=await run(ambiguous);assert.equal(asked.code,'unclear');assert(!asked.patch);assert.equal(asked.extractedText,'')
 delete f.sectionResults
 r=forAction('facebook_find_data_search');r.snapshot.facebook.search={kind:'search',actionId:r.snapshot.actionId,current:{isFindUid:true},lockedFields:[],eligibleAccountIds:[],singleAccountOnly:false,secondaryAccountId:null}
 f.campaigns=[{id:81,name:'Nhận UID',action_id:'facebook_message_uid',staff_id:7,organization_id:9,is_delete:false},{id:82,name:'Khác staff',action_id:'facebook_message_uid',staff_id:8,organization_id:9,is_delete:false}]
 f.outputs=[plan(['data'],{actionId:r.snapshot.actionId}),extra({campaignLinks:[{key:'findUidTargetCampaignIds',ids:[81]}]})]
 result=await run(r);assert.deepEqual(result.patch.entries[0].patch.campaignLinks,{findUidTargetCampaignIds:[81]})
 f.outputs=[plan(['data'],{actionId:r.snapshot.actionId}),extra({campaignLinks:[{key:'findUidTargetCampaignIds',ids:[82]}]})];await assert.rejects(()=>run(r))
 r=forAction('facebook_page_post');f.outputs=[plan(['extras'],{actionId:r.snapshot.actionId}),extra({fields:[{key:'pagePostMode',value:'api'},{key:'postWithBackground',value:true}]})];assert.equal((await run(r)).code,'unsupported')
 r=forAction('zalo_message_friend');f.outputs=[plan(['options'],{actionId:r.snapshot.actionId}),extra({sourceTagIds:['tag-1'],sourceTagMode:'replace',fields:[{key:'zaloFriendTargetMode',value:'tagged_friends'}]})]
 result=await run(r);assert.equal(result.patch.entries[0].patch.sourceTags[0].accountId,11)
 // A single turn binds exclusion drafts to the account validated after General.
 r=request();r.snapshot.sections.push('exclusions');r.snapshot.exclusions={context:{actionId:r.snapshot.actionId,accountId:11,enableMessage:true}}
 f.sectionResults={exclusions:{ok:true,patch:{name:'Không gửi bạn bè',matchMode:'or',rules:[]}}}
 f.outputs=[plan(['exclusions','general'])];result=await run(r)
 assert.equal(f.sectionCalls.at(-1).context.accountId,12)
 assert.equal(result.patch.entries.find(e=>e.section==='exclusions').accountId,12)
 delete f.sectionResults
 // Tag operations use the real selected IDs, including selections made outside chat.
 f.tags.push({account_id:11,uid:'tag-3',name:'Khách cũ'})
 const tagRequest=()=>{const r=forAction('zalo_message_friend');r.snapshot.sourceTagSelection={accountId:11,tagIds:['tag-1']};return r}
 const tagOutput=(mode,tagIds)=>{f.outputs=[plan(['options'],{actionId:'zalo_message_friend'}),extra({sourceTagMode:mode,sourceTagIds:tagIds})]}
 const tagIds=result=>result.patch.entries.at(-1).patch.sourceTags.map(t=>t.tagId)
 tagOutput('append',['tag-3','tag-3']);result=await run(tagRequest());assert.deepEqual(tagIds(result),['tag-1','tag-3'])
 let tagContext=f.calls.findLast(c=>c.context?.section==='options').context
 assert.deepEqual(tagContext.currentSourceTags,[{accountId:11,tagId:'tag-1',name:'VIP'}]);assert.equal(tagContext.sourceTagSelectionComplete,true)
 r=tagRequest();r.snapshot.sourceTagSelection.tagIds=['tag-1','tag-3'];tagOutput('remove',['tag-1']);assert.deepEqual(tagIds(await run(r)),['tag-3'])
 tagOutput('replace',['tag-3']);assert.deepEqual(tagIds(await run(tagRequest())),['tag-3'])
 tagOutput('replace',[]);assert.deepEqual(tagIds(await run(tagRequest())),[])
 tagOutput(null,['tag-3']);await assert.rejects(()=>run(tagRequest()))
 tagOutput('append',null);await assert.rejects(()=>run(tagRequest()))
 tagOutput('append',['other-account-tag']);await assert.rejects(()=>run(tagRequest()))
 r=tagRequest();r.snapshot.sourceTagSelection.accountId=12;assert.throws(()=>m.validateAgentRequest(r))
 r=tagRequest();delete r.snapshot.sourceTagSelection;assert.throws(()=>m.validateAgentRequest(r))
 r=tagRequest();r.snapshot.sourceTagSelection.tagIds=['removed-tag'];tagOutput('append',['tag-3']);assert.equal((await run(r)).code,'unclear')
 tagContext=f.calls.findLast(c=>c.context?.section==='options').context
 assert.deepEqual(tagContext.currentSourceTags,[]);assert.equal(tagContext.sourceTagSelectionComplete,false)
 tagOutput('replace',['tag-3']);assert.deepEqual(tagIds(await run(r)),['tag-3'])
 f.outputs=[plan(['general','options'],{actionId:'zalo_message_friend'}),extra({sourceTagMode:'append',sourceTagIds:['tag-2']})]
 result=await run(tagRequest());assert.deepEqual(tagIds(result),['tag-2']);assert.equal(result.patch.entries.at(-1).patch.sourceTags[0].accountId,12)
 assert.deepEqual(f.calls.findLast(c=>c.context?.section==='options').context.currentSourceTags,[],'never carry source tags across account changes')
 r=request();r.snapshot.accountIds=[];r.snapshot.facebook.general.current.accountIds=[]
 f.outputs=[plan(['options']),extra({fields:[{key:'enableAddFriend',value:true}]})]
 assert.equal((await run(r)).patch.entries[0].patch.fields.enableAddFriend,true,'scalar options still work before an account has been selected')
 f.deny=true;await assert.rejects(run);f.deny=false
 const ac=new AbortController();ac.abort();await assert.rejects(()=>m.generateCampaignAgent(m.validateAgentRequest(request()),ac.signal))
 const change={key:'formData.name',label:'Tên',section:'general',before:'a',after:'b',revision:1},turn={id:randomUUID(),role:'assistant',text:'',changes:[change]}
 assert(m.canUndoAgentTurn(turn,()=> 'b',()=>1));assert(!m.canUndoAgentTurn(turn,()=> 'b',()=>2));assert(!m.canUndoAgentTurn(turn,()=> 'c',()=>1))
 assert(m.isAgentDraft({version:1,turns:[turn]}));assert(!m.isAgentDraft({version:1,turns:[{id:'broken'}]}))
 // Shared content-typing optimization is now authorized in both forms; keep Agent behavior isolated.
 const regularForm=fs.readFileSync(path.join(root,'src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx'),'utf8')
 assert(!/useCampaignAgent|CampaignAgentChat|generateCampaignAgent/.test(regularForm),'regular form must not gain Agent chat/controller behavior')
 const panel=fs.readFileSync(path.join(root,'src/renderer/src/components/CampaignPanels/CampaignPanel.tsx'),'utf8');assert(panel.includes('isAgentDraft(campaignDrafts.draft.payload.values.agentChat) ? CampaignAgentFormModal : CampaignFormModal'));assert(panel.includes('{showForm && (\n          <CampaignFormModal'))
 for(const c of configs)assert.deepEqual(c.output_schema,c.desktop_section_id.endsWith('router')?m.AGENT_ROUTER_SCHEMA:m.AGENT_EXTRA_SCHEMA)
 console.log('PASS Agent: readable change rows + hidden quota guards, oversized content capability + atomic rejection + format guards, schema/allowlists, scoped catalogs, action-scoped content blockers, prospective Data/content/exclusion dependencies, hard locks and conflicting sources, exclusion account binding, source-tag append/remove/replace and stale/cross-account guards, atomic clarification, legacy draft compatibility, local-import metadata with no rows/images/OCR sent to AI, draft/undo, independent forms and unchanged routes, migration schema parity')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}}
main().catch(e=>{console.error(e);process.exitCode=1})
