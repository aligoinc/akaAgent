/**
 * Bộ chạy engine v2 trên Desktop (bản cài mới). Chỉ tài khoản Zalo QR/Web của chính máy này; Zalo Server không chạy ở
 * đây (VPS giữ bộ cũ, Fly chạy bộ mới theo cờ tổ chức). Loại chiến dịch đã tách sang lõi và không dùng tính năng
 * chưa tách thì chạy bằng bộ mới; còn lại bộ lập lịch chạy bộ cũ như trước, trong cùng bản cài.
 *
 * Mỗi tài khoản một lượt tại một thời điểm (bộ lập lịch đã giữ chỗ tài khoản trong hàng đợi). Dòng tiến trình ghi
 * tuần tự đúng thứ tự lõi phát ra. Yêu cầu tạm dừng còn trong RAM (DB trả runtime_busy cho chiến dịch đang chạy)
 * được hoàn tất sau data đang xử lý, như bộ cũ.
 */
import { randomUUID } from 'node:crypto'
import type { AutoAccount, Campaign } from '../../shared/types'
import type { ZaloRuntimeService } from '../services/zaloRuntimeService'
import { campaignEngagementEnabled } from '../services/zaloCampaignEngagement'
import {
  DEFAULT_RETRY, advancedContentItems, hasDeclaredMediaSource, runUnit, sleepBetweenActionsSeconds, systemClock, zaloCampaignType,
  zaloCampaignV2Support, type UnitResult, type V2Support, type ZaloCampaign, type ZaloFoundUser, type ZaloJoinGroupLinkResult, type ZaloResolvedTarget
} from '../../../packages/campaign-engine/src/index'
import { desktopEngineData, finishEngineCampaign } from './desktopEngineData'
import { SqliteEngineJournal } from './desktopEngineJournal'
import { createDesktopZaloPort } from './desktopZaloPort'

/** Lời gọi Zalo dài nhất của một bước: gửi chữ 90 giây (zaloRuntimeService), tra số tối đa 2 lần. */
const STEP_TIMEOUT_MS = 150_000
/**
 * Bước gửi khi chiến dịch có tệp: tải lần lượt từng tệp cloud (60 giây/tệp, resolveCampaignMediaSource) + gửi tệp 180 giây
 * (tệp cần chờ WebSocket) + gửi chữ 90 giây + làm mới listener 20 giây, cộng dư 40 giây. Tải chậm báo "chưa gửi" trước hạn này.
 */
function mediaStepTimeoutMs(campaign: ZaloCampaign): number {
  const declared = campaign.extraSettings.advancedContentEnabled === true
    ? Math.max(0, ...advancedContentItems(campaign.extraSettings).map(item => item.mediaItems.filter(hasDeclaredMediaSource).length))
    : (Array.isArray(campaign.images) ? campaign.images : []).filter(hasDeclaredMediaSource).length
  return 60_000 * Math.max(1, declared) + 330_000
}
const HEARTBEAT_MS = 60_000
/** AI viết lại: ai_using.timeout_ms của production tới 300 giây (docs/DESKTOP_AI_PROXY.md). */
const AI_REWRITE_TIMEOUT_MS = 300_000
const DRAIN_TIMEOUT_MS = 10_000

