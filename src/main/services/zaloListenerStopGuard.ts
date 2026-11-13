/**
 * Dừng listener Zalo cho dứt khoát.
 *
 * zca-js 2.1.2 (`dist/apis/listen.js`), với `start({ retryOnClose: true })`:
 * - Socket đóng thì listener gọi `reset()` (`this.ws = null`) rồi hẹn `setTimeout(() => this.start(...), retry)` mà không giữ
 *   handle; `stop()` chỉ đóng socket khi `this.ws` còn. Gọi `stop()` lúc listener đang chờ nối lại (sau khi bị Zalo đá 3003,
 *   rớt mạng 1006…) hoặc lúc socket còn CONNECTING (đóng ra 1006, lại hẹn nối) thì hẹn giờ vẫn mở kết nối ngoài tầm app.
 * - `stop()` đóng socket rồi `reset()` ngay, còn sự kiện đóng của socket đó tới sau một vòng mạng. App `start()` lại trong lúc
 *   đó (làm mới listener trước khi gửi tệp, cùng đối tượng listener) thì handler đóng của socket cũ lại `reset()`: listener mất
 *   dấu socket mới đang sống, lần `stop()` sau không đóng được nó, và `disconnected`/`closed` của socket cũ bị báo như của
 *   kết nối mới.
 * Cả hai để lại kết nối "ma" giữ phiên Zalo của tài khoản sau khi app đã thả nó (App Server thả tổ chức sang Fly, đăng xuất,
 * đổi phiên), nên nơi chạy kế tiếp của tài khoản có thể bị đá.
 *
 * Bọc listener một lần:
 * - `start()` mà zca-js gọi từ hẹn giờ nối lại không làm gì sau `stopZaloListenerGuarded` (tới khi app gọi lại
 *   `startZaloListenerGuarded`) hoặc khi listener đã có socket (thay vì ném "Already started" trong hẹn giờ).
 * - Socket bị dừng được rào: app đã khởi động lại thì sự kiện đóng của nó bị bỏ qua; chưa thì zca-js vẫn báo `disconnected`
 *   rồi `closed` (runtime Fly dựa vào `closed` để tự nối lại sau khi chính nó dừng kết nối) nhưng không hẹn nối lại và không
 *   tốn lượt nối lại của listener.
 * Các lần nối lại ngắn của zca-js khi app chưa dừng listener giữ nguyên. Bản chép ở ChatApi
 * `packages/zalo-zca-adapter/src/listenerStopGuard.ts`; kiểm lại cả hai khi nâng zca-js.
 */
export interface ZaloListenerHandle {
  start(options?: { retryOnClose?: boolean }): void
  stop(): void
}

type StartOptions = { retryOnClose?: boolean }

/** Phần bên trong Listener của zca-js mà guard đụng tới. */
interface ListenerInternals {
  ws?: unknown
  canRetry?: (code: number) => unknown
}

/** Socket của thư viện `ws`: gán `onclose` là thay handler zca-js đã gán. */
interface FencedSocket {
  onclose: ((this: unknown, event: unknown) => void) | null
}

interface ListenerGuard {
  stopped: boolean
  /** Tăng mỗi lần app khởi động listener; socket dừng ở lượt trước không còn được báo về listener. */
  epoch: number
  start: (options?: StartOptions) => void
}

const guards = new WeakMap<ZaloListenerHandle, ListenerGuard>()

function internals(listener: ZaloListenerHandle): ListenerInternals {
  return listener as unknown as ListenerInternals
}

function guardOf(listener: ZaloListenerHandle): ListenerGuard {
  const existing = guards.get(listener)
  if (existing) return existing
  const originalStart = listener.start.bind(listener)
  const guard: ListenerGuard = { stopped: false, epoch: 0, start: originalStart }
  guards.set(listener, guard)
  // Hẹn giờ nối lại của zca-js gọi `this.start(...)` trên chính đối tượng này, nên đi qua đây.
  listener.start = (options?: StartOptions): void => {
    if (guard.stopped) return
    if (internals(listener).ws) return
    originalStart(options)
  }
  return guard
}

function fenceStoppedSocket(listener: ZaloListenerHandle, guard: ListenerGuard, socket: FencedSocket): void {
  const onclose = socket.onclose
  if (typeof onclose !== 'function') return
  const epoch = guard.epoch
  socket.onclose = function (this: unknown, event: unknown): void {
    // Đã khởi động lại: đây là sự kiện của socket cũ; để zca-js xử lý thì nó gỡ socket mới khỏi listener.
    if (guard.epoch !== epoch) return
    // Chưa khởi động lại: zca-js báo `disconnected` rồi `closed` như khi hết lượt nối lại, không hẹn nối lại.
    const target = internals(listener)
    const ownCanRetry = Object.prototype.hasOwnProperty.call(target, 'canRetry') ? target.canRetry : undefined
    target.canRetry = () => false
    try {
      onclose.call(this, event)
    } finally {
      if (ownCanRetry) target.canRetry = ownCanRetry
      else delete target.canRetry
    }
  }
}

/** Khởi động (hoặc khởi động lại sau khi dừng) listener; thay cho `listener.start(...)`. */
export function startZaloListenerGuarded(listener: ZaloListenerHandle, options?: StartOptions): void {
  const guard = guardOf(listener)
  guard.stopped = false
  guard.epoch += 1
  guard.start(options)
}

/** Dừng listener, chặn mọi lần nối lại zca-js đã hẹn và rào socket đang đóng; thay cho `listener.stop()`. */
export function stopZaloListenerGuarded(listener: ZaloListenerHandle): void {
  const guard = guardOf(listener)
  guard.stopped = true
  const socket = internals(listener).ws as FencedSocket | null | undefined
  listener.stop()
  if (socket) fenceStoppedSocket(listener, guard, socket)
}
