import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Edit3,
  Eye,
  FileText,
  FolderCog,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
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
import { serializeContentVariants } from '../../../../shared/contentSpin'
import {
  formattedContentToPlainCampaignContent,
  formattedContentToPlainText,
  isFormattedContentEmpty,
  plainTextToFormattedContent,
  sanitizeFormattedContent
} from '../../../../shared/formattedContent'
import { useUiStore } from '../../stores/uiStore'
import MediaLibraryModal from '../Media/MediaLibraryModal'
import { FormattedContentEditor } from '../CampaignPanels/EmailHtmlEditor'
import ContentTemplatePreview, { type TemplatePreviewChannel } from './ContentTemplatePreview'
import './contentTemplateWorkspace.css'

const CHANNELS: ContentTemplateChannelName[] = ['sms', 'zalo', 'facebook', 'email']
const CHANNEL_LABELS: Record<ContentTemplateChannelName, string> = {
  sms: 'SMS',
  zalo: 'Zalo',
  facebook: 'Facebook',
  email: 'Email'
}

type WorkspaceView = 'list' | 'editor'
type EditorTab = 'base' | ContentTemplateChannelName
type EditorPanel = 'content' | 'preview'
type TemplateFilter = 'all' | 'base' | ContentTemplateChannelName

interface ContentTemplateWorkspaceProps {
  isActive?: boolean
  modal?: boolean
  onClose?: () => void
}

interface TemplateEditorState {
  id: number | null
  originalGroupId: number | null
  name: string
  groupId: number | null
  baseContentHtml: string
  imageUrls: string[]
  channels: Record<ContentTemplateChannelName, ContentTemplateChannelConfig>
  contentTypeId: number | null
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

const emptyChannel = (): ContentTemplateChannelConfig => ({
  enabled: false,
  variants: [{ text: '' }],
  formattedContentEnabled: false
})

const normalizeChannel = (
  channel: ContentTemplateChannelConfig | undefined,
  name: ContentTemplateChannelName
): ContentTemplateChannelConfig => ({
  enabled: !!channel?.enabled,
  variants: Array.isArray(channel?.variants) && channel.variants.length > 0
    ? channel.variants.map(variant => ({ text: String(variant?.text || '') }))
    : [{ text: '' }],
  formattedContentEnabled: name === 'email'
    ? undefined
    : !!channel?.formattedContentEnabled,
  ...(name === 'email'
    ? {
        subject: String(channel?.subject || ''),
        isHtml: !!channel?.isHtml
      }
    : {})
})

const makeEditorState = (template?: ContentTemplate | null): TemplateEditorState => {
  const baseContentHtml = template?.baseContentHtml
    ? sanitizeFormattedContent(template.baseContentHtml)
    : plainTextToFormattedContent(template?.content || '')

  return {
    id: template?.id || null,
    originalGroupId: template?.groupId ?? null,
    name: template?.name || '',
    groupId: template?.groupId ?? null,
    baseContentHtml,
    imageUrls: Array.isArray(template?.imageUrls) ? template.imageUrls.filter(Boolean) : [],
    channels: {
      sms: normalizeChannel(template?.channels?.sms, 'sms'),
      zalo: normalizeChannel(template?.channels?.zalo, 'zalo'),
      facebook: normalizeChannel(template?.channels?.facebook, 'facebook'),
      email: normalizeChannel(template?.channels?.email, 'email')
    },
    contentTypeId: template?.contentTypeId ?? null
  }
}

const formatError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error || '')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}

const compactText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const getTemplateBasePreview = (template: ContentTemplate): string => {
  if (template.baseContentHtml) return compactText(formattedContentToPlainText(template.baseContentHtml))
  return compactText(template.content || '')
}

const isRichChannel = (name: ContentTemplateChannelName, channel: ContentTemplateChannelConfig): boolean =>
  name === 'email' ? !!channel.isHtml : !!channel.formattedContentEnabled

const isVariantEmpty = (text: string, rich: boolean): boolean =>
  rich ? isFormattedContentEmpty(text) : !String(text || '').trim()

const isChannelContentEmpty = (name: ContentTemplateChannelName, channel: ContentTemplateChannelConfig): boolean => {
  const rich = isRichChannel(name, channel)
  return channel.variants.every(variant => isVariantEmpty(variant.text, rich))
}

