import React from 'react'
import { createRoot } from 'react-dom/client'
import DataGroupManagerModal from '../../src/renderer/src/components/DataScan/DataGroupManagerModal'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { useCampaignStore } from '../../src/renderer/src/stores/campaignStore'
import { useUiStore } from '../../src/renderer/src/stores/uiStore'
import '../../src/renderer/src/styles/global.css'
const state:any={calls:[],exports:[],errors:[],empty:false,privacyOnly:false}
;(window as any).fbExportSmoke=state
const group:any={id:1,name:'Kho hỗn hợp',color:'#123456',activeMembershipCount:3,isDelete:false,access:{role:'owner',canManage:true,canUse:true}}
const members:any[]=[
 {id:11,groupId:1,contactId:21,name:'Profile',uid:'12345678901234567890',contactType:'person',flatformType:'facebook'},
 {id:12,groupId:1,contactId:22,name:'Nhóm FB',uid:'https://facebook.com/groups/123',contactType:'group',flatformType:'facebook'},
 {id:13,groupId:1,contactId:23,name:'Nhóm Zalo',uid:'999',contactType:'group',flatformType:'zalo'}
].map(m=>({...m,isDelete:false,changeRevision:1,provenance:[],datasetIds:[],datasetNames:[]}))
const rows=(query:any, exporting=false)=>members.filter(m=>!query.ids||query.ids.includes(m.id)).map(m=>({...m,
 facebookGroupMetadata:exporting&&m.id===12&&!state.empty?(state.privacyOnly?{privacy:'Công khai'}:{memberCount:0,postsPerDay:5,privacy:'Riêng tư'}):undefined}))
const handlers:any={
 listDataGroups:async()=>({groups:[group],total:1}),listDataGroupDataTypes:async()=>[],getDataGroupAccountOptions:async()=>[],
 listDataGroupMembers:async(q:any)=>({members:rows(q),total:3}),listDataGroupDatasets:async()=>[],
 getDataGroupPanel:async()=>({group,summary:{activeMembershipCount:3},quality:{},sourceBreakdown:[],dataTypeBreakdown:[],accountBreakdown:[],tags:[],history:[],campaigns:[]}),
 getDataGroupDynamicFilter:async()=>({isEnabled:false,rules:[]}),
 readDataColumnFilters:async(r:any)=>({available:true,members:rows(r.query),contacts:[],ids:[],total:3}),
 exportDataColumnFilters:async(r:any)=>{state.calls.push(r);return {available:true,members:rows(r.query,true),contacts:[],ids:[],total:rows(r.query).length}},
 cancelDataColumnRead:async()=>{}
}
window.electronAPI=new Proxy(handlers,{get(target,key:string){if(key in target)return target[key];if(key.startsWith('on'))return()=>()=>{};return async()=>[]}}) as any
useAuthStore.setState({user:{staffId:1,organizationId:1} as any})
useCampaignStore.setState({accounts:[],loadAccounts:async()=>{}})
useUiStore.setState({showAlert:(message,type)=>{if(type==='error')state.errors.push(message)}})
window.addEventListener('error',e=>state.errors.push(e.message))
window.addEventListener('unhandledrejection',e=>state.errors.push(String(e.reason)))
createRoot(document.getElementById('root')!).render(<DataGroupManagerModal initialGroupId={1} onClose={()=>{}} />)
