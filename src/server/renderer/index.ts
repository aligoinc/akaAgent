import type {
  ZaloServerClearLogsResult,
  ZaloServerRuntimeEvent,
  ZaloServerRuntimeState,
  ZaloServerSnapshot,
  ZaloServerStaffSnapshot
} from '../../shared/zaloServerProtocol'

interface ZaloServerAdminBridge {
  getSnapshot(): Promise<ZaloServerSnapshot>
  clearLogs(): Promise<ZaloServerClearLogsResult>
  onRuntimeEvent(listener: (event: ZaloServerRuntimeEvent) => void): () => void
  onSnapshotUpdated(listener: (snapshot?: ZaloServerSnapshot) => void): () => void
}

declare global {
  interface Window {
    zaloServerAdmin?: ZaloServerAdminBridge
  }
}

const MAX_LOG_LINES = 1_000
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const ACCOUNT_STATUS_UPDATED_CHANNEL = 'account:status-updated'
const CAMPAIGN_STATUS_UPDATED_CHANNEL = 'campaign:status-updated'
const V2_RUN_CHANNEL_PREFIX = 'v2:run:'

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VIETNAM_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})

const stateLabels: Record<ZaloServerRuntimeState, string> = {
  waiting: 'Chờ desktop đóng',
  starting: 'Đang khởi động',
  running: 'Đang chạy',
  stopping: 'Đang dừng',
  stopped: 'Đã dừng',
  error: 'Lỗi'
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Không tìm thấy phần tử giao diện #${id}`)
  }
  return element as T
}

const connectionStatus = requiredElement<HTMLDivElement>('connection-status')
const connectionStatusText = requiredElement<HTMLSpanElement>('connection-status-text')
const metricHealth = requiredElement<HTMLElement>('metric-health')
const metricStarted = requiredElement<HTMLElement>('metric-started')
const metricListening = requiredElement<HTMLElement>('metric-listening')
const metricVietnamTime = requiredElement<HTMLElement>('metric-vietnam-time')
const metricTimezone = requiredElement<HTMLElement>('metric-timezone')
const metricClients = requiredElement<HTMLElement>('metric-clients')
const metricRuntimes = requiredElement<HTMLElement>('metric-runtimes')
const staffCount = requiredElement<HTMLElement>('staff-count')
const staffTableBody = requiredElement<HTMLTableSectionElement>('staff-table-body')
const filterStaff = requiredElement<HTMLSelectElement>('filter-staff')
const filterChannel = requiredElement<HTMLSelectElement>('filter-channel')
const filterText = requiredElement<HTMLInputElement>('filter-text')
const clearLogsButton = requiredElement<HTMLButtonElement>('clear-logs')
const logCount = requiredElement<HTMLElement>('log-count')
const logList = requiredElement<HTMLDivElement>('log-list')
const lastUpdated = requiredElement<HTMLElement>('last-updated')

let snapshot: ZaloServerSnapshot | null = null
let runtimeEvents: ZaloServerRuntimeEvent[] = []
let hydratedRecentEvents = false
let snapshotRequest: Promise<void> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRuntimeState(value: unknown): value is ZaloServerRuntimeState {
  return (
    value === 'starting' ||
    value === 'waiting' ||
    value === 'running' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'error'
  )
}

function isRuntimeEvent(value: unknown): value is ZaloServerRuntimeEvent {
  return (
    isRecord(value) &&
    Number.isFinite(value.sequence) &&
    typeof value.timestamp === 'string' &&
    Number.isFinite(value.staffId) &&
    Number.isFinite(value.organizationId) &&
    typeof value.channel === 'string'
  )
}

function isStaffSnapshot(value: unknown): value is ZaloServerStaffSnapshot {
  return (
    isRecord(value) &&
    Number.isFinite(value.staffId) &&
    Number.isFinite(value.organizationId) &&
    typeof value.staffName === 'string' &&
    typeof value.organizationName === 'string' &&
    isRuntimeState(value.state) &&
    (value.startedAt === null || typeof value.startedAt === 'string') &&
    (value.lastError === null || typeof value.lastError === 'string')
  )
}

function isSnapshot(value: unknown): value is ZaloServerSnapshot {
  return (
    isRecord(value) &&
    isRuntimeState(value.state) &&
    typeof value.startedAt === 'string' &&
    typeof value.vietnamTime === 'string' &&
    typeof value.timeZoneOk === 'boolean' &&
    typeof value.listeningAt === 'string' &&
    Number.isFinite(value.connectedClients) &&
    Number.isFinite(value.runtimeCount) &&
    Array.isArray(value.staffs) &&
    value.staffs.every(isStaffSnapshot) &&
    Array.isArray(value.recentEvents) &&
    value.recentEvents.every(isRuntimeEvent)
  )
}

