import { BrowserWindow } from 'electron'
import type { PageInboxScanInfo, PageInboxScanOptions, PageInboxScanStopReason } from '../../shared/types'
import { DEFAULT_PAGE_INBOX_ESTIMATE_SECONDS, PAGE_INBOX_ESTIMATE_SETTING_KEY, formatPageInboxScanDate, getPageInboxScanCutoff, normalizePageInboxEstimateSeconds, parsePageInboxTimestamp, validatePageInboxScanOptions } from '../../shared/pageInboxScan'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { IPC_EVENTS, ContactType, AutoAccount, AutoAccountContact, ContactDatasetFinalizeInput, ContactLoadProgress, ContactLoadResult, ZaloGroupMemberScanRequest, ZaloLabelOption } from '../../shared/types'
import { IPC_EVENTS_V2, RunStepV2 } from '../../shared/v2Types'
import { BackgroundPageManager } from '../v2/runtime/backgroundPageManager'
import { PageController } from '../v2/runtime/pageController'
import { WorkflowEngineV2, RunResult } from '../v2/runtime/workflowEngine'
import * as workflowV2Repo from '../data/repositories/workflowV2Repository'
import * as localContactRepo from '../data/repositories/localAccountContactRepository'
import type { ZaloGroupContactInput, ZaloGroupMemberContactInput, ZaloUserContactInput } from '../data/repositories/accountContactRepository'
import { ProxyRuntimeService } from './proxyRuntimeService'
import type { ZaloContactScanSource } from './zaloContactScanSource'
import { getContactDatasetScanTypeCode } from '../../shared/dataGroupSemantics'

interface ActiveContactLoad {
  controller: AbortController
  variables: Record<string, unknown>
  runKey: string
  contactType: ContactType
  runtimePlatform: 'zalo' | 'other'
}

type AccountRuntimePreviousStatus = 'chờ xử lý' | 'tạm dừng'
interface AccountRuntimeScanClaim {
  previousStatus: AccountRuntimePreviousStatus
  claimToken: string | null
  staffId: number | null
}
const ACCOUNT_RELEASE_RETRY_DELAYS_MS = [500, 1500] as const

interface ContactLoadOptions {
  workflowName?: string
  targetUrl?: string
  runKeyLabel?: string
  typeName?: string
  previewTitle?: string
  variables?: Record<string, unknown>
  markMissingDeleted?: boolean
  preserveExistingFriendStatus?: boolean
  resultMeta?: Partial<ContactLoadResult>
  runtimePlatform?: 'zalo' | 'other'
  dataset?: ContactDatasetScanContext
}

interface ContactDatasetScanContext {
  scanType: ContactDatasetFinalizeInput['scanType']
  actionLabel: string
  platformLabel: string
  sourceKey: string
  targetNameOrUid?: string
  link?: string | null
  extraData?: Record<string, unknown>
}

export interface ContactLoaderOptions {
  zaloRuntimeTarget?: 'desktop' | 'server'
}

const CONTACT_SCAN_WORKFLOWS: Partial<Record<ContactType, string>> = {
  person: '[Built-in] Facebook - Quét danh sách bạn bè',
  group: '[Built-in] Facebook - Quét group đã tham gia',
  page: '[Built-in] Facebook - Quét page quản lý'
}

const POST_COMMENTERS_WORKFLOW = '[Built-in] Facebook - Quét người comment bài post'
const POST_LIKES_WORKFLOW = '[Built-in] Facebook - Quét người like bài post'
const PROFILE_FRIENDS_WORKFLOW = '[Built-in] Facebook - Quét bạn bè của profile'
const GROUP_MEMBERS_WORKFLOW = '[Built-in] Facebook - Quét thành viên group'
const PAGE_INBOX_CONTACT_TYPE: ContactType = 'page_inbox_customer'
const FACEBOOK_GRAPH_API_BASE = 'https://graph.facebook.com/v25.0'
const PAGE_INBOX_BATCH_SIZE = 500
const PAGE_INBOX_MAX_FETCH_FAILURES = 3
const ZALO_FRIEND_PAGE_SIZE = 500
const ZALO_FRIEND_API_MIN_DELAY_MS = 2000
const ZALO_FRIEND_API_MAX_DELAY_MS = 5000
const ZALO_FRIEND_API_429_RETRY_DELAYS_MS = [15_000, 30_000, 60_000] as const
const ZALO_GROUP_INFO_BATCH_SIZE = 50
const PHONE_RE = /((\+?84|0)[\s.-]?)?(3[2-9]|5[689]|7[06-9]|8[1-689]|9[0-46-9])[0-9\s.-]{7,}/g

const CONTACT_SCAN_TARGET_URLS: Partial<Record<ContactType, string>> = {
  person: 'https://www.facebook.com/friends/list',
  group: 'https://www.facebook.com/groups/joins/',
  page: 'https://business.facebook.com/content_management'
}

interface GraphApiError {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
}

interface GraphApiResponse<T> {
  data?: T
  paging?: {
    next?: string
  }
  error?: GraphApiError
  access_token?: string
}

interface PageInboxParticipant {
  id?: string
  name?: string
  email?: string
}

interface PageInboxMessage {
  id?: string
  message?: string
  created_time?: string
  from?: PageInboxParticipant
}

interface PageInboxConversation {
  id?: string
  updated_time?: string
  participants?: {
    data?: PageInboxParticipant[]
  }
  messages?: {
    data?: PageInboxMessage[]
  }
}

/**
 * ContactLoader coordinates DataScanModal jobs.
 *
 * The scraping logic itself lives in built-in workflow v2 blocks so scan behavior
 * can be edited from the workflow editor. Runtime uses hidden/offscreen pages,
 * sharing the same persistent account partition as campaign automation.
 */
export class ContactLoader {
  private supabase: SupabaseService
  private mainWindow: BrowserWindow
  private cancelledLoads = new Set<number>()
  private activeLoads = new Map<number, ActiveContactLoad>()
  private backgroundPages = new BackgroundPageManager()
  private engineV2 = new WorkflowEngineV2()
  private backgroundPreviewTimers = new Map<number, ReturnType<typeof setInterval>>()
  private backgroundPreviewCapturing = new Set<number>()
  private dataTypeCategoryIdByCode: Map<string, number> | null = null
  private proxyRuntime?: ProxyRuntimeService
  private readonly zaloRuntimeTarget: 'desktop' | 'server'
  private zaloRuntimeBlockedForRestart = false
  private zaloRuntimeClaimsAbandoned = false

  constructor(
    supabase: SupabaseService,
    _webviewRegistry: WebviewRegistry,
    mainWindow: BrowserWindow,
    proxyRuntime?: ProxyRuntimeService,
    private readonly zaloRuntime?: ZaloContactScanSource,
    options: ContactLoaderOptions = {}
  ) {
    this.supabase = supabase
    this.mainWindow = mainWindow
    this.proxyRuntime = proxyRuntime
    this.zaloRuntimeTarget = options.zaloRuntimeTarget || 'desktop'
  }

  destroyBackgroundPage(accountId: number): void {
    this.backgroundPages.destroy(accountId)
  }

  async loadFriends(accountId: number): Promise<ContactLoadResult> {
    const account = await this.supabase.getAccount(accountId).catch(() => null)
    if (account?.flatformType === 'zalo') {
      return this.loadZaloFriends(account)
    }
    return this.loadContacts(accountId, 'person')
  }

  async loadGroups(accountId: number): Promise<ContactLoadResult> {
    const account = await this.supabase.getAccount(accountId).catch(() => null)
    if (account?.flatformType === 'zalo') {
      return this.loadZaloGroups(account)
    }
    return this.loadContacts(accountId, 'group')
  }

  async loadZaloGroupMembers(
    accountId: number,
    request: ZaloGroupMemberScanRequest
  ): Promise<ContactLoadResult> {
    const account = await this.supabase.getAccount(accountId).catch(() => null)
    return this.loadZaloGroupMembersForAccount(account, request)
  }

  async loadPages(accountId: number): Promise<ContactLoadResult> {
    return this.loadContacts(accountId, 'page')
  }

  async loadPostCommenters(accountId: number, postUrl: string, maxCommenters: number): Promise<ContactLoadResult> {
    const normalizedPostUrl = this.normalizeFacebookPostUrl(postUrl)
    const commenterLimit = this.normalizeCommenterLimit(maxCommenters)

    if (!normalizedPostUrl) {
      return this.completeLoad(accountId, 'person', {
        success: false,
        count: 0,
        error: 'Vui lòng nhập link bài post Facebook hợp lệ',
        maxCommenters: commenterLimit
      })
    }

    return this.loadContacts(accountId, 'person', {
      workflowName: POST_COMMENTERS_WORKFLOW,
      targetUrl: normalizedPostUrl,
      runKeyLabel: 'post-commenters',
      typeName: 'người comment',
      previewTitle: 'Đang quét người comment bài post',
      markMissingDeleted: false,
      preserveExistingFriendStatus: true,
      variables: {
        sourcePostUrl: normalizedPostUrl,
        maxCommenters: commenterLimit
      },
      resultMeta: {
        sourcePostUrl: normalizedPostUrl,
        maxCommenters: commenterLimit
      },
      dataset: {
        scanType: 'facebook_post_commenters',
        actionLabel: 'Lấy người comment bài post',
        platformLabel: 'Facebook',
        sourceKey: normalizedPostUrl,
        targetNameOrUid: 'Bài post',
        link: normalizedPostUrl,
        extraData: {
          source: 'facebook_post_commenters',
          sourcePostUrl: normalizedPostUrl,
          maxCommenters: commenterLimit
        }
      }
    })
  }

  async loadPostLikes(accountId: number, postUrl: string, maxLikes: number): Promise<ContactLoadResult> {
    const normalizedPostUrl = this.normalizeFacebookPostUrl(postUrl)
    const likeLimit = this.normalizePostLikeLimit(maxLikes)

    if (!normalizedPostUrl) {
      return this.completeLoad(accountId, 'person', {
        success: false,
        count: 0,
        error: 'Vui lòng nhập link bài post Facebook hợp lệ',
        maxLikes: likeLimit
      })
    }

    return this.loadContacts(accountId, 'person', {
      workflowName: POST_LIKES_WORKFLOW,
      targetUrl: normalizedPostUrl,
      runKeyLabel: 'post-likes',
      typeName: 'người like',
      previewTitle: 'Đang quét người like bài post',
      markMissingDeleted: false,
      preserveExistingFriendStatus: true,
      variables: {
        sourcePostUrl: normalizedPostUrl,
        maxLikes: likeLimit
      },
      resultMeta: {
        sourcePostUrl: normalizedPostUrl,
        maxLikes: likeLimit
      },
      dataset: {
        scanType: 'facebook_post_likes',
        actionLabel: 'Lấy người like bài post',
        platformLabel: 'Facebook',
        sourceKey: normalizedPostUrl,
        targetNameOrUid: 'Bài post',
        link: normalizedPostUrl,
        extraData: {
          source: 'facebook_post_likes',
          sourcePostUrl: normalizedPostUrl,
          maxLikes: likeLimit
        }
      }
    })
  }

