import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, MessageCircleQuestion, Sparkles } from 'lucide-react'
import { CAMPAIGN_SUPPORT_QUESTION, type CampaignAssistantMode } from '../../../../shared/campaignSupport'

export default function CampaignAssistantMenu({ onSelect }: { onSelect: (mode: CampaignAssistantMode) => void }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return
    const anchor = button.current.getBoundingClientRect()
    const rect = menu.current.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)),
      top: anchor.bottom + rect.height + 8 <= window.innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - rect.height - 6)
    })
    menu.current.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false)
    }
    const close = () => setOpen(false)
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus() }
      if (event.key === 'Tab') setOpen(false)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        const current = items.findIndex(item => item === document.activeElement)
        items[(current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
      }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])
  const select = (mode: CampaignAssistantMode) => { setOpen(false); button.current?.focus(); onSelect(mode) }
  return <>
    <button ref={button} type="button" className="btn-icon assistant campaign-control-button campaign-label-button"
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} title="Trợ lý AI">
      <Sparkles size={14} /><span>Trợ lý</span>
    </button>
    {open && createPortal(<div ref={menu} role="menu" aria-label="Trợ lý AI" className="campaign-assistant-menu" style={position}
      onClick={event => event.stopPropagation()}>
      <button type="button" role="menuitem" onClick={() => select('ask')}><MessageCircleQuestion size={15} />Hỏi AI</button>
      <button type="button" role="menuitem" onClick={() => select('campaign_support')}><CircleHelp size={15} />{CAMPAIGN_SUPPORT_QUESTION}</button>
    </div>, document.body)}
  </>
}
