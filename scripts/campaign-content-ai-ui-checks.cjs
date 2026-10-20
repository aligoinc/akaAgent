const assert = require('node:assert/strict')
module.exports = async page => {
  const trigger = page.getByRole('button', { name: 'Viết nội dung bằng AI', exact: true })
  const panel = page.getByRole('dialog', { name: 'Viết nội dung bằng AI', exact: true })
  const input = panel.getByLabel('Mô tả nội dung muốn viết hoặc sửa')
  const request = async () => {
    await trigger.click(); await input.fill('Viết ngắn và thêm biến thể'); await input.press('Enter')
    await page.waitForFunction(() => window.scheduleSmoke.state.pending.length > 0)
    return page.evaluate(() => window.scheduleSmoke.state.requests.at(-1))
  }
  const resolve = patch => page.evaluate(patch => window.scheduleSmoke.resolve({ ok: true, patch }), patch)
  const first = await request()
  assert.deepEqual(first.items, [{ content: 'Nội dung kiểm thử', emailSubject: null }])
  assert.equal(first.context.mode, 'basic')
  assert.equal(await page.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Điền lịch bằng AI', exact: true }).isDisabled(), true)
  await resolve({ edits: [{ index: 0, content: 'Chào {{name}}', emailSubject: null }], additions: [{ sourceIndex: 0, content: 'Xin chào {{name}}', emailSubject: null }] })
  await panel.waitFor({ state: 'detached' })
  assert.deepEqual((await request()).items, [{ content: 'Chào {{name}}', emailSubject: null }, { content: 'Xin chào {{name}}', emailSubject: null }])
  await panel.getByRole('button', { name: 'Hủy yêu cầu' }).click()
  await resolve({ edits: [{ index: 0, content: 'STALE', emailSubject: null }], additions: [] })
  await panel.getByRole('button', { name: 'Đóng nhập nội dung AI' }).click()
  assert.equal((await request()).items[0].content, 'Chào {{name}}')
  await page.evaluate(() => window.scheduleSmoke.expire())
  await panel.getByRole('alert').waitFor()
  await resolve({ edits: [{ index: 0, content: 'LATE', emailSubject: null }], additions: [] })
  await panel.getByRole('button', { name: 'Đóng nhập nội dung AI' }).click()
  const source = { name: 'Advanced fixture', actionId: 'facebook_timeline_post', accountId: 11, status: 'tạm dừng', content: '',
    schedule: '2026-10-20T02:00:00Z', scheduleType: 'daily', extraSettings: { advancedContentEnabled: true, advancedContentSource: 'manual', advancedContentItems: [
      { id: 'source-a', content: 'A', mediaOption: 'all', mediaItems: [{ id: 44, url: 'https://example.test/image.png', type: 'image' }], randomMediaCount: 3 },
      { id: 'source-b', content: 'B', mediaOption: 'none', mediaItems: [], randomMediaCount: 3 }
    ] } }
  await page.evaluate(campaign => window.scheduleSmoke.openCampaign(campaign), source)
  assert.equal((await request()).context.mode, 'advanced')
  await resolve({ edits: [{ index: 1, content: 'B mới', emailSubject: null }], additions: [{ sourceIndex: 0, content: 'A mới', emailSubject: null }] })
  await panel.waitFor({ state: 'detached' })
  assert.deepEqual((await request()).items.map(item => item.content), ['A', 'B mới', 'A mới'])
  await resolve({ edits: [], additions: [] }); await panel.waitFor({ state: 'detached' })
  // Draft is an explicit save by the tester; it exposes the real serialized form including media.
  await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
  await page.waitForFunction(() => window.scheduleSmoke.state.lastSavedDraft)
  const saved = await page.evaluate(() => window.scheduleSmoke.state.lastSavedDraft.payload.values.formData)
  assert.equal(saved.advancedContentItems[1].content, 'B mới')
  assert.deepEqual(saved.advancedContentItems[0].mediaItems, source.extraSettings.advancedContentItems[0].mediaItems)
  assert.deepEqual(saved.advancedContentItems[2].mediaItems, source.extraSettings.advancedContentItems[0].mediaItems)
  assert.notEqual(saved.advancedContentItems[2].id, 'source-a')
  // Legacy email items inherit the common subject until explicitly overridden, including an empty override.
  const commonSubject = 'Thông báo gia hạn hợp đồng tháng 10'
  for (const subject of [undefined, null, 'Tiêu đề riêng', '']) {
    const email = { ...source, actionId: 'email_send', extraSettings: { ...source.extraSettings, emailSubject: commonSubject,
      advancedContentItems: [{ ...source.extraSettings.advancedContentItems[0], emailSubject: subject }] } }
    await page.evaluate(campaign => window.scheduleSmoke.openCampaign(campaign), email)
    await page.getByRole('button', { name: 'Thêm nội dung', exact: true }).click()
    const displayed = await page.getByPlaceholder('Nhập tiêu đề cho nội dung email này...').inputValue()
    assert.equal(displayed, subject ?? commonSubject)
    await page.getByRole('button', { name: 'Đóng modal nội dung nâng cao', exact: true }).click()
    const sent = await request()
    assert.equal(sent.items[0].emailSubject, displayed)
    await resolve({ edits: [{ index: 0, content: null, emailSubject: 'Gia hạn hợp đồng' }], additions: [] })
    await panel.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Thêm nội dung', exact: true }).click()
    assert.equal(await page.getByPlaceholder('Nhập tiêu đề cho nội dung email này...').inputValue(), 'Gia hạn hợp đồng')
    await page.getByRole('button', { name: 'Đóng modal nội dung nâng cao', exact: true }).click()
    assert.equal((await request()).items[0].content, source.extraSettings.advancedContentItems[0].content)
    await resolve({ edits: [], additions: [] })
    await panel.waitFor({ state: 'detached' })
  }
  const writes = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => ['createCampaign', 'updateCampaign'].includes(call.method)))
  assert.deepEqual(writes, [])
  console.log('PASS Electron content AI: basic/advanced text, legacy/explicit email subjects, variants, media preservation in saved draft, lock, cancellation, timeout, no automatic campaign writes')
}
