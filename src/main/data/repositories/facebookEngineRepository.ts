// Engine v2 cho Facebook trên Desktop (V556): cờ theo phiên, danh mục bước / workflow cho engine, việc kèm theo chống trùng,
// yêu cầu ảnh lỗi. Mọi lời gọi bằng phiên Desktop; DB chưa có V556 (PGRST202 / 42P01) thì coi như tắt, Desktop chạy bộ cũ.
import { getSupabaseClient } from '../supabaseClient'
import {
  mapEngineBlockStepRow, mapEngineWorkflowRow, type EngineBlockStepRow, type EngineWorkflowRow
} from '../../engineAdapters/facebook/stepCatalog'
import { parseFacebookErrorSigns, type FacebookErrorSign } from '../../engineAdapters/facebook/errorSigns'

const FLAG_TIMEOUT_MS = 10_000
const CATALOG_TIMEOUT_MS = 15_000
const CATALOG_TTL_MS = 5 * 60_000

/** V556: tổ chức của phiên Desktop nằm trong thiết lập engine.facebook. Lỗi / chưa có hàm thì tắt. */
export async function loadFacebookEngineEnabled(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('aka_agent_engine_facebook_enabled_v1')
      .abortSignal(AbortSignal.timeout(FLAG_TIMEOUT_MS))
    if (error) {
      if (error.code !== 'PGRST202') console.warn('[auth] Không đọc được thiết lập engine Facebook:', error.message)
      return false
    }
    return data === true
  } catch (error) {
    console.warn('[auth] Không đọc được thiết lập engine Facebook:', error)
    return false
  }
}

export interface FacebookEngineCatalog {
  loadedAt: number
  /** purpose (loại chiến dịch / rest_browse) → workflow cho engine. */
  workflows: ReadonlyMap<string, EngineWorkflowRow>
  steps: readonly EngineBlockStepRow[]
}

let cached: FacebookEngineCatalog | null = null
let loading: Promise<FacebookEngineCatalog> | null = null
/** Lần nạp gần nhất lỗi mà chưa có bản nào (0 = chưa lỗi). */
let loadFailedAt = 0

/** Danh mục đã nạp gần nhất (đọc đồng bộ khi chọn bộ chạy); null khi chưa nạp lần nào. */
export function cachedFacebookEngineCatalog(): FacebookEngineCatalog | null {
  return cached
}

/** Nạp danh mục (dùng lại trong 5 phút; force = đọc lại). Lỗi giữ bản cũ nếu có, không có thì ném. */
export async function loadFacebookEngineCatalog(force = false): Promise<FacebookEngineCatalog> {
  if (!force && cached && Date.now() - cached.loadedAt < CATALOG_TTL_MS) return cached
  if (loading) return loading
  loading = (async () => {
    try {
      const client = getSupabaseClient()
      const signal = AbortSignal.timeout(CATALOG_TIMEOUT_MS)
      const [workflows, steps] = await Promise.all([
        client.from('auto_engine_workflows').select('purpose, workflow_id').eq('is_active', true).abortSignal(signal),
        client.from('auto_engine_block_steps').select('block_id, workflow_id, node_id, action_code, action_code_from, step_kind, commit_level, '
          + 'send_ops, result_mode, legacy_milestone, reviewed_code_md5').eq('is_active', true).abortSignal(signal)
      ])
      if (workflows.error) throw new Error(`Không đọc được workflow engine Facebook: ${workflows.error.message}`)
      if (steps.error) throw new Error(`Không đọc được danh mục bước engine Facebook: ${steps.error.message}`)
      const map = new Map<string, EngineWorkflowRow>()
      for (const row of workflows.data ?? []) {
        const mapped = mapEngineWorkflowRow(row as unknown as Record<string, unknown>)
        if (mapped) map.set(mapped.purpose, mapped)
      }
      const rows: EngineBlockStepRow[] = []
      for (const row of steps.data ?? []) {
        const mapped = mapEngineBlockStepRow(row as unknown as Record<string, unknown>)
        if (mapped) rows.push(mapped)
      }
      cached = { loadedAt: Date.now(), workflows: map, steps: rows }
      loadFailedAt = 0
      return cached
    } catch (error) {
      if (cached) return cached
      loadFailedAt = Date.now()
      throw error
    } finally {
      loading = null
    }
  })()
  return loading
}