function isClearLogsResult(value: unknown): value is ZaloServerClearLogsResult {
  return isRecord(value) &&
    typeof value.clearedThroughSequence === 'number' &&
    Number.isSafeInteger(value.clearedThroughSequence) &&
    value.clearedThroughSequence >= 0
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : dateTimeFormatter.format(parsed)
}

function eventKey(event: ZaloServerRuntimeEvent): string {
  return `${event.organizationId}:${event.staffId}:${event.sequence}`
}

function isVisibleAdminLogEvent(event: ZaloServerRuntimeEvent): boolean {
  if (event.channel === CAMPAIGN_STATUS_UPDATED_CHANNEL) return false
  if (event.channel.startsWith(V2_RUN_CHANNEL_PREFIX)) return false
  if (
    event.channel === ACCOUNT_STATUS_UPDATED_CHANNEL &&
    (event.payload === undefined || event.payload === null)
  ) {
    return false
  }
  return true
}

function mergeEvents(...groups: ZaloServerRuntimeEvent[][]): ZaloServerRuntimeEvent[] {
  const unique = new Map<string, ZaloServerRuntimeEvent>()
  for (const group of groups) {
    for (const event of group) {
      if (!isVisibleAdminLogEvent(event)) continue
      unique.set(eventKey(event), event)
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => {
      const timeDifference = parseTimestamp(left.timestamp) - parseTimestamp(right.timestamp)
      if (timeDifference !== 0) return timeDifference
      if (left.sequence !== right.sequence) return left.sequence - right.sequence
      return left.staffId - right.staffId
    })
    .slice(-MAX_LOG_LINES)
}

function setConnectionStatus(kind: 'loading' | 'ok' | 'error', message: string): void {
  connectionStatus.classList.remove('is-loading', 'is-ok', 'is-error')
  connectionStatus.classList.add(`is-${kind}`)
  connectionStatusText.textContent = message
}

function createIdentityCell(primary: string, secondary: string): HTMLTableCellElement {
  const cell = document.createElement('td')
  const primaryElement = document.createElement('span')
  const secondaryElement = document.createElement('span')
  primaryElement.className = 'identity-primary'
  primaryElement.textContent = primary
  secondaryElement.className = 'identity-secondary'
  secondaryElement.textContent = secondary
  cell.append(primaryElement, secondaryElement)
  return cell
}

function renderStaffTable(staffs: ZaloServerStaffSnapshot[]): void {
  staffTableBody.replaceChildren()

  if (staffs.length === 0) {
    const row = document.createElement('tr')
    row.className = 'empty-row'
    const cell = document.createElement('td')
    cell.colSpan = 5
    cell.textContent = 'Chưa có runtime nhân viên nào.'
    row.append(cell)
    staffTableBody.append(row)
    return
  }

  const fragment = document.createDocumentFragment()
  for (const staff of [...staffs].sort((left, right) => left.staffId - right.staffId)) {
    const row = document.createElement('tr')
    row.append(
      createIdentityCell(staff.staffName || `Staff #${staff.staffId}`, `ID ${staff.staffId}`),
      createIdentityCell(
        staff.organizationName || `Organization #${staff.organizationId}`,
        `ID ${staff.organizationId}`
      )
    )

    const stateCell = document.createElement('td')
    const state = document.createElement('span')
    state.className = `runtime-state state-${staff.state}`
    state.textContent = stateLabels[staff.state]
    stateCell.append(state)

    const startedCell = document.createElement('td')
    startedCell.textContent = formatTimestamp(staff.startedAt)

    const errorCell = document.createElement('td')
    const error = document.createElement('span')
    if (staff.lastError) {
      error.className = 'error-text'
      error.textContent = staff.lastError
      error.title = staff.lastError
    } else {
      error.className = 'muted-text'
      error.textContent = 'Không có'
    }
    errorCell.append(error)

    row.append(stateCell, startedCell, errorCell)
    fragment.append(row)
  }
  staffTableBody.append(fragment)
}

function renderSnapshot(): void {
  if (!snapshot) return

  metricHealth.textContent = stateLabels[snapshot.state]
  metricStarted.textContent = `Khởi động lúc ${formatTimestamp(snapshot.startedAt)}`
  metricListening.textContent = snapshot.listeningAt || '—'
  metricListening.title = snapshot.listeningAt
  metricVietnamTime.textContent = formatTimestamp(snapshot.vietnamTime)
  metricTimezone.textContent = snapshot.timeZoneOk
    ? `Múi giờ ${VIETNAM_TIME_ZONE} hợp lệ`
    : 'Cảnh báo múi giờ máy chủ không đúng'
  metricTimezone.classList.toggle('is-ok', snapshot.timeZoneOk)
  metricTimezone.classList.toggle('is-error', !snapshot.timeZoneOk)
  metricClients.textContent = String(snapshot.connectedClients)
  metricRuntimes.textContent = String(snapshot.runtimeCount)
  staffCount.textContent = `${snapshot.staffs.length} nhân viên`
  renderStaffTable(snapshot.staffs)

  if (snapshot.state === 'error') {
    setConnectionStatus('error', 'Máy chủ đang báo lỗi')
  } else {
    setConnectionStatus('ok', 'Dữ liệu trực tiếp')
  }

  lastUpdated.textContent = `Cập nhật ${dateTimeFormatter.format(new Date())}`
}

function staffLabel(staffId: number): string {
  const staff = snapshot?.staffs.find((item) => item.staffId === staffId)
  return staff?.staffName ? `${staff.staffName} (#${staffId})` : `Staff #${staffId}`
}

function organizationLabel(event: ZaloServerRuntimeEvent): string {
  const staff = snapshot?.staffs.find(
    (item) => item.staffId === event.staffId && item.organizationId === event.organizationId
  )
  return staff?.organizationName || `Organization #${event.organizationId}`
}

function replaceSelectOptions(
  select: HTMLSelectElement,
  allLabel: string,
  options: Array<{ value: string; label: string }>
): void {
  const selectedValue = select.value
  const fragment = document.createDocumentFragment()
  const allOption = document.createElement('option')
  allOption.value = ''
  allOption.textContent = allLabel
  fragment.append(allOption)
  for (const optionValue of options) {
    const option = document.createElement('option')
    option.value = optionValue.value
    option.textContent = optionValue.label
    fragment.append(option)
  }
  select.replaceChildren(fragment)
  select.value = options.some((option) => option.value === selectedValue) ? selectedValue : ''
}

function renderFilterOptions(): void {
  const staffIds = new Set<number>(snapshot?.staffs.map((staff) => staff.staffId) ?? [])
  for (const event of runtimeEvents) staffIds.add(event.staffId)

  replaceSelectOptions(
    filterStaff,
    'Tất cả nhân viên',
    Array.from(staffIds)
      .sort((left, right) => left - right)
      .map((staffId) => ({ value: String(staffId), label: staffLabel(staffId) }))
  )

  const channels = Array.from(new Set(runtimeEvents.map((event) => event.channel))).sort((left, right) =>
    left.localeCompare(right, 'vi')
  )
  replaceSelectOptions(
    filterChannel,
    'Tất cả kênh',
    channels.map((channel) => ({ value: channel, label: channel }))
  )
}

function stringifyPayload(payload: unknown): string {
  if (payload === null) return 'null'
  if (payload === undefined) return 'undefined'
  if (typeof payload === 'string') return payload
  if (typeof payload === 'number' || typeof payload === 'boolean' || typeof payload === 'bigint') {
    return String(payload)
  }

  if (isRecord(payload)) {
    for (const key of ['message', 'log', 'error', 'event', 'status']) {
      if (typeof payload[key] === 'string' && payload[key].trim()) {
        return payload[key]
      }
    }
  }

  try {
    const serialized = JSON.stringify(payload)
    return serialized === undefined ? String(payload) : serialized
  } catch {
    return '[Không thể hiển thị payload]'
  }
}

function eventSearchText(event: ZaloServerRuntimeEvent): string {
  return [
    event.staffId,
    staffLabel(event.staffId),
    event.organizationId,
    organizationLabel(event),
    event.channel,
    stringifyPayload(event.payload)
  ]
    .join(' ')
    .toLocaleLowerCase('vi')
}

function filteredEvents(): ZaloServerRuntimeEvent[] {
  const selectedStaffId = filterStaff.value ? Number(filterStaff.value) : null
  const selectedChannel = filterChannel.value
  const text = filterText.value.trim().toLocaleLowerCase('vi')

  return runtimeEvents.filter((event) => {
    if (selectedStaffId !== null && event.staffId !== selectedStaffId) return false
    if (selectedChannel && event.channel !== selectedChannel) return false
    return !text || eventSearchText(event).includes(text)
  })
}

function renderLogs(scrollToLatest = false): void {
  const distanceFromBottom = logList.scrollHeight - logList.scrollTop - logList.clientHeight
  const shouldFollowTail = scrollToLatest && distanceFromBottom < 48
  const visibleEvents = filteredEvents()
  logCount.textContent = `${visibleEvents.length} / ${runtimeEvents.length} dòng`
  logList.replaceChildren()

  if (visibleEvents.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'log-empty'
    empty.textContent = runtimeEvents.length === 0 ? 'Chưa có log runtime.' : 'Không có log phù hợp bộ lọc.'
    logList.append(empty)
    return
  }

  const fragment = document.createDocumentFragment()
  for (const event of visibleEvents) {
    const row = document.createElement('div')
    row.className = 'log-row'

    const time = document.createElement('span')
    time.className = 'log-time'
    time.textContent = formatTimestamp(event.timestamp)

    const staff = document.createElement('span')
    staff.className = 'log-staff'
    staff.textContent = `Staff #${event.staffId}`
    staff.title = `${staffLabel(event.staffId)} · ${organizationLabel(event)}`

    const channel = document.createElement('span')
    channel.className = 'log-channel'
    channel.textContent = event.channel
    channel.title = event.channel

    const message = document.createElement('span')
    message.className = 'log-message'
    message.textContent = stringifyPayload(event.payload)

    row.append(time, staff, channel, message)
    fragment.append(row)
  }
  logList.append(fragment)

  if (shouldFollowTail) logList.scrollTop = logList.scrollHeight
}

function applySnapshot(nextSnapshot: ZaloServerSnapshot): void {
  snapshot = nextSnapshot
  if (!hydratedRecentEvents) {
    runtimeEvents = mergeEvents(nextSnapshot.recentEvents, runtimeEvents)
    hydratedRecentEvents = true
  }
  renderSnapshot()
  renderFilterOptions()
  renderLogs(true)
}

function handleSnapshotError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  setConnectionStatus('error', 'Không lấy được dữ liệu máy chủ')
  connectionStatus.title = message
  if (!snapshot) {
    staffTableBody.innerHTML = '<tr class="empty-row"><td colspan="5">Không thể tải dữ liệu runtime.</td></tr>'
  }
}

