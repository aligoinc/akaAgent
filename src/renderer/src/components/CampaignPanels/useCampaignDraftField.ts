import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { restoreCampaignDraftValue, type CampaignDraftPayload } from '../../../../shared/campaignDrafts'

/** Register every persistent field here; UI-only state continues to use useState. */
export function useCampaignDraftField<T>(
  payload: CampaignDraftPayload | undefined,
  values: MutableRefObject<Record<string, unknown>>,
  key: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => restoreCampaignDraftValue(
    typeof initial === 'function' ? (initial as () => T)() : initial,
    payload?.values[key]
  ))
  values.current[key] = value
  return [value, setValue]
}
