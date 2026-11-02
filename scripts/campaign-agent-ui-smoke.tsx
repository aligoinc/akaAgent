// Real renderer form; IPC and stores are isolated fixtures. No campaign or provider side effects.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { campaignEdit } from '../src/renderer/src/components/CampaignPanels/campaignEdit'
import CampaignAgentFormModal from '../src/renderer/src/components/CampaignPanels/CampaignAgentFormModal'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import { FORM_AI_SECTIONS } from '../src/shared/campaignFormAiConfig'
import { isAgentDraft } from '../src/shared/campaignAgent'
import '../src/renderer/src/styles/global.css'
import exclusionPage from './fixtures/send-exclusion-ui-page.json'
campaignEdit.chooseSaveStatus = async () => 'tạm dừng'
const actions = ['facebook_timeline_post','facebook_group_post','facebook_message_uid','facebook_page_post','facebook_find_data_search',
  'zalo_message_phone','zalo_message_friend','zalo_message_group','email_send','sms_send','voice_call'].map(id => ({ id, name: id,
    allowMultipleAccounts: true, allowSecondaryAccount: false, isActive: true, isDelete: false,
    flatformType: id.startsWith('facebook') ? 'facebook' : id.startsWith('zalo') ? 'zalo' : id === 'email_send' ? 'email' : 'sms',
    limitCheckActionCodes: id==='zalo_message_phone' ? ['zalo_find_phone_user','zalo_message_stranger','zalo_add_friend'] : id.startsWith('zalo') ? ['zalo_message_stranger','zalo_add_friend'] : id.startsWith('facebook') ? ['fb_post_my_profile'] : [id] }))
const accounts = ['facebook','zalo','email','sms'].flatMap((flatformType, index) => [0,1,2].map(type => ({ id: index*10+type+1,
  name: `${flatformType} ${type}`, flatformType, isActive:true, isDelete:false, staffId:7, organizationId:9,
  rateLimitMinutes: flatformType === 'zalo' && type === 1 ? 90 : 65,
  isZaloShowWeb: flatformType === 'zalo' && type === 1, isZaloServer: flatformType === 'zalo' && type === 2 })))
const state: any = { calls: [], requests: [], pending: [], errors: [], cancels: [], saved: null, deadlines: [], images: {}, dataFiles: {}, deferNames: false, namePending: [],
  deferLabels: false, labelPending: [], deferGroups: false, groupPending: [], settleInterruption: null }
