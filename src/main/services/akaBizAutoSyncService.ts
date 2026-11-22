import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { resolve } from 'path'
import {
  campaignInSelection,
  campaignPlatform,
  normalizeUpdatedWithinDays,
  type AkaBizAutoBeginAccount,
  type AkaBizAutoCampaignSummary,
  type AkaBizAutoSyncConnectResult,
  type AkaBizAutoSyncItem,
  type AkaBizAutoSyncProgress,
  type AkaBizAutoSyncReport,
  type AkaBizAutoSyncSettings
} from '../../shared/akaBizAutoSync'

/**
 * Phương án 2 của đồng bộ akaBiz Auto → akaAgent: đọc file SQLite akaBiz Desktop đã liên kết (CHỈ ĐỌC) rồi gọi API Web theo
 * hợp đồng akaAgentWebApp docs/AKABIZ_AUTO_SYNC.md. Mọi quy tắc ánh xạ nằm ở API; ở đây chỉ đọc dòng thô, lọc để đếm và lặp
 * verify → begin → campaign → inputs → publish → finish. Mật khẩu akaBiz chỉ nằm trong bộ nhớ của phiên đồng bộ đang mở,
 * không ghi log, không trả lại giao diện. Tệp này không nhập Electron: nơi gọi truyền token phiên Desktop, `fetch`, cách ngủ.
 */

export const AKABIZ_AUTO_SYNC_API_BASE = (process.env.AKA_AGENT_AKABIZ_AUTO_SYNC_API_URL || 'https://agent.akabiz.net').replace(/\/+$/, '')
const SYNC_PREFIX = '/api/aka-agent/akabiz-auto-sync/v1'
const DESKTOP_VERIFY_PATH = '/api/aka-agent/desktop/v1/akabiz-auto-sync/verify'
const REQUEST_TIMEOUT_MS = 60_000
const RETRY_DELAY_MS = 5_000
const MAX_FAILURES = 5
const MAX_BUSY_WAITS = 60
const MAX_CAMPAIGN_RESTARTS = 3
const BATCH_SIZE = 500
const BATCH_MAX_BYTES = 6 * 1024 * 1024
const ERROR_MESSAGE_MAX = 500
const BUSY_TIMEOUT_MS = 5_000

type Row = Record<string, unknown>

export class AkaBizAutoSyncError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown, readonly httpStatus = 0) {
    super(message)
  }
}

export interface AkaBizAutoSyncDeps {
  baseUrl: string
  /** Token phiên Desktop đang đăng nhập (chỉ gửi kèm lời gọi verify). */
  token(signal: AbortSignal): Promise<string>
  fetch: typeof fetch
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  now(): number
  retryDelayMs?: number
  requestTimeoutMs?: number
}

export interface AkaBizAutoSyncSource {
  dbPath: string
  /** Tên đăng nhập akaBiz đã liên kết ở thẻ "akaBiz Desktop". */
  username: string
}

interface Session {
  dbPath: string
  installId: string
  username: string
  password: string
  ticket: string
  sourceStaffId: number
  sourceAccountId: number
}

const MESSAGES: Record<string, string> = {
  akabiz_sync_not_ready: 'Máy chủ akaAgent chưa hỗ trợ đồng bộ akaBiz Auto. Vui lòng thử lại sau.',
  akabiz_sync_network: 'Không kết nối được máy chủ akaAgent. Kiểm tra mạng rồi thử lại.',
  akabiz_sync_failed: 'Máy chủ đang bận hoặc gặp lỗi tạm thời. Vui lòng thử lại.',
  akabiz_sync_db_missing: 'Không tìm thấy file dữ liệu akaBiz Desktop. Kiểm tra lại thư mục cài đặt ở thẻ akaBiz Desktop.',
  akabiz_sync_db_busy: 'akaBiz Desktop đang ghi dữ liệu nên chưa đọc được. Vui lòng thử lại sau ít phút.',
  akabiz_sync_db_invalid: 'File dữ liệu akaBiz Desktop không đúng định dạng.',
  akabiz_sync_no_session: 'Phiên đồng bộ đã đóng. Vui lòng nhập lại mật khẩu akaBiz.',
  akabiz_sync_cancelled: 'Đã dừng.',
  akabiz_sync_running: 'Đang có một lượt đồng bộ chạy.',
  akabiz_sync_stuck: 'Đồng bộ không tiến thêm được. Vui lòng thử lại sau.',
  akabiz_sync_session_unavailable: 'Phiên đăng nhập akaAgent đã hết hạn. Vui lòng đăng nhập lại app.'
}

export const messageFor = (code: string, fallback?: string): string => MESSAGES[code] || fallback || MESSAGES.akabiz_sync_failed

// ---------------------------------------------------------------- SQLite (chỉ đọc)

