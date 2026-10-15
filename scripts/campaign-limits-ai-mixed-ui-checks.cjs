const assert = require('node:assert/strict')
module.exports = async function checkMixedWindows(page) {
  await page.evaluate(() => window.scheduleSmoke.openMixedWindows())
  const trigger = page.getByRole('button', { name: 'Điền giới hạn bằng AI', exact: true })
  const panel = page.getByRole('dialog', { name: 'Điền giới hạn bằng AI', exact: true })
  const section = page.locator('.stepper-section').filter({ has: page.locator('.stepper-section-title').filter({ hasText: /^Giới hạn hành động$/ }) })
  const generate = async description => {
    await trigger.click(); await panel.getByLabel('Mô tả giới hạn muốn đặt').fill(description)
    await panel.getByLabel('Mô tả giới hạn muốn đặt').press('Enter')
    await page.waitForFunction(() => window.scheduleSmoke.state.pending.length === 1)
    return page.evaluate(() => window.scheduleSmoke.state.requests.at(-1))
  }
  const resolve = async patch => {
    await page.evaluate(patch => window.scheduleSmoke.resolve({ ok: true, patch }), patch)
    await panel.waitFor({ state: 'detached' })
  }
  await trigger.scrollIntoViewIfNeeded()
  if (!await section.locator('.stepper-section-body').count()) await section.locator('.stepper-section-header').click()
  const first = await generate('Mỗi khung hiện tại 12 lượt, giữ nguyên số phút')
  const actionCode = first.limits.actions[0].actionCode
  assert.equal(first.limits.actions[0].rateLimitMinutes, null)
  assert.deepEqual(first.limits.actions[0].rateLimitMinuteValues, [30, 60])
  await resolve({ actions: [{ actionCode, rateLimitCount: 12 }] })
  const second = await generate('Cùng dùng khung 45 phút')
  assert.equal(second.limits.actions[0].rateLimitCount, 12)
  assert.deepEqual(second.limits.actions[0].rateLimitMinuteValues, [30, 60])
  await resolve({ actions: [{ actionCode, rateLimitMinutes: 45 }] })
  const third = await generate('Giữ nguyên')
  assert.equal(third.limits.actions[0].rateLimitMinutes, 45)
  assert.equal(third.limits.actions[0].rateLimitMinuteValues, undefined)
  await resolve({ actions: [] })
  assert.equal(await page.evaluate(() => window.scheduleSmoke.state.calls.some(call => /^(createCampaign|updateCampaign|saveCampaignDraft)$/.test(call.method))), false)
  console.log('PASS Desktop real form: mixed 30/60 snapshot, count-only preserves inheritance, explicit common 45, no auto-save')
}
