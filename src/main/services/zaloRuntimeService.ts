import { promises as fs } from 'node:fs'
import { Zalo, LoginQRCallbackEventType, ThreadType, ZaloApiError, FriendRecommendationsType } from 'zca-js'
import type { API, AttachmentSource, Credentials, GroupEvent, ImageMetadataGetterResponse, LabelData, LoginQRCallbackEvent, Message, MessageContent, Options as ZaloOptions, ProfileInfo, Reaction, UserBasic } from 'zca-js'
import { AutoAccount, AutoProxy, ZaloLabelOption, ZaloLoginQrEvent, ZaloLoginQrStartResult, ZaloSessionCheckResult, ZaloSessionCredentials } from '../../shared/types'
import { SupabaseService } from './supabase'

const DEFAULT_ZALO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
const DEFAULT_LANGUAGE = 'vi'

interface ActiveQrLogin {
  accountId: number
  abort?: () => unknown
  cancelRequested: boolean
}

interface CachedZaloApi {
  accountId: number
  api: API
  proxyId?: number | null
  sessionUpdatedAt?: string | null
  lastVerifiedAt?: string | null
  lastError?: string | null
}

type ZaloListenerStatus = 'idle' | 'starting' | 'running' | 'disconnected' | 'closed' | 'error' | 'stopped'

interface ZaloListenerState {
  accountId: number
  api: API
  status: ZaloListenerStatus
  ready: boolean
  handlersAttached: boolean
  startPromise?: Promise<void>
  readyAt?: number
  lastEventAt?: number
  lastError?: string | null
}

export interface ZaloListenerStatusEvent {
  accountId: number
  status: ZaloListenerStatus
  ready: boolean
  code?: number
  reason?: string
  error?: string | null
}

export interface ZaloRealtimeListenerHandlers {
  groupEvent?: (event: GroupEvent) => unknown
  message?: (message: Message) => unknown
  reaction?: (reaction: Reaction) => unknown
  status?: (event: ZaloListenerStatusEvent) => unknown
}

type ZaloProfile = {
  userId?: unknown
  uid?: unknown
  globalId?: unknown
  username?: unknown
  displayName?: unknown
  zaloName?: unknown
  zalo_name?: unknown
  display_name?: unknown
  gender?: unknown
  avatar?: unknown
  phoneNumber?: unknown
}

type ImageDimensions = {
  width: number
  height: number
}

export interface ZaloForwardMessageTargetResult {
  threadId: string
  ok: boolean
  raw?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

export interface ZaloForwardMessageResult {
  response: unknown
  results: ZaloForwardMessageTargetResult[]
  successCount: number
  failCount: number
}

interface ZaloForwardMessageRequestTarget {
  threadId: string
  clientId: number
}

interface ZaloRawForwardMessagePayload {
  targets: ZaloForwardMessageRequestTarget[]
  type: ThreadType
  message: string
}

type ZaloRawForwardMessageApi = API & {
  akaForwardMessageBatch?: (payload: ZaloRawForwardMessagePayload) => Promise<unknown>
}

async function getZaloImageMetadata(filePath: string): Promise<ImageMetadataGetterResponse> {
  const data = await fs.readFile(filePath)
  const dimensions = getImageDimensions(data)
  if (!dimensions) return null
  return {
    width: dimensions.width,
    height: dimensions.height,
    size: data.length
  }
}

function getImageDimensions(data: Buffer): ImageDimensions | null {
  return getPngDimensions(data)
    || getJpegDimensions(data)
    || getGifDimensions(data)
    || getWebpDimensions(data)
}

function getPngDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 24) return null
  if (
    data[0] !== 0x89
    || data[1] !== 0x50
    || data[2] !== 0x4e
    || data[3] !== 0x47
    || data[4] !== 0x0d
    || data[5] !== 0x0a
    || data[6] !== 0x1a
    || data[7] !== 0x0a
  ) {
    return null
  }
  return normalizeImageDimensions(data.readUInt32BE(16), data.readUInt32BE(20))
}

function getGifDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 10) return null
  const signature = data.subarray(0, 6).toString('ascii')
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null
  return normalizeImageDimensions(data.readUInt16LE(6), data.readUInt16LE(8))
}

function getJpegDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null

  let offset = 2
  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (offset < data.length && data[offset] === 0xff) offset += 1
    const marker = data[offset]
    offset += 1

    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > data.length) break

    const segmentLength = data.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > data.length) break

    if (isJpegStartOfFrameMarker(marker)) {
      const segmentStart = offset + 2
      if (segmentStart + 5 > data.length) break
      return normalizeImageDimensions(
        data.readUInt16BE(segmentStart + 3),
        data.readUInt16BE(segmentStart + 1)
      )
    }

    offset += segmentLength
  }

  return null
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return marker >= 0xc0
    && marker <= 0xcf
    && marker !== 0xc4
    && marker !== 0xc8
    && marker !== 0xcc
}

function getWebpDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 30) return null
  if (data.subarray(0, 4).toString('ascii') !== 'RIFF') return null
  if (data.subarray(8, 12).toString('ascii') !== 'WEBP') return null

  const chunkType = data.subarray(12, 16).toString('ascii')
  if (chunkType === 'VP8X') {
    return normalizeImageDimensions(readUInt24LE(data, 24) + 1, readUInt24LE(data, 27) + 1)
  }

  if (chunkType === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return normalizeImageDimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff)
  }

  if (chunkType === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
    const b0 = data[21]
    const b1 = data[22]
    const b2 = data[23]
    const b3 = data[24]
    return normalizeImageDimensions(
      1 + (((b1 & 0x3f) << 8) | b0),
      1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    )
  }

  return null
}

function readUInt24LE(data: Buffer, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16)
}

function normalizeImageDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export interface ZaloFoundUser {
  uid: string
  phone?: string
  displayName?: string
  originalName?: string
  gender?: number | string | null
  avatar?: string
  raw: Record<string, unknown>
}

export interface ZaloFriendRecommendationProfile {
  uid: string
  name: string
  displayName?: string
  zaloName?: string
  phone?: string
  avatar?: string
  gender?: number | null
  dob?: number | null
  raw: Record<string, unknown>
}

export interface ZaloFriendRecommendationSnapshot {
  profiles: ZaloFriendRecommendationProfile[]
  totalItems: number
  recommendedItems: number
  missingUidItems: number
  hasRecommendationList: boolean
}

export interface ZaloFriendRequestStatus {
  isFriend: boolean
  isRequested: boolean
  isRequesting: boolean
  addFriendPrivacy?: number
  raw: Record<string, unknown>
}

export interface ZaloGroupInfoBatch {
  gridInfoMap: Record<string, Record<string, unknown>>
  removedsGroup: string[]
  unchangedsGroup: string[]
}

export type ZaloGroupMemberRole = 'owner' | 'admin' | 'member'

export interface ZaloGroupMemberInfo {
  zaloGroupId: string
  zaloUid: string
  displayName?: string | null
  zaloName?: string | null
  avatar?: string | null
  accountStatus?: number | null
  type?: number | null
  lastUpdateTime?: number | null
  globalId?: string | null
  role: ZaloGroupMemberRole
  roleRank: 1 | 2 | 3
  isCreator: boolean
  isAdmin: boolean
  rawPayload: Record<string, unknown>
}

export interface ZaloGroupMembersResult {
  group: Record<string, unknown>
  members: ZaloGroupMemberInfo[]
  usedProxy?: boolean
}

export type ZaloJoinGroupLinkOutcome = 'joined' | 'already_joined' | 'pending_approval'

export interface ZaloJoinGroupLinkResult {
  link: string
  group: Record<string, unknown>
  groupId: string
  groupName?: string
  outcome: ZaloJoinGroupLinkOutcome
  response?: unknown
  zaloCode?: string
  zaloMessage?: string
}

const ZALO_GROUP_MEMBER_PROFILE_BATCH_SIZE = 300
const ZALO_GROUP_LINK_MAX_MEMBER_PAGES = 500
const ZALO_GROUP_LINK_GINFO_PROXY_SETTING_KEY = 'zalo.group_link.ginfo_proxy_url'
const ZALO_LISTENER_READY_TIMEOUT_MS = 20_000
const ZALO_LISTENER_REFRESH_AFTER_MS = 30 * 60 * 1000
const ZALO_MESSAGE_SEND_TIMEOUT_MS = 90_000
const ZALO_FILE_MESSAGE_SEND_TIMEOUT_MS = 180_000
const ZALO_ATTACHMENT_EXTENSIONS_WITHOUT_UPLOAD_CALLBACK = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

export class ZaloRuntimeService {
  private activeQrLogins = new Map<number, ActiveQrLogin>()
  private apiCache = new Map<number, CachedZaloApi>()
  private apiLoginInflight = new Map<number, Promise<API>>()
  private verifyInflight = new Map<number, Promise<void>>()
  private listenerStates = new Map<number, ZaloListenerState>()
  private realtimeListenerSubscribers = new Map<number, Set<ZaloRealtimeListenerHandlers>>()
  private accountCacheVersions = new Map<number, number>()
  private cacheVersion = 0

