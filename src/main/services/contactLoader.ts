import { BrowserWindow } from 'electron'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { IPC_EVENTS, ContactType, AutoAccount, AutoAccountContact, ContactLoadProgress, ContactLoadResult } from '../../shared/types'
import { IPC_EVENTS_V2, RunStepV2 } from '../../shared/v2Types'
import { BackgroundPageManager } from '../v2/runtime/backgroundPageManager'
import { PageController } from '../v2/runtime/pageController'
import { WorkflowEngineV2, RunResult } from '../v2/runtime/workflowEngine'
import * as workflowV2Repo from '../data/repositories/workflowV2Repository'
import * as localContactRepo from '../data/repositories/localAccountContactRepository'
import { ProxyRuntimeService } from './proxyRuntimeService'

interface ActiveContactLoad {
  controller: AbortController
  variables: Record<string, unknown>
  runKey: string
  contactType: ContactType
}

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
}

const CONTACT_SCAN_WORKFLOWS: Partial<Record<ContactType, string>> = {
  person: '[Built-in] Facebook - Quét danh sách bạn bè',
  group: '[Built-in] Facebook - Quét group đã tham gia',
  page: '[Built-in] Facebook - Quét page quản lý'
}

const POST_COMMENTERS_WORKFLOW = '[Built-in] Facebook - Quét người comment bài post'
const PAGE_INBOX_CONTACT_TYPE: ContactType = 'page_inbox_customer'
const FACEBOOK_GRAPH_API_BASE = 'https://graph.facebook.com/v25.0'
const PAGE_INBOX_BATCH_SIZE = 500
const PAGE_INBOX_MAX_CONTACTS = 100000
const PAGE_INBOX_MAX_FETCH_FAILURES = 3
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
  private proxyRuntime?: ProxyRuntimeService

  constructor(
    supabase: SupabaseService,
    _webviewRegistry: WebviewRegistry,
    mainWindow: BrowserWindow,
    proxyRuntime?: ProxyRuntimeService
  ) {
    this.supabase = supabase
    this.mainWindow = mainWindow
    this.proxyRuntime = proxyRuntime
  }

  destroyBackgroundPage(accountId: number): void {
    this.backgroundPages.destroy(accountId)
  }

  async loadFriends(accountId: number): Promise<ContactLoadResult> {
    return this.loadContacts(accountId, 'person')
  }

  async loadGroups(accountId: number): Promise<ContactLoadResult> {
    return this.loadContacts(accountId, 'group')
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
      }
    })
  }

  async loadPageInboxCustomers(accountId: number, pageUid: string, pageName?: string): Promise<ContactLoadResult> {
    const normalizedPageUid = String(pageUid || '').trim()
    const normalizedPageName = String(pageName || '').replace(/\s+/g, ' ').trim()
    const typeName = 'người từng nhắn tin với page'

    if (!normalizedPageUid) {
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: false,
        count: 0,
        error: 'Vui lòng chọn page cần quét.'
      })
    }

    let account: AutoAccount | null
    try {
      account = await this.supabase.getAccount(accountId)
    } catch (err: any) {
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: false,
        count: 0,
        error: `Không thể kiểm tra trạng thái tài khoản: ${err.message || String(err)}`
      })
    }

    const preflightError = this.getPreflightError(account)
    if (preflightError) {
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: false,
        count: 0,
        error: preflightError
      })
    }

    const latestAccount = await this.supabase.getAccount(accountId)
    const latestPreflightError = this.getPreflightError(latestAccount)
    if (latestPreflightError) {
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: false,
        count: 0,
        error: latestPreflightError
      })
    }

    const loadState = this.startLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {}, {
      runKeyLabel: `page-inbox-${normalizedPageUid}`,
      targetUrl: 'https://business.facebook.com/content_management'
    })
    const runnableAccount = latestAccount!
    const previousStatus = runnableAccount.status as 'chờ xử lý' | 'tạm dừng'
    const variables = loadState.variables
    let claimedAccount = false

    try {
      await this.updateAccountAndBroadcast(accountId, { status: 'đang chạy' })
      claimedAccount = true

      this.sendProgress(`🔄 Đang lấy token để quét inbox page ${normalizedPageName || normalizedPageUid}...`, {
        accountId,
        contactType: PAGE_INBOX_CONTACT_TYPE,
        runKey: loadState.runKey
      })

      await this.proxyRuntime?.prepareAccountSession(runnableAccount)
      const page = this.backgroundPages.getOrCreate(accountId, runnableAccount.flatformType)
      this.selectAutomationBrowser(accountId)
      this.startBackgroundPreview(accountId, page, 'Đang quét người nhắn tin với page')

      await page.navigate('https://business.facebook.com/content_management')
      await this.sleep(5000)

      const userAccessToken = await this.extractFacebookUserAccessToken(page)
      if (!userAccessToken) {
        throw new Error('Không lấy được token Facebook. Vui lòng mở lại tab Facebook/Business và thử lại.')
      }

      const cookieHeader = await this.getFacebookCookieHeader(page)
      const pageAccessToken = await this.getPageAccessToken(normalizedPageUid, userAccessToken, cookieHeader)
      if (!pageAccessToken) {
        throw new Error('Không lấy được Page access token. Tài khoản cần có quyền nhắn tin trên page này.')
      }

      let nextUrl = this.buildPageInboxConversationsUrl(normalizedPageUid, pageAccessToken)
      const seenPsids = new Set<string>()
      let pendingContacts: localContactRepo.PageInboxContactInput[] = []
      let savedCount = 0
      let scannedCount = 0
      let fetchFailureCount = 0
      let fetchFailureMessage = ''
      let reachedMaxContacts = false

      while (nextUrl) {
        if (this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted) break

        let response: GraphApiResponse<PageInboxConversation[]>
        try {
          response = await this.fetchGraphJson<PageInboxConversation[]>(nextUrl, cookieHeader)
          fetchFailureCount = 0
          fetchFailureMessage = ''
        } catch (err: any) {
          fetchFailureCount += 1
          fetchFailureMessage = err?.message || String(err)
          if (fetchFailureCount >= PAGE_INBOX_MAX_FETCH_FAILURES) break
          this.sendProgress(`Facebook đang phản hồi lỗi, thử lại lần ${fetchFailureCount + 1}/${PAGE_INBOX_MAX_FETCH_FAILURES}...`, {
            accountId,
            contactType: PAGE_INBOX_CONTACT_TYPE,
            runKey: loadState.runKey
          })
          await this.sleep(2000)
          if (this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted) break
          continue
        }

        const conversations = Array.isArray(response.data) ? response.data : []
        scannedCount += conversations.length

        for (const conversation of conversations) {
          const contact = this.mapPageInboxConversation(
            accountId,
            normalizedPageUid,
            normalizedPageName,
            conversation
          )
          if (!contact || seenPsids.has(contact.uid)) continue
          seenPsids.add(contact.uid)
          pendingContacts.push(contact)
          if (seenPsids.size >= PAGE_INBOX_MAX_CONTACTS) {
            reachedMaxContacts = true
            break
          }
        }

        const cancelledAfterPage = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
        if (pendingContacts.length >= PAGE_INBOX_BATCH_SIZE) {
          savedCount += localContactRepo.upsertPageInboxContacts(pendingContacts)
          pendingContacts = []
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
        if (reachedMaxContacts) break
        nextUrl = response.paging?.next || ''
      }

      if (pendingContacts.length > 0) {
        savedCount += localContactRepo.upsertPageInboxContacts(pendingContacts)
      }

      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${savedCount} data.`, {
          accountId,
          contactType: PAGE_INBOX_CONTACT_TYPE,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
          success: true,
          count: savedCount,
          stopped: true
        }, loadState.runKey)
      }

      if (fetchFailureCount >= PAGE_INBOX_MAX_FETCH_FAILURES) {
        this.sendProgress(`Server tin nhắn của Facebook bị lỗi hoặc đang bảo trì. Đã lưu ${savedCount} data.`, {
          accountId,
          contactType: PAGE_INBOX_CONTACT_TYPE,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
          success: true,
          count: savedCount,
          error: fetchFailureMessage
        }, loadState.runKey)
      }

      this.sendProgress(reachedMaxContacts
        ? `✅ Đã quét và lưu ${savedCount} ${typeName}. Đã đạt giới hạn ${PAGE_INBOX_MAX_CONTACTS.toLocaleString('vi-VN')} data.`
        : `✅ Đã quét và lưu ${savedCount} ${typeName}.`, {
        accountId,
        contactType: PAGE_INBOX_CONTACT_TYPE,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: true,
        count: savedCount
      }, loadState.runKey)
    } catch (err: any) {
      const stopped = this.isLoadCancelled(accountId, variables) || loadState.controller.signal.aborted
      const errMsg = err?.message || String(err)
      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}.`, {
          accountId,
          contactType: PAGE_INBOX_CONTACT_TYPE,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
          success: true,
          count: 0,
          stopped: true
        }, loadState.runKey)
      }

      this.sendProgress(`❌ Lỗi quét ${typeName}: ${errMsg}`, {
        accountId,
        contactType: PAGE_INBOX_CONTACT_TYPE,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, PAGE_INBOX_CONTACT_TYPE, {
        success: false,
        count: 0,
        error: errMsg
      }, loadState.runKey)
    } finally {
      if (this.activeLoads.get(accountId) === loadState) {
        this.activeLoads.delete(accountId)
        this.cancelledLoads.delete(accountId)
        this.stopBackgroundPreview(accountId)
        this.backgroundPages.destroy(accountId)
        if (claimedAccount) {
          await this.restoreAccountStatus(accountId, previousStatus)
        }
      }
    }
  }

  cancelLoad(accountId: number): void {
    this.cancelledLoads.add(accountId)
    const active = this.activeLoads.get(accountId)
    if (active) {
      active.variables.contactScanCancelled = true
    }
  }

  stopAll(): void {
    for (const [accountId, active] of this.activeLoads.entries()) {
      active.variables.contactScanCancelled = true
      active.controller.abort()
      this.stopBackgroundPreview(accountId)
    }
    this.activeLoads.clear()
    this.cancelledLoads.clear()
    this.stopAllBackgroundPreviews()
    this.backgroundPages.destroyAll()
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
    const previousStatus = runnableAccount.status as 'chờ xử lý' | 'tạm dừng'
    const variables = loadState.variables
    let claimedAccount = false

    try {
      await this.updateAccountAndBroadcast(accountId, { status: 'đang chạy' })
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
        if (stopped) {
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
            stopped: true
          }, loadState.runKey)
        }

        this.sendProgress(`⚠️ Không tìm thấy ${typeName} nào. Kiểm tra tài khoản đã đăng nhập chưa.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
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

      if (stopped) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${saved} data cho lần quét này.`, {
          accountId,
          contactType,
          runKey: loadState.runKey
        })
        return this.completeLoad(accountId, contactType, {
          ...resultMeta,
          success: true,
          count: saved,
          stopped: true
        }, loadState.runKey)
      }

      this.sendProgress(`✅ Đã load ${saved} ${typeName} thành công!`, {
        accountId,
        contactType,
        runKey: loadState.runKey
      })
      return this.completeLoad(accountId, contactType, { ...resultMeta, success: true, count: saved }, loadState.runKey)
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
          ...resultMeta,
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
        ...resultMeta,
        success: false,
        count: 0,
        error: errMsg
      }, loadState.runKey)
    } finally {
      if (this.activeLoads.get(accountId) === loadState) {
        this.activeLoads.delete(accountId)
        this.cancelledLoads.delete(accountId)
        this.stopBackgroundPreview(accountId)
        this.backgroundPages.destroy(accountId)
        if (claimedAccount) {
          await this.restoreAccountStatus(accountId, previousStatus)
        }
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async extractFacebookUserAccessToken(page: PageController): Promise<string> {
    const token = await page.evaluate<string>(`
      var html = [
        document.documentElement ? document.documentElement.innerHTML : '',
        document.body ? document.body.innerHTML : ''
      ].join('\\n');
      var match = html.match(/EAAG[^"'\\\\<\\s]+/);
      return match ? match[0] : '';
    `).catch(() => '')

    if (token) return token

    await page.navigate('https://business.facebook.com/latest/content_management').catch(() => undefined)
    await this.sleep(5000)
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

  private async fetchGraphJson<T>(url: string, cookieHeader: string): Promise<GraphApiResponse<T>> {
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildGraphHeaders(cookieHeader)
    })
    const data = await response.json().catch(() => null) as GraphApiResponse<T> | null
    if (!response.ok || data?.error) {
      throw new Error(data?.error ? this.formatGraphError(data.error) : `Graph API lỗi HTTP ${response.status}`)
    }
    return data || {}
  }

  private async getPageAccessToken(pageUid: string, userAccessToken: string, cookieHeader: string): Promise<string> {
    const url = `${FACEBOOK_GRAPH_API_BASE}/${encodeURIComponent(pageUid)}?fields=access_token&access_token=${encodeURIComponent(userAccessToken)}`
    const response = await this.fetchGraphJson<never>(url, cookieHeader)
    return String(response.access_token || '').trim()
  }

  private buildPageInboxConversationsUrl(pageUid: string, pageAccessToken: string): string {
    const fields = 'participants,messages.limit(25){id,message,created_time,from}'
    return `${FACEBOOK_GRAPH_API_BASE}/${encodeURIComponent(pageUid)}/conversations?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(pageAccessToken)}`
  }

  private mapPageInboxConversation(
    accountId: number,
    pageUid: string,
    pageName: string,
    conversation: PageInboxConversation
  ): localContactRepo.PageInboxContactInput | null {
    const conversationId = String(conversation.id || '').trim()
    const participants = Array.isArray(conversation.participants?.data) ? conversation.participants!.data! : []
    const customer = participants.find(participant => String(participant.id || '').trim() !== pageUid) || participants[0]
    const customerPsid = String(customer?.id || '').trim()
    if (!conversationId || !customerPsid || customerPsid === pageUid) return null

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
    const existing = this.activeLoads.get(accountId)
    if (existing) {
      existing.variables.contactScanCancelled = true
      existing.controller.abort()
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
    const loadState = { controller, variables, runKey, contactType }
    this.activeLoads.set(accountId, loadState)
    return loadState
  }

  private isLoadCancelled(accountId: number, variables?: Record<string, unknown>): boolean {
    return this.cancelledLoads.has(accountId) || variables?.contactScanCancelled === true
  }

  private sendProgress(message: string, meta: Omit<ContactLoadProgress, 'message'> = {}): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CONTACTS_PROGRESS, { ...meta, message })
    } catch {}
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
        if (contactType === 'person') contact.isFriend = item.isFriend !== false
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
      return {
        ...contact,
        isFriend: existing?.isFriend === true ? true : contact.isFriend === true,
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

    return merged
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
    }
  }

  private getPreviewTitle(contactType: ContactType): string {
    if (contactType === 'person') return 'Đang quét bạn bè nền'
    if (contactType === 'group') return 'Đang quét group nền'
    if (contactType === 'page_inbox_customer') return 'Đang quét người nhắn tin với page'
    if (contactType === 'zalo_tag') return 'Đang tải tag Zalo'
    return 'Đang quét page nền'
  }

  private async updateAccountAndBroadcast(id: number, updates: Partial<AutoAccount>): Promise<AutoAccount> {
    const updated = await this.supabase.updateAccount(id, updates)
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
    } catch {}
    return updated
  }

  private async restoreAccountStatus(accountId: number, previousStatus: 'chờ xử lý' | 'tạm dừng'): Promise<void> {
    try {
      const account = await this.supabase.getAccount(accountId)
      if (!account || account.status !== 'đang chạy') return
      await this.updateAccountAndBroadcast(accountId, { status: previousStatus })
    } catch (err) {
      console.error('Failed to restore account after contact scan:', err)
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
