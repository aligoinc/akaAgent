import React from 'react'
import { root } from './campaign-pending-reason-ui-smoke'
import CampaignPage from '../src/renderer/src/pages/CampaignPage'
import { DIAGNOSTICS_MODEL } from '../src/shared/campaignDiagnostics'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
const state = { reads: 0, readCampaignIds: [] as number[], detailCampaignIds: [] as number[], ai: 0, randomExcluded: false, randomGets: [] as number[], randomSaves: [] as number[], cancelled: [] as string[], defer: false, deferAi: false, failAi: false, failRead: false, missingQuota: false, restricted: false,
  detailTotal: 0, detailQueries: [] as { campaignId: number; offset: number }[], offPageCampaignId: null as number | null, offPageStatus: 'chờ xử lý',
  deferResume: false, failResume: false, updates: [] as { id: number; updates: unknown }[], pendingResume: [] as (() => void)[], pending: [] as (() => void)[] }
const snapshot = (campaignId: number) => {
 const status = campaignId === state.offPageCampaignId ? state.offPageStatus : useCampaignStore.getState().campaigns.find(row => row.id === campaignId)?.status || 'chờ xử lý'
 return { id: crypto.randomUUID(), campaignId, accountId: 41, version: 'v1', checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+300000).toISOString(), campaignStatus: status, complete: false,
  headline: status === 'tạm dừng' ? 'Chiến dịch đang tạm dừng.' : 'Một hành động đã đạt giới hạn. Kiểm tra cấu hình trước lượt chạy tiếp theo.',
  checks: [
    ...(state.randomExcluded ? [{id:'randomRun',title:'Cấu hình chạy ngẫu nhiên',severity:'blocking',problem:'Loại chiến dịch “Nhắn tin UID” chưa có trong cấu hình chạy ngẫu nhiên của tài khoản.',cause:'Loại chiến dịch chưa có trong cấu hình.',explanation:'Kiểm tra cấu hình cho lượt chạy mới.',solution:'Mở cài đặt chạy ngẫu nhiên của tài khoản.',actions:['randomSettings']}] : []),
    {id:'account',title:'Tài khoản và quyền sử dụng',severity:'ok',problem:'Tài khoản đang hoạt động và có quyền sử dụng Facebook.',cause:'Tài khoản và gói sử dụng còn hiệu lực.',explanation:'Kiểm tra theo thông tin đã ghi nhận.',solution:'Có thể mở tài khoản để xem chi tiết.',actions:['account']},
    {id:'login',title:'Trạng thái đăng nhập',severity:'ok',problem:'Đã ghi nhận đăng nhập trên trình duyệt.',cause:'Tài khoản đã đăng nhập.',explanation:'Không tự xác minh lại phiên trong lượt kiểm tra này.',solution:'Đăng nhập lại nếu nền tảng yêu cầu.',actions:['login']},
    {id:'limits',title:'Giới hạn ngày và khung giờ',severity:'blocking',problem:'Đã dùng 9 / 9 lượt trong 65 phút.',cause:'Đạt giới hạn hành động nhắn tin.',explanation:'Các lượt gần đây được tính theo chính sách hiện tại.',solution:'Chờ khung thời gian mới hoặc kiểm tra giới hạn.',actions:['limits']},
    {id:'restrictions',title:'Trạng thái và hạn chế hành động',severity:state.restricted?'warning':'ok',problem:state.restricted?'Một hành động đang bị hạn chế.':'Chưa thấy hành động cần dùng bị hạn chế.',cause:'Đối chiếu trạng thái hành động đã ghi nhận.',explanation:'Không suy đoán lý do nền tảng chặn.',solution:'Mở quản lý hành động để kiểm tra.',actions:['accountActions']},
    status === 'tạm dừng'
      ? {id:'runtime',title:'Bộ chạy chiến dịch',severity:'info',problem:'Chiến dịch đang tạm dừng.',cause:'Chiến dịch không nhận lượt chạy mới ở trạng thái này.',explanation:'Đây là trạng thái hiện tại của chiến dịch.',solution:'Xem lịch sử chạy để biết lần chuyển trạng thái gần nhất.',actions:['history']}
      : {id:'runtime',title:'Bộ chạy chiến dịch',severity:'unknown',problem:(window as any).pendingSmoke.state.webStates.some((row:any)=>row.accountId===41)?'Tài khoản đang bận làm giàu lịch sử Web. Chiến dịch này đang chờ đến lượt.':'Chưa xác minh trực tiếp bộ chạy.',cause:'Bộ chạy chưa phản hồi.',explanation:'Chưa đủ bằng chứng.',solution:'Mở tài khoản để kiểm tra.',actions:['accountActions']},
    {id:'schedule',title:'Lịch chạy',severity:'ok',problem:'Lịch hiện tại cho phép nhận lượt chạy.',cause:'Chưa thấy lịch chặn lượt mới.',explanation:'Lịch theo múi giờ Việt Nam.',solution:'Mở lịch chạy nếu cần điều chỉnh.',actions:['schedule']},
    {id:'content',title:'Nội dung, media và cấu hình',severity:'info',problem:'Đã thu thập nội dung và cấu hình media để đối chiếu.',cause:'Chưa phát hiện lỗi từ kiểm tra cấu hình.',explanation:'Đã đọc cấu hình và thông tin tệp; chưa phân tích nội dung hình ảnh/video hoặc gửi thử.',solution:'Mở Nội dung để kiểm tra chữ và media.',actions:['content'],evidence:['Nội dung chữ: 245 ký tự','Media trực tiếp: 2']},
    {id:'data',title:'Data đầu vào',severity:'ok',problem:'Có data chờ đã đến giờ chạy.',cause:'Nguồn data sẵn sàng.',explanation:'Data được chọn theo lịch và trạng thái.',solution:'Mở Data ban đầu để kiểm tra.',actions:['data','importData']},
    {id:'history',title:'Lịch sử và kết quả gần đây',severity:'info',problem:'Mẫu 30 kết quả gần nhất chưa ghi nhận lỗi.',cause:'Chưa có kết quả lỗi trong mẫu.',explanation:'Không phải tổng kết quả trong ngày.',solution:'Xem kết quả chi tiết nếu cần đối chiếu.',actions:['results','history']}
  ],
  quotas:[{code:'facebook_message_uid',name:'Nhắn tin Facebook',checked:true,dayUsed:18,dayLimit:30,windowUsed:state.missingQuota?null:9,windowLimit:9,windowMinutes:65,disabled:state.restricted,reason:state.restricted?'Tạm hạn chế nhắn tin theo thông báo nền tảng.':null,enableAt:state.restricted?'2026-10-15T02:00:00Z':null}],
  facts:{schedule:null,campaign:{},account:{},action:{},accountHistory:Array(12).fill({}),campaignHistory:Array(30).fill('Đã kiểm tra'),results:Array(30).fill({}),inputSummary:{},inputs:Array(30).fill({})} }
}
const existing = window.electronAPI
window.electronAPI = new Proxy(existing, { get(target,key:string) {
  if(key==='facebookRandomRun')return {
    get:async(accountId:number)=>{state.randomGets.push(accountId);return {enabled:true,config:{version:1,revision:1,rules:[{campaignActionId:'facebook_message_uid',quantity:3,unit:'data'}]}}},
    save:async(accountId:number,config:any)=>{state.randomSaves.push(accountId);state.randomExcluded=false;useCampaignStore.setState(s=>({accounts:s.accounts.map(a=>a.id===accountId?{...a,facebookRandomRunEnabled:true,facebookRandomRunRevision:2}:a)}));return {enabled:true,config:{...config,revision:2}}},
    toggle:async()=>{throw Error('Diagnostics must not toggle random execution')}
  }
  if(key==='listCampaignDetailsPage')return async({campaignId,offset}:any)=>{state.detailCampaignIds.push(campaignId);state.detailQueries.push({campaignId,offset});return {items:[],total:state.detailTotal}}
  if(key==='getDesktopCampaignPage')return async(query:any)=>{
    const page = await target.getDesktopCampaignPage(query)
    if (!state.offPageCampaignId) return page
    const items = page.items.filter(row => row.id !== state.offPageCampaignId)
    const selected = page.selected?.id === state.offPageCampaignId ? { ...page.selected, status: state.offPageStatus } : page.selected
    return { ...page, items, selected, order: page.order.filter(row => Number(row.id) !== state.offPageCampaignId), total: items.length, campaignTotal: items.length }
  }
  if(key==='listCampaignInputDataPage')return async()=>({items:[],total:0})
  if(key==='getCampaignDiagnostics')return async ({campaignId}:any)=>{state.reads++;state.readCampaignIds.push(campaignId);const result=snapshot(campaignId);if(state.defer)await new Promise<void>(resolve=>state.pending.push(resolve));if(state.failRead)throw Error('private');return result}
  if(key==='analyzeCampaignDiagnostics')return async ({campaignId}:any)=>{state.ai++;if(state.deferAi)await new Promise<void>(resolve=>state.pending.push(resolve));if(state.failAi)throw Error('private');return {snapshot:snapshot(campaignId),generatedAt:new Date().toISOString(),model:DIAGNOSTICS_MODEL,summary:'Giới hạn 65 phút đang ngăn nhận lượt mới.',issues:[{id:'ai-limit',title:'Kiểm tra giới hạn hành động',severity:'warning',problem:'Quota đã đầy.',cause:'Đã gửi đủ lượt.',explanation:'Các lượt vẫn trong khung 65 phút.',solution:'Chờ hết khung hoặc kiểm tra cài đặt.',actions:['limits','results','importData']}]}}
  if(key==='cancelCampaignDiagnostics')return async (id:string)=>{state.cancelled.push(id)}
  if(key==='updateCampaign')return async (id:number,updates:any)=>{
    state.updates.push({id,updates})
    if(state.deferResume)await new Promise<void>(resolve=>state.pendingResume.push(resolve))
    if(state.failResume)throw Error('Không thể tiếp tục chiến dịch kiểm thử.')
    if(id===state.offPageCampaignId){
      if(state.offPageStatus!=='tạm dừng')throw Error('Chỉ có thể tiếp tục chiến dịch đang tạm dừng.')
      state.offPageStatus=updates.status
      return {id,...updates}
    }
    ;(window as any).pendingSmoke.patch(id,updates)
    return useCampaignStore.getState().campaigns.find(row=>row.id===id)
  }
  return target[key as keyof typeof target]
} })
;(window as any).diagnosticSmoke = {state,release:()=>state.pending.shift()?.(),releaseResume:()=>state.pendingResume.shift()?.(),alert:()=>useUiStore.getState().alert}

const render = (isActive: boolean) => root.render(<div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><CampaignPage isActive={isActive} /></div>)
;(window as any).diagnosticSmoke.setActive = render
render(true)
