// Opt-in for comment feeds; the existing find-data branch below stays unchanged.
if (input.commentFeedSort === true) {
  const sortType = ['most_relevant', 'new_posts'].includes(vars.commentPostSort)
    ? vars.commentPostSort : 'recent_activity';
  const labels = {
    most_relevant: 'Phù hợp nhất',
    recent_activity: 'Hoạt động mới đây',
    new_posts: 'Bài viết mới'
  };
  const optionNames = {
    most_relevant: 'fb_feed_most_relevant_post_option',
    recent_activity: 'fb_recent_activity_post_btn',
    new_posts: 'fb_new_post_btn'
  };
  const checkAbort = () => {
    if (signal && signal.aborted) throw new Error('Đã hủy sắp xếp bài viết');
  };
  const recordSort = async (status, reason, message, xpath) => {
    helpers.log(message);
    await helpers.logRunEvent({
      eventType: 'sort_posts',
      eventName: 'Sắp xếp bài viết',
      targetType: 'feed',
      status,
      isUserVisible: false,
      message,
      ...(xpath ? { xpath } : {}),
      debugData: { sortType, reason }
    });
    return { postSort: sortType, postSortApplied: status === 'success', postSortReason: reason };
  };
  checkAbort();
  let menuOpened = false;
  try {
    const sortButton = await helpers.element('fb_feed_post_sort_button');
    checkAbort();
    const button = await page.$(sortButton);
    checkAbort();
    if (!button) {
      return await recordSort('skipped', 'sort_unavailable',
        'ℹ️ Trang này không có tùy chọn sắp xếp bài viết; giữ thứ tự đang hiển thị.');
    }
    await page.click(sortButton);
    menuOpened = true;
    await helpers.sleep(1000, signal);
    checkAbort();
    const option = await helpers.element(optionNames[sortType]);
    checkAbort();
    const available = await page.$(option);
    checkAbort();
    if (!available) {
      await page.press('Escape');
      menuOpened = false;
      checkAbort();
      return await recordSort('skipped', 'option_unavailable',
        'ℹ️ Trang này không có lựa chọn “' + labels[sortType] + '”; giữ thứ tự đang hiển thị.');
    }
    await page.click(option);
    menuOpened = false;
    await helpers.sleep(2500, signal);
    checkAbort();
    return await recordSort('success', 'selected',
      'Đã sắp xếp bài viết: ' + labels[sortType] + '.', option);
  } catch (err) {
    checkAbort();
    if (menuOpened) {
      try { await page.press('Escape'); } catch (_) {}
      checkAbort();
    }
    return await recordSort('failed', 'sort_failed',
      'Không đổi được sắp xếp bài viết; tiếp tục theo thứ tự đang hiển thị.');
  }
}
