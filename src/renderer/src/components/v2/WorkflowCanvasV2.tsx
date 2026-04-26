import { useCallback, useEffect, useRef, DragEvent } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
  ReactFlowProvider, useReactFlow, Node, Edge,
  useNodesState, useEdgesState, Connection
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import BlockInstanceNode, { BlockInstanceNodeData } from './BlockInstanceNode'
import { useWorkflowV2Store } from '../../stores/workflowV2Store'
import { useBlockLibraryStore } from '../../stores/blockLibraryStore'
import { BlockDef, WorkflowNode, WorkflowEdge } from '../../../../shared/v2Types'

const nodeTypes = { blockInstance: BlockInstanceNode }

function CanvasInner() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const {
    current: workflow,
    upsertNode, removeNode, upsertEdge, removeEdge, setNodes: storeSetNodes,
    selectNode, selectedNodeId,
    testStatusByNode
  } = useWorkflowV2Store()
  const { getById } = useBlockLibraryStore()

  // Local RF state — đồng bộ từ store khi workflow đổi, sync ngược về store ở user actions
  const [nodes, setNodes, onNodesChangeRF] = useNodesState<Node<BlockInstanceNodeData>>([])
  const [edges, setEdges, onEdgesChangeRF] = useEdgesState<Edge>([])

  // Sync STORE → LOCAL khi workflow đổi (load workflow khác / load lần đầu)
  useEffect(() => {
    if (!workflow) {
      setNodes([])
      setEdges([])
      return
    }
    console.log('[v2 canvas] loading workflow:', workflow.name, workflow.nodes.length, 'nodes')
    const newNodes: Node<BlockInstanceNodeData>[] = workflow.nodes.map(n => {
      const blockDef = getById(n.blockId)
      const status = testStatusByNode.get(n.id)?.status
      return {
        id: n.id,
        type: 'blockInstance',
        position: n.position,
        selected: n.id === selectedNodeId,
        data: { block: n, status, iconName: blockDef?.icon }
      }
    })
    const newEdges: Edge[] = workflow.edges.map(e => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? 'default',
      targetHandle: e.targetHandle ?? 'default',
      label: e.label,
      animated: false,
      style: {
        stroke: e.sourceHandle === 'true' ? '#22c55e'
          : e.sourceHandle === 'false' ? '#ef4444'
          : e.sourceHandle === 'body' ? '#fbbf24'
          : '#666'
      }
    }))
    setNodes(newNodes)
    setEdges(newEdges)
    // fit view sau khi load
    setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.id])

  // Update node statuses khi test running (mà không reset nodes hoặc layout)
  useEffect(() => {
    setNodes(curr => curr.map(n => {
      const status = testStatusByNode.get(n.id)?.status
      if (n.data.status === status) return n
      return { ...n, data: { ...n.data, status } }
    }))
  }, [testStatusByNode, setNodes])

  // Update selection visual khi selectedNodeId đổi từ ngoài
  useEffect(() => {
    setNodes(curr => curr.map(n => ({ ...n, selected: n.id === selectedNodeId })))
  }, [selectedNodeId, setNodes])

  const onNodesChange = useCallback((changes: any[]) => {
    // Cho ReactFlow apply changes vào local state (cần cho dimensions, drag preview, select)
    onNodesChangeRF(changes)
    // Chỉ sync ngược về store cho changes "có ý nghĩa với user" — KHÔNG bao gồm
    // dimensions (RF tự đo) hay select (xử lý dưới qua onSelect).
    for (const c of changes) {
      if (c.type === 'remove') {
        removeNode(c.id)
      } else if (c.type === 'position' && c.dragging === false && c.position) {
        // Khi user drag-end → persist position về store
        upsertNodePosition(c.id, c.position)
      } else if (c.type === 'select') {
        if (c.selected) selectNode(c.id)
      }
    }
  }, [onNodesChangeRF, removeNode, selectNode])

  // Helper: cập nhật position của 1 node trong workflow.nodes (store)
  const upsertNodePosition = (nodeId: string, position: { x: number; y: number }) => {
    const cur = useWorkflowV2Store.getState().current
    if (!cur) return
    const idx = cur.nodes.findIndex(n => n.id === nodeId)
    if (idx < 0) return
    const updated = [...cur.nodes]
    updated[idx] = { ...updated[idx], position }
    storeSetNodes(updated)
  }

  const onEdgesChange = useCallback((changes: any[]) => {
    onEdgesChangeRF(changes)
    for (const c of changes) {
      if (c.type === 'remove') removeEdge(c.id)
    }
  }, [onEdgesChangeRF, removeEdge])

  const onConnect = useCallback((connection: Connection) => {
    if (!workflow) return
    if (!connection.source || !connection.target) return
    if (connection.source === connection.target) return
    const newEdge: WorkflowEdge = {
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle === 'default' ? undefined : (connection.sourceHandle ?? undefined),
      targetHandle: connection.targetHandle === 'default' ? undefined : (connection.targetHandle ?? undefined)
    }
    upsertEdge(newEdge)
    // Optimistic: thêm vào local state ngay
    setEdges(curr => [...curr, {
      id: newEdge.id, source: newEdge.source, target: newEdge.target,
      sourceHandle: newEdge.sourceHandle ?? 'default', targetHandle: newEdge.targetHandle ?? 'default'
    }])
  }, [workflow, upsertEdge, setEdges])

  const onPaneClick = useCallback(() => {
    selectNode(null)
  }, [selectNode])

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    if (!workflow) return
    const blockStr = event.dataTransfer.getData('application/x-v2-block')
    if (!blockStr) return
    let block: BlockDef
    try { block = JSON.parse(blockStr) } catch { return }

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const newNode: WorkflowNode = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      blockId: block.id,
      blockName: block.name,
      position,
      config: { ...(block.defaultConfig ?? {}) },
      label: block.name,
      systemType: block.systemType
    }
    upsertNode(newNode)
    // Optimistic add to local
    setNodes(curr => [...curr, {
      id: newNode.id,
      type: 'blockInstance',
      position: newNode.position,
      data: { block: newNode, status: undefined, iconName: block.icon }
    }])
  }, [workflow, screenToFlowPosition, upsertNode, setNodes])

  // Listen DEL key to remove selected
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedNodeId) {
        removeNode(selectedNodeId)
        setNodes(curr => curr.filter(n => n.id !== selectedNodeId))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedNodeId, removeNode, setNodes])

  if (!workflow) {
    return (
      <div ref={wrapperRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
        Chọn 1 workflow ở sidebar hoặc tạo mới để bắt đầu.
      </div>
    )
  }

  return (
    <div ref={wrapperRef} style={{ flex: 1, position: 'relative', minHeight: 0, width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap zoomable pannable />
      </ReactFlow>
    </div>
  )
}

export default function WorkflowCanvasV2() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
