import React, { useState } from 'react'
import AlertModal from '../../src/renderer/src/components/CampaignPanels/AlertModal'
import { createRoot } from 'react-dom/client'
import { GroupSharingButton, GroupSharingBadge, GroupCopyButton } from '../../src/renderer/src/components/DataGroups/GroupSharingPanel'
import ContentTemplateWorkspace from '../../src/renderer/src/components/ContentTemplates/ContentTemplateWorkspace'
import DataGroupManagerModal from '../../src/renderer/src/components/DataScan/DataGroupManagerModal'
import { useContentTemplateStore } from '../../src/renderer/src/stores/contentTemplateStore'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { useCampaignStore } from '../../src/renderer/src/stores/campaignStore'
import { useUiStore } from '../../src/renderer/src/stores/uiStore'
import '../../src/renderer/src/styles/global.css'
const owner = { role: 'owner', ownerStaffId: 7, ownerName: 'Chủ nhóm', canManage: true, canUse: true, canCopy: true } as const
const shared = { ...owner, role: 'shared', canManage: false } as const
const state: any = { errors: [], calls: [], releases: [], hold: false, fail: false, conflict: false, scope: 'private', revision: '0', recipients: [] }
const api: any = {
  staff: async () => [{ id: 8, name: 'Lan Nguyễn' }, { id: 9, name: 'Minh Trần' }],
  get: async (_kind: string, id: number) => {
    state.calls.push({ method: 'getSharing', kind: _kind, id })
    const value = { scope: state.scope, revision: state.revision, recipientIds: [...state.recipients], access: id === 2 ? shared : owner }
    if (state.hold) await new Promise(resolve => state.releases.push(resolve))
    if (state.fail) throw new Error('Lỗi tải tạm thời')
    return value
  },
  save: async (input: any) => {
    state.calls.push({ method: 'save', input })
    if (state.conflict) throw new Error('group_sharing_conflict')
    state.scope = input.scope; state.recipients = input.recipientIds; state.revision = String(Number(state.revision) + 1)
    return api.get(input.kind, input.groupId)
  },
  copy: async (input: any) => { state.calls.push({ method: 'copy', input }); return { groupId: 3, count: 1 } }
}
const groups: any[] = [1, 2].map(id => ({ id, name: id === 1 ? 'Kho riêng' : 'Kho chia sẻ', description: '', color: '#6366f1', order: id, sortOrder: id, isActive: true, isDelete: false, templateCount: 1, activeMembershipCount: 1, dataTypeCode: 'facebook_person', dataTypeCategoryItemId: 1, boundZaloAccountId: null, access: id === 1 ? owner : shared }))
const templates: any[] = groups.map(group => ({ id: group.id, groupId: group.id, groupName: group.name, name: `Mẫu ${group.id}`, access: group.access, isDelete: false, channels: { zalo_message: { enabled: true, variants: [{ text: 'Xin chào khách hàng' }], imageUrls: [] } } }))
const member: any = { id: 11, contactId: 11, name: 'Khách hàng', uid: '100001', contactType: 'person', flatformType: 'facebook', sourceAccountId: 21, sourceAccountName: 'Facebook nguồn của chủ nhóm', datasetIds: [], datasetNames: [], provenance: [], dataTypeCategoryItemId: 1 }
const handlers: any = {
 groupSharing: api,
 listContentTemplates: async () => templates,
 listContentTemplateGroups: async () => groups,
 listContentTemplateContentTypes: async () => [{ id: 1, name: 'zalo_message', label: 'Zalo', order: 1, isActive: true }],
 listDataGroups: async (query: any) => { state.calls.push({ method: 'listDataGroups', query }); const list = query.ownedOnly ? groups.filter(g => g.access.canManage) : groups; return { groups: list, total: list.length } },
 listDataGroupMembers: async () => ({ members: [member], total: 1 }),
 listDataGroupMemberIds: async () => ({ ids: [11], total: 1 }),
 listDataGroupDatasets: async () => [],
 listDataGroupDataTypes: async () => [{ id: 1, code: 'facebook_person', name: 'User Facebook' }],
 getDataGroupPanel: async (id: number) => ({ group: { ...groups.find(g => g.id === id), creatorName: 'Chủ nhóm' }, summary: { activeMembershipCount: 1, campaignCount: 0, runCount: 0 }, quality: {}, sourceBreakdown: [], dataTypeBreakdown: [], accountBreakdown: [], tags: [], history: [], campaigns: [] }),
 getDataGroupDynamicFilter: async () => ({ isEnabled: false, rules: [] })
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
 if (key in target) return target[key]
 if (key.startsWith('on')) return () => () => {}
 return async (...args: any[]) => { state.calls.push({ method: key, args }); return [] }
}}) as any
useAuthStore.setState({ user: { staffId: 7, organizationId: 9 } as any })
useCampaignStore.setState({ accounts: [], loadAccounts: async () => {} })
useUiStore.setState({ showAlert: (message, type = 'info') => { state.calls.push({ method: 'alert', message, type }); useUiStore.setState({ alert: { isOpen: true, message, type } }) }, showConfirm: (_m, cb) => { void cb() } })
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
function App() {
 const [mode, setMode] = useState('panel'); const [id, setId] = useState(1)
 ;(window as any).sharingUi = { state, show: setMode, select: setId, release: () => { state.hold = false; state.releases.splice(0).forEach((resolve: any) => resolve()) }, store: useContentTemplateStore, changeSession: () => useAuthStore.setState({ user: { staffId: 8, organizationId: 9 } as any }) }
 if (mode === 'content') return <div style={{ height: '100vh' }}><ContentTemplateWorkspace /></div>
 if (mode === 'data' || mode === 'destination') return <DataGroupManagerModal initialGroupId={2} selectionMode={mode === 'destination'} ownedOnly={mode === 'destination'} onClose={() => setMode('panel')} />
 return <main style={{ width: 400, margin: '20px auto' }}><GroupSharingBadge access={id === 2 ? shared : owner} /><GroupSharingButton api={api} kind="data" groupId={id} groupName={id === 2 ? 'Kho chia sẻ' : 'Kho riêng'} access={id === 2 ? shared : owner} onChanged={() => {}} onSaved={() => useUiStore.getState().showAlert('Đã lưu chia sẻ nhóm.', 'success')} /><GroupCopyButton api={api} kind="data" groupId={id} onCopied={() => {}} /></main>
}
createRoot(document.getElementById('root')!).render(<><App /><AlertModal /></>)
