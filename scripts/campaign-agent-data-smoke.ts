import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { storeAgentData, readAgentData, recognizeAgentDataImage } from '../src/main/services/campaignAgentData'
import { runAgentOcrWorker } from '../src/main/services/campaignAgentOcr'
app.setPath('userData', process.env.AKA_AGENT_DATA_SMOKE_DIR!)
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const g = globalThis as any; g.agentDataUser = { staffId: 7, organizationId: 9 }
  const draftId = randomUUID(), text = 'Fullname\tMobile\nNguyễn An\t0901234567\nBình\t0987654321'
  const refs = await storeAgentData({ draftId, files: [{ name: 'Khách.txt', mimeType: 'text/plain', dataBase64: Buffer.from(text).toString('base64') }] })
  assert(!JSON.stringify(refs).includes('0901234567'))
  const source = await readAgentData({ draftId, file: refs[0] }, new AbortController().signal)
  assert(source.kind === 'file'); assert.equal(Buffer.from(source.dataBase64, 'base64').toString(), text)
  assert.equal((await stat(join(app.getPath('userData'), 'campaign-agent-data', '9', '7', draftId, refs[0].id + '.json'))).mode & 0o777, 0o600)
  g.agentDataUser = { staffId: 8, organizationId: 9 }
  await assert.rejects(() => readAgentData({ draftId, file: refs[0] }, new AbortController().signal))
  g.agentDataUser = { staffId: 7, organizationId: 9 }
  await assert.rejects(() => readAgentData({ draftId: '../private', file: refs[0] }, new AbortController().signal))
  await assert.rejects(() => storeAgentData({ draftId, files: [{ name: 'bad.png', mimeType: 'image/png', dataBase64: Buffer.from('not image').toString('base64') }] }))
  await assert.rejects(() => storeAgentData({ draftId, files: [{ name: 'bad.exe', mimeType: 'application/octet-stream', dataBase64: 'AAAA' }] }))
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await window.loadURL('data:text/html,<html></html>')
  const image = await window.webContents.executeJavaScript(`(() => { const c=document.createElement('canvas');c.width=800;c.height=220;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,800,220);x.fillStyle='black';x.font='42px Arial';x.fillText('0901234567',30,80);x.fillText('0987654321',30,160);return c.toDataURL('image/png') })()`)
  window.destroy()
  const recognized = await recognizeAgentDataImage(image, AbortSignal.timeout(60000))
  assert(recognized.includes('0901234567') && recognized.includes('0987654321'), recognized)
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('OCR cleanup hung')), 8000) })]) }
    finally { clearTimeout(timer!) }
  }
  // Real dependency failures used to leave createWorker pending forever.
  const modelDir = join(app.getPath('userData'), 'campaign-agent-ocr-models')
  await unlink(join(modelDir, 'eng.traineddata.gz'))
  await assert.rejects(() => bounded(recognizeAgentDataImage(image, new AbortController().signal)), /Không thể đọc ảnh trên máy/)
  assert((await bounded(recognizeAgentDataImage(image, new AbortController().signal))).includes('0901234567'), 'retry repairs missing model and releases OCR slot')
  for (const code of ['vie', 'eng']) await writeFile(join(modelDir, `${code}.traineddata.gz`), 'invalid traineddata')
  await assert.rejects(() => bounded(recognizeAgentDataImage(image, new AbortController().signal)), /Không thể đọc ảnh trên máy/)
  assert((await bounded(recognizeAgentDataImage(image, new AbortController().signal))).includes('0987654321'), 'retry repairs corrupt models')
  // Hang/reject/exit in startup stages must all terminate the owned native thread.
  for (const [stage, fault] of [['load', 'hang'], ['loadLanguage', 'hang'], ['initialize', 'hang'], ['recognize', 'hang'],
    ['loadLanguage', 'reject'], ['initialize', 'reject'], ['load', 'error'], ['initialize', 'exit']]) {
    const worker = new Worker(`const {parentPort}=require('node:worker_threads');parentPort.on('message',p=>{
      if(p.action===${JSON.stringify(stage)}) {
        const fault=${JSON.stringify(fault)};
        if(fault==='hang'){parentPort.postMessage({entered:true});return}
        if(fault==='error')throw Error('/private/path');if(fault==='exit')process.exit(1);
        parentPort.postMessage({...p,status:'reject',data:'/private/path'});return
      }
      parentPort.postMessage({...p,status:'resolve',data:{}})
    })`, { eval: true, stdout: true, stderr: true })
    const controller = new AbortController()
    worker.on('message', message => { if (message.entered) controller.abort() })
    await assert.rejects(() => bounded(runAgentOcrWorker(worker, Buffer.from('fixture'), modelDir, controller.signal)), error => {
      assert(!String(error).includes('/private/path'));assert(!String(error).includes('cleanup hung'));return true
    })
    assert.equal(worker.threadId, -1, `${stage}/${fault}: worker must exit before releasing ownership`)
  }
  const controller = new AbortController(), cancelled = recognizeAgentDataImage(image, controller.signal)
  await assert.rejects(() => recognizeAgentDataImage(image, new AbortController().signal), /Đang dừng/)
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(() => cancelled)
  assert((await bounded(recognizeAgentDataImage(image, new AbortController().signal))).includes('0901234567'))
  console.log('PASS local data: private refs, source preservation, staff/draft boundaries, real OCR, missing/corrupt model retry, startup reject/error/exit/hang, native termination before unlock, cancellation cleanup')
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
