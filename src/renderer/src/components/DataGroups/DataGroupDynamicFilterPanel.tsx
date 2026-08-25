import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowRight,
  Filter,
  LoaderCircle,
  Lock,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type {
  DataGroupDynamicFilterConfig,
  DataGroupDynamicFilterFieldCode,
  DataGroupDynamicFilterOperatorCode,
  DataGroupDynamicFilterRule,
  DataGroupDynamicFilterScopeCode,
  DataGroupDynamicFilterValueOption
} from '../../../../shared/types'
import type { DataGroupElectronAPI } from './dataGroupApi'

interface DataGroupDynamicFilterPanelProps {
  api: DataGroupElectronAPI
  groupId: number
  groupName: string
  groupDataTypeName: string
  isSupported: boolean
  zaloTagNameById?: Map<string, string>
  akaBizTagNameById?: Map<number, string>
  onRuleCountChange: (count: number) => void
  onSaved: () => void | Promise<void>
  showAlert: (message: string, type?: 'success' | 'error' | 'info') => void
}

interface RuleEditorState {
  index: number | null
  draft: DataGroupDynamicFilterRule
}

const EMPTY_COUNTS = {
  matchedCount: 0,
  lastEnteredCount: 0,
  lastExitedCount: 0,
  queueCount: 0
}

const FIELD_FALLBACKS: Record<DataGroupDynamicFilterFieldCode, string> = {
  zalo_tag: 'Tag Zalo',
  akabiz_tag: 'Tag akaBiz',
  zalo_group_membership: 'Trạng thái thành viên group Zalo',
  zalo_friend_status: 'Trạng thái kết bạn Zalo'
}

const FIELD_DESCRIPTION_FALLBACKS: Record<DataGroupDynamicFilterFieldCode, string> = {
  zalo_tag: 'Tag gắn trên chính tài khoản Zalo',
  akabiz_tag: 'Tag do akaBiz gắn theo phễu khách',
  zalo_group_membership: 'Vào / ra một group Zalo',
  zalo_friend_status: 'Đã là bạn, chưa là bạn, đã gửi lời mời'
}

const OPERATOR_FALLBACKS: Record<DataGroupDynamicFilterOperatorCode, string> = {
  contains: 'chứa',
  not_contains: 'không chứa',
  equals: 'bằng',
  not_equals: 'không bằng',
  in: 'vào',
  out: 'ra'
}

const DEFAULT_OPERATORS: Record<DataGroupDynamicFilterFieldCode, DataGroupDynamicFilterOperatorCode[]> = {
  zalo_tag: ['contains', 'not_contains'],
  akabiz_tag: ['contains', 'not_contains'],
  zalo_group_membership: ['in', 'out'],
  zalo_friend_status: ['equals', 'not_equals']
}

const formatCount = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const normalizeRuleOrder = (rules: DataGroupDynamicFilterRule[]) => {
  const positions: Record<DataGroupDynamicFilterScopeCode, number> = { enter: 0, leave: 0 }
  return rules.map(rule => ({
    ...rule,
    sortOrder: positions[rule.scopeCode]++
  }))
}

const mergeLocalTagValues = (
  config: DataGroupDynamicFilterConfig,
  zaloTagNameById?: Map<string, string>,
  akaBizTagNameById?: Map<number, string>
) => {
  const values = [...config.values]
  const known = new Set(values.map(value => `${value.fieldCode}:${value.key}`))
  zaloTagNameById?.forEach((label, key) => {
    const identity = `zalo_tag:${key}`
    if (known.has(identity)) return
    known.add(identity)
    values.push({ key, label, fieldCode: 'zalo_tag', accountId: null, secondaryLabel: 'Tag Zalo' })
  })
  akaBizTagNameById?.forEach((label, key) => {
    const identity = `akabiz_tag:${key}`
    if (known.has(identity)) return
    known.add(identity)
    values.push({ key: String(key), label, fieldCode: 'akabiz_tag', accountId: null, secondaryLabel: 'Tag akaBiz' })
  })
  return { ...config, values }
}

