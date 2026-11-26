/**
 * Bộ chạy engine v2 dùng chung cho Desktop và App Server (VPS), cùng bộ lập lịch và cùng cổng Zalo (zaloRuntimeService).
 *   - Desktop (nơi chạy 'desktop'): tài khoản Zalo QR/Web của chính máy này, Facebook, Website; bật theo cờ tổ chức của phiên (V513).
 *   - App Server (nơi chạy 'server', V667): chỉ tài khoản Zalo Server, tổ chức bật engine.zalo_server_vps (serverEngineGate). Tổ chức
 *     chạy Server trên Fly (cờ use_new_zalo_runtime) do Fly chạy, App Server không giữ.
 * Loại chiến dịch đã tách sang lõi và không dùng tính năng chưa tách thì chạy bằng bộ mới; còn lại bộ lập lịch chạy bộ cũ như trước,
 * trong cùng bản cài.
 *
 * Mỗi tài khoản một lượt tại một thời điểm ở mỗi làn (bộ lập lịch đã giữ chỗ tài khoản trong hàng đợi của làn). Làn chính là
 * mọi chiến dịch như trước; chiến dịch có tích "Chạy cùng lúc" (V670) mà loại được akaBiz bật chạy ở làn riêng của loại, cạnh làn
 * chính, với nhật ký khôi phục riêng của làn. Dòng tiến trình ghi tuần tự đúng thứ tự lõi phát ra. Yêu cầu tạm dừng còn trong RAM
 * (DB trả runtime_busy cho chiến dịch đang chạy) được hoàn tất sau data đang xử lý, như bộ cũ.
 */
import { randomUUID } from 'node:crypto'
import type { AutoAccount, Campaign } from '../../shared/types'
import { monotonicNow } from '../../shared/monotonicNow'
import type { ZaloRuntimeService } from '../services/zaloRuntimeService'
import { campaignEngagementEnabled } from '../services/zaloCampaignEngagement'
import {
  DEFAULT_RETRY, PARALLEL_RUN_MAIN_LANE, advancedContentItems, hasDeclaredMediaSource, runUnit, sleepBetweenActionsSeconds, systemClock, zaloCampaignType,
  zaloCampaignV2Support, type UnitResult, type V2Support, type ZaloCampaign, type ZaloFoundUser, type ZaloJoinGroupLinkResult, type ZaloResolvedTarget
} from '../../../packages/campaign-engine/src/index'
import { desktopEngineData, finishEngineCampaign } from './desktopEngineData'
import { SqliteEngineJournal } from './desktopEngineJournal'
import { createDesktopZaloPort } from './desktopZaloPort'
import { facebookEngineSupport, facebookUnitConfig, type DesktopFacebookHost, type FacebookUnitSession } from './facebook/desktopFacebookRunner'
import { isWebAccount, webEngineSupport, webUnitConfig, type DesktopWebHost, type WebUnitSession } from './web/desktopWebRunner'

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
/** App Server: claim trả not_enabled (công tắc engine.zalo_server_vps vừa tắt) thì chiến dịch chạy bộ cũ ngần này rồi xét lại (anh chốt 26/11). */
const SERVER_NOT_ENABLED_RETRY_MS = 5 * 60_000
/** AI viết lại: ai_using.timeout_ms của production tới 300 giây (docs/DESKTOP_AI_PROXY.md). */
const AI_REWRITE_TIMEOUT_MS = 300_000
const DRAIN_TIMEOUT_MS = 10_000

