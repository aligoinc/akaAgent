import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import Canvas from './components/Canvas/Canvas'
import ConfigPanel from './components/ConfigPanel/ConfigPanel'
import Toolbar from './components/Toolbar/Toolbar'
import TopBar from './components/TopBar/TopBar'
import CampaignPage from './pages/CampaignPage'
import BrowserPage from './pages/BrowserPage'
import { useFlowStore } from './stores/flowStore'
import { useExecutionStore } from './stores/executionStore'
import { FlowData, ExecutionStep } from '../../shared/types'
import { useElementStore } from './stores/elementStore'
import { useBlockStore } from './stores/blockStore'
import { useThemeStore } from './stores/themeStore'

export default function App() {
  const [activePage, setActivePage] = useState<'campaigns' | 'workflow-editor' | 'browsers'>('campaigns')

  const {
    selectedNodeId,
    getFlowData,
    loadFlow,
    resetFlow,
    setNodeStatus,
    clearAllStatus
  } = useFlowStore()
  const {
    setRunning,
    setBrowserConnected,
    updateStep,
    browserConnected
  } = useExecutionStore()
  const { loadElements } = useElementStore()
  const { loadBlocks } = useBlockStore()
  const { theme } = useThemeStore()

  const [showFlowList, setShowFlowList] = useState(false)
  const [flows, setFlows] = useState<FlowData[]>([])

  // Apply theme class to body and notify main process
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('theme-light')
    } else {
      document.body.classList.remove('theme-light')
    }
    
    if (window.electronAPI?.setTheme) {
      window.electronAPI.setTheme(theme).catch(err => console.error('Set theme error:', err))
    }
  }, [theme])

  // Listen to flow progress events from main process
  useEffect(() => {
    if (!window.electronAPI) return

    const unsubscribe = window.electronAPI.onFlowProgress((step: ExecutionStep) => {
      updateStep(step)
      setNodeStatus(step.nodeId, step.status as 'running' | 'success' | 'error', step.output, step.error)
    })

    return () => unsubscribe()
  }, [updateStep, setNodeStatus])

  // Check browser status periodically
  useEffect(() => {
    if (!window.electronAPI) return

    const interval = setInterval(async () => {
      try {
        const { connected } = await window.electronAPI.getBrowserStatus()
        setBrowserConnected(connected)
      } catch {
        setBrowserConnected(false)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [setBrowserConnected])

  const handleLaunchBrowser = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      if (browserConnected) {
        await window.electronAPI.closeBrowser()
        setBrowserConnected(false)
      } else {
        await window.electronAPI.launchBrowser({ profileName: 'default' })
        setBrowserConnected(true)
      }
    } catch (err) {
      console.error('Browser launch error:', err)
    }
  }, [browserConnected, setBrowserConnected])

  const handleRun = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      clearAllStatus()
      setRunning(true)
      const flowData = getFlowData()
      const result = await window.electronAPI.runFlow(flowData)
      console.log('Flow completed:', result)
    } catch (err) {
      console.error('Flow run error:', err)
    } finally {
      setRunning(false)
    }
  }, [getFlowData, setRunning, clearAllStatus])

  const handleStop = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      await window.electronAPI.stopFlow()
      setRunning(false)
    } catch (err) {
      console.error('Flow stop error:', err)
    }
  }, [setRunning])

  const handleSave = useCallback(async (customName?: string) => {
    if (!window.electronAPI) return false
    try {
      const flowData = getFlowData()
      if (customName) flowData.name = customName
      
      if (flowData.isBlock) {
        flowData.inputSchema = flowData.nodes
          .filter(n => n.data.actionType === 'blockInput')
          .map(n => ({
            name: String(n.data.config.fieldName || 'input'),
            type: String(n.data.config.fieldType || 'string') as any,
            label: String(n.data.config.fieldLabel || n.data.config.fieldName || 'Input'),
            required: true
          }))

        flowData.outputSchema = flowData.nodes
          .filter(n => n.data.actionType === 'blockOutput')
          .map(n => ({
            name: String(n.data.config.fieldName || 'output'),
            type: 'any',
            label: String(n.data.config.fieldLabel || n.data.config.fieldName || 'Output')
          }))
      }

      await window.electronAPI.saveFlow(flowData)
      alert('Flow saved successfully!')
      loadBlocks()
    } catch (err) {
      console.error('Save error:', err)
    }
  }, [getFlowData, loadBlocks])

  const handleLoad = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const list = await window.electronAPI.listFlows()
      setFlows(list)
      setShowFlowList(true)
    } catch (err) {
      console.error('Load error:', err)
    }
  }, [])

  const handleSelectFlow = useCallback(async (flow: FlowData) => {
    loadFlow(flow)
    setShowFlowList(false)
  }, [loadFlow])

  const handleNew = useCallback(() => {
    resetFlow()
  }, [resetFlow])

  const handleDeleteFlow = useCallback(async (flowId: string) => {
    if (!window.electronAPI) return
    try {
      await window.electronAPI.deleteFlow(flowId)
      loadBlocks()
    } catch (err) {
      console.error('Delete flow error:', err)
    }
  }, [loadBlocks])

  return (
    <div className="app-layout">
      <TopBar activePage={activePage} onPageChange={setActivePage} />

      <div style={{ display: activePage === 'campaigns' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <CampaignPage />
      </div>

      <div style={{ display: activePage === 'browsers' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <BrowserPage />
      </div>

      <div style={{ display: activePage === 'workflow-editor' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <>
          <Toolbar
            onRun={handleRun}
            onStop={handleStop}
            onSave={handleSave}
            onLoad={handleLoad}
            onNew={handleNew}
            onLaunchBrowser={handleLaunchBrowser}
          />

          <div className="app-body">
            <Sidebar onEditBlock={handleSelectFlow} onDeleteFlow={handleDeleteFlow} />
            <Canvas />
            {selectedNodeId && <ConfigPanel />}
          </div>

          {/* Flow List Modal */}
          {showFlowList && (
            <div className="modal-overlay" onClick={() => setShowFlowList(false)}>
              <div className="modal animate-fadeIn" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <span className="modal-title">Open Flow</span>
                  <button className="btn btn-ghost btn-icon" onClick={() => setShowFlowList(false)}>
                    ✕
                  </button>
                </div>
               <div className="modal-body">
                  {flows.filter(f => !f.isBlock).length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-text">No saved workflows found</div>
                    </div>
                  ) : (
                    flows.filter(f => !f.isBlock).map(flow => (
                      <div
                        key={flow.id}
                        className="flow-list-item"
                        onClick={() => handleSelectFlow(flow)}
                      >
                        <div className="flow-list-item-info">
                          <div className="flow-list-item-name">
                            {flow.name}
                          </div>
                          <div className="flow-list-item-meta">
                            {flow.nodes.length} nodes · Updated {flow.updatedAt ? new Date(flow.updatedAt).toLocaleDateString() : 'N/A'}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      </div>
    </div>
  )
}
