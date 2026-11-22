import { useRef, useState, type MutableRefObject } from 'react'
import {
  campaignResultGroupAccepts, campaignResultGroupsWording, restoreCampaignResultGroupDrafts,
  type CampaignResultActionFlags, type CampaignResultGroupDraft
} from '../../../../shared/campaignResultGroups'
import type { CampaignDraftPayload } from '../../../../shared/campaignDrafts'
import CampaignResultGroups, { CampaignResultGroupsSaveIssue, type CampaignResultGroupsFailure } from './CampaignResultGroups'
import { campaignResultGroupsClient, isAbortError } from './campaignResultGroupsClient'
import { useCampaignResultGroups } from './useCampaignResultGroups'

/** Lỗi bật đồng bộ của một nhóm sau khi chiến dịch đã lưu (đang tạm dừng): form hiện bảng ba nút ở chân form. */
export class CampaignResultGroupSaveError extends Error {
  constructor(readonly groupId: number, message: string) {
    super(message)
    this.name = 'CampaignResultGroupSaveError'
  }
}

export interface UseCampaignFormResultGroupsInput {
  draftPayload: CampaignDraftPayload | undefined
  draftValuesRef: MutableRefObject<Record<string, unknown>>
  actionId: string
  accountIds: number[]
  accounts: Array<{ id: number; name: string }>
  flags: CampaignResultActionFlags
  /** Khung có hiện không (không có ở chiến dịch tạm tạo kèm trong form khác). */
  allowed: boolean
  /** Sửa chiến dịch đã lưu. */
  campaignId: number | null
  /** Nhân bản: chép các dòng còn dùng của chiến dịch gốc. */
  cloneFromCampaignId: number | null
}

/**
 * Nối khung "Sau khi chạy: đưa khách vào nhóm" vào một form chiến dịch Desktop (form thường và form Agent dùng chung):
 * dòng mới lưu trong nháp (khóa `campaignResultGroups`, cùng khóa với Web nên nháp mở chéo được), kiểm lỗi trước khi lưu,
 * bật đồng bộ cho từng (chiến dịch, nhóm) sau khi chiến dịch đã lưu và TRƯỚC khi bật chiến dịch.
 */
export function useCampaignFormResultGroups(input: UseCampaignFormResultGroupsInput) {
  const { draftPayload, draftValuesRef, actionId, accountIds, accounts, flags, allowed, campaignId, cloneFromCampaignId } = input
  const [rows, setRowsState] = useState<CampaignResultGroupDraft[]>(() => restoreCampaignResultGroupDrafts(draftPayload?.values.campaignResultGroups))
  draftValuesRef.current.campaignResultGroups = rows
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const setRows = (next: CampaignResultGroupDraft[]) => { rowsRef.current = next; setRowsState(next) }
  const [includeExisting, setIncludeExisting] = useState(false)
  const [failure, setFailure] = useState<CampaignResultGroupsFailure | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const state = useCampaignResultGroups({
    actionId, accountIds, flags, rows, allowed, campaignId, cloneFromCampaignId,
    onSeedRows: seeded => setRows(seeded)
  })
  const stateRef = useRef(state)
  stateRef.current = state
  const wording = campaignResultGroupsWording(actionId)

  /** Câu lỗi chặn lưu (null = được lưu). Lỗi chỉ chặn lưu chiến dịch, không chặn lưu nháp. */
  const validate = (): string | null => {
    setShowErrors(true)
    const errors = stateRef.current.issues(rowsRef.current).filter(issue => issue.severity === 'error')
    return errors.length ? errors.map(issue => issue.message).join(' ') : null
  }

  /**
   * Bật đồng bộ cho các chiến dịch vừa lưu. Đọc dòng từ ref lúc chạy để "Chọn nhóm khác" / "Bỏ nhóm này" có hiệu lực ở lượt thử
   * lại. Mỗi (chiến dịch, nhóm) một lượt gọi, mã yêu cầu cố định theo lần lưu: máy chủ khớp theo chiến dịch + nhóm nên gọi lại
   * không tạo trùng. Lỗi ném `CampaignResultGroupSaveError` mang mã nhóm.
   */
  const saveForCampaigns = async (
    campaignIds: number[],
    batch: string,
    includeExistingFor: (campaignId: number) => boolean,
    signal: AbortSignal,
    onProgress?: (label: string) => void
  ): Promise<void> => {
    const saveRows = stateRef.current.rowsForSave(rowsRef.current)
    setFailure(null)
    if (!saveRows.length || !campaignIds.length) return
    const total = saveRows.length * campaignIds.length
    let done = 0
    for (const id of campaignIds) {
      for (const row of saveRows) {
        if (signal.aborted) return
        onProgress?.(`Đang bật đồng bộ vào ${wording.groupNoun} ${done + 1}/${total}...`)
        try {
          await campaignResultGroupsClient.save(id, { rows: [row], requestId: `${batch}:${id}:${row.groupId}:result-groups`, includeExisting: includeExistingFor(id) }, signal)
        } catch (error) {
          if (signal.aborted || isAbortError(error)) return
          const message = error instanceof Error && error.message ? error.message : `Không bật được đồng bộ vào ${wording.groupNoun}.`
          setFailure({ groupId: row.groupId, message })
          throw new CampaignResultGroupSaveError(row.groupId, message)
        }
        done += 1
      }
    }
  }

  const element = (options: { disabled: boolean }) => !actionId ? null : <CampaignResultGroups state={state} actionId={actionId} accounts={accounts}
    rows={rows} onRowsChange={setRows} showErrors={showErrors} disabled={options.disabled} campaignId={campaignId}
    includeExisting={includeExisting} onIncludeExistingChange={setIncludeExisting} failure={failure} />

  const saveIssue = (options: { pending: boolean; busy: boolean; campaignCount: number; onRetry: () => void }) => {
    if (!failure || !options.pending || !actionId) return null
    const failedGroupId = failure.groupId
    const taken = new Set<number>(rows.map(row => row.groupId ?? 0))
    for (const item of state.existing.data ?? []) if (item.state !== 'stopped') taken.add(item.groupId)
    const choices = (state.groups.data ?? []).filter(group => !taken.has(group.id) && campaignResultGroupAccepts(actionId, group.dataTypeCode ?? null))
    return <CampaignResultGroupsSaveIssue failure={failure} groupName={state.groupById.get(failedGroupId)?.name ?? `#${failedGroupId}`}
      campaignCount={options.campaignCount} choices={choices} busy={options.busy} onRetry={options.onRetry}
      onChooseGroup={groupId => {
        setRows(rowsRef.current.map(row => row.groupId === failedGroupId ? { ...row, groupId } : row))
        setFailure({ groupId, message: 'Đã đổi sang nhóm khác; bấm Thử lại để bật đồng bộ.' })
      }}
      onDrop={() => { setRows(rowsRef.current.filter(row => row.groupId !== failedGroupId)); setFailure(null) }} />
  }

  return {
    /** Khung có hiện trong form không (loại chiến dịch có khung, không phải chiến dịch tạm). */
    visible: state.visible && !(state.notReady && rows.length === 0 && !(state.existing.data ?? []).length),
    title: wording.title,
    rows,
    setRows,
    state,
    validate,
    saveForCampaigns,
    element,
    saveIssue,
    includeExisting
  }
}
