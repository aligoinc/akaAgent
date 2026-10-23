const assert = require('node:assert/strict')

// Real Main service, entitlements, HTTP catalog filters, runtime and parser; synthetic account data only.
module.exports = async ({m,live,base,receipts,model,generalSpec,accounts,actions,reads,logs,requests,setRow,setOutput}) => {
  const originalAccounts=structuredClone(accounts),originalActions=structuredClone(actions),originalUser=structuredClone(global.__fbUser)
  const row={...generalSpec,id:14,model_id:21,is_active:true,campaign_scope:'all',campaign_action_ids:[],timeout_ms:120000,request_options:{}}
  const nullChanges=Object.fromEntries(Object.keys(m.FACEBOOK_AI_FIELDS.general).map(key=>[key,null]))
  const cases=[
    {platform:'zalo',actionId:'zalo_message_friend',description:'Chuyển sang tài khoản Bình mã QR',accountType:'zalo_qr'},
    {platform:'zalo',actionId:'zalo_message_friend',description:'Chuyển sang tài khoản Bình trình duyệt',flags:{is_zalo_show_web:true},accountType:'zalo_web'},
    {platform:'zalo',actionId:'zalo_message_friend',description:'Chuyển sang tài khoản Bình server',flags:{is_zalo_server:true},accountType:'zalo_server'},
    {platform:'email',actionId:'email_send',description:'Chọn tài khoản email Bình'},
    {platform:'sms',actionId:'sms_send',description:'Gửi SMS bằng tài khoản Bình'},
    {platform:'sms',actionId:'voice_call',description:'Dùng tài khoản Bình gọi tự động'},
    {platform:'zalo',actionId:'zalo_message_phone',description:'Chuyển tài khoản chính sang Bình, giữ tài khoản phụ Châu',secondaryAccountId:13,accountType:'zalo_qr'},
    {platform:'email',actionId:'email_send',description:'Đổi tên thành Tháng mười và chạy bằng Page Shop Hoa',unsupported:true}
  ]
  try {
    for(const test of cases){
      const action={id:test.actionId,flatform_type:test.platform,is_active:true,is_delete:false,allow_multiple_accounts:test.platform!=='zalo'}
      actions.splice(0,actions.length,action)
      accounts.splice(0,accounts.length,...originalAccounts.map(account=>({...account,flatform_type:test.platform,...test.flags})),
        {...originalAccounts[0],id:71,flatform_type:'facebook'}, {...originalAccounts[0],id:72,is_delete:true,flatform_type:test.platform})
      setRow(row)
      const request=m.validateFacebookAiRequest({...base,kind:'general',actionId:test.actionId,description:test.description,
        current:{name:'Giữ tên',accountIds:[11],runAsPage:false,runAsPageUid:''},eligibleAccountIds:[11,12,13,71,72,99],
        secondaryAccountId:test.secondaryAccountId??null,platform:'facebook',model_id:7,prompt_system:'untrusted override'})
      assert.equal(request.platform,undefined);assert.equal(request.model_id,undefined);assert.equal(request.prompt_system,undefined)
      setOutput({status:test.unsupported?'unsupported':'ok',reason:test.unsupported?'Page chỉ áp dụng cho Facebook.':'',changes:{...nullChanges,...(!test.unsupported&&{accountIds:[12]})}})
      const start=reads.length
      const result=await m.generateCampaignFacebook(request,AbortSignal.timeout(120000))
      assert.equal(result.ok,!test.unsupported,JSON.stringify({test,result}))
      if(test.unsupported)assert.equal(result.code,'unsupported')
      else assert.deepEqual(result.patch.accountIds,[12])
      const context=JSON.parse(logs.at(-1).rendered_user_prompt)
      assert.equal(context.platform,test.platform);assert.equal(context.catalog.platform,test.platform)
      assert.equal(context.catalog.allowPageIdentity,false);assert.deepEqual(context.catalog.pages,[])
      assert.deepEqual(context.catalog.accounts.map(account=>account.id),test.secondaryAccountId?[11,12]:[11,12,13])
      assert.ok(context.catalog.accounts.every(account=>account.accountType===test.accountType))
      assert.equal(context.catalog.allowMultipleAccounts,action.allow_multiple_accounts&&!test.secondaryAccountId)
      assert.equal(context.catalog.secondaryAccount?.id,test.secondaryAccountId)
      assert.deepEqual(reads.slice(start).map(read=>read.table),['auto_campaign_actions','ai_form_configs','ai_model','auto_accounts','ai_log'])
      assert.equal(logs.at(-1).form_config_id,14);assert.equal(logs.at(-1).rendered_system_prompt,generalSpec.prompt_system)
      receipts.push({actionId:test.actionId,accountType:test.accountType,description:test.description,result,model:model.model})
      if(!live){
        for(const changes of [{name:'Do not apply',runAsPage:true,runAsPageUid:'page-b'},{name:'Do not apply',runAsPage:false},{name:'Do not apply',accountIds:[71]},{name:'Do not apply',accountIds:[72]},{name:'Do not apply',accountIds:[99]}]){
          setOutput({status:'ok',reason:'',changes:{...nullChanges,...changes}})
          const invalid=await m.generateCampaignFacebook(request,AbortSignal.timeout(5000))
          assert.equal(invalid.ok,false);assert.equal(invalid.patch,undefined)
        }
        for(const change of [()=>row.is_active=false,()=>{row.campaign_scope='selected';row.campaign_action_ids=['facebook_group_post']},()=>action.is_active=false,()=>action.is_delete=true]){
          const count=requests.length;change()
          await assert.rejects(()=>m.generateCampaignFacebook(request,AbortSignal.timeout(5000)));assert.equal(requests.length,count)
          Object.assign(row,{is_active:true,campaign_scope:'all',campaign_action_ids:[]});Object.assign(action,{is_active:true,is_delete:false})
        }
      }
      console.log(`PASS ${live?'live Sol':'fixture runtime'} general ${test.actionId}/${test.accountType||test.platform}${test.secondaryAccountId?' secondary':''}${test.unsupported?' Page unsupported':''}`)
    }
    if(!live){
      actions.splice(0,actions.length,{id:'zalo_message_phone',flatform_type:'zalo',is_active:true,is_delete:false,allow_multiple_accounts:true},
        {id:'zalo_message_group_realtime',flatform_type:'zalo',is_active:true,is_delete:false,allow_multiple_accounts:false})
      accounts.splice(0,accounts.length,...originalAccounts.slice(0,3).map(account=>({...account,flatform_type:'zalo'})),
        {...originalAccounts[0],id:21,is_zalo_show_web:true,flatform_type:'zalo'},
        {...originalAccounts[0],id:22,is_zalo_server:true,flatform_type:'zalo'})
      const request={...base,kind:'general',actionId:'zalo_message_phone',description:'Chọn tài khoản',current:{name:'Giữ tên',accountIds:[11],runAsPage:false,runAsPageUid:''},eligibleAccountIds:[11,12,13,21,22],secondaryAccountId:13}
      for(const secondaryAccountId of [13,99]){
        setOutput({status:'ok',reason:'',changes:{...nullChanges,name:'Do not apply',accountIds:[22]}})
        const result=await m.generateCampaignFacebook({...request,secondaryAccountId},AbortSignal.timeout(5000))
        assert.equal(result.ok,false);assert.equal(result.patch,undefined)
        const catalog=JSON.parse(logs.at(-1).rendered_user_prompt).catalog
        assert.deepEqual(catalog.accounts.map(account=>account.id),secondaryAccountId===13?[11,12]:[])
      }
      setOutput({status:'ok',reason:'',changes:{...nullChanges,name:'Tên hợp lệ'}})
      assert.equal((await m.generateCampaignFacebook({...request,secondaryAccountId:99},AbortSignal.timeout(5000))).ok,true)
      setOutput({status:'ok',reason:'',changes:{...nullChanges,accountIds:[21]}})
      assert.equal((await m.generateCampaignFacebook({...request,actionId:'zalo_message_group_realtime',secondaryAccountId:null},AbortSignal.timeout(5000))).ok,false)
      assert.deepEqual(JSON.parse(logs.at(-1).rendered_user_prompt).catalog.accounts.map(account=>account.id),[11,12,13,22])
      const count=requests.length
      await assert.rejects(()=>m.generateCampaignFacebook({...request,kind:'keywords'},AbortSignal.timeout(5000)))
      await assert.rejects(()=>m.generateCampaignFacebook({...request,actionId:'unknown'},AbortSignal.timeout(5000)))
      assert.equal(requests.length,count)
      console.log('PASS general guards: Zalo subtype/secondary retention, missing secondary, realtime browser exclusion, unknown action, other sections remain Facebook-only')

      accounts.push({...originalAccounts[0],id:23,name:'Browser secondary',flatform_type:'zalo',is_zalo_show_web:true},
        {...originalAccounts[0],id:24,name:'Server secondary',flatform_type:'zalo',is_zalo_server:true},
        {...originalAccounts[0],id:25,name:'Invalid subtype',flatform_type:'zalo',is_zalo_show_web:true,is_zalo_server:true})
      const capabilityRequest={...request,eligibleAccountIds:accounts.map(account=>account.id),secondaryAccountId:null}
      for(let mask=0;mask<8;mask++){
        global.__fbUser.zaloAccountCapabilities={qr:!!(mask&1),web:!!(mask&2),server:!!(mask&4)}
        // Existing product policy: browser capability includes QR.
        const expectedIds=[...(mask&3?[11,12,13]:[]),...(mask&2?[21,23]:[]),...(mask&4?[22,24]:[])].sort((a,b)=>a-b)
        for(const accountId of [12,21,22,25]){
          setOutput({status:'ok',reason:'',changes:{...nullChanges,name:'Apply only if authorized',accountIds:[accountId]}})
          const readStart=reads.length,result=await m.generateCampaignFacebook(capabilityRequest,AbortSignal.timeout(5000))
          assert.equal(result.ok,expectedIds.includes(accountId),`capability mask ${mask}, primary ${accountId}`)
          if(!result.ok)assert.equal(result.patch,undefined,'Do not partially apply the valid name')
          const catalog=JSON.parse(logs.at(-1).rendered_user_prompt).catalog
          assert.deepEqual(catalog.accounts.map(account=>account.id).sort((a,b)=>a-b),expectedIds)
          assert.equal(catalog.secondaryAccount,null)
          assert.deepEqual(reads.slice(readStart).map(read=>read.table),['auto_campaign_actions','ai_form_configs','ai_model','auto_accounts','ai_log'])
        }
        for(const [secondaryAccountId,primaryAccountId,subtypeIds]of [[13,12,[11,12,13]],[23,21,[21,23]],[24,22,[22,24]]]){
          setOutput({status:'ok',reason:'',changes:{...nullChanges,name:'Apply only if authorized',accountIds:[primaryAccountId]}})
          const withSecondary={...capabilityRequest,secondaryAccountId}
          const result=await m.generateCampaignFacebook(withSecondary,AbortSignal.timeout(5000)),allowed=expectedIds.includes(secondaryAccountId)
          assert.equal(result.ok,allowed,`capability mask ${mask}, secondary ${secondaryAccountId}`)
          const catalog=JSON.parse(logs.at(-1).rendered_user_prompt).catalog
          assert.equal(catalog.hasSecondaryAccount,true)
          assert.equal(catalog.secondaryAccount?.id??null,allowed?secondaryAccountId:null)
          assert.deepEqual(catalog.accounts.map(account=>account.id),allowed?subtypeIds.filter(id=>id!==secondaryAccountId):[])
          if(!allowed){
            assert.equal(result.patch,undefined)
            setOutput({status:'ok',reason:'',changes:{...nullChanges,name:'Name remains editable'}})
            assert.equal((await m.generateCampaignFacebook(withSecondary,AbortSignal.timeout(5000))).ok,true)
          }
        }
      }
      console.log('PASS real entitlement policy: 8 QR/browser/server combinations, 32 primary selections, 24 secondary selections, forbidden names excluded, invalid subtype rejected, atomic patches and unchanged DB reads')
    }
  } finally {accounts.splice(0,accounts.length,...originalAccounts);actions.splice(0,actions.length,...originalActions);global.__fbUser=originalUser}
}
