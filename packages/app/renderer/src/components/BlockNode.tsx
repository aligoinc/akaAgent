import { Handle, Position, type NodeProps } from '@xyflow/react'

export interface BlockNodeData extends Record<string, unknown> {
  manifestId: string
  label?: string
  category?: string
  requires?: 'browser' | 'none'
  status?: 'idle' | 'running' | 'success' | 'error'
}

const STATUS_COLORS = {
  idle: '#3a4256',
  running: '#3b82f6',
  success: '#10b981',
  error: '#ef4444'
}

const CATEGORY_COLORS: Record<string, string> = {
  workflow: '#8b5cf6',
  control: '#f59e0b',
  data: '#06b6d4',
  io: '#10b981',
  browser: '#ec4899',
  datatable: '#6366f1',
  custom: '#a855f7'
}

export function BlockNode(props: NodeProps): JSX.Element {
  const data = props.data as BlockNodeData
  const isControl = data.manifestId === 'core.if' || data.manifestId === 'core.switch' || data.manifestId === 'core.loop' || data.manifestId === 'core.try'
  const isInput = data.manifestId === 'core.input'
  const isOutput = data.manifestId === 'core.output'
  const categoryColor = CATEGORY_COLORS[data.category ?? 'misc'] ?? '#6b7280'
  const borderColor = props.selected ? '#4f46e5' : (data.status ? STATUS_COLORS[data.status] : '#3a4256')

  return (
    <div style={{
      background: '#1a1f2c',
      border: `2px solid ${borderColor}`,
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 180,
      fontSize: 12,
      boxShadow: props.selected ? '0 0 0 3px rgba(79,70,229,0.2)' : 'none'
    }}>
      {!isInput && (
        <Handle type="target" position={Position.Top} style={{ background: '#3a4256' }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: categoryColor, flexShrink: 0
        }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8' }}>
          {data.label ?? data.manifestId}
        </span>
        {data.requires === 'browser' && <span style={{ fontSize: 10 }}>🌐</span>}
      </div>
      <div style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>
        {data.manifestId}
      </div>

      {/* Multiple bottom handles for control flow blocks */}
      {data.manifestId === 'core.if' && (
        <>
          <Handle id="if-true" type="source" position={Position.Bottom} style={{ left: '30%', background: '#10b981' }} />
          <Handle id="if-false" type="source" position={Position.Bottom} style={{ left: '70%', background: '#ef4444' }} />
        </>
      )}
      {data.manifestId === 'core.loop' && (
        <>
          <Handle id="loop-body" type="source" position={Position.Bottom} style={{ left: '30%', background: '#f59e0b' }} />
          <Handle id="loop-done" type="source" position={Position.Bottom} style={{ left: '70%', background: '#10b981' }} />
        </>
      )}
      {data.manifestId === 'core.try' && (
        <>
          <Handle id="try-body" type="source" position={Position.Bottom} style={{ left: '20%', background: '#3b82f6' }} />
          <Handle id="try" type="source" position={Position.Bottom} style={{ left: '50%', background: '#10b981' }} />
          <Handle id="catch" type="source" position={Position.Bottom} style={{ left: '80%', background: '#ef4444' }} />
        </>
      )}
      {!isOutput && !isControl && (
        <Handle type="source" position={Position.Bottom} style={{ background: '#3a4256' }} />
      )}
    </div>
  )
}
