import { useState, useCallback, useRef } from 'react'
import AccountPanel from '../components/CampaignPanels/AccountPanel'
import CampaignPanel from '../components/CampaignPanels/CampaignPanel'
import LogPanel from '../components/CampaignPanels/LogPanel'

interface CampaignPageProps {
  onNavigateToBrowser?: (accountId: number) => void
}

export default function CampaignPage({ onNavigateToBrowser }: CampaignPageProps) {
  const [panelWidths, setPanelWidths] = useState([250, -1, 300]) // accountW, auto, logW
  const [filterAccountId, setFilterAccountId] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null)

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    draggingRef.current = { index, startX, startWidths: [...panelWidths] }

    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const dx = e.clientX - draggingRef.current.startX
      const newWidths = [...draggingRef.current.startWidths]

      if (draggingRef.current.index === 0) {
        // Resize between account and campaign panels
        newWidths[0] = Math.max(180, Math.min(500, draggingRef.current.startWidths[0] + dx))
      } else if (draggingRef.current.index === 1) {
        // Resize between campaign and log panels
        newWidths[2] = Math.max(200, Math.min(600, draggingRef.current.startWidths[2] - dx))
      }

      setPanelWidths(newWidths)
    }

    const handleMouseUp = () => {
      draggingRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [panelWidths])

  const handleFilterCampaigns = useCallback((accountId: number | null) => {
    setFilterAccountId(accountId)
  }, [])

  return (
    <div className="campaign-page" ref={containerRef}>
      {/* Account Panel */}
      <div className="campaign-page-panel" style={{ width: panelWidths[0], minWidth: 180 }}>
        <AccountPanel 
          onNavigateToBrowser={onNavigateToBrowser}
          onFilterCampaigns={handleFilterCampaigns}
        />
      </div>

      {/* Resize Handle 1 */}
      <div
        className="resize-handle"
        onMouseDown={(e) => handleMouseDown(0, e)}
      />

      {/* Campaign Panel (takes remaining space) */}
      <div className="campaign-page-panel" style={{ flex: 1, minWidth: 300 }}>
        <CampaignPanel 
          filterAccountId={filterAccountId}
          onClearFilter={() => setFilterAccountId(null)}
        />
      </div>

      {/* Resize Handle 2 */}
      <div
        className="resize-handle"
        onMouseDown={(e) => handleMouseDown(1, e)}
      />

      {/* Log Panel */}
      <div className="campaign-page-panel" style={{ width: panelWidths[2], minWidth: 200 }}>
        <LogPanel />
      </div>
    </div>
  )
}
