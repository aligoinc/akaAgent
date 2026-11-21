/**
 * Chiến dịch quét data website (nhatot, batdongsan, Trang Vàng) trên engine v2, Desktop (phương án docs/WEB_DATA_SCAN_PLAN.md mục 7.6). Lõi chạy
 * chế độ workflow (giữ lease, nhận từng từ khoá, nhật ký, chỉ thị của DB); mỗi từ khoá chạy runWebScanTarget trong phiên do bộ lập lịch mở
 * (trang chạy ngầm của tài khoản Website + block "[engine] web_*" đọc từ DB).
 *
 * Bật theo tổ chức (web_scan.campaigns, đọc lúc đăng nhập); claim kiểm lại mỗi lượt (tổ chức không bật thì not_enabled). Không có bộ cũ:
 * chiến dịch web không chạy bằng bộ engine v2 thì bộ lập lịch bỏ qua, không bao giờ chạy executeCampaign (không có workflow).
 */
import type { AutoAccount, Campaign } from '../../../shared/types'
import { clampWebScanSleepSeconds, getWebScanSite, isWebAccountPlatform, type WebScanLimits } from '../../../shared/webScan'
import {
  WEB_ACTION_NAMES, WEB_FIND_DATA_RESULT_NAME, webCampaignV2Support, webClaimPlan, webTargetLabel,
  type ConfigIssue, type V2Support, type WorkflowTargetApi, type WorkflowTargetEnd
} from '../../../../packages/campaign-engine/src/index'

/** Phiên của một lượt (mở trước claim đầu, đóng sau khi lượt kết thúc và đã nhả lease). */
export interface WebUnitSession {
  /** Lỗi cấu hình phát hiện lúc mở lượt (thiếu block trong DB…): lõi báo mã và dừng lượt. */
  readonly issues: readonly ConfigIssue[]
  runTarget(api: WorkflowTargetApi): Promise<WorkflowTargetEnd>
  close(): Promise<void>
}

export interface DesktopWebHost {
  /** Tổ chức của phiên nằm trong web_scan.campaigns (chốt lúc đăng nhập). */
  enabled(): boolean
  limits(): WebScanLimits
  openUnit(account: AutoAccount, campaign: Campaign, signal: AbortSignal): Promise<WebUnitSession>
}

export const isWebAccount = (account: AutoAccount): boolean => isWebAccountPlatform(account.flatformType)

/** Chiến dịch web có chạy được ở bản cài này không (không có bộ cũ để rơi về). */
export function webEngineSupport(host: DesktopWebHost | undefined, disabled: ReadonlySet<number>, account: AutoAccount, campaign: Campaign): V2Support {
  if (!host?.enabled()) return { ok: false, reason: 'web_scan_off' }
  if (disabled.has(campaign.id)) return { ok: false, reason: 'not_enabled' }
  if (!getWebScanSite(campaign.actionId)) return { ok: false, reason: 'not_web' }
  return webCampaignV2Support(campaign, account.id)
}

/** Nghỉ giữa hai lần mở trang / bấm hiện số: cài đặt của chiến dịch (giới hạn hành động), kẹp thấp nhất theo DB. */
export function webScanSleepSeconds(campaign: Campaign, limits: WebScanLimits): number {
  const actionLimits = campaign.extraSettings?.actionLimits as Record<string, unknown> | undefined
  const raw = actionLimits?.sleepBetweenActions
  return clampWebScanSleepSeconds(raw === undefined || raw === null || raw === '' ? limits.defaultSleepSeconds : raw, limits)
}

/** Cấu hình runUnit cho chiến dịch web (phần riêng; phần chung do DesktopEngineRunner gắn). */
export function webUnitConfig(campaign: Campaign, session: WebUnitSession, limits: WebScanLimits) {
  return {
    targetLabel: webTargetLabel,
    actionName: (code: string) => WEB_ACTION_NAMES[code] ?? code,
    ...webClaimPlan(campaign.actionId),
    buildSteps: () => [],
    validateCampaign: () => session.issues,
    workflow: {
      resultName: WEB_FIND_DATA_RESULT_NAME,
      runTarget: (api: WorkflowTargetApi) => session.runTarget(api)
    },
    // Nghỉ giữa hai từ khoá: như giữa hai lần mở trang.
    pacing: { fullSeconds: webScanSleepSeconds(campaign, limits) }
  }
}