function openReadOnly(dbPath: string): Database.Database {
  if (!dbPath || !existsSync(dbPath)) throw new AkaBizAutoSyncError('akabiz_sync_db_missing', messageFor('akabiz_sync_db_missing'))
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: BUSY_TIMEOUT_MS })
    return db
  } catch (error) {
    throw sqliteError(error)
  }
}

function sqliteError(error: unknown): AkaBizAutoSyncError {
  if (error instanceof AkaBizAutoSyncError) return error
  const code = (error as { code?: string } | null)?.code || ''
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return new AkaBizAutoSyncError('akabiz_sync_db_busy', messageFor('akabiz_sync_db_busy'))
  return new AkaBizAutoSyncError('akabiz_sync_db_invalid', messageFor('akabiz_sync_db_invalid'))
}

function withDb<T>(dbPath: string, run: (db: Database.Database) => T): T {
  const db = openReadOnly(dbPath)
  try {
    return run(db)
  } catch (error) {
    throw sqliteError(error)
  } finally {
    db.close()
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)
}

const DATE_TEXT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,7})?\d*(?:Z|[+-]\d{2}:?\d{2})?$/

/** Ngày SQLite (System.Data.SQLite lưu `yyyy-MM-dd HH:mm:ss.fffffff`) → `yyyy-MM-ddTHH:mm:ss[.fffffff]` như akaBiz Auto gửi. */
export function normalizeDateText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const match = DATE_TEXT.exec(value.trim())
  if (!match) return value
  const fraction = match[3] && !/^\.0+$/.test(match[3]) ? match[3] : ''
  return `${match[1]}T${match[2]}${fraction}`
}

/**
 * Dòng đọc từ SQLite → giá trị như akaBiz Auto (EF6 + Newtonsoft) gửi: cột BIT thành true/false, cột ngày thành
 * `yyyy-MM-ddTHH:mm:ss`, Buffer bỏ. Kiểu cột lấy từ khai báo của bảng (cột thêm bằng ALTER TABLE cũng có kiểu khai báo).
 */
function readRows(db: Database.Database, sql: string, params: unknown[]): Row[] {
  const statement = db.prepare(sql)
  const columns = statement.columns()
  const kinds = new Map<string, 'bool' | 'date' | 'other'>()
  for (const column of columns) {
    const type = String(column.type || '').toUpperCase()
    kinds.set(column.name, /^(BIT|BOOL)/.test(type) ? 'bool' : /(DATE|TIME)/.test(type) ? 'date' : 'other')
  }
  return (statement.all(...params) as Row[]).map(raw => {
    const row: Row = {}
    for (const [key, value] of Object.entries(raw)) {
      if (Buffer.isBuffer(value)) continue
      const kind = kinds.get(key)
      if (kind === 'bool') row[key] = value === null || value === undefined ? null : value === true || Number(value) !== 0
      else if (kind === 'date' || /^(Date|Schedule)/.test(key)) row[key] = normalizeDateText(value)
      else row[key] = typeof value === 'bigint' ? Number(value) : value
    }
    return row
  })
}

function maxDate(...values: unknown[]): string | null {
  const dates = values.map(normalizeDateText).filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
  return dates.sort().pop()?.slice(0, 19) ?? null
}

/** `installId`: bảng `akaAgentSyncSetting` (akaBiz Auto tạo) nếu có, còn lại sha256(đường dẫn đầy đủ, chữ thường) 32 ký tự. */
export function readInstallId(db: Database.Database, dbPath: string): string {
  if (tableExists(db, 'akaAgentSyncSetting')) {
    const row = db.prepare("SELECT Value FROM akaAgentSyncSetting WHERE Key='install_id' LIMIT 1").get() as { Value?: unknown } | undefined
    const value = typeof row?.Value === 'string' ? row.Value.trim() : ''
    if (/^[A-Za-z0-9-]{8,64}$/.test(value)) return value
  }
  return createHash('sha256').update(resolve(dbPath).toLowerCase(), 'utf8').digest('hex').slice(0, 32)
}

export function readCampaignSummaries(db: Database.Database, accountId: number, staffId: number): AkaBizAutoCampaignSummary[] {
  const rows = db.prepare(`SELECT Id, Name, ShopId, CampaignActionId, Status, DateCreate, DateEdit, DateUpdateCampaignDetail
    FROM autoCampaign WHERE AccountId=? AND StaffId=? AND (IsDelete IS NULL OR IsDelete=0) ORDER BY Id`).all(accountId, staffId) as Row[]
  return rows.map(row => ({
    id: Number(row.Id),
    name: typeof row.Name === 'string' && row.Name.trim() ? row.Name.trim() : `Chiến dịch ${row.Id}`,
    shopId: Number(row.ShopId),
    platform: campaignPlatform(String(row.CampaignActionId || '')),
    actionId: String(row.CampaignActionId || ''),
    status: typeof row.Status === 'string' ? row.Status.trim() : '',
    lastUpdatedAt: maxDate(row.DateCreate, row.DateEdit, row.DateUpdateCampaignDetail)
  }))
}

