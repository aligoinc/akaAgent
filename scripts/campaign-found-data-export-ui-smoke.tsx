// Real CampaignPanel/store; extend the isolated fixture without network or production data.
import './campaign-data-sort-ui-smoke'

const fixture = (window as any).sortSmoke
const original = window.electronAPI
const campaigns = fixture.store.getState().campaigns.map((campaign: any) => ({
  ...campaign,
  actionId: campaign.id === 91 ? 'facebook_find_data_search' : 'facebook_find_data_group'
}))
const groupUrl = 'https://www.facebook.com/groups/12345678901234567890/'
const details = [
  { id: 1, campaignId: 91, data: {
    phones: ['0901234567'], uids: ['12345678901234567890'],
    facebookGroups: [
      { url: groupUrl.slice(0, -1), name: '', memberCount: '651', postsPerDay: 2, privacy: 'Private' },
      { url: 'https://www.facebook.com/groups/missing', name: '=Tên nhóm', memberCount: null, postsPerDay: '', privacy: '' },
      { url: 'https://www.facebook.com/groups/zero', name: 'Số không', memberCount: 0, postsPerDay: 0, privacy: 'Private' },
      { url: 'https://www.facebook.com/groups/zero-string', name: 'Số không dạng chuỗi', postsPerDay: '0' },
      { url: 'https://www.facebook.com/groups/filled', name: 'Bổ sung số liệu', postsPerDay: 0 }
    ]
  } },
  { id: 2, campaignId: 91, data: { facebookGroups: [
    { url: groupUrl, name: 'Hải Minh - Hải Hậu', memberCount: 300, postsPerDay: 1, privacy: 'Public' },
    { url: 'https://www.facebook.com/groups/filled/', name: '', memberCount: 1200, postsPerDay: '5', privacy: 'Public' }
  ] } }
]
const handlers: Record<string, any> = {
  getDesktopCampaignPage: (query: any) => ({ items: campaigns,
    selected: campaigns.find((row: any) => row.id === query.selectedId) || null,
    order: campaigns.map((row: any) => ({ kind: 'campaign', id: String(row.id) })),
    total: 2, campaignTotal: 2, page: 1, pageSize: 100, actionOptions: [] }),
  getCampaignConfig: (id: number) => campaigns.find((row: any) => row.id === id),
  getDesktopCampaignConfig: (id: number) => campaigns.find((row: any) => row.id === id),
  listCampaignDetailsByCampaign: (id: number) => id === 91 ? details : [{
    id: 3, campaignId: 92, data: { phones: ['0901234567'], uids: ['12345678901234567890'] }
  }]
}
window.electronAPI = new Proxy(original, { get(target, key: string) {
  return key in handlers ? async (...args: any[]) => handlers[key](...args) : Reflect.get(target, key)
} })
fixture.store.setState({ campaigns, campaignConfigs: Object.fromEntries(campaigns.map((row: any) => [row.id, row])),
  campaignActions: [
    { id: 'facebook_find_data_search', name: 'Tìm data bằng search', flatformType: 'facebook', isActive: true, isDelete: false },
    { id: 'facebook_find_data_group', name: 'Tìm data trong group', flatformType: 'facebook', isActive: true, isDelete: false }
  ]
})
