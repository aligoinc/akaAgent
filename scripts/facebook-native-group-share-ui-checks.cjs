const assert=require('node:assert/strict')
module.exports=async page=>{
 await page.waitForFunction(()=>!!window.scheduleSmoke)
 const campaign={name:'Chia sẻ nhóm kiểm thử',actionId:'facebook_group_post',accountId:11,status:'tạm dừng',
  content:'Nội dung đăng thường cần giữ',schedule:'2035-01-01T02:00:00Z',scheduleType:'daily',
  images:[{id:1,url:'https://example.test/old.png',type:'image'}],extraSettings:{
   groupPostShareFromPost:true,sourceLinks:'https://www.facebook.com/author/posts/123',groupPostShareCaption:'Caption cũ',
   imageOption:'all',postWithBackground:true,includeSourceImages:true,rewriteSourceContentWithAI:true,sourceContentAiPrompt:'',
   autoJoinGroupAfterPost:true,enableGroupPostShareToJoinedGroups:true,enableComment:true,enablePostBump:true,postBumpContent:'',
   advancedContentEnabled:true,advancedContentSource:'manual',advancedContentItems:[{id:'one',content:'Nâng cao cần giữ',mediaOption:'none',mediaItems:[]}]
  }}
 const open=async c=>{await page.evaluate(c=>{window.scheduleSmoke.state.calls=[];window.scheduleSmoke.state.alerts=[];window.scheduleSmoke.openCampaign(c)},c);await page.getByRole('button',{name:'Nội dung từ bài viết nguồn',exact:true}).click()}
 const checkbox=page.getByLabel('Đăng bài bằng cách chia sẻ bài viết từ Facebook cá nhân/fanpage',{exact:true})
 const source=page.getByPlaceholder('https://www.facebook.com/xyz/posts/12345',{exact:true})
 const caption=page.getByLabel('Nội dung kèm bài chia sẻ (không bắt buộc)',{exact:true})
 const hiddenOptions=async()=>{
  for(const label of [/Tự động THAM GIA GROUP/,/mỗi lần đăng thì chia sẻ thêm cho 3 nhóm/,'Kiêm comment','Kiêm up tin']) {
   assert.equal(await page.getByLabel(label,{exact:typeof label==='string'}).count(),0,`hidden: ${label}`)
  }
  for(const title of ['Kiêm comment','Kiêm up tin']) {
   assert.equal(await page.locator('.stepper-section-title, .stepper-step-title').getByText(title,{exact:true}).count(),0)
   assert.equal(await page.getByText(title,{exact:true}).count(),0,'no orphan section/sidebar title')
  }
 }
 const restoredOptions=async()=>{
  for(const label of [/Tự động THAM GIA GROUP/,/mỗi lần đăng thì chia sẻ thêm cho 3 nhóm/,'Kiêm comment','Kiêm up tin']) {
   const option=page.getByLabel(label,{exact:typeof label==='string'})
   assert(await option.isEnabled());assert(await option.isChecked(),`retained: ${label}`)
  }
  for(const title of ['Kiêm comment','Kiêm up tin']) {
   assert.equal(await page.locator('.stepper-section-title').filter({hasText:title}).count(),1)
   assert.equal(await page.locator('.stepper-step-title').filter({hasText:title}).count(),1)
  }
 }
 await open(campaign)
 assert(await checkbox.isChecked());assert.equal(await caption.inputValue(),'Caption cũ')
 await hiddenOptions()
 await caption.fill('Caption mới')
 await source.fill('https://www.facebook.com/author')
 await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click()
 await page.waitForFunction(()=>window.scheduleSmoke.state.alerts.length>0)
 assert.match((await page.evaluate(()=>window.scheduleSmoke.state.alerts.at(-1))).message,/link bài viết Facebook cụ thể/)
 assert.equal(await page.evaluate(()=>window.scheduleSmoke.state.calls.filter(c=>c.method==='createCampaign').length),0)
 await source.fill(campaign.extraSettings.sourceLinks)
 await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click()
 await page.waitForFunction(()=>window.scheduleSmoke.state.calls.some(c=>c.method==='createCampaign'))
 const saved=await page.evaluate(()=>window.scheduleSmoke.state.calls.find(c=>c.method==='createCampaign').args[0])
 assert.equal(saved.extraSettings.groupPostShareFromPost,true)
 assert.equal(saved.extraSettings.copyContentFromSource,false)
 assert.equal(saved.extraSettings.groupPostShareCaption,'Caption mới')
 assert.equal(saved.content,campaign.content)
 assert.deepEqual(saved.images,campaign.images)
 assert.equal(saved.extraSettings.imageOption,'all')
 assert.equal(saved.extraSettings.postWithBackground,true)
 assert.equal(saved.extraSettings.advancedContentEnabled,true)
 assert.equal(saved.extraSettings.advancedContentItems[0].content,'Nâng cao cần giữ')
 assert.equal(saved.extraSettings.autoJoinGroupAfterPost,true)
 assert.equal(saved.extraSettings.enableGroupPostShareToJoinedGroups,true)
 assert.equal(saved.extraSettings.enableComment,true)
 assert.equal(saved.extraSettings.enablePostBump,true)
 await open({...campaign,...saved,id:undefined})
 assert.equal(await caption.inputValue(),'Caption mới')
 await hiddenOptions()
 await checkbox.uncheck()
 assert.equal(await caption.count(),0)
 await restoredOptions()
 await checkbox.check()
 await hiddenOptions()
 assert.equal(await caption.inputValue(),'Caption mới')
 await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
 await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft)
 const draft=await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft)
 assert.equal(draft.payload.values.formData.groupPostShareFromPost,true)
 await page.evaluate(d=>window.scheduleSmoke.openDraft(d),draft)
 await page.getByRole('button',{name:'Nội dung từ bài viết nguồn',exact:true}).click()
 assert(await checkbox.isChecked());assert.equal(await caption.inputValue(),'Caption mới')
 await hiddenOptions()
 await checkbox.uncheck()
 await restoredOptions()
 await checkbox.check()
 const snapshot={...campaign,content:'Nội dung snapshot đang dùng',extraSettings:{...campaign.extraSettings,
  advancedContentSource:'group_snapshot',advancedContentGroupSnapshot:{groupId:31,groupName:'Nhóm mẫu',templateCount:1,itemCount:1,channel:'facebook_post',capturedAt:'2026-10-23T00:00:00Z'},
  advancedContentItems:[{id:'snapshot',content:'Snapshot',mediaOption:'none',mediaItems:[]}],
  advancedContentManualDraft:{content:'Nháp riêng',advancedContentItems:[{id:'draft',content:'Draft',mediaOption:'none',mediaItems:[]}],formattedContentEnabled:false,rewriteContentEachRun:false}
 }}
 await open(snapshot)
 await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click()
 await page.waitForFunction(()=>window.scheduleSmoke.state.calls.some(c=>c.method==='createCampaign'))
 const savedSnapshot=await page.evaluate(()=>window.scheduleSmoke.state.calls.find(c=>c.method==='createCampaign').args[0])
 assert.equal(savedSnapshot.content,snapshot.content)
 assert.deepEqual(savedSnapshot.extraSettings.advancedContentItems,snapshot.extraSettings.advancedContentItems)
 assert.deepEqual(savedSnapshot.extraSettings.advancedContentGroupSnapshot,snapshot.extraSettings.advancedContentGroupSnapshot)
 assert.equal(savedSnapshot.extraSettings.advancedContentManualDraft.content,'Nháp riêng')
 const save=async()=>{
  await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleSmoke.state.calls.some(c=>c.method==='createCampaign')||window.scheduleSmoke.state.alerts.length)
  assert.equal(await page.evaluate(()=>window.scheduleSmoke.state.calls.some(c=>c.method==='createCampaign')),true,
   JSON.stringify(await page.evaluate(()=>window.scheduleSmoke.state.alerts)))
  return page.evaluate(()=>window.scheduleSmoke.state.calls.find(c=>c.method==='createCampaign').args[0])
 }
 const ordinaryExtras={...campaign.extraSettings,groupPostShareFromPost:false,postWithBackground:false,imageOption:'none',
  enableComment:false,enablePostBump:false,enableGroupPostShareToJoinedGroups:false}
 for(const advanced of [false,true]){
  const rich={...campaign,images:[],content:'<p><strong>Bold original</strong></p>',extraSettings:{...ordinaryExtras,
   formattedContentEnabled:true,advancedContentEnabled:advanced,
   advancedContentItems:[{id:'rich',content:'<p><em>Rich variant</em></p>',mediaOption:'none',mediaItems:[]}]}}
  await open(rich)
  await checkbox.check()
  const savedRich=await save()
  assert.equal(savedRich.extraSettings.formattedContentEnabled,true,'native save retains the manual rich-text flag')
  assert.equal(savedRich.content,rich.content)
  assert.equal(savedRich.extraSettings.advancedContentItems[0].content,rich.extraSettings.advancedContentItems[0].content)
  await open({...rich,...savedRich,id:undefined})
  await checkbox.uncheck()
  await page.getByRole('button',{name:advanced?'Nâng cao':'Cơ bản',exact:true}).click()
  const ordinary=await save()
  assert.equal(ordinary.extraSettings.groupPostShareFromPost,false)
  assert.equal(ordinary.extraSettings.formattedContentEnabled,true,'ordinary posting still uses rich text after reopening')
  assert.equal(ordinary.extraSettings.advancedContentEnabled,advanced)
 }
 for(const mode of ['Nâng cao','Cơ bản']){
  await open({...snapshot,images:[],extraSettings:{...snapshot.extraSettings,...ordinaryExtras,
   advancedContentSource:'group_snapshot',advancedContentGroupSnapshot:snapshot.extraSettings.advancedContentGroupSnapshot,
   advancedContentItems:snapshot.extraSettings.advancedContentItems,
   advancedContentManualDraft:{...snapshot.extraSettings.advancedContentManualDraft,formattedContentEnabled:true,
    content:'<p><strong>Manual draft</strong></p>',advancedContentItems:[{id:'draft',content:'<p><em>Manual variant</em></p>',mediaOption:'none',mediaItems:[]}]}}})
  await page.getByRole('button',{name:mode,exact:true}).click()
  await page.getByRole('button',{name:'Nội dung từ bài viết nguồn',exact:true}).click()
  await checkbox.check()
  const changed=await save()
  assert.equal(changed.extraSettings.advancedContentSource,'manual','save the selected source, not the original snapshot')
  assert.equal(changed.extraSettings.advancedContentEnabled,mode==='Nâng cao')
  assert.equal(changed.extraSettings.advancedContentGroupSnapshot,undefined)
  assert.equal(changed.extraSettings.advancedContentItems[0].id,'draft')
  assert.equal(changed.extraSettings.advancedContentItems[0].content,'<p><em>Manual variant</em></p>')
  assert.equal(changed.content,'<p><strong>Manual draft</strong></p>')
  assert.equal(changed.extraSettings.formattedContentEnabled,true)
  await open({...snapshot,...changed,id:undefined})
  await checkbox.uncheck()
  await page.getByRole('button',{name:mode,exact:true}).click()
  const ordinary=await save()
  assert.equal(ordinary.extraSettings.advancedContentSource,'manual')
  assert.equal(ordinary.extraSettings.advancedContentItems[0].id,'draft')
  assert.equal(ordinary.extraSettings.advancedContentGroupSnapshot,undefined)
 }
 console.log('PASS native group-share UI: save/reopen, invalid URL, hidden configuration, single checkbox, caption and draft persistence')
 console.log('PASS native group-share review: rich basic/advanced roundtrips; snapshot to manual basic/advanced and back to ordinary posting')
}
