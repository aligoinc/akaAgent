import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, FileText, RefreshCw } from 'lucide-react'
import type { AutoAccount, CampaignConfig, CampaignInputData, CampaignMediaInput } from '../../../../shared/types'
import { buildStopMessagesLink, STOP_MESSAGES_PREVIEW_ID, supportsStopMessagesLink } from '../../../../shared/zaloMessageOptOut'
import {
  RECIPIENT_SAMPLE,
  analyzeRecipientPreview,
  recipientPreviewChannel,
  recipientPreviewNotes,
  recipientPreviewScreens
} from '../../../../shared/recipientPreview'
import { isZaloWebAccount } from '../../utils/accountLabels'
import { RecipientVersionBrowser } from './recipientPreview/RecipientVersionBrowser'
import {
  DEFAULT_RECIPIENT_VIEW,
  recipientChannelLabel,
  recipientIsStranger,
  recipientRenderContext,
  recipientShareMode,
  recipientSourceFromCampaign,
  recipientVersionTotal,
  type RecipientPreviewInput,
  type RecipientSender
} from './recipientPreview/recipientPreviewModel'
import './recipientPreview/RecipientPreview.css'
import { isImageMediaSource, isVideoMediaSource } from '../Media/mediaImage'
import ContentTemplatePreview from '../ContentTemplates/ContentTemplatePreview'
import { renderPreviewSampleTokens } from './ContentPreviewModal'
import { getContentTemplateChannelLabel } from './contentTemplateCampaignUtils'
import { normalizeCampaignPreviewText, renderCampaignPreviewTokens, type CampaignContentPreviewItem, type CampaignContentPreviewModel } from './campaignContentPreview'
import './campaignContentPreview.css'

interface Props {
  campaign: CampaignConfig
  account: AutoAccount | null
  /** Thẻ cũ của Facebook/Email. Zalo nhắn tin, SMS, gọi thoại không dùng (gọi thoại không có mẫu nội dung nên là null). */
  preview: CampaignContentPreviewModel | null
}

type LegacyProps = Omit<Props, 'preview'> & { preview: CampaignContentPreviewModel }

const INPUT_SAMPLE_LIMIT = 3
const getMediaPath = (item: CampaignMediaInput) => typeof item === 'string' ? item : item.cloudUrl || item.localPath || ''
const getMediaLabel = (item: CampaignMediaInput) => typeof item === 'string' ? item.split(/[\\/]/).pop() || 'File đính kèm' : item.name

