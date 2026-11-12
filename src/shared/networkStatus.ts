/**
 * Dòng báo mất mạng (Desktop, port Web #212): kênh IPC giữa main và renderer.
 * Main báo cho renderer khi request tới máy chủ dữ liệu lỗi mạng / có phản hồi trở lại, và chạy lượt thử kết nối.
 */
export const NETWORK_STATUS_IPC = {
  /** renderer → main (invoke): thử kết nối máy chủ dữ liệu một lần, trả `true` khi có phản hồi HTTP bất kỳ. */
  PROBE: 'network:probe',
  /** main → renderer: một request tới máy chủ dữ liệu vừa lỗi mạng (`failed`) hoặc có phản hồi sau lần lỗi (`ok`). */
  REQUEST_SIGNAL: 'network:request-signal'
} as const

export type NetworkRequestSignal = 'failed' | 'ok'
