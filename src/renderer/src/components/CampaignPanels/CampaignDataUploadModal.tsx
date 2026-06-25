import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, Image as ImageIcon, RefreshCw, Upload, X } from 'lucide-react'
import jsQR from 'jsqr'
import { read, utils } from 'xlsx'
import {
  CampaignImportDataRow,
  CampaignImportPlatform,
  CampaignInputData,
  isValidEmailInputDataValue
} from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'

type ImportTab = 'textbox' | 'image' | 'sheet' | 'excel'
type ImportField = keyof Pick<CampaignImportDataRow, 'name' | 'phone' | 'uid' | 'email' | 'info1' | 'info2' | 'info3' | 'info4' | 'info5'>
type ColumnMap = Partial<Record<ImportField, string>>

interface ColumnOption {
  value: string
  label: string
}

interface FieldDef {
  key: ImportField
  label: string
  required?: boolean
}

interface CampaignDataUploadModalProps {
  platform: CampaignImportPlatform
  actionId: string
  onClose: () => void
  onInsert: (rows: Partial<CampaignInputData>[]) => void
}

const INFO_FIELDS: FieldDef[] = [
  { key: 'info1', label: 'Info 1' },
  { key: 'info2', label: 'Info 2' },
  { key: 'info3', label: 'Info 3' },
  { key: 'info4', label: 'Info 4' },
  { key: 'info5', label: 'Info 5' }
]
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const isZaloJoinGroupLinkAction = (actionId?: string | null): boolean => actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID

const getCellText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value).toString() : ''
  }
  const text = String(value).trim()
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? Math.trunc(parsed).toString() : text
  }
  return text
}

const normalizeVietnamMobilePhone = (value: unknown): string => {
  let digits = getCellText(value).replace(/\D+/g, '')
  if (!digits) return ''

  if (digits.startsWith('0084') && digits.length >= 13) {
    digits = `0${digits.slice(4)}`
  } else if (digits.startsWith('84') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`
  }
  if (digits.length === 9 && /^[35789]/.test(digits)) {
    digits = `0${digits}`
  }
  if (digits.length === 11) {
    const withoutLeading = digits.replace(/^0+/, '')
    if (withoutLeading.length === 9 && /^[35789]/.test(withoutLeading)) {
      digits = `0${withoutLeading}`
    }
  }
  return /^0[35789]\d{8}$/.test(digits) ? digits : ''
}

const normalizeUid = (value: unknown): string => {
  const text = getCellText(value).replace(/\s+/g, '')
  const lower = text.toLowerCase()
  if (!text || ['uid', 'url', 'link', 'profile', 'facebook', 'facebookuid'].includes(lower)) return ''
  return text
}

const normalizeZaloGroupInviteLink = (value: unknown): string => {
  const raw = getCellText(value)
  if (!raw) return ''
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withProtocol)
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    let groupCode = ''
    if (hostname === 'zalo.me' || hostname.endsWith('.zalo.me')) {
      if (parts[0]?.toLowerCase() !== 'g') return ''
      groupCode = parts[1] || ''
    } else if (hostname === 'zaloapp.com' || hostname.endsWith('.zaloapp.com')) {
      if (parts[0]?.toLowerCase() !== 'qr' || parts[1]?.toLowerCase() !== 'g') return ''
      groupCode = parts[2] || ''
    } else {
      return ''
    }
    return groupCode ? `https://zalo.me/g/${groupCode}` : ''
  } catch {
    return ''
  }
}

const loadImageFromDataUrl = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Không thể mở ảnh QR.'))
  image.src = dataUrl
})

