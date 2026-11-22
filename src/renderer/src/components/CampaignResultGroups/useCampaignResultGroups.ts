import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  campaignResultEnabledActionCodes,
  campaignResultGroupRowsForSave,
  campaignResultGroupsSupported,
  campaignResultUsableKeys,
  parseCampaignResultGroupList,
  validateCampaignResultGroups,
  type CampaignResultActionFlags,
  type CampaignResultGroupDraft,
  type CampaignResultGroupIssue,
  type CampaignResultGroupItem,
  type CampaignResultGroupOptions,
  type CampaignResultKeyFilter
} from '../../../../shared/campaignResultGroups'
import type { DataGroup } from '../../../../shared/types'
import { campaignResultGroupsClient, campaignResultGroupsKnownNotReady, isAbortError, isNotReadyError, listOwnDataGroups } from './campaignResultGroupsClient'

export interface CampaignResultGroupsLoad<T> {
  data: T | null
  loading: boolean
  error: string | null
}

type OptionsResponse = CampaignResultGroupOptions & { enabled?: boolean }

const idle = <T,>(): CampaignResultGroupsLoad<T> => ({ data: null, loading: false, error: null })
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message || fallback : fallback
const isAbort = isAbortError

/** Dòng đã có của chiến dịch còn giữ nhóm (chưa dừng hẳn): dòng mới không được dùng lại nhóm này. */
const holdsGroup = (item: CampaignResultGroupItem) => item.state !== 'stopped'

export interface UseCampaignResultGroupsInput {
  actionId: string
  accountIds: number[]
  flags: CampaignResultActionFlags
  rows: CampaignResultGroupDraft[]
  /** Khung có hiện không (không hiện ở bước Quy trình, chiến dịch Facebook…). */
  allowed: boolean
  /** Sửa chiến dịch: đọc các dòng đã có một lần khi mở form. */
  campaignId?: number | null
  /** Nhân bản: chép các dòng còn dùng của chiến dịch gốc thành dòng mới (một lần, khi form chưa có dòng nào). */
  cloneFromCampaignId?: number | null
  onSeedRows?: (rows: CampaignResultGroupDraft[]) => void
}

/**
 * Chuyển từ akaAgentWebApp apps/web/src/features/campaignResultGroups/useCampaignResultGroups.ts: thay `controlApi` bằng IPC
 * (tiến trình chính gọi API Web bằng token phiên Desktop), danh sách nhóm đọc qua `listDataGroups` sẵn có. Thêm: API chưa có
 * đường của Desktop (`campaign_result_groups_not_ready`) thì `notReady` và khung chỉ hiện câu báo khi còn dòng (để khách bỏ).
 *
 * Dữ liệu của khung "Sau khi chạy: đưa khách vào nhóm" (docs/CAMPAIGN_RESULT_GROUPS.md của WebApp).
 * Không gọi máy chủ khi khách chưa dùng khung: danh mục kết quả và danh sách nhóm chỉ tải khi có dòng hoặc khách bấm
 * "+ Thêm nhóm"; dòng đã có chỉ đọc khi sửa (hoặc nhân bản) chiến dịch. Không polling.
 */
