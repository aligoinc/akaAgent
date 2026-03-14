import { useMemo } from 'react'
import { X, Trash2, Link as LinkIcon } from 'lucide-react'
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
      config: { ...selectedNode.data.config, [fieldName]: value }
    })
  }

  const handleDelete = () => {
    removeNode(selectedNode.id)
  }

  const handleMappingChange = (fieldName: string, sourceNodeId: string, sourceField: string, sourcePath?: string) => {
    updateInputMapping(selectedNode.id, fieldName, { sourceNodeId, sourceField, sourcePath })
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
        updateInputMapping(selectedNode.id, fieldName, { sourceNodeId: sourceNode.id, sourceField: firstOutput })
      }
    }
  }

  const getNodeDisplayName = (node: any) => {
    const { data, id } = node
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

    if (data.actionType === 'block' && data.blockData) {
      return `Block: ${data.blockData.name}`
    }

    return `${data.label} (${id.slice(0, 4)})`
  }

  const renderField = (field: ActionIOField, isOutput = false) => {
    const mapping = selectedNode.data.inputMapping?.[field.name]
    const isMapped = !!mapping
    const value = isOutput
      ? selectedNode.data.output?.[field.name]
      : selectedNode.data.config[field.name] ?? field.defaultValue ?? ''

    if (isOutput) {
      return (
        <div key={field.name} className="config-field">
          <label>{field.label}</label>
          <input
            type="text"
            value={value !== undefined ? String(value) : '—'}
            readOnly
            style={{ opacity: 0.6, cursor: 'default' }}
          />
        </div>
      )
    }

    return (
      <div key={field.name} className="config-field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <label style={{ margin: 0 }}>{field.label}{field.required && ' *'}</label>
          <button 
            className={`btn-icon ${isMapped ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '2px 4px', borderRadius: 4, opacity: isMapped ? 1 : 0.5 }}
            onClick={() => toggleMapping(field.name)}
            title={isMapped ? 'Remove mapping' : 'Map to another node output'}
          >
            <LinkIcon size={12} />
          </button>
        </div>

        {isMapped ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-primary)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Source Node:</div>
            <select 
              value={mapping.sourceNodeId}
              onChange={(e) => handleMappingChange(field.name, e.target.value, mapping.sourceField)}
              style={{ fontSize: 11, padding: '4px 6px' }}
            >
              {nodes.filter(n => n.id !== selectedNodeId).map(n => (
                <option key={n.id} value={n.id}>{getNodeDisplayName(n)}</option>
              ))}
            </select>
            
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Output Field:</div>
            <select 
              value={mapping.sourceField}
              onChange={(e) => handleMappingChange(field.name, mapping.sourceNodeId, e.target.value)}
              style={{ fontSize: 11, padding: '4px 6px' }}
            >
              {(() => {
                const srcNode = nodes.find(n => n.id === mapping.sourceNodeId)
                if (!srcNode) return <option value="">Select Field</option>
                const srcDef = srcNode.data.actionType === 'block'
                  ? srcNode.data.blockData
                  : builtinActions.find(a => a.type === srcNode.data.actionType)
                
                return srcDef?.outputSchema.map(f => (
                  <option key={f.name} value={f.name}>{f.label || f.name}</option>
                )) || <option value="output">Value</option>
              })()}
            </select>
            
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Property Path (optional):</div>
            <input 
              type="text"
              value={mapping.sourcePath || ''}
              placeholder="e.g. data.user.name"
              onChange={(e) => handleMappingChange(field.name, mapping.sourceNodeId, mapping.sourceField, e.target.value)}
              style={{ fontSize: 11, padding: '4px 6px' }}
            />
          </div>
        ) : (
          <>
            {/* Manual input types */}
            {field.type === 'boolean' ? (
              <div className="config-checkbox">
                <input
                  type="checkbox"
                  id={`field-${field.name}`}
                  checked={Boolean(value)}
                  onChange={(e) => handleConfigChange(field.name, e.target.checked)}
                />
                <label htmlFor={`field-${field.name}`} style={{ fontSize: 11 }}>Enable</label>
              </div>
            ) : field.options && field.options.length > 0 ? (
              <select
                value={String(value)}
                onChange={(e) => handleConfigChange(field.name, e.target.value)}
              >
                {field.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : field.type === 'number' ? (
              <input
                type="number"
                value={value !== '' ? Number(value) : ''}
                placeholder={field.placeholder}
                onChange={(e) => handleConfigChange(field.name, e.target.value ? Number(e.target.value) : '')}
              />
            ) : field.type === 'json' ? (
              <textarea
                value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                placeholder={field.placeholder}
                onChange={(e) => handleConfigChange(field.name, e.target.value)}
              />
            ) : field.type === 'element' ? (
              <select
                value={String(value || '')}
                onChange={(e) => handleConfigChange(field.name, e.target.value)}
                style={{ border: '2px dashed var(--border-hover)', background: 'var(--bg-elevated)' }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
                onDrop={(e) => {
                  e.preventDefault()
                  const data = e.dataTransfer.getData('application/akabiz-element')
                  if (data) handleConfigChange(field.name, JSON.parse(data).id)
                }}
              >
                <option value="">-- Select Element --</option>
                {elements.map(el => (
                  <option key={el.id} value={el.id}>{el.name} ({el.xpath})</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={String(value)}
                placeholder={field.placeholder}
                onChange={(e) => handleConfigChange(field.name, e.target.value)}
              />
            )}
            {field.description && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>{field.description}</div>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="config-panel animate-slideIn">
      <div className="config-panel-header">
        <span className="config-panel-title">{actionDef.name}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-icon" onClick={handleDelete} title="Delete node">
            <Trash2 size={14} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => selectNode(null)} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="config-panel-content">
        {/* Input fields */}
        {actionDef.inputSchema.length > 0 && (
          <div className="config-section">
            <div className="config-section-title">Input</div>
            {actionDef.inputSchema.map(field => renderField(field))}
          </div>
        )}

        {/* Output fields (read-only) */}
        {actionDef.outputSchema.length > 0 && (
          <div className="config-section">
            <div className="config-section-title">Output</div>
            {actionDef.outputSchema.map(field => renderField(field, true))}
          </div>
        )}
      </div>
    </div>
  )
}
