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
interface LoginFile { version: 2; options: LoginPreferences; encryptedCredential: string | null }
interface Options {
  file: string
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
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
  private revision = 0
  constructor(private readonly config: Options) {}

  async initialize(): Promise<void> {
    if (!this.loaded) this.loaded = this.load()
    await this.loaded
  }
  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.config.file, 'utf8')) as LoginFile
      if (raw.version !== 2 || !raw.options || ['rememberLogin', 'autoLogin', 'startupEnabled'].some(k => typeof raw.options[k as keyof LoginPreferences] !== 'boolean')
        || !(raw.encryptedCredential === null || typeof raw.encryptedCredential === 'string')) throw new Error('Invalid login storage')
      this.options = normalizeLocalLoginOptions(raw.options)
      if (raw.encryptedCredential && this.options.rememberLogin) {
        const value = JSON.parse(this.config.decrypt(Buffer.from(raw.encryptedCredential, 'base64'))) as SavedLoginCredentials
        if (!value || typeof value.username !== 'string' || !value.username.trim() || typeof value.password !== 'string' || !value.password) throw new Error('Invalid credential')
        this.credentials = value
        this.credentialVerified = true
      }
      this.preferencesOnly = raw.encryptedCredential === null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.missing = true
      else {
        this.credentials = null
        this.warning = 'Không đọc được thông tin ghi nhớ trên máy. Vui lòng nhập lại thông tin đăng nhập.'
      }
    }
  }
  snapshot(): AuthLocalState {
    return { loginOptions: { ...this.options }, rememberedLogin: this.credentials ? { username: this.credentials.username, hasCredential: true } : null, warningMessage: this.warning }
  }
  getCredentials(): SavedLoginCredentials | null { return this.credentials ? { ...this.credentials } : null }
  getRevision(): number { return this.revision }
  initializeMigrationPreferences(startupEnabled: boolean): void {
    // Unknown/shared legacy ownership must not silently re-enable disabled login options.
    // A unique eligible legacy candidate can replace these defaults with its actual choices.
    if (this.missing && this.revision === 0) this.options = { rememberLogin: false, autoLogin: false, startupEnabled }
  }
  mayImportLegacy(): boolean {
    return !this.credentials && this.revision === 0
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
      else if (authenticated) { this.credentials = { ...authenticated }; this.credentialVerified = true }
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
      await this.persist(credentials)
      return this.snapshot()
    })
  }
  private async persist(authenticated: SavedLoginCredentials | null): Promise<void> {
    this.missing = false
    try {
      const candidate = this.options.rememberLogin ? authenticated : null
      const encrypted = candidate ? this.config.encrypt(JSON.stringify(candidate)) : null
      if (encrypted && JSON.stringify(JSON.parse(this.config.decrypt(encrypted))) !== JSON.stringify(candidate)) throw new Error('Credential verification failed')
      const file: LoginFile = { version: 2, options: this.options, encryptedCredential: encrypted?.toString('base64') ?? null }
      await (this.config.write ?? writeAtomicLocalFile)(this.config.file, JSON.stringify(file))
      this.warning = null
    } catch {
      this.warning = 'Chưa lưu được thay đổi ghi nhớ trên máy. Lần mở sau có thể cần đăng nhập lại hoặc dùng thiết lập trước đó.'
    }
  }
}
