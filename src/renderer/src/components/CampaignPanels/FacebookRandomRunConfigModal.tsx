import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import type { AutoAccount } from '../../../../shared/types'
import { randomRuleUnit, validateFacebookRandomConfig, type FacebookRandomConfig } from '../../../../shared/facebookRandomRun'
import { useCampaignStore } from '../../stores/campaignStore'
import './facebookRandomRun.css'

export default function FacebookRandomRunConfigModal({ account, enableAfterSave, onClose }: {
  account: AutoAccount; enableAfterSave: boolean; onClose: () => void
}) {
  const actions = useCampaignStore(state => state.campaignActions).filter(a => a.flatformType === 'facebook' && a.isActive && !a.isDelete)
  const [config, setConfig] = useState<FacebookRandomConfig | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const view = useRef(0)
  const load = async () => {
    const generation = ++view.current
    setBusy(true); setError('')
    try {
      const settings = await window.electronAPI.facebookRandomRun.get(account.id)
      if (view.current !== generation) return
      const next: FacebookRandomConfig = settings.config ?? { version: 1, revision: 0, rules: [] }
      setConfig(next)
    } catch (e) { if (view.current === generation) setError(String(e instanceof Error ? e.message : e)) }
    finally { if (view.current === generation) setBusy(false) }
  }
  useEffect(() => { void load(); return () => { view.current++ } }, [account.id])
  const update = (next: FacebookRandomConfig) => { setConfig(next); setError('') }
  const save = async () => {
    if (!config || busy) return
    const generation = view.current
    setBusy(true); setError('')
    try {
      if (!config.rules.length) throw new Error('Hãy thêm ít nhất một loại chiến dịch.')
      const next = validateFacebookRandomConfig(config, actions.map(a => a.id))
      const saved = await window.electronAPI.facebookRandomRun.save(account.id, next)
      // Retain the new revision if enabling fails, so retry doesn't overwrite another writer.
      if (view.current === generation && saved.config) update(saved.config)
      if (enableAfterSave) await window.electronAPI.facebookRandomRun.toggle(account.id, true, saved.config!.revision)
      if (view.current === generation) { await useCampaignStore.getState().loadAccounts(); onClose() }
    } catch (e) { if (view.current === generation) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (view.current === generation) setBusy(false) }
  }
  return <div className="modal-overlay"><section className="modal random-config-modal" role="dialog" aria-modal="true" aria-labelledby="random-config-title">
    <header className="modal-header"><h3 id="random-config-title">Cài đặt chạy ngẫu nhiên · {account.name}</h3>
      <button className="btn-icon" aria-label="Đóng" onClick={onClose}><X size={18}/></button></header>
    <div className="modal-body">
      <p>Chọn loại và chỉ tiêu mỗi đợt. Khi chạy, hệ thống mới chọn chiến dịch phù hợp và thực hiện theo thứ tự bên dưới.</p>
      <div className="random-toolbar">
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void load()}>Tải lại</button>
      </div>
      <div className="random-table-scroll"><table className="random-table"><thead><tr><th>Thứ tự</th><th>Loại chiến dịch</th><th>Chỉ tiêu mỗi đợt</th><th>Sắp xếp</th></tr></thead><tbody>
          {config?.rules.map((rule, index) => <tr key={index}><td>{index + 1}</td><td><select aria-label={`Loại chiến dịch dòng ${index + 1}`} disabled={busy} value={rule.campaignActionId} onChange={e => {
            const actionId = e.target.value, unit = randomRuleUnit(actionId)
            update({ ...config, rules: config.rules.map((r, i) => i === index ? { campaignActionId: actionId, quantity: unit === 'run' ? 1 : r.quantity, unit } : r) })
          }}>
            {!actions.some(a => a.id === rule.campaignActionId) && <option value={rule.campaignActionId}>{rule.campaignActionId} (không còn khả dụng)</option>}
            {actions.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></td>
            <td><div className="random-quantity">{rule.unit === 'run' ? <span>1 lượt</span> : <><input type="number" min="1" step="1" aria-label={`Chỉ tiêu dòng ${index + 1}`} value={Number.isNaN(rule.quantity) ? '' : rule.quantity} disabled={busy} onChange={e => update({ ...config, rules: config.rules.map((r, i) => i === index ? { ...r, quantity: e.target.valueAsNumber } : r) })}/><span>{rule.unit === 'minute' ? 'phút' : 'data'}</span></>}</div></td>
            <td><div className="random-row-actions">{([-1, 1] as const).map(delta => <button key={delta} className="btn-icon" aria-label={delta < 0 ? `Chuyển dòng ${index + 1} lên` : `Chuyển dòng ${index + 1} xuống`} disabled={busy || index + delta < 0 || index + delta >= config.rules.length} onClick={() => {
              const rules = [...config.rules]; [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]]; update({ ...config, rules })
            }}>{delta < 0 ? <ArrowUp size={14}/> : <ArrowDown size={14}/>}</button>)}
              <button className="btn-icon" aria-label={`Xóa dòng ${index + 1}`} disabled={busy} onClick={() => update({ ...config, rules: config.rules.filter((_, i) => i !== index) })}><Trash2 size={14}/></button></div></td></tr>)}
        </tbody></table>
          <button className="btn btn-secondary btn-sm" disabled={!config || busy || !actions.length || config.rules.length >= 100} onClick={() => { if (config && actions[0]) update({ ...config, rules: [...config.rules, { campaignActionId: actions[0].id, quantity: 1, unit: randomRuleUnit(actions[0].id) }] }) }}><Plus size={14}/>Thêm loại chiến dịch</button>
        </div>
      <p className="random-muted">Đợt đang chạy giữ quy tắc cũ. Cấu hình mới bắt đầu từ dòng đầu sau khi đợt đó kết thúc.</p>
      {error && <p className="random-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={busy || !config} onClick={() => void save()}>{busy ? 'Đang xử lý…' : enableAfterSave ? 'Lưu và chạy ngẫu nhiên' : 'Lưu cấu hình'}</button></footer>
  </section></div>
}
