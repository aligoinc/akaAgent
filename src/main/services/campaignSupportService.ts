import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CAMPAIGN_SUPPORT_BODY_BYTES, CAMPAIGN_SUPPORT_IMAGE_BYTES, CAMPAIGN_SUPPORT_IMAGE_TYPES,
  CAMPAIGN_SUPPORT_MAX_IMAGES, CAMPAIGN_SUPPORT_MAX_IMAGE_NAME, CAMPAIGN_SUPPORT_MAX_QUESTION, CAMPAIGN_SUPPORT_QUESTION,
  CAMPAIGN_SUPPORT_TOTAL_IMAGE_BYTES, isCampaignSupportRunning, isCampaignSupportTurnBusy,
  type CampaignSupportConversation, type CampaignSupportControlRequest, type CampaignSupportImage,
  type CampaignSupportImageRequest, type CampaignSupportOwner, type CampaignSupportRun,
  type CampaignSupportSendRequest, type CampaignSupportStatus, type CampaignSupportTurn
} from '../../shared/campaignSupport'
import { writeAtomicLocalFile } from './atomicLocalFile'

export const CAMPAIGN_SUPPORT_BASE = 'https://aka10000.fly.dev/api/public/agents/campaign-support'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: CampaignSupportStatus[] = ['queued', 'working', 'waiting_dependency', 'completed', 'needs_input', 'cancelled']
const positiveId = (id: number) => Number.isSafeInteger(id) && id > 0
const sameOwner = (a: CampaignSupportOwner | null, b: CampaignSupportOwner) =>
  a?.staffId === b.staffId && a?.organizationId === b.organizationId

class SupportError extends Error {
  constructor(message: string, readonly retryable = false, readonly retryAfterMs = 0,
    readonly runNotFound = false) { super(message) }
}

interface RespondBody {
  requestId: string
  conversationId?: string
  question: string
  scope?: { organizationId: number; campaignId: number }
  images: CampaignSupportImage[]
  waitSeconds: 0
}
interface Entry {
  key: string
  owner: CampaignSupportOwner
  campaignId: number
  epoch: number
  state: CampaignSupportConversation
  startRequestId?: string
  controller?: AbortController
  timer?: ReturnType<typeof setTimeout>
  failures: number
  queued: boolean
}
interface Options {
  directory: string
  getOwner: () => CampaignSupportOwner | null
  authorizeCampaign: (campaignId: number, owner: CampaignSupportOwner) => Promise<void>
  onUpdate: (state: CampaignSupportConversation) => void
  fetch?: typeof fetch
  pollIntervalMs?: number
  timeoutMs?: number
}

