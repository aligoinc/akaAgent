-- Facebook only supports one image attachment per comment in the current UI.
-- Keep comment image support, but force the block back to one dropFile call
-- with at most one image path.

UPDATE public.auto_blocks
SET
  description = 'Comment vào bài thứ N, hỗ trợ nội dung và 1 ảnh comment (fallback vars.loopItem khi chạy trong loop)',
  config_schema = '[
    {"name":"position","type":"number","label":"Vị trí (1-based, để rỗng = lấy từ loopItem)"},
    {"name":"text","type":"textarea","label":"Nội dung comment (để rỗng = lấy từ loopItem)"},
    {"name":"images","type":"json","label":"Ảnh comment (array path, chỉ dùng ảnh đầu tiên; để rỗng = lấy từ loopItem/vars)"}
  ]'::jsonb,
  output_schema = '[
    {"name":"commented","type":"boolean","label":"Đã comment chưa"},
    {"name":"position","type":"number","label":"Vị trí đã comment"},
    {"name":"text","type":"string","label":"Nội dung đã comment"},
    {"name":"imageCount","type":"number","label":"Số ảnh đã gửi"}
  ]'::jsonb,
  code = $block$
const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)
const text = String(input.text || item.text || '')
const batchIndex = Number(vars && vars.loopIndex)
const batchImages = Array.isArray(vars && vars.commentImageBatches) && Array.isArray(vars.commentImageBatches[batchIndex])
  ? vars.commentImageBatches[batchIndex]
  : []
const fallbackImages = Array.isArray(vars && vars.commentImages) ? vars.commentImages : []
const rawImages = Array.isArray(input.images) && input.images.length > 0
  ? input.images
  : (Array.isArray(item.images) && item.images.length > 0
      ? item.images
      : (batchImages.length > 0 ? batchImages : fallbackImages))
const images = rawImages.map(x => String(x || '').trim()).filter(Boolean).slice(0, 1)

if (!text && images.length === 0) return { commented: false, position: pos, text: '', imageCount: 0 }

// FB comment box dùng Lexical -> page.type (insertText) hoạt động, page.fill (paste) thì không.
// Pattern giống block "Comment vào bài viết" cũ: click -> sleep 2s -> type/drop -> Enter.
const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })
await page.waitForSelector(boxXpath, { timeout: 8000 })
await page.click(boxXpath)
await helpers.sleep(2000, signal)

if (text) {
  await page.type(boxXpath, text, { clearFirst: true })
  await helpers.sleep(1000, signal)
}

let imageCount = 0
if (images.length > 0) {
  const dropResult = await page.dropFile(boxXpath, images)
  imageCount = Number(dropResult.fileCount || 0)
  await helpers.sleep(3000, signal)
  if (!text && imageCount <= 0) {
    return { commented: false, position: pos, text: '', imageCount: 0 }
  }
}

await page.press('Enter')
await helpers.sleep(3000, signal)
const logSuffix = text ? ': ' + text.substring(0, 50) : ''
helpers.log('💬 Đã comment vào bài #' + pos + logSuffix)
return { commented: true, position: pos, text: text, imageCount: imageCount }
$block$,
  updated_at = now()
WHERE name = 'fb_comment_at_position';
