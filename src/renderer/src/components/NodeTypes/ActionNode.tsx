import { memo } from 'react'
import { Handle, Position, NodeProps, Node } from '@xyflow/react'
import { FlowNodeData } from '../../../../shared/types'
import * as LucideIcons from 'lucide-react'

type ActionNodeType = Node<FlowNodeData>

function ActionNode({ data, selected }: NodeProps<ActionNodeType>) {
  const IconComponent = (LucideIcons as any)[data.icon] as React.FC<{ size?: number }>

  const statusClass = data.status || ''
  const selectedClass = selected ? 'selected' : ''
  const isLoop = data.actionType === 'loop'

  // Show key config values in node body
  const configEntries = Object.entries(data.config || {}).slice(0, 3)

  return (
    <div className={`flow-node ${statusClass} ${selectedClass} ${isLoop ? 'loop-node' : ''}`}>
      <Handle
        type="target"
        position={Position.Top}
        id="input"
      />

      <div className="flow-node-header">
        <div className={`flow-node-icon ${data.category}`}>
          {IconComponent && <IconComponent size={16} />}
        </div>
        <div>
          <div className="flow-node-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {data.label}
            {data.actionType === 'block' && (
              <span style={{ 
                fontSize: 8, 
                background: 'var(--accent-primary)', 
                color: 'white', 
                padding: '1px 4px', 
                borderRadius: 3,
                fontWeight: 700
              }}>BLOCK</span>
            )}
          </div>
          <div className="flow-node-subtitle">{data.category}</div>
        </div>
      </div>

      {configEntries.length > 0 && (
        <div className="flow-node-body">
          {configEntries.map(([key, value]) => (
            <div key={key} className="flow-node-field">
              <span className="flow-node-field-label">{key}</span>
              <span className="flow-node-field-value">
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.status && data.status !== 'idle' && (
        <div className="flow-node-status">
          <span className={`status-dot ${data.status}`} />
          <span>
            {data.status === 'running' && 'Running...'}
            {data.status === 'success' && 'Completed'}
            {data.status === 'error' && (data.error || 'Error')}
          </span>
        </div>
      )}

      {isLoop ? (
        <>
          <div className="loop-handle-labels">
            <span className="loop-handle-label-text">BODY</span>
            <span className="loop-handle-label-text">DONE</span>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            id="loop-body"
            className="loop-handle-body"
            style={{ left: '30%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="loop-done"
            className="loop-handle-done"
            style={{ left: '70%' }}
          />
        </>
      ) : data.actionType === 'ifElse' ? (
        <>
          <div className="loop-handle-labels">
            <span className="loop-handle-label-text" style={{ color: 'var(--color-success)' }}>TRUE</span>
            <span className="loop-handle-label-text" style={{ color: 'var(--color-error, #e74c3c)' }}>FALSE</span>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            id="if-true"
            className="loop-handle-body"
            style={{ left: '30%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="if-false"
            className="loop-handle-done"
            style={{ left: '70%' }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          id="output"
        />
      )}
    </div>
  )
}

export default memo(ActionNode)
