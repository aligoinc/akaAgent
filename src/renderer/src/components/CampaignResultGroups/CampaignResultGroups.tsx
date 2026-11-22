import { useState } from 'react'
import { Plus, Trash2, Workflow, X } from 'lucide-react'
import {
  CAMPAIGN_RESULT_ACTION_NAMES,
  CAMPAIGN_RESULT_GROUP_TYPE_LABELS,
  CAMPAIGN_RESULT_GROUPS_DELAY_TEXT,
  CAMPAIGN_RESULT_GROUPS_LATE_DAYS,
  CAMPAIGN_RESULT_GROUPS_MAX_ROWS,
  campaignResultEffectiveKeys,
  campaignResultGroupAccepts,
  campaignResultGroupAccountMismatch,
  campaignResultGroupStateView,
  campaignResultGroupTypeOf,
  campaignResultGroupTypes,
  campaignResultGroupsWording,
  campaignResultKeyCarriesUid,
  campaignResultKeysSummary,
  parseCampaignResultKey,
  type CampaignResultGroupDraft,
  type CampaignResultGroupItem,
  type CampaignResultGroupOptions,
  type CampaignResultGroupType,
  type CampaignResultStatusChoice
} from '../../../../shared/campaignResultGroups'
import type { DataGroup, DataTypeCategoryCode } from '../../../../shared/types'
import { useAutomationNavStore } from '../../stores/automationNavStore'
import { useUiStore } from '../../stores/uiStore'
import QuickCreateDataGroupDialog from '../DataGroups/QuickCreateDataGroupDialog'
import { campaignResultGroupsClient } from './campaignResultGroupsClient'
import type { CampaignResultGroupsState } from './useCampaignResultGroups'
import './CampaignResultGroups.css'

/**
 * Khung "Sau khi chạy: đưa khách vào nhóm" của form chiến dịch Desktop. Chuyển từ akaAgentWebApp
 * apps/web/src/features/campaignResultGroups/CampaignResultGroups.tsx (câu chữ giữ nguyên của Web); link sang Tự động hóa mở
 * thẻ trong phần mềm, tạo nhóm bằng hộp tạo nhanh sẵn có.
 */
export const CAMPAIGN_RESULT_GROUPS_TITLE = 'Sau khi chạy: đưa khách vào nhóm'

