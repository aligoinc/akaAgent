import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Info, Mail, Pause, Play, Plus, RefreshCw, Save, Send, Smartphone, Trash2, TriangleAlert, X } from 'lucide-react'
import type {
  NotificationDevice,
  NotificationSettings,
  NotificationSubscriptionBase,
  NotificationSubscriptions,
  NotificationTestChannel,
  SaveNotificationSettingsRequest
} from '../../../../shared/types'
import {
  NOTIFICATION_ACCOUNT_RUN_STATUSES,
  NOTIFICATION_BUCKET_MINUTES,
  NOTIFICATION_CAMPAIGN_STATUSES,
  NOTIFICATION_CENTER_NOT_READY,
  NOTIFICATION_CENTER_UNAVAILABLE,
  NOTIFICATION_DEFAULT_TIMEZONE,
  NOTIFICATION_GROUP_ACTIONS,
  NOTIFICATION_GROUP_ACTION_LABELS,
  NOTIFICATION_LOGIN_EVENTS,
  NOTIFICATION_LOGIN_EVENT_LABELS,
  NOTIFICATION_MAX_EMAILS,
  NOTIFICATION_MAX_REPORT_TIMES,
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_WEEK_DAYS,
  NOTIFICATION_WEEK_DAY_LABELS,
  isValidNotificationEmail,
  normalizeNotificationEmails,
  validateNotificationSettingsDraft
} from '../../../../shared/notificationCenter'
import { useUiStore } from '../../stores/uiStore'
import NotificationInbox from './NotificationInbox'
import { AccountTargetPicker, CampaignTargetPicker, DataGroupTargetPicker } from './NotificationTargetPicker'
import { createNotificationTimeFormat, type NotificationTimeFormat } from './notificationTimeFormat'
import './notificationCenter.css'

/** Phần người dùng sửa và lưu bằng save_settings; thiết bị iPhone đổi trực tiếp, không qua nháp. */
interface NotificationDraft {
  channels: { email: { enabled: boolean; recipients: string[] }; push: { enabled: boolean } }
  subscriptions: NotificationSubscriptions
}

type SubscriptionKey = keyof NotificationSubscriptions
type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'not_ready' } | { kind: 'error'; message: string }
type FormError = { message: string; reload: boolean } | null

// DB chưa có V457: dùng form email cũ, chỉ hỏi lại RPC sau 10 phút (giống API WebApp).
const NOT_READY_RECHECK_MS = 10 * 60_000
let notReadyUntil = 0

const ROWS: Array<{ key: SubscriptionKey; label: string }> = [
  { key: 'campaignStatus', label: 'Chiến dịch thay đổi trạng thái' },
  { key: 'accountStatus', label: 'Tài khoản thay đổi trạng thái' },
  { key: 'scheduledReport', label: 'Báo cáo theo lịch' },
  { key: 'dataGroupMembership', label: 'Dữ liệu vào/rời nhóm (bộ lọc động)' }
]

const DEFAULT_NEW_TIMES = ['08:00', '12:00', '17:00', '20:00', ...Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)]

const orderBy = <T,>(values: readonly T[], order: readonly T[]): T[] => order.filter(value => values.includes(value))
const toggleValue = <T,>(values: readonly T[], value: T): T[] => (values.includes(value) ? values.filter(item => item !== value) : [...values, value])
const sortedIds = (ids: number[] | null): number[] | null => (ids === null ? null : Array.from(new Set(ids)).sort((a, b) => a - b))

function toDraft(settings: NotificationSettings): NotificationDraft {
  return {
    channels: {
      email: { enabled: settings.channels.email.enabled, recipients: [...settings.channels.email.recipients] },
      push: { enabled: settings.channels.push.enabled }
    },
    subscriptions: settings.subscriptions
  }
}

function buildSaveRequest(revision: number, draft: NotificationDraft): SaveNotificationSettingsRequest {
  const { campaignStatus: c, accountStatus: a, scheduledReport: r, dataGroupMembership: g } = draft.subscriptions
  const base = (sub: NotificationSubscriptionBase) => ({ enabled: sub.enabled, email: sub.email, push: sub.push, cooldownMinutes: sub.cooldownMinutes })
  return {
    revision,
    channels: {
      email: { enabled: draft.channels.email.enabled, recipients: normalizeNotificationEmails(draft.channels.email.recipients) },
      push: { enabled: draft.channels.push.enabled }
    },
    subscriptions: {
      campaignStatus: { ...base(c), toStatuses: orderBy(c.toStatuses, NOTIFICATION_CAMPAIGN_STATUSES), campaignIds: sortedIds(c.campaignIds) },
      accountStatus: {
        ...base(a),
        loginEvents: orderBy(a.loginEvents, NOTIFICATION_LOGIN_EVENTS),
        runStatuses: orderBy(a.runStatuses, NOTIFICATION_ACCOUNT_RUN_STATUSES),
        accountIds: sortedIds(a.accountIds)
      },
      scheduledReport: { ...base(r), weekDays: orderBy(r.weekDays, NOTIFICATION_WEEK_DAYS), times: [...r.times].sort(), skipWhenIdle: r.skipWhenIdle },
      dataGroupMembership: {
        ...base(g),
        groupIds: sortedIds(g.groupIds),
        actions: orderBy(g.actions, NOTIFICATION_GROUP_ACTIONS),
        bucketMinutes: g.bucketMinutes,
        includeSharedGroups: g.includeSharedGroups
      }
    }
  }
}

const draftKey = (draft: NotificationDraft): string => JSON.stringify(buildSaveRequest(0, draft))

