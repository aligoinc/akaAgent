import { nativeImage } from 'electron'
import type { CampaignSupportImage } from '../../shared/campaignSupport'
import { validateCampaignSupportImages } from './campaignSupportService'

export function validateCampaignSupportUploadImages(value: unknown): CampaignSupportImage[] {
  const images = validateCampaignSupportImages(value)
  for (const image of images) {
    // Electron 33 nativeImage decodes PNG/JPEG only. WebP keeps the container/animation
    // and size checks above; the API validates its image contents before processing.
    if (image.mimeType !== 'image/webp'
      && nativeImage.createFromBuffer(Buffer.from(image.dataBase64, 'base64')).isEmpty()) {
      throw new Error('Không đọc được ảnh đã chọn.')
    }
  }
  return images
}
