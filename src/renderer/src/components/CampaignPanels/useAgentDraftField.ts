import { useState, type MutableRefObject, type Dispatch, type SetStateAction } from 'react'
import { restoreCampaignDraftValue, type CampaignDraftPayload } from '../../../../shared/campaignDrafts'
type Values = MutableRefObject<Record<string, unknown>>
const setters = new WeakMap<Values, Map<string, (value: unknown) => void>>()
/** Only the independent Agent form registers setters for atomic draft undo/rollback. */
export function useAgentDraftField<T>(payload: CampaignDraftPayload | undefined, values: Values, key: string,
  initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => restoreCampaignDraftValue(typeof initial === 'function' ? (initial as () => T)() : initial, payload?.values[key]))
  values.current[key] = value
  const registered = setters.get(values) || new Map<string, (value: unknown) => void>()
  registered.set(key, next => setValue(next as T)); setters.set(values, registered)
  return [value, setValue]
}
export function restoreAgentValues(values: Values, next: Record<string, unknown>) {
  for (const [key, set] of Array.from(setters.get(values) || [])) if (Object.hasOwn(next, key)) set(structuredClone(next[key]))
}
export function agentValuesSnapshot(values: Values): Record<string, unknown> {
  return structuredClone(Object.fromEntries(Object.entries(values.current).filter(([key]) => key !== 'agentChat')))
}
