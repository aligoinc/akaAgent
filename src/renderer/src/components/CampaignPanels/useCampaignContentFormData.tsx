import { useMemo, useState, useSyncExternalStore, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react'
import { restoreCampaignDraftValue, type CampaignDraftPayload } from '../../../../shared/campaignDrafts'
import { splitFormattedContentVariants } from '../../../../shared/formattedContent'

type ContentForm = { content: string }
export interface CampaignContentStore {
  subscribe: (listener: () => void) => () => void
  getContent: () => string
}

function contentPresence(content: string): string {
  // Both plain and HTML completion indicators must update immediately.
  return `${!!content.trim()}:${splitFormattedContentVariants(content).length > 0}`
}

/** Canonical draft state is synchronous; only content consumers render per key. */
export function useCampaignContentFormData<T extends ContentForm>(
  payload: CampaignDraftPayload | undefined,
  values: MutableRefObject<Record<string, unknown>>,
  initial: T
): [T, Dispatch<SetStateAction<T>>, CampaignContentStore] {
  const [store] = useState(() => {
    let snapshot = restoreCampaignDraftValue(initial, payload?.values.formData)
    let formSnapshot = snapshot
    let presence = contentPresence(snapshot.content)
    const listeners = new Set<() => void>()
    values.current.formData = snapshot
    return {
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      getContent: () => snapshot.content,
      getFormSnapshot: () => formSnapshot,
      set: (update: SetStateAction<T>) => {
        const next = typeof update === 'function' ? (update as (previous: T) => T)(snapshot) : update
        if (Object.is(next, snapshot)) return
        const nextPresence = contentPresence(next.content)
        const formChanged = presence !== nextPresence || Object.keys(next).length !== Object.keys(snapshot).length
          || Object.keys(next).some(key => key !== 'content' && !Object.is(next[key as keyof T], snapshot[key as keyof T]))
        snapshot = next
        presence = nextPresence
        values.current.formData = next
        if (formChanged) formSnapshot = next
        listeners.forEach(listener => listener())
      }
    }
  })
  const formSnapshot = useSyncExternalStore(store.subscribe, store.getFormSnapshot)
  // Event handlers retained by the form must read the newest text even when
  // only the editor rendered. Stored drafts/snapshots remain plain immutable
  // objects; this read-through view is never registered as the draft payload.
  const formData = useMemo(() => ({ ...formSnapshot, get content() { return store.getContent() } }), [formSnapshot, store])
  return [formData, store.set, store]
}

export function CampaignContentObserver({ store, children }: { store: CampaignContentStore; children: () => ReactNode }) {
  useSyncExternalStore(store.subscribe, store.getContent)
  return children()
}
