import { AsyncLocalStorage } from "node:async_hooks";
export const CAMPAIGN_MEDIA_TIMEOUT_CODE = "campaign_media_timeout";

type UploadCallback = (data: { fileUrl: string; fileId: string }) => unknown;
interface MediaExecution {
  controller: AbortController;
  cleanup: Set<() => void>;
}

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
  private readonly current = new AsyncLocalStorage<MediaExecution>();
  private readonly active = new Set<MediaExecution>();
  private stopped = false;

  public constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  public readonly fetch: typeof fetch = async (input, init) => {
    const scope = this.current.getStore();
    if (!scope) return this.fetcher(input, init);
    scope.controller.signal.throwIfAborted();
    const previousSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = previousSignal
      ? AbortSignal.any([scope.controller.signal, previousSignal])
      : scope.controller.signal;
    // Both upload and delivery requests (and SDK redirects) pass this fence.
    return this.fetcher(input, { ...init, signal });
  };

  public trackUploadCallbacks(callbacks: Map<string, UploadCallback>): void {
    const originalSet = callbacks.set.bind(callbacks);
    callbacks.set = (key, callback) => {
      const scope = this.current.getStore();
      if (!scope) return originalSet(key, callback);
      if (scope.controller.signal.aborted) return callbacks;
      const cleanup = () => {
        if (callbacks.get(key) === guarded) callbacks.delete(key);
        scope.cleanup.delete(cleanup);
      };
      const guarded: UploadCallback = (data) => {
        cleanup();
        if (scope.controller.signal.aborted) return;
        return this.current.run(scope, () => callback(data));
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
    const scope: MediaExecution = { controller: new AbortController(), cleanup: new Set() };
    this.active.add(scope);
    const timeout = setTimeout(() => scope.controller.abort(new CampaignMediaTimeoutError(timeoutMs)), timeoutMs);
    timeout.unref();
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(scope.controller.signal.reason);
      scope.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return this.current.run(scope, async () => {
      try {
        return await Promise.race([Promise.resolve().then(operation), cancelled]);
      } finally {
        clearTimeout(timeout);
        scope.controller.signal.removeEventListener("abort", onAbort);
        // Also close siblings after an ordinary Promise.all rejection.
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