const formatCount = (value: number) => value.toLocaleString('vi-VN')
const typeText = (code: string | null | undefined) => {
  const type = campaignResultGroupTypeOf(code)
  return type ? CAMPAIGN_RESULT_GROUP_TYPE_LABELS[type] : 'mọi loại'
}
const groupTypeLine = (code: string | null | undefined) => {
  const type = campaignResultGroupTypeOf(code)
  return type === 'phone' ? 'Theo số điện thoại' : type === 'zalo_person' ? 'Theo UID Zalo' : type ? CAMPAIGN_RESULT_GROUP_TYPE_LABELS[type] : 'Mọi loại dữ liệu'
}
const namesText = (names: string[]) => names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`
const nextRowKey = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
/** Danh từ đếm theo loại nhóm của dòng đã có: khách (người), group, page, bài viết. */
const nounOfGroupType = (type: CampaignResultGroupType | null | undefined) =>
  type === 'facebook_group' ? 'group' : type === 'facebook_page' ? 'page' : type === 'facebook_post_url' ? 'bài viết' : 'khách'
const capitalize = (value: string) => value ? value[0].toLocaleUpperCase('vi-VN') + value.slice(1) : value

/** Tên loại nhóm trong hộp tạo nhanh. */
const CREATE_TYPE_LABELS: Record<CampaignResultGroupType, string> = {
  phone: 'Số điện thoại',
  zalo_person: 'UID Zalo',
  facebook_person: 'User Facebook',
  facebook_group: 'Group Facebook',
  facebook_page: 'Page Facebook',
  facebook_post_url: 'Link bài viết Facebook',
  facebook_page_inbox_customer: 'Khách inbox Page'
}

export const openAutomationFromCampaigns = () => { useAutomationNavStore.getState().open('campaigns') }
const openJourney = (journeyId: number) => { useAutomationNavStore.getState().open('journeys', `/automation/${journeyId}`) }
const openCampaign = (campaignId: number) => {
  window.dispatchEvent(new CustomEvent('aka-agent:data-group-campaign-navigate', { detail: { mode: 'open', campaignId } }))
}

export interface CampaignResultGroupsFailure {
  groupId: number
  message: string
}

export interface CampaignResultGroupsProps {
  state: CampaignResultGroupsState
  actionId: string
  accounts: Array<{ id: number; name: string }>
  rows: CampaignResultGroupDraft[]
  onRowsChange: (rows: CampaignResultGroupDraft[]) => void
  /** Hiện lỗi của từng dòng sau lần bấm Lưu đầu tiên. */
  showErrors: boolean
  disabled?: boolean
  /** Sửa chiến dịch: mã chiến dịch để Tắt / Bật lại / Bỏ các dòng đã có. */
  campaignId?: number | null
  includeExisting?: boolean
  onIncludeExistingChange?: (value: boolean) => void
  failure?: CampaignResultGroupsFailure | null
}

export default function CampaignResultGroups(props: CampaignResultGroupsProps) {
  const { state, actionId, accounts, rows, onRowsChange, showErrors, disabled, campaignId, failure } = props
  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const wording = campaignResultGroupsWording(actionId)
  const noun = wording.subject.toLocaleLowerCase('vi-VN')
  const options = state.options.data
  const issues = state.issues(rows)
  const groupTypes = campaignResultGroupTypes(actionId)
  const accountIds = accounts.map(account => account.id)
  const accountNames = accounts.map(account => account.name)
  const existing = state.existing.data ?? []
  const tracked = new Set(options?.trackedAccountIds ?? [])
  const trackedNames = accounts.filter(account => tracked.has(account.id)).map(account => account.name)
  const untrackedNames = accounts.filter(account => !tracked.has(account.id)).map(account => account.name)
  const enabledActions = (options?.actions ?? []).filter(action => state.enabledActionCodes.includes(action.code))
  const hasTrackedChoices = enabledActions.some(action => action.late.some(choice => choice.needsTracking))
  const lateLocked = Boolean(options) && accounts.length > 0 && trackedNames.length === 0
  const frameIssues = issues.filter(issue => issue.index < 0)

  const update = (index: number, change: Partial<CampaignResultGroupDraft>) =>
    onRowsChange(rows.map((row, i) => i === index ? { ...row, ...change } : row))
  const addRow = () => {
    state.open()
    if (rows.length >= CAMPAIGN_RESULT_GROUPS_MAX_ROWS) return
    onRowsChange([...rows, { key: nextRowKey(), groupId: null, keys: [] }])
  }

  if (!state.visible) return null
  if (state.notReady && rows.length === 0 && existing.length === 0) {
    return <p className="crg-note" role="note">Tính năng đưa khách vào nhóm đang được cập nhật trên máy chủ. Vui lòng thử lại sau.</p>
  }
  return <div className="crg" aria-label={wording.title} role="group">
    <p className="crg-lead">{wording.subject} đạt một trong các kết quả bạn chọn sẽ tự được đưa vào {wording.groupNoun}, sau {CAMPAIGN_RESULT_GROUPS_DELAY_TEXT}.
      {' '}Mỗi nhóm là một tự động hóa riêng, xem lại ở <button type="button" className="crg-link" onClick={openAutomationFromCampaigns}>Tự động hóa › Từ chiến dịch</button>.</p>
    {frameIssues.map(issue => <p key={issue.code} className="crg-error" role="alert">{issue.message}</p>)}
    {state.disabledBySwitch && <p className="crg-note crg-note-warn" role="note">Tính năng đang tạm tắt trên hệ thống; các dòng mới dưới đây sẽ không được lưu.</p>}
    {options && hasTrackedChoices && accounts.length > 0 && <p className="crg-note" role="note">{trackedNames.length === accounts.length
      ? `${namesText(accountNames)} đang được theo dõi tương tác: chọn được cả kết quả “Sau khi gửi” (đã xem, đã phản hồi…) trong ${CAMPAIGN_RESULT_GROUPS_LATE_DAYS} ngày sau khi gửi.`
      : trackedNames.length === 0
        ? `${namesText(untrackedNames)} chưa được theo dõi tương tác nên chưa chọn được kết quả “Sau khi gửi”. Kết quả lúc chạy vẫn dùng được.`
        : `Chỉ ${namesText(trackedNames)} được theo dõi tương tác: khách của ${namesText(untrackedNames)} chỉ vào nhóm theo kết quả lúc chạy.`}</p>}

    {campaignId && (state.existing.loading || state.existing.error || existing.length > 0) && <div className="crg-existing">
      <p className="crg-hint"><strong>Tắt, bật lại và bỏ có hiệu lực ngay khi bấm</strong>, không chờ nút Lưu. Nhóm đang đồng bộ không sửa được nhóm hay kết quả: muốn đổi thì tắt dòng đó rồi thêm một dòng mới.</p>
      {state.existing.loading && !existing.length && <p role="status" className="crg-hint">Đang tải các nhóm đang đồng bộ…</p>}
      {state.existing.error && <p role="alert" className="crg-error">{state.existing.error} <button type="button" className="btn btn-secondary btn-sm" onClick={state.reloadExisting}>Thử lại</button></p>}
      {existing.map(item => <CampaignResultGroupRow key={item.journeyId} item={item} options={options} onReplaced={state.replaceExisting} disabled={disabled} />)}
    </div>}

    {rows.map((row, index) => {
      const rowIssues = issues.filter(issue => issue.index === index && (showErrors || issue.severity === 'warning'))
      const group = row.groupId ? state.groupById.get(row.groupId) : undefined
      const choices = state.groups.data ?? []
      // Nhóm UID gắn tài khoản khác tài khoản chạy chiến dịch không nhận được khách: không đưa vào danh sách chọn.
      const accepted = choices.filter(item => campaignResultGroupAccepts(actionId, item.dataTypeCode ?? null)
        && !campaignResultGroupAccountMismatch(item.dataTypeCode, item.boundZaloAccountId, accountIds))
      const effective = campaignResultEffectiveKeys(row.keys, state.usableKeys)
      const dropped = row.keys.filter(key => !effective.includes(key))
      const droppedActions = Array.from(new Set(dropped.map(key => parseCampaignResultKey(key)?.actionCode).filter((code): code is string => Boolean(code))))
      const toggle = (choice: CampaignResultStatusChoice) => {
        const on = choice.keys.every(key => row.keys.includes(key))
        update(index, { keys: on ? row.keys.filter(key => !choice.keys.includes(key)) : [...row.keys, ...choice.keys.filter(key => !row.keys.includes(key))] })
      }
      const title = `Nhóm ${index + 1}`
      return <div key={row.key} className={`crg-row${rowIssues.some(issue => issue.severity === 'error') || failure?.groupId === row.groupId ? ' has-error' : ''}`} id={`crg-row-${index}`}>
        <div className="crg-row-head">
          <strong>{title}</strong>{campaignId && <span className="crg-badge">Mới</span>}
          <button type="button" className="btn btn-ghost btn-sm crg-remove" aria-label={`Bỏ ${title.toLocaleLowerCase('vi-VN')}`} disabled={disabled}
            onClick={() => onRowsChange(rows.filter((_, i) => i !== index))}><Trash2 size={14} aria-hidden="true" /> Bỏ</button>
        </div>
        <div className="crg-group-line">
          <select className="stepper-input" aria-label={`${capitalize(wording.groupNoun)} của ${title.toLocaleLowerCase('vi-VN')}`} value={row.groupId ?? ''} disabled={disabled}
            onChange={event => update(index, { groupId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">{state.groups.loading && !state.groups.data ? `Đang tải ${wording.groupNoun}…` : `Chọn ${wording.groupNoun}…`}</option>
            {row.groupId && !accepted.some(item => item.id === row.groupId) && <option value={row.groupId}>{group ? group.name : state.groups.data ? `Nhóm #${row.groupId} (không còn)` : `Nhóm #${row.groupId}`}</option>}
            {accepted.map(item => <option key={item.id} value={item.id}>{`${item.name} · ${typeText(item.dataTypeCode)} · ${formatCount(item.activeMembershipCount)} ${noun}`}</option>)}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => setCreatingFor(row.key)}><Plus size={14} aria-hidden="true" /> Tạo nhóm</button>
        </div>
        {state.groups.error && <p className="crg-error" role="alert">{state.groups.error} <button type="button" className="btn btn-secondary btn-sm" onClick={state.reloadGroups}>Thử lại</button></p>}
        {group && <p className="crg-hint">{groupTypeLine(group.dataTypeCode)} · đang có {formatCount(group.activeMembershipCount)} {noun}</p>}
        {state.options.loading && !options && <p role="status" className="crg-hint">Đang tải các kết quả của chiến dịch…</p>}
        {state.options.error && !state.notReady && <p className="crg-error" role="alert">{state.options.error} <button type="button" className="btn btn-secondary btn-sm" onClick={state.reloadOptions}>Thử lại</button></p>}
        {options && <div className="crg-actions">{enabledActions.map(action => <div className="crg-action" key={action.code}>
          <span className="crg-action-name">{action.name}</span>
          <div className="crg-chips" role="group" aria-label={`Kết quả của ${action.name}`}>
            {action.statuses.map(choice => <Chip key={choice.id} choice={choice} on={choice.keys.every(key => row.keys.includes(key))} disabled={disabled} onToggle={() => toggle(choice)} />)}
          </div>
          {action.late.length > 0 && <div className="crg-late">
            <span className="crg-late-label">Sau khi gửi · trong {CAMPAIGN_RESULT_GROUPS_LATE_DAYS} ngày</span>
            <div className="crg-chips" role="group" aria-label={`Kết quả sau khi gửi của ${action.name}`}>
              {action.late.map(choice => <Chip key={choice.id} choice={choice} on={choice.keys.every(key => row.keys.includes(key))}
                disabled={disabled || (choice.needsTracking && lateLocked && !choice.keys.every(key => row.keys.includes(key)))} onToggle={() => toggle(choice)} />)}
            </div>
          </div>}
        </div>)}
          {enabledActions.length === 0 && <p className="crg-hint">Bật ít nhất một hành động ở “Tuỳ chọn hành động” để chọn kết quả.</p>}
        </div>}
        {droppedActions.length > 0 && <p className="crg-note crg-note-warn" role="note">{`Có ${dropped.length} kết quả của ${droppedActions.map(code => CAMPAIGN_RESULT_ACTION_NAMES[code] ?? code).join(', ')} đang tắt; các kết quả này sẽ được bỏ khi lưu. Bật lại trước khi lưu thì lựa chọn cũ quay lại.`}</p>}
        {effective.length > 0 && <p className="crg-summary"><span>{wording.subject} vào nhóm khi:</span> {campaignResultKeysSummary(effective, options)}</p>}
        {rowIssues.map(issue => <p key={issue.code} className={issue.severity === 'error' ? 'crg-error' : 'crg-note crg-note-warn'} role={issue.severity === 'error' ? 'alert' : 'note'}>{issue.message}</p>)}
        {failure && failure.groupId === row.groupId && <p className="crg-error" role="alert">{failure.message}</p>}
        {creatingFor === row.key && <CreateGroupDialog groupTypes={groupTypes} accountIds={accountIds}
          preferPhone={effective.length > 0 && effective.every(key => !campaignResultKeyCarriesUid(key))}
          onCancel={() => setCreatingFor(null)}
          onCreated={created => {
            setCreatingFor(null)
            state.addGroup(created)
            state.reloadGroups()
            update(index, { groupId: created.id })
          }} />}
      </div>
    })}

    <div className="crg-footer">
      <button type="button" className="btn btn-secondary btn-sm" onClick={addRow} disabled={disabled || rows.length >= CAMPAIGN_RESULT_GROUPS_MAX_ROWS}><Plus size={14} aria-hidden="true" /> Thêm nhóm</button>
      <span className="crg-hint">{rows.length >= CAMPAIGN_RESULT_GROUPS_MAX_ROWS ? `Tối đa ${CAMPAIGN_RESULT_GROUPS_MAX_ROWS} nhóm mỗi lần lưu.` : rows.length === 0 ? 'Không bắt buộc.' : `Thêm được ${CAMPAIGN_RESULT_GROUPS_MAX_ROWS - rows.length} nhóm nữa.`}</span>
    </div>
    {campaignId && rows.length > 0 && <label className="crg-check">
      <input type="checkbox" checked={props.includeExisting === true} disabled={disabled} onChange={event => props.onIncludeExistingChange?.(event.target.checked)} />
      <span>Áp cả cho kết quả đã có của chiến dịch<small>Chỉ áp cho kết quả lúc chạy; kết quả “Sau khi gửi” tính từ lúc dòng mới được tạo. Dòng mới được tạo khi bấm Lưu.</small></span>
    </label>}
  </div>
}

