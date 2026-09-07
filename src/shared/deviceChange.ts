import type { DeviceLockResetResult } from './types'

export const DEVICE_CHANGE_WARNING = 'Nếu bạn sử dụng ứng dụng ở nhiều máy thì sẽ rất rủi ro cho tài khoản Zalo và Facebook, Email và có thể bị khóa tài khoản. Nên chỉ đổi máy trong trường hợp không còn dùng ứng dụng ở máy cũ nữa.'

export function deviceChangeMessage(result: DeviceLockResetResult): string {
  switch (result.code) {
    case 'changed': return `Đổi máy tính thành công. Bạn còn ${result.remainingChanges} lần đổi máy.`
    case 'already_unbound': return `Tài khoản chưa liên kết máy tính, không cần đổi máy. Bạn còn ${result.remainingChanges} lần đổi máy.`
    case 'quota_exhausted': return 'Bạn đã hết số lần đổi máy. Vui lòng liên hệ hỗ trợ.'
    case 'device_online': return 'Máy cũ vẫn được ghi nhận đang mở ứng dụng. Vui lòng đăng xuất hoặc thoát ứng dụng trên máy đó rồi thử lại.'
    case 'binding_conflict': return 'Liên kết máy tính đã thay đổi. Vui lòng kiểm tra lại rồi thử lại.'
    case 'not_authorized': return 'Chỉ máy tính đang được cấp quyền với phiên đăng nhập hợp lệ mới có thể đổi máy tính từ menu tài khoản.'
    case 'not_found': return 'Không tìm thấy tài khoản để đổi máy tính.'
    case 'inactive': return 'Tài khoản đã bị khoá.'
  }
}
