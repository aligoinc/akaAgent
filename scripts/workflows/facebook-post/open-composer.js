// Composer errors use the standard result contract; workflow gates publishing on opened.
async function waitForComposer(selector, stage) {
  try { await page.waitForSelector(selector, { timeout: 15000 }); }
  catch (cause) {
    const raw = cause && cause.message ? String(cause.message) : String(cause);
    const actionCode = input.composerActionCode;
    if (signal.aborted || !raw.startsWith('waitForSelector timeout:') ||
        !['fb_post_group', 'fb_post_my_profile'].includes(actionCode)) throw cause;
    const actionResult = {
      actionCode, statusCode: 'campaign_detail_error', errorCode: actionCode === 'fb_post_group'
        ? 'err_fb_group_composer_editor_not_found' : 'err_fb_composer_editor_not_found',
      inputDataId: vars.inputDataId ?? null,
      operationState: 'not_committed', message: "Không tìm thấy ô đăng bài",
      data: { error: raw, selector, stage, source: 'fb_open_composer' }
    };
    return { opened: false, actionResult };
  }
}
const btn = await helpers.element('fb_composer_button')
const buttonFailure = await waitForComposer(btn, 'composer_button')
if (buttonFailure) return buttonFailure
await helpers.sleep(500, signal)
await page.click(btn)
// Chờ form đăng bài (//form[@method='POST']) — giống pattern cũ sleep 5s
await helpers.sleep(5000, signal)
const dialog = await helpers.element('fb_composer_dialog')
const dialogFailure = await waitForComposer(dialog, 'composer_dialog')
if (dialogFailure) return dialogFailure
return { opened: true }