  async loadProfileFriends(accountId: number, profileUrl: string, maxFriends: number): Promise<ContactLoadResult> {
    const friendLimit = this.normalizeProfileFriendLimit(maxFriends)
    const profileTarget = this.normalizeFacebookProfileScanTarget(profileUrl)

    if (!profileTarget) {
      return this.completeLoad(accountId, 'person', {
        success: false,
        count: 0,
        error: 'Vui lòng nhập link/UID profile Facebook hợp lệ',
        maxFriends: friendLimit
      })
    }

    return this.loadContacts(accountId, 'person', {
      workflowName: PROFILE_FRIENDS_WORKFLOW,
      targetUrl: profileTarget.targetUrl,
      runKeyLabel: `profile-friends-${profileTarget.sourceProfileUid}`,
      typeName: 'bạn bè của profile',
      previewTitle: 'Đang quét bạn bè của profile',
      markMissingDeleted: false,
      variables: {
        profileUrl: profileTarget.sourceProfileUrl,
        sourceProfileUrl: profileTarget.sourceProfileUrl,
        sourceProfileUid: profileTarget.sourceProfileUid,
        maxFriends: friendLimit
      },
      resultMeta: {
        sourceProfileUrl: profileTarget.sourceProfileUrl,
        sourceProfileUid: profileTarget.sourceProfileUid,
        maxFriends: friendLimit
      },
      dataset: {
        scanType: 'facebook_profile_friends',
        actionLabel: 'Lấy danh sách bạn bè của profile',
        platformLabel: 'Facebook',
        sourceKey: profileTarget.sourceProfileUid || profileTarget.sourceProfileUrl,
        targetNameOrUid: profileTarget.sourceProfileUid,
        link: profileTarget.sourceProfileUrl,
        extraData: {
          source: 'facebook_profile_friends',
          sourceProfileUrl: profileTarget.sourceProfileUrl,
          sourceProfileUid: profileTarget.sourceProfileUid,
          maxFriends: friendLimit
        }
      }
    })
  }

  async loadGroupMembers(accountId: number, groupUrl: string, maxGroupMembers: number): Promise<ContactLoadResult> {
    const memberLimit = this.normalizeGroupMemberLimit(maxGroupMembers)
    const groupTarget = this.normalizeFacebookGroupScanTarget(groupUrl)

    if (!groupTarget) {
      return this.completeLoad(accountId, 'person', {
        success: false,
        count: 0,
        error: 'Vui lòng nhập link/UID group Facebook hợp lệ',
        maxGroupMembers: memberLimit
      })
    }

    return this.loadContacts(accountId, 'person', {
      workflowName: GROUP_MEMBERS_WORKFLOW,
      targetUrl: groupTarget.targetUrl,
      runKeyLabel: 'group-members',
      typeName: 'thành viên group',
      previewTitle: 'Đang quét thành viên group',
      markMissingDeleted: false,
      preserveExistingFriendStatus: true,
      variables: {
        findDataGroupUrl: groupTarget.sourceGroupUrl,
        sourceGroupUrl: groupTarget.sourceGroupUrl,
        sourceGroupUid: groupTarget.sourceGroupUid,
        isFindInGroupMembers: true,
        isFindUid: true,
        countGroupMemberFindData: memberLimit
      },
      resultMeta: {
        sourceGroupUrl: groupTarget.sourceGroupUrl,
        sourceGroupUid: groupTarget.sourceGroupUid,
        maxGroupMembers: memberLimit
      },
      dataset: {
        scanType: 'facebook_group_members',
        actionLabel: 'Lấy thành viên group',
        platformLabel: 'Facebook',
        sourceKey: groupTarget.sourceGroupUid || groupTarget.sourceGroupUrl,
        targetNameOrUid: groupTarget.sourceGroupUid,
        link: groupTarget.sourceGroupUrl,
        extraData: {
          source: 'facebook_group_members',
          sourceGroupUrl: groupTarget.sourceGroupUrl,
          sourceGroupUid: groupTarget.sourceGroupUid,
          maxGroupMembers: memberLimit
        }
      }
    })
  }

  async getPageInboxScanInfo(accountId: number, pageUid: string): Promise<PageInboxScanInfo> {
    const latestMessageAt = localContactRepo.getLatestPageInboxMessageAt(accountId, pageUid)
    let estimatedSecondsPer20000 = DEFAULT_PAGE_INBOX_ESTIMATE_SECONDS
    try {
      estimatedSecondsPer20000 = normalizePageInboxEstimateSeconds(
        await this.supabase.getSystemSettingValue(PAGE_INBOX_ESTIMATE_SETTING_KEY)
      )
    } catch {
      console.warn('[ContactLoader] Cannot read Page inbox scan estimate; using 2400 seconds.')
    }
    return { latestMessageAt, estimatedSecondsPer20000 }
  }