function readCampaignRow(db: Database.Database, id: number): Row | null {
  const rows = readRows(db, 'SELECT * FROM autoCampaign WHERE Id=? LIMIT 1', [id])
  if (!rows[0]) return null
  const row = rows[0]
  delete row.Log
  return row
}

const csvIds = (value: unknown): number[] => [...new Set(String(value ?? '').split(',').map(part => Number.parseInt(part.trim(), 10))
  .filter(id => Number.isSafeInteger(id) && id > 0))]

function readRefs(db: Database.Database, campaign: Row, sourceStaffId: number): { shopContacts: Row[]; akaBizTags: Row[]; limits: Row[] } {
  const shopContacts: Row[] = []
  if (tableExists(db, 'autoShopContact')) {
    const contactId = Number(campaign.ShopContactId)
    if (Number.isSafeInteger(contactId) && contactId > 0) shopContacts.push(...readRows(db, 'SELECT * FROM autoShopContact WHERE Id=?', [contactId]))
    const fanpage = typeof campaign.FanpageUid === 'string' ? campaign.FanpageUid.trim() : ''
    if (fanpage) {
      for (const row of readRows(db, "SELECT * FROM autoShopContact WHERE ShopId=? AND Type='page' AND Uid=?", [campaign.ShopId, fanpage])) {
        if (!shopContacts.some(existing => existing.Id === row.Id)) shopContacts.push(row)
      }
    }
  }
  const tagIds = csvIds(campaign.AkaBizTagIds).slice(0, 500)
  const akaBizTags = tagIds.length && tableExists(db, 'AkaBizTag')
    ? readRows(db, `SELECT * FROM AkaBizTag WHERE Id IN (${tagIds.map(() => '?').join(',')})`, tagIds)
    : []
  const limits = tableExists(db, 'autoLimit') ? readRows(db, 'SELECT * FROM autoLimit WHERE StaffId=?', [sourceStaffId]) : []
  return { shopContacts, akaBizTags, limits }
}

function readCounts(db: Database.Database, campaignId: number): { detailCount: number; pendingCount: number } {
  const row = db.prepare(`SELECT count(*) AS total, sum(CASE WHEN Status IN (1,100) THEN 1 ELSE 0 END) AS pending
    FROM autoCampaignDetail WHERE CampaignId=? AND (IsDelete IS NULL OR IsDelete=0)`).get(campaignId) as { total?: number; pending?: number | null }
  return { detailCount: Number(row?.total || 0), pendingCount: Number(row?.pending || 0) }
}

function readDetailBatch(db: Database.Database, campaignId: number, afterId: number | null): Row[] {
  const rows = readRows(db, `SELECT * FROM autoCampaignDetail WHERE CampaignId=? AND (IsDelete IS NULL OR IsDelete=0) AND Id>?
    ORDER BY Id LIMIT ${BATCH_SIZE}`, [campaignId, afterId ?? -1])
  // Lô theo dung lượng (API nhận tối đa 8 MB mỗi lần): data có ghi chú / địa chỉ dài ở Info1–5 thì lô ít dòng hơn.
  let bytes = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    delete row.ContentMessage
    delete row.ErrorImagePath
    if (typeof row.ErrorMessage === 'string' && row.ErrorMessage.length > ERROR_MESSAGE_MAX) row.ErrorMessage = row.ErrorMessage.slice(0, ERROR_MESSAGE_MAX)
    bytes += Buffer.byteLength(JSON.stringify(row), 'utf8') + 1
    if (i > 0 && bytes > BATCH_MAX_BYTES) return rows.slice(0, i)
  }
  return rows
}

// ---------------------------------------------------------------- HTTP

interface ApiCall { path: string; body: Row; bearer?: string; ticket?: string }