const getEnabledChannels = (template: ContentTemplate): ContentTemplateChannelName[] =>
  CHANNELS.filter(channel => !!template.channels?.[channel]?.enabled)

const getTemplateVariantCount = (template: ContentTemplate): number => {
  const counts = getEnabledChannels(template).map(channel => template.channels?.[channel]?.variants?.length || 0)
  return counts.length > 0 ? Math.max(...counts) : 1
}

const getTemplateChannelPreview = (template: ContentTemplate): string => {
  for (const name of getEnabledChannels(template)) {
    const channel = template.channels?.[name]
    const variant = channel?.variants?.find(item => String(item.text || '').trim())
    if (!channel || !variant) continue
    return compactText(isRichChannel(name, channel) ? formattedContentToPlainText(variant.text) : variant.text)
  }
  return ''
}

const getImageName = (url: string): string => {
  try {
    const pathname = new URL(url).pathname
    return decodeURIComponent(pathname.split('/').pop() || 'Ảnh mẫu')
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
      >
        <span />
      </button>
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
    if ((group.templateCount || 0) > 0) {
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
          <div>
            <h3>Quản lý nhóm nội dung</h3>
            <p>Sắp xếp mẫu nội dung theo từng nhóm để tìm và sử dụng nhanh hơn.</p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Đóng"><X size={18} /></button>
        </div>

        <div className="ctw-group-dialog-body">
          <section className="ctw-group-form-card">
            <div className="ctw-section-heading">
              <div>
                <strong>{form.id ? 'Sửa nhóm' : 'Thêm nhóm mới'}</strong>
                <span>{form.id ? 'Cập nhật thông tin nhóm đang chọn.' : 'Tạo nhóm dùng riêng cho tài khoản hiện tại.'}</span>
              </div>
              {form.id && <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Hủy sửa</button>}
            </div>
            <div className="ctw-form-field">
              <label>Tên nhóm <span>*</span></label>
              <input
                className="stepper-input"
                value={form.name}
                onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))}
                placeholder="Ví dụ: Chăm sóc khách hàng"
                disabled={busy}
              />
            </div>
            <div className="ctw-form-field">
              <label>Mô tả</label>
              <textarea
                className="stepper-textarea"
                value={form.description}
                onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))}
                placeholder="Mô tả ngắn về nhóm nội dung"
                rows={4}
                disabled={busy}
              />
            </div>
            <div className="ctw-form-field compact">
              <label>Thứ tự hiển thị</label>
              <input
                className="stepper-input"
                type="number"
                value={form.order}
                onChange={event => setForm(previous => ({ ...previous, order: Number(event.target.value) || 0 }))}
                disabled={busy}
              />
            </div>
            <div className="ctw-group-status-row">
              <Toggle
                checked={form.isActive}
                onChange={isActive => setForm(previous => ({ ...previous, isActive }))}
                label="Đang hoạt động"
                disabled={busy}
              />
            </div>
            <div className="ctw-group-form-actions">
              <button type="button" className="btn btn-primary ctw-group-save" onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 size={15} className="ctw-spin" /> : form.id ? <Save size={15} /> : <Plus size={15} />}
                {form.id ? 'Lưu thay đổi' : 'Thêm nhóm'}
              </button>
            </div>
          </section>

          <section className="ctw-group-list-card">
            <div className="ctw-section-heading">
              <div><strong>Danh sách nhóm</strong><span>{groups.length} nhóm nội dung</span></div>
            </div>
            <div className="ctw-group-list">
              {sortedGroups.length === 0 ? (
                <div className="ctw-empty compact"><FolderCog size={30} /><span>Chưa có nhóm nội dung.</span></div>
              ) : sortedGroups.map(group => (
                <article className={`ctw-group-row${group.isActive ? '' : ' inactive'}`} key={group.id}>
                  <div className="ctw-group-order">{group.order}</div>
                  <div className="ctw-group-row-main">
                    <div className="ctw-group-row-title">
                      <strong>{group.name}</strong>
                      {!group.isActive && <span className="ctw-status-badge inactive">Ngừng hoạt động</span>}
                    </div>
                    <p>{group.description || 'Chưa có mô tả'}</p>
                    <span>{group.templateCount || 0} mẫu nội dung</span>
                  </div>
                  <div className="ctw-row-actions">
                    <button type="button" className="btn-icon" title="Sửa nhóm" onClick={() => edit(group)} disabled={busy}><Edit3 size={15} /></button>
                    <button
                      type="button"
                      className="btn-icon danger"
                      title={(group.templateCount || 0) > 0 ? 'Nhóm đang có mẫu nội dung' : 'Xoá nhóm'}
                      onClick={() => remove(group)}
                      disabled={busy || (group.templateCount || 0) > 0}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function SharedImagesEditor({
  imageUrls,
  onChange,
  disabled
}: {
  imageUrls: string[]
  onChange: (urls: string[]) => void
  disabled?: boolean
}) {
  const showAlert = useUiStore(state => state.showAlert)
  const [pickerOpen, setPickerOpen] = useState(false)
  const remaining = Math.max(0, 10 - imageUrls.length)

  const handleConfirm = (items: CampaignMediaSnapshot[]) => {
    const selectedUrls = items
      .map(item => item.cloudUrl || '')
      .filter(Boolean)
    const skipped = items.length - selectedUrls.length
    const merged = Array.from(new Set([...imageUrls, ...selectedUrls])).slice(0, 10)
    onChange(merged)
    setPickerOpen(false)
    if (skipped > 0) showAlert('Chỉ ảnh đã upload lên cloud mới có thể lưu cùng mẫu.', 'info')
  }

  return (
    <>
      <section className="ctw-images-section">
        <div className="ctw-section-heading horizontal">
          <div>
            <strong>Ảnh dùng chung</strong>
            <span>Ảnh được áp dụng cùng nội dung khi chọn mẫu. Tối đa 10 ảnh.</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPickerOpen(true)}
            disabled={disabled || remaining === 0}
          >
            <ImageIcon size={15} /> Chọn ảnh từ Media
          </button>
        </div>
        {imageUrls.length === 0 ? (
          <button type="button" className="ctw-image-empty" onClick={() => setPickerOpen(true)} disabled={disabled}>
            <ImageIcon size={28} />
            <strong>Chưa có ảnh dùng chung</strong>
            <span>Chọn ảnh có sẵn hoặc upload ảnh mới trong Media.</span>
          </button>
        ) : (
          <div className="ctw-image-grid">
            {imageUrls.map((url, index) => (
              <div className="ctw-image-tile" key={`${url}-${index}`}>
                <img src={url} alt={`Ảnh mẫu ${index + 1}`} />
                <div className="ctw-image-tile-caption" title={getImageName(url)}>{getImageName(url)}</div>
                <button
                  type="button"
                  title="Bỏ ảnh"
                  onClick={() => onChange(imageUrls.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={disabled}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="ctw-image-count">{imageUrls.length}/10 ảnh</div>
      </section>
      {pickerOpen && (
        <MediaLibraryModal
          pickerMode="image"
          maxSelect={Math.max(1, remaining)}
          onClose={() => setPickerOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}

function VariantEditor({
  channelName,
  channel,
  onChange,
  onToggleRich,
  disabled
}: {
  channelName: ContentTemplateChannelName
  channel: ContentTemplateChannelConfig
  onChange: (channel: ContentTemplateChannelConfig) => void
  onToggleRich: (enabled: boolean) => void
  disabled?: boolean
}) {
  const rich = isRichChannel(channelName, channel)
  const supportsRich = channelName !== 'sms'

  const updateVariant = (index: number, text: string) => {
    const variants = channel.variants.map((variant, variantIndex) => variantIndex === index ? { text } : variant)
    onChange({ ...channel, variants })
  }

  const addVariant = () => onChange({ ...channel, variants: [...channel.variants, { text: '' }] })

  const removeVariant = (index: number) => {
    if (channel.variants.length <= 1) return
    onChange({ ...channel, variants: channel.variants.filter((_, variantIndex) => variantIndex !== index) })
  }

  const moveVariant = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= channel.variants.length) return
    const variants = [...channel.variants]
    const [variant] = variants.splice(index, 1)
    variants.splice(target, 0, variant)
    onChange({ ...channel, variants })
  }

  return (
    <div className="ctw-channel-editor">
      {supportsRich && (
        <div className="ctw-format-setting">
          <div>
            <strong>Nội dung có định dạng</strong>
            <span>{channelName === 'email' ? 'Soạn email bằng trình soạn thảo HTML.' : `Dùng chữ đậm, danh sách, liên kết và định dạng hỗ trợ trên ${CHANNEL_LABELS[channelName]}.`}</span>
          </div>
          <Toggle checked={rich} onChange={onToggleRich} label={rich ? 'Đang bật' : 'Đang tắt'} disabled={disabled} />
        </div>
      )}

      {channelName === 'email' && (
        <div className="ctw-form-field">
          <label>Tiêu đề email</label>
          <input
            className="stepper-input"
            value={channel.subject || ''}
            onChange={event => onChange({ ...channel, subject: event.target.value })}
            placeholder="Ví dụ: Ưu đãi dành riêng cho #{FULL_NAME}"
            disabled={disabled}
          />
          <small>Một tiêu đề dùng chung cho tất cả biến thể nội dung.</small>
        </div>
      )}

      <div className="ctw-variants">
        {channel.variants.map((variant, index) => (
          <article className="ctw-variant-card" key={index}>
            <div className="ctw-variant-head">
              <strong>Biến thể {index + 1}</strong>
              <div className="ctw-row-actions">
                <button type="button" className="btn-icon" title="Chuyển lên" onClick={() => moveVariant(index, -1)} disabled={disabled || index === 0}><ArrowUp size={14} /></button>
                <button type="button" className="btn-icon" title="Chuyển xuống" onClick={() => moveVariant(index, 1)} disabled={disabled || index === channel.variants.length - 1}><ArrowDown size={14} /></button>
                <button type="button" className="btn-icon danger" title="Xoá biến thể" onClick={() => removeVariant(index)} disabled={disabled || channel.variants.length === 1}><Trash2 size={14} /></button>
              </div>
            </div>
            {rich ? (
              <div className="ctw-rich-editor">
                <FormattedContentEditor value={variant.text} onChange={value => updateVariant(index, value)} />
              </div>
            ) : (
              <>
                <textarea
                  className="stepper-textarea ctw-variant-textarea"
                  value={variant.text}
                  onChange={event => updateVariant(index, event.target.value)}
                  placeholder={`Nhập nội dung ${CHANNEL_LABELS[channelName]} cho biến thể ${index + 1}`}
                  rows={channelName === 'sms' ? 5 : 7}
                  disabled={disabled}
                />
                {channelName === 'sms' && (
                  <div className="ctw-sms-count">
                    {variant.text.length} ký tự · {Math.max(1, Math.ceil(variant.text.length / 160))} SMS dự kiến
                  </div>
                )}
              </>
            )}
          </article>
        ))}
      </div>
      <button type="button" className="btn btn-secondary ctw-add-variant" onClick={addVariant} disabled={disabled}>
        <Plus size={15} /> Thêm biến thể
      </button>
    </div>
  )
}

export default function ContentTemplateWorkspace({
  isActive = true,
  modal = false,
  onClose
}: ContentTemplateWorkspaceProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [view, setView] = useState<WorkspaceView>('list')
  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [groups, setGroups] = useState<ContentTemplateGroup[]>([])
  const [contentTypes, setContentTypes] = useState<ContentTemplateContentType[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<TemplateFilter>('all')
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editor, setEditor] = useState<TemplateEditorState>(() => makeEditorState())
  const [editorTab, setEditorTab] = useState<EditorTab>('base')
  const [editorPanel, setEditorPanel] = useState<EditorPanel>('content')

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
    if (!isActive) return
    void loadData()
  }, [isActive, loadData])

  useEffect(() => {
    const handleUpdated = () => {
      if (isActive) void loadData(true)
    }
    window.addEventListener('content-templates-updated', handleUpdated)
    return () => window.removeEventListener('content-templates-updated', handleUpdated)
  }, [isActive, loadData])

  const orderedTypes = useMemo(() => {
    const byName = new Map(contentTypes.map(type => [type.name, type]))
    return CHANNELS.map((name, index) => byName.get(name) || {
      id: -(index + 1),
      name,
      label: CHANNEL_LABELS[name],
      order: index + 1,
      isActive: true
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
      if (channelFilter === 'base' && !getTemplateBasePreview(template)) return false
      if (channelFilter !== 'all' && channelFilter !== 'base' && !template.channels?.[channelFilter]?.enabled) return false
      if (!query) return true
      const channelText = CHANNELS.flatMap(channel => template.channels?.[channel]?.variants || []).map(variant => variant.text).join('\n')
      return `${template.name}\n${template.groupName || ''}\n${template.content || ''}\n${channelText}`.toLocaleLowerCase('vi').includes(query)
    })
  }, [channelFilter, groupFilter, search, templates])

  const startCreate = () => {
    setEditor(makeEditorState())
    setEditorTab('base')
    setEditorPanel('content')
    setView('editor')
  }

  const startEdit = (template: ContentTemplate) => {
    setEditor(makeEditorState(template))
    setEditorTab('base')
    setEditorPanel('content')
    setView('editor')
  }

  const closeEditor = () => {
    setView('list')
    setEditor(makeEditorState())
  }

  const updateChannel = (name: ContentTemplateChannelName, channel: ContentTemplateChannelConfig) => {
    setEditor(previous => ({ ...previous, channels: { ...previous.channels, [name]: channel } }))
  }

  const toggleChannelFormat = (name: ContentTemplateChannelName, enabled: boolean) => {
    const current = editor.channels[name]
    const currentRich = isRichChannel(name, current)
    if (currentRich === enabled) return

    const apply = () => {
      const variants = current.variants.map(variant => ({
        text: enabled
          ? plainTextToFormattedContent(variant.text)
          : formattedContentToPlainText(variant.text)
      }))
      updateChannel(name, {
        ...current,
        variants,
        ...(name === 'email' ? { isHtml: enabled } : { formattedContentEnabled: enabled })
      })
    }

    if (current.variants.every(variant => isVariantEmpty(variant.text, currentRich))) {
      apply()
      return
    }
    showConfirm(
      enabled
        ? 'Nội dung hiện tại sẽ được chuyển sang trình soạn thảo có định dạng.'
        : 'Định dạng hiện tại sẽ bị loại bỏ và nội dung được chuyển thành văn bản thường.',
      apply,
      { title: enabled ? 'Bật nội dung có định dạng' : 'Tắt nội dung có định dạng', confirmText: 'Chuyển đổi', variant: 'primary' }
    )
  }

  const makePlainFallback = (baseContentHtml: string, channels: TemplateEditorState['channels']): string => {
    if (!isFormattedContentEmpty(baseContentHtml)) return formattedContentToPlainCampaignContent(baseContentHtml)
    for (const name of CHANNELS) {
      const channel = channels[name]
      if (!channel.enabled || isChannelContentEmpty(name, channel)) continue
      const rich = isRichChannel(name, channel)
      return serializeContentVariants(channel.variants.map(variant => rich ? formattedContentToPlainText(variant.text) : variant.text))
    }
    return ''
  }

  const saveTemplate = async () => {
    const name = editor.name.replace(/\s+/g, ' ').trim()
    if (!name) {
      showAlert('Vui lòng nhập tên mẫu nội dung.', 'error')
      return
    }
    if (!editor.id && editor.groupId === null) {
      showAlert('Vui lòng chọn nhóm nội dung.', 'error')
      return
    }

    for (const channelName of CHANNELS) {
      const channel = editor.channels[channelName]
      if (channel.enabled && isChannelContentEmpty(channelName, channel)) {
        showAlert(`Vui lòng nhập ít nhất một biến thể cho ${CHANNEL_LABELS[channelName]}.`, 'error')
        setEditorTab(channelName)
        setEditorPanel('content')
        return
      }
      if (channelName === 'email' && channel.enabled && !String(channel.subject || '').trim()) {
        showAlert('Vui lòng nhập tiêu đề Email.', 'error')
        setEditorTab('email')
        setEditorPanel('content')
        return
      }
    }

    const sanitizedBase = sanitizeFormattedContent(editor.baseContentHtml)
    const channels = CHANNELS.reduce<TemplateEditorState['channels']>((result, channelName) => {
      const channel = editor.channels[channelName]
      const rich = isRichChannel(channelName, channel)
      result[channelName] = {
        ...channel,
        variants: channel.variants.map(variant => ({
          text: rich ? sanitizeFormattedContent(variant.text) : variant.text.trim()
        }))
      }
      return result
    }, {
      sms: emptyChannel(),
      zalo: emptyChannel(),
      facebook: emptyChannel(),
      email: emptyChannel()
    })
    const content = makePlainFallback(sanitizedBase, channels)
    if (!content) {
      showAlert('Vui lòng nhập Nội dung cơ bản hoặc bật và nhập nội dung cho ít nhất một kênh.', 'error')
      return
    }

    setBusy(true)
    try {
      if (editor.id) {
        const updates: UpdateContentTemplateInput = {
          name,
          content,
          groupId: editor.groupId,
          baseContentHtml: isFormattedContentEmpty(sanitizedBase) ? null : sanitizedBase,
          imageUrls: editor.imageUrls,
          channels
        }
        await window.electronAPI.updateContentTemplate(editor.id, updates)
        showAlert('Đã cập nhật mẫu nội dung.', 'success')
      } else {
        const input: CreateContentTemplateInput = {
          name,
          content,
          groupId: editor.groupId,
          baseContentHtml: isFormattedContentEmpty(sanitizedBase) ? null : sanitizedBase,
          imageUrls: editor.imageUrls,
          channels
        }
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

  const activeEditorChannel = editorTab === 'base' ? null : editor.channels[editorTab]
  const previewVariants = editorTab === 'base'
    ? [editor.baseContentHtml]
    : activeEditorChannel?.variants.map(variant => variant.text) || ['']
  const previewFormatted = editorTab === 'base'
    ? true
    : activeEditorChannel ? isRichChannel(editorTab, activeEditorChannel) : false

  const renderList = () => (
    <>
      <header className="ctw-page-header">
        <div>
          <div className="ctw-title-row"><MessageSquareText size={23} /><h1>Mẫu nội dung</h1></div>
          <p>Quản lý nội dung dùng lại cho chiến dịch SMS, Zalo, Facebook và Email.</p>
        </div>
        <div className="ctw-header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setGroupDialogOpen(true)}><FolderCog size={16} /> Quản lý nhóm</button>
          <button type="button" className="btn btn-primary" onClick={startCreate}><Plus size={16} /> Thêm nội dung</button>
          {modal && onClose && <button type="button" className="btn-icon ctw-close" onClick={onClose} title="Đóng"><X size={19} /></button>}
        </div>
      </header>

      <div className="ctw-list-body">
        <section className="ctw-filter-card">
          <div className="ctw-search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo tên hoặc nội dung..." /></div>
          <select className="stepper-select" value={groupFilter} onChange={event => setGroupFilter(event.target.value)} aria-label="Lọc theo nhóm">
            <option value="all">Tất cả nhóm</option>
            <option value="ungrouped">Chưa phân nhóm</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}{group.isActive ? '' : ' (ngừng hoạt động)'}</option>)}
          </select>
          <select className="stepper-select" value={channelFilter} onChange={event => setChannelFilter(event.target.value as TemplateFilter)} aria-label="Lọc theo loại nội dung">
            <option value="all">Tất cả loại nội dung</option>
            <option value="base">Nội dung cơ bản</option>
            {orderedTypes.map(type => <option key={type.name} value={type.name}>{type.label}</option>)}
          </select>
          <button type="button" className="btn-icon" title="Tải lại" onClick={() => void loadData(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'ctw-spin' : ''} />
          </button>
        </section>

        <div className="ctw-list-summary">
          <strong>{filteredTemplates.length} mẫu nội dung</strong>
          {(search || groupFilter !== 'all' || channelFilter !== 'all') && <span>theo bộ lọc hiện tại</span>}
        </div>

        {loading ? (
          <div className="ctw-empty"><Loader2 size={32} className="ctw-spin" /><strong>Đang tải mẫu nội dung...</strong></div>
        ) : filteredTemplates.length === 0 ? (
          <div className="ctw-empty">
            <FileText size={38} />
            <strong>{templates.length === 0 ? 'Chưa có mẫu nội dung' : 'Không tìm thấy mẫu phù hợp'}</strong>
            <span>{templates.length === 0 ? 'Tạo mẫu đầu tiên để sử dụng lại trong các chiến dịch.' : 'Thử thay đổi từ khóa hoặc bộ lọc.'}</span>
            {templates.length === 0 && <button type="button" className="btn btn-primary" onClick={startCreate}><Plus size={15} /> Thêm nội dung</button>}
          </div>
        ) : (
          <div className="ctw-template-grid">
            {filteredTemplates.map(template => {
              const channels = getEnabledChannels(template)
              const basePreview = getTemplateBasePreview(template)
              const channelPreview = getTemplateChannelPreview(template)
              return (
                <article className="ctw-template-card" key={template.id}>
                  <div className="ctw-template-card-head">
                    <div className="ctw-template-icon"><FileText size={18} /></div>
                    <div className="ctw-template-title">
                      <h3 title={template.name}>{template.name}</h3>
                      <span>{template.groupName || 'Chưa phân nhóm'}</span>
                    </div>
                    <div className="ctw-row-actions">
                      <button type="button" className="btn-icon" title="Sửa mẫu" onClick={() => startEdit(template)} disabled={busy}><Edit3 size={15} /></button>
                      <button type="button" className="btn-icon danger" title="Xoá mẫu" onClick={() => deleteTemplate(template)} disabled={busy}><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <div className="ctw-channel-badges">
                    {basePreview && <span className="ctw-channel-badge base">Nội dung cơ bản</span>}
                    {channels.map(channel => <span className={`ctw-channel-badge ${channel}`} key={channel}>{CHANNEL_LABELS[channel]}</span>)}
                  </div>
                  <p className="ctw-template-excerpt">{basePreview || channelPreview || 'Chưa có nội dung xem trước'}</p>
                  {template.imageUrls.length > 0 && (
                    <div className="ctw-card-image-strip">
                      {template.imageUrls.slice(0, 3).map((url, index) => <img src={url} alt="" key={`${url}-${index}`} />)}
                      {template.imageUrls.length > 3 && <span>+{template.imageUrls.length - 3}</span>}
                    </div>
                  )}
                  <div className="ctw-template-card-foot">
                    <span><MessageSquareText size={13} /> {getTemplateVariantCount(template)} biến thể</span>
                    <span><ImageIcon size={13} /> {template.imageUrls.length} ảnh</span>
                    <span>{template.updatedAt ? `Cập nhật ${new Date(template.updatedAt).toLocaleDateString('vi-VN')}` : ''}</span>
                  </div>
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
      <header className="ctw-editor-header">
        <div className="ctw-editor-heading">
          <button type="button" className="btn-icon" onClick={closeEditor} title="Quay lại"><ArrowLeft size={19} /></button>
          <div><h1>{editor.id ? 'Sửa mẫu nội dung' : 'Thêm nội dung'}</h1><p>{editor.id ? 'Cập nhật nội dung và các biến thể theo từng kênh.' : 'Tạo nội dung dùng lại cho một hoặc nhiều kênh.'}</p></div>
        </div>
        <div className="ctw-header-actions">
          <button type="button" className="btn btn-ghost" onClick={closeEditor} disabled={busy}>Hủy</button>
          <button type="button" className="btn btn-primary" onClick={() => void saveTemplate()} disabled={busy}>
            {busy ? <Loader2 size={16} className="ctw-spin" /> : <Save size={16} />} {busy ? 'Đang lưu...' : 'Lưu nội dung'}
          </button>
          {modal && onClose && <button type="button" className="btn-icon ctw-close" onClick={onClose} title="Đóng"><X size={19} /></button>}
        </div>
      </header>

      <div className="ctw-editor-body">
        <section className="ctw-general-card">
          <div className="ctw-section-heading"><div><strong>Thông tin chung</strong><span>Đặt tên và chọn nhóm cho mẫu nội dung.</span></div></div>
          <div className="ctw-general-grid">
            <div className="ctw-form-field">
              <label>Tên mẫu <span>*</span></label>
              <input className="stepper-input" value={editor.name} onChange={event => setEditor(previous => ({ ...previous, name: event.target.value }))} placeholder="Ví dụ: Chăm sóc khách hàng sau mua" disabled={busy} />
            </div>
            <div className="ctw-form-field">
              <label>Nhóm nội dung {!editor.id && <span>*</span>}</label>
              <div className="ctw-group-select-row">
                <select
                  className="stepper-select"
                  value={editor.groupId ?? ''}
                  onChange={event => setEditor(previous => ({ ...previous, groupId: event.target.value ? Number(event.target.value) : null }))}
                  disabled={busy}
                >
                  <option value="">{editor.id && editor.originalGroupId === null ? 'Chưa phân nhóm (mẫu cũ)' : 'Chọn nhóm nội dung'}</option>
                  {activeGroups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
                  {editor.groupId !== null && !activeGroups.some(group => group.id === editor.groupId) && (
                    <option value={editor.groupId}>{groups.find(group => group.id === editor.groupId)?.name || 'Nhóm ngừng hoạt động'}</option>
                  )}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setGroupDialogOpen(true)}><FolderCog size={15} /> Quản lý nhóm</button>
              </div>
              {activeGroups.length === 0 && <small>Chưa có nhóm hoạt động. Hãy tạo nhóm trước khi lưu mẫu mới.</small>}
            </div>
          </div>
        </section>

        <SharedImagesEditor imageUrls={editor.imageUrls} onChange={imageUrls => setEditor(previous => ({ ...previous, imageUrls }))} disabled={busy} />

        <section className="ctw-content-card">
          <div className="ctw-outer-tabs" role="tablist" aria-label="Loại nội dung">
            <button type="button" className={editorTab === 'base' ? 'active' : ''} onClick={() => { setEditorTab('base'); setEditorPanel('content') }}>
              <FileText size={15} /> Nội dung cơ bản
            </button>
            {orderedTypes.map(type => {
              const channel = editor.channels[type.name]
              return (
                <button type="button" className={editorTab === type.name ? 'active' : ''} onClick={() => { setEditorTab(type.name); setEditorPanel('content') }} key={type.name}>
                  {channel.enabled && <Check size={13} className="ctw-tab-check" />} {type.label}
                </button>
              )
            })}
          </div>

          <div className="ctw-content-heading">
            <div>
              <strong>{editorTab === 'base' ? 'Nội dung cơ bản' : `Nội dung ${CHANNEL_LABELS[editorTab]}`}</strong>
              <span>{editorTab === 'base' ? 'Nội dung chung và bản plain tương thích với các phiên bản app cũ.' : `Thiết lập các biến thể chỉ dùng cho chiến dịch ${CHANNEL_LABELS[editorTab]}.`}</span>
            </div>
            {editorTab !== 'base' && activeEditorChannel && (
              <Toggle checked={activeEditorChannel.enabled} onChange={enabled => updateChannel(editorTab, { ...activeEditorChannel, enabled })} label={activeEditorChannel.enabled ? 'Đang sử dụng' : 'Chưa sử dụng'} disabled={busy} />
            )}
          </div>

          <div className="ctw-inner-tabs" role="tablist">
            <button type="button" className={editorPanel === 'content' ? 'active' : ''} onClick={() => setEditorPanel('content')}><Edit3 size={14} /> Nội dung</button>
            <button type="button" className={editorPanel === 'preview' ? 'active' : ''} onClick={() => setEditorPanel('preview')}><Eye size={14} /> Xem trước</button>
          </div>

          <div className="ctw-tab-panel">
            {editorPanel === 'content' ? (
              editorTab === 'base' ? (
                <div className="ctw-base-editor">
                  <div className="ctw-rich-editor"><FormattedContentEditor value={editor.baseContentHtml} onChange={baseContentHtml => setEditor(previous => ({ ...previous, baseContentHtml }))} /></div>
                  <p>Nội dung cơ bản được lưu thêm một bản văn bản thường để các phiên bản akaAgent cũ vẫn sử dụng an toàn.</p>
                </div>
              ) : activeEditorChannel?.enabled ? (
                <VariantEditor
                  channelName={editorTab}
                  channel={activeEditorChannel}
                  onChange={channel => updateChannel(editorTab, channel)}
                  onToggleRich={enabled => toggleChannelFormat(editorTab, enabled)}
                  disabled={busy}
                />
              ) : (
                <div className="ctw-channel-disabled">
                  <MessageSquareText size={34} />
                  <strong>Chưa sử dụng nội dung {CHANNEL_LABELS[editorTab]}</strong>
                  <span>Bật kênh để thêm các biến thể riêng cho {CHANNEL_LABELS[editorTab]}.</span>
                  <button type="button" className="btn btn-primary" onClick={() => updateChannel(editorTab, { ...activeEditorChannel!, enabled: true })}>Bật {CHANNEL_LABELS[editorTab]}</button>
                </div>
              )
            ) : (
              <ContentTemplatePreview
                channel={editorTab as TemplatePreviewChannel}
                variants={previewVariants}
                formatted={previewFormatted}
                subject={activeEditorChannel?.subject}
                imageUrls={editor.imageUrls}
              />
            )}
          </div>
        </section>
      </div>
    </>
  )

  return (
    <div className={`ctw-workspace${modal ? ' modal-mode' : ''}`}>
      {view === 'list' ? renderList() : renderEditor()}
      {groupDialogOpen && (
        <GroupManagerDialog
          groups={groups}
          onClose={() => setGroupDialogOpen(false)}
          onChanged={async () => { await loadData(true) }}
        />
      )}
    </div>
  )
}
