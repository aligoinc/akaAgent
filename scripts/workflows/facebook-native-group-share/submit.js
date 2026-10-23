signal.throwIfAborted();
if (vars.groupShareSelected !== true) throw new Error('Chưa chọn nhóm để chia sẻ');
const postXPath = await helpers.element('fb_post_button');
const editorXPath = await helpers.element('fb_composer_dialog');
// Use the existing selectors relative to the form containing the Post button.
// Do not write to the other contenteditable fields in the nested share dialogs.
const form = await page.evaluate(`
  const all = xpath => {
    const rows = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return Array.from({length: rows.snapshotLength}, (_, i) => rows.snapshotItem(i));
  };
  const buttons = all(__args[0]);
  if (buttons.length !== 1) throw new Error('Không xác định được duy nhất nút Đăng bài chia sẻ');
  if (buttons[0].getAttribute('aria-disabled') === 'true') throw new Error('Nút Đăng bài chia sẻ chưa sẵn sàng');
  const form = buttons[0].closest('form');
  if (!form) throw new Error('Không tìm thấy form chia sẻ vào nhóm');
  const editors = all(__args[1]).filter(el => form.contains(el));
  if (editors.length !== 1) throw new Error('Không xác định được ô nội dung bài chia sẻ');
  return true;
`, postXPath, editorXPath);
if (!form) throw new Error('Form chia sẻ chưa sẵn sàng');
const caption = String(vars.groupPostShareCaption || '');
const scopedEditor = `(${postXPath})/ancestor::form[1]//*`;
if (caption) {
  // Intersect the existing editor selector with the verified form's descendants.
  const editorInForm = editorXPath.split('|').map(part => part.trim() + `[count(. | ${scopedEditor}) = count(${scopedEditor})]`).join(' | ');
  await page.fill(editorInForm, caption);
  await helpers.sleep(1500, signal);
}
signal.throwIfAborted();
try {
  await page.evaluate(`
    const rows = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (rows.snapshotLength !== 1 || rows.snapshotItem(0).getAttribute('aria-disabled') === 'true') throw new Error('Nút Đăng bài chia sẻ chưa sẵn sàng');
    rows.snapshotItem(0).click();
  `, postXPath);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    await helpers.sleep(500, signal);
    const open = await page.evaluate(`return document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength > 0;`, postXPath);
    if (!open) {
      vars.groupPostSubmitted = true;
      return { posted: true, actionResult: { actionCode: 'fb_post_group', statusCode: 'campaign_detail_success',
        operationState: 'committed', message: 'Đã chia sẻ bài viết vào ' + vars.groupShareTarget.name,
        data: { shareMode: 'native_group_share', groupUrl: vars.groupShareTarget.url, sourceUrl: vars.groupShareSourceUrl,
          destinationPostUrl: null, submitClosed: true } } };
    }
  }
  throw new Error('Form chia sẻ bài viết chưa đóng sau 60 giây');

} catch (error) {
  // The click may have reached Facebook even when cancellation/transport
  // interrupts its acknowledgement. Preserve uncertainty; never auto-retry.
  return { posted: false, actionResult: { actionCode: 'fb_post_group',
    statusCode: 'campaign_detail_error', operationState: 'unknown', errorCode: 'err_undefined',
    message: 'Chưa xác nhận được kết quả chia sẻ sau khi bấm Đăng: ' + String(error.message || error),
    data: { shareMode: 'native_group_share', groupUrl: vars.groupShareTarget.url,
      sourceUrl: vars.groupShareSourceUrl, destinationPostUrl: null } } };
}