  constructor(
    private readonly supabase: SupabaseService,
    private readonly getProxyById: (id: number) => Promise<AutoProxy | null>,
    private readonly emitLoginQrEvent: (event: ZaloLoginQrEvent) => void
  ) {}

  async startLoginQr(accountId: number): Promise<ZaloLoginQrStartResult> {
    const account = await this.supabase.getAccount(accountId)
    if (!account) return { success: false, accountId, reason: 'Không tìm thấy tài khoản' }
    if (account.flatformType !== 'zalo') {
      return { success: false, accountId, reason: 'Tài khoản không phải nền tảng Zalo' }
    }

    this.cancelLoginQr(accountId)
    this.invalidateAccount(accountId)
    const active: ActiveQrLogin = { accountId, cancelRequested: false }
    this.activeQrLogins.set(accountId, active)
    void this.runLoginQr(account, active)
    return { success: true, accountId }
  }

  cancelLoginQr(accountId: number): void {
    const active = this.activeQrLogins.get(accountId)
    if (!active) return
    active.cancelRequested = true
    try { active.abort?.() } catch {}
    this.activeQrLogins.delete(accountId)
    this.emitLoginQrEvent({
      accountId,
      status: 'cancelled',
      message: 'Đã huỷ đăng nhập Zalo'
    })
  }

  async ensureApi(accountId: number): Promise<API> {
    const entry = await this.supabase.getAccountZaloSession(accountId)
    if (!entry) throw new Error('Không tìm thấy tài khoản')
    if (entry.account.flatformType !== 'zalo') throw new Error('Tài khoản không phải nền tảng Zalo')
    if (!entry.session) throw new Error('Chưa có session Zalo')

    const cached = this.apiCache.get(accountId)
    if (cached && this.isCachedApiFresh(cached, entry.account)) {
      return cached.api
    }
    if (cached) this.apiCache.delete(accountId)

    const inflight = this.apiLoginInflight.get(accountId)
    if (inflight) return inflight

    const version = this.cacheVersion
    const accountVersion = this.getAccountCacheVersion(accountId)
    let promise!: Promise<API>
    promise = this.loginWithSession(entry.account, entry.session)
      .then((api) => {
        if (this.cacheVersion === version && this.getAccountCacheVersion(accountId) === accountVersion) {
          this.cacheApi(entry.account, api)
        }
        return api
      })
      .catch((err) => {
        this.apiCache.delete(accountId)
        throw err
      })
      .finally(() => {
        if (this.apiLoginInflight.get(accountId) === promise) {
          this.apiLoginInflight.delete(accountId)
        }
      })

    this.apiLoginInflight.set(accountId, promise)
    return promise
  }

  subscribeRealtimeListener(accountId: number, handlers: ZaloRealtimeListenerHandlers): () => void {
    let subscribers = this.realtimeListenerSubscribers.get(accountId)
    if (!subscribers) {
      subscribers = new Set()
      this.realtimeListenerSubscribers.set(accountId, subscribers)
    }
    subscribers.add(handlers)

    return () => {
      const current = this.realtimeListenerSubscribers.get(accountId)
      if (!current) return
      current.delete(handlers)
      if (current.size === 0) {
        this.realtimeListenerSubscribers.delete(accountId)
      }
    }
  }

  async ensureRealtimeListenerReady(accountId: number): Promise<void> {
    const api = await this.ensureApi(accountId)
    await this.ensureZaloListenerReady(accountId, api)
  }

  async warmStoredSessions(): Promise<void> {
    const version = this.cacheVersion
    const entries = await this.supabase.listZaloAccountsWithSession()
    if (entries.length > 0) {
      console.log(`[ZaloRuntime] Warming ${entries.length} stored Zalo session(s).`)
    }

    for (const entry of entries) {
      if (this.cacheVersion !== version) return
      try {
        await this.verifyAccountSession(entry.account.id)
        if (this.cacheVersion !== version) return
        const account = await this.supabase.markAccountZaloSessionCheck(entry.account.id, { ok: true })
        this.updateCachedVerification(account)
      } catch (err) {
        if (this.cacheVersion !== version) return
        const message = this.getErrorMessage(err)
        console.warn('[ZaloRuntime] Failed to warm stored session', {
          accountId: entry.account.id,
          message
        })
        this.invalidateAccount(entry.account.id)
        await this.supabase.markAccountZaloSessionCheck(entry.account.id, {
          ok: false,
          error: message
        }).catch(() => {})
      }
    }
  }

  invalidateAccount(accountId: number): void {
    this.accountCacheVersions.set(accountId, this.getAccountCacheVersion(accountId) + 1)
    this.stopZaloListener(accountId)
    this.apiCache.delete(accountId)
    this.apiLoginInflight.delete(accountId)
  }

  clearAll(): void {
    this.cacheVersion += 1
    for (const active of this.activeQrLogins.values()) {
      active.cancelRequested = true
      try { active.abort?.() } catch {}
    }
    this.activeQrLogins.clear()
    this.stopAllZaloListeners()
    this.realtimeListenerSubscribers.clear()
    this.apiCache.clear()
    this.apiLoginInflight.clear()
    this.verifyInflight.clear()
    this.accountCacheVersions.clear()
  }

