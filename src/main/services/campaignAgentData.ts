import { app } from 'electron'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireCurrentUser } from '../data/currentUser'
import { agentUuid, isAgentRecord } from '../../shared/campaignAgent'
import { AGENT_DATA_MAX_BYTES, AGENT_DATA_TOTAL_BYTES, AGENT_DATA_IMAGE_TOTAL_BYTES, validAgentDataFiles, type AgentDataFile, type AgentDataSource } from '../../shared/campaignAgentData'
import { validateCampaignSupportUploadImages } from './campaignSupportImageValidation'
import { readAgentImage } from './campaignAgentImages'
import { recognizeAgentOcr } from './campaignAgentOcr'

const invalid = () => new Error('Không thể đọc dữ liệu. Hãy chọn lại file TXT, Excel/CSV hoặc ảnh hợp lệ.')
let languageFiles: Promise<string> | undefined
let ocrRunning = false
function bundledLanguages(): Promise<string> {
  if (!languageFiles) languageFiles = (async () => {
    const dir = join(app.getPath('userData'), 'campaign-agent-ocr-models')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    for (const code of ['vie', 'eng']) await writeFile(join(dir, `${code}.traineddata.gz`),
      await readFile(require.resolve(`@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`)), { mode: 0o600 })
    return dir
  })().catch(error => { languageFiles = undefined; throw error })
  return languageFiles
}
function directory(draftId: unknown): string {
  if (!agentUuid(draftId)) throw invalid()
  const user = requireCurrentUser()
  return join(app.getPath('userData'), 'campaign-agent-data', String(user.organizationId), String(user.staffId), draftId)
}
export async function storeAgentData(input: unknown): Promise<AgentDataFile[]> {
  if (!isAgentRecord(input) || !Array.isArray(input.files) || !input.files.length || input.files.length > 5) throw invalid()
  const dir = directory(input.draftId), stored: AgentDataFile[] = []
  let total = 0, imageTotal = 0
  await mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    for (const file of input.files) {
      if (!isAgentRecord(file) || typeof file.name !== 'string' || file.name.length > 200 || typeof file.dataBase64 !== 'string'
        || file.dataBase64.length > Math.ceil(AGENT_DATA_MAX_BYTES / 3) * 4 || !/^[\w+/]*={0,2}$/.test(file.dataBase64)) throw invalid()
      const bytes = Buffer.from(file.dataBase64, 'base64')
      total += bytes.length
      if (!bytes.length || bytes.length > AGENT_DATA_MAX_BYTES || total > AGENT_DATA_TOTAL_BYTES) throw invalid()
      const name = file.name.replace(/[\\/\u0000-\u001f]/g, '_')
      const kind = /\.(xlsx|xls|csv)$/i.test(name) ? 'excel' : /\.txt$/i.test(name) ? 'text' : /\.(png|jpe?g|webp)$/i.test(name) ? 'image' : null
      if (!kind) throw invalid()
      if (kind === 'image') {
        imageTotal += bytes.length
        if (imageTotal > AGENT_DATA_IMAGE_TOTAL_BYTES) throw invalid()
        validateCampaignSupportUploadImages([{ name, mimeType: file.mimeType, dataBase64: file.dataBase64 }])
      }
      const ref: AgentDataFile = { id: randomUUID(), name, kind, bytes: bytes.length }
      await writeFile(join(dir, ref.id + '.json'), JSON.stringify({ ...ref, mimeType: String(file.mimeType || ''), dataBase64: file.dataBase64 }), { mode: 0o600, flag: 'wx' })
      stored.push(ref)
    }
    return stored
  } catch { await Promise.allSettled(stored.map(ref => unlink(join(dir, ref.id + '.json')))); throw invalid() }
}
export async function recognizeAgentDataImage(imageDataUrl: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  if (ocrRunning) throw new Error('Đang dừng lượt đọc ảnh trước. Hãy thử lại sau vài giây.')
  ocrRunning = true
  try { return await recognizeImage(imageDataUrl, signal) }
  finally { ocrRunning = false }
}
async function recognizeImage(imageDataUrl: string, signal: AbortSignal): Promise<string> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/.exec(imageDataUrl)
  if (!match) throw invalid()
  validateCampaignSupportUploadImages([{ name: 'data.' + match[1].split('/')[1], mimeType: match[1], dataBase64: match[2] }])
  signal.throwIfAborted()
  // Explicit local langPath: missing bundled models fail locally, never download from a CDN.
  const langPath = await bundledLanguages()
  signal.throwIfAborted()
  try {
    const text = await recognizeAgentOcr(Buffer.from(match[2], 'base64'), langPath, signal)
    if (!text.trim()) throw new Error('Chưa đọc được chữ trong ảnh. Hãy chọn ảnh rõ hơn hoặc dùng Excel/TXT.')
    if (Buffer.byteLength(text) > AGENT_DATA_MAX_BYTES) throw invalid()
    return text.replace(/ {2,}/g, '\t')
  } catch (error) {
    // Repair missing/corrupt local copies on the next attempt from bundled models.
    languageFiles = undefined
    throw error
  }
}
export async function readAgentData(input: unknown, signal: AbortSignal): Promise<AgentDataSource> {
  if (!isAgentRecord(input) || !validAgentDataFiles([input.file])) throw invalid()
  const ref = input.file as unknown as AgentDataFile, dir = directory(input.draftId)
  if (ref.legacyImage) {
    const url = await readAgentImage({ draftId: input.draftId, id: ref.id })
    if (!url) throw new Error('File gốc không có trên thiết bị này. Hãy đính kèm lại.')
    return { kind: 'text', name: ref.name + ' (OCR)', text: await recognizeAgentDataImage(url, signal) }
  }
  let file: Record<string, unknown>
  try { file = JSON.parse(await readFile(join(dir, ref.id + '.json'), 'utf8')) } catch { throw new Error('File gốc không có trên thiết bị này. Hãy đính kèm lại.') }
  if (!validAgentDataFiles([file]) || file.id !== ref.id || typeof file.dataBase64 !== 'string'
    || file.dataBase64.length > Math.ceil(AGENT_DATA_MAX_BYTES / 3) * 4
    || Buffer.byteLength(file.dataBase64, 'base64') !== file.bytes) throw invalid()
  signal.throwIfAborted()
  if (file.kind === 'image') return { kind: 'text', name: String(file.name) + ' (OCR)',
    text: await recognizeAgentDataImage(`data:${file.mimeType};base64,${file.dataBase64}`, signal) }
  // Existing importer decodes TXT/CSV/Excel and keeps phone/UID precision and column mapping.
  return { kind: 'file', name: String(file.name), mimeType: String(file.mimeType), dataBase64: file.dataBase64 }
}
