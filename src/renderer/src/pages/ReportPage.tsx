import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Search, X } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import {
  AccountActionReportAccount,
  AccountActionReportAction,
  AccountActionReportDetailResult,
  AccountActionReportDetailRow,
  AccountActionReportQuery,
  AccountActionReportResult,
  AccountActionReportStatusBucket,
  AutoAccount,
  AutoAccountAction,
  AutoAccountGroup
} from '../../../shared/types'
import { useUiStore } from '../stores/uiStore'

type ReportRangePreset = 'today' | 'yesterday' | '7_days' | '30_days' | 'custom'
type ReportFilterDropdown = 'platform' | 'accounts' | 'range' | 'actions'
type ReportDetailModalState = {
  account: AccountActionReportAccount
  action: AccountActionReportAction
  statusBucket: AccountActionReportStatusBucket
  statusLabel: string
  count: number
}

interface ReportPageProps {
  isActive: boolean
}

const RANGE_OPTIONS: Array<{ value: ReportRangePreset; label: string }> = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: '7_days', label: '7 ngày' },
  { value: '30_days', label: '30 ngày' },
  { value: 'custom', label: 'Tùy chọn' }
]

const DEFAULT_PLATFORM = 'facebook'

function getPlatformLabel(platform: string): string {
  const normalized = platform.trim().toLowerCase()
  if (normalized === 'facebook') return 'Facebook'
  if (normalized === 'zalo') return 'Zalo'
  if (normalized === 'email') return 'Email'
  if (normalized === 'sms') return 'SMS'
  return platform || 'Tất cả'
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function buildRange(preset: ReportRangePreset, customStartDate: string, customEndDate: string): { startIso: string; endIso: string } {
  const now = new Date()
  let start = startOfLocalDay(now)
  let end = startOfLocalDay(addDays(now, 1))

  if (preset === 'yesterday') {
    start = startOfLocalDay(addDays(now, -1))
    end = startOfLocalDay(now)
  } else if (preset === '7_days') {
    start = startOfLocalDay(addDays(now, -6))
    end = startOfLocalDay(addDays(now, 1))
  } else if (preset === '30_days') {
    start = startOfLocalDay(addDays(now, -29))
    end = startOfLocalDay(addDays(now, 1))
  } else if (preset === 'custom') {
    start = new Date(`${customStartDate}T00:00:00`)
    end = startOfLocalDay(addDays(new Date(`${customEndDate}T00:00:00`), 1))
  }

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  }
}

function formatExportTimestamp(date = new Date()): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    pad2(date.getHours()),
    pad2(date.getMinutes())
  ].join('')
}

function formatDateTimeLabel(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('vi-VN')
}

function hasAnyCount(report: AccountActionReportResult | null): boolean {
  if (!report) return false
  return report.rows.some(row =>
    report.actions.some(action => {
      const cell = row.countsByActionCode[action.code]
      return (cell?.successCount || 0) > 0 || (cell?.failureCount || 0) > 0 || (cell?.pendingCount || 0) > 0
    })
  )
}

function getStatusBucketLabel(statusBucket: AccountActionReportStatusBucket): string {
  if (statusBucket === 'pending') return 'Chờ xử lý'
  if (statusBucket === 'success') return 'Thành công'
  return 'Thất bại'
}

function getDetailCount(
  cell: { pendingCount: number; successCount: number; failureCount: number } | undefined,
  statusBucket: AccountActionReportStatusBucket
): number {
  if (!cell) return 0
  if (statusBucket === 'pending') return cell.pendingCount || 0
  if (statusBucket === 'success') return cell.successCount || 0
  return cell.failureCount || 0
}

function formatTarget(row: AccountActionReportDetailRow): string {
  return row.targetName || row.targetUid || row.targetPhone || row.targetEmail || ''
}

function formatFileToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'bao-cao'
}

function makeDetailExportRows(rows: AccountActionReportDetailRow[]) {
  return rows.map(row => ({
    'Thời gian': formatDateTimeLabel(row.occurredAt || undefined),
    'Tài khoản': row.accountName,
    'Chiến dịch': row.campaignName || '',
    'Hành động': row.actionName,
    'Target': formatTarget(row),
    'UID/Link target': row.targetUid || '',
    'Số điện thoại': row.targetPhone || '',
    'Email': row.targetEmail || '',
    'Trạng thái': row.status,
    'Chi tiết': row.detailText || '',
    'Link bài viết': row.postUrl || ''
  }))
}

