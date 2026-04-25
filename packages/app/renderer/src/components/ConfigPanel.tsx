import { useState, useEffect } from 'react'
import type { BlockManifest } from '@akabiz/engine'
import type { ChannelListItem, NamedSelectorRow } from '../../../shared/ipcChannels'

export interface SelectedNodeInfo {
  id: string
  manifestId: string
  config: Record<string, unknown>
  inputMapping: Record<string, { sourceNodeId: string; sourceField: string; sourcePath?: string }>
}

interface Props {
  selected: SelectedNodeInfo | null
  manifest: BlockManifest | null
  availableSources: Array<{ nodeId: string; manifestId: string }>
  onChange: (id: string, patch: { config?: Record<string, unknown>; inputMapping?: Record<string, { sourceNodeId: string; sourceField: string; sourcePath?: string }> }) => void
  onDelete: (id: string) => void
}

export function ConfigPanel({ selected, manifest, availableSources, onChange, onDelete }: Props): JSX.Element {
  const [configJson, setConfigJson] = useState('')
  const [mappingJson, setMappingJson] = useState('')
  const [configError, setConfigError] = useState<string | null>(null)
  const [mappingError, setMappingError] = useState<string | null>(null)

  useEffect(() => {
    if (selected) {
      setConfigJson(JSON.stringify(selected.config, null, 2))
      setMappingJson(JSON.stringify(selected.inputMapping, null, 2))
      setConfigError(null)
      setMappingError(null)
    }
  }, [selected?.id])

  if (!selected) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
        Click a node trên canvas để edit config
      </div>
    )
  }

  const handleConfigSave = (): void => {
    try {
      const parsed = JSON.parse(configJson) as Record<string, unknown>
      onChange(selected.id, { config: parsed })
      setConfigError(null)
    } catch (e) {
      setConfigError((e as Error).message)
    }
  }

  const handleMappingSave = (): void => {
    try {
      const parsed = JSON.parse(mappingJson)
      onChange(selected.id, { inputMapping: parsed })
      setMappingError(null)
    } catch (e) {
      setMappingError((e as Error).message)
    }
  }

  return (
    <div style={{ padding: 12, height: '100%', overflow: 'auto', fontSize: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>Selected Node</div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{manifest?.name ?? selected.manifestId}</div>
        <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
          id: {selected.id}<br />
          manifest: {selected.manifestId}
        </div>
      </div>

      {manifest && manifest.inputSchema.length > 0 && (
        <details style={{ marginBottom: 12 }} open>
          <summary style={{ cursor: 'pointer', color: '#888', marginBottom: 6 }}>
            Input schema ({manifest.inputSchema.length} fields)
          </summary>
          <div style={{ background: '#0f1115', padding: 8, borderRadius: 4 }}>
            {manifest.inputSchema.map(f => (
              <div key={f.name} style={{ marginBottom: 4 }}>
                <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>{f.name}</span>
                <span style={{ color: '#666' }}> : {f.type}</span>
                {f.required && <span style={{ color: '#fca5a5' }}> *required</span>}
                {f.description && <div style={{ color: '#888', fontSize: 11, marginLeft: 12 }}>{f.description}</div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Selector helper: show pick + named-selector picker if manifest has selector field */}
      {manifest && manifest.inputSchema.some(f => f.type === 'selector' || f.uiHint === 'selector-picker') && (
        <SelectorHelper
          fieldNames={manifest.inputSchema.filter(f => f.type === 'selector' || f.uiHint === 'selector-picker').map(f => f.name)}
          currentConfig={selected.config}
          onApply={(field, val) => {
            const newConfig = { ...selected.config, [field]: val }
            setConfigJson(JSON.stringify(newConfig, null, 2))
            onChange(selected.id, { config: newConfig })
          }}
        />
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, color: '#cbd5e1' }}>Config (JSON)</label>
        <textarea
          value={configJson}
          onChange={e => setConfigJson(e.target.value)}
          style={{ width: '100%', minHeight: 120, fontFamily: 'Consolas, monospace', fontSize: 11 }}
        />
        {configError && <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 4 }}>{configError}</div>}
        <button onClick={handleConfigSave} className="primary" style={{ marginTop: 6 }}>Apply config</button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, color: '#cbd5e1' }}>Input Mapping (JSON)</label>
        <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>
          Format: <code>{`{ "fieldName": { "sourceNodeId": "...", "sourceField": "..." } }`}</code>
        </div>
        <textarea
          value={mappingJson}
          onChange={e => setMappingJson(e.target.value)}
          style={{ width: '100%', minHeight: 80, fontFamily: 'Consolas, monospace', fontSize: 11 }}
        />
        {mappingError && <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 4 }}>{mappingError}</div>}
        <button onClick={handleMappingSave} className="primary" style={{ marginTop: 6 }}>Apply mapping</button>

        {availableSources.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: '#888', fontSize: 11 }}>Available source nodes ({availableSources.length})</summary>
            <div style={{ background: '#0f1115', padding: 6, borderRadius: 4, marginTop: 4, fontSize: 11, fontFamily: 'monospace' }}>
              {availableSources.map(s => (
                <div key={s.nodeId} style={{ color: '#a78bfa' }}>
                  "{s.nodeId}" <span style={{ color: '#666' }}>({s.manifestId})</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <hr style={{ border: '1px solid #2a3142', margin: '12px 0' }} />
      <button
        style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b' }}
        onClick={() => { if (confirm(`Delete node "${selected.id}"?`)) onDelete(selected.id) }}
      >
        🗑 Delete node
      </button>
    </div>
  )
}

// ========== SelectorHelper ==========

interface SelectorHelperProps {
  fieldNames: string[]
  currentConfig: Record<string, unknown>
  onApply: (field: string, value: unknown) => void
}

function SelectorHelper({ fieldNames, currentConfig, onApply }: SelectorHelperProps): JSX.Element {
  const [namedList, setNamedList] = useState<NamedSelectorRow[]>([])
  const [channels, setChannels] = useState<ChannelListItem[]>([])
  const [pickerField, setPickerField] = useState<string>(fieldNames[0] ?? '')
  const [pickerChannel, setPickerChannel] = useState('')
  const [pickerUrl, setPickerUrl] = useState('')
  const [picking, setPicking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void window.akabiz.selectors.list().then(setNamedList).catch(() => {})
    void window.akabiz.channels.list().then(setChannels).catch(() => {})
  }, [])

  const handlePick = async (): Promise<void> => {
    if (!pickerChannel) { setErr('Choose channel first'); return }
    setPicking(true)
    setErr(null)
    try {
      await window.akabiz.channels.register(pickerChannel)
      const res = await window.akabiz.picker.start({ channelId: pickerChannel, ...(pickerUrl ? { url: pickerUrl } : {}) })
      if (res) {
        const inlineSelector = {
          kind: 'inline',
          type: res.selectorType,
          expression: res.expression,
          fallbacks: res.fallbacks
        }
        onApply(pickerField, inlineSelector)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPicking(false)
    }
  }

  const handleUseNamed = (field: string, name: string): void => {
    onApply(field, { kind: 'named', name })
  }

  return (
    <div style={{ background: '#0f1115', padding: 10, borderRadius: 4, marginBottom: 12, border: '1px solid #2a3142' }}>
      <div style={{ fontSize: 11, color: '#a78bfa', marginBottom: 8, fontWeight: 600 }}>🎯 Selector helper</div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Field</label>
        <select value={pickerField} onChange={e => setPickerField(e.target.value)} style={{ width: '100%' }}>
          {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div className="row">
        <select value={pickerChannel} onChange={e => setPickerChannel(e.target.value)} style={{ flex: 1 }}>
          <option value="">— Channel —</option>
          {channels.filter(c => c.channel_type !== 'headless_node').map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <input value={pickerUrl} onChange={e => setPickerUrl(e.target.value)} placeholder="URL (optional)" style={{ width: '100%', marginTop: 4 }} />
      <button onClick={handlePick} disabled={picking || !pickerChannel} style={{ marginTop: 6, width: '100%' }}>
        {picking ? 'Waiting click in browser...' : '🎯 Pick element'}
      </button>

      {err && <div style={{ color: '#fca5a5', marginTop: 6, fontSize: 11 }}>{err}</div>}

      {namedList.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Or use named selector:</div>
          <select
            value=""
            onChange={e => { if (e.target.value) handleUseNamed(pickerField, e.target.value) }}
            style={{ width: '100%' }}
          >
            <option value="">— Choose named selector —</option>
            {namedList.map(s => (
              <option key={s.id} value={s.name}>
                {s.name} {s.domain ? `(${s.domain})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', color: '#888', fontSize: 11 }}>Current values</summary>
        <pre style={{ background: '#1a1f2c', padding: 6, borderRadius: 4, fontSize: 10, marginTop: 4, overflow: 'auto', maxHeight: 100 }}>
{fieldNames.map(f => `${f}: ${JSON.stringify(currentConfig[f])}`).join('\n')}
        </pre>
      </details>
    </div>
  )
}
