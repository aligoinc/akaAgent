import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Config from '../src/renderer/src/components/CampaignPanels/FacebookRandomRunConfigModal'
import Plan from '../src/renderer/src/components/CampaignPanels/FacebookRandomRunPanel'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { vietnamRunDate } from '../src/shared/facebookRandomRun'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'
const state: any = { reads: [], saves: [], toggles: [], errors: [], pending: [], hold: false, failSave: false }
const account: any = { id: 42, name: 'Nguyễn Văn A', flatformType: 'facebook', isActive:true, isDelete:false, staffId:7, organizationId:9, loginStatus:'đã đăng nhập', status:'chờ xử lý' }
const actions: any = ['facebook_group_post','facebook_timeline_post','facebook_newsfeed_interaction'].map((id,i)=>({ id,name:['Đăng bài vào group','Đăng bài trang cá nhân','Lướt newsfeed và tương tác'][i],isActive:true,isDelete:false,flatformType:'facebook' }))
const config: any = { version:1,revision:1,rules:actions.map((a:any,i:number)=>({campaignActionId:a.id,quantity:[3,1,5][i],unit:['data','run','minute'][i]})) }
const day = (q:any) => ({ date:q.date,accountId:42,status:'open',page:q.page,total:q.campaignId?1:3,turns:[
  {id:'1',order:1,round:1,ruleIndex:0,revision:1,campaignId:101,campaignName:'Đăng nhóm A',quantity:3,unit:'data',processed:1,elapsedSeconds:0,status:'stopped',reason:'Hành động đăng nhóm bị khóa'},
  {id:'2',order:2,round:1,ruleIndex:1,revision:1,campaignId:102,campaignName:'Bài giới thiệu sản phẩm',quantity:1,unit:'run',processed:1,elapsedSeconds:0,status:'completed'},
  {id:'3',order:3,round:1,ruleIndex:2,revision:1,campaignId:103,campaignName:'Tương tác buổi sáng',quantity:5,unit:'minute',processed:0,elapsedSeconds:150,status:'running'}
].filter(t=>!q.campaignId || t.campaignId===q.campaignId) })
const now = new Date().toISOString()
const campaigns: any[] = day({date:vietnamRunDate(),page:1}).turns.map((turn,i)=>({id:turn.campaignId,name:turn.campaignName,actionId:actions[i].id,
  accountId:42,accountName:account.name,staffId:7,organizationId:9,schedule:now,createdAt:now,updatedAt:now,
  status:'chờ xử lý',isDelete:false,relationSettings:{},extraSettings:{}}))
window.electronAPI = new Proxy({
  platform:'darwin',listCampaignDrafts:async()=>({items:[],total:0}),
  listAutomations:async()=>({items:[],total:0,pageSize:100}),listAutomationExecutions:async()=>({items:[],total:0,pageSize:100}),
  getCampaignConfig:async(id:number)=>campaigns.find(c=>c.id===id),getDesktopCampaignConfig:async(id:number)=>campaigns.find(c=>c.id===id),
  getCampaignRelationSummaries:async()=>[],getDesktopCampaignSources:async()=>[],
  getDesktopCampaignPage:async(q:any)=>({items:campaigns,selected:campaigns.find(c=>c.id===q.selectedId)||null,
    order:campaigns.map(c=>({kind:'campaign',id:String(c.id)})),total:3,campaignTotal:3,page:1,pageSize:100,actionOptions:[]}),
  facebookRandomRun:{
  get:async()=>({enabled:true,config:structuredClone(Object.hasOwn(state,'configOverride')?state.configOverride:config)}),
  save:async(_id:number,cfg:any)=>{state.saves.push(cfg);if(state.failSave)throw Error('Cấu hình đã thay đổi trên máy khác. Hãy tải lại trước khi lưu.');return {enabled:true,config:state.badSaveResponse?{version:1,revision:cfg.revision+1}:{...cfg,revision:cfg.revision+1}}},
  toggle:async(...args:any[])=>{state.toggles.push(args);return {enabled:true,config}},
  dates:async()=>[vietnamRunDate(),'2026-10-13'],
  day:async(_id:number,q:any)=>{state.reads.push(q);if(state.hold)return new Promise(resolve=>state.pending.push(()=>resolve({...day(q),turns:[{...day(q).turns[0],campaignName:'PHẢN HỒI CŨ'}]})));return day(q)}
}}, {get(target:any,key:string){if(key in target)return target[key];if(key.startsWith('on'))return()=>()=>{};return async()=>key.startsWith('get')?null:[]}}) as any
window.addEventListener('error',e=>state.errors.push(e.message))
window.addEventListener('unhandledrejection',e=>state.errors.push(String(e.reason)))
useAuthStore.setState({user:{staffId:7,organizationId:9,entitlements:normalizeEntitlements({facebookCore:true}),zaloAccountCapabilities:{qr:false,web:false,server:false}} as any})
useCampaignStore.setState({campaignActions:actions,accounts:[account],campaigns,campaignConfigs:Object.fromEntries(campaigns.map(c=>[c.id,c])),
  loadAccounts:async()=>{},loadAccountGroups:async()=>{},loadCampaignActions:async()=>{}})
function App(){
 const [mode,setMode]=useState('plan'),[campaign,setCampaign]=useState<number|undefined>(),[active,setActive]=useState(true)
 const [request,setRequest]=useState<{accountId:number;requestId:number}|null>(null)
 ;(window as any).randomUi={state,show:(m:string,c?:number)=>{setMode(m);setCampaign(c)},active:setActive,tick:()=>useCampaignStore.setState(s=>({campaignsReadAt:(s.campaignsReadAt??0)+1})),
   openPlan:()=>setRequest(old=>({accountId:42,requestId:(old?.requestId??0)+1}))}
 if(mode==='integration')return <div style={{height:'100vh'}}><CampaignPanel isActive={active} randomPlanRequest={request}/></div>
 return mode==='config'?<Config account={account} enableAfterSave={false} onClose={()=>setMode('plan')}/>:<div style={{height:'100vh'}}><Plan key={campaign??'all'} account={account} campaignId={campaign} active={active}/></div>
}
createRoot(document.getElementById('root')!).render(<App/> )
