import { readFile } from 'node:fs/promises'
import type { LoginPreferences, SavedLoginCredentials, AuthLocalState } from '../../shared/types'
import { writeAtomicLocalFile } from './atomicLocalFile'

export const DEFAULT_LOCAL_LOGIN_OPTIONS: LoginPreferences = { rememberLogin: true, autoLogin: true, startupEnabled: false }
export function normalizeLocalLoginOptions(options: Partial<LoginPreferences>): LoginPreferences {
  const next = { ...DEFAULT_LOCAL_LOGIN_OPTIONS, ...options }
  if (options.rememberLogin === false) next.autoLogin = false
  if (next.autoLogin) next.rememberLogin = true
  return next
}
interface LegacyLoginFile { version: 2; options: LoginPreferences; encryptedCredential: string | null }
interface LoginFile {
  version: 3
  options: LoginPreferences
  credentials: SavedLoginCredentials | null
  requiresManualLogin: boolean
}
const MANUAL_LOGIN_WARNING = 'Vui lòng nhập lại tên đăng nhập và mật khẩu một lần. Các tùy chọn ghi nhớ và khởi động cùng máy tính vẫn được giữ nguyên.'
interface Options {
  file: string
  write?: (file: string, value: string) => Promise<void>
}

/** Main-only credentials. No method returning them is exposed through preload. */
export class LocalLoginStore {
  private options = { ...DEFAULT_LOCAL_LOGIN_OPTIONS }
  private credentials: SavedLoginCredentials | null = null
  private credentialVerified = false
  private loaded: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private warning: string | null = null
  private missing = false
  private preferencesOnly = false
  private requiresManualLogin = false
  private revision = 0
  constructor(private readonly config: Options) {}

  async initialize(): Promise<void> {
    if (!this.loaded) this.loaded = this.load()
    await this.loaded
  }
  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.config.file, 'utf8')) as LoginFile | LegacyLoginFile
      if (!raw || (raw.version !== 2 && raw.version !== 3) || !raw.options
        || ['rememberLogin', 'autoLogin', 'startupEnabled'].some(k => typeof raw.options[k as keyof LoginPreferences] !== 'boolean')) throw new Error('Invalid login storage')
      this.options = normalizeLocalLoginOptions(raw.options)
      if (raw.version === 2) {
        if (!(raw.encryptedCredential === null || typeof raw.encryptedCredential === 'string')) throw new Error('Invalid legacy login storage')
        // Never decrypt old credentials: doing so could open a macOS Keychain prompt.
        this.requiresManualLogin = raw.encryptedCredential !== null
        this.preferencesOnly = raw.encryptedCredential === null
        return
      }
      if (typeof raw.requiresManualLogin !== 'boolean') throw new Error('Invalid login storage')
      this.requiresManualLogin = raw.requiresManualLogin
      if (raw.credentials !== null) {
        const value = raw.credentials
        if (!value || typeof value.username !== 'string' || !value.username.trim() || typeof value.password !== 'string' || !value.password
          || this.requiresManualLogin) throw new Error('Invalid credential')
        if (this.options.rememberLogin) this.credentials = { username: value.username, password: value.password }
        this.credentialVerified = true
      }
      this.preferencesOnly = raw.credentials === null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.missing = true
      else {
        this.credentials = null
        this.requiresManualLogin = true
        this.warning = 'Không đọc được thông tin ghi nhớ trên máy. Vui lòng nhập lại thông tin đăng nhập.'
      }
    }
  }
  snapshot(): AuthLocalState {
    return { loginOptions: { ...this.options }, rememberedLogin: this.credentials ? { username: this.credentials.username, hasCredential: true } : null,
      warningMessage: this.warning ?? (this.requiresManualLogin ? MANUAL_LOGIN_WARNING : null) }
  }
  getCredentials(): SavedLoginCredentials | null { return this.credentials ? { ...this.credentials } : null }
  getRevision(): number { return this.revision }
  initializeMigrationPreferences(startupEnabled: boolean): void {
    // Unknown/shared legacy ownership must not silently re-enable disabled login options.
    // A unique eligible legacy candidate can replace these defaults with its actual choices.
    if (this.missing && this.revision === 0) this.options = { rememberLogin: false, autoLogin: false, startupEnabled }
  }
  mayImportLegacy(): boolean {
    return !this.credentials && !this.requiresManualLogin && this.revision === 0
      && (this.missing || (this.preferencesOnly && this.options.rememberLogin))
  }

  /** Import is only an in-memory candidate; persist its password after successful login. */
  importLegacy(credentials: SavedLoginCredentials | null, options: LoginPreferences, expectedRevision: number): boolean {
    if (!this.mayImportLegacy() || this.revision !== expectedRevision) return false
    // An existing preferences-only file records the user's explicit choices.
    // Legacy options are defaults only for a machine with no local file yet.
    if (this.missing) this.options = normalizeLocalLoginOptions(options)
    this.credentials = this.options.rememberLogin ? credentials : null
    this.credentialVerified = false
    return true
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work)
    this.queue = result.catch(() => {})
    return result
  }
  updateOptions(updates: Partial<LoginPreferences>, authenticated?: SavedLoginCredentials | null): Promise<AuthLocalState> {
    // Fence any pending DB bootstrap immediately, before asynchronous disk work.
    this.revision++
    return this.serialize(async () => {
      await this.initialize()
      const next = { ...this.options, ...updates }
      if (updates.autoLogin === true && updates.rememberLogin !== false) next.rememberLogin = true
      this.options = normalizeLocalLoginOptions(next)
      if (!this.options.rememberLogin) { this.credentials = null; this.credentialVerified = false }
      else if (authenticated) { this.credentials = { ...authenticated }; this.credentialVerified = true; this.requiresManualLogin = false }
      // An imported credential has not been authenticated yet; options-only saves
      // must not turn it into a durable password.
      await this.persist(this.credentialVerified ? this.credentials : null)
      return this.snapshot()
    })
  }
  saveAuthenticated(credentials: SavedLoginCredentials): Promise<AuthLocalState> {
    return this.serialize(async () => {
      await this.initialize()
      this.credentials = this.options.rememberLogin ? { ...credentials } : null
      this.credentialVerified = true
      this.requiresManualLogin = false
      await this.persist(credentials)
      return this.snapshot()
    })
  }
  private async persist(authenticated: SavedLoginCredentials | null): Promise<void> {
    this.missing = false
    try {
      const candidate = this.options.rememberLogin ? authenticated : null
      const file: LoginFile = { version: 3, options: this.options, credentials: candidate,
        requiresManualLogin: this.requiresManualLogin }
      await (this.config.write ?? writeAtomicLocalFile)(this.config.file, JSON.stringify(file))
      this.warning = null
    } catch {
      this.warning = 'Chưa lưu được thay đổi ghi nhớ trên máy. Lần mở sau có thể cần đăng nhập lại hoặc dùng thiết lập trước đó.'
    }
  }
}
