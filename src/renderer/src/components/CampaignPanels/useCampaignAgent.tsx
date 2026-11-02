import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Sparkles } from 'lucide-react'
import { AGENT_EXTRA_FIELDS, AGENT_CAMPAIGN_LINKS, AGENT_SECTION_LABELS, AGENT_MAX_HISTORY_TURNS, agentEqual, canUndoAgentTurn, isAgentDraft,
  type AgentDraft, type AgentTurn, type AgentImage, type AgentSnapshot, type AgentReply, type AgentSection, type AgentChange } from '../../../../shared/campaignAgent'
import { splitAgentDataMessage, agentDataSafeText, isAgentCsvData, validAgentDataFiles, type AgentDataFile, type AgentDataImport } from '../../../../shared/campaignAgentData'
import { FACEBOOK_AI_FIELDS } from '../../../../shared/campaignFacebookAi'
import { agentValuesSnapshot, restoreAgentValues } from './useAgentDraftField'
import { agentChangeRows, agentLimitWindows } from './campaignAgentPresentation'
type Props = { draftId: string; authScope: string; values: MutableRefObject<Record<string, unknown>>; initial?: unknown;
  snapshot: () => AgentSnapshot; apply: (reply: AgentReply) => void | Promise<void>; selectAction: (id: string) => void;
  restore: (values: Record<string, unknown>) => void; ready: boolean; disabled: boolean; onBusy: (busy: boolean) => void; jump: (section: string, key?: string) => void;
  openDataImport: (value: AgentDataImport) => void;
  describe: (key: string, value: unknown) => string | undefined; label: (key: string) => string; actionName: (id: string) => string }
export const agentSectionStep = (section: string): string => ({ options: 'actionOptions', data: 'details', cooldown: 'deliveryCooldown',
  search: 'content', keywords: 'details', postSearch: 'commentPostSearch', newsfeed: 'newsfeedSettings', extras: 'extra', exclusions: 'exclusions' }[section] || section)
const stepSection = (id: string): AgentSection => ({ actionOptions: 'options', dataTargetSource: 'data', details: 'data',
  deliveryCooldown: 'cooldown', commentPostSearch: 'postSearch', newsfeedSettings: 'newsfeed', extra: 'extras',
  postBump: 'extras', facebookRestBrowse: 'extras', pagePostMethod: 'extras', findDataConditions: 'search', foundDataHandling: 'data', externalSms: 'extras' }[id] || id) as AgentSection
const flatten = (values: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(values).flatMap(([key, value]) =>
  key === 'formData' && value && typeof value === 'object' ? Object.entries(value).map(([field, v]) => [`formData.${field}`, v]) : [[key, value]]))
const dataTextFile = (text: string, name: string) => {
  const csv = isAgentCsvData(text)
  return new File([text], `${name}.${csv ? 'csv' : 'txt'}`, { type: csv ? 'text/csv' : 'text/plain' })
}
function retainDraftImages(ids: Set<string>, value: unknown): void {
  if (!isAgentDraft(value)) return
  for (const image of value.composer?.images || []) ids.add(image.id)
  for (const turn of value.turns) for (const image of turn.images || []) ids.add(image.id)
}

