// Real CampaignPanel/store; extend the isolated fixture without network or production data.
import './campaign-data-sort-ui-smoke'

const fixture = (window as any).sortSmoke
const original = window.electronAPI
const campaigns = fixture.store.getState().campaigns.map((campaign: any) => ({
  ...campaign,
  actionId: campaign.id === 91 ? 'facebook_find_data_search' : 'facebook_find_data_group'
}))
const groupUrl = 'https://www.facebook.com/groups/12345678901234567890/'
const firstRunAt = '2026-09-27T12:40:57.000Z'
const secondRunAt = '2026-09-27T12:52:53.000Z'
const details = [
  { id: 1, campaignId: 91, accountId: 41, createdAt: firstRunAt, data: {
    groupUrl: 'hải hậu', searchKeyword: 'hải hậu',
    phones: ['0901234567'], uids: ['12345678901234567890'],
    facebookGroups: [
      { url: groupUrl.slice(0, -1), name: '', memberCount: '651', postsPerDay: 2, privacy: 'Private', keyword: 'hải hậu' },
      { url: 'https://www.facebook.com/groups/missing', name: '=Tên nhóm', memberCount: null, postsPerDay: '', privacy: '' },
      { url: 'https://www.facebook.com/groups/zero', name: 'Số không', memberCount: 0, postsPerDay: 0, privacy: 'Private' },
      { url: 'https://www.facebook.com/groups/zero-string', name: 'Số không dạng chuỗi', postsPerDay: '0' },
      { url: 'https://www.facebook.com/groups/filled', name: 'Bổ sung số liệu', postsPerDay: 0 },
      // Block cũ, tài khoản giao diện tiếng Anh: tên dính tiền tố, số bài 0.
      { url: 'https://www.facebook.com/groups/english', name: 'Profile photo of Nhóm tiếng Anh', memberCount: 7500, postsPerDay: 0, privacy: 'Công khai', keyword: 'hải hậu' },
      // Kết quả đã lưu đủ trường thêm (block mới): giữ nguyên, không trộn thẻ log.
      { url: 'https://www.facebook.com/groups/stored', name: 'Đã lưu đủ', memberCount: 500, postsPerDay: 4, privacy: 'Công khai',
        postsText: '4', joinState: 'not_joined', friendMemberCount: 3, cardVersion: 2 }
    ]
  } },
  { id: 2, campaignId: 91, accountId: 41, createdAt: secondRunAt, data: { groupUrl: 'ninh cường', searchKeyword: 'ninh cường', facebookGroups: [
    { url: groupUrl, name: 'Hải Minh - Hải Hậu', memberCount: 300, postsPerDay: 1, privacy: 'Public' },
    { url: 'https://www.facebook.com/groups/filled/', name: '', memberCount: 1200, postsPerDay: '5', privacy: 'Public' }
  ] } }
]
const cards = [
  { key: 'facebook.com/groups/english', seenAt: firstRunAt, card: { name: 'Nhóm tiếng Anh', privacy: 'Công khai', memberCount: 7500,
    postsPerDay: 90, postsText: '90+', friendMemberCount: 2, joinState: 'not_joined' } },
  { key: 'facebook.com/groups/12345678901234567890', seenAt: secondRunAt, card: { privacy: 'Riêng tư', memberCount: 651,
    unreadPosts: 3, memberSince: '02/2026', friendMemberCount: 1, joinState: 'joined' } },
  { key: 'facebook.com/groups/stored', seenAt: secondRunAt, card: { postsPerDay: 9, postsText: '9', unreadPosts: 1,
    friendMemberCount: 8, joinState: 'joined' } }
]
const state = fixture.state
state.cardCalls = []
state.cardResult = 'ok'
const handlers: Record<string, any> = {
  getDesktopCampaignPage: (query: any) => ({ items: campaigns,
    selected: campaigns.find((row: any) => row.id === query.selectedId) || null,
    order: campaigns.map((row: any) => ({ kind: 'campaign', id: String(row.id) })),
    total: 2, campaignTotal: 2, page: 1, pageSize: 100, actionOptions: [] }),
  getCampaignConfig: (id: number) => campaigns.find((row: any) => row.id === id),
  getDesktopCampaignConfig: (id: number) => campaigns.find((row: any) => row.id === id),
  listCampaignDetailsByCampaign: (id: number) => id === 91 ? details : [{
    id: 3, campaignId: 92, accountId: 41, data: { phones: ['0901234567'], uids: ['12345678901234567890'],
      phoneProfiles: [{ phone: '0901234567', name: 'Người đăng', uid: '100000000000001', url: 'https://www.facebook.com/profile.php?id=100000000000001', source: 'post' }],
      uidProfiles: [{ uid: '12345678901234567890', name: '', url: '', source: 'mystery_source' }],
      groupMembers: [{ uid: '100000000000009', name: 'Thành viên mới', url: 'https://www.facebook.com/100000000000009' }] }
  }],
  getFoundFacebookGroupCards: async (request: any) => {
    state.cardCalls.push(request)
    if (state.holdCards) await new Promise(resolve => { state.releaseCards = resolve })
    if (state.cardResult === 'fail') return { ok: false, code: 'cards_unavailable', message: 'Chưa đọc được log chạy của chiến dịch.' }
    if (state.cardResult === 'throw') throw new Error('IPC closed')
    return { ok: true, data: { cards, scannedRows: 3, truncated: false } }
  }
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
