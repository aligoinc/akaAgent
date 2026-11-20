  // 20/11/2026 (câu 584 của bộ kiểm lỗi): khách nhập link bài chờ duyệt (/pending_posts/), Facebook mở trang bài chờ duyệt của nhóm, không có
  // hộp thoại bài. Chỉ xét sau các luật trên và chỉ khi link đang mở là link chờ duyệt; so đúng chữ đọc được trên trang thật 18–20/11/2026: còn
  // danh sách "Bài viết đang chờ · N" thì như bài chờ duyệt; hàng chờ trống "Chưa có bài viết nào để xem xét" (bài không còn chờ: đã duyệt hoặc đã
  // gỡ) thì như không tìm thấy bài. Không thấy chữ nào thì vẫn là không nhận ra.
  if (/\/pending_posts(?:[/?#]|$)/i.test(url)) {
    const pageTexts = texts.concat((signals && Array.isArray(signals.headings) ? signals.headings : []).map(normalizeCommentPageText))
    const listText = pageTexts.find(text => /^bài viết đang chờ(?:\s*·\s*\d+)?$/.test(text))
    const emptyText = listText ? null : ['chưa có bài viết nào để xem xét', 'không có bài viết nào đang chờ xem xét']
      .find(phrase => pageTexts.some(text => text.startsWith(phrase)))
    const pendingRule = COMMENT_UNAVAILABLE_RULES.find(rule => rule.reason === (listText ? 'post_pending' : emptyText ? 'post_not_found' : ''))
    if (pendingRule) {
      return { reason: pendingRule.reason, statusCode: pendingRule.statusCode, errorCode: pendingRule.errorCode, message: pendingRule.message,
        matched: listText || emptyText }
    }
  }
