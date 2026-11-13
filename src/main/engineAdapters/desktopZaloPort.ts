/**
 * Cổng Zalo của engine v2 trên Desktop: thao tác thật qua zaloRuntimeService (tài khoản QR và Zalo Web dùng chung
 * như bộ chạy cũ) và các repository hiện có. Cổng không quyết định gì: chỉ gọi, chuẩn hoá hồ sơ và đổi lỗi gốc
 * thành tín hiệu thô (zaloPortErrorFrom) theo đúng cách Desktop đọc mã lỗi; pha của lỗi theo loại thao tác (tra số là đọc,
 * gửi tin / kết bạn là gửi) để lỗi mạng không bị tính như lỗi nghiệp vụ Zalo.
 */
import { ZaloApiError } from 'zca-js'
import type { ZaloOutgoingText as RuntimeOutgoingText, ZaloRuntimeService } from '../services/zaloRuntimeService'
import { phoneSearchLimitScope } from '../services/zaloPhoneSearch'
import { getZaloErrorPolicyByCode } from '../data/repositories/errorPolicyRepository'
import { checkZaloMessageOptOut, prepareZaloMessageOptOut, updateCampaignInputData } from '../data/repositories/campaignRepository'
import { appendZaloTagsToExistingContacts } from '../data/repositories/accountContactRepository'
import { applyAkaBizTagsToContactTargets } from '../data/repositories/contactTagRepository'
import { engagementMessageIds } from '../../shared/zaloCampaignEngagement'
import { abandonCampaignEngagementSend, beginCampaignEngagementSend, recordCampaignEngagementDetail, stageCampaignEngagementSource }
  from '../services/zaloCampaignEngagement'
import { beginZaloMessageStatusSend } from '../services/zaloMessageStatusSync'
import { isZaloLabelSkipResult, readZaloApiFriendStatus } from '../../shared/zaloAuxiliaryActions'
import type { CampaignLabelContext } from '../../shared/campaignSendExclusion'
import type { CampaignMediaInput } from '../../shared/types'
import {
  ZaloPortError, ZaloSourceTagError, campaignMediaName, materializeStateFrom, mediaFenceError, mediaUnavailableError, zaloPortErrorFrom,
  type MaterializeContext, type PhoneSearchLimitScope, type ZaloCampaignPort, type ZaloFoundUser, type ZaloJoinGroupLinkResult,
  type ZaloOutgoingText, type ZaloResolvedTarget
} from '../../../packages/campaign-engine/src/index'
import { cleanupCampaignMediaTempFiles, isCampaignMediaResolveError, resolveCampaignMediaSource } from '../services/campaignMediaSource'
import { isZaloPreCallError } from '../services/zaloPreCallError'
import { engineMaterialize, engineSendExclusion, engineSmsPush, takeEngineContentIndex } from './desktopEngineData'

export interface DesktopZaloPortHost {
  zaloRuntime: ZaloRuntimeService
  accountId: number
  campaignId: number
  /** Tài khoản đang chạy (theo dõi tương tác: UID Zalo, đăng nhập bằng trình duyệt thì không theo dõi như bộ cũ). */
  account: { zaloUid?: string | null; isZaloShowWeb?: boolean | null; organizationId?: number | null }
  /** Lưu hồ sơ tìm được vào danh bạ (upsertZaloFoundUserContact của bộ lập lịch). */
  saveContact(user: ZaloFoundUser): Promise<void>
  /** Lưu hồ sơ đọc theo UID vào danh bạ (upsertZaloResolvedProfileTarget của bộ lập lịch). */
  saveResolvedProfile(target: ZaloResolvedTarget): Promise<void>
  /** Lưu danh bạ group sau khi tham gia bằng link (upsertZaloJoinGroupLinkContact của bộ lập lịch). */
  saveJoinedGroup(result: ZaloJoinGroupLinkResult, isJoined: boolean): Promise<void>
  /** Lưu danh bạ bạn bè vừa đọc khi lấy data đầu lượt (mapZaloApiRawUserContact + upsertZaloApiUserContacts của bộ lập lịch). */
  saveFriendContacts(raws: readonly Record<string, unknown>[], source: string): Promise<void>
  /** Kiêm SMS sang akaBiz Sms (getAkaBizIntegrationsForStaff + addSmsCampaignDetail của bộ lập lịch). */
  pushExternalSms(input: { shopIds: readonly number[]; phone: string; name: string; content: string }):
    Promise<{ integrationMissing?: boolean; integrationError?: string | null; results: Array<{ shopId: number; ok: boolean; error?: string | null }> }>
  /** Giờ nghiệp vụ từ DB (getDatabaseBusinessNow của bộ lập lịch). */
  businessNow(): Promise<Date>
  /** AI viết lại nội dung (callAiUsing qua proxy AI Desktop). */
  rewriteMessage(inputDataId: number | null, content: string): Promise<string>
  callTimeoutMs: number
  trace(event: { type: string; [key: string]: unknown }): void
}