function isRecord(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export interface Cursor { afterId: number | null; consumed: number }

function parseCursor(value: unknown): Cursor | null {
  if (!isRecord(value)) return null
  const afterId = value.afterId === null || value.afterId === undefined ? null : Number(value.afterId)
  const consumed = Number(value.consumed ?? 0)
  if ((afterId !== null && !Number.isFinite(afterId)) || !Number.isFinite(consumed)) return null
  return { afterId, consumed }
}

class TicketExpired extends Error {}

export class AkaBizAutoSyncService {
  private session: Session | null = null
  private running: AbortController | null = null

  constructor(private readonly deps: AkaBizAutoSyncDeps) {}

  get isRunning(): boolean { return this.running !== null }

  close(): void {
    this.running?.abort()
    this.session = null
  }

  cancel(): void {
    this.running?.abort()
  }

  private async request(call: ApiCall, signal?: AbortSignal): Promise<Row> {
    const timeout = AbortSignal.timeout(this.deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (call.bearer) headers.Authorization = `Bearer ${call.bearer}`
    if (call.ticket) headers['x-akabiz-sync-ticket'] = call.ticket
    let response: Response
    try {
      response = await this.deps.fetch(`${this.deps.baseUrl}${call.path}`, {
        method: 'POST', signal: combined, redirect: 'error', headers, body: JSON.stringify(call.body)
      })
    } catch {
      if (signal?.aborted) throw new AkaBizAutoSyncError('akabiz_sync_cancelled', messageFor('akabiz_sync_cancelled'))
      throw new AkaBizAutoSyncError('akabiz_sync_network', messageFor('akabiz_sync_network'))
    }
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    const result = isRecord(body) ? body : {}
    if (response.ok && result.status === 1) return isRecord(result.data) ? result.data : {}
    const code = typeof result.code === 'string' ? result.code : response.headers.get('x-akaagent-error-code') || ''
    if (!code || !/^akabiz_sync_[a-z_]{1,60}$/.test(code)) {
      if (response.status === 404 || response.status === 405) throw new AkaBizAutoSyncError('akabiz_sync_not_ready', messageFor('akabiz_sync_not_ready'), undefined, response.status)
      throw new AkaBizAutoSyncError('akabiz_sync_failed', messageFor('akabiz_sync_failed'), undefined, response.status)
    }
    const message = typeof result.message === 'string' && result.message.trim() ? result.message.trim() : messageFor(code)
    throw new AkaBizAutoSyncError(code, message, result.details, response.status)
  }

  /** Lời gọi có vé, tự thử lại lỗi mạng / 503 / máy chủ bận; vé hết hạn thì ném TicketExpired cho lớp trên xử lý. */
  private async call(path: string, body: Row, signal: AbortSignal, onWait?: (note: string | null) => void): Promise<Row> {
    let failures = 0
    let busy = 0
    for (;;) {
      if (signal.aborted) throw new AkaBizAutoSyncError('akabiz_sync_cancelled', messageFor('akabiz_sync_cancelled'))
      const session = this.session
      if (!session) throw new AkaBizAutoSyncError('akabiz_sync_no_session', messageFor('akabiz_sync_no_session'))
      try {
        const data = await this.request({ path: `${SYNC_PREFIX}${path}`, body, ticket: session.ticket }, signal)
        onWait?.(null)
        return data
      } catch (error) {
        if (!(error instanceof AkaBizAutoSyncError)) throw error
        if (error.code === 'akabiz_sync_ticket_expired') throw new TicketExpired()
        if (error.code === 'akabiz_sync_busy') {
          if (++busy > MAX_BUSY_WAITS) throw error
          onWait?.('Máy chủ đang xử lý lượt đồng bộ khác của tài khoản này, đang chờ…')
        } else if (error.code === 'akabiz_sync_network' || error.code === 'akabiz_sync_failed') {
          if (++failures >= MAX_FAILURES) throw error
          onWait?.(`${error.message} Đang thử lại (${failures}/${MAX_FAILURES - 1})…`)
        } else {
          throw error
        }
        await this.deps.sleep(this.deps.retryDelayMs ?? RETRY_DELAY_MS, signal)
      }
    }
  }

  private async verify(source: AkaBizAutoSyncSource, password: string, installId: string, signal?: AbortSignal): Promise<Row> {
    let token: string
    try {
      token = await this.deps.token(signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS))
    } catch {
      throw new AkaBizAutoSyncError('akabiz_sync_session_unavailable', messageFor('akabiz_sync_session_unavailable'))
    }
    return this.request({ path: DESKTOP_VERIFY_PATH, bearer: token, body: { source: { username: source.username, password }, installId } }, signal)
  }

  private adoptVerify(source: AkaBizAutoSyncSource, password: string, installId: string, data: Row): void {
    const src = isRecord(data.source) ? data.source : {}
    const ticket = typeof data.ticket === 'string' ? data.ticket : ''
    const sourceStaffId = Number(src.staffId)
    const sourceAccountId = Number(src.accountId)
    if (!ticket || !Number.isSafeInteger(sourceStaffId) || !Number.isSafeInteger(sourceAccountId)) {
      throw new AkaBizAutoSyncError('akabiz_sync_failed', messageFor('akabiz_sync_failed'))
    }
    this.session = { dbPath: source.dbPath, installId, username: source.username, password, ticket, sourceStaffId, sourceAccountId }
  }

  /** Bước Kết nối: xác minh mật khẩu akaBiz, nhận vé + tuỳ chọn, đọc danh sách chiến dịch trong SQLite để form đếm. */
  async connect(source: AkaBizAutoSyncSource, password: string): Promise<AkaBizAutoSyncConnectResult> {
    if (this.running) throw new AkaBizAutoSyncError('akabiz_sync_running', messageFor('akabiz_sync_running'))
    const installId = withDb(source.dbPath, db => readInstallId(db, source.dbPath))
    const data = await this.verify(source, password, installId)
    this.adoptVerify(source, password, installId, data)
    const session = this.session as unknown as Session
    const campaigns = withDb(source.dbPath, db => readCampaignSummaries(db, session.sourceAccountId, session.sourceStaffId))
    const target = isRecord(data.target) ? data.target : {}
    const src = isRecord(data.source) ? data.source : {}
    const options = isRecord(data.options) ? data.options : {}
    const zalo = isRecord(options.zalo) ? options.zalo : {}
    const quota = (value: unknown) => {
      const q = isRecord(value) ? value : {}
      return { allowed: q.allowed === true, used: Number(q.used) || 0, max: q.max === null || q.max === undefined ? null : Number(q.max) }
    }
    const inProgress = isRecord(data.inProgress) ? data.inProgress : null
    return {
      target: { staffId: Number(target.staffId), username: String(target.username || ''), name: typeof target.name === 'string' ? target.name : null,
        organizationName: typeof target.organizationName === 'string' ? target.organizationName : null },
      source: { staffId: session.sourceStaffId, accountId: session.sourceAccountId, username: String(src.username || source.username),
        name: typeof src.name === 'string' ? src.name : null },
      options: {
        zalo: { zalo_server: quota(zalo.zalo_server), zalo_web: quota(zalo.zalo_web), zalo_qr: quota(zalo.zalo_qr) },
        facebook: quota(options.facebook),
        defaultZaloAccountType: ['zalo_server', 'zalo_web', 'zalo_qr'].includes(String(options.defaultZaloAccountType))
          ? options.defaultZaloAccountType as AkaBizAutoSyncConnectResult['options']['defaultZaloAccountType'] : null
      },
      accounts: (Array.isArray(data.accounts) ? data.accounts : []).filter(isRecord).map(account => ({
        shopId: Number(account.shopId), name: String(account.name || `Tài khoản ${account.shopId}`),
        platform: account.platform === 'facebook' ? 'facebook' : 'zalo', isActive: account.isActive !== false,
        phone: typeof account.phone === 'string' ? account.phone : null,
        mapped: isRecord(account.mapped) ? {
          accountId: String(account.mapped.accountId), type: account.mapped.type as never,
          name: typeof account.mapped.name === 'string' ? account.mapped.name : null
        } : null
      })),
      inProgress: inProgress && isRecord(inProgress.settings) ? {
        runId: String(inProgress.runId), settings: normalizeSettings(inProgress.settings),
        startedAt: typeof inProgress.startedAt === 'string' ? inProgress.startedAt : null
      } : null,
      dbPath: source.dbPath,
      installId,
      campaigns
    }
  }

  /** Vé hết hạn hoặc API khởi động lại: xác minh lại bằng mật khẩu đang giữ trong bộ nhớ rồi gọi lại begin. */
  private async reverify(signal: AbortSignal): Promise<void> {
    const session = this.session
    if (!session) throw new AkaBizAutoSyncError('akabiz_sync_no_session', messageFor('akabiz_sync_no_session'))
    const data = await this.verify({ dbPath: session.dbPath, username: session.username }, session.password, session.installId, signal)
    this.adoptVerify({ dbPath: session.dbPath, username: session.username }, session.password, session.installId, data)
  }

  /**
   * Một lượt Xem trước (dryRun) hoặc Đồng bộ. Gửi tiến trình qua `onProgress`; trả báo cáo. Lượt đang dở (cùng nguồn + đích)
   * được máy chủ chạy tiếp bằng cài đặt và mốc đã lưu.
   */
  async run(settingsInput: AkaBizAutoSyncSettings, dryRun: boolean, onProgress: (progress: AkaBizAutoSyncProgress) => void): Promise<AkaBizAutoSyncReport> {
    if (this.running) throw new AkaBizAutoSyncError('akabiz_sync_running', messageFor('akabiz_sync_running'))
    if (!this.session) throw new AkaBizAutoSyncError('akabiz_sync_no_session', messageFor('akabiz_sync_no_session'))
    const controller = new AbortController()
    this.running = controller
    try {
      return await this.runInner(normalizeSettings(settingsInput), dryRun, controller.signal, onProgress)
    } finally {
      this.running = null
    }
  }

  private async runInner(settings: AkaBizAutoSyncSettings, dryRun: boolean, signal: AbortSignal,
    onProgress: (progress: AkaBizAutoSyncProgress) => void): Promise<AkaBizAutoSyncReport> {
    const progress: AkaBizAutoSyncProgress = { dryRun, stage: 'accounts', campaignsDone: 0, campaignsTotal: 0, rowsDone: 0, rowsTotal: 0,
      current: null, note: null, recent: [] }
    const emit = () => onProgress({ ...progress, recent: progress.recent.slice(-20), current: progress.current ? { ...progress.current } : null })
    const log = (text: string, tone: 'ok' | 'warn' | 'info' = 'info') => {
      progress.recent.push({ at: new Date(this.deps.now()).toISOString(), text, tone })
      if (progress.recent.length > 40) progress.recent.splice(0, progress.recent.length - 40)
    }
    const onWait = (note: string | null) => {
      progress.note = note
      emit()
    }
    emit()

    let beginData = await this.begin(settings, dryRun, signal, onWait)
    const effective = isRecord(beginData.settings) ? normalizeSettings(beginData.settings) : settings
    const asOf = typeof beginData.asOf === 'string' ? beginData.asOf : new Date(this.deps.now()).toISOString()
    const asOfMs = Date.parse(asOf) || this.deps.now()
    const accounts = readBeginAccounts(beginData)
    const accountIssue = new Set(accounts.filter(account => account.result === 'issue').map(account => account.shopId))
    const completeSet = new Set(readCampaignIds(beginData, 'complete'))

    const session = this.session as Session
    const summaries = withDb(session.dbPath, db => readCampaignSummaries(db, session.sourceAccountId, session.sourceStaffId))
    const selected = summaries.filter(summary => campaignInSelection(summary, effective, asOfMs))
    const counts = new Map<number, { detailCount: number; pendingCount: number }>()
    withDb(session.dbPath, db => { for (const summary of selected) counts.set(summary.id, readCounts(db, summary.id)) })

    const report: AkaBizAutoSyncReport = {
      dryRun, asOf, settings: effective, accounts,
      campaigns: { total: selected.length, copied: 0, alreadyCopied: 0, outOfScope: 0, byAction: [], skipped: [], issues: [] },
      rows: { read: 0, imported: 0, dropped: 0 }, adjustments: [], mediaNotCopied: 0
    }
    progress.stage = 'campaigns'
    progress.campaignsTotal = selected.length
    progress.rowsTotal = selected.reduce((sum, summary) => sum + (completeSet.has(sourceIdOf(session.installId, summary.id)) ? 0 : counts.get(summary.id)?.detailCount || 0), 0)
    emit()

    const byAction = new Map<string, number>()
    const adjustments = new Map<string, { code: string; message: string; count: number }>()

    for (const summary of selected) {
      const sourceId = sourceIdOf(session.installId, summary.id)
      progress.current = { name: summary.name, rowsDone: 0, rowsTotal: completeSet.has(sourceId) ? 0 : counts.get(summary.id)?.detailCount || 0 }
      emit()
      if (completeSet.has(sourceId)) {
        report.campaigns.alreadyCopied++
      } else if (accountIssue.has(summary.shopId)) {
        const account = accounts.find(item => item.shopId === summary.shopId)
        report.campaigns.skipped.push({ sourceId, campaignId: summary.id, name: summary.name, code: 'ACCOUNT_UNAVAILABLE',
          message: account?.message || 'Không tạo được tài khoản đích cho chiến dịch này.' })
      } else {
        let outcome: CampaignOutcome | null = null
        for (let attempt = 0; ; attempt++) {
          try {
            outcome = await this.syncCampaign(summary, dryRun, signal, onWait,
              rows => { progress.rowsDone += rows; if (progress.current) progress.current.rowsDone += rows; emit() })
            break
          } catch (error) {
            // Máy chủ không còn nhớ chiến dịch trong lượt (mất câu trả lời rồi gửi lại, máy chủ khởi động lại): làm lại chiến dịch,
            // máy chủ trả con trỏ đã ghi nên không chép trùng.
            const unknown = error instanceof AkaBizAutoSyncError && error.code === 'akabiz_sync_campaign_unknown'
            if ((!(error instanceof TicketExpired) && !unknown) || attempt >= MAX_CAMPAIGN_RESTARTS) {
              if (error instanceof TicketExpired || unknown) throw new AkaBizAutoSyncError('akabiz_sync_stuck', messageFor('akabiz_sync_stuck'))
              throw error
            }
            if (!unknown) {
              await this.reverify(signal)
              beginData = await this.begin(effective, dryRun, signal, onWait)
            }
            if (progress.current) { progress.rowsDone -= progress.current.rowsDone; progress.current.rowsDone = 0 }
          }
        }
        if (outcome) {
          report.rows.read += outcome.read
          if (outcome.verdict === 'copy') {
            // Chỉ đếm dòng của chiến dịch đã chép xong (chiến dịch gặp dòng lỗi ở lô sau thành "cần xử lý", dòng đã gửi chưa hiện).
            report.rows.imported += outcome.imported
            report.rows.dropped += outcome.dropped
            report.campaigns.copied++
            if (outcome.actionId) byAction.set(outcome.actionId, (byAction.get(outcome.actionId) || 0) + 1)
            for (const adjustment of outcome.adjustments) {
              const current = adjustments.get(adjustment.code) || { ...adjustment, count: 0 }
              current.count++
              adjustments.set(adjustment.code, current)
              if (adjustment.code === 'MEDIA_NOT_COPIED') report.mediaNotCopied++
            }
            log(`${dryRun ? 'Chép được' : 'Đã chép'} “${summary.name}” · ${outcome.imported} dòng`, 'ok')
          } else if (outcome.verdict === 'already_copied') {
            report.campaigns.alreadyCopied++
          } else if (outcome.verdict === 'out_of_scope') {
            report.campaigns.outOfScope++
          } else if (outcome.verdict === 'skip') {
            report.campaigns.skipped.push({ sourceId, campaignId: summary.id, name: summary.name, code: outcome.code, message: outcome.message })
          } else {
            report.campaigns.issues.push({ sourceId, campaignId: summary.id, name: summary.name, code: outcome.code, message: outcome.message })
            log(`“${summary.name}” cần xử lý: ${outcome.message}`, 'warn')
          }
        }
      }
      progress.campaignsDone++
      // Chiến dịch không chép (bỏ qua, cần xử lý) vẫn đi hết phần dòng của nó trên thanh tiến độ.
      if (progress.current) progress.rowsDone += Math.max(0, progress.current.rowsTotal - progress.current.rowsDone)
      progress.current = null
      emit()
    }
    report.campaigns.byAction = [...byAction.entries()].map(([actionId, count]) => ({ actionId, count })).sort((a, b) => b.count - a.count)
    report.adjustments = [...adjustments.values()].sort((a, b) => b.count - a.count)

    if (!dryRun) {
      progress.stage = 'finishing'
      emit()
      const hasIssues = report.campaigns.issues.length > 0
      try {
        await this.call('/finish', { hasIssues }, signal, onWait)
      } catch (error) {
        if (!(error instanceof TicketExpired)) throw error
        await this.reverify(signal)
        await this.begin(effective, false, signal, onWait)
        await this.call('/finish', { hasIssues }, signal, onWait)
      }
    }
    progress.current = null
    progress.note = null
    emit()
    return report
  }

  private async begin(settings: AkaBizAutoSyncSettings, dryRun: boolean, signal: AbortSignal, onWait: (note: string | null) => void): Promise<Row> {
    try {
      return await this.call('/begin', { dryRun, settings }, signal, onWait)
    } catch (error) {
      if (!(error instanceof TicketExpired)) throw error
      await this.reverify(signal)
      return this.call('/begin', { dryRun, settings }, signal, onWait)
    }
  }

  private async syncCampaign(summary: AkaBizAutoCampaignSummary, dryRun: boolean, signal: AbortSignal, onWait: (note: string | null) => void, onRows: (rows: number) => void): Promise<CampaignOutcome> {
    const session = this.session as Session
    const sourceId = sourceIdOf(session.installId, summary.id)
    const loaded = withDb(session.dbPath, db => {
      const campaign = readCampaignRow(db, summary.id)
      return campaign ? { campaign, refs: readRefs(db, campaign, session.sourceStaffId), counts: readCounts(db, summary.id) } : null
    })
    if (!loaded) return { verdict: 'out_of_scope', code: '', message: '', actionId: null, adjustments: [], read: 0, imported: 0, dropped: 0 }
    const data = await this.call('/campaign', { dryRun, campaign: loaded.campaign, refs: loaded.refs,
      detailCount: loaded.counts.detailCount, pendingCount: loaded.counts.pendingCount }, signal, onWait)
    const verdict = String(data.verdict || '')
    const adjustments = (Array.isArray(data.adjustments) ? data.adjustments : []).filter(isRecord)
      .map(item => ({ code: String(item.code || ''), message: String(item.message || item.code || '') })).filter(item => item.code)
    const base: CampaignOutcome = { verdict: 'issue', code: String(data.code || ''), message: String(data.message || ''),
      actionId: typeof data.actionId === 'string' ? data.actionId : null, adjustments, read: 0, imported: 0, dropped: 0 }
    if (verdict !== 'copy') {
      base.verdict = verdict === 'already_copied' || verdict === 'out_of_scope' || verdict === 'skip' ? verdict : 'issue'
      if (base.verdict === 'issue' && !base.message) base.message = 'Chiến dịch cần kiểm tra lại.'
      return base
    }
    let cursor = parseCursor(data.cursor) || { afterId: null, consumed: 0 }
    if (cursor.consumed > 0) onRows(cursor.consumed)
    let incompleteRetries = 0
    for (;;) {
      const rows = withDb(session.dbPath, db => readDetailBatch(db, summary.id, cursor.afterId))
      if (!rows.length) {
        if (dryRun) break
        try {
          const published = await this.call('/publish', { sourceId, afterId: cursor.afterId }, signal, onWait)
          if (published.verdict === 'issue') {
            return { ...base, verdict: 'issue', code: String(published.code || ''), message: String(published.message || 'Chiến dịch cần kiểm tra lại.') }
          }
          break
        } catch (error) {
          if (error instanceof AkaBizAutoSyncError && error.code === 'akabiz_sync_incomplete' && incompleteRetries++ < 2) {
            const serverCursor = parseCursor(isRecord(error.details) ? error.details.cursor : null)
            if (!serverCursor || (serverCursor.afterId === cursor.afterId && serverCursor.consumed === cursor.consumed)) {
              return { ...base, verdict: 'issue', code: 'SOURCE_CHANGED', message: 'Số dòng của chiến dịch đã thay đổi trong lúc đồng bộ. Bấm đồng bộ lại để chép tiếp.' }
            }
            onRows(serverCursor.consumed - cursor.consumed)
            cursor = serverCursor
            continue
          }
          throw error
        }
      }
      let result: Row
      try {
        result = await this.call('/inputs', { dryRun, sourceId, expectedCursor: cursor, rows }, signal, onWait)
      } catch (error) {
        if (error instanceof AkaBizAutoSyncError && error.code === 'akabiz_sync_cursor_conflict') {
          const serverCursor = parseCursor(isRecord(error.details) ? error.details.cursor : null)
          if (!serverCursor) throw error
          onRows(serverCursor.consumed - cursor.consumed)
          cursor = serverCursor
          continue
        }
        throw error
      }
      if (result.verdict === 'issue') {
        return { ...base, verdict: 'issue', code: String(result.code || ''), message: String(result.message || 'Dữ liệu của chiến dịch cần kiểm tra lại.') }
      }
      const next = parseCursor(result.cursor)
      if (!next || (next.afterId !== null && cursor.afterId !== null && next.afterId <= cursor.afterId)) {
        throw new AkaBizAutoSyncError('akabiz_sync_stuck', messageFor('akabiz_sync_stuck'))
      }
      base.read += rows.length
      base.imported += Number(result.imported) || 0
      base.dropped += Number(result.dropped) || 0
      onRows(Math.max(0, next.consumed - cursor.consumed))
      cursor = next
    }
    return { ...base, verdict: 'copy', code: '', message: '' }
  }
}

interface CampaignOutcome {
  verdict: 'copy' | 'already_copied' | 'out_of_scope' | 'skip' | 'issue'
  code: string
  message: string
  actionId: string | null
  adjustments: { code: string; message: string }[]
  read: number
  imported: number
  dropped: number
}

export const sourceIdOf = (installId: string, campaignId: number): string => `${installId}:${campaignId}`

function readCampaignIds(data: Row, key: 'complete'): string[] {
  const campaigns = isRecord(data.campaigns) ? data.campaigns : {}
  const list = campaigns[key]
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
}

function readBeginAccounts(data: Row): AkaBizAutoBeginAccount[] {
  return (Array.isArray(data.accounts) ? data.accounts : []).filter(isRecord).map(account => ({
    shopId: Number(account.shopId),
    result: (['created', 'reused', 'would_create', 'would_reuse', 'issue'].includes(String(account.result)) ? account.result : 'issue') as AkaBizAutoBeginAccount['result'],
    accountId: account.accountId === null || account.accountId === undefined ? null : String(account.accountId),
    type: typeof account.type === 'string' ? account.type as AkaBizAutoBeginAccount['type'] : null,
    ...(typeof account.code === 'string' ? { code: account.code } : {}),
    ...(typeof account.message === 'string' ? { message: account.message } : {})
  }))
}

export function normalizeSettings(value: unknown): AkaBizAutoSyncSettings {
  const input = isRecord(value) ? value : {}
  const platforms = (Array.isArray(input.platforms) ? input.platforms : []).filter((item): item is 'zalo' | 'facebook' => item === 'zalo' || item === 'facebook')
  const zaloType = ['zalo_server', 'zalo_web', 'zalo_qr'].includes(String(input.zaloAccountType)) ? input.zaloAccountType as AkaBizAutoSyncSettings['zaloAccountType'] : null
  const shopIds = [...new Set((Array.isArray(input.shopIds) ? input.shopIds : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))]
  return {
    platforms: [...new Set(platforms)],
    zaloAccountType: platforms.includes('zalo') ? zaloType : null,
    shopIds,
    campaignScope: input.campaignScope === 'all' ? 'all' : 'paused_pending',
    updatedWithinDays: input.updatedWithinDays === null || input.updatedWithinDays === undefined ? null : normalizeUpdatedWithinDays(input.updatedWithinDays)
  }
}

export type { AkaBizAutoSyncItem }