function PreviewCard({ item, index, campaign, account, preview, input, mode }: LegacyProps & {
  item: CampaignContentPreviewItem
  index: number
  input?: CampaignInputData
  mode: string
}) {
  const [media, setMedia] = useState<{ urls: string[]; mimeTypes: Record<string, string>; unavailable: string[]; loading: boolean }>({ urls: [], mimeTypes: {}, unavailable: [], loading: true })
  useEffect(() => {
    let disposed = false
    setMedia({ urls: [], mimeTypes: {}, unavailable: [], loading: true })
    void Promise.all(item.media.map(async source => {
      const path = getMediaPath(source)
      const mime = typeof source === 'string' ? '' : source.mimeType
      const isImage = isImageMediaSource(mime, path)
      const isVideo = isVideoMediaSource(mime, path)
      const extensionlessImage = /^https?:\/\//i.test(path) && !mime && !/\.[a-z0-9]+(?:[?#]|$)/i.test(path.split('/').pop() || '')
      if ((isImage || isVideo || extensionlessImage) && /^(https?:\/\/|data:(image|video)\/)/i.test(path)) return { url: path, mimeType: mime || '' }
      if (!isImage) return { unavailable: getMediaLabel(source) }
      try {
        const result = await window.electronAPI.readCampaignPreviewFileDataUrl(path)
        return { url: result.dataUrl, mimeType: result.mimeType }
      } catch {
        return { unavailable: getMediaLabel(source) }
      }
    })).then(results => {
      if (!disposed) setMedia({
        urls: results.flatMap(result => result.url ? [result.url] : []),
        mimeTypes: Object.fromEntries(results.flatMap(result => result.url ? [[result.url, result.mimeType || '']] : [])),
        unavailable: results.flatMap(result => result.unavailable ? [result.unavailable] : []),
        loading: false
      })
    })
    return () => { disposed = true }
  }, [item.media])

  const renderTokens = useCallback((value: string) => normalizeCampaignPreviewText(
    input ? renderCampaignPreviewTokens(value, input) : renderPreviewSampleTokens(value), campaign
  ), [campaign, input])
  const showOptOut = supportsStopMessagesLink(campaign.actionId)
    && campaign.extraSettings?.zaloOptOutLinkEnabled === true
    && campaign.extraSettings?.zaloMessageSendMode !== 'share'
  const footer = showOptOut && !item.content.includes('#{STOP_MESSAGES_LINK}')
    ? `Từ chối nhận tin: ${buildStopMessagesLink(STOP_MESSAGES_PREVIEW_ID)}`
    : undefined

  return (
    <article className="campaign-content-preview-card">
      <div className="campaign-content-preview-card-heading">
        <span className="campaign-content-preview-number">{index + 1}</span>
        <strong title={item.title}>{item.title}</strong>
        <span className="campaign-content-preview-channel">{getContentTemplateChannelLabel(preview.channel)}</span>
      </div>
      <ContentTemplatePreview
        channel={preview.channel}
        variants={[item.content]}
        formatted={preview.formatted}
        emailHtml={preview.channel === 'email' && preview.formatted}
        emptyContentText=""
        subject={item.subject}
        imageUrls={media.urls}
        mediaMimeTypes={media.mimeTypes}
        showSampleData={mode !== 'original'}
        renderTokens={renderTokens}
        recipientName={input ? input.name || input.phone || input.email || input.uid || 'Người nhận' : undefined}
        recipientPhone={input ? input.phone || 'Người nhận' : undefined}
        senderName={account?.name || 'Tài khoản gửi'}
        footer={footer}
      />
      {media.loading && item.media.length > 0 && <p className="campaign-content-preview-hint" role="status">Đang tải media...</p>}
      {media.unavailable.map((label, mediaIndex) => (
        <p className="campaign-content-preview-hint" key={`${label}-${mediaIndex}`}><FileText size={14} /> {label} — file đính kèm chưa có bản xem trước.</p>
      ))}
    </article>
  )
}

const rowOptionLabel = (row: CampaignInputData) => row.name || row.phone || row.email || row.uid || `Data #${row.id}`

/**
 * Zalo nhắn tin, SMS, gọi thoại: mọi phiên bản khách có thể nhận, cùng bộ vẽ với khung "Khách sẽ nhận" trên form
 * (docs/CAMPAIGN_RECIPIENT_PREVIEW.md). Chỉ đọc cấu hình đã có và tối đa 3 dòng data như bản cũ, một lần khi mở tab.
 */