const decodeQrDataFromImage = (image: HTMLImageElement): string => {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) return ''

  const minSide = Math.min(width, height)
  const attempts = [
    { sx: 0, sy: 0, sw: width, sh: height },
    ...[0.78, 0.68, 0.58, 0.48].map(ratio => {
      const side = Math.round(minSide * ratio)
      return {
        sx: Math.max(0, Math.round((width - side) / 2)),
        sy: Math.max(0, Math.round((height - side) / 2)),
        sw: side,
        sh: side
      }
    })
  ]

  for (const attempt of attempts) {
    const canvas = document.createElement('canvas')
    canvas.width = attempt.sw
    canvas.height = attempt.sh
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(
      image,
      attempt.sx,
      attempt.sy,
      attempt.sw,
      attempt.sh,
      0,
      0,
      attempt.sw,
      attempt.sh
    )
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const qr = jsQR(imageData.data, imageData.width, imageData.height)
    if (qr?.data) return qr.data
  }

  return ''
}

const decodeQrDataFromDataUrl = async (dataUrl: string): Promise<string> => {
  const image = await loadImageFromDataUrl(dataUrl)
  return decodeQrDataFromImage(image)
}

const numberToColumnLetter = (value: number): string => String.fromCharCode(64 + value)

const columnLetterToIndex = (value: string): number | null => {
  const text = value.trim().toUpperCase()
  if (!/^[A-Z]$/.test(text)) return null
  return text.charCodeAt(0) - 65
}

const splitTextItems = (value: string): string[] =>
  value.replace(/\r\n/g, '\n').split(/[,\n]+/).map(item => item.trim()).filter(Boolean)

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    const text = getCellText(value)
    if (text) return text
  }
  return ''
}

const getFieldsForPlatform = (platform: CampaignImportPlatform, actionId: string): FieldDef[] => {
  if (isZaloJoinGroupLinkAction(actionId)) {
    return [
      { key: 'name', label: 'Tên group' },
      { key: 'uid', label: 'Link group Zalo', required: true },
      ...INFO_FIELDS
    ]
  }
  if (platform === 'zalo') {
    return [
      { key: 'name', label: 'Tên' },
      { key: 'phone', label: 'Số điện thoại', required: true },
      ...INFO_FIELDS
    ]
  }
  if (platform === 'facebook') {
    return [
      { key: 'name', label: 'Tên' },
      { key: 'uid', label: 'Uid', required: true },
      ...INFO_FIELDS
    ]
  }
  return [
    { key: 'name', label: 'Tên' },
    { key: 'email', label: 'Email', required: true },
    ...INFO_FIELDS
  ]
}

const createEmptyColumnMap = (): ColumnMap => ({})

const isLikelyHeaderValue = (value: string): boolean => {
  const lower = value.trim().toLowerCase()
  return [
    'ten',
    'tên',
    'ho ten',
    'họ tên',
    'fullname',
    'full name',
    'name',
    'uid',
    'url',
    'link',
    'phone',
    'mobile',
    'sdt',
    'sđt',
    'so dien thoai',
    'số điện thoại',
    'email',
    'e-mail',
    'info',
    'info1',
    'info 1',
    'info2',
    'info 2',
    'info3',
    'info 3',
    'info4',
    'info 4',
    'info5',
    'info 5'
  ].includes(lower)
}

const rowValueByColumn = (row: unknown[], column?: string): unknown => {
  if (!column) return ''
  const index = columnLetterToIndex(column)
  if (index === null) return ''
  return row[index] ?? ''
}

