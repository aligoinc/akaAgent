import { useCallback, useEffect, useRef, useState } from 'react'
import type { CampaignDraft, CampaignDraftSummary } from '../../../../shared/campaignDrafts'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'

const errorLabel = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))
  .replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '')

export function useCampaignDrafts(isActive: boolean) {
  const staffId = useAuthStore(state => state.user?.staffId)
  const organizationId = useAuthStore(state => state.user?.organizationId)
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [items, setItems] = useState<CampaignDraftSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [draft, setDraft] = useState<CampaignDraft | null>(null)
  const generation = useRef(0)
  const [opening, setOpening] = useState<string | null>(null)
  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    setDraft(null)
    setOpening(null)
    setItems([])
    setError('')
    return () => { generation.current++ }
  }, [staffId, organizationId])

  useEffect(() => {
    if (!isActive || !staffId || !organizationId) return
    let disposed = false
    setLoading(true)
    setError('')
    // Load summaries only, including later pages so the shared filters search every draft.
    void (async () => {
      const summaries = new Map<string, CampaignDraftSummary>()
      let loaded = 0
      for (let page = 1; !disposed; page++) {
        const result = await window.electronAPI.listCampaignDrafts(page)
        if (disposed) return
        result.items.forEach(item => summaries.set(item.id, item))
        loaded += result.items.length
        if (result.items.length === 0 || loaded >= result.total) break
      }
      if (!disposed) setItems(Array.from(summaries.values()))
    })().catch(reason => { if (!disposed) setError(errorLabel(reason)) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [isActive, staffId, organizationId, revision])

  const openDraft = async (id: string): Promise<void> => {
    const started = generation.current
    setOpening(id)
    try {
      const item = await window.electronAPI.getCampaignDraft(id)
      if (generation.current !== started) return
      if (item.isDelete) {
        showAlert('Bản nháp đã được xoá hoặc chuyển thành chiến dịch.', 'info')
        refresh()
      } else setDraft(item)
    } catch (reason) {
      if (generation.current === started) showAlert(errorLabel(reason), 'error')
    } finally { if (generation.current === started) setOpening(null) }
  }

  const deleteDraft = (item: CampaignDraftSummary): void => {
    const started = generation.current
    const message = `Xóa bản nháp “${item.name}”?`

    showConfirm(message, async () => {
      if (generation.current !== started) return
      try {
        await window.electronAPI.deleteCampaignDraft(item.id)
        if (generation.current !== started) return
        setItems(current => current.filter(row => row.id !== item.id))
        refresh()
      } catch (reason) {
        if (generation.current === started) showAlert(errorLabel(reason), 'error')
      }
    })
  }

  const closeDraft = (): void => { setDraft(null); refresh() }
  return { items, loading, error, draft, opening, refresh, openDraft, deleteDraft, closeDraft }
}