  async checkSession(accountId: number): Promise<ZaloSessionCheckResult> {
    const entry = await this.supabase.getAccountZaloSession(accountId)
    if (!entry) {
      return { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Không tìm thấy tài khoản' }
    }
    if (entry.account.flatformType !== 'zalo') {
      return { success: false, loggedIn: false, status: entry.account.loginStatus, reason: 'Tài khoản không phải nền tảng Zalo' }
    }
    if (!entry.session) {
      const account = await this.supabase.markAccountZaloSessionCheck(accountId, { ok: false, error: 'Chưa có session Zalo' })
      return { success: true, loggedIn: false, status: account.loginStatus, reason: 'Chưa có session Zalo', account }
    }

    try {
      await this.verifyAccountSession(accountId)
      const account = await this.supabase.markAccountZaloSessionCheck(accountId, { ok: true })
      this.updateCachedVerification(account)
      return { success: true, loggedIn: true, status: account.loginStatus, account }
    } catch (err) {
      const message = this.getErrorMessage(err)
      this.invalidateAccount(accountId)
      const account = await this.supabase.markAccountZaloSessionCheck(accountId, { ok: false, error: message })
      return { success: true, loggedIn: false, status: account.loginStatus, reason: message, account }
    }
  }

  async logout(accountId: number): Promise<ZaloSessionCheckResult> {
    this.cancelLoginQr(accountId)
    this.invalidateAccount(accountId)
    const account = await this.supabase.clearAccountZaloSession(accountId)
    return {
      success: true,
      loggedIn: false,
      status: account.loginStatus,
      account
    }
  }

  async listLabels(accountId: number): Promise<ZaloLabelOption[]> {
    const api = await this.ensureApi(accountId)
    const response = await api.getLabels()
    return (Array.isArray(response?.labelData) ? response.labelData : [])
      .map(label => ({
        id: Number(label.id),
        text: String(label.text || '').trim(),
        textKey: String(label.textKey || '').trim() || undefined,
        color: String(label.color || '').trim() || undefined,
        emoji: String(label.emoji || '').trim() || undefined,
        conversations: Array.from(new Set(
          (Array.isArray(label.conversations) ? label.conversations : [])
            .map(item => String(item || '').trim())
            .filter(Boolean)
        ))
      }))
      .filter(label => Number.isFinite(label.id) && label.id > 0 && label.text)
  }

  async getLabelConversationUids(accountId: number, labelId: number | string): Promise<string[]> {
    const api = await this.ensureApi(accountId)
    const id = Number(labelId)
    if (!Number.isFinite(id) || id <= 0) throw new Error('Tag Zalo không hợp lệ')
    const response = await api.getLabels()
    const labels = Array.isArray(response?.labelData) ? response.labelData : []
    const label = labels.find(item => Number(item.id) === id)
    if (!label) throw new Error('Tag Zalo không tồn tại')
    return Array.from(new Set(
      (Array.isArray(label.conversations) ? label.conversations : [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
    ))
  }

  async getAllFriendsPage(accountId: number, count = 500, page = 1): Promise<Record<string, unknown>[]> {
    const api = await this.ensureApi(accountId)
    const response = await api.getAllFriends(count, page)
    return Array.isArray(response) ? response.map(item => normalizeRecord(item)) : []
  }

  async getFriendRecommendations(accountId: number): Promise<ZaloFriendRecommendationSnapshot> {
    const api = await this.ensureApi(accountId)
    const response = await api.getFriendRecommendations()
    const rawItems = Array.isArray((response as any)?.recommItems)
      ? (response as any).recommItems
      : []
    const profiles: ZaloFriendRecommendationProfile[] = []
    let recommendedItems = 0
    let missingUidItems = 0

    for (const item of rawItems) {
      const record = normalizeRecord(item)
      const dataInfo = normalizeRecord(record.dataInfo)
      if (Number(dataInfo.recommType) !== FriendRecommendationsType.RecommendedFriend) continue
      recommendedItems += 1

      const uid = firstString(dataInfo.userId, dataInfo.uid, dataInfo.id)
      if (!uid) {
        missingUidItems += 1
        continue
      }

      const displayName = firstString(dataInfo.displayName, dataInfo.display_name) || undefined
      const zaloName = firstString(dataInfo.zaloName, dataInfo.zalo_name) || undefined
      const name = firstString(displayName, zaloName) || ''
      profiles.push({
        uid,
        name,
        displayName,
        zaloName,
        phone: firstString(dataInfo.phoneNumber, dataInfo.phone) || undefined,
        avatar: firstString(dataInfo.avatar) || undefined,
        gender: nullableNumber(dataInfo.gender),
        dob: nullableNumber(dataInfo.dob),
        raw: {
          ...dataInfo,
          recommItem: record
        }
      })
    }

    return {
      profiles,
      totalItems: rawItems.length,
      recommendedItems,
      missingUidItems,
      hasRecommendationList: Array.isArray((response as any)?.recommItems)
    }
  }

  async getAllGroups(accountId: number): Promise<Record<string, string>> {
    const api = await this.ensureApi(accountId)
    const response = await api.getAllGroups()
    const gridVerMap = normalizeRecord((response as any)?.gridVerMap)
    const groups: Record<string, string> = {}
    for (const [groupId, version] of Object.entries(gridVerMap)) {
      const normalizedGroupId = String(groupId || '').trim()
      if (!normalizedGroupId) continue
      groups[normalizedGroupId] = String(version || '').trim()
    }
    return groups
  }

  async getGroupInfoBatch(accountId: number, groupIds: string[]): Promise<ZaloGroupInfoBatch> {
    const safeGroupIds = Array.from(new Set(
      groupIds.map(groupId => String(groupId || '').trim()).filter(Boolean)
    ))
    if (safeGroupIds.length === 0) {
      return { gridInfoMap: {}, removedsGroup: [], unchangedsGroup: [] }
    }

    const api = await this.ensureApi(accountId)
    const response = await api.getGroupInfo(safeGroupIds)
    const gridInfoMap = normalizeRecord((response as any)?.gridInfoMap)
    const normalizedInfoMap: Record<string, Record<string, unknown>> = {}

    for (const [groupId, info] of Object.entries(gridInfoMap)) {
      const normalizedGroupId = String(groupId || '').trim()
      if (!normalizedGroupId) continue
      normalizedInfoMap[normalizedGroupId] = normalizeRecord(info)
    }

    return {
      gridInfoMap: normalizedInfoMap,
      removedsGroup: toStringArray((response as any)?.removedsGroup),
      unchangedsGroup: toStringArray((response as any)?.unchangedsGroup)
    }
  }

  async getJoinedGroupMembers(accountId: number, groupId: string): Promise<ZaloGroupMembersResult> {
    const api = await this.ensureApi(accountId)
    const normalizedGroupId = normalizeZaloGroupId(groupId)
    if (!normalizedGroupId) throw new Error('Group Zalo không hợp lệ')

    const response = await this.getGroupInfoLegacy(api, normalizedGroupId)
    const gridInfoMap = normalizeRecord(response.gridInfoMap)
    const dataMap = normalizeRecord(response.data)
    const groups = Array.isArray(response.groups) ? response.groups : []
    const groupFromList = groups
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      .find(item => normalizeZaloGroupId(item.groupId) === normalizedGroupId)
    const group = normalizeRecord(
      response[normalizedGroupId]
      || gridInfoMap[normalizedGroupId]
      || dataMap[normalizedGroupId]
      || groupFromList
      || (normalizeZaloGroupId(response.groupId) === normalizedGroupId ? response : null)
    )
    if (!group.groupId && !group.name && !Array.isArray(group.memberIds)) {
      throw new Error('Không lấy được thông tin group Zalo.')
    }

    const memberIds = uniqueStrings([
      ...toStringArray(group.memberIds),
      ...this.getCurrentMembersFromGroupLinkPage(group).map(member => normalizeZaloMemberId(member.id))
    ].map(normalizeZaloMemberId))

    if (memberIds.length === 0) {
      return { group, members: [] }
    }

    const profiles: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < memberIds.length; i += ZALO_GROUP_MEMBER_PROFILE_BATCH_SIZE) {
      const chunk = memberIds.slice(i, i + ZALO_GROUP_MEMBER_PROFILE_BATCH_SIZE)
      const responseProfiles = await this.getGroupMembersInfoBatch(api, chunk)
      for (const [uid, profile] of Object.entries(responseProfiles)) {
        const normalizedUid = normalizeZaloMemberId(uid)
        if (!normalizedUid) continue
        profiles[normalizedUid] = normalizeRecord(profile)
      }
    }

    const members = memberIds.map(memberId => {
      const profile = profiles[memberId] || { id: memberId }
      return this.mapZaloGroupMember(normalizedGroupId, group, profile, 'profile')
    })

    return { group, members }
  }

  async getGroupMembersByLink(accountId: number, link: string): Promise<ZaloGroupMembersResult> {
    const api = await this.ensureApi(accountId)
    const normalizedLink = normalizeZaloGroupLink(link)
    if (!normalizedLink) throw new Error('Link group Zalo không hợp lệ')

    const directFirstPage = await api.getGroupLinkInfo({ link: normalizedLink, memberPage: 1 })
    const firstGroup = normalizeRecord(directFirstPage)
    const firstMembers = this.getCurrentMembersFromGroupLinkPage(firstGroup)
    const firstTotalMember = nullableNumber(firstGroup.totalMember)

    if (firstTotalMember !== null && firstTotalMember > 0 && firstMembers.length === 0) {
      return this.getGroupMembersByLinkFallback(
        api,
        normalizedLink,
        'Zalo trả về group có thành viên nhưng không trả danh sách member. Vui lòng cấu hình proxy fallback cho quét link group Zalo.'
      )
    }

    const collected = await this.collectGroupLinkMemberPages(api, normalizedLink, async (page) => (
      page === 1
        ? firstGroup
        : normalizeRecord(await api.getGroupLinkInfo({ link: normalizedLink, memberPage: page }))
    ))

    const totalMember = nullableNumber(collected.group.totalMember)
    if (collected.members.length === 0) {
      return this.getGroupMembersByLinkFallback(
        api,
        normalizedLink,
        'Zalo không trả danh sách member cho link group này. Vui lòng cấu hình proxy fallback cho quét link group Zalo.'
      )
    }
    if (totalMember === null || totalMember <= 0) {
      return this.getGroupMembersByLinkFallback(
        api,
        normalizedLink,
        'Zalo không trả tổng số thành viên group. Vui lòng cấu hình proxy fallback cho quét link group Zalo.'
      )
    }
    if (collected.members.length * 100 <= totalMember * 70) {
      return this.getGroupMembersByLinkFallback(
        api,
        normalizedLink,
        'Zalo trả danh sách member không đầy đủ. Vui lòng cấu hình proxy fallback cho quét link group Zalo.'
      )
    }
    return collected
  }

  async findUserByPhone(accountId: number, phone: string): Promise<ZaloFoundUser | null> {
    const api = await this.ensureApi(accountId)
    const user = await api.findUser(phone)
    return normalizeFoundUser(user)
  }

  async getUserProfile(accountId: number, uid: string): Promise<ZaloFoundUser | null> {
    const requestedUid = String(uid || '').trim()
    const normalizedUid = normalizeZaloMemberId(requestedUid)
    if (!normalizedUid) return null

    const api = await this.ensureApi(accountId)
    const response = await api.getUserInfo(normalizedUid)
    const profiles = normalizeRecord(response?.changed_profiles)
    const profileEntry = Object.entries(profiles).find(([key]) => normalizeZaloMemberId(key) === normalizedUid)
      || Object.entries(profiles)[0]
    const profile = profileEntry?.[1]
    const user = normalizeFoundUser(profile as ProfileInfo | ZaloProfile | UserBasic | null | undefined)
    if (!user) return null

    return {
      ...user,
      uid: normalizedUid,
      raw: {
        ...user.raw,
        requestedUid,
        getUserInfoKey: profileEntry?.[0] || null
      }
    }
  }

  async getFriendRequestStatus(accountId: number, uid: string): Promise<ZaloFriendRequestStatus> {
    const api = await this.ensureApi(accountId)
    const status = await api.getFriendRequestStatus(uid)
    const raw = normalizeRecord(status)
    return {
      isFriend: Number(status?.is_friend || 0) === 1,
      isRequested: Number(status?.is_requested || 0) === 1,
      isRequesting: Number(status?.is_requesting || 0) === 1,
      addFriendPrivacy: Number.isFinite(Number(status?.addFriendPrivacy)) ? Number(status?.addFriendPrivacy) : undefined,
      raw
    }
  }

  async sendMessageToUser(
    accountId: number,
    uid: string,
    message: string,
    attachments: string[] = []
  ): Promise<unknown> {
    return this.sendMessage(accountId, uid, ThreadType.User, message, attachments)
  }

  async sendMessageToGroup(
    accountId: number,
    groupId: string,
    message: string,
    attachments: string[] = []
  ): Promise<unknown> {
    return this.sendMessage(accountId, groupId, ThreadType.Group, message, attachments)
  }

  async joinGroupByLink(accountId: number, link: string): Promise<ZaloJoinGroupLinkResult> {
    const api = await this.ensureApi(accountId)
    const normalizedLink = normalizeZaloGroupLink(link)
    if (!normalizedLink) throw new Error('Link group Zalo không hợp lệ')

    const group = normalizeRecord(await api.getGroupLinkInfo({ link: normalizedLink, memberPage: 1 }))
    if (!group.link) group.link = normalizedLink
    const groupId = normalizeZaloGroupId(group.groupId)
    const groupName = firstString(group.name)

    try {
      const response = await api.joinGroupLink(normalizedLink)
      return {
        link: normalizedLink,
        group,
        groupId,
        groupName: groupName || undefined,
        outcome: 'joined',
        response
      }
    } catch (err) {
      const zaloCode = this.getApiErrorCode(err)
      if (zaloCode === '178' || zaloCode === '240') {
        return {
          link: normalizedLink,
          group,
          groupId,
          groupName: groupName || undefined,
          outcome: zaloCode === '178' ? 'already_joined' : 'pending_approval',
          zaloCode,
          zaloMessage: this.getErrorMessage(err)
        }
      }
      throw err
    }
  }

  async forwardMessageToUsers(
    accountId: number,
    userIds: string[],
    message: string
  ): Promise<ZaloForwardMessageResult> {
    return this.forwardMessage(accountId, userIds, ThreadType.User, message)
  }

  async forwardMessageToGroups(
    accountId: number,
    groupIds: string[],
    message: string
  ): Promise<ZaloForwardMessageResult> {
    const normalizedGroupIds = groupIds
      .map(groupId => String(groupId || '').trim().replace(/^g/i, ''))
      .filter(Boolean)
    return this.forwardMessage(accountId, normalizedGroupIds, ThreadType.Group, message)
  }

  private async sendMessage(
    accountId: number,
    threadId: string,
    type: ThreadType,
    message: string,
    attachments: string[] = []
  ): Promise<unknown> {
    const api = await this.ensureApi(accountId)
    const safeAttachments = attachments.map(item => String(item || '').trim()).filter(Boolean) as AttachmentSource[]
    const payload: MessageContent = safeAttachments.length > 0
      ? { msg: String(message || ''), attachments: safeAttachments }
      : { msg: String(message || '') }
    const needsUploadCallback = safeAttachments.some(item => requiresZaloUploadCallback(String(item || '')))
    const listenerPromise = this.ensureZaloListenerReady(accountId, api, {
      refreshIfOlderThanMs: needsUploadCallback ? ZALO_LISTENER_REFRESH_AFTER_MS : undefined
    })

    if (needsUploadCallback) {
      await listenerPromise
    } else {
      void listenerPromise.catch((err) => {
        console.warn('[ZaloRuntime] Failed to prepare Zalo listener for message send', {
          accountId,
          message: this.getErrorMessage(err)
        })
      })
    }

    const timeoutMs = needsUploadCallback
      ? ZALO_FILE_MESSAGE_SEND_TIMEOUT_MS
      : ZALO_MESSAGE_SEND_TIMEOUT_MS
    const targetLabel = type === ThreadType.Group ? 'group' : 'người dùng'
    return this.withTimeout(
      api.sendMessage(payload, threadId, type),
      timeoutMs,
      `Gửi tin nhắn Zalo đến ${targetLabel} quá thời gian chờ (${Math.round(timeoutMs / 1000)} giây)`,
      () => {
        if (needsUploadCallback) this.invalidateAccount(accountId)
      }
    )
  }

  private async forwardMessage(
    accountId: number,
    threadIds: string[],
    type: ThreadType,
    message: string
  ): Promise<ZaloForwardMessageResult> {
    const api = await this.ensureApi(accountId)
    const safeThreadIds = threadIds.map(item => String(item || '').trim()).filter(Boolean)
    const text = String(message || '').trim()
    if (safeThreadIds.length === 0) throw new ZaloApiError('Missing thread IDs')
    if (!text) throw new ZaloApiError('Missing message content')

    const timestamp = Date.now()
    const requestTargets = safeThreadIds.map((threadId, index) => ({
      threadId,
      clientId: timestamp + index
    }))
    const ownId = type === ThreadType.User ? String(api.getOwnId?.() || '').trim() : ''
    const skippedSelfResults: ZaloForwardMessageTargetResult[] = ownId
      ? requestTargets
          .filter(target => target.threadId === ownId)
          .map(target => ({
            threadId: target.threadId,
            ok: false,
            raw: {
              clientId: String(target.clientId),
              toUid: target.threadId,
              error_code: '114',
              error_message: 'Không thể chia sẻ tin nhắn Zalo cho chính tài khoản đang gửi'
            },
            errorCode: '114',
            errorMessage: 'Không thể chia sẻ tin nhắn Zalo cho chính tài khoản đang gửi'
          }))
      : []
    const sendTargets = ownId
      ? requestTargets.filter(target => target.threadId !== ownId)
      : requestTargets

    const targetLabel = type === ThreadType.Group ? 'group' : 'người dùng'
    const response = sendTargets.length > 0
      ? await this.withTimeout(
          this.forwardMessageRaw(api, sendTargets, type, text),
          ZALO_MESSAGE_SEND_TIMEOUT_MS,
          `Chia sẻ tin nhắn Zalo đến ${targetLabel} quá thời gian chờ (${Math.round(ZALO_MESSAGE_SEND_TIMEOUT_MS / 1000)} giây)`
        )
      : { success: [], fail: [], skipped: skippedSelfResults }
    const remoteResult = this.normalizeForwardMessageResult(sendTargets, type, response)
    if (skippedSelfResults.length === 0) return remoteResult

    const remainingRemoteResults = [...remoteResult.results]
    const results = requestTargets.map(target => {
      const skipped = skippedSelfResults.find(item => item.threadId === target.threadId)
      if (skipped) return skipped
      const resultIndex = remainingRemoteResults.findIndex(item => item.threadId === target.threadId)
      if (resultIndex >= 0) {
        const [result] = remainingRemoteResults.splice(resultIndex, 1)
        return result
      }
      return {
        threadId: target.threadId,
        ok: false,
        errorMessage: 'Không xác định được kết quả chia sẻ tin nhắn Zalo cho target này'
      }
    })

    return {
      response: {
        response,
        skipped: skippedSelfResults
      },
      results,
      successCount: results.filter(item => item.ok).length,
      failCount: results.filter(item => !item.ok).length
    }
  }

  private async forwardMessageRaw(
    api: API,
    targets: ZaloForwardMessageRequestTarget[],
    type: ThreadType,
    message: string
  ): Promise<unknown> {
    const customApi = api as ZaloRawForwardMessageApi
    if (typeof customApi.akaForwardMessageBatch !== 'function') {
      api.custom<Promise<unknown>, ZaloRawForwardMessagePayload>('akaForwardMessageBatch', async ({ ctx, utils, props }) => {
        const isGroup = props.type === ThreadType.Group
        const serviceURL = utils.makeURL(`${api.zpwServiceMap.file[0]}/api/${isGroup ? 'group' : 'message'}/mforward`)
        const forwardTargets = props.targets.map(target => (
          isGroup
            ? { clientId: target.clientId, grid: target.threadId, ttl: 0 }
            : { clientId: target.clientId, toUid: target.threadId, ttl: 0 }
        ))
        const params = isGroup
          ? {
              grids: forwardTargets,
              ttl: 0,
              msgType: '1',
              totalIds: forwardTargets.length,
              msgInfo: JSON.stringify({ message: props.message })
            }
          : {
              toIds: forwardTargets,
              imei: ctx.imei,
              ttl: 0,
              msgType: '1',
              totalIds: forwardTargets.length,
              msgInfo: JSON.stringify({ message: props.message })
            }
        const encryptedParams = utils.encodeAES(JSON.stringify(params))
        if (!encryptedParams) throw new ZaloApiError('Failed to encrypt params')
        const response = await utils.request(serviceURL, {
          method: 'POST',
          body: new URLSearchParams({ params: encryptedParams })
        })
        return utils.resolve(response)
      })
    }

    const forwardBatch = customApi.akaForwardMessageBatch
    if (typeof forwardBatch !== 'function') {
      throw new Error('Không khởi tạo được API chia sẻ tin nhắn Zalo')
    }
    return forwardBatch({ targets, type, message })
  }

  private normalizeForwardMessageResult(
    targets: ZaloForwardMessageRequestTarget[],
    type: ThreadType,
    response: unknown
  ): ZaloForwardMessageResult {
    const responseRecord = normalizeRecord(response)
    const payload = responseRecord.data && typeof responseRecord.data === 'object'
      ? normalizeRecord(responseRecord.data)
      : responseRecord
    const successRows = Array.isArray(payload.success) ? payload.success.map(item => normalizeRecord(item)) : []
    const failRows = [
      ...(Array.isArray(payload.fail) ? payload.fail : []),
      ...(Array.isArray(payload.failed) ? payload.failed : [])
    ].map(item => normalizeRecord(item))
    const keyName = type === ThreadType.Group ? 'grid' : 'toUid'
    const targetByClientId = new Map(targets.map(target => [String(target.clientId), target]))
    const targetByThreadId = new Map(targets.map(target => [target.threadId, target]))
    const successByClientId = new Map<string, Record<string, unknown>>()
    const failByClientId = new Map<string, Record<string, unknown>>()
    const successByThreadId = new Map<string, Record<string, unknown>>()
    const failByThreadId = new Map<string, Record<string, unknown>>()

    for (const row of successRows) {
      const clientId = String(row.clientId || '').trim()
      const targetKey = String(row[keyName] || row.id || '').trim()
      const target = (clientId ? targetByClientId.get(clientId) : undefined)
        || (targetKey ? targetByThreadId.get(targetKey) : undefined)
      if (clientId && target) successByClientId.set(clientId, row)
      if (target) successByThreadId.set(target.threadId, row)
    }
    for (const row of failRows) {
      const clientId = String(row.clientId || '').trim()
      const targetKey = String(row[keyName] || row.id || '').trim()
      const target = (clientId ? targetByClientId.get(clientId) : undefined)
        || (targetKey ? targetByThreadId.get(targetKey) : undefined)
      if (clientId && target) failByClientId.set(clientId, row)
      if (target) failByThreadId.set(target.threadId, row)
    }

    const hasMappedRows = successByClientId.size > 0 || failByClientId.size > 0 || successByThreadId.size > 0 || failByThreadId.size > 0
    const allSucceededByCount = !hasMappedRows && successRows.length === targets.length && failRows.length === 0
    const allFailedByCount = !hasMappedRows && failRows.length === targets.length && successRows.length === 0
    const results = targets.map((target, index) => {
      const normalizedThreadId = target.threadId
      const targetClientId = String(target.clientId)
      const failRow = failByClientId.get(targetClientId) || failByThreadId.get(normalizedThreadId)
      if (failRow) {
        return {
          threadId: normalizedThreadId,
          ok: false,
          raw: failRow,
          errorCode: String(failRow.error_code || failRow.code || '').trim() || undefined,
          errorMessage: String(failRow.error_message || failRow.message || '').trim() || undefined
        }
      }
      const successRow = successByClientId.get(targetClientId) || successByThreadId.get(normalizedThreadId)
      if (successRow) {
        return {
          threadId: normalizedThreadId,
          ok: true,
          raw: successRow
        }
      }
      if (allSucceededByCount) {
        return {
          threadId: normalizedThreadId,
          ok: true,
          raw: successRows[index] || {}
        }
      }
      if (allFailedByCount) {
        const failRowByCount = failRows[index] || failRows[0]
        return {
          threadId: normalizedThreadId,
          ok: false,
          raw: failRowByCount,
          errorCode: failRowByCount ? String(failRowByCount.error_code || failRowByCount.code || '').trim() || undefined : undefined,
          errorMessage: failRowByCount
            ? String(failRowByCount.error_message || failRowByCount.message || failRowByCount.error_code || '').trim() || undefined
            : undefined
        }
      }
      return {
        threadId: normalizedThreadId,
        ok: false,
        errorMessage: 'Không xác định được kết quả chia sẻ tin nhắn Zalo cho target này'
      }
    })

    return {
      response,
      results,
      successCount: results.filter(item => item.ok).length,
      failCount: results.filter(item => !item.ok).length
    }
  }

  async sendFriendRequestToUser(accountId: number, uid: string, message: string): Promise<unknown> {
    const api = await this.ensureApi(accountId)
    return api.sendFriendRequest(String(message || ''), uid)
  }

  async applyLabelToUser(accountId: number, uid: string, labelId: number | string): Promise<LabelData> {
    const api = await this.ensureApi(accountId)
    const targetUid = String(uid || '').trim()
    if (!targetUid) throw new Error('UID Zalo không hợp lệ')
    const id = Number(labelId)
    if (!Number.isFinite(id) || id <= 0) throw new Error('Tag Zalo không hợp lệ')
    const response = await api.getLabels()
    const labels = Array.isArray(response?.labelData) ? response.labelData : []
    const label = labels.find(item => Number(item.id) === id)
    if (!label) throw new Error('Tag Zalo không tồn tại')

    let changed = false
    for (const item of labels) {
      const conversations = Array.isArray(item.conversations) ? item.conversations : []
      const isTargetLabel = Number(item.id) === id
      const hasTargetUid = conversations.includes(targetUid)

      if (isTargetLabel) {
        if (!Array.isArray(item.conversations)) item.conversations = conversations
        if (!hasTargetUid) {
          item.conversations = [...conversations, targetUid]
          changed = true
        }
        continue
      }

      if (hasTargetUid) {
        item.conversations = conversations.filter(conversationUid => conversationUid !== targetUid)
        changed = true
      } else if (!Array.isArray(item.conversations)) {
        item.conversations = conversations
      }
    }

    if (changed) {
      await api.updateLabels({ labelData: labels, version: response.version })
    }
    return label
  }

  async changeUserAlias(accountId: number, uid: string, alias: string): Promise<unknown> {
    const api = await this.ensureApi(accountId)
    return api.changeFriendAlias(String(alias || ''), uid)
  }

  private async runLoginQr(account: AutoAccount, active: ActiveQrLogin): Promise<void> {
    let callbackCredentials: ZaloSessionCredentials | null = null
    try {
      const zalo = await this.createZaloClient(account)
      const api = await zalo.loginQR({
        userAgent: DEFAULT_ZALO_USER_AGENT,
        language: DEFAULT_LANGUAGE
      }, (event) => {
        callbackCredentials = this.handleQrCallback(account.id, event, active) || callbackCredentials
      })

      if (active.cancelRequested) return
      const credentials = this.getSessionCredentialsFromApi(api, callbackCredentials)

      const profile = await this.loadOwnProfile(api)
      const zaloAccount = await this.supabase.upsertZaloAccount(profile)
      const updated = await this.supabase.updateAccountZaloSession(account.id, {
        zaloAccountId: zaloAccount.id,
        session: credentials,
        verified: true,
        clearError: true
      })
      this.cacheApi(updated, api)

      this.emitLoginQrEvent({
        accountId: account.id,
        status: 'success',
        message: 'Đăng nhập Zalo thành công',
        displayName: updated.zaloDisplayName || profile.displayName || undefined,
        avatarUrl: updated.zaloAvatarUrl || profile.avatarUrl || undefined,
        zaloAccountId: zaloAccount.id,
        zaloUid: zaloAccount.zaloUid
      })
    } catch (err) {
      if (active.cancelRequested) return
      this.logLoginQrFailure(account.id, err)
      const message = this.getErrorMessage(err)
      await this.supabase.markAccountZaloSessionCheck(account.id, { ok: false, error: message }).catch(() => {})
      this.emitLoginQrEvent({
        accountId: account.id,
        status: 'error',
        message
      })
    } finally {
      this.activeQrLogins.delete(account.id)
    }
  }

  private handleQrCallback(
    accountId: number,
    event: LoginQRCallbackEvent,
    active: ActiveQrLogin
  ): ZaloSessionCredentials | null {
    if (event.actions && 'abort' in event.actions) {
      active.abort = event.actions.abort
      if (active.cancelRequested) {
        try { event.actions.abort() } catch {}
        return null
      }
    }

    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        this.emitLoginQrEvent({
          accountId,
          status: 'qr',
          message: 'Quét mã QR bằng ứng dụng Zalo',
          qrImage: this.normalizeQrImage(event.data.image)
        })
        return null
      case LoginQRCallbackEventType.QRCodeExpired:
        this.emitLoginQrEvent({
          accountId,
          status: 'expired',
          message: 'Mã QR đã hết hạn, đang tạo lại mã mới'
        })
        try { event.actions.retry() } catch {}
        return null
      case LoginQRCallbackEventType.QRCodeScanned:
        this.emitLoginQrEvent({
          accountId,
          status: 'scanned',
          message: 'Đã quét QR, vui lòng xác nhận trên điện thoại',
          displayName: event.data.display_name,
          avatarUrl: event.data.avatar
        })
        return null
      case LoginQRCallbackEventType.QRCodeDeclined:
        this.emitLoginQrEvent({
          accountId,
          status: 'declined',
          message: 'Bạn đã từ chối đăng nhập Zalo'
        })
        return null
      case LoginQRCallbackEventType.GotLoginInfo:
        return {
          cookie: event.data.cookie,
          imei: event.data.imei,
          userAgent: event.data.userAgent,
          language: DEFAULT_LANGUAGE
        }
      default:
        return null
    }
  }

  private cacheApi(account: AutoAccount, api: API, lastError: string | null = null): void {
    this.apiCache.set(account.id, {
      accountId: account.id,
      api,
      proxyId: account.proxyId ?? null,
      sessionUpdatedAt: account.zaloSessionUpdatedAt ?? null,
      lastVerifiedAt: account.zaloSessionLastVerifiedAt ?? null,
      lastError
    })
  }

  private isCachedApiFresh(cached: CachedZaloApi, account: AutoAccount): boolean {
    return cached.proxyId === (account.proxyId ?? null)
      && cached.sessionUpdatedAt === (account.zaloSessionUpdatedAt ?? null)
  }

  private updateCachedVerification(account: AutoAccount): void {
    const cached = this.apiCache.get(account.id)
    if (!cached || !this.isCachedApiFresh(cached, account)) return
    cached.lastVerifiedAt = account.zaloSessionLastVerifiedAt ?? new Date().toISOString()
    cached.lastError = null
  }

  private getAccountCacheVersion(accountId: number): number {
    return this.accountCacheVersions.get(accountId) ?? 0
  }

  private async ensureZaloListenerReady(
    accountId: number,
    api: API,
    options: { refreshIfOlderThanMs?: number } = {}
  ): Promise<void> {
    let state = this.listenerStates.get(accountId)
    if (state && state.api !== api) {
      this.stopZaloListener(accountId)
      state = undefined
    }

    const now = Date.now()
    if (
      state
      && !state.ready
      && (
        state.status === 'disconnected'
        || (state.status === 'error' && state.lastEventAt && now - state.lastEventAt < 5_000)
      )
    ) {
      if (state.startPromise) return state.startPromise
      return this.waitForZaloListenerReady(accountId, state, ZALO_LISTENER_READY_TIMEOUT_MS)
    }

    if (state?.status === 'error' && !state.ready) {
      this.stopZaloListener(accountId)
      state = undefined
    }

    if (
      state?.status === 'running'
      && state.ready
      && (!options.refreshIfOlderThanMs || !state.readyAt || now - state.readyAt <= options.refreshIfOlderThanMs)
    ) {
      return
    }

    if (
      state?.status === 'running'
      && state.ready
      && options.refreshIfOlderThanMs
      && state.readyAt
      && now - state.readyAt > options.refreshIfOlderThanMs
    ) {
      this.stopZaloListener(accountId)
      state = undefined
    }

    if (!state) {
      state = {
        accountId,
        api,
        status: 'idle',
        ready: false,
        handlersAttached: false,
        lastError: null
      }
      this.listenerStates.set(accountId, state)
    }

    this.attachZaloListenerHandlers(state)

    if (state.startPromise) return state.startPromise

    let promise!: Promise<void>
    promise = (async () => {
      state.status = 'starting'
      state.ready = false
      state.lastEventAt = Date.now()
      try {
        api.listener.start({ retryOnClose: true })
      } catch (err) {
        if (this.isZaloListenerAlreadyStartedError(err)) {
          await this.waitForZaloListenerReady(accountId, state, ZALO_LISTENER_READY_TIMEOUT_MS)
          return
        }
        state.status = 'error'
        state.ready = false
        state.lastError = this.getErrorMessage(err)
        state.lastEventAt = Date.now()
        throw err
      }

      await this.waitForZaloListenerReady(accountId, state, ZALO_LISTENER_READY_TIMEOUT_MS)
    })().finally(() => {
      if (state?.startPromise === promise) {
        state.startPromise = undefined
      }
    })

    state.startPromise = promise
    return promise
  }

  private notifyRealtimeSubscribers(
    accountId: number,
    invoke: (handlers: ZaloRealtimeListenerHandlers) => unknown,
    context: string
  ): void {
    const subscribers = this.realtimeListenerSubscribers.get(accountId)
    if (!subscribers || subscribers.size === 0) return

    for (const handlers of Array.from(subscribers)) {
      try {
        void Promise.resolve(invoke(handlers)).catch((err) => {
          console.warn(`[ZaloRuntime] Realtime listener subscriber failed (${context})`, {
            accountId,
            message: this.getErrorMessage(err)
          })
        })
      } catch (err) {
        console.warn(`[ZaloRuntime] Realtime listener subscriber failed (${context})`, {
          accountId,
          message: this.getErrorMessage(err)
        })
      }
    }
  }

  private emitZaloListenerStatus(state: ZaloListenerState, extra: Partial<ZaloListenerStatusEvent> = {}): void {
    this.notifyRealtimeSubscribers(
      state.accountId,
      (handlers) => handlers.status?.({
        accountId: state.accountId,
        status: state.status,
        ready: state.ready,
        error: state.lastError,
        ...extra
      }),
      'status'
    )
  }

  private attachZaloListenerHandlers(state: ZaloListenerState): void {
    if (state.handlersAttached) return
    state.handlersAttached = true

    const { accountId, api } = state
    api.listener.on('connected', () => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      state.status = 'starting'
      state.ready = false
      state.lastEventAt = Date.now()
      this.emitZaloListenerStatus(state)
    })
    api.listener.on('cipher_key', () => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      state.status = 'running'
      state.ready = true
      state.readyAt = Date.now()
      state.lastEventAt = state.readyAt
      state.lastError = null
      this.emitZaloListenerStatus(state)
    })
    api.listener.on('disconnected', (code, reason) => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      state.status = 'disconnected'
      state.ready = false
      state.lastEventAt = Date.now()
      state.lastError = `Listener Zalo bị ngắt (${code}${reason ? `: ${reason}` : ''})`
      this.emitZaloListenerStatus(state, { code, reason })
    })
    api.listener.on('closed', (code, reason) => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      state.status = 'closed'
      state.ready = false
      state.lastEventAt = Date.now()
      state.lastError = `Listener Zalo đã đóng (${code}${reason ? `: ${reason}` : ''})`
      this.emitZaloListenerStatus(state, { code, reason })
    })
    api.listener.on('error', (err) => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      state.lastError = this.getErrorMessage(err)
      state.lastEventAt = Date.now()
      if (!state.ready) {
        state.status = 'error'
      }
      this.emitZaloListenerStatus(state)
    })
    api.listener.on('group_event', (event) => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      this.notifyRealtimeSubscribers(accountId, handlers => handlers.groupEvent?.(event), 'group_event')
    })
    api.listener.on('message', (message) => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      this.notifyRealtimeSubscribers(accountId, handlers => handlers.message?.(message), 'message')
    })
    api.listener.on('reaction', (reaction) => {
      const current = this.listenerStates.get(accountId)
      if (current !== state) return
      this.notifyRealtimeSubscribers(accountId, handlers => handlers.reaction?.(reaction), 'reaction')
    })
  }

  private async waitForZaloListenerReady(
    accountId: number,
    state: ZaloListenerState,
    timeoutMs: number
  ): Promise<void> {
    if (state.status === 'running' && state.ready) return

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let interval: ReturnType<typeof setInterval> | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined

      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        if (interval) clearInterval(interval)
        if (timeout) clearTimeout(timeout)
        if (err) reject(err)
        else resolve()
      }

      const check = () => {
        const current = this.listenerStates.get(accountId)
        if (current !== state) {
          finish(new Error('Listener Zalo đã được reset trong lúc khởi động'))
          return
        }
        if (state.status === 'running' && state.ready) {
          finish()
          return
        }
        if (state.status === 'closed') {
          finish(new Error(state.lastError || 'Listener Zalo đã đóng trước khi sẵn sàng'))
        }
      }

      interval = setInterval(check, 100)
      timeout = setTimeout(() => {
        finish(new Error(`Listener Zalo chưa sẵn sàng sau ${Math.round(timeoutMs / 1000)} giây`))
      }, timeoutMs)
      check()
    })
  }

  private stopZaloListener(accountId: number): void {
    const state = this.listenerStates.get(accountId)
    if (!state) return
    this.listenerStates.delete(accountId)
    state.status = 'stopped'
    state.ready = false
    state.startPromise = undefined
    try {
      state.api.listener.stop()
    } catch (err) {
      console.warn('[ZaloRuntime] Failed to stop Zalo listener', {
        accountId,
        message: this.getErrorMessage(err)
      })
    }
  }

  private stopAllZaloListeners(): void {
    for (const accountId of Array.from(this.listenerStates.keys())) {
      this.stopZaloListener(accountId)
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
    onTimeout?: () => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        try { onTimeout?.() } catch {}
        reject(new Error(timeoutMessage))
      }, timeoutMs)

      operation.then(
        (value) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve(value)
        },
        (err) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(err)
        }
      )
    })
  }

  private isZaloListenerAlreadyStartedError(err: unknown): boolean {
    return this.getErrorMessage(err).toLowerCase().includes('already started')
  }

  private async verifyAccountSession(accountId: number): Promise<void> {
    const inflight = this.verifyInflight.get(accountId)
    if (inflight) return inflight

    let promise!: Promise<void>
    promise = this.verifyAccountSessionOnce(accountId)
      .finally(() => {
        if (this.verifyInflight.get(accountId) === promise) {
          this.verifyInflight.delete(accountId)
        }
      })

    this.verifyInflight.set(accountId, promise)
    return promise
  }

  private async verifyAccountSessionOnce(accountId: number): Promise<void> {
    try {
      const api = await this.ensureApi(accountId)
      await this.verifyAuthenticatedApi(api)
    } catch (firstErr) {
      console.warn('[ZaloRuntime] Zalo API verification failed, retrying with a fresh session login', {
        accountId,
        message: this.getErrorMessage(firstErr)
      })
      this.invalidateAccount(accountId)
      const retryApi = await this.ensureApi(accountId)
      await this.verifyAuthenticatedApi(retryApi)
    }
  }

  private async verifyAuthenticatedApi(api: API): Promise<void> {
    const info = await api.fetchAccountInfo()
    if (!info || typeof info !== 'object' || !('profile' in info)) {
      throw new Error('Không xác thực được session Zalo')
    }
  }

  private async loginWithSession(account: AutoAccount, session: ZaloSessionCredentials): Promise<API> {
    const zalo = await this.createZaloClient(account)
    return zalo.login(session as Credentials)
  }

  private async createZaloClient(account: AutoAccount): Promise<Zalo> {
    const proxy = account.proxyId ? await this.getProxyById(account.proxyId) : null
    const agent = proxy && proxy.isActive !== false
      ? await this.createProxyAgent(proxy)
      : undefined
    const options: Partial<ZaloOptions> = {
      selfListen: true,
      checkUpdate: false,
      logging: false,
      imageMetadataGetter: getZaloImageMetadata
    }

    if (agent) {
      options.agent = agent
      options.polyfill = await this.loadFetchPolyfillWithSetCookieSupport()
    }

    return new Zalo(options)
  }

  private async getGroupInfoLegacy(api: API, groupId: string): Promise<Record<string, unknown>> {
    const customApi = api as API & {
      akaGetGroupInfoLegacy?: (payload: { groupId: string }) => Promise<unknown>
    }

    if (typeof customApi.akaGetGroupInfoLegacy !== 'function') {
      api.custom<Promise<unknown>, { groupId: string }>('akaGetGroupInfoLegacy', async ({ ctx, utils, props }) => {
        const serviceURL = utils.makeURL(`${api.zpwServiceMap.group[0]}/api/group/getmg`)
        const params = {
          grids: [props.groupId],
          avatar_size: 120,
          member_avatar_size: 120,
          imei: ctx.imei
        }
        const encryptedParams = utils.encodeAES(JSON.stringify(params))
        if (!encryptedParams) throw new ZaloApiError('Không chuẩn bị được yêu cầu lấy thông tin group Zalo')
        const response = await utils.request(serviceURL, {
          method: 'POST',
          body: new URLSearchParams({ params: encryptedParams })
        })
        return utils.resolve(response)
      })
    }

    const requestLegacyGetmg = customApi.akaGetGroupInfoLegacy
    if (typeof requestLegacyGetmg !== 'function') {
      throw new Error('Không khởi tạo được tác vụ lấy thông tin group Zalo')
    }
    return normalizeRecord(await requestLegacyGetmg({ groupId }))
  }

  private async getGroupMembersInfoBatch(
    api: API,
    memberIds: string[]
  ): Promise<Record<string, Record<string, unknown>>> {
    const customApi = api as API & {
      akaGetGroupMembersInfoPost?: (payload: { memberIds: string[] }) => Promise<unknown>
    }

    if (typeof customApi.akaGetGroupMembersInfoPost !== 'function') {
      api.custom<Promise<unknown>, { memberIds: string[] }>('akaGetGroupMembersInfoPost', async ({ utils, props }) => {
        const serviceURL = utils.makeURL(`${api.zpwServiceMap.profile[0]}/api/social/group/members`)
        const params = {
          friend_pversion_map: props.memberIds.map(id => id.endsWith('_0') ? id : `${id}_0`)
        }
        const encryptedParams = utils.encodeAES(JSON.stringify(params))
        if (!encryptedParams) throw new ZaloApiError('Failed to encrypt group member profile params')
        const response = await utils.request(serviceURL, {
          method: 'POST',
          body: new URLSearchParams({ params: encryptedParams })
        })
        return utils.resolve(response)
      })
    }

    const requestMemberProfiles = customApi.akaGetGroupMembersInfoPost
    if (typeof requestMemberProfiles !== 'function') {
      throw new Error('Không khởi tạo được API lấy thông tin thành viên Zalo')
    }
    const response = normalizeRecord(await requestMemberProfiles({ memberIds }))
    return Object.fromEntries(
      Object.entries(normalizeRecord(response.profiles))
        .map(([uid, profile]) => [uid, normalizeRecord(profile)])
    )
  }

  private async collectGroupLinkMemberPages(
    api: API,
    link: string,
    loadPage: (memberPage: number) => Promise<Record<string, unknown>>
  ): Promise<ZaloGroupMembersResult> {
    const rawMembers: Record<string, unknown>[] = []
    const seenUids = new Set<string>()
    let group: Record<string, unknown> = {}

    for (let memberPage = 1; memberPage <= ZALO_GROUP_LINK_MAX_MEMBER_PAGES; memberPage += 1) {
      const pageGroup = normalizeRecord(await loadPage(memberPage))
      group = mergeGroupLinkPage(group, pageGroup)

      const pageMembers = this.getCurrentMembersFromGroupLinkPage(pageGroup)
      let newUidCount = 0
      for (const member of pageMembers) {
        const uid = normalizeZaloMemberId(member.id)
        if (!uid || seenUids.has(uid)) continue
        seenUids.add(uid)
        rawMembers.push(member)
        newUidCount += 1
      }

      if (newUidCount === 0) break
    }

    group.currentMems = rawMembers
    if (!group.link) group.link = link
    const zaloGroupId = normalizeZaloGroupId(group.groupId)
    const members = rawMembers
      .map(member => this.mapZaloGroupMember(zaloGroupId, group, member, 'link'))
      .filter((member): member is ZaloGroupMemberInfo => !!member.zaloUid)

    return { group, members }
  }

  private async getGroupMembersByLinkWithProxy(
    api: API,
    link: string,
    proxyUrl: string
  ): Promise<ZaloGroupMembersResult> {
    const collected = await this.collectGroupLinkMemberPages(api, link, async (memberPage) => (
      this.getGroupLinkInfoWithProxyPage(api, link, memberPage, proxyUrl)
    ))
    return { ...collected, usedProxy: true }
  }

  private async getGroupMembersByLinkFallback(
    api: API,
    link: string,
    messageIfMissingProxy: string
  ): Promise<ZaloGroupMembersResult> {
    const proxyUrl = await this.getGroupLinkGinfoProxyUrl()
    if (!proxyUrl) throw new Error(messageIfMissingProxy)
    return this.getGroupMembersByLinkWithProxy(api, link, proxyUrl)
  }

  private async getGroupLinkInfoWithProxyPage(
    api: API,
    link: string,
    memberPage: number,
    proxyUrl: string
  ): Promise<Record<string, unknown>> {
    const customApi = api as API & {
      akaGetGroupLinkInfoWithProxy?: (payload: {
        link: string
        memberPage: number
        proxyUrl: string
      }) => Promise<unknown>
    }

    if (typeof customApi.akaGetGroupLinkInfoWithProxy !== 'function') {
      api.custom<Promise<unknown>, { link: string; memberPage: number; proxyUrl: string }>(
        'akaGetGroupLinkInfoWithProxy',
        async ({ ctx, utils, props }) => {
          const serviceURL = utils.makeURL(`${api.zpwServiceMap.group[0]}/api/group/link/ginfo`)
          const encryptedParams = utils.encodeAES(JSON.stringify({
            link: props.link,
            avatar_size: 120,
            member_avatar_size: 120,
            mpage: props.memberPage
          }))
          if (!encryptedParams) throw new ZaloApiError('Không chuẩn bị được yêu cầu lấy thông tin link group Zalo')

          const url = utils.makeURL(serviceURL, { params: encryptedParams })
          const [{ default: nodeFetch }, proxyAgentMod] = await Promise.all([
            import('node-fetch'),
            import('proxy-agent')
          ])
          const agent = new proxyAgentMod.ProxyAgent({ getProxyForUrl: () => props.proxyUrl })
          const origin = new URL(url).origin
          const response = await nodeFetch(url, {
            method: 'GET',
            agent,
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Accept-Language': 'en-US,en;q=0.9',
              'content-type': 'application/x-www-form-urlencoded',
              Cookie: await ctx.cookie.getCookieString(origin),
              Origin: 'https://chat.zalo.me',
              Referer: 'https://chat.zalo.me/',
              'User-Agent': ctx.userAgent
            }
          })
          return utils.resolve(response as unknown as Response)
        }
      )
    }

    const requestGinfoWithProxy = customApi.akaGetGroupLinkInfoWithProxy
    if (typeof requestGinfoWithProxy !== 'function') {
      throw new Error('Không khởi tạo được tác vụ lấy thông tin link group Zalo qua proxy')
    }
    return normalizeRecord(await requestGinfoWithProxy({ link, memberPage, proxyUrl }))
  }

  private getCurrentMembersFromGroupLinkPage(group: Record<string, unknown>): Record<string, unknown>[] {
    const members = Array.isArray(group.currentMems) ? group.currentMems : []
    return members
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      .map(member => normalizeRecord(member))
  }

  private async getGroupLinkGinfoProxyUrl(): Promise<string | null> {
    const rawValue = await this.supabase
      .getSystemSettingValue(ZALO_GROUP_LINK_GINFO_PROXY_SETTING_KEY)
      .catch(() => '')
    return normalizeProxyUrl(rawValue)
  }

  private mapZaloGroupMember(
    zaloGroupId: string,
    group: Record<string, unknown>,
    rawMember: Record<string, unknown>,
    source: 'profile' | 'link'
  ): ZaloGroupMemberInfo {
    const uid = normalizeZaloMemberId(firstString(
      rawMember.id,
      rawMember.uid,
      rawMember.userId,
      rawMember.globalId
    ))
    const creatorId = normalizeZaloMemberId(group.creatorId)
    const adminIds = new Set(toStringArray(group.adminIds).map(normalizeZaloMemberId).filter(Boolean))
    const isCreator = !!uid && uid === creatorId
    const isAdmin = !!uid && adminIds.has(uid)
    const role: ZaloGroupMemberRole = isCreator ? 'owner' : isAdmin ? 'admin' : 'member'

    return {
      zaloGroupId,
      zaloUid: uid,
      displayName: firstString(rawMember.displayName, rawMember.dName, rawMember.name),
      zaloName: firstString(rawMember.zaloName, rawMember.zalo_name),
      avatar: firstString(rawMember.avatar),
      accountStatus: nullableNumber(rawMember.accountStatus),
      type: nullableNumber(rawMember.type),
      lastUpdateTime: nullableNumber(rawMember.lastUpdateTime),
      globalId: firstString(rawMember.globalId),
      role,
      roleRank: role === 'owner' ? 1 : role === 'admin' ? 2 : 3,
      isCreator,
      isAdmin,
      rawPayload: {
        ...rawMember,
        source,
        zaloGroupId
      }
    }
  }

  private async loadFetchPolyfillWithSetCookieSupport(): Promise<typeof globalThis.fetch> {
    const mod = await import('node-fetch')
    const nodeFetch = mod.default
    return (async (url: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const response = await nodeFetch(url as any, init as any)
      this.attachGetSetCookie(response)
      return response as unknown as Response
    }) as typeof globalThis.fetch
  }

  private async createProxyAgent(proxy: AutoProxy): Promise<any> {
    const mod = await import('proxy-agent')
    return new mod.ProxyAgent({ getProxyForUrl: () => this.buildProxyUrl(proxy) })
  }

  private attachGetSetCookie(response: unknown): void {
    const headers = (response as any)?.headers
    if (!headers || typeof headers.getSetCookie === 'function') return
    if (typeof headers.raw !== 'function') return

    Object.defineProperty(headers, 'getSetCookie', {
      configurable: true,
      value: () => {
        const raw = headers.raw()
        const cookies = raw?.['set-cookie']
        return Array.isArray(cookies) ? cookies : []
      }
    })
  }

  private getSessionCredentialsFromApi(api: API, fallback: ZaloSessionCredentials | null): ZaloSessionCredentials {
    const ctx = api.getContext()
    const cookie = ctx.cookie?.toJSON?.()?.cookies || fallback?.cookie
    const imei = firstString(ctx.imei, fallback?.imei)
    const userAgent = firstString(ctx.userAgent, fallback?.userAgent, DEFAULT_ZALO_USER_AGENT)
    const language = firstString(ctx.language, fallback?.language, DEFAULT_LANGUAGE) || undefined

    if (!cookie || !imei || !userAgent) {
      throw new Error('Không lấy được session sau khi quét QR')
    }

    return {
      cookie,
      imei,
      userAgent,
      language
    }
  }

  private logLoginQrFailure(accountId: number, err: unknown): void {
    const message = this.getErrorMessage(err)
    console.error('[ZaloRuntime] QR login failed', { accountId, message, err })
    if (message.includes("Can't login")) {
      console.warn('[ZaloRuntime] zca-js reported "Can\'t login" after checksession + /jr/userinfo. This means QR was scanned/confirmed, but Zalo did not mark the web session as logged in.')
    }
  }

  private async loadOwnProfile(api: API): Promise<{
    zaloUid: string
    displayName?: string | null
    phone?: string | null
    avatarUrl?: string | null
    metadata: Record<string, unknown>
  }> {
    const ownId = String(api.getOwnId() || '').trim()
    const info = await api.fetchAccountInfo().catch(() => null)
    const profile = ((info && 'profile' in info ? info.profile : null) || {}) as ZaloProfile
    const zaloUid = ownId || normalizeProfileId(profile)
    if (!zaloUid) throw new Error('Không lấy được Zalo UID')

    const displayName = firstString(profile.displayName, profile.zaloName, profile.display_name, profile.zalo_name, profile.username)
    const phone = firstString(profile.phoneNumber)
    const avatarUrl = firstString(profile.avatar)

    return {
      zaloUid,
      displayName,
      phone,
      avatarUrl,
      metadata: sanitizeProfileMetadata(profile)
    }
  }

  private buildProxyUrl(proxy: AutoProxy): string {
    const protocol = proxy.protocol || 'http'
    const auth = proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
      : ''
    return `${protocol}://${auth}${proxy.host}:${proxy.port}`
  }

  private normalizeQrImage(image: string): string {
    const trimmed = String(image || '').trim()
    if (!trimmed) return trimmed
    if (/^data:image\//i.test(trimmed)) return trimmed
    return `data:image/png;base64,${trimmed}`
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof ZaloApiError) {
      const suffix = err.code === null || err.code === undefined ? '' : ` (${err.code})`
      return `${err.message}${suffix}`
    }
    if (err instanceof Error) return err.message
    return String(err)
  }

  private getApiErrorCode(err: unknown): string {
    if (err instanceof ZaloApiError && err.code !== null && err.code !== undefined) {
      return String(err.code).trim()
    }
    const rawCode = (err as { code?: unknown } | null | undefined)?.code
    return rawCode === null || rawCode === undefined ? '' : String(rawCode).trim()
  }
}

