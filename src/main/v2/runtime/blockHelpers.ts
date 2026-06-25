import { resolveXpathByName } from '../../data/repositories/elementV2Repository'
import type { CampaignRunEventInput } from '../../../shared/types'

export interface BlockHelpers {
  /** Pause execution. Throws khi signal aborted. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Append a line vào run log (capture cho UI realtime + run history) */
  log(message: string): void
  /** Random integer trong [min, max] (inclusive) */
  randomBetween(min: number, max: number): number
  /** Normalize URL FB: bare uid/slug → full https://www.facebook.com/... */
  normalizeFbUrl(raw: string): string
  /** Bare UID/slug từ profile URL/profile.php?id=X */
  extractUidFromInput(raw: string): string
  /** Tách content theo `|` thành array biến thể (đã trim, bỏ rỗng) */
  splitVariants(content: string | undefined | null): string[]
  /** Cycle 1 biến thể theo index (modulo). Empty array → '' */
  cycleVariant(variants: string[], index: number): string
  /** Lookup XPath snippet từ auto_elements bằng name. Throws nếu không tìm thấy. */
  element(name: string): Promise<string>
  /** Concat multiple XPath snippets bằng name + replace ${var} placeholder */
  elementWith(name: string, vars: Record<string, string | number>): Promise<string>
  /** Check trang group pending-content bằng page phụ nếu runtime hỗ trợ. */
  checkGroupPendingContent(options: GroupPendingContentCheckOptions): Promise<GroupPendingContentCheckResult>
  /** Optional helper: log a structured execution event when the runtime supports it. */
  logRunEvent?(event: Record<string, unknown>): Promise<OptionalHelperUnsupportedResult | unknown>
  /** Optional helper: log multiple structured execution events when the runtime supports it. */
  logRunEvents?(events: Record<string, unknown>[]): Promise<OptionalHelperUnsupportedResult | unknown>
  /** Optional helper: call a centralized AI configuration by ai_using.code. */
  callAIUsing?(code: string, payload?: Record<string, unknown>): Promise<OptionalHelperUnsupportedResult | unknown>
  /** Zalo browserless helpers. Implemented only by campaign runtime. */
  zaloFindPhoneUser(options: ZaloFindPhoneUserOptions): Promise<ZaloActionHelperResult>
  zaloResolveGroupMemberTarget(options: ZaloResolveGroupMemberTargetOptions): Promise<ZaloActionHelperResult>
  zaloResolveRemarketingCustomerTarget(options: ZaloResolveGroupMemberTargetOptions): Promise<ZaloActionHelperResult>
  zaloSendPhoneMessage(options: ZaloSendPhoneMessageOptions): Promise<ZaloActionHelperResult>
  zaloSendFriendMessage(options: ZaloSendDirectMessageOptions): Promise<ZaloActionHelperResult>
  zaloSendGroupMessage(options: ZaloSendDirectMessageOptions): Promise<ZaloActionHelperResult>
  zaloJoinGroupLink(options: ZaloJoinGroupLinkOptions): Promise<ZaloActionHelperResult>
  zaloSendPhoneFriendRequest(options: ZaloSendPhoneFriendRequestOptions): Promise<ZaloActionHelperResult>
  zaloApplyContactTag(options: ZaloApplyContactTagOptions): Promise<ZaloActionHelperResult>
  zaloChangeContactAlias(options: ZaloChangeContactAliasOptions): Promise<ZaloActionHelperResult>
  /** Email browserless helper. Implemented only by campaign runtime. */
  emailSendMessage(options: EmailSendMessageOptions): Promise<EmailActionHelperResult>
}

export interface OptionalHelperUnsupportedResult {
  ok: false
  unsupported: true
  helper: string
}

export interface GroupPendingContentCheckOptions {
  url: string
  rawSelector: string
  linkSelector: string
  timeoutMs?: number
}

export interface GroupPendingContentCheckResult {
  ok: boolean
  conclusive: boolean
  url: string
  links: string[]
  error?: string
}