function RecipientContentPreviewTab({ campaign, account }: Pick<Props, 'campaign' | 'account'>) {
  const [mode, setMode] = useState('auto')
  const [today] = useState(() => new Date())
  const source = useMemo(() => recipientSourceFromCampaign(campaign), [campaign])
  const screens = useMemo(() => recipientPreviewScreens(source), [source])
  const total = recipientVersionTotal(screens)
  const channel = recipientPreviewChannel(campaign.actionId)
  const share = recipientShareMode(source)
  // Gửi chia sẻ không điền biến nên không cần data để "Xem như".
  const wantsRows = total > 0 && !share
  const [rows, setRows] = useState<CampaignInputData[]>([])
  const [inputTotal, setInputTotal] = useState(0)
  const [loading, setLoading] = useState(wantsRows)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!wantsRows) { setLoading(false); return }
    let disposed = false
    setLoading(true)
    setError(false)
    // A bounded, private sample keeps the Data tab's filters/page/selection intact.
    void window.electronAPI.listCampaignInputDataPage({ campaignId: campaign.id, offset: 0, limit: INPUT_SAMPLE_LIMIT })
      .then(result => {
        if (disposed) return
        setRows(result.items.slice(0, INPUT_SAMPLE_LIMIT))
        setInputTotal(result.total)
      })
      .catch(() => { if (!disposed) setError(true) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [campaign.id, revision, wantsRows])

  const resolvedMode = mode === 'auto' ? (rows[0] ? String(rows[0].id) : 'sample') : mode
  const rowIndex = rows.findIndex(row => String(row.id) === resolvedMode)
  const row = rowIndex >= 0 ? rows[rowIndex] : undefined
  const sender = useMemo<RecipientSender>(() => ({
    id: campaign.accountId,
    name: account?.name || 'Tài khoản của chiến dịch',
    phone: account?.zaloPhone || null,
    zaloWeb: account ? isZaloWebAccount(account) : false
  }), [account, campaign.accountId])
  const input = useMemo<RecipientPreviewInput>(() => ({
    source, rows, senders: [sender], sendDateIso: campaign.schedule || null, liveSource: false, savedRows: true
  }), [source, rows, sender, campaign.schedule])
  const ctx = useMemo(() => recipientRenderContext(input, {
    ...DEFAULT_RECIPIENT_VIEW,
    mode: row ? 'row' : resolvedMode === 'original' ? 'raw' : 'sample',
    rowIndex: Math.max(0, rowIndex)
  }, today), [input, row, resolvedMode, rowIndex, today])
  const sampleCtx = useMemo(() => recipientRenderContext(input, DEFAULT_RECIPIENT_VIEW, today), [input, today])
  const warnings = useMemo(() => analyzeRecipientPreview({
    source, screens, rows: [], zaloWebSenders: sender.zaloWeb ? 1 : 0, ctx: sampleCtx
  }), [source, screens, sender.zaloWeb, sampleCtx])
  const notes = useMemo(() => {
    const items = recipientPreviewNotes({ source, screens, liveSource: false })
    if (row && channel === 'zalo') items.push('Tên Zalo và xưng hô chỉ biết khi gửi; các biến đó hiện dạng nhãn.')
    return items
  }, [source, screens, row, channel])

  if (!channel) return null
  const badge = row ? 'Đã điền biến theo data' : resolvedMode === 'original' ? 'Chưa điền biến' : 'Khách mẫu'
  return (
    <div className="campaign-content-preview">
      <div className="campaign-content-preview-toolbar">
        <p>{total.toLocaleString('vi-VN')} phiên bản {recipientChannelLabel(channel, share)} khách có thể nhận · gửi từ {sender.name}</p>
        {total > 0 && <div className="campaign-content-preview-controls">
          {share
            ? <span className="campaign-content-preview-badge">Gửi chia sẻ không điền biến</span>
            : <>
              <label htmlFor={`campaign-preview-recipient-${campaign.id}`}>Xem như</label>
              <select id={`campaign-preview-recipient-${campaign.id}`} value={resolvedMode} onChange={event => setMode(event.target.value)}>
                <option value="sample">Khách mẫu</option>
                <option value="original">Giữ nguyên biến</option>
                {rows.map(item => <option key={item.id} value={item.id}>{rowOptionLabel(item)}</option>)}
              </select>
              <span className={`campaign-content-preview-badge${row ? ' personalized' : ''}`}>{badge}</span>
            </>}
        </div>}
      </div>
      {(loading || error || inputTotal > INPUT_SAMPLE_LIMIT || notes.length > 0) && <div className="campaign-content-preview-notes">
        {loading && <span role="status">Đang tải data để xem trước...</span>}
        {error && <span role="alert">Không tải được data để điền biến. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} /> Thử lại</button></span>}
        {inputTotal > INPUT_SAMPLE_LIMIT && <span>Danh sách “Xem như” dùng {INPUT_SAMPLE_LIMIT} data đầu tiên của chiến dịch.</span>}
        {/* Ghi chú dài thu vào một dòng để thẻ phiên bản đầu tiên hiện ngay. */}
        {notes.length > 0 && <details className="campaign-content-preview-run-notes">
          <summary>Khi chạy thật · {notes.length} ghi chú</summary>
          {notes.map(note => <span key={note}>{note}</span>)}
        </details>}
      </div>}
      {total > 0 ? <div className="campaign-content-preview-body">
        <RecipientVersionBrowser
          key={`${campaign.id}:${campaign.updatedAt || ''}`}
          inline
          screens={screens}
          ctx={ctx}
          warnings={warnings}
          initialScreen="message"
          senderName={sender.name}
          senderPhone={channel === 'sms' || channel === 'voice' ? sender.phone : null}
          groupName={row?.name || RECIPIENT_SAMPLE.groupName}
          stranger={recipientIsStranger(source) && !share}
        />
      </div> : <div className="campaign-content-preview-empty"><Eye size={28} /><strong>Chưa có nội dung để xem trước</strong><span>Chiến dịch chưa lưu nội dung hoặc media, hoặc đang tắt cả Nhắn tin lẫn Kết bạn.</span></div>}
    </div>
  )
}

