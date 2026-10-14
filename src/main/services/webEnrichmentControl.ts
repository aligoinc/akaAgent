import type { WebEnrichmentState } from '../../shared/facebookWebEnrichment'

// Process-local notifications only. Main account operations never wait for DB cleanup here.
const listeners = new Set<(accountId: number) => void>()
const states = new Map<number, WebEnrichmentState>()
// Retain transitions after a session ends so idle -> browsing -> idle invalidates old evidence.
const revisions = new Map<number, number>()
const subscribers = new Set<() => void>()
export function preemptWebEnrichment(accountId: number): void {
  for (const listener of listeners) { try { listener(accountId) } catch {} }
}
export function onWebEnrichmentPreempt(listener: (accountId: number) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener) }
}
export function webEnrichmentSnapshot(): WebEnrichmentState[] { return [...states.values()] }
export function webEnrichmentRevision(accountId: number): number { return revisions.get(accountId) ?? 0 }
export function setWebEnrichmentState(state: WebEnrichmentState, active: boolean): void {
  if (active && states.get(state.accountId)?.runId === state.runId) return
  if (active) states.set(state.accountId, state)
  else if (states.get(state.accountId)?.runId === state.runId) states.delete(state.accountId)
  else return
  revisions.set(state.accountId, webEnrichmentRevision(state.accountId) + 1)
  for (const listener of subscribers) { try { listener() } catch {} }
}
export function onWebEnrichmentState(listener: () => void): () => void {
  subscribers.add(listener); return () => { subscribers.delete(listener) }
}
