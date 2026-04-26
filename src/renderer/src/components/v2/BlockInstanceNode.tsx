import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import * as Icons from 'lucide-react'
import { WorkflowNode } from '../../../../shared/v2Types'

export interface BlockInstanceNodeData extends Record<string, unknown> {
  block: WorkflowNode
  status?: 'pending' | 'running' | 'success' | 'error' | 'skipped'
  iconName?: string
}

function BlockInstanceNodeImpl(props: NodeProps) {
  const { data, selected } = props
  if (!data) {
    console.error('[BlockInstanceNode] data is missing!', props)
    return <div style={{ background: 'red', padding: 8, color: 'white' }}>NO DATA</div>
  }
  const { block, status, iconName } = data as unknown as BlockInstanceNodeData
  if (!block) {
    console.error('[BlockInstanceNode] data.block is missing!', data)
    return <div style={{ background: 'red', padding: 8, color: 'white' }}>NO BLOCK</div>
  }
  const systemType = block.systemType
  const Icon = iconName ? (Icons as Record<string, unknown>)[iconName] as React.ComponentType<{ size?: number }> | undefined : undefined

  const statusColor = (() => {
    switch (status) {
      case 'running': return '#fbbf24'
      case 'success': return '#22c55e'
      case 'error': return '#ef4444'
      case 'skipped': return '#666'
      default: return 'transparent'
    }
  })()

  return (
    <div style={{
      // Hard-coded colors thay vì var() để chắc chắn visible (CSS var có thể chưa được set)
      background: '#1f1f2e',
      border: `2px solid ${selected ? '#7c3aed' : '#3a3a4a'}`,
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 180,
      fontSize: 12,
      color: '#e0e0e0',
      position: 'relative',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
    }}>
      {/* Input handle */}
      <Handle type="target" position={Position.Top} id="default" style={{ background: '#7c3aed' }} />

      {/* Status dot */}
      {status && status !== 'pending' && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          width: 10, height: 10, borderRadius: '50%',
          background: statusColor,
          boxShadow: '0 0 4px rgba(0,0,0,0.5)'
        }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {Icon && <Icon size={14} />}
        <div style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {block.label || block.blockName}
        </div>
        {systemType && (
          <span style={{ fontSize: 9, color: '#7c3aed', background: 'rgba(124, 58, 237, 0.15)', padding: '1px 4px', borderRadius: 2 }}>
            {systemType}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: '#888' }}>{block.blockName}</div>

      {/* Output handles */}
      {systemType === 'ifElse' ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true" style={{ left: '30%', background: '#22c55e' }} title="true branch" />
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: '70%', background: '#ef4444' }} title="false branch" />
        </>
      ) : systemType === 'loop' ? (
        <>
          <Handle type="source" position={Position.Bottom} id="body" style={{ left: '30%', background: '#fbbf24' }} title="body subgraph" />
          <Handle type="source" position={Position.Bottom} id="done" style={{ left: '70%', background: '#22c55e' }} title="after loop" />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} id="default" style={{ background: '#7c3aed' }} />
      )}
    </div>
  )
}

export default memo(BlockInstanceNodeImpl)
