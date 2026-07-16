import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import type { AutomationCampaignOption } from './automationTypes'

interface CampaignDisplayParts {
  account: string
  action: string
  name: string
  status: string
}

interface CampaignPopoverPosition {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

type InitialActiveOption = 'none' | 'first' | 'last'

export interface AutomationCampaignComboboxProps {
  campaigns: AutomationCampaignOption[]
  value: string
  selectedCampaign?: AutomationCampaignOption
  onChange: (campaignId: string) => void
  ariaLabel: string
  placeholder: string
  emptyText: string
  noResultsText?: string
  disabled?: boolean
  required?: boolean
}

const POPOVER_GAP = 4
const POPOVER_MARGIN = 12
const POPOVER_MAX_HEIGHT = 320
const POPOVER_MIN_HEIGHT = 72
const OPTION_ESTIMATED_HEIGHT = 42
const VIRTUAL_OPTION_HEIGHT = 38
const VIRTUAL_OVERSCAN = 6

const normalizeSearchText = (value: unknown): string => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim()
)

const getCampaignDisplayParts = (campaign: AutomationCampaignOption): CampaignDisplayParts => ({
  account: campaign.accountName?.trim() || `Tài khoản #${campaign.accountId}`,
  action: campaign.actionName?.trim() || campaign.actionId || 'Không rõ loại chiến dịch',
  name: campaign.name?.trim() || `Chiến dịch #${campaign.id}`,
  status: campaign.status?.trim() || 'Không rõ'
})

export const formatAutomationCampaignLabel = (campaign: AutomationCampaignOption): string => {
  const parts = getCampaignDisplayParts(campaign)
  return `${parts.account} — ${parts.action} — ${parts.name} — ${parts.status}`
}

const getCampaignSearchText = (campaign: AutomationCampaignOption): string => {
  const parts = getCampaignDisplayParts(campaign)
  return normalizeSearchText([parts.account, parts.action, parts.name, parts.status].join(' '))
}

const isSamePopoverPosition = (
  previous: CampaignPopoverPosition | null,
  next: CampaignPopoverPosition
): boolean => !!previous
  && previous.top === next.top
  && previous.bottom === next.bottom
  && previous.left === next.left
  && previous.width === next.width
  && previous.maxHeight === next.maxHeight

const getPopoverPosition = (
  anchor: HTMLElement,
  optionCount: number
): CampaignPopoverPosition => {
  const rect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const availableWidth = Math.max(1, viewportWidth - POPOVER_MARGIN * 2)
  const width = Math.min(Math.max(1, rect.width), availableWidth)
  const left = Math.min(
    Math.max(POPOVER_MARGIN, rect.left),
    Math.max(POPOVER_MARGIN, viewportWidth - width - POPOVER_MARGIN)
  )
  const expectedHeight = Math.min(
    POPOVER_MAX_HEIGHT,
    Math.max(POPOVER_MIN_HEIGHT, optionCount * OPTION_ESTIMATED_HEIGHT + 12)
  )
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - POPOVER_GAP - POPOVER_MARGIN)
  const spaceAbove = Math.max(0, rect.top - POPOVER_GAP - POPOVER_MARGIN)
  const openAbove = spaceBelow < expectedHeight && spaceAbove > spaceBelow
  const availableHeight = openAbove ? spaceAbove : spaceBelow
  const maxHeight = Math.max(1, Math.min(POPOVER_MAX_HEIGHT, availableHeight))

  if (openAbove) {
    return {
      bottom: viewportHeight - rect.top + POPOVER_GAP,
      left,
      width,
      maxHeight
    }
  }

  return {
    top: rect.bottom + POPOVER_GAP,
    left,
    width,
    maxHeight
  }
}

export default function AutomationCampaignCombobox({
  campaigns,
  value,
  selectedCampaign,
  onChange,
  ariaLabel,
  placeholder,
  emptyText,
  noResultsText = 'Không tìm thấy chiến dịch phù hợp.',
  disabled = false,
  required = false
}: AutomationCampaignComboboxProps) {
  const generatedId = useId()
  const listboxId = `automation-campaign-listbox-${generatedId}`
  const rootRef = useRef<HTMLDivElement>(null)
  const controlRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const initialActiveOptionRef = useRef<InitialActiveOption>('none')
  const virtualScrollFrameRef = useRef<number | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [virtualScrollTop, setVirtualScrollTop] = useState(0)
  const [popoverPosition, setPopoverPosition] = useState<CampaignPopoverPosition | null>(null)

  const currentCampaign = useMemo(() => {
    const selectableCampaign = campaigns.find(campaign => String(campaign.id) === value)
    if (selectableCampaign) return selectableCampaign
    if (selectedCampaign && String(selectedCampaign.id) === value) return selectedCampaign
    return undefined
  }, [campaigns, selectedCampaign, value])

  const indexedCampaigns = useMemo(() => campaigns.map(campaign => ({
    campaign,
    searchText: getCampaignSearchText(campaign)
  })), [campaigns])
  const normalizedQuery = normalizeSearchText(query)
  const filteredCampaigns = useMemo(() => {
    if (!normalizedQuery) return campaigns
    return indexedCampaigns
      .filter(item => item.searchText.includes(normalizedQuery))
      .map(item => item.campaign)
  }, [campaigns, indexedCampaigns, normalizedQuery])
  const hasRetainedNonSelectableCampaign = !!value
    && !!selectedCampaign
    && String(selectedCampaign.id) === value
    && !campaigns.some(campaign => String(campaign.id) === value)

  const closeList = useCallback(() => {
    if (virtualScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(virtualScrollFrameRef.current)
      virtualScrollFrameRef.current = null
    }
    setIsOpen(false)
    setQuery('')
    setActiveIndex(-1)
    setVirtualScrollTop(0)
    setPopoverPosition(null)
  }, [])

  const openList = useCallback((initialActiveOption: InitialActiveOption = 'none') => {
    if (disabled || isOpen) return
    initialActiveOptionRef.current = initialActiveOption
    setQuery('')
    setIsOpen(true)
  }, [disabled, isOpen])

  const selectCampaign = useCallback((campaign: AutomationCampaignOption) => {
    onChange(String(campaign.id))
    closeList()
  }, [closeList, onChange])

  const clearCampaign = useCallback(() => {
    onChange('')
    setQuery('')
    setActiveIndex(campaigns.length > 0 ? 0 : -1)
    if (!isOpen && !disabled) setIsOpen(true)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [campaigns.length, disabled, isOpen, onChange])

  const updatePopoverPosition = useCallback(() => {
    if (!controlRef.current) return
    const nextPosition = getPopoverPosition(controlRef.current, filteredCampaigns.length)
    setPopoverPosition(previous => isSamePopoverPosition(previous, nextPosition) ? previous : nextPosition)
  }, [filteredCampaigns.length])

  useEffect(() => {
    if (!isOpen) return
    const selectedIndex = filteredCampaigns.findIndex(campaign => String(campaign.id) === value)
    const initialActiveOption = initialActiveOptionRef.current
    initialActiveOptionRef.current = 'none'
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex)
      return
    }
    if (filteredCampaigns.length === 0) {
      setActiveIndex(-1)
      return
    }
    if (hasRetainedNonSelectableCampaign && !normalizedQuery && initialActiveOption === 'none') {
      setActiveIndex(-1)
      return
    }
    setActiveIndex(initialActiveOption === 'last' ? filteredCampaigns.length - 1 : 0)
  }, [filteredCampaigns, hasRetainedNonSelectableCampaign, isOpen, normalizedQuery, value])

  useEffect(() => {
    if (!isOpen) return

    let frame: number | null = null
    const schedulePositionUpdate = (event?: Event) => {
      const target = event?.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        updatePopoverPosition()
      })
    }
    updatePopoverPosition()
    schedulePositionUpdate()
    const handleViewportChange = (event: Event) => schedulePositionUpdate(event)
    window.addEventListener('resize', handleViewportChange)
    document.addEventListener('scroll', handleViewportChange, true)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleViewportChange)
      document.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [isOpen, updatePopoverPosition])

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeList()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [closeList, isOpen])

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return
    const menu = menuRef.current
    if (!menu || activeIndex >= filteredCampaigns.length) return
    const optionTop = activeIndex * VIRTUAL_OPTION_HEIGHT
    const optionBottom = optionTop + VIRTUAL_OPTION_HEIGHT
    const viewportTop = menu.scrollTop
    const viewportBottom = viewportTop + menu.clientHeight
    let nextScrollTop = viewportTop
    if (optionTop < viewportTop) nextScrollTop = optionTop
    else if (optionBottom > viewportBottom) nextScrollTop = optionBottom - menu.clientHeight
    if (nextScrollTop !== viewportTop) {
      menu.scrollTop = nextScrollTop
      setVirtualScrollTop(nextScrollTop)
    }
  }, [activeIndex, filteredCampaigns.length, isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (menuRef.current) menuRef.current.scrollTop = 0
    setVirtualScrollTop(0)
  }, [isOpen, normalizedQuery])

  useEffect(() => () => {
    if (virtualScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(virtualScrollFrameRef.current)
    }
  }, [])

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      event.stopPropagation()
      closeList()
      return
    }

    if (event.key === 'Tab') {
      if (isOpen) closeList()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) {
        openList('first')
        return
      }
      if (filteredCampaigns.length > 0) {
        setActiveIndex(previous => previous < 0 ? 0 : (previous + 1) % filteredCampaigns.length)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) {
        openList('last')
        return
      }
      if (filteredCampaigns.length > 0) {
        setActiveIndex(previous => previous <= 0 ? filteredCampaigns.length - 1 : previous - 1)
      }
      return
    }

    if (event.key === 'Home' && isOpen && filteredCampaigns.length > 0) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }

    if (event.key === 'End' && isOpen && filteredCampaigns.length > 0) {
      event.preventDefault()
      setActiveIndex(filteredCampaigns.length - 1)
      return
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && isOpen && !query && value) {
      event.preventDefault()
      clearCampaign()
      return
    }

    if (event.key === 'Enter' && isOpen && activeIndex >= 0) {
      const activeCampaign = filteredCampaigns[activeIndex]
      if (activeCampaign) {
        event.preventDefault()
        selectCampaign(activeCampaign)
      }
    }
  }

  const activeCampaign = activeIndex >= 0 ? filteredCampaigns[activeIndex] : undefined
  const inputValue = isOpen ? query : currentCampaign ? formatAutomationCampaignLabel(currentCampaign) : ''
  const menuStyle: CSSProperties | undefined = popoverPosition ? {
    top: popoverPosition.top,
    bottom: popoverPosition.bottom,
    left: popoverPosition.left,
    width: popoverPosition.width,
    maxHeight: popoverPosition.maxHeight
  } : undefined
  const virtualViewportHeight = popoverPosition?.maxHeight || POPOVER_MAX_HEIGHT
  const virtualContentHeight = filteredCampaigns.length * VIRTUAL_OPTION_HEIGHT
  const clampedVirtualScrollTop = Math.min(
    virtualScrollTop,
    Math.max(0, virtualContentHeight - virtualViewportHeight)
  )
  const virtualStartIndex = Math.max(
    0,
    Math.floor(clampedVirtualScrollTop / VIRTUAL_OPTION_HEIGHT) - VIRTUAL_OVERSCAN
  )
  const virtualEndIndex = Math.min(
    filteredCampaigns.length,
    Math.ceil((clampedVirtualScrollTop + virtualViewportHeight) / VIRTUAL_OPTION_HEIGHT) + VIRTUAL_OVERSCAN
  )
  const virtualCampaigns = filteredCampaigns.slice(virtualStartIndex, virtualEndIndex)
  const virtualCampaignEntries = virtualCampaigns.map((campaign, virtualIndex) => ({
    campaign,
    index: virtualStartIndex + virtualIndex
  }))
  if (
    activeCampaign
    && (activeIndex < virtualStartIndex || activeIndex >= virtualEndIndex)
  ) {
    virtualCampaignEntries.push({ campaign: activeCampaign, index: activeIndex })
    virtualCampaignEntries.sort((left, right) => left.index - right.index)
  }
  const portalHost = rootRef.current?.closest<HTMLElement>('[role="dialog"]') || document.body

  return (
    <div
      ref={rootRef}
      className={`automation-campaign-combobox${disabled ? ' is-disabled' : ''}`}
      onKeyDown={event => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault()
          event.stopPropagation()
          closeList()
          inputRef.current?.focus()
        }
      }}
    >
      <div ref={controlRef} className={`automation-campaign-combobox-control${isOpen ? ' is-open' : ''}`}>
        <Search size={15} className="automation-campaign-combobox-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-owns={isOpen ? listboxId : undefined}
          aria-expanded={isOpen}
          aria-activedescendant={isOpen && activeCampaign
            ? `${listboxId}-option-${activeCampaign.id}`
            : undefined}
          aria-required={required || undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="automation-campaign-combobox-input"
          placeholder={placeholder}
          value={inputValue}
          onFocus={() => openList()}
          onClick={() => openList()}
          onChange={event => {
            if (!isOpen) setIsOpen(true)
            setQuery(event.target.value)
          }}
          onKeyDown={handleInputKeyDown}
        />
        {!!value && !disabled && (
          <button
            type="button"
            className="automation-campaign-combobox-clear"
            aria-label="Bỏ chọn chiến dịch"
            title="Bỏ chọn chiến dịch"
            onMouseDown={event => event.preventDefault()}
            onClick={clearCampaign}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          className="automation-campaign-combobox-toggle"
          aria-label={isOpen ? 'Đóng danh sách chiến dịch' : 'Mở danh sách chiến dịch'}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              closeList()
              inputRef.current?.focus()
            } else {
              openList()
              window.requestAnimationFrame(() => inputRef.current?.focus())
            }
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>

      {isOpen && popoverPosition && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="automation-campaign-combobox-menu"
          style={menuStyle}
          onScroll={event => {
            const nextScrollTop = event.currentTarget.scrollTop
            if (virtualScrollFrameRef.current !== null) {
              window.cancelAnimationFrame(virtualScrollFrameRef.current)
            }
            virtualScrollFrameRef.current = window.requestAnimationFrame(() => {
              virtualScrollFrameRef.current = null
              setVirtualScrollTop(nextScrollTop)
            })
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeList()
              inputRef.current?.focus()
            }
          }}
        >
          {campaigns.length === 0 ? (
            <div className="automation-campaign-combobox-empty">{emptyText}</div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="automation-campaign-combobox-empty">{noResultsText}</div>
          ) : (
            <div
              className="automation-campaign-combobox-virtual-space"
              style={{ height: virtualContentHeight }}
            >
              {virtualCampaignEntries.map(({ campaign, index }) => {
                const parts = getCampaignDisplayParts(campaign)
                const selected = String(campaign.id) === value
                const active = index === activeIndex
                const label = formatAutomationCampaignLabel(campaign)
                return (
                  <button
                    key={campaign.id}
                    id={`${listboxId}-option-${campaign.id}`}
                    type="button"
                    role="option"
                    aria-label={label}
                    aria-selected={selected}
                    aria-posinset={index + 1}
                    aria-setsize={filteredCampaigns.length}
                    tabIndex={-1}
                    className={`automation-campaign-combobox-option${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                    style={{ top: index * VIRTUAL_OPTION_HEIGHT, height: VIRTUAL_OPTION_HEIGHT }}
                    title={label}
                    onMouseDown={event => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => selectCampaign(campaign)}
                  >
                    <span className="automation-campaign-combobox-option-label">
                      <span className="automation-campaign-combobox-option-account">{parts.account}</span>
                      <span className="automation-campaign-combobox-option-separator" aria-hidden="true">—</span>
                      <span className="automation-campaign-combobox-option-action">{parts.action}</span>
                      <span className="automation-campaign-combobox-option-separator" aria-hidden="true">—</span>
                      <span className="automation-campaign-combobox-option-name">{parts.name}</span>
                      <span className="automation-campaign-combobox-option-separator" aria-hidden="true">—</span>
                      <span className="automation-campaign-combobox-option-status">{parts.status}</span>
                    </span>
                    {selected && <Check size={15} className="automation-campaign-combobox-option-check" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>,
        portalHost
      )}
    </div>
  )
}
