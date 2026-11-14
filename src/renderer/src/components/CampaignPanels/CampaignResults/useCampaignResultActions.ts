import { useCallback, useEffect, useRef, useState } from 'react'
import { CAMPAIGN_RESULT_ACTIONS_UNAVAILABLE, type CampaignResultActions } from '../../../../../shared/campaignResultActions'

export type CampaignResultActionsState =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: CampaignResultActions | null }
  | { status: 'ready'; data: CampaignResultActions }
  | { status: 'error'; data: CampaignResultActions | null; message: string; notReady: boolean }

const IDLE: CampaignResultActionsState = { status: 'idle', data: null }

/**
 * Danh sách hành động của bộ lọc Hành động (tab Kết quả chạy), như WebApp: không tải khi mở tab; chỉ tải lần đầu người
 * dùng mở bảng chọn hoặc đang ở một hành động/chế độ gộp; `reload` (nút Tải lại) chỉ tải lại khi đã từng tải. Đổi chiến
 * dịch thì về trạng thái chưa tải và bỏ kết quả muộn của chiến dịch cũ. Không polling, không tự thử lại.
 */
export function useCampaignResultActions(campaignId: number | null) {
  const [state, setState] = useState<CampaignResultActionsState>(IDLE)
  const stateRef = useRef(state)
  stateRef.current = state
  const token = useRef(0)

  useEffect(() => {
    token.current += 1
    setState(IDLE)
  }, [campaignId])

  const start = useCallback(() => {
    if (!campaignId || !window.electronAPI?.campaignResultActions) return
    const current = ++token.current
    setState(previous => ({ status: 'loading', data: previous.data }))
    window.electronAPI.campaignResultActions({ kind: 'actions', campaignId }).then(result => {
      if (token.current !== current) return
      // Câu trả lời sai hình dạng thì coi như lỗi, không để cả khung chi tiết vỡ.
      if (result.ok && (!result.data || !Array.isArray(result.data.actions) || !Number.isFinite(result.data.total))) {
        setState(previous => ({ status: 'error', data: previous.data, notReady: false, message: CAMPAIGN_RESULT_ACTIONS_UNAVAILABLE }))
        return
      }
      if (result.ok) setState({ status: 'ready', data: result.data })
      else setState(previous => ({
        status: 'error', data: previous.data, notReady: result.code === 'campaign_result_actions_not_ready',
        message: result.message || CAMPAIGN_RESULT_ACTIONS_UNAVAILABLE
      }))
    }).catch(() => {
      if (token.current !== current) return
      setState(previous => ({ status: 'error', data: previous.data, notReady: false, message: CAMPAIGN_RESULT_ACTIONS_UNAVAILABLE }))
    })
  }, [campaignId])

  const load = useCallback(() => {
    const status = stateRef.current.status
    if (status === 'idle' || status === 'error') start()
  }, [start])
  const reload = useCallback(() => {
    if (stateRef.current.status !== 'idle') start()
  }, [start])

  useEffect(() => () => { token.current += 1 }, [])
  return { state, load, reload }
}
