// @deno-types="npm:@types/nodemailer@6.4.17"
import nodemailer from 'npm:nodemailer@6.9.16'

type EmailPayload = {
  to: string | string[]
  subject: string
  html: string
  cc?: string | string[]
  replyTo?: string
}

const jsonHeaders = { 'Content-Type': 'application/json' }

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function normalizeEmails(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n;]/)
      : []

  const seen = new Set<string>()
  const emails: string[] = []
  for (const raw of values) {
    const email = String(raw || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

function parseBool(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function validateInternalToken(req: Request): boolean {
  const expected = Deno.env.get('INTERNAL_EDGE_FUNCTION_TOKEN')?.trim()
  return !!expected && req.headers.get('x-internal-token') === expected
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' })
  if (!validateInternalToken(req)) return jsonResponse(401, { ok: false, error: 'Unauthorized' })

  try {
    const payload = await req.json() as Partial<EmailPayload>
    const to = normalizeEmails(payload.to)
    const cc = normalizeEmails(payload.cc)
    const subject = String(payload.subject || '').trim()
    const html = String(payload.html || '').trim()
    const replyTo = String(payload.replyTo || '').trim()

    if (to.length === 0) return jsonResponse(400, { ok: false, error: 'Missing recipient email' })
    if (!subject) return jsonResponse(400, { ok: false, error: 'Missing subject' })
    if (!html) return jsonResponse(400, { ok: false, error: 'Missing html' })

    const host = getRequiredEnv('SMTP_SERVER_NAME')
    const port = Number(getRequiredEnv('SMTP_PORT'))
    const user = getRequiredEnv('SMTP_USERNAME')
    const pass = getRequiredEnv('SMTP_PASSWORD')
    const fromEmail = getRequiredEnv('SMTP_EMAIL')
    const enableSsl = parseBool(Deno.env.get('SMTP_ENABLE_SSL'))
    const fromName = Deno.env.get('SMTP_FROM_NAME')?.trim() || 'akaAgent'

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: enableSsl && port === 465,
      requireTLS: enableSsl && port !== 465,
      auth: { user, pass },
      tls: { servername: host }
    })

    const info = await transporter.sendMail({
      from: { address: fromEmail, name: fromName },
      to,
      cc: cc.length > 0 ? cc : undefined,
      replyTo: replyTo || undefined,
      subject,
      html
    })

    return jsonResponse(200, {
      ok: true,
      messageId: info.messageId || null
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    return jsonResponse(500, { ok: false, error: message })
  }
})
