import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useWorkflowV2Store } from '../../stores/workflowV2Store'
import { useCampaignStore } from '../../stores/campaignStore'
import { ChevronDown, ChevronUp, GripHorizontal, Play, Square } from 'lucide-react'

const TEST_PANEL_HEIGHT_KEY = 'workflow-test-panel-height'
const MIN_TEST_PANEL_HEIGHT = 180
const DEFAULT_TEST_PANEL_HEIGHT = 320

const getMaxTestPanelHeight = () => {
  if (typeof window === 'undefined') return 640
  return Math.max(260, Math.floor(window.innerHeight * 0.72))
}

const clampTestPanelHeight = (height: number) => {
  const maxHeight = getMaxTestPanelHeight()
  return Math.min(maxHeight, Math.max(MIN_TEST_PANEL_HEIGHT, Math.floor(height)))
}

export default function TestPanelV2() {
  const {
    current: workflow,
    isTesting,
    testRunKey,
    testStatusByNode,
    testLogs,
    startTest,
    recordStep,
    appendLog,
    endTest,
    clearTest
  } = useWorkflowV2Store()
  const accounts = useCampaignStore(s => s.accounts)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [variablesJson, setVariablesJson] = useState('{}')
  const [collapsed, setCollapsed] = useState(false)
  const [panelHeight, setPanelHeight] = useState(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_TEST_PANEL_HEIGHT
      const saved = Number(window.localStorage.getItem(TEST_PANEL_HEIGHT_KEY))
      if (Number.isFinite(saved) && saved > 0) return clampTestPanelHeight(saved)
    } catch {}
    return DEFAULT_TEST_PANEL_HEIGHT
  })
  const resizeHeightRef = useRef(panelHeight)

  useEffect(() => {
    resizeHeightRef.current = panelHeight
  }, [panelHeight])

  // Tự fill variables theo defaultVariables khi load workflow
  useEffect(() => {
    if (workflow?.defaultVariables) {
      setVariablesJson(JSON.stringify(workflow.defaultVariables, null, 2))
    }
  }, [workflow?.id, workflow?.defaultVariables])

  // Subscribe progress + log events
  useEffect(() => {
    const unsubProgress = window.electronAPI.v2.onRunProgress((payload) => {
      if (payload.runKey !== useWorkflowV2Store.getState().testRunKey) return
      recordStep(payload.step)
    })
    const unsubLog = window.electronAPI.v2.onRunLog((payload) => {
      if (payload.runKey !== useWorkflowV2Store.getState().testRunKey) return
      appendLog({ nodeId: payload.nodeId, line: payload.line })
    })
    return () => { unsubProgress(); unsubLog() }
  }, [recordStep, appendLog])

  const stepsArray = useMemo(() => Array.from(testStatusByNode.values()), [testStatusByNode])

  const onTestWorkflow = async () => {
    if (!workflow || !accountId) return
    const runKey = `wf-test-${Date.now()}`
    let variables: Record<string, unknown>
    try { variables = JSON.parse(variablesJson) } catch { alert('Variables JSON không hợp lệ'); return }
    startTest(runKey)
    try {
      await window.electronAPI.v2.testRunWorkflow({
        runKey,
        workflowId: workflow.id || undefined,
        workflow: workflow.id ? undefined : workflow,
        accountId,
        variables
      })
    } catch (err: any) {
      console.error(err)
      appendLog({ nodeId: 'engine', line: 'Lỗi: ' + (err.message || err) })
    } finally {
      endTest()
    }
  }

  const onStop = async () => {
    if (testRunKey) {
      await window.electronAPI.v2.stopRun(testRunKey)
    }
  }

  const onResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed) return
    event.preventDefault()

    const startY = event.clientY
    const startHeight = panelHeight
    let latestHeight = startHeight
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const onPointerMove = (moveEvent: PointerEvent) => {
      latestHeight = clampTestPanelHeight(startHeight + startY - moveEvent.clientY)
      resizeHeightRef.current = latestHeight
      setPanelHeight(latestHeight)
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      try {
        window.localStorage.setItem(TEST_PANEL_HEIGHT_KEY, String(resizeHeightRef.current))
      } catch {}
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }, [collapsed, panelHeight])

  return (
    <div style={{
      borderTop: '1px solid var(--border, #2a2a35)',
      background: 'var(--bg-secondary, #16161e)',
      height: collapsed ? 32 : panelHeight,
      minHeight: collapsed ? 32 : MIN_TEST_PANEL_HEIGHT,
      flexShrink: 0,
      display: 'flex', flexDirection: 'column'
    }}>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Kéo để đổi chiều cao Test panel"
          onPointerDown={onResizeStart}
          style={{
            height: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: 'var(--text-tertiary, #6b6b82)',
            cursor: 'ns-resize',
            touchAction: 'none',
            background: 'var(--bg-secondary, #16161e)'
          }}
        >
          <GripHorizontal size={18} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border, #2a2a35)' }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setCollapsed(!collapsed)} style={{ minWidth: 28 }}>
          {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text, #e0e0e0)', fontWeight: 500 }}>Test panel</span>

        {!collapsed && (
          <>
            <select
              value={accountId ?? ''}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
              style={{ padding: '4px 6px', fontSize: 12, background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)' }}
            >
              <option value="">— Chọn TK —</option>
              {accounts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {!isTesting ? (
              <button className="btn btn-sm" onClick={onTestWorkflow} disabled={!workflow || !accountId}>
                <Play size={12} /> Test workflow
              </button>
            ) : (
              <button className="btn btn-sm" onClick={onStop} style={{ background: '#ef4444' }}>
                <Square size={12} /> Stop
              </button>
            )}

            <button className="btn btn-sm btn-ghost" onClick={clearTest}>Clear</button>

            {isTesting && <span style={{ fontSize: 11, color: '#fbbf24' }}>● Đang chạy...</span>}
          </>
        )}
      </div>

      {!collapsed && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 200px', minHeight: 0 }}>
          {/* Steps */}
          <div style={{ padding: 8, overflowY: 'auto', borderRight: '1px solid var(--border, #2a2a35)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary, #888)', marginBottom: 4 }}>Steps</div>
            {stepsArray.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary, #666)' }}>(chưa có step)</div>}
            {stepsArray.map((s, i) => (
              <div key={i} style={{ fontSize: 11, padding: '2px 4px', display: 'flex', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', marginTop: 4,
                  background: s.status === 'success' ? '#22c55e' : s.status === 'error' ? '#ef4444' : s.status === 'running' ? '#fbbf24' : '#666'
                }} />
                <span style={{ flex: 1 }}>
                  <span style={{ color: 'var(--text-primary, #e0e0e0)' }}>{s.blockName || s.nodeId}</span>
                  <span style={{ color: 'var(--text-tertiary, #666)', marginLeft: 4 }}>({s.nodeId})</span>
                  {s.error && <div style={{ color: '#ef4444' }}>{s.error}</div>}
                </span>
                {s.durationMs && <span style={{ color: 'var(--text-tertiary, #666)' }}>{s.durationMs}ms</span>}
              </div>
            ))}
          </div>

          {/* Logs */}
          <div style={{ padding: 8, overflowY: 'auto', borderRight: '1px solid var(--border, #2a2a35)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary, #888)', marginBottom: 4 }}>Logs</div>
            {testLogs.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary, #666)' }}>(chưa có log)</div>}
            <pre style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-primary, #ddd)', margin: 0, whiteSpace: 'pre-wrap' }}>
              {testLogs.map((l, i) => `[${l.nodeId}] ${l.line}`).join('\n')}
            </pre>
          </div>

          {/* Variables editor */}
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary, #888)', marginBottom: 4 }}>Variables (JSON)</div>
            <textarea
              value={variablesJson}
              onChange={(e) => setVariablesJson(e.target.value)}
              style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)', padding: 6, resize: 'none' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