/** Chưa có danh mục và lần nạp gần nhất đã lỗi (DB lỗi / chưa có V556): chọn bộ chạy coi như tắt engine, không chờ. */
export function facebookEngineCatalogUnavailable(): boolean {
  return !cached && !loading && loadFailedAt > 0
}

/** Đổi phiên đăng nhập: bỏ danh mục của phiên trước. */
export function resetFacebookEngineCatalog(): void {
  cached = null
}

export interface FacebookRuntimeSettings {
  /** Trần "Số comment tối đa" / "Số bài cần comment" (Q10), mặc định 20. */
  maxComments: number
  /** Block treo: quá số phút này không có thao tác nào thì huỷ cửa sổ ẩn (Q20), mặc định 10. */
  blockHangMinutes: number
  /** Câu chờ khi chiến dịch đến lịch quá số phút này chưa chạy được (Q21), mặc định 10. */
  waitNoteMinutes: number
  /** Dấu hiệu nhận ra lỗi Facebook (V559, anh chốt 17/11): thiếu dòng / sai = rỗng, kết quả như hôm nay. */
  errorSigns: FacebookErrorSign[]
}

export const FACEBOOK_RUNTIME_SETTING_KEYS = {
  maxComments: 'facebook.max_comments',
  blockHangMinutes: 'facebook.block_hang_minutes',
  waitNoteMinutes: 'campaign.wait_note_minutes',
  errorSigns: 'facebook.error_signs'
} as const

export const DEFAULT_FACEBOOK_RUNTIME_SETTINGS: Readonly<FacebookRuntimeSettings> = { maxComments: 20, blockHangMinutes: 10, waitNoteMinutes: 10,
  errorSigns: [] }

/** Số nguyên dương trong khoảng; chưa có dòng / sai = mặc định (thiết lập do V556 thêm, sửa bằng UPDATE không cần phát hành). */
export function parseFacebookRuntimeSetting(raw: unknown, fallback: number, max: number): number {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : fallback
}

let runtimeSettings: { at: number; value: FacebookRuntimeSettings } | null = null

/** Thiết lập chạy của engine / Desktop cho Facebook, đọc lại sau 10 phút. Lỗi đọc thì dùng bản cũ hoặc mặc định. */
export async function loadFacebookRuntimeSettings(): Promise<FacebookRuntimeSettings> {
  if (runtimeSettings && Date.now() - runtimeSettings.at < 10 * 60_000) return runtimeSettings.value
  try {
    const { data, error } = await getSupabaseClient().from('auto_system_settings').select('key,value')
      .in('key', Object.values(FACEBOOK_RUNTIME_SETTING_KEYS)).eq('is_active', true).eq('is_secret', false)
      .abortSignal(AbortSignal.timeout(5_000))
    if (error) throw new Error(error.message)
    const values = new Map((data ?? []).map(row => [String(row.key), row.value]))
    const value: FacebookRuntimeSettings = {
      maxComments: parseFacebookRuntimeSetting(values.get(FACEBOOK_RUNTIME_SETTING_KEYS.maxComments), DEFAULT_FACEBOOK_RUNTIME_SETTINGS.maxComments, 1000),
      blockHangMinutes: parseFacebookRuntimeSetting(values.get(FACEBOOK_RUNTIME_SETTING_KEYS.blockHangMinutes), DEFAULT_FACEBOOK_RUNTIME_SETTINGS.blockHangMinutes, 1440),
      waitNoteMinutes: parseFacebookRuntimeSetting(values.get(FACEBOOK_RUNTIME_SETTING_KEYS.waitNoteMinutes), DEFAULT_FACEBOOK_RUNTIME_SETTINGS.waitNoteMinutes, 1440),
      errorSigns: parseFacebookErrorSigns(values.get(FACEBOOK_RUNTIME_SETTING_KEYS.errorSigns))
    }
    runtimeSettings = { at: Date.now(), value }
    return value
  } catch {
    return runtimeSettings?.value ?? { ...DEFAULT_FACEBOOK_RUNTIME_SETTINGS, errorSigns: [] }
  }
}

/** Bản đã nạp gần nhất (đọc đồng bộ ở chỗ không chờ được); chưa nạp thì mặc định. */
export function cachedFacebookRuntimeSettings(): FacebookRuntimeSettings {
  return runtimeSettings?.value ?? { ...DEFAULT_FACEBOOK_RUNTIME_SETTINGS, errorSigns: [] }
}