function refreshSnapshot(): Promise<void> {
  if (snapshotRequest) return snapshotRequest
  const bridge = window.zaloServerAdmin
  if (!bridge) {
    handleSnapshotError(new Error('Preload bridge chưa sẵn sàng'))
    return Promise.resolve()
  }

  snapshotRequest = bridge
    .getSnapshot()
    .then((nextSnapshot) => {
      if (!isSnapshot(nextSnapshot)) throw new Error('Snapshot máy chủ không đúng định dạng')
      applySnapshot(nextSnapshot)
    })
    .catch(handleSnapshotError)
    .finally(() => {
      snapshotRequest = null
    })
  return snapshotRequest
}

filterStaff.addEventListener('change', () => renderLogs(false))
filterChannel.addEventListener('change', () => renderLogs(false))
filterText.addEventListener('input', () => renderLogs(false))
clearLogsButton.addEventListener('click', () => {
  const bridge = window.zaloServerAdmin
  if (!bridge || clearLogsButton.disabled) return
  if (!window.confirm('Xóa toàn bộ log đang hiển thị, bộ đệm realtime và file log trên máy chủ?')) return

  clearLogsButton.disabled = true
  clearLogsButton.textContent = 'Đang xóa…'
  void bridge.clearLogs()
    .then((result) => {
      if (!isClearLogsResult(result)) throw new Error('Kết quả xóa log không hợp lệ')
      // Preserve any event emitted after the synchronous main-process flush,
      // even if its IPC delivery races the clear request response.
      runtimeEvents = runtimeEvents.filter(event => event.sequence > result.clearedThroughSequence)
      hydratedRecentEvents = true
      if (snapshot) snapshot = { ...snapshot, recentEvents: [] }
      renderFilterOptions()
      renderLogs(false)
      lastUpdated.textContent = `Cập nhật ${dateTimeFormatter.format(new Date())}`
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Không thể xóa log: ${message}`)
    })
    .finally(() => {
      clearLogsButton.disabled = false
      clearLogsButton.textContent = 'Xóa log'
    })
})

const bridge = window.zaloServerAdmin
const unsubscribeRuntime = bridge?.onRuntimeEvent((event) => {
  if (!isRuntimeEvent(event)) return
  runtimeEvents = mergeEvents(runtimeEvents, [event])
  renderFilterOptions()
  renderLogs(true)
  lastUpdated.textContent = `Cập nhật ${dateTimeFormatter.format(new Date())}`
})
const unsubscribeSnapshot = bridge?.onSnapshotUpdated((nextSnapshot) => {
  if (isSnapshot(nextSnapshot)) {
    applySnapshot(nextSnapshot)
  } else {
    void refreshSnapshot()
  }
})

window.addEventListener('beforeunload', () => {
  unsubscribeRuntime?.()
  unsubscribeSnapshot?.()
})

void refreshSnapshot()