export function useCampaignResultGroups(input: UseCampaignResultGroupsInput) {
  const { actionId, accountIds, flags, rows, allowed, campaignId, cloneFromCampaignId, onSeedRows } = input
  const visible = allowed && campaignResultGroupsSupported(actionId)
  const [opened, setOpened] = useState(false)
  const [notReady, setNotReady] = useState(() => campaignResultGroupsKnownNotReady())
  const wanted = visible && (opened || rows.length > 0)
  const accountKey = Array.from(new Set(accountIds)).filter(id => id > 0).sort((a, b) => a - b).join(',')

  const [options, setOptions] = useState<CampaignResultGroupsLoad<OptionsResponse>>(idle)
  const [optionsRevision, setOptionsRevision] = useState(0)
  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    setOptions(current => ({ data: current.data?.actionId === actionId ? current.data : null, loading: true, error: null }))
    // Đổi tài khoản liên tiếp (chọn nhiều tài khoản) chỉ gửi một lượt.
    const timer = window.setTimeout(() => {
      Promise.resolve().then(() => campaignResultGroupsClient.options(actionId, accountKey ? accountKey.split(',').map(Number) : [], controller.signal))
        .then(data => {
          if (controller.signal.aborted) return
          if (!data || !Array.isArray(data.actions)) throw new Error('Chưa tải được danh sách kết quả.')
          setOptions({ data, loading: false, error: null })
        })
        .catch(error => {
          if (controller.signal.aborted || isAbort(error)) return
          if (isNotReadyError(error)) setNotReady(true)
          setOptions(current => ({ data: current.data, loading: false, error: errorText(error, 'Chưa tải được danh sách kết quả.') }))
        })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [wanted, actionId, accountKey, optionsRevision])

  const [groups, setGroups] = useState<CampaignResultGroupsLoad<DataGroup[]>>(idle)
  const [groupsRevision, setGroupsRevision] = useState(0)
  useEffect(() => {
    if (!wanted) return
    let active = true
    setGroups(current => ({ data: current.data, loading: true, error: null }))
    // Chỉ nhóm của chính nhân viên: nhóm được chia sẻ không nhận khách từ chiến dịch của người khác.
    Promise.resolve().then(() => listOwnDataGroups())
      .then(data => { if (active) setGroups({ data, loading: false, error: null }) })
      .catch(error => { if (active) setGroups(current => ({ data: current.data, loading: false, error: errorText(error, 'Chưa tải được danh sách nhóm khách hàng.') })) })
    return () => { active = false }
  }, [wanted, groupsRevision])

  const [existing, setExisting] = useState<CampaignResultGroupsLoad<CampaignResultGroupItem[]>>(idle)
  const [existingRevision, setExistingRevision] = useState(0)
  useEffect(() => {
    if (!visible || !campaignId) return
    const controller = new AbortController()
    setExisting(current => ({ data: current.data, loading: true, error: null }))
    // Lỗi của lượt đọc (kể cả lỗi đồng bộ) chỉ hiện trong khung, không làm hỏng form sửa.
    Promise.resolve().then(() => campaignResultGroupsClient.list(campaignId, controller.signal))
      .then(result => { if (!controller.signal.aborted) setExisting({ data: parseCampaignResultGroupList(result).items, loading: false, error: null }) })
      .catch(error => {
        if (controller.signal.aborted || isAbort(error)) return
        if (isNotReadyError(error)) { setNotReady(true); setExisting(idle); return }
        setExisting(current => ({ data: current.data, loading: false, error: errorText(error, 'Chưa tải được các nhóm đang đồng bộ.') }))
      })
    return () => controller.abort()
  }, [visible, campaignId, existingRevision])

  const seeded = useRef(false)
  const seedRef = useRef(onSeedRows)
  seedRef.current = onSeedRows
  useEffect(() => {
    if (!visible || !cloneFromCampaignId || seeded.current || rows.length > 0) return
    seeded.current = true
    const controller = new AbortController()
    Promise.resolve().then(() => campaignResultGroupsClient.list(cloneFromCampaignId, controller.signal))
      .then(result => {
        if (controller.signal.aborted) return
        const copied = parseCampaignResultGroupList(result).items.filter(item => item.state !== 'stopped' && !item.groupDeleted)
          .map((item, index) => ({ key: `clone-${item.id}-${index}`, groupId: item.groupId, keys: [...item.keys] }))
        if (copied.length) seedRef.current?.(copied)
      })
      .catch(() => { /* Nhân bản vẫn chạy được: khách tự thêm dòng nếu cần. */ })
    return () => controller.abort()
  }, [visible, cloneFromCampaignId])

  const enabledActionCodes = useMemo(() => campaignResultEnabledActionCodes(actionId, flags),
    [actionId, flags.enableMessage, flags.enableAddFriend, flags.enableComment, flags.enableZaloTag, flags.enableZaloAlias])
  const usableKeys: CampaignResultKeyFilter = useMemo(() => campaignResultUsableKeys(options.data, enabledActionCodes), [options.data, enabledActionCodes])
  const groupById = useMemo(() => new Map((groups.data ?? []).map(group => [group.id, group])), [groups.data])
  const groupTypeOf = useCallback((groupId: number) => {
    if (!groups.data) return undefined
    const group = groupById.get(groupId)
    return group ? group.dataTypeCode ?? null : undefined
  }, [groups.data, groupById])
  const groupAccountOf = useCallback((groupId: number) => {
    if (!groups.data) return undefined
    const group = groupById.get(groupId)
    return group ? group.boundZaloAccountId ?? null : undefined
  }, [groups.data, groupById])
  const disabledBySwitch = options.data?.enabled === false

  const issues = useCallback((list: CampaignResultGroupDraft[]): CampaignResultGroupIssue[] => {
    if (!visible || list.length === 0) return []
    // API chưa có đường của Desktop: không lưu được dòng nào, chặn lưu để khách bỏ các dòng (không lặng lẽ bỏ lựa chọn).
    if (notReady) return [{ index: -1, code: 'group_missing', severity: 'error', message: 'Máy chủ chưa hỗ trợ đưa khách vào nhóm. Bỏ các dòng nhóm để lưu chiến dịch.' }]
    if (disabledBySwitch) return []
    const found = validateCampaignResultGroups(list, { actionId, allowedKeys: usableKeys, groupTypeOf, groupAccountOf, accountIds: accountKey ? accountKey.split(',').map(Number) : [] })
    const taken = new Set((existing.data ?? []).filter(holdsGroup).map(item => item.groupId))
    list.forEach((row, index) => {
      if (row.groupId && taken.has(row.groupId) && !found.some(issue => issue.index === index && issue.code === 'group_duplicate')) {
        found.push({ index, code: 'group_duplicate', severity: 'error', message: `Nhóm ${index + 1}: nhóm này đang có một dòng đồng bộ ở trên.` })
      }
    })
    return found
  }, [visible, notReady, disabledBySwitch, actionId, usableKeys, groupTypeOf, groupAccountOf, accountKey, existing.data])

  const rowsForSave = useCallback((list: CampaignResultGroupDraft[]) => {
    if (!visible || disabledBySwitch) return []
    const taken = new Set((existing.data ?? []).filter(holdsGroup).map(item => item.groupId))
    return campaignResultGroupRowsForSave(list, usableKeys).filter(row => !taken.has(row.groupId))
  }, [visible, disabledBySwitch, usableKeys, existing.data])

  const replaceExisting = useCallback((item: CampaignResultGroupItem) => {
    setExisting(current => ({ ...current, data: (current.data ?? []).map(entry => entry.journeyId === item.journeyId ? item : entry) }))
  }, [])

  return {
    visible,
    notReady,
    wanted,
    disabledBySwitch,
    open: () => setOpened(true),
    options,
    reloadOptions: () => setOptionsRevision(value => value + 1),
    groups,
    groupById,
    reloadGroups: () => setGroupsRevision(value => value + 1),
    /** Thêm nhóm vừa tạo vào danh sách ngay (không chờ lượt đọc lại). */
    addGroup: (group: DataGroup) => setGroups(current => ({ ...current, data: [group, ...(current.data ?? []).filter(item => item.id !== group.id)] })),
    existing,
    reloadExisting: () => setExistingRevision(value => value + 1),
    replaceExisting,
    enabledActionCodes,
    usableKeys,
    groupTypeOf,
    issues,
    rowsForSave
  }
}

export type CampaignResultGroupsState = ReturnType<typeof useCampaignResultGroups>
