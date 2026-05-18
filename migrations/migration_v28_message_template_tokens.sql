-- Add message template tokens for facebook_message_friend campaigns.
-- #{FULL_NAME} is resolved on the Messenger page; date tokens are rendered at send time.

UPDATE public.auto_blocks
SET
  code = $block$
try {
  let text = String(input.text || vars.campaignContent || '')
  const imgs = Array.isArray(input.images) && input.images.length > 0
    ? input.images
    : (Array.isArray(vars.images) ? vars.images : [])

  const formatTemplateDate = (dayKey, formatKey) => {
    const d = new Date()
    const key = String(dayKey || 'TODAY').toUpperCase()
    if (key === 'TOMORROW') d.setDate(d.getDate() + 1)
    if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)

    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = String(d.getFullYear())
    const format = String(formatKey || 'DD/MM/YYYY').toUpperCase()
    return format === 'MM/DD/YYYY'
      ? mm + '/' + dd + '/' + yyyy
      : dd + '/' + mm + '/' + yyyy
  }

  const renderMessageTemplate = async (raw) => {
    let rendered = String(raw || '')

    if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
      let fullName = ''
      const nameXpath = "//*[contains(@class,'xxymvpz x1dyh7pn')]"
      try {
        const found = await page.waitForSelector(nameXpath, { timeout: 3000 }).catch(() => false)
        if (found) fullName = await page.getText(nameXpath).catch(() => '')
      } catch (e) {
        fullName = ''
      }
      rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, String(fullName || '').trim())
    }

    rendered = rendered.replace(
      /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
      (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
    )

    return rendered
  }

  // Đóng dialog "Khôi phục đoạn chat" nếu hiện
  try {
    const closeBtn = '[aria-label="Đóng"], [aria-label="Close"]'
    const found = await page.waitForSelector(closeBtn, { timeout: 3000 })
    if (found) {
      await page.click(closeBtn)
      await helpers.sleep(2000, signal)
      const confirm = '(//*[@role="button" and @aria-label="Không khôi phục tin nhắn" and @tabindex="0"])[position()=2]'
      const c = await page.waitForSelector(confirm, { timeout: 3000 }).catch(() => false)
      if (c) {
        await page.click(confirm)
        await helpers.sleep(2000, signal)
      }
    }
  } catch (e) { /* không có dialog → bỏ qua */ }

  // Đóng dialog E2EE "Tiếp tục" nếu hiện
  try {
    const cont = '//*[@role="button" and .="Tiếp tục"]'
    const found = await page.waitForSelector(cont, { timeout: 2000 })
    if (found) {
      await page.click(cont)
      await helpers.sleep(2000, signal)
    }
  } catch (e) { /* không có → bỏ qua */ }

  const box = await helpers.element('fb_messenger_textbox')
  await page.waitForSelector(box, { timeout: 15000 })
  await helpers.sleep(1000, signal)
  await page.click(box)
  await helpers.sleep(500, signal)

  text = (await renderMessageTemplate(text)).trim()

  if (text) {
    await page.fill(box, text)
    await helpers.sleep(1000, signal)
  }
  if (imgs.length > 0) {
    await page.dropFile(box, imgs)
    await helpers.sleep(Math.max(3000, imgs.length * 1500), signal)
  }
  if (text || imgs.length > 0) {
    await page.press('Enter')
    await helpers.sleep(2000, signal)
  }
  return { ok: true }
} catch (e) {
  return { ok: false, error: e.message }
}
$block$,
  updated_at = now()
WHERE name = 'fb_send_message';