export default function CampaignContentPreviewTab({ campaign, account, preview }: Props) {
  if (recipientPreviewChannel(campaign.actionId)) return <RecipientContentPreviewTab campaign={campaign} account={account} />
  return preview ? <LegacyCampaignContentPreviewTab campaign={campaign} account={account} preview={preview} /> : null
}

/** Facebook và Email: thẻ xem trước theo mẫu nội dung như trước. */
function LegacyCampaignContentPreviewTab({ campaign, account, preview }: LegacyProps) {
  const [inputs, setInputs] = useState<CampaignInputData[]>([])
  const [inputTotal, setInputTotal] = useState(0)
  const [mode, setMode] = useState('auto')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (preview.items.length === 0) { setLoading(false); return }
    let disposed = false
    setLoading(true)
    setError(false)
    // A bounded, private sample keeps the Data tab's filters/page/selection intact.
    void window.electronAPI.listCampaignInputDataPage({ campaignId: campaign.id, offset: 0, limit: INPUT_SAMPLE_LIMIT })
      .then(result => {
        if (disposed) return
        setInputs(result.items.slice(0, INPUT_SAMPLE_LIMIT))
        setInputTotal(result.total)
        setMode(current => current === 'auto' ? (result.items[0] ? String(result.items[0].id) : 'sample') : current)
      })
      .catch(() => { if (!disposed) setError(true) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [campaign.id, revision, preview.items.length])

  const input = useMemo(() => inputs.find(row => String(row.id) === mode), [inputs, mode])
  const notes = [...preview.notes]
  if (input && preview.items.some(item => /#\{(?:FULL_NAME|ORIGINAL_NAME|SEX)/.test(`${item.content} ${item.subject}`))) {
    notes.push('Tên và xưng hô từ hồ sơ Facebook/Zalo chỉ được xác định khi chạy. Biến chưa có dữ liệu được giữ nguyên trong preview.')
  }
  if (campaign.extraSettings?.zaloOptOutLinkEnabled) notes.push('Link từ chối nhận tin trong preview là link minh họa.')

  return (
    <div className="campaign-content-preview">
      <div className="campaign-content-preview-toolbar">
        <p>{preview.items.length} nội dung {getContentTemplateChannelLabel(preview.channel).toLocaleLowerCase('vi-VN')} của chiến dịch · tối đa 3 biến thể</p>
        {preview.items.length > 0 && <div className="campaign-content-preview-controls">
          <label htmlFor={`campaign-preview-recipient-${campaign.id}`}>Xem như</label>
          <select id={`campaign-preview-recipient-${campaign.id}`} value={mode === 'auto' ? 'sample' : mode} onChange={event => setMode(event.target.value)}>
            <option value="sample">Dữ liệu mẫu</option>
            <option value="original">Nội dung gốc</option>
            {inputs.map(row => <option key={row.id} value={row.id}>{row.name || row.phone || row.email || row.uid || `Data #${row.id}`}</option>)}
          </select>
          <span className={`campaign-content-preview-badge${input ? ' personalized' : ''}`}>
            {input ? 'Đã điền biến theo data' : mode === 'original' ? 'Chưa điền biến' : 'Dữ liệu minh họa'}
          </span>
        </div>}
      </div>
      {(loading || error || inputTotal > INPUT_SAMPLE_LIMIT || notes.length > 0) && <div className="campaign-content-preview-notes">
        {loading && <span role="status">Đang tải data để xem trước...</span>}
        {error && <span role="alert">Không tải được data để điền biến. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} /> Thử lại</button></span>}
        {inputTotal > INPUT_SAMPLE_LIMIT && <span>Danh sách “Xem như” dùng {INPUT_SAMPLE_LIMIT} data đầu tiên của chiến dịch.</span>}
        {notes.map(note => <span key={note}>{note}</span>)}
      </div>}
      {preview.items.length > 0 ? <div className="campaign-content-preview-grid">
        {preview.items.map((item, index) => <PreviewCard key={item.id} item={item} index={index} campaign={campaign} account={account} preview={preview} input={input} mode={mode} />)}
      </div> : <div className="campaign-content-preview-empty"><Eye size={28} /><strong>Chưa có nội dung để xem trước</strong><span>Chiến dịch chưa lưu nội dung hoặc sẽ lấy nội dung từ nguồn khi chạy.</span></div>}
    </div>
  )
}
