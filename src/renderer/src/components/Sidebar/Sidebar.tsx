import { useState, useMemo, DragEvent, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { Search, Plus, Trash2 } from 'lucide-react'
import { builtinActions } from '../../../../shared/actions'
import { ActionDefinition, ActionCategory, ElementDefinition, FlowData } from '../../../../shared/types'
import { useElementStore } from '../../stores/elementStore'
import { useBlockStore } from '../../stores/blockStore'
import { useUiStore } from '../../stores/uiStore'

const categoryOrder: ActionCategory[] = ['navigation', 'interaction', 'data', 'utility', 'control', 'block']

const categoryLabels: Record<ActionCategory, string> = {
  navigation: 'Navigation',
  interaction: 'Interaction',
  data: 'Data',
  control: 'Control Flow',
  utility: 'Utility',
  block: 'Block System'
}

interface SidebarProps {
  onEditBlock?: (block: FlowData) => void
  onDeleteFlow?: (flowId: string) => void
}

export default function Sidebar({ onEditBlock, onDeleteFlow }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'actions' | 'elements' | 'blocks'>('actions')
  const [search, setSearch] = useState('')
  const { elements, loadElements, deleteElement } = useElementStore()
  const { blocks, loadBlocks } = useBlockStore()

  useEffect(() => {
    if (activeTab === 'elements') {
      loadElements()
    } else if (activeTab === 'blocks') {
      loadBlocks()
    }
  }, [activeTab, loadElements, loadBlocks])

  // Actions filtering
  const filteredActions = useMemo(() => {
    if (!search.trim()) return builtinActions
    const q = search.toLowerCase()
    return builtinActions.filter(
      a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
    )
  }, [search])

  const groupedActions = useMemo(() => {
    const map = new Map<ActionCategory, ActionDefinition[]>()
    for (const cat of categoryOrder) {
      const items = filteredActions.filter(a => a.category === cat)
      if (items.length > 0) map.set(cat, items)
    }
    return map
  }, [filteredActions])

  // Elements filtering
  const filteredElements = useMemo(() => {
    if (!search.trim()) return elements
    const q = search.toLowerCase()
    return elements.filter(
      e => e.name.toLowerCase().includes(q) || (e.description?.toLowerCase() || '').includes(q)
    )
  }, [search, elements])

  const onDragStartAction = (event: DragEvent, action: ActionDefinition) => {
    event.dataTransfer.setData('application/akabiz-action', JSON.stringify(action))
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragStartElement = (event: DragEvent, element: ElementDefinition) => {
    event.dataTransfer.setData('application/akabiz-element', JSON.stringify(element))
    event.dataTransfer.effectAllowed = 'move'
  }

  const filteredBlocks = useMemo(() => {
    if (!search.trim()) return blocks
    const q = search.toLowerCase()
    return blocks.filter(
      (b: FlowData) => b.name.toLowerCase().includes(q) || (b.description?.toLowerCase() || '').includes(q)
    )
  }, [search, blocks])

  const onDragStartBlock = (event: DragEvent, block: any) => {
    event.dataTransfer.setData('application/akabiz-block', JSON.stringify(block))
    event.dataTransfer.effectAllowed = 'move'
  }

  const [isCreatingElement, setIsCreatingElement] = useState(false)
  const [newElementName, setNewElementName] = useState('')
  const [newElementXPath, setNewElementXPath] = useState('')
  const { saveElement } = useElementStore()

  const handleCreateElement = async () => {
    if (!newElementName.trim() || !newElementXPath.trim()) return
    try {
      await saveElement({ 
        id: crypto.randomUUID(), 
        name: newElementName.trim(), 
        xpath: newElementXPath.trim() 
      })
      setIsCreatingElement(false)
      setNewElementName('')
      setNewElementXPath('')
    } catch (err) {
      console.error('Failed to create element', err)
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button 
          className={`sidebar-tab ${activeTab === 'actions' ? 'active' : ''}`}
          onClick={() => setActiveTab('actions')}
        >
          Actions
        </button>
        <button 
          className={`sidebar-tab ${activeTab === 'elements' ? 'active' : ''}`}
          onClick={() => setActiveTab('elements')}
        >
          Elements
        </button>
        <button 
          className={`sidebar-tab ${activeTab === 'blocks' ? 'active' : ''}`}
          onClick={() => setActiveTab('blocks')}
        >
          Blocks
        </button>
      </div>

      <div className="sidebar-header">
        <div style={{ position: 'relative', flex: 1, display: 'flex', gap: 6 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              className="sidebar-search"
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 30, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          {activeTab === 'elements' && (
            <button className="btn btn-primary btn-icon" onClick={() => setIsCreatingElement(true)} title="Add Element">
              <Plus size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-content">
        {activeTab === 'actions' && (
          <>
            {Array.from(groupedActions.entries()).map(([category, actions]) => (
              <div key={category} className="sidebar-category">
                <div className="sidebar-category-title">{categoryLabels[category]}</div>
                {actions.map(action => {
                  const IconComponent = (LucideIcons as any)[action.icon] as React.FC<{ size?: number }>
                  return (
                    <div key={action.id} className="action-card" draggable onDragStart={(e) => onDragStartAction(e, action)}>
                      <div className={`action-card-icon ${action.category}`}>
                        {IconComponent && <IconComponent size={15} />}
                      </div>
                      <div className="action-card-info">
                        <div className="action-card-name">{action.name}</div>
                        <div className="action-card-desc">{action.description}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {groupedActions.size === 0 && <div className="empty-state"><div className="empty-state-text">No actions found</div></div>}
          </>
        )}

        {activeTab === 'elements' && (
          <div className="sidebar-category">
            {isCreatingElement && (
              <div className="action-card" style={{ flexDirection: 'column', gap: 8, padding: 12, marginBottom: 12, cursor: 'default' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>New Element</div>
                <input 
                  type="text" 
                  placeholder="Element Name (e.g. Login Button)" 
                  value={newElementName}
                  onChange={e => setNewElementName(e.target.value)}
                  className="sidebar-search"
                />
                <input 
                  type="text" 
                  placeholder="XPath or Selector" 
                  value={newElementXPath}
                  onChange={e => setNewElementXPath(e.target.value)}
                  className="sidebar-search"
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}>
                  <button className="btn btn-ghost" onClick={() => setIsCreatingElement(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleCreateElement}>Save</button>
                </div>
              </div>
            )}
            
            <div className="sidebar-category-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Saved Elements</span>
            </div>
            {filteredElements.map(element => (
              <div key={element.id} className="action-card element-card" draggable onDragStart={(e) => onDragStartElement(e, element)}>
                <div className="action-card-icon data">
                  <LucideIcons.BoxSelect size={15} />
                </div>
                <div className="action-card-info" style={{ flex: 1 }}>
                  <div className="action-card-name">{element.name}</div>
                  <div className="action-card-desc">{element.xpath}</div>
                </div>
                <button 
                  className="btn-icon" 
                  style={{ opacity: 0.5, padding: 4 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    useUiStore.getState().showConfirm(
                      `Xoá element "${element.name}"?`,
                      () => deleteElement(element.id),
                      { title: 'Xoá element', confirmText: 'Xoá', variant: 'danger' }
                    )
                  }}
                  title="Delete element"
                >
                  <Trash2 size={12} color="var(--danger)" />
                </button>
              </div>
            ))}
            {filteredElements.length === 0 && !isCreatingElement && <div className="empty-state"><div className="empty-state-text">No elements found</div></div>}
          </div>
        )}

        {activeTab === 'blocks' && (
          <div className="sidebar-category">
            {/* Workflows Section */}
            <div className="sidebar-category-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Workflows</span>
            </div>
            {filteredBlocks.filter((b: FlowData) => !b.isBlock).length === 0 ? (
              <div className="empty-state" style={{ padding: '12px 0' }}><div className="empty-state-text">No workflows</div></div>
            ) : (
              filteredBlocks.filter((b: FlowData) => !b.isBlock).map(flow => (
                <div key={flow.id} className="action-card element-card" onClick={() => onEditBlock?.(flow)} style={{ cursor: 'pointer' }}>
                  <div className="action-card-icon navigation">
                    <LucideIcons.Workflow size={15} />
                  </div>
                  <div className="action-card-info" style={{ flex: 1 }}>
                    <div className="action-card-name">{flow.name}</div>
                    <div className="action-card-desc">{flow.description || `${flow.nodes.length} nodes`}</div>
                  </div>
                  <button 
                    className="btn-icon" 
                    style={{ opacity: 0.5, padding: 4 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditBlock?.(flow)
                    }}
                    title="Open workflow"
                  >
                    <LucideIcons.ExternalLink size={12} />
                  </button>
                  <button 
                    className="btn-icon" 
                    style={{ opacity: 0.5, padding: 4 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      useUiStore.getState().showConfirm(
                        `Xoá workflow "${flow.name}"?`,
                        () => onDeleteFlow?.(flow.id),
                        { title: 'Xoá workflow', confirmText: 'Xoá', variant: 'danger' }
                      )
                    }}
                    title="Delete workflow"
                  >
                    <Trash2 size={12} color="var(--danger)" />
                  </button>
                </div>
              ))
            )}

            {/* Blocks Section */}
            <div className="sidebar-category-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span>Reusable Blocks</span>
            </div>
            {filteredBlocks.filter((b: FlowData) => b.isBlock).length === 0 ? (
              <div className="empty-state" style={{ padding: '12px 0' }}><div className="empty-state-text">No blocks</div></div>
            ) : (
              filteredBlocks.filter((b: FlowData) => b.isBlock).map(block => (
                <div key={block.id} className="action-card element-card" draggable onDragStart={(e) => onDragStartBlock(e, block)}>
                  <div className="action-card-icon block">
                    <LucideIcons.Package size={15} />
                  </div>
                  <div className="action-card-info" style={{ flex: 1 }}>
                    <div className="action-card-name">{block.name}</div>
                    <div className="action-card-desc">{block.description || `${block.nodes.length} nodes`}</div>
                  </div>
                  <button 
                    className="btn-icon" 
                    style={{ opacity: 0.5, padding: 4 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditBlock?.(block)
                    }}
                    title="Edit block flow"
                  >
                    <LucideIcons.Edit3 size={12} />
                  </button>
                  <button 
                    className="btn-icon" 
                    style={{ opacity: 0.5, padding: 4 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      useUiStore.getState().showConfirm(
                        `Xoá block "${block.name}"?`,
                        () => onDeleteFlow?.(block.id),
                        { title: 'Xoá block', confirmText: 'Xoá', variant: 'danger' }
                      )
                    }}
                    title="Delete block"
                  >
                    <Trash2 size={12} color="var(--danger)" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