/**
 * Lỗi do Zalo trả về (ZaloApiError của zca-js, có hoặc không có mã). Lỗi khác là lỗi trên máy trước khi gọi
 * (chưa có phiên…) hoặc lỗi đường truyền; classifyZaloError của lõi xếp pha theo loại thao tác (đọc / gửi).
 */
function zaloAnswered(error: unknown): boolean {
  return error instanceof ZaloApiError
}

/**
 * Lỗi zaloRuntimeService ném TRƯỚC khi gọi Zalo: chắc chắn chưa gửi gì, kể cả ở bước gửi. zaloRuntimeService gắn dấu cho mọi lỗi của
 * bước chuẩn bị (zaloPreCallError: ensureApi đọc tài khoản / phiên từ DB, kiểm gói, đăng nhập lại bằng phiên; sendMessage đọc lại tài
 * khoản, mở listener tải tệp), ví dụ "Failed to get account Zalo session: TypeError: fetch failed" khi Supabase chập chờn. Câu dưới đây
 * (nguyên văn của zaloRuntimeService) giữ cho lỗi ném ngoài các bước đó.
 */
const LOCAL_BEFORE_CALL = /^(?:Chưa có session Zalo|Không tìm thấy tài khoản(?: Zalo)?|Tài khoản không phải nền tảng Zalo)$/
function preCallFailure(error: unknown): Error | null {
  return isZaloPreCallError(error) ? zaloPortErrorFrom(error, { phase: 'before_send' }) : null
}
/** Lỗi kiểm đầu vào của applyLabelToUser (ZR:2225-2240): ném trước khi gọi Zalo. */
const LOCAL_LABEL_INPUT = /^(?:UID Zalo không hợp lệ|Tag Zalo không hợp lệ)$/
/** zaloRuntimeService.sendMessage (ZR:1900-1903): tài khoản Zalo Web gửi tệp không phải ảnh, ném trước mọi yêu cầu. */
const ZALO_WEB_IMAGE_ONLY = 'Zalo Web hiện chỉ hỗ trợ ảnh JPG, JPEG, PNG, WEBP hoặc GIF'
function sendFailure(error: unknown): Error {
  // Hàng rào media (CampaignMediaExecution): đã đóng thì chưa gửi gì; quá giờ / phiên dừng thì không rõ đã tới.
  const fence = mediaFenceError(error)
  if (fence) return fence
  const message = error instanceof Error ? error.message.trim() : ''
  if (!zaloAnswered(error) && message === ZALO_WEB_IMAGE_ONLY) {
    // Cấu hình, không phải lỗi của data: CFG10 (tạm dừng chiến dịch một lần, data về hàng đợi) như luật kiểm đầu lượt.
    return new ZaloPortError(message, { code: 'zalo_web_image_only', phase: 'before_send',
      signal: { kind: 'engine', code: 'zalo_web_image_only', errorCode: 'err_cfg_zalo_web_image_only', message } })
  }
  const preCall = preCallFailure(error)
  if (preCall) return preCall
  if (!zaloAnswered(error) && (LOCAL_BEFORE_CALL.test(message) || LOCAL_LABEL_INPUT.test(message))) {
    return zaloPortErrorFrom(error, { phase: 'before_send' })
  }
  return zaloPortErrorFrom(error, { operation: 'send', answered: zaloAnswered(error) })
}

/**
 * addMemberToGroup (ZR:1699-1828) tự ném các câu này sau khi ĐỌC group / link, trước khi thêm: bản cũ ghi "thất bại" theo chính sách
 * lỗi Zalo không mã (createZaloErrorDetail), không phải "không rõ đã tới".
 */
const ADD_MEMBER_LOCAL_FAILURE = /^(?:Group Zalo không hợp lệ|UID thành viên Zalo không hợp lệ|Không lấy được link group Zalo|Link group Zalo chưa được bật)$/
/**
 * Lỗi đọc từ Zalo (tra số, hồ sơ, tag, trạng thái kết bạn, danh sách bạn bè / đề xuất / lời mời): pha theo thao tác đọc. Lỗi của bước
 * chuẩn bị (kể cả Zalo từ chối lúc đăng nhập lại bằng phiên) không phải câu trả lời cho lệnh đọc: chưa gọi tới lệnh đó.
 */
