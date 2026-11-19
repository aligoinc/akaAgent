/**
 * Mili giây theo đồng hồ đơn điệu của tiến trình. Chỉ dùng để đo khoảng thời gian (hạn chờ, thời gian nghỉ, phát hiện treo): giờ máy bị
 * chỉnh lùi hay tiến (đồng hồ Windows sai, phần mềm đặt lại giờ, đồng bộ giờ) không làm khoảng đo đổi. Đo bằng Date.now() thì máy bị kéo lùi
 * giờ làm vòng chờ không bao giờ hết hạn (19/11/2026, lượt Facebook treo từ 17:18 hôm trước tới khi khách mở lại app).
 *
 * Không dùng làm mốc thời gian ghi DB, không so với Date.now().
 */
export function monotonicNow(): number {
  return performance.now()
}

/** Hạn chờ tính từ lúc gọi: `expired()` đúng sau `ms` mili giây thật, `remaining()` là số mili giây còn lại (không âm). */
export function monotonicDeadline(ms: number): { expired(): boolean; remaining(): number } {
  const endAt = monotonicNow() + Math.max(0, ms)
  return {
    expired: () => monotonicNow() >= endAt,
    remaining: () => Math.max(0, endAt - monotonicNow())
  }
}
