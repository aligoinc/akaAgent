import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Braces,
  Calendar,
  Check,
  Edit3,
  FileText,
  FolderCog,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Users,
  X
} from 'lucide-react'
import type {
  CampaignMediaSnapshot,
  ContentTemplate,
  ContentTemplateChannelConfig,
  ContentTemplateChannelName,
  ContentTemplateContentType,
  ContentTemplateGroup,
  CreateContentTemplateGroupInput,
  CreateContentTemplateInput,
  UpdateContentTemplateGroupInput,
  UpdateContentTemplateInput
} from '../../../../shared/types'
import {
  formattedContentToPlainText,
  isFormattedContentEmpty,
  plainTextToFormattedContent,
  sanitizeFormattedContent
} from '../../../../shared/formattedContent'
import { useUiStore } from '../../stores/uiStore'
import MediaLibraryModal from '../Media/MediaLibraryModal'
import { isVideoMediaSource } from '../Media/mediaImage'
import {
  FormattedContentEditor,
  type FormattedContentEditorHandle
} from '../CampaignPanels/EmailHtmlEditor'
import ContentTemplatePreview from './ContentTemplatePreview'
import './contentTemplateWorkspace.css'

const CHANNELS = [
  'sms',
  'zalo_message',
  'facebook_post',
  'facebook_message',
  'facebook_comment',
  'email'
] as const satisfies readonly ContentTemplateChannelName[]

const CHANNEL_META: Record<ContentTemplateChannelName, {
  label: string
  shortLabel: string
  mono: string
  description: string
  maxImages: number
  richCapable: boolean
}> = {
  sms: {
    label: 'SMS', shortLabel: 'SMS', mono: 'S', maxImages: 0, richCapable: false,
    description: 'Tin nhắn văn bản gửi qua thiết bị SMS.'
  },
  zalo_message: {
    label: 'Tin nhắn Zalo', shortLabel: 'Tin nhắn Zalo', mono: 'Z', maxImages: 10, richCapable: true,
    description: 'Nội dung và ảnh riêng cho các chiến dịch nhắn tin Zalo.'
  },
  facebook_post: {
    label: 'Đăng bài Facebook', shortLabel: 'Đăng bài Facebook', mono: 'f', maxImages: 10, richCapable: true,
    description: 'Nội dung dùng cho bài đăng Facebook profile, page hoặc group.'
  },
  facebook_message: {
    label: 'Tin nhắn Facebook', shortLabel: 'Tin nhắn Facebook', mono: 'f', maxImages: 10, richCapable: false,
    description: 'Tin nhắn Facebook dạng văn bản thường.'
  },
  facebook_comment: {
    label: 'Comment Facebook', shortLabel: 'Comment Facebook', mono: 'f', maxImages: 10, richCapable: false,
    description: 'Chọn tối đa 10 ảnh/video; campaign sẽ chọn ngẫu nhiên một media cho mỗi comment.'
  },
  email: {
    label: 'Email', shortLabel: 'Email', mono: '@', maxImages: 10, richCapable: true,
    description: 'Tiêu đề, nội dung và ảnh đính kèm dành riêng cho Email.'
  }
}

type WorkspaceView = 'list' | 'editor'
type TemplateFilter = 'all' | ContentTemplateChannelName
type ChannelRecord = Record<ContentTemplateChannelName, ContentTemplateChannelConfig>
type PersonalizationDateOption = 'TODAY' | 'TOMORROW' | 'YESTERDAY'
type PersonalizationDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY'

interface PersonalizationToken {
  label: string
  token: string
}

const PERSONALIZATION_DATE_OPTIONS: Array<{
  value: PersonalizationDateOption
  label: string
}> = [
  { value: 'TODAY', label: 'Hôm nay' },
  { value: 'TOMORROW', label: 'Ngày mai' },
  { value: 'YESTERDAY', label: 'Hôm qua' }
]

const PERSONALIZATION_DATE_FORMATS: PersonalizationDateFormat[] = [
  'DD/MM/YYYY',
  'MM/DD/YYYY'
]

const getCustomerPersonalizationTokens = (
  channelName: ContentTemplateChannelName
): PersonalizationToken[] => {
  if (channelName === 'email') return []

  const tokens: PersonalizationToken[] = [
    { label: 'Tên khách', token: '#{FULL_NAME}' }
  ]
  if (channelName === 'zalo_message') {
    tokens.push({ label: 'Tên gốc Zalo', token: '#{ORIGINAL_NAME}' })
    tokens.push({ label: 'Xưng hô', token: '#{SEX{anh-chị-anh/chị}}' })
  }
  return tokens
}

const getExcelPersonalizationTokens = (
  channelName: ContentTemplateChannelName
): PersonalizationToken[] => {
  if (
    channelName === 'facebook_post' ||
    channelName === 'facebook_message' ||
    channelName === 'facebook_comment'
  ) {
    return []
  }

  const tokens: PersonalizationToken[] = [
    { label: 'Họ tên (Excel)', token: '#{INPUT_FULLNAME}' },
    { label: 'Số điện thoại', token: '#{PHONE}' }
  ]
  if (channelName !== 'sms') {
    tokens.push({ label: 'Email', token: '#{EMAIL}' })
  }
  return [
    ...tokens,
    { label: 'Thông tin 1', token: '#{INFO1}' },
    { label: 'Thông tin 2', token: '#{INFO2}' },
    { label: 'Thông tin 3', token: '#{INFO3}' },
    { label: 'Thông tin 4', token: '#{INFO4}' },
    { label: 'Thông tin 5', token: '#{INFO5}' }
  ]
}

const createVariantIndexRecord = (): Record<ContentTemplateChannelName, number> => ({
  sms: 0,
  zalo_message: 0,
  facebook_post: 0,
  facebook_message: 0,
  facebook_comment: 0,
  email: 0
})

interface ContentTemplateWorkspaceProps {
  isActive?: boolean
  modal?: boolean
  onClose?: () => void
  initialChannel?: ContentTemplateChannelName
}

interface TemplateEditorState {
  id: number | null
  name: string
  groupId: number | null
  channels: ChannelRecord
}

interface GroupEditorState {
  id: number | null
  name: string
  description: string
  order: number
  isActive: boolean
}

const EMPTY_GROUP_FORM: GroupEditorState = {
  id: null,
  name: '',
  description: '',
  order: 0,
  isActive: true
}