function channelSummary(sub: NotificationSubscriptionBase): string {
  if (sub.push && sub.email) return 'App và Email'
  if (sub.push) return 'App'
  if (sub.email) return 'Email'
  return sub.enabled ? 'Chỉ lưu trong hộp thư' : 'Đang tắt'
}

const scopeSummary = (ids: number[] | null, noun: string): string => (ids === null ? `tất cả ${noun}` : `${ids.length} ${noun} đã chọn`)

function weekDaysSummary(days: number[]): string {
  if (days.length === NOTIFICATION_WEEK_DAYS.length) return 'Hằng ngày'
  return orderBy(days, NOTIFICATION_WEEK_DAYS).map(day => NOTIFICATION_WEEK_DAY_LABELS[day]).join(', ') || '(chưa chọn ngày)'
}

function rowSummary(key: SubscriptionKey, subscriptions: NotificationSubscriptions): string {
  switch (key) {
    case 'campaignStatus': {
      const c = subscriptions.campaignStatus
      const statuses = orderBy(c.toStatuses, NOTIFICATION_CAMPAIGN_STATUSES).map(status => NOTIFICATION_STATUS_LABELS[status])
      return `Khi chuyển sang ${statuses.length ? statuses.join(', ') : '(chưa chọn trạng thái)'} · ${scopeSummary(c.campaignIds, 'chiến dịch')}`
    }
    case 'accountStatus': {
      const a = subscriptions.accountStatus
      const events = [
        ...orderBy(a.loginEvents, NOTIFICATION_LOGIN_EVENTS).map(event => NOTIFICATION_LOGIN_EVENT_LABELS[event]),
        ...orderBy(a.runStatuses, NOTIFICATION_ACCOUNT_RUN_STATUSES).map(status => NOTIFICATION_STATUS_LABELS[status])
      ]
      return `${events.length ? events.join(', ') : '(chưa chọn sự kiện)'} · ${scopeSummary(a.accountIds, 'tài khoản')}`
    }
    case 'scheduledReport': {
      const r = subscriptions.scheduledReport
      const times = [...r.times].sort().join(', ') || '--:--'
      return `${weekDaysSummary(r.weekDays)} lúc ${times}${r.skipWhenIdle ? ' · bỏ qua khi không có hoạt động' : ''}`
    }
    case 'dataGroupMembership': {
      const g = subscriptions.dataGroupMembership
      const actions = orderBy(g.actions, NOTIFICATION_GROUP_ACTIONS).map(action => NOTIFICATION_GROUP_ACTION_LABELS[action])
      const shared = g.groupIds === null && g.includeSharedGroups ? ' · gồm nhóm được chia sẻ' : ''
      return `${actions.length ? actions.join(', ') : '(chưa chọn thay đổi)'} · gộp ${g.bucketMinutes} phút · ${scopeSummary(g.groupIds, 'nhóm')}${shared}`
    }
  }
}

const deviceName = (device: NotificationDevice): string => device.name || device.model || 'iPhone'

function deviceMeta(device: NotificationDevice, format: NotificationTimeFormat): string {
  return [
    device.model && device.model !== device.name ? device.model : null,
    device.osVersion ? `iOS ${device.osVersion}` : null,
    device.appVersion ? `app ${device.appVersion}` : null,
    device.lastSuccessAt ? `nhận gần nhất ${format.relative(device.lastSuccessAt).replace(/^H/, 'h')}` : null
  ].filter(Boolean).join(' · ')
}

function deviceWarning(device: NotificationDevice): string | null {
  if (device.permissionStatus === 'denied') return 'Thông báo của app đang bị tắt trong Cài đặt của iPhone.'
  if (!device.hasToken) return 'Máy chưa cấp quyền nhận thông báo.'
  return null
}

function ToggleChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`nc-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  )
}

function ScopeChoice({ name, all, allLabel, selectedLabel, onChange }: {
  name: string
  all: boolean
  allLabel: string
  selectedLabel: string
  onChange: (all: boolean) => void
}) {
  return (
    <div className="nc-scope" role="radiogroup">
      <label className="nc-radio">
        <input type="radio" name={name} checked={all} onChange={() => onChange(true)} />
        <span>{allLabel}</span>
      </label>
      <label className="nc-radio">
        <input type="radio" name={name} checked={!all} onChange={() => onChange(false)} />
        <span>{selectedLabel}</span>
      </label>
    </div>
  )
}

/**
 * Mục "Nhận thông báo" theo trung tâm thông báo V457. DB chưa có RPC thì hiện `legacyContent`
 * (form email cũ, giữ nguyên hành vi). Lưu theo `revision` (CAS); lệch phiên bản giữ nháp và
 * mời tải lại. Chỉ gọi RPC khi mở mục và khi người dùng thao tác: không poll, không hẹn giờ.
 */
export default function NotificationCenterSettings({ legacyContent, onBusyChange }: {
  legacyContent: ReactNode
  onBusyChange: (busy: boolean) => void
}) {
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [phase, setPhase] = useState<Phase>(() => (Date.now() < notReadyUntil ? { kind: 'not_ready' } : { kind: 'loading' }))
  const [saved, setSaved] = useState<NotificationSettings | null>(null)
  const [draft, setDraft] = useState<NotificationDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [formError, setFormError] = useState<FormError>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Partial<Record<SubscriptionKey, boolean>>>({})
  const [addingEmail, setAddingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const settingsRequest = useRef(0)
  const actionLock = useRef<string | null>(null)
  const rememberedIds = useRef<Partial<Record<SubscriptionKey, number[]>>>({})
  const scheduleRef = useRef<HTMLElement>(null)
  const idPrefix = useId()
  const api = window.electronAPI.notificationCenter

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const request = ++settingsRequest.current
    const center = window.electronAPI?.notificationCenter
    if (!center) {
      setPhase({ kind: 'not_ready' })
      return
    }
    if (mode === 'initial') setPhase({ kind: 'loading' })
    else setRefreshing(true)
    try {
      const result = await center.getSettings()
      if (request !== settingsRequest.current) return
      if (result.ok) {
        setSaved(result.data)
        setDraft(toDraft(result.data))
        setConflict(false)
        setFormError(null)
        setPhase({ kind: 'ready' })
        return
      }
      if (result.code === NOTIFICATION_CENTER_NOT_READY) {
        notReadyUntil = Date.now() + NOT_READY_RECHECK_MS
        setPhase({ kind: 'not_ready' })
        return
      }
      if (mode === 'initial') setPhase({ kind: 'error', message: result.message })
      else setFormError({ message: result.message, reload: true })
    } catch {
      if (request !== settingsRequest.current) return
      const message = 'Không thể tải cài đặt thông báo. Vui lòng thử lại.'
      if (mode === 'initial') setPhase({ kind: 'error', message })
      else setFormError({ message, reload: true })
    } finally {
      if (request === settingsRequest.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (Date.now() >= notReadyUntil) void load('initial')
    return () => { settingsRequest.current++ }
  }, [load])

  useEffect(() => { onBusyChange(saving || actionBusy !== null) }, [saving, actionBusy, onBusyChange])
  useEffect(() => () => onBusyChange(false), [onBusyChange])

  const dirty = useMemo(() => (saved && draft ? draftKey(draft) !== draftKey(toDraft(saved)) : false), [saved, draft])
  const format = useMemo(() => createNotificationTimeFormat(saved?.timezone ?? NOTIFICATION_DEFAULT_TIMEZONE), [saved?.timezone])

  const updateDraft = (patch: (current: NotificationDraft) => NotificationDraft) => {
    setDraft(current => (current ? patch(current) : current))
    setFormError(null)
  }

  const updateSubscription = <K extends SubscriptionKey>(key: K, patch: (current: NotificationSubscriptions[K]) => NotificationSubscriptions[K]) => {
    updateDraft(current => {
      const subscriptions = { ...current.subscriptions }
      subscriptions[key] = patch(current.subscriptions[key])
      return { ...current, subscriptions }
    })
  }

  const setRowChannel = (key: SubscriptionKey, channel: 'email' | 'push', value: boolean) => {
    updateSubscription(key, current => {
      const next = { ...current, [channel]: value }
      // Một loại thông báo bật khi có ít nhất một kênh; tắt cả hai kênh thì không tạo thông báo.
      return { ...next, enabled: next.email || next.push }
    })
  }

  /** Chuyển Tất cả ↔ Đã chọn; nhớ lựa chọn cũ trong phiên để bấm nhầm không mất danh sách. */
  const setScope = (key: 'campaignStatus' | 'accountStatus' | 'dataGroupMembership', all: boolean) => {
    if (!draft) return
    const current = key === 'campaignStatus' ? draft.subscriptions.campaignStatus.campaignIds
      : key === 'accountStatus' ? draft.subscriptions.accountStatus.accountIds
        : draft.subscriptions.dataGroupMembership.groupIds
    if (all && current !== null) rememberedIds.current[key] = current
    const next = all ? null : current ?? rememberedIds.current[key] ?? []
    if (key === 'campaignStatus') updateSubscription(key, sub => ({ ...sub, campaignIds: next }))
    else if (key === 'accountStatus') updateSubscription(key, sub => ({ ...sub, accountIds: next }))
    else updateSubscription(key, sub => ({ ...sub, groupIds: next }))
  }

  const setEmailEnabled = (enabled: boolean) => updateDraft(current => ({
    ...current, channels: { ...current.channels, email: { ...current.channels.email, enabled } }
  }))
  const setPushEnabled = (enabled: boolean) => updateDraft(current => ({
    ...current, channels: { ...current.channels, push: { enabled } }
  }))
  const removeEmail = (email: string) => updateDraft(current => ({
    ...current,
    channels: { ...current.channels, email: { ...current.channels.email, recipients: current.channels.email.recipients.filter(item => item !== email) } }
  }))

  const addEmail = () => {
    if (!draft) return
    const email = newEmail.trim().toLowerCase()
    if (!email) return setEmailError('Nhập địa chỉ email.')
    if (!isValidNotificationEmail(email)) return setEmailError('Email không hợp lệ.')
    if (draft.channels.email.recipients.includes(email)) return setEmailError('Email này đã có trong danh sách.')
    if (draft.channels.email.recipients.length >= NOTIFICATION_MAX_EMAILS) return setEmailError(`Tối đa ${NOTIFICATION_MAX_EMAILS} email.`)
    updateDraft(current => ({
      ...current,
      channels: { ...current.channels, email: { ...current.channels.email, recipients: [...current.channels.email.recipients, email] } }
    }))
    setNewEmail('')
    setEmailError('')
    setAddingEmail(false)
  }

  const cancelAddEmail = () => {
    setAddingEmail(false)
    setNewEmail('')
    setEmailError('')
  }

  /** Mỗi lúc chỉ một thao tác trực tiếp (gửi thử, xác nhận email, iPhone); khóa cả khi đang lưu. */
  const runAction = async (key: string, task: () => Promise<void>) => {
    if (actionLock.current || saving || refreshing) return
    actionLock.current = key
    setActionBusy(key)
    try {
      await task()
    } finally {
      actionLock.current = null
      setActionBusy(null)
    }
  }

  const updateDevices = (patch: (devices: NotificationDevice[]) => NotificationDevice[]) => {
    setSaved(current => (current
      ? { ...current, channels: { ...current.channels, push: { ...current.channels.push, devices: patch(current.channels.push.devices) } } }
      : current))
  }

  const sendTest = (channel: NotificationTestChannel) => runAction(`test:${channel}`, async () => {
    try {
      const result = await api.test(channel)
      if (!result.ok) {
        showAlert(result.message, 'error')
        return
      }
      if (result.data.deliveryMode === 'live') {
        showAlert(channel === 'email'
          ? 'Đã gửi email thử tới các địa chỉ đã xác nhận. Vui lòng kiểm tra hộp thư sau ít phút.'
          : 'Đã gửi thông báo thử tới iPhone. Vui lòng kiểm tra sau ít phút.', 'success')
      } else {
        showAlert('Đã tạo thông báo thử. Hệ thống đang chạy thử nên chưa gửi thật; thông báo sẽ hiện trong mục Thông báo gần đây sau ít phút.', 'info')
      }
    } catch {
      showAlert('Không thể gửi thử. Vui lòng thử lại.', 'error')
    }
  })

  const resendVerification = (email: string) => runAction(`resend:${email}`, async () => {
    try {
      const result = await api.resendVerification(email)
      if (!result.ok) {
        showAlert(result.message, 'error')
        return
      }
      if (result.data.requested) {
        showAlert(`Đã gửi lại email xác nhận tới ${email}. Vui lòng kiểm tra hộp thư, kể cả mục Spam.`, 'success')
      } else if (saved?.centerEnabled) {
        showAlert(`Hôm nay đã gửi email xác nhận tới ${email}. Vui lòng kiểm tra hộp thư (kể cả mục Spam) hoặc gửi lại vào ngày mai.`, 'info')
      } else {
        showAlert('Trung tâm thông báo đang tạm tắt nên chưa gửi email xác nhận.', 'info')
      }
    } catch {
      showAlert('Không thể gửi lại email xác nhận. Vui lòng thử lại.', 'error')
    }
  })

  const toggleDevice = (device: NotificationDevice) => runAction(`device:${device.id}`, async () => {
    try {
      const result = await api.setDeviceEnabled(device.id, !device.enabled)
      if (result.ok) {
        updateDevices(devices => devices.map(item => (item.id === device.id ? { ...item, enabled: !device.enabled } : item)))
        return
      }
      if (result.code === 'notification_device_not_found') updateDevices(devices => devices.filter(item => item.id !== device.id))
      showAlert(result.message, 'error')
    } catch {
      showAlert('Không thể cập nhật iPhone. Vui lòng thử lại.', 'error')
    }
  })

  const removeDevice = (device: NotificationDevice) => {
    showConfirm(
      `Gỡ "${deviceName(device)}" khỏi danh sách nhận thông báo? Máy này sẽ không nhận thông báo cho tới khi mở app akaBiz trên iPhone và bật nhận thông báo lại.`,
      () => runAction(`device:${device.id}`, async () => {
        try {
          const result = await api.unregisterDevice(device.id)
          if (!result.ok) {
            showAlert(result.message, 'error')
            return
          }
          updateDevices(devices => devices.filter(item => item.id !== device.id))
        } catch {
          showAlert('Không thể gỡ iPhone. Vui lòng thử lại.', 'error')
        }
      }),
      { title: 'Gỡ iPhone', confirmText: 'Gỡ', variant: 'danger' }
    )
  }

  const save = async () => {
    if (!saved || !draft || saving || refreshing || conflict || actionLock.current) return
    const invalid = validateNotificationSettingsDraft(draft)
    if (invalid) {
      setFormError({ message: invalid, reload: false })
      return
    }
    const request = ++settingsRequest.current
    setSaving(true)
    setFormError(null)
    try {
      const result = await api.saveSettings(buildSaveRequest(saved.revision, draft))
      if (request !== settingsRequest.current) return
      if (result.ok) {
        setSaved(result.data)
        setDraft(toDraft(result.data))
        showAlert('Đã lưu cài đặt thông báo.', 'success')
        return
      }
      if (result.code === 'notification_settings_conflict') {
        setConflict(true)
        return
      }
      setFormError(result.code === NOTIFICATION_CENTER_UNAVAILABLE
        ? { message: 'Chưa xác nhận được kết quả lưu. Bạn có thể lưu lại hoặc tải lại cài đặt để kiểm tra.', reload: true }
        : { message: result.message, reload: result.code === NOTIFICATION_CENTER_NOT_READY || result.code === 'notification_session_changed' })
    } catch {
      if (request === settingsRequest.current) {
        setFormError({ message: 'Chưa xác nhận được kết quả lưu. Bạn có thể lưu lại hoặc tải lại cài đặt để kiểm tra.', reload: true })
      }
    } finally {
      if (request === settingsRequest.current) setSaving(false)
    }
  }

  const reloadLatest = () => {
    if (saving || refreshing) return
    if (!dirty) {
      void load('refresh')
      return
    }
    showConfirm('Tải lại cài đặt mới nhất? Các thay đổi chưa lưu trên máy này sẽ bị bỏ.', () => load('refresh'),
      { title: 'Tải lại cài đặt', confirmText: 'Tải lại', variant: 'primary' })
  }

  const focusSchedule = () => {
    scheduleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    scheduleRef.current?.focus({ preventScroll: true })
  }

  if (phase.kind === 'not_ready') return <>{legacyContent}</>
  if (phase.kind === 'loading') {
    return <div className="nc-settings"><p className="nc-empty" role="status">Đang tải...</p></div>
  }
  if (phase.kind === 'error') {
    return (
      <div className="nc-settings">
        <div className="nc-load-error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{phase.message}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load('initial')}>Thử lại</button>
        </div>
      </div>
    )
  }
  if (!saved || !draft) return null

  const subscriptions = draft.subscriptions
  const emailOn = draft.channels.email.enabled
  const pushOn = draft.channels.push.enabled
  const savedRecipients = saved.channels.email.recipients
  const verifiedRecipients = savedRecipients.filter(email => !saved.channels.email.unverified.includes(email))
  const devices = saved.channels.push.devices
  const actionsLocked = saving || refreshing || actionBusy !== null
  const disabledCenter = 'Trung tâm thông báo đang tạm tắt.'
  const emailTestBlocker = !saved.centerEnabled ? disabledCenter
    : verifiedRecipients.length === 0 ? 'Cần ít nhất một email đã lưu và đã xác nhận.' : ''
  const pushTestBlocker = !saved.centerEnabled ? disabledCenter
    : !devices.some(device => device.enabled && device.hasToken) ? 'Chưa có iPhone nào đang nhận thông báo.' : ''
  const report = subscriptions.scheduledReport
  const savedReport = saved.subscriptions.scheduledReport
  const isVietnamTime = saved.timezone === NOTIFICATION_DEFAULT_TIMEZONE

  const renderCustomize = (key: SubscriptionKey) => {
    if (key === 'campaignStatus') {
      const c = subscriptions.campaignStatus
      return (
        <>
          <div className="nc-option">
            <div className="nc-option-label">Báo khi chiến dịch chuyển sang</div>
            <div className="nc-chip-row">
              {NOTIFICATION_CAMPAIGN_STATUSES.map(status => (
                <ToggleChip key={status} label={NOTIFICATION_STATUS_LABELS[status]} on={c.toStatuses.includes(status)}
                  onClick={() => updateSubscription('campaignStatus', sub => ({ ...sub, toStatuses: toggleValue(sub.toStatuses, status) }))} />
              ))}
            </div>
            <p className="nc-hint">
              {c.cooldownMinutes === null
                ? 'Cùng chiến dịch, cùng trạng thái chỉ báo lại sau 10 phút (Đang chạy, Chờ xử lý: 15 phút).'
                : `Cùng chiến dịch, cùng trạng thái chỉ báo lại sau ${c.cooldownMinutes} phút.`}
            </p>
          </div>
          <div className="nc-option">
            <div className="nc-option-label">Áp dụng cho</div>
            <ScopeChoice name={`${idPrefix}-campaign-scope`} all={c.campaignIds === null} allLabel="Tất cả chiến dịch"
              selectedLabel="Chiến dịch đã chọn" onChange={all => setScope('campaignStatus', all)} />
            {c.campaignIds !== null && (
              <CampaignTargetPicker selected={c.campaignIds}
                onChange={ids => updateSubscription('campaignStatus', sub => ({ ...sub, campaignIds: ids }))} />
            )}
          </div>
        </>
      )
    }
    if (key === 'accountStatus') {
      const a = subscriptions.accountStatus
      return (
        <>
          <div className="nc-option">
            <div className="nc-option-label">Đăng nhập</div>
            <div className="nc-chip-row">
              {NOTIFICATION_LOGIN_EVENTS.map(event => (
                <ToggleChip key={event} label={NOTIFICATION_LOGIN_EVENT_LABELS[event]} on={a.loginEvents.includes(event)}
                  onClick={() => updateSubscription('accountStatus', sub => ({ ...sub, loginEvents: toggleValue(sub.loginEvents, event) }))} />
              ))}
            </div>
            <p className="nc-hint">Gắn hoặc gỡ máy SMS được tính là đăng nhập hoặc đăng xuất.</p>
          </div>
          <div className="nc-option">
            <div className="nc-option-label">Trạng thái chạy</div>
            <div className="nc-chip-row">
              {NOTIFICATION_ACCOUNT_RUN_STATUSES.map(status => (
                <ToggleChip key={status} label={NOTIFICATION_STATUS_LABELS[status]} on={a.runStatuses.includes(status)}
                  onClick={() => updateSubscription('accountStatus', sub => ({ ...sub, runStatuses: toggleValue(sub.runStatuses, status) }))} />
              ))}
            </div>
            <p className="nc-hint">
              Mỗi tài khoản chờ {a.cooldownMinutes ?? 15} phút trước khi báo lại cùng một sự kiện, tránh báo dồn khi trạng thái đổi liên tục.
            </p>
          </div>
          <div className="nc-option">
            <div className="nc-option-label">Áp dụng cho</div>
            <ScopeChoice name={`${idPrefix}-account-scope`} all={a.accountIds === null} allLabel="Tất cả tài khoản"
              selectedLabel="Tài khoản đã chọn" onChange={all => setScope('accountStatus', all)} />
            {a.accountIds !== null && (
              <AccountTargetPicker selected={a.accountIds}
                onChange={ids => updateSubscription('accountStatus', sub => ({ ...sub, accountIds: ids }))} />
            )}
          </div>
        </>
      )
    }
    const g = subscriptions.dataGroupMembership
    return (
      <>
        <div className="nc-option">
          <div className="nc-option-label">Loại thay đổi</div>
          <div className="nc-chip-row">
            {NOTIFICATION_GROUP_ACTIONS.map(action => (
              <ToggleChip key={action} label={NOTIFICATION_GROUP_ACTION_LABELS[action]} on={g.actions.includes(action)}
                onClick={() => updateSubscription('dataGroupMembership', sub => ({ ...sub, actions: toggleValue(sub.actions, action) }))} />
            ))}
          </div>
        </div>
        <div className="nc-option">
          <div className="nc-option-label">Gộp thay đổi trong</div>
          <div className="nc-chip-row" role="radiogroup" aria-label="Gộp thay đổi trong">
            {NOTIFICATION_BUCKET_MINUTES.map(minutes => (
              <button key={minutes} type="button" role="radio" aria-checked={g.bucketMinutes === minutes}
                className={`nc-chip ${g.bucketMinutes === minutes ? 'is-on' : ''}`}
                onClick={() => updateSubscription('dataGroupMembership', sub => ({ ...sub, bucketMinutes: minutes }))}>
                {minutes} phút
              </button>
            ))}
          </div>
          <p className="nc-hint">Các thay đổi trong cùng khoảng thời gian được gộp thành một thông báo.</p>
        </div>
        <div className="nc-option">
          <div className="nc-option-label">Áp dụng cho</div>
          <ScopeChoice name={`${idPrefix}-group-scope`} all={g.groupIds === null} allLabel="Tất cả nhóm"
            selectedLabel="Nhóm đã chọn" onChange={all => setScope('dataGroupMembership', all)} />
          {g.groupIds === null ? (
            <label className="schedule-checkbox-label nc-inline-check">
              <input type="checkbox" checked={g.includeSharedGroups}
                onChange={event => updateSubscription('dataGroupMembership', sub => ({ ...sub, includeSharedGroups: event.target.checked }))} />
              <span>Gồm cả nhóm được chia sẻ cho bạn</span>
            </label>
          ) : (
            <DataGroupTargetPicker selected={g.groupIds}
              onChange={ids => updateSubscription('dataGroupMembership', sub => ({ ...sub, groupIds: ids }))} />
          )}
        </div>
      </>
    )
  }

  const toggleWeekDay = (day: number) => updateSubscription('scheduledReport', sub => {
    // Đang "Hằng ngày" mà bấm một thứ: chỉ giữ thứ đó. Không bỏ được thứ cuối cùng.
    if (sub.weekDays.length === NOTIFICATION_WEEK_DAYS.length) return { ...sub, weekDays: [day] }
    if (sub.weekDays.includes(day)) return sub.weekDays.length > 1 ? { ...sub, weekDays: sub.weekDays.filter(item => item !== day) } : sub
    return { ...sub, weekDays: orderBy([...sub.weekDays, day], NOTIFICATION_WEEK_DAYS) }
  })

  const addTime = () => updateSubscription('scheduledReport', sub => {
    if (sub.times.length >= NOTIFICATION_MAX_REPORT_TIMES) return sub
    return { ...sub, times: [...sub.times, DEFAULT_NEW_TIMES.find(time => !sub.times.includes(time)) ?? '00:00'] }
  })

  const trialNotice = !saved.centerEnabled
    ? 'Trung tâm thông báo đang trong giai đoạn thử nghiệm và chưa bật gửi. Cài đặt của bạn vẫn được lưu và sẽ áp dụng khi hệ thống bật.'
    : saved.deliveryMode === 'dry_run'
      ? 'Trung tâm thông báo đang chạy thử: thông báo được ghi nhận nhưng chưa gửi email hoặc iPhone thật.'
      : ''

  return (
    <div className="nc-settings">
      <div className="nc-header">
        <h3>Nhận thông báo</h3>
        <p>Chọn kênh nhận và loại thông báo. Cài đặt dùng chung với akaBiz trên web và iPhone.</p>
      </div>

      {trialNotice && (
        <div className="nc-notice" role="note">
          <Info size={15} aria-hidden="true" />
          <span>{trialNotice}</span>
        </div>
      )}

      <fieldset className="nc-fieldset" disabled={saving || refreshing}>
        <section className="nc-card" aria-labelledby={`${idPrefix}-channels`}>
          <div className="nc-card-head">
            <div className="nc-card-title"><h4 id={`${idPrefix}-channels`}>Kênh nhận</h4></div>
          </div>
          <div className="nc-channel-grid">
            <div className={`nc-channel ${emailOn ? 'is-on' : 'is-off'}`}>
              <div className="nc-channel-head">
                <label className="schedule-checkbox-label nc-channel-toggle">
                  <input type="checkbox" checked={emailOn} onChange={event => setEmailEnabled(event.target.checked)} />
                  <span><Mail size={15} aria-hidden="true" /> Email</span>
                </label>
                <span className={`nc-badge ${emailOn ? 'ok' : 'muted'}`}>{emailOn ? 'Đang bật' : 'Đang tắt'}</span>
              </div>
              <div className="nc-email-list">
                {draft.channels.email.recipients.length === 0 && <span className="nc-muted">Chưa có email nhận thông báo.</span>}
                {draft.channels.email.recipients.map(email => {
                  const isNew = !savedRecipients.includes(email)
                  const unverified = !isNew && saved.channels.email.unverified.includes(email)
                  return (
                    <div key={email} className={`nc-email-chip ${unverified ? 'is-unverified' : ''} ${isNew ? 'is-new' : ''}`}>
                      <span className="nc-email-address" title={email}>{email}</span>
                      {isNew && <span className="nc-badge info">Chưa lưu</span>}
                      {unverified && <span className="nc-badge warn">Chưa xác nhận</span>}
                      {unverified && (
                        <button type="button" className="nc-link-button" onClick={() => void resendVerification(email)} disabled={actionsLocked}>
                          {actionBusy === `resend:${email}` ? 'Đang gửi...' : 'Gửi lại email xác nhận'}
                        </button>
                      )}
                      <button type="button" className="nc-chip-remove" aria-label={`Bỏ ${email}`} title="Bỏ email" onClick={() => removeEmail(email)}>
                        <X size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
              {addingEmail ? (
                <div className="nc-add-email">
                  <input className="stepper-input" type="email" value={newEmail} placeholder="ten@congty.vn" aria-label="Email mới" autoFocus
                    onChange={event => { setNewEmail(event.target.value); setEmailError('') }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') { event.preventDefault(); addEmail() }
                      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelAddEmail() }
                    }} />
                  <button type="button" className="btn btn-primary btn-sm" onClick={addEmail}>Thêm</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={cancelAddEmail}>Hủy</button>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm nc-add-button" onClick={() => setAddingEmail(true)}
                  disabled={draft.channels.email.recipients.length >= NOTIFICATION_MAX_EMAILS}>
                  <Plus size={13} /> Thêm email
                </button>
              )}
              {emailError && <p className="nc-field-error" role="alert">{emailError}</p>}
              <p className="nc-hint">Tối đa {NOTIFICATION_MAX_EMAILS} email. Email mới cần xác nhận qua link.</p>
              <div className="nc-channel-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sendTest('email')}
                  disabled={actionsLocked || !!emailTestBlocker} title={emailTestBlocker || 'Gửi tới các email đã lưu và đã xác nhận.'}>
                  <Send size={13} /> {actionBusy === 'test:email' ? 'Đang gửi...' : 'Gửi thử email'}
                </button>
              </div>
            </div>

            <div className={`nc-channel ${pushOn ? 'is-on' : 'is-off'}`}>
              <div className="nc-channel-head">
                <label className="schedule-checkbox-label nc-channel-toggle">
                  <input type="checkbox" checked={pushOn} onChange={event => setPushEnabled(event.target.checked)} />
                  <span><Smartphone size={15} aria-hidden="true" /> Ứng dụng iOS</span>
                </label>
                <span className={`nc-badge ${pushOn ? 'ok' : 'muted'}`}>{pushOn ? 'Đang bật' : 'Đang tắt'}</span>
              </div>
              {devices.length === 0 ? (
                <p className="nc-hint nc-device-empty">Thêm máy: mở app akaBiz trên iPhone → Cài đặt → Nhận thông báo.</p>
              ) : (
                <ul className="nc-device-list">
                  {devices.map(device => {
                    const warning = deviceWarning(device)
                    const meta = deviceMeta(device, format)
                    const busyDevice = actionBusy === `device:${device.id}`
                    return (
                      <li key={device.id} className={`nc-device ${device.enabled ? '' : 'is-paused'}`}>
                        <div className="nc-device-main">
                          <strong>{deviceName(device)}</strong>
                          {meta && <span>{meta}</span>}
                          {warning && <span className="nc-device-warning">{warning}</span>}
                        </div>
                        <span className={`nc-badge ${device.enabled ? 'ok' : 'muted'}`}>{device.enabled ? 'Đang nhận' : 'Tạm dừng'}</span>
                        <div className="nc-device-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleDevice(device)} disabled={actionsLocked}>
                            {device.enabled ? <Pause size={13} /> : <Play size={13} />}
                            {busyDevice ? 'Đang lưu...' : device.enabled ? 'Tạm dừng' : 'Bật lại'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm nc-danger" onClick={() => removeDevice(device)} disabled={actionsLocked}>
                            <Trash2 size={13} /> Gỡ
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="nc-channel-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sendTest('push')}
                  disabled={actionsLocked || !!pushTestBlocker} title={pushTestBlocker || 'Gửi tới các iPhone đang nhận thông báo.'}>
                  <Send size={13} /> {actionBusy === 'test:push' ? 'Đang gửi...' : 'Gửi thử tới app'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="nc-card" aria-labelledby={`${idPrefix}-types`}>
          <div className="nc-card-head">
            <div className="nc-card-title"><h4 id={`${idPrefix}-types`}>Loại thông báo</h4></div>
            <span className="nc-card-note">Chọn kênh cho từng loại; bấm Tùy chỉnh để lọc chi tiết.</span>
          </div>
          <div className={`nc-matrix ${pushOn ? '' : 'is-push-off'} ${emailOn ? '' : 'is-email-off'}`}>
            <div className="nc-matrix-head">
              <span>Loại thông báo</span>
              <span className="nc-col-push">App{!pushOn && <small>đang tắt</small>}</span>
              <span className="nc-col-email">Email{!emailOn && <small>đang tắt</small>}</span>
            </div>
            {ROWS.map(row => {
              const sub = subscriptions[row.key]
              const open = !!expanded[row.key]
              const detailId = `${idPrefix}-${row.key}-detail`
              const isReport = row.key === 'scheduledReport'
              return (
                <div key={row.key} className={`nc-matrix-group ${sub.enabled ? 'is-enabled' : ''} ${open ? 'is-open' : ''}`}>
                  <div className="nc-matrix-row">
                    <div className="nc-matrix-label">
                      <strong>{row.label}</strong>
                      <span className="nc-matrix-summary">{channelSummary(sub)} · {rowSummary(row.key, subscriptions)}</span>
                      <button type="button" className="nc-expander"
                        aria-expanded={isReport ? undefined : open} aria-controls={isReport ? undefined : detailId}
                        onClick={() => (isReport ? focusSchedule() : setExpanded(previous => ({ ...previous, [row.key]: !open })))}>
                        {open || isReport ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                        {isReport ? 'Tùy chỉnh lịch gửi' : 'Tùy chỉnh'}
                      </button>
                    </div>
                    <label className="nc-matrix-check nc-col-push" title={pushOn ? undefined : 'Kênh App đang tắt; lựa chọn vẫn được giữ.'}>
                      <input type="checkbox" checked={sub.push} aria-label={`${row.label}: gửi qua App`}
                        onChange={event => setRowChannel(row.key, 'push', event.target.checked)} />
                    </label>
                    <label className="nc-matrix-check nc-col-email" title={emailOn ? undefined : 'Kênh Email đang tắt; lựa chọn vẫn được giữ.'}>
                      <input type="checkbox" checked={sub.email} aria-label={`${row.label}: gửi qua Email`}
                        onChange={event => setRowChannel(row.key, 'email', event.target.checked)} />
                    </label>
                  </div>
                  {open && !isReport && <div className="nc-matrix-detail" id={detailId}>{renderCustomize(row.key)}</div>}
                </div>
              )
            })}
          </div>
        </section>

        <section className="nc-card nc-schedule" ref={scheduleRef} tabIndex={-1} aria-labelledby={`${idPrefix}-schedule`}>
          <div className="nc-card-head">
            <div className="nc-card-title"><h4 id={`${idPrefix}-schedule`}>Báo cáo theo lịch</h4></div>
            {savedReport.enabled && savedReport.nextRunAt && (
              <span className="nc-card-note">Lần gửi kế tiếp: {format.relative(savedReport.nextRunAt)}</span>
            )}
          </div>
          <div className="nc-option">
            <div className="nc-option-label">Ngày gửi</div>
            <div className="nc-chip-row">
              <ToggleChip label="Hằng ngày" on={report.weekDays.length === NOTIFICATION_WEEK_DAYS.length}
                onClick={() => updateSubscription('scheduledReport', sub => ({ ...sub, weekDays: [...NOTIFICATION_WEEK_DAYS] }))} />
              <span className="nc-chip-divider" aria-hidden="true" />
              {NOTIFICATION_WEEK_DAYS.map(day => (
                <ToggleChip key={day} label={NOTIFICATION_WEEK_DAY_LABELS[day]}
                  on={report.weekDays.length < NOTIFICATION_WEEK_DAYS.length && report.weekDays.includes(day)}
                  onClick={() => toggleWeekDay(day)} />
              ))}
            </div>
          </div>
          <div className="nc-option">
            <div className="nc-option-label">
              Giờ gửi <span>(tối đa {NOTIFICATION_MAX_REPORT_TIMES} mốc{isVietnamTime ? ', giờ Việt Nam' : ''})</span>
            </div>
            <div className="nc-time-list">
              {report.times.map((time, index) => (
                <div key={index} className="nc-time-item">
                  <input type="time" className="stepper-input" value={time} aria-label={`Mốc giờ ${index + 1}`}
                    onChange={event => {
                      const value = event.target.value
                      updateSubscription('scheduledReport', sub => ({ ...sub, times: sub.times.map((item, itemIndex) => (itemIndex === index ? value : item)) }))
                    }} />
                  <button type="button" className="btn-icon" aria-label={`Bỏ mốc ${time || index + 1}`} title="Bỏ mốc giờ"
                    disabled={report.times.length <= 1}
                    onClick={() => updateSubscription('scheduledReport', sub => ({ ...sub, times: sub.times.filter((_, itemIndex) => itemIndex !== index) }))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" onClick={addTime} disabled={report.times.length >= NOTIFICATION_MAX_REPORT_TIMES}>
                <Plus size={13} /> Thêm giờ
              </button>
            </div>
          </div>
          <label className="schedule-checkbox-label">
            <input type="checkbox" checked={report.skipWhenIdle}
              onChange={event => updateSubscription('scheduledReport', sub => ({ ...sub, skipWhenIdle: event.target.checked }))} />
            <span>Không gửi khi không có hoạt động</span>
          </label>
          {!report.enabled && (
            <p className="nc-hint">Báo cáo đang tắt. Chọn App hoặc Email ở dòng "Báo cáo theo lịch" phía trên để nhận.</p>
          )}
        </section>
      </fieldset>

      <div className={`nc-save-bar ${conflict ? 'is-conflict' : ''} ${dirty || conflict || formError ? 'is-pinned' : ''}`}>
        {conflict ? (
          <div className="nc-save-message warn" role="alert">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>Cài đặt vừa được thay đổi ở nơi khác (web, iPhone hoặc máy khác). Nội dung bạn đang nhập vẫn được giữ; hãy tải lại cài đặt mới nhất rồi lưu lần nữa.</span>
          </div>
        ) : formError ? (
          <div className="nc-save-message error" role="alert">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>{formError.message}</span>
          </div>
        ) : (
          <div className="nc-save-message" role="status">{dirty ? 'Có thay đổi chưa lưu.' : 'Cài đặt đã được lưu.'}</div>
        )}
        <div className="nc-save-actions">
          {(conflict || formError?.reload) && (
            <button type="button" className="btn btn-secondary" onClick={reloadLatest} disabled={saving || refreshing}>
              <RefreshCw size={14} /> {refreshing ? 'Đang tải...' : 'Tải lại cài đặt'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void save()}
            disabled={saving || refreshing || conflict || !dirty || actionBusy !== null}>
            <Save size={15} /> {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
          </button>
        </div>
      </div>

      <NotificationInbox timezone={saved.timezone} />
    </div>
  )
}
