import { useMemo } from 'react'
import { X, Trash2, Link as LinkIcon, Package } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { useFlowStore } from '../../stores/flowStore'
import { useElementStore } from '../../stores/elementStore'
import { builtinActions } from '../../../../shared/actions'
import { ActionIOField, ActionType, ActionCategory } from '../../../../shared/types'

export default function ConfigPanel() {
  const {
    nodes,
    selectedNodeId,
    updateNodeData,
    updateInputMapping,
    removeNode,
    selectNode
  } = useFlowStore()
  const { elements } = useElementStore()

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  )

  const actionDef = useMemo(() => {
    if (!selectedNode) return null
    if (selectedNode.data.actionType === 'block') {
      const bData = selectedNode.data.blockData
      if (!bData) return null
      return {
        id: `block_${bData.id}`,
        name: bData.name,
        type: 'block' as ActionType,
        description: 'Reusable block',
        icon: 'Package',
        category: 'block' as ActionCategory,
        inputSchema: bData.inputSchema,
        outputSchema: bData.outputSchema
      }
    }
    return builtinActions.find(a => a.type === selectedNode.data.actionType) || null
  }, [selectedNode])

  if (!selectedNode || !actionDef) {
    return (
      <div className="config-panel">
        <div className="config-panel-header">
          <span className="config-panel-title">Properties</span>
        </div>
        <div className="config-panel-content">
          <div className="empty-state">
            <div className="empty-state-text">Select a node to configure</div>
          </div>
        </div>
      </div>
    )
  }

  const handleConfigChange = (fieldName: string, value: unknown) => {
    updateNodeData(selectedNode.id, {
      config: { ...(selectedNode.data.config || {}), [fieldName]: value }
    })
  }

  const handleDelete = () => {
    removeNode(selectedNode.id)
  }

  const handleMappingChange = (fieldName: string, updates: Partial<{ sourceNodeId: string, sourceField: string, sourcePath?: string }>) => {
    const current = selectedNode.data.inputMapping?.[fieldName] || { sourceNodeId: '', sourceField: '' }
    updateInputMapping(selectedNode.id, fieldName, { ...current, ...updates } as any)
  }

  const toggleMapping = (fieldName: string) => {
    const currentMapping = selectedNode.data.inputMapping?.[fieldName]
    if (currentMapping) {
      updateInputMapping(selectedNode.id, fieldName, null)
    } else {
      // Default to first available node's first output
      const possibleSources = nodes.filter(n => n.id !== selectedNodeId)
      if (possibleSources.length > 0) {
        const sourceNode = possibleSources[0]
        const sourceDef = sourceNode.data.actionType === 'block'
          ? sourceNode.data.blockData
          : builtinActions.find(a => a.type === sourceNode.data.actionType)

        const firstOutput = sourceDef?.outputSchema?.[0]?.name || 'output'
        // use handleMappingChange to set initial mapping
        handleMappingChange(fieldName, { sourceNodeId: sourceNode.id, sourceField: firstOutput })
      }
    }
  }

  const getNodeDisplayName = (node: any) => {
    const { data } = node
    const config = data.config || {}

    if (data.actionType === 'blockInput' || data.actionType === 'blockOutput') {
      return `${data.label}: ${config.fieldName || 'unnamed'}`
    }

    // Add context for common actions
    if (data.actionType === 'navigate' && config.url) {
      return `Navigate: ${config.url}`
    }

    if (data.actionType === 'type' && config.text) {
      return `Type: ${config.text.slice(0, 15)}${config.text.length > 15 ? '...' : ''}`
    }

    return data.label || data.actionType
  }

  const renderInputField = (field: ActionIOField, isOutput = false) => {
    const mapping = selectedNode.data.inputMapping?.[field.name]
    const isMapped = !!mapping
    const value = isOutput
      ? selectedNode.data.output?.[field.name]
      : (selectedNode.data.config?.[field.name] ?? field.defaultValue ?? '')

    if (isOutput) {
      return (
        <div className="config-output-field">
          <span className="output-label">{field.label}</span>
          <span className="output-value">
            {value === undefined || value === null ? 'None' : String(value)}
          </span>
        </div>
      )
    }

    return (
      <div key={field.name} className="config-field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <label style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{field.label}{field.required && ' *'}</label>
          <button
            className={`btn-icon ${isMapped ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '2px 4px', borderRadius: 4, opacity: isMapped ? 1 : 0.5 }}
            onClick={() => toggleMapping(field.name)}
            title="Map from previous node"
          >
            <LinkIcon size={14} />
          </button>
        </div>

        {isMapped ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-primary)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>SOURCE NODE</div>
            <select
              value={mapping?.sourceNodeId || ''}
              onChange={(e) => handleMappingChange(field.name, { sourceNodeId: e.target.value })}
              style={{ width: '100%', fontSize: 11, padding: '4px 6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}
            >
              <option value="">Select Node</option>
              {nodes.filter(n => n.id !== selectedNodeId).map(n => (
                <option key={n.id} value={n.id}>{getNodeDisplayName(n)}</option>
              ))}
            </select>

            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>OUTPUT FIELD</div>
            <select
              value={mapping?.sourceField || ''}
              onChange={(e) => handleMappingChange(field.name, { sourceField: e.target.value })}
              style={{ width: '100%', fontSize: 11, padding: '4px 6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}
            >
              {(() => {
                const srcNode = nodes.find(n => n.id === mapping?.sourceNodeId)
                if (!srcNode) return <option value="">Select Field</option>
                const srcDef = srcNode.data.actionType === 'block'
                  ? srcNode.data.blockData
                  : builtinActions.find(a => a.type === srcNode.data.actionType)

                return srcDef?.outputSchema.map(f => (
                  <option key={f.name} value={f.name}>{f.label || f.name}</option>
                )) || <option value="output">Value</option>
              })()}
            </select>

            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>PROPERTY PATH (OPTIONAL)</div>
            <input
              type="text"
              value={mapping?.sourcePath || ''}
              placeholder="e.g. data.user.name"
              onChange={(e) => handleMappingChange(field.name, { sourcePath: e.target.value })}
              style={{ width: '100%', fontSize: 11, padding: '4px 6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}
            />
          </div>
        ) : (
          <div className="input-wrapper">
            {field.type === 'boolean' ? (
              <div className="config-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id={`chk-${field.name}`}
                  checked={!!value}
                  onChange={(e) => handleConfigChange(field.name, e.target.checked)}
                />
                <label htmlFor={`chk-${field.name}`} style={{ cursor: 'pointer', fontSize: 12 }}>Enabled</label>
              </div>
            ) : field.type === 'element' ? (
              <div className="element-input-wrapper">
                <select
                  value={(value as string) || ''}
                  onChange={(e) => handleConfigChange(field.name, e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: 13, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}
                >
                  <option value="">Select Element</option>
                  {elements.map(el => (
                    <option key={el.id} value={el.xpath}>{el.name}</option>
                  ))}
                </select>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Use elements captured via "Start Capturing"
                </div>
              </div>
            ) : field.options ? (
              <select
                value={(value as string) || ''}
                onChange={(e) => handleConfigChange(field.name, e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}
              >
                {field.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : field.type === 'number' ? (
              <input
                type="number"
                value={value as number}
                onChange={(e) => handleConfigChange(field.name, parseFloat(e.target.value))}
                placeholder={field.placeholder}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}
              />
            ) : (
              <textarea
                value={value as string}
                onChange={(e) => handleConfigChange(field.name, e.target.value)}
                placeholder={field.placeholder}
                rows={field.type === 'json' ? 4 : 2}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)', resize: 'vertical' }}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  const IconComponent = (LucideIcons as any)[actionDef.icon] || Package

  return (
    <div className="config-panel">
      <div className="config-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className={`action-icon ${actionDef.category}`} style={{ 
            width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `var(--bg-tertiary)`
          }}>
            <IconComponent size={18} />
          </div>
          <div>
            <div className="config-panel-title">{actionDef.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{actionDef.category}</div>
          </div>
        </div>
        <button className="btn-icon btn-ghost" onClick={() => selectNode(null)}>
          <X size={18} />
        </button>
      </div>

      <div className="config-panel-content">
        <div className="config-section">
          <div className="config-section-title">INPUT SETTINGS</div>
          {actionDef.inputSchema.map(field => renderInputField(field))}
        </div>

        {actionDef.outputSchema.length > 0 && (
          <div className="config-section" style={{ marginTop: 20 }}>
            <div className="config-section-title">OUTPUTS</div>
            {actionDef.outputSchema.map(field => renderInputField(field, true))}
          </div>
        )}

        <div style={{ marginTop: 'auto', paddingTop: 20 }}>
          <button className="btn-danger w-full" onClick={handleDelete} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Trash2 size={16} />
            Delete Node
          </button>
        </div>
      </div>
    </div>
  )
}