export function useCampaignAgent(props: Props) {
  const current = useRef(props); current.current = props
  const [turns, setTurns] = useState<AgentTurn[]>(() => isAgentDraft(props.initial) ? props.initial.turns : [])
  const turnsRef = useRef(turns); turnsRef.current = turns
  const [open, setOpen] = useState(true), [scope, setScope] = useState<AgentSection | null>(null)
  const [scopeStep, setScopeStep] = useState<string | null>(null)
  const initial = useRef(isAgentDraft(props.initial) ? props.initial : undefined).current
  const retainedImageIds = useRef<Set<string> | null>(null)
  if (!retainedImageIds.current) {
    retainedImageIds.current = new Set()
    retainDraftImages(retainedImageIds.current, initial)
  }
  const [draft, setDraft] = useState(initial?.composer?.text || ''), [images, setImages] = useState<AgentImage[]>([])
  const [dataText, setDataTextState] = useState(''), pendingDataText = useRef('')
  const hasPendingData = !!dataText.trim()
  const [dataFiles, setDataFiles] = useState<AgentDataFile[]>(() => [...(initial?.composer?.dataFiles || []), ...(initial?.composer?.images || []).map(image => ({ id: image.id, name: image.name, bytes: image.bytes, kind: 'image' as const, legacyImage: true }))])
  const sessionId = useRef(crypto.randomUUID()).current
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const confirmation = useRef<((ok: boolean) => void) | null>(null)
  const lock = useRef(false), epoch = useRef(0), activeRequest = useRef<string | null>(null), mounted = useRef(true)
  const inputReview = useRef(false)
  const revision = useRef(0), previous = useRef<Record<string, unknown> | null>(null)
  const fieldRevisions = useRef<Record<string, number>>({ ...initial?.fieldRevisions })
  const flat = flatten(agentValuesSnapshot(props.values))
  if (previous.current) {
    for (const key of Array.from(new Set([...Object.keys(flat), ...Object.keys(previous.current)]))) {
      if (!agentEqual(flat[key], previous.current[key])) {
        revision.current++; fieldRevisions.current[key] = (fieldRevisions.current[key] || 0) + 1
      }
    }
  }
  previous.current = flat
  props.values.current.agentChat = { version: 1, turns, fieldRevisions: fieldRevisions.current, composer: { text: draft, images, dataFiles } } satisfies AgentDraft
  const cancel = () => {
    epoch.current++; confirmation.current?.(false); confirmation.current = null; setPendingAction(null)
    if (activeRequest.current) void window.electronAPI.cancelCampaignAgent(activeRequest.current)
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; epoch.current++; confirmation.current?.(false)
      if (activeRequest.current) void window.electronAPI.cancelCampaignAgent(activeRequest.current) }
  }, [props.authScope])
  const assertActive = (generation: number) => {
    if (epoch.current !== generation || !mounted.current) throw new Error('cancelled')
  }
  const settle = async (generation: number) => {
    let last = '', stable = 0
    for (let attempt = 0; attempt < 100; attempt++) {
      assertActive(generation)
      await new Promise<void>(resolve => setTimeout(resolve, 50))
      assertActive(generation)
      const key = JSON.stringify(agentValuesSnapshot(current.current.values))
      stable = key === last && current.current.ready ? stable + 1 : 0; last = key
      if (stable >= 2) return
    }
    throw new Error('Form đang tải dữ liệu. Vui lòng thử lại khi tải xong.')
  }
  // Unattached text stays local. Hold the form/save guard until it is attached or
  // explicitly discarded, but leave file removal/retry available in the chat.
  const setDataText = (value: string) => {
    if (!mounted.current) return
    pendingDataText.current = value; setDataTextState(value)
    if (!value.trim()) setError('')
    current.current.onBusy(lock.current || !!value.trim())
  }
  const setWorking = (value: boolean) => { lock.current = value; setBusy(value); current.current.onBusy(value || !!pendingDataText.current.trim()) }
  // A rejected paste is not draft state. Hold the existing form/save mutex while
  // the user edits or discards it so closing via Save cannot lose the pending text.
  const beginInputReview = () => {
    if (lock.current || current.current.disabled) return false
    inputReview.current = true; setWorking(true); return true
  }
  const endInputReview = () => {
    if (!inputReview.current) return
    inputReview.current = false; setWorking(false)
  }
  const send = async (suggestion?: string) => {
    const sourceMessage = (suggestion ?? draft).trim()
    const split = splitAgentDataMessage(sourceMessage, scope === 'content')
    const description = split.description || (split.data || dataFiles.length ? 'Nhập dữ liệu đính kèm vào chiến dịch.' : '')
    if (lock.current || pendingDataText.current.trim() || props.disabled || !description && !dataFiles.length) return
    if (turns.length >= 998) { setError('Hội thoại đã dài. Hãy bắt đầu hội thoại mới để tiếp tục; form vẫn được giữ nguyên.'); return }
    setWorking(true); setError(''); setOpen(true)
    const generation = ++epoch.current, authScope = props.authScope, before = agentValuesSnapshot(props.values)
    let sentFiles = dataFiles
    const sameScope = () => mounted.current && current.current.authScope === authScope
    const history = turnsRef.current.slice(-AGENT_MAX_HISTORY_TURNS).map(t => ({ role: t.role,
      text: agentDataSafeText(t.contentRequest ? `Nội dung:\n${t.text}` : t.text) }))
    let touched = false, extractedText = ''
    const deadline = setTimeout(cancel, 120000)
    try {
      if (split.data) {
        sentFiles = await storeDataFiles([dataTextFile(split.data, 'Danh sách đã nhập')], sentFiles)
        assertActive(generation); setDataFiles(sentFiles)
      }
      if (description.length > 4000) throw new Error('Yêu cầu quá dài. Hãy đưa danh sách vào Đính kèm dữ liệu.')
      setTurns(old => [...old, { id: crypto.randomUUID(), role: 'user', text: description, dataFiles: sentFiles, contentRequest: scope === 'content' }])
      setDraft(''); setImages([])
      await settle(generation)
      const beforeLimitWindows = agentLimitWindows(current.current.snapshot())
      let reply: AgentReply | undefined
      for (let round = 0; round < 2; round++) {
        assertActive(generation)
        const p = current.current, requestId = crypto.randomUUID(), startRevision = revision.current
        activeRequest.current = requestId
        const snapshot = p.snapshot()
        const subset = scopeStep === 'postBump' ? (key: string) => key.startsWith('postBump') || key === 'enablePostBump'
          : scopeStep === 'facebookRestBrowse' ? (key: string) => key.startsWith('facebookRestBrowse.')
          : scopeStep === 'pagePostMethod' ? (key: string) => key === 'pagePostMode' : null
        if (subset) snapshot.lockedFields.push(...[...Object.keys(AGENT_EXTRA_FIELDS), ...Object.keys(AGENT_CAMPAIGN_LINKS)].filter(key => !subset(key)))
        const result = await window.electronAPI.generateCampaignAgent({ requestId, sessionId,
          draftId: p.draftId, revision: startRevision, description, section: scope, snapshot, images: [], dataFiles: sentFiles, history }).catch(() => { throw new Error('Không thể kết nối Agent. Bản nháp được giữ nguyên.') })
        activeRequest.current = null
        assertActive(generation)
        if (revision.current !== startRevision) throw new Error('Form vừa thay đổi. Vui lòng gửi lại yêu cầu với dữ liệu mới.')
        if (!result.ok) { extractedText = result.extractedText || ''; throw new Error(result.code === 'cancelled' ? 'cancelled' : result.message) }
        reply = result.patch; extractedText = reply.extractedText
        if (!reply.actionId) break
        if (round > 0) throw new Error('Chưa xác định được loại chiến dịch. Hãy chọn loại trên form rồi thử lại.')
        if (p.snapshot().actionId) {
          setPendingAction(reply.actionId)
          const accepted = await new Promise<boolean>(resolve => { confirmation.current = resolve })
          assertActive(generation)
          confirmation.current = null; setPendingAction(null)
          if (!accepted) throw new Error('cancelled')
        }
        touched = true; p.selectAction(reply.actionId)
        await settle(generation)
      }
      if (!reply || reply.actionId) throw new Error('Không thể hoàn tất yêu cầu.')
      touched = true
      await current.current.apply(reply)
      await settle(generation)
      assertActive(generation)
      const after = agentValuesSnapshot(current.current.values), a = flatten(before), b = flatten(after)
      const afterLimitWindows = agentLimitWindows(current.current.snapshot())
      const changed: AgentChange[] = Object.keys(b).filter(key => !agentEqual(a[key], b[key])).map(key => {
        const field = key.replace(/^formData\./, ''), spec = AGENT_EXTRA_FIELDS[field]
        const facebookKind = reply?.entries.find(e => e.section in FACEBOOK_AI_FIELDS && field in FACEBOOK_AI_FIELDS[e.section as keyof typeof FACEBOOK_AI_FIELDS])?.section as keyof typeof FACEBOOK_AI_FIELDS | undefined
        const section = facebookKind ? agentSectionStep(facebookKind) : field === 'facebookRestBrowse' ? 'facebookRestBrowse' : field === 'agentExclusionDraft' ? 'exclusions' : spec ? agentSectionStep(spec.section) : field.startsWith('schedule') || ['continueNextDay', 'refreshData', 'dailyStopTime', 'multiDailyTimeSlots', 'multiDailyTimeSlotsEnabled', 'useDailyStopTime'].includes(field) ? 'schedule'
          : /Limit|sleepBetween|postsPerTarget/.test(field) ? 'limits' : /content|Content|emailSubject/.test(field) ? 'content'
          : /details|DataGroup|dataGroup|dataTarget|Keywords/.test(field) ? 'details' : 'general'
        return { key, hidden: ['editedRateLimitMinuteActions', 'manualAdvancedContentItems', 'savedGroupAdvancedContentItems', 'candidateContentTemplateGroupId', 'pendingContentTemplateGroupId'].includes(field),
          ...(field === 'actionLimitsByCode' ? { limitWindows: { before: beforeLimitWindows, after: afterLimitWindows } } : {}),
          beforeText: current.current.describe(field, a[key]), afterText: current.current.describe(field, b[key]), label: spec?.label || (facebookKind ? FACEBOOK_AI_FIELDS[facebookKind][field]?.label : undefined) || current.current.label(field), section, before: a[key], after: b[key], revision: fieldRevisions.current[key] || 0 }
      })
      const visibleChanges = changed.flatMap(agentChangeRows).length
      const importEntry = reply.entries.find(entry => entry.section === 'data' && entry.patch.importMode)
      const dataImport: AgentDataImport | undefined = importEntry?.section === 'data' && importEntry.patch.importMode && sentFiles.length
        ? { files: sentFiles, mode: importEntry.patch.importMode, actionId: current.current.snapshot().actionId } : undefined
      const answer: AgentTurn = { id: crypto.randomUUID(), role: 'assistant',
        text: visibleChanges ? `Đã điền ${visibleChanges} thay đổi vào form. Chưa lưu chiến dịch.` : reply.message || 'Form đã khớp yêu cầu.',
        changes: changed, dataImport }
      if (dataImport) answer.text += ' Mở Upload dữ liệu để kiểm tra và bấm chèn.'
      // Keep the source on the answer so the user can reopen Upload after choosing
      // an account, including when the preview cannot open yet.
      if (dataImport) current.current.openDataImport(dataImport)
      setTurns(old => [...old, answer])
      if (changed.length) current.current.jump(changed[0].section)
      if (dataImport) setDataFiles([])
    } catch (reason) {
      if (touched && sameScope()) {
        // Reapply after action-dependent effects have settled; the form stays inert throughout rollback.
        current.current.restore(before); restoreAgentValues(current.current.values, before)
        await new Promise<void>(resolve => setTimeout(resolve, 100))
        if (sameScope()) { current.current.restore(before); restoreAgentValues(current.current.values, before) }
      }
      const message = reason instanceof Error && reason.message === 'cancelled' ? 'cancelled' : reason instanceof Error && !/raw|secret|stack|fetch|network|ECONN/i.test(reason.message) ? reason.message : 'Không thể kết nối Agent. Bản nháp được giữ nguyên.'
      if (sameScope()) {
        setTurns(old => [...old, { id: crypto.randomUUID(), role: 'assistant', text: message === 'cancelled' ? 'Đã dừng yêu cầu. Chưa áp dụng thay đổi.' : message, extractedText }])
        // The failed turn is already visible in chat. Keep composer errors for
        // attachment/input problems instead of showing the same failure twice.
      }
    } finally { clearTimeout(deadline); activeRequest.current = null; if (sameScope()) setWorking(false) }
  }
  const read = (key: string) => flat[key]
  const availableSections = props.snapshot().sections
  const undo = async (turn: AgentTurn) => {
    if (lock.current || pendingDataText.current.trim() || !canUndoAgentTurn(turn, read, key => fieldRevisions.current[key] || 0)) return
    setWorking(true)
    const values = agentValuesSnapshot(props.values)
    for (const change of turn.changes || []) {
      if (change.key.startsWith('formData.')) (values.formData as Record<string, unknown>)[change.key.slice(9)] = change.before
      else values[change.key] = change.before
    }
    current.current.restore(values); restoreAgentValues(props.values, values)
    setTurns(old => old.map(item => item.id === turn.id ? { ...item, undone: true } : item))
    try { await settle(epoch.current); current.current.restore(values); restoreAgentValues(current.current.values, values); await settle(epoch.current) } catch { /* A closed/auth-changed form must not receive state. */ } finally { if (mounted.current) setWorking(false) }
  }
  const storeDataFiles = async (files: File[], existing: AgentDataFile[]) => {
    const candidates = files.map(file => ({ id: crypto.randomUUID(), name: file.name, bytes: file.size,
      kind: /\.(xlsx|xls|csv)$/i.test(file.name) ? 'excel' as const : /^image\//.test(file.type) ? 'image' as const : 'text' as const }))
    if (!validAgentDataFiles([...existing, ...candidates])) throw new Error('Chọn tối đa 5 file, 10 MB/file và tổng 25 MB; ảnh tối đa 5 MB/ảnh, tổng 15 MB.')
    const uploads = await Promise.all(files.map(file => new Promise<{ name: string; mimeType: string; dataBase64: string }>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('Không đọc được file.'))
      reader.onload = () => resolve({ name: file.name, mimeType: file.type, dataBase64: String(reader.result).split(',')[1] })
      reader.readAsDataURL(file)
    })))
    const refs = await window.electronAPI.storeCampaignAgentData(current.current.draftId, uploads)
    return [...existing, ...refs]
  }
  const addDataFiles = async (files: File[]) => {
    if (lock.current || current.current.disabled || !files.length) return false
    setWorking(true); setError(''); const generation = epoch.current
    try {
      const refs = await storeDataFiles(files, dataFiles)
      if (mounted.current && generation === epoch.current) { setDataFiles(refs); return true }
      return false
    } catch { if (mounted.current) setError('Không đọc được dữ liệu. Tối đa 5 file, 10 MB/file Excel/CSV/TXT; 5 MB/ảnh PNG/JPEG/WebP. Tổng ảnh 15 MB, tổng file 25 MB.'); return false }
    finally { if (mounted.current) setWorking(false) }
  }
  const addDataText = async (text: string) => {
    if (lock.current || current.current.disabled) return false
    setDataText(text)
    const ok = await addDataFiles([dataTextFile(text, 'Dữ liệu đã dán')])
    if (ok) setDataText('')
    return ok
  }
  const latestChanges = [...turns].reverse().find(t => t.changes?.length && !t.undone)?.changes || []
  const removeImage = (id: string) => {
    if (lock.current || current.current.disabled) return
    setImages(old => old.filter(image => image.id !== id))
    // A local form edit must not delete bytes referenced by a saved/possibly saved draft.
    if (!retainedImageIds.current!.has(id)) void window.electronAPI.removeCampaignAgentImage(current.current.draftId, id).catch(() => {})
  }
  const sectionForStep = (step: string) => step === 'content' && availableSections.includes('search') ? 'search' : step === 'content' && !availableSections.includes('content') && availableSections.includes('extras') ? 'extras' : step === 'details' && availableSections.includes('keywords') ? 'keywords' : stepSection(step)
  const ask = (step: string) => { setScope(sectionForStep(step)); setScopeStep(step); setOpen(true) }
  const askButton = (step: string) => {
    const selected = sectionForStep(step)
    if (!availableSections.includes(selected)) return null
    return <button type="button" className="agent-ask-section" disabled={busy || hasPendingData || props.disabled}
      onClick={event => { event.stopPropagation(); ask(step) }}><Sparkles size={13} /> Hỏi Agent</button>
  }
  return { turns, open, setOpen, scope, setScope: (value: AgentSection | null) => { setScope(value); setScopeStep(null) }, draft, setDraft, images, busy, error, send, cancel, beginInputReview, endInputReview, addImages: addDataFiles, addDataFiles, addDataText, removeImage, undo, dataFiles, dataText, setDataText, hasPendingData,
    removeDataFile: (id: string) => { if (!lock.current && !current.current.disabled) setDataFiles(old => old.filter(file => file.id !== id)) },
    openDataImport: props.openDataImport,
    retainDraftImages: (value: unknown) => retainDraftImages(retainedImageIds.current!, value),
    canUndo: (turn: AgentTurn) => !busy && !hasPendingData && !props.disabled && canUndoAgentTurn(turn, read, key => fieldRevisions.current[key] || 0), askButton,
    sectionChanged: (section: string) => latestChanges.some(c => c.section === section && agentEqual(read(c.key), c.after)),
    changed: (field: string) => latestChanges.some(c => c.key === `formData.${field}` && agentEqual(read(c.key), c.after)),
    jump: props.jump, draftId: props.draftId, disabled: props.disabled,
    pendingAction: pendingAction ? props.actionName(pendingAction) : null,
    confirmAction: (accepted: boolean) => confirmation.current?.(accepted),
    newChat: () => { if (!lock.current && !pendingDataText.current.trim() && !current.current.disabled) { setTurns([]); setError(''); setScope(null); setScopeStep(null) } },
    scopeLabel: scopeStep === 'postBump' ? 'Kiêm up tin' : scopeStep === 'facebookRestBrowse' ? 'Nghỉ/lướt Facebook' : scopeStep === 'pagePostMethod' ? 'Phương thức đăng Page' : scope ? AGENT_SECTION_LABELS[scope] : 'Toàn bộ form' }
}
