import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
  type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { BlockManifest } from '@akabiz/engine'
import type { ChannelListItem, RunListItem } from '../../../shared/ipcChannels'
import type { WorkflowGraph } from '../types'
import { BlockLibrary } from '../components/BlockLibrary'
import { BlockNode, type BlockNodeData } from '../components/BlockNode'
import { ConfigPanel, type SelectedNodeInfo } from '../components/ConfigPanel'

interface Props {
  workflowId: string
  onBack: () => void
}

interface ProgressLog {
  ts: number
  text: string
  level?: 'info' | 'warn' | 'error' | 'step' | 'end'
  nodeId?: string
}

const nodeTypes = { blockNode: BlockNode }

function toRFNode(n: WorkflowGraph['nodes'][0], blocks: BlockManifest[]): Node {
  const manifest = blocks.find(b => b.manifestId === n.manifestId)
  return {
    id: n.id,
    type: 'blockNode',
    position: n.position ?? { x: 0, y: 0 },
    data: {
      manifestId: n.manifestId,
      label: manifest?.name ?? n.manifestId,
      category: manifest?.ui.category,
      requires: manifest?.requires
    } as BlockNodeData
  }
}

function toRFEdge(e: WorkflowGraph['edges'][0]): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    label: e.sourceHandle && e.sourceHandle !== 'main' ? e.sourceHandle : undefined,
    animated: false
  }
}

