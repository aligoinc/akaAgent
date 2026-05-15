import { useEffect, useMemo, useState, DragEvent } from 'react'
import { useBlockLibraryStore } from '../../stores/blockLibraryStore'
import { useWorkflowV2Store } from '../../stores/workflowV2Store'
import { BlockDef } from '../../../../shared/v2Types'
import * as Icons from 'lucide-react'

type Tab = 'all' | 'system' | 'builtin' | 'custom'

interface Props {
  onOpenBlockEditor: (block: BlockDef | null) => void
  onOpenWorkflowList: () => void
  onNewWorkflow: () => void
}

export default function BlockLibraryPanel({ onOpenBlockEditor, onOpenWorkflowList, onNewWorkflow }: Props) {
  const { blocks, loading, loadBlocks } = useBlockLibraryStore()
  const { current: workflow } = useWorkflowV2Store()
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadBlocks()
  }, [loadBlocks])

  const filtered = useMemo(() => {
    return blocks
      .filter(b => {
        if (tab === 'system') return b.kind === 'system'
        if (tab === 'builtin') return b.isBuiltin && b.kind === 'js'
        if (tab === 'custom') return !b.isBuiltin
        return true
      })
      .filter(b => {
        if (!search.trim()) return true
        const q = search.toLowerCase()
        return b.name.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q)
      })
  }, [blocks, tab, search])

  const grouped = useMemo(() => {
    const map = new Map<string, BlockDef[]>()
    for (const b of filtered) {
      const arr = map.get(b.category) ?? []
      arr.push(b)
      map.set(b.category, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const onDragStart = (event: DragEvent, block: BlockDef) => {
    event.dataTransfer.setData('application/x-v2-block', JSON.stringify(block))
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div style={{
      width: 280, minWidth: 280,
      borderRight: '1px solid var(--border, #2a2a35)',
      background: 'var(--bg-secondary, #16161e)',
      display: 'flex', flexDirection: 'column', height: '100%'
    }}>
      {/* Header */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--border, #2a2a35)' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button className="btn btn-sm" style={{ flex: 1 }} onClick={onNewWorkflow}>+ Workflow mới</button>
          <button className="btn btn-sm btn-ghost" onClick={onOpenWorkflowList} title="Mở workflow đã có">
            <Icons.FolderOpen size={13} />
          </button>
          <button className="btn btn-sm btn-ghost" onClick={loadBlocks} title="Reload danh sách block">
            <Icons.RefreshCw size={13} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #999)' }}>
          {workflow ? `Đang sửa: ${workflow.name}` : 'Chưa chọn workflow'}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #2a2a35)' }}>
        {([
          { key: 'all', label: 'Tất cả' },
          { key: 'system', label: 'System' },
          { key: 'builtin', label: 'Built-in' },
          { key: 'custom', label: 'Custom' }
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '8px 4px', fontSize: 11,
              background: tab === t.key ? 'var(--bg-primary, #0e0e15)' : 'transparent',
              color: tab === t.key ? 'var(--accent, #7c3aed)' : 'var(--text-secondary, #999)',
              border: 'none', borderBottom: tab === t.key ? '2px solid var(--accent, #7c3aed)' : 'none',
              cursor: 'pointer'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: 8 }}>
        <input
          type="text"
          placeholder="Tìm block..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '6px 8px', fontSize: 12,
            background: 'var(--bg-primary, #0e0e15)',
            border: '1px solid var(--border, #2a2a35)', borderRadius: 4,
            color: 'var(--text, #e0e0e0)'
          }}
        />
      </div>

      {/* Block list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading && <div style={{ color: '#999', fontSize: 12 }}>Đang tải...</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 20 }}>
            Không có block nào.
          </div>
        )}
        {grouped.map(([category, items]) => (
          <div key={category} style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 11, textTransform: 'uppercase', color: '#666',
              padding: '4px 8px', letterSpacing: 0.5
            }}>{category}</div>
            {items.map(b => (
              <div
                key={b.id}
                draggable
                onDragStart={(e) => onDragStart(e, b)}
                onDoubleClick={() => onOpenBlockEditor(b)}
                title={b.description}
                style={{
                  padding: '6px 8px', fontSize: 12,
                  background: 'var(--bg-primary, #0e0e15)',
                  border: '1px solid var(--border, #2a2a35)', borderRadius: 4,
                  marginBottom: 4, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 6
                }}
              >
                <BlockIcon name={b.icon} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: 'var(--text, #e0e0e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                  {b.description && (
                    <div style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.description}
                    </div>
                  )}
                </div>
                {!b.isBuiltin && (
                  <span style={{ fontSize: 9, color: '#7c3aed', background: 'rgba(124, 58, 237, 0.1)', padding: '1px 4px', borderRadius: 2 }}>custom</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: 8, borderTop: '1px solid var(--border, #2a2a35)' }}>
        <button className="btn btn-sm btn-ghost" style={{ width: '100%' }} onClick={() => onOpenBlockEditor(null)}>
          + Tạo block custom
        </button>
      </div>
    </div>
  )
}

function BlockIcon({ name }: { name?: string }) {
  if (!name) return <span style={{ width: 14, height: 14 }} />
  const Icon = (Icons as Record<string, unknown>)[name] as React.ComponentType<{ size?: number }> | undefined
  if (!Icon) return <span style={{ width: 14, height: 14 }} />
  return <Icon size={14} />
}
