import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Modal from '../src/renderer/src/components/CampaignPanels/WebEnrichmentModal'
import Menu from '../src/renderer/src/components/CampaignPanels/AccountContextMenu'
import { emptyWebEnrichmentConfig } from '../src/shared/facebookWebEnrichment'
import '../src/renderer/src/styles/global.css'
const state: any = { saved: [], failSave: false, failLoad: false, errors: [], settings: { enabled: false, config: emptyWebEnrichmentConfig() } }
window.electronAPI = { webEnrichment: {
  get: async () => { if (state.failLoad) throw Error('Không tải được cài đặt.'); return structuredClone(state.settings) },
  save: async (_id: number, value: any) => { if (state.failSave) throw Error('Cấu hình đã thay đổi trên máy khác. Hãy tải lại trước khi lưu.'); state.saved.push(value); state.settings = { ...value, config: { ...value.config, revision: value.config.revision + 1 } }; return state.settings }
}} as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
const account: any = {id:42,name:'Tài khoản kiểm thử',flatformType:'facebook',status:'chờ xử lý',isActive:true,loginStatus:'đã đăng nhập'}
function App() {
  const [mode,setMode] = useState('menu'), [key,setKey]=useState(0)
  ;(window as any).webUi = { state, show: () => { setKey(k=>k+1); setMode('modal') } }
  if (mode==='menu') return <Menu {...new Proxy({account,position:{x:100,y:50},onWebEnrichment:()=>setMode('modal'),onClose:()=>{}},{get:(target:any,key:string)=>target[key]??(()=>{})}) as any}/>
  return mode==='modal' ? <Modal key={key} account={account} onClose={()=>setMode('closed')}/> : <div>Đã đóng</div>
}
createRoot(document.getElementById('root')!).render(<App/>)
