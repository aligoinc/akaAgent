/**
 * Chiến dịch Facebook chạy bằng engine v2 trên Desktop (phương án docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_PLAN.md, cách C). Lõi giữ nhận data,
 * lease, nhật ký, dấu "sắp gửi" theo mốc và chỉ thị của DB; mỗi data / mốc lịch chạy workflow cho engine (auto_engine_workflows) từ DB
 * qua phiên do bộ lập lịch mở (openUnit), vì việc chạy một data dùng lại nguyên các bước của bộ cũ (trang ẩn, biến, nội dung, danh tính
 * Page, bộ dựng dòng lịch sử).
 *
 * Bật theo tổ chức (thiết lập engine.facebook, đọc lúc đăng nhập); claim kiểm lại mỗi lượt, tắt khẩn cấp thì claim trả not_enabled và
 * chiến dịch đó chạy bộ cũ tới hết phiên. Loại nào chạy bộ mới do hàm phủ của lõi (facebookCampaignV2Support) quyết định.
 */
import type { AutoAccount, Campaign } from '../../../shared/types'
import {
  facebookCampaignV2Support, facebookClaimPlan, facebookResultName, facebookSlotMode, facebookTargetLabel, FACEBOOK_ACTION_NAMES,
  type ConfigIssue, type FacebookCampaign, type ReportSuccess, type UnitResult, type V2Support, type WorkflowTargetApi, type WorkflowTargetEnd
} from '../../../../packages/campaign-engine/src/index'
import { cachedFacebookEngineCatalog, facebookEngineCatalogUnavailable, loadFacebookEngineCatalog } from '../../data/repositories/facebookEngineRepository'

/** Phiên của một lượt (mở trước claim đầu, đóng sau khi lượt kết thúc và đã nhả lease). */
export interface FacebookUnitSession {
  /** Lỗi cấu hình phát hiện lúc mở lượt (danh tính Page, nội dung nâng cao, thiếu workflow…): lõi báo mã và dừng lượt. */
  readonly issues: readonly ConfigIssue[]
  runTarget(api: WorkflowTargetApi): Promise<WorkflowTargetEnd>
  onTargetEnd(info: { targetRunId: number; inputDataId: number }): Promise<void>
  /** Q11: chiến dịch vừa tạm dừng theo chuỗi lỗi SYS99 thì AI đọc ảnh lỗi viết lại câu dừng (null = giữ câu của DB). */
  reviseCampaignNote?(info: { targetRunId: number; inputDataId: number; response: ReportSuccess }, signal: AbortSignal): Promise<string | null>
  /** Sau khi lượt kết thúc: khôi phục danh tính Page, tắt xem trước, nghỉ / lướt FB trước khi chờ hạn mức giờ (như bộ cũ). */
  close(result: UnitResult | null): Promise<void>
}

export interface DesktopFacebookHost {
  /** Tổ chức của phiên nằm trong engine.facebook (chốt lúc đăng nhập). */
  enabled(): boolean
  /** auto_campaign_actions.limit_check_action_codes của loại (null = mặc định Desktop). */
  limitCheckActionCodes(campaign: Campaign): Promise<string[] | null>
  /** Nghỉ giữa hai data (getEffectiveSleepBetweenActions của bộ cũ), giây. */
  sleepBetweenActionsSeconds(account: AutoAccount, campaign: Campaign): number
  openUnit(account: AutoAccount, campaign: Campaign, signal: AbortSignal): Promise<FacebookUnitSession>
}

export function toFacebookCampaign(campaign: Campaign): FacebookCampaign {
  return {
    id: campaign.id,
    actionId: campaign.actionId,
    accountId: campaign.accountId,
    extraSettings: (campaign.extraSettings ?? {}) as Record<string, unknown>,
    dataTargetSourceMode: campaign.dataTargetSourceMode ?? null
  }
}

/**
 * Chiến dịch FB có chạy bằng engine ở bản cài này không. Danh mục nạp lúc đăng nhập; chưa nạp xong thì nạp nền và trả `catalog_loading`:
 * bộ lập lịch bỏ qua chiến dịch tới lượt quét sau, KHÔNG chạy bộ cũ (thử thật 17/11: trước đó chiến dịch FB đầu tiên sau đăng nhập luôn chạy
 * hết bằng bộ cũ). Nạp lỗi mà chưa có bản nào thì `catalog_unavailable` = bộ cũ, như thiết lập tắt. Loại chưa có workflow cho engine (chưa
 * chép "[engine] …") thì chạy bộ cũ.
 */
export function facebookEngineSupport(host: DesktopFacebookHost | undefined, disabled: ReadonlySet<number>, account: AutoAccount,
  campaign: Campaign): V2Support {
  if (!host?.enabled()) return { ok: false, reason: 'org_flag_off' }
  if (campaign.accountId !== account.id) return { ok: false, reason: 'account_mismatch' }
  if (disabled.has(campaign.id)) return { ok: false, reason: 'not_enabled' }
  const support = facebookCampaignV2Support(toFacebookCampaign(campaign), { randomRunEnabled: account.facebookRandomRunEnabled === true })
  if (!support.ok) return support
  const catalog = cachedFacebookEngineCatalog()
  if (!catalog) {
    const unavailable = facebookEngineCatalogUnavailable()
    void loadFacebookEngineCatalog().catch(error => console.warn('[CampaignEngine] Không nạp được danh mục engine Facebook:', error))
    return { ok: false, reason: unavailable ? 'catalog_unavailable' : 'catalog_loading' }
  }
  if (!catalog.workflows.has(campaign.actionId)) return { ok: false, reason: 'engine_workflow_missing' }
  return { ok: true }
}

export interface FacebookRunDependencies {
  host: DesktopFacebookHost
  account: AutoAccount
  campaign: Campaign
  signal: AbortSignal
}

/** Cấu hình runUnit cho chiến dịch FB (phần riêng Facebook; phần chung do DesktopEngineRunner gắn). */
export async function facebookUnitConfig(deps: FacebookRunDependencies, session: FacebookUnitSession) {
  const core = toFacebookCampaign(deps.campaign)
  const limitCheckActionCodes = await deps.host.limitCheckActionCodes(deps.campaign)
  return {
    targetLabel: facebookTargetLabel,
    actionName: (code: string) => FACEBOOK_ACTION_NAMES[code] ?? code,
    ...facebookClaimPlan(core, { limitCheckActionCodes }),
    buildSteps: () => [],
    validateCampaign: () => session.issues,
    workflow: {
      slotMode: facebookSlotMode(deps.campaign.actionId),
      // Tìm data: không có thao tác, kết quả mặc định của lõi ghi "Tìm data" như bộ cũ.
      ...(facebookResultName(deps.campaign.actionId) ? { resultName: facebookResultName(deps.campaign.actionId) } : {}),
      runTarget: (api: WorkflowTargetApi) => session.runTarget(api),
      ...(session.reviseCampaignNote ? {
        reviseCampaignNote: (info: { targetRunId: number; inputDataId: number; response: ReportSuccess }, signal: AbortSignal) =>
          session.reviseCampaignNote!(info, signal)
      } : {})
    },
    onTargetEnd: (info: { targetRunId: number; inputDataId: number }) => session.onTargetEnd(info),
    pacing: { fullSeconds: deps.host.sleepBetweenActionsSeconds(deps.account, deps.campaign) }
  }
}
