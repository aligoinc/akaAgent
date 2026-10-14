import type { AutoAccount, Campaign, CampaignAction } from '../../shared/types'
import { canCheckCampaignPendingReason, campaignPendingReasonVersion, type CampaignPendingReasonResult } from '../../shared/campaignPendingReason'
import { requireCurrentUser, requireCurrentUserCredentials } from '../data/currentUser'
import { getDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { canUseCampaignActionWithEntitlements, canUseAccountWithEntitlementsAndCapabilities, getUserZaloAccountCapabilities } from '../data/repositories/entitlementRepository'
import { readStaffAccess } from '../data/repositories/staffManagementRepository'
import { getBrowserRunLimits } from '../data/repositories/browserRunLimitsRepository'
import * as reads from '../data/repositories/campaignPendingReasonRepository'
import { readChatPendingLimitReason } from '../data/repositories/campaignPendingChatLimitRepository'
import { checkFacebookRandomConfiguration } from '../../shared/facebookRandomRunDiagnostics'

export interface PendingReasonRuntime {
  /** RAM-only observations; never start/claim/recover a runtime from this endpoint. */
  busyReason(account: AutoAccount): string | null
  readinessReason(account: AutoAccount, campaign: Campaign): string | null
  configurationReason(campaign: Campaign, action: CampaignAction, requiresWorkflow: boolean): string | null
  limitReason(account: AutoAccount, campaign: Campaign, action: CampaignAction): Promise<string | null>
}

const mobileManaged = (campaign: Campaign) => campaign.actionId === 'sms_send' || campaign.actionId === 'voice_call'
const formatTime = (value: string | number) => new Date(value).toLocaleString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
})

/** Business time must come from DB, never from the desktop wall clock. */
export function pendingCampaignScheduleReason(campaign: Campaign, dbNow: string): string | null {
  const now = Date.parse(dbNow)
  if (!Number.isFinite(now)) throw new Error('Invalid database clock')
  const schedule = Date.parse(campaign.schedule || '')
  const invalidDays = (raw: string | undefined, min: number, max: number) => !raw || !raw.split(',').some(value => {
    const day = Number(value.trim()); return Number.isInteger(day) && day >= min && day <= max
  })
  if (!Number.isFinite(schedule) || (campaign.scheduleType === 'weekly' && invalidDays(campaign.scheduleWeekDays, 2, 8))
    || (campaign.scheduleType === 'monthly' && invalidDays(campaign.scheduleDays, 1, 31))) {
    return 'Lịch chạy chưa hợp lệ. Vui lòng kiểm tra lại cài đặt lịch.'
  }
  if (campaign.dataTargetSourceMode === 'data_group' && campaign.scheduleEndDate && now >= Date.parse(campaign.scheduleEndDate)) {
    return `Chiến dịch đã hết hạn lúc ${formatTime(campaign.scheduleEndDate)}, đang chờ cập nhật trạng thái.`
  }
  if (schedule > now) return `Chưa đến lịch chạy. Lịch tiếp theo: ${formatTime(schedule)}.`
  if (mobileManaged(campaign)) return null
  const vietnamNow = new Date(now + 7 * 60 * 60 * 1000)
  const seconds = vietnamNow.getUTCHours() * 3600 + vietnamNow.getUTCMinutes() * 60 + vietnamNow.getUTCSeconds()
  const stop = campaign.dailyStopTime?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (campaign.dailyStopTime && (!stop || Number(stop[1]) > 23 || Number(stop[2]) > 59 || Number(stop[3] || 0) > 59)) {
    return 'Lịch chạy chưa hợp lệ. Vui lòng kiểm tra lại cài đặt lịch.'
  }
  if (stop && seconds >= Number(stop[1]) * 3600 + Number(stop[2]) * 60 + Number(stop[3] || 0)) {
    return `Đã quá giờ dừng gửi ${campaign.dailyStopTime!.slice(0, 5)}. Chiến dịch không nhận lượt mới trong hôm nay.`
  }
  if (seconds >= (23 * 60 + 59) * 60) return 'Hệ thống dừng nhận lượt mới từ 23:59 để chuyển sang ngày mới.'
  const dayStart = now - seconds * 1000 - vietnamNow.getUTCMilliseconds()
  if (schedule < dayStart && (campaign.scheduleType !== 'daily' && campaign.scheduleType != null || campaign.continueNextDay === true)) {
    return 'Đang chờ hệ thống cập nhật lịch chạy ngày mới.'
  }
  return null
}

