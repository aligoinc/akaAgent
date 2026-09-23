import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { setCurrentUser, setCurrentUserCredentials, getCurrentUser } from '../src/main/data/currentUser'
import { registerStaffManagementHandlers } from '../src/main/ipc/handlers/staffManagementHandlers'
import { IPC_EVENTS, type AuthUser } from '../src/shared/types'
import type { ManagedStaff, StaffGroup } from '../src/shared/staffManagement'
const directory = process.env.STAFF_FIXTURE_DIRECTORY!
app.setPath('userData', join(directory, 'profile'))
const user = { staffId: 101, organizationId: 9, username: '9.admin', name: 'Admin fixture', isAdmin: true, isAdminAkabiz: false } as AuthUser
let groups: StaffGroup[] = [
  { id: 1, name: 'Công ty TNHH akaBiz', parentId: null, staffCount: 1, version: 'g1' },
  { id: 2, name: 'Phòng kinh doanh', parentId: 1, staffCount: 1, version: 'g2' },
  { id: 3, name: 'Kinh doanh 1 — Dự án', parentId: 2, staffCount: 1, version: 'g3' },
  { id: 4, name: 'Kinh doanh 2 — Thứ cấp', parentId: 2, staffCount: 1, version: 'g4' },
  { id: 5, name: 'Phòng Marketing', parentId: 1, staffCount: 1, version: 'g5' },
  { id: 6, name: 'Phòng CSKH', parentId: 1, staffCount: 1, version: 'g6' }
].map(row => ({ ...row, managers: [] }))
let rows: ManagedStaff[] = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Nam', 'Phạm Minh Tuấn', 'Đỗ Hoàng Nam', 'Vũ Thùy Dung'].map((name, i) => ({
  id: 101 + i, name, phone: `090123456${i}`, username: `9.090123456${i}`,
  isAdmin: !i, isActive: i !== 2, status: i === 2 ? 'locked' : i === 4 ? 'expired' : 'active',
  createdAt: '2026-09-22T01:00:00Z', expirationDate: i === 4 ? '2026-09-21T00:00:00+07:00' : '2027-09-23T00:00:00+07:00',
  effectiveExpirationDate: i === 4 ? '2026-09-21T00:00:00+07:00' : i === 3 ? '2026-09-26T00:00:00+07:00' : '2027-09-23T00:00:00+07:00',
  expirySource: 'staff', daysRemaining: i === 4 ? 0 : i === 3 ? 4 : 366,
  groupIds: [i + 1], groupNames: [groups[i].name], managerGroupIds: i === 1 || i === 2 ? [i + 1] : [], version: `s${i}`
}))
let useStaffExpiration = true
let delay = false, fail = '', failAfterCommit = false, rev = 0
const calls: { action: string; input: any }[] = []
const ledger = new Map<string, unknown>()
Object.assign(globalThis, { staffSmokeClient: { rpc(_name: string, args: any) { return { abortSignal: async () => {
  calls.push({ action: args.p_action, input: args.p_data })
  if (delay && args.p_action === 'revealPassword') await new Promise(resolve => setTimeout(resolve, 600))
  if (args.p_actor_id !== 101 || args.p_username !== '9.admin' || args.p_password !== 'fixture-actor-password' || !getCurrentUser()?.isAdmin) return { error: { message: 'staff_access_denied' } }
  const a = args.p_action, p = args.p_data
  if (fail === a) { fail = ''; return { error: { message: 'fixture read failed' } } }
  if (ledger.has(p.requestId)) return { data: ledger.get(p.requestId), error: null }
  let data: any
  if (a === 'list') {
    let items = rows.filter(row => (!p.search || `${row.name} ${row.phone} ${row.username}`.toLowerCase().includes(p.search.toLowerCase())) && (!p.status || p.status==='all' || row.status===p.status) && (!p.groupId || row.groupIds.includes(p.groupId)))
    const total = items.length; items = items.slice((p.page||0)*100, ((p.page||0)+1)*100)
    const listedGroups = groups.map(group => ({ ...group, managers: rows.filter(row => row.managerGroupIds.includes(group.id)).map(row => ({ id: row.id, name: row.name })) }))
    data = { items, groups: listedGroups, total, page: p.page||0, organization: { id: 9, name: 'Công ty TNHH akaBiz', staffCount: rows.length, maxStaff: 25, staffDurationDays: 365, useStaffExpiration, today: '2026-09-22', expirationDate: '2028-09-22T00:00:00+07:00' } }
  }
  if (a === 'revealPassword') data = { password: 'staff-fixture-secret' }
  if (a === 'saveGroup') { const row = { id: p.id || groups.length+1, name: p.name, parentId: p.parentId ?? 1, staffCount: 0, version: `g${++rev}`, managers: [] }; groups = [...groups.filter(g => g.id!==row.id), row]; data = { id: row.id } }
  if (a === 'saveStaff') {
    const prior = rows.find(row => row.id===p.id)
    const manager = p.isDepartmentManager ?? !!prior?.managerGroupIds.includes(p.groupId)
    const row = { ...(prior || rows[1]), id: p.id || 200+ ++rev, name: p.name, phone: p.phone, username: prior?.username || `9.${p.phone}`, groupIds: [p.groupId], groupNames: [groups.find(g => g.id===p.groupId)!.name], managerGroupIds: manager ? [p.groupId] : [], version: `s${++rev}` }
    if (manager) rows = rows.map(other => other.id === row.id || !other.managerGroupIds.includes(p.groupId) ? other : { ...other, managerGroupIds: other.managerGroupIds.filter(id => id !== p.groupId), version: `s${++rev}` })
    rows = [...rows.filter(r => r.id!==row.id), row]; data=row
  }
  if (a === 'setStatus') { rows = rows.map(row => p.targets.some((t: any) => t.id===row.id) ? { ...row, isActive: p.isActive, status: p.isActive?'active':'locked', version:`s${++rev}` } : row); data = { count:p.targets.length } }
  if (a === 'prepareDevices') data = { items: p.ids.map((id: number) => ({ id, name: rows.find(row=>row.id===id)!.name, username:'fixture', version: 'device-1', isBound: true, label: 'Máy văn phòng', platform: 'Windows', lastSeenAt: null })) }
  if (a === 'resetDevices') data = { count: p.targets.length }
  if (p.requestId) ledger.set(p.requestId, data)
  if (p.requestId && failAfterCommit) { failAfterCommit=false; return { error: { message:'response lost' } } }
  return { data: structuredClone(data), error: null }
} } } } })
app.whenReady().then(async () => {
  setCurrentUser(user); setCurrentUserCredentials({ username:'9.admin', password:'fixture-actor-password' })
  const window = new BrowserWindow({ show:false, width:1530, height:980, webPreferences: { preload:join(directory,'preload.cjs'), contextIsolation:true, sandbox:true, nodeIntegration:false } })
  registerStaffManagementHandlers(window)
  Object.assign(globalThis, { staffSmoke: { calls, expiryMode:(value:boolean)=>{useStaffExpiration=value}, state:()=>({rows,groups}), delay:(value:boolean)=>{delay=value}, fail:(value:string)=>{fail=value}, loseResponse:()=>{failAfterCommit=true}, revoke:()=>{setCurrentUser({...user,isAdmin:false});window.webContents.send(IPC_EVENTS.AUTH_USER_UPDATED,getCurrentUser())}, restore:()=>{setCurrentUser(user);window.webContents.send(IPC_EVENTS.AUTH_USER_UPDATED,user)}, addPage:()=>{rows = Array.from({length:105},(_,i)=>({...rows[1],id:1000+i,name:`Nhân viên ${i+1}`}))} } })
  await window.loadURL(`${process.env.STAFF_FIXTURE_URL}/staff-fixture`)
})
app.on('window-all-closed',()=>app.quit())
