// Báo cáo dữ liệu trên Desktop: một kênh IPC, kết quả {ok,data} | {ok:false,code,message} như báo cáo hiệu quả.
import type { DataReportJourney, DataReportSnapshot } from './dataReports'

export const DATA_REPORT_IPC = 'report:data' as const

export type DataReportIpcRequest =
  | { kind: 'snapshot' }
  | { kind: 'journey'; phone: string }

/** Same audience as WebApp/iOS: Zalo (any account kind on Desktop) or SMS; the main process checks it on every read. */
export interface DataReportIpcResponses {
  snapshot: DataReportSnapshot
  journey: DataReportJourney
}

export type DataReportIpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }
