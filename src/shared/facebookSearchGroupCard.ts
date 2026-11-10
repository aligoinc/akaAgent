/**
 * Đọc chữ trên thẻ nhóm ở trang kết quả Facebook Search (`/search/groups`), giao diện tiếng Việt và tiếng Anh.
 *
 * Nguồn: `debug_data.rawText` của event `extract_facebook_group_data` mà block `fb_collect_search_groups` ghi
 * (nguyên văn chữ của thẻ, có từ 05/06/2026), ví dụ:
 *   `<tên> Công khai · 1,6K thành viên · 20+ bài viết/ngày 5 người bạn là thành viên Tham gia`
 *   `<tên> Public · 1.6K members · 25 unread posts · Member since February 2026 3 friends are members Visit`
 * Mẫu chữ không nhận ra thì để trống, không đoán. TypeScript thuần (không Electron/Node) để dùng ở main, renderer
 * và chép sang WebApp. Hợp đồng: docs/FACEBOOK_SEARCH_GROUP_EXPORT_PLAN.md.
 */

export type FacebookGroupJoinState = 'joined' | 'not_joined' | 'requested'

export interface FacebookSearchGroupCard {
  name?: string
  privacy?: 'Công khai' | 'Riêng tư'
  memberCount?: number
  /** Số bài/ngày Facebook hiện, luôn > 0; `90+` → 90. */
  postsPerDay?: number
  /** Nguyên văn số bài Facebook hiện, ví dụ `90+`, `7`. */
  postsText?: string
  /** Chỉ nhóm tài khoản đã tham gia: Facebook hiện số bài chưa đọc thay cho số bài/ngày. */
  unreadPosts?: number
  /** Số bạn bè của tài khoản đã tìm có trong nhóm; Facebook không hiện khi bằng 0. */
  friendMemberCount?: number
  /** Theo tài khoản đã tìm. */
  joinState?: FacebookGroupJoinState
  /** `MM/YYYY`, `YYYY` hoặc `Mới tham gia`. */
  memberSince?: string
}

const UNIT_MULTIPLIERS: Record<string, number> = { k: 1e3, n: 1e3, 'nghìn': 1e3, m: 1e6, tr: 1e6, 'triệu': 1e6 }
const NUMBER = String.raw`(\d[\d.,]*)`
const UNIT = String.raw`(K|N|M|Tr|triệu|nghìn)?`
const MEMBERS_WORD = String.raw`(?:thành viên|members?)(?![\p{L}\p{N}])`
const PRIVACY_WORD = String.raw`(Công khai|Riêng tư|Public|Private)`

const NOT_AFTER_WORD = String.raw`(?<![\p{L}\p{N}])`
const PRIVACY_MEMBERS = new RegExp(String.raw`${NOT_AFTER_WORD}${PRIVACY_WORD}\s*·\s*${NUMBER}\s*${UNIT}\s*${MEMBERS_WORD}`, 'giu')
const PRIVACY_ONLY = new RegExp(String.raw`${NOT_AFTER_WORD}${PRIVACY_WORD}\s*·`, 'giu')
const MEMBERS_ONLY = new RegExp(String.raw`(?:^|[\s·])${NUMBER}\s*${UNIT}\s*${MEMBERS_WORD}`, 'iu')
const POSTS_PER_DAY = new RegExp(String.raw`${NUMBER}\s*(\+)?\s*(?:bài viết\s*\/\s*ngày|posts?\s+(?:a|per)\s+day)`, 'iu')
const UNREAD_POSTS = new RegExp(String.raw`${NUMBER}\s*\+?\s*(?:bài viết chưa đọc|unread posts?)`, 'iu')
const FRIEND_MEMBERS = new RegExp(String.raw`${NUMBER}\s*(?:người bạn là thành viên|friends?\s+(?:is|are)\s+(?:a\s+)?members?)`, 'iu')
const MEMBER_SINCE_VI_MONTH = /Là thành viên từ tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i
const MEMBER_SINCE_VI_YEAR = /Là thành viên từ năm\s*(\d{4})/i
const MEMBER_SINCE_EN_MONTH = /Member since\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
const MEMBER_SINCE_EN_YEAR = /Member since\s+(\d{4})/i
const RECENTLY_JOINED = /Mới tham gia|Recently joined|Joined recently/i
const REQUESTED_END = /(?:Đang chờ xem xét|Đã gửi yêu cầu|Hủy yêu cầu|Huỷ yêu cầu|Requested|Pending(?: review)?|Cancel request)\s*$/i
const JOINED_END = /(?:Truy cập|Visit)\s*$/i
const JOINED_SIGNAL = /Là thành viên từ|Member since|Mới tham gia|Recently joined|Joined recently|Bạn hiện là thành viên|You are in this group|bài viết chưa đọc|unread posts?/i
const NOT_JOINED_END = /(?:Tham gia|Join)\s*$/i
const AVATAR_PREFIX = /^(?:Profile photo of|Ảnh đại diện của)\s+/i
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

