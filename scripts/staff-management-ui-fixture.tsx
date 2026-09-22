import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import StaffManagementPage from '../src/renderer/src/pages/StaffManagementPage'
import TopBar from '../src/renderer/src/components/TopBar/TopBar'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import type { AuthUser } from '../src/shared/types'
import '../src/renderer/src/styles/global.css'
const user = {staffId:101,organizationId:9,username:'9.admin',name:'Admin fixture',isAdmin:true,isAdminAkabiz:false} as AuthUser
useAuthStore.setState({user})
window.electronAPI.onAuthUserUpdated(user=>useAuthStore.setState({user}))
function Fixture(){ const [open,setOpen]=useState(true);return <div className="app-layout"><div className="app-content-shell" style={{height:'100%'}}><TopBar activePage="staff-management" onPageChange={()=>setOpen(true)} onOpenDataScan={()=>{}} onOpenMediaLibrary={()=>{}} onOpenProxyManager={()=>{}} onOpenDataGroups={()=>{}} onOpenAccountInfo={()=>{}} onOpenGeneralSettings={()=>setOpen(false)} onOpenChangePassword={()=>{}} currentVersion="fixture" checkingUpdate={false} onCheckUpdate={()=>{}} />{open && <StaffManagementPage/>}</div></div> }
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>)
