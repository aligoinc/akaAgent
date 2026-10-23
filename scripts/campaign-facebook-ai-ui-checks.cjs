const assert = require('node:assert/strict')
module.exports = async page => {
  await page.waitForFunction(() => !!window.scheduleSmoke)
  const open = (action, extra={}, overrides={}, extraAccountIds=[]) => page.evaluate(({action,extra,overrides,extraAccountIds})=>window.scheduleSmoke.openFacebook(action,extra,overrides,extraAccountIds),{action,extra,overrides,extraAccountIds})
  const panel = title => page.getByRole('dialog',{name:`AI điền ${title}`,exact:true})
  const request = async title => {
    await page.getByRole('button',{name:`AI điền ${title}`,exact:true}).click()
    await panel(title).getByLabel('Mô tả cấu hình bạn muốn').fill('Điền theo yêu cầu kiểm thử')
    await panel(title).getByRole('button',{name:'Điền cấu hình',exact:true}).click()
    await page.waitForFunction(()=>window.scheduleSmoke.state.pending.length===1)
    assert.equal(await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).isDisabled(),true)
    assert.equal(await page.getByRole('button',{name:'Điền lịch bằng AI',exact:true}).isDisabled(),true)
    return page.evaluate(()=>window.scheduleSmoke.state.requests.at(-1))
  }
  const resolve=async(title,patch)=>{
    await page.evaluate(patch=>window.scheduleSmoke.resolve({ok:true,patch}),patch)
    await panel(title).waitFor({state:'detached'})
  }
  const parsed=async(title,patch,ok)=>{
    const result=await page.evaluate(patch=>window.scheduleSmoke.resolveFacebookOutput(patch),patch)
    assert.equal(result.ok,ok,JSON.stringify(result))
    if(ok)await panel(title).waitFor({state:'detached'})
    else {await panel(title).getByRole('alert').waitFor();await panel(title).getByRole('button',{name:`Đóng AI ${title}`}).click()}
  }
  const searchTitle='Cấu hình tìm kiếm và Điều kiện chạy'
  await open('facebook_find_data_search',{isFindPhone:true,isFindInPost:true,countSearchPostFindData:10})
  await request(searchTitle)
  await resolve(searchTitle,{isFindInComment:true,countCommentFindData:20,isFindCommentByKeywords:true,commentKeywords:'cần mua'})
  const order=await page.locator('.stepper-content > .stepper-section').evaluateAll(nodes=>nodes.map(n=>n.querySelector('.stepper-section-title')?.textContent))
  assert.equal(order.indexOf('Điều kiện chạy'),order.indexOf('Cấu hình tìm kiếm')+1)
  let sent=await request(searchTitle)
  assert.equal(sent.current.countCommentFindData,20);assert.equal(sent.current.commentKeywords,'cần mua')
  await resolve(searchTitle,{})
  const keywords='Danh sách từ khóa'
  sent=await request(keywords)
  assert.equal(sent.kind,'keywords')
  await resolve(keywords,{keywords:['mua căn hộ','cần nhà quận 7']})
  assert.deepEqual((await request(keywords)).current.keywords,['mua căn hộ','cần nhà quận 7'])
  await panel(keywords).getByRole('button',{name:'Hủy yêu cầu'}).click()
  await page.evaluate(()=>window.scheduleSmoke.resolve({ok:true,patch:{keywords:['STALE']}}))
  await panel(keywords).getByRole('button',{name:`Đóng AI ${keywords}`}).click()
  assert.deepEqual((await request(keywords)).current.keywords,['mua căn hộ','cần nhà quận 7'])
  await page.evaluate(()=>window.scheduleSmoke.expire())
  await panel(keywords).getByRole('alert').waitFor()
  await page.evaluate(()=>window.scheduleSmoke.resolve({ok:true,patch:{keywords:['LATE']}}))
  await panel(keywords).getByRole('button',{name:`Đóng AI ${keywords}`}).click()
  assert.deepEqual((await request(keywords)).current.keywords,['mua căn hộ','cần nhà quận 7'])
  await resolve(keywords,{})
  await open('facebook_group_post',{enableComment:true,commentImages:['image-keep'],commentContent:'Giữ comment'})
  const general='Cài đặt chung'
  sent=await request(general);assert.deepEqual(sent.eligibleAccountIds,[11,12])
  await resolve(general,{name:'Tên từ AI',accountIds:[12],runAsPage:true,runAsPageUid:'page-b',runAsPageName:'Page B'})
  sent=await request(general)
  assert.equal(sent.current.name,'Tên từ AI');assert.deepEqual(sent.current.accountIds,[12]);assert.equal(sent.current.runAsPageUid,'page-b')
  await resolve(general,{})
  const comment='Kiêm comment'
  await request(comment)
  await resolve(comment,{enableComment:true,commentGroupMode:'pending_only',commentType:'others',commentCount:3,commentContent:'Xin chào | Chào bạn'})
  sent=await request(comment);assert.equal(sent.current.commentCount,3);assert.equal(sent.current.commentContent,'Xin chào | Chào bạn')
  await resolve(comment,{})
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft)
  const saved=await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData)
  assert.equal(saved.content,'Giữ nội dung');assert.deepEqual(saved.commentImages,['image-keep'])
  await open('facebook_comment_seeding')
  const post='Điều kiện tìm kiếm bài post'
  await request(post);await resolve(post,{commentPostSort:'new_posts',isFindPostByKeywords:true,postKeywords:'tuyển dụng'})
  assert.equal((await request(post)).current.postKeywords,'tuyển dụng');await resolve(post,{})
  await open('facebook_newsfeed_interaction')
  const newsfeed='Lướt newsfeed'
  await request(newsfeed);await resolve(newsfeed,{newsfeedTimeMinutes:15,enablePostLike:true,newsfeedLikeLimit:5,newsfeedLikeKind:'vui vẻ'})
  sent=await request(newsfeed);assert.equal(sent.current.newsfeedTimeMinutes,15);assert.equal(sent.current.newsfeedLikeLimit,5)
  await resolve(newsfeed,{})
  // Switching forms invalidates the in-flight result; same common controller also owns old sections.
  await request(newsfeed)
  await open('facebook_group_post')
  await page.evaluate(()=>window.scheduleSmoke.resolve({ok:true,patch:{name:'Old response'}}))
  sent=await request(general);assert.equal(sent.current.name,'Facebook kiểm thử');await resolve(general,{})
  // Saved edits and a secondary account restrict the actual form to one primary account.
  for(const overrides of [{id:123},{secondaryAccountId:12}]) {
    await open('facebook_group_post',{},overrides)
    sent=await request(general);assert.equal(sent.singleAccountOnly,true)
    const before=sent.current
    await parsed(general,{name:'Must not partially apply',accountIds:[11,12]},false)
    sent=await request(general);assert.deepEqual(sent.current,before)
    await parsed(general,{name:'Một tài khoản'},true)
    if(overrides.secondaryAccountId) {
      await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
      await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData.name==='Một tài khoản')
      assert.equal(await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData.secondaryAccountId),12)
    }
  }
  await open('facebook_group_post',{}, {secondaryAccountId:12},[13])
  sent=await request(general);assert.equal(sent.secondaryAccountId,12)
  const beforeConflict=sent.current
  await parsed(general,{name:'Must not partially apply',accountIds:[12]},false)
  sent=await request(general);assert.deepEqual(sent.current,beforeConflict);assert.equal(sent.secondaryAccountId,12)
  await resolve(general,{})
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData.name==='Facebook kiểm thử')
  let secondaryDraft=await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData)
  assert.deepEqual(secondaryDraft.accountIds,[11]);assert.equal(secondaryDraft.secondaryAccountId,12)
  // A different primary remains valid; saved drafts keep the secondary account.
  await open('facebook_group_post',{}, {secondaryAccountId:12},[13])
  await request(general);await parsed(general,{accountIds:[13]},true)
  sent=await request(general);assert.deepEqual(sent.current.accountIds,[13]);assert.equal(sent.secondaryAccountId,12)
  await resolve(general,{})
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData.accountIds[0]===13)
  secondaryDraft=await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData)
  assert.deepEqual(secondaryDraft.accountIds,[13]);assert.equal(secondaryDraft.secondaryAccountId,12)
  // Page ownership is valid, but enabling it must never silently delete another secondary.
  await open('facebook_group_post',{}, {secondaryAccountId:13},[13])
  sent=await request(general);const beforePageConflict=sent.current
  await parsed(general,{name:'Must not partially apply',accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},false)
  sent=await request(general);assert.deepEqual(sent.current,beforePageConflict);assert.equal(sent.secondaryAccountId,13)
  await resolve(general,{})
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData.accountIds[0]===11)
  secondaryDraft=await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData)
  assert.equal(secondaryDraft.secondaryAccountId,13);assert.equal(secondaryDraft.runAsPage,false);assert.equal(secondaryDraft.name,beforePageConflict.name)
  // Removing the secondary manually updates the AI snapshot and permits a valid Page.
  await open('facebook_group_post',{}, {secondaryAccountId:13},[13])
  await request(general);await resolve(general,{})
  await page.locator('select').filter({has:page.getByRole('option',{name:'-- Không sử dụng tài khoản phụ --',exact:true})}).selectOption('')
  sent=await request(general);assert.equal(sent.secondaryAccountId,null)
  await parsed(general,{accountIds:[12],runAsPage:true,runAsPageUid:'page-b'},true)
  sent=await request(general);assert.equal(sent.secondaryAccountId,null);assert.equal(sent.current.runAsPage,true);assert.equal(sent.current.runAsPageUid,'page-b')
  await resolve(general,{})
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData.runAsPage===true)
  secondaryDraft=await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData)
  assert.deepEqual(secondaryDraft.accountIds,[12]);assert.equal(secondaryDraft.secondaryAccountId,null);assert.equal(secondaryDraft.runAsPageUid,'page-b')
  await open('facebook_group_post',{runAsPage:true,runAsPageUid:'page-b',runAsPageName:'Page B'},{accountId:12})
  sent=await request(general);assert.equal(sent.singleAccountOnly,false)
  await parsed(general,{runAsPage:false,accountIds:[11,12]},true)
  sent=await request(general);assert.deepEqual(sent.current.accountIds,[11,12]);await resolve(general,{})
  await open('facebook_find_data_group',{isFindUid:true,isFindInPost:false,isFindInComment:false,isFindNewInteractors:true})
  for(const patch of [{isFindCommentByKeywords:true,commentKeywords:'cần mua'}, {isFindCommentByContentAI:true,commentContentAI:'muốn mua nhà'}]) {
    sent=await request(searchTitle);const before=sent.current
    assert.equal(before.isFindInComment,false);assert.equal(before.isFindNewInteractors,true)
    await parsed(searchTitle,patch,false)
    sent=await request(searchTitle);assert.deepEqual(sent.current,before)
    await resolve(searchTitle,{})
  }
  await request(searchTitle);await parsed(searchTitle,{countCommentFindData:30,sortTypeComment:'newest'},true)
  sent=await request(searchTitle);assert.equal(sent.current.countCommentFindData,30)
  await parsed(searchTitle,{isFindInComment:true,isFindCommentByKeywords:true,commentKeywords:'cần mua'},true)
  sent=await request(searchTitle);assert.equal(sent.current.isFindInComment,true);assert.equal(sent.current.commentKeywords,'cần mua');await resolve(searchTitle,{})
  const calls=await page.evaluate(()=>window.scheduleSmoke.state.calls)
  assert.equal(calls.filter(c=>['createCampaign','updateCampaign'].includes(c.method)).length,0)
  assert.ok(await page.evaluate(()=>window.scheduleSmoke.state.cancels.length>=3))
  console.log('PASS Electron Facebook AI: six sections, section order, account/Page atomic apply, single-account edit/secondary guard, hidden comment filter rejection, valid comment source, media/content preservation, cancel/timeout/stale form, no auto-save')
}
