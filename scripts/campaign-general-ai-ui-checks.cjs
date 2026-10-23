const assert = require('node:assert/strict')
module.exports = async page => {
  await page.waitForFunction(()=>!!window.scheduleSmoke)
  const title='Cài đặt chung', trigger=page.getByRole('button',{name:`AI điền ${title}`,exact:true})
  const panel=()=>page.getByRole('dialog',{name:`AI điền ${title}`,exact:true})
  const open=(actionId,platform,accountFlags={},campaignOverrides={})=>page.evaluate(args=>window.scheduleSmoke.openGeneral(...args),[actionId,platform,accountFlags,campaignOverrides])
  const request=async()=>{
    await trigger.click();await panel().getByLabel('Mô tả cấu hình bạn muốn').fill('Chuyển tài khoản và đổi tên')
    await panel().getByRole('button',{name:'Điền cấu hình',exact:true}).click()
    await page.waitForFunction(()=>window.scheduleSmoke.state.pending.length===1)
    assert.equal(await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).isDisabled(),true)
    return page.evaluate(()=>window.scheduleSmoke.state.requests.at(-1))
  }
  const parsed=async(patch,ok=true)=>{
    const result=await page.evaluate(patch=>window.scheduleSmoke.resolveFacebookOutput(patch),patch)
    assert.equal(result.ok,ok,JSON.stringify(result))
    if(ok)await panel().waitFor({state:'detached'})
    else{await panel().getByRole('alert').waitFor();await panel().getByRole('button',{name:`Đóng AI ${title}`}).click()}
  }
  for(const [action,platform,flags]of [
    ['zalo_message_friend','zalo',{}],['zalo_message_friend','zalo',{isZaloShowWeb:true}],
    ['zalo_message_friend','zalo',{isZaloServer:true}],['email_send','email',{}],['sms_send','sms',{}],['voice_call','sms',{}]
  ]){
    await open(action,platform,flags)
    const before=await request();assert.equal(before.actionId,action)
    assert.deepEqual(before.eligibleAccountIds,[11,12,13])
    await parsed({name:'Tên mới',accountIds:[12]})
    let sent=await request();assert.equal(sent.current.name,'Tên mới');assert.deepEqual(sent.current.accountIds,[12])
    await parsed({name:'Không được áp dụng',runAsPage:true,runAsPageUid:'page-b'},false)
    sent=await request();assert.equal(sent.current.name,'Tên mới');assert.deepEqual(sent.current.accountIds,[12])
    await parsed({})
    await page.evaluate(()=>{window.scheduleSmoke.state.lastSavedDraft=null})
    await page.getByRole('button',{name:'Lưu nháp',exact:true}).click()
    await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft)
    const saved=await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData)
    assert.equal(saved.name,'Tên mới');assert.deepEqual(saved.accountIds,[12]);assert.equal(saved.content,'Giữ nội dung')
    console.log(`PASS Electron general ${action}/${JSON.stringify(flags)}: visible, apply, Page rejected atomically, draft preserved`)
  }
  for(const flags of [{},{isZaloShowWeb:true},{isZaloServer:true}]){
    await open('zalo_message_phone','zalo',flags,{secondaryAccountId:13})
    let sent=await request();assert.equal(sent.secondaryAccountId,13);assert.equal(sent.singleAccountOnly,true)
    await parsed({accountIds:[12]})
    sent=await request();assert.deepEqual(sent.current.accountIds,[12]);assert.equal(sent.secondaryAccountId,13)
    await parsed({})
    await page.evaluate(()=>{window.scheduleSmoke.state.lastSavedDraft=null})
    await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();await page.waitForFunction(()=>window.scheduleSmoke.state.lastSavedDraft)
    assert.equal(await page.evaluate(()=>window.scheduleSmoke.state.lastSavedDraft.payload.values.formData.secondaryAccountId),13)
  }
  await open('email_send','email');await request()
  await open('sms_send','sms')
  await page.evaluate(()=>window.scheduleSmoke.resolve({ok:true,patch:{name:'STALE',accountIds:[12]}}))
  assert.equal((await request()).current.name,'Cài đặt chung kiểm thử');await parsed({})
  // Scope metadata still controls the shared button; changing forms reads it once.
  await page.evaluate(()=>{window.scheduleSmoke.state.formAiRows=[{sectionId:'campaign.facebook.general',campaignScope:'selected',campaignActionIds:['facebook_group_post']}];window.scheduleSmoke.openGeneral('email_send','email')})
  await trigger.waitFor({state:'detached'})
  await page.evaluate(()=>{window.scheduleSmoke.state.formAiRows=[{sectionId:'campaign.facebook.general',campaignScope:'all',campaignActionIds:[]}];window.scheduleSmoke.openGeneral('email_send','email')})
  await trigger.waitFor()
  await page.evaluate(()=>{window.scheduleSmoke.state.formAiRows=[];window.scheduleSmoke.openGeneral('email_send','email')})
  await trigger.waitFor({state:'detached'})
  const calls=await page.evaluate(()=>window.scheduleSmoke.state.calls)
  assert.equal(calls.filter(call=>['createCampaign','updateCampaign'].includes(call.method)).length,0)
  console.log('PASS Electron general: Zalo QR/browser/server secondary retained, stale platform response ignored, selected/all/inactive metadata, no auto-save')
}
