-- Improve comment seeding keyword matching.
-- Built-in block code is updated by UNIQUE name; DB remains the source of truth.

UPDATE auto_blocks
SET code = $block$
const N = Math.max(1, Number(input.limit || vars.postsPerTarget || 3))
const kwRaw = String(input.keywords || vars.keywordFilter || '')
function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const keywords = kwRaw.split(',').map(normalizeForMatch).filter(Boolean)
const variants = Array.isArray(vars.commentVariants) ? vars.commentVariants : []

// Scroll enough for Facebook to lazy-load posts before reading the visible feed.
const scrollTimes = keywords.length > 0 ? Math.max(5, N * 2 + 2) : Math.max(3, N + 2)
for (let i = 0; i < scrollTimes; i++) {
  if (signal && signal.aborted) break
  try { await page.scroll({ direction: 'down', amount: 1500 }) } catch (e) {}
  await helpers.sleep(2000, signal)
}

try {
  await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" });')
} catch (e) {}
await helpers.sleep(2500, signal)

const evalCode =
  'function isVisible(el) {' +
  '  if (!el || !el.getBoundingClientRect) return false;' +
  '  var r = el.getBoundingClientRect();' +
  '  var s = window.getComputedStyle ? window.getComputedStyle(el) : null;' +
  '  return r.width > 0 && r.height > 0 && (!s || (s.visibility !== "hidden" && s.display !== "none"));' +
  '}' +
  'function push(parts, value) {' +
  '  var text = String(value || "").replace(/\\s+/g, " ").trim();' +
  '  if (text && parts.indexOf(text) === -1) parts.push(text);' +
  '}' +
  'function collectArticleText(article) {' +
  '  var parts = [];' +
  '  push(parts, article.innerText || article.textContent || "");' +
  '  var nodes = article.querySelectorAll("[dir=auto], span, a, div[aria-label], span[aria-label], img[alt]");' +
  '  for (var j = 0; j < nodes.length; j++) {' +
  '    var n = nodes[j];' +
  '    if (!isVisible(n)) continue;' +
  '    push(parts, n.innerText || n.textContent || n.getAttribute("aria-label") || n.getAttribute("alt") || "");' +
  '  }' +
  '  return parts.join(" ");' +
  '}' +
  'var arts = document.querySelectorAll("[role=article]");' +
  'var texts = [];' +
  'for (var i = 0; i < arts.length; i++) { texts.push(collectArticleText(arts[i])); }' +
  'return { texts: texts, count: arts.length };'

let articleData = { texts: [], count: 0 }
try { articleData = await page.evaluate(evalCode) } catch (e) {
  helpers.log('⚠️ Lỗi đọc nội dung bài viết: ' + (e && e.message || e))
}

helpers.log('🔍 Tìm thấy ' + articleData.count + ' bài viết trong trang hiện tại')

const result = []
const samples = []
for (let pos = 1; pos <= articleData.texts.length; pos++) {
  if (result.length >= N) break
  const rawText = articleData.texts[pos - 1] || ''
  const normalizedText = normalizeForMatch(rawText)
  if (samples.length < 3 && rawText) samples.push(rawText.replace(/\s+/g, ' ').trim().slice(0, 120))
  if (keywords.length > 0) {
    if (!keywords.some(k => normalizedText.includes(k))) continue
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
    helpers.log('⚠️ Có ' + articleData.count + ' bài viết nhưng không khớp từ khoá: ' + kwRaw)
    if (samples.length > 0) helpers.log('ℹ️ Nội dung đã đọc thử: ' + samples.join(' | '))
  } else {
    helpers.log('⚠️ Chưa chuẩn bị được danh sách bài để comment')
  }
} else {
  helpers.log('📋 Sẽ comment vào ' + result.length + '/' + N + ' bài' + (keywords.length ? ' theo từ khoá: ' + kwRaw : ''))
}

return { commentIterations: result, totalCount: articleData.count, matchedCount: result.length }
$block$,
updated_at = now()
WHERE name = 'fb_prepare_seeding_iterations';
