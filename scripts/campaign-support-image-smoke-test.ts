import assert from 'node:assert/strict'
import { app, nativeImage } from 'electron'
import { validateCampaignSupportUploadImages } from '../src/main/services/campaignSupportImageValidation'
import { png, webp } from './campaign-support-image-fixtures'

app.setPath('userData', process.env.AKA_AGENT_SUPPORT_SMOKE_DIRECTORY!)
app.whenReady().then(() => {
  const decodedPng = nativeImage.createFromBuffer(Buffer.from(png.dataBase64, 'base64'))
  assert.equal(decodedPng.isEmpty(), false, 'PNG fixture must decode in Electron')
  const jpeg = { name: 'anh.jpg', mimeType: 'image/jpeg' as const, dataBase64: decodedPng.toJPEG(80).toString('base64') }
  assert.deepEqual(validateCampaignSupportUploadImages([png, jpeg, webp]), [png, jpeg, webp],
    'the actual upload validator must accept static WebP and preserve its exact bytes')
  assert.throws(() => validateCampaignSupportUploadImages([{ ...webp, mimeType: 'image/png' }]))
  assert.throws(() => validateCampaignSupportUploadImages([{ ...jpeg, dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0]).toString('base64') }]), /Không đọc được/)
  const animated = Buffer.from(webp.dataBase64, 'base64')
  animated.write('ANIM', 12, 'ascii')
  assert.throws(() => validateCampaignSupportUploadImages([{ ...webp, dataBase64: animated.toString('base64') }]), /ảnh động/)
  assert.throws(() => validateCampaignSupportUploadImages(Array(6).fill(webp)))
  console.log(`PASS Electron ${process.versions.electron}: upload PNG/JPEG/WebP unchanged; reject invalid MIME, undecodable JPEG and animated WebP`)
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