export default function ReportPage({ isActive }: ReportPageProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const [platform, setPlatform] = useState(DEFAULT_PLATFORM)
  const [accounts, setAccounts] = useState<AutoAccount[]>([])
  const [groups, setGroups] = useState<AutoAccountGroup[]>([])
  const [actions, setActions] = useState<AutoAccountAction[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<number>>(new Set())
  const [selectedActionCodes, setSelectedActionCodes] = useState<Set<string>>(new Set())
  const [rangePreset, setRangePreset] = useState<ReportRangePreset>('today')
  const today = useMemo(() => formatDateInput(new Date()), [])
  const [customStartDate, setCustomStartDate] = useState(today)
  const [customEndDate, setCustomEndDate] = useState(today)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loadingReport, setLoadingReport] = useState(false)
  const [report, setReport] = useState<AccountActionReportResult | null>(null)
  const [openDropdown, setOpenDropdown] = useState<ReportFilterDropdown | null>(null)
  const [detailModal, setDetailModal] = useState<ReportDetailModalState | null>(null)
  const [detailResult, setDetailResult] = useState<AccountActionReportDetailResult | null>(null)
  const [detailPage, setDetailPage] = useState(1)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [exportingDetail, setExportingDetail] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const hasInitializedRef = useRef(false)

  const platformAccounts = useMemo(
    () => accounts.filter(account => !platform || account.flatformType === platform),
    [accounts, platform]
  )
  const platformGroups = useMemo(
    () => groups.filter(group => !platform || group.flatformType === platform),
    [groups, platform]
  )
  const selectedAccountIdList = useMemo(
    () => Array.from(selectedAccountIds).filter(id => platformAccounts.some(account => account.id === id)),
    [selectedAccountIds, platformAccounts]
  )
  const selectedActionCodeList = useMemo(
    () => Array.from(selectedActionCodes).filter(code => actions.some(action => action.code === code)),
    [selectedActionCodes, actions]
  )
  const platforms = useMemo(() => {
    const values = Array.from(new Set(accounts.map(account => account.flatformType).filter(Boolean)))
    if (!values.includes(DEFAULT_PLATFORM)) values.unshift(DEFAULT_PLATFORM)
    return values
  }, [accounts])

  const groupedAccounts = useMemo(() => {
    const byGroup = new Map<number, AutoAccount[]>()
    const ungrouped: AutoAccount[] = []
    const platformGroupIds = new Set(platformGroups.map(group => group.id))
    for (const account of platformAccounts) {
      if (account.accountGroupId && platformGroupIds.has(account.accountGroupId)) {
        const list = byGroup.get(account.accountGroupId) || []
        list.push(account)
        byGroup.set(account.accountGroupId, list)
      } else {
        ungrouped.push(account)
      }
    }
    return { byGroup, ungrouped }
  }, [platformAccounts, platformGroups])

  const buildQuery = (
    accountIds = selectedAccountIdList,
    actionCodes = selectedActionCodeList,
    targetPlatform = platform
  ): AccountActionReportQuery => ({
    flatformType: targetPlatform || undefined,
    accountIds,
    actionCodes,
    ...buildRange(rangePreset, customStartDate, customEndDate)
  })

  const loadReport = async (
    accountIds = selectedAccountIdList,
    actionCodes = selectedActionCodeList,
    targetPlatform = platform
  ) => {
    if (!window.electronAPI) return
    if (accountIds.length === 0 || actionCodes.length === 0) {
      setDetailModal(null)
      setDetailResult(null)
      setReport({
        query: buildQuery(accountIds, actionCodes, targetPlatform),
        actions: actions
          .filter(action => actionCodes.includes(action.code))
          .map(action => ({ code: action.code, name: action.name, flatformType: action.flatformType })),
        rows: [],
        generatedAt: new Date().toISOString()
      })
      return
    }

    setDetailModal(null)
    setDetailResult(null)
    setLoadingReport(true)
    try {
      const result = await window.electronAPI.getAccountActionReport(buildQuery(accountIds, actionCodes, targetPlatform))
      setReport(result)
    } catch (err: any) {
      console.error('Failed to load account action report:', err)
      showAlert(err?.message || 'Không thể tải báo cáo.', 'error')
    } finally {
      setLoadingReport(false)
    }
  }

  const loadOptions = async (nextPlatform = platform) => {
    if (!window.electronAPI) return
    setLoadingOptions(true)
    try {
      const [nextAccounts, nextGroups, nextActions] = await Promise.all([
        window.electronAPI.listAccounts(),
        window.electronAPI.listAccountGroups(nextPlatform || undefined),
        window.electronAPI.listAccountActions(nextPlatform || undefined)
      ])
      const nextPlatformAccounts = nextAccounts.filter(account => !nextPlatform || account.flatformType === nextPlatform)
      const nextAccountIds = nextPlatformAccounts.map(account => account.id)
      const nextActionCodes = nextActions.map(action => action.code)

      setAccounts(nextAccounts)
      setGroups(nextGroups)
      setActions(nextActions)
      setSelectedAccountIds(new Set(nextAccountIds))
      setSelectedActionCodes(new Set(nextActionCodes))
      await loadReport(nextAccountIds, nextActionCodes, nextPlatform)
    } catch (err: any) {
      console.error('Failed to load report filters:', err)
      showAlert(err?.message || 'Không thể tải bộ lọc báo cáo.', 'error')
    } finally {
      setLoadingOptions(false)
    }
  }

  useEffect(() => {
    if (!isActive) return

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      void loadOptions(DEFAULT_PLATFORM)
      return
    }

    void loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  useEffect(() => {
    if (!openDropdown) return

    const handleMouseDown = (event: MouseEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) {
        setOpenDropdown(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenDropdown(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openDropdown])

  useEffect(() => {
    if (!detailModal) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetailModal()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailModal])

  const handlePlatformChange = (nextPlatform: string) => {
    setPlatform(nextPlatform)
    setOpenDropdown(null)
    void loadOptions(nextPlatform)
  }

  const toggleAccount = (accountId: number) => {
    setSelectedAccountIds(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  const toggleAccounts = (accountIds: number[]) => {
    setSelectedAccountIds(prev => {
      const next = new Set(prev)
      const allSelected = accountIds.length > 0 && accountIds.every(id => next.has(id))
      for (const id of accountIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const toggleAction = (actionCode: string) => {
    setSelectedActionCodes(prev => {
      const next = new Set(prev)
      if (next.has(actionCode)) next.delete(actionCode)
      else next.add(actionCode)
      return next
    })
  }

  const handleExport = () => {
    if (!report || report.actions.length === 0 || report.rows.length === 0) {
      showAlert('Chưa có dữ liệu báo cáo để xuất.', 'info')
      return
    }

    try {
      const header1 = ['Danh sách hành động/danh sách tài khoản chọn']
      const header2 = ['Trạng thái']
      for (const action of report.actions) {
        header1.push(action.name, '', '')
        header2.push('Chờ xử lý', 'Thành công', 'Thất bại')
      }

      const rows = report.rows.map(row => {
        const values: Array<string | number> = [row.account.name]
        for (const action of report.actions) {
          const cell = row.countsByActionCode[action.code]
          values.push(cell?.pendingCount || 0, cell?.successCount || 0, cell?.failureCount || 0)
        }
        return values
      })

      const sheet = utils.aoa_to_sheet([header1, header2, ...rows])
      sheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        ...report.actions.map((_, index) => ({
          s: { r: 0, c: 1 + index * 3 },
          e: { r: 0, c: 3 + index * 3 }
        }))
      ]
      sheet['!cols'] = [
        { wch: 34 },
        ...report.actions.flatMap(() => [{ wch: 13 }, { wch: 13 }, { wch: 13 }])
      ]

      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Bao cao')
      writeFile(workbook, `bao-cao-hanh-dong-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất báo cáo ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export report:', err)
      showAlert('Không thể xuất file Excel báo cáo.', 'error')
    }
  }

  const fetchDetailRows = async (modal: ReportDetailModalState, page = 1) => {
    if (!window.electronAPI || !report) return

    setLoadingDetail(true)
    try {
      const result = await window.electronAPI.getAccountActionReportDetails({
        flatformType: report.query.flatformType,
        accountId: modal.account.id,
        actionCode: modal.action.code,
        statusBucket: modal.statusBucket,
        startIso: report.query.startIso,
        endIso: report.query.endIso,
        page,
        pageSize: 100
      })
      setDetailResult(result)
      setDetailPage(result.page)
    } catch (err: any) {
      console.error('Failed to load report detail rows:', err)
      showAlert(err?.message || 'Không thể tải dữ liệu chi tiết.', 'error')
    } finally {
      setLoadingDetail(false)
    }
  }

  const openDetailModal = (
    account: AccountActionReportAccount,
    action: AccountActionReportAction,
    statusBucket: AccountActionReportStatusBucket,
    count: number
  ) => {
    if (count <= 0) return
    const modal = {
      account,
      action,
      statusBucket,
      statusLabel: getStatusBucketLabel(statusBucket),
      count
    }
    setDetailModal(modal)
    setDetailResult(null)
    setDetailPage(1)
    void fetchDetailRows(modal, 1)
  }

  const closeDetailModal = () => {
    setDetailModal(null)
    setDetailResult(null)
    setLoadingDetail(false)
  }

  const changeDetailPage = (nextPage: number) => {
    if (!detailModal || nextPage < 1) return
    void fetchDetailRows(detailModal, nextPage)
  }

  const handleExportDetail = async () => {
    if (!detailModal || !report || !window.electronAPI) return

    setExportingDetail(true)
    try {
      const result = await window.electronAPI.getAccountActionReportDetails({
        flatformType: report.query.flatformType,
        accountId: detailModal.account.id,
        actionCode: detailModal.action.code,
        statusBucket: detailModal.statusBucket,
        startIso: report.query.startIso,
        endIso: report.query.endIso,
        exportAll: true
      })

      if (result.rows.length === 0) {
        showAlert('Không có dữ liệu chi tiết để xuất.', 'info')
        return
      }

      const sheet = utils.json_to_sheet(makeDetailExportRows(result.rows))
      sheet['!cols'] = [
        { wch: 20 },
        { wch: 24 },
        { wch: 28 },
        { wch: 22 },
        { wch: 28 },
        { wch: 36 },
        { wch: 16 },
        { wch: 24 },
        { wch: 14 },
        { wch: 54 },
        { wch: 42 }
      ]

      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Chi tiet')
      const fileToken = [
        formatFileToken(detailModal.account.name),
        formatFileToken(detailModal.action.name),
        formatFileToken(detailModal.statusLabel)
      ].join('-')
      writeFile(workbook, `bao-cao-chi-tiet-${fileToken}-${formatExportTimestamp()}.xlsx`)
      showAlert(`Đã xuất ${result.rows.length} dòng chi tiết ra Excel.`, 'success')
    } catch (err: any) {
      console.error('Failed to export report detail rows:', err)
      showAlert(err?.message || 'Không thể xuất Excel chi tiết.', 'error')
    } finally {
      setExportingDetail(false)
    }
  }

  const totalAccountCount = platformAccounts.length
  const selectedAllAccounts = totalAccountCount > 0 && selectedAccountIdList.length === totalAccountCount
  const selectedAllActions = actions.length > 0 && selectedActionCodeList.length === actions.length
  const reportHasCounts = hasAnyCount(report)
  const rangeLabel = rangePreset === 'custom'
    ? `${new Date(`${customStartDate}T00:00:00`).toLocaleDateString('vi-VN')} - ${new Date(`${customEndDate}T00:00:00`).toLocaleDateString('vi-VN')}`
    : RANGE_OPTIONS.find(option => option.value === rangePreset)?.label || 'Hôm nay'
  const accountSummary = selectedAllAccounts
    ? `Tất cả (${totalAccountCount})`
    : selectedAccountIdList.length > 0
      ? `${selectedAccountIdList.length} tài khoản`
      : 'Chưa chọn'
  const actionSummary = selectedAllActions
    ? `Tất cả (${actions.length})`
    : selectedActionCodeList.length > 0
      ? `${selectedActionCodeList.length} hành động`
      : 'Chưa chọn'

  const toggleDropdown = (dropdown: ReportFilterDropdown) => {
    setOpenDropdown(current => current === dropdown ? null : dropdown)
  }

  const renderReportCount = (
    account: AccountActionReportAccount,
    action: AccountActionReportAction,
    cell: { pendingCount: number; successCount: number; failureCount: number } | undefined,
    statusBucket: AccountActionReportStatusBucket
  ) => {
    const count = getDetailCount(cell, statusBucket)
    const className = `report-count ${statusBucket}`
    if (count <= 0) {
      return <span className={className}>0</span>
    }

    return (
      <button
        type="button"
        className={`${className} report-count-button`}
        title={`Xem chi tiết ${getStatusBucketLabel(statusBucket).toLowerCase()} của ${action.name}`}
        onClick={() => openDetailModal(account, action, statusBucket, count)}
      >
        {count}
      </button>
    )
  }

  const detailTotalPages = detailResult
    ? Math.max(1, Math.ceil(detailResult.total / Math.max(detailResult.pageSize || 1, 1)))
    : 1
  const detailFrom = detailResult && detailResult.total > 0
    ? (detailResult.page - 1) * detailResult.pageSize + 1
    : 0
  const detailTo = detailResult
    ? Math.min(detailResult.page * detailResult.pageSize, detailResult.total)
    : 0

  return (
    <div className="report-page">
      <aside className="report-filter-panel">
        <div className="report-panel-header">
          <div className="report-panel-title">
            <BarChart3 size={15} />
            <span>Bộ lọc</span>
          </div>
          <div className="report-panel-actions">
            <button className="btn btn-primary report-load-button" onClick={() => loadReport()} disabled={loadingOptions || loadingReport}>
              <Search size={14} />
              Tải báo cáo
            </button>
          </div>
        </div>

        <div className="report-filter-content" ref={filterRef}>
          <div className="report-dropdown-field">
            <span>Loại tài khoản</span>
            <button
              className={`report-filter-button ${openDropdown === 'platform' ? 'active' : ''}`}
              onClick={() => toggleDropdown('platform')}
              disabled={loadingOptions}
            >
              <strong>{getPlatformLabel(platform)}</strong>
              <ChevronDown size={14} />
            </button>
            {openDropdown === 'platform' && (
              <div className="report-filter-popover compact">
                {platforms.map(item => (
                  <button
                    key={item}
                    className={`report-option-button ${platform === item ? 'selected' : ''}`}
                    onClick={() => handlePlatformChange(item)}
                  >
                    {getPlatformLabel(item)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="report-dropdown-field">
            <span>Tài khoản</span>
            <button
              className={`report-filter-button ${openDropdown === 'accounts' ? 'active' : ''}`}
              onClick={() => toggleDropdown('accounts')}
            >
              <strong>{accountSummary}</strong>
              <ChevronDown size={14} />
            </button>
            {openDropdown === 'accounts' && (
              <div className="report-filter-popover wide">
                <div className="report-popover-header">
                  <span>{selectedAccountIdList.length}/{totalAccountCount} tài khoản</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleAccounts(platformAccounts.map(account => account.id))}>
                    {selectedAllAccounts ? 'Bỏ chọn' : 'Chọn tất cả'}
                  </button>
                </div>
                <div className="report-account-tree">
                  {platformGroups.map(group => {
                    const groupAccounts = groupedAccounts.byGroup.get(group.id) || []
                    if (groupAccounts.length === 0) return null
                    const groupSelected = groupAccounts.every(account => selectedAccountIds.has(account.id))
                    return (
                      <div className="report-account-group" key={group.id}>
                        <label className="report-check-row report-check-row-group">
                          <input
                            type="checkbox"
                            checked={groupSelected}
                            onChange={() => toggleAccounts(groupAccounts.map(account => account.id))}
                          />
                          <span>{group.name}</span>
                          <em>{groupAccounts.length}</em>
                        </label>
                        <div className="report-account-group-items">
                          {groupAccounts.map(account => (
                            <label className="report-check-row" key={account.id}>
                              <input
                                type="checkbox"
                                checked={selectedAccountIds.has(account.id)}
                                onChange={() => toggleAccount(account.id)}
                              />
                              <span title={account.name}>{account.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  {groupedAccounts.ungrouped.length > 0 && (
                    <div className="report-account-group">
                      <label className="report-check-row report-check-row-group">
                        <input
                          type="checkbox"
                          checked={groupedAccounts.ungrouped.every(account => selectedAccountIds.has(account.id))}
                          onChange={() => toggleAccounts(groupedAccounts.ungrouped.map(account => account.id))}
                        />
                        <span>Chưa có nhóm</span>
                        <em>{groupedAccounts.ungrouped.length}</em>
                      </label>
                      <div className="report-account-group-items">
                        {groupedAccounts.ungrouped.map(account => (
                          <label className="report-check-row" key={account.id}>
                            <input
                              type="checkbox"
                              checked={selectedAccountIds.has(account.id)}
                              onChange={() => toggleAccount(account.id)}
                            />
                            <span title={account.name}>{account.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {platformAccounts.length === 0 && (
                    <div className="report-muted">Không có tài khoản.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="report-dropdown-field">
            <span>Khoảng thời gian</span>
            <button
              className={`report-filter-button ${openDropdown === 'range' ? 'active' : ''}`}
              onClick={() => toggleDropdown('range')}
            >
              <strong>{rangeLabel}</strong>
              <ChevronDown size={14} />
            </button>
            {openDropdown === 'range' && (
              <div className="report-filter-popover">
                <div className="report-option-list">
                  {RANGE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      className={`report-option-button ${rangePreset === option.value ? 'selected' : ''}`}
                      onClick={() => setRangePreset(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {rangePreset === 'custom' && (
                  <div className="report-date-grid">
                    <label>
                      <span>Từ ngày</span>
                      <input type="date" value={customStartDate} onChange={event => setCustomStartDate(event.target.value)} />
                    </label>
                    <label>
                      <span>Đến ngày</span>
                      <input type="date" value={customEndDate} onChange={event => setCustomEndDate(event.target.value)} />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="report-dropdown-field">
            <span>Danh sách hành động</span>
            <button
              className={`report-filter-button ${openDropdown === 'actions' ? 'active' : ''}`}
              onClick={() => toggleDropdown('actions')}
            >
              <strong>{actionSummary}</strong>
              <ChevronDown size={14} />
            </button>
            {openDropdown === 'actions' && (
              <div className="report-filter-popover wide align-right">
                <div className="report-popover-header">
                  <span>{selectedActionCodeList.length}/{actions.length} hành động</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedActionCodes(selectedAllActions ? new Set() : new Set(actions.map(action => action.code)))}
                  >
                    {selectedAllActions ? 'Bỏ chọn' : 'Chọn tất cả'}
                  </button>
                </div>
                <div className="report-action-list">
                  {actions.map(action => (
                    <label className="report-check-row" key={action.code}>
                      <input
                        type="checkbox"
                        checked={selectedActionCodes.has(action.code)}
                        onChange={() => toggleAction(action.code)}
                      />
                      <span title={action.name}>{action.name}</span>
                    </label>
                  ))}
                  {actions.length === 0 && (
                    <div className="report-muted">Không có hành động.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="report-main-panel">
        <div className="report-main-header">
          <div>
            <div className="report-main-title">Báo cáo</div>
            <div className="report-main-meta">
              {report
                ? `${report.rows.length} tài khoản · ${report.actions.length} hành động · ${formatDateTimeLabel(report.generatedAt)}`
                : 'Đang chờ dữ liệu'}
            </div>
          </div>
          <div className="report-main-actions">
            <button className="btn btn-secondary" onClick={handleExport} disabled={loadingReport || !report || report.rows.length === 0}>
              <Download size={14} />
              Xuất Excel
            </button>
          </div>
        </div>

        <div className="report-table-wrap">
          {loadingReport ? (
            <div className="report-empty-state">Đang tải báo cáo...</div>
          ) : !report ? (
            <div className="report-empty-state">Chưa có dữ liệu báo cáo.</div>
          ) : report.rows.length === 0 || report.actions.length === 0 ? (
            <div className="report-empty-state">Không có dữ liệu phù hợp.</div>
          ) : (
            <table className="report-grid">
              <thead>
                <tr>
                  <th className="report-account-col" rowSpan={2}>Danh sách hành động/danh sách tài khoản chọn</th>
                  {report.actions.map(action => (
                    <th className="report-action-col" key={action.code} colSpan={3} title={action.name}>{action.name}</th>
                  ))}
                </tr>
                <tr>
                  {report.actions.map(action => (
                    <Fragment key={`${action.code}-statuses`}>
                      <th key={`${action.code}-pending`} className="report-status-col pending">Chờ xử lý</th>
                      <th key={`${action.code}-success`} className="report-status-col success">Thành công</th>
                      <th key={`${action.code}-failure`} className="report-status-col failure">Thất bại</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map(row => (
                  <tr key={row.account.id}>
                    <td className="report-account-col" title={row.account.name}>
                      <strong>{row.account.name}</strong>
                      {row.account.accountGroupName && <span>{row.account.accountGroupName}</span>}
                    </td>
                    {report.actions.map(action => {
                      const cell = row.countsByActionCode[action.code]
                      return (
                        <Fragment key={`${row.account.id}-${action.code}`}>
                          <td key={`${row.account.id}-${action.code}-pending`}>{renderReportCount(row.account, action, cell, 'pending')}</td>
                          <td key={`${row.account.id}-${action.code}-success`}>{renderReportCount(row.account, action, cell, 'success')}</td>
                          <td key={`${row.account.id}-${action.code}-failure`}>{renderReportCount(row.account, action, cell, 'failure')}</td>
                        </Fragment>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report && report.rows.length > 0 && report.actions.length > 0 && !reportHasCounts && !loadingReport && (
            <div className="report-table-note">Các bộ lọc hiện tại chưa có số liệu.</div>
          )}
        </div>
      </main>

      {detailModal && (
        <div className="modal-overlay report-detail-overlay" onClick={closeDetailModal}>
          <div className="modal report-detail-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header report-detail-header">
              <div>
                <div className="modal-title">
                  {detailModal.account.name} · {detailModal.action.name} · {detailModal.statusLabel}
                </div>
                <div className="report-detail-subtitle">
                  {detailResult
                    ? `${detailResult.total} dòng · ${formatDateTimeLabel(detailResult.generatedAt)}`
                    : `${detailModal.count} dòng`}
                </div>
              </div>
              <div className="report-detail-header-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExportDetail}
                  disabled={exportingDetail || loadingDetail}
                >
                  <Download size={14} />
                  {exportingDetail ? 'Đang xuất...' : 'Xuất Excel'}
                </button>
                <button type="button" className="btn-icon" onClick={closeDetailModal} title="Đóng">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="modal-body report-detail-body">
              <div className="report-detail-table-wrap">
                <table className="report-detail-grid">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Tài khoản</th>
                      <th>Chiến dịch</th>
                      <th>Hành động</th>
                      <th>Target</th>
                      <th>UID/Link target</th>
                      <th>SĐT</th>
                      <th>Email</th>
                      <th>Trạng thái</th>
                      <th>Chi tiết</th>
                      <th>Link bài viết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingDetail ? (
                      <tr>
                        <td colSpan={11} className="report-detail-empty">Đang tải chi tiết...</td>
                      </tr>
                    ) : !detailResult || detailResult.rows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="report-detail-empty">Không có dữ liệu chi tiết.</td>
                      </tr>
                    ) : (
                      detailResult.rows.map(row => (
                        <tr key={row.id}>
                          <td>{formatDateTimeLabel(row.occurredAt || undefined)}</td>
                          <td title={row.accountName}>{row.accountName}</td>
                          <td title={row.campaignName || ''}>{row.campaignName || '-'}</td>
                          <td title={row.actionName}>{row.actionName}</td>
                          <td title={formatTarget(row)}>{formatTarget(row) || '-'}</td>
                          <td title={row.targetUid || ''}>{row.targetUid || '-'}</td>
                          <td>{row.targetPhone || '-'}</td>
                          <td title={row.targetEmail || ''}>{row.targetEmail || '-'}</td>
                          <td>
                            <span className={`report-detail-status ${detailModal.statusBucket}`}>
                              {row.status}
                            </span>
                          </td>
                          <td title={row.detailText || ''}>{row.detailText || '-'}</td>
                          <td>
                            {row.postUrl ? (
                              <a href={row.postUrl} target="_blank" rel="noreferrer" title={row.postUrl}>
                                <ExternalLink size={13} />
                                Mở link
                              </a>
                            ) : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-footer report-detail-footer">
              <div className="report-detail-page-info">
                {detailResult && detailResult.total > 0
                  ? `Hiển thị ${detailFrom}-${detailTo} / ${detailResult.total}`
                  : 'Không có dữ liệu'}
              </div>
              <div className="report-detail-pagination">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => changeDetailPage(detailPage - 1)}
                  disabled={loadingDetail || detailPage <= 1}
                >
                  <ChevronLeft size={14} />
                  Trước
                </button>
                <span>{detailPage}/{detailTotalPages}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => changeDetailPage(detailPage + 1)}
                  disabled={loadingDetail || detailPage >= detailTotalPages}
                >
                  Sau
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