/** Container checks reject wrong MIME and animated PNG/WebP before upload. The API also validates images. */
export function validateCampaignSupportImages(value: unknown): CampaignSupportImage[] {
  if (!Array.isArray(value) || value.length > CAMPAIGN_SUPPORT_MAX_IMAGES) throw new SupportError('Chỉ được gửi tối đa 5 ảnh.')
  let total = 0
  return value.map(image => {
    if (image && typeof image.name === 'string' && image.name.length > CAMPAIGN_SUPPORT_MAX_IMAGE_NAME) {
      throw new SupportError('Tên ảnh tối đa 200 ký tự. Đổi tên ảnh rồi thử lại.')
    }
    if (!image || typeof image.name !== 'string' || !image.name.trim()
      || !CAMPAIGN_SUPPORT_IMAGE_TYPES.includes(image.mimeType) || typeof image.dataBase64 !== 'string'
      || image.dataBase64.length > Math.ceil(CAMPAIGN_SUPPORT_IMAGE_BYTES / 3) * 4
      || image.dataBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(image.dataBase64)) {
      throw new SupportError('Ảnh phải là PNG, JPEG hoặc WebP tĩnh, tối đa 5 MB/ảnh.')
    }
    const bytes = Buffer.from(image.dataBase64, 'base64')
    if (bytes.toString('base64') !== image.dataBase64) throw new SupportError('Dữ liệu ảnh không hợp lệ.')
    total += bytes.length
    if (!bytes.length || bytes.length > CAMPAIGN_SUPPORT_IMAGE_BYTES || total > CAMPAIGN_SUPPORT_TOTAL_IMAGE_BYTES) {
      throw new SupportError('Ảnh vượt giới hạn 5 MB/ảnh hoặc tổng 15 MB.')
    }
    let valid = false
    if (image.mimeType === 'image/jpeg') {
      valid = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    } else if (image.mimeType === 'image/png') {
      valid = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      let ended = false
      for (let offset = 8; valid && offset + 12 <= bytes.length;) {
        const length = bytes.readUInt32BE(offset)
        const type = bytes.toString('ascii', offset + 4, offset + 8)
        if (offset + length + 12 > bytes.length || type === 'acTL') { valid = false; break }
        offset += length + 12
        if (type === 'IEND') { ended = true; break }
      }
      valid = valid && ended
    } else {
      valid = bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
        && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
      for (let offset = 12; valid && offset + 8 <= bytes.length;) {
        const type = bytes.toString('ascii', offset, offset + 4)
        const length = bytes.readUInt32LE(offset + 4)
        if (offset + length + 8 > bytes.length || type === 'ANIM' || type === 'ANMF'
          || (type === 'VP8X' && length > 0 && (bytes[offset + 8] & 2) !== 0)) { valid = false; break }
        offset += 8 + length + (length % 2)
      }
    }
    if (!valid) throw new SupportError('Ảnh không hợp lệ hoặc là ảnh động. Chỉ hỗ trợ PNG/JPEG/WebP tĩnh.')
    return { name: image.name.trim(), mimeType: image.mimeType, dataBase64: image.dataBase64 }
  })
}

export function parseCampaignSupportRun(value: unknown): CampaignSupportRun {
  const data = value as CampaignSupportRun | undefined
  if (!data || !UUID.test(data.conversationId) || !UUID.test(data.turnId) || !STATUSES.includes(data.status)
    || !data.progress || data.progress.state !== data.status || typeof data.statusUrl !== 'string'
    || (data.answer !== null && typeof data.answer !== 'string')
    || (data.status === 'completed' && !data.answer?.trim())) {
    throw new SupportError('Máy chủ trả về kết quả chẩn đoán không hợp lệ.')
  }
  const expected = new URL(`${CAMPAIGN_SUPPORT_BASE}/runs/${data.conversationId}/${data.turnId}`)
  let url: URL
  try { url = new URL(data.statusUrl, `${CAMPAIGN_SUPPORT_BASE}/`) } catch { throw new SupportError('Địa chỉ tiến độ không hợp lệ.') }
  if (url.href !== expected.href) throw new SupportError('Địa chỉ tiến độ không thuộc lượt chẩn đoán này.')
  const text = (v: unknown) => typeof v === 'string' ? v : null
  return {
    conversationId: data.conversationId, turnId: data.turnId, status: data.status,
    answer: data.answer, statusUrl: expected.href,
    progress: {
      state: data.status, stage: text(data.progress.stage), reason: text(data.progress.reason),
      attempts: Number.isSafeInteger(data.progress.attempts) ? data.progress.attempts : 0,
      nextAttemptAt: text(data.progress.nextAttemptAt), startedAt: text(data.progress.startedAt), updatedAt: text(data.progress.updatedAt)
    }
  }
}

/** Owns durable requests and polling. Renderer never supplies URLs, tenant scope or remote conversation IDs. */
export class CampaignSupportService {
  private entries = new Map<string, Entry>()
  private queues = new Map<string, Promise<unknown>>()
  private epoch = 0
  private stopped = false
  private pollMs: number
  constructor(private readonly options: Options) { this.pollMs = options.pollIntervalMs ?? 2000 }