const normalizeRows = (rows: CampaignImportDataRow[], platform: CampaignImportPlatform, actionId: string): CampaignImportDataRow[] => {
  const seen = new Set<string>()
  const output: CampaignImportDataRow[] = []

  for (const row of rows) {
    if (isZaloJoinGroupLinkAction(actionId)) {
      const link = normalizeZaloGroupInviteLink(row.uid)
      if (!link || seen.has(link)) continue
      const rawName = getCellText(row.name)
      seen.add(link)
      output.push({
        ...row,
        name: normalizeZaloGroupInviteLink(rawName) === link ? '' : rawName,
        phone: '',
        uid: link,
        email: ''
      })
      continue
    }

    const item: CampaignImportDataRow = {
      name: getCellText(row.name),
      info1: getCellText(row.info1),
      info2: getCellText(row.info2),
      info3: getCellText(row.info3),
      info4: getCellText(row.info4),
      info5: getCellText(row.info5)
    }
    let key = ''
    if (platform === 'zalo') {
      item.phone = normalizeVietnamMobilePhone(row.phone)
      key = item.phone
    } else if (platform === 'facebook') {
      item.uid = normalizeUid(row.uid)
      key = item.uid
    } else {
      item.email = getCellText(row.email).toLowerCase()
      key = isValidEmailInputDataValue(item.email) ? item.email : ''
    }
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

const detectColumnFromHeader = (rows: unknown[][], labels: string[]): string => {
  const header = rows[0] || []
  const normalizedLabels = labels.map(label => label.toLowerCase())
  const index = header.findIndex(cell => {
    const text = getCellText(cell).toLowerCase()
    return normalizedLabels.some(label => text.includes(label))
  })
  return index >= 0 && index < 26 ? numberToColumnLetter(index + 1) : ''
}

const detectPhoneColumn = (rows: unknown[][]): string => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rows.slice(1, 11)
  let bestIndex = -1
  let bestCount = 0

  for (let colIndex = 0; colIndex < Math.min(maxCols, 26); colIndex += 1) {
    const validCount = dataRows.reduce((count, row) => (
      normalizeVietnamMobilePhone(row[colIndex]) ? count + 1 : count
    ), 0)
    if (validCount > bestCount) {
      bestCount = validCount
      bestIndex = colIndex
    }
  }

  return bestIndex >= 0 ? numberToColumnLetter(bestIndex + 1) : ''
}

const detectEmailColumn = (rows: unknown[][]): string => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rows.slice(1, 11)
  let bestIndex = -1
  let bestCount = 0

  for (let colIndex = 0; colIndex < Math.min(maxCols, 26); colIndex += 1) {
    const validCount = dataRows.reduce((count, row) => (
      isValidEmailInputDataValue(getCellText(row[colIndex]).toLowerCase()) ? count + 1 : count
    ), 0)
    if (validCount > bestCount) {
      bestCount = validCount
      bestIndex = colIndex
    }
  }

  return bestIndex >= 0 ? numberToColumnLetter(bestIndex + 1) : ''
}

const detectNonWhitespaceColumn = (rows: unknown[][]): string => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rows.slice(1, 11)
  let bestIndex = -1
  let bestCount = 0

  for (let colIndex = 0; colIndex < Math.min(maxCols, 26); colIndex += 1) {
    const count = dataRows.reduce((total, row) => {
      const text = getCellText(row[colIndex])
      return text && !/\s/.test(text) ? total + 1 : total
    }, 0)
    if (count > bestCount) {
      bestCount = count
      bestIndex = colIndex
    }
  }

  return bestIndex >= 0 ? numberToColumnLetter(bestIndex + 1) : ''
}

const detectRequiredColumnMap = (rows: unknown[][], platform: CampaignImportPlatform, actionId: string): ColumnMap => {
  if (isZaloJoinGroupLinkAction(actionId)) {
    return {
      uid: detectColumnFromHeader(rows, ['link', 'url', 'group', 'zalo']) || detectNonWhitespaceColumn(rows)
    }
  }
  if (platform === 'zalo') {
    return { phone: detectPhoneColumn(rows) }
  }
  if (platform === 'facebook') {
    return {
      uid: detectColumnFromHeader(rows, ['uid', 'url', 'link', 'profile', 'facebook']) || detectNonWhitespaceColumn(rows)
    }
  }
  return { email: detectEmailColumn(rows) }
}

