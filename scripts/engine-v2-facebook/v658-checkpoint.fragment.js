// 26/11/2026 (câu 639 / 3300 / 6279 của bộ kiểm lỗi, Q6): mở nhóm mà Facebook chuyển sang trang xác minh / trang đăng nhập thì trang vẫn có vùng
// chính nên các bước trước chạy qua, quét ra 0 bài và lượt bị đóng bằng FB45. Trả đúng mã trạng thái đăng nhập (FB04 / FB43, chính sách có sẵn:
// data chưa gửi về hàng đợi, tài khoản đổi trạng thái đăng nhập), không quét bài. Mẫu đường dẫn như bộ lập lịch (facebookPageStateSignal).
const __seedingPageUrl = await (async () => {
  try { return String(await page.evaluate('return String(location.href || "")') || '') } catch (e) { return '' }
})()
const __seedingPagePath = (/^https?:\/\/(?:[a-z0-9-]+\.)*facebook\.com(\/[^?#]*)?/i.exec(__seedingPageUrl) || [])[1] || ''
const __seedingPageState = /^\/(checkpoint|challenge|two_step_verification|two_factor|recover|confirmemail)(\/|$)/.test(__seedingPagePath)
  ? { reason: 'checkpoint', errorCode: 'err_fb_checkpoint', message: 'Facebook yêu cầu xác minh tài khoản (checkpoint)' }
  : /^\/login(?:\.php|\/|$)/.test(__seedingPagePath)
    ? { reason: 'logged_out', errorCode: 'err_engine_fb_logged_out', message: 'Tài khoản Facebook đã bị đăng xuất' }
    : null
if (__seedingPageState) {
  helpers.log('⚠️ ' + __seedingPageState.message)
  return {
    commentIterations: [],
    totalCount: 0,
    matchedCount: 0,
    scannedCount: 0,
    readCycles: 0,
    scrollCycles: 0,
    noGrowthCycles: 0,
    stopReason: __seedingPageState.reason,
    maxScannedPosts: MAX_SCANNED_POSTS,
    maxScrollCycles: MAX_SCROLL_CYCLES,
    maxNoGrowthCycles: MAX_NO_GROWTH_CYCLES,
    hardLimitReached: false,
    keywordMatchedCount: 0,
    aiMatchedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    actionResult: {
      actionCode: 'fb_comment', statusCode: 'campaign_detail_error', errorCode: __seedingPageState.errorCode,
      inputDataId: vars.inputDataId ?? null, operationState: 'not_committed', message: __seedingPageState.message,
      data: { reason: __seedingPageState.reason, url: __seedingPageUrl.slice(0, 300), source: 'fb_prepare_seeding_iterations' }
    }
  }
}

