import assert from 'node:assert/strict'
import { app, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { storeAgentImages, readAgentImage, removeAgentImage, agentImageUrls } from '../src/main/services/campaignAgentImages'
import { validateCampaignSupportUploadImages } from '../src/main/services/campaignSupportImageValidation'
import { png, webp } from './campaign-support-image-fixtures'
app.setPath('userData',process.env.AKA_AGENT_IMAGE_SMOKE_DIR!)
app.whenReady().then(async()=>{
  const g=globalThis as any; g.agentImageUser={staffId:7,organizationId:9}
  const draftId=randomUUID(),jpeg={name:'a.jpg',mimeType:'image/jpeg' as const,dataBase64:nativeImage.createFromBuffer(Buffer.from(png.dataBase64,'base64')).toJPEG(80).toString('base64')}
  const refs=await storeAgentImages({draftId,images:[png,jpeg,webp]})
  assert.equal(refs.length,3);assert(refs.every(ref=>!('dataBase64'in ref)))
  assert.equal(await readAgentImage({draftId,id:refs[0].id}),`data:image/png;base64,${png.dataBase64}`)
  assert.equal((await agentImageUrls(draftId,refs)).length,3)
  const dir=join(app.getPath('userData'),'campaign-agent-images','9','7',draftId)
  assert.equal((await readdir(dir)).length,3);assert.equal((await stat(join(dir,refs[0].id+'.json'))).mode&0o777,0o600)
  g.agentImageUser={staffId:8,organizationId:9};assert.equal(await readAgentImage({draftId,id:refs[0].id}),null)
  g.agentImageUser={staffId:7,organizationId:10};assert.equal(await readAgentImage({draftId,id:refs[0].id}),null)
  g.agentImageUser={staffId:7,organizationId:9};assert.equal(await readAgentImage({draftId:randomUUID(),id:refs[0].id}),null)
  await assert.rejects(()=>readAgentImage({draftId,id:'../../private'}));await assert.rejects(()=>storeAgentImages({draftId:'../private',images:[png]}))
  await assert.rejects(()=>storeAgentImages({draftId,images:Array(6).fill(png)}))
  await assert.rejects(()=>storeAgentImages({draftId,images:[{...png,mimeType:'image/gif'}]}))
  await assert.rejects(()=>storeAgentImages({draftId,images:[{...png,dataBase64:Buffer.alloc(5*1024*1024+1).toString('base64')}]}))
  const largeJpeg=Buffer.alloc(4*1024*1024);largeJpeg.set([255,216,255,0]);
  assert.throws(()=>validateCampaignSupportUploadImages(Array(4).fill({...jpeg,dataBase64:largeJpeg.toString('base64')})),/tổng 15 MB/)
  await assert.rejects(()=>storeAgentImages({draftId,images:[{...jpeg,dataBase64:Buffer.from([255,216,255,0]).toString('base64')}]}))
  await removeAgentImage({draftId,id:refs[0].id});assert.equal(await readAgentImage({draftId,id:refs[0].id}),null)
  console.log(`PASS Electron ${process.versions.electron}: Agent PNG/JPEG/WebP bytes, private local refs, org/staff/draft isolation, missing files, count/size/MIME/corrupt/traversal rejection and remove`)
  app.quit()
}).catch(error=>{console.error(error);app.exit(1)})
