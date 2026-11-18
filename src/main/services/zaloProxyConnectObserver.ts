import type { EventEmitter } from 'node:events'

// Proxy từ chối lệnh CONNECT (407, 403...) thì https-proxy-agent 7 phát lại nguyên trang lỗi của proxy như câu
// trả lời của trang đích, nên zca-js chỉ báo "Cannot get API login version" khi quét QR (18/11/2026).
// Bọc connect() của ProxyAgent để đọc mã CONNECT thật của từng yêu cầu. Chỉ nghe sự kiện `proxyConnect`
// mà agent con đã phát sẵn, không đổi cách kết nối; thư viện đổi cách làm thì không bắt được gì và giữ câu lỗi cũ.

type ConnectFn = (this: unknown, ...args: unknown[]) => unknown

export function observeProxyConnectRejections(agent: unknown, onReject: (statusCode: number) => void): void {
  const target = agent as { connect?: ConnectFn } | null | undefined
  const connect = target?.connect
  if (!target || typeof connect !== 'function') return
  const observed = new WeakSet<object>()
  target.connect = async function (this: unknown, ...args: unknown[]) {
    const inner = await connect.apply(this, args)
    if (inner && typeof inner === 'object' && typeof (inner as Partial<EventEmitter>).on === 'function' && !observed.has(inner)) {
      observed.add(inner)
      ;(inner as EventEmitter).on('proxyConnect', (response: { statusCode?: unknown } | undefined) => {
        const statusCode = Number(response?.statusCode)
        if (Number.isInteger(statusCode) && statusCode > 0 && statusCode !== 200) onReject(statusCode)
      })
    }
    return inner
  }
}

export function zaloQrProxyRejectedMessage(statusCode: number): string {
  return `Proxy của tài khoản từ chối kết nối tới Zalo (mã ${statusCode}). Vui lòng kiểm tra lại proxy.`
}
