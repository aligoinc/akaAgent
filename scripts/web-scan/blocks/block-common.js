// Hàm dùng chung, ghép đầu code mỗi block quét web (bộ sinh nối chuỗi, không sửa tay trong DB).
// Chạy script trong trang theo từng lần ngắn: trang chưa sẵn sàng / đang ở lớp xác minh thì script trả { pending: true } ngay, block nghỉ rồi
// gọi lại tới hạn waitMs. Không để script chạy lâu trong trang: Cloudflare tự tải lại trang khi qua lớp xác minh, lời gọi script đang chạy dở
// trên trang cũ thì không bao giờ trả về (thử batdongsan 21/11/2026). Hết hạn thì trả kết quả lần cuối kèm timedOut.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}
