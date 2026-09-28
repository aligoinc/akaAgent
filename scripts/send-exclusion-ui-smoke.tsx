import '../src/renderer/src/styles/global.css'
import {createRoot} from 'react-dom/client'
import {useState} from 'react'
import CampaignSendExclusions from '../src/renderer/src/components/CampaignPanels/CampaignSendExclusions'
import page from './fixtures/send-exclusion-ui-page.json'
import type {SendExclusionsByAccount, SaveSendExclusionGroup} from '../src/shared/campaignSendExclusion'
const state={calls:[] as unknown[],fail:false,delay:0,saves:0,retired:'',lastSaved:null as SaveSendExclusionGroup|null}
function fixture(){
 const data=structuredClone(page)
 if(state.retired){
  const field=data.catalog.fields.find(f=>f.code==='recent_delivery')!
  const operator=data.catalog.operators.find(o=>o.code==='within_days')!
  const gender=data.groups.find(g=>g.name==='Giới tính nữ')!
  data.groups.push({...gender,id:99,name:'Nhóm cũ',rules:[...gender.rules,{fieldId:field.id,operatorId:operator.id,value:7,isEnabled:state.retired!=='disabled',sortOrder:40}]})
  if(state.retired==='field')field.isActive=false
  else if(state.retired==='source')field.sourceKey='unsupported_source'
  else operator.isActive=false
 }
 return data
}
Object.assign(window,{exclusionSmoke:state})
Object.assign(window,{electronAPI:{
 listSendExclusionGroups:async(id:number)=>{state.calls.push(['list',id]);if(state.fail)throw new Error('offline');const data=fixture();return {...data,groups:data.groups.map(g=>({...g,accountId:id,id:g.id+(id===101?1000:0)}))}},
 saveSendExclusionGroup:async(group:SaveSendExclusionGroup)=>{
  state.saves++;await new Promise(r=>setTimeout(r,state.delay))
  const data=fixture()
  if(group.rules.some(r=>!data.catalog.fields.some(f=>f.id===r.fieldId&&f.isActive)||!data.catalog.operators.some(o=>o.id===r.operatorId&&o.isActive)))throw new Error('send_exclusion_definition_unavailable')
  state.lastSaved=structuredClone(group)
  return {...group,id:group.id??50,revision:group.revision+1}
 },
 syncZaloLabels:async()=>{}
}})
function App(){const[value,setValue]=useState<SendExclusionsByAccount>({});const[revision,setRevision]=useState(0);return <main style={{maxWidth:840,margin:'30px auto',padding:16,fontFamily:'Inter, system-ui, sans-serif'}}><CampaignSendExclusions accounts={[{id:100,name:'Zalo chính'},{id:101,name:'Zalo phụ'}]} value={value} onChange={v=>{setValue(v);Object.assign(state,{value:v})}} onEditing={()=>{}} onManage={()=>setRevision(v=>v+1)} refreshKey={revision}/></main>}
createRoot(document.getElementById('root')!).render(<App/>);
