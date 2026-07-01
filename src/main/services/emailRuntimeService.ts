import { existsSync } from 'fs'
import { basename, extname } from 'path'
import { resolve4, resolve6, resolveMx } from 'dns/promises'
import { Socket } from 'net'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { EmailAccountConfig, isValidEmailInputDataValue, normalizeEmailInputDataValue } from '../../shared/types'
import { SupabaseService } from './supabase'
import { getSupabaseUrl } from '../data/supabaseClient'

const EMAIL_SMTP_PROBE_PORT = 25
const EMAIL_SMTP_PROBE_TIMEOUT_MS = 4000
const EMAIL_SMTP_PROBE_MAX_HOSTS = 2
const EMAIL_SMTP_PROBE_UNAVAILABLE_CACHE_MS = 10 * 60 * 1000
const SMTP_RCPT_ACCEPT_CODES = new Set([250, 251, 252])
const DNS_NEGATIVE_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENODOMAIN'])
const EMAIL_TEXT_URL_PATTERN = /(^|[^\w@./-])((?:https?:\/\/[^\s<>"']+)|(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s<>"']*)?))/gi
const EMAIL_BARE_DOMAIN_PATTERN = /^(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?::\d{2,5})?(?:\/[^\s<>"']*)?$/i
const EMAIL_HTML_LINKIFY_SKIP_TAGS = new Set(['a', 'script', 'style', 'textarea'])

export interface EmailSendInput {
  to: string
  subject: string
  body: string
  isHtml?: boolean
  attachments?: string[] // local file paths
  tracking?: EmailSendTrackingInput
}

export interface EmailSendTrackingInput {
  campaignId: number
  inputDataId?: number | null
  recipientName?: string | null
  enableClickTracking?: boolean
}

export interface EmailSendResult {
  ok: boolean
  messageId?: string
  trackingMessageId?: number
  error?: string
}

export interface EmailRecipientCheckResult {
  status: 'valid' | 'not_found' | 'unknown'
  reason?: string
  data?: Record<string, unknown>
}

interface EmailMailHostResolution {
  status: 'valid' | 'not_found' | 'unknown'
  hosts: string[]
  reason?: string
}

interface SmtpResponse {
  code: number
  text: string
}

interface PreparedEmailBody {
  text?: string
  html?: string
  trackingMessageId?: number
}

interface PendingLinkRewrite {
  placeholder: string
  originalUrl: string
  linkIndex: number
}

/**
 * Browserless email runtime — gửi mail qua SMTP (nodemailer) trong main process.
 * Mirror cấu trúc ZaloRuntimeService: cache transporter theo account, được
 * campaignScheduler gọi qua block helper emailSendMessage.
 */
export class EmailRuntimeService {
  private transporters = new Map<number, { signature: string; transporter: Transporter }>()
  private smtpProbeUnavailableUntilByDomain = new Map<string, number>()

  constructor(private readonly supabase: SupabaseService) {}

  private signatureOf(config: EmailAccountConfig): string {
    return [config.host, config.port, config.secure, config.user, config.pass].join('|')
  }

  private buildTransporter(config: EmailAccountConfig): Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure === true,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined
    })
  }

  private getTransporter(accountId: number, config: EmailAccountConfig): Transporter {
    const signature = this.signatureOf(config)
    const cached = this.transporters.get(accountId)
    if (cached && cached.signature === signature) return cached.transporter
    const transporter = this.buildTransporter(config)
    this.transporters.set(accountId, { signature, transporter })
    return transporter
  }

  async ensureConfig(accountId: number): Promise<EmailAccountConfig> {
    const entry = await this.supabase.getAccountEmailSession(accountId)
    if (!entry) throw new Error('Không tìm thấy tài khoản email')
    if (!entry.session) throw new Error('Tài khoản email chưa được cấu hình SMTP')
    return entry.session
  }

  /** Kiểm tra kết nối SMTP với 1 cấu hình (không cần lưu trước). */
  async verifyConfig(config: EmailAccountConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const transporter = this.buildTransporter(config)
      await transporter.verify()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private buildFrom(config: EmailAccountConfig): string {
    const brand = String(config.brandName || '').trim()
    return brand ? `"${brand}" <${config.fromEmail}>` : config.fromEmail
  }

  private buildAttachmentFilename(path: string, count: number): string | undefined {
    if (count <= 1) return undefined
    const name = basename(path) || 'attachment'
    const ext = extname(name)
    const stem = ext ? name.slice(0, -ext.length) : name
    return `${stem} (${count})${ext}`
  }

  private buildTrackingFunctionUrl(functionName: 'email-open' | 'email-click', token: string): string {
    const base = getSupabaseUrl().replace(/\/+$/g, '')
    const url = new URL(`${base}/functions/v1/${functionName}`)
    url.searchParams.set('t', token)
    return url.toString()
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  private escapeHtmlAttribute(value: string): string {
    return this.escapeHtml(value)
  }

  private decodeHtmlAttribute(value: string): string {
    return String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#039;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  }

  private splitUrlTrailingText(raw: string): { urlText: string; trailingText: string } {
    let urlText = raw
    let trailingText = ''
    const shouldStripClosing = (close: string, open: string) => {
      const openCount = Array.from(urlText).filter(char => char === open).length
      const closeCount = Array.from(urlText).filter(char => char === close).length
      return closeCount > openCount
    }

    while (urlText.length > 0) {
      const last = urlText[urlText.length - 1]
      if (/[.,!?;:]/.test(last)) {
        trailingText = last + trailingText
        urlText = urlText.slice(0, -1)
        continue
      }
      if (
        (last === ')' && shouldStripClosing(')', '(')) ||
        (last === ']' && shouldStripClosing(']', '[')) ||
        (last === '}' && shouldStripClosing('}', '{'))
      ) {
        trailingText = last + trailingText
        urlText = urlText.slice(0, -1)
        continue
      }
      break
    }

    return { urlText, trailingText }
  }

  private normalizeHrefForLink(raw: string): string | null {
    const href = raw.trim()
    if (!href) return null
    if (/^https?:\/\//i.test(href)) return href
    if (EMAIL_BARE_DOMAIN_PATTERN.test(href)) return `https://${href}`
    return null
  }

  private plainTextToHtml(text: string): string {
    const source = String(text || '')
    let lastIndex = 0
    let html = ''
    for (const match of source.matchAll(EMAIL_TEXT_URL_PATTERN)) {
      const prefix = match[1] || ''
      const raw = match[2] || ''
      const start = (match.index ?? 0) + prefix.length
      const { urlText, trailingText } = this.splitUrlTrailingText(raw)
      const href = this.normalizeHrefForLink(urlText)
      if (!href) continue

      html += this.escapeHtml(source.slice(lastIndex, start))
      html += `<a href="${this.escapeHtmlAttribute(href)}">${this.escapeHtml(urlText)}</a>${this.escapeHtml(trailingText)}`
      lastIndex = start + raw.length
    }
    html += this.escapeHtml(source.slice(lastIndex))
    return html.replace(/\r\n|\r|\n/g, '<br>')
  }

  private linkifyHtmlTextSegment(text: string): string {
    const source = String(text || '')
    let lastIndex = 0
    let html = ''
    for (const match of source.matchAll(EMAIL_TEXT_URL_PATTERN)) {
      const prefix = match[1] || ''
      const raw = match[2] || ''
      const start = (match.index ?? 0) + prefix.length
      const { urlText, trailingText } = this.splitUrlTrailingText(raw)
      const href = this.normalizeHrefForLink(urlText)
      if (!href) continue

      html += source.slice(lastIndex, start)
      html += `<a href="${this.escapeHtmlAttribute(href)}">${this.escapeHtml(urlText)}</a>${trailingText}`
      lastIndex = start + raw.length
    }
    html += source.slice(lastIndex)
    return html
  }

  private linkifyHtmlText(html: string): string {
    const source = String(html || '')
    const tagPattern = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g
    const skippedTags: string[] = []
    let lastIndex = 0
    let output = ''

    for (const match of source.matchAll(tagPattern)) {
      const tag = match[0] || ''
      const tagStart = match.index ?? 0
      const textChunk = source.slice(lastIndex, tagStart)
      output += skippedTags.length > 0 ? textChunk : this.linkifyHtmlTextSegment(textChunk)
      output += tag

      const tagName = (match[1] || '').toLowerCase()
      if (tagName && EMAIL_HTML_LINKIFY_SKIP_TAGS.has(tagName)) {
        const isClosingTag = /^<\s*\//.test(tag)
        const isSelfClosingTag = /\/\s*>$/.test(tag)
        const activeSkipTag = skippedTags[skippedTags.length - 1]

        if (activeSkipTag) {
          if (isClosingTag && tagName === activeSkipTag) skippedTags.pop()
        } else if (!isClosingTag && !isSelfClosingTag) {
          skippedTags.push(tagName)
        }
      }

      lastIndex = tagStart + tag.length
    }

    const tail = source.slice(lastIndex)
    output += skippedTags.length > 0 ? tail : this.linkifyHtmlTextSegment(tail)
    return output
  }

  private normalizeTrackableUrl(rawHref: string): string | null {
    const href = this.decodeHtmlAttribute(rawHref).trim()
    if (!href) return null
    if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href)) return null
    if (/\/functions\/v1\/email-click\?/i.test(href)) return null
    try {
      const normalizedHref = this.normalizeHrefForLink(href)
      if (!normalizedHref) return null
      const url = new URL(normalizedHref)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
    } catch {
      return null
    }
  }

  private appendOpenTrackingPixel(html: string, openTrackingUrl: string): string {
    const pixel = `<img src="${this.escapeHtmlAttribute(openTrackingUrl)}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0!important;opacity:0!important" />`
    const bodyClosePattern = /<\/body\s*>/i
    if (bodyClosePattern.test(html)) return html.replace(bodyClosePattern, `${pixel}</body>`)
    return `${html}${pixel}`
  }

  private async rewriteHtmlLinksForTracking(
    html: string,
    messageTrackingId: number
  ): Promise<{ html: string; trackedLinkCount: number }> {
    const pending: PendingLinkRewrite[] = []
    const htmlWithPlaceholders = html.replace(
      /<a\b([^>]*?)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>/gi,
      (match, before: string, doubleValue?: string, singleValue?: string, unquotedValue?: string, after?: string) => {
        const rawHref = doubleValue ?? singleValue ?? unquotedValue ?? ''
        const originalUrl = this.normalizeTrackableUrl(rawHref)
        if (!originalUrl) return match

        const linkIndex = pending.length + 1
        const placeholder = `__AKA_EMAIL_CLICK_${messageTrackingId}_${linkIndex}__`
        pending.push({ placeholder, originalUrl, linkIndex })
        return `<a${before || ' '}href="${placeholder}"${after || ''}>`
      }
    )

    if (pending.length === 0) return { html, trackedLinkCount: 0 }

    const linkRows = await this.supabase.createEmailLinkTrackings(
      pending.map(item => ({
        messageTrackingId,
        originalUrl: item.originalUrl,
        linkIndex: item.linkIndex
      }))
    )
    const linksByIndex = new Map(linkRows.map(row => [row.linkIndex, row]))
    let output = htmlWithPlaceholders
    for (const item of pending) {
      const row = linksByIndex.get(item.linkIndex)
      const nextHref = row?.clickToken
        ? this.buildTrackingFunctionUrl('email-click', row.clickToken)
        : item.originalUrl
      output = output.split(item.placeholder).join(this.escapeHtmlAttribute(nextHref))
    }

    return { html: output, trackedLinkCount: linkRows.length }
  }

  private async prepareEmailBody(
    accountId: number,
    input: EmailSendInput
  ): Promise<PreparedEmailBody> {
    const baseHtml = input.isHtml ? input.body : this.plainTextToHtml(input.body)
    const baseBody: PreparedEmailBody = input.isHtml
      ? { html: input.body }
      : { text: input.body }

    if (!input.tracking) return baseBody

    let messageTrackingId: number | null = null
    try {
      const messageTracking = await this.supabase.createEmailMessageTracking({
        campaignId: input.tracking.campaignId,
        accountId,
        inputDataId: input.tracking.inputDataId ?? null,
        recipientEmail: input.to,
        recipientName: input.tracking.recipientName || null,
        subject: input.subject
      })
      messageTrackingId = messageTracking.id
      const openTrackingUrl = this.buildTrackingFunctionUrl('email-open', messageTracking.openToken)
      let html = baseHtml
      if (input.tracking.enableClickTracking === true) {
        if (input.isHtml) html = this.linkifyHtmlText(html)
        const rewritten = await this.rewriteHtmlLinksForTracking(html, messageTracking.id)
        html = rewritten.html
      }
      html = this.appendOpenTrackingPixel(html, openTrackingUrl)

      return {
        text: input.isHtml ? undefined : input.body,
        html,
        trackingMessageId: messageTracking.id
      }
    } catch (err) {
      if (messageTrackingId) {
        await this.supabase.softDeleteEmailMessageTracking(messageTrackingId).catch(cleanupErr => {
          console.warn('[EmailRuntime] failed to cleanup unprepared tracking row:', cleanupErr)
        })
      }
      throw err
    }
  }

  async checkRecipientExists(accountId: number, email: string): Promise<EmailRecipientCheckResult> {
    const to = normalizeEmailInputDataValue(email)
    if (!isValidEmailInputDataValue(to)) {
      return {
        status: 'not_found',
        reason: 'Địa chỉ email không hợp lệ',
        data: { check: 'format' }
      }
    }

    const domain = to.split('@')[1]?.toLowerCase() || ''
    const mailHosts = await this.resolveMailHosts(domain)
    if (mailHosts.status === 'not_found') {
      return {
        status: 'not_found',
        reason: mailHosts.reason || `Domain email ${domain} không nhận mail`,
        data: { check: 'dns', domain }
      }
    }
    if (mailHosts.status === 'unknown' || mailHosts.hosts.length === 0) {
      return {
        status: 'unknown',
        reason: mailHosts.reason || `Không thể xác minh domain email ${domain}`,
        data: { check: 'dns', domain }
      }
    }

    let fromEmail = ''
    try {
      const config = await this.ensureConfig(accountId)
      fromEmail = config.fromEmail
    } catch {
      // Sender config errors are handled by sendEmail(); do not turn them into recipient failures.
    }

    return this.probeRecipientBySmtp(to, domain, mailHosts.hosts, fromEmail)
  }

  private async resolveMailHosts(domain: string): Promise<EmailMailHostResolution> {
    let mxError: unknown = null
    let mxWasEmpty = false
    try {
      const records = await resolveMx(domain)
      const hasNullMx = records.some(record => String(record.exchange || '').trim() === '.')
      if (hasNullMx) {
        return {
          status: 'not_found',
          hosts: [],
          reason: `Domain email ${domain} khai báo không nhận mail`
        }
      }
      const hosts = records
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map(record => String(record.exchange || '').trim().replace(/\.$/, '').toLowerCase())
        .filter(Boolean)
      if (hosts.length > 0) return { status: 'valid', hosts }
      mxWasEmpty = true
    } catch (err) {
      mxError = err
    }

    const addressState = await this.hasAddressRecord(domain)
    if (addressState === true) return { status: 'valid', hosts: [domain] }
    if (addressState === false && (mxWasEmpty || this.isDnsNegativeError(mxError))) {
      return {
        status: 'not_found',
        hosts: [],
        reason: `Domain email ${domain} không có MX/A record nhận mail`
      }
    }

    return {
      status: 'unknown',
      hosts: [],
      reason: `Không thể kiểm tra DNS domain ${domain}`
    }
  }

  private async hasAddressRecord(domain: string): Promise<boolean | null> {
    const results = await Promise.allSettled([resolve4(domain), resolve6(domain)])
    let hasAddress = false
    let hasUnexpectedError = false

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (Array.isArray(result.value) && result.value.length > 0) hasAddress = true
      } else if (!this.isDnsNegativeError(result.reason)) {
        hasUnexpectedError = true
      }
    }

    if (hasAddress) return true
    return hasUnexpectedError ? null : false
  }

  private isDnsNegativeError(err: unknown): boolean {
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : ''
    return DNS_NEGATIVE_CODES.has(code)
  }

  private async probeRecipientBySmtp(
    recipient: string,
    recipientDomain: string,
    hosts: string[],
    fromEmail: string
  ): Promise<EmailRecipientCheckResult> {
    const probeHosts = Array.from(new Set(hosts.map(host => host.trim()).filter(Boolean))).slice(0, EMAIL_SMTP_PROBE_MAX_HOSTS)
    const unavailableUntil = this.smtpProbeUnavailableUntilByDomain.get(recipientDomain) || 0
    if (unavailableUntil > Date.now()) {
      return {
        status: 'unknown',
        reason: 'SMTP probe đang tạm bỏ qua vì mạng chặn hoặc timeout trước đó',
        data: { check: 'smtp', hosts: probeHosts, cachedUnavailable: true }
      }
    }

    for (const host of probeHosts) {
      try {
        const result = await this.probeSingleSmtpHost(host, recipient, recipientDomain, fromEmail)
        if (result.status === 'valid' || result.status === 'not_found') return result
      } catch (err) {
        if (this.isSmtpProbeNetworkUnavailable(err)) {
          this.smtpProbeUnavailableUntilByDomain.set(
            recipientDomain,
            Date.now() + EMAIL_SMTP_PROBE_UNAVAILABLE_CACHE_MS
          )
          break
        }
        // Try the next MX. Network failures are treated as unknown, never as not_found.
      }
    }

    return {
      status: 'unknown',
      reason: 'SMTP server không cho xác minh trước khi gửi',
      data: { check: 'smtp', hosts: probeHosts }
    }
  }

  private async probeSingleSmtpHost(
    host: string,
    recipient: string,
    recipientDomain: string,
    fromEmail: string
  ): Promise<EmailRecipientCheckResult> {
    const socket = await this.connectSmtpSocket(host)
    const buffer = { value: '' }
    try {
      const greeting = await this.readSmtpResponse(socket, buffer)
      if (greeting.code !== 220) return this.unknownSmtpResult(host, greeting, 'SMTP server không sẵn sàng')

      let response = await this.sendSmtpCommand(socket, buffer, `EHLO ${this.getSmtpClientName(fromEmail, recipientDomain)}`)
      if (response.code >= 400) {
        response = await this.sendSmtpCommand(socket, buffer, `HELO ${this.getSmtpClientName(fromEmail, recipientDomain)}`)
        if (response.code >= 400) return this.unknownSmtpResult(host, response, 'SMTP server từ chối HELO/EHLO')
      }

      const sender = this.getProbeSenderEmail(fromEmail, recipientDomain)
      response = await this.sendSmtpCommand(socket, buffer, `MAIL FROM:<${sender}>`)
      if (response.code >= 400) return this.unknownSmtpResult(host, response, 'SMTP server từ chối sender probe')

      response = await this.sendSmtpCommand(socket, buffer, `RCPT TO:<${recipient}>`)
      if (SMTP_RCPT_ACCEPT_CODES.has(response.code)) {
        return {
          status: 'valid',
          reason: 'SMTP server chấp nhận người nhận',
          data: { check: 'smtp', host, code: response.code }
        }
      }
      if (this.isRecipientNotFoundResponse(response)) {
        return {
          status: 'not_found',
          reason: this.normalizeSmtpReason(response.text) || `SMTP server báo email không tồn tại (${response.code})`,
          data: { check: 'smtp', host, code: response.code, response: response.text }
        }
      }

      return this.unknownSmtpResult(host, response, 'SMTP server trả phản hồi không xác định')
    } finally {
      try { socket.write('QUIT\r\n') } catch {}
      socket.destroy()
    }
  }

  private connectSmtpSocket(host: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      let timer: ReturnType<typeof setTimeout>

      function cleanup() {
        clearTimeout(timer)
        socket.off('connect', onConnect)
        socket.off('error', onError)
      }

      function onConnect() {
        cleanup()
        resolve(socket)
      }

      function onError(err: Error) {
        cleanup()
        socket.destroy()
        reject(err)
      }

      timer = setTimeout(() => {
        cleanup()
        socket.destroy()
        reject(new Error('SMTP connect timeout'))
      }, EMAIL_SMTP_PROBE_TIMEOUT_MS)
      socket.once('connect', onConnect)
      socket.once('error', onError)
      socket.connect(EMAIL_SMTP_PROBE_PORT, host)
    })
  }

  private sendSmtpCommand(socket: Socket, buffer: { value: string }, command: string): Promise<SmtpResponse> {
    socket.write(`${command}\r\n`)
    return this.readSmtpResponse(socket, buffer)
  }

  private readSmtpResponse(socket: Socket, buffer: { value: string }): Promise<SmtpResponse> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>

      function cleanup() {
        clearTimeout(timer)
        socket.off('data', onData)
        socket.off('error', onError)
        socket.off('close', onClose)
      }
      const resolveIfComplete = () => {
        const parsed = this.parseSmtpResponse(buffer.value)
        if (!parsed) return
        buffer.value = ''
        cleanup()
        resolve(parsed)
      }
      function onData(chunk: Buffer | string) {
        buffer.value += chunk.toString()
        resolveIfComplete()
      }

      function onError(err: Error) {
        cleanup()
        reject(err)
      }

      function onClose() {
        cleanup()
        reject(new Error('SMTP socket closed'))
      }

      timer = setTimeout(() => {
        cleanup()
        reject(new Error('SMTP response timeout'))
      }, EMAIL_SMTP_PROBE_TIMEOUT_MS)
      socket.on('data', onData)
      socket.once('error', onError)
      socket.once('close', onClose)
      resolveIfComplete()
    })
  }

  private parseSmtpResponse(buffer: string): SmtpResponse | null {
    const completeLines = buffer
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
    if (!buffer.endsWith('\n') && !buffer.endsWith('\r')) completeLines.pop()

    let code: number | null = null
    const responseLines: string[] = []
    for (const line of completeLines) {
      const match = /^(\d{3})([- ])(.*)$/.exec(line)
      if (!match) continue
      const currentCode = Number(match[1])
      if (!Number.isFinite(currentCode)) continue
      if (code === null) code = currentCode
      if (currentCode !== code) continue
      responseLines.push(line)
      if (match[2] === ' ') {
        return {
          code,
          text: responseLines.join('\n')
        }
      }
    }

    return null
  }

  private isRecipientNotFoundResponse(response: SmtpResponse): boolean {
    const normalized = this.normalizeSmtpReason(response.text).toLowerCase()
    if (response.code < 500) return false
    if (!normalized) return false
    if (/\b5\.1\.(1|10)\b/.test(normalized)) return true
    if (/\b5\.7\.\d+\b/.test(normalized)) return false

    const notFoundPatterns = [
      /\buser unknown\b/,
      /\bunknown user\b/,
      /\bunknown recipient\b/,
      /\brecipient unknown\b/,
      /\brecipient(?: address)? rejected: user unknown\b/,
      /\bno such (user|recipient|mailbox|address)\b/,
      /\b(user|recipient|mailbox|address) not found\b/,
      /\binvalid recipient\b/,
      /\baccount (?:does not|doesn't) exist\b/,
      /\b(address|mailbox|recipient|user) (?:does not|doesn't) exist\b/
    ]
    return notFoundPatterns.some(pattern => pattern.test(normalized))
  }

  private isSmtpProbeNetworkUnavailable(err: unknown): boolean {
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : ''
    if (['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EPERM'].includes(code)) {
      return true
    }
    const message = err instanceof Error ? err.message : String(err || '')
    return /timeout|timed out|network is unreachable|permission denied/i.test(message)
  }

  private getProbeSenderEmail(fromEmail: string, fallbackDomain: string): string {
    const normalized = normalizeEmailInputDataValue(fromEmail)
    return isValidEmailInputDataValue(normalized) ? normalized : `postmaster@${fallbackDomain}`
  }

  private getSmtpClientName(fromEmail: string, fallbackDomain: string): string {
    const normalized = normalizeEmailInputDataValue(fromEmail)
    const domain = isValidEmailInputDataValue(normalized) ? normalized.split('@')[1] : fallbackDomain
    return domain || 'aka-agent.local'
  }

  private unknownSmtpResult(host: string, response: SmtpResponse, reason: string): EmailRecipientCheckResult {
    return {
      status: 'unknown',
      reason,
      data: { check: 'smtp', host, code: response.code, response: response.text }
    }
  }

  private normalizeSmtpReason(value: string): string {
    return value
      .replace(/\s+/g, ' ')
      .trim()
  }

  async sendEmail(accountId: number, input: EmailSendInput): Promise<EmailSendResult> {
    const config = await this.ensureConfig(accountId)
    const transporter = this.getTransporter(accountId, config)
    const filenameCounts = new Map<string, number>()
    const attachments = (Array.isArray(input.attachments) ? input.attachments : [])
      .map(item => String(item || '').trim())
      .filter(path => path.length > 0 && existsSync(path))
      .map(path => {
        const name = basename(path) || 'attachment'
        const count = (filenameCounts.get(name) || 0) + 1
        filenameCounts.set(name, count)
        return {
          path,
          filename: this.buildAttachmentFilename(path, count)
        }
      })

    const preparedBody = await this.prepareEmailBody(accountId, input)
    let info: { messageId?: string }
    try {
      info = await transporter.sendMail({
        from: this.buildFrom(config),
        to: input.to,
        subject: input.subject,
        ...(preparedBody.text !== undefined ? { text: preparedBody.text } : {}),
        ...(preparedBody.html !== undefined ? { html: preparedBody.html } : {}),
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
        ...(config.cc ? { cc: config.cc } : {}),
        attachments
      }) as { messageId?: string }
    } catch (err) {
      if (preparedBody.trackingMessageId) {
        await this.supabase.softDeleteEmailMessageTracking(preparedBody.trackingMessageId).catch(cleanupErr => {
          console.warn('[EmailRuntime] failed to cleanup unsent tracking row:', cleanupErr)
        })
      }
      throw err
    }

    if (preparedBody.trackingMessageId) {
      await this.supabase.markEmailMessageTrackingSent(preparedBody.trackingMessageId, info.messageId).catch(err => {
        console.warn('[EmailRuntime] failed to mark email tracking sent:', err)
      })
    }

    return {
      ok: true,
      messageId: info.messageId,
      trackingMessageId: preparedBody.trackingMessageId
    }
  }

  invalidateAccount(accountId: number): void {
    this.transporters.delete(accountId)
  }

  clearAll(): void {
    this.transporters.clear()
  }
}
