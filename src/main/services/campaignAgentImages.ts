import { app } from 'electron'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireCurrentUser } from '../data/currentUser'
import { validateCampaignSupportUploadImages } from './campaignSupportImageValidation'
import { agentUuid, isAgentRecord, type AgentImage } from '../../shared/campaignAgent'
import { CAMPAIGN_SUPPORT_TOTAL_IMAGE_BYTES, CAMPAIGN_SUPPORT_MAX_IMAGES } from '../../shared/campaignSupport'

function directory(draftId: unknown): string {
  if (!agentUuid(draftId)) throw new Error('Bản nháp không hợp lệ.')
  const user = requireCurrentUser()
  return join(app.getPath('userData'), 'campaign-agent-images', String(user.organizationId), String(user.staffId), draftId)
}
export async function storeAgentImages(input: unknown): Promise<AgentImage[]> {
  if (!isAgentRecord(input)) throw new Error('Ảnh không hợp lệ.')
  const dir = directory(input.draftId), uploads = validateCampaignSupportUploadImages(input.images)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const stored: AgentImage[] = []
  try {
    for (const image of uploads) {
      const bytes = Buffer.from(image.dataBase64, 'base64'), id = randomUUID()
      const ref: AgentImage = { id, name: image.name, mimeType: image.mimeType, bytes: bytes.length }
      await writeFile(join(dir, id + '.json'), JSON.stringify({ ...ref, dataBase64: image.dataBase64 }), { mode: 0o600, flag: 'wx' })
      stored.push(ref)
    }
    return stored
  } catch (error) {
    await Promise.allSettled(stored.map(image => unlink(join(dir, image.id + '.json'))))
    throw error
  }
}
async function read(draftId: string, id: string) {
  const dir = directory(draftId)
  if (!agentUuid(id)) throw new Error('Ảnh không hợp lệ.')
  const data = JSON.parse(await readFile(join(dir, id + '.json'), 'utf8'))
  const [image] = validateCampaignSupportUploadImages([data])
  return image
}
export async function readAgentImage(input: unknown): Promise<string | null> {
  if (!isAgentRecord(input) || !agentUuid(input.draftId) || !agentUuid(input.id)) throw new Error('Ảnh không hợp lệ.')
  try { const image = await read(input.draftId, input.id); return `data:${image.mimeType};base64,${image.dataBase64}` }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export async function removeAgentImage(input: unknown): Promise<void> {
  if (!isAgentRecord(input) || !agentUuid(input.id)) throw new Error('Ảnh không hợp lệ.')
  try { await unlink(join(directory(input.draftId), input.id + '.json')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
export async function agentImageUrls(draftId: string, refs: AgentImage[]): Promise<string[]> {
  if (refs.length > CAMPAIGN_SUPPORT_MAX_IMAGES) throw new Error('Chỉ đính kèm tối đa 5 ảnh.')
  const result: string[] = []; let total = 0
  for (const ref of refs) {
    const image = await read(draftId, ref.id)
    total += Buffer.byteLength(image.dataBase64, 'base64')
    if (total > CAMPAIGN_SUPPORT_TOTAL_IMAGE_BYTES) throw new Error('Tổng ảnh vượt quá 15 MB.')
    result.push(`data:${image.mimeType};base64,${image.dataBase64}`)
  }
  return result
}
