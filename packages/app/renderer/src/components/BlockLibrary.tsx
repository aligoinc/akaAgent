import { useEffect, useState, useMemo } from 'react'
import type { BlockManifest } from '@akabiz/engine'

interface Props {
  onAdd: (manifest: BlockManifest) => void
}

export function BlockLibrary({ onAdd }: Props): JSX.Element {
  const [blocks, setBlocks] = useState<BlockManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    window.akabiz.blocks.list()
      .then(b => setBlocks(b ?? []))
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => {
    const filtered = blocks.filter(b => {
      const q = search.toLowerCase()
      return !q ||
        b.manifestId.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        b.ui.category.toLowerCase().includes(q)
    })
    const map = new Map<string, BlockManifest[]>()
    for (const b of filtered) {
      const cat = b.ui.category ?? 'misc'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(b)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [blocks, search])

  const toggleCategory = (cat: string): void => {
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))
  }

  const handleDragStart = (e: React.DragEvent, manifest: BlockManifest): void => {
    e.dataTransfer.setData('application/akabiz-block', JSON.stringify(manifest))
    e.dataTransfer.effectAllowed = 'move'
  }

  if (loading) return <div style={{ padding: 12, color: '#888' }}>Loading blocks…</div>

  return (
    <div style={{ padding: 8, height: '100%', overflow: 'auto' }}>
      <input
        type="text"
        placeholder="Search blocks…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
        Drag block vào canvas hoặc click để add
      </div>
      {grouped.map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 8 }}>
          <div
            onClick={() => toggleCategory(cat)}
            style={{
              cursor: 'pointer', padding: '4px 6px', background: '#0f1115',
              borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              color: '#888', display: 'flex', justifyContent: 'space-between'
            }}
          >
            <span>{cat} ({items.length})</span>
            <span>{collapsed[cat] ? '▶' : '▼'}</span>
          </div>
          {!collapsed[cat] && (
            <div>
              {items.map(b => (
                <div
                  key={b.manifestId}
                  draggable
                  onDragStart={(e) => handleDragStart(e, b)}
                  onClick={() => onAdd(b)}
                  title={b.ui.description}
                  style={{
                    padding: '6px 8px',
                    margin: '2px 0',
                    background: '#1a1f2c',
                    borderRadius: 4,
                    cursor: 'grab',
                    fontSize: 12,
                    border: '1px solid transparent'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#4f46e5')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                >
                  <div style={{ fontWeight: 500 }}>{b.name}</div>
                  <div style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
                    {b.manifestId} · {b.runtime}{b.requires === 'browser' ? ' · 🌐' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