export interface DesktopEngineHost {
  zaloRuntime(): ZaloRuntimeService | undefined
  staffId(): number | null
  /** Tổ chức của phiên bật cờ engine v2 (V513, chốt lúc đăng nhập); false thì mọi chiến dịch chạy bộ cũ. Chỉ Desktop dùng. */
  engineEnabled(): boolean
  /** App Server (nơi chạy 'server', V667): công tắc engine.zalo_server_vps của tổ chức. Không có thì coi như tắt. */
  serverEngineState?(organizationId: number | null): 'enabled' | 'disabled' | 'loading'
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
  /** Chiến dịch Facebook (V556–V558): không có thì mọi chiến dịch FB chạy bộ cũ. */
  facebook?: DesktopFacebookHost
  /** Quét data website (V618): tài khoản Website chỉ chạy bằng engine v2, không có bộ cũ. */
  web?: DesktopWebHost
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

const isFacebookAccount = (account: AutoAccount): boolean => String(account.flatformType || '').trim().toLowerCase() === 'facebook'

/** Khoá lượt đang chạy trong tiến trình: làn chính giữ khoá theo tài khoản như trước, làn riêng thêm mã loại. */
function runKey(accountId: number, lane: string): string {
  return lane === PARALLEL_RUN_MAIN_LANE ? String(accountId) : `${accountId}:${lane}`
}

/** Nhật ký khôi phục: làn chính giữ phạm vi cũ (nhân viên + tài khoản) để kết quả của bản cài trước vẫn được gửi bù. */
function journalScope(staffId: number, accountId: number, lane: string): string {
  return lane === PARALLEL_RUN_MAIN_LANE ? `${staffId}:${accountId}` : `${staffId}:${accountId}:${lane}`
}

export class DesktopEngineRunner {
  private readonly runs = new Map<string, AbortController>()
  /** Nơi chạy: 'desktop' (Desktop) hoặc 'server' (App Server trên VPS, V667). */
  private readonly target: 'desktop' | 'server'
  /** Một mã cho tiến trình app này: lease của lần chạy trước (app đã tắt) tự hết hạn, không bị nhận nhầm. */
  private readonly runnerId: string
  /** Chiến dịch FB mà claim trả not_enabled (tắt khẩn cấp engine.facebook): chạy bộ cũ tới hết phiên. */
  private readonly facebookDisabled = new Set<number>()
  /** Chiến dịch web mà claim trả not_enabled (tổ chức vừa bị tắt web_scan.campaigns): không chạy tới hết phiên. */
  private readonly webDisabled = new Set<number>()
  /** App Server: chiến dịch mà claim trả not_enabled → mốc (đồng hồ đơn điệu) được xét lại; trước đó chạy bộ cũ. */
  private readonly serverDisabledUntil = new Map<number, number>()

  constructor(private readonly host: DesktopEngineHost, options: { runtimeTarget?: 'desktop' | 'server' } = {}) {
    this.target = options.runtimeTarget ?? 'desktop'
    this.runnerId = `${this.target}:${randomUUID()}`
  }

