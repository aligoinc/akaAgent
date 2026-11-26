// Dấu "tài khoản đang ở danh tính Page" của engine v2 Facebook (phương án mục 7.6): ghi trên máy trước khi workflow đổi sang Page, xoá
// khi đã đổi về. App tắt giữa chừng thì lượt kế tiếp của tài khoản đổi về trước khi nhận data, không chạy dưới danh tính sai.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface FacebookIdentityMarker {
  campaignId: number
  workflowId: number
  originalIdentityName: string
  /** V663: danh tính ban đầu là Page hay trang cá nhân; null khi không biết (code block trước V663, dấu ghi bởi bản app cũ). */
  originalIdentityIsPage?: boolean | null
}

const written = new Map<number, string>()

function file(accountId: number): string {
  return path.join(app.getPath('userData'), 'local-data', 'engine-facebook-identity', `${accountId}.json`)
}

export function writeFacebookIdentityMarker(accountId: number, marker: FacebookIdentityMarker): void {
  if (!marker.originalIdentityName) return
  const text = JSON.stringify(marker)
  if (written.get(accountId) === text) return
  try {
    fs.mkdirSync(path.dirname(file(accountId)), { recursive: true })
    fs.writeFileSync(file(accountId), text, 'utf8')
    written.set(accountId, text)
  } catch (error) {
    console.warn('[CampaignEngine] Không ghi được dấu danh tính Page:', error)
  }
}

export function readFacebookIdentityMarker(accountId: number): FacebookIdentityMarker | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file(accountId), 'utf8')) as Partial<FacebookIdentityMarker>
    const campaignId = Number(raw.campaignId), workflowId = Number(raw.workflowId)
    const originalIdentityName = String(raw.originalIdentityName ?? '').trim()
    if (!Number.isSafeInteger(campaignId) || !Number.isSafeInteger(workflowId) || !originalIdentityName) return null
    const originalIdentityIsPage = typeof raw.originalIdentityIsPage === 'boolean' ? raw.originalIdentityIsPage : null
    return { campaignId, workflowId, originalIdentityName, originalIdentityIsPage }
  } catch {
    return null
  }
}

export function clearFacebookIdentityMarker(accountId: number): void {
  written.delete(accountId)
  try { fs.rmSync(file(accountId), { force: true }) } catch { /* không có thì thôi */ }
}