export function pendingCampaignInputReason(campaign: Campaign, inputs: reads.PendingInputAvailability, hasSource: boolean, dbNow: string): string | null {
  if (inputs.state === 'future') return (`Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc ${formatTime(inputs.scheduledAt)}.`)
  // Pending but paused recipients are distinct from an empty list auto-filled at run time.
  if (inputs.state === 'paused') return ('Các data chưa xử lý đều đang tạm dừng. Vui lòng tiếp tục data cần chạy.')
  if (inputs.state !== 'due' && campaign.dataTargetSourceMode === 'data_group') return ('Đang chờ data mới từ Nhóm data.')
  if (inputs.state === 'empty' && hasSource) return ('Đang chờ data từ chiến dịch tìm data.')
  if (inputs.state !== 'due' && campaign.actionId === 'zalo_message_group_realtime') {
    const rawEnd = String(campaign.extraSettings?.zaloRealtimeEndDate || '').trim()
    const vietnamDay = (value: string) => new Date(Date.parse(value) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const endDay = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? rawEnd : Number.isFinite(Date.parse(rawEnd)) ? vietnamDay(rawEnd) : ''
    if (endDay && vietnamDay(dbNow) <= endDay) return ('Đang chờ data theo thời gian thực từ group Zalo.')
  }
  return null
}

export async function inspectPendingCampaign(
  campaignId: number, runtime: PendingReasonRuntime, signal: AbortSignal
): Promise<CampaignPendingReasonResult> {
  const observed = await reads.readPendingReasonCampaign(campaignId, signal)
  const result = (message: string | null, version = ''): CampaignPendingReasonResult => ({ campaignId, message, version })
  if (!observed || !canCheckCampaignPendingReason(observed.campaign)) return result(null)
  const { campaign } = observed
  const version = campaignPendingReasonVersion(campaign)
  let randomVersion: string | undefined
  let busyObservation: { account: AutoAccount; reason: string | null } | undefined
  const finish = async (message: string): Promise<CampaignPendingReasonResult> => {
    signal.throwIfAborted()
    const latest = await reads.readPendingReasonCampaign(campaignId, signal)
    if (!latest || !canCheckCampaignPendingReason(latest.campaign) || campaignPendingReasonVersion(latest.campaign) !== version) return result(null)
    if (randomVersion !== undefined) {
      const latestAccount = await reads.readPendingReasonAccount(campaign.accountId, signal)
      signal.throwIfAborted()
      if (!latestAccount || JSON.stringify(latestAccount.randomRun) !== randomVersion) return result(null)
    }
    if (busyObservation && runtime.busyReason(busyObservation.account) !== busyObservation.reason) return result(null)
    return result(message, version)
  }

  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const access = await readStaffAccess(user.staffId, credentials.username, credentials.password)
  signal.throwIfAborted()
  if (!access.isActive) return finish('Tài khoản nhân viên đã bị vô hiệu hóa.')
  if (!access.timeAllowed) return finish('Tài khoản nhân viên đã hết hạn sử dụng.')
  const accountState = await reads.readPendingReasonAccount(campaign.accountId, signal)
  if (!accountState) return finish('Không tìm thấy tài khoản của chiến dịch.')
  const { account, isChatManaged } = accountState
  if (!canUseCampaignActionWithEntitlements(campaign.actionId, account.flatformType, user.entitlements)
    || !canUseAccountWithEntitlementsAndCapabilities(account, user.entitlements, getUserZaloAccountCapabilities(user))) {
    return finish(`Chưa có quyền sử dụng ${account.isZaloServer ? 'Zalo Server' : account.isZaloShowWeb ? 'Zalo trình duyệt' : account.flatformType}, hoặc gói sử dụng đã hết hạn.`)
  }
  if (account.isDelete) return finish('Tài khoản đã bị xóa, không thể chạy chiến dịch.')
  if (!account.isActive) return finish('Tài khoản đã bị vô hiệu hóa, không thể chạy chiến dịch.')
  if (campaign.provisioningState === 'failed') return finish('Chuẩn bị data chiến dịch chưa hoàn tất. Vui lòng kiểm tra lại chiến dịch.')
  if (campaign.provisioningState === 'staged') return finish('Chiến dịch đang chuẩn bị data, chưa sẵn sàng chạy.')
  const clock = await getDatabaseRuntimeClock()
  signal.throwIfAborted()
  const scheduleReason = pendingCampaignScheduleReason(campaign, clock.dbNow)
  if (scheduleReason) return finish(scheduleReason)
  const otherCampaign = await reads.readBusyCampaign(campaign, signal)
  if (otherCampaign) return finish(`Tài khoản đang bận chạy chiến dịch “${otherCampaign}”. Chiến dịch này đang chờ đến lượt.`)
  if (observed.hasClaim) return finish('Đang chờ hoàn tất lượt chạy hoặc tác vụ trước của tài khoản.')
  const busy = runtime.busyReason(account)
  busyObservation = { account, reason: busy }
  if (busy) return finish(busy)
  if (account.status === 'tạm dừng') return finish('Tài khoản đang tạm dừng. Vui lòng tiếp tục tài khoản để chạy chiến dịch.')
  if (account.status !== 'chờ xử lý' || accountState.hasOperation) return finish('Tài khoản đang bận, chưa thể chạy chiến dịch.')
  if (account.loginStatus !== 'đã đăng nhập') return finish('Tài khoản chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.')
  const readiness = runtime.readinessReason(account, campaign)
  if (readiness) return finish(readiness)

  const action = await reads.readPendingReasonAction(campaign.actionId, signal)
  if (!action || isChatManaged && (!action.isActive || action.isDelete || action.flatformType !== 'zalo')) {
    return finish('Loại chiến dịch chưa có cấu hình chạy hợp lệ.')
  }
  const requiresWorkflow = !mobileManaged(campaign) && !isChatManaged
  const configuration = runtime.configurationReason(campaign, action, requiresWorkflow)
  if (configuration) return finish(configuration)
  if (requiresWorkflow) {
    const workflowId = user.useTestWorkflow ? action.testWorkflowId : action.workflowId
    if (!workflowId || !await reads.hasPendingReasonWorkflow(workflowId, signal)) return finish('Loại chiến dịch chưa có cấu hình chạy hợp lệ.')
  }
  if (account.flatformType === 'facebook' || account.flatformType === 'zalo' && account.isZaloShowWeb && !account.isZaloServer) {
    const limits = await getBrowserRunLimits()
    signal.throwIfAborted()
    const maximum = account.flatformType === 'facebook' ? limits.facebookMax : limits.zaloWebMax
    if (maximum != null && await reads.countBusyBrowserAccounts(account, signal) >= maximum) {
      return finish(`Đã đạt giới hạn ${maximum} tài khoản ${account.flatformType === 'facebook' ? 'Facebook' : 'Zalo trình duyệt'} chạy đồng thời. Đang chờ có chỗ.`)
    }
  }
  const limit = isChatManaged
    ? await readChatPendingLimitReason(account, campaign, action, clock.dbNow, signal)
    : await runtime.limitReason(account, campaign, action)
  signal.throwIfAborted()
  if (limit) return finish(limit)
  const inputs = await reads.readPendingInputAvailability(campaign.id, clock.dbNow, signal)
  const inputReason = pendingCampaignInputReason(campaign, inputs, inputs.state === 'empty' && campaign.dataTargetSourceMode !== 'data_group' && await reads.hasPendingFindDataSource(campaign, signal), clock.dbNow)
  if (inputReason) return finish(inputReason)
  if (account.flatformType === 'facebook') {
    const random = checkFacebookRandomConfiguration(accountState.randomRun, action)
    randomVersion = JSON.stringify(accountState.randomRun)
    if (random.reason) return finish(random.reason)
  }
  if (mobileManaged(campaign)) return finish('Chiến dịch được thực hiện trên điện thoại. Chưa xác minh được trạng thái xử lý trên thiết bị.')
  if (account.flatformType === 'zalo' && account.isZaloServer) {
    return finish('Chiến dịch được xử lý trên Zalo Server/akaChat. Chưa xác minh được trạng thái thực thi hiện tại.')
  }
  return finish('Chưa phát hiện điều kiện chặn tại thời điểm kiểm tra. Chiến dịch đang chờ bộ chạy tiếp nhận.')
}
