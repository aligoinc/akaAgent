import '../campaign-data-sort-ui-smoke'
const fixture = (window as any).sortSmoke
const state = fixture.state
;(window as any).fbExportSmoke = state
const original = window.electronAPI
const campaigns = fixture.store.getState().campaigns.map((row: any) => ({...row,
  actionId: row.id === 91 ? 'facebook_comment_seeding' : 'facebook_message_uid'}))
const resultRows = Array.from({length: 501}, (_,i) => ({id:i+1,campaignId:91,inputDataId:i+1,
  inputData:{id:i+1,name:`Target ${i+1}`,uid:i===500?'https://facebook.com/groups/123':'12345678901234567890'},
  actionName:'Comment',status:'thành công',subStatusPresentation:{name:'Chờ duyệt bài'},log:'Fixture',isDelete:false,
  createdAt:'2026-11-01T00:00:00Z'}))
const handlers: Record<string, any> = {
  getDesktopCampaignPage:(q:any)=>({items:campaigns,selected:campaigns.find((c:any)=>c.id===q.selectedId),
    order:campaigns.map((c:any)=>({kind:'campaign',id:String(c.id)})),total:2,campaignTotal:2,page:1,pageSize:100,actionOptions:[]}),
  getCampaignConfig:(id:number)=>campaigns.find((c:any)=>c.id===id),
  getDesktopCampaignConfig:(id:number)=>campaigns.find((c:any)=>c.id===id),
  listCampaignDetailsPage:(q:any)=>{
    state.calls.push({method:'metadataPage',query:q})
    const rows = q.campaignId===91 ? resultRows : resultRows.slice(0,2)
    return {total:rows.length,items:rows.slice(q.offset||0,(q.offset||0)+(q.limit||100)).map(row=>({...row,
      facebookGroupMetadata:q.includeFacebookGroupMetadata && row.id===501 && !state.empty
        ? state.privacyOnly ? {privacy:'Riêng tư'} : {memberCount:0,postsPerDay:2,privacy:'Công khai'} : undefined}))}
  }
}
window.electronAPI = new Proxy(original,{get(target,key:string){return key in handlers
  ? async(...args:any[])=>handlers[key](...args):Reflect.get(target,key)}})
fixture.store.setState({campaigns,campaignConfigs:Object.fromEntries(campaigns.map((c:any)=>[c.id,c])),campaignActions:[
  {id:'facebook_comment_seeding',name:'Comment group/page/profile',flatformType:'facebook',isActive:true,isDelete:false},
  {id:'facebook_message_uid',name:'Nhắn tin UID',flatformType:'facebook',isActive:true,isDelete:false}
]})
