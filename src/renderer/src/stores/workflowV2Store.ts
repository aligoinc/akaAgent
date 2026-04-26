import { create } from 'zustand'
import { WorkflowDef, WorkflowNode, WorkflowEdge, RunStepV2 } from '../../../shared/v2Types'

interface WorkflowV2State {
  workflows: WorkflowDef[]
  current: WorkflowDef | null
  selectedNodeId: string | null
  // Test run state
  isTesting: boolean
  testRunKey: string | null
  testStatusByNode: Map<string, RunStepV2>
  testLogs: { nodeId: string; line: string; ts: number }[]

  loadWorkflows: () => Promise<void>
  loadWorkflow: (id: number) => Promise<void>
  newWorkflow: (name?: string) => void
  saveCurrent: (name?: string) => Promise<void>

  // Canvas operations
  setNodes: (nodes: WorkflowNode[]) => void
  setEdges: (edges: WorkflowEdge[]) => void
  upsertNode: (node: WorkflowNode) => void
  removeNode: (nodeId: string) => void
  upsertEdge: (edge: WorkflowEdge) => void
  removeEdge: (edgeId: string) => void
  selectNode: (id: string | null) => void
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
  updateNodeCodeOverride: (nodeId: string, code: string | undefined) => void
  setVariables: (vars: WorkflowDef['variablesSchema']) => void
  setDefaultVariables: (vars: Record<string, unknown>) => void

  // Test run
  startTest: (runKey: string) => void
  recordStep: (step: RunStepV2) => void
  appendLog: (entry: { nodeId: string; line: string }) => void
  endTest: () => void
  clearTest: () => void
}

export const useWorkflowV2Store = create<WorkflowV2State>((set, get) => ({
  workflows: [],
  current: null,
  selectedNodeId: null,
  isTesting: false,
  testRunKey: null,
  testStatusByNode: new Map(),
  testLogs: [],

  async loadWorkflows() {
    try {
      const workflows = await window.electronAPI.v2.listWorkflows()
      set({ workflows })
    } catch (err) {
      console.error('loadWorkflows error:', err)
    }
  },

  async loadWorkflow(id: number) {
    try {
      const wf = await window.electronAPI.v2.getWorkflow(id)
      set({ current: wf, selectedNodeId: null })
    } catch (err) {
      console.error('loadWorkflow error:', err)
    }
  },

  newWorkflow(name = 'untitled_workflow_' + Date.now()) {
    set({
      current: {
        id: 0,
        name,
        description: '',
        nodes: [],
        edges: [],
        variablesSchema: [],
        defaultVariables: {},
        isBuiltin: false
      },
      selectedNodeId: null
    })
  },

  async saveCurrent(name) {
    const cur = get().current
    if (!cur) return
    if (name) cur.name = name
    try {
      const saved = await window.electronAPI.v2.saveWorkflow({
        name: cur.name,
        description: cur.description,
        nodes: cur.nodes,
        edges: cur.edges,
        variablesSchema: cur.variablesSchema,
        defaultVariables: cur.defaultVariables
      })
      set({ current: saved })
      get().loadWorkflows()
    } catch (err) {
      console.error('saveCurrent error:', err)
      throw err
    }
  },

  setNodes(nodes) {
    set(state => state.current ? { current: { ...state.current, nodes } } : {})
  },

  setEdges(edges) {
    set(state => state.current ? { current: { ...state.current, edges } } : {})
  },

  upsertNode(node) {
    set(state => {
      if (!state.current) return {}
      const idx = state.current.nodes.findIndex(n => n.id === node.id)
      const next = [...state.current.nodes]
      if (idx >= 0) next[idx] = node
      else next.push(node)
      return { current: { ...state.current, nodes: next } }
    })
  },

  removeNode(nodeId) {
    set(state => {
      if (!state.current) return {}
      return {
        current: {
          ...state.current,
          nodes: state.current.nodes.filter(n => n.id !== nodeId),
          edges: state.current.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
        },
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId
      }
    })
  },

  upsertEdge(edge) {
    set(state => {
      if (!state.current) return {}
      const idx = state.current.edges.findIndex(e => e.id === edge.id)
      const next = [...state.current.edges]
      if (idx >= 0) next[idx] = edge
      else next.push(edge)
      return { current: { ...state.current, edges: next } }
    })
  },

  removeEdge(edgeId) {
    set(state => {
      if (!state.current) return {}
      return { current: { ...state.current, edges: state.current.edges.filter(e => e.id !== edgeId) } }
    })
  },

  selectNode(id) {
    set({ selectedNodeId: id })
  },

  updateNodeConfig(nodeId, config) {
    set(state => {
      if (!state.current) return {}
      const idx = state.current.nodes.findIndex(n => n.id === nodeId)
      if (idx < 0) return {}
      const next = [...state.current.nodes]
      next[idx] = { ...next[idx], config }
      return { current: { ...state.current, nodes: next } }
    })
  },

  updateNodeCodeOverride(nodeId, code) {
    set(state => {
      if (!state.current) return {}
      const idx = state.current.nodes.findIndex(n => n.id === nodeId)
      if (idx < 0) return {}
      const next = [...state.current.nodes]
      next[idx] = { ...next[idx], codeOverride: code }
      return { current: { ...state.current, nodes: next } }
    })
  },

  setVariables(vars) {
    set(state => state.current ? { current: { ...state.current, variablesSchema: vars } } : {})
  },

  setDefaultVariables(vars) {
    set(state => state.current ? { current: { ...state.current, defaultVariables: vars } } : {})
  },

  startTest(runKey) {
    set({ isTesting: true, testRunKey: runKey, testStatusByNode: new Map(), testLogs: [] })
  },

  recordStep(step) {
    set(state => {
      const next = new Map(state.testStatusByNode)
      next.set(step.nodeId, step)
      return { testStatusByNode: next }
    })
  },

  appendLog(entry) {
    set(state => ({ testLogs: [...state.testLogs, { ...entry, ts: Date.now() }] }))
  },

  endTest() {
    set({ isTesting: false, testRunKey: null })
  },

  clearTest() {
    set({ isTesting: false, testRunKey: null, testStatusByNode: new Map(), testLogs: [] })
  }
}))
