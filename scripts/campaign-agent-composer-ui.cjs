const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), xlsx = require('xlsx')

module.exports = async ({page, app, input, send, reply, idle, artifacts}) => {
  const chat = page.getByRole('complementary', {name:'Chat thêm chiến dịch bằng Agent'})
  const selected = page.locator('.agent-chat-composer .agent-data-files > div')
  const choose = page.getByRole('button', {name:'Chọn file', exact:true})
  const attachments = page.locator('.agent-input-actions input[type=file]')
  const sizes = []
  await page.evaluate(() => window.agentSmoke.open('zalo_message_phone', 11)); await input.waitFor(); await idle()
  assert.equal(await page.getByRole('button', {name:'Dán data', exact:true}).count(), 0)
  assert.equal(await chat.getByRole('textbox').count(), 1)
  assert((await attachments.getAttribute('accept')).includes('.xlsx'))
  for (const width of [1500, 900]) for (const light of [false, true]) {
    await app.evaluate(({BrowserWindow}, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
    await page.evaluate(light => document.body.classList.toggle('theme-light', light), light)
    const bounds = await input.evaluate(element => {
      const box = element.closest('.agent-input-box'), panel = element.closest('.campaign-agent-chat')
      return {height:element.getBoundingClientRect().height, boxHeight:box.getBoundingClientRect().height,
        overflow:box.scrollWidth > box.clientWidth + 1, bottom:box.getBoundingClientRect().bottom, panelBottom:panel.getBoundingClientRect().bottom}
    })
    assert(bounds.height <= 42 && bounds.boxHeight <= 105, 'empty composer stays compact')
    assert(!bounds.overflow && bounds.bottom <= bounds.panelBottom)
    sizes.push({width, light, ...bounds})
    await page.screenshot({path:path.join(artifacts, `composer-${width}-${light?'light':'dark'}.png`)})
  }
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000))
  await page.evaluate(() => document.body.classList.remove('theme-light'))
  await input.fill(Array.from({length:12}, () => 'Một dòng mô tả').join('\n'))
  assert.equal(await input.evaluate(e => e.getBoundingClientRect().height), 120)
  await input.fill(''); assert.equal(await input.evaluate(e => e.getBoundingClientRect().height), 40)

  // Use the visible chooser, not just setting the hidden input directly.
  const chooser = page.waitForEvent('filechooser')
  await choose.click()
  await (await chooser).setFiles({name:'Chọn.txt', mimeType:'text/plain', buffer:Buffer.from('0901234567')})
  await selected.waitFor(); await idle()
  assert.equal(await selected.count(), 1)
  assert.equal(await attachments.inputValue(), '', 'same file can be chosen again')
  await page.getByRole('button', {name:'Gỡ dữ liệu Chọn.txt', exact:true}).click()
  await input.fill('An Nguyễn\nBình Trần')
  await page.getByRole('button', {name:'Dùng nội dung ô nhập làm dữ liệu', exact:true}).click(); await idle()
  assert.equal(await input.inputValue(), '')
  assert.equal(await chat.getByRole('textbox').count(), 1)
  assert.equal(await selected.count(), 1)
  await page.getByRole('button', {name:/^Gỡ dữ liệu/}).click()

  const book = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['Tên','SĐT'],['An','0901234567'],['Bình','0987654321']]), 'Khách')
  const excel = {name:'Khách kéo thả.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64:xlsx.write(book, {type:'buffer',bookType:'xlsx'}).toString('base64')}
  const drag = async (type, files=[excel], target='.agent-chat-messages') => page.locator(target).evaluate((element, {type,files}) => {
    const dataTransfer = new DataTransfer()
    for (const f of files) dataTransfer.items.add(new File([Uint8Array.from(atob(f.base64), c=>c.charCodeAt(0))], f.name, {type:f.mimeType}))
    const event = new DragEvent(type, {dataTransfer, bubbles:true, cancelable:true})
    element.dispatchEvent(event)
    return {prevented:event.defaultPrevented, effect:dataTransfer.dropEffect}
  }, {type,files})
  assert((await drag('dragenter')).prevented)
  await page.locator('.agent-drop-hint').waitFor()
  await drag('dragenter', [excel], '.agent-chat-welcome')
  await drag('dragleave', [excel], '.agent-chat-welcome')
  assert(await page.locator('.agent-drop-hint').isVisible(), 'moving over a child must not clear the drop cue')
  assert(await choose.isEnabled())
  assert((await drag('dragover')).prevented, 'file dragover must accept a drop instead of navigating')
  assert((await drag('drop')).prevented)
  await selected.waitFor(); await idle()
  assert.equal(await selected.count(), 1); assert.equal(await page.locator('.agent-drop-hint').count(), 0)
  assert((await selected.innerText()).includes(excel.name))
  const before = await page.evaluate(() => Object.keys(window.agentSmoke.state.dataFiles).length)
  const sixFiles = Array.from({length:6}, (_,i)=>({name:`Nguồn ${i}.txt`,mimeType:'text/plain',base64:Buffer.from('0901111111').toString('base64')}))
  await drag('drop', sixFiles); await page.locator('.agent-chat-error').waitFor(); await idle()
  assert.equal(await selected.count(), 1)
  assert.equal(await page.evaluate(() => Object.keys(window.agentSmoke.state.dataFiles).length), before, 'file limits remain atomic')
  await send('Nhập file vừa kéo vào danh sách')
  const request = await page.evaluate(() => window.agentSmoke.state.requests.at(-1))
  assert.equal(request.dataFiles.length, 1); assert.equal(request.dataFiles[0].kind, 'excel')
  assert(!JSON.stringify(request).includes('0901234567') && !JSON.stringify(request).includes('dataBase64'))
  assert(await choose.isDisabled()); assert(await attachments.isDisabled())
  assert((await drag('drop')).prevented)
  assert.equal(await page.evaluate(() => Object.keys(window.agentSmoke.state.dataFiles).length), before, 'busy drop does not enqueue a file')
  await reply([{section:'data',patch:{fields:{},rows:[],tags:[],dataMode:null,importMode:'append'}}]); await idle()
  const modal = page.locator('.campaign-import-modal')
  await modal.waitFor()
  await modal.getByRole('button', {name:'Kiểm tra dữ liệu',exact:true}).click()
  await modal.getByRole('button', {name:'Chèn xuống chi tiết',exact:true}).click(); await modal.waitFor({state:'hidden'}); await idle()
  await page.locator('[data-agent-field="name"]').fill('Kéo Excel từ chat')
  await page.getByRole('button', {name:'Lưu nháp',exact:true}).click(); await page.getByText('Đã đóng',{exact:true}).waitFor()
  const saved = await page.evaluate(() => window.agentSmoke.state.saved)
  assert.deepEqual(saved.payload.values.details.map(r=>r.phone), ['0901234567','0987654321'])
  assert(!JSON.stringify(saved.payload.values.agentChat).includes('0901234567'))
  await page.evaluate(() => window.agentSmoke.open('zalo_message_phone', 11)); await input.waitFor(); await idle()
  assert.deepEqual(await page.evaluate(() => window.agentSmoke.state.errors), [])
  fs.writeFileSync(path.join(artifacts,'composer-verification.json'),JSON.stringify({sizes,checks:[
    'compact/autogrowing single input at wide/narrow sizes and both themes',
    'visible chooser opens file picker and attaches TXT', 'explicit data conversion uses same composer',
    'nested drag/drop Excel onto chat, cue reset and native navigation prevention',
    'file limit rejection preserves existing attachment', 'busy drop is ignored',
    'Excel request contains only metadata; Upload confirmation preserves leading zeros and draft chat omits rows'
  ],errors:[]},null,2)+'\n')
  console.log('PASS Agent composer: compact shared input, file chooser, Excel drag/drop, busy/limit guards, metadata-only AI and Upload/draft preservation')
}
