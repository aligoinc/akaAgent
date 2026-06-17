import { existsSync } from 'fs'
import { basename, extname } from 'path'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { EmailAccountConfig } from '../../shared/types'
import { SupabaseService } from './supabase'

export interface EmailSendInput {
  to: string
  subject: string
  body: string
  isHtml?: boolean
  attachments?: string[] // local file paths
}

export interface EmailSendResult {
  ok: boolean
  messageId?: string
  error?: string
}

/**
 * Browserless email runtime — gửi mail qua SMTP (nodemailer) trong main process.
 * Mirror cấu trúc ZaloRuntimeService: cache transporter theo account, được
 * campaignScheduler gọi qua block helper emailSendMessage.
 */
export class EmailRuntimeService {
  private transporters = new Map<number, { signature: string; transporter: Transporter }>()

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

    const info = await transporter.sendMail({
      from: this.buildFrom(config),
      to: input.to,
      subject: input.subject,
      ...(input.isHtml ? { html: input.body } : { text: input.body }),
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      ...(config.cc ? { cc: config.cc } : {}),
      attachments
    })

    return { ok: true, messageId: info.messageId }
  }

  invalidateAccount(accountId: number): void {
    this.transporters.delete(accountId)
  }

  clearAll(): void {
    this.transporters.clear()
  }
}
