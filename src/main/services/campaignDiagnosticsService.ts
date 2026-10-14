import { randomUUID, createHash } from 'node:crypto'
import type { Campaign } from '../../shared/types'
import { DIAGNOSTICS_ACTIONS, DIAGNOSTICS_AI_CODE, DIAGNOSTICS_MODEL, DIAGNOSTICS_TTL_MS,
  formatDiagnosticTime, parseDiagnosticAiResponse, sanitizeDiagnosticValue, sanitizeCampaignDiagnosticsSnapshot, type CampaignDiagnosticsSnapshot, type DiagnosticIssue,
  type DiagnosticAction, type DiagnosticSeverity, type CampaignDiagnosticsAiResult } from '../../shared/campaignDiagnostics'
import { requireCurrentUser, requireCurrentUserCredentials } from '../data/currentUser'
import { readStaffAccess } from '../data/repositories/staffManagementRepository'
import { getDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { getBrowserRunLimits } from '../data/repositories/browserRunLimitsRepository'
import { canUseCampaignActionWithEntitlements, canUseAccountWithEntitlementsAndCapabilities, getUserZaloAccountCapabilities } from '../data/repositories/entitlementRepository'
import * as reads from '../data/repositories/campaignPendingReasonRepository'
import { readChatPendingLimitReason } from '../data/repositories/campaignPendingChatLimitRepository'
import { readDiagnosticsCampaign, readDiagnosticsEvidence, readDiagnosticsQuotas } from '../data/repositories/campaignDiagnosticsRepository'
import { pendingCampaignScheduleReason, pendingCampaignInputReason, type PendingReasonRuntime } from './campaignPendingReasonService'
import { callAiUsing } from './aiRuntimeService'
import { describeDiagnosticSchedule } from './campaignDiagnosticsSchedule'
import { webEnrichmentRevision } from './webEnrichmentControl'
import { checkFacebookRandomConfiguration, type FacebookRandomConfigurationCheck } from '../../shared/facebookRandomRunDiagnostics'

export function diagnosticCampaignVersion(c: Campaign & { diagnosticHasClaim?: boolean }, randomRun: unknown = null): string {
  return createHash('sha256').update(JSON.stringify([c.id, c.accountId, c.secondaryAccountId, c.actionId, c.status, c.note, c.isDelete,
    c.schedule, c.originalSchedule, c.scheduleType, c.scheduleDays, c.scheduleWeekDays, c.scheduleEndDate,
    c.dailyStopTime, c.continueNextDay, c.refreshData, c.extraSettings, c.content, c.images, c.dataTargetSourceMode, c.dataGroupId, c.provisioningState, c.diagnosticHasClaim,
    c.actionId.startsWith('facebook_') ? randomRun : null,
    c.actionId.startsWith('facebook_') ? webEnrichmentRevision(c.accountId) : null])).digest('hex')
}
export async function readDiagnosticVersion(campaign: Campaign & { diagnosticHasClaim?: boolean }, signal: AbortSignal): Promise<string> {
  const account = campaign.actionId.startsWith('facebook_') ? await reads.readPendingReasonAccount(campaign.accountId, signal) : null
  signal.throwIfAborted()
  return diagnosticCampaignVersion(campaign, account?.randomRun ?? null)
}
const issue = (id: string, title: string, severity: DiagnosticSeverity, problem: string, cause: string,
  explanation: string, solution: string, actions: DiagnosticAction[] = [], evidence?: string[]): DiagnosticIssue =>
  ({ id, title, severity, problem, cause, explanation, solution, actions, evidence })
const unknown = (id: string, title: string): DiagnosticIssue => issue(id, title, 'unknown', 'Chưa đủ dữ liệu để kiểm tra mục này.',
  'Thông tin cần thiết đang thiếu hoặc chưa xác minh được.', 'Chưa thể kết luận mục này đang bình thường hay gặp vấn đề.',
  'Bấm Kiểm tra lại để cập nhật dữ liệu. Nếu vẫn chưa xác minh được, kiểm tra thông tin liên quan.')
const record = (value: unknown): Record<string, unknown> => sanitizeDiagnosticValue(value) as Record<string, unknown>

export async function collectCampaignDiagnostics(id: number, runtime: PendingReasonRuntime, signal: AbortSignal): Promise<CampaignDiagnosticsSnapshot> {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const access = await readStaffAccess(user.staffId, credentials.username, credentials.password)
  signal.throwIfAborted()
  if (!access.isActive) throw new Error('Phiên đăng nhập không còn quyền đọc chiến dịch.')
  const campaign = await readDiagnosticsCampaign(id, signal)
  if (!campaign) throw new Error('Không tìm thấy chiến dịch trong tài khoản của bạn.')
  const results = await Promise.allSettled([
    reads.readPendingReasonAccount(campaign.accountId, signal),
    reads.readPendingReasonAction(campaign.actionId, signal),
    readDiagnosticsEvidence(id, signal), getDatabaseRuntimeClock()
  ])
  signal.throwIfAborted()
  const accountState = results[0].status === 'fulfilled' ? results[0].value : null
  const account = accountState?.account ?? null
  const version = diagnosticCampaignVersion(campaign, accountState?.randomRun ?? null)
  if (account && !['facebook', 'zalo', 'email'].includes(account.flatformType)) throw new Error('Kênh này chưa hỗ trợ chẩn đoán.')
  const action = results[1].status === 'fulfilled' ? results[1].value : null
  const evidence = results[2].status === 'fulfilled' ? results[2].value : null
  const clock = results[3].status === 'fulfilled' ? results[3].value : null
  const scheduleContext = describeDiagnosticSchedule(campaign, clock?.dbNow ?? null)
  const checks: DiagnosticIssue[] = []
  const terminal = campaign.status === 'tạm dừng' || campaign.status === 'hoàn thành'
  const terminalMessage = campaign.status === 'hoàn thành' ? 'Chiến dịch đã hoàn thành.' : 'Chiến dịch đang tạm dừng.'
  const running = campaign.status === 'đang chạy'
  let randomRun: FacebookRandomConfigurationCheck | null = null
  if (account) {
    const permission = access.timeAllowed && canUseCampaignActionWithEntitlements(campaign.actionId, account.flatformType, user.entitlements)
      && canUseAccountWithEntitlementsAndCapabilities(account, user.entitlements, getUserZaloAccountCapabilities(user))
    const problem = !permission ? 'Quyền sử dụng hoặc thời hạn của gói chưa đáp ứng chiến dịch.'
      : account.isDelete || !account.isActive ? 'Tài khoản đã bị vô hiệu hóa hoặc xóa.'
      : account.status === 'tạm dừng' ? 'Tài khoản đang tạm dừng.' : 'Tài khoản đang hoạt động và có quyền sử dụng.'
    checks.push(issue('account', 'Tài khoản và quyền sử dụng', !permission || account.isDelete || !account.isActive ? 'blocking' : account.status === 'tạm dừng' ? 'info' : 'ok',
      problem, problem, 'Quyền sử dụng và trạng thái tài khoản quyết định khả năng nhận lượt chạy.',
      'Mở thông tin tài khoản để kiểm tra; liên hệ quản trị nếu cần điều chỉnh quyền hoặc gói.', ['account']))
    checks.push(issue('login', 'Trạng thái đăng nhập', !account.loginStatus ? 'unknown' : account.loginStatus === 'đã đăng nhập' ? 'ok' : 'blocking',
      `Trạng thái đã ghi nhận: ${account.loginStatus || 'chưa xác minh'}.`,
      account.loginStatus === 'đã đăng nhập' ? 'Phiên đăng nhập được hệ thống ghi nhận còn hoạt động.' : 'Chưa có phiên sẵn sàng hoặc phiên cần đăng nhập lại.',
      'Đây là trạng thái đã ghi nhận, thao tác chẩn đoán không đăng nhập hoặc khôi phục phiên.',
      'Mở đăng nhập / cấu hình tài khoản để kiểm tra phiên.', ['login']))
  } else checks.push(unknown('account', 'Tài khoản và đăng nhập'))
  const capture = async (key: string, title: string, run: () => Promise<DiagnosticIssue>) => {
    try { const result = await run(); signal.throwIfAborted(); return result }
    catch { signal.throwIfAborted(); return unknown(key, title) }
  }
  const [runtimeCheck, scheduleCheck, contentCheck, inputCheck, quotaResult] = await Promise.all([
    capture('runtime', 'Bộ chạy chiến dịch', async () => {
      if (!account || !accountState) return unknown('runtime', 'Bộ chạy chiến dịch')
      if (terminal) return issue('runtime', 'Bộ chạy chiến dịch', 'info', terminalMessage,
        'Chiến dịch không nhận lượt chạy mới ở trạng thái này.', 'Đây là trạng thái hiện tại của chiến dịch.',
        'Xem lịch sử chạy để biết lần chuyển trạng thái gần nhất.', ['history'])
      const other = await reads.readBusyCampaign(campaign, signal)
      let reason = other ? `Tài khoản đang chạy chiến dịch “${other}”.` : !running ? runtime.busyReason(account) : null
      if (!reason && !running && campaign.diagnosticHasClaim) reason = 'Đang chờ hoàn tất lượt chạy hoặc tác vụ trước của tài khoản.'
      if (!reason && !running && (accountState.hasOperation || account.status !== 'chờ xử lý')) reason = 'Tài khoản đang bận một tác vụ khác.'
      reason ||= runtime.readinessReason(account, campaign)
      if (!reason && !running && (account.flatformType === 'facebook' || account.isZaloShowWeb)) {
        const limits = await getBrowserRunLimits()
        const max = account.flatformType === 'facebook' ? limits.facebookMax : limits.zaloWebMax
        if (max != null && await reads.countBusyBrowserAccounts(account, signal) >= max) reason = `Đã đạt giới hạn ${max} tài khoản chạy đồng thời.`
      }
      const remote = account.flatformType === 'zalo' && account.isZaloServer
      return issue('runtime', 'Bộ chạy chiến dịch', reason ? 'info' : remote ? 'unknown' : running ? 'ok' : 'info',
        reason || (remote ? 'Chiến dịch chạy trên Zalo Server/akaChat; chưa xác minh trực tiếp bộ chạy từ máy này.'
          : running ? 'Chiến dịch đang được ghi nhận chạy.' : 'Chưa phát hiện điều kiện chặn bộ chạy.'),
        reason || 'Đối chiếu trạng thái đã ghi nhận và bộ chạy tại thời điểm kiểm tra.',
        'Tài khoản nhận lượt chạy theo hàng đợi và giới hạn đồng thời.',
        'Xem lịch sử hoặc mở tài khoản để kiểm tra bộ chạy.', ['account', 'history'])
    }),
    capture('schedule', 'Lịch chạy', async () => {
      if (!scheduleContext.evaluatedAt || scheduleContext.endDatePolicy === 'unknown' || scheduleContext.endDateState === 'unknown') return unknown('schedule', 'Lịch chạy')
      const reason = pendingCampaignScheduleReason(campaign, scheduleContext.evaluatedAt)
      return issue('schedule', 'Lịch chạy', reason ? 'info' : 'ok', reason || 'Chưa thấy điều kiện về lịch chặn lượt chạy.',
        reason || 'Kết quả này chỉ xét lịch; trạng thái chiến dịch và các điều kiện khác được kiểm tra riêng.', scheduleContext.explanation,
        'Mở phần Lịch chạy nếu cần điều chỉnh.', ['schedule'],
        [`Lịch chạy hiện tại (giờ Việt Nam): ${formatDiagnosticTime(campaign.schedule, 'chưa đặt')}`,
          `Giờ dừng (giờ Việt Nam): ${campaign.dailyStopTime || 'không đặt'}`,
          `Ngày kết thúc (giờ Việt Nam): ${formatDiagnosticTime(campaign.scheduleEndDate, 'không đặt')}`])
    }),
    capture('content', 'Nội dung, media và cấu hình', async () => {
      if (!account || !action) return unknown('content', 'Nội dung, media và cấu hình')
      const requiresWorkflow = !accountState?.isChatManaged
      let reason = runtime.configurationReason(campaign, action, requiresWorkflow)
      if (!reason && accountState?.isChatManaged && (!action.isActive || action.isDelete || action.flatformType !== 'zalo')) reason = 'Loại chiến dịch chưa có cấu hình chạy hợp lệ.'
      if (!reason && requiresWorkflow) {
        const workflow = user.useTestWorkflow ? action.testWorkflowId : action.workflowId
        if (!workflow || !await reads.hasPendingReasonWorkflow(workflow, signal)) reason = 'Loại chiến dịch chưa có cấu hình chạy hợp lệ.'
      }
      return issue('content', 'Nội dung, media và cấu hình', reason ? 'blocking' : 'info',
        reason || 'Đã thu thập nội dung và cấu hình media để đối chiếu.', reason || 'Chưa phát hiện lỗi từ kiểm tra cấu hình hiện có.',
        'Đã đọc cấu hình và thông tin tệp; chưa phân tích nội dung hình ảnh/video hoặc gửi thử.',
        'Mở Nội dung để kiểm tra chữ, nguồn mẫu và media.', ['content'],
        [`Nội dung chữ: ${campaign.content ? `${campaign.content.length} ký tự` : 'lấy theo cấu hình/nguồn nội dung'}`, `Media trực tiếp: ${campaign.images?.length || 0}`])
    }),
    capture('data', 'Data đầu vào', async () => {
      if (!clock) return unknown('data', 'Data đầu vào')
      const inputs = await reads.readPendingInputAvailability(campaign.id, clock.dbNow, signal)
      const source = inputs.state === 'empty' && campaign.dataTargetSourceMode !== 'data_group' && await reads.hasPendingFindDataSource(campaign, signal)
      let problem = pendingCampaignInputReason(campaign, inputs, source, clock.dbNow) || (inputs.state === 'due' ? 'Có data chờ đã đến giờ chạy.' : 'Chưa có data chờ; một số loại chiến dịch tự tạo data lúc chạy.')
      if (campaign.provisioningState === 'staged') problem = 'Chiến dịch đang chuẩn bị data.'
      if (campaign.provisioningState === 'failed') problem = 'Chuẩn bị data chưa hoàn tất.'
      return issue('data', 'Data đầu vào', campaign.provisioningState === 'failed' ? 'blocking' : inputs.state === 'due' ? 'ok' : 'info',
        problem, problem, 'Trạng thái, lịch của data và nguồn cung cấp quyết định data nào sẵn sàng.',
        'Mở Data ban đầu để kiểm tra nguồn, lịch và trạng thái.', campaign.dataTargetSourceMode === 'data_group' ? ['data'] : ['data', 'importData'])
    }),
    account && action && clock ? readDiagnosticsQuotas(account, campaign, action, clock.dbNow, !!accountState?.isChatManaged, signal)
      .then(rows => ({ rows, error: false }), () => ({ rows: [], error: true })) : Promise.resolve({ rows: [], error: true })
  ])
  signal.throwIfAborted()
  checks.push(runtimeCheck)
  if (campaign.actionId.startsWith('facebook_')) {
    // No extra normal/waiting card: only the three approved configuration notes.
    try {
      if (!account || !action) throw new Error('Missing configuration evidence')
      randomRun = checkFacebookRandomConfiguration(accountState?.randomRun, action)
      if (randomRun.reason) checks.push(issue('randomRun', 'Cấu hình chạy ngẫu nhiên', terminal || running ? 'warning' : 'blocking',
        randomRun.reason, randomRun.reason,
        'Kiểm tra cấu hình cho lượt chạy mới. Đợt đang chạy giữ cấu hình đã nhận khi bắt đầu.',
        'Mở cài đặt chạy ngẫu nhiên của tài khoản để kiểm tra loại chiến dịch và chỉ tiêu.', ['randomSettings']))
    } catch { checks.push(unknown('randomRun', 'Cấu hình chạy ngẫu nhiên')) }
  }
  const quotas = quotaResult.rows
  if (quotaResult.error) checks.push(unknown('restrictions', 'Hạn chế hành động'), unknown('limits', 'Giới hạn hành động'))
  else {
    const disabled = quotas.filter(row => row.disabled)
    checks.push(issue('restrictions', 'Trạng thái và hạn chế hành động', disabled.length ? terminal ? 'info' : 'warning' : 'ok',
      disabled.length ? `${disabled.length} hành động đang bị hạn chế.` : 'Chưa thấy hành động cần dùng bị hạn chế.',
      disabled.map(row => `${row.name}: ${row.reason || 'Chưa có thông báo nguyên nhân.'}`).join('\n') || 'Không có hạn chế đang hiệu lực trong trạng thái đã ghi nhận.',
      'Thông báo và ngày mở lại được lấy từ trạng thái hành động đã lưu; không suy đoán lý do nền tảng chặn.',
      'Mở quản lý hành động để kiểm tra trước khi điều chỉnh.', ['accountActions']))
    checks.push(await capture('limits', 'Giới hạn ngày và khung giờ', async () => {
      if (!account || !action || !clock) return unknown('limits', 'Giới hạn ngày và khung giờ')
      const reason = accountState?.isChatManaged
        ? await readChatPendingLimitReason(account, campaign, action, clock.dbNow, signal)
        : await runtime.limitReason(account, campaign, action)
      const hit = quotas.some(row => row.checked && (row.dayUsed >= row.dayLimit || row.windowUsed != null && row.windowUsed >= row.windowLimit))
      return issue('limits', 'Giới hạn ngày và khung giờ', reason ? terminal ? 'info' : 'blocking' : hit ? 'warning' : 'ok',
        reason || (hit ? 'Một số hành động đạt giới hạn; quy tắc hiện tại còn cho phép hành động khác.' : 'Chưa thấy giới hạn chặn chiến dịch.'),
        reason || 'Đã đối chiếu số lượt với cấu hình nhóm, chiến dịch và gói sử dụng.',
        'Khoảng thời gian và cách tính lượt tuân theo bộ chạy tương ứng; hành động bị tắt vẫn có thể chặn dù không kiểm tra giới hạn lượt.',
        'Xem số lượt bên dưới; mở Giới hạn để kiểm tra cấu hình.', ['limits'])
    }))
  }
  checks.push(scheduleCheck, contentCheck, inputCheck)
  if (!evidence) checks.push(unknown('history', 'Lịch sử và kết quả gần đây'))
  else {
    // The stored policy outcome wins; only legacy rows without it use status text.
    const errors = evidence.results.filter(row => row.report_group === 'failure'
      || row.report_group == null && ['lỗi', 'thất bại'].includes(String(row.status)))
    checks.push(issue('history', 'Lịch sử và kết quả gần đây', errors.length ? 'warning' : 'info',
      evidence.results.length ? `${errors.length} kết quả lỗi/thất bại trong ${evidence.results.length} kết quả gần nhất.` : 'Chưa có kết quả chạy để đối chiếu.',
      errors.length ? 'Có kết quả cần đối chiếu thông báo và quy tắc xử lý; chưa đủ để kết luận lỗi liên tiếp.'
        : evidence.results.length ? 'Mẫu kết quả hiện có chưa ghi nhận lỗi/thất bại.' : 'Mẫu kết quả đang trống, chưa thể đánh giá các lần thực thi từ nguồn này.',
      'Đây là tối đa 30 kết quả gần nhất, không phải tổng kết quả trong ngày hoặc số lỗi liên tiếp. Lịch sử tài khoản có thể chưa đầy đủ.',
      'Mở Kết quả chạy để xem thông báo từng dòng; dùng AI nếu cần đối chiếu các nguồn.', ['results', 'history'],
      errors.slice(0, 5).map(row => String(row.log || row.error_code || row.status))))
  }
  const latest = await readDiagnosticsCampaign(id, signal)
  if (!latest || diagnosticCampaignVersion(latest, accountState?.randomRun ?? null) !== version
    || accountState && campaign.actionId.startsWith('facebook_') && await readDiagnosticVersion(latest, signal) !== version) {
    throw new Error('Chiến dịch hoặc cấu hình tài khoản vừa thay đổi. Vui lòng kiểm tra lại.')
  }
  signal.throwIfAborted()
  const headline = terminal ? terminalMessage : checks.find(check => check.severity === 'blocking')?.problem
    || (running ? 'Chiến dịch đang được ghi nhận chạy; xem các mục kiểm tra bên dưới.' : 'Chiến dịch đang chờ; xem các điều kiện và lịch bên dưới.')
  const accountFacts = account ? { ...account } : null
  if (accountFacts) {
    // This projection does not read enrichment settings; mapper defaults are not evidence.
    delete accountFacts.facebookWebEnrichmentEnabled
    delete accountFacts.facebookWebEnrichmentRevision
  }
  return sanitizeCampaignDiagnosticsSnapshot({ id: randomUUID(), campaignId: id, accountId: campaign.accountId, version,
    checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + DIAGNOSTICS_TTL_MS).toISOString(),
    campaignStatus: campaign.status, headline, complete: checks.every(check => check.severity !== 'unknown'), checks, quotas,
    facts: { schedule: scheduleContext, facebookRandomRun: randomRun, campaign: record(campaign), account: account ? record({ ...accountFacts, permissions: { access, entitlements: user.entitlements, zaloCapabilities: getUserZaloAccountCapabilities(user) }, executionTarget: accountState?.isChatManaged ? 'akaChat' : account.isZaloServer ? 'legacy Server' : account.isZaloShowWeb ? 'Zalo trình duyệt' : account.flatformType === 'zalo' ? 'Zalo QR' : account.flatformType }) : null, action: action ? record(action) : null,
      accountHistory: evidence?.accountHistory ?? null, campaignHistory: evidence?.campaignHistory ?? null,
      results: evidence?.results ?? null, inputSummary: evidence?.inputSummary ?? null, inputs: evidence?.inputs ?? null }
  })
}