export interface BlockRuntimeMetadata {
  organizationId?: number | null
  accountId?: number
  campaignId?: number
  campaignInputId?: number | null
  campaignInputDataId?: number
  workflowId?: number
  runId?: number
  runStepId?: number
  nodeId?: string
  blockId?: number
  blockName?: string
}

export interface BlockRuntimeHelpers {
  checkGroupPendingContent?: (options: GroupPendingContentCheckOptions) => Promise<GroupPendingContentCheckResult>
  logRunEvent?: (event: CampaignRunEventInput, metadata: BlockRuntimeMetadata) => Promise<unknown>
  logRunEvents?: (events: CampaignRunEventInput[], metadata: BlockRuntimeMetadata) => Promise<unknown>
  callAIUsing?: (code: string, payload: Record<string, unknown>, metadata: BlockRuntimeMetadata) => Promise<unknown>
  zaloFindPhoneUser?: (options: ZaloFindPhoneUserOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloResolveGroupMemberTarget?: (options: ZaloResolveGroupMemberTargetOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloResolveRemarketingCustomerTarget?: (options: ZaloResolveGroupMemberTargetOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloSendPhoneMessage?: (options: ZaloSendPhoneMessageOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloSendFriendMessage?: (options: ZaloSendDirectMessageOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloSendGroupMessage?: (options: ZaloSendDirectMessageOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloJoinGroupLink?: (options: ZaloJoinGroupLinkOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloSendPhoneFriendRequest?: (options: ZaloSendPhoneFriendRequestOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloApplyContactTag?: (options: ZaloApplyContactTagOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  zaloChangeContactAlias?: (options: ZaloChangeContactAliasOptions, metadata: BlockRuntimeMetadata) => Promise<ZaloActionHelperResult>
  emailSendMessage?: (options: EmailSendMessageOptions, metadata: BlockRuntimeMetadata) => Promise<EmailActionHelperResult>
}

export interface ZaloResolvedTarget {
  uid: string
  phone: string
  displayName?: string
  originalName?: string
  gender?: number | string | null
  isFriend?: boolean
  raw?: Record<string, unknown>
}

export interface ZaloActionDetailOutput {
  createDetail?: boolean
  actionCode?: string | null
  actionName?: string
  status?: string
  log?: string
  errorCode?: string | null
  data?: Record<string, unknown>
  countsTowardLimit?: boolean
  countsTowardBadTarget?: boolean
  resetInputToPending?: boolean
  pendingNote?: string
  stopAfterTarget?: boolean
}

export interface ZaloActionHelperResult {
  ok: boolean
  skipped?: boolean
  message?: string
  zaloTarget?: ZaloResolvedTarget | null
  detail?: ZaloActionDetailOutput | null
}

export interface ZaloFindPhoneUserOptions {
  phone?: string
  inputData?: Record<string, unknown>
  targetName?: string
}

export interface ZaloResolveGroupMemberTargetOptions {
  targetUid?: string
  targetName?: string
  inputData?: Record<string, unknown>
}

export interface ZaloSendPhoneMessageOptions {
  enabled?: boolean
  target?: ZaloResolvedTarget | null
  message?: string
  attachments?: unknown[]
  inputData?: Record<string, unknown>
}

export interface ZaloSendDirectMessageOptions {
  targetUid?: string
  targetName?: string
  message?: string
  attachments?: unknown[]
  inputData?: Record<string, unknown>
}

export interface ZaloJoinGroupLinkOptions {
  targetLink?: string
  targetName?: string
  inputData?: Record<string, unknown>
}

export interface ZaloSendPhoneFriendRequestOptions {
  enabled?: boolean
  target?: ZaloResolvedTarget | null
  message?: string
  inputData?: Record<string, unknown>
}

export interface ZaloApplyContactTagOptions {
  enabled?: boolean
  target?: ZaloResolvedTarget | null
  labelId?: number | string | null
  labelName?: string | null
}

export interface ZaloChangeContactAliasOptions {
  enabled?: boolean
  target?: ZaloResolvedTarget | null
  alias?: string
  inputData?: Record<string, unknown>
}

export interface EmailSendMessageOptions {
  to?: string
  subject?: string
  body?: string
  isHtml?: boolean
  attachments?: unknown[]
  inputData?: Record<string, unknown>
  targetName?: string
}

export interface EmailActionHelperResult {
  ok: boolean
  skipped?: boolean
  message?: string
  // Reuse the generic action-detail shape consumed by the run-step processor.
  detail?: ZaloActionDetailOutput | null
}

const OPTIONAL_HELPER_NAMES = new Set(['logRunEvent', 'logRunEvents', 'callAIUsing'])

function createUnsupportedOptionalHelper(helper: string) {
  return async (): Promise<OptionalHelperUnsupportedResult> => ({
    ok: false,
    unsupported: true,
    helper
  })
}

function withOptionalHelpers(baseHelpers: BlockHelpers): BlockHelpers {
  return new Proxy(baseHelpers, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target) && OPTIONAL_HELPER_NAMES.has(prop)) {
        return createUnsupportedOptionalHelper(prop)
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}

/**
 * Tạo helpers instance gắn với 1 run/block. `logCollector` capture log để
 * (a) emit lên UI realtime qua IPC `flow:progress`/`v2:run:log`,
 * (b) lưu vào BlockResult.logs cho run history.
 */
export function createBlockHelpers(
  logCollector: (message: string) => void,
  runtimeHelpers: BlockRuntimeHelpers = {},
  runtimeMetadata: BlockRuntimeMetadata = {}
): BlockHelpers {
  const baseHelpers: BlockHelpers = {
    async sleep(ms: number, signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) throw new Error('Block bị huỷ trước khi sleep')
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (signal) signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        const onAbort = () => {
          clearTimeout(timer)
          reject(new Error('Block bị huỷ trong khi sleep'))
        }
        if (signal) signal.addEventListener('abort', onAbort, { once: true })
      })
    },

    log(message: string): void {
      logCollector(String(message))
    },

    randomBetween(min: number, max: number): number {
      const lo = Math.ceil(min)
      const hi = Math.floor(max)
      return Math.floor(Math.random() * (hi - lo + 1)) + lo
    },

    normalizeFbUrl(raw: string): string {
      const trimmed = String(raw || '').trim()
      if (!trimmed) return trimmed
      if (/^https?:\/\//i.test(trimmed)) return trimmed
      if (/^(www\.)?facebook\.com\//i.test(trimmed)) return `https://${trimmed}`
      const cleaned = trimmed.replace(/^\/+|\/+$/g, '')
      // Group URL: prefix groups/
      if (/^groups\//i.test(cleaned)) return `https://www.facebook.com/${cleaned}`
      // Default: profile/page
      if (/^\d+$/.test(cleaned)) return `https://www.facebook.com/profile.php?id=${cleaned}`
      return `https://www.facebook.com/${cleaned}`
    },

    extractUidFromInput(raw: string): string {
      const trimmed = String(raw || '').trim()
      try {
        const url = new URL(trimmed)
        const idParam = url.searchParams.get('id')
        if (idParam) return idParam
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length > 0) return parts[parts.length - 1]
      } catch {
        // Not a URL, return as-is
      }
      return trimmed
    },

    splitVariants(content: string | undefined | null): string[] {
      if (!content) return []
      if (!content.includes('|')) return [content]
      return content.split('|').map(s => s.trim()).filter(s => s.length > 0)
    },

    cycleVariant(variants: string[], index: number): string {
      if (!variants || variants.length === 0) return ''
      const safeIdx = ((index % variants.length) + variants.length) % variants.length
      return variants[safeIdx]
    },

    async element(name: string): Promise<string> {
      return await resolveXpathByName(name)
    },

    async elementWith(name: string, vars: Record<string, string | number>): Promise<string> {
      const tpl = await resolveXpathByName(name)
      return tpl.replace(/\$\{(\w+)\}/g, (_, k) => {
        const v = vars[k]
        return v === undefined ? '' : String(v)
      })
    },

    async checkGroupPendingContent(options: GroupPendingContentCheckOptions): Promise<GroupPendingContentCheckResult> {
      if (runtimeHelpers.checkGroupPendingContent) {
        return await runtimeHelpers.checkGroupPendingContent(options)
      }
      return {
        ok: false,
        conclusive: false,
        url: String(options?.url || ''),
        links: [],
        error: 'Runtime hiện tại không hỗ trợ page phụ để kiểm tra pending content'
      }
    },

    async zaloFindPhoneUser(options: ZaloFindPhoneUserOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloFindPhoneUser) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloFindPhoneUser(options, runtimeMetadata)
    },

    async zaloResolveGroupMemberTarget(options: ZaloResolveGroupMemberTargetOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloResolveGroupMemberTarget) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloResolveGroupMemberTarget(options, runtimeMetadata)
    },

    async zaloResolveRemarketingCustomerTarget(options: ZaloResolveGroupMemberTargetOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloResolveRemarketingCustomerTarget) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloResolveRemarketingCustomerTarget(options, runtimeMetadata)
    },

    async zaloSendPhoneMessage(options: ZaloSendPhoneMessageOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloSendPhoneMessage) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloSendPhoneMessage(options, runtimeMetadata)
    },

    async zaloSendFriendMessage(options: ZaloSendDirectMessageOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloSendFriendMessage) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloSendFriendMessage(options, runtimeMetadata)
    },

    async zaloSendGroupMessage(options: ZaloSendDirectMessageOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloSendGroupMessage) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloSendGroupMessage(options, runtimeMetadata)
    },

    async zaloJoinGroupLink(options: ZaloJoinGroupLinkOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloJoinGroupLink) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloJoinGroupLink(options, runtimeMetadata)
    },

    async zaloSendPhoneFriendRequest(options: ZaloSendPhoneFriendRequestOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloSendPhoneFriendRequest) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloSendPhoneFriendRequest(options, runtimeMetadata)
    },

    async zaloApplyContactTag(options: ZaloApplyContactTagOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloApplyContactTag) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloApplyContactTag(options, runtimeMetadata)
    },

