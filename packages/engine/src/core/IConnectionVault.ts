/**
 * App layer implement interface này để engine resolve secrets từ Connection.
 * Engine truyền secrets vào ExecutionContext (mask trong log).
 *
 * Phase 2 mock: trả empty object. Phase 6 thật: AES-GCM decrypt từ DB.
 */
export interface IConnectionVault {
  resolve(connectionId: string): Promise<Record<string, string>>
  /** Chuỗi value cần mask trong log cho 1 run (gom từ tất cả connection workflow dùng). */
  getMaskValuesForRun(runId: string): Promise<string[]>
}
