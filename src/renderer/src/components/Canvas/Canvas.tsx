import { useCallback, useRef, DragEvent, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import ActionNode from '../NodeTypes/ActionNode'
import { useFlowStore } from '../../stores/flowStore'
import { ActionDefinition, FlowNodeData, FlowData, ActionIOField } from '../../../../shared/types'

const nodeTypes = {
  actionNode: ActionNode
}

function FlowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    selectNode
  } = useFlowStore()

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })

      // 1. Handle Block Drop
      const blockStr = event.dataTransfer.getData('application/akabiz-block')
      if (blockStr) {
        try {
          const block: FlowData = JSON.parse(blockStr)
          const inputSchema = block.inputSchema || []
          
          const nodeData: FlowNodeData = {
            actionType: 'block',
            label: block.name,
            icon: 'Package',
            category: 'block',
            config: inputSchema.reduce((acc: Record<string, unknown>, field: ActionIOField) => {
              if (field.defaultValue !== undefined) acc[field.name] = field.defaultValue
              return acc
            }, { blockId: block.id } as Record<string, unknown>),
            blockData: {
              id: block.id,
              name: block.name,
              inputSchema: inputSchema,
              outputSchema: block.outputSchema || []
            },
            inputMapping: {},
            status: 'idle'
          }
          addNode(nodeData, position)
          return
        } catch (err) {
          console.error('Failed to parse block data:', err)
        }
      }

      // 2. Handle Action Drop
      const actionStr = event.dataTransfer.getData('application/akabiz-action')
      if (actionStr) {
        try {
          const action: ActionDefinition = JSON.parse(actionStr)

          const nodeData: FlowNodeData = {
            actionType: action.type,
            label: action.name,
            icon: action.icon,
            category: action.category,
            config: action.inputSchema.reduce((acc: Record<string, unknown>, field: ActionIOField) => {
              if (field.defaultValue !== undefined) {
                acc[field.name] = field.defaultValue
              }
              return acc
            }, {} as Record<string, unknown>),
            inputMapping: {},
            status: 'idle'
          }

          addNode(nodeData, position)
        } catch (err) {
          console.error('Failed to parse action data:', err)
        }
      }
    },
    [screenToFlowPosition, addNode]
  )

  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => {
    selectNode(node.id)
  }, [selectNode])

  const onPaneClick = useCallback(() => {
    selectNode(null)
  }, [selectNode])

  const minimapNodeColor = useCallback((node: { data?: { category?: string } }) => {
    const colors: Record<string, string> = {
      navigation: '#38bdf8',
      interaction: '#a78bfa',
      data: '#34d399',
      control: '#fbbf24',
      utility: '#fb923c'
    }
    return colors[node.data?.category || ''] || '#6b6b82'
  }, [])

  return (
    <div className="canvas-wrapper" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: { strokeWidth: 2 }
        }}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'var(--bg-primary)' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--border-default)"
        />
        <Controls
          showInteractive={false}
          position="bottom-right"
        />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(10, 10, 15, 0.7)"
          position="bottom-left"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}

export default function CanvasWrapper() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  )
}