    async zaloChangeContactAlias(options: ZaloChangeContactAliasOptions): Promise<ZaloActionHelperResult> {
      if (!runtimeHelpers.zaloChangeContactAlias) throw new Error('Runtime hiện tại không hỗ trợ Zalo API')
      return runtimeHelpers.zaloChangeContactAlias(options, runtimeMetadata)
    },

    async emailSendMessage(options: EmailSendMessageOptions): Promise<EmailActionHelperResult> {
      if (!runtimeHelpers.emailSendMessage) throw new Error('Runtime hiện tại không hỗ trợ Email API')
      return runtimeHelpers.emailSendMessage(options, runtimeMetadata)
    }
  }

  if (runtimeHelpers.logRunEvent) {
    baseHelpers.logRunEvent = async (event: Record<string, unknown>) => {
      try {
        return await runtimeHelpers.logRunEvent!(event as CampaignRunEventInput, runtimeMetadata)
      } catch (err: any) {
        const message = err?.message ? String(err.message) : String(err)
        logCollector(`[warn] helper logRunEvent failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  }

  if (runtimeHelpers.logRunEvents) {
    baseHelpers.logRunEvents = async (events: Record<string, unknown>[]) => {
      try {
        return await runtimeHelpers.logRunEvents!(events as CampaignRunEventInput[], runtimeMetadata)
      } catch (err: any) {
        const message = err?.message ? String(err.message) : String(err)
        logCollector(`[warn] helper logRunEvents failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  }

  if (runtimeHelpers.callAIUsing) {
    baseHelpers.callAIUsing = async (code: string, payload: Record<string, unknown> = {}) => {
      try {
        return await runtimeHelpers.callAIUsing!(code, payload, runtimeMetadata)
      } catch (err: any) {
        const message = err?.message ? String(err.message) : String(err)
        logCollector(`[warn] helper callAIUsing failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  }

  return withOptionalHelpers(baseHelpers)
}
