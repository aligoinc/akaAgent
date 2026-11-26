import { useCallback, useEffect, useRef, useState } from 'react'
import { supportsCampaignSheetSync, type CampaignSheetSyncListItem } from '../../../../shared/campaignSheetSync'

/**
 * Nguồn đồng bộ Google Sheet của các chiến dịch đang hiện trong danh sách (V662): một lượt `list` cho cả trang, chỉ khi
 * tập chiến dịch đổi hoặc sau thao tác tắt / bật. Không poll.
 */
export function useCampaignSheetSyncList(campaigns: { id: number; actionId: string }[]) {
  const ids = campaigns.filter(item => supportsCampaignSheetSync(item.actionId)).map(item => item.id).sort((a, b) => a - b)
  const key = ids.join(',')
  const [items, setItems] = useState<Map<number, CampaignSheetSyncListItem>>(() => new Map())
  const [revision, setRevision] = useState(0)
  const unavailable = useRef(false)

  useEffect(() => {
    if (!key || unavailable.current) { setItems(new Map()); return }
    let disposed = false
    void window.electronAPI.campaignSheetSyncCall<{ items: CampaignSheetSyncListItem[] }>({ action: 'list', campaignIds: key.split(',').map(Number) })
      .then(result => {
        if (disposed) return
        if (!result.ok) {
          if (result.code === 'sheet_sync_not_ready') unavailable.current = true
          setItems(new Map())
          return
        }
        setItems(new Map(result.data.items.map(item => [item.campaignId, item])))
      }).catch(() => { if (!disposed) setItems(new Map()) })
    return () => { disposed = true }
  }, [key, revision])

  const refresh = useCallback(() => setRevision(value => value + 1), [])
  return { items, refresh }
}