export interface DesktopEngineHost {
  zaloRuntime(): ZaloRuntimeService | undefined
  staffId(): number | null
  /** Tổ chức của phiên bật cờ engine v2 (V513, chốt lúc đăng nhập); false thì mọi chiến dịch chạy bộ cũ. */
  engineEnabled(): boolean
  /** Chặn bộ mới khi chế độ chạy Zalo đang đổi (cần khởi động lại app) như bộ cũ. */
  zaloRuntimeBlocked(): boolean
  /** Bộ lập lịch đã ngừng nhận việc (đăng xuất, đổi chế độ chạy…): dừng sau data đang xử lý. */
  acceptingWork(): boolean
  logProgress(campaign: Campaign, text: string): Promise<void>
  broadcastCampaign(campaignId: number): Promise<void>
  broadcastAccounts(): void
  isPauseRequested(campaignId: number): boolean
  /** Hoàn tất tạm dừng sau khi đã nhả chiến dịch (completeReleasedDesktopCampaignPause). */
  completeReleasedPause(campaign: Campaign): Promise<void>
  saveContact(account: AutoAccount, campaign: Campaign, user: ZaloFoundUser): Promise<void>
  /** Lưu hồ sơ đọc theo UID vào danh bạ, nguồn = loại chiến dịch (upsertZaloResolvedProfileTarget). */
  saveResolvedProfile(account: AutoAccount, campaign: Campaign, target: ZaloResolvedTarget): Promise<void>
  /** Lưu danh bạ group sau khi tham gia bằng link (upsertZaloJoinGroupLinkContact). */
  saveJoinedGroup(account: AutoAccount, result: ZaloJoinGroupLinkResult, isJoined: boolean): Promise<void>
  /** Lưu danh bạ bạn bè đọc khi lấy data đầu lượt, nguồn = loại chiến dịch (mapZaloApiRawUserContact + upsertZaloApiUserContacts). */
  saveFriendContacts(account: AutoAccount, raws: readonly Record<string, unknown>[], source: string): Promise<void>
  /** Kiêm SMS sang akaBiz Sms của chiến dịch (pushZaloDetailToExternalSmsIfNeeded: tích hợp akaBiz + addSmsCampaignDetail từng shop). */
  pushExternalSms(campaign: Campaign, input: { shopIds: readonly number[]; phone: string; name: string; content: string }):
    Promise<{ integrationMissing?: boolean; integrationError?: string | null; results: Array<{ shopId: number; ok: boolean; error?: string | null }> }>
  businessNow(): Promise<Date>
  /** Chiến dịch chưa có data nào mà có chiến dịch tìm data bơm vào: câu chờ (getFindDataSourceWaitNote), không thì null. */
  findDataSourceWaitNote(campaign: Campaign): Promise<string | null>
  /** Giữ chiến dịch "chờ xử lý" kèm câu chờ, báo "Chưa thể chạy chiến dịch" khi câu đổi (như bộ cũ). */
  noteCampaignWait(campaign: Campaign, note: string): Promise<void>
  /** AI viết lại nội dung (rewriteZaloMessageForRun của bộ cũ); ném lỗi kèm câu khi không dùng được. */
  rewriteMessage(account: AutoAccount, campaign: Campaign, inputDataId: number | null, content: string): Promise<string>
}

function toCoreCampaign(campaign: Campaign): ZaloCampaign {
  return {
    id: campaign.id,
    actionId: campaign.actionId,
    accountId: campaign.accountId,
    content: campaign.content ?? '',
    extraSettings: (campaign.extraSettings ?? {}) as Record<string, unknown>,
    images: (campaign.images ?? []) as readonly unknown[],
    dataTargetSourceMode: campaign.dataTargetSourceMode ?? null
  }
}

function formatVietnamTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false
  }).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}`
}

export class DesktopEngineRunner {
  private readonly runs = new Map<number, AbortController>()
  /** Một mã cho tiến trình app này: lease của lần chạy trước (app đã tắt) tự hết hạn, không bị nhận nhầm. */
  private readonly runnerId = `desktop:${randomUUID()}`

  constructor(private readonly host: DesktopEngineHost) {}

  /** Chiến dịch có chạy bằng bộ mới ở bản cài này không. */
  support(account: AutoAccount, campaign: Campaign): V2Support {
    // Công tắc theo tổ chức (V513): cờ tắt, chưa đọc được hay DB chưa có hàm thì chạy bộ cũ như bản chưa có engine v2.
    // Cờ chốt lúc đăng nhập, nên không đổi bộ chạy giữa lúc chiến dịch đang chạy dở.
    if (!this.host.engineEnabled()) return { ok: false, reason: 'org_flag_off' }
    if (String(account.flatformType || '').trim().toLowerCase() !== 'zalo' || account.isZaloServer === true) {
      return { ok: false, reason: 'runtime' }
    }
    if (campaign.accountId !== account.id) return { ok: false, reason: 'account_mismatch' }
    // Như bộ cũ: tài khoản Zalo chạy bằng trình duyệt không chạy được group thời gian thực (bộ cũ báo câu "không hỗ trợ").
    if (campaign.actionId === 'zalo_message_group_realtime' && account.isZaloShowWeb === true) return { ok: false, reason: 'realtime_zalo_web' }
    // Desktop có tích hợp akaBiz Sms nên kiêm SMS cả hai kiểu.
    // Cổng Desktop ghi nguồn tương tác như bộ cũ (engagementSupported) nên chiến dịch nhắn tin vẫn chạy bộ mới khi theo dõi tương tác bật.
    return zaloCampaignV2Support(toCoreCampaign(campaign), { engagementTrackingEnabled: campaignEngagementEnabled(), engagementSupported: true,
      externalSmsPush: true })
  }

  get activeCount(): number {
    return this.runs.size
  }

  /** Dừng ngay mọi lượt (thoát app, đăng xuất): lõi báo "đã dừng" cho bước sắp chạy, nhật ký giữ kết quả chưa gửi. */
  abortAll(): void {
    for (const controller of this.runs.values()) controller.abort()
  }

  async run(account: AutoAccount, campaign: Campaign): Promise<UnitResult | null> {
    const zaloRuntime = this.host.zaloRuntime()
    const staffId = this.host.staffId()
    if (!zaloRuntime || !staffId || this.host.zaloRuntimeBlocked() || this.runs.has(account.id)) return null

    const controller = new AbortController()
    this.runs.set(account.id, controller)
    let progress: Promise<void> = Promise.resolve()
    const log = (text: string): void => {
      progress = progress.then(() => this.host.logProgress(campaign, text)).catch(error => {
        console.error('[CampaignEngine] failed to log progress', { campaignId: campaign.id, error })
      })
    }
    const trace = (event: { type: string; [key: string]: unknown }): void => {
      if (event.type === 'unit_started') {
        // Chiến dịch và tài khoản vừa chuyển "đang chạy": báo giao diện như bộ cũ sau khi nhận lượt.
        progress = progress.then(async () => {
          await this.host.broadcastCampaign(campaign.id)
          this.host.broadcastAccounts()
        }).catch(() => undefined)
        return
      }
      if (/failed|error|lost|rejected|refused/.test(event.type)) console.warn('[CampaignEngine]', { campaignId: campaign.id, accountId: account.id, ...event })
    }

    const core = toCoreCampaign(campaign)
    const type = zaloCampaignType(core.actionId)
    if (!type) return null
    const port = createDesktopZaloPort({
      zaloRuntime, accountId: account.id, campaignId: campaign.id,
      account: { zaloUid: account.zaloUid ?? null, isZaloShowWeb: account.isZaloShowWeb ?? null },
      saveContact: user => this.host.saveContact(account, campaign, user),
      saveResolvedProfile: target => this.host.saveResolvedProfile(account, campaign, target),
      saveJoinedGroup: (result, isJoined) => this.host.saveJoinedGroup(account, result, isJoined),
      saveFriendContacts: (raws, source) => this.host.saveFriendContacts(account, raws, source),
      pushExternalSms: input => this.host.pushExternalSms(campaign, input),
      rewriteMessage: (inputDataId, content) => this.host.rewriteMessage(account, campaign, inputDataId, content),
      businessNow: () => this.host.businessNow(),
      callTimeoutMs: DEFAULT_RETRY.callTimeoutMs,
      trace
    })
    const sleepSeconds = sleepBetweenActionsSeconds(account.accountGroupSettings?.sleepBetweenActions, core.extraSettings.actionLimits)
    // Gửi dạng chia sẻ (bạn bè / group): chạy theo lô (V503), nghỉ giữa hai lô như getEffectiveSleepBetweenActions.
    const batch = type.buildBatch?.(core, port, { sleepBetweenBatchesSeconds: sleepSeconds, aiRewriteTimeoutMs: AI_REWRITE_TIMEOUT_MS,
      mediaTimeoutMs: mediaStepTimeoutMs(core), sendTimeoutMs: STEP_TIMEOUT_MS }) ?? null
    // Lấy data đầu lượt (bạn bè "toàn bộ / theo tag", sinh nhật, đề xuất, huỷ lời mời; V505); loại khác không có.
    const prepareTargets = type.prepareTargets?.(core, port, { campaignName: campaign.name, campaignNote: campaign.note ?? null,
      callTimeoutMs: DEFAULT_RETRY.callTimeoutMs }) ?? null
    // Kiêm SMS sau mỗi dòng lịch sử (theo SĐT, thành viên nhóm); loại khác không có.
    const afterReport = type.afterReport?.(core, port, { targetLabel: type.targetLabel }) ?? null
    let result: UnitResult | null = null
    try {
      result = await runUnit({
        data: desktopEngineData,
        journal: new SqliteEngineJournal(`${staffId}:${account.id}`),
        clock: systemClock,
        events: { progress: line => log(line.text), trace }
      }, {
        runnerId: this.runnerId,
        runtimeTarget: 'desktop',
        staffId,
        accountId: account.id,
        campaignId: campaign.id,
        actionId: campaign.actionId,
        campaignName: campaign.name,
        accountName: account.name,
        campaignNote: campaign.note ?? null,
        targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code,
        ...type.claimPlan(core),
        buildSteps: () => type.buildSteps(core, port, { account: { id: account.id, name: account.name }, mediaStepTimeoutMs: mediaStepTimeoutMs(core),
          textStepTimeoutMs: STEP_TIMEOUT_MS, aiRewriteTimeoutMs: AI_REWRITE_TIMEOUT_MS }),
        // Luật kiểm đầu lượt của loại chiến dịch (đã duyệt): CFG16 nội dung nâng cao, CFG10 Zalo Web chỉ gửi ảnh.
        validateCampaign: () => type.validate?.(core, { zaloWeb: account.isZaloShowWeb === true }) ?? [],
        onTargetEnd: async info => port.releaseTarget(info.targetRunId),
        pacing: { fullSeconds: sleepSeconds },
        ...(batch ? { batch } : {}),
        ...(prepareTargets ? { prepareTargets } : {}),
        ...(afterReport ? { afterReport } : {}),
        stepTimeoutMs: STEP_TIMEOUT_MS,
        heartbeatMs: HEARTBEAT_MS,
        retry: DEFAULT_RETRY,
        drainTimeoutMs: DRAIN_TIMEOUT_MS,
        onNoTarget: async (info, signal) => {
          // Như bộ cũ: chiến dịch chưa có data nào mà đang có nguồn tìm data thì chờ, không tự hoàn thành.
          if (!info.hasTargets) {
            const waitNote = await this.host.findDataSourceWaitNote(campaign)
            if (waitNote) {
              await this.host.noteCampaignWait(campaign, waitNote)
              return { reason: 'waiting_linked_source' }
            }
          }
          // note: câu hoàn thành của bước lấy data đầu lượt (không có sinh nhật / đề xuất / lời mời…), như complete*WithoutTargets.
          return { ...await finishEngineCampaign(account.id, info.leaseToken, info.note ?? null, { signal, timeoutMs: DEFAULT_RETRY.callTimeoutMs }) }
        },
        formatTime: formatVietnamTime,
        shouldStopAfterTarget: () => !this.host.acceptingWork() || this.host.isPauseRequested(campaign.id)
      }, controller.signal)
      return result
    } finally {
      this.runs.delete(account.id)
      await progress
      if (result && this.host.isPauseRequested(campaign.id)) {
        await this.host.completeReleasedPause(campaign).catch(error => {
          console.error('[CampaignEngine] failed to complete pause', { campaignId: campaign.id, error })
        })
      }
      await this.host.broadcastCampaign(campaign.id).catch(() => undefined)
      this.host.broadcastAccounts()
      if (result) console.info('[CampaignEngine] unit ended', { campaignId: campaign.id, accountId: account.id, reason: result.reason, targets: result.targets })
    }
  }
}
