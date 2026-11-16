import { AsyncLocalStorage } from "node:async_hooks";
export const CAMPAIGN_MEDIA_TIMEOUT_CODE = "campaign_media_timeout";

type UploadCallback = (data: { fileUrl: string; fileId: string }) => unknown;
interface MediaExecution {
  controller: AbortController;
  cleanup: Set<() => void>;
  /** A Zalo request other than a file upload (a send, or an unreadable URL) has started: later failures may follow a send. */
  zaloRequestStarted: boolean;
  /** A file upload failed with a transport error before any other Zalo request started. */
  uploadFailedBeforeSend: boolean;
}

/**
 * Marks the error of a campaign media send whose file upload failed (connection reset, socket closed…) before any other Zalo
 * request: zca-js only calls the send endpoint after every upload finished, so nothing reached the recipient. The engine v2
 * port reads it to classify the failure as "not sent" (NET01) instead of "delivery unknown" (UNK01). Symbol.for so that every
 * bundle of this module shares the key; the same key is used by akaAgentChatApi's runtime copy of this class.
 */
export const CAMPAIGN_MEDIA_UPLOAD_NOT_SENT = Symbol.for("aka-agent.campaign-media.upload-not-sent");

export function isCampaignMediaUploadNotSent(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as Record<symbol, unknown>)[CAMPAIGN_MEDIA_UPLOAD_NOT_SENT] === true;
}

function markUploadNotSent(error: unknown): void {
  if (typeof error !== "object" || error === null) return;
  try {
    Object.defineProperty(error, CAMPAIGN_MEDIA_UPLOAD_NOT_SENT, { value: true, configurable: true });
  } catch {
    // A frozen error keeps the old classification (delivery unknown), never the reverse.
  }
}

/** zca-js uploadAttachment / upthumb endpoints (…/api/message|group/photo_original/upload, asyncfile/upload, upthumb). */
const ZALO_UPLOAD_PATH = /^\/api\/(?:message|group)\/(?:photo_original\/upload|asyncfile\/upload|upthumb)\/?$/i;
const ZALO_HOST = /(?:^|\.)zalo\.me$/i;

function requestUrl(input: Parameters<typeof fetch>[0]): URL | null {
  try {
    if (typeof input === "string") return new URL(input);
    if (input instanceof URL) return input;
    const url = (input as { url?: unknown } | null)?.url;
    return typeof url === "string" ? new URL(url) : null;
  } catch {
    return null;
  }
}

/**
 * upload: a zca-js file upload (nothing is sent to the recipient yet); zalo: any other Zalo API request, including sends, or a
 * URL that cannot be read (treated as a possible send); other: a non-Zalo request such as downloading the campaign file.
 */
function zaloRequestKind(input: Parameters<typeof fetch>[0]): "upload" | "zalo" | "other" {
  const url = requestUrl(input);
  if (!url) return "zalo";
  if (ZALO_UPLOAD_PATH.test(url.pathname)) return "upload";
  return ZALO_HOST.test(url.hostname) || url.pathname.startsWith("/api/") ? "zalo" : "other";
}

// One async hook for all API sessions. A store contains only owners nested in
// this call chain, not a global registry of sessions or concurrent sends.
const currentExecutions = new AsyncLocalStorage<ReadonlyMap<symbol, MediaExecution>>();

export class CampaignMediaTimeoutError extends Error {
  public readonly code = CAMPAIGN_MEDIA_TIMEOUT_CODE;

  public constructor(timeoutMs: number) {
    super(`Gửi media quá thời gian chờ (${Math.round(timeoutMs / 1_000)} giây). ` +
      "Đã đóng tác vụ; kết quả gửi chưa xác định, không tự gửi lại người nhận này.");
    this.name = "CampaignMediaTimeoutError";
  }
}

function closedError(): Error {
  return Object.assign(new Error("Tác vụ media đã đóng; không thực hiện thêm yêu cầu Zalo."), {
    code: "campaign_runtime_unavailable"
  });
}

/**
 * Fence the SDK's entire async send chain, including continuations after a lost
 * file_done callback or an early Promise.all rejection. A terminal timeout means
 * no more requests can start, not that Zalo definitely rejected an earlier send.
 * Wrap the API context fetch before a campaign send; preserve its proxy transport.
 * SDK utils.request reads ctx.options.polyfill for every request. Never replace global fetch.
 */