const isRichChannel = (
  name: ContentTemplateChannelName,
  channel: ContentTemplateChannelConfig
): boolean => name === 'email'
  ? channel.isHtml === true
  : (name === 'zalo_message' || name === 'facebook_post') && channel.formattedContentEnabled === true

const emptyChannel = (name: ContentTemplateChannelName): ContentTemplateChannelConfig => ({
  enabled: false,
  variants: [{ text: '' }],
  imageUrls: [],
  ...((name === 'zalo_message' || name === 'facebook_post') ? { formattedContentEnabled: false } : {}),
  ...(name === 'email' ? { subject: '', isHtml: false } : {})
})

const normalizeChannel = (
  channel: ContentTemplateChannelConfig | undefined,
  name: ContentTemplateChannelName
): ContentTemplateChannelConfig => ({
  enabled: channel?.enabled === true,
  variants: Array.isArray(channel?.variants) && channel.variants.length > 0
    ? channel.variants.map(variant => ({ text: String(variant?.text || '') }))
    : [{ text: '' }],
  imageUrls: Array.isArray(channel?.imageUrls)
    ? channel.imageUrls.filter((url): url is string => typeof url === 'string' && !!url)
      .slice(0, CHANNEL_META[name].maxImages)
    : [],
  ...((name === 'zalo_message' || name === 'facebook_post')
    ? { formattedContentEnabled: channel?.formattedContentEnabled === true }
    : {}),
  ...(name === 'email'
    ? { subject: String(channel?.subject || ''), isHtml: channel?.isHtml === true }
    : {})
})

const makeEditorState = (template?: ContentTemplate | null): TemplateEditorState => ({
  id: template?.id || null,
  name: template?.name || '',
  groupId: template?.groupId ?? null,
  channels: {
    sms: normalizeChannel(template?.channels.sms, 'sms'),
    zalo_message: normalizeChannel(template?.channels.zalo_message, 'zalo_message'),
    facebook_post: normalizeChannel(template?.channels.facebook_post, 'facebook_post'),
    facebook_message: normalizeChannel(template?.channels.facebook_message, 'facebook_message'),
    facebook_comment: normalizeChannel(template?.channels.facebook_comment, 'facebook_comment'),
    email: normalizeChannel(template?.channels.email, 'email')
  }
})

const formatError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error || '')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}

const compactText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const getVariantPreview = (
  channelName: ContentTemplateChannelName,
  channel: ContentTemplateChannelConfig
): string => {
  const variant = channel.variants.find(item => {
    return isRichChannel(channelName, channel)
      ? !isFormattedContentEmpty(item.text)
      : !!item.text.trim()
  })
  if (!variant) return ''
  return compactText(isRichChannel(channelName, channel)
    ? formattedContentToPlainText(variant.text)
    : variant.text)
}

const enabledChannels = (template: ContentTemplate): ContentTemplateChannelName[] =>
  CHANNELS.filter(channelName => template.channels[channelName]?.enabled)

const templateImageCount = (template: ContentTemplate): number =>
  CHANNELS.reduce((total, channelName) => total + (template.channels[channelName]?.imageUrls.length || 0), 0)

const getImageName = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Ảnh mẫu')
  } catch {
    return url.split('/').pop() || 'Ảnh mẫu'
  }
}