  async loadPageInboxCustomers(
    accountId: number,
    pageUid: string,
    pageName?: string,
    options?: PageInboxScanOptions,
    ensureAccess?: () => Promise<void>
  ): Promise<ContactLoadResult> {
    const normalizedPageUid = String(pageUid || '').trim()
    const normalizedPageName = String(pageName || '').replace(/\s+/g, ' ').trim()
    const typeName = 'người từng nhắn tin với page'
    let scanOptions: Required<PageInboxScanOptions>
    try {
      scanOptions = validatePageInboxScanOptions(options)
    } catch (err: any) {
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: false, count: 0, pageInboxStopReason: 'error', error: err.message || String(err)
      })
    }

    if (!normalizedPageUid) {
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: false,
        count: 0,
        error: 'Vui lòng chọn page cần quét.',
        pageInboxStopReason: 'error'
      })
    }

    // Register before any async authorization/preflight so an early Stop belongs
    // to this run. Authorization still precedes DB claims, local reads and Graph.
    const loadState = this.startLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {}, {
      runKeyLabel: `page-inbox-${normalizedPageUid}`,
      targetUrl: 'https://business.facebook.com/content_management'
    })
    let runnableAccount: AutoAccount | null = null
    let runtimeClaim: AccountRuntimeScanClaim | null = null
    const variables = loadState.variables
    let pendingContacts: localContactRepo.PageInboxContactInput[] = []
    let savedCount = 0
    let completionResult: ContactLoadResult | undefined
    const finish = (result: ContactLoadResult): ContactLoadResult => {
      completionResult = { ...result, runKey: loadState.runKey }
      return completionResult
    }
    const isCancelled = () => this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
    const read = <T>(operation: () => Promise<T>) => this.readPageInboxUntilCancelled(loadState, operation)
    const flushContacts = () => {
      if (pendingContacts.length === 0) return
      savedCount += localContactRepo.upsertPageInboxContacts(pendingContacts)
      pendingContacts = []
    }

    try {
      if (ensureAccess) await read(ensureAccess)
      const account = await read(() => this.supabase.getAccount(accountId))
      const preflightError = this.getPreflightError(account)
      if (preflightError) throw new Error(preflightError)

      const latestAccount = await read(() => this.supabase.getAccount(accountId))
      const latestPreflightError = this.getPreflightError(latestAccount)
      if (latestPreflightError) throw new Error(latestPreflightError)
      runnableAccount = latestAccount!
      if (isCancelled()) throw new Error('Đã dừng quét.')

      // Do not race a mutating claim against cancellation: it may commit after
      // Stop. Await its result and release the returned token in finally.
      runtimeClaim = await this.claimAccountForScan(runnableAccount)
      if (isCancelled()) throw new Error('Đã dừng quét.')

      const clock = await read(() => this.supabase.getRuntimeClock())
      const latestMessageAt = scanOptions.mode === 'since_latest_message'
        ? localContactRepo.getLatestPageInboxMessageAt(accountId, normalizedPageUid)
        : null
      const cutoff = getPageInboxScanCutoff(scanOptions, clock.vietnamDateKey, latestMessageAt)
      if (isCancelled()) throw new Error('Đã dừng quét.')

      this.sendProgress(`🔄 Đang lấy token để quét inbox page ${normalizedPageName || normalizedPageUid}...`, {
        accountId,
        contactType: PAGE_INBOX_CONTACT_TYPE,
        runKey: loadState.runKey
      })

      await this.proxyRuntime?.prepareAccountSession(runnableAccount)
      if (isCancelled()) throw new Error('Đã dừng quét.')
      const page = this.backgroundPages.getOrCreate(accountId, runnableAccount.flatformType)
      this.selectAutomationBrowser(accountId)
      this.startBackgroundPreview(accountId, page, 'Đang quét người nhắn tin với page')

      await read(() => page.navigate('https://business.facebook.com/content_management'))
      await this.sleep(5000, loadState.controller.signal)
      if (isCancelled()) throw new Error('Đã dừng quét.')

      const userAccessToken = await read(() => this.extractFacebookUserAccessToken(page, loadState.controller.signal))
      if (!userAccessToken) {
        throw new Error('Không lấy được token Facebook. Vui lòng mở lại tab Facebook/Business và thử lại.')
      }

      const cookieHeader = await read(() => this.getFacebookCookieHeader(page))
      const pageAccessToken = await this.getPageAccessToken(normalizedPageUid, userAccessToken, cookieHeader, loadState.controller.signal)
      if (!pageAccessToken) {
        throw new Error('Không lấy được Page access token. Tài khoản cần có quyền nhắn tin trên page này.')
      }
      if (isCancelled()) throw new Error('Đã dừng quét.')

      let nextUrl = this.buildPageInboxConversationsUrl(normalizedPageUid, pageAccessToken)
      const seenPsids = new Set<string>()
      const fetchedUrls = new Set<string>()
      let scannedCount = 0
      let fetchFailureCount = 0
      let fetchFailureMessage = ''
      let reachedMaxContacts = false
      let reachedDateLimit = false

      while (nextUrl) {
        if (this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted) break

        let response: GraphApiResponse<PageInboxConversation[]>
        try {
          response = await this.fetchGraphJson<PageInboxConversation[]>(nextUrl, cookieHeader, loadState.controller.signal)
          fetchFailureCount = 0
          fetchFailureMessage = ''
        } catch (err: any) {
          if (isCancelled()) break
          fetchFailureCount += 1
          fetchFailureMessage = err?.message || String(err)
          if (fetchFailureCount >= PAGE_INBOX_MAX_FETCH_FAILURES) break
          this.sendProgress(`Facebook đang phản hồi lỗi, thử lại lần ${fetchFailureCount + 1}/${PAGE_INBOX_MAX_FETCH_FAILURES}...`, {
            accountId,
            contactType: PAGE_INBOX_CONTACT_TYPE,
            runKey: loadState.runKey
          })
          await this.sleep(2000, loadState.controller.signal)
          if (this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted) break
          continue
        }

        const conversations = Array.isArray(response.data) ? response.data : []
        scannedCount += conversations.length
        fetchedUrls.add(nextUrl)
        let allBeforeCutoff = cutoff !== null && conversations.length > 0

        for (const conversation of conversations) {
          const timestamp = this.getPageInboxConversationTimestamp(conversation)
          if (timestamp === null || cutoff === null || timestamp >= cutoff) {
            allBeforeCutoff = false
          } else {
            continue
          }
          const contact = this.mapPageInboxConversation(
            accountId,
            normalizedPageUid,
            normalizedPageName,
            conversation
          )
          if (!contact || seenPsids.has(contact.uid)) continue
          seenPsids.add(contact.uid)
          pendingContacts.push(contact)
          if (seenPsids.size >= scanOptions.maxCustomers) {
            reachedMaxContacts = true
            break
          }
        }
        reachedDateLimit = allBeforeCutoff

        const cancelledAfterPage = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
        if (pendingContacts.length >= PAGE_INBOX_BATCH_SIZE) {
          flushContacts()
          if (!cancelledAfterPage) this.sendProgress(`💾 Đã lưu ${savedCount} ${typeName}...`, {
            accountId,
            contactType: PAGE_INBOX_CONTACT_TYPE,
            runKey: loadState.runKey
          })
        } else if (!cancelledAfterPage) {
          this.sendProgress(`🔎 Đã đọc ${scannedCount} cuộc trò chuyện, tìm được ${seenPsids.size} người.`, {
            accountId,
            contactType: PAGE_INBOX_CONTACT_TYPE,
            runKey: loadState.runKey
          })
        }

        if (cancelledAfterPage) break
        if (reachedMaxContacts || reachedDateLimit) break
        nextUrl = response.paging?.next || ''
        if (nextUrl && fetchedUrls.has(nextUrl)) throw new Error('Facebook trả lại trang dữ liệu đã đọc. Đã dừng để tránh quét lặp.')
      }

      flushContacts()

      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${savedCount} data.`, {
          accountId,
          contactType: PAGE_INBOX_CONTACT_TYPE,
          runKey: loadState.runKey
        })
        return finish({
          success: true,
          count: savedCount,
          stopped: true,
          pageInboxStopReason: 'cancelled'
        })
      }

      if (fetchFailureCount >= PAGE_INBOX_MAX_FETCH_FAILURES) {
        throw new Error(`Server tin nhắn của Facebook bị lỗi hoặc đang bảo trì: ${fetchFailureMessage}`)
      }

      const stopReason: PageInboxScanStopReason = reachedMaxContacts ? 'customer_limit' : reachedDateLimit ? 'date_limit' : 'exhausted'
      const stopMessage = reachedMaxContacts
        ? `Đã đạt giới hạn ${scanOptions.maxCustomers.toLocaleString('vi-VN')} khách hàng.`
        : reachedDateLimit && cutoff !== null
          ? `Đã lấy hết dữ liệu đến ngày ${formatPageInboxScanDate(new Date(cutoff).toISOString())}.`
          : 'Facebook đã trả hết dữ liệu.'
      this.sendProgress(`✅ Đã quét và lưu ${savedCount} ${typeName}. ${stopMessage}`, {
        accountId,
        contactType: PAGE_INBOX_CONTACT_TYPE,
        runKey: loadState.runKey
      })
      return finish({
        success: true,
        count: savedCount,
        pageInboxStopReason: stopReason
      })
    } catch (err: any) {
      let saveError = ''
      try {
        flushContacts()
      } catch (error: any) {
        saveError = `Không thể lưu phần dữ liệu còn lại: ${error.message || String(error)}`
      }
      const stopped = isCancelled() && !saveError
      const errMsg = saveError || err?.message || String(err)
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${savedCount} data.`, {
          accountId,
          contactType: PAGE_INBOX_CONTACT_TYPE,
          runKey: loadState.runKey
        })
        return finish({
          success: true,
          count: savedCount,
          stopped: true,
          pageInboxStopReason: 'cancelled'
        })
      }

      this.sendProgress(`❌ Lỗi quét ${typeName}: ${errMsg}. Đã lưu ${savedCount} data.`, {
        accountId,
        contactType: PAGE_INBOX_CONTACT_TYPE,
        runKey: loadState.runKey
      })
      return finish({
        success: false,
        count: savedCount,
        error: `${errMsg}. Đã lưu ${savedCount} data.`,
        pageInboxStopReason: 'error'
      })
    } finally {
      if (runnableAccount && runtimeClaim) {
        await this.restoreAccountStatus(runnableAccount, runtimeClaim)
      }
      if (this.activeLoads.get(accountId) === loadState) {
        this.activeLoads.delete(accountId)
        this.cancelledLoads.delete(accountId)
        this.stopBackgroundPreview(accountId)
        this.backgroundPages.destroy(accountId)
      }
      if (completionResult) this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, completionResult, loadState.runKey)
    }
  }

  /** Snapshot the run before the cancel IPC performs its async access check. */
  capturePageInboxCancellation(accountId: number): (() => void) | undefined {
    const active = this.activeLoads.get(accountId)
    if (active?.contactType !== PAGE_INBOX_CONTACT_TYPE) return undefined
    return () => {
      if (this.activeLoads.get(accountId) === active) this.cancelLoad(accountId)
    }
  }

  private readPageInboxUntilCancelled<T>(loadState: ActiveContactLoad, operation: () => Promise<T>): Promise<T> {
    const signal = loadState.controller.signal
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error('Đã dừng quét.'))
      }
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      // Only read-only/preflight work may outlive this wait. Rejection handlers
      // stay attached so a late DB/browser failure cannot become unhandled.
      Promise.resolve().then(() => {
        signal.throwIfAborted()
        return operation()
      }).then(value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      }, error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      })
    })
  }

  cancelLoad(accountId: number): void {
    this.cancelledLoads.add(accountId)
    const active = this.activeLoads.get(accountId)
    if (active) {
      active.variables.contactScanCancelled = true
      if (active.contactType === PAGE_INBOX_CONTACT_TYPE) active.controller.abort()
      if (active.runtimePlatform === 'zalo') {
        void Promise.resolve(this.zaloRuntime?.cancelActiveQuery?.(accountId)).catch(error => {
          console.warn('[ContactLoader] Failed to cancel active Zalo scan query:', {
            accountId,
            errorName: error instanceof Error ? error.name : 'UnknownError'
          })
        })
      }
    }
  }

  stopAll(): void {
    for (const [accountId, active] of this.activeLoads.entries()) {
      active.variables.contactScanCancelled = true
      active.controller.abort()
      if (active.runtimePlatform === 'zalo') {
        void Promise.resolve(this.zaloRuntime?.cancelActiveQuery?.(accountId)).catch(() => undefined)
      }
      this.stopBackgroundPreview(accountId)
    }
    this.stopAllBackgroundPreviews()
    this.backgroundPages.destroyAll()
  }

  blockZaloRuntimeForRestart(): void {
    if (this.zaloRuntimeBlockedForRestart) return
    this.zaloRuntimeBlockedForRestart = true
    for (const [accountId, active] of this.activeLoads.entries()) {
      if (active.runtimePlatform !== 'zalo') continue
      active.variables.contactScanCancelled = true
      active.controller.abort()
      this.stopBackgroundPreview(accountId)
    }
  }

  resetZaloRuntimeRestartBlock(): void {
    this.zaloRuntimeBlockedForRestart = false
  }

  abandonZaloRuntimeClaims(): void {
    this.zaloRuntimeClaimsAbandoned = true
  }

  resetZaloRuntimeClaims(): void {
    this.zaloRuntimeClaimsAbandoned = false
  }

  async waitForIdle(timeoutMs = 30_000, platform?: 'zalo' | 'other'): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (Array.from(this.activeLoads.values()).some(active => !platform || active.runtimePlatform === platform)) {
      if (Date.now() >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return true
  }

  private async loadZaloFriends(account: AutoAccount): Promise<ContactLoadResult> {
    const accountId = account.id
    const contactType: ContactType = 'person'
    const typeName = 'bạn bè Zalo'
    const preflightError = this.getZaloPreflightError(account)
    if (preflightError) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: preflightError
      })
    }

    const latestAccount = await this.supabase.getAccount(accountId)
    const latestPreflightError = this.getZaloPreflightError(latestAccount)
    if (latestPreflightError) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: latestPreflightError
      })
    }

    const loadState = this.startLoad(accountId, contactType, {}, {
      runKeyLabel: 'zalo-friends',
      targetUrl: 'zalo://friends',
      runtimePlatform: 'zalo'
    })
    let runtimeClaim: AccountRuntimeScanClaim = {
      previousStatus: latestAccount!.status as AccountRuntimePreviousStatus,
      claimToken: null,
      staffId: null
    }
    const variables = loadState.variables
    let claimedAccount = false

    try {
      runtimeClaim = await this.claimAccountForScan(latestAccount!)
      claimedAccount = true

      if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
      this.sendProgress('🔄 Đang kiểm tra trạng thái đăng nhập Zalo...', {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const session = await this.runZaloFriendApiWith429Retry(
        accountId,
        loadState,
        'kiểm tra phiên đăng nhập',
        () => this.zaloRuntime!.checkSession(accountId),
        result => !result.loggedIn && this.isZalo429Error(result.reason)
      )
      if (!session.loggedIn) {
        throw new Error(session.reason || 'Tài khoản chưa đăng nhập Zalo')
      }

      const initialDelayMs = this.getZaloFriendApiDelayMs()
      this.sendProgress(`⏳ Chờ ${(initialDelayMs / 1000).toFixed(1)} giây trước khi đọc danh sách ${typeName}...`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      await this.waitForZaloFriendApiDelay(accountId, loadState, initialDelayMs)

      const contacts: ZaloUserContactInput[] = []
      let page = 1
      while (!this.isLoadCancelled(accountId, variables) && !loadState.controller.signal.aborted) {
        this.sendProgress(`🔄 Đang lấy trang ${page} danh sách ${typeName}...`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        const rows = await this.runZaloFriendApiWith429Retry(
          accountId,
          loadState,
          `đọc trang ${page} danh sách ${typeName}`,
          () => this.zaloRuntime!.getAllFriendsPage(accountId, ZALO_FRIEND_PAGE_SIZE, page)
        )
        for (const row of rows) {
          const contact = this.mapZaloUserContact(accountId, row)
          if (contact) contacts.push(contact)
        }
        this.sendProgress(`Đã đọc ${contacts.length} ${typeName}.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        if (rows.length < ZALO_FRIEND_PAGE_SIZE) break
        const pageDelayMs = this.getZaloFriendApiDelayMs()
        this.sendProgress(`⏳ Chờ ${(pageDelayMs / 1000).toFixed(1)} giây trước khi đọc trang tiếp theo...`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        await this.waitForZaloFriendApiDelay(accountId, loadState, pageDelayMs)
        page += 1
      }

      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      if (contacts.length === 0) {
        if (stopped) {
          await this.supabase.deleteContacts(accountId, contactType)
          this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu 0 data cho lần quét này.`, {
            accountId,
            contactType,
            runKey: loadState.runKey
          })
          return this.completeLoad(accountId, contactType, {
            success: true,
            count: 0,
            stopped: true
          }, loadState.runKey)
        }
        return this.completeLoad(accountId, contactType, {
          success: false,
          count: 0,
          error: `Không tìm thấy ${typeName} nào`
        }, loadState.runKey)
      }

      this.sendProgress(`💾 Đang lưu ${contacts.length} ${typeName}...`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const saved = await this.supabase.upsertZaloUserContacts(contacts)

      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${saved} data cho lần quét này.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          success: true,
          count: saved,
          stopped: true
        }, loadState.runKey)
      }

      await this.syncZaloLabelsForContacts(accountId, contactType, loadState)

      this.sendProgress(`✅ Đã load ${saved} ${typeName} thành công!`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, { success: true, count: saved }, loadState.runKey)
    } catch (err: any) {
      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      const errMsg = err?.message || String(err)
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          success: true,
          count: 0,
          stopped: true
        }, loadState.runKey)
      }

      this.sendProgress(`❌ Lỗi load ${typeName}: ${errMsg}`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: errMsg
      }, loadState.runKey)
    } finally {
      if (claimedAccount) {
        await this.restoreAccountStatus(latestAccount!, runtimeClaim)
      }
      if (this.activeLoads.get(accountId) === loadState) {
        this.activeLoads.delete(accountId)
        this.cancelledLoads.delete(accountId)
      }
    }
  }

  private getZaloFriendApiDelayMs(): number {
    return Math.floor(
      Math.random() * (ZALO_FRIEND_API_MAX_DELAY_MS - ZALO_FRIEND_API_MIN_DELAY_MS + 1)
    ) + ZALO_FRIEND_API_MIN_DELAY_MS
  }

  private isZalo429Error(value: unknown): boolean {
    if (typeof value === 'string') {
      return /\b429\b|too many requests/i.test(value)
    }
    if (!value || typeof value !== 'object') return false

    const error = value as {
      code?: unknown
      message?: unknown
      status?: unknown
      response?: { status?: unknown }
      cause?: unknown
    }
    if (
      Number(error.code) === 429 ||
      Number(error.response?.status) === 429 ||
      Number(error.status) === 429
    ) return true
    if (typeof error.message === 'string' && this.isZalo429Error(error.message)) return true
    return error.cause !== value && this.isZalo429Error(error.cause)
  }

  private async runZaloFriendApiWith429Retry<T>(
    accountId: number,
    loadState: ActiveContactLoad,
    operationLabel: string,
    operation: () => Promise<T>,
    resultIs429: (result: T) => boolean = () => false
  ): Promise<T> {
    let retryIndex = 0
    while (true) {
      try {
        const result = await operation()
        if (!resultIs429(result) || retryIndex >= ZALO_FRIEND_API_429_RETRY_DELAYS_MS.length) {
          return result
        }
      } catch (err) {
        if (!this.isZalo429Error(err) || retryIndex >= ZALO_FRIEND_API_429_RETRY_DELAYS_MS.length) {
          throw err
        }
      }

      const retryDelayMs = ZALO_FRIEND_API_429_RETRY_DELAYS_MS[retryIndex]
      this.sendProgress(
        `⚠️ Zalo đang giới hạn request khi ${operationLabel}. Tự thử lại sau ${retryDelayMs / 1000} giây (${retryIndex + 1}/${ZALO_FRIEND_API_429_RETRY_DELAYS_MS.length})...`,
        {
          accountId,
          contactType: loadState.contactType,
          runKey: loadState.runKey
        }
      )
      await this.waitForZaloFriendApiDelay(accountId, loadState, retryDelayMs)
      retryIndex += 1
    }
  }

  private async waitForZaloFriendApiDelay(
    accountId: number,
    loadState: ActiveContactLoad,
    delayMs: number
  ): Promise<void> {
    const deadline = Date.now() + Math.max(0, delayMs)
    while (Date.now() < deadline) {
      if (this.isLoadCancelled(accountId, loadState.variables) || loadState.controller.signal.aborted) {
        throw new Error('Đã dừng quét bạn bè Zalo')
      }
      await this.sleep(Math.min(250, deadline - Date.now()))
    }
  }

  private mapZaloLabelToContact(accountId: number, label: ZaloLabelOption): Partial<AutoAccountContact> {
    return {
      accountId,
      contactType: 'zalo_tag',
      uid: String(label.id),
      name: label.text,
      extraData: {
        textKey: label.textKey || undefined,
        color: label.color || undefined,
        emoji: label.emoji || undefined,
        conversations: Array.isArray(label.conversations)
          ? label.conversations.map(item => String(item || '').trim()).filter(Boolean)
          : []
      }
    }
  }

  private async syncZaloLabelsForContacts(
    accountId: number,
    contactType: ContactType,
    loadState: ActiveContactLoad
  ): Promise<void> {
    if (!this.zaloRuntime) return
    this.sendProgress('🏷️ Đang đồng bộ tag Zalo...', {
      accountId,
      contactType,
      runKey: loadState.runKey
    })

    try {
      const labels = await this.zaloRuntime.listLabels(accountId)
      if (labels.length === 0) {
        await this.supabase.deleteContacts(accountId, 'zalo_tag')
      } else {
        await this.supabase.upsertContacts(
          labels.map(label => this.mapZaloLabelToContact(accountId, label)),
          { markMissingDeleted: true }
        )
      }

      const updated = await this.supabase.syncZaloLabelMemberships(accountId, labels)
      this.sendProgress(`🏷️ Đã đồng bộ tag Zalo cho ${updated} data.`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[ContactLoader] Failed to sync Zalo labels:', {
        accountId,
        contactType,
        message
      })
      this.sendProgress(`⚠️ Không thể đồng bộ tag Zalo: ${message}`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
    }
  }

  private async loadZaloGroups(account: AutoAccount): Promise<ContactLoadResult> {
    const accountId = account.id
    const contactType: ContactType = 'group'
    const typeName = 'group Zalo'
    const preflightError = this.getZaloPreflightError(account)
    if (preflightError) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: preflightError
      })
    }

    const latestAccount = await this.supabase.getAccount(accountId)
    const latestPreflightError = this.getZaloPreflightError(latestAccount)
    if (latestPreflightError) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: latestPreflightError
      })
    }

    const loadState = this.startLoad(accountId, contactType, {}, {
      runKeyLabel: 'zalo-groups',
      targetUrl: 'zalo://groups',
      runtimePlatform: 'zalo'
    })
    let runtimeClaim: AccountRuntimeScanClaim = {
      previousStatus: latestAccount!.status as AccountRuntimePreviousStatus,
      claimToken: null,
      staffId: null
    }
    const variables = loadState.variables
    let claimedAccount = false

    try {
      runtimeClaim = await this.claimAccountForScan(latestAccount!)
      claimedAccount = true

      if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
      this.sendProgress('🔄 Đang kiểm tra session Zalo...', {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const session = await this.zaloRuntime.checkSession(accountId)
      if (!session.loggedIn) {
        throw new Error(session.reason || 'Tài khoản chưa đăng nhập Zalo')
      }

      this.sendProgress(`🔄 Đang lấy danh sách ${typeName}...`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const groupVersions = await this.zaloRuntime.getAllGroups(accountId)
      const groupIds = Object.keys(groupVersions)
      const groups: ZaloGroupContactInput[] = []

      for (let i = 0; i < groupIds.length; i += ZALO_GROUP_INFO_BATCH_SIZE) {
        if (this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted) break
        const chunk = groupIds.slice(i, i + ZALO_GROUP_INFO_BATCH_SIZE)
        this.sendProgress(`🔄 Đang lấy thông tin ${typeName} ${i + 1}-${i + chunk.length}/${groupIds.length}...`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        const batch = await this.zaloRuntime.getGroupInfoBatch(accountId, chunk)
        for (const groupId of chunk) {
          const raw = batch.gridInfoMap[groupId] || { groupId, version: groupVersions[groupId] }
          const group = this.mapZaloGroupContact(accountId, raw, groupVersions[groupId])
          if (group) groups.push(group)
        }
      }

      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      if (groups.length === 0) {
        if (stopped) {
          await this.supabase.deleteContacts(accountId, contactType)
          this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu 0 data cho lần quét này.`, {
            accountId,
            contactType,
            runKey: loadState.runKey
          })
          return this.completeLoad(accountId, contactType, {
            success: true,
            count: 0,
            stopped: true
          }, loadState.runKey)
        }
        return this.completeLoad(accountId, contactType, {
          success: false,
          count: 0,
          error: `Không tìm thấy ${typeName} nào`
        }, loadState.runKey)
      }

      this.sendProgress(`💾 Đang lưu ${groups.length} ${typeName}...`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const saved = await this.supabase.upsertZaloGroupContacts(groups)

      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${saved} data cho lần quét này.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          success: true,
          count: saved,
          stopped: true
        }, loadState.runKey)
      }

      await this.syncZaloLabelsForContacts(accountId, contactType, loadState)

      this.sendProgress(`✅ Đã load ${saved} ${typeName} thành công!`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, { success: true, count: saved }, loadState.runKey)
    } catch (err: any) {
      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      const errMsg = err?.message || String(err)
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          success: true,
          count: 0,
          stopped: true
        }, loadState.runKey)
      }

      this.sendProgress(`❌ Lỗi load ${typeName}: ${errMsg}`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: errMsg
      }, loadState.runKey)
    } finally {
      if (claimedAccount) {
        await this.restoreAccountStatus(latestAccount!, runtimeClaim)
      }
      if (this.activeLoads.get(accountId) === loadState) {
        this.activeLoads.delete(accountId)
        this.cancelledLoads.delete(accountId)
      }
    }
  }

  private async loadZaloGroupMembersForAccount(
    account: AutoAccount | null,
    request: ZaloGroupMemberScanRequest
  ): Promise<ContactLoadResult> {
    const accountId = account?.id || 0
    const contactType: ContactType = 'person'
    const mode = request?.mode === 'group_link' ? 'group_link' : 'joined_group'
    const normalizedGroupId = this.stringValue(request?.zaloGroupId)
    const normalizedLink = this.normalizeZaloGroupLink(request?.link)
    const typeName = mode === 'group_link'
      ? 'thành viên link group Zalo'
      : 'thành viên group Zalo'

    if (!accountId) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Không tìm thấy tài khoản'
      })
    }

    if (mode === 'joined_group' && !normalizedGroupId) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Vui lòng chọn group Zalo đã tham gia.'
      })
    }

    if (mode === 'group_link' && !normalizedLink) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Vui lòng nhập link group Zalo hợp lệ.'
      })
    }

    const preflightError = this.getZaloPreflightError(account)
    if (preflightError) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: preflightError
      })
    }

    const latestAccount = await this.supabase.getAccount(accountId)
    const latestPreflightError = this.getZaloPreflightError(latestAccount)
    if (latestPreflightError) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: latestPreflightError
      })
    }

    const scanTarget = mode === 'group_link'
      ? normalizedLink
      : `zalo://group-members/${normalizedGroupId}`
    const loadState = this.startLoad(accountId, contactType, {}, {
      runKeyLabel: mode === 'group_link'
        ? `zalo-group-link-members-${Date.now()}`
        : `zalo-group-members-${normalizedGroupId}`,
      targetUrl: scanTarget || undefined,
      runtimePlatform: 'zalo'
    })
    let runtimeClaim: AccountRuntimeScanClaim = {
      previousStatus: latestAccount!.status as AccountRuntimePreviousStatus,
      claimToken: null,
      staffId: null
    }
    const variables = loadState.variables
    let claimedAccount = false
    let datasetContext: ContactDatasetScanContext | null = null

    try {
      runtimeClaim = await this.claimAccountForScan(latestAccount!)
      claimedAccount = true

      if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
      this.sendProgress('🔄 Đang kiểm tra session Zalo...', {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const session = await this.zaloRuntime.checkSession(accountId)
      if (!session.loggedIn) {
        throw new Error(session.reason || 'Tài khoản chưa đăng nhập Zalo')
      }

      this.sendProgress(
        mode === 'group_link'
          ? '🔄 Đang lấy thông tin group và thành viên từ link Zalo...'
          : '🔄 Đang lấy danh sách thành viên group Zalo...',
        { accountId, contactType, runKey: loadState.runKey }
      )

      const result = mode === 'group_link'
        ? await this.zaloRuntime.getGroupMembersByLink(accountId, normalizedLink!)
        : await this.zaloRuntime.getJoinedGroupMembers(accountId, normalizedGroupId!)

      const resultGroupId = this.firstString(result.group.groupId, normalizedGroupId)
      if (!resultGroupId) throw new Error('Không lấy được Zalo group id.')
      const resolvedGroupName = this.firstString(result.group.name, request?.groupName)
      const resolvedGroupLink = mode === 'group_link'
        ? normalizedLink
        : this.stringValue(result.group.link)
      datasetContext = {
        scanType: 'zalo_group_members',
        actionLabel: 'Lấy thành viên group',
        platformLabel: 'Zalo',
        sourceKey: resultGroupId,
        targetNameOrUid: resolvedGroupName || resultGroupId,
        link: resolvedGroupLink,
        extraData: {
          source: 'zalo_group_members',
          mode,
          targetName: resolvedGroupName,
          targetUid: resultGroupId,
          sourceLink: resolvedGroupLink,
          joinOutcome: result.joinOutcome,
          usedProxy: result.usedProxy === true
        }
      }

      const members: ZaloGroupMemberContactInput[] = result.members.map(member => ({
        zaloGroupId: resultGroupId,
        zaloUid: member.zaloUid,
        displayName: member.displayName,
        zaloName: member.zaloName,
        avatar: member.avatar,
        accountStatus: member.accountStatus,
        type: member.type,
        lastUpdateTime: member.lastUpdateTime,
        globalId: member.globalId,
        role: member.role,
        roleRank: member.roleRank,
        isCreator: member.isCreator,
        isAdmin: member.isAdmin,
        rawPayload: member.rawPayload
      }))

      const groupInput = mode === 'group_link'
        ? this.mapZaloGroupContact(accountId, {
          ...result.group,
          groupId: resultGroupId,
          link: normalizedLink,
          ...(result.joinOutcome === 'joined' || result.joinOutcome === 'already_joined'
            ? { isJoined: true }
            : result.joinOutcome === 'pending_approval'
              ? { isJoined: false }
              : {})
        })
        : null
      if (mode === 'group_link' && !groupInput) {
        throw new Error('Không lấy được thông tin group từ link Zalo.')
      }

      const stoppedBeforeSave = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      if (stoppedBeforeSave) {
        let datasetId: number | undefined
        try {
          datasetId = await this.finalizeScanDataset({
            accountId,
            contactType,
            context: datasetContext,
            contactUids: [],
            stopped: true,
            runKey: loadState.runKey
          })
        } catch (datasetError) {
          console.warn('[ContactLoader] Failed to finalize stopped Zalo dataset:', datasetError)
        }
        this.sendProgress(`Đã dừng quét ${typeName}.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          success: true,
          count: 0,
          datasetId,
          stopped: true,
          zaloGroupId: resultGroupId,
          zaloGroupName: this.stringValue(result.group.name) || undefined,
          usedProxy: result.usedProxy === true
        }, loadState.runKey)
      }

      this.sendProgress(`💾 Đang lưu ${members.length} ${typeName}...`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const saved = await this.supabase.upsertZaloGroupMemberContacts({
        accountId,
        zaloGroupId: resultGroupId,
        group: groupInput,
        members
      })

      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      const datasetId = await this.finalizeScanDataset({
        accountId,
        contactType,
        context: datasetContext,
        contactUids: members.map(member => member.zaloUid),
        stopped,
        runKey: loadState.runKey
      })
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${saved} data cho lần quét này.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          success: true,
          count: saved,
          datasetId,
          stopped: true,
          zaloGroupId: resultGroupId,
          zaloGroupName: this.stringValue(result.group.name) || undefined,
          usedProxy: result.usedProxy === true
        }, loadState.runKey)
      }

      this.sendProgress(`✅ Đã tải ${saved} ${typeName} thành công!`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, {
        success: true,
        count: saved,
        datasetId,
        zaloGroupId: resultGroupId,
        zaloGroupName: this.stringValue(result.group.name) || undefined,
        usedProxy: result.usedProxy === true
      }, loadState.runKey)
    } catch (err: any) {
      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      const errMsg = err?.message || String(err)
      let datasetId: number | undefined
      if (datasetContext) {
        try {
          datasetId = await this.finalizeScanDataset({
            accountId,
            contactType,
            context: datasetContext,
            contactUids: [],
            stopped,
            runKey: loadState.runKey,
            status: stopped ? 'partial' : 'failed'
          })
        } catch (datasetError) {
          console.warn('[ContactLoader] Failed to record Zalo group member dataset result:', datasetError)
        }
      }
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          success: true,
          count: 0,
          datasetId,
          stopped: true
        }, loadState.runKey)
      }

      this.sendProgress(`❌ Không thể tải ${typeName}: ${errMsg}`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        datasetId,
        error: errMsg
      }, loadState.runKey)
    } finally {
      if (claimedAccount) {
        await this.restoreAccountStatus(latestAccount!, runtimeClaim)
      }
      if (this.activeLoads.get(accountId) === loadState) {
        this.activeLoads.delete(accountId)
        this.cancelledLoads.delete(accountId)
      }
    }
  }

  private async loadContacts(accountId: number, contactType: ContactType, options: ContactLoadOptions = {}): Promise<ContactLoadResult> {
    const typeName = options.typeName || (contactType === 'person' ? 'bạn bè' : this.getContactTypeName(contactType))
    const resultMeta = options.resultMeta || {}
    let account: AutoAccount | null
    try {
      account = await this.supabase.getAccount(accountId)
    } catch (err: any) {
      return this.completeLoad(accountId, contactType, {
        ...resultMeta,
        success: false,
        count: 0,
        error: `Không thể kiểm tra trạng thái tài khoản: ${err.message || String(err)}`
      })
    }

    const preflightError = this.getPreflightError(account)
    if (preflightError) {
      return this.completeLoad(accountId, contactType, {
        ...resultMeta,
        success: false,
        count: 0,
        error: preflightError
      })
    }

    const workflowName = options.workflowName || CONTACT_SCAN_WORKFLOWS[contactType]
    if (!workflowName) {
      return this.completeLoad(accountId, contactType, {
        ...resultMeta,
        success: false,
        count: 0,
        error: `Chưa có workflow quét data cho loại ${contactType}`
      })
    }
    const workflow = await workflowV2Repo.getWorkflowByName(workflowName)
    if (!workflow) {
      return this.completeLoad(accountId, contactType, {
        ...resultMeta,
        success: false,
        count: 0,
        error: `Chưa có workflow quét data: ${workflowName}`
      })
    }

    const latestAccount = await this.supabase.getAccount(accountId)
    const latestPreflightError = this.getPreflightError(latestAccount)
    if (latestPreflightError) {
      return this.completeLoad(accountId, contactType, {
        ...resultMeta,
        success: false,
        count: 0,
        error: latestPreflightError
      })
    }

    const loadState = this.startLoad(accountId, contactType, workflow.defaultVariables, options)
    const runnableAccount = latestAccount!
    let runtimeClaim: AccountRuntimeScanClaim = {
      previousStatus: runnableAccount.status as AccountRuntimePreviousStatus,
      claimToken: null,
      staffId: null
    }
    const variables = loadState.variables
    let claimedAccount = false

    try {
      runtimeClaim = await this.claimAccountForScan(runnableAccount)
      claimedAccount = true

      this.sendProgress(`🔄 Đang load danh sách ${typeName}...`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })

      await this.proxyRuntime?.prepareAccountSession(runnableAccount)
      const page = this.backgroundPages.getOrCreate(accountId, runnableAccount.flatformType)
      this.selectAutomationBrowser(accountId)
      this.startBackgroundPreview(accountId, page, options.previewTitle || this.getPreviewTitle(contactType))

      const result = await this.engineV2.run(workflow.id, variables, page, {
        accountId,
        signal: loadState.controller.signal,
        persist: true,
        onStepProgress: (step: RunStepV2) => {
          const stepMessage = this.formatWorkflowStepProgressMessage(step)
          if (stepMessage) {
            this.sendProgress(stepMessage, {
              accountId,
              contactType,
              runKey: loadState.runKey
            })
          }
          try {
            this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_PROGRESS, {
              runKey: loadState.runKey,
              step
            })
          } catch {}
        },
        onLog: (entry) => {
          this.sendProgress(entry.line, {
            accountId,
            contactType,
            runKey: loadState.runKey
          })
          try {
            this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_LOG, {
              runKey: loadState.runKey,
              ...entry
            })
          } catch {}
        }
      })

      const stopped = this.isLoadCancelled(accountId, variables) || result.status === 'cancelled'
      if (result.status !== 'completed' && !stopped) {
        throw new Error(result.error || 'Workflow quét data chưa hoàn tất')
      }

      const contacts = this.extractContacts(result, contactType)
      if (contacts.length === 0) {
        const stoppedWithEmptyResult = stopped
          || this.isLoadCancelled(accountId, variables)
          || loadState.controller.signal.aborted
        let datasetId: number | undefined
        if (options.dataset) {
          try {
            datasetId = await this.finalizeScanDataset({
              accountId,
              contactType,
              context: options.dataset,
              contactUids: [],
              stopped: stoppedWithEmptyResult,
              runKey: loadState.runKey
            })
          } catch (datasetError) {
            if (!stoppedWithEmptyResult) throw datasetError
            console.warn('[ContactLoader] Failed to finalize stopped empty contact dataset:', datasetError)
          }
        }

        if (stoppedWithEmptyResult) {
          if (options.markMissingDeleted !== false) {
            await this.supabase.deleteContacts(accountId, contactType)
          }
          this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu 0 data cho lần quét này.`, {
            accountId,
            contactType,
            runKey: loadState.runKey
          })
          return this.completeLoad(accountId, contactType, {
            ...resultMeta,
            success: true,
            count: 0,
            datasetId,
            stopped: true
          }, loadState.runKey)
        }

        if (datasetId) {
          this.sendProgress(`✅ Đã cập nhật danh sách data: không có ${typeName} nào trong lần quét này.`, {
            accountId,
            contactType,
            runKey: loadState.runKey
          })
          return this.completeLoad(accountId, contactType, {
            ...resultMeta,
            success: true,
            count: 0,
            datasetId
          }, loadState.runKey)
        }

        this.sendProgress(`⚠️ Không tìm thấy ${typeName} nào. Kiểm tra tài khoản đã đăng nhập chưa.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          ...resultMeta,
          success: false,
          count: 0,
          error: `Không tìm thấy ${typeName} nào`
        }, loadState.runKey)
      }

      const contactsWithMeta = contacts.map(contact => ({
        ...contact,
        accountId,
        contactType
      }))
      const contactsToSave = contactType === 'person'
        ? await this.mergeExistingPersonContactState(accountId, contactsWithMeta)
        : contactsWithMeta

      this.sendProgress(`💾 Đang lưu ${contactsToSave.length} ${typeName}...`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      const saved = await this.supabase.upsertContacts(contactsToSave, {
        markMissingDeleted: options.markMissingDeleted
      })
      const stoppedAfterSave = stopped
        || this.isLoadCancelled(accountId, variables)
        || loadState.controller.signal.aborted
      const datasetId = options.dataset
        ? await this.finalizeScanDataset({
          accountId,
          contactType,
          context: options.dataset,
          contactUids: contactsToSave.map(contact => contact.uid),
          stopped: stoppedAfterSave,
          runKey: loadState.runKey
        })
        : undefined

      if (stoppedAfterSave) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${saved} data cho lần quét này.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          ...resultMeta,
          success: true,
          count: saved,
          datasetId,
          stopped: true
        }, loadState.runKey)
      }

      this.sendProgress(`✅ Đã load ${saved} ${typeName} thành công!`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, {
        ...resultMeta,
        success: true,
        count: saved,
        datasetId
      }, loadState.runKey)
    } catch (err: any) {
      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      const errMsg = err?.message || String(err)
      let datasetId: number | undefined
      if (options.dataset) {
        try {
          datasetId = await this.finalizeScanDataset({
            accountId,
            contactType,
            context: options.dataset,
            contactUids: [],
            stopped,
            runKey: loadState.runKey,
            status: stopped ? 'partial' : 'failed'
          })
        } catch (datasetError) {
          console.warn('[ContactLoader] Failed to record contact dataset scan result:', datasetError)
        }
      }
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          ...resultMeta,
          success: true,
          count: 0,
          datasetId,
          stopped: true
        }, loadState.runKey)
      }

      this.sendProgress(`❌ Lỗi load ${typeName}: ${errMsg}`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, {
        ...resultMeta,
        success: false,
        count: 0,
        datasetId,
        error: errMsg
      }, loadState.runKey)
    } finally {
      if (claimedAccount) {
        await this.restoreAccountStatus(runnableAccount, runtimeClaim)
      }
      if (this.activeLoads.get(accountId) === loadState) {
        this.activeLoads.delete(accountId)
        this.cancelledLoads.delete(accountId)
        this.stopBackgroundPreview(accountId)
        this.backgroundPages.destroy(accountId)
      }
    }
  }

  private getPreflightError(account: AutoAccount | null): string | null {
    if (!account) return 'Không tìm thấy tài khoản'
    if (!account.isActive) return 'Tài khoản đang bị tắt, không thể quét data'
    if (account.loginStatus !== 'đã đăng nhập') return 'Tài khoản chưa đăng nhập Facebook'
    if (account.status === 'đang chạy') {
      return 'Tài khoản đang chạy chiến dịch hoặc quét data, vui lòng đợi hoàn tất hoặc tạm dừng tác vụ hiện tại.'
    }
    if (account.status !== 'chờ xử lý' && account.status !== 'tạm dừng') {
      return `tài khoản ${account.status || 'không xác định'} không thể quét data`
    }
    if (account.flatformType !== 'facebook') return 'Hành động này chỉ hỗ trợ tài khoản Facebook'
    return null
  }

  private getZaloPreflightError(account: AutoAccount | null): string | null {
    if (!account) return 'Không tìm thấy tài khoản'
    if (!account.isActive) return 'Tài khoản đang bị tắt, không thể quét data'
    if (account.flatformType !== 'zalo') return 'Hành động này chỉ hỗ trợ tài khoản Zalo'
    if ((account.isZaloServer === true) !== (this.zaloRuntimeTarget === 'server')) {
      return 'Tài khoản không thuộc runtime Zalo hiện tại'
    }
    if (account.loginStatus !== 'đã đăng nhập') return 'Tài khoản chưa đăng nhập Zalo'
    if (account.status === 'đang chạy') {
      return 'Tài khoản đang chạy chiến dịch hoặc quét data, vui lòng đợi hoàn tất hoặc tạm dừng tác vụ hiện tại.'
    }
    if (account.status !== 'chờ xử lý' && account.status !== 'tạm dừng') {
      return `tài khoản ${account.status || 'không xác định'} không thể quét data`
    }
    return null
  }

  private mapZaloUserContact(accountId: number, raw: Record<string, unknown>): ZaloUserContactInput | null {
    const zaloUid = this.firstString(raw.userId, raw.uid)
    if (!zaloUid) return null

    return {
      accountId,
      zaloUid,
      userId: this.stringValue(raw.userId),
      username: this.stringValue(raw.username),
      displayName: this.stringValue(raw.displayName),
      zaloName: this.stringValue(raw.zaloName),
      avatar: this.stringValue(raw.avatar),
      bgavatar: this.stringValue(raw.bgavatar),
      cover: this.stringValue(raw.cover),
      gender: this.numberValue(raw.gender),
      dob: this.numberValue(raw.dob),
      sdob: this.stringValue(raw.sdob),
      status: this.stringValue(raw.status),
      phoneNumber: this.stringValue(raw.phoneNumber),
      isFr: this.numberValue(raw.isFr),
      isBlocked: this.numberValue(raw.isBlocked),
      lastActionTime: this.numberValue(raw.lastActionTime),
      lastUpdateTime: this.numberValue(raw.lastUpdateTime),
      isActive: this.numberValue(raw.isActive),
      key: this.numberValue(raw.key),
      type: this.numberValue(raw.type),
      isActivePC: this.numberValue(raw.isActivePC),
      isActiveWeb: this.numberValue(raw.isActiveWeb),
      isValid: this.numberValue(raw.isValid),
      userKey: this.stringValue(raw.userKey),
      accountStatus: this.numberValue(raw.accountStatus),
      oaInfo: raw.oaInfo,
      userMode: this.numberValue(raw.user_mode),
      globalId: this.stringValue(raw.globalId),
      bizPkg: raw.bizPkg,
      createdTs: this.numberValue(raw.createdTs),
      oaStatus: raw.oa_status,
      rawPayload: raw
    }
  }

  private mapZaloGroupContact(
    accountId: number,
    raw: Record<string, unknown>,
    fallbackVersion?: string
  ): ZaloGroupContactInput | null {
    const zaloGroupId = this.firstString(raw.groupId)
    if (!zaloGroupId) return null
    const rawPayload = { ...raw }
    if (fallbackVersion && !rawPayload.gridVersion) rawPayload.gridVersion = fallbackVersion
    const isJoined = typeof raw.isJoined === 'boolean' ? raw.isJoined : undefined

    return {
      accountId,
      zaloGroupId,
      ...(isJoined !== undefined ? { isJoined } : {}),
      name: this.stringValue(raw.name),
      description: this.stringValue(raw.desc),
      link: this.stringValue(raw.link),
      groupType: this.numberValue(raw.type),
      creatorUid: this.stringValue(raw.creatorId),
      version: this.stringValue(raw.version) || this.stringValue(fallbackVersion),
      avatar: this.stringValue(raw.avt),
      fullAvatar: this.stringValue(raw.fullAvt),
      memberIds: this.toStringArray(raw.memberIds),
      adminIds: this.toStringArray(raw.adminIds),
      currentMems: raw.currentMems,
      updateMems: raw.updateMems,
      admins: raw.admins,
      hasMoreMember: this.numberValue(raw.hasMoreMember),
      subType: this.numberValue(raw.subType),
      totalMember: this.numberValue(raw.totalMember),
      maxMember: this.numberValue(raw.maxMember),
      setting: raw.setting,
      createdTime: this.numberValue(raw.createdTime),
      visibility: this.numberValue(raw.visibility),
      globalId: this.stringValue(raw.globalId),
      e2ee: this.numberValue(raw.e2ee),
      status: this.numberValue(raw.status),
      extraInfo: raw.extraInfo,
      memVerList: this.toStringArray(raw.memVerList),
      pendingApprove: raw.pendingApprove,
      rawPayload
    }
  }

  private firstString(...values: unknown[]): string | null {
    for (const value of values) {
      const trimmed = this.stringValue(value)
      if (trimmed) return trimmed
    }
    return null
  }

  private stringValue(value: unknown): string | null {
    const trimmed = String(value || '').trim()
    return trimmed || null
  }

  private normalizeZaloGroupLink(value: unknown): string | null {
    const raw = this.stringValue(value)
    if (!raw) return null
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      const url = new URL(withProtocol)
      const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
      const parts = url.pathname.split('/').filter(Boolean)
      let groupCode = ''
      if (hostname === 'zalo.me' || hostname.endsWith('.zalo.me')) {
        if (parts[0]?.toLowerCase() !== 'g') return null
        groupCode = parts[1] || ''
      } else if (hostname === 'zaloapp.com' || hostname.endsWith('.zaloapp.com')) {
        if (parts[0]?.toLowerCase() !== 'qr' || parts[1]?.toLowerCase() !== 'g') return null
        groupCode = parts[2] || ''
      } else {
        return null
      }
      return groupCode ? `https://zalo.me/g/${groupCode}` : null
    } catch {
      return null
    }
  }

  private numberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Đã dừng quét.'))
        return
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(new Error('Đã dừng quét.'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async extractFacebookUserAccessToken(page: PageController, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const token = await page.evaluate<string>(`
      var html = [
        document.documentElement ? document.documentElement.innerHTML : '',
        document.body ? document.body.innerHTML : ''
      ].join('\\n');
      var match = html.match(/EAAG[^"'\\\\<\\s]+/);
      return match ? match[0] : '';
    `).catch(() => '')

    signal?.throwIfAborted()
    if (token) return token

    await page.navigate('https://business.facebook.com/latest/content_management').catch(() => undefined)
    await this.sleep(5000, signal)
    return await page.evaluate<string>(`
      var html = [
        document.documentElement ? document.documentElement.innerHTML : '',
        document.body ? document.body.innerHTML : ''
      ].join('\\n');
      var match = html.match(/EAAG[^"'\\\\<\\s]+/);
      return match ? match[0] : '';
    `).catch(() => '')
  }

  private async getFacebookCookieHeader(page: PageController): Promise<string> {
    return (
      await page.getCookieHeader('https://business.facebook.com').catch(() => '') ||
      await page.getCookieHeader('https://www.facebook.com').catch(() => '')
    )
  }

  private buildGraphHeaders(cookieHeader: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
    if (cookieHeader) headers.Cookie = cookieHeader
    return headers
  }

  private formatGraphError(error: GraphApiError): string {
    const code = error.code ? `#${error.code}` : ''
    const subcode = error.error_subcode ? `/${error.error_subcode}` : ''
    const message = error.message || 'Graph API trả về lỗi'
    return [code + subcode, message].filter(Boolean).join(' ')
  }

  private async fetchGraphJson<T>(url: string, cookieHeader: string, signal?: AbortSignal): Promise<GraphApiResponse<T>> {
    const response = await fetch(url, {
      method: 'GET',
      signal,
      headers: this.buildGraphHeaders(cookieHeader)
    })
    const data = await response.json().catch(() => null) as GraphApiResponse<T> | null
    if (!response.ok || data?.error) {
      throw new Error(data?.error ? this.formatGraphError(data.error) : `Graph API lỗi HTTP ${response.status}`)
    }
    return data || {}
  }

  private async getPageAccessToken(pageUid: string, userAccessToken: string, cookieHeader: string, signal?: AbortSignal): Promise<string> {
    const url = `${FACEBOOK_GRAPH_API_BASE}/${encodeURIComponent(pageUid)}?fields=access_token&access_token=${encodeURIComponent(userAccessToken)}`
    const response = await this.fetchGraphJson<never>(url, cookieHeader, signal)
    return String(response.access_token || '').trim()
  }

  private buildPageInboxConversationsUrl(pageUid: string, pageAccessToken: string): string {
    const fields = 'updated_time,participants,messages.limit(25){id,message,created_time,from}'
    return `${FACEBOOK_GRAPH_API_BASE}/${encodeURIComponent(pageUid)}/conversations?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(pageAccessToken)}`
  }

  private getPageInboxConversationTimestamp(conversation: PageInboxConversation): number | null {
    const updated = parsePageInboxTimestamp(conversation.updated_time)
    if (updated !== null) return updated
    const timestamps = (Array.isArray(conversation.messages?.data) ? conversation.messages.data : [])
      .map(message => parsePageInboxTimestamp(message.created_time))
      .filter((timestamp): timestamp is number => timestamp !== null)
    return timestamps.length > 0 ? Math.max(...timestamps) : null
  }

  private mapPageInboxConversation(
    accountId: number,
    pageUid: string,
    pageName: string,
    conversation: PageInboxConversation
  ): localContactRepo.PageInboxContactInput | null {
    const conversationId = String(conversation.id || '').trim()
    const participants = Array.isArray(conversation.participants?.data) ? conversation.participants!.data! : []
    const customer = participants.find(participant => {
      const psid = String(participant.id || '').trim()
      return /^[1-9]\d*$/.test(psid) && psid !== pageUid
    })
    const customerPsid = String(customer?.id || '').trim()
    if (!customerPsid) return null

    const customerName = String(customer?.name || customerPsid).replace(/\s+/g, ' ').trim()
    const messages = Array.isArray(conversation.messages?.data) ? conversation.messages!.data! : []
    const normalizedMessages = messages
      .map(message => ({
        id: String(message.id || '').trim(),
        text: String(message.message || '').replace(/\s+/g, ' ').trim(),
        createdTime: this.normalizeGraphDate(message.created_time),
        fromId: String(message.from?.id || '').trim(),
        fromName: String(message.from?.name || '').replace(/\s+/g, ' ').trim()
      }))
      .filter(message => message.text || message.createdTime || message.fromId)
      .sort((a, b) => ((parsePageInboxTimestamp(b.createdTime) ?? -Infinity) - (parsePageInboxTimestamp(a.createdTime) ?? -Infinity)) || 0)

    const customerMessages = normalizedMessages.filter(message => message.fromId === customerPsid)
    const phone = this.extractPhoneFromMessages(customerMessages.length > 0 ? customerMessages : normalizedMessages)
    const lastMessage = normalizedMessages[0]
    const lastCustomerMessage = customerMessages[0]
    const messageHistory = normalizedMessages
      .map(message => {
        const sender = message.fromId === pageUid ? (pageName || 'Page') : (message.fromName || customerName)
        const time = message.createdTime ? `${message.createdTime} ` : ''
        return `${time}${sender}: ${message.text}`.trim()
      })
      .filter(Boolean)
      .join('\n')

    return {
      accountId,
      name: customerName,
      uid: customerPsid,
      extraData: {
        source: 'facebook_page_inbox',
        pageUid,
        pageName,
        conversationId,
        phone,
        lastMessageAt: lastMessage?.createdTime || null,
        lastMessageText: lastMessage?.text || '',
        lastCustomerMessageAt: lastCustomerMessage?.createdTime || null,
        lastCustomerMessageText: lastCustomerMessage?.text || '',
        messageHistory,
        messages: normalizedMessages
      }
    }
  }

  private normalizeGraphDate(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    return raw
  }

  private extractPhoneFromMessages(messages: Array<{ text?: string }>): string {
    for (const message of messages) {
      const text = String(message.text || '')
      const matches = text.match(PHONE_RE) || []
      for (const match of matches) {
        const phone = match.replace(/\D/g, '')
        if (phone.length >= 9 && phone.length <= 12) return phone
      }
    }
    return ''
  }

  private startLoad(
    accountId: number,
    contactType: ContactType,
    workflowDefaultVariables: Record<string, unknown> = {},
    options: ContactLoadOptions = {}
  ): ActiveContactLoad {
    const runtimePlatform = options.runtimePlatform || 'other'
    if (runtimePlatform === 'zalo' && this.zaloRuntimeBlockedForRestart) {
      throw new Error('Chế độ chạy Zalo đã thay đổi. Vui lòng tắt và mở lại ứng dụng.')
    }
    const existing = this.activeLoads.get(accountId)
    if (existing) {
      throw new Error('Tài khoản đang quét data. Vui lòng đợi tác vụ hiện tại hoàn tất rồi thử lại.')
    }

    this.cancelledLoads.delete(accountId)
    const controller = new AbortController()
    const runKey = `contacts-${accountId}-${options.runKeyLabel || contactType}-${Date.now()}`
    const defaultTargetUrl = typeof workflowDefaultVariables.targetUrl === 'string' && workflowDefaultVariables.targetUrl
      ? workflowDefaultVariables.targetUrl
      : CONTACT_SCAN_TARGET_URLS[contactType] || 'https://www.facebook.com'
    const variables: Record<string, unknown> = {
      ...workflowDefaultVariables,
      accountId,
      contactType,
      targetUrl: options.targetUrl || defaultTargetUrl,
      contactScanCancelled: false,
      ...(options.variables || {})
    }
    const loadState = { controller, variables, runKey, contactType, runtimePlatform }
    this.activeLoads.set(accountId, loadState)
    return loadState
  }

  private isLoadCancelled(accountId: number, variables?: Record<string, unknown>): boolean {
    return this.cancelledLoads.has(accountId) || variables?.contactScanCancelled === true
  }

  private async finalizeScanDataset(input: {
    accountId: number
    contactType: ContactType
    context: ContactDatasetScanContext
    contactUids: unknown[]
    stopped: boolean
    runKey: string
    status?: ContactDatasetFinalizeInput['status']
  }): Promise<number | undefined> {
    const sourceKey = String(input.context.sourceKey || '').trim()
    if (!sourceKey) throw new Error('Không xác định được nguồn của danh sách data vừa quét.')

    const targetNameOrUid = String(input.context.targetNameOrUid || '').replace(/\s+/g, ' ').trim()
    const link = String(input.context.link || '').trim()
    const nameParts = [
      input.context.actionLabel,
      input.context.platformLabel,
      targetNameOrUid
    ].filter(Boolean)
    if (link) nameParts.push(link)

    const descriptionParts = [`${input.context.actionLabel} trên ${input.context.platformLabel}`]
    if (targetNameOrUid) descriptionParts.push(targetNameOrUid)
    if (link) descriptionParts.push(link)

    const dataTypeCode = getContactDatasetScanTypeCode(input.context.scanType)
    if (!dataTypeCode) throw new Error('Không xác định được loại data của danh sách vừa quét.')
    if (!this.dataTypeCategoryIdByCode) {
      const items = await this.supabase.listDataTypeCategoryItems()
      this.dataTypeCategoryIdByCode = new Map(items.map(item => [item.code, item.id]))
    }
    const dataTypeCategoryItemId = this.dataTypeCategoryIdByCode.get(dataTypeCode)
    if (!dataTypeCategoryItemId) throw new Error(`Loại data “${dataTypeCode}” chưa được cấu hình.`)

    const finalizeInput: ContactDatasetFinalizeInput = {
      accountId: input.accountId,
      scanType: input.context.scanType,
      contactType: input.contactType,
      sourceKey,
      name: nameParts.join(' - '),
      link: link || null,
      description: descriptionParts.join(' - '),
      status: input.status || (input.stopped ? 'partial' : 'completed'),
      dataTypeCategoryItemId,
      contactUids: Array.from(new Set(
        input.contactUids
          .map(uid => String(uid || '').trim())
          .filter(Boolean)
      )),
      extraData: {
        ...(input.context.extraData || {}),
        runKey: input.runKey,
        stopped: input.stopped
      }
    }

    const dataset = await this.supabase.finalizeContactDataset(finalizeInput)
    return dataset?.id
  }

  private sendProgress(message: string, meta: Omit<ContactLoadProgress, 'message'> = {}): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CONTACTS_PROGRESS, { ...meta, message })
    } catch {}
  }

  private formatWorkflowStepProgressMessage(step: RunStepV2): string {
    const label = this.getWorkflowStepLabel(step.blockName || step.nodeId)
    if (!label) return ''
    if (step.status === 'running') return `Đang ${label}...`
    if (step.status === 'success') return `Đã ${label}.`
    if (step.status === 'error') {
      const error = String(step.error || '').trim()
      return error ? `Lỗi khi ${label}: ${error}` : `Lỗi khi ${label}.`
    }
    return ''
  }

  private getWorkflowStepLabel(blockName: string | undefined): string {
    switch (blockName) {
      case 'fb_scan_open_post':
        return 'mở bài post'
      case 'fb_scan_collect_post_commenters':
        return 'đọc người comment bài post'
      case 'fb_scan_collect_post_likes':
        return 'đọc người like bài post'
      case 'fb_scan_open_profile_friends':
        return 'mở danh sách bạn bè profile'
      case 'fb_scan_collect_profile_friends':
        return 'đọc bạn bè profile'
      case 'fb_open_group_members':
        return 'mở trang thành viên group'
      case 'fb_collect_group_members':
      case 'fb_scan_collect_group_members':
        return 'cuộn và đọc thành viên group'
      case 'fb_scan_extract_group_members':
        return 'chuẩn hoá thành viên group'
      case 'fb_scan_contacts_summary':
        return 'tổng kết data'
      case 'fb_open_contacts':
        return 'mở danh sách data'
      case 'fb_scan_contacts':
        return 'đọc danh sách data'
      default:
        return ''
    }
  }

  private completeLoad(
    accountId: number,
    contactType: ContactType,
    result: ContactLoadResult,
    runKey?: string
  ): ContactLoadResult {
    const payload = runKey ? { ...result, runKey } : result
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CONTACTS_COMPLETED, {
        accountId,
        contactType,
        runKey,
        result: payload
      })
    } catch {}
    return payload
  }

  private extractContacts(result: RunResult, contactType: ContactType): Partial<AutoAccountContact>[] {
    const direct = Array.isArray(result.output.contacts) ? result.output.contacts : null
    const fromSummary = result.steps
      .slice()
      .reverse()
      .find(step => step.blockName === 'fb_scan_contacts_summary' && Array.isArray(step.output?.contacts))
      ?.output.contacts
    const rawContacts = (direct || fromSummary || []) as unknown[]

    return rawContacts
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      .map(item => {
        const name = String(item.name || '').replace(/\s+/g, ' ').trim()
        const uid = String(item.uid || '').trim()
        const url = String(item.url || '').trim()
        const extraData = item.extraData && typeof item.extraData === 'object' && !Array.isArray(item.extraData)
          ? item.extraData as Record<string, unknown>
          : {}
        const contact: Partial<AutoAccountContact> = {
          name,
          uid,
          url,
          extraData
        }
        if (contactType === 'person') {
          contact.isFriend = Object.prototype.hasOwnProperty.call(item, 'isFriend')
            ? (item.isFriend === null ? null : item.isFriend !== false)
            : true
        }
        if (contactType === 'group') contact.isJoined = item.isJoined !== false
        return contact
      })
      .filter(contact => !!contact.name && (!!contact.uid || !!contact.url))
  }

  private async mergeExistingPersonContactState(
    accountId: number,
    contacts: Partial<AutoAccountContact>[]
  ): Promise<Partial<AutoAccountContact>[]> {
    if (contacts.length === 0) return contacts

    const existingContacts = await this.supabase.listContacts(accountId, 'person')
    const existingByUid = new Map<string, AutoAccountContact>()
    for (const contact of existingContacts) {
      const key = this.normalizeContactUid(contact.uid || contact.url || '')
      if (key) existingByUid.set(key, contact)
    }

    return contacts.map(contact => {
      const key = this.normalizeContactUid(contact.uid || contact.url || '')
      const existing = key ? existingByUid.get(key) : undefined
      const extraData = this.mergePersonExtraData(existing?.extraData, contact.extraData)
      const hasIncomingFriendStatus = Object.prototype.hasOwnProperty.call(contact, 'isFriend')
      const incomingFriendStatus = hasIncomingFriendStatus ? contact.isFriend ?? null : undefined
      const nextFriendStatus = incomingFriendStatus === null && typeof existing?.isFriend === 'boolean'
        ? existing.isFriend
        : existing?.isFriend === true
          ? true
          : incomingFriendStatus
      return {
        ...contact,
        isFriend: nextFriendStatus,
        extraData
      }
    })
  }

  private mergePersonExtraData(
    existingExtraData: Record<string, unknown> | undefined,
    nextExtraData: Record<string, unknown> | undefined
  ): Record<string, unknown> {
    const existing = existingExtraData || {}
    const next = nextExtraData || {}
    const merged: Record<string, unknown> = { ...existing, ...next }
    const sources = [
      ...this.toStringArray(existing.sources),
      existing.source,
      ...this.toStringArray(next.sources),
      next.source
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean)

    if (sources.length > 0) {
      merged.sources = Array.from(new Set(sources))
    }

    const sourcePostRefs = this.mergeSourcePostRefs(existing, next)
    if (sourcePostRefs.length > 0) {
      merged.sourcePostRefs = sourcePostRefs
    }

    const sourcePostUrls = [
      ...this.toStringArray(existing.sourcePostUrls),
      existing.sourcePostUrl,
      ...this.toStringArray(next.sourcePostUrls),
      next.sourcePostUrl
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean)

    if (sourcePostUrls.length > 0) {
      merged.sourcePostUrls = Array.from(new Set(sourcePostUrls))
    }

    const sourceProfileUrls = [
      ...this.toStringArray(existing.sourceProfileUrls),
      existing.sourceProfileUrl,
      ...this.toStringArray(next.sourceProfileUrls),
      next.sourceProfileUrl
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean)

    if (sourceProfileUrls.length > 0) {
      merged.sourceProfileUrls = Array.from(new Set(sourceProfileUrls))
    }

    const sourceGroupUrls = [
      ...this.toStringArray(existing.sourceGroupUrls),
      existing.sourceGroupUrl,
      ...this.toStringArray(next.sourceGroupUrls),
      next.sourceGroupUrl
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean)

    if (sourceGroupUrls.length > 0) {
      merged.sourceGroupUrls = Array.from(new Set(sourceGroupUrls))
    }

    return merged
  }

  private mergeSourcePostRefs(
    existing: Record<string, unknown>,
    next: Record<string, unknown>
  ): Array<{ source: string; url: string }> {
    const byKey = new Map<string, { source: string; url: string }>()
    for (const ref of [
      ...this.toSourcePostRefs(existing.sourcePostRefs),
      ...this.collectIncomingSourcePostRefs(existing),
      ...this.toSourcePostRefs(next.sourcePostRefs),
      ...this.collectIncomingSourcePostRefs(next)
    ]) {
      byKey.set(`${ref.source}\u0000${ref.url}`, ref)
    }
    return Array.from(byKey.values())
  }

  private toSourcePostRefs(value: unknown): Array<{ source: string; url: string }> {
    if (!Array.isArray(value)) return []
    return value
      .map(item => {
        const ref = item && typeof item === 'object' && !Array.isArray(item)
          ? item as Record<string, unknown>
          : {}
        return {
          source: String(ref.source || '').trim(),
          url: String(ref.url || ref.sourcePostUrl || '').trim()
        }
      })
      .filter(ref => !!ref.source && !!ref.url)
  }

  private collectIncomingSourcePostRefs(extra: Record<string, unknown>): Array<{ source: string; url: string }> {
    const source = String(extra.source || '').trim()
    if (!source) return []
    const urls = [
      extra.sourcePostUrl,
      ...this.toStringArray(extra.sourcePostUrls)
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean)

    return Array.from(new Set(urls)).map(url => ({ source, url }))
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []
  }

  private normalizeContactUid(value: unknown): string {
    return String(value || '').trim().replace(/\/+$/g, '').toLowerCase()
  }

  private normalizeCommenterLimit(value: unknown): number {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 100
  }

  private normalizePostLikeLimit(value: unknown): number {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000
  }

  private normalizeProfileFriendLimit(value: unknown): number {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000
  }

  private normalizeGroupMemberLimit(value: unknown): number {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000
  }

  private normalizeFacebookGroupScanTarget(value: unknown): { targetUrl: string; sourceGroupUrl: string; sourceGroupUid: string } | null {
    const raw = String(value || '').trim()
    if (!raw) return null

    if (!/facebook\.com|fb\.com/i.test(raw)) {
      const cleaned = raw.replace(/^\/+|\/+$/g, '')
      const parts = cleaned.split('/').filter(Boolean)
      const groupKey = parts[0]?.toLowerCase() === 'groups' && parts[1] ? parts[1] : cleaned
      if (!groupKey || !/^[a-zA-Z0-9._-]+$/.test(groupKey)) return null
      const sourceGroupUrl = `https://www.facebook.com/groups/${groupKey}`
      return {
        targetUrl: `${sourceGroupUrl}/members`,
        sourceGroupUrl,
        sourceGroupUid: groupKey
      }
    }

    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      const host = url.hostname
        .replace(/^www\./i, '')
        .replace(/^web\./i, '')
        .replace(/^m\./i, '')
        .replace(/^mobile\./i, '')
        .replace(/^mbasic\./i, '')
        .toLowerCase()
      if (host !== 'facebook.com' && host !== 'fb.com') return null

      const parts = url.pathname.split('/').filter(Boolean)
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups')
      if (groupIndex < 0 || !parts[groupIndex + 1]) return null
      const groupKey = decodeURIComponent(parts[groupIndex + 1] || '').trim()
      if (!groupKey || !/^[a-zA-Z0-9._-]+$/.test(groupKey)) return null

      const sourceGroupUrl = `https://www.facebook.com/groups/${groupKey}`
      return {
        targetUrl: `${sourceGroupUrl}/members`,
        sourceGroupUrl,
        sourceGroupUid: groupKey
      }
    } catch {
      return null
    }
  }

  private normalizeFacebookProfileScanTarget(value: unknown): { targetUrl: string; sourceProfileUrl: string; sourceProfileUid: string } | null {
    const raw = String(value || '').trim().replace(/^@+/, '')
    if (!raw) return null

    if (!/facebook\.com|fb\.com/i.test(raw)) {
      if (!/^[a-zA-Z0-9._-]+$/.test(raw)) return null
      const sourceProfileUrl = `https://www.facebook.com/${raw}`
      return {
        targetUrl: `${sourceProfileUrl}/friends`,
        sourceProfileUrl,
        sourceProfileUid: raw
      }
    }

    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      const host = url.hostname
        .replace(/^www\./i, '')
        .replace(/^web\./i, '')
        .replace(/^m\./i, '')
        .replace(/^mobile\./i, '')
        .replace(/^mbasic\./i, '')
        .toLowerCase()
      if (host !== 'facebook.com' && host !== 'fb.com') return null

      if (url.pathname === '/profile.php') {
        const id = String(url.searchParams.get('id') || '').trim()
        if (!id) return null
        const sourceProfileUrl = `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}`
        return {
          targetUrl: `${sourceProfileUrl}&sk=friends`,
          sourceProfileUrl,
          sourceProfileUid: id
        }
      }

      const parts = url.pathname.split('/').filter(Boolean)
      while (parts.length > 0 && parts[parts.length - 1].toLowerCase() === 'friends') {
        parts.pop()
      }
      if (parts.length !== 1) return null
      const slug = decodeURIComponent(parts[0] || '').trim()
      if (!slug || !/^[a-zA-Z0-9._-]+$/.test(slug)) return null

      const sourceProfileUrl = `https://www.facebook.com/${slug}`
      return {
        targetUrl: `${sourceProfileUrl}/friends`,
        sourceProfileUrl,
        sourceProfileUid: slug
      }
    } catch {
      return null
    }
  }

  private normalizeFacebookPostUrl(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) return ''
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      const host = url.hostname.replace(/^www\./i, '').replace(/^web\./i, '').replace(/^m\./i, '').toLowerCase()
      if (host !== 'facebook.com' && host !== 'fb.com') return ''
      url.hostname = 'www.facebook.com'
      url.hash = ''
      for (const key of Array.from(url.searchParams.keys())) {
        if (
          key.startsWith('__') ||
          key === 'mibextid' ||
          key === 'ref' ||
          key === 'locale' ||
          key === 'comment_id' ||
          key === 'reply_comment_id'
        ) {
          url.searchParams.delete(key)
        }
      }
      return url.toString()
    } catch {
      return ''
    }
  }

  private getContactTypeName(contactType: ContactType): string {
    switch (contactType) {
      case 'person': return 'người trên Facebook'
      case 'group': return 'group'
      case 'page': return 'page'
      case 'page_inbox_customer': return 'người từng nhắn tin với page'
      case 'zalo_tag': return 'tag Zalo'
      case 'phone': return 'số điện thoại'
      case 'email': return 'email'
      case 'campaign_input': return 'dữ liệu chiến dịch'
    }
  }

  private getPreviewTitle(contactType: ContactType): string {
    if (contactType === 'person') return 'Đang quét bạn bè nền'
    if (contactType === 'group') return 'Đang quét group nền'
    if (contactType === 'page_inbox_customer') return 'Đang quét người nhắn tin với page'
    if (contactType === 'zalo_tag') return 'Đang tải tag Zalo'
    return 'Đang quét page nền'
  }

  private broadcastAccountStatusUpdated(): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
    } catch {}
  }

  private async claimAccountForScan(account: AutoAccount): Promise<AccountRuntimeScanClaim> {
    if (String(account.flatformType || '').trim().toLowerCase() === 'zalo') {
      return this.claimZaloAccountForScan(account.id)
    }

    const previousStatus = account.status
    if (previousStatus !== 'chờ xử lý' && previousStatus !== 'tạm dừng') {
      throw new Error('Tài khoản đang chạy chiến dịch hoặc tác vụ khác.')
    }
    const claim = await this.supabase.claimNonZaloAccountRuntimeOperation(
      account.id,
      account.flatformType,
      previousStatus
    )
    if (!claim.claimed || !claim.previousStatus || !claim.claimToken) {
      throw new Error('Tài khoản đang chạy chiến dịch hoặc tác vụ khác.')
    }
    this.broadcastAccountStatusUpdated()
    return {
      previousStatus: claim.previousStatus,
      claimToken: claim.claimToken,
      staffId: claim.staffId
    }
  }

  private async claimZaloAccountForScan(
    accountId: number
  ): Promise<AccountRuntimeScanClaim> {
    if (this.zaloRuntimeClaimsAbandoned) {
      throw new Error('Runtime Zalo của phiên cũ đang đóng. Vui lòng mở lại ứng dụng.')
    }
    const claim = await this.supabase.claimZaloAccountRuntimeOperation(accountId, this.zaloRuntimeTarget)
    if (!claim.claimed || !claim.previousStatus) {
      const reason = claim.reason === 'runtime_not_owner'
        ? 'Chế độ chạy Zalo vừa thay đổi. Vui lòng chờ runtime mới sẵn sàng rồi thử lại.'
        : 'Tài khoản đang chạy chiến dịch hoặc tác vụ khác.'
      throw new Error(reason)
    }
    this.broadcastAccountStatusUpdated()
    return {
      previousStatus: claim.previousStatus,
      claimToken: null,
      staffId: claim.staffId
    }
  }

  private async restoreAccountStatus(
    account: AutoAccount,
    claim: AccountRuntimeScanClaim
  ): Promise<void> {
    const isZalo = String(account.flatformType || '').trim().toLowerCase() === 'zalo'
    if (isZalo && this.zaloRuntimeClaimsAbandoned) return
    if (!isZalo && !claim.claimToken) {
      console.error('Failed to restore account after contact scan: missing non-Zalo claim token')
      return
    }
    if (!claim.staffId) {
      console.error('Failed to restore account after contact scan: missing runtime staff identity')
      return
    }

    const retryDelays = isZalo ? [] : ACCOUNT_RELEASE_RETRY_DELAYS_MS
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        const released = isZalo
          ? await this.supabase.releaseZaloAccountRuntimeOperation(
            account.id,
            this.zaloRuntimeTarget,
            claim.previousStatus,
            claim.staffId
          )
          : await this.supabase.releaseNonZaloAccountRuntimeOperation(
            account.id,
            account.flatformType,
            claim.previousStatus,
            claim.claimToken!,
            claim.staffId
          )
        if (released) this.broadcastAccountStatusUpdated()
        return
      } catch (err) {
        if (attempt >= retryDelays.length) {
          console.error('Failed to restore account after contact scan:', err)
          return
        }
        await this.sleep(retryDelays[attempt])
      }
    }
  }

  private selectAutomationBrowser(accountId: number): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_SELECT, {
        accountId,
        campaignId: 0,
        context: 'contact-scan'
      })
    } catch {}
  }

  private startBackgroundPreview(accountId: number, page: PageController, title: string): void {
    if (this.backgroundPreviewTimers.has(accountId)) return

    const capture = async (): Promise<void> => {
      if (this.backgroundPreviewCapturing.has(accountId)) return
      this.backgroundPreviewCapturing.add(accountId)
      try {
        if (!page.isConnected()) return
        const image = await page.screenshot()
        this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_PREVIEW, {
          accountId,
          campaignId: 0,
          context: 'contact-scan',
          active: true,
          title,
          image: `data:image/png;base64,${image}`,
          timestamp: new Date().toISOString()
        })
      } catch {
        // Preview is best-effort; workflow output remains the source of truth.
      } finally {
        this.backgroundPreviewCapturing.delete(accountId)
      }
    }

    void capture()
    this.backgroundPreviewTimers.set(accountId, setInterval(() => void capture(), 2000))
  }

  private stopBackgroundPreview(accountId: number): void {
    const timer = this.backgroundPreviewTimers.get(accountId)
    if (timer) clearInterval(timer)
    this.backgroundPreviewTimers.delete(accountId)
    this.backgroundPreviewCapturing.delete(accountId)
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_PREVIEW, {
        accountId,
        campaignId: 0,
        context: 'contact-scan',
        active: false,
        timestamp: new Date().toISOString()
      })
    } catch {}
  }

  private stopAllBackgroundPreviews(): void {
    for (const timer of this.backgroundPreviewTimers.values()) {
      clearInterval(timer)
    }
    this.backgroundPreviewTimers.clear()
    this.backgroundPreviewCapturing.clear()
  }
}
