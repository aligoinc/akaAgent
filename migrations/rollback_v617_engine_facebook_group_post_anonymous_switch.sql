-- Gỡ V617: block 2923 về code V616 (không bật được công tắc thì ném lỗi → SYS99), mã FB52 và chính sách chỉ bị tắt. Chỉ chạy khi
-- block đang đúng bản V617 (đã ai sửa sau V617 thì dừng, không ghi đè). SINH TỪ scripts/build-v617-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2923 AND md5(code) = '1bf17cec942b68537a7bdff675ee94f8') THEN
    RAISE EXCEPTION 'Gỡ V617: block 2923 không phải bản V617 (md5 1bf17cec942b68537a7bdff675ee94f8), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = $v617_block$
// Đăng bài nhóm ẩn danh (anh chốt 21/11/2026). Chạy ngay sau khi hộp "Tạo bài viết" đã mở, trước khi gõ nội dung.
// Chiến dịch không bật ẩn danh: không làm gì (không có khoá actionResult để bộ dựng lịch sử không coi là kết quả).
if (vars.groupPostAnonymous !== true) return { anonymousReady: true }
const switchSelector = await helpers.element('fb_group_post_anonymous_switch')
const okSelector = await helpers.element('fb_group_post_anonymous_intro_ok')
// Trạng thái công tắc "Đăng ẩn danh" trong hộp Tạo bài viết: missing / off / on.
async function anonymousSwitchState() {
  return await page.evaluate(`
    const result = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (result.snapshotLength === 0) return 'missing';
    for (let i = 0; i < result.snapshotLength; i++) {
      if (result.snapshotItem(i).getAttribute('aria-checked') === 'true') return 'on';
    }
    return 'off';
  `, switchSelector)
}
// Công tắc có thể hiện chậm hơn ô nhập nội dung: chờ tối đa 5 giây.
let state = await anonymousSwitchState()
const switchDeadline = Date.now() + 5000
while (state === 'missing' && Date.now() < switchDeadline) {
  await helpers.sleep(250, signal)
  state = await anonymousSwitchState()
}
// Hộp Tạo bài viết đã mở mà không có công tắc: nhóm không cho đăng ẩn danh. Không đăng; data chuyển tạm dừng (FB51).
if (state === 'missing') {
  return {
    anonymousReady: false,
    actionResult: {
      actionCode: 'fb_post_group', statusCode: 'campaign_detail_error', errorCode: 'err_fb_group_anonymous_post_not_allowed',
      inputDataId: vars.inputDataId ?? null, operationState: 'not_committed', message: 'Nhóm này không cho đăng bài ẩn danh',
      data: { source: 'fb_enable_group_anonymous_post', selector: switchSelector }
    }
  }
}
if (state === 'off') {
  await page.click(switchSelector)
  // Bấm công tắc thì Facebook hiện bảng giới thiệu "Bài viết ẩn danh" có nút OK (mỗi lần mở trang mới); bấm OK thì công tắc mới bật.
  const enableDeadline = Date.now() + 15000
  while (true) {
    state = await anonymousSwitchState()
    if (state === 'on' || Date.now() >= enableDeadline) break
    if (await page.$(okSelector)) {
      await page.click(okSelector)
      await helpers.sleep(1000, signal)
    } else {
      await helpers.sleep(500, signal)
    }
  }
}
// Không bật được thì dừng ở đây: tuyệt đối không bấm Đăng bằng tên thật.
if (state !== 'on') throw new Error('Không bật được chế độ đăng bài ẩn danh')
return { anonymousReady: true, anonymousEnabled: true }
$v617_block$, updated_at = now() WHERE id = 2923 AND md5(code) = '1bf17cec942b68537a7bdff675ee94f8';
UPDATE public.auto_outcome_policies SET is_active = false, updated_at = now() WHERE error_code = 'err_fb_group_anonymous_switch_not_enabled' AND source = 'v617';
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = 'err_fb_group_anonymous_switch_not_enabled';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2923 AND md5(code) = '0687856f3663282482914025fc606aa0') THEN
    RAISE EXCEPTION 'Gỡ V617 postflight: block 2923 chưa về code V616';
  END IF;
END $post$;

COMMIT;