function readFailure(error: unknown): Error {
  return preCallFailure(error) ?? zaloPortErrorFrom(error, { operation: 'read', answered: zaloAnswered(error) })
}

function addMemberFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message.trim() : ''
  if (!zaloAnswered(error) && ADD_MEMBER_LOCAL_FAILURE.test(message)) return zaloPortErrorFrom(error, { phase: 'after_send' })
  return sendFailure(error)
}

/** Cổng Desktop: cổng Zalo của lõi + dọn tài nguyên giữ theo data (ngữ cảnh tag Zalo, tệp media tải tạm). */
export interface DesktopZaloPort extends ZaloCampaignPort {
  releaseTarget(targetRunId: number): void
}

export function createDesktopZaloPort(host: DesktopZaloPortHost): DesktopZaloPort {
  // Như getSendExclusionLabels: một ngữ cảnh tag mỗi data (getLabels một lần, dùng chung với cổng loại trừ gửi), bỏ khi data xong.
  const labelContexts = new Map<number, CampaignLabelContext>()
  // Như mediaTempPaths của executeCampaignV2 (CS:4412, xoá ở finally CS:5017): tệp tải từ URL về máy, xoá khi data xong.
  const mediaTempPaths = new Map<number, string[]>()
  const send = async (uid: string, message: ZaloOutgoingText, files: readonly string[], campaignMedia: boolean,
    threadType: 'user' | 'group' = 'user') => {
    try {
      // { msg, styles } của lõi có cùng dạng Style của zca-js (giá trị TextStyle giống hệt, src/shared/zaloFormattedContent.ts).
      // Nhóm: sendMessageToGroup như dispatchZaloMessage(isGroup=true), ID group giữ nguyên như Desktop gửi thường.
      const response = threadType === 'group'
        ? await host.zaloRuntime.sendMessageToGroup(host.accountId, uid, message as RuntimeOutgoingText, [...files], campaignMedia)
        : await host.zaloRuntime.sendMessageToUser(host.accountId, uid, message as RuntimeOutgoingText, [...files], campaignMedia)
      return { response, msgId: engagementMessageIds(response)[0] ?? null }
    } catch (error) {
      throw sendFailure(error)
    }
  }
  const materialize = (ctx: MaterializeContext, operation: 'state' | 'clear' | 'insert' | 'hold', payload: Record<string, unknown>) =>
    engineMaterialize(host.accountId, ctx.leaseToken, operation, payload, { signal: ctx.signal, timeoutMs: host.callTimeoutMs })
  const labelContextOf = (targetRunId: number): CampaignLabelContext => {
    let context = labelContexts.get(targetRunId)
    if (!context) {
      context = host.zaloRuntime.createCampaignLabelContext(host.accountId)
      labelContexts.set(targetRunId, context)
    }
    return context
  }
  return {
    findUser: async (ctx, phone, reqSrc) => {
      try {
        return await host.zaloRuntime.findUserByPhoneOnce(host.accountId, phone, reqSrc, ctx.signal)
      } catch (error) {
        throw readFailure(error)
      }
    },
    // Như resolveZaloPhoneSearchLimitScope: không đọc được chính sách thì coi như không có giới hạn tra số.
    phoneSearchLimitScope: async (code): Promise<PhoneSearchLimitScope | null> => {
      try {
        return phoneSearchLimitScope(await getZaloErrorPolicyByCode(code, 'zalo_find_phone_user'))
      } catch (error) {
        host.trace({ type: 'phone_search_limit_policy_failed', code, error: error instanceof Error ? error.message : String(error) })
        return null
      }
    },
    // Như resolveZaloFriendMessageTarget: api.getUserInfo theo UID (bỏ hậu tố _0); lỗi là lỗi đọc, lõi giữ mục tiêu từ data.
    getUserProfile: async (_ctx, uid) => {
      try {
        return await host.zaloRuntime.getUserProfile(host.accountId, uid)
      } catch (error) {
        throw readFailure(error)
      }
    },
    saveResolvedProfile: (_ctx, target) => host.saveResolvedProfile(target),
    saveFoundUser: async (ctx, target, user) => {
      await host.saveContact(user)
      const inputDataId = Number(ctx.target.id)
      if (Number.isFinite(inputDataId) && inputDataId > 0) {
        const name = target.displayName || target.originalName || ''
        await updateCampaignInputData(inputDataId, { name: name || undefined, uid: target.uid })
      }
    },
    isOptedOut: async (_ctx, identity) =>
      (await checkZaloMessageOptOut(host.campaignId, host.accountId, identity)).isOptedOut,
    // Như prepareZaloMessageOptOutLink: RPC aka_agent_prepare_zalo_message_opt_out (lỗi kèm câu "Không thể tạo link từ chối nhận tin Zalo: …").
    prepareOptOutLink: (_ctx, identity) => prepareZaloMessageOptOut(host.campaignId, host.accountId, identity),
    takeContentIndex: (ctx, actionCode, count) =>
      takeEngineContentIndex(ctx.targetRunId, ctx.leaseToken, actionCode, count, { signal: ctx.signal, timeoutMs: host.callTimeoutMs }),
    businessNow: () => host.businessNow(),
    sendText: async (_ctx, uid, message, threadType) => send(uid, message, [], false, threadType ?? 'user'),
    rewriteMessage: (ctx, content) => host.rewriteMessage(Number(ctx.target.id) || null, content),
    // Như resolveMediaSelection: từng tệp lần lượt (đường dẫn còn trên máy, data:, hoặc tải cloud URL 60 giây/tệp).
    prepareMedia: async (ctx, items) => {
      const temp = mediaTempPaths.get(ctx.targetRunId) ?? []
      mediaTempPaths.set(ctx.targetRunId, temp)
      const files = []
      for (const item of items) {
        try {
          files.push({ name: campaignMediaName(item), ref: await resolveCampaignMediaSource(item as CampaignMediaInput, temp) })
        } catch (error) {
          if (isCampaignMediaResolveError(error)) throw mediaUnavailableError(error.message)
          throw error
        }
      }
      return files
    },
    sendMedia: async (_ctx, input) =>
      // campaignMedia = true như dispatchZaloMessage: tệp đi qua hàng rào media (huỷ yêu cầu dở khi quá giờ).
      send(input.threadId, input.message ?? '', input.files.map(file => String(file.ref)), true, input.threadType),
    // Gửi dạng chia sẻ: như processZaloShareMessageBatch, một lệnh mforward cho cả lô (forwardMessageToUsers / Groups, tự cắt 90 giây; người
    // nhận là chính tài khoản trả 114 tại chỗ). Lỗi cả lệnh là lỗi thao tác gửi; kết quả từng người trả nguyên để lõi chốt.
    // Theo dõi tương tác: đúng các hàm của bộ chạy cũ (zaloCampaignEngagement): giữ chỗ trước khi gửi (giờ gửi theo đồng hồ DB), giữ
    // nguồn để khôi phục ngay trước khi báo kết quả (như trước INSERT dòng lịch sử), đăng ký sau khi có dòng lịch sử, bỏ giữ chỗ khi lỗi.
    engagementBegin: (_ctx, targetUid) => {
      const send = beginCampaignEngagementSend({ id: host.accountId,
        zaloUid: host.zaloRuntime.getCachedOwnUid?.(host.accountId) || host.account.zaloUid, isZaloShowWeb: host.account.isZaloShowWeb }, targetUid)
      return send.revision ? send : null
    },
    engagementAbandon: (_ctx, send) => abandonCampaignEngagementSend(send.operationId),
    engagementStage: (_ctx, source) => stageCampaignEngagementSource(source, host.campaignId, true),
    engagementRegister: (detailId, source) => recordCampaignEngagementDetail(detailId, source),
    // Đồng bộ trạng thái tin nhắn Zalo (độc lập với theo dõi tương tác): cùng hàm với bộ chạy cũ, dấu tham chiếu ghi vào dòng lịch sử
    // của lượt gửi thành công. Tính năng tắt, tài khoản trình duyệt hay thiếu UID thì không ghi gì.
    messageStatusBegin: (_ctx, targetUid, actionType) => {
      const send = beginZaloMessageStatusSend({ id: host.accountId, zaloUid: host.account.zaloUid, isZaloShowWeb: host.account.isZaloShowWeb,
        organizationId: host.account.organizationId }, host.zaloRuntime.getCachedOwnUid?.(host.accountId), targetUid, actionType)
      return send
    },
    forwardMessage: async (_ctx, input) => {
      try {
        const result = input.threadType === 'group'
          ? await host.zaloRuntime.forwardMessageToGroups(host.accountId, [...input.threadIds], input.message as RuntimeOutgoingText)
          : await host.zaloRuntime.forwardMessageToUsers(host.accountId, [...input.threadIds], input.message as RuntimeOutgoingText)
        return {
          response: result.response,
          results: result.results.map(row => ({ threadId: String(row.threadId), ok: row.ok === true, errorCode: row.errorCode ?? null,
            errorMessage: row.errorMessage ?? null, raw: row.raw ?? null, engagementMapped: row.engagementMapped === true }))
        }
      } catch (error) {
        throw sendFailure(error)
      }
    },
    // Như zaloAddGroupMember: đọc group, rồi gửi link group / mời (cộng đồng) / thêm trực tiếp (zaloRuntimeService.addMemberToGroup).
    addGroupMember: async (_ctx, input) => {
      try {
        const result = await host.zaloRuntime.addMemberToGroup(host.accountId, input)
        return {
          groupId: result.groupId, groupName: result.groupName ?? null, groupType: result.groupType ?? null, mode: result.mode,
          outcome: result.outcome, message: result.message, groupLink: result.groupLink ?? null, response: result.response
        }
      } catch (error) {
        throw addMemberFailure(error)
      }
    },
    // Như zaloJoinGroupLink: getGroupLinkInfo rồi joinGroupLink (178 đã tham gia, 240 chờ duyệt) của zaloRuntimeService.
    joinGroupByLink: async (_ctx, link) => {
      try {
        const result = await host.zaloRuntime.joinGroupByLink(host.accountId, link)
        return { link: result.link, group: result.group, groupId: result.groupId, groupName: result.groupName ?? null, outcome: result.outcome,
          response: result.response, zaloCode: result.zaloCode ?? null, zaloMessage: result.zaloMessage ?? null }
      } catch (error) {
        throw sendFailure(error)
      }
    },
    saveJoinedGroup: (_ctx, result, isJoined) => host.saveJoinedGroup(result, isJoined),
    sendFriendRequest: async (_ctx, uid, message) => {
      try {
        return await host.zaloRuntime.sendFriendRequestToUser(host.accountId, uid, message)
      } catch (error) {
        throw sendFailure(error)
      }
    },
    // Thao tác phụ (docs/engine-v2-specs/zalo-aux-actions.md §10.5).
    friendStatus: async (_ctx, uid) => {
      try {
        return readZaloApiFriendStatus((await host.zaloRuntime.getFriendRequestStatus(host.accountId, uid)).raw)
      } catch {
        return null
      }
    },
    applyLabel: async (ctx, uid, labelId, skipLabelIds) => {
      const context = labelContextOf(ctx.targetRunId)
      try {
        const result = await host.zaloRuntime.applyLabelToUser(host.accountId, uid, labelId, [...skipLabelIds], context)
        if (isZaloLabelSkipResult(result)) return { kind: 'excluded', matchedLabelNames: result.matchedLabelNames }
        const text = (result as { text?: unknown } | null)?.text
        return { kind: 'applied', labelText: typeof text === 'string' && text ? text : null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('Tag Zalo không tồn tại')) return { kind: 'label_not_found', message }
        throw sendFailure(error)
      }
    },
    // Loại trừ gửi (gateSendExclusion): cấu hình / dữ kiện DB qua RPC V504; tag Zalo từ ngữ cảnh tag của data (getSendExclusionLabels,
    // dùng chung với gắn tag), trạng thái kết bạn như getFriendRequestStatus của bộ cũ. Lỗi Zalo là lỗi đọc (chưa gửi gì).
    sendExclusionSnapshot: ctx => engineSendExclusion(ctx.targetRunId, ctx.leaseToken, 'snapshot', {},
      { signal: ctx.signal, timeoutMs: host.callTimeoutMs }),
    sendExclusionFacts: (ctx, payload) => engineSendExclusion(ctx.targetRunId, ctx.leaseToken, 'facts', { ...payload },
      { signal: ctx.signal, timeoutMs: host.callTimeoutMs }),
    // Danh sách không gửi tin kiểu cũ (getZaloFriendBlocklistUidSnapshot của bộ cũ) qua RPC V504.
    friendBlocklist: ctx => engineSendExclusion(ctx.targetRunId, ctx.leaseToken, 'friend_blocklist', {},
      { signal: ctx.signal, timeoutMs: host.callTimeoutMs }),
    labelMembership: async (_ctx, contextRunId, uid) => {
      try {
        return await labelContextOf(contextRunId).ids(uid)
      } catch (error) {
        throw readFailure(error)
      }
    },
    friendRequestStatus: async (_ctx, uid) => {
      try {
        return (await host.zaloRuntime.getFriendRequestStatus(host.accountId, uid)).raw
      } catch (error) {
        throw readFailure(error)
      }
    },
    mirrorLabel: async (_ctx, uid, label) => {
      await appendZaloTagsToExistingContacts(host.accountId, 'person', [uid], [{ id: label.id, name: label.name }])
    },
    changeAlias: async (_ctx, uid, alias) => {
      try {
        return await host.zaloRuntime.changeUserAlias(host.accountId, uid, alias)
      } catch (error) {
        throw sendFailure(error)
      }
    },
    applyAkaBizTags: async (_ctx, contactType, uid, tagIds) => {
      // Như applyAkaBizTagsToZaloTarget (CS:8145-8152): nhóm thử cả UID có và không có tiền tố "g".
      const uids = contactType === 'group' ? [...new Set([uid, uid.replace(/^g/i, '')])] : [uid]
      const result = await applyAkaBizTagsToContactTargets(uids.map(item => ({ accountId: host.accountId, contactType, uid: item })), [...tagIds])
      return result.count
    },
    // Lấy data đầu lượt (V505) và đọc danh sách như materializeZalo*InputData của bộ lập lịch.
    materializeState: async ctx => materializeStateFrom(await materialize(ctx, 'state', {})),
    materializeClear: async ctx => ({ cleared: Number((await materialize(ctx, 'clear', {})).cleared) || 0 }),
    materializeInsert: async (ctx, rows, opts) =>
      ({ inserted: Number((await materialize(ctx, 'insert', { rows, ...(opts.vnDate ? { vnDate: opts.vnDate } : {}) })).inserted) || 0 }),
    materializeHold: async (ctx, hold) => { await materialize(ctx, 'hold', { ...hold }) },
    getAllFriendsPage: async (_ctx, count, page) => {
      try {
        return await host.zaloRuntime.getAllFriendsPage(host.accountId, count, page)
      } catch (error) {
        throw readFailure(error)
      }
    },
    // Như materializeZaloFriendInputData (tagged): một lần listLabels, từng tag phải là số dương và còn trong danh sách.
    friendTagConversations: async (_ctx, tagIds) => {
      let labels: Awaited<ReturnType<ZaloRuntimeService['listLabels']>>
      try {
        labels = await host.zaloRuntime.listLabels(host.accountId)
      } catch (error) {
        throw readFailure(error)
      }
      const uids: string[] = []
      for (const tagId of tagIds) {
        const id = Number(tagId)
        if (!Number.isFinite(id) || id <= 0) throw new ZaloSourceTagError('Tag Zalo không hợp lệ')
        const label = labels.find(item => Number(item.id) === id)
        if (!label) throw new ZaloSourceTagError('Tag Zalo không tồn tại')
        uids.push(...(label.conversations || []))
      }
      return uids
    },
    getFriendRecommendations: async () => {
      try {
        return await host.zaloRuntime.getFriendRecommendations(host.accountId)
      } catch (error) {
        throw readFailure(error)
      }
    },
    getSentFriendRequests: async () => {
      try {
        return await host.zaloRuntime.getSentFriendRequests(host.accountId)
      } catch (error) {
        throw readFailure(error)
      }
    },
    saveFriendContacts: (_ctx, raws, source) => host.saveFriendContacts(raws, source),
    // Kiêm SMS: nội bộ qua RPC V506; akaBiz Sms bằng đúng code của bộ lập lịch.
    pushInternalSms: (ctx, input) => engineSmsPush(ctx.targetRunId, ctx.leaseToken, { accountIds: input.accountIds, row: input.row, content: input.content },
      { signal: ctx.signal, timeoutMs: host.callTimeoutMs }),
    pushExternalSms: (_ctx, input) => host.pushExternalSms(input),
    smsBusinessNow: () => host.businessNow(),
    undoFriendRequest: async (_ctx, uid) => {
      try {
        return await host.zaloRuntime.undoFriendRequest(host.accountId, uid)
      } catch (error) {
        throw sendFailure(error)
      }
    },
    releaseTarget: targetRunId => {
      labelContexts.delete(targetRunId)
      const temp = mediaTempPaths.get(targetRunId)
      mediaTempPaths.delete(targetRunId)
      if (temp) cleanupCampaignMediaTempFiles(temp)
    },
    trace: event => host.trace(event)
  }
}
