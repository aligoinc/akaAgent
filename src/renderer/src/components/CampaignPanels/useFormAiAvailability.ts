import { useEffect, useState } from 'react'
import { type FormAiAvailability } from '../../../../shared/campaignFormAiConfig'

/** One metadata read per mounted form/auth scope. Field edits never issue reads. */
export function useFormAiAvailability(authScope: string): FormAiAvailability[] {
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: FormAiAvailability[] }>()
  useEffect(() => {
    let current = true
    setSnapshot(undefined)
    void window.electronAPI.listCampaignFormAi().then(rows => {
      if (current) setSnapshot({ scope: authScope, rows: Array.isArray(rows) ? rows : [] })
    }, () => { if (current) setSnapshot({ scope: authScope, rows: [] }) })
    return () => { current = false }
  }, [authScope])
  return snapshot?.scope === authScope ? snapshot.rows : []
}
