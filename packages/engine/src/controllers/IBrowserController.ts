/**
 * Common interface cho mọi browser controller (PlaywrightController, WebviewController).
 * Engine dùng interface này để execute browser actions, không quan tâm implementation.
 */
export interface ActionResult {
  success: boolean
  output: Record<string, unknown>
  error?: string
  durationMs: number
  screenshotBase64?: string
}

export interface IBrowserController {
  isConnected(): boolean
  executeAction(actionType: string, input: Record<string, unknown>): Promise<ActionResult>
  /** Optional — chỉ implement khi controller hỗ trợ chụp ảnh ngoài executeAction */
  takeScreenshot?(): Promise<string>
  /** Optional — chỉ implement khi controller có DOM access (page-runtime) */
  getPageContent?(): Promise<string>
}
