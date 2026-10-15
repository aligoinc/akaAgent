import { useEffect, useRef, useState } from 'react'
import { CampaignEditFlow, resumeSavedCampaigns } from '../../../../shared/campaignEditFlow'
import { createCampaignConfigSaver } from '../../../../shared/campaignConfigSave'
import type { CampaignConfig } from '../../../../shared/types'
import { useAuthStore } from '../../stores/authStore'
import { useCampaignStore } from '../../stores/campaignStore'

export const saveCampaignConfig = createCampaignConfigSaver(
  (id, updates, options) => useCampaignStore.getState().updateCampaign(id, updates, options)
)

export const campaignEdit = new CampaignEditFlow<CampaignConfig>(
  id => window.electronAPI.getCampaignConfig(id),
  id => useCampaignStore.getState().updateCampaign(id, { status: 'tạm dừng' })
)

export const resumeAfterCampaignSave = (ids: number[], signal: AbortSignal): Promise<void> => resumeSavedCampaigns(
  ids, id => window.electronAPI.getCampaignConfig(id),
  id => useCampaignStore.getState().updateCampaign(id, { status: 'chờ xử lý' }), signal
)

/** Abort only the UI continuation; a dispatched pause is deliberately not undone. */
export function useCampaignEditSession(key?: unknown) {
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController()
    const controller = lifetime.current
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (!state.user || state.user.staffId !== previous.user?.staffId || state.user.organizationId !== previous.user?.organizationId) controller.abort()
    })
    return () => { controller.abort(); unsubscribe() }
  }, [key])
  return lifetime
}

export function useCampaignSaveCompletion(key?: unknown) {
  const session = useCampaignEditSession(key)
  const completion = useRef<(() => Promise<void>) | null>(null)
  const [pending, setPending] = useState(false)
  const checkpoint = (action: () => Promise<void>) => {
    if (session.current.signal.aborted) return false
    completion.current = action
    setPending(true)
    return true
  }
  const finish = async (action: () => Promise<void>) => {
    const signal = session.current.signal
    if (!checkpoint(action)) return
    await action()
    if (signal.aborted) return
    completion.current = null
    setPending(false)
  }
  useEffect(() => {
    const signal = session.current.signal
    const clear = () => { completion.current = null; setPending(false) }
    signal.addEventListener('abort', clear, { once: true })
    return () => { signal.removeEventListener('abort', clear); completion.current = null }
  }, [key, session])
  return { session, pending, hasPending: () => completion.current !== null,
    checkpoint, finish, retry: async () => { if (!completion.current) return false; await finish(completion.current); return true } }
}

export const savedCampaignCompletionError = 'Cấu hình chiến dịch đã lưu; chưa hoàn tất các bước còn lại. Bấm Thử lại hoàn tất để tiếp tục, không lưu lại cấu hình đã thành công. '
