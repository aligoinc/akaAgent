import { app, session, type Session } from 'electron'
import { AutoAccount, AutoProxy, ProxyProtocol, ProxyTestResult } from '../../shared/types'

type ProxyCredential = {
  host: string
  port: number
  username: string
  password: string
}

type NormalizedProxy = Required<Pick<AutoProxy, 'protocol' | 'host' | 'port'>> & {
  username: string | null
  password: string | null
}

const PROTOCOLS: ProxyProtocol[] = ['http', 'https', 'socks5']
const IP_CHECK_URL = 'https://api.ipify.org?format=json'
const PROXY_TEST_TIMEOUT_MS = 15000

const PLATFORM_TEST_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com/',
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
    const startedAt = Date.now()
    const testUrl = this.getTestUrl(platform, customTestUrl)

    try {
      const response = await this.fetchWithProxy(testUrl, normalized)
      const latencyMs = Date.now() - startedAt
      const ip = await this.fetchIpAddress(normalized)

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
      const errorMessage = this.sanitizeProxyError(err?.message || String(err), normalized)
      return {
        ok: false,
        platform,
        testUrl,
        latencyMs: Date.now() - startedAt,
        error: errorMessage
      }
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

  private normalizeProxy(proxy: Partial<AutoProxy>): NormalizedProxy {
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

  private async fetchWithProxy(url: string, proxy: NormalizedProxy): Promise<any> {
    const { default: nodeFetch } = await import('node-fetch')
    const agent = await this.createProxyAgent(proxy, url)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROXY_TEST_TIMEOUT_MS)

    try {
      return await nodeFetch(url, {
        agent,
        signal: controller.signal,
        headers: {
          Accept: '*/*',
          'User-Agent': 'Mozilla/5.0'
        }
      } as any)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async createProxyAgent(proxy: NormalizedProxy, targetUrl: string): Promise<any> {
    const proxyUrl = this.buildProxyUrl(proxy)
    if (proxy.protocol === 'socks5') {
      const mod = await import('socks-proxy-agent')
      return new mod.SocksProxyAgent(proxyUrl)
    }

    const targetProtocol = new URL(targetUrl).protocol
    if (targetProtocol === 'http:') {
      const mod = await import('http-proxy-agent')
      return new mod.HttpProxyAgent(proxyUrl)
    }

    const mod = await import('https-proxy-agent')
    return new mod.HttpsProxyAgent(proxyUrl)
  }

  private buildProxyUrl(proxy: NormalizedProxy): string {
    const auth = proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
      : ''
    return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`
  }

  private sanitizeProxyError(message: string, proxy: NormalizedProxy): string {
    let sanitized = message
    if (proxy.username) {
      const fullProxyUrl = this.buildProxyUrl(proxy)
      const maskedProxyUrl = this.buildProxyUrl({
        ...proxy,
        password: proxy.password ? '******' : proxy.password
      })
      sanitized = sanitized.split(fullProxyUrl).join(maskedProxyUrl)
    }
    if (proxy.password) {
      sanitized = sanitized
        .split(proxy.password).join('******')
        .split(encodeURIComponent(proxy.password)).join('******')
    }
    return sanitized
  }

  private async fetchIpAddress(proxy: NormalizedProxy): Promise<string | undefined> {
    try {
      const response = await this.fetchWithProxy(IP_CHECK_URL, proxy)
      if (!response.ok) return undefined
      const data = await response.json() as { ip?: unknown }
      const ip = String(data?.ip || '').trim()
      return ip || undefined
    } catch {
      return undefined
    }
  }
}