function normalizeProfileId(profile: ZaloProfile): string {
  return firstString(profile.userId, profile.uid, profile.globalId) || ''
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (trimmed) return trimmed
  }
  return null
}

function requiresZaloUploadCallback(source: string): boolean {
  const trimmed = String(source || '').trim()
  if (!trimmed) return false
  if (/^data:image\//i.test(trimmed)) return false
  const ext = getAttachmentExtension(trimmed)
  if (!ext) return true
  return !ZALO_ATTACHMENT_EXTENSIONS_WITHOUT_UPLOAD_CALLBACK.has(ext)
}

function getAttachmentExtension(source: string): string {
  const withoutQuery = source.split(/[?#]/, 1)[0]
  const fileName = withoutQuery.split(/[\\/]/).pop() || withoutQuery
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return ''
  return fileName.slice(dotIndex + 1).toLowerCase()
}

function sanitizeProfileMetadata(profile: ZaloProfile): Record<string, unknown> {
  const metadata = { ...(profile as Record<string, unknown>) }
  delete metadata.phoneNumber
  return metadata
}

function normalizeFoundUser(user: UserBasic | ProfileInfo | ZaloProfile | null | undefined): ZaloFoundUser | null {
  if (!user || typeof user !== 'object') return null
  const raw = normalizeRecord(user)
  const uid = firstString((user as any).uid, (user as any).userId, (user as any).globalId)
  if (!uid) return null
  return {
    uid,
    phone: firstString((user as any).phoneNumber, (user as any).phone) || undefined,
    displayName: firstString((user as any).display_name, (user as any).displayName, (user as any).zalo_name, (user as any).zaloName) || undefined,
    originalName: firstString((user as any).zalo_name, (user as any).zaloName, (user as any).display_name, (user as any).displayName) || undefined,
    gender: (user as any).gender ?? null,
    avatar: firstString((user as any).avatar) || undefined,
    raw
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return { ...(value as Record<string, unknown>) }
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeZaloGroupId(value: unknown): string {
  return String(value || '').trim()
}

function normalizeZaloMemberId(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/_0$/i, '')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(item => String(item || '').trim()).filter(Boolean)))
}

function normalizeZaloGroupLink(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withProtocol)
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    let groupCode = ''
    if (hostname === 'zalo.me' || hostname.endsWith('.zalo.me')) {
      if (parts[0]?.toLowerCase() !== 'g') return ''
      groupCode = parts[1] || ''
    } else if (hostname === 'zaloapp.com' || hostname.endsWith('.zaloapp.com')) {
      if (parts[0]?.toLowerCase() !== 'qr' || parts[1]?.toLowerCase() !== 'g') return ''
      groupCode = parts[2] || ''
    } else {
      return ''
    }
    return groupCode ? `https://zalo.me/g/${groupCode}` : ''
  } catch {
    return ''
  }
}

function normalizeProxyUrl(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw

  const parts = raw.split(':')
  if (parts.length >= 4) {
    const [host, port, username, ...passwordParts] = parts
    const password = passwordParts.join(':')
    if (host && port && username) {
      return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`
    }
  }

  return `http://${raw}`
}

function mergeGroupLinkPage(
  current: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...current }
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    if (isEmptyGroupValue(merged[key])) merged[key] = value
  }
  return merged
}

function isEmptyGroupValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0
  return false
}