export default function CampaignDataUploadModal({
  platform,
  actionId,
  onClose,
  onInsert
}: CampaignDataUploadModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const fields = useMemo(() => getFieldsForPlatform(platform, actionId), [platform, actionId])
  const [activeTab, setActiveTab] = useState<ImportTab>('textbox')
  const [textContent, setTextContent] = useState('')
  const [txtFileName, setTxtFileName] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [sheetLink, setSheetLink] = useState('')
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelFileName, setExcelFileName] = useState('')
  const [excelRows, setExcelRows] = useState<unknown[][]>([])
  const [columnMap, setColumnMap] = useState<ColumnMap>(() => createEmptyColumnMap())
  const [skipExcelHeader, setSkipExcelHeader] = useState(true)
  const [previewRows, setPreviewRows] = useState<CampaignImportDataRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setActiveTab('textbox')
    setTextContent('')
    setTxtFileName('')
    setImageDataUrl('')
    setSheetLink('')
    setExcelFile(null)
    setExcelFileName('')
    setExcelRows([])
    setColumnMap(createEmptyColumnMap())
    setSkipExcelHeader(true)
    setPreviewRows([])
  }, [platform, actionId])

  const excelHeaders = useMemo(() => {
    const maxCols = excelRows.reduce((max, row) => Math.max(max, row.length), 0)
    return Array.from({ length: Math.min(maxCols, 26) }, (_, index) => numberToColumnLetter(index + 1))
  }, [excelRows])

  const excelColumnOptions = useMemo<ColumnOption[]>(() => {
    const headerRow = excelRows[0] || []
    return [
      { value: '', label: '— Bỏ qua —' },
      ...excelHeaders.map((letter, index) => ({
        value: letter,
        label: skipExcelHeader ? getCellText(headerRow[index]) || letter : letter
      }))
    ]
  }, [excelHeaders, excelRows, skipExcelHeader])

  const readTextFile = (file?: File | null): void => {
    if (!file) return
    setTxtFileName(file.name)
    const reader = new FileReader()
    reader.onload = event => setTextContent(String(event.target?.result || ''))
    reader.onerror = () => showAlert('Không thể đọc file TXT.', 'error')
    reader.readAsText(file)
  }

  const readImageFile = (file?: File | null): void => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = event => setImageDataUrl(String(event.target?.result || ''))
    reader.onerror = () => showAlert('Không thể đọc ảnh.', 'error')
    reader.readAsDataURL(file)
  }

  const handleImagePaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        readImageFile(item.getAsFile())
        event.preventDefault()
        return
      }
    }
  }

  const readExcelFile = async (file?: File | null): Promise<void> => {
    if (!file) return
    setExcelFile(file)
    setExcelFileName(file.name)
    setLoading(true)
    try {
      const workbook = read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
      setExcelRows(rows)
      setColumnMap(detectRequiredColumnMap(rows, platform, actionId))
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể đọc file Excel.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const buildRowsFromText = (): CampaignImportDataRow[] => {
    return splitTextItems(textContent).map(value => {
      if (isZaloJoinGroupLinkAction(actionId)) return { uid: value }
      if (platform === 'zalo') return { phone: value }
      if (platform === 'facebook') return { uid: value }
      return { email: value }
    })
  }

  const buildRowsFromExcel = (): CampaignImportDataRow[] => {
    const rows = skipExcelHeader ? excelRows.slice(1) : excelRows
    return rows
      .map(row => {
        const item: CampaignImportDataRow = {}
        for (const field of fields) {
          item[field.key] = getCellText(rowValueByColumn(row, columnMap[field.key]))
        }
        return item
      })
      .filter(row => {
        const values = Object.values(row).map(value => getCellText(value)).filter(Boolean)
        return values.length > 0 && !values.every(isLikelyHeaderValue)
      })
  }

  const handleFormatData = async (): Promise<void> => {
    setLoading(true)
    try {
      let rows: CampaignImportDataRow[] = []
      if (activeTab === 'textbox') {
        rows = buildRowsFromText()
      } else if (activeTab === 'excel') {
        if (!excelFile) {
          showAlert('Vui lòng tải file Excel.', 'error')
          return
        }
        const invalidColumn = fields.find(field => columnMap[field.key] && columnLetterToIndex(columnMap[field.key] || '') === null)
        if (invalidColumn) {
          showAlert(`Cột ${invalidColumn.label} không hợp lệ. Vui lòng chọn lại cột.`, 'error')
          return
        }
        rows = buildRowsFromExcel()
      } else if (activeTab === 'sheet') {
        if (!sheetLink.trim()) {
          showAlert('Vui lòng nhập link sheet.', 'error')
          return
        }
        rows = await window.electronAPI.loadCampaignDataFromSheet({
          linkSheet: sheetLink,
          platform,
          actionId
        })
      } else {
        if (!imageDataUrl) {
          showAlert('Vui lòng tải hoặc dán ảnh.', 'error')
          return
        }
        if (isZaloJoinGroupLinkAction(actionId)) {
          const qrData = await decodeQrDataFromDataUrl(imageDataUrl).catch(() => '')
          const qrLink = normalizeZaloGroupInviteLink(qrData)
          rows = qrLink
            ? [{ uid: qrLink }]
            : await window.electronAPI.extractCampaignDataFromImage({
              imageDataUrl,
              platform,
              actionId
            })
        } else {
          rows = await window.electronAPI.extractCampaignDataFromImage({
            imageDataUrl,
            platform,
            actionId
          })
        }
      }

      const normalized = normalizeRows(rows, platform, actionId)
      if (normalized.length === 0) {
        showAlert('Không có data hợp lệ.', 'error')
        return
      }
      setPreviewRows(normalized)
      showAlert(`Đã format ${normalized.length} data hợp lệ.`, 'success')
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể format dữ liệu.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleInsert = (): void => {
    if (previewRows.length === 0) {
      showAlert('Vui lòng format dữ liệu trước khi chèn.', 'error')
      return
    }
    onInsert(previewRows.map(row => ({
      ...row,
      note: '',
      status: 'chờ xử lý'
    })))
    onClose()
  }

  const updateColumn = (field: ImportField, value: string): void => {
    setColumnMap(prev => ({ ...prev, [field]: value.toUpperCase().trim() }))
  }

  const renderTabButton = (tab: ImportTab, label: string) => (
    <button
      type="button"
      className={`campaign-import-tab${activeTab === tab ? ' active' : ''}`}
      onClick={() => setActiveTab(tab)}
    >
      {label}
    </button>
  )

  return (
    <div className="modal-overlay" style={{ zIndex: 3600 }}>
      <div className="modal campaign-import-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Upload dữ liệu</div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body campaign-import-body">
          <div className="campaign-import-tabs">
            {renderTabButton('textbox', 'Form txt')}
            {renderTabButton('image', 'Ảnh')}
            {renderTabButton('sheet', 'Link sheet')}
            {renderTabButton('excel', 'File Excel của khách hàng')}
          </div>

          {activeTab === 'textbox' && (
            <div className="campaign-import-tab-panel">
              <label className="campaign-import-label" htmlFor="campaign-import-textbox">
                Form: Copy vào hoặc tải từ file txt
              </label>
              <textarea
                id="campaign-import-textbox"
                className="campaign-import-textarea"
                value={textContent}
                onChange={event => setTextContent(event.target.value)}
              />
              <div className="campaign-import-hint">Mỗi dữ liệu cách nhau bởi ký tự xuống dòng hoặc dấu phẩy</div>
              <div className="campaign-import-hint">Hệ thống sẽ loại bỏ ký tự đặc biệt sau đó verify dữ liệu đúng chuẩn input</div>
              <label className="btn btn-secondary campaign-import-file-button">
                <Upload size={14} /> Tải file txt
                <input type="file" accept=".txt" hidden onChange={event => readTextFile(event.target.files?.[0])} />
              </label>
              {txtFileName && <div className="text-muted campaign-import-file-name">{txtFileName}</div>}
            </div>
          )}

          {activeTab === 'image' && (
            <div className="campaign-import-tab-panel">
              <label className="campaign-import-label">Ảnh: Tải lên hoặc dán vào</label>
              <div className="campaign-import-image-drop" onPaste={handleImagePaste} tabIndex={0}>
                {imageDataUrl ? (
                  <img src={imageDataUrl} alt="Preview" />
                ) : (
                  <div className="campaign-import-empty-media">
                    <ImageIcon size={24} />
                    <span>Dán ảnh ở đây (Ctrl+V)</span>
                  </div>
                )}
              </div>
              <label className="btn btn-secondary campaign-import-file-button">
                <Upload size={14} /> Tải ảnh
                <input type="file" accept="image/*" hidden onChange={event => readImageFile(event.target.files?.[0])} />
              </label>
            </div>
          )}

          {activeTab === 'sheet' && (
            <div className="campaign-import-tab-panel">
              <label className="campaign-import-label" htmlFor="campaign-import-sheet-link">
                Link sheet (đúng format akaBiz)
              </label>
              <input
                id="campaign-import-sheet-link"
                className="stepper-input"
                type="text"
                placeholder="Nhập link sheet"
                value={sheetLink}
                onChange={event => setSheetLink(event.target.value)}
              />
            </div>
          )}

          {activeTab === 'excel' && (
            <div className="campaign-import-tab-panel">
              <label className="campaign-import-skip-header">
                <input
                  type="checkbox"
                  checked={skipExcelHeader}
                  onChange={event => setSkipExcelHeader(event.target.checked)}
                />
                <span>Bỏ qua dòng đầu (dòng tiêu đề)</span>
              </label>
              <div className="campaign-import-column-grid">
                {fields.map(field => (
                  <label key={field.key} className="campaign-import-column-field">
                    <span>{field.label}</span>
                    <select
                      className="stepper-input"
                      value={columnMap[field.key] || ''}
                      onChange={event => updateColumn(field.key, event.target.value)}
                    >
                      {excelColumnOptions.map(option => (
                        <option key={`${field.key}-${option.value || 'skip'}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className="btn btn-secondary campaign-import-file-button">
                <FileSpreadsheet size={14} /> Tải file Excel
                <input type="file" accept=".xlsx,.xls" hidden onChange={event => void readExcelFile(event.target.files?.[0])} />
              </label>
              {excelFileName && <div className="text-muted campaign-import-file-name">{excelFileName}</div>}
              {excelRows.length > 0 && (
                <div className="campaign-import-excel-preview">
                  <div className="campaign-import-label">Preview dữ liệu Excel (5 dòng đầu)</div>
                  <div className="campaign-import-preview-scroll">
                    <table className="campaign-grid">
                      <thead>
                        <tr>{excelHeaders.map(header => <th key={header}>{header}</th>)}</tr>
                      </thead>
                      <tbody>
                        {excelRows.slice(0, 5).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {excelHeaders.map((_, colIndex) => (
                              <td key={colIndex} title={getCellText(row[colIndex])}>{getCellText(row[colIndex])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="campaign-import-format-row">
            <button className="btn btn-secondary" onClick={() => void handleFormatData()} disabled={loading}>
              {loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
              Format chuẩn dữ liệu
            </button>
          </div>

          <div className="campaign-import-preview-table">
            <table className="campaign-grid">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>STT</th>
                  {fields.map(field => <th key={field.key}>{field.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={fields.length + 1} className="text-center text-muted">Chưa có dữ liệu</td>
                  </tr>
                ) : (
                  previewRows.map((row, index) => (
                    <tr key={`${index}-${row.phone || row.uid || row.email || row.name || 'row'}`}>
                      <td className="text-center">{index + 1}</td>
                      {fields.map(field => <td key={field.key}>{getCellText(row[field.key])}</td>)}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleInsert} disabled={loading || previewRows.length === 0}>
            Chèn xuống chi tiết
          </button>
        </div>
      </div>
    </div>
  )
}