const nativeTimeout=window.setTimeout.bind(window)
window.setTimeout=((fn:any, ms?:number, ...args:any[])=>{
  const callback=ms===50?()=>{
    const interruption=state.settleInterruption
    if(interruption&&!interruption.fired&&--interruption.ticks===0){
      interruption.fired=true
      if(interruption.kind==='timeout')state.deadlines.at(-1)()
      else (document.querySelector('[aria-label="Dừng Agent"]') as HTMLButtonElement).click()
    }
    fn(...args)
  }:()=>fn(...args)
  const id=nativeTimeout(callback,ms);if(ms===120000)state.deadlines.push(()=>{clearTimeout(id);fn()});return id
}) as any
const handlers: any = {
  generateCampaignNameWithAI:()=>state.deferNames?new Promise(resolve=>state.namePending.push(resolve)):'',
  listZaloLabels:(accountId:number)=>state.deferLabels?new Promise(resolve=>state.labelPending.push({accountId,resolve})):[{id:1,text:'Khách cũ'},{id:2,text:'VIP'}],
  saveSendExclusionGroup:(draft:any)=>({...draft,id:99,revision:1}),
  createCampaign:(payload:any)=>({...payload,id:1001}), createCampaignInputDataBatch:(rows:any[])=>rows.length,
  completeCampaignDraft:()=>undefined, updateCampaign:(id:number,payload:any)=>({...payload,id}),
  listSendExclusionGroups:(id:number)=>({...structuredClone(exclusionPage),groups:exclusionPage.groups.map(g=>({...g,accountId:id}))}),
  platform:'darwin', fileExists:()=>true, getCampaignInputDataLimit:()=>10000, getAkaBizIntegrations:()=>({}), getStaffIntegrations:()=>({}),
  getSystemSetting:()=>null, listDataGroups:(query:any)=>state.deferGroups?new Promise(resolve=>state.groupPending.push({query,resolve})):({groups:[],total:0}), listAccounts:()=>accounts, getAllCampaignActions:()=>actions,
  getAllAccountActions:()=>[], getCampaignActionUsage:()=>[],
  getCampaignTypeVisibility:()=>({ organizationId:9, revision:0, hiddenActionIds:[], updatedAt:null, canEdit:false }),
  listCampaignFormAi:()=>Object.values(FORM_AI_SECTIONS).map(sectionId=>({sectionId,campaignScope:'all',campaignActionIds:[]})),
  generateCampaignAgent:(request:any)=>{state.requests.push(request);return new Promise((resolve,reject)=>state.pending.push({resolve,reject}))},
  cancelCampaignAgent:(id:string)=>{state.cancels.push(id)},
  storeCampaignAgentData:(_draftId:string,files:any[])=>{
    if(state.failDataStore)throw new Error('Không thể lưu file kiểm thử')
    return files.map(file=>{const ref={id:crypto.randomUUID(),name:file.name,kind:/\.(xlsx|xls|csv)$/i.test(file.name)?'excel':/^image\//.test(file.mimeType)?'image':'text',bytes:atob(file.dataBase64).length};state.dataFiles[ref.id]={...file,...ref};return ref})
  },
  readCampaignAgentData:(_requestId:string,_draftId:string,ref:any)=>{
    if(state.deferData)return new Promise(resolve=>{state.pendingData=resolve})
    const file=state.dataFiles[ref.id]
    if(!file)return{ok:false,code:'invalid',message:'File gốc không có trên thiết bị này.'}
    if(file.kind==='image')return{ok:true,patch:{kind:'text',name:file.name+' (OCR)',text:state.ocrText || '0901234567\n0987654321'}}
    return{ok:true,patch:{kind:'file',name:file.name,mimeType:file.mimeType,dataBase64:file.dataBase64}}
  },
  cancelCampaignAgentData:()=>undefined,
  saveCampaignDraft:(request:any)=>{
    if(state.failSave==='before')throw new Error('Lỗi lưu nháp kiểm thử trước commit')
    state.saved={...request,...request.payload.values.formData,revision:request.revision+1,updatedAt:new Date().toISOString(),isDelete:false,deletionReason:null,campaignIds:[]}
    if(state.failSave==='after')throw new Error('Lỗi lưu nháp kiểm thử sau commit')
    return state.deferSave?new Promise(resolve=>{state.resolveSave=()=>resolve(state.saved)}):state.saved
  },
  storeCampaignAgentImages:(draftId:string, files:any[])=>files.map(file=>{const ref={id:crypto.randomUUID(),name:file.name,mimeType:file.mimeType,bytes:atob(file.dataBase64).length};state.images[ref.id]=`data:${file.mimeType};base64,${file.dataBase64}`;return ref}),
  readCampaignAgentImage:(_draftId:string,id:string)=>state.images[id]||null,
  removeCampaignAgentImage:(_draftId:string,id:string)=>{delete state.images[id]},
}
window.electronAPI=new Proxy(handlers,{get(target,key:string){if(key in target&&typeof target[key]!=='function')return target[key];if(key.startsWith('on'))return()=>()=>{};return async(...args:any[])=>{state.calls.push({method:key,args});return key in target?target[key](...args):key.startsWith('get')?null:[]}}}) as any
window.addEventListener('error',e=>state.errors.push(e.error?.stack||e.message));window.addEventListener('unhandledrejection',e=>state.errors.push(String(e.reason)))
useAuthStore.setState({user:{staffId:7,organizationId:9,entitlements:normalizeEntitlements({facebookCore:true,facebookFanpage:true,zalo:true,email:true,sms:true}),zaloAccountCapabilities:{qr:true,web:true,server:true}} as any})
useCampaignStore.setState({accounts:accounts as any,campaignActions:actions as any,campaigns:[],loadCampaigns:async()=>{},loadAccountGroups:async()=>{},loadAccounts:async()=>{},loadCampaignActions:async()=>{}})
useUiStore.setState({showAlert:(message,type)=>state.calls.push({method:'alert',args:[message,type]}),showConfirm:(_m,cb)=>{void cb()}})
function App(){
  const [generation,setGeneration]=useState(0),[closed,setClosed]=useState(false),[draft,setDraft]=useState<any>()
  const [action,setAction]=useState('facebook_timeline_post'),[account,setAccount]=useState(1)
  ;(window as any).agentSmoke={state,isSavedAgentDraft:()=>isAgentDraft(state.saved?.payload.values.agentChat),open:(actionId='facebook_timeline_post',accountId=1)=>{setDraft(undefined);setAction(actionId);setAccount(accountId);setClosed(false);setGeneration(v=>v+1)},
    openDraft:(value:any)=>{setDraft(value);setClosed(false);setGeneration(v=>v+1)},resolve:(value:any)=>state.pending.shift().resolve(value),reject:()=>state.pending.shift().reject(new Error('network secret')),
    resolveName:(name:string)=>state.namePending.shift()(name),
    resolveLabels:(accountId:number,labels:any[])=>{const index=state.labelPending.findIndex((p:any)=>p.accountId===accountId);state.labelPending.splice(index,1)[0].resolve(labels)},
    resolveGroups:(index:number,page:any)=>state.groupPending.splice(index,1)[0].resolve(page),
    expire:()=>state.deadlines.at(-1)(),switchUser:()=>useAuthStore.setState(s=>({user:{...s.user!,staffId:s.user!.staffId+1}}))}
  return closed?<div>Đã đóng</div>:<CampaignAgentFormModal key={generation} savedDraft={draft} initialSection="general"
    campaign={null} lockedActionId={draft?undefined:action} initialAccountIds={account?[account]:[]} onClose={()=>setClosed(true)}/>
}
createRoot(document.getElementById('root')!).render(<App/> )
