import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CampaignDataUploadModal from './CampaignDataUploadModal'
import type { CampaignImportPlatform, CampaignInputData } from '../../../../shared/types'
import type { AgentDataFile, AgentDataImport, AgentDataSource } from '../../../../shared/campaignAgentData'

export default function CampaignAgentDataImportModal({ draftId, request, platform, actionId, actionName, accountIds, onClose, onInsert }: {
  draftId: string; request?: AgentDataImport; platform: CampaignImportPlatform; actionId: string; actionName?: string; accountIds: number[];
  onClose: () => void; onInsert: (rows: Partial<CampaignInputData>[], mode: 'append' | 'replace') => void
}) {
  const [index, setIndex] = useState(0), [source, setSource] = useState<AgentDataSource>(), [error, setError] = useState('')
  const [loading, setLoading] = useState(!!request?.files.length), [retry, setRetry] = useState(0)
  const mounted = useRef(true), generation = useRef(0), active = useRef<string | undefined>(undefined), inserted = useRef(false)
  const file = request?.files[index]
  const cancel = () => { generation.current++; if (active.current) void window.electronAPI.cancelCampaignAgentData(active.current) }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel() } }, [])
  const read = async (ref: AgentDataFile) => {
    const own = generation.current, id = crypto.randomUUID(); active.current = id
    try {
      const result = await window.electronAPI.readCampaignAgentData(id, draftId, ref)
      if (!mounted.current || own !== generation.current) throw new Error('Đã dừng đọc dữ liệu.')
      if (!result.ok) throw new Error(result.message || 'Không đọc được dữ liệu.')
      return result.patch
    } finally { if (active.current === id) active.current = undefined }
  }
  useEffect(() => {
    if (!file) return
    cancel(); const own = generation.current
    setLoading(true); setError(''); setSource(undefined)
    void read(file).then(value => { if (mounted.current && own === generation.current) setSource(value) })
      .catch(() => { if (mounted.current && own === generation.current) setError('Không đọc được file trên thiết bị này. Hãy kiểm tra file gốc và thử lại.') })
      .finally(() => { if (mounted.current && own === generation.current) setLoading(false) })
    return cancel
  }, [file?.id, retry])
  const close = () => {
    cancel()
    if (inserted.current && request && index + 1 < request.files.length) { inserted.current = false; setIndex(index + 1); return }
    onClose()
  }
  if (loading || error) return createPortal(<div className="modal-overlay"><div className="modal-content" role="dialog" aria-label="Đọc dữ liệu đính kèm">
    <h3>Upload dữ liệu</h3><p>{file?.name}</p><p>{loading ? file?.kind === 'image' ? 'Đang nhận dạng chữ trên máy…' : 'Đang đọc file…' : error}</p>
    {error && <button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Thử lại</button>}
    <button type="button" className="btn btn-ghost" onClick={() => { inserted.current = false; close() }}>Đóng</button>
  </div></div>, document.body)
  const mode = index === 0 ? request?.mode || 'append' : 'append'
  return <CampaignDataUploadModal key={`${file?.id || 'manual'}:${retry}`} platform={platform} actionId={actionId} actionName={actionName}
    accountIds={accountIds} showDatasetName={false} initialSource={source} onClose={close} onInsert={() => {}}
    contextSlot={<p className="text-muted">{file ? `File ${index + 1}/${request!.files.length}: ${file.name}. ` : ''}
      {mode === 'replace' ? 'Khi bấm chèn, danh sách hiện tại sẽ được thay bằng dữ liệu hợp lệ bên dưới.' : 'Kiểm tra dữ liệu trước khi chèn vào chiến dịch.'}</p>}
    submitLabel={mode === 'replace' ? 'Thay danh sách bằng dữ liệu này' : 'Chèn xuống chi tiết'}
    readImageText={async (url, name) => {
      const own = generation.current, match = /^data:([^;]+);base64,(.+)$/.exec(url)
      if (!match) throw new Error('Ảnh không hợp lệ.')
      const refs = await window.electronAPI.storeCampaignAgentData(draftId, [{ name: /\.(png|jpe?g|webp)$/i.test(name) ? name : `Ảnh.${match[1].split('/')[1]}`, mimeType: match[1], dataBase64: match[2] }])
      if (!mounted.current || own !== generation.current) throw new Error('Đã đóng form.')
      const result = await read(refs[0])
      if (result.kind !== 'text') throw new Error('Không đọc được chữ trong ảnh.')
      return result.text
    }}
    onSubmitRows={({ rows }) => { onInsert(rows, mode); inserted.current = true }} />
}
