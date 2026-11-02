import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import type { AutoAccount } from '../../../../shared/types'
import { isAiRandomConfig, randomRuleUnit, validateFacebookRandomConfig, type FacebookRandomConfig } from '../../../../shared/facebookRandomRun'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import './facebookRandomRun.css'

function prepareConfigDraft(value: unknown): { config: FacebookRandomConfig; notice: string } {
  if (value === null) return { config: { version: 1, revision: 0, rules: [] }, notice: '' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Không đọc được phiên bản cấu hình đã lưu. Vui lòng tải lại; chưa thể lưu thay đổi.')
  }
  const stored = value as Record<string, unknown>
  // Never invent a revision for damaged data: the save RPC still needs the real CAS value.
  if (typeof stored.revision !== 'number' || !Number.isSafeInteger(stored.revision) || stored.revision < 0) {
    throw new Error('Không đọc được phiên bản cấu hình đã lưu. Vui lòng tải lại; chưa thể lưu thay đổi.')
  }
  if (stored.version != null && stored.version !== 1 && stored.version !== 2) {
    throw new Error('Ứng dụng chưa hỗ trợ định dạng cấu hình này. Vui lòng cập nhật ứng dụng hoặc tải lại.')
  }
  let repaired = ![1, 2].includes(Number(stored.version)) || !Array.isArray(stored.rules)
  const rules = (Array.isArray(stored.rules) ? stored.rules : []).map(value => {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const campaignActionId = typeof row.campaignActionId === 'string' ? row.campaignActionId : ''
    const unit = randomRuleUnit(campaignActionId)
    const quantity = unit === 'run' ? 1 : typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : NaN
    if (row.campaignActionId !== campaignActionId || row.unit !== unit || row.quantity !== quantity) repaired = true
    // Keep every position (including broken rows) so repairing does not silently remove rules.
    return { campaignActionId, unit, quantity }
  })
  const config: FacebookRandomConfig = { version: stored.version === 2 ? 2 : 1, revision: stored.revision, rules,
    ...(stored.version === 2 ? { mode: stored.mode as 'manual' | 'ai' } : {}) }
  try { validateFacebookRandomConfig(config, rules.map(rule => rule.campaignActionId)) } catch { repaired = true }
  return { config, notice: !Array.isArray(stored.rules)
    ? 'Không đọc được danh sách loại chiến dịch đã lưu. Hãy nhập lại danh sách trước khi lưu.'
    : repaired ? 'Cấu hình đã lưu có dữ liệu không hợp lệ. Hãy kiểm tra các dòng trước khi lưu; thay đổi chưa được áp dụng.' : '' }
}

