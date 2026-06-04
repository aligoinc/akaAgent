import { app, session, type Session } from 'electron'
import { AutoAccount, AutoProxy, ProxyProtocol, ProxyTestResult } from '../../shared/types'

type ProxyCredential = {
  host: string
  port: number
  username: string
  password: string
}

const PROTOCOLS: ProxyProtocol[] = ['http', 'https', 'socks5']
const IP_CHECK_URL = 'https://api.ipify.org?format=json'

const PLATFORM_TEST_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  instagram: 'https://www.instagram.com'
}

export class ProxyRuntimeService {
  private credentialsBySession = new WeakMap<Session, ProxyCredential>()
  private credentialKeysBySession = new WeakMap<Session, string>()
  private credentialsByEndpoint = new Map<string, ProxyCredential>()
  private loginHandlerRegistered = false

  constructor(private readonly getProxyById: (id: number) => Promise<AutoProxy | null>) {}

  async prepareAccountSession(account: AutoAccount): Promise<void> {
    const proxy = account.proxyId ? await this.getProxyById(account.proxyId) : null
    await this.applyProxyToPartition(this.getAccountPartition(account.id), proxy)
  }

  async applyProxyToPartition(partition: string, proxy: AutoProxy | Partial<AutoProxy> | null | undefined): Promise<void> {
    const ses = session.fromPartition(partition)
    this.ensureLoginHandler()

    if (!proxy || proxy.isActive === false) {
      this.deleteSessionCredential(ses)
      await ses.setProxy({ mode: 'system' })
      await ses.closeAllConnections()
      await ses.forceReloadProxyConfig().catch(() => {})
      return
    }

    const normalized = this.normalizeProxy(proxy)
    if (normalized.username && normalized.password) {
      const credential = {
        host: normalized.host,
        port: normalized.port,
        username: normalized.username,
        password: normalized.password
      }
      this.setSessionCredential(ses, credential)
    } else {
      this.deleteSessionCredential(ses)
    }

    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: `${normalized.protocol}://${normalized.host}:${normalized.port}`
    })
    await ses.closeAllConnections()
    await ses.forceReloadProxyConfig().catch(() => {})
  }

  async testProxy(
    proxy: Partial<AutoProxy>,
    platform = 'other',
    customTestUrl?: string
  ): Promise<ProxyTestResult> {
    const normalized = this.normalizeProxy(proxy)
    const partition = `proxy_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const ses = session.fromPartition(partition)
    const startedAt = Date.now()
    const testUrl = this.getTestUrl(platform, customTestUrl)

    this.ensureLoginHandler()
    if (normalized.username && normalized.password) {
      const credential = {
        host: normalized.host,
        port: normalized.port,
        username: normalized.username,
        password: normalized.password
      }
      this.setSessionCredential(ses, credential)
    }

    try {
      await ses.setProxy({
        mode: 'fixed_servers',
        proxyRules: `${normalized.protocol}://${normalized.host}:${normalized.port}`
      })
      await ses.forceReloadProxyConfig().catch(() => {})

      const response = await ses.fetch(testUrl, { cache: 'no-store' })
      const latencyMs = Date.now() - startedAt
      const ip = await this.fetchIpAddress(ses)

      return {
        ok: response.ok,
        platform,
        testUrl,
        status: response.status,
        statusText: response.statusText,
        ip,
        latencyMs,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText || ''}`.trim()
      }
    } catch (err: any) {
      return {
        ok: false,
        platform,
        testUrl,
        latencyMs: Date.now() - startedAt,
        error: err?.message || String(err)
      }
    } finally {
      this.deleteSessionCredential(ses)
      await ses.closeAllConnections().catch(() => {})
      await ses.clearStorageData().catch(() => {})
    }
  }

  getAccountPartition(accountId: number): string {
    return `persist:account_${accountId}`
  }

  private ensureLoginHandler(): void {
    if (this.loginHandlerRegistered) return
    this.loginHandlerRegistered = true

    app.on('login', (event, webContents, _details, authInfo, callback) => {
      const credential = (webContents?.session
        ? this.credentialsBySession.get(webContents.session)
        : undefined) || this.credentialsByEndpoint.get(this.getCredentialKey(authInfo.host, Number(authInfo.port)))
      if (
        !credential ||
        !authInfo.isProxy ||
        authInfo.host !== credential.host ||
        Number(authInfo.port) !== credential.port
      ) {
        return
      }

      event.preventDefault()
      callback(credential.username, credential.password)
    })
  }

  private normalizeProxy(proxy: Partial<AutoProxy>): Required<Pick<AutoProxy, 'protocol' | 'host' | 'port'>> & {
    username: string | null
    password: string | null
  } {
    const protocol = String(proxy.protocol || '').trim().toLowerCase() as ProxyProtocol
    if (!PROTOCOLS.includes(protocol)) {
      throw new Error('Loại proxy không hợp lệ')
    }

    const host = String(proxy.host || '').trim()
    if (!host) throw new Error('Host proxy không được để trống')

    const port = Math.floor(Number(proxy.port))
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error('Port proxy phải nằm trong khoảng 1-65535')
    }

    const username = String(proxy.username || '').trim() || null
    const password = String(proxy.password || '').trim() || null

    return { protocol, host, port, username, password }
  }

  private getCredentialKey(host: string, port: number): string {
    return `${host}:${port}`
  }

  private setSessionCredential(ses: Session, credential: ProxyCredential): void {
    this.deleteSessionCredential(ses)
    const key = this.getCredentialKey(credential.host, credential.port)
    this.credentialsBySession.set(ses, credential)
    this.credentialKeysBySession.set(ses, key)
    this.credentialsByEndpoint.set(key, credential)
  }

  private deleteSessionCredential(ses: Session): void {
    const existingKey = this.credentialKeysBySession.get(ses)
    if (existingKey) {
      this.credentialsByEndpoint.delete(existingKey)
      this.credentialKeysBySession.delete(ses)
    }
    this.credentialsBySession.delete(ses)
  }

  private getTestUrl(platform: string, customTestUrl?: string): string {
    const trimmedCustomUrl = String(customTestUrl || '').trim()
    if (trimmedCustomUrl) return trimmedCustomUrl
    return PLATFORM_TEST_URLS[String(platform || '').trim().toLowerCase()] || IP_CHECK_URL
  }

  private async fetchIpAddress(ses: Session): Promise<string | undefined> {
    try {
      const response = await ses.fetch(IP_CHECK_URL, { cache: 'no-store' })
      if (!response.ok) return undefined
      const data = await response.json() as { ip?: unknown }
      const ip = String(data?.ip || '').trim()
      return ip || undefined
    } catch {
      return undefined
    }
  }
}