export class CampaignMediaExecution {
  private readonly scopeKey = Symbol("campaignMediaExecution");
  private readonly active = new Set<MediaExecution>();
  private stopped = false;

  public constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  private currentScope(): MediaExecution | undefined {
    return currentExecutions.getStore()?.get(this.scopeKey);
  }

  private runInScope<T>(scope: MediaExecution, operation: () => T): T {
    const inherited = currentExecutions.getStore();
    if (inherited?.get(this.scopeKey) === scope) return operation();
    // Copy on entry so parallel/nested sends cannot overwrite each other's scope.
    const scopes = new Map(inherited);
    scopes.set(this.scopeKey, scope);
    return currentExecutions.run(scopes, operation);
  }

  public readonly fetch: typeof fetch = async (input, init) => {
    const scope = this.currentScope();
    if (!scope) return this.fetcher(input, init);
    scope.controller.signal.throwIfAborted();
    const previousSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = previousSignal
      ? AbortSignal.any([scope.controller.signal, previousSignal])
      : scope.controller.signal;
    const kind = zaloRequestKind(input);
    if (kind === "zalo") scope.zaloRequestStarted = true;
    // Both upload and delivery requests (and SDK redirects) pass this fence.
    try {
      return await this.fetcher(input, { ...init, signal });
    } catch (error) {
      // fetch rejects only on transport failure or abort; aborts (deadline, stop) keep the fence's own result.
      if (kind === "upload" && !scope.zaloRequestStarted && !signal.aborted) scope.uploadFailedBeforeSend = true;
      throw error;
    }
  };

  public trackUploadCallbacks(callbacks: Map<string, UploadCallback>): void {
    const originalSet = callbacks.set.bind(callbacks);
    callbacks.set = (key, callback) => {
      const scope = this.currentScope();
      if (!scope) return originalSet(key, callback);
      if (scope.controller.signal.aborted) return callbacks;
      const cleanup = () => {
        if (callbacks.get(key) === guarded) callbacks.delete(key);
        scope.cleanup.delete(cleanup);
      };
      const guarded: UploadCallback = (data) => {
        cleanup();
        if (scope.controller.signal.aborted) return;
        // Restore only this owner's scope, preserving other owners at invocation.
        return this.runInScope(scope, () => callback(data));
      };
      scope.cleanup.add(cleanup);
      // Scoped entries live only until completion/deadline, without the SDK's
      // five-minute timer (which can also delete a later entry for the key).
      Map.prototype.set.call(callbacks, key, guarded);
      return callbacks;
    };
  }

  public async run<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (this.stopped) throw closedError();
    const scope: MediaExecution = {
      controller: new AbortController(), cleanup: new Set(), zaloRequestStarted: false, uploadFailedBeforeSend: false
    };
    this.active.add(scope);
    const timeout = setTimeout(() => scope.controller.abort(new CampaignMediaTimeoutError(timeoutMs)), timeoutMs);
    timeout.unref();
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(scope.controller.signal.reason);
      scope.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return this.runInScope(scope, async () => {
      try {
        return await Promise.race([Promise.resolve().then(operation), cancelled]);
      } catch (error) {
        // Checked before `finally` closes the scope: an abort here is the deadline or a stop, which keep their own codes.
        if (scope.uploadFailedBeforeSend && !scope.zaloRequestStarted && !scope.controller.signal.aborted) {
          markUploadNotSent(error);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        scope.controller.signal.removeEventListener("abort", onAbort);
        // Also close siblings after an ordinary Promise.all rejection.
        // Keep the aborted context on late continuations; clearing/disabling the
        // shared storage would let them fall back to the unscoped transport.
        scope.controller.abort(closedError());
        for (const cleanup of [...scope.cleanup]) cleanup();
        this.active.delete(scope);
      }
    });
  }

  public stop(): void {
    this.stopped = true;
    // A stopped session may already have sent bytes. Never classify an active
    // send as "runtime unavailable", which allows the worker to retry input.
    for (const scope of this.active) scope.controller.abort(Object.assign(
      new Error("Phiên Zalo đã dừng khi đang gửi media; không tự gửi lại để tránh trùng."),
      { code: "command_result_unknown" }
    ));
  }
}