function Chip({ choice, on, disabled, onToggle }: { choice: CampaignResultStatusChoice; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return <button type="button" className={`crg-chip${on ? ' on' : ''}${choice.late ? ' late' : ''}`} aria-pressed={on} disabled={disabled} onClick={onToggle}>{choice.label}</button>
}

/**
 * Tạo nhóm ngay tại dòng: chỉ các loại nhận được data của chiến dịch. Nhóm theo UID Zalo phải gắn một tài khoản: chỉ tạo được ở
 * đây khi chiến dịch chạy đúng một tài khoản; chọn nhiều tài khoản thì tạo ở màn Nhóm data.
 */
function CreateGroupDialog({ groupTypes, accountIds, preferPhone, onCancel, onCreated }: {
  groupTypes: CampaignResultGroupType[]
  accountIds: number[]
  preferPhone: boolean
  onCancel: () => void
  onCreated: (group: DataGroup) => void
}) {
  const showAlert = useUiStore(store => store.showAlert)
  const allowed = groupTypes.filter(code => code !== 'zalo_person' || accountIds.length === 1)
  if (allowed.length === 0) {
    queueMicrotask(() => {
      showAlert('Nhóm theo UID Zalo gắn với một tài khoản. Chiến dịch đang chọn nhiều tài khoản nên hãy tạo nhóm ở màn Nhóm data.', 'info')
      onCancel()
    })
    return null
  }
  const preferred = allowed.find(code => code === (preferPhone || !allowed.includes('zalo_person') ? 'phone' : 'zalo_person')) ?? allowed[0]
  return <QuickCreateDataGroupDialog
    dataTypeCode={preferred as DataTypeCategoryCode}
    typeLabel={CREATE_TYPE_LABELS[preferred]}
    typeChoices={allowed.map(code => ({ code: code as DataTypeCategoryCode, label: CREATE_TYPE_LABELS[code] }))}
    boundZaloAccountIdFor={code => code === 'zalo_person' ? accountIds[0] ?? null : null}
    subtitle="Nhóm mới được chọn ngay cho dòng này."
    defaultName=""
    onCreated={onCreated}
    onClose={onCancel}
  />
}

/**
 * Một dòng đã có (đang đồng bộ, đã tắt, đã dừng): Tắt / Bật lại / Bỏ gọi máy chủ ngay. Dùng ở form sửa chiến dịch và ở
 * Tự động hóa › Từ chiến dịch (`showCampaign`).
 */
export function CampaignResultGroupRow({ item, options, onReplaced, disabled, showCampaign }: {
  item: CampaignResultGroupItem
  options?: CampaignResultGroupOptions | null
  onReplaced: (item: CampaignResultGroupItem) => void
  disabled?: boolean
  showCampaign?: boolean
}) {
  const showAlert = useUiStore(store => store.showAlert)
  const showConfirm = useUiStore(store => store.showConfirm)
  const [busy, setBusy] = useState(false)
  const [askResume, setAskResume] = useState(false)
  const view = campaignResultGroupStateView(item)
  const noun = nounOfGroupType(item.groupType)
  const run = async (action: 'pause' | 'resume' | 'stop', includePaused?: boolean) => {
    setBusy(true)
    try {
      const updated = await campaignResultGroupsClient.setStatus(item.campaignId, item.journeyId, { action, ...(action === 'resume' ? { includePaused: includePaused === true } : {}) })
      onReplaced(showCampaign ? { ...updated, campaignName: updated.campaignName ?? item.campaignName, accountName: updated.accountName ?? item.accountName } : updated)
      setAskResume(false)
      const added = item.added > 0 ? ` ${formatCount(item.added)} ${noun} đã vào nhóm vẫn ở lại.` : ''
      showAlert(action === 'pause' ? `Đã tắt đồng bộ vào nhóm “${item.groupName}”.${added}`
        : action === 'resume' ? `Đã bật lại đồng bộ vào nhóm “${item.groupName}”.`
          : `Đã dừng hẳn đồng bộ vào nhóm “${item.groupName}”.`, 'success')
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không đổi được trạng thái đồng bộ.', 'error')
    } finally { setBusy(false) }
  }
  const on = item.state === 'active'
  const canToggle = on ? view.canPause : view.canResume
  return <div className={`crg-row crg-row-existing tone-${view.tone}`}>
    <div className="crg-row-head">
      <strong>{item.groupName}</strong><span className="crg-hint">{typeText(item.groupType)}</span>
      {item.groupDeleted && <span className="crg-badge crg-badge-warn">Nhóm đã xóa</span>}
      <span className="crg-row-tools">
        {(view.canPause || view.canResume) && <button type="button" role="switch" aria-checked={on} aria-label={`Đồng bộ vào nhóm ${item.groupName}`}
          className={`crg-switch${on ? ' on' : ''}`} disabled={disabled || busy || !canToggle}
          onClick={() => on ? void run('pause') : setAskResume(true)}><i aria-hidden="true" /><span>Đồng bộ</span></button>}
        {view.canRemove && <button type="button" className="btn btn-ghost btn-sm crg-remove" disabled={disabled || busy}
          onClick={() => showConfirm(`${item.added > 0 ? `${formatCount(item.added)} ${noun} đã vào nhóm vẫn ở lại. ` : ''}Dòng này không bật lại được; muốn đồng bộ lại thì thêm dòng mới.`,
            () => run('stop'), { title: `Dừng hẳn đồng bộ vào nhóm “${item.groupName}”?`, confirmText: 'Dừng hẳn', cancelText: 'Giữ lại', variant: 'danger' })}>
          <X size={14} aria-hidden="true" /> Bỏ</button>}
      </span>
    </div>
    {showCampaign && <p className="crg-campaign">Từ chiến dịch{' '}
      {item.campaignDeleted ? <span>{item.campaignName || `#${item.campaignId}`} (đã xóa)</span>
        : <button type="button" className="crg-link" onClick={() => openCampaign(item.campaignId)}>{item.campaignName || `#${item.campaignId}`}</button>}
      {item.accountName ? <span className="crg-hint"> · {item.accountName}</span> : null}</p>}
    <p className="crg-summary">{campaignResultKeysSummary(item.keys, options)}</p>
    <p className={`crg-state tone-${view.tone}`}><strong>{view.label}</strong>
      {item.added > 0 && <> · đã đưa {formatCount(item.added)} {noun} vào nhóm</>}
      {item.pending > 0 && <> · {formatCount(item.pending)} {noun} đang chờ</>}
      {' · '}<button type="button" className="crg-link" onClick={() => openJourney(item.journeyId)}><Workflow size={13} aria-hidden="true" /> Xem tự động hóa</button></p>
    {view.detail && <p className="crg-hint">{view.detail}</p>}
    {askResume && <div className="crg-resume" role="group" aria-label="Bật lại đồng bộ">
      <p>Trong lúc tắt có thể đã có thêm {noun} đạt kết quả này. Bật lại thì làm gì với {noun === 'khách' ? 'họ' : 'chúng'}?</p>
      <div className="crg-resume-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void run('resume', false)}>Chỉ kết quả từ bây giờ</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run('resume', true)}>Đưa cả các {noun} đó vào nhóm</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAskResume(false)}>Hủy</button>
      </div>
    </div>}
  </div>
}

/**
 * Bảng báo khi chiến dịch đã lưu (đang tạm dừng) mà chưa bật xong đồng bộ của một nhóm. Nằm ở chân form (ngoài phần form bị
 * khóa trong lúc chờ hoàn tất) để khách thử lại, chọn nhóm khác hoặc bỏ nhóm đó rồi chạy.
 */
export function CampaignResultGroupsSaveIssue({ failure, groupName, campaignCount, choices, onChooseGroup, onDrop, onRetry, busy }: {
  failure: CampaignResultGroupsFailure
  groupName: string
  campaignCount: number
  choices: DataGroup[]
  onChooseGroup: (groupId: number) => void
  /** Bỏ dòng khỏi danh sách sẽ lưu (cập nhật ngay, trước lượt thử lại). */
  onDrop: () => void
  onRetry: () => void
  busy: boolean
}) {
  const [choosing, setChoosing] = useState(false)
  return <div className="crg-save-issue" role="alert">
    <strong>Chưa bật xong đồng bộ vào nhóm “{groupName}”</strong>
    <p>{campaignCount > 1 ? `${formatCount(campaignCount)} chiến dịch đã được lưu và đang tạm dừng.` : 'Chiến dịch đã được lưu và đang tạm dừng.'} Chiến dịch chỉ chạy khi mọi nhóm đã đồng bộ được, để không có kết quả nào bị bỏ sót. {failure.message}</p>
    {choosing && <select className="stepper-input" aria-label="Chọn nhóm khác" defaultValue="" onChange={event => { if (event.target.value) { onChooseGroup(Number(event.target.value)); setChoosing(false) } }}>
      <option value="">Chọn nhóm khác…</option>
      {choices.map(item => <option key={item.id} value={item.id}>{`${item.name} · ${typeText(item.dataTypeCode)}`}</option>)}
    </select>}
    <div className="crg-resume-actions">
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onRetry}>Thử lại</button>
      {choices.length > 0 && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setChoosing(true)}>Chọn nhóm khác</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { onDrop(); onRetry() }}>Bỏ nhóm này và chạy</button>
    </div>
    <small>“Thử lại” chỉ làm phần còn dở: không tạo lại chiến dịch, không tạo trùng đồng bộ đã xong.</small>
  </div>
}