  /** Chiến dịch có chạy bằng bộ mới ở bản cài này không. */
  support(account: AutoAccount, campaign: Campaign): V2Support {
    if (this.target === 'server') return this.serverSupport(account, campaign)
    if (isFacebookAccount(account)) return facebookEngineSupport(this.host.facebook, this.facebookDisabled, account, campaign)
    if (isWebAccount(account)) return webEngineSupport(this.host.web, this.webDisabled, account, campaign)
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

  /**
   * App Server (nơi chạy 'server', V667): chỉ tài khoản Zalo Server, tổ chức bật engine.zalo_server_vps. Công tắc chưa đọc được lần nào thì
   * 'catalog_loading' (bộ lập lịch chờ lượt quét sau, không để bộ cũ chạy chiến dịch của tổ chức đã bật); claim vừa trả not_enabled thì chạy
   * bộ cũ 5 phút rồi xét lại. Phần còn lại như Desktop: cùng cổng Zalo, theo dõi tương tác và kiêm akaBiz Sms như bộ cũ trên VPS.
   */
  private serverSupport(account: AutoAccount, campaign: Campaign): V2Support {
    if (String(account.flatformType || '').trim().toLowerCase() !== 'zalo' || account.isZaloServer !== true || account.isZaloShowWeb === true) {
      return { ok: false, reason: 'runtime' }
    }
    const state = this.host.serverEngineState?.(campaign.organizationId ?? account.organizationId ?? null) ?? 'disabled'
    if (state === 'loading') return { ok: false, reason: 'catalog_loading' }
    if (state !== 'enabled') return { ok: false, reason: 'org_flag_off' }
    const disabledUntil = this.serverDisabledUntil.get(campaign.id)
    if (disabledUntil !== undefined) {
      if (monotonicNow() < disabledUntil) return { ok: false, reason: 'org_flag_off' }
      this.serverDisabledUntil.delete(campaign.id)
    }
    if (campaign.accountId !== account.id) return { ok: false, reason: 'account_mismatch' }
    return zaloCampaignV2Support(toCoreCampaign(campaign), { engagementTrackingEnabled: campaignEngagementEnabled(), engagementSupported: true,
      externalSmsPush: true })
  }

  get activeCount(): number {
    return this.runs.size
  }

  /** Làn này của tài khoản đang có lượt chạy trong tiến trình. */
  isRunning(accountId: number, lane: string = PARALLEL_RUN_MAIN_LANE): boolean {
    return this.runs.has(runKey(accountId, lane))
  }

  /** Dừng ngay mọi lượt (thoát app, đăng xuất): lõi báo "đã dừng" cho bước sắp chạy, nhật ký giữ kết quả chưa gửi. */
  abortAll(): void {
    for (const controller of this.runs.values()) controller.abort()
  }

  /**
   * lane: làn của chiến dịch (campaignRunLane); mặc định làn chính như trước. Chỉ tài khoản Zalo có làn riêng (DB cũng chỉ cấp làn riêng cho
   * tài khoản Zalo), nên Facebook / Website luôn chạy làn chính.
   */
  async run(account: AutoAccount, campaign: Campaign, lane: string = PARALLEL_RUN_MAIN_LANE): Promise<UnitResult | null> {
    if (isFacebookAccount(account)) return lane === PARALLEL_RUN_MAIN_LANE ? this.runFacebook(account, campaign) : null
    if (isWebAccount(account)) return lane === PARALLEL_RUN_MAIN_LANE ? this.runWeb(account, campaign) : null
    const zaloRuntime = this.host.zaloRuntime()
    const staffId = this.host.staffId()
    const key = runKey(account.id, lane)
    if (!zaloRuntime || !staffId || this.host.zaloRuntimeBlocked() || this.runs.has(key)) return null

    const controller = new AbortController()
    this.runs.set(key, controller)
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
      account: { zaloUid: account.zaloUid ?? null, isZaloShowWeb: account.isZaloShowWeb ?? null, organizationId: account.organizationId ?? null },
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
        journal: new SqliteEngineJournal(journalScope(staffId, account.id, lane)),
        clock: systemClock,
        events: { progress: line => log(line.text), trace }
      }, {
        runnerId: this.runnerId,
        runtimeTarget: this.target,
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
        onNoTarget: (info, signal) => this.onNoTarget(account, campaign, info, signal),
        formatTime: formatVietnamTime,
        shouldStopAfterTarget: () => !this.host.acceptingWork() || this.host.isPauseRequested(campaign.id)
      }, controller.signal)
      // App Server: công tắc vừa tắt (claim trả not_enabled) → bộ cũ chạy chiến dịch này 5 phút rồi xét lại.
      if (this.target === 'server' && result.reason === 'not_enabled') {
        this.serverDisabledUntil.set(campaign.id, monotonicNow() + SERVER_NOT_ENABLED_RETRY_MS)
      }
      return result
    } finally {
      this.runs.delete(key)
      await progress
      if (result && this.host.isPauseRequested(campaign.id)) {
        await this.host.completeReleasedPause(campaign).catch(error => {
          console.error('[CampaignEngine] failed to complete pause', { campaignId: campaign.id, error })
        })
      }
      await this.host.broadcastCampaign(campaign.id).catch(() => undefined)
      this.host.broadcastAccounts()
      if (result) console.info('[CampaignEngine] unit ended', { campaignId: campaign.id, accountId: account.id, lane, reason: result.reason, targets: result.targets })
    }
  }

  private async onNoTarget(account: AutoAccount, campaign: Campaign, info: { leaseToken: string; hasTargets: boolean; note?: string | null },
    signal: AbortSignal): Promise<Record<string, unknown>> {
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
  }

  /**
   * Chiến dịch Facebook: lõi chạy chế độ workflow, phiên của bộ lập lịch chạy từng data (trang ẩn, biến, workflow cho engine, bộ dựng
   * dòng lịch sử của bộ cũ). Mỗi tài khoản một lượt; tạm dừng giữa data thì dừng sau mốc đang chạy (Q2).
   */
  private async runFacebook(account: AutoAccount, campaign: Campaign): Promise<UnitResult | null> {
    const facebook = this.host.facebook
    const staffId = this.host.staffId()
    const key = runKey(account.id, PARALLEL_RUN_MAIN_LANE)
    if (!facebook || !staffId || this.runs.has(key)) return null
    const controller = new AbortController()
    this.runs.set(key, controller)
    let progress: Promise<void> = Promise.resolve()
    const log = (text: string): void => {
      progress = progress.then(() => this.host.logProgress(campaign, text)).catch(error => {
        console.error('[CampaignEngine] failed to log progress', { campaignId: campaign.id, error })
      })
    }
    const trace = (event: { type: string; [key: string]: unknown }): void => {
      if (event.type === 'unit_started') {
        progress = progress.then(async () => {
          await this.host.broadcastCampaign(campaign.id)
          this.host.broadcastAccounts()
        }).catch(() => undefined)
        return
      }
      if (/failed|error|lost|rejected|refused/.test(event.type)) console.warn('[CampaignEngine]', { campaignId: campaign.id, accountId: account.id, ...event })
    }
    let session: FacebookUnitSession | null = null
    let result: UnitResult | null = null
    try {
      session = await facebook.openUnit(account, campaign, controller.signal)
      const fbConfig = await facebookUnitConfig({ host: facebook, account, campaign, signal: controller.signal }, session)
      result = await runUnit({
        data: desktopEngineData,
        journal: new SqliteEngineJournal(journalScope(staffId, account.id, PARALLEL_RUN_MAIN_LANE)),
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
        ...fbConfig,
        stepTimeoutMs: STEP_TIMEOUT_MS,
        heartbeatMs: HEARTBEAT_MS,
        retry: DEFAULT_RETRY,
        drainTimeoutMs: DRAIN_TIMEOUT_MS,
        onNoTarget: (info, signal) => this.onNoTarget(account, campaign, info, signal),
        formatTime: formatVietnamTime,
        shouldStopAfterTarget: () => !this.host.acceptingWork() || this.host.isPauseRequested(campaign.id)
      }, controller.signal)
      // Tắt khẩn cấp (engine.facebook đổi): chạy bộ cũ cho chiến dịch này tới hết phiên.
      if (result.reason === 'not_enabled') this.facebookDisabled.add(campaign.id)
      return result
    } finally {
      this.runs.delete(key)
      if (session) {
        await session.close(result).catch(error => console.error('[CampaignEngine] failed to close Facebook unit', { campaignId: campaign.id, error }))
      }
      await progress
      if (result && this.host.isPauseRequested(campaign.id)) {
        await this.host.completeReleasedPause(campaign).catch(error => {
          console.error('[CampaignEngine] failed to complete pause', { campaignId: campaign.id, error })
        })
      }
      await this.host.broadcastCampaign(campaign.id).catch(() => undefined)
      this.host.broadcastAccounts()
      if (result) console.info('[CampaignEngine] Facebook unit ended', { campaignId: campaign.id, accountId: account.id, reason: result.reason, targets: result.targets })
    }
  }

  /**
   * Chiến dịch quét data website: lõi chạy chế độ workflow, phiên của bộ lập lịch chạy từng từ khoá (trang chạy ngầm của tài khoản Website,
   * block "[engine] web_*" của DB). Mỗi tài khoản một lượt; tạm dừng giữa từ khoá thì từ khoá về hàng đợi sau lần mở trang đang chạy.
   */
  private async runWeb(account: AutoAccount, campaign: Campaign): Promise<UnitResult | null> {
    const web = this.host.web
    const staffId = this.host.staffId()
    const key = runKey(account.id, PARALLEL_RUN_MAIN_LANE)
    if (!web || !staffId || this.runs.has(key)) return null
    const controller = new AbortController()
    this.runs.set(key, controller)
    let progress: Promise<void> = Promise.resolve()
    const log = (text: string): void => {
      progress = progress.then(() => this.host.logProgress(campaign, text)).catch(error => {
        console.error('[CampaignEngine] failed to log progress', { campaignId: campaign.id, error })
      })
    }
    const trace = (event: { type: string; [key: string]: unknown }): void => {
      if (event.type === 'unit_started') {
        progress = progress.then(async () => {
          await this.host.broadcastCampaign(campaign.id)
          this.host.broadcastAccounts()
        }).catch(() => undefined)
        return
      }
      if (/failed|error|lost|rejected|refused/.test(event.type)) console.warn('[CampaignEngine]', { campaignId: campaign.id, accountId: account.id, ...event })
    }
    let session: WebUnitSession | null = null
    let result: UnitResult | null = null
    try {
      session = await web.openUnit(account, campaign, controller.signal)
      result = await runUnit({
        data: desktopEngineData,
        journal: new SqliteEngineJournal(journalScope(staffId, account.id, PARALLEL_RUN_MAIN_LANE)),
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
        ...webUnitConfig(campaign, session, web.limits()),
        stepTimeoutMs: STEP_TIMEOUT_MS,
        heartbeatMs: HEARTBEAT_MS,
        retry: DEFAULT_RETRY,
        drainTimeoutMs: DRAIN_TIMEOUT_MS,
        onNoTarget: (info, signal) => this.onNoTarget(account, campaign, info, signal),
        formatTime: formatVietnamTime,
        shouldStopAfterTarget: () => !this.host.acceptingWork() || this.host.isPauseRequested(campaign.id)
      }, controller.signal)
      if (result.reason === 'not_enabled') this.webDisabled.add(campaign.id)
      return result
    } finally {
      this.runs.delete(key)
      if (session) await session.close().catch(error => console.error('[CampaignEngine] failed to close web unit', { campaignId: campaign.id, error }))
      await progress
      if (result && this.host.isPauseRequested(campaign.id)) {
        await this.host.completeReleasedPause(campaign).catch(error => {
          console.error('[CampaignEngine] failed to complete pause', { campaignId: campaign.id, error })
        })
      }
      await this.host.broadcastCampaign(campaign.id).catch(() => undefined)
      this.host.broadcastAccounts()
      if (result) console.info('[CampaignEngine] web unit ended', { campaignId: campaign.id, accountId: account.id, reason: result.reason, targets: result.targets })
    }
  }
}
