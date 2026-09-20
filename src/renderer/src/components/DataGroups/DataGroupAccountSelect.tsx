import { useEffect, useState } from 'react'
import type { DataGroupAccountOption } from '../../../../shared/types'
import { getDataGroupApi } from './dataGroupApi'

export function useDataGroupAccountOptions(groupId: number | null, typeId: number | '', enabled: boolean) {
  const [revision, setRevision] = useState(0)
  const key = `${groupId ?? 'new'}:${typeId}:${revision}`
  const [result, setResult] = useState<{ key: string; options: DataGroupAccountOption[]; error: string | null } | null>(null)

  useEffect(() => {
    if (!enabled) {
      setResult(null)
      return
    }
    let cancelled = false
    const api = getDataGroupApi()
    void (async () => {
      try {
        if (!api?.getDataGroupAccountOptions) throw new Error('Chức năng chọn tài khoản chưa sẵn sàng. Hãy cập nhật ứng dụng.')
        const options = await api.getDataGroupAccountOptions({ groupId, dataTypeCategoryItemId: typeId || null })
        if (!cancelled) setResult({ key, options, error: null })
      } catch (error) {
        if (!cancelled) setResult({ key, options: [], error: error instanceof Error ? error.message : 'Không thể kiểm tra tài khoản.' })
      }
    })()
    return () => { cancelled = true }
  }, [enabled, groupId, typeId, key])

  const current = enabled && result?.key === key ? result : null
  return {
    options: current?.options ?? [],
    loading: enabled && !current,
    error: current?.error ?? null,
    reload: () => setRevision(value => value + 1),
    allows: (id: number | '') => !!current?.options.some(option => option.accountId === (id || null) && !option.disabledReason)
  }
}

export default function DataGroupAccountSelect({ id, label, value, onChange, state, disabled, currentName }: {
  id?: string
  label: string
  value: number | ''
  onChange: (value: number | '') => void
  state: ReturnType<typeof useDataGroupAccountOptions>
  disabled?: boolean
  currentName?: string | null
}) {
  const selected = state.options.find(option => option.accountId === (value || null))
  return <>
    <select id={id} className="data-group-manager-edit-type-select" aria-label={label} value={value}
      disabled={disabled || state.loading || !!state.error}
      onChange={event => {
        const next = event.target.value ? Number(event.target.value) : ''
        if (state.allows(next)) onChange(next)
      }}>
      {!selected && <option value={value} disabled>{value ? currentName || `Tài khoản ${value}` : 'Không gắn tài khoản'}</option>}
      {state.options.map(option => <option key={option.accountId ?? 'none'} value={option.accountId ?? ''}
        disabled={!!option.disabledReason} title={option.disabledReason ?? undefined}>
        {option.accountName}{option.disabledReason ? ` — ${option.disabledReason}` : ''}
      </option>)}
    </select>
    {state.loading ? <small>Đang kiểm tra tài khoản phù hợp…</small>
      : state.error ? <small role="alert">{state.error} <button type="button" className="btn btn-ghost btn-sm" onClick={state.reload} disabled={disabled}>Thử lại</button></small>
      : selected?.disabledReason ? <small>{selected.disabledReason}</small>
      : <small>Chỉ chọn được tài khoản phù hợp với data, nguồn và bộ lọc của nhóm.</small>}
  </>
}