const normalizeText = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim()

/** Lần khớp cuối: tên nhóm đứng trước phần thông tin, nên nếu tên có chữ giống "Công khai · 5 thành viên" thì vẫn lấy đúng phần thật. */
function lastMatch(pattern: RegExp, text: string): RegExpMatchArray | null {
  const matches = Array.from(text.matchAll(pattern))
  return matches.length > 0 ? matches[matches.length - 1] : null
}

/** Số Facebook hiện trên thẻ: `16K`, `1,6K`, `7.5K`, `1 triệu`, `899`, `1.234`. Không đọc được → undefined. */
export function parseFacebookCount(numberText: string, unit = ''): number | undefined {
  const text = numberText.trim()
  if (!/^\d[\d.,]*$/.test(text)) return undefined
  const multiplier = UNIT_MULTIPLIERS[unit.trim().toLowerCase()] ?? 1
  const value = multiplier > 1 || !/^\d{1,3}(?:[.,]\d{3})+$/.test(text)
    // Có đơn vị (hoặc không phải dạng nghìn có dấu tách): dấu phẩy là dấu thập phân kiểu Việt.
    ? Number(text.replace(',', '.'))
    : Number(text.replace(/[.,]/g, ''))
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.round(value * multiplier)
}

/** Bỏ tiền tố của link ảnh đại diện (`Profile photo of …`, `Ảnh đại diện của …`) mà block cũ có thể lấy làm tên. */
export function cleanFacebookGroupName(value: unknown): string {
  return normalizeText(value).replace(AVATAR_PREFIX, '').trim()
}

/** Khoá so khớp một nhóm giữa kết quả chạy và log: `facebook.com/groups/<id hoặc slug>`, chữ thường. */
export function facebookGroupUrlKey(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    const parts = url.pathname.split('/').filter(Boolean)
    const index = parts.findIndex(part => part.toLowerCase() === 'groups')
    const key = index >= 0 ? parts[index + 1] : ''
    if (key && /(^|\.)facebook\.com$/i.test(url.hostname)) {
      let decoded = key
      try { decoded = decodeURIComponent(key) } catch {}
      return `facebook.com/groups/${decoded.toLowerCase()}`
    }
  } catch {}
  return text.replace(/\/+$/g, '').toLowerCase()
}

function memberSince(text: string): string | undefined {
  const viMonth = MEMBER_SINCE_VI_MONTH.exec(text)
  if (viMonth) {
    const month = Number(viMonth[1])
    if (month >= 1 && month <= 12) return `${String(month).padStart(2, '0')}/${viMonth[2]}`
  }
  const enMonth = MEMBER_SINCE_EN_MONTH.exec(text)
  if (enMonth) return `${String(EN_MONTHS.indexOf(enMonth[1].toLowerCase()) + 1).padStart(2, '0')}/${enMonth[2]}`
  const year = MEMBER_SINCE_VI_YEAR.exec(text) || MEMBER_SINCE_EN_YEAR.exec(text)
  if (year) return year[1]
  return RECENTLY_JOINED.test(text) ? 'Mới tham gia' : undefined
}

function joinState(text: string): FacebookGroupJoinState | undefined {
  if (REQUESTED_END.test(text)) return 'requested'
  if (JOINED_END.test(text) || JOINED_SIGNAL.test(text)) return 'joined'
  return NOT_JOINED_END.test(text) ? 'not_joined' : undefined
}

