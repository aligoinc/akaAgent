import { useLayoutEffect, useReducer, useRef } from 'react'
import type { CampaignListItem } from '../../../shared/types'
import { CAMPAIGN_PENDING_REASON_TTL_MS, CAMPAIGN_PENDING_REASON_UNAVAILABLE, canCheckCampaignPendingReason, campaignPendingReasonVersion } from '../../../shared/campaignPendingReason'
import { useAuthStore } from '../stores/authStore'
import { useCampaignStore } from '../stores/campaignStore'
import { observeWebEnrichmentChanges } from '../utils/observeWebEnrichmentChanges'

interface TemporaryReason { accountId: number; message: string; version: string; expiresAt: number }
interface PendingRequest { id: number; accountId: number; version: string; scope: string | null }

/** Session-only UI cache. Its single expiry timer never reads or writes campaign data. */
export function useCampaignPendingReasons(campaigns: CampaignListItem[], scope: string | null) {
  const entries = useRef(new Map<number, TemporaryReason>())
  const request = useRef<PendingRequest | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const live = useRef({ campaigns, scope, mounted: true })
  live.current.campaigns = campaigns
  live.current.scope = scope
  const [, render] = useReducer(value => value + 1, 0)

  const expire = () => {
    const now = Date.now()
    for (const [id, entry] of Array.from(entries.current)) if (entry.expiresAt <= now) entries.current.delete(id)
    if (live.current.mounted) render()
    armExpiry()
  }
  const armExpiry = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!live.current.mounted || entries.current.size === 0) return
    const next = Math.min(...Array.from(entries.current.values(), entry => entry.expiresAt))
    timer.current = setTimeout(expire, Math.max(0, next - Date.now()))
  }
  const clear = () => {
    entries.current.clear()
    request.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (live.current.mounted) render()
  }

  useLayoutEffect(() => {
    live.current.mounted = true
    const authScope = (user: ReturnType<typeof useAuthStore.getState>['user']) => user ? `${user.organizationId}:${user.staffId}` : null
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (authScope(next.user) !== authScope(previous.user)) clear()
    })
    const invalidateAccounts = (changed: ReadonlySet<number> | null) => {
      let invalidated = false
      for (const [id, entry] of Array.from(entries.current)) if (!changed || changed.has(entry.accountId)) { entries.current.delete(id); invalidated = true }
      if (request.current && (!changed || changed.has(request.current.accountId))) { request.current = null; invalidated = true }
      if (invalidated) { armExpiry(); render() }
    }
    const unsubscribeAccounts = useCampaignStore.subscribe((next, previous) => {
      if (next.accounts === previous.accounts) return
      const before = new Map(previous.accounts.map(account => [account.id, account]))
      const changed = new Set<number>()
      for (const account of next.accounts) {
        const old = before.get(account.id)
        if (account.flatformType === 'facebook' && (old?.facebookRandomRunEnabled !== account.facebookRandomRunEnabled
          || old?.facebookRandomRunRevision !== account.facebookRandomRunRevision)) changed.add(account.id)
        before.delete(account.id)
      }
      for (const account of Array.from(before.values())) if (account.flatformType === 'facebook') changed.add(account.id)
      invalidateAccounts(changed)
    })
    const unsubscribeBrowsing = observeWebEnrichmentChanges(invalidateAccounts)
    const onVisible = () => { if (document.visibilityState === 'visible') expire() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', expire)
    return () => {
      live.current.mounted = false
      clear()
      unsubscribe()
      unsubscribeAccounts()
      unsubscribeBrowsing()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', expire)
    }
  }, [])

  useLayoutEffect(() => { clear() }, [scope])
  useLayoutEffect(() => {
    let changed = false
    for (const campaign of campaigns) {
      const entry = entries.current.get(campaign.id)
      const eligible = canCheckCampaignPendingReason(campaign)
      const version = campaignPendingReasonVersion(campaign)
      if (entry && (!eligible || entry.version !== version)) { entries.current.delete(campaign.id); changed = true }
      if (request.current?.id === campaign.id && (!eligible || request.current.version !== version)) {
        request.current = null
        changed = true
      }
    }
    if (changed) { armExpiry(); render() }
  }, [campaigns])

  const displayedNote = (campaign: CampaignListItem): string => {
    if (campaign.note?.trim()) return campaign.note
    if (!canCheckCampaignPendingReason(campaign)) return ''
    const entry = entries.current.get(campaign.id)
    return entry && entry.expiresAt > Date.now() && entry.version === campaignPendingReasonVersion(campaign) ? entry.message : ''
  }

  const check = async (campaign: CampaignListItem) => {
    if (request.current || !live.current.scope || !canCheckCampaignPendingReason(campaign) || displayedNote(campaign)) return
    const pending = { id: campaign.id, accountId: campaign.accountId, version: campaignPendingReasonVersion(campaign), scope: live.current.scope }
    request.current = pending
    render()
    const stillCurrent = () => {
      if (!live.current.mounted || request.current !== pending || live.current.scope !== pending.scope) return false
      const current = live.current.campaigns.find(item => item.id === pending.id)
      return !!current && canCheckCampaignPendingReason(current) && campaignPendingReasonVersion(current) === pending.version
    }
    try {
      const result = await window.electronAPI.checkCampaignPendingReason(campaign.id)
      if (!stillCurrent()) return
      if (result.campaignId !== campaign.id || !result.message || result.version !== pending.version) {
        void useCampaignStore.getState().loadCampaigns().catch(() => {})
        return
      }
      entries.current.set(campaign.id, { accountId: campaign.accountId, message: result.message, version: pending.version, expiresAt: Date.now() + CAMPAIGN_PENDING_REASON_TTL_MS })
    } catch {
      if (stillCurrent()) entries.current.set(campaign.id, {
        accountId: campaign.accountId, message: CAMPAIGN_PENDING_REASON_UNAVAILABLE, version: pending.version, expiresAt: Date.now() + CAMPAIGN_PENDING_REASON_TTL_MS
      })
    } finally {
      if (request.current === pending) request.current = null
      if (live.current.mounted) { armExpiry(); render() }
    }
  }

  return { displayedNote, check, checkingId: request.current?.id ?? null }
}
