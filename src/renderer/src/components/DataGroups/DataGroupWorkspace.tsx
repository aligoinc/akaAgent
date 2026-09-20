import { Children, Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const SIDEBAR_MIN = 260
const INFO_MIN = 330
const CONTENT_MIN = 320
const HANDLE_WIDTH = 6
type Panel = 'sidebar' | 'info'
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Own the layout state here so dragging does not re-render the data/filter forms. */
export default function DataGroupWorkspace({ children, className = '', showInfo = true, defaultInfoWidth = 360 }: {
  children: ReactNode
  className?: string
  showInfo?: boolean
  defaultInfoWidth?: number
}) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ panel: Panel; pointerId: number; startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState<Panel | null>(null)
  const [preferred, setPreferred] = useState({ sidebar: 280, info: defaultInfoWidth })
  const [size, setSize] = useState({ width: 0, viewport: window.innerWidth })

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const measure = () => {
      const width = workspace.clientWidth
      const viewport = window.innerWidth
      setSize(previous => previous.width === width && previous.viewport === viewport ? previous : { width, viewport })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(workspace)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const infoVisible = showInfo && size.viewport > 1050
  const handlesWidth = HANDLE_WIDTH * (infoVisible ? 2 : 1)
  const sideMinimum = SIDEBAR_MIN + (infoVisible ? INFO_MIN : 0)
  const available = (size.width || size.viewport) - handlesWidth
  // Reserve table space, allowing it to shrink only when both side panels are at their minimum.
  const budget = Math.max(sideMinimum, available - Math.min(CONTENT_MIN, Math.max(0, available - sideMinimum)))
  const sidebar = clamp(preferred.sidebar, SIDEBAR_MIN, budget - (infoVisible ? INFO_MIN : 0))
  const info = infoVisible ? clamp(preferred.info, INFO_MIN, budget - sidebar) : preferred.info
  const widths = { sidebar, info }
  const minimum = { sidebar: SIDEBAR_MIN, info: INFO_MIN }
  const maximum = { sidebar: budget - (infoVisible ? info : 0), info: Math.max(INFO_MIN, budget - sidebar) }
  const updateWidth = (panel: Panel, width: number) => {
    const next = Math.round(clamp(width, minimum[panel], maximum[panel]))
    setPreferred(previous => previous[panel] === next ? previous : { ...previous, [panel]: next })
  }
  const stopDragging = () => {
    dragRef.current = null
    setDragging(null)
  }
  const renderHandle = (panel: Panel) => (
    <div
      className={`data-group-panel-resizer is-${panel}`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={panel === 'sidebar' ? 'Đổi độ rộng danh sách nhóm' : 'Đổi độ rộng thông tin nhóm'}
      aria-valuemin={minimum[panel]}
      aria-valuemax={Math.round(maximum[panel])}
      aria-valuenow={Math.round(widths[panel])}
      aria-valuetext={`${Math.round(widths[panel])} pixel`}
      title="Kéo để đổi độ rộng · Nhấp đúp để đặt lại"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { panel, pointerId: event.pointerId, startX: event.clientX, startWidth: widths[panel] }
        setDragging(panel)
      }}
      onPointerMove={event => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        updateWidth(drag.panel, drag.startWidth + (event.clientX - drag.startX) * (drag.panel === 'sidebar' ? 1 : -1))
      }}
      onPointerUp={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        stopDragging()
      }}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onDoubleClick={() => updateWidth(panel, panel === 'sidebar' ? 280 : defaultInfoWidth)}
      onKeyDown={event => {
        const direction = panel === 'sidebar' ? 1 : -1
        const step = event.shiftKey ? 50 : 10
        const value = event.key === 'Home' ? minimum[panel]
          : event.key === 'End' ? maximum[panel]
          : event.key === 'ArrowLeft' ? widths[panel] - step * direction
          : event.key === 'ArrowRight' ? widths[panel] + step * direction : null
        if (value === null) return
        event.preventDefault()
        updateWidth(panel, value)
      }}
    />
  )

  return (
    <div
      ref={workspaceRef}
      className={`data-group-manager-workspace ${className}${dragging ? ' is-resizing' : ''}`}
      style={{ '--data-group-sidebar-width': `${sidebar}px`, '--data-group-info-width': `${info}px` } as CSSProperties}
    >
      {Children.toArray(children).map((child, index) => (
        <Fragment key={index}>
          {index === 1 && renderHandle('sidebar')}
          {index === 2 && showInfo && renderHandle('info')}
          {child}
        </Fragment>
      ))}
    </div>
  )
}
