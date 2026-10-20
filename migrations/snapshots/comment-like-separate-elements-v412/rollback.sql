-- Restore the exact state after V411. Keep migration history.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
LOCK TABLE public.auto_blocks,public.auto_workflows,public.auto_error IN SHARE MODE;
SELECT id FROM public.auto_elements WHERE id IN(1132,1456,1787) ORDER BY id FOR UPDATE;
DO $restore$
BEGIN
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_elements t WHERE id=1132) IS DISTINCT FROM '{"category":"facebook","created_at":"2026-04-29T08:29:26.476645+00:00","description":"Nút Thích tìm tương đối bên trong parent được truyền vào; lấy kết quả đầu tiên.","id":1132,"is_builtin":true,"name":"fb_like_button","organization_id":1,"staff_id":1,"xpath":".//*[@role=''button'' and (@aria-label=''Thích'' or @aria-label=''Like'')]"}'::jsonb THEN RAISE EXCEPTION 'v412 element 1132 mismatch'; END IF;
IF (SELECT to_jsonb(t) FROM public.auto_elements t WHERE id=1456) IS DISTINCT FROM '{"category":"facebook","created_at":"2026-04-29T09:36:36.285814+00:00","description":"Nút Thích trong bài viết thứ N của feed (template ${n}=position). Skip nếu đã Like → query không match.","id":1456,"is_builtin":true,"name":"fb_like_button_at_n","organization_id":1,"staff_id":1,"updated_at":"2026-04-29T09:36:35.184+00:00","xpath":"(//*[@role=''article''])[${n}]//*[@role=''button'' and (@aria-label=''Thích'' or @aria-label=''Like'')]"}'::jsonb THEN RAISE EXCEPTION 'v412 element 1456 mismatch'; END IF;
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=2074) IS DISTINCT FROM '{"category":"facebook","code":"// Require the successful comment output from this same iteration.\n// Old/cached workflow ordering cannot run this block before a comment.\nconst item = vars.loopItem || {}\nconst position = Number(input.position || item.position || 1)\nif (vars.enablePostLike !== true || input.enabled === false || input.commented !== true || input.commentFailed === true) {\n  return { liked: false, skipped: true, position }\n}\nif (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }\nlet result = null\ntry {\n  const parentSelector = await helpers.element(''fb_dialog'')\n  const selector = await helpers.element(''fb_like_button'')\n  // An already-open app may still cache the former absolute selector.\n  if (typeof selector !== ''string'' || !selector.trim().startsWith(''.//'')) {\n    helpers.log(''ℹ️ Bỏ qua Like: cần khởi động lại ứng dụng để nạp XPath nút Like tương đối'')\n    return { liked: false, skipped: true, reason: ''stale_like_selector'', position }\n  }\n  if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }\n  result = await page.evaluate(`\n    const parent = document.evaluate(__args[0], document, null,\n      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\n    if (!parent || !parent.isConnected) return { liked: false, skipped: true };\n    const button = document.evaluate(__args[1], parent, null,\n      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\n    if (!button || !button.isConnected || !parent.contains(button)) return { liked: false, skipped: true };\n    if (button.getAttribute(''aria-pressed'') === ''true'') {\n      return { liked: true, alreadyLiked: true };\n    }\n    button.scrollIntoView({ block: ''center'', inline: ''center'' });\n    if (!button.isConnected) return { liked: false, skipped: true };\n    button.click();\n    return { liked: true, alreadyLiked: false };\n  `, parentSelector, selector)\n  if (result && result.liked === true) {\n    helpers.log(result.alreadyLiked ? ''ℹ️ Bài post đã được thích trước đó'' : ''👍 Đã thích bài post sau khi comment'')\n    await helpers.sleep(1500, signal)\n  } else {\n    helpers.log(''ℹ️ Bỏ qua Like: không tìm thấy nút Thích trong dialog bài vừa comment'')\n  }\n  return { ...(result || { liked: false }), position }\n} catch (error) {\n  // Like is best effort. Never fail or repeat an already-submitted comment.\n  if (signal.aborted) return { ...(result || { liked: false }), cancelled: true, position }\n  const message = String(error && error.message || error)\n  helpers.log(''ℹ️ Bỏ qua Like sau comment: '' + message)\n  return { ...(result || { liked: false }), position, error: message }\n}\n","config_schema":[{"label":"Vị trí (1-based, để rỗng = lấy từ loopItem)","name":"position","type":"number"},{"default":true,"label":"Bật","name":"enabled","type":"boolean"}],"created_at":"2026-04-29T08:29:31.94939+00:00","default_config":{"enabled":true},"description":"Click nút Thích bài viết tại vị trí N trong feed (đọc vars.loopItem.position khi chạy trong loop). Skip nếu đã Like.","icon":"ThumbsUp","id":2074,"is_builtin":true,"kind":"js","name":"fb_click_like","organization_id":1,"output_schema":[{"label":"Đã Like thành công","name":"liked","type":"boolean"},{"label":"Vị trí đã Like","name":"position","type":"number"},{"label":"Lỗi nếu có","name":"error","type":"string"}],"staff_id":1,"system_type":null}'::jsonb THEN RAISE EXCEPTION 'v412 rollback block 2074 drift'; END IF;
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=2615) IS DISTINCT FROM '{"category":"facebook","code":"// Require the successful comment output from this same iteration.\n// Old/cached workflow ordering cannot run this block before a comment.\nconst item = vars.loopItem || {}\nconst position = Number(input.position || item.position || 1)\nif (vars.enablePostLike !== true || input.enabled === false || input.commented !== true || input.commentFailed === true) {\n  return { liked: false, skipped: true, position }\n}\nif (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }\nlet result = null\ntry {\n  const parentSelector = await helpers.element(''fb_dialog'')\n  const selector = await helpers.element(''fb_like_button'')\n  // An already-open app may still cache the former absolute selector.\n  if (typeof selector !== ''string'' || !selector.trim().startsWith(''.//'')) {\n    helpers.log(''ℹ️ Bỏ qua Like: cần khởi động lại ứng dụng để nạp XPath nút Like tương đối'')\n    return { liked: false, skipped: true, reason: ''stale_like_selector'', position }\n  }\n  if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }\n  result = await page.evaluate(`\n    const parent = document.evaluate(__args[0], document, null,\n      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\n    if (!parent || !parent.isConnected) return { liked: false, skipped: true };\n    const button = document.evaluate(__args[1], parent, null,\n      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\n    if (!button || !button.isConnected || !parent.contains(button)) return { liked: false, skipped: true };\n    if (button.getAttribute(''aria-pressed'') === ''true'') {\n      return { liked: true, alreadyLiked: true };\n    }\n    button.scrollIntoView({ block: ''center'', inline: ''center'' });\n    if (!button.isConnected) return { liked: false, skipped: true };\n    button.click();\n    return { liked: true, alreadyLiked: false };\n  `, parentSelector, selector)\n  if (result && result.liked === true) {\n    helpers.log(result.alreadyLiked ? ''ℹ️ Bài post đã được thích trước đó'' : ''👍 Đã thích bài post sau khi comment'')\n    await helpers.sleep(1200, signal)\n  } else {\n    helpers.log(''ℹ️ Bỏ qua Like: không tìm thấy nút Thích trong dialog bài vừa comment'')\n  }\n  return { ...(result || { liked: false }), position }\n} catch (error) {\n  // Like is best effort. Never fail or repeat an already-submitted comment.\n  if (signal.aborted) return { ...(result || { liked: false }), cancelled: true, position }\n  const message = String(error && error.message || error)\n  helpers.log(''ℹ️ Bỏ qua Like sau comment: '' + message)\n  return { ...(result || { liked: false }), position, error: message }\n}\n","config_schema":[{"default":true,"label":"Bật like","name":"enabled","type":"boolean"}],"created_at":"2026-05-15T07:53:19.812231+00:00","default_config":{"enabled":true},"description":"Like bài post hiện tại trong trang permalink, dùng DOM event không phụ thuộc toạ độ.","icon":"ThumbsUp","id":2615,"is_builtin":true,"kind":"js","name":"fb_click_like_current_post","organization_id":null,"output_schema":[{"label":"Đã thích","name":"liked","type":"boolean"},{"label":"Đã thích trước đó","name":"alreadyLiked","type":"boolean"}],"staff_id":null,"system_type":null}'::jsonb THEN RAISE EXCEPTION 'v412 rollback block 2615 drift'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE id=1787 OR name='fb_comment_post_like_button') THEN RAISE EXCEPTION 'v412 rollback collision'; END IF;
INSERT INTO public.auto_elements OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.auto_elements,'{"category":"facebook","created_at":"2026-10-20T07:45:57.026078+00:00","description":"Nút Thích đầu tiên trong dialog bài vừa comment thành công; không tìm trên feed.","id":1787,"is_builtin":true,"name":"fb_comment_post_like_button","organization_id":null,"staff_id":null,"updated_at":"2026-10-20T07:45:57.026078+00:00","xpath":"(//*[@role=''dialog'' and not(@aria-label=''Thông báo'') and not(@aria-label=''Messenger'')])[1]//*[@role=''button'' and (@aria-label=''Thích'' or @aria-label=''Like'')]"}'::jsonb);
UPDATE public.auto_blocks SET code='// Require the successful comment output from this same iteration.
// Old/cached workflow ordering cannot run this block before a comment.
const item = vars.loopItem || {}
const position = Number(input.position || item.position || 1)
if (vars.enablePostLike !== true || input.enabled === false || input.commented !== true || input.commentFailed === true) {
  return { liked: false, skipped: true, position }
}
if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }
let result = null
try {
  const selector = await helpers.element(''fb_comment_post_like_button'')
  if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }
  result = await page.evaluate(`
    const button = document.evaluate(__args[0], document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!button || !button.isConnected) return { liked: false, skipped: true };
    if (button.getAttribute(''aria-pressed'') === ''true'') {
      return { liked: true, alreadyLiked: true };
    }
    button.scrollIntoView({ block: ''center'', inline: ''center'' });
    if (!button.isConnected) return { liked: false, skipped: true };
    button.click();
    return { liked: true, alreadyLiked: false };
  `, selector)
  if (result && result.liked === true) {
    helpers.log(result.alreadyLiked ? ''ℹ️ Bài post đã được thích trước đó'' : ''👍 Đã thích bài post sau khi comment'')
    await helpers.sleep(1500, signal)
  } else {
    helpers.log(''ℹ️ Bỏ qua Like: không tìm thấy nút Thích trong dialog bài vừa comment'')
  }
  return { ...(result || { liked: false }), position }
} catch (error) {
  // Like is best effort. Never fail or repeat an already-submitted comment.
  if (signal.aborted) return { ...(result || { liked: false }), cancelled: true, position }
  const message = String(error && error.message || error)
  helpers.log(''ℹ️ Bỏ qua Like sau comment: '' + message)
  return { ...(result || { liked: false }), position, error: message }
}
',updated_at='2026-10-20T07:45:57.047009+00:00' WHERE id=2074;
UPDATE public.auto_blocks SET code='// Require the successful comment output from this same iteration.
// Old/cached workflow ordering cannot run this block before a comment.
const item = vars.loopItem || {}
const position = Number(input.position || item.position || 1)
if (vars.enablePostLike !== true || input.enabled === false || input.commented !== true || input.commentFailed === true) {
  return { liked: false, skipped: true, position }
}
if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }
let result = null
try {
  const selector = await helpers.element(''fb_comment_post_like_button'')
  if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }
  result = await page.evaluate(`
    const button = document.evaluate(__args[0], document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!button || !button.isConnected) return { liked: false, skipped: true };
    if (button.getAttribute(''aria-pressed'') === ''true'') {
      return { liked: true, alreadyLiked: true };
    }
    button.scrollIntoView({ block: ''center'', inline: ''center'' });
    if (!button.isConnected) return { liked: false, skipped: true };
    button.click();
    return { liked: true, alreadyLiked: false };
  `, selector)
  if (result && result.liked === true) {
    helpers.log(result.alreadyLiked ? ''ℹ️ Bài post đã được thích trước đó'' : ''👍 Đã thích bài post sau khi comment'')
    await helpers.sleep(1200, signal)
  } else {
    helpers.log(''ℹ️ Bỏ qua Like: không tìm thấy nút Thích trong dialog bài vừa comment'')
  }
  return { ...(result || { liked: false }), position }
} catch (error) {
  // Like is best effort. Never fail or repeat an already-submitted comment.
  if (signal.aborted) return { ...(result || { liked: false }), cancelled: true, position }
  const message = String(error && error.message || error)
  helpers.log(''ℹ️ Bỏ qua Like sau comment: '' + message)
  return { ...(result || { liked: false }), position, error: message }
}
',updated_at='2026-10-20T07:45:57.047208+00:00' WHERE id=2615;
IF EXISTS(SELECT 1 FROM public.auto_blocks t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v412 rollback restored elements still used by auto_blocks'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_workflows t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v412 rollback restored elements still used by auto_workflows'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_error t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v412 rollback restored elements still used by auto_error'; END IF;
DELETE FROM public.auto_elements WHERE id IN(1132,1456);
END $restore$;
COMMIT;