const createDraftRule = (
  scopeCode: DataGroupDynamicFilterScopeCode
): DataGroupDynamicFilterRule => ({
  scopeCode,
  joinCode: 'and',
  fieldCode: 'zalo_tag',
  operatorCode: 'contains',
  accountId: null,
  sortOrder: 0,
  valueKeys: [],
  valueLabels: []
})

export default function DataGroupDynamicFilterPanel({
  api,
  groupId,
  groupName,
  groupDataTypeName,
  isSupported,
  zaloTagNameById,
  akaBizTagNameById,
  onRuleCountChange,
  onSaved,
  showAlert
}: DataGroupDynamicFilterPanelProps) {
  const [config, setConfig] = useState<DataGroupDynamicFilterConfig | null>(null)
  const [rules, setRules] = useState<DataGroupDynamicFilterRule[]>([])
  const [isEnabled, setIsEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<RuleEditorState | null>(null)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const loadSequenceRef = useRef(0)

  const loadConfig = useCallback(async (quiet = false) => {
    const loadSequence = ++loadSequenceRef.current
    if (!isSupported) {
      setConfig(null)
      setRules([])
      setIsEnabled(false)
      setError(null)
      return
    }
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const next = mergeLocalTagValues(
        await api.getDataGroupDynamicFilter(groupId),
        zaloTagNameById,
        akaBizTagNameById
      )
      if (loadSequence !== loadSequenceRef.current) return
      setConfig(next)
      setRules(normalizeRuleOrder(next.rules))
      setIsEnabled(next.isEnabled)
      setHasLocalChanges(false)
    } catch (loadError: any) {
      if (loadSequence !== loadSequenceRef.current) return
      console.error('Failed to load Data Group dynamic filter:', loadError)
      setError(loadError?.message || 'Không thể tải bộ lọc động.')
    } finally {
      if (!quiet && loadSequence === loadSequenceRef.current) setLoading(false)
    }
  }, [akaBizTagNameById, api, groupId, isSupported, zaloTagNameById])

  useEffect(() => {
    setConfig(null)
    setRules([])
    setIsEnabled(false)
    setEditor(null)
    setHasLocalChanges(false)
    void loadConfig()
    return () => {
      loadSequenceRef.current += 1
    }
  }, [loadConfig])

  useEffect(() => {
    onRuleCountChange(rules.length)
  }, [onRuleCountChange, rules.length])

  useEffect(() => {
    if (!isSupported || editor || hasLocalChanges || saving) return
    const refreshTimer = window.setInterval(() => void loadConfig(true), 30_000)
    return () => window.clearInterval(refreshTimer)
  }, [editor, hasLocalChanges, isSupported, loadConfig, saving])

  const rulesByScope = useMemo(() => ({
    enter: rules.filter(rule => rule.scopeCode === 'enter'),
    leave: rules.filter(rule => rule.scopeCode === 'leave')
  }), [rules])

  const fieldNameByCode = useMemo(() => new Map(
    (config?.catalog.fields || []).map(item => [item.code, item.name])
  ), [config?.catalog.fields])
  const operatorNameByCode = useMemo(() => new Map(
    (config?.catalog.operators || []).map(item => [item.code, item.name])
  ), [config?.catalog.operators])
  const accountNameById = useMemo(() => new Map(
    (config?.accounts || []).map(account => [account.id, account.name])
  ), [config?.accounts])

  const allowedOperators = useMemo(() => {
    if (!editor || !config) return []
    const field = config.catalog.fields.find(item => item.code === editor.draft.fieldCode)
    const defaults = DEFAULT_OPERATORS[editor.draft.fieldCode]
    const configured = Array.isArray(field?.metadata.operators)
      ? new Set(field.metadata.operators.filter((code): code is DataGroupDynamicFilterOperatorCode => typeof code === 'string'))
      : null
    const codes = configured ? defaults.filter(code => configured.has(code)) : defaults
    return codes.map(code => ({
      code,
      name: operatorNameByCode.get(code) || OPERATOR_FALLBACKS[code]
    }))
  }, [config, editor, operatorNameByCode])

  const editorValues = useMemo(() => {
    if (!editor || !config) return []
    const selectedAccountId = editor.draft.accountId ?? null
    const seen = new Set<string>()
    return config.values.filter(value => {
      if (value.fieldCode !== editor.draft.fieldCode) return false
      if (selectedAccountId !== null && value.accountId !== null && value.accountId !== selectedAccountId) return false
      if (seen.has(value.key)) return false
      seen.add(value.key)
      return true
    })
  }, [config, editor])

  const editorIsFirstRule = useMemo(() => {
    if (!editor) return false
    const firstIndex = rules.findIndex(rule => rule.scopeCode === editor.draft.scopeCode)
    return editor.index === null ? firstIndex === -1 : editor.index === firstIndex
  }, [editor, rules])

  const openRuleEditor = (scopeCode: DataGroupDynamicFilterScopeCode, index: number | null = null) => {
    if (index === null) {
      const draft = createDraftRule(scopeCode)
      const firstValue = config?.values.find(value => value.fieldCode === draft.fieldCode)
      setEditor({
        index: null,
        draft: firstValue
          ? { ...draft, valueKeys: [firstValue.key], valueLabels: [firstValue.label] }
          : draft
      })
      return
    }
    setEditor({ index, draft: { ...rules[index], valueKeys: [...rules[index].valueKeys], valueLabels: [...rules[index].valueLabels] } })
  }

  const updateDraft = (patch: Partial<DataGroupDynamicFilterRule>) => {
    setEditor(current => current ? { ...current, draft: { ...current.draft, ...patch } } : null)
  }

  const toggleDraftValue = (value: DataGroupDynamicFilterValueOption) => {
    if (!editor) return
    const selected = editor.draft.valueKeys.includes(value.key)
    const nextKeys = selected
      ? editor.draft.valueKeys.filter(key => key !== value.key)
      : [...editor.draft.valueKeys, value.key]
    const nextLabels = selected
      ? editor.draft.valueLabels.filter((_, index) => editor.draft.valueKeys[index] !== value.key)
      : [...editor.draft.valueLabels, value.label]
    updateDraft({ valueKeys: nextKeys, valueLabels: nextLabels })
  }

  const commitEditor = () => {
    if (!editor || editor.draft.valueKeys.length === 0) {
      showAlert('Hãy chọn ít nhất một giá trị cho điều kiện.', 'error')
      return
    }
    const nextRules = editor.index === null
      ? [...rules, editor.draft]
      : rules.map((rule, index) => index === editor.index ? editor.draft : rule)
    setRules(normalizeRuleOrder(nextRules))
    setHasLocalChanges(true)
    setEditor(null)
  }

  const removeRule = (index: number) => {
    setRules(current => normalizeRuleOrder(current.filter((_, currentIndex) => currentIndex !== index)))
    setHasLocalChanges(true)
  }

  const toggleRuleJoin = (index: number) => {
    setRules(current => normalizeRuleOrder(current.map((rule, currentIndex) => currentIndex === index
      ? { ...rule, joinCode: rule.joinCode === 'and' ? 'or' : 'and' }
      : rule)))
    setHasLocalChanges(true)
  }

  const handleSave = async () => {
    if (isEnabled && rulesByScope.enter.length === 0) {
      showAlert('Bộ lọc đang bật cần ít nhất một điều kiện vào nhóm.', 'error')
      return
    }
    setSaving(true)
    try {
      const saved = mergeLocalTagValues(
        await api.saveDataGroupDynamicFilter({
          groupId,
          isEnabled,
          rules: normalizeRuleOrder(rules)
        }),
        zaloTagNameById,
        akaBizTagNameById
      )
      setConfig(saved)
      setRules(normalizeRuleOrder(saved.rules))
      setIsEnabled(saved.isEnabled)
      setHasLocalChanges(false)
      showAlert(
        saved.isEnabled
          ? 'Đã lưu bộ lọc. Chỉ contact thay đổi từ thời điểm này mới được đối chiếu.'
          : 'Đã lưu và tắt bộ lọc động. Data hiện có được giữ nguyên.',
        'success'
      )
      await onSaved()
    } catch (saveError: any) {
      console.error('Failed to save Data Group dynamic filter:', saveError)
      showAlert(saveError?.message || 'Không thể lưu bộ lọc động.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const renderScope = (scopeCode: DataGroupDynamicFilterScopeCode) => {
    const scopeRules = rulesByScope[scopeCode]
    const isEnter = scopeCode === 'enter'
    return (
      <section className={`data-group-dynamic-scope is-${scopeCode}`}>
        <div className="data-group-dynamic-scope-heading">
          <span className="data-group-dynamic-scope-icon">{isEnter ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}</span>
          <strong>{isEnter ? 'ĐIỀU KIỆN VÀO NHÓM' : 'ĐIỀU KIỆN RA KHỎI NHÓM'}</strong>
          <em>{scopeRules.length}</em>
        </div>
        {scopeRules.map((rule, scopeIndex) => {
          const index = rules.indexOf(rule)
          const fieldName = fieldNameByCode.get(rule.fieldCode) || FIELD_FALLBACKS[rule.fieldCode]
          const operatorName = operatorNameByCode.get(rule.operatorCode) || OPERATOR_FALLBACKS[rule.operatorCode]
          return (
            <div key={`${scopeCode}-${index}`} className="data-group-dynamic-rule-wrap">
              {scopeIndex > 0 && (
                <div className={`data-group-dynamic-join is-${rule.joinCode}`}>
                  <button type="button" onClick={() => toggleRuleJoin(index)} title="Bấm để đổi VÀ/HOẶC">
                    {rule.joinCode === 'and' ? 'VÀ' : 'HOẶC'}
                  </button>
                  <i />
                </div>
              )}
              <article
                className="data-group-dynamic-rule"
                role="button"
                tabIndex={0}
                onClick={() => openRuleEditor(scopeCode, index)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openRuleEditor(scopeCode, index)
                  }
                }}
              >
                <header>
                  <span>{scopeIndex + 1}</span>
                  <strong>{groupDataTypeName}</strong>
                  <button type="button" onClick={event => { event.stopPropagation(); removeRule(index) }} title="Xoá điều kiện" aria-label={`Xoá điều kiện ${scopeIndex + 1}`}><Trash2 size={14} /></button>
                </header>
                <div className="data-group-dynamic-rule-body">
                  <strong>{fieldName}</strong>
                  <b>{operatorName}</b>
                  {rule.valueLabels.map((label, valueIndex) => <span key={`${rule.valueKeys[valueIndex]}-${valueIndex}`}>{label}</span>)}
                </div>
                <footer><UserRound size={12} /> {rule.accountId ? accountNameById.get(rule.accountId) || `Tài khoản ${rule.accountId}` : 'Tất cả tài khoản Zalo'}</footer>
              </article>
            </div>
          )
        })}
        <button type="button" className="data-group-dynamic-add-rule" onClick={() => openRuleEditor(scopeCode)}>
          <Plus size={16} /> Thêm điều kiện {isEnter ? 'vào nhóm' : 'ra khỏi nhóm'}
        </button>
      </section>
    )
  }

  if (!isSupported) {
    return (
      <div className="data-group-info-scroll data-group-dynamic-scroll">
        <div className="data-group-dynamic-unsupported">
          <SlidersHorizontal size={30} />
          <strong>Bộ lọc động dành cho nhóm Zalo · User theo UID</strong>
          <p>Nhóm “{groupName}” đang dùng loại data khác. Chuyển đúng loại nhóm để lọc theo tag, bạn bè và group Zalo.</p>
        </div>
      </div>
    )
  }

  if (loading && !config) {
    return <div className="data-group-info-scroll"><div className="data-group-info-empty"><LoaderCircle size={22} className="spin" /><span>Đang tải bộ lọc động...</span></div></div>
  }

  if (error && !config) {
    return <div className="data-group-info-scroll"><div className="data-group-info-empty is-error"><SlidersHorizontal size={24} /><span>{error}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadConfig()}>Thử lại</button></div></div>
  }

  const counts = config || EMPTY_COUNTS
  return (
    <>
      <div className="data-group-info-scroll data-group-dynamic-scroll">
        <section className={`data-group-dynamic-toggle-card${isEnabled ? ' is-enabled' : ''}`}>
          <button type="button" className="data-group-dynamic-toggle" role="switch" aria-label="Bật hoặc tắt bộ lọc động" aria-checked={isEnabled} onClick={() => { setIsEnabled(value => !value); setHasLocalChanges(true) }}><i /></button>
          <div><strong>Bộ lọc động {isEnabled ? 'đang bật' : 'đang tắt'}</strong><p>Chỉ data phát sinh thay đổi sau khi lưu mới được tự động đối chiếu vào hoặc ra nhóm.</p></div>
        </section>

        <section className="data-group-dynamic-metrics">
          <div><strong>{formatCount(counts.matchedCount)}</strong><span>do bộ lọc</span></div>
          <div><strong>+{formatCount(counts.lastEnteredCount)}</strong><span>vừa vào</span></div>
          <div><strong>−{formatCount(counts.lastExitedCount)}</strong><span>vừa ra</span></div>
        </section>

        <div className={`data-group-dynamic-rules${isEnabled ? '' : ' is-disabled'}`}>
          {renderScope('enter')}
          {renderScope('leave')}
        </div>
      </div>

      <div className="data-group-dynamic-actions">
        <span>
          {isEnabled ? 'Chỉ xử lý data thay đổi sau khi lưu' : 'Đang tắt — nhóm giữ nguyên data hiện có'}
          {(config?.queueCount || 0) > 0 ? ` · ${formatCount(config?.queueCount || 0)} đang chờ` : ''}
        </span>
        <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : null} Lưu bộ lọc</button>
      </div>

      {editor && config && createPortal(
        <div className="data-group-dynamic-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditor(null) }}>
          <section className="data-group-dynamic-editor" role="dialog" aria-modal="true" aria-label="Thêm điều kiện bộ lọc động">
            <header>
              <span className={`data-group-dynamic-editor-icon is-${editor.draft.scopeCode}`}><Filter size={17} /></span>
              <div>
                <h3>{editor.index === null ? 'Thêm' : 'Sửa'} điều kiện {editor.draft.scopeCode === 'enter' ? 'vào nhóm' : 'ra khỏi nhóm'}</h3>
                <p>{groupName} · ID {groupId}</p>
              </div>
              <button type="button" onClick={() => setEditor(null)} aria-label="Đóng"><X size={18} /></button>
            </header>
            <div className="data-group-dynamic-editor-body">
              <div className="data-group-dynamic-editor-join">
                <span><strong>Điều kiện nối</strong><small>{editorIsFirstRule ? 'Điều kiện đầu tiên của khối luôn bắt đầu bằng VÀ' : 'Cách nối với các điều kiện đã có trong cùng khối'}</small></span>
                <div>
                  <button type="button" className={(editorIsFirstRule || editor.draft.joinCode === 'and') ? 'is-selected' : ''} disabled={editorIsFirstRule} onClick={() => updateDraft({ joinCode: 'and' })}>VÀ</button>
                  <button type="button" className={!editorIsFirstRule && editor.draft.joinCode === 'or' ? 'is-selected is-or' : ''} disabled={editorIsFirstRule} onClick={() => updateDraft({ joinCode: 'or' })}>HOẶC</button>
                </div>
              </div>

              <div className="data-group-dynamic-editor-locked">
                <Lock size={15} />
                <div>
                  <strong>Lấy theo nhóm data — không sửa được</strong>
                  <dl>
                    <div><dt>Nhóm dữ liệu</dt><dd>{groupDataTypeName}</dd></div>
                    <div><dt>Tài khoản</dt><dd>{editor.draft.accountId
                      ? accountNameById.get(editor.draft.accountId) || `Tài khoản ${editor.draft.accountId}`
                      : config.accounts.filter(account => !account.isDelete).map(account => account.name).join(' · ') || 'Tất cả tài khoản Zalo'}</dd></div>
                  </dl>
                </div>
              </div>

              <div className="data-group-dynamic-editor-section">
                <strong>Dữ liệu lọc</strong>
                <div className="data-group-dynamic-field-list">
                  {config.catalog.fields.map(field => {
                    const fieldCode = field.code as DataGroupDynamicFilterFieldCode
                    const selected = fieldCode === editor.draft.fieldCode
                    return <button key={field.code} type="button" className={selected ? 'is-selected' : ''} onClick={() => {
                      const firstValue = config.values.find(value => value.fieldCode === fieldCode
                        && (editor.draft.accountId == null || value.accountId == null || value.accountId === editor.draft.accountId))
                      updateDraft({
                        fieldCode,
                        operatorCode: DEFAULT_OPERATORS[fieldCode][0],
                        valueKeys: firstValue ? [firstValue.key] : [],
                        valueLabels: firstValue ? [firstValue.label] : []
                      })
                    }}>
                      <i />
                      <span><strong>{field.name || FIELD_FALLBACKS[fieldCode]}</strong><small>{FIELD_DESCRIPTION_FALLBACKS[fieldCode]}</small></span>
                    </button>
                  })}
                </div>
              </div>

              <div className="data-group-dynamic-editor-section">
                <strong>Loại điều kiện</strong>
                <div className="data-group-dynamic-operator-list">
                  {allowedOperators.map(operator => <button key={operator.code} type="button" className={operator.code === editor.draft.operatorCode ? 'is-selected' : ''} onClick={() => updateDraft({ operatorCode: operator.code })}>{operator.name}</button>)}
                </div>
              </div>

              <div className="data-group-dynamic-editor-section">
                <strong>Giá trị</strong>
                <div className="data-group-dynamic-value-list">
                  {editorValues.length === 0 ? <p>Chưa có dữ liệu phù hợp. Hãy đồng bộ tag hoặc group Zalo trước.</p> : editorValues.map(value => <button key={`${value.fieldCode}-${value.accountId || 'all'}-${value.key}`} type="button" className={editor.draft.valueKeys.includes(value.key) ? 'is-selected' : ''} onClick={() => toggleDraftValue(value)}>{value.label}</button>)}
                </div>
                <small className="data-group-dynamic-value-hint">{editor.draft.valueKeys.length > 1 ? `Đã chọn ${editor.draft.valueKeys.length} giá trị — thỏa mãn 1 trong các giá trị này.` : 'Bấm để chọn, có thể chọn nhiều giá trị.'}</small>
              </div>

              <div className={`data-group-dynamic-editor-summary is-${editor.draft.scopeCode}`}>
                <strong>ĐIỀU KIỆN SẼ {editor.index === null ? 'THÊM' : 'LƯU'}</strong>
                <p>{editor.draft.scopeCode === 'enter' ? 'Vào nhóm khi ' : 'Ra khỏi nhóm khi '}
                  {fieldNameByCode.get(editor.draft.fieldCode) || FIELD_FALLBACKS[editor.draft.fieldCode]} {' '}
                  {operatorNameByCode.get(editor.draft.operatorCode) || OPERATOR_FALLBACKS[editor.draft.operatorCode]} {' '}
                  {editor.draft.valueLabels.length > 0 ? editor.draft.valueLabels.join(' / ') : '(chưa chọn giá trị)'}
                  {' — theo tài khoản & loại dữ liệu của nhóm data'}
                </p>
              </div>
            </div>
            <footer>
              <span>Ghi vào bảng lọc dữ liệu · STT {editor.index === null ? rulesByScope[editor.draft.scopeCode].length + 1 : editor.draft.sortOrder + 1}</span>
              <button type="button" className="btn btn-ghost" onClick={() => setEditor(null)}>Huỷ</button>
              <button type="button" className="btn btn-primary" onClick={commitEditor}>{editor.index === null ? 'Thêm điều kiện' : 'Lưu thay đổi'}</button>
            </footer>
          </section>
        </div>,
        document.body
      )}

    </>
  )
}
