import { useEffect, useState, useCallback } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge, MiniMap } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ChannelListItem, RunListItem } from '../../../shared/ipcChannels'

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

export function WorkflowDetail({ workflowId, onBack }: Props): JSX.Element {
  const [workflow, setWorkflow] = useState<{ workflow: Record<string, unknown>; revision: { graph: { nodes: unknown[]; edges: unknown[] }; version: number } } | null>(null)
  const [channels, setChannels] = useState<ChannelListItem[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>('')
  const [inputJson, setInputJson] = useState('{}')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProgressLog[]>([])
  const [runs, setRuns] = useState<RunListItem[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      window.akabiz.workflows.get(workflowId),
      window.akabiz.channels.list(),
      window.akabiz.runs.list({ workflowId, limit: 20 })
    ])
      .then(([wf, chs, rs]) => {
        setWorkflow(wf)
        setChannels(chs)
        setRuns(rs)
        setError(null)
      })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false))
  }, [workflowId])

  useEffect(() => {
    const off = window.akabiz.onProgress((event) => {
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
    return off
  }, [])

  const reactFlowData = workflow?.revision.graph
  const rfNodes: Node[] = (reactFlowData?.nodes as Array<Record<string, unknown>> | undefined)?.map((n) => ({
    id: String(n.id),
    type: 'default',
    position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    data: { label: `${n.manifestId ?? ''}${n.id ? ` (${n.id})` : ''}` }
  })) ?? []
  const rfEdges: Edge[] = (reactFlowData?.edges as Array<Record<string, unknown>> | undefined)?.map((e) => ({
    id: String(e.id),
    source: String(e.source),
    target: String(e.target),
    sourceHandle: (e.sourceHandle as string | undefined) ?? null,
    label: (e.sourceHandle as string | undefined) && e.sourceHandle !== 'main' ? String(e.sourceHandle) : undefined,
    animated: false
  })) ?? []

  const handleRun = useCallback(async () => {
    if (!workflow) return
    let input: Record<string, unknown> = {}
    try { input = JSON.parse(inputJson) } catch (e) {
      setError(`Input JSON parse error: ${(e as Error).message}`)
      return
    }
    setRunning(true)
    setProgress([{ ts: Date.now(), text: '── Starting run...', level: 'end' }])
    try {
      // If channel selected, register it first
      if (selectedChannel) {
        await window.akabiz.channels.register(selectedChannel)
      }
      const result = await window.akabiz.runs.enqueue({
        workflowId,
        input,
        ...(selectedChannel ? { channelId: selectedChannel } : {})
      })
      setProgress(p => [...p, { ts: Date.now(), text: `Result: ${JSON.stringify(result)}`, level: 'end' }])
      // Refresh run list
      const rs = await window.akabiz.runs.list({ workflowId, limit: 20 })
      setRuns(rs)
    } catch (err) {
      setProgress(p => [...p, { ts: Date.now(), text: `Error: ${(err as Error).message}`, level: 'error' }])
    } finally {
      setRunning(false)
    }
  }, [workflow, workflowId, inputJson, selectedChannel])

  if (loading) return <div className="empty">Loading workflow…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>Error: {error}</div>
  if (!workflow) return <div className="empty">Not found</div>

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 12, height: '100%' }}>
      <div className="row" style={{ marginBottom: 0 }}>
        <button onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0 }}>{String(workflow.workflow.name)}</h2>
        <span style={{ color: '#888', fontSize: 12 }}>v{workflow.revision.version}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ border: '1px solid #2a3142', borderRadius: 6, background: '#1a1f2c' }}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            colorMode="dark"
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {/* Run + Progress + History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <div style={{ background: '#1a1f2c', padding: 12, borderRadius: 6, border: '1px solid #2a3142' }}>
            <h3 style={{ marginBottom: 8 }}>Run workflow</h3>
            <div className="row">
              <label style={{ minWidth: 70 }}>Channel:</label>
              <select value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)} style={{ flex: 1 }}>
                <option value="">— No channel —</option>
                {channels.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.channel_type})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>Input JSON:</label>
              <textarea value={inputJson} onChange={e => setInputJson(e.target.value)} style={{ width: '100%' }} rows={4} />
            </div>
            <div style={{ marginTop: 8 }}>
              <button className="primary" disabled={running} onClick={handleRun}>
                {running ? 'Running…' : '▶ Run'}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, background: '#1a1f2c', padding: 12, borderRadius: 6, border: '1px solid #2a3142', overflow: 'auto', minHeight: 200, fontFamily: 'Consolas, monospace', fontSize: 12 }}>
            <h3 style={{ fontFamily: 'inherit', fontSize: 14, marginBottom: 8 }}>Progress</h3>
            {progress.length === 0 && <div style={{ color: '#666' }}>No progress yet. Click Run.</div>}
            {progress.map((p, i) => (
              <div key={i} style={{
                color: p.level === 'error' ? '#fca5a5' : p.level === 'warn' ? '#fcd34d' : p.level === 'end' ? '#a78bfa' : '#cbd5e1',
                padding: '2px 0'
              }}>
                {p.text}
              </div>
            ))}
          </div>

          <div style={{ background: '#1a1f2c', padding: 12, borderRadius: 6, border: '1px solid #2a3142', maxHeight: 200, overflow: 'auto' }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Recent runs ({runs.length})</h3>
            {runs.length === 0 && <div style={{ color: '#666', fontSize: 12 }}>None yet</div>}
            {runs.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 12, borderBottom: '1px solid #2a3142' }}>
                <span className={`badge ${r.status === 'completed' ? 'success' : r.status === 'failed' ? 'error' : 'pending'}`}>{r.status}</span>
                <span style={{ flex: 1, color: '#888' }}>{r.started_at ? new Date(r.started_at).toLocaleString() : '-'}</span>
                <span style={{ color: '#888' }}>{r.duration_ms ? `${r.duration_ms}ms` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