export async function analyzeDiagnosticsSnapshot(snapshot: CampaignDiagnosticsSnapshot, signal: AbortSignal): Promise<CampaignDiagnosticsAiResult> {
  const user = requireCurrentUser()
  const safeSnapshot = sanitizeCampaignDiagnosticsSnapshot(snapshot)
  const schema = { type: 'object', additionalProperties: false, required: ['summary', 'issues'], properties: {
    summary: { type: 'string' }, issues: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
      required: ['title', 'severity', 'problem', 'cause', 'explanation', 'solution', 'actions'], properties: {
        title: { type: 'string' }, severity: { type: 'string', enum: ['ok', 'info', 'warning', 'blocking', 'unknown'] },
        problem: { type: 'string' }, cause: { type: 'string' }, explanation: { type: 'string' }, solution: { type: 'string' },
        actions: { type: 'array', items: { type: 'string', enum: Object.keys(DIAGNOSTICS_ACTIONS) } }
      } } }
  } }
  const result = await callAiUsing(DIAGNOSTICS_AI_CODE, {
    diagnosticContext: JSON.stringify(safeSnapshot),
    availableActions: JSON.stringify(DIAGNOSTICS_ACTIONS),
    bodyOverrides: { reasoning: { effort: 'medium' }, text: { format: { type: 'json_schema', name: 'campaign_diagnostics', strict: true, schema } }, store: false }
  }, { campaignId: snapshot.campaignId, accountId: snapshot.accountId, organizationId: user.organizationId },
  { signal, expectedModel: DIAGNOSTICS_MODEL })
  signal.throwIfAborted()
  if (!result.ok) throw new Error('AI chưa thể phân tích lúc này. Vui lòng thử lại; kết quả kiểm tra vẫn được giữ.')
  return { snapshot: safeSnapshot, generatedAt: result.generatedAt, model: result.model, ...parseDiagnosticAiResponse(result.content) }
}
