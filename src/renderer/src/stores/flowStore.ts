import { create } from 'zustand'
import {
  Node,
  Edge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange
} from '@xyflow/react'
import { FlowNodeData, FlowData } from '../../../shared/types'
import { v4 as uuidv4 } from 'uuid'

interface FlowState {
  // Flow data
  flowId: string
  flowName: string
  isBlock: boolean
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
  selectedNodeId: string | null

  // Node CRUD
  setNodes: (nodes: Node<FlowNodeData>[]) => void
  setEdges: (edges: Edge[]) => void
  onNodesChange: (changes: NodeChange<Node<FlowNodeData>>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  addNode: (data: FlowNodeData, position: { x: number; y: number }) => void
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void
  updateInputMapping: (nodeId: string, fieldName: string, mapping: { sourceNodeId: string, sourceField: string, sourcePath?: string } | null) => void
  removeNode: (nodeId: string) => void
  selectNode: (nodeId: string | null) => void

  // Flow management
  setFlowName: (name: string) => void
  setIsBlock: (isBlock: boolean) => void
  loadFlow: (flow: FlowData) => void
  getFlowData: () => FlowData
  resetFlow: () => void

  // Execution state updates
  setNodeStatus: (nodeId: string, status: FlowNodeData['status'], output?: Record<string, unknown>, error?: string) => void
  clearAllStatus: () => void
}

export const useFlowStore = create<FlowState>((set, get) => ({
  flowId: uuidv4(),
  flowName: 'Untitled Flow',
  isBlock: false,
  nodes: [],
  edges: [],
  selectedNodeId: null,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },

  onConnect: (connection) => {
    set({ edges: addEdge({ ...connection, type: 'smoothstep', animated: true }, get().edges) })
  },

  addNode: (data, position) => {
    const newNode: Node<FlowNodeData> = {
      id: uuidv4(),
      type: 'actionNode',
      position,
      data
    }
    set({ nodes: [...get().nodes, newNode] })
  },

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map(node =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      )
    })
  },
  
  updateInputMapping: (nodeId, fieldName, mapping) => {
    set({
      nodes: get().nodes.map(node => {
        if (node.id !== nodeId) return node
        const newMapping = { ...(node.data.inputMapping || {}) }
        if (mapping === null) {
          delete newMapping[fieldName]
        } else {
          newMapping[fieldName] = mapping
        }
        return {
          ...node,
          data: { ...node.data, inputMapping: newMapping }
        }
      })
    })
  },

  removeNode: (nodeId) => {
    set({
      nodes: get().nodes.filter(n => n.id !== nodeId),
      edges: get().edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId
    })
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setFlowName: (name) => set({ flowName: name }),
  setIsBlock: (isBlock) => set({ isBlock }),

  loadFlow: (flow) => {
    set({
      flowId: flow.id,
      flowName: flow.name,
      isBlock: flow.isBlock || false,
      nodes: flow.nodes.map(n => ({
        ...n,
        type: n.type || 'actionNode',
        data: { ...n.data, status: 'idle', output: undefined, error: undefined }
      })) as Node<FlowNodeData>[],
      edges: flow.edges as Edge[],
      selectedNodeId: null
    })
  },

  getFlowData: (): FlowData => {
    const state = get()
    return {
      id: state.flowId,
      name: state.flowName,
      isBlock: state.isBlock,
      nodes: state.nodes.map(n => ({
        id: n.id,
        type: n.type || 'actionNode',
        position: n.position,
        data: n.data
      })),
      edges: state.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined
      }))
    }
  },

  resetFlow: () => {
    set({
      flowId: uuidv4(),
      flowName: 'Untitled Flow',
      isBlock: false,
      nodes: [],
      edges: [],
      selectedNodeId: null
    })
  },

  setNodeStatus: (nodeId, status, output, error) => {
    set({
      nodes: get().nodes.map(node =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, status, output, error } }
          : node
      )
    })
  },

  clearAllStatus: () => {
    set({
      nodes: get().nodes.map(node => ({
        ...node,
        data: { ...node.data, status: 'idle', output: undefined, error: undefined }
      }))
    })
  }
}))