/** Đọc một thẻ nhóm; chỉ trả trường đọc được. */
export function parseFacebookSearchGroupCard(rawText: unknown): FacebookSearchGroupCard {
  const text = normalizeText(rawText)
  if (!text) return {}
  const card: FacebookSearchGroupCard = {}

  // Phần sau "Công khai ·"/"Public ·" là thông tin nhóm; phần trước là tên. Chỉ tìm trong phần sau để tên nhóm có
  // chữ như "10 bài viết/ngày" không bị đọc nhầm.
  const anchored = lastMatch(PRIVACY_MEMBERS, text)
  const privacyMatch = anchored || lastMatch(PRIVACY_ONLY, text)
  let tail = text
  if (privacyMatch && privacyMatch.index !== undefined) {
    const name = cleanFacebookGroupName(text.slice(0, privacyMatch.index))
    if (name) card.name = name
    tail = text.slice(privacyMatch.index)
    card.privacy = /^(Riêng tư|Private)$/i.test(privacyMatch[1]) ? 'Riêng tư' : 'Công khai'
  }

  const members = anchored ? { number: anchored[2], unit: anchored[3] } : (() => {
    const match = MEMBERS_ONLY.exec(tail)
    return match ? { number: match[1], unit: match[2] } : null
  })()
  if (members) {
    const count = parseFacebookCount(members.number, members.unit || '')
    if (count !== undefined) card.memberCount = count
  }

  const posts = POSTS_PER_DAY.exec(tail)
  if (posts) {
    const count = parseFacebookCount(posts[1])
    if (count !== undefined && count > 0) {
      card.postsPerDay = count
      card.postsText = `${count}${posts[2] ? '+' : ''}`
    }
  }

  const unread = UNREAD_POSTS.exec(tail)
  const unreadCount = unread ? parseFacebookCount(unread[1]) : undefined
  if (unreadCount !== undefined) card.unreadPosts = unreadCount

  const friends = FRIEND_MEMBERS.exec(tail)
  const friendCount = friends ? parseFacebookCount(friends[1]) : undefined
  if (friendCount !== undefined) card.friendMemberCount = friendCount

  const since = memberSince(tail)
  if (since) card.memberSince = since
  const state = joinState(tail)
  if (state) card.joinState = state
  return card
}

/**
 * Các trường thêm mà một nhóm trong kết quả chạy (`auto_campaign_details.data.facebookGroups[]`) có thể mang kèm khi
 * block gửi (đánh dấu `cardVersion` ≥ 2). Block hiện tại chưa gửi; bộ chạy và bản xuất đã nhận sẵn.
 */
export interface FacebookSearchGroupCardFields {
  postsText?: string
  unreadPosts?: number
  friendMemberCount?: number
  joinState?: FacebookGroupJoinState
  memberSince?: string
  cardVersion?: number
}

const JOIN_STATES: ReadonlySet<string> = new Set<FacebookGroupJoinState>(['joined', 'not_joined', 'requested'])

const nonNegativeInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}

/** Đọc các trường thêm từ payload không tin cậy; trường sai kiểu/sai mẫu bị bỏ. */
export function readFacebookSearchGroupCardFields(value: unknown): FacebookSearchGroupCardFields {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const fields: FacebookSearchGroupCardFields = {}
  const postsText = typeof row.postsText === 'string' ? row.postsText.trim() : ''
  if (/^[1-9]\d{0,5}\+?$/.test(postsText)) fields.postsText = postsText
  const unread = nonNegativeInteger(row.unreadPosts)
  if (unread !== undefined) fields.unreadPosts = unread
  const friends = nonNegativeInteger(row.friendMemberCount)
  if (friends !== undefined) fields.friendMemberCount = friends
  if (typeof row.joinState === 'string' && JOIN_STATES.has(row.joinState)) fields.joinState = row.joinState as FacebookGroupJoinState
  const since = typeof row.memberSince === 'string' ? row.memberSince.trim() : ''
  if (/^(?:(?:0[1-9]|1[0-2])\/\d{4}|\d{4}|Mới tham gia)$/.test(since)) fields.memberSince = since
  const version = nonNegativeInteger(row.cardVersion)
  if (version !== undefined && version > 0) fields.cardVersion = version
  return fields
}

const CARD_FIELDS: ReadonlyArray<keyof FacebookSearchGroupCard> = [
  'name', 'privacy', 'memberCount', 'postsPerDay', 'postsText', 'unreadPosts', 'friendMemberCount', 'joinState', 'memberSince'
]

/**
 * Gộp các thẻ của cùng một nhóm, xếp từ mới tới cũ: mỗi trường lấy theo thẻ mới nhất có giá trị (như cách Excel
 * gộp các lượt chạy). Số bài và nguyên văn số bài đi theo cặp để không lệch nhau.
 */
export function mergeFacebookSearchGroupCards(cardsNewestFirst: ReadonlyArray<FacebookSearchGroupCard>): FacebookSearchGroupCard {
  const merged: FacebookSearchGroupCard = {}
  const target = merged as Record<string, unknown>
  for (const card of cardsNewestFirst) {
    for (const field of CARD_FIELDS) {
      if (field === 'postsText') continue
      if (target[field] === undefined && card[field] !== undefined) {
        target[field] = card[field]
        if (field === 'postsPerDay') merged.postsText = card.postsText
      }
    }
  }
  return merged
}