  startSession(): void { this.stopped = false }
  stop(): void {
    this.stopped = true
    this.epoch++
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer)
      entry.controller?.abort()
    }
    this.entries.clear()
  }
  private live(entry: Entry): boolean {
    return !this.stopped && entry.epoch === this.epoch && sameOwner(this.options.getOwner(), entry.owner)
  }
  private assertLive(entry: Entry): void {
    if (!this.live(entry)) throw new SupportError('Phiên đăng nhập đã thay đổi. Vui lòng mở lại trợ lý.')
  }
  private async serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const job = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
    this.queues.set(key, job)
    try { return await job } finally { if (this.queues.get(key) === job) this.queues.delete(key) }
  }
  private directory(entry: Entry): string { return join(this.options.directory, entry.key) }
  private requestFile(entry: Entry, requestId: string, conversationKey = entry.state.id): string {
    if (!UUID.test(requestId) || !UUID.test(conversationKey)) throw new SupportError('Mã hội thoại không hợp lệ.')
    return join(this.directory(entry), conversationKey, `${requestId}.json`)
  }
  private async save(entry: Entry, next: CampaignSupportConversation): Promise<void> {
    this.assertLive(entry)
    next.revision = entry.state.revision + 1
    try { await writeAtomicLocalFile(join(this.directory(entry), 'current.json'), JSON.stringify({ version: 1, ...next })) }
    catch { throw new SupportError('Không lưu được hội thoại trên máy. Kiểm tra dung lượng và thử lại.') }
    this.assertLive(entry)
    entry.state = next
    this.options.onUpdate(structuredClone(next))
  }
  private async access<T>(campaignId: number, action: (entry: Entry) => Promise<T>): Promise<T> {
    const owner = this.options.getOwner()
    const epoch = this.epoch
    if (this.stopped || !owner || !positiveId(owner.staffId) || !positiveId(owner.organizationId)) throw new SupportError('Vui lòng đăng nhập để dùng trợ lý.')
    if (!positiveId(campaignId)) throw new SupportError('Chiến dịch không hợp lệ.')
    const key = `${owner.organizationId}_${owner.staffId}/${campaignId}`
    return this.serial(key, async () => {
      if (this.stopped || epoch !== this.epoch || !sameOwner(this.options.getOwner(), owner)) throw new SupportError('Phiên đăng nhập đã thay đổi.')
      await this.options.authorizeCampaign(campaignId, owner)
      if (this.stopped || epoch !== this.epoch || !sameOwner(this.options.getOwner(), owner)) throw new SupportError('Phiên đăng nhập đã thay đổi.')
      let entry = this.entries.get(key)
      if (!entry) {
        entry = { key, owner: { ...owner }, campaignId, epoch, failures: 0, queued: false,
          state: { ...owner, campaignId, id: randomUUID(), revision: 0, turns: [] } }
        try {
          const saved = JSON.parse(await readFile(join(this.directory(entry), 'current.json'), 'utf8'))
          if (saved.version !== 1 || !sameOwner(saved, owner) || saved.campaignId !== campaignId || !UUID.test(saved.id)
            || !Number.isSafeInteger(saved.revision) || !Array.isArray(saved.turns)
            || (saved.pendingStartRequestId !== undefined && !UUID.test(saved.pendingStartRequestId))) throw new Error('Invalid storage')
          for (const turn of saved.turns as CampaignSupportTurn[]) {
            if (!UUID.test(turn.requestId) || typeof turn.question !== 'string' || !Array.isArray(turn.images)
              || ![null, 'cancel', 'resume'].includes(turn.controlPending)) throw new Error('Invalid turn')
            if (turn.result) turn.result = parseCampaignSupportRun(turn.result)
          }
          const pending = (saved.turns as CampaignSupportTurn[]).at(-1)
          if (pending?.result && pending.controlPending) {
            // Restart may have happened after the server committed a control but before we saved its response.
            pending.controlNeedsRefresh = true
            pending.error = 'Đang kiểm tra lại trạng thái lượt phân tích đã lưu.'
            pending.retryable = true
          }
          entry.state = saved
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new SupportError('Không đọc được hội thoại đã lưu trên máy.')
        }
        this.assertLive(entry)
        this.entries.set(key, entry)
      }
      const result = await action(entry)
      this.assertLive(entry)
      return result
    })
  }
  private checkKey(entry: Entry, conversationKey: string): void {
    if (entry.state.id !== conversationKey) throw new SupportError('Hội thoại đã thay đổi. Vui lòng mở lại trợ lý.')
  }
  private async append(entry: Entry, question: string, images: CampaignSupportImage[], fresh = false): Promise<void> {
    if (typeof question !== 'string' || question.trim().length > CAMPAIGN_SUPPORT_MAX_QUESTION) throw new SupportError('Câu hỏi tối đa 4.000 ký tự.')
    const cleanImages = validateCampaignSupportImages(images)
    if (!question.trim() && !cleanImages.length) throw new SupportError('Nhập câu hỏi hoặc thêm ảnh trước khi gửi.')
    const oldId = entry.state.id
    const next: CampaignSupportConversation = fresh
      ? { ...entry.owner, campaignId: entry.campaignId, id: randomUUID(), revision: entry.state.revision, turns: [] }
      : structuredClone(entry.state)
    const conversationId = next.turns.find(turn => turn.result)?.result?.conversationId
    const body: RespondBody = {
      requestId: randomUUID(), question: question.trim(), images: cleanImages, waitSeconds: 0,
      ...(conversationId ? { conversationId } : { scope: { organizationId: entry.owner.organizationId, campaignId: entry.campaignId } })
    }
    const raw = JSON.stringify(body)
    if (Buffer.byteLength(raw) > CAMPAIGN_SUPPORT_BODY_BYTES) throw new SupportError('Nội dung và ảnh vượt giới hạn 25 MB.')
    try { await writeAtomicLocalFile(this.requestFile(entry, body.requestId, next.id), raw) }
    catch { throw new SupportError('Không lưu được câu hỏi trên máy. Chưa gửi yêu cầu chẩn đoán.') }
    next.turns.push({ requestId: body.requestId, question: body.question,
      images: cleanImages.map(({ name, mimeType }) => ({ name, mimeType })), createdAt: new Date().toISOString(),
      result: null, error: null, retryable: false, controlPending: null })
    await this.save(entry, next)
    entry.failures = 0
    this.schedule(entry, 0)
    if (fresh) await rm(join(this.directory(entry), oldId), { recursive: true, force: true }).catch(() => {})
  }
  async open(campaignId: number, startRequestId?: string): Promise<CampaignSupportConversation> {
    if (!positiveId(campaignId)) throw new SupportError('Chiến dịch không hợp lệ.')
    if (startRequestId !== undefined && (typeof startRequestId !== 'string' || !UUID.test(startRequestId))) {
      throw new SupportError('Yêu cầu mở trợ lý không hợp lệ.')
    }
    const owner = this.options.getOwner()
    const cached = owner && this.entries.get(`${owner.organizationId}_${owner.staffId}/${campaignId}`)
    if (cached && this.live(cached) && cached.state.revision > 0) {
      await this.options.authorizeCampaign(campaignId, cached.owner)
      this.assertLive(cached)
      if (!startRequestId || startRequestId === cached.startRequestId || startRequestId === cached.state.pendingStartRequestId) {
        // The same menu selection may remount the panel; it must not submit again or interrupt polling.
        if (!cached.timer) this.schedule(cached, 0)
        return structuredClone(cached.state)
      }
      // Unblock cancellation from an old in-flight request. Keep its durable IDs/payload until the server stops it.
      cached.controller?.abort()
    }
    return this.access(campaignId, async entry => {
      if (startRequestId && startRequestId !== entry.startRequestId && startRequestId !== entry.state.pendingStartRequestId) {
        const last = entry.state.turns.at(-1)
        if (last && !last.runNotFound && (last.controlPending || !last.result || isCampaignSupportRunning(last.result.status))) {
          const next = structuredClone(entry.state)
          const turn = next.turns.at(-1)!
          next.pendingStartRequestId = startRequestId
          turn.controlNeedsRefresh = !!turn.result && (!!turn.controlPending || !!turn.controlNeedsRefresh)
          turn.controlPending = 'cancel'
          turn.error = null
          turn.retryable = false
          await this.save(entry, next)
          entry.failures = 0
        } else {
          await this.append(entry, CAMPAIGN_SUPPORT_QUESTION, [], true)
        }
        entry.startRequestId = startRequestId
      } else if (!entry.state.turns.length && entry.state.revision === 0) {
        // A plain first-ever open still initializes; an explicitly reset empty conversation stays empty.
        await this.append(entry, CAMPAIGN_SUPPORT_QUESTION, [])
      }
      this.schedule(entry, 0)
      return structuredClone(entry.state)
    })
  }
  send(request: CampaignSupportSendRequest): Promise<CampaignSupportConversation> {
    return this.access(request.campaignId, async entry => {
      this.checkKey(entry, request.conversationKey)
      if (entry.state.pendingStartRequestId) throw new SupportError('Đang dừng lượt cũ để hỏi lại. Vui lòng chờ.')
      const last = entry.state.turns.at(-1)
      if (last && (last.controlPending || !['completed', 'needs_input'].includes(last.result?.status ?? '') || last.error)) {
        throw new SupportError('Chờ lượt hiện tại hoàn tất trước khi hỏi tiếp.')
      }
      await this.append(entry, request.question, request.images)
      return structuredClone(entry.state)
    })
  }
  reset(campaignId: number, conversationKey: string): Promise<CampaignSupportConversation> {
    return this.access(campaignId, async entry => {
      this.checkKey(entry, conversationKey)
      if (entry.state.pendingStartRequestId || isCampaignSupportTurnBusy(entry.state.turns.at(-1))) throw new SupportError('Dừng lượt phân tích hiện tại trước khi tạo mới.')
      const oldId = entry.state.id
      await this.save(entry, { ...entry.owner, campaignId: entry.campaignId,
        id: randomUUID(), revision: entry.state.revision, turns: [] })
      entry.failures = 0
      this.schedule(entry, 0)
      await rm(join(this.directory(entry), oldId), { recursive: true, force: true }).catch(() => {})
      return structuredClone(entry.state)
    })
  }
  private interrupt(campaignId: number, conversationKey: string, allowPendingStart = true): void {
    const owner = this.options.getOwner()
    if (!owner) return
    const entry = this.entries.get(`${owner.organizationId}_${owner.staffId}/${campaignId}`)
    if (entry && entry.state.id === conversationKey && (allowPendingStart || !entry.state.pendingStartRequestId)) {
      clearTimeout(entry.timer); entry.controller?.abort()
    }
  }
  control(request: CampaignSupportControlRequest): Promise<CampaignSupportConversation> {
    if (!['cancel', 'resume'].includes(request.action)) return Promise.reject(new SupportError('Thao tác không hợp lệ.'))
    this.interrupt(request.campaignId, request.conversationKey, false)
    return this.access(request.campaignId, async entry => {
      this.checkKey(entry, request.conversationKey)
      if (entry.state.pendingStartRequestId) throw new SupportError('Đang dừng lượt cũ để hỏi lại. Vui lòng chờ.')
      const next = structuredClone(entry.state)
      const turn = next.turns.at(-1)
      if (!turn || turn.requestId !== request.requestId) throw new SupportError('Lượt phân tích đã thay đổi.')
      if (turn.runNotFound) throw new SupportError('Không tìm thấy lượt phân tích. Bấm Tạo mới để kiểm tra lại chiến dịch.')
      if (turn.result?.status === 'completed' || turn.result?.status === 'needs_input') return structuredClone(entry.state)
      if (request.action === 'resume' && turn.result?.status !== 'cancelled') throw new SupportError('Chỉ tiếp tục lượt phân tích đã dừng.')
      turn.controlNeedsRefresh = !!turn.result && (!!turn.controlPending || !!turn.controlNeedsRefresh)
      turn.controlPending = request.action
      turn.error = null
      turn.retryable = false
      await this.save(entry, next)
      this.schedule(entry, 0)
      return structuredClone(entry.state)
    })
  }
  retry(campaignId: number, conversationKey: string): Promise<CampaignSupportConversation> {
    this.interrupt(campaignId, conversationKey)
    return this.access(campaignId, async entry => {
      this.checkKey(entry, conversationKey)
      const next = structuredClone(entry.state)
      const turn = next.turns.at(-1)
      if (!turn?.retryable) throw new SupportError('Lỗi này cần được xử lý trước khi thử lại.')
      // Clearing the UI error must not clear controlNeedsRefresh after a lost response.
      turn.error = null
      turn.retryable = false
      await this.save(entry, next)
      entry.failures = 0
      this.schedule(entry, 0)
      return structuredClone(entry.state)
    })
  }
  image(request: CampaignSupportImageRequest): Promise<string> {
    return this.access(request.campaignId, async entry => {
      this.checkKey(entry, request.conversationKey)
      const turn = entry.state.turns.find(turn => turn.requestId === request.requestId)
      if (!turn || !Number.isInteger(request.index) || request.index < 0 || request.index >= turn.images.length) throw new SupportError('Không tìm thấy ảnh.')
      const body = await this.readRequest(entry, turn.requestId)
      const image = body.images[request.index]
      return `data:${image.mimeType};base64,${image.dataBase64}`
    })
  }
  private async readRequest(entry: Entry, requestId: string): Promise<RespondBody> {
    try {
      const body = JSON.parse(await readFile(this.requestFile(entry, requestId), 'utf8')) as RespondBody
      const expectedConversation = entry.state.turns.find(t => t.result)?.result?.conversationId
      if (body.requestId !== requestId || typeof body.question !== 'string' || body.question.length > CAMPAIGN_SUPPORT_MAX_QUESTION
        || (body.conversationId ? body.conversationId !== expectedConversation
          : body.scope?.organizationId !== entry.owner.organizationId || body.scope?.campaignId !== entry.campaignId)) throw new Error('Invalid request')
      body.images = validateCampaignSupportImages(body.images)
      return body
    } catch { throw new SupportError('Không đọc được câu hỏi đã lưu. Không thể thử lại an toàn.') }
  }
  private hasWork(entry: Entry): boolean {
    const turn = entry.state.turns.at(-1)
    if (entry.state.pendingStartRequestId && turn?.runNotFound) return true
    return !!turn && !turn.runNotFound && !(turn.error && !turn.retryable)
      && (!!entry.state.pendingStartRequestId || !!turn.controlPending || !turn.result || isCampaignSupportRunning(turn.result.status))
  }
  private canStartPending(entry: Entry): boolean {
    const turn = entry.state.turns.at(-1)
    return !!entry.state.pendingStartRequestId && !!turn && (turn.runNotFound
      || (!!turn.result && !turn.controlPending && !isCampaignSupportRunning(turn.result.status)))
  }
  private schedule(entry: Entry, delay: number): void {
    if (entry.controller || entry.queued) return
    clearTimeout(entry.timer)
    entry.timer = undefined
    if (!this.live(entry) || !this.hasWork(entry)) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      entry.queued = true
      void this.serial(entry.key, () => { entry.queued = false; return this.tick(entry) }).catch(() => {})
    }, delay)
  }
  private async tick(entry: Entry): Promise<void> {
    if (!this.live(entry) || !this.hasWork(entry)) return
    const turn = entry.state.turns.at(-1)!
    const controller = new AbortController()
    entry.controller = controller
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, this.options.timeoutMs ?? 60_000)
    let delay = this.pollMs
    try {
      if (this.canStartPending(entry)) {
        // Cancellation is durable before replacing the conversation. Recheck access before the deferred new question.
        try { await this.options.authorizeCampaign(entry.campaignId, entry.owner) }
        catch { throw new SupportError('Không kiểm tra được quyền truy cập chiến dịch. Chọn lại trợ lý để thử lại.') }
        this.assertLive(entry)
        if (controller.signal.aborted) return
        const startRequestId = entry.state.pendingStartRequestId!
        await this.append(entry, CAMPAIGN_SUPPORT_QUESTION, [], true)
        entry.startRequestId = startRequestId
        delay = 0
        return
      }
      // A lost control response may already have committed. Read the known run before replaying the command.
      const checkingControl = turn.result && turn.controlPending && turn.controlNeedsRefresh
      const control = turn.result && !checkingControl && turn.controlPending
      const url = turn.result ? turn.result.statusUrl : `${CAMPAIGN_SUPPORT_BASE}/respond`
      const body = control ? JSON.stringify({ action: control })
        : !turn.result ? JSON.stringify(await this.readRequest(entry, turn.requestId)) : undefined
      this.assertLive(entry)
      if (controller.signal.aborted) return
      const response = await (this.options.fetch ?? fetch)(url, {
        method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
        signal: controller.signal, redirect: 'error', credentials: 'omit'
      })
      const retryAfter = response.headers.get('Retry-After')
      const retryMs = retryAfter ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0
      const safeRetryMs = Number.isFinite(retryMs) ? Math.min(Math.max(0, retryMs), 2_147_000_000) : 0
      delay = Math.max(this.pollMs, safeRetryMs)
      const data = await response.json().catch(() => null) as {
        success?: boolean; error?: { code?: unknown; message?: unknown }; data?: unknown
      } | null
      if (!response.ok || !data?.success) {
        if (turn.result && response.status === 404 && data?.error?.code === 'NOT_FOUND') {
          throw new SupportError('Không tìm thấy lượt phân tích. Bấm Tạo mới để kiểm tra lại chiến dịch.', false, 0, true)
        }
        throw new SupportError(typeof data?.error?.message === 'string' ? data.error.message.slice(0, 1000)
          : 'Không thể nhận kết quả từ máy chủ chẩn đoán.', response.status === 429 || response.status >= 500, safeRetryMs)
      }
      const result = parseCampaignSupportRun(data.data)
      const existingConversation = entry.state.turns.find(t => t.result)?.result?.conversationId
      if ((existingConversation && result.conversationId !== existingConversation)
        || (turn.result && result.turnId !== turn.result.turnId)) throw new SupportError('Kết quả không khớp hội thoại hiện tại.')
      this.assertLive(entry)
      if (controller.signal.aborted) return
      const next = structuredClone(entry.state)
      let controlPending = turn.controlPending
      if (control || (controlPending === 'cancel' && !isCampaignSupportRunning(result.status))
        || (controlPending === 'resume' && result.status !== 'cancelled')) controlPending = null
      Object.assign(next.turns.at(-1)!, { result, error: null, retryable: false,
        controlPending, controlNeedsRefresh: false, runNotFound: false })
      await this.save(entry, next)
      entry.failures = 0
      if (this.canStartPending(entry)) delay = 0
    } catch (error) {
      if (!this.live(entry) || (controller.signal.aborted && !timedOut)) return
      const failure = error instanceof SupportError ? error : new SupportError('Mất kết nối máy chủ. Đang thử lại lượt phân tích này.', true)
      const next = structuredClone(entry.state)
      const failedTurn = next.turns.at(-1)!
      Object.assign(failedTurn, { error: failure.message, retryable: failure.retryable, runNotFound: failure.runNotFound })
      if (!failure.retryable) failedTurn.controlPending = null
      failedTurn.controlNeedsRefresh = !!failedTurn.result && !!failedTurn.controlPending
      entry.failures++
      delay = Math.max(failure.retryAfterMs, Math.min(30_000, this.pollMs * 2 ** Math.min(entry.failures, 4)))
      try { await this.save(entry, next) } catch {
        // Keep the original durable request for recovery; never create a replacement UUID.
        if (this.live(entry)) {
          next.revision = entry.state.revision + 1
          Object.assign(next.turns.at(-1)!, { error: 'Không lưu được tiến độ trên máy. Mở lại trợ lý để phục hồi.', retryable: false })
          entry.state = next
          this.options.onUpdate(structuredClone(next))
        }
      }
    } finally {
      clearTimeout(timeout)
      if (entry.controller === controller) entry.controller = undefined
      this.schedule(entry, delay)
    }
  }
}