function Toggle({ checked, onChange, disabled, label }: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className={`ctw-toggle-row${disabled ? ' disabled' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`ctw-toggle${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      ><span /></button>
      <span>{label}</span>
    </div>
  )
}

function GroupManagerDialog({
  groups,
  onClose,
  onChanged
}: {
  groups: ContentTemplateGroup[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [form, setForm] = useState<GroupEditorState>(EMPTY_GROUP_FORM)
  const [busy, setBusy] = useState(false)
  const reset = () => setForm(EMPTY_GROUP_FORM)

  const edit = (group: ContentTemplateGroup) => setForm({
    id: group.id,
    name: group.name,
    description: group.description || '',
    order: group.order || 0,
    isActive: group.isActive
  })

  const save = async () => {
    const name = form.name.replace(/\s+/g, ' ').trim()
    if (!name) {
      showAlert('Vui lòng nhập tên nhóm nội dung.', 'error')
      return
    }
    setBusy(true)
    try {
      if (form.id) {
        const updates: UpdateContentTemplateGroupInput = {
          name,
          description: form.description.trim() || null,
          order: Number.isFinite(form.order) ? form.order : 0,
          isActive: form.isActive
        }
        await window.electronAPI.updateContentTemplateGroup(form.id, updates)
        showAlert('Đã cập nhật nhóm nội dung.', 'success')
      } else {
        const input: CreateContentTemplateGroupInput = {
          name,
          description: form.description.trim() || null,
          order: Number.isFinite(form.order) ? form.order : 0,
          isActive: form.isActive
        }
        await window.electronAPI.createContentTemplateGroup(input)
        showAlert('Đã tạo nhóm nội dung.', 'success')
      }
      reset()
      await onChanged()
      window.dispatchEvent(new Event('content-templates-updated'))
    } catch (error) {
      showAlert(formatError(error, 'Không thể lưu nhóm nội dung.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = (group: ContentTemplateGroup) => {
    if (group.templateCount > 0) {
      showAlert('Nhóm đang có mẫu nội dung. Vui lòng chuyển hoặc xoá các mẫu trước.', 'error')
      return
    }
    showConfirm(
      `Bạn có muốn xoá nhóm “${group.name}” không?`,
      async () => {
        setBusy(true)
        try {
          await window.electronAPI.deleteContentTemplateGroup(group.id)
          if (form.id === group.id) reset()
          await onChanged()
          window.dispatchEvent(new Event('content-templates-updated'))
          showAlert('Đã xoá nhóm nội dung.', 'success')
        } catch (error) {
          showAlert(formatError(error, 'Không thể xoá nhóm nội dung.'), 'error')
        } finally {
          setBusy(false)
        }
      },
      { title: 'Xoá nhóm nội dung', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const sortedGroups = [...groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'))

  return (
    <div className="ctw-dialog-overlay" onClick={onClose}>
      <div className="ctw-dialog ctw-group-dialog" onClick={event => event.stopPropagation()}>
        <div className="ctw-dialog-header">
          <div><h3>Quản lý nhóm nội dung</h3><p>Sắp xếp mẫu theo nhóm để tìm và sử dụng nhanh hơn.</p></div>
          <button type="button" className="btn-icon" onClick={onClose} title="Đóng"><X size={18} /></button>
        </div>
        <div className="ctw-group-dialog-body">
          <section className="ctw-group-form-card">
            <div className="ctw-section-heading">
              <div><strong>{form.id ? 'Sửa nhóm' : 'Thêm nhóm mới'}</strong><span>Nhóm chỉ dùng cho nhân viên hiện tại.</span></div>
              {form.id && <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Hủy sửa</button>}
            </div>
            <div className="ctw-form-field"><label>Tên nhóm <span>*</span></label><input className="stepper-input" value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} disabled={busy} /></div>
            <div className="ctw-form-field"><label>Mô tả</label><textarea className="stepper-textarea" rows={4} value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} disabled={busy} /></div>
            <div className="ctw-form-field compact"><label>Thứ tự hiển thị</label><input className="stepper-input" type="number" value={form.order} onChange={event => setForm(previous => ({ ...previous, order: Number(event.target.value) || 0 }))} disabled={busy} /></div>
            <div className="ctw-group-status-row">
              <Toggle checked={form.isActive} onChange={isActive => setForm(previous => ({ ...previous, isActive }))} label="Đang hoạt động" disabled={busy} />
            </div>
            <div className="ctw-group-form-actions"><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? <Loader2 size={15} className="ctw-spin" /> : form.id ? <Save size={15} /> : <Plus size={15} />}{form.id ? 'Lưu thay đổi' : 'Thêm nhóm'}</button></div>
          </section>
          <section className="ctw-group-list-card">
            <div className="ctw-section-heading"><div><strong>Danh sách nhóm</strong><span>{groups.length} nhóm nội dung</span></div></div>
            <div className="ctw-group-list">
              {sortedGroups.length === 0 ? (
                <div className="ctw-empty compact"><FolderCog size={30} /><span>Chưa có nhóm nội dung.</span></div>
              ) : sortedGroups.map(group => (
                <article className={`ctw-group-row${group.isActive ? '' : ' inactive'}`} key={group.id}>
                  <div className="ctw-group-order">{group.order}</div>
                  <div className="ctw-group-row-main"><div className="ctw-group-row-title"><strong>{group.name}</strong>{!group.isActive && <span className="ctw-status-badge inactive">Ngừng hoạt động</span>}</div><p>{group.description || 'Chưa có mô tả'}</p><span>{group.templateCount} mẫu nội dung</span></div>
                  <div className="ctw-row-actions"><button type="button" className="btn-icon" title="Sửa nhóm" onClick={() => edit(group)} disabled={busy}><Edit3 size={15} /></button><button type="button" className="btn-icon danger" title={group.templateCount > 0 ? 'Nhóm đang có mẫu nội dung' : 'Xoá nhóm'} onClick={() => remove(group)} disabled={busy || group.templateCount > 0}><Trash2 size={15} /></button></div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ChannelImagesEditor({
  channelName,
  imageUrls,
  onChange,
  disabled
}: {
  channelName: ContentTemplateChannelName
  imageUrls: string[]
  onChange: (urls: string[]) => void
  disabled?: boolean
}) {
  const showAlert = useUiStore(state => state.showAlert)
  const [pickerOpen, setPickerOpen] = useState(false)
  const maximum = CHANNEL_META[channelName].maxImages
  const remaining = Math.max(0, maximum - imageUrls.length)
  const supportsVideo = channelName === 'facebook_post' || channelName === 'facebook_message' || channelName === 'facebook_comment'
  const mediaLabel = supportsVideo ? 'media' : 'ảnh'

  if (maximum === 0) {
    return <div className="ctw-no-images-note"><Info size={15} /> SMS chỉ gửi văn bản nên không đính kèm ảnh.</div>
  }

  const handleConfirm = (items: CampaignMediaSnapshot[]) => {
    const urls = items.flatMap(item => {
      const cloudUrl = String(item.cloudUrl || '').trim()
      if (!/^https?:\/\//i.test(cloudUrl)) return []

      const isVideo = isVideoMediaSource(
        item.mimeType,
        item.name,
        item.localPath,
        cloudUrl
      )
      // Templates store URL strings only, so keep videos whose type remains
      // recognizable after MIME/name metadata is discarded.
      if (isVideo && !isVideoMediaSource('', cloudUrl)) return []
      return [cloudUrl]
    })
    const skipped = items.length - urls.length
    onChange(Array.from(new Set([...imageUrls, ...urls])).slice(0, maximum))
    setPickerOpen(false)
    if (skipped > 0) showAlert(`Chỉ ${mediaLabel} đã upload lên cloud mới có thể lưu cùng mẫu.`, 'info')
  }

  return (
    <>
      <section className="ctw-images-section channel-scoped">
        <div className="ctw-section-heading horizontal">
          <div><strong>{supportsVideo ? 'Media' : 'Ảnh'} riêng cho {CHANNEL_META[channelName].label}</strong><span>{supportsVideo ? 'Ảnh/video' : 'Ảnh'} chỉ dùng cho loại nội dung này.</span></div>
          <span className="ctw-image-limit">{imageUrls.length}/{maximum} {mediaLabel}</span>
        </div>
        <div className="ctw-image-grid">
          {imageUrls.map((url, index) => (
            <div className="ctw-image-tile" key={`${url}-${index}`}>
              {isVideoMediaSource('', url)
                ? <video src={url} aria-label={`Video ${index + 1}`} muted controls preload="metadata" />
                : <img src={url} alt={`Ảnh ${index + 1}`} />}
              <div className="ctw-image-tile-caption" title={getImageName(url)}>{getImageName(url)}</div>
              <button type="button" title="Bỏ media" onClick={() => onChange(imageUrls.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled}><X size={14} /></button>
            </div>
          ))}
          {remaining > 0 && (
            <button type="button" className="ctw-image-add-tile" onClick={() => setPickerOpen(true)} disabled={disabled}>
              <ImageIcon size={21} /><span>Chọn từ Media</span>
            </button>
          )}
        </div>
      </section>
      {pickerOpen && <MediaLibraryModal pickerMode={supportsVideo ? 'image-video' : 'image'} maxSelect={Math.max(1, remaining)} onClose={() => setPickerOpen(false)} onConfirm={handleConfirm} />}
    </>
  )
}

function PersonalizationPanel({
  channelName,
  onInsert,
  disabled
}: {
  channelName: ContentTemplateChannelName
  onInsert: (token: string) => void
  disabled?: boolean
}) {
  const [dateOption, setDateOption] = useState<PersonalizationDateOption>('TODAY')
  const [dateFormat, setDateFormat] = useState<PersonalizationDateFormat>('DD/MM/YYYY')
  const customerTokens = getCustomerPersonalizationTokens(channelName)
  const excelTokens = getExcelPersonalizationTokens(channelName)
  const dateToken = `#{${dateOption}(${dateFormat})}`

  const renderTokens = (tokens: PersonalizationToken[]) => (
    <div className="ctw-personalization-tokens">
      {tokens.map(item => (
        <button
          type="button"
          className="ctw-personalization-token"
          title={`Chèn ${item.token}`}
          onClick={() => onInsert(item.token)}
          disabled={disabled}
          key={item.token}
        >
          <span>{item.label}</span>
          <code>{item.token}</code>
        </button>
      ))}
    </div>
  )

  return (
    <section className="ctw-personalization-panel">
      <div className="ctw-personalization-header">
        <span className="ctw-personalization-icon"><Braces size={16} /></span>
        <div>
          <strong>Cá nhân hoá nội dung</strong>
          <span>Bấm để chèn thông tin vào biến thể đang chọn; hệ thống tự thay dữ liệu thật khi gửi.</span>
        </div>
      </div>
      <div className="ctw-personalization-body">
        {customerTokens.length > 0 && (
          <div className="ctw-personalization-section">
            <div className="ctw-personalization-section-title"><Users size={14} /> Khách hàng</div>
            {renderTokens(customerTokens)}
          </div>
        )}
        {excelTokens.length > 0 && (
          <div className="ctw-personalization-section">
            <div className="ctw-personalization-section-title"><FileText size={14} /> Thông tin từ Excel</div>
            {renderTokens(excelTokens)}
          </div>
        )}
        <div className="ctw-personalization-section">
          <div className="ctw-personalization-section-title"><Calendar size={14} /> Ngày tháng</div>
          <div className="ctw-personalization-date-row">
            <select
              className="stepper-select"
              value={dateOption}
              onChange={event => setDateOption(event.target.value as PersonalizationDateOption)}
              aria-label="Chọn ngày cá nhân hoá"
              disabled={disabled}
            >
              {PERSONALIZATION_DATE_OPTIONS.map(option => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              className="stepper-select"
              value={dateFormat}
              onChange={event => setDateFormat(event.target.value as PersonalizationDateFormat)}
              aria-label="Chọn định dạng ngày"
              disabled={disabled}
            >
              {PERSONALIZATION_DATE_FORMATS.map(format => (
                <option value={format} key={format}>{format}</option>
              ))}
            </select>
            <button
              type="button"
              className="ctw-personalization-token date"
              title={`Chèn ${dateToken}`}
              onClick={() => onInsert(dateToken)}
              disabled={disabled}
            >
              <span>＋ Chèn ngày</span>
              <code>{dateToken}</code>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function VariantEditor({
  channelName,
  channel,
  activeVariantIndex,
  onActiveVariantChange,
  onChange,
  onToggleRich,
  disabled
}: {
  channelName: ContentTemplateChannelName
  channel: ContentTemplateChannelConfig
  activeVariantIndex: number
  onActiveVariantChange: (index: number) => void
  onChange: (channel: ContentTemplateChannelConfig) => void
  onToggleRich: (enabled: boolean) => void
  disabled?: boolean
}) {
  const showAlert = useUiStore(state => state.showAlert)
  const rich = isRichChannel(channelName, channel)
  const meta = CHANNEL_META[channelName]
  const activeVariantIndexRef = useRef(0)
  const plainEditorRefs = useRef<Record<number, HTMLTextAreaElement | null>>({})
  const richEditorRefs = useRef<Record<number, FormattedContentEditorHandle | null>>({})
  const activeCaretValidRef = useRef(false)

  useEffect(() => {
    activeVariantIndexRef.current = activeVariantIndex
    activeCaretValidRef.current = false
  }, [channelName])

  useEffect(() => {
    activeCaretValidRef.current = false
  }, [rich])

  useEffect(() => {
    const nextIndex = Math.max(
      0,
      Math.min(activeVariantIndex, channel.variants.length - 1)
    )
    if (activeVariantIndexRef.current !== nextIndex) {
      activeVariantIndexRef.current = nextIndex
      activeCaretValidRef.current = false
    }
  }, [activeVariantIndex, channel.variants.length])

  const updateVariant = (index: number, text: string) => onChange({
    ...channel,
    variants: channel.variants.map((variant, variantIndex) => variantIndex === index ? { text } : variant)
  })
  const addVariant = () => onChange({ ...channel, variants: [...channel.variants, { text: '' }] })
  const removeVariant = (index: number) => {
    if (channel.variants.length <= 1) return
    if (activeVariantIndexRef.current > index) activeVariantIndexRef.current -= 1
    else if (activeVariantIndexRef.current === index) {
      activeVariantIndexRef.current = Math.min(index, channel.variants.length - 2)
    }
    activeCaretValidRef.current = false
    onActiveVariantChange(activeVariantIndexRef.current)
    onChange({ ...channel, variants: channel.variants.filter((_, variantIndex) => variantIndex !== index) })
  }
  const moveVariant = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= channel.variants.length) return
    const variants = [...channel.variants]
    const [variant] = variants.splice(index, 1)
    variants.splice(target, 0, variant)
    if (activeVariantIndexRef.current === index) activeVariantIndexRef.current = target
    else if (activeVariantIndexRef.current === target) activeVariantIndexRef.current = index
    activeCaretValidRef.current = false
    onActiveVariantChange(activeVariantIndexRef.current)
    onChange({ ...channel, variants })
  }
  const insertToken = (token: string) => {
    if (disabled) return
    const index = Math.max(
      0,
      Math.min(activeVariantIndexRef.current, channel.variants.length - 1)
    )

    if (rich) {
      const editor = richEditorRefs.current[index]
      if (!editor || editor.isDestroyed) {
        showAlert('Vui lòng chọn biến thể cần chèn thông tin.', 'info')
        return
      }
      const focusPosition = activeCaretValidRef.current ? undefined : 'end'
      editor.chain().focus(focusPosition).insertContent(token).run()
      activeCaretValidRef.current = true
      return
    }

    const textarea = plainEditorRefs.current[index]
    const currentValue = channel.variants[index]?.text || ''
    const selectionStart = activeCaretValidRef.current
      ? textarea?.selectionStart ?? currentValue.length
      : currentValue.length
    const selectionEnd = activeCaretValidRef.current
      ? textarea?.selectionEnd ?? selectionStart
      : selectionStart
    const safeStart = Math.max(0, Math.min(selectionStart, currentValue.length))
    const safeEnd = Math.max(safeStart, Math.min(selectionEnd, currentValue.length))
    const nextValue = currentValue.slice(0, safeStart) + token + currentValue.slice(safeEnd)
    const nextCursor = safeStart + token.length

    updateVariant(index, nextValue)
    window.requestAnimationFrame(() => {
      const activeTextarea = plainEditorRefs.current[index]
      activeTextarea?.focus()
      activeTextarea?.setSelectionRange(nextCursor, nextCursor)
      activeCaretValidRef.current = true
    })
  }

  return (
    <div className="ctw-channel-editor">
      {meta.richCapable && (
        <div className="ctw-format-setting">
          <div><strong>Nội dung có định dạng</strong><span>{channelName === 'email' ? 'Soạn nội dung email bằng trình soạn thảo HTML.' : 'Hỗ trợ chữ đậm, danh sách, liên kết và thụt lề.'}</span></div>
          <Toggle checked={rich} onChange={onToggleRich} label={rich ? 'Đang bật' : 'Đang tắt'} disabled={disabled} />
        </div>
      )}
      {channelName === 'email' && (
        <div className="ctw-form-field"><label>Tiêu đề Email <span>*</span></label><input className="stepper-input" value={channel.subject || ''} onChange={event => onChange({ ...channel, subject: event.target.value })} placeholder="Ví dụ: Ưu đãi dành riêng cho #{INPUT_FULLNAME}" disabled={disabled} /><small>Một tiêu đề dùng chung cho mọi biến thể.</small></div>
      )}
      <PersonalizationPanel channelName={channelName} onInsert={insertToken} disabled={disabled} />
      <div className="ctw-variants-heading"><strong>Nội dung {meta.label}</strong><span>{channel.variants.length} biến thể · luân phiên khi gửi</span></div>
      <div className="ctw-variants">
        {channel.variants.map((variant, index) => (
          <article className={`ctw-variant-card${activeVariantIndex === index ? ' active' : ''}`} key={index}>
            <div className="ctw-variant-head"><strong>Biến thể {index + 1}</strong><div className="ctw-row-actions"><button type="button" className="btn-icon" title="Chuyển lên" onClick={() => moveVariant(index, -1)} disabled={disabled || index === 0}><ArrowUp size={14} /></button><button type="button" className="btn-icon" title="Chuyển xuống" onClick={() => moveVariant(index, 1)} disabled={disabled || index === channel.variants.length - 1}><ArrowDown size={14} /></button><button type="button" className="btn-icon danger" title="Xoá biến thể" onClick={() => removeVariant(index)} disabled={disabled || channel.variants.length === 1}><Trash2 size={14} /></button></div></div>
            {rich ? (
              <div className="ctw-rich-editor">
                <FormattedContentEditor
                  value={variant.text}
                  onChange={value => updateVariant(index, value)}
                  onEditorReady={editor => {
                    richEditorRefs.current[index] = editor
                  }}
                  onFocus={editor => {
                    activeVariantIndexRef.current = index
                    activeCaretValidRef.current = true
                    onActiveVariantChange(index)
                    richEditorRefs.current[index] = editor
                  }}
                />
              </div>
            ) : (
              <>
                <textarea
                  ref={element => {
                    plainEditorRefs.current[index] = element
                  }}
                  className="stepper-textarea ctw-variant-textarea"
                  value={variant.text}
                  onChange={event => updateVariant(index, event.target.value)}
                  onFocus={() => {
                    activeVariantIndexRef.current = index
                    activeCaretValidRef.current = true
                    onActiveVariantChange(index)
                  }}
                  onSelect={() => {
                    activeVariantIndexRef.current = index
                    activeCaretValidRef.current = true
                    onActiveVariantChange(index)
                  }}
                  placeholder={`Nhập nội dung ${meta.label.toLocaleLowerCase('vi')}, dùng phần Cá nhân hoá ở trên để chèn thông tin...`}
                  rows={channelName === 'sms' ? 5 : 7}
                  disabled={disabled}
                />
                {channelName === 'sms' && <div className="ctw-sms-count">{variant.text.length} ký tự · {Math.max(1, Math.ceil(variant.text.length / 160))} SMS dự kiến</div>}
              </>
            )}
          </article>
        ))}
      </div>
      <button type="button" className="btn btn-secondary ctw-add-variant" onClick={addVariant} disabled={disabled}><Plus size={15} /> Thêm biến thể</button>
      <ChannelImagesEditor channelName={channelName} imageUrls={channel.imageUrls} onChange={imageUrls => onChange({ ...channel, imageUrls })} disabled={disabled} />
    </div>
  )
}

export default function ContentTemplateWorkspace({
  isActive = true,
  modal = false,
  onClose,
  initialChannel
}: ContentTemplateWorkspaceProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const preferredChannel = initialChannel && CHANNELS.includes(initialChannel) ? initialChannel : 'sms'
  const [view, setView] = useState<WorkspaceView>('list')
  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [groups, setGroups] = useState<ContentTemplateGroup[]>([])
  const [contentTypes, setContentTypes] = useState<ContentTemplateContentType[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<TemplateFilter>(initialChannel || 'all')
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editor, setEditor] = useState<TemplateEditorState>(() => makeEditorState())
  const [editorChannel, setEditorChannel] = useState<ContentTemplateChannelName>(preferredChannel)
  const [showPreviewSampleData, setShowPreviewSampleData] = useState(true)
  const [activeVariantIndexes, setActiveVariantIndexes] = useState<
    Record<ContentTemplateChannelName, number>
  >(() => createVariantIndexRecord())

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    try {
      const [templateResult, groupResult, typeResult] = await Promise.allSettled([
        window.electronAPI.listContentTemplates(),
        window.electronAPI.listContentTemplateGroups(),
        window.electronAPI.listContentTemplateContentTypes()
      ])
      if (templateResult.status === 'rejected') throw templateResult.reason
      setTemplates(templateResult.value)
      if (groupResult.status === 'fulfilled') setGroups(groupResult.value)
      else showAlert(formatError(groupResult.reason, 'Không thể tải nhóm nội dung.'), 'error')
      if (typeResult.status === 'fulfilled') setContentTypes(typeResult.value)
    } catch (error) {
      showAlert(formatError(error, 'Không thể tải mẫu nội dung.'), 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [showAlert])

  useEffect(() => {
    if (isActive) void loadData()
  }, [isActive, loadData])

  useEffect(() => {
    const handleUpdated = () => { if (isActive) void loadData(true) }
    window.addEventListener('content-templates-updated', handleUpdated)
    return () => window.removeEventListener('content-templates-updated', handleUpdated)
  }, [isActive, loadData])

  useEffect(() => {
    if (!initialChannel || !CHANNELS.includes(initialChannel)) return
    setChannelFilter(initialChannel)
    setEditorChannel(initialChannel)
  }, [initialChannel])

  const orderedTypes = useMemo(() => {
    const byName = new Map(contentTypes.map(type => [type.name, type]))
    return CHANNELS.map((name, index) => byName.get(name) || {
      id: -(index + 1), name, label: CHANNEL_META[name].label, order: index + 1, isActive: true
    }).filter(type => type.isActive).sort((a, b) => a.order - b.order)
  }, [contentTypes])

  const activeGroups = useMemo(
    () => groups.filter(group => group.isActive).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi')),
    [groups]
  )

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    return templates.filter(template => {
      if (groupFilter === 'ungrouped' && template.groupId !== null) return false
      if (groupFilter !== 'all' && groupFilter !== 'ungrouped' && template.groupId !== Number(groupFilter)) return false
      if (channelFilter !== 'all' && !template.channels[channelFilter]?.enabled) return false
      if (!query) return true
      const channelText = CHANNELS.flatMap(channelName => {
        const channel = template.channels[channelName]
        if (!channel) return []
        return [channel.subject || '', ...channel.variants.map(variant => isRichChannel(channelName, channel) ? formattedContentToPlainText(variant.text) : variant.text)]
      }).join('\n')
      return `${template.name}\n${template.groupName || ''}\n${channelText}`.toLocaleLowerCase('vi').includes(query)
    })
  }, [channelFilter, groupFilter, search, templates])

  const startCreate = () => {
    const next = makeEditorState()
    next.channels[preferredChannel].enabled = true
    setEditor(next)
    setEditorChannel(preferredChannel)
    setActiveVariantIndexes(createVariantIndexRecord())
    setView('editor')
  }

  const startEdit = (template: ContentTemplate) => {
    const nextChannel = template.channels[preferredChannel]?.enabled
      ? preferredChannel
      : enabledChannels(template)[0] || preferredChannel
    setEditor(makeEditorState(template))
    setEditorChannel(nextChannel)
    setActiveVariantIndexes(createVariantIndexRecord())
    setView('editor')
  }

  const closeEditor = () => {
    setView('list')
    setEditor(makeEditorState())
    setActiveVariantIndexes(createVariantIndexRecord())
  }

  const updateChannel = (name: ContentTemplateChannelName, channel: ContentTemplateChannelConfig) => {
    setEditor(previous => ({ ...previous, channels: { ...previous.channels, [name]: channel } }))
  }

  const toggleChannelFormat = (name: ContentTemplateChannelName, enabled: boolean) => {
    const current = editor.channels[name]
    const currentlyRich = isRichChannel(name, current)
    if (currentlyRich === enabled) return
    const apply = () => {
      const variants = current.variants.map(variant => ({
        text: enabled ? plainTextToFormattedContent(variant.text) : formattedContentToPlainText(variant.text)
      }))
      updateChannel(name, {
        ...current,
        variants,
        ...(name === 'email' ? { isHtml: enabled } : { formattedContentEnabled: enabled })
      })
    }
    const hasContent = current.variants.some(variant => currentlyRich ? !isFormattedContentEmpty(variant.text) : !!variant.text.trim())
    if (!hasContent) {
      apply()
      return
    }
    showConfirm(
      enabled ? 'Nội dung hiện tại sẽ được chuyển sang trình soạn thảo có định dạng.' : 'Định dạng hiện tại sẽ bị loại bỏ và chuyển thành văn bản thường.',
      apply,
      { title: enabled ? 'Bật nội dung có định dạng' : 'Tắt nội dung có định dạng', confirmText: 'Chuyển đổi', variant: 'primary' }
    )
  }

  const saveTemplate = async () => {
    const name = editor.name.replace(/\s+/g, ' ').trim()
    if (!name) {
      showAlert('Vui lòng nhập tên mẫu nội dung.', 'error')
      return
    }

    let enabledCount = 0
    const channels = {} as ChannelRecord
    for (const channelName of CHANNELS) {
      const current = editor.channels[channelName]
      const rich = isRichChannel(channelName, current)
      const variants = current.variants.map(variant => ({
        text: rich ? sanitizeFormattedContent(variant.text) : variant.text.trim()
      }))
      const channel: ContentTemplateChannelConfig = {
        ...current,
        variants,
        imageUrls: current.imageUrls.slice(0, CHANNEL_META[channelName].maxImages)
      }
      channels[channelName] = channel
      if (!channel.enabled) continue
      enabledCount += 1
      const hasContent = channel.variants.some(variant => rich ? !isFormattedContentEmpty(variant.text) : !!variant.text.trim())
      if (!hasContent) {
        showAlert(`Vui lòng nhập ít nhất một biến thể cho ${CHANNEL_META[channelName].label}.`, 'error')
        setEditorChannel(channelName)
        return
      }
      if (channelName === 'email' && !String(channel.subject || '').trim()) {
        showAlert('Vui lòng nhập tiêu đề Email.', 'error')
        setEditorChannel('email')
        return
      }
    }
    if (enabledCount === 0) {
      showAlert('Vui lòng bật và nhập nội dung cho ít nhất một loại nội dung.', 'error')
      return
    }

    setBusy(true)
    try {
      if (editor.id) {
        const updates: UpdateContentTemplateInput = { name, groupId: editor.groupId, channels }
        await window.electronAPI.updateContentTemplate(editor.id, updates)
        showAlert('Đã cập nhật mẫu nội dung.', 'success')
      } else {
        const input: CreateContentTemplateInput = { name, groupId: editor.groupId, channels }
        await window.electronAPI.createContentTemplate(input)
        showAlert('Đã tạo mẫu nội dung.', 'success')
      }
      closeEditor()
      await loadData(true)
      window.dispatchEvent(new Event('content-templates-updated'))
    } catch (error) {
      showAlert(formatError(error, 'Không thể lưu mẫu nội dung.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const deleteTemplate = (template: ContentTemplate) => {
    showConfirm(
      `Bạn có muốn xoá mẫu nội dung “${template.name}” không?`,
      async () => {
        setBusy(true)
        try {
          await window.electronAPI.deleteContentTemplate(template.id)
          await loadData(true)
          window.dispatchEvent(new Event('content-templates-updated'))
          showAlert('Đã xoá mẫu nội dung.', 'success')
        } catch (error) {
          showAlert(formatError(error, 'Không thể xoá mẫu nội dung.'), 'error')
        } finally {
          setBusy(false)
        }
      },
      { title: 'Xoá mẫu nội dung', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const activeChannel = editor.channels[editorChannel]
  const activeVariantIndex = Math.max(
    0,
    Math.min(activeVariantIndexes[editorChannel], activeChannel.variants.length - 1)
  )
  const setActiveVariantIndex = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, activeChannel.variants.length - 1))
    setActiveVariantIndexes(previous => (
      previous[editorChannel] === nextIndex
        ? previous
        : { ...previous, [editorChannel]: nextIndex }
    ))
  }

  const renderList = () => (
    <>
      <header className="ctw-page-header">
        <div><div className="ctw-title-row"><MessageSquareText size={23} /><h1>Mẫu nội dung</h1></div><p>Soạn nội dung và ảnh riêng cho từng loại chiến dịch.</p></div>
        <div className="ctw-header-actions"><button type="button" className="btn btn-secondary" onClick={() => setGroupDialogOpen(true)}><FolderCog size={16} /> Quản lý nhóm</button><button type="button" className="btn btn-primary" onClick={startCreate}><Plus size={16} /> Thêm nội dung</button>{modal && onClose && <button type="button" className="btn-icon ctw-close" onClick={onClose} title="Đóng"><X size={19} /></button>}</div>
      </header>
      <div className="ctw-list-body">
        <section className="ctw-filter-card">
          <div className="ctw-search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo tên hoặc nội dung..." /></div>
          <select className="stepper-select" value={groupFilter} onChange={event => setGroupFilter(event.target.value)} aria-label="Lọc theo nhóm"><option value="all">Tất cả nhóm</option><option value="ungrouped">Chưa phân nhóm</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}{group.isActive ? '' : ' (ngừng hoạt động)'}</option>)}</select>
          <select className="stepper-select" value={channelFilter} onChange={event => setChannelFilter(event.target.value as TemplateFilter)} aria-label="Lọc theo loại nội dung"><option value="all">Tất cả loại nội dung</option>{orderedTypes.map(type => <option key={type.name} value={type.name}>{CHANNEL_META[type.name].label}</option>)}</select>
          <button type="button" className="btn-icon" title="Tải lại" onClick={() => void loadData(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'ctw-spin' : ''} /></button>
        </section>
        <div className="ctw-list-summary"><strong>{filteredTemplates.length} mẫu nội dung</strong>{(search || groupFilter !== 'all' || channelFilter !== 'all') && <span>theo bộ lọc hiện tại</span>}</div>
        {loading ? (
          <div className="ctw-empty"><Loader2 size={32} className="ctw-spin" /><strong>Đang tải mẫu nội dung...</strong></div>
        ) : filteredTemplates.length === 0 ? (
          <div className="ctw-empty"><FileText size={38} /><strong>{templates.length === 0 ? 'Chưa có mẫu nội dung' : 'Không tìm thấy mẫu phù hợp'}</strong><span>{templates.length === 0 ? 'Tạo mẫu đầu tiên để sử dụng lại trong các chiến dịch.' : 'Thử thay đổi từ khóa hoặc bộ lọc.'}</span>{templates.length === 0 && <button type="button" className="btn btn-primary" onClick={startCreate}><Plus size={15} /> Thêm nội dung</button>}</div>
        ) : (
          <div className="ctw-template-grid">
            {filteredTemplates.map(template => {
              const activeChannels = enabledChannels(template)
              const displayedChannels = channelFilter === 'all' ? activeChannels : [channelFilter]
              const firstChannel = displayedChannels[0]
              const preview = firstChannel && template.channels[firstChannel]
                ? getVariantPreview(firstChannel, template.channels[firstChannel]!)
                : ''
              const variantCount = displayedChannels.reduce((total, channelName) => total + (template.channels[channelName]?.variants.length || 0), 0)
              const imageCount = channelFilter === 'all'
                ? templateImageCount(template)
                : template.channels[channelFilter]?.imageUrls.length || 0
              return (
                <article className="ctw-template-card" key={template.id}>
                  <div className="ctw-template-card-head"><div className="ctw-template-icon"><FileText size={18} /></div><div className="ctw-template-title"><h3 title={template.name}>{template.name}</h3><span>{template.groupName || 'Chưa phân nhóm'}</span></div><div className="ctw-row-actions"><button type="button" className="btn-icon" title="Sửa mẫu" onClick={() => startEdit(template)} disabled={busy}><Edit3 size={15} /></button><button type="button" className="btn-icon danger" title="Xoá mẫu" onClick={() => deleteTemplate(template)} disabled={busy}><Trash2 size={15} /></button></div></div>
                  <div className="ctw-channel-badges">{activeChannels.map(channelName => <span className={`ctw-channel-badge ${channelName}`} key={channelName}>{CHANNEL_META[channelName].shortLabel}</span>)}</div>
                  <p className="ctw-template-excerpt">{preview || 'Chưa có nội dung v2 cho các loại đang bật'}</p>
                  <div className="ctw-template-card-foot"><span><MessageSquareText size={13} /> {variantCount} biến thể</span><span><ImageIcon size={13} /> {imageCount} media</span><span>{template.updatedAt ? `Cập nhật ${new Date(template.updatedAt).toLocaleDateString('vi-VN')}` : ''}</span></div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </>
  )

  const renderEditor = () => (
    <>
      <header className="ctw-editor-header compact-composer">
        <div className="ctw-editor-heading"><button type="button" className="btn-icon" onClick={closeEditor} title="Quay lại"><ArrowLeft size={19} /></button><div className="ctw-editor-title-field"><span>Mẫu nội dung / Soạn nội dung đa kênh</span><input value={editor.name} onChange={event => setEditor(previous => ({ ...previous, name: event.target.value }))} placeholder="Tên mẫu nội dung" disabled={busy} /></div></div>
        <div className="ctw-editor-group-field"><span>Nhóm</span><select className="stepper-select" value={editor.groupId ?? ''} onChange={event => setEditor(previous => ({ ...previous, groupId: event.target.value ? Number(event.target.value) : null }))} disabled={busy}><option value="">Không chọn nhóm</option>{activeGroups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}{editor.groupId !== null && !activeGroups.some(group => group.id === editor.groupId) && <option value={editor.groupId}>{groups.find(group => group.id === editor.groupId)?.name || 'Nhóm ngừng hoạt động'}</option>}</select><button type="button" className="btn-icon" onClick={() => setGroupDialogOpen(true)} title="Quản lý nhóm"><FolderCog size={16} /></button></div>
        <div className="ctw-header-actions"><button type="button" className="btn btn-ghost" onClick={closeEditor} disabled={busy}>Hủy</button><button type="button" className="btn btn-primary" onClick={() => void saveTemplate()} disabled={busy}>{busy ? <Loader2 size={16} className="ctw-spin" /> : <Save size={16} />}{busy ? 'Đang lưu...' : 'Lưu nội dung'}</button>{modal && onClose && <button type="button" className="btn-icon ctw-close" onClick={onClose} title="Đóng"><X size={19} /></button>}</div>
      </header>
      <div className="ctw-composer-layout">
        <aside className="ctw-channel-rail">
          <div className="ctw-channel-rail-heading"><strong>Loại nội dung</strong><span>Mỗi loại có nội dung và ảnh riêng.</span></div>
          <div className="ctw-channel-rail-list">
            {orderedTypes.map(type => {
              const channel = editor.channels[type.name]
              const active = editorChannel === type.name
              return (
                <button type="button" className={`ctw-channel-rail-item ${type.name}${active ? ' active' : ''}${channel.enabled ? '' : ' disabled-channel'}`} onClick={() => setEditorChannel(type.name)} key={type.name}>
                  <span className="ctw-channel-mono">{CHANNEL_META[type.name].mono}</span><span className="ctw-channel-rail-copy"><strong>{CHANNEL_META[type.name].label}</strong><small>{channel.enabled ? `${channel.variants.length} biến thể · ${channel.imageUrls.length} media` : 'Đang tắt'}</small></span><span className={`ctw-channel-dot${channel.enabled ? ' on' : ''}`} />
                </button>
              )
            })}
          </div>
          <div className="ctw-channel-rail-foot">Nội dung được lưu độc lập theo đúng loại chiến dịch, không dùng nội dung cơ bản hay ảnh dùng chung.</div>
        </aside>
        <main className="ctw-composer-main">
          <div className="ctw-channel-editor-heading"><span className={`ctw-channel-hero-icon ${editorChannel}`}>{CHANNEL_META[editorChannel].mono}</span><div><div><h2>{CHANNEL_META[editorChannel].label}</h2>{activeChannel.enabled && <span className="ctw-status-badge active"><Check size={12} /> Đang bật</span>}</div><p>{CHANNEL_META[editorChannel].description}</p></div><Toggle checked={activeChannel.enabled} onChange={enabled => updateChannel(editorChannel, { ...activeChannel, enabled })} label={activeChannel.enabled ? 'Đang sử dụng' : 'Chưa sử dụng'} disabled={busy} /></div>
          {activeChannel.enabled ? (
            <VariantEditor
              channelName={editorChannel}
              channel={activeChannel}
              activeVariantIndex={activeVariantIndex}
              onActiveVariantChange={setActiveVariantIndex}
              onChange={channel => updateChannel(editorChannel, channel)}
              onToggleRich={enabled => toggleChannelFormat(editorChannel, enabled)}
              disabled={busy}
            />
          ) : (
            <div className="ctw-channel-disabled"><MessageSquareText size={35} /><strong>{CHANNEL_META[editorChannel].label} đang tắt</strong><span>Bật loại nội dung này để soạn biến thể và chọn ảnh riêng.</span><button type="button" className="btn btn-primary" onClick={() => updateChannel(editorChannel, { ...activeChannel, enabled: true })}>Bật {CHANNEL_META[editorChannel].label}</button></div>
          )}
        </main>
        <aside className="ctw-live-preview">
          <div className="ctw-live-preview-heading">
            <div className="ctw-live-preview-copy">
              <strong>Xem trước</strong>
              <span>
                {showPreviewSampleData
                  ? 'Đang thay mã cá nhân hoá bằng dữ liệu khách hàng mẫu.'
                  : 'Đang hiển thị nguyên mã cá nhân hoá #{...}.'}
              </span>
            </div>
            <Toggle
              checked={showPreviewSampleData}
              onChange={setShowPreviewSampleData}
              label="Hiển thị dữ liệu mẫu"
            />
          </div>
          {activeChannel.enabled ? (
            <ContentTemplatePreview
              channel={editorChannel}
              variants={activeChannel.variants.map(variant => variant.text)}
              formatted={isRichChannel(editorChannel, activeChannel)}
              subject={activeChannel.subject}
              imageUrls={activeChannel.imageUrls}
              showSampleData={showPreviewSampleData}
              activeVariantIndex={activeVariantIndex}
              onActiveVariantChange={setActiveVariantIndex}
            />
          ) : (
            <div className="ctw-preview-disabled"><MessageSquareText size={35} /><strong>Chưa có nội dung xem trước</strong><span>Bật loại nội dung để bắt đầu soạn.</span></div>
          )}
        </aside>
      </div>
    </>
  )

  return (
    <div className={`ctw-workspace${modal ? ' modal-mode' : ''}`}>
      {view === 'list' ? renderList() : renderEditor()}
      {groupDialogOpen && <GroupManagerDialog groups={groups} onClose={() => setGroupDialogOpen(false)} onChanged={async () => { await loadData(true) }} />}
    </div>
  )
}