export function WorkflowDetail({ workflowId, onBack }: Props): JSX.Element {
  const [workflowMeta, setWorkflowMeta] = useState<{ name: string; version: number } | null>(null)
  const [blocks, setBlocks] = useState<BlockManifest[]>([])
  const [channels, setChannels] = useState<ChannelListItem[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>('')
  const [inputJson, setInputJson] = useState('{}')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [progress, setProgress] = useState<ProgressLog[]>([])
  const [runs, setRuns] = useState<RunListItem[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const [nodeData, setNodeData] = useState<Map<string, WorkflowGraph['nodes'][0]>>(new Map())
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowWrapper = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      window.akabiz.workflows.get(workflowId),
      window.akabiz.blocks.list(),
      window.akabiz.channels.list(),
      window.akabiz.runs.list({ workflowId, limit: 20 })
    ])
      .then(([wf, bl, chs, rs]) => {
        const graph = wf.revision.graph as WorkflowGraph
        const dataMap = new Map<string, WorkflowGraph['nodes'][0]>()
        for (const n of graph.nodes) dataMap.set(n.id, n)
        setRfNodes((graph.nodes ?? []).map(n => toRFNode(n, bl)))
        setRfEdges((graph.edges ?? []).map(toRFEdge))
        setNodeData(dataMap)
        setBlocks(bl)
        setChannels(chs)
        setRuns(rs)
        setWorkflowMeta({ name: String(wf.workflow.name), version: Number(wf.revision.version) })
        setError(null)
        setDirty(false)
      })
      .catch(err => setError(String(err.message ?? err)))
      .finally(() => setLoading(false))
  }, [workflowId])

  useEffect(() => {
    return window.akabiz.onProgress((event) => {
      const ts = Date.now()
      if (event.kind === 'log') {
        setProgress(p => [...p, { ts, text: event.message, level: event.level, ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}) }])
      } else if (event.kind === 'step.start') {
        setProgress(p => [...p, { ts, text: `▶ ${event.nodeId} (${event.manifestId})`, level: 'step', nodeId: event.nodeId }])
      } else if (event.kind === 'step.end') {
        const icon = event.status === 'success' ? '✅' : event.status === 'skipped' ? '⏭' : '❌'
        setProgress(p => [...p, { ts, text: `${icon} ${event.nodeId} (${event.durationMs}ms)`, level: 'step', nodeId: event.nodeId }])
      } else if (event.kind === 'run.end') {
        setProgress(p => [...p, { ts, text: `── Run finished: ${event.status} (${event.durationMs}ms)`, level: 'end' }])
      }
    })
  }, [])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes(nds => applyNodeChanges(changes, nds))
    if (changes.some(c => c.type === 'position' || c.type === 'remove')) setDirty(true)
    for (const c of changes) {
      if (c.type === 'remove') {
        setNodeData(prev => {
          const next = new Map(prev)
          next.delete(c.id)
          return next
        })
      } else if (c.type === 'position' && c.position) {
        setNodeData(prev => {
          const cur = prev.get(c.id)
          if (!cur) return prev
          const next = new Map(prev)
          next.set(c.id, { ...cur, position: c.position! })
          return next
        })
      }
    }
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges(eds => applyEdgeChanges(changes, eds))
    if (changes.some(c => c.type === 'remove' || c.type === 'add')) setDirty(true)
  }, [])

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return
    const newEdge: Edge = {
      id: `e_${conn.source}_${conn.target}_${Date.now()}`,
      source: conn.source,
      target: conn.target,
      ...(conn.sourceHandle ? { sourceHandle: conn.sourceHandle } : {}),
      ...(conn.targetHandle ? { targetHandle: conn.targetHandle } : {}),
      label: conn.sourceHandle && conn.sourceHandle !== 'main' ? conn.sourceHandle : undefined
    }
    setRfEdges(eds => addEdge(newEdge, eds))
    setDirty(true)
  }, [])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const addNode = useCallback((manifest: BlockManifest, position?: { x: number; y: number }): void => {
    const idBase = manifest.manifestId.replace(/^core\./, '').replace(/\./g, '_')
    const id = `n_${idBase}_${Date.now().toString(36).slice(-4)}`
    const pos = position ?? { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 }
    const newNodeData: WorkflowGraph['nodes'][0] = {
      id,
      manifestId: manifest.manifestId,
      position: pos,
      config: { ...(manifest.defaultConfig ?? {}) },
      inputMapping: {}
    }
    setNodeData(prev => new Map(prev).set(id, newNodeData))
    setRfNodes(nds => [...nds, toRFNode(newNodeData, blocks.length > 0 ? blocks : [manifest])])
    setDirty(true)
  }, [blocks])

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const data = event.dataTransfer.getData('application/akabiz-block')
    if (!data || !rfInstance) return
    const manifest = JSON.parse(data) as BlockManifest
    const position = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addNode(manifest, position)
  }, [rfInstance, addNode])

  const handleNodePatch = useCallback((id: string, patch: { config?: Record<string, unknown>; inputMapping?: Record<string, { sourceNodeId: string; sourceField: string; sourcePath?: string }> }): void => {
    setNodeData(prev => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(id, {
        ...cur,
        ...(patch.config !== undefined ? { config: patch.config } : {}),
        ...(patch.inputMapping !== undefined ? { inputMapping: patch.inputMapping } : {})
      })
      return next
    })
    setDirty(true)
  }, [])

  const handleNodeDelete = useCallback((id: string): void => {
    setRfNodes(nds => nds.filter(n => n.id !== id))
    setRfEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
    setNodeData(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setSelectedNodeId(null)
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!workflowMeta) return
    setSaving(true)
    try {
      const graphNodes = rfNodes.map(rfn => {
        const data = nodeData.get(rfn.id)
        if (!data) return null
        return {
          id: rfn.id,
          manifestId: data.manifestId,
          position: rfn.position,
          config: data.config ?? {},
          inputMapping: data.inputMapping ?? {}
        }
      }).filter((n): n is NonNullable<typeof n> => n !== null)

      const graphEdges = rfEdges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
        ...(e.targetHandle ? { targetHandle: e.targetHandle } : {})
      }))

      const result = await window.akabiz.workflows.save({
        id: workflowId,
        name: workflowMeta.name,
        graph: { nodes: graphNodes, edges: graphEdges, variables: [], inputSchema: [], outputSchema: [] },
        bumpVersion: true
      })
      setWorkflowMeta(m => m ? { ...m, version: result.version } : m)
      setDirty(false)
      setProgress(p => [...p, { ts: Date.now(), text: `── Saved as v${result.version}`, level: 'end' }])
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [workflowId, workflowMeta, rfNodes, rfEdges, nodeData])

  const handleRun = useCallback(async () => {
    let input: Record<string, unknown> = {}
    try { input = JSON.parse(inputJson) } catch (e) {
      setError(`Input JSON parse error: ${(e as Error).message}`)
      return
    }
    setRunning(true)
    setProgress([{ ts: Date.now(), text: '── Starting run...', level: 'end' }])
    try {
      if (selectedChannel) await window.akabiz.channels.register(selectedChannel)
      const result = await window.akabiz.runs.enqueue({
        workflowId,
        input,
        ...(selectedChannel ? { channelId: selectedChannel } : {})
      })
      setProgress(p => [...p, { ts: Date.now(), text: `Result: ${JSON.stringify(result)}`, level: 'end' }])
      const rs = await window.akabiz.runs.list({ workflowId, limit: 20 })
      setRuns(rs)
    } catch (err) {
      setProgress(p => [...p, { ts: Date.now(), text: `Error: ${(err as Error).message}`, level: 'error' }])
    } finally {
      setRunning(false)
    }
  }, [workflowId, inputJson, selectedChannel])

  const onPaneClick = useCallback(() => setSelectedNodeId(null), [])
  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => setSelectedNodeId(node.id), [])

  const selectedInfo: SelectedNodeInfo | null = useMemo(() => {
    if (!selectedNodeId) return null
    const data = nodeData.get(selectedNodeId)
    if (!data) return null
    return {
      id: selectedNodeId,
      manifestId: data.manifestId,
      config: data.config,
      inputMapping: data.inputMapping
    }
  }, [selectedNodeId, nodeData])

  const selectedManifest = useMemo(() => {
    if (!selectedInfo) return null
    return blocks.find(b => b.manifestId === selectedInfo.manifestId) ?? null
  }, [selectedInfo, blocks])

  const availableSources = useMemo(() => {
    return Array.from(nodeData.values())
      .filter(n => n.id !== selectedNodeId)
      .map(n => ({ nodeId: n.id, manifestId: n.manifestId }))
  }, [nodeData, selectedNodeId])

  if (loading) return <div className="empty">Loading workflow…</div>
  if (error && !workflowMeta) return <div className="empty" style={{ color: '#fca5a5' }}>Error: {error}</div>
  if (!workflowMeta) return <div className="empty">Not found</div>

  return (
    <ReactFlowProvider>
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, height: '100%' }}>
        <div className="row" style={{ marginBottom: 0 }}>
          <button onClick={onBack}>← Back</button>
          <h2 style={{ margin: 0 }}>{workflowMeta.name}</h2>
          <span style={{ color: '#888', fontSize: 12 }}>v{workflowMeta.version}</span>
          {dirty && <span style={{ color: '#fcd34d', fontSize: 11 }}>• unsaved changes</span>}
          <button className="primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          {error && <span style={{ color: '#fca5a5', fontSize: 11 }}>{error}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 320px', gap: 8, minHeight: 0 }}>
          <div style={{ background: '#1a1f2c', border: '1px solid #2a3142', borderRadius: 6, overflow: 'hidden' }}>
            <BlockLibrary onAdd={(m) => addNode(m)} />
          </div>

          <div ref={reactFlowWrapper} style={{ border: '1px solid #2a3142', borderRadius: 6, background: '#1a1f2c' }}>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onPaneClick={onPaneClick}
              onNodeClick={onNodeClick}
              onInit={setRfInstance}
              nodeTypes={nodeTypes}
              fitView
              colorMode="dark"
              deleteKeyCode={['Delete', 'Backspace']}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            <div style={{ flex: '1 1 auto', background: '#1a1f2c', border: '1px solid #2a3142', borderRadius: 6, overflow: 'hidden', minHeight: 200 }}>
              <ConfigPanel
                selected={selectedInfo}
                manifest={selectedManifest}
                availableSources={availableSources}
                onChange={handleNodePatch}
                onDelete={handleNodeDelete}
              />
            </div>

            <div style={{ background: '#1a1f2c', padding: 10, borderRadius: 6, border: '1px solid #2a3142' }}>
              <h3 style={{ marginBottom: 6, fontSize: 13 }}>Run workflow</h3>
              <div className="row">
                <select value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)} style={{ flex: 1 }}>
                  <option value="">— No channel —</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <textarea value={inputJson} onChange={e => setInputJson(e.target.value)} style={{ width: '100%', minHeight: 60 }} placeholder="Input JSON" />
              <button className="primary" disabled={running} onClick={handleRun} style={{ marginTop: 6, width: '100%' }}>
                {running ? 'Running…' : '▶ Run'}
              </button>
            </div>

            <div style={{ background: '#1a1f2c', padding: 8, borderRadius: 6, border: '1px solid #2a3142', maxHeight: 180, overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: 11 }}>
              {progress.length === 0 && <div style={{ color: '#666' }}>No progress yet</div>}
              {progress.slice(-50).map((p, i) => (
                <div key={i} style={{
                  color: p.level === 'error' ? '#fca5a5' : p.level === 'warn' ? '#fcd34d' : p.level === 'end' ? '#a78bfa' : '#cbd5e1',
                  padding: '1px 0'
                }}>
                  {p.text}
                </div>
              ))}
            </div>

            <div style={{ background: '#1a1f2c', padding: 8, borderRadius: 6, border: '1px solid #2a3142', maxHeight: 120, overflow: 'auto' }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Recent runs ({runs.length})</div>
              {runs.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', gap: 6, padding: '2px 0', fontSize: 11 }}>
                  <span className={`badge ${r.status === 'completed' ? 'success' : r.status === 'failed' ? 'error' : 'pending'}`}>{r.status}</span>
                  <span style={{ flex: 1, color: '#888' }}>{r.started_at ? new Date(r.started_at).toLocaleTimeString() : '-'}</span>
                  <span style={{ color: '#888' }}>{r.duration_ms ?? ''}ms</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  )
}
