/**
 * TypeScript declarations cho block JS context.
 * Inject vào Monaco làm extra-lib → user gõ `page.` thấy autocomplete.
 *
 * Phải sync với:
 *   - src/main/v2/runtime/pageController.ts (PageController interface)
 *   - src/main/v2/runtime/blockHelpers.ts (BlockHelpers interface)
 *   - src/main/v2/runtime/blockExecutor.ts (sandbox context)
 */
export const BLOCK_API_DTS = `
declare const input: Record<string, any>;
declare const vars: Record<string, any>;
declare const signal: AbortSignal;

interface PageController {
  // Navigation
  navigate(url: string): Promise<void>;
  reload(): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  getURL(): string;

  // Element resolution (CSS hoặc XPath với prefix //)
  $(selector: string): Promise<{ xpath: string } | null>;
  $$(selector: string): Promise<{ xpath: string }[]>;
  waitForSelector(selector: string, opts?: { timeout?: number; state?: 'visible' | 'hidden' | 'attached' }): Promise<boolean>;
  waitForNavigation(timeoutMs?: number): Promise<void>;

  // Interaction
  click(selector: string, opts?: { clickCount?: number }): Promise<void>;
  type(selector: string, text: string, opts?: { clearFirst?: boolean }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  hover(selector: string): Promise<void>;
  press(key: string): Promise<void>;
  scroll(opts: { selector?: string; direction: 'up' | 'down' | 'left' | 'right'; amount?: number }): Promise<{ scrollX: number; scrollY: number }>;
  select(selector: string, value: string): Promise<string>;

  // Data
  getText(selector: string): Promise<string>;
  getValue(selector: string): Promise<string>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  screenshot(opts?: { fullPage?: boolean }): Promise<string>;

  // Files (CDP-based)
  uploadFile(selector: string, paths: string[]): Promise<{ fileCount: number }>;
  dropFile(selector: string, paths: string[]): Promise<{ fileCount: number }>;
  dropFileDeep(selector: string, paths: string[]): Promise<{ fileCount: number }>;

  // Generic
  evaluate<T = unknown>(code: string, ...args: unknown[]): Promise<T>;
  apiCall(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: 'json' | 'form' | 'multipart';
    files?: Array<{ field: string; path: string; filename?: string; contentType?: string }>;
    timeout?: number;
  }): Promise<{ status: number; data: unknown; headers: Record<string, string> }>;
  getCookieHeader(url: string): Promise<string>;
  downloadUrl(url: string, opts?: { timeout?: number }): Promise<{ filePath: string; byteLength: number; contentType: string }>;
}

interface BlockHelpers {
  /** Pause execution. Throws khi signal aborted. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Append a line vào run log (capture cho UI realtime + run history) */
  log(message: string): void;
  /** Random integer trong [min, max] (inclusive) */
  randomBetween(min: number, max: number): number;
  /** Normalize URL FB: bare uid/slug → full https://www.facebook.com/... */
  normalizeFbUrl(raw: string): string;
  /** Trích UID/slug từ profile URL hoặc profile.php?id=X */
  extractUidFromInput(raw: string): string;
  /** Tách content theo \`|\` thành array biến thể (đã trim, bỏ rỗng) */
  splitVariants(content: string | undefined | null): string[];
  /** Cycle 1 biến thể theo index (modulo). Empty array → '' */
  cycleVariant(variants: string[], index: number): string;
  /** Lookup XPath snippet từ auto_elements bằng name. Throws nếu không tìm thấy. */
  element(name: string): Promise<string>;
  /** Concat XPath snippet với placeholder substitution: helpers.elementWith('xx', { n: 3 }) → replace \${n} với 3 */
  elementWith(name: string, vars: Record<string, string | number>): Promise<string>;
}

declare const page: PageController;
declare const helpers: BlockHelpers;
`
