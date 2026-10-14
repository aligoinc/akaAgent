export interface BrowserPreview {
  accountId: number
  campaignId?: number
  context?: 'campaign' | 'contact-scan' | 'web-enrichment'
  runId?: string
  active: boolean
  image?: string
  title?: string
  timestamp: string
}

/** Only the owner of the displayed preview may clear it or reuse its last frame. */
export function mergeBrowserPreview(current: BrowserPreview | undefined, incoming: BrowserPreview): BrowserPreview {
  const sameOwner = current
    && (current.context || 'campaign') === (incoming.context || 'campaign')
    && current.campaignId === incoming.campaignId
    && current.runId === incoming.runId
  if (!incoming.active && current && !sameOwner) return current
  return {
    ...incoming,
    image: incoming.active ? (incoming.image || (sameOwner ? current?.image : undefined)) : undefined
  }
}
