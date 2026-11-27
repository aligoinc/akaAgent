// Tài khoản "đang chạy" mà máy này không chạy gì cho nó (sự cố 27/11/2026: 153 tài khoản Zalo Server đứng im cả ngày vì trạng thái
// "đang chạy" còn sót sau lượt engine v2). Bộ lập lịch không tin trạng thái đó với chiến dịch chạy bằng engine v2: đưa chiến dịch cho hàm
// nhận lượt của DB quyết định (lease, dấu giữ lượt của bộ cũ, token thao tác tài khoản). Bộ cũ vẫn chỉ chạy khi tài khoản "chờ xử lý".
// Hàm thuần để kiểm riêng (scripts/stale-running-account-smoke.cjs); bộ lập lịch giữ mốc hỏi lại theo từng tài khoản.

/** Mỗi tài khoản "đang chạy" không do máy này: hỏi DB (nhận lượt engine) tối đa một lần mỗi chừng này. */
export const ENGINE_STALE_STATUS_PROBE_MS = 2 * 60_000

export interface StaleRunningProbeInput<C> {
  status: string | null | undefined
  loginStatus: string | null | undefined
  /** Máy này đang chạy gì cho tài khoản (hàng đợi, làn riêng, thao tác tài khoản, lướt): khi đó trạng thái "đang chạy" là thật. */
  hasLocalRun: boolean
  /** Đã quá ENGINE_STALE_STATUS_PROBE_MS kể từ lần hỏi trước của tài khoản này. */
  probeDue: boolean
  campaigns: readonly C[]
  /** Chiến dịch đã tới lịch chạy (theo giờ DB). Xét trước engineSupports (có thể nạp danh mục engine). */
  dueNow: (campaign: C) => boolean
  /** Bộ chạy engine v2 của máy này nhận chiến dịch (DesktopEngineRunner.support(...).ok). */
  engineSupports: (campaign: C) => boolean
}

/**
 * Chiến dịch engine v2 nên đưa cho DB quyết định khi tài khoản "đang chạy" mà máy này không chạy gì cho nó; null khi không cần (tài khoản
 * không "đang chạy", chưa đăng nhập, máy này đang chạy cho nó, chưa tới lượt hỏi lại, hoặc không chiến dịch engine nào tới lịch).
 */
export function staleRunningEngineCampaigns<C>(input: StaleRunningProbeInput<C>): C[] | null {
  if (input.status !== 'đang chạy' || input.loginStatus !== 'đã đăng nhập' || input.hasLocalRun || !input.probeDue) return null
  const list = input.campaigns.filter(campaign => input.dueNow(campaign) && input.engineSupports(campaign))
  return list.length > 0 ? list : null
}
