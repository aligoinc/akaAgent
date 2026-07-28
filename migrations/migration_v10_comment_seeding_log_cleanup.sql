-- Clean up customer-facing logs for the Facebook comment seeding workflow.
-- Keep workflow behavior unchanged; update built-in block code by UNIQUE name.

UPDATE auto_blocks
SET code = $block$
const N = Math.max(1, Number(input.limit || vars.postsPerTarget || 3))
const kwRaw = String(input.keywords || vars.keywordFilter || '')
const keywords = kwRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const variants = Array.isArray(vars.commentVariants) ? vars.commentVariants : []

// Scroll down enough for Facebook to lazy-load posts.
const scrollTimes = keywords.length > 0 ? Math.max(5, N * 2 + 2) : Math.max(3, N + 2)
for (let i = 0; i < scrollTimes; i++) {
  if (signal && signal.aborted) break
  try { await page.scroll({ direction: 'down', amount: 1500 }) } catch (e) {}
  await helpers.sleep(2000, signal)
}

try {
  await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" });')
} catch (e) {}
await helpers.sleep(2000, signal)

const evalCode =
  'var arts = document.querySelectorAll(\'[role="article"]\');' +
  'var texts = [];' +
  'for (var i = 0; i < arts.length; i++) { texts.push(arts[i].innerText || ""); }' +
  'return { texts: texts, count: arts.length };'

let articleData = { texts: [], count: 0 }
try { articleData = await page.evaluate(evalCode) } catch (e) {
  helpers.log('⚠️ Lỗi đọc nội dung bài viết: ' + (e && e.message || e))
}

helpers.log('🔍 Tìm thấy ' + articleData.count + ' bài viết trong trang hiện tại')

const result = []
for (let pos = 1; pos <= articleData.texts.length; pos++) {
  if (result.length >= N) break
  if (keywords.length > 0) {
    const txt = (articleData.texts[pos - 1] || '').toLowerCase()
    if (!keywords.some(k => txt.includes(k))) continue
  }
  result.push({
    position: pos,
    text: variants.length > 0 ? variants[result.length % variants.length] : ''
  })
}

if (result.length === 0) {
  if (articleData.count === 0) {
    helpers.log('⚠️ Không tìm thấy bài viết nào. Tài khoản có thể chưa được duyệt vào nhóm hoặc trang chưa load xong.')
  } else if (keywords.length > 0) {
    helpers.log('⚠️ Có ' + articleData.count + ' bài viết nhưng không có bài phù hợp với từ khoá đã chọn')
  } else {
    helpers.log('⚠️ Chưa chuẩn bị được danh sách bài để comment')
  }
} else {
  helpers.log('📋 Sẽ comment vào ' + result.length + ' bài' + (keywords.length ? ' theo từ khoá đã chọn' : ''))
}

return { commentIterations: result, totalCount: articleData.count, matchedCount: result.length }
$block$,
updated_at = now()
WHERE name = 'fb_prepare_seeding_iterations';

UPDATE auto_blocks
SET code = $block$
if (input.enabled === false) return { liked: false }
const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)

// Scroll bài thứ N vào tầm nhìn (để click không bị occluded)
try {
  const scrollCode = 'var n = document.evaluate(' + JSON.stringify('(//*[@role="article"])[' + pos + ']') + ', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if (n) n.scrollIntoView({block: "center"});'
  await page.evaluate(scrollCode)
  await helpers.sleep(1500, signal)
} catch (e) {}

try {
  const xp = await helpers.elementWith('fb_like_button_at_n', { n: pos })
  const found = await page.waitForSelector(xp, { timeout: 5000 }).catch(() => false)
  if (!found) {
    helpers.log('ℹ️ Không tìm thấy nút Thích tại bài #' + pos + ' (có thể đã thích trước đó)')
    return { liked: false, position: pos }
  }
  await page.click(xp)
  await helpers.sleep(1500, signal)
  helpers.log('👍 Đã thích bài #' + pos)
  return { liked: true, position: pos }
} catch (e) {
  return { liked: false, position: pos, error: String(e && e.message || e) }
}
$block$,
updated_at = now()
WHERE name = 'fb_click_like';

UPDATE auto_blocks
SET code = $block$
const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)
const text = String(input.text || item.text || '')
const postLabel = pos === 1 ? 'bài đầu tiên' : 'bài thứ ' + pos
if (!text) return { commented: false, position: pos, text: '' }

// Facebook comment box uses Lexical. page.type works better than page.fill.
const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })
await page.waitForSelector(boxXpath, { timeout: 8000 })
await page.click(boxXpath)
await helpers.sleep(2000, signal)
await page.type(boxXpath, text, { clearFirst: true })
await helpers.sleep(1000, signal)
await page.press('Enter')
await helpers.sleep(3000, signal)
helpers.log('💬 Đã comment vào ' + postLabel + ': ' + text.substring(0, 50))
return { commented: true, position: pos, text: text }
$block$,
updated_at = now()
WHERE name = 'fb_comment_at_position';