export default function FacebookRandomRunConfigModal({ account, enableAfterSave, onClose }: {
  account: AutoAccount; enableAfterSave: boolean; onClose: () => void
}) {
  const actions = useCampaignStore(state => state.campaignActions).filter(a => a.flatformType === 'facebook' && a.isActive && !a.isDelete)
  const user = useAuthStore(state => state.user)
  const [config, setConfig] = useState<FacebookRandomConfig | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const view = useRef(0)
  const saving = useRef(false)
  const load = async () => {
    const generation = ++view.current
    setBusy(true); setError(''); setConfig(null); setNotice('')
    try {
      const settings = await window.electronAPI.facebookRandomRun.get(account.id)
      if (view.current !== generation) return
      const draft = prepareConfigDraft(settings?.config)
      setConfig(draft.config); setNotice(draft.notice)
    } catch (e) { if (view.current === generation) setError(String(e instanceof Error ? e.message : e)) }
    finally { if (view.current === generation) setBusy(false) }
  }
  useEffect(() => { void load(); return () => { view.current++ } }, [account.id, user?.staffId, user?.organizationId])
  const update = (next: FacebookRandomConfig) => { setConfig(next); setError('') }
  const save = async () => {
    if (!config || busy || saving.current) return
    saving.current = true
    const generation = view.current
    setBusy(true); setError('')
    try {
      if (!isAiRandomConfig(config) && !config.rules.length) throw new Error('Hãy thêm ít nhất một loại chiến dịch.')
      const next = validateFacebookRandomConfig(config, actions.map(a => a.id))
      const saved = await window.electronAPI.facebookRandomRun.save(account.id, next)
      if (view.current !== generation) return
      const savedConfig = validateFacebookRandomConfig(saved?.config, actions.map(a => a.id))
      // Retain the new revision if enabling fails, so retry doesn't overwrite another writer.
      if (view.current === generation) update(savedConfig)
      if (enableAfterSave) await window.electronAPI.facebookRandomRun.toggle(account.id, true, savedConfig.revision)
      if (view.current === generation) {
        await useCampaignStore.getState().loadAccounts()
        if (view.current === generation) onClose()
      }
    } catch (e) { if (view.current === generation) setError(e instanceof Error ? e.message : String(e)) }
    finally { saving.current = false; if (view.current === generation) setBusy(false) }
  }
  return <div className="modal-overlay"><section className="modal random-config-modal" role="dialog" aria-modal="true" aria-labelledby="random-config-title">
    <header className="modal-header"><h3 id="random-config-title">Cài đặt chạy ngẫu nhiên · {account.name}</h3>
      <button className="btn-icon" aria-label="Đóng" onClick={onClose}><X size={18}/></button></header>
    <div className="modal-body">
      <label className="random-ai-checkbox"><input type="checkbox" checked={isAiRandomConfig(config)} disabled={!config || busy}
        onChange={e => { if (config) update({ ...config, version: 2, mode: e.target.checked ? 'ai' : 'manual' }) }}/>
        Chạy ngẫu nhiên nâng cao (dùng AI)</label>
      <p>{isAiRandomConfig(config)
        ? 'AI lập chuỗi hành động và chỉ tiêu mỗi ngày. Hệ thống phân lượt cho các chiến dịch đủ điều kiện; tạo mới hoặc tạm dừng/tiếp tục không gọi lại AI.'
        : 'Chọn loại và chỉ tiêu mỗi đợt. Khi chạy, hệ thống mới chọn chiến dịch phù hợp và thực hiện theo thứ tự bên dưới.'}</p>
      {notice && <p className="random-error" role="status">{notice}</p>}
      {!isAiRandomConfig(config) && <div className="random-toolbar">
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void load()}>Tải lại</button>
      </div>}
      {!isAiRandomConfig(config) && <div className="random-table-scroll"><table className="random-table"><thead><tr><th>Thứ tự</th><th>Loại chiến dịch</th><th>Chỉ tiêu mỗi đợt</th><th>Sắp xếp</th></tr></thead><tbody>
          {config?.rules.map((rule, index) => <tr key={index}><td>{index + 1}</td><td><select aria-label={`Loại chiến dịch dòng ${index + 1}`} disabled={busy} value={rule.campaignActionId} onChange={e => {
            const actionId = e.target.value, unit = randomRuleUnit(actionId)
            update({ ...config, rules: config.rules.map((r, i) => i === index ? { campaignActionId: actionId, quantity: unit === 'run' ? 1 : r.quantity, unit } : r) })
          }}>
            {!actions.some(a => a.id === rule.campaignActionId) && <option value={rule.campaignActionId}>{rule.campaignActionId ? `${rule.campaignActionId} (không còn khả dụng)` : 'Chọn loại chiến dịch'}</option>}
            {actions.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></td>
            <td><div className="random-quantity">{rule.unit === 'run' ? <span>1 lượt</span> : <><input type="number" min="1" step="1" aria-label={`Chỉ tiêu dòng ${index + 1}`} value={Number.isNaN(rule.quantity) ? '' : rule.quantity} disabled={busy} onChange={e => update({ ...config, rules: config.rules.map((r, i) => i === index ? { ...r, quantity: e.target.valueAsNumber } : r) })}/><span>{rule.unit === 'minute' ? 'phút' : 'data'}</span></>}</div></td>
            <td><div className="random-row-actions">{([-1, 1] as const).map(delta => <button key={delta} className="btn-icon" aria-label={delta < 0 ? `Chuyển dòng ${index + 1} lên` : `Chuyển dòng ${index + 1} xuống`} disabled={busy || index + delta < 0 || index + delta >= config.rules.length} onClick={() => {
              const rules = [...config.rules]; [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]]; update({ ...config, rules })
            }}>{delta < 0 ? <ArrowUp size={14}/> : <ArrowDown size={14}/>}</button>)}
              <button className="btn-icon" aria-label={`Xóa dòng ${index + 1}`} disabled={busy} onClick={() => update({ ...config, rules: config.rules.filter((_, i) => i !== index) })}><Trash2 size={14}/></button></div></td></tr>)}
        </tbody></table>
          <button className="btn btn-secondary btn-sm" disabled={!config || busy || !actions.length || config.rules.length >= 100} onClick={() => { if (config && actions[0]) update({ ...config, rules: [...config.rules, { campaignActionId: actions[0].id, quantity: 1, unit: randomRuleUnit(actions[0].id) }] }) }}><Plus size={14}/>Thêm loại chiến dịch</button>
        </div>}
      <p className="random-muted">{isAiRandomConfig(config)
        ? 'Kế hoạch hôm nay được giữ khi bật lại. Chỉ tiêu mỗi lượt vẫn tuân thủ lịch, data và quota; chiến dịch tạm dừng không tự được tiếp tục.'
        : 'Đợt đang chạy giữ quy tắc cũ. Cấu hình mới bắt đầu từ dòng đầu sau khi đợt đó kết thúc.'}</p>
      {error && <p className="random-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={busy || !config} onClick={() => void save()}>{busy ? 'Đang xử lý…' : enableAfterSave ? 'Lưu và chạy ngẫu nhiên' : 'Lưu cấu hình'}</button></footer>
  </section></div>
}
