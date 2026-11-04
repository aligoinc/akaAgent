const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')

module.exports = async ({page, app, input, reply, idle, artifacts}) => {
  const review = page.getByRole('textbox', {name:'Rút gọn mô tả vừa dán',exact:true})
  const attachRaw = page.getByRole('button', {name:'Đính kèm nguyên phần vừa dán',exact:true})
  const selected = page.locator('.agent-chat-composer .agent-data-files > div')
  const waiting = page.getByRole('textbox', {name:'Dữ liệu cần nhập',exact:true})
  const phones = Array.from({length:180}, (_,i) => String(901000000+i).padStart(10,'0'))
  const raw = phones.map(phone => `Nguyễn Văn An - ${phone}`).join('\n')
  assert.equal(raw.length, 4859)
  const clipboard = async text => {
    const prevented = await input.evaluate((element,text) => {
      const data = new DataTransfer(); data.setData('text/plain',text)
      const event = new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})
      element.dispatchEvent(event); return event.defaultPrevented
    }, text)
    assert(prevented); await review.waitFor()
    assert(await attachRaw.isEnabled()); assert(await page.getByRole('button',{name:'Lưu nháp',exact:true}).isDisabled())
  }
  for (const mode of ['success','disk-retry','file-limit-retry','discard']) {
    await page.evaluate(() => window.agentSmoke.open('zalo_message_phone',11)); await input.waitFor(); await idle()
    await page.locator('[data-agent-field="name"]').fill('Danh sách dài')
    const before = 'Chạy lúc 20h. THAY THẾ Giữ lịch hằng ngày.'
    const remaining = before.replace('THAY THẾ','')
    await input.fill(before)
    await input.evaluate(element => {const start=element.value.indexOf('THAY THẾ');element.setSelectionRange(start,start+8)})
    if (mode === 'file-limit-retry') {
      await page.locator('.agent-input-actions input[type=file]').setInputFiles(Array.from({length:5},(_,i)=>({name:`Có sẵn ${i}.txt`,mimeType:'text/plain',buffer:Buffer.from('0901111111')})))
      await idle()
    }
    if (mode === 'disk-retry') await page.evaluate(() => {window.agentSmoke.state.failDataStore=true})
    const filesBefore = await page.evaluate(() => Object.keys(window.agentSmoke.state.dataFiles).length)
    const requestsBefore = await page.evaluate(() => window.agentSmoke.state.requests.length)
    await clipboard(raw)
    assert.equal(await page.evaluate(() => Object.keys(window.agentSmoke.state.dataFiles).length),filesBefore)
    assert(await page.getByRole('button',{name:'Áp dụng phần vừa dán',exact:true}).isDisabled())
    if (mode === 'discard') {
      await page.getByRole('button',{name:'Bỏ phần vừa dán',exact:true}).click(); await idle()
      assert.equal(await input.inputValue(),before); assert.equal(await selected.count(),0)
      continue
    }
    if (mode === 'success') {
      const oldSize=await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getSize())
      await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(900,800))
      await page.evaluate(() => document.body.classList.add('theme-light'))
      await attachRaw.scrollIntoViewIfNeeded()
      const bounds=await attachRaw.evaluate(button => ({bottom:button.getBoundingClientRect().bottom,
        chatBottom:button.closest('.campaign-agent-chat').getBoundingClientRect().bottom,
        overflow:button.closest('.agent-paste-review').scrollWidth > button.closest('.agent-paste-review').clientWidth + 1}))
      assert(!bounds.overflow && bounds.bottom <= bounds.chatBottom)
      await page.screenshot({path:path.join(artifacts,'large-paste-attach-narrow.png')})
      await app.evaluate(({BrowserWindow},size) => BrowserWindow.getAllWindows()[0].setSize(...size),oldSize)
      await page.evaluate(() => document.body.classList.remove('theme-light'))
      // Collapsing the chat must keep the source and its selection boundaries.
      await page.locator('.agent-chat-header button[title="Thu gọn Agent"]').click()
      await page.getByRole('button',{name:'Mở Agent',exact:true}).click(); await attachRaw.waitFor()
    }
    await attachRaw.click()
    if (mode !== 'success') {
      await waiting.waitFor(); await page.locator('.agent-chat-error').waitFor()
      assert.equal(await waiting.inputValue(),raw)
      assert(await page.getByRole('button',{name:'Lưu nháp',exact:true}).isDisabled())
      assert(await page.getByRole('button',{name:'Gửi yêu cầu Agent',exact:true}).isDisabled())
      if (mode === 'disk-retry') await page.evaluate(() => {window.agentSmoke.state.failDataStore=false})
      else await page.getByRole('button',{name:'Gỡ dữ liệu Có sẵn 0.txt',exact:true}).click()
      await page.getByRole('button',{name:'Đính kèm dữ liệu',exact:true}).click()
    }
    await idle(); await input.waitFor()
    assert.equal(await input.inputValue(),remaining)
    assert.equal(await page.evaluate(() => window.agentSmoke.state.requests.length),requestsBefore,'attaching never invokes AI')
    await page.getByRole('button',{name:'Lưu nháp',exact:true}).click(); await page.getByText('Đã đóng',{exact:true}).waitFor()
    const saved=await page.evaluate(() => structuredClone(window.agentSmoke.state.saved))
    const composer=saved.payload.values.agentChat.composer, source=composer.dataFiles.at(-1)
    assert.equal(composer.text,remaining); assert.equal(composer.dataFiles.length,mode==='file-limit-retry'?5:1)
    assert.equal(Buffer.from(await page.evaluate(id => window.agentSmoke.state.dataFiles[id].dataBase64,source.id),'base64').toString('utf8'),raw)
    assert(!JSON.stringify(saved.payload.values.agentChat).includes(phones[0]))
    await page.evaluate(saved => window.agentSmoke.openDraft(saved),saved); await input.waitFor(); await idle()
    assert.equal(await input.inputValue(),remaining)
    for (const ref of composer.dataFiles.slice(0,-1)) await page.getByRole('button',{name:`Gỡ dữ liệu ${ref.name}`,exact:true}).click()
    await input.press('Enter'); await page.waitForFunction(() => window.agentSmoke.state.pending.length===1)
    const request=await page.evaluate(() => window.agentSmoke.state.requests.at(-1))
    assert.equal(request.description,remaining); assert.equal(request.dataFiles.length,1)
    assert(!JSON.stringify(request).includes(phones[0]) && !JSON.stringify(request).includes('Nguyễn Văn An'))
    await reply([{section:'data',patch:{fields:{},rows:[],tags:[],dataMode:null,importMode:'append'}}])
    const modal=page.locator('.campaign-import-modal'); await modal.waitFor()
    await modal.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click()
    await modal.getByRole('button',{name:'Chèn xuống chi tiết',exact:true}).click(); await modal.waitFor({state:'hidden'}); await idle()
    await page.getByRole('button',{name:'Lưu nháp',exact:true}).click(); await page.getByText('Đã đóng',{exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(() => window.agentSmoke.state.saved.payload.values.details.map(row=>row.phone)),phones)
  }
  // Partially recognized rows must not be lost or reordered by attaching split text.
  await page.evaluate(() => window.agentSmoke.open('zalo_message_phone',11)); await input.waitFor(); await idle()
  const mixed='0902222222\r\n\r\n'+raw.replace(/\n/g,'\r\n')+'\r\n0903333333\r\n'
  await clipboard(mixed)
  assert(!(await review.inputValue()).includes('0902222222'),'the normal splitter has already extracted some rows')
  await review.fill('Mô tả đã chỉnh riêng')
  await attachRaw.click(); await idle()
  await page.locator('[data-agent-field="name"]').fill('Giữ nguyên nguồn')
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click(); await page.getByText('Đã đóng',{exact:true}).waitFor()
  const original=await page.evaluate(() => {
    const composer=window.agentSmoke.state.saved.payload.values.agentChat.composer
    return {text:composer.text, source:window.agentSmoke.state.dataFiles[composer.dataFiles[0].id].dataBase64}
  })
  assert.equal(original.text,''); assert.equal(Buffer.from(original.source,'base64').toString('utf8'),mixed)
  await page.evaluate(() => window.agentSmoke.open()); await input.waitFor(); await idle()
  assert.deepEqual(await page.evaluate(() => window.agentSmoke.state.errors),[])
  fs.writeFileSync(path.join(artifacts,'large-paste-verification.json'),JSON.stringify({characters:raw.length,rows:phones.length,
    checks:['180 unrecognized recipients attach intact from oversize review','original clipboard bytes/order retained even with partially recognized data and edited description',
      'surrounding instruction/selection preserved','no AI call on attachment and metadata-only later request','save/reopen then Upload retains all 180 phones',
      'disk/file-count errors keep complete pending data and save lock until retry','discard restores original draft','collapse/reopen and narrow light layout'],errors:[]},null,2)+'\n')
  console.log('PASS Agent large paste: 180 rows, raw source preservation, selected-text boundaries, local-only attachment, draft/reopen/import, disk/quota retry and discard')
}
