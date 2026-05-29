-- Make newsfeed comments use the same type + Enter flow as direct post-link comment seeding.

BEGIN;

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const text = String(state.commentText || '').replace(/\t/g, '      ')
if (input.focused !== true || !text.trim()) return { pasted: false, text }
const inputSelector = '[data-aka-newsfeed-comment-input="1"]'
try {
  await page.waitForSelector(inputSelector, { timeout: 8000 })
  await page.click(inputSelector)
  await helpers.sleep(1000, signal)
  await page.type(inputSelector, text, { clearFirst: true })
  await helpers.sleep(1000, signal)
} catch (e) {
  const skipReason = e && e.message ? e.message : String(e)
  helpers.log('Bỏ qua nhập comment newsfeed: ' + skipReason)
  return { pasted: false, text, skipReason }
}
const wordCount = text ? text.split(' ').filter(Boolean).length : 0
const tc = helpers.randomBetween(1, Number(state.tcWrite || 3))
const per100 = helpers.randomBetween(Number(state.timeWrite100WordsMin || 90), Number(state.timeWrite100WordsMin || 90) * 2)
const sleepMs = (tc + Math.floor(per100 * wordCount / 100)) * 1000
await helpers.sleep(sleepMs, signal)
return { pasted: true, typed: true, text, writeSleepMs: sleepMs }
$code$,
description = 'Nhập nội dung comment newsfeed bằng page.type giống comment seeding post.',
updated_at = now()
WHERE name = 'fb_newsfeed_comment_paste';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const post = state.currentPost || {}
const text = String(input.text || state.commentText || '')
if (input.pasted !== true || state.remainingComment <= 0) return { commented: false, text }
const inputSelector = '[data-aka-newsfeed-comment-input="1"]'
try {
  await page.waitForSelector(inputSelector, { timeout: 8000 })
  await page.click(inputSelector)
  await helpers.sleep(500, signal)
  await page.press('Enter')
  await helpers.sleep(10000, signal)
} catch (e) {
  const skipReason = e && e.message ? e.message : String(e)
  helpers.log('Bỏ qua gửi comment newsfeed: ' + skipReason)
  return { commented: false, text, skipReason }
}
state.remainingComment = Math.max(0, Number(state.remainingComment || 0) - 1)
state.commentDone = Number(state.commentDone || 0) + 1
helpers.log('Đã comment bài newsfeed của ' + (post.targetName || 'người đăng'))
return {
  commented: true,
  text,
  targetName: post.targetName || '',
  targetUid: post.targetUid || '',
  postContent: post.postContent || ''
}
$code$,
description = 'Gửi comment newsfeed bằng Enter giống comment seeding post.',
updated_at = now()
WHERE name = 'fb_newsfeed_comment_submit';

COMMIT;